# PROGRESS.md — AuspeX build state

> **This file is the handoff between sessions.** A new session reads this first and continues from
> "Next phase". It is updated at the end of every phase, before the commit. If it is stale, the next
> session starts blind.
>
> Session protocol and hard rules live in `CLAUDE.md`. Phase tasks and exit criteria live in
> `docs/BUILD_PLAN.md`. Manual setup state lives in `docs/RUNBOOK.md`.

**Last updated:** 2026-09-29
**Current status:** ✅ Phase 6 complete — the full lifecycle is on chain, a real parimutuel payout landed with an agent's owner
**Next phase:** **Phase 7 — Dashboard polish + trust surface**

---

## Phase status

| Phase | Name | Status |
|:--|:--|:--|
| 0 | Foundations & rails | ✅ Complete |
| 1 | Smart contract — build, test, deploy, verify | ✅ Complete |
| 2 | Data layer + chain client + idempotency engine | ✅ Complete |
| 3 | News ingestion, dedup, 2-source confirmation | ✅ Complete |
| 4 | Market proposer agent + human approval gate | ✅ Complete |
| 5 | Member agents + deterministic policy gate | ✅ Complete |
| 6 | Resolution, challenge window, payout | ✅ Complete |
| 7 | Dashboard polish + trust page | ⬜ **NEXT** |
| 8 | Live end-to-end run + README + submission | ⬜ Not started |

Legend: ⬜ not started · 🟡 in progress · ✅ complete · ⚠️ complete with known gaps

---

## Real artifacts

> Only verified, resolvable values go here. Never write a placeholder that looks real.
> Every hash below was confirmed `status: ok` through `testnet.mstscan.com/api/v2` after the fact.

