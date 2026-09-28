// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AuspexMarket} from "../AuspexMarket.sol";

/**
 * @title ReentrantClaimer
 * @notice TEST-ONLY attacker. Never deployed to MST Testnet.
 *
 * Bets like a normal participant, then tries to re-enter {AuspexMarket-claim} from its
 * `receive()` while the first claim is still executing. The test asserts it gets paid
 * exactly once — proving `nonReentrant` plus Checks-Effects-Interactions actually hold,
 * rather than us asserting they do in a comment.
 */
contract ReentrantClaimer {
    AuspexMarket public immutable market;

    /// @notice Incremented every time `receive()` fires during an attack.
    uint256 public reentryAttempts;

    /// @notice Set if the re-entrant claim ever succeeds. Must stay false.
    bool public reentrySucceeded;

    uint256 private _targetMarketId;
    bool private _attacking;

    constructor(AuspexMarket market_) {
        market = market_;
    }

    function bet(uint256 marketId, bool backsYes) external payable {
        market.placeBet{value: msg.value}(marketId, backsYes);
    }

    function attack(uint256 marketId) external {
        _targetMarketId = marketId;
        _attacking = true;
        market.claim(marketId);
        _attacking = false;
    }

    receive() external payable {
        if (!_attacking) return;
        _attacking = false; // one re-entry attempt is enough to prove the guard
        reentryAttempts += 1;

        // Must revert inside the guard. Swallowed so the outer claim still succeeds and the
        // test can assert "paid exactly once" rather than merely "the whole thing reverted".
        try market.claim(_targetMarketId) {
            reentrySucceeded = true;
        } catch {}
    }
}
