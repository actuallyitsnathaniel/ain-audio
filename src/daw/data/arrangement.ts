// ── Linear arrangement model ──────────────────────────────────────────────
// The Arrangement view is a LINEAR timeline (unlike the loop-based sequencer): a
// clip is an existing content unit (a NoteClip / drum pattern / audio loop) placed
// at a bar position with a length. Tracks stack vertically; clips play once as the
// playhead passes (or repeat if `clip.loop`), with an optional global loop brace.
// The engine schedules from this; the whole doc auto-saves to localStorage.

import type { AutoLane, NoteClip } from "./clips";
import type { SequenceClip } from "./kits";
import type { FxDeviceState } from "../fx-chain";

// A clip wraps ONE content unit + a timeline position + a length.
export type ClipContent =
  | { kind: "midi"; clip: NoteClip } // edited in the PianoRoll
  // drum: a step pattern (kitId + steps) editable in the grid. `notes`, when present, is
  // the LOSSLESS source of truth (edited in the kit-labeled piano roll) — it can hold
  // off-grid timing, variable lengths, per-note velocity, multi-hits the grid can't show;
  // the grid then flags those steps. Absent `notes` ⇒ the step pattern is authoritative.
  | { kind: "drum"; pattern: SequenceClip; notes?: NoteClip }
  // audio: an imported file (bufId → session buffer store) OR a LoopLane ref (loopId).
  // Full sample-source feature set (union of the synth sampler + beat-maker loop lane):
  //   a/b        — played-region trim (0..1 of the buffer)
  //   gain       — per-clip level (0..~2, linear)
  //   semi/cents — independent varispeed transpose (speed-coupled), default 0
  //   sync       — grid-tempo match: playbackRate = arrangement.bpm / rootBpm (like LoopLanes)
  //   (looping is AUTOMATIC — Ableton rule: a clip longer than its content re-hashes the
  //    loopA/loopB sub-region to fill; shorter cuts. No toggle.)
  //   loopA/loopB — loop region inside [a,b] (default = a/b); xfade + snap = click-free seam
  //   rootBpm/bars/key — detected from the filename (parseLoopMeta); rootBpm drives sync
  //   reverse    — play the buffer backwards
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
      loopA?: number;
      loopB?: number;
      xfade?: number; // loop-seam crossfade, seconds
      snap?: boolean; // snap loop points to zero-crossings (default on)
      rootBpm?: number; // native tempo (detected from filename); drives grid-sync
      bars?: number; // detected bar count
      key?: string; // detected musical key (display)
      reverse?: boolean; // play backwards
      loop?: boolean; // auto-loop to fill a clip longer than the content (absent = ON); off = play once, silence after
      warp?: boolean; // LEGACY (pre-dropdown): warp on = "complex" — read via warpModeOf, never written anymore
      warpMode?: WarpMode; // the warp algorithm dropdown: repitch (tape varispeed) · beats (transient slicer) · complex (stretch node); absent = off
      norm?: boolean; // auto-normalize: scanned peak → makeup gain to ≈ −1 dBFS (set true on import)
    };

export interface ArrClip {
  id: string;
  startBeat: number; // placement on the timeline (beats from song start)
  lengthBeats: number; // playback length; content loops to fill if `loop`, else plays once
  loop: boolean; // repeat the content within lengthBeats?
  content: ClipContent;
  name?: string;
  color?: string; // optional per-clip tint (defaults by track/kind)
  swing?: number; // per-clip swing %, 0.5 (straight ≡ absent) … 0.75 (hard); applied at schedule time
  muted?: boolean; // deactivated (Ableton "0"): stays on the timeline, drawn dim, never scheduled
}

// ── warp modes (the per-clip dropdown, Ableton-style) ──
// off      — natural rate; time-true length across tempo changes
// repitch  — tape varispeed to the grid (bpm/rootBpm): pitch moves with tempo
// beats    — transient slicer: 1/16 slices play at NATURAL rate on the re-spaced grid
//            (punch preserved; gated gaps when slower, crossfaded overlaps when faster)
// complex  — signalsmith-stretch: pitch-locked tempo-fit + duration-preserving transpose
export type WarpMode = "off" | "repitch" | "beats" | "complex";
// resolves the mode incl. LEGACY clips saved before the dropdown (sync → repitch, warp → complex)
export function warpModeOf(cc: { warpMode?: WarpMode; warp?: boolean; sync?: boolean }): WarpMode {
  return cc.warpMode ?? (cc.warp ? "complex" : cc.sync ? "repitch" : "off");
}

// ── per-clip swing (MPC/Ableton-style, optional) ──
// swing s ∈ (0.5, 0.75]: the 2nd 16th of every 8th-note pair lands s of the way through
// the pair (0.5 = straight, 2/3 ≈ triplet feel, 0.75 = hard). Positions warp piecewise-
// linearly within each pair, so off-grid hits shift proportionally and pair boundaries
// stay fixed — clip/loop lengths never change, and stored notes stay straight (lossless).
// Returns the DELAY in beats for a clip-relative beat.
export function swingDelay(beat: number, swing?: number): number {
  const s = swing ?? 0.5;
  if (s <= 0.5) return 0;
  const local = ((beat % 0.5) + 0.5) % 0.5;
  const apex = Math.min(0.75, s) * 0.5; // swung position of the odd 16th within the pair
  const warped = local <= 0.25 ? local * (apex / 0.25) : apex + (local - 0.25) * ((0.5 - apex) / 0.25);
  return warped - local;
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
  devices?: FxDeviceState[]; // per-track FX chain (modular device list; absent = no FX)
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
