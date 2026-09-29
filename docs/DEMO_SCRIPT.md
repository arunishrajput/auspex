# DEMO_SCRIPT.md — AuspeX

Target: **~5 minutes**. Finalised in Phase 8 — every transaction this script points at is named by
hash below, and `pnpm check:links` re-verifies all of them against the explorer on demand.

**The single idea the judges must leave with:**
> AI proposes. Humans and the chain decide.

Everything shown is in service of that sentence. Do not demo features; demo the boundary.

---

## The exact things to have open

**Pages** — all on `https://auspex-web-mu.vercel.app`

| Tab | Path | Used in |
|---|---|---|
| 1 | `/trust` | step 2, step 6 |
| 2 | `/` | step 3 |
| 3 | `/review` | step 4 |
| 4 | `/agents` | step 5 |
| 5 | `/markets/8` | step 7 |
| 6 | `/audit` | spare |

**Transactions** — all on `https://testnet.mstscan.com/tx/…`

The **sent by** column is the real sender, and `pnpm check:links` verifies it against the explorer.
Know it before you point at it — saying "a human signed this" over an operator-signed transaction is
the one mistake this demo cannot survive.

| Point at it when you say | Hash | Sent by |
|---|---|---|
| "a human created this market" | `0x2e70a1cbe7bd72b33e68afdc4742c0416b2eee3ed3ed4297bf938d2be825a504` | **`0xA9F68fDf…311fF1` human** · `createMarket` |
| "an agent placed this bet, inside its cap" | `0x5f8a12c6259de3493b79314e3e6f0284a3650e378b4b34f627cff37ea10dd5f1` | `0xa4ef956f…19588f` atlas · `placeBet` 0.005 |
| **"the chain refused it"** ⭐⭐ | `0xbfe9bb2c3ffee4be2f660473b3de916380f5d10da8548173d44810118ced060a` | `0xa4ef956f…19588f` atlas · **Reverted**, `AgentPerTxCapExceeded(20000000000000001, 20000000000000000)` |
| "resolution, with the evidence URL on chain" | `0x5c2df8b38c35d3218b5a7095bf658a6996f1deefe836c0f83be02d47121e2127` | `0xc71dC478…4ad24` **operator, not the human** — see step 7 |
| "and a challenge sent it back" | `0x1e38128c1423aca8e5501a3c6727d66e3fa211ede52d555282753ba689f43fc9` | `0xc71dC478…4ad24` operator · `challengeResolution` |
| "finalised by a wallet with no role" | `0x2f4fd42833a6aaa04819d92a2f1e3de04c4dd897145eb1b0c5b53dfaa5d407fc` | `0xa4ef956f…19588f` atlas — **holds no role at all** |
| "and the contract paid the owner" | `0x7ae9c6830335f810629b63dfef47cbfbbd7757385bbbc25779bc676b1970e0a2` | `0xa4ef956f…19588f` atlas signed; the **owner** was paid |
| spare: "a silent resolver can't lock funds up" | `0xefe33de28f5424940e6e94b123c30c052f83261f3bcb96bd8aa741ba20f3ca6b` | `0xa4ef956f…19588f` atlas — **no role**, `invalidateStale` |

**The contract:** `https://testnet.mstscan.com/address/0xc4743d6295311AFead12161881Bfcf601B70104C`
— open it on the **Contract** tab, so the green *Verified* tick is already visible in step 9.

---

## Before you start

- [ ] `pnpm preflight` — 11/11 green.
- [ ] `pnpm check:links` — green. This is the one that proves every hash above resolves *right now*.
- [ ] `pnpm --filter web verify:resolution` run once, so you can say "I checked the gates ten minutes
      ago" rather than hoping.
- [ ] Browser window 1: the app, BridgeKey unlocked, on MST Testnet, connected as
      `0xA9F68fDf…311fF1`.
- [ ] Browser window 2: MSTScan, contract page, **Contract** tab.
- [ ] Discord channel visible on a second screen.
- [ ] At least one proposal sitting in `/review`. Say so if asked: "this one was ingested a few
      minutes ago." Do not spend demo time waiting for a news cycle.
