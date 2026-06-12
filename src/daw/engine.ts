// ── AIN audio engine v2 — track-based ────────────────────────────────────
// One AudioContext, one global "master track". A track is either a 'pair'
// (mix + master, phase-locked A/B crossfade) or a 'single' (one preview file
// through the master branch). Sources for a pair are started on the same
// context clock at the same sample → they physically cannot drift.
//
// Ported from the prototype js/engine.js (verified clean). Framework-agnostic:
// this module owns the Web Audio graph; React subscribes via on()/off().

import type { Track } from "./data/tracks";
import { PRESETS, type SampledPreset } from "./data/presets";
import { clipBeats, type NoteClip } from "./data/clips";
import { parseMidi } from "./data/midi-file";

export type TransportMode = "track" | "sequence";

type EngineEvent = "state" | "wet" | "fx" | "track" | "ready" | "synth" | "preset" | "transport" | "clip";

export interface Levels {
  rms: number;
  peak: number;
}
export interface LevelPair {
  mix: Levels;
  master: Levels;
}

// Each reorderable effect is a module with one input + one output GainNode, so
// the chain can be torn down and rewired in any order at the gain boundaries.
interface FxModule {
  in: GainNode;
  out: GainNode;
}

interface GraphNodes {
  tapMix: GainNode;
  tapMaster: GainNode;
  anMix: AnalyserNode;
  anMaster: AnalyserNode;
  lm: GainNode;
  gMix: GainNode;
  gMaster: GainNode;
  sum: GainNode;
  // ── reorderable fx modules (each in→…→out) ──
  filter: BiquadFilterNode;
  mFilter: FxModule;
  comp: DynamicsCompressorNode;
  compMakeup: GainNode;
  mComp: FxModule;
  // space (delay) — internal dry/wet + feedback, wrapped by mSpace
  dDry: GainNode;
  dWet: GainNode;
  delay: DelayNode;
  dFb: GainNode;
  mSpace: FxModule;
  // crush (waveshaper) with auto-gain compensation
  shaper: WaveShaperNode;
  crushComp: GainNode;
  mCrush: FxModule;
  // reverb (convolver) — internal dry/wet, wrapped by mReverb
  conv: ConvolverNode;
  rvDry: GainNode;
  rvWet: GainNode;
  mReverb: FxModule;
  // ── fixed tail (never reordered) ──
  anOut: AnalyserNode;
  limiter: DynamicsCompressorNode; // brickwall safety, always last
  limMakeup: GainNode;
  master: GainNode;
}

// keys of the reorderable rack, in default (musical) order
export type FxKey = "filter" | "comp" | "space" | "crush" | "reverb";
const FX_DEFAULT_ORDER: FxKey[] = ["filter", "comp", "space", "crush", "reverb"];

// Tempo-synced delay: the `div` knob picks one of these STRAIGHT divisions (in
// beats, 1/4 note = 1 beat), and a separate `feel` flips it dotted (×1.5) or
// triplet (×2/3). delay seconds = base beats × feel × 60 / bpm.
const DELAY_DIVS: { label: string; beats: number }[] = [
  { label: "1/1", beats: 4 },
  { label: "1/2", beats: 2 },
  { label: "1/4", beats: 1 },
  { label: "1/8", beats: 0.5 },
  { label: "1/16", beats: 0.25 },
  { label: "1/32", beats: 0.125 },
];
export const delayDivLabels = DELAY_DIVS.map((d) => d.label);
export type DelayFeel = "straight" | "dotted" | "triplet";
const DELAY_FEEL_MULT: Record<DelayFeel, number> = { straight: 1, dotted: 1.5, triplet: 2 / 3 };
const DEFAULT_DELAY_DIV = 3; // 1/8

interface FxState {
  filter: { on: boolean; morph: number };
  comp: { on: boolean; threshold: number; ratio: number; attack: number; release: number; makeup: number };
  space: { on: boolean; time: number; fb: number; mix: number; sync: boolean; div: number; feel: DelayFeel };
  crush: { on: boolean; drive: number; autoGain: boolean };
  reverb: { on: boolean; decay: number; mix: number };
  limiter: { on: boolean; ceiling: number };
}

// A live voice handle returned by startVoiceAt. The voice gain `vg` carries the
// amp ADSR; `r` is the release time. Discriminated by source kind so releaseVoice
// can stop the right nodes.
type VoiceHandle =
  | { kind: "synth"; vg: GainNode; r: number; oscs: OscillatorNode[]; vf: BiquadFilterNode }
  | { kind: "sample"; vg: GainNode; r: number; src: AudioBufferSourceNode };

interface Patch {
  osc: [OscillatorType, number][];
  oct: number;
  cut: number;
  envAmt: number;
  q: number;
  a: number;
  d: number;
  s: number;
  r: number;
  vol: number;
}

const LS_WET = "ain-masterlab-wet";
const posKey = (id: string) => "ain-pos:" + id;
const db2lin = (db: number) => Math.pow(10, db / 20);

// ── preset synth patches (Splice-style preset showcase) ──
// Demo web-synth patches stand in for real preset one-shots; voices route
// into the sum node so they run through the visitor FX chain.
const PATCHES: Record<string, Patch> = {
  "glass pad": { osc: [["sawtooth", -7], ["sawtooth", 7]], oct: 0, cut: 900, envAmt: 900, q: 0.9, a: 0.16, d: 0.4, s: 0.7, r: 0.9, vol: 0.13 },
  "neon pluck": { osc: [["square", -4], ["sawtooth", 4]], oct: 0, cut: 500, envAmt: 2600, q: 2.4, a: 0.004, d: 0.28, s: 0.0, r: 0.28, vol: 0.16 },
  "sub bass": { osc: [["sine", 0], ["triangle", 2]], oct: -1, cut: 420, envAmt: 160, q: 0.7, a: 0.006, d: 0.12, s: 0.9, r: 0.16, vol: 0.24 },
};

