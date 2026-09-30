# BUILD_PLAN.md — AuspeX

Phases, not days. **One phase per session.** Each phase lists its tasks, what it must ship that
someone can *see*, and hard exit criteria. A phase is not complete until every exit criterion passes
or the failure is written into `PROGRESS.md` under "Known gaps".

The end-of-session ritual (update `PROGRESS.md` → commit → push) is in `CLAUDE.md` and is mandatory.

**Guiding principle:** a thin but real loop beats a broad but mocked one. Every phase from 2 onward
adds one real stage to a loop that already works end to end.

**This plan has two parts.** Phases 0–8 built the system under a deadline and are complete and
shipped; they are left written exactly as they were, because the defects each one found are the
evidence behind the trust claims. Phases 9–12 turn it into a product that stands on its own. Read
Part II's preface before starting Phase 9.

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
- [x] Full lifecycle exercised on-chain: create → bet → close → propose → finalize → claim.
- [x] A challenge is exercised on-chain and forces re-proposal.
- [x] Winner balances increase by the correct parimutuel amount (asserted against computed values).
- [x] Double-claim reverts.
- [x] `winningPool == 0` refunds everyone (tested).
- [x] Every step has a real tx hash recorded in `PROGRESS.md`.

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
- [x] `/trust` counters are real queries, not constants.
- [x] CI fails if `MOCK` provenance appears in a production build.
- [x] Judge mode produces a real tx from a clean browser with no wallet installed.
- [x] Every page has a sane empty and error state.
- [x] Readable on a phone (judges will look on their phones).

**Deviation, recorded rather than dropped:** "kill switch control" is a live `paused()` read plus an
`eth_call` of `pause()` from the human authority (which reverts), not a button. A working button would
require the deployed app to hold `DEFAULT_ADMIN_ROLE`, contradicting the page it sits on. ADR-063.

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

# Part II — from submission to product

**Phases 0–8 are history and stay written as they were.** They were built against a deadline, for a
competition that has ended, and the record of that is evidence rather than embarrassment — the
sequence of defects each phase found is the strongest single argument that the trust claims were
earned rather than asserted. Nothing in Part II deletes, renumbers or retouches it.

What Part II removes is the **framing**, not the facts. The repository currently addresses a judge,
dates itself to an event, and organises its own surfaces around being assessed. A product addresses a
user and is organised around being used. Every contract address, transaction hash and measurement
survives that change untouched; hard rule #1 applies with more force here, not less, because there is
no longer a deadline to excuse a shortcut.

Same protocol as Part I: **one phase per session**, exit criteria are hard, and the end-of-session
ritual in `CLAUDE.md` is mandatory.

---

## Phase 9 — Reframe: from submission to product

Strip the competition frame from every surface a user or a contributor reads. Change no fact, no
address and no number.

**The inventory, measured 2026-09-30 — this is the actual size of the job**

| Term | Occurrences | Files | What it is |
|---|---:|---:|---|
| `hackathon` / `buildathon` / `newrro` | 24 | 15 | direct event framing — delete or reword |
| `judge` | 224 | 65 | **the real work** — the whole repo is narrated to an assessor |
| `submission` / `demo day` | 19 | 15 | deadline framing in docs and comments |
| `Phase N` | 271 | 73 | build scaffolding in comments, docs and on-chain strings |

`judge` is the one that matters and the one that will be tempting to skip. It is not a word to
find-and-replace: most instances are load-bearing sentences explaining *why* something is checkable.
The reframe is "anyone can verify this", not "a judge can verify this" — which is a stronger claim,
and is the claim the architecture actually supports.

**Tasks**
- **`README.md` rewritten as a product README.** Drop the byline *"Built solo for the MST Blockchain
  × Newrro Buildathon — AI & Web3 Builders track."* Keep the 60-second self-check, both evidence
  tables and the Limitations section verbatim in substance — they are the best thing in the repo.
  Open on what AuspeX *is* and who it is for, not on what it was entered into.
- **Rename the "judge mode" feature.** It is a real product capability — a one-click transaction the
  contract refuses — and it deserves a name that survives the event. Touches
  `web/lib/judge/probe.ts`, `web/app/trust/JudgeButton.tsx`, the `judge:probe` script, the `/trust`
  section heading and the README.
  **Constraint to decide, not to steamroll:** `audit_log` is append-only and already holds 5 rows
  under the action `judge.cap_probe`. Renaming the action string creates two names for one thing and
  makes the old rows look like a different event. Prefer keeping the stored action id and changing
  only the label, or map at display time — and record the choice in `DECISIONS.md`.
