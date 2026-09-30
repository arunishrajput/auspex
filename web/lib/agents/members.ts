/**
 * Members, their agent wallets, and the policies that bound them.
 *
 * ## The two-layer limit, and why the numbers are deliberately different
 *
 * Every agent is capped twice (`docs/ARCHITECTURE.md` §6):
 *
 *   **off-chain**, in `agent_policies` — a per-transaction cap and a daily budget. An operator
 *   changes these with an UPDATE. They are the *operational* limit.
 *
 *   **on-chain**, in the contract's agent registry — a per-transaction cap and a cumulative
 *   per-market cap. Changing these costs an admin transaction. They are the *outer bound*.
 *
 * `onChainCapsFor` sets the chain's caps at twice the off-chain ones rather than equal to them,
 * and that is a considered choice in both directions:
 *
 *   - equal caps would put every legitimate bet exactly on the boundary the contract reverts
 *     one wei above, so a rounding difference between two codebases becomes a failed bet;
 *   - looser caps make the honest claim narrower, and it is worth saying out loud: a total
 *     server compromise that bypassed the policy gate could stake up to **twice** the intended
 *     per-transaction amount before the chain refused it. Not the intended amount — twice it.
 *     What the chain guarantees is that the damage is *bounded by a number no server can
 *     change*, not that it equals the number we would have chosen.
 *
 * Both numbers are shown side by side on `/agents` for exactly that reason. A reader should be
 * able to see that they are different and ask why.
 *
 * ## The caps are derived, never stored twice
 *
 * There is no `on_chain_per_tx_cap_wei` column. The chain holds those values and is
 * authoritative; `onChainCapsFor` is how we compute what they *should* be, and `/agents` reads
 * what they *are* and flags a disagreement. A second copy in Postgres would be a third number
 * to keep in sync and the first one to go stale.
 */

import { eq, isNotNull } from "drizzle-orm";
import { Wallet } from "ethers";
import { db } from "../db/client";
import { agentPolicies, auditLog, members } from "../db/schema";
import { optionalEnv } from "../env";
import { humanAuthorityAddress } from "../approval/authority";
import { encryptAgentKey } from "./crypto";

/** 1 tMSTC in wei. */
const TMSTC = 10n ** 18n;

/** tMSTC as a decimal string → wei, without touching a float. */
function mstc(amount: string): bigint {
  const [whole, fraction = ""] = amount.split(".");
  const padded = `${fraction}${"0".repeat(18)}`.slice(0, 18);
  return BigInt(whole) * TMSTC + BigInt(padded === "" ? "0" : padded);
}

export type MemberSeed = {
  handle: string;
  perTxCap: string;
  dailyBudget: string;
  minConfidence: number;
  allowedCategories: string[];
  killSwitch: boolean;
  /** Why this member's policy looks the way it does. Rendered on `/agents`. */
  note: string;
};

/**
 * The seeded members.
 *
 * Three, with policies chosen so that **every branch of the gate is exercised by real data on a
 * real tick** rather than only in a unit test. The markets on chain are two POLITICS, one WORLD
 * and one ECONOMY, so:
 *
 *  - `atlas` can bet on all four and is the one that produces transactions;
 *  - `vega` allows only ECONOMY, so the three others produce `CATEGORY_NOT_ALLOWED` rows, and
 *    its 0.90 confidence floor means even the ECONOMY market usually produces
 *    `CONFIDENCE_BELOW_THRESHOLD`. One member, two kinds of refusal, both visible;
 *  - `kestrel` ships with its kill switch **on**, so the switch is demonstrably doing something
 *    on every tick instead of being a flag nobody has ever seen fire.
 *
 * These are seeded members on a testnet and the README says so. They are not pretend users with
 * invented balances: each one owns a real wallet holding real tMSTC, and every bet below is a
 * transaction anyone can open.
 */
