# BUILD_PLAN.md — AuspeX

Phases, not days. **One phase per session.** Each phase lists its tasks, what it must ship that a
judge can *see*, and hard exit criteria. A phase is not complete until every exit criterion passes or
the failure is written into `PROGRESS.md` under "Known gaps".

The end-of-session ritual (update `PROGRESS.md` → commit → push) is in `CLAUDE.md` and is mandatory.

**Guiding principle:** a thin but real loop beats a broad but mocked one. Every phase from 2 onward
adds one real stage to a loop that already works end to end.

---

## Phase 0 — Foundations & rails

Get every rail in place so no later phase is blocked by setup. No product logic.

**Tasks**
- Repo skeleton, `git init`, `.gitignore` (secrets uncommittable), `.env.example` (placeholders only).
- pnpm workspace root; `contracts/` (Hardhat 3) and `web/` (Next.js 16) packages.
- Full `docs/` set + `CLAUDE.md` + `PROGRESS.md`.
- `contracts/hardhat.config.ts` wired for MST Testnet with `chainDescriptors` + `verify.blockscout`.
- `scripts/new-wallet.mjs` (generate EOA, print address only — never the key to stdout logs).
- `scripts/doctor.mjs` (check env, RPC reachability, chain ID, DB, Gemini, in one command).
- `.github/workflows/ci.yml` (build + test) and `heartbeat.yml` (cron → `/api/tick`).
- Create public GitHub repo, push.
- `docs/RUNBOOK.md` documenting every manual step click by click.

**Ships (visible):** a deployed Vercel URL showing an honest "Phase 0 — rails up" status page that
reads the **live chain head from the real RPC**. Even the first deploy shows something true.

**Exit criteria**
- [ ] `pnpm install` succeeds from a clean clone.
- [ ] `pnpm compile` compiles a trivial contract with solc 0.8.28 / evmVersion cancun.
- [ ] `pnpm build` green for both packages.
- [ ] `pnpm preflight` reports RPC reachable and chain ID `91562037`.
- [ ] Public GitHub repo exists and `main` is pushed.
- [ ] `git log` contains no secret; `git check-ignore .env.local` returns a match.
- [ ] Vercel URL loads and shows the real current block height.
- [ ] `docs/RUNBOOK.md` covers Vercel login, Neon, Gemini key, Discord webhook, BridgeKey, faucet.

**Blocking manual steps (user):** Vercel login · Neon project · Gemini API key · Discord webhook ·
BridgeKey install + add network · faucet funding. See `docs/RUNBOOK.md`.

---

## Phase 1 — Smart contract

The single most important artifact. Everything downstream depends on its shape.

**Tasks**
- `contracts/contracts/AuspexMarket.sol` per `docs/CONTRACTS.md`: roles, market lifecycle, parimutuel
  payout, agent registry with per-tx / per-market caps, resolution with challenge window,
  permissionless finalize, pull-based `claim()`, `Pausable` kill switch, custom errors, rich events.
- Full Hardhat 3 test suite. Must cover, at minimum:
  role enforcement · `specHash` replay rejection · agent cap enforcement at, one wei over, and far over
  the cap · parimutuel math including the `winningPool == 0` refund path · challenge → re-propose →
  finalize · double-claim rejection · reentrancy on `claim()` · paused-state behaviour.
- Deploy script writing `deployments/mstTestnet.json` (address, abi, constructor args, tx hash, block).
- Deploy to **MST Testnet**. Verify source on **MSTScan**.

**Ships (visible):** the verified contract page on `testnet.mstscan.com` — readable source, the
first real artifact of the whole project.

**Exit criteria**
- [ ] `pnpm --filter contracts test` — all green, no skipped tests.
- [ ] Every `revert` path has a test asserting the specific custom error.
- [ ] Contract deployed to chain `91562037`; address + deploy tx recorded in `PROGRESS.md`.
- [ ] Contract shows **Verified** on `testnet.mstscan.com` with readable source.
- [ ] Deployer holds `DEFAULT_ADMIN_ROLE`, `MARKET_CREATOR_ROLE`, `RESOLVER_ROLE`.
- [ ] A manual `createMarket` + `placeBet` smoke test produces two real tx hashes.

---

## Phase 2 — Data layer, chain client, idempotency engine

The plumbing that makes "a crashed worker cannot double-spend" true rather than aspirational.

**Tasks**
- Drizzle schema for every pipeline entity (see `docs/ARCHITECTURE.md`), with the unique constraints
  that give idempotency its teeth. Migrations + seed.
- `web/lib/chain/` — ethers v6 client, typed contract bindings from the Phase 1 ABI, read helpers.
- Event indexer over `eth_getLogs` with a persisted cursor and safe re-org-free replay.
- **`OnChainIntent` engine**: claim with `FOR UPDATE SKIP LOCKED` → write intent *before* broadcast →
  if `tx_hash` already present, poll the receipt instead of re-sending → nonce management → retry
  with backoff → terminal states.
