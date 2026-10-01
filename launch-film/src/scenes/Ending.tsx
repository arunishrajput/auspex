import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";
import { rise } from "../anim";
import { Callout, Page, Ring } from "../components/Browser";
import { Sfx } from "../components/Sfx";
import { Big, Body, Chip, Eyebrow, Mark, MonoText, Reveal, SceneShell } from "../components/ui";
import { useCue } from "../cues";
import { CONTRACT, LIVE_URL, REPO_URL, TX, short } from "../data/evidence";
import { mark, union } from "../data/marks";
import { C, display, mono } from "../theme";

/* ------------------------------------------------------------------ 11. authority */
export const Roles: React.FC = () => {
  const q = useCue("roles");
  const rows = [0, 1, 2, 3].map((i) => mark("trust-roles", i));
  const table = union(...rows);
  const agents = union(rows[1], rows[2], rows[3]);
  return (
    <SceneShell>
      <Eyebrow n="08" label="Authority" />
      <Page
        url={`${LIVE_URL}/trust`}
        shots={[{ src: "frames/trust-roles.png", from: 0 }]}
        cam={[{ f: q.at(1), rect: [table[0], table[1] - 90, table[2], table[3] + 90], zoom: 1.25 }, { f: q.at(2) + 4, rect: agents, zoom: 1.4 }]}
        overlay={<>
          <Ring rect={[table[0], table[1] - 80, table[2], table[3] + 80]} from={q.at(1) + 6} until={q.at(2)} color={C.ok} label="hasRole() · read live from the contract" />
          <Ring rect={agents} from={q.at(2) + 10} color={C.bad} label="agent wallets · no role at all" labelSide="bottom" spot />
        </>}
      />
      <Callout from={q.at(4)} x={1130} y={150} w={660} tone={C.ok}>
        <MonoText size={19} color={C.ok} style={{ letterSpacing: "0.18em" }}>claim() PAYS THE REGISTERED OWNER</MonoText>
        <div style={{ marginTop: 10 }}>Sent by the agent&rsquo;s wallet. Paid to its owner — 0.015 tMSTC.</div>
        <div style={{ fontFamily: mono, fontSize: 22, color: C.signal, marginTop: 10 }}>tx {short(TX.claim.hash, 8, 6)}</div>
      </Callout>
      <Sfx name="tick" at={q.at(1) + 6} />
      <Sfx name="deny" at={q.at(2) + 10} volume={0.3} />
      <Sfx name="confirm" at={q.at(4)} volume={0.4} />
    </SceneShell>
  );
};

/* ------------------------------------------------------------------ 12. resolution */
const RSTEPS = [
  { k: "Resolution agent", v: "drafts an outcome from sources it was handed", tone: C.signal, cue: 1 },
  { k: "Verbatim quote check", v: "its quote must exist, character for character", tone: C.warn, cue: 2 },
  { k: "A human signs", v: "proposeResolution, with an evidence URL", tone: C.human, cue: 4 },
  { k: "Challenge window", v: "120 seconds to send it back", tone: C.warn, cue: 5 },
  { k: "Anyone finalizes", v: "permissionless — no role required", tone: C.ok, cue: 7 },
  { k: "Winners claim", v: "paid by the contract, not a server", tone: C.ok, cue: 8 },
];
const LINES = [0.92, 0.84, 0.97, 0.76, 0.6, 0.88, 0.95, 0.81, 0.7];
const QUOTE_LINE = 4;

