// ── shared synth-editor constants (no components → HMR-friendly) ─────────────
import type { SynthPatch, Wave } from "../../data/patches";

export const WAVES: Wave[] = ["sine", "triangle", "sawtooth", "square"];
export const WAVE_GLYPH: Record<Wave, string> = { sine: "∿", triangle: "△", sawtooth: "◺", square: "⊓" };
export const fmtSec = (v: number) => (v >= 1 ? v.toFixed(1) + "s" : Math.round(v * 1000) + "ms");
// LFO depth units differ by destination: cents (pitch), Hz (cutoff), gain×100 (amp)
export const lfoDepthMax = (dest: SynthPatch["lfo"]["dest"]) => (dest === "cutoff" ? 6000 : dest === "amp" ? 1 : 1200);

// typing-keyboard letter → MIDI (Ableton row); the on-screen keyboard + the
// Instrument panel's computer-keyboard handler share this.
export const PL_KEYMAP: Record<string, number> = {
  a: 48, w: 49, s: 50, e: 51, d: 52, f: 53, t: 54, g: 55, y: 56, h: 57, u: 58, j: 59, k: 60, o: 61, l: 62, p: 63, ";": 64,
};
