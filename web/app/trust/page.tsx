import Link from "next/link";
import { MST_TESTNET, explorerUrl, shortHash } from "@/lib/chain";
import { AUSPEX_MARKET_ADDRESS } from "@/lib/chain/deployment";
import { hasDatabase } from "@/lib/db/client";
import { DOCUMENTED_ORIGINS, ORIGIN_META, Provenance } from "@/components/Provenance";
import {
  Counter,
  PageHeader,
  PageShell,
  SectionLabel,
  TONE,
  type Tone,
} from "@/components/ui";
import {
  capProbes,
  reasonlessActions,
  refusedTransactions,
  trustCounters,
  type CapProbeRow,
  type RefusalBucket,
  type TrustCounters,
} from "@/lib/trust/counters";
import {
  ROLE_NAMES,
  ROLE_POWERS,
  holdsNoRole,
  roleReport,
  type RoleReport,
} from "@/lib/trust/roles";
import { POLICY_RULES } from "@/lib/policy/policyGate";
import { VALIDATION_RULES } from "@/lib/proposer/validate";
import { RESOLUTION_RULES } from "@/lib/resolution/validate";
import { globalKillSwitch } from "@/lib/agents/members";
import { CapProbeButton } from "./CapProbeButton";

// Every role read and every counter is made on this request. A cached trust page is a lie with a
// timestamp on it.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = {
  title: "Trust — AuspeX",
  description:
    "Where authority lives in AuspeX, proved rather than asserted: the live role matrix read from the contract, every refusal counted, and a transaction a visitor can make the chain refuse.",
};

/**
 * The page that has to survive being disbelieved.
 *
 * Everything else on this site shows what AuspeX *did*. This page shows what it *cannot do*, which
 * is the harder and more interesting claim, and every part of it is an `eth_call` or a `GROUP BY`
 * rather than a sentence. Four sections, in the order a sceptic would ask:
 *
 *   1. **The boundary** — what an LLM may decide, what code decides, what only a human or the
 *      chain decides. Rules pulled from the modules that enforce them, so the page cannot describe
 *      a rule that is not in the code.
 *   2. **Who holds what** — `hasRole` for every role against every address we know, including an
 *      `eth_call` of `pause()` from the most privileged wallet in the system, which reverts.
 *   3. **What has been refused** — four layers of refusal, counted, with the chain's own error
 *      names and every reverted transaction hash.
 *   4. **The cap probe** — a button that makes the chain refuse something, for a visitor holding
 *      no wallet and no tMSTC.
 */
