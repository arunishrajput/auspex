/**
 * Borderline-pair adjudication — the only place an LLM influences Phase 3 at all.
 *
 * Deterministic code has already decided everything outside the 0.4–0.6 band. What reaches
 * this module is a bounded list of pairs that scored inside it, and the most a model can do is
 * merge two articles that our own similarity measure already judged plausibly the same story.
 * It cannot introduce a pair, cannot split a pair that scored ≥ 0.6, and cannot write to the
 * database — `planClusters` consumes its verdicts and produces the grouping.
 *
 * Every failure path returns *no verdicts*, which `cluster.ts` treats as "do not merge"
 * (ADR-030). A rate limit, a billing failure, a malformed response and an unparseable label
 * all converge on the same safe outcome, and none of them throws.
 */

import { z } from "zod";
import { callJson, type LlmBudget } from "../llm/client";
import { fastModelChain, type ResponseSchema } from "../llm/gemini";
import { buildUserMessage } from "../llm/prompt";
import type { BorderlinePair, PairKey } from "./cluster";

/** Pairs sent to the model in one call. Keeps each prompt small and each failure cheap. */
const PAIRS_PER_CALL = 8;

/**
 * Trusted operator text. No feed content ever reaches this string — see `prompt.ts`.
 *
 * The instruction deliberately asks for a *narrow* judgement ("the same real-world event"),
 * not an interesting one. Two articles about the same company on the same day are not the same
 * event, and a model given latitude here will merge them.
 */
const SYSTEM_INSTRUCTION = [
  "You are a news deduplication assistant for a prediction-market pipeline.",
  "",
  "For each labelled pair of articles, decide whether both report THE SAME specific",
  "real-world event — the same occurrence, the same day, the same actors.",
  "",
  "Answer false when the articles merely share a topic, an organisation, a country or a",
  "theme. Two separate announcements by one company are different events. Analysis of an",
  "event and the event itself are different events. When genuinely uncertain, answer false.",
  "",
  "Return one verdict per pair label you were given, and invent no other labels.",
].join("\n");

/** The OpenAPI-subset schema enforced at the API. Zod re-checks the result independently. */
const RESPONSE_SCHEMA: ResponseSchema = {
  type: "OBJECT",
  properties: {
    verdicts: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          pairLabel: { type: "STRING", description: "Exactly one of the labels supplied." },
          sameEvent: { type: "BOOLEAN" },
          reason: { type: "STRING", description: "One short sentence." },
        },
        required: ["pairLabel", "sameEvent", "reason"],
      },
    },
  },
  required: ["verdicts"],
};

const VerdictsSchema = z.object({
  verdicts: z
    .array(
      z.object({
        pairLabel: z.string().min(1).max(32),
        sameEvent: z.boolean(),
        reason: z.string().max(400),
      }),
    )
    .max(PAIRS_PER_CALL * 2),
});

/**
 * What the adjudicator needs to know about one raw item.
 *
 * `independenceGroup` is carried only to *prioritise* pairs, never to judge them — see
 * `rankPairs`.
 */
export type ItemText = {
  title: string;
  summary: string | null;
  independenceGroup: string;
};

/**
 * Orders borderline pairs by how much adjudicating them could matter.
 *
 * Cross-publisher pairs come first, then by similarity. The reason is specific: confirmation
 * counts *distinct independence groups*, so merging two articles from the same publisher can
 * never produce the second source that `CONFIRMED` requires — it can only tidy the display.
 * Spending a scarce LLM call on one while a cross-publisher pair goes unasked is spending the
 * budget on the only outcome that provably cannot change anything.
 *
 * Exported for the test that pins the ordering.
 */
export function rankPairs(
  pairs: readonly BorderlinePair[],
  texts: ReadonlyMap<string, ItemText>,
): BorderlinePair[] {
  const crossPublisher = (pair: BorderlinePair): boolean => {
    const a = texts.get(pair.aId);
    const b = texts.get(pair.bId);
    if (a === undefined || b === undefined) return false;
    return a.independenceGroup !== b.independenceGroup;
  };

  return [...pairs].sort((x, y) => {
    const crossX = crossPublisher(x);
    const crossY = crossPublisher(y);
    if (crossX !== crossY) return crossX ? -1 : 1;
    if (y.similarity !== x.similarity) return y.similarity - x.similarity;
    // Total order, so a re-run asks the same questions in the same sequence.
    return x.key < y.key ? -1 : x.key > y.key ? 1 : 0;
  });
}

