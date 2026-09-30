import { explorerUrl, formatMstc, shortHash } from "@/lib/chain";
import { AUSPEX_MARKET_ADDRESS } from "@/lib/chain/deployment";
import { agentSystemInstruction } from "@/lib/agents/analyst";
import {
  getAgentsForDisplay,
  type AgentPanel,
  type DecisionView,
} from "@/lib/agents/dashboard";
import { POLICY_RULES } from "@/lib/policy/policyGate";
import { Provenance } from "@/components/Provenance";
import { SiteNav } from "@/components/SiteNav";
import {
  Counter,
  Field,
  PageHeader,
  PageShell,
  Row,
  SectionLabel,
} from "@/components/ui";

// Every on-chain figure here is an eth_call made on this request. Never cache it.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = {
  title: "Agents — AuspeX",
  description:
    "Member agents, the deterministic policy gate that bounds them, and every decision it has taken — approvals and refusals alike.",
};

const STATUS_STYLE: Record<string, string> = {
  POLICY_APPROVED: "border-ok-500/40 bg-ok-500/10 text-ok-500",
  TX_PENDING: "border-signal-500/40 bg-signal-500/10 text-signal-500",
  TX_CONFIRMED: "border-ok-500/40 bg-ok-500/10 text-ok-500",
  POLICY_REJECTED: "border-warn-500/40 bg-warn-500/10 text-warn-500",
  TX_FAILED: "border-bad-500/40 bg-bad-500/10 text-bad-500",
  PROPOSED: "border-ink-600 bg-ink-800 text-ink-300",
};

