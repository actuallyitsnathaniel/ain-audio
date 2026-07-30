// ── FX device modules ─────────────────────────────────────────────────────────
// Each effect is a self-describing DEVICE: a factory that builds its node graph as an
// { in, out } pair, plus an `apply(params, ctx)` that sets its params (ramped, click-safe
// via setTargetAtTime). This is the reusable unit an FxChain instances per track or on the
// master bus. Behavior is ported 1:1 from the engine's old hand-wired applyFx so the
// master bus sounds identical after migration.
//
// A device is BYPASSED by neutralizing its nodes (not by removing it from the chain), so
// toggling on/off never reorders/reconnects — exactly the old rack's model.

export type FxDeviceType =
  | "filter"
  | "comp"
  | "space"
  | "crush"
  | "reverb"
  | "impartialer"
  | "speccomp";

export type DelayFeel = "straight" | "dotted" | "triplet";
export type ImpartialerScale = "major" | "minor" | "dorian" | "chromatic";
export type ImpartialerMappingMode = "off" | "snap" | "remap";
export type SpectralQuality = "low" | "high";

export const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"] as const;
export const IMPARTIALER_SCALES: ImpartialerScale[] = ["major", "minor", "dorian", "chromatic"];

// tempo-sync divisions for the delay (space) device
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
  space: { on: boolean; time: number; fb: number; mix: number; sync: boolean; div: number; feel: DelayFeel };
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
  };
}

// A live device instance: the in/out boundary + an apply() closure over its own nodes.
export interface FxDeviceNodes {
  in: GainNode;
  out: AudioNode;
  apply: (params: unknown, ctx: AudioContext, bpm: number) => void;
}

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

function buildSpace(ctx: AudioContext): FxDeviceNodes {
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
      const fx = p as FxParams["space"];
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
  applyNode: (node: AudioWorkletNode, params: unknown, t: number) => void,
  qualityOf: (params: unknown) => SpectralQuality,
): FxDeviceNodes {
  const inGain = ctx.createGain();
  const outGain = ctx.createGain();
  let node: AudioWorkletNode | null = null;
  let quality: SpectralQuality = "low";
  let passthrough = false;

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
      });
    },
    (p) => (p as FxParams["impartialer"]).quality,
  );
}

function buildSpeccomp(ctx: AudioContext): FxDeviceNodes {
  return buildSpectralWorklet(
    ctx,
    "ain-speccomp",
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
      node.port.postMessage({ type: "config", on: fx.on });
    },
    (p) => (p as FxParams["speccomp"]).quality,
  );
}

// ── the device registry ──
// type → { build, defaultParams, label }. Adding a new effect = one entry here.
export interface FxDeviceDef {
  label: string;
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
  space: { label: "space", build: buildSpace, defaults: () => ({ on: false, time: 0.32, fb: 0.35, mix: 0.3, sync: false, div: DEFAULT_DELAY_DIV, feel: "dotted" }) as FxParams["space"] },
  crush: { label: "crush", build: buildCrush, defaults: () => ({ on: false, drive: 0.35, autoGain: true }) as FxParams["crush"] },
  reverb: { label: "reverb", build: buildReverb, defaults: () => ({ on: false, decay: 2.2, mix: 0.25 }) as FxParams["reverb"] },
  impartialer: {
    label: "impartialer",
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
      }) as FxParams["impartialer"],
    latencySamples: (params) => spectralLatencySamples(params),
  },
  speccomp: {
    label: "speccomp",
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
      }) as FxParams["speccomp"],
    latencySamples: (params) => spectralLatencySamples(params),
  },
};

export const FX_DEVICE_TYPES = Object.keys(FX_DEVICES) as FxDeviceType[];

export type FxDeviceStateLike = { id: string; type: FxDeviceType; params: unknown };

/** Migrate persisted device lists (`chroma` / `partialer` → `impartialer`). */
export function migrateFxDeviceStates(states: FxDeviceStateLike[]): FxDeviceStateLike[] {
  return states
    .map((s) => {
      const raw = s.type as string;
      const type =
        raw === "chroma" || raw === "partialer" ? "impartialer" : s.type;
      if (!(type in FX_DEVICES)) return null;
      if (type === s.type) return s;
      const defaults = FX_DEVICES.impartialer.defaults() as Record<string, unknown>;
      const prev = (s.params && typeof s.params === "object" ? s.params : {}) as Record<
        string,
        unknown
      >;
      return { ...s, type: "impartialer" as FxDeviceType, params: { ...defaults, ...prev } };
    })
    .filter((s): s is FxDeviceStateLike => s != null);
}