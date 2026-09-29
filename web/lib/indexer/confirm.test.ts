/**
 * `wouldIndex` — the arithmetic that made every market notification late.
 *
 * The approval path holds a receipt after **one** confirmation and then ran the indexer, which
 * reads only as far as `head - confirmations`. Those two numbers were never compared, so an
 * indexing pass run the instant a market was created was guaranteed to stop three blocks below
 * the log it was run to collect. The notifier then correctly announced nothing, and the market
 * waited for a cron tick — 44 minutes for market #10, 50 for market #9.
 *
 * The real numbers from market #10 are the first case below: mined in 5,801,451, and the pass
 * that followed it left the cursor at 5,801,448.
 */

import { describe, expect, it } from "vitest";
import { confirmationHorizon, wouldIndex } from "./run";

const CONFIRMATIONS = 3;

describe("confirmationHorizon", () => {
  it("stops `confirmations` blocks below the head", () => {
    expect(confirmationHorizon(5_801_451, CONFIRMATIONS)).toBe(5_801_448);
  });

  it("is the head itself when nothing is held back", () => {
    expect(confirmationHorizon(100, 0)).toBe(100);
  });
});

describe("wouldIndex — the regression this file exists for", () => {
  it("REFUSES a market mined in the head block — market #10's exact case", () => {
    // 5,801,451 mined at head 5,801,451. The old inline pass ran here and found nothing.
    expect(wouldIndex(5_801_451, 5_801_451, CONFIRMATIONS)).toBe(false);
  });

  it("refuses a one-confirmation receipt, which is what the intent worker returns", () => {
    expect(wouldIndex(5_801_452, 5_801_451, CONFIRMATIONS)).toBe(false);
  });

  it("still refuses one block short of the depth", () => {
    expect(wouldIndex(5_801_453, 5_801_451, CONFIRMATIONS)).toBe(false);
  });

  it("accepts exactly at the depth — what the wait now holds out for", () => {
    expect(wouldIndex(5_801_454, 5_801_451, CONFIRMATIONS)).toBe(true);
  });

  it("accepts anything deeper, which is why a later tick always found it", () => {
    expect(wouldIndex(5_802_340, 5_801_451, CONFIRMATIONS)).toBe(true);
  });

  it("accepts the head block when no confirmations are required", () => {
    expect(wouldIndex(500, 500, 0)).toBe(true);
  });
});
