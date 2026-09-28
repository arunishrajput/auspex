# DECISIONS.md — architecture decision log

Append-only. One entry per decision worth defending to a judge. New entries go at the bottom.
Format: **what was decided · why · what it costs · evidence**.

---

### ADR-001 — Write our own market contract; do not use Fortuna VRF

**Decided:** implement `AuspexMarket.sol` ourselves; treat the organisers' Fortuna contract as
out of scope.

**Why:** Fortuna (`0x01C6C7EBac32eD9be3Cd8Ad84B38128124AAd380`) is a VRF coordinator — a
verifiable-randomness service with a `Request` struct and PENDING/FULFILLED statuses. It has no
market functions. More decisively, **it has no bytecode on MST Testnet**: `eth_getCode` against
chain `91562037` returns `0x`. It is a mainnet contract and is unreachable from where we deploy.

**Cost:** we write and test a market contract ourselves. Randomised resolver selection is cut.

**Evidence:** `eth_getCode` on `https://testnetrpc.mstblockchain.com` → `"0x"`.

---

### ADR-002 — The explorer is `testnet.mstscan.com`, not `mstscan.com`

**Decided:** every explorer link in code, UI and docs points at `https://testnet.mstscan.com`.

**Why:** `mstscan.com` indexes a different chain. Its API reported a head block around 20,861,364
while our RPC was at 5,782,360. `testnet.mstscan.com` matched our RPC exactly — same head, same
55,000,000 gas limit, same validator address.

**Cost:** none. Getting it wrong would have made real transactions appear fake to a judge, which
the track warns can disqualify a project.

**Evidence:** `api/v2/stats` and `eth_block_number` compared across both hosts.

---

### ADR-003 — Hardhat 3, not Hardhat 2

**Decided:** use Hardhat 3.18 with `chainDescriptors` + `verify.blockscout`.

**Why:** this machine runs Node v26.8.2. Hardhat 2.29.1 crashes on startup because its `ts-node`
dependency calls a TypeScript internal that has moved:
`TypeError: Cannot read properties of undefined (reading 'fileExists')`. Tested directly rather than
assumed. Hardhat 3 has native TypeScript support (no `ts-node`) and compiled cleanly.

**Cost:** MST's own Vibe Kit config is Hardhat 2 format, so we cannot copy it verbatim — we port the
network and verification settings to HH3's schema. The MST-supplied values are unchanged.

**Evidence:** HH2 crash reproduced; HH3 compiled `solc 0.8.28 (evm target: cancun)` successfully.

---

### ADR-004 — Compile for `evmVersion: cancun`

**Decided:** target Cancun.

**Why:** probed the chain with `eth_call` + state overrides and executed PUSH0 (`0x5f`), MCOPY
(`0x5e`), TSTORE/TLOAD (`0x5d`/`0x5c`) and BLOBHASH successfully, with an INVALID-opcode control
confirming the overrides were genuinely applied. So Cancun is supported, not merely assumed.

**Cost:** none observed. Shanghai would be the fallback if a node upgrade ever regressed.

---

### ADR-005 — Store human-readable strings on-chain

**Decided:** store `question`, `resolutionSourceUrl` and `evidenceUrl` as on-chain strings rather
than hashes or IPFS pointers.

**Why:** gas here is effectively free — `baseFeePerGas` is 0, priority is 1 gwei, and the block gas
limit is 55,000,000. Spending free gas buys the thing that actually scores: a judge can open the
contract on MSTScan and **read the market and the evidence**. `specHash` still binds each market to
its full off-chain spec, so the strings are a readable summary, not the source of truth.

**Cost:** the contract would need redesigning for a chain with real gas costs. Stated in the README.

---

### ADR-006 — ethers v6 on the critical path, not `@mstblockchain/mst-sdk`

**Decided:** use ethers v6 directly for deployment, contract calls and event indexing.

