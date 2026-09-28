/**
 * The market proposer agent. The only place an LLM writes text that can reach the chain.
 *
 * It does exactly one thing: read a confirmed event's headlines and fill in seven fields. It
 * cannot decide whether the market exists (a human does), when it closes (bounded and computed
 * deterministically), where it resolves (chosen by label from a menu), or that its question is
 * acceptable (`validate.ts`). Everything it produces is a *proposal* in the literal sense.
 *
 * ## Three outcomes, and why they are three and not two
 *
 *   PROPOSED     — a schema-valid, rule-passing spec. Goes to the human queue.
 *   REJECTED     — the model answered and the answer was unusable. Stored as `SCHEMA_REJECTED`
 *                  with the reason, and the event is never retried: the answer was wrong, not
 *                  missing, and asking again at temperature 0 gets the same answer.
 *   UNAVAILABLE  — no answer at all (rate limit, timeout, no key, budget spent). **No row is
 *                  written**, so the next tick tries the event again.
 *
 * Collapsing the last two would be the expensive mistake. `proposals` is unique on `event_id`,
 * so writing a `SCHEMA_REJECTED` row for a 429 would permanently poison a confirmed event on
 * the strength of a transient failure — a market that should exist would never be proposed
 * again, and nothing would say why. Hard rule #6 says a rate limit means *take no action*, and
 * writing a terminal row is an action.
 */

import { callJson, type LlmBudget, type Transport } from "../llm/client";
import { fastModelChain } from "../llm/gemini";
import { buildUserMessage, type UntrustedBlock } from "../llm/prompt";
import type { MarketSpec } from "../chain/spec";
import {
  closeHourBounds,
  DRAFT_RESPONSE_SCHEMA,
  DraftSchema,
  MARKET_CATEGORIES,
  RESOLVE_GRACE_HOURS,
} from "./schema";
import { validateDraft, VAGUE_TERMS, BINARY_OPENERS, type IssuedSource } from "./validate";

/** Articles shown to the model for one event. Enough to see the story, few enough to stay cheap. */
const MAX_SOURCES_PER_EVENT = 6;

/** Characters of each article we send. One long summary must not crowd out the others. */
const MAX_SOURCE_CHARS = 600;

/**
 * Trusted operator text. No article content ever reaches this string — see `prompt.ts`.
 *
 * The rules are stated here *as well as* enforced in `validate.ts` because telling the model
 * what will be checked raises the pass rate, and because a rule that exists only in a validator
 * produces rejections that look arbitrary. The enforcement, not the instruction, is what makes
 * them true.
 */
function systemInstruction(bounds: { min: number; max: number }): string {
  return [
    "You draft prediction-market specifications for a human reviewer to approve or reject.",
    "You are drafting a proposal. You are not creating a market: a person reads what you",
    "write and signs it, or does not.",
    "",
    "Write ONE binary market about the event described in the untrusted material below.",
    "",
    "Rules your output is checked against, mechanically, before any human sees it:",
    `- question must end in "?" and open with one of: ${BINARY_OPENERS.join(", ")}.`,
    "- question must be settleable YES or NO by one specific, checkable fact.",
    `- question and resolutionCriteria must contain none of these unresolvable words: ${VAGUE_TERMS.join(", ")}.`,
    "- resolutionSourceLabel must be exactly one of the SOURCE_n labels supplied to you.",
    "  Do not write a URL anywhere. Do not invent a label.",
    "- resolutionCriteria must name the exact fact to look for at that source, in a form a",
    "  person can verify in one read. Not 'check the news' — say what sentence would settle it.",
    `- closeInHours must be between ${bounds.min} and ${bounds.max}.`,
    `- category must be one of: ${MARKET_CATEGORIES.join(", ")}.`,
    "",
    "The question must be about something NOT YET KNOWN. A market on a fact the articles",
    "already report has only one possible outcome and is worthless. Ask about the next step,",
    "the consequence, or the confirmation that has not happened yet.",
    "",
    "Do NOT write a date or a deadline into the question. closeInHours is the deadline, and the",
    "spec carries it as an absolute time. A date inside the question is at best redundant and at",
    "worst contradicts the real one — the first live run of this agent wrote a 2024 deadline onto",
    "a market closing the next day, and the check above now refuses that.",
    "",
    "Rate your own ambiguityRisk honestly. It is shown to the reviewer, not used to filter you.",
  ].join("\n");
}

/** One event, prepared for the model. Labels are ours; article text is not. */
export type ProposalInput = {
  eventId: string;
  eventTitle: string;
  articles: readonly {
    title: string;
    summary: string | null;
    /** The feed's link. Shown to the reviewer; may be an aggregator redirect. */
    articleUrl: string;
    /** What would go on chain if this source is chosen. See `resolutionUrlFor`. */
    resolutionUrl: string;
    directLink: boolean;
    domain: string;
    injectionFlags: readonly string[];
  }[];
};

