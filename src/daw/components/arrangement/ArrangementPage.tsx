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
import { SectionHead } from "../SectionHead";
import { TrackSection } from "../TrackSection";
import { Knob } from "../Knob";
import { FxRack } from "../audio-lab/FxRack";
import { FxChainRack } from "../FxChainRack";
import { Instrument } from "../audio-lab/Instrument";
import { PL_KEYMAP } from "../audio-lab/synth-ui";
import { Timeline } from "./Timeline";
import { ClipEditor } from "./ClipEditor";
import { PlaybackPane } from "./PlaybackPane";
import { TrackFader } from "./TrackFader";
import { openContextMenu } from "../context-menu-bus";
import type { ArrTrack, TrackKind } from "../../data/arrangement";

const HEAD_H = 22; // must match Timeline
const ROW_H = 64; // must match Timeline ROW_H
const chip = (active: boolean, danger?: boolean) =>
  "rounded-[3px] border px-1.5 py-0.5 font-mono text-[9px] tracking-[0.05em] transition-colors duration-150 " +
  (active
    ? danger
      ? "border-[color-mix(in_srgb,#e0654f_60%,transparent)] bg-[color-mix(in_srgb,#e0654f_22%,transparent)] text-[#e98c79]"
      : "border-[color-mix(in_srgb,var(--accent)_60%,transparent)] bg-[color-mix(in_srgb,var(--accent)_22%,transparent)] text-accent"
    : "border-line text-faint hover:text-dim");

/** Track arm — same vocabulary as transport ●: square chip + red disk (not a naked circle). */
const armChip = (armed: boolean, arming?: boolean) =>
  "flex size-[18px] shrink-0 cursor-pointer items-center justify-center rounded-[3px] border transition-colors duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-red-500/60 " +
  (arming
    ? "border-red-500/70 bg-[color-mix(in_srgb,#ef4444_18%,transparent)]"
    : armed
      ? "border-red-500 bg-[color-mix(in_srgb,#ef4444_28%,transparent)] hover:bg-[color-mix(in_srgb,#ef4444_40%,transparent)]"
      : "border-line hover:border-[color-mix(in_srgb,#ef4444_55%,transparent)]");

const armDot = (armed: boolean) =>
  "inline-block size-2 rounded-full transition-[background-color,box-shadow] duration-150 " +
  (armed
    ? "bg-red-500 shadow-[0_0_6px_color-mix(in_srgb,#ef4444_55%,transparent)]"
    : "bg-[color-mix(in_srgb,#ef4444_40%,#5c5c66)]");

