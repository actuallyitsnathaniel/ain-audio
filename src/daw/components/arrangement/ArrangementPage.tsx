// ── ARRANGEMENT PAGE — the linear DAW timeline ───────────────────────────────
// Replaces the loop-based beatmaker body. Layout: a transport bar on top, then
// [ track headers (left) | timeline canvas (right) ], then the selected clip's
// editor below (piano roll for MIDI). Track headers reuse the channel-control
// vocabulary (name/mute/solo/vol/pan/preset). The timeline schedules from the
// engine's arrangement; everything auto-saves to localStorage.

import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { engine } from "../../engine";
import { useEngine } from "../../hooks/useEngine";
import { useRafLoop } from "../../hooks/useRafLoop";
import { SectionHead } from "../SectionHead";
import { TrackSection } from "../TrackSection";
import { Knob } from "../Knob";
import { FxRack } from "../audio-lab/FxRack";
import { Timeline } from "./Timeline";
import { ClipEditor } from "./ClipEditor";
import type { ArrTrack, TrackKind } from "../../data/arrangement";

const HEAD_H = 22; // must match Timeline
const ROW_H = 56;
const chip = (active: boolean, danger?: boolean) =>
  "rounded-[3px] border px-[6px] py-[2px] font-mono text-[9px] tracking-[0.05em] transition-colors " +
  (active
    ? danger
      ? "border-[color-mix(in_srgb,#e0654f_60%,transparent)] bg-[color-mix(in_srgb,#e0654f_22%,transparent)] text-[#e98c79]"
      : "border-[color-mix(in_srgb,var(--accent)_60%,transparent)] bg-[color-mix(in_srgb,var(--accent)_22%,transparent)] text-accent"
    : "border-line text-faint hover:text-dim");

function ArrTransport() {
  const eng = useEngine(["transport", "arrange"]);
  const playing = eng.sequencePlaying && eng.arrangeMode;
  const readout = useRef<HTMLSpanElement>(null);
  useRafLoop(() => {
    const el = readout.current;
    if (!el) return;
    const bpb = engine.arrangement.beatsPerBar;
    const beat = engine.arrangementPosition();
    el.textContent = `${Math.floor(beat / bpb) + 1}.${Math.floor(beat % bpb) + 1}`;
  });
  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        className={
          "flex items-center gap-2 rounded-[3px] border px-[14px] py-[7px] font-mono text-[11px] transition-colors " +
          (playing ? "border-accent bg-accent text-[#111]" : "border-line2 text-dim hover:border-accent hover:text-accent")
        }
        onClick={() => engine.toggleArrangement()}
      >
        <span className={playing ? "icon-pause small" : "icon-play small"} aria-hidden />
        {playing ? "stop" : "play"}
      </button>
      <span className="font-mono text-[11px] tabular-nums text-accent" ref={readout}>
        1.1
      </span>
      <button
        className={
          "rounded-[3px] border px-[10px] py-[6px] font-mono text-[10.5px] transition-colors " +
          (eng.arrangement.loop?.on ? "border-accent text-accent" : "border-line text-faint hover:text-dim")
        }
        onClick={() => {
          const l = engine.arrangement.loop;
          if (l) engine.setArrangementLoop(l.start, l.end, !l.on);
          else engine.setArrangementLoop(0, engine.arrangement.beatsPerBar * 4, true);
        }}
        title="toggle the loop brace (shift+drag the ruler to set it)"
      >
        loop
      </button>
      <span className="ml-auto flex items-center gap-3">
        <Knob value={eng.arrangement.bpm} min={40} max={220} defaultValue={120} size={40} onChange={(v) => engine.setArrangementBpm(v)} label="tempo" fmt={(v) => Math.round(v) + " bpm"} />
      </span>
    </div>
  );
}

