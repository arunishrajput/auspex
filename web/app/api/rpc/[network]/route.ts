import { NextRequest, NextResponse } from "next/server";
import { MST_TESTNET } from "@/lib/chain";

/**
 * Same-origin JSON-RPC proxy.
 *
 * Why this exists, honestly: MST's own Vibe Kit warns that the testnet RPC sends no
 * CORS headers. We tested that claim on 2026-09-28 and found it is STALE — the RPC now
 * returns `Access-Control-Allow-Origin: *` on both preflight and POST, so a browser
 * could call it directly.
 *
 * We keep the proxy anyway because it is ~30 lines and buys three things:
 *   1. insurance if that CORS policy changes back without warning,
 *   2. a single place to add caching / rate limiting later,
 *   3. the RPC endpoint can be rotated without shipping a new frontend build.
 *
 * Wallet-signed writes never come through here — those go via the wallet extension's
 * own provider.
 */

const RPC_URLS: Record<string, string> = {
  testnet: MST_TESTNET.rpcUrl,
};

/** Read-only methods we are willing to forward. Keeps the proxy from being an open relay. */
const ALLOWED_METHODS = new Set([
  "eth_chainId",
  "eth_blockNumber",
  "eth_getBalance",
  "eth_call",
  "eth_estimateGas",
  "eth_getCode",
  "eth_getLogs",
  "eth_getBlockByNumber",
  "eth_getBlockByHash",
  "eth_getTransactionByHash",
  "eth_getTransactionReceipt",
  "eth_getTransactionCount",
  "eth_gasPrice",
  "eth_maxPriorityFeePerGas",
  "eth_feeHistory",
  "net_version",
  // Signed raw transactions are already authenticated by their signature.
  "eth_sendRawTransaction",
]);

type RpcCall = { method?: unknown };

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ network: string }> },
) {
  const { network } = await params;
  const target = RPC_URLS[network];

  if (target === undefined) {
    return NextResponse.json({ error: `Unknown network "${network}"` }, { status: 400 });
  }

  let body: string;
  try {
    body = await request.text();
  } catch {
    return NextResponse.json({ error: "Unreadable request body" }, { status: 400 });
  }

  // Validate the method(s) before forwarding. Batch requests arrive as an array.
  try {
    const parsed: unknown = JSON.parse(body);
    const calls: RpcCall[] = Array.isArray(parsed) ? parsed : [parsed as RpcCall];
    for (const call of calls) {
      if (typeof call?.method !== "string" || !ALLOWED_METHODS.has(call.method)) {
        return NextResponse.json(
          { error: `RPC method not allowed: ${String(call?.method)}` },
          { status: 403 },
        );
      }
    }
  } catch {
    return NextResponse.json({ error: "Invalid JSON-RPC payload" }, { status: 400 });
  }

  try {
    const upstream = await fetch(target, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(15_000),
    });

    const data = await upstream.text();
    return new NextResponse(data, {
      status: upstream.status,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  } catch (error) {
    // Fail loudly but safely — never fabricate a response that looks like chain data.
    return NextResponse.json(
      { error: "Upstream RPC unreachable", detail: String(error) },
      { status: 502 },
    );
  }
}
