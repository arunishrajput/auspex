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

---

## ⬜ §1 — Enable Gemini billing  ·  *blocks: Phases 3–5*

**Why this is needed.** Measured on 2026-09-28: the Gemini **free tier returned HTTP 503
"experiencing high demand" on 0/20 calls** across five models. The one earlier success took 159
seconds. This is capacity contention, not quota — retrying does not fix it. See ADR-017.

Claude cannot enter payment details, so this step is yours.

1. Open **https://aistudio.google.com/api-keys**
2. Find the row **AuspeX MST Buildathon** (project: *Gemini CLI*).
3. Click **Set up billing** in that row and follow the Google Cloud prompts to attach a billing
   account.
4. Verify it worked:

```bash
pnpm preflight        # "Gemini API" should go green and report which model answered
```

**Expected cost:** a few dollars at most for the whole hackathon. The pipeline sends short prompts,
bounded per tick, and caches by content hash.

> If you would rather not add a card, say so — the alternatives are a local Ollama model (free, but
> the deployed app cannot reach it, so ticks must run from your laptop) or a different provider.

---

## ✅ §2 — Fund the deployer wallet  ·  done

**Done — the deployer holds 10 tMSTC.** The faucet has a reCAPTCHA, which Claude will not solve,
so you completed this step.

Deployer address: `0xc71dC478040F7A6bcc5Cb1f316A4a446F7D4ad24`

Still to do when you set up BridgeKey (§5): fund your **BridgeKey address** too — the human
authority signs `createMarket` from it. Same faucet, same flow.

Re-check balances any time with:

```bash
pnpm preflight        # "Deployer wallet" should show a non-zero balance
```

> ⚠️ **Security note, worth reporting to the organisers.** The faucet ships its dispensing wallet's
> private key in its public JavaScript bundle (`REACT_APP_PRIVATE_KEY`). That wallet
> (`0xC10eEAb93a0F4b26a0c18E17e323d435F21f1ea1`) held ~504,908 tMSTC. Anyone can drain it from
> devtools. We deliberately did **not** use that key — only the UI. See ADR-018.

---

## ⬜ §3 — Neon Postgres  ·  *blocks: Phase 2*

Started for you in the Vercel dashboard, then stopped at the terms screen — **accepting Neon's
Terms and Privacy Policy is your decision, not Claude's**, and it shares your Vercel ID and email
with Neon.

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

---

## §4 — Discord webhook  ·  *blocks: Phase 4 notifications*

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

## §5 — BridgeKey wallet + MST Testnet  ·  *blocks: Phase 1 deploy, Phase 4 approvals*

BridgeKey is the track's recommended wallet and is how the human authority signs `createMarket`.

1. Install the Chrome extension:
   **https://chromewebstore.google.com/detail/bridgekey/bfjojdcfenehemjgjlepdjomkpginlkg**
2. Create a wallet, save the seed phrase **offline**. This is a testnet wallet — still, never paste
   the seed anywhere, including to Claude.
3. Add the MST Testnet network. If BridgeKey has MST built in, select it and confirm the chain ID
   matches. Otherwise add a custom network with exactly these values:

```
Network Name    : MST Testnet
RPC URL         : https://testnetrpc.mstblockchain.com
Chain ID        : 91562037
Currency Symbol : tMSTC
Block Explorer  : https://testnet.mstscan.com
```

> If any of these disagree with what the wallet pre-fills, trust this table — these were verified
> directly against the chain. In particular the explorer is `testnet.mstscan.com`, **not**
> `mstscan.com`, which indexes a different chain.

4. Our app uses the standard EIP-1193 / EIP-6963 injected-provider interface, so **MetaMask with the
   same custom network also works** if BridgeKey gives you trouble. Nothing in the code is
   BridgeKey-specific. Use BridgeKey for the demo since the track recommends it.

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

## §8 — Secrets into Vercel and GitHub  ·  *blocks: Phase 0 deploy / Phase 3 heartbeat*

Local `.env.local` does not reach production. Push the same values up.

**Vercel** (from the repo root, after `vercel link`):

```bash
vercel env add DATABASE_URL production
vercel env add GEMINI_API_KEY production
vercel env add DISCORD_WEBHOOK_URL production
vercel env add AGENT_KEY_ENC_SECRET production
vercel env add TICK_SECRET production
vercel env add DEPLOYER_PRIVATE_KEY production
vercel env add NEXT_PUBLIC_AUSPEX_MARKET_ADDRESS production   # after Phase 1
```

Each command prompts for the value — paste it at the prompt so it never lands in shell history.

**GitHub Actions** (for the cron heartbeat):

```bash
gh secret set TICK_SECRET
gh secret set TICK_URL          # https://<your-vercel-app>.vercel.app/api/tick
```

---

## §9 — Pre-demo checklist

Run through this before judging, not during.

- [ ] `pnpm preflight` all green (RPC, chain ID 91562037, DB, Gemini, contract reachable).
- [ ] Deployer and BridgeKey wallets both funded.
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
