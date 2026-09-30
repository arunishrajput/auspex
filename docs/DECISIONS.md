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

---

### ADR-029 — No MinHash. Exact comparison, because the plan's reason for MinHash does not apply

**Decided:** `docs/BUILD_PLAN.md` specified "normalise → shingle → MinHash/Jaccard". MinHash is
not implemented. Clustering compares all pairs exactly.

**Why:** MinHash exists to avoid all-pairs comparison when you have millions of documents. A tick
clusters at most 200 items, which is 19,900 comparisons of small string sets — **measured at
under 20ms**, against a tick that spends 20 seconds on network I/O. So it buys nothing here, and
it is an *approximation*, which means false negatives. A false negative in this stage means two
reports of one story fail to merge and the event never reaches its second source, so the pipeline
silently stalls.

Hard rule #10 says prefer the boring solution you can fully defend. Exact comparison at this
scale is both faster to defend and strictly more correct.

**Cost:** clustering is O(n²) and would need revisiting above a few thousand items per pass.
`MAX_ITEMS_PER_CLUSTER_PASS` makes that bound explicit rather than implicit.

**Revisit if:** a pass ever needs to consider more than ~2,000 items.

---

### ADR-030 — An unavailable model means "do not merge"

**Decided:** borderline pairs (0.25–0.50) with no model verdict are **not** merged. A rate limit,
a timeout, a billing failure and a malformed response all converge on the same outcome: no merge.

**Why:** the two failure directions are not symmetric.

- *Failing to merge* two reports of one story leaves two events each holding one source.
  `CONFIRMED` needs two, so nothing confirms and nothing happens. A quiet no-op.
- *Wrongly merging* two different stories produces one event carrying two genuinely independent
  publishers. That **confirms**, proposes a market about a story that does not exist, and puts a
  fabricated question in front of a human and eventually on-chain.

One failure costs a tick. The other attacks the credibility of the whole system. So the default
is the no-op, and it is the default *by construction*: `planClusters` merges on an explicit
`true` and on nothing else, so every unavailability path reaches it as an absent map entry.

**Cost:** with no LLM configured, confirmation depends on finding pairs above 0.50 — which in
practice means near-identical headlines, which syndication discounting then collapses. The
honest statement is that the deterministic pipeline alone ingests, deduplicates and displays,
but confirms rarely.

**Evidence:** `cluster.test.ts` asserts the unmerged default and that a `false` verdict keeps a
pair apart; `client.test.ts` forces every failure kind and asserts none throws.

---

### ADR-031 — Cluster on headlines only, and set the thresholds from measured data

**Decided:** similarity is IDF-weighted Jaccard over **headline** tokens. Bands are 0.50 (merge)
and 0.25 (ignore), replacing the plan's 0.60 / 0.40.

**Why the plan's numbers went:** a threshold is a property *of a measure*. The plan's 0.6/0.4 was
written before this measure existed. `pnpm --filter web calibrate` reads the real distribution off
live feeds, and it was run before choosing.

**Why headlines and not headline + summary** — measured on 228 articles from 70 publishers:

| Pair                                    | title | title+summary | truth     |
|-----------------------------------------|-------|---------------|-----------|
| ECB raises rates — AP vs NYT            | 0.438 | 0.420         | same      |
| Fed raises rates — ABC News vs ABC13    | 0.424 | 0.382         | same      |
| Najaf flights — Reuters vs Al Jazeera   | 0.357 | 0.211         | same      |
| Taiwan CB holds vs ECB hikes            | 0.370 | **0.411**     | different |

Including the summary moves true pairs *down* and the false pair *up* — it inverts the ranking on
the last two rows. Summaries are mostly shared boilerplate, so they add vocabulary two unrelated
finance stories have in common while diluting the rare entity names that distinguish them. A
headline is written to be discriminating in twelve words, and it is the one field every source
supplies.

**Why the band is wide:** the two genuinely-different pairs in the sample (0.370, 0.354) sit
*interleaved* with true pairs (0.373, 0.360). **No threshold separates them.** The band is drawn
to contain that ambiguity rather than to pretend it away, and the model is asked only inside it.

**Cost:** empirical constants, only as good as the distribution they were read from. The script
that produced them is committed, so they are checkable and re-derivable.

---

### ADR-032 — The injection scanner is triage, not defence, and it is scoped per signature

**Decided:** deterministic signatures mark items; flagged items are **still processed**. The
`invisible-characters` signature reads the headline only.

**Why flagged items are not dropped:** dropping them would make a blocklist load-bearing, and
blocklists are bypassable by definition. It would also hand anyone who can get a headline into
Google News a way to *delete* stories from the pipeline by making them look malicious. The real
defence is structural — news text never enters a system instruction, it is sealed inside
`<untrusted_content>` in a user-role message, and every model output is schema-constrained at the
API and re-validated with Zod.

**Why the scope restriction:** scanning article bodies for zero-width characters flagged three
Guardian articles on the first live tick — U+200B, U+200C and U+2060 through the standfirsts.
That is the Guardian's typesetting, not an attack. A badge that fires on a major publisher's
ordinary output every tick teaches the Phase 4 reviewer to ignore it, which is worse than having
no badge. A *headline* has no legitimate reason to carry a zero-width joiner, so the signature
still fires where it means something.

**Cost:** an injection hidden only in body whitespace is not flagged. It is still delimited,
still sealed, and still cannot reach a system instruction.

**Evidence:** `injection.test.ts` covers both directions; the dashboard's worked-example panel
shows the sealed prompt for a constructed hostile headline.

---

### ADR-033 — Batch every write in a tick; round trips, not work, are the cost

**Decided:** the clustering pass writes events, members, audit rows and confirmations in batched
statements, and skips updates for rows whose state did not change.

**Why:** the first implementation issued one `INSERT` per cluster and two queries per event. On
200 items that is ~400 sequential round trips, and against Neon in `aws-us-east-1` (~0.5s per
round trip from a laptop) **one tick took 420 seconds**. A Vercel function has 60. The computation
was never the problem — 19,900 similarity comparisons take under 20ms.

Batched, the same tick measures **48 seconds** locally, and most of that remainder is still
laptop→Neon latency that does not exist in production, where the function and the database are in
the same region.

**Cost:** the write path is harder to read than a loop. The comments say why, and the alternative
does not fit in the runtime it has to run in.

**Evidence:** three consecutive live ticks — 420s, then 91s after batching, then 48s after also
reordering the model chain.

---

### ADR-034 — Prefer the model that answers, not the newest one

**Decided:** the fast chain is `gemini-3.1-flash-lite` first, `gemini-3.5-flash-lite` second.
Per-call timeout is 22s.

**Why:** measured across live ticks, `3.5-flash-lite` timed out twice and returned 503 once, while
`3.1-flash-lite` answered every time it was asked, in 4.9–6.1 seconds. Leading with the newer model
meant the budget was being spent on retries.

The timeout is a trade rather than a maximum: successful calls measured 5.2–13.6s so it must clear
~15s, but the timeout is also the price of a *failure*, and at 35s a single hung model consumed
more of the tick than every other stage combined.

**Cost:** we are one model version behind on this path. The chain means a 3.1 outage still falls
through. Both are overridable by environment variable without a deploy, which is what matters on
demo day.

**Related:** an earlier version logged `durationMs: 0` for failed calls, which made a 35-second
timeout look free in the tick report and delayed finding this. Failures are now timed.

---

### ADR-035 — The proposer picks a resolution source by label; it never types a URL

**Decided:** the market proposer's schema has no URL field. It returns a `resolutionSourceLabel`
that must be one of the `SOURCE_n` labels we issued for that event's own articles, and
deterministic code substitutes the real URL. A label we did not issue is discarded and the draft
becomes `SCHEMA_REJECTED`. The same restriction applies to time: the model returns
`closeInHours`, bounded, and deterministic code computes `closeTime` and `resolveDeadline`.

