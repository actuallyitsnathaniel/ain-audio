// ── FX device modules ─────────────────────────────────────────────────────────
// Each effect is a self-describing DEVICE: a factory that builds its node graph as an
// { in, out } pair, plus an `apply(params, ctx)` that sets its params (ramped, click-safe
// via setTargetAtTime). This is the reusable unit an FxChain instances per track or on the
// master bus. Behavior is ported 1:1 from the engine's old hand-wired applyFx so the
// master bus sounds identical after migration.
//
// A device is BYPASSED by neutralizing its nodes (not by removing it from the chain), so
// toggling on/off never reorders/reconnects — exactly the old rack's model.

import {
  createFxVizSlot,
  ingestFxVizMessage,
  type FxVizKind,
  type FxVizSlot,
} from "./spectral-viz";
import type { EqBand, SpecCurve } from "./eq-curve";
import { defaultEqBand } from "./eq-curve";

export type FxDeviceType =
  | "filter"
  | "comp"
  | "delay"
  | "chorus"
  | "disperser"
  | "crush"
  | "reverb"
  | "impartialer"
  | "speccomp"
  | "eq"
  | "centinel";

export type DelayFeel = "straight" | "dotted" | "triplet";
export type ImpartialerScale = "major" | "minor" | "dorian" | "chromatic";
export type CentinelScale = ImpartialerScale | "custom";
export type ImpartialerMappingMode = "off" | "snap" | "remap";
export type SpectralQuality = "low" | "high";

export const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;
export const IMPARTIALER_SCALES: ImpartialerScale[] = ["major", "minor", "dorian", "chromatic"];
/** Relative pitch classes for a custom centinel map (seeded from major). */
export const DEFAULT_CENTINEL_CUSTOM_PCS = [0, 2, 4, 5, 7, 9, 11];
export const SCALE_PCS: Record<ImpartialerScale, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};

export function centinelScalePcs(scale: CentinelScale, customPcs?: number[]): number[] {
  if (scale === "custom") {
    const pcs = (customPcs ?? []).filter((n) => n >= 0 && n <= 11);
    return pcs.length ? [...new Set(pcs)].sort((a, b) => a - b) : DEFAULT_CENTINEL_CUSTOM_PCS.slice();
  }
  return SCALE_PCS[scale] ?? SCALE_PCS.major;
}

// tempo-sync divisions for the delay device
export const DELAY_DIVS: { label: string; beats: number }[] = [
  { label: "1/16", beats: 0.25 },
  { label: "1/8", beats: 0.5 },
  { label: "1/4", beats: 1 },
  { label: "1/2", beats: 2 },
  { label: "1/1", beats: 4 },
];
export const delayDivLabels = DELAY_DIVS.map((d) => d.label);
export const DEFAULT_DELAY_DIV = 1; // 1/8
const DELAY_FEEL_MULT: Record<DelayFeel, number> = { straight: 1, dotted: 1.5, triplet: 2 / 3 };

/** STFT presets — keep in sync with worklets/impartialer-processor.js + speccomp-processor.js */
export const SPECTRAL_QUALITY: Record<SpectralQuality, { fftSize: number; hop: number }> = {
  low: { fftSize: 2048, hop: 512 },
  high: { fftSize: 4096, hop: 1024 },
};

const db2lin = (db: number) => Math.pow(10, db / 20);

// per-device param shapes (the `params` blob each device instance carries)
export interface FxParams {
  filter: { on: boolean; morph: number };
  comp: { on: boolean; threshold: number; ratio: number; attack: number; release: number; makeup: number };
  delay: { on: boolean; time: number; fb: number; mix: number; sync: boolean; div: number; feel: DelayFeel };
  chorus: { on: boolean; rate: number; depth: number; mix: number; feedback: number };
  /** Phase disperser — cascaded allpasses; flat magnitude, rotates phase around `freq`. */
  disperser: { on: boolean; freq: number; amount: number; viz: boolean };
  crush: { on: boolean; drive: number; autoGain: boolean };
  reverb: { on: boolean; decay: number; mix: number };
  impartialer: {
    on: boolean;
    key: number;
    scale: ImpartialerScale;
    mode: ImpartialerMappingMode;
    strength: number;
    transpose: number;
    maxShift: number;
    quality: SpectralQuality;
    residual: number;
    /** Toggleable spectral assistant. */
    viz: boolean;
    /** `rta` = live line spectrum (default) · `trail` = ~1s scrolling heatmap. */
    vizMode: "rta" | "trail";
  };
  speccomp: {
    on: boolean;
    threshold: number;
    ratio: number;
    attack: number;
    release: number;
    knee: number;
    makeup: number;
    mix: number;
    tilt: number;
    focus: number;
    quality: SpectralQuality;
    /** Toggleable EQ-style RTA + malleable curve editor. */
    viz: boolean;
    /** Pro-Q–style user-addable dynamic nodes on the analyzer. */
    curves: SpecCurve[];
  };
  eq: {
    on: boolean;
    viz: boolean;
    /** Stereo / Mid-only / Side-only processing. */
    stereoMode: "stereo" | "mid" | "side";
    /** Pro-Q–style parametric bands (static + optional per-band dynamics). */
    bands: EqBand[];
  };
  /** Monophonic pitch sentinel — YIN + PV; speed/flex/humanize keep (or kill) the take. */
  centinel: {
    on: boolean;
    key: number;
    scale: CentinelScale;
    /** Relative pitch classes when `scale === "custom"` (0 = key root). */
    customPcs: number[];
    /**
     * When on: held MIDI (keyboard/hardware) + sounding arrangement MIDI notes
     * become the retune targets; falls back to the scale map when none are held.
     */
    midiFollow: boolean;
    /** Retune speed in ms — 0 = hard lock (robot), ~40–120 natural, 200+ very loose. */
    speed: number;
    /** 0..1 how far to pull toward the target. */
    amount: number;
    /** Cents dead-zone — leave human detune alone inside this window. */
    flex: number;
    /** 0..1 preserve vibrato / correct center only. */
    humanize: number;
    /** 0..1 pitch-detect gate (higher = pickier). */
    tracking: number;
    /** 0 = formants ride pitch · 1 = keep spectral envelope. */
    formant: number;
    mix: number;
    transpose: number;
    quality: SpectralQuality;
    viz: boolean;
  };
}