**Why:** inspected the published tarball. `@mstblockchain/mst-sdk` is v1.0.0, described as
"A blockchain SDK development project", ships no TypeScript types despite being called the
TypeScript SDK, and its README's install command is wrong (`npm install blockchain-sdk`). It is a
thin wrapper over `ethers ^6.16.0`. Betting the reliability of every on-chain write on a v1.0.0
wrapper is risk with no upside — the track requires meaningful **MST Blockchain** usage, not
meaningful MST **SDK** usage, and our contract is about as integral as it gets.

**Cost:** we forgo a nominal "uses the official SDK" talking point. May still use it in one small,
clearly-scoped read-only place.

---

### ADR-007 — Parimutuel payout, not an AMM

**Decided:** winners split the whole pool pro rata: `payout = stake * totalPool / winningPool`.

**Why:** it is auditable in one line and explainable in one sentence, and a judge can verify the
arithmetic by hand from the event log. LMSR or a CPMM would look more sophisticated and be
considerably harder to defend under questioning — and the track explicitly requires the builder to
explain every decision.

**Cost:** no live price discovery during the betting window. Acceptable for the MVP loop.

---

### ADR-008 — Two independent limit layers for agents

**Decided:** bound member agents off-chain with a deterministic policy gate **and** on-chain with
per-transaction and per-market caps.

**Why:** the off-chain gate is our code and could be wrong or compromised. The on-chain caps hold
regardless. This produces the strongest demonstrable claim in the project: *even with the server
fully compromised, the chain refuses an over-cap bet.* Phase 5 proves it deliberately, and the
reverted transaction is evidence.

**Cost:** the caps are duplicated in two places and must stay in sync — handled by reading the
on-chain values into the gate rather than hard-coding them twice.

---

### ADR-009 — Server-held agent wallets, bounded by the contract

**Decided:** each member gets a server-side burner EOA (AES-256-GCM encrypted at rest), separate
from their personal BridgeKey wallet.

**Why:** an agent cannot act autonomously without a key the server can sign with. Rather than
pretend otherwise, the design makes the key not worth stealing: an agent can only call `placeBet`,
its stake is capped on-chain, and `claim()` pays the registered **owner**, not the agent.

**Cost:** genuine custody risk, stated plainly in the README and on `/trust`. A production system
would use non-custodial signing or session keys under account abstraction.

---

### ADR-010 — Target EIP-1193/EIP-6963, write no BridgeKey-specific code

**Decided:** use wagmi's `injected()` connector against the standard injected-provider interface.

**Why:** BridgeKey publishes no developer documentation — its site describes the wallet but makes no
EIP compatibility claims. Any extension that wants to work with dApps must inject an EIP-1193
provider. Coding to the standard means BridgeKey works, MetaMask-with-custom-network works as a
fallback, and we own zero vendor-specific code. MST's own Vibe Kit uses exactly this approach, which
corroborates it.

**Cost:** must be verified empirically with the extension installed (RUNBOOK §5).

---

### ADR-011 — Pipeline as a tick-driven state machine

**Decided:** model every stage as a Postgres row with an explicit state; advance it with a bounded
`POST /api/tick`.

**Why:** one decision solves four problems at once — idempotency (rows have unique keys and are
claimed with `FOR UPDATE SKIP LOCKED`), resumability after a crash, Gemini free-tier rate limiting
(work per tick is bounded), and demo control (a button advances the pipeline on stage).

**Cost:** more upfront schema work than a naive cron-and-pray script. Repaid immediately.

---

### ADR-012 — Idempotency by two independent mechanisms

**Decided:** write the `OnChainIntent` row **before** broadcasting and never re-send a tx that
already has a hash; **and** have the contract reject a repeated `specHash`.

**Why:** the dangerous window is "broadcast succeeded, then the worker died before recording the
hash". The off-chain intent record closes it; the on-chain replay guard closes it again without
depending on our code being correct. Neither mechanism relies on the other.

**Cost:** one extra DB write per chain operation. Trivial.

---

### ADR-013 — RSS + GDELT for news, not NewsAPI

**Decided:** ingest from Google News RSS (extracting the real publisher from the `<source>` element),
direct publisher RSS feeds, and GDELT DOC 2.0.

