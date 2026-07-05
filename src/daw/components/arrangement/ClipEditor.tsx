// ── CLIP EDITOR — the bottom pane for the selected arrangement clip ──────────
// MIDI clip → the PianoRoll bound to the clip's NoteClip (edits write back to the
// arrangement via engine.setClipContent). Drum/audio editors land in Phase 3.
// Keyed by clipId in the parent so switching clips remounts with fresh content.

import { useState } from "react";
import { engine } from "../../engine";
import { useEngine } from "../../hooks/useEngine";
import { PianoRoll } from "../piano-roll/PianoRoll";
import { DrumClipGrid } from "./DrumClipGrid";
import { AudioClipEditor } from "./AudioClipEditor";
import { KITS } from "../../data/kits";
import type { SequenceClip } from "../../data/kits";
import { patternToNotes, notesToPattern, pitchLaneName } from "../../data/drum-midi";

// a drum clip, editable as a step SEQUENCE or a kit-labeled PIANO ROLL. Both edit the
// same pattern: the roll converts pattern↔notes (on-grid; off-grid quantises back).
function DrumClipView({ trackId, clipId, pat, startBeat }: { trackId: string; clipId: string; pat: SequenceClip; startBeat: number }) {
  const [view, setView] = useState<"seq" | "roll">("seq");
  const kit = KITS.find((k) => k.id === pat.kitId) || engine.kit;
  const commit = (p: SequenceClip) => engine.setClipContent(trackId, clipId, { kind: "drum", pattern: p });
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
        <span className="ml-auto flex items-center gap-[3px] rounded-[3px] border border-line p-[2px]">
          {tab("seq", "sequence")}
          {tab("roll", "piano roll")}
        </span>
      </div>
      {view === "seq" ? (
        <DrumClipGrid key={clipId + "-seq"} pattern={pat} startBeat={startBeat} onCommit={commit} />
      ) : (
        <PianoRoll
          key={clipId + "-roll"}
          height={220}
          trackId={trackId}
          initialClip={patternToNotes(pat, kit)}
          pitchLabel={(p) => pitchLaneName(kit, p)}
          onCommit={(nc) => commit(notesToPattern(nc, kit, pat.steps))}
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
        <span className="font-mono text-[10px] tracking-[0.08em] text-faint">CLIP · {clip.name || "midi"}</span>
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
    return <DrumClipView trackId={trackId} clipId={clipId} pat={clip.content.pattern} startBeat={clip.startBeat} />;
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
