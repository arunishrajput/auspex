/**
 * What the resolution agent is allowed to say. **Pure — no I/O.**
 *
 * This is `proposer/schema.ts` applied to the more dangerous half of the lifecycle. The proposer
 * writes a question; this writes the answer that decides who is paid. So the constraints are the
 * same in kind and tighter in degree:
 *
 * **It cannot emit a URL.** The evidence URL goes on-chain and is the thing a human — and later a
 * judge — clicks. A model that can type a destination can type one that does not exist, or one
 * that does and is hostile. It picks an `EVIDENCE_n` label from the articles we supplied and
 * deterministic code substitutes the real URL (`validate.ts`).
 *
 * **It cannot emit `UNRESOLVED`.** That is the contract's "no outcome yet" value and
 * `proposeResolution` reverts on it. A model that wants to say "not settled yet" says
 * `UNSETTLED`, which is a value the *contract has never heard of* — it stops the pipeline
 * off-chain and produces no transaction at all. Keeping those two ideas as different words is
 * what stops "I don't know" from being encoded as an outcome.
 *
 * **It must quote the sentence it is relying on.** `settledByQuote` exists so the human resolver
 * has something specific to check rather than a summary to agree with. A quote that is not in
 * the evidence is the reviewer's cue that the model is confabulating, and it costs one Ctrl-F
 * to find out.
 *
 * What it is deliberately *not* asked for: a confidence score. In Phase 5 `confidence` was the
 * agent's own number and the threshold had to be policy (ADR-041). Here there is no threshold to
 * set — a human reads every draft — so a self-assessment would be decoration that invites being
 * read as a gate. The model's uncertainty belongs in `rationale`, in words, where a human has to
 * actually read it.
 */

import { z } from "zod";
import type { ResponseSchema } from "../llm/gemini";

/**
 * Outcomes the model may return.
 *
 * The first three are the contract's `OUTCOME_YES`, `OUTCOME_NO` and `OUTCOME_INVALID`.
 * `UNSETTLED` is ours and never reaches the chain — see the header.
 */
export const DRAFT_OUTCOMES = ["YES", "NO", "INVALID", "UNSETTLED"] as const;

export type DraftOutcomeValue = (typeof DRAFT_OUTCOMES)[number];

/** The subset `proposeResolution` will accept, mapped to the contract's uint8. */
export const ONCHAIN_OUTCOME_VALUE: Record<"YES" | "NO" | "INVALID", number> = {
  YES: 1,
  NO: 2,
  INVALID: 3,
};

export function isOnChainOutcome(
  outcome: DraftOutcomeValue,
): outcome is "YES" | "NO" | "INVALID" {
  return outcome === "YES" || outcome === "NO" || outcome === "INVALID";
}

export const ResolutionDraftSchema = z.object({
  outcome: z.enum(DRAFT_OUTCOMES),
  /**
   * One of the `EVIDENCE_n` labels we issued, or the empty string when `UNSETTLED`.
   *
   * Empty is allowed here and rejected in `validate.ts` for every settled outcome, because "no
   * evidence" is a coherent answer only alongside "not settled yet".
   */
  evidenceLabel: z.string().max(32),
  /** The sentence the model says settles it. Empty only when `UNSETTLED`. */
  settledByQuote: z.string().max(400),
  rationale: z.string().min(20).max(600),
});

export type ResolutionDraftFields = z.infer<typeof ResolutionDraftSchema>;

export const RESOLUTION_RESPONSE_SCHEMA: ResponseSchema = {
  type: "OBJECT",
  properties: {
    outcome: {
      type: "STRING",
      enum: [...DRAFT_OUTCOMES],
      description:
        "YES or NO if the evidence settles the question. INVALID if the question cannot be " +
        "settled as written. UNSETTLED if the answer is simply not known yet.",
    },
    evidenceLabel: {
      type: "STRING",
      description:
        "Exactly one of the EVIDENCE_n labels supplied. Empty string only when outcome is " +
        "UNSETTLED. Never a URL.",
    },
    settledByQuote: {
      type: "STRING",
      description:
        "The exact sentence from that evidence which settles the question, copied verbatim. " +
        "Empty string only when outcome is UNSETTLED.",
    },
    rationale: {
      type: "STRING",
      description:
        "Why that sentence settles the question the way you say, and what you are unsure about.",
    },
  },
  required: ["outcome", "evidenceLabel", "settledByQuote", "rationale"],
};