**Why:** all are keyless, free and unrate-limited in practice. NewsAPI's free tier is restricted to
localhost, so it would work in development and fail in the deployed demo — the worst possible failure
mode. RSS also gives us the publisher domain directly, which is exactly what the two-independent-source
rule needs.

**Cost:** more parsing code; feed quality varies.

---

### ADR-014 — Gemini free tier with `gemini-3.5-flash-lite` / `gemini-3.8-flash`

**Decided:** the user chose the Gemini free tier. Use `gemini-3.5-flash-lite` for high-volume,
low-judgement work and `gemini-3.8-flash` for market drafting and agent research.

**Why:** Google's current model documentation says the 2.5 series is superseded and new projects
should use 3.5 Flash-Lite or 3.8 Flash. Free-tier rate limits are handled as a design constraint:
deterministic work runs first, LLM calls per tick are capped, results are cached by content hash, and
a 429 causes a logged no-op rather than a crash.

**Cost:** rate limits could bite mid-demo. Mitigated by caching and by the fail-safe path, which is
itself a demonstration of the "fail safe, keep running" principle.

---

### ADR-015 — Vercel + Neon + GitHub Actions

**Decided:** deploy the app to Vercel, Postgres on Neon, cron heartbeat on GitHub Actions.

**Why:** entirely free with no credit card, all CLI-drivable, and it gives judges a permanent URL.
AWS student credits were considered and rejected: VPC/IAM/RDS setup would cost 1–2 hours that buy
nothing a judge can see, and would add operational surface to explain that is not the product.
Render's free tier spins down after inactivity, risking a cold start during judging.

**Cost:** Vercel serverless time limits — which is another reason ticks are bounded.

---

### ADR-016 — Keep an RPC proxy even though CORS currently works

**Decided:** route browser reads through `/api/rpc/[network]`.

**Why:** MST's Vibe Kit warns the testnet RPC sends no CORS headers. Tested directly on 2026-09-28
and found that it **does** now send `Access-Control-Allow-Origin: *` on both preflight and POST — the
vibe kit's comment is stale. Keeping the proxy anyway is ~20 lines and insures against that policy
changing back mid-hackathon, while giving us a caching and rate-limiting point.

**Cost:** one extra hop on reads. Negligible.

**Evidence:** `curl -X OPTIONS` and `curl -X POST` with an `Origin` header both returned
`Access-Control-Allow-Origin: *`.

---

### ADR-017 — Gemini model fallback chains, and the free tier is not demo-viable

**Decided:** configure `GEMINI_MODELS_FAST` / `GEMINI_MODELS_SMART` as comma-separated **fallback
chains** tried left to right with a 20s per-attempt timeout; and enable **billing** on the key's
Google Cloud project rather than relying on the free tier.

**Why — measured, not assumed (2026-09-28):**

| Observation | Evidence |
|---|---|
| `gemini-2.5-flash` / `gemini-2.5-flash-lite` are **retired** | HTTP 404 `"no longer available"` |
| Every current model returns 503 on the free tier | **0/20 calls succeeded** across 5 models x 4 rounds |
| The error is capacity, not quota | `"This model is currently experiencing high demand"` — a 503, never a 429 |
| Availability varies per model and over time | one isolated success on `gemini-3.1-flash-lite` while two others 503'd in the same pass |
| Latency can be pathological when it does answer | one success took **159,263 ms** |

A 159s call cannot run inside a serverless function, and a demo whose AI stage silently produces
nothing is a bad demo — even though the fail-safe path handles it correctly. Paid tier has separate,
far larger capacity. The realistic spend for this workload (bounded ticks, short prompts) is a few
dollars for the whole hackathon.

**Why chains anyway, even on paid:** availability was observed to vary *per model*, so trying a
second and third model costs almost nothing and converts some outages into successes. It also means
a retired model ID degrades to a fallback instead of taking the pipeline down.

**Cost:** one manual billing step (Claude cannot enter payment details). Slightly more config than a
single model name.

