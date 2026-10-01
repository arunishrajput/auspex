// Every hash and address that appears on screen in the film. scripts/verify.mjs re-reads each one
// from testnet.mstscan.com and refuses to pass if any disagrees, so nothing here can be invented.
export const EXPLORER = "testnet.mstscan.com";
export const CONTRACT = "0xc4743d6295311AFead12161881Bfcf601B70104C";
export const HUMAN = "0xA9F68fDf84388fa548a685085E2bee0e5b311fF1";
export const ATLAS = "0xa4ef956f01946b93efd592ce720d24beec19588f";
export const LIVE_URL = "auspex-web-mu.vercel.app";
export const REPO_URL = "github.com/arunishrajput/auspex";

export const TX = {
  // the probe a visitor triggered from the live site, with no wallet
  overCap: { hash: "0xbfe9bb2c3ffee4be2f660473b3de916380f5d10da8548173d44810118ced060a", status: "error", method: "placeBet", from: ATLAS, revert: "AgentPerTxCapExceeded" },
  humanCreate: { hash: "0x2e70a1cbe7bd72b33e68afdc4742c0416b2eee3ed3ed4297bf938d2be825a504", status: "ok", method: "createMarket", from: HUMAN },
  agentBet: { hash: "0x5f8a12c6259de3493b79314e3e6f0284a3650e378b4b34f627cff37ea10dd5f1", status: "ok", method: "placeBet", from: ATLAS },
  finalize: { hash: "0x2f4fd42833a6aaa04819d92a2f1e3de04c4dd897145eb1b0c5b53dfaa5d407fc", status: "ok", method: "finalizeResolution", from: ATLAS },
  claim: { hash: "0x7ae9c6830335f810629b63dfef47cbfbbd7757385bbbc25779bc676b1970e0a2", status: "ok", method: "claim", from: ATLAS },
  lateBet: { hash: "0x078b9c76e0a6752f6245c6b60fb55a6281e5f768a83e64d8789381dd3da6b73f", status: "error", method: "placeBet", revert: "BettingClosed" },
  earlyFinal: { hash: "0x39e30155507d037d5db8ac983f15b1ef6239d714116d8b21c436ba01204864df", status: "error", method: "finalizeResolution", revert: "ChallengeWindowOpen" },
  doubleClaim: { hash: "0x108c50cb6a364699f210d003f55dddc5c2004ad4972fb7a3e7570ca5e603903c", status: "error", method: "claim", revert: "AlreadyClaimed" },
} as const;

export const short = (h: string, a = 6, b = 4) => `${h.slice(0, a + 2)}…${h.slice(-b)}`;