**Why:** this is the one field of the spec that is written to the chain *and* points somewhere. A
model that can type a destination can type one that does not exist, one that has expired, or one
that is hostile — and no JSON schema can tell the difference, because at the API `resolutionSourceUrl`
is a well-typed string whatever it contains. A model that can only pick from a menu can do none of
those things. It is the same mechanism `lib/news/adjudicate.ts` uses for `pairLabel`, applied where
the consequence is permanent rather than cosmetic.

It also makes hard rule #3 mechanical rather than aspirational: the model proposes *which of our
sources*, and deterministic code decides *what that means*.

**Cost:** the model cannot nominate a resolution source outside the event's own coverage — the ECB's
own website cannot be chosen for an ECB market unless a feed supplied it. That is a genuine loss of
specificity, accepted because the alternative is trusting a generated URL.

**Evidence:** `lib/proposer/draft.test.ts` asserts a URL placed in the label field is refused, and
that no `https://` string reaches the model at all.

---

### ADR-036 — The proposer uses the FAST model chain, not the SMART one

**Decided:** `draftProposal` calls `fastModelChain()` — `gemini-3.1-flash-lite` first.
`GEMINI_MODELS_SMART` stays defined for Phase 5 but drafts nothing.

**Why:** ADR-034 measured that `3.8-flash` returns 503 "high demand" and `3.5-flash-lite` times out,
while `3.1-flash-lite` answered every call. A model that does not answer drafts nothing, however
capable it would have been — and on the free tier the nominally-smarter chain is the one that does
not answer. The task is also narrow by construction: fill seven constrained fields from five
headlines, with every judgement call already removed into `schema.ts` and `validate.ts`.

**Cost:** specs are drafted by a small model, and the quality shows — see the two defects under
"what measurement changed" in `PROGRESS.md`. Both were fixed with deterministic checks rather than a
bigger model, which is the correct direction anyway: a check holds when the model regresses.

**Evidence:** live ticks. `3.1-flash-lite` drafted in 2.3s, 3.3s and 6.1s. One tick saw it fail and
`3.5-flash-lite` answer in 1.4s, so the fallback is load-bearing and not decorative.

---

### ADR-037 — `OnChainIntent` gains a signer kind; the worker never signs an EXTERNAL intent

**Decided:** `onchain_intents.signer` is `SERVER | EXTERNAL`. `claimIntent` excludes
`EXTERNAL + PENDING` rows entirely, and `plannedSteps` — a pure function — decides what a pass may
do. An `EXTERNAL` intent is signed by a browser wallet and only *settled* here.

**Why:** the human gate means the key that creates a market is on no server we run, so the intent
engine has to hold a row it cannot advance. Two ways of getting that wrong, both expensive:

- **signing it** is impossible, and `getDeployerWallet()` would either throw or, worse, succeed and
  create the market from the deployer — destroying the only claim the phase makes
- **rebroadcasting it** is a plain crash: `signed_raw_tx` is null, because those bytes only ever
  existed in the wallet

A column rather than an inference from `from_address`, because Phase 5 adds agent wallets whose keys
the server *does* hold, so "not the deployer" stops meaning "not ours".

Exclusion in the claim query rather than claim-then-skip: claiming burns an attempt and pushes
`next_attempt_at` forward, so an intent waiting ten minutes for a human would exhaust
`MAX_ATTEMPTS` before anyone clicked approve.

**Cost:** one more state to reason about, and ADR-027's "sign, persist, then broadcast" invariant now
has a second form — for `EXTERNAL`, the wallet fixes the hash and the server verifies it.

**Evidence:** `lib/intents/engine.test.ts` covers the full 6-status × 2-signer table, plus two
invariants: no broadcast is ever planned without bytes, and no signature is ever planned for a key
this process does not hold.

---

### ADR-038 — The reported transaction hash is verified against the node, never believed

**Decided:** `attachExternalBroadcast` accepts a hash only after `eth_getTransaction` confirms a
transaction exists with it *and* that its `from`, `to` and `data` match the authorised intent.

**Why:** the caller is a browser saying "I sent this", and a browser can say anything. Without the
check, anyone who could reach the server action could mark a proposal `APPROVED` by pasting an
unrelated hash, and the human gate would be decorative. `data` is the load-bearing comparison: it is
the calldata the server encoded from the stored spec, `specHash` included, so a wallet that signed a
different question produces different calldata and is refused.

The reverse direction is covered too — `prepareApproval` re-derives `specHash` from
`proposals.spec` and refuses to proceed if the stored hash disagrees, so a row edited after the
proposer wrote it cannot be signed.

**Cost:** up to five short polls (~6s) after the wallet returns, because a node can legitimately not
know a transaction for a second or two. Bounded, and it gives up rather than guessing.

---

### ADR-039 — Rejection is authenticated by a signature; approval is authenticated by the chain

**Decided:** approving needs no server-side authentication beyond a courtesy check — the contract's
`MARKET_CREATOR_ROLE` refuses anyone else. Rejecting requires an EIP-191 signature over a message
naming the proposal, its spec hash, the reason and a timestamp, verified server-side.

**Why:** the two are asymmetric. An approval proves itself, because only the authority's key can
produce a transaction the contract accepts. A rejection leaves **no on-chain trace**, so "I am the
authority" would be an unverified claim from a page, and anyone who could reach the server action
could clear the review queue. Hard rule #7 makes the rejections the evidence that the gate is real;
evidence anyone can forge is not evidence.

The message text is built on the server and sent to the browser to be signed, so the string the
wallet displays is the string the server verifies. Building it client-side would let the two drift,
and a signature over text nobody checked authenticates nothing.

**Cost:** rejecting costs a wallet prompt. The message says plainly that it moves no funds and sends
no transaction.

**Evidence:** `lib/approval/authority.test.ts` — wrong signer, replay against another proposal,
reuse after the reason was edited, expiry, a future timestamp, and a malformed signature all fail.

---

### ADR-040 — An aggregator redirect degrades to the publisher's front page

**Decided:** a resolution source URL is used verbatim when its host resolves to the publisher we
credited. Otherwise it becomes `https://<publisher-domain>/`. An article from a publisher not on the
independence allowlist cannot be a resolution source at all.

**Why:** the first live proposer run put
`https://news.google.com/rss/articles/CBMiqAFBVV95cUxQUkp6…` onto a spec. Phase 3 gets the
*publisher* right — it reads Google News's `<source url>` element rather than trusting the link — but
`raw_items.url` is still the redirect, and a value that is fine for "click through to read" is not
fine for "this is where the outcome is settled": it is opaque on the explorer, it expires, and it
does not demonstrably belong to the publisher named beside it.

**The obvious fix was wrong, and measurement said so.** The first attempt excluded redirect links.
Against the live database that starved the pipeline completely: **every** confirmed event's articles
were Google News redirects. That is structural, not luck — confirmation requires two independent
publishers, and only the aggregator carries one story from several of them, while the four direct
publisher feeds each cover different stories and so produce single-publisher events that stay
`OBSERVED` by design.

The front page is real, publisher-owned and stable, which the redirect is not. It is coherent as a
spec because "where to look" and "what to look for" are separate fields — `resolutionCriteria`
carries the exact fact. And it is never fabricated: the domain comes from our own allowlist.

**Cost:** a weaker resolution source on most markets. It is **shown to the reviewer as a warning**
before approval and marked `redirect link` on the article it came from, rather than quietly
substituted.

**Revisit if:** we ever resolve Google News redirects at ingest. That needs a network round trip per
article and a decoder for an undocumented format, which is why it is not in a 24-hour build.

---

### ADR-041 — The model's self-assessed risk is shown to the human, never used to filter

**Decided:** `ambiguityRisk` is required in the schema and rendered as a warning in `/review`. It
never causes a rejection.

**Why:** a model that wanted its market approved would rate itself `LOW`. Treating a self-assessment
as a gate is trusting the thing being gated. It is genuinely useful as a hint to a human — "the
meeting date could move" is worth reading — and worthless as a control, and the difference matters
enough to state in code.

Everything that *does* reject is a property of the text, checkable without the model's cooperation:
the label was issued or it was not, the question ends in "?" or it does not, the words are in the
unresolvable list or they are not.

