# PROGRESS.md — AuspeX build state

> **This file is the handoff between sessions.** A new session reads this first and continues from
> "Next phase". It is updated at the end of every phase, before the commit. If it is stale, the next
> session starts blind.
>
> Session protocol and hard rules live in `CLAUDE.md`. Phase tasks and exit criteria live in
> `docs/BUILD_PLAN.md`. Manual setup state lives in `docs/RUNBOOK.md`.

**Last updated:** 2026-09-28
**Current status:** ✅ Phase 2 complete
**Next phase:** **Phase 3 — News ingestion, dedup, 2-source confirmation**

---

## Phase status

| Phase | Name | Status |
|:--|:--|:--|
| 0 | Foundations & rails | ✅ Complete |
| 1 | Smart contract — build, test, deploy, verify | ✅ Complete |
| 2 | Data layer + chain client + idempotency engine | ✅ Complete |
| 3 | News ingestion, dedup, 2-source confirmation | ⬜ **NEXT** |
| 4 | Market proposer agent + human approval gate | ⬜ Not started |
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
| §1 | **Enable Gemini billing** | Phases 3–5 | ⬜ **the one real blocker** — fails `402` on every model |
| §3 | Neon Postgres | Phase 2 | ✅ **done** — credentials in root `.env.local`, 14 tables migrated |
| §4 | Discord webhook | Phase 4 notifications | ✅ **done** |
| §5 | BridgeKey install + seed phrase | Phase 4 approvals | ⬜ needed by Phase 4, not Phase 3 |

**§3 is resolved, and how matters.** The previous session left `vercel env pull` as a manual step.
It does not work: the Neon integration marks its variables **sensitive**, so Vercel can never
decrypt them again and the pull writes the literal string `"[SENSITIVE]"` while reporting success.
The credentials came from `neonctl` instead (RUNBOOK §3 has the exact commands), and
`pnpm preflight` now **actually connects** rather than checking the variable is merely set —
which is the check that would have caught this immediately.

**Needed before Phase 3 ships to production, not before it is built:** `TICK_SECRET`,
`GEMINI_API_KEY` and `AGENT_KEY_ENC_SECRET` exist in the root `.env.local` but are **not set in
Vercel** (`vercel env ls` shows only the Neon variables and the contract address). `POST /api/index`
and `/api/tick` will return `503` on the deployed site until they are. That is deliberate — the
route refuses to run unauthenticated rather than defaulting to open.

---

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

---

## Known gaps

**1. Gemini still unusable — and the failure mode changed.** It now returns **HTTP 402** for every
model (`gemini-3.5-flash-lite`, `gemini-3.1-flash-lite`, `gemini-flash-lite-latest`), where Phase 0
saw `503` capacity errors. 402 is a billing response, so RUNBOOK §1 is now the definitive fix rather
than a hopeful one. Blocks Phases 3–5. The fail-safe path handles it (no action, log, continue), but
a demo with no AI output is a bad demo.

**2. Resolution is trusted, by design.** A small set of authorised resolvers submits outcomes with an
evidence URL. The challenge window, permissionless `finalizeResolution` and permissionless
`invalidateStale` bound what one bad or absent resolver can do — but this is **not** a decentralised
oracle. This belongs in the README verbatim; claiming otherwise is the one thing that could
genuinely sink the submission.

**3. The 120s challenge window is demo-scale, not production-scale.** Immutable, so it is honest and
unchangeable rather than quietly tunable. Say so in the README.

**4. ~~`web/lib/contract.ts` hand-writes two ABI fragments.~~** ✅ **Closed in Phase 2.** The file is
deleted; `lib/chain/deployment.ts` reads the committed deploy record and is the only ABI source.

**5. The DB test suite does not run in CI.** `web/lib/db/schema.test.ts` creates and drops a real
database on Neon, and this repository is public, so the credential is deliberately not a CI secret.
CI runs the 28 pure tests and the suite skips with a loud warning. It is run locally before any
schema change — this session's run: **9/9 passing against a fresh database**. The honest framing is
that CI proves the *logic*, and a local run proves the *migrations*.

**6. Re-org handling is a confirmation depth (3 blocks) and nothing more.** On a 3-second-block
testnet that is a reasonable trade; it is not mainnet-grade, and `docs/ARCHITECTURE.md` §11 says so.
A deep re-org would leave `chain_events` holding orphaned logs, which the projection would still
fold in. `/markets` reads pools from the contract rather than the projection partly for this reason.

**7. Indexing is ~9 seconds per pass, dominated by network latency** (Neon in `aws-us-east-1`,
roughly half a second per round trip from here, plus a 10–25s cold start when the free tier has
scaled to zero). Fine for a tick; it would need attention if a tick ever had to finish in one second.

**8. The intent engine currently signs with the deployer key only.** That is correct for Phase 2 —
`createMarket` needs `MARKET_CREATOR_ROLE`. Phase 4 moves market creation to a BridgeKey signature,
and Phase 5 adds per-member agent wallets with encrypted keys. `lib/intents/signer.ts` is the single
place that touches key material and is where both land.

---

## What the next session needs to know

