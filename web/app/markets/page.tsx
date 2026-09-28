import Link from "next/link";
import { explorerUrl, formatMstc, shortHash, MST_TESTNET } from "@/lib/chain";
import { AUSPEX_MARKET_ADDRESS } from "@/lib/chain/deployment";
import { getIndexerStatus, getMarketsForDisplay, type MarketView } from "@/lib/markets";

// Every number here is an eth_call made on this request. Never cache it.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = {
  title: "Markets — AuspeX",
  description: "Every market on the AuspexMarket contract, read live from MST Testnet.",
};

const STATE_STYLE: Record<string, string> = {
  OPEN: "border-ok-500/40 bg-ok-500/10 text-ok-500",
  CLOSED: "border-warn-500/40 bg-warn-500/10 text-warn-500",
  RESOLUTION_PROPOSED: "border-signal-500/40 bg-signal-500/10 text-signal-500",
  FINALIZED: "border-ink-600 bg-ink-800 text-ink-300",
  INVALIDATED: "border-bad-500/40 bg-bad-500/10 text-bad-500",
};

export default async function MarketsPage() {
  const [payload, indexer] = await Promise.all([getMarketsForDisplay(), getIndexerStatus()]);

  return (
    <main className="grid-backdrop min-h-dvh">
      <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6 sm:py-16">
        <header className="mb-8">
          <Link
            href="/"
            className="font-mono text-xs text-ink-400 underline-offset-2 hover:text-ink-200 hover:underline"
          >
            ← AuspeX
          </Link>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight text-ink-100 sm:text-4xl">
            Markets
          </h1>
          <p className="mt-3 max-w-2xl text-ink-300">
            Every market that exists on{" "}
            <a
              href={explorerUrl("address", AUSPEX_MARKET_ADDRESS)}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-signal-500 underline-offset-2 hover:underline"
            >
              {shortHash(AUSPEX_MARKET_ADDRESS, 8, 6)}
            </a>
            , read from the contract on this page load. Pools and states come from{" "}
            <span className="font-mono text-ink-200">getMarket()</span>, not from our database —
            so if our indexer were wrong or asleep, these numbers would still be right.
          </p>
        </header>

        {/* Indexer status. Separate from the market data on purpose: it is a claim about OUR
            plumbing, not about the chain, and the two must not be confused. */}
        <section className="mb-8 rounded-lg border border-ink-700 bg-ink-900 px-4 py-3">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 font-mono text-xs">
            <span className="text-ink-400">indexer</span>
            {indexer.error === null ? (
              <>
                <span className="text-ink-200">
                  cursor at block{" "}
                  {indexer.lastBlock === null
                    ? "—"
                    : indexer.lastBlock.toLocaleString("en-US")}
                </span>
                <span className="text-ink-200">
                  {indexer.chainEventCount ?? 0} logs stored
                </span>
              </>
            ) : (
              <span className="text-warn-500">unavailable — {indexer.error}</span>
            )}
          </div>
        </section>

        {payload.chainError !== null && (
          <div className="mb-8 rounded-lg border border-bad-500/40 bg-bad-500/5 px-4 py-3">
            <p className="font-mono text-sm text-bad-500">could not read the contract</p>
            <p className="mt-2 font-mono text-xs text-ink-400">{payload.chainError}</p>
            <p className="mt-2 text-xs text-ink-400">
              This page shows the real error instead of a placeholder list. Nothing here is
              ever invented.
            </p>
          </div>
        )}

        {payload.indexError !== null && (
          <div className="mb-8 rounded-lg border border-warn-500/40 bg-warn-500/5 px-4 py-3">
            <p className="font-mono text-xs text-warn-500">
              indexed detail unavailable — {payload.indexError}
            </p>
            <p className="mt-1 text-xs text-ink-400">
              Market state below is unaffected: it is read from the chain, not from the
              database.
            </p>
          </div>
        )}

        {payload.chainError === null && payload.markets.length === 0 && (
          <div className="rounded-lg border border-ink-700 bg-ink-900 px-4 py-10 text-center">
            <p className="text-ink-300">No markets exist on this contract yet.</p>
            <p className="mt-2 text-xs text-ink-400">
              <span className="font-mono">marketCount()</span> returned 0. Phase 4 creates the
              first market through a human approval.
            </p>
          </div>
        )}

        {/* Approved, signed, not yet confirmed. Kept visually separate from the list below
            because these rows are NOT on chain, and a page that mixed them would be claiming
            something the chain has not said. */}
        {payload.pending.length > 0 && (
          <section className="mb-8 overflow-hidden rounded-lg border border-warn-500/40 bg-warn-500/5">
            <div className="flex flex-wrap items-center gap-2 border-b border-warn-500/20 px-4 py-2.5">
              <span className="rounded border border-warn-500/40 bg-warn-500/10 px-1.5 py-0.5 font-mono text-[10px] tracking-wide text-warn-500 uppercase">
                off chain
              </span>
              <span className="font-mono text-[11px] text-ink-300">
                approved by a human, transaction in flight — not yet on the contract
              </span>
            </div>
            <ul className="divide-y divide-warn-500/20">
              {payload.pending.map((row) => (
                <li key={row.specHash} className="px-4 py-2.5">
                  <p className="text-sm text-ink-200">{row.question}</p>
                  <p className="mt-1 font-mono text-[11px] break-all text-ink-500">
                    specHash {row.specHash}
                  </p>
                </li>
              ))}
            </ul>
            <p className="border-t border-warn-500/20 px-4 py-2.5 text-xs leading-relaxed text-ink-400">
              A row sits here between a human signing and the indexer reading{" "}
              <span className="font-mono">MarketCreated</span> out of a confirmed log. When that
              happens the indexer <span className="text-ink-300">adopts</span> this row by its
              spec hash and it moves into the list below with its real market id. One that stays
              here means the transaction has not confirmed — worth seeing rather than hiding.
            </p>
          </section>
        )}

        <ul className="space-y-4">
          {payload.markets
            .slice()
            .reverse()
            .map((market) => (
              <MarketCard key={market.onchainId} market={market} />
            ))}
        </ul>

        <footer className="mt-10 border-t border-ink-800 pt-6">
          <p className="text-xs leading-relaxed text-ink-400">
            Markets 1–2 are Phase 1 smoke tests and market 3 is the Phase 2 idempotency crash
            test — all three are labelled as such in their own question text. They are real
            transactions on chain {MST_TESTNET.id}, not seeded demo data. The first market
            created by the actual pipeline arrives in Phase 4, through a human approval.
          </p>
        </footer>
      </div>
    </main>
  );
}