export default async function TrustPage() {
  const [roles, data] = await Promise.all([roleReport(), loadCounters()]);

  return (
    <PageShell current="/trust">

      <PageHeader
        eyebrow="What it cannot do"
        title="Trust"
        lede={
          <>
            Every other page shows what this system did. This one shows what it{" "}
            <span className="text-ink-100">cannot</span> do — and asks the contract rather than
            telling you. The role matrix below is{" "}
            <span className="font-mono text-ink-200">hasRole()</span> read on this request; the
            counters are queries; the button at the bottom lets you make the chain refuse a
            transaction yourself, with no wallet.
          </>
        }
      />

      {/* ---- 1. The boundary ------------------------------------------------------------ */}
      <section className="mb-10">
        <SectionLabel className="mb-3">
          The boundary
          <Provenance origin="COMPUTED" detail="rules imported from the modules that enforce them" />
        </SectionLabel>

        <div className="grid gap-3 lg:grid-cols-3">
          <Column
            tone="signal"
            heading="An LLM may only propose"
            foot="Schema-constrained at the API and re-validated with Zod before any code reads it. A model that returns nothing, times out or rate-limits results in no action at all."
            items={[
              "which of two headlines describe the same event, inside a fixed similarity band",
              "a draft market question, category, close time and resolution source",
              "a side, a confidence, and a stake as a fraction of a cap it is never shown",
              "a draft outcome plus a verbatim quote from an article it was handed",
            ]}
          />
          <Column
            tone="human"
            heading="Deterministic code decides"
            foot="Pure functions, no clock of their own, no network. Every one of them is unit-tested from both sides of its boundary, and every refusal is written down with its reason."
            // The counts are `.length` on the exported rule arrays, so this column cannot
            // claim a rule count the code does not have. The sample below them is the first
            // few policy rules verbatim — same arrays `/agents` and `/resolve` render in full.
            items={[
              `${VALIDATION_RULES.length} rules on a drafted market spec, before a human sees it`,
              `${RESOLUTION_RULES.length} rules on a drafted outcome, every failing one collected`,
              `${POLICY_RULES.length} rules on an agent's bet, in order`,
              ...POLICY_RULES.slice(0, 3),
            ]}
          />
          <Column
            tone="ok"
            heading="Only a human or the chain decides"
            foot="No key the deployed application holds can do any of these. That is not a policy — it is the role matrix below."
            items={[
              "createMarket — signed in a browser wallet, by a person who read the spec",
              "proposeResolution — signed in a browser wallet, with a public evidence URL",
              "challengeResolution — signed in a browser wallet, inside the window",
              "the per-transaction and per-market caps on every agent",
              "registerAgent, deactivateAgent, pause — admin only, key held offline",
            ]}
          />
        </div>

        <p className="mt-3 text-xs leading-relaxed text-ink-400">
          The left column is the only place a model appears, and nothing in it is a decision —
          each item is a <span className="text-ink-200">suggestion that the middle column is
          free to throw away</span>. The middle column has no network access and no clock it did
          not receive as an argument, which is what makes it testable. The right column is
          enforced by a contract whose source is verified on MSTScan, so it holds even if
          everything to its left is compromised.
        </p>
      </section>

      {/* ---- 2. Who holds what --------------------------------------------------------- */}
      <section className="mb-10">
        <SectionLabel className="mb-3">
          Who holds what, according to the contract
          <Provenance origin="CHAIN" detail={`hasRole() × ${ROLE_NAMES.length} per address`} />
        </SectionLabel>
        <RoleMatrix roles={roles} />
      </section>

      {/* ---- 3. The kill switch -------------------------------------------------------- */}
      <section className="mb-10">
        <SectionLabel className="mb-3">
          Kill switches
          <Provenance origin="CHAIN" detail="paused() + an eth_call of pause()" />
        </SectionLabel>
        <KillSwitches roles={roles} />
      </section>

      {/* ---- 4. What has been refused -------------------------------------------------- */}
      <section className="mb-10">
        <SectionLabel className="mb-3">
          What has been refused
          <Provenance origin="DB" detail="GROUP BY over proposals · resolution_drafts · agent_decisions · onchain_intents" />
        </SectionLabel>

        {data.error !== null ? (
          <ErrorPanel title="refusal counters unavailable" detail={data.error}>
            These are live queries against Postgres on every load. The Neon free tier scales to
            zero, so the first request after a quiet period can take 10–25 seconds. Nothing on
            this page falls back to a remembered number.
          </ErrorPanel>
        ) : data.counters === null ? null : (
          <Refusals counters={data.counters} reasonless={data.reasonless} />
        )}
      </section>

      {/* Every reverted transaction, in full. The most checkable artifact on the site. */}
      {data.refused.length > 0 && (
        <section className="mb-10">
          <SectionLabel className="mb-3">
            Transactions the chain refused
            <Provenance origin="INDEXED" detail="onchain_intents where status = REVERTED" />
          </SectionLabel>
          <ul className="flex flex-col gap-2">
            {data.refused.map((tx) => (
              <li
                key={tx.id}
                className="overflow-hidden rounded-2xl border border-bad-500/30 bg-bad-500/10"
              >
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-bad-500/20 px-3 py-2">
                  <span className="font-mono text-xs text-ink-200">{tx.functionName}</span>
                  <span className="font-mono text-[11px] text-bad-500">
                    {tx.revertReason ?? "revert reason not decoded"}
                  </span>
                  {tx.txHash !== null && (
                    <a
                      href={explorerUrl("tx", tx.txHash)}
                      target="_blank"
                      rel="noreferrer"
                      className="ml-auto shrink-0 font-mono text-[11px] text-signal-500 underline-offset-2 hover:underline"
                    >
                      {shortHash(tx.txHash, 10, 8)} ↗
                    </a>
                  )}
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 px-3 py-2 font-mono text-[11px] text-ink-400">
                  <span>from {shortHash(tx.fromAddress, 8, 6)}</span>
                  <span>value {tx.valueWei} wei</span>
                  {tx.blockNumber !== null && <span>block {tx.blockNumber}</span>}
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs leading-relaxed text-ink-400">
            These are <span className="text-ink-200">not bugs</span>. Each one is a transaction
            this server signed and broadcast, and the contract refused. Open any hash: MSTScan
            shows it as <span className="font-mono text-bad-500">Reverted</span> with the
            contract&apos;s own error and its arguments. A system where this list is empty has
            never had its on-chain limits tested.
          </p>
        </section>
      )}

      {/* ---- 5. The cap probe ---------------------------------------------------------- */}
      <section className="mb-10">
        <SectionLabel className="mb-3">
          The cap probe — make the chain refuse something
          <Provenance origin="CHAIN" detail="a real placeBet, signed on request" />
        </SectionLabel>

        <div className="lit-edge rounded-2xl border border-ink-700 bg-ink-900">
          <div className="border-b border-ink-800 px-4 py-3">
            <p className="text-sm leading-relaxed text-ink-300">
              No wallet, no tMSTC, no faucet. This button reads a registered agent&apos;s
              on-chain per-transaction cap from the contract, adds{" "}
              <span className="text-ink-100">exactly one wei</span>, and sends the bet with the
              policy gate deliberately not consulted — which is what a compromised server would
              do. You get a real transaction hash that resolves on MSTScan.
            </p>
            <p className="mt-2 text-xs leading-relaxed text-ink-400">
              It is safe to hand a stranger for one reason:{" "}
              <span className="text-ink-200">the contract is going to refuse it</span>. An{" "}
              <span className="font-mono">eth_call</span> is made first and nothing is broadcast
              unless the chain confirms it will revert with{" "}
              <span className="font-mono">AgentPerTxCapExceeded</span> — a probe that could
              succeed does not run. A reverted <span className="font-mono">placeBet</span>{" "}
              returns its value, so the cost of a click is gas.
            </p>
          </div>

          <div className="px-4 py-4">
            <CapProbeButton explorerBase={MST_TESTNET.explorerUrl} />
          </div>

          {data.probes.length > 0 && (
            <div className="border-t border-ink-800">
              <p className="px-4 pt-3 font-mono text-[11px] tracking-wide text-ink-400 uppercase">
                probes already run
                <Provenance
                  className="ml-2"
                  origin="DB"
                  detail="audit_log where action = judge.cap_probe"
                />
              </p>
              <ul className="divide-y divide-ink-800">
                {data.probes.map((probe) => (
                  <ProbeLogRow key={probe.id} probe={probe} />
                ))}
              </ul>
              <p className="px-4 pt-1 pb-3 text-[11px] leading-relaxed text-ink-500">
                The stored action id above reads{" "}
                <span className="font-mono">judge.cap_probe</span>. This feature was built under
                an earlier name, and <span className="font-mono">audit_log</span> is append-only —
                so the label was changed and the identifier was not, rather than giving one event
                two names in a log that cannot be rewritten.
              </p>
            </div>
          )}
        </div>
      </section>

      {/* ---- 6. The provenance legend -------------------------------------------------- */}
      <section className="mb-10">
        <SectionLabel className="mb-3">
          How to read a badge on this site
          <Provenance origin="COMPUTED" detail="components/Provenance.tsx" />
        </SectionLabel>
        <ul className="overflow-hidden lit-edge rounded-2xl border border-ink-700 bg-ink-900">
          {DOCUMENTED_ORIGINS.map((origin, i) => (
            <li
              key={origin}
              className={`flex flex-col gap-1.5 px-4 py-3 sm:flex-row sm:items-baseline sm:gap-4 ${
                i < DOCUMENTED_ORIGINS.length - 1 ? "border-b border-ink-800" : ""
              }`}
            >
              <span className="shrink-0">
                <Provenance origin={origin} />
              </span>
              <span className="text-xs leading-relaxed text-ink-300">
                {ORIGIN_META[origin].blurb}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs leading-relaxed text-ink-400">
          There is a sixth origin for invented data, and it is{" "}
          <span className="text-ink-200">not on this list because it cannot be used</span>.
          Three independent things stop it: a CI check that fails if any file outside the
          component so much as names it, a runtime guard that throws rather than render it in a
          production build, and a scan of the build output for a badge that got through anyway.
          Run <span className="font-mono">pnpm --filter web check:provenance</span> to see all
          three.
        </p>
      </section>

      <footer className="border-t border-ink-800 pt-6">
        <p className="text-xs leading-relaxed text-ink-400">
          Contract{" "}
          <a
            href={explorerUrl("address", AUSPEX_MARKET_ADDRESS)}
            target="_blank"
            rel="noreferrer"
            className="font-mono text-signal-500 underline-offset-2 hover:underline"
          >
            {AUSPEX_MARKET_ADDRESS}
          </a>{" "}
          — verified source on MSTScan, so every guarantee on this page can be read in Solidity
          rather than taken from us. Resolution is a{" "}
          <span className="text-ink-200">trusted</span> role and the challenge window is
          120 seconds: both are limitations, both are stated in the README, and neither is hidden
          behind a claim on this page.
        </p>
      </footer>
    </PageShell>
  );
}

// ---------------------------------------------------------------------------
// Data loading
// ---------------------------------------------------------------------------

type CountersPayload = {
  counters: TrustCounters | null;
  refused: Awaited<ReturnType<typeof refusedTransactions>>;
  probes: CapProbeRow[];
  reasonless: RefusalBucket[];
  error: string | null;
};

/**
 * Loads everything Postgres-backed, or returns the real reason it could not be loaded.
 *
 * Never throws, for the same reason as the home page's `loadPipeline`: a sleeping Neon compute must
 * render an honest panel rather than a 500. A trust page that 500s is worse than one that says the
 * database was asleep — the first looks like something being hidden.
 */
async function loadCounters(): Promise<CountersPayload> {
  const empty: CountersPayload = {
    counters: null,
    refused: [],
    probes: [],
    reasonless: [],
    error: null,
  };

  if (!hasDatabase()) {
    return { ...empty, error: "DATABASE_URL is not configured on this deployment." };
  }

  try {
    const [counters, refused, probes, reasonless] = await Promise.all([
      trustCounters(),
      refusedTransactions(12),
      capProbes(6),
      reasonlessActions(),
    ]);
    return { counters, refused, probes, reasonless, error: null };
  } catch (error) {
    return { ...empty, error: error instanceof Error ? error.message : String(error) };
  }
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

function RoleMatrix({ roles }: { roles: RoleReport }) {
  if (roles.error !== null && roles.holders.length === 0) {
    return (
      <ErrorPanel title="role matrix unavailable" detail={roles.error}>
        Every cell in this table is an <span className="font-mono">eth_call</span> made on this
        request. There is no stored copy to fall back to — a remembered &ldquo;this wallet holds no
        roles&rdquo; would be the one number on this site worth faking, so it does not exist.
      </ErrorPanel>
    );
  }

  const serverKeys = roles.holders.filter((holder) => holder.heldByServer);
  const allServerKeysClean = serverKeys.length > 0 && serverKeys.every(holdsNoRole);

  return (
    <div className="overflow-hidden lit-edge rounded-2xl border border-ink-700 bg-ink-900">
      <div
        className={`flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-2.5 ${
          allServerKeysClean
            ? "border-ink-800 bg-ok-500/10"
            : "border-warn-500/40 bg-warn-500/10"
        }`}
      >
        <span
          className={`size-2 shrink-0 rounded-full ${allServerKeysClean ? "bg-ok-500" : "bg-warn-500"}`}
        />
        <span className="font-mono text-xs text-ink-300">
          {serverKeys.length === 0
            ? "no agent wallet could be listed, so the claim below is unproven on this load"
            : allServerKeysClean
              ? `all ${serverKeys.length} key(s) this deployment can sign with hold zero roles`
              : "a key this deployment holds carries a role — investigate"}
        </span>
      </div>

      {/* Two renderings of one array, and the reason is a defect found by looking at the page on a
          390px viewport: as a scrollable table, every role column started off-screen, so a reader
          on a phone saw the addresses and none of the crosses — which are the entire payload. Below
          `sm` the roles become labelled chips that wrap; at `sm` and up the aligned column of
          crosses is worth more, so the table comes back. Both map over `roles.holders`, so they
          cannot disagree about what the contract said. */}
      {roles.holders.length === 0 && (
        <p className="px-4 py-3 text-xs leading-relaxed text-ink-400">
          No address to check. Neither a human authority nor an agent wallet is configured on this
          deployment, so there is nothing to ask the contract about — which is itself the answer.
        </p>
      )}

      <ul className="divide-y divide-ink-800 sm:hidden">
        {roles.holders.map((holder) => (
          <li key={`card:${holder.address}`} className="px-4 py-3">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <a
                href={explorerUrl("address", holder.address)}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-xs text-signal-500 underline-offset-2 hover:underline"
              >
                {shortHash(holder.address, 8, 6)} ↗
              </a>
              <span
                className={`rounded border px-1.5 py-0.5 font-mono text-[10px] ${
                  holder.heldByServer
                    ? "border-warn-500/40 bg-warn-500/10 text-warn-500"
                    : "border-human-500/40 bg-human-500/10 text-human-500"
                }`}
              >
                {holder.heldByServer ? "this server" : "a browser"}
              </span>
            </div>
            <p className="mt-0.5 text-[11px] text-ink-400">{holder.label}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {ROLE_NAMES.map((role) => (
                <span
                  key={role}
                  title={`Lets its holder ${ROLE_POWERS[role]}.`}
                  className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px] ${
                    holder.error !== null
                      ? "border-ink-700 bg-ink-850 text-ink-500"
                      : holder.roles[role]
                        ? "border-warn-500/40 bg-warn-500/10 text-warn-500"
                        : "border-ink-700 bg-ink-850 text-ink-400"
                  }`}
                >
                  <RoleCell held={holder.roles[role]} error={holder.error} />
                  {role.replace(/_ROLE$/, "").replace(/^DEFAULT_/, "")}
                </span>
              ))}
            </div>
          </li>
        ))}
      </ul>

      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full min-w-max border-collapse text-left">
          <thead>
            <tr className="border-b border-ink-800">
              <th className="px-4 py-2 font-mono text-[10px] tracking-wide text-ink-400 uppercase">
                address
              </th>
              <th className="px-3 py-2 font-mono text-[10px] tracking-wide text-ink-400 uppercase">
                key held by
              </th>
              {ROLE_NAMES.map((role) => (
                <th
                  key={role}
                  title={`Lets its holder ${ROLE_POWERS[role]}.`}
                  className="px-3 py-2 font-mono text-[10px] tracking-wide text-ink-400 uppercase"
                >
                  {role.replace(/_ROLE$/, "").replace(/^DEFAULT_/, "")}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {roles.holders.map((holder) => (
              <tr key={`row:${holder.address}`} className="border-b border-ink-800">
                <td className="px-4 py-2.5">
                  <a
                    href={explorerUrl("address", holder.address)}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-xs text-signal-500 underline-offset-2 hover:underline"
                  >
                    {shortHash(holder.address, 8, 6)} ↗
                  </a>
                  <p className="mt-0.5 text-[11px] text-ink-400">{holder.label}</p>
                </td>
                <td className="px-3 py-2.5">
                  <span
                    className={`rounded border px-1.5 py-0.5 font-mono text-[10px] ${
                      holder.heldByServer
                        ? "border-warn-500/40 bg-warn-500/10 text-warn-500"
                        : "border-human-500/40 bg-human-500/10 text-human-500"
                    }`}
                  >
                    {holder.heldByServer ? "this server" : "a browser"}
                  </span>
                </td>
                {ROLE_NAMES.map((role) => (
                  <td key={role} className="px-3 py-2.5 font-mono text-sm">
                    <RoleCell held={holder.roles[role]} error={holder.error} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {roles.error !== null && (
        <p className="border-t border-warn-500/40 bg-warn-500/10 px-4 py-2.5 font-mono text-[11px] text-warn-500">
          {roles.error}
        </p>
      )}

      <div className="border-t border-ink-800 px-4 py-3">
        <p className="text-xs leading-relaxed text-ink-400">
          The badge beside each address is the thing to read.{" "}
          <span className="text-warn-500">this server</span> means the key is in the deployed
          application&apos;s environment — those rows should be nothing but crosses.{" "}
          <span className="text-human-500">a browser</span> means the key is in a wallet on a
          person&apos;s machine and this repository has never seen it.
        </p>
        <ul className="mt-2 flex flex-col gap-1">
          {ROLE_NAMES.map((role) => (
            <li key={role} className="text-[11px] text-ink-400">
              <span className="font-mono text-ink-300">{role}</span> — lets its holder{" "}
              {ROLE_POWERS[role]}.
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs leading-relaxed text-ink-400">
          The human wallet holds three roles, not one:{" "}
          <span className="font-mono text-ink-300">MARKET_CREATOR</span>,{" "}
          <span className="font-mono text-ink-300">RESOLVER</span> and{" "}
          <span className="font-mono text-ink-300">CHALLENGER</span> — every role that requires
          judgement, and <span className="text-ink-200">none that confers power</span>. It holds no{" "}
          <span className="font-mono text-ink-300">DEFAULT_ADMIN_ROLE</span>, so it cannot register
          an agent, change a cap or pause the contract either.
        </p>
      </div>
    </div>
  );
}

function RoleCell({ held, error }: { held: boolean; error: string | null }) {
  if (error !== null) {
    return (
      <span className="text-ink-500" title={error}>
        ?
      </span>
    );
  }
  return held ? (
    <span className="text-warn-500" title="holds this role">
      ●
    </span>
  ) : (
    <span className="text-ok-500" title="does not hold this role">
      ✕
    </span>
  );
}

function KillSwitches({ roles }: { roles: RoleReport }) {
  const probe = roles.pauseProbe;

  return (
    <div className="flex flex-col gap-3">
      {/* The on-chain switch: state, and who can pull it. */}
      <div className="overflow-hidden lit-edge rounded-2xl border border-ink-700 bg-ink-900">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-ink-800 px-4 py-2.5">
          <span
            className={`size-2 shrink-0 rounded-full ${
              roles.paused === null
                ? "bg-ink-600"
                : roles.paused
                  ? "bg-bad-500"
                  : "live-dot bg-ok-500"
            }`}
          />
          <span className="font-mono text-xs text-ink-300">
            on-chain kill switch —{" "}
            <span className={roles.paused === true ? "text-bad-500" : "text-ok-500"}>
              {roles.paused === null ? "unreadable" : roles.paused ? "PAUSED" : "not pulled"}
            </span>
          </span>
          <span className="ml-auto font-mono text-[11px] text-ink-400">paused() · eth_call</span>
        </div>

        <div className="px-4 py-3">
          <p className="text-xs leading-relaxed text-ink-300">
            <span className="text-ink-100">There is no button here, and that is the point.</span>{" "}
            <span className="font-mono">pause()</span> is{" "}
            <span className="font-mono">onlyRole(DEFAULT_ADMIN_ROLE)</span>, and this deployment
            holds no admin key — it is on a laptop, deliberately absent from Vercel (ADR-047). A
            control on this page would mean the opposite: that the running application could halt
            the contract, and therefore that a compromise of it could too.
          </p>

          <div className="mt-3 rounded border border-ink-800 bg-ink-850 px-3 py-2.5">
            <p className="font-mono text-[10px] tracking-wide text-ink-400 uppercase">
              what the contract says if the most privileged wallet in the running system tries
            </p>
            {probe.attempted && probe.refused ? (
              <>
                <p className="mt-1.5 font-mono text-xs break-all text-ink-300">
                  eth_call pause() from {shortHash(probe.from, 8, 6)}
                </p>
                <p className="mt-1 font-mono text-xs break-all text-bad-500">→ {probe.revert}</p>
                <p className="mt-2 text-xs leading-relaxed text-ink-400">
                  That address creates every market and signs every resolution on this
                  deployment, and it still cannot halt the contract. Probed from{" "}
                  <span className="text-ink-200">there</span> rather than from an agent wallet on
                  purpose: an agent being refused is unsurprising.
                </p>
              </>
            ) : probe.attempted && !probe.refused ? (
              <p className="mt-1.5 text-xs leading-relaxed text-bad-500">
                The call did <span className="font-semibold">not</span> revert, which means{" "}
                {shortHash(probe.from, 8, 6)} can pause the contract. That contradicts the claim
                above and should be treated as a finding, not a display bug.
              </p>
            ) : (
              <p className="mt-1.5 text-xs leading-relaxed text-ink-400">
                Not probed on this load — {probe.reason}
              </p>
            )}
          </div>

          <p className="mt-3 font-mono text-[11px] text-ink-400">
            to pull it, locally, with the admin key:{" "}
            <span className="text-ink-200">pnpm --filter web verify:agents</span> shows the switch;
            the pause itself is an admin transaction signed from the repo-root{" "}
            <span className="text-ink-200">.env.local</span>.
          </p>
        </div>
      </div>

      {/* The off-chain switches: weaker, ours, and honest about it. */}
      <div className="overflow-hidden lit-edge rounded-2xl border border-ink-700 bg-ink-900">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-ink-800 px-4 py-2.5">
          <span
            className={`size-2 shrink-0 rounded-full ${globalKillSwitch() ? "bg-bad-500" : "bg-ink-600"}`}
          />
          <span className="font-mono text-xs text-ink-300">
            off-chain kill switches —{" "}
            <span className={globalKillSwitch() ? "text-bad-500" : "text-ink-400"}>
              global {globalKillSwitch() ? "ON — every agent halted" : "off"}
            </span>
          </span>
          <Link
            href="/agents"
            className="ml-auto shrink-0 font-mono text-[11px] text-signal-500 underline-offset-2 hover:underline"
          >
            per-member state →
          </Link>
        </div>
        <p className="px-4 py-3 text-xs leading-relaxed text-ink-400">
          Two more switches exist and both are ours to operate:{" "}
          <span className="font-mono text-ink-300">AGENTS_KILL_SWITCH=true</span> halts every agent
          without a transaction, and each member has a flag the gate checks first. They are{" "}
          <span className="text-ink-200">weaker by construction</span> — they stop our code from
          asking for a bet, they do not stop a stolen agent key from placing one. What stops that
          is the cap, which is why the caps are on chain and these switches are not presented as
          the real bound.
        </p>
      </div>
    </div>
  );
}

function Refusals({
  counters,
  reasonless,
}: {
  counters: TrustCounters;
  reasonless: RefusalBucket[];
}) {
  const totalRefused =
    counters.schemaRefused.proposals +
    counters.schemaRefused.resolutionDrafts +
    counters.gate.total +
    counters.human.proposals +
    counters.human.resolutionDrafts +
    counters.chain.total;

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Counter
          label="by the schema"
          value={String(counters.schemaRefused.proposals + counters.schemaRefused.resolutionDrafts)}
          note={`${counters.schemaRefused.proposals} specs · ${counters.schemaRefused.resolutionDrafts} outcomes`}
          tone="signal"
        />
        <Counter
          label="by the policy gate"
          value={String(counters.gate.total)}
          note="deterministic, off-chain"
          tone="warn"
        />
        <Counter
          label="by a human"
          value={String(counters.human.proposals + counters.human.resolutionDrafts)}
          note={`${counters.human.proposals} specs · ${counters.human.resolutionDrafts} outcomes`}
          tone="human"
        />
        <Counter
          label="by the chain"
          value={String(counters.chain.total)}
          note="survives a compromised server"
          tone="bad"
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <Buckets
          heading="Policy-gate refusals, by its own reason code"
          empty="The gate has refused nothing yet. Until this list is non-empty, it has proven nothing."
          buckets={counters.gate.byReason}
          foot="Grouped on the machine-readable prefix every gate reason starts with. The sentence after it is on /agents, in full, on the decision it belongs to."
        />
        <Buckets
          heading="Chain refusals, by the contract's own error"
          empty="The chain has refused nothing yet. Press the button below and it will."
          buckets={counters.chain.byError}
          foot="The error name only — arguments differ per transaction and would make every revert its own bucket. Both numbers are in the revert reason on each transaction above."
          tone="bad"
        />
      </div>

      <div className="lit-edge rounded-2xl border border-ink-700 bg-ink-900 px-4 py-3">
        <p className="text-xs leading-relaxed text-ink-400">
          <span className="font-mono text-ink-200">{totalRefused}</span> refusals against{" "}
          <span className="font-mono text-ink-200">
            {counters.allowed.marketsCreated + counters.allowed.betsConfirmed + counters.allowed.resolutionsProposed + counters.allowed.claimsPaid}
          </span>{" "}
          confirmed transactions — {counters.allowed.marketsCreated} createMarket,{" "}
          {counters.allowed.betsConfirmed} placeBet, {counters.allowed.resolutionsProposed}{" "}
          proposeResolution, {counters.allowed.claimsPaid} claim. The ratio is the claim: a gate
          that refuses nothing is decoration.
        </p>
        <p className="mt-2 text-xs leading-relaxed text-ink-400">
          Those are confirmed <span className="font-mono text-ink-300">onchain_intents</span> rows,
          counted by contract function — so they include markets created by the crash test and the
          lifecycle script, which have no proposal behind them. The home page&apos;s{" "}
          <span className="text-ink-300">approved</span> counter is a different question (how many
          drafted specs a person signed) and will read lower. Neither is wrong; they count different
          things, and conflating them is how a dashboard starts overstating itself.
        </p>

        {/* A zero here is a real measurement and must not be dressed up as a guarantee. Two of the
            four layers have genuinely never fired on this deployment, and saying so is worth more
            than a counter a reader would assume had been tested. */}
        {(counters.schemaRefused.proposals + counters.schemaRefused.resolutionDrafts === 0 ||
          counters.human.proposals + counters.human.resolutionDrafts === 0) && (
          <p className="mt-2 text-xs leading-relaxed text-warn-500">
            A counter reading zero means that layer has not been exercised on live data yet — not
            that it cannot refuse anything.
            {counters.schemaRefused.proposals + counters.schemaRefused.resolutionDrafts === 0 &&
              " No model output has failed schema validation here: every draft so far has been structurally valid, and the refusal path is covered by unit tests rather than by a row in this database."}
            {counters.human.proposals + counters.human.resolutionDrafts === 0 &&
              " No person has refused a draft here: the human gate has been demonstrated by approving, not by declining."}{" "}
            Both are listed in <span className="font-mono text-ink-300">PROGRESS.md</span> under
            known gaps.
          </p>
        )}

        <p className="mt-2 text-xs leading-relaxed text-ink-400">
          <span className="font-mono text-ink-200">{counters.audit.withReason}</span> of{" "}
          <span className="font-mono text-ink-200">{counters.audit.total}</span> audit rows carry a
          written reason.{" "}
          {reasonless.length === 0 ? (
            <span className="text-ok-500">
              Every decision this system has taken says why — hard rule #7, as a query.
            </span>
          ) : (
            <span className="text-warn-500">
              {reasonless.map((row) => `${row.label} (${row.count})`).join(", ")} wrote no reason.
              That is a defect in the code that wrote them, shown rather than filtered out.
            </span>
          )}{" "}
          <Link href="/audit" className="text-signal-500 underline-offset-2 hover:underline">
            read the log →
          </Link>
        </p>
      </div>
    </div>
  );
}

function ProbeLogRow({ probe }: { probe: CapProbeRow }) {
  const cap = typeof probe.metadata.onChainPerTxCapWei === "string" ? probe.metadata.onChainPerTxCapWei : null;
  const attempted = typeof probe.metadata.attemptedWei === "string" ? probe.metadata.attemptedWei : null;
  const handle = typeof probe.metadata.handle === "string" ? probe.metadata.handle : "an agent";

  return (
    <li className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2.5">
      <span className="font-mono text-[11px] text-ink-400">
        {probe.createdAt.toISOString().replace("T", " ").slice(0, 19)}Z
      </span>
      <span className="font-mono text-[11px] text-ink-300">{handle}</span>
      {cap !== null && attempted !== null && (
        <span className="font-mono text-[11px] text-warn-500">
          {attempted} vs cap {cap}
        </span>
      )}
      {probe.txHash !== null ? (
        <a
          href={explorerUrl("tx", probe.txHash)}
          target="_blank"
          rel="noreferrer"
          className="ml-auto shrink-0 font-mono text-[11px] text-signal-500 underline-offset-2 hover:underline"
        >
          {shortHash(probe.txHash, 8, 6)} ↗
        </a>
      ) : (
        <span className="ml-auto shrink-0 font-mono text-[11px] text-ink-500">no hash</span>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Small pieces
// ---------------------------------------------------------------------------


function Column({
  heading,
  items,
  foot,
  tone,
}: {
  heading: string;
  items: readonly string[];
  foot: string;
  tone: Tone;
}) {
  return (
    <div className={`flex flex-col overflow-hidden rounded-2xl border bg-ink-900 ${TONE[tone].border}`}>
      <h3 className={`border-b border-ink-800 px-4 py-2.5 font-mono text-xs ${TONE[tone].text}`}>
        {heading}
      </h3>
      <ul className="flex flex-1 flex-col divide-y divide-ink-800">
        {items.map((item) => (
          <li key={item} className="px-4 py-2 text-xs leading-relaxed text-ink-300">
            {item}
          </li>
        ))}
      </ul>
      <p className="border-t border-ink-800 px-4 py-2.5 text-[11px] leading-relaxed text-ink-400">
        {foot}
      </p>
    </div>
  );
}

function Buckets({
  heading,
  buckets,
  empty,
  foot,
  tone = "warn",
}: {
  heading: string;
  buckets: RefusalBucket[];
  empty: string;
  foot: string;
  tone?: Tone;
}) {
  const max = buckets.reduce((high, bucket) => Math.max(high, bucket.count), 0);

  return (
    <div className="overflow-hidden lit-edge rounded-2xl border border-ink-700 bg-ink-900">
      <h3 className="border-b border-ink-800 px-4 py-2.5 font-mono text-xs text-ink-300">
        {heading}
      </h3>
      {buckets.length === 0 ? (
        <p className="px-4 py-3 text-xs leading-relaxed text-ink-400">{empty}</p>
      ) : (
        <ul className="divide-y divide-ink-800">
          {buckets.map((bucket) => (
            <li key={bucket.label} className="px-4 py-2">
              <div className="flex items-baseline gap-2">
                <span className={`min-w-0 flex-1 font-mono text-[11px] break-all ${TONE[tone].text}`}>
                  {bucket.label}
                </span>
                <span className="shrink-0 font-mono text-xs text-ink-200 tabular-nums">
                  {bucket.count}
                </span>
              </div>
              {/* A bar, not a chart: the relative shape is the information and an axis would be
                  three more things to get wrong. */}
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-ink-800">
                <div
                  className={`h-full rounded-full ${tone === "bad" ? "bg-bad-500/60" : "bg-warn-500/60"}`}
                  style={{ width: `${max === 0 ? 0 : Math.round((bucket.count / max) * 100)}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="border-t border-ink-800 px-4 py-2.5 text-[11px] leading-relaxed text-ink-400">
        {foot}
      </p>
    </div>
  );
}

function ErrorPanel({
  title,
  detail,
  children,
}: {
  title: string;
  detail: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-warn-500/40 bg-warn-500/10 px-4 py-3">
      <p className="font-mono text-sm text-warn-500">{title}</p>
      <p className="mt-2 font-mono text-xs break-words text-ink-400">{detail}</p>
      <p className="mt-2 text-xs leading-relaxed text-ink-400">{children}</p>
    </div>
  );
}
