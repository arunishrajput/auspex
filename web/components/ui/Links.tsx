/**
 * Links off this site, and the two kinds that point at the chain.
 *
 * `ExtLink` existed as the same class string in twenty-two places, half of them with
 * `break-all` because a raw URL in a table will otherwise widen the page past the viewport —
 * which is how `/markets` got a horizontal scrollbar on a phone.
 *
 * `TxLink` and `AddressLink` exist because abbreviating a hash by hand is a reliable way to
 * introduce an error: four of the first twenty-seven abbreviations written into the README were
 * wrong, which is why `pnpm check:links` now verifies prefix *and* suffix against the chain.
 * A component that takes the full value and does the shortening itself removes the chance.
 * Both always carry the full value in `title`, so a reader can check it without leaving.
 */

import type { ReactNode } from "react";
import { explorerUrl, shortHash } from "@/lib/chain";

export type ExtLinkProps = {
  href: string;
  children: ReactNode;
  /** For a raw URL or a full hash rendered inline. Wraps mid-token rather than overflowing. */
  wrap?: boolean;
  title?: string;
  className?: string;
};

export function ExtLink({ href, children, wrap, title, className }: ExtLinkProps) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      title={title}
      className={`text-signal-500 underline-offset-[3px] transition-colors hover:text-ink-100 hover:underline ${wrap ? "break-all" : ""} ${className ?? ""}`}
    >
      {children}
    </a>
  );
}

/** A transaction on MSTScan. `testnet.mstscan.com` — the other one indexes a different chain. */
export function TxLink({
  hash,
  label,
  className,
}: {
  hash: string;
  /** Replaces the abbreviated hash — "created in", "reverted here". The hash is then in `title`. */
  label?: ReactNode;
  className?: string;
}) {
  return (
    <ExtLink
      href={explorerUrl("tx", hash)}
      title={hash}
      className={`font-mono ${className ?? ""}`}
    >
      {label ?? shortHash(hash, 8, 6)} ↗
    </ExtLink>
  );
}

/** An address on MSTScan. */
export function AddressLink({
  address,
  lead = 8,
  tail = 6,
  className,
}: {
  address: string;
  lead?: number;
  tail?: number;
  className?: string;
}) {
  return (
    <ExtLink
      href={explorerUrl("address", address)}
      title={address}
      className={`font-mono ${className ?? ""}`}
    >
      {shortHash(address, lead, tail)}
    </ExtLink>
  );
}

/** A value that is code — a function name, a column, a role constant. Not a link. */
export function Mono({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={`font-mono text-ink-200 ${className ?? ""}`}>{children}</span>;
}