**Start Phase 3: news ingestion, dedup, 2-source confirmation.** Read `docs/BUILD_PLAN.md` Phase 3.
The pipeline's first stage writes into `raw_items` → `events` → `event_items`, all of which exist
and are migrated.

**Everything Phase 2 built is available and tested. Do not rebuild any of it.**

| You need | Use | Notes |
|:--|:--|:--|
| Database | `import { db } from "@/lib/db/client"` | lazy; importing never throws |
| Schema | `@/lib/db/schema` | `sources`, `rawItems`, `events`, `eventItems` are waiting |
| Chain reads | `@/lib/chain/auspex` | `readMarket`, `readAllMarkets`, `readMarketCount` |
| Contract ABI/address | `@/lib/chain/deployment` | **the only ABI** — never write a second one |
| Writing to chain | `createIntent()` + `runIntentWorker()` from `@/lib/intents/engine` | nothing else may broadcast |
| Revert decoding | `describeRevert()` from `@/lib/chain/revert` | already handles the MST message-scraping quirk |
| Spec hashing | `computeSpecHash()` from `@/lib/chain/spec` | key-sorted and canonical; Phase 4 needs this |

**Ingestion is a straight application of the pattern already proved here:** insert with
`ON CONFLICT DO NOTHING` against `UNIQUE(source_id, source_guid)`, and let the constraint be the
mechanism rather than a safety net behind a `SELECT` first. `lib/indexer/run.ts:persistLogs` is the
worked example — it returns the count of rows actually inserted, which is how a report can honestly
say "0 new" on a replay.

**Commands added this phase:**

```bash
pnpm --filter web db:migrate        # apply migrations (uses the DIRECT connection string)
pnpm --filter web db:generate       # generate a migration after editing schema.ts
pnpm --filter web index             # one indexing pass from the cursor
pnpm --filter web index:replay      # ignore the cursor, re-read from the deploy block
pnpm --filter web crash-test        # the idempotency proof — creates a REAL market on chain
pnpm --filter web fixtures:capture  # re-capture indexer test fixtures from the live chain
pnpm preflight                      # now genuinely connects to Postgres
```

**Things that will cost you an hour if you rediscover them:**

- **`vercel env pull` cannot retrieve the Neon variables.** They are marked sensitive, so it writes
  the literal string `"[SENSITIVE]"` and reports success. Use `neonctl` — RUNBOOK §3 has the exact
  commands including the `--org-id` needed to stop it dropping into an interactive picker.
- **Neon needs BOTH connection strings.** `DATABASE_URL` (pooled) for the app, `DATABASE_URL_UNPOOLED`
  (direct) for migrations — PgBouncer in transaction mode rejects the session-level statements DDL
  issues. Both are in the root `.env.local`.
- **`tsx` runs `web/*.ts` as CJS** because `web/package.json` has no `"type": "module"`. Top-level
  `await` fails to transform. Wrap script bodies in `async function main()`.
- **Node's `fileURLToPath` throws once Turbopack has bundled the module** — the bundle's `URL` is a
  different realm's class, so the `instanceof` check inside Node fails. `lib/env.ts` reads
  `.pathname` and `decodeURIComponent`s it instead. (The checkout path contains spaces, so the
  decode is not optional.)
- **Never open a pool at module scope.** `lib/db/client.ts` exports `db` as a lazy `Proxy` because
  `drizzle(getPool())` at import time made a missing `DATABASE_URL` fail the *build*, before the
  page's own `hasDatabase()` check could render an honest error.
- **Neon free tier scales to zero**; the first connection can take 10–25 seconds. Timeouts are set to
  45s and vitest's to 120s. A slow database must never look like a broken one.
- The RPC serves a full 0→head `eth_getLogs` range with an address filter in ~450ms, so chunking is
  insurance rather than necessity. `CHUNK_BLOCKS = 500_000` in `lib/indexer/run.ts`.

**Still true from earlier phases:**

- The deployed ABI is at `contracts/deployments/mstTestnet.json`; typechain bindings regenerate into
  `contracts/types/ethers-contracts/` on every `pnpm compile`. **Index from block 5,786,343.**
- Hardhat 3 tests: `const { ethers, networkHelpers } = await network.create()`;
  `networkHelpers.loadFixture(namedFn)`; time travel via `networkHelpers.time.*`.
- **Chai matchers take `ethers` first in Hardhat 3**: `expect(tx).to.changeEtherBalance(ethers, alice, amount)`.
- **typechain emits a Hardhat-2-shaped augmentation**, so `ethers.deployContract("X")` is not
  overload-resolved. Name the generated type, or use `X__factory.connect(address, signer)`.
- Anything imported in a test must be an explicit dependency — pnpm isolates transitive packages.
  (`pg` had to be added to the *root* devDependencies for `scripts/preflight.mjs` to import it.)
- `next lint` was removed in Next 16 — lint is ESLint 9 flat config.
- Vercel auto-deploys `main` to https://auspex-web-mu.vercel.app — a broken build there is public.
- `NEXT_PUBLIC_AUSPEX_MARKET_ADDRESS` is set in Vercel for production, preview **and** development.