- **Reader reframe across `web/`.** ~30 of the 224 hits are user-visible copy; the rest are comments.
  Do the user-visible ones properly and the comments as you pass through them.
- **Repo metadata.** `package.json` description, `web/app/layout.tsx` metadata, the GitHub repo
  description and topics. Add a **`LICENSE` file** — `README.md` claims MIT and no such file exists,
  which is the single most obviously unprofessional thing in the tree right now.
- **Docs pass.** `PRD.md`, `ARCHITECTURE.md`, `TRUST_MODEL.md`, `CONTRACTS.md`, `RUNBOOK.md` lose the
  deadline framing and keep their content. `DEMO_SCRIPT.md` is a presenter's script for a table at an
  event — either rewrite it as `WALKTHROUGH.md` for a reader with no presenter, or retire it into
  the history set. Do not simply delete it; it holds the verified hash table.
- **Decide where the build record lives** and write it down. Recommended: `BUILD_PLAN.md`,
  `PROGRESS.md` and `DECISIONS.md` stay exactly as they are, under a one-paragraph preface framing
  them as the engineering log. They are the receipts.
- **Fix the duplicate ADR number.** There are two entries numbered **ADR-066**, and ADR-057 says
  *"superseded by ADR-066"* — which is now ambiguous. Disambiguate without renumbering history
  (e.g. ADR-066a/066b plus a pointer), and say in the preface why renumbering was refused.
- **State the measured cron cadence, not the configured one.** `heartbeat.yml` says `*/5 * * * *`;
  GitHub actually fires it roughly every five hours (see Phase 11). Whatever the README says about
  it in this phase must be what was measured. Do not write a number Phase 11 has not yet earned.

**What cannot be changed, and must therefore be explained**

Markets 1–3 and 8 carry `[Phase N … test]` inside their **on-chain, immutable** question strings.
They cannot be rewritten, and trying to hide them would be the exact retouching this project has
refused seven times. Name them as commissioning tests in the README's market table and move on. The
honest sentence is short: *these four markets were written by the build process to prove the contract
worked, they say so in their own on-chain text, and none is presented as a product market.*

**Ships (visible):** a README and a `/trust` page that read as a product a stranger could adopt, with
every hash still resolving.

**Exit criteria**
- [x] `grep -riE 'hackathon|buildathon|newrro|bmsce'` over tracked files returns hits **only** inside
      the designated history set, and every one of those is in a dated, clearly-framed context.
- [x] No user-visible surface — page copy, page title, meta description, button label, README —
      addresses a "judge" or refers to a submission, a deadline or an event.
- [x] A `LICENSE` file exists and matches what `README.md` claims.
- [x] `pnpm check:links` passes: every hash, abbreviation and sender attribution still verified.
- [x] Full suite green — tests, lint, typecheck, build — and `pnpm check:provenance` still passes.
- [x] The renamed probe still produces a **real reverted transaction** on MSTScan, and the five
      pre-existing `audit_log` rows still render correctly beside the new ones.
- [x] `PROGRESS.md` records where the build history now lives and why it was kept.

---

## Phase 10 — The new look

A complete visual redesign: **light-first, modern, characterful, and still unmistakably a system of
record.** The current theme is a dark mission-control aesthetic; this replaces it.

**The brief, from the owner:** modern, funky, professional, cool. Not dark. Real colour, used with
intent rather than apologetically.

**The constraint that makes this harder than a palette swap — read this before touching a token**

Colour in this app is **semantic**, not decorative. `ok` / `warn` / `bad` / `human` / `signal` encode
trust claims: `warn` marks an operator-key row on `/markets/[id]`, `human` marks a human-signed
action, `bad` marks a refusal, and the `<Provenance>` badge's six origins are six different
statements about where a number came from. A redesign that makes those prettier but less
distinguishable has damaged the product, however good it looks.

**Measured surface area, 2026-09-30**

| | |
|---|---:|
| Routes to redesign | 8 |
| Shared components that exist today | **3** (`SiteNav`, `Provenance`, + test) |
| Lines of page code | 5,191 — largest is `/trust` at 990 |
| Inline colour-token references in pages | **~1,200** |

