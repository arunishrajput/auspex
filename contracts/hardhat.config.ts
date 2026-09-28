import type { HardhatUserConfig } from "hardhat/config";
import hardhatToolboxMochaEthers from "@nomicfoundation/hardhat-toolbox-mocha-ethers";
import * as dotenv from "dotenv";

// Secrets live at the repo root in .env.local (git-ignored), never in this package.
dotenv.config({ path: "../.env.local" });

/**
 * MST Testnet — every value below was verified live against the chain on 2026-09-28,
 * not copied from documentation. See docs/ARCHITECTURE.md §1.
 *
 *   chainId  91562037  (0x5752035)   confirmed via eth_chainId + net_version
 *   explorer testnet.mstscan.com     NOT mstscan.com, which indexes a different chain
 *   evm      cancun                  PUSH0/MCOPY/TSTORE verified by eth_call probes
 *
 * NOTE: this is Hardhat 3. Hardhat 2 cannot run on Node 26 (its ts-node dependency
 * crashes), so the MST Vibe Kit's HH2-style `etherscan.customChains` config does not
 * apply here — the same MST-supplied values are expressed via `chainDescriptors` below.
 */
export const MST_TESTNET_CHAIN_ID = 91562037;
export const MST_TESTNET_RPC = "https://testnetrpc.mstblockchain.com";
export const MST_TESTNET_EXPLORER = "https://testnet.mstscan.com";

const config: HardhatUserConfig = {
  plugins: [hardhatToolboxMochaEthers],

  solidity: {
    profiles: {
      default: {
        version: "0.8.28",
        settings: {
          optimizer: { enabled: true, runs: 200 },
          evmVersion: "cancun",
        },
      },
    },
  },

  networks: {
    mstTestnet: {
      type: "http",
      url: MST_TESTNET_RPC,
      chainId: MST_TESTNET_CHAIN_ID,
      accounts: process.env.DEPLOYER_PRIVATE_KEY
        ? [process.env.DEPLOYER_PRIVATE_KEY]
        : [],
    },
  },

  // Tells hardhat-verify where this chain's Blockscout instance lives.
  chainDescriptors: {
    [MST_TESTNET_CHAIN_ID]: {
      name: "MST Testnet",
      blockExplorers: {
        blockscout: {
          name: "MSTScan Testnet",
          url: MST_TESTNET_EXPLORER,
          apiUrl: `${MST_TESTNET_EXPLORER}/api`,
        },
      },
    },
  },

  // MSTScan is Blockscout v9.0.2 with verification enabled and a public API
  // that needs no key. Etherscan and Sourcify are off — neither knows this chain.
  verify: {
    blockscout: { enabled: true },
    etherscan: { enabled: false },
    sourcify: { enabled: false },
  },
};

export default config;
