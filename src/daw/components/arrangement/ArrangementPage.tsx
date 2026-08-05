// ── ARRANGEMENT PAGE — the linear DAW timeline ───────────────────────────────
// Replaces the loop-based beatmaker body. Layout: a transport bar on top, then
// [ track headers (left) | timeline canvas (right) ], then the selected clip's
// editor below (piano roll for MIDI). Track headers reuse the channel-control
// vocabulary (name/mute/solo/vol/pan/preset). The timeline schedules from the
// engine's arrangement; everything auto-saves to localStorage.

import { useEffect, useRef, useState } from "react";
import { engine } from "../../engine";
import { useEngine } from "../../hooks/useEngine";
import { useAinFileLaunch } from "../../hooks/useAinFileLaunch";
import { Knob } from "../Knob";
import { FxRack } from "../audio-lab/FxRack";
import { FxChainRack } from "../FxChainRack";
import { Instrument } from "../audio-lab/Instrument";
import { PL_KEYMAP } from "../audio-lab/synth-ui";
import { Timeline } from "./Timeline";
import { ClipEditor } from "./ClipEditor";
import { PlaybackPane } from "./PlaybackPane";
import { FileMenu } from "./FileMenu";
import { StudioStatusStrip } from "./StudioStatusStrip";
import { ShortcutsHelp } from "./ShortcutsHelp";
import { TrackFader } from "./TrackFader";
import { AudioAcceptSheet } from "./AudioAcceptSheet";
import { BounceCancelConfirm } from "./BounceCancelConfirm";
import { openContextMenu } from "../context-menu-bus";
import { requestMidiEnable } from "../midi-gate-bus";
import type { ArrTrack, TrackKind } from "../../data/arrangement";

const HEAD_H = 30; // must match Timeline
const ROW_H = 64; // must match Timeline ROW_H
const KIND_BAR: Record<TrackKind, string> = {
  midi: "#4a7fd4",
  drum: "#5aa0b8",
  audio: "#7a9a4a",
};
const chip = (active: boolean, danger?: boolean) =>
  "rounded-[3px] border px-1 py-px font-mono text-[8.5px] tracking-[0.04em] transition-colors duration-150 " +
  (active
    ? danger
      ? "border-[color-mix(in_srgb,#e0654f_60%,transparent)] bg-[color-mix(in_srgb,#e0654f_22%,transparent)] text-[#e98c79]"
      : "border-[color-mix(in_srgb,var(--accent)_60%,transparent)] bg-[color-mix(in_srgb,var(--accent)_22%,transparent)] text-accent"
    : "border-line text-faint hover:text-dim");

/** Track arm — same vocabulary as transport ●: square chip + red disk (not a naked circle). */
const armChip = (armed: boolean, arming?: boolean) =>
  "flex size-4 shrink-0 cursor-pointer items-center justify-center rounded-[3px] border transition-colors duration-150 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-red-500/60 " +
  (arming
    ? "border-red-500/70 bg-[color-mix(in_srgb,#ef4444_18%,transparent)]"
    : armed
      ? "border-red-500 bg-[color-mix(in_srgb,#ef4444_28%,transparent)] hover:bg-[color-mix(in_srgb,#ef4444_40%,transparent)]"
      : "border-line hover:border-[color-mix(in_srgb,#ef4444_55%,transparent)]");

