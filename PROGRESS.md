# PROGRESS.md — AuspeX build state

> **This file is the handoff between sessions.** A new session reads this first and continues from
> "Next phase". It is updated at the end of every phase, before the commit. If it is stale, the next
> session starts blind.
>
> Session protocol and hard rules live in `CLAUDE.md`. Phase tasks and exit criteria live in
> `docs/BUILD_PLAN.md`. Manual setup state lives in `docs/RUNBOOK.md`.

**Last updated:** 2026-09-30 (Phase 12)
**Current status:** ✅ **Phase 12 complete. Released as `v1.0.0`.** Nothing new was built. Fifteen
commands were run in one sweep and all fifteen pass, with their numbers recorded below rather than
their adjectives. The sweep's job was to catch **drift** — a sentence true when it was written that a
later phase falsified — and it caught five: `verify:agents` has claimed to write nothing since
Phase 5 while appending one `agents.halted` row per run; the README still described the resolution
starvation defect in the present tense one phase after it was fixed; the cron delivery rate was
computed by dividing the *gaps* between runs rather than the runs; the database has had 15 tables
since Phase 6, not 14; and **the fifth was caught by reading the deployed page** — market #11's
undrafted outcome was being blamed on the retrieval floor when its question cannot be answered before
its own resolve deadline. All five are corrected, and `check:render` ran for the first time in the
project's history — 8 routes, clean. No chain data, address or hash changed.
**Next phase:** none. Part II is finished and the build is released. What a future session should
read first is "After v1.0.0" at the end of this file.

---

### Phase 11's closing status, for the record

✅ **Phase 11 complete.** The three false or unearned claims were fixed. The resolution stage no
longer starves — it ran fourth in the ladder behind an *unbounded* clustering stage, and **two of the
three production ticks that had a resolvable market never read the chain for it**. Resolution now
runs before the news stages, clustering and the proposer have the deadline they never had, and every
model stage is clamped to `budget − callTimeoutMs − tail` so no call can start too late to finish.
The cadence claim is gone from prose entirely: `/audit` computes it from `audit_log` per request,
separating cron ticks from prompted ones, because the first version of that panel averaged both and
reported 84 minutes for a system whose unattended mean is 5h07m. `audit_log` now records
`durationMs`, `budgetMs` and the resolution report. No chain data, address or hash changed.

---

## Phase status

**Part I — build the system.** Complete and shipped.

| Phase | Name | Status |
|:--|:--|:--|
| 0 | Foundations & rails | ✅ Complete |
| 1 | Smart contract — build, test, deploy, verify | ✅ Complete |
| 2 | Data layer + chain client + idempotency engine | ✅ Complete |
| 3 | News ingestion, dedup, 2-source confirmation | ✅ Complete |
| 4 | Market proposer agent + human approval gate | ✅ Complete |
| 5 | Member agents + deterministic policy gate | ✅ Complete |
| 6 | Resolution, challenge window, payout | ✅ Complete |
| 7 | Dashboard polish + trust page | ✅ Complete |
| 8 | Live end-to-end run + README + submission | ✅ **Complete — submitted; see "How Phase 8 closed"** |

**Part II — make it a product.** Complete. Released as `v1.0.0`.

| Phase | Name | Status |
|:--|:--|:--|
| 9 | Reframe: from submission to product | ✅ Complete |
| 10 | The new look — light, modern, funky, professional | ✅ Complete |
| 11 | Operational truth — fix what makes a claim false | ✅ Complete |
| 12 | v1.0.0 — verify everything once, tag, release | ✅ Complete — **released `v1.0.0`** |

Legend: ⬜ not started · 🟡 in progress · ✅ complete · ⚠️ complete with known gaps

---

## How Phase 8 closed, and what Part II is

**Phase 8 is done.** The demo film was uploaded and the submission filed by the owner on 2026-09-30,
and the event has ended. Its last two exit criteria — *"a cold visitor understands the story"* and
*"the builder can explain it unprompted"* — were always judgements rather than checks, and the
submission settled both in the only way they could be settled. Nothing further is owed to Part I.

**Two of its criteria are now permanently unverifiable and that is fine.** They were not skipped;
they were answered by the event itself.

**Part II exists because the repository still reads like a contest entry.** It addresses a judge,
dates itself to an event, and organises its surfaces around being assessed. The plan for turning
that into a product is Phases 9–12 in `docs/BUILD_PLAN.md`, and its governing rule is in the Part II
preface: **the framing goes, every fact stays.** No address, hash, measurement or limitation is
touched. The build record — this file, `BUILD_PLAN.md`, `DECISIONS.md` — is kept rather than erased,
because the sequence of defects it records is the evidence behind every trust claim the product
makes. Erasing it to look more polished would be the same retouching this project has refused seven
times.

See **ADR-068** for the decision and what it costs.

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
| Neon database | project `jolly-queen-98097073`, branch `main`, db `neondb` | ✅ **15** tables migrated |
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
| **Agent wallet `kestrel`** | **`0x76bf4262aa13632e91e27e0eba3b42b6b353ce4e`** | ✅ registered, capped 0.016/tx, active |
| `registerAgent` → atlas | `0x74cb33a18ec7378a832868898e1fcbf1f41d057910f5cddea23f8bb16f124b7a` | ✅ `result: success` |
| `registerAgent` → kestrel | `0xcc2097f46e608b0dfa13caefb270a9a9709bd5b3f0d0520a40568c009bbd11ef` | ✅ `result: success` |
| `registerAgent` → vega | `0x92a7a00a7fcdee71ff5db15642342f17aa32b5cd778387ada463965db89dfd41` | ✅ `result: success` |
| **`placeBet` #1 (agent, within caps)** | **`0x5f8a12c6259de3493b79314e3e6f0284a3650e378b4b34f627cff37ea10dd5f1`** | ✅ block 5,794,730, 0.005 tMSTC YES on market 4 |
| **`placeBet` #2 (agent, within caps)** | **`0xc2a426997ae432372d645ac8b95bf947acaa20562c9c69672046ca3f204e0759`** | ✅ block 5,794,735, 0.004 tMSTC YES on market 5 |
| **Over-cap bet tx (expected revert)** | **`0xf0152234efe078729401162dd8ef16e6d19da2c657dcfe4360f2cd3255720c2d`** | ✅ block 5,794,765, **`AgentPerTxCapExceeded(2e16+1, 2e16)`** |
| **`/agents` — the gate, visible** | **https://auspex-web-mu.vercel.app/agents** | ✅ 9 decisions, 6 refusals, 1 chain refusal |
| `pnpm --filter web verify:agents` | 41 live checks: roles, registry, cap boundary, kill switch | ✅ all pass; signs nothing, appends one `agents.halted` audit row (ADR-078) |
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
| **Keeper `invalidateStale` #2** (first automated one) | **`0x2e146af6d110877b7eb4c4e1c5b5beb5b8731d892f75c4aafb35062d016250d5`** | ✅ block 5,803,291, from `0x15757d54…450daa` (vega, **no role**) |
| **Keeper `invalidateStale` #3** | **`0xdb47cc4d84f7e20e9e696125aeed820c7cc8f1702b71b11e3fc539f8623aac29`** | ✅ block 5,803,295, same wallet |
| **Refund `claim` on #2 — 0.01 tMSTC returned** | **`0x89c04f85d6fd7274039b94acb7db0f6c644f990120bab3cef74d41bc0d56e899`** | ✅ block 5,803,327, from `0xc71dC478…4ad24` — **an operator action, not the keeper** |
| **Judge-mode probe — from the CLI** | `0x72fde34abea889831dd21aab56f05b94b066e6e22e5a37f6ad4e9e2a695be112` | ✅ block 5,798,322 — **Reverted**, `AgentPerTxCapExceeded(20000000000000001, 20000000000000000)` |
| **Judge-mode probe — clicked in a browser with no wallet** | `0xcfc34dff963bd7f1ea81df4ec7373794a34dd56dda99d18955ce6bfccbaa08c3` | ✅ block 5,798,488 — **Reverted**, same decoded error |
| **Judge-mode probe — clicked on the LIVE Vercel URL** | **`0xbfe9bb2c3ffee4be2f660473b3de916380f5d10da8548173d44810118ced060a`** | ✅ block 5,798,796 — **Reverted**, same decoded error. This is the one a judge reproduces. |
| **Demo film** | `video/out/AuspeX-demo-4min.mp4` — 4:00.0, 1920×1080, H.264 + AAC, −16 LUFS target / −16.1 measured | ✅ rendered 2026-09-29, not yet uploaded |
| Film captions | `video/out/AuspeX-demo.srt` — 41 cues, timed from the measured voiceover | ✅ |
| Film build | `video/` — Remotion 4, Amazon Polly (`Matthew`, generative), score synthesised from `timings.json` | ✅ source committed, artifacts gitignored |
| **`video/scripts/verify-onscreen.mjs`** | re-checks all 5 on-screen hashes/addresses incl. **sender**; blocks the render on a mismatch | ✅ 5/5 pass |

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

### The demo film — Phase 8

`video/` builds a 4-minute film from the same evidence the README asks a judge to check. It is not a
replacement for `docs/DEMO_SCRIPT.md`: that is a ~5-minute live walkthrough for a person presenting at
a table, and its nine beats actually sum to 6m20s. This is the unattended cut a panel watches.

Three things about how it is built are worth defending:

**Timing is measured, never estimated.** Each narration line is synthesised as its own Polly clip and
measured with `ffprobe`. Those durations drive scene lengths, caption timings, the SRT, the score's
intensity curve and its ducking envelope. Editing a line re-times the film automatically. The voice is
`Matthew` (generative) — chosen partly because he reads ~16% faster than `Gregory`, which is what let a
765-word script land at exactly 4:00.

**The film verifies its own claims before it renders.** `verify-onscreen.mjs` re-fetches every
transaction it shows and asserts status, sender and revert reason against what the script says, exiting
non-zero on a mismatch. This is the same discipline as `scripts/check-links.mjs`, and it exists for the
same reason: the defect recorded above was not a broken link, it was a flattering caption beside a real
hash. Beat 5 claims a human signed `createMarket`, so the check asserts `from == 0xA9F6…311fF1`.

**The explorer's ad slot is stripped at capture.** MSTScan sells a sponsored row, and what it served
during capture was a gambling ad — in a prediction-market demo, on the frame that is the whole thesis.
Off-origin subresources are blocked and the row removed before the screenshot.

Compression of the original nine beats to nine tighter ones cost beat 7 (resolution and payout), which
is folded into beat 6 as the payout-goes-to-the-owner point. That is the honest cut: markets #4/#5
cannot be resolved through `/resolve` until 2026-09-30 22:12 UTC, and market 8 was operator-driven and
needs caveating that a 4-minute film cannot afford. The film never claims a human resolved anything.

**Still to do:** upload it and paste the link into the submission form. Publishing is not something an
agent should do on the builder's behalf.

### New on chain since the Phase 7 commit — found, not created, by this session

These three happened on the live site between the Phase 7 commit and Phase 8, and were **not** in this
file. They were discovered by reading the chain rather than the notes, which is the argument for
`verify:resolution` printing every market's state.

