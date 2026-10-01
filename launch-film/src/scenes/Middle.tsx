import React from "react";
import { AbsoluteFill, interpolate, random, useCurrentFrame } from "remotion";
import { rise } from "../anim";
import { Callout, Page, Ring } from "../components/Browser";
import { Sfx } from "../components/Sfx";
import { Big, Body, Chip, Eyebrow, MonoText, Reveal, SceneShell } from "../components/ui";
import { useCue } from "../cues";
import { HUMAN, short } from "../data/evidence";
import { mark, union } from "../data/marks";
import { C, display, mono } from "../theme";

const LIVE = "auspex-web-mu.vercel.app";

/* ------------------------------------------------------------------ 3. the flow */
const NODES = [
  { k: "News", v: "arrives as untrusted text", tone: C.t400, dashed: true, kind: "input" },
  { k: "Two sources", v: "independent publishers agree", tone: C.warn, kind: "code" },
  { k: "Proposer", v: "an LLM drafts a market", tone: C.signal, kind: "model" },
  { k: "Schema", v: "malformed output is thrown out", tone: C.warn, kind: "code" },
  { k: "A human", v: "reads it as a checklist", tone: C.human, kind: "human" },
  { k: "createMarket", v: "signed — and only then on chain", tone: C.ok, kind: "chain" },
];

export const Pipeline: React.FC = () => {
  const f = useCurrentFrame();
  const q = useCue("pipeline");
  const cue = [q.at(1), q.at(2), q.at(3), q.at(5), q.at(6), q.at(7)];
  const W = 262, G = 34, X0 = (1920 - (6 * W + 5 * G)) / 2, Y = 380, H = 250;
  return (
    <SceneShell>
      <Eyebrow n="02" label="The flow" />
      <div style={{ position: "absolute", left: 110, top: 150 }}>
        <Big size={82}><Reveal text="From headline to market." start={q.at(0)} stagger={3} /></Big>
      </div>
      {/* connectors, drawn as each next node arrives, with a packet riding them */}
      <svg style={{ position: "absolute", left: 0, top: 0, width: 1920, height: 1080 }}>
        {NODES.slice(1).map((n, i) => {
          const x1 = X0 + (i + 1) * W + i * G, x2 = x1 + G, y = Y + H / 2;
          const t = rise(f, cue[i + 1] - 6, 14);
          return <line key={i} x1={x1} y1={y} x2={x1 + (x2 - x1) * t} y2={y} stroke={n.tone} strokeWidth={3} />;
        })}
        {NODES.slice(1).map((n, i) => {
          const t = interpolate(f, [cue[i + 1] - 8, cue[i + 1] + 4], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
          if (t <= 0 || t >= 1) return null;
          const x = X0 + (i + 1) * W + i * G + G * t;
          return <circle key={i} cx={x} cy={Y + H / 2} r={9} fill={n.tone} style={{ filter: `drop-shadow(0 0 10px ${n.tone})` }} />;
        })}
      </svg>
      {NODES.map((n, i) => {
        const t = rise(f, cue[i], 18);
        const signed = i === 5 ? rise(f, cue[5] + 6, 20) : 0;
        return (
          <div key={n.k} style={{
            position: "absolute", left: X0 + i * (W + G), top: Y, width: W, height: H, borderRadius: 18,
            background: `${n.tone}12`, border: `2px ${n.dashed ? "dashed" : "solid"} ${n.tone}`, padding: "24px 22px",
            opacity: t, translate: `0px ${(1 - t) * 50}px`, boxShadow: i === 5 ? `0 0 ${60 * signed}px ${C.ok}55` : undefined,
          }}>
            <MonoText size={17} color={n.tone} style={{ letterSpacing: "0.16em", textTransform: "uppercase" }}>{n.kind}</MonoText>
            <div style={{ fontFamily: i === 5 ? mono : display, fontWeight: 800, fontSize: i === 5 ? 30 : 36, color: C.t100, marginTop: 10, whiteSpace: "nowrap", letterSpacing: "-0.02em" }}>{n.k}</div>
            <Body size={23} style={{ marginTop: 8, color: C.t400, lineHeight: 1.3 }}>{n.v}</Body>
            {i === 5 && (
              <svg width="200" height="40" style={{ position: "absolute", left: 24, bottom: 14 }}>
                <path d="M4 28 C 20 4, 30 36, 46 18 S 70 8, 84 26 S 110 30, 124 12 S 150 22, 190 16" fill="none" stroke={C.human} strokeWidth={3}
                  strokeDasharray={260} strokeDashoffset={260 * (1 - signed)} strokeLinecap="round" />
              </svg>
            )}
          </div>
        );
      })}
      {/* a draft is only a suggestion */}
      {(() => {
        const t = rise(f, q.at(4), 16);
        const x = X0 + 2 * (W + G);
        return (
          <div style={{ position: "absolute", left: x - 30, top: Y + H + 30, width: W + 60, opacity: t, translate: `0px ${(1 - t) * -20}px`, textAlign: "center" }}>
            <div style={{ width: 2, height: 30, background: C.signal, margin: "0 auto 8px" }} />
            <Chip tone="signal" size={20}>only a suggestion</Chip>
          </div>
        );
      })()}
      {/* malformed drafts falling out of the schema stage */}
      {Array.from({ length: 5 }).map((_, i) => {
        const s = q.at(5) + 8 + i * 7;
        const t = interpolate(f, [s, s + 34], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
        if (t <= 0 || t >= 1) return null;
        const x = X0 + 3 * (W + G) + 40 + random(i) * (W - 80);
        return <div key={i} style={{ position: "absolute", left: x, top: Y + H + 10 + t * 190, opacity: 1 - t, fontFamily: mono, fontWeight: 700, fontSize: 30, color: C.bad, rotate: `${t * 90 * (i % 2 ? 1 : -1)}deg` }}>✕</div>;
      })}
      {/* legend: colour is a claim about who decides */}
      <div style={{ position: "absolute", left: 110, top: 800, display: "flex", gap: 40, opacity: rise(f, q.at(2), 20) }}>
        {[[C.signal, "a model proposes"], [C.warn, "deterministic code"], [C.human, "a person decides"], [C.ok, "the chain enforces"]].map(([c, l]) => (
          <div key={l} style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ width: 16, height: 16, borderRadius: 4, background: c }} />
            <MonoText size={22} color={C.t400}>{l}</MonoText>
          </div>
        ))}
      </div>
      {cue.map((c, i) => <Sfx key={i} name="pop" at={c} volume={0.38} />)}
      <Sfx name="confirm" at={cue[5] + 8} volume={0.45} />
    </SceneShell>
  );
};

