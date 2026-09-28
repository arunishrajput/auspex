/**
 * `plannedSteps` — the table of what a worker pass may do to an intent.
 *
 * Phase 4 introduced a second signer kind, and the two ways of getting it wrong are both
 * expensive. Signing an `EXTERNAL` intent is impossible: the key is in a human's browser
 * wallet and `getDeployerWallet()` would either throw or, worse, sign with the wrong key and
 * create the market from the wrong address — destroying the one claim the phase exists to
 * make. Rebroadcasting one is a plain crash: `signedRawTx` is null, so the naive path throws
 * inside a worker that had other intents to settle.
 *
 * The decision is pure and exported so this is a table rather than a comment.
 */

import { describe, expect, it } from "vitest";
import { plannedSteps } from "./engine";

const signedBytes = "0x02f8b1...";

describe("plannedSteps — server-signed intents are unchanged by Phase 4", () => {
  it("signs, broadcasts and settles a PENDING intent", () => {
    expect(plannedSteps({ status: "PENDING", signer: "SERVER", signedRawTx: null })).toEqual({
      sign: true,
      broadcast: true,
      settle: true,
      waitingFor: null,
    });
  });

  it("resumes a SIGNED intent by broadcasting the stored bytes, never re-signing", () => {
    const plan = plannedSteps({ status: "SIGNED", signer: "SERVER", signedRawTx: signedBytes });
    expect(plan.sign).toBe(false);
    expect(plan.broadcast).toBe(true);
    expect(plan.settle).toBe(true);
  });

  it("re-broadcasts the same bytes for a BROADCAST intent, which the network deduplicates", () => {
    const plan = plannedSteps({ status: "BROADCAST", signer: "SERVER", signedRawTx: signedBytes });
    expect(plan.broadcast).toBe(true);
    expect(plan.settle).toBe(true);
  });
});

describe("plannedSteps — externally-signed intents", () => {
  it("does NOT sign a PENDING external intent — it waits for the human", () => {
    const plan = plannedSteps({ status: "PENDING", signer: "EXTERNAL", signedRawTx: null });
    expect(plan.sign).toBe(false);
    expect(plan.broadcast).toBe(false);
    expect(plan.settle).toBe(false);
    expect(plan.waitingFor).toContain("human authority");
  });

  it("settles a BROADCAST external intent without trying to rebroadcast bytes it does not have", () => {
    const plan = plannedSteps({ status: "BROADCAST", signer: "EXTERNAL", signedRawTx: null });
    expect(plan.sign).toBe(false);
    // The bytes live in the wallet. Polling the hash is the only step available — and enough.
    expect(plan.broadcast).toBe(false);
    expect(plan.settle).toBe(true);
    expect(plan.waitingFor).toBeNull();
  });
});

describe("plannedSteps — terminal states", () => {
  it.each(["CONFIRMED", "REVERTED", "ABANDONED"] as const)("does nothing to a %s intent", (status) => {
    const plan = plannedSteps({ status, signer: "SERVER", signedRawTx: signedBytes });
    expect(plan).toEqual({
      sign: false,
      broadcast: false,
      settle: false,
      waitingFor: `already ${status}`,
    });
  });
});

describe("plannedSteps — the invariant that matters", () => {
  it("never plans a broadcast for an intent with no bytes to broadcast", () => {
    const statuses = ["PENDING", "SIGNED", "BROADCAST", "CONFIRMED", "REVERTED", "ABANDONED"] as const;
    const signers = ["SERVER", "EXTERNAL"] as const;

    for (const status of statuses) {
      for (const signer of signers) {
        for (const signedRawTx of [null, signedBytes]) {
          // `SIGNED` with no stored bytes is not a state the engine can produce: `signIntent`
          // writes the status and the bytes in one UPDATE inside one transaction. It is left
          // out here rather than handled, because the honest response to a row that cannot
          // exist is the loud one — `broadcastIntent` throws a named error, which lands in
          // `last_error` and stops the intent visibly instead of parking it silently.
          if (status === "SIGNED" && signedRawTx === null) continue;

          const plan = plannedSteps({ status, signer, signedRawTx });
          if (!plan.broadcast) continue;
          // A broadcast is only ever planned when the bytes exist, or when this pass will
          // produce them by signing first.
          expect(
            signedRawTx !== null || plan.sign,
            `${signer}/${status}/${signedRawTx === null ? "no bytes" : "bytes"}`,
          ).toBe(true);
        }
      }
    }
  });

  it("never plans a signature for a key this process does not hold", () => {
    for (const status of ["PENDING", "SIGNED", "BROADCAST"] as const) {
      const plan = plannedSteps({ status, signer: "EXTERNAL", signedRawTx: null });
      expect(plan.sign, `EXTERNAL/${status}`).toBe(false);
    }
  });
});
