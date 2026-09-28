# PROGRESS.md — AuspeX build state

> **This file is the handoff between sessions.** A new session reads this first and continues from
> "Next phase". It is updated at the end of every phase, before the commit. If it is stale, the next
> session starts blind.
>
> Session protocol and hard rules live in `CLAUDE.md`. Phase tasks and exit criteria live in
> `docs/BUILD_PLAN.md`.

**Last updated:** 2026-09-28
**Current status:** ✅ Phase 0 complete (one deferred item — Vercel deploy, needs your login)
**Next phase:** **Phase 1 — Smart contract: build, test, deploy to MST Testnet, verify on MSTScan**

---

## Phase status

| Phase | Name | Status |
|:--|:--|:--|
| 0 | Foundations & rails | ✅ Complete (1 deferred) |
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
> Everything in this table must open on `https://testnet.mstscan.com`.

| Artifact | Value | Status |
|:--|:--|:--|
| **Public GitHub repo** | https://github.com/arunishrajput/auspex | ✅ pushed |
| `AuspexMarket` contract address | _not deployed yet_ | ⬜ Phase 1 |
| Deployment tx hash | _n/a_ | ⬜ Phase 1 |
| Source verified on MSTScan | _n/a_ | ⬜ Phase 1 |
| `createMarket` tx (human-approved) | _n/a_ | ⬜ Phase 4 |
| `placeBet` tx (agent, within caps) | _n/a_ | ⬜ Phase 5 |
| Over-cap bet tx (**expected revert**) | _n/a_ | ⬜ Phase 5 |
| Resolution tx (with evidence URL) | _n/a_ | ⬜ Phase 6 |
| Payout / claim tx | _n/a_ | ⬜ Phase 6 |
| Public demo URL (Vercel) | _not deployed — see Known gaps_ | ⚠️ deferred |

---

## Phase 0 — what shipped

**Repo & workspace**
- pnpm workspace: `contracts/` (Hardhat 3) + `web/` (Next.js 16), plus `docs/` and `scripts/`.
- `.gitignore` makes secrets uncommittable; `.env.example` holds placeholders only.
- Public GitHub repo created and pushed to `main`.

**Contracts toolchain (validated, not assumed)**
- Hardhat 3.18 + solc 0.8.28 + `evmVersion: cancun`, OpenZeppelin 5.
- `hardhat.config.ts` wired for MST Testnet with `chainDescriptors` + `verify.blockscout`
  pointing at `https://testnet.mstscan.com/api`.
- `contracts/contracts/Ping.sol` — a deliberate toolchain smoke test with 3 passing tests, so the
  deploy→verify flow can be proven in Phase 1 *before* debugging a 400-line market contract.
- `scripts/deploy.ts` (writes `deployments/<network>.json`, refuses wrong chain / zero balance)
  and `scripts/verify.ts`.

**Web app**
- Next.js 16 + React 19 + Tailwind 4, dark "mission control" theme.
- `/` status page reads **live chain state on every load** — chain ID, block height, gas price,
  last block time — and shows a real error rather than a placeholder if the RPC is down.
- `/api/rpc/[network]` same-origin JSON-RPC proxy with a read-only method allowlist.
- `web/lib/chain.ts` — single source of truth for network constants and explorer links.

**Tooling & CI**
- `pnpm wallets:new` — generates an EOA, writes nothing to disk, prints the key once.
- `pnpm preflight` — checks RPC, explorer, deployer balance, DB, Gemini, and the deployed
  contract, and names which phase each failure blocks.
- `.github/workflows/ci.yml` — build, contract tests, typecheck, **plus guards that fail the build
  on a committed secret or on `MOCK` provenance in production source**.
- `.github/workflows/heartbeat.yml` — cron tick driver (demo uses the UI button; cron is
  best-effort and must never be a demo dependency).

**Docs** — `CLAUDE.md`, `PROGRESS.md`, and `docs/`: PRD, ARCHITECTURE, BUILD_PLAN, CONTRACTS,
TRUST_MODEL, RUNBOOK, DEMO_SCRIPT, DECISIONS (16 ADRs, each with evidence).

### Exit criteria

| Criterion | Result |
|:--|:--|
| `pnpm install` from clean clone | ✅ |
| `pnpm compile` (solc 0.8.28 / cancun) | ✅ |
| `pnpm -r build` | ✅ |
| `pnpm -r test` | ✅ 3 passing |
| `pnpm -r lint` / `pnpm -r typecheck` | ✅ |
| `pnpm preflight` reports RPC + chain `91562037` | ✅ block 5,783,447 |
| Public GitHub repo, `main` pushed | ✅ |
| No secret in git; `.env.local` ignored | ✅ verified with `git check-ignore` |
| `docs/RUNBOOK.md` covers every manual step | ✅ |
| Vercel URL loads | ⚠️ **deferred — see Known gaps** |

