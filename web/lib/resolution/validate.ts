/**
 * The gate between a model's proposed outcome and a human resolver's queue.
 * **Pure: no I/O, no clock — `now` is injected.**
 *
 * Zod has checked the *shape*. This checks whether the answer is one a person could reasonably
 * be asked to sign, which is a different question and the one the API schema structurally
 * cannot ask.
 *
 * ## The four checks that carry weight
 *
 * 1. **The evidence label must be one we issued.** The URL that goes on chain is substituted
 *    here, from our own record of what each label pointed at. A label we never sent is discarded.
 *    This is the check Gemini's `responseSchema` cannot make — `evidenceLabel` is a well-typed
 *    string there whatever it contains.
 *
 * 2. **A settled outcome needs a quote that is actually in the evidence.** The model is asked to
 *    copy the sentence that settles the question. If that sentence does not appear in the text we
 *    supplied, the model is describing a source it was not given, and the draft is refused before
 *    a human is asked to trust it. The comparison is deliberately loose about whitespace,
 *    punctuation and case, and deliberately strict about words: a model that paraphrases fails,
 *    and it should, because a paraphrase is not something a reviewer can Ctrl-F.
 *
 * 3. **The market must be in a state the contract will accept.** `proposeResolution` requires
 *    `CLOSED` (it auto-closes an `OPEN` market past its close time) and reverts otherwise. A
 *    draft against a market that is still taking bets, already finalised, or invalidated is
 *    refused here so the reviewer never sees a button that cannot work.
 *
 * 4. **The model's own output is scanned for injection signatures.** Article text is untrusted, so
 *    text that has passed *through* a model after being derived from article text is untrusted
 *    too. An instruction echoed out of a hostile article trips the same signatures
 *    `lib/news/injection.ts` uses on the feed.
 *
 * ## What is a warning and not a rejection
 *
 * An indirect evidence link, injection signatures on the underlying article, and an evidence
 * article published before the market opened are all **shown to the resolver** rather than
 * blocking. The last one is the interesting case: an article that predates the market cannot
 * report the thing the market asked about, so it is usually wrong — but not always, because a
 * market can legitimately ask about a fact an older piece already establishes. That is a
 * judgement call, which makes it a human's.
 */

import { scanForInjection } from "../news/injection";
import {
  isOnChainOutcome,
  type DraftOutcomeValue,
  type ResolutionDraftFields,
} from "./schema";

/** One article the model was shown, keyed by the label we gave it. */
export type IssuedEvidence = {
  label: string;
  /** What goes on chain if this label is chosen. Publisher-owned and stable. */
  evidenceUrl: string;
  /** False when the feed only gave an aggregator redirect and we fell back to a front page. */
  directLink: boolean;
  domain: string;
  /** The exact text the model was shown for this label. Check 2 searches this. */
  text: string;
  /** Unix seconds, or null when the feed gave no date. */
  publishedAt: number | null;
  injectionFlags: readonly string[];
};

/** Everything about the market the validator needs, read from the chain by the caller. */
export type ResolvableMarket = {
  onchainId: number;
  question: string;
  resolutionCriteria: string;
  /** Unix seconds. */
  closeTime: number;
  /** The chain's state name. Only `CLOSED`, or `OPEN` past close, can be proposed on. */
  state: "OPEN" | "CLOSED" | "RESOLUTION_PROPOSED" | "FINALIZED" | "INVALIDATED";
  /** The chain's own count. The draft's round is this plus one. */
  challengeCount: number;
};

export type ResolutionValidationContext = {
  market: ResolvableMarket;
  issued: readonly IssuedEvidence[];
  /** Injected, so this function has no clock and a test can pin its output exactly. */
  now: number;
};

export type ResolutionValidation =
  | {
      ok: true;
      outcome: "YES" | "NO" | "INVALID";
      evidence: IssuedEvidence;
      settledByQuote: string;
      rationale: string;
      /** Shown in the resolver's checklist. Never blocks signing. */
      warnings: string[];
    }
  | {
      /** The model read the evidence and says the question is not settled yet. Not a failure. */
      ok: false;
      unsettled: true;
      rationale: string;
    }
  | { ok: false; unsettled: false; reasons: string[] };