| Artifact | Value | Status |
|:--|:--|:--|
| **Public GitHub repo** | https://github.com/arunishrajput/auspex | ✅ |
| **CI** (build/test/lint/secret+mock guards) | https://github.com/arunishrajput/auspex/actions | ✅ green |
| **Live demo URL** | **https://auspex-web-mu.vercel.app** | ✅ public, live chain data |
| Vercel project | `auspex-web` (team `arunish-rajputs-projects`), root dir `web` | ✅ auto-deploys on push |
| Deployer wallet | `0xc71dC478040F7A6bcc5Cb1f316A4a446F7D4ad24` | ✅ 9.976 tMSTC left |
| **Human authority wallet (BridgeKey)** | **`0xA9F68fDf84388fa548a685085E2bee0e5b311fF1`** | ✅ 50 tMSTC, chain `91562037` |
| **`grantRole(MARKET_CREATOR_ROLE)` → BridgeKey** | **`0xe4ed912c309db55a0cfa51e597ad4845369714a51fe77b0c282e39b8cc932069`** | ✅ block 5,790,485, `result: success` |
| `pnpm preflight` | 10/10, now including the human wallet's role boundary | ✅ every manual blocker closed |
| **`AuspexMarket` contract** | **`0xc4743d6295311AFead12161881Bfcf601B70104C`** | ✅ chain `91562037` |
| Deployment tx | `0x3b98b828b89bda4489bde9bded404afeb5dfe68d2703759184d74111d7dacd56` | ✅ block 5,786,343 |
| **Source verified on MSTScan** | solc `v0.8.28`, evm `cancun`, optimizer on, runs 200 | ✅ `is_verified: true` |
| Constructor args | `(0xc71dC478…4ad24, 120)` — admin, challengeWindow seconds | ✅ on explorer |
| Smoke `createMarket` tx | `0xc0a699729bd41ba84903382f7b8d78efd667e4eb21e68f3a64738570637ffc73` | ✅ block 5,786,372 |
| Smoke `placeBet` tx | `0x7a91667472052b5c5b2dbf264bc0b1279f0793ca1d1ab5b52e38ea37b22c973a` | ✅ block 5,786,373 |
| Smoke run 2 `createMarket` | `0x1105fb143b6b9a073b1fff22cde224a530120cb9373fcc2ae260495a29ef66d6` | ✅ block 5,786,400 |
| Smoke run 2 `placeBet` | `0x558dfdafdcdac157176058076c9dafcd825a525346806d2e45e9340213c8a0bf` | ✅ block 5,786,402 |
| **Crash-test `createMarket`** (market 3) | **`0xeabf2271ef9253d9d3d00aaa086082b0542872d4e98df8c98608b0fa7dbefe83`** | ✅ block 5,787,574, `result: success` |
| Neon database | project `jolly-queen-98097073`, branch `main`, db `neondb` | ✅ 14 tables migrated |
| **`POST /api/tick` in production** | 200 in **14.9s**, 0 stage errors, 3 LLM calls | ✅ verified 2026-09-29 |
| Pipeline state (live) | 255 articles · 106 publishers · 215 events · 3 `CONFIRMED` | ✅ real feeds |
| Gemini free-tier key | project `agentforge-gemini-free`, no billing account | ✅ `preflight` 9/9 |
| **`/review` — the human gate** | **https://auspex-web-mu.vercel.app/review** | ✅ 4 proposals drafted, reviewed, approved |
| Approval dry run (`pnpm --filter web verify:approval`) | 8/8 live checks, `eth_call createMarket` | ✅ role, pause, replay guard, calldata |
| **`createMarket` #4 — human-approved** | **`0x2e70a1cbe7bd72b33e68afdc4742c0416b2eee3ed3ed4297bf938d2be825a504`** | ✅ block 5,793,477, `result: success` |
| **`createMarket` #5 — human-approved** | **`0xf8d8e41c64c0ea4d57860ee5cbc72f46b8ef4c3659d0d3feaa3b6e083e41c32e`** | ✅ block 5,793,480, `result: success` |
| **`createMarket` #6 — human-approved** | **`0xfc861037611ed292a07a5a8982cf7dca8156576a4a3b581bad61c8a80fc221df`** | ✅ block 5,793,482, `result: success` |
| **`createMarket` #7 — human-approved** | **`0x444517757604b0b600f75790b6734cfc175c164d42b112bd32d96f1bc60058f9`** | ✅ block 5,793,485, `result: success` |
| **Sender of all four** | **`0xA9F68fDf84388fa548a685085E2bee0e5b311fF1`** (BridgeKey, human) | ✅ **not the deployer** — checkable on MSTScan |
| Discord notifications | 4 sent, one per market, each carrying its tx hash | ✅ fired only after indexing |
| **Agent wallet `atlas`** | **`0xa4ef956f01946b93efd592ce720d24beec19588f`** | ✅ registered, capped 0.02/tx |
| **Agent wallet `vega`** | **`0x15757d543f6050b6f5ff83782b7c122e21450daa`** | ✅ registered, capped 0.01/tx |
| **Agent wallet `kestrel`** | **`0x76bf4262aa13632e91e27e0eba3b42b6b353ce4e`** | ✅ registered, kill switch ON |
| `registerAgent` → atlas | `0x74cb33a18ec7378a832868898e1fcbf1f41d057910f5cddea23f8bb16f124b7a` | ✅ `result: success` |
| `registerAgent` → kestrel | `0xcc2097f46e608b0dfa13caefb270a9a9709bd5b3f0d0520a40568c009bbd11ef` | ✅ `result: success` |
| `registerAgent` → vega | `0x92a7a00a7fcdee71ff5db15642342f17aa32b5cd778387ada463965db89dfd41` | ✅ `result: success` |
| **`placeBet` #1 (agent, within caps)** | **`0x5f8a12c6259de3493b79314e3e6f0284a3650e378b4b34f627cff37ea10dd5f1`** | ✅ block 5,794,730, 0.005 tMSTC YES on market 4 |
| **`placeBet` #2 (agent, within caps)** | **`0xc2a426997ae432372d645ac8b95bf947acaa20562c9c69672046ca3f204e0759`** | ✅ block 5,794,735, 0.004 tMSTC YES on market 5 |
| **Over-cap bet tx (expected revert)** | **`0xf0152234efe078729401162dd8ef16e6d19da2c657dcfe4360f2cd3255720c2d`** | ✅ block 5,794,765, **`AgentPerTxCapExceeded(2e16+1, 2e16)`** |
| **`/agents` — the gate, visible** | **https://auspex-web-mu.vercel.app/agents** | ✅ 9 decisions, 6 refusals, 1 chain refusal |
| `pnpm --filter web verify:agents` | 41 live checks: roles, registry, cap boundary, kill switch | ✅ all pass, writes nothing |
| `pnpm preflight` | now **11/11**, including all three agents registered and funded | ✅ |
| **`POST /api/tick` in production, post-Phase 5** | 200 in **15.06s**, 0 stage errors, agents stage included | ✅ verified 2026-09-29 |
| **`POST /api/tick` in production, post-Phase 6** | 200 in **19.69s**, 0 stage errors, **all six stages ran**, 4/10 LLM calls | ✅ verified 2026-09-29 |
| **`grantRole(RESOLVER_ROLE)` → BridgeKey** | **`0x886d021b0c4fe46674e685fd9eea17901f6ca1458d1ada6ed06c01bb1f7da4e2`** | ✅ block 5,796,170 |
| **`grantRole(CHALLENGER_ROLE)` → BridgeKey** | **`0xf1ce96cf43e44e674f58d6c082f8bfe50274e16d29773de57984774c0ad14268`** | ✅ block 5,796,177 |
| **`/resolve` — the human resolver gate** | **https://auspex-web-mu.vercel.app/resolve** | ✅ live |
| **`/audit` — the append-only decision log** | **https://auspex-web-mu.vercel.app/audit** | ✅ live |
| **`/markets/8` — lifecycle through to payout** | **https://auspex-web-mu.vercel.app/markets/8** | ✅ live |
| `pnpm --filter web verify:resolution` | 20 live checks, 3 skipped for want of a market in that state | ✅ writes nothing |
| **Lifecycle market #8** (labelled test, two-sided) | `createMarket` `0xc0faa60c373fc7ff59520073a29bbeb5755c59f3571f581ceb4b819e52bc61a7` | ✅ block 5,796,280 |
| `placeBet` YES 0.01 (deployer) | `0x40368a6c5376004cf6802a34a87b60e8fc068b2851c675d59a8b137a8d907f89` | ✅ block 5,796,284 |
| `placeBet` NO 0.005 (atlas's agent) | `0x6c6dbf0da04665f8bfdf11e6ed20facd912f077e0821b6926534d43322b573c1` | ✅ block 5,796,288 |
| Late bet (expected revert) | `0x078b9c76e0a6752f6245c6b60fb55a6281e5f768a83e64d8789381dd3da6b73f` | ✅ **`BettingClosed()`** |
| `closeMarket` (agent wallet, permissionless) | `0x7ad7fd5659ec07c50efec49bbf2a67d379d13de64fc3abcdf6140e59c89751eb` | ✅ block 5,796,311 |
| **`proposeResolution` NO, round 1** | **`0x5c2df8b38c35d3218b5a7095bf658a6996f1deefe836c0f83be02d47121e2127`** | ✅ block 5,796,314 |
| `finalizeResolution` inside the window (expected revert) | `0x39e30155507d037d5db8ac983f15b1ef6239d714116d8b21c436ba01204864df` | ✅ **`ChallengeWindowOpen(1790644321)`** |
| **`challengeResolution`** | **`0x1e38128c1423aca8e5501a3c6727d66e3fa211ede52d555282753ba689f43fc9`** | ✅ block 5,796,326 — market back to `CLOSED` |
| **`proposeResolution` NO, round 2** | **`0xe7068be69e329a444270134f354e4695b39103c89384c5fe21ee5d23c643b9f4`** | ✅ block 5,796,331 |
| **`finalizeResolution`** (agent wallet, no role) | **`0x2f4fd42833a6aaa04819d92a2f1e3de04c4dd897145eb1b0c5b53dfaa5d407fc`** | ✅ block 5,796,378 |
| **`claim` — 0.015 tMSTC paid to the OWNER** | **`0x7ae9c6830335f810629b63dfef47cbfbbd7757385bbbc25779bc676b1970e0a2`** | ✅ block 5,796,384 |
| Second `claim` (expected revert) | `0x108c50cb6a364699f210d003f55dddc5c2004ad4972fb7a3e7570ca5e603903c` | ✅ **`AlreadyClaimed()`** |
| Losing side's `claim` (expected revert) | `0x6237ea0ce42bea18a6349fe34b001d8bfb9d4fe98e97acad3be9030ab4094929` | ✅ **`NothingToClaim()`** |
| **`invalidateStale(#1)`** (agent wallet, permissionless) | **`0xefe33de28f5424940e6e94b123c30c052f83261f3bcb96bd8aa741ba20f3ca6b`** | ✅ block 5,796,402 |
| Refund `claim` on the invalidated market | `0x17a3d09a957e922aec15ae1d224339d24361aa38de0adfa19be057b81f0488bb` | ✅ block 5,796,407 — 0.01 tMSTC returned |
| **Keeper `closeMarket` #2** (from a tick, not a script) | `0x9588280c82402a72204af12f6132871e68fd40c9d0b9541b41f0c42399ed35a7` | ✅ block 5,796,567 |
| **Keeper `closeMarket` #3** (from a tick, not a script) | `0x65ed1cf6c728553ab5217c5cb4bb202c59ab28d7ee975b212e2f03667baceeb0` | ✅ block 5,796,572 |

**Eight markets exist on-chain.** Ids 1–2 are the Phase 1 smoke-test runs and 3 is the Phase 2
idempotency crash test; all three say what they are in their own on-chain question text, and none is
presented anywhere as a product market. **Ids 4–7 are the real ones** — drafted by an AI agent from
confirmed news, read as a checklist by a human, and created by a signature from a key no server
holds. MSTScan decodes every method name because the source is verified.

**Market 8 is the Phase 6 lifecycle test** — created by `scripts/lifecycle.ts` with a 70-second close
time and bets on both sides, because no market on chain had two sides and a one-sided market's payout
degenerates into a refund. It says `[Phase 6 lifecycle test …] Not a product market.` in its own
on-chain question text, for the same reason 1–3 do: the label has to travel to MSTScan and survive
being quoted out of context. ADR-059 has the full reasoning, including why its agent bet was an
operator action and is recorded as one.

**The distinction a judge can check without trusting us:** markets 1–3 and 8 were sent by the deployer
`0xc71dC478…4ad24`; markets 4–7 were sent by `0xA9F68fDf…311fF1` — the human authority.

⚠️ **That wallet's role set changed in Phase 6, and the old sentence is no longer true.** It used to
hold `MARKET_CREATOR_ROLE` and nothing else. It now also holds `RESOLVER_ROLE` and `CHALLENGER_ROLE`,
because the 120-second challenge window is far too short for a human to veto a wrong outcome, so the
human has to be *before* the proposal — which means `proposeResolution` must be signed in a browser
(ADR-052). The honest replacement is narrower and still checkable on MSTScan:

> **It holds every role that requires human judgement and none that confers power.** It does **not**
> hold `DEFAULT_ADMIN_ROLE`, so it cannot register an agent, change a cap, or pause the contract.

And the claim that got *stronger*: **no key the deployed application holds can create a market,
resolve one, challenge one, register an agent, change a cap or pause the contract.** Production holds
agent keys only. `pnpm --filter web verify:resolution` asserts all four role facts with live
`hasRole` calls, and `pnpm preflight` checks them too.

**Also on chain, no longer in the repo:** `Ping` at `0x540d73793f5AA5E605A0243EA3DfCF106D6558D8`
(verified). It was the Phase 0 toolchain probe used to prove the deploy→verify pipeline works before
`AuspexMarket` existed. Deleted from the repo per `docs/BUILD_PLAN.md`; it is claimed nowhere.

---

## Phase 6 — what shipped

### The shape of it

```
CLOSED market ──> deterministic retrieval ──> resolution agent ──> quote verified ──> PENDING_REVIEW
 (past close)      IDF coverage of the         (LLM, bounded)       in the text            │
                   question's own terms              │                   │            ═══ HUMAN ═══
                   NOT chosen by the model    UNSETTLED → no row    SCHEMA_REJECTED         │
                                             (correct, retried)      (row, shown)      BridgeKey
                                                                                       signature
                                                                                            │
                                                                                            ▼
  ══════════════════ AND THEN THE CONTRACT HOLDS IT ══════════════════      proposeResolution()
   challenge window must elapse · challengeResolution discards the outcome          │
   finalizeResolution is PERMISSIONLESS · invalidateStale is PERMISSIONLESS         ▼
                                                                          claim() → the OWNER
```

**The second human gate, and the one that decides who gets paid.** `/review` decides whether a market
exists; `/resolve` decides what its answer is.

### Why resolution is human-signed, when it did not have to be

Hard rule #3 permits a decision to pass through deterministic code *or* a human *or* the contract, and
a server-signed resolution would have satisfied it: the outcome is schema-constrained, the evidence URL
is substituted from our own record, and the contract holds the result for a challenge window before
anyone is paid. That version was nearly built.

It fails on one number. **The challenge window is 120 seconds and immutable.** Nobody vetoes anything
in 120 seconds. If that window were the only thing between a model emitting `YES` and a payout, a model
would be deciding who gets paid. So the human is *before* the proposal, which means `proposeResolution`
is signed in a browser — and `RESOLVER_ROLE` + `CHALLENGER_ROLE` went to the BridgeKey wallet. ADR-052
records what that cost: the sentence "holds `MARKET_CREATOR_ROLE` and nothing else" is gone, replaced by
a narrower one that is still checkable.

### The authority the resolution agent does NOT have

It has the most consequential output of the three agents, so it holds the least authority:

| It may say | It may **not** | Who decides instead |
|:--|:--|:--|
| `outcome` — YES / NO / INVALID / UNSETTLED | `UNRESOLVED` | the schema; `proposeResolution` reverts on it |
| `evidenceLabel` — one of the `EVIDENCE_n` we issued | a URL | `validate.ts` substitutes the real one |
| `settledByQuote` — copied verbatim | a paraphrase | the quote is **searched for in the text it was shown** |
| `rationale` — in words | a confidence score | it is not asked for one; a human reads every draft |
| — | **which articles to read** | IDF coverage over articles ingested since the market opened |

That last row is the one that matters most (ADR-053). A model that picks its own sources has already
picked the answer.

### What measurement changed — a fourth time, and the same shape again

| Found in live output | Fix |
|:--|:--|
| **Retrieval returned zero candidates for all four live markets.** Reusing Phase 3's headline-vs-headline Jaccard | Structural, not tuning: Jaccard divides by the *union*, and a market question is long by construction, so a headline reporting exactly the right thing still scores near zero. Replaced with asymmetric IDF **coverage of the question's terms** (ADR-060) |
| **Then the new threshold was wrong too.** 0.18 missed a true match by **0.003** | Measured the distribution: true matches at 0.165+, noise at 0.087 and below. Floor set to **0.12**, inside the gap, with the table in the code |
| The tick's `settle` skip was pushed into `report.errors`, so `pnpm tick` exited 1 | A deliberate skip is not a stage error. It is a note on the settle report now, and `errors` keeps meaning "something went wrong" |
| Fixed 60s-shaped stage deadlines made a **local** tick skip its last three stages — the tick did less on the machine you are watching than in production | The ladder now scales from one `maxDurationMs`; the CLI passes 300s, the route passes `maxDuration * 1000` so the two cannot drift |
| `SettleReport.claimableWei` was a `bigint` in a report returned by `NextResponse.json` | `JSON.stringify` throws on a `bigint` — a 500 on the endpoint the cron calls, caused by a field added for a log line. It is a decimal string now |
| `preflight` still printed "MARKET_CREATOR_ROLE only" about a wallet that now holds three roles | Checks all four roles and says which. The literal hashes were verified against the contract's own getters, because the first `CHALLENGER_ROLE` literal was wrong and the check passed anyway for the wrong reason |
| The projection kept `evidenceUrl` after a challenge; the contract clears it | A challenged market rendered the discarded proposal's evidence beside an `UNRESOLVED` outcome. Fixed, with a test |

ADR-029, ADR-049 and now ADR-060 are the same defect three times: **a threshold is a property of a
measure, and a measure is a property of the question being asked.** Every one was invisible to the unit
tests and obvious in one look at real output.

### The lifecycle, on chain, in one run

`pnpm --filter web lifecycle` — every check passed, ~5 minutes, market #8:

```
createMarket              deployer, MARKET_CREATOR_ROLE      block 5,796,280
placeBet YES 0.01         deployer, an ordinary bettor       block 5,796,284
placeBet NO  0.005        atlas's agent, capped by chain     block 5,796,288
a late bet                                                   REVERTED BettingClosed()
closeMarket               atlas's agent — no role at all     block 5,796,311
proposeResolution NO      deployer, RESOLVER_ROLE            block 5,796,314
finalize, too early                                          REVERTED ChallengeWindowOpen(…)
challengeResolution       → back to CLOSED, outcome gone     block 5,796,326
proposeResolution NO      round 2                            block 5,796,331
finalizeResolution        atlas's agent — no role at all     block 5,796,378
claim                     signed by atlas, PAID TO ITS OWNER block 5,796,384
claim again                                                  REVERTED AlreadyClaimed()
claim, losing side                                           REVERTED NothingToClaim()
invalidateStale(#1)       atlas's agent — permissionless     block 5,796,402
refund claim on #1        0.01 tMSTC returned                block 5,796,407
```

**The payout was checked three independent ways and all three agreed to the wei:**

```
hand-computed parimutuel   0.005 × (0.01 + 0.005) / 0.005  =  15000000000000000 wei
previewPayout(8, atlas)                                       15000000000000000 wei
owner balance delta        49998889067000000000 → 50013889067000000000
                                                            = 15000000000000000 wei
agent balance delta        −72489000000000 wei (gas only — it received nothing)
```

A contract test proves the arithmetic. Only this proves the arithmetic **and** that the money arrives
at an address that is not the sender, on a real chain.

### The keeper, and the claim it executes rather than asserts

`closeMarket`, `finalizeResolution` and `claim` are all permissionless in the contract, so the keeper
signs them with **an agent wallet holding no role at all** (ADR-058). Production has no admin key; a
keeper that needed one would be a keeper that only worked on a laptop. Two keeper closes came out of an
ordinary tick, not a script, sent by `kestrel`'s agent wallet — blocks 5,796,567 and 5,796,572.

`invalidateStale` is deliberately **not** automated (ADR-057): it refunds everyone, and running it the
instant `resolveDeadline` passes would mean our own resolver being ten minutes late costs every bettor
their market.

### The resolution agent, proved on real data without writing anything

`pnpm --filter web resolution:dry-run` runs deterministic retrieval, the real model and the real
validator against a live market and writes nothing. On market #7 it retrieved the correct Al Jazeera
article (coverage 0.297), quoted it **verbatim**, and the validator confirmed the quote was in the text
— then refused the draft because the market is still open (`BettingStillOpen`), which is the validator
proving it is wired up. On market #5 it retrieved the Washington Post piece and answered `UNSETTLED`:

> "The provided article reports on the court ruling itself but does not contain any information
> regarding whether the Department of Justice has filed a formal notice of appeal."

That is the correct answer, and it writes no row (ADR-055).

### Exit criteria

| Criterion | Result |
|:--|:--|
| Full lifecycle on chain: create → bet → close → propose → finalize → claim | ✅ market #8, every hash above |
| A challenge is exercised on chain and forces re-proposal | ✅ `0x1e38128c…` → `CLOSED`, outcome discarded, count 1 |
| Winner balances increase by the correct parimutuel amount, asserted against computed values | ✅ **three independent ways, agreeing to the wei** |
| Double-claim reverts | ✅ on chain `AlreadyClaimed()` **and** a contract test |
| `winningPool == 0` refunds everyone (tested) | ✅ contract test; the INVALID refund path also exercised live on #1 |
| Every step has a real tx hash recorded in `PROGRESS.md` | ✅ 15 hashes in "Real artifacts" |
| `pnpm -r build` / `lint` / `typecheck` / `test` | ✅ **414 tests** — 57 contracts + 357 web across 22 files, zero warnings |
| Visible: market detail through to payout, plus `/audit` | ✅ `/resolve`, `/audit`, `/markets/[id]` |

---
## Phase 5 — what shipped

### The shape of it

```
OPEN market a human signed ──> screenAgent ──> member agent ──> Zod ──> policyGate ──> intent ──> placeBet
  (proposal_id NOT NULL)      (no LLM yet)      (LLM, bounded)    │       (PURE)         │        │
                                   │                             │          │           │   agent's own key
                              DEFER│REJECT              SCHEMA_REJECTED   REJECT         │   (encrypted at rest)
                              (no row)(row)                  (row)        (row)          │
                                                                                         ▼
                                       ══════════ AND THE CONTRACT CAPS IT AGAIN ══════════
                                        per-tx cap · per-market cap · agent holds no role
```

**Nine decisions, six of them refusals, one refused by the chain itself.** The refusals are the
evidence; a page of approvals would prove nothing.

### The gate, and what it refuses

`lib/policy/policyGate.ts` is **pure** — no network, no DB, **no clock read inside it**. Time,
balances, the day's spend and the on-chain caps are all injected, which is why 50 tests pin every
branch with no infrastructure at all.

It clamps rather than trusts:

```
finalStake = min( requested, off-chain per-tx cap, remaining daily budget,
                  on-chain per-tx cap, remaining on-chain per-market headroom,
                  wallet balance − gas reserve )
```

Every limit that binds is named in `reasons` **even when the bet is allowed** — and "reduced the
stake" and "the stake is exactly at this limit" are reported as different things, because the
contract distinguishes them too (at the cap it accepts, one wei over it reverts).

### The distinction that cost the most thought

`agent_decisions` is unique on `(market_id, member_id, round)`, so **writing a row is terminal** for
that pair. The gate therefore returns three verdicts, not two:

| Reason | Verdict | Why |
|:--|:--|:--|
| market closed, category not allowed, abstained, confidence too low | **REJECT** — row written | can never change |
| kill switch, agent unregistered, wallet unfunded, daily budget spent | **DEFER** — no row | recovers on its own |

Get this backwards and an agent is frozen out of a market for ever because a wallet was briefly
empty. Same trap as Phase 4's `proposals.event_id`, more expensive. ADR-045.

**The subtle one, caught by a test:** `agentRemainingOnMarket` returns `0` for an agent the contract
does not know — identical to a genuinely exhausted cap. Unguarded, an unregistered agent would read
as "cap spent" and be permanently barred from a market it had never bet on.

### What measurement changed — a third time, and the same shape as before

| Found in live output | Fix |
|:--|:--|
| **Four abstentions out of four.** Rationales: "the sources discuss past interest rate decisions" | The prompt said to abstain when the material does not settle the question — and a market must ask about something not yet known, because the proposer is instructed to. Two prompts, each sensible alone, composed into a pipeline that **could never place a bet**. Reframed as forecasting (ADR-049) |
| Every abstention row also carried `STAKE_TOO_SMALL` | An abstention has no stake. It now short-circuits every later check, so the row says `ABSTAINED` and nothing else |
| `date_trunc('day', now() at time zone 'utc')` compared against a `timestamptz` | Postgres reads the naive side in the **session** time zone. This database is GMT so it happened to be right; on `Asia/Kolkata` an agent would get a second day's budget in the evening. Now anchored with a trailing `at time zone 'utc'` |

ADR-031 and ADR-040 were the same pattern: the defect was in how two correct components met, and
only real output showed it.

### Live results

```
atlas    #4 WORLD     YES 0.75  →  0.005 tMSTC staked   0x5f8a12c6… block 5,794,730
atlas    #5 POLITICS  YES 0.65  →  0.004 tMSTC staked   0xc2a42699… block 5,794,735
vega     #4 WORLD     CATEGORY_NOT_ALLOWED (ECONOMY, BUSINESS only)
vega     #7 POLITICS  CATEGORY_NOT_ALLOWED
kestrel  #6 ECONOMY   CATEGORY_NOT_ALLOWED + MEMBER_KILL_SWITCH
kestrel  #7, #4       DEFERRED — kill switch. No row, reconsidered next tick.
atlas    #4 round 99  GATE BYPASSED → AgentPerTxCapExceeded(20000000000000001, 20000000000000000)
```

`pnpm --filter web verify:agents` — **41 live checks, writing nothing**, three agents × :

```
PASS  holds no DEFAULT_ADMIN_ROLE / MARKET_CREATOR_ROLE / RESOLVER_ROLE / CHALLENGER_ROLE
PASS  registered · active · caps match policy · winnings paid to the owner we expect
PASS  the off-chain cap is the tighter one        policy 0.01 < chain 0.02
PASS  a bet of EXACTLY the cap is accepted        20000000000000000 wei
PASS  a bet ONE WEI over the cap is refused       AgentPerTxCapExceeded(…001, …000)
PASS  kill switch: 0 LLM calls, 0 approvals, 0 rows written, halt recorded with its reason
```

That last pair is the claim from both sides: the contract accepts exactly the cap and refuses one wei
more, and `policyGate.test.ts` pins the off-chain gate to the same wei. Neither is asserted from the
other — one is a unit test, the other is a live `eth_call`.

### Exit criteria

| Criterion | Result |
|:--|:--|
| `policyGate.ts` unit-tested on every branch, incl. exactly-at-cap and one-wei-over | ✅ **50 tests**, no chain/DB/model needed |
| The gate is pure: no network, no DB, no clock inside it | ✅ asserted by a purity test; time is injected |
| At least one agent bet lands on-chain within caps | ✅ **two**, blocks 5,794,730 and 5,794,735 |
| At least one proposal **rejected by the gate**, reasons shown in the UI | ✅ **six**, rendered verbatim on `/agents` |
| **The over-cap tx reverts on-chain**, visible on MSTScan | ✅ `0xf0152234…` — the explorer decodes both numbers itself |
| Flipping the kill switch stops all agent betting without touching the contract | ✅ `verify:agents` asserts 0 calls, 0 rows, 0 transactions |
| An agent wallet cannot call `createMarket` or `proposeResolution` | ✅ contract test + a live `hasRole` check per agent for all four roles |
| `pnpm -r build` / `lint` / `typecheck` / `test` | ✅ **368 tests** (57 contracts + 311 web), zero warnings |

---
## Phase 4 — what shipped

### The shape of it

```
CONFIRMED event ──> proposer agent ──> Zod ──> deterministic rules ──> PENDING_REVIEW
   (Phase 3)         (LLM, bounded)     │            │                      │
                                        └─ fails ────┴──> SCHEMA_REJECTED   │  ═══ HUMAN ═══
                                             (kept, shown, never queued)     │        │
                                                                             │   BridgeKey
   Discord + in-app feed <── indexer <── confirmed log <── createMarket tx <──┘   signature
      (only after this)
```

**The key that creates a market is in a browser wallet and on no server AuspeX runs.** That is
not a policy; it is why `lib/intents/engine.ts` needed a second signer kind (ADR-037).

### Where authority was taken away from the model

The proposer returns **seven constrained fields and not one free value**:

| The model may say | It may **not** say | Who decides instead |
|:--|:--|:--|
| `resolutionSourceLabel` — one of the `SOURCE_n` we issued | a URL | `validate.ts` substitutes the real one |
| `closeInHours`, bounded 2–72 | an absolute time | `closeTime = now + hours`, computed |
| `category` from a fixed enum | free text | Phase 5's policy gate allowlists these |
| `ambiguityRisk` | whether to proceed | a human, who sees the rating as a warning |

A label we never issued is discarded — the check an API-side JSON schema structurally cannot make,
because `resolutionSourceLabel` is a well-typed string there whatever it contains (ADR-035).

### The deterministic gate, and what it refuses

`lib/proposer/validate.ts` is pure — no I/O, no clock — and collects **every** failing rule rather
than the first, because the rejection row is evidence:

1. the resolution source label was one we issued
2. the question ends in `?` and opens with a word that admits yes/no (`Should` is excluded — an
   opinion has no fact at a source that settles it)
3. neither question nor criteria contains an unresolvable term (`significantly`, `likely`, `major`, …)
4. **the model's own output is scanned for injection signatures** — text that passed *through* a
   model after being derived from a hostile headline is still hostile
5. the horizon is inside this deployment's window
6. the question names no year that ended before the market closes

### What measurement changed — again, two defects found by reading real output

Both were in the first live run's actual specs, not in anything a test would have predicted:

| Found in live output | Fix |
|:--|:--|
| A spec's `resolutionSourceUrl` was `https://news.google.com/rss/articles/CBMiqAF…` — opaque on the explorer, expires, and not demonstrably the publisher's | Rule 7: the URL must resolve to the credited publisher, else degrade to `https://<domain>/` (ADR-040) |
| `"Will the pandas arrive … by 12:00 PM EST on November 20, 2024?"` on a market closing the next day | Rule 6 above, plus the current instant is now stated in the prompt |

**The first fix for the redirect was wrong, and the database said so.** Excluding redirect links
outright starved the pipeline completely: **every** confirmed event's articles were Google News
redirects. That is structural — confirmation needs two independent publishers, and only the
aggregator carries one story from several of them, while the four direct publisher feeds each cover
different stories and so make single-publisher events that stay `OBSERVED` by design. Measured:
130 direct URLs, 69 redirects, and 4/4 confirmed events with **zero** usable direct links.

### Live results

Four real proposals in the queue, all drafted by `gemini-3.1-flash-lite` from confirmed events:

```
Will Zoo Atlanta issue an official press release confirming that Ping Ping and
  Fu Shuang have been moved into their public exhibit space?            WORLD
  → resolves at theguardian.com/us-news/2026/sep/27/giant-pandas-…  (direct link)
Will the Department of Justice file an appeal against the court ruling
  that blocks tying anti-terrorism grants to election changes?        POLITICS
Will the Federal Reserve announce a further increase in the federal
  funds rate at their next scheduled meeting?                          ECONOMY
Will the Iranian government issue an official public statement accepting
  the terms of the sanctions relief offer…                            POLITICS
```

`pnpm --filter web verify:approval` — **8/8 against the live chain, writing nothing**:

```
PASS  authority holds MARKET_CREATOR_ROLE   hasRole() == true
PASS  contract is not paused                paused() == false
PASS  authority can pay for gas             50 tMSTC
PASS  stored hash matches the spec          0x9f2aeaca…8d6909
PASS  specHash is unused on chain           free
PASS  closeTime is still in the future      47.7 h left
PASS  eth_call createMarket succeeds        would create market #4
```

That last line is the real check: the exact calldata, sent `from` the authority address, against the
deployed contract at the current block. A revert there is the revert the wallet would produce —
decoded now rather than in front of a judge.

### Exit criteria

| Criterion | Result |
|:--|:--|
| A confirmed event produces a schema-valid proposal | ✅ **4 live**, from real confirmed events |
| A malformed model output is rejected, logged, and does **not** reach the queue | ✅ `draft.test.ts` covers invented label, Zod failure, missing field, prose-instead-of-JSON; `/review` renders the validator live over a constructed bad draft |
| Nothing on-chain and no notification before human approval | ✅ a full tick with 4 queued proposals reported `notify: eligible 0, created 0`; after approval the same code sent exactly 4, each carrying its tx hash (ADR-042) |
| Approving signs via BridgeKey → a real `createMarket` tx | ✅ **four of them**, from `0xA9F68fDf…311fF1`, blocks 5,793,477–485, all `result: success` |
| The on-chain `specHash` matches the hash of the approved spec | ✅ **all four**, re-derived from `proposals.spec` and compared to `getMarket().specHash` — byte-identical |
| Re-submitting the same approved spec is rejected by the contract | ✅ **all four revert** `SpecHashAlreadyUsed(0x…)`, proved by `eth_call` against the deployed contract |
| With `GEMINI_API_KEY` unset, a tick logs the failure, takes no action, does not crash | ✅ `draft.test.ts` asserts `UNAVAILABLE` with **zero budget spent and no row written** |
| `pnpm -r build` / `lint` / `typecheck` / `test` | ✅ **268 tests** (57 contracts + 211 web), zero warnings |

---
## Phase 3 — what shipped

### The blocker that was not a blocker

**Gemini works, on the free tier, with no card.** Two sessions recorded this as "the one real
blocker" needing billing. The actual error, read in full for the first time, was:

> `Your prepayment credits are depleted.` — HTTP 402, on *every* model including Gemma.

That is **project-scoped prepay exhaustion, not an account-wide billing wall**. A key created in
a Google Cloud project with no billing account attached falls straight back to the free tier and
works. `pnpm preflight` is now **9/9 green**. The lesson worth keeping: two sessions inferred the
cause from a status code instead of reading the body.

The key now in `.env.local` belongs to project `agentforge-gemini-free`. The old key is untouched.

### The pipeline

**`web/lib/news/`** — ingest → cluster → confirm, every stage bounded and idempotent.

- `feeds.ts` — 8 keyless feeds (3 Google News queries, 4 publisher RSS, 1 GDELT). Each fetch is
  individually timed out and individually caught: **a failing feed is not a failing tick**.
- `parse.ts` — hand-rolled RSS/Atom/GDELT extraction. The load-bearing part is taking the
  publisher from Google News's `<source url>` rather than the link; trusting the link would
  attribute every story on Earth to `news.google.com` and make the two-source rule meaningless.
- `sources.ts` — a curated 50-publisher independence allowlist. Unknown publishers are ingested
  and displayed but **never counted** toward confirmation.
- `normalize.ts` / `similarity.ts` / `cluster.ts` — pure, no I/O, no clock.
- `confirm.ts` — the two-source rule, with syndication discounting.
- `events.ts` — persistence, fully batched (ADR-033).

**`web/lib/llm/`** — `prompt.ts` (sealed `<untrusted_content>`), `gemini.ts` (transport +
error classification), `client.ts` (budget, fallback, Zod re-validation). `callJson` **never
throws and never returns unvalidated data** — it returns a discriminated union, so a 429 is an
ordinary value every caller must handle rather than an exception someone forgets to catch.

**`web/lib/pipeline/tick.ts`** — each stage caught individually; the tick completes and reports
what failed. `POST /api/tick` (secret-authenticated) and a **Run tick** button on `/`.

### What measurement changed

Almost every number in this phase came from data, not from the plan. Four things were wrong
before they were measured:

| Found | Fix |
|:--|:--|
| Stemmer folded `rates`→`rat` while leaving `rate` — pushing the two forms it was meant to unify *further apart* | `-es` restricted to genuine plural contexts; `-ing` rule dropped |
| Plan's 0.6/0.4 bands did not fit the measure; and adding article summaries made discrimination **worse**, inverting the ranking on a true/false pair | Cluster on headlines only; bands 0.50/0.25, read off the live distribution (ADR-031) |
| One INSERT per cluster ⇒ **420-second tick** against a 60-second function limit | Batch every write (ADR-033) |
| `invisible-characters` fired on three Guardian articles — their own typesetting, not an attack | Signature scoped to headlines (ADR-032) |

Two smaller ones: `cleanText` stripped tags *before* decoding entities, so Google News's
entity-encoded markup survived into the database and the prompt; and `weightedJaccard(a,b)` and
`(b,a)` differ in the last bits (float addition is not associative), which made clustering depend
on database row order until the argument order was canonicalised.

**The honest headline finding:** two genuinely different reports of one story score ~0.44, and two
genuinely *unrelated* stories score ~0.37 — **interleaved**, not separated. No lexical threshold
can tell them apart. That is why the borderline band exists and why the model is consulted only
inside it. ADR-031 has the evidence table.

### Live results

Three consecutive real ticks against real feeds and the real database:

```
tick 1   228 items, 69 publishers, 190 events, 2 CONFIRMED      420s   (pre-batching)
tick 2   228 fetched /   9 new     — idempotent                  91s   (post-batching)
tick 3   228 fetched /   1 new     — idempotent                  48s   (+ model reorder)
```

Current state: **238 articles · 106 publishers · 198 events · 3 CONFIRMED**, with confirmed
events carrying NPR + BBC + CBS, Guardian + NYT + AP, and CNN + Axios.

### Exit criteria

| Criterion | Result |
|:--|:--|
| A tick ingests real articles from ≥3 independent publishers | ✅ **106 publishers** |
| Two genuinely different reports of one story cluster into a single `Event` | ✅ live (Guardian+NYT+AP on one ECB decision) and in `cluster.test.ts` |
| An `Event` with only one publisher domain stays `OBSERVED` | ✅ `confirm.test.ts`, and 195 such events on the dashboard |
| Re-running the same tick creates zero duplicate `RawItem` rows | ✅ 228 fetched → 1 new |
| An injected string is flagged **and visibly delimited in the prompt sent** | ✅ `prompt.test.ts` end-to-end, plus the worked-example panel on `/` |
| LLM calls per tick are bounded and logged; a forced 429 leaves state consistent | ✅ `client.test.ts` forces all 10 failure kinds; budget bound asserted |
| `pnpm -r build` / `lint` / `typecheck` / `test` | ✅ **199 tests** (57 contracts + 142 web), zero build warnings |

---
## Phase 2 — what shipped

### The data layer

**`web/lib/db/schema.ts`** — 14 tables, 8 Postgres enums, migrated onto the real Neon database
(`web/drizzle/0000_phase2_pipeline_state.sql`). Every table in `docs/ARCHITECTURE.md` §8, plus
`indexer_cursors`. Money is `numeric(78, 0)` — the exact decimal width of a uint256 — never a
float and never a JS `number`, because 1 tMSTC is 1e18 wei and that is already past
`Number.MAX_SAFE_INTEGER`.

**Every unique constraint is commented with the guarantee it carries**, and each is proved to
fire by a test that inserts the duplicate and asserts the rejection:

| Constraint | What breaks without it |
|:--|:--|
| `raw_items(source_id, source_guid)` | re-ingesting a feed duplicates articles |
| `onchain_intents(idempotency_key)` | two racing ticks produce two transactions |
| `chain_events(tx_hash, log_index)` | indexer replay doubles pool balances |
| `markets(spec_hash)` | the same approved spec creates two markets |
| `agent_decisions(market_id, member_id, round)` | a restarted tick bets twice |
| `markets(onchain_id)` **partial** | unique when set, many `ONCHAIN_PENDING` nulls allowed |

**`web/lib/db/client.ts`** — `pg` + `drizzle-orm/node-postgres` (ADR-025). Neon's HTTP driver
cannot hold a transaction open, and `FOR UPDATE SKIP LOCKED` inside a transaction is the whole
mechanism. `db` is a lazy `Proxy`: importing the module never throws, so a missing `DATABASE_URL`
renders an honest error page instead of failing the build.

### The chain client

**`web/lib/chain/`** — `deployment.ts` reads the committed deploy record, so **there is now one
ABI in the repository**; Phase 1's hand-written fragments in `lib/contract.ts` are deleted (that
was known gap #4). Plus `provider.ts` (static network, no chain-id round trip per call),
`auspex.ts` (typed reads), `spec.ts` (canonical, key-sorted spec hashing) and `revert.ts` — the
ADR-023 decoder lifted out of `contracts/scripts/smoke.ts`, now with 12 tests including one that
round-trips **every** custom error the contract declares.

### The indexer

**`web/lib/indexer/`** — `eth_getLogs` from the deploy block with a persisted cursor and a
3-block confirmation depth. The projection (`project.ts`) is a **pure fold**: no network, no
database, no clock. Replay recomputes rather than accumulates, so idempotency is a property of
the function, not of remembering what was seen.

The fold also de-duplicates `(txHash, logIndex)` itself (ADR-026). That guard exists because the
test asserting it **failed on the first run** — `BetPlaced` adds to a pool, so a duplicated log
silently doubles someone's money, and a function whose correctness depends on its caller having
deduplicated is one refactor from being wrong.

### The intent engine — the centre of the phase

**`web/lib/intents/engine.ts`.** The only code in the repository that may broadcast.
**Sign → persist the signed bytes → broadcast** (ADR-027). The naive "write a row, then send"
still loses a transaction if the process dies between `eth_sendRawTransaction` returning and the
`UPDATE` committing — and the retry then re-signs, which is a *second* transaction. Signing first
fixes the hash before the bytes leave the process, so every recovery is a rebroadcast of
identical bytes that the network deduplicates by hash.

Nonces are `max(node pending count, our highest recorded nonce + 1)` under a Postgres advisory
lock on the sending address. Claims take a **lease** rather than holding a transaction open
across a 45-second receipt wait. A revert is a terminal state with its custom error decoded, not
a failure — Phase 5 needs the revert to be the evidence.

### Visible: `/markets`

Reads `getMarket()` from the contract for every market **on every page load** and renders those
numbers (ADR-028). The database supplies only the creating tx hash and bet count, labelled as
indexed. A broken or sleeping indexer therefore cannot put a stale number on the page; when the
two disagree the card shows an `indexer drift` badge rather than hiding it. Every market links to
MSTScan. `/` gains a live `paused()` kill-switch reading and a link through.

`GET /api/index` returns indexer status; `POST /api/index` runs a pass behind `TICK_SECRET` and
refuses to run at all if that secret is unset rather than defaulting to open.

### Exit criteria

| Criterion | Result |
|:--|:--|
| Migrations apply cleanly to a fresh Neon database | ✅ `schema.test.ts` creates a real throwaway database, migrates from empty, drops it |
| Indexer ingests the Phase 1 smoke-test events and reconstructs correct market state | ✅ 9 logs → 3 markets, pools recomputed from `BetPlaced` and asserted |
| **Crash test: kill the worker mid-send, re-run — exactly one tx, no duplicate rows** | ✅ see below |
| Re-running the indexer from block 0 is idempotent | ✅ second full replay reports `8 fetched, 0 newly stored` |
| `/markets` renders real chain data with working MSTScan links | ✅ verified in a browser |
| `pnpm -r build` / `lint` / `typecheck` / `test` | ✅ 57 contract tests + 37 web tests, all green |

### The crash test, in full

`pnpm --filter web crash-test` — against the real testnet and the real database. The worker runs
in a **child process** killed with `process.exit(1)`; a thrown error would unwind through the
engine's own error handling, which is the code path the design exists to survive *around*.

```
0 · marketCount() = 2
2 · crash AFTER SIGNING       → status=SIGNED   txHash=0xeabf2271…befe83   child exited 1
3 · crash AFTER BROADCAST     → status=BROADCAST txHash=0xeabf2271…befe83  child exited 1
4 · run to completion         → status=CONFIRMED block=5787574 gasUsed=265965
5 · intent rows = 1 · MarketCreated logs = 1 · marketCount() 2 → 3
```

The hash is **identical at all three points**. Confirmed independently through
`testnet.mstscan.com/api/v2`: `status: ok`, `result: success`, method decoded as `createMarket`.

---
## Phase 1 — what shipped

**`contracts/contracts/AuspexMarket.sol`** — 0.8.28 / cancun / optimizer 200, on OpenZeppelin 5
(`AccessControl`, `Pausable`, `ReentrancyGuard`, `SafeCast`). Implements `docs/CONTRACTS.md`:
market lifecycle, parimutuel payout, the agent registry with per-tx and per-market caps, resolution
with a challenge window, permissionless finalisation, pull-based `claim()`, a pause kill switch,
custom errors throughout, and rich events for the indexer.

**Three properties it enforces that a judge can check on the explorer:**

1. **Agent wallets hold no role.** They are entries in a registry, and every entry is a
   *restriction*, never a permission. An agent cannot create a market, resolve one, pause, or
   register agents — all asserted in tests.
2. **Caps are enforced by the chain.** One wei over `perTxCap` reverts
   `AgentPerTxCapExceeded(attempted, cap)`. The cumulative `perMarketCap` catches a series of
   individually-legal bets. This holds even if our server is fully compromised.
3. **Winnings are paid to the registered owner**, never to the agent wallet. A stolen agent key
   cannot steal funds.

**`contracts/test/AuspexMarket.test.ts`** — **57 tests, all passing, none skipped.** Covers the
whole `docs/CONTRACTS.md` §12 matrix. Every `revert` path asserts its *specific* custom error, not
merely that the call reverted. Notable cases: exactly-at-cap vs one-wei-over, a deactivated agent
being blocked rather than un-capped, hand-computed parimutuel payouts, integer-division dust left in
the contract, `winningPool == 0` refunding everyone, a real re-entrancy attacker contract getting
paid exactly once, and `claim()` still working while the contract is paused.

**Additions beyond the original spec** (each has an ADR):
- `closeMarket` — permissionless `OPEN → CLOSED` once `closeTime` passes, so the transition is an
  indexable event. `proposeResolution` auto-closes an overdue market so nothing can strand.
- `invalidateStale` — permissionless refund path when a resolver never shows up (ADR-021).
- `forceInvalidate` gated on 3 recorded challenges, so admin power is bounded (ADR-022).
- `previewPayout` / `totalPool` / `agentRemainingOnMarket` / `getMarket` views for the dashboard.

**`contracts/scripts/smoke.ts`** (`pnpm --filter contracts smoke:testnet`) — post-deploy check
against the *real* chain: asserts all four roles landed on the deployer, creates a market, places a
bet, reads the state back over the public RPC, and proves the replay guard rejects a duplicate
`specHash` live. Re-runnable (the spec hash includes a timestamp).

**`web/lib/contract.ts` + the status page** — `/` now reads the deployed contract on every load:
`eth_getCode` (10,800 bytes), `marketCount()`, `challengeWindow()`. No fallback values; if the
contract cannot be read the page shows the real error. The page no longer claims "not deployed yet".

**`web/next.config.mjs`** — loads the repo-root `.env.local` locally so the monorepo keeps one
secrets file (the same one hardhat reads). No-op on Vercel; never overrides an existing value.

### Exit criteria

| Criterion | Result |
|:--|:--|
| `pnpm --filter contracts test` — all green, none skipped | ✅ 57/57 |
| Every `revert` path has a test asserting its specific custom error | ✅ |
| Contract deployed to chain `91562037`; address + tx recorded here | ✅ |
| Contract shows **Verified** on `testnet.mstscan.com` with readable source | ✅ `is_verified: true` |
| Deployer holds `DEFAULT_ADMIN_ROLE`, `MARKET_CREATOR_ROLE`, `RESOLVER_ROLE` | ✅ read live, +`CHALLENGER_ROLE` |
| A manual `createMarket` + `placeBet` produces two real tx hashes | ✅ four, across two runs |
| `pnpm -r build` / `lint` / `typecheck` | ✅ all green |

---

## Blocking items for you — `docs/RUNBOOK.md` has exact steps

| # | Item | Blocks | Status |
|:--|:--|:--|:--|
| §1 | ~~Enable Gemini billing~~ | Phases 3–5 | ✅ **resolved without billing** — see below |
| §3 | Neon Postgres | Phase 2 | ✅ done |
| §4 | Discord webhook | Phase 4 notifications | ✅ done |
| §5 | BridgeKey install + fund + role grant | Phase 4 approvals | ✅ **done 2026-09-29** |
| §8 | Secrets into Vercel + GitHub | Phase 3 in production | ✅ done |
| §9 | `HUMAN_AUTHORITY_ADDRESS` into Vercel | `/review` in production | ✅ **done 2026-09-29** |
| — | Approve a proposal in `/review` with BridgeKey | Phase 4 exit criterion | ✅ **done — 4 markets** |
| §6 | Agent wallets: seed, fund, register caps on chain | Phase 5 betting | ✅ **done 2026-09-29** — one local command |

**Every manual blocker is closed.** Nothing is waiting on the user.

**§1 was never a billing wall.** The 402 body says `Your prepayment credits are depleted` — that
is *project-scoped* prepay exhaustion. A key in a project with no billing account attached uses
the free tier and works. No card was added. `pnpm preflight` is 9/9.

**§8 is done.** Pushed to Vercel (production + preview): `GEMINI_API_KEY`, `TICK_SECRET`,
`AGENT_KEY_ENC_SECRET`, `DISCORD_WEBHOOK_URL`, `GEMINI_MODELS_FAST`, `GEMINI_MODELS_SMART`,
`GEMINI_TIMEOUT_MS`. Pushed to GitHub Actions: `TICK_SECRET`, `TICK_URL`. So the heartbeat and
`POST /api/tick` now work on the deployed site.

**`DEPLOYER_PRIVATE_KEY` is still deliberately NOT in Vercel, and Phase 5 made that permanent.**
The deployed app now *does* sign transactions — but only `placeBet`, with per-member agent keys that
hold no role and are capped by the contract. `registerAgent` needs `DEFAULT_ADMIN_ROLE`, so agent
registration is a local command (`pnpm --filter web agents:register`) and the admin key never reaches
production. A production tick that claims a registration intent cannot sign it, defers it **without
burning an attempt**, and records why (ADR-047).

So the property to state to a judge: **the deployed application holds no key that can create a
market, resolve one, grant a role, pause the contract or change an agent's caps.**

**§5 is done — every manual blocker is now closed.** The BridgeKey wallet
`0xA9F68fDf84388fa548a685085E2bee0e5b311fF1` exists, holds 50 tMSTC verified against our own RPC
(so it is genuinely on chain `91562037`, not a look-alike network), and now holds
`MARKET_CREATOR_ROLE` — tx `0xe4ed912c…932069`, block 5,790,485, `result: success` on MSTScan.

**The role boundary is the trust claim, and it is checkable on chain:**

| Role | BridgeKey (human) | Deployer |
|:--|:--|:--|
| `DEFAULT_ADMIN_ROLE` | ❌ | ✅ |
| `MARKET_CREATOR_ROLE` | ✅ | ✅ |
| `RESOLVER_ROLE` | ✅ *(Phase 6)* | ✅ |
| `CHALLENGER_ROLE` | ✅ *(Phase 6)* | ✅ |

**Updated in Phase 6.** The human wallet holds every role that requires human **judgement** and none
that confers **power**: it can create a market, propose an outcome and challenge one, and it cannot
register an agent, change a cap, or pause the contract, because it does not hold
`DEFAULT_ADMIN_ROLE`. From Phase 4 onward a market can only come into existence through a signature
from a key no server holds; from Phase 6 onward the same is true of its outcome.

`RESOLVER_ROLE` and `CHALLENGER_ROLE` were deliberately withheld until Phase 6 actually needed them —
granting a capability two phases before anything uses it is how least privilege quietly stops meaning
anything. ADR-052 records why Phase 6 needed them and what the change cost. To grant or revoke a role:
`ROLE=RESOLVER_ROLE TO=0xA9F6… pnpm --filter contracts grant:testnet`.

The recovery phrase is the user's alone. It was never requested, never shared, and is not needed
by anything in this repository.

## Decisions already locked in

Full rationale with evidence in `docs/DECISIONS.md` (ADR-001 … ADR-028).

From Phase 0: Hardhat 3 not 2 · explorer is `testnet.mstscan.com` · Fortuna VRF cut (no bytecode) ·
`evmVersion: cancun` · strings on-chain deliberately · ethers v6 over the MST SDK · parimutuel not
AMM · two independent agent limit layers · wagmi `injected()` · Gemini free tier not demo-viable
(ADR-017) · faucet leaks its dispensing key (ADR-018).

New in Phase 1:

- **ADR-019 — `challengeWindow` is `immutable`.** An admin who could set it to 0 could propose and
  finalise in one block, making the window decorative.
- **ADR-020 — deactivating an agent blocks it entirely.** The naive `if (agent.active)` branch has an
  inverted failure mode: deactivation would drop the agent into the *uncapped* path.
- **ADR-021 — `invalidateStale` is permissionless.** A resolver who never shows up must not be able
  to strand funds, the same way a silent one cannot block a payout.
- **ADR-022 — `forceInvalidate` requires 3 recorded challenges.** An unconditional admin cancel would
  sink the trust argument.
- **ADR-023 — the MST RPC hides custom-error data in the error *message*.** ethers cannot auto-decode
  it (`error.revert` is `null`). Phase 5's headline demo depends on rendering
  `AgentPerTxCapExceeded(attempted, cap)`, so the decoder matters.
- **ADR-024 — storage `ReentrancyGuard`, not the TSTORE one.** Cancun was probed via `eth_call`, not
  exercised in a real transaction, and the guarded function is the one that pays people.

New in Phase 2:

- **ADR-025 — one Postgres driver (`pg`), not Neon's HTTP client.** The HTTP driver cannot hold a
  transaction open, and `FOR UPDATE SKIP LOCKED` inside a transaction is the mechanism. Also: TLS on
  by default, off only for an explicit `sslmode=disable`.
- **ADR-026 — the projection is a pure fold that de-duplicates its own input.** Replay recomputes
  rather than accumulates. The de-dup guard exists because the test asserting it failed first time.
- **ADR-027 — sign, persist, *then* broadcast.** Fixing the hash before the bytes leave the process
  is what makes every crash recovery a rebroadcast rather than a re-signing. This is the phase's
  central claim and `pnpm --filter web crash-test` demonstrates it on the real chain.
- **ADR-028 — `/markets` reads the chain directly; the database only annotates.** The failure mode
  of a mirror is silently showing yesterday's numbers as current.

New in Phase 3:

- **ADR-029 — no MinHash.** It exists to avoid all-pairs comparison at millions of documents; we
  cap at 200, where all-pairs measures under 20ms. It is an approximation, so it adds false
  negatives to the one stage where a false negative silently stalls the pipeline.
- **ADR-030 — an unavailable model means "do not merge".** Failing to merge costs a tick; wrongly
  merging manufactures a second source, confirms a story that does not exist, and puts a
  fabricated question in front of a human. The directions are not symmetric, so the default is
  the no-op — by construction, not by a catch block.
- **ADR-031 — cluster on headlines; thresholds measured, not inherited.** Adding article summaries
  made discrimination *worse* and inverted the ranking on a true/false pair. And the true and
  false pairs are interleaved in the 0.35–0.44 range, so no threshold separates them — the band
  is drawn to contain that ambiguity rather than pretend it away.
- **ADR-032 — the injection scanner is triage, not defence.** Flagged items are still processed;
  dropping them would make a blocklist load-bearing and let anyone delete stories by looking
  malicious. `invisible-characters` is headline-scoped because scanning bodies flagged the
  Guardian's own typesetting every tick.
- **ADR-033 — batch every write.** Round trips, not work, were the cost: 420s → 48s.
- **ADR-034 — prefer the model that answers, not the newest.** `3.5-flash-lite` timed out twice
  and 503'd once; `3.1-flash-lite` answered every time.

New in Phase 4:

- **ADR-035 — the proposer picks a resolution source by label; it never types a URL.** The one spec
  field that both goes on chain and points somewhere. A model that can type a destination can type
  one that is expired or hostile; one that picks from a menu cannot. Same mechanism as
  `adjudicate.ts`'s `pairLabel`, where the consequence is permanent instead of cosmetic.
- **ADR-036 — the proposer uses the FAST chain, not SMART.** A model that does not answer drafts
  nothing, however capable. The task is narrow by construction.
- **ADR-037 — `onchain_intents.signer` is `SERVER | EXTERNAL`; the worker never signs an EXTERNAL
  intent.** A column, not an inference from `from_address`, because Phase 5's agent wallets *are*
  ours. Excluded in the claim query, not claimed-and-skipped, or a ten-minute wait for a human
  would exhaust `MAX_ATTEMPTS`.
- **ADR-038 — the reported tx hash is verified against the node, never believed.** `from`, `to` and
  `data` must all match the authorised intent. Otherwise anyone reaching the server action could
  mark a proposal approved by pasting a hash.
- **ADR-039 — rejection is authenticated by a signature; approval is authenticated by the chain.**
  An approval proves itself — only the authority's key produces a tx the contract accepts. A
  rejection leaves no on-chain trace, so it carries an EIP-191 signature over the proposal's own
  identity.
- **ADR-040 — an aggregator redirect degrades to the publisher's front page.** The obvious fix
  (exclude them) starved the pipeline completely; measurement, not reasoning, caught that.
- **ADR-041 — the model's self-assessed risk is shown to the human, never used to filter.** A model
  that wanted approval would rate itself LOW.
- **ADR-042 — notifications select on indexer-written columns, so they cannot fire early.** A
  selector that cannot match is stronger than a check that can be reordered away.

New in Phase 5:

- **ADR-043 — the agent emits a *fraction* of its own cap, never an amount.** A model that can type
  an amount can type `1e30`. A fraction is bounded by construction, and `Infinity` maps to zero
  rather than to the cap — the fail-safe direction.
- **ADR-044 — the gate is two functions, and the split is about cost.** `screenAgent` decides
  everything knowable before a model is asked, so a halted member never consumes an LLM call.
  `policyGate` re-runs it anyway, so a caller cannot skip it.
- **ADR-045 — REJECT is terminal, DEFER writes nothing.** `UNIQUE(market_id, member_id, round)`
  means a row forecloses that pair. Kill switches, unfunded wallets and spent budgets recover on
  their own, so they write no row.
- **ADR-046 — the on-chain caps are twice the off-chain ones, and derived rather than stored.**
  Equal caps would put every legitimate bet on the boundary the contract reverts one wei above. The
  narrower honest claim: a compromise could stake up to *twice* the intended amount before the chain
  refused it, and the bound is a number no server can change.
- **ADR-047 — the signing wallet is a property of the intent row, and "no key here" is not an
  error.** Production holds only agent keys. A tick that cannot sign defers without burning an
  attempt.
- **ADR-048 — an agent key ciphertext is bound to its agent address** via AES-GCM additional
  authenticated data, so a row swapped between members fails to decrypt instead of signing under the
  wrong caps.
- **ADR-049 — the agent is told it is *forecasting*.** Telling it to retrieve produced four
  abstentions out of four, because a market must ask about something not yet known. Measured, not
  reasoned.
- **ADR-050 — the over-cap bet is one wei over, and it is a script rather than a test.** One wei
  proves the boundary is exactly where the contract says. The artifact is a reverted transaction a
  judge can open.

---

## Known gaps

**1. ~~Gemini unusable.~~** ✅ **Closed.** Free tier, no billing. See above and RUNBOOK §1.

**2. Resolution is trusted, by design.** A small set of authorised resolvers submits outcomes with
an evidence URL, **signed from a human's browser wallet** — no key the deployed application holds can
resolve a market. The challenge window, permissionless `finalizeResolution` and permissionless
`invalidateStale` bound what one bad or absent resolver can do — but this is **not** a
decentralised oracle. This belongs in the README verbatim.

**2b. The market creator and the resolver are the same wallet.** They should be different people.
`humanResolverAddress()` reads `HUMAN_RESOLVER_ADDRESS` and falls back to the market authority, so
splitting them is a configuration change plus two `grant:testnet` calls — we have not made it.
`/resolve` says so on the page, `docs/TRUST_MODEL.md` says so, and `verify:resolution` asserts which
roles that wallet actually holds.

**3. The 120s challenge window is demo-scale.** Immutable, so it is honest and unchangeable
rather than quietly tunable. Say so in the README — **and say what it caused**: because two minutes is
too short for a human to notice and veto a wrong outcome, the human gate had to move *before* the
proposal, which is why `proposeResolution` is browser-signed (ADR-052). A longer window would permit the
optimistic shape (AI proposes publicly, human vetoes inside the window), which is a real design we could
not use.

**4. ~~`lib/contract.ts` hand-writes ABI fragments.~~** ✅ Closed in Phase 2.

**5. The DB test suite does not run in CI.** `schema.test.ts` creates and drops a real database on
Neon and this repo is public, so the credential is deliberately not a CI secret. CI runs the pure
tests; the DB suite skips with a loud warning. Run locally before any schema change — this session:
**10/10 against a fresh database**, including the new `UNIQUE(market_id, round)` on
`resolution_drafts` and both Phase 6 migrations applying cleanly.

**It is flaky on a cold Neon branch**, and the flake is in teardown, not in the assertions: dropping
the scratch database can exceed the default 120s hook timeout, which fails the *file* while every
test in it has already passed. If `pnpm -r test` reports one failed file with 0 failed tests, that is
this. Re-run it alone with `--testTimeout=180000 --hookTimeout=240000`.

**6. Re-org handling is a confirmation depth (3 blocks) and nothing more.** Honest on a
3-second-block testnet; not mainnet-grade. `docs/ARCHITECTURE.md` §11 says so.

**7. ~~Tick duration.~~** ✅ **Measured in production and comfortable.** A full tick takes **48s
locally** but **14.9s on Vercel** (`POST /api/tick`, HTTP 200, zero stage errors). The difference
is exactly what the batching work predicted: local time is dominated by laptop→Neon round trips
(~0.5s each) and on Vercel the function and the database are in the same region. `maxDuration` is
60, so there is roughly 4× headroom. Re-check if a stage is added.

**8. The intent engine signs with the deployer key only.** Correct through Phase 3. Phase 4 moves
market creation to a BridgeKey signature; Phase 5 adds per-member agent wallets.

**9. GDELT fails most ticks.** It is slow (12.6s measured for a *minimal* query, against a 12s
default timeout — now given 25s) and rate-limits hard to 429 on repeat calls. Left in the feed
list deliberately: the other seven feeds supply 100+ publishers, and a visibly degraded feed that
does not take the tick down is a live demonstration of hard rule #6. If it looks bad on demo day,
drop it from `FEEDS` — nothing depends on it.

**10. Confirmation leans on the LLM more than the deterministic path does.** Because independent
reports of one story score ~0.44 (below the 0.50 merge threshold), most genuine two-source merges
come from the borderline adjudication. With no LLM the pipeline still ingests, deduplicates and
displays honestly, but confirms rarely. This is a consequence of ADR-030's fail-safe direction,
not an accident — but it means **the demo wants the LLM working**, and the 4-call budget only
covers ~32 of the ~25 borderline pairs a busy tick produces.

**11. Borderline adjudications are not cached.** Each tick re-plans from scratch and re-asks about
pairs it already resolved, so budget is spent re-deriving known answers. Cross-publisher pairs are
prioritised (a same-publisher merge cannot create a second independent source), which limits the
damage. A `pair_adjudications` table would fix it properly; deferred as it needs a migration.

**12. No favicon.** `/favicon.ico` 404s in the browser console. Cosmetic, one file, not done.

**13. ~~No human-approved `createMarket` tx.~~** ✅ **Closed 2026-09-29.** Four proposals were read
and approved in `/review` with BridgeKey, producing four real transactions from
`0xA9F68fDf…311fF1` at blocks 5,793,477 / 480 / 482 / 485 — all `result: success` on MSTScan, all
decoded as `createMarket`, nonces 0–3 from a wallet whose key this repository has never seen.

**14. `/review` ships wagmi to the browser; `/` and `/markets` do not.** The providers are mounted
inside the review page's own tree rather than in the root layout, so the two pages a judge lands on
first stay server-only. Worth keeping if a wallet is ever needed elsewhere.

**15. Proposal quality is bounded by a small model on a free tier.** `gemini-3.1-flash-lite` drafts
specs that are structurally sound and sometimes loose — one queued market's criteria says "check Zoo
Atlanta's official website" while its resolution source is the Guardian. That inconsistency is
exactly what the human checklist is for, and it is left visible rather than patched, because the
reviewer catching it is the demo. The deterministic rules catch what is *checkable*; judgement is
the human's job.

**16. Four decision rows record the abstention defect rather than being deleted.** The first live
agent pass produced four `ABSTAINED` rejections caused by the prompt bug ADR-049 fixed, and they are
still in `agent_decisions` and still rendered on `/agents`. They are kept because they are true —
that is what the agents said, and `audit_log` records it either way — but a judge scrolling the list
will see abstentions the current code would not produce. Worth a sentence if it comes up. The rows
from later passes are the representative ones.

**17. `vega`'s 0.90 confidence floor means it almost never bets.** That is deliberate — it is the
member that demonstrates `CONFIDENCE_BELOW_THRESHOLD` and `CATEGORY_NOT_ALLOWED` — but it also means
only one of three agents produces transactions. If a demo wants more on-chain betting activity, lower
`vega`'s floor in `MEMBER_SEEDS` and re-run `agents:register` (the policy is re-asserted; the caps
only change on chain if you re-register).

