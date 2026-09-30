import { Contract, Interface, type Provider, type Signer } from "ethers";
import { AUSPEX_MARKET_ABI, AUSPEX_MARKET_ADDRESS } from "./deployment";
import { getProvider } from "./provider";

/**
 * Typed-ish reads of the deployed AuspexMarket.
 *
 * Every function here is a real `eth_call` against chain 91562037. Nothing has a fallback
 * value and nothing is cached: if the chain cannot be read, the caller gets an error and the
 * UI says so. A plausible-looking market on a page that could not reach the chain would be
 * the fabricated data hard rule #1 forbids — the one failure this project cannot survive.
 */

export const auspexInterface = new Interface(AUSPEX_MARKET_ABI);

export function getAuspexContract(runner?: Provider | Signer): Contract {
  return new Contract(AUSPEX_MARKET_ADDRESS, AUSPEX_MARKET_ABI, runner ?? getProvider());
}

// The contract's own constants, mirrored. Kept next to their enum names so a reader can
// check them against AuspexMarket.sol lines 58-67 at a glance.
export const MARKET_STATE = ["OPEN", "CLOSED", "RESOLUTION_PROPOSED", "FINALIZED", "INVALIDATED"] as const;
export const OUTCOME = ["UNRESOLVED", "YES", "NO", "INVALID"] as const;

export type MarketStateName = (typeof MARKET_STATE)[number];
export type OutcomeName = (typeof OUTCOME)[number];

/** Maps the contract's `uint8 state` to its name, refusing to guess at an unknown value. */
export function marketStateName(state: number | bigint): MarketStateName {
  const name = MARKET_STATE[Number(state)];
  if (name === undefined) throw new Error(`Unknown market state ${state} from contract`);
  return name;
}

export function outcomeName(outcome: number | bigint): OutcomeName {
  const name = OUTCOME[Number(outcome)];
  if (name === undefined) throw new Error(`Unknown outcome ${outcome} from contract`);
  return name;
}

/** `getMarket()`'s tuple, as plain JS. Times are unix seconds, as the contract stores them. */
export type OnChainMarket = {
  onchainId: number;
  specHash: string;
  closeTime: number;
  resolveDeadline: number;
  challengeEndsAt: number;
  poolYesWei: bigint;
  poolNoWei: bigint;
  outcome: OutcomeName;
  state: MarketStateName;
  challengeCount: number;
  proposedBy: string;
  question: string;
  resolutionSourceUrl: string;
  evidenceUrl: string;
};

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export async function readMarketCount(runner?: Provider): Promise<number> {
  const count = (await getAuspexContract(runner).marketCount()) as bigint;
  return Number(count);
}

export async function readChallengeWindow(runner?: Provider): Promise<number> {
  const seconds = (await getAuspexContract(runner).challengeWindow()) as bigint;
  return Number(seconds);
}

export async function readPaused(runner?: Provider): Promise<boolean> {
  return (await getAuspexContract(runner).paused()) as boolean;
}

export async function readMarket(
  onchainId: number,
  runner?: Provider,
): Promise<OnChainMarket> {
  const raw = await getAuspexContract(runner).getMarket(onchainId);
  return {
    onchainId,
    specHash: raw.specHash as string,
    closeTime: Number(raw.closeTime as bigint),
    resolveDeadline: Number(raw.resolveDeadline as bigint),
    challengeEndsAt: Number(raw.challengeEndsAt as bigint),
    poolYesWei: raw.poolYes as bigint,
    poolNoWei: raw.poolNo as bigint,
    outcome: outcomeName(raw.outcome as bigint),
    state: marketStateName(raw.state as bigint),
    challengeCount: Number(raw.challengeCount as bigint),
    proposedBy: (raw.proposedBy as string).toLowerCase(),
    question: raw.question as string,
    resolutionSourceUrl: raw.resolutionSourceUrl as string,
    evidenceUrl: raw.evidenceUrl as string,
  };
}

/**
 * Every market currently on chain, read directly.
 *
 * Market ids are `1..marketCount`, assigned by the contract, so this needs no index and no
 * database — which is the point. `/markets` uses it as the independent check on the indexer:
 * if the projection in Postgres ever disagrees with this, the chain is right.
 */
export async function readAllMarkets(runner?: Provider): Promise<OnChainMarket[]> {
  const count = await readMarketCount(runner);
  const ids = Array.from({ length: count }, (_, i) => i + 1);
  return Promise.all(ids.map((id) => readMarket(id, runner)));
}

/** Registry entry for an agent wallet. `owner == 0x0` means the agent was never registered. */
export type OnChainAgent = {
  owner: string;
  perTxCapWei: bigint;
  perMarketCapWei: bigint;
  active: boolean;
  registered: boolean;
};

export async function readAgent(agent: string, runner?: Provider): Promise<OnChainAgent> {
  const raw = await getAuspexContract(runner).agents(agent);
  const owner = (raw[0] as string).toLowerCase();
  return {
    owner,
    perTxCapWei: raw[1] as bigint,
    perMarketCapWei: raw[2] as bigint,
    active: raw[3] as boolean,
    registered: owner !== ZERO_ADDRESS,
  };
}

/**
 * Headroom left under an agent's per-market cap, in wei.
 *
 * Returns 0 for an agent the contract does not know, or one it has deactivated — the same value
 * a genuinely exhausted cap gives. Callers must therefore check `registered` and `active` before
 * reading a zero here as "spent"; `screenAgent` does, and has a test for it.
 */
export async function readAgentRemainingOnMarket(
  onchainId: number,
  agent: string,
  runner?: Provider,
): Promise<bigint> {
  return (await getAuspexContract(runner).agentRemainingOnMarket(onchainId, agent)) as bigint;
}

/** What the contract would pay `account` right now. Zero until the market settles. */
export async function readPreviewPayout(
  onchainId: number,
  account: string,
  runner?: Provider,
): Promise<bigint> {
  return (await getAuspexContract(runner).previewPayout(onchainId, account)) as bigint;
}
