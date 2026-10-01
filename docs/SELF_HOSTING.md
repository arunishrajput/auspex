# Self-hosting AuspeX

How to run your own copy end to end: your own contract, your own human authority, your own agents,
your own database. Allow an hour the first time, most of it waiting on accounts.

If you only want to read the code, run the tests or look at the dashboard, you need none of this —
see [**Run it in two minutes**](#0-run-it-in-two-minutes-no-accounts-no-secrets) below.

> **Testnet only.** Nothing here is audited and tMSTC has no value. Do not point any of it at a
> network where coins are worth something. [`TRUST_MODEL.md`](./TRUST_MODEL.md) says what the design
> does and does not protect against, and the README's *Limitations* section is written to be read
> before you deploy, not after.

---

## What you need

| | Why | Cost |
|---|---|---|
| **Node ≥ 22** and **pnpm 11** | the monorepo. Developed on Node 26 — which is why it is **Hardhat 3**, not 2 | free |
| **An MST Testnet wallet**, funded at the [faucet](https://faucet.masterstroke.academy) | deploys the contract and holds the admin role; funds the agent wallets | free |
| **A browser wallet extension** (BridgeKey, or any EIP-1193 / EIP-6963 wallet) | the **human authority** — it signs `createMarket` and resolutions. Its key should never touch a server | free |
| **A Postgres database** — [Neon](https://neon.tech) is what this was built on | the pipeline's state, the audit log, the intent engine | free tier |
| **A Gemini API key** from [AI Studio](https://aistudio.google.com/apikey) | the three agents. **The free tier works** — no billing account needed | free tier |
| *optional* — **Vercel** | hosting the dashboard; the app's root directory is `web` | free tier |
| *optional* — **GitHub Actions** | the unattended heartbeat that advances the pipeline | free |
| *optional* — **a Discord webhook** | a message when a market is created | free |

Network facts, verified against the chain:

```
Network   MST Testnet
RPC       https://testnetrpc.mstblockchain.com
Chain ID  91562037  (0x5752035)
Currency  tMSTC, 18 decimals
Explorer  https://testnet.mstscan.com      ← not mstscan.com, which indexes a different chain
Faucet    https://faucet.masterstroke.academy
```

---

## 0. Run it in two minutes (no accounts, no secrets)

```bash
git clone https://github.com/arunishrajput/auspex
cd auspex
pnpm install
pnpm compile          # solc 0.8.28, evm cancun — also generates the typed contract bindings
pnpm test             # contract tests + web unit tests; no network, no keys
pnpm dev              # http://localhost:3000
```

With no `.env.local` at all, the dashboard reads **the live AuspeX contract** through the public RPC.
Everything that comes from the chain renders for real — the markets, the role matrix, the contract's
own error history — and every panel that needs the database says
`DATABASE_URL is not configured` instead of inventing a number. Checked on a clean clone on
2026-10-01: all eight routes return 200.

That is enough to work on the UI, the policy gate, the schemas or the contract. Everything below is
for running a deployment of your own.

---

## 1. The environment file

```bash
cp .env.example .env.local
```

There is **one** secrets file, at the repository root. `contracts/hardhat.config.ts` and the web app
both read it, so a value such as the contract address is written once. It is git-ignored, and CI
fails if an `.env` file or a real-looking key is ever committed. Every variable is documented inline
in [`.env.example`](../.env.example); the steps below fill them in order.

Generate the two local secrets now:

```bash
openssl rand -hex 32    # → AGENT_KEY_ENC_SECRET  (encrypts agent keys at rest)
openssl rand -hex 24    # → TICK_SECRET           (authorises POST /api/tick)
```

---

## 2. The deployer wallet

```bash
pnpm wallets:new
```

It prints an address and a private key **once, to your terminal, and writes nothing to disk** — a
script that writes keys to a file is one `git add -A` away from committing a secret. Paste the key
into `DEPLOYER_PRIVATE_KEY`, then fund the address at the
[faucet](https://faucet.masterstroke.academy). 10 tMSTC is plenty; gas on this chain is effectively free.

This key ends up holding `DEFAULT_ADMIN_ROLE`. **Keep it on your machine.** It is deliberately absent
from the hosted app (see step 9).

---

## 3. The database

Create a Postgres database. On Neon you need **both** connection strings, and they are not
interchangeable:

| Variable | Which Neon string | Used by |
|---|---|---|
| `DATABASE_URL` | the **pooled** one (host contains `-pooler`) | the app |
| `DATABASE_URL_UNPOOLED` | the **direct** one | migrations — the pooler rejects the session-level statements DDL needs |

Get them from the Neon console or `neonctl connection-string`. (If you use Vercel's Neon
integration, `vercel env pull` writes the literal string `[SENSITIVE]` for these — use `neonctl`.)

```bash
pnpm --filter web db:migrate
```

A first connection to a Neon database that has scaled to zero can take 10–25 s. Slow is not broken.

---

## 4. The model

Create a key at [AI Studio](https://aistudio.google.com/apikey) and set `GEMINI_API_KEY`. The free
tier is enough. If you see HTTP **402**, read the body: *"prepayment credits are depleted"* is scoped
to that key's Google Cloud project — a key in a project with no billing account attached uses the
free tier. [`RUNBOOK.md`](./RUNBOOK.md) §1 has the story.

`GEMINI_MODELS_FAST` is a comma-separated **fallback chain**, tried left to right. The default order
was measured, not assumed; change it without a redeploy if a model starts returning 503.

---

## 5. Deploy and verify the contract

```bash
pnpm deploy:testnet
pnpm verify:testnet
```

`deploy:testnet` deploys `AuspexMarket(admin = your deployer, challengeWindow = 120 s)` and writes
`contracts/deployments/mstTestnet.json` — address, ABI, deploy transaction and block. **The web app
reads the contract from that file**, so committing it in your fork is what points your dashboard at
your contract. Copy the address into `NEXT_PUBLIC_AUSPEX_MARKET_ADDRESS` as well.

`verify:testnet` publishes the source to MSTScan (Blockscout). Do not skip it: decoded revert reasons
on the explorer — `AgentPerTxCapExceeded(attempted, cap)` rather than raw bytes — only exist for
verified source, and they are the whole point.

The challenge window is a constant in `contracts/scripts/deploy.ts` and immutable once deployed.
120 s is chosen so a lifecycle can be watched end to end; it is far too short for production, and the
README explains what that costs.

---

## 6. The human authority

This is the wallet that signs for every market. Its key should exist only in a browser extension.

1. In your browser wallet, add MST Testnet (chain `91562037`, RPC above) and create an account.
2. Fund it from the faucet, and put its **address** — never its key — in `HUMAN_AUTHORITY_ADDRESS`.
3. Grant it the three judgement roles, and nothing else:

   ```bash
   ROLE=MARKET_CREATOR_ROLE TO=0xYourBrowserWallet pnpm --filter contracts grant:testnet
   ROLE=RESOLVER_ROLE       TO=0xYourBrowserWallet pnpm --filter contracts grant:testnet
   ROLE=CHALLENGER_ROLE     TO=0xYourBrowserWallet pnpm --filter contracts grant:testnet
   ```

   The script refuses to run unless your signer holds `DEFAULT_ADMIN_ROLE`, refuses an address that
   has contract code, and exits without sending anything if the role is already held.
   `DEFAULT_ADMIN_ROLE` cannot be granted from it, on purpose: the human wallet should hold every role
   that needs judgement and none that confers power.

Then run the preflight, which checks the chain, explorer, deployer, the human wallet's role boundary,
the model, the database, the contract and the agent caps:

```bash
pnpm preflight
```

---

## 7. Register the agents

Members and their policies live in [`web/lib/agents/members.ts`](../web/lib/agents/members.ts). Edit
them, then:

```bash
pnpm --filter web agents:register
```

It seeds the members, creates an agent wallet for each (key encrypted with `AGENT_KEY_ENC_SECRET`),
tops each one up from the deployer, and writes each agent's caps **on chain** with `registerAgent`.
Safe to re-run. It is a local command rather than a pipeline stage because `registerAgent` needs the
admin key, and the admin key is never deployed.

Prove the boundary before trusting it:

```bash
pnpm --filter web verify:agents   # roles, registry, the cap boundary, the kill switch — eth_call only
pnpm --filter web probe:cap       # one real over-cap bet; the chain refuses it (needs an open market)
```

---

## 8. Run the pipeline

```bash
pnpm dev                       # the dashboard
pnpm --filter web tick         # one tick: ingest → cluster → propose → agents → resolve → settle
```

A local tick takes around 100 s, almost all of it database round trips; in production it is closer to
15 s. When a story is confirmed by two independent publishers and drafted, it appears on
**`/review`**. Connect the human-authority wallet there, read the checklist, and approve — your browser
signs `createMarket`. That signature is the only way a market reaches the chain.

---

## 9. Host it (optional)

**Vercel.** Import the repository with **root directory `web`**. Set the environment variables from
`.env.local` — **except `DEPLOYER_PRIVATE_KEY`, which stays on your machine.** The hosted app then
holds only agent keys, which hold no role and are capped by the contract; no key it holds can create a
market, resolve one, grant a role or pause the contract. A tick that needs a signature it cannot make
defers the work instead of failing (ADR-047). Please do not "fix" that by adding the admin key.

**GitHub Actions heartbeat.** `.github/workflows/heartbeat.yml` POSTs to `/api/tick` on a schedule.
Set repository secrets `TICK_URL` (`https://<your-app>/api/tick`) and `TICK_SECRET`. `sync.yml`
optionally takes `SYNC_URL` and `CRON_SECRET`, and falls back to the tick values without them. With
no secrets set, both workflows skip cleanly — so a fork does nothing until you opt in.

Scheduled workflows on GitHub are best-effort: on a low-traffic public repository they can be delayed
by hours. Nothing user-facing should depend on the cadence. `/audit` measures what is actually
delivered, and the dashboard's **Run tick** button advances the pipeline on demand.

---

## Useful commands

```bash
pnpm --filter web index              # read new contract events into the database
pnpm --filter web index:replay       # re-read from the deploy block; idempotent
pnpm --filter web verify:resolution  # the resolution gates, by eth_call
pnpm --filter web lifecycle          # a whole resolution lifecycle on chain, ~5 minutes
pnpm --filter web crash-test         # the idempotency proof — creates a REAL market
pnpm --filter web calibrate          # re-measure the similarity distribution from live feeds
pnpm --filter web check:contrast     # AA contrast, greyscale and colour-blindness on every surface
pnpm check:links                     # every hash, named sender and link in the README, re-read from MSTScan
```

## When something goes wrong

- **A model call fails or rate-limits** → the tick takes no action for that stage, logs why, and
  continues. That is the design, not a bug; check `/audit`.
- **`402` from Gemini** → read the body (step 4).
- **A transaction you expected to succeed reverted** → open it on `testnet.mstscan.com`; with verified
  source the revert reason is decoded. Many reverts in this project are deliberate.
- **Explorer shows nothing for your hash** → check you are on `testnet.mstscan.com`, not `mstscan.com`.
- **Hardhat crashes with `Cannot read properties of undefined (reading 'fileExists')`** → that is
  Hardhat 2 on Node 26. This repository uses Hardhat 3; make sure nothing pulled in a v2 binary.