**18. A market's per-market cap has never actually bitten.** One decision per market per round means
an agent bets once and stops well under its cumulative cap, so `PER_MARKET_CAP_SPENT` and
`CLAMPED_BY_ONCHAIN_PER_MARKET_CAP` are covered by unit tests but not by live data. Betting a second
round on the same market (`round: 2`) would exercise it for real.

**19. Agent wallets are funded from the deployer by a plain value transfer.** `agents:register` is
the only place in the repo that broadcasts outside the intent engine — the engine encodes
`AuspexMarket` calldata and a value transfer has none. It is idempotent in effect (it computes
`target − balance` after reading the balance) but not crash-proof: a kill between broadcast and
receipt, re-run, could overfund an agent by one top-up. The consequence is one of our own wallets
holding slightly more testnet coin than intended. Stated rather than hidden.

**20. Tick duration, and the deadline ladder that now bounds it.**
`POST /api/tick` returned **HTTP 200 in 19,693ms with zero stage errors** after this phase, against
15,058ms at the end of Phase 5 — so the two new stages cost about 4.6s on a pass that made no
resolution or agent model calls (4 of 10 budgeted calls spent, all on clustering and the proposer).
Comfortably inside the 60s budget, and the resolution stage correctly reported `no human-approved
market is past its close time`.

