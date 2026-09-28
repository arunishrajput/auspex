# PROGRESS.md — AuspeX build state

> **This file is the handoff between sessions.** A new session reads this first and continues from
> "Next phase". It is updated at the end of every phase, before the commit. If it is stale, the next
> session starts blind.
>
> Session protocol and hard rules live in `CLAUDE.md`. Phase tasks and exit criteria live in
> `docs/BUILD_PLAN.md`.

**Last updated:** 2026-09-28 (Phase 0 session)
**Current status:** Phase 0 in progress
**Next phase:** Phase 0 — Foundations & rails (finish), then Phase 1 — Smart contract

---

## Phase status

| Phase | Name | Status |
|:--|:--|:--|
| 0 | Foundations & rails | 🟡 In progress |
| 1 | Smart contract — build, test, deploy, verify | ⬜ Not started |
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
| `AuspexMarket` contract address | _not deployed yet_ | ⬜ Phase 1 |
| Deployment tx hash | _n/a_ | ⬜ Phase 1 |
| Source verified on MSTScan | _n/a_ | ⬜ Phase 1 |
| `createMarket` tx (human-approved) | _n/a_ | ⬜ Phase 4 |
| `placeBet` tx (agent, within caps) | _n/a_ | ⬜ Phase 5 |
| Over-cap bet tx (**expected revert**) | _n/a_ | ⬜ Phase 5 |
| Resolution tx (with evidence URL) | _n/a_ | ⬜ Phase 6 |
| Payout / claim tx | _n/a_ | ⬜ Phase 6 |
| Public demo URL (Vercel) | _not deployed yet_ | ⬜ Phase 0 |
| Public GitHub repo | _not created yet_ | ⬜ Phase 0 |

---

## Environment / accounts checklist

Tracked here because these are manual, one-time, and block later phases.
Step-by-step instructions are in `docs/RUNBOOK.md`.

| Item | Status | Notes |
|:--|:--|:--|
| Node 26 / pnpm 11 / git / gh CLI | ✅ present | `gh` authed as `arunishrajput` with `repo`+`workflow` scopes |
| Vercel CLI installed | ✅ v58.5.1 | — |
| Vercel logged in | ⬜ **manual** | `vercel login` — token was invalid at Phase 0 |
| GitHub repo created + pushed | ⬜ | Phase 0 |
| Neon project + `DATABASE_URL` | ⬜ **manual** | RUNBOOK §2 |
| Gemini API key | ⬜ **manual** | RUNBOOK §3 — aistudio.google.com/apikey |
| Discord webhook URL | ⬜ **manual** | RUNBOOK §4 |
| BridgeKey installed + MST Testnet added | ⬜ **manual** | RUNBOOK §5 |
| Deployer wallet generated | ⬜ | `pnpm wallets:new` |
| Deployer funded from faucet | ⬜ **manual** | faucet.masterstroke.academy |

---

## Decisions already locked in

Full rationale in `docs/DECISIONS.md`. Summary so a new session does not relitigate:

- **Hardhat 3, not Hardhat 2.** Hardhat 2 crashes on this machine's Node 26 via `ts-node`. Verified
  by direct test. HH3 compiles cleanly with solc 0.8.28 / evmVersion `cancun`.
- **Explorer is `testnet.mstscan.com`**, not `mstscan.com` (which indexes a different chain).
- **Fortuna VRF is cut** — verified to have no bytecode on testnet.
- **ethers v6 on the critical path**, not `@mstblockchain/mst-sdk` (thin v1.0.0 wrapper, no types).
- **Gemini free tier**, models `gemini-3.5-flash-lite` / `gemini-3.8-flash`.
- **Vercel + Neon + GitHub Actions**, all $0.
- **Notifications:** in-app feed + Discord webhook.
- **Strings stored on-chain deliberately** — gas is free here, judge legibility is not.

---

## Known gaps

_None recorded yet._

> When a phase exit criterion cannot be met, record it here with: what failed, why, what it blocks,
> and the plan to close it. Never leave a failed criterion silently unlisted.

---

## What the next session needs to know

Phase 0 is mid-flight. The repo skeleton, `.gitignore`, `.env.example`, root workspace config,
`CLAUDE.md` and this file exist. Still to do in Phase 0: the `docs/` set, the `contracts/` and `web/`
packages, CI workflows, the wallet + doctor scripts, the GitHub repo, and the Vercel/Neon wiring.

The manual account steps (Vercel login, Neon, Gemini key, Discord webhook, BridgeKey, faucet) are
the user's to do — `docs/RUNBOOK.md` walks through each one. Phase 1 cannot deploy until the deployer
wallet is generated **and** funded from the faucet.
