# PRD.md — AuspeX

## Problem

Prediction markets are only as good as the questions they ask and the answers they accept. Two things
break them in practice:

1. **Market creation is a quality bottleneck.** A badly worded market ("Will the economy improve?")
   is unresolvable and disputes are guaranteed. Writing good markets fast requires reading a lot of
   news and being pedantic about wording — expensive and slow when done by hand.
2. **Research does not scale.** A member who wants to bet well must read sources, weigh them, and
   size a position. Most people do none of that, so they bet on vibes.

AI is genuinely good at both jobs: reading a lot and drafting precise text. But handing an AI the
power to *create markets* and *spend money* is how you get a system nobody should trust — one prompt
injection in a news headline away from a bad market or a drained wallet.

**So the real problem is not "can AI do this" but "how do you let AI do this without giving it
authority".**

## Solution

**AuspeX** puts AI everywhere that is useful and nowhere that is authoritative.

- A **news pipeline** ingests headlines from independent publishers and confirms an event only when
  **two distinct publishers** agree.
- A **market-proposer agent** drafts a structured market spec — question, resolution source, the exact
  field to check, deadline, outcome rules. The spec is schema-validated; anything that does not parse
  is rejected before a human ever sees it.
- A **human reviews a checklist, not prose**, and approves or rejects. Until approval, nothing goes
  on-chain and nobody is notified.
- On approval the market is created on **our own contract on MST Testnet**, and subscribed members
  are notified.
- Each member has an **AI agent** that researches and proposes a bet. It is bounded **twice**:
  off-chain by a deterministic policy gate, and on-chain by hard caps the contract enforces. The agent
  never decides a final amount.
- Outcomes are resolved by an authorised resolver **with an evidence URL**, behind a challenge window,
  and finalisation is permissionless so no one can block payout.
- Winners are paid by the contract's own claim logic in tMSTC.

**The thesis in one line: AI proposes; humans and the chain decide.**

## Who it is for

| User | Needs | Gets |
|---|---|---|
| **Market authority** (human) | To approve only well-formed markets, fast | A checklist queue, an untrusted-content panel, one-click approve/reject with reasons |
| **Member** | Exposure to markets without reading 40 articles | A personal agent that researches and bets within limits they set |
| **Resolver** | To settle outcomes defensibly | Evidence-URL-bound resolution with a challenge window |
| **Judge / auditor** | To verify the claims are real | Verified contract, real tx hashes, a live pipeline, and a log of every rejection |

## What "done" means

The full loop, once, end to end, on MST Testnet, with real transactions:

```
ingest → dedup → 2-source confirm → AI drafts spec → schema validation →
HUMAN APPROVES → real createMarket tx → agent researches → POLICY GATE →
real placeBet tx → deliberate over-cap attempt REVERTS on-chain →
resolve with evidence → challenge window → finalize → real payout tx
```

Plus: contract verified on MSTScan, a public dashboard a judge can use without a wallet, and a README
that states the limitations plainly.

## Requirements the track imposes

| Requirement | How AuspeX satisfies it |
|---|---|
| MST as a **meaningful, integral** part | The contract is the authority layer — roles, caps, resolution and payout all live on-chain. Remove MST and the product's core claim disappears. Not a bolted-on connect button. |
| Deployed on MST Testnet | `AuspexMarket.sol` on chain `91562037`, address + deploy tx in the README |
| ≥1 verifiable testnet tx hash | Many: create, bet, over-cap revert, resolve, finalize, claim |
| Working demo link | Public Vercel URL, usable with no wallet via judge mode |
| Public GitHub repo | Contracts + frontend + backend + README with integration details and setup |
| BridgeKey integration (recommended) | Connect, network switch, and contract signing for approvals, resolution and claims |
| Judges prefer a working product | Everything on screen is live chain and live DB state; no mockups |

## Non-goals

Named so they are never implied: real money · mainnet · multi-outcome or scalar markets · AMM or
order-book pricing · a token · decentralised oracle resolution · mobile app · non-English sources ·
account abstraction · upgradeable contracts.

## Success criteria

1. A judge, with no wallet and no explanation, opens the URL and understands what the system does.
2. A judge can point at a real transaction for every claim we make.
3. The over-cap revert demonstrates that the on-chain limit is real and not decorative.
4. The README's limitations section is one a security-minded judge would call honest.
5. The builder can explain the contract, the policy gate, and the pipeline without notes.