class AudioEngine {
  ctx: AudioContext | null = null;
  nodes: GraphNodes | null = null;
  track: Track | null = null;
  buffers: { mix?: AudioBuffer; master: AudioBuffer } | null = null;
  playing = false;
  loading = false;
  ready = false;
  error: string | null = null;
  duration = 0;
  levelMatch = false;
  lmDb = 1.7;
  wet: number;
  fx: FxState = {
    filter: { on: false, morph: 0.5 },
    comp: { on: false, threshold: -18, ratio: 4, attack: 0.01, release: 0.18, makeup: 0 },
    space: { on: false, time: 0.32, fb: 0.35, mix: 0.3, sync: false, div: DEFAULT_DELAY_DIV, feel: "dotted" },
    crush: { on: false, drive: 0.35, autoGain: true },
    reverb: { on: false, decay: 2.2, mix: 0.25 },
    limiter: { on: true, ceiling: -1.5 },
  };
  // live order of the reorderable rack (drag-to-reorder writes this)
  fxOrder: FxKey[] = [...FX_DEFAULT_ORDER];
  // true once a real IR file is loaded → decay knob stops regenerating the synth IR
  private _reverbIRFile = false;

  synthPatch = "glass pad";
  synthPatches = Object.keys(PATCHES);

  // ── sampled presets (real bounced one-shots; JS synth is the fallback) ──
  samplePresets: SampledPreset[] = PRESETS;
  samplePreset = PRESETS[0]?.id || "";

  // ── sequencer transport ──
  bpm = 110;
  transportMode: TransportMode = "track";
  sequencePlaying = false;
  loopOn = true;
  private _clip: NoteClip | null = null;
  private _schedTimer = 0;
  private _scheduledThrough = 0; // ctx time we've scheduled notes up to
  private _seqAnchorTime = 0; // ctx time at which _seqAnchorBeat played
  private _seqAnchorBeat = 0; // beat value at the anchor
  private _seqVoices: VoiceHandle[] = []; // voices started by the scheduler
  private static SCHED_INTERVAL = 25; // ms — clock tick
  private static SCHED_AHEAD = 0.12; // s — schedule this far ahead of currentTime

  private _startCtx = 0;
  private _offset = 0;
  private _peaks: Float32Array | null = null;
  private _srcs: AudioBufferSourceNode[] | null = null;
  private _liveVoices: Record<number, VoiceHandle> = {};
  // decoded zone buffers per preset id; index parallels preset.zones.
  // an entry of `null` at a slot means that zone failed to decode.
  private _sampleBufs: Record<string, (AudioBuffer | null)[]> = {};
  private _presetLoading: Record<string, boolean> = {};
  private _phraseCache: Record<string, { clip: NoteClip; bpm?: number }> = {};
  private _ls: Partial<Record<EngineEvent, Array<() => void>>> = {};
  private _lastSave = 0;
  private _defaultTrack: Track | null = null;
  private _tdBuf = new Float32Array(2048);

  constructor() {
    const v = parseFloat(localStorage.getItem(LS_WET) || "");
    this.wet = isNaN(v) ? 1 : Math.min(1, Math.max(0, v));
  }

  // ── pub/sub ──
  on(ev: EngineEvent, fn: () => void) {
    (this._ls[ev] = this._ls[ev] || []).push(fn);
    return fn;
  }
  off(ev: EngineEvent, fn: () => void) {
    this._ls[ev] = (this._ls[ev] || []).filter((f) => f !== fn);
  }
  private emit(ev: EngineEvent) {
    (this._ls[ev] || []).forEach((f) => f());
  }

  setDefaultTrack(track: Track) {
    this._defaultTrack = track;
    if (!this.track) this.track = track;
  }

  isPair() {
    return !!(this.track && this.track.kind === "pair");
  }