**Unchanged:** the fail-safe rule still holds — if every model in a chain fails, the tick takes **no
action**, logs the reason, and continues. That behaviour is now genuinely exercised rather than
theoretical, and `pnpm preflight` reports the distinction between 503 (capacity) and 429 (quota).

---

### ADR-018 — Faucet key exposure: use the UI, never the leaked key

**Decided:** fund wallets only through the faucet's web UI. Do not use the private key found in its
client bundle.

**Why:** `faucet.masterstroke.academy` ships `REACT_APP_PRIVATE_KEY` in its public JavaScript bundle
— the faucet dispenses entirely client-side. The corresponding wallet,
`0xC10eEAb93a0F4b26a0c18E17e323d435F21f1ea1`, held **~504,908 tMSTC** when checked. Anyone who opens
devtools can drain it.

Publicly visible does not mean ours to use: signing with someone else's key is unauthorised use
regardless of how it was obtained, and it would also bypass the faucet's rate limiting. We derived
the address read-only to confirm the report and went no further.

**Action:** report to the organisers. Testnet funds have no market value, so the impact is
availability (a drained faucet blocks every participant), not theft. Recorded here because a judge
may reasonably ask how we funded our wallets.

**Cost:** the faucet UI has a reCAPTCHA, so wallet funding is a manual step. Accepted — solving
CAPTCHAs is out of bounds.

---

### ADR-019 — `challengeWindow` is immutable; there is no admin setter

**Decided:** `challengeWindow` is an `immutable` set in the constructor (120s on the live
deployment). No function can change it.

**Why:** the challenge window is the only thing standing between a single resolver's opinion and a
final payout. An admin who could shrink it to zero could propose an outcome and finalise it in the
same block, which would make the window decorative. A setter would have to be explained away in
front of a judge; an `immutable` explains itself.

**Cost:** changing the window means redeploying. Given a 120s window chosen for demo legibility,
that is a non-cost.

**Evidence:** `challengeWindow()` reads `120` on
`0xc4743d6295311AFead12161881Bfcf601B70104C`; constructor args are visible on MSTScan.

---

### ADR-020 — Deactivating an agent blocks it entirely rather than un-capping it

**Decided:** `placeBet` treats *registered* (`agents[caller].owner != 0`) and *active* as separate
checks. A registered-but-inactive agent reverts `AgentNotActive`.

**Why:** the obvious implementation — `if (agent.active) { ...enforce caps... }` — has an inverted
failure mode that is easy to miss in review: deactivating an agent would drop it out of the capped
branch and into the uncapped "anybody can bet" path. The safety control would *remove* the limit it
exists to impose. A test asserts a deactivated agent cannot bet 50 tMSTC, not merely that it cannot
bet over its cap.

**Cost:** one extra branch, and a deactivated agent cannot place even a tiny bet. That is the
intended meaning of deactivation.

**Evidence:** `contracts/test/AuspexMarket.test.ts` — "blocks a deactivated agent entirely —
deactivation must not un-cap it".

---

### ADR-021 — A silent resolver cannot lock funds: `invalidateStale` is permissionless

**Decided:** anyone may call `invalidateStale(marketId)` once `resolveDeadline` has passed with no
resolution finalised. The market becomes `INVALIDATED` and every bettor is refunded their exact
stake.

**Why:** `docs/CONTRACTS.md` already made permissionless `finalizeResolution` a stated property —
"no privileged party can block a payout by going silent". That guarantee only covered a resolver who
*had* proposed something. A resolver who never showed up at all would have left funds stranded in the
contract with no way out. This closes that hole using `resolveDeadline`, which was otherwise a stored
field nothing read.

**Cost:** ~10 lines, and a market whose resolver is merely late can be invalidated by anyone once the
deadline passes. The deadline is set at creation, so that is a scheduling decision, not an accident.

**Alternative rejected:** an admin-only rescue. It would reintroduce exactly the trusted party the
permissionless design exists to remove.

---

### ADR-022 — Admin `forceInvalidate` is gated on 3 recorded challenges

**Decided:** the admin escape hatch requires `challengeCount >= MAX_CHALLENGES` (3). It cannot be
used on a market that has not visibly deadlocked on-chain.

