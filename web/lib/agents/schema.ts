/**
 * What a member agent is allowed to say. **Pure — no I/O.**
 *
 * The same two-schema discipline as `lib/proposer/schema.ts`: `BET_RESPONSE_SCHEMA` constrains
 * generation at the API, `BetProposalSchema` re-checks the result here. Hard rule #4 requires
 * both, and they do different jobs — the API schema cannot tell a truncated object from a
 * complete one, and it cannot tell a source label we issued from one the model invented.
 *
 * ## The field this file exists to *not* have
 *
 * There is no `stakeWei`, and no `stakeMstc`. The model emits **`stakeFraction`**, a number in
 * [0, 1] meaning "this share of my own per-transaction cap", and deterministic code multiplies
 * it out. That is the same move Phase 4 made with `closeInHours` instead of an absolute
 * timestamp (ADR-035), applied where the consequence is money instead of a deadline:
 *
 *   - a model that can type an amount can type `1e30`, or `100000000000000000000` with one
 *     digit too many, and the only thing between that and a transaction is a `Math.min` some
 *     future refactor might move;
 *   - a fraction is *unconditionally* bounded by construction. The worst possible output,
 *     `1.0`, is the agent's own cap — a number a human already approved as its policy — and
 *     the policy gate then clamps that against four more limits anyway.
 *
 * The model also cannot say *which market* it is betting on, or *when*: it is handed one market
 * per call and the caller knows which. Nothing it returns selects a target.
 *
 * ## ABSTAIN is a first-class answer, not a failure
 *
 * `side` includes `ABSTAIN` so "I do not know" has somewhere to go. Without it, a model with no
 * view is pushed to invent one at low confidence, and the confidence threshold then becomes the
 * only thing standing between a guess and a bet. An agent that abstains is rejected by the gate
 * with a reason, logged, and shown — which is the honest outcome and a useful one to display.
 */

import { z } from "zod";
import type { ResponseSchema } from "../llm/gemini";

/**
 * The agent's answer about one market.
 *
 * Every bound is also a rejection path: a `confidence` of 4.2 or a `stakeFraction` of 12 fails
 * here and becomes a recorded decision, not a bet.
 */
export const BetProposalSchema = z.object({
  side: z.enum(["YES", "NO", "ABSTAIN"]),
  /** The agent's own view of how sure it is. Compared against policy — never *set* by it. */
  confidence: z.number().min(0).max(1),
  /** Share of this agent's per-transaction cap. Deterministic code turns it into wei. */
  stakeFraction: z.number().min(0).max(1),
  rationale: z.string().min(20).max(400),
  /** `SOURCE_n` labels we issued. A label we did not issue rejects the proposal. */
  sourceLabels: z.array(z.string().min(1).max(32)).max(8),
});

export type BetProposal = z.infer<typeof BetProposalSchema>;

export const BET_RESPONSE_SCHEMA: ResponseSchema = {
  type: "OBJECT",
  properties: {
    side: {
      type: "STRING",
      enum: ["YES", "NO", "ABSTAIN"],
      description: "YES if the question resolves yes, NO if no, ABSTAIN if the evidence does not support either.",
    },
    confidence: {
      type: "NUMBER",
      description: "0 to 1. How sure you are in the side you chose. Use ABSTAIN rather than a low number you do not mean.",
    },
    stakeFraction: {
      type: "NUMBER",
      description:
        "0 to 1. The share of your per-transaction limit to stake. You do not know the limit in absolute terms and do not need to.",
    },
    rationale: {
      type: "STRING",
      description: "20-400 characters. The specific evidence for this side, citing the SOURCE_n labels you used.",
    },
    sourceLabels: {
      type: "ARRAY",
      items: { type: "STRING" },
      description: "The SOURCE_n labels your rationale relies on. Only labels supplied to you.",
    },
  },
  required: ["side", "confidence", "stakeFraction", "rationale", "sourceLabels"],
};
