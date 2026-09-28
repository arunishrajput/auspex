# CLAUDE.md — AuspeX

Read this first, every session. Then read `PROGRESS.md` to find out where the build is.

## What this project is

**AuspeX** is a Polymarket-style prediction platform on **MST Blockchain Testnet** where markets
are created under **human authority** and members bet through **constrained AI agents**.

The thesis, in one line: **AI proposes, humans and the chain decide.**
Nothing moves money or reaches a member without passing a human gate and an on-chain limit.

Built solo for the MST Blockchain x Newrro Buildathon, AI & Web3 Builders track.

## Session protocol — THIS IS THE IMPORTANT PART

The build is split into **phases**. **One phase per session.** The user starts a session by saying
**"Start the next phase"** and nothing else. You are expected to self-orient.

**At the start of every session:**
1. Read `PROGRESS.md`. It is the single source of truth for what is done and what is next.
2. Read `docs/BUILD_PLAN.md` for the current phase's tasks and exit criteria.
3. Read any docs the phase depends on (`docs/ARCHITECTURE.md`, `docs/TRUST_MODEL.md`, `docs/CONTRACTS.md`).
4. Confirm the phase you are about to start, in one line, then begin. Do not ask for permission to start.

**At the end of every session, this ritual is mandatory:**
1. Run the phase's exit criteria (see `docs/BUILD_PLAN.md`). **All must pass.** If one cannot pass,
   say so explicitly and record it in `PROGRESS.md` under "Known gaps" — never silently skip it.
2. Update `PROGRESS.md`: mark the phase complete, record **real artifacts**
   (contract addresses, tx hashes, deployed URLs), and write a short "what the next session needs to know".
3. Update `docs/DECISIONS.md` if you made an architectural choice worth defending to a judge.
4. `git add -A && git commit` with a clear message, then `git push`.
5. Tell the user in 3-5 lines: what shipped, what is verifiable on-chain, and what the next phase is.

The user then runs `/clear` and says "Start the next phase". If `PROGRESS.md` is stale or the
commit did not happen, that next session starts blind. **Do not skip the ritual.**

## Hard rules

These are not style preferences. Breaking one damages the submission.

1. **Never fake chain data.** Every contract address, tx hash and balance shown anywhere — UI, README,
   logs — must be real and resolvable on `https://testnet.mstscan.com`. The buildathon rules say fake
   or misleading deployment/transaction data can disqualify the project. There is no upside to faking.

2. **Never present mock data as real.** If something is mocked during development, it renders through
   the `<Provenance origin="MOCK">` component, which shows a loud badge. CI fails if `MOCK` reaches a
   production build. By Phase 8 there is no mock data at all.

3. **Authority never lives in an LLM.** An LLM may only ever *propose*. Every decision that moves money
   or reaches a user passes through (a) deterministic code, (b) a human approval, or (c) the smart
   contract. If you find yourself letting a model output decide an amount or an approval, stop.

4. **All untrusted text is delimited.** News text and any LLM output are untrusted. News content goes
   into a user-role message inside `<untrusted_content>` tags, never into a system instruction. All model
   output is schema-constrained at the API *and* re-validated with Zod before use.

5. **Every state-changing step is idempotent.** A crashed and re-run worker must not double-create a
   market or double-place a bet. Off-chain: unique keys + `SELECT ... FOR UPDATE SKIP LOCKED`.
   On-chain: write the `OnChainIntent` row *before* broadcasting, and the contract rejects a repeated
   `specHash`.

6. **Fail safe, stay up.** If an LLM call fails or rate-limits, take **no action**, log the reason, and
   continue. A 429 must never crash a tick or produce a half-written record.

7. **Log every decision with a reason** — approved *and* rejected. The rejected ones are what prove the
   gates are real, and they are what the demo shows.

8. **Secrets only in `.env.local`.** Never commit a key. Never print a private key to logs or to chat.
   Never ask the user to paste a key into the conversation.

9. **No phase is complete without something visible.** Every phase from 2 onward ships a page or panel
   a judge can look at. This prevents the failure mode of "lots running underneath, nothing to show".

10. **You must be able to explain every line.** The track's originality policy requires the builder to
    defend the architecture to judges. Prefer the boring, explainable solution over the clever one.

## Verified environment facts — do not re-derive, do not guess

Confirmed live against the chain and the docs on 2026-09-28.

