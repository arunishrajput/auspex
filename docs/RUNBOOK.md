# RUNBOOK.md — setup state and manual steps

**Rule that never bends:** secrets go into `.env.local` (git-ignored) and into the Vercel / GitHub
secret stores. Never into a file that is committed, never into a chat message, never into a log.

---

## Already done — no action needed

These were completed automatically during Phase 0. Listed so you know what exists.

| Item | State |
|:--|:--|
| `.env.local` created (chmod 600, git-ignored) | ✅ |
| Deployer wallet generated | ✅ `0xc71dC478040F7A6bcc5Cb1f316A4a446F7D4ad24` |
| `AGENT_KEY_ENC_SECRET`, `TICK_SECRET` generated | ✅ |
| Gemini API key created ("AuspeX MST Buildathon") and written to `.env.local` | ✅ |
| GitHub repo created + pushed, CI green | ✅ github.com/arunishrajput/auspex |
| Vercel project imported, root dir `web`, auto-deploy on push | ✅ |
| Vercel Deployment Protection disabled (public demo URL) | ✅ |
| **Live demo URL** | ✅ https://auspex-web-mu.vercel.app |
| Deployer wallet funded (10 tMSTC) | ✅ |
| BridgeKey wallet created, funded (50 tMSTC), role granted | ✅ see §5 |
| BridgeKey recovery phrase backed up by the user, offline | ✅ never shared, never requested |

---

## ✅ §1 — Gemini  ·  **RESOLVED 2026-09-29, with no billing**

**Nothing to do here.** Kept because the diagnosis is worth not repeating.

### What was actually wrong

Phase 0 saw HTTP 503 and called it capacity contention. Phase 1 saw HTTP 402 and called it a
missing billing account, making this section "the one real blocker". Both were inferences from a
status code. Reading the **body** settled it:

```json
{ "error": { "code": 402,
  "message": "Your prepayment credits are depleted. Please go to AI Studio ...",
  "status": "RESOURCE_EXHAUSTED" } }
```

That is **prepay exhaustion on one Google Cloud project**, not an account-level requirement to
add a card. Every model returned it, including Gemma, because the balance is project-scoped.

### The fix, which took two commands

The old key lived in project `gen-lang-client-0780734527` ("Gemini CLI"), whose prepay balance is
at zero. A key created in a project with **no billing account attached** falls back to the free
tier:

```bash
gcloud services enable generativelanguage.googleapis.com --project=agentforge-gemini-free
gcloud services api-keys create --project=agentforge-gemini-free \
  --display-name="AuspeX MST Buildathon" \
  --api-target=service=generativelanguage.googleapis.com
gcloud services api-keys get-key-string <key-resource-name> --format='value(keyString)'
```

The result went into `GEMINI_API_KEY` in the repo-root `.env.local` and into Vercel (§8).
`pnpm preflight` reports **9/9 green**. The old key was left alone.

### What the free tier actually gives you

Measured 2026-09-29 across live ticks:

| Model | Behaviour |
|:--|:--|
| `gemini-3.1-flash-lite` | answered every call, 4.9–6.1s |
| `gemini-3.5-flash-lite` | two timeouts and one 503 out of four calls |
| `gemini-3.8-flash` | 503 "high demand" |

So the chain leads with **3.1-flash-lite** (ADR-034). If a model starts failing on demo day,
`GEMINI_MODELS_FAST` is an environment variable — reorder it, no deploy needed.

> If you ever *do* want paid capacity, add prepay credits at https://ai.studio/projects. Nothing
> in the code changes; it is the same API.

---

## ✅ §2 — Fund the deployer wallet  ·  done

**Done — the deployer holds 10 tMSTC.** The faucet has a reCAPTCHA, which Claude will not solve,
so you completed this step.

Deployer address: `0xc71dC478040F7A6bcc5Cb1f316A4a446F7D4ad24`

✅ The BridgeKey address is funded too (50 tMSTC) — see §5.

Re-check balances any time with:

```bash
pnpm preflight        # "Deployer wallet" should show a non-zero balance
```

