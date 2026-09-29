/**
 * The deterministic policy gate. **Pure: no network, no database, no clock, no LLM.**
 *
 * `docs/TRUST_MODEL.md` §4 calls this the most important file in the repository for the trust
 * argument, and the reason is one sentence: **the agent proposes a number and this file decides
 * the number.** Those are different jobs, done by different code, and only one of them is
 * deterministic.
 *
 * Everything it needs is passed in — the time, the balances, the on-chain caps, the day's spend.
 * Nothing is read. That is what makes every branch below testable by calling a function with
 * numbers, which is why the test file next to it can pin exactly-at-cap and one-wei-over-cap
 * behaviour without a chain, a database or a model.
 *
 * ## Two functions, because a gate that runs too late costs money it did not need to spend
 *
 *   `screenAgent`  — everything decidable *before* asking a model anything.
 *   `policyGate`   — the rest, plus the clamping, once a proposal exists.
 *
 * `screenAgent` exists so a member whose kill switch is on, or whose policy does not allow the
 * market's category, never consumes an LLM call. It is not a second gate: `policyGate` calls it
 * internally, so the full check runs whether or not the caller screened first. Splitting it
 * avoids the usual alternative, which is duplicating five conditions in the caller and letting
 * them drift.
 *
 * ## Clamp, never trust
 *
 *     finalStake = min( requested,
 *                       off-chain per-tx cap,
 *                       remaining daily budget,
 *                       on-chain per-tx cap,
 *                       remaining on-chain per-market headroom,
 *                       spendable balance )
 *
 * Six limits, and the smallest wins. Two of them come from the chain and would hold even if
 * this file were deleted; the contract enforces them again on the way in. A clamp that actually
 * binds is recorded in `reasons` **even when the bet is allowed**, because "allowed, at a tenth
 * of what it asked for" is the interesting case and an approval with no reasons hides it.
 *
 * ## REJECT versus DEFER, and why getting this wrong is expensive
 *
 * `agent_decisions` is unique on `(market_id, member_id, round)`. So writing a decision row is
 * *terminal* for that pair at that round — exactly like `proposals.event_id` in Phase 4, where
 * collapsing "the answer was wrong" into "there was no answer" would have poisoned a confirmed
 * event on the strength of a 429.
 *
 * The rule this file follows:
 *
 *   **REJECT** when the reason can never change for this market and this member — the market is
 *   closed, its category is not in the policy, the model abstained, its confidence was below the
 *   threshold. A row is written, kept and displayed. These rows are the evidence the gate is
 *   real (hard rule #7).
 *
 *   **DEFER** when the reason is a condition of *right now* — a kill switch that can be flipped
 *   back, an agent not registered on chain yet, an unfunded wallet, a daily budget that resets
 *   at midnight. No row is written, nothing is foreclosed, and the next tick reconsiders.
 *
 * A deferral is still logged with its reason. "Nothing happened" and "nothing ran" are
 * indistinguishable otherwise.
 */

/** Minimum stake worth sending: 0.0001 tMSTC. Below this the contract's `ZeroStake` looms and
 *  the transaction costs more attention than the position is worth. */
export const MIN_STAKE_WEI = 10n ** 14n;

/**
 * How close to `closeTime` a bet may still be placed.
 *
 * The contract rejects a bet at or after `closeTime` (`BettingClosed`). Refusing a minute early
 * turns a race between our tick and the chain's clock into a plain recorded reason.
 */
export const MIN_SECONDS_BEFORE_CLOSE = 60;

/** Basis-point precision for turning the model's fraction into wei. See `requestedStake`. */
const BASIS_POINTS = 10_000n;

export type PolicyLimits = {
  /** The operator's per-transaction ceiling. Tunable without a transaction. */
  perTxCapWei: bigint;
  /** Across every market, per calendar day (UTC). The caller supplies the day's spend. */
  dailyBudgetWei: bigint;
  /** A proposal at or above this confidence may proceed. The threshold is policy, not the
   *  model's to choose — see ADR-041's reasoning applied to money. */
  minConfidence: number;
  allowedCategories: readonly string[];
  /** Per-member halt. Stops betting without touching the contract. */
  killSwitch: boolean;
};

