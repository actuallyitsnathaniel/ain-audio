// ── CLIP EDITOR — the bottom pane for the selected arrangement clip ──────────
// MIDI clip → the PianoRoll bound to the clip's NoteClip (edits write back to the
// arrangement via engine.setClipContent). Drum/audio editors land in Phase 3.
// Keyed by clipId in the parent so switching clips remounts with fresh content.

import { useState } from "react";
import { engine } from "../../engine";
import { useEngine } from "../../hooks/useEngine";
import { Knob } from "../Knob";
import { PianoRoll } from "../piano-roll/PianoRoll";
import { DrumClipGrid } from "./DrumClipGrid";
import { DrumLaneEditor } from "./DrumLaneEditor";
import { AudioClipEditor } from "./AudioClipEditor";
import { allKits, findKit, resizeRow } from "../../data/kits";
import type { SequenceClip } from "../../data/kits";
import type { NoteClip } from "../../data/clips";
import { patternToNotes, notesToPattern, pitchLaneName, reconcileGridEdit } from "../../data/drum-midi";

// per-clip swing (optional, like Ableton): 50% = straight (off) → 75% = hard. Applied
// at schedule time — the roll/grid always shows the straight positions.
function SwingKnob({ trackId, clipId, value }: { trackId: string; clipId: string; value?: number }) {
  return (
    <Knob
      value={value ?? 0.5}
      min={0.5}
      max={0.75}
      defaultValue={0.5}
      size={24}
      onChange={(v) => engine.setClipSwing(trackId, clipId, v)}
      label="swing"
      fmt={(v) => (v <= 0.505 ? "off" : Math.round(v * 100) + "%")}
    />
  );
}

// a drum clip, editable as a step SEQUENCE or a kit-labeled PIANO ROLL. The roll is
// LOSSLESS: it edits real notes (off-grid, variable length/vel, multi-hits), stored as
// `content.notes` — the source of truth. The sequence grid shows those notes on-grid and
// hatch-flags any step whose notes it can't fully represent. A grid edit is on-grid, so
// it regenerates the notes from the grid.
function DrumClipView({ trackId, clipId, pat, notes, startBeat, swing, stamp }: { trackId: string; clipId: string; pat: SequenceClip; notes?: NoteClip; startBeat: number; swing?: number; stamp: string }) {
  const [view, setView] = useState<"seq" | "roll">("seq");
  const kit = findKit(pat.kitId);
  const [laneId, setLaneId] = useState(kit.lanes[0]?.id ?? "kick");
  // sequence-view pattern: derive from notes when they're the truth, else the raw pattern
  const gridPat = notes ? { ...pat, ...notesToPattern(notes, kit, pat.steps) } : pat;
  // grid edit → reconcile against existing notes so off-grid/held detail on untouched
  // cells survives; only the toggled cells add/remove on-grid notes.
  const commitGrid = (p: SequenceClip) => engine.setClipContent(trackId, clipId, { kind: "drum", pattern: p, notes: notes ? reconcileGridEdit(notes, p, kit) : patternToNotes(p, kit) });
  // roll edit → store the notes verbatim; keep pattern for kitId/steps
  const commitRoll = (nc: NoteClip) => engine.setClipContent(trackId, clipId, { kind: "drum", pattern: pat, notes: nc });
  // pattern length in bars — grows/shrinks the step grid AND the roll together.
  // Shrinking drops notes past the new end (the step-slice rule); growing keeps all.
  const barSteps = pat.beatsPerBar * 4; // 1/16 steps per bar
  const patBars = Math.max(1, Math.round(pat.steps / barSteps));
  const setBars = (nBars: number) => {
    const steps = Math.max(1, Math.min(16, nBars)) * barSteps;
    const on: Record<string, boolean[]> = {};
    const accent: Record<string, boolean[]> = {};
    for (const k of Object.keys(pat.on)) on[k] = resizeRow(pat.on[k], steps);
    for (const k of Object.keys(pat.accent)) accent[k] = resizeRow(pat.accent[k], steps);
    const lenBeats = steps * 0.25;
    const nc = notes ? { ...notes, bars: Math.max(1, Math.ceil(lenBeats / pat.beatsPerBar)), notes: notes.notes.filter((n) => n.start < lenBeats - 1e-6) } : undefined;
    engine.setClipContent(trackId, clipId, { kind: "drum", pattern: { ...pat, steps, on, accent }, notes: nc });
  };
  const barOpts = [...new Set([1, 2, 4, 8, 16, patBars])].sort((a, b) => a - b);
  const kits = allKits();
  const saveKit = () => {
    const name =
      window.prompt("Save kit as…", kit.name || "my kit")?.trim() ||
      "my kit";
    const saved = engine.saveCurrentKitAs(name);
    engine.setClipContent(trackId, clipId, {
      kind: "drum",
      pattern: { ...pat, kitId: saved.id },
      notes,
    });
  };
  const tab = (v: "seq" | "roll", label: string) => (
    <button
      onClick={() => setView(v)}
      className={"rounded-[3px] px-2.25 py-0.75 font-mono text-[9px] tracking-[0.08em] transition-colors " + (view === v ? "bg-[color-mix(in_srgb,var(--accent)_18%,transparent)] text-accent" : "text-faint hover:text-dim")}
    >
      {label}
    </button>
  );
  return (
    <div className="flex flex-col gap-2 rounded-sm border border-line bg-[#0e0e12] p-2.5">
      <div className="flex items-center gap-2">
        <span className="font-mono text-[10px] tracking-[0.08em] text-faint">DRUMS</span>
        {/* per-clip kit picker — switching kits re-voices the same pattern (lane ids match) */}
        <span className="relative inline-flex items-center">
          <select
            value={pat.kitId || engine.kit.id}
            onChange={(e) => {
              const id = e.target.value;
              engine.setClipContent(trackId, clipId, { kind: "drum", pattern: { ...pat, kitId: id }, notes });
              void engine.loadKit(findKit(id));
            }}
            aria-label="kit"
            className="cursor-pointer appearance-none rounded-xs border border-line2 bg-panel2 py-0.5 pr-4 pl-1.5 font-mono text-[9px] text-daw-text hover:border-accent focus:outline-none"
          >
            {kits.map((k) => (
              <option key={k.id} value={k.id} className="bg-panel2">
                {k.name}{k.user ? " ★" : ""}
              </option>
            ))}
          </select>
          <span className="pointer-events-none absolute right-1 text-[7px] text-faint">▼</span>
        </span>
        <button
          type="button"
          onClick={saveKit}
          className="rounded-xs border border-line2 px-1.5 py-0.5 font-mono text-[9px] text-faint hover:border-accent hover:text-accent"
          title="Save the current kit (with any dropped samples) to your library"
        >
          save kit
        </button>
        {/* pattern length — the grid scrolls, so any bar count stays editable */}
        <label className="flex items-center gap-1 font-mono text-[9px] text-faint">
          <select
            value={patBars}
            onChange={(e) => setBars(Number(e.target.value))}
            aria-label="pattern length (bars)"
            className="cursor-pointer appearance-none rounded-xs border border-line2 bg-panel2 px-1.5 py-0.5 font-mono text-[9px] text-daw-text hover:border-accent focus:outline-none"
          >
            {barOpts.map((b) => (
              <option key={b} value={b} className="bg-panel2">{b}</option>
            ))}
          </select>
          bars
        </label>
        <SwingKnob trackId={trackId} clipId={clipId} value={swing} />
        <span className="ml-auto flex items-center gap-0.75 rounded-[3px] border border-line p-0.5">
          {tab("seq", "sequence")}
          {tab("roll", "piano roll")}
        </span>
      </div>
      {view === "seq" ? (
        <DrumClipGrid
          key={clipId + "-seq:" + stamp}
          pattern={gridPat}
          notes={notes}
          startBeat={startBeat}
          kitId={pat.kitId || kit.id}
          selectedLaneId={laneId}
          onSelectLane={setLaneId}
          onCommit={commitGrid}
        />
      ) : (
        <PianoRoll
          key={clipId + "-roll:" + stamp + ":" + pat.steps}
          height={220}
          trackId={trackId}
          initialClip={notes ?? patternToNotes(pat, kit)}
          pitchLabel={(p) => pitchLaneName(kit, p)}
          onCommit={commitRoll}
        />
      )}
      <DrumLaneEditor
        kitId={pat.kitId || kit.id}
        laneId={laneId}
        onLaneId={setLaneId}
        onKitId={(id) =>
          engine.setClipContent(trackId, clipId, {
            kind: "drum",
            pattern: { ...pat, kitId: id },
            notes,
          })
        }
      />
    </div>
  );
}

