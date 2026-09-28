# PROGRESS.md — AuspeX build state

> **This file is the handoff between sessions.** A new session reads this first and continues from
> "Next phase". It is updated at the end of every phase, before the commit. If it is stale, the next
> session starts blind.
>
> Session protocol and hard rules live in `CLAUDE.md`. Phase tasks and exit criteria live in
> `docs/BUILD_PLAN.md`. Manual setup state lives in `docs/RUNBOOK.md`.

**Last updated:** 2026-09-29
**Current status:** ✅ Phase 3 complete
**Next phase:** **Phase 4 — Market proposer agent + human approval gate**

---

## Phase status

| Phase | Name | Status |
|:--|:--|:--|
| 0 | Foundations & rails | ✅ Complete |
| 1 | Smart contract — build, test, deploy, verify | ✅ Complete |
| 2 | Data layer + chain client + idempotency engine | ✅ Complete |
| 3 | News ingestion, dedup, 2-source confirmation | ✅ Complete |
| 4 | Market proposer agent + human approval gate | ⬜ **NEXT** |
| 5 | Member agents + deterministic policy gate | ⬜ Not started |
| 6 | Resolution, challenge window, payout | ⬜ Not started |
| 7 | Dashboard polish + trust page | ⬜ Not started |
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
| `createMarket` tx (human-approved) | _n/a_ | ⬜ Phase 4 |
| `placeBet` tx (agent, within caps) | _n/a_ | ⬜ Phase 5 |
| Over-cap bet tx (**expected revert**) | _n/a_ | ⬜ Phase 5 |
| Resolution tx (with evidence URL) | _n/a_ | ⬜ Phase 6 |
| Payout / claim tx | _n/a_ | ⬜ Phase 6 |

**Three markets exist on-chain (ids 1, 2, 3).** 1 and 2 are the Phase 1 smoke-test runs; 3 is the
Phase 2 idempotency crash test. All three say what they are in their own on-chain question text,
and `/markets` repeats it in the footer. None is presented anywhere as a product market. MSTScan
decodes their method names (`createMarket`, `placeBet`) because the source is verified.

**Also on chain, no longer in the repo:** `Ping` at `0x540d73793f5AA5E605A0243EA3DfCF106D6558D8`
(verified). It was the Phase 0 toolchain probe used to prove the deploy→verify pipeline works before
`AuspexMarket` existed. Deleted from the repo per `docs/BUILD_PLAN.md`; it is claimed nowhere.

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
| §5 | **BridgeKey install + fund that address** | Phase 4 approvals | ⬜ **the only open item** |
| §8 | Secrets into Vercel + GitHub | Phase 3 in production | ✅ **done this session** |

**§1 was never a billing wall.** The 402 body says `Your prepayment credits are depleted` — that
is *project-scoped* prepay exhaustion. A key in a project with no billing account attached uses
the free tier and works. No card was added. `pnpm preflight` is 9/9.

**§8 is done.** Pushed to Vercel (production + preview): `GEMINI_API_KEY`, `TICK_SECRET`,
`AGENT_KEY_ENC_SECRET`, `DISCORD_WEBHOOK_URL`, `GEMINI_MODELS_FAST`, `GEMINI_MODELS_SMART`,
`GEMINI_TIMEOUT_MS`. Pushed to GitHub Actions: `TICK_SECRET`, `TICK_URL`. So the heartbeat and
`POST /api/tick` now work on the deployed site.

**`DEPLOYER_PRIVATE_KEY` was deliberately NOT pushed to Vercel.** Nothing in the deployed app
signs a transaction yet — the indexer only reads. Phase 5 is when that changes, and it should be
a conscious decision then rather than a key sitting in production for two phases first.

**§5 is yours and it is the only thing left.** Phase 4's human gate signs `createMarket` from
BridgeKey, so that wallet must exist and hold tMSTC. Claude will not create a wallet or handle a
seed phrase. RUNBOOK §5 has the network values; the faucet has a reCAPTCHA.

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

---

## Known gaps

**1. ~~Gemini unusable.~~** ✅ **Closed.** Free tier, no billing. See above and RUNBOOK §1.

**2. Resolution is trusted, by design.** A small set of authorised resolvers submits outcomes with
an evidence URL. The challenge window, permissionless `finalizeResolution` and permissionless
`invalidateStale` bound what one bad or absent resolver can do — but this is **not** a
decentralised oracle. This belongs in the README verbatim.