// A live device instance: the in/out boundary + an apply() closure over its own nodes.
export interface FxDeviceNodes {
  in: GainNode;
  out: AudioNode;
  apply: (params: unknown, ctx: AudioContext, bpm: number) => void;
  /** Latest spectral / analyzer viz frame. */
  viz?: FxVizSlot;
  /** Continuous work (EQ dynamics + analyzer). Called ~30–60 Hz from the engine. */
  tick?: (ctx: AudioContext) => void;
  /** Push held / sounding MIDI note numbers into devices that listen (centinel). */
  setMidiTargets?: (notes: number[]) => void;
}

export type { FxVizSlot };

// synthesised reverb IR (exponentially-decaying, lightly LP'd stereo noise) — same as the
// engine's makeReverbIR, extracted so the reverb device owns it.
export function makeReverbIR(ctx: AudioContext, decay: number): AudioBuffer {
  const sr = ctx.sampleRate;
  const len = Math.max(1, Math.floor(sr * Math.min(8, Math.max(0.2, decay))));
  const buf = ctx.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const env = Math.pow(1 - i / len, 2.2);
      const white = Math.random() * 2 - 1;
      lp += 0.32 * (white - lp);
      data[i] = lp * env;
    }
  }
  return buf;
}

// ── device factories ──

function buildFilter(ctx: AudioContext): FxDeviceNodes {
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = 20000;
  filter.Q.value = 0.7;
  const inGain = ctx.createGain();
  const outGain = ctx.createGain();
  inGain.connect(filter);
  filter.connect(outGain);
  return {
    in: inGain,
    out: outGain,
    apply: (p, c) => {
      const fx = p as FxParams["filter"];
      const t = c.currentTime;
      if (!fx.on || Math.abs(fx.morph - 0.5) < 0.02) {
        filter.type = "lowpass";
        filter.frequency.setTargetAtTime(20000, t, 0.03);
        filter.Q.setTargetAtTime(0.5, t, 0.03);
      } else if (fx.morph < 0.5) {
        const k = 1 - fx.morph * 2;
        filter.type = "lowpass";
        filter.frequency.setTargetAtTime(20000 * Math.pow(120 / 20000, k), t, 0.03);
        filter.Q.setTargetAtTime(0.9 + k * 2.2, t, 0.03);
      } else {
        const k = (fx.morph - 0.5) * 2;
        filter.type = "highpass";
        filter.frequency.setTargetAtTime(20 * Math.pow(6000 / 20, k), t, 0.03);
        filter.Q.setTargetAtTime(0.9 + k * 2.2, t, 0.03);
      }
    },
  };
}

function buildComp(ctx: AudioContext): FxDeviceNodes {
  const comp = ctx.createDynamicsCompressor();
  const makeup = ctx.createGain();
  const inGain = ctx.createGain();
  inGain.connect(comp);
  comp.connect(makeup);
  return {
    in: inGain,
    out: makeup,
    apply: (p, c) => {
      const fx = p as FxParams["comp"];
      const t = c.currentTime;
      if (fx.on) {
        comp.threshold.setTargetAtTime(fx.threshold, t, 0.03);
        comp.ratio.setTargetAtTime(fx.ratio, t, 0.03);
        comp.attack.setTargetAtTime(fx.attack, t, 0.03);
        comp.release.setTargetAtTime(fx.release, t, 0.03);
        comp.knee.setTargetAtTime(6, t, 0.03);
        makeup.gain.setTargetAtTime(db2lin(fx.makeup), t, 0.03);
      } else {
        comp.threshold.setTargetAtTime(0, t, 0.03);
        comp.ratio.setTargetAtTime(1, t, 0.03);
        makeup.gain.setTargetAtTime(1, t, 0.03);
      }
    },
  };
}

function buildDelay(ctx: AudioContext): FxDeviceNodes {
  const inGain = ctx.createGain();
  const outGain = ctx.createGain();
  const dry = ctx.createGain();
  const wet = ctx.createGain();
  const delay = ctx.createDelay(2.0);
  const fb = ctx.createGain();
  inGain.connect(dry);
  dry.connect(outGain);
  inGain.connect(delay);
  delay.connect(wet);
  wet.connect(outGain);
  delay.connect(fb);
  fb.connect(delay);
  wet.gain.value = 0;
  fb.gain.value = 0;
  return {
    in: inGain,
    out: outGain,
    apply: (p, c, bpm) => {
      const fx = p as FxParams["delay"];
      const t = c.currentTime;
      const baseBeats = DELAY_DIVS[fx.div]?.beats ?? 0.5;
      const syncedSec = baseBeats * DELAY_FEEL_MULT[fx.feel] * (60 / bpm);
      const delaySec = fx.sync ? Math.min(2, syncedSec) : fx.time;
      delay.delayTime.setTargetAtTime(delaySec, t, 0.05);
      fb.gain.setTargetAtTime(fx.on ? fx.fb : 0, t, 0.05);
      wet.gain.setTargetAtTime(fx.on ? fx.mix : 0, t, 0.05);
    },
  };
}