  private ensureCtx(): AudioContext {
    if (!this.ctx) {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctor();
      this.buildGraph();
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  private buildGraph() {
    const c = this.ctx!;
    const n = {} as GraphNodes;
    n.tapMix = c.createGain();
    n.tapMaster = c.createGain();
    n.anMix = c.createAnalyser();
    n.anMaster = c.createAnalyser();
    n.anMix.fftSize = 2048;
    n.anMaster.fftSize = 2048;
    n.tapMix.connect(n.anMix);
    n.tapMaster.connect(n.anMaster);

    n.lm = c.createGain();
    n.lm.gain.value = this.levelMatch ? db2lin(this.lmDb) : 1;

    n.gMix = c.createGain();
    n.gMaster = c.createGain();
    n.tapMix.connect(n.lm);
    n.lm.connect(n.gMix);
    n.tapMaster.connect(n.gMaster);

    n.sum = c.createGain();
    n.gMix.connect(n.sum);
    n.gMaster.connect(n.sum);

    // ── reorderable fx modules (each: in → …internal… → out) ──

    // FILTER: in → biquad → out
    n.filter = c.createBiquadFilter();
    n.filter.type = "lowpass";
    n.filter.frequency.value = 20000;
    n.filter.Q.value = 0.7;
    n.mFilter = { in: c.createGain(), out: c.createGain() };
    n.mFilter.in.connect(n.filter);
    n.filter.connect(n.mFilter.out);

    // COMP (creative dynamics): in → compressor → makeup(out)
    n.comp = c.createDynamicsCompressor();
    n.compMakeup = c.createGain();
    n.mComp = { in: c.createGain(), out: n.compMakeup };
    n.mComp.in.connect(n.comp);
    n.comp.connect(n.compMakeup);

    // SPACE (delay): in → [dry + delay/feedback wet] → out (feedback is internal)
    n.mSpace = { in: c.createGain(), out: c.createGain() };
    n.dDry = c.createGain();
    n.dWet = c.createGain();
    n.delay = c.createDelay(2.0);
    n.dFb = c.createGain();
    n.mSpace.in.connect(n.dDry);
    n.dDry.connect(n.mSpace.out);
    n.mSpace.in.connect(n.delay);
    n.delay.connect(n.dWet);
    n.dWet.connect(n.mSpace.out);
    n.delay.connect(n.dFb);
    n.dFb.connect(n.delay);
    n.dWet.gain.value = 0;
    n.dFb.gain.value = 0;

    // CRUSH (waveshaper) with auto-gain compensation: in → shaper → crushComp(out)
    n.shaper = c.createWaveShaper();
    n.shaper.oversample = "2x";
    n.crushComp = c.createGain();
    n.mCrush = { in: c.createGain(), out: n.crushComp };
    n.mCrush.in.connect(n.shaper);
    n.shaper.connect(n.crushComp);

    // REVERB (convolver): in → [dry + convolver wet] → out
    n.conv = c.createConvolver();
    n.conv.normalize = true;
    n.conv.buffer = this.makeReverbIR(this.fx.reverb.decay);
    n.rvDry = c.createGain();
    n.rvWet = c.createGain();
    n.mReverb = { in: c.createGain(), out: c.createGain() };
    n.mReverb.in.connect(n.rvDry);
    n.rvDry.connect(n.mReverb.out);
    n.mReverb.in.connect(n.conv);
    n.conv.connect(n.rvWet);
    n.rvWet.connect(n.mReverb.out);
    n.rvWet.gain.value = 0;

    // ── fixed tail (never reordered): anOut → safety limiter → master → out ──
    n.anOut = c.createAnalyser();
    n.anOut.fftSize = 2048;
    n.anOut.smoothingTimeConstant = 0.82;
    n.limiter = c.createDynamicsCompressor();
    n.limMakeup = c.createGain();
    n.master = c.createGain();
    n.master.gain.value = 0.95;
    n.anOut.connect(n.limiter);
    n.limiter.connect(n.limMakeup);
    n.limMakeup.connect(n.master);
    n.master.connect(c.destination);

    this.nodes = n;
    this.rewireChain(true); // sum → [fxOrder modules] → anOut
    this.applyWet(true);
    this.applyFx();
  }

  // Module lookup by FxKey, so rewireChain can walk fxOrder generically.
  private fxModule(key: FxKey): FxModule {
    const n = this.nodes!;
    switch (key) {
      case "filter":
        return n.mFilter;
      case "comp":
        return n.mComp;
      case "space":
        return n.mSpace;
      case "crush":
        return n.mCrush;
      case "reverb":
        return n.mReverb;
    }
  }

  // Tear down sum→…→anOut and reconnect the rack in `fxOrder`. Click-safe:
  // briefly duck `sum` to silence, rewire on the gain boundaries, ramp back.
  // Effects are always all in-chain; "bypass" is done by neutralizing a node in
  // applyFx (not by removing it), so toggling on/off never reorders the rack.
  private rewireChain(instant?: boolean) {
    const n = this.nodes;
    if (!n) return;
    const c = this.ctx!;
    const t = c.currentTime;
    const rampDown = () => {
      if (instant) n.sum.gain.value = 0;
      else n.sum.gain.setTargetAtTime(0, t, 0.008);
    };
    const rampUp = () => {
      if (instant) n.sum.gain.value = 1;
      else n.sum.gain.setTargetAtTime(1, t + 0.02, 0.008);
    };
    rampDown();
    // drop all external module connections + sum's output
    try {
      n.sum.disconnect();
    } catch {
      /* nothing connected yet */
    }
    FX_DEFAULT_ORDER.forEach((k) => {
      try {
        this.fxModule(k).out.disconnect();
      } catch {
        /* not connected yet */
      }
    });
    // reconnect sum → m0.in, m0.out → m1.in, … last.out → anOut
    let prevOut: AudioNode = n.sum;
    this.fxOrder.forEach((k) => {
      const m = this.fxModule(k);
      prevOut.connect(m.in);
      prevOut = m.out;
    });
    prevOut.connect(n.anOut);
    rampUp();
  }

  // Reorder the reorderable rack. `order` must be a permutation of the 5 keys.
  setFxOrder(order: FxKey[]) {
    const valid = order.length === FX_DEFAULT_ORDER.length && FX_DEFAULT_ORDER.every((k) => order.includes(k));
    if (!valid) return;
    this.fxOrder = [...order];
    if (this.ctx) this.rewireChain();
    this.emit("fx");
  }

  // Synthesised impulse response: exponentially-decaying, lightly low-passed
  // stereo noise. Decorrelated L/R for width. No asset needed; load a real IR
  // file later via loadReverbIR to override.
  private makeReverbIR(decay: number): AudioBuffer {
    const c = this.ctx!;
    const sr = c.sampleRate;
    const len = Math.max(1, Math.floor(sr * Math.min(8, Math.max(0.2, decay))));
    const buf = c.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const env = Math.pow(1 - i / len, 2.2); // smooth tail to zero
        const white = Math.random() * 2 - 1;
        lp += 0.32 * (white - lp); // gentle 1-pole low-pass for a darker tail
        data[i] = lp * env;
      }
    }
    return buf;
  }

  private applyWet(instant?: boolean) {
    const n = this.nodes;
    if (!n) return;
    const t = this.ctx!.currentTime;
    // singles play 100% through the master branch
    const x = this.isPair() ? this.wet : 1;
    const gM = Math.cos((x * Math.PI) / 2);
    const gW = Math.sin((x * Math.PI) / 2);
    if (instant) {
      n.gMix.gain.value = gM;
      n.gMaster.gain.value = gW;
    } else {
      n.gMix.gain.setTargetAtTime(gM, t, 0.012);
      n.gMaster.gain.setTargetAtTime(gW, t, 0.012);
    }
  }

