/**
 * Deterministic prompt-injection signature scan. **Pure.**
 *
 * ## What this is, and what it is not
 *
 * This is **not** the defence. The defence is structural and lives in `lib/llm/prompt.ts`:
 * news text never appears in a system instruction, it is always wrapped in
 * `<untrusted_content>` inside a user-role message, and every model output is schema-validated
 * before anything reads it. That holds whether or not this scanner notices anything, which is
 * the property that matters — a signature list is a blocklist, and blocklists are bypassable
 * by definition.
 *
 * What this *is*: an observability and triage layer. It marks items that are trying something,
 * so the dashboard can show them, `/audit` can record them, and a human reviewing a proposal
 * in Phase 4 can see that one of its sources was hostile. Hard rule #7 — log every decision
 * with a reason — is easier to satisfy when the reason has a name.
 *
 * Flagged items are **still processed**. Dropping them would make the scanner load-bearing,
 * and would hand anyone who can get a headline into Google News a way to delete stories from
 * our pipeline by making them look malicious.
 */

/**
 * A named signature. The name is what appears in the UI and in `raw_items.injection_flags`.
 *
 * `scope` says where the pattern is allowed to match. Most signatures describe text that is
 * never benign anywhere, and use `"any"`. A couple describe text that is hostile in a headline
 * and ordinary in an article body — see `invisible-characters` — and those are `"title"`.
 */
type Signature = {
  readonly name: string;
  readonly pattern: RegExp;
  readonly scope: "any" | "title";
};

const SIGNATURES: readonly Signature[] = [
  {
    name: "instruction-override",
    pattern: /\b(ignore|disregard|forget|override)\b[^.]{0,40}\b(previous|prior|above|earlier|all)\b[^.]{0,20}\b(instruction|prompt|rule|direction)/iu,
    scope: "any",
  },
  {
    name: "role-reassignment",
    pattern: /\byou\s+are\s+(now|no\s+longer)\b|\bact\s+as\s+(if|a|an)\b|\bpretend\s+(to\s+be|you)\b/iu,
    scope: "any",
  },
  {
    name: "system-prompt-probe",
    pattern: /\b(system\s+prompt|your\s+instructions|initial\s+prompt|reveal\s+your)\b/iu,
    scope: "any",
  },
  {
    // The single highest-signal pattern we have: an attempt to close our own delimiter early
    // and escape the untrusted region. Nothing legitimate in a news feed contains this.
    name: "delimiter-escape",
    pattern: /<\/?untrusted_content\s*>|<\|[a-z_]+\|>|\[\/?INST\]|<\|(im_start|im_end)\|>/iu,
    scope: "any",
  },
  {
    name: "chat-turn-forgery",
    pattern: /^\s*(system|assistant|user)\s*:/imu,
    scope: "any",
  },
  {
    name: "tool-or-exfil-request",
    pattern: /\b(curl|fetch|http\s+post|send\s+(the|your|all))\b[^.]{0,40}\b(api[\s_-]?key|secret|token|private\s+key|password)\b/iu,
    scope: "any",
  },
  {
    /**
     * Zero-width and bidirectional control characters: invisible to a human reviewer, visible
     * to a tokeniser.
     *
     * **Headline only**, and that restriction was earned rather than designed. Scanning bodies
     * too flagged three Guardian articles on the first live tick — U+200B, U+200C and U+2060
     * sprinkled through the standfirsts ("died ⁠attempting ​to cross the Channel"). That is the
     * Guardian's own typesetting, not an attack, and it meant the warning badge fired on a
     * major publisher's ordinary output every tick. A signature that cries wolf is worse than
     * no signature: it teaches the human reviewing a proposal in Phase 4 to ignore the badge.
     *
     * A headline is different. It is short, hand-written, and has no legitimate reason to carry
     * a zero-width joiner — so a hit there is still worth surfacing.
     */
    name: "invisible-characters",
    pattern: /[​-‏‪-‮⁠-⁤﻿]/u,
    scope: "title",
  },
  {
    name: "markdown-image-exfil",
    pattern: /!\[[^\]]*\]\((?:https?:)?\/\/[^)]*\{[^)]*\}[^)]*\)/iu,
    scope: "any",
  },
];

/**
 * Returns the names of every signature that matched, in declaration order.
 *
 * An empty array means clean. The array is stored verbatim in `raw_items.injection_flags`, so
 * the names are a stable interface — renaming one changes the meaning of historical rows.
 *
 * `title` and `body` are separate arguments rather than a joined blob because some signatures
 * are headline-only. Injections hide in the description far more often than in the headline,
 * so `"any"` signatures deliberately read both.
 */
export function scanForInjection(
  title: string | null | undefined,
  body?: string | null,
): string[] {
  const titleText = typeof title === "string" ? title : "";
  const bodyText = typeof body === "string" ? body : "";
  const combined = `${titleText}\n${bodyText}`;
  if (combined.trim().length === 0) return [];

  const hits: string[] = [];
  for (const { name, pattern, scope } of SIGNATURES) {
    if (pattern.test(scope === "title" ? titleText : combined)) hits.push(name);
  }
  return hits;
}

/** Convenience for the UI and for tests that only care whether anything fired. */
export function isFlagged(flags: readonly string[]): boolean {
  return flags.length > 0;
}

/** Exposed so a test can assert every signature has a case, and the UI can legend them. */
export const SIGNATURE_NAMES: readonly string[] = SIGNATURES.map((s) => s.name);
