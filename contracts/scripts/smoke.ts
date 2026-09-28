/**
 * Post-deploy smoke test against the REAL MST Testnet deployment.
 *
 *   pnpm --filter contracts smoke:testnet
 *
 * The unit suite proves the contract's logic against a simulated chain. This proves the
 * *deployment* is real and usable: that the roles landed on the deployer, that a market can
 * be created and bet on from a live signer, and that the state reads back correctly from the
 * public RPC. It produces two real transaction hashes, which Phase 1's exit criteria require.
 *
 * Re-runnable: the spec hash includes a timestamp, so each run creates a distinct market
 * rather than tripping the contract's replay guard.
 */
import hre from "hardhat";
import { keccak256, toUtf8Bytes, formatEther, parseEther } from "ethers";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { AuspexMarket__factory } from "../types/ethers-contracts/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const EXPLORER = "https://testnet.mstscan.com";
const STAKE = parseEther("0.01");

const ROLE_NAMES = [
  "DEFAULT_ADMIN_ROLE",
  "MARKET_CREATOR_ROLE",
  "RESOLVER_ROLE",
  "CHALLENGER_ROLE",
] as const;

/**
 * Pulls ABI-encoded revert data out of an RPC error.
 *
 * The MST Testnet RPC returns custom-error data inside the JSON-RPC error *message*
 * ("execution reverted: 0x594f797d...") instead of the standard `error.data` field, so
 * ethers cannot auto-decode it and `error.revert` comes back null. We check the standard
 * places first and fall back to scraping the message. Phase 5's UI needs this to show
 * "AgentPerTxCapExceeded(attempted, cap)" rather than an anonymous failure.
 */
function extractRevertData(error: unknown): string | undefined {
  const e = error as {
    data?: unknown;
    info?: { error?: { data?: unknown } };
    message?: string;
  };
  if (typeof e.data === "string" && e.data.startsWith("0x")) return e.data;
  const fromInfo = e.info?.error?.data;
  if (typeof fromInfo === "string" && fromInfo.startsWith("0x")) return fromInfo;
  return /0x[0-9a-fA-F]{8,}/.exec(e.message ?? "")?.[0];
}

async function main(): Promise<void> {
  const networkName = process.env.HARDHAT_NETWORK ?? "mstTestnet";
  const file = join(__dirname, "..", "deployments", `${networkName}.json`);
  const record = JSON.parse(readFileSync(file, "utf8")) as {
    contracts: Record<string, { address: string }>;
  };

  const address = record.contracts?.AuspexMarket?.address;
  if (address === undefined) {
    throw new Error(`No AuspexMarket address in ${file}. Run deploy:testnet first.`);
  }

  const connection = await hre.network.getOrCreate(networkName);
  const { ethers } = connection;
  const [deployer] = await ethers.getSigners();
  const auspex = AuspexMarket__factory.connect(address, deployer);

  console.log(`\nAuspexMarket : ${address}`);
  console.log(`Signer       : ${deployer.address}`);
  console.log(`Balance      : ${formatEther(await ethers.provider.getBalance(deployer.address))} tMSTC`);
  console.log(`Challenge win: ${await auspex.challengeWindow()}s\n`);

  // --- 1. Roles actually landed on the deployer, read from the live chain ---------------
  console.log("Roles held by the deployer:");
  for (const name of ROLE_NAMES) {
    const role = await auspex[name]();
    const held = await auspex.hasRole(role, deployer.address);
    console.log(`  ${held ? "✓" : "✖"} ${name}`);
    if (!held) throw new Error(`Deployer does not hold ${name}`);
  }

  // --- 2. Create a market (human-authority path) ----------------------------------------
  // In Phase 4 this object is the human-approved spec from /review and this hash is what
  // binds the on-chain market to it. Here it is a real, self-consistent stand-in.
  const now = Math.floor(Date.now() / 1000);
  const spec = {
    question: "Will AuspeX have a verified contract on MST Testnet before the deadline?",
    resolutionSourceUrl: `${EXPLORER}/address/${address}#code`,
    closeTime: now + 1800,
    resolveDeadline: now + 3600,
    createdAt: now,
  };
  const specHash = keccak256(toUtf8Bytes(JSON.stringify(spec)));

  console.log(`\nCreating market...`);
  console.log(`  specHash: ${specHash}`);

  const createTx = await auspex.createMarket(
    specHash,
    spec.question,
    spec.resolutionSourceUrl,
    spec.closeTime,
    spec.resolveDeadline,
  );
  const createReceipt = await createTx.wait();
  if (createReceipt === null) throw new Error("createMarket: no receipt");

  const marketId = await auspex.marketCount();
  console.log(`  marketId: ${marketId}`);
  console.log(`  tx      : ${createTx.hash}`);
  console.log(`  ${EXPLORER}/tx/${createTx.hash}`);

  // --- 3. Place a bet --------------------------------------------------------------------
  console.log(`\nPlacing a ${formatEther(STAKE)} tMSTC bet on YES...`);
  const betTx = await auspex.placeBet(marketId, true, { value: STAKE });
  const betReceipt = await betTx.wait();
  if (betReceipt === null) throw new Error("placeBet: no receipt");

  console.log(`  tx      : ${betTx.hash}`);
  console.log(`  ${EXPLORER}/tx/${betTx.hash}`);

  // --- 4. Read the state back from the public RPC ----------------------------------------
  const m = await auspex.getMarket(marketId);
  console.log(`\nMarket ${marketId} as the chain now reports it:`);
  console.log(`  question : ${m.question}`);
  console.log(`  specHash : ${m.specHash}`);
  console.log(`  state    : ${m.state} (0=OPEN)`);
  console.log(`  poolYes  : ${formatEther(m.poolYes)} tMSTC`);
  console.log(`  poolNo   : ${formatEther(m.poolNo)} tMSTC`);
  console.log(`  closeTime: ${m.closeTime}`);

  if (m.specHash !== specHash) throw new Error("On-chain specHash does not match the spec");
  if (m.poolYes !== STAKE) throw new Error("On-chain poolYes does not match the bet");

  // --- 5. Prove the replay guard on the live chain, not just in tests --------------------
  console.log(`\nRe-submitting the same specHash (must revert SpecHashAlreadyUsed)...`);
  let replayRejected = false;
  try {
    await auspex.createMarket.staticCall(
      specHash,
      spec.question,
      spec.resolutionSourceUrl,
      spec.closeTime,
      spec.resolveDeadline,
    );
  } catch (error: unknown) {
    const data = extractRevertData(error);
    const decoded = data === undefined ? null : auspex.interface.parseError(data);
    if (decoded?.name !== "SpecHashAlreadyUsed") {
      throw new Error(
        `Expected SpecHashAlreadyUsed, got ${decoded?.name ?? "undecodable revert"} (${data})`,
      );
    }
    console.log(`  ✓ rejected: ${decoded.name}(${decoded.args[0]})`);
    replayRejected = true;
  }
  if (!replayRejected) throw new Error("Replay guard did NOT reject a duplicate specHash");

  console.log(`\nSmoke test passed. Two real transactions:`);
  console.log(`  createMarket  ${EXPLORER}/tx/${createTx.hash}`);
  console.log(`  placeBet      ${EXPLORER}/tx/${betTx.hash}\n`);

  await connection.close();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
