/** Shared Pro-Q–style EQ / dynamic-curve model (EQ device + SPECCOMP nodes). */

export type EqShape =
  | "bell"
  | "lowshelf"
  | "highshelf"
  | "lowcut"
  | "highcut"
  | "notch"
  | "bandpass"
  | "tilt";

/** One malleable node on the analyzer — static EQ and/or dynamic range. */
export interface EqBand {
  id: string;
  on: boolean;
  /** When any band is soloed, only soloed bands process (Pro-Q-style). */
  solo: boolean;
  shape: EqShape;
  /** Center / corner frequency (Hz). */
  freq: number;
  /** Static gain (dB). Unused for pure dynamics nodes (speccomp). */
  gain: number;
  /** Bandwidth / slope control (shape-dependent). */
  q: number;
  /** Pro-Q-style dynamic EQ enable. */
  dyn: boolean;
  /** Level (dB) where dynamics engage. */
  dynThreshold: number;
  /** Max dynamic excursion (dB). Negative → compress/cut when over; positive → expand/boost. */
  dynRange: number;
}

/** SPECCOMP curve node — dynamics-first (threshold / range on the spectrum). */
export interface SpecCurve {
  id: string;
  on: boolean;
  freq: number;
  q: number;
  /** Local threshold (dB) pulled toward by bell weight. */
  threshold: number;
  /** Max gain reduction this node may apply (dB, positive). */
  range: number;
  /** Local ratio when this node dominates. */
  ratio: number;
}

export const EQ_SHAPES: EqShape[] = [
  "bell",
  "lowshelf",
  "highshelf",
  "lowcut",
  "highcut",
  "notch",
  "bandpass",
  "tilt",
];

export const FREQ_MIN = 20;
export const FREQ_MAX = 20_000;
export const GAIN_MIN = -24;
export const GAIN_MAX = 24;
/** Analyzer vertical span for dynamics threshold (speccomp). */
export const DYN_DB_MIN = -60;
export const DYN_DB_MAX = 0;

let _bandId = 0;
export function newEqBandId(): string {
  return "b" + (_bandId++).toString(36) + Date.now().toString(36);
}

export function defaultEqBand(partial?: Partial<EqBand>): EqBand {
  return {
    id: newEqBandId(),
    on: true,
    solo: false,
    shape: "bell",
    freq: 1000,
    gain: 0,
    q: 1,
    dyn: false,
    dynThreshold: -24,
    dynRange: -6,
    ...partial,
  };
}

export function defaultSpecCurve(partial?: Partial<SpecCurve>): SpecCurve {
  return {
    id: newEqBandId(),
    on: true,
    freq: 1000,
    q: 1.2,
    threshold: -24,
    range: 12,
    ratio: 4,
    ...partial,
  };
}

export function clampFreq(hz: number): number {
  return Math.min(FREQ_MAX, Math.max(FREQ_MIN, hz));
}

export function freqToX(freq: number, width: number): number {
  const a = Math.log(FREQ_MIN);
  const b = Math.log(FREQ_MAX);
  const t = (Math.log(clampFreq(freq)) - a) / (b - a);
  return t * width;
}

export function xToFreq(x: number, width: number): number {
  const t = Math.min(1, Math.max(0, x / Math.max(1, width)));
  const a = Math.log(FREQ_MIN);
  const b = Math.log(FREQ_MAX);
  return Math.exp(a + t * (b - a));
}

export function dbToY(db: number, height: number, minDb: number, maxDb: number): number {
  const t = (db - minDb) / (maxDb - minDb);
  return height - t * height;
}

export function yToDb(y: number, height: number, minDb: number, maxDb: number): number {
  const t = 1 - y / Math.max(1, height);
  return minDb + t * (maxDb - minDb);
}

/** Approximate bell weight in octaves (0..1-ish). */
export function bellWeight(freqHz: number, centerHz: number, q: number): number {
  if (!(freqHz > 0) || !(centerHz > 0)) return 0;
  const oct = Math.log(freqHz / centerHz) / Math.LN2;
  const w = Math.max(0.15, q);
  return Math.exp(-((oct * w * 1.8) ** 2));
}

/**
 * Composite EQ magnitude (dB) at `freq` — uses the same BiquadFilterNode
 * transfer functions as the live DSP via getFrequencyResponse.
 */
let _plotCtx: OfflineAudioContext | null = null;
const _plotFilters: BiquadFilterNode[] = [];

function ensurePlotFilters(count: number): BiquadFilterNode[] {
  if (!_plotCtx) _plotCtx = new OfflineAudioContext(1, 128, 48000);
  while (_plotFilters.length < count) {
    _plotFilters.push(_plotCtx.createBiquadFilter());
  }
  return _plotFilters;
}

