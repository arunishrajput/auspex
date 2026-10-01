import Link from "next/link";
import { formatMstc, shortHash, MST_TESTNET } from "@/lib/chain";
import { AUSPEX_MARKET_ADDRESS } from "@/lib/chain/deployment";
import { getIndexerStatus, getMarketsForDisplay, type MarketView } from "@/lib/markets";
import { humanAuthorityAddress } from "@/lib/approval/authority";
import { formatIds, marketOrigins } from "@/lib/trust/signers";
import { Provenance } from "@/components/Provenance";
import {
  AddressLink,
  Badge,
  Callout,
  CardBody,
  CardHead,
  CardItem,
  EmptyState,
  ExtLink,
  Field,
  MARKET_STATE_TONE,
  Mono,
  PageHeader,
  PageShell,
  Row,
  TONE,
  TxLink,
} from "@/components/ui";

// Every number here is an eth_call made on this request. Never cache it.
export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = {
  title: "Markets — AuspeX",
  description: "Every market on the AuspexMarket contract, read live from MST Testnet.",
};


export default async function MarketsPage() {
  const [payload, indexer] = await Promise.all([getMarketsForDisplay(), getIndexerStatus()]);

  // Derived from the same rows rendered below, never written down. The sentence this replaced
  // named id ranges, was written when nine markets existed, and was wrong about four of them by
  // the time thirteen did — the fourth time in this project that prose beside a table
  // contradicted it. See `marketOrigins` for the argument and the tests.
  const origin = marketOrigins(payload.markets, humanAuthorityAddress());

  return (
    <PageShell current="/markets">

      <PageHeader
        eyebrow="On chain"
        title="Markets"
        lede={
          <>
            Every market that exists on{" "}
            <AddressLink address={AUSPEX_MARKET_ADDRESS} />, read from the contract on this page
            load. Pools and states come from <Mono>getMarket()</Mono>, not from our database — so
            if our indexer were wrong or asleep, these numbers would still be right.
          </>
        }
      >
        <Provenance origin="CHAIN" detail="getMarket() · marketCount(), per request" />
      </PageHeader>

      {/* Indexer status. Separate from the market data on purpose: it is a claim about OUR
          plumbing, not about the chain, and the two must not be confused. */}
      <section className="mb-8 lit-edge rounded-2xl border border-ink-700 bg-ink-900 px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 font-mono text-xs">
          <span className="text-ink-400">indexer</span>
          <Provenance origin="DB" detail="indexer_cursors · chain_events" />
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
        <Callout tone="bad" title="could not read the contract" className="mb-8">
          <p className="font-mono">{payload.chainError}</p>
          <p className="mt-2">
            This page shows the real error instead of a placeholder list. Nothing here is ever
            invented.
          </p>
        </Callout>
      )}

      {payload.indexError !== null && (
        <Callout
          tone="warn"
          title={`indexed detail unavailable — ${payload.indexError}`}
          className="mb-8"
        >
          Market state below is unaffected: it is read from the chain, not from the database.
        </Callout>
      )}

      {payload.chainError === null && payload.markets.length === 0 && (
        <EmptyState title="No markets exist on this contract yet.">
          <Mono>marketCount()</Mono> returned 0. The first market appears when someone approves a
          drafted question in <Mono>/review</Mono> and signs for it.
        </EmptyState>
      )}

      {/* Approved, signed, not yet confirmed. Kept visually separate from the list below
          because these rows are NOT on chain, and a page that mixed them would be claiming
          something the chain has not said. */}
      {payload.pending.length > 0 && (
        <section className="mb-8 overflow-hidden rounded-2xl border border-warn-500/50 bg-warn-500/10">
          <div className="flex flex-wrap items-center gap-2 border-b border-warn-500/25 px-4 py-2.5">
            <Badge tone="warn">off chain</Badge>
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
            <Mono>MarketCreated</Mono> out of a confirmed log. When that
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

      <footer className="mt-12 border-t border-ink-800 pt-6">
        <p className="text-xs leading-relaxed text-ink-400">
          <span className="text-ink-300">
            {origin.humanCreated.length === 1 ? "Market" : "Markets"}{" "}
            {formatIds(origin.humanCreated)}{" "}
            {origin.humanCreated.length === 1 ? "is" : "are"} the product path
          </span>
          : an AI agent drafted each question from two independently-confirmed news reports, a
          person read it as a checklist, and the market exists because they signed for it in a
          browser wallet.{" "}
          {origin.operatorCreated.length > 0 && (
            <>
              {origin.operatorCreated.length === 1 ? "Market" : "Markets"}{" "}
              {formatIds(origin.operatorCreated)}{" "}
              {origin.operatorCreated.length === 1 ? "was" : "were"} created while commissioning
              the contract, by the operator key rather than through the human gate
              {origin.selfLabelled.length > 0 && (
                <>
                  {" — "}
                  {formatIds(origin.selfLabelled)} say so inside{" "}
                  {origin.selfLabelled.length === 1 ? "its" : "their"} own on-chain question text
                </>
              )}
              {origin.unlabelled.length > 0 && (
                <>
                  , and {formatIds(origin.unlabelled)} do not: they ask whether AuspeX itself would
                  have a verified contract, which is plainly not a product question but never
                  labels itself a test
                </>
              )}
              .{" "}
            </>
          )}
          {origin.unknown.length > 0 && (
            <>
              {origin.unknown.length === 1 ? "Market" : "Markets"}{" "}
              {formatIds(origin.unknown)}{" "}
              {origin.unknown.length === 1 ? "has" : "have"} no indexed creating log on this page
              load, so nothing is claimed about{" "}
              {origin.unknown.length === 1 ? "it" : "them"} either way.{" "}
            </>
          )}
          Every one of them is a real transaction on chain {MST_TESTNET.id}, not seeded demo data,
          and you can tell the two kinds apart without trusting this page: check the{" "}
          <Mono>from</Mono> address of each creating transaction on MSTScan.
          The wallet that signed the product markets holds every role that requires human
          judgement — <Mono>MARKET_CREATOR</Mono>,{" "}
          <Mono>RESOLVER</Mono>,{" "}
          <Mono>CHALLENGER</Mono> — and{" "}
          <span className="text-ink-300">not</span>{" "}
          <Mono>DEFAULT_ADMIN_ROLE</Mono>, so it cannot register an agent,
          change a cap, or pause the contract.
        </p>
        <p className="mt-2">
          <Provenance
            origin="COMPUTED"
            detail="marketOrigins() over the rows above · creator from the indexed MarketCreated log"
          />
        </p>
      </footer>
    </PageShell>
  );
}

