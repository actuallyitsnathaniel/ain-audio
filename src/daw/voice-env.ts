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
 * Prefer `scheduleAmpOneShot` for drum/sample hits (duration-based A/D + R).
 */
export function scheduleAmpRelease(
  g: AudioParam,
  releaseAt: number,
  env: Adsr,
  fromLevel: number,
): void {
  const r = Math.max(0.015, env.r);
  g.setValueAtTime(Math.max(0.0001, fromLevel), releaseAt);
  g.linearRampToValueAtTime(0.0001, releaseAt + r);
}

/**
 * One-shot amp ADSR (drums / sample lanes): A→peak, D→sustain over real
 * durations (not setTargetAtTime), hold until `releaseAt`, then R→silence.
 * Returns the time the envelope finishes. With S≈0 the hit ends after A+D.
 */
export function scheduleAmpOneShot(
  g: AudioParam,
  t: number,
  env: Adsr,
  peak: number,
  releaseAt: number,
): number {
  const a = Math.max(0.001, env.a);
  const d = Math.max(0.005, env.d);
  const r = Math.max(0.015, env.r);
  const sus = Math.max(0.0001, peak * Math.max(0, env.s));
  const decayEnd = t + a + d;
  const rel = Math.max(decayEnd, releaseAt);
  g.setValueAtTime(0, t);
  g.linearRampToValueAtTime(peak, t + a);
  g.linearRampToValueAtTime(sus, decayEnd);
  g.setValueAtTime(sus, rel);
  g.linearRampToValueAtTime(0.0001, rel + r);
  return rel + r;
}

/** Filter cutoff ADSR for sustained voices (note-off schedules release separately). */
export function scheduleFiltEnv(
  freq: AudioParam,
  t: number,
  cutBase: number,
  env: FiltAdsr,
): void {
  const cutPeak = Math.max(20, Math.min(18000, cutBase + env.amt));
  const cutSus = Math.max(20, Math.min(18000, cutBase + env.amt * env.s));
  const a = Math.max(0.005, env.a);
  const d = Math.max(0.005, env.d);
  // Duration-based A/D (not setTargetAtTime) so the D knob matches EnvGraph seconds.
  freq.setValueAtTime(cutBase, t);
  freq.linearRampToValueAtTime(cutPeak, t + a);
  freq.linearRampToValueAtTime(cutSus, t + a + d);
}

/**
 * One-shot filter ADSR (drums): A→peak, D→sustain over real durations, hold until
 * `releaseAt`, then R→cutBase. Returns the time the envelope finishes.
 */
