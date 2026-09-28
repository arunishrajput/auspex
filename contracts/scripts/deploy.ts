/**
 * Deploy AuspeX contracts to MST Testnet.
 *
 *   pnpm --filter contracts deploy:testnet
 *
 * Writes deployments/<network>.json with the address, ABI, constructor args, deploy
 * tx hash and block number. That file is COMMITTED — it contains no secrets and it is
 * what the frontend, the README and the judges read. Every value in it must be real.
 *
 * Hardhat 3 API note: `hre.network.connect()` is deprecated; we use `getOrCreate()`.
 */
import hre from "hardhat";
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEPLOYMENTS_DIR = join(__dirname, "..", "deployments");

/**
 * Seconds a proposed resolution stays challengeable. Immutable once deployed.
 *
 * 120s is short on purpose — a judge has to be able to watch a market go from resolved to
 * paid out inside a demo. The README states this plainly as a limitation rather than
 * pretending it is a production-grade dispute period.
 */
const CHALLENGE_WINDOW_SECONDS = 120;

/** Contracts to deploy, in order. `deployer` is the address that will hold the roles. */
function toDeploy(deployer: string): Array<{ name: string; args: unknown[] }> {
  return [{ name: "AuspexMarket", args: [deployer, CHALLENGE_WINDOW_SECONDS] }];
}

type DeployRecord = {
  address: string;
  deployTxHash: string;
  blockNumber: number;
  constructorArguments: unknown[];
  abi: unknown;
};

async function main(): Promise<void> {
  const networkName = process.env.HARDHAT_NETWORK ?? "mstTestnet";

  if (!process.env.DEPLOYER_PRIVATE_KEY) {
    throw new Error(
      "DEPLOYER_PRIVATE_KEY is not set.\n" +
        "  1. cp .env.example .env.local\n" +
        "  2. pnpm wallets:new   (generates an address + key)\n" +
        "  3. paste the key into .env.local\n" +
        "  4. fund the address at https://faucet.masterstroke.academy",
    );
  }

  const connection = await hre.network.getOrCreate(networkName);
  const { ethers } = connection;

  const [deployer] = await ethers.getSigners();
  const chainId = (await ethers.provider.getNetwork()).chainId;
  const balance = await ethers.provider.getBalance(deployer.address);

  console.log(`\nNetwork  : ${networkName}  (chainId ${chainId})`);
  console.log(`Deployer : ${deployer.address}`);
  console.log(`Balance  : ${ethers.formatEther(balance)} tMSTC\n`);

  // Guard against deploying to the wrong chain by accident.
  if (networkName === "mstTestnet" && chainId !== 91562037n) {
    throw new Error(
      `Refusing to deploy: expected chainId 91562037 (MST Testnet), got ${chainId}.`,
    );
  }

  if (balance === 0n) {
    throw new Error(
      `Deployer ${deployer.address} has zero balance.\n` +
        "Fund it at https://faucet.masterstroke.academy and retry.",
    );
  }

  const records: Record<string, DeployRecord> = {};

  for (const { name, args } of toDeploy(deployer.address)) {
    console.log(`Deploying ${name}...`);
    const factory = await ethers.getContractFactory(name);
    const contract = await factory.deploy(...args);
    await contract.waitForDeployment();

    const address = await contract.getAddress();
    const tx = contract.deploymentTransaction();
    if (tx === null) throw new Error(`${name}: no deployment transaction returned`);
    const receipt = await tx.wait();
    if (receipt === null) throw new Error(`${name}: no deployment receipt`);

    const artifact = await hre.artifacts.readArtifact(name);

    records[name] = {
      address,
      deployTxHash: tx.hash,
      blockNumber: receipt.blockNumber,
      constructorArguments: args,
      abi: artifact.abi,
    };

    console.log(`  address : ${address}`);
    console.log(`  tx      : ${tx.hash}`);
    console.log(`  block   : ${receipt.blockNumber}`);
    console.log(`  explorer: https://testnet.mstscan.com/address/${address}\n`);
  }

  // Merge with any existing record so re-deploying one contract does not wipe others.
  if (!existsSync(DEPLOYMENTS_DIR)) mkdirSync(DEPLOYMENTS_DIR, { recursive: true });
  const outFile = join(DEPLOYMENTS_DIR, `${networkName}.json`);
  const existing = existsSync(outFile)
    ? JSON.parse(readFileSync(outFile, "utf8"))
    : { network: networkName, chainId: Number(chainId), contracts: {} };

  const merged = {
    network: networkName,
    chainId: Number(chainId),
    explorer: "https://testnet.mstscan.com",
    deployedAt: new Date().toISOString(),
    contracts: { ...(existing.contracts ?? {}), ...records },
  };

  writeFileSync(outFile, `${JSON.stringify(merged, null, 2)}\n`);
  console.log(`Wrote ${outFile}`);
  console.log(`\nNext: pnpm --filter contracts verify:testnet\n`);

  await connection.close();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
