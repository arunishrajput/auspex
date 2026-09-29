/**
 * What kind of key signed a transaction, and what may honestly be claimed about a set of them.
 *
 * ## Why this file exists
 *
 * `onchain_intents.signer` has two values, `SERVER` and `EXTERNAL`, and they answer a narrow
 * question: did our code build and sign these bytes, or did a browser wallet? That is the right
 * distinction for the intent engine, and it is the **wrong** distinction for a page making a trust
 * claim, because `SERVER` covers two keys with nothing in common:
 *
 *   - an **agent key**, which the deployed application genuinely holds, and which the contract
 *     caps to a fraction of a tMSTC and grants no role at all;
 *   - the **operator key**, which holds `DEFAULT_ADMIN_ROLE`, lives in a laptop's `.env.local` and
 *     is deliberately absent from the deployment (ADR-047).
 *
 * Rendering both as "server key" understates one and, far worse, overstates the other: it tells a
 * reader that the deployed application holds an admin key, which is the single most damaging thing
 * this app could imply about itself, and it is false.
 *
 * So the label is derived from **what the contract says about the address** — one `hasRole` read —
 * rather than from an enum our own writer chose. If the two ever disagreed, the chain is right.
 *
 * ## And why the caption is computed rather than written
 *
 * `/markets/8` used to end with a fixed sentence: *"a market is created by a browser wallet …
 * there is no row in which a privileged server key moved money."* That is true of markets 4–7 and
 * 9. It is **false of market 8**, which was driven end to end by the operator key, because
 * demonstrating a payout needed a market with two sides and none existed. The sentence sat directly
 * underneath a table that contradicted it.
 *
 * A caption that asserts something about rows it has not looked at will eventually contradict them.
 * `lifecycleClaim` looks at them. It is pure, so it is tested from both sides.
 */

import type { Provider } from "ethers";
import { hasRole } from "./roles";
import { listBettingMembers } from "../agents/members";

export type SignerKind =
  /** A wallet on a person's machine. This repository has never held the key. */
  | "BROWSER"
  /** A per-member agent key the deployment holds. Capped by the contract, holding no role. */
  | "AGENT"
  /** Holds `DEFAULT_ADMIN_ROLE`. Not in the deployment — a local operator action. */
  | "OPERATOR"
  /** Our code signed it, the address is neither a known agent nor an admin. */
  | "SERVER";

export type SignerFact = {
  address: string;
  kind: SignerKind;
  /** Two or three words for the table cell. */
  label: string;
  /** One clause for the legend beneath it: where this key lives. */
  note: string;
  /** True only for a key the deployed application can sign with. */
  heldByDeployment: boolean;
};

const BROWSER: Omit<SignerFact, "address"> = {
  kind: "BROWSER",
  label: "browser wallet",
  note: "a wallet on a person's machine — this repository has never held the key",
  heldByDeployment: false,
};

/**
 * Classifies every distinct address in a set of intent rows.
 *
 * One `hasRole(DEFAULT_ADMIN_ROLE, …)` per distinct non-browser address, so a lifecycle table with
 * two server-signed addresses costs two `eth_call`s. Members are listed once.
 *
 * **Never throws.** A page whose signer column is the trust claim must not 500 because the RPC
 * blinked; an address we could not classify falls back to `SERVER`, which is what the column said
 * before this function existed and is the conservative answer.
 */
export async function classifySigners(
  rows: readonly { signer: string; fromAddress: string }[],
  provider?: Provider,
): Promise<Map<string, SignerFact>> {
  const facts = new Map<string, SignerFact>();

  const browser = new Set<string>();
  const server = new Set<string>();
  for (const row of rows) {
    const address = row.fromAddress.toLowerCase();
    if (row.signer === "EXTERNAL") browser.add(address);
    else server.add(address);
  }

  for (const address of browser) facts.set(address, { address, ...BROWSER });
  if (server.size === 0) return facts;

  // Agent handles make the cell say *which* agent, which is the difference between "a key we hold"
  // and "atlas's key, capped at 0.02 per transaction".
  const agents = new Map<string, string>();
  try {
    for (const member of await listBettingMembers()) {
      agents.set(member.agentAddress.toLowerCase(), member.handle);
    }
  } catch {
    // Postgres is down. The admin read below is the load-bearing one and does not need this.
  }

  await Promise.all(
    [...server].map(async (address) => {
      const handle = agents.get(address);
      if (handle !== undefined) {
        facts.set(address, {
          address,
          kind: "AGENT",
          label: `agent key · ${handle}`,
          note: "held by the deployed application, capped on chain, holding no role",
          heldByDeployment: true,
        });
        return;
      }

      let isAdmin = false;
      let read = true;
      try {
        isAdmin = await hasRole("DEFAULT_ADMIN_ROLE", address, provider);
      } catch {
        read = false;
      }

      if (read && isAdmin) {
        facts.set(address, {
          address,
          kind: "OPERATOR",
          label: "operator key",
          note: "holds DEFAULT_ADMIN_ROLE — kept in a local .env.local, deliberately not in the deployment",
          heldByDeployment: false,
        });
        return;
      }

      facts.set(address, {
        address,
        kind: "SERVER",
        label: read ? "server key" : "server key (unverified)",
        note: read
          ? "our code signed this, and the address holds no admin role"
          : "our code signed this; the role read failed, so this is the conservative label",
        heldByDeployment: true,
      });
    }),
  );

  return facts;
}

