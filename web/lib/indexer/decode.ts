import { type Log } from "ethers";
import { auspexInterface } from "../chain/auspex";

/**
 * Turning raw logs into decoded records. Pure — no network, no database, no clock.
 *
 * Kept separate from the runner so the decoding and the state projection can be tested
 * against fixtures captured from the real chain, without a Postgres or an RPC in the loop.
 */

export type DecodedLog = {
  txHash: string;
  logIndex: number;
  blockNumber: number;
  blockHash: string;
  address: string;
  topic0: string;
  rawTopics: string[];
  rawData: string;
  /** Null when topic0 is not in the AuspexMarket ABI — the raw log is still stored. */
  eventName: string | null;
  /** Decoded args by name, every uint rendered as a decimal string. Null when undecodable. */
  args: Record<string, string | boolean> | null;
};

/**
 * Renders a decoded value as something JSON and Postgres can both hold losslessly.
 *
 * `bigint` becomes a decimal string, never a `number`: a uint256 wei amount overflows
 * `Number.MAX_SAFE_INTEGER` at 9.007 tMSTC, and a silently-rounded pool balance on a
 * prediction market would be worse than no balance at all.
 */
function renderValue(value: unknown): string | boolean {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value;
  return String(value);
}

/**
 * Decodes one log against the AuspexMarket ABI.
 *
 * An unrecognised `topic0` is not an error: the contract inherits OpenZeppelin's
 * `AccessControl` and `Pausable`, and a future contract at the same address could emit
 * anything. Unknown logs are kept verbatim with `eventName: null` so that nothing is lost
 * and no event is ever invented.
 */
export function decodeLog(log: Log): DecodedLog {
  const base = {
    txHash: log.transactionHash,
    logIndex: log.index,
    blockNumber: log.blockNumber,
    blockHash: log.blockHash,
    address: log.address.toLowerCase(),
    topic0: log.topics[0] ?? "0x",
    rawTopics: [...log.topics],
    rawData: log.data,
  };

  const parsed = auspexInterface.parseLog({ topics: [...log.topics], data: log.data });
  if (parsed === null) return { ...base, eventName: null, args: null };

  const args: Record<string, string | boolean> = {};
  parsed.fragment.inputs.forEach((input, i) => {
    args[input.name] = renderValue(parsed.args[i]);
  });

  return { ...base, eventName: parsed.name, args };
}

/**
 * Chain order: block, then position within the block.
 *
 * The projection is a fold over this sequence, so the ordering is not cosmetic — applying
 * `ResolutionChallenged` before the `ResolutionProposed` it challenges would produce a market
 * state that never existed. `eth_getLogs` already returns logs in this order; sorting makes
 * the guarantee explicit and survives a merge of results from several chunked requests.
 */
export function sortLogs<T extends { blockNumber: number; logIndex: number }>(logs: T[]): T[] {
  return [...logs].sort((a, b) =>
    a.blockNumber === b.blockNumber
      ? a.logIndex - b.logIndex
      : a.blockNumber - b.blockNumber,
  );
}
