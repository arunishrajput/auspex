import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { LlmBudget, callJson, type Transport } from "./client";
import { LlmFailure, type GenerateJsonRequest, type ResponseSchema } from "./gemini";

/**
 * The fail-safe contract, which is the whole reason this layer exists.
 *
 * Hard rule #6: a 429 must never crash a tick or half-write a record. These tests force every
 * failure the API can produce — including the ones that are hard to induce on demand against
 * the live service — and assert that each one comes back as an ordinary value the caller is
 * obliged to handle, with the budget accounted for correctly.
 *
 * The transport is injected, so none of this touches the network.
 */

const SCHEMA = z.object({ verdict: z.boolean(), score: z.number().min(0).max(1) });

const RESPONSE_SCHEMA: ResponseSchema = {
  type: "OBJECT",
  properties: { verdict: { type: "BOOLEAN" }, score: { type: "NUMBER" } },
  required: ["verdict", "score"],
};

const REQUEST: GenerateJsonRequest = {
  systemInstruction: "You are a test.",
  userMessage: "Answer.",
  responseSchema: RESPONSE_SCHEMA,
};

type CountingTransport = Transport & { calls: () => number };

/** A transport that returns a fixed payload and counts how often it was called. */
function stubTransport(payload: unknown): CountingTransport {
  let calls = 0;
  const transport: Transport = async (model) => {
    calls += 1;
    return {
      model,
      json: payload,
      rawText: JSON.stringify(payload),
      promptTokens: 10,
      outputTokens: 5,
      durationMs: 1,
    };
  };
  return Object.assign(transport, { calls: () => calls });
}

/** A transport that always fails with a given kind. */
function failingTransport(kind: ConstructorParameters<typeof LlmFailure>[0]): CountingTransport {
  let calls = 0;
  const transport: Transport = async (model) => {
    calls += 1;
    throw new LlmFailure(kind, `forced ${kind}`, model);
  };
  return Object.assign(transport, { calls: () => calls });
}

const ORIGINAL_KEY = process.env.GEMINI_API_KEY;

beforeEach(() => {
  // Explicit rather than inherited from .env.local, so the suite behaves identically in CI,
  // where there is no key, and locally, where there is one.
  process.env.GEMINI_API_KEY = "test-key-not-a-real-credential";
});

