"use client";

/**
 * Sign or refuse one drafted outcome, and challenge one that is already on chain.
 *
 * ## The sign path, and why it is three round trips
 *
 *   planResolution   → the server re-reads the chain, encodes the calldata, simulates the call
 *   sendTransaction  → the wallet signs. This is the only step AuspeX cannot perform itself.
 *   recordResolution → the server verifies the hash against the node and records it
 *
 * The browser's job in the middle is to relay bytes it did not author. It receives `to` and `data`
 * from the server and hands them to the wallet unchanged, so a page that had been tampered with
 * could refuse to send a transaction but could not send a different outcome. The server then
 * compares the mined transaction's calldata against what it authorised before recording anything.
 *
 * ## The refuse path
 *
 * Rejecting a draft leaves no on-chain trace, so it is authenticated by an EIP-191 signature over
 * a message naming the draft, the market, the outcome and the round. The message text comes from
 * the server, so what the wallet displays is what the server verifies.
 */

import { useEffect, useState, useTransition } from "react";
import { useSendTransaction, useSignMessage } from "wagmi";
import { explorerUrl, shortHash } from "@/lib/chain";
import {
  planChallenge,
  planResolution,
  recordChallenge,
  recordResolution,
  rejectionPreamble,
  submitDraftRejection,
} from "./actions";
import { useResolver } from "./ResolverGate";

type Status = { kind: "idle" | "busy" | "ok" | "error"; message: string; txHash?: string };

function firstLine(error: unknown): string {
  return error instanceof Error ? error.message.split("\n")[0] : String(error);
}

function StatusLine({ status }: { status: Status }) {
  if (status.kind === "idle") return null;
  return (
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
  );
}

