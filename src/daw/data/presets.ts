// ── Sampled preset registry (auto-discovered) ────────────────────────────
// Preset one-shots live in src/assets/presets/<folder>/<note>.m4a and are
// discovered at BUILD TIME via Vite's import.meta.glob — there is no runtime
// directory listing and no hand-maintained manifest. Drop a folder of bounced
// notes in and it appears in the UI on the next dev reload / build.
//
//   src/assets/presets/
//     glass-pad/      ← folder name → preset id, prettified → display label
//       C4.m4a        ← filename = the MIDI note the sample was bounced at
//     sub-bass/
//       C2.m4a        ← multiple files in one folder become multisample zones
//       C3.m4a
//
// The engine plays a zone's buffer pitch-shifted by `playbackRate` from its
// `rootMidi`, wrapped in an amp ADSR, routed into `n.sum` so it shares the FX
// rack. Per-preset settings (display name, envelope, gain) default by
// convention and can be overridden per folder id in PRESET_OVERRIDES below.

import { phrase, type NoteClip } from "./clips";

export interface SampleZone {
  url: string;
  rootMidi: number; // MIDI note the sample was bounced at (e.g. 60 = C4)
  loMidi?: number; // inclusive low edge of this zone's range
  hiMidi?: number; // inclusive high edge of this zone's range
}

export interface AmpEnv {
  a: number; // attack (s)
  d: number; // decay (s)
  s: number; // sustain (0–1)
  r: number; // release (s)
}

export interface SampledPreset {
  id: string; // folder name under src/assets/presets/
  name: string; // display label (prettified folder name, or override)
  zones: SampleZone[]; // 1..n; engine picks the containing/nearest zone per note
  env: AmpEnv;
  gain: number; // output trim
  fallbackPatch?: string; // PATCHES key used when no zone decodes
  defaultPhrase: NoteClip; // demo phrase shown/played in the piano roll (fallback)
  phraseUrl?: string; // a bundled .mid to fetch+parse as the phrase (overrides defaultPhrase)
  bpmHint?: number; // suggested tempo for the phrase
  humanize: number; // ± random detune (cents) per note, restoring "alive" feel. 0 = off
}

// Default amp envelope + gain for any preset that has no override entry.
const DEFAULT_ENV: AmpEnv = { a: 0.01, d: 0.3, s: 0.85, r: 0.4 };
const DEFAULT_GAIN = 0.18;

// Optional per-preset overrides, keyed by folder id. Anything omitted falls
// back to the defaults above. This is where you tune envelope/gain, set a
// custom display name, or wire a JS-synth fallback for a not-yet-bounced preset.
interface PresetOverride {
  name?: string;
  env?: Partial<AmpEnv>;
  gain?: number;
  fallbackPatch?: string;
  // explicit zone ranges, keyed by note filename (without extension), when you
  // want hard multisample boundaries instead of nearest-root selection.
  zoneRanges?: Record<string, { loMidi: number; hiMidi: number }>;
  defaultPhrase?: NoteClip;
  bpmHint?: number;
  // ± random detune in cents applied per note, ONLY for presets whose patch has
  // that subtle per-voice "alive" detune a single bounce can't capture. Off (0)
  // by default — set conservatively (~3–8 cents); too much sounds out of tune.
  humanize?: number;
}

// Demo phrases — the "here's how I used it" the piano roll plays back. 1 bar of
// 4/4; beats are floats (0.25 = a 1/16). Authored with the phrase() helper.
// MIDI: 60 = C4. Editable in the roll; "reset" restores these.
const PHRASE_GLASS = phrase(2, [
  // sustained Cmaj9 → Amin pad swell across two bars
  [60, 0, 4, 0.7],
  [64, 0, 4, 0.6],
  [67, 0, 4, 0.6],
  [71, 0, 4, 0.5],
  [57, 4, 4, 0.7],
  [60, 4, 4, 0.6],
  [64, 4, 4, 0.6],
  [67, 4, 4, 0.5],
]);
const PHRASE_NEON = phrase(1, [
  // bright 1/16 arpeggio, Cmaj triad climbing
  [60, 0, 0.25, 0.9],
  [64, 0.5, 0.25, 0.8],
  [67, 1, 0.25, 0.85],
  [72, 1.5, 0.25, 0.9],
  [67, 2, 0.25, 0.8],
  [64, 2.5, 0.25, 0.75],
  [69, 3, 0.25, 0.85],
  [72, 3.5, 0.25, 0.9],
]);
const PHRASE_SUB = phrase(1, [
  // syncopated low root/fifth groove
  [36, 0, 0.75, 1],
  [36, 1, 0.5, 0.85],
  [43, 1.75, 0.25, 0.7],
  [36, 2, 0.75, 1],
  [36, 3, 0.5, 0.85],
  [41, 3.5, 0.5, 0.75],
]);

const PRESET_OVERRIDES: Record<string, PresetOverride> = {
  // keep the original demo patches sounding identical until real files land:
  "glass-pad": {
    name: "glass pad",
    env: { a: 0.16, d: 0.4, s: 0.7, r: 0.9 },
    gain: 0.13,
    fallbackPatch: "glass pad",
    defaultPhrase: PHRASE_GLASS,
    bpmHint: 96,
  },
  "neon-pluck": {
    name: "neon pluck",
    env: { a: 0.004, d: 0.28, s: 0.0, r: 0.28 },
    gain: 0.16,
    fallbackPatch: "neon pluck",
    defaultPhrase: PHRASE_NEON,
    bpmHint: 124,
  },
  "sub-bass": {
    name: "sub bass",
    env: { a: 0.006, d: 0.12, s: 0.9, r: 0.16 },
    gain: 0.24,
    fallbackPatch: "sub bass",
    defaultPhrase: PHRASE_SUB,
    bpmHint: 110,
  },
  // real bounced preset — has subtle per-voice detune, so a touch of humanize
  // restores the "alive" feel a single bounce flattens. start conservative.
  // bpmHint used because the exported .mid carries no tempo (Ableton clip-export).
  "losing-hearts-pluck": { humanize: 5, bpmHint: 143 },
};