function shapeToPlotType(shape: EqShape): BiquadFilterType {
  switch (shape) {
    case "lowshelf":
      return "lowshelf";
    case "highshelf":
      return "highshelf";
    case "lowcut":
      return "highpass";
    case "highcut":
      return "lowpass";
    case "notch":
      return "notch";
    case "bandpass":
      return "bandpass";
    case "tilt":
      return "peaking";
    case "bell":
    default:
      return "peaking";
  }
}

/** Active bands for response / DSP (honours solo: if any solo, only solos). */
export function activeEqBands(bands: EqBand[]): EqBand[] {
  const anySolo = bands.some((b) => b.on && b.solo);
  return bands.filter((b) => b.on && (!anySolo || b.solo));
}

export function eqResponseDb(bands: EqBand[], freq: number): number {
  const active = activeEqBands(bands);
  if (!active.length) return 0;
  const filters = ensurePlotFilters(active.length);
  const freqs = new Float32Array([freq]);
  const mag = new Float32Array(1);
  const phase = new Float32Array(1);
  let lin = 1;
  for (let i = 0; i < active.length; i++) {
    const b = active[i];
    const f = filters[i];
    f.type = shapeToPlotType(b.shape);
    f.frequency.value = Math.max(20, Math.min(20000, b.freq));
    f.Q.value = Math.max(0.1, Math.min(18, b.q));
    if (b.shape === "lowcut" || b.shape === "highcut" || b.shape === "bandpass" || b.shape === "notch") {
      f.gain.value = 0;
    } else if (b.shape === "tilt") {
      // tilt ≈ peaking with broad Q — gain at shelf-ish; keep peaking gain
      f.gain.value = b.gain;
      f.Q.value = Math.max(0.1, Math.min(1, b.q * 0.35));
    } else {
      f.gain.value = b.gain;
    }
    f.getFrequencyResponse(freqs, mag, phase);
    lin *= mag[0] || 1;
  }
  return 20 * Math.log10(Math.max(1e-12, lin));
}

/** Fill a log-spaced response curve (dB) for UI drawing. */
export function eqResponseCurve(
  bands: EqBand[],
  n = 128,
): { freqs: Float32Array; db: Float32Array } {
  const freqs = new Float32Array(n);
  const db = new Float32Array(n);
  const active = activeEqBands(bands);
  for (let i = 0; i < n; i++) {
    freqs[i] = FREQ_MIN * Math.pow(FREQ_MAX / FREQ_MIN, i / Math.max(1, n - 1));
  }
  if (!active.length) return { freqs, db };

  const filters = ensurePlotFilters(active.length);
  const mag = new Float32Array(n);
  const phase = new Float32Array(n);
  const acc = new Float32Array(n);
  acc.fill(1);

  for (let i = 0; i < active.length; i++) {
    const b = active[i];
    const f = filters[i];
    f.type = shapeToPlotType(b.shape);
    f.frequency.value = Math.max(20, Math.min(20000, b.freq));
    f.Q.value = Math.max(0.1, Math.min(18, b.q));
    if (b.shape === "lowcut" || b.shape === "highcut" || b.shape === "bandpass" || b.shape === "notch") {
      f.gain.value = 0;
    } else if (b.shape === "tilt") {
      f.gain.value = b.gain;
      f.Q.value = Math.max(0.1, Math.min(1, b.q * 0.35));
    } else {
      f.gain.value = b.gain;
    }
    f.getFrequencyResponse(freqs, mag, phase);
    for (let k = 0; k < n; k++) acc[k] *= mag[k] || 1;
  }
  for (let k = 0; k < n; k++) db[k] = 20 * Math.log10(Math.max(1e-12, acc[k]));
  return { freqs, db };
}

/** SPECCOMP: effective threshold at a band center from global + user curves. */
export function specThresholdAt(
  freqHz: number,
  globalThresh: number,
  tilt: number,
  bandT: number,
  curves: SpecCurve[],
): { threshold: number; ratio: number; range: number } {
  let thr = globalThresh + tilt * bandT * 12;
  let ratio = 0;
  let range = 0;
  let wSum = 0;
  for (const c of curves) {
    if (!c.on) continue;
    const w = bellWeight(freqHz, c.freq, c.q);
    if (w < 0.02) continue;
    thr = thr + w * (c.threshold - thr);
    ratio += w * c.ratio;
    range += w * c.range;
    wSum += w;
  }
  return {
    threshold: thr,
    ratio: wSum > 0.05 ? ratio / wSum : 0,
    range: wSum > 0.05 ? range / wSum : 0,
  };
}
