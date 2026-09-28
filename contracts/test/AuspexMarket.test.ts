/**
 * AuspexMarket — full test suite (Phase 1).
 *
 * Covers the test matrix in docs/CONTRACTS.md §12. Every `revert` path in the contract has
 * a test asserting the *specific* custom error, because "it reverted" is not evidence that
 * the right guard fired.
 *
 * The tests that matter most to the submission's thesis:
 *   - "one wei over the cap reverts"        — the chain, not our server, enforces agent limits
 *   - "a deactivated agent cannot bet"      — deactivation must not drop an agent into the
 *                                             uncapped path, which would invert its meaning
 *   - "an agent cannot create or resolve"   — agent wallets hold no role at all
 *   - "winnings are paid to the owner"      — a stolen agent key cannot steal funds
 *   - "claim still works while paused"      — the kill switch stops new risk, never traps funds
 */
import { expect } from "chai";
import { network } from "hardhat";
import { id, parseEther, ZeroAddress, ZeroHash } from "ethers";
import type { NetworkConnection } from "hardhat/types/network";
import type { AuspexMarket, ReentrantClaimer } from "../types/ethers-contracts/index.js";

const CHALLENGE_WINDOW = 120;

const STATE_OPEN = 0n;
const STATE_CLOSED = 1n;
const STATE_RESOLUTION_PROPOSED = 2n;
const STATE_FINALIZED = 3n;
const STATE_INVALIDATED = 4n;

const OUTCOME_UNRESOLVED = 0n;
const OUTCOME_YES = 1n;
const OUTCOME_NO = 2n;
const OUTCOME_INVALID = 3n;

const PER_TX_CAP = parseEther("0.5");
const PER_MARKET_CAP = parseEther("1");

const QUESTION = "Will the ECB cut rates at its next scheduled meeting?";
const SOURCE_URL = "https://www.ecb.europa.eu/press/pr/date/html/index.en.html";
const EVIDENCE_URL = "https://www.ecb.europa.eu/press/pr/date/2026/html/decision.en.html";

/**
 * Deploys AuspexMarket, separates the roles onto distinct signers (so role tests prove
 * something), registers one capped agent, and hands back a helper for opening markets.
 */
async function deployFixture(connection: NetworkConnection) {
  const { ethers, networkHelpers } = connection;

  const [admin, resolver, challenger, alice, bob, carol, agentOwner, agent, outsider] =
    await ethers.getSigners();

  // typechain still emits a Hardhat-2-shaped module augmentation, so `deployContract` is not
  // overload-resolved to the typed contract under Hardhat 3. Naming the generated type here is
  // what keeps `auspex.connect(alice).placeBet(...)` type-checked rather than `any`-shaped.
  const auspex = (await ethers.deployContract("AuspexMarket", [
    admin.address,
    CHALLENGE_WINDOW,
  ])) as unknown as AuspexMarket;
  await auspex.waitForDeployment();

  await (await auspex.grantRole(await auspex.RESOLVER_ROLE(), resolver.address)).wait();
  await (await auspex.grantRole(await auspex.CHALLENGER_ROLE(), challenger.address)).wait();
  await (
    await auspex.registerAgent(agent.address, agentOwner.address, PER_TX_CAP, PER_MARKET_CAP)
  ).wait();

  /** Opens a market that closes in an hour, with an hour after that to resolve. */
  async function openMarket(spec = "spec-default") {
    const now = await networkHelpers.time.latest();
    const closeTime = now + 3600;
    const resolveDeadline = closeTime + 3600;
    const specHash = id(spec);

    await (
      await auspex.createMarket(specHash, QUESTION, SOURCE_URL, closeTime, resolveDeadline)
    ).wait();

    return { marketId: await auspex.marketCount(), closeTime, resolveDeadline, specHash };
  }

  /** Mines forward to just past a market's close time. */
  async function closeTimePasses(closeTime: number) {
    await networkHelpers.time.increaseTo(closeTime + 1);
  }

  return {
    ethers,
    networkHelpers,
    auspex,
    admin,
    resolver,
    challenger,
    alice,
    bob,
    carol,
    agentOwner,
    agent,
    outsider,
    openMarket,
    closeTimePasses,
  };
}

