# AuspeX

**Prediction markets created under human authority, researched by AI agents that the chain keeps on a leash.**

> **AI proposes. Humans and the chain decide.**
> Nothing moves money or reaches a member without passing a human gate and an on-chain limit.

AuspeX is a prediction-market platform for people who want AI to do the reading without giving it the
authority. Three separate agents draft market questions from confirmed news, research each market and
propose an outcome — and not one of them can create a market, place a bet over its limit, or resolve
anything. A person signs for every market. The contract caps every agent. Both of those are facts you
can check on a public explorer rather than claims you have to accept, and the rest of this file is
about how to check them.

It is built for someone who would otherwise have to choose between "let the model decide" and "do it
all by hand". It is running on a testnet, it is not audited, and the
[Limitations](#limitations--stated-plainly) section is written to be read.

| | |
|---|---|
| **Live** | **https://auspex-web-mu.vercel.app** |
| **Contract** (verified) | [`0xc4743d6295311AFead12161881Bfcf601B70104C`](https://testnet.mstscan.com/address/0xc4743d6295311AFead12161881Bfcf601B70104C) |
| **Network** | MST Testnet · chain `91562037` |
| **The transaction that matters** | [`0xbfe9bb2c…ced060a`](https://testnet.mstscan.com/tx/0xbfe9bb2c3ffee4be2f660473b3de916380f5d10da8548173d44810118ced060a) — **Reverted**, on purpose |

Every address, hash and balance in this repository is real and resolvable on
`testnet.mstscan.com`. Nothing here is fabricated, and nothing is mocked — the app fails its own
build if mock data reaches production.

---

## Check it yourself in 60 seconds

No wallet, no signup, and no trust in anything written here required.

1. Open **[/trust](https://auspex-web-mu.vercel.app/trust)**. Every claim on that page is a live
   `eth_call` against the deployed contract, not a stored copy. The role matrix is read from the
   chain on each load.
2. Scroll to the **cap probe** and press the button. It sends a **real transaction** from a real
   agent wallet, asking to bet one wei more than that agent's on-chain cap. You get a link to it on
   MSTScan. **It reverts** — `AgentPerTxCapExceeded(20000000000000001, 20000000000000000)`.
3. That is the whole thesis in one click: this application's code is not what stops the agent. The
   contract is.

The button costs about 0.0001 tMSTC in gas and stakes nothing, because the transaction never
succeeds. It is rate-limited, and it refuses to broadcast unless an `eth_call` first confirms the
chain will reject it.

---

## The problem

Prediction markets live or die on two things: whether the question is well-formed, and whether the
answer can be trusted.

1. **Market creation is a quality bottleneck.** "Will the economy improve?" is unresolvable and
   guarantees a dispute. Writing good markets fast means reading a lot of news and being pedantic
   about wording.
2. **Research does not scale.** Betting well means reading sources and sizing a position. Most
   people do neither, so they bet on vibes.

AI is genuinely good at both jobs. But an AI with the authority to *create markets* and *spend money*
is one poisoned headline away from a bad market or a drained wallet.

**So the real problem is not "can AI do this" but "how do you let AI do this without giving it
authority".**

## The solution

AuspeX puts AI everywhere it is useful and nowhere it is authoritative.

```
news (untrusted)
   └─> dedup + require 2 INDEPENDENT publishers      [deterministic]
        └─> proposer agent drafts a market spec      [LLM — proposes only]
             └─> strict schema validation            [deterministic — rejects malformed]
                  └─> HUMAN reviews a checklist      [human authority, browser signature]
                       └─> createMarket()            [contract — role-gated, replay-guarded]
                            └─> member agent researches and proposes a bet   [LLM]
                                 └─> policy gate clamps/rejects the stake    [deterministic]
                                      └─> placeBet()                         [contract — hard caps]
                                           └─> resolution agent drafts an outcome  [LLM]
                                                └─> retrieval + verbatim-quote check  [deterministic]
                                                     └─> HUMAN signs it       [human authority]
                                                          └─> challenge window → finalize → claim
```

Three kinds of agent, deliberately separate, none of them trusted:

| | **Market proposer** | **Member agent** | **Resolution agent** |
|---|---|---|---|
| Scope | System-level, one | Per user, many | System-level, one |
| Proposes | A market specification | A bet (side, size, confidence) | An outcome + evidence |
| Bounded by | Schema validation + **human approval** | **Policy gate** + **on-chain caps** | Deterministic retrieval, a verbatim-quote check, + **human signature** |
| Reaches the chain | Only via a human's signature | Only via its own capped wallet | Only via a human's signature |

**The resolution agent does not choose what it reads.** Retrieval is deterministic and is part of the
gate: a model that picks its own sources has already picked the answer. It must also quote the
sentence it relies on **verbatim**, and the code then searches for that exact string in the article
text the model was shown. A paraphrase fails.

## Four layers that can say no

Each layer refuses a different class of thing, and each one keeps a reason. `/trust` counts them from
the live database.

| Layer | What it catches | Determined by |
|---|---|---|
| **Schema** | malformed or out-of-enum model output, a resolution source we never issued | Zod, behind an API-side schema |
| **Policy gate** | disallowed category, confidence below the member's floor, stake over budget, kill switch | a pure function — no network, no model |
| **A human** | a question that is ambiguous, unresolvable, or inconsistent with its own source | a person, with a wallet signature |
| **The chain** | over-cap bets, late bets, double claims, premature finalisation, a stale deadline | the contract, regardless of what the application believed |

Refused decisions are the evidence, so they are kept, shown and never deleted.
**[/trust](https://auspex-web-mu.vercel.app/trust) counts all four layers live.** No tally is written
down here, because the system is still running and any number in a README is stale by the time it is
read. Two of those counters are thin — the schema layer has never fired, and the human layer has many
more approvals than refusals — and the page says so in as many words rather than letting you assume
the path was tested. Both are in [Limitations](#limitations--stated-plainly).

---

## How MST is integral, not bolted on

**The contract is the authority layer.** Roles, spending limits, resolution, the challenge window and
payout are all enforced on-chain. Remove MST and the central claim disappears — there is nothing left
that makes the AI safe to run.

- `createMarket` is restricted to `MARKET_CREATOR_ROLE`, held by a **browser wallet whose key no
  server here has ever seen**. Nine of the thirteen markets on chain were created by that key;
  [`/markets`](https://auspex-web-mu.vercel.app/markets) names which, computed from the creating
  address in each indexed log rather than written down.
- Agent wallets are registered on-chain with **per-transaction and per-market caps**. The contract
  reverts an over-cap bet even if the server is fully compromised. Several such reverts are on
  chain, every one of them deliberate.
- Agent wallets hold **no role at all** — they cannot create markets or resolve them, and `claim()`
  pays the registered **owner**, so a stolen agent key cannot steal winnings.
- Resolution stores an **evidence URL on-chain**, behind a challenge window, with **permissionless
  finalisation** and **permissionless `invalidateStale`** — so no privileged party can block a
  payout, and a resolver who never appears cannot lock funds up either. Both paths are on chain.
- Payouts are computed and executed by contract logic in native **tMSTC**, not by any server here.
  The UI never computes a payout; it displays `previewPayout()`.
- Because gas on this chain is effectively free (`baseFeePerGas = 0`), the contract deliberately
  **stores readable strings on-chain** — the question, the resolution source, the evidence URL. A
  reader being able to understand a market on the explorer is worth more here than gas savings.

BridgeKey is used for what it is for: wallet connection, network switching and contract signing
(market approval, resolution, claims). The app targets the standard **EIP-1193 / EIP-6963** injected
provider through a wagmi `injected()` connector, so there is no vendor-specific code.

### Where authority lives, and what cannot reach it

| Role | Human wallet (BridgeKey) | Deployer | Agent wallets | Deployed app |
|---|---|---|---|---|
| `DEFAULT_ADMIN_ROLE` | ❌ | ✅ | ❌ | ❌ |
| `MARKET_CREATOR_ROLE` | ✅ | ✅ | ❌ | ❌ |
| `RESOLVER_ROLE` | ✅ | ✅ | ❌ | ❌ |
| `CHALLENGER_ROLE` | ✅ | ✅ | ❌ | ❌ |

The human wallet holds **every role that requires human judgement and none that confers power**: it
can create a market, propose an outcome and challenge one; it cannot register an agent, change a cap
or pause the contract, because it does not hold `DEFAULT_ADMIN_ROLE`.

**No key the deployed application holds can create a market, resolve one, challenge one, register an
agent, change a cap or pause the contract.** Production holds agent keys only — capped by the
contract, holding no role. `DEPLOYER_PRIVATE_KEY` is deliberately not in Vercel, which is why agent
registration is a local command rather than a pipeline stage.

Every row of that table is verified by live `eth_call` on
[/trust](https://auspex-web-mu.vercel.app/trust), and again by
`pnpm --filter web verify:agents` (41 checks) and `verify:resolution`. Neither writes anything.

---

## Deployment

| | |
|---|---|
| **Network** | MST Testnet |
| **Chain ID** | `91562037` (`0x5752035`) |
| **RPC** | `https://testnetrpc.mstblockchain.com` |
| **Currency** | tMSTC (18 decimals) |
| **Explorer** | https://testnet.mstscan.com |
| **Faucet** | https://faucet.masterstroke.academy |
| **`AuspexMarket`** | [`0xc4743d6295311AFead12161881Bfcf601B70104C`](https://testnet.mstscan.com/address/0xc4743d6295311AFead12161881Bfcf601B70104C) |
| **Deployment tx** | [`0x3b98b828…d7dacd56`](https://testnet.mstscan.com/tx/0x3b98b828b89bda4489bde9bded404afeb5dfe68d2703759184d74111d7dacd56) · block 5,786,343 |
| **Source** | **Verified** — solc `v0.8.28`, evm `cancun`, optimizer on, 200 runs, 10 files |
| **Constructor args** | `(0xc71dC478…4ad24, 120)` — admin, challenge window in seconds |
| **Human authority** | [`0xA9F68fDf84388fa548a685085E2bee0e5b311fF1`](https://testnet.mstscan.com/address/0xA9F68fDf84388fa548a685085E2bee0e5b311fF1) (BridgeKey) |
| **Agent wallets** | [`atlas`](https://testnet.mstscan.com/address/0xa4ef956f01946b93efd592ce720d24beec19588f) 0.02/tx · [`vega`](https://testnet.mstscan.com/address/0x15757d543f6050b6f5ff83782b7c122e21450daa) 0.01/tx · [`kestrel`](https://testnet.mstscan.com/address/0x76bf4262aa13632e91e27e0eba3b42b6b353ce4e) 0.016/tx, kill switch **on** |
| **Live demo** | **https://auspex-web-mu.vercel.app** |

> ### ⚠️ Use `testnet.mstscan.com`, not `mstscan.com`
> They index **different chains**. At the time of writing `mstscan.com` reported a head block around
> 20,861,000 while our RPC was at 5,786,000; `testnet.mstscan.com` matches our RPC exactly. Our
> transactions do not appear on `mstscan.com`, and looking there is the likeliest way to conclude —
> wrongly — that a real transaction is fake.

### The evidence — every hash below resolves on MSTScan

**What the system did when it was allowed to.**

The **sent by** column gives the actual sender, abbreviated. `pnpm check:links` re-reads each
transaction from the explorer and fails if the address in this table is not the address that signed
it — so these attributions cannot quietly drift into flattery.

| What it proves | Transaction | Sent by |
|---|---|---|
| Contract deployment | [`0x3b98b828…acd56`](https://testnet.mstscan.com/tx/0x3b98b828b89bda4489bde9bded404afeb5dfe68d2703759184d74111d7dacd56) | `0xc71dC478…4ad24` operator |
| `grantRole(MARKET_CREATOR_ROLE)` → the human | [`0xe4ed912c…932069`](https://testnet.mstscan.com/tx/0xe4ed912c309db55a0cfa51e597ad4845369714a51fe77b0c282e39b8cc932069) | `0xc71dC478…4ad24` operator |
| **Human-approved `createMarket`** (market 4) | [`0x2e70a1cb…e825a504`](https://testnet.mstscan.com/tx/0x2e70a1cbe7bd72b33e68afdc4742c0416b2eee3ed3ed4297bf938d2be825a504) | **`0xA9F68fDf…311fF1` human** |
| Human-approved `createMarket` (market 5) | [`0xf8d8e41c…83e41c32e`](https://testnet.mstscan.com/tx/0xf8d8e41c64c0ea4d57860ee5cbc72f46b8ef4c3659d0d3feaa3b6e083e41c32e) | **`0xA9F68fDf…311fF1` human** |
| Human-approved `createMarket` (market 6) | [`0xfc861037…80fc221df`](https://testnet.mstscan.com/tx/0xfc861037611ed292a07a5a8982cf7dca8156576a4a3b581bad61c8a80fc221df) | **`0xA9F68fDf…311fF1` human** |
| Human-approved `createMarket` (market 7) | [`0x44451775…1bc60058f9`](https://testnet.mstscan.com/tx/0x444517757604b0b600f75790b6734cfc175c164d42b112bd32d96f1bc60058f9) | **`0xA9F68fDf…311fF1` human** |
| Human-approved `createMarket` (market 9) | [`0xd25ab504…9d258f4f8e`](https://testnet.mstscan.com/tx/0xd25ab5045f9893559b242ed97d2ff1870f10b6a8e1f4d97ddc35f39d258f4f8e) | **`0xA9F68fDf…311fF1` human** |
| `registerAgent` — a cap written on chain | [`0x74cb33a1…6f124b7a`](https://testnet.mstscan.com/tx/0x74cb33a18ec7378a832868898e1fcbf1f41d057910f5cddea23f8bb16f124b7a) | `0xc71dC478…4ad24` operator |
| **Agent `placeBet` inside its caps** | [`0x5f8a12c6…7ea10dd5f1`](https://testnet.mstscan.com/tx/0x5f8a12c6259de3493b79314e3e6f0284a3650e378b4b34f627cff37ea10dd5f1) | `0xa4ef956f…19588f` atlas, no role |
| Agent `placeBet` inside its caps | [`0xc2a42699…3f204e0759`](https://testnet.mstscan.com/tx/0xc2a426997ae432372d645ac8b95bf947acaa20562c9c69672046ca3f204e0759) | `0xa4ef956f…19588f` atlas, no role |
| Agent `placeBet` — taking the NO side | [`0x8a5b0740…4e81aad9b2`](https://testnet.mstscan.com/tx/0x8a5b07402db7d20c27598b74d83de8926a4e407767dacf4e35d2544e81aad9b2) | `0xa4ef956f…19588f` atlas, no role |
| **`proposeResolution` with an evidence URL** | [`0x5c2df8b3…47121e2127`](https://testnet.mstscan.com/tx/0x5c2df8b38c35d3218b5a7095bf658a6996f1deefe836c0f83be02d47121e2127) | `0xc71dC478…4ad24` operator † |
| **`challengeResolution`** — outcome sent back | [`0x1e38128c…a689f43fc9`](https://testnet.mstscan.com/tx/0x1e38128c1423aca8e5501a3c6727d66e3fa211ede52d555282753ba689f43fc9) | `0xc71dC478…4ad24` operator † |
| `proposeResolution`, round 2 | [`0xe7068be6…3c643b9f4`](https://testnet.mstscan.com/tx/0xe7068be69e329a444270134f354e4695b39103c89384c5fe21ee5d23c643b9f4) | `0xc71dC478…4ad24` operator † |
| **`finalizeResolution` — permissionless** | [`0x2f4fd428…faa5d407fc`](https://testnet.mstscan.com/tx/0x2f4fd42833a6aaa04819d92a2f1e3de04c4dd897145eb1b0c5b53dfaa5d407fc) | `0xa4ef956f…19588f` **no role at all** |
| **`claim` — 0.015 tMSTC paid to the OWNER** | [`0x7ae9c683…b1970e0a2`](https://testnet.mstscan.com/tx/0x7ae9c6830335f810629b63dfef47cbfbbd7757385bbbc25779bc676b1970e0a2) | `0xa4ef956f…19588f` agent; **paid the owner** |
| **`invalidateStale` — permissionless refund** | [`0xefe33de2…a20f3ca6b`](https://testnet.mstscan.com/tx/0xefe33de28f5424940e6e94b123c30c052f83261f3bcb96bd8aa741ba20f3ca6b) | `0xa4ef956f…19588f` **no role at all** |
| Refund `claim` on the invalidated market | [`0x17a3d09a…81f0488bb`](https://testnet.mstscan.com/tx/0x17a3d09a957e922aec15ae1d224339d24361aa38de0adfa19be057b81f0488bb) | `0xc71dC478…4ad24` the bettor |
| `closeMarket` driven by a pipeline tick | [`0x9588280c…2399ed35a7`](https://testnet.mstscan.com/tx/0x9588280c82402a72204af12f6132871e68fd40c9d0b9541b41f0c42399ed35a7) | `0x76bf4262…53ce4e` kestrel, **no role** |

> **† These three came from the operator key, not the human wallet, and that is worth being exact
> about.** They are market 8 — the labelled lifecycle test — which was driven from a laptop because
> proving a payout needs a market with stakes on *both* sides and none existed. The human wallet holds
> `RESOLVER_ROLE` and `CHALLENGER_ROLE` and `/resolve` signs with it in a browser, but **no market has
> yet been resolved through that path.** As of 2026-09-30 one human-created market (#11) has reached
> its close time and is awaiting an outcome; the reason the resolution agent has not yet drafted one is
> a real defect in the tick's own time budget, not a shortage of candidates, and it is written up as
> gap #34 in [`PROGRESS.md`](./PROGRESS.md). `/markets/8` says the same thing on the page, computed from
> the rows rather than asserted over them. The claim that survives on market 8 is the one that does not
> depend on who signed: `finalizeResolution` and `claim` were sent by a wallet holding **no role at
> all**, so a privileged party cannot block a payout.

**What the chain refused. These are the important ones.**

| The refusal | Transaction | Decoded error |
|---|---|---|
| **An agent betting one wei over its cap** | [`0xf0152234…3255720c2d`](https://testnet.mstscan.com/tx/0xf0152234efe078729401162dd8ef16e6d19da2c657dcfe4360f2cd3255720c2d) | `AgentPerTxCapExceeded(20000000000000001, 20000000000000000)` |
| The same, triggered from the **live site** by a visitor with no wallet | [`0xbfe9bb2c…18ced060a`](https://testnet.mstscan.com/tx/0xbfe9bb2c3ffee4be2f660473b3de916380f5d10da8548173d44810118ced060a) | `AgentPerTxCapExceeded(…)` |
| A bet arriving after the market closed | [`0x078b9c76…d3da6b73f`](https://testnet.mstscan.com/tx/0x078b9c76e0a6752f6245c6b60fb55a6281e5f768a83e64d8789381dd3da6b73f) | `BettingClosed()` |
| Finalising **inside** the challenge window | [`0x39e30155…01204864df`](https://testnet.mstscan.com/tx/0x39e30155507d037d5db8ac983f15b1ef6239d714116d8b21c436ba01204864df) | `ChallengeWindowOpen(1790644321)` |
| Claiming a second time | [`0x108c50cb…a5e603903c`](https://testnet.mstscan.com/tx/0x108c50cb6a364699f210d003f55dddc5c2004ad4972fb7a3e7570ca5e603903c) | `AlreadyClaimed()` |
| The losing side claiming | [`0x6237ea0c…30ab4094929`](https://testnet.mstscan.com/tx/0x6237ea0ce42bea18a6349fe34b001d8bfb9d4fe98e97acad3be9030ab4094929) | `NothingToClaim()` |

Two further refusals are proved by `eth_call` rather than by a broadcast, because broadcasting them
would prove nothing extra: `proposeResolution` from an unprivileged address returns
`AccessControlUnauthorizedAccount`, and `invalidateStale` before the deadline returns
`ResolveDeadlineNotPassed`. `pnpm --filter web verify:resolution` runs both live, from the real
addresses.

**A failed transaction is not a bug here. It is the product.** Gas is free on this chain, so
transactions we *want* refused are deliberately allowed to reach it, where anyone can read the revert
reason in decoded form — which works only because the source is verified.

### The markets on chain

Thirteen exist, and no count is written down here — [`/markets`](https://auspex-web-mu.vercel.app/markets)
derives the split from the creating address in each indexed log, so the page cannot drift out of
agreement with the chain the way a sentence in a README does.

**Nine are the product path**, drafted by an AI agent from two-source-confirmed news, read as a
checklist by a person, and created by a signature from a key no server holds.

**Four were created while commissioning the contract**, from the operator key rather than through the
human gate, and they split into two cases that deserve different sentences:

- **Markets 3 and 8 say what they are in their own on-chain question text** — `[Phase 2 idempotency
  test …]` and `[Phase 6 lifecycle test …] Not a product market.` Those strings are immutable, which
  is the point: a label has to survive being quoted out of context.
- **Markets 1 and 2 do not.** They ask *"Will AuspeX have a verified contract on MST Testnet before
  the deadline?"* — obviously not a product question, but it never announces itself as a test. This is
  the weaker case and it is named rather than averaged in with the other two. It is also a correction:
  an earlier draft of this file claimed all four labelled themselves, and reading the chain showed
  that two of them do not.

None of the four is presented anywhere as a product market.

**The distinction anyone can check without trusting this file:** markets 1–3 and 8 were sent by the
deployer `0xc71dC478…4ad24`. The other nine were sent by `0xA9F68fDf…311fF1` — the human authority, a
key that exists only inside a browser extension.

Market **8** is the one to look at for the full lifecycle, because it is finished.
**[/markets/8](https://auspex-web-mu.vercel.app/markets/8)** shows create → bets on both sides → a
late bet refused → close → propose → premature finalisation refused → challenge → re-propose →
finalise → claim → a second claim refused → the losing claim refused. Every row carries its signer
and its transaction.

---

## What to look at, page by page

| Page | What it is for |
|---|---|
| [`/trust`](https://auspex-web-mu.vercel.app/trust) | the whole design on one page — untrusted zone, authority zone, live role matrix, refusal counters, the cap probe |
| [`/`](https://auspex-web-mu.vercel.app/) | the live pipeline. **Run tick** advances it in front of you |
| [`/markets`](https://auspex-web-mu.vercel.app/markets) | every market, read from the chain rather than from the projection |
| [`/markets/8`](https://auspex-web-mu.vercel.app/markets/8) | one market's entire on-chain lifecycle, with the signer of every call |
| [`/review`](https://auspex-web-mu.vercel.app/review) | **the human gate.** A checklist, the fenced untrusted source text, approve or refuse with a signature |
| [`/agents`](https://auspex-web-mu.vercel.app/agents) | what each agent proposed vs. what the gate allowed, with reasons for both |
| [`/resolve`](https://auspex-web-mu.vercel.app/resolve) | the resolver's queue: the drafted outcome, the verbatim quote, the evidence link |
| [`/audit`](https://auspex-web-mu.vercel.app/audit) | the append-only decision log. Every row has a reason — approvals *and* refusals |

Every number rendered anywhere carries a `<Provenance>` badge saying where it came from — `CHAIN`,
`INDEXED`, `DB`, `COMPUTED`, `EXTERNAL`. There is no sixth quiet option: a `MOCK` badge **throws** in
a production build, and CI fails if one is reachable.

---

## Architecture, briefly

One Next.js app, one Postgres database, one contract. No separate worker service and no queue broker
— the pipeline is a **state machine advanced by bounded ticks**, and an API route is the worker.

```
contracts/     Hardhat 3 · Solidity 0.8.28 · OpenZeppelin 5 · tests · deploy + verify
web/           Next.js 16 · dashboard · API routes · pipeline stages · the three agents
  lib/chain/       ethers v6 client, the deployed ABI, the indexer
  lib/intents/     the idempotency engine — a row is written BEFORE a broadcast
  lib/proposer/    market drafting: retrieve → draft → validate → queue
  lib/agents/      the policy gate (pure) and the member agents
  lib/resolution/  outcome drafting: retrieve → draft → validate → propose
  lib/trust/       live role reads and the refusal counters
docs/          PRD · ARCHITECTURE · TRUST_MODEL · CONTRACTS · RUNBOOK · WALKTHROUGH
               BUILD_RECORD · BUILD_PLAN · PROGRESS · DECISIONS   <- the engineering log
```

**Idempotency is a design constraint, not a test.** Off-chain: unique keys plus
`SELECT … FOR UPDATE SKIP LOCKED`. On-chain: the `OnChainIntent` row is written *before* the
broadcast, and the contract rejects a repeated `specHash` as a second line of defence that does not
depend on the application being right. `pnpm --filter web crash-test` proves it by killing a worker
mid-flight and re-running it — the result is one market, not two.

**Untrusted text is delimited, always.** News content reaches a model inside `<untrusted_content>`
tags in a **user**-role message, never in a system instruction. Model output is schema-constrained at
the API, re-validated with Zod, *and* scanned for injection signatures afterwards — because text that
has passed *through* a model after being derived from a hostile headline is still hostile.

**Failure is designed for.** A rate-limited or unavailable model means **no action**, a logged reason,
and a tick that continues. In one production tick measured for this README,
`gemini-3.1-flash-lite` returned HTTP 503 twice; the fallback chain absorbed both, and the tick
finished in **24.3 s with zero errors** and 7 of its 10 budgeted model calls spent. The seven RSS
feeds that work carry the pipeline while GDELT rate-limits on most ticks — a visibly degraded feed
that does not take the system down.

**Scale, as one snapshot taken on 2026-09-29 in production** (`/trust` and `/audit` recompute these on every load): 463 articles from 194 known publishers · 382
clustered events, 13 two-source `CONFIRMED` · 12 market specs drafted (5 approved, 1 refused by a
human, 6 awaiting review) · 12 agent decisions (3 on chain, 8 refused by the gate) · 34 on-chain
intents · 290 audit rows, every one carrying a reason.

**The cron cadence is measured on the page, not asserted here.** The pipeline runs unattended on a
GitHub Actions heartbeat, and a schedule expression is a *request*: scheduled workflows on a public
repository are best-effort, delayed under load, with free runners dropped first. Measured across 46
hours to 2026-09-30T18:50Z, the previous every-five-minutes expression was delivered **9 times — 1.6%
of what it asked for**, a mean gap of 5h07m and a spread of 2h57m to 6h44m, every run successful.

So this README states no cadence. [`/audit`](https://auspex-web-mu.vercel.app/audit) computes the
real one from `audit_log` on every request, alongside the median tick duration, and that panel is
right about whatever GitHub does next. The workflow now asks for twice an hour at off-peak minutes,
following GitHub's own guidance that the top of every hour is a high-load window — what *that*
delivers is not yet measured and is not claimed. Nothing user-facing is allowed to depend on the
cron: market notifications are sent by `/review` itself the moment a creation is confirmed, and the
**Run tick** button on the dashboard advances the pipeline on demand.

Worth reading: [`ARCHITECTURE.md`](./docs/ARCHITECTURE.md) for the system,
[`CONTRACTS.md`](./docs/CONTRACTS.md) for the contract design,
[`TRUST_MODEL.md`](./docs/TRUST_MODEL.md) for where the boundaries are,
[`WALKTHROUGH.md`](./docs/WALKTHROUGH.md) for a tour of the running pages, and
[`DECISIONS.md`](./docs/DECISIONS.md) for why each choice was made and what it cost.

AuspeX was built in eight phases over four days and the log of that is kept in full rather than
tidied away — [`BUILD_RECORD.md`](./docs/BUILD_RECORD.md) says which files those are and why keeping
them is the honest choice for a product whose whole pitch is that its claims can be checked.

---

## Running it locally

```bash
git clone https://github.com/arunishrajput/auspex
cd auspex
pnpm install

cp .env.example .env.local     # then fill it in — docs/RUNBOOK.md is click-by-click

pnpm wallets:new               # generate a deployer wallet, fund it at the faucet
pnpm preflight                 # 11 checks: RPC, chain id, explorer, DB, LLM, contract, agent caps

pnpm compile                   # solc 0.8.28, evmVersion cancun
pnpm test                      # contract + unit tests
pnpm deploy:testnet            # deploy to MST Testnet
pnpm verify:testnet            # verify source on MSTScan

pnpm dev                       # dashboard on http://localhost:3000
```

**Requirements:** Node ≥ 22 (developed on 26), pnpm 11. **Hardhat 3, not 2** — Hardhat 2's `ts-node`
dependency crashes on Node 26.

Useful beyond the basics:

```bash
pnpm --filter web tick              # one tick: ingest → cluster → propose → agents → resolve → settle
pnpm --filter web agents:register   # seed members, fund agent wallets, write caps ON CHAIN (local only — needs admin)
pnpm --filter web verify:agents     # 41 live checks: roles, registry, the cap boundary, the kill switch
pnpm --filter web verify:resolution # the resolution gates, by eth_call
pnpm --filter web agents:over-cap   # THE over-cap bet: sends cap+1 wei and the chain refuses it
pnpm --filter web probe:cap        # the same refusal, from the terminal
pnpm --filter web lifecycle         # the whole resolution lifecycle on chain, ~5 min
pnpm --filter web crash-test        # the idempotency proof. Creates a REAL market.
```

The `verify:*` scripts sign nothing and write nothing — they are `eth_call` only, which is the
cheapest possible proof and the reason they are safe to run against production.

**Secrets live only in `.env.local`, which is git-ignored.** CI fails the build if an `.env` file or a
real-looking key is ever committed. No private key appears in any log, commit or page, and the
recovery phrase behind the human authority wallet is not needed by anything in this repository.

---

## Limitations — stated plainly

These are real. Naming them is what makes the other claims credible. They are also on
[`/trust`](https://auspex-web-mu.vercel.app/trust) and in
[`docs/TRUST_MODEL.md`](./docs/TRUST_MODEL.md); [`PROGRESS.md`](./PROGRESS.md) carries the longer
list with measurements attached.

**Resolution is trusted.** A small authorised set submits outcomes with an on-chain evidence URL,
**signed from a human's browser wallet** — no key the deployed application holds can resolve a
market. The challenge window, permissionless `finalizeResolution` and permissionless
`invalidateStale` bound what one bad or absent resolver can do. But **this is not a decentralised
oracle**: a resolver colluding with the challenger set could still settle a market wrongly. A
production system would use a staked dispute mechanism or an oracle network. This is a mechanism that
could be implemented correctly and described honestly, chosen over one that could only be gestured at.

**The market creator and the resolver are the same wallet.** They should be different people. The
code already reads them from two separate variables so that splitting them is a configuration change
plus two `grantRole` calls — the split has not been made, and `/resolve` says so on the page.

**The challenge window is 120 seconds**, short enough that a whole lifecycle can be watched end to
end. It is immutable, so it is honest rather than quietly tunable — and it had a real design cost: two
minutes is far too short for a human to notice and veto a wrong outcome, so the human gate had to move
*before* the proposal. That is why `proposeResolution` is browser-signed rather than optimistic. A
longer window would permit the cleaner shape — AI proposes publicly, human vetoes inside the window —
and that design is not available at this setting.

**Agent keys are held by the server.** Agent autonomy requires a key the server can sign with. Keys
are encrypted at rest (AES-256-GCM), but **the encryption is hygiene — the on-chain caps are what
actually bound the risk.** A full server compromise loses at most each agent's capped stake and
cannot redirect winnings, because `claim()` pays the registered owner. A production system would use
session keys under account abstraction.

**Source independence is heuristic.** "Two independent sources" means two distinct publisher domains
from an allowlist, with an independence-group check and syndication detection. Two outlets can still
be running the same wire copy. The chance is reduced, not eliminated.

**Confirmation leans on the model more than the deterministic path does.** Independent reports of one
story score around 0.44 on our similarity measure — below the 0.50 automatic-merge threshold — so most
genuine two-source merges come from a borderline adjudication by the LLM. With no model the pipeline
still ingests, deduplicates and displays honestly; it just confirms rarely. That is a consequence of
choosing to fail safe, not an accident.

**Prompt injection is bounded, not solved.** A successful injection produces at worst a *plausible but
wrong proposal*, which a human still has to approve and the contract still caps.

**Two of the four refusal layers are thin on live data.** Schema rejection has never fired here — 51
unit tests cover that path, but no model output in this database has been structurally invalid. And
the human gate has many more approvals on record than refusals — the refusal path is implemented,
server-verified and signature-checked, and it has been exercised far less. Both counters appear on
`/trust` as they are, rather than dressed up.

**The resolution agent has never drafted an outcome for a real market.** Markets close, and the stage
that would read them is starved by the tick's own deadline ladder: clustering runs first with a call
budget but no deadline, and the resolution stage has repeatedly logged *"out of time for this tick
after examining 0 market(s)"*. The whole path is implemented and tested against real data with
`resolution:dry-run`, and market 8's lifecycle is on chain — but on the live pipeline it has not run
yet, and the reason is a defect rather than a shortage of candidates. It is gap #34 in
[`PROGRESS.md`](./PROGRESS.md).

**Model quality is bounded by a small model on a free tier.** Drafted specs are structurally sound and
occasionally loose — one approved market's criteria says to check Zoo Atlanta's own website while its
on-chain resolution source is the Guardian. That inconsistency is left visible rather than patched,
because a reviewer catching it is the point of having a reviewer. The deterministic rules catch what is
*checkable*; judgement is the human's job.

**Re-orgs** are handled by a confirmation depth of 3 blocks and nothing more — fine on a
3-second-block testnet, insufficient for mainnet. **Nothing here is audited**, and tMSTC has no
value.

**Fortuna VRF is not used.** The Fortuna contract
(`0x01C6C7EBac32eD9be3Cd8Ad84B38128124AAd380`) is a VRF coordinator with no market functions, and
`eth_getCode` against it on chain `91562037` returns `0x` — it is a mainnet contract, unreachable from
testnet. Randomised resolver selection was therefore **cut rather than faked.**

### Also deliberately cut

Multi-outcome markets · AMM or order-book pricing · an MEP-20 token · upgradeable proxies · account
abstraction · a separate indexer service · email · a mobile app · agent-vs-agent negotiation. Each
was cut to keep the thin real loop — news → confirmation → human gate → on-chain market → capped
agent bet → resolution → payout — genuinely working end to end, rather than half-built in six places.

---

## License

MIT — see [`LICENSE`](./LICENSE).
