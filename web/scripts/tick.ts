/**
 * Runs one pipeline tick from the command line.
 *
 *   pnpm --filter web tick              # full tick, including the chain indexer
 *   pnpm --filter web tick --no-index   # news stages only
 *
 * Identical to what `POST /api/tick` runs. Having both matters: the HTTP route is what the
 * cron and the dashboard button call, and this is what you use to watch a tick's output while
 * developing, without needing `TICK_SECRET` or a running server.
 */

import { runTick } from "../lib/pipeline/tick";

async function main(): Promise<void> {
  const skipIndex = process.argv.includes("--no-index");

  console.log(`AuspeX tick — ${new Date().toISOString()}${skipIndex ? "  (news only)" : ""}\n`);

  const report = await runTick({ skipIndex });

  if (report.ingest !== null) {
    const ingest = report.ingest;
    console.log("Ingest");
    console.log(`  feeds          ${ingest.feedsOk}/${ingest.feedsAttempted} ok`);
    console.log(`  items fetched  ${ingest.itemsFetched}`);
    console.log(`  items NEW      ${ingest.itemsInserted}   <- 0 on a replay, by construction`);
    console.log(`  publishers     ${ingest.distinctPublishers}`);
    console.log(`  injection hits ${ingest.flaggedForInjection}`);
    for (const failure of ingest.feedErrors) {
      console.log(`  ! ${failure.feedId}: ${failure.error}`);
    }
    console.log();
  }

  if (report.cluster !== null) {
    const cluster = report.cluster;
    console.log("Cluster + confirm");
    console.log(`  candidates       ${cluster.candidates}`);
    console.log(`  comparisons      ${cluster.comparisons.toLocaleString("en-US")}`);
    console.log(`  borderline pairs ${cluster.borderlinePairs}`);
    console.log(`  adjudicated      ${cluster.adjudicated}`);
    console.log(`  events created   ${cluster.eventsCreated}`);
    console.log(`  members attached ${cluster.membersAttached}`);
    console.log(`  events CONFIRMED ${cluster.eventsConfirmed}`);
    if (cluster.deferredMerges > 0) console.log(`  deferred merges  ${cluster.deferredMerges}`);
    if (cluster.adjudicationHalted !== null) {
      console.log(`  halted           ${cluster.adjudicationHalted}`);
    }
    console.log();
  }

  console.log("LLM");
  console.log(`  configured  ${report.llm.configured}`);
  console.log(`  calls       ${report.llm.callsMade} of ${report.llm.budget} budgeted`);
  for (const call of report.llm.calls) {
    const outcome = call.ok ? "ok" : (call.reason ?? "failed");
    const tokens = call.promptTokens === null ? "" : `  ${call.promptTokens}→${call.outputTokens} tok`;
    console.log(`    ${call.purpose}  ${call.model ?? "-"}  ${outcome}  ${call.durationMs}ms${tokens}`);
  }
  console.log();

  if (report.propose !== null) {
    const propose = report.propose;
    console.log("Proposer  (writes to the human review queue and nowhere else)");
    console.log(`  events awaiting   ${propose.pending}`);
    console.log(`  attempted         ${propose.attempted}`);
    console.log(`  queued for review ${propose.proposed}`);
    console.log(`  schema-rejected   ${propose.schemaRejected}   <- kept as evidence, not retried`);
    console.log(`  no model answer   ${propose.unavailable}   <- no row written, retried next tick`);
    console.log(`  no known source   ${propose.skippedNoSource}   <- no allowlisted publisher to resolve at`);
    if (propose.haltedBecause !== null) console.log(`  halted            ${propose.haltedBecause}`);
    console.log();
  }

  if (report.agents !== null) {
    const agents = report.agents;
    console.log("Member agents  (the policy gate decides the stake; the contract caps it again)");
    console.log(`  open approved markets ${agents.markets}`);
    console.log(`  members with a policy ${agents.members}`);
    console.log(`  undecided pairs       ${agents.pending}`);
    console.log(`  model calls           ${agents.asked}`);
    console.log(`  APPROVED by the gate  ${agents.approved}   <- each one is a real transaction`);
    console.log(`  rejected by the gate  ${agents.rejected + agents.screenRejected}   <- rows kept and shown; the evidence the gate is real`);
    console.log(`  deferred              ${agents.deferred}   <- no row written, reconsidered next tick`);
    console.log(`  no model answer       ${agents.unavailable}   <- no row written`);
    if (agents.resumed > 0) console.log(`  resumed               ${agents.resumed}   <- approved rows whose intent was missing`);
    if (agents.reconciled > 0) console.log(`  reconciled            ${agents.reconciled}   <- decisions brought up to date with the chain`);
    for (const deferral of agents.deferrals) console.log(`    defer: ${deferral}`);
    if (agents.haltedBecause !== null) console.log(`  halted                ${agents.haltedBecause}`);
    console.log();
  }

  if (report.intents !== null && report.intents.length > 0) {
    console.log("Intents");
    for (const result of report.intents) {
      console.log(`  ${result.status.padEnd(10)} ${result.txHash ?? "-"}  ${result.note}`);
    }
    console.log();
  }

  if (report.index !== null) {
    console.log("Chain index");
    console.log(`  blocks ${report.index.fromBlock}–${report.index.toBlock} of ${report.index.headBlock}`);
    console.log(`  logs   ${report.index.logsFetched} fetched, ${report.index.logsInserted} new`);
    console.log();
  }

  if (report.notify !== null) {
    const notify = report.notify;
    console.log("Notify  (only for markets the indexer has already seen on chain)");
    console.log(`  eligible ${notify.eligible}  created ${notify.created}  sent ${notify.sent}` +
      `  failed ${notify.failed}  skipped ${notify.skipped}`);
    console.log();
  }

  if (report.errors.length > 0) {
    console.log("Stage errors (the tick still completed — hard rule #6)");
    for (const failure of report.errors) console.log(`  ! ${failure.stage}: ${failure.error}`);
    console.log();
  }

  console.log(`Done in ${report.durationMs}ms.`);

  // A failing stage is a non-zero exit so CI and the heartbeat notice, even though the tick
  // itself deliberately completed.
  if (report.errors.length > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