**Why:** an unconditional "admin can cancel any market" function is a hole big enough to sink the
trust argument — it would let us void a market we disliked and refund our way out. Gating it on
three challenges already recorded on-chain means the justification is public before the power is
available.

**Cost:** a market that needs cancelling for some other reason has to go the honest route —
`proposeResolution(INVALID, evidenceUrl)`, which still passes through the challenge window.

**Evidence:** tests assert `TooFewChallenges(0, 3)` before the challenges and success after them.

---

### ADR-023 — The MST RPC hides custom-error data in the error *message*

**Decided:** decode revert data ourselves — check `error.data`, then `error.info.error.data`, then
scrape the hex out of `error.message` — and run it through `Interface.parseError`.

**Why:** on a reverting `eth_call`, MST Testnet returns
`"execution reverted: 0x594f797d<abi-encoded args>"` as the JSON-RPC error *message*, with no
standard `data` field. ethers v6 therefore cannot decode it: `error.revert` comes back `null` and
naive string matching on the error name fails. This is not theoretical — it broke the first run of
the post-deploy smoke test.

**Why it matters beyond the script:** Phase 5's whole demo beat is pointing at a transaction that
shows `AgentPerTxCapExceeded(attempted, cap)`. If the UI can only render "execution reverted", the
most important piece of evidence in the submission becomes illegible.

**Cost:** ~10 lines of defensive parsing, kept in one helper rather than scattered.

**Evidence:** `contracts/scripts/smoke.ts` prints
`SpecHashAlreadyUsed(0x1b9f…)` decoded from a live revert;
`keccak256("SpecHashAlreadyUsed(bytes32)")[0:4] == 0x594f797d` confirms the selector.

---

### ADR-024 — Storage-based `ReentrancyGuard`, not the transient-storage one

**Decided:** use OpenZeppelin's classic `ReentrancyGuard` even though the chain is Cancun-capable
and `ReentrancyGuardTransient` (TSTORE) is available.

**Why:** TSTORE support on MST Testnet was verified with `eth_call` state-override probes, not with
a real state-changing transaction. The one function that guard protects is `claim()` — the function
that pays people. Betting payouts on an EVM feature we have probed but not exercised in production
trades a real risk for a saving that is worth nothing here, because `baseFeePerGas` is 0.

**Cost:** two storage slots' worth of gas per claim, on a chain where gas is free.

**Revisit if:** a later phase exercises TSTORE in a real transaction and it behaves.

---

### ADR-025 — One Postgres driver (`pg`), not Neon's serverless HTTP client

**Decided:** connect with `pg` + `drizzle-orm/node-postgres` everywhere — Vercel, scripts and
tests alike — rather than `@neondatabase/serverless`.

**Why:** the central idempotency mechanism in `docs/ARCHITECTURE.md` §4 is
`SELECT … FOR UPDATE SKIP LOCKED` **inside a transaction**. Neon's HTTP driver issues each
statement as its own request and cannot hold one open, so the row lock that stops two concurrent
ticks claiming the same intent would simply not exist. Neon's WebSocket `Pool` can hold a
transaction, but it only speaks to Neon — so the migration tests could never run against anything
else, and neither could a judge cloning the repo.

`pg` speaks the ordinary Postgres wire protocol, which Neon serves on its pooler endpoint and
which any local Postgres serves too. One driver, one code path.

**Cost:** a TCP + TLS handshake on a cold lambda instead of a single HTTP request. Measured at
~0.5s from here, against ~10-25s when Neon's free tier has scaled the compute to zero — the
driver is not what makes a cold start slow.

**Also decided here:** TLS is on by default and only `sslmode=disable` turns it off
(`lib/db/ssl.ts`). Deriving "use TLS" from the *presence* of `sslmode` means a connection string
that omits it connects in clear text. The migration test caught exactly that.

---

### ADR-026 — The indexer's projection is a pure fold that de-duplicates its own input

**Decided:** `lib/indexer/project.ts` takes a list of decoded logs and returns market state, with
no database, no network and no clock — and it discards a repeated `(txHash, logIndex)` itself
rather than trusting the caller to have done so.

