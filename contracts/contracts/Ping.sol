// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/**
 * @title Ping
 * @notice Toolchain smoke test, NOT part of the AuspeX product.
 *
 * Exists so Phase 0 can prove the whole contract pipeline works end to end —
 * compile (solc 0.8.28 / cancun) -> deploy to MST Testnet -> verify on MSTScan —
 * before `AuspexMarket.sol` is written in Phase 1. Discovering a broken verify
 * flow while debugging a 400-line market contract would be miserable.
 *
 * Safe to delete once AuspexMarket is deployed and verified.
 */
contract Ping {
    /// @notice Number of times ping() has been called.
    uint256 public count;

    /// @notice Who deployed this, and when (block timestamp).
    address public immutable deployer;
    uint64 public immutable deployedAt;

    event Pinged(address indexed caller, uint256 newCount);

    constructor() {
        deployer = msg.sender;
        deployedAt = uint64(block.timestamp);
    }

    /// @notice Increments the counter. Produces a real, verifiable testnet transaction.
    function ping() external returns (uint256) {
        unchecked {
            count += 1;
        }
        emit Pinged(msg.sender, count);
        return count;
    }

    /// @notice Confirms the chain the contract actually landed on.
    function chainId() external view returns (uint256) {
        return block.chainid;
    }
}
