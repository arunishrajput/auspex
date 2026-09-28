# CONTRACTS.md — `AuspexMarket.sol`

The specification Phase 1 implements. One contract; the agent registry is folded in because splitting
it would add a trust boundary and a deployment step without adding safety.

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

**States:** `OPEN`, `CLOSED`, `RESOLUTION_PROPOSED`, `FINALIZED`, `INVALIDATED`.
**Outcomes:** `UNRESOLVED = 0`, `YES = 1`, `NO = 2`, `INVALID = 3`.

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
    string  evidenceUrl;         // set at resolution
}

struct AgentConfig {
    address owner;               // winnings are paid HERE, never to the agent
    uint128 perTxCap;
    uint128 perMarketCap;
    bool    active;
}

mapping(uint256 => Market)                              public markets;
mapping(address => AgentConfig)                         public agents;
mapping(uint256 => mapping(address => uint256))         public agentSpentOnMarket;
mapping(uint256 => mapping(address => uint256))         public stakeYes;
mapping(uint256 => mapping(address => uint256))         public stakeNo;
mapping(uint256 => mapping(address => bool))            public claimed;
mapping(bytes32 => bool)                                public specHashUsed;   // replay guard
uint256 public marketCount;
uint64  public challengeWindow;   // short (~120s) for the demo; stated honestly in the README
```

---

## 4. Agent limits — the headline defence

This is the claim to defend to judges:

> **Even if our server is fully compromised and the off-chain policy gate is bypassed entirely, an
> agent wallet cannot exceed its cap — because the contract refuses the transaction.**

Inside `placeBet`, when the caller is a registered active agent:

```solidity
AgentConfig memory a = agents[msg.sender];
if (a.active) {
    if (msg.value > a.perTxCap) revert AgentPerTxCapExceeded(msg.value, a.perTxCap);
    uint256 spent = agentSpentOnMarket[marketId][msg.sender] + msg.value;
    if (spent > a.perMarketCap) revert AgentPerMarketCapExceeded(spent, a.perMarketCap);
    agentSpentOnMarket[marketId][msg.sender] = spent;
}
```

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
**0** for the hackathon.

Chosen over an AMM or an order book because it is auditable in one line and explainable in one
sentence. A judge can verify the arithmetic by hand from the event log. LMSR pricing would look more
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
```

- `proposeResolution` requires `block.timestamp >= closeTime` and state `CLOSED`. Sets the outcome,
  records `evidenceUrl` and `proposedBy`, sets `challengeEndsAt = block.timestamp + challengeWindow`,
  moves to `RESOLUTION_PROPOSED`.
- `challengeResolution` is valid only while `block.timestamp < challengeEndsAt`. Clears the proposed
  outcome, returns the market to `CLOSED`, increments `challengeCount`, emits the reason on-chain.
- After `challengeCount` exceeds a threshold, admin may force `INVALIDATED` → full refunds.
- `finalizeResolution` requires `block.timestamp >= challengeEndsAt` and moves to `FINALIZED`.

**Honest framing, which belongs in the README verbatim:**

> Resolution is **trusted**. A small set of authorised resolvers submits outcomes with an evidence
> URL. A challenge window and permissionless finalisation limit what a single bad resolver can do
> unilaterally, but this is **not a decentralised oracle**. A production system would use a staked
> dispute mechanism (UMA-style) or a decentralised oracle network.

Claiming otherwise would be the one thing that could genuinely sink the submission.

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
- A judge opening the contract on MSTScan can **read the actual market and the actual evidence**
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
error NotMarketCreator();          error NotResolver();
error MarketNotOpen();             error MarketClosed();
error BettingClosed();             error ZeroStake();
error SpecHashAlreadyUsed(bytes32 specHash);
error AgentPerTxCapExceeded(uint256 attempted, uint256 cap);
error AgentPerMarketCapExceeded(uint256 attempted, uint256 cap);
error AgentNotActive();
error ResolutionNotProposed();     error ChallengeWindowOpen(uint64 endsAt);
error ChallengeWindowClosed();     error InvalidOutcome(uint8 outcome);
error AlreadyClaimed();            error NothingToClaim();
error TransferFailed();
```

Named errors make the demo legible: the over-cap revert shows as
`AgentPerTxCapExceeded(attempted, cap)` on MSTScan, not as an anonymous failure.

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
| Pause | paused blocks `placeBet`; unpause restores |
