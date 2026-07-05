// ── CLIP EDITOR — the bottom pane for the selected arrangement clip ──────────
// MIDI clip → the PianoRoll bound to the clip's NoteClip (edits write back to the
// arrangement via engine.setClipContent). Drum/audio editors land in Phase 3.
// Keyed by clipId in the parent so switching clips remounts with fresh content.

import { engine } from "../../engine";
import { useEngine } from "../../hooks/useEngine";
import { PianoRoll } from "../piano-roll/PianoRoll";
import { DrumClipGrid } from "./DrumClipGrid";
import { AudioClipEditor } from "./AudioClipEditor";

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
    const pat = clip.content.pattern; // narrow
    return (
      <div className="flex flex-col gap-[8px] rounded-[4px] border border-line bg-[#0e0e12] p-[10px]">
        <span className="font-mono text-[10px] tracking-[0.08em] text-faint">CLIP · {clip.name || "drums"} · click a step · shift-click = accent</span>
        <DrumClipGrid
          key={clipId}
          pattern={pat}
          startBeat={clip.startBeat}
          onCommit={(p) => engine.setClipContent(trackId, clipId, { kind: "drum", pattern: p })}
        />
      </div>
    );
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
