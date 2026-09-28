import { MST_TESTNET, explorerUrl, formatMstc } from "@/lib/chain";
import { getChainHealth } from "@/lib/rpc";

// Always read live chain state — never serve a cached block height.
export const dynamic = "force-dynamic";
export const revalidate = 0;

const PHASES = [
  { n: 0, name: "Foundations & rails", state: "current" },
  { n: 1, name: "Smart contract — deploy & verify", state: "todo" },
  { n: 2, name: "Data layer & idempotency engine", state: "todo" },
  { n: 3, name: "News ingestion & 2-source confirmation", state: "todo" },
  { n: 4, name: "Proposer agent & human approval gate", state: "todo" },
  { n: 5, name: "Member agents & policy gate", state: "todo" },
  { n: 6, name: "Resolution, challenge window, payout", state: "todo" },
  { n: 7, name: "Dashboard & trust surface", state: "todo" },
  { n: 8, name: "Live run, README, submission", state: "todo" },
] as const;

export default async function Home() {
  const health = await getChainHealth();

  return (
    <main className="grid-backdrop min-h-dvh">
      <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6 sm:py-16">
        {/* Header */}
        <header className="mb-12">
          <div className="mb-3 flex items-center gap-3">
            <span className="rounded border border-ink-700 bg-ink-850 px-2 py-0.5 font-mono text-[11px] tracking-widest text-ink-400 uppercase">
              MST Buildathon · AI &amp; Web3
            </span>
          </div>
          <h1 className="text-4xl font-semibold tracking-tight text-ink-100 sm:text-5xl">
            AuspeX
          </h1>
          <p className="mt-3 max-w-2xl text-lg text-ink-300">
            Prediction markets created under human authority, researched by AI agents that
            are bounded twice — by deterministic code off-chain, and by the contract itself
            on-chain.
          </p>
          <p className="mt-4 font-mono text-sm text-signal-400">
            AI proposes. Humans and the chain decide.
          </p>
        </header>

        {/* Live chain status — the honest part: this is a real RPC read, every load. */}
        <section className="mb-10">
          <SectionLabel>Live network status</SectionLabel>

          {health.reachable ? (
            <div className="rounded-lg border border-ink-700 bg-ink-900">
              <div className="flex items-center gap-2 border-b border-ink-800 px-4 py-2.5">
                <span className="live-dot size-2 rounded-full bg-ok-500" />
                <span className="font-mono text-xs text-ink-300">
                  connected to {MST_TESTNET.name}
                </span>
                <span className="ml-auto font-mono text-xs text-ink-400">
                  {health.latencyMs}ms
                </span>
              </div>

              <dl className="grid grid-cols-2 divide-ink-800 sm:grid-cols-4 sm:divide-x">
                <Stat label="Chain ID" value={String(health.chainId)}>
                  {health.chainIdMatches ? (
                    <span className="text-ok-500">✓ expected</span>
                  ) : (
                    <span className="text-bad-500">
                      ✖ expected {MST_TESTNET.id}
                    </span>
                  )}
                </Stat>
                <Stat
                  label="Block height"
                  value={health.blockNumber.toLocaleString("en-US")}
                >
                  <a
                    href={explorerUrl("block", health.blockNumber)}
                    target="_blank"
                    rel="noreferrer"
                    className="text-signal-500 underline-offset-2 hover:underline"
                  >
                    view on MSTScan ↗
                  </a>
                </Stat>
                <Stat
                  label="Gas price"
                  value={`${formatMstc(health.gasPriceWei, 9)} tMSTC`}
                >
                  <span className="text-ink-400">base fee is 0 on this chain</span>
                </Stat>
                <Stat
                  label="Last block"
                  value={new Date(health.blockTimestamp * 1000).toLocaleTimeString("en-US", {
                    hour12: false,
                  })}
                >
                  <span className="text-ink-400">~{MST_TESTNET.blockTimeSeconds}s blocks</span>
                </Stat>
              </dl>
            </div>
          ) : (
            <div className="rounded-lg border border-bad-500/40 bg-bad-500/5 px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="size-2 rounded-full bg-bad-500" />
                <span className="font-mono text-sm text-bad-500">RPC unreachable</span>
              </div>
              <p className="mt-2 font-mono text-xs text-ink-400">{health.error}</p>
              <p className="mt-2 text-xs text-ink-400">
                This panel shows the real error rather than a placeholder. Nothing on this
                site displays invented chain data.
              </p>
            </div>
          )}
        </section>

        {/* Network reference */}
        <section className="mb-10">
          <SectionLabel>Network</SectionLabel>
          <dl className="overflow-hidden rounded-lg border border-ink-700 bg-ink-900 font-mono text-sm">
            <Row label="RPC" value={MST_TESTNET.rpcUrl} />
            <Row label="Chain ID" value={`${MST_TESTNET.id} (${MST_TESTNET.hexId})`} />
            <Row label="Currency" value={MST_TESTNET.nativeCurrency.symbol} />
            <Row
              label="Explorer"
              value={MST_TESTNET.explorerUrl}
              href={MST_TESTNET.explorerUrl}
              note="not mstscan.com — that indexes a different chain"
            />
            <Row label="Faucet" value={MST_TESTNET.faucetUrl} href={MST_TESTNET.faucetUrl} />
            <Row label="Contract" value="not deployed yet — Phase 1" muted last />
          </dl>
        </section>

        {/* Build progress — honest about what exists */}
        <section className="mb-10">
          <SectionLabel>Build progress</SectionLabel>
          <ol className="overflow-hidden rounded-lg border border-ink-700 bg-ink-900">
            {PHASES.map((phase, i) => (
              <li
                key={phase.n}
                className={`flex items-center gap-3 px-4 py-2.5 ${
                  i < PHASES.length - 1 ? "border-b border-ink-800" : ""
                }`}
              >
                <span
                  className={`size-1.5 shrink-0 rounded-full ${
                    phase.state === "current" ? "bg-warn-500" : "bg-ink-600"
                  }`}
                />
                <span className="w-16 shrink-0 font-mono text-xs text-ink-400">
                  Phase {phase.n}
                </span>
                <span
                  className={`text-sm ${
                    phase.state === "current" ? "text-ink-100" : "text-ink-400"
                  }`}
                >
                  {phase.name}
                </span>
                {phase.state === "current" && (
                  <span className="ml-auto font-mono text-[11px] text-warn-500">
                    in progress
                  </span>
                )}
              </li>
            ))}
          </ol>
        </section>

        <footer className="border-t border-ink-800 pt-6">
          <p className="text-xs leading-relaxed text-ink-400">
            <span className="text-ink-300">Nothing here is mocked.</span> The block height,
            chain ID and gas price above are read from{" "}
            <span className="font-mono">{MST_TESTNET.rpcUrl}</span> on every page load. When
            contracts and markets exist, every address and transaction hash shown will
            resolve on MSTScan. Resolution in AuspeX is a{" "}
            <span className="text-ink-300">trusted</span> role — see the trust model in the
            repository.
          </p>
        </footer>
      </div>
    </main>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-3 font-mono text-[11px] tracking-widest text-ink-400 uppercase">
      {children}
    </h2>
  );
}

