/**
 * What the proposer agent is allowed to say. **Pure — no I/O.**
 *
 * Two schemas describe the same object: `DRAFT_RESPONSE_SCHEMA` is sent to the API so the
 * model is constrained at generation time, and `DraftSchema` re-checks the result here. Hard
 * rule #4 requires both, and they are not redundant — the API schema cannot tell a truncated
 * object from a complete one, and it cannot tell a string that is a label we issued from a
 * string that is a label the model invented.
 *
 * ## What the model is deliberately NOT allowed to emit
 *
 * **A URL.** The resolution source is chosen by *label* from the articles we supplied, and
 * deterministic code substitutes the real URL afterwards. A model that can type a destination
 * can type one that does not exist, or one that exists and is hostile; a model that can only
 * pick from a menu can do neither. This is the same mechanism `news/adjudicate.ts` uses for
 * `pairLabel`, applied where it matters more, because this value is written to the chain.
 *
 * **An absolute time.** It emits a horizon in hours, bounded here, and deterministic code turns
 * that into `closeTime` and `resolveDeadline`. The contract compares those against
 * `block.timestamp`; a model picking a unix second is a model picking a number the chain will
 * either reject or, worse, accept wrongly.
 */

import { z } from "zod";
import type { ResponseSchema } from "../llm/gemini";
import { optionalEnv } from "../env";

/**
 * Market categories. Fixed, because Phase 5's policy gate allowlists categories per member —
 * a free-text category would mean an agent's allowlist could be bypassed by a new spelling.
 */
export const MARKET_CATEGORIES = [
  "POLITICS",
  "ECONOMY",
  "BUSINESS",
  "TECHNOLOGY",
  "SCIENCE",
  "SPORT",
  "WORLD",
] as const;

export type MarketCategory = (typeof MARKET_CATEGORIES)[number];

/** How long after `closeTime` a resolver has to propose an outcome. */
export const RESOLVE_GRACE_HOURS = 24;

/** Hard bounds on the betting horizon, tunable without a deploy for a demo schedule. */
export function closeHourBounds(): { min: number; max: number } {
  const min = positiveInt(optionalEnv("MARKET_MIN_CLOSE_HOURS"), 2);
  const max = positiveInt(optionalEnv("MARKET_MAX_CLOSE_HOURS"), 72);
  return max >= min ? { min, max } : { min, max: min };
}

function positiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : fallback;
}

/**
 * The exact shape one drafted market takes on the wire.
 *
 * Every bound here is also a rejection path we want to see exercised: a model that writes a
 * 400-character question fails at `.max(180)` and the row is stored as `SCHEMA_REJECTED` with
 * Zod's own message, rather than putting an unreadable question on chain.
 */
export const DraftSchema = z.object({
  question: z.string().min(20).max(180),
  /** One of the `SOURCE_n` labels we issued. Checked against the issued set in `validate.ts`. */
  resolutionSourceLabel: z.string().min(1).max(32),
  resolutionCriteria: z.string().min(20).max(300),
  category: z.enum(MARKET_CATEGORIES),
  closeInHours: z.number().int().min(1).max(24 * 14),
  /** The model's own view of how ambiguous its question is. Advisory — see `validate.ts`. */
  ambiguityRisk: z.enum(["LOW", "MEDIUM", "HIGH"]),
  ambiguityNote: z.string().max(300),
});

export type Draft = z.infer<typeof DraftSchema>;

export const DRAFT_RESPONSE_SCHEMA: ResponseSchema = {
  type: "OBJECT",
  properties: {
    question: {
      type: "STRING",
      description: "A yes/no question, 20-180 characters, ending in a question mark.",
    },
    resolutionSourceLabel: {
      type: "STRING",
      description: "Exactly one of the SOURCE_n labels supplied. Invent no others.",
    },
    resolutionCriteria: {
      type: "STRING",
      description: "The exact fact to check at that source to settle YES or NO.",
    },
    category: { type: "STRING", enum: [...MARKET_CATEGORIES] },
    closeInHours: {
      type: "INTEGER",
      description: "Hours from now that betting should close.",
    },
    ambiguityRisk: { type: "STRING", enum: ["LOW", "MEDIUM", "HIGH"] },
    ambiguityNote: {
      type: "STRING",
      description: "One sentence on what could make this question hard to settle.",
    },
  },
  required: [
    "question",
    "resolutionSourceLabel",
    "resolutionCriteria",
    "category",
    "closeInHours",
    "ambiguityRisk",
    "ambiguityNote",
  ],
};