/**
 * Dual-voice stereo chorus — two modulated delays (L/R), light feedback, dry/wet mix.
 * Native nodes only (no worklet). LFO depth is seconds of delay modulation.
 */
function buildChorus(ctx: AudioContext): FxDeviceNodes {
  const inGain = ctx.createGain();
  const outGain = ctx.createGain();
  const dry = ctx.createGain();
  const wet = ctx.createGain();
  wet.gain.value = 0;

  inGain.connect(dry);
  dry.connect(outGain);

  const split = ctx.createChannelSplitter(2);
  const merge = ctx.createChannelMerger(2);
  inGain.connect(split);

  const mkVoice = (baseDelay: number, lfoHz: number, phase: number) => {
    const d = ctx.createDelay(0.08);
    d.delayTime.value = baseDelay;
    const fb = ctx.createGain();
    fb.gain.value = 0;
    const lfo = ctx.createOscillator();
    const lfoDepth = ctx.createGain();
    lfo.frequency.value = lfoHz;
    lfoDepth.gain.value = 0.002;
    // offset phase via a constant+delay trick: start time offset
    lfo.connect(lfoDepth);
    lfoDepth.connect(d.delayTime);
    lfo.start(ctx.currentTime + phase);
    d.connect(fb);
    fb.connect(d);
    return { delay: d, fb, lfo, lfoDepth };
  };

  const vL = mkVoice(0.012, 0.85, 0);
  const vR = mkVoice(0.017, 1.15, 0.37);
  split.connect(vL.delay, 0);
  split.connect(vR.delay, 1);
  // also feed opposite channel lightly for width when input is mono-ish
  split.connect(vL.delay, 1);
  split.connect(vR.delay, 0);

  vL.delay.connect(merge, 0, 0);
  vR.delay.connect(merge, 0, 1);
  merge.connect(wet);
  wet.connect(outGain);

  return {
    in: inGain,
    out: outGain,
    apply: (p, c) => {
      const fx = p as FxParams["chorus"];
      const t = c.currentTime;
      const on = fx.on;
      const rate = Math.max(0.05, Math.min(8, fx.rate));
      // depth 0..1 → ±0.4..6 ms around base delay
      const depthSec = 0.0004 + Math.max(0, Math.min(1, fx.depth)) * 0.0055;
      const fbAmt = on ? Math.max(0, Math.min(0.7, fx.feedback)) * 0.55 : 0;
      const mix = on ? Math.max(0, Math.min(1, fx.mix)) : 0;

      vL.lfo.frequency.setTargetAtTime(rate, t, 0.04);
      vR.lfo.frequency.setTargetAtTime(rate * 1.27, t, 0.04);
      vL.lfoDepth.gain.setTargetAtTime(depthSec, t, 0.04);
      vR.lfoDepth.gain.setTargetAtTime(depthSec * 1.15, t, 0.04);
      vL.fb.gain.setTargetAtTime(fbAmt, t, 0.05);
      vR.fb.gain.setTargetAtTime(fbAmt, t, 0.05);
      wet.gain.setTargetAtTime(mix, t, 0.05);
      dry.gain.setTargetAtTime(on ? 1 - mix * 0.55 : 1, t, 0.05);
    },
  };
}

/**
 * Phase disperser — cascade of allpass biquads sharing one center frequency.
 * Magnitude stays flat; phase wraps around `freq`, which reshapes attack/transient
 * energy without EQ. `amount` scales how many stages engage + each stage's Q.
 * (Category of tool popularized by Kilohearts Disperser — original allpass cascade.)
 */
export const DISPERSER_STAGES = 12;

/** Per-stage freq/Q matching `buildDisperser` apply — used by the phase viz. */
export function disperserStageParams(
  on: boolean,
  freq: number,
  amount: number,
): { freq: number; q: number }[] {
  const f = Math.max(20, Math.min(20000, freq));
  const amt = Math.max(0, Math.min(1, amount));
  const n = on ? amt * DISPERSER_STAGES : 0;
  const qFull = 0.5 + amt * 9.5;
  const out: { freq: number; q: number }[] = [];
  for (let i = 0; i < DISPERSER_STAGES; i++) {
    const w = Math.max(0, Math.min(1, n - i));
    if (w <= 0.001) out.push({ freq: 20000, q: 0.0001 });
    else out.push({ freq: f, q: 0.0001 + qFull * w });
  }
  return out;
}

function buildDisperser(ctx: AudioContext): FxDeviceNodes {
  const inGain = ctx.createGain();
  const outGain = ctx.createGain();
  const stages: BiquadFilterNode[] = [];
  let prev: AudioNode = inGain;
  for (let i = 0; i < DISPERSER_STAGES; i++) {
    const ap = ctx.createBiquadFilter();
    ap.type = "allpass";
    ap.frequency.value = 20000;
    ap.Q.value = 0.0001;
    prev.connect(ap);
    stages.push(ap);
    prev = ap;
  }
  prev.connect(outGain);

  return {
    in: inGain,
    out: outGain,
    apply: (p, c) => {
      const fx = p as FxParams["disperser"];
      const t = c.currentTime;
      const tuned = disperserStageParams(fx.on, fx.freq, fx.amount);
      for (let i = 0; i < DISPERSER_STAGES; i++) {
        const ap = stages[i];
        const s = tuned[i];
        ap.frequency.setTargetAtTime(s.freq, t, 0.03);
        ap.Q.setTargetAtTime(s.q, t, 0.03);
      }
    },
  };
}