/** The contract's own view of this agent, read live. Authoritative over anything we store. */
export type OnChainLimits = {
  registered: boolean;
  active: boolean;
  perTxCapWei: bigint;
  perMarketCapWei: bigint;
  /** `agentRemainingOnMarket(marketId, agent)` — cap minus what it has already staked here. */
  remainingOnMarketWei: bigint;
  /** Where the contract will pay this agent's winnings. Lowercase. */
  owner: string;
};

export type MarketFacts = {
  onchainId: number;
  /** From the human-approved spec. A fixed enum — see `lib/proposer/schema.ts`. */
  category: string;
  /** Unix seconds, as the contract stores it. */
  closeTime: number;
  /** The contract's state name, read from the chain rather than from our projection. */
  state: string;
};

export type ScreenInput = {
  /** `AGENTS_KILL_SWITCH`. Halts every agent at once, off-chain. */
  globalKillSwitch: boolean;
  policy: PolicyLimits;
  market: MarketFacts;
  onChain: OnChainLimits;
  /** Wei this member has already committed today, across all markets. */
  spentTodayWei: bigint;
  /** The agent wallet's native balance. */
  agentBalanceWei: bigint;
  /** Held back for gas, so a bet cannot leave the wallet unable to send the next one. */
  gasReserveWei: bigint;
  /** The owner address we believe this agent has. Compared against the chain's. */
  memberOwnerAddress: string;
  /** Unix seconds. **Injected** — this file never reads a clock. */
  now: number;
};

export type ScreenVerdict =
  /** Nothing off-chain stands in the way. Worth spending an LLM call on. */
  | "PROCEED"
  /** Terminal for this market and member. Write the decision row. */
  | "REJECT"
  /** True right now and not forever. Write no row; log and retry next tick. */
  | "DEFER";

export type ScreenResult = { verdict: ScreenVerdict; reasons: string[] };

export type GateInput = ScreenInput & {
  proposal: {
    side: "YES" | "NO" | "ABSTAIN";
    confidence: number;
    /** Share of the off-chain per-tx cap. The model never names an amount — see `schema.ts`. */
    stakeFraction: number;
    sourceLabels: readonly string[];
  };
  /** Exactly the `SOURCE_n` labels this agent was shown. A cited label we never issued is a
   *  fabrication, and a rationale resting on one is worthless. */
  issuedLabels: readonly string[];
};

export type GateDecision = {
  allow: boolean;
  /** Machine-readable prefix, then a sentence. Stored verbatim and rendered verbatim. */
  reasons: string[];
  /** What the gate permits. Zero whenever `allow` is false. */
  finalStakeWei: bigint;
  /** What the proposal worked out to before any clamp, so the UI can show both. */
  requestedStakeWei: bigint;
  /** Which limit produced `finalStakeWei`, or null when the request passed unclamped. */
  boundBy: string | null;
  /** Terminal, or true-for-now. Mirrors `screenAgent`, so the caller has one thing to switch on. */
  verdict: ScreenVerdict;
};

function minOf(values: readonly bigint[]): bigint {
  return values.reduce((low, value) => (value < low ? value : low));
}

function clampToZero(value: bigint): bigint {
  return value > 0n ? value : 0n;
}

/**
 * Remaining daily allowance. Never negative, however far a past overspend went.
 *
 * Takes the two numbers rather than the whole `ScreenInput` on purpose: the budget lives at
 * `policy.dailyBudgetWei` and the spend at the top level, and a helper that accepted the wide
 * object would read `input.dailyBudgetWei` as `undefined` at any call site that forgot to reach
 * one level in. That is exactly the mistake this signature refuses to accept.
 */
export function remainingDailyBudget(input: {
  dailyBudgetWei: bigint;
  spentTodayWei: bigint;
}): bigint {
  return clampToZero(input.dailyBudgetWei - input.spentTodayWei);
}

/** The two fields `remainingDailyBudget` needs, pulled out of a screen input. */
function dailyBudgetOf(input: ScreenInput): { dailyBudgetWei: bigint; spentTodayWei: bigint } {
  return { dailyBudgetWei: input.policy.dailyBudgetWei, spentTodayWei: input.spentTodayWei };
}

/** What the wallet can stake without eating its own gas. */
export function spendableBalance(input: {
  agentBalanceWei: bigint;
  gasReserveWei: bigint;
}): bigint {
  return clampToZero(input.agentBalanceWei - input.gasReserveWei);
}

