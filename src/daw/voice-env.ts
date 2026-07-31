// ── Shared ADSR helpers (synth patch + drum lane sample voices) ─────────────
// Same envelope math the sample oscillator rides through in startVoiceAt —
// drum one-shots reuse these so lane amp/filter knobs match the Instrument panel.

export type Adsr = { a: number; d: number; s: number; r: number };
export type FiltAdsr = Adsr & { amt: number };

export type VoiceFilter = {
  type: BiquadFilterType;
  cut: number;
  q: number;
  on?: boolean; // omitted = on
};

/** Amp attack → peak, then decay toward sustain (release is scheduled separately). */
export function scheduleAmpAttack(
  g: AudioParam,
  t: number,
  env: Adsr,
  peak: number,
): void {
  g.setValueAtTime(0, t);
  g.linearRampToValueAtTime(peak, t + Math.max(0.005, env.a));
  g.setTargetAtTime(peak * env.s, t + env.a, Math.max(0.03, env.d));
}

/**
 * One-shot release: at `releaseAt`, hold `fromLevel` then approach silence with R.
 * Drums have no note-off — call with releaseAt ≈ end of the sample window.
 */
export function scheduleAmpRelease(
  g: AudioParam,
  releaseAt: number,
  env: Adsr,
  fromLevel: number,
): void {
  const r = Math.max(0.015, env.r);
  g.setValueAtTime(Math.max(0.0001, fromLevel), releaseAt);
  g.setTargetAtTime(0.0001, releaseAt, r / 3);
}

/** Filter cutoff ADSR mirroring startVoiceAt (keyTrack applied by caller on cutBase). */
export function scheduleFiltEnv(
  freq: AudioParam,
  t: number,
  cutBase: number,
  env: FiltAdsr,
): void {
  const cutPeak = Math.max(20, Math.min(18000, cutBase + env.amt));
  const cutSus = Math.max(20, Math.min(18000, cutBase + env.amt * env.s));
  freq.setValueAtTime(cutBase, t);
  freq.linearRampToValueAtTime(cutPeak, t + Math.max(0.005, env.a));
  freq.setTargetAtTime(cutSus, t + env.a, Math.max(0.03, env.d));
}

export const DEFAULT_DRUM_AMP: Adsr = { a: 0.002, d: 0.18, s: 0, r: 0.12 };
export const DEFAULT_DRUM_FILT: VoiceFilter = {
  type: "lowpass",
  cut: 18000,
  q: 0.7,
};
export const DEFAULT_DRUM_FILT_ENV: FiltAdsr = {
  a: 0.002,
  d: 0.15,
  s: 0,
  r: 0.1,
  amt: 0,
};
