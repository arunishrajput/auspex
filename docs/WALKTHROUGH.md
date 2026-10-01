# WALKTHROUGH.md — AuspeX, page by page, with the transactions

A tour of the running system for a reader with nobody to explain it. It follows the same path a
sceptic would take: the boundary first, then the pipeline, then the two places a human or the chain
says no.

Everything here is checkable. `pnpm check:links docs/WALKTHROUGH.md` re-fetches every hash below from
the explorer's API and fails if any one of them, or any sender attributed to it, is not what this page
says it is.

**The one idea to leave with:**
> AI proposes. Humans and the chain decide.

Prefer to watch first? **[The 3:47 demo video](https://www.youtube.com/watch?v=Jp08xTuiHVI)** covers
the same path, built from real captures of these pages.

Live at **https://auspex-web-mu.vercel.app**. Contract:
**`0xc4743d6295311AFead12161881Bfcf601B70104C`** on MST Testnet, chain `91562037`, verified source on
[MSTScan](https://testnet.mstscan.com/address/0xc4743d6295311AFead12161881Bfcf601B70104C).

---

## The transactions, and who actually sent them

The **sent by** column is the real sender. It matters more than it looks: saying "a human signed this"
over an operator-signed transaction is the one error that would undo every other claim on this page,
so `check:links` verifies each attribution against the explorer rather than trusting the table.

| What it shows | Hash | Sent by |
|---|---|---|
| a human created this market | `0x2e70a1cbe7bd72b33e68afdc4742c0416b2eee3ed3ed4297bf938d2be825a504` | **`0xA9F68fDf…311fF1` human** · `createMarket` |
| an agent placed a bet, inside its cap | `0x5f8a12c6259de3493b79314e3e6f0284a3650e378b4b34f627cff37ea10dd5f1` | `0xa4ef956f…19588f` atlas · `placeBet` 0.005 |
| **the chain refused an over-cap bet** ⭐ | `0xbfe9bb2c3ffee4be2f660473b3de916380f5d10da8548173d44810118ced060a` | `0xa4ef956f…19588f` atlas · **Reverted**, `AgentPerTxCapExceeded(20000000000000001, 20000000000000000)` |
| resolution, with the evidence URL on chain | `0x5c2df8b38c35d3218b5a7095bf658a6996f1deefe836c0f83be02d47121e2127` | `0xc71dC478…4ad24` **operator, not the human** — see step 6 |
| a challenge sent the outcome back | `0x1e38128c1423aca8e5501a3c6727d66e3fa211ede52d555282753ba689f43fc9` | `0xc71dC478…4ad24` operator · `challengeResolution` |
| finalised by a wallet holding no role | `0x2f4fd42833a6aaa04819d92a2f1e3de04c4dd897145eb1b0c5b53dfaa5d407fc` | `0xa4ef956f…19588f` atlas — **holds no role at all** |
| the contract paid the owner, not the signer | `0x7ae9c6830335f810629b63dfef47cbfbbd7757385bbbc25779bc676b1970e0a2` | `0xa4ef956f…19588f` atlas signed; the **owner** was paid |
| a silent resolver cannot lock funds up | `0xefe33de28f5424940e6e94b123c30c052f83261f3bcb96bd8aa741ba20f3ca6b` | `0xa4ef956f…19588f` atlas — **no role**, `invalidateStale` |

---

## 1 · The problem

Prediction markets live or die on two things: whether the question is well-formed, and whether the
answer can be trusted. AI is genuinely good at reading the news and drafting precise questions. But
nobody should hand an AI the power to create markets and spend money — one poisoned headline and you
have a bad market or a drained wallet.

So AuspeX puts AI everywhere it is useful and nowhere it has authority.

## 2 · `/trust` — read this page first

[`/trust`](https://auspex-web-mu.vercel.app/trust) is the whole design on one page, and everything
else makes more sense after it. The untrusted zone is news and the models; the authority zone is
deterministic code, a human, and the smart contract. Nothing crosses without passing one of those
three.

**The role matrix is not a diagram.** Every cell is a live `eth_call` made when the page loaded. The
human wallet holds every role that needs judgement — create, resolve, challenge — and **not**
`DEFAULT_ADMIN_ROLE`, so it cannot register an agent, change a cap, or pause the contract. No key the
deployed application holds can do any of those things either.

**The counters are live queries.** Model outputs rejected by schema, agent decisions blocked by the
policy gate, refusals by a human, and transactions the chain itself reverted. Two of those numbers are
thin, and the page says so in as many words rather than letting you assume the path was exercised.

## 3 · `/` — the live pipeline

[`/`](https://auspex-web-mu.vercel.app/) shows real headlines from independent publishers. **Run
tick** advances the pipeline while you watch.

Articles are clustered deterministically first, with the model adjudicating only genuinely borderline
pairs — cheap deterministic work before expensive uncertain work. An event confirms only when **two
distinct publisher domains** agree; one with a single source sits at `OBSERVED` and does not proceed.

If a feed shows an error, that is the design rather than a blemish. GDELT rate-limits on most ticks.
The tick finishes anyway: a failing dependency takes no action, logs why, and stays up.

## 4 · `/review` — the human gate

[`/review`](https://auspex-web-mu.vercel.app/review) is where a person decides. What they are shown is
a **checklist**, not a paragraph: question, resolution source, the exact field to check, deadline,
outcome rules. Ambiguity is much easier to catch in a checklist, and catching it here matters because
no money exists yet.

The source headlines sit in a visibly fenced panel. They reached the model inside delimited tags in a
user-role message, never in a system instruction.

**A refusal is recorded with its reason.** A rejection leaves no trace on chain, so it carries an
EIP-191 signature over the exact proposal id and the server verifies it — otherwise "I am the
authority" would be a claim from a browser, and anyone who could reach the endpoint could clear the
queue.

An approval pops the wallet. The browser never built that calldata: the server encoded it from the
stored spec and the wallet relayed the bytes, so a compromised page can change *whether* a transaction
is sent but not *what* it says. Then, and only then, it goes on chain —
[`0x2e70a1cb…e825a504`](https://testnet.mstscan.com/tx/0x2e70a1cbe7bd72b33e68afdc4742c0416b2eee3ed3ed4297bf938d2be825a504)
is one of them. Sent by `0xA9F68fDf…311fF1`, which is **not** the deployer address. Nine markets came
from that key. It exists only inside a browser extension; this repository has never held it.

Members subscribed to the category are notified once the creation is indexed, not before.

## 5 · `/agents` — what was proposed, and what was allowed

[`/agents`](https://auspex-web-mu.vercel.app/agents) shows both numbers side by side. Every member has
their own agent; it researches a market and **proposes** a bet — a side, a confidence, and a stake it
would like.

It does not get to place that bet. The proposal goes to a policy gate: a pure deterministic function
with no network and no model. It clamps the stake to the smallest of the per-transaction cap, the
remaining daily budget and the on-chain caps, and it rejects outright on a disallowed category, a
confidence below the member's own floor, or the kill switch.

The refusals on that page are the interesting rows. `vega` has a 0.90 confidence floor and almost
never bets, which is deliberate — it is the member that demonstrates the gate refusing. `kestrel` has
its kill switch on, so it is asked nothing at all: no model call, no row, nothing to go wrong.

One that passed:
[`0x5f8a12c6…7ea10dd5f1`](https://testnet.mstscan.com/tx/0x5f8a12c6259de3493b79314e3e6f0284a3650e378b4b34f627cff37ea10dd5f1)
— 0.005 tMSTC from the agent's own wallet, inside its cap.

## 6 · The cap probe — make the chain refuse something yourself ⭐

Everything above is application code, and application code can be wrong or compromised. The **cap
probe** on [`/trust`](https://auspex-web-mu.vercel.app/trust) is the layer that does not depend on it.

The button needs no wallet and no tMSTC. It reads a registered agent's on-chain per-transaction cap
from the contract, adds exactly one wei, and sends the bet with the policy gate deliberately not
consulted — which is what a compromised server would do. You get a real transaction hash.

**It reverts.** `AgentPerTxCapExceeded(20000000000000001, 20000000000000000)`: 20,000,000,000,000,001
wei attempted against a cap of 20,000,000,000,000,000. The contract registered that agent wallet with
hard per-transaction and per-market limits, so with the server fully compromised and every off-chain
check bypassed, that agent still cannot exceed its cap.

That failed transaction is the most important one here, and it is reproducible from the public URL. If
the button is cooling down,
[`0xbfe9bb2c…18ced060a`](https://testnet.mstscan.com/tx/0xbfe9bb2c3ffee4be2f660473b3de916380f5d10da8548173d44810118ced060a)
was produced by exactly that button on exactly that URL.

An `eth_call` runs first and nothing is broadcast unless the chain confirms it will revert, so a probe
that could succeed does not run. A reverted `placeBet` returns its value; the cost of a click is gas.

## 7 · `/markets/8` — resolution and payout, end to end

[`/markets/8`](https://auspex-web-mu.vercel.app/markets/8) is the market to read, because its whole
lifecycle is already on chain.

A market closes. A **second** AI agent reads the news published since it opened and proposes an
outcome — but it does not choose which articles to read. Retrieval is deterministic and is part of the
gate, because a model that picks its own sources has already picked the answer. It must also quote the
sentence it relies on **verbatim**, and the code then searches for that exact string in the article
text the model was shown. A paraphrase fails.

Then a human reads that one sentence, opens the link, and signs `proposeResolution` from their own
wallet. No key in production can resolve a market.

**On market 8, that signature came from the operator key rather than a browser wallet, and the page
says so.** Read the `signed by` column: it will say `operator key`. This market was driven from a
laptop deliberately, because proving a payout needs a market with bets on *both* sides and none
existed. The market says it is a lifecycle test in its own on-chain question text, and the page tells
you who signed rather than claiming a human did. The human gate is what step 4 shows, on the nine
markets created by `0xA9F68fDf…311fF1`.

What market 8 proves is the part that does not depend on who signed: `finalizeResolution` and `claim`
were sent by an agent wallet holding **no role at all**, because neither call needs one. A privileged
party cannot block a payout here.

That distinction is computed from the rows rather than asserted over them — `lib/trust/signers.ts`
classifies each signer by asking the contract whether it holds `DEFAULT_ADMIN_ROLE`, so the caption
cannot flatter a table that contradicts it.

**The challenge window is two minutes, and you can see it fire.** `finalizeResolution` reverted with
`ChallengeWindowOpen` because it was tried early, and a real `challengeResolution` sent the outcome
back and forced a re-proposal. Two minutes is small and immutable; in production it would be hours.
It is also *why* the human signs before the proposal rather than vetoing after — nobody vetoes
anything in 120 seconds.

**The payout:**
[`0x7ae9c683…b1970e0a2`](https://testnet.mstscan.com/tx/0x7ae9c6830335f810629b63dfef47cbfbbd7757385bbbc25779bc676b1970e0a2).
Winners split the pool pro rata — 0.005 in on the winning side, 0.015 out of a 0.015 pool, paid by the
contract rather than by any server. That number was checked three independent ways: by hand, against
the contract's own `previewPayout`, and against the owner's balance before and after the claim block.
All three agree to the wei.

Note **who** got paid. The agent signed the claim and received nothing but gas; the money went to the
member's **owner** address, because `claim()` pays the registered owner. A stolen agent key can lose
its capped stake; it cannot steal winnings.

If a resolver never turns up:
[`0xefe33de2…a20f3ca6b`](https://testnet.mstscan.com/tx/0xefe33de28f5424940e6e94b123c30c052f83261f3bcb96bd8aa741ba20f3ca6b)
— `invalidateStale`, also permissionless, also already on chain. Everyone gets their exact stake back.
A silent resolver cannot lock funds up any more than a hostile one can block a payout.

## 8 · Which markets are which

Thirteen markets exist on the contract. Nine of them —
[`/markets`](https://auspex-web-mu.vercel.app/markets) names them, computed from the creating address
in each indexed log — were drafted by an AI agent from two-source-confirmed news, read as a checklist
by a person, and created because that person signed for it.

The other four were created while commissioning the contract, from the operator key rather than
through the human gate. **Two of them say so inside their own immutable on-chain question text**
(`[Phase 2 idempotency test …]` and `[Phase 6 lifecycle test …] Not a product market.`). **Two do
not**: markets 1 and 2 ask whether AuspeX itself would have a verified contract, which is plainly not
a product question but never labels itself a test. That is the weaker case and it is named rather than
smoothed over.

You can tell the two kinds apart without trusting any of this: check the `from` address of each
creating transaction on MSTScan. None of the four is presented anywhere as a product market.

## 9 · What is honestly weak

Three things worth being straight about, all of them at more length in the README's Limitations
section and in [`TRUST_MODEL.md`](./TRUST_MODEL.md):

**Resolution is trusted.** A small authorised set submits outcomes with an evidence URL on chain,
behind a challenge window, with permissionless finalisation. That bounds a bad resolver; it is **not**
a decentralised oracle. And the market creator and the resolver are currently the same wallet, which
they should not be — the code reads them from two separate variables, so splitting them is
configuration plus two `grantRole` calls, and it has not been done.

**Agent keys are held by the server**, encrypted at rest. The encryption is hygiene; the **on-chain
caps** are what actually bound the risk.

**Fortuna VRF is not used.** `eth_getCode` against
`0x01C6C7EBac32eD9be3Cd8Ad84B38128124AAd380` on chain `91562037` returns `0x` — it is a mainnet
contract, unreachable from testnet. Randomised resolver selection was cut rather than faked.

## 10 · Verified source

Open the contract's **Contract** tab on
[MSTScan](https://testnet.mstscan.com/address/0xc4743d6295311AFead12161881Bfcf601B70104C). Verified:
ten source files, solc 0.8.28, evm `cancun`. That is why every method name and every revert reason
above appears decoded on the explorer — you are reading the contract, not a description of it.

---

## Two things worth knowing that do not fit the tour

**Idempotency is a design constraint.** The pipeline is a state machine advanced by bounded ticks, so
a crashed worker cannot double-create a market or double-spend. The intent row is written *before* the
broadcast, and the contract rejects a repeated spec hash as a second line of defence that does not
depend on the application being right. `pnpm --filter web crash-test` proves it by killing a worker
mid-flight; the result is one market, not two.

**Every number on every page says where it came from** — `CHAIN`, `INDEXED`, `DB`, `COMPUTED`,
`EXTERNAL`. A `MOCK` badge makes the page throw in a production build, and CI fails if one is
reachable. "Nothing is mocked" is not a promise here; it is a build error.

---

## Questions this usually raises

| Question | Answer |
|---|---|
| What stops prompt injection? | Nothing stops it entirely. It is bounded: delimited untrusted input in a user message, schema-constrained output, an injection scan on the *output* too, then a human reading a checklist, then contract limits. The worst case is a bad *proposal*. |
| Why not a decentralised oracle? | A mechanism that could be implemented correctly and described honestly was preferred over one that could only be gestured at. It is labelled trusted everywhere it appears. |
| Why is MST integral rather than bolted on? | The contract is the authority layer — roles, caps, resolution, challenge window, payout. Remove it and the central claim disappears. |
| Isn't the AI cosmetic? | The opposite: it does the reading and drafting, across three separate agents. It just never holds authority. That separation *is* the product. |
| Could the agent wallets be rugged? | A full compromise loses each agent's capped stake. It cannot take winnings — `claim()` pays the registered owner, not the agent. |
| How do I know these transactions are real? | Press the cap probe and watch a new one appear. Or run `pnpm check:links`, which re-fetches every hash in the README from the explorer's API. |
| Why are some markets from the deployer? | Four markets were created while commissioning the contract. Two label themselves tests in their own on-chain text; two do not, and `/markets` says which. All four are identifiable by their creating address on the explorer. |
| What is the weakest part? | The resolver is one wallet that is also the market creator, and the challenge window is two minutes. Both are in Limitations, and the second forced the design of the first. |