function buildCrush(ctx: AudioContext): FxDeviceNodes {
  const shaper = ctx.createWaveShaper();
  shaper.oversample = "2x";
  const comp = ctx.createGain();
  const inGain = ctx.createGain();
  inGain.connect(shaper);
  shaper.connect(comp);
  return {
    in: inGain,
    out: comp,
    apply: (p, c) => {
      const fx = p as FxParams["crush"];
      const t = c.currentTime;
      if (!fx.on || fx.drive <= 0.001) {
        shaper.curve = null;
        comp.gain.setTargetAtTime(1, t, 0.03);
      } else {
        const k = 1 + fx.drive * 24;
        const N = 1024;
        const curve = new Float32Array(N);
        const norm = Math.tanh(k);
        for (let i = 0; i < N; i++) {
          const x = (i / (N - 1)) * 2 - 1;
          curve[i] = Math.tanh(k * x) / norm;
        }
        shaper.curve = curve;
        const g = fx.autoGain ? 1 / Math.sqrt(1 + fx.drive * 3.5) : 1;
        comp.gain.setTargetAtTime(g, t, 0.03);
      }
    },
  };
}

function buildReverb(ctx: AudioContext): FxDeviceNodes {
  const conv = ctx.createConvolver();
  conv.normalize = true;
  let curDecay = 2.2;
  conv.buffer = makeReverbIR(ctx, curDecay);
  const dry = ctx.createGain();
  const wet = ctx.createGain();
  const inGain = ctx.createGain();
  const outGain = ctx.createGain();
  inGain.connect(dry);
  dry.connect(outGain);
  inGain.connect(conv);
  conv.connect(wet);
  wet.connect(outGain);
  wet.gain.value = 0;
  return {
    in: inGain,
    out: outGain,
    apply: (p, c) => {
      const fx = p as FxParams["reverb"];
      const t = c.currentTime;
      // regenerate the IR only when the decay meaningfully changed (avoids per-apply cost)
      if (Math.abs(fx.decay - curDecay) > 0.05) {
        curDecay = fx.decay;
        conv.buffer = makeReverbIR(c, fx.decay);
      }
      wet.gain.setTargetAtTime(fx.on ? fx.mix : 0, t, 0.05);
      dry.gain.setTargetAtTime(fx.on ? 1 - fx.mix * 0.4 : 1, t, 0.05);
    },
  };
}

function spectralLatencySamples(params: unknown): number {
  const q =
    (params as { quality?: SpectralQuality } | undefined)?.quality ?? "low";
  return SPECTRAL_QUALITY[q]?.fftSize ?? SPECTRAL_QUALITY.low.fftSize;
}

/** Shared AudioWorklet mount for spectral FX (passthrough fallback + quality rebuild). */
function buildSpectralWorklet(
  ctx: AudioContext,
  processorName: string,
  vizKind: FxVizKind,
  applyNode: (node: AudioWorkletNode, params: unknown, t: number) => void,
  qualityOf: (params: unknown) => SpectralQuality,
): FxDeviceNodes {
  const inGain = ctx.createGain();
  const outGain = ctx.createGain();
  const viz = createFxVizSlot(vizKind);
  let node: AudioWorkletNode | null = null;
  let quality: SpectralQuality = "low";
  let passthrough = false;

  const bindPort = (n: AudioWorkletNode) => {
    n.port.onmessage = (ev) => {
      const d = ev.data;
      if (!d || d.type !== "viz") return;
      ingestFxVizMessage(viz, d);
    };
  };

  const mount = (q: SpectralQuality) => {
    if (node) {
      try {
        inGain.disconnect(node);
      } catch {
        /* not connected */
      }
      try {
        node.disconnect();
      } catch {
        /* not connected */
      }
      node = null;
    }
    try {
      node = new AudioWorkletNode(ctx, processorName, {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCount: 2,
        processorOptions: { quality: q },
      });
      bindPort(node);
      if (passthrough) {
        try {
          inGain.disconnect(outGain);
        } catch {
          /* ok */
        }
        passthrough = false;
      }
      inGain.connect(node);
      node.connect(outGain);
      quality = q;
      return true;
    } catch {
      if (!passthrough && !node) {
        inGain.connect(outGain);
        passthrough = true;
      }
      return false;
    }
  };
  mount("low");

  return {
    in: inGain,
    out: outGain,
    viz,
    setMidiTargets: (notes) => {
      try {
        node?.port.postMessage({ type: "midi", notes });
      } catch {
        /* node gone */
      }
    },
    apply: (p, c) => {
      const q = qualityOf(p);
      if (!node || passthrough) mount(q);
      else if (q !== quality) mount(q);
      if (!node) return;
      applyNode(node, p, c.currentTime);
    },
  };
}

function buildImpartialer(ctx: AudioContext): FxDeviceNodes {
  return buildSpectralWorklet(
    ctx,
    "ain-impartialer",
    "impartialer",
    (node, p, t) => {
      const fx = p as FxParams["impartialer"];
      node.parameters.get("strength")?.setTargetAtTime(fx.on ? fx.strength : 0, t, 0.03);
      node.parameters.get("transpose")?.setTargetAtTime(fx.transpose, t, 0.03);
      node.parameters.get("maxShift")?.setTargetAtTime(fx.maxShift, t, 0.03);
      node.port.postMessage({
        type: "config",
        on: fx.on,
        key: fx.key,
        scale: fx.scale,
        mode: fx.mode,
        residual: fx.residual,
        viz: !!fx.viz,
      });
    },
    (p) => (p as FxParams["impartialer"]).quality,
  );
}

