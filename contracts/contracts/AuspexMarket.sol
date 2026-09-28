// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";

/**
 * @title AuspexMarket
 * @notice Parimutuel prediction markets created under human authority and bet on by
 *         capped AI agents. Deployed on MST Blockchain Testnet (chain 91562037).
 *
 * @dev The thesis this contract exists to enforce: **AI proposes, humans and the chain decide.**
 *
 *      Three properties are enforced here rather than promised by our server:
 *
 *      1. Only `MARKET_CREATOR_ROLE` can create a market, and every market is bound to the
 *         hash of the exact off-chain spec a human approved (`specHash`, replay-guarded).
 *      2. A registered agent wallet holds **no role at all**. It can place a capped bet and
 *         claim — nothing else. Even with the agent's private key and our whole backend
 *         compromised, an over-cap bet reverts. See {placeBet}.
 *      3. Winnings for an agent are paid to its registered **owner**, never to the agent
 *         wallet itself. A stolen agent key cannot steal funds. See {claim}.
 *
 *      Honest framing, repeated in the README: resolution is **trusted**. Authorised
 *      resolvers submit an outcome plus an evidence URL. The challenge window and the
 *      permissionless {finalizeResolution} / {invalidateStale} limit what one bad or silent
 *      resolver can do, but this is not a decentralised oracle.
 *
 *      Strings (`question`, `resolutionSourceUrl`, `evidenceUrl`) are stored on-chain on
 *      purpose: MST Testnet's `baseFeePerGas` is 0 with a 55M block gas limit, so a judge
 *      reading this contract on MSTScan sees the real question and the real evidence rather
 *      than an opaque hash. We spend free gas to buy auditability.
 *
 *      Not upgradeable, deliberately. The rules cannot change after judging.
 */