> ⚠️ **Security note, worth reporting to the organisers.** The faucet ships its dispensing wallet's
> private key in its public JavaScript bundle (`REACT_APP_PRIVATE_KEY`). That wallet
> (`0xC10eEAb93a0F4b26a0c18E17e323d435F21f1ea1`) held ~504,908 tMSTC. Anyone can drain it from
> devtools. We deliberately did **not** use that key — only the UI. See ADR-018.

---

## ✅ §3 — Neon Postgres  ·  *blocks: Phase 2*  ·  **DONE 2026-09-28**

You accepted the terms and created the database; `DATABASE_URL` is set in the `auspex-web`
Vercel project for Production and Preview, and `DATABASE_URL` + `DATABASE_URL_UNPOOLED` are now
in the repo-root `.env.local` for local work. **Nothing left to do here.**

### ⚠️ `vercel env pull` does not work for these — and it does not tell you so

The Neon integration marks every variable it creates as **sensitive**, which means Vercel will
never decrypt them again — not in the dashboard, not through the API. `vercel env pull` still
reports success and still writes the file; the values in it are the literal string
`"[SENSITIVE]"`. Anything reading them fails later with a confusing URL parse error rather than
"this credential is missing". This is what blocked the start of Phase 2.

Get them from Neon instead, which owns them:

```bash
neonctl projects list --org-id org-royal-flower-52404323
neonctl connection-string main --project-id jolly-queen-98097073 \
  --database-name neondb --role-name neondb_owner --pooled   # → DATABASE_URL
neonctl connection-string main --project-id jolly-queen-98097073 \
  --database-name neondb --role-name neondb_owner            # → DATABASE_URL_UNPOOLED
```

`neonctl` opens a browser once to authenticate, then works non-interactively. Note the
`--org-id`: the account has two organisations and the Vercel-managed one
(`org-royal-flower-52404323`) holds this project. Without the flag the CLI stops on an
interactive picker and hangs any script.

**Both URLs are needed and they are not interchangeable.** The pooled one (host contains
`-pooler`) is PgBouncer in transaction mode and is what the app uses. Migrations must use the
direct one — PgBouncer rejects the session-level statements DDL issues.

Delete `web/.env.local` if a `vercel env pull` ever recreates it: Next.js gives it precedence
over the repo-root file, so its `[SENSITIVE]` placeholders would silently shadow the real values.

<details>
<summary>Original instructions, kept for reference</summary>

**Option A — via Vercel (recommended, auto-injects `DATABASE_URL` into the deployment):**

1. Open **https://vercel.com/arunish-rajputs-projects/auspex-web/stores**
2. **Create Database** → **Neon** → **Continue**
3. Read the terms, then **Accept and Create**.
4. Choose the **Free** plan, region closest to you, name `auspex`.
5. Vercel injects `DATABASE_URL` into the project automatically. Pull it locally:

```bash
vercel login && vercel link     # select the auspex-web project
vercel env pull .env.local      # merges DATABASE_URL in
```

**Option B — direct at neon.tech:** sign up, create project `auspex`, copy the **pooled** connection
string (host contains `-pooler`) into `.env.local` as `DATABASE_URL`.

> If you see `too many connections` later, you used the direct string instead of the pooled one.

</details>

---

## ✅ §4 — Discord webhook  ·  *blocks: Phase 4 notifications*  ·  **DONE**

`DISCORD_WEBHOOK_URL` is set in `.env.local` and `pnpm preflight` reports it. Steps kept below in
case the webhook needs recreating.

Two minutes, no bot token, no approval flow.

1. In Discord, create a server (or use one you own) and a channel, e.g. `#auspex-markets`.
2. **Channel settings** (hover the channel → gear) → **Integrations** → **Webhooks** →
   **New Webhook** → name it `AuspeX` → **Copy Webhook URL**.
3. Put it in `.env.local`:

```
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/.../...
```

**Demo tip:** have this channel visible on screen during the demo. Judges watching a notification
land in real time, seconds after the on-chain market is confirmed, is worth more than describing it.

> The webhook URL is a credential — anyone with it can post to your channel. It stays in `.env.local`.

---