export const MEMBER_SEEDS: readonly MemberSeed[] = [
  {
    handle: "atlas",
    perTxCap: "0.01",
    dailyBudget: "0.03",
    minConfidence: 0.6,
    allowedCategories: ["POLITICS", "ECONOMY", "WORLD", "BUSINESS"],
    killSwitch: false,
    note: "The generalist. Broad allowlist, ordinary confidence floor — the agent that actually trades.",
  },
  {
    handle: "vega",
    perTxCap: "0.005",
    dailyBudget: "0.01",
    minConfidence: 0.9,
    allowedCategories: ["ECONOMY", "BUSINESS"],
    killSwitch: false,
    note: "The specialist. Refuses anything outside economics, and needs 0.90 confidence to act — so most of its proposals are rejected by its own policy.",
  },
  {
    handle: "kestrel",
    perTxCap: "0.008",
    dailyBudget: "0.016",
    minConfidence: 0.55,
    allowedCategories: ["POLITICS", "WORLD"],
    killSwitch: true,
    note: "Halted. Its kill switch is on, so it proposes nothing and stakes nothing. Turning the switch off is an UPDATE — the contract is never involved.",
  },
];

export type PolicyRow = {
  perTxCapWei: bigint;
  dailyBudgetWei: bigint;
  minConfidence: number;
  allowedCategories: string[];
  killSwitch: boolean;
};

export type MemberRow = {
  id: string;
  handle: string;
  ownerAddress: string;
  agentAddress: string;
  agentKeyCiphertext: string;
  policy: PolicyRow;
};

/**
 * The caps the contract should hold for a member. **Pure.**
 *
 * Twice the off-chain per-transaction cap, and a per-market cap of twice that again — so an
 * agent can take two full-size positions on one market before the chain stops it. The contract
 * requires `perMarketCap >= perTxCap`, which this satisfies by construction.
 */
export function onChainCapsFor(policy: Pick<PolicyRow, "perTxCapWei">): {
  perTxCapWei: bigint;
  perMarketCapWei: bigint;
} {
  const perTxCapWei = policy.perTxCapWei * 2n;
  return { perTxCapWei, perMarketCapWei: perTxCapWei * 2n };
}

/**
 * Where agent winnings are paid.
 *
 * Defaults to the human authority's BridgeKey wallet, because this deployment has exactly one
 * human. That is worth stating plainly rather than dressing up: in a multi-user system each
 * member would register their own address, and the contract does not care either way — it only
 * requires `owner != agent`, and it pays whatever address was registered. The property being
 * demonstrated is that winnings go to a wallet the *server does not control*, and that holds
 * whether there is one such wallet or a thousand.
 */
export function memberOwnerAddress(): string | null {
  const override = optionalEnv("MEMBER_OWNER_ADDRESS");
  if (override !== undefined) {
    return /^0x[0-9a-fA-F]{40}$/.test(override) ? override.toLowerCase() : null;
  }
  return humanAuthorityAddress();
}

export type SeedReport = {
  created: string[];
  existing: string[];
  /** Policies updated in place because the seed changed. Caps on chain are NOT updated here. */
  policiesUpdated: string[];
};

/**
 * Creates any missing member, with a fresh agent wallet, encrypted at rest.
 *
 * Idempotent on `members.handle`. A wallet is generated *before* the insert is attempted and
 * simply discarded if the insert conflicts — the key never reaches the database, a log, or this
 * function's return value. Generating after a read-then-check would leave a race in which two
 * concurrent runs create two wallets for one handle and one of them is silently orphaned with
 * funds in it.
 *
 * Policies are re-asserted on every run so editing `MEMBER_SEEDS` takes effect, but the
 * **on-chain** caps are deliberately not touched: those need a transaction from the admin, and
 * `scripts/register-agents.ts` is where that happens, visibly.
 */