export const Resolution: React.FC = () => {
  const f = useCurrentFrame();
  const q = useCue("resolution");
  const ok = rise(f, q.at(2) + 20, 14);
  const bad = rise(f, q.at(3), 12);
  const shake = f >= q.at(3) && f < q.at(3) + 12 ? Math.sin(f * 2.4) * 10 * (1 - (f - q.at(3)) / 12) : 0;
  const win = interpolate(f, [q.at(5), q.at(7)], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <SceneShell>
      <Eyebrow n="09" label="Resolution" />
      <div style={{ position: "absolute", left: 100, top: 130 }}>
        <Big size={70}><Reveal text="Same rules for the answer." start={q.at(0)} stagger={3} /></Big>
      </div>
      {/* the quote check, as an illustration */}
      <div style={{ position: "absolute", left: 100, top: 270, width: 820, opacity: rise(f, q.at(2) - 6, 18) }}>
        <div style={{ padding: "26px 30px", borderRadius: 16, background: C.s900, border: `1.5px solid ${C.line2}` }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 18 }}>
            <MonoText size={18} color={C.t500} style={{ letterSpacing: "0.16em" }}>ARTICLE TEXT · FETCHED BY CODE</MonoText>
            <Chip tone="quiet" size={15}>illustration</Chip>
          </div>
          {LINES.map((w, i) => (
            <div key={i} style={{ height: 20, width: `${w * 100}%`, borderRadius: 5, marginBottom: 20, background: i === QUOTE_LINE ? (ok > 0 ? C.ok : C.line2) : C.line, opacity: i === QUOTE_LINE ? 0.5 + ok * 0.5 : 1, boxShadow: i === QUOTE_LINE && ok > 0 ? `0 0 ${20 * ok}px ${C.ok}` : undefined }} />
          ))}
        </div>
        <div style={{ display: "flex", gap: 18, marginTop: 24 }}>
          <div style={{ flex: 1, padding: "18px 22px", borderRadius: 14, border: `1.5px solid ${C.ok}`, background: `${C.ok}12`, opacity: ok }}>
            <MonoText size={18} color={C.ok} style={{ letterSpacing: "0.14em" }}>✓ QUOTED VERBATIM</MonoText>
            <Body size={24} style={{ marginTop: 6 }}>found in the text → accepted</Body>
          </div>
          <div style={{ flex: 1, padding: "18px 22px", borderRadius: 14, border: `1.5px solid ${C.bad}`, background: `${C.bad}12`, opacity: bad, translate: `${shake}px 0px` }}>
            <MonoText size={18} color={C.bad} style={{ letterSpacing: "0.14em" }}>✕ PARAPHRASED</MonoText>
            <Body size={24} style={{ marginTop: 6 }}>no exact match → rejected</Body>
          </div>
        </div>
      </div>
      {/* the path an outcome takes */}
      <div style={{ position: "absolute", left: 1010, top: 250, width: 820 }}>
        {RSTEPS.map((s, i) => {
          const t = rise(f, q.at(s.cue), 16);
          return (
            <div key={s.k} style={{ display: "flex", alignItems: "center", gap: 22, height: 104, opacity: t, translate: `${(1 - t) * 50}px 0px` }}>
              <div style={{ position: "relative", width: 50, height: 50, flexShrink: 0 }}>
                {i === 3 ? (
                  <svg width="50" height="50" viewBox="0 0 50 50">
                    <circle cx="25" cy="25" r="21" fill="none" stroke={C.line2} strokeWidth="4" />
                    <circle cx="25" cy="25" r="21" fill="none" stroke={s.tone} strokeWidth="4" strokeDasharray={132} strokeDashoffset={132 * (1 - win)} transform="rotate(-90 25 25)" />
                  </svg>
                ) : (
                  <div style={{ width: 50, height: 50, borderRadius: 99, border: `2.5px solid ${s.tone}`, background: `${s.tone}22` }} />
                )}
              </div>
              <div>
                <div style={{ fontFamily: display, fontWeight: 800, fontSize: 38, color: C.t100, letterSpacing: "-0.02em" }}>{s.k}</div>
                <Body size={24} style={{ color: C.t400 }}>{s.v}</Body>
              </div>
            </div>
          );
        })}
      </div>
      {RSTEPS.map((s) => <Sfx key={s.k} name="pop" at={q.at(s.cue)} volume={0.35} />)}
      <Sfx name="confirm" at={q.at(2) + 20} volume={0.35} />
      <Sfx name="deny" at={q.at(3)} volume={0.35} />
    </SceneShell>
  );
};

/* ------------------------------------------------------------------ 13. market 8 */
export const Market8: React.FC = () => {
  const q = useCue("market8");
  const rows = [0, 1, 2, 3].map((i) => mark("market8-1", i));
  return (
    <SceneShell>
      <Eyebrow n="09" label="Resolution · market 8, start to finish" />
      <Page
        url={`${LIVE_URL}/markets/8`}
        shots={[{ src: "frames/market8-1.png", from: 0 }]}
        cam={[{ f: q.at(2), rect: [240, 120, 1120, 760], zoom: 1.12 }]}
        overlay={<>{rows.map((r, i) => (
          <Ring key={i} rect={r} from={q.at(3) + i * 9} color={C.bad} label={i === 0 ? "refused by the contract" : undefined} labelSide="top" pad={2} radius={4} fill />
        ))}</>}
      />
      <Callout from={q.at(1)} x={1330} y={120} w={470} tone={C.warn}>
        <Chip tone="warn" size={17}>labelled test market</Chip>
        <div style={{ marginTop: 10, fontSize: 25 }}>Driven by the operator key from a laptop — and its question says so, on chain.</div>
      </Callout>
      {rows.map((_, i) => <Sfx key={i} name="tick" at={q.at(3) + i * 9} volume={0.4} />)}
    </SceneShell>
  );
};