**Those numbers are the plan.** With three shared components and 1,200 inline token references, a
redesign attempted directly is a find-and-replace across 5,200 lines of JSX, and it will produce
drift between pages that nobody notices until a screenshot. **Extract the component layer first.**

**Tasks, in this order**
1. **Extract a component layer** from what the pages already do repeatedly — `Card`, `Stat`,
   `Badge`, `DataTable`, `Section`, `Callout`, `AddressLink`, `TxLink`, `EmptyState`. Derive them
   from the existing markup rather than inventing a kit; behaviour must not change in this step, and
   the suite must stay green through it. This is the step that makes the rest cheap.
2. **Design the token layer** in `web/app/globals.css` (`@theme`, Tailwind v4). Light surface ramp,
   a vivid accent family, and the semantic five preserved as roles with new values. Keep the token
   *names* — renaming them churns 1,200 call sites for nothing.
3. **Typography.** The current stack is monospace-leaning by default. Pick a display/text pairing
   with personality, and **keep mono for hashes, addresses and wei values** — that is legibility for
   the data this product exists to show, not a style preference.
4. **Redesign the eight routes** on top of the component layer. `/` and `/trust` carry the most
   weight; `/audit` and `/markets` are dense tables and are where a funky palette most easily becomes
   unreadable.
5. **Motion and texture.** The `live-dot` pulse and `grid-backdrop` already exist and already respect
   `prefers-reduced-motion`. Whatever replaces them must too.

**Open decisions to make in-phase and record**
- **Dark mode:** light becomes the default. Keep dark as an opt-in if it falls out cheaply from the
  token layer; drop it rather than ship a half-tuned second theme.
- **Where the accent goes.** A trust product can carry a loud palette in its chrome, headings and
  empty states; it should not carry one inside a table of contradictory chain facts.

**Ships (visible):** the whole deployed site, redesigned.

**Done, 2026-09-30.** All eight routes. The component layer came first (3 shared components → 27
exports, 24 duplicated helper definitions → 0), then the palette by changing token *values* and
keeping every name — which is why 1,054 call sites needed no edit. Two checks were added rather
than any relaxed: `check:contrast` and `check:render`. Dark mode was dropped rather than
half-tuned (ADR-072). The redesign found one real defect that only the rendered page could show:
`Pool NO` was using the refusal colour on every market card (ADR-073). See PROGRESS.md
"Phase 10 — what shipped".

**Exit criteria**
- [x] All 8 routes redesigned and served — no route left on the old theme.
- [x] Light is the default and `color-scheme` matches; no route renders dark-on-dark or light-on-light
      anywhere.
- [x] **Contrast:** WCAG AA on all body text and UI text (AAA on the primary reading column if it
      comes free). Check the funky accents on their real backgrounds, not on white.
- [x] **The semantic five survive.** `ok` / `warn` / `bad` / `human` / `signal` remain mutually
      distinguishable, including in a greyscale screenshot and under a deuteranopia simulation —
      because they are never the only signal, verify each is paired with text or an icon.
- [x] `<Provenance>`'s six origins remain visually distinct, and the `MOCK` badge is still the
      loudest thing that can appear on any page.
- [x] No horizontal scroll at 390 px on every route (Phase 7 checked three; this checks all eight).
- [x] `prefers-reduced-motion` honoured by every animation that ships.
- [x] Keyboard focus is visible on every interactive element against the new backgrounds.
- [x] Full suite green; `check:provenance` and `check:links` still pass; the deployed site read
      top-to-bottom on every route, not assumed from the build.

---

## Phase 11 — Operational truth

Three claims this repository makes are currently false or unearned, all found on 2026-09-30 by
reading the running system rather than the notes. Fix the system where it can be fixed, and restate
the claim where it cannot.

**Tasks**
- **The cron does not run every five minutes.** `heartbeat.yml` and `sync.yml` both specify
  `*/5 * * * *`. GitHub actually fired the heartbeat at 07:18, 01:29, and 22:32 / 18:28 / 12:55 the
  day before — **roughly every five hours**. Every run succeeded; GitHub is throttling scheduled
  workflows, which it does on low-activity repositories. Either move the schedule to something that
  honours it (Vercel Cron, or an external pinger) or change every sentence that says "every five
  minutes". Measure the result over several hours before claiming the new number.