## ✅ §5 — BridgeKey wallet + MST Testnet  ·  **DONE 2026-09-29**

**Complete. No action needed.** This is the wallet the human authority signs `createMarket` from
in Phase 4.

| Item | Value |
|:--|:--|
| Address | `0xA9F68fDf84388fa548a685085E2bee0e5b311fF1` |
| Balance | 50 tMSTC, verified against `testnetrpc.mstblockchain.com` |
| Chain | `91562037` ✅ |
| `MARKET_CREATOR_ROLE` | ✅ granted — tx `0xe4ed912c309db55a0cfa51e597ad4845369714a51fe77b0c282e39b8cc932069` |

**The balance was verified against our own RPC, not against the wallet UI.** BridgeKey ships a
built-in "MST Testnet" entry, and `mstscan.com` indexes a *different* chain — so a wallet can
show a confident balance that our contract cannot see. Querying our RPC for the address and
getting 50 tMSTC back is what actually proves the network is right.

### Granting a role (for Phase 5 and 6)

```bash
ROLE=MARKET_CREATOR_ROLE TO=0x… pnpm --filter contracts grant:testnet
ROLE=RESOLVER_ROLE       TO=0x… pnpm --filter contracts grant:testnet
ROLE=RESOLVER_ROLE       TO=0x… REVOKE=true pnpm --filter contracts grant:testnet
```

The script refuses to run if the signer is not an admin, refuses an address with contract code,
exits without sending anything if the role is already held, and reads the role back over the RPC
afterwards rather than trusting the receipt.

`RESOLVER_ROLE` is deliberately **not** on the BridgeKey wallet yet. Phase 6 is not blocked (the
deployer holds it), and granting a capability two phases before anything uses it is how least
privilege stops meaning anything.

### If you ever need to recreate this wallet

1. Install: **https://chromewebstore.google.com/detail/bridgekey/bfjojdcfenehemjgjlepdjomkpginlkg**
2. Create a wallet. Save the recovery phrase **on paper**. Never paste it anywhere — not into a
   file, not into a chat, not to Claude. Nothing in this repository needs it.
3. Select **MST Testnet**, or add it manually with exactly these values:

```
Network Name    : MST Testnet
RPC URL         : https://testnetrpc.mstblockchain.com
Chain ID        : 91562037
Currency Symbol : tMSTC
Block Explorer  : https://testnet.mstscan.com
```

> If the wallet pre-fills anything different, trust this table — these were verified directly
> against the chain. The explorer is `testnet.mstscan.com`, **not** `mstscan.com`.

4. Fund it at **https://faucet.masterstroke.academy** (reCAPTCHA, so this step is manual).
5. Verify it landed on the right chain — the check that catches a wrong network:

```bash
pnpm preflight     # or query the RPC directly for the address's balance
```

6. Grant the role with the command above, then record the address and tx hash in `PROGRESS.md`.

The app uses the standard EIP-1193 / EIP-6963 injected-provider interface, so **MetaMask with
the same custom network also works**. Nothing in the code is BridgeKey-specific; use BridgeKey
for the demo since the track recommends it.

---

## §6 — Extra wallets (agents)  ·  *Phase 5*

The deployer wallet and both generated secrets already exist in `.env.local` (see "Already done").
Funding it is §2.

Phase 5 creates member **agent** wallets programmatically and encrypts their keys at rest, so you
should not need this by hand. If you ever want one:

```bash
pnpm wallets:new --agent    # prints an address + key; paste the key into .env.local yourself
```

Nothing is written to disk by that command, by design — a script that writes keys to a file is one
`git add -A` away from committing a secret.

---

## §7 — GitHub repo  ·  ✅ done

Created and pushed: **https://github.com/arunishrajput/auspex** (public, CI green). Public is
required by the track, and it also makes GitHub Actions minutes free — which is what runs the
pipeline heartbeat.

---

## ✅ §8 — Secrets into Vercel and GitHub  ·  **DONE 2026-09-29**

Local `.env.local` does not reach production. These are now pushed.

**Vercel** (`auspex-web`, Production **and** Preview):

