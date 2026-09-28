# PROGRESS.md — AuspeX build state

> **This file is the handoff between sessions.** A new session reads this first and continues from
> "Next phase". It is updated at the end of every phase, before the commit. If it is stale, the next
> session starts blind.
>
> Session protocol and hard rules live in `CLAUDE.md`. Phase tasks and exit criteria live in
> `docs/BUILD_PLAN.md`. Manual setup state lives in `docs/RUNBOOK.md`.

**Last updated:** 2026-09-28
**Current status:** ✅ Phase 0 complete
**Next phase:** **Phase 1 — Smart contract: build, test, deploy to MST Testnet, verify on MSTScan**

---

## Phase status

| Phase | Name | Status |
|:--|:--|:--|
| 0 | Foundations & rails | ✅ Complete |
| 1 | Smart contract — build, test, deploy, verify | ⬜ **NEXT** |
| 2 | Data layer + chain client + idempotency engine | ⬜ Not started |
| 3 | News ingestion, dedup, 2-source confirmation | ⬜ Not started |
| 4 | Market proposer agent + human approval gate | ⬜ Not started |
| 5 | Member agents + deterministic policy gate | ⬜ Not started |
| 6 | Resolution, challenge window, payout | ⬜ Not started |
| 7 | Dashboard polish + trust page | ⬜ Not started |
| 8 | Live end-to-end run + README + submission | ⬜ Not started |

Legend: ⬜ not started · 🟡 in progress · ✅ complete · ⚠️ complete with known gaps

---

## Real artifacts

> Only verified, resolvable values go here. Never write a placeholder that looks real.

| Artifact | Value | Status |
|:--|:--|:--|
| **Public GitHub repo** | https://github.com/arunishrajput/auspex | ✅ |
| **CI** (build/test/lint/secret+mock guards) | https://github.com/arunishrajput/auspex/actions | ✅ green |
| **Live demo URL** | **https://auspex-web-mu.vercel.app** | ✅ public, live chain data |
| Vercel project | `auspex-web` (team `arunish-rajputs-projects`), root dir `web` | ✅ auto-deploys on push |
| Deployer wallet | `0xc71dC478040F7A6bcc5Cb1f316A4a446F7D4ad24` | ✅ funded, 10 tMSTC |
| `AuspexMarket` contract address | _not deployed yet_ | ⬜ Phase 1 |
| Deployment tx hash | _n/a_ | ⬜ Phase 1 |
| Source verified on MSTScan | _n/a_ | ⬜ Phase 1 |
| `createMarket` tx (human-approved) | _n/a_ | ⬜ Phase 4 |
| `placeBet` tx (agent, within caps) | _n/a_ | ⬜ Phase 5 |
| Over-cap bet tx (**expected revert**) | _n/a_ | ⬜ Phase 5 |
| Resolution tx (with evidence URL) | _n/a_ | ⬜ Phase 6 |
| Payout / claim tx | _n/a_ | ⬜ Phase 6 |

---

## Phase 0 — what shipped

**Repo & workspace** — pnpm workspace (`contracts/` Hardhat 3 + `web/` Next.js 16), `.gitignore`
that makes secrets uncommittable, `.env.example` with placeholders only, public GitHub repo.

**Contracts toolchain (validated, not assumed)** — Hardhat 3.18 + solc 0.8.28 + `evmVersion: cancun`
+ OpenZeppelin 5; `chainDescriptors` + `verify.blockscout` pointing at `testnet.mstscan.com/api`;
`Ping.sol` smoke test with 3 passing tests; `deploy.ts` (writes `deployments/<network>.json`, refuses
wrong chain / zero balance) and `verify.ts`.

**Web app** — Next.js 16 + React 19 + Tailwind 4, dark mission-control theme. `/` reads **live chain
state on every load** and shows a real error rather than a placeholder if the RPC is down.
`/api/rpc/[network]` proxy with a read-only method allowlist. `web/lib/chain.ts` is the single source
of truth for network constants and explorer links.

**Tooling & CI** — `pnpm wallets:new`, `pnpm preflight` (checks RPC, explorer, wallet balance, DB,
Gemini chain, deployed contract, and names which phase each failure blocks), `ci.yml` (build, tests,
typecheck + guards that fail on committed secrets or `MOCK` in production source), `heartbeat.yml`.

**Docs** — `CLAUDE.md`, `PROGRESS.md`, and `docs/`: PRD, ARCHITECTURE, BUILD_PLAN, CONTRACTS,
TRUST_MODEL, RUNBOOK, DEMO_SCRIPT, DECISIONS (**18 ADRs**, each with evidence).

**Infrastructure set up automatically** — `.env.local` (chmod 600) with a generated deployer wallet,
`AGENT_KEY_ENC_SECRET` and `TICK_SECRET`; a Gemini API key created and written without the value ever
entering a log; Vercel project imported with root dir `web`; Deployment Protection disabled so the
demo URL is publicly reachable.