- **The resolution stage is being starved, and it is the stage the product's last unproven claim
  depends on.** `web/lib/pipeline/tick.ts:111` gives resolution a deadline at 40% of `maxDuration`
  — 24s of 60 — absolute from the start of the tick. Clustering runs before it and has **no**
  deadline at all, only a call budget (known gap #20). On both ticks that had a genuinely resolvable
  market, the stage logged:
  > `resolution halted: out of time for this tick after examining 0 market(s)`

  so it never even read the chain for that market. Bound clustering, or reorder the ladder, or both
  — and prove it with a tick that examines a past-close market and writes a report saying so.
- **`audit_log` still does not record how long a tick took** (known gap #30). Every duration in
  `PROGRESS.md` came from a hand-made `curl` because the metadata carries `errors`, `ingest`,
  `cluster` and `llmCalls` and not `durationMs`. It is a two-line change that was deliberately left
  out of Phase 8 to avoid widening it. Add it, then let it collect data.
- **Indexer drift is visible to users.** `/markets` currently renders *"indexed as OPEN, chain says
  CLOSED"* on market #11. The page handles it honestly, which is right — but a projection that lags
  its source is worth either tightening or documenting as expected behaviour with a bound.
- **Re-run `pnpm check:links`** after Phases 9 and 10 rewrote the prose around every hash.

**Ships (visible):** a tick report on `/audit` that shows the resolution stage actually examining a
market, and a duration recorded beside it.

**Exit criteria**
- [ ] The pipeline's real cadence is measured over ≥6 hours and **every** statement of it in the
      repo matches the measurement.
- [ ] A production tick is on record examining ≥1 past-close market in its resolution stage, with the
      report to prove it, and `resolution halted: out of time … examining 0 market(s)` no longer
      occurs when a candidate exists.
- [ ] Clustering has a bound — a deadline, not only a call budget — and the stage ladder is
      documented in one place.
- [ ] `audit_log.metadata` carries `durationMs` on new `pipeline.tick` rows, and `/audit` shows it.
- [ ] Known gaps #20 and #30 in `PROGRESS.md` are closed or restated with what is actually true.
- [ ] `pnpm check:links` passes. Full suite green.

---

## Phase 12 — v1.0.0

Cut a release. Nothing new is built; everything is verified once, together, and labelled.

**Tasks**
- Version `0.1.0` → `1.0.0` across the workspace; annotated git tag; `CHANGELOG.md` written from the
  real commit history.
- **One verification sweep, all of it, in one session:** `pnpm install` from a clean clone ·
  `pnpm compile` · `pnpm test` · lint · typecheck · `pnpm build` · `pnpm preflight` ·
  `pnpm check:links` · `pnpm check:provenance` · `verify:agents` · `verify:resolution`. Record the
  numbers, not the adjectives.
- Final deploy, then **read every route on the deployed site top to bottom** — the Phase 8 lesson
  (ADR-065) was that the defect was invisible in the source and obvious in the rendered page.
- Repo presentation: description, topics, social preview image, pinned.
- `PROGRESS.md` gets a closing summary: what this is, what it does, what it does not do, and where
  the history lives.

**Exit criteria**
- [ ] Every command in the sweep passes, with its output recorded in `PROGRESS.md`.
- [ ] `git tag v1.0.0` exists and is pushed; `CHANGELOG.md` covers Phases 0–12.
- [ ] A clean clone builds and its tests pass with no undocumented step.
- [ ] All routes 200 on the deployed URL and read correctly **as rendered pages**.
- [ ] `README.md`'s Limitations section is still accurate after Phases 9–11 changed things.
- [ ] No known gap in `PROGRESS.md` is stale: each is closed, or restated as true today.

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

**Scope discipline in Part II is different, and stricter.** The loop above is finished and running
on a live chain. Phases 9–12 change how it is *presented*, *dressed* and *described* — they do not
add stages to it. If a phase in Part II finds itself designing a new feature, it has gone off plan:
write the idea down under "Nice-to-have" and carry on. The one exception is Phase 11, which fixes
behaviour that makes an existing claim untrue, and is bounded to exactly the four items it lists.

**A rule that outlives the deadline.** The old version of this file justified honesty by pointing at
competition rules that could disqualify the project. Those rules no longer apply and the standard is
now higher, not lower: the product's entire proposition is that its claims can be checked. A false
sentence in the README is not a rule violation any more — it is the product failing.