export type DraftOutcome =
  | {
      kind: "PROPOSED";
      spec: MarketSpec;
      specHash: string;
      resolutionSource: IssuedSource;
      warnings: string[];
      model: string;
      rawModelOutput: string;
    }
  | {
      kind: "REJECTED";
      reason: string;
      model: string | null;
      rawModelOutput: string | null;
    }
  | { kind: "UNAVAILABLE"; reason: string };

/**
 * Labels the articles and returns both the blocks to send and what each label really means.
 *
 * The two come from one loop on purpose: a label in the prompt and a label in the validation
 * context that could drift apart is the exact bug the label mechanism exists to prevent.
 */
export function issueSources(input: ProposalInput): {
  blocks: UntrustedBlock[];
  issued: IssuedSource[];
} {
  const blocks: UntrustedBlock[] = [];
  const issued: IssuedSource[] = [];

  input.articles.slice(0, MAX_SOURCES_PER_EVENT).forEach((article, index) => {
    const label = `SOURCE_${index + 1}`;
    const summary = article.summary === null ? "" : `\n${article.summary}`;
    blocks.push({
      label,
      // The publisher domain is ours (resolved deterministically in Phase 3, not read from the
      // link), so including it gives the model context without adding attacker-controlled text.
      text: `publisher: ${article.domain}\n${article.title}${summary}`.slice(
        0,
        MAX_SOURCE_CHARS,
      ),
    });
    issued.push({
      label,
      articleUrl: article.articleUrl,
      resolutionUrl: article.resolutionUrl,
      directLink: article.directLink,
      domain: article.domain,
      injectionFlags: article.injectionFlags,
    });
  });

  return { blocks, issued };
}

export type DraftOptions = {
  /** Injected so a test can force any model response without a network or an API key. */
  transport?: Transport;
  /** Injected so the spec a test produces is deterministic. */
  now?: Date;
};

/**
 * Drafts one market spec for one confirmed event.
 *
 * Never throws. Every failure path is one of the three outcomes above, because this runs inside
 * a tick stage and a thrown error here would take down a pass that had other events to do.
 */
export async function draftProposal(
  input: ProposalInput,
  budget: LlmBudget,
  options: DraftOptions = {},
): Promise<DraftOutcome> {
  const { blocks, issued } = issueSources(input);

  if (blocks.length === 0) {
    // Callers filter this out before spending a budget on it (`runProposerPass` counts it as
    // `skippedNoSource`). Kept as a guard so `draftProposal` is safe to call directly, and
    // terminal because a market with no resolution source can never be resolved.
    return {
      kind: "REJECTED",
      reason: "the event has no source articles, so no resolution source could be issued",
      model: null,
      rawModelOutput: null,
    };
  }

  const bounds = closeHourBounds();
  const now = options.now ?? new Date();

  // The current instant is stated explicitly. A model has no clock, and the one thing it
  // reliably gets wrong without being told is *when* it is — which is how a market closing
  // tomorrow acquired a 2024 deadline on the first live run.
  const instruction =
    `The current time is ${now.toISOString()}. Draft one binary prediction market about the ` +
    `story reported by these ${blocks.length} articles. The available resolution source labels ` +
    `are ${issued.map((s) => s.label).join(", ")}. Betting must close between ${bounds.min} and ` +
    `${bounds.max} hours from now, and a resolver then has ${RESOLVE_GRACE_HOURS} hours to ` +
    `submit an outcome. Ask about something that will be settled within that window.`;

  const result = await callJson({
    purpose: "market-proposal",
    budget,
    // The FAST chain, not the SMART one, and that is measured rather than modest. ADR-034
    // found `3.1-flash-lite` answered every live call while `3.8-flash` returned 503 and
    // `3.5-flash-lite` timed out — and a model that does not answer drafts nothing however
    // capable it would have been. The task is also narrow: fill seven constrained fields from
    // five headlines, with every judgement call already removed by `schema.ts`. See ADR-036.
    models: fastModelChain(),
    schema: DraftSchema,
    transport: options.transport,
    request: {
      systemInstruction: systemInstruction(bounds),
      userMessage: buildUserMessage(instruction, blocks),
      responseSchema: DRAFT_RESPONSE_SCHEMA,
      maxOutputTokens: 800,
    },
  });

  if (!result.ok) {
    // SCHEMA_REJECTED is the one failure that is the model's fault and will recur: it answered,
    // and the answer did not fit the schema. Everything else is infrastructure, and retrying is
    // the right response — so it gets no row.
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

  const rawModelOutput = JSON.stringify(result.value);
  const validation = validateDraft(result.value, {
    issued,
    now,
    minCloseHours: bounds.min,
    maxCloseHours: bounds.max,
  });

  if (!validation.ok) {
    return {
      kind: "REJECTED",
      reason: validation.reasons.join(" · "),
      model: result.model,
      rawModelOutput,
    };
  }

  return {
    kind: "PROPOSED",
    spec: validation.spec,
    specHash: validation.specHash,
    resolutionSource: validation.resolutionSource,
    warnings: validation.warnings,
    model: result.model,
    rawModelOutput,
  };
}

/** Exposed so `/review` can show the reviewer the exact instruction the model was given. */
export { systemInstruction as proposerSystemInstruction };