export default async function AgentsPage() {
  const payload = await getAgentsForDisplay();

  const staked = payload.decisions
    .filter((decision) => decision.chainStatus === "CONFIRMED")
    .reduce((total, decision) => total + (decision.finalStakeWei ?? 0n), 0n);
  const refusedOnChain = payload.decisions.filter(
    (decision) => decision.chainStatus === "REVERTED",
  ).length;
  const rejectedByGate = payload.decisions.filter(
    (decision) => decision.status === "POLICY_REJECTED",
  ).length;

  return (
    <PageShell>
      <SiteNav current="/agents" />

      <PageHeader
        eyebrow="Bounded twice"
        title="Member agents"
        lede={
          <>
            Each member has an AI agent that proposes a side, a confidence and a stake. It never
            decides any of those things. A{" "}
            <span className="text-ink-100">pure, deterministic policy gate</span> clamps the
            stake against six limits and records its reasons, and then the{" "}
            <span className="text-ink-100">contract caps it again</span> — so the numbers below
            are bounded twice, by code that does not trust the model and by a chain that does
            not trust us.
          </>
        }
      >
        {/* Two badges, because this page genuinely mixes two sources and conflating them is
            exactly the mistake the component exists to prevent: the caps and balances are the
            chain's, the decisions and reasons are ours. */}
        <span className="flex flex-wrap gap-x-4 gap-y-2">
          <Provenance origin="CHAIN" detail="agents() caps · balances · agentRemainingOnMarket()" />
          <Provenance origin="DB" detail="agent_decisions · agent_policies" />
        </span>
      </PageHeader>

      {/* The counters that matter. All zero would mean the gates have never been exercised.
       *
       * When the database is unreachable these read `—`, not `0`. A zero beside "could not read
       * the database" is a measurement claim the page is in no position to make, and it claims
       * the flattering direction: "nothing was ever refused" reads as "nothing ever went wrong".
       * Found by running the built app against an unreachable Postgres. */
      }
      <section className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Counter
          label="staked on chain"
          value={payload.dbError !== null ? "—" : `${formatMstc(staked)} tMSTC`}
          tone={payload.dbError !== null ? "quiet" : "ok"}
        />
        <Counter
          label="rejected by the gate"
          value={payload.dbError !== null ? "—" : String(rejectedByGate)}
          tone={payload.dbError !== null || rejectedByGate === 0 ? "quiet" : "warn"}
        />
        <Counter
          label="refused by the chain"
          value={payload.dbError !== null ? "—" : String(refusedOnChain)}
          tone={payload.dbError !== null || refusedOnChain === 0 ? "quiet" : "bad"}
        />
        <Counter
          label="agents"
          value={payload.dbError !== null ? "—" : String(payload.panels.length)}
          tone="quiet"
        />
      </section>

      {payload.globalKillSwitch && (
        <div className="mb-8 rounded-xl border border-bad-500/40 bg-bad-500/5 px-4 py-3">
          <p className="font-mono text-sm text-bad-500">
            AGENTS_KILL_SWITCH is on — every agent is halted
          </p>
          <p className="mt-2 text-xs leading-relaxed text-ink-400">
            No agent is being screened, no model is being asked, and no transaction is being
            prepared. This is an <span className="text-ink-300">off-chain</span> halt: the
            contract was not involved and its caps are unchanged. Turning it off is an
            environment variable, not a transaction.
          </p>
        </div>
      )}

      {payload.dbError !== null && (
        <div className="mb-8 rounded-xl border border-bad-500/40 bg-bad-500/5 px-4 py-3">
          <p className="font-mono text-sm text-bad-500">could not read the database</p>
          <p className="mt-2 font-mono text-xs text-ink-400">{payload.dbError}</p>
        </div>
      )}

      {payload.chainError !== null && (
        <div className="mb-8 rounded-xl border border-warn-500/40 bg-warn-500/5 px-4 py-3">
          <p className="font-mono text-xs text-warn-500">
            on-chain caps unavailable — {payload.chainError}
          </p>
          <p className="mt-1 text-xs text-ink-400">
            The on-chain column below is left empty rather than filled with our own numbers. The
            whole point of showing both is that they come from different places.
          </p>
        </div>
      )}

      {payload.panels.length === 0 && payload.dbError === null && (
        <div className="rounded-xl border border-ink-700 bg-ink-900 px-4 py-10 text-center">
          <p className="text-ink-300">No member has an agent wallet yet.</p>
          <p className="mt-2 font-mono text-xs text-ink-400">
            pnpm --filter web agents:register
          </p>
        </div>
      )}

      <div className="space-y-4">
        {payload.panels.map((panel) => (
          <AgentCard key={panel.memberId} panel={panel} />
        ))}
      </div>

      {/* ---- The gate's rules, from the same module that enforces them ---- */}
      <section className="mt-10">
        <SectionLabel>What the gate checks, in order</SectionLabel>
        <ol className="mt-3 space-y-1.5 rounded-xl border border-ink-700 bg-ink-900 px-4 py-4">
          {POLICY_RULES.map((rule, index) => (
            <li key={rule} className="flex gap-3 text-sm text-ink-300">
              <span className="font-mono text-xs text-ink-500">{index + 1}</span>
              <span>{rule}</span>
            </li>
          ))}
        </ol>
        <p className="mt-3 text-xs leading-relaxed text-ink-400">
          This list is exported from{" "}
          <span className="font-mono text-ink-300">lib/policy/policyGate.ts</span> — the same
          module that enforces it — so the page cannot describe a rule that is not applied. The
          gate is a pure function: no network, no database, no clock. Time, balances and on-chain
          caps are all passed in, which is why every branch above is covered by a unit test that
          needs no infrastructure.
        </p>
      </section>

      {/* ---- The decision log. The refusals are the point. ---- */}
      <section className="mt-10">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <SectionLabel>Every decision, approved and refused</SectionLabel>
          <span className="font-mono text-[11px] text-ink-400">
            {payload.decisions.length} recorded
          </span>
        </div>

        {payload.decisions.length === 0 ? (
          <div className="rounded-xl border border-ink-700 bg-ink-900 px-4 py-10 text-center">
            <p className="text-ink-300">No decision has been taken yet.</p>
            <p className="mt-2 font-mono text-xs text-ink-400">pnpm --filter web tick</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {payload.decisions.map((decision) => (
              <DecisionCard key={decision.id} decision={decision} />
            ))}
          </ul>
        )}
      </section>

      {/* ---- The prompt, verbatim ---- */}
      <section className="mt-10">
        <SectionLabel>The instruction every agent is given</SectionLabel>
        <p className="mt-2 mb-3 text-xs leading-relaxed text-ink-400">
          Trusted operator text. No article content ever reaches it — news goes into a user-role
          message inside <span className="font-mono text-ink-300">&lt;untrusted_content&gt;</span>{" "}
          tags. Note what the agent is <span className="text-ink-300">not</span> told: its
          confidence threshold, and its caps in any unit. An agent that knew the threshold would
          report it, and an agent that could name an amount could name the wrong one.
        </p>
        <pre className="overflow-x-auto rounded-xl border border-ink-700 bg-ink-950 px-4 py-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-ink-300">
          {agentSystemInstruction()}
        </pre>
      </section>

      <footer className="mt-10 border-t border-ink-800 pt-6">
        <p className="text-xs leading-relaxed text-ink-400">
          Every agent wallet above holds <span className="text-ink-300">no role</span> on{" "}
          <a
            href={explorerUrl("address", AUSPEX_MARKET_ADDRESS)}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-signal-500 underline-offset-2 hover:underline"
          >
            {shortHash(AUSPEX_MARKET_ADDRESS, 8, 6)}
          </a>
          . It can place a capped bet and claim — it cannot create a market, propose a resolution,
          grant a role or pause anything, and its winnings are paid to the registered owner
          address rather than to itself. Those are contract rules, so they hold even with this
          server fully compromised.{" "}
          <span className="text-ink-300">
            The honest limitation: agent keys are server-held and encrypted at rest, which is
            hygiene. The on-chain caps are what actually bound the risk.
          </span>
        </p>
      </footer>
    </PageShell>
  );
}

