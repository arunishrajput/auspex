# Security policy

AuspeX runs on **MST Testnet**. It is **not audited**, tMSTC has no monetary value, and there is no
bug bounty. Its entire proposition is still that an AI cannot move money or decide anything
without a human and the contract agreeing — so a way around that is exactly the report this project
wants most.

## Reporting a vulnerability

**Please do not open a public issue.** Report privately through GitHub:

**[Report a vulnerability →](https://github.com/arunishrajput/auspex/security/advisories/new)**
(the repository's **Security** tab → *Report a vulnerability*)

Include what you found, how to reproduce it, and what it lets someone do. If it involves the chain, a
transaction hash on `testnet.mstscan.com` is the best evidence there is.

This is maintained by one person, so responses are best-effort. You will get an acknowledgement, a
fix or a reasoned explanation, and credit in the advisory if you want it.

## What is in scope

Anything that breaks one of the boundaries the project claims, for example:

- **The contract** (`contracts/contracts/AuspexMarket.sol`): an agent betting over its per-transaction
  or per-market cap; a role-less address creating, resolving or challenging a market; `claim()`
  paying anyone but the registered owner; finalising inside the challenge window; claiming twice;
  funds that can be locked with no permissionless way out.
- **The server's authority checks**: a server action (`web/app/actions.ts`, `web/app/*/actions.ts`) that changes state
  without re-verifying who is asking; `/api/tick` or `/api/sync` callable without the secret.
  Two actions are public on purpose: **Run tick** (`runTickAction`) is bounded by a cooldown and by
  the tick being idempotent, and `settleNow()` only makes calls that are permissionless on chain anyway.
- **The model boundary**: any path where model output decides an amount, an approval or an outcome
  without passing the policy gate, a human signature or the contract; untrusted news text reaching a
  system instruction; output used without schema validation.
- **Secrets**: an agent key recoverable without `AGENT_KEY_ENC_SECRET`; any key, connection string
  or token exposed in a page, a log or the repository.
- **Integrity of the evidence**: a way to make the dashboard show a chain value that is not on chain,
  or show data without its provenance.

The **cap probe** on `/trust` is meant to be pressed — it asks the contract to refuse a real
over-cap bet. Using it as intended is not an attack; please don't automate it, and don't run load or
denial-of-service tests against the live deployment, the public RPC or the explorer.

## Known limitations — by design, not vulnerabilities

These are documented in the README's *Limitations* section and in
[`docs/TRUST_MODEL.md`](./docs/TRUST_MODEL.md). Reports that only restate them will be closed with a
pointer there, though ideas for removing them are very welcome as ordinary issues.

- **Resolution is trusted.** A small authorised set submits outcomes; it is not a decentralised oracle.
- **The market creator and the resolver are currently the same wallet.**
- **The challenge window is 120 seconds** and immutable — far too short for production.
- **Agent keys are held by the server**, encrypted at rest. The on-chain caps, not the encryption, are
  what bound the risk; a full server compromise can lose at most each agent's capped stake.
- **Source independence is heuristic**, and **prompt injection is bounded, not solved** — at worst it
  produces a plausible wrong *proposal* that a human must still approve.
- **Re-org handling is a 3-block confirmation depth**, adequate for a 3-second-block testnet only.

## Supported versions

Only the latest release on `main`, and the contract deployed at
[`0xc4743d6295311AFead12161881Bfcf601B70104C`](https://testnet.mstscan.com/address/0xc4743d6295311AFead12161881Bfcf601B70104C).
The contract is immutable; a contract-level fix ships as a new deployment.
