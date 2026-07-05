// ── Linear arrangement model ──────────────────────────────────────────────
// The Arrangement view is a LINEAR timeline (unlike the loop-based sequencer): a
// clip is an existing content unit (a NoteClip / drum pattern / audio loop) placed
// at a bar position with a length. Tracks stack vertically; clips play once as the
// playhead passes (or repeat if `clip.loop`), with an optional global loop brace.
// The engine schedules from this; the whole doc auto-saves to localStorage.

import type { AutoLane, NoteClip } from "./clips";
import type { SequenceClip } from "./kits";

// A clip wraps ONE content unit + a timeline position + a length.
export type ClipContent =
  | { kind: "midi"; clip: NoteClip } // edited in the PianoRoll
  | { kind: "drum"; pattern: SequenceClip } // edited in the StepGrid
  // audio: an imported file (bufId → session buffer store) OR a LoopLane ref (loopId).
  // Full sample-source feature set (union of the synth sampler + beat-maker loop lane):
  //   a/b        — played-region trim (0..1 of the buffer)
  //   gain       — per-clip level (0..~2, linear)
  //   semi/cents — independent varispeed transpose (speed-coupled), default 0
  //   sync       — tempo-lock: playbackRate stretches so the clip length fits the tempo
  //   sampleLoop — loop the trimmed region to fill the clip length (vs one-shot)
  //   loopA/loopB — loop region inside [a,b] (default = a/b); xfade + snap = click-free seam
  | {
      kind: "audio";
      bufId?: string;
      name?: string;
      loopId?: string;
      a?: number;
      b?: number;
      gain?: number;
      semi?: number;
      cents?: number;
      sync?: boolean;
      sampleLoop?: boolean;
      loopA?: number;
      loopB?: number;
      xfade?: number; // loop-seam crossfade, seconds
      snap?: boolean; // snap loop points to zero-crossings (default on)
    };

export interface ArrClip {
  id: string;
  startBeat: number; // placement on the timeline (beats from song start)
  lengthBeats: number; // playback length; content loops to fill if `loop`, else plays once
  loop: boolean; // repeat the content within lengthBeats?
  content: ClipContent;
  name?: string;
  color?: string; // optional per-clip tint (defaults by track/kind)
}

export type TrackKind = "midi" | "drum" | "audio";

export interface ArrTrack {
  id: string;
  name: string;
  kind: TrackKind;
  presetId?: string; // instrument for midi tracks (channelVoice resolution)
  mute: boolean;
  solo: boolean;
  vol: number; // 0..1
  pan: number; // -1..1
  collapsed?: boolean;
  clips: ArrClip[];
  autos?: AutoLane[]; // per-track automation curves (vol/pan) over timeline beats
}

export interface Arrangement {
  bpm: number;
  beatsPerBar: number;
  tracks: ArrTrack[];
  loop?: { start: number; end: number; on: boolean }; // global loop brace (beats)
}

// ── ids ──
let _tid = 0;
let _cid = 0;
export const newTrackId = () => "t" + (_tid++).toString(36) + Date.now().toString(36);
export const newClipId = () => "ac" + (_cid++).toString(36) + Date.now().toString(36);

// total length of an arrangement in beats = end of the last clip (min 1 bar)
export function arrangementBeats(a: Arrangement): number {
  let end = a.beatsPerBar; // at least one bar
  for (const t of a.tracks) for (const c of t.clips) end = Math.max(end, c.startBeat + c.lengthBeats);
  return end;
}

// ── persistence (one working song, auto-saved) ──
const LS = "ain-arrangement";
export function emptyArrangement(): Arrangement {
  return { bpm: 120, beatsPerBar: 4, tracks: [] };
}
export function loadArrangement(): Arrangement {
  try {
    const v = localStorage.getItem(LS);
    if (v) {
      const a = JSON.parse(v) as Arrangement;
      if (a && Array.isArray(a.tracks)) return a;
    }
  } catch {
    /* corrupt/unavailable → fresh */
  }
  return emptyArrangement();
}
export function saveArrangement(a: Arrangement) {
  try {
    localStorage.setItem(LS, JSON.stringify(a));
  } catch {
    /* storage full/unavailable — session-only is acceptable */
  }
}