- `/api/rpc/[network]` same-origin proxy.

**Ships (visible):** `/markets` listing real on-chain markets read from the chain, each linking to
MSTScan.

**Exit criteria**
- [ ] Migrations apply cleanly to a fresh Neon database.
- [ ] Indexer ingests the Phase 1 smoke-test events and reconstructs correct market state.
- [ ] **Crash test:** kill the worker mid-send, re-run — exactly one tx on chain, no duplicate rows.
- [ ] Re-running the indexer from block 0 is idempotent (no duplicate rows).
- [ ] `/markets` renders real chain data with working MSTScan links.

---

## Phase 3 — News ingestion, dedup, confirmation

**Tasks**
- Keyless sources: Google News RSS (extract the real publisher from `<source>`), publisher RSS
  (Reuters / AP / BBC / Al Jazeera), GDELT DOC 2.0. No NewsAPI — its free tier is localhost-only.
- `RawItem` ingest, unique on `(source, source_guid)` so re-ingest is a no-op.
- **Deterministic clustering first**: normalise → shingle → MinHash/Jaccard ≥ 0.6 → same cluster.
  LLM adjudicates only borderline pairs (0.4–0.6), bounded per tick to respect the free tier.
- `Event` confirmation rule: `CONFIRMED` requires **≥2 distinct publisher domains** from an
  independence allowlist. Syndication of the same wire story must not count twice.
- Deterministic prompt-injection signature scan; flagged items marked and surfaced in the UI.
- `POST /api/tick` — bounded, authenticated by `TICK_SECRET`, returns a structured report.

**Ships (visible):** `/` live pipeline view with real headlines flowing through real stages, plus a
"Run tick" button.

**Exit criteria**
- [ ] A tick ingests real articles from ≥3 independent publishers.
- [ ] Two genuinely different reports of one story cluster into a single `Event`.
- [ ] An `Event` with only one publisher domain stays `OBSERVED` and does **not** confirm.
- [ ] Re-running the same tick creates zero duplicate `RawItem` rows.
- [ ] An injected string in a headline is flagged, and is visibly delimited in the prompt sent.
- [ ] LLM calls per tick are bounded and logged; a forced 429 leaves state consistent.

---

## Phase 4 — Market proposer agent + human gate

**Tasks**
- Proposer agent: untrusted event text inside `<untrusted_content>`, never in the system instruction.
- Structured output enforced at the API **and** re-validated with Zod. Anything that fails either
  check is stored as `SCHEMA_REJECTED` with the reason — these rejections are demo material.
- Market spec: question · resolution source URL · the exact field/fact to check · deadline ·
  outcome rules · category. Ambiguity checks before money is involved.
- `/review` human approval queue rendering the spec as a **checklist, not prose**, with the source
  headlines in a clearly-marked untrusted panel.
- Approve → BridgeKey signs `createMarket` → `OnChainIntent` → real tx. Reject → reason recorded.
- Discord webhook + in-app feed fire **only after** the market is confirmed on-chain.

**Ships (visible):** `/review` — the human gate, the centre of the whole thesis.

**Exit criteria**
- [x] A confirmed event produces a schema-valid proposal.
- [x] A deliberately malformed model output is rejected and logged, and does **not** reach the queue.
- [x] Nothing goes on-chain and no notification fires before human approval.
- [x] Approving signs via BridgeKey and produces a real `createMarket` tx on MSTScan.
      **Four of them** — markets 4–7, blocks 5,793,477–485, all sent by `0xA9F68fDf…311fF1`.
- [x] The on-chain `specHash` matches the hash of the approved spec.
- [x] Re-submitting the same approved spec is rejected by the contract (replay guard).
- [x] With `GEMINI_API_KEY` unset, a tick logs the failure, takes no action, and does not crash.

---

## Phase 5 — Member agents + deterministic policy gate

The phase that proves "AI proposes, deterministic code and the chain decide".

**Tasks**
- Member + agent-wallet model; AES-256-GCM encryption of agent keys at rest.
- Agent research step → structured proposal `{ side, confidence, stakeRequested, rationale, sources }`.
- **`web/lib/policy/policyGate.ts` — pure, deterministic, no I/O, no LLM.** Clamps stake to
  `min(requested, perTxCap, remainingDailyBudget, onChainPerTxCap, remainingPerMarketCap)`.
  Rejects on: kill switch · category not allowlisted · confidence below threshold · market closed ·
  insufficient balance · ABSTAIN. Returns `{ allow, reasons[], finalStakeWei }`.
- Agent wallets registered on-chain with caps; bets sent through the intent engine.
- **A deliberate over-cap attempt**, to prove the chain refuses what our server wrongly allowed.

**Ships (visible):** `/agents` — policies, decision log with reasons, and spend bars showing the
off-chain cap *and* the on-chain cap side by side.

