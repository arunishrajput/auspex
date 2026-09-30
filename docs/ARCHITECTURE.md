# ARCHITECTURE.md — AuspeX

## The one-line version

**AI proposes. Humans and the smart contract decide.**
Every path that moves money or reaches a member passes through deterministic code, a human approval,
or an on-chain limit — never through a language model.

---

## 1. Verified network facts

Probed live on 2026-09-28. Do not substitute remembered values.

```
Network   : MST Testnet
RPC       : https://testnetrpc.mstblockchain.com
Chain ID  : 91562037   (0x5752035)
Currency  : tMSTC (18 decimals)
Explorer  : https://testnet.mstscan.com     <-- NOT mstscan.com
Faucet    : https://faucet.masterstroke.academy
Block time: ~3s   ·   Block gas limit: 55,000,000   ·   baseFeePerGas: 0
Client    : Geth fork v1.7.3 build, Cancun-capable
```

**Why `testnet.mstscan.com` and not `mstscan.com`:** `mstscan.com` reports a head block around
20.8M while our RPC is around 5.78M — it indexes a different chain. `testnet.mstscan.com` matches our
RPC exactly (same head, same 55M gas limit, same validator address). Both are Blockscout; only the
testnet one is ours. Sending a reader to the wrong explorer would make real transactions look fake.

**Cancun support was tested, not assumed.** `eth_call` with state overrides executed PUSH0 (`0x5f`),
MCOPY (`0x5e`) and TSTORE/TLOAD (`0x5d`/`0x5c`) successfully, with an INVALID-opcode control proving
the override was actually applied. So `evmVersion: "cancun"` is safe.

**Gas is effectively free** (`baseFeePerGas = 0`, 1 gwei priority, 55M block limit). This drives a
deliberate design choice: **we store human-readable strings on-chain** — the question, the resolution
source URL, the evidence URL. On Ethereum mainnet that would be wasteful. Here it costs nothing and
buys the thing that actually matters here: anyone can open the contract on MSTScan and *read the
market*. Optimising gas here would trade away legibility for no gain.

---

## 2. System shape

One Next.js app and one Solidity contract. No microservices, no message broker, no separate indexer —
a solo build has no budget for operational surface that does not earn its keep.

```
   NEWS SOURCES (untrusted)                    MST TESTNET (authority)
   RSS · Google News · GDELT                   AuspexMarket.sol
            │                                    ▲         │
            │ ingest                    signed tx│         │ eth_getLogs
            ▼                                    │         ▼
   ┌─────────────────────────────────────────────────────────────────┐
   │  Next.js app (Vercel)                                           │
   │                                                                 │
   │  /api/tick ──> pipeline state machine (bounded steps)           │
   │                  │                                              │
   │                  ├─ ingest + dedup + confirm     (deterministic)│
   │                  ├─ proposer agent               (LLM, gated)   │
   │                  ├─ member agents                (LLM, gated)   │
   │                  ├─ POLICY GATE                  (deterministic)│
   │                  └─ OnChainIntent engine         (idempotent)   │
   │                                                                 │
   │  Dashboard: / · /review · /markets · /agents · /trust · /audit  │
   └─────────────────────────────────────────────────────────────────┘
            │                    │                      │
            ▼                    ▼                      ▼
     Neon Postgres        Discord webhook         BridgeKey wallet
     (pipeline state)     (notifications)         (human signing)
```

**Two drivers, one endpoint.** `POST /api/tick` is called by a GitHub Actions cron as a background
heartbeat, and by a **"Run tick" button** in the dashboard for on-demand control. GH Actions cron is
delayed under load, so the button — not the cron — is what advances the pipeline when someone is
actually looking at it.

**How badly delayed, measured rather than assumed.** Across 46 hours to 2026-09-30T18:50Z, the
heartbeat's `*/5 * * * *` expression produced **ten scheduled runs** — a mean gap of 5h07m, a spread
of 2h57m to 6h44m, and **1.8% of the 554 runs it asked for** (ten delivered of 554 requested; this
was written as 1.6% until v1.0.0, which is nine — the count of the *gaps* between ten runs, and the
right divisor for the mean gap rather than for a delivery rate). Every one succeeded: this is GitHub
throttling scheduled workflows on a low-activity public repository, not a broken workflow. The
sibling `sync.yml` measured 4h52m mean over 29 hours.

**A configured expression is not a cadence, so this project stopped writing one down.** The
workflows now ask for twice an hour at minutes 7 and 37 (heartbeat) and 19 and 49 (sync) — 48
requests a day instead of 288, offset from the top of the hour, which GitHub's own documentation
names as a high-load window. What that change delivers is **unmeasured** and is claimed nowhere.
Instead `/audit` derives the real cadence from `audit_log` on every request and renders it beside
the median tick duration. A number on a live page comes from a query or it does not go on the page.

