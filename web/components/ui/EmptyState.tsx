/**
 * Nothing here, and why.
 *
 * An empty state on these pages is never just "no results": an empty market list and an
 * unreachable contract look identical and mean opposite things, so every use says which it is.
 * The accent is safe to be loud here — there is no data on screen to confuse it with.
 */

import type { ReactNode } from "react";

export function EmptyState({
  title,
  children,
}: {
  title: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-dashed border-ink-700 bg-ink-900 px-6 py-12 text-center">
      <p className="font-display text-lg text-ink-200">{title}</p>
      {children !== undefined && (
        <div className="mx-auto mt-2 max-w-md text-xs leading-relaxed text-ink-400">{children}</div>
      )}
    </div>
  );
}
