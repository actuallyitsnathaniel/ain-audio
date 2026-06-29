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
import { clipBeats, type MidiChannel, type NoteClip } from "./data/clips";
import { parseMidi } from "./data/midi-file";
import { DEFAULT_KIT, defaultSequence, LOOPS, parseLoopMeta, resizeRow, STEP_COUNTS, type DrumKit, type DrumSynth, type LoopLane, type SequenceClip } from "./data/kits";

export type TransportMode = "track" | "sequence";

const STEP_BEATS = 0.25; // one drum step = a 1/16 note

type EngineEvent = "state" | "wet" | "fx" | "track" | "ready" | "synth" | "preset" | "transport" | "clip" | "midi";

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
type VoiceHandle = (
  | { kind: "synth"; vg: GainNode; r: number; oscs: OscillatorNode[]; vf: BiquadFilterNode }
  | { kind: "sample"; vg: GainNode; r: number; src: AudioBufferSourceNode }
) & { lfo?: OscillatorNode }; // vibrato LFO, stopped with the voice

// A resolved voice selection — which preset (if sampled) and which JS-synth patch
// to fall back to. The live keyboard + Audio-Lab roll resolve this from global
// state; beatmaker MIDI channels resolve it per-channel so each channel sounds
// its own instrument.
interface VoiceSel {
  preset?: SampledPreset;
  patch: string; // PATCHES key
  dest?: AudioNode; // where the voice connects (a channel's gain node); default n.sum
}

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
  // current reverb IR for the UI selector: "synth" or a loaded IR url
  reverbIR = "synth";

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

  // ── beat-maker (drum step sequencer; shares the clock above) ──
  // beatMode switches the scheduler between the piano-roll note clip and the
  // drum sequence clip. Only one plays at a time.
  beatMode = false;
  kit: DrumKit = DEFAULT_KIT;
  sequence: SequenceClip = defaultSequence(DEFAULT_KIT);
  loops: LoopLane[] = LOOPS;
  private _drumBufs: Record<string, AudioBuffer | null> = {}; // laneId → decoded one-shot (null = use synth)
  private _loopBufs: Record<string, AudioBuffer> = {}; // loopId → decoded buffer
  private _loopPeaks: Record<string, Float32Array> = {}; // loopId → cached waveform peaks
  private _loopNodes: Record<string, { src: AudioBufferSourceNode; gain: GainNode; startCtx: number; startOff: number }> = {}; // live looping voices
  private _chNodes: Record<string, { gain: GainNode; pan: StereoPannerNode }> = {}; // per-channel vol/pan strip

  private _startCtx = 0;
  private _offset = 0;
  private _peaks: Float32Array | null = null;
  private _srcs: AudioBufferSourceNode[] | null = null;
  private _liveVoices: Record<string, VoiceHandle> = {}; // key = "<channelId|_>:<midi>"
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

  // ── Section index ───────────────────────────────────────────────────────
  // This file is one file on purpose: a singleton owning one AudioContext +
  // one signal graph reads best top-to-bottom. Jump by searching a banner:
  //   "── pub/sub"                  event bus (on/off/emit)
  //   "── track loading"           build graph, fetch/decode buffers
  //   "── transport"               play/pause/seek/getPosition (phase-locked)
  //   "── controls"                wet, level-match, reverb-IR source
  //   "── analysis"                meters, spectrum, waveform peaks
  //   "── preset synth + sampler"  patch selection + sampled-preset zones
  //   "── voice factory"           startVoiceAt/releaseVoice (kbd + scheduler)
  //   "── live keyboard"           held notes by MIDI
  //   "── beat-maker"              drum kit, synth drums, loopable lanes
  //   "── sequencer: lookahead"    the clock that schedules notes/drums
  // Graph build + reorderable FX live above the constructor (buildGraph,
  // rewireChain, applyFx); debug() at the bottom dumps live state.
  // ─────────────────────────────────────────────────────────────────────────

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

  // ponytail: unused — wired by the reverb IR-file selector (see AUDIO.md "not yet wired")
  // Load a real impulse-response file to replace the synthesised reverb. Pins
  // the convolver buffer so the decay knob no longer regenerates a synth IR.
  // Silently falls back to the synth IR if the fetch/decode fails.
  async loadReverbIR(url: string) {
    const c = this.ensureCtx();
    try {
      const buf = await this.fetchBuf(url, c);
      this.nodes!.conv.buffer = buf;
      this._reverbIRFile = true;
      this.reverbIR = url;
      this.emit("fx");
    } catch {
      /* keep the synth IR */
    }
  }

  // ponytail: unused — partner of loadReverbIR, wired by the same IR selector
  // Revert reverb to the synthesised IR (re-enables the decay knob).
  useSynthReverbIR() {
    this._reverbIRFile = false;
    this.reverbIR = "synth";
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
  // `slide` (portamento): glide pitch FROM `slide.from` (MIDI) into `midi` over
  // `slide.durSec`, using native AudioParam ramps on the voice's pitch param.
  // `vib` (vibrato): a sine LFO (rate Hz) → gain (depth cents) → the voice's detune.
  startVoiceAt(
    midi: number,
    vel: number,
    when: number,
    sel?: VoiceSel,
    slide?: { from: number; durSec: number },
    vib?: { rate: number; depth: number },
  ): VoiceHandle {
    const c = this.ensureCtx();
    const n = this.nodes!;
    const t = when;
    const glideEnd = slide ? t + Math.max(0.01, slide.durSec) : t;
    // build a vibrato LFO feeding the given detune params; returns the LFO osc
    const addVibrato = (targets: AudioParam[]): OscillatorNode | undefined => {
      if (!vib || vib.depth <= 0) return undefined;
      const lfo = c.createOscillator();
      lfo.type = "sine";
      lfo.frequency.value = vib.rate;
      const depth = c.createGain();
      depth.gain.value = vib.depth; // cents
      lfo.connect(depth);
      targets.forEach((p) => depth.connect(p));
      lfo.start(t);
      return lfo;
    };

    // resolve which instrument to voice: an explicit per-channel selection, or
    // the global live-keyboard/Audio-Lab selection when none is passed.
    const preset = sel ? sel.preset : this.currentPreset();
    const patchKey = sel ? sel.patch : this.synthPatch;
    const dest = sel?.dest ?? n.sum; // channel gain node, or straight to the FX rack

    // ── sampled-preset path: bufferSource → voice gain (ADSR) → sum (FX rack) ──
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
      // portamento: detune (cents) glides from the source pitch to the target
      if (slide && src.detune) {
        const base = src.detune.value; // humanize offset (0 if none)
        const off = (slide.from - midi) * 100;
        src.detune.setValueAtTime(base + off, t);
        src.detune.linearRampToValueAtTime(base, glideEnd);
      } else if (slide) {
        // detune unsupported → glide playbackRate instead
        const fromRate = Math.pow(2, (slide.from - zone.rootMidi) / 12);
        const toRate = src.playbackRate.value;
        src.playbackRate.setValueAtTime(fromRate, t);
        src.playbackRate.linearRampToValueAtTime(toRate, glideEnd);
      }
      src.connect(vg);
      vg.connect(dest);
      const peak = preset.gain * vel;
      vg.gain.setValueAtTime(0, t);
      vg.gain.linearRampToValueAtTime(peak, t + Math.max(0.005, env.a));
      vg.gain.setTargetAtTime(peak * env.s, t + env.a, Math.max(0.03, env.d));
      src.start(t);
      const lfo = src.detune ? addVibrato([src.detune]) : undefined;
      return { kind: "sample", vg, r: env.r, src, lfo };
    }

    // ── JS-synth fallback path ──
    const p = PATCHES[patchKey] || PATCHES[this.synthPatch];
    const f = 440 * Math.pow(2, (midi + p.oct * 12 - 69) / 12);
    const vg = c.createGain();
    vg.gain.value = 0;
    const vf = c.createBiquadFilter();
    vf.type = "lowpass";
    vf.Q.value = p.q;
    vf.frequency.setValueAtTime(p.cut, t);
    vf.frequency.linearRampToValueAtTime(Math.min(18000, p.cut + p.envAmt), t + Math.max(0.01, p.a));
    vf.frequency.setTargetAtTime(p.cut + p.envAmt * Math.max(0.15, p.s) * 0.5, t + p.a, Math.max(0.05, p.d));
    const fromF = slide ? 440 * Math.pow(2, (slide.from + p.oct * 12 - 69) / 12) : f;
    const oscs = p.osc.map((cfg) => {
      const o = c.createOscillator();
      o.type = cfg[0];
      o.frequency.value = f;
      o.detune.value = cfg[1];
      // portamento: glide frequency from the source pitch up/down to the target
      if (slide) {
        o.frequency.setValueAtTime(fromF, t);
        o.frequency.linearRampToValueAtTime(f, glideEnd);
      }
      o.connect(vf);
      o.start(t);
      return o;
    });
    vf.connect(vg);
    vg.connect(dest);
    const peak = p.vol * vel;
    vg.gain.setValueAtTime(0, t);
    vg.gain.linearRampToValueAtTime(peak, t + Math.max(0.005, p.a));
    vg.gain.setTargetAtTime(peak * p.s, t + p.a, Math.max(0.03, p.d));
    const lfo = addVibrato(oscs.map((o) => o.detune));
    return { kind: "synth", vg, r: p.r, oscs, vf, lfo };
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
    if (h.lfo) {
      try {
        h.lfo.stop(stopAt); // stop the vibrato LFO with the voice
      } catch {
        /* already stopped */
      }
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

  // ── Web MIDI (lazy: we DON'T request access on load — the browser permission
  // prompt only fires when the user first opts in, e.g. arming a channel) ──
  // status: "idle" (never asked) | "unsupported" | "denied" | "no device" | "N device(s)"
  midiStatus = "idle";
  private _midiAccess: MIDIAccess | null = null;

  // Request Web MIDI access and wire every input to the live keyboard. Idempotent:
  // safe to call repeatedly; once granted it just re-wires. Returns true if access
  // is (or becomes) granted. Triggers the browser permission prompt on first call.
  async enableMidi(): Promise<boolean> {
    if (!navigator.requestMIDIAccess) {
      this.midiStatus = "unsupported";
      this.emit("midi");
      return false;
    }
    const wire = () => {
      let count = 0;
      this._midiAccess!.inputs.forEach((inp) => {
        count++;
        inp.onmidimessage = (msg: MIDIMessageEvent) => {
          if (!msg.data) return;
          const st = msg.data[0] & 0xf0;
          const note = msg.data[1];
          const vel = msg.data[2];
          if (st === 144 && vel > 0) this.noteOn(note, vel / 127);
          else if (st === 128 || (st === 144 && vel === 0)) this.noteOff(note);
        };
      });
      this.midiStatus = count ? count + " device" + (count > 1 ? "s" : "") : "no device";
      this.emit("midi");
    };
    if (this._midiAccess) {
      wire();
      return true;
    }
    try {
      this._midiAccess = await navigator.requestMIDIAccess();
      this._midiAccess.onstatechange = wire;
      wire();
      return true;
    } catch {
      this.midiStatus = "denied";
      this.emit("midi");
      return false;
    }
  }

  // ── live keyboard (held notes keyed by channel:midi; retrigger replaces) ──
  // `channelId` selects a beat-maker MIDI channel's instrument for the audition;
  // omitted ⇒ the global Audio-Lab/keyboard voice. Voices are keyed per channel so
  // tapping a channel's keys plays THAT channel's sound and doesn't collide with
  // the global keyboard or other channels.
  private liveKey(midi: number, channelId?: string) {
    return (channelId ?? "_") + ":" + midi;
  }
  noteOn(midi: number, vel?: number, channelId?: string) {
    vel = vel == null ? 1 : vel;
    this.ensureCtx();
    // no explicit channel ⇒ the global keyboard, which follows the armed channel
    const cid = channelId ?? this.armedChannel ?? undefined;
    this.noteOff(midi, true, cid);
    const ch = cid ? this.sequence.channels.find((c) => c.id === cid) : undefined;
    const sel = ch ? this.channelVoice(ch) : undefined;
    this._liveVoices[this.liveKey(midi, cid)] = this.startVoiceAt(midi, vel, this.ctx!.currentTime, sel);
    this.emit("synth");
  }

  noteOff(midi: number, instant?: boolean, channelId?: string) {
    const cid = channelId ?? this.armedChannel ?? undefined;
    const key = this.liveKey(midi, cid);
    // fall back to the global slot in case the note was pressed before arming
    const h = this._liveVoices[key] ?? this._liveVoices[this.liveKey(midi, undefined)];
    if (!h) return;
    delete this._liveVoices[key];
    delete this._liveVoices[this.liveKey(midi, undefined)];
    this.releaseVoice(h, this.ctx!.currentTime, instant);
    this.emit("synth");
  }

  // held pitches, optionally scoped to one channel (for that grid's key glow)
  activeNotes(channelId?: string): number[] {
    const prefix = (channelId ?? "_") + ":";
    return Object.keys(this._liveVoices)
      .filter((k) => k.startsWith(prefix))
      .map((k) => Number(k.slice(prefix.length)));
  }

  // ── beat-maker: drum kit + voices ──
  // Switch the active drum kit. Lanes with ids already in the sequence keep their
  // steps/accents; any new lane ids get empty arrays so the grid + toggleStep have
  // somewhere to write. We don't rebuild the whole sequence — that would wipe the
  // user's groove.
  setKit(kit: DrumKit) {
    this.kit = kit;
    this._drumBufs = {};
    const blank = () => new Array(this.sequence.steps).fill(false);
    this.sequence.laneMix = this.sequence.laneMix || {};
    for (const l of kit.lanes) {
      if (!this.sequence.on[l.id]) this.sequence.on[l.id] = blank();
      if (!this.sequence.accent[l.id]) this.sequence.accent[l.id] = blank();
      if (!this.sequence.laneMix[l.id]) this.sequence.laneMix[l.id] = { mute: false, solo: false };
    }
    void this.loadKit(kit);
    this.emit("transport");
    this.emit("clip");
  }

  // lazily fetch + decode each lane's one-shot (lanes without a url stay synth)
  async loadKit(kit: DrumKit) {
    const c = this.ensureCtx();
    await Promise.all(
      kit.lanes.map(async (l) => {
        if (!l.url || this._drumBufs[l.id] !== undefined) return;
        try {
          this._drumBufs[l.id] = await this.fetchBuf(l.url, c);
        } catch {
          this._drumBufs[l.id] = null; // fall back to synth
        }
      }),
    );
    this.emit("transport");
  }

  // Replace the whole step-sequence (used by save/load patterns). Emits clip so
  // the grid re-renders. Callers should pass a copy they own (loads clone first).
  setSequence(seq: SequenceClip) {
    seq.channels = seq.channels || []; // tolerate patterns saved before channels existed
    // drop vol/pan strips for channels that no longer exist (avoid node leaks)
    const live = new Set(seq.channels.map((c) => c.id));
    for (const id in this._chNodes) {
      if (!live.has(id)) {
        try {
          this._chNodes[id].gain.disconnect();
          this._chNodes[id].pan.disconnect();
        } catch {
          /* fine */
        }
        delete this._chNodes[id];
      }
    }
    this.sequence = seq;
    // warm the instruments any restored channels need
    for (const ch of seq.channels) {
      if (this.samplePresets.some((pr) => pr.id === ch.presetId)) void this.loadPreset(ch.presetId);
    }
    if (this.armedChannel && !live.has(this.armedChannel)) this.armedChannel = null;
    this.emit("clip");
  }

  // Grow/shrink the step grid (16/32/48/64), preserving existing steps. Resizes
  // every lane's on/accent row. If playing, re-anchor at "now" so the playhead
  // doesn't jump and the new length loops cleanly (mirrors setBpm's re-anchor).
  setStepCount(n: number) {
    n = STEP_COUNTS.includes(n as (typeof STEP_COUNTS)[number]) ? n : 16;
    const seq = this.sequence;
    if (seq.steps === n) return;
    for (const id in seq.on) seq.on[id] = resizeRow(seq.on[id], n);
    for (const id in seq.accent) seq.accent[id] = resizeRow(seq.accent[id], n);
    seq.steps = n;
    if (this.sequencePlaying && this.ctx) {
      this._seqAnchorBeat = this.currentBeat();
      this._seqAnchorTime = this.ctx.currentTime;
      this._scheduledThrough = this.ctx.currentTime;
    }
    this.emit("clip");
  }

  // ── beat-maker: melodic MIDI channels ──
  // Each channel is its own instrument + note clip, scheduled on the same clock as
  // the drums. MAX_CHANNELS is the hard ceiling that keeps a dense pattern from
  // spawning unbounded voices; SOFT_CHANNELS is where the UI warns weaker machines.
  static SOFT_CHANNELS = 4;
  static MAX_CHANNELS = 8;
  private _chSeq = 0; // monotonic id counter
  armedChannel: string | null = null; // which channel the keyboard/MIDI plays into

  // Arm a channel for keyboard input (one at a time; null = the global Audio-Lab
  // voice). Toggling the armed channel off reverts to the global voice.
  armChannel(id: string | null) {
    this.armedChannel = id && this.sequence.channels.some((c) => c.id === id) ? id : null;
    this.emit("clip");
  }

  // lazily build a channel's vol→pan strip (gain → StereoPanner → n.sum). Persists
  // for the channel's lifetime; removeChannel tears it down. Returns the gain input
  // that voices connect to.
  private channelStrip(ch: MidiChannel): GainNode {
    const c = this.ensureCtx();
    const n = this.nodes!;
    let s = this._chNodes[ch.id];
    if (!s) {
      const gain = c.createGain();
      const pan = c.createStereoPanner();
      gain.connect(pan);
      pan.connect(n.sum);
      s = this._chNodes[ch.id] = { gain, pan };
    }
    s.gain.gain.value = (ch.vol ?? 0.8) * this.channelGain(ch); // fold in mute/solo
    s.pan.pan.value = ch.pan ?? 0;
    return s.gain;
  }

  // resolve a channel's instrument to a VoiceSel for the voice factory
  private channelVoice(ch: MidiChannel): VoiceSel {
    const preset = this.samplePresets.find((pr) => pr.id === ch.presetId);
    const patch = PATCHES[ch.presetId] ? ch.presetId : preset?.fallbackPatch && PATCHES[preset.fallbackPatch] ? preset.fallbackPatch : this.synthPatch;
    return { preset, patch, dest: this.channelStrip(ch) };
  }
  // Solo is GLOBAL across the beatmaker: soloing any element (drum lane, loop, or
  // MIDI channel) silences everything not soloed, across all three groups.
  private anyBeatSolo(): boolean {
    const mix = this.sequence.laneMix || {};
    if (Object.values(mix).some((m) => m.solo)) return true;
    if (Object.values(this.sequence.loops).some((s) => s.solo && s.on)) return true;
    return this.sequence.channels.some((c) => c.solo);
  }
  // 1 normally; 0 if this channel is muted, or a global solo is up and this isn't soloed
  private channelGain(ch: MidiChannel): number {
    if (ch.mute) return 0;
    return this.anyBeatSolo() && !ch.solo ? 0 : 1;
  }

  addChannel(): MidiChannel | null {
    const chans = this.sequence.channels;
    if (chans.length >= AudioEngine.MAX_CHANNELS) return null;
    const presetId = this.samplePresets[0]?.id || Object.keys(PATCHES)[0];
    const ch: MidiChannel = {
      id: "ch" + ++this._chSeq + Date.now().toString(36),
      name: "channel " + (chans.length + 1),
      presetId,
      clip: { bars: Math.max(1, Math.ceil(this.sequence.steps / 16)), beatsPerBar: 4, notes: [] },
      mute: false,
      solo: false,
      loop: true,
      vol: 0.8,
      pan: 0,
    };
    chans.push(ch);
    void this.loadPreset(presetId);
    this.emit("clip");
    return ch;
  }
  removeChannel(id: string) {
    this.sequence.channels = this.sequence.channels.filter((c) => c.id !== id);
    if (this.armedChannel === id) this.armedChannel = null;
    const s = this._chNodes[id]; // tear down its vol/pan strip
    if (s) {
      try {
        s.gain.disconnect();
        s.pan.disconnect();
      } catch {
        /* fine */
      }
      delete this._chNodes[id];
    }
    this.emit("clip");
  }
  setChannelPreset(id: string, presetId: string) {
    const ch = this.sequence.channels.find((c) => c.id === id);
    if (!ch) return;
    ch.presetId = presetId;
    if (this.samplePresets.some((pr) => pr.id === presetId)) void this.loadPreset(presetId);
    this.emit("clip");
  }
  setChannelClip(id: string, clip: NoteClip) {
    const ch = this.sequence.channels.find((c) => c.id === id);
    if (!ch) return;
    ch.clip = clip;
    this.emit("clip");
  }
  getChannelClip(id: string): NoteClip | null {
    return this.sequence.channels.find((c) => c.id === id)?.clip || null;
  }
  toggleChannelMute(id: string) {
    const ch = this.sequence.channels.find((c) => c.id === id);
    if (ch) ch.mute = !ch.mute;
    this.refreshChannelGains();
    this.emit("clip");
  }
  toggleChannelSolo(id: string) {
    const ch = this.sequence.channels.find((c) => c.id === id);
    if (ch) ch.solo = !ch.solo;
    this.refreshBeatGains(); // global solo → refresh loops + channels
    this.emit("clip");
  }
  // push vol×(mute/solo) to every live channel strip (solo is global, so one
  // toggle can change every channel's effective gain)
  private refreshChannelGains() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (const ch of this.sequence.channels) {
      const s = this._chNodes[ch.id];
      if (s) s.gain.gain.setTargetAtTime((ch.vol ?? 0.8) * this.channelGain(ch), t, 0.02);
    }
  }
  // Solo is global, so any solo/mute toggle in any group must re-push live gains
  // for the groups that hold persistent nodes (loops + channels). Drums re-read
  // drumGain per scheduled hit, so they need no live refresh.
  private refreshBeatGains() {
    this.refreshLoopGains();
    this.refreshChannelGains();
  }
  renameChannel(id: string, name: string) {
    const ch = this.sequence.channels.find((c) => c.id === id);
    if (ch) ch.name = name;
    this.emit("clip");
  }
  setChannelVol(id: string, vol: number) {
    const ch = this.sequence.channels.find((c) => c.id === id);
    if (!ch) return;
    ch.vol = Math.min(1, Math.max(0, vol));
    const s = this._chNodes[id];
    if (s && this.ctx) s.gain.gain.setTargetAtTime(ch.vol * this.channelGain(ch), this.ctx.currentTime, 0.02);
    this.emit("clip");
  }
  setChannelPan(id: string, pan: number) {
    const ch = this.sequence.channels.find((c) => c.id === id);
    if (!ch) return;
    ch.pan = Math.min(1, Math.max(-1, pan));
    const s = this._chNodes[id];
    if (s && this.ctx) s.pan.pan.setTargetAtTime(ch.pan, this.ctx.currentTime, 0.02);
    this.emit("clip");
  }
  toggleChannelLoop(id: string) {
    const ch = this.sequence.channels.find((c) => c.id === id);
    if (ch) ch.loop = !ch.loop;
    this.emit("clip");
  }
  // set a channel's loop length in bars (independent of the drum grid). Notes keep
  // their positions; the scheduler wraps at the new length. Clamped to 1..16 bars.
  setChannelLength(id: string, bars: number) {
    const ch = this.sequence.channels.find((c) => c.id === id);
    if (!ch) return;
    ch.clip.bars = Math.min(16, Math.max(1, Math.round(bars)));
    this.emit("clip");
  }
  toggleChannelCollapsed(id: string) {
    const ch = this.sequence.channels.find((c) => c.id === id);
    if (ch) ch.collapsed = !ch.collapsed;
    this.emit("clip");
  }
  // current beat position WITHIN a channel's own loop (for its playback marker),
  // or -1 when not playing. Honors the channel's independent loop length.
  channelPosition(id: string): number {
    const ch = this.sequence.channels.find((c) => c.id === id);
    if (!ch || !this.sequencePlaying || !this.beatMode) return -1;
    const span = ch.loop ? clipBeats(ch.clip) : this.activeTotalBeats();
    if (span <= 0) return -1;
    return ((this.currentBeat() % span) + span) % span;
  }

  // trigger one drum lane at an explicit time: decoded sample if present, else a
  // synthesized hit. Routes to n.sum so it shares the FX rack. `accent` boosts level.
  triggerDrum(laneId: string, when: number, accent = false) {
    const c = this.ensureCtx();
    const n = this.nodes!;
    const lane = this.kit.lanes.find((l) => l.id === laneId);
    if (!lane) return;
    const vel = (accent ? 1 : 0.7) * this.drumGain(laneId); // mute/solo → 0 = silent
    if (vel <= 0) return; // muted or solo'd-out — skip the voice entirely
    const buf = this._drumBufs[laneId];
    if (buf) {
      const g = c.createGain();
      g.gain.value = vel;
      const src = c.createBufferSource();
      src.buffer = buf;
      src.connect(g);
      g.connect(n.sum);
      src.start(when);
      src.onended = () => {
        try {
          g.disconnect();
        } catch {
          /* fine */
        }
      };
    } else {
      this.synthDrum(lane.synth, when, vel);
    }
  }

  // ── drum lane mute/solo (solo is global across the beatmaker — see anyBeatSolo) ──
  // 1 normally; 0 if this lane is muted, or a global solo is up and this isn't soloed.
  private drumGain(laneId: string): number {
    const mix = this.sequence.laneMix || {};
    const st = mix[laneId];
    if (st?.mute) return 0;
    if (this.anyBeatSolo() && !st?.solo) return 0;
    return 1;
  }
  toggleDrumMute(laneId: string) {
    const mix = (this.sequence.laneMix = this.sequence.laneMix || {});
    const st = (mix[laneId] = mix[laneId] || { mute: false, solo: false });
    st.mute = !st.mute;
    this.emit("clip");
  }
  toggleDrumSolo(laneId: string) {
    const mix = (this.sequence.laneMix = this.sequence.laneMix || {});
    const st = (mix[laneId] = mix[laneId] || { mute: false, solo: false });
    st.solo = !st.solo;
    this.refreshBeatGains(); // global solo → silence loops + channels too
    this.emit("clip");
  }

  // ── synthesized drum voices (Web Audio, when no sample is bounced) ──
  private synthDrum(kind: DrumSynth, t: number, vel: number) {
    const c = this.ctx!;
    const n = this.nodes!;
    const out = c.createGain();
    out.gain.value = 1;
    out.connect(n.sum);
    const env = (g: GainNode, peak: number, dec: number) => {
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(peak, t + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dec);
    };
    const noiseBuf = (dur: number) => {
      const len = Math.floor(c.sampleRate * dur);
      const b = c.createBuffer(1, len, c.sampleRate);
      const d = b.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      return b;
    };
    const stop = (node: AudioScheduledSourceNode, at: number) => {
      try {
        node.stop(at);
      } catch {
        /* fine */
      }
      node.onended = () => {
        try {
          out.disconnect();
        } catch {
          /* fine */
        }
      };
    };

    if (kind === "kick") {
      const o = c.createOscillator();
      const g = c.createGain();
      o.frequency.setValueAtTime(150, t);
      o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
      env(g, 0.9 * vel, 0.32);
      o.connect(g);
      g.connect(out);
      o.start(t);
      stop(o, t + 0.34);
    } else if (kind === "snare") {
      const ns = c.createBufferSource();
      ns.buffer = noiseBuf(0.25);
      const hp = c.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 1400;
      const g = c.createGain();
      env(g, 0.55 * vel, 0.2);
      ns.connect(hp);
      hp.connect(g);
      g.connect(out);
      // body tone
      const o = c.createOscillator();
      o.type = "triangle";
      o.frequency.value = 180;
      const og = c.createGain();
      env(og, 0.3 * vel, 0.12);
      o.connect(og);
      og.connect(out);
      ns.start(t);
      o.start(t);
      stop(ns, t + 0.26);
      stop(o, t + 0.14);
    } else if (kind === "hat") {
      const ns = c.createBufferSource();
      ns.buffer = noiseBuf(0.08);
      const hp = c.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 7000;
      const g = c.createGain();
      env(g, 0.4 * vel, 0.05);
      ns.connect(hp);
      hp.connect(g);
      g.connect(out);
      ns.start(t);
      stop(ns, t + 0.09);
    } else if (kind === "clap") {
      // three quick noise bursts
      [0, 0.012, 0.024].forEach((off, i) => {
        const ns = c.createBufferSource();
        ns.buffer = noiseBuf(0.12);
        const bp = c.createBiquadFilter();
        bp.type = "bandpass";
        bp.frequency.value = 1200;
        bp.Q.value = 0.7;
        const g = c.createGain();
        const peak = (i === 2 ? 0.5 : 0.35) * vel;
        g.gain.setValueAtTime(0, t + off);
        g.gain.linearRampToValueAtTime(peak, t + off + 0.001);
        g.gain.exponentialRampToValueAtTime(0.0001, t + off + (i === 2 ? 0.18 : 0.05));
        ns.connect(bp);
        bp.connect(g);
        g.connect(out);
        ns.start(t + off);
        stop(ns, t + off + 0.2);
      });
    } else if (kind === "tom") {
      const o = c.createOscillator();
      const g = c.createGain();
      o.frequency.setValueAtTime(220, t);
      o.frequency.exponentialRampToValueAtTime(90, t + 0.18);
      env(g, 0.7 * vel, 0.3);
      o.connect(g);
      g.connect(out);
      o.start(t);
      stop(o, t + 0.32);
    } else {
      // rim — short bright click
      const o = c.createOscillator();
      o.type = "square";
      o.frequency.value = 1700;
      const g = c.createGain();
      env(g, 0.35 * vel, 0.04);
      o.connect(g);
      g.connect(out);
      o.start(t);
      stop(o, t + 0.05);
    }
  }

  // ── beat-maker: loopable melodic-sample lanes ──
  async loadLoops() {
    const c = this.ensureCtx();
    await Promise.all(
      this.loops.map(async (l) => {
        if (this._loopBufs[l.id]) return;
        try {
          this._loopBufs[l.id] = await this.fetchBuf(l.url, c);
        } catch {
          /* skip — undecodable loop just won't play */
        }
      }),
    );
    this.emit("clip");
  }

  // Add a user-dropped audio file as a session loop lane: decode it in-browser,
  // register the lane + its already-decoded buffer + mixer state, and switch it
  // on. Mirrors what LOOPS + defaultSequence produce, but for an in-memory buffer
  // (no url fetch). rootBpm/bars come from the filename (…-120bpm-2bar…) if present,
  // else default to the current grid tempo so it plays at unity rate. Returns the
  // new loop id, or null if the file couldn't be decoded.
  async addLoop(file: File): Promise<string | null> {
    const c = this.ensureCtx();
    let buf: AudioBuffer;
    try {
      buf = await c.decodeAudioData(await file.arrayBuffer());
    } catch {
      return null; // not decodable audio
    }
    const stem = file.name.replace(/\.[^.]+$/, "");
    const meta = parseLoopMeta(stem);
    let id = (meta.name || "loop").toLowerCase().replace(/\s+/g, "-");
    while (this.sequence.loops[id]) id += "-2"; // de-dupe against existing ids
    const lane: LoopLane = {
      id,
      name: meta.name || id,
      url: "", // in-memory: buffer is pre-stored, never fetched
      rootBpm: meta.bpm ?? Math.round(this.sequence.bpm), // detected, else current grid tempo
      rootKnown: meta.bpm != null, // detected from filename ⇒ real; else a guess (lock re-bases)
      bars: meta.bars ?? 1,
      key: meta.key,
    };
    this._loopBufs[id] = buf;
    this.loops = [...this.loops, lane];
    this.sequence.loops[id] = { on: true, level: 0.8, mute: false, solo: false };
    this.refreshLoopGains(); // start it if a beat is already playing
    this.emit("clip");
    return id;
  }

  // Remove a loop lane (reverses addLoop): stop any live voice, drop its buffer,
  // lane, and mixer state. Build-time loops return on reload (re-discovered from
  // disk); session-imported loops are gone for good.
  removeLoop(id: string) {
    this.stopOneLoop(id);
    this.loops = this.loops.filter((l) => l.id !== id);
    delete this._loopBufs[id];
    delete this.sequence.loops[id];
    this.refreshLoopGains(); // re-evaluate solo state for the remaining loops
    this.emit("clip");
  }

  // effective gain for a loop: 0 if muted, off, or solo'd-out by a global solo.
  private loopGain(id: string): number {
    const st = this.sequence.loops[id];
    if (!st || !st.on || st.mute) return 0;
    if (this.anyBeatSolo() && !st.solo) return 0;
    return st.level;
  }

  // playbackRate for a loop: locked -> tempo-match the grid (pitch follows); else
  // play at original recorded speed (1) so changing BPM doesn't touch it.
  private loopRate(l: LoopLane): number {
    return this.sequence.loops[l.id]?.sync ? this.bpm / l.rootBpm : 1;
  }

  // Apply a loop's A→B region to a source. Region is stored as 0..1 fractions of
  // the buffer; loopStart/loopEnd are in BUFFER seconds (independent of
  // playbackRate), so a region survives tempo/sync changes. Returns the buffer
  // offset to start playback at (A) so the slice begins at its head.
  private applyLoopRegion(src: AudioBufferSourceNode, id: string): number {
    const dur = src.buffer!.duration;
    const st = this.sequence.loops[id];
    const a = Math.min(0.999, Math.max(0, st?.a ?? 0));
    const b = Math.max(a + 0.001, Math.min(1, st?.b ?? 1));
    src.loop = true;
    src.loopStart = a * dur;
    src.loopEnd = b * dur;
    return a * dur;
  }

  // start every "on" loop as a sustained looped source, aligned so its loop
  // boundary lands on the sequence's bar grid. playbackRate matches tempo.
  private startLoops(when: number) {
    const c = this.ctx!;
    const n = this.nodes!;
    this.stopLoops();
    for (const l of this.loops) {
      const buf = this._loopBufs[l.id];
      const st = this.sequence.loops[l.id];
      if (!buf || !st?.on) continue;
      const gain = c.createGain();
      gain.gain.value = this.loopGain(l.id);
      const src = c.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = this.loopRate(l); // grid-locked or original speed
      const offset = this.applyLoopRegion(src, l.id);
      src.connect(gain);
      gain.connect(n.sum);
      src.start(when, offset);
      this._loopNodes[l.id] = { src, gain, startCtx: when, startOff: offset };
    }
  }

  private stopLoops() {
    const now = this.ctx ? this.ctx.currentTime : 0;
    for (const id in this._loopNodes) {
      const { src, gain } = this._loopNodes[id];
      try {
        src.stop(now + 0.02);
      } catch {
        /* fine */
      }
      setTimeout(() => {
        try {
          gain.disconnect();
        } catch {
          /* fine */
        }
      }, 60);
    }
    this._loopNodes = {};
  }

  // push current mute/solo/level/on state to the live loop gains (no restart).
  // Toggling a loop ON mid-play starts it at the next bar; OFF stops it.
  private refreshLoopGains() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (const l of this.loops) {
      const node = this._loopNodes[l.id];
      const st = this.sequence.loops[l.id];
      if (node) {
        if (st?.on) node.gain.gain.setTargetAtTime(this.loopGain(l.id), t, 0.02);
        else this.stopOneLoop(l.id); // turned off → stop it
      } else if (st?.on && this.beatMode && this.sequencePlaying) {
        this.startOneLoopAligned(l.id); // turned on mid-play → start at next bar
      }
    }
  }

  private stopOneLoop(id: string) {
    const node = this._loopNodes[id];
    if (!node) return;
    const now = this.ctx!.currentTime;
    node.gain.gain.setTargetAtTime(0, now, 0.03);
    try {
      node.src.stop(now + 0.1);
    } catch {
      /* fine */
    }
    delete this._loopNodes[id];
  }

  // start a single loop on the next bar boundary (for mid-play toggles)
  private startOneLoopAligned(id: string) {
    const c = this.ctx!;
    const n = this.nodes!;
    const buf = this._loopBufs[id];
    const l = this.loops.find((x) => x.id === id);
    if (!buf || !l) return;
    const barBeats = this.sequence.beatsPerBar;
    const beat = this.currentBeat();
    const nextBarBeat = Math.ceil((beat + 0.01) / barBeats) * barBeats;
    const when = this._seqAnchorTime + (nextBarBeat - this._seqAnchorBeat) * this.beatDur();
    const gain = c.createGain();
    gain.gain.value = this.loopGain(id);
    const src = c.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = this.loopRate(l);
    const offset = this.applyLoopRegion(src, id);
    src.connect(gain);
    gain.connect(n.sum);
    src.start(when, offset);
    this._loopNodes[id] = { src, gain, startCtx: when, startOff: offset };
  }

  // ── loop control (UI) ──
  toggleLoop(id: string) {
    const st = this.sequence.loops[id];
    if (!st) return;
    st.on = !st.on;
    if (st.on) void this.loadLoops();
    this.refreshLoopGains();
    this.emit("clip");
  }
  setLoopLevel(id: string, level: number) {
    const st = this.sequence.loops[id];
    if (!st) return;
    st.level = Math.min(1, Math.max(0, level));
    this.refreshLoopGains();
    this.emit("clip");
  }
  toggleLoopMute(id: string) {
    const st = this.sequence.loops[id];
    if (!st) return;
    st.mute = !st.mute;
    this.refreshLoopGains();
    this.emit("clip");
  }
  toggleLoopSolo(id: string) {
    const st = this.sequence.loops[id];
    if (!st) return;
    st.solo = !st.solo;
    this.refreshBeatGains(); // global solo → silence drums + channels too
    this.emit("clip");
  }
  // lock/unlock a loop to the grid tempo. Re-rates a live voice immediately so the
  // speed snaps (locked = bpm/rootBpm; unlocked = original speed) without restart.
  // If the loop's root tempo was only a guess (no filename token), engaging lock
  // ADOPTS the current tempo as its root — so locking never changes pitch/speed;
  // only tempo moves made *after* locking warp it. A loop with a known root warps
  // on lock as intended (that's the point of syncing it to a different tempo).
  toggleLoopSync(id: string) {
    const st = this.sequence.loops[id];
    if (!st) return;
    st.sync = !st.sync;
    const l = this.loops.find((x) => x.id === id);
    if (l && st.sync && !l.rootKnown) l.rootBpm = Math.round(this.bpm);
    const node = this._loopNodes[id];
    if (node && l && this.ctx) node.src.playbackRate.setTargetAtTime(this.loopRate(l), this.ctx.currentTime, 0.02);
    this.emit("clip");
  }
  // Set a loop's A→B playback region (fractions 0..1 of the buffer). Re-applies to
  // a live source immediately (loopStart/loopEnd are dynamically settable); the
  // playhead stays inside the new window on the next wrap.
  setLoopRegion(id: string, a: number, b: number) {
    const st = this.sequence.loops[id];
    if (!st) return;
    a = Math.min(0.999, Math.max(0, a));
    b = Math.max(a + 0.001, Math.min(1, b));
    st.a = a;
    st.b = b;
    const node = this._loopNodes[id];
    if (node?.src.buffer) {
      const dur = node.src.buffer.duration;
      node.src.loopStart = a * dur;
      node.src.loopEnd = b * dur;
    }
    this.emit("clip");
  }

  // Set a loop's bar length (drives the A/B snap grid + region math). Independent
  // of rootBpm/sync — corrects a loop whose filename token was wrong/absent so the
  // gridlines align to the real transients. Clamped 1..16.
  setLoopBars(id: string, bars: number) {
    const l = this.loops.find((x) => x.id === id);
    if (!l) return;
    l.bars = Math.min(16, Math.max(1, Math.round(bars)));
    this.emit("clip");
  }
  // user-set the loop's root tempo. Becomes authoritative (rootKnown), so a later
  // lock warps from this value; re-rates a live synced loop immediately.
  setLoopBpm(id: string, bpm: number) {
    const l = this.loops.find((x) => x.id === id);
    if (!l) return;
    l.rootBpm = Math.min(300, Math.max(40, Math.round(bpm)));
    l.rootKnown = true;
    const node = this._loopNodes[id];
    if (node && this.ctx) node.src.playbackRate.setTargetAtTime(this.loopRate(l), this.ctx.currentTime, 0.02);
    this.emit("clip");
  }
  // user-set the loop's detected key/chord label (free text; "" clears it)
  setLoopKey(id: string, key: string) {
    const l = this.loops.find((x) => x.id === id);
    if (!l) return;
    l.key = key.trim() || undefined;
    this.emit("clip");
  }

  // Live playhead position of a looping voice as a 0..1 fraction of its BUFFER
  // (for the waveform strip), or -1 when not playing. Walks buffer-time from the
  // recorded start (offset + rate × elapsed) and wraps inside the A→B region.
  loopPosition(id: string): number {
    const node = this._loopNodes[id];
    const buf = this._loopBufs[id];
    if (!node || !buf || !this.ctx || this.ctx.currentTime < node.startCtx) return -1;
    const dur = buf.duration;
    const a = node.src.loopStart || 0;
    const b = node.src.loopEnd || dur;
    const region = Math.max(0.0001, b - a);
    const elapsed = (this.ctx.currentTime - node.startCtx) * node.src.playbackRate.value;
    // first pass runs startOff→b, then loops a→b; normalise into the region
    const within = ((node.startOff - a + elapsed) % region + region) % region;
    return (a + within) / dur;
  }

  // Decoded waveform peaks for a loop's buffer (for the A/B region strip). Cached
  // per loop+bin-count; mirrors getPeaks for the main track.
  loopPeaks(id: string, bins: number): Float32Array | null {
    const buf = this._loopBufs[id];
    if (!buf) return null;
    const cached = this._loopPeaks[id];
    if (cached && cached.length === bins) return cached;
    const ch0 = buf.getChannelData(0);
    const ch1 = buf.numberOfChannels > 1 ? buf.getChannelData(1) : ch0;
    const per = Math.max(1, Math.floor(ch0.length / bins));
    const peaks = new Float32Array(bins);
    for (let b = 0; b < bins; b++) {
      let max = 0;
      const start = b * per;
      for (let i = start; i < start + per && i < ch0.length; i += 8) {
        const a = Math.abs((ch0[i] + ch1[i]) * 0.5);
        if (a > max) max = a;
      }
      peaks[b] = max;
    }
    this._loopPeaks[id] = peaks;
    return peaks;
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
    // live loops re-rate to the new tempo, but only the LOCKED ones; unlocked
    // loops resolve to rate 1 (loopRate) so a tempo change leaves them untouched
    if (this.ctx) {
      const tt = this.ctx.currentTime;
      for (const l of this.loops) {
        const node = this._loopNodes[l.id];
        if (node) node.src.playbackRate.setTargetAtTime(this.loopRate(l), tt, 0.02);
      }
    }
    this.emit("transport");
  }

  setLoop(on: boolean) {
    this.loopOn = on;
    this.emit("transport");
  }

  private beatDur() {
    return 60 / this.bpm;
  }

  // total beats of whatever's currently playing (drum sequence vs. note clip).
  // A drum step = one 1/16 note = 0.25 beat, so the grid is steps × 0.25 beats.
  private activeTotalBeats(): number {
    if (this.beatMode) return this.sequence.steps * STEP_BEATS;
    return this._clip ? clipBeats(this._clip) : 0;
  }

  // current beat position within the active loop, from the ctx clock
  private currentBeat(): number {
    if (!this.ctx) return 0;
    const elapsed = this.ctx.currentTime - this._seqAnchorTime;
    let beat = this._seqAnchorBeat + elapsed / this.beatDur();
    const total = this.activeTotalBeats();
    if (this.loopOn && total > 0) beat = ((beat % total) + total) % total;
    return beat;
  }

  // for the visual playhead (pure read — lint-safe in rAF). `step` is the current
  // drum step (0..steps-1) in beat mode, else -1.
  getSequencePosition(): { beat: number; bars: number; playing: boolean; step: number } {
    const total = this.activeTotalBeats();
    const beat = this.sequencePlaying ? this.currentBeat() : 0;
    return {
      beat,
      bars: this.beatMode ? Math.max(1, total / this.sequence.beatsPerBar) : this._clip ? this._clip.bars : 0,
      playing: this.sequencePlaying,
      step: this.beatMode && this.sequencePlaying ? Math.floor(beat / STEP_BEATS) % this.sequence.steps : -1,
    };
  }

  playSequence() {
    if (!this.beatMode && !this._clip) return;
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

  // piano-roll transport (clears beat mode so the scheduler walks the note clip)
  toggleSequence() {
    if (this.sequencePlaying && !this.beatMode) {
      this.stopSequence();
    } else {
      if (this.sequencePlaying) this.stopSequence(); // was a beat — stop it first
      this.beatMode = false;
      this.playSequence();
    }
  }

  // ── beat-maker transport ──
  // Enter drum mode (the scheduler walks the step grid) and start. Uses the
  // sequence's own bpm. Mutually exclusive with track + piano-roll playback.
  playBeat() {
    this.beatMode = true;
    this.bpm = this.sequence.bpm;
    void this.loadKit(this.kit);
    void this.loadLoops();
    this.playSequence();
    // start any "on" loops aligned to the sequence start (_seqAnchorTime set above)
    this.startLoops(this._seqAnchorTime);
  }

  stopBeat() {
    this.stopLoops();
    this.stopSequence();
    this.beatMode = false;
  }

  toggleBeat() {
    if (this.sequencePlaying && this.beatMode) this.stopBeat();
    else this.playBeat();
  }

  setSwing(v: number) {
    this.sequence.swing = Math.min(0.7, Math.max(0, v));
    this.emit("clip");
  }

  // toggle a single step on/off (or its accent) and emit so the grid re-renders
  toggleStep(laneId: string, step: number, accent = false) {
    const arr = accent ? this.sequence.accent[laneId] : this.sequence.on[laneId];
    if (!arr) return;
    arr[step] = !arr[step];
    this.emit("clip");
  }
  // clear every step (and accent) of one drum lane
  clearDrumLane(laneId: string) {
    const on = this.sequence.on[laneId];
    const acc = this.sequence.accent[laneId];
    if (on) on.fill(false);
    if (acc) acc.fill(false);
    this.emit("clip");
  }

  setBeatBpm(bpm: number) {
    this.sequence.bpm = Math.min(220, Math.max(40, Math.round(bpm)));
    if (this.beatMode) this.setBpm(this.sequence.bpm);
    else this.emit("clip");
  }

  // schedule every event landing in (_scheduledThrough, currentTime+AHEAD],
  // mapping clip beats onto absolute ctx times and wrapping at the loop boundary.
  // Branches on beatMode: drum step grid vs. piano-roll note clip.
  private schedTick() {
    const c = this.ctx;
    if (!c || !this.sequencePlaying) return;
    const total = this.activeTotalBeats();
    if (total <= 0) return;
    const bd = this.beatDur();
    const horizon = c.currentTime + AudioEngine.SCHED_AHEAD;
    const fromBeatAbs = this._seqAnchorBeat + (this._scheduledThrough - this._seqAnchorTime) / bd;
    const toBeatAbs = this._seqAnchorBeat + (horizon - this._seqAnchorTime) / bd;
    const whenOf = (absBeat: number) => this._seqAnchorTime + (absBeat - this._seqAnchorBeat) * bd;

    if (this.beatMode) {
      const seq = this.sequence;
      // swing pushes odd steps later by up to ~1/3 of a step
      const swingBeats = seq.swing * STEP_BEATS * 0.66;
      for (let s = 0; s < seq.steps; s++) {
        const stepBeat = s * STEP_BEATS + (s % 2 === 1 ? swingBeats : 0);
        let k = Math.floor((fromBeatAbs - stepBeat) / total);
        if (!this.loopOn) k = 0;
        for (; ; k++) {
          const absBeat = stepBeat + (this.loopOn ? k * total : 0);
          if (absBeat >= toBeatAbs) break;
          if (absBeat < fromBeatAbs) {
            if (!this.loopOn) break;
            continue;
          }
          const when = whenOf(absBeat);
          for (const lane of this.kit.lanes) {
            if (seq.on[lane.id]?.[s]) this.triggerDrum(lane.id, when, !!seq.accent[lane.id]?.[s]);
          }
          if (!this.loopOn) break;
        }
      }
      // melodic MIDI channels share the same clock, voiced with the channel's own
      // instrument. A channel with `loop` repeats over ITS OWN clip length (so a
      // 2-bar bass loops twice under a 4-bar grid); otherwise it wraps with the
      // global transport against the grid total.
      for (const ch of seq.channels) {
        if (this.channelGain(ch) <= 0) continue;
        const sel = this.channelVoice(ch);
        const span = ch.loop ? clipBeats(ch.clip) : total;
        const wrap = ch.loop || this.loopOn; // repeat if the channel or transport loops
        if (span <= 0) continue;
        for (const note of ch.clip.notes) {
          let k = Math.floor((fromBeatAbs - note.start) / span);
          if (!wrap) k = 0;
          for (; ; k++) {
            const absBeat = note.start + (wrap ? k * span : 0);
            if (absBeat >= toBeatAbs) break;
            if (absBeat < fromBeatAbs) {
              if (!wrap) break;
              continue;
            }
            const when = whenOf(absBeat);
            const off = when + Math.max(0.04, note.length * bd);
            const slide = note.slideFrom != null ? { from: note.slideFrom, durSec: note.length * bd } : undefined;
            const h = this.startVoiceAt(note.pitch, note.vel, when, sel, slide, note.vibrato);
            this.releaseVoice(h, off);
            this._seqVoices.push(h);
            if (!wrap) break;
          }
        }
      }
      // ponytail: voice ceiling. With 8 channels × 64 steps this prune is what
      // bounds OscillatorNode/BufferSource accumulation. Upgrade path if it ever
      // bites: a per-channel polyphony cap before scheduling, not after.
      if (this._seqVoices.length > 256) this._seqVoices = this._seqVoices.slice(-128);
      this._scheduledThrough = horizon;
      return;
    }

    // piano-roll note clip
    const clip = this._clip;
    if (!clip) {
      this._scheduledThrough = horizon;
      return;
    }
    for (const note of clip.notes) {
      let k = Math.floor((fromBeatAbs - note.start) / total);
      if (!this.loopOn) k = 0;
      for (; ; k++) {
        const absBeat = note.start + (this.loopOn ? k * total : 0);
        if (absBeat >= toBeatAbs) break;
        if (absBeat < fromBeatAbs) {
          if (!this.loopOn) break;
          continue;
        }
        const when = whenOf(absBeat);
        const off = when + Math.max(0.04, note.length * bd);
        const slide = note.slideFrom != null ? { from: note.slideFrom, durSec: note.length * bd } : undefined;
        const h = this.startVoiceAt(note.pitch, note.vel, when, undefined, slide, note.vibrato);
        this.releaseVoice(h, off);
        this._seqVoices.push(h);
        if (!this.loopOn) break;
      }
    }
    if (this._seqVoices.length > 256) this._seqVoices = this._seqVoices.slice(-128);
    this._scheduledThrough = horizon;
  }

  // ── debug ──
  // One call that snapshots the live engine for the console — what you reach for
  // when audio misbehaves. Pure reads, no side effects. In dev `window.engine`
  // is set (see below), so just run `engine.debug()` in the browser console.
  debug() {
    const c = this.ctx;
    return {
      transport: {
        playing: this.playing,
        mode: this.transportMode,
        sequencePlaying: this.sequencePlaying,
        beatMode: this.beatMode,
        loopOn: this.loopOn,
        bpm: this.bpm,
        position: c ? this._offset + (this.playing ? Math.max(0, c.currentTime - this._startCtx) : 0) : this._offset,
      },
      track: { id: this.track?.id ?? null, ready: this.ready, loading: this.loading, error: this.error, duration: this.duration },
      graph: {
        ctxState: c?.state ?? "none",
        ctxTime: c?.currentTime ?? 0,
        sampleRate: c?.sampleRate ?? 0,
        fxOrder: [...this.fxOrder],
        wet: this.wet,
        levelMatch: this.levelMatch,
      },
      fx: this.fx,
      voices: {
        liveKeyboard: Object.keys(this._liveVoices).length,
        scheduler: this._seqVoices.length,
        loops: Object.keys(this._loopNodes).length,
        playingSources: this._srcs?.length ?? 0,
        activeNotes: Object.keys(this._liveVoices), // "<channelId|_>:<midi>"
      },
    };
  }
}

export const engine = new AudioEngine();

// channel-count thresholds surfaced to the UI (soft warn / hard cap)
export const SOFT_CHANNELS = AudioEngine.SOFT_CHANNELS;
export const MAX_CHANNELS = AudioEngine.MAX_CHANNELS;

// Dev-only console handle: `engine.debug()` in the browser. Statically false in
// production builds, so it tree-shakes out. ponytail: drop if it ever ships.
if (import.meta.env.DEV) (globalThis as { engine?: AudioEngine }).engine = engine;
