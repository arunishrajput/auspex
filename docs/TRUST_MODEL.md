# TRUST_MODEL.md — AuspeX

What we trust, what we do not, and where the boundaries are enforced. This document is also the
script for the `/trust` page and the part of the demo that earns the most credibility.

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

### 3. The human gate — a checklist, not prose

The reviewer sees the spec as discrete fields — question, resolution source, the exact field to
check, deadline, outcome rules — not a paragraph to skim. Ambiguous wording is easier to catch in a
checklist than in prose, and catching it here is the whole point: it happens *before* money exists.

**Until approval: nothing goes on-chain, and no member is notified.**

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
| Everything can be halted | `Pausable` |

**The claim to make to judges, and then demonstrate:**

> Even with our server fully compromised and the off-chain policy gate bypassed entirely, an agent
> wallet cannot exceed its cap — because the chain refuses the transaction.

Phase 5 proves it by deliberately bypassing the gate and letting the chain reject the transaction.
The resulting **reverted transaction on MSTScan is evidence**, not a bug.

---

## Trusted assumptions — stated plainly

These are real limitations. They appear here, in the README, and on the `/trust` page. Naming them is
what makes the rest of the claims credible.

### Resolution is trusted

A small set of authorised resolvers submits outcomes with an evidence URL. Mitigations: an evidence
URL is required and stored on-chain; a challenge window must elapse before finality; challenges are
recorded on-chain with a reason; finalisation is permissionless.

**This is not a decentralised oracle.** A malicious resolver colluding with the challenger set could
still settle a market wrongly. A production system would use a staked dispute mechanism (UMA-style)
or a decentralised oracle network. We had 72 hours and chose a mechanism we could implement correctly
and explain honestly over one we could only gesture at.

### Agent keys are server-held

Agent autonomy requires a key the server can sign with. Keys are encrypted at rest with AES-256-GCM.

**The encryption is hygiene; the on-chain caps are the actual control.** A full server compromise
loses at most each agent's capped stake and cannot redirect winnings, because `claim()` pays the
registered owner. A production system would use per-user non-custodial signing or session keys under
account abstraction.

### Source independence is heuristic

"Two independent sources" is enforced as **two distinct publisher domains** from an allowlist, with
syndication detection. Two outlets can still be running the same wire copy. We reduce the chance; we
do not eliminate it.

### The challenge window is short

Set to roughly 120 seconds so the full lifecycle fits in a live demo. A real deployment would use
hours or days. The value is configurable and the demo value is stated wherever it is shown.

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