export function ResolutionControls({
  draftId,
  onchainId,
  outcome,
  round,
  blocked,
}: {
  draftId: string;
  onchainId: number;
  outcome: string;
  round: number;
  /** Non-null when the chain says this draft cannot be signed. Disables the button and says why. */
  blocked: string | null;
}) {
  const resolver = useResolver();
  const { sendTransactionAsync } = useSendTransaction();
  const { signMessageAsync } = useSignMessage();
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<Status>({ kind: "idle", message: "" });
  const [showReject, setShowReject] = useState(false);
  const [reason, setReason] = useState("");

  const disabled = !resolver.isResolver || isPending || status.kind === "busy";

  async function propose() {
    if (resolver.address === null) return;
    setStatus({ kind: "busy", message: "re-reading the market and simulating the call…" });

    const plan = await planResolution(draftId, resolver.address);
    if (!plan.ok) {
      setStatus({ kind: "error", message: plan.error });
      return;
    }

    setStatus({
      kind: "busy",
      message: `waiting for your wallet to sign proposeResolution(${plan.onchainId}, ${plan.outcome})…`,
    });

    let txHash: string;
    try {
      // `to` and `data` come from the server. Nothing here builds calldata.
      txHash = await sendTransactionAsync({
        to: plan.to as `0x${string}`,
        data: plan.data as `0x${string}`,
      });
    } catch (error) {
      // A rejected wallet prompt is a normal outcome, not a failure — the intent row stays PENDING
      // and the draft stays in the queue, so clicking again resumes it.
      setStatus({ kind: "error", message: `Not signed: ${firstLine(error)}` });
      return;
    }

    setStatus({ kind: "busy", message: "verifying the transaction against the node…" });

    startTransition(async () => {
      const recorded = await recordResolution(draftId, plan.intentId, txHash, resolver.address!);
      setStatus(
        recorded.ok
          ? { kind: "ok", message: recorded.settled, txHash: recorded.txHash }
          : { kind: "error", message: recorded.error },
      );
    });
  }

  async function reject() {
    if (resolver.address === null) return;
    const trimmed = reason.trim();
    if (trimmed.length < 3) {
      setStatus({ kind: "error", message: "A rejection needs a reason." });
      return;
    }

    setStatus({ kind: "busy", message: "waiting for your wallet to sign the rejection…" });

    // Fixed once, here, and reused for both the signature and the verification — so the timestamp
    // inside the signed text is the timestamp the server checks.
    const request = { draftId, onchainId, outcome, round, reason: trimmed, issuedAt: Date.now() };

    let signature: string;
    try {
      signature = await signMessageAsync({ message: await rejectionPreamble(request) });
    } catch (error) {
      setStatus({ kind: "error", message: `Not signed: ${firstLine(error)}` });
      return;
    }

    startTransition(async () => {
      const result = await submitDraftRejection(request, resolver.address!, signature);
      setStatus(
        result.ok
          ? { kind: "ok", message: "Refused, with the reason recorded in the audit log." }
          : { kind: "error", message: result.error },
      );
    });
  }

  return (
    <div className="border-t border-ink-800 px-4 py-3">
      {blocked !== null && (
        <p className="mb-3 rounded border border-warn-500/40 bg-warn-500/10 px-2.5 py-1.5 font-mono text-[11px] text-warn-500">
          cannot be signed: {blocked}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={propose}
          disabled={disabled || blocked !== null}
          className="rounded border border-ok-500/40 bg-ok-500/10 px-3 py-1.5 font-mono text-xs text-ok-500 transition-colors hover:border-ok-500/70 hover:bg-ok-500/20 disabled:cursor-not-allowed disabled:opacity-40"
        >
          ✓ Sign proposeResolution({onchainId}, {outcome})
        </button>
        <button
          type="button"
          onClick={() => setShowReject((open) => !open)}
          disabled={disabled}
          className="rounded border border-ink-700 bg-ink-850 px-3 py-1.5 font-mono text-xs text-ink-300 transition-colors hover:border-bad-500/50 hover:text-bad-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          ✖ Refuse this outcome
        </button>

        {!resolver.isResolver && (
          <span className="font-mono text-[11px] text-ink-500">
            connect the resolver wallet to decide
          </span>
        )}
      </div>

      {showReject && (
        <div className="mt-3 flex flex-col gap-2">
          <label
            htmlFor={`resolve-reason-${draftId}`}
            className="font-mono text-[10px] tracking-wide text-ink-400 uppercase"
          >
            why — recorded verbatim, and shown on this page afterwards
          </label>
          <textarea
            id={`resolve-reason-${draftId}`}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={2}
            maxLength={500}
            placeholder="e.g. the quoted sentence is about a different transfer, not the one this market asked about"
            className="w-full rounded border border-ink-700 bg-ink-850 px-3 py-2 font-mono text-xs text-ink-200 placeholder:text-ink-600 focus:border-signal-500/50 focus:outline-none"
          />
          <button
            type="button"
            onClick={reject}
            disabled={disabled}
            className="self-start rounded border border-bad-500/40 bg-bad-500/10 px-3 py-1.5 font-mono text-xs text-bad-500 transition-colors hover:bg-bad-500/20 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Sign refusal
          </button>
          <p className="text-[11px] leading-relaxed text-ink-500">
            Refusing sends no transaction and spends nothing. It is signed because a refusal leaves
            no trace on chain, so the record needs the same key behind it that a resolution has.
          </p>
        </div>
      )}

      <StatusLine status={status} />
    </div>
  );
}

/**
 * Challenge a resolution that is on chain and inside its window.
 *
 * The reason is emitted **on chain** by `challengeResolution`, so the dispute is part of the public
 * record rather than a support ticket. It is bounded server-side because it is calldata.
 */
export function ChallengeControls({
  marketRowId,
  onchainId,
  challengeEndsAt,
}: {
  marketRowId: string;
  onchainId: number;
  challengeEndsAt: number;
}) {
  const resolver = useResolver();
  const { sendTransactionAsync } = useSendTransaction();
  const [isPending, startTransition] = useTransition();
  const [status, setStatus] = useState<Status>({ kind: "idle", message: "" });
  const [reason, setReason] = useState("");

  const disabled = !resolver.isResolver || isPending || status.kind === "busy";

  async function challenge() {
    if (resolver.address === null) return;
    const trimmed = reason.trim();
    if (trimmed.length < 3) {
      setStatus({ kind: "error", message: "A challenge needs a reason — it goes on chain." });
      return;
    }

    setStatus({ kind: "busy", message: "checking the window is still open and simulating…" });

    const plan = await planChallenge(marketRowId, resolver.address, trimmed);
    if (!plan.ok) {
      setStatus({ kind: "error", message: plan.error });
      return;
    }

    setStatus({ kind: "busy", message: "waiting for your wallet to sign challengeResolution…" });

    let txHash: string;
    try {
      txHash = await sendTransactionAsync({
        to: plan.to as `0x${string}`,
        data: plan.data as `0x${string}`,
      });
    } catch (error) {
      setStatus({ kind: "error", message: `Not signed: ${firstLine(error)}` });
      return;
    }

    startTransition(async () => {
      const recorded = await recordChallenge(
        marketRowId,
        plan.intentId,
        txHash,
        resolver.address!,
        trimmed,
      );
      setStatus(
        recorded.ok
          ? { kind: "ok", message: recorded.settled, txHash: recorded.txHash }
          : { kind: "error", message: recorded.error },
      );
    });
  }

  const secondsLeft = useCountdown(challengeEndsAt);

  return (
    <div className="border-t border-ink-800 px-4 py-3">
      <p className="font-mono text-[11px] text-ink-400">
        challenge window{" "}
        {secondsLeft === null
          ? "closes"
          : secondsLeft > 0
            ? `closes in ~${secondsLeft}s`
            : "has closed"}{" "}
        — {new Date(challengeEndsAt * 1000).toISOString()}
      </p>
      <div className="mt-2 flex flex-col gap-2">
        <textarea
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          rows={2}
          maxLength={200}
          placeholder="why this outcome is wrong — written into the transaction, readable on MSTScan"
          className="w-full rounded border border-ink-700 bg-ink-850 px-3 py-2 font-mono text-xs text-ink-200 placeholder:text-ink-600 focus:border-signal-500/50 focus:outline-none"
        />
        <button
          type="button"
          onClick={challenge}
          disabled={disabled || (secondsLeft !== null && secondsLeft <= 0)}
          className="self-start rounded border border-warn-500/40 bg-warn-500/10 px-3 py-1.5 font-mono text-xs text-warn-500 transition-colors hover:bg-warn-500/20 disabled:cursor-not-allowed disabled:opacity-40"
        >
          ⚑ Sign challengeResolution({onchainId})
        </button>
        <p className="text-[11px] leading-relaxed text-ink-500">
          A challenge returns the market to <span className="font-mono">CLOSED</span> and discards
          the proposed outcome, so it must be re-proposed with fresh evidence. The reason is
          emitted on chain. Only after three challenges does the admin escape hatch unlock — and not
          before, which is why it cannot be used to cancel an inconvenient market.
        </p>
      </div>
      <StatusLine status={status} />
    </div>
  );
}

/**
 * Seconds until `deadline` (unix seconds), ticking once a second.
 *
 * A countdown computed during render would be a render that depends on the clock — it would show a
 * stale number until something unrelated caused a re-render, and would disagree between the server
 * render and the first client one. It starts at `null` and fills in after mount, so the server and
 * the client render the same markup.
 *
 * The number is advisory. The *control* is the contract: `challengeResolution` reverts with
 * `ChallengeWindowClosed` past the deadline, and `prepareChallenge` re-reads the window from the
 * chain before encoding anything. This countdown reaching zero a second early or late changes
 * nothing about what the chain will accept.
 */
function useCountdown(deadline: number): number | null {
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  useEffect(() => {
    const update = (): void => setSecondsLeft(deadline - Math.floor(Date.now() / 1000));
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [deadline]);

  return secondsLeft;
}
