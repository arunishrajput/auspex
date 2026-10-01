# Changelog

All notable changes to AuspeX. Written from the real commit history — every version, hash and
measurement below came from `git log`, the chain, or a command whose output is recorded in
[`PROGRESS.md`](./PROGRESS.md).

This project was built in twelve numbered phases, one per working session, plus a thirteenth added
after the release, and the phase boundaries
are the only meaningful unit of change in it — so that is how this file is organised. The full
build record, including the defects and what each one cost, is
[`docs/BUILD_RECORD.md`](./docs/BUILD_RECORD.md) and
[`docs/DECISIONS.md`](./docs/DECISIONS.md) (84 ADRs).

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) loosely and
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) exactly.

---

## [Unreleased]

**Open-source ready, and a new demo video.** Documentation and repository scaffolding only — no
application code, contract, address, hash or measurement changed.

### Added

- **The demo video** — [youtube.com/watch?v=Jp08xTuiHVI](https://www.youtube.com/watch?v=Jp08xTuiHVI),
  3:47, built in `launch-film/` (Remotion, Amazon Polly narration, a score synthesised in code). Its
  render is gated on `npm run verify`, which re-reads every on-screen hash from MSTScan (ADR-082).
- **`docs/SELF_HOSTING.md`** — running your own deployment end to end: wallets, database, model,
  contract deploy and verification, the human authority's roles, agent registration, hosting and the
  heartbeat.
- **A zero-secret quickstart.** A clean clone with no `.env.local` installs, compiles, passes the
  full test suite and serves all eight routes read-only against the live contract — measured on
  2026-10-01 and now the README's first instruction (ADR-083).
- **`CONTRIBUTING.md`**, **`SECURITY.md`** (private vulnerability reporting), **`CODE_OF_CONDUCT.md`**
  (Contributor Covenant 2.1), issue forms and a pull-request template that mirrors CI.
- README badges, a *Watch it* section, *Contributing* and *Security* sections, and the repository
  layout now lists `launch-film/`, `scripts/` and `.github/`.
- `license`, `author` and `repository` metadata in every package.

### Removed

- **`video/`**, the September 2026 film, at the owner's request. Its source is in git history at
  `9abe3fc`; `docs/BUILD_RECORD.md` points there (ADR-082).

## [1.1.0] — 2026-10-01

**Phase 13 — the dark edition.** A complete visual redesign, requested after the release: the
palette inverted from light to near-black, the accent moved from teal to orange, display type
roughly doubled, and the navigation became a sticky site header. Eight routes changed appearance.

**No measured fact, address, hash or limitation changed.** This is a `MINOR` rather than a `MAJOR`
for that reason — nothing a reader could have checked before has a different answer now, and the
three defects it fixed were all cosmetic or structural.

### Changed

- **The theme is dark.** ~20 values in `app/globals.css`; not one of the ~1,350 colour-token call
  sites was renamed, because the ramp is role-pure — surfaces, borders and text never cross over.
  That property has now survived two inversions in opposite directions (ADR-079).
- **The palette was searched against the existing contrast gate, not chosen by eye.** The gate
  turned out to be genuinely theme-agnostic, which is the condition ADR-072 set for ever shipping a
  second palette. Measured after: worst greyscale separation between the five semantic tones
  **1.20:1** (was 1.19), worst colour-blind separation **ΔE 13.6** (was 11), accent distance from
  the nearest tone **ΔE 48** against a floor raised to 30 for this change.
- **The tone ladder reordered** to `ok, warn, human, signal, bad`, lightest to darkest. A saturated
  red is luminance-capped near 0.21, which makes it the easiest tone to keep legible on white and
  the hardest on black; `bad` clears AA at **4.64:1**, the narrowest margin in the palette.
- **`bad` moved to a crimson-rose** so the new orange accent could not be mistaken for a refusal.
  The accent did not back away from orange; the tone moved (ADR-073's rule, applied).
- **The site header is sticky and rendered by `PageShell`** rather than placed by each page
  (ADR-081). The two content column widths now match the header's.
- The hero `h1` is the product's argument rather than its name, with four live numbers under it;
  sections on `/` are numbered chapters; sections reveal on scroll via `animation-timeline: view()`
  — no JavaScript, no observer, and no effect at all under `prefers-reduced-motion`.

### Fixed

- **`/markets/[id]` had no navigation.** Seven routes placed the nav by hand; the eighth was written
  later and did not copy the line. Rendering it from the shell makes that class of omission
  impossible (ADR-081).
- **`app/icon.svg` was a whole theme out of date.** It carries literal hexes because an SVG served as
  a file cannot read a CSS variable, and Phase 10 missed them — the tab icon had been showing the
  *original* dark palette's colours throughout the light era.
- **The contrast checker and the tone registry disagreed about the badge tint.** `warn` tinted at
  14% while the check measured 12%. Harmless on white; on black `bad` passes at 12% and fails at
  16%, so the checker now reads the number out of `tone.ts` instead of keeping a copy (ADR-080).
- Two numbers of the same kind on `/` were formatted two different ways (`1,289` beside `1093`).

### Verified

`check:contrast` passed · `check:render` passed on all 8 routes at 390px and 1280px, focus ring on
every interactive element, zero animating elements under reduced motion · 441 tests green ·
`check:provenance` passed on 152 files · `eslint` and `tsc --noEmit` clean · every route read in a
browser rather than inferred from the JSX.

---

## [1.0.0] — 2026-09-30

First release. Nothing new was built for it: the version marks the point at which every claim in the
repository was verified once, together, in a single sweep, and the ones that had stopped being true
were corrected.

`0.1.0` was never tagged, so this is the first tag in the repository's history. Thirty-seven commits,
2026-09-28 to 2026-09-30.

### The system, in one paragraph

Prediction markets created under human authority on MST Blockchain Testnet, with members betting
through constrained AI agents. News is ingested from eight feeds, deduplicated, and confirmed only
when two independent publishers report it. An LLM drafts a market specification; a human reads it as
a checklist and signs `createMarket` from a browser wallet whose key no server holds. Member agents
research open markets and propose bets; a deterministic policy gate refuses most of them, and the
contract caps the rest per transaction and per market. Outcomes are proposed with an on-chain
evidence URL, signed by a human, and are challengeable before they finalise. Every decision —
approved and refused alike — is logged with the reason it carried at the time.

### Fixed in this release

- **`verify:agents` claimed to write nothing, and it writes one row.** Its check that forces the
  global kill switch on runs the real betting pass, and that pass appends one `agents.halted` row to
  `audit_log` with its reason. The write is correct — a halt is a decision, and hard rule #7 logs
  decisions — so the write stayed and the claim was narrowed, in the script's own output, in
  `README.md` and in `CLAUDE.md`. `verify:resolution` was checked the same way and writes nothing,
  as it says.
- **The README described the resolution starvation defect as though it were still live.** Phase 11
  fixed it; the Limitations section had not caught up. It now states what is actually true — and the
  first rewrite of it was *also* incomplete, which the deployed-page read-through caught: it blamed
  the retrieval coverage floor alone, when the first reason market 11 has no drafted outcome is that
  its question asks about a stock price *"within 48 hours of the market closing"*, so the answer does
  not exist until after its own resolve deadline. It is a market the human gate should have refused
  — an earlier note had already named that same proposal as a candidate for refusal — and the
  contract handles it correctly anyway by letting it go stale and refunding the stake. Both reasons
  are now stated, separately.
- **The cron delivery rate was computed from the wrong count.** Phase 11 measured ten scheduled
  heartbeat runs over 46h07m and reported `1.6%` of the 554 runs the `*/5` expression requested.
  Nine is the number of *gaps* between ten runs — correct for the mean gap, wrong for a delivery
  rate. The rate is **1.8%** (10/554), and `sync.yml`'s is **2.0%** (7/351), not 1.7%. Every
  measured value — run counts, mean gaps of 5h07m and 4h52m, ranges of 2h57m–6h44m and
  2h53m–6h29m — was already exact and is unchanged. Corrected in `README.md`, `PROGRESS.md`,
  `heartbeat.yml` and `sync.yml`.
- **`PROGRESS.md` said the database has 14 tables.** It has 15; `resolutionDrafts` arrived in
  Phase 6 and the count was not updated.

**Two of those five needed a second pass of their own**, which is worth knowing because it is the same
failure repeating at a smaller scale: the percentage correction missed `docs/ARCHITECTURE.md`, found
only by grepping for the old number afterwards; and the first rewrite of the market 11 paragraph was
itself incomplete, found only by reading the deployed `/resolve` page. A correction is not finished
when the sentence that prompted it is fixed — it is finished when nothing still says the old thing.

**The `v1.0.0` tag was force-updated three times** as those later corrections landed, because a tag
whose message says every claim was verified must not point at a tree containing a claim known to be
false. `PROGRESS.md` has a table of every position and what each previous tree got wrong.

### Verified for this release

One sweep, in one session — **sixteen command runs across thirteen distinct checks** — with the
numbers rather than the adjectives:

| Command | Result |
|:--|:--|
| `pnpm install` (clean clone, no `.env.local`) | 4.2 s |
| `pnpm compile` (forced clean) | 2 Solidity files, solc 0.8.28, evm `cancun`, 0.8 s |
| `pnpm test` | **498 passed** — 441 web across 31 files, 57 contracts — 46.9 s |
| `pnpm test` (clean clone) | 431 passed, **10 skipped** — the DB suite, which has no CI credential by design |
| `pnpm lint` | clean, 3.1 s |
| `pnpm typecheck` | clean, 2.1 s |
| `pnpm build` | 8 page routes + 4 API routes, Next.js 16.3.6, 4.4 s |
| `pnpm build` (clean clone) | same route table, 9.1 s |
| `pnpm preflight` | **11/11** — RPC, explorer, both wallets' role boundaries, Neon (15 tables), Gemini, all three agents |
| `pnpm check:links` | every hash, abbreviation, sender and URL in `README.md`, against the live chain |
| `check-links docs/WALKTHROUGH.md` | same, for the walkthrough |
| `pnpm check:provenance` | 152 source files, runtime guard intact, every route declares its data's origin |
| `verify:agents` | **41 live checks** — no agent holds any role; the cap boundary from both sides |
| `verify:resolution` | 19 passed, 4 skipped for want of a market in that state; writes nothing |
| `check:contrast` | every text token clears AA on all four surfaces; the semantic five stay apart in greyscale and under three kinds of colour blindness |
| `check:render` | **first real run** — 8 routes, no horizontal scroll at 390 px or 1280 px, a visible focus ring on every focusable element, no animation under `prefers-reduced-motion` |

### On chain at release

Chain `91562037`, verified source, every value resolvable on `https://testnet.mstscan.com`.

| | |
|:--|:--|
| `AuspexMarket` | `0xc4743d6295311AFead12161881Bfcf601B70104C` |
| Deployed | `0x3b98b828b89bda4489bde9bded404afeb5dfe68d2703759184d74111d7dacd56`, block 5,786,343 |
| Source | solc `v0.8.28`, evm `cancun`, optimizer on, runs 200 — `is_verified: true` |
| Human authority | `0xA9F68fDf84388fa548a685085E2bee0e5b311fF1` — every role requiring judgement, **no** `DEFAULT_ADMIN_ROLE` |
| Markets | **13** — 9 created by the human wallet, 4 by the operator (all four self-describing or Phase 1 smoke tests) |
| Live | https://auspex-web-mu.vercel.app |

---

## Part II — making it a product

### Phase 11 — Operational truth (`856ea91`, `d4b7a60`, 2026-09-30)

Fixed the three claims that were false or unearned, all found by reading the running system rather
than the notes.

- **The resolution stage was being starved, intermittently.** It ran fourth in the ladder behind an
  *unbounded* clustering stage, and two of the three production ticks that had a resolvable market
  never read the chain for it — logging `resolution halted: out of time for this tick after
  examining 0 market(s)`. Because it depended on how fast clustering's model calls happened to
  answer, it looked fine whenever anyone checked. Resolution now runs first among the model stages,
  clustering and the proposer have deadlines rather than only call budgets, and every model stage is
  clamped to `budget − callTimeoutMs − tail` so no call can begin too late to finish. ADR-075.
- **Nothing states a cadence in prose any more.** `*/5 * * * *` was being delivered roughly every
  five hours; GitHub throttles scheduled workflows on low-activity public repositories. Rather than
  write a better sentence, every sentence was removed — from `README.md`, `ARCHITECTURE.md`,
  `RUNBOOK.md`, both workflows, four source comments — and `/audit` now computes the cadence from
  `audit_log` on every request, separating cron ticks from prompted ones. ADR-076.
- **`audit_log` now records how long a tick took** — `durationMs`, `budgetMs`, `source` and the full
  resolution report. Twenty-two ticks had run without one duration being stored. ADR-077.
- **The indexer's lag is documented with a bound** rather than tightened: one tick, structurally,
  because the indexer is step 8 and settlement is step 9. It is a display lag and never a
  correctness one — every figure that decides money comes from `getMarket()` at the current block.

**The defect only the rendered page could show, a ninth time.** The cadence panel's first version
averaged every tick row and reported 84 minutes for a system whose unattended cadence is five hours,
because `audit_log` holds button presses and CLI runs beside cron ticks. Correct arithmetic over the
wrong population — invisible in the source, obvious in one look at the served page.

### Phase 10 — The new look (`ce9e29d`, 2026-09-30)

A full visual redesign, light-first, on all eight routes.

- **A component layer came first**, extracted from what the pages already did repeatedly: 3 shared
  components became 27 exports, and 24 duplicated helper definitions became 0. This is what made the
  rest cheap.
- **The palette changed by changing token *values* and keeping every name.** `bg-ink-950` is now the
  lightest surface; the number means distance from the reader's eye, not brightness. 1,054 call sites
  needed no edit.
- **`components/ui/tone.ts` is the only place that decides what a trust claim looks like.** It was
  six places.
- **Two checks were added and none relaxed:** `check:contrast` proves AA on every real surface pair
  plus greyscale and three kinds of colour blindness; `check:render` proves no horizontal scroll at
  390 px, a visible focus ring, and reduced motion honoured.
- **Dark mode was dropped rather than shipped half-tuned.** ADR-072.

**The defect only the rendered page could show, an eighth time:** `Pool NO` rendered in the refusal
colour on every market card, three feet from an `INVALIDATED` badge that meant something else. It had
been in the code since Phase 2 and the dark theme had hidden it. ADR-073.

### Phase 9 — Reframe (`8ab141b`, 2026-09-30)

The repository stopped addressing a judge and started addressing a reader. The governing rule was
**the framing goes, every fact stays** — no address, hash, measurement or limitation was changed to
look better.

- **Two false sentences were found by reading the chain rather than the file**, including a claim
  about which markets self-label that had been wrong the whole time.
- **The build record was kept rather than erased, and now says why it was kept** —
  `docs/BUILD_RECORD.md`. The sequence of defects it records is the evidence behind every trust
  claim the product makes. ADR-068.
- `judge:probe` → `probe:cap`; `lib/judge/` is gone. The three *stored* identifiers were deliberately
  left unchanged, because a log that renames itself is a log whose citations cannot be trusted.
  ADR-069.
- `LICENSE` added (MIT); the two ADRs both numbered 066 became ADR-066a and ADR-066b, with their
  citations updated and renumbering refused.

---

## Part I — building the system

### Phase 8 — Live end-to-end run, README, submission (`409f5a3`, `40f1de9`, `e9daabb`, 2026-09-29)

- **Discord notifications were arriving up to 50 minutes late, and the root cause was arithmetic.**
  `recordApproval` ran the indexer inline, but the intent worker returns after 1 confirmation while
  the indexer reads only to `head − 3` — so the inline pass sat three blocks below its own market's
  log, every time. Measured: 44m29s and 49m44s. Fixed by `runIndexer({ confirmBlock })`, which waits
  out the depth in a bounded 7,557 ms. ADR-066a.
- **A market nobody resolves is now refunded** rather than waiting forever — permissionless
  `invalidateStale`, run by the keeper from a wallet with no role. ADR-066b.
- **The demo film checks its own claims before it is allowed to render.**
  `video/scripts/verify-onscreen.mjs` re-verifies all five on-screen hashes and addresses, including
  the *sender*, and blocks the render on a mismatch.
- `pnpm check:links` — every hash, abbreviation, sender and URL in the README, against the live
  chain. Check 2b caught three wrong attributions in a README draft written the same hour.

### Phase 7 — Dashboard and trust page (`a17f121`, `c72d308`, `5037172`, `34957b3`, 2026-09-29)

- **`/trust`** proves the authority claim by live `eth_call` instead of asserting it — `hasRole`
  across four roles and four addresses, plus a `pause()` probe.
- **`<Provenance>`** labels where every number came from: six origins, each a different trust claim,
  with a runtime throw and a CI check behind the `MOCK` badge. ADR-061.
- **The cap probe** produces a real reverted transaction on demand, refusing to broadcast unless an
  `eth_call` first confirms the chain will reject it. ADR-062.
- **The kill switch deliberately has no button.**
- Two pages were caught claiming more than their own rows supported, and one was counting a refused
  bet as money the operator had staked.

### Phase 6 — Resolution, challenge window, payout (`8a2b777`, `635ffd1`, `a771dbb`, 2026-09-29)

The full lifecycle on chain: `createMarket` → two-sided bets → `closeMarket` → `proposeResolution` →
`challengeResolution` → round 2 → `finalizeResolution` → `claim`, with four deliberate reverts
recorded alongside (`BettingClosed`, `ChallengeWindowOpen`, `AlreadyClaimed`, `NothingToClaim`).

- **Resolution is human-signed even though it did not have to be**, because the 120-second challenge
  window is far too short for a human to veto a wrong outcome — so the human gate moved *before* the
  proposal. ADR-052.
- **`claim()` pays the registered owner, not the agent.** Proved on chain: 0.015 tMSTC to the owner.
- **Retrieval is part of the gate** — the model is constrained in what it may look at, not only in
  what it may say. ADR-060.
- The claim that `0xA9F68fDf…311fF1` holds "`MARKET_CREATOR_ROLE` and nothing else" was retired
  everywhere it appeared, because it had stopped being true.

### Phase 5 — Member agents and the policy gate (`bac4b03`, `5dd0e57`, 2026-09-29)

- Three agent wallets registered on chain with per-transaction and per-market caps, holding **no
  role**.
- **A deterministic policy gate** decides every bet; the model only ever proposes. 50 unit tests pin
  it to the wei.
- **The over-cap bet is on chain**: cap + 1 wei, refused by the contract with
  `AgentPerTxCapExceeded(2e16+1, 2e16)`.
- The agents stage was bounded by time, not only by call count.

### Phase 4 — Proposer agent and the human approval gate (`59e6c12`, `84f891c`, `fc1ede5`, `3bd6f25`, 2026-09-29)

- An LLM drafts a market spec; Zod re-validates it after the API's own schema constraint; a
  deterministic gate refuses what is checkable.
- **`/review`** presents the draft as a checklist and signs `createMarket` with BridgeKey. Four
  markets were created this way, from a wallet whose key this repository has never seen — blocks
  5,793,477 / 480 / 482 / 485.
- `MARKET_CREATOR_ROLE` granted to the human authority wallet; `preflight` checks what that wallet
  must **not** hold.

### Phase 3 — News ingestion, dedup, two-source confirmation (`e2ba8f6`, `c97c85d`, 2026-09-29)

- Eight feeds, deterministic clustering, and confirmation requiring two distinct publisher domains
  with an independence-group check.
- **All untrusted text is delimited** — news goes into a user-role message inside
  `<untrusted_content>`, never into a system instruction.
- **A tick is round-trip-bound, not CPU-bound**: 19,900 similarity comparisons take under 20 ms;
  400 sequential Neon round trips take 400 seconds. Measured 48 s locally against 14.9 s in
  production, where the function and the database share a region. ADR-033.

### Phase 2 — Data layer, chain client, idempotency engine (`f564576`, `5e621a9`, `2b94b74`, 2026-09-28)

- Neon Postgres + Drizzle; unique keys and `SELECT … FOR UPDATE SKIP LOCKED` off chain, the
  `specHash` replay guard on chain.
- **The `OnChainIntent` row is written before the broadcast**, so a crashed and re-run worker cannot
  double-create a market. Proved by a crash test that creates a real market on chain
  (`0xeabf2271…7dbefe83`).
- ethers v6 directly on the critical path; the MST SDK is too thin to trust there.

### Phase 1 — The contract (`7808746`, 2026-09-28)

`AuspexMarket` deployed to MST Testnet at `0xc4743d6295311AFead12161881Bfcf601B70104C` and
**verified** on MSTScan — solc 0.8.28, evm `cancun`, optimizer on, runs 200. 57 contract tests,
including reentrancy, pause-never-traps-funds, and the agent cap boundary from both sides.

Readable strings are stored on chain deliberately — question, sources, evidence URL — because gas is
effectively free here and reader legibility on the explorer is worth more than the saving.

### Phase 0 — Foundations (`1fef10c`, `5aad9b0`, `4676277`, `db1a151`, `7047d5e`, 2026-09-28)

Monorepo, CI with secret and mock guards, and the environment facts established by probing rather
than assuming:

- **`testnet.mstscan.com` is the explorer; `mstscan.com` indexes a different chain.**
- **Fortuna VRF has no bytecode on this testnet** — `eth_getCode` returns `0x`. VRF was cut rather
  than faked, with the evidence recorded.
- **The chain is Cancun-capable** (PUSH0, MCOPY, TSTORE/TLOAD verified by `eth_call` probes).
- **Hardhat 2 does not run on Node 26**, so this is a Hardhat 3 project.
- Gas is effectively free: `baseFeePerGas = 0`, 55 M block gas limit, 3-second blocks.

---

[1.0.0]: https://github.com/arunishrajput/auspex/releases/tag/v1.0.0