---

## Environment / accounts checklist

Step-by-step instructions: `docs/RUNBOOK.md`.

| Item | Status | Notes |
|:--|:--|:--|
| Node 26 / pnpm 11 / git / gh CLI | ✅ | `gh` authed as `arunishrajput` |
| Vercel CLI installed | ✅ v58.5.1 | — |
| **Vercel logged in** | ⬜ **YOU** | `vercel login` — RUNBOOK §1 |
| GitHub repo created + pushed | ✅ | github.com/arunishrajput/auspex |
| **Neon project + `DATABASE_URL`** | ⬜ **YOU** | RUNBOOK §2 — blocks Phase 2 |
| **Gemini API key** | ⬜ **YOU** | RUNBOOK §3 — blocks Phase 3 |
| **Discord webhook URL** | ⬜ **YOU** | RUNBOOK §4 — blocks Phase 4 |
| **BridgeKey + MST Testnet added** | ⬜ **YOU** | RUNBOOK §5 — blocks Phase 4 |
| **Deployer wallet generated** | ⬜ **YOU** | `pnpm wallets:new` — **blocks Phase 1** |
| **Deployer funded from faucet** | ⬜ **YOU** | faucet.masterstroke.academy — **blocks Phase 1** |

---

## Decisions already locked in

Full rationale with evidence in `docs/DECISIONS.md` (ADR-001 … ADR-016). Summary so a new session
does not relitigate:

- **Hardhat 3, not 2.** HH2's `ts-node` crashes on Node 26 (reproduced directly). HH3 compiles cleanly.
- **Explorer is `testnet.mstscan.com`**, not `mstscan.com` (different chain: head ~20.8M vs ~5.78M).
- **Fortuna VRF cut** — `eth_getCode` returns `0x` on testnet; it is a mainnet contract.
- **`evmVersion: cancun`** — PUSH0/MCOPY/TSTORE verified executing via `eth_call` state overrides.
- **Strings stored on-chain deliberately** — base fee is 0, so legibility on MSTScan is free.
- **ethers v6 on the critical path**, not `@mstblockchain/mst-sdk` (thin v1.0.0 wrapper, no types).
- **Parimutuel payout**, not an AMM — auditable in one line, defensible under questioning.
- **Two independent agent limit layers**: off-chain policy gate + on-chain caps.
- **EIP-1193/6963 via wagmi `injected()`** — no BridgeKey-specific code.
- **Gemini free tier**: `gemini-3.5-flash-lite` (volume) / `gemini-3.8-flash` (judgement).
- **Vercel + Neon + GitHub Actions**, all $0.

---

## Known gaps

**1. Vercel deployment not done — blocked on your login.**
`vercel whoami` returned `The specified token is not valid`. Only you can authenticate.
- *What it blocks:* the public demo URL. Nothing in Phase 1 depends on it.
- *To close it:* `vercel login`, then from the repo root:
  ```bash
  vercel link          # scope to the auspex project; set root directory to "web"
  vercel --prod
  ```
  Then record the URL in the Real artifacts table above and in the README.

No other exit criteria failed.

---

## What the next session needs to know

**Start Phase 1: the smart contract.** Read `docs/CONTRACTS.md` first — it is the full spec
(roles, market lifecycle, parimutuel payout, agent caps, challenge window, custom errors, and the
required test matrix). `docs/BUILD_PLAN.md` has the Phase 1 exit criteria.

**Phase 1 is hard-blocked** until the deployer wallet exists and is funded:
```bash
pnpm wallets:new                      # then paste the key into .env.local
# fund the printed ADDRESS at https://faucet.masterstroke.academy
pnpm preflight                        # confirm "Deployer wallet" goes green
```
Write and test the contract regardless — only the deploy/verify steps need funds.

**Toolchain notes that will save time:**
- Hardhat 3 API: `hre.network.getOrCreate(name)`; `network.connect()` is deprecated.
  In tests use `await network.create()` for a fresh isolated EDR instance.
- Anything imported in a test must be an explicit dependency — pnpm isolates transitive
  packages (this is why `chai` had to be added directly).
- `pnpm doctor` is a **built-in pnpm command**; ours is `pnpm preflight`.
- Verify with the exact deployed settings: solc 0.8.28, `evmVersion: cancun`, optimizer runs 200.
- Prove the deploy→verify flow with `Ping.sol` first, then delete it once `AuspexMarket` is
  deployed and verified.