afterEach(() => {
  if (ORIGINAL_KEY === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = ORIGINAL_KEY;
});

describe("callJson — success", () => {
  it("returns a validated value and names the model that answered", async () => {
    const budget = new LlmBudget(4);
    const result = await callJson({
      purpose: "test",
      budget,
      models: ["model-a"],
      schema: SCHEMA,
      request: REQUEST,
      transport: stubTransport({ verdict: true, score: 0.5 }),
    });

    expect(result).toEqual({ ok: true, value: { verdict: true, score: 0.5 }, model: "model-a" });
    expect(budget.spent).toBe(1);
  });

  it("logs the successful call with its token usage", async () => {
    const budget = new LlmBudget(4);
    await callJson({
      purpose: "cluster-adjudication",
      budget,
      models: ["model-a"],
      schema: SCHEMA,
      request: REQUEST,
      transport: stubTransport({ verdict: false, score: 0 }),
    });

    expect(budget.entries()).toEqual([
      {
        purpose: "cluster-adjudication",
        model: "model-a",
        ok: true,
        reason: null,
        durationMs: 1,
        promptTokens: 10,
        outputTokens: 5,
      },
    ]);
  });
});

describe("callJson — the budget is a hard bound", () => {
  it("refuses once the allowance is spent, without calling the transport", async () => {
    const budget = new LlmBudget(2);
    const transport = stubTransport({ verdict: true, score: 1 });
    const call = () =>
      callJson({
        purpose: "test",
        budget,
        models: ["model-a"],
        schema: SCHEMA,
        request: REQUEST,
        transport,
      });

    expect((await call()).ok).toBe(true);
    expect((await call()).ok).toBe(true);

    const third = await call();
    expect(third).toEqual({
      ok: false,
      reason: "BUDGET_EXHAUSTED",
      detail: "per-tick LLM budget of 2 calls is spent",
    });
    // The bound is on attempts, so the transport was never reached a third time.
    expect(transport.calls()).toBe(2);
  });

  it("charges failed attempts against the budget too", async () => {
    // Otherwise a model that 429s forever would be free, and "bounded calls per tick" would
    // bound only the successes — the opposite of what the bound is for.
    const budget = new LlmBudget(3);
    await callJson({
      purpose: "test",
      budget,
      models: ["a", "b", "c"],
      schema: SCHEMA,
      request: REQUEST,
      transport: failingTransport("RATE_LIMITED"),
    });
    expect(budget.spent).toBe(3);
    expect(budget.remaining).toBe(0);
  });

  it("a zero budget makes no calls at all", async () => {
    const budget = new LlmBudget(0);
    const transport = stubTransport({ verdict: true, score: 1 });
    const result = await callJson({
      purpose: "test",
      budget,
      models: ["model-a"],
      schema: SCHEMA,
      request: REQUEST,
      transport,
    });
    expect(result.ok).toBe(false);
    expect(transport.calls()).toBe(0);
  });
});

describe("callJson — a forced 429 leaves state consistent", () => {
  it("returns a failure value rather than throwing", async () => {
    const budget = new LlmBudget(4);
    const result = await callJson({
      purpose: "test",
      budget,
      models: ["model-a"],
      schema: SCHEMA,
      request: REQUEST,
      transport: failingTransport("RATE_LIMITED"),
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("RATE_LIMITED");
    expect(result.detail).toContain("forced RATE_LIMITED");
  });

  it("records the failure in the call log with its reason", async () => {
    const budget = new LlmBudget(4);
    await callJson({
      purpose: "test",
      budget,
      models: ["model-a"],
      schema: SCHEMA,
      request: REQUEST,
      transport: failingTransport("RATE_LIMITED"),
    });

    expect(budget.entries()).toHaveLength(1);
    expect(budget.entries()[0]).toMatchObject({ ok: false, reason: "RATE_LIMITED" });
  });

  it("tries the next model on a rate limit", async () => {
    const budget = new LlmBudget(4);
    const transport = failingTransport("RATE_LIMITED");
    await callJson({
      purpose: "test",
      budget,
      models: ["model-a", "model-b"],
      schema: SCHEMA,
      request: REQUEST,
      transport,
    });
    expect(transport.calls()).toBe(2);
  });
});

describe("callJson — failures that no other model would survive", () => {
  it.each(["BILLING", "AUTH", "BAD_REQUEST"] as const)(
    "stops immediately on %s instead of trying every model",
    async (kind) => {
      const budget = new LlmBudget(8);
      const transport = failingTransport(kind);
      const result = await callJson({
        purpose: "test",
        budget,
        models: ["model-a", "model-b", "model-c"],
        schema: SCHEMA,
        request: REQUEST,
        transport,
      });

      expect(result.ok).toBe(false);
      // Every model shares one key and one billing account, so proving that three times over
      // would only burn the tick's remaining seconds.
      expect(transport.calls()).toBe(1);
    },
  );

  it("reports NOT_CONFIGURED without spending budget when no key is set", async () => {
    delete process.env.GEMINI_API_KEY;
    const budget = new LlmBudget(4);
    const transport = stubTransport({ verdict: true, score: 1 });

    const result = await callJson({
      purpose: "test",
      budget,
      models: ["model-a"],
      schema: SCHEMA,
      request: REQUEST,
      transport,
    });

    expect(result).toMatchObject({ ok: false, reason: "NOT_CONFIGURED" });
    expect(transport.calls()).toBe(0);
    expect(budget.spent).toBe(0);
    // Still logged: "no LLM configured" must be visible in the tick report, not silent.
    expect(budget.entries()).toHaveLength(1);
  });
});

describe("callJson — Zod re-validation catches what the API schema cannot", () => {
  it("rejects a schema-shaped object whose values are out of range", async () => {
    // `score` is typed NUMBER at the API and would be accepted there. Only Zod knows it is
    // supposed to be a probability.
    const budget = new LlmBudget(4);
    const result = await callJson({
      purpose: "test",
      budget,
      models: ["model-a"],
      schema: SCHEMA,
      request: REQUEST,
      transport: stubTransport({ verdict: true, score: 4.2 }),
    });

    expect(result).toMatchObject({ ok: false, reason: "SCHEMA_REJECTED" });
  });

  it("rejects a truncated object", async () => {
    // What a response cut off at the output-token cap actually looks like: valid JSON, wrong
    // shape. The API cannot detect this; it produced it.
    const budget = new LlmBudget(4);
    const result = await callJson({
      purpose: "test",
      budget,
      models: ["model-a"],
      schema: SCHEMA,
      request: REQUEST,
      transport: stubTransport({ verdict: true }),
    });

    expect(result).toMatchObject({ ok: false, reason: "SCHEMA_REJECTED" });
  });

  it("never returns unvalidated data on the success path", async () => {
    const budget = new LlmBudget(4);
    const result = await callJson({
      purpose: "test",
      budget,
      models: ["model-a"],
      schema: SCHEMA,
      request: REQUEST,
      // Extra keys are stripped by the schema rather than passed through.
      transport: stubTransport({ verdict: true, score: 0.25, injected: "ignore me" }),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.value).toEqual({ verdict: true, score: 0.25 });
    expect(Object.keys(result.value)).not.toContain("injected");
  });

  it("falls through to the next model after a schema rejection", async () => {
    const budget = new LlmBudget(4);
    const transport = stubTransport({ verdict: true, score: 99 });
    await callJson({
      purpose: "test",
      budget,
      models: ["model-a", "model-b"],
      schema: SCHEMA,
      request: REQUEST,
      transport,
    });
    expect(transport.calls()).toBe(2);
  });
});

describe("callJson — an unexpected throw is still a value", () => {
  it("wraps a non-LlmFailure error rather than propagating it", async () => {
    const budget = new LlmBudget(4);
    const transport: Transport = async () => {
      throw new TypeError("something unexpected");
    };

    const result = await callJson({
      purpose: "test",
      budget,
      models: ["model-a"],
      schema: SCHEMA,
      request: REQUEST,
      transport,
    });

    expect(result).toMatchObject({ ok: false, reason: "NETWORK" });
  });
});
