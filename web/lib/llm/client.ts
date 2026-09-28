/**
 * LLM policy: budgets, model fallback, validation, and the fail-safe contract.
 *
 * ## The contract
 *
 * **`callJson` never throws and never returns unvalidated data.** It returns a discriminated
 * union: either `{ ok: true, value }` where `value` has passed a Zod schema, or
 * `{ ok: false, reason }`. Callers cannot accidentally use a failure as a success, and there
 * is no `catch` block at a call site deciding what a rate limit means.
 *
 * This is hard rule #6 made mechanical. A 429 must never crash a tick or half-write a record,
 * and the way to guarantee that is to make "no answer" an ordinary value that the type system
 * forces every caller to handle — not an exception that some caller will eventually forget to
 * catch.
 *
 * ## Double validation, and why the Zod pass is not redundant
 *
 * Hard rule #4 requires structured output enforced at the API **and** re-validated with Zod.
 * The API-side `responseSchema` is a request, not a guarantee: a model can hit its output
 * token cap mid-object, and the API will hand back truncated-but-parseable JSON. It can also
 * return a schema-shaped object whose *values* are nonsense — an id we never sent, a
 * confidence of 4.2. The API schema cannot check any of that. Zod can, and does, before a
 * single field is read.
 */

import type { ZodType } from "zod";
import { LlmFailure, generateJson, isConfigured, type GenerateJsonRequest, type LlmFailureKind } from "./gemini";

/**
 * A per-tick call allowance.
 *
 * Bounded work is the whole reason the pipeline is a state machine: a tick does a fixed
 * amount and returns, so a backlog costs more ticks rather than one runaway invocation. The
 * budget is passed in, never read from a module global, so a test can set it to 1 and assert
 * the second call is refused without touching the environment.
 */
export class LlmBudget {
  private used = 0;
  private readonly log: LlmCallLog[] = [];

  constructor(readonly maxCalls: number) {}

  get remaining(): number {
    return Math.max(0, this.maxCalls - this.used);
  }

  get spent(): number {
    return this.used;
  }

  /** Records an attempt. Returns false when the allowance is already exhausted. */
  consume(): boolean {
    if (this.used >= this.maxCalls) return false;
    this.used += 1;
    return true;
  }

  record(entry: LlmCallLog): void {
    this.log.push(entry);
  }

  /** Every attempt this tick made, for the tick report and `/audit`. */
  entries(): readonly LlmCallLog[] {
    return this.log;
  }
}

export type LlmCallLog = {
  purpose: string;
  model: string | null;
  ok: boolean;
  reason: LlmFailureKind | "BUDGET_EXHAUSTED" | "SCHEMA_REJECTED" | null;
  durationMs: number;
  promptTokens: number | null;
  outputTokens: number | null;
};

export type LlmResult<T> =
  | { ok: true; value: T; model: string }
  | {
      ok: false;
      reason: LlmFailureKind | "BUDGET_EXHAUSTED" | "SCHEMA_REJECTED";
      detail: string;
      /**
       * The model's verbatim text, when there was any.
       *
       * Set only for `SCHEMA_REJECTED` — the one failure where the response body is evidence
       * rather than noise. Phase 4 stores it on the rejected proposal, so "the gate rejected
       * this" can be read alongside what was actually rejected. Every other failure kind has
       * no body worth keeping, and a transport error's message is already in `detail`.
       */
      raw?: string | null;
    };

/** Injectable transport so tests can force a 429 without a network or an API key. */
export type Transport = typeof generateJson;

export type CallOptions<T> = {
  /** Short stable name for logs, e.g. "cluster-adjudication". */
  purpose: string;
  budget: LlmBudget;
  models: readonly string[];
  request: GenerateJsonRequest;
  /** Re-validation of whatever the API returned. Non-negotiable — see the note above. */
  schema: ZodType<T>;
  transport?: Transport;
};

/**
 * Calls the first model that answers, validates, and returns.
 *
 * Model fallback is *not* a retry loop. Each model is tried at most once, and only for
 * failures where a different model could plausibly help (`worthTryingNextModel`). A billing or
 * auth failure stops immediately — every model would answer identically, and burning the
 * tick's remaining seconds proving that is worse than reporting it.
 *
 * Every attempt consumes budget, including one that fails. Otherwise a model returning 429
 * forever would be free, and "bounded calls per tick" would bound only the successes.
 */
export async function callJson<T>(options: CallOptions<T>): Promise<LlmResult<T>> {
  const { purpose, budget, models, request, schema } = options;
  const transport = options.transport ?? generateJson;

  if (!isConfigured()) {
    budget.record({
      purpose, model: null, ok: false, reason: "NOT_CONFIGURED",
      durationMs: 0, promptTokens: null, outputTokens: null,
    });
    return { ok: false, reason: "NOT_CONFIGURED", detail: "GEMINI_API_KEY is not set" };
  }

  let lastReason: LlmFailureKind | "SCHEMA_REJECTED" = "NETWORK";
  let lastDetail = "no model was attempted";
  let lastRaw: string | null = null;

  for (const model of models) {
    if (!budget.consume()) {
      budget.record({
        purpose, model, ok: false, reason: "BUDGET_EXHAUSTED",
        durationMs: 0, promptTokens: null, outputTokens: null,
      });
      return {
        ok: false,
        reason: "BUDGET_EXHAUSTED",
        detail: `per-tick LLM budget of ${budget.maxCalls} calls is spent`,
      };
    }

    const attemptStartedAt = Date.now();

    try {
      const result = await transport(model, request);
      const parsed = schema.safeParse(result.json);

      if (!parsed.success) {
        // A schema-shaped response whose values are wrong. Kept as a distinct outcome because
        // these rows are the evidence that the validation gate is real — Phase 4 stores them.
        lastReason = "SCHEMA_REJECTED";
        lastDetail = parsed.error.message.slice(0, 300);
        lastRaw = result.rawText.slice(0, 4000);
        budget.record({
          purpose, model, ok: false, reason: "SCHEMA_REJECTED",
          durationMs: result.durationMs, promptTokens: result.promptTokens,
          outputTokens: result.outputTokens,
        });
        continue;
      }

      budget.record({
        purpose, model, ok: true, reason: null,
        durationMs: result.durationMs, promptTokens: result.promptTokens,
        outputTokens: result.outputTokens,
      });
      return { ok: true, value: parsed.data, model };
    } catch (error) {
      const failure =
        error instanceof LlmFailure
          ? error
          : new LlmFailure("NETWORK", error instanceof Error ? error.message : String(error), model);

      lastReason = failure.kind;
      lastDetail = failure.message;
      lastRaw = null;
      // Measured, not zero. An earlier version recorded 0ms here, which made a 35-second
      // timeout invisible in the tick report — the single most expensive thing a tick can do
      // looked free, and the fix was delayed because nothing showed the cost.
      budget.record({
        purpose, model, ok: false, reason: failure.kind,
        durationMs: Date.now() - attemptStartedAt,
        promptTokens: null, outputTokens: null,
      });

      if (!failure.worthTryingNextModel) break;
    }
  }

  return { ok: false, reason: lastReason, detail: lastDetail, raw: lastRaw };
}
