/**
 * The on-chain agent registry: putting caps where no server can move them.
 *
 * `registerAgent` is the only transaction in this project whose entire purpose is to *restrict*
 * the sender of later transactions. Before it confirms, an agent wallet is an ordinary address
 * and `placeBet` would take any amount from it. After it confirms, the same wallet is capped per
 * transaction and per market, and its winnings are payable only to the registered owner.
 *
 * That ordering is why `screenAgent` **defers** rather than rejects an unregistered agent: a bet
 * placed before registration is an uncapped bet, and the honest response is to wait.
 *
 * ## Only the admin can do this, and the admin key is not in production
 *
 * `registerAgent` is `onlyRole(DEFAULT_ADMIN_ROLE)`, which on this deployment is the deployer.
 * `DEPLOYER_PRIVATE_KEY` is deliberately absent from Vercel, so these intents are created here
 * and driven to completion by `scripts/register-agents.ts` running locally. A production tick
 * that claims one cannot sign it and releases it without burning an attempt — see
 * `resolveSigner` and `releaseUnattempted`.
 *
 * The result is worth stating: **the deployed application holds no key that can create a market,
 * resolve one, grant a role, pause the contract or change an agent's caps.** Every key it holds
 * is capped by the contract and holds no role at all.
 */

import { readAgent, readAgentRemainingOnMarket } from "../chain/auspex";
import { getProvider } from "../chain/provider";
import { createIntent } from "../intents/engine";
import type { OnChainLimits } from "../policy/policyGate";
import { onChainCapsFor, type MemberRow } from "./members";

/**
 * Records the intention to register one agent with its caps.
 *
 * Idempotent on the agent address *and the caps*: re-running with unchanged caps returns the
 * existing intent, and changing a member's policy produces a genuinely new registration rather
 * than silently reusing the old one. Keying on the address alone would make a cap change look
 * like work already done — the intent row would be `CONFIRMED` and the chain would still hold
 * the old numbers.
 */
export async function createRegistrationIntent(member: MemberRow) {
  const caps = onChainCapsFor(member.policy);
  return createIntent({
    idempotencyKey:
      `agent:${member.agentAddress}:register:` +
      `${caps.perTxCapWei}:${caps.perMarketCapWei}:${member.ownerAddress}`,
    kind: "REGISTER_AGENT",
    functionName: "registerAgent",
    args: [member.agentAddress, member.ownerAddress, caps.perTxCapWei, caps.perMarketCapWei],
  });
}

/**
 * The contract's own view of an agent, for one market. Four `eth_call`s, no cache.
 *
 * Read fresh every time it is needed. A cached cap is a cap that can be stale at the moment it
 * matters, and the whole argument for this layer is that it is the one we did not get to choose.
 */
export async function readOnChainLimits(
  agentAddress: string,
  onchainId: number,
): Promise<OnChainLimits> {
  const provider = getProvider();
  const [agent, remainingOnMarketWei] = await Promise.all([
    readAgent(agentAddress, provider),
    readAgentRemainingOnMarket(onchainId, agentAddress, provider),
  ]);

  return {
    registered: agent.registered,
    active: agent.active,
    perTxCapWei: agent.perTxCapWei,
    perMarketCapWei: agent.perMarketCapWei,
    remainingOnMarketWei,
    owner: agent.owner,
  };
}

export type RegistryComparison = {
  agentAddress: string;
  onChain: OnChainLimits;
  /** What `onChainCapsFor` says the contract should hold for this member's current policy. */
  expected: { perTxCapWei: bigint; perMarketCapWei: bigint };
  /** Non-null when the chain and the derived expectation disagree. Shown, never silently fixed. */
  drift: string | null;
};

/**
 * Compares what the contract holds against what the current policy implies.
 *
 * The caps are derived rather than stored (see `members.ts`), so the only way they can disagree
 * is that a policy changed and nobody re-registered. That is a real operational state and it is
 * surfaced on `/agents` rather than repaired behind the reader's back: silently re-registering
 * would mean an off-chain edit could loosen an on-chain cap, which is precisely the thing the
 * on-chain layer exists to prevent.
 */
export async function compareRegistry(
  member: MemberRow,
  onchainId: number,
): Promise<RegistryComparison> {
  const onChain = await readOnChainLimits(member.agentAddress, onchainId);
  const expected = onChainCapsFor(member.policy);

  const problems: string[] = [];
  if (!onChain.registered) {
    problems.push("the contract has no registry entry for this agent");
  } else {
    if (onChain.perTxCapWei !== expected.perTxCapWei) {
      problems.push(
        `on-chain per-tx cap is ${onChain.perTxCapWei} wei, policy implies ${expected.perTxCapWei}`,
      );
    }
    if (onChain.perMarketCapWei !== expected.perMarketCapWei) {
      problems.push(
        `on-chain per-market cap is ${onChain.perMarketCapWei} wei, ` +
          `policy implies ${expected.perMarketCapWei}`,
      );
    }
    if (onChain.owner !== member.ownerAddress) {
      problems.push(`the contract pays winnings to ${onChain.owner}, not ${member.ownerAddress}`);
    }
    if (!onChain.active) problems.push("the contract has this agent deactivated");
  }

  return {
    agentAddress: member.agentAddress,
    onChain,
    expected,
    drift: problems.length === 0 ? null : problems.join("; "),
  };
}