/* ------------------------------------------------------------------ 4. the human gate */
export const Review: React.FC = () => {
  const q = useCue("review");
  const row = mark("review-1", 0);
  const approved = mark("review-1", 1);
  return (
    <SceneShell>
      <Eyebrow n="03" label="The human gate" />
      <Page
        url={`${LIVE}/review`}
        shots={[{ src: "frames/review-0.png", from: 0 }, { src: "frames/review-1.png", from: q.at(1) - 12 }]}
        cam={[{ f: q.at(1) + 10, rect: row, zoom: 1.55 }, { f: q.at(3), zoom: 1 }, { f: q.at(5) - 4, rect: approved, zoom: 1.9 }]}
        overlay={<>
          <Ring rect={row} from={q.at(1) + 18} until={q.at(3)} color={C.warn} label="untrusted · fenced" spot />
          <Ring rect={approved} from={q.at(5)} color={C.human} label="signed by a human" labelSide="bottom" spot fill />
        </>}
      />
      <Callout from={q.at(3) + 4} until={q.at(5) - 6} x={1130} y={560} w={640} tone={C.human}>
        <MonoText size={19} color={C.human} style={{ letterSpacing: "0.18em" }}>createMarket SIGNER</MonoText>
        <div style={{ fontFamily: mono, fontSize: 30, color: C.t100, margin: "10px 0 8px" }}>{short(HUMAN, 6, 6)}</div>
        a browser wallet (BridgeKey). <span style={{ color: C.t100, fontWeight: 600 }}>No server has ever held this key.</span>
      </Callout>
      <Sfx name="whoosh" at={q.at(1) - 12} volume={0.35} />
      <Sfx name="tick" at={q.at(1) + 18} />
      <Sfx name="pop" at={q.at(3) + 4} volume={0.4} />
      <Sfx name="confirm" at={q.at(5)} volume={0.4} />
    </SceneShell>
  );
};

