# TRUST_MODEL.md — AuspeX

What we trust, what we do not, and where the boundaries are enforced. This document is also the
script for the `/trust` page and the part of the demo that earns the most credibility.

> **Since Phase 7, `/trust` is the authoritative version of everything below, not a rendering of it.**
> Every claim on that page is a live `eth_call` or a `GROUP BY` made on the request — the role matrix
> is `hasRole()` asked of the contract, the kill-switch panel is an `eth_call` of `pause()` from the
> human authority's address (it reverts), and the refusal counters are queries over
> `proposals`, `resolution_drafts`, `agent_decisions` and `onchain_intents`.
>
> **If this document and that page ever disagree, the page is right and this file is stale.** Prose can
> describe a guarantee that was removed; a call cannot. When quoting AuspeX's trust claims anywhere —
> the README, a walkthrough, a post — take the wording from `/trust`, which cannot outlive the thing it
> describes. ADR-061 through ADR-063 record why the page is built the way it is.

---

## The core principle

> **LLM output is untrusted. Authority lives only in deterministic code, human approval, and the
> smart contract.**

An LLM in AuspeX can only ever produce a *proposal*. Every path from a proposal to money or to a user
crosses at least one boundary that no model controls.

---

## The boundary diagram

```
  UNTRUSTED ZONE                     │        AUTHORITY ZONE
  (proposes only)                    │        (decides)
 ────────────────────────────────────┼──────────────────────────────────────
                                     │
  News sources ─┐                    │
  (injection    │                    │
   surface)     ▼                    │
            Proposer agent ──────────┼──> Zod schema validation   [DETERMINISTIC]
            (LLM)                    │         │ fails → SCHEMA_REJECTED, logged
                                     │         ▼
                                     │    Human review queue      [HUMAN]
                                     │         │ approve → BridgeKey signature
                                     │         ▼
                                     │    createMarket()          [CONTRACT]
                                     │    MARKET_CREATOR_ROLE + specHash replay guard
                                     │
  Member agent ───────────────────---┼──> Policy gate             [DETERMINISTIC]
  (LLM)                              │    pure function, no I/O, clamps the stake
                                     │         │
                                     │         ▼
                                     │    placeBet()              [CONTRACT]
                                     │    per-tx cap · per-market cap · pause
                                     │
  News after close ─┐                │
  (deterministic    │                │
   retrieval, not   ▼                │
   the model's)  Resolution agent ───┼──> Quote verified in the evidence  [DETERMINISTIC]
                 (LLM)               │         │ not found → SCHEMA_REJECTED, kept, shown
                                     │         ▼
                                     │    Human resolver queue    [HUMAN]
                                     │         │ sign → BridgeKey signature
                                     │         ▼
                                     │    proposeResolution()     [CONTRACT]
                                     │    RESOLVER_ROLE · challenge window must elapse
                                     │         │
                                     │         ▼
                                     │    finalizeResolution() · claim()   [PERMISSIONLESS]
                                     │    no role required · paid to the registered owner
                                     │
 ────────────────────────────────────┴──────────────────────────────────────
```

Read it left to right: nothing crosses the line without a deterministic check, a human, or a contract
rule standing in the way.

---

## Layer by layer

### 1. News text — treated as hostile input

News is arbitrary third-party text and therefore a prompt-injection surface.

- Article text goes into a **user-role message inside `<untrusted_content>` tags** — never into a
  system instruction.
- The system instruction states that content inside those tags is **data, never instructions**.
- A deterministic signature scan flags suspicious content; flagged items are marked in the DB and
  rendered with a warning badge in `/review`.

**What we claim:** the blast radius is bounded. A successful injection produces, at worst, a
*plausible but wrong market proposal* — which then has to get past a human reading a checklist.
**What we do not claim:** that injection is impossible. It is not.

### 2. LLM output — structurally constrained, then re-validated

- Output is schema-constrained **at the API** (`response_format` with a JSON schema).
- It is then **re-validated with Zod** on receipt. Belt and braces: the API constraint could change
  or regress; our own validator is the one we control.
- Anything failing either check becomes `SCHEMA_REJECTED` with the reason recorded. It never reaches
  the review queue.
- Because the model can only emit fields we defined, it cannot smuggle an instruction into a field
  that is later executed.

### 3. The human gates — a checklist, not prose. There are two of them.

**Creation (`/review`).** The reviewer sees the spec as discrete fields — question, resolution source,
the exact field to check, deadline, outcome rules — not a paragraph to skim. Ambiguous wording is
easier to catch in a checklist than in prose, and catching it here is the whole point: it happens
*before* money exists.

**Until approval: nothing goes on-chain, and no member is notified.**