describe("AuspexMarket", () => {
  let connection: NetworkConnection;

  before(async () => {
    connection = await network.create();
  });

  const load = () => connection.networkHelpers.loadFixture(deployFixture);

  // -------------------------------------------------------------------
  // Deployment & roles
  // -------------------------------------------------------------------

  describe("deployment and roles", () => {
    it("grants the deployer admin, market-creator, resolver and challenger", async () => {
      const { auspex, admin } = await load();

      expect(await auspex.hasRole(await auspex.DEFAULT_ADMIN_ROLE(), admin.address)).to.equal(true);
      expect(await auspex.hasRole(await auspex.MARKET_CREATOR_ROLE(), admin.address)).to.equal(true);
      expect(await auspex.hasRole(await auspex.RESOLVER_ROLE(), admin.address)).to.equal(true);
      expect(await auspex.hasRole(await auspex.CHALLENGER_ROLE(), admin.address)).to.equal(true);
    });

    it("records an immutable challenge window and starts with no markets", async () => {
      const { auspex } = await load();

      expect(await auspex.challengeWindow()).to.equal(BigInt(CHALLENGE_WINDOW));
      expect(await auspex.marketCount()).to.equal(0n);
      expect(await auspex.MAX_CHALLENGES()).to.equal(3n);
    });

    it("rejects a zero admin or a zero challenge window at construction", async () => {
      const { ethers, admin } = await load();
      const factory = await ethers.getContractFactory("AuspexMarket");

      await expect(factory.deploy(ZeroAddress, CHALLENGE_WINDOW)).to.be.revertedWithCustomError(
        factory,
        "InvalidConstructorArgs",
      );
      await expect(factory.deploy(admin.address, 0)).to.be.revertedWithCustomError(
        factory,
        "InvalidConstructorArgs",
      );
    });

    it("gives an agent wallet no role whatsoever", async () => {
      const { auspex, agent } = await load();

      expect(await auspex.hasRole(await auspex.DEFAULT_ADMIN_ROLE(), agent.address)).to.equal(false);
      expect(await auspex.hasRole(await auspex.MARKET_CREATOR_ROLE(), agent.address)).to.equal(
        false,
      );
      expect(await auspex.hasRole(await auspex.RESOLVER_ROLE(), agent.address)).to.equal(false);
      expect(await auspex.hasRole(await auspex.CHALLENGER_ROLE(), agent.address)).to.equal(false);
    });
  });

  // -------------------------------------------------------------------
  // createMarket
  // -------------------------------------------------------------------

  describe("createMarket", () => {
    it("stores the spec and emits MarketCreated", async () => {
      const { auspex, admin, networkHelpers } = await load();

      const now = await networkHelpers.time.latest();
      const closeTime = now + 3600;
      const resolveDeadline = closeTime + 3600;
      const specHash = id("spec-emit");

      await expect(
        auspex.createMarket(specHash, QUESTION, SOURCE_URL, closeTime, resolveDeadline),
      )
        .to.emit(auspex, "MarketCreated")
        .withArgs(1n, specHash, admin.address, QUESTION, SOURCE_URL, closeTime, resolveDeadline);

      const m = await auspex.getMarket(1n);
      expect(m.specHash).to.equal(specHash);
      expect(m.question).to.equal(QUESTION);
      expect(m.resolutionSourceUrl).to.equal(SOURCE_URL);
      expect(m.closeTime).to.equal(BigInt(closeTime));
      expect(m.resolveDeadline).to.equal(BigInt(resolveDeadline));
      expect(m.state).to.equal(STATE_OPEN);
      expect(m.outcome).to.equal(OUTCOME_UNRESOLVED);
      expect(await auspex.specHashUsed(specHash)).to.equal(true);
      expect(await auspex.marketCount()).to.equal(1n);
    });

    it("reverts for a caller without MARKET_CREATOR_ROLE", async () => {
      const { auspex, outsider, networkHelpers } = await load();
      const closeTime = (await networkHelpers.time.latest()) + 3600;

      await expect(
        auspex
          .connect(outsider)
          .createMarket(id("spec-x"), QUESTION, SOURCE_URL, closeTime, closeTime + 3600),
      ).to.be.revertedWithCustomError(auspex, "AccessControlUnauthorizedAccount");
    });

    it("rejects a replayed specHash — a retrying worker cannot create the market twice", async () => {
      const { auspex, networkHelpers, openMarket } = await load();
      const { specHash } = await openMarket("spec-replay");

      const closeTime = (await networkHelpers.time.latest()) + 3600;
      await expect(
        auspex.createMarket(specHash, QUESTION, SOURCE_URL, closeTime, closeTime + 3600),
      )
        .to.be.revertedWithCustomError(auspex, "SpecHashAlreadyUsed")
        .withArgs(specHash);

      expect(await auspex.marketCount()).to.equal(1n);
    });

    it("rejects an empty specHash", async () => {
      const { auspex, networkHelpers } = await load();
      const closeTime = (await networkHelpers.time.latest()) + 3600;

      await expect(
        auspex.createMarket(ZeroHash, QUESTION, SOURCE_URL, closeTime, closeTime + 3600),
      ).to.be.revertedWithCustomError(auspex, "EmptySpecHash");
    });

    it("rejects a close time in the past and a resolve deadline before close", async () => {
      const { auspex, networkHelpers } = await load();
      const now = await networkHelpers.time.latest();

      await expect(auspex.createMarket(id("s1"), QUESTION, SOURCE_URL, now - 1, now + 7200))
        .to.be.revertedWithCustomError(auspex, "InvalidCloseTime")
        .withArgs(now - 1);

      await expect(auspex.createMarket(id("s2"), QUESTION, SOURCE_URL, now + 3600, now + 100))
        .to.be.revertedWithCustomError(auspex, "InvalidResolveDeadline")
        .withArgs(now + 100, now + 3600);
    });

    it("cannot create a market while paused", async () => {
      const { auspex, networkHelpers } = await load();
      await (await auspex.pause()).wait();

      const closeTime = (await networkHelpers.time.latest()) + 3600;
      await expect(
        auspex.createMarket(id("s3"), QUESTION, SOURCE_URL, closeTime, closeTime + 3600),
      ).to.be.revertedWithCustomError(auspex, "EnforcedPause");
    });
  });

  // -------------------------------------------------------------------
  // Betting
  // -------------------------------------------------------------------

  describe("placeBet", () => {
    it("updates the pool and the caller's stake, and flags a non-agent bettor", async () => {
      const { auspex, alice, bob, openMarket } = await load();
      const { marketId } = await openMarket("spec-bet");

      await expect(auspex.connect(alice).placeBet(marketId, true, { value: parseEther("2") }))
        .to.emit(auspex, "BetPlaced")
        .withArgs(marketId, alice.address, true, parseEther("2"), false);

      await (
        await auspex.connect(bob).placeBet(marketId, false, { value: parseEther("3") })
      ).wait();

      const m = await auspex.getMarket(marketId);
      expect(m.poolYes).to.equal(parseEther("2"));
      expect(m.poolNo).to.equal(parseEther("3"));
      expect(await auspex.stakeYes(marketId, alice.address)).to.equal(parseEther("2"));
      expect(await auspex.stakeNo(marketId, bob.address)).to.equal(parseEther("3"));
      expect(await auspex.totalPool(marketId)).to.equal(parseEther("5"));
    });

    it("accumulates repeated bets from the same account on the same side", async () => {
      const { auspex, alice, openMarket } = await load();
      const { marketId } = await openMarket("spec-accum");

      await (await auspex.connect(alice).placeBet(marketId, true, { value: 100n })).wait();
      await (await auspex.connect(alice).placeBet(marketId, true, { value: 250n })).wait();

      expect(await auspex.stakeYes(marketId, alice.address)).to.equal(350n);
      expect((await auspex.getMarket(marketId)).poolYes).to.equal(350n);
    });

    it("rejects a zero stake", async () => {
      const { auspex, alice, openMarket } = await load();
      const { marketId } = await openMarket("spec-zero");

      await expect(
        auspex.connect(alice).placeBet(marketId, true, { value: 0 }),
      ).to.be.revertedWithCustomError(auspex, "ZeroStake");
    });

    it("rejects a bet after close time, even before anyone calls closeMarket", async () => {
      const { auspex, alice, openMarket, closeTimePasses } = await load();
      const { marketId, closeTime } = await openMarket("spec-late");

      await closeTimePasses(closeTime);

      expect((await auspex.getMarket(marketId)).state).to.equal(STATE_OPEN);
      await expect(
        auspex.connect(alice).placeBet(marketId, true, { value: parseEther("1") }),
      ).to.be.revertedWithCustomError(auspex, "BettingClosed");
    });

    it("rejects a bet on a market that is no longer OPEN", async () => {
      const { auspex, alice, openMarket, closeTimePasses } = await load();
      const { marketId, closeTime } = await openMarket("spec-closed");

      await closeTimePasses(closeTime);
      await (await auspex.closeMarket(marketId)).wait();

      await expect(
        auspex.connect(alice).placeBet(marketId, true, { value: parseEther("1") }),
      ).to.be.revertedWithCustomError(auspex, "MarketNotOpen");
    });

    it("rejects a bet on a market id that does not exist", async () => {
      const { auspex, alice } = await load();

      await expect(auspex.connect(alice).placeBet(0n, true, { value: 1n }))
        .to.be.revertedWithCustomError(auspex, "UnknownMarket")
        .withArgs(0n);
      await expect(auspex.connect(alice).placeBet(99n, true, { value: 1n }))
        .to.be.revertedWithCustomError(auspex, "UnknownMarket")
        .withArgs(99n);
    });
  });

  // -------------------------------------------------------------------
  // Agent caps — the headline defence
  // -------------------------------------------------------------------

  describe("agent caps", () => {
    it("registers an agent with its caps and owner", async () => {
      const { auspex, agent, agentOwner, alice, bob } = await load();

      const config = await auspex.agents(agent.address);
      expect(config.owner).to.equal(agentOwner.address);
      expect(config.perTxCap).to.equal(PER_TX_CAP);
      expect(config.perMarketCap).to.equal(PER_MARKET_CAP);
      expect(config.active).to.equal(true);

      await expect(auspex.registerAgent(alice.address, bob.address, 10n, 20n))
        .to.emit(auspex, "AgentRegistered")
        .withArgs(alice.address, bob.address, 10n, 20n);
    });

    it("rejects nonsensical agent configurations", async () => {
      const { auspex, agent, agentOwner } = await load();

      // zero agent, zero owner, agent owning itself, zero cap, perMarketCap below perTxCap
      await expect(
        auspex.registerAgent(ZeroAddress, agentOwner.address, 1n, 1n),
      ).to.be.revertedWithCustomError(auspex, "InvalidAgentConfig");
      await expect(
        auspex.registerAgent(agent.address, ZeroAddress, 1n, 1n),
      ).to.be.revertedWithCustomError(auspex, "InvalidAgentConfig");
      await expect(
        auspex.registerAgent(agent.address, agent.address, 1n, 1n),
      ).to.be.revertedWithCustomError(auspex, "InvalidAgentConfig");
      await expect(
        auspex.registerAgent(agent.address, agentOwner.address, 0n, 1n),
      ).to.be.revertedWithCustomError(auspex, "InvalidAgentConfig");
      await expect(
        auspex.registerAgent(agent.address, agentOwner.address, 10n, 9n),
      ).to.be.revertedWithCustomError(auspex, "InvalidAgentConfig");
    });

    it("only the admin can register or deactivate an agent", async () => {
      const { auspex, outsider, agent, agentOwner } = await load();

      await expect(
        auspex.connect(outsider).registerAgent(agent.address, agentOwner.address, 1n, 1n),
      ).to.be.revertedWithCustomError(auspex, "AccessControlUnauthorizedAccount");
      await expect(
        auspex.connect(outsider).deactivateAgent(agent.address),
      ).to.be.revertedWithCustomError(auspex, "AccessControlUnauthorizedAccount");
    });

    it("allows a bet of exactly the per-tx cap", async () => {
      const { auspex, agent, openMarket } = await load();
      const { marketId } = await openMarket("spec-atcap");

      await expect(auspex.connect(agent).placeBet(marketId, true, { value: PER_TX_CAP }))
        .to.emit(auspex, "BetPlaced")
        .withArgs(marketId, agent.address, true, PER_TX_CAP, true);

      expect(await auspex.agentSpentOnMarket(marketId, agent.address)).to.equal(PER_TX_CAP);
    });

    it("reverts one wei over the per-tx cap", async () => {
      const { auspex, agent, openMarket } = await load();
      const { marketId } = await openMarket("spec-onewei");

      const overBy1 = PER_TX_CAP + 1n;
      await expect(auspex.connect(agent).placeBet(marketId, true, { value: overBy1 }))
        .to.be.revertedWithCustomError(auspex, "AgentPerTxCapExceeded")
        .withArgs(overBy1, PER_TX_CAP);

      expect(await auspex.agentSpentOnMarket(marketId, agent.address)).to.equal(0n);
      expect((await auspex.getMarket(marketId)).poolYes).to.equal(0n);
    });

    it("reverts far over the per-tx cap", async () => {
      const { auspex, agent, openMarket } = await load();
      const { marketId } = await openMarket("spec-farover");

      const huge = parseEther("100");
      await expect(auspex.connect(agent).placeBet(marketId, true, { value: huge }))
        .to.be.revertedWithCustomError(auspex, "AgentPerTxCapExceeded")
        .withArgs(huge, PER_TX_CAP);
    });

    it("enforces the cumulative per-market cap across several in-cap bets", async () => {
      const { auspex, agent, openMarket } = await load();
      const { marketId } = await openMarket("spec-cumulative");

      // Two bets of exactly the per-tx cap reach the per-market cap exactly.
      await (await auspex.connect(agent).placeBet(marketId, true, { value: PER_TX_CAP })).wait();
      expect(await auspex.agentRemainingOnMarket(marketId, agent.address)).to.equal(PER_TX_CAP);

      await (await auspex.connect(agent).placeBet(marketId, false, { value: PER_TX_CAP })).wait();
      expect(await auspex.agentSpentOnMarket(marketId, agent.address)).to.equal(PER_MARKET_CAP);
      expect(await auspex.agentRemainingOnMarket(marketId, agent.address)).to.equal(0n);

      // A third bet — individually well within the per-tx cap — is refused by the market cap.
      await expect(auspex.connect(agent).placeBet(marketId, true, { value: 1n }))
        .to.be.revertedWithCustomError(auspex, "AgentPerMarketCapExceeded")
        .withArgs(PER_MARKET_CAP + 1n, PER_MARKET_CAP);
    });

    it("caps are per market, so a fresh market restores the agent's headroom", async () => {
      const { auspex, agent, openMarket } = await load();
      const first = await openMarket("spec-m1");
      const second = await openMarket("spec-m2");

      await (
        await auspex.connect(agent).placeBet(first.marketId, true, { value: PER_MARKET_CAP / 2n })
      ).wait();

      expect(await auspex.agentRemainingOnMarket(second.marketId, agent.address)).to.equal(
        PER_MARKET_CAP,
      );
      await expect(
        auspex.connect(agent).placeBet(second.marketId, true, { value: PER_TX_CAP }),
      ).to.emit(auspex, "BetPlaced");
    });

    it("blocks a deactivated agent entirely — deactivation must not un-cap it", async () => {
      const { auspex, agent, openMarket } = await load();
      const { marketId } = await openMarket("spec-deactivated");

      await expect(auspex.deactivateAgent(agent.address))
        .to.emit(auspex, "AgentDeactivated")
        .withArgs(agent.address);

      // The dangerous bug this guards against: falling through to the uncapped "anyone" path.
      await expect(
        auspex.connect(agent).placeBet(marketId, true, { value: parseEther("50") }),
      ).to.be.revertedWithCustomError(auspex, "AgentNotActive");
      await expect(
        auspex.connect(agent).placeBet(marketId, true, { value: 1n }),
      ).to.be.revertedWithCustomError(auspex, "AgentNotActive");

      expect(await auspex.agentRemainingOnMarket(marketId, agent.address)).to.equal(0n);
    });

    it("deactivating an unregistered address reverts", async () => {
      const { auspex, outsider } = await load();

      await expect(auspex.deactivateAgent(outsider.address)).to.be.revertedWithCustomError(
        auspex,
        "InvalidAgentConfig",
      );
    });

    it("an agent can neither create a market, propose, challenge, pause, nor register agents", async () => {
      const { auspex, agent, networkHelpers, openMarket, closeTimePasses } = await load();
      const { marketId, closeTime } = await openMarket("spec-agent-powerless");
      const later = (await networkHelpers.time.latest()) + 7200;

      await expect(
        auspex.connect(agent).createMarket(id("agent-spec"), QUESTION, SOURCE_URL, later, later),
      ).to.be.revertedWithCustomError(auspex, "AccessControlUnauthorizedAccount");

      await closeTimePasses(closeTime);
      await (await auspex.closeMarket(marketId)).wait();

      await expect(
        auspex.connect(agent).proposeResolution(marketId, OUTCOME_YES, EVIDENCE_URL),
      ).to.be.revertedWithCustomError(auspex, "AccessControlUnauthorizedAccount");
      await expect(
        auspex.connect(agent).challengeResolution(marketId, "nope"),
      ).to.be.revertedWithCustomError(auspex, "AccessControlUnauthorizedAccount");
      await expect(auspex.connect(agent).pause()).to.be.revertedWithCustomError(
        auspex,
        "AccessControlUnauthorizedAccount",
      );
      await expect(
        auspex.connect(agent).registerAgent(agent.address, agent.address, 1n, 1n),
      ).to.be.revertedWithCustomError(auspex, "AccessControlUnauthorizedAccount");
      await expect(
        auspex.connect(agent).forceInvalidate(marketId, "mine now"),
      ).to.be.revertedWithCustomError(auspex, "AccessControlUnauthorizedAccount");
    });
  });

  // -------------------------------------------------------------------
  // closeMarket
  // -------------------------------------------------------------------

  describe("closeMarket", () => {
    it("is permissionless once close time has passed", async () => {
      const { auspex, outsider, openMarket, closeTimePasses } = await load();
      const { marketId, closeTime } = await openMarket("spec-close");

      await closeTimePasses(closeTime);
      await expect(auspex.connect(outsider).closeMarket(marketId)).to.emit(auspex, "MarketClosed");

      expect((await auspex.getMarket(marketId)).state).to.equal(STATE_CLOSED);
    });

    it("reverts before close time and on a market already closed", async () => {
      const { auspex, openMarket, closeTimePasses } = await load();
      const { marketId, closeTime } = await openMarket("spec-close2");

      await expect(auspex.closeMarket(marketId))
        .to.be.revertedWithCustomError(auspex, "BettingStillOpen")
        .withArgs(closeTime);

      await closeTimePasses(closeTime);
      await (await auspex.closeMarket(marketId)).wait();

      await expect(auspex.closeMarket(marketId)).to.be.revertedWithCustomError(
        auspex,
        "MarketNotOpen",
      );
    });
  });

  // -------------------------------------------------------------------
  // Resolution, challenge, finalize
  // -------------------------------------------------------------------

  describe("resolution", () => {
    async function closedMarket(spec: string) {
      const ctx = await load();
      const { marketId, closeTime, resolveDeadline } = await ctx.openMarket(spec);
      await (
        await ctx.auspex.connect(ctx.alice).placeBet(marketId, true, { value: parseEther("1") })
      ).wait();
      await (
        await ctx.auspex.connect(ctx.bob).placeBet(marketId, false, { value: parseEther("1") })
      ).wait();
      await ctx.closeTimePasses(closeTime);
      await (await ctx.auspex.closeMarket(marketId)).wait();
      return { ...ctx, marketId, closeTime, resolveDeadline };
    }

    it("records the outcome, evidence and challenge deadline", async () => {
      const { auspex, resolver, networkHelpers, marketId } = await closedMarket("spec-res1");

      const tx = await auspex.connect(resolver).proposeResolution(marketId, 1, EVIDENCE_URL);
      await tx.wait();
      const endsAt = BigInt((await networkHelpers.time.latest()) + CHALLENGE_WINDOW);

      const m = await auspex.getMarket(marketId);
      expect(m.state).to.equal(STATE_RESOLUTION_PROPOSED);
      expect(m.outcome).to.equal(OUTCOME_YES);
      expect(m.evidenceUrl).to.equal(EVIDENCE_URL);
      expect(m.proposedBy).to.equal(resolver.address);
      expect(m.challengeEndsAt).to.equal(endsAt);

      await expect(tx)
        .to.emit(auspex, "ResolutionProposed")
        .withArgs(marketId, resolver.address, OUTCOME_YES, EVIDENCE_URL, endsAt);
    });

    it("rejects a non-resolver, an unresolved/unknown outcome, and an open market", async () => {
      const { auspex, outsider, resolver, marketId } = await closedMarket("spec-res2");

      await expect(
        auspex.connect(outsider).proposeResolution(marketId, 1, EVIDENCE_URL),
      ).to.be.revertedWithCustomError(auspex, "AccessControlUnauthorizedAccount");

      await expect(auspex.connect(resolver).proposeResolution(marketId, 0, EVIDENCE_URL))
        .to.be.revertedWithCustomError(auspex, "InvalidOutcome")
        .withArgs(0);
      await expect(auspex.connect(resolver).proposeResolution(marketId, 4, EVIDENCE_URL))
        .to.be.revertedWithCustomError(auspex, "InvalidOutcome")
        .withArgs(4);
    });

    it("cannot propose a resolution while betting is still open", async () => {
      const { auspex, resolver, openMarket } = await load();
      const { marketId } = await openMarket("spec-res3");

      await expect(
        auspex.connect(resolver).proposeResolution(marketId, 1, EVIDENCE_URL),
      ).to.be.revertedWithCustomError(auspex, "MarketNotClosed");
    });

    it("auto-closes a market nobody bothered to close, so funds cannot strand", async () => {
      const { auspex, resolver, openMarket, closeTimePasses } = await load();
      const { marketId, closeTime } = await openMarket("spec-autoclose");
      await closeTimePasses(closeTime);

      expect((await auspex.getMarket(marketId)).state).to.equal(STATE_OPEN);
      await expect(
        auspex.connect(resolver).proposeResolution(marketId, 1, EVIDENCE_URL),
      ).to.emit(auspex, "MarketClosed");

      expect((await auspex.getMarket(marketId)).state).to.equal(STATE_RESOLUTION_PROPOSED);
    });

    it("cannot propose twice without a challenge in between", async () => {
      const { auspex, resolver, marketId } = await closedMarket("spec-res4");

      await (
        await auspex.connect(resolver).proposeResolution(marketId, 1, EVIDENCE_URL)
      ).wait();
      await expect(
        auspex.connect(resolver).proposeResolution(marketId, 2, EVIDENCE_URL),
      ).to.be.revertedWithCustomError(auspex, "MarketNotClosed");
    });
  });

  describe("challenge window", () => {
    async function proposedMarket(spec: string) {
      const ctx = await load();
      const { marketId, closeTime, resolveDeadline } = await ctx.openMarket(spec);
      await (
        await ctx.auspex.connect(ctx.alice).placeBet(marketId, true, { value: parseEther("1") })
      ).wait();
      await (
        await ctx.auspex.connect(ctx.bob).placeBet(marketId, false, { value: parseEther("1") })
      ).wait();
      await ctx.closeTimePasses(closeTime);
      await (
        await ctx.auspex.connect(ctx.resolver).proposeResolution(marketId, 1, EVIDENCE_URL)
      ).wait();
      return { ...ctx, marketId, closeTime, resolveDeadline };
    }

    it("a challenge inside the window returns the market to CLOSED and clears the proposal", async () => {
      const { auspex, challenger, marketId } = await proposedMarket("spec-ch1");

      await expect(auspex.connect(challenger).challengeResolution(marketId, "source contradicts"))
        .to.emit(auspex, "ResolutionChallenged")
        .withArgs(marketId, challenger.address, "source contradicts");

      const m = await auspex.getMarket(marketId);
      expect(m.state).to.equal(STATE_CLOSED);
      expect(m.outcome).to.equal(OUTCOME_UNRESOLVED);
      expect(m.evidenceUrl).to.equal("");
      expect(m.proposedBy).to.equal(ZeroAddress);
      expect(m.challengeEndsAt).to.equal(0n);
      expect(m.challengeCount).to.equal(1n);
    });

    it("a challenged market can be re-proposed and then finalized", async () => {
      const { auspex, challenger, resolver, networkHelpers, marketId } =
        await proposedMarket("spec-ch2");

      await (await auspex.connect(challenger).challengeResolution(marketId, "wrong")).wait();
      await (
        await auspex.connect(resolver).proposeResolution(marketId, 2, EVIDENCE_URL)
      ).wait();

      await networkHelpers.time.increase(CHALLENGE_WINDOW + 1);
      await expect(auspex.finalizeResolution(marketId))
        .to.emit(auspex, "MarketFinalized")
        .withArgs(marketId, OUTCOME_NO);

      const m = await auspex.getMarket(marketId);
      expect(m.state).to.equal(STATE_FINALIZED);
      expect(m.outcome).to.equal(OUTCOME_NO);
      expect(m.challengeCount).to.equal(1n);
    });

    it("rejects a challenge after the window and from a non-challenger", async () => {
      const { auspex, outsider, challenger, networkHelpers, marketId } =
        await proposedMarket("spec-ch3");

      await expect(
        auspex.connect(outsider).challengeResolution(marketId, "no standing"),
      ).to.be.revertedWithCustomError(auspex, "AccessControlUnauthorizedAccount");

      await networkHelpers.time.increase(CHALLENGE_WINDOW + 1);
      await expect(
        auspex.connect(challenger).challengeResolution(marketId, "too late"),
      ).to.be.revertedWithCustomError(auspex, "ChallengeWindowClosed");
    });

    it("rejects a challenge when nothing is proposed", async () => {
      const { auspex, challenger, openMarket } = await load();
      const { marketId } = await openMarket("spec-ch4");

      await expect(
        auspex.connect(challenger).challengeResolution(marketId, "nothing here"),
      ).to.be.revertedWithCustomError(auspex, "ResolutionNotProposed");
    });
  });

  describe("finalizeResolution", () => {
    it("is permissionless, but only after the window closes", async () => {
      const { auspex, alice, bob, outsider, resolver, networkHelpers, openMarket, closeTimePasses } =
        await load();
      const { marketId, closeTime } = await openMarket("spec-fin");
      await (
        await auspex.connect(alice).placeBet(marketId, true, { value: parseEther("1") })
      ).wait();
      await (await auspex.connect(bob).placeBet(marketId, false, { value: parseEther("1") })).wait();
      await closeTimePasses(closeTime);
      await (await auspex.connect(resolver).proposeResolution(marketId, 1, EVIDENCE_URL)).wait();

      const endsAt = (await auspex.getMarket(marketId)).challengeEndsAt;
      await expect(auspex.connect(outsider).finalizeResolution(marketId))
        .to.be.revertedWithCustomError(auspex, "ChallengeWindowOpen")
        .withArgs(endsAt);

      await networkHelpers.time.increase(CHALLENGE_WINDOW + 1);

      // An address with no role at all can finalize — nobody can block a payout by going silent.
      await expect(auspex.connect(outsider).finalizeResolution(marketId)).to.emit(
        auspex,
        "MarketFinalized",
      );
      expect((await auspex.getMarket(marketId)).state).to.equal(STATE_FINALIZED);
    });

    it("rejects finalizing a market with no proposal, and finalizing twice", async () => {
      const { auspex, resolver, networkHelpers, openMarket, closeTimePasses } = await load();
      const { marketId, closeTime } = await openMarket("spec-fin2");

      await expect(auspex.finalizeResolution(marketId)).to.be.revertedWithCustomError(
        auspex,
        "ResolutionNotProposed",
      );

      await closeTimePasses(closeTime);
      await (await auspex.connect(resolver).proposeResolution(marketId, 1, EVIDENCE_URL)).wait();
      await networkHelpers.time.increase(CHALLENGE_WINDOW + 1);
      await (await auspex.finalizeResolution(marketId)).wait();

      await expect(auspex.finalizeResolution(marketId)).to.be.revertedWithCustomError(
        auspex,
        "ResolutionNotProposed",
      );
    });
  });

  // -------------------------------------------------------------------
  // Invalidation
  // -------------------------------------------------------------------

  describe("invalidation", () => {
    it("lets anyone invalidate a market whose resolver went silent past the deadline", async () => {
      const { auspex, alice, outsider, networkHelpers, openMarket } = await load();
      const { marketId, resolveDeadline } = await openMarket("spec-stale");
      await (
        await auspex.connect(alice).placeBet(marketId, true, { value: parseEther("1") })
      ).wait();

      await expect(auspex.invalidateStale(marketId))
        .to.be.revertedWithCustomError(auspex, "ResolveDeadlineNotPassed")
        .withArgs(resolveDeadline);

      await networkHelpers.time.increaseTo(resolveDeadline + 1);
      await expect(auspex.connect(outsider).invalidateStale(marketId)).to.emit(
        auspex,
        "MarketInvalidated",
      );

      const m = await auspex.getMarket(marketId);
      expect(m.state).to.equal(STATE_INVALIDATED);
      expect(m.outcome).to.equal(OUTCOME_INVALID);
      expect(await auspex.previewPayout(marketId, alice.address)).to.equal(parseEther("1"));
    });

    it("cannot stale-invalidate a market that already has a proposed resolution", async () => {
      const { auspex, resolver, networkHelpers, openMarket, closeTimePasses } = await load();
      const { marketId, closeTime, resolveDeadline } = await openMarket("spec-stale2");
      await closeTimePasses(closeTime);
      await (await auspex.connect(resolver).proposeResolution(marketId, 1, EVIDENCE_URL)).wait();

      await networkHelpers.time.increaseTo(resolveDeadline + 1);
      await expect(auspex.invalidateStale(marketId)).to.be.revertedWithCustomError(
        auspex,
        "MarketNotClosed",
      );
    });

    it("only lets the admin force-invalidate after MAX_CHALLENGES challenges", async () => {
      const { auspex, alice, bob, challenger, resolver, admin, openMarket, closeTimePasses } =
        await load();
      const { marketId, closeTime } = await openMarket("spec-force");
      await (
        await auspex.connect(alice).placeBet(marketId, true, { value: parseEther("1") })
      ).wait();
      await (await auspex.connect(bob).placeBet(marketId, false, { value: parseEther("3") })).wait();
      await closeTimePasses(closeTime);

      await (await auspex.connect(resolver).proposeResolution(marketId, 1, EVIDENCE_URL)).wait();
      await expect(auspex.forceInvalidate(marketId, "deadlocked"))
        .to.be.revertedWithCustomError(auspex, "TooFewChallenges")
        .withArgs(0, 3);

      for (let i = 0; i < 3; i++) {
        await (await auspex.connect(challenger).challengeResolution(marketId, `round ${i}`)).wait();
        await (await auspex.connect(resolver).proposeResolution(marketId, 1, EVIDENCE_URL)).wait();
      }

      expect((await auspex.getMarket(marketId)).challengeCount).to.equal(3n);
      await expect(auspex.connect(admin).forceInvalidate(marketId, "deadlocked after 3 challenges"))
        .to.emit(auspex, "MarketInvalidated")
        .withArgs(marketId, "deadlocked after 3 challenges");

      // Everyone gets their exact stake back.
      expect(await auspex.previewPayout(marketId, alice.address)).to.equal(parseEther("1"));
      expect(await auspex.previewPayout(marketId, bob.address)).to.equal(parseEther("3"));
    });

    it("cannot force-invalidate an already settled market", async () => {
      const { auspex, resolver, networkHelpers, openMarket, closeTimePasses } = await load();
      const { marketId, closeTime } = await openMarket("spec-force2");
      await closeTimePasses(closeTime);
      await (await auspex.connect(resolver).proposeResolution(marketId, 1, EVIDENCE_URL)).wait();
      await networkHelpers.time.increase(CHALLENGE_WINDOW + 1);
      await (await auspex.finalizeResolution(marketId)).wait();

      await expect(auspex.forceInvalidate(marketId, "too late")).to.be.revertedWithCustomError(
        auspex,
        "MarketAlreadySettled",
      );
    });
  });

  // -------------------------------------------------------------------
  // Parimutuel payout
  // -------------------------------------------------------------------

  describe("parimutuel payout", () => {
    /** Runs a market to FINALIZED with the given bets and outcome. */
    async function settle(
      spec: string,
      bets: Array<{ who: "alice" | "bob" | "carol"; yes: boolean; amount: bigint }>,
      outcome: number,
    ) {
      const ctx = await load();
      const { marketId, closeTime } = await ctx.openMarket(spec);

      for (const b of bets) {
        await (
          await ctx.auspex.connect(ctx[b.who]).placeBet(marketId, b.yes, { value: b.amount })
        ).wait();
      }

      await ctx.closeTimePasses(closeTime);
      await (
        await ctx.auspex.connect(ctx.resolver).proposeResolution(marketId, outcome, EVIDENCE_URL)
      ).wait();
      await ctx.networkHelpers.time.increase(CHALLENGE_WINDOW + 1);
      await (await ctx.auspex.finalizeResolution(marketId)).wait();

      return { ...ctx, marketId };
    }

    it("splits the whole pool pro rata among the winners (hand-computed)", async () => {
      const { ethers, auspex, alice, bob, carol, marketId } = await settle(
        "spec-pari1",
        [
          { who: "alice", yes: true, amount: parseEther("1") },
          { who: "bob", yes: true, amount: parseEther("2") },
          { who: "carol", yes: false, amount: parseEther("3") },
        ],
        1,
      );

      // total 6, winning pool 3  ->  alice 1*6/3 = 2, bob 2*6/3 = 4, carol 0
      expect(await auspex.previewPayout(marketId, alice.address)).to.equal(parseEther("2"));
      expect(await auspex.previewPayout(marketId, bob.address)).to.equal(parseEther("4"));
      expect(await auspex.previewPayout(marketId, carol.address)).to.equal(0n);

      await expect(auspex.connect(alice).claim(marketId)).to.changeEtherBalance(
        ethers,
        alice,
        parseEther("2"),
      );
      await expect(auspex.connect(bob).claim(marketId))
        .to.emit(auspex, "Claimed")
        .withArgs(marketId, bob.address, bob.address, parseEther("4"));

      expect(await auspex.claimed(marketId, alice.address)).to.equal(true);
    });

    it("leaves integer-division dust in the contract rather than crediting it to anyone", async () => {
      const { ethers, auspex, alice, bob, carol, marketId } = await settle(
        "spec-dust",
        [
          { who: "alice", yes: true, amount: parseEther("1") },
          { who: "bob", yes: true, amount: parseEther("2") },
          { who: "carol", yes: false, amount: parseEther("1") },
        ],
        1,
      );

      // total 4e18, winning pool 3e18 -> 1*4/3 and 2*4/3, both floored. 1 wei is unallocatable.
      const alicePayout = 1333333333333333333n;
      const bobPayout = 2666666666666666666n;
      expect(await auspex.previewPayout(marketId, alice.address)).to.equal(alicePayout);
      expect(await auspex.previewPayout(marketId, bob.address)).to.equal(bobPayout);
      expect(alicePayout + bobPayout).to.equal(parseEther("4") - 1n);

      await (await auspex.connect(alice).claim(marketId)).wait();
      await (await auspex.connect(bob).claim(marketId)).wait();

      expect(await ethers.provider.getBalance(await auspex.getAddress())).to.equal(1n);
      expect(await auspex.previewPayout(marketId, carol.address)).to.equal(0n);
    });

    it("refunds everyone when nobody backed the winning side", async () => {
      const { ethers, auspex, alice, bob, marketId } = await settle(
        "spec-nowinner",
        [
          { who: "alice", yes: false, amount: parseEther("1") },
          { who: "bob", yes: false, amount: parseEther("4") },
        ],
        1, // YES wins, but poolYes is 0
      );

      expect((await auspex.getMarket(marketId)).poolYes).to.equal(0n);
      expect(await auspex.previewPayout(marketId, alice.address)).to.equal(parseEther("1"));
      expect(await auspex.previewPayout(marketId, bob.address)).to.equal(parseEther("4"));

      await expect(auspex.connect(alice).claim(marketId)).to.changeEtherBalance(
        ethers,
        alice,
        parseEther("1"),
      );
    });

    it("refunds exact stakes when the outcome is INVALID", async () => {
      const { ethers, auspex, alice, bob, carol, marketId } = await settle(
        "spec-invalid",
        [
          { who: "alice", yes: true, amount: parseEther("1") },
          { who: "bob", yes: false, amount: parseEther("2") },
          { who: "carol", yes: true, amount: parseEther("3") },
        ],
        3,
      );

      expect((await auspex.getMarket(marketId)).outcome).to.equal(OUTCOME_INVALID);
      expect(await auspex.previewPayout(marketId, alice.address)).to.equal(parseEther("1"));
      expect(await auspex.previewPayout(marketId, bob.address)).to.equal(parseEther("2"));
      expect(await auspex.previewPayout(marketId, carol.address)).to.equal(parseEther("3"));

      await expect(auspex.connect(bob).claim(marketId)).to.changeEtherBalance(
        ethers,
        bob,
        parseEther("2"),
      );
    });

    it("refunds a bettor who backed both sides of an invalidated market", async () => {
      const { auspex, alice, marketId } = await settle(
        "spec-bothsides",
        [
          { who: "alice", yes: true, amount: parseEther("1") },
          { who: "alice", yes: false, amount: parseEther("2") },
        ],
        3,
      );

      expect(await auspex.previewPayout(marketId, alice.address)).to.equal(parseEther("3"));
    });

    it("rejects a double claim and a losing claim", async () => {
      const { auspex, alice, carol, outsider, marketId } = await settle(
        "spec-doubleclaim",
        [
          { who: "alice", yes: true, amount: parseEther("1") },
          { who: "carol", yes: false, amount: parseEther("1") },
        ],
        1,
      );

      await (await auspex.connect(alice).claim(marketId)).wait();
      await expect(auspex.connect(alice).claim(marketId)).to.be.revertedWithCustomError(
        auspex,
        "AlreadyClaimed",
      );
      expect(await auspex.previewPayout(marketId, alice.address)).to.equal(0n);

      await expect(auspex.connect(carol).claim(marketId)).to.be.revertedWithCustomError(
        auspex,
        "NothingToClaim",
      );
      await expect(auspex.connect(outsider).claim(marketId)).to.be.revertedWithCustomError(
        auspex,
        "NothingToClaim",
      );
    });

    it("rejects a claim before the market is settled", async () => {
      const { auspex, alice, resolver, openMarket, closeTimePasses } = await load();
      const { marketId, closeTime } = await openMarket("spec-early-claim");
      await (
        await auspex.connect(alice).placeBet(marketId, true, { value: parseEther("1") })
      ).wait();

      await expect(auspex.connect(alice).claim(marketId)).to.be.revertedWithCustomError(
        auspex,
        "MarketNotSettled",
      );
      expect(await auspex.previewPayout(marketId, alice.address)).to.equal(0n);

      await closeTimePasses(closeTime);
      await (await auspex.connect(resolver).proposeResolution(marketId, 1, EVIDENCE_URL)).wait();

      // Still not settled — the challenge window has not elapsed.
      await expect(auspex.connect(alice).claim(marketId)).to.be.revertedWithCustomError(
        auspex,
        "MarketNotSettled",
      );
    });
  });

  // -------------------------------------------------------------------
  // Agent payouts and reentrancy
  // -------------------------------------------------------------------

  describe("agent claims", () => {
    it("pays an agent's winnings to its registered owner, not to the agent", async () => {
      const {
        ethers,
        auspex,
        agent,
        agentOwner,
        alice,
        resolver,
        networkHelpers,
        openMarket,
        closeTimePasses,
      } = await load();
      const { marketId, closeTime } = await openMarket("spec-agentclaim");

      await (await auspex.connect(agent).placeBet(marketId, true, { value: PER_TX_CAP })).wait();
      await (
        await auspex.connect(alice).placeBet(marketId, false, { value: PER_TX_CAP })
      ).wait();

      await closeTimePasses(closeTime);
      await (await auspex.connect(resolver).proposeResolution(marketId, 1, EVIDENCE_URL)).wait();
      await networkHelpers.time.increase(CHALLENGE_WINDOW + 1);
      await (await auspex.finalizeResolution(marketId)).wait();

      const payout = await auspex.previewPayout(marketId, agent.address);
      expect(payout).to.equal(PER_TX_CAP * 2n); // whole pool, agent was the only winner

      const ownerBefore = await ethers.provider.getBalance(agentOwner.address);
      const agentBefore = await ethers.provider.getBalance(agent.address);

      const tx = await auspex.connect(agent).claim(marketId);
      const receipt = await tx.wait();
      if (receipt === null) throw new Error("no receipt");

      await expect(tx)
        .to.emit(auspex, "Claimed")
        .withArgs(marketId, agent.address, agentOwner.address, payout);

      // The owner is paid in full; the agent wallet only ever spends gas.
      expect(await ethers.provider.getBalance(agentOwner.address)).to.equal(ownerBefore + payout);
      expect(await ethers.provider.getBalance(agent.address)).to.equal(
        agentBefore - receipt.gasUsed * receipt.gasPrice,
      );
    });

    it("still pays out to the owner after the agent has been deactivated", async () => {
      const {
        ethers,
        auspex,
        agent,
        agentOwner,
        alice,
        resolver,
        networkHelpers,
        openMarket,
        closeTimePasses,
      } = await load();
      const { marketId, closeTime } = await openMarket("spec-agentclaim2");

      await (await auspex.connect(agent).placeBet(marketId, true, { value: PER_TX_CAP })).wait();
      await (await auspex.connect(alice).placeBet(marketId, false, { value: PER_TX_CAP })).wait();
      await closeTimePasses(closeTime);
      await (await auspex.connect(resolver).proposeResolution(marketId, 1, EVIDENCE_URL)).wait();
      await networkHelpers.time.increase(CHALLENGE_WINDOW + 1);
      await (await auspex.finalizeResolution(marketId)).wait();

      await (await auspex.deactivateAgent(agent.address)).wait();

      const ownerBefore = await ethers.provider.getBalance(agentOwner.address);
      await (await auspex.connect(agent).claim(marketId)).wait();
      expect(await ethers.provider.getBalance(agentOwner.address)).to.equal(
        ownerBefore + PER_TX_CAP * 2n,
      );
    });
  });

  describe("reentrancy", () => {
    it("pays a re-entering claimant exactly once", async () => {
      const { ethers, auspex, alice, resolver, networkHelpers, openMarket, closeTimePasses } =
        await load();
      const { marketId, closeTime } = await openMarket("spec-reentrancy");

      const attacker = (await ethers.deployContract("ReentrantClaimer", [
        await auspex.getAddress(),
      ])) as unknown as ReentrantClaimer;
      await attacker.waitForDeployment();

      await (await attacker.bet(marketId, true, { value: parseEther("1") })).wait();
      await (
        await auspex.connect(alice).placeBet(marketId, false, { value: parseEther("1") })
      ).wait();

      await closeTimePasses(closeTime);
      await (await auspex.connect(resolver).proposeResolution(marketId, 1, EVIDENCE_URL)).wait();
      await networkHelpers.time.increase(CHALLENGE_WINDOW + 1);
      await (await auspex.finalizeResolution(marketId)).wait();

      const attackerAddress = await attacker.getAddress();
      expect(await auspex.previewPayout(marketId, attackerAddress)).to.equal(parseEther("2"));

      await (await attacker.attack(marketId)).wait();

      // The re-entry happened and was refused: paid the whole pool once, and only once.
      expect(await attacker.reentryAttempts()).to.equal(1n);
      expect(await attacker.reentrySucceeded()).to.equal(false);
      expect(await ethers.provider.getBalance(attackerAddress)).to.equal(parseEther("2"));
      expect(await ethers.provider.getBalance(await auspex.getAddress())).to.equal(0n);
    });
  });

  // -------------------------------------------------------------------
  // Kill switch
  // -------------------------------------------------------------------

  describe("pause", () => {
    it("blocks betting while paused and restores it on unpause", async () => {
      const { auspex, alice, openMarket } = await load();
      const { marketId } = await openMarket("spec-pause");

      await (await auspex.pause()).wait();
      await expect(
        auspex.connect(alice).placeBet(marketId, true, { value: parseEther("1") }),
      ).to.be.revertedWithCustomError(auspex, "EnforcedPause");

      await (await auspex.unpause()).wait();
      await expect(
        auspex.connect(alice).placeBet(marketId, true, { value: parseEther("1") }),
      ).to.emit(auspex, "BetPlaced");
    });

    it("never traps funds: claiming works while paused", async () => {
      const { ethers, auspex, alice, bob, resolver, networkHelpers, openMarket, closeTimePasses } =
        await load();
      const { marketId, closeTime } = await openMarket("spec-pause-claim");
      await (
        await auspex.connect(alice).placeBet(marketId, true, { value: parseEther("1") })
      ).wait();
      await (await auspex.connect(bob).placeBet(marketId, false, { value: parseEther("1") })).wait();

      await closeTimePasses(closeTime);
      await (await auspex.connect(resolver).proposeResolution(marketId, 1, EVIDENCE_URL)).wait();
      await networkHelpers.time.increase(CHALLENGE_WINDOW + 1);
      await (await auspex.finalizeResolution(marketId)).wait();

      await (await auspex.pause()).wait();
      await expect(auspex.connect(alice).claim(marketId)).to.changeEtherBalance(
        ethers,
        alice,
        parseEther("2"),
      );
    });

    it("only the admin can pause or unpause", async () => {
      const { auspex, outsider } = await load();

      await expect(auspex.connect(outsider).pause()).to.be.revertedWithCustomError(
        auspex,
        "AccessControlUnauthorizedAccount",
      );
      await expect(auspex.connect(outsider).unpause()).to.be.revertedWithCustomError(
        auspex,
        "AccessControlUnauthorizedAccount",
      );
    });
  });
});
