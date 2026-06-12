// ── AIN audio engine v2 — track-based ────────────────────────────────────
// One AudioContext, one global "master track". A track is either a 'pair'
// (mix + master, phase-locked A/B crossfade) or a 'single' (one preview file
// through the master branch). Sources for a pair are started on the same
// context clock at the same sample → they physically cannot drift.
//
// Ported from the prototype js/engine.js (verified clean). Framework-agnostic:
// this module owns the Web Audio graph; React subscribes via on()/off().

import type { Track } from "./data/tracks";

type EngineEvent = "state" | "wet" | "fx" | "track" | "ready" | "synth";

export interface Levels {
  rms: number;
  peak: number;
}
export interface LevelPair {
  mix: Levels;
  master: Levels;
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
  filter: BiquadFilterNode;
  dIn: GainNode;
  dOut: GainNode;
  dDry: GainNode;
  dWet: GainNode;
  delay: DelayNode;
  dFb: GainNode;
  shaper: WaveShaperNode;
  anOut: AnalyserNode;
  master: GainNode;
}

interface FxState {
  filter: { on: boolean; morph: number };
  space: { on: boolean; time: number; fb: number; mix: number };
  crush: { on: boolean; drive: number };
}

interface Voice {
  oscs: OscillatorNode[];
  vg: GainNode;
  vf: BiquadFilterNode;
  p: Patch;
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
    space: { on: false, time: 0.32, fb: 0.35, mix: 0.3 },
    crush: { on: false, drive: 0.35 },
  };

  synthPatch = "glass pad";
  synthPatches = Object.keys(PATCHES);

  private _startCtx = 0;
  private _offset = 0;
  private _peaks: Float32Array | null = null;
  private _srcs: AudioBufferSourceNode[] | null = null;
  private _voices: Record<number, Voice> = {};
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

    n.filter = c.createBiquadFilter();
    n.filter.type = "lowpass";
    n.filter.frequency.value = 20000;
    n.filter.Q.value = 0.7;

    n.dIn = c.createGain();
    n.dOut = c.createGain();
    n.dDry = c.createGain();
    n.dWet = c.createGain();
    n.delay = c.createDelay(2.0);
    n.dFb = c.createGain();
    n.dIn.connect(n.dDry);
    n.dDry.connect(n.dOut);
    n.dIn.connect(n.delay);
    n.delay.connect(n.dWet);
    n.dWet.connect(n.dOut);
    n.delay.connect(n.dFb);
    n.dFb.connect(n.delay);
    n.dWet.gain.value = 0;
    n.dFb.gain.value = 0;

    n.shaper = c.createWaveShaper();
    n.shaper.oversample = "2x";

    n.sum.connect(n.filter);
    n.filter.connect(n.dIn);
    n.dOut.connect(n.shaper);

    n.anOut = c.createAnalyser();
    n.anOut.fftSize = 2048;
    n.anOut.smoothingTimeConstant = 0.82;
    n.master = c.createGain();
    n.master.gain.value = 0.95;
    n.shaper.connect(n.anOut);
    n.anOut.connect(n.master);
    n.master.connect(c.destination);

    this.nodes = n;
    this.applyWet(true);
    this.applyFx();
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
    n.delay.delayTime.setTargetAtTime(fx.space.time, t, 0.05);
    n.dFb.gain.setTargetAtTime(fx.space.on ? fx.space.fb : 0, t, 0.05);
    n.dWet.gain.setTargetAtTime(fx.space.on ? fx.space.mix : 0, t, 0.05);
    if (!fx.crush.on || fx.crush.drive <= 0.001) {
      n.shaper.curve = null;
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

  // ── preset synth ──
  setSynthPatch(name: string) {
    if (PATCHES[name]) {
      this.synthPatch = name;
      this.emit("synth");
    }
  }

  noteOn(midi: number, vel?: number) {
    vel = vel == null ? 1 : vel;
    const c = this.ensureCtx();
    const n = this.nodes!;
    this.noteOff(midi, true);
    const p = PATCHES[this.synthPatch];
    const f = 440 * Math.pow(2, (midi + p.oct * 12 - 69) / 12);
    const t = c.currentTime;
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
    this._voices[midi] = { oscs, vg, vf, p };
    this.emit("synth");
  }

  noteOff(midi: number, instant?: boolean) {
    const v = this._voices[midi];
    if (!v) return;
    delete this._voices[midi];
    const c = this.ctx!;
    const t = c.currentTime;
    const r = instant ? 0.03 : v.p.r;
    v.vg.gain.cancelScheduledValues(t);
    v.vg.gain.setValueAtTime(v.vg.gain.value, t);
    v.vg.gain.setTargetAtTime(0, t, Math.max(0.01, r / 4));
    const stopAt = t + r + 0.15;
    v.oscs.forEach((o) => {
      try {
        o.stop(stopAt);
      } catch {
        /* already stopped */
      }
    });
    setTimeout(
      () => {
        try {
          v.vg.disconnect();
        } catch {
          /* fine */
        }
      },
      (r + 0.25) * 1000,
    );
    this.emit("synth");
  }

  activeNotes(): number[] {
    return Object.keys(this._voices).map(Number);
  }
}

export const engine = new AudioEngine();