**Related:** the model's own output is scanned with the same injection signatures the feed is
scanned with. Text that has passed *through* a model after being derived from a hostile headline is
still hostile, and `lib/proposer/validate.test.ts` asserts an echoed instruction is refused.

---

### ADR-042 — Notifications select on indexed columns, so they cannot fire early

**Decided:** `runNotificationPass` announces a market only when `markets.onchain_id` and
`markets.created_tx_hash` are both non-null and it has a `proposal_id`. Those columns are written
only by the indexer, only from a confirmed `MarketCreated` log.

**Why:** the exit criterion is "no notification fires before human approval", and the robust way to
satisfy it is to make the *selector* incapable of matching early rather than to add a check that
could be reordered away. An intent saying `BROADCAST` describes a transaction that may still be in
a mempool and may yet revert; a `created_tx_hash` describes one the chain has confirmed. The notify
stage also runs last in the tick, after the indexer, so within one tick the ordering is structural
as well.

`proposal_id IS NOT NULL` keeps the Phase 1 smoke-test markets and the Phase 2 crash-test market out
of the feed: they are real transactions and they are not products.

**Cost:** a notification lags market creation by up to one indexer pass. For a 3-second-block chain
that is seconds, and the approval path runs the indexer inline so the demo does not wait.

**Evidence:** four proposals sat `PENDING_REVIEW` through a live tick with
`notify: eligible 0, created 0` — nothing to announce, because nothing was on chain.

---

## Phase 5 — Member agents and the policy gate

---

### ADR-043 — The agent emits a fraction of its own cap, never an amount

**Decided:** `BetProposalSchema` has `stakeFraction: z.number().min(0).max(1)` and no field in which
a model can name an amount of tMSTC or wei. Deterministic code multiplies the fraction by the
member's per-transaction cap.

**Why:** this is ADR-035 (the proposer picks a resolution source by label, never types a URL) applied
where the consequence is money instead of a link. A model that can type an amount can type `1e30`,
or the right number with one digit too many, and the only thing between that and a transaction is a
`Math.min` that a later refactor might move. A fraction is bounded *by construction*: the worst
possible output, `1.0`, is the agent's own policy cap — a number a human already approved — and the
gate then clamps even that against five more limits.

The multiplication is done in basis points (`Math.round(fraction * 10_000)`) before any bigint
arithmetic, so `0.1 + 0.2` and `0.3` produce the same wei on every machine. The division floors,
which errs downward — the safe direction for a stake.

`Infinity` maps to **zero**, not to the cap. A nonsense fraction is a broken proposal, and the
fail-safe reading of a broken proposal is no bet; clamping it to the cap would turn garbage into the
largest bet allowed. `policyGate.test.ts` pins this.

---

### ADR-044 — The gate is two functions, and the split is about cost, not structure

**Decided:** `screenAgent` decides everything knowable *before* a model is asked — kill switches,
market state and timing, the category allowlist, on-chain registration, balances, headroom.
`policyGate` calls it internally and then judges the proposal and clamps the stake.

**Why:** a member whose kill switch is on, or whose policy does not allow the market's category,
should not cost an LLM call to refuse. On a free tier with a three-call budget per tick, screening
first is the difference between a pass that gets to the agents that can actually bet and one that
spends its allowance discovering that `kestrel` is halted.

It is *not* a second gate. `policyGate` re-runs the screen, so a caller that skipped it still gets
the full check, and a test asserts exactly that. The alternative — duplicating five conditions in
`run.ts` — is how two copies of a limit drift apart.

---

### ADR-045 — REJECT is terminal, DEFER writes nothing, and the distinction is the column

**Decided:** the gate returns a verdict of `PROCEED`, `REJECT` or `DEFER`. A `REJECT` writes an
`agent_decisions` row; a `DEFER` writes none and is logged instead.

**Why:** `agent_decisions` is unique on `(market_id, member_id, round)`, so **writing a row is
terminal** for that pair. This is the same trap ADR-030 and `draft.ts` describe for
`proposals.event_id`, and it costs more here: there, collapsing "no answer" into "bad answer" lost a
market that should have existed; here it freezes an agent out of a market permanently.

The rule is whether the reason can ever change for this market and this member:

| Reason | Verdict | Why |
|---|---|---|
| market not OPEN, betting closed | REJECT | a market never reopens |
| category not on the allowlist | REJECT | a market's category is fixed at approval |
| abstained, confidence below threshold | REJECT | the same answer at temperature 0 |
| kill switch, global or per member | **DEFER** | a flag someone can flip back |
| agent not registered, or deactivated | **DEFER** | one admin transaction away |
| owner mismatch | **DEFER** | fixed by re-registering; loud, because payouts go elsewhere |
| daily budget spent | **DEFER** | resets at 00:00 UTC |
| wallet unfunded | **DEFER** | someone can fund it |

A deferral is still recorded with its reason, aggregated once per pass rather than once per pair —
otherwise a halted member writes four identical audit rows every tick for ever.

**The subtle one:** `agentRemainingOnMarket` returns `0` for an agent the contract does not know, so
a naive "no headroom left" check would read an *unregistered* agent as one whose cap is exhausted and
write a terminal row for a market it has never bet on. The check is guarded on `registered && active`
and there is a test for each.

---

### ADR-046 — The on-chain caps are twice the off-chain ones, and derived rather than stored

**Decided:** `onChainCapsFor` returns `perTxCap = 2 × policy.perTxCap` and
`perMarketCap = 2 × perTxCap`. There is no column holding the on-chain caps; the chain holds them
and `/agents` reads them live and flags any disagreement.

**Why two, not one.** Equal caps would put every legitimate bet exactly on the boundary the contract
reverts one wei above, so a rounding difference between two codebases becomes a failed bet in front
of a judge. Making the chain's cap looser also makes the honest claim narrower, and it is worth
saying out loud rather than gliding past: a total server compromise that bypassed the gate could
stake up to **twice** the intended per-transaction amount before the chain refused it. What the
contract guarantees is that the damage is bounded by a number **no server can change** — not that it
equals the number we would have chosen. Both numbers are drawn side by side on `/agents` so a reader
can see they differ and ask why.

**Why derived.** A second copy in Postgres is a third number to keep in sync and the first to go
stale. Deriving it means the only possible disagreement is "a policy changed and nobody
re-registered", which is a real operational state, so `/agents` shows it as drift rather than
repairing it silently — silently re-registering would let an off-chain edit loosen an on-chain cap,
which is precisely what the on-chain layer exists to prevent.

---

### ADR-047 — The signing wallet is a property of the intent row, and "no key here" is not an error

**Decided:** `resolveSigner(fromAddress)` returns the deployer wallet, a decrypted agent wallet, or
`{ ok: false }`. `processIntent` treats `{ ok: false }` as a deferral that **does not consume an
attempt**, via `releaseUnattempted`.

**Why:** Phase 2's engine signed everything with the deployer. Phase 5 adds one wallet per member,
and — deliberately — **`DEPLOYER_PRIVATE_KEY` is still not in Vercel.** So a production tick can
legitimately claim a `REGISTER_AGENT` intent it cannot sign, because that key is on the operator's
laptop. Counting that as a failed attempt would let `MAX_ATTEMPTS` expire while nothing was wrong,
and `ABANDONED` on a `PENDING` intent is how an agent silently never gets registered.

The result is worth stating plainly: **the deployed application holds no key that can create a
market, resolve one, grant a role, pause the contract or change an agent's caps.** Every key it
holds is capped by the contract and holds no role at all. Registration is one local command.

A decryption failure is also `{ ok: false }` rather than a throw. If the encryption secret rotated or
a row was tampered with, the right move is to leave the intent alone and say so — never to proceed
with a key we could not authenticate, and never to abandon a bet a corrected secret would make
signable again.

---

### ADR-048 — An agent key ciphertext is bound to its agent address

**Decided:** `encryptAgentKey(privateKey, agentAddress)` uses the lowercased address as AES-GCM
additional authenticated data, so a ciphertext only decrypts for the row it belongs to.

