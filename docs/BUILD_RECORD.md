# BUILD_RECORD.md — the engineering log, and why it is still here

AuspeX was built in eight phases between 2026-09-27 and 2026-09-30, originally as an entry for a
24-hour buildathon. The event has ended. The product stands on its own now, and the surfaces a user
or a contributor reads no longer mention a competition.

**The log of how it was built is kept in full.** Nothing in it has been renumbered, backdated,
softened or deleted. This page says which files are the record, what each one is, and why keeping
them was the right call rather than an oversight.

---

## The record

| File | What it is |
|---|---|
| [`../PROGRESS.md`](../PROGRESS.md) | The session-by-session build state: what each phase shipped, the real artifacts it produced, the defects it found, and a "known gaps" list with measurements attached. ~2,000 lines. |
| [`BUILD_PLAN.md`](./BUILD_PLAN.md) | The phase plan, with the tasks and exit criteria each phase was held to. Part I is phases 0–8; Part II is 9–12, the turn from entry into product. |
| [`DECISIONS.md`](./DECISIONS.md) | 79 architecture decision records as of v1.0.0. What was decided, why, what it cost, and the evidence. This is the most useful file in the repository for anyone changing the system. |
| [`../video/`](../video/) | The four-minute demo film and its Remotion source. Made in September 2026 for the event, which its end card names. Frozen as rendered. |
| [`WALKTHROUGH.md`](./WALKTHROUGH.md) | A reader's tour of the live system with the verified hash table. It began as a presenter's script for a table at the event and was rewritten for a reader with no presenter. |
| [`original-brief-2026-09.pdf`](./original-brief-2026-09.pdf) | The event's own brief, which the first sections of `PRD.md` were written against. Kept out of the repository root and kept at all, because "what was actually asked for" is the only way to judge what was built against it. |

Everything else in `docs/` is current product documentation:
[`PRD.md`](./PRD.md), [`ARCHITECTURE.md`](./ARCHITECTURE.md), [`TRUST_MODEL.md`](./TRUST_MODEL.md),
[`CONTRACTS.md`](./CONTRACTS.md), [`RUNBOOK.md`](./RUNBOOK.md).

**One line outside the record still names the event, on purpose.** `RUNBOOK.md`'s setup checklist
records that the Gemini API key in use is listed in Google Cloud as *"AuspeX MST Buildathon"*. That is
the credential's real display name, it is how the owner finds it in the console, and inventing a
different one would make the runbook wrong about something an operator has to look up. It is dated and
labelled cosmetic where it appears.

---

## Why it was kept

The full argument is [ADR-068](./DECISIONS.md). The short version:

**This product's proposition is that its claims can be checked.** It says an AI cannot move money,
that a human signs for every market, that the contract has refused ten transactions. What makes
those sentences credible is not their confidence — it is that the log beside them records every time
the project believed something flattering about itself and was proved wrong by its own output.

There are at least seven of those, each with an ADR: a similarity threshold that was wrong
(ADR-060), a caption that contradicted the table printed under it (ADR-065), a signer column that
implied the deployment held an admin key (ADR-065 again), a keeper that would have left a bettor's
stake locked forever (ADR-066b), a lifecycle table that could not see half its own transactions
(ADR-067), a notification path that was arithmetically incapable of being fast (ADR-066a), and a
footer that named market id ranges and was wrong about four of thirteen markets (ADR-070).

Deleting that history to look as though the project arrived finished would remove the evidence for
the only thing it is actually selling. It would also be the same mistake the codebase refuses in
half a dozen smaller places: `<Provenance>` exists so no number can be shown without saying where it
came from, and `check:links` exists because a flattering sentence beside a real hash is worse than a
broken link.

**The cost, stated plainly.** A reader will find a build log describing a 24-hour competition inside
a repository that no longer mentions one. That is mildly incongruous. It is paid for by this page
rather than by hiding anything.

---

## Two things in the record cannot be changed at all

**Four markets carry build-phase labels in their on-chain question text.** Markets 3 and 8 begin
`[Phase 2 idempotency test …]` and `[Phase 6 lifecycle test …] Not a product market.` Those strings
are immutable — they are stored in contract state on chain 91562037 and there is no setter. They
were written by the build process to prove the contract worked, they say so in their own text, and
none is presented anywhere as a product market. Markets 1 and 2 are also commissioning markets, and
they are the weaker case: they ask whether AuspeX itself would have a verified contract, which is
plainly not a product question, but they never label themselves tests. `/markets` says exactly that,
computed from the rows rather than asserted over them.

**Stored identifiers keep the names they were written with.** The `/trust` page's cap probe was built
under the name "judge mode", and five `audit_log` rows exist under the action `judge.cap_probe`.
`audit_log` is append-only. The label changed and the identifier did not, because one event should
have one name in a log that cannot be rewritten. [ADR-069](./DECISIONS.md) has the reasoning; the
`/trust` page says it on the page, beside the rows.

---

## Reading it usefully

If you are changing the system, read `DECISIONS.md` and nothing else — it is indexed by decision and
every entry states its cost. `PROGRESS.md` is worth searching rather than reading: its "Known gaps"
section is the honest list of what is still wrong, and the per-phase "what measurement changed"
sections are where the defects live.

The phase numbers in code comments are cross-references into this log. `// ADR-047` or `// Phase 5`
in a comment means "the argument for this is written down" — they are load-bearing, not leftovers.
