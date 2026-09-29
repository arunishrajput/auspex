/**
 * The member agent. One agent, one market, one call, five constrained fields.
 *
 * This is the second of the two kinds of agent `docs/ARCHITECTURE.md` §6 keeps deliberately
 * apart. The proposer writes *text* a human then reads; this one takes a *position* with money.
 * They share no code path and no credentials, and the difference in what bounds them is the
 * whole point: a bad proposal is caught by a person reading a checklist, a bad bet is clamped by
 * `lib/policy/policyGate.ts` and then clamped again by the contract.
 *
 * ## Three outcomes, for the same reason Phase 4 has three
 *
 *   PROPOSED     — a schema-valid, hygienic proposal. Goes to the policy gate.
 *   REJECTED     — the model answered and the answer was unusable. A decision row is written and
 *                  kept, because the row is the evidence. Asking again gets the same answer.
 *   UNAVAILABLE  — no answer at all (rate limit, timeout, no key, budget spent). **No row.**
 *
 * `agent_decisions` is unique on `(market_id, member_id, round)`, so collapsing the last two
 * would write a terminal row on the strength of a 429 — and that member could then never bet on
 * that market again, with nothing on the page saying why. This is the identical trap
 * `lib/proposer/draft.ts` documents for `proposals.event_id`, and it costs more here: there the
 * loss was a market that should have existed, here it is an agent permanently frozen out.
 *
 * ## What this agent is not told
 *
 * **Its confidence threshold.** The member's policy has a `minConfidence`, and the prompt does
 * not mention it. A model told "your member requires 0.8" is a model that has been handed the
 * answer — it would report 0.8 and the threshold would measure nothing. ADR-041 made the same
 * call about the proposer's self-rated ambiguity; the consequence here is money rather than a
 * warning badge, so the reasoning applies with more force.
 *
 * **Its caps, in any unit.** It emits `stakeFraction`, a share of a limit whose value it never
 * sees. See `schema.ts` for why that field has no absolute form.
 *
 * **Which market to bet on, or whether to bet at all.** It is handed one market and asked about
 * that one. Selection is the caller's; permission is the gate's.
 */

import { callJson, type LlmBudget, type Transport } from "../llm/client";
import { fastModelChain } from "../llm/gemini";
import { buildUserMessage, type UntrustedBlock } from "../llm/prompt";
import { scanForInjection } from "../news/injection";
import { BET_RESPONSE_SCHEMA, BetProposalSchema, type BetProposal } from "./schema";

/** Articles shown per market. Enough to see the story, few enough to stay inside a free tier. */
const MAX_ARTICLES = 5;

/** Characters of each article. One long summary must not crowd the others out. */
const MAX_ARTICLE_CHARS = 500;

export type BetResearchInput = {
  /** The market as a human approved it. Question and criteria come from the signed spec. */
  market: {
    onchainId: number;
    question: string;
    resolutionCriteria: string;
    resolutionSourceUrl: string;
    category: string;
    /** Unix seconds. Stated to the model so "will it happen in time" is answerable. */
    closeTime: number;
  };
  /** Which member's agent is thinking. Used only to label the call, never as authority. */
  memberHandle: string;
  /** The same articles the proposer saw, re-labelled for this call. Untrusted. */
  articles: readonly {
    title: string;
    summary: string | null;
    /** Resolved by us in Phase 3 from the feed's `<source url>`, not read from the link. */
    domain: string;
  }[];
};