```
Network   : MST Testnet
RPC       : https://testnetrpc.mstblockchain.com
Chain ID  : 91562037  (0x5752035)
Currency  : tMSTC (18 decimals)
Explorer  : https://testnet.mstscan.com      <-- NOT mstscan.com
Faucet    : https://faucet.masterstroke.academy
```

- **`mstscan.com` is the WRONG explorer.** It indexes a different chain (head ~20.8M vs our ~5.78M).
  Every explorer link must use `testnet.mstscan.com`. Getting this wrong looks like faked data.
- **Fortuna VRF `0x01C6C7EBac32eD9be3Cd8Ad84B38128124AAd380` has no bytecode on testnet** — it is a
  mainnet contract, unreachable from here. VRF is cut, and the README says so with this evidence.
- **The chain is Cancun-capable** (PUSH0, MCOPY, TSTORE/TLOAD verified by `eth_call` probes).
  Compile with `evmVersion: "cancun"`.
- **Gas is effectively free**: `baseFeePerGas = 0`, 1 gwei priority, 55M block gas limit, 3s blocks.
  So we deliberately **store readable strings on-chain** (question, sources, evidence URL). Judge
  legibility on the explorer is worth far more than gas savings here.
- **Hardhat 2 does NOT work on this machine.** Node is v26 and Hardhat 2's `ts-node` dependency
  crashes (`Cannot read properties of undefined (reading 'fileExists')`). **We use Hardhat 3.**
  Config uses `chainDescriptors` + `verify.blockscout`, not HH2's `etherscan.customChains`.
- **MSTScan is Blockscout v9.0.2** with verification enabled, so `hardhat verify` works against
  `https://testnet.mstscan.com/api`. Verified source is non-negotiable — it is what makes our
  trust claims auditable.
- **The MST RPC does send CORS headers** (`Access-Control-Allow-Origin: *`) as of 2026-09-28, despite
  the Vibe Kit's stale comment saying otherwise. We still proxy RPC through `/api/rpc/[network]`
  as cheap insurance and a caching point, not because it is strictly required.
- **`@mstblockchain/mst-sdk` is a thin ethers-v6 wrapper** (v1.0.0, no types, broken install
  instructions in its README). **Use ethers v6 directly** on the critical path.
- **Gemini model IDs**: use `gemini-3.5-flash-lite` (high volume) and `gemini-3.8-flash` (judgement).
  The 2.5 series is superseded. SDK is `@google/genai` v2.x.

## Stack

| Layer | Choice | Why |
|---|---|---|
| Contracts | Solidity 0.8.28, Hardhat 3, OpenZeppelin 5 | HH3 is the only one that runs on Node 26 |
| DB | Neon Postgres + Drizzle ORM | SQL-first, fast cold starts, easy to explain |
| App | Next.js 16 (App Router) + TypeScript + Tailwind | one deployable, API routes double as workers |
| Chain client | ethers v6 | the MST SDK is too thin to trust on the critical path |
| Wallet | wagmi + viem, `injected()` connector | EIP-1193/6963 standard — works with BridgeKey, no vendor code |
| LLM | `@google/genai`, Gemini free tier | user's choice; free |
| Hosting | Vercel + Neon + GitHub Actions cron | all $0, judge-accessible URL |

## Commands

```bash
pnpm install              # install everything
pnpm dev                  # Next.js dev server
pnpm compile              # compile contracts
pnpm test                 # all tests (contracts + web)
pnpm deploy:testnet       # deploy to MST Testnet
pnpm verify:testnet       # verify source on MSTScan
pnpm wallets:new          # generate a fresh wallet (prints address; key to .env.local by hand)
pnpm preflight               # check env + RPC + DB + LLM reachability
```

## Repo layout

```
contracts/     Hardhat 3 · Solidity · tests · deploy + verify scripts
web/           Next.js app — dashboard, API routes, pipeline workers, agents
docs/          PRD · ARCHITECTURE · BUILD_PLAN · TRUST_MODEL · CONTRACTS · RUNBOOK · DEMO_SCRIPT · DECISIONS
scripts/       one-off dev utilities (wallet gen, doctor)
PROGRESS.md    <- the file that carries state between sessions
```

## Tone for user-facing output

The user is building this solo and will defend it to judges. Be direct. Flag risks early. When you
make a judgement call, say what you chose and why in one or two sentences — not an essay. If something
is a trusted assumption or a limitation, name it plainly rather than hiding it; the honesty is part of
the submission's credibility.
