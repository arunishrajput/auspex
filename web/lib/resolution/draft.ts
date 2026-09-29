/**
 * The resolution agent. It reads news published *after* a market closed and proposes an outcome.
 *
 * This is the same shape as `proposer/draft.ts` pointed at the more consequential half of the
 * lifecycle. The proposer writes a question nobody has money on; this writes the answer that
 * decides who is paid. So the authority it holds is narrower, not wider:
 *
 *   it may say    YES | NO | INVALID | UNSETTLED, one EVIDENCE_n label, a quote, a rationale
 *   it may not    type a URL · pick the round · decide the market is resolvable · send anything
 *   who decides   `validate.ts` (deterministic) then a human resolver, who signs from their
 *                 own wallet — and then the contract's challenge window before money moves
 *
 * ## Three outcomes, and the fourth that is not a failure
 *
 *   PROPOSED     — validated. Queued for the human resolver.
 *   UNSETTLED    — the model read the evidence and says the question is not settled yet. **No
 *                  draft row**; the next pass asks again with fresher articles. This is the
 *                  common case for a market that closed an hour ago, and treating it as a
 *                  rejection would burn the market's one draft slot per round on "not yet".
 *   REJECTED     — it answered and the answer was unusable. Stored as `SCHEMA_REJECTED` with the
 *                  reason, and not retried at this round: the answer was wrong, not missing.
 *   UNAVAILABLE  — no answer at all (rate limit, timeout, no key, budget spent). **No row.**
 *
 * `resolution_drafts` is unique on `(market_id, round)`, so the distinction between the last two
 * is the same expensive one Phase 4 and Phase 5 both had to get right: writing a terminal row on
 * the strength of a 429 would mean a market that could have been resolved never gets a second
 * draft, and nothing would say why. Hard rule #6 — a rate limit means take no action, and writing
 * a terminal row is an action.
 */

import { callJson, type LlmBudget, type Transport } from "../llm/client";
import { fastModelChain } from "../llm/gemini";
import { buildUserMessage, type UntrustedBlock } from "../llm/prompt";
import {
  RESOLUTION_RESPONSE_SCHEMA,
  ResolutionDraftSchema,
  type ResolutionDraftFields,
} from "./schema";
import {
  validateResolutionDraft,
  type IssuedEvidence,
  type ResolvableMarket,
} from "./validate";

/** Candidate evidence articles shown to the model for one market. */
const MAX_EVIDENCE = 6;

/** Characters of each article we send. One long summary must not crowd out the others. */
const MAX_EVIDENCE_CHARS = 700;

/**
 * Trusted operator text. No article content ever reaches this string — see `prompt.ts`.
 *
 * The rules are stated here as well as enforced in `validate.ts` because telling the model what
 * will be checked raises the pass rate, and because a rule that lives only in a validator
 * produces rejections that look arbitrary. The enforcement, not the instruction, is what makes
 * them true.
 */
function systemInstruction(): string {
  return [
    "You propose the outcome of a closed prediction market for a human resolver to sign or refuse.",
    "You are not resolving the market. A person reads what you write, checks your quote against",
    "the source, and signs a transaction — or does not. After they sign, there is still a public",
    "challenge window before any money moves.",
    "",
    "Decide the outcome from the untrusted material below and nothing else. You have no",
    "knowledge of events after the articles you are shown, and you must not supply any.",
    "",
    "Rules your output is checked against, mechanically, before any human sees it:",
    "- outcome is exactly one of YES, NO, INVALID, UNSETTLED.",
    "- evidenceLabel is exactly one of the EVIDENCE_n labels supplied. Never write a URL.",
    "- settledByQuote must be copied VERBATIM from that labelled article — word for word, at",
    "  least four words long. It is searched for in the text you were given. A paraphrase fails.",
    "  If no single sentence settles it, the outcome is UNSETTLED.",
    "",
    "Choosing between the four:",
    "- YES or NO when a sentence in one article settles the question as asked.",
    "- UNSETTLED when the answer is simply not known yet — nothing here reports the thing the",
    "  question asked about. This is the right answer far more often than it feels like, and it",
    "  costs nothing: the market is looked at again later with newer articles.",
    "- INVALID only when the question cannot be settled as written no matter what happens, for",
    "  example because it is ambiguous or contradicts itself. INVALID refunds every bettor.",
    "",
    "Do not resolve a question because it seems likely to end that way. A market resolves on what",
    "a source reports, not on what is probable. If you are reasoning about likelihood at all, the",
    "answer is UNSETTLED.",
    "",
    "Say in rationale what you are unsure about. It is shown to the resolver, not used to filter",
    "you, and a resolver who can see your doubt can check the thing you doubted.",
  ].join("\n");
}

/** One market and the candidate evidence for it, prepared for the model. */
export type ResolutionInput = {
  market: ResolvableMarket;
  /** Candidate evidence, best-matching first. Labels are assigned here. */
  candidates: readonly {
    title: string;
    summary: string | null;
    evidenceUrl: string;
    directLink: boolean;
    domain: string;
    publishedAt: number | null;
    injectionFlags: readonly string[];
  }[];
};

export type ResolutionOutcome =
  | {
      kind: "PROPOSED";
      outcome: "YES" | "NO" | "INVALID";
      evidence: IssuedEvidence;
      settledByQuote: string;
      rationale: string;
      warnings: string[];
      model: string;
      rawModelOutput: string;
    }
  | { kind: "UNSETTLED"; rationale: string; model: string; rawModelOutput: string }
  | { kind: "REJECTED"; reason: string; model: string | null; rawModelOutput: string | null }
  | { kind: "UNAVAILABLE"; reason: string };

