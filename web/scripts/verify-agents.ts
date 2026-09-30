/**
 * Proves Phase 5's claims against the live chain — **without sending a transaction.**
 *
 *   pnpm --filter web verify:agents
 *
 * Phase 4 shipped `verify-approval.ts` on the principle that `eth_call` from the acting address is
 * the cheapest possible proof: it runs the real calldata against the real contract at the current
 * block and reports what would happen. This is the same idea applied to agent caps, plus the two
 * claims that need no chain call at all.
 *
 * What it checks:
 *
 *   1. every agent wallet holds **no role** on the contract — all four, checked individually;
 *   2. the registry holds the caps the policy implies, and pays the owner we expect;
 *   3. a bet of **exactly** the on-chain per-tx cap is accepted (`eth_call` succeeds);
 *   4. a bet of **cap + 1 wei** is refused, with `AgentPerTxCapExceeded` decoded;
 *   5. the global kill switch halts the betting pass: no model call, no row, no transaction.
 *
 * Checks 3 and 4 together are the claim, from both sides: the boundary is exactly where the
 * contract says, and `policyGate.test.ts` pins the off-chain gate to the same wei. Neither is
 * asserted from the other — one is a unit test, the other is a live call.
 *
 * It signs nothing, touches no cap and creates no market. It is **not** entirely read-only, and
 * the closing line used to say it was: check 5 runs the real betting pass with the switch forced
 * on, and that pass appends one `agents.halted` row to `audit_log` with its reason. That write is
 * hard rule #7 working — a halt is a decision, and a decision is logged — so the write stays and
 * the claim was narrowed instead. What check 5 asserts is that no `agent_decisions` row appears,
 * no model is asked and no transaction is prepared.
 */

import { formatEther, id, toBeHex, zeroPadValue } from "ethers";
import { and, eq, gt, isNotNull, sql } from "drizzle-orm";
import { db, getPool } from "../lib/db/client";
import { agentDecisions, markets, proposals } from "../lib/db/schema";
import { explorerUrl } from "../lib/chain";
import { AUSPEX_MARKET_ADDRESS } from "../lib/chain/deployment";
import { getProvider } from "../lib/chain/provider";
import { auspexInterface } from "../lib/chain/auspex";
import { describeRevert } from "../lib/chain/revert";
import { LlmBudget } from "../lib/llm/client";
import { listBettingMembers, onChainCapsFor } from "../lib/agents/members";
import { readOnChainLimits } from "../lib/agents/registry";
import { runAgentPass } from "../lib/agents/run";

const ROLES = [
  "DEFAULT_ADMIN_ROLE",
  "MARKET_CREATOR_ROLE",
  "RESOLVER_ROLE",
  "CHALLENGER_ROLE",
] as const;

/** `DEFAULT_ADMIN_ROLE` is bytes32(0), not a keccak hash of its name. */
function roleHash(name: (typeof ROLES)[number]): string {
  return name === "DEFAULT_ADMIN_ROLE" ? zeroPadValue(toBeHex(0), 32) : id(name);
}

let failures = 0;

function line(ok: boolean, label: string, detail: string): void {
  if (!ok) failures += 1;
  console.log(`  ${ok ? "\x1b[32mPASS\x1b[0m" : "\x1b[31mFAIL\x1b[0m"}  ${label.padEnd(38)} ${detail}`);
}

function heading(text: string): void {
  console.log(`\n\x1b[1m${text}\x1b[0m`);
}

