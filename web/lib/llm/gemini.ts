/**
 * Gemini transport. Nothing in here decides anything — it sends a request and classifies the
 * answer. Policy (budgets, fallback, what a failure means) lives in `client.ts`.
 *
 * ## Why `fetch` and not `@google/genai`
 *
 * The REST surface used below was verified directly against the live API on 2026-09-29 — the
 * exact request shape, the exact 402/503 bodies. Using it keeps three things in our hands that
 * matter more here than SDK ergonomics: the abort timeout is ours, the error *classification*
 * is ours (the SDK collapses a billing 402 and a capacity 503 into one thrown Error, and those
 * two demand different responses), and there is no version whose behaviour we would have to
 * re-verify before a demo. See ADR-031.
 */

import { optionalEnv } from "../env";

/**
 * Model ids, most-preferred first. Overridable so a rate-limited model can be swapped live.
 *
 * `gemini-3.1-flash-lite` leads, ahead of the newer `3.5`, because that is what the free tier
 * actually delivers. Over two live ticks: 3.5-flash-lite timed out twice and returned 503 once,
 * while 3.1-flash-lite answered every time it was asked, in 5.2s and 9.5s. Preferring the model
 * that responds is worth more here than preferring the newer one, and the chain means a 3.1
 * outage still falls through to 3.5.
 */
export function fastModelChain(): string[] {
  return parseChain(optionalEnv("GEMINI_MODELS_FAST") ?? "gemini-3.1-flash-lite,gemini-3.5-flash-lite");
}

export function smartModelChain(): string[] {
  return parseChain(
    optionalEnv("GEMINI_MODELS_SMART") ?? "gemini-3.8-flash,gemini-3.5-flash-lite",
  );
}