Treat the cron as a backstop that fires *somewhere between minutes and hours*, never as a latency
guarantee. Anything a member sees must be driven by the request that caused it. That is why market
notifications leave from `/review` via `POST /api/sync` (indexer → notifier, ~1s) rather than
waiting for a tick, and why `.github/workflows/sync.yml` is documented as a repair path rather than
the delivery path.

---

## 3. The pipeline is a state machine

Every entity is a Postgres row with an explicit state. A tick advances the machine by a **bounded**
number of steps and returns a structured report of what moved. This one decision buys idempotency,
resumability, rate-limit safety and demo control at the same time.

```
RawItem(source, source_guid)          UNIQUE(source, source_guid) → re-ingest is a no-op
   │
   │  deterministic clustering (normalise → shingle → MinHash/Jaccard ≥ 0.6)
   │  LLM adjudicates ONLY borderline pairs (0.4–0.6), bounded per tick
   ▼
Event        OBSERVED ──> CONFIRMED ──> REJECTED
             CONFIRMED requires ≥2 DISTINCT publisher domains
   │
   │  market proposer agent  (system-level, human-gated)
   ▼
Proposal     DRAFTED ──> VALIDATED ──> PENDING_REVIEW ──> APPROVED | REJECTED
                   └───> SCHEMA_REJECTED (logged with reason, never reaches the queue)
   │
   │  ══════════ HUMAN GATE ══════════  BridgeKey-signed createMarket
   ▼
Market       ONCHAIN_PENDING ──> OPEN ──> CLOSED ──> RESOLUTION_PROPOSED ──> FINALIZED
                                              ▲            │                      │
                                              └─ challenge ─┘                      │ keeper
                                    (outcome discarded, round + 1)                 ▼
                                                                                claim()
             OPEN | CLOSED ──> INVALIDATED   (invalidateStale, past resolveDeadline, by anyone)
   │
   │  member agents (per-user, constrained twice)
   ▼
AgentDecision  PROPOSED ──> POLICY_APPROVED ──> TX_PENDING ──> TX_CONFIRMED | TX_FAILED
                       └──> POLICY_REJECTED (reason recorded and shown)
   │
   │  resolution agent (deterministic retrieval, human-gated)
   ▼
ResolutionDraft  PENDING_REVIEW ──> APPROVED (a human signed proposeResolution)
                            ├──> REJECTED       (a human refused it, with a signature)
                            ├──> SCHEMA_REJECTED (the validator refused it; kept and shown)
                            └──> STALE          (the market moved on before it was used)
                 UNSETTLED writes **no row** — the model said "not yet", which is not a refusal
```

`OnChainIntent` sits beside `Market` and `AgentDecision` and owns every write to the chain.

---

## 4. Idempotency — belt and braces

The requirement: *a crashed and re-run worker must not double-create a market or double-spend.*

**Off-chain.** Unique constraints at every stage (`RawItem(source, source_guid)`,
one `Proposal` per `Event`, one `AgentDecision` per `(market, member, round)`). Workers claim rows
with `SELECT ... FOR UPDATE SKIP LOCKED`, so two concurrent ticks never touch the same row.

**On-chain.** The dangerous window is "we broadcast, then crashed before recording the hash".
Writing the row before broadcasting narrows that window but does not close it — the process can
still die between `eth_sendRawTransaction` returning and the `UPDATE` committing, and a retry
that re-signs produces a *second* transaction. So the transaction is **signed before it is
broadcast**, and the signed bytes are persisted first (ADR-027):

1. Write the `OnChainIntent` row **before** anything touches the chain, keyed on a business fact.
2. Claim it under `FOR UPDATE SKIP LOCKED`, taking a time-bounded lease.
3. Sign, and persist the **signed raw transaction and its hash**. The hash is now fixed.
4. Broadcast those exact bytes. Any recovery re-broadcasts the *same* bytes, which the network
   deduplicates by hash — so no crash point can yield two transactions.
5. Poll the receipt; a revert is a terminal state with its custom error decoded, not a failure.

Nonces come from `max(node pending count, our highest recorded nonce + 1)` under a Postgres
advisory lock on the sending address. `pnpm --filter web crash-test` demonstrates the whole thing
against the real testnet by killing the worker with `process.exit(1)` at two different points.

**And the contract independently refuses duplicates.** `createMarket` takes a `bytes32 specHash` and
reverts on a hash it has already seen. So even if every off-chain guarantee failed simultaneously, a
market still cannot be created twice. Two independent mechanisms, neither relying on the other.

---