function MarketCard({ market }: { market: MarketView }) {
  const totalWei = market.poolYesWei + market.poolNoWei;
  const yesPercent =
    totalWei === 0n ? null : Number((market.poolYesWei * 10000n) / totalWei) / 100;

  return (
    <li className="overflow-hidden rounded-lg border border-ink-700 bg-ink-900">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-ink-800 px-4 py-2.5">
        <span className="font-mono text-xs text-ink-400">#{market.onchainId}</span>
        <span
          className={`rounded border px-1.5 py-0.5 font-mono text-[10px] tracking-wide uppercase ${
            STATE_STYLE[market.state] ?? "border-ink-600 bg-ink-800 text-ink-300"
          }`}
        >
          {market.state.replace(/_/g, " ")}
        </span>
        {market.outcome !== "UNRESOLVED" && (
          <span className="font-mono text-[10px] tracking-wide text-ink-300 uppercase">
            outcome {market.outcome}
          </span>
        )}
        {market.createdTxHash !== null && (
          <a
            href={explorerUrl("tx", market.createdTxHash)}
            target="_blank"
            rel="noreferrer"
            className="ml-auto font-mono text-[11px] text-signal-500 underline-offset-2 hover:underline"
          >
            created in {shortHash(market.createdTxHash, 8, 6)} ↗
          </a>
        )}
      </div>

      <div className="px-4 py-4">
        <p className="text-ink-100">{market.question}</p>

        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
          <Field label="Pool YES">
            <span className="text-ok-500">{formatMstc(market.poolYesWei)} tMSTC</span>
          </Field>
          <Field label="Pool NO">
            <span className="text-bad-500">{formatMstc(market.poolNoWei)} tMSTC</span>
          </Field>
          <Field label="Implied YES">
            {yesPercent === null ? (
              <span className="text-ink-400">no stake yet</span>
            ) : (
              <span className="text-ink-100">{yesPercent.toFixed(1)}%</span>
            )}
          </Field>
          <Field label="Bets indexed">
            {market.betCount === null ? (
              <span className="text-ink-400">—</span>
            ) : (
              <span className="text-ink-100">{market.betCount}</span>
            )}
          </Field>
        </dl>

        <dl className="mt-4 space-y-1.5 border-t border-ink-800 pt-3 font-mono text-[11px]">
          <Row label="closes">{new Date(market.closeTime * 1000).toISOString()}</Row>
          <Row label="resolve by">
            {new Date(market.resolveDeadline * 1000).toISOString()}
          </Row>
          <Row label="spec hash">
            <span className="break-all text-ink-300">{market.specHash}</span>
          </Row>
          <Row label="source">
            <a
              href={market.resolutionSourceUrl}
              target="_blank"
              rel="noreferrer"
              className="break-all text-signal-500 underline-offset-2 hover:underline"
            >
              {market.resolutionSourceUrl}
            </a>
          </Row>
          {market.evidenceUrl !== "" && (
            <Row label="evidence">
              <a
                href={market.evidenceUrl}
                target="_blank"
                rel="noreferrer"
                className="break-all text-signal-500 underline-offset-2 hover:underline"
              >
                {market.evidenceUrl}
              </a>
            </Row>
          )}
          {market.challengeCount > 0 && (
            <Row label="challenges">
              <span className="text-warn-500">{market.challengeCount} recorded</span>
            </Row>
          )}
        </dl>

        {market.projectionDrift !== null && (
          <p className="mt-3 rounded border border-warn-500/40 bg-warn-500/5 px-2.5 py-1.5 font-mono text-[11px] text-warn-500">
            indexer drift: {market.projectionDrift} — the chain figures above are the correct
            ones
          </p>
        )}
      </div>
    </li>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="font-mono text-[10px] tracking-wide text-ink-400 uppercase">{label}</dt>
      <dd className="mt-0.5 font-mono text-sm tabular-nums">{children}</dd>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-3">
      <dt className="w-24 shrink-0 text-ink-400">{label}</dt>
      <dd className="min-w-0 text-ink-200">{children}</dd>
    </div>
  );
}