- [ ] Agent balances checked on `/agents` — judge mode spends gas. Top up with `agents:register`.

**Know which markets are which.** Markets **4–7 and 9** are the real, human-approved ones. Markets
1–3 and 8 are labelled test runs and say so **in their own on-chain question text** — if a judge opens
one, that label is the answer, and it is the honest one.

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
> crosses without passing one of those three."

Point at the role matrix.

> "That table isn't a diagram. Every cell is a live `eth_call` made when the page loaded. The human
> wallet holds every role that needs judgement — create, resolve, challenge — and **not** admin, so it
> cannot register an agent, change a cap, or pause the contract. And no key my deployed server holds
> can do any of those things either."

Point at the counters.

> "These are live queries: model outputs rejected by schema, agent decisions blocked by the policy
> gate, refusals by a human, and transactions the chain itself reverted. Two of those numbers are low,
> and the page says so in as many words — I'd rather show you a thin number than imply a path was
> tested when it wasn't."

## 3 · `/` — the live pipeline — 60s

Press **Run tick**.

> "Real headlines, right now, from independent publishers. They get clustered — deterministically
> first, with the model only adjudicating genuinely borderline pairs, because I'm on a free tier and
> because cheap deterministic work should happen before expensive uncertain work.
>
> An event only confirms when **two distinct publishers** agree. This one" — point — "has one source,
> so it's still sitting at OBSERVED. It does not proceed."

If a feed shows an error, do not skip past it:

> "GDELT is rate-limiting, as it does on most ticks. The tick still finished. That's a rule in this
> build: a failing dependency takes no action, logs why, and stays up."

## 4 · `/review` — the human gate — 60s  ⭐

> "The AI has drafted a market spec. Notice what I'm looking at: a **checklist**, not a paragraph.
> Question, resolution source, the exact field to check, deadline, outcome rules. Ambiguity is much
> easier to catch in a checklist — and catching it here matters, because no money exists yet."

Point at the untrusted-content panel.

> "The source headlines are here, visibly fenced off. They went to the model inside delimited tags, in
> a user message, never in a system instruction."

Show a **refused** proposal.

> "This one a human refused, and the reason is recorded. The signature matters: a rejection leaves no
> trace on chain, so it carries an EIP-191 signature over the exact proposal id, and the server
> verifies it. Otherwise 'I am the authority' would just be a claim from a browser, and anyone who
> could reach the endpoint could clear this queue."

Now approve one. BridgeKey pops. Sign.

> "That's a human authorising it with a wallet signature. The browser never built that calldata — my
> server encoded it from the stored spec and the wallet relayed the bytes, so a compromised page can
> change *whether* a transaction is sent but not *what* it says. Now — and only now — it goes
> on-chain."

Switch to MSTScan. Open the transaction just created, or `0x2e70a1cb…e825a504`.

> "Real transaction, MST Testnet, chain 91562037. Sent by `0xA9F6…1fF1` — and that is **not** my
> deployer address. Five markets came from that key. It exists only in a browser extension; this
> repository has never seen it."

Point at Discord as the notification lands.

> "And members subscribed to this category just got pinged — after indexing, not before."

## 5 · `/agents` — proposal vs. decision — 75s

> "Every member has their own agent. It researches the market and **proposes** a bet — a side, a
> confidence, and a stake it would like.
>
> It does not get to place that bet. The proposal goes to a policy gate: a pure deterministic
> function, no network, no model. It clamps the stake to the smallest of the per-transaction cap, the
> remaining daily budget, and the on-chain caps — and it rejects outright on a disallowed category,
> low confidence, or the kill switch."

Show an approved decision and a refused one side by side.

> "This one was refused — category not on the allowlist. This one — confidence below that member's own
> floor. `vega` has a 0.90 floor and almost never bets, which is deliberate: it's the member that
> demonstrates the gate refusing. `kestrel` has its kill switch on, so it is asked nothing at all —
> no model call, no row, nothing to go wrong."

