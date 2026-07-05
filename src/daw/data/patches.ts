// ── Subtractive synth patches ─────────────────────────────────────────────
// A designable voice: osc1 + osc2 + sub + noise → multi-mode filter → amp, with
// separate filter & amp envelopes and one routable LFO. The engine's synth voice
// path (startVoiceAt) builds this; the SynthEditor edits it live. Patch ids double
// as preset `fallbackPatch` keys, so the three built-ins keep their names.

export type Wave = "sine" | "triangle" | "sawtooth" | "square";

export interface OscSpec {
  wave: Wave;
  semi: number; // coarse pitch offset (semitones)
  cents: number; // fine detune (cents)
  level: number; // 0..1
}

// A sample source — a sampled preset's multisample used like an oscillator: it
// runs through the SAME filter + filter-env + amp-env + LFO as the oscillators.
// `presetId` points at a SampledPreset (its zones are decoded by preset id). loop
// off = one-shot; loop on = sustains via loopStart/loopEnd (0..1 of the buffer).
export interface SampleSource {
  presetId: string;
  level: number; // 0..1 (0 = silent)
  loop: boolean;
  semi?: number; // varispeed transpose — coarse (semitones), independent of the note
  cents?: number; // varispeed transpose — fine (cents)
  start?: number; // 0..1 — playback window start (offset into the buffer)
  end?: number; // 0..1 — playback window end
  loopStart?: number; // 0..1 fraction of the buffer (defaults to start)
  loopEnd?: number; //   "                            (defaults to end)
  xfade?: number; // loop-seam crossfade in seconds (0 / absent = hard loop, may click)
  snap?: boolean; // snap loop points to zero-crossings (default on) → click-free seam
}

export interface SynthPatch {
  osc1: OscSpec;
  osc2: OscSpec;
  osc2On: boolean;
  sub: { wave: "sine" | "square"; oct: -1 | -2; level: number }; // level 0 = silent
  noise: { type: "white" | "pink"; level: number }; // level 0 = silent
  sample?: SampleSource; // a sampled multisample as a voice source (level 0 / absent = off)
  filter: { type: BiquadFilterType; cut: number; q: number; keyTrack: number; on?: boolean }; // on omitted = enabled
  filtEnv: { a: number; d: number; s: number; r: number; amt: number }; // amt Hz added to cutoff
  ampEnv: { a: number; d: number; s: number; r: number };
  lfo: { rate: number; depth: number; dest: "off" | "pitch" | "cutoff" | "amp" };
  vol: number; // output trim
}

const osc = (wave: Wave, cents = 0, semi = 0, level = 1): OscSpec => ({ wave, semi, cents, level });
const OFF_SUB = { wave: "sine" as const, oct: -1 as const, level: 0 };
const OFF_NOISE = { type: "white" as const, level: 0 };
const OFF_LFO = { rate: 5, depth: 0, dest: "off" as const };

// The three originals, ported note-for-note from the old flat PATCHES so they sound
// identical: the old filter envelope reused the amp ADSR times, so filtEnv mirrors
// ampEnv here, with amt = the old `envAmt`.
export const BUILTIN_PATCHES: Record<string, SynthPatch> = {
  "glass pad": {
    osc1: osc("sawtooth", -7),
    osc2: osc("sawtooth", 7),
    osc2On: true,
    sub: OFF_SUB,
    noise: OFF_NOISE,
    filter: { type: "lowpass", cut: 900, q: 0.9, keyTrack: 0 },
    filtEnv: { a: 0.16, d: 0.4, s: 0.7, r: 0.9, amt: 900 },
    ampEnv: { a: 0.16, d: 0.4, s: 0.7, r: 0.9 },
    lfo: OFF_LFO,
    vol: 0.13,
  },
  "neon pluck": {
    osc1: osc("square", -4),
    osc2: osc("sawtooth", 4),
    osc2On: true,
    sub: OFF_SUB,
    noise: OFF_NOISE,
    filter: { type: "lowpass", cut: 500, q: 2.4, keyTrack: 0 },
    filtEnv: { a: 0.004, d: 0.28, s: 0.0, r: 0.28, amt: 2600 },
    ampEnv: { a: 0.004, d: 0.28, s: 0.0, r: 0.28 },
    lfo: OFF_LFO,
    vol: 0.16,
  },
  "sub bass": {
    osc1: osc("sine", 0, -12), // old oct:-1 → osc down an octave
    osc2: osc("triangle", 2, -12),
    osc2On: true,
    sub: OFF_SUB,
    noise: OFF_NOISE,
    filter: { type: "lowpass", cut: 420, q: 0.7, keyTrack: 0 },
    filtEnv: { a: 0.006, d: 0.12, s: 0.9, r: 0.16, amt: 160 },
    ampEnv: { a: 0.006, d: 0.12, s: 0.9, r: 0.16 },
    lfo: OFF_LFO,
    vol: 0.24,
  },
};

// Convert a sampled preset into an editable SynthPatch: the sample source is on,
// oscillators/sub/noise off, amp env + vol seeded from the preset, and a neutral
// wide-open filter (amt 0 → the sample plays clean until the user dials the filter).
// This is what lets a sampled preset be a first-class, editable instrument.
export function patchFromPreset(preset: { env: { a: number; d: number; s: number; r: number }; gain: number }, presetId: string): SynthPatch {
  return {
    osc1: osc("sawtooth", 0, 0, 0),
    osc2: osc("sawtooth", 0, 0, 0),
    osc2On: false,
    sub: OFF_SUB,
    noise: OFF_NOISE,
    sample: { presetId, level: 1, loop: false },
    filter: { type: "lowpass", cut: 18000, q: 0.7, keyTrack: 0 },
    filtEnv: { a: 0.01, d: 0.3, s: 1, r: 0.3, amt: 0 },
    ampEnv: { ...preset.env },
    lfo: { rate: 5, depth: 0, dest: "off" },
    vol: preset.gain,
  };
}

// A blank starting point for "save as new patch" / user design.
export const INIT_PATCH: SynthPatch = {
  osc1: osc("sawtooth"),
  osc2: osc("sawtooth", 6),
  osc2On: true,
  sub: { wave: "sine", oct: -1, level: 0 },
  noise: { type: "white", level: 0 },
  filter: { type: "lowpass", cut: 2200, q: 0.8, keyTrack: 0.3 },
  filtEnv: { a: 0.01, d: 0.5, s: 0.4, r: 0.4, amt: 1800 },
  ampEnv: { a: 0.01, d: 0.4, s: 0.8, r: 0.3 },
  lfo: { rate: 5, depth: 0, dest: "off" },
  vol: 0.18,
};
