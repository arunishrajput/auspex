/**
 * Who holds what, asked of the contract.
 *
 * ## This is the load-bearing claim of the whole project, so it is not written down anywhere
 *
 * AuspeX claims that no key the deployed application holds can create a market, resolve one,
 * register an agent, change a cap or pause the contract. A sentence in a README asserting that is
 * worth nothing. What is worth something is `hasRole(role, account)` — the contract's own answer —
 * read live for every role and every address we know about, on every load of `/trust`.
 *
 * There is no cached copy and no column in Postgres holding "this wallet has no roles". The same
 * reasoning as `onChainCapsFor` in `members.ts`: a second copy of an authoritative fact is the
 * first thing to go stale, and it would go stale in the direction that flatters us.
 *
 * ## The `pause()` probe is the part worth pointing at
 *
 * `paused()` tells you whether the kill switch is pulled. It does not tell you who *can* pull it.
 * So this module also does an `eth_call` of `pause()` **from the human authority's address** and
 * records what happens. It reverts with `AccessControlUnauthorizedAccount`, which is a live
 * demonstration that even the most privileged wallet in the running system cannot halt the
 * contract — the admin key that can is on a laptop and not in Vercel (ADR-047).
 *
 * `eth_call` changes no state and costs nothing, so this probe can run on every page load. That
 * property is the reason three `verify:*` scripts are built on it too.
 */

import { id, toBeHex, zeroPadValue, type Provider } from "ethers";
import { auspexInterface, readPaused } from "../chain/auspex";
import { AUSPEX_MARKET_ADDRESS } from "../chain/deployment";
import { getProvider } from "../chain/provider";
import { describeRevert } from "../chain/revert";
import { humanAuthorityAddress, humanResolverAddress } from "../approval/authority";
import { listBettingMembers } from "../agents/members";

export const ROLE_NAMES = [
  "DEFAULT_ADMIN_ROLE",
  "MARKET_CREATOR_ROLE",
  "RESOLVER_ROLE",
  "CHALLENGER_ROLE",
] as const;

export type RoleName = (typeof ROLE_NAMES)[number];

/**
 * What a role lets its holder do, in plain words rather than in the contract's.
 *
 * Beside the role rather than in the page, for the same reason `POLICY_RULES` lives beside
 * `policyGate` — a page cannot then describe a power the contract does not grant.
 */
export const ROLE_POWERS: Record<RoleName, string> = {
  DEFAULT_ADMIN_ROLE:
    "register an agent, change a cap, deactivate an agent, pause the contract, grant every other role",
  MARKET_CREATOR_ROLE: "create a market",
  RESOLVER_ROLE: "propose an outcome, with an evidence URL",
  CHALLENGER_ROLE: "challenge a proposed outcome inside the window",
};

/** `DEFAULT_ADMIN_ROLE` is `bytes32(0)`, not a keccak hash of its name. */
export function roleHash(name: RoleName): string {
  return name === "DEFAULT_ADMIN_ROLE" ? zeroPadValue(toBeHex(0), 32) : id(name);
}

export type RoleHolder = {
  /** What this address is to us, e.g. "human authority (BridgeKey)" or "agent · atlas". */
  label: string;
  address: string;
  /** True for a key the deployed application can sign with. The column that matters. */
  heldByServer: boolean;
  /** Role → whether the contract says this address holds it. */
  roles: Record<RoleName, boolean>;
  /** Set when a read failed; the row is then shown as unknown rather than as "no roles". */
  error: string | null;
};

export type PauseProbe =
  /** The call was made and the contract refused it. The expected, demonstrable answer. */
  | { attempted: true; refused: true; from: string; revert: string }
  /** The call would have SUCCEEDED. A serious finding, shown loudly. */
  | { attempted: true; refused: false; from: string }
  /** No address to probe from, or the RPC could not be reached. */
  | { attempted: false; reason: string };

export type RoleReport = {
  contractAddress: string;
  paused: boolean | null;
  holders: RoleHolder[];
  pauseProbe: PauseProbe;
  /** Set when the chain could not be read at all. Every other field is then unusable. */
  error: string | null;
};

/**
 * Reads the role matrix and the pause probe.
 *
 * Never throws. A `/trust` page that 500s because an RPC blinked is worse than one that says the
 * RPC blinked, and the whole point of the page is that it does not hide anything.
 */