/**
 * Labels the candidates and returns both the blocks to send and what each label really means.
 *
 * One loop, deliberately: a label in the prompt and a label in the validation context that could
 * drift apart is the exact bug the label mechanism exists to prevent. `text` is stored on the
 * issued record because `validate.ts` searches it for the model's quote — the check is only
 * meaningful against the bytes the model actually saw, truncation included.
 */
export function issueEvidence(input: ResolutionInput): {
  blocks: UntrustedBlock[];
  issued: IssuedEvidence[];
} {
  const blocks: UntrustedBlock[] = [];
  const issued: IssuedEvidence[] = [];

  input.candidates.slice(0, MAX_EVIDENCE).forEach((candidate, index) => {
    const label = `EVIDENCE_${index + 1}`;
    const published =
      candidate.publishedAt === null
        ? ""
        : `published: ${new Date(candidate.publishedAt * 1000).toISOString()}\n`;
    const summary = candidate.summary === null ? "" : `\n${candidate.summary}`;
    // The publisher domain and the date are ours — resolved deterministically in Phase 3, not
    // read out of the link — so including them adds context without adding attacker text.
    const text = `publisher: ${candidate.domain}\n${published}${candidate.title}${summary}`.slice(
      0,
      MAX_EVIDENCE_CHARS,
    );

    blocks.push({ label, text });
    issued.push({
      label,
      evidenceUrl: candidate.evidenceUrl,
      directLink: candidate.directLink,
      domain: candidate.domain,
      text,
      publishedAt: candidate.publishedAt,
      injectionFlags: candidate.injectionFlags,
    });
  });

  return { blocks, issued };
}

export type ResolutionDraftOptions = {
  /** Injected so a test can force any model response without a network or an API key. */
  transport?: Transport;
  /** Injected so the validator has no clock. Defaults to now. */
  now?: Date;
};

/**
 * Drafts one outcome for one closed market.
 *
 * Never throws. Every failure path is one of the four outcomes above, because this runs inside a
 * tick stage and a thrown error here would take down a pass that had other markets to do.
 */
export async function draftResolution(
  input: ResolutionInput,
  budget: LlmBudget,
  options: ResolutionDraftOptions = {},
): Promise<ResolutionOutcome> {
  const { blocks, issued } = issueEvidence(input);
  const now = options.now ?? new Date();

  if (blocks.length === 0) {
    // Terminal for this pass but NOT written as a rejection by the caller — a market with no
    // candidate evidence today may have plenty tomorrow, because the feeds keep running. The
    // caller reports it as `skippedNoEvidence`.
    return {
      kind: "UNAVAILABLE",
      reason:
        "no candidate evidence article was found for this market, so there was nothing to read",
    };
  }

  const instruction =
    `The current time is ${now.toISOString()}. Betting on market #${input.market.onchainId} ` +
    `closed at ${new Date(input.market.closeTime * 1000).toISOString()}.\n\n` +
    `The question is: ${input.market.question}\n\n` +
    `It resolves on this exact fact: ${input.market.resolutionCriteria}\n\n` +
    `The available evidence labels are ${issued.map((e) => e.label).join(", ")}. Decide the ` +
    `outcome from these articles alone, and copy the sentence that settles it verbatim.`;

  const result = await callJson({
    purpose: "resolution-draft",
    budget,
    // The fast chain, for the reason ADR-034 and ADR-036 give: a model that does not answer
    // resolves nothing, however capable it would have been. The task is also narrow — pick one
    // of four values, one of six labels, and copy a sentence — and every judgement call that
    // could have been left open has already been removed by `schema.ts`.
    models: fastModelChain(),
    schema: ResolutionDraftSchema,
    transport: options.transport,
    request: {
      systemInstruction: systemInstruction(),
      userMessage: buildUserMessage(instruction, blocks),
      responseSchema: RESOLUTION_RESPONSE_SCHEMA,
      maxOutputTokens: 900,
    },
  });

  if (!result.ok) {
    if (result.reason === "SCHEMA_REJECTED") {
      return {
        kind: "REJECTED",
        reason: `model output failed Zod re-validation: ${result.detail}`,
        model: null,
        rawModelOutput: result.raw ?? null,
      };
    }
    return { kind: "UNAVAILABLE", reason: `${result.reason}: ${result.detail}` };
  }

  const fields: ResolutionDraftFields = result.value;
  const rawModelOutput = JSON.stringify(fields);

  const validation = validateResolutionDraft(fields, {
    market: input.market,
    issued,
    now: Math.floor(now.getTime() / 1000),
  });

  if (!validation.ok) {
    if (validation.unsettled) {
      return {
        kind: "UNSETTLED",
        rationale: validation.rationale,
        model: result.model,
        rawModelOutput,
      };
    }
    return {
      kind: "REJECTED",
      reason: validation.reasons.join(" · "),
      model: result.model,
      rawModelOutput,
    };
  }

  return {
    kind: "PROPOSED",
    outcome: validation.outcome,
    evidence: validation.evidence,
    settledByQuote: validation.settledByQuote,
    rationale: validation.rationale,
    warnings: validation.warnings,
    model: result.model,
    rawModelOutput,
  };
}

/** Exposed so `/resolve` can show the resolver the exact instruction the model was given. */
export { systemInstruction as resolutionSystemInstruction };