  private applyFx() {
    const n = this.nodes;
    if (!n) return;
    const t = this.ctx!.currentTime;
    const fx = this.fx;
    if (!fx.filter.on || Math.abs(fx.filter.morph - 0.5) < 0.02) {
      n.filter.type = "lowpass";
      n.filter.frequency.setTargetAtTime(20000, t, 0.03);
      n.filter.Q.setTargetAtTime(0.5, t, 0.03);
    } else if (fx.filter.morph < 0.5) {
      const k = 1 - fx.filter.morph * 2;
      n.filter.type = "lowpass";
      n.filter.frequency.setTargetAtTime(20000 * Math.pow(120 / 20000, k), t, 0.03);
      n.filter.Q.setTargetAtTime(0.9 + k * 2.2, t, 0.03);
    } else {
      const k = (fx.filter.morph - 0.5) * 2;
      n.filter.type = "highpass";
      n.filter.frequency.setTargetAtTime(20 * Math.pow(6000 / 20, k), t, 0.03);
      n.filter.Q.setTargetAtTime(0.9 + k * 2.2, t, 0.03);
    }
    // COMP — creative dynamics + manual makeup. Neutralized when off
    // (threshold 0 dB = never engages, ratio 1, makeup unity).
    if (fx.comp.on) {
      n.comp.threshold.setTargetAtTime(fx.comp.threshold, t, 0.03);
      n.comp.ratio.setTargetAtTime(fx.comp.ratio, t, 0.03);
      n.comp.attack.setTargetAtTime(fx.comp.attack, t, 0.03);
      n.comp.release.setTargetAtTime(fx.comp.release, t, 0.03);
      n.comp.knee.setTargetAtTime(6, t, 0.03);
      n.compMakeup.gain.setTargetAtTime(db2lin(fx.comp.makeup), t, 0.03);
    } else {
      n.comp.threshold.setTargetAtTime(0, t, 0.03);
      n.comp.ratio.setTargetAtTime(1, t, 0.03);
      n.compMakeup.gain.setTargetAtTime(1, t, 0.03);
    }

    // delay time: free ms (space.time) or tempo-synced. Synced = base division ×
    // feel (straight/dotted/triplet) × 60/bpm, clamped to the DelayNode's 2s max
    // (long divisions at slow tempos can exceed it — e.g. a dotted 1/1 at 60 bpm).
    const baseBeats = DELAY_DIVS[fx.space.div]?.beats ?? 0.5;
    const syncedSec = baseBeats * DELAY_FEEL_MULT[fx.space.feel] * (60 / this.bpm);
    const delaySec = fx.space.sync ? Math.min(2, syncedSec) : fx.space.time;
    n.delay.delayTime.setTargetAtTime(delaySec, t, 0.05);
    n.dFb.gain.setTargetAtTime(fx.space.on ? fx.space.fb : 0, t, 0.05);
    n.dWet.gain.setTargetAtTime(fx.space.on ? fx.space.mix : 0, t, 0.05);

    // CRUSH — tanh saturation. Auto-gain (default on) trims the loudness rise the
    // drive adds, so turning it up changes grit, not volume.
    if (!fx.crush.on || fx.crush.drive <= 0.001) {
      n.shaper.curve = null;
      n.crushComp.gain.setTargetAtTime(1, t, 0.03);
    } else {
      const k = 1 + fx.crush.drive * 24;
      const N = 1024;
      const curve = new Float32Array(N);
      const norm = Math.tanh(k);
      for (let i = 0; i < N; i++) {
        const x = (i / (N - 1)) * 2 - 1;
        curve[i] = Math.tanh(k * x) / norm;
      }
      n.shaper.curve = curve;
      // empirical loudness comp: stronger drive → more attenuation
      const comp = fx.crush.autoGain ? 1 / Math.sqrt(1 + fx.crush.drive * 3.5) : 1;
      n.crushComp.gain.setTargetAtTime(comp, t, 0.03);
    }

    // REVERB — dry/wet convolution. Decay changes regenerate the synth IR (unless
    // a real IR file was loaded, which pins the buffer).
    if (n.conv.buffer && !this._reverbIRFile) {
      const want = Math.floor(this.ctx!.sampleRate * Math.min(8, Math.max(0.2, fx.reverb.decay)));
      if (Math.abs(n.conv.buffer.length - want) > this.ctx!.sampleRate * 0.05) {
        n.conv.buffer = this.makeReverbIR(fx.reverb.decay);
      }
    }
    n.rvWet.gain.setTargetAtTime(fx.reverb.on ? fx.reverb.mix : 0, t, 0.05);
    n.rvDry.gain.setTargetAtTime(fx.reverb.on ? 1 - fx.reverb.mix * 0.4 : 1, t, 0.05);

    // SAFETY LIMITER — fixed, always-last brickwall. Catches any peak regardless
    // of fx order. Bypassed (threshold 0 / ratio 1) only if the user disables it.
    if (fx.limiter.on) {
      n.limiter.threshold.setTargetAtTime(fx.limiter.ceiling, t, 0.02);
      n.limiter.ratio.setTargetAtTime(20, t, 0.02);
      n.limiter.knee.setTargetAtTime(0, t, 0.02);
      n.limiter.attack.setTargetAtTime(0.002, t, 0.02);
      n.limiter.release.setTargetAtTime(0.12, t, 0.02);
      n.limMakeup.gain.setTargetAtTime(db2lin(-fx.limiter.ceiling * 0.25), t, 0.02);
    } else {
      n.limiter.threshold.setTargetAtTime(0, t, 0.02);
      n.limiter.ratio.setTargetAtTime(1, t, 0.02);
      n.limMakeup.gain.setTargetAtTime(1, t, 0.02);
    }
  }

  private async fetchBuf(url: string, c: AudioContext): Promise<AudioBuffer> {
    const res = await fetch(url);
    if (!res.ok) throw new Error("audio not found (" + res.status + ")");
    const ab = await res.arrayBuffer();
    return await c.decodeAudioData(ab);
  }