function AgentCard({ panel }: { panel: AgentPanel }) {
  const halted = panel.policy.killSwitch;
  const dailyUsed =
    panel.policy.dailyBudgetWei === 0n
      ? 0
      : Number((panel.spentTodayWei * 1000n) / panel.policy.dailyBudgetWei) / 10;

  // Both per-tx caps drawn against the larger of the two, so the bars are comparable and the
  // difference between the operational limit and the contract's outer bound is visible.
  const scale =
    panel.onChain !== null && panel.onChain.perTxCapWei > panel.policy.perTxCapWei
      ? panel.onChain.perTxCapWei
      : panel.policy.perTxCapWei;

  return (
    <section className="overflow-hidden rounded-xl border border-ink-700 bg-ink-900">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-ink-800 px-4 py-2.5">
        <span className="font-mono text-sm text-ink-100">{panel.handle}</span>
        {halted ? (
          <span className="rounded border border-bad-500/40 bg-bad-500/10 px-1.5 py-0.5 font-mono text-[10px] tracking-wide text-bad-500 uppercase">
            kill switch on
          </span>
        ) : (
          <span className="rounded border border-ok-500/40 bg-ok-500/10 px-1.5 py-0.5 font-mono text-[10px] tracking-wide text-ok-500 uppercase">
            active
          </span>
        )}
        {panel.onChain !== null && (
          <span
            className={`rounded border px-1.5 py-0.5 font-mono text-[10px] tracking-wide uppercase ${
              panel.onChain.registered
                ? "border-signal-500/40 bg-signal-500/10 text-signal-500"
                : "border-warn-500/40 bg-warn-500/10 text-warn-500"
            }`}
          >
            {panel.onChain.registered ? "capped on chain" : "not registered"}
          </span>
        )}
        <a
          href={explorerUrl("address", panel.agentAddress)}
          target="_blank"
          rel="noreferrer"
          className="ml-auto font-mono text-[11px] text-signal-500 underline-offset-2 hover:underline"
        >
          {shortHash(panel.agentAddress, 8, 6)} ↗
        </a>
      </div>

      <div className="px-4 py-4">
        {panel.note !== null && (
          <p className="mb-4 text-sm text-ink-300">{panel.note}</p>
        )}

        {/* The two limits, side by side. This is the phase's central claim, drawn. */}
        <div className="space-y-3">
          <CapBar
            label="off-chain per-tx cap"
            sublabel="agent_policies — an operator can change this with an UPDATE"
            valueWei={panel.policy.perTxCapWei}
            scaleWei={scale}
            tone="signal"
          />
          {panel.onChain === null ? (
            <p className="font-mono text-[11px] text-ink-500">
              on-chain per-tx cap — unavailable, the chain could not be read
            </p>
          ) : (
            <CapBar
              label="on-chain per-tx cap"
              sublabel="AuspexMarket.agents() — changing this costs an admin transaction"
              valueWei={panel.onChain.perTxCapWei}
              scaleWei={scale}
              tone="human"
            />
          )}
        </div>

        {panel.drift !== null && (
          <p className="mt-3 rounded border border-warn-500/40 bg-warn-500/5 px-2.5 py-1.5 font-mono text-[11px] text-warn-500">
            registry drift: {panel.drift}
          </p>
        )}

        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 border-t border-ink-800 pt-4 sm:grid-cols-4">
          <Field label="daily budget">
            <span className="text-ink-100">
              {formatMstc(panel.spentTodayWei)} / {formatMstc(panel.policy.dailyBudgetWei)}
            </span>
            <span className="ml-1 text-ink-400">({dailyUsed.toFixed(0)}%)</span>
          </Field>
          <Field label="min confidence">
            <span className="text-ink-100">{panel.policy.minConfidence.toFixed(2)}</span>
          </Field>
          <Field label="wallet">
            {panel.balanceWei === null ? (
              <span className="text-ink-400">—</span>
            ) : (
              <span className="text-ink-100">{formatMstc(panel.balanceWei)} tMSTC</span>
            )}
          </Field>
          <Field label="on-chain per-market">
            {panel.onChain === null ? (
              <span className="text-ink-400">—</span>
            ) : (
              <span className="text-ink-100">
                {formatMstc(panel.onChain.perMarketCapWei)} tMSTC
              </span>
            )}
          </Field>
        </dl>

        <dl className="mt-4 space-y-1.5 border-t border-ink-800 pt-3 font-mono text-[11px]">
          <Row label="categories">
            <span className="text-ink-200">
              {panel.policy.allowedCategories.join(" · ") || "none"}
            </span>
          </Row>
          <Row label="winnings to">
            <a
              href={explorerUrl("address", panel.ownerAddress)}
              target="_blank"
              rel="noreferrer"
              className="break-all text-signal-500 underline-offset-2 hover:underline"
            >
              {panel.ownerAddress}
            </a>
            {panel.onChain !== null && panel.onChain.owner === panel.ownerAddress && (
              <span className="ml-2 text-ok-500">✓ matches the contract</span>
            )}
          </Row>
        </dl>

        {panel.marketSpend.length > 0 && (
          <div className="mt-4 border-t border-ink-800 pt-3">
            <p className="mb-2 font-mono text-[10px] tracking-wide text-ink-400 uppercase">
              staked per market, against the cap the contract enforces
            </p>
            <div className="space-y-2">
              {panel.marketSpend.map((spend) => (
                <CapBar
                  key={spend.onchainId}
                  label={`#${spend.onchainId} — ${spend.question.slice(0, 54)}…`}
                  sublabel={`${formatMstc(spend.stakedWei)} of ${formatMstc(spend.perMarketCapWei)} tMSTC on-chain per-market cap`}
                  valueWei={spend.stakedWei}
                  scaleWei={spend.perMarketCapWei}
                  tone="ok"
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function DecisionCard({ decision }: { decision: DecisionView }) {
  // The chain is authoritative where it has spoken. The decision's own column is the fallback.
  const effective =
    decision.chainStatus === "CONFIRMED"
      ? "TX_CONFIRMED"
      : decision.chainStatus === "REVERTED"
        ? "TX_FAILED"
        : decision.status;

  const bypassed = decision.reasons.some((reason) => reason.startsWith("GATE_BYPASSED"));

  return (
    <li
      className={`overflow-hidden rounded-xl border bg-ink-900 ${
        bypassed ? "border-bad-500/40" : "border-ink-700"
      }`}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-ink-800 px-4 py-2.5">
        <span className="font-mono text-xs text-ink-200">{decision.handle}</span>
        <span className="font-mono text-xs text-ink-400">
          #{decision.onchainId ?? "?"}
          {decision.round !== 1 && (
            <span className="ml-1 text-ink-500">round {decision.round}</span>
          )}
        </span>
        <span
          className={`rounded border px-1.5 py-0.5 font-mono text-[10px] tracking-wide uppercase ${
            STATUS_STYLE[effective] ?? "border-ink-600 bg-ink-800 text-ink-300"
          }`}
        >
          {effective.replace(/_/g, " ")}
        </span>
        {/* The side is spelled out rather than coloured. It is a position, not a verdict. ADR-073. */}
        {decision.side !== null && (
          <span className="font-mono text-[10px] tracking-wide text-ink-100 uppercase">
            {decision.side}
          </span>
        )}
        {bypassed && (
          <span className="rounded border border-bad-500/40 bg-bad-500/10 px-1.5 py-0.5 font-mono text-[10px] tracking-wide text-bad-500 uppercase">
            gate bypassed on purpose
          </span>
        )}
        {decision.txHash !== null && (
          <a
            href={explorerUrl("tx", decision.txHash)}
            target="_blank"
            rel="noreferrer"
            className="ml-auto font-mono text-[11px] text-signal-500 underline-offset-2 hover:underline"
          >
            {shortHash(decision.txHash, 8, 6)} ↗
          </a>
        )}
      </div>

      <div className="px-4 py-3">
        <p className="text-sm text-ink-200">{decision.question}</p>

        <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
          <Field label="confidence">
            {decision.confidence === null ? (
              <span className="text-ink-400">—</span>
            ) : (
              <span className="text-ink-100">{decision.confidence.toFixed(2)}</span>
            )}
          </Field>
          <Field label="asked for">
            {decision.requestedStakeWei === null ? (
              <span className="text-ink-400">—</span>
            ) : (
              <span className="text-ink-100">
                {formatMstc(decision.requestedStakeWei)} tMSTC
              </span>
            )}
          </Field>
          <Field label="gate allowed">
            {decision.finalStakeWei === null ? (
              <span className="text-warn-500">nothing</span>
            ) : (
              <span className="text-ok-500">{formatMstc(decision.finalStakeWei)} tMSTC</span>
            )}
          </Field>
          <Field label="block">
            {decision.blockNumber === null ? (
              <span className="text-ink-400">—</span>
            ) : (
              <span className="text-ink-100">
                {decision.blockNumber.toLocaleString("en-US")}
              </span>
            )}
          </Field>
        </dl>

        {decision.rationale !== null && (
          <p className="mt-3 border-l-2 border-ink-700 pl-3 text-xs leading-relaxed text-ink-300">
            {decision.rationale}
            {decision.sources.length > 0 && (
              <span className="ml-1 font-mono text-ink-500">
                [{decision.sources.join(", ")}]
              </span>
            )}
          </p>
        )}

        {/* The gate's own words. Verbatim — this is the evidence the gate is real. */}
        <ul className="mt-3 space-y-1">
          {decision.reasons.map((reason) => {
            const [code, ...rest] = reason.split(":");
            const detail = rest.join(":").trim();
            const tone = code.startsWith("APPROVED")
              ? "text-ok-500"
              : code.startsWith("CLAMPED_BY") || code.startsWith("AT_LIMIT")
                ? "text-signal-500"
                : code.startsWith("CHAIN_REFUSED") || code.startsWith("GATE_BYPASSED")
                  ? "text-bad-500"
                  : code.startsWith("CHAIN_CONFIRMED")
                    ? "text-ok-500"
                    : "text-warn-500";
            return (
              <li key={reason} className="font-mono text-[11px] leading-relaxed">
                <span className={tone}>{code}</span>
                <span className="text-ink-400"> {detail}</span>
              </li>
            );
          })}
        </ul>

        {decision.revertReason !== null && (
          <p className="mt-3 rounded border border-bad-500/40 bg-bad-500/5 px-2.5 py-1.5 font-mono text-[11px] break-all text-bad-500">
            the contract refused this transaction: {decision.revertReason}
          </p>
        )}
      </div>
    </li>
  );
}

function CapBar({
  label,
  sublabel,
  valueWei,
  scaleWei,
  tone,
}: {
  label: string;
  sublabel: string;
  valueWei: bigint;
  scaleWei: bigint;
  tone: "signal" | "human" | "ok";
}) {
  const percent =
    scaleWei === 0n ? 0 : Math.min(100, Number((valueWei * 1000n) / scaleWei) / 10);
  const fill =
    tone === "signal" ? "bg-signal-500" : tone === "human" ? "bg-human-500" : "bg-ok-500";

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <span className="font-mono text-[11px] text-ink-200">{label}</span>
        <span className="font-mono text-[11px] tabular-nums text-ink-100">
          {formatMstc(valueWei)} tMSTC
        </span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-ink-800">
        <div className={`h-full rounded-full ${fill}`} style={{ width: `${percent}%` }} />
      </div>
      <p className="mt-1 font-mono text-[10px] text-ink-500">{sublabel}</p>
    </div>
  );
}