const armDot = (armed: boolean) =>
  "inline-block size-1.5 rounded-full transition-[background-color,box-shadow] duration-150 " +
  (armed
    ? "bg-red-500 shadow-[0_0_5px_color-mix(in_srgb,#ef4444_55%,transparent)]"
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
      className={
        "relative flex flex-col justify-center gap-0.5 border-b border-line py-1 pr-1.5 pl-2.5 transition-colors " +
        (selected ? "bg-[color-mix(in_srgb,var(--accent)_10%,transparent)]" : "")
      }
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
      {/* kind color rail */}
      <span
        className="absolute inset-y-1 left-0 w-0.75 rounded-r-[1px]"
        style={{ background: KIND_BAR[t.kind] }}
        aria-hidden
      />
      <div className="flex items-center gap-1">
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
            className="w-18 rounded-xs border border-accent bg-panel2 px-1 py-px font-mono text-[9px] text-daw-text focus:outline-none"
          />
        ) : (
          <button
            onClick={() => setEditing(true)}
            className="min-w-0 flex-1 truncate text-left font-mono text-[9px] tracking-[0.03em] text-dim transition-colors hover:text-daw-text"
            title="rename"
          >
            {t.name}
          </button>
        )}
        <span className="flex shrink-0 items-center gap-0.5">
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
                className="size-2 shrink-0 animate-spin rounded-full border-[1.5px] border-red-500/35 border-t-red-500"
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
          <button
            className="rounded-[3px] border border-line px-1 py-px font-mono text-[8.5px] text-faint transition-colors duration-150 hover:border-[#e0654f] hover:text-[#e98c79]"
            onClick={() => engine.removeTrack(t.id)}
            title="remove track"
          >
            ✕
          </button>
        </span>
      </div>
      {/* fader row: pan · fader · fx · instrument/kind */}
      <div className="flex min-w-0 items-center gap-1">
        <Knob
          value={t.pan}
          min={-1}
          max={1}
          defaultValue={0}
          size={18}
          bipolar
          onChange={(v) => engine.setTrackPan(t.id, v)}
          label=""
          fmt={() => ""}
        />
        <TrackFader
          gain={t.vol}
          getLevel={() => engine.trackLevel(t.id)}
          onChange={(g) => engine.setTrackVol(t.id, g)}
          className="min-w-0 flex-1"
        />
        <button
          className={chip(fxOpen)}
          onClick={() => onFx(t.id)}
          title={
            hasFx
              ? "track fx (" +
                t.devices!.length +
                " device" +
                (t.devices!.length > 1 ? "s" : "") +
                ")"
              : "track fx"
          }
        >
          fx
        </button>
        {t.kind === "midi" ? (
          <select
            value={t.presetId}
            onChange={(e) => engine.setTrackPreset(t.id, e.target.value)}
            className="max-w-22 min-w-0 flex-1 cursor-pointer appearance-none truncate rounded-xs border border-line2 bg-panel2 px-0.75 py-px font-mono text-[8px] text-daw-text hover:border-accent focus:outline-none"
            aria-label="instrument"
            title={t.presetId}
          >
            {engine.synthPatches.map((key) => (
              <option key={key} value={key} className="bg-panel2">
                {key}
              </option>
            ))}
          </select>
        ) : (
          <span className="shrink-0 font-mono text-[8px] text-faint">{t.kind}</span>
        )}
      </div>
    </div>
  );
}

// the master row's fx-panel key in fxTrackId (can't collide with newTrackId ids)
const MASTER_ID = "__master__";

// The MASTER track's header — denser 2-row strip matching TrackHeader.
// pre/post meter tap lives on StudioStatusStrip (don't duplicate here).
function MasterHeader({ fxOpen, onFx }: { fxOpen: boolean; onFx: () => void }) {
  const eng = useEngine(["fx"]);
  return (
    <div className="flex flex-col justify-center gap-0.5 px-2 py-1" style={{ height: ROW_H }}>
      <div className="flex items-center gap-1">
        <span className="font-mono text-[9px] tracking-[0.03em] text-accent">master</span>
        <span className="font-mono text-[8px] text-faint">bus</span>
        <button className={"ml-auto " + chip(fxOpen)} onClick={onFx} title="master fx">
          fx
        </button>
      </div>
      <TrackFader
        gain={eng.masterVol}
        getLevel={() => engine.masterLevel()}
        onChange={(g) => engine.setMasterVol(g)}
        className="w-full"
      />
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
        onCopy={(id) => engine.copyTrackDevice(t.id, id)}
        onPaste={() => engine.pasteTrackDevice(t.id)}
        onDuplicate={(id) => engine.duplicateTrackDevice(t.id, id)}
        canPaste={engine.hasFxClipboard()}
        pasteLabel={engine.fxClipboardLabel()}
        readViz={(id) => engine.readTrackFxViz(t.id, id)}
      />
    </div>
  );
}