function MarketCard({ market }: { market: MarketView }) {
  const totalWei = market.poolYesWei + market.poolNoWei;
  const yesPercent =
    totalWei === 0n ? null : Number((market.poolYesWei * 10000n) / totalWei) / 100;

  return (
    <CardItem>
      <CardHead>
        <Link
          href={`/markets/${market.onchainId}`}
          className="font-mono text-xs text-ink-400 underline-offset-2 hover:text-signal-500 hover:underline"
        >
          #{market.onchainId}
        </Link>
        <Badge tone={MARKET_STATE_TONE[market.state] ?? "quiet"}>
          {market.state.replace(/_/g, " ")}
        </Badge>
        {market.outcome !== "UNRESOLVED" && (
          <span className="font-mono text-[10px] tracking-wide text-ink-300 uppercase">
            outcome {market.outcome}
          </span>
        )}
        {market.createdTxHash !== null && (
          <TxLink
            hash={market.createdTxHash}
            label={`created in ${shortHash(market.createdTxHash, 8, 6)}`}
            className="ml-auto text-[11px]"
          />
        )}
        <Link
          href={`/markets/${market.onchainId}`}
          className={`font-mono text-[11px] text-ink-300 underline-offset-2 hover:text-signal-500 hover:underline ${
            market.createdTxHash === null ? "ml-auto" : ""
          }`}
        >
          lifecycle &amp; payout →
        </Link>
      </CardHead>

      <CardBody>
        <p className="font-display text-lg leading-snug text-ink-100">{market.question}</p>

        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
          {/* Deliberately not `ok` and `bad`. A market's two sides are positions, not trust
              claims: a larger NO pool is not bad news, and spending the refusal colour on it
              would put crimson on every card beside an INVALIDATED badge that means something
              entirely different. The labels carry the distinction. See ADR-073. */}
          <Field label="Pool YES">
            <span className="text-ink-100">{formatMstc(market.poolYesWei)} tMSTC</span>
          </Field>
          <Field label="Pool NO">
            <span className="text-ink-100">{formatMstc(market.poolNoWei)} tMSTC</span>
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
            <ExtLink href={market.resolutionSourceUrl} wrap>
              {market.resolutionSourceUrl}
            </ExtLink>
          </Row>
          {market.evidenceUrl !== "" && (
            <Row label="evidence">
              <ExtLink href={market.evidenceUrl} wrap>
                {market.evidenceUrl}
              </ExtLink>
            </Row>
          )}
          {market.challengeCount > 0 && (
            <Row label="challenges">
              <span className="text-warn-500">{market.challengeCount} recorded</span>
            </Row>
          )}
        </dl>

        {market.projectionDrift !== null && (
          <p className="mt-3 flex items-baseline gap-1.5 rounded-2xl border border-warn-500/50 bg-warn-500/10 px-2.5 py-1.5 font-mono text-[11px] text-warn-500">
            <span aria-hidden="true">{TONE.warn.glyph}</span>
            <span>
              indexer drift: {market.projectionDrift} — the chain figures above are the correct
              ones
            </span>
          </p>
        )}
      </CardBody>
    </CardItem>
  );
}