/* ------------------------------------------------------------------ 5. injection */
export const Injection: React.FC = () => {
  const q = useCue("injection");
  const head = mark("home-injection", 0);
  const sig = mark("home-injection", 1);
  const red = mark("home-injection", 2);
  return (
    <SceneShell>
      <Eyebrow n="04" label="Untrusted by default" />
      <Page
        url={LIVE}
        shots={[{ src: "frames/home-injection.png", from: 0 }]}
        cam={[{ f: q.at(2) - 4, rect: union(head, sig), zoom: 1.45 }, { f: q.at(4), rect: red, zoom: 2.2 }]}
        overlay={<>
          <Ring rect={head} from={q.at(2)} until={q.at(4)} color={C.bad} label="hostile headline" pad={10} />
          <Ring rect={[sig[0], sig[1], 560, sig[3]]} from={q.at(3)} until={q.at(4)} color={C.warn} label="signatures tripped" labelSide="bottom" pad={8} />
          <Ring rect={red} from={q.at(4) + 10} color={C.ok} label="smuggled tag, redacted" pad={8} spot fill />
        </>}
      />
      <Sfx name="deny" at={q.at(2)} volume={0.3} />
      <Sfx name="tick" at={q.at(3)} />
      <Sfx name="confirm" at={q.at(4) + 10} volume={0.4} />
    </SceneShell>
  );
};