/* ------------------------------------------------------------------ 14. the record */
export const Audit: React.FC = () => {
  const f = useCurrentFrame();
  const q = useCue("audit");
  return (
    <SceneShell>
      <Eyebrow n="10" label="The record" />
      <Page url={`${LIVE_URL}/audit`} shots={[{ src: "frames/audit-0.png", from: 0 }]} cam={[{ f: 0, rect: [200, 150, 1200, 700], len: 260 }]} />
      <Callout from={q.at(2)} x={1260} y={560} w={540} tone={C.accent}>
        <MonoText size={19} color={C.accent2} style={{ letterSpacing: "0.18em" }}>APPEND-ONLY</MonoText>
        <div style={{ marginTop: 8 }}>Every row carries a reason — approvals <i>and</i> refusals.</div>
      </Callout>
      <AbsoluteFill style={{ justifyContent: "flex-end", padding: "0 0 190px 120px", opacity: rise(f, q.at(4), 14), background: "linear-gradient(180deg, transparent 45%, #070709e6 80%)" }}>
        <Big size={88} style={{ textShadow: "0 6px 40px #000" }}>
          <Reveal text="Refusals are the evidence." start={q.at(4)} stagger={3} colorFor={(w) => (w === "evidence." ? C.accent2 : undefined)} />
        </Big>
      </AbsoluteFill>
      <Sfx name="pop" at={q.at(2)} volume={0.35} />
    </SceneShell>
  );
};

/* ------------------------------------------------------------------ 15. close */
export const Close: React.FC = () => {
  const f = useCurrentFrame();
  const q = useCue("close");
  const hit = 7;
  const up = interpolate(f, [q.at(3) - 10, q.at(3) + 14], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const lockup = rise(f, hit - 3, 22);
  const rows = [
    { k: "Live", v: LIVE_URL, tone: C.accent2, at: q.at(3) },
    { k: "Contract", v: CONTRACT, tone: C.ok, at: q.at(4), chip: "verified" },
    { k: "Explorer", v: "testnet.mstscan.com", tone: C.signal, at: q.at(5) },
    { k: "Source", v: REPO_URL, tone: C.t300, at: q.at(5) + 12 },
  ];
  return (
    <SceneShell glow={1.2} glowY={20}>
      <AbsoluteFill style={{ alignItems: "center", translate: `0px ${-up * 250}px` }}>
        <div style={{ marginTop: 300, display: "flex", alignItems: "center", gap: 34, opacity: lockup, scale: String(0.9 + lockup * 0.1 - up * 0.25) }}>
          <Mark size={130} progress={rise(f, hit - 4, 30)} />
          <div style={{ fontFamily: display, fontWeight: 800, fontSize: 150, letterSpacing: "-0.055em", color: C.t100 }}>Auspe<span style={{ color: C.accent }}>X</span></div>
        </div>
        <div style={{ marginTop: 26, fontFamily: display, fontWeight: 700, fontSize: 64, letterSpacing: "-0.03em", color: C.t200, scale: String(1 - up * 0.2) }}>
          <Reveal text="AI proposes." start={q.at(1)} stagger={4} />{" "}
          <Reveal text="Humans and the chain decide." start={q.at(2)} stagger={3} colorFor={(w) => (w === "decide." ? C.accent : undefined)} />
        </div>
      </AbsoluteFill>
      <div style={{ position: "absolute", left: 360, top: 470, width: 1200 }}>
        {rows.map((r) => {
          const t = rise(f, r.at, 16);
          return (
            <div key={r.k} style={{ display: "flex", alignItems: "center", gap: 30, height: 74, borderBottom: `1px solid ${C.line}`, opacity: t, translate: `${(1 - t) * 40}px 0px` }}>
              <MonoText size={22} color={C.t500} style={{ width: 170, letterSpacing: "0.2em", textTransform: "uppercase" }}>{r.k}</MonoText>
              <MonoText size={r.k === "Contract" ? 27 : 32} color={r.tone}>{r.v}</MonoText>
              {r.chip && <Chip tone="ok" size={17}>{r.chip} ✓</Chip>}
            </div>
          );
        })}
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, top: 830, textAlign: "center" }}>
        <Big size={78}>
          <Reveal text="Don't trust me." start={q.at(6)} stagger={4} style={{ color: C.t300 }} />{" "}
          <Reveal text="Check it." start={q.at(7)} stagger={4} colorFor={() => C.accent} />
        </Big>
      </div>
      <div style={{ position: "absolute", left: 0, right: 0, bottom: 34, textAlign: "center", opacity: rise(f, q.end(7) + 20, 20) }}>
        <MonoText size={20} color={C.t500}>MST Testnet · chain 91562037 · running on a testnet and not audited — the README&rsquo;s limitations section is written to be read</MonoText>
      </div>
      {rows.map((r) => <Sfx key={r.k} name="tick" at={r.at} volume={0.4} />)}
    </SceneShell>
  );
};