export async function seedMembers(): Promise<SeedReport> {
  const owner = memberOwnerAddress();
  if (owner === null) {
    throw new Error(
      "No owner address for member agents. Set HUMAN_AUTHORITY_ADDRESS (or MEMBER_OWNER_ADDRESS) " +
        "to the wallet that should receive agent winnings. See docs/RUNBOOK.md §5.",
    );
  }

  const report: SeedReport = { created: [], existing: [], policiesUpdated: [] };

  for (const seed of MEMBER_SEEDS) {
    const wallet = Wallet.createRandom();
    const agentAddress = wallet.address.toLowerCase();

    const [inserted] = await db
      .insert(members)
      .values({
        handle: seed.handle,
        ownerAddress: owner,
        agentAddress,
        // Bound to the address, so this ciphertext cannot be moved to another member's row and
        // still decrypt. See `crypto.ts`.
        agentKeyCiphertext: encryptAgentKey(wallet.privateKey, agentAddress),
      })
      .onConflictDoNothing({ target: members.handle })
      .returning({ id: members.id });

    if (inserted === undefined) {
      report.existing.push(seed.handle);
    } else {
      report.created.push(seed.handle);
      await db.insert(auditLog).values({
        actor: "system:agents",
        action: "member.created",
        subjectType: "member",
        subjectId: inserted.id,
        reason:
          `Created member ${seed.handle} with a fresh agent wallet ${agentAddress}, owned by ` +
          `${owner}. The key is encrypted at rest; the on-chain caps are the real bound.`,
        metadata: { handle: seed.handle, agentAddress, owner },
      });
    }

    const [row] = await db
      .select({ id: members.id })
      .from(members)
      .where(eq(members.handle, seed.handle))
      .limit(1);
    if (row === undefined) continue;

    const policy = {
      perTxCapWei: mstc(seed.perTxCap).toString(),
      dailyBudgetWei: mstc(seed.dailyBudget).toString(),
      minConfidence: seed.minConfidence,
      allowedCategories: seed.allowedCategories,
      killSwitch: seed.killSwitch,
    };

    const [updated] = await db
      .insert(agentPolicies)
      .values({ memberId: row.id, ...policy })
      .onConflictDoUpdate({
        target: agentPolicies.memberId,
        set: { ...policy, updatedAt: new Date() },
      })
      .returning({ memberId: agentPolicies.memberId });

    if (updated !== undefined) report.policiesUpdated.push(seed.handle);
  }

  return report;
}

/** The seed note for a handle, for display. Null for a member not in `MEMBER_SEEDS`. */
export function seedNoteFor(handle: string): string | null {
  return MEMBER_SEEDS.find((seed) => seed.handle === handle)?.note ?? null;
}

/**
 * Every member with an agent wallet and a policy, ready to be asked about a market.
 *
 * A member with no agent address or no policy row is skipped rather than defaulted: an agent
 * with an implied policy would be an agent with *no* policy, and the safe reading of a missing
 * limit is that nothing is permitted.
 */
export async function listBettingMembers(): Promise<MemberRow[]> {
  const rows = await db
    .select({
      id: members.id,
      handle: members.handle,
      ownerAddress: members.ownerAddress,
      agentAddress: members.agentAddress,
      agentKeyCiphertext: members.agentKeyCiphertext,
      perTxCapWei: agentPolicies.perTxCapWei,
      dailyBudgetWei: agentPolicies.dailyBudgetWei,
      minConfidence: agentPolicies.minConfidence,
      allowedCategories: agentPolicies.allowedCategories,
      killSwitch: agentPolicies.killSwitch,
    })
    .from(members)
    .innerJoin(agentPolicies, eq(agentPolicies.memberId, members.id))
    .where(isNotNull(members.agentAddress))
    .orderBy(members.handle);

  return rows.flatMap((row) => {
    if (row.agentAddress === null || row.agentKeyCiphertext === null) return [];
    return [
      {
        id: row.id,
        handle: row.handle,
        ownerAddress: row.ownerAddress.toLowerCase(),
        agentAddress: row.agentAddress.toLowerCase(),
        agentKeyCiphertext: row.agentKeyCiphertext,
        policy: {
          perTxCapWei: BigInt(row.perTxCapWei),
          dailyBudgetWei: BigInt(row.dailyBudgetWei),
          minConfidence: row.minConfidence,
          allowedCategories: row.allowedCategories,
          killSwitch: row.killSwitch,
        },
      },
    ];
  });
}

/** One member by agent address. Used by the signer to find the key for an intent's sender. */
export async function memberByAgentAddress(agentAddress: string): Promise<MemberRow | null> {
  const all = await listBettingMembers();
  return all.find((member) => member.agentAddress === agentAddress.toLowerCase()) ?? null;
}

/** The global off-chain halt. `AGENTS_KILL_SWITCH=true` stops every agent without a transaction. */
export function globalKillSwitch(): boolean {
  return (optionalEnv("AGENTS_KILL_SWITCH") ?? "").toLowerCase() === "true";
}

export { mstc as parseMstc };