/* ------------------------------------------------------------------ 6. member agents */
export const Agents: React.FC = () => {
  const f = useCurrentFrame();
  const q = useCue("agents");
  const list = mark("agents-1", 0);
  const gate = mark("agents-0", 0);
  const rows = 8, rowH = list[3] / rows;
  const sweep = interpolate(f, [q.at(6), q.end(6)], [0, rows - 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <SceneShell>
      <Eyebrow n="05" label="Member agents" />
      <Page
        url={`${LIVE}/agents`}
        shots={[{ src: "frames/agents-0.png", from: 0 }, { src: "frames/agents-1.png", from: q.at(4) - 10 }, { src: "frames/agents-0.png", from: q.at(8) - 14 }]}
        cam={[{ f: q.at(4) + 10, rect: list, zoom: 1.3 }, { f: q.at(8) - 14, zoom: 1 }, { f: q.at(8) + 6, rect: gate, zoom: 1.8 }]}
        overlay={<>
          <Ring rect={list} from={q.at(4) + 12} until={q.at(8) - 16} color={C.warn} label="the policy gate · a pure function" />
          {f >= q.at(6) && f < q.at(8) - 16 && (
            <div style={{ position: "absolute", left: list[0], top: list[1] + Math.round(sweep) * rowH, width: list[2], height: rowH, background: `${C.warn}2a`, borderLeft: `4px solid ${C.warn}` }} />
          )}
          <Ring rect={gate} from={q.at(8) + 10} color={C.warn} label="refused · each with a reason" labelSide="bottom" spot fill />
        </>}
      />
      <Callout from={q.at(1)} until={q.at(4) - 10} x={1160} y={640} w={600} tone={C.signal}>
        <MonoText size={19} color={C.signal} style={{ letterSpacing: "0.18em" }}>THE AGENT PROPOSES</MonoText>
        <div style={{ display: "flex", gap: 12, marginTop: 14 }}>
          {["a side", "a confidence", "a stake"].map((w, i) => (
            <span key={w} style={{ opacity: rise(f, q.at(1 + i), 12) }}><Chip tone="signal" size={22}>{w}</Chip></span>
          ))}
        </div>
      </Callout>
      <Callout from={q.at(5)} until={q.at(8) - 16} x={1240} y={170} w={520} tone={C.warn}>
        <div style={{ fontFamily: display, fontWeight: 800, fontSize: 40, color: C.warn }}>no model. no network.</div>
        <div style={{ marginTop: 6 }}>Same input, same answer — every time.</div>
      </Callout>
      {[1, 2, 3].map((i) => <Sfx key={i} name="pop" at={q.at(i)} volume={0.35} />)}
      <Sfx name="whoosh" at={q.at(4) - 10} volume={0.35} />
      {Array.from({ length: 8 }).map((_, i) => <Sfx key={`t${i}`} name="tick" at={q.at(6) + ((q.end(6) - q.at(6)) * i) / 7} volume={0.3} />)}
      <Sfx name="deny" at={q.at(8) + 10} volume={0.3} />
    </SceneShell>
  );
};

/* ------------------------------------------------------------------ 7. four layers */
const LAYERS = [
  { n: "01", k: "Schema", v: "malformed or out-of-enum model output", count: 0, tone: C.signal },
  { n: "02", k: "Policy gate", v: "over budget · low confidence · wrong category · kill switch", count: 16, tone: C.warn },
  { n: "03", k: "A human", v: "ambiguous, unresolvable or self-contradicting questions", count: 1, tone: C.human },
  { n: "04", k: "The chain", v: "over-cap bets · late bets · double claims · early finalising", count: 11, tone: C.ok },
];

export const Layers: React.FC = () => {
  const f = useCurrentFrame();
  const q = useCue("layers");
  const chainAt = q.at(4);
  const dim = rise(f, q.at(5), 20);
  const shake = f >= chainAt && f < chainAt + 12 ? (random(f) - 0.5) * 16 * (1 - (f - chainAt) / 12) : 0;
  return (
    <SceneShell glow={0.8}>
      <Eyebrow n="06" label="Four layers that can say no" />
      <AbsoluteFill style={{ translate: `${shake}px ${shake * 0.6}px` }}>
        {LAYERS.map((l, i) => {
          const t = rise(f, q.at(i + 1), i === 3 ? 10 : 16);
          const isChain = i === 3;
          const op = isChain ? 1 : 1 - dim * 0.7;
          const sc = isChain ? 1 + dim * 0.04 : 1;
          return (
            <div key={l.k} style={{
              position: "absolute", left: 160, top: 150 + i * 182, width: 1600, height: 158, borderRadius: 20,
              display: "flex", alignItems: "center", padding: "0 44px", gap: 40,
              background: isChain ? `${l.tone}18` : C.s900, border: `2px solid ${isChain ? l.tone : l.tone + "77"}`,
              opacity: t * op, scale: String((isChain ? 1.25 - t * 0.25 : 1) * sc), translate: isChain ? "0px 0px" : `${(1 - t) * -80}px 0px`,
              boxShadow: isChain ? `0 0 ${80 * t}px ${l.tone}44` : undefined,
            }}>
              <MonoText size={30} color={l.tone}>{l.n}</MonoText>
              <div style={{ fontFamily: display, fontWeight: 800, fontSize: 58, color: C.t100, width: 380, letterSpacing: "-0.03em" }}>{l.k}</div>
              <Body size={28} style={{ flex: 1, color: C.t400 }}>{l.v}</Body>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontFamily: mono, fontWeight: 700, fontSize: 66, color: l.tone, lineHeight: 1 }}>{l.count}</div>
                <MonoText size={17} color={C.t500} style={{ letterSpacing: "0.14em" }}>REFUSED</MonoText>
              </div>
            </div>
          );
        })}
      </AbsoluteFill>
      <div style={{ position: "absolute", left: 160, top: 890, opacity: rise(f, q.at(1), 20) }}>
        <MonoText size={20} color={C.t500}>refusal counts as read live from /trust on 1 Oct 2026 · the schema layer has not fired yet, and the page says so</MonoText>
      </div>
      {[1, 2, 3].map((i) => <Sfx key={i} name="pop" at={q.at(i)} volume={0.4} />)}
      <Sfx name="stamp" at={chainAt} volume={0.55} />
    </SceneShell>
  );
};
