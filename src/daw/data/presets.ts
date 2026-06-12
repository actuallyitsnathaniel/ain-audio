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
  // Phase 2 adds: defaultPhrase, bpmHint
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
}

const PRESET_OVERRIDES: Record<string, PresetOverride> = {
  // keep the original demo patches sounding identical until real files land:
  "glass-pad": { name: "glass pad", env: { a: 0.16, d: 0.4, s: 0.7, r: 0.9 }, gain: 0.13, fallbackPatch: "glass pad" },
  "neon-pluck": { name: "neon pluck", env: { a: 0.004, d: 0.28, s: 0.0, r: 0.28 }, gain: 0.16, fallbackPatch: "neon pluck" },
  "sub-bass": { name: "sub bass", env: { a: 0.006, d: 0.12, s: 0.9, r: 0.16 }, gain: 0.24, fallbackPatch: "sub bass" },
};

// Presets to show even when no audio file exists yet (so the JS-synth fallback
// has something to attach to). These ids must have a fallbackPatch override.
const FALLBACK_ONLY_IDS = ["glass-pad", "neon-pluck", "sub-bass"];

// ── note-name → MIDI ──────────────────────────────────────────────────────
const NOTE_SEMITONE: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

// Parse "C4", "F#3", "Gb2", "A#-1" → MIDI number (C4 = 60). Returns null if the
// filename isn't a note name. Octave convention: C4 = middle C = MIDI 60.
function noteToMidi(name: string): number | null {
  const m = /^([a-gA-G])([#b]?)(-?\d+)$/.exec(name.trim());
  if (!m) return null;
  const base = NOTE_SEMITONE[m[1].toLowerCase()];
  if (base == null) return null;
  const accidental = m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0;
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

const AUDIO_EXT_RE = /\.(m4a|flac|ogg)$/i;

function buildPresets(): SampledPreset[] {
  // group resolved files by their immediate folder id
  const byFolder: Record<string, { note: string; url: string }[]> = {};
  for (const path in FILES) {
    const parts = path.split("/");
    const file = parts[parts.length - 1];
    const folder = parts[parts.length - 2];
    const note = file.replace(AUDIO_EXT_RE, "");
    if (noteToMidi(note) == null) continue; // skip files that aren't note names
    (byFolder[folder] = byFolder[folder] || []).push({ note, url: FILES[path] });
  }

  // union of discovered folders + fallback-only ids, in a stable order
  const ids = [...new Set([...FALLBACK_ONLY_IDS, ...Object.keys(byFolder)])];

  return ids.map((id) => {
    const ov = PRESET_OVERRIDES[id] || {};
    const zones: SampleZone[] = (byFolder[id] || [])
      .map(({ note, url }) => {
        const range = ov.zoneRanges?.[note];
        return { url, rootMidi: noteToMidi(note)!, loMidi: range?.loMidi, hiMidi: range?.hiMidi };
      })
      .sort((a, b) => a.rootMidi - b.rootMidi);
    return {
      id,
      name: ov.name || prettify(id),
      zones,
      env: { ...DEFAULT_ENV, ...ov.env },
      gain: ov.gain ?? DEFAULT_GAIN,
      fallbackPatch: ov.fallbackPatch,
    };
  });
}

export const PRESETS: SampledPreset[] = buildPresets();