That measurement is honest and it is **not** a worst case: no tick has yet made a resolution model
call *and* a full agents pass. See the handoff for how to force one.

The ceiling is arithmetic rather than measurement. A tick's LLM allowance is now **ten** calls (4
clustering + 2 proposer + 1 resolution + 3 agents) and `GEMINI_TIMEOUT_MS` is 22,000, against
`maxDuration = 60`. Those do not multiply out safely, and the failure mode is the worst available: an
over-running tick is killed before it returns a report **or writes its audit row**, so the one tick
that went wrong is the one that leaves no trace.

**Mitigated by a ladder that scales from one number.** `runTick` takes `maxDurationMs` and derives
every stage deadline from it as a fraction — resolution 40%, agents 63%, settlement 80% — each
**absolute from the start of the tick**, so a stage that arrives late does less rather than pushing the
tick over. Each yields and says so in its report. The route passes `maxDuration * 1000` so the two
cannot drift; `scripts/tick.ts` passes 300s because it has no serverless limit and a local tick is
round-trip-bound (~100s, versus ~15s in production — ADR-033).

That last part was a real defect found this session: with fixed 60s-shaped constants, `pnpm --filter
web tick` silently skipped its last three stages, so the tick did **less** on the machine where you
are watching it than in the place you cannot see.

