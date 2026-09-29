/**
 * Runs the resolution agent against a real market with real articles, and **writes nothing.**
 *
 *   pnpm --filter web resolution:dry-run            # the newest human-approved market
 *   MARKET=5 pnpm --filter web resolution:dry-run   # a specific one
 *
 * ## Why this exists
 *
 * `runResolutionPass` only considers markets that are **past their close time**, and the four real
 * markets close on 2026-09-30. Waiting for that before finding out whether the agent works would
 * repeat the mistake this project has now made three times: both Phase 4 defects and the Phase 5
 * abstention bug were invisible to the unit tests and obvious in one look at real output. A prompt
 * and a validator that each look correct alone can compose into a pipeline that can never produce
 * anything — that was ADR-049, and it cost a session to find.
 *
 * So this runs every step the tick stage runs — deterministic candidate retrieval, the real model,
 * the real validator — against a market that is still open, and prints what came back. It writes no
 * row, creates no intent, and sends nothing to the chain. The close-time check in `validate.ts` is
 * expected to refuse an open market and that refusal is **reported, not suppressed**: seeing
 * `BettingStillOpen` in the output is the validator proving it is wired up.
 *
 * What to actually read in the output:
 *
 *   - **did the retrieval find anything?** Zero candidates means the similarity floor or the recency
 *     filter is wrong for this market, and no model could have helped.
 *   - **is the quote real?** The line that says whether it was found in the evidence is the whole
 *     confabulation defence (ADR-054).
 *   - **is `UNSETTLED` coming back for a market that has not happened yet?** It should. That is the
 *     correct answer, and a model that instead confidently resolves an open market is the defect
 *     this script exists to catch before a human is ever asked to sign one.
 */

import { desc, eq, isNotNull } from "drizzle-orm";
import { db, getPool } from "../lib/db/client";
import { markets, proposals } from "../lib/db/schema";
import { readMarket } from "../lib/chain/auspex";
import { getProvider } from "../lib/chain/provider";
import type { MarketSpec } from "../lib/chain/spec";
import { LlmBudget } from "../lib/llm/client";
import { candidateEvidence, MAX_CANDIDATES_USED, scoredCandidates } from "../lib/resolution/run";
import { MIN_QUESTION_COVERAGE } from "../lib/resolution/retrieve";
import { draftResolution, issueEvidence } from "../lib/resolution/draft";
import { roundFor, type ResolvableMarket } from "../lib/resolution/validate";

function heading(text: string): void {
  console.log(`\n\x1b[1m${text}\x1b[0m`);
}

