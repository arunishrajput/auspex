# CLAUDE.md — AuspeX

Read this first, every session. Then read `PROGRESS.md` to find out where the build is.

## What this project is

**AuspeX** is a Polymarket-style prediction platform on **MST Blockchain Testnet** where markets
are created under **human authority** and members bet through **constrained AI agents**.

The thesis, in one line: **AI proposes, humans and the chain decide.**
Nothing moves money or reaches a member without passing a human gate and an on-chain limit.

**The build has two parts, and you are in the second one.** Phases 0–8 built and shipped the
system under a competition deadline; that is finished and the event has ended. Phases 9–12
("Part II" in `docs/BUILD_PLAN.md`) turn it into a product that stands on its own — reframing,
a full visual redesign, fixing what makes a claim untrue, and a v1.0 release.

**Part II's governing rule: the framing goes, every fact stays.** No address, hash, measurement or
limitation is changed to look better. The build record is kept, not erased — ADR-068 says why, and
it is the argument to re-read if deleting something starts to feel like tidying.

*(Phase 9 did the framing pass, including on this file. The two references to a competition above
are deliberate: they are history a future session needs, not framing on a product surface. Where the
build record lives, and why it was kept, is `docs/BUILD_RECORD.md`.)*

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
3. Update `docs/DECISIONS.md` if you made an architectural choice worth defending to a reviewer.
4. `git add -A && git commit` with a clear message, then `git push`.
5. Tell the user in 3-5 lines: what shipped, what is verifiable on-chain, and what the next phase is.

The user then runs `/clear` and says "Start the next phase". If `PROGRESS.md` is stale or the
commit did not happen, that next session starts blind. **Do not skip the ritual.**

## Hard rules

These are not style preferences. Breaking one damages the product's only real claim.

1. **Never fake chain data.** Every contract address, tx hash and balance shown anywhere — UI, README,
   logs — must be real and resolvable on `https://testnet.mstscan.com`. This was once a competition
   rule; it is now the product. The entire proposition is that the claims can be checked, so a
   fabricated hash is not a rule violation — it is the thing itself failing.

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

9. **No phase is complete without something visible.** Every phase ships a page, a panel or a
   rendered artifact someone can look at. This prevents the failure mode of "lots running
   underneath, nothing to show". **Read the deployed page, not the JSX** — three defects in this
   project were invisible in source and obvious in the rendered output.

10. **You must be able to explain every line.** The owner maintains this alone and has to be able to
    defend and change any part of it. Prefer the boring, explainable solution over the clever one.

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
  So we deliberately **store readable strings on-chain** (question, sources, evidence URL). Reader
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
- **`DEPLOYER_PRIVATE_KEY` is deliberately NOT in Vercel, and stays that way.** It holds
  `DEFAULT_ADMIN_ROLE`, so it is the only key that can `registerAgent` — which is why agent
  registration is a local command (`agents:register`) and not a tick stage. Production holds only
  agent keys: capped by the contract, holding no role. A tick that claims an intent it cannot sign
  defers it without burning an attempt (ADR-047). Do not "fix" this by adding the key to Vercel.
- **Gemini works on the free tier with no billing.** An HTTP 402 here means *prepay credits
  depleted on that Google Cloud project*, not an account-wide billing requirement — read the
  error body, not just the status. A key created in a project with no billing account attached
  uses the free tier. RUNBOOK §1 has the exact `gcloud` commands.
- **Gemini model IDs, ordered by what actually responds** (measured 2026-09-29, not assumed):
  `gemini-3.1-flash-lite` answered every live call in ~5s; `gemini-3.5-flash-lite` timed out or
  503'd on three of four; `gemini-3.8-flash` returns 503 "high demand". So the fast chain leads
  with **3.1-flash-lite**. The 2.5 series now 404s for new users. Order is overridable at runtime
  via `GEMINI_MODELS_FAST` — change it without a deploy if a model degrades on demo day.
- **We call Gemini over `fetch`, not `@google/genai`.** The SDK collapses a billing 402 and a
  capacity 503 into one thrown `Error`, and those demand different responses. See ADR-031.

## Stack

| Layer | Choice | Why |
|---|---|---|
| Contracts | Solidity 0.8.28, Hardhat 3, OpenZeppelin 5 | HH3 is the only one that runs on Node 26 |
| DB | Neon Postgres + Drizzle ORM | SQL-first, fast cold starts, easy to explain |
| App | Next.js 16 (App Router) + TypeScript + Tailwind v4 | one deployable, API routes double as workers |
| Design | dark, editorial tokens in `app/globals.css`; components in `components/ui/` | colour is semantic here — read ADR-071/074/079 before changing a token |
| Chain client | ethers v6 | the MST SDK is too thin to trust on the critical path |
| Wallet | wagmi + viem, `injected()` connector | EIP-1193/6963 standard — works with BridgeKey, no vendor code |
| LLM | `@google/genai`, Gemini free tier | user's choice; free |
| Hosting | Vercel + Neon + GitHub Actions cron | all $0, public URL — but see gap #33 on cadence |

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

pnpm --filter web tick       # run one pipeline tick (ingest → cluster → confirm → index)
pnpm --filter web calibrate  # re-read the similarity distribution from live feeds
pnpm --filter web crash-test # the Phase 2 idempotency proof (creates a REAL market on chain)

pnpm --filter web agents:register  # seed members, fund agent wallets, register caps ON CHAIN (local only)
pnpm --filter web verify:agents    # roles + registry + the cap boundary + kill switch. Signs nothing;
                                   # appends one audit_log halt row (rule #7), nothing else.
pnpm --filter web agents:over-cap  # THE over-cap bet: sends cap+1 wei and the chain refuses it
pnpm --filter web probe:cap        # the cap probe from the terminal — same code path as the button

pnpm --filter web check:contrast   # AA on every real surface pair · greyscale · 3x colour blindness
pnpm --filter web check:render     # 390px overflow · focus rings · reduced motion, over all 8 routes
```

`check:render` needs a built server and Playwright, which is deliberately not a dependency of this
project; it skips with an explanation rather than failing. To actually run it:
`PLAYWRIGHT=/path/to/playwright/index.mjs BASE=http://localhost:3210 node scripts/check-render.mjs`.

## Repo layout

```
contracts/     Hardhat 3 · Solidity · tests · deploy + verify scripts
web/           Next.js app — dashboard, API routes, pipeline workers, agents
docs/          product: PRD · ARCHITECTURE · TRUST_MODEL · CONTRACTS · SELF_HOSTING · RUNBOOK · WALKTHROUGH
               record:  BUILD_RECORD · BUILD_PLAN · DECISIONS  (PROGRESS.md is in the root)
scripts/       one-off dev utilities (wallet gen, doctor)
launch-film/   the demo video (Remotion + Amazon Polly) — own npm, not a workspace package
CONTRIBUTING · SECURITY · CODE_OF_CONDUCT   <- the hard rules above, restated for human contributors
PROGRESS.md    <- the file that carries state between sessions
```

## Tone for user-facing output

The user maintains this solo and has to be able to defend and change any part of it. Be direct. Flag
risks early. When you make a judgement call, say what you chose and why in one or two sentences — not
an essay. If something is a trusted assumption or a limitation, name it plainly rather than hiding it;
in a product whose pitch is "check my claims", that honesty *is* the product.