**Exit criteria**
- [x] `policyGate.ts` has unit tests for every branch, including exactly-at-cap and one-wei-over-cap.
      **50 tests**, needing no chain, database or model.
- [x] The gate is pure: no network, no DB, no clock reads inside it (time is injected).
- [x] At least one agent bet lands on-chain within caps — real tx hash.
      **Two**: `0x5f8a12c6…0dd5f1` (market 4) and `0xc2a42699…4e0759` (market 5).
- [x] At least one agent proposal is **rejected by the gate**, with reasons shown in the UI.
      **Six**, on `/agents`, rendered verbatim.
- [x] **The over-cap tx reverts on-chain**, and the revert is visible on MSTScan.
      `0xf0152234…720c2d` — the explorer decodes `AgentPerTxCapExceeded(2e16+1, 2e16)` itself.
- [x] Flipping the kill switch stops all agent betting without touching the contract.
      `pnpm --filter web verify:agents` asserts 0 calls, 0 rows, 0 transactions.
- [x] An agent wallet cannot call `createMarket` or `proposeResolution` (asserted in tests).
      `AuspexMarket.test.ts` plus a live `hasRole` check per agent for all four roles.

---

## Phase 6 — Resolution, challenge window, payout

**Tasks**
- `proposeResolution(marketId, outcome, evidenceUrl)` by an authorised resolver, after close.
- Challenge window; `challengeResolution` returns the market for re-proposal.
- Permissionless `finalizeResolution` after the window — no privileged party can block payout.
- Auto-claim worker: after finalisation, calls `claim()` for agent wallets; funds land with the
  registered **owner**, not the agent.
- Resolution UI with the evidence URL, challenge state, and a countdown.

**Ships (visible):** market detail through to payout, plus `/audit` — the append-only decision log.

**Exit criteria**
- [ ] Full lifecycle exercised on-chain: create → bet → close → propose → finalize → claim.
- [ ] A challenge is exercised on-chain and forces re-proposal.
- [ ] Winner balances increase by the correct parimutuel amount (asserted against computed values).
- [ ] Double-claim reverts.
- [ ] `winningPool == 0` refunds everyone (tested).
- [ ] Every step has a real tx hash recorded in `PROGRESS.md`.

---

## Phase 7 — Dashboard polish + trust surface

**Tasks**
- `/trust`: the boundary diagram plus **live counters** — LLM outputs rejected by schema, decisions
  blocked by the policy gate, transactions reverted by on-chain caps. Kill switch control.
- `<Provenance>` component + the CI check that fails a production build containing `MOCK`.
- "Judge mode": a pre-funded guest agent a judge can trigger to produce a **real** on-chain tx
  without owning a wallet.
- Responsive pass, empty states, error states, loading states.

**Ships (visible):** the whole dashboard, coherent and demo-ready.

**Exit criteria**
- [ ] `/trust` counters are real queries, not constants.
- [ ] CI fails if `MOCK` provenance appears in a production build.
- [ ] Judge mode produces a real tx from a clean browser with no wallet installed.
- [ ] Every page has a sane empty and error state.
- [ ] Readable on a phone (judges will look on their phones).

---

## Phase 8 — Live end-to-end run, README, submission

**Tasks**
- Reset to a clean state and run the **entire loop live on testnet**, capturing every tx hash.
- `README.md`: MST integration, contract address, tx hashes, setup, architecture, and an explicit
  **Limitations** section (trusted resolver, server-held agent keys, short challenge window,
  Fortuna VRF unreachable on testnet).
- `docs/DEMO_SCRIPT.md` finalised with the exact transactions to point at.
- Final Vercel deploy; confirm the public URL works from a private window.
- Submission form: repo · contract address · tx hash · demo link · demo video.

**Exit criteria**
- [ ] Every tx hash in the README resolves on `testnet.mstscan.com`.
- [ ] Contract shows Verified.
- [ ] The over-cap tx shows **Reverted** (it is evidence, not a bug).
- [ ] Zero mock data anywhere in the production build.
- [ ] A cold visitor with no wallet can understand the whole story from the public URL.
- [ ] The builder can explain the contract, the policy gate, and the pipeline unprompted.

---

## Scope discipline

**Essential (the thin real loop):** ingest → dedup → 2-source confirm → propose → schema-validate →
**human approve** → real `createMarket` → agent research → **policy gate** → real `placeBet` →
over-cap revert → resolve with evidence → challenge window → finalize → real payout. Verified
contract. Dashboard. Honest README.

**Nice-to-have:** agent leaderboard · price-over-time chart · richer clustering · Discord embeds ·
more seeded members.

**Cut (say why in the README):** Fortuna VRF (*verified absent from testnet*) · multi-outcome markets ·
AMM/order-book pricing · MEP-20 token · upgradeable proxies · account abstraction · separate indexer
service · real email · mobile app · agent-vs-agent negotiation.

If a phase is running long, cut from nice-to-have first, never from the essential loop or from the
tests that protect it.
