# DEMO_SCRIPT.md — AuspeX

Target: **~5 minutes**. Finalised in Phase 8 with the actual transaction hashes filled in.

**The single idea the judges must leave with:**
> AI proposes. Humans and the chain decide.

Everything shown is in service of that sentence. Do not demo features; demo the boundary.

---

## Before you start

- [ ] `pnpm preflight` green.
- [ ] Browser window 1: the app, logged in, BridgeKey unlocked, on MST Testnet.
- [ ] Browser window 2: `testnet.mstscan.com` open on the contract page.
- [ ] Window/second screen: the Discord channel.
- [ ] One **confirmed event already sitting in `/review`** — do not spend demo time waiting for a
      news cycle. Say so if asked: "this one was ingested a few minutes ago."
- [ ] One market already **closed and ready to resolve**, so step 7 does not wait out a window.
- [ ] Tabs pre-opened for the over-cap revert tx and the payout tx.

---

## 1 · Problem — 20s

> "Prediction markets live or die on two things: whether the question is well-formed, and whether the
> answer can be trusted. AI is genuinely good at reading the news and drafting precise questions. But
> nobody should hand an AI the power to create markets and spend money — one poisoned headline and
> you have a bad market or a drained wallet.
>
> So AuspeX puts AI everywhere it's useful and nowhere it has authority."

## 2 · `/trust` — the boundary first — 30s

Open `/trust` **before** anything else, so everything after is read through it.

> "This is the whole design on one page. On the left, the untrusted zone — news, and the models. On
> the right, the authority zone — deterministic code, a human, and the smart contract. Nothing
> crosses without passing one of those three.
>
> These counters are live queries: model outputs rejected by schema, agent decisions blocked by the
> policy gate, and transactions the chain itself reverted. If those were all zero, I'd have proven
> nothing."

## 3 · `/` — the live pipeline — 60s

Press **Run tick**.

> "Real headlines, right now, from independent publishers. They get clustered — deterministically
> first, with the model only adjudicating genuinely borderline pairs, because I'm on a free tier and
> because cheap deterministic work should happen before expensive uncertain work.
>
> An event only confirms when **two distinct publishers** agree. This one" — point — "has one source,
> so it's still sitting at OBSERVED. It does not proceed."

Let the second source land on an event if timing allows; otherwise point at one already confirmed.

## 4 · `/review` — the human gate — 60s  ⭐

> "The AI has drafted a market spec. Notice what I'm looking at: a **checklist**, not a paragraph.
> Question, resolution source, the exact field to check, deadline, outcome rules. Ambiguity is much
> easier to catch in a checklist — and catching it here matters, because no money exists yet."

Point at the untrusted-content panel.

> "The source headlines are here, visibly fenced off. They went to the model inside delimited tags,
> never in a system instruction."

Show a **rejected** proposal first.

> "This one was rejected — here's the reason, logged. Rejections are the evidence that the gate is
> real."

Now approve one. BridgeKey pops. Sign.

> "That's a human authorising it with a wallet signature. Now — and only now — it goes on-chain."

Switch to MSTScan. Open the `createMarket` tx.

> "Real transaction, MST Testnet, chain 91562037."

Point at Discord as the notification lands.

> "And members subscribed to this category just got pinged."

## 5 · `/agents` — proposal vs. decision — 75s

> "Every member has their own agent. It researches the market and **proposes** a bet — a side, a
> confidence, and a stake it would like.
>
> It does not get to place that bet. This proposal goes to a policy gate: a pure deterministic
> function, no network, no model. It clamps the stake to the smallest of the per-transaction cap, the
> remaining daily budget, and the on-chain caps — and it rejects outright on a disallowed category,
> low confidence, or the kill switch."

Show an approved decision and a **rejected** one side by side.

> "This agent asked for more than its budget allowed. The gate clamped it. This one was rejected
> entirely — category not allowlisted. Both are logged with reasons."

Open the real `placeBet` tx on MSTScan.

## 6 · The moment — the chain refuses — 45s  ⭐⭐

This is the peak. Slow down.

> "Everything I've shown so far is my code. My code can be wrong, or compromised. So here's the layer
> that doesn't depend on me.
>
> I'm going to deliberately bypass my own policy gate and have an agent try to bet far over its cap."

Trigger it. Open the reverted tx on MSTScan.

> "**Reverted.** `AgentPerTxCapExceeded` — attempted, versus the cap. The contract registered that
> agent wallet with hard per-transaction and per-market limits, so even with my server fully
> compromised and every off-chain check bypassed, that agent physically cannot exceed its cap. The
> chain refuses it.
>
> That failed transaction is the most important one in this demo."

## 7 · Resolution and payout — 45s

> "The market closes. An authorised resolver submits the outcome **with an evidence URL**, stored
> on-chain. Then a challenge window — I've set it to two minutes so it fits in a demo; in production
> it would be hours. A challenger can send it back for re-proposal, and that challenge is recorded
> on-chain with its reason.
>
> After the window, **anyone** can finalize. That's deliberate — not even I can block a payout by
> going quiet."

Show the payout tx.

> "Winners split the pool pro rata. Paid by the contract, not by my server. And note the agent's
> winnings went to the member's **owner** address, not to the agent wallet — so a stolen agent key
> can lose its capped stake but can't steal winnings."

## 8 · Honesty — 20s  ⭐

Do not skip this. It is why the rest is believed.

> "Three things I want to be straight about.
>
> Resolution is **trusted** — a small authorised set, with an evidence URL, a challenge window and
> permissionless finalisation. That bounds a bad resolver; it is **not** a decentralised oracle.
>
> Agent keys are held by my server, encrypted. The encryption is hygiene — the **on-chain caps** are
> what actually bound the risk.
>
> And the organisers' Fortuna VRF contract has no bytecode on testnet — I checked with `eth_getCode`
> — so randomised resolver selection is cut rather than faked."

## 9 · Verified source — 10s

> "The contract is verified on MSTScan. Every claim I've made is in readable source, and every
> transaction is real."

---

## If you have 30 more seconds

> "The pipeline is a state machine advanced by bounded ticks, so a crashed worker can't double-create
> a market or double-spend — and the contract rejects a repeated spec hash as a second line of defence
> that doesn't depend on my code being right."

## If something breaks live

- **Tick returns nothing:** "The free-tier model is rate-limited right now — and that's the designed
  behaviour: no action, logged, keep running." Then use a pre-confirmed event. This is a *feature*
  demonstration, not a save.
- **Wallet won't connect:** use judge mode — a real on-chain transaction with no wallet required.
- **A page errors:** go straight to MSTScan. The chain data is the product; the UI is the window.

## Questions to expect

| Question | Answer |
|---|---|
| "What stops prompt injection?" | Nothing stops it entirely. It's bounded: delimited untrusted input, schema-constrained output, then a human reading a checklist, then contract limits. Worst case is a bad *proposal*. |
| "Why not a decentralised oracle?" | 72 hours. I chose a mechanism I could implement correctly and explain honestly over one I could only gesture at. It's labelled trusted everywhere. |
| "Why is MST integral rather than bolted on?" | The contract is the authority layer — roles, caps, resolution, payout. Take MST out and the core claim disappears. |
| "Isn't the AI just cosmetic?" | The opposite — it does the real work of reading and drafting. It just never holds authority. That separation is the product. |
| "Could you rug the agent wallets?" | I could lose each agent's capped stake. I couldn't take winnings — `claim()` pays the registered owner, not the agent. |
