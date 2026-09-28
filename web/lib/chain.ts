/**
 * MST Blockchain network constants.
 *
 * Every value here was verified live against the chain on 2026-09-28, not copied from
 * documentation or memory. See docs/ARCHITECTURE.md §1 for the probes.
 *
 * The explorer is the one thing most likely to be got wrong: `mstscan.com` indexes a
 * DIFFERENT chain (head ~20.8M vs our ~5.78M). Ours is `testnet.mstscan.com`. Linking a
 * judge to the wrong explorer makes a real transaction look fabricated.
 */

export const MST_TESTNET = {
  id: 91562037,
  hexId: "0x5752035",
  name: "MST Testnet",
  rpcUrl: "https://testnetrpc.mstblockchain.com",
  explorerUrl: "https://testnet.mstscan.com",
  faucetUrl: "https://faucet.masterstroke.academy",
  nativeCurrency: { name: "MST Testnet Coin", symbol: "tMSTC", decimals: 18 },
  blockTimeSeconds: 3,
} as const;

/** Same-origin proxy path. See web/app/api/rpc/[network]/route.ts for why. */
export const RPC_PROXY_PATH = "/api/rpc/testnet";

export type ExplorerTarget = "tx" | "address" | "block" | "token";

/** Build a link to MSTScan. Always use this — never hand-build an explorer URL. */
export function explorerUrl(target: ExplorerTarget, value: string | number): string {
  return `${MST_TESTNET.explorerUrl}/${target}/${value}`;
}

/** Shorten a hash or address for display: 0x1234…abcd */
export function shortHash(value: string, lead = 6, tail = 4): string {
  if (value.length <= lead + tail + 1) return value;
  return `${value.slice(0, lead)}…${value.slice(-tail)}`;
}

/** Format a wei bigint as tMSTC with a sane number of decimals. */
export function formatMstc(wei: bigint, decimals = 4): string {
  const negative = wei < 0n;
  const abs = negative ? -wei : wei;
  const base = 10n ** BigInt(MST_TESTNET.nativeCurrency.decimals);
  const whole = abs / base;
  const frac = abs % base;
  const fracStr = frac
    .toString()
    .padStart(MST_TESTNET.nativeCurrency.decimals, "0")
    .slice(0, decimals)
    .replace(/0+$/, "");
  const sign = negative ? "-" : "";
  return fracStr ? `${sign}${whole}.${fracStr}` : `${sign}${whole}`;
}
