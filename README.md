# AuspeX

**Prediction markets created under human authority, researched by AI agents that the chain keeps on a leash.**

> **AI proposes. Humans and the chain decide.**
> Nothing moves money or reaches a member without passing a human gate and an on-chain limit.

Built for the **MST Blockchain × Newrro Buildathon** — AI & Web3 Builders track.

> ### ⚠️ Build status: Phase 0 of 8
> The foundations are in place; the contract is not deployed yet. This README is filled in
> with real addresses and transaction hashes as each phase lands. **Every value published
> here is real and resolvable on MSTScan — nothing in this repository is fabricated.**
> Current progress: [`PROGRESS.md`](./PROGRESS.md).

---

## The problem

Prediction markets are only as good as the questions they ask and the answers they accept.

1. **Market creation is a quality bottleneck.** A badly worded market ("Will the economy
   improve?") is unresolvable, and disputes are guaranteed. Writing good markets quickly means
   reading a lot of news and being pedantic about wording.
2. **Research does not scale.** Betting well means reading sources and sizing a position. Most
   people do neither, so they bet on vibes.

AI is genuinely good at both jobs. But giving an AI the authority to *create markets* and
*spend money* builds a system nobody should trust — it is one poisoned headline away from a
bad market or a drained wallet.

**So the real problem is not "can AI do this" but "how do you let AI do this without giving it
authority".**

## The solution

AuspeX puts AI everywhere it is useful and nowhere it is authoritative.

```
news (untrusted)
   └─> dedup + require 2 INDEPENDENT publishers      [deterministic]
        └─> proposer agent drafts a market spec      [LLM — proposes only]
             └─> strict schema validation            [deterministic — rejects malformed]
                  └─> HUMAN reviews a checklist      [human authority]
                       └─> createMarket()            [contract — role-gated, replay-guarded]
                            └─> member agent researches and proposes a bet   [LLM]
                                 └─> policy gate clamps/rejects the stake    [deterministic]
                                      └─> placeBet()                         [contract — hard caps]
                                           └─> resolve + challenge window + payout [contract]
```

Two kinds of agent, deliberately separate:

| | **Market proposer** | **Member agent** |
|---|---|---|
| Scope | System-level, one | Per user, many |
| Proposes | A market specification | A bet (side, size, confidence) |
| Bounded by | Schema validation + **human approval** | **Policy gate** + **on-chain caps** |
| Reaches the chain | Only via a human's signature | Only via its own capped wallet |

## How MST is integral, not bolted on

The contract **is** the authority layer. Roles, spending limits, resolution and payout are all
enforced on-chain. Remove MST and the product's central claim disappears — there is nothing
left that makes the AI safe to run.

- `createMarket` is restricted to `MARKET_CREATOR_ROLE` — the human authority, signing with BridgeKey.
- Agent wallets are registered on-chain with **per-transaction and per-market caps**. The contract
  reverts an over-cap bet even if our server has been fully compromised.
- Agent wallets hold **no role at all** — they cannot create markets, cannot resolve them, and
  `claim()` pays the registered *owner*, so a stolen agent key cannot steal winnings.
- Resolution requires an **evidence URL stored on-chain**, behind a challenge window, with
  **permissionless finalisation** so no privileged party can block a payout.
- Payouts are executed by contract logic in native **tMSTC**, not by our server.

BridgeKey is used for what it is for: wallet connection, network switching, and contract signing
(market approval, resolution, claims). We target the standard EIP-1193 / EIP-6963 injected
provider, so there is no vendor-specific code.

---

## Deployment

| | |
|---|---|
| **Network** | MST Testnet |
| **Chain ID** | `91562037` (`0x5752035`) |
| **RPC** | `https://testnetrpc.mstblockchain.com` |
| **Currency** | tMSTC (18 decimals) |
| **Explorer** | https://testnet.mstscan.com |
| **Faucet** | https://faucet.masterstroke.academy |
| **`AuspexMarket` address** | _deployed in Phase 1_ |
| **Deployment tx** | _Phase 1_ |
| **Live demo** | _Phase 0 deploy_ |

> **Note on the explorer.** Use `testnet.mstscan.com`, **not** `mstscan.com`. They are different
> chains: at the time of writing `mstscan.com` reported a head block around 20,861,000 while our
> RPC was at 5,783,000. `testnet.mstscan.com` matches our RPC exactly. Our transactions will not
> appear on `mstscan.com`, and looking there is the likeliest way to conclude — wrongly — that a
> real transaction is fake.

### Verified transactions

Filled in as each phase lands. Every hash resolves on MSTScan.

| What it proves | Transaction |
|---|---|
| Contract deployment | _Phase 1_ |
| Human-approved `createMarket` | _Phase 4_ |
| Agent `placeBet` within caps | _Phase 5_ |
| **Over-cap bet — reverted by the chain** | _Phase 5_ |
| Resolution with evidence URL | _Phase 6_ |
| Payout / claim | _Phase 6_ |

The reverted transaction is deliberate and is the most important one here: it demonstrates that
the on-chain limit is real, not decorative.

---

## Running it locally

```bash
git clone <this repo>
cd AuspeX
pnpm install

cp .env.example .env.local     # then fill it in — see docs/RUNBOOK.md

pnpm wallets:new               # generate a deployer wallet, fund it at the faucet
pnpm preflight                 # verify RPC, chain ID, DB, LLM, contract

pnpm compile                   # compile contracts (solc 0.8.28, evmVersion cancun)
pnpm test                      # contract + unit tests
pnpm deploy:testnet            # deploy to MST Testnet
pnpm verify:testnet            # verify source on MSTScan

pnpm dev                       # dashboard on http://localhost:3000
```

**Requirements:** Node ≥ 22 (developed on 26), pnpm 11.
[`docs/RUNBOOK.md`](./docs/RUNBOOK.md) walks through every manual step — Neon, Gemini, Discord,
BridgeKey, faucet — click by click.

**Secrets** live only in `.env.local`, which is git-ignored. CI fails the build if an `.env` file
or a real-looking key is ever committed.

---

## Repository layout

```
contracts/     Hardhat 3 · Solidity 0.8.28 · tests · deploy + verify scripts
web/           Next.js 16 — dashboard, API routes, pipeline workers, agents
docs/          PRD · ARCHITECTURE · BUILD_PLAN · TRUST_MODEL · CONTRACTS · RUNBOOK · DEMO_SCRIPT · DECISIONS
scripts/       wallet generation, preflight health check
PROGRESS.md    current build state, phase by phase
```

**Stack:** Solidity 0.8.28 + Hardhat 3 + OpenZeppelin 5 · Next.js 16 + TypeScript + Tailwind 4 ·
Neon Postgres + Drizzle · ethers v6 · wagmi/viem · Gemini (free tier) · Vercel + GitHub Actions.

Docs worth reading: [`ARCHITECTURE.md`](./docs/ARCHITECTURE.md) for the system,
[`CONTRACTS.md`](./docs/CONTRACTS.md) for the contract design,
[`TRUST_MODEL.md`](./docs/TRUST_MODEL.md) for where the boundaries are,
[`DECISIONS.md`](./docs/DECISIONS.md) for why each choice was made.

---

## Limitations — stated plainly

These are real. They are listed here, in `docs/TRUST_MODEL.md`, and on the app's `/trust` page.
Naming them is what makes the other claims credible.

**Resolution is trusted.** A small set of authorised resolvers submits outcomes with an evidence
URL. The challenge window and permissionless finalisation bound what one bad resolver can do
unilaterally, but **this is not a decentralised oracle.** A resolver colluding with the challenger
set could still settle a market wrongly. A production system would use a staked dispute mechanism
(UMA-style) or a decentralised oracle network. Given 72 hours, we chose a mechanism we could
implement correctly and describe honestly over one we could only gesture at.

**Agent keys are held by the server.** Agent autonomy requires a key the server can sign with.
Keys are encrypted at rest (AES-256-GCM), but the encryption is hygiene — **the on-chain caps are
what actually bound the risk.** A full server compromise loses at most each agent's capped stake
and cannot redirect winnings. A production system would use non-custodial signing or session keys
under account abstraction.

**Source independence is heuristic.** "Two independent sources" means two distinct publisher
domains from an allowlist, with syndication detection. Two outlets can still be running the same
wire copy. We reduce the chance; we do not eliminate it.

**The challenge window is short** (~120s) so a full lifecycle fits inside a live demo. Production
would use hours or days.

**Prompt injection is bounded, not solved.** News text is untrusted and is treated as an attack
surface: delimited input, schema-constrained output, then a human gate. A successful injection
produces at worst a *plausible but wrong proposal*, which a human still has to approve.

**Re-orgs** are handled only by a confirmation depth — fine on a 3-second-block testnet,
insufficient for mainnet. **Nothing here is audited**, and tMSTC has no value.

**Fortuna VRF is not used.** The organisers' Fortuna contract
(`0x01C6C7EBac32eD9be3Cd8Ad84B38128124AAd380`) is a VRF coordinator with no market functions, and
`eth_getCode` against it on chain `91562037` returns `0x` — it is a mainnet contract and is
unreachable from testnet. Randomised resolver selection was therefore **cut rather than faked**.

---

## License

MIT