function buildSpeccomp(ctx: AudioContext): FxDeviceNodes {
  return buildSpectralWorklet(
    ctx,
    "ain-speccomp",
    "speccomp",
    (node, p, t) => {
      const fx = p as FxParams["speccomp"];
      const mix = fx.on ? fx.mix : 0;
      node.parameters.get("threshold")?.setTargetAtTime(fx.threshold, t, 0.03);
      node.parameters.get("ratio")?.setTargetAtTime(fx.ratio, t, 0.03);
      node.parameters.get("attack")?.setTargetAtTime(fx.attack, t, 0.03);
      node.parameters.get("release")?.setTargetAtTime(fx.release, t, 0.03);
      node.parameters.get("knee")?.setTargetAtTime(fx.knee, t, 0.03);
      node.parameters.get("makeup")?.setTargetAtTime(fx.makeup, t, 0.03);
      node.parameters.get("mix")?.setTargetAtTime(mix, t, 0.03);
      node.parameters.get("tilt")?.setTargetAtTime(fx.tilt, t, 0.03);
      node.parameters.get("focus")?.setTargetAtTime(fx.focus, t, 0.03);
      node.port.postMessage({
        type: "config",
        on: fx.on,
        viz: !!fx.viz,
        curves: (fx.curves ?? []).map((c) => ({
          on: c.on,
          freq: c.freq,
          q: c.q,
          threshold: c.threshold,
          range: c.range,
          ratio: c.ratio,
        })),
      });
    },
    (p) => (p as FxParams["speccomp"]).quality,
  );
}

function buildCentinel(ctx: AudioContext): FxDeviceNodes {
  return buildSpectralWorklet(
    ctx,
    "ain-centinel",
    "centinel",
    (node, p, t) => {
      const fx = p as FxParams["centinel"];
      const mix = fx.on ? fx.mix : 0;
      node.parameters.get("mix")?.setTargetAtTime(mix, t, 0.03);
      node.parameters.get("amount")?.setTargetAtTime(fx.amount, t, 0.03);
      node.parameters.get("speed")?.setTargetAtTime(fx.speed, t, 0.03);
      node.parameters.get("flex")?.setTargetAtTime(fx.flex, t, 0.03);
      node.parameters.get("humanize")?.setTargetAtTime(fx.humanize, t, 0.03);
      node.parameters.get("tracking")?.setTargetAtTime(fx.tracking, t, 0.03);
      node.parameters.get("formant")?.setTargetAtTime(fx.formant ?? 0.7, t, 0.03);
      node.parameters.get("transpose")?.setTargetAtTime(fx.transpose, t, 0.03);
      node.port.postMessage({
        type: "config",
        on: fx.on,
        key: fx.key,
        scale: fx.scale,
        customPcs: fx.customPcs ?? DEFAULT_CENTINEL_CUSTOM_PCS,
        midiFollow: !!fx.midiFollow,
        viz: !!fx.viz,
      });
    },
    (p) => (p as FxParams["centinel"]).quality,
  );
}

/** Pro-Q–style parametric EQ — native biquad cascade + analyser + dyn + M/S. */
const EQ_MAX_BANDS = 12;
const EQ_VIZ_BINS = 48;

