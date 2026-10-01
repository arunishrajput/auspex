# Contributing to AuspeX

Thanks for looking. AuspeX is maintained by one person, so the most useful contributions are the ones
that are easy to review: small, tested, and honest about what they change.

**AuspeX's only real claim is that its claims can be checked.** Every rule below exists to keep that
true. A pull request that makes the product look better by making a claim less true will be declined,
however good the code is — and a pull request that makes a claim *more* true, even by adding a
limitation to the README, is one of the best things you can send.

## Ways to help

- **Try to break it.** Press the cap probe on [`/trust`](https://auspex-web-mu.vercel.app/trust), read
  the contract, look for a path where a model's output decides something without a human or the chain
  in the way. Security issues go through [`SECURITY.md`](./SECURITY.md), not a public issue.
- **Check a claim.** Every hash in the README should resolve on `testnet.mstscan.com` and be sent by
  the address named beside it. `pnpm check:links` automates this; if you find one it missed, that is a
  bug in the checker too.
- **Fix something in *Limitations*.** The README's list is a roadmap as much as a confession —
  separating the market creator from the resolver, calibrating resolution retrieval on outcome
  articles, a longer challenge window with a veto-shaped human gate.
- **Improve the docs**, especially for someone setting up their own deployment.

Open an issue before starting anything large, so we can agree on the shape first.

## Getting set up

You need Node ≥ 22 and pnpm 11. With no accounts and no secrets:

```bash
pnpm install
pnpm compile
pnpm test
pnpm dev        # reads the live contract read-only; database panels say so instead of guessing
```

That is enough for UI, contract, policy-gate and schema work. For a full deployment of your own —
contract, human wallet, agents, database — follow [`docs/SELF_HOSTING.md`](./docs/SELF_HOSTING.md).

Before changing anything substantial, read [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) and
[`docs/TRUST_MODEL.md`](./docs/TRUST_MODEL.md). If you are touching the contract, also
[`docs/CONTRACTS.md`](./docs/CONTRACTS.md).

## The rules

These are not style preferences. Breaking one damages the thing the product exists to prove.

1. **Never fake chain data.** Every contract address, transaction hash and balance anywhere — UI,
   docs, tests that render, logs — must be real and resolvable on `https://testnet.mstscan.com`.
   (Not `mstscan.com`: it indexes a different chain, and a link there looks exactly like a fabrication.)
2. **Never present mock data as real.** Every number on a page goes through `<Provenance>` with its
   origin — `CHAIN`, `INDEXED`, `DB`, `COMPUTED`, `EXTERNAL`. A `MOCK` origin throws in a production
   build, and CI fails if one is reachable (`pnpm --filter web check:provenance`).
3. **Authority never lives in a model.** An LLM may only *propose*. Anything that moves money or
   reaches a user passes through deterministic code, a human signature, or the contract. If a change
   lets model output decide an amount, an approval or an outcome, it will not be merged.
4. **Untrusted text is delimited.** News and model output are untrusted. News goes into a
   **user-role** message inside `<untrusted_content>` tags, never a system instruction. Model output
   is schema-constrained at the API *and* re-validated with Zod before use.
5. **Every state-changing step is idempotent.** A crashed and re-run worker must not create a market
   or place a bet twice. Off-chain: unique keys and `SELECT … FOR UPDATE SKIP LOCKED`. On-chain:
   write the `OnChainIntent` row *before* broadcasting. Only `web/lib/intents/engine.ts` broadcasts
   from the pipeline.
6. **Fail safe, stay up.** A failed or rate-limited model call means *no action*, a logged reason,
   and a tick that continues. A 429 must never crash a tick or leave a half-written record.
7. **Log every decision with a reason** — approvals *and* refusals. Refusals are the evidence that the
   gates are real; they are never deleted.
8. **Secrets live only in `.env.local`.** Never commit a key, never print one, and never add
   `DEPLOYER_PRIVATE_KEY` to a hosted environment — the deployed app holding no admin key is a
   property the trust model depends on (ADR-047).
9. **Look at the rendered page, not just the JSX.** Several defects in this project were invisible in
   source and obvious on screen. For UI changes, include a screenshot in the PR.
10. **Prefer the boring, explainable solution.** One person has to be able to defend and change every
    line.

## Before you open a pull request

CI runs these on every push; running them first saves a round trip.

```bash
pnpm --filter contracts compile && pnpm --filter contracts test && pnpm --filter contracts typecheck
pnpm --filter web typecheck && pnpm --filter web lint && pnpm --filter web test
pnpm --filter web build
pnpm --filter web check:provenance
```

And, when relevant:

| If you changed… | Also run |
|---|---|
| a colour, a tone, or a surface | `pnpm --filter web check:contrast` — colour is semantic here; read ADR-071, ADR-074 and ADR-079 first |
| layout | `pnpm --filter web check:render` (needs Playwright; it explains itself if it is missing) |
| a hash, address or sender in the README | `pnpm check:links` |
| the contract | its tests, and say in the PR whether it needs a redeploy — the deployed contract is immutable |

**Colours mean things.** Blue is a model proposing, amber is deterministic code, violet is a human,
green is the chain, red is a refusal, and orange is chrome that never marks a fact. A new colour, or an
existing one used for a different meaning, needs a reason in the PR.

## Decisions and documentation

- **Architectural choices get an ADR** in [`docs/DECISIONS.md`](./docs/DECISIONS.md): what was
  decided, why, what it costs, and the evidence. Number it after the last one.
- **State limitations plainly.** If your change introduces one, add it to the README's
  *Limitations* section in the same PR. Date measurements; don't round claims up.
- **The build record is history.** `PROGRESS.md`, `docs/BUILD_PLAN.md` and `docs/DECISIONS.md` record
  how the system was built, including what went wrong. Add to them; don't rewrite them.
  [`docs/BUILD_RECORD.md`](./docs/BUILD_RECORD.md) explains why.
- **`CLAUDE.md`** holds the same rules for AI coding assistants working in this repository. If you
  change a rule here, change it there too.

## Commits

Plain sentences that say what changed, with the reason in the body when it is not obvious — the
existing history (`git log`) is the style guide. One logical change per commit.

## Licence

By contributing, you agree that your contributions are licensed under the [MIT License](./LICENSE),
the same as the rest of the project.

## Conduct

Everyone taking part is expected to follow the [Code of Conduct](./CODE_OF_CONDUCT.md).
