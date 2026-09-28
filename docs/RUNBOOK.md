# RUNBOOK.md — manual setup steps

Everything Claude Code cannot do for you, in the order it is needed. Each step says **when it
blocks** so you can defer the ones you do not need yet.

**Rule that never bends:** secrets go into `.env.local` (git-ignored) and into the Vercel / GitHub
secret stores. Never into a file that is committed, never into a chat message, never into a log.

```bash
cp .env.example .env.local     # then fill it in as you work through this file
```

---

## §1 — Vercel login  ·  *blocks: Phase 0 deploy*

The CLI is installed (v58.5.1) but the stored token is invalid.

```bash
vercel login
```

Pick your email or GitHub, confirm in the browser. Then verify:

```bash
vercel whoami        # should print your username, not an error
```

Do **not** run `vercel link` yet — Phase 0 does that after the GitHub repo exists.

---

## §2 — Neon Postgres  ·  *blocks: Phase 2*

1. Go to **https://neon.tech** → sign up (GitHub login is fastest). Free tier, no card.
2. **Create project** → name `auspex` → pick the region closest to you → Postgres 17.
3. On the project dashboard, open **Connection string** and select the **Pooled connection**
   (it will contain `-pooler` in the host). Serverless functions open many short-lived connections,
   so the pooled string is the right one.
4. Copy it into `.env.local`:

```
DATABASE_URL=postgresql://USER:PASSWORD@ep-xxxx-pooler.REGION.aws.neon.tech/auspex?sslmode=require
```

> If you later see `too many connections`, you used the direct (non-pooled) string.

---

## §3 — Gemini API key  ·  *blocks: Phase 3*

1. Go to **https://aistudio.google.com/apikey** and sign in with a Google account.
2. **Create API key** → pick or create a project → copy the key.
3. Put it in `.env.local`:

```
GEMINI_API_KEY=AIza...
```

4. Confirm the free tier actually works:

```bash
pnpm preflight
```

It makes one real call and reports the model and latency. If you get a 429 immediately, the free
tier is exhausted for the day — the pipeline is built to survive that (it logs and takes no action),
but you want a working key before the demo.

**Models in use** (already set in `.env.example`):
`gemini-3.5-flash-lite` for high-volume work, `gemini-3.8-flash` for judgement calls. The 2.5 series
is superseded — do not switch back to it.

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

## §6 — Wallets and faucet funding  ·  *blocks: Phase 1 deploy*

You need a **deployer** wallet (holds admin + creator + resolver roles) and, later, **agent** wallets.

```bash
pnpm wallets:new
```

This prints an address and writes nothing to disk. Copy the private key into `.env.local`:

```
DEPLOYER_PRIVATE_KEY=0x...
```

Then fund it:

1. Go to **https://faucet.masterstroke.academy**
2. Paste the **deployer address** (not the private key) → request tMSTC.
3. Also fund your **BridgeKey address** — the human authority signs `createMarket` from it.
4. Confirm the balance landed:

```bash
pnpm preflight
```

> The faucet distributes a fixed amount per request and rate-limits. Claim early; if you run dry
> mid-build, claim again and wait. Gas is essentially free here (base fee is 0), so a single faucet
> claim goes a very long way.

Also generate the agent-key encryption secret:

```bash
openssl rand -hex 32      # -> AGENT_KEY_ENC_SECRET in .env.local
openssl rand -hex 24      # -> TICK_SECRET in .env.local
```

---

## §7 — GitHub repo  ·  *Phase 0, mostly automated*

Claude Code creates and pushes the repo with `gh` (already authenticated as `arunishrajput` with
`repo` and `workflow` scopes). It must be **public** — the track requires a public repository, and
GitHub Actions minutes are free on public repos, which is what runs our cron heartbeat.

You only intervene if `gh` prompts for confirmation.

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
