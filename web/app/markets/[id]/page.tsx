import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { explorerUrl, formatMstc, shortHash } from "@/lib/chain";
import { db, hasDatabase } from "@/lib/db/client";
import { markets as marketsTable } from "@/lib/db/schema";
import { readMarket, type OnChainMarket } from "@/lib/chain/auspex";
import { getProvider } from "@/lib/chain/provider";
import { draftsForMarket, type DraftRow } from "@/lib/resolution/dashboard";
import { lifecycleIntentsFor, payoutsFor } from "@/lib/resolution/settle";

/**
 * One market, from creation through to payout.
 *
 * ## What is read from where, and why it matters on this page more than any other
 *
 * Every number that decides money — the pools, the outcome, the challenge deadline, what each agent
 * is owed — is an `eth_call` made on this request. `previewPayout(marketId, agent)` in particular is
 * **the contract's own answer** to "what will you pay this address", not a parimutuel figure this
 * codebase computed and hoped matched. If our arithmetic and the contract's ever disagreed, showing
 * ours would be the most misleading thing this application could do.
 *
 * Postgres supplies only what the chain cannot: the resolution drafts (which have never been
 * signed and so are not on chain at all), and the intents, which are how a reader sees *which key*
 * sent each transaction.
 *
 * ## The lifecycle table is the argument of the whole project, in one place
 *
 * Read down the `signed by` column. `createMarket` came from a browser wallet. `placeBet` came from
 * a capped agent. `proposeResolution` came from a browser wallet again. `finalizeResolution` and
 * `claim` came from a wallet holding no role at all, because neither call needs one. There is no row
 * in which a privileged server key moved money.
 */

export const dynamic = "force-dynamic";
export const revalidate = 0;

const STATE_STYLE: Record<string, string> = {
  OPEN: "border-ok-500/40 bg-ok-500/10 text-ok-500",
  CLOSED: "border-warn-500/40 bg-warn-500/10 text-warn-500",
  RESOLUTION_PROPOSED: "border-signal-500/40 bg-signal-500/10 text-signal-500",
  FINALIZED: "border-ink-600 bg-ink-800 text-ink-300",
  INVALIDATED: "border-bad-500/40 bg-bad-500/10 text-bad-500",
};

const KIND_LABEL: Record<string, string> = {
  CREATE_MARKET: "createMarket",
  PLACE_BET: "placeBet",
  CLOSE_MARKET: "closeMarket",
  PROPOSE_RESOLUTION: "proposeResolution",
  CHALLENGE_RESOLUTION: "challengeResolution",
  FINALIZE_RESOLUTION: "finalizeResolution",
  INVALIDATE_STALE: "invalidateStale",
  CLAIM: "claim",
  REGISTER_AGENT: "registerAgent",
};

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return {
    title: `Market #${id} — AuspeX`,
    description: `The full lifecycle of market #${id}, read from the AuspexMarket contract.`,
  };
}

