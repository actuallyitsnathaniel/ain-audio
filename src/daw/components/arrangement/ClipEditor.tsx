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
import { AudioClipEditor } from "./AudioClipEditor";
import { KITS } from "../../data/kits";
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
function DrumClipView({ trackId, clipId, pat, notes, startBeat, swing }: { trackId: string; clipId: string; pat: SequenceClip; notes?: NoteClip; startBeat: number; swing?: number }) {
  const [view, setView] = useState<"seq" | "roll">("seq");
  const kit = KITS.find((k) => k.id === pat.kitId) || engine.kit;
  // sequence-view pattern: derive from notes when they're the truth, else the raw pattern
  const gridPat = notes ? { ...pat, ...notesToPattern(notes, kit, pat.steps) } : pat;
  // grid edit → reconcile against existing notes so off-grid/held detail on untouched
  // cells survives; only the toggled cells add/remove on-grid notes.
  const commitGrid = (p: SequenceClip) => engine.setClipContent(trackId, clipId, { kind: "drum", pattern: p, notes: notes ? reconcileGridEdit(notes, p, kit) : patternToNotes(p, kit) });
  // roll edit → store the notes verbatim; keep pattern for kitId/steps
  const commitRoll = (nc: NoteClip) => engine.setClipContent(trackId, clipId, { kind: "drum", pattern: pat, notes: nc });
  const tab = (v: "seq" | "roll", label: string) => (
    <button
      onClick={() => setView(v)}
      className={"rounded-[3px] px-[9px] py-[3px] font-mono text-[9px] tracking-[0.08em] transition-colors " + (view === v ? "bg-[color-mix(in_srgb,var(--accent)_18%,transparent)] text-accent" : "text-faint hover:text-dim")}
    >
      {label}
    </button>
  );
  return (
    <div className="flex flex-col gap-[8px] rounded-[4px] border border-line bg-[#0e0e12] p-[10px]">
      <div className="flex items-center gap-[8px]">
        <span className="font-mono text-[10px] tracking-[0.08em] text-faint">DRUMS</span>
        {/* per-clip kit picker — switching kits re-voices the same pattern (lane ids match) */}
        <span className="relative inline-flex items-center">
          <select
            value={pat.kitId || engine.kit.id}
            onChange={(e) => engine.setClipContent(trackId, clipId, { kind: "drum", pattern: { ...pat, kitId: e.target.value }, notes })}
            aria-label="kit"
            className="cursor-pointer appearance-none rounded-[2px] border border-line2 bg-panel2 py-[2px] pr-[16px] pl-[6px] font-mono text-[9px] text-daw-text hover:border-accent focus:outline-none"
          >
            {KITS.map((k) => (
              <option key={k.id} value={k.id} className="bg-panel2">{k.name}</option>
            ))}
          </select>
          <span className="pointer-events-none absolute right-[4px] text-[7px] text-faint">▼</span>
        </span>
        <SwingKnob trackId={trackId} clipId={clipId} value={swing} />
        <span className="ml-auto flex items-center gap-[3px] rounded-[3px] border border-line p-[2px]">
          {tab("seq", "sequence")}
          {tab("roll", "piano roll")}
        </span>
      </div>
      {view === "seq" ? (
        <DrumClipGrid key={clipId + "-seq"} pattern={gridPat} notes={notes} startBeat={startBeat} onCommit={commitGrid} />
      ) : (
        <PianoRoll
          key={clipId + "-roll"}
          height={220}
          trackId={trackId}
          initialClip={notes ?? patternToNotes(pat, kit)}
          pitchLabel={(p) => pitchLaneName(kit, p)}
          onCommit={commitRoll}
        />
      )}
    </div>
  );
}

export function ClipEditor({ trackId, clipId }: { trackId: string; clipId: string }) {
  useEngine(["arrange"]);
  const clip = engine.getArrClip(trackId, clipId);
  if (!clip) return null;

  if (clip.content.kind === "midi") {
    const midi = clip.content; // narrow
    return (
      <div className="flex flex-col gap-[8px] rounded-[4px] border border-line bg-[#0e0e12] p-[10px]">
        <div className="flex items-center justify-between">
          <span className="font-mono text-[10px] tracking-[0.08em] text-faint">CLIP · {clip.name || "midi"}</span>
          <SwingKnob trackId={trackId} clipId={clipId} value={clip.swing} />
        </div>
        <PianoRoll
          key={clipId}
          height={220}
          trackId={trackId}
          initialClip={midi.clip}
          onCommit={(nc) => engine.setClipContent(trackId, clipId, { kind: "midi", clip: nc })}
        />
      </div>
    );
  }

  if (clip.content.kind === "drum") {
    return <DrumClipView trackId={trackId} clipId={clipId} pat={clip.content.pattern} notes={clip.content.notes} startBeat={clip.startBeat} swing={clip.swing} />;
  }

  // audio: import a file, trim it, set its level
  const audio = clip.content; // narrow (kind === "audio")
  return (
    <div className="flex flex-col gap-[8px] rounded-[4px] border border-line bg-[#0e0e12] p-[10px]">
      <span className="font-mono text-[10px] tracking-[0.08em] text-faint">CLIP · {clip.name || "audio"}</span>
      <AudioClipEditor content={audio} looping={engine.audioClipLoops(clip)} onCommit={(c) => engine.setClipContent(trackId, clipId, c)} />
    </div>
  );
}