**Why a fold:** replay then costs nothing to reason about. Re-reading from the deployment block
recomputes the same answer from the same inputs, so "have I processed this log before?" is never
asked. It also means Phase 2's exit criterion — *the indexer reconstructs correct market state
from the Phase 1 smoke-test events* — is a unit test over logs captured from the real chain, not
an integration test needing a live database.

**Why it de-duplicates anyway:** `chain_events` already refuses duplicates with
`UNIQUE(tx_hash, log_index)`, so in the running system the fold never sees one. But `BetPlaced`
*adds* to a pool, so a duplicate silently doubles someone's money, and a function whose
correctness depends on its caller having deduplicated is one refactor away from being wrong. The
test that asserts this failed on the first run and is the reason the guard exists.

**Cost:** one `Set` of `"hash:index"` strings per projection.

---

### ADR-027 — Sign, persist, *then* broadcast — so a crash cannot produce a second transaction

**Decided:** `lib/intents/engine.ts` builds and signs a transaction, writes the **signed raw
bytes and their hash** to `onchain_intents`, and only then broadcasts.

    PENDING ──sign──> SIGNED ──broadcast──> BROADCAST ──receipt──> CONFIRMED | REVERTED

**The problem it solves:** "write a row, then send" narrows the dangerous window but does not
close it. A process can die between `eth_sendRawTransaction` returning and the `UPDATE`
committing, leaving a transaction on chain that no row knows about. Retrying then re-signs — and
a re-signed transaction with a fresh nonce is a **second transaction**.

**Why this closes it:** a signed transaction is immutable and its hash is fixed before it leaves
the process. Every recovery path is therefore a *rebroadcast of identical bytes*, which the
network deduplicates by hash:

| crash point | recovery | transactions on chain |
|---|---|---|
| after signing, before broadcast | rebroadcast stored bytes | 1 |
| after broadcast, before receipt | rebroadcast stored bytes (`already known`) | 1 |
| after receipt, before commit | re-poll the stored hash | 1 |

A retry is not "try again", it is "finish the thing that was already decided".

**Supporting choices:** nonce selection is `max(node pending count, our highest recorded nonce + 1)`
under a Postgres advisory lock on the sending address — the node's count can lag a transaction we
sent moments ago, and our records cannot know about one sent by the deploy script. Claiming a row
takes a **lease** (`next_attempt_at` pushed forward) rather than holding the transaction open
across a 45-second receipt wait, which would exhaust a free-tier connection pool. An intent that
reached `SIGNED` is never abandoned, however many attempts fail: its transaction may be in a
mempool right now, and forgetting it is how a duplicate gets sent later.

**Evidence:** `pnpm --filter web crash-test` kills the worker with `process.exit(1)` at both
points against the real testnet. Result: hash `0xeabf2271…befe83` unchanged across both crashes,
one intent row, one `MarketCreated` log, `marketCount()` 2 → 3.

**And the contract refuses duplicates independently.** `createMarket` reverts on a `specHash` it
has seen. Two mechanisms, neither relying on the other.

---

### ADR-028 — `/markets` reads the chain directly; the database only annotates

**Decided:** the markets page calls `getMarket()` on the contract for every market and renders
*those* numbers. Indexed rows supply only what a `view` call cannot — the creating transaction
hash and the bet count — and are labelled as indexed.

**Why:** the failure mode of a mirror is silently showing yesterday's numbers as though they were
current. A prediction market whose pool balances are stale is worse than one that admits it
cannot reach the chain. Reading the contract directly means a broken, lagging or sleeping indexer
cannot put a wrong number on the page; the page shows the real error instead.

It also gives the projection an independent check for free: when the two disagree, the page says
so in an `indexer drift` badge rather than hiding it.

**Cost:** one `eth_call` per market per page load. At three markets on a 3-second-block chain
with zero base fee, this is not a cost.

**Revisit if:** market count grows past roughly fifty, at which point the reads should be batched
or the projection trusted with a freshness indicator.