function TrackHeader({
  t,
  armed,
  arming,
  selected,
  fxOpen,
  onArm,
  onFx,
}: {
  t: ArrTrack;
  armed: boolean;
  arming?: boolean;
  selected: boolean;
  fxOpen: boolean;
  onArm: (id: string) => void;
  onFx: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const hasFx = !!t.devices?.length;
  return (
    <div
      className={"flex flex-col justify-center gap-1 border-b border-line px-2 transition-colors " + (selected ? "bg-[color-mix(in_srgb,var(--accent)_10%,transparent)]" : "")}
      style={{ height: ROW_H }}
      onPointerDown={(e) => {
        // click the header background (not a button/input/knob/fader) → select the track
        const el = e.target as HTMLElement;
        if (el.closest("button,input,select,svg,[data-fader]")) return;
        engine.selectTrack(t.id);
      }}
      onContextMenu={(e) => {
        if (e.shiftKey) return;
        e.preventDefault();
        engine.selectTrack(t.id);
        openContextMenu({
          x: e.clientX,
          y: e.clientY,
          title: t.name,
          items: [
            { label: "select all clips", onClick: () => engine.selectTrack(t.id) },
            { label: t.mute ? "unmute" : "mute", onClick: () => engine.toggleTrackMute(t.id) },
            { label: t.solo ? "unsolo" : "solo", onClick: () => engine.toggleTrackSolo(t.id) },
            { label: fxOpen ? "hide track fx" : "track fx…", onClick: () => onFx(t.id) },
            { separator: true },
            { label: "delete track", danger: true, onClick: () => engine.removeTrack(t.id) },
          ],
        });
      }}
    >
      <div className="flex items-center gap-1.25">
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
            className="w-20 rounded-xs border border-accent bg-panel2 px-1 py-px font-mono text-[9px] text-daw-text focus:outline-none"
          />
        ) : (
          <button onClick={() => setEditing(true)} className="min-w-13 truncate text-left font-mono text-[9.5px] tracking-[0.03em] text-dim transition-colors hover:text-daw-text" title="rename">
            {t.name}
          </button>
        )}
        <span className="ml-auto flex items-center gap-0.75">
          {/* arm sits with M/S — same square chrome as transport ● */}
          <button
            type="button"
            aria-pressed={armed}
            aria-busy={arming || undefined}
            aria-label={
              arming ? "opening audio input…" : armed ? "disarm track" : "arm track for record"
            }
            onClick={() => onArm(t.id)}
            title={
              arming
                ? "opening input…"
                : t.kind === "audio"
                  ? armed
                    ? "armed — click to disarm"
                    : "arm for audio input (mic/interface) · ● to record"
                  : armed
                    ? "armed — click to disarm"
                    : t.kind === "drum"
                      ? "arm for pads / MIDI · ● records into a drum clip"
                      : "arm for keyboard / MIDI · M for computer keys"
            }
            className={armChip(armed, arming)}
          >
            {arming ? (
              <span
                className="size-2.5 shrink-0 animate-spin rounded-full border-[1.5px] border-red-500/35 border-t-red-500"
                aria-hidden
              />
            ) : (
              <span className={armDot(armed)} aria-hidden />
            )}
          </button>
          <button className={chip(t.mute, true)} onClick={() => engine.toggleTrackMute(t.id)} title="mute">
            M
          </button>
          <button className={chip(t.solo)} onClick={() => engine.toggleTrackSolo(t.id)} title="solo">
            S
          </button>
          <button className="rounded-[3px] border border-line px-1.25 py-0.5 font-mono text-[9px] text-faint transition-colors duration-150 hover:border-[#e0654f] hover:text-[#e98c79]" onClick={() => engine.removeTrack(t.id)} title="remove track">
            ✕
          </button>
        </span>
      </div>
      {/* fader + live meter (fills the row) */}
      <TrackFader gain={t.vol} getLevel={() => engine.trackLevel(t.id)} onChange={(g) => engine.setTrackVol(t.id, g)} width={126} />
      <div className="flex items-center gap-1.5">
        <Knob value={t.pan} min={-1} max={1} defaultValue={0} size={20} bipolar onChange={(v) => engine.setTrackPan(t.id, v)} label="" fmt={() => ""} />
        {/* glows ONLY while this track's fx pane is open (the glow = "keys/edits go here";
            a has-devices glow on every track made it easy to edit the wrong one) */}
        <button className={chip(fxOpen)} onClick={() => onFx(t.id)} title={hasFx ? "track fx (" + t.devices!.length + " device" + (t.devices!.length > 1 ? "s" : "") + ")" : "track fx"}>
          fx
        </button>
        {t.kind === "midi" && (
          <select
            value={t.presetId}
            onChange={(e) => engine.setTrackPreset(t.id, e.target.value)}
            className="min-w-0 flex-1 cursor-pointer appearance-none rounded-xs border border-line2 bg-panel2 px-1 py-px font-mono text-[8.5px] text-daw-text hover:border-accent focus:outline-none"
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

// the master row's fx-panel key in fxTrackId (can't collide with newTrackId ids)
const MASTER_ID = "__master__";

// The MASTER track's header — the mix bus pinned under the track list, Ableton-style.
// Same vocabulary as TrackHeader: name row, then fader + fx chip.
function MasterHeader({ fxOpen, onFx }: { fxOpen: boolean; onFx: () => void }) {
  const eng = useEngine(["fx"]);
  return (
    <div className="flex flex-col justify-center gap-1 px-2" style={{ height: ROW_H }}>
      <div className="flex items-center gap-1.25">
        <span className="font-mono text-[9.5px] tracking-[0.03em] text-accent">master</span>
        <span className="font-mono text-[8px] text-faint">bus</span>
        {/* meter tap: pre = program level before the safety limiter; post = final output */}
        <button
          className={"ml-auto " + chip(false)}
          onClick={() => engine.setMasterMeterPost(!eng.masterMeterPost)}
          title="master meter tap — pre = before the safety limiter · post = final output"
        >
          {eng.masterMeterPost ? "post" : "pre"}
        </button>
        <button className={chip(fxOpen)} onClick={onFx} title="master fx">
          fx
        </button>
      </div>
      {/* same fader + meter treatment as a track, reading the master bus level */}
      <TrackFader gain={eng.masterVol} getLevel={() => engine.masterLevel()} onChange={(g) => engine.setMasterVol(g)} width={126} />
    </div>
  );
}

// The selected track's FX chain, bound to the engine's per-track device API.
function TrackFxPanel({ t }: { t: ArrTrack }) {
  useEngine(["fx"]);
  return (
    <div className="border-t border-line pt-3.5">
      <div className="mb-2.5 font-mono text-[10.5px] tracking-[0.06em] text-faint">
        track fx — <span className="text-dim">{t.name}</span> · inserted between the track's volume and pan
      </div>
      <FxChainRack
        devices={engine.trackDevices(t.id)}
        onAdd={(ty) => engine.addTrackDevice(t.id, ty)}
        onRemove={(id) => engine.removeTrackDevice(t.id, id)}
        onMove={(id, to) => engine.moveTrackDevice(t.id, id, to)}
        onSetParams={(id, p) => engine.setTrackDeviceParams(t.id, id, p)}
      />
    </div>
  );
}

export function ArrangementPage() {
  const eng = useEngine(["arrange", "transport", "preset", "patch", "synth", "select", "fx", "clip"]);
  const tracks = eng.arrangement.tracks;
  // which track's FX panel is open (toggled from the track header's fx chip)
  const [fxTrackId, setFxTrackId] = useState<string | null>(null);
  const fxTrack = fxTrackId ? tracks.find((t) => t.id === fxTrackId) : undefined; // auto-hides if deleted
  const toggleFx = (id: string) => {
    if (id !== MASTER_ID) engine.selectTrack(id);
    setFxTrackId((cur) => (cur === id ? null : id));
  };
  // timeline zoom controls, filled by <Timeline> — the page key handler drives them
  const zoomApiRef = useRef<{ zoom: (factor: number) => void } | null>(null);
  // ── pane KEY FOCUS (Ableton-style last-clicked area): edit keys go exclusively to
  // the focused pane. Ref for the (stable) key handler, state for the visual ring.
  const [pane, setPane] = useState<"timeline" | "editor">("timeline");
  const paneRef = useRef<"timeline" | "editor">("timeline");
  const focusPane = (p: "timeline" | "editor") => {
    paneRef.current = p;
    setPane(p);
    // taking focus back to the timeline must also drop the piano roll's DOM focus,
    // or its canvas onKeyDown would double-fire alongside the timeline keys
    if (p === "timeline" && document.activeElement instanceof HTMLElement && document.activeElement.tagName === "CANVAS") document.activeElement.blur();
  };
  // The bottom editor follows the SELECTION: whenever exactly one clip is selected (click,
  // arrow-key, split result…), it edits that clip. A multi-selection keeps the last single
  // editor open. `editSel` is a local fallback (e.g. a double-clicked clip within a multi).
  const [editSel, setEditSel] = useState<{ trackId: string; clipId: string } | null>(null);
  const primary = eng.selClips.size === 1 ? engine.primaryClip() : null;
  const sel = primary ?? (editSel && engine.getArrClip(editSel.trackId, editSel.clipId) ? editSel : null);
  // Instrument panel: selected MIDI clip's track, OR the armed MIDI track (so arming
  // alone is enough to hear/edit — no clip selection required).
  const selTrack = sel ? tracks.find((t) => t.id === sel.trackId) : undefined;
  const armedTrack = eng.armedChannel
    ? tracks.find((t) => t.id === eng.armedChannel)
    : undefined;
  const instrumentTrack =
    (selTrack?.kind === "midi" ? selTrack : undefined) ||
    (armedTrack?.kind === "midi" ? armedTrack : undefined);
  const selMidiTrack = instrumentTrack;

  useEffect(() => {
    void engine.loadPersistedAudio(); // re-hydrate imported audio clips from IndexedDB
    engine.warmArrangement(); // decode restored tracks' instruments up front
    return () => {
      if (engine.arrangeMode) engine.stopArrangement();
    };
  }, []);

  // Ableton Computer MIDI Keyboard (M): when on, letter keys play the armed/selected
  // track via noteOn — independent of whether Instrument is mounted (that was the bug).
  useEffect(() => {
    const held: Record<string, number> = {};
    const typing = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      const tag = (el?.tagName || "").toLowerCase();
      return tag === "input" || tag === "textarea" || !!el?.isContentEditable;
    };
    const releaseAll = () => {
      for (const k of Object.keys(held)) {
        engine.noteOff(held[k]);
        delete held[k];
      }
    };
    const dn = (e: KeyboardEvent) => {
      if (!engine.midiKeys) return;
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      if (typing(e.target)) return;
      const key = e.key.toLowerCase();
      if (key === "z") {
        e.preventDefault();
        engine.setMidiOctave(engine.midiOctave - 1);
        return;
      }
      if (key === "x") {
        e.preventDefault();
        engine.setMidiOctave(engine.midiOctave + 1);
        return;
      }
      if (key === "c") {
        e.preventDefault();
        engine.setMidiVel(engine.midiVel - 0.1);
        return;
      }
      if (key === "v") {
        e.preventDefault();
        engine.setMidiVel(engine.midiVel + 0.1);
        return;
      }
      const base = PL_KEYMAP[key];
      if (base === undefined || held[key] !== undefined) return;
      e.preventDefault();
      const m = base + engine.midiOctave * 12;
      held[key] = m;
      engine.noteOn(m, engine.midiVel);
    };
    const up = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (held[key] !== undefined) {
        engine.noteOff(held[key]);
        delete held[key];
      }
      // toggling M off mid-hold: release everything
      if (key === "m" && !engine.midiKeys) releaseAll();
    };
    window.addEventListener("keydown", dn);
    window.addEventListener("keyup", up);
    return () => {
      releaseAll();
      window.removeEventListener("keydown", dn);
      window.removeEventListener("keyup", up);
    };
  }, []);

  // ── the arrangement is the KEYBOARD AUTHORITY (not DOM focus) — with PANE FOCUS ──
  // A single page-level handler routes keys. TRANSPORT + UNDO are global (Space always
  // plays, like Ableton). EDIT keys go exclusively to the pane that has KEY FOCUS —
  // "timeline" (default) or "editor" (the bottom instrument/clip/fx region) — set by
  // the last pointer-down (Ableton/Logic's last-clicked-area model). The piano roll's
  // own note keys live on its DOM-focused canvas, so they're exclusive by nature; when
  // the timeline takes focus back we blur that canvas so keys can't double-fire.
  useEffect(() => {
    const typing = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      const tag = (el?.tagName || "").toLowerCase();
      return tag === "input" || tag === "textarea" || !!el?.isContentEditable;
    };
    const onKey = (e: KeyboardEvent) => {
      if (typing(e.target)) return;
      const meta = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      // Ableton M — Computer MIDI Keyboard on/off (before other letter shortcuts)
      if (key === "m" && !meta && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        engine.toggleMidiKeys();
        return;
      }
      // when MIDI keys are on, letter-row pitches + Z/X/C/V are owned by the play
      // handler above — don't steal them for L-loop / etc.
      if (engine.midiKeys && !meta) {
        if (PL_KEYMAP[key] !== undefined || key === "z" || key === "x" || key === "c" || key === "v") return;
      }
      // ── GLOBAL: transport + undo, whatever pane is focused ──
      if (e.code === "Space") { e.preventDefault(); if (e.shiftKey) engine.playArrangementFromCursor(); else engine.toggleArrangement(); return; }
      if (e.code === "Home") { e.preventDefault(); engine.cursorToStart(); return; }
      if (e.code === "End") { e.preventDefault(); engine.cursorToEnd(); return; }
      if (key === "l" && !meta) {
        e.preventDefault();
        const l = engine.arrangement.loop;
        if (l) engine.setArrangementLoop(l.start, l.end, !l.on);
        else engine.setArrangementLoop(0, engine.arrangement.beatsPerBar * 4, true);
        return;
      }
      // MIDI record (first slice) — Shift+R so bare R keeps reverse-selection
      if (key === "r" && e.shiftKey && !meta) {
        e.preventDefault();
        engine.toggleRecord();
        return;
      }
      // (undo keeps the surviving selection, so the editor stays open — the ClipEditor
      // remounts its roll/grid via engine.undoStamp to show the restored content).
      // Editor pane: scope ⌘Z to that clip's content/slip/swing edits (roll-local) —
      // timeline focus undoes anything on the shared stack. Read clip id live from the
      // engine (this effect has [] deps — don't close over React `sel`).
      if (meta && e.key.toLowerCase() === "z") {
        e.preventDefault();
        const clip = engine.selClips.size === 1 ? engine.primaryClip() : null;
        const scope =
          paneRef.current === "editor" && clip ? "content:" + clip.clipId : undefined;
        if (e.shiftKey) engine.redo(scope);
        else engine.undo(scope);
        return;
      }
      if (meta && e.key.toLowerCase() === "y") {
        e.preventDefault();
        const clip = engine.selClips.size === 1 ? engine.primaryClip() : null;
        const scope =
          paneRef.current === "editor" && clip ? "content:" + clip.clipId : undefined;
        engine.redo(scope);
        return;
      }
      // grid size: ⌘1 finer · ⌘2 coarser (Ableton) — PANE-AWARE: steps the timeline's
      // snap ladder or the piano roll's own grid, whichever pane has key focus
      if (meta && (e.key === "1" || e.key === "2")) {
        e.preventDefault();
        if (paneRef.current === "timeline") {
          const grid = [engine.arrangement.beatsPerBar, 1, 0.5, 0.25, 0.125]; // bar → 1/32
          const i = grid.findIndex((g) => Math.abs(g - engine.snapBeats) < 1e-6);
          engine.setSnapBeats(e.key === "1" ? (i < 0 ? 0.25 : grid[Math.min(grid.length - 1, i + 1)]) : i < 0 ? 1 : grid[Math.max(0, i - 1)]);
        } else {
          const grid = [1, 0.5, 0.25, 0.125]; // 1/4 → 1/32
          const i = grid.findIndex((g) => Math.abs(g - engine.rollSnapBeats) < 1e-6);
          const at = i < 0 ? 2 : i; // unknown value → treat as 1/16
          engine.setRollSnapBeats(e.key === "1" ? grid[Math.min(grid.length - 1, at + 1)] : grid[Math.max(0, at - 1)]);
        }
        return;
      }
      // ── everything below is TIMELINE-scoped: skip when the editor pane has focus
      // (the piano roll / editors handle their own keys there) ──
      if (paneRef.current !== "timeline") return;
      // timeline zoom: + / − Ableton-style, and ⌘+/− (intercepted — this page's zoom,
      // not the browser's). "=" is the unshifted + key.
      if (e.key === "+" || e.key === "=") { e.preventDefault(); zoomApiRef.current?.zoom(1.25); return; }
      if (e.key === "-" || e.key === "_") { e.preventDefault(); zoomApiRef.current?.zoom(1 / 1.25); return; }
      // select-all
      if (meta && e.key.toLowerCase() === "a") { e.preventDefault(); engine.selectAllClips(); return; }
      // delete every selected clip
      if (e.key === "Delete" || e.key === "Backspace") {
        const ids = [...engine.selClips];
        if (!ids.length) return;
        e.preventDefault();
        engine.deleteSelectedClips();
        setEditSel(null);
        return;
      }
      // duplicate every selected clip (⌘D)
      if (meta && e.key.toLowerCase() === "d") {
        if (!engine.selClips.size) return;
        e.preventDefault();
        engine.duplicateSelectedClips();
        return;
      }
      // time-editing: ⌘E split · ⌘J consolidate · ⌘I insert silence (at the insert marker)
      if (meta && e.key.toLowerCase() === "e") { e.preventDefault(); engine.splitAtInsert(); return; }
      if (meta && e.key.toLowerCase() === "j") { e.preventDefault(); void engine.consolidateSelection(); return; }
      if (meta && e.key.toLowerCase() === "i") { e.preventDefault(); engine.insertSilence(); return; }
      // clipboard: ⌘C copy · ⌘X cut · ⌘V paste (at the insert marker)
      if (meta && e.key.toLowerCase() === "c") { if (engine.selClips.size) { e.preventDefault(); engine.copySelection(); } return; }
      if (meta && e.key.toLowerCase() === "x") { if (engine.selClips.size) { e.preventDefault(); engine.cutSelection(); setEditSel(null); } return; }
      if (meta && e.key.toLowerCase() === "v") { if (engine.hasClipboard()) { e.preventDefault(); engine.pasteClipboard(); } return; }
      // arrow keys — SELECTION WINS (nudge/resize/track-hop); with nothing selected
      // they move the merged cursor instead (Ableton's context model).
      if (engine.selClips.size) {
        // "0" — deactivate/reactivate the selected clips (Ableton)
        if (e.key === "0" && !meta) { e.preventDefault(); engine.toggleMuteSelection(); return; }
        const step = meta ? 0.25 : engine.snapBeats > 0 ? engine.snapBeats : 1; // ⌘ = fine (1/16)
        if (e.key === "ArrowLeft") { e.preventDefault(); if (e.shiftKey) engine.resizeSelection(-step); else engine.nudgeSelection(-step); return; }
        if (e.key === "ArrowRight") { e.preventDefault(); if (e.shiftKey) engine.resizeSelection(step); else engine.nudgeSelection(step); return; }
        if (e.key === "ArrowUp") { e.preventDefault(); engine.moveSelectionTracks(-1); return; }
        if (e.key === "ArrowDown") { e.preventDefault(); engine.moveSelectionTracks(1); return; }
        if (e.key.toLowerCase() === "r" && !meta) { e.preventDefault(); engine.reverseSelection(); return; }
      } else {
        // no selection → arrows move the merged cursor. ⌘⇧←/→ jumps to the prev/next
        // clip edge; ⌘←/→ steps fine (1/16); plain ←/→ steps the grid.
        if (e.key === "ArrowLeft") { e.preventDefault(); if (meta && e.shiftKey) engine.cursorToClipEdge(-1); else engine.moveCursor(-1, meta); return; }
        if (e.key === "ArrowRight") { e.preventDefault(); if (meta && e.shiftKey) engine.cursorToClipEdge(1); else engine.moveCursor(1, meta); return; }
      }
      if (e.key === "Escape") { engine.clearSelection(); setEditSel(null); return; }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // focus the selected MIDI track's patch in the shared instrument editor
  useEffect(() => {
    if (selMidiTrack?.presetId) engine.setSynthPatch(selMidiTrack.presetId);
  }, [selMidiTrack?.id, selMidiTrack?.presetId]);

  // …and mirror the other way: if the INSTRUMENT selector switches patch while a track
  // is focused, assign that patch to the track. Guarded by inequality → converges, no loop.
  useEffect(() => {
    if (selMidiTrack && eng.synthPatch !== selMidiTrack.presetId) engine.setTrackPreset(selMidiTrack.id, eng.synthPatch);
  }, [eng.synthPatch, selMidiTrack]);

  const addTrack = (kind: TrackKind) => {
    engine.addTrack(kind);
  };

  // when nothing renders in the editor region, key focus falls back to the timeline.
  // The ref resets in an effect; the VISIBLE pane derives (no setState-in-effect) —
  // any editor reopening path (double-click, fx chip) calls focusPane itself.
  const editorOpen = !!(selMidiTrack || sel || fxTrack || fxTrackId === MASTER_ID);
  useEffect(() => {
    if (!editorOpen) paneRef.current = "timeline";
  }, [editorOpen]);
  const paneShown = editorOpen ? pane : "timeline";
  // the focused pane's cue (box-shadow ring — no layout shift)
  const focusRing = " ring-1 ring-[color-mix(in_srgb,var(--accent)_30%,transparent)]";

  return (
    <main className="relative z-1 pt-16">
      <TrackSection id="studio" label="studio" rail="05">
        <SectionHead num="05" title="studio" sub="linear timeline · place midi, drum + audio clips on tracks · runs through the fx rack" />

        <div className="flex flex-col gap-3 rounded-[5px] border border-line bg-panel p-4 max-[767px]:p-3" onPointerDownCapture={() => focusPane("timeline")}>
          <PlaybackPane />

          {/* add-track toolbar (kept OUT of the ruler-aligned strip below) */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-[9px] tracking-widest text-faint">TRACKS</span>
            <button className="rounded-[3px] border border-line px-2.25 py-1 font-mono text-[10px] text-dim transition-colors hover:border-accent hover:text-accent" onClick={() => addTrack("midi")}>
              + midi
            </button>
            <button className="rounded-[3px] border border-line px-2.25 py-1 font-mono text-[10px] text-dim transition-colors hover:border-accent hover:text-accent" onClick={() => addTrack("drum")}>
              + drum
            </button>
            <button className="rounded-[3px] border border-line px-2.25 py-1 font-mono text-[10px] text-dim transition-colors hover:border-accent hover:text-accent" onClick={() => addTrack("audio")}>
              + audio
            </button>
            <button
              className="ml-auto rounded-[3px] border border-line px-2.25 py-1 font-mono text-[10px] text-faint transition-colors hover:border-[#e0654f] hover:text-[#e98c79]"
              onClick={() => {
                if (window.confirm("New project — this clears the entire studio AND all imported audio (from local storage). This can't be undone. Continue?")) {
                  void engine.newProject();
                  setEditSel(null);
                }
              }}
              title="clear the studio + all imported audio, start fresh"
            >
              new project
            </button>
          </div>

          {/* track headers (left) + timeline (right), with the MASTER row pinned below */}
          <div className={"overflow-hidden rounded-sm border border-line" + (editorOpen && paneShown === "timeline" ? focusRing : "")}>
            <div className="flex">
              <div className="w-55 shrink-0 border-r border-line bg-[#0e0e12]">
                {/* spacer strip aligns the header column with the timeline's ruler */}
                <div className="border-b border-line" style={{ height: HEAD_H }} />
                {tracks.map((t) => (
                  <TrackHeader
                    key={t.id}
                    t={t}
                    armed={eng.armedChannel === t.id}
                    arming={
                      eng.armedChannel === t.id &&
                      t.kind === "audio" &&
                      eng.inputStatus === "pending"
                    }
                    selected={eng.selTrackId === t.id}
                    fxOpen={fxTrackId === t.id}
                    onArm={(id) => engine.armChannel(engine.armedChannel === id ? null : id)}
                    onFx={toggleFx}
                  />
                ))}
                {tracks.length === 0 && <div className="p-2.5 font-mono text-[9px] leading-[1.55] text-faint">no tracks yet — add one above, then double-click a lane to create a clip.</div>}
              </div>
              <div className="min-w-0 flex-1">
                <Timeline
                height={Math.max(160, HEAD_H + tracks.length * ROW_H)}
                onEditClip={(trackId, clipId) => {
                  setEditSel({ trackId, clipId });
                  focusPane("editor"); // double-click-to-edit focuses the editor (Ableton)
                }}
                zoomApiRef={zoomApiRef}
              />
              </div>
            </div>
            {/* MASTER — the mix bus as its own pinned track row (Ableton-style) */}
            <div className="flex border-t border-line">
              <div className="w-55 shrink-0 border-r border-line bg-[color-mix(in_srgb,var(--accent)_7%,#0e0e12)]">
                <MasterHeader fxOpen={fxTrackId === MASTER_ID} onFx={() => toggleFx(MASTER_ID)} />
              </div>
              <div className="min-w-0 flex-1 bg-[#0c0c10]" />
            </div>
          </div>

          {/* ── EDITOR pane (instrument · clip editor · fx) — clicking here takes key
              focus away from the timeline, so piano-roll keys never move clips ── */}
          {editorOpen && (
            <div className={"flex flex-col gap-3 rounded-sm" + (paneShown === "editor" ? focusRing : "")} onPointerDownCapture={() => focusPane("editor")}>
              {/* selected-clip editor (piano roll) sits directly under the timeline */}
              {sel && <ClipEditor trackId={sel.trackId} clipId={sel.clipId} />}
              {/* selected MIDI track's instrument designer (edits that track's patch) */}
              {selMidiTrack && <Instrument enableTypingKeys={false} />}
              {/* the open FX chain: a track's, or the master's (from the MASTER row's fx chip) */}
              {fxTrack && <TrackFxPanel t={fxTrack} />}
              {fxTrackId === MASTER_ID && <FxRack hint="master fx — every track sums into this chain · add devices, drag ⠿ to reorder" />}
            </div>
          )}
        </div>

        <div className="mt-3.5 flex items-start gap-3 font-mono text-[10.5px] leading-[1.55] tracking-[0.03em] text-faint">
          <Link
            to="/"
            className="shrink-0 rounded-[3px] border border-line px-2.5 py-1.25 text-dim transition-colors hover:border-accent hover:text-accent"
          >
            ← back to the lab
          </Link>

          <details className="min-w-0">
            <summary className="cursor-pointer select-none text-faint transition-colors hover:text-accent">
              arrangement view shortcuts
            </summary>
            {/* .keycap (index.css) inflates unicode key glyphs to match this mono size */}
            <div className="mt-1.5 ml-0.5 flex flex-col gap-y-2.5">
              <div>
                <div className="mb-0.5 text-[9px] tracking-widest text-faint uppercase">focus & navigation</div>
                <ul className="flex flex-col gap-y-1">
                  <li>
                    <span className="text-dim">focus</span> · click a pane to key-focus (edit keys follow focused pane;
                    space/undo are global)
                  </li>
                  <li>
                    <span className="text-dim">no selection</span> · <span className="keycap">←</span>/
                    <span className="keycap">→</span> move cursor · <span className="keycap">⌘</span> fine ·{" "}
                    <span className="keycap">⌘⇧</span> edge jump · Home/End
                  </li>
                  <li>
                    <span className="text-dim">with selection</span> · <span className="keycap">←</span>/
                    <span className="keycap">→</span> nudge · Shift+<span className="keycap">←</span>/
                    <span className="keycap">→</span> resize · <span className="keycap">↑</span>/
                    <span className="keycap">↓</span> change track · R reverse · 0 mute
                  </li>
                  <li>
                    <span className="text-dim">play</span> · Space (from cursor)
                  </li>
                  <li>
                    <span className="text-dim">zoom</span> · + / <span className="keycap">−</span>
                  </li>
                  <li>
                    <span className="text-dim">grid</span> · <span className="keycap">⌘</span>1 /{" "}
                    <span className="keycap">⌘</span>2
                  </li>
                </ul>
              </div>
              <div>
                <div className="mb-0.5 text-[9px] tracking-widest text-faint uppercase">selection, creation & clipboard</div>
                <ul className="flex flex-col gap-y-1">
                  <li>
                    <span className="text-dim">multi-select</span> · Shift+click
                  </li>
                  <li>
                    <span className="text-dim">marquee</span> · drag empty area
                  </li>
                  <li>
                    <span className="text-dim">create clip</span> · double-click empty lane
                  </li>
                  <li>
                    <span className="text-dim">insert</span> · <span className="keycap">⌘</span>I
                  </li>
                  <li>
                    <span className="text-dim">duplicate</span> · <span className="keycap">⌘</span>D or{" "}
                    <span className="keycap">⌥</span>-drag
                  </li>
                  <li>
                    <span className="text-dim">copy/cut/paste</span> · <span className="keycap">⌘</span>C /{" "}
                    <span className="keycap">⌘</span>X / <span className="keycap">⌘</span>V
                  </li>
                  <li>
                    <span className="text-dim">delete</span> · <span className="keycap">⌫</span>
                  </li>
                  <li>
                    <span className="text-dim">undo</span> · <span className="keycap">⌘</span>Z
                  </li>
                </ul>
              </div>
              <div>
                <div className="mb-0.5 text-[9px] tracking-widest text-faint uppercase">editing, movement & arrangement</div>
                <ul className="flex flex-col gap-y-1">
                  <li>
                    <span className="text-dim">move clip</span> · drag (<span className="keycap">⌘</span> = free,
                    multi-select drags together)
                  </li>
                  <li>
                    <span className="text-dim">slip content</span> · Shift+<span className="keycap">⌥</span>-drag
                  </li>
                  <li>
                    <span className="text-dim">resize clip</span> · drag edge (<span className="keycap">⌥</span> = stretch
                    content)
                  </li>
                  <li>
                    <span className="text-dim">split</span> · <span className="keycap">⌘</span>E
                  </li>
                  <li>
                    <span className="text-dim">consolidate</span> · <span className="keycap">⌘</span>J{" "}
                    <span className="text-faint">(audio = real bounce)</span>
                  </li>
                </ul>
              </div>
              <div>
                <div className="mb-0.5 text-[9px] tracking-widest text-faint uppercase">midi, instruments & special</div>
                <ul className="flex flex-col gap-y-1">
                  <li>
                    <span className="text-dim">record midi</span> · Shift+R
                  </li>
                  <li>
                    <span className="text-dim">computer keys as midi</span> · M
                  </li>
                </ul>
              </div>
              <div>
                <div className="mb-0.5 text-[9px] tracking-widest text-faint uppercase">miscellaneous</div>
                <ul className="flex flex-col gap-y-1">
                  <li>
                    <span className="text-dim">move cursor</span> · click timeline
                  </li>
                </ul>
              </div>
            </div>
          </details>
        </div>
      </TrackSection>
    </main>
  );
}