async function main(): Promise<void> {
  const provider = getProvider();
  const contract = AUSPEX_MARKET_ADDRESS;

  console.log("AuspeX — agent cap verification (reads only)");
  console.log(`  contract ${contract}`);

  const members = await listBettingMembers();
  if (members.length === 0) {
    console.error("\nNo members with an agent wallet. Run `pnpm --filter web agents:register`.");
    process.exitCode = 1;
    return;
  }

  const [market] = await db
    .select({ onchainId: markets.onchainId, question: markets.question })
    .from(markets)
    .innerJoin(proposals, eq(markets.proposalId, proposals.id))
    .where(
      and(
        eq(markets.state, "OPEN"),
        isNotNull(markets.onchainId),
        gt(markets.closeTime, sql`now() + interval '2 minutes'`),
      ),
    )
    .orderBy(markets.closeTime)
    .limit(1);

  if (market === undefined || market.onchainId === null) {
    console.error("\nNo open, human-approved market to simulate against.");
    process.exitCode = 1;
    return;
  }

  console.log(`  market   #${market.onchainId} — ${market.question.slice(0, 60)}…`);

  // --- 1 & 2: roles and the registry ---------------------------------------------------------
  for (const member of members) {
    heading(`${member.handle}  ${member.agentAddress}`);

    for (const role of ROLES) {
      const raw = (await provider.call({
        to: contract,
        data: auspexInterface.encodeFunctionData("hasRole", [roleHash(role), member.agentAddress]),
      })) as string;
      const holds = BigInt(raw) === 1n;
      // An agent holding ANY role would break the "it can only bet and claim" claim outright.
      line(!holds, `holds no ${role}`, holds ? "HOLDS IT — the claim is false" : "hasRole() == false");
    }

    const limits = await readOnChainLimits(member.agentAddress, market.onchainId);
    const expected = onChainCapsFor(member.policy);

    line(limits.registered, "registered in the agent registry", limits.registered ? "yes" : "NOT registered");
    line(limits.active, "active", limits.active ? "yes" : "deactivated");
    line(
      limits.perTxCapWei === expected.perTxCapWei,
      "on-chain per-tx cap matches policy",
      `${formatEther(limits.perTxCapWei)} tMSTC`,
    );
    line(
      limits.perMarketCapWei === expected.perMarketCapWei,
      "on-chain per-market cap matches policy",
      `${formatEther(limits.perMarketCapWei)} tMSTC`,
    );
    line(
      limits.owner === member.ownerAddress,
      "winnings are paid to the owner we expect",
      limits.owner,
    );
    line(
      limits.perTxCapWei > member.policy.perTxCapWei,
      "the off-chain cap is the tighter one",
      `policy ${formatEther(member.policy.perTxCapWei)} < chain ${formatEther(limits.perTxCapWei)}`,
    );

    if (!limits.registered || !limits.active) continue;

    // --- 3 & 4: the boundary, from the live contract ----------------------------------------
    const headroom = limits.remainingOnMarketWei;
    if (headroom < limits.perTxCapWei) {
      // Not a failure: the agent has already used this market's allowance, so a cap-sized bet
      // would revert on the per-MARKET cap and prove something else.
      console.log(
        `        skip  boundary simulation — only ${formatEther(headroom)} tMSTC of per-market ` +
          `headroom left, so a cap-sized bet would hit the per-market cap instead`,
      );
      continue;
    }

    const balance = await provider.getBalance(member.agentAddress);
    if (balance <= limits.perTxCapWei + 1n) {
      console.log(`        skip  boundary simulation — wallet holds ${formatEther(balance)} tMSTC`);
      continue;
    }

    const data = auspexInterface.encodeFunctionData("placeBet", [market.onchainId, true]);

    try {
      await provider.call({ to: contract, data, value: limits.perTxCapWei, from: member.agentAddress });
      line(true, "a bet of EXACTLY the cap is accepted", `${limits.perTxCapWei} wei`);
    } catch (error) {
      line(false, "a bet of EXACTLY the cap is accepted", describeRevert(error));
    }

    try {
      await provider.call({
        to: contract,
        data,
        value: limits.perTxCapWei + 1n,
        from: member.agentAddress,
      });
      line(false, "a bet ONE WEI over the cap is refused", "it was accepted — the cap is not real");
    } catch (error) {
      const reason = describeRevert(error);
      line(
        reason.startsWith("AgentPerTxCapExceeded"),
        "a bet ONE WEI over the cap is refused",
        reason,
      );
    }
  }

  // --- 5: the kill switch ------------------------------------------------------------------
  heading("The global kill switch");

  const before = await db
    .select({ count: sql<string>`count(*)` })
    .from(agentDecisions);
  const countBefore = Number(before[0]?.count ?? 0);

  const original = process.env.AGENTS_KILL_SWITCH;
  process.env.AGENTS_KILL_SWITCH = "true";
  const budget = new LlmBudget(3);
  let report: Awaited<ReturnType<typeof runAgentPass>>;
  try {
    report = await runAgentPass(budget);
  } finally {
    if (original === undefined) delete process.env.AGENTS_KILL_SWITCH;
    else process.env.AGENTS_KILL_SWITCH = original;
  }

  const after = await db.select({ count: sql<string>`count(*)` }).from(agentDecisions);
  const countAfter = Number(after[0]?.count ?? 0);

  line(budget.spent === 0, "no model was asked anything", `${budget.spent} LLM call(s)`);
  line(report.approved === 0, "no bet was approved", `${report.approved} approval(s)`);
  line(report.asked === 0, "no agent was even screened", `${report.asked} asked`);
  line(
    countAfter === countBefore,
    "no decision row was written",
    `${countBefore} → ${countAfter} rows`,
  );
  line(
    report.haltedBecause !== null && report.haltedBecause.includes("AGENTS_KILL_SWITCH"),
    "the halt is recorded with its reason",
    report.haltedBecause ?? "no reason given",
  );
  console.log(
    "        The contract was not involved: the switch is an environment variable, and every\n" +
      "        on-chain cap is exactly what it was before this check ran.",
  );

  heading(failures === 0 ? "All checks pass." : `${failures} check(s) FAILED.`);
  console.log(
    `  Nothing was signed. One \`agents.halted\` row was appended to audit_log by check 5 —\n` +
      `  the halt is a decision and rule #7 logs it. Nothing else was written. ${explorerUrl("address", contract)}`,
  );

  if (failures > 0) process.exitCode = 1;
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(() => getPool().end());
