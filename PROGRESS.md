# PROGRESS.md — AuspeX build state

> **This file is the handoff between sessions.** A new session reads this first and continues from
> "Next phase". It is updated at the end of every phase, before the commit. If it is stale, the next
> session starts blind.
>
> Session protocol and hard rules live in `CLAUDE.md`. Phase tasks and exit criteria live in
> `docs/BUILD_PLAN.md`. Manual setup state lives in `docs/RUNBOOK.md`.

**Last updated:** 2026-09-28
**Current status:** ✅ Phase 1 complete
**Next phase:** **Phase 2 — Data layer, chain client, idempotency engine**

---

## Phase status

| Phase | Name | Status |
|:--|:--|:--|
| 0 | Foundations & rails | ✅ Complete |
| 1 | Smart contract — build, test, deploy, verify | ✅ Complete |
| 2 | Data layer + chain client + idempotency engine | ⬜ **NEXT** |
| 3 | News ingestion, dedup, 2-source confirmation | ⬜ Not started |
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
| `createMarket` tx (human-approved) | _n/a_ | ⬜ Phase 4 |
| `placeBet` tx (agent, within caps) | _n/a_ | ⬜ Phase 5 |
| Over-cap bet tx (**expected revert**) | _n/a_ | ⬜ Phase 5 |
| Resolution tx (with evidence URL) | _n/a_ | ⬜ Phase 6 |
| Payout / claim tx | _n/a_ | ⬜ Phase 6 |

**Two markets exist on-chain (ids 1 and 2)** — one per smoke-test run. Both are real, both are
labelled as smoke tests, and neither is presented anywhere as a product market. MSTScan decodes
their method names (`createMarket`, `placeBet`) because the source is verified.

**Also on chain, no longer in the repo:** `Ping` at `0x540d73793f5AA5E605A0243EA3DfCF106D6558D8`
(verified). It was the Phase 0 toolchain probe used to prove the deploy→verify pipeline works before
`AuspexMarket` existed. Deleted from the repo per `docs/BUILD_PLAN.md`; it is claimed nowhere.

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
| §1 | **Enable Gemini billing** | Phases 3–5 | ⬜ **still blocking** — now fails `402`, not `503` |
| §3 | Accept Neon terms | Phase 2 | ✅ **done** — `DATABASE_URL` is set in Vercel |
| §4 | Discord webhook | Phase 4 notifications | ✅ **done** — `pnpm preflight` reports it set |
| §5 | BridgeKey install + seed phrase | Phase 4 approvals | ⬜ needed by Phase 4, not Phase 2 |

**One thing to run before Phase 2** (I was blocked from doing it — pulling a live DB credential onto
disk is denied to me by policy, correctly):

```bash
cd web && vercel env pull .env.local --environment=production
```

That writes `DATABASE_URL` into `web/.env.local` (git-ignored). Next.js reads it natively; the root
loader in `next.config.mjs` will not override it. If you would rather keep one env file, copy just
the `DATABASE_URL=` line into the root `.env.local` instead and delete the pulled one.

**Phase 2 is otherwise unblocked** — the contract, its ABI and the deployment record all exist.

---

## Decisions already locked in

Full rationale with evidence in `docs/DECISIONS.md` (ADR-001 … ADR-024).

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

**4. `web/lib/contract.ts` hand-writes two ABI fragments** rather than importing the generated ABI.
Fine for a two-call status panel; Phase 2 replaces it with the full typed client and should delete
the fragments so there is one ABI source of truth.

---

## What the next session needs to know

**Start Phase 2: data layer, chain client, idempotency engine.** Read `docs/BUILD_PLAN.md` Phase 2
and `docs/ARCHITECTURE.md` for the entity list.

The deployed ABI is at `contracts/deployments/mstTestnet.json` (committed — address, ABI,
constructor args, tx hash, block) and typechain bindings are regenerated into
`contracts/types/ethers-contracts/` on every `pnpm compile`. **Index from block 5,786,343** — the
deployment block; there is nothing before it.

**Toolchain notes that will save time:**
- Hardhat 3 tests: `const { ethers, networkHelpers } = await network.create()`.
  `networkHelpers.loadFixture(namedFn)` snapshots; the fixture receives the `NetworkConnection`.
  Time travel is `networkHelpers.time.increase / increaseTo / latest`.
- **Chai matchers take `ethers` as their first argument in Hardhat 3**:
  `expect(tx).to.changeEtherBalance(ethers, alice, amount)`. The HH2 signature fails with a
  confusing "Expected string or addressable" error. Gas is excluded by default (`includeFee: false`).
- **typechain still emits a Hardhat-2-shaped module augmentation**, so `ethers.deployContract("X")`
  is *not* overload-resolved to the typed contract — it comes back as `ethers.Contract`, and
  `.connect()` on that returns an untyped `BaseContract`. `skipLibCheck` hides the underlying error.
  Work around it by naming the generated type: `(await ethers.deployContract(...)) as unknown as X`,
  or use `X__factory.connect(address, signer)` in scripts. `contracts/tsconfig.json` must include
  `types/**/*.ts`.
- **Decoding a revert on MST needs the helper in `contracts/scripts/smoke.ts`** (`extractRevertData`)
  — the RPC puts the ABI data in the error message, not `error.data`. Phase 5 needs this in the web
  app; consider lifting it into `web/lib/chain/` as a shared util.
- Verify with the exact deployed settings: solc 0.8.28, `evmVersion: cancun`, optimizer runs 200.
  `pnpm --filter contracts verify:testnet` already does this from the deployment record.
- Anything imported in a test must be an explicit dependency — pnpm isolates transitive packages.
- `next lint` was removed in Next 16 — lint is ESLint 9 flat config.
- Vercel auto-deploys `main` to https://auspex-web-mu.vercel.app — a broken build there is public.
- `NEXT_PUBLIC_AUSPEX_MARKET_ADDRESS` is set in Vercel for production, preview **and** development.