| Variable | Set by | Needed for |
|:--|:--|:--|
| `DATABASE_URL` + the `POSTGRES_*` / `PG*` set | Neon integration (§3) | everything |
| `NEXT_PUBLIC_AUSPEX_MARKET_ADDRESS` | Phase 1 | contract reads |
| `GEMINI_API_KEY` | Phase 3 | borderline adjudication |
| `GEMINI_MODELS_FAST` / `GEMINI_MODELS_SMART` / `GEMINI_TIMEOUT_MS` | Phase 3 | tuning without a deploy |
| `TICK_SECRET` | Phase 3 | `POST /api/tick` |
| `AGENT_KEY_ENC_SECRET` | Phase 3 (ahead of use) | Phase 5 agent keys |
| `DISCORD_WEBHOOK_URL` | Phase 3 (ahead of use) | Phase 4 notifications |
| `HUMAN_AUTHORITY_ADDRESS` | **Phase 4** | `/review` — unset means the page offers no approval at all |

`HUMAN_AUTHORITY_ADDRESS` is a **public address, never a key**. `/review` needs it to encode the
intent and to tell a reviewer which wallet to connect. Unset, the page says so and offers nothing,
rather than defaulting to accepting whatever wallet turns up.

Optional, all defaulted in code and all safe to leave unset: `LLM_CALLS_PER_TICK`,
`LLM_PROPOSER_CALLS_PER_TICK`, `MARKET_MIN_CLOSE_HOURS`, `MARKET_MAX_CLOSE_HOURS`. Set the last two
when a demo needs a market that closes during the event.

**GitHub Actions** (the cron heartbeat): `TICK_SECRET`, `TICK_URL`.

**`DEPLOYER_PRIVATE_KEY` is deliberately absent from Vercel.** Nothing in the deployed app signs
a transaction — the indexer only reads, and market creation in Phase 4 is signed by a human in
their own wallet. It should be added when something actually needs it (Phase 5), as a conscious
decision, rather than sitting in production for two phases first.

To add or rotate one:

```bash
cd web && vercel env add <NAME> production   # prompts for the value; nothing lands in shell history
gh secret set <NAME>                         # for GitHub Actions
```

Confirm any time with `cd web && vercel env ls` and `gh secret list`.

---

## §9 — Pre-demo checklist

Run through this before judging, not during.

- [ ] `pnpm preflight` **10/10** — RPC, chain ID 91562037, both wallets, the human wallet's
      role boundary, DB, Gemini, and the contract.
- [ ] Deployer (`0xc71dC478…`) and BridgeKey (`0xA9F68fDf…`) both funded.
- [ ] BridgeKey still holds `MARKET_CREATOR_ROLE` and **nothing else** — that is the trust claim.
- [ ] Contract shows **Verified** on `https://testnet.mstscan.com/address/<address>`.
- [ ] Public Vercel URL loads in a **private window** with no wallet installed.
- [ ] Discord channel visible on a second screen.
- [ ] At least one confirmed event sitting in `/review` ready to approve live.
- [ ] Every tx hash in the README opens on `testnet.mstscan.com`.
- [ ] The over-cap transaction shows **Reverted** (that is the point — it is evidence).
- [ ] You can explain the contract, the policy gate, and the pipeline without notes.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `insufficient funds for gas` | deployer unfunded | faucet the **deployer** address, not BridgeKey |
| Wallet shows wrong balance | wallet on the wrong network | check chain ID is `91562037` |
| Tx not found on explorer | looking at `mstscan.com` | use `testnet.mstscan.com` |
| `too many connections` | using Neon's direct string | switch to the **pooled** connection string |
| Gemini 429 | free-tier limit | expected; pipeline logs and continues. Wait or slow the tick |
| `hardhat` crashes with `fileExists` | Hardhat 2 on Node 26 | we use Hardhat 3; check you did not install HH2 |
| Verification fails | compiler/settings mismatch | verify with the same solc 0.8.28 + cancun + optimizer 200 |
| GH Actions cron not firing | cron is best-effort, and pauses on inactive public repos | use the dashboard "Run tick" button for the demo |
