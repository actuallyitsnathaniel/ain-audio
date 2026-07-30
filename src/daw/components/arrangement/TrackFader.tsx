// ── TrackFader — a channel-strip volume fader with an integrated dB meter ──────
// Horizontal fader (fits the track-header row): drag the handle to set gain along the
// dB taper (unity at ¾ travel, +6 dB top, −∞ at the far left). A live meter bar sits
// BEHIND the track (post-fader RMS fill + peak-hold tick + clip latch), and a numeric
// dB readout is click-to-type. Imperative meter (rAF), React only for the handle pos.

import { useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { Levels } from "../../engine";
import { useRafLoop } from "../../hooks/useRafLoop";
import { posToGain, gainToPos, lin2db, fmtDb, dbToMeter, MAX_DB, MIN_DB } from "../../db-fader";

export function TrackFader({
  gain,
  getLevel,
  onChange,
  width,
  className = "",
}: {
  gain: number; // stored linear gain
  getLevel: () => Levels; // live post-fader {rms, peak} dB
  onChange: (gain: number) => void;
  /** Fixed width in px. Omit for fluid (pair with className flex-1). */
  width?: number;
  className?: string;
}) {
  const pos = gainToPos(gain);
  const drag = useRef<{ x: number; pos: number } | null>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const rmsRef = useRef<HTMLDivElement>(null);
  const peakRef = useRef<HTMLDivElement>(null);
  const clipRef = useRef<HTMLDivElement>(null);
  const readRef = useRef<HTMLSpanElement>(null);
  const hold = useRef({ v: -90, t: 0, clip: 0 });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  // live meter — RMS fill + 1.4s peak-hold tick + clip latch (peak ≥ 0 dBFS holds 2s)
  useRafLoop(() => {
    const { rms, peak } = getLevel();
    const now = performance.now();
    if (peak > hold.current.v || now - hold.current.t > 1400) {
      hold.current.v = peak;
      hold.current.t = now;
    }
    if (peak >= -0.1) hold.current.clip = now; // clip latch at ~0 dBFS
    if (rmsRef.current) rmsRef.current.style.width = dbToMeter(rms) * 100 + "%";
    if (peakRef.current) peakRef.current.style.left = dbToMeter(hold.current.v) * 100 + "%";
    if (clipRef.current) clipRef.current.style.opacity = now - hold.current.clip < 2000 ? "1" : "0";
    if (readRef.current && !editing) readRef.current.textContent = fmtDb(lin2db(gain));
  });

  const posFromX = (clientX: number) => {
    const el = trackRef.current;
    if (!el) return pos;
    const r = el.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - r.left) / r.width));
  };
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = posFromX(e.clientX);
    drag.current = { x: e.clientX, pos: p };
    onChange(posToGain(p));
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    // shift = fine (¼ sensitivity) for surgical moves around unity
    const el = trackRef.current;
    const w = el ? el.getBoundingClientRect().width : width || 120;
    const dp = ((e.clientX - drag.current.x) / w) * (e.shiftKey ? 0.25 : 1);
    const next = Math.min(1, Math.max(0, drag.current.pos + dp));
    onChange(posToGain(next));
    // coarse mode re-anchors each move (1:1 tracking); fine mode keeps the anchor so
    // the ¼ scaling accumulates from the gesture start
    if (!e.shiftKey) {
      drag.current.pos = next;
      drag.current.x = e.clientX;
    }
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    drag.current = null;
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };
  const commitEdit = () => {
    const v = parseFloat(draft.replace("−", "-"));
    if (!Number.isNaN(v)) onChange(Math.pow(10, Math.min(MAX_DB, Math.max(MIN_DB, v)) / 20));
    setEditing(false);
  };

  const unityPct = 75; // unity tick at ¾ travel
  return (
    <div
      className={"flex min-w-0 items-center gap-1 " + className}
      style={width != null ? { width } : undefined}
    >
      <div className="relative flex-1">
        {/* the fader groove with the meter bar behind + unity tick */}
        <div
          data-fader
          ref={trackRef}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onDoubleClick={() => onChange(1)}
          className="relative h-3.5 cursor-ew-resize touch-none overflow-hidden rounded-[3px] border border-line bg-[#0c0c10]"
          title="drag = level · shift = fine · double-click = unity (0 dB)"
        >
          {/* post-fader RMS meter fill */}
          <div ref={rmsRef} className="absolute inset-y-0 left-0 w-0 bg-linear-to-r from-[color-mix(in_srgb,var(--accent)_45%,#0c0c10)] to-accent transition-[width] duration-50 ease-linear" />
          {/* peak-hold tick */}
          <div ref={peakRef} className="absolute inset-y-0 w-[1.5px] bg-white/80" style={{ left: 0 }} />
          {/* unity gridline */}
          <div className="absolute inset-y-0 w-px bg-white/20" style={{ left: unityPct + "%" }} />
          {/* clip latch (right edge) */}
          <div ref={clipRef} className="absolute inset-y-0 right-0 w-0.75 bg-[#e0654f] opacity-0 transition-opacity" />
          {/* the handle */}
          <div className="pointer-events-none absolute top-1/2 h-4.5 w-1 -translate-1/2  rounded-[1.5px] bg-daw-text shadow-[0_0_3px_rgba(0,0,0,0.6)]" style={{ left: pos * 100 + "%" }} />
        </div>
      </div>
      {/* dB readout — click to type */}
      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={(e) => e.target.select()}
          onBlur={commitEdit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitEdit();
            else if (e.key === "Escape") setEditing(false);
          }}
          className="w-8.5 rounded-xs border border-accent bg-inset text-center font-mono text-[8.5px] text-accent outline-none"
          aria-label="level dB"
        />
      ) : (
        <span
          ref={readRef}
          onClick={() => {
            setDraft(fmtDb(lin2db(gain)).replace("−", "-"));
            setEditing(true);
          }}
          className="w-8.5 cursor-text text-right font-mono text-[8.5px] text-dim tabular-nums"
          title="click to type dB"
        >
          −∞
        </span>
      )}
    </div>
  );
}