| Artifact | Value | Status |
|:--|:--|:--|
| **`createMarket` #9 — human-approved, the fifth** | **`0xd25ab5045f9893559b242ed97d2ff1870f10b6a8e1f4d97ddc35f39d258f4f8e`** | ✅ block 5,800,305, from `0xA9F68fDf…311fF1` |
| **Judge-mode probe #4** (reverted, deliberate) | `0x81662eee76cf380b911debbd49dcaa302eeae44ce16f1ccff5b46a0390da83cf` | ✅ block 5,800,631, `AgentPerTxCapExceeded` |
| **Agent `placeBet` #3 — the first NO-side bet** | **`0x8a5b07402db7d20c27598b74d83de8926a4e407767dacf4e35d2544e81aad9b2`** | ✅ block 5,801,298, 0.004 tMSTC NO on #9 |
| **A human REFUSED a proposal** — closes half of gap #26 | proposal `b84d3079…4e92ab`, signed by `0xa9f68fdf…311ff1` at 04:30 UTC | ⚠️ real, but its recorded reason is the literal string `test` |
| `POST /api/tick` in production, Phase 8 | 200 in **24,277ms**, 0 errors, **7 of 10 LLM calls**, two Gemini 503s absorbed | ✅ measured 2026-09-29 |
| Heaviest tick observed (the cron's, 05:19 UTC) | **9 of 10 LLM calls** — full clustering, full proposer, full agents pass | ✅ from `audit_log` |
| `pnpm check:links` — the new honesty guard | 25 hashes · 27 abbreviations · **19 sender attributions** · 13 live URLs | ✅ all pass |

### The stuck market, found and unstuck — ADR-066 / ADR-067

**Market #2 was `CLOSED` with a bettor's 0.01 tMSTC locked in the contract for thirteen hours**, and
three separate things had to be true at once for nobody to notice:

1. **The keeper never called `invalidateStale`.** ADR-057 decided that deliberately, to stop a late
   resolver costing every bettor their market. It worked — and it had no upper bound, so "until
   somebody acts" meant "forever". ADR-066 revises it: the keeper now invalidates after
   `STALE_GRACE_SECONDS` (one hour) past the contract's own `resolveDeadline`.
2. **`/resolve` could not show the market at all.** Every row on that page came from
   `resolution_drafts`, and a market with no draft has no such row. Worse, the "Awaiting a draft"
   counter INNER JOINed `proposals`, which dropped markets #1–#3 entirely — so the page read `0`
   and said "Nothing is waiting to be resolved" while `/markets` showed two closed, unresolved
   markets. Two pages over one chain, disagreeing.
3. **`/markets/2` did not list the bet.** The lifecycle table read only `onchain_intents`, and the
   bet was sent by `contracts/scripts/smoke.ts` in Phase 1, before the intent engine existed. The
   table was not wrong about any row it printed; it was silently incomplete under a heading that
   promised completeness (ADR-067).

**What the contract would not let us do, and why that is right.** The instinctive fix — "have the
keeper claim for every bettor who is owed" — is impossible. `claim(marketId)` pays `msg.sender` and
nobody else; there is no `claimFor(address)`, because pull-based payout is what stops one reverting
receiver breaking the loop for everyone. The keeper can only ever settle positions whose key it
holds, which is the registered agent wallets. Market #2's bettor was the **deployer**, so its refund
was an operator action from a laptop and is recorded and rendered as one. The alternative was
changing the contract to weaken a protection so a sentence could be true.

**And the self-correction fired.** With the recovered `placeBet` visible, `lifecycleClaim` now
**withholds** the strong trust claim on `/markets/2` and names the operator rows instead — exactly
what ADR-065 built it to do, on evidence the page previously could not see.

**Market #9** is `Will the European Central Bank announce a further interest rate increase in its next
scheduled monetary policy meeting?`, closing 2026-09-30 23:43:17 UTC. It is the only market whose
`poolNo` is non-zero, because the agents stage bet NO on it.

**The refusal is real and it is weak.** The signature verified, the row is in `proposals`, and
`/trust` now counts `BY A HUMAN: 1`. But the reason the reviewer typed was `test`, and that string is
inside the message that was signed — so it **cannot be edited** without invalidating the signature,
and editing it would be exactly the kind of retouching this project refuses to do. The fix is one more
refusal with a real reason; the queue already holds the right candidate. See the handoff.

**Also on chain, no longer in the repo:** `Ping` at `0x540d73793f5AA5E605A0243EA3DfCF106D6558D8`
(verified). It was the Phase 0 toolchain probe used to prove the deploy→verify pipeline works before
`AuspexMarket` existed. Deleted from the repo per `docs/BUILD_PLAN.md`; it is claimed nowhere.

---

## State of the running system — measured 2026-09-30, after the submission

**Read this before Phase 9 and do not trust it after that.** Everything below was read off the live
site, the chain and GitHub Actions on 2026-09-30 at ~12:30 UTC, because the Phase 8 handoff warned
that the cron keeps running between sessions and this file goes stale. It did, again. It said nine
markets; there were thirteen.

### What the live system holds now

| | Phase 8 recorded | Live 2026-09-30 |
|:--|:--|:--|
| Markets on chain | 9 | **13** |
| Human-approved markets | 5 | **9** (#4, 5, 6, 7, 9, 10, 11, 12, 13) |
| `/review` queue | — | 10 awaiting · 9 approved · **1 rejected** · 0 schema-rejected |
| Policy-gate refusals | 7 | **16** |
| Chain refusals | 6 | **10** |
| Human refusals | 1 | **1** — still the one whose reason is the string `test` |
| Confirmed transactions | — | **24** (11 `createMarket`, 8 `placeBet`, 2 `proposeResolution`, 3 `claim`) |
| Deployed routes | 8 | all **8 return 200** |

### The refusal candidate was approved instead

Gap #26's named fix — proposal *"Will the stock price of Summit Therapeutics close above $25.00 …"* —
was **approved rather than refused**. It is now market **#11**, `CLOSED`, holding 0.004 tMSTC of an
agent's stake, with a resolve deadline of 2026-10-01 02:18 UTC. By the three reasons the handoff
itself gave, it cannot be settled inside that deadline, so it will go stale and the keeper will
refund it. Nothing dishonest happened; the cheapest remaining demonstration was simply spent on the
other button.

**The runner-up is still in the queue with the same clean defect** — the RBA market asks about
"before the end of the current calendar year" while its own resolve deadline is 2026-10-02. If a
substantive human refusal is ever wanted, that is still the one. It is **no longer on any critical
path**, and Part II should treat it as optional.

### ✅ Two defects that made claims false — Phase 11's input, both now fixed

*Kept as written, because the record of what was wrong is the evidence behind the fix. Gaps #33 and
#34 below carry the closing detail, and ADR-075 / ADR-076 carry the arguments. One correction the
session found by reading the log rather than this file: the resolution starvation was **two of
three** ticks, not both of two — a third tick had run and succeeded in between, which made the
defect intermittent and therefore worse.*

**1. The pipeline does not run every five minutes.** `heartbeat.yml` and `sync.yml` both specify
`*/5 * * * *`. GitHub fired the heartbeat at **07:18, 01:29, and 22:32 / 18:28 / 12:55 the previous
day** — roughly **every five hours**. Every run succeeded; this is GitHub throttling scheduled
workflows on a low-activity repository, not a broken workflow. Any sentence anywhere claiming a
five-minute cadence is currently false.

**2. The resolution stage is starved by its own deadline ladder.** `web/lib/pipeline/tick.ts:111`
gives resolution 40% of `maxDuration` — 24s of 60 — measured absolutely from the start of the tick.
Clustering runs first and has **no** deadline, only a call budget (gap #20 said so and it now
matters). On the 07:18 tick, clustering handled 200 items into 93 events and adjudicated 15/15
borderline pairs, and the resolution stage then logged:

> `resolution halted: out of time for this tick after examining 0 market(s)`

It did not merely fail to draft — **it never read the chain for market #11 at all.** Both ticks that
had a resolvable candidate halted this way. So the resolution agent has still never examined a real
past-close market, and the reason is no longer "nothing has closed yet"; it is the ladder. That is a
different and worse gap than the one #21 describes, and it is the correction to #21.

### Smaller, and true

- **Indexer drift is user-visible.** `/markets` renders *"indexed as OPEN, chain says CLOSED"* on
  market #11 and names the chain as correct. The page is behaving well; the projection is behind.
- **`audit_log` has 412 entries** and still records no `durationMs` (gap #30).
- **Two ADRs are both numbered 066**, and ADR-057 says *"superseded by ADR-066"* — now ambiguous.
- **There is no `LICENSE` file**, though `README.md` says MIT.
- Repo clean, in sync with `origin/main`, CI green on the last commit.

---

## Phase 12 — what shipped

### The shape of it

**Nothing was built.** Fifteen commands were run in one session, their real output recorded, the
version moved `0.1.0` → `1.0.0` across all four workspace packages, `CHANGELOG.md` written from the
36-commit history, and `v1.0.0` tagged and pushed.

**The phase existed to catch drift, and drift is what it caught.** Every earlier phase verified its
own exit criteria against the system as it stood that day, and each was right to. What no single
phase can catch is a sentence that was *true when written* and that a later phase falsified — because
the sentence is accurate in its own commit and the check that would catch it lives in a different
file. A sweep catches it, because it reads the whole repository against one day's live system. Five
were found — and the fifth was in prose this phase had itself written an hour earlier:

| Drift | Was | Is |
|:--|:--|:--|
| `verify:agents` closing line | "Nothing was signed and nothing was written." **Since Phase 5.** | Signs nothing; appends exactly one `agents.halted` row and says so |
| README Limitations, resolution | "the stage … is starved by the tick's own deadline ladder" — **fixed in Phase 11** | The stage examines the market; the coverage floor is what stops it drafting |
| Cron delivery rate | `1.6%` of 554 (heartbeat), `1.7%` of 351 (sync) | **1.8%** and **2.0%** — the old figures divided the *gaps*, not the runs |
| Database table count | 14 tables | **15** — `resolutionDrafts` arrived in Phase 6 |
| Why market #11 has no outcome | the retrieval coverage floor | **its question cannot be answered before its own resolve deadline** — and the floor, second |

### The checker that lied about itself, and why the write stayed

**Found by reading the deployed `/audit` page, not the source.** The action histogram showed
`agents.halted 2`, and the newest row was timestamped `2026-09-30 19:52:41` — inside the minute the
`verify:agents` run had just finished. The script ends with the words *"Nothing was signed and
nothing was written."*

It has been wrong since Phase 5. Check 5 forces `AGENTS_KILL_SWITCH` on and runs the **real** betting
pass, and `runAgentPass` — correctly — inserts one `audit_log` row carrying the halt's reason before
it returns. What the check actually asserts is narrower and was always true: no `agent_decisions`
row, no model call, no transaction. The summary line then generalised past its own evidence.

**The write stayed and the sentence was narrowed.** Suppressing the insert behind a flag would have
made the sentence true and the check worthless: the row *is* the behaviour under test — hard rule #7
says a decision is logged with its reason, a halt is a decision, and a verification script that made
the system log less than production does would be verifying a different system. ADR-078 has the full
argument, including why this is the same move as retouching a hash, applied to a log instead of a
number.

Corrected in four places: the script's closing output, the script's header docstring, `README.md`
and `CLAUDE.md`. `verify:resolution` was checked the same way — it has no `insert` at all and its
claim stands.

### The measurement that was correct and divided twice

Phase 11 measured the heartbeat honestly: ten scheduled runs between 2026-09-28T20:42:55Z and
2026-09-30T18:50:44Z, mean gap 5h07m, range 2h57m–6h44m, zero failures. Every one of those values
re-derives exactly from `gh run list`. It then reported the delivery rate as **1.6% of the 554 runs
the `*/5` expression asked for** — and 1.6% is 9/554. Nine is the number of *gaps between* ten runs.

The gap count is the correct divisor for a mean gap and the wrong one for a delivery rate:

```
span 46h07m49s  ·  10 runs  ·  9 gaps  ·  */5 asks for 554
mean gap = 46h07m49s / 9  = 5h07m32s     <- 9 is right here
delivered = 10 / 554      = 1.8%          <- and wrong here (9/554 = 1.6%)
```

`sync.yml` had the same shape: 7 runs, 6 gaps, 351 requested — **2.0%**, reported as 1.7%. Corrected
in `README.md`, `heartbeat.yml`, `sync.yml` and gap #33 below. Recorded rather than quietly repaired
because it was not a bad measurement — it was one correct measurement whose second use borrowed the
first's divisor.

### The new cron expressions are still unmeasured, and this session could not change that

Phase 11's handoff hoped "by the time you read this there should be several hours of data." There is
none. The Phase 11 commit landed at **2026-09-30T19:34Z** and this session began at **19:53Z** —
nineteen minutes later. `gh run list --workflow=heartbeat.yml` shows the last scheduled run at
18:50:44Z, under the *old* `*/5`; the first `7,37` slot had not come round yet.

`/audit` says so on the page, from data, without being told to:

> **Unattended** — · no cron tick(s) recorded so far, of 2 with a known trigger — needs two to
> measure a gap

**That is the panel working, and the figure is withheld rather than missing.** Nothing in the
repository claims anything about `7,37 * * * *`, so nothing needed changing. A future session that
wants the number runs `gh run list --workflow=heartbeat.yml --limit 100` and compares it against that
panel — and should divide **runs** by requests when it does.

### `check:render` ran for the first time

It has existed since Phase 10 and had never executed: it needs Playwright, which is deliberately not
a dependency of this project, so it skips with an explanation rather than failing. Playwright and
Chromium are present in `video/node_modules` for the demo film, which is enough:

```bash
PLAYWRIGHT=video/node_modules/playwright/index.mjs BASE=http://localhost:3210 \
  node web/scripts/check-render.mjs
```

All four properties pass on all eight routes — no horizontal scroll at 390px **or** 1280px, a visible
focus ring on every element that takes focus, and zero animating elements under
`prefers-reduced-motion`. Phase 10 had verified the same properties by hand; this is the first
machine confirmation, and it agreed.

**One line in its output needed chasing rather than accepting.** Every route reported `N/N
focusable` except `/trust`, at `31/35`. The script only fails an element that takes focus *without* a
ring, so four elements that never focus would have been skipped silently. They are the `sm:hidden`
mobile copy of the role matrix, `display:none` at the 1280px viewport the focus pass runs at — and
each of those four addresses is reachable in the visible desktop copy, checked by comparing against
`offsetParent !== null`. A responsive duplicate, not a keyboard trap. Written down because "the check
passed" should not be read as more than it is, the same reason gap #28 exists.

### Live results

```
pnpm install (clean clone, no .env.local)   4.2s
pnpm compile (hardhat clean first)          2 files, solc 0.8.28, evm cancun, 0.8s
pnpm test                                   498 passed (441 web / 31 files, 57 contracts), 46.9s
pnpm test (clean clone)                     431 passed, 10 skipped (the DB suite), 7.6s
pnpm lint                                   clean, 3.1s
pnpm typecheck                              clean, 2.1s
pnpm build                                  8 pages + 4 API routes, Next 16.3.6, 4.4s
pnpm build (clean clone)                    same, 9.1s
pnpm preflight                              11/11, block 5,847,543
pnpm check:links                            every hash, abbreviation, sender and URL in README.md
check-links docs/WALKTHROUGH.md             same, for the walkthrough
pnpm --filter web check:provenance          152 files, guard intact, every route declares its origin
pnpm --filter web verify:agents             41 checks, all pass
pnpm --filter web verify:resolution         19 passed, 4 skipped, block 5,847,571
pnpm --filter web check:contrast            every token AA on 4 surfaces; the five stay apart
check:render                                8 routes × 4 properties
```

**The DB suite did not flake this session** — 10/10 in 39.8s against a fresh Neon database, including
both Phase 6 migrations. Gap #5's re-run instructions were not needed. In the clean clone it skipped,
which is the documented CI behaviour and the proof that a clone with no `.env.local` still passes.

### The deployed read-through, and what it caught

**All eight routes were read as rendered text, not inferred from the build** — `/`, `/markets`,
`/review`, `/agents`, `/resolve`, `/trust`, `/audit` and `/markets/8`, all 200, on deployment
`9ec7a35` (GitHub deployment status `success`, 2026-09-30T20:13:17Z). `/trust`'s role matrix, the
`pause()` refusal, `/agents`' per-market cap bars and `/markets/8`'s computed lifecycle footer all
read correctly.

**And it caught a fifth drifted claim, in prose this session had written an hour earlier.** `/resolve`
renders market #11's question in full:

> *"Will the stock price of Summit Therapeutics close above $25.00 on the NASDAQ exchange within 48
> hours of the market closing?"*

That is the **same proposal gap #26 named as the clean candidate for a human refusal** — approved
instead, and now the one market past close. So the README paragraph this phase had just rewritten was
still incomplete: it blamed the retrieval coverage floor for the undrafted outcome, when the first
reason is that **the question's answer does not exist until after its own resolve deadline**. No
retriever settles that. Both reasons are now stated, in the README and in gap #40 — one market nobody
can resolve, and a coverage floor never tested on an article reporting an outcome. The contract
handles the market correctly regardless: it goes stale and `invalidateStale` refunds the stake.

**The lesson is the one this project keeps relearning, one turn further on.** The fix was not
available from the source, or from the tests, or from this file — it was on a page, in a sentence the
page had assembled out of the database, sitting next to a number that made the old explanation look
sufficient.

### The release, and the one tag that was moved

**`v1.0.0` is an annotated tag at `c48a10f`**, tag object `7f97f2a`, pushed to
`github.com/arunishrajput/auspex`. There is no GitHub Release object; it is a tag ref.

**It was first pushed at `9ec7a35` and then moved, deliberately and with the owner's decision.** The
deployed read-through happened after the tag, found the fifth drifted claim, and the fix landed in
`c48a10f`. A tag whose own message says *"every claim in the repository was verified once"* pointing
at a tree with a known-incomplete claim in its README would be the same species of untruth this
release exists to remove. The tag was twelve minutes old, carried no GitHub Release and had no
consumers, so moving it cost nothing real. **Written down rather than quietly done**, because a
force-updated public ref is exactly the kind of thing a reader is entitled to know about, and because
"the tag was moved" is a cheaper sentence than a reader discovering it from a reflog.

**Main is one commit ahead of the tag**, carrying only this note — a commit cannot record the act of
tagging itself.

### Exit criteria

| # | Criterion | Result |
|:--|:--|:--|
| 1 | Every command in the sweep passes, output recorded | ✅ 15 commands, numbers above |
| 2 | `git tag v1.0.0` exists and is pushed; `CHANGELOG.md` covers Phases 0–12 | ✅ annotated tag; changelog written from the 36-commit history |
| 3 | A clean clone builds and its tests pass with no undocumented step | ✅ `git clone --local`, no `.env.local`: install 4.2s, compile, 431 passed / 10 skipped, build |
| 4 | All routes 200 on the deployed URL and read correctly **as rendered pages** | ✅ 8 routes read top to bottom on `9ec7a35`; the read caught a fifth drifted claim |
| 5 | `README.md`'s Limitations section still accurate after Phases 9–11 | ⚠️ **It was not.** One paragraph described a defect Phase 11 had fixed; the first rewrite of it was also incomplete. Both corrected |
| 6 | No known gap is stale: each closed, or restated as true today | ✅ #5, #7, #26, #28, #33 and #37 restated with today's measurements; #38, #39 and #40 added |
| 7 | Version `1.0.0` across the workspace | ✅ root, `web`, `contracts` — `video` was already 1.0.0 |
| 8 | Repo presentation | ✅ description and topics set; social preview image is the one item needing the owner |

---

## Phase 11 — what shipped

### The shape of it

Three claims were false or unearned. Two were fixed in the system; one was fixed by deleting the
claim and replacing it with a query. Nothing was written to the chain, no address or hash changed,
and no existing check was relaxed.

| Claim | Was | Is |
|:--|:--|:--|
| "the pipeline runs every five minutes" | stated in prose, false by a factor of ~60 | stated nowhere; computed from `audit_log` on `/audit` per request |
| the resolution stage examines closed markets | starved by an unbounded clustering stage on 2 of 3 real chances | runs first among the model stages, with every stage clocked |
| a tick's duration is knowable | not stored anywhere; 22 ticks left no record | `durationMs` + `budgetMs` + the resolution report on every row |

### The defect was intermittent, which made it worse

Gap #34 said the resolution stage halted at `examining 0 market(s)` on both ticks that had a
resolvable market. By the time this session read the log there had been a third, and it had
**succeeded**. Counted from `audit_log` rather than from the notes:

| Tick (UTC) | Resolution stage |
|:--|:--|
| 2026-09-30 07:18 | `out of time … after examining 0 market(s)` |
| 2026-09-30 13:55 | `out of time … after examining 0 market(s)` |
| 2026-09-30 18:51 | examined 1 closed market |

Two of three. The stage's behaviour depended on how quickly clustering's four model calls happened
to answer — clustering had a **call budget and no clock**, and four calls at the 22s timeout is 88
seconds against a 60-second function. So the bug looked fine whenever it was checked and failed when
it was not, which is the worst shape a defect can have. ADR-075.

### What the ladder is now, and why the order changed

```
stage        fraction   at 60s   bounded by             was
resolution      0.30      18s    ladder + 1 call        0.40, and ran FOURTH
cluster         0.40      24s    ladder + 4 calls       no deadline at all
propose         0.45      27s    ladder + 2 calls       no deadline at all
agents          0.50      30s    ladder + 3 calls       0.63
settle          0.85      51s    ladder (no model)      0.80
```

**Resolution runs before the news stages.** The argument is the cron, not the stages: "the next tick
picks it up" is a promise whose value is the cadence, and the cadence is 5h07m. Market #11's resolve
deadline was about four hours after its close. A starved resolution stage is therefore not deferred
work — it is a market that goes stale and gets refunded, which is what happened. It runs *after*
ingest so its evidence includes this tick's articles.

**Every model stage is clamped to `budget − callTimeoutMs() − TAIL_RESERVE_MS`** — 30s of 60. A
deadline is checked *before* a call starts, so the old agents fraction (0.63 = 38s) permitted a 22s
call to begin at 37.9s and return at 59.9s, leaving nothing for the intent worker, the indexer, the
notifier or the tick's own audit row. No tick had hit it, because production ticks measure 15–24s,
but the ladder allowed it. That is a latent bug this phase closed on the way past.

`stageDeadlines` is exported as a pure function so the arithmetic is checkable rather than argued.
**Six of `tick.test.ts`'s seven tests fail when the old fractions are pasted back in** — verified by
doing exactly that.

### The defect only the rendered page could show — a ninth time

The cadence panel was built, the build passed, and the served page read:

> **Mean gap 84m** between the last 35 ticks

Eighty-four minutes, for a system whose unattended cadence is five hours. `audit_log` holds every
tick — cron, the Run tick button, and local `pnpm tick` runs — and averaging them made the pipeline
look four times more live than it is when nobody is watching. **That is the exact impression this
phase existed to remove**, and it would have shipped as the phase's headline number.

The fix needed a column that did not exist. The GitHub workflows have posted
`{"source":"github-actions"}` since Phase 3 and **nothing ever read it**. The route now maps that
body through an allowlist onto a `TickSource`, the button and the CLI identify themselves, and the
panel reports *unattended* separately from *any trigger* — showing "needs 2+ ticks tagged with a
trigger; N so far" until it has the rows to support a number, rather than borrowing the other one.

Ninth time in this project that a defect was invisible in source and obvious in the served output.

### The cron measurement, which is what the claim was checked against

`gh run list`, over the 46 hours to 2026-09-30T18:50Z:

| | heartbeat | sync |
|:--|:--|:--|
| Scheduled runs delivered | 10 | 7 |
| Window | 46h07m | 29h15m |
| Mean gap | **5h07m** | 4h52m |
| Range | 2h57m – 6h44m | 2h53m – 6h29m |
| Share of runs requested | **1.6%** | 1.7% |
| Failures | **0** | **0** |

Every run succeeded: GitHub throttles scheduled workflows on a low-activity public repository. The
expressions changed to `7,37 * * * *` and `19,49 * * * *` — 48 requests a day instead of 288, offset
from the top of the hour, which GitHub's own documentation names as a high-load window, and the sync
twelve minutes behind the heartbeat so it indexes rather than races it. **What that delivers is
unmeasured and is claimed nowhere.** Vercel Cron was rejected: on the Hobby plan it runs once a day.

### Live results

- `pnpm -r test` — **498 passing** (441 web · 57 contracts), up from 486. Twelve new: seven on the
  ladder's arithmetic and ordering, five on the clustering clock.
- `pnpm typecheck`, `pnpm lint`, `pnpm --filter web build` — clean.
- `pnpm check:links` · `node scripts/check-links.mjs docs/WALKTHROUGH.md` — every hash, abbreviation
  and URL still resolves after the prose changes.
- `pnpm --filter web check:contrast` — passes; no token changed.
- `pnpm --filter web check:provenance` — 152 files, runtime guard intact.
- `pnpm --filter web verify:resolution` — all checks pass, 4 skipped for want of a market in that
  state. Market #11 `CLOSED`/`UNRESOLVED`, `proposeResolution(#11)` as the resolver *would succeed*.
- `check:render` could not run: the Playwright installs on this machine have no Chromium binary
  (`npx playwright install` not run). The script skips with an explanation by design. **Recorded as
  not run rather than reported as passing** — see Known gaps.

### Exit criteria

| # | Criterion | Result |
|:--|:--|:--|
| 1 | Real cadence measured over ≥6 hours, and **every** statement of it matches | ✅ **46 hours**, `gh run list`: mean 5h07m, 1.6% of requested. Every prose statement **removed**; the figure is a query on `/audit`. |
| 2 | A production tick on record examining ≥1 past-close market, and no `examining 0 market(s)` when a candidate exists | ✅ Two — 2026-09-30T19:27:23Z and 19:27:54Z, both `resolution.pending: 1`, `haltedBecause: null`, HTTP 200, zero stage errors |
| 3 | Clustering has a deadline, not only a call budget, and the ladder is documented in one place | ✅ `deadlineMs` on clustering **and** the proposer; the ladder is the header of `lib/pipeline/tick.ts` and nowhere else |
| 4 | `audit_log.metadata` carries `durationMs`, and `/audit` shows it | ✅ Plus `budgetMs`, `source` and the resolution report. Panel reads "24.4s median of 2, worst 27.4s against 60.0s" |
| 5 | Known gaps #20 and #30 closed or restated | ✅ Both closed. #21, #33, #34 closed and #37 restated with a bound as well |
| 6 | `pnpm check:links` passes; full suite green | ✅ links + walkthrough links + 498 tests + typecheck + lint + build + provenance + contrast |

**One check could not run, and is recorded rather than skipped.** `check:render` needs a Playwright
Chromium binary, which is not installed on this machine (`npx playwright install` has never been
run) — the script declines with an explanation by design rather than failing. **The render check was
done by hand instead, and found nothing:** `/audit` was read as served at 1280px and 390px,
`document.documentElement.scrollWidth - clientWidth` is **0** at 390px, and the cadence panel stacks
two-up with its dividers intact. The only elements extending past the viewport are the site nav's,
which is a deliberate horizontal scroll strip and predates this phase.

## Phase 10 — what shipped

### The shape of it

A complete visual redesign: light, papery, typographic. The old theme was dark mission-control,
which suited a projector and worked against what this product actually asks of a visitor, which is
to sit and read evidence.

The phase was done in the order the plan insisted on, and the order was the whole trick.

| | Before | After |
|:--|--:|--:|
| Shared components | **3** | **27** exports in 10 files (883 lines) |
| Duplicated helper definitions across pages | **24** (9 names) | **0** |
| Page code (`app/**/page.tsx`) | 4,989 lines | **4,689** |
| Inline colour-token references in `app/` | 1,228 | **1,054** |
| Places the semantic tones were re-derived as class strings | **6** | **1** |
| Tests | 420 | **429** |

### Why the token names did not change, and why that is the whole redesign

A census of how the ramp was actually used found unusual discipline: `ink-950/900/850` appear only
as surfaces, `ink-800/700` only as borders and dividers, `ink-500` through `ink-100` only as text.
**Nothing crosses over.** That meant the entire theme could be inverted by changing values and
keeping every name — `bg-ink-950` was the darkest ground and is now the lightest, `text-ink-100`
was the brightest text and is now the darkest, and both still mean the same thing: *furthest from
the eye* and *the thing being read*. The number keeps its role, not its brightness.

The same applies to the five semantic tones. 237 places render one of them as text directly through
`text-{tone}-500`, so each tone is **one value** retuned to work as small text, as a hairline
border, as a 12% tint and as an 8px status dot. Every one of those call sites became correct in a
single edit. Adding a separate darker step for text would have meant two shades of the same claim
on one page, which is the drift this phase existed to remove.

### The measurement that changed the design — ADR-074

Five colours cannot all clear AA on a white ground **and** stay far apart in greyscale. A search
over hue and lightness (250k samples) could not push the worst pair past **1.13** in luminance
ratio. That is a property of the colour space, not a failure of effort.

Worse, the pairs that collapse under colour blindness form a **five-cycle** —
bad–ok–signal–human–warn–bad — and every edge needs a lightness gap, because hue is what dichromacy
removes. A cycle cannot be laid on a line with all its edges long. The intuitive ordering was tried
first and measured: `signal`/`human` came out at **ΔE 3.1** under deuteranopia, which is one colour.
Assigning the tones *alternately* around the cycle (bad, signal, warn, ok, human — lightest to
darkest) puts every colliding pair at least two rungs apart.

Final, measured: worst greyscale **1.19:1**, worst colour-blind separation **ΔE 11** (`ok`/`bad`
under protanopia), every text token **≥4.5:1** on all four surfaces.

**So the glyph is load-bearing.** `✓ ▲ ✕ ◆ ✍` live in the tone registry, not at call sites, so a
tone cannot be used without one being available — and the Phase 10 exit criteria say this is the
right answer: *"because they are never the only signal, verify each is paired with text or an
icon."* A greyscale and a deuteranopia render of `/audit`'s action chips were read by eye to
confirm the marks carry the claim where the colour no longer does.

### The defect only the rendered page could show — an eighth time

The first light-theme screenshot of `/markets` showed **crimson on every card**. `Pool NO` was
`text-bad-500` — and on that same page `bad` is the `INVALIDATED` badge. The colour that means
*refused, reverted or invalid*, the single most important signal this product has, was also being
used to mean "the NO side of a bet". It had been that way since Phase 2 and nobody had questioned
it; the dark theme hid it because crimson-on-near-black is quiet, and white made it shout.

Fixed in four places — `/markets`, `/markets/[id]`, `/resolve`'s `SIDE_STYLE`, `/agents`'s decision
row — by rendering sides in neutral ink and letting the label do the work. ADR-073.

Two smaller ones from the same screenshots: the word *human* in the landing page's pipeline arrow
was tinted `warn` while a `human` tone existed, and five action buttons were `signal`, which means
"read from or linked to the chain" — a button is not a chain fact. Buttons are now the accent.

### The accent is chrome and never data

`accent` is a teal that appears in the nav, the eyebrows, the taglines, the grid wash, the empty
states and the buttons — and nowhere a number lives. `check-contrast.mjs` asserts it stays ΔE ≥ 18
from all five tones, so a reader never has to wonder whether the chrome is making a claim.

### Typography

Three faces, each with a job: **Bricolage Grotesque** for display (character at headline sizes),
**Inter** for prose (most of this site is argument), **JetBrains Mono** for every hash, address, wei
value and column name. The old theme set mono as the default for everything, which made the prose
harder to read for no benefit. Self-hosted through `next/font`, so no runtime request to Google and
no layout shift.

### Two new verification commands — the phase added to the checks, it did not relax any

```bash
pnpm --filter web check:contrast    # AA on every real pair, greyscale, 3× colour blindness, glyphs
pnpm --filter web check:render      # 390px overflow · focus rings · reduced motion, over all 8 routes
```

`check:contrast` reads `@theme` out of `globals.css` and needs nothing running. `check:render` needs
a built server and Playwright, which is deliberately **not** a project dependency — it skips with an
explanation rather than failing a build that cannot run it:

```bash
PLAYWRIGHT=/path/to/playwright/index.mjs BASE=http://localhost:3210 node scripts/check-render.mjs
```

### Live results

| | |
|:--|:--|
| Routes redesigned and served | **8 / 8**, all 200 |
| Horizontal scroll at 390px | none, on any route (Phase 7 checked three; this checked eight) |
| Focus ring | visible on every focusable element — 430 checked across the eight routes |
| `prefers-reduced-motion` | zero running animations on every route |
| Contrast | every text token ≥4.5:1 on page, card, card-head and sunken surfaces |
| `check:provenance` | passed — 148 files, every route still declares its origin |
| `check:links` | passed — every hash, abbreviation and URL in the README still resolves |
| Tests | **429** (420 web + 9 new for the tone registry, 57 contracts) |

### Exit criteria

- [x] All 8 routes redesigned and served — none left on the old theme.
- [x] Light is the default and `color-scheme` matches; no route renders dark-on-dark or
      light-on-light. Dark mode **dropped**, not half-shipped — ADR-072.
- [x] **Contrast:** AA on all body and UI text, measured on real pairs by `check:contrast`.
- [x] **The semantic five survive** — mutually distinguishable, and each paired with a glyph that
      carries the claim into greyscale and dichromacy. Measured, and confirmed by eye on rendered
      greyscale and deuteranopia captures. ADR-074.
- [x] `<Provenance>`'s six origins remain distinct and `MOCK` is still the loudest possible badge
      (it is the only tone using a solid `bg-bad-500/20` with a full-strength border).
- [x] No horizontal scroll at 390px on all eight routes.
- [x] `prefers-reduced-motion` honoured by every animation, verified in a browser with the
      preference set.
- [x] Keyboard focus visible on every interactive element against the new backgrounds.
- [x] Full suite green; `check:provenance` and `check:links` pass; every route read top-to-bottom
      in the browser, not assumed from the build.

---

## Phase 9 — what shipped

### The shape of it

The job was to change **who the repository is talking to** without changing a single fact. It
addressed a competition assessor 224 times across 65 files, opened on a byline naming an event, and
its best feature was called "judge mode".

What actually changed: labels, framing, and the reader being addressed. What did not change: every
address, every hash, every measurement, every stated limitation, and every identifier already written
to an append-only table.

Two things did change that were not framing, and they are the interesting part of the phase — **two
sentences that had quietly become false.** Both were prose sitting beside data it did not read. That
is now the fourth and fifth time this project has made that mistake, and the fix in both cases was to
compute the sentence instead of writing it.

### The two false sentences, found by reading the chain rather than the file

**1. `/markets`'s footer named market id ranges.** It said *"Markets 1–2 are Phase 1 smoke tests …
all four are labelled as such in their own question text … Markets 4–7 are the real pipeline."* It was
written when nine markets existed. Thirteen exist. It was wrong twice over:

- It **undercounted the product path by five.** Markets 9, 10, 11, 12 and 13 were each created by a
  browser-wallet signature from `0xA9F68fDf…311fF1`, exactly as 4–7 were.
- It claimed all four commissioning markets label themselves, and **two do not.** Markets 1 and 2 ask
  *"Will AuspeX have a verified contract on MST Testnet before the deadline?"* — obviously not a
  product question, and it never says it is a test. `BUILD_PLAN.md` and ADR-068 both repeated the
  claim; reading `readAllMarkets()` disproved it.

The fix is `marketOrigins()` in `lib/trust/signers.ts` — pure, six unit tests, and it derives the split
from `markets.creator`, which is the creating address out of each indexed `MarketCreated` topic.
`proposedBy` is useless for this: the contract sets it at *resolution* time and it is the zero address
until then. ADR-070.

**2. The landing page carried a hand-maintained eight-phase build roadmap** whose last row read
*"Phase 8 · Live run, README, submission · in progress"*. Phase 8 finished a day earlier. The page's
own copy admitted the panel was "the only hand-maintained list on this page … it carries no provenance
badge for that reason" — which was an accurate confession and not a defence. It is replaced by a
pointer at `docs/BUILD_RECORD.md`, which cannot go stale.

A third, smaller one: the footer said *"When contracts and markets exist, every address and
transaction hash shown will resolve on MSTScan"* — a conditional written before anything was deployed,
still rendering eleven markets later.

### The cap probe, and the identifiers that did not move — ADR-069

"Judge mode" is now the **cap probe**. Every label changed: the `/trust` heading, `lib/judge/probe.ts`
→ `lib/probe/capProbe.ts`, `JudgeButton` → `CapProbeButton`, `judgeProbes()` → `capProbes()`,
`JudgeProbeRow` → `CapProbeRow`, `judge:probe` → `probe:cap`, and the README.

**Every stored string stayed exactly as written** — the `audit_log` action `judge.cap_probe`, the
actor prefix `judge-mode:`, and the intent key prefix `judge:cap-probe:`. `audit_log` is append-only,
five probe rows predated the rename, and writing new rows under a new action string would give one
event two names in a table that is never migrated. Mapping the id to a display label was rejected for
a sharper reason: a log page that renders something other than what is stored can hide anything, and
that page's entire value is that it does not.

So the identifier is visible and **explained where it is visible** — one sentence under the probe log
on `/trust`, and one under the action histogram on `/audit`. That is the trade: an awkward identifier
with an explanation beats a tidy one with a silent mapping.

### The record was kept, and now it says so — `docs/BUILD_RECORD.md`

The designated history set, written down rather than left implied:

| File | What it is |
|:--|:--|
| `PROGRESS.md` | this file — session-by-session build state |
| `docs/BUILD_PLAN.md` | the phase plan and its exit criteria |
| `docs/DECISIONS.md` | 71 ADRs |
| `docs/WALKTHROUGH.md` | was `DEMO_SCRIPT.md`; rewritten for a reader with no presenter |
| `docs/original-brief-2026-09.pdf` | was `BUILDATHON GUIDE.pdf` in the repository root |
| `video/` | the four-minute film and its Remotion source, frozen as rendered |

`video/` was the interesting call. The film's end card names the event and one shot is labelled "judge
mode". Editing the source would leave a repository whose film says one thing and whose code says
another — and the film is the artifact that cannot be re-checked. So it is frozen, and
`video/README.md` opens with a dated paragraph saying why and naming both frozen labels.

**One line outside the history set still names the event, deliberately.** `RUNBOOK.md` records that
the Gemini key in use is listed in Google Cloud as *"AuspeX MST Buildathon"*. That is the
credential's real display name and it is how the owner finds it in the console; inventing a different
one would make the runbook wrong about something an operator has to look up. It is dated and labelled
cosmetic in place, and named as an exception in `BUILD_RECORD.md`.

### The cadence claim now says what was measured

Three places said or implied the pipeline runs every five minutes. `heartbeat.yml` still *asks* for
`*/5 * * * *`, because changing the mechanism is Phase 11's job — but nothing now quotes the
expression as the cadence. The README, `ARCHITECTURE.md` and the workflow's own comment all state the
measurement: **roughly every five hours**, with the five observed runs listed (12:55, 18:28, 22:32,
01:29, 07:18 UTC across 2026-09-29/30, all successful).

The README also now names the starved resolution stage in Limitations, in its own paragraph, rather
than leaving a reader to infer it from a footnote.

### Live results

| | |
|:--|:--|
| Markets on chain | **13** — unchanged by this phase; verified by `readAllMarkets()` |
| New cap probe, post-rename | [`0x256697762f1069f31f6012a9ec4d72997a84ed57a7321fe540bdb164ecd4709b`](https://testnet.mstscan.com/tx/0x256697762f1069f31f6012a9ec4d72997a84ed57a7321fe540bdb164ecd4709b) — **Reverted**, block 5,839,893, `AgentPerTxCapExceeded(20000000000000001, 20000000000000000)` |
| Probe rows in `audit_log` | **6** — the five pre-existing plus the new one, all under one predicate |
| Tests | **477 passing** (420 web + 57 contracts), up 21 from the `marketOrigins` suite |
| Routes | all **8 return 200** from a production build |
| `preflight` | **11/11** |
| `check:links` | green on `README.md` **and** `docs/WALKTHROUGH.md` |
| `check:provenance` | green — 137 files scanned |
| `verify:resolution` | all checks passed, 4 skipped for want of a market in that state |

### The defect only the rendered page could show — a seventh time

`{origin.humanCreated.length === 1 ? "" : "s"}` after the literal `Market` compiled, typechecked,
linted and read correctly in the source. The served HTML was `Market<!-- -->s`, which renders as
**"Market s 4–7 and 9–13"**. React inserts a comment marker between adjacent text nodes, and the
browser renders it as a space.

Nothing in the toolchain objects to this. It was found by `curl`-ing the built page and reading the
prose. The fix is to put the whole word inside the expression — `{n === 1 ? "Market" : "Markets"}`.
Hard rule #9 has now paid for itself seven times.

### Exit criteria

| Criterion | Result |
|:--|:--|
| `grep -riE 'hackathon\|buildathon\|newrro\|bmsce'` hits only in the history set | ✅ — hits in `PROGRESS.md`, `BUILD_PLAN.md`, `DECISIONS.md`, `video/`, `original-brief-2026-09.pdf`, **plus** the one named RUNBOOK line described above |
| No user-visible surface addresses a judge, a submission, a deadline or an event | ✅ — verified by rendering all 8 routes from a production build and grepping the extracted text, not the JSX |
| A `LICENSE` file exists and matches the README | ✅ — MIT, and `package.json` declares it |
| `pnpm check:links` passes | ✅ — 27 hashes, 27 abbreviations, 13 sender attributions, 8 relative links, 13 absolute links |
| Full suite green + `check:provenance` | ✅ — 477 tests, lint, typecheck, build, provenance |
| The renamed probe produces a real reverted tx; the five old rows still render | ✅ — new tx above; `/trust` renders all six |
| `PROGRESS.md` records where the build history lives and why | ✅ — this section, and `docs/BUILD_RECORD.md` is the page it points at |

**Nothing was skipped.** The one criterion that needed a judgement call rather than a pass/fail is the
first: it is reported above with its exception named, rather than passed by deleting a true line from
the runbook.

---

## Phase 8 — what shipped

### The shape of it

Phase 8 is not a feature phase. It is the phase where every claim the previous seven made gets checked
by someone hostile, and the hostile someone is supposed to be me before it is a judge.

Three things shipped:

1. **`README.md`, rewritten from scratch.** It had been stale since Phase 0 — it literally said
   *"Build status: Phase 0 of 8 complete … the contract is not deployed yet"* while nine markets and
   thirty-odd real transactions existed. It now opens with a 60-second self-check a judge can run
   with no wallet, carries two evidence tables (what the system did; what the chain refused), and
   ends with Limitations written to be read rather than skimmed past.
2. **`docs/DEMO_SCRIPT.md`, finalised.** Every transaction it points at is named by hash, with the
   **real sender** beside it, and the tab list is explicit.
3. **`pnpm check:links`** — a new guard, and the only genuinely new machinery in the phase.

### The defect this phase existed to find

`/markets/8` ended with a fixed sentence: *"A market is created by a browser wallet, bet on by a capped
agent, resolved by a browser wallet … There is no row in which a privileged server key moved money."*

**It was false on the market it was printed on**, and `DEMO_SCRIPT.md` sent judges straight to it.
Market 8 was driven by the operator key, because demonstrating a payout needs stakes on both sides and
no such market existed (ADR-059). Its first row is the admin key staking 0.01 tMSTC. And every row in
that table said `server key` — including the admin key's — because the label came from
`onchain_intents.signer`, an enum with two values, one of which covers both a capped agent key and the
key that can pause the contract.

Then the same error, three times, in the first draft of the README written *this session*:
`proposeResolution`, `challengeResolution` and the round-2 proposal were all credited to "the human"
when the operator key had sent them. Every link resolved. Every hash was real. The column beside them
was flattering and wrong — which is worse than a broken link, because a judge can check it in one
click and it is the exact claim the whole design is meant to earn.

**Fixed in two parts** (ADR-065):

- `lib/trust/signers.ts` classifies each signer by a live `hasRole(DEFAULT_ADMIN_ROLE, …)` — so
  `operator key` and `agent key · atlas` are distinguishable, and the operator rows render in the
  warning colour. `lifecycleClaim` is pure and **withholds the strong claim** the moment one operator
  row appears, naming the calls instead. 11 tests; the important one asserts the withholding.
- `scripts/check-links.mjs` reads every markdown table row naming both a transaction and an address,
  fetches the transaction, and fails if they disagree. **Verified by reintroducing the exact error on
  purpose and watching it fail**, then restoring.

### What measurement changed — a sixth time, and again it was the output that told the truth

The pattern from ADR-029/045/049/060 held once more, in a new place. Reading the chain rather than
`PROGRESS.md` found **three transactions and a human refusal that this file did not record**, because
the live system kept running between sessions on its 5-minute cron. Reading the rendered page rather
than the source found a caption contradicting the table above it.

Also measured, closing most of gap #20: a production tick at **24,277 ms with 7 of 10 LLM calls and
zero errors**, and — from `audit_log` — the cron's 05:19 tick at **9 of 10**, with a full clustering
budget, a full proposer budget and a full agents pass. The only unspent call is the resolution one,
which has nothing in scope until markets #4–#7 close. Marginal cost is roughly 1.5–2 s per call, so ten
calls extrapolates to ~30 s against a 60 s limit, with the deadline ladder as the backstop.

Two Gemini **503s** were absorbed mid-tick by the fallback chain — `gemini-3.1-flash-lite` failed and
`gemini-3.5-flash-lite` answered, which is the reverse of the order measured in Phase 3. The chain
earned its place. Do not reorder on one sample; `GEMINI_MODELS_FAST` is runtime-overridable anyway.

### And one more, caught by reading the deployed page again

With the fix live, `/markets/8` said **"2 of them staked tMSTC"**. One of those two was the `placeBet`
that reverted with `BettingClosed()` — value carried into a call the contract refused, so nothing
moved. `lifecycleClaim` now requires `CONFIRMED` as well as a non-zero value, with a test built from
market 8's real shape. The error leaned self-critical, which is the safe direction, but the function's
whole purpose is that the sentence matches the rows. Two commits, because the second was only visible
after the first was deployed and read.

### Exit criteria

- [x] **Every tx hash in the README resolves on `testnet.mstscan.com`.** 25 hashes, 0 failures, and
      now automated: `pnpm check:links`. It also checks 27 abbreviations and 19 sender attributions.
- [x] **Contract shows Verified.** `is_verified: true`, `is_fully_verified: true`, solc `v0.8.28`,
      evm `cancun`, optimizer 200 runs, 10 source files.
- [x] **The over-cap tx shows Reverted.** Five of them do, decoded as
      `AgentPerTxCapExceeded(20000000000000001, 20000000000000000)`.
- [x] **Zero mock data anywhere in the production build.** `check:provenance` passes over 130 source
      files after a real build, *and* all 8 deployed routes were fetched and scanned at runtime — no
      `MOCK` badge, no `Refusing to render`, no error boundary. The runtime check is the stronger one,
      because most routes are `force-dynamic` and so barely prerender anything (gap #28).
- [x] Full suite green: **437 tests** (380 web + 57 contract), lint clean, typecheck clean, build clean.
- [x] **CI green on both commits**, and the deploy verified live afterwards — all 8 routes 200, and the
      corrected caption confirmed served rather than assumed.
- [x] No horizontal scroll at 390 px on `/`, `/trust` or `/markets/8`.
- [ ] **A cold visitor with no wallet can understand the whole story from the public URL.** All 8
      routes return 200 and read coherently, and judge mode works from the live URL — but this
      criterion is a judgement about comprehension, not a check, and I am the wrong person to sign it
      off on my own work. Ask one person who has not seen it.
- [ ] **The builder can explain the contract, the policy gate and the pipeline unprompted.** Not
      mine to certify. `DEMO_SCRIPT.md` is the script; the exercise is saying it out loud once.

---

## Phase 7 — what shipped

### The shape of it

Phase 7 added no new kind of on-chain transaction, and that was the point: every contract function
was already exercised by a real, resolvable transaction. This phase makes the claim behind them
**checkable by a stranger**, which is a different job.

`/trust` is the new page, and it has one rule: nothing on it is a sentence where a call would do.

| The claim | How the page makes it | Not |
|:--|:--|:--|
| No key this app holds carries authority | `hasRole()` × 4 roles × every known address, on every request | a table in the README |
| Not even the human authority can pause | an `eth_call` of `pause()` from `0xA9F6…1fF1`, which reverts | "the admin key is offline" |
| The gates refuse things | `GROUP BY` over four tables, bucketed by the gate's own reason codes and the contract's own error names | a screenshot |
| The chain is the real bound | a button that makes a stranger's browser produce a reverted `placeBet` | a claim about a cap |

### Judge mode, and why it is a *refused* transaction

The exit criterion was "a judge produces a real tx from a clean browser with no wallet". The obvious
reading — hand them a pre-funded wallet and let them do something — is wrong, and thinking about why
produced the better feature.

Any button that produced a **successful** transaction would mean this application holds a key that
does something consequential on a stranger's say-so. That is the opposite of everything the rest of
the site argues. The only transaction it is *safe* to hand a stranger is one the contract is going to
refuse — and the one worth handing them is the over-cap bet, because it is the single most
load-bearing claim in the project.

So the button reads an agent's on-chain per-transaction cap, adds **one wei**, and sends the bet with
the policy gate deliberately not consulted. The contract refuses it and names both numbers. A judge
gets *their own* hash, resolvable on MSTScan, without installing anything.

**The safety is the `eth_call`, not the cooldown.** `runCapProbe` simulates first and refuses to
broadcast unless the chain confirms it will revert with `AgentPerTxCapExceeded`. A *successful*
simulation is the failure case — it would mean the cap is not what the contract said a moment before,
and sending it would stake real funds on a visitor's click. A revert for any other reason is also
refused, because the transaction would then not show what the button claims. ADR-062.

It writes no `agent_decisions` row. No model was asked and no gate ran, so a row would put a
stranger's button press into a member's trading record. Its record is an `audit_log` row, an
`onchain_intents` row, and a hash.

### The kill switch has no button, deliberately

`docs/BUILD_PLAN.md` listed "kill switch control" as a Phase 7 task. Implementing it literally would
require the deployed application to hold `DEFAULT_ADMIN_ROLE` — the role that can *also* register an
agent, change a cap and grant every other role. A pause button is therefore a proof that the running
system could do all of those, which contradicts the page it would sit on.

What replaces it is stronger: an `eth_call` of `pause()` **from the human authority's address**,
rendered live. It reverts with `AccessControlUnauthorizedAccount(0xA9F6…1fF1, 0x00…00)` — the wallet
that creates every market and signs every resolution on this deployment cannot halt the contract.
A working button could never show that. ADR-063. **This is a deliberate deviation from the plan and
is recorded as one rather than quietly dropped.**

### `<Provenance>`, and the check the obvious design could not pass

The plan said "CI fails if `MOCK` provenance appears in a production build". The natural
implementation — grep the bundle — **cannot work**: `Provenance.tsx` necessarily contains the string,
because it is the branch being forbidden, so every bundle contains it whether or not any page uses it.
A bundle grep would fail always, or need an exception wide enough to be useless.

`scripts/check-provenance.mjs` makes four checks instead, each closing a hole the others leave:

1. **Nothing may name it.** The token must not appear anywhere under `app/`, `components/`, `lib/` or
   `scripts/` outside three allowlisted paths. Blunt on purpose — it catches `origin="MOCK"`, an
   origin arriving through a variable, a const named `MOCK_ROWS`, and a comment promising to remove
   one later. The Phase 6 placeholder matched two JSX spellings and would have missed all four.
2. **The runtime guard must still exist**, asserted by reading the component's source — so the check
   cannot be defeated by deleting the throw it relies on.
3. **No rendered badge in the build output.** Prerendered HTML contains only what a page actually
   produced, so it *can* distinguish a call site from the component's own branch. Honest about its
   reach: nearly every page here is `force-dynamic`, so on most builds this proves little.
4. **Every route must declare a provenance**, or be on a written exemption list — so "I forgot to say
   where this came from" does not look identical to "there is nothing to say".

Plus the component throws rather than render `MOCK` when `NODE_ENV === "production"`. ADR-061.

**Both layers were tested by deliberately breaking them**, not by reading the code: a `MOCK` badge
added to `/audit` made the checker fail with `app/audit/page.tsx:254` and made the built page return
**HTTP 500** with `Refusing to render MOCK provenance in a production build`. Reverted immediately.

Check 4 failed on its first run against seven real pages, which is how the badges came to be written
at all. Six origins exist and each is a different trust claim: `CHAIN` (an RPC read this request),
`INDEXED` (Postgres from a confirmed log), `DB` (Postgres from our own pipeline), `COMPUTED` (a pure
function run at request time), `CONSTRUCTED` (a labelled synthetic input — the injection worked
example), and the forbidden one.

### What measurement changed — a fifth time, and again it was the output that told the truth

Every phase of this project has found a defect that was invisible in the source and obvious in the
output. Phase 7 found three, all in the same way.

**1. Two colour tokens were used sixty times and never existed.** `text-ink-200` and `text-ink-500`
appear across seven pages. Neither was declared in `@theme`. Tailwind v4 generates a utility only for
a declared token, and an undeclared one produces **no CSS and no warning** — so every one of those
elements rendered at its inherited colour, and text meant to be de-emphasised was not. Found by
grepping the *built stylesheet*: `text-ink-400` → 1 match, `text-ink-500` → 0. ADR-064.

**2. The role matrix was unreadable on a phone.** As a horizontally scrollable table at 390px, every
role column started off-screen — a judge saw the addresses and none of the crosses, which are the
entire payload of the panel. Found by taking an actual screenshot at an actual phone width. Below
`sm` it is now labelled chips that wrap; at `sm` and up the aligned table returns. Both render from
one array, so they cannot disagree.

**3. `/agents` reported `0` beside "could not read the database".** With Postgres unreachable, four
counters read zero — a measurement claim the page was in no position to make, and it claimed the
flattering direction: "nothing was ever refused" reads as "nothing ever went wrong". They now read
`—`. Found by running the *built* app against a deliberately unreachable Postgres, which is the
realistic failure (Neon scales to zero), not by reading the component.

### Also fixed

- **Known gap #12 closed.** `app/icon.svg` — the only error in the browser console on every page load
  was `/favicon.ico` 404ing. A Next file-convention icon rather than a hand-written `<link>`, so
  there is one file and no head markup to drift from it.
- **`/markets/999` told the wrong story.** A non-existent id rendered a red "could not read the
  contract" panel and then reported the *same* chain revert a second time as a database failure. The
  contract was answering perfectly clearly. It now renders a purpose-built panel that reads
  `marketCount()` and says which ids do exist.
- **One nav, on every page.** Seven routes were reachable only through the landing page. `SiteNav` is
  a server component — `current` is passed in rather than read from `usePathname()`, which would make
  every page that renders a nav a client component and ship React to `/` and `/markets` for the sake
  of one highlighted link.

### Live results

Read off the deployed page, not asserted:

| Counter | Value | What it means |
|:--|:--|:--|
| Refused by the schema | 0 | never fired — see known gap #26 |
| Refused by the policy gate | 7 | `CATEGORY_NOT_ALLOWED` 4 · `ABSTAINED` 3 · `STAKE_TOO_SMALL` 3 · `MEMBER_KILL_SWITCH` 1 |
| Refused by a human | 0 | never fired — see known gap #26 |
| **Refused by the chain** | **6, then 7** | `AgentPerTxCapExceeded` 2 · `AlreadyClaimed` 1 · `BettingClosed` 1 · `ChallengeWindowOpen` 1 · `NothingToClaim` 1 — the counter went up live when judge mode was clicked on the deployed URL, which is the point of it |
| Confirmed transactions | 14 | 6 `createMarket` · 4 `placeBet` · 2 `proposeResolution` · 2 `claim` |
| Audit rows with a reason | **249 of 249** | hard rule #7, as a query |

The role matrix, live: `0xA9F6…1fF1` holds `MARKET_CREATOR` + `RESOLVER` + `CHALLENGER` and **not**
`DEFAULT_ADMIN`. All three agent wallets — the only keys the deployed app can sign with — hold
**zero** roles.

### Exit criteria

- [x] `/trust` counters are real queries, not constants — seven `GROUP BY`s issued in one
      `Promise.all`, plus a `jsonb_array_elements_text` unnest for the gate's reason histogram.
- [x] CI fails if `MOCK` provenance appears in a production build — proved by breaking it on purpose:
      checker exit 1 with a file:line, and the built page returning HTTP 500.
- [x] Judge mode produces a real tx from a clean browser with no wallet installed — clicked in a
      Chromium where `window.ethereum` is `undefined`, twice: locally (`0xcfc34dff…cbaa08c3`, block
      5,798,488) and then **on the deployed URL** (`0xbfe9bb2c…ced060a`, block 5,798,796). Both
      confirmed through the MSTScan API as `placeBet`, value `20000000000000001`, `execution
      reverted`, decoded `AgentPerTxCapExceeded(20000000000000001, 20000000000000000)`. The second
      matters more: it proves production holds an agent key that can sign, which is the only kind of
      key it holds.
- [x] Every page has a sane empty and error state — the built app was run against an unreachable
      Postgres: **all eight routes returned 200** with a labelled panel carrying the real error, zero
      server exceptions. `/markets/999` and an empty role list were fixed in the process.
- [x] Readable on a phone — every route measured at 390px with **zero unintended overflow**; the only
      elements past the viewport are inside deliberately scrollable containers, and the page itself
      never scrolls horizontally.

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

`invalidateStale` **is** automated, behind a grace period (ADR-066, which revises ADR-057). It refunds
everyone, so running it the instant `resolveDeadline` passes would mean our own resolver being ten
minutes late costing every bettor their market — but *never* running it meant market #2 sat `CLOSED`
with a bettor's 0.01 tMSTC locked in the contract until a human noticed. The keeper now waits
`STALE_GRACE_SECONDS` (one hour, overridable) past the contract's own deadline and then refunds. The
call stays permissionless, so anyone may still make it sooner from their own wallet.

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

**`web/lib/db/schema.ts`** — 15 tables, 8 Postgres enums, migrated onto the real Neon database
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

**5. The DB test suite does not run in CI.** *(Re-measured at v1.0.0: **10/10 in 39.8s**, no flake,
against a fresh Neon database. In the clean clone with no `.env.local` it skipped — 431 passed, 10
skipped — which is the documented CI behaviour and is what proves a fresh clone needs no extra step.
The teardown flake below did not occur this session; the re-run instructions still stand if it does.)* `schema.test.ts` creates and drops a real database on
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

**7. ~~Tick duration.~~** ✅ **Measured in production and comfortable — and no longer measured by
hand.** *(At v1.0.0 this is superseded by gap #30's fix: `audit_log` stores `durationMs` and
`budgetMs` on every `pipeline.tick` row, and `/audit` renders the median. The figures below came from
hand-made `curl`s and are kept because they are the measurements the batching work was judged
against. The stored ones read **24.4s median of 2, worst 27.4s, against a 60.0s budget**.)*

The original note follows. **Measured in production and comfortable.** A full tick takes **48s
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

**12. ~~No favicon.~~** ✅ **Closed in Phase 7.** `web/app/icon.svg`, a Next file-convention icon.
`/favicon.ico` still 404s if something requests that exact path, but browsers use the emitted
`<link rel="icon">`, and the browser console is now clean on every page.

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

**20. ✅ CLOSED in Phase 11. Tick duration, and the deadline ladder that bounds it.**

**Every stage that can call a model now has a clock, and the ladder's arithmetic is tested.** The
"still unbounded" caveat below was the cause of gap #34, not a footnote to it: clustering's four
calls at the 22s timeout is 88 seconds against a 60-second function, so the call budget never
bounded that stage in wall-clock terms. Clustering and the proposer now take a `deadlineMs`, and
every model stage is additionally clamped to `budget − callTimeoutMs() − TAIL_RESERVE_MS` — 30s of
60 — because a deadline is checked *before* a call starts. The old agents fraction (0.63 = 38s)
permitted a call to begin at 37.9s and return at 59.9s with nothing left for the audit row; that is
now arithmetically impossible and `lib/pipeline/tick.test.ts` fails if it becomes possible again.
Measured after the change: a production tick returned **HTTP 200 in 21,361 ms**, and `durationMs` is
stored on the row rather than read from a response nobody keeps. ADR-075.

The Phase 8 text follows, and its reasoning still holds.

**Measured at near-worst case.** A production tick returned **HTTP 200 in 24,277 ms with 7 of 10 LLM
calls and zero errors**, and the cron's 05:19 tick spent **9 of 10** — full clustering, full proposer,
and a full agents pass. Only the single resolution call is unspent, and it has nothing in scope until
markets #4–#7 close. Marginal cost is ~1.5–2 s per call, so ten calls extrapolates to roughly 30 s
against `maxDuration = 60`. The remaining honest caveat is that a 10-call tick has not literally
occurred. The old text follows, and its reasoning still holds:
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

**~~Still unbounded:~~ closed in Phase 11.** This paragraph named the exact defect that starved the
resolution stage two ticks later — clustering and the proposer having no deadline, only a call
budget — and deferred it as "worth doing if a tick is ever seen to be killed". No tick was ever
killed; a *different* stage was starved instead, which is the failure mode this note did not
anticipate. Both now have deadlines. Kept rather than deleted, because a gap that was written down,
correctly, and then cost something is worth more as a record than as a tidy absence.

**21. ✅ CLOSED in Phase 11 by way of #34.** Two production ticks on 2026-09-30 (19:27:23Z and
19:27:54Z) examined market #11 in their resolution stage — `pending: 1`, `haltedBecause: null` —
where the stage had previously reported `examining 0 market(s)`. It still has not *drafted* an
outcome: market #11 has no candidate article above the coverage floor, so the honest report is
`1 with no evidence to read`. That is gap #22, not gap #21, and it is the stage working. The
original text follows.

**~~Superseded on 2026-09-30, and the truth is worse — see gap #34.~~** A market past close
now exists (#11), and the stage still has not examined it: it is cut off by its own deadline before
it reads the chain. The original text, which was accurate when written, follows.

**The resolution agent has never run against a market that is genuinely past close.**
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

**26. ⚠️ Still half closed at v1.0.0, and deliberately so.** The second refusal was not made this
phase. It needs a human signature in `/review`, Phase 12 needed no wallet and used none, and the item
is on no critical path — the counter is lit, the mechanism is proved, and what is unsatisfying about
it is the *wording* of one signed reason, which cannot be edited without invalidating the signature.
The candidate and the exact wording are still in the handoff for whoever wants it. Original text
follows.

**The human layer has now refused once — with the reason `test`.** `/trust` counts refusals by the
schema (0), the policy gate (7), a human (0) and the chain (6). The two zeros are real measurements
and the page says so in as many words, rather than letting a reader assume they were tested:

- **No model output has failed schema validation here.** Every draft the proposer and the resolution
  agent have produced has been structurally valid. The refusal path is covered by
  `lib/proposer/validate.test.ts` and `lib/resolution/validate.test.ts` — 51 unit tests between them
  — but never by a row in this database.
- **No person has refused a draft here.** The human gate has been demonstrated by *approving* four
  specifications, never by declining one. The `REJECTED` path is implemented, server-verified and
  signature-checked, and it has not been exercised.

**Update, Phase 8.** A refusal now exists: proposal `b84d3079-57dc-44f9-9252-54ac2f4e92ab`, signed by
`0xa9f68fdf…311ff1` at 04:30 UTC, and `/trust` reads `BY A HUMAN: 1`. **Its recorded reason is the
literal string `test`.** The reason is part of the EIP-191 message that was signed, so it cannot be
edited without invalidating the signature — and retouching it is exactly the kind of thing this
project refuses to do. So the counter is lit by a mechanism test rather than by judgement, and a judge
who clicks it sees `test`.

**The fix is one more refusal, and the queue holds the right candidate** — proposal
`36d5788e-8a9a-465b-b1d9-d487c6507c16`, "Will the stock price of Summit Therapeutics close above
$25.00 on the NASDAQ exchange within 48 hours of the market closing?" It is unresolvable by
construction and there are three independent, checkable reasons to say so, which is exactly what the
human gate is for. The exact wording to paste is in the handoff.

**27. The judge-mode button spends gas from a member's agent wallet.** Each probe is a reverted
`placeBet`, so it stakes nothing and moves no pool — but it does pay for a transaction, roughly
0.0001 tMSTC at this chain's zero base fee and 1 gwei priority. The bounds are a 45-second
module-scope cooldown and `runCapProbe` refusing to run from a wallet that cannot cover
cap + 1 wei + gas. The cooldown is per serverless instance, so the real limit is "a few probes per
cooldown" — acceptable only because the worst case is measured in gas, and because the *actual*
safety is the `eth_call` guard that refuses to broadcast anything the chain does not confirm it will
reject (ADR-062). If agent balances look low before a demo, check `/agents` and top up with
`agents:register`.

**28. Check 3 of the provenance guard proves little on most builds.** *(Still true at v1.0.0, and
`check:render` now has the same shape of caveat — see the `31/35` note in "Phase 12 — what shipped".
A check that skips what it cannot reach must say so, and both of these do.)* It scans prerendered HTML in
`.next/server/app` for a rendered `MOCK` badge, and nearly every route here is `force-dynamic`, so
there is almost nothing prerendered to scan. The script prints a note saying exactly that rather than
reporting a pass it did not earn. Coverage for dynamic pages is the runtime throw, verified by
breaking it on purpose (HTTP 500). Stated because "the CI check passed" should not be read as more
than it is.

**29. `/trust` is the most RPC-heavy page in the app.** `hasRole` × 4 roles × 4 addresses, plus
`paused()` and the `pause()` probe — 18 `eth_call`s per load, batched with `Promise.all` per address.
It rendered comfortably in testing, but it is also the page a judge is most likely to refresh. If it
ever feels slow the clean fix is a multicall, which this contract does not have, so the realistic one
is dropping the agent rows to a single representative wallet. Not done, and not needed at four
addresses.

**30. ✅ CLOSED in Phase 11. `audit_log` records how long a tick took.**

`metadata` on a `pipeline.tick` row now carries `durationMs`, `budgetMs`, the `source` that triggered
the tick, and the full resolution report. `/audit` renders the median duration against the budget,
over serverless ticks only — a CLI tick is given 300s and is round-trip-bound at ~70s, so folding one
into that median would describe neither kind of tick, and a row with no recorded source could be
either, so it is excluded rather than assumed. First rows: 2026-09-30T19:27Z, **21,361 ms and
27,447 ms of a 60,000 ms budget**. ADR-077. The original text follows.

**~~`audit_log` does not record how long a tick took.~~** `metadata` on a `pipeline.tick` row carries
`errors`, `ingest`, `cluster` and `llmCalls` — and not `durationMs`, nor the per-stage timings the
report returns. So the only record of a tick's duration is the HTTP response nobody keeps, which is
why every duration in this file came from a hand-made `curl`. Twenty-two ticks have run and not one of
their durations is stored. Adding `durationMs` to that metadata is a two-line change and was left
alone deliberately in Phase 8 rather than widening the phase; it is the first thing to do if tick
performance is ever questioned.

**31. The `signed by` column costs an `eth_call` per distinct address.** `classifySigners` reads
`hasRole(DEFAULT_ADMIN_ROLE, …)` for each non-browser signer on a market page — two on market 8, one
on most others. That is the right trade (ADR-065: the label must be a chain fact), but `/markets/[id]`
is now the second most RPC-heavy page after `/trust`. There is no cache, deliberately: a stored copy of
"who holds admin" is exactly the thing that could go stale and lie.

**32. Markets #2 and #3 are still unclaimed and `invalidateStale(#2)` was not run.** It remains a
valid spare demonstration — `verify:resolution` confirms the call would succeed from an address with no
role, and #2 holds 0.01 tMSTC that would be refunded. It was skipped because `invalidateStale` is
already on chain once (`0xefe33de2…20f3ca6b`, with its refund claim), so a second one proves nothing new
and spends a real market. Say that if asked why the button was not pressed.

**33. ✅ RESTATED AND CLOSED in Phase 11. The cadence is no longer written down anywhere — with one
arithmetic correction made at v1.0.0.**

Measured with `gh run list` over the 46 hours to 2026-09-30T18:50Z: the heartbeat's `*/5` expression
produced **ten scheduled runs, mean gap 5h07m, range 2h57m–6h44m, 1.8% of the 554 runs requested,
zero failures**. `sync.yml`: seven runs over 29h15m, mean 4h52m, 2.0% of 351.

⚠️ **Phase 11 wrote those two percentages as 1.6% and 1.7%, and they were wrong.** Ten runs over 554
is 1.8%; 1.6% is *nine* over 554, and nine is the number of **gaps between** ten runs. The gap count
is the right divisor for the mean gap — 46h07m49s / 9 = 5h07m32s, which was exact — and the wrong one
for a delivery rate. One correct measurement, used twice, the second time with the first's divisor.
Corrected at v1.0.0 in `README.md`, `heartbeat.yml`, `sync.yml` and here; every measured value (run
counts, spans, mean gaps, ranges, zero failures) re-derived exactly and none of them changed.
ADR-078. This is GitHub throttling
scheduled workflows on a low-activity public repository.

**The repair is not a better sentence — it is not having a sentence.** `/audit` computes the cadence
from `audit_log` on every request and separates cron ticks from prompted ones. Every prose claim was
removed from `README.md`, `ARCHITECTURE.md`, `RUNBOOK.md`, both workflow files, `app/api/tick/route.ts`,
`app/resolve/SettleButton.tsx`, `lib/pipeline/tick.ts` and `lib/resolution/propose.ts` — including
four comments that reasoned from a three-minute tick.

**The expressions changed and that change is claimed nowhere.** `7,37 * * * *` and `19,49 * * * *`:
48 requests a day rather than 288, off the top of the hour that GitHub's documentation names as a
high-load window, sync twelve minutes behind the heartbeat so it indexes rather than races it. **What
that delivers is unmeasured as of this commit and must not be quoted until it has several hours
behind it.** Vercel Cron was rejected: once a day on the Hobby plan. ADR-076. Original text follows.

**~~The pipeline runs roughly every five hours, not every five minutes.~~** `heartbeat.yml` and
`sync.yml` both specify `*/5 * * * *`. GitHub fired the heartbeat at 07:18 and 01:29 on 2026-09-30
and at 22:32 / 18:28 / 12:55 the day before. Every run **succeeded** — this is GitHub throttling
scheduled workflows on a low-activity repository, a documented behaviour of the hosted cron, not a
broken workflow or a failing tick. The consequence is that the system is far less live than the
configuration implies, and **any sentence claiming a five-minute cadence is currently false.**
Phase 11 either moves the schedule somewhere that honours it or restates the claim. Until then,
prefer "runs unattended on a schedule" over any specific number.

**34. ✅ CLOSED in Phase 11 — and it was intermittent, which was worse than recorded.**

This gap said both ticks with a resolvable candidate halted at `examining 0 market(s)`. That was true
when written. A third tick ran at 18:51Z and **succeeded**, so counted from `audit_log` the real
figure is **two of three**. The stage's behaviour depended on how quickly clustering's four model
calls happened to answer — so it looked fine whenever anyone checked it and failed when nobody did.

Fixed by reordering (resolution runs first among the model stages, after ingest so its evidence is
current) and by bounding clustering and the proposer. The ordering argument is the cron, not the
stages: "the next tick picks it up" is worth the cadence, and the cadence is five hours, against a
resolve deadline four hours after close. Verified on production ticks at 19:27:23Z and 19:27:54Z.
ADR-075. Original text follows.

**~~The resolution stage is starved by the deadline ladder, and never reads the market at all.~~**
This is the correction to gap #21 and it is a worse finding than #21 was. `lib/pipeline/tick.ts:111`
gives the resolution stage a deadline at **40% of `maxDuration`** — 24s of 60 — measured absolutely
from the start of the tick. Clustering runs before it and has **no** deadline, only a call budget
(gap #20 flagged exactly this as "still unbounded"). On the 07:18 tick clustering processed 200 items
into 93 events and adjudicated 15/15 borderline pairs, and resolution then logged:

> `resolution halted: out of time for this tick after examining 0 market(s)`

Both ticks that had a resolvable candidate halted this way. The stage is not failing to draft — it
never calls `readMarket` at all, so the chain is never consulted. The mitigation that already exists:
`pnpm --filter web tick` passes 300s rather than 60s, so a locally-run tick gives resolution 120s and
does reach the market. Phase 11 owns the real fix.

**35. ~~There is no `LICENSE` file, and `README.md` says MIT.~~ CLOSED in Phase 9.** `LICENSE` is in
the repository root, MIT, `Copyright (c) 2026 Arunish Rajput`, and `package.json` now declares
`"license": "MIT"` to match. `check:links` verifies the README's link to it resolves on disk.

**36. ~~Two ADRs are both numbered ADR-066.~~ CLOSED in Phase 9.** They are now **ADR-066a** (the
late market notifications) and **ADR-066b** (the keeper invalidating a stale market). ADR-057's
*"superseded by"* pointer names 066b, which is the one that supersedes it, and the four citations in
`lib/resolution/settle.ts` and its test were updated to 066b with them. Renumbering was refused and
the refusal is stated in `DECISIONS.md`'s header: a log that renumbers itself to look tidy is a log
whose citations cannot be trusted.

**37. ⚠️ DOCUMENTED WITH A BOUND in Phase 11, deliberately not tightened. The indexer projection
lags the chain visibly.** *(Re-read on the deployed page at v1.0.0: **no drift is currently
rendered.** `/markets` shows market #11 as `CLOSED` on both sides and the cursor at block 5,847,068
against a chain head of 5,847,543 — the projection had caught up, which is the one-tick bound
behaving as described. The gap stays open because the *mechanism* is unchanged, not because a
disagreement is on screen today.)*

**The bound is one tick**, and the mechanism is structural rather than accidental: `runIndexer` is
step 8 of the tick and settlement — which broadcasts `closeMarket` — is step 9, so a state change
this pipeline causes is indexed on the *following* tick by construction. Reversing the order buys
nothing (the indexer reads only to `head − 3`, and a just-broadcast transaction has one
confirmation) and costs something real (settlement is placed after the indexer precisely so it reads
the freshest projection). Waiting out the confirmation depth inside the tick — the
`runIndexer({ confirmBlock })` path `/api/sync` uses, measured at 7,557 ms — would consume the whole
8-second tail reserve.

**It is a display lag and never a correctness one.** Every figure on a market card comes from
`getMarket()` at the current block (ADR-028); the projection contributes the creating transaction,
the creator and the bet count, and nothing that decides money. The badge names the chain as
authoritative. The bound is now written at the drift computation in `web/lib/markets.ts`. Since the
cron cadence is the bound, `/audit` is where a reader finds out how wide it currently is. ADR-077.
Original text follows.

**~~The indexer projection lags the chain visibly.~~** `/markets` renders *"indexed as OPEN, chain
says CLOSED"* on market #11 and names the chain as authoritative. This is the page behaving correctly
— it reads `getMarket()` per request and only the badge comes from the projection — but a user sees a
disagreement between two of our own numbers. Either tighten the sync or document the expected bound.

**38. `verify:agents` is not read-only, and now says so.** It signs nothing and touches no cap, but
check 5 forces `AGENTS_KILL_SWITCH` on and runs the **real** betting pass, which appends one
`agents.halted` row to `audit_log` with its reason. So every run of the verifier adds a row to the
log it is verifying. The write is correct and stays — a halt is a decision and hard rule #7 logs
decisions, and suppressing it behind a flag would make the check exercise a code path production
never takes (ADR-078). The consequence to know about: **the `agents.halted` count on `/audit` is not
a count of production halts.** Two of the rows there are verifier runs. If that number is ever
quoted, it needs separating by actor the way `cadenceReport` separates ticks by source.
`verify:resolution` has no `insert` at all and is genuinely read-only.

**39. What `7,37 * * * *` and `19,49 * * * *` actually deliver is still unmeasured.** Phase 11
changed the expressions and claimed nothing about them, correctly. Phase 12 could not measure them
either: the Phase 11 commit landed at 2026-09-30T19:34Z and this session ran from 19:53Z, so not one
scheduled slot had come round. The last scheduled heartbeat on record — 18:50:44Z — is still an old
`*/5` run. `/audit` withholds the figure rather than inventing one (*"no cron tick(s) recorded so
far, of 2 with a known trigger — needs two to measure a gap"*), and nothing in the repository claims
anything about the new cadence, so nothing is false. **To close this:** `gh run list
--workflow=heartbeat.yml --limit 100`, compute the mean gap over the runs since 19:34Z, and divide
**runs** by requests — 48 a day, not 288. Record it in `heartbeat.yml`'s header comment where the old
measurement lives.

**40. Four real markets close within three hours of this release, and none has been resolved from
live news yet — and the one market already past close is unresolvable by construction.**

**Market #11 is not a coverage-floor problem, or not only one.** It asks whether a stock closes above
a price *"within 48 hours of the market closing"*, so its answer does not exist until after its own
resolve deadline (2026-10-01 02:18 UTC) has passed. The model drafted it and the human approved it —
and gap #26 had already named that same proposal as the clean candidate for a *refusal*. No retrieval
improvement settles it. The contract handles it correctly regardless: it goes stale and
permissionless `invalidateStale` refunds the 0.004 tMSTC. **So "the resolution stage has never
drafted an outcome" currently has two causes, and they need separating** — one market that cannot be
resolved by anyone, and a coverage floor that has never been tested on an article reporting an
outcome. Markets #4–#7 and #9 are the first candidates that can distinguish them. The README now
states both. At 2026-09-30T19:53Z: #4 and #5 close at 22:12:06Z, #6 and #7 at 22:12:51Z, #9 at
23:43:17Z — the first time more than one human-approved market will be past close at once. The
resolution stage is fixed and proven to examine a candidate (gap #21), but it has never had more than
one, and market #11's outcome is undraftable for want of evidence clearing the coverage floor (gap
#22). **The first session after this release should look at `/resolve` and `/audit` before anything
else**: either the stage drafts its first real outcome, or gap #22 gets its second data point and the
coverage floor needs the recalibration that gap says it might.

## Discord notifications were arriving up to 50 minutes late — fixed 2026-09-29

**Root cause was arithmetic, not scheduling.** `recordApproval` already ran indexer + notifier
inline. It could never work: `runIntentWorker` returns after **1** confirmation, `runIndexer` reads
only to `head - 3`. The inline pass sat three blocks below its own market's log, every time.
Cursor after market #10's approval pass: **5,801,448**. Market #10 was mined in **5,801,451**.

**Measured delays** (from `notifications` and `audit_log`, not inferred):
market #10 approved `05:26:50Z` → announced `06:11:19Z` = **44m29s**;
market #9 approved `04:29:31Z` → announced `05:19:15Z` = **49m44s**.

**The cron is not a five-minute heartbeat and never was.** `heartbeat.yml` schedules `*/5`; GitHub
delivered **3 runs in 14 hours** (20:42Z, 00:36Z, 06:10Z on 2026-09-28/29). Verified with
`gh run list --workflow=heartbeat.yml`. The README claimed five minutes; corrected.

**What shipped:** `wouldIndex`/`confirmationHorizon` exported and table-tested
(`lib/indexer/confirm.test.ts`, 8 tests); `runIndexer({ confirmBlock })` waits out the depth
(bounded 20s, measured **7,557ms** against the live chain); `lib/pipeline/sync.ts` pairs
indexer→notifier; `POST /api/sync` (`CRON_SECRET`, falling back to `TICK_SECRET`);
`syncAfterApproval` fired from `/review` with `void`, with `maxDuration = 60` on the segment so the
wait is not killed by the platform's 10s default; `.github/workflows/sync.yml` as the backstop.
ADR-066 has the full reasoning.

**Do not "fix" this by lowering `DEFAULT_CONFIRMATIONS`.** The confirmation depth is what the
notifier means by "confirmed" — `announceable()` selects on columns only the indexer writes from a
confirmed log. Lowering it trades the exit criterion for 7 seconds.

**Still open:** nothing makes GitHub honour a `*/5`. Delivery is the request that caused the market;
the cron repairs misses in hours. If a notification is ever missing, run the `Chain sync` workflow
from the Actions tab — RUNBOOK §"Notifications are not delivered by the cron".

## After v1.0.0 — the closing summary

**The twelve phases are done and the build is released.** There is no "next phase". This section
replaces the per-phase handoff with what a future session — or a stranger, or the owner in six
months — needs in order to pick this up.

### What this is

A Polymarket-style prediction platform on MST Blockchain Testnet where **markets are created under
human authority and members bet through constrained AI agents.** The thesis is one line: **AI
proposes, humans and the chain decide.** Nothing moves money or reaches a member without passing a
human gate and an on-chain limit.

Live at **https://auspex-web-mu.vercel.app**, contract
**`0xc4743d6295311AFead12161881Bfcf601B70104C`** on chain `91562037`, source verified on
`https://testnet.mstscan.com`.

### What it does

The thin real loop, all of it running on a live chain:

1. **Ingest** eight news feeds; deduplicate deterministically.
2. **Confirm** a story only when two *independent* publisher domains report it.
3. **Propose** a market specification with an LLM — schema-constrained at the API and re-validated
   with Zod, with the news text delimited inside `<untrusted_content>` and never in a system
   instruction.
4. **Gate it on a human.** `/review` presents the draft as a checklist; `createMarket` is signed in a
   browser by `0xA9F68fDf…311fF1`, a wallet whose key no server holds.
5. **Research and bet** through member agents. A deterministic policy gate decides every bet; the
   model only ever proposes. The contract caps each agent per transaction and per market, and
   `claim()` pays the registered *owner*, not the agent.
6. **Resolve** with an on-chain evidence URL, human-signed, inside a challengeable window;
   `finalizeResolution` and `invalidateStale` are permissionless, so a market nobody resolves is
   refunded rather than stuck.
7. **Log every decision with its reason** — approved and refused alike. The refusals are the half
   worth reading.

Eight routes serve it, every number on them labelled with where it came from by `<Provenance>`.

### What it does not do

**Read `README.md` → Limitations for the full list, stated plainly.** The four that matter most:

- **Resolution is trusted, by design.** A small authorised set submits outcomes. The challenge
  window, permissionless finalisation and permissionless invalidation bound what one bad resolver can
  do, but **this is not a decentralised oracle**, and the market creator and the resolver are
  currently the same wallet (gap #2b).
- **No outcome has been drafted from live news yet.** The stage is fixed and examines candidates; the
  retrieval coverage floor is what stops it, and the floor was calibrated on articles about the same
  *story* rather than articles reporting an *outcome* (gap #22). This is the product's last unproven
  claim, and gap #40 says when to look.
- **Two of the four refusal layers are thin on live data.** Schema rejection has never fired here;
  the human gate has nine approvals and one refusal, and that refusal's signed reason is the literal
  string `test` (gap #26).
- **The pipeline is far less live than it looks.** GitHub throttles scheduled workflows on a
  low-activity public repository, and what the current expressions deliver is unmeasured (gap #39).
  Nothing user-facing depends on the cron.

**Nothing here is audited, and tMSTC has no value.**

### Where the history lives

| File | What it holds |
|:--|:--|
| `CHANGELOG.md` | the release, and each phase in one paragraph |
| `docs/BUILD_RECORD.md` | **read this first** if the build record's existence puzzles you — it says why none of it was tidied |
| `docs/DECISIONS.md` | 79 ADRs: what was decided, why, what it cost, the evidence |
| `PROGRESS.md` (this file) | per-phase detail, every real artifact, and the forty known gaps |
| `docs/BUILD_PLAN.md` | the twelve phases as they were planned, with exit criteria |

**Part II's governing rule was: the framing goes, every fact stays.** No address, hash, measurement
or limitation was ever changed to look better. Every defect this build hit is recorded here with what it
cost, and that record is the evidence behind every trust claim the product makes. ADR-068 is the
argument for keeping it, and it is the thing to re-read if deleting any of it starts to feel like
tidying.

### If you are picking this up to change something

1. **Read the chain before trusting this file.** `pnpm --filter web verify:resolution` prints every
   market's state in about forty seconds and writes nothing. Six sessions running, the live system
   moved while nobody was looking.
2. **Then look at `/audit` and `/resolve`.** Gap #40: four real markets closed within hours of this
   release, and that is the resolution stage's first real test.
3. **Run `pnpm preflight`.** Eleven checks; it tells you which external dependency has drifted before
   you waste an hour on it.
4. **Read the rendered page, not the JSX.** Nine defects in this project were invisible in source and
   obvious in one look at the served output.

### What the sweep found that is worth generalising

**A claim can rot without anybody editing it.** All four defects Phase 12 found were sentences that
were *true in the commit that wrote them*: `verify:agents` was read-only until check 5 was added,
the README's resolution paragraph was accurate until Phase 11 fixed the defect it described, the
delivery percentage was one correct measurement divided by the wrong one of its own two counts, and
the table count was right until Phase 6 added a table. No per-phase check catches this class, because
each statement passes review in its own diff. **The only thing that catches it is reading the whole
repository against one day's live system** — which is what a release is for, and is the argument for
doing another sweep before any future release rather than trusting the accumulated notes.

### The trap Phase 11 added to the list, still true

**A count on a live page must say *which* things it counted.** The cadence panel's first version
averaged every tick row and reported **84 minutes** for a system whose unattended cadence is five
hours — because `audit_log` holds button presses and CLI runs alongside cron ticks. Correct arithmetic
over the wrong population, invisible in the source, obvious in one look at the served page. That was
the **ninth** defect in this project with exactly that shape.

**Gap #38 is the same trap one level down:** `agents.halted` on `/audit` counts verifier runs beside
production halts. If that number is ever put in prose, separate it by actor first.

**`*/5` inside a `/** */` block comment terminates the comment.** Cost ten minutes and four
nonsensical TypeScript errors (`TS1443`). Write it as prose or in single-line comments.

### What Phase 11 changed, which is still the newest code in the tick

- **The tick's stage order.** Resolution runs before clustering and the proposer. If clustering does
  less on some ticks, that is the ladder working, not a regression — the report says `out of time for
  this tick` and names how much it left.
- **`stageDeadlines` is exported and pure, and its tests are load-bearing.** Six of the seven fail
  if the old fractions come back. Do not "simplify" the clamp away: it is what stops a 22s model
  call starting at 37.9s of a 60s budget and killing the tick before its audit row is written.
- **A metadata shape on `pipeline.tick` rows:** `durationMs`, `budgetMs`, `source`, `resolution`.
  Rows before 2026-09-30T19:27Z have none of them, and `cadenceReport` counts them separately rather
  than assuming — keep that property if you touch it.
- **`TickSource` is mapped through an allowlist in the route.** A caller cannot write its own label
  onto the page. If you add a caller, add it to `triggerSource` and to `TickSource`, and remember
  that anything unrecognised is `api` on purpose.

### What Phase 10 changed — still true, still worth knowing

- **There is a component layer now: `web/components/ui/`.** 27 exports, 883 lines, one barrel.
  Before adding markup to a page, look there — `Card`, `CardHead`, `CardBody`, `CardFoot`, `Badge`,
  `Callout`, `Stat`, `StatGrid`, `Counter`, `Field`, `Row`, `SpecRow`, `FieldBlock`, `EmptyState`,
  `PageShell`, `PageHeader`, `SectionLabel`, `Section`, `ExtLink`, `TxLink`, `AddressLink`, `Mono`.
  Twenty-four copy-pasted helpers were removed to build it; do not start a twenty-fifth.
- **`components/ui/tone.ts` is the only place that decides what a trust claim looks like.** It was
  six places. If you need a colour for a state, map it to a `Tone` and let the registry draw it.
  **Never write `text-bad-500` at a call site for something that is not a refusal** — ADR-073 is
  what that mistake cost last time.
- **`TxLink` and `AddressLink` take the full value and shorten it themselves.** Do not hand-write an
  abbreviation; four of the first twenty-seven in the README were wrong.
- **Two new checks exist and both must keep passing:** `check:contrast` and `check:render`.

### Nothing is waiting on the user

Phase 11 needed no wallet and no signature, and used none. Phase 12 needs none either until the
final deploy — the only human-signed action still available is the optional second refusal in
`/review` (gap #26), which is **not** on any critical path.

**One optional item, if `check:render` is wanted in Phase 12:** run `npx playwright install
chromium` once. The script is written to decline rather than fail without it, and Phase 11 verified
the same properties by hand instead.

### Measured state, 2026-09-30T19:55Z at v1.0.0

**Read against the chain, the database and the deployed site this session**, not carried forward.
**Phase 12 wrote nothing to the chain**: no market, no bet, no resolution, no transaction of any
kind. Off chain it wrote two `agents.halted` rows — one per `verify:agents` run, which is gap #38 —
and nothing else.

| | Live |
|:--|:--|
| Markets on chain | **13**, unchanged since Phase 10 |
| States | #1–3 `INVALIDATED` · #4–7, 9, 10, 12, 13 `OPEN` · #8 `FINALIZED`/`NO` · #11 `CLOSED`/`UNRESOLVED` |
| Past close, awaiting an outcome | **#11** only — `proposeResolution(#11)` as the resolver *would succeed*, verified by `eth_call` |
| Closing within 4 hours of release | **#4, #5** 22:12:06Z · **#6, #7** 22:12:51Z · **#9** 23:43:17Z — gap #40 |
| Block at verification | 5,847,571 (`verify:resolution`), head 5,847,543 (`preflight`) |
| Indexer cursor | block **5,847,068**, 47 logs stored — **no drift rendered on `/markets`** |
| `audit_log` rows | **443** at the `/audit` read, every one carrying a reason |
| Tests | **498** (441 web · 57 contracts); clean clone 431 passed, 10 skipped |
| Wallets | deployer 9.7449 tMSTC · human authority 50.0125 · atlas 0.0517 · kestrel 0.0799 · vega 0.0799 |
| Tick duration, from `audit_log` | median **24.4s** of 2 recorded, worst 27.4s, budget 60.0s |
| Cron cadence, unattended | **honestly withheld** — 0 cron ticks recorded since Phase 11's change, needs 2 to measure a gap (gap #39) |
| ADRs | **79** |
| Version | **1.0.0** across root, `web`, `contracts`, `video` |

**All eight routes 200 on the deployed URL** and were read as rendered pages, not inferred from the
build — see "Phase 12 — what shipped".

### Superseded — the Phase 11 snapshot, kept for the record

**Read against the chain and the database this session**, not carried forward. Phase 11 wrote
nothing to the chain: no market, no bet, no resolution, no transaction of any kind. It wrote three
`pipeline.tick` rows (one local, two production) and whatever those ticks' own stages queued, which
was one proposal for the review queue and nothing on chain.

| | Live |
|:--|:--|
| Markets on chain | **13**, unchanged |
| States | #1–3 `INVALIDATED` · #4–7, 9, 10, 12, 13 `OPEN` · #8 `FINALIZED`/`NO` · #11 `CLOSED`/`UNRESOLVED` |
| Past close, awaiting an outcome | **#11** — `proposeResolution(#11)` as the resolver *would succeed*, verified by `eth_call` |
| Block at verification | 5,846,492 |
| `audit_log` rows | **442**, every one carrying a reason |
| Tests | **498** (441 web · 57 contracts) |
| Cron cadence, heartbeat | mean **5h07m** over 46h07m, 10 runs, 0 failures, ~~1.6%~~ **1.8%** of requested (gap #33) |
| Last production tick | 21,361 ms of a 60,000 ms budget, 0 stage errors, 4 of 10 LLM calls |

**Market #11 is examined but undraftable, and that is gap #22, not a bug.** Both production ticks
read it from the chain and reported `1 with no evidence to read` — no ingested article clears
`MIN_QUESTION_COVERAGE`. The resolution stage is working; the coverage floor was calibrated on
articles about the same *story*, never on articles reporting an *outcome*, and this is the first
market to test that distinction.

### Superseded — the Phase 10 snapshot, kept for the record

| | Live |
|:--|:--|
| Markets on chain | **13** |
| Created by the human wallet `0xA9F68fDf…311fF1` | **9** — #4, 5, 6, 7, 9, 10, 11, 12, 13 |
| Created by the operator `0xc71dC478…4ad24` | **4** — #1, 2 (Phase 1 smoke, **not** self-labelled), #3 and #8 (self-labelled) |
| States | #1–3 `INVALIDATED` · #4–7, 9, 10, 12, 13 `OPEN` · #8 `FINALIZED`/`NO` · #11 `CLOSED`/`UNRESOLVED` |
| Past close, awaiting an outcome | **#11** — resolve deadline 2026-10-01 02:18 UTC |
| Indexer cursor | block **5,840,427**, 47 logs stored |
| `audit_log` rows | **424**, every one carrying a reason |
| Cap probes in `audit_log` | **6** |
| Tests | **486** (429 web · 57 contracts) |

### The palette, and the two things about it that are not obvious

**Token names were kept and values inverted.** `bg-ink-950` is now the *lightest* surface and
`text-ink-100` the *darkest* text. The number means "distance from the reader's eye", not
brightness. This is why 1,054 call sites needed no edit. Read the header comment in
`app/globals.css` before changing any of it.

**The five tones sit on a deliberate luminance ladder and the order is not arbitrary.** bad (5.6:1)
→ signal (6.7) → warn (8.1) → ok (9.7) → human (11.6), lightest to darkest. That sequence is an
*alternating walk around the five-cycle of pairs that collapse under colour blindness*. Re-ordering
them to something more intuitive will silently reintroduce a ΔE-3 collision. `check:contrast` will
catch it; the header comment in `scripts/check-contrast.mjs` explains why.

**A Tailwind v4 token that is not in `@theme` produces no CSS and no warning** (ADR-064). This bit
again this phase in advance: `signal-400` was dropped from the theme, and its four call sites had to
be found and changed or they would have rendered at their inherited colour. Check the *built*
stylesheet: `grep -o "color-ink-500" .next/static/chunks/*.css`.

### The traps, carried forward because they keep firing

**Read the chain before you trust this file.** Four sessions in a row, the live system moved while
nobody was looking — the cron runs unattended and the owner clicks things. Phase 8 found three
transactions and a human refusal this file did not record; Phase 8's successor found four more
markets; Phase 9 found that a sentence about which markets self-label had been wrong the whole time.

**Read the rendered page, not the JSX.** **Ten** defects in this project have been invisible in
source and obvious in one look at the served output.

- **The tenth was Phase 12's**, and it was a *sentence* rather than a pixel: `/audit`'s action
  histogram showed an `agents.halted` row timestamped inside the minute `verify:agents` had just
  run — which is how a script that has printed *"nothing was written"* since Phase 5 was caught
  writing a row. Nothing in the script's source says so; you have to follow `runAgentPass` two files
  down. One look at the log it appends to says it immediately. Gap #38, ADR-078.
- **The ninth was Phase 11's**: the cadence panel averaging cron ticks with button presses and
  reporting 84 minutes for a five-hour cadence.
- **The eighth was Phase 10's**: `Pool NO` rendered in the refusal colour on every market card,
  three feet from an `INVALIDATED` badge meaning something else entirely. It had been in the code
  since Phase 2 and the dark theme hid it.

`curl` the built page and read the prose; *look* at it, because two of the ten were only visible as
colour; and **read the pages that record what your own commands did**, because that is where the
tenth was hiding.

**Prose beside data has to be derived from that data.** Five times now: ADR-065, ADR-067, the
`/markets/8` caption, `/markets`'s id-range footer (ADR-070), and the landing page's build roadmap.
Every one of them was a sentence written once and printed beside rows that later disagreed with it.
`pnpm check:links` is the guard for the README — run it, and do not weaken it to make a sentence pass.

**A count on a live page is a sentence that will go stale.** Phase 9 nearly shipped "seventy-one
architecture decision records" onto the landing page, which would have been wrong at the next ADR.
Numbers on a page come from a query or they do not go on the page.

### Do not rebuild any of this

**`README.md` was rewritten in Phase 9 and is now product-shaped.** Do not add a tally to it: every
number that moves is a pointer to `/trust`, because a count in a README is stale the moment the
pipeline runs again. The 60-second self-check, the two evidence tables and the Limitations section
survive intact in substance; only the reader they address changed.

**`/markets/[id]`'s footer is computed, not written.** If you find yourself wanting to write a sentence
about who signed what, put it in `lifecycleClaim` in `lib/trust/signers.ts` and test it. ADR-065 is the
third time this project has learned that prose beside data has to be derived from that data. Phase 10
redesigns that page; the sentence must stay derived.

**The four verification commands are load-bearing and cheap.** `preflight`, `check:links`,
`check:provenance`, `verify:resolution`. Part II should be adding to them, never relaxing one to let
a new sentence or a new colour pass.

### The role facts to re-read before describing the system to anyone

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
| Labelling where a number came from | `<Provenance origin="…">` from `@/components/Provenance` | six origins, each a different trust claim — read the file header |
| The refusal counters | `trustCounters()` from `@/lib/trust/counters` | one `Promise.all`; the gate histogram unnests `reasons` in Postgres |
| Whether an address holds a role | `hasRole()` / `roleReport()` from `@/lib/trust/roles` | live `eth_call`; there is deliberately no stored copy |
| A real transaction on demand, that always reverts | `runCapProbe()` from `@/lib/probe/capProbe` | refuses to broadcast unless an `eth_call` confirms the chain will reject it |
| Navigation on a new page | `<SiteNav current="/your-route" />` | server component; add the route to `ROUTES` |

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

**Renamed in Phase 9 — the old names are gone, not aliased:**

```bash
pnpm --filter web probe:cap    # was judge:probe.  scripts/cap-probe.ts, lib/probe/capProbe.ts
```

`lib/judge/` no longer exists. `JudgeButton` is `CapProbeButton`, `judgeProbes()` is `capProbes()`,
`JudgeProbeRow` is `CapProbeRow`, `JudgeProbeResponse` is `CapProbeResponse`. The three **stored**
strings are unchanged on purpose and must stay that way: `audit_log.action = 'judge.cap_probe'`, the
actor prefix `judge-mode:`, the intent key prefix `judge:cap-probe:`. ADR-069.

**Commands added in Phase 8:**

```bash
pnpm check:links                      # every hash, abbreviation, SENDER and URL in README.md, against the live chain
node scripts/check-links.mjs docs/WALKTHROUGH.md   # the same, for the walkthrough
```

`check:links` is the one to run before recording anything. Check 2b — that a table crediting a
transaction to an address names the address that actually signed it — is the one that earned its
keep: it caught three wrong attributions in a README draft written the same hour, and it was proved to
fail by reintroducing one on purpose.

**Commands added in Phase 7:**

```bash
pnpm --filter web check:provenance    # the mock-data guard. Run it AFTER a build — check 3 reads .next
pnpm --filter web probe:cap           # the cap probe from the terminal. Produces a REAL reverted tx.
```

**Things that will cost you an hour if you rediscover them — Phase 8's:**

- **`onchain_intents.signer` is not a trust classification.** `SERVER` covers a capped agent key *and*
  the admin key. Rendering both the same way told a reader the deployment holds an admin key. Classify
  by `hasRole`, never by the enum. ADR-065.
- **A caption beside a table must be computed from that table.** The one on `/markets/8` was written
  once, was true of five markets, and was false on the one it was printed on.
- **`audit_log.metadata` has no `durationMs`.** Every tick duration in this file came from a hand-made
  `curl`; nothing is stored. Gap #30.
- **The `audit_log` table's column is `metadata`, not `detail`**, and `events`/`proposals`/
  `agent_decisions` use `status`, not `state`. Publisher domains live on `sources`, not `raw_items`.
  Four wasted queries; the schema is the answer, not the guess.
- **Abbreviating a hash by hand is a reliable way to introduce an error.** Four of the first twenty-seven
  abbreviations in the README were wrong. `check:links` now checks prefix *and* suffix.

**Things that will cost you an hour if you rediscover them — Phase 7's:**

- **A Tailwind v4 token that is not in `@theme` produces no CSS and no warning.** Two were used sixty
  times and did nothing. Check the *built* stylesheet, not the source: `grep -c "text-ink-500"
  .next/static/chunks/*.css`.
- **A page that renders `<Provenance origin="MOCK">` in production throws.** That is deliberate and it
  is the backstop behind the CI check — if a page 500s with "Refusing to render", that is the rule
  working, not a bug. Run `check:provenance` to find the call site.
- **Do not try to grep bundles for the forbidden origin.** `Provenance.tsx` contains the string by
  necessity, so it is in every bundle. Only *rendered output* can tell a call site from the component's
  own branch. ADR-061.
- **Test an error state by causing the error, not by reading the branch.** Pointing `DATABASE_URL` at
  a dead port and running the built app found a real honesty defect on `/agents` in thirty seconds.
- **Look at the page at 390px.** The role matrix was a scrollable table whose every payload column
  started off-screen. Judges use phones; the source cannot tell you this.
- **`page.tsx` may not export arbitrary values.** A stray `export type` from a route file fails the
  build with an invalid-export error.

**Commands added in Phase 6:**

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