export type AdjudicationOutcome = {
  /** Pair key → the model's verdict. Only labels we actually sent appear here. */
  verdicts: Map<PairKey, boolean>;
  /** Human-readable trail for `/audit` and the dashboard. */
  notes: { pairKey: PairKey; sameEvent: boolean; reason: string; model: string }[];
  /** Why adjudication stopped early, when it did. Null means every batch was attempted. */
  haltedBecause: string | null;
};

function describe(item: ItemText): string {
  const summary = item.summary === null ? "" : `\n${item.summary}`;
  // Truncated so one very long article cannot consume the whole prompt budget.
  return `${item.title}${summary}`.slice(0, 900);
}

/**
 * Adjudicates as many borderline pairs as the budget allows.
 *
 * Pairs are ranked by `rankPairs`, so when the budget runs out the questions that went unasked
 * are the ones least able to change a confirmation. Anything not adjudicated stays unmerged.
 */
export async function adjudicateBorderlinePairs(
  pairs: readonly BorderlinePair[],
  texts: ReadonlyMap<string, ItemText>,
  budget: LlmBudget,
): Promise<AdjudicationOutcome> {
  const outcome: AdjudicationOutcome = {
    verdicts: new Map(),
    notes: [],
    haltedBecause: null,
  };

  if (pairs.length === 0) return outcome;

  const ordered = rankPairs(pairs, texts);
  const models = fastModelChain();

  for (let offset = 0; offset < ordered.length; offset += PAIRS_PER_CALL) {
    if (budget.remaining === 0) {
      outcome.haltedBecause = `LLM budget spent after ${offset} of ${ordered.length} pairs`;
      break;
    }

    const batch = ordered.slice(offset, offset + PAIRS_PER_CALL);

    // Labels are ours, never derived from feed content, so a verdict referring to PAIR_3
    // cannot itself have been influenced by what an article says.
    const labelled = batch.map((pair, index) => ({ label: `PAIR_${index + 1}`, pair }));
    const byLabel = new Map(labelled.map(({ label, pair }) => [label, pair]));

    const blocks = labelled.flatMap(({ label, pair }) => {
      const a = texts.get(pair.aId);
      const b = texts.get(pair.bId);
      if (a === undefined || b === undefined) return [];
      return [
        { label: `${label}_ARTICLE_1`, text: describe(a) },
        { label: `${label}_ARTICLE_2`, text: describe(b) },
      ];
    });

    if (blocks.length === 0) continue;

    const instruction =
      `Decide, for each of these ${labelled.length} pairs, whether the two articles report ` +
      `the same specific real-world event. The labels are ${labelled.map((l) => l.label).join(", ")}.`;

    const result = await callJson({
      purpose: "cluster-adjudication",
      budget,
      models,
      schema: VerdictsSchema,
      request: {
        systemInstruction: SYSTEM_INSTRUCTION,
        userMessage: buildUserMessage(instruction, blocks),
        responseSchema: RESPONSE_SCHEMA,
        maxOutputTokens: 1200,
      },
    });

    if (!result.ok) {
      // No verdicts recorded => nothing merges => the safe direction. Reported, not thrown.
      outcome.haltedBecause = `${result.reason}: ${result.detail}`;
      break;
    }

    for (const verdict of result.value.verdicts) {
      const pair = byLabel.get(verdict.pairLabel);
      // A label we never sent is discarded. This is the check the API-side schema cannot make:
      // `pairLabel` is a well-typed string there, and still meaningless.
      if (pair === undefined) continue;
      if (outcome.verdicts.has(pair.key)) continue;

      outcome.verdicts.set(pair.key, verdict.sameEvent);
      outcome.notes.push({
        pairKey: pair.key,
        sameEvent: verdict.sameEvent,
        reason: verdict.reason,
        model: result.model,
      });
    }
  }

  return outcome;
}