function TrackHeader({ t, armed, onArm }: { t: ArrTrack; armed: boolean; onArm: (id: string) => void }) {
  const [editing, setEditing] = useState(false);
  return (
    <div className="flex flex-col justify-center gap-[3px] border-b border-line px-[8px]" style={{ height: ROW_H }}>
      <div className="flex items-center gap-[5px]">
        {editing ? (
          <input
            autoFocus
            defaultValue={t.name}
            onBlur={(e) => {
              engine.renameTrack(t.id, e.target.value.trim() || t.name);
              setEditing(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") setEditing(false);
            }}
            className="w-[80px] rounded-[2px] border border-accent bg-panel2 px-[4px] py-[1px] font-mono text-[9px] text-daw-text focus:outline-none"
          />
        ) : (
          <button onClick={() => setEditing(true)} className="min-w-[52px] truncate text-left font-mono text-[9.5px] tracking-[0.03em] text-dim transition-colors hover:text-daw-text" title="rename">
            {t.name}
          </button>
        )}
        {t.kind === "midi" && (
          <button className={chip(armed)} onClick={() => onArm(t.id)} title="arm for keyboard">
            arm
          </button>
        )}
        <span className="ml-auto flex items-center gap-[3px]">
          <button className={chip(t.mute, true)} onClick={() => engine.toggleTrackMute(t.id)} title="mute">
            M
          </button>
          <button className={chip(t.solo)} onClick={() => engine.toggleTrackSolo(t.id)} title="solo">
            S
          </button>
          <button className="rounded-[3px] border border-line px-[5px] py-[2px] font-mono text-[9px] text-faint transition-colors hover:border-[#e0654f] hover:text-[#e98c79]" onClick={() => engine.removeTrack(t.id)} title="remove track">
            ✕
          </button>
        </span>
      </div>
      <div className="flex items-center gap-[6px]">
        <Knob value={t.vol} min={0} max={1} defaultValue={0.8} size={22} onChange={(v) => engine.setTrackVol(t.id, v)} label="" fmt={() => ""} />
        <Knob value={t.pan} min={-1} max={1} defaultValue={0} size={22} bipolar onChange={(v) => engine.setTrackPan(t.id, v)} label="" fmt={() => ""} />
        {t.kind === "midi" && (
          <select
            value={t.presetId}
            onChange={(e) => engine.setTrackPreset(t.id, e.target.value)}
            className="min-w-0 flex-1 cursor-pointer appearance-none rounded-[2px] border border-line2 bg-panel2 px-[4px] py-[1px] font-mono text-[8.5px] text-daw-text hover:border-accent focus:outline-none"
            aria-label="instrument"
          >
            {engine.synthPatches.map((key) => (
              <option key={key} value={key} className="bg-panel2">
                {key}
              </option>
            ))}
          </select>
        )}
        {t.kind !== "midi" && <span className="font-mono text-[8px] text-faint">{t.kind}</span>}
      </div>
    </div>
  );
}

export function ArrangementPage() {
  const eng = useEngine(["arrange", "transport", "preset", "patch"]);
  const tracks = eng.arrangement.tracks;
  const [rawSel, setSel] = useState<{ trackId: string; clipId: string } | null>(null);
  // derive validity during render (no setState-in-effect); a stale selection just
  // resolves to null until the next selection.
  const sel = rawSel && engine.getArrClip(rawSel.trackId, rawSel.clipId) ? rawSel : null;

  useEffect(() => {
    engine.warmArrangement(); // decode restored tracks' instruments up front
    return () => {
      if (engine.arrangeMode) engine.stopArrangement();
    };
  }, []);

  const addTrack = (kind: TrackKind) => {
    engine.addTrack(kind);
  };

  return (
    <main className="relative z-[1] pt-[64px]">
      <TrackSection id="beatmaker" label="arrangement" rail="05">
        <SectionHead num="05" title="arrangement" sub="linear timeline · place clips on tracks · runs through the fx rack" />

        <div className="flex flex-col gap-[12px] rounded-[5px] border border-line bg-panel p-[16px] max-[767px]:p-[12px]">
          <ArrTransport />

          {/* add-track toolbar (kept OUT of the ruler-aligned strip below) */}
          <div className="flex flex-wrap items-center gap-[6px]">
            <span className="font-mono text-[9px] tracking-[0.1em] text-faint">TRACKS</span>
            <button className="rounded-[3px] border border-line px-[9px] py-[4px] font-mono text-[10px] text-dim transition-colors hover:border-accent hover:text-accent" onClick={() => addTrack("midi")}>
              + midi
            </button>
            <button className="rounded-[3px] border border-line px-[9px] py-[4px] font-mono text-[10px] text-dim transition-colors hover:border-accent hover:text-accent" onClick={() => addTrack("drum")}>
              + drum
            </button>
            <button className="rounded-[3px] border border-line px-[9px] py-[4px] font-mono text-[10px] text-dim transition-colors hover:border-accent hover:text-accent" onClick={() => addTrack("audio")}>
              + audio
            </button>
          </div>

          {/* track headers (left) + timeline (right) */}
          <div className="flex overflow-hidden rounded-[4px] border border-line">
            <div className="w-[220px] shrink-0 border-r border-line bg-[#0e0e12]">
              {/* spacer strip aligns the header column with the timeline's ruler */}
              <div className="border-b border-line" style={{ height: HEAD_H }} />
              {tracks.map((t) => (
                <TrackHeader key={t.id} t={t} armed={eng.armedChannel === t.id} onArm={(id) => engine.armChannel(engine.armedChannel === id ? null : id)} />
              ))}
              {tracks.length === 0 && <div className="p-[10px] font-mono text-[9px] leading-[1.55] text-faint">no tracks yet — add one above, then click a lane to place a clip.</div>}
            </div>
            <div className="min-w-0 flex-1">
              <Timeline height={Math.max(160, HEAD_H + tracks.length * ROW_H)} selectedClip={sel?.clipId ?? null} onSelectClip={(trackId, clipId) => setSel({ trackId, clipId })} />
            </div>
          </div>

          {/* selected-clip editor + fx */}
          {sel && <ClipEditor trackId={sel.trackId} clipId={sel.clipId} />}
          <FxRack />
        </div>

        <div className="mt-[14px] flex items-center gap-3 font-mono text-[10.5px] tracking-[0.03em] text-faint">
          <Link to="/" className="rounded-[3px] border border-line px-[10px] py-[5px] text-dim transition-colors hover:border-accent hover:text-accent">
            ← back to the lab
          </Link>
          <span>click a lane to place a clip · drag to move · drag its right edge to resize · double-click a MIDI clip to edit · shift+drag the ruler = loop brace.</span>
        </div>
      </TrackSection>
    </main>
  );
}
