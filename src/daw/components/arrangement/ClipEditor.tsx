// ── CLIP EDITOR — the bottom pane for the selected arrangement clip ──────────
// MIDI clip → the PianoRoll bound to the clip's NoteClip (edits write back to the
// arrangement via engine.setClipContent). Drum/audio editors land in Phase 3.
// Keyed by clipId in the parent so switching clips remounts with fresh content.

import { engine } from "../../engine";
import { useEngine } from "../../hooks/useEngine";
import { PianoRoll } from "../piano-roll/PianoRoll";

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

  // Phase 3: drum (StepGrid) + audio (LoopWave A/B) editors
  return (
    <div className="rounded-[4px] border border-line bg-[#0e0e12] p-[12px] font-mono text-[10px] text-faint">
      {clip.content.kind} clip editor coming next — for now, MIDI clips are editable.
    </div>
  );
}
