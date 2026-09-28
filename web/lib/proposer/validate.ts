/**
 * The gate between a model's draft and a human's review queue. **Pure: no I/O, no clock.**
 *
 * Zod has already checked that the draft has the right *shape*. This file checks whether it is
 * a market that can actually settle — which is a different question, and the one the API schema
 * structurally cannot ask.
 *
 * Every rejection here produces a `SCHEMA_REJECTED` proposal row naming the rule that fired.
 * Those rows are kept and displayed on purpose (hard rule #7): a gate whose rejections are
 * invisible is indistinguishable from no gate.
 *
 * ## The four checks that carry real weight
 *
 * 1. **The resolution source must be a label we issued.** The model picks from a menu of the
 *    event's own articles; it never types a URL. A label we did not send is discarded outright.
 *    This is the check Gemini's `responseSchema` cannot make — `resolutionSourceLabel` is a
 *    well-typed string there, and still meaningless.
 *
 * 2. **The question must be binary and answerable.** It has to end in a question mark and open
 *    with a word that admits a yes/no answer. "What will the ECB do in October?" is a fine
 *    question and a broken market: there is no outcome the contract can pay on.
 *
 * 3. **Vague quantifiers are fatal, not cosmetic.** "Will X significantly increase?" cannot be
 *    settled from a source, so it cannot be resolved honestly — and the moment money is in the
 *    pool, an unresolvable question is a dispute. This is the "ambiguity check before money is
 *    involved" the build plan asks for, made mechanical rather than left to the reviewer's
 *    attention.
 *
 * 4. **The model's own output is scanned for injection signatures.** News text is untrusted, so
 *    text that has passed *through* a model after being derived from news text is untrusted
 *    too. If an injected instruction is echoed into the question, it trips the same signatures
 *    `lib/news/injection.ts` uses on the feed, and the draft is rejected rather than shown to a
 *    human as a market.
 *
 * ## What is NOT a rejection, deliberately
 *
 * `ambiguityRisk: "HIGH"` is carried through as a **warning shown to the reviewer**, never as an
 * automatic reject. A model that wanted its market approved would simply rate itself `LOW`, so
 * treating its self-assessment as a gate would be trusting the thing being gated. It is useful
 * as a hint to a human and worthless as a control.
 */

import { computeSpecHash, type MarketSpec } from "../chain/spec";
import { scanForInjection } from "../news/injection";
import { RESOLVE_GRACE_HOURS, type Draft } from "./schema";

/**
 * Openers that admit a yes/no answer.
 *
 * Deliberately excludes "Should" — that asks for an opinion, and an opinion has no fact at a
 * source that settles it.
 */
const BINARY_OPENERS = [
  "will",
  "did",
  "does",
  "do",
  "is",
  "are",
  "was",
  "were",
  "has",
  "have",
  "can",
] as const;

/**
 * Words that make a binary question unresolvable.
 *
 * Every entry is a term with no threshold: two honest readers of the same source can disagree
 * about whether it happened. Terms that merely *sound* vague but are settleable in context
 * ("about", "around", "some") are left out — over-rejecting would push the model toward
 * stilted questions without making any of them more resolvable.
 */
const VAGUE_TERMS = [
  "significant",
  "significantly",
  "substantial",
  "substantially",
  "major",
  "minor",
  "many",
  "soon",
  "shortly",
  "eventually",
  "likely",
  "unlikely",
  "probably",
  "possibly",
  "maybe",
  "better",
  "worse",
  "successful",
  "successfully",
  "notable",
  "notably",
  "meaningful",
  "appropriate",
  "reasonable",
  "adequate",
  "sufficient",
  "widely",
  "mostly",
  "largely",
  "roughly",
  "approximately",
] as const;

/** One article the model was shown, keyed by the label we gave it. */
export type IssuedSource = {
  label: string;
  /** Where the reviewer clicks to read the article. May be an aggregator redirect. */
  articleUrl: string;
  /** What goes on chain. Always real, publisher-owned and stable — see `resolutionUrlFor`. */
  resolutionUrl: string;
  /** False when `resolutionUrl` fell back to the publisher's front page. Becomes a warning. */
  directLink: boolean;
  domain: string;
  /** Injection signatures on the underlying article. Surfaced to the reviewer, never a reject. */
  injectionFlags: readonly string[];
};

export type ValidationContext = {
  /** Exactly the labels we sent, and what each one really points at. */
  issued: readonly IssuedSource[];
  /** Injected, so this function has no clock and a test can pin the spec it produces. */
  now: Date;
  minCloseHours: number;
  maxCloseHours: number;
};

export type ValidationResult =
  | {
      ok: true;
      spec: MarketSpec;
      specHash: string;
      /** The article the reviewer will be asked to check the outcome against. */
      resolutionSource: IssuedSource;
      /** Shown in the review checklist. Never blocks approval. */
      warnings: string[];
    }
  | { ok: false; reasons: string[] };

/** Unix seconds. The unit the contract stores, so the conversion happens once, here. */
function unixSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