### Exit criteria

| Criterion | Result |
|:--|:--|
| `pnpm install` from clean clone | ✅ |
| `pnpm compile` (solc 0.8.28 / cancun) | ✅ |
| `pnpm -r build` / `test` / `lint` / `typecheck` | ✅ all green, 3 tests passing |
| `pnpm preflight` reports RPC + chain `91562037` | ✅ |
| Public GitHub repo, `main` pushed, CI green | ✅ |
| No secret in git; `.env.local` ignored | ✅ verified with `git check-ignore` |
| **Vercel URL loads and shows the real block height** | ✅ https://auspex-web-mu.vercel.app |
| `docs/RUNBOOK.md` covers every manual step | ✅ |

---

## Blocking items for you — `docs/RUNBOOK.md` has exact steps

| # | Item | Blocks | Why Claude could not do it |
|:--|:--|:--|:--|
| §1 | **Enable Gemini billing** | Phases 3–5 | Cannot enter payment details |
| §3 | **Accept Neon terms** (Vercel → Storage → Neon) | Phase 2 | Accepting third-party legal terms is the user's decision |
| §4 | Discord webhook | Phase 4 notifications | Needs your Discord server |
| §5 | BridgeKey install + seed phrase | Phase 4 approvals | Seed phrase custody must be yours |

**Phase 1 is fully unblocked** — the deployer wallet is funded and nothing else in Phase 1 depends
on the remaining items.

---

## Decisions already locked in

Full rationale with evidence in `docs/DECISIONS.md` (ADR-001 … ADR-018):

- **Hardhat 3, not 2** — HH2's `ts-node` crashes on Node 26 (reproduced directly).
- **Explorer is `testnet.mstscan.com`**, not `mstscan.com` (different chain).
- **Fortuna VRF cut** — `eth_getCode` returns `0x` on testnet; it is a mainnet contract.
- **`evmVersion: cancun`** — PUSH0/MCOPY/TSTORE verified executing via `eth_call` state overrides.
- **Strings stored on-chain deliberately** — base fee is 0, so legibility on MSTScan is free.
- **ethers v6 on the critical path**, not `@mstblockchain/mst-sdk`.
- **Parimutuel payout**, not an AMM.
- **Two independent agent limit layers** — off-chain policy gate + on-chain caps.
- **EIP-1193/6963 via wagmi `injected()`** — no BridgeKey-specific code.
- **ADR-017: Gemini free tier is not demo-viable** — 0/20 calls succeeded (all HTTP 503 capacity
  errors), one earlier success took 159s, and the 2.5 series now 404s. Config uses comma-separated
  **fallback chains** (`GEMINI_MODELS_FAST` / `GEMINI_MODELS_SMART`) with a 20s per-attempt timeout.
- **ADR-018: the faucet leaks its dispensing wallet's private key** in its public JS bundle
  (~504,908 tMSTC exposed). We fund only through the UI and never touch that key.

---

## Known gaps

**1. Gemini currently unusable until billing is enabled (RUNBOOK §1).**
Measured 0/20 successful calls, all HTTP 503 "high demand". Blocks Phases 3–5. Does not block
Phase 1 or 2. The pipeline's fail-safe path handles it correctly, but a demo with no AI output is
a bad demo.

**2. Production env vars not yet pushed to Vercel.** Deferred on purpose: the Phase 0 status page
needs none, and `DATABASE_URL` does not exist yet. Do it with `vercel env add` (RUNBOOK §8) rather
than pasting into the dashboard, so values stay out of shell history and transcripts.

---

## What the next session needs to know

**Start Phase 1: the smart contract.** Read `docs/CONTRACTS.md` first — it is the full spec (roles,
lifecycle, parimutuel payout, agent caps, challenge window, custom errors, and the required test
matrix). `docs/BUILD_PLAN.md` has the Phase 1 exit criteria.

The deployer wallet is funded (10 tMSTC), so Phase 1 can go all the way through deploy **and**
MSTScan verification in one session.

**Toolchain notes that will save time:**
- Hardhat 3 API: `hre.network.getOrCreate(name)`; `connect()` is deprecated. In tests use
  `await network.create()` for a fresh isolated EDR instance.
- Anything imported in a test must be an explicit dependency — pnpm isolates transitive packages
  (this is why `chai` had to be added directly).
- `pnpm doctor` is a **built-in pnpm command**; ours is `pnpm preflight`.
- `next lint` was removed in Next 16 — lint is ESLint 9 flat config using `eslint-config-next`'s
  native flat exports (FlatCompat/eslintrc breaks on v16).
- Verify with the exact deployed settings: solc 0.8.28, `evmVersion: cancun`, optimizer runs 200.
- Prove the deploy→verify flow with `Ping.sol` first, then delete it once `AuspexMarket` is deployed
  and verified.
- Vercel auto-deploys `main` to https://auspex-web-mu.vercel.app — a broken build there is public.
