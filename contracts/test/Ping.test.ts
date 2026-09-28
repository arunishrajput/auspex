/**
 * Toolchain smoke test (Phase 0).
 *
 * Proves the Hardhat 3 + mocha + ethers + chai-matchers pipeline actually runs on
 * Node 26 before Phase 1 writes the real AuspexMarket test suite against it.
 */
import { expect } from "chai";
import { network } from "hardhat";

describe("Ping (toolchain smoke test)", () => {
  it("deploys, starts at zero, and increments on ping()", async () => {
    const { ethers } = await network.create();

    const ping = await ethers.deployContract("Ping");
    await ping.waitForDeployment();

    expect(await ping.count()).to.equal(0n);

    await (await ping.ping()).wait();
    expect(await ping.count()).to.equal(1n);

    await (await ping.ping()).wait();
    expect(await ping.count()).to.equal(2n);
  });

  it("emits Pinged with the caller and the new count", async () => {
    const { ethers } = await network.create();
    const [caller] = await ethers.getSigners();

    const ping = await ethers.deployContract("Ping");
    await ping.waitForDeployment();

    await expect(ping.ping())
      .to.emit(ping, "Pinged")
      .withArgs(caller.address, 1n);
  });

  it("records the deployer and a non-zero deployedAt", async () => {
    const { ethers } = await network.create();
    const [deployer] = await ethers.getSigners();

    const ping = await ethers.deployContract("Ping");
    await ping.waitForDeployment();

    expect(await ping.deployer()).to.equal(deployer.address);
    expect(await ping.deployedAt()).to.be.greaterThan(0n);
  });
});