function shapeToBiquadType(shape: EqBand["shape"]): BiquadFilterType {
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

function buildEq(ctx: AudioContext): FxDeviceNodes {
  const inGain = ctx.createGain();
  const outGain = ctx.createGain();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.28;
  analyser.minDecibels = -90;
  analyser.maxDecibels = -10;
  inGain.connect(analyser);

  // ── stereo path: in → cascade → out ──
  const stereoIn = ctx.createGain();
  const stereoOut = ctx.createGain();
  inGain.connect(stereoIn);

  const filters: BiquadFilterNode[] = [];
  for (let i = 0; i < EQ_MAX_BANDS; i++) {
    const f = ctx.createBiquadFilter();
    f.type = "peaking";
    f.frequency.value = 1000;
    f.Q.value = 1;
    f.gain.value = 0;
    filters.push(f);
  }
  let prev: AudioNode = stereoIn;
  for (const f of filters) {
    prev.connect(f);
    prev = f;
  }
  prev.connect(stereoOut);
  stereoOut.connect(outGain);

  // ── M/S path: encode → (EQ on mid or side) → decode ──
  const msIn = ctx.createGain();
  msIn.gain.value = 0;
  inGain.connect(msIn);
  const split = ctx.createChannelSplitter(2);
  msIn.connect(split);

  const midSum = ctx.createGain();
  const sideSum = ctx.createGain();
  const gMidL = ctx.createGain();
  gMidL.gain.value = 0.5;
  const gMidR = ctx.createGain();
  gMidR.gain.value = 0.5;
  const gSideL = ctx.createGain();
  gSideL.gain.value = 0.5;
  const gSideR = ctx.createGain();
  gSideR.gain.value = -0.5;
  split.connect(gMidL, 0);
  split.connect(gMidR, 1);
  split.connect(gSideL, 0);
  split.connect(gSideR, 1);
  gMidL.connect(midSum);
  gMidR.connect(midSum);
  gSideL.connect(sideSum);
  gSideR.connect(sideSum);

  // which bus feeds the shared cascade (the other stays dry)
  const midToEq = ctx.createGain();
  const sideToEq = ctx.createGain();
  const midDry = ctx.createGain();
  const sideDry = ctx.createGain();
  midSum.connect(midToEq);
  midSum.connect(midDry);
  sideSum.connect(sideToEq);
  sideSum.connect(sideDry);

  const eqBusIn = ctx.createGain();
  midToEq.connect(eqBusIn);
  sideToEq.connect(eqBusIn);

  // second cascade for M/S (can't share nodes with stereo path simultaneously)
  const msFilters: BiquadFilterNode[] = [];
  for (let i = 0; i < EQ_MAX_BANDS; i++) {
    const f = ctx.createBiquadFilter();
    f.type = "peaking";
    f.frequency.value = 1000;
    f.Q.value = 1;
    f.gain.value = 0;
    msFilters.push(f);
  }
  let msPrev: AudioNode = eqBusIn;
  for (const f of msFilters) {
    msPrev.connect(f);
    msPrev = f;
  }
  const eqBusOut = ctx.createGain();
  msPrev.connect(eqBusOut);

  const midFromEq = ctx.createGain();
  const sideFromEq = ctx.createGain();
  eqBusOut.connect(midFromEq);
  eqBusOut.connect(sideFromEq);

  const midProc = ctx.createGain();
  const sideProc = ctx.createGain();
  midFromEq.connect(midProc);
  midDry.connect(midProc);
  sideFromEq.connect(sideProc);
  sideDry.connect(sideProc);

  // decode L = M+S, R = M−S
  const merge = ctx.createChannelMerger(2);
  const toLfromM = ctx.createGain();
  toLfromM.gain.value = 1;
  const toLfromS = ctx.createGain();
  toLfromS.gain.value = 1;
  const toRfromM = ctx.createGain();
  toRfromM.gain.value = 1;
  const toRfromS = ctx.createGain();
  toRfromS.gain.value = -1;
  midProc.connect(toLfromM);
  sideProc.connect(toLfromS);
  midProc.connect(toRfromM);
  sideProc.connect(toRfromS);
  toLfromM.connect(merge, 0, 0);
  toLfromS.connect(merge, 0, 0);
  toRfromM.connect(merge, 0, 1);
  toRfromS.connect(merge, 0, 1);

  const msOut = ctx.createGain();
  msOut.gain.value = 0;
  merge.connect(msOut);
  msOut.connect(outGain);

  const viz = createFxVizSlot("eq", EQ_VIZ_BINS);
  const freqBytes = new Uint8Array(analyser.frequencyBinCount);
  const dynEnv = new Float32Array(EQ_MAX_BANDS);
  let live: FxParams["eq"] = {
    on: false,
    viz: true,
    stereoMode: "stereo",
    bands: [],
  };

  const setMsRouting = (m: FxParams["eq"]["stereoMode"], t: number) => {
    const st = m === "stereo" ? 1 : 0;
    const ms = m === "stereo" ? 0 : 1;
    stereoIn.gain.setTargetAtTime(st, t, 0.01);
    stereoOut.gain.setTargetAtTime(st, t, 0.01);
    msIn.gain.setTargetAtTime(ms, t, 0.01);
    msOut.gain.setTargetAtTime(ms, t, 0.01);
    // EQ on mid vs side
    const eqMid = m === "mid" ? 1 : 0;
    const eqSide = m === "side" ? 1 : 0;
    midToEq.gain.setTargetAtTime(eqMid, t, 0.01);
    midFromEq.gain.setTargetAtTime(eqMid, t, 0.01);
    midDry.gain.setTargetAtTime(1 - eqMid, t, 0.01);
    sideToEq.gain.setTargetAtTime(eqSide, t, 0.01);
    sideFromEq.gain.setTargetAtTime(eqSide, t, 0.01);
    sideDry.gain.setTargetAtTime(1 - eqSide, t, 0.01);
  };
  setMsRouting("stereo", ctx.currentTime);

  const binHz = () => ctx.sampleRate / analyser.fftSize;

  const bandLevel = (freq: number, q: number): number => {
    const hzPer = binHz();
    const center = Math.max(1, Math.round(freq / hzPer));
    const oct = 1 / Math.max(0.2, q);
    const lo = Math.max(1, Math.round((freq * Math.pow(2, -oct * 0.5)) / hzPer));
    const hi = Math.min(
      freqBytes.length - 1,
      Math.round((freq * Math.pow(2, oct * 0.5)) / hzPer),
    );
    let peak = 0;
    for (let i = lo; i <= hi; i++) peak = Math.max(peak, freqBytes[i] || 0);
    peak = Math.max(peak, freqBytes[Math.min(freqBytes.length - 1, center)] || 0);
    return peak / 255;
  };

  const fillViz = () => {
    const n = EQ_VIZ_BINS;
    const nyquist = ctx.sampleRate * 0.5;
    for (let i = 0; i < n; i++) {
      const t0 = i / n;
      const t1 = (i + 1) / n;
      const f0 = 20 * Math.pow(nyquist / 20, t0);
      const f1 = 20 * Math.pow(nyquist / 20, t1);
      const i0 = Math.max(1, Math.floor(f0 / binHz()));
      const i1 = Math.max(i0 + 1, Math.min(freqBytes.length - 1, Math.floor(f1 / binHz())));
      let m = 0;
      for (let k = i0; k < i1; k++) m = Math.max(m, freqBytes[k] || 0);
      viz.a[i] = m / 255;
      viz.b[i] = 0;
    }
    viz.n = n;
    viz.gen = (viz.gen + 1) | 0;
  };

  const bandAudible = (fx: FxParams["eq"], b: EqBand | undefined): boolean => {
    if (!fx.on || !b || !b.on) return false;
    const anySolo = (fx.bands ?? []).some((x) => x.on && x.solo);
    return !anySolo || b.solo;
  };

  const applyToCascade = (
    cascade: BiquadFilterNode[],
    fx: FxParams["eq"],
    t: number,
    dynGains: Float32Array | null,
  ) => {
    const bands = fx.bands ?? [];
    const tau = dynGains ? 0.006 : 0.015;
    for (let i = 0; i < EQ_MAX_BANDS; i++) {
      const f = cascade[i];
      const b = bands[i];
      if (!bandAudible(fx, b)) {
        f.type = "peaking";
        f.gain.setTargetAtTime(0, t, tau);
        f.Q.setTargetAtTime(1, t, 0.015);
        continue;
      }
      f.type = shapeToBiquadType(b!.shape);
      f.frequency.setTargetAtTime(Math.max(20, Math.min(20000, b!.freq)), t, 0.012);
      const q =
        b!.shape === "tilt" ? Math.max(0.1, Math.min(1, b!.q * 0.35)) : Math.max(0.1, Math.min(18, b!.q));
      f.Q.setTargetAtTime(q, t, 0.012);
      if (
        b!.shape === "lowcut" ||
        b!.shape === "highcut" ||
        b!.shape === "bandpass" ||
        b!.shape === "notch"
      ) {
        f.gain.setTargetAtTime(0, t, tau);
      } else {
        const g = dynGains ? dynGains[i] : b!.gain;
        f.gain.setTargetAtTime(g, t, tau);
      }
    }
  };

  const applyStatic = (fx: FxParams["eq"], t: number, dynGains: Float32Array | null) => {
    applyToCascade(filters, fx, t, dynGains);
    applyToCascade(msFilters, fx, t, dynGains);
  };

  const computeDynGains = (fx: FxParams["eq"], out: Float32Array): boolean => {
    const bands = fx.bands ?? [];
    let anyDyn = false;
    for (let i = 0; i < EQ_MAX_BANDS; i++) {
      const b = bands[i];
      if (!bandAudible(fx, b)) {
        out[i] = 0;
        continue;
      }
      if (
        !b!.dyn ||
        b!.shape === "lowcut" ||
        b!.shape === "highcut" ||
        b!.shape === "bandpass" ||
        b!.shape === "notch"
      ) {
        out[i] = b!.gain;
        dynEnv[i] *= 0.85;
        continue;
      }
      anyDyn = true;
      const level = bandLevel(b!.freq, b!.q);
      const levelDb =
        analyser.minDecibels + level * (analyser.maxDecibels - analyser.minDecibels);
      const over = levelDb - b!.dynThreshold;
      const knee = 3;
      const target =
        over <= 0 ? 0 : over >= knee ? 1 : 1 - ((knee - over) * (knee - over)) / (knee * knee);
      const coef = target > dynEnv[i] ? 0.72 : 0.22;
      dynEnv[i] = dynEnv[i] + coef * (target - dynEnv[i]);
      out[i] = b!.gain + b!.dynRange * dynEnv[i];
    }
    return anyDyn;
  };

  const dynGainsScratch = new Float32Array(EQ_MAX_BANDS);

  return {
    in: inGain,
    out: outGain,
    viz,
    apply: (p, c) => {
      live = p as FxParams["eq"];
      const t = c.currentTime;
      const sm = live.stereoMode ?? "stereo";
      setMsRouting(sm, t);
      analyser.getByteFrequencyData(freqBytes);
      const any = computeDynGains(live, dynGainsScratch);
      applyStatic(live, t, any ? dynGainsScratch : null);
    },
    tick: (c) => {
      analyser.getByteFrequencyData(freqBytes);
      if (live.viz) fillViz();
      const bands = live.bands ?? [];
      if (!live.on) return;
      viz.b.fill(0);
      const any = computeDynGains(live, dynGainsScratch);
      if (any) {
        for (let i = 0; i < EQ_MAX_BANDS; i++) {
          const b = bands[i];
          if (!bandAudible(live, b) || !b!.dyn) continue;
          const tt =
            (Math.log(Math.max(20, b!.freq)) - Math.log(20)) /
            (Math.log(c.sampleRate * 0.5) - Math.log(20));
          const bi = Math.min(EQ_VIZ_BINS - 1, Math.max(0, Math.floor(tt * EQ_VIZ_BINS)));
          viz.b[bi] = Math.max(viz.b[bi], dynEnv[i]);
        }
        viz.gen = (viz.gen + 1) | 0;
        applyStatic(live, c.currentTime, dynGainsScratch);
      }
    },
  };
}

// ── the device registry ──
// type → { build, defaultParams, label }. Adding a new effect = one entry here.
export type FxDeviceCategory = "native" | "spectral";

export interface FxDeviceDef {
  label: string;
  /** Menu grouping for "+ device" (default `"native"`). */
  category?: FxDeviceCategory;
  build: (ctx: AudioContext) => FxDeviceNodes;
  defaults: () => unknown;
  /**
   * Algorithmic latency in samples (0 if omitted). Used by latent devices
   * (STFT / lookahead). Chain-level compensation (mini-ADC) is not wired yet —
   * see SPECTRAL.md / AUDIO.md. May depend on live params (e.g. quality preset).
   */
  latencySamples?: number | ((params: unknown, sampleRate: number) => number);
}

export const FX_DEVICES: Record<FxDeviceType, FxDeviceDef> = {
  filter: { label: "filter", build: buildFilter, defaults: () => ({ on: false, morph: 0.5 }) as FxParams["filter"] },
  comp: { label: "comp", build: buildComp, defaults: () => ({ on: false, threshold: -18, ratio: 4, attack: 0.01, release: 0.18, makeup: 0 }) as FxParams["comp"] },
  delay: { label: "delay", build: buildDelay, defaults: () => ({ on: false, time: 0.32, fb: 0.35, mix: 0.3, sync: false, div: DEFAULT_DELAY_DIV, feel: "dotted" }) as FxParams["delay"] },
  chorus: {
    label: "chorus",
    build: buildChorus,
    defaults: () =>
      ({ on: false, rate: 0.9, depth: 0.45, mix: 0.35, feedback: 0.15 }) as FxParams["chorus"],
  },
  disperser: {
    label: "disperser",
    build: buildDisperser,
    defaults: () =>
      ({ on: false, freq: 180, amount: 0.55, viz: true }) as FxParams["disperser"],
  },
  crush: { label: "crush", build: buildCrush, defaults: () => ({ on: false, drive: 0.35, autoGain: true }) as FxParams["crush"] },
  reverb: { label: "reverb", build: buildReverb, defaults: () => ({ on: false, decay: 2.2, mix: 0.25 }) as FxParams["reverb"] },
  impartialer: {
    label: "impartialer",
    category: "spectral",
    build: buildImpartialer,
    defaults: () =>
      ({
        on: false,
        key: 0,
        scale: "major",
        mode: "snap",
        strength: 0.7,
        transpose: 0,
        maxShift: 1,
        quality: "low",
        residual: 0.5,
        viz: false,
        vizMode: "rta",
      }) as FxParams["impartialer"],
    latencySamples: (params) => spectralLatencySamples(params),
  },
  speccomp: {
    label: "speccomp",
    category: "spectral",
    build: buildSpeccomp,
    defaults: () =>
      ({
        on: false,
        threshold: -24,
        ratio: 4,
        attack: 0.01,
        release: 0.12,
        knee: 6,
        makeup: 0,
        mix: 1,
        tilt: 0,
        focus: 0.35,
        quality: "low",
        viz: true,
        curves: [],
      }) as FxParams["speccomp"],
    latencySamples: (params) => spectralLatencySamples(params),
  },
  eq: {
    label: "eq",
    category: "native",
    build: buildEq,
    defaults: () =>
      ({
        on: false,
        viz: true,
        stereoMode: "stereo",
        bands: [
          defaultEqBand({ freq: 100, gain: 0, shape: "lowshelf" }),
          defaultEqBand({ freq: 1000, gain: 0, shape: "bell" }),
          defaultEqBand({ freq: 8000, gain: 0, shape: "highshelf" }),
        ],
      }) as FxParams["eq"],
  },
  centinel: {
    label: "centinel",
    category: "spectral",
    build: buildCentinel,
    defaults: () =>
      ({
        on: false,
        key: 0,
        scale: "major",
        customPcs: DEFAULT_CENTINEL_CUSTOM_PCS.slice(),
        midiFollow: false,
        speed: 40,
        amount: 1,
        flex: 12,
        humanize: 0.4,
        tracking: 0.35,
        formant: 0.7,
        mix: 1,
        transpose: 0,
        quality: "low",
        viz: true,
      }) as FxParams["centinel"],
    latencySamples: (params) => spectralLatencySamples(params),
  },
};

export const FX_DEVICE_TYPES = Object.keys(FX_DEVICES) as FxDeviceType[];

export type FxDeviceStateLike = { id: string; type: FxDeviceType; params: unknown };

/** Migrate persisted device lists (`chroma`/`partialer`→`impartialer`, `space`→`delay`, `tuner`→`centinel`; EQ/impartialer defaults). */
export function migrateFxDeviceStates(states: FxDeviceStateLike[]): FxDeviceStateLike[] {
  return states
    .map((s) => {
      const raw = s.type as string;
      const type =
        raw === "chroma" || raw === "partialer"
          ? "impartialer"
          : raw === "space"
            ? "delay"
            : raw === "tuner"
              ? "centinel"
              : s.type;
      if (!(type in FX_DEVICES)) return null;

      const prev = (s.params && typeof s.params === "object" ? s.params : {}) as Record<
        string,
        unknown
      >;

      if (type !== s.type) {
        if (type === "impartialer") {
          const defaults = FX_DEVICES.impartialer.defaults() as Record<string, unknown>;
          return { ...s, type: "impartialer" as FxDeviceType, params: { ...defaults, ...prev } };
        }
        // space → delay / tuner → centinel: params shape compatible
        return { ...s, type: type as FxDeviceType, params: prev };
      }

      if (type === "eq") {
        const stereoMode =
          prev.stereoMode === "mid" || prev.stereoMode === "side" ? prev.stereoMode : "stereo";
        const bands = Array.isArray(prev.bands)
          ? (prev.bands as Record<string, unknown>[]).map((b) => ({
              ...b,
              solo: !!b.solo,
            }))
          : prev.bands;
        return { ...s, params: { ...prev, stereoMode, bands } };
      }

      if (type === "impartialer") {
        const vizMode = prev.vizMode === "trail" ? "trail" : "rta";
        if (vizMode !== prev.vizMode) {
          return { ...s, params: { ...prev, vizMode } };
        }
      }

      if (type === "disperser" && prev.viz === undefined) {
        return { ...s, params: { ...prev, viz: true } };
      }

      if (type === "centinel") {
        const customPcs = Array.isArray(prev.customPcs)
          ? (prev.customPcs as number[]).filter((n) => n >= 0 && n <= 11)
          : DEFAULT_CENTINEL_CUSTOM_PCS.slice();
        const scale =
          prev.scale === "custom" ||
          prev.scale === "major" ||
          prev.scale === "minor" ||
          prev.scale === "dorian" ||
          prev.scale === "chromatic"
            ? prev.scale
            : "major";
        return {
          ...s,
          params: {
            ...prev,
            scale,
            customPcs: customPcs.length ? customPcs : DEFAULT_CENTINEL_CUSTOM_PCS.slice(),
            midiFollow: !!prev.midiFollow,
            formant: prev.formant === undefined ? 0.7 : prev.formant,
            viz: prev.viz !== false,
          },
        };
      }

      return s;
    })
    .filter((s): s is FxDeviceStateLike => s != null);
}