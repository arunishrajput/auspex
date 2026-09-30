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
import { formatIds, lifecycleClaim, marketOrigins, type ClaimRow, type OriginRow } from "./signers";

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

/**
 * The market-origin claim, tested against the exact shape that broke the sentence it replaced.
 *
 * The rows below mirror what is on chain 91562037: two unlabelled commissioning markets, two
 * labelled ones, and the rest created by a browser wallet. The case worth protecting is the third
 * test — the old sentence claimed every commissioning market announced itself, and two do not.
 */
const HUMAN = "0xa9f68fdf84388fa548a685085e2bee0e5b311ff1";
const OPERATOR = "0xc71dc478040f7a6bcc5cb1f316a4a446f7d4ad24";

const ON_CHAIN: OriginRow[] = [
  { onchainId: 1, question: "Will AuspeX have a verified contract on MST Testnet before the deadline?", creator: OPERATOR },
  { onchainId: 2, question: "Will AuspeX have a verified contract on MST Testnet before the deadline?", creator: OPERATOR },
  { onchainId: 3, question: "[Phase 2 idempotency test 1790617927448] Did the crash test produce exactly one transaction?", creator: OPERATOR },
  { onchainId: 4, question: "Will Zoo Atlanta issue an official press release…", creator: HUMAN },
  { onchainId: 8, question: "[Phase 6 lifecycle test 1790644085477] Not a product market. Did the lifecycle complete?", creator: OPERATOR },
  { onchainId: 9, question: "Will the European Central Bank announce a further interest rate increase…", creator: HUMAN },
];

describe("marketOrigins", () => {
  it("splits markets by who signed for them, not by id range", () => {
    const origin = marketOrigins(ON_CHAIN, HUMAN);
    expect(origin.humanCreated).toEqual([4, 9]);
    expect(origin.operatorCreated).toEqual([1, 2, 3, 8]);
    expect(origin.unknown).toEqual([]);
  });

  it("matches the creating address case-insensitively", () => {
    const origin = marketOrigins(ON_CHAIN, HUMAN.toUpperCase());
    expect(origin.humanCreated).toEqual([4, 9]);
  });

  it("does NOT claim a commissioning market labels itself when it does not", () => {
    const origin = marketOrigins(ON_CHAIN, HUMAN);
    // The defect this function exists to prevent: markets 1 and 2 are commissioning markets whose
    // on-chain text never says so, and the sentence must not say they do.
    expect(origin.selfLabelled).toEqual([3, 8]);
    expect(origin.unlabelled).toEqual([1, 2]);
  });

  it("requires the label to lead the question, so a product market cannot be demoted", () => {
    const origin = marketOrigins(
      [{ onchainId: 5, question: "Will the court test case be decided before Friday?", creator: OPERATOR }],
      HUMAN,
    );
    expect(origin.selfLabelled).toEqual([]);
    expect(origin.unlabelled).toEqual([5]);
  });

  it("puts an unindexed market in `unknown` rather than crediting it to anyone", () => {
    const origin = marketOrigins([{ onchainId: 7, question: "Anything?", creator: null }], HUMAN);
    expect(origin.unknown).toEqual([7]);
    expect(origin.humanCreated).toEqual([]);
    expect(origin.operatorCreated).toEqual([]);
  });

  it("claims nothing at all when no authority address is configured", () => {
    const origin = marketOrigins(ON_CHAIN, null);
    expect(origin.unknown).toEqual([1, 2, 3, 4, 8, 9]);
    expect(origin.humanCreated).toEqual([]);
    expect(origin.operatorCreated).toEqual([]);
  });
});

describe("formatIds", () => {
  it("collapses runs and keeps gaps", () => {
    expect(formatIds([1, 2, 3, 5])).toBe("1–3 and 5");
    expect(formatIds([4, 5, 6, 7, 9, 10, 11, 12, 13])).toBe("4–7 and 9–13");
  });

  it("spells out a pair rather than writing a two-wide range", () => {
    expect(formatIds([1, 2])).toBe("1 and 2");
  });

  it("handles one id and none", () => {
    expect(formatIds([8])).toBe("8");
    expect(formatIds([])).toBe("none");
  });
});