function firstWord(text: string): string {
  return (/^[A-Za-z']+/.exec(text.trim())?.[0] ?? "").toLowerCase();
}

/** Vague terms, matched on word boundaries so "many" does not fire inside "Germany". */
function vagueTermsIn(text: string): string[] {
  const lower = ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, " ")} `;
  return VAGUE_TERMS.filter((term) => lower.includes(` ${term} `));
}

/**
 * Four-digit years appearing as standalone words.
 *
 * Only years are extracted, not dates: a stale *year* is the failure that actually happened —
 * the first live run produced "by 12:00 PM EST on November 20, 2024" for a market closing the
 * next day — and it is the one a cheap check catches without guessing at date grammar. A future
 * year is left alone, because "Will parliament approve the 2027 budget by Friday?" is a
 * perfectly resolvable market.
 */
function yearsIn(text: string): number[] {
  const found = text.match(/\b(19|20)\d{2}\b/g) ?? [];
  return [...new Set(found.map(Number))];
}

/**
 * Turns a schema-valid draft into either a hashed, chain-ready spec or a list of reasons.
 *
 * Collects **every** failing rule rather than returning on the first: the rejection row is
 * evidence, and "this draft broke three rules" is more useful to a reader than the first one
 * the loop happened to reach.
 */
export function validateDraft(draft: Draft, context: ValidationContext): ValidationResult {
  const reasons: string[] = [];
  const warnings: string[] = [];

  // 1 — the label must be one we issued.
  const resolutionSource = context.issued.find(
    (source) => source.label === draft.resolutionSourceLabel,
  );
  if (resolutionSource === undefined) {
    reasons.push(
      `resolutionSourceLabel "${draft.resolutionSourceLabel}" was never issued ` +
        `(issued: ${context.issued.map((s) => s.label).join(", ") || "none"})`,
    );
  }

  // 2 — the question must be binary and answerable.
  const question = draft.question.trim();
  if (!question.endsWith("?")) {
    reasons.push("question does not end in a question mark, so it is not a question");
  }
  const opener = firstWord(question);
  if (!BINARY_OPENERS.includes(opener as (typeof BINARY_OPENERS)[number])) {
    reasons.push(
      `question opens with "${opener || "(nothing)"}", which does not admit a yes/no answer ` +
        `(expected one of: ${BINARY_OPENERS.join(", ")})`,
    );
  }

  // 3 — vague quantifiers make a market unresolvable.
  const vagueInQuestion = vagueTermsIn(question);
  if (vagueInQuestion.length > 0) {
    reasons.push(
      `question contains unresolvable term(s): ${vagueInQuestion.join(", ")} — ` +
        `no source settles them, so the market could not be resolved honestly`,
    );
  }
  const vagueInCriteria = vagueTermsIn(draft.resolutionCriteria);
  if (vagueInCriteria.length > 0) {
    reasons.push(
      `resolutionCriteria contains unresolvable term(s): ${vagueInCriteria.join(", ")}`,
    );
  }

  // 4 — the model's own output is untrusted text and is scanned as such.
  const modelFlags = scanForInjection(question, draft.resolutionCriteria);
  if (modelFlags.length > 0) {
    reasons.push(
      `model output tripped injection signature(s): ${modelFlags.join(", ")} — ` +
        `an instruction from a source article was echoed into the spec`,
    );
  }

  // 5 — the betting horizon must be inside the bounds we set, not the ones the model prefers.
  if (draft.closeInHours < context.minCloseHours || draft.closeInHours > context.maxCloseHours) {
    reasons.push(
      `closeInHours ${draft.closeInHours} is outside the permitted ` +
        `${context.minCloseHours}–${context.maxCloseHours} hour window`,
    );
  }

  // 6 — the question may not carry a deadline that has already passed.
  const closeYear = new Date(context.now.getTime() + draft.closeInHours * 3_600_000).getUTCFullYear();
  const staleYears = yearsIn(question).filter((year) => year < closeYear);
  if (staleYears.length > 0) {
    reasons.push(
      `question refers to ${staleYears.join(", ")}, which ended before this market closes ` +
        `(${closeYear}) — a market resolving within days cannot hinge on a date already past`,
    );
  }

  if (reasons.length > 0 || resolutionSource === undefined) {
    return { ok: false, reasons };
  }

  // --- Warnings: things a human should see and decide about. --------------------------------

  if (draft.ambiguityRisk !== "LOW") {
    warnings.push(
      `the proposer rated its own question ${draft.ambiguityRisk} risk: ${draft.ambiguityNote}`,
    );
  }
  if (resolutionSource.injectionFlags.length > 0) {
    warnings.push(
      `the chosen resolution source carries injection signature(s): ` +
        `${resolutionSource.injectionFlags.join(", ")}`,
    );
  }
  if (!resolutionSource.directLink) {
    warnings.push(
      `the resolution source is ${resolutionSource.domain}'s front page, not the article — ` +
        `the feed supplied an aggregator redirect, which is not stable enough to put on chain`,
    );
  }

  const closeTime = unixSeconds(context.now) + draft.closeInHours * 3600;

  const spec: MarketSpec = {
    question,
    resolutionSourceUrl: resolutionSource.resolutionUrl,
    closeTime,
    resolveDeadline: closeTime + RESOLVE_GRACE_HOURS * 3600,
    resolutionCriteria: draft.resolutionCriteria.trim(),
    category: draft.category,
  };

  return { ok: true, spec, specHash: computeSpecHash(spec), resolutionSource, warnings };
}

/** Exposed so the review page can show the reviewer exactly which rules a draft had to pass. */
export const VALIDATION_RULES: readonly string[] = [
  "the resolution source is one of the articles we supplied — the model never types a URL",
  "the question ends in a question mark and opens with a word that admits yes/no",
  "the question and criteria contain no unresolvable term (significantly, likely, major, …)",
  "the model's own output is scanned for prompt-injection signatures",
  "the betting horizon is inside the window this deployment permits",
  "the question names no year that ended before the market closes",
];

export { BINARY_OPENERS, VAGUE_TERMS };
