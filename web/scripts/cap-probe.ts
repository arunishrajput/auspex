/**
 * The cap probe, from the terminal.  `pnpm --filter web probe:cap`
 *
 * The same `runCapProbe` the `/trust` button calls, with the same guard and the same audit row —
 * so this script is a *verification* of the button rather than a second implementation of it. That
 * matters: a CLI that reimplemented the probe could pass while the button was broken, and the only
 * place that would show up is in front of whoever is using the site.
 *
 * Use it to confirm the feature still works after a change, and to produce a hash without clicking
 * through a browser. Everything it prints is read back from the chain or from the row the probe
 * wrote; nothing here is computed for display.
 *
 * Safe to re-run. Each run is its own transaction and every one of them reverts — see the long
 * comment in `lib/probe/capProbe.ts` for why that is the point rather than a limitation.
 */

import { getPool } from "../lib/db/client";
import { explorerUrl } from "../lib/chain";
import { runCapProbe } from "../lib/probe/capProbe";

function heading(text: string): void {
  console.log(`\n\x1b[1m${text}\x1b[0m`);
}

async function main(): Promise<void> {
  console.log("AuspeX — cap probe");
  console.log("  Asks the contract to accept a bet one wei over an agent's cap. It will refuse.");
  console.log("  Identical code path to the button on /trust, including the eth_call guard.\n");

  const result = await runCapProbe("cli");

  if (!result.ok) {
    heading("Not run");
    console.log(`  ${result.reason}`);
    // Not an error: refusing to run is the guard working. A non-zero exit would make a correct
    // refusal look like a broken script, which is the same mistake ADR-045 records for the tick.
    return;
  }

  heading("What was attempted");
  console.log(`  market     #${result.onchainId} — ${result.question.slice(0, 66)}…`);
  console.log(`  agent      ${result.agentHandle}  ${result.agentAddress}`);
  console.log(`  cap        ${result.capWei} wei  (read from the contract)`);
  console.log(`  sent       ${result.attemptedWei} wei  <- exactly one wei more`);

  heading("What the chain did");
  console.log(`  eth_call predicted  \x1b[33m${result.predictedRevert}\x1b[0m`);
  console.log(`  chain said          \x1b[33m${result.revertReason ?? "-"}\x1b[0m`);
  console.log(`  intent              ${result.intentStatus}`);
  console.log(`  tx                  ${result.txHash ?? "-"}`);
  console.log(`  block               ${result.blockNumber ?? "-"}`);
  if (result.txHash !== null) console.log(`  explorer            ${explorerUrl("tx", result.txHash)}`);

  heading("Proof that nothing moved");
  const ok = result.poolsUnchanged && result.intentStatus === "REVERTED";
  console.log(
    `  ${result.poolsUnchanged ? "\x1b[32mOK  \x1b[0m" : "\x1b[31mBAD \x1b[0m"} market pools unchanged`,
  );
  console.log(
    `  ${result.intentStatus === "REVERTED" ? "\x1b[32mOK  \x1b[0m" : "\x1b[31mBAD \x1b[0m"} intent settled as REVERTED`,
  );

  if (!ok) {
    console.error("\nThe probe did not produce the expected refusal. Do not demo it.");
    process.exitCode = 1;
  }
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(() => getPool().end());