export function scheduleFiltEnvOneShot(
  freq: AudioParam,
  t: number,
  cutBase: number,
  env: FiltAdsr,
  releaseAt: number,
): number {
  const cutPeak = Math.max(20, Math.min(18000, cutBase + env.amt));
  const cutSus = Math.max(20, Math.min(18000, cutBase + env.amt * env.s));
  const a = Math.max(0.001, env.a);
  const d = Math.max(0.005, env.d);
  const r = Math.max(0.005, env.r);
  const decayEnd = t + a + d;
  const rel = Math.max(decayEnd, releaseAt);
  freq.setValueAtTime(cutBase, t);
  freq.linearRampToValueAtTime(cutPeak, t + a);
  freq.linearRampToValueAtTime(cutSus, decayEnd);
  freq.setValueAtTime(cutSus, rel);
  freq.linearRampToValueAtTime(cutBase, rel + r);
  return rel + r;
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

// ── Drum synth tone (head / body / tail partials) ───────────────────────────
// Phase 0 exposed body + head(noise). Phase 0.5 adds body/tail filt envs + a
// silent-by-default tail partial. Defaults still match the old synthDrum recipes.

export type DrumBodyWave = "sine" | "triangle" | "square";
export type DrumFiltMode = "off" | "lowpass" | "highpass" | "bandpass";
export type DrumTailSource = "noise" | "sine";

/** Mirrors kits.DrumSynth — kept local to avoid a voice-env ↔ kits cycle. */
export type DrumToneKind = "kick" | "snare" | "hat" | "clap" | "tom" | "rim";

/** Per-partial filter: static cut + optional bipolar Hz envelope. */
export interface DrumPartialFilt {
  mode: DrumFiltMode;
  cut: number;
  q: number;
  env: FiltAdsr;
}

export interface DrumTone {
  /** Body osc start pitch (Hz). */
  startHz: number;
  /** Body osc end pitch after sweep (Hz). Equal to startHz = no sweep. */
  endHz: number;
  /** Pitch sweep duration (s). */
  sweep: number;
  /** Body amp decay (s). */
  bodyDecay: number;
  /** Body level 0..1 (pre-velocity). 0 = silence body. */
  bodyLevel: number;
  bodyWave: DrumBodyWave;
  /** Body partial filter + freq envelope. */
  bodyFilt: DrumPartialFilt;

  /** Noise / click level 0..1. 0 = silence head. */
  noiseLevel: number;
  /** Noise amp decay (s). */
  noiseDecay: number;
  /** Noise highpass (Hz) when noiseBp is 0. */
  noiseHp: number;
  /** Noise bandpass center (Hz). 0 = highpass path. */
  noiseBp: number;
  /** Bandpass Q when noiseBp > 0. */
  noiseQ: number;
  /** Clap-style burst count (1 = single hit). */
  bursts: number;
  /** Gap between bursts (s). */
  burstGap: number;
  /**
   * Envelope on the head filter frequency (HP cutoff or BP center).
   * amt in Hz (bipolar). Defaults amt=0.
   */
  noiseFiltEnv: FiltAdsr;

  /** Tail partial — length / air / soft bloom. Default level 0 (off). */
  tailLevel: number;
  tailDecay: number;
  tailSource: DrumTailSource;
  /** Tail sine pitch (when source = sine). */
  tailHz: number;
  /** Tail noise HP (when source = noise and tailBp = 0). */
  tailHp: number;
  /** Tail noise/sine BP center; 0 = HP (noise) or no BP on sine. */
  tailBp: number;
  tailQ: number;
  /** Tail partial filter + freq envelope (applied after source). */
  tailFilt: DrumPartialFilt;
}

export const FLAT_FILT_ENV: FiltAdsr = {
  a: 0.002,
  d: 0.08,
  s: 0,
  r: 0.05,
  amt: 0,
};

export function flatPartialFilt(
  mode: DrumFiltMode = "off",
  cut = 18000,
): DrumPartialFilt {
  return { mode, cut, q: 0.7, env: { ...FLAT_FILT_ENV } };
}

function baseTone(
  kind: DrumToneKind,
  body: Pick<
    DrumTone,
    "startHz" | "endHz" | "sweep" | "bodyDecay" | "bodyLevel" | "bodyWave"
  >,
  head: Pick<
    DrumTone,
    | "noiseLevel"
    | "noiseDecay"
    | "noiseHp"
    | "noiseBp"
    | "noiseQ"
    | "bursts"
    | "burstGap"
  >,
): DrumTone {
  return {
    ...body,
    bodyFilt: flatPartialFilt("off", 18000),
    ...head,
    noiseFiltEnv: { ...FLAT_FILT_ENV },
    // tail silent — clap’s long burst stays on head for recipe parity
    tailLevel: 0,
    tailDecay: kind === "clap" ? 0.22 : 0.15,
    tailSource: "noise",
    tailHz: 80,
    tailHp: 2000,
    tailBp: 0,
    tailQ: 0.7,
    tailFilt: flatPartialFilt("off", 8000),
  };
}

/** Recipe defaults — same numbers as the old synthDrum switch. */
export function defaultDrumTone(kind: DrumToneKind): DrumTone {
  switch (kind) {
    case "kick":
      return baseTone(
        kind,
        {
          startHz: 150,
          endHz: 45,
          sweep: 0.12,
          bodyDecay: 0.32,
          bodyLevel: 0.9,
          bodyWave: "sine",
        },
        {
          noiseLevel: 0,
          noiseDecay: 0.05,
          noiseHp: 5000,
          noiseBp: 0,
          noiseQ: 0.7,
          bursts: 1,
          burstGap: 0.012,
        },
      );
    case "tom":
      return baseTone(
        kind,
        {
          startHz: 220,
          endHz: 90,
          sweep: 0.18,
          bodyDecay: 0.3,
          bodyLevel: 0.7,
          bodyWave: "sine",
        },
        {
          noiseLevel: 0,
          noiseDecay: 0.05,
          noiseHp: 5000,
          noiseBp: 0,
          noiseQ: 0.7,
          bursts: 1,
          burstGap: 0.012,
        },
      );
    case "rim":
      return baseTone(
        kind,
        {
          startHz: 1700,
          endHz: 1700,
          sweep: 0,
          bodyDecay: 0.04,
          bodyLevel: 0.35,
          bodyWave: "square",
        },
        {
          noiseLevel: 0,
          noiseDecay: 0.04,
          noiseHp: 5000,
          noiseBp: 0,
          noiseQ: 0.7,
          bursts: 1,
          burstGap: 0.012,
        },
      );
    case "hat":
      return baseTone(
        kind,
        {
          startHz: 200,
          endHz: 200,
          sweep: 0,
          bodyDecay: 0.05,
          bodyLevel: 0,
          bodyWave: "sine",
        },
        {
          noiseLevel: 0.4,
          noiseDecay: 0.05,
          noiseHp: 7000,
          noiseBp: 0,
          noiseQ: 0.7,
          bursts: 1,
          burstGap: 0.012,
        },
      );
    case "snare":
      return baseTone(
        kind,
        {
          startHz: 180,
          endHz: 180,
          sweep: 0,
          bodyDecay: 0.12,
          bodyLevel: 0.3,
          bodyWave: "triangle",
        },
        {
          noiseLevel: 0.55,
          noiseDecay: 0.2,
          noiseHp: 1400,
          noiseBp: 0,
          noiseQ: 0.7,
          bursts: 1,
          burstGap: 0.012,
        },
      );
    case "clap":
      return baseTone(
        kind,
        {
          startHz: 200,
          endHz: 200,
          sweep: 0,
          bodyDecay: 0.05,
          bodyLevel: 0,
          bodyWave: "sine",
        },
        {
          noiseLevel: 0.5,
          noiseDecay: 0.18,
          noiseHp: 800,
          noiseBp: 1200,
          noiseQ: 0.7,
          bursts: 3,
          burstGap: 0.012,
        },
      );
  }
}

export function resolveDrumTone(
  kind: DrumToneKind,
  partial?: Partial<DrumTone> | null,
): DrumTone {
  const base = defaultDrumTone(kind);
  if (!partial) return base;
  return {
    ...base,
    ...partial,
    bodyFilt: {
      ...base.bodyFilt,
      ...(partial.bodyFilt ?? {}),
      env: {
        ...base.bodyFilt.env,
        ...(partial.bodyFilt?.env ?? {}),
      },
    },
    noiseFiltEnv: {
      ...base.noiseFiltEnv,
      ...(partial.noiseFiltEnv ?? {}),
    },
    tailFilt: {
      ...base.tailFilt,
      ...(partial.tailFilt ?? {}),
      env: {
        ...base.tailFilt.env,
        ...(partial.tailFilt?.env ?? {}),
      },
    },
  };
}

/** True when a partial filter node should be inserted. */
export function partialFiltActive(f: DrumPartialFilt): boolean {
  return f.mode !== "off" || Math.abs(f.env.amt) > 1;
}