## 5. Untrusted input

Two untrusted surfaces: **news text** (an injection vector) and **LLM output** (never authoritative).

**News text.** Goes into a user-role message inside `<untrusted_content>` tags. Never into a system
instruction. The system instruction states that content inside those tags is data and must never be
treated as instructions. A deterministic signature scan flags suspicious items; flagged items are
logged and rendered with a warning badge in `/review`.

**LLM output.** Constrained by schema at the API *and* re-validated with Zod on receipt. The model can
only emit fields we defined, so the worst a successful injection achieves is a *plausible but wrong
proposal* — which then hits the human gate. Defence in depth: the schema bounds the shape, the human
bounds the content, the contract bounds the money.

**The honest claim:** we do not claim injection is impossible. We claim the blast radius is bounded,
because an LLM cannot reach money without passing a human and a contract.

---

## 6. Three kinds of agent — kept deliberately separate

| | **Market Proposer** | **Member Agent** | **Resolution Agent** |
|---|---|---|---|
| Scope | System-level, one instance | Per user, many instances | System-level, one instance |
| Proposes | A market specification | A bet (side, size, confidence) | An outcome + an evidence label + a quote |
| Bounded by | Schema validation + **human approval** | **Policy gate** + **on-chain caps** | Quote verification + **human approval** + the **challenge window** |
| Can reach chain? | Only via a human's signature | Only via its own capped wallet | Only via a human's signature |
| Chooses its own inputs? | No — the event's own articles | No — the market's own articles | **No** — deterministic similarity retrieval (ADR-053) |
| Failure mode | A bad proposal is rejected in review | A bad bet is clamped, rejected, or reverted | A bad outcome is refused by the validator, the resolver, or a challenge |

They never share code paths or credentials. Conflating them would destroy the argument that authority
is separated.

The resolution agent is the one with the most consequential output — it decides who gets paid — so it
holds the least authority of the three. It cannot pick which articles to read, cannot type a URL,
cannot name the round it belongs to, and cannot emit the contract's `UNRESOLVED` value. Its entire
output is four constrained fields, one of which is a quotation that deterministic code then searches
for in the text the model was shown.

---

## 7. Agent wallets and custody

Each member has a **server-side agent wallet** (a burner EOA, key encrypted at rest with AES-256-GCM),
separate from their personal BridgeKey wallet. Autonomy requires a key the server can sign with —
there is no way around that, so the design makes the key *not worth stealing*:

- an agent wallet can **only** call `placeBet` — never create, resolve, or withdraw arbitrarily;
- its stake is capped **per transaction** and **per market**, enforced on-chain;
- `claim()` by an agent pays the **registered owner address**, not the agent.

So a fully compromised agent key can lose at most its capped stake, and cannot steal winnings.

**As built (Phase 5).** The two limit layers hold deliberately *different* numbers, and both are
shown side by side on `/agents`: the off-chain per-transaction cap in `agent_policies` is the
operational limit an operator can change with an UPDATE, and the contract's registry holds **twice**
it as the outer bound that costs an admin transaction to move. The on-chain values are never stored
a second time — `onChainCapsFor` derives what they should be, the page reads what they are, and a
disagreement is displayed as drift rather than silently repaired (ADR-046). The narrower honest claim
that follows: a total server compromise could stake up to twice the intended per-transaction amount
before the chain refused it, and the guarantee is that the bound is a number no server can change.

**The key that signs a bet is the agent's own, and it is the only kind production holds.**
`resolveSigner` picks the wallet from the intent's `from_address` — the deployer for admin
transactions, a decrypted agent key for a bet — and returns "no key here" as an ordinary value rather
than an error, because `DEPLOYER_PRIVATE_KEY` is deliberately absent from Vercel (ADR-047). Agent
registration is therefore a local command, and the deployed app holds no key that can create a
market, resolve one, grant a role, pause the contract or change a cap.

**Stated plainly in the README:** this is a server-custody model and it is the weakest part of the
design. The encryption is hygiene; the **on-chain caps are what actually bound the risk.** A
production system would use per-user non-custodial signing or a session-key/account-abstraction
scheme.

**BridgeKey's real role** — connect, network switch, and contract signing:
the human authority signs `createMarket`, the resolver signs `proposeResolution`, and members fund
agent wallets and claim winnings. We target the standard **EIP-1193 / EIP-6963** injected-provider
interface via wagmi's `injected()` connector, so there is **no BridgeKey-specific code** — it works
with BridgeKey and with any other MST-compatible wallet.

---

## 8. Data model (Drizzle / Postgres)