function parseChain(raw: string): string[] {
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/**
 * Per-call timeout.
 *
 * Tuned against live ticks, and it is a trade rather than a maximum. Successful adjudications
 * measured 5.2s, 9.5s and 13.6s, so the value has to clear ~15s. But the timeout is also the
 * price of a *failure*: at 35s a single unresponsive model consumed more of the tick than every
 * other stage combined, and a tick has to finish inside a 60-second function.
 *
 * 22s clears the observed successes with headroom and caps the damage from a hung model.
 *
 * **Exported because the tick's deadline ladder is arithmetic on this number, not a guess.** A
 * stage deadline is checked *before* a call starts, so the latest moment a call may begin is
 * `budget - timeoutMs() - tail`. Phase 11 made that explicit; before it, the agents stage could
 * start a call at 38s of a 60s budget and finish at 60s exactly, leaving nothing for the audit
 * row. See `STAGE_DEADLINE_FRACTION` in `lib/pipeline/tick.ts`.
 */
export function callTimeoutMs(): number {
  const raw = Number(optionalEnv("GEMINI_TIMEOUT_MS") ?? 22_000);
  return Number.isFinite(raw) && raw > 0 ? raw : 22_000;
}

/**
 * Why a call did not produce a usable answer.
 *
 * These are distinguished because they demand different behaviour, and collapsing them is how
 * a transient capacity blip gets treated as a permanent misconfiguration (or worse, the other
 * way round). `RATE_LIMITED` and `UNAVAILABLE` are worth trying the next model for; `AUTH` and
 * `BILLING` are not — every model will give the same answer, so trying them all just burns the
 * tick's time budget.
 */
export type LlmFailureKind =
  | "NOT_CONFIGURED"
  | "RATE_LIMITED"
  | "BILLING"
  | "UNAVAILABLE"
  | "MODEL_NOT_FOUND"
  | "AUTH"
  | "BAD_REQUEST"
  | "TIMEOUT"
  | "MALFORMED_OUTPUT"
  | "NETWORK";

export class LlmFailure extends Error {
  constructor(
    readonly kind: LlmFailureKind,
    message: string,
    readonly model: string | null = null,
  ) {
    super(message);
    this.name = "LlmFailure";
  }

  /** True when a different model might succeed where this one did not. */
  get worthTryingNextModel(): boolean {
    return (
      this.kind === "RATE_LIMITED" ||
      this.kind === "UNAVAILABLE" ||
      this.kind === "MODEL_NOT_FOUND" ||
      this.kind === "TIMEOUT" ||
      this.kind === "MALFORMED_OUTPUT"
    );
  }
}

function classify(status: number, body: string): LlmFailureKind {
  if (status === 429) return "RATE_LIMITED";
  if (status === 402) return "BILLING";
  if (status === 401 || status === 403) return "AUTH";
  if (status === 404) return "MODEL_NOT_FOUND";
  if (status === 400) return "BAD_REQUEST";
  if (status >= 500) return "UNAVAILABLE";
  void body;
  return "NETWORK";
}

/** The OpenAPI-subset schema Gemini accepts for `responseSchema`. */
export type ResponseSchema = {
  type: "OBJECT" | "ARRAY" | "STRING" | "NUMBER" | "INTEGER" | "BOOLEAN";
  properties?: Record<string, ResponseSchema>;
  items?: ResponseSchema;
  required?: string[];
  enum?: string[];
  description?: string;
};

export type GenerateJsonRequest = {
  /** Trusted operator text. Untrusted content must never be routed here — see `prompt.ts`. */
  systemInstruction: string;
  /** The user-role message, already carrying its sealed `<untrusted_content>` region. */
  userMessage: string;
  responseSchema: ResponseSchema;
  maxOutputTokens?: number;
};

export type GenerateJsonResult = {
  model: string;
  /** Parsed JSON, not yet validated against a Zod schema. `client.ts` does that. */
  json: unknown;
  rawText: string;
  promptTokens: number | null;
  outputTokens: number | null;
  durationMs: number;
};

/**
 * One `generateContent` call against one model.
 *
 * Throws `LlmFailure` for every failure path, including a 200 whose body is not the JSON the
 * schema promised. A structured-output request that returns prose is a real and recurring
 * condition, not an impossibility — `MALFORMED_OUTPUT` names it so the caller can fall through
 * to the next model instead of crashing.
 */
export async function generateJson(
  model: string,
  request: GenerateJsonRequest,
): Promise<GenerateJsonResult> {
  const apiKey = optionalEnv("GEMINI_API_KEY");
  if (apiKey === undefined) {
    throw new LlmFailure("NOT_CONFIGURED", "GEMINI_API_KEY is not set", model);
  }

  const startedAt = Date.now();
  const body = {
    systemInstruction: { parts: [{ text: request.systemInstruction }] },
    contents: [{ role: "user", parts: [{ text: request.userMessage }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: request.responseSchema,
      // Deterministic: the same borderline pair must not merge on Tuesday and stay split on
      // Wednesday. It is also the setting that makes a cached answer legitimate.
      temperature: 0,
      maxOutputTokens: request.maxOutputTokens ?? 1024,
    },
  };

  let response: Response;
  try {
    response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(callTimeoutMs()),
      },
    );
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    const kind: LlmFailureKind = name === "TimeoutError" || name === "AbortError" ? "TIMEOUT" : "NETWORK";
    throw new LlmFailure(kind, error instanceof Error ? error.message : String(error), model);
  }

  const text = await response.text();

  if (!response.ok) {
    // The API key can appear in an error echo; the message is logged, so never include the
    // request body or URL query here.
    throw new LlmFailure(classify(response.status, text), `HTTP ${response.status}: ${text.slice(0, 300)}`, model);
  }

  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new LlmFailure("MALFORMED_OUTPUT", "response body was not JSON", model);
  }

  const candidate = (payload as {
    candidates?: { content?: { parts?: { text?: unknown }[] } }[];
    usageMetadata?: { promptTokenCount?: unknown; candidatesTokenCount?: unknown };
  })?.candidates?.[0];

  const parts = candidate?.content?.parts ?? [];
  const rawText = parts
    .map((part) => (typeof part.text === "string" ? part.text : ""))
    .join("")
    .trim();

  if (rawText.length === 0) {
    throw new LlmFailure("MALFORMED_OUTPUT", "model returned no text", model);
  }

  let json: unknown;
  try {
    json = JSON.parse(rawText);
  } catch {
    throw new LlmFailure("MALFORMED_OUTPUT", `model text was not JSON: ${rawText.slice(0, 200)}`, model);
  }

  const usage = (payload as { usageMetadata?: { promptTokenCount?: unknown; candidatesTokenCount?: unknown } })
    ?.usageMetadata;

  return {
    model,
    json,
    rawText,
    promptTokens: typeof usage?.promptTokenCount === "number" ? usage.promptTokenCount : null,
    outputTokens: typeof usage?.candidatesTokenCount === "number" ? usage.candidatesTokenCount : null,
    durationMs: Date.now() - startedAt,
  };
}

/** True when a key is present. Used to report "no LLM configured" rather than to gate safety. */
export function isConfigured(): boolean {
  return optionalEnv("GEMINI_API_KEY") !== undefined;
}