export default async function MarketDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const onchainId = Number(id);
  if (!Number.isInteger(onchainId) || onchainId < 1) notFound();

  let chain: OnChainMarket | null = null;
  let chainError: string | null = null;
  // The CHAIN's clock, not this machine's. Every deadline on this page is compared against
  // `block.timestamp`, which is what the contract itself compares against — so a laptop or a
  // serverless region with a skewed clock cannot make the page disagree with the contract about
  // whether a challenge window is open. It also keeps the render pure, which the lint rule that
  // caught this was right about for a different reason.
  let chainNow = 0;
  try {
    const [market, latest] = await Promise.all([
      readMarket(onchainId),
      getProvider().getBlock("latest"),
    ]);
    chain = market;
    chainNow = latest?.timestamp ?? 0;
  } catch (error) {
    chainError = error instanceof Error ? error.message : String(error);
  }

  let drafts: DraftRow[] = [];
  let payouts: Awaited<ReturnType<typeof payoutsFor>> = [];
  let intents: Awaited<ReturnType<typeof lifecycleIntentsFor>> = [];
  let createdTxHash: string | null = null;
  let dbError: string | null = null;

  if (hasDatabase()) {
    try {
      const [row] = await db
        .select({
          id: marketsTable.id,
          proposalId: marketsTable.proposalId,
          createdTxHash: marketsTable.createdTxHash,
        })
        .from(marketsTable)
        .where(eq(marketsTable.onchainId, onchainId))
        .limit(1);

      createdTxHash = row?.createdTxHash ?? null;
      [drafts, payouts, intents] = await Promise.all([
        row === undefined ? Promise.resolve([]) : draftsForMarket(row.id),
        payoutsFor(onchainId),
        lifecycleIntentsFor(onchainId, row?.proposalId, row?.id),
      ]);
    } catch (error) {
      dbError = error instanceof Error ? error.message : String(error);
    }
  }

  const nowSeconds = chainNow;
  const totalWei = chain === null ? 0n : chain.poolYesWei + chain.poolNoWei;

  return (
    <main className="grid-backdrop min-h-dvh">
      <div className="mx-auto max-w-4xl px-4 py-12 sm:px-6 sm:py-16">
        <header className="mb-8">
          <Link
            href="/markets"
            className="font-mono text-xs text-ink-400 underline-offset-2 hover:text-ink-200 hover:underline"
          >
            ← Markets
          </Link>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-semibold tracking-tight text-ink-100">
              Market #{onchainId}
            </h1>
            {chain !== null && (
              <span
                className={`rounded border px-2 py-0.5 font-mono text-[11px] tracking-wide uppercase ${
                  STATE_STYLE[chain.state] ?? "border-ink-600 bg-ink-800 text-ink-300"
                }`}
              >
                {chain.state.replace(/_/g, " ")}
              </span>
            )}
            {chain !== null && chain.outcome !== "UNRESOLVED" && (
              <span className="font-mono text-[11px] tracking-wide text-ink-300 uppercase">
                outcome {chain.outcome}
              </span>
            )}
          </div>
        </header>

        {chainError !== null && (
          <div className="mb-8 rounded-lg border border-bad-500/40 bg-bad-500/5 px-4 py-3">
            <p className="font-mono text-sm text-bad-500">could not read the contract</p>
            <p className="mt-2 font-mono text-xs break-words text-ink-400">{chainError}</p>
            <p className="mt-2 text-xs text-ink-400">
              This page shows the real error instead of a placeholder. Nothing here is ever invented.
            </p>
          </div>
        )}

        {chain !== null && (
          <>
            <section className="mb-8 overflow-hidden rounded-lg border border-ink-700 bg-ink-900">
              <div className="px-4 py-4">
                <p className="text-lg leading-snug text-ink-100">{chain.question}</p>

                <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
                  <Field label="Pool YES">
                    <span className="text-ok-500">{formatMstc(chain.poolYesWei)}</span>
                  </Field>
                  <Field label="Pool NO">
                    <span className="text-bad-500">{formatMstc(chain.poolNoWei)}</span>
                  </Field>
                  <Field label="Total pool">
                    <span className="text-ink-100">{formatMstc(totalWei)} tMSTC</span>
                  </Field>
                  <Field label="Challenges">
                    <span className={chain.challengeCount > 0 ? "text-warn-500" : "text-ink-300"}>
                      {chain.challengeCount}
                    </span>
                  </Field>
                </dl>

                <dl className="mt-5 space-y-1.5 border-t border-ink-800 pt-4 font-mono text-[11px]">
                  <Row label="closed">{new Date(chain.closeTime * 1000).toISOString()}</Row>
                  <Row label="resolve by">
                    {new Date(chain.resolveDeadline * 1000).toISOString()}
                    {nowSeconds > chain.resolveDeadline &&
                      (chain.state === "OPEN" || chain.state === "CLOSED") && (
                        <span className="ml-2 text-warn-500">
                          past — anyone may call invalidateStale and refund every bettor
                        </span>
                      )}
                  </Row>
                  {chain.state === "RESOLUTION_PROPOSED" && (
                    <Row label="challenge">
                      {new Date(chain.challengeEndsAt * 1000).toISOString()}
                      <span
                        className={`ml-2 ${
                          chain.challengeEndsAt > nowSeconds ? "text-signal-500" : "text-ink-400"
                        }`}
                      >
                        {chain.challengeEndsAt > nowSeconds
                          ? `open for ~${chain.challengeEndsAt - nowSeconds}s`
                          : "elapsed — anyone may finalise"}
                      </span>
                    </Row>
                  )}
                  <Row label="source">
                    <a
                      href={chain.resolutionSourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="break-all text-signal-500 underline-offset-2 hover:underline"
                    >
                      {chain.resolutionSourceUrl}
                    </a>
                  </Row>
                  {chain.evidenceUrl !== "" && (
                    <Row label="evidence">
                      <a
                        href={chain.evidenceUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="break-all text-signal-500 underline-offset-2 hover:underline"
                      >
                        {chain.evidenceUrl}
                      </a>
                    </Row>
                  )}
                  {chain.proposedBy !== "0x0000000000000000000000000000000000000000" && (
                    <Row label="proposed by">
                      <a
                        href={explorerUrl("address", chain.proposedBy)}
                        target="_blank"
                        rel="noreferrer"
                        className="text-signal-500 underline-offset-2 hover:underline"
                      >
                        {chain.proposedBy}
                      </a>
                    </Row>
                  )}
                  <Row label="spec hash">
                    <span className="break-all text-ink-300">{chain.specHash}</span>
                  </Row>
                  {createdTxHash !== null && (
                    <Row label="created in">
                      <a
                        href={explorerUrl("tx", createdTxHash)}
                        target="_blank"
                        rel="noreferrer"
                        className="text-signal-500 underline-offset-2 hover:underline"
                      >
                        {createdTxHash} ↗
                      </a>
                    </Row>
                  )}
                </dl>
              </div>
            </section>

            {/* What the contract will pay, in the contract's own words. */}
            <section className="mb-8">
              <SectionLabel>Payout — read from previewPayout() on this request</SectionLabel>
              {chain.state !== "FINALIZED" && chain.state !== "INVALIDATED" ? (
                <p className="mt-3 rounded-lg border border-ink-700 bg-ink-900 px-4 py-4 text-xs leading-relaxed text-ink-400">
                  Nothing is claimable yet. <span className="font-mono">previewPayout</span> returns
                  0 for a market that is not <span className="font-mono">FINALIZED</span> or{" "}
                  <span className="font-mono">INVALIDATED</span> — the contract will not let anyone
                  withdraw before the challenge window has elapsed and finalisation has happened.
                </p>
              ) : payouts.length === 0 ? (
                <p className="mt-3 rounded-lg border border-ink-700 bg-ink-900 px-4 py-4 text-xs leading-relaxed text-ink-400">
                  This market is settled and{" "}
                  <span className="font-mono">previewPayout</span> returns 0 for every agent wallet.
                  That means one of three things, all of them normal: nothing was staked, every agent
                  backed the losing side, or the winnings have already been claimed. The claim
                  transactions, if any, are in the table below.
                </p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {payouts.map((payout) => (
                    <li
                      key={payout.agentAddress}
                      className="rounded-lg border border-ok-500/40 bg-ok-500/5 px-4 py-3"
                    >
                      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <span className="font-mono text-sm text-ink-100">{payout.handle}</span>
                        <span className="font-mono text-sm tabular-nums text-ok-500">
                          {formatMstc(payout.owedWei, 6)} tMSTC owed
                        </span>
                        <span className="font-mono text-[11px] text-ink-500">
                          {payout.owedWei.toString()} wei
                        </span>
                      </div>
                      <p className="mt-1.5 font-mono text-[11px] leading-relaxed text-ink-400">
                        claimed by agent {shortHash(payout.agentAddress, 8, 6)} → paid to owner{" "}
                        <a
                          href={explorerUrl("address", payout.ownerAddress)}
                          target="_blank"
                          rel="noreferrer"
                          className="text-signal-500 underline-offset-2 hover:underline"
                        >
                          {shortHash(payout.ownerAddress, 8, 6)}
                        </a>
                      </p>
                      <p className="mt-1 text-[11px] leading-relaxed text-ink-500">
                        The contract pays the registered owner, never the wallet that signs. A
                        stolen agent key cannot redirect this.
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}

        {/* The lifecycle. One row per transaction, with the key that sent it. */}
        <section className="mb-8">
          <SectionLabel>Lifecycle — every transaction, and which key signed it</SectionLabel>
          {dbError !== null ? (
            <p className="mt-3 rounded-lg border border-warn-500/40 bg-warn-500/5 px-4 py-3 font-mono text-xs break-words text-warn-500">
              intent history unavailable — {dbError}
            </p>
          ) : intents.length === 0 ? (
            <p className="mt-3 rounded-lg border border-ink-700 bg-ink-900 px-4 py-4 text-xs leading-relaxed text-ink-400">
              No intents are recorded for this market. Markets 1–3 were created directly by the
              Phase 1 and 2 scripts, before anything went through the intent engine, so their
              transactions exist on chain with no row here — the{" "}
              <span className="font-mono">created in</span> link above is the authoritative record,
              and MSTScan is the place to read it.
            </p>
          ) : (
            <div className="mt-3 overflow-x-auto rounded-lg border border-ink-700 bg-ink-900">
              <table className="w-full text-left font-mono text-[11px]">
                <thead className="border-b border-ink-800 text-ink-400">
                  <tr>
                    <th className="px-3 py-2 font-normal">call</th>
                    <th className="px-3 py-2 font-normal">signed by</th>
                    <th className="px-3 py-2 font-normal">value</th>
                    <th className="px-3 py-2 font-normal">status</th>
                    <th className="px-3 py-2 font-normal">tx</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-800">
                  {intents.map((intent, index) => (
                    <tr key={`${intent.txHash ?? "none"}-${index}`}>
                      <td className="px-3 py-2 text-ink-200">
                        {KIND_LABEL[intent.kind] ?? intent.kind}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={
                            intent.signer === "EXTERNAL" ? "text-signal-500" : "text-ink-300"
                          }
                        >
                          {intent.signer === "EXTERNAL" ? "browser wallet" : "server key"}
                        </span>
                        <br />
                        <a
                          href={explorerUrl("address", intent.fromAddress)}
                          target="_blank"
                          rel="noreferrer"
                          className="text-ink-500 underline-offset-2 hover:text-ink-300 hover:underline"
                        >
                          {shortHash(intent.fromAddress, 8, 6)}
                        </a>
                      </td>
                      <td className="px-3 py-2 tabular-nums text-ink-300">
                        {intent.valueWei === "0" ? "—" : `${formatMstc(BigInt(intent.valueWei), 6)}`}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className={
                            intent.status === "CONFIRMED"
                              ? "text-ok-500"
                              : intent.status === "REVERTED"
                                ? "text-bad-500"
                                : "text-warn-500"
                          }
                        >
                          {intent.status}
                        </span>
                        {intent.revertReason !== null && (
                          <>
                            <br />
                            <span className="break-all text-ink-500">{intent.revertReason}</span>
                          </>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {intent.txHash === null ? (
                          <span className="text-ink-600">—</span>
                        ) : (
                          <a
                            href={explorerUrl("tx", intent.txHash)}
                            target="_blank"
                            rel="noreferrer"
                            className="text-signal-500 underline-offset-2 hover:underline"
                          >
                            {shortHash(intent.txHash, 8, 6)} ↗
                          </a>
                        )}
                        {intent.blockNumber !== null && (
                          <>
                            <br />
                            <span className="text-ink-500">
                              block {intent.blockNumber.toLocaleString("en-US")}
                            </span>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Every outcome ever drafted for this market, including the refused ones. */}
        {drafts.length > 0 && (
          <section>
            <SectionLabel>Resolution drafts — one per challenge round</SectionLabel>
            <ul className="mt-3 space-y-3">
              {drafts.map((draft) => (
                <li
                  key={draft.id}
                  className="rounded-lg border border-ink-700 bg-ink-900 px-4 py-3"
                >
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="font-mono text-[11px] text-ink-500">round {draft.round}</span>
                    <span className="font-mono text-[11px] text-ink-300">{draft.status}</span>
                    <span className="font-mono text-[11px] text-ink-200">{draft.outcome}</span>
                    {draft.model !== null && (
                      <span className="font-mono text-[11px] text-ink-500">{draft.model}</span>
                    )}
                  </div>
                  {draft.settledByQuote !== null && (
                    <blockquote className="mt-2 border-l-2 border-signal-500/40 pl-3 text-xs leading-relaxed text-ink-200 italic">
                      “{draft.settledByQuote}”
                    </blockquote>
                  )}
                  {draft.rationale !== null && (
                    <p className="mt-2 text-xs leading-relaxed text-ink-400">{draft.rationale}</p>
                  )}
                  {draft.rejectionReason !== null && (
                    <p className="mt-2 text-xs leading-relaxed break-words text-bad-500">
                      refused: {draft.rejectionReason}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        <footer className="mt-10 border-t border-ink-800 pt-6">
          <p className="text-xs leading-relaxed text-ink-400">
            Read the <span className="text-ink-300">signed by</span> column down the lifecycle table.
            A market is created by a browser wallet, bet on by a capped agent, resolved by a browser
            wallet, and finalised and claimed by a wallet that holds no role at all — because neither
            of those last two calls needs one. There is no row in which a privileged server key moved
            money, and that is checkable on MSTScan without trusting this page.
          </p>
        </footer>
      </div>
    </main>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="font-mono text-[11px] tracking-widest text-ink-400 uppercase">{children}</h2>
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
      <dd className="min-w-0 break-words text-ink-200">{children}</dd>
    </div>
  );
}
