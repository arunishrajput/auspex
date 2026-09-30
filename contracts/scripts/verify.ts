/**
 * Verify deployed contracts on MSTScan (Blockscout v9.0.2).
 *
 *   pnpm --filter contracts verify:testnet
 *
 * Reads deployments/<network>.json and shells out to the `hardhat verify` CLI for each
 * contract. We invoke the CLI rather than the internal task API on purpose: the CLI is
 * the stable, documented surface, so this keeps working across Hardhat 3 minor versions.
 *
 * Verified source is not optional for this project — it is what makes the trust claims
 * in docs/TRUST_MODEL.md auditable by anyone instead of merely asserted.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function main(): void {
  const networkName = process.env.HARDHAT_NETWORK ?? "mstTestnet";
  const file = join(__dirname, "..", "deployments", `${networkName}.json`);

  if (!existsSync(file)) {
    throw new Error(
      `No deployment record at ${file}.\nRun: pnpm --filter contracts deploy:testnet`,
    );
  }

  const record = JSON.parse(readFileSync(file, "utf8")) as {
    contracts: Record<string, { address: string; constructorArguments: unknown[] }>;
  };

  const entries = Object.entries(record.contracts ?? {});
  if (entries.length === 0) throw new Error(`No contracts recorded in ${file}.`);

  let failures = 0;

  for (const [name, info] of entries) {
    console.log(`\nVerifying ${name} at ${info.address} ...`);

    const args = [
      "hardhat",
      "verify",
      "--network",
      networkName,
      info.address,
      ...info.constructorArguments.map(String),
    ];

    const result = spawnSync("npx", args, {
      stdio: "inherit",
      cwd: join(__dirname, ".."),
    });

    if (result.status === 0) {
      console.log(`  ✓ ${name} verified`);
      console.log(`    https://testnet.mstscan.com/address/${info.address}#code`);
    } else {
      // "Already verified" is a success for our purposes; the CLI exits non-zero on it,
      // so surface it rather than silently swallowing a genuine failure.
      console.error(`  ✖ ${name} verification failed (exit ${result.status}).`);
      console.error(
        "    If it says 'already verified', that is fine. Otherwise check that solc " +
          "0.8.28 + evmVersion cancun + optimizer runs 200 match the deployed bytecode.",
      );
      failures += 1;
    }
  }

  if (failures > 0) process.exitCode = 1;
}

try {
  main();
} catch (error: unknown) {
  console.error(error);
  process.exitCode = 1;
}