**Resolution (`/resolve`).** The second gate is the one that decides who gets paid, so it asks less of
the human and gives them more to work with. The resolver is not shown a summary to agree with. They
are shown **the exact sentence the model says settles the question**, a link to the article it came
from, and the fact that deterministic code has already confirmed that sentence really is in that
article, word for word (ADR-054). The remaining job is one Ctrl-F — which is a job a person does well,
unlike "form an independent view of a wire report".

The model is deliberately **not** asked for a confidence score here. In Phase 5 `confidence` was the
agent's own number and the threshold had to be policy (ADR-041); here a human reads every draft, so
there is no threshold for a self-assessment to inform and a number on the page would only invite being
read as a gate.

**Why resolution needs a human at all**, when deterministic validation plus a challenge window would
technically satisfy hard rule #3: the window is **120 seconds and immutable**. Nobody vetoes anything
in 120 seconds. If that were the only thing between a model emitting `YES` and a payout, a model would
be deciding who gets paid. ADR-052 records the alternative we rejected and what the decision cost.

### 4. The policy gate — deterministic, pure, tested

`web/lib/policy/policyGate.ts` is the most important file in the repo for this argument.

- **Pure function.** No network, no database, no clock read inside it — time and balances are
  injected. That is what makes it exhaustively testable.
- It **clamps** rather than trusts: `finalStake = min(requested, perTxCap, remainingDailyBudget,
  onChainPerTxCap, remainingPerMarketCap)`.
- It **rejects** on: kill switch · category not allowlisted · confidence below threshold · market
  closed · insufficient balance · agent abstained.
- It returns `{ allow, reasons[], finalStakeWei }` and **every** outcome is persisted and displayed,
  approvals and rejections alike.

The agent proposes a number. The gate decides the number. Those are different jobs, done by
different code, and only one of them is deterministic.

**As built.** The gate is two pure functions. `screenAgent` decides everything knowable before a
model is asked — kill switches, market state and timing, the category allowlist, on-chain
registration, balances — so a halted or out-of-scope member never costs an LLM call. `policyGate`
re-runs that screen (so a caller cannot skip it) and then judges the proposal and clamps the stake.
50 unit tests cover every branch, including a request of **exactly** the on-chain cap passing
unreduced and `cap + 1` being clamped back down — the same wei boundary the contract draws.

Two refinements the implementation forced, both worth knowing:

- **The agent never names an amount.** It emits `stakeFraction`, a share of a per-transaction cap
  whose value it is never told, and deterministic code multiplies it out in basis points (ADR-043).
- **A refusal is terminal only when its reason can never change.** `agent_decisions` is unique on
  `(market_id, member_id, round)`, so a row forecloses that pair. A closed market or a
  disallowed category writes one; a kill switch, an unfunded wallet or a spent daily budget writes
  **none** and is logged instead, because those recover on their own (ADR-045).

### 5. The contract — the layer that does not depend on us

Everything above is our code, and our code can be wrong or compromised. The contract is the layer
that holds regardless.

| Rule | Enforced by |
|---|---|
| Only the authority creates markets | `MARKET_CREATOR_ROLE` |
| The same spec cannot create two markets | `specHash` replay guard |
| An agent cannot exceed its per-tx cap | `AgentPerTxCapExceeded` revert |
| An agent cannot exceed its per-market cap | `AgentPerMarketCapExceeded` revert |
| An agent cannot create or resolve markets | it holds **no role** |
| A stolen agent key cannot steal winnings | `claim()` pays the registered **owner** |
| No one can block a payout by going silent | `finalizeResolution` is **permissionless** |
| A payout cannot happen early | `ChallengeWindowOpen` revert until the window elapses |
| A resolver who never appears cannot lock funds up | `invalidateStale` is **permissionless** after `resolveDeadline` |
| A challenged resolution cannot stand | the outcome is discarded and must be re-proposed |
| The admin cannot cancel an inconvenient market | `forceInvalidate` needs `MAX_CHALLENGES` on the record first |
| A claim cannot be made twice | `claimed[marketId][account]` → `AlreadyClaimed` |
| Everything can be halted — except withdrawing what is owed | `Pausable`, and `claim` is deliberately **not** `whenNotPaused` |

**The claim, which is demonstrated rather than asserted:**

> Even with our server fully compromised and the off-chain policy gate bypassed entirely, an agent
> wallet cannot exceed its cap — because the chain refuses the transaction.

It is proved by deliberately bypassing the gate and letting the chain reject the transaction. The
resulting **reverted transaction on MSTScan is evidence**, not a bug. The cap probe on `/trust` lets
anyone produce a fresh one from a browser holding no wallet.

**It is proven.** `pnpm --filter web agents:over-cap` sent `cap + 1` wei — one wei, so the boundary
is exactly where the contract says rather than merely somewhere — from a real registered agent
wallet with the gate not consulted:

