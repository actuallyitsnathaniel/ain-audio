// ── MIDI note clips ───────────────────────────────────────────────────────
// A clip is a bar-length phrase of notes in MUSICAL time (beats), tempo-agnostic
// until played. The engine's lookahead scheduler walks a clip and schedules
// startVoiceAt/releaseVoice at sample-accurate context times. The piano-roll
// editor reads/writes the same Note[] shape.
//
// Timing is in beats (float). 1 beat = 1 quarter note. Convert to seconds with
// `beat * 60 / bpm`. A 1/16 step = 0.25 beat; snapping is computed at edit time.

export interface Note {
  id: string; // stable id for edit/drag/delete
  pitch: number; // MIDI note number
  start: number; // beats from clip start
  length: number; // beats
  vel: number; // 0–1
  // portamento (FL-style): a `slide` note does NOT articulate its own voice — it
  // bends the PREVIOUS note's still-ringing voice up/down to its own pitch over its
  // length. Chords (un-slide notes) ring independently. A slide note with no note
  // to bend falls back to articulating normally.
  slide?: boolean;
}

// A clip-global automation lane: a free-draw curve over the timeline that modulates
// a target. Points are sorted by beat; the curve between them is piecewise-linear.
// `value` is normalized 0..1 — each target maps it to real units (vibrato → cents).
// `target` is a union so more destinations (cutoff, pan…) can be added later.
export interface AutoPoint {
  beat: number; // beats from clip start
  value: number; // 0..1
}
export type AutoTarget = "vibrato" | "vol" | "pan"; // vibrato = per-clip; vol/pan = per-track
export interface AutoLane {
  target: AutoTarget;
  points: AutoPoint[];
  rate?: number; // vibrato: LFO speed in Hz (defaults to the engine's VIB_RATE)
  intensity?: number; // vibrato: depth scale, ~0..2 (1 = the curve's nominal depth)
}

export interface NoteClip {
  bars: number; // clip length in bars
  beatsPerBar: number; // 4 = 4/4
  notes: Note[];
  autos?: AutoLane[]; // clip-global automation curves (vibrato, …)
}

// A melodic MIDI channel in the beat-maker: its own instrument (preset/patch) and
// its own note clip, played on the same transport/clock as the drums. The clip
// length follows the channel; the scheduler wraps it against the active total.
export interface MidiChannel {
  id: string; // stable id (e.g. "ch1")
  name: string; // display label (user-editable)
  presetId: string; // sampled-preset id OR a JS-synth PATCHES key — drives the voice
  clip: NoteClip; // this channel's notes (same shape the piano roll edits)
  mute: boolean;
  solo: boolean;
  loop: boolean; // loop over THIS clip's own length, independent of the grid
  collapsed?: boolean; // fold the piano roll, keep the header controls
  vol?: number; // 0..1 channel level (default 0.8)
  pan?: number; // -1..1 stereo pan (default 0)
}

// total clip length in beats
export const clipBeats = (clip: NoteClip) => clip.bars * clip.beatsPerBar;

// vibrato depth (cents) at full automation value
export const VIB_MAX_CENTS = 120;

// sample an automation curve at `beat` (piecewise-linear, clamped to the ends).
// Empty lane → 0. Points are assumed sorted by beat (the editor keeps them sorted).
export function sampleAuto(points: AutoPoint[], beat: number): number {
  const n = points.length;
  if (n === 0) return 0;
  if (beat <= points[0].beat) return points[0].value;
  if (beat >= points[n - 1].beat) return points[n - 1].value;
  for (let i = 1; i < n; i++) {
    const b = points[i];
    if (beat <= b.beat) {
      const a = points[i - 1];
      const span = b.beat - a.beat;
      const f = span <= 0 ? 0 : (beat - a.beat) / span;
      return a.value + (b.value - a.value) * f;
    }
  }
  return points[n - 1].value;
}

// monotonic-ish id for new notes drawn in the editor
let _nid = 0;
export const newNoteId = () => "n" + (_nid++).toString(36) + Date.now().toString(36);

// deep-ish copy so edits never mutate a preset's shipped defaultPhrase
export const cloneClip = (clip: NoteClip): NoteClip => ({
  bars: clip.bars,
  beatsPerBar: clip.beatsPerBar,
  notes: clip.notes.map((n) => ({ ...n })),
  autos: clip.autos?.map((a) => ({ target: a.target, points: a.points.map((p) => ({ ...p })), rate: a.rate, intensity: a.intensity })),
});

// ── default-phrase authoring helper ───────────────────────────────────────
// Build a clip from compact tuples [pitch, startBeat, lengthBeat, vel?] so the
// shipped demo phrases read clearly in presets.ts.
export function phrase(
  bars: number,
  notes: [pitch: number, start: number, length: number, vel?: number][],
  beatsPerBar = 4,
): NoteClip {
  return {
    bars,
    beatsPerBar,
    notes: notes.map(([pitch, start, length, vel]) => ({
      id: newNoteId(),
      pitch,
      start,
      length,
      vel: vel == null ? 0.85 : vel,
    })),
  };
}