Open `0x5f8a12c6…7ea10dd5f1` on MSTScan.

> "And there's one that passed: 0.005 tMSTC, from the agent's own wallet, inside its cap."

## 6 · The moment — the chain refuses — 45s  ⭐⭐

This is the peak. Slow down. Go back to `/trust` and scroll to **judge mode**.

> "Everything I've shown so far is my code. My code can be wrong, or compromised. So here's the layer
> that doesn't depend on me at all.
>
> This button is on the public site. It needs no wallet — anyone watching this can press it. It asks
> an agent to bet exactly one wei more than its on-chain cap."

Press it. Wait for the hash. Open it on MSTScan.

> "**Reverted.** `AgentPerTxCapExceeded` — 20,000,000,000,000,001 wei attempted against a cap of
> 20,000,000,000,000,000. The contract registered that agent wallet with hard per-transaction and
> per-market limits. So with my server fully compromised and every off-chain check bypassed, that
> agent physically cannot exceed its cap. The chain refuses it.
>
> That failed transaction is the most important one in this demo — and you can reproduce it yourself
> from the public URL. It's the first thing the README asks you to check."

If the button is cooling down, use the recorded one: `0xbfe9bb2c…18ced060a`, which was produced by
exactly that button on exactly that URL.

## 7 · Resolution and payout — 60s

Open **`/markets/8`**. Use this rather than a live run: the whole lifecycle is already on chain and
readable, and markets 4–7 and 9 do not close until 2026-09-30 22:12 UTC.

> "A market closes. A **second** AI agent reads the news published since it opened and proposes an
> outcome — but it does not choose which articles to read. That's deterministic retrieval, because a
> model that picks its own sources has already picked the answer. And it has to quote the sentence it
> is relying on, **verbatim**, which my code then searches for in the article it was shown. A
> paraphrase fails.
>
> Then a human reads that one sentence, opens the link, and signs `proposeResolution` from their own
> wallet. Not my server — there's no key in production that can resolve a market."

(On market 8 that signature came from the operator key rather than the browser wallet, for the reason
in the next paragraph. Say so before a judge reads it off the screen.)

Point at the **`signed by`** column and read it downward. **Read what is actually there** — on this
market the page will say `operator key`, and that is the honest thing to say out loud:

> "Be clear about what this particular market is. I drove it from my operator key, deliberately,
> because proving a payout needs a market with bets on *both* sides and none existed — so the market
> says it's a lifecycle test in its own on-chain question text, and this page tells you the operator
> signed it rather than claiming a human did. The human gate is what you saw in step 4, on markets 4
> to 7 and 9.
>
> What *this* market proves is the part that doesn't depend on who signed: `finalizeResolution` and
> `claim` were sent by an agent wallet holding **no role at all**, because neither call needs one. A
> privileged party cannot block a payout here."

That distinction is computed from the rows, not asserted over them — `lib/trust/signers.ts` classifies
each signer by asking the contract whether it holds `DEFAULT_ADMIN_ROLE`, so the caption cannot
flatter a table that contradicts it.

> "In between: a two-minute challenge window. You can see it fire — `finalizeResolution` reverted with
> `ChallengeWindowOpen` because I tried it early, and there's a real `challengeResolution` that sent
> the outcome back and forced a re-proposal. Two minutes is demo-scale and immutable; in production it
> would be hours. And it's *why* the human signs before the proposal rather than vetoing after —
> nobody vetoes anything in 120 seconds."

Show the payout row and open `0x7ae9c683…b1970e0a2`.

> "Winners split the pool pro rata — 0.005 in on the winning side, 0.015 out of a 0.015 pool. Paid by
> the contract, not by my server. I checked that number three ways that don't depend on each other: by
> hand, against the contract's own `previewPayout`, and against the owner's balance before and after
> the claim block. All three agree to the wei.
>
> And note **who** got paid. The agent signed the claim and received nothing but gas — the money went
> to the member's **owner** address, because the contract pays the registered owner. A stolen agent
> key can lose its capped stake; it cannot steal winnings."