**Still unbounded:** clustering and the proposer have no deadline, only a call budget. Clustering's
four calls are the largest single allowance in the tick. Worth doing if a tick is ever seen to be
killed; not done, and not claimed.

**21. The resolution agent has never run against a market that is genuinely past close.**
`runResolutionPass` requires `close_time <= now()`, and markets #4–#7 close on **2026-09-30 22:12
UTC**. Market #8 is finalised and has no proposal row, so it is out of scope by design. Every part of
the agent has been proved on real data through `resolution:dry-run` — retrieval, the model, the quote
check, `UNSETTLED`, and the validator's close-time refusal — but the *stage* has only ever reported
"no human-approved market is past its close time". The first real drafting pass will happen on the
30th, and that is the moment to watch for the fourth instance of the ADR-029/049/060 pattern.

**22. The coverage floor is calibrated on subject matches, not settlement matches.**
`MIN_QUESTION_COVERAGE = 0.12` was read off 29 live articles scored against four live questions
(ADR-060). Every true match in that sample was an article about the *same story*; **none reported the
*outcome* of any market**, because none of those outcomes has happened. The case the resolver actually
depends on is not in the sample. The floor is set generously for that reason, and
`resolution:dry-run` re-derives the distribution on demand.

**23. One market's drafted outcome would probably be refused by a human, and that is the system
working.** On market #7 the agent proposed `NO` because Trump denied that a sanctions-relief offer
exists — reasoning from a failed premise rather than from the question ("will Iran accept?"). The quote
was real and verified. A resolver reading it should refuse it, which is exactly what the human gate is
for. Worth a sentence if it comes up: the validator checks whether an outcome is *verifiable*, never
whether it is *wise*.

