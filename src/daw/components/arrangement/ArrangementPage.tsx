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
import { Timeline } from "./Timeline";
import { ClipEditor } from "./ClipEditor";
import { PlaybackPane } from "./PlaybackPane";
import { openContextMenu } from "../context-menu-bus";
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


function TrackHeader({ t, armed, selected, fxOpen, onArm, onFx }: { t: ArrTrack; armed: boolean; selected: boolean; fxOpen: boolean; onArm: (id: string) => void; onFx: (id: string) => void }) {
  const [editing, setEditing] = useState(false);
  const hasFx = !!t.devices?.length;
  return (
    <div
      className={"flex flex-col justify-center gap-[3px] border-b border-line px-[8px] transition-colors " + (selected ? "bg-[color-mix(in_srgb,var(--accent)_10%,transparent)]" : "")}
      style={{ height: ROW_H }}
      onPointerDown={(e) => {
        // click the header background (not a button/input/knob) → select the whole track
        const el = e.target as HTMLElement;
        if (el.closest("button,input,select,svg")) return;
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
        <button className={chip(fxOpen || hasFx)} onClick={() => onFx(t.id)} title={hasFx ? "track fx (" + t.devices!.length + " device" + (t.devices!.length > 1 ? "s" : "") + ")" : "track fx"}>
          fx
        </button>
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

// the master row's fx-panel key in fxTrackId (can't collide with newTrackId ids)
const MASTER_ID = "__master__";

// The MASTER track's header — the mix bus pinned under the track list, Ableton-style.
// Same vocabulary as TrackHeader: name row, then fader + fx chip.
function MasterHeader({ fxOpen, onFx }: { fxOpen: boolean; onFx: () => void }) {
  const eng = useEngine(["fx"]);
  const anyOn = eng.masterDevices().some((d) => !!(d.params as { on?: boolean }).on);
  return (
    <div className="flex flex-col justify-center gap-[3px] px-[8px]" style={{ height: ROW_H }}>
      <div className="flex items-center gap-[5px]">
        <span className="min-w-[52px] font-mono text-[9.5px] tracking-[0.03em] text-accent">master</span>
        <span className="ml-auto font-mono text-[8px] text-faint">bus</span>
      </div>
      <div className="flex items-center gap-[6px]">
        <Knob value={eng.masterVol} min={0} max={1} defaultValue={0.95} size={22} onChange={(v) => engine.setMasterVol(v)} label="" fmt={() => ""} />
        <button className={chip(fxOpen || anyOn)} onClick={onFx} title="master fx">
          fx
        </button>
      </div>
    </div>
  );
}

// The selected track's FX chain, bound to the engine's per-track device API.
function TrackFxPanel({ t }: { t: ArrTrack }) {
  useEngine(["fx"]);
  return (
    <div className="border-t border-line pt-[14px]">
      <div className="mb-[10px] font-mono text-[10.5px] tracking-[0.06em] text-faint">
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
  const eng = useEngine(["arrange", "transport", "preset", "patch", "synth", "select", "fx"]);
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
  // The bottom editor follows the SELECTION: whenever exactly one clip is selected (click,
  // arrow-key, split result…), it edits that clip. A multi-selection keeps the last single
  // editor open. `editSel` is a local fallback (e.g. a double-clicked clip within a multi).
  const [editSel, setEditSel] = useState<{ trackId: string; clipId: string } | null>(null);
  const primary = eng.selClips.size === 1 ? engine.primaryClip() : null;
  const sel = primary ?? (editSel && engine.getArrClip(editSel.trackId, editSel.clipId) ? editSel : null);
  // the MIDI track whose clip is being edited — its instrument is what the INSTRUMENT
  // panel edits (patches are shared by key, so editing here changes that track's sound).
  const selTrack = sel ? tracks.find((t) => t.id === sel.trackId) : undefined;
  const selMidiTrack = selTrack?.kind === "midi" ? selTrack : undefined;

  useEffect(() => {
    void engine.loadPersistedAudio(); // re-hydrate imported audio clips from IndexedDB
    engine.warmArrangement(); // decode restored tracks' instruments up front
    return () => {
      if (engine.arrangeMode) engine.stopArrangement();
    };
  }, []);

  // ── the arrangement is the KEYBOARD AUTHORITY (not DOM focus) ──
  // A single page-level handler routes transport + edit keys, so Space always plays and
  // Delete always deletes the SELECTION — regardless of which button the mouse last
  // touched. Operates on engine.selClips (the multi-selection). Defers only when the
  // user is genuinely typing in a field.
  useEffect(() => {
    const typing = (t: EventTarget | null) => {
      const el = t as HTMLElement | null;
      const tag = (el?.tagName || "").toLowerCase();
      return tag === "input" || tag === "textarea" || !!el?.isContentEditable;
    };
    const onKey = (e: KeyboardEvent) => {
      if (typing(e.target)) return;
      const meta = e.metaKey || e.ctrlKey;
      // transport
      if (e.code === "Space") { e.preventDefault(); if (e.shiftKey) engine.playArrangementFromCursor(); else engine.toggleArrangement(); return; }
      if (e.code === "Home") { e.preventDefault(); engine.returnToStart(); return; }
      if (e.key.toLowerCase() === "l" && !meta) {
        e.preventDefault();
        const l = engine.arrangement.loop;
        if (l) engine.setArrangementLoop(l.start, l.end, !l.on);
        else engine.setArrangementLoop(0, engine.arrangement.beatsPerBar * 4, true);
        return;
      }
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
      // undo / redo: ⌘Z · ⌘⇧Z (or ⌘Y)
      if (meta && e.key.toLowerCase() === "z") { e.preventDefault(); if (e.shiftKey) engine.redo(); else engine.undo(); setEditSel(null); return; }
      if (meta && e.key.toLowerCase() === "y") { e.preventDefault(); engine.redo(); setEditSel(null); return; }
      // arrow keys on the selection (need a selection to matter)
      if (engine.selClips.size) {
        const step = meta ? 0.25 : engine.snapBeats > 0 ? engine.snapBeats : 1; // ⌘ = fine (1/16)
        if (e.key === "ArrowLeft") { e.preventDefault(); if (e.shiftKey) engine.resizeSelection(-step); else engine.nudgeSelection(-step); return; }
        if (e.key === "ArrowRight") { e.preventDefault(); if (e.shiftKey) engine.resizeSelection(step); else engine.nudgeSelection(step); return; }
        if (e.key === "ArrowUp") { e.preventDefault(); engine.moveSelectionTracks(-1); return; }
        if (e.key === "ArrowDown") { e.preventDefault(); engine.moveSelectionTracks(1); return; }
        if (e.key.toLowerCase() === "r" && !meta) { e.preventDefault(); engine.reverseSelection(); return; }
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

  return (
    <main className="relative z-[1] pt-[64px]">
      <TrackSection id="studio" label="studio" rail="05">
        <SectionHead num="05" title="studio" sub="linear timeline · place midi, drum + audio clips on tracks · runs through the fx rack" />

        <div className="flex flex-col gap-[12px] rounded-[5px] border border-line bg-panel p-[16px] max-[767px]:p-[12px]">
          <PlaybackPane />

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
            <button
              className="ml-auto rounded-[3px] border border-line px-[9px] py-[4px] font-mono text-[10px] text-faint transition-colors hover:border-[#e0654f] hover:text-[#e98c79]"
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
          <div className="overflow-hidden rounded-[4px] border border-line">
            <div className="flex">
              <div className="w-[220px] shrink-0 border-r border-line bg-[#0e0e12]">
                {/* spacer strip aligns the header column with the timeline's ruler */}
                <div className="border-b border-line" style={{ height: HEAD_H }} />
                {tracks.map((t) => (
                  <TrackHeader key={t.id} t={t} armed={eng.armedChannel === t.id} selected={eng.selTrackId === t.id} fxOpen={fxTrackId === t.id} onArm={(id) => engine.armChannel(engine.armedChannel === id ? null : id)} onFx={toggleFx} />
                ))}
                {tracks.length === 0 && <div className="p-[10px] font-mono text-[9px] leading-[1.55] text-faint">no tracks yet — add one above, then double-click a lane to create a clip.</div>}
              </div>
              <div className="min-w-0 flex-1">
                <Timeline height={Math.max(160, HEAD_H + tracks.length * ROW_H)} onEditClip={(trackId, clipId) => setEditSel({ trackId, clipId })} zoomApiRef={zoomApiRef} />
              </div>
            </div>
            {/* MASTER — the mix bus as its own pinned track row (Ableton-style) */}
            <div className="flex border-t border-line">
              <div className="w-[220px] shrink-0 border-r border-line bg-[color-mix(in_srgb,var(--accent)_7%,#0e0e12)]">
                <MasterHeader fxOpen={fxTrackId === MASTER_ID} onFx={() => toggleFx(MASTER_ID)} />
              </div>
              <div className="min-w-0 flex-1 bg-[#0c0c10]" />
            </div>
          </div>

          {/* selected MIDI track's instrument designer (edits that track's patch) */}
          {selMidiTrack && <Instrument />}
          {/* selected-clip editor */}
          {sel && <ClipEditor trackId={sel.trackId} clipId={sel.clipId} />}
          {/* the open FX chain: a track's, or the master's (from the MASTER row's fx chip) */}
          {fxTrack && <TrackFxPanel t={fxTrack} />}
          {fxTrackId === MASTER_ID && <FxRack hint="master fx — every track sums into this chain · add devices, drag ⠿ to reorder" />}
        </div>

        <div className="mt-[14px] flex items-center gap-3 font-mono text-[10.5px] tracking-[0.03em] text-faint">
          <Link to="/" className="rounded-[3px] border border-line px-[10px] py-[5px] text-dim transition-colors hover:border-accent hover:text-accent">
            ← back to the lab
          </Link>
          <span>dbl-click = create · click = insert marker · drag = move (⌘ free, multi-select drags together) · ⌥-drag = duplicate · drag edge = resize · shift-click = multi-select · drag empty = marquee · space play · +/− zoom · ⌫ delete · ⌘D dup · ⌘C/X/V · ⌘Z undo · ⌘E split · ⌘J consolidate (audio = real bounce) · ⌘I insert · ←→ nudge · shift+←→ resize · ↑↓ track · R reverse.</span>
        </div>
      </TrackSection>
    </main>
  );
}