export type BetOutcome =
  | {
      kind: "PROPOSED";
      proposal: BetProposal;
      /** Exactly the labels issued, for the gate to check the citations against. */
      issuedLabels: string[];
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
 * Trusted operator text. No article content reaches this string — see `lib/llm/prompt.ts`.
 *
 * The rules are stated here as well as enforced in the gate, for the reason `draft.ts` gives:
 * telling the model what will be checked raises the pass rate, and a rule that exists only in a
 * validator produces rejections that look arbitrary. The enforcement is what makes them true.
 *
 * ## The paragraph in capitals is there because of a measured failure
 *
 * The first live pass produced **four abstentions out of four**, with rationales like "the sources
 * discuss past interest rate decisions". The agents were right about the evidence and wrong about
 * the task, and the prompt was why: it said to abstain when "the material does not support either
 * side", and a market must by construction ask about something the material cannot settle — the
 * proposer is explicitly instructed to ask about the next step, the consequence, or the
 * confirmation that has not happened yet.
 *
 * So the two prompts, each sensible alone, composed into a pipeline that could never place a bet.
 * Forecasting under uncertainty is the activity; "the answer is not in the newspaper" is a
 * category error, not an abstention. ABSTAIN is still a first-class answer — it is now reserved
 * for material that is about something else entirely, which is what it should always have meant.
 */
function systemInstruction(): string {
  return [
    "You are one member's betting agent on a prediction market platform.",
    "You are proposing a position. You are not placing a bet: deterministic code decides",
    "whether your proposal is acted on and how much is staked, and a smart contract caps that",
    "amount again. Your job is to be right, not to be permitted.",
    "",
    "YOU ARE FORECASTING, NOT LOOKING SOMETHING UP.",
    "The market asks about something that has NOT HAPPENED YET — that is what makes it a market.",
    "The articles below are dated before the question and will not contain its answer. They are",
    "evidence about how likely the answer is. Weigh them and take the side you judge more likely",
    "than not. A forecaster who is 60% sure takes the 60% side; that is the whole activity.",
    "",
    "Read the market question and the untrusted news material below, then answer:",
    "",
    "- side: YES if you judge the question more likely than not to resolve yes by its stated",
    "  criteria, NO if you judge it more likely to resolve no.",
    "  ABSTAIN only when the material gives you no purchase on the question at all — it is about",
    "  a different subject, or the outcome turns on something none of it speaks to. Do NOT abstain",
    "  merely because the articles do not state the answer: they never will.",
    "  When you do abstain, set confidence and stakeFraction to 0; no side was taken, so neither",
    "  number means anything.",
    "",
    "- confidence: 0 to 1, in the side you chose. Rate it honestly.",
    "  It is compared against a threshold you are NOT told, because an agent that knew the",
    "  threshold would simply report it. Your number is used as evidence about you, not by you.",
    "  A genuine forecast from good reporting usually lands between 0.55 and 0.85. Reserve",
    "  anything above 0.9 for an outcome that is all but already determined.",
    "",
    "- stakeFraction: 0 to 1, the share of your per-transaction limit to stake, reflecting your",
    "  conviction. You do not know that limit in tMSTC and you do not need to. Deterministic code",
    "  multiplies your fraction out and then reduces it against your daily budget, your wallet",
    "  balance and two caps the contract enforces. A larger number cannot get you a larger bet",
    "  than your member's policy allows; it can only be clamped. 0 means no bet.",
    "",
    "- rationale: 20-400 characters naming the specific evidence and the reasoning from it to",
    "  your side, citing the SOURCE_n labels you used. Not 'the news suggests' — say which",
    "  article says what, and why that makes your side more likely.",
    "",
    "- sourceLabels: only labels supplied to you. A label you invent voids the proposal, because",
    "  a rationale resting on a source that does not exist is not a rationale.",
    "",
    "Forecast what the resolution criteria will actually say at the named source by the deadline,",
    "not what you think ought to happen. Base rates matter: most announced processes continue,",
    "most scheduled decisions happen on schedule, and most one-off reversals do not occur.",
  ].join("\n");
}

/**
 * Labels the articles and returns both the blocks to send and the labels that were issued.
 *
 * One loop produces both, exactly as `issueSources` does in `draft.ts`: a label in the prompt
 * and a label in the validation set that could drift apart is the bug the label mechanism
 * exists to prevent.
 */
export function issueArticleLabels(input: BetResearchInput): {
  blocks: UntrustedBlock[];
  issuedLabels: string[];
} {
  const blocks: UntrustedBlock[] = [];
  const issuedLabels: string[] = [];

  input.articles.slice(0, MAX_ARTICLES).forEach((article, index) => {
    const label = `SOURCE_${index + 1}`;
    const summary = article.summary === null ? "" : `\n${article.summary}`;
    blocks.push({
      label,
      text: `publisher: ${article.domain}\n${article.title}${summary}`.slice(0, MAX_ARTICLE_CHARS),
    });
    issuedLabels.push(label);
  });

  return { blocks, issuedLabels };
}

export type ProposeBetOptions = {
  /** Injected so a test can force any model response without a network or an API key. */
  transport?: Transport;
};

/**
 * Asks one agent about one market.
 *
 * Never throws. Every failure is one of the three outcomes, because this runs inside a tick
 * stage and a throw here would abandon the other members the pass still had to ask.
 */
export async function proposeBet(
  input: BetResearchInput,
  budget: LlmBudget,
  options: ProposeBetOptions = {},
): Promise<BetOutcome> {
  const { blocks, issuedLabels } = issueArticleLabels(input);

  if (blocks.length === 0) {
    // Terminal: an agent asked to take a position with no evidence in front of it has nothing to
    // be right about, and the next tick would hand it the same empty set.
    return {
      kind: "REJECTED",
      reason:
        "no source articles were available for this market, so the agent had nothing to read",
      model: null,
      rawModelOutput: null,
    };
  }

  const closesAt = new Date(input.market.closeTime * 1000).toISOString();
  const instruction =
    `Market #${input.market.onchainId} (${input.market.category}), betting closes ${closesAt}.\n\n` +
    `QUESTION: ${input.market.question}\n` +
    `RESOLVES BY: ${input.market.resolutionCriteria}\n` +
    `RESOLUTION SOURCE: ${input.market.resolutionSourceUrl}\n\n` +
    `Decide YES, NO or ABSTAIN on that question, by those criteria, before that time. ` +
    `The available source labels are ${issuedLabels.join(", ")}.`;

  const result = await callJson({
    purpose: `agent-bet:${input.memberHandle}`,
    budget,
    // The FAST chain. `.env.example` aspires to use SMART for "agent research", and measurement
    // overruled it: ADR-034 found `3.8-flash` returning 503 and `3.5-flash-lite` timing out,
    // while `3.1-flash-lite` answered every call. An agent that does not answer takes no
    // position, however capable it would have been — and this task is narrower than the
    // proposer's, which already runs on FAST for the same reason (ADR-036).
    models: fastModelChain(),
    schema: BetProposalSchema,
    transport: options.transport,
    request: {
      systemInstruction: systemInstruction(),
      userMessage: buildUserMessage(instruction, blocks),
      responseSchema: BET_RESPONSE_SCHEMA,
      maxOutputTokens: 600,
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

  const proposal = result.value;
  const rawModelOutput = JSON.stringify(proposal);

  // Hard rule #4, applied to the model's own words. The rationale is derived from news text and
  // is about to be stored and rendered on a page, so text that has passed *through* a model
  // after being derived from a hostile headline is still hostile. Same signatures the feed is
  // scanned with, same treatment `validate.ts` gives the proposer's output.
  const flags = scanForInjection(proposal.rationale);
  if (flags.length > 0) {
    return {
      kind: "REJECTED",
      reason:
        `rationale tripped injection signature(s): ${flags.join(", ")} — an instruction from a ` +
        `source article was echoed into the agent's reasoning`,
      model: result.model,
      rawModelOutput,
    };
  }

  return {
    kind: "PROPOSED",
    proposal,
    issuedLabels,
    model: result.model,
    rawModelOutput,
  };
}

/** Exposed so `/agents` can show the exact instruction every agent is given. */
export { systemInstruction as agentSystemInstruction };