**24. `resolution_drafts` rows are never deleted, including `STALE` ones.** A draft retired because
its market was challenged into a new round stays in the table and renders on `/resolve` under
"already decided". That is deliberate — it is true, and it is what the round mechanism looks like from
the outside — but a judge scrolling the list will see drafts that were never signed and never refused.

**25. The lifecycle script's agent bet bypassed the policy gate, on purpose.** Market #8's `NO` side
was placed by an operator from `atlas`'s wallet with no model asked and no gate consulted, because
demonstrating that `claim()` pays the registered *owner* needs an agent with a winning stake, and no
such market existed. The audit log says exactly that, no `agent_decisions` row was written, and the
stake was inside the agent's on-chain caps — which the chain enforced regardless of what the script
believed. ADR-059.

## What the next session needs to know

**Start Phase 7: dashboard polish + trust surface.** Read `docs/BUILD_PLAN.md` Phase 7. It is the
`/trust` page with live counters, the `<Provenance>` component plus the CI check that fails a
production build containing `MOCK`, "judge mode" (a pre-funded guest agent a judge can trigger to
produce a real on-chain transaction without owning a wallet), and a responsive/empty/error-state pass.

**Phase 6 is the last phase that had to put new transaction *kinds* on chain.** Every contract
function is now exercised by a real, resolvable transaction. Phase 7 and 8 are about making that
legible.