export function ArrangementPage() {
  const eng = useEngine(["arrange", "transport", "preset", "patch", "synth", "select", "fx", "clip"]);
  useAinFileLaunch();
  const tracks = eng.arrangement.tracks;
  // which track's FX panel is open (toggled from the track header's fx chip)
  const [fxTrackId, setFxTrackId] = useState<string | null>(null);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [acceptOpen, setAcceptOpen] = useState(false);
  // Space during a realtime bounce asks before binning it (see BounceCancelConfirm).
  // Keyed by bounce id rather than a boolean, so the question dies with its bounce
  // and a stale "yes" can't greet the next one.
  const [confirmBounceId, setConfirmBounceId] = useState<number | null>(null);
  const askCancelBounce = eng.bouncing && confirmBounceId === eng.bounceId;
  const acceptContinue = useRef<(() => void) | null>(null);
  const requestAccept = (after: () => void) => {
    acceptContinue.current = after;
    setAcceptOpen(true);
  };
  const finishAccept = () => {
    setAcceptOpen(false);
    const fn = acceptContinue.current;
    acceptContinue.current = null;
    fn?.();
  };
  const tryArm = (id: string) => {
    const next = eng.armedChannel === id ? null : id;
    const t = next ? tracks.find((x) => x.id === next) : null;
    if (t?.kind === "audio" && !engine.hasAudioAccepted()) {
      requestAccept(() => engine.armChannel(next));
      return;
    }
    if (t?.kind === "midi" || t?.kind === "drum") requestMidiEnable();
    engine.armChannel(next);
  };
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
      // ── a realtime bounce owns the transport ──
      // Space asks to cancel (the reflex when you want the noise to stop); the other
      // transport keys are swallowed, since moving the playhead mid-capture would
      // record the jump into the file.
      if (engine.bouncing) {
        if (e.code === "Space" || e.code === "Home" || e.code === "End" || key === "l") {
          e.preventDefault();
          if (e.code === "Space") setConfirmBounceId(engine.bounceId);
          return;
        }
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
      // ⌘L — set loop brace from the time / clip selection (and turn it on)
      if (key === "l" && meta) {
        e.preventDefault();
        if (!engine.loopFromSelection()) {
          const l = engine.arrangement.loop;
          if (l) engine.setArrangementLoop(l.start, l.end, !l.on);
          else engine.setArrangementLoop(0, engine.arrangement.beatsPerBar * 4, true);
        }
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
    <main
      id="studio"
      data-screen-label="studio"
      className="relative z-1 flex min-h-[calc(100vh-3.5rem)] flex-col pt-14"
    >
      {/* Studio app chrome — full-bleed DAW, not a numbered portfolio section.
          Padding matches the site transport bar (px-4) so File lines up under AIN·STUDIO. */}
      <div className="mx-auto flex w-full max-w-400 flex-1 flex-col px-4 pb-3 max-[767px]:px-3">
        {/* toolbar — File flush left; no redundant "studio" title (lives in the nav mark) */}
        <header className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-line py-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <FileMenu
              prefsOpen={prefsOpen}
              onPrefsOpenChange={setPrefsOpen}
              onRequestAccept={requestAccept}
              onNewProject={() => {
                if (
                  window.confirm(
                    "New project — this clears the entire studio AND all imported audio (from local storage). This can't be undone. Continue?",
                  )
                ) {
                  void engine.newProject();
                  setEditSel(null);
                }
              }}
            />
            <span className="mx-0.5 hidden h-4 w-px bg-line sm:block" aria-hidden />
            <span className="font-mono text-[9px] tracking-widest text-faint">
              +
            </span>
            <button
              type="button"
              className="flex h-7 items-center rounded-sm border border-line2 px-2 font-mono text-[10px] text-dim transition-colors hover:border-accent hover:text-accent"
              onClick={() => addTrack("midi")}
            >
              midi
            </button>
            <button
              type="button"
              className="flex h-7 items-center rounded-sm border border-line2 px-2 font-mono text-[10px] text-dim transition-colors hover:border-accent hover:text-accent"
              onClick={() => addTrack("drum")}
            >
              drum
            </button>
            <button
              type="button"
              className="flex h-7 items-center rounded-sm border border-line2 px-2 font-mono text-[10px] text-dim transition-colors hover:border-accent hover:text-accent"
              onClick={() => addTrack("audio")}
            >
              audio
            </button>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <ShortcutsHelp />
          </div>
        </header>

        {/* workspace */}
        <div
          className="mt-2 flex min-h-0 flex-1 flex-col overflow-hidden rounded-sm border border-line bg-[#0c0c10]"
          onPointerDownCapture={() => focusPane("timeline")}
        >
          <PlaybackPane />

          <div className="px-2 pt-1.5 pb-1">
            <StudioStatusStrip
              onOpenIo={() => {
                if (!engine.hasAudioAccepted()) {
                  requestAccept(() => setPrefsOpen(true));
                  return;
                }
                setPrefsOpen(true);
              }}
            />
          </div>

          {/* track headers (left) + timeline (right), MASTER pinned below */}
          <div
            className={
              "mx-2 mb-2 min-h-0 flex-1 overflow-hidden rounded-sm border border-line" +
              (editorOpen && paneShown === "timeline" ? focusRing : "")
            }
          >
            <div className="flex">
              <div className="w-60 shrink-0 border-r border-line bg-[#0e0e12]">
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
                    onArm={tryArm}
                    onFx={toggleFx}
                  />
                ))}
                {tracks.length === 0 && (
                  <div className="px-2.5 py-3 font-mono text-[9px] leading-snug text-faint">
                    no tracks — add midi / drum / audio above, then double-click a
                    lane.
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <Timeline
                  height={Math.max(160, HEAD_H + tracks.length * ROW_H)}
                  onEditClip={(trackId, clipId) => {
                    setEditSel({ trackId, clipId });
                    focusPane("editor");
                  }}
                  zoomApiRef={zoomApiRef}
                />
              </div>
            </div>
            <div className="flex border-t border-line">
              <div className="w-60 shrink-0 border-r border-line bg-[color-mix(in_srgb,var(--accent)_7%,#0e0e12)]">
                <MasterHeader
                  fxOpen={fxTrackId === MASTER_ID}
                  onFx={() => toggleFx(MASTER_ID)}
                />
              </div>
              <div className="flex min-w-0 flex-1 items-center bg-[#0a0a0e] px-3">
                <span className="font-mono text-[9px] tracking-[0.08em] text-faint">
                  sum bus · all tracks → master fx → out
                </span>
              </div>
            </div>
          </div>

          {editorOpen && (
            <div
              className={
                "mx-2 mb-2 flex flex-col gap-2.5 rounded-sm border border-line2 bg-[#0a0a0e] p-2.5 " +
                (paneShown === "editor" ? focusRing : "")
              }
              onPointerDownCapture={() => focusPane("editor")}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-mono text-[9px] tracking-widest text-faint">
                  EDITOR
                </span>
                <span className="min-w-0 truncate font-mono text-[9.5px] text-dim">
                  {[
                    sel &&
                      (engine.getArrClip(sel.trackId, sel.clipId)?.name ||
                        selTrack?.name ||
                        "clip"),
                    selMidiTrack && `${selMidiTrack.name} · instrument`,
                    fxTrack && `${fxTrack.name} fx`,
                    fxTrackId === MASTER_ID && "master fx",
                  ]
                    .filter(Boolean)
                    .join(" · ") || "select a clip or open fx"}
                </span>
              </div>
              {sel && <ClipEditor trackId={sel.trackId} clipId={sel.clipId} />}
              {selMidiTrack && <Instrument enableTypingKeys={false} />}
              {fxTrack && <TrackFxPanel t={fxTrack} />}
              {fxTrackId === MASTER_ID && (
                <FxRack hint="master fx — every track sums into this chain · add devices, drag ⠿ to reorder" />
              )}
            </div>
          )}
        </div>
      </div>

      {acceptOpen && (
        <div data-audio-accept>
          <AudioAcceptSheet onDone={finishAccept} />
        </div>
      )}

      {askCancelBounce && (
        <BounceCancelConfirm
          onKeep={() => setConfirmBounceId(null)}
          onCancelBounce={() => {
            engine.cancelBounce();
            setConfirmBounceId(null);
          }}
        />
      )}
    </main>
  );
}