export function ClipEditor({ trackId, clipId }: { trackId: string; clipId: string }) {
  useEngine(["arrange"]);
  const clip = engine.getArrClip(trackId, clipId);
  // undo/redo bumps undoStamp → the roll/grid remount and reload the RESTORED content
  // (they edit a working copy, so without this they'd re-commit stale notes).
  // recordStamp remounts after a MIDI take so newly captured notes appear.
  const stamp = engine.undoStamp + ":" + engine.recordStamp;
  if (!clip) return null;

  if (clip.content.kind === "midi") {
    const midi = clip.content; // narrow
    return (
      <div className="flex flex-col gap-2 rounded-sm border border-line bg-[#0e0e12] p-2.5">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] tracking-[0.08em] text-faint">CLIP · {clip.name || "midi"}</span>
          <SwingKnob trackId={trackId} clipId={clipId} value={clip.swing} />
        </div>
        <PianoRoll
          key={clipId + ":" + stamp}
          height={220}
          trackId={trackId}
          initialClip={midi.clip}
          onCommit={(nc) => engine.setClipContent(trackId, clipId, { kind: "midi", clip: nc })}
        />
      </div>
    );
  }

  if (clip.content.kind === "drum") {
    return <DrumClipView trackId={trackId} clipId={clipId} pat={clip.content.pattern} notes={clip.content.notes} startBeat={clip.startBeat} swing={clip.swing} stamp={stamp} />;
  }

  // audio: import a file, trim it, set its level
  const audio = clip.content; // narrow (kind === "audio")
  return (
    <div className="flex flex-col gap-2 rounded-sm border border-line bg-[#0e0e12] p-2.5">
      <span className="font-mono text-[10px] tracking-[0.08em] text-faint">CLIP · {clip.name || "audio"}</span>
      <AudioClipEditor content={audio} looping={engine.audioClipLoops(clip)} onCommit={(c) => engine.setClipContent(trackId, clipId, c)} />
    </div>
  );
}