/** The calls that move tMSTC. `closeMarket` and the resolution calls move none. */
const MOVES_MONEY = new Set(["PLACE_BET", "CLAIM"]);

export type ClaimRow = {
  kind: string;
  status: string;
  valueWei: string;
  signerKind: SignerKind;
};

export type LifecycleClaim = {
  /** The one sentence that is true of exactly these rows. */
  headline: string;
  /** Sentences that qualify it. Empty when nothing needs qualifying. */
  detail: string[];
};

/**
 * The strongest claim these rows actually support. **Pure.**
 *
 * The ordering is deliberate: the qualification comes *before* the boast in `detail`, because a
 * reader who stops after one sentence should have read the weaker statement rather than the
 * stronger one.
 */
export function lifecycleClaim(rows: readonly ClaimRow[]): LifecycleClaim {
  if (rows.length === 0) {
    return {
      headline:
        "No intents are recorded for this market, so there is no signer column to read — the transactions on MSTScan are the record.",
      detail: [],
    };
  }

  const operatorRows = rows.filter((row) => row.signerKind === "OPERATOR");
  // `status` matters as much as `valueWei`: a REVERTED placeBet carried value into a call the
  // contract refused, so nothing was staked. Counting it would overstate what the operator did —
  // in the self-critical direction, but wrong is wrong, and the whole point of this function is
  // that the sentence matches the rows.
  const operatorMovedMoney = operatorRows.filter(
    (row) => MOVES_MONEY.has(row.kind) && row.valueWei !== "0" && row.status === "CONFIRMED",
  );
  const browserCalls = [...new Set(rows.filter((r) => r.signerKind === "BROWSER").map((r) => r.kind))];
  const agentCalls = [...new Set(rows.filter((r) => r.signerKind === "AGENT").map((r) => r.kind))];

  if (operatorRows.length === 0) {
    const detail: string[] = [];
    if (browserCalls.length > 0) {
      detail.push(
        `Signed in a browser wallet: ${format(browserCalls)} — a key this repository has never held.`,
      );
    }
    if (agentCalls.length > 0) {
      detail.push(
        `Signed by an agent key the deployment holds: ${format(agentCalls)} — capped on chain, holding no role.`,
      );
    }
    return {
      headline:
        "No call on this market was signed by a key holding a privileged role, and that is checkable on MSTScan without trusting this page.",
      detail,
    };
  }

  const detail: string[] = [
    `Signed by the operator key: ${format([...new Set(operatorRows.map((r) => r.kind))])}. ` +
      `That key holds DEFAULT_ADMIN_ROLE and lives in a local .env.local — it is deliberately absent from the deployment, ` +
      `so these were operator actions taken from a laptop, not something the running application can do.`,
  ];
  if (operatorMovedMoney.length > 0) {
    detail.push(
      `${operatorMovedMoney.length === 1 ? "One of them staked" : `${operatorMovedMoney.length} of them staked`} tMSTC. ` +
        `On a market labelled as a test in its own on-chain question text that is an operator standing in for a bettor; on a product market it would not be acceptable.`,
    );
  }
  if (agentCalls.length > 0) {
    detail.push(
      `Signed by an agent key the deployment holds: ${format(agentCalls)} — capped on chain, holding no role. ` +
        `None of those calls requires a role, which is why a wallet holding none could make them.`,
    );
  }
  if (browserCalls.length > 0) {
    detail.push(`Signed in a browser wallet: ${format(browserCalls)}.`);
  }

  return {
    headline:
      "Read the signed by column: this market was driven in part by the operator key, so it demonstrates the contract's mechanism rather than the human gate.",
    detail,
  };
}

function format(kinds: readonly string[]): string {
  const labels = kinds.map((kind) => KIND_LABELS[kind] ?? kind);
  if (labels.length <= 1) return labels.join("");
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

/** Duplicated deliberately from the page's map so this module stays pure and testable. */
const KIND_LABELS: Record<string, string> = {
  CREATE_MARKET: "createMarket",
  PLACE_BET: "placeBet",
  CLOSE_MARKET: "closeMarket",
  PROPOSE_RESOLUTION: "proposeResolution",
  CHALLENGE_RESOLUTION: "challengeResolution",
  FINALIZE_RESOLUTION: "finalizeResolution",
  INVALIDATE_STALE: "invalidateStale",
  CLAIM: "claim",
  REGISTER_AGENT: "registerAgent",
};
