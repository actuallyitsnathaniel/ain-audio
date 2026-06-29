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
  slideFrom?: number; // portamento: glide FROM this MIDI pitch into `pitch` over the note's length
  vibrato?: { rate: number; depth: number }; // rate Hz, depth cents — sinusoidal pitch wobble
}

export interface NoteClip {
  bars: number; // clip length in bars
  beatsPerBar: number; // 4 = 4/4
  notes: Note[];
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

// monotonic-ish id for new notes drawn in the editor
let _nid = 0;
export const newNoteId = () => "n" + (_nid++).toString(36) + Date.now().toString(36);

// deep-ish copy so edits never mutate a preset's shipped defaultPhrase
export const cloneClip = (clip: NoteClip): NoteClip => ({
  bars: clip.bars,
  beatsPerBar: clip.beatsPerBar,
  notes: clip.notes.map((n) => ({ ...n })),
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