  // ── track loading ──
  setTrackMeta(track: Track) {
    // set the current track without fetching (no user gesture yet)
    if (this.track && this.track.id === track.id) return;
    this.stopSources();
    this.playing = false;
    this.track = track;
    this.buffers = null;
    this.ready = false;
    this.error = null;
    this._peaks = null;
    this.duration = 0;
    this.lmDb = track.kind === "pair" ? track.lmDb || 1.7 : 1.7;
    this._offset = parseFloat(localStorage.getItem(posKey(track.id)) || "0") || 0;
    this.emit("track");
    this.emit("state");
  }

  async loadTrack(track: Track, opts?: { autoplay?: boolean }) {
    const autoplay = opts && opts.autoplay;
    if (this.track && this.track.id === track.id && (this.ready || this.loading)) {
      if (autoplay && this.ready && !this.playing) this.play();
      return;
    }
    this.setTrackMeta(track);
    this.loading = true;
    this.emit("state");
    try {
      const c = this.ensureCtx();
      if (track.kind === "pair") {
        const [mix, master] = await Promise.all([
          this.fetchBuf(track.mixUrl, c),
          this.fetchBuf(track.masterUrl, c),
        ]);
        if (this.track !== track) return; // superseded by another load
        this.buffers = { mix, master };
        this.duration = Math.min(mix.duration, master.duration);
      } else {
        const buf = await this.fetchBuf(track.src, c);
        if (this.track !== track) return;
        this.buffers = { master: buf };
        this.duration = buf.duration;
      }
      if (this._offset >= this.duration) this._offset = 0;
      this.loading = false;
      this.ready = true;
      this.applyWet(true);
      this.emit("state");
      this.emit("ready");
      if (autoplay) this.play();
    } catch (e) {
      if (this.track !== track) return;
      this.loading = false;
      this.error = (e instanceof Error && e.message) || "failed to load audio";
      this.emit("state");
    }
  }

  // check whether a preview file exists without decoding it
  async probe(url: string): Promise<boolean> {
    try {
      const res = await fetch(url, { method: "HEAD" });
      return res.ok;
    } catch {
      return false;
    }
  }

  // ── transport ──
  private startSources(offset: number) {
    const c = this.ctx!;
    const n = this.nodes!;
    const srcs: AudioBufferSourceNode[] = [];
    const when = c.currentTime + 0.06;
    if (this.buffers!.mix) {
      const sMix = c.createBufferSource();
      sMix.buffer = this.buffers!.mix;
      sMix.connect(n.tapMix);
      sMix.start(when, offset);
      srcs.push(sMix);
    }
    const sMaster = c.createBufferSource();
    sMaster.buffer = this.buffers!.master;
    sMaster.connect(n.tapMaster);
    sMaster.start(when, offset);
    srcs.push(sMaster);
    this._srcs = srcs;
    this._startCtx = when;
  }

  private stopSources() {
    (this._srcs || []).forEach((s) => {
      try {
        s.stop();
        s.disconnect();
      } catch {
        /* already stopped */
      }
    });
    this._srcs = null;
  }

  async play() {
    this.ensureCtx();
    // transport mutual-exclusion: starting track playback stops the sequencer
    if (this.sequencePlaying) this.stopSequence();
    if (!this.ready) {
      const t = this.track || this._defaultTrack;
      if (t) await this.loadTrack(t, { autoplay: false });
      if (!this.ready) return; // load failed
    }
    if (this.playing) return;
    this.applyWet(true);
    this.startSources(this._offset);
    this.playing = true;
    this.emit("state");
  }

  pause() {
    if (!this.playing) return;
    this._offset = this.getPosition();
    this.stopSources();
    this.playing = false;
    this.savePos();
    this.emit("state");
  }

  toggle() {
    if (this.playing) this.pause();
    else void this.play();
  }

  seek(sec: number) {
    sec = Math.min(Math.max(0, sec), Math.max(0, this.duration - 0.05));
    const was = this.playing;
    if (was) this.stopSources();
    this._offset = sec;
    if (was && this.ready) this.startSources(sec);
    else this.playing = false;
    this.savePos();
    this.emit("state");
  }

  getPosition(): number {
    if (!this.playing || !this.ctx) return this._offset;
    const pos = this._offset + Math.max(0, this.ctx.currentTime - this._startCtx);
    if (this.duration && pos >= this.duration) {
      this.stopSources();
      this.playing = false;
      this._offset = 0;
      this.savePos();
      this.emit("state");
      return 0;
    }
    const now = performance.now();
    if (now - this._lastSave > 2000) {
      this._lastSave = now;
      if (this.track) localStorage.setItem(posKey(this.track.id), String(pos));
    }
    return pos;
  }

  private savePos() {
    if (this.track) localStorage.setItem(posKey(this.track.id), String(this._offset));
  }

  // ── controls ──
  setWet(x: number) {
    this.wet = Math.min(1, Math.max(0, x));
    localStorage.setItem(LS_WET, String(this.wet));
    if (this.nodes) this.applyWet(false);
    this.emit("wet");
  }

  setLevelMatch(on: boolean) {
    this.levelMatch = !!on;
    if (this.nodes) {
      this.nodes.lm.gain.setTargetAtTime(on ? db2lin(this.lmDb) : 1, this.ctx!.currentTime, 0.02);
    }
    this.emit("state");
  }

  setFx<K extends keyof FxState>(dev: K, patch: Partial<FxState[K]>) {
    Object.assign(this.fx[dev], patch);
    if (this.ctx) {
      this.ensureCtx();
      this.applyFx();
    }
    this.emit("fx");
  }

  // Load a real impulse-response file to replace the synthesised reverb. Pins
  // the convolver buffer so the decay knob no longer regenerates a synth IR.
  // Silently falls back to the synth IR if the fetch/decode fails.
  async loadReverbIR(url: string) {
    const c = this.ensureCtx();
    try {
      const buf = await this.fetchBuf(url, c);
      this.nodes!.conv.buffer = buf;
      this._reverbIRFile = true;
      this.emit("fx");
    } catch {
      /* keep the synth IR */
    }
  }