/**
 * The model's fraction, in wei.
 *
 * Rounded to basis points **before** touching a bigint so the result cannot depend on float
 * association order: `0.3` is exactly 3000 bp here and always produces the same wei for the
 * same cap, on any machine, in any order. The division then floors, which errs downward — the
 * safe direction for a stake.
 */
export function requestedStake(perTxCapWei: bigint, stakeFraction: number): bigint {
  if (!Number.isFinite(stakeFraction) || stakeFraction <= 0) return 0n;
  const bounded = Math.min(stakeFraction, 1);
  const bp = BigInt(Math.round(bounded * Number(BASIS_POINTS)));
  return (perTxCapWei * bp) / BASIS_POINTS;
}

/**
 * Everything decidable without asking a model anything.
 *
 * Collects **every** reason rather than returning on the first, for the same reason
 * `validate.ts` does: the row is evidence, and "three things were wrong" is more useful to a
 * reader than whichever one the loop reached first. The verdict is the strongest of the
 * verdicts the individual reasons imply — one terminal reason makes the whole screen terminal.
 */
export function screenAgent(input: ScreenInput): ScreenResult {
  const rejects: string[] = [];
  const defers: string[] = [];

  // --- Halts. Both mean "take no action", which is not the same as "never again". ----------
  if (input.globalKillSwitch) {
    defers.push(
      "GLOBAL_KILL_SWITCH: AGENTS_KILL_SWITCH is on, so no agent may bet. " +
        "No transaction was prepared and nothing on chain was touched.",
    );
  }
  if (input.policy.killSwitch) {
    defers.push(
      "MEMBER_KILL_SWITCH: this member's kill switch is on. " +
        "It is an off-chain flag — the contract was not involved and its caps are unchanged.",
    );
  }

  // --- The market. Both of these are permanent facts about it. -----------------------------
  if (input.market.state !== "OPEN") {
    rejects.push(
      `MARKET_NOT_OPEN: the chain reports market #${input.market.onchainId} as ` +
        `${input.market.state}, and a market never returns to OPEN.`,
    );
  }
  const secondsLeft = input.market.closeTime - input.now;
  if (secondsLeft < MIN_SECONDS_BEFORE_CLOSE) {
    rejects.push(
      secondsLeft <= 0
        ? `MARKET_CLOSED: betting on market #${input.market.onchainId} closed ` +
            `${Math.abs(secondsLeft)}s ago. The contract would revert with BettingClosed().`
        : `MARKET_CLOSING: only ${secondsLeft}s until close, under the ` +
            `${MIN_SECONDS_BEFORE_CLOSE}s margin. Refusing here rather than racing the chain.`,
    );
  }

  // --- The policy's allowlist. A category is fixed at approval and never changes. ----------
  if (!input.policy.allowedCategories.includes(input.market.category)) {
    rejects.push(
      `CATEGORY_NOT_ALLOWED: market category ${input.market.category} is not in this ` +
        `member's allowlist (${input.policy.allowedCategories.join(", ") || "empty"}).`,
    );
  }

  // --- The on-chain registry. Every one of these is fixable by an admin transaction. -------
  if (!input.onChain.registered) {
    defers.push(
      "AGENT_NOT_REGISTERED: the contract has no registry entry for this agent wallet, so it " +
        "would bet uncapped. Refusing until registerAgent has confirmed.",
    );
  } else if (!input.onChain.active) {
    defers.push(
      "AGENT_INACTIVE: the contract's registry has this agent deactivated. " +
        "placeBet would revert with AgentNotActive().",
    );
  } else if (input.onChain.owner !== input.memberOwnerAddress.toLowerCase()) {
    // Loud, because the consequence is a payout to the wrong person. Not terminal: it is fixed
    // by re-registering the agent, and foreclosing the market would not help anyone.
    defers.push(
      `OWNER_MISMATCH: the contract will pay this agent's winnings to ${input.onChain.owner}, ` +
        `but our record says the owner is ${input.memberOwnerAddress.toLowerCase()}. ` +
        `Re-register the agent before it stakes anything.`,
    );
  }

  // --- Money. Both recover on their own: one at midnight, one when someone funds a wallet. --
  if (remainingDailyBudget(dailyBudgetOf(input)) < MIN_STAKE_WEI) {
    defers.push(
      `DAILY_BUDGET_SPENT: ${input.spentTodayWei} of ${input.policy.dailyBudgetWei} wei ` +
        `committed today leaves less than the ${MIN_STAKE_WEI} wei minimum. Resets at 00:00 UTC.`,
    );
  }
  if (spendableBalance(input) < MIN_STAKE_WEI) {
    defers.push(
      `INSUFFICIENT_BALANCE: the agent wallet holds ${input.agentBalanceWei} wei and reserves ` +
        `${input.gasReserveWei} for gas, leaving less than the ${MIN_STAKE_WEI} wei minimum.`,
    );
  }

  // --- Per-market headroom. Terminal: the agent has already spent its allowance on THIS
  //     market, and a per-market cap does not refill while the market lives.
  //
  //     Guarded on `registered && active`, because `agentRemainingOnMarket` returns 0 for an
  //     agent the contract does not know or has deactivated. Without the guard an unregistered
  //     agent would read as "cap spent" and be permanently barred from a market it has never
  //     bet on — a terminal row written because a setup step had not run yet.
  if (
    input.onChain.registered &&
    input.onChain.active &&
    input.onChain.remainingOnMarketWei < MIN_STAKE_WEI
  ) {
    rejects.push(
      `PER_MARKET_CAP_SPENT: the contract reports ${input.onChain.remainingOnMarketWei} wei ` +
        `of headroom left under this agent's ${input.onChain.perMarketCapWei} wei per-market ` +
        `cap on market #${input.market.onchainId}.`,
    );
  }

  // Terminal beats transient: if the market is closed, a kill switch being on as well does not
  // make the situation recoverable, so the terminal verdict wins and both reasons are kept.
  if (rejects.length > 0) return { verdict: "REJECT", reasons: [...rejects, ...defers] };
  if (defers.length > 0) return { verdict: "DEFER", reasons: defers };
  return { verdict: "PROCEED", reasons: [] };
}