/** Word-level normalisation for the quote check. Punctuation and case are noise; words are not. */
function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[‘’“”]/g, "'")
    .replace(/[^a-z0-9']+/g, " ")
    .trim()
    .split(" ")
    .filter((word) => word !== "");
}

/**
 * Whether `quote` appears in `haystack` as a contiguous run of words.
 *
 * A quote shorter than four words is not evidence of anything — "he said yes" would match half
 * the corpus — so it is treated as absent and the caller rejects it.
 */
export function quoteAppearsIn(quote: string, haystack: string): boolean {
  const needle = words(quote);
  if (needle.length < 4) return false;
  const hay = words(haystack);
  if (needle.length > hay.length) return false;

  for (let start = 0; start + needle.length <= hay.length; start += 1) {
    let matched = true;
    for (let offset = 0; offset < needle.length; offset += 1) {
      if (hay[start + offset] !== needle[offset]) {
        matched = false;
        break;
      }
    }
    if (matched) return true;
  }
  return false;
}

/** The round a draft for this market belongs to: one more challenge than the chain has recorded. */
export function roundFor(market: Pick<ResolvableMarket, "challengeCount">): number {
  return market.challengeCount + 1;
}

/**
 * Whether the contract would accept a `proposeResolution` for this market right now.
 *
 * Mirrors `AuspexMarket.proposeResolution` exactly: `CLOSED` is accepted, and `OPEN` is accepted
 * only once `closeTime` has passed because the contract closes it for us. Where this and the
 * contract disagree, the contract is right and this is a bug.
 */
export function isProposable(
  market: Pick<ResolvableMarket, "state" | "closeTime">,
  now: number,
): { ok: true } | { ok: false; reason: string } {
  if (market.state === "CLOSED") return { ok: true };
  if (market.state === "OPEN") {
    return now >= market.closeTime
      ? { ok: true }
      : {
          ok: false,
          reason:
            `the market is still taking bets until ${new Date(market.closeTime * 1000).toISOString()}` +
            ` — the contract reverts with BettingStillOpen`,
        };
  }
  return {
    ok: false,
    reason:
      `the market is ${market.state}, and the contract only accepts a resolution for a CLOSED ` +
      `market (it reverts with MarketNotClosed)`,
  };
}

/**
 * Turns a schema-valid draft into either a chain-ready outcome or a list of reasons.
 *
 * Collects **every** failing rule rather than returning on the first: the rejection row is
 * evidence, and "this draft broke three rules" tells a reader more than the first rule the loop
 * happened to reach.
 */
export function validateResolutionDraft(
  draft: ResolutionDraftFields,
  context: ResolutionValidationContext,
): ResolutionValidation {
  const { market, issued, now } = context;
  const outcome: DraftOutcomeValue = draft.outcome;

  // UNSETTLED short-circuits everything. It is not a rejection and it is not an outcome — it is
  // the model declining to answer, which is the correct answer for a market whose question has
  // not yet happened. No row is queued for a human and nothing is refused; the next pass asks
  // again with fresher articles. Checking anything else first would produce reasons like
  // "no evidence label" about a draft that is not claiming to have any.
  if (outcome === "UNSETTLED") {
    return { ok: false, unsettled: true, rationale: draft.rationale.trim() };
  }

  const reasons: string[] = [];
  const warnings: string[] = [];

  // 1 — the market must be in a state the contract accepts.
  const proposable = isProposable(market, now);
  if (!proposable.ok) reasons.push(proposable.reason);

  // 2 — the evidence label must be one we issued.
  const evidence = issued.find((source) => source.label === draft.evidenceLabel);
  if (evidence === undefined) {
    reasons.push(
      `evidenceLabel "${draft.evidenceLabel}" was never issued ` +
        `(issued: ${issued.map((s) => s.label).join(", ") || "none"})`,
    );
  }

  // 3 — the quote must be findable in the evidence the model was shown.
  const quote = draft.settledByQuote.trim();
  if (quote === "") {
    reasons.push(
      `outcome ${outcome} was proposed with no quote from the evidence — a resolver has ` +
        `nothing specific to check`,
    );
  } else if (evidence !== undefined && !quoteAppearsIn(quote, evidence.text)) {
    reasons.push(
      `settledByQuote does not appear in ${evidence.label} — the model is describing a source ` +
        `it was not given, or paraphrasing one it was. Either way a reviewer cannot verify it.`,
    );
  }

  // 4 — the model's own output is untrusted text and is scanned as such.
  const flags = scanForInjection(draft.rationale, quote);
  if (flags.length > 0) {
    reasons.push(
      `model output tripped injection signature(s): ${flags.join(", ")} — an instruction from a ` +
        `source article was echoed into the resolution`,
    );
  }

  // 5 — belt and braces on the outcome. Zod's enum already excludes UNRESOLVED and the branch
  //     above removed UNSETTLED, so this can only fire if someone widens the enum without
  //     reading the contract. It is here because the failure it prevents is a reverted
  //     `proposeResolution` (InvalidOutcome) in front of a reviewer.
  if (!isOnChainOutcome(outcome)) {
    reasons.push(`outcome ${outcome} is not a value proposeResolution accepts`);
  }

  if (reasons.length > 0 || evidence === undefined || !isOnChainOutcome(outcome)) {
    return { ok: false, unsettled: false, reasons };
  }

  // --- Warnings: things a human should see and decide about. --------------------------------

  if (evidence.injectionFlags.length > 0) {
    warnings.push(
      `the chosen evidence article carries injection signature(s): ` +
        `${evidence.injectionFlags.join(", ")}`,
    );
  }
  if (!evidence.directLink) {
    warnings.push(
      `the evidence link is ${evidence.domain}'s front page, not the article — the feed supplied ` +
        `an aggregator redirect, which is not stable enough to put on chain as evidence`,
    );
  }
  if (evidence.publishedAt !== null && evidence.publishedAt < market.closeTime) {
    warnings.push(
      `the evidence article was published ${new Date(evidence.publishedAt * 1000).toISOString()}, ` +
        `before this market closed — check that it really reports the outcome rather than the ` +
        `story the market was created from`,
    );
  }
  if (outcome === "INVALID") {
    warnings.push(
      `INVALID refunds every bettor their exact stake and pays no winner. Only sign this if the ` +
        `question genuinely cannot be settled as written.`,
    );
  }

  return {
    ok: true,
    outcome,
    evidence,
    settledByQuote: quote,
    rationale: draft.rationale.trim(),
    warnings,
  };
}

/** Exposed so `/resolve` can show the resolver exactly which rules a draft had to pass. */
export const RESOLUTION_RULES: readonly string[] = [
  "the evidence is one of the articles we supplied — the model never types a URL",
  "the quote the outcome rests on is found, word for word, in that article's text",
  "the market is in a state the contract will accept a resolution for",
  "the model's own output is scanned for prompt-injection signatures",
  "the outcome is one of YES, NO, INVALID — the three values proposeResolution takes",
];