  // Revert reverb to the synthesised IR (re-enables the decay knob).
  useSynthReverbIR() {
    this._reverbIRFile = false;
    if (this.nodes) this.nodes.conv.buffer = this.makeReverbIR(this.fx.reverb.decay);
    this.emit("fx");
  }

  // Current gain reduction (dB, ≤ 0) being applied by the safety limiter — for a
  // "LIMIT" activity indicator. 0 when idle / no graph.
  getReduction(): number {
    return this.nodes ? this.nodes.limiter.reduction : 0;
  }

  // ── analysis ──
  private levelOf(analyser: AnalyserNode | undefined): Levels {
    if (!analyser) return { rms: -90, peak: -90 };
    analyser.getFloatTimeDomainData(this._tdBuf);
    let sum = 0,
      peak = 0;
    for (let i = 0; i < this._tdBuf.length; i++) {
      const s = this._tdBuf[i];
      sum += s * s;
      const a = Math.abs(s);
      if (a > peak) peak = a;
    }
    const rms = Math.sqrt(sum / this._tdBuf.length);
    return {
      rms: rms > 0 ? 20 * Math.log10(rms) : -90,
      peak: peak > 0 ? 20 * Math.log10(peak) : -90,
    };
  }

  getLevels(): LevelPair {
    if (!this.nodes) return { mix: { rms: -90, peak: -90 }, master: { rms: -90, peak: -90 } };
    return { mix: this.levelOf(this.nodes.anMix), master: this.levelOf(this.nodes.anMaster) };
  }

  getSpectrum(out: Uint8Array<ArrayBuffer>): boolean {
    if (!this.nodes) return false;
    this.nodes.anOut.getByteFrequencyData(out);
    return true;
  }

  getPeaks(bins: number): Float32Array | null {
    if (!this.buffers) return null;
    if (this._peaks && this._peaks.length === bins) return this._peaks;
    const buf = this.buffers.master;
    const ch0 = buf.getChannelData(0);
    const ch1 = buf.numberOfChannels > 1 ? buf.getChannelData(1) : ch0;
    const per = Math.floor(ch0.length / bins);
    const peaks = new Float32Array(bins);
    for (let b = 0; b < bins; b++) {
      let max = 0;
      const start = b * per;
      for (let i = start; i < start + per; i += 8) {
        const a = Math.abs((ch0[i] + ch1[i]) * 0.5);
        if (a > max) max = a;
      }
      peaks[b] = max;
    }
    this._peaks = peaks;
    return peaks;
  }

  // ── preset synth + sampler ──
  // `name` may be a sampled-preset id OR a JS-synth PATCHES key. Sampled
  // presets are primary; the matching PATCHES key is the per-preset fallback.
  setSynthPatch(name: string) {
    const preset = this.samplePresets.find((pr) => pr.id === name);
    if (preset) {
      this.samplePreset = preset.id;
      this.synthPatch = preset.fallbackPatch && PATCHES[preset.fallbackPatch] ? preset.fallbackPatch : this.synthPatch;
      void this.loadPreset(preset.id);
      this.emit("synth");
      return;
    }
    if (PATCHES[name]) {
      this.synthPatch = name;
      this.emit("synth");
    }
  }

  private currentPreset(): SampledPreset | undefined {
    return this.samplePresets.find((pr) => pr.id === this.samplePreset);
  }

  // Lazily fetch + decode every zone of a preset (mirrors fetchBuf). A zone that
  // fails to decode is stored as null so noteOn can fall back to the JS synth.
  async loadPreset(id: string) {
    if (this._sampleBufs[id] || this._presetLoading[id]) return;
    const preset = this.samplePresets.find((pr) => pr.id === id);
    if (!preset) return;
    this._presetLoading[id] = true;
    const c = this.ensureCtx();
    const bufs = await Promise.all(
      preset.zones.map(async (z) => {
        try {
          return await this.fetchBuf(z.url, c);
        } catch {
          return null; // not bounced yet → JS-synth fallback
        }
      }),
    );
    this._sampleBufs[id] = bufs;
    delete this._presetLoading[id];
    this.emit("preset");
  }

  // Resolve a preset's default piano-roll phrase: parse its bundled .mid if it
  // has one (cached), else use the hand-authored defaultPhrase. Also returns a
  // bpm hint (from the .mid tempo, or the preset's bpmHint). Never throws — a
  // bad/missing .mid falls back to the static phrase.
  async loadPresetPhrase(id: string): Promise<{ clip: NoteClip; bpm?: number } | null> {
    const preset = this.samplePresets.find((pr) => pr.id === id);
    if (!preset) return null;
    if (!preset.phraseUrl) return { clip: preset.defaultPhrase, bpm: preset.bpmHint };
    if (this._phraseCache[id]) return this._phraseCache[id];
    try {
      const res = await fetch(preset.phraseUrl);
      if (!res.ok) throw new Error("mid " + res.status);
      const parsed = parseMidi(await res.arrayBuffer());
      if (!parsed) throw new Error("mid parse");
      // use the .mid's tempo only if it actually carried one; otherwise fall back
      // to the preset's bpmHint (Ableton clip-export omits tempo).
      const out = { clip: parsed.clip, bpm: parsed.hasTempo ? parsed.bpm : preset.bpmHint };
      this._phraseCache[id] = out;
      return out;
    } catch {
      return { clip: preset.defaultPhrase, bpm: preset.bpmHint }; // graceful fallback
    }
  }

  // Max semitones a sample is pitch-shifted before the result sounds artificial.
  // With tritone-spaced multisampling (roots 6 apart) every in-range note lands
  // within ±3 of a root; this only bites notes played past the sampled extremes,
  // where we clamp the shift so the edge sample degrades gracefully (instead of
  // going silent or shifting absurdly far, e.g. a C0 against a C2-lowest preset).
  private static SHIFT_CAP = 7;

