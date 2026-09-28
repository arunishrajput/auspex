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
