import React from "react";
import { interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { C, MONO } from "../theme";

/** Real captured stdout, revealed line by line. Nothing here is retyped by hand. */
export const Terminal: React.FC<{ lines: string[]; command: string; startAt?: number }> = ({
  lines, command, startAt = 0,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const f = frame - startAt * fps;

  const typed = Math.max(0, Math.min(command.length, Math.floor(f / 1.15)));
  const afterCmd = command.length * 1.15 + 10;
  const shown = Math.max(0, Math.floor((f - afterCmd) / 2.1));
  const caret = Math.floor(f / 14) % 2 === 0;

  return (
    <div
      style={{
        width: 1520, background: C.ink950, border: `1px solid ${C.ink700}`, borderRadius: 12,
        overflow: "hidden", boxShadow: "0 40px 120px rgba(0,0,0,0.6)",
      }}
    >
      <div style={{ display: "flex", gap: 9, padding: "16px 22px", background: C.ink900, borderBottom: `1px solid ${C.ink800}` }}>
        {[C.ink600, C.ink600, C.ink600].map((c, i) => (
          <div key={i} style={{ width: 12, height: 12, borderRadius: 99, background: c }} />
        ))}
        <div style={{ fontFamily: MONO, fontSize: 16, color: C.ink500, marginLeft: 14 }}>auspex — check:links</div>
      </div>

      <div style={{ padding: "26px 30px", fontFamily: MONO, fontSize: 22, lineHeight: 1.62, minHeight: 470 }}>
        <div style={{ color: C.ink100 }}>
          <span style={{ color: C.ok }}>$ </span>
          {command.slice(0, typed)}
          {typed < command.length && caret ? <span style={{ color: C.signal }}>▊</span> : null}
        </div>
        {lines.slice(0, shown).map((l, i) => (
          <div key={i} style={{ color: l.includes("ok") ? C.ink300 : C.ink200, whiteSpace: "pre" }}>
            {l.includes("ok") ? (
              <>
                <span style={{ color: C.ok }}>  ok  </span>
                {l.replace(/^\s*ok\s*/, "")}
              </>
            ) : (
              l
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