  // Pick the decoded zone whose [loMidi,hiMidi] contains `midi`, else the zone
  // with the nearest rootMidi (the conventional "minimize shift distance" rule
  // for densely-sampled instruments). Returns null if no zone decoded. The
  // returned rootMidi is the value to compute playbackRate against — clamped so
  // out-of-range notes never overshoot SHIFT_CAP.
  private pickZone(preset: SampledPreset, midi: number): { buf: AudioBuffer; rootMidi: number } | null {
    const bufs = this._sampleBufs[preset.id];
    if (!bufs) return null;
    let containing = -1;
    let nearest = -1;
    let nearestDist = Infinity;
    preset.zones.forEach((z, i) => {
      if (!bufs[i]) return;
      if (z.loMidi != null && z.hiMidi != null && midi >= z.loMidi && midi <= z.hiMidi) containing = i;
      const d = Math.abs(z.rootMidi - midi);
      if (d < nearestDist) {
        nearestDist = d;
        nearest = i;
      }
    });
    const idx = containing >= 0 ? containing : nearest;
    if (idx < 0 || !bufs[idx]) return null;
    const root = preset.zones[idx].rootMidi;
    // clamp the effective root so |midi - root| never exceeds the shift cap
    const cap = AudioEngine.SHIFT_CAP;
    const effRoot = midi > root + cap ? midi - cap : midi < root - cap ? midi + cap : root;
    return { buf: bufs[idx]!, rootMidi: effRoot };
  }

  // ── voice factory (shared by live keyboard + sequencer scheduler) ──
  // Build and start a voice at an explicit context time `when`. Returns a handle
  // the caller releases via releaseVoice(handle, when). Used directly by the
  // scheduler (which can play the same pitch repeatedly, so it can't key by MIDI);
  // noteOn/noteOff wrap this and key by MIDI for the held-key keyboard.
  startVoiceAt(midi: number, vel: number, when: number): VoiceHandle {
    const c = this.ensureCtx();
    const n = this.nodes!;
    const t = when;

    // ── sampled-preset path: bufferSource → voice gain (ADSR) → sum (FX rack) ──
    const preset = this.currentPreset();
    const zone = preset ? this.pickZone(preset, midi) : null;
    if (preset && zone) {
      const env = preset.env;
      const vg = c.createGain();
      vg.gain.value = 0;
      const src = c.createBufferSource();
      src.buffer = zone.buf;
      src.playbackRate.value = Math.pow(2, (midi - zone.rootMidi) / 12);
      // per-note micro-detune (opt-in per preset) — restores the subtle "alive"
      // variation a single bounce flattens. Prefer `detune` (cents); fall back to
      // a playbackRate nudge where detune is unsupported (older Safari).
      if (preset.humanize > 0) {
        const cents = (Math.random() * 2 - 1) * preset.humanize;
        if (src.detune) src.detune.value = cents;
        else src.playbackRate.value *= Math.pow(2, cents / 1200);
      }
      src.connect(vg);
      vg.connect(n.sum);
      const peak = preset.gain * vel;
      vg.gain.setValueAtTime(0, t);
      vg.gain.linearRampToValueAtTime(peak, t + Math.max(0.005, env.a));
      vg.gain.setTargetAtTime(peak * env.s, t + env.a, Math.max(0.03, env.d));
      src.start(t);
      return { kind: "sample", vg, r: env.r, src };
    }

    // ── JS-synth fallback path ──
    const p = PATCHES[this.synthPatch];
    const f = 440 * Math.pow(2, (midi + p.oct * 12 - 69) / 12);
    const vg = c.createGain();
    vg.gain.value = 0;
    const vf = c.createBiquadFilter();
    vf.type = "lowpass";
    vf.Q.value = p.q;
    vf.frequency.setValueAtTime(p.cut, t);
    vf.frequency.linearRampToValueAtTime(Math.min(18000, p.cut + p.envAmt), t + Math.max(0.01, p.a));
    vf.frequency.setTargetAtTime(p.cut + p.envAmt * Math.max(0.15, p.s) * 0.5, t + p.a, Math.max(0.05, p.d));
    const oscs = p.osc.map((cfg) => {
      const o = c.createOscillator();
      o.type = cfg[0];
      o.frequency.value = f;
      o.detune.value = cfg[1];
      o.connect(vf);
      o.start(t);
      return o;
    });
    vf.connect(vg);
    vg.connect(n.sum);
    const peak = p.vol * vel;
    vg.gain.setValueAtTime(0, t);
    vg.gain.linearRampToValueAtTime(peak, t + Math.max(0.005, p.a));
    vg.gain.setTargetAtTime(peak * p.s, t + p.a, Math.max(0.03, p.d));
    return { kind: "synth", vg, r: p.r, oscs, vf };
  }

  // Release a voice handle at an explicit time. `instant` skips the patch release.
  releaseVoice(h: VoiceHandle, when: number, instant?: boolean) {
    const c = this.ctx!;
    const t = when;
    const r = instant ? 0.03 : h.r;
    h.vg.gain.cancelScheduledValues(t);
    h.vg.gain.setValueAtTime(h.vg.gain.value, t);
    h.vg.gain.setTargetAtTime(0, t, Math.max(0.01, r / 4));
    const stopAt = t + r + 0.15;
    if (h.kind === "sample") {
      try {
        h.src.stop(stopAt);
      } catch {
        /* already stopped */
      }
    } else {
      h.oscs.forEach((o) => {
        try {
          o.stop(stopAt);
        } catch {
          /* already stopped */
        }
      });
    }
    const delayMs = (Math.max(0, stopAt - c.currentTime) + 0.1) * 1000;
    setTimeout(() => {
      try {
        h.vg.disconnect();
      } catch {
        /* fine */
      }
    }, delayMs);
  }

  // ── live keyboard (held notes keyed by MIDI; retrigger replaces) ──
  noteOn(midi: number, vel?: number) {
    vel = vel == null ? 1 : vel;
    this.ensureCtx();
    this.noteOff(midi, true);
    this._liveVoices[midi] = this.startVoiceAt(midi, vel, this.ctx!.currentTime);
    this.emit("synth");
  }

