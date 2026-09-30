# CONTRACTS.md — `AuspexMarket.sol`

The specification Phase 1 implements. One contract; the agent registry is folded in because splitting
it would add a trust boundary and a deployment step without adding safety.

**Deployed and verified** on MST Testnet (chain `91562037`):
[`0xc4743d6295311AFead12161881Bfcf601B70104C`](https://testnet.mstscan.com/address/0xc4743d6295311AFead12161881Bfcf601B70104C#code)
— constructor args `(0xc71dC478040F7A6bcc5Cb1f316A4a446F7D4ad24, 120)`.
This document is kept in sync with that bytecode; where the two ever disagree, the chain wins.

```
Solidity   0.8.28
evmVersion cancun          (PUSH0/MCOPY/TSTORE verified live on chain 91562037)
Optimizer  enabled, runs 200
Base       OpenZeppelin 5 — AccessControl, Pausable, ReentrancyGuard
Upgradable no (deliberate — see §9)
Errors     custom errors throughout (cheaper, and Blockscout decodes them)
```

---

## 1. Roles — who can do what

| Role | Held by | Can do | Cannot do |
|---|---|---|---|
| `DEFAULT_ADMIN_ROLE` | Deployer | Grant/revoke roles, register agents, pause, force-invalidate | Bet on behalf of an agent |
| `MARKET_CREATOR_ROLE` | The human authority | `createMarket` **only** | Resolve, or spend agent funds |
| `RESOLVER_ROLE` | Authorised resolver(s) | `proposeResolution` | Create markets, finalize early |
| `CHALLENGER_ROLE` | Admin + a second address | `challengeResolution` during the window | Set an outcome directly |
| *(no role)* | **Agent wallets** | `placeBet` within caps, `claim` | Everything else |
| *(no role)* | Anyone | `placeBet`, `claim`, `finalizeResolution` after the window | — |

**The point of this table:** agent wallets hold **no role at all**. They are entries in a registry.
An agent cannot create a market, cannot resolve one, and cannot move funds anywhere except into a
capped bet. That is a property of the contract, not a promise from our server.

**`finalizeResolution` is deliberately permissionless.** Once the challenge window has elapsed, anyone
can finalize. No privileged party — including us — can block a payout by going silent.

---

## 2. Market lifecycle

```
          createMarket (MARKET_CREATOR_ROLE, human-signed)
                  │
                  ▼
   ┌──> OPEN ──── closeTime reached ────> CLOSED
   │      │  placeBet allowed                 │  proposeResolution (RESOLVER_ROLE)
   │      │                                   ▼
   │      │                          RESOLUTION_PROPOSED
   │      │                        (challengeEndsAt = now + challengeWindow)
   │      │                              │              │
   │      │            challengeResolution│              │ finalizeResolution
   │      │              (CHALLENGER_ROLE)│              │ (ANYONE, after window)
   │      │                               ▼              ▼
   │      │                           CLOSED        FINALIZED ──> claim()
   │      │                     (needs re-proposal)
   │      └──────────────────────────────────────────> INVALIDATED ──> refunds
   └─ admin force-invalidate after repeated challenges
```

**States:** `OPEN = 0`, `CLOSED = 1`, `RESOLUTION_PROPOSED = 2`, `FINALIZED = 3`, `INVALIDATED = 4`.
**Outcomes:** `UNRESOLVED = 0`, `YES = 1`, `NO = 2`, `INVALID = 3`.

Two transitions the diagram above draws as automatic are really functions, both permissionless:

- **`closeMarket(marketId)`** — moves `OPEN` to `CLOSED` once `closeTime` has passed. Anyone may
  call it. It exists so the transition is an indexable event rather than an implicit one; betting is
  gated on `closeTime` directly, so forgetting to call it can never let a late bet through.
  `proposeResolution` also auto-closes an overdue market, so a forgotten call cannot strand funds.
- **`invalidateStale(marketId)`** — anyone may invalidate a market whose `resolveDeadline` passed
  with no resolution finalised; everyone is refunded. The counterpart to permissionless
  finalisation: a resolver who never shows up cannot lock funds up either (ADR-021).

---

## 3. Storage

```solidity
struct Market {
    bytes32 specHash;            // hash of the exact approved off-chain spec — binds chain to spec
    uint64  closeTime;           // betting closes
    uint64  resolveDeadline;     // resolver expected to act by here
    uint64  challengeEndsAt;     // set when a resolution is proposed
    uint128 poolYes;
    uint128 poolNo;
    uint8   outcome;             // 0 unresolved · 1 YES · 2 NO · 3 INVALID
    uint8   state;
    uint8   challengeCount;
    address proposedBy;          // which resolver proposed the current outcome
    string  question;            // stored on-chain ON PURPOSE — see §8
    string  resolutionSourceUrl;
    string  evidenceUrl;         // set at resolution, cleared by a successful challenge
}

// `_markets` is private because a public getter on a struct omits its `string` members.
// getMarket(uint256) returns the whole record, strings included, for the dashboard and MSTScan.

struct AgentConfig {
    address owner;               // winnings are paid HERE, never to the agent
    uint128 perTxCap;
    uint128 perMarketCap;
    bool    active;
}

mapping(uint256 => Market)                              private _markets;   // read via getMarket()
mapping(address => AgentConfig)                         public agents;
mapping(uint256 => mapping(address => uint256))         public agentSpentOnMarket;
mapping(uint256 => mapping(address => uint256))         public stakeYes;
mapping(uint256 => mapping(address => uint256))         public stakeNo;
mapping(uint256 => mapping(address => bool))            public claimed;
mapping(bytes32 => bool)                                public specHashUsed;   // replay guard
uint256 public marketCount;      // ids start at 1; id 0 is never a market
uint64  public immutable challengeWindow;   // 120s on the live deployment. IMMUTABLE — an admin who
                                            // could shrink it to 0 would defeat the window (ADR-019)
uint8   public constant MAX_CHALLENGES = 3; // challenges required before admin may force-invalidate
```

---

## 4. Agent limits — the headline defence

This is the claim the design has to support:

> **Even if our server is fully compromised and the off-chain policy gate is bypassed entirely, an
> agent wallet cannot exceed its cap — because the contract refuses the transaction.**

Inside `placeBet`, when the caller is a registered active agent:

```solidity
AgentConfig memory a = agents[msg.sender];
bool isAgent = a.owner != address(0);          // REGISTERED, which is not the same as ACTIVE

if (isAgent) {
    if (!a.active) revert AgentNotActive();
    if (msg.value > a.perTxCap) revert AgentPerTxCapExceeded(msg.value, a.perTxCap);
    uint256 spent = agentSpentOnMarket[marketId][msg.sender] + msg.value;
    if (spent > a.perMarketCap) revert AgentPerMarketCapExceeded(spent, a.perMarketCap);
    agentSpentOnMarket[marketId][msg.sender] = spent;
}
```

**Registered and active are deliberately separate checks.** Branching on `a.active` alone has an
inverted failure mode: a deactivated agent would fall out of the capped branch into the uncapped
"anyone" path, so the safety control would *remove* the limit it exists to impose. A deactivated
agent reverts `AgentNotActive` and cannot bet at all (ADR-020).

Plus `whenNotPaused` — a global on-chain kill switch independent of the off-chain one.

Two independent limit layers, and they are **not** copies of each other:

| | Off-chain policy gate | On-chain caps |
|---|---|---|
| Lives in | `web/lib/policy/policyGate.ts` | `AuspexMarket.sol` |
| Enforces | per-tx cap, **daily budget**, min confidence, category allowlist, kill switch | per-tx cap, per-market cap, global pause |
| Trust | ours — could be wrong or compromised | the chain's — cannot be bypassed |
| Failure mode | clamps or rejects before signing | **reverts the transaction** |

Phase 5 proves the second layer by deliberately bypassing the first and letting the chain reject it.
The resulting reverted transaction is *evidence*, and it is pointed at during the demo.

---

## 5. Betting and parimutuel payout

`placeBet(uint256 marketId, bool backsYes) external payable whenNotPaused`

Requires: market `OPEN`, `block.timestamp < closeTime`, `msg.value > 0`, agent caps if applicable.
Adds to `poolYes`/`poolNo` and the caller's stake. Emits `BetPlaced`.

**Payout is parimutuel** — winners split the entire pool pro rata:

```
totalPool = poolYes + poolNo
payout(user) = stake(user) * totalPool / winningPool
```

Equivalently, the user's own stake back plus a pro-rata share of the losing pool. Protocol fee is
**0**, deliberately: this is a testnet platform and taking a cut of a testnet pool would be theatre.

Chosen over an AMM or an order book because it is auditable in one line and explainable in one
sentence. Anyone can verify the arithmetic by hand from the event log. LMSR pricing would look more
sophisticated and be far harder to defend under questioning.

**Edge cases that must be tested:**
- `winningPool == 0` (nobody backed the winning side) → treat as `INVALID`, refund every bettor.
- `outcome == INVALID` → everyone is refunded their exact stake.
- Integer division dust remains in the contract; it is not silently credited to anyone.

---

## 6. Resolution with a challenge window

```solidity
proposeResolution(uint256 marketId, uint8 outcome, string calldata evidenceUrl)  // RESOLVER_ROLE
challengeResolution(uint256 marketId, string calldata reason)                    // CHALLENGER_ROLE
finalizeResolution(uint256 marketId)                                             // ANYONE
invalidateStale(uint256 marketId)                                                // ANYONE, past deadline
forceInvalidate(uint256 marketId, string calldata reason)                        // ADMIN, >= 3 challenges
```

- `proposeResolution` requires `block.timestamp >= closeTime` and state `CLOSED`. Sets the outcome,
  records `evidenceUrl` and `proposedBy`, sets `challengeEndsAt = block.timestamp + challengeWindow`,
  moves to `RESOLUTION_PROPOSED`.
- `challengeResolution` is valid only while `block.timestamp < challengeEndsAt`. Clears the proposed
  outcome, returns the market to `CLOSED`, increments `challengeCount`, emits the reason on-chain.
- `finalizeResolution` requires `block.timestamp >= challengeEndsAt` and moves to `FINALIZED`.
- `forceInvalidate` requires `challengeCount >= MAX_CHALLENGES` (3) — the admin escape hatch only
  unlocks once the deadlock is already a matter of public record, so it cannot be used to void an
  inconvenient market (ADR-022). Everyone is refunded.
- A challenge **clears** the proposed outcome, `proposedBy`, `challengeEndsAt` and `evidenceUrl`, so
  the stored record never shows rejected evidence as current. The reason is emitted on-chain.

**Honest framing, which belongs in the README verbatim:**

> Resolution is **trusted**. A small set of authorised resolvers submits outcomes with an evidence
> URL. A challenge window and permissionless finalisation limit what a single bad resolver can do
> unilaterally, but this is **not a decentralised oracle**. A production system would use a staked
> dispute mechanism (UMA-style) or a decentralised oracle network.

Claiming otherwise would be the one thing that could genuinely discredit the rest.

---

## 7. Claiming — pull, not push

`claim(uint256 marketId)` — `nonReentrant`, Checks-Effects-Interactions, `claimed[...] = true`
**before** the transfer.

Pull-based because push payouts let one reverting receiver break the payout loop for everyone else.

**Where the money goes:** if the caller is a registered agent, funds are sent to `agents[caller].owner`.
Otherwise to `msg.sender`. This is why a stolen agent key cannot steal winnings.

The "automatic payout" experience the product promises is delivered by a **server-side auto-claim
worker** that calls `claim()` for agent wallets after finalisation. Seamless in experience, safe in
mechanism — the contract never pushes funds.

---

## 8. Why strings are stored on-chain

`question`, `resolutionSourceUrl` and `evidenceUrl` are stored as strings. On Ethereum mainnet this
would be indefensible. Here:

- `baseFeePerGas` is **0**, priority is 1 gwei, and the block gas limit is **55,000,000** (all verified).
- Anyone opening the contract on MSTScan can **read the actual market and the actual evidence**
  rather than an opaque hash.

The tradeoff is explicit: we spend free gas to buy auditability. `specHash` still binds the market to
the full off-chain spec, so the on-chain strings are a readable summary, not the source of truth.

---

## 9. Deliberate omissions

- **Not upgradeable.** A proxy would mean the rules could change after judging. Immutability is part
  of the trust argument.
- **No token.** Bets are in native tMSTC. An MEP-20 wrapper adds approvals and failure modes for no gain.
- **No AMM.** See §5.
- **No on-chain enumeration of bettors.** Unbounded loops are a DoS vector; the indexer reads events.

---

## 10. Events (the dashboard and the audit trail read these)

```solidity
event MarketCreated(uint256 indexed marketId, bytes32 indexed specHash, address indexed creator,
                    string question, string resolutionSourceUrl, uint64 closeTime);
event BetPlaced(uint256 indexed marketId, address indexed bettor, bool backsYes,
                uint256 amount, bool isAgent);
event ResolutionProposed(uint256 indexed marketId, address indexed resolver, uint8 outcome,
                         string evidenceUrl, uint64 challengeEndsAt);
event ResolutionChallenged(uint256 indexed marketId, address indexed challenger, string reason);
event MarketFinalized(uint256 indexed marketId, uint8 outcome);
event MarketInvalidated(uint256 indexed marketId, string reason);
event Claimed(uint256 indexed marketId, address indexed claimant, address indexed paidTo,
              uint256 amount);
event AgentRegistered(address indexed agent, address indexed owner,
                      uint128 perTxCap, uint128 perMarketCap);
event AgentDeactivated(address indexed agent);
```

## 11. Custom errors

```solidity
error UnknownMarket(uint256 marketId);
error MarketNotOpen();             error MarketNotClosed();
error MarketNotSettled();          error MarketAlreadySettled();
error BettingClosed();             error BettingStillOpen(uint64 closeTime);
error ZeroStake();
error EmptySpecHash();             error SpecHashAlreadyUsed(bytes32 specHash);
error InvalidCloseTime(uint64 closeTime);
error InvalidResolveDeadline(uint64 resolveDeadline, uint64 closeTime);
error AgentPerTxCapExceeded(uint256 attempted, uint256 cap);
error AgentPerMarketCapExceeded(uint256 attempted, uint256 cap);
error AgentNotActive();            error InvalidAgentConfig();
error ResolutionNotProposed();     error ChallengeWindowOpen(uint64 endsAt);
error ChallengeWindowClosed();     error InvalidOutcome(uint8 outcome);
error ResolveDeadlineNotPassed(uint64 resolveDeadline);
error TooFewChallenges(uint8 challengeCount, uint8 required);
error AlreadyClaimed();            error NothingToClaim();
error TransferFailed();            error InvalidConstructorArgs();
```

Two changes from the first draft of this list, both deliberate:

- **`NotMarketCreator` / `NotResolver` are gone.** OpenZeppelin's `onlyRole` already reverts
  `AccessControlUnauthorizedAccount(account, role)`, which carries strictly more information.
  Duplicating the check to throw our own name would be a second code path for the same rule.
- **`MarketClosed()` is gone**, because `MarketClosed` is the name of the *event* emitted when a
  market closes, and Solidity will not allow both. `BettingClosed()` already covered the case.

Named errors make the demo legible: the over-cap revert shows as
`AgentPerTxCapExceeded(attempted, cap)` on MSTScan, not as an anonymous failure. Note that the MST
RPC returns this data inside the JSON-RPC error *message* rather than the standard `data` field, so
it must be decoded by hand — see ADR-023.

---

## 12. Test matrix (Phase 1 exit criteria)

| Area | Must assert |
|---|---|
| Roles | non-creator `createMarket` reverts; non-resolver `proposeResolution` reverts; **agent cannot create or resolve** |
| Replay | second `createMarket` with the same `specHash` reverts `SpecHashAlreadyUsed` |
| Agent caps | exactly at cap succeeds; **one wei over reverts**; cumulative per-market cap reverts; inactive agent path |
| Betting | after `closeTime` reverts; zero stake reverts; pools update correctly |
| Payout | parimutuel math against hand-computed values; `winningPool == 0` refunds; `INVALID` refunds; dust not misallocated |
| Challenge | challenge inside window returns to `CLOSED`; outside window reverts; re-proposal works; finalize before window reverts |
| Finalize | permissionless after window; state transitions correct |
| Claim | double claim reverts; agent claim pays **owner**; reentrancy attempt fails |
| Pause | paused blocks `placeBet`; unpause restores; **`claim` still works while paused** |
| Stale market | `invalidateStale` refuses before `resolveDeadline`, refunds everyone after |

**Result: 57 tests, all passing, none skipped** (`pnpm --filter contracts test`). Every `revert`
path above asserts its specific custom error rather than merely that the call reverted.