export async function roleReport(): Promise<RoleReport> {
  const provider = getProvider();
  const report: RoleReport = {
    contractAddress: AUSPEX_MARKET_ADDRESS,
    paused: null,
    holders: [],
    pauseProbe: { attempted: false, reason: "not reached" },
    error: null,
  };

  const authority = humanAuthorityAddress();
  const resolver = humanResolverAddress();

  // Agent wallets come from Postgres, so a database failure must not take the chain reads with
  // it: the role matrix for the human wallets is still worth showing, and is still the claim.
  let agents: { handle: string; address: string }[] = [];
  let agentsError: string | null = null;
  try {
    agents = (await listBettingMembers()).map((member) => ({
      handle: member.handle,
      address: member.agentAddress,
    }));
  } catch (error) {
    agentsError = error instanceof Error ? error.message : String(error);
  }

  const candidates: { label: string; address: string; heldByServer: boolean }[] = [];
  if (authority !== null) {
    candidates.push({
      label: "human authority — browser wallet (BridgeKey)",
      address: authority,
      heldByServer: false,
    });
  }
  if (resolver !== null && resolver !== authority) {
    candidates.push({
      label: "human resolver — browser wallet",
      address: resolver,
      heldByServer: false,
    });
  }
  for (const agent of agents) {
    candidates.push({
      label: `agent wallet · ${agent.handle}`,
      address: agent.address,
      // The honest column. These are the only keys the deployed application can sign with, and
      // every one of them should show four crosses.
      heldByServer: true,
    });
  }

  try {
    report.paused = await readPaused(provider);
  } catch (error) {
    report.error = error instanceof Error ? error.message : String(error);
    return report;
  }

  report.holders = await Promise.all(
    candidates.map(async (candidate) => {
      const roles = {} as Record<RoleName, boolean>;
      let error: string | null = null;
      try {
        const held = await Promise.all(
          ROLE_NAMES.map((role) => hasRole(role, candidate.address, provider)),
        );
        ROLE_NAMES.forEach((role, i) => {
          roles[role] = held[i];
        });
      } catch (readError) {
        for (const role of ROLE_NAMES) roles[role] = false;
        error = readError instanceof Error ? readError.message : String(readError);
      }
      return { ...candidate, roles, error };
    }),
  );

  if (agentsError !== null) {
    report.error =
      `Agent wallets could not be listed, so the rows below cover only the human wallets: ` +
      agentsError;
  }

  report.pauseProbe = await probePause(authority, provider);
  return report;
}

/** One `hasRole` read. Exported so `verify:*` scripts and the page share one implementation. */
export async function hasRole(
  role: RoleName,
  account: string,
  runner?: Provider,
): Promise<boolean> {
  const provider = runner ?? getProvider();
  const data = await provider.call({
    to: AUSPEX_MARKET_ADDRESS,
    data: auspexInterface.encodeFunctionData("hasRole", [roleHash(role), account]),
  });
  const [held] = auspexInterface.decodeFunctionResult("hasRole", data);
  return Boolean(held);
}

/**
 * Asks the contract what it would do if the human authority tried to pause it.
 *
 * Probed from the *authority* and not from an agent wallet deliberately: an agent holding no role
 * being refused is unsurprising. The interesting demonstration is that the wallet which creates
 * every market and signs every resolution — the most privileged key in the running system — still
 * cannot halt the contract.
 */
async function probePause(from: string | null, provider: Provider): Promise<PauseProbe> {
  if (from === null) {
    return {
      attempted: false,
      reason:
        "HUMAN_AUTHORITY_ADDRESS is not configured on this deployment, so there is no address to " +
        "probe from.",
    };
  }

  const data = auspexInterface.encodeFunctionData("pause", []);
  try {
    await provider.call({ to: AUSPEX_MARKET_ADDRESS, data, from });
    // Reached only if the call did NOT revert, which would mean this address is an admin.
    return { attempted: true, refused: false, from };
  } catch (error) {
    const revert = describeRevert(error);
    // A transport failure is not a refusal, and must not be presented as one — that would be
    // claiming a guarantee we did not observe.
    if (/could not detect network|timeout|ECONN|fetch failed/i.test(revert)) {
      return { attempted: false, reason: `The RPC call failed rather than reverting: ${revert}` };
    }
    return { attempted: true, refused: true, from, revert };
  }
}

/** True when a holder row is the shape the trust claim requires: an app key with no roles. */
export function holdsNoRole(holder: RoleHolder): boolean {
  return holder.error === null && ROLE_NAMES.every((role) => !holder.roles[role]);
}
