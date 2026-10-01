import React from "react";
import { AbsoluteFill, interpolate, random, useCurrentFrame } from "remotion";
import { rise } from "../anim";
import { Callout, Page, Ring } from "../components/Browser";
import { Sfx } from "../components/Sfx";
import { Big, Body, Chip, Eyebrow, MonoText, Reveal, SceneShell } from "../components/ui";
import { useCue } from "../cues";
import { TX, short } from "../data/evidence";
import { mark, union } from "../data/marks";
import { C, display, mono } from "../theme";

const LIVE = "auspex-web-mu.vercel.app";

/* ------------------------------------------------------------------ 8. the cap probe */
const STEPS = [
  { k: "Read the agent's cap", v: "from the contract, on chain", tone: C.ok },
  { k: "Add exactly one wei", v: "the smallest possible overreach", tone: C.warn },
  { k: "Sign it, gate bypassed", v: "what a compromised server would do", tone: C.bad },
];

export const Probe: React.FC = () => {
  const f = useCurrentFrame();
  const q = useCue("probe");
  const btn = mark("probe-0-before", 0);
  const row = mark("probe-0-before", 1);
  const stepsOut = interpolate(f, [q.at(6) - 10, q.at(6) + 6], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const pageW = interpolate(f, [q.at(2) - 10, q.at(2) + 10, q.at(6) - 10, q.at(6) + 10], [1400, 1060, 1060, 1400], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const pageT = interpolate(f, [q.at(2) - 10, q.at(2) + 10, q.at(6) - 10, q.at(6) + 10], [92, 170, 170, 92], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const pageL = interpolate(f, [q.at(2) - 10, q.at(2) + 10, q.at(6) - 10, q.at(6) + 10], [260, 80, 80, 260], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <SceneShell>
      <Eyebrow n="07" label="The cap probe" />
      <Page
        url={`${LIVE}/trust`} width={pageW} left={pageL} top={pageT}
        shots={[{ src: "frames/probe-0-before.png", from: 0 }]}
        cam={[{ f: q.at(1), rect: union(btn, [btn[0], btn[1] - 160, 1070, 160]), zoom: 1.38 }, { f: q.at(6) - 6, rect: row, zoom: 1.3 }]}
        overlay={<>
          <Ring rect={btn} from={q.at(1) + 10} until={q.at(6) - 6} color={C.bad} label="no wallet · no tMSTC" labelSide="bottom" pad={8} />
          <Ring rect={row} from={q.at(6) + 8} color={C.accent} label="run from the live site · 29 Sep 2026" pad={6} spot fill />
        </>}
      />
      <div style={{ position: "absolute", left: 1200, top: 170, width: 640, opacity: stepsOut }}>
        {STEPS.map((s, i) => {
          const t = rise(f, q.at(2 + i), 16);
          return (
            <div key={s.k} style={{ display: "flex", gap: 22, marginBottom: 24, opacity: t, translate: `${(1 - t) * 50}px 0px` }}>
              <div style={{ width: 54, height: 54, borderRadius: 99, border: `2px solid ${s.tone}`, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: mono, fontWeight: 700, fontSize: 24, color: s.tone, flexShrink: 0 }}>{i + 1}</div>
              <div>
                <div style={{ fontFamily: display, fontWeight: 800, fontSize: 42, color: C.t100, letterSpacing: "-0.02em" }}>{s.k}</div>
                <Body size={26} style={{ color: C.t400 }}>{s.v}</Body>
              </div>
            </div>
          );
        })}
        <div style={{ opacity: rise(f, q.at(5), 16), marginTop: 10, padding: "22px 26px", borderRadius: 14, border: `1.5px dashed ${C.ok}`, background: `${C.ok}10` }}>
          <div style={{ fontFamily: display, fontWeight: 800, fontSize: 38, color: C.ok }}>Then let the chain decide.</div>
        </div>
      </div>
      {[2, 3, 4].map((i) => <Sfx key={i} name="pop" at={q.at(i)} volume={0.38} />)}
      <Sfx name="tick" at={q.at(1) + 10} />
      <Sfx name="whoosh" at={q.at(6) - 10} volume={0.35} />
    </SceneShell>
  );
};

/* ------------------------------------------------------------------ 9. the revert */
const CAP = "20000000000000000";
const BET = "20000000000000001";
const group = (s: string) => s.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

const Scramble: React.FC<{ value: string; start: number; len?: number; size: number; color: string; lastColor?: string }> = ({ value, start, len = 20, size, color, lastColor }) => {
  const f = useCurrentFrame();
  const shown = group(value).split("").map((ch, i, arr) => {
    if (ch === ",") return ch;
    const settle = start + (i / arr.length) * len;
    return f >= settle ? ch : String(Math.floor(random(`${i}-${f}`) * 10));
  });
  return (
    <span style={{ fontFamily: mono, fontWeight: 700, fontSize: size, letterSpacing: "-0.03em", color }}>
      {shown.map((c, i) => (
        <span key={i} style={{ color: lastColor && i === shown.length - 1 ? lastColor : undefined }}>{c}</span>
      ))}
    </span>
  );
};

export const Revert: React.FC = () => {
  const f = useCurrentFrame();
  const q = useCue("revert");
  const hit = q.at(4);
  const numsOut = interpolate(f, [q.at(5) - 8, q.at(5) + 6], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const stamp = rise(f, hit, 8);
  const flash = interpolate(f, [hit - 1, hit, hit + 10], [0, 0.55, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const shake = f >= hit && f < hit + 14 ? (random(f + 3) - 0.5) * 26 * (1 - (f - hit) / 14) : 0;
  const pageIn = q.at(5) - 6;
  const outro = rise(f, q.at(8) - 4, 16);
  const failed = mark("scan-revert", 0);
  const call = mark("scan-revert", 1);
  const att = mark("scan-revert", 2);
  const cap = mark("scan-revert", 3);
  return (
    <SceneShell glow={0.9}>
      <Eyebrow n="07" label="The cap probe · what the chain said" />
      {/* the two numbers */}
      <AbsoluteFill style={{ opacity: numsOut, translate: `${shake}px ${shake * 0.5}px`, justifyContent: "center", paddingLeft: 200 }}>
        {[
          { k: "The cap", v: CAP, sub: "= 0.02 tMSTC, read from the contract", at: q.at(0), tone: C.t100 },
          { k: "The bet", v: BET, sub: "exactly one wei more", at: q.at(2), tone: C.t100, last: C.accent },
        ].map((r, i) => {
          const t = rise(f, r.at, 16);
          return (
            <div key={r.k} style={{ marginBottom: i ? 0 : 60, opacity: t, translate: `0px ${(1 - t) * 40}px` }}>
              <MonoText size={24} color={C.t500} style={{ letterSpacing: "0.24em", textTransform: "uppercase" }}>{r.k}</MonoText>
              <div style={{ display: "flex", alignItems: "baseline", gap: 26 }}>
                <Scramble value={r.v} start={i ? r.at - 4 : r.at} len={i ? 18 : 34} size={112} color={r.tone} lastColor={r.last} />
                <MonoText size={44} color={C.t400}>wei</MonoText>
              </div>
              <MonoText size={28} color={i ? C.accent2 : C.t400} style={{ opacity: rise(f, i ? q.at(3) : q.at(1), 14) }}>{r.sub}</MonoText>
            </div>
          );
        })}
      </AbsoluteFill>
      <div style={{ opacity: numsOut }}>{i1PlusTag(f, q.at(3))}</div>
      {/* the stamp */}
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", opacity: stamp * numsOut, pointerEvents: "none" }}>
        <div style={{
          rotate: "-7deg", scale: String(1.8 - stamp * 0.8), padding: "18px 56px", border: `10px solid ${C.bad}`, borderRadius: 18,
          fontFamily: display, fontWeight: 800, fontSize: 190, letterSpacing: "0.02em", color: C.bad, background: `${C.bg}cc`,
          boxShadow: `0 0 120px ${C.bad}66`, translate: "180px 0px",
        }}>
          REVERTED
        </div>
      </AbsoluteFill>
      <AbsoluteFill style={{ background: C.bad, opacity: flash, mixBlendMode: "screen" }} />

      {/* the evidence, on the public explorer */}
      {f >= pageIn && (
        <div style={{ opacity: 1 - outro * 0.82 }}>
          <Page
            url={`testnet.mstscan.com/tx/${short(TX.overCap.hash, 10, 8)}`} enter={pageIn}
            shots={[{ src: "frames/scan-revert.png", from: 0 }]}
            cam={[{ f: q.at(6) - 4, rect: union(failed, call, att, cap), zoom: 1.55 }]}
            overlay={<>
              <Ring rect={failed} from={q.at(5)} color={C.bad} label="failed" pad={6} />
              <Ring rect={call} from={q.at(5) + 10} color={C.bad} labelSide="bottom" pad={6} />
              <Ring rect={att} from={q.at(6) + 4} color={C.accent} label="attempted" labelSide="left" pad={6} />
              <Ring rect={cap} from={q.at(6) + 16} color={C.ok} label="cap" labelSide="left" pad={6} />
            </>}
          />
          <Callout from={q.at(7)} until={q.at(8) - 6} x={1290} y={150} w={500} tone={C.ok}>
            <Chip tone="ok" size={20}>source verified ✓</Chip>
            <div style={{ marginTop: 12 }}>Decoded against the contract&rsquo;s verified source on MSTScan — not by this app.</div>
          </Callout>
        </div>
      )}
      <AbsoluteFill style={{ justifyContent: "center", alignItems: "center", opacity: outro, background: `${C.bg}${Math.round(outro * 0xa0).toString(16).padStart(2, "0")}` }}>
        <Big size={96} style={{ textAlign: "center" }}>
          <Reveal text="The app didn't stop that agent." start={q.at(8)} stagger={3} style={{ color: C.t300 }} />
          <br />
          <Reveal text="The contract did." start={q.at(9)} stagger={4} colorFor={(w) => (w === "contract" ? C.ok : undefined)} />
        </Big>
      </AbsoluteFill>
      <Sfx name="tick" at={q.at(0)} />
      <Sfx name="tick" at={q.at(2)} />
      <Sfx name="pop" at={q.at(3)} volume={0.5} />
      <Sfx name="stamp" at={hit} volume={0.7} />
      <Sfx name="deny" at={hit + 1} volume={0.45} />
      <Sfx name="whoosh" at={pageIn} volume={0.35} />
      <Sfx name="confirm" at={q.at(9)} volume={0.45} />
    </SceneShell>
  );
};

const i1PlusTag = (f: number, at: number) => {
  const t = rise(f, at, 12);
  return (
    <div style={{ position: "absolute", left: 1530, top: 760, opacity: t, scale: String(0.6 + t * 0.4) }}>
      <Chip tone="accent" size={34} solid>+1 wei</Chip>
    </div>
  );
};

/* ------------------------------------------------------------------ 10. it refuses to lie */
export const Honest: React.FC = () => {
  const q = useCue("honest");
  const panel: [number, number, number, number] = [265, 266, 1070, 83]; // read off the capture, see probe-2-result.png
  return (
    <SceneShell>
      <Eyebrow n="07" label="The cap probe · today" />
      <Page
        url={`${LIVE}/trust`}
        shots={[{ src: "frames/probe-2-result.png", from: 0 }]}
        cam={[{ f: q.at(1), rect: panel, zoom: 1.5 }]}
        overlay={<Ring rect={panel} from={q.at(0) + 6} color={C.warn} label="pressed today · 1 Oct 2026" labelSide="bottom" pad={6} spot />}
      />
      <Callout from={q.at(3)} x={1180} y={640} w={600} tone={C.warn}>
        <div style={{ fontFamily: display, fontWeight: 800, fontSize: 36, color: C.warn, lineHeight: 1.15 }}>Late ≠ over the cap.</div>
        <div style={{ marginTop: 8 }}>A refusal for the wrong reason would prove the wrong thing — so it doesn&rsquo;t send one.</div>
      </Callout>
      <Sfx name="tick" at={q.at(0) + 6} />
      <Sfx name="pop" at={q.at(3)} volume={0.4} />
    </SceneShell>
  );
};