| Table | Purpose | Key constraint |
|---|---|---|
| `sources` | Publisher allowlist + independence grouping | `domain` unique |
| `raw_items` | One ingested article | **`UNIQUE(source_id, source_guid)`** |
| `events` | Canonical deduplicated story | `cluster_key` |
| `event_items` | Join: which raw items formed an event | `UNIQUE(event_id, raw_item_id)` |
| `proposals` | Draft market spec + validation outcome | **`UNIQUE(event_id)`** |
| `markets` | Mirror of on-chain market + off-chain spec | `UNIQUE(spec_hash)`, `UNIQUE(onchain_id)` |
| `resolution_drafts` | AI-drafted outcome + evidence + what a human did with it | **`UNIQUE(market_id, round)`** |
| `members` | User, BridgeKey address, agent wallet address | `agent_address` unique |
| `agent_policies` | Per-tx cap, daily budget, min confidence, categories, kill switch | one per member |
| `agent_decisions` | Every proposal + gate outcome + reasons | **`UNIQUE(market_id, member_id, round)`** |
| `onchain_intents` | Every intended chain write | **`UNIQUE(idempotency_key)`** |
| `chain_events` | Indexed logs | `UNIQUE(tx_hash, log_index)` |
| `indexer_cursors` | How far the indexer has read, per stream | `name` primary key |
| `notifications` | In-app feed + Discord delivery state | `UNIQUE(dedupe_key)` |
| `audit_log` | Append-only: actor, action, reason, tx hash | append-only |

`indexer_cursors` was not in the original plan and is deliberately **not** derived from
`MAX(block_number)` of `chain_events`: a range of blocks containing no logs at all is still
progress, and re-scanning it on every tick would grow without bound. The cursor is an
optimisation, not a correctness mechanism — losing it costs a rescan and nothing else, because
the projection is a pure fold (ADR-026).

`resolution_drafts` is keyed on `(market_id, round)` rather than on the market alone, because a
challenge legitimately returns a market for **re-proposal**. The round is derived from the chain's own
`challengeCount + 1`, never from a counter we keep — so a crashed pass re-derives the same round and
conflicts instead of queueing a second draft for a human to read twice.

`audit_log` is the spine of the `/audit` page and of the "every decision is logged with a reason"
guarantee. Nothing deletes from it, and `/audit` reports how many rows carry a blank reason so the
guarantee is substantiated on the page rather than repeated.

---

## 9. LLM integration (Gemini free tier)

Free tier means rate limits are a design constraint, not an afterthought.

- **Models:** `gemini-3.5-flash-lite` for high-volume low-judgement work (borderline cluster
  adjudication), `gemini-3.8-flash` for market drafting and agent research. The 2.5 series is
  superseded per Google's docs.
- **Bounded calls per tick**, with a hard ceiling. Deterministic work runs first so the LLM is only
  asked about genuinely ambiguous cases.
- **Never re-analyse the same input.** Results are cached against a content hash.
- **Fail safe:** on 429 or any error — take no action, log the reason, leave state untouched, continue.
  A rate limit must never crash a tick or half-write a record. This is tested by revoking the key and
  running a tick.

---

## 10. Deployment

| Piece | Where | Cost |
|---|---|---|
| App + API + workers | Vercel (Hobby) | $0 |
| Postgres | Neon (free tier) | $0 |
| Cron heartbeat | GitHub Actions (public repo) | $0 |
| Contract + gas | MST Testnet | $0 (faucet) |
| LLM | Gemini free tier | $0 |
| Notifications | Discord webhook | $0 |

Entirely free, no credit card, and every component is CLI-drivable. Ticks are bounded partly so each
one finishes well inside a serverless function's limits.

---

## 11. What this architecture does not do

Named here so they are never implied elsewhere:

- **Resolution is trusted.** A small authorised set proposes outcomes, signed from a human's browser
  wallet. The challenge window, permissionless finalisation and permissionless `invalidateStale` are
  *mitigations*, not decentralisation. This is not an oracle.
- **The market creator and the resolver are the same wallet on this deployment.** They should be
  different people. `HUMAN_RESOLVER_ADDRESS` makes the split a configuration change; we have not made
  it. `docs/TRUST_MODEL.md` states it and `verify:resolution` asserts which roles that wallet holds.
- **Agent keys are server-held.** See §7.
- **The independence check is heuristic.** Two distinct domains can still both be syndicating one wire
  story; we mitigate with an allowlist and syndication detection, and do not claim it is airtight.
- **No re-org handling beyond a confirmation depth.** Acceptable on a 3s-block testnet, not for mainnet.
- **Fortuna VRF is unreachable from testnet** — `eth_getCode` at `0x01C6C7EB...d380` returns `0x` on
  chain 91562037. It is a mainnet contract. Randomised resolver selection is therefore cut, not faked.