If asked what happens when a resolver never turns up, open `0xefe33de2…a20f3ca6b`.

> "`invalidateStale` — also permissionless, also already on chain. Everyone gets their exact stake
> back. A silent resolver can't lock funds up any more than a hostile one can block a payout."

## 8 · Honesty — 20s  ⭐

Do not skip this. It is why the rest is believed.

> "Three things I want to be straight about.
>
> Resolution is **trusted** — a small authorised set, with an evidence URL on chain, a challenge
> window, and permissionless finalisation. That bounds a bad resolver; it is **not** a decentralised
> oracle. And right now the market creator and the resolver are the same wallet, which they shouldn't
> be — the code reads them from two separate variables so splitting them is configuration, and I
> haven't done it.
>
> Agent keys are held by my server, encrypted. The encryption is hygiene — the **on-chain caps** are
> what actually bound the risk.
>
> And the organisers' Fortuna VRF contract has no bytecode on testnet — I checked with `eth_getCode` —
> so randomised resolver selection is cut rather than faked."

## 9 · Verified source — 10s

Switch to the contract's **Contract** tab on MSTScan.

> "Verified. Ten source files, solc 0.8.28, Cancun. That's why every method name and every revert
> reason you've seen came out decoded on this explorer — you're reading the contract, not my
> description of it."

---

## If you have 30 more seconds

> "The pipeline is a state machine advanced by bounded ticks, so a crashed worker can't double-create
> a market or double-spend — the intent row is written *before* the broadcast, and the contract
> rejects a repeated spec hash as a second line of defence that doesn't depend on my code being right.
> There's a script that proves it by killing a worker mid-flight."

> "Every number on every page carries a badge saying where it came from — chain, indexer, database,
> computed. A mock badge makes the page throw in production, and CI fails if one is reachable. So
> 'nothing is mocked' isn't a promise, it's a build error."

## If something breaks live

- **Tick returns nothing:** "The free-tier model is rate-limited right now — and that's the designed
  behaviour: no action, logged, keep running." Then use a pre-confirmed event. This is a *feature*
  demonstration, not a save.
- **Wallet won't connect:** use judge mode — a real on-chain transaction, no wallet required.
- **Judge mode is cooling down:** use the recorded hash `0xbfe9bb2c…18ced060a`. It came from that
  button, on that URL.
- **A page errors:** go straight to MSTScan. The chain data is the product; the UI is the window.
- **Neon is cold:** the first request can take 10–25 s. Slow is not broken — load a page before you
  start talking.

## Questions to expect

| Question | Answer |
|---|---|
| "What stops prompt injection?" | Nothing stops it entirely. It's bounded: delimited untrusted input in a user message, schema-constrained output, an injection scan on the *output* too, then a human reading a checklist, then contract limits. Worst case is a bad *proposal*. |
| "Why not a decentralised oracle?" | Time. I chose a mechanism I could implement correctly and explain honestly over one I could only gesture at. It's labelled trusted everywhere it appears. |
| "Why is MST integral rather than bolted on?" | The contract is the authority layer — roles, caps, resolution, challenge window, payout. Take MST out and the core claim disappears. |
| "Isn't the AI just cosmetic?" | The opposite — it does the real work of reading and drafting, three separate agents' worth. It just never holds authority. That separation *is* the product. |
| "Could you rug the agent wallets?" | I could lose each agent's capped stake. I couldn't take winnings — `claim()` pays the registered owner, not the agent. |
| "How do I know these transactions are real?" | Press judge mode yourself and watch a new one appear. Or run `pnpm check:links`, which re-fetches every hash in the README from the explorer's API in front of you. |
| "Why are some markets from the deployer?" | Markets 1–3 and 8 are test runs, and each says so in its own on-chain question text. The real ones — 4 to 7, and 9 — came from the human wallet. That's checkable on the explorer without trusting me. |
| "What's the weakest part?" | The resolver is one wallet that is also the market creator, and the challenge window is two minutes. Both are in the README's Limitations, and the second one forced the design of the first. |
