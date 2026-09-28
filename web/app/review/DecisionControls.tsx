"use client";

/**
 * Approve or reject one proposal.
 *
 * ## The approve path, and why it is three round trips
 *
 *   planApproval    → the server re-validates, encodes the calldata, and simulates the call
 *   sendTransaction → the wallet signs. This is the only step AuspeX cannot perform itself.
 *   recordApproval  → the server verifies the hash against the node and records it
 *
 * The browser's job in the middle is to relay bytes it did not author. It receives `to` and
 * `data` from the server and hands them to the wallet unchanged — so a page that had been
 * tampered with could refuse to send a transaction, but could not send a different one. The
 * calldata contains the `specHash`, and the server compares the mined transaction's calldata
 * against what it authorised before recording anything.
 *
 * ## The reject path
 *
 * Rejection leaves no on-chain trace, so it is authenticated by an EIP-191 signature over a
 * message naming the proposal, its spec hash, and the reason. The message text comes from the
 * server, so what the wallet displays is what the server verifies.
 */

import { useState, useTransition } from "react";
import { useSendTransaction, useSignMessage } from "wagmi";
import { explorerUrl, shortHash } from "@/lib/chain";
import { planApproval, recordApproval, rejectionPreamble, submitRejection } from "./actions";
import { useReviewer } from "./WalletGate";

type Status = { kind: "idle" | "busy" | "ok" | "error"; message: string; txHash?: string };

export function DecisionControls({
  proposalId,
  specHash,
}: {
  proposalId: string;
  specHash: string | null;
}) {
  const reviewer = useReviewer();
  const { sendTransactionAsync } = useSendTransaction();
  const { signMessageAsync } = useSignMessage();
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<Status>({ kind: "idle", message: "" });
  const [showReject, setShowReject] = useState(false);
  const [reason, setReason] = useState("");

  const disabled = !reviewer.isAuthority || isPending || status.kind === "busy";

  async function approve() {
    if (reviewer.address === null) return;
    setStatus({ kind: "busy", message: "checking the spec and simulating the call…" });

    const plan = await planApproval(proposalId, reviewer.address);
    if (!plan.ok) {
      setStatus({ kind: "error", message: plan.error });
      return;
    }

    setStatus({ kind: "busy", message: "waiting for your wallet to sign createMarket…" });

    let txHash: string;
    try {
      // `to` and `data` come from the server. Nothing here builds calldata.
      txHash = await sendTransactionAsync({
        to: plan.to as `0x${string}`,
        data: plan.data as `0x${string}`,
      });
    } catch (error) {
      // A rejected wallet prompt is a normal outcome, not a failure — the intent row stays
      // PENDING and the proposal stays in the queue, so clicking approve again resumes it.
      setStatus({
        kind: "error",
        message: `Not signed: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`,
      });
      return;
    }

    setStatus({ kind: "busy", message: "verifying the transaction against the node…" });

    startTransition(async () => {
      const recorded = await recordApproval(proposalId, plan.intentId, txHash, reviewer.address!);
      setStatus(
        recorded.ok
          ? { kind: "ok", message: recorded.settled, txHash: recorded.txHash }
          : { kind: "error", message: recorded.error },
      );
    });
  }

  async function reject() {
    if (reviewer.address === null) return;
    const trimmed = reason.trim();
    if (trimmed.length < 3) {
      setStatus({ kind: "error", message: "A rejection needs a reason." });
      return;
    }

    setStatus({ kind: "busy", message: "waiting for your wallet to sign the rejection…" });

    // Fixed once, here, and reused for both the signature and the verification — so the
    // timestamp inside the signed text is the timestamp the server checks.
    const request = { proposalId, specHash, reason: trimmed, issuedAt: Date.now() };

    let signature: string;
    try {
      signature = await signMessageAsync({ message: await rejectionPreamble(request) });
    } catch (error) {
      setStatus({
        kind: "error",
        message: `Not signed: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}`,
      });
      return;
    }

    startTransition(async () => {
      const result = await submitRejection(request, reviewer.address!, signature);
      setStatus(
        result.ok
          ? { kind: "ok", message: "Rejected, with the reason recorded in the audit log." }
          : { kind: "error", message: result.error },
      );
    });
  }

  return (
    <div className="border-t border-ink-800 px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={approve}
          disabled={disabled}
          className="rounded border border-ok-500/40 bg-ok-500/10 px-3 py-1.5 font-mono text-xs text-ok-500 transition-colors hover:border-ok-500/70 hover:bg-ok-500/20 disabled:cursor-not-allowed disabled:opacity-40"
        >
          ✓ Approve &amp; sign createMarket
        </button>
        <button
          type="button"
          onClick={() => setShowReject((open) => !open)}
          disabled={disabled}
          className="rounded border border-ink-700 bg-ink-850 px-3 py-1.5 font-mono text-xs text-ink-300 transition-colors hover:border-bad-500/50 hover:text-bad-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          ✖ Reject
        </button>

        {!reviewer.isAuthority && (
          <span className="font-mono text-[11px] text-ink-500">
            connect the authority wallet to decide
          </span>
        )}
      </div>

      {showReject && (
        <div className="mt-3 flex flex-col gap-2">
          <label
            htmlFor={`reason-${proposalId}`}
            className="font-mono text-[10px] tracking-wide text-ink-400 uppercase"
          >
            why — recorded verbatim, and shown on this page afterwards
          </label>
          <textarea
            id={`reason-${proposalId}`}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={2}
            maxLength={500}
            placeholder="e.g. the resolution source does not publish this figure, so it could not be settled"
            className="w-full rounded border border-ink-700 bg-ink-850 px-3 py-2 font-mono text-xs text-ink-200 placeholder:text-ink-600 focus:border-signal-500/50 focus:outline-none"
          />
          <button
            type="button"
            onClick={reject}
            disabled={disabled}
            className="self-start rounded border border-bad-500/40 bg-bad-500/10 px-3 py-1.5 font-mono text-xs text-bad-500 transition-colors hover:bg-bad-500/20 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Sign rejection
          </button>
          <p className="text-[11px] leading-relaxed text-ink-500">
            Signing a rejection sends no transaction and spends nothing. It exists because a
            rejection leaves no trace on chain, so the record needs the same key behind it that
            an approval has.
          </p>
        </div>
      )}

      {status.kind !== "idle" && (
        <p
          role="status"
          className={`mt-3 font-mono text-[11px] break-words ${
            status.kind === "error"
              ? "text-bad-500"
              : status.kind === "ok"
                ? "text-ok-500"
                : "text-ink-300"
          }`}
        >
          {status.kind === "busy" && "⋯ "}
          {status.message}
          {status.txHash !== undefined && (
            <>
              {" — "}
              <a
                href={explorerUrl("tx", status.txHash)}
                target="_blank"
                rel="noreferrer"
                className="text-signal-500 underline-offset-2 hover:underline"
              >
                {shortHash(status.txHash, 10, 8)} on MSTScan ↗
              </a>
            </>
          )}
        </p>
      )}
    </div>
  );
}