**3. The 120s challenge window is demo-scale.** Immutable, so it is honest and unchangeable
rather than quietly tunable. Say so in the README.

**4. ~~`lib/contract.ts` hand-writes ABI fragments.~~** ✅ Closed in Phase 2.

**5. The DB test suite does not run in CI.** `schema.test.ts` creates and drops a real database on
Neon and this repo is public, so the credential is deliberately not a CI secret. CI runs the 133
pure tests; the DB suite skips with a loud warning. Run locally before any schema change — this
session: **9/9 against a fresh database**.

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

## What the next session needs to know

**Start Phase 4: market proposer agent + human approval gate.** Read `docs/BUILD_PLAN.md` Phase 4.
There are **3 `CONFIRMED` events sitting in the database right now**, which is exactly the input
Phase 4 consumes. `proposals` is migrated and empty.

**Everything Phase 3 built is available and tested. Do not rebuild any of it.**

| You need | Use | Notes |
|:--|:--|:--|
| Confirmed events to propose on | `events` where `status = 'CONFIRMED'` | 3 waiting |
| Calling a model safely | `callJson()` from `@/lib/llm/client` | never throws; returns a union |
| Delimiting untrusted text | `buildUserMessage()` from `@/lib/llm/prompt` | **mandatory** — hard rule #4 |
| A per-tick call budget | `new LlmBudget(n)` | pass it in; never a module global |
| Injection flags for an item | `raw_items.injection_flags` | already populated |
| Adding a stage to the tick | `lib/pipeline/tick.ts` → `stage()` | wrap it, so a failure is recorded not thrown |
| Writing to chain | `createIntent()` + `runIntentWorker()` | nothing else may broadcast |
| Spec hashing | `computeSpecHash()` from `@/lib/chain/spec` | Phase 4 needs this |

**The Phase 4 proposer is the same shape as `lib/news/adjudicate.ts`.** Read it first — it is the
worked example of the whole pattern: trusted system instruction, untrusted text sealed in a
user message, `ResponseSchema` at the API, Zod re-validation, and **a check that the model's
output refers to something we actually sent** (it discards any `pairLabel` we did not issue).
That last check is the one the API-side schema cannot do, and Phase 4's `SCHEMA_REJECTED` rows
are supposed to be exactly this.

**Commands added this phase:**

```bash
pnpm --filter web tick              # one full tick, verbose report
pnpm --filter web tick --no-index   # news stages only (faster to iterate)
pnpm --filter web calibrate         # re-read the similarity distribution from live feeds
```

**Things that will cost you an hour if you rediscover them:**

- **Read the whole error body before believing a status code.** Two sessions recorded Gemini as
  needing a credit card on the strength of `402`. The body said *prepayment credits depleted* —
  project-scoped, fixed with a new key in a project that has no billing account.
- **A tick is round-trip-bound, not CPU-bound.** 19,900 similarity comparisons take under 20ms;
  400 sequential Neon round trips take 400 seconds. Batch writes, and never put a query inside a
  per-row loop. ADR-033.
- **Next 16 writes `web/AGENTS.md` and `web/CLAUDE.md` on every `next dev`.** The generated
  `CLAUDE.md` would sit below the repo-root one that carries the session protocol. Disabled with
  `agentRules: false` in `next.config.mjs` — do not remove it.
- **`turbopackIgnore` on `lib/env.ts`'s `fs` calls is load-bearing for deploy size.** Without it
  Turbopack traces the entire project into the serverless bundle.
- **Thresholds in `similarity.ts` are empirical.** If you change the feed list, re-run
  `pnpm --filter web calibrate` — they are only as good as the distribution they came from.
- **`scanForInjection(title, body)` takes two arguments now**, not a spread. Some signatures are
  headline-scoped.
- **Google News entity-encodes its HTML**, so `cleanText` strips tags, decodes, then strips again.
  Removing either pass puts raw markup in the database and in the prompt.
- **Postgres cannot `ON CONFLICT` against a row in its own `VALUES` list** — it raises "cannot
  affect row a second time". De-duplicate a batch in memory first; Google News returns the same
  story under two topic queries routinely.

**Still true from earlier phases:**

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