/**
 * The whole gate: screen, judge the proposal, then clamp.
 *
 * Returns a decision for every input. It has no failure mode of its own — there is nothing here
 * that can throw, so there is no path on which a caller is left without an answer to record.
 */
export function policyGate(input: GateInput): GateDecision {
  const requestedStakeWei = requestedStake(input.policy.perTxCapWei, input.proposal.stakeFraction);
  const screened = screenAgent(input);

  const refuse = (verdict: ScreenVerdict, reasons: string[]): GateDecision => ({
    allow: false,
    reasons,
    finalStakeWei: 0n,
    requestedStakeWei,
    boundBy: null,
    verdict,
  });

  if (screened.verdict !== "PROCEED") return refuse(screened.verdict, screened.reasons);

  // An abstention short-circuits everything that follows, and that is a deliberate choice about
  // what a rejection row should say rather than a shortcut.
  //
  // `confidence` and `stakeFraction` both describe a position the agent declined to take, so
  // reporting that its confidence was too low for a bet it did not propose, and its stake too
  // small for money it did not ask for, adds two sentences and no information. Measured on the
  // first live pass, where every abstention carried all three reasons and only the first was
  // about anything. A rejection row is evidence; padding it makes the evidence harder to read.
  if (input.proposal.side === "ABSTAIN") {
    return refuse("REJECT", [
      "ABSTAINED: the agent declined to take a side. Abstaining is a real answer, not a " +
        "failure — it is what a model with no view is supposed to say instead of guessing.",
    ]);
  }

  const rejects: string[] = [];

  // --- The proposal itself. Every one of these is the model's answer, and at temperature 0 it
  //     is the answer it would give again — so all of them are terminal. ---------------------
  if (input.proposal.confidence < input.policy.minConfidence) {
    rejects.push(
      `CONFIDENCE_BELOW_THRESHOLD: the agent rated itself ` +
        `${input.proposal.confidence.toFixed(2)} against a policy minimum of ` +
        `${input.policy.minConfidence.toFixed(2)}. The threshold is the member's, not the model's.`,
    );
  }

  const invented = input.proposal.sourceLabels.filter(
    (label) => !input.issuedLabels.includes(label),
  );
  if (invented.length > 0) {
    rejects.push(
      `UNISSUED_SOURCE_LABEL: cited ${invented.join(", ")}, which was never supplied ` +
        `(issued: ${input.issuedLabels.join(", ") || "none"}). A rationale resting on a ` +
        `source that does not exist is not a rationale.`,
    );
  }

  if (requestedStakeWei < MIN_STAKE_WEI) {
    rejects.push(
      `STAKE_TOO_SMALL: ${input.proposal.stakeFraction} of the ${input.policy.perTxCapWei} wei ` +
        `per-tx cap is ${requestedStakeWei} wei, under the ${MIN_STAKE_WEI} wei minimum.`,
    );
  }

  if (rejects.length > 0) return refuse("REJECT", rejects);

  // --- The clamp. Six limits; the smallest one wins and says so. ---------------------------
  const limits: { code: string; value: bigint; note: string }[] = [
    {
      code: "POLICY_PER_TX_CAP",
      value: input.policy.perTxCapWei,
      note: "the member's off-chain per-transaction cap",
    },
    {
      code: "DAILY_BUDGET",
      value: remainingDailyBudget(dailyBudgetOf(input)),
      note: "what is left of the member's daily budget",
    },
    {
      code: "ONCHAIN_PER_TX_CAP",
      value: input.onChain.perTxCapWei,
      note: "the per-transaction cap the contract enforces",
    },
    {
      code: "ONCHAIN_PER_MARKET_CAP",
      value: input.onChain.remainingOnMarketWei,
      note: "headroom left under the contract's per-market cap",
    },
    {
      code: "AGENT_BALANCE",
      value: spendableBalance(input),
      note: "the agent wallet's balance after its gas reserve",
    },
  ];

  const ceiling = minOf(limits.map((limit) => limit.value));
  const finalStakeWei = requestedStakeWei < ceiling ? requestedStakeWei : ceiling;

  const reasons: string[] = [
    `APPROVED: ${input.proposal.side} at confidence ${input.proposal.confidence.toFixed(2)}, ` +
      `staking ${finalStakeWei} wei on market #${input.market.onchainId}.`,
  ];

  // Every limit that binds is named, not only the winning one: two limits at the same value is
  // a real and informative situation, and a reader chasing a number that looks wrong needs to
  // know that loosening one of them would not have moved it.
  //
  // "Reduced the stake" and "the stake is exactly at this limit" are reported as different
  // things, because they are: one is the gate taking money off the table, the other is a bet
  // sitting precisely on a cap. The contract distinguishes them too — at the cap it accepts,
  // one wei over it reverts — so the off-chain record should not blur the boundary the
  // on-chain one is drawn at.
  for (const limit of limits) {
    if (limit.value < requestedStakeWei) {
      reasons.push(
        `CLAMPED_BY_${limit.code}: asked for ${requestedStakeWei} wei, ` +
          `${limit.note} allows ${limit.value} wei.`,
      );
    } else if (limit.value === requestedStakeWei) {
      reasons.push(
        `AT_LIMIT_${limit.code}: the stake is exactly ${limit.note} (${limit.value} wei). ` +
          `Nothing was reduced; one wei more would have been.`,
      );
    }
  }

  return {
    allow: true,
    reasons,
    finalStakeWei,
    requestedStakeWei,
    // Non-null only when a limit actually decided the amount. `ceiling <= requested` is exactly
    // that condition, and the limit achieving the minimum is by construction one of them.
    boundBy:
      ceiling < requestedStakeWei
        ? (limits.find((limit) => limit.value === ceiling)?.code ?? null)
        : null,
    verdict: "PROCEED",
  };
}

/**
 * The gate's rules, in order, for the `/agents` page.
 *
 * Kept beside the implementation so the page cannot describe a rule that is not enforced —
 * the same reason `VALIDATION_RULES` lives next to `validateDraft`.
 */
export const POLICY_RULES: readonly string[] = [
  "the global kill switch and the member's own kill switch are both off",
  "the chain reports the market OPEN with more than a minute of betting left",
  "the market's category is on this member's allowlist",
  "the contract has this agent registered, active, and owned by the address we expect",
  "the member's daily budget and the agent wallet both still hold more than the minimum stake",
  "the agent took a side, at or above the member's own confidence threshold",
  "every source the agent cited is one we supplied to it",
  "the stake is clamped to the smallest of six limits, two of which the contract enforces again",
];
