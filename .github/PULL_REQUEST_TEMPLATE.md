## What this changes

<!-- One or two sentences. -->

## Why

<!-- The problem, and why this is the boring, explainable fix. Link an issue if there is one. -->

## How it was checked

<!-- Commands run and what they printed; for UI, a screenshot of the rendered page. -->

## Checklist

- [ ] `pnpm --filter contracts test` · `pnpm --filter web typecheck` · `pnpm --filter web lint` · `pnpm --filter web test` pass
- [ ] `pnpm --filter web build` and `pnpm --filter web check:provenance` pass
- [ ] Every hash, address and balance shown or documented is real and resolves on `testnet.mstscan.com`
- [ ] No model output decides an amount, an approval or an outcome without a human, deterministic code or the contract
- [ ] No secret, key or connection string in the diff, the logs or the screenshots
- [ ] Colour changes passed `pnpm --filter web check:contrast` (or there are none)
- [ ] An architectural choice has an ADR in `docs/DECISIONS.md`; a new limitation is in the README (or neither applies)