**There is nothing outstanding from Phase 6, and nothing waiting on the user.**

### The clock, and the one thing only time can unblock

Markets **#4–#7 close at 2026-09-30 22:12 UTC**, `resolveDeadline` 24 h later. Until then the
resolution *stage* has nothing in scope (known gap #21). Two things should happen on the 30th:

1. **The first real drafting pass.** Watch `resolution:dry-run` and then `/resolve` for the pattern
   that has now bitten three times — a threshold or a prompt that is individually sensible and wrong
   in composition. Markets #4 and #5 carry real agent stakes (0.005 and 0.004 tMSTC on YES), so they
   are the ones worth resolving on camera.
2. **A production tick with a full agents pass *and* a resolution draft.** The 19.69s measured after
   this phase spent 4 of 10 budgeted calls, none of them on resolution or agents — so the worst case
   is still unmeasured. Force three agent calls plus one resolution call and read `durationMs`
   against the ten-call allowance. The dials, in order of bluntness:
   `LLM_AGENT_CALLS_PER_TICK`, `LLM_RESOLUTION_CALLS_PER_TICK`, the fractions in
   `STAGE_DEADLINE_FRACTION`, then `MAX_PAIRS_PER_PASS` / `MAX_DECISIONS_PER_PASS`.

Markets **#2 and #3 are CLOSED and past `resolveDeadline`** with no proposal row, so the pipeline will
never touch them. #2 holds 0.01 tMSTC of `poolYes`; `invalidateStale(#2)` from any wallet would refund
it, and `verify:resolution` confirms that call would succeed. That is a spare live demonstration of
permissionless invalidation if one is wanted.

### The role change is the thing to re-read before speaking to a judge

`0xA9F68fDf84388fa548a685085E2bee0e5b311fF1` now holds `MARKET_CREATOR_ROLE`, `RESOLVER_ROLE` **and**
`CHALLENGER_ROLE`. The old line "holds `MARKET_CREATOR_ROLE` and nothing else" is **false** and must
not be said. The replacement, which is what `verify:resolution` and `preflight` both assert:

> It holds every role that requires human judgement and **none** that confers power — no
> `DEFAULT_ADMIN_ROLE`, so it cannot register an agent, change a cap, or pause the contract. And no
> key the deployed application holds can create, resolve, challenge, register, re-cap or pause
> anything.

ADR-052 has the argument for why the change was necessary and what it cost.

### Everything Phases 3–6 built is available and tested. Do not rebuild any of it.

| You need | Use | Notes |
|:--|:--|:--|
| A market past close that a human approved | `resolvableMarkets()` in `lib/resolution/run.ts` | `state IN (OPEN, CLOSED)` + `close_time <= now()` |
| The chain's own view of a market | `readMarket()` from `@/lib/chain/auspex` | never the projection, when the answer decides money |
| What the contract will pay an address | `readPreviewPayout()` | **the** number to show; never compute a payout yourself |
| Ranking articles against a question | `rankByCoverage()` from `lib/resolution/retrieve` | asymmetric coverage, **not** `weightedJaccard` — ADR-060 |
| A pure validator to copy the shape of | `lib/resolution/validate.ts` | three verdicts, `now` injected, collects every failing rule |
| The resolver's queue for a page | `pendingResolutions()` / `decidedResolutions()` / `resolutionCounters()` | each row carries live chain state and `blockedBecause` |
| Whether a draft can be signed right now | `isProposable()` + `roundFor()` | mirrors `proposeResolution` exactly |
| Running the permissionless calls | `runSettlePass()` from `lib/resolution/settle` | picks a funded agent wallet as keeper; queues, never signs |
| Intents for one market, for a timeline | `lifecycleIntentsFor(onchainId, proposalId)` | pass the proposal id or `createMarket` is missing |
| The audit log for a page | `auditPage()` / `auditActionCounts()` from `@/lib/audit` | groups are in `AUDIT_GROUPS`; default view is unfiltered |
| A human-signed contract call | `createIntent({ signer: "EXTERNAL", from })` then `attachExternalBroadcast` | the hash is verified against the node, calldata included |
| Adding an LLM stage to the tick | give it its **own** `LlmBudget` and a `deadlineMs` from `deadline(...)` | four budgets exist; a fifth needs a fraction in the ladder |

**`lib/resolution/` is the worked example of the pattern, one step further than `lib/proposer/`.**
Read `retrieve.ts` → `draft.ts` → `validate.ts` → `propose.ts` in that order. The new idea over Phase 4
is that **retrieval is part of the gate**: the model is not only constrained in what it may say, it is
constrained in what it may look at.

**Things that will cost you an hour if you rediscover them:**

- **A `bigint` in anything returned by `NextResponse.json` is a 500.** `JSON.stringify` throws on it.
  Every wei value in a report is a decimal string, same as the DB columns.
- **A deliberate skip must not go into `report.errors`.** The CLI and the cron heartbeat both exit
  non-zero on that array, so a tick that correctly declined optional work would read as broken.
- **`resolution_drafts` is unique on `(market_id, round)`, and `round` comes from the chain's
  `challengeCount + 1`.** Derive it from `readMarket`, never from a counter of our own, or a re-run
  keys a draft to the wrong round and the unique index silently hides it.
- **`UNSETTLED` must write no row.** It is the common answer for a market that closed an hour ago. A
  row would spend the round's only draft slot on "not yet". Same trap as ADR-045 and ADR-049.
- **The quote check compares against the text the model was *shown*, truncation included.** That is
  why `IssuedEvidence` stores it. Score and offer the same string, or true quotes get rejected for
  living in a part that was never sent.
- **Hardcoded role hashes must be verified against the contract's own getters.** The first
  `CHALLENGER_ROLE` literal in `preflight.mjs` was wrong, and the check still "passed" — for the
  wrong reason — until it was compared against `eth_call`.
- **`maxDuration` in the route and the tick's time budget must come from one number.** They are tied
  now (`TICK_BUDGET_MS = maxDuration * 1000`); untying them is how a stage starts work the platform
  then kills.

**Commands added this phase:**

```bash
pnpm --filter web lifecycle           # the full lifecycle on chain, ~5 min. Creates a labelled test market.
pnpm --filter web verify:resolution   # 20+ live eth_call checks of the resolution gates. Writes nothing.
pnpm --filter web resolution:dry-run  # the resolution agent on a real market, with candidate scores. Writes nothing.
MARKET=5 pnpm --filter web resolution:dry-run   # a specific market
```

**Carried forward from Phases 3–5 — still true, still worth an hour each:**

- **`agent_decisions` is unique on `(market_id, member_id, round)`, and a row is terminal.** Before
  writing one, ask whether its reason can ever change. Kill switch, unfunded wallet, spent budget →
  no row. `resolution_drafts` repeats this shape exactly.
- **`agentRemainingOnMarket` returns 0 for an agent the contract does not know** — identical to a
  genuinely exhausted cap. Any check on it must be guarded on `registered && active`.
- **Postgres reads a naive timestamp in the *session* time zone.** `date_trunc('day', now() at time
  zone 'utc')` compared against a `timestamptz` is only right because this database's session is GMT.
  Anchor it: `… at time zone 'utc'`.
- **The intent worker signs with a wallet chosen from `from_address`, not a global.** If you add an
  intent kind, decide whose key signs it, and remember production has no admin key.
- **A reverting `eth_estimateGas` is not an error to avoid.** The engine falls back to
  `FALLBACK_GAS_LIMIT` precisely so a transaction we *want* refused reaches the chain where a judge
  can read the revert. Phase 6 relies on this for four deliberate reverts.
- **Read the real output before trusting the pipeline.** Every defect worth finding in Phases 4, 5 and
  6 was invisible to the tests and obvious in one look at live output.
- **`eth_call` from the acting address is the cheapest possible proof.** Three `verify:*` scripts now
  do it, and none of them signs anything.
- **Server actions are public HTTP endpoints.** `app/review/actions.ts` and `app/resolve/actions.ts`
  both re-check authority on the server in every function; the page saying who is connected is a
  claim, not a fact. `settleNow()` is the deliberate exception — every call it makes is
  permissionless, so gating it would be theatre.
- **The tick has four LLM budgets, not one.** `report.llm.callsMade` sums them. A fifth stage needs a
  fifth budget and a fraction in `STAGE_DEADLINE_FRACTION`, or clustering will starve it.
- **Read the whole error body before believing a status code.** Two sessions recorded Gemini as
  needing a credit card on the strength of `402`. The body said *prepayment credits depleted* —
  project-scoped, fixed with a new key in a project with no billing account.
- **A tick is round-trip-bound, not CPU-bound.** 19,900 similarity comparisons take under 20ms; 400
  sequential Neon round trips take 400 seconds. Batch writes, never a query inside a per-row loop.
  ADR-033. This is also why a local tick takes ~100s and a production one ~15s.
- **Next 16 writes `web/AGENTS.md` and `web/CLAUDE.md` on every `next dev`.** Disabled with
  `agentRules: false` in `next.config.mjs` — do not remove it.
- **`turbopackIgnore` on `lib/env.ts`'s `fs` calls is load-bearing for deploy size.**
- **Thresholds in `similarity.ts` and `retrieve.ts` are empirical.** Re-run `calibrate` and
  `resolution:dry-run` respectively if the feed list changes.
- **`scanForInjection(title, body)` takes two arguments**, not a spread.
- **Google News entity-encodes its HTML**, so `cleanText` strips tags, decodes, then strips again.
- **Postgres cannot `ON CONFLICT` against a row in its own `VALUES` list.** De-duplicate a batch in
  memory first.

**Environment facts, still true:**

- `vercel env pull` cannot retrieve the Neon variables (marked sensitive; writes `[SENSITIVE]`).
  Use `neonctl` — RUNBOOK §3.
- Neon needs **both** connection strings: pooled for the app, direct for migrations.
- `tsx` runs `web/*.ts` as CJS; wrap script bodies in `async function main()`.
- Never reference a git-ignored file through `new URL(literal, import.meta.url)` in bundled code.
- Neon free tier scales to zero; first connection can take 10–25s. Slow is not broken.
- To check a change the way CI will, `git clone --local` into a scratch directory and run there —
  the clone has no `.env.local`, which is the condition that catches a whole class of bug.
- Index from block **5,786,343**. The deployed ABI is `contracts/deployments/mstTestnet.json`.
- Vercel auto-deploys `main` to https://auspex-web-mu.vercel.app — a broken build there is public.