> `0xf0152234efe078729401162dd8ef16e6d19da2c657dcfe4360f2cd3255720c2d` · block 5,794,765 ·
> **reverted** with `AgentPerTxCapExceeded(20000000000000001, 20000000000000000)`

The explorer decodes both numbers itself, because the source is verified. Afterwards the market's
pools and the agent's per-market spend are unchanged: the refusal cost nothing but gas.

---

## Trusted assumptions — stated plainly

These are real limitations. They appear here, in the README, and on the `/trust` page. Naming them is
what makes the rest of the claims credible.

### Resolution is trusted

A small set of authorised resolvers submits outcomes with an evidence URL. Mitigations: an evidence
URL is required and stored on-chain; the outcome is signed by a **human's browser wallet**, not by any
server AuspeX runs; a challenge window must elapse before finality; challenges are recorded on-chain
with a reason; finalisation is permissionless, and so is invalidating a market whose resolver never
appeared.

**This is not a decentralised oracle.** A malicious resolver colluding with the challenger set could
still settle a market wrongly. A production system would use a staked dispute mechanism (UMA-style)
or a decentralised oracle network. We had 72 hours and chose a mechanism we could implement correctly
and explain honestly over one we could only gesture at.

### The resolver and the market creator are the same wallet

They should be different people. On this deployment
`0xA9F68fDf84388fa548a685085E2bee0e5b311fF1` holds `MARKET_CREATOR_ROLE`, `RESOLVER_ROLE` and
`CHALLENGER_ROLE` — every role that requires human judgement. It holds **no** `DEFAULT_ADMIN_ROLE`, so
it cannot register an agent, change a cap, or pause the contract.

That is a property of a solo project, not a design commitment. `humanResolverAddress()` reads
`HUMAN_RESOLVER_ADDRESS` and falls back to the market authority, so separating the duties is a
configuration change plus two `grant:testnet` calls. `/resolve` states it on the page rather than
letting a reader assume otherwise, and `pnpm --filter web verify:resolution` asserts all four role
facts with live `hasRole` calls.

**What does hold, and is the claim worth making:** *no key the deployed application holds can create a
market, resolve one, challenge one, register an agent, change a cap or pause the contract.* Production
holds agent keys only — capped by the contract and holding no role at all. The three transactions that
finish a market (`closeMarket`, `finalizeResolution`, `claim`) are signed by one of those keys
precisely because none of them needs permission (ADR-058).

### Agent keys are server-held

Agent autonomy requires a key the server can sign with. Keys are encrypted at rest with AES-256-GCM,
bound to the agent's own address as additional authenticated data so a ciphertext moved to another
member's row fails to decrypt instead of quietly signing under the wrong caps (ADR-048).

**The encryption is hygiene; the on-chain caps are the actual control.** A full server compromise
loses at most each agent's capped stake and cannot redirect winnings, because `claim()` pays the
registered owner. A production system would use per-user non-custodial signing or session keys under
account abstraction.

### Source independence is heuristic

"Two independent sources" is enforced as **two distinct publisher domains** from an allowlist, with
syndication detection. Two outlets can still be running the same wire copy. We reduce the chance; we
do not eliminate it.

### The challenge window is short

Set to 120 seconds so the full lifecycle fits in a live demo, and **immutable** — an admin who could
shrink it to zero would defeat it (ADR-022). A real deployment would use hours or days.

This is the limitation that shapes the architecture above it. Because 120 seconds is too short for a
human to notice and veto a wrong outcome, the human has to be *before* the proposal rather than after
it — which is why `proposeResolution` is signed in a browser instead of by the server (ADR-052). A
longer window would permit the optimistic shape: AI proposes publicly, a human vetoes within the
window. That is a real design; it needs hours, and ours is fixed at two minutes.

### Other bounded assumptions

- **Re-orgs:** handled only by a confirmation depth. Fine on a 3s-block testnet, insufficient for mainnet.
- **Testnet only:** tMSTC has no value. None of this has been audited.
- **Not upgradeable:** deliberate — rules cannot change after judging — but it also means a bug
  requires a redeploy.

---

## What is audited and visible

Every decision, approved or rejected, is written to an append-only `audit_log` with actor, action,
reason and tx hash, and surfaced at `/audit`. The actor is always one of:

`SYSTEM_AGENT` (proposer) · `MEMBER_AGENT` · `HUMAN` · `CONTRACT` · `SYSTEM` (deterministic code)

The `/trust` page shows live counters computed from real queries — LLM outputs rejected by schema,
decisions blocked by the policy gate, transactions reverted by on-chain caps. If those counters are
all zero, the gates have not been exercised, and the demo has not proven anything. **The rejections
are the evidence.**