  noteOff(midi: number, instant?: boolean) {
    const h = this._liveVoices[midi];
    if (!h) return;
    delete this._liveVoices[midi];
    this.releaseVoice(h, this.ctx!.currentTime, instant);
    this.emit("synth");
  }

  activeNotes(): number[] {
    return Object.keys(this._liveVoices).map(Number);
  }

  // ── sequencer: lookahead scheduler ──
  // A setInterval clock walks ctx.currentTime and schedules note events slightly
  // ahead with sample-accurate start/stop times. rAF is NOT used for audio timing
  // (it pauses in background tabs and jitters) — only the visual playhead reads
  // getSequencePosition() from rAF.

  setActiveClip(clip: NoteClip | null) {
    this._clip = clip;
    this.emit("clip");
  }
  getClip(): NoteClip | null {
    return this._clip;
  }

  setBpm(bpm: number) {
    bpm = Math.min(220, Math.max(40, bpm));
    if (this.sequencePlaying && this.ctx) {
      // re-anchor at "now" so the playhead doesn't jump when tempo changes; keep
      // already-scheduled notes (they were placed at the old tempo) by advancing
      // the anchor to the current beat at the current time.
      const beat = this.currentBeat();
      const now = this.ctx.currentTime;
      this.bpm = bpm;
      this._seqAnchorBeat = beat;
      this._seqAnchorTime = now;
      // re-schedule from here at the new tempo
      this._scheduledThrough = now;
    } else {
      this.bpm = bpm;
    }
    // a tempo-synced delay must track the new tempo
    if (this.fx.space.sync && this.ctx) this.applyFx();
    this.emit("transport");
  }

  setLoop(on: boolean) {
    this.loopOn = on;
    this.emit("transport");
  }

  private beatDur() {
    return 60 / this.bpm;
  }

  // current beat position within the clip (loops), from the ctx clock
  private currentBeat(): number {
    if (!this.ctx || !this._clip) return 0;
    const elapsed = this.ctx.currentTime - this._seqAnchorTime;
    let beat = this._seqAnchorBeat + elapsed / this.beatDur();
    const total = clipBeats(this._clip);
    if (this.loopOn && total > 0) beat = ((beat % total) + total) % total;
    return beat;
  }

  // for the visual playhead (pure read — lint-safe in rAF)
  getSequencePosition(): { beat: number; bars: number; playing: boolean } {
    const clip = this._clip;
    return {
      beat: this.sequencePlaying ? this.currentBeat() : 0,
      bars: clip ? clip.bars : 0,
      playing: this.sequencePlaying,
    };
  }

  playSequence() {
    if (!this._clip) return;
    const c = this.ensureCtx();
    // transport mutual-exclusion: track playback and the sequencer can't both
    // drive the graph (double-sum + corrupt metering)
    if (this.playing) this.pause();
    this.transportMode = "sequence";
    this.sequencePlaying = true;
    const start = c.currentTime + 0.08; // small headroom before first note
    this._seqAnchorTime = start;
    this._seqAnchorBeat = 0;
    this._scheduledThrough = start;
    if (this._schedTimer) clearInterval(this._schedTimer);
    this._schedTimer = window.setInterval(() => this.schedTick(), AudioEngine.SCHED_INTERVAL);
    this.schedTick();
    this.emit("transport");
    this.emit("state");
  }

  stopSequence() {
    if (this._schedTimer) {
      clearInterval(this._schedTimer);
      this._schedTimer = 0;
    }
    this.sequencePlaying = false;
    this.transportMode = "track";
    // release any voices still ringing from scheduled notes
    const now = this.ctx ? this.ctx.currentTime : 0;
    this._seqVoices.forEach((h) => this.releaseVoice(h, now, true));
    this._seqVoices = [];
    this.emit("transport");
    this.emit("state");
  }

  toggleSequence() {
    if (this.sequencePlaying) this.stopSequence();
    else this.playSequence();
  }

  // schedule every note whose start lands in (_scheduledThrough, currentTime+AHEAD],
  // mapping clip beats onto absolute ctx times and wrapping at the loop boundary.
  private schedTick() {
    const c = this.ctx;
    const clip = this._clip;
    if (!c || !clip || !this.sequencePlaying) return;
    const total = clipBeats(clip);
    if (total <= 0) return;
    const bd = this.beatDur();
    const horizon = c.currentTime + AudioEngine.SCHED_AHEAD;

    // beat at the start of our scheduling window
    const fromBeatAbs = this._seqAnchorBeat + (this._scheduledThrough - this._seqAnchorTime) / bd;
    const toBeatAbs = this._seqAnchorBeat + (horizon - this._seqAnchorTime) / bd;

    // walk absolute beats; for each, find notes at that clip-beat (mod loop)
    for (const note of clip.notes) {
      // candidate absolute-beat positions of this note within the window
      // (loop can place it multiple times across passes)
      let k = Math.floor((fromBeatAbs - note.start) / total);
      if (!this.loopOn) k = 0;
      for (; ; k++) {
        const absBeat = note.start + (this.loopOn ? k * total : 0);
        if (absBeat >= toBeatAbs) break;
        if (absBeat < fromBeatAbs) {
          if (!this.loopOn) break;
          continue;
        }
        const when = this._seqAnchorTime + (absBeat - this._seqAnchorBeat) * bd;
        const off = when + Math.max(0.04, note.length * bd);
        const h = this.startVoiceAt(note.pitch, note.vel, when);
        this.releaseVoice(h, off);
        this._seqVoices.push(h);
        if (!this.loopOn) break;
      }
    }
    // prune released handles occasionally to bound memory
    if (this._seqVoices.length > 256) this._seqVoices = this._seqVoices.slice(-128);
    this._scheduledThrough = horizon;
  }
}

export const engine = new AudioEngine();