**Why:** `members.agent_address` is what `registerAgent` bound to an owner on chain. A ciphertext
moved between rows — by an UPDATE, a botched restore, a deliberate swap — would otherwise produce a
wallet signing under a stranger's caps and paying winnings to a stranger's address. GCM gives that
check for one extra argument.

**What this is not.** It is not the control, and `docs/TRUST_MODEL.md` says so: a server compromised
enough to read the ciphertext can read `AGENT_KEY_ENC_SECRET` from its own environment. What
encryption at rest buys is that a *database* leak — a backup, a branch, a screenshot of a query — is
not a set of usable keys. The on-chain caps are what bound the risk.

---

### ADR-049 — The agent is told it is forecasting, because telling it to retrieve produced only abstentions

**Decided:** the agent's system instruction states that the market asks about something that has not
happened, that the articles will not contain the answer, and that it should take the side it judges
more likely than not. `ABSTAIN` is reserved for material that is about something else entirely.

**Why — measured, not reasoned.** The first live pass produced **four abstentions out of four**, with
rationales like "the sources discuss past interest rate decisions". The agents were right about the
evidence and wrong about the task, and the prompt was why: it told them to abstain when "the material
does not support either side", while the *proposer* is explicitly instructed to ask about the next
step, the consequence, or the confirmation that has not happened yet (ADR-035's sibling rule).

So two prompts, each sensible read alone, composed into a pipeline that could never place a bet.
Forecasting under uncertainty is the activity; "the answer is not in the newspaper" is a category
error. This is the third time in this build that reading real output found something no test would
have (ADR-031, ADR-040), and the pattern is the same: the defect was in how two correct components
met.

`ABSTAIN` remains a first-class answer and the gate still rejects it with a reason. An abstention now
**short-circuits every later check**, so the row says `ABSTAINED` and nothing else — `confidence` and
`stakeFraction` describe a position that was declined, and reporting them as separate failures added
two sentences and no information.

---

### ADR-050 — The over-cap bet is one wei over, and it is a script rather than a test

**Decided:** `scripts/over-cap-bet.ts` sends `onChainPerTxCap + 1` wei from a real registered agent
wallet, with the policy gate deliberately not consulted, and records the decision before sending.

**Why one wei.** A wildly oversized bet reverting proves almost nothing — any threshold anywhere
would stop it. One wei over proves the boundary is exactly where the contract says it is. It is also
the same boundary `policyGate.test.ts` pins from the other side, where a request of exactly the cap
passes unreduced and `cap + 1` clamps back down. Two independent layers agreeing on one wei is the
claim; neither is asserted from the other.

**Why a script and not a unit test.** The exit criterion is a **reverted transaction on MSTScan**.
The revert reason is decoded by the explorer itself — `AgentPerTxCapExceeded(attempted, cap)` with
both numbers — because the source is verified, and that is a thing a judge can open rather than a
thing we assert. It also exercises the engine's `FALLBACK_GAS_LIMIT` path, which exists precisely
because `eth_estimateGas` cannot price a transaction that reverts.

The script proves the second half too, by reading the chain afterwards: the market's pools are
unchanged and the agent's per-market spend is unchanged, so the refusal cost nothing but gas. The
decision row stores `final_stake_wei = NULL`, so a refused bet cannot consume the daily budget of the
agent it was testing.

**Run it with:** `pnpm --filter web agents:over-cap`.

---

### ADR-051 — The agents stage has a deadline, absolute from the start of the tick

**Decided:** `runAgentPass` takes `deadlineMs` and checks it before admitting a (market, member) pair
and again immediately before calling a model. Past it the stage stops and reports `out of time for
this tick`. `tick.ts` sets it to `tickStart + 38s`.

**Why:** a call budget bounds how many models are asked, not how long they take. A tick's allowance is
now nine calls across three stages and `GEMINI_TIMEOUT_MS` is 22,000, against `maxDuration = 60` on
the serverless function. Those numbers do not multiply out safely.

The failure mode is what forces the fix rather than a note in "known gaps". An over-running tick is
killed mid-flight, so it returns no report **and never writes its own audit row** — the one tick that
went wrong is the one that leaves no trace, which is precisely what hard rule #7 exists to prevent. A
stage that yields produces a report saying what it did not get to, and the next tick continues.

**Why absolute rather than a per-stage budget.** The agents stage runs fourth. If clustering was slow,
the right behaviour is for the agents to do *less*, not to start a fresh 38-second allowance on top of
a tick that has already spent 40. An absolute deadline expresses that without any stage needing to
know about the others.

**Where the check is not.** Never between writing a decision row and creating its intent. Committed
work is finished; only *new* work is declined. `resumeApproved` exists for the crash case and would
cover it anyway, but a deadline that could strand an approved bet would be trading one silent failure
for another.

**Measured:** production `POST /api/tick` returned 200 in **15,058 ms** with zero stage errors after
this phase, against 14,900 ms before it — but on a pass that made no agent model calls, so the worst
case remains unmeasured. The deadline is what makes the unmeasured case safe.

---

### ADR-052 — Resolution needs a human signature, not just deterministic validation and a window

**Decided:** `proposeResolution` is signed by a human's browser wallet, exactly as `createMarket` is.
The resolution agent drafts an outcome; it cannot send one. `RESOLVER_ROLE` and `CHALLENGER_ROLE` were
granted to the BridgeKey wallet
(`0xA9F68fDf84388fa548a685085E2bee0e5b311fF1`) to make that possible.

**Why the obvious alternative was rejected.** Hard rule #3 permits a decision to pass through
deterministic code *or* a human *or* the contract, and a server-signed resolution would technically
satisfy it: the outcome is schema-constrained, the evidence URL is substituted from our own record,
and the contract holds the result for a challenge window before anyone is paid. We nearly built that.

It fails on one number. **The challenge window is 120 seconds and immutable.** Nobody vetoes anything
in 120 seconds. If that window were the only thing between a model emitting `YES` and a payout, then a
model would be deciding who gets paid, and the project's central claim would be decoration. The
optimistic-oracle shape — AI proposes publicly, a human vetoes within a window — is a real design and
a defensible one, but it needs a window measured in hours. Ours is immutable at two minutes, by an
earlier decision we do not want to undo (ADR-022: an admin who could shrink the window could defeat
it).

**What it costs, stated plainly.** The BridgeKey wallet no longer holds "`MARKET_CREATOR_ROLE` and
nothing else" — a sentence `PROGRESS.md` used to lean on. The honest replacement is narrower and
still checkable on MSTScan: it holds **every role that requires human judgement and none that confers
power**. It cannot register agents, change a cap, or pause the contract, because it does not hold
`DEFAULT_ADMIN_ROLE`. `verify:resolution` asserts all four of those facts with live `hasRole` calls.

**The separation we did not make.** A market creator and a resolver should be different people, and
here they are one wallet. That is a property of a solo project, not a design commitment:
`humanResolverAddress()` reads `HUMAN_RESOLVER_ADDRESS` and falls back to the authority, so splitting
them is a configuration change plus two `grant:testnet` calls. `/resolve` says so on the page rather
than letting a reader assume otherwise.

**Evidence:** `grantRole(RESOLVER_ROLE)`
`0x886d021b0c4fe46674e685fd9eea17901f6ca1458d1ada6ed06c01bb1f7da4e2` (block 5,796,170) and
`grantRole(CHALLENGER_ROLE)`
`0xf1ce96cf43e44e674f58d6c082f8bfe50274e16d29773de57984774c0ad14268` (block 5,796,177).

---

### ADR-053 — The resolution agent does not choose its own evidence

**Decided:** candidate evidence articles are selected by IDF-weighted Jaccard similarity between the
market's question and each article's headline, restricted to articles ingested since the market was
created, ranked, and labelled `EVIDENCE_1…n`. The model receives six articles it did not select, in an
order it did not set.

**Why:** a model that picks which sources to read has already chosen the answer. Retrieval is the
decision that determines the outcome far more than the reasoning on top of it, so it belongs in
deterministic code — the same measure Phase 3 clusters with, calibrated the same way (ADR-029).

The recency filter carries as much weight as the ranking. An article published before the market
opened cannot report the thing the market asked about; at best it is the story the market was *created
from*. Those are excluded from ranking, and when one arrives with no publication date and slips
through, `validate.ts` turns it into a warning the human sees rather than silently trusting it.

**Cost:** a market whose outcome is reported under wording the headline similarity misses gets no
draft that tick. The floor is set at `BORDERLINE_THRESHOLD` (0.25) rather than the merge threshold for
exactly that reason — offering an article is not asserting it is relevant, because the model still has
to find a sentence in it that settles the question, and the validator still has to find that sentence
in the text.

---

### ADR-054 — The model must quote the sentence, and the quote is verified against the text it was given

**Decided:** `settledByQuote` is required for every settled outcome and must appear in the labelled
article **as a contiguous run of at least four words**, compared case- and punctuation-insensitively.
A paraphrase fails. A draft whose quote is not found is refused before a human sees it.

**Why:** this is the check that turns "read the model's summary and agree with it" into a job a human
can actually do well. A resolver is given one sentence and one link, and the remaining work is a
Ctrl-F. It is also the only mechanical defence against confabulation available here: a model that
invents a source it was not given produces a quote that is not in the text, and the comparison is
against *the bytes the model actually saw*, truncation included — which is why `IssuedEvidence` stores
that text rather than re-reading the article.

**Why four words.** "He said yes" would match half the corpus. Three words is noise; four is the
shortest span that is plausibly a quotation.

**Cost:** a correct outcome stated in the model's own words is rejected. That is the right trade: the
draft is retried on the next round with the same evidence, and an unverifiable quote in front of a
resolver is worse than no draft at all.

---

### ADR-055 — `UNSETTLED` is a fourth outcome, and it writes no row

**Decided:** the model may return `UNSETTLED`, which is not one of the contract's outcomes. It
short-circuits every other validation check and produces **no `resolution_drafts` row** — only an
audit entry. `UNRESOLVED`, the contract's own "no outcome" value, is excluded from the schema
entirely, because `proposeResolution` reverts on it.

**Why:** `resolution_drafts` is unique on `(market_id, round)`, so a row is terminal for that round. A
market that closed an hour ago usually has nothing reporting its answer yet, and "not yet" is the
correct answer — writing it as a rejection would spend the round's only draft slot on a condition that
resolves itself when the next articles arrive. This is the same three-versus-two-outcomes distinction
that ADR-045 got wrong first in Phase 5 and that Phase 4's `proposals.event_id` got wrong before that:
**before writing a terminal row, ask whether its reason can ever change.**

Keeping "I don't know" and "no outcome" as different words is the other half. Collapsing them would
make the model able to express an unresolvable state *as an outcome*, which is the one thing the enum
exists to prevent.

---

### ADR-056 — Auto-claim is keyed on `previewPayout`, not on our own decision rows

**Decided:** the claim worker iterates settled markets × agent wallets and asks the contract
`previewPayout(marketId, agent)`. Anything non-zero gets a `CLAIM` intent. `PROGRESS.md` had planned
to key it on `agent_decisions` instead.

**Why the departure:** `previewPayout` is the contract's own answer to "what would you pay this
address right now", and it already returns 0 for an unsettled market, a losing side, a zero stake and
an account that has already claimed. Keying on it means there is **no number in Postgres that can
disagree with the payout**, a stake placed outside the normal path is still claimed because the chain
knows about it even though no decision row does, and a double claim is impossible for two independent
reasons — we never try, and `claimed[marketId][msg.sender]` reverts if we did.

**Cost:** one `eth_call` per (settled market, agent) pair per pass. Bounded at four claims per pass and
a handful of markets, so it is a few calls on a chain where reads are free.

---

### ADR-057 — `invalidateStale` is permissionless and deliberately not automated  ⟵ **superseded by ADR-066**

**Decided:** the keeper runs `closeMarket`, `finalizeResolution` and `claim` on a timer. It does
**not** run `invalidateStale`. That call is exercised by hand in `scripts/lifecycle.ts`.

**Why:** invalidation refunds every bettor and destroys the market. Running it the instant
`resolveDeadline` passes would mean our own resolver being ten minutes late costs everyone their
market — a policy nobody asked for, enforced by a cron job. The contract made the call permissionless
precisely so the decision belongs to whoever is harmed by the delay, and a judge can make it from
their own wallet. Automating it would quietly take that back.

**Cost:** a market with a genuinely absent resolver stays unsettled until somebody acts. The UI says
so on the market detail page — "past — anyone may call `invalidateStale` and refund every bettor" —
rather than leaving a reader to work it out.

**Superseded by ADR-066.** That cost was paid, by market #2, and it was too high: "until somebody
acts" turned out to mean "forever", with a bettor's stake locked in the contract.

---

### ADR-058 — The keeper signs with an agent wallet, because none of its calls needs a role

**Decided:** `closeMarket`, `finalizeResolution` and `claim` are signed by whichever agent wallet holds
the largest balance above a gas floor. Not the deployer.

**Why:** production holds no deployer key by design, so a keeper that needed one would be a keeper
that only worked on a laptop. More to the point, all three calls are permissionless in the contract,
and signing them from a wallet that holds **no role at all** is the claim executed rather than
asserted: *nothing privileged is needed to finish a market.* The market detail page prints the signing
address for every call, so a reader can check it.

Picking the richest funded agent rather than a fixed one means a single drained wallet does not stop
markets being finished. A pass with no funded candidate reports that and queues nothing, rather than
signing a transaction that cannot mine.

**Cost:** an agent wallet spends a little of its balance on gas for work that is not its own betting.
Measured at roughly 0.0001 tMSTC per call on this chain, against a 0.0005 floor and a 0.001 gas
reserve the policy gate already holds back.

---

### ADR-059 — The Phase 6 lifecycle is proved on a market created for it, labelled on chain

**Decided:** `scripts/lifecycle.ts` creates its own market with a 70-second close time and bets on
both sides, then drives create → bet → close → propose → challenge → re-propose → finalize → claim,
plus a double claim and a losing claim that both revert. The market says
`[Phase 6 lifecycle test <id>] Not a product market.` in its own on-chain question text.

**Why not the real markets:** #4–#7 close on 2026-09-30 and carry live agent stakes. They are the ones
worth resolving in the demo and they cannot be resolved today. **Why not markets #1–#3:** each has a
single bettor, so the parimutuel payout degenerates to a refund of that bettor's own stake — it
demonstrates the arithmetic without exercising it. A two-sided market is the only way to show a real
split today, and no market on chain had two sides.

**The label is in the question text, not in our database**, for the same reason markets #1–#3 carry
theirs there: the label has to travel with the market to MSTScan and survive being quoted out of
context. Hard rule #2 is about never presenting test data as real, and a disclaimer that lives only in
our own UI is one screenshot away from being lost.

**The agent bet is an operator action and is recorded as one.** It did not go through the policy gate,
no model was asked, and **no `agent_decisions` row was written** — the audit log says exactly that. It
exists because demonstrating that `claim()` pays the agent's registered *owner* and not the agent
requires an agent with a winning stake. The stake is inside the agent's caps and the chain enforced
them regardless of what the script believed.

**The payout is checked three independent ways** — hand-computed parimutuel, `previewPayout`, and the
owner's balance delta measured at explicit block tags either side of the claim. A contract test can
prove the arithmetic; only this proves the arithmetic *and* that the money arrives at the right
address on a real chain.

---

### ADR-060 — Retrieval scores question *coverage*, not similarity — and the first threshold was wrong

**Decided:** candidate evidence is ranked by IDF-weighted **coverage of the question's own terms**
(`lib/resolution/retrieve.ts`), not by the Jaccard similarity Phase 3 clusters with:

```
coverage = Σ idf(t) for t in question ∩ article  /  Σ idf(t) for t in question
```

Asymmetric on purpose. The floor is **0.12**.

**Why, and how it was found.** The first implementation reused `weightedJaccard` from
`news/similarity.ts` — the obvious choice, and it returned **zero candidates for all four live
markets** on the first real run. The cause is structural rather than a tuning problem: Jaccard divides
by the weight of the **union**, and a market question is long by construction while a headline is
short. A headline reporting exactly the thing the question asked about shares only its rare terms and
differs on everything else, so the union dominates and the score collapses. No threshold on that
measure separates "answers the question" from "unrelated", because the measure answers a different
question — *are these the same story?*

Coverage asks the retrieval question instead: how much of what is being asked about does this article
mention? A longer article is not punished for its extra words, because those are not what was asked.

**Then the threshold was wrong too, which is the more useful half of this entry.** 0.18 was chosen
because it looked reasonable. Measured against the live corpus it missed the Washington Post article
for market #5 — a genuine match on the same story — **by 0.003**. The observed distribution:

| Score | Article | Truth |
|---|---|---|
| 0.297 | Iran war live: Trump says he did not offer Tehran sanctions relief | same story |
| 0.177 | FEMA can't condition security grants on election changes, judge says | same story |
| 0.165 | Trump denies willingness to give Iran sanctions relief | same story |
| 0.087 and below | eight unrelated articles, then 96% of pairs at exactly 0 | unrelated |

True matches at 0.165 and above, false ones at 0.087 and below. 0.12 is inside that gap. This is the
third time this project has hit the same shape of defect — ADR-029 (clustering thresholds inherited
from the build plan), ADR-049 (two sensible prompts composing into a pipeline that could never bet) —
and the lesson is identical: **a threshold is a property of a measure, and a measure is a property of
the question being asked.** A number nobody has looked at a distribution for is a guess.

**What the calibration does not cover, stated because it matters.** No article in that corpus reported
the *outcome* of any of the four markets, because none of those outcomes has happened yet. The sample
therefore contains true matches on *subject* and none on *settlement* — the case the resolver actually
depends on is not in it. The floor is set generously for that reason: a missed article costs a
resolution, while an extra one costs a few tokens and still has to survive the quote check and a human.

**Evidence, reproducible:** `pnpm --filter web resolution:dry-run` prints every candidate's score,
passed or not. It is to this constant what `pnpm --filter web calibrate` is to the clustering
thresholds. With the corrected floor, market #5 retrieves the FEMA article and the agent answers
`UNSETTLED` — "the provided article reports on the court ruling itself but does not contain any
information regarding whether the Department of Justice has filed a formal notice of appeal" — which
is the correct answer and writes no row.

---

### ADR-061 — `MOCK` provenance is stopped by a source scan and a runtime throw, not a bundle grep

**Decided:** enforce hard rule #2 with `components/Provenance.tsx` plus
`web/scripts/check-provenance.mjs`, which runs **after** `next build` in CI and makes four checks:
nothing outside three allowlisted files may contain the token `MOCK`; the component's runtime guard
must still be present in its source; no prerendered HTML in `.next/server/app` may contain a rendered
`data-provenance="MOCK"`; and every route must render a `<Provenance>` badge or be on a written
exemption list. The component itself throws rather than render `MOCK` when `NODE_ENV === "production"`.

**Why the obvious check does not work.** The plan said "CI fails if `MOCK` provenance appears in a
production build", and the natural reading is a grep of the build output. That cannot work:
`Provenance.tsx` necessarily contains the string `MOCK` — it is the branch being forbidden — so every
JavaScript bundle contains it whether or not a single page uses it. A bundle grep would fail always,
or need an exception wide enough to be useless.

What *can* be tested on the build is **rendered output**: prerendered HTML contains only what a page
actually produced, so a `data-provenance="MOCK"` attribute in it is proof a page displayed invented
data. That check is in, and it is honest about its reach — every page in this app is `force-dynamic`,
so on most builds it scans the two static routes and proves little. The runtime throw is what covers
the dynamic ones: a statically rendered page carrying `MOCK` fails `next build` outright, and a
dynamic one fails the request rather than showing a badge.

The source scan is deliberately blunt — an allowlist of three exact paths rather than a pattern — so
it catches every spelling at once: `origin="MOCK"`, an origin arriving through a variable, a constant
named `MOCK_ROWS`, a comment promising to remove one later. The Phase 6 placeholder it replaces
matched two literal JSX spellings and would have missed all of those.

**Cost:** three files may name the forbidden origin, and that exception is a line of code rather than
a convention. The fourth check — every route must declare a provenance — is a maintenance cost paid on
every new page, which is the point: "I forgot to say where this came from" should not look identical
to "there is nothing to say".

**Evidence:** `pnpm --filter web check:provenance` — 130 source files scanned, guard intact, every
route declaring. It failed on its first run against seven real pages, which is how the badges got
written.

---

### ADR-062 — Judge mode is a transaction the contract refuses, and it writes no decision row

**Decided:** the judge-mode button on `/trust` reads a registered agent's on-chain per-transaction
cap, adds one wei, and sends the bet with the policy gate deliberately not consulted. It records an
`audit_log` row and an `onchain_intents` row, and **no `agent_decisions` row**.

**Why a refused transaction and not a successful one.** The exit criterion is that a judge with no
wallet can produce a real transaction. Any button that produced a *successful* one would mean this
application holds a key that can do something consequential on a stranger's say-so — which is the
exact opposite of what the project claims. The only kind of transaction it is safe to hand a stranger
is one the contract is going to refuse. That constraint turned out to be a feature: the over-cap bet
is also the single most load-bearing claim in the system, so judge mode makes a sceptic prove it
themselves rather than read about it.

Three properties follow. It cannot move money — a reverted `placeBet` returns its value, so a click
costs gas. It needs no authority at all. And it is repeatable, unlike `finalizeResolution` or
`invalidateStale`, which are genuinely permissionless but one-shot per market and usually out of
scope.

**The guard is the `eth_call`, not the cooldown.** `runCapProbe` simulates the bet first and
**refuses to broadcast unless the chain confirms it reverts with `AgentPerTxCapExceeded`.** A
successful simulation is the failure case: it would mean the cap is not what the contract reported a
moment earlier, and broadcasting would stake real funds on a visitor's click. A revert for any other
reason is also refused, because the transaction would then not show what the button says it shows.
The 45-second module-scope cooldown is a courtesy limit on top, with the same honest caveat as
`runTickAction`: several serverless instances means "a few probes per cooldown", which is acceptable
only because the worst case is bounded in gas rather than in stake.

**Why no `agent_decisions` row.** That table means "this agent decided this". No model was asked and
no gate ran, so a row would put a stranger's button press into a member's trading record and render
on `/agents` beside real decisions. `scripts/over-cap-bet.ts` does write one, and should — an operator
running it by hand is claiming it. The complete record of a probe is its audit row, its intent row and
its hash.

**Cost:** each click spends gas from a real agent wallet, and the probe refuses to run when no wallet
can cover cap + 1 wei + gas or when no market is open — both of which it explains on screen rather
than failing silently.

**Evidence:** `0x72fde34abea889831dd21aab56f05b94b066e6e22e5a37f6ad4e9e2a695be112` (CLI, block
5,798,322) and `0xcfc34dff963bd7f1ea81df4ec7373794a34dd56dda99d18955ce6bfccbaa08c3` (clicked in a
browser with no wallet extension, block 5,798,488). Both resolve on MSTScan as `placeBet`, value
`20000000000000001`, `execution reverted`, decoded
`AgentPerTxCapExceeded(attempted: 20000000000000001, cap: 20000000000000000)`.

---

### ADR-063 — `/trust` has no kill-switch button, and says why in the page

**Decided:** `/trust` reads `paused()` live and shows an `eth_call` of `pause()` **from the human
authority's address**, which reverts. It offers no control to pull the switch.

**Why.** The build plan listed "kill switch control" as a Phase 7 task. Implementing it literally
would require the deployed application to hold `DEFAULT_ADMIN_ROLE` — the role that can also register
an agent, change a cap and grant every other role. A button that halts the contract is therefore a
button that proves the running system *could* do all of those, which contradicts the claim the rest of
the page is built on and would make a server compromise strictly worse. ADR-047 already put the admin
key on a laptop and deliberately not in Vercel; a pause button would undo that for a convenience
nobody needs during a demo.

**What replaces it is stronger than a button.** `eth_call` costs nothing and changes nothing, so the
page can ask the contract what it *would* do: probed from `0xA9F6…1fF1` — the wallet that creates
every market and signs every resolution on this deployment — `pause()` reverts with
`AccessControlUnauthorizedAccount(0xA9F6…1fF1, 0x00…00)`. That is a live demonstration that the most
privileged key in the running system cannot halt the contract, which a working button could never
show.

The two off-chain switches we *do* operate — `AGENTS_KILL_SWITCH` and the per-member flag — are shown
with their real state and labelled as weaker by construction: they stop our code asking for a bet,
they do not stop a stolen agent key from placing one. What stops that is the cap.

**Cost:** halting the contract in an emergency is a local command with the admin key, not a click.
Correct for a system whose whole argument is where authority lives.

**Evidence:** the panel on `/trust`, rendered from `probePause()` in `lib/trust/roles.ts`. It
distinguishes a revert from a transport failure and refuses to present the second as the first.

---

### ADR-064 — Two Tailwind colour tokens were used sixty times and never defined

**Decided:** add `--color-ink-500` and `--color-ink-200` to the `@theme` block in `globals.css`.

**Why this is worth an entry.** `text-ink-500` and `text-ink-200` were written across seven pages —
roughly sixty occurrences — and neither token existed. Tailwind v4 generates a utility only for a
token declared in `@theme`; an undeclared one produces **no CSS at all** and no warning, so every one
of those elements silently rendered at its inherited colour. Text meant to be de-emphasised was not.

It was found by grepping the *built* stylesheet for the classes the pages use, not by reading the
source: `grep -c "text-ink-400"` returned 1 and `grep -c "text-ink-500"` returned 0. The source looks
correct either way, which is the whole problem with a system that fails silently.

**Cost:** two lines. The general lesson is the one worth keeping: for a build step that degrades
quietly rather than erroring, the check has to be against its output.

**Evidence:** `.next/static/chunks/*.css` before the fix — `text-ink-200` and `text-ink-500` absent,
every other `ink-*` utility present.

---

### ADR-065 — A caption that asserted facts about rows it never read, and the check that now stops it

**Decided:** derive `/markets/[id]`'s signer labels and its closing claim from the rows on the page —
classifying each signer by a live `hasRole` read — instead of printing a fixed sentence. And verify
every sender named in `README.md` and `DEMO_SCRIPT.md` against the explorer in `pnpm check:links`.

**What was wrong, and why it was the worst available kind of wrong.** `/markets/8` ended with:

> *"A market is created by a browser wallet, bet on by a capped agent, resolved by a browser wallet …
> There is no row in which a privileged server key moved money."*

That is true of markets 4–7 and 9. It is **false of market 8**, which an operator drove from a laptop
because proving a payout needs stakes on both sides and no such market existed (ADR-059). The sentence
sat directly beneath a table whose first row was the admin key staking 0.01 tMSTC — and every row in
that table read `server key`, including the admin key's, because the label came from
`onchain_intents.signer`, an enum with exactly two values.

Two separate defects, pointing the same way:

1. **`SERVER` conflates two keys with nothing in common.** An agent key the deployment holds, capped
   on chain and holding no role; and the operator key, which holds `DEFAULT_ADMIN_ROLE` and is
   *deliberately absent* from Vercel (ADR-047). Rendering both as "server key" tells a reader the
   deployed application holds an admin key. That is the single most damaging thing this app could
   imply about itself, and it is not true.
2. **A caption that does not read its rows will eventually contradict them.** This one did, on the
   page `DEMO_SCRIPT.md` sends judges to.

The same error was in the first draft of this phase's README, three times: `proposeResolution`,
`challengeResolution` and the round-2 proposal were credited to "the human" when the operator key had
sent all three. Every link worked. The column beside them was flattering and wrong.

**The fix, in two parts.** `lib/trust/signers.ts` classifies a signer by asking the contract whether
the address holds `DEFAULT_ADMIN_ROLE` — one `eth_call` per distinct address — so the label is a chain
fact rather than our own record of who we think signed. `lifecycleClaim` is pure, takes the classified
rows, and **withholds the strong claim as soon as one operator row appears**, naming the calls instead.
Eleven tests cover it, and the one that matters asserts the withholding.

Then the guard that generalises it: `check-links.mjs` reads every markdown table row that names both a
transaction and an address, fetches the transaction, and fails if the two disagree. It was verified by
reintroducing the exact error on purpose and watching it fail.

**Cost:** one to three extra `eth_call`s on a market page, and a caption that is longer and less
quotable. Both are the right trade. The strong sentence is now *earned per market* rather than
asserted over all of them — which means that when it does appear, it is worth something.

**The general lesson, and it is the third time this build has learned it:** prose about data must be
computed from that data. ADR-045 and ADR-049 were the same shape in the pipeline; this is the same
shape in the UI. A sentence a human wrote once, beside numbers a query produces, is a sentence that
will be wrong later.

---

### ADR-066 — Every market notification was late, because the pass sent to fetch the log ran three blocks too early

**Decided:** wait out the indexer's confirmation depth before indexing an approval, rather than
lowering the depth; move the indexer-then-notifier pair into `POST /api/sync` and a
`syncAfterApproval` server action the browser fires without awaiting; and stop describing the
GitHub Actions cron as a five-minute heartbeat.

**The symptom.** A market approved on `/review` produced no Discord message for tens of minutes.
Measured from the database, not inferred: market #10 was approved at `05:26:50Z` and announced at
`06:11:19Z` — **44m29s**. Market #9: approved `04:29:31Z`, announced `05:19:15Z` — **49m44s**.

**The cause, which was arithmetic.** `recordApproval` already ran the intent worker, the indexer and
the notifier inline, precisely so this would be fast. It could never work:

- `runIntentWorker` returns after `waitForTransaction(hash, 1, …)` — **one** confirmation.
- `runIndexer` reads only to `head - confirmations`, with `DEFAULT_CONFIRMATIONS = 3`.

So the inline indexer ran with the market's own log three blocks *above* the horizon it reads to.
It was structurally guaranteed to miss it, every time, and the notifier then correctly reported
"no notification yet — the market is not indexed". The cursor proves it: after the 05:26:50 pass it
stood at **5,801,448**, while market #10 was mined in **5,801,451**. The next pass — the 06:11
cron — read `5801449 → 5802337`, found exactly one log, and sent exactly one message.

**Why the second half of the bug was invisible.** The repair depended on the cron, and the cron is
not what it says. `heartbeat.yml` schedules `*/5 * * * *`; GitHub delivered **three runs in fourteen
hours** (20:42Z, 00:36Z, 06:10Z). Scheduled workflows are best-effort and free runners are shed
first. The README's claim of "a five-minute GitHub Actions heartbeat" was false, and is now
corrected with the measurement beside it.

**Why wait for the depth instead of lowering it.** Dropping to zero or one confirmation would have
fixed the latency in one line. It would also have redefined the word the whole notifier is built
around. `announceable()` selects on `onchain_id` and `created_tx_hash` — columns only the indexer
writes, only from a confirmed log — because the exit criterion forbids telling members about a
market that does not exist. The confirmation depth *is* that definition. Waiting costs ~7.5s of a
background request (measured against the live chain: `waited 7557ms`, horizon reached). Lowering it
would cost the claim.

**Why the browser fires it and does not await it.** The wait is about ten seconds. Holding the
reviewer's spinner open for a transaction already mined is the wrong trade, and a server action on
the `/review` segment gets the platform's ten-second default — which would kill the wait at exactly
the wrong moment. So the action is fired with `void`, the segment declares `maxDuration = 60`, and
the button frees the instant the transaction is recorded.

**Why `/api/sync` exists beside `/api/tick`.** A tick fetches eight feeds, clusters two hundred
articles and spends an LLM budget to reach the notifier: ~19s measured. The notification path needs
none of it — the indexer half of that same tick took **98ms**. Separating them means the path a
member's notification travels can be run often and cheaply. `CRON_SECRET` first, `TICK_SECRET` as
fallback; the name is Vercel's, so a `vercel.json` cron would need no further wiring.

**What is still true and unfixed.** `.github/workflows/sync.yml` is documented as a repair path, not
a delivery path, because nothing makes GitHub honour a `*/5`. The delivery path is now the request
that caused the market. If the browser is closed mid-wait, the backstop is the cron, and it is
honest about being measured in hours.

**The general lesson.** The inline fast-path had been there since Phase 4 and read as correct — it
called the right functions in the right order. Two constants written in different files, a year of
comments apart, made it a no-op. `wouldIndex` is now one exported expression with a table test, so
the horizon and the receipt depth are compared in a place where they can be seen disagreeing.

---

### ADR-066 — The keeper invalidates a stale market after a grace period, and cannot claim for anyone else

**Decided:** three things, all found by one stuck market.

1. **The keeper calls `invalidateStale`**, gated on `getMarket` saying `OPEN`/`CLOSED` and
   `now > resolveDeadline + STALE_GRACE_SECONDS` (one hour, overridable via
   `KEEPER_STALE_GRACE_SECONDS`). This **revises ADR-057**, which kept the call out of the keeper
   entirely.
2. **The claim stage picks its candidates without trusting the projection's state**, so a market
   invalidated this pass is claimable on the next one rather than a whole tick later.
3. **The keeper claims only for the agent wallets whose keys it holds**, and the UI says so, because
   the contract does not allow anything else.

**Why (1).** ADR-057's reasoning was that invalidation refunds everyone and destroys the market, so a
resolver ten minutes late should not cost every bettor their position. That is right about *ten
minutes* and wrong about *forever*. Market #2 closed on 2026-09-28, passed its resolve deadline
thirty minutes later, and sat `CLOSED` with a confirmed 0.01 tMSTC stake inside it for **thirteen
hours** — protected, by a policy meant to protect it, from the only mechanism that could return the
money. The bettor ADR-057 was written for is exactly the person it stranded.

A grace period keeps the half of ADR-057 that was true and drops the half that was not: the late
resolver still wins the race, the absent one no longer locks the funds up. The call stays
permissionless, so nobody has to wait for us — a judge can make it from their own wallet, sooner.

**Why (2).** The claim stage selected `indexedMarkets(["FINALIZED","INVALIDATED"])` — the *database's*
view. A market the keeper invalidated moments earlier is still `CLOSED` there until the indexer
catches up, so the refund it had just made possible was invisible to it. The candidate list is now
every settle-able projection state and the **chain** decides, which is the rule the rest of the file
already followed. `previewPayout` remains the only thing that authorises a claim (ADR-050).

**Why (3), and this is the one worth being precise about.** `claim(marketId)` pays `msg.sender`'s
position and no one else's. There is no `claimFor(address)`, deliberately: a pull-based payout is what
stops one reverting receiver breaking the loop for everybody. So *"the keeper claims for every bettor
who is owed"* is not a thing any code can do — the only positions it can settle are the ones whose
key it holds, which is the registered agent wallets.

Market #2's bettor was the **deployer**, from the Phase 1 smoke script, and the deployer key is
deliberately absent from production (ADR-047). Its refund was therefore an **operator** action from a
laptop, recorded as one in `audit_log` and rendered as `operator key` on `/markets/2` — not keeper
work dressed up as keeper work. Building a `claimFor` path would have meant changing the contract to
weaken a protection, to make a sentence in a prompt true.

**Cost:** one extra `eth_call` per candidate market per pass, on a chain where reads are free. A
market can now be invalidated by a cron job an hour after its deadline, which is a real transfer of
authority away from the resolver — mitigated by the grace period being a single named constant, and
by the call having been permissionless all along.

---

### ADR-067 — The lifecycle table reads the chain's logs too, and never writes them back as intents

**Decided:** `/markets/[id]` renders `onchain_intents` **merged with `chain_events`**, de-duplicated
by transaction hash. A log with no intent row is shown, marked `from the event log`, with the actor
the contract itself recorded. Only events that carry their caller in an argument are included.

**Why.** `/markets/2` printed a lifecycle table under the heading *"every transaction, and which key
signed it"* containing one row — the keeper's `closeMarket` — while the chain held a confirmed
0.01 tMSTC `placeBet` on that market. The bet was sent by `contracts/scripts/smoke.ts` in Phase 1,
before the intent engine existed, so no `onchain_intents` row will ever exist for it. Nothing in the
table was false; it was silently incomplete, which under a heading promising completeness is the same
failure hard rule #2 exists to prevent, and it is how the stuck market stayed invisible.

**Why not backfill intent rows instead.** That was the obvious fix and it is the wrong one.
`onchain_intents` records what this system *decided to do*. It never decided to place that bet. Writing
a synthetic row would put a fabricated decision into the audit trail to make a UI look tidy — the
precise move this project refuses everywhere else. The log is shown as what it is instead.

**Why only events naming their caller.** `MarketClosed`, `MarketFinalized` and `MarketInvalidated`
carry no address. A row for one would need an invented `signed by` value, and that column *is* the
page's trust claim. A missing row is better than a guessed signer.

**Effect, immediately:** `/markets/2` now shows all five of its transactions, and because the
recovered `placeBet` is an operator row, `lifecycleClaim` correctly **withholds** the strong trust
claim on that market — the same self-correction ADR-065 built it for, now firing on evidence that
page could not previously see.

---

### ADR-068 — The hackathon framing goes; the build record stays

**Decided:** on 2026-09-30, after the submission was filed and the event ended, AuspeX becomes a
product rather than a competition entry. Phases 9–12 remove every trace of the event **from the
framing** — the README byline, the "judge" as the addressed reader, the "judge mode" feature name,
the deadline language in the docs, the event in the repo metadata. They remove **nothing** from the
record: `PROGRESS.md`, `docs/BUILD_PLAN.md` and this file are kept in full, unrenumbered and
unretouched, framed as the engineering log.

**Why keep the record when the point is to look professional.** The temptation is to delete it —
a repository that documents its own eight-phase scramble looks less like a product than one that
appears to have arrived finished. That instinct is wrong here for a specific reason: **this product's
proposition is that its claims can be checked.** It says an AI cannot move money, that a human signs
every market, that the contract refused six transactions — and the reason those sentences are
credible is that the log beside them records each time the project believed something flattering and
was proved wrong by its own output. ADR-029, ADR-045, ADR-049, ADR-060, ADR-065, ADR-067: six
recorded instances of a measurement contradicting a claim, and the claim losing. Deleting that to
look tidier would remove the evidence for the one thing the product is selling.

It would also be the same move the project has refused seven times. `<Provenance>` exists so a number
cannot be shown without saying where it came from. `check:links` exists because a flattering caption
beside a real hash is worse than a broken link. Erasing an inconvenient history to present a cleaner
surface is that error at the scale of the whole repository.

**Cost, stated plainly.** A visitor will find a build log describing a 24-hour competition inside a
repository that no longer mentions one. That is mildly incongruous, and it is the price. It is paid
down by a one-paragraph preface framing the log as what it is, rather than by hiding it. A reader
who does not care can ignore `docs/`; a reader who does care gets more than a polished README could
give them.

**What cannot be changed at all, and is therefore explained instead.** Markets 1–3 and 8 carry
`[Phase N … test]` inside their on-chain question strings. Those strings are immutable and are
indexed on a public explorer. They stay, they are labelled as commissioning tests in the README's
market table, and no surface implies otherwise.

**What this decision does not license.** Not a rewrite of history to be more flattering, not a
quiet correction of a past measurement, not a deleted gap. A gap that is still true stays open; one
that stopped being true is restated with what replaced it and why — the way gap #21 was superseded
by gap #34 on the day this was decided.

**Evidence:** the inventory this decision was sized against — 24 direct event references in 15 files,
224 `judge` references in 65 files, 271 `Phase N` references in 73 files — is recorded in Phase 9 of
`docs/BUILD_PLAN.md`, measured 2026-09-30.