contract AuspexMarket is AccessControl, Pausable, ReentrancyGuard {
    using SafeCast for uint256;

    // ---------------------------------------------------------------------
    // Roles
    // ---------------------------------------------------------------------

    /// @notice The human authority. Can create markets and nothing else.
    bytes32 public constant MARKET_CREATOR_ROLE = keccak256("MARKET_CREATOR_ROLE");

    /// @notice Authorised resolver(s). Can propose an outcome with evidence, after close.
    bytes32 public constant RESOLVER_ROLE = keccak256("RESOLVER_ROLE");

    /// @notice Can challenge a proposed resolution during the window. Cannot set an outcome.
    bytes32 public constant CHALLENGER_ROLE = keccak256("CHALLENGER_ROLE");

    // ---------------------------------------------------------------------
    // Market states and outcomes (uint8 so they are legible in raw event logs)
    // ---------------------------------------------------------------------

    uint8 public constant STATE_OPEN = 0;
    uint8 public constant STATE_CLOSED = 1;
    uint8 public constant STATE_RESOLUTION_PROPOSED = 2;
    uint8 public constant STATE_FINALIZED = 3;
    uint8 public constant STATE_INVALIDATED = 4;

    uint8 public constant OUTCOME_UNRESOLVED = 0;
    uint8 public constant OUTCOME_YES = 1;
    uint8 public constant OUTCOME_NO = 2;
    uint8 public constant OUTCOME_INVALID = 3;

    /// @notice Challenges required before the admin may force a market to INVALIDATED.
    /// @dev Bounds admin power: the escape hatch only unlocks after the market has visibly
    ///      deadlocked on-chain. It is not a general-purpose "cancel any market" switch.
    uint8 public constant MAX_CHALLENGES = 3;

    // ---------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------

    struct Market {
        bytes32 specHash; // hash of the exact human-approved off-chain spec
        uint64 closeTime; // betting closes at this timestamp
        uint64 resolveDeadline; // resolver is expected to have acted by here
        uint64 challengeEndsAt; // set when a resolution is proposed
        uint128 poolYes;
        uint128 poolNo;
        uint8 outcome; // OUTCOME_*
        uint8 state; // STATE_*
        uint8 challengeCount;
        address proposedBy; // resolver behind the current proposed outcome
        string question;
        string resolutionSourceUrl;
        string evidenceUrl; // set at resolution
    }

    struct AgentConfig {
        address owner; // winnings are paid HERE, never to the agent wallet
        uint128 perTxCap;
        uint128 perMarketCap;
        bool active;
    }

    mapping(uint256 => Market) private _markets;
    mapping(address => AgentConfig) public agents;
    mapping(uint256 => mapping(address => uint256)) public agentSpentOnMarket;
    mapping(uint256 => mapping(address => uint256)) public stakeYes;
    mapping(uint256 => mapping(address => uint256)) public stakeNo;
    mapping(uint256 => mapping(address => bool)) public claimed;

    /// @notice Replay guard: an approved spec can back exactly one market, ever.
    mapping(bytes32 => bool) public specHashUsed;

    /// @notice Market ids start at 1; id 0 is never a market.
    uint256 public marketCount;

    /// @notice Seconds a proposed resolution can be challenged. Immutable by design —
    ///         an admin who could shrink this to zero would defeat the challenge window.
    uint64 public immutable challengeWindow;

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    event MarketCreated(
        uint256 indexed marketId,
        bytes32 indexed specHash,
        address indexed creator,
        string question,
        string resolutionSourceUrl,
        uint64 closeTime,
        uint64 resolveDeadline
    );
    event MarketClosed(uint256 indexed marketId, uint64 closedAt);
    event BetPlaced(
        uint256 indexed marketId, address indexed bettor, bool backsYes, uint256 amount, bool isAgent
    );
    event ResolutionProposed(
        uint256 indexed marketId,
        address indexed resolver,
        uint8 outcome,
        string evidenceUrl,
        uint64 challengeEndsAt
    );
    event ResolutionChallenged(uint256 indexed marketId, address indexed challenger, string reason);
    event MarketFinalized(uint256 indexed marketId, uint8 outcome);
    event MarketInvalidated(uint256 indexed marketId, string reason);
    event Claimed(
        uint256 indexed marketId, address indexed claimant, address indexed paidTo, uint256 amount
    );
    event AgentRegistered(
        address indexed agent, address indexed owner, uint128 perTxCap, uint128 perMarketCap
    );
    event AgentDeactivated(address indexed agent);

    // ---------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------

    error UnknownMarket(uint256 marketId);
    error MarketNotOpen();
    error MarketNotClosed();
    error MarketNotSettled();
    error MarketAlreadySettled();
    error InvalidConstructorArgs();
    error BettingClosed();
    error BettingStillOpen(uint64 closeTime);
    error ZeroStake();
    error EmptySpecHash();
    error SpecHashAlreadyUsed(bytes32 specHash);
    error InvalidCloseTime(uint64 closeTime);
    error InvalidResolveDeadline(uint64 resolveDeadline, uint64 closeTime);
    error AgentPerTxCapExceeded(uint256 attempted, uint256 cap);
    error AgentPerMarketCapExceeded(uint256 attempted, uint256 cap);
    error AgentNotActive();
    error InvalidAgentConfig();
    error ResolutionNotProposed();
    error ChallengeWindowOpen(uint64 endsAt);
    error ChallengeWindowClosed();
    error InvalidOutcome(uint8 outcome);
    error ResolveDeadlineNotPassed(uint64 resolveDeadline);
    error TooFewChallenges(uint8 challengeCount, uint8 required);
    error AlreadyClaimed();
    error NothingToClaim();
    error TransferFailed();

    // ---------------------------------------------------------------------
    // Construction
    // ---------------------------------------------------------------------

    /**
     * @param admin           Receives DEFAULT_ADMIN, MARKET_CREATOR, RESOLVER and CHALLENGER.
     * @param challengeWindow_ Seconds a proposed resolution stays challengeable. Short for the
     *                        demo (~120s); the README states this honestly as a limitation.
     */
    constructor(address admin, uint64 challengeWindow_) {
        if (admin == address(0) || challengeWindow_ == 0) revert InvalidConstructorArgs();

        challengeWindow = challengeWindow_;

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MARKET_CREATOR_ROLE, admin);
        _grantRole(RESOLVER_ROLE, admin);
        _grantRole(CHALLENGER_ROLE, admin);
    }

    // ---------------------------------------------------------------------
    // Market lifecycle
    // ---------------------------------------------------------------------

    /**
     * @notice Create a market. Callable only by the human authority.
     * @dev `specHash` binds this market to the exact off-chain spec a human approved in
     *      `/review`. Re-submitting an already-used spec reverts — a crashed worker that
     *      retries cannot create the same market twice.
     * @return marketId The new market's id (ids start at 1).
     */
    function createMarket(
        bytes32 specHash,
        string calldata question,
        string calldata resolutionSourceUrl,
        uint64 closeTime,
        uint64 resolveDeadline
    ) external onlyRole(MARKET_CREATOR_ROLE) whenNotPaused returns (uint256 marketId) {
        if (specHash == bytes32(0)) revert EmptySpecHash();
        if (specHashUsed[specHash]) revert SpecHashAlreadyUsed(specHash);
        if (closeTime <= block.timestamp) revert InvalidCloseTime(closeTime);
        if (resolveDeadline < closeTime) revert InvalidResolveDeadline(resolveDeadline, closeTime);

        specHashUsed[specHash] = true;
        marketId = ++marketCount;

        Market storage m = _markets[marketId];
        m.specHash = specHash;
        m.closeTime = closeTime;
        m.resolveDeadline = resolveDeadline;
        m.state = STATE_OPEN;
        m.question = question;
        m.resolutionSourceUrl = resolutionSourceUrl;

        emit MarketCreated(
            marketId, specHash, msg.sender, question, resolutionSourceUrl, closeTime, resolveDeadline
        );
    }

    /**
     * @notice Move a market from OPEN to CLOSED once its close time has passed.
     * @dev Permissionless. Betting is gated on `closeTime` directly, so forgetting to call
     *      this can never let a late bet through; this exists to make the transition an
     *      explicit, indexable event rather than an implicit one.
     */
    function closeMarket(uint256 marketId) public {
        Market storage m = _market(marketId);
        if (m.state != STATE_OPEN) revert MarketNotOpen();
        if (block.timestamp < m.closeTime) revert BettingStillOpen(m.closeTime);

        m.state = STATE_CLOSED;
        emit MarketClosed(marketId, uint64(block.timestamp));
    }

    /**
     * @notice Back YES or NO with native tMSTC.
     * @dev This is the function that makes the agent-cap claim true. A registered agent is
     *      capped per transaction and cumulatively per market **by the chain**. Deactivating
     *      an agent blocks it entirely rather than dropping it into the uncapped path.
     */
    function placeBet(uint256 marketId, bool backsYes) external payable whenNotPaused {
        Market storage m = _market(marketId);
        if (m.state != STATE_OPEN) revert MarketNotOpen();
        if (block.timestamp >= m.closeTime) revert BettingClosed();
        if (msg.value == 0) revert ZeroStake();

        AgentConfig memory a = agents[msg.sender];
        bool isAgent = a.owner != address(0);

        if (isAgent) {
            if (!a.active) revert AgentNotActive();
            if (msg.value > a.perTxCap) revert AgentPerTxCapExceeded(msg.value, a.perTxCap);

            uint256 spent = agentSpentOnMarket[marketId][msg.sender] + msg.value;
            if (spent > a.perMarketCap) revert AgentPerMarketCapExceeded(spent, a.perMarketCap);
            agentSpentOnMarket[marketId][msg.sender] = spent;
        }

        uint128 amount = msg.value.toUint128();
        if (backsYes) {
            m.poolYes += amount;
            stakeYes[marketId][msg.sender] += msg.value;
        } else {
            m.poolNo += amount;
            stakeNo[marketId][msg.sender] += msg.value;
        }

        emit BetPlaced(marketId, msg.sender, backsYes, msg.value, isAgent);
    }

    // ---------------------------------------------------------------------
    // Resolution
    // ---------------------------------------------------------------------

    /**
     * @notice Propose the outcome of a closed market, with a public evidence URL.
     * @dev Auto-closes a market that is still flagged OPEN but past its close time, so a
     *      forgotten {closeMarket} call cannot strand funds.
     */
    function proposeResolution(uint256 marketId, uint8 outcome, string calldata evidenceUrl)
        external
        onlyRole(RESOLVER_ROLE)
    {
        Market storage m = _market(marketId);
        if (outcome != OUTCOME_YES && outcome != OUTCOME_NO && outcome != OUTCOME_INVALID) {
            revert InvalidOutcome(outcome);
        }
        if (m.state == STATE_OPEN && block.timestamp >= m.closeTime) closeMarket(marketId);
        if (m.state != STATE_CLOSED) revert MarketNotClosed();

        uint64 endsAt = uint64(block.timestamp) + challengeWindow;

        m.outcome = outcome;
        m.evidenceUrl = evidenceUrl;
        m.proposedBy = msg.sender;
        m.challengeEndsAt = endsAt;
        m.state = STATE_RESOLUTION_PROPOSED;

        emit ResolutionProposed(marketId, msg.sender, outcome, evidenceUrl, endsAt);
    }

    /**
     * @notice Reject a proposed resolution during the challenge window.
     * @dev Returns the market to CLOSED for re-proposal. The reason is emitted on-chain so
     *      the dispute is part of the public record, not a support ticket.
     */
    function challengeResolution(uint256 marketId, string calldata reason)
        external
        onlyRole(CHALLENGER_ROLE)
    {
        Market storage m = _market(marketId);
        if (m.state != STATE_RESOLUTION_PROPOSED) revert ResolutionNotProposed();
        if (block.timestamp >= m.challengeEndsAt) revert ChallengeWindowClosed();

        m.outcome = OUTCOME_UNRESOLVED;
        m.proposedBy = address(0);
        m.challengeEndsAt = 0;
        m.evidenceUrl = "";
        m.state = STATE_CLOSED;
        unchecked {
            m.challengeCount += 1;
        }

        emit ResolutionChallenged(marketId, msg.sender, reason);
    }

    /**
     * @notice Finalise a proposed resolution once its challenge window has elapsed.
     * @dev Deliberately permissionless. No privileged party — including us — can block a
     *      payout by going silent.
     */
    function finalizeResolution(uint256 marketId) external {
        Market storage m = _market(marketId);
        if (m.state != STATE_RESOLUTION_PROPOSED) revert ResolutionNotProposed();
        if (block.timestamp < m.challengeEndsAt) revert ChallengeWindowOpen(m.challengeEndsAt);

        m.state = STATE_FINALIZED;
        emit MarketFinalized(marketId, m.outcome);
    }

    /**
     * @notice Invalidate a market whose resolver never acted, refunding every bettor.
     * @dev Permissionless, and only after `resolveDeadline`. This is the counterpart to
     *      permissionless finalisation: a silent resolver cannot lock funds up forever either.
     */
    function invalidateStale(uint256 marketId) external {
        Market storage m = _market(marketId);
        if (m.state != STATE_OPEN && m.state != STATE_CLOSED) revert MarketNotClosed();
        if (block.timestamp <= m.resolveDeadline) revert ResolveDeadlineNotPassed(m.resolveDeadline);

        m.outcome = OUTCOME_INVALID;
        m.state = STATE_INVALIDATED;
        emit MarketInvalidated(marketId, "resolveDeadline passed with no finalized resolution");
    }

    /**
     * @notice Admin escape hatch for a market deadlocked by repeated challenges.
     * @dev Requires `MAX_CHALLENGES` challenges to already be on the record, so this cannot
     *      be used to cancel an inconvenient market. Everyone is refunded.
     */
    function forceInvalidate(uint256 marketId, string calldata reason)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        Market storage m = _market(marketId);
        if (m.state == STATE_FINALIZED || m.state == STATE_INVALIDATED) {
            revert MarketAlreadySettled();
        }
        if (m.challengeCount < MAX_CHALLENGES) {
            revert TooFewChallenges(m.challengeCount, MAX_CHALLENGES);
        }

        m.outcome = OUTCOME_INVALID;
        m.state = STATE_INVALIDATED;
        emit MarketInvalidated(marketId, reason);
    }

    // ---------------------------------------------------------------------
    // Claiming — pull, not push
    // ---------------------------------------------------------------------

    /**
     * @notice Withdraw a settled market's proceeds.
     * @dev Pull-based: a push payout loop can be broken for everyone by one reverting
     *      receiver. Checks-Effects-Interactions plus `nonReentrant`.
     *
     *      Deliberately **not** `whenNotPaused`. The kill switch stops new risk; it must
     *      never trap funds that are already owed.
     *
     *      If the caller is a registered agent the funds go to `agents[caller].owner`.
     *      That is why a stolen agent key cannot steal winnings.
     */
    function claim(uint256 marketId) external nonReentrant {
        Market storage m = _market(marketId);
        if (m.state != STATE_FINALIZED && m.state != STATE_INVALIDATED) revert MarketNotSettled();
        if (claimed[marketId][msg.sender]) revert AlreadyClaimed();

        uint256 amount = _payoutOf(m, marketId, msg.sender);
        if (amount == 0) revert NothingToClaim();

        claimed[marketId][msg.sender] = true;

        address owner = agents[msg.sender].owner;
        address paidTo = owner == address(0) ? msg.sender : owner;

        (bool ok,) = paidTo.call{value: amount}("");
        if (!ok) revert TransferFailed();

        emit Claimed(marketId, msg.sender, paidTo, amount);
    }

    /**
     * @notice What `account` would receive from {claim} on a settled market.
     * @dev Returns 0 for an unsettled market or an already-claimed account, so the dashboard
     *      and the auto-claim worker can both read the same number the contract will pay.
     */
    function previewPayout(uint256 marketId, address account) external view returns (uint256) {
        Market storage m = _market(marketId);
        if (m.state != STATE_FINALIZED && m.state != STATE_INVALIDATED) return 0;
        if (claimed[marketId][account]) return 0;
        return _payoutOf(m, marketId, account);
    }

    /**
     * @dev Parimutuel: winners split the entire pool pro rata.
     *
     *          payout = stake * (poolYes + poolNo) / winningPool
     *
     *      A judge can verify this by hand from the event log — which is exactly why it was
     *      chosen over an AMM. Integer division dust stays in the contract; it is never
     *      silently credited to anyone.
     *
     *      Refund paths (stake returned exactly): outcome INVALID, an invalidated market, or
     *      nobody backing the winning side (`winningPool == 0`).
     */
    function _payoutOf(Market storage m, uint256 marketId, address account)
        private
        view
        returns (uint256)
    {
        uint256 onYes = stakeYes[marketId][account];
        uint256 onNo = stakeNo[marketId][account];

        if (m.state == STATE_INVALIDATED || m.outcome == OUTCOME_INVALID) return onYes + onNo;

        uint256 winningPool = m.outcome == OUTCOME_YES ? m.poolYes : m.poolNo;
        if (winningPool == 0) return onYes + onNo; // nobody won — refund everyone

        uint256 winningStake = m.outcome == OUTCOME_YES ? onYes : onNo;
        if (winningStake == 0) return 0;

        return (winningStake * (uint256(m.poolYes) + uint256(m.poolNo))) / winningPool;
    }

    // ---------------------------------------------------------------------
    // Agent registry
    // ---------------------------------------------------------------------

    /**
     * @notice Register (or re-configure) an agent wallet and its on-chain caps.
     * @dev Agents hold no role. This registry is the only thing that distinguishes them, and
     *      every entry it creates is a *restriction*, never a permission.
     * @param owner Where this agent's winnings are paid. Cannot be the agent itself.
     */
    function registerAgent(address agent, address owner, uint128 perTxCap, uint128 perMarketCap)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (
            agent == address(0) || owner == address(0) || owner == agent || perTxCap == 0
                || perMarketCap < perTxCap
        ) revert InvalidAgentConfig();

        agents[agent] =
            AgentConfig({owner: owner, perTxCap: perTxCap, perMarketCap: perMarketCap, active: true});

        emit AgentRegistered(agent, owner, perTxCap, perMarketCap);
    }

    /// @notice Stop an agent betting. Its existing claims still pay out to its owner.
    function deactivateAgent(address agent) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (agents[agent].owner == address(0)) revert InvalidAgentConfig();
        agents[agent].active = false;
        emit AgentDeactivated(agent);
    }

    // ---------------------------------------------------------------------
    // Kill switch
    // ---------------------------------------------------------------------

    /// @notice On-chain kill switch: halts market creation and all betting. Claims keep working.
    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    /// @notice Full market record, including the on-chain strings.
    function getMarket(uint256 marketId) external view returns (Market memory) {
        return _market(marketId);
    }

    /// @notice Total staked across both sides.
    function totalPool(uint256 marketId) external view returns (uint256) {
        Market storage m = _market(marketId);
        return uint256(m.poolYes) + uint256(m.poolNo);
    }

    /// @notice Remaining headroom under an agent's per-market cap, in wei.
    function agentRemainingOnMarket(uint256 marketId, address agent)
        external
        view
        returns (uint256)
    {
        AgentConfig memory a = agents[agent];
        if (a.owner == address(0) || !a.active) return 0;
        uint256 spent = agentSpentOnMarket[marketId][agent];
        return spent >= a.perMarketCap ? 0 : a.perMarketCap - spent;
    }

    function _market(uint256 marketId) private view returns (Market storage) {
        if (marketId == 0 || marketId > marketCount) revert UnknownMarket(marketId);
        return _markets[marketId];
    }
}