async function main(): Promise<void> {
  const wanted = process.env.MARKET === undefined ? null : Number(process.env.MARKET);

  console.log("AuspeX — resolution agent dry run");
  console.log("  Reads the chain and the database. Writes nothing. Sends nothing.\n");

  const rows = await db
    .select({
      rowId: markets.id,
      onchainId: markets.onchainId,
      question: markets.question,
      spec: proposals.spec,
      createdAt: markets.createdAt,
    })
    .from(markets)
    .innerJoin(proposals, eq(markets.proposalId, proposals.id))
    .where(isNotNull(markets.onchainId))
    .orderBy(desc(markets.closeTime));

  const candidates = rows.filter((row) => wanted === null || row.onchainId === wanted);
  const row = candidates[0];

  if (row === undefined || row.onchainId === null) {
    console.error(
      wanted === null
        ? "No human-approved market is on chain. Approve one in /review first."
        : `No human-approved market #${wanted} is on chain.`,
    );
    process.exitCode = 1;
    return;
  }

  const spec = row.spec as unknown as MarketSpec | null;
  if (spec === null) {
    console.error(`Market #${row.onchainId} has no stored spec, so it has no resolution criteria.`);
    process.exitCode = 1;
    return;
  }

  const provider = getProvider();
  const onChain = await readMarket(row.onchainId, provider);
  const facts: ResolvableMarket = {
    onchainId: row.onchainId,
    question: row.question,
    resolutionCriteria: spec.resolutionCriteria,
    closeTime: onChain.closeTime,
    state: onChain.state,
    challengeCount: onChain.challengeCount,
  };

  heading(`Market #${facts.onchainId}`);
  console.log(`  question   ${facts.question}`);
  console.log(`  resolves on ${facts.resolutionCriteria}`);
  console.log(`  state      ${facts.state}, closes ${new Date(facts.closeTime * 1000).toISOString()}`);
  console.log(`  round      ${roundFor(facts)} (challengeCount ${facts.challengeCount})`);

  // --- 1. Retrieval. No model involved. ----------------------------------------------------
  heading(
    "1. Deterministic candidate retrieval — IDF-weighted coverage of the question's own terms",
  );

  const marketInput = {
    rowId: row.rowId,
    onchainId: row.onchainId,
    question: row.question,
    spec,
    createdAt: row.createdAt,
  };

  // Every candidate with its score, including the ones below the floor. This is the measurement the
  // threshold in `retrieve.ts` was read off, and re-running this is how to re-derive it — the same
  // relationship `pnpm --filter web calibrate` has to Phase 3's clustering thresholds.
  const scored = await scoredCandidates(marketInput);
  console.log(
    `  ${scored.length} article(s) ingested since the market opened, floor ${MIN_QUESTION_COVERAGE}\n`,
  );
  for (const entry of scored.slice(0, 12)) {
    const passed = entry.score >= MIN_QUESTION_COVERAGE;
    const mark = passed ? "\x1b[32m✓\x1b[0m" : "\x1b[90m·\x1b[0m";
    console.log(
      `  ${mark} ${entry.score.toFixed(3)}  ${entry.candidate.domain.padEnd(22)} ` +
        `${entry.candidate.title.slice(0, 84)}`,
    );
  }

  const evidence = await candidateEvidence(marketInput);

  if (evidence.length === 0) {
    console.log(
      `\n  Nothing reached the ${MIN_QUESTION_COVERAGE} coverage floor. A model could not have ` +
        `helped here — retrieval found nothing worth reading. Either the feeds have not yet ` +
        `carried this story, or the floor is wrong for this question; the scores above are how you ` +
        `tell which.`,
    );
    return;
  }

  console.log(`\n  ${evidence.length} of ${MAX_CANDIDATES_USED} slots filled.`);
  const { issued } = issueEvidence({ market: facts, candidates: evidence });
  for (const source of issued) {
    console.log(`\n  ${source.label}  ${source.domain}${source.directLink ? "" : "  (front page only)"}`);
    console.log(`    ${source.evidenceUrl}`);
    console.log(`    ${source.text.split("\n").slice(-2).join(" · ").slice(0, 150)}`);
    if (source.injectionFlags.length > 0) {
      console.log(`    \x1b[33minjection flags: ${source.injectionFlags.join(", ")}\x1b[0m`);
    }
  }

  // --- 2. The model, and the validator. -----------------------------------------------------
  heading("2. The resolution agent, then the validator");

  const budget = new LlmBudget(2);
  const outcome = await draftResolution({ market: facts, candidates: evidence }, budget);

  console.log(`  model calls  ${budget.spent}/${budget.maxCalls}`);
  for (const call of budget.entries()) {
    console.log(
      `    ${call.purpose} ${call.model ?? "-"} ${call.ok ? "ok" : `failed: ${call.reason}`} ` +
        `${call.durationMs}ms  ${call.outputTokens ?? "-"} output tokens`,
    );
  }

  console.log(`\n  verdict      \x1b[1m${outcome.kind}\x1b[0m`);

  switch (outcome.kind) {
    case "PROPOSED":
      console.log(`  outcome      ${outcome.outcome}`);
      console.log(`  evidence     ${outcome.evidence.label}  ${outcome.evidence.evidenceUrl}`);
      console.log(`  quote        “${outcome.settledByQuote}”`);
      console.log(`               \x1b[32mfound verbatim in ${outcome.evidence.label}\x1b[0m`);
      console.log(`  rationale    ${outcome.rationale}`);
      for (const warning of outcome.warnings) console.log(`  \x1b[33mwarning\x1b[0m      ${warning}`);
      console.log(
        `\n  This would be queued for a human resolver. Nothing was written — this is a dry run.`,
      );
      break;

    case "UNSETTLED":
      console.log(`  rationale    ${outcome.rationale}`);
      console.log(
        `\n  The agent declined to resolve. No row would be written and the market would be\n` +
          `  reconsidered on a later tick with newer articles — which is the correct behaviour for a\n` +
          `  question whose answer is not yet reported (ADR-055).`,
      );
      break;

    case "REJECTED":
      console.log(`  \x1b[31mrefused by the validator\x1b[0m`);
      console.log(`  reason       ${outcome.reason}`);
      console.log(`  raw output   ${outcome.rawModelOutput ?? "(none)"}`);
      console.log(
        `\n  Read the reason above. "BettingStillOpen" is expected on a market that has not closed\n` +
          `  yet and means the validator is wired up. Anything else is a real finding.`,
      );
      break;

    case "UNAVAILABLE":
      console.log(`  reason       ${outcome.reason}`);
      console.log(`\n  No answer at all. No row would be written and the next tick retries.`);
      break;
  }
}

main()
  .catch((error: unknown) => {
    console.error(`\n${error instanceof Error ? error.stack : String(error)}\n`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await getPool().end().catch(() => undefined);
  });