// fallback phrase for any preset that ships no defaultPhrase override
const PHRASE_DEFAULT = phrase(1, [
  [60, 0, 1, 0.85],
  [64, 1, 1, 0.8],
  [67, 2, 1, 0.8],
  [72, 3, 1, 0.85],
]);

// Presets to show even when no audio file exists yet (so the JS-synth fallback
// has something to attach to). These ids must have a fallbackPatch override.
const FALLBACK_ONLY_IDS = ["glass-pad", "neon-pluck", "sub-bass"];

// ── note-name → MIDI ──────────────────────────────────────────────────────
const NOTE_SEMITONE: Record<string, number> = {
  c: 0,
  d: 2,
  e: 4,
  f: 5,
  g: 7,
  a: 9,
  b: 11,
};

// Parse a note-name filename → MIDI number (C4 = 60). Accepts sharps written as
// "s" (URL-safe, the recommended form: "Fs2") OR "#" ("F#2") — though "#" breaks
// Vite's glob import-analysis, so prefer "s" for filenames. Flats use "b"/"f".
// Returns null if the name isn't a note. Octave convention: C4 = middle C = 60.
function noteToMidi(name: string): number | null {
  const m = /^([a-gA-G])(#|s|S|b|f|F)?(-?\d+)$/.exec(name.trim());
  if (!m) return null;
  const base = NOTE_SEMITONE[m[1].toLowerCase()];
  if (base == null) return null;
  const acc = (m[2] || "").toLowerCase();
  const accidental =
    acc === "#" || acc === "s" ? 1 : acc === "b" || acc === "f" ? -1 : 0;
  const octave = parseInt(m[3], 10);
  return base + accidental + (octave + 1) * 12;
}

// "neon-pluck" / "neon_pluck" → "neon pluck"
function prettify(id: string): string {
  return id.replace(/[-_]+/g, " ").trim();
}

// ── build-time glob over the assets folder ────────────────────────────────
// Eager + ?url gives a map of source path → fingerprinted runtime URL. Empty
// when the folder doesn't exist yet — the fallback-only presets still show up.
// Mix formats freely per preset: m4a (256k AAC) is the safe default everywhere
// including iOS Safari; flac is lossless for pitch-sensitive sounds; ogg/opus
// is smallest where it decodes. All decode to identical PCM in the engine.
const FILES = import.meta.glob("/src/assets/presets/**/*.{m4a,flac,ogg}", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

// Default-phrase MIDI: one .mid per preset folder, auto-imported and parsed at
// load (mirrors the audio pipeline). Dropping phrase.mid in is all it takes.
const MIDI_FILES = import.meta.glob("/src/assets/presets/**/*.mid", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

const AUDIO_EXT_RE = /\.(m4a|flac|ogg)$/i;

function folderOf(path: string) {
  const parts = path.split("/");
  return parts[parts.length - 2];
}

function buildPresets(): SampledPreset[] {
  // group resolved audio files by their immediate folder id
  const byFolder: Record<string, { note: string; url: string }[]> = {};
  for (const path in FILES) {
    const file = path.split("/").pop()!;
    const note = file.replace(AUDIO_EXT_RE, "");
    if (noteToMidi(note) == null) continue; // skip files that aren't note names
    const folder = folderOf(path);
    (byFolder[folder] = byFolder[folder] || []).push({
      note,
      url: FILES[path],
    });
  }

  // one .mid per folder → phraseUrl (last one wins if several)
  const midiByFolder: Record<string, string> = {};
  for (const path in MIDI_FILES)
    midiByFolder[folderOf(path)] = MIDI_FILES[path];

  // union of discovered folders + fallback-only ids, in a stable order
  const ids = [
    ...new Set([
      ...FALLBACK_ONLY_IDS,
      ...Object.keys(byFolder),
      ...Object.keys(midiByFolder),
    ]),
  ];

  return ids.map((id) => {
    const ov = PRESET_OVERRIDES[id] || {};
    const zones: SampleZone[] = (byFolder[id] || [])
      .map(({ note, url }) => {
        const range = ov.zoneRanges?.[note];
        return {
          url,
          rootMidi: noteToMidi(note)!,
          loMidi: range?.loMidi,
          hiMidi: range?.hiMidi,
        };
      })
      .sort((a, b) => a.rootMidi - b.rootMidi);
    return {
      id,
      name: ov.name || prettify(id),
      zones,
      env: { ...DEFAULT_ENV, ...ov.env },
      gain: ov.gain ?? DEFAULT_GAIN,
      fallbackPatch: ov.fallbackPatch,
      defaultPhrase: ov.defaultPhrase || PHRASE_DEFAULT,
      phraseUrl: midiByFolder[id],
      bpmHint: ov.bpmHint,
      humanize: ov.humanize ?? 0,
    };
  });
}

export const PRESETS: SampledPreset[] = buildPresets();
