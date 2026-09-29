/**
 * The lifecycle caption, tested from both sides of the claim it makes.
 *
 * This exists because the thing it replaced was a hardcoded sentence that was **false on the market
 * it was printed on**: `/markets/8` said "there is no row in which a privileged server key moved
 * money" directly beneath a table whose first row was the admin key staking 0.01 tMSTC. A caption
 * that asserts facts about rows without reading them will eventually contradict them, so the only
 * useful test here is the one that proves the strong claim is *withheld* when it is not earned.
 *
 * `classifySigners` is not unit-tested: every branch it has is an `eth_call` or a database read, and
 * a test with both mocked would assert that the mocks were wired up. It is covered by
 * `verify:resolution`, which reads the real roles of the real addresses, and by the page itself.
 */

import { describe, expect, it } from "vitest";
import { lifecycleClaim, type ClaimRow } from "./signers";

/** A market driven entirely through the intended path: browser wallet, then capped agents. */
const CLEAN: ClaimRow[] = [
  { kind: "CREATE_MARKET", status: "CONFIRMED", valueWei: "0", signerKind: "BROWSER" },
  { kind: "PLACE_BET", status: "CONFIRMED", valueWei: "5000000000000000", signerKind: "AGENT" },
  { kind: "FINALIZE_RESOLUTION", status: "CONFIRMED", valueWei: "0", signerKind: "AGENT" },
];

/** Market 8's actual shape: an operator drove it, including one of the two stakes. */
const OPERATOR_DRIVEN: ClaimRow[] = [
  { kind: "PLACE_BET", status: "CONFIRMED", valueWei: "10000000000000000", signerKind: "OPERATOR" },
  { kind: "PLACE_BET", status: "CONFIRMED", valueWei: "5000000000000000", signerKind: "AGENT" },
  { kind: "PROPOSE_RESOLUTION", status: "CONFIRMED", valueWei: "0", signerKind: "OPERATOR" },
  { kind: "FINALIZE_RESOLUTION", status: "CONFIRMED", valueWei: "0", signerKind: "AGENT" },
  { kind: "CLAIM", status: "CONFIRMED", valueWei: "0", signerKind: "AGENT" },
];

describe("lifecycleClaim", () => {
  it("makes the strong claim only when no privileged key appears", () => {
    const claim = lifecycleClaim(CLEAN);
    expect(claim.headline).toContain("No call on this market was signed by a key holding a privileged role");
    expect(claim.headline).not.toContain("operator");
  });

  it("names the calls behind the strong claim, so it can be checked rather than believed", () => {
    const detail = lifecycleClaim(CLEAN).detail.join(" ");
    expect(detail).toContain("createMarket");
    expect(detail).toContain("placeBet");
    expect(detail).toContain("finalizeResolution");
  });

  it("WITHHOLDS the strong claim as soon as one operator-signed row exists", () => {
    const claim = lifecycleClaim(OPERATOR_DRIVEN);
    expect(claim.headline).not.toContain("No call on this market");
    expect(claim.headline).toContain("operator key");
    expect(claim.headline).toContain("rather than the human gate");
  });

  it("says which calls the operator signed, not merely that some were", () => {
    const detail = lifecycleClaim(OPERATOR_DRIVEN).detail.join(" ");
    expect(detail).toContain("placeBet");
    expect(detail).toContain("proposeResolution");
    expect(detail).toContain("DEFAULT_ADMIN_ROLE");
    expect(detail).toContain("deliberately absent from the deployment");
  });

  it("admits it when the operator key staked money, which is the least flattering fact", () => {
    const detail = lifecycleClaim(OPERATOR_DRIVEN).detail.join(" ");
    expect(detail).toContain("staked tMSTC");
    expect(detail).toContain("on a product market it would not be acceptable");
  });

  it("does not count a REVERTED bet as staked — the contract refused it, so nothing moved", () => {
    // Market 8's actual shape: the operator's second placeBet carried 1e-6 tMSTC into a call that
    // reverted with BettingClosed(). Before this, the page said "2 of them staked tMSTC".
    const withRefusedBet: ClaimRow[] = [
      ...OPERATOR_DRIVEN,
      { kind: "PLACE_BET", status: "REVERTED", valueWei: "1000000000000", signerKind: "OPERATOR" },
    ];
    const detail = lifecycleClaim(withRefusedBet).detail.join(" ");
    expect(detail).toContain("One of them staked");
    expect(detail).not.toContain("2 of them staked");
  });

  it("does not claim the operator staked anything when its calls carried no value", () => {
    const zeroValue = OPERATOR_DRIVEN.map((row) =>
      row.signerKind === "OPERATOR" ? { ...row, valueWei: "0" } : row,
    );
    const detail = lifecycleClaim(zeroValue).detail.join(" ");
    expect(detail).not.toContain("staked tMSTC");
  });

  it("puts the qualification before the boast, so a reader who stops early reads the weaker one", () => {
    const { detail } = lifecycleClaim(OPERATOR_DRIVEN);
    const operatorAt = detail.findIndex((s) => s.includes("operator key"));
    const agentAt = detail.findIndex((s) => s.includes("holding no role"));
    expect(operatorAt).toBeGreaterThanOrEqual(0);
    expect(agentAt).toBeGreaterThan(operatorAt);
  });

  it("says nothing rather than something misleading when there are no rows", () => {
    const claim = lifecycleClaim([]);
    expect(claim.headline).toContain("No intents are recorded");
    expect(claim.headline).toContain("on MSTScan are the record");
    expect(claim.detail).toHaveLength(0);
  });

  it("does not count closeMarket or the resolution calls as moving money", () => {
    const noMoney: ClaimRow[] = [
      { kind: "CLOSE_MARKET", status: "CONFIRMED", valueWei: "0", signerKind: "OPERATOR" },
      { kind: "PROPOSE_RESOLUTION", status: "CONFIRMED", valueWei: "0", signerKind: "OPERATOR" },
    ];
    expect(lifecycleClaim(noMoney).detail.join(" ")).not.toContain("staked");
  });

  it("treats an unclassifiable signer as SERVER rather than as privileged", () => {
    const unknown: ClaimRow[] = [
      { kind: "PLACE_BET", status: "CONFIRMED", valueWei: "1", signerKind: "SERVER" },
    ];
    // Conservative in the *reader's* favour: no operator row, so the strong claim stands — and it
    // is true, because a SERVER row is by definition one the admin read said held no admin role.
    expect(lifecycleClaim(unknown).headline).toContain("No call on this market");
  });

  it("lists each call kind once however many rows share it", () => {
    const repeated: ClaimRow[] = [
      { kind: "PLACE_BET", status: "CONFIRMED", valueWei: "1", signerKind: "AGENT" },
      { kind: "PLACE_BET", status: "REVERTED", valueWei: "2", signerKind: "AGENT" },
      { kind: "PLACE_BET", status: "CONFIRMED", valueWei: "3", signerKind: "AGENT" },
    ];
    const detail = lifecycleClaim(repeated).detail.join(" ");
    expect(detail.match(/placeBet/g)).toHaveLength(1);
  });
});