function Stat({
  label,
  value,
  children,
}: {
  label: string;
  value: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="border-b border-ink-800 px-4 py-3 sm:border-b-0">
      <dt className="font-mono text-[11px] tracking-wide text-ink-400 uppercase">
        {label}
      </dt>
      <dd className="mt-1 font-mono text-lg text-ink-100 tabular-nums">{value}</dd>
      {children && <div className="mt-1 font-mono text-[11px]">{children}</div>}
    </div>
  );
}

function Row({
  label,
  value,
  href,
  note,
  muted,
  last,
}: {
  label: string;
  value: string;
  href?: string;
  note?: string;
  muted?: boolean;
  last?: boolean;
}) {
  return (
    <div
      className={`flex flex-col gap-0.5 px-4 py-2.5 sm:flex-row sm:items-baseline sm:gap-4 ${
        last ? "" : "border-b border-ink-800"
      }`}
    >
      <dt className="w-24 shrink-0 text-xs text-ink-400">{label}</dt>
      <dd className={`break-all ${muted ? "text-ink-400 italic" : "text-ink-100"}`}>
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="text-signal-500 underline-offset-2 hover:underline"
          >
            {value}
          </a>
        ) : (
          value
        )}
        {note && <span className="ml-2 text-[11px] text-ink-400">— {note}</span>}
      </dd>
    </div>
  );
}
