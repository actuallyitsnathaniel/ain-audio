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
import { clipBeats, sampleAuto, VIB_MAX_CENTS, type AutoLane, type AutoPoint, type MidiChannel, type Note, type NoteClip } from "./data/clips";
import { DRUM_BASE } from "./data/drum-midi";
import { arrangementBeats, loadArrangement, newClipId, newTrackId, saveArrangement, type ArrClip, type Arrangement, type ArrTrack, type TrackKind } from "./data/arrangement";
import { BUILTIN_PATCHES, patchFromPreset, type SynthPatch } from "./data/patches";
import { parseMidi } from "./data/midi-file";
import { DEFAULT_KIT, defaultSequence, KITS, LOOPS, parseLoopMeta, resizeRow, STEP_COUNTS, type DrumKit, type DrumLane, type DrumSynth, type LoopLane, type SequenceClip } from "./data/kits";

export type TransportMode = "track" | "sequence";

const STEP_BEATS = 0.25; // one drum step = a 1/16 note

type EngineEvent = "state" | "wet" | "fx" | "track" | "ready" | "synth" | "preset" | "transport" | "clip" | "midi" | "patch" | "arrange";

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
// One unified voice: oscs + optional noise + optional sample source → filter → amp.
type VoiceHandle = {
  kind: "synth";
  vg: GainNode;
  r: number;
  oscs: OscillatorNode[];
  vf: BiquadFilterNode;
  noiseSrc?: AudioBufferSourceNode;
  sampleSrc?: AudioBufferSourceNode;
  lfos?: OscillatorNode[]; // vibrato + patch LFOs, stopped with the voice
};

// A resolved voice selection — the fully-resolved SynthPatch to voice (which may
// have a sample source) + where it routes. Channels/tracks resolve their own so
// each sounds its own instrument; the live keyboard uses the global active patch.
interface VoiceSel {
  patch: SynthPatch;
  dest?: AudioNode; // where the voice connects (a channel's gain node); default n.sum
}

// A legato voice run: one articulated head note, then 0+ `slide` notes that bend
// the SAME voice to new pitches (no re-attack). Beats are clip-relative.
interface NoteRun {
  startBeat: number;
  endBeat: number; // end of the last note in the run
  pitch: number; // head note's articulated pitch
  vel: number;
  // each slide note: hold the previous pitch until `fromBeat` (its start), then
  // glide to `toMidi`, reaching it at `atBeat` (its end).
  bends: { toMidi: number; fromBeat: number; atBeat: number }[];
}

const LS_WET = "ain-masterlab-wet";
const LS_PATCHES = "ain-synth-patches"; // user-designed patches: { name: SynthPatch }
const posKey = (id: string) => "ain-pos:" + id;
const db2lin = (db: number) => Math.pow(10, db / 20);

function loadUserPatches(): Record<string, SynthPatch> {
  try {
    return JSON.parse(localStorage.getItem(LS_PATCHES) || "{}");
  } catch {
    return {};
  }
}

// shallow-recursive partial + merge for editing a patch (its nesting is one level:
// osc1/osc2/sub/noise/filter/filtEnv/ampEnv/lfo are flat objects of primitives).
type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? Partial<T[K]> : T[K] };
function deepMerge<T extends object>(base: T, patch: DeepPartial<T>): T {
  const out = { ...base } as T;
  for (const k in patch) {
    const v = patch[k];
    if (v && typeof v === "object" && !Array.isArray(v)) {
      out[k] = { ...(base[k] as object), ...(v as object) } as T[Extract<keyof T, string>];
    } else if (v !== undefined) {
      out[k] = v as T[Extract<keyof T, string>];
    }
  }
  return out;
}

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

  synthPatch = "glass pad"; // active synth patch id
  // merged patch store: built-ins + user patches (loaded from localStorage at boot).
  // Built-ins can be edited live for the session but are NOT persisted — they reset
  // to factory on reload; `saveUserPatch` captures the working sound as a user patch.
  patches: Record<string, SynthPatch> = { ...structuredClone(BUILTIN_PATCHES), ...loadUserPatches() };
  get synthPatches(): string[] {
    return Object.keys(this.patches);
  }
  currentPatch(): SynthPatch {
    return this.patches[this.synthPatch] || BUILTIN_PATCHES["glass pad"];
  }
  activePatch = () => this.currentPatch();
  isBuiltinPatch(id: string): boolean {
    return id in BUILTIN_PATCHES;
  }
  // Sampled presets are first-class instruments: seed an editable patch per preset
  // (sample source on) into the store, unless the user already saved one under that
  // name. Runs at boot so presets appear alongside synth patches in one list.
  private seedPresetPatches() {
    for (const pr of this.samplePresets) {
      if (pr.zones.length === 0) continue; // fallback-only ids stay synth patches
      if (!(pr.name in this.patches)) this.patches[pr.name] = patchFromPreset(pr, pr.id);
    }
  }

  // ── synth patch editing + save/recall (live; the SynthEditor calls these) ──
  // Deep-merge a partial into the ACTIVE patch. Voices pick it up on the next note
  // (no live re-voicing of held notes — matches how a hardware synth latches per
  // note). Persists if the active patch is a user patch. Emits `patch`.
  updateActivePatch(partial: DeepPartial<SynthPatch>) {
    const cur = this.patches[this.synthPatch];
    if (!cur) return;
    this.patches[this.synthPatch] = deepMerge(cur, partial);
    if (!this.isBuiltinPatch(this.synthPatch)) this.persistUserPatches();
    this.emit("patch");
  }
  // Save the active patch's current sound under `name` as a user patch, select it.
  // Saving over a built-in name is disallowed (keeps factory presets pristine).
  saveUserPatch(name: string): boolean {
    name = name.trim();
    if (!name || name in BUILTIN_PATCHES) return false;
    this.patches[name] = structuredClone(this.currentPatch());
    this.synthPatch = name;
    this.persistUserPatches();
    this.emit("patch");
    this.emit("synth");
    return true;
  }
  deleteUserPatch(name: string) {
    if (this.isBuiltinPatch(name) || !(name in this.patches)) return;
    delete this.patches[name];
    if (this.synthPatch === name) this.synthPatch = Object.keys(BUILTIN_PATCHES)[0];
    this.persistUserPatches();
    this.emit("patch");
    this.emit("synth");
  }
  // restore a built-in to its factory sound (undo live edits this session)
  revertPatch(id: string) {
    if (!this.isBuiltinPatch(id)) return;
    this.patches[id] = structuredClone(BUILTIN_PATCHES[id]);
    this.emit("patch");
  }
  private persistUserPatches() {
    const user: Record<string, SynthPatch> = {};
    for (const id in this.patches) if (!this.isBuiltinPatch(id)) user[id] = this.patches[id];
    try {
      localStorage.setItem(LS_PATCHES, JSON.stringify(user));
    } catch {
      /* storage full / unavailable — session-only is acceptable */
    }
  }

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
  private static VIB_RATE = 5.5; // Hz — vibrato LFO rate (depth is automated)
  // "tiny fade at play and stop" (REAPER-style): a short gain ramp on every source
  // start/stop so the transport never hard-cuts a buffer mid-cycle (which clicks).
  // ≤15 ms keeps the stop tight/performative (below the ~20 ms perceptual threshold).
  private static DECLICK = 0.012; // s

  // ── beat-maker (drum step sequencer; shares the clock above) ──
  // beatMode switches the scheduler between the piano-roll note clip and the
  // drum sequence clip. Only one plays at a time.
  beatMode = false;
  arrangeMode = false; // scheduler walks the linear arrangement (vs the loop grid)
  // ── transport / playback pane ──
  metronome = false; // click on each beat (accent on bar 1) during arrangement playback
  metronomeVol = 0.6; // 0..1
  countInBars = 0; // bars of count-in click before the transport rolls (0 = off)
  followPlayhead = true; // timeline auto-scrolls to keep the playhead in view (UI reads it)
  snapBeats = 1; // timeline clip snap grid in beats (0 = off/free); UI reads it
  insertBeat = 0; // the arrangement "insert marker" — where paste/create/split reference
  private _metroThrough = -1; // last beat we've scheduled a click for (arrangement clock)
  arrangement: Arrangement = loadArrangement();
  private _arrStrips: Record<string, { gain: GainNode; pan: StereoPannerNode }> = {}; // per-track vol/pan strip
  kit: DrumKit = DEFAULT_KIT;
  sequence: SequenceClip = defaultSequence(DEFAULT_KIT);
  loops: LoopLane[] = LOOPS;
  private _drumBufs: Record<string, AudioBuffer | null> = {}; // laneId → decoded one-shot (null = use synth)
  private _noiseBufs: Partial<Record<"white" | "pink", AudioBuffer>> = {}; // synth noise sources, built once
  private _loopBufs: Record<string, AudioBuffer> = {}; // loopId → decoded buffer
  private _loopPeaks: Record<string, Float32Array> = {}; // loopId → cached waveform peaks
  // imported audio-clip buffers (session-only; bufId → decoded buffer + its peak cache)
  private _importBufs: Record<string, AudioBuffer> = {};
  private _importPeaks: Record<string, Float32Array> = {};
  private _importSeq = 0;
  // audio clips are long one-shots (not per-note events) — track which have been started
  // this playback pass so the lookahead scheduler doesn't retrigger them every tick.
  // `synced` clips re-rate live when the tempo changes (the tape-warble effect):
  // `baseRate` is the rate at `baseBpm`, so a new tempo → baseRate·(bpm/baseBpm). Drift-free.
  private _startedAudio: Record<string, { src: AudioBufferSourceNode; synced: boolean; baseRate: number; baseBpm: number }> = {};
  private _presetPeaks: Record<string, Float32Array> = {}; // "presetId:zoneIdx" → cached peaks
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
  // click-free looping: buffers with an equal-power crossfade baked into the loop
  // seam, keyed by "presetId:zoneIdx:loopStart:loopEnd" (rounded). Built lazily.
  private _xfadeBufs: Record<string, AudioBuffer> = {};
  private _presetLoading: Record<string, boolean> = {};
  private _phraseCache: Record<string, { clip: NoteClip; bpm?: number }> = {};
  private _ls: Partial<Record<EngineEvent, Array<() => void>>> = {};
  private _lastSave = 0;
  private _defaultTrack: Track | null = null;
  private _tdBuf = new Float32Array(2048);

  constructor() {
    const v = parseFloat(localStorage.getItem(LS_WET) || "");
    this.wet = isNaN(v) ? 1 : Math.min(1, Math.max(0, v));
    this.seedPresetPatches(); // sampled presets appear as editable patches
    // migrate persisted arrangement tracks: a legacy raw preset id → its patch-key
    // name, so the (now patch-keyed) instrument dropdown matches. ponytail: one-shot,
    // harmless if it re-runs — patch keys already map to themselves.
    for (const t of this.arrangement.tracks) {
      if (t.presetId && !(t.presetId in this.patches)) {
        const pr = this.samplePresets.find((p) => p.id === t.presetId);
        if (pr && pr.name in this.patches) t.presetId = pr.name;
      }
    }
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
    // declick: fade the tap gains 0→1 over DECLICK from the sources' start sample, so
    // a buffer that starts mid-cycle doesn't pop. tapMix/tapMaster carry ONLY the
    // track (not the beat), and gain-only ramps don't touch source timing → phase
    // lock is preserved.
    const d = AudioEngine.DECLICK;
    for (const g of [n.tapMix.gain, n.tapMaster.gain]) {
      g.cancelScheduledValues(when);
      g.setValueAtTime(0, when);
      g.linearRampToValueAtTime(1, when + d);
    }
    this._srcs = srcs;
    this._startCtx = when;
  }

  private stopSources() {
    const srcs = this._srcs;
    this._srcs = null;
    if (!srcs || !this.ctx) {
      srcs?.forEach((s) => {
        try {
          s.stop();
          s.disconnect();
        } catch {
          /* already stopped */
        }
      });
      return;
    }
    // declick: fade the tap gains to 0 over DECLICK, then stop just after the fade
    // completes (a bare stop() would cut the buffer mid-cycle and click).
    const c = this.ctx;
    const t = c.currentTime;
    const d = AudioEngine.DECLICK;
    const n = this.nodes!;
    for (const g of [n.tapMix.gain, n.tapMaster.gain]) {
      g.cancelScheduledValues(t);
      g.setValueAtTime(g.value, t);
      g.linearRampToValueAtTime(0, t + d);
    }
    const stopAt = t + d + 0.005;
    srcs.forEach((s) => {
      try {
        s.stop(stopAt);
      } catch {
        /* already stopped */
      }
    });
    // disconnect after the fade+stop; leave the tap gains at 0 (next start re-ramps them)
    setTimeout(() => srcs.forEach((s) => {
      try {
        s.disconnect();
      } catch {
        /* fine */
      }
    }), (d + 0.02) * 1000);
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

  // ── instrument selection (patches, incl. sampled presets that are now patches) ──
  // `id` is a patch key. For back-compat it also accepts a sampled-preset id →
  // resolves to that preset's seeded patch (by preset name).
  setSynthPatch(id: string) {
    let key = id;
    if (!this.patches[key]) {
      const pr = this.samplePresets.find((p) => p.id === id); // legacy preset-id call
      if (pr) {
        if (!(pr.name in this.patches) && pr.zones.length) this.patches[pr.name] = patchFromPreset(pr, pr.id);
        key = pr.name;
      }
    }
    if (!this.patches[key]) return;
    this.synthPatch = key;
    this.warmPatch(this.patches[key]);
    this.emit("synth");
  }
  // decode the sample-source preset a patch references (no-op for osc-only patches)
  private warmPatch(p: SynthPatch) {
    if (p.sample?.presetId && this.samplePresets.some((pr) => pr.id === p.sample!.presetId)) void this.loadPreset(p.sample.presetId);
  }
  // public: decode a preset's zones by id (for the sample waveform / manual warm)
  warmPreset(presetId: string) {
    if (this.samplePresets.some((pr) => pr.id === presetId)) void this.loadPreset(presetId);
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
  private pickZone(preset: SampledPreset, midi: number): { buf: AudioBuffer; rootMidi: number; zoneIdx: number } | null {
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
    return { buf: bufs[idx]!, rootMidi: effRoot, zoneIdx: idx };
  }

  // Bake a user-controlled equal-power crossfade into a sample's loop seam so `s.loop`
  // wraps without a click. `xfadeSec` is the fade time the user dials on the UI (0 = off).
  //
  // Standard sampler loop-xfade: native looping plays [loopStart, loopEnd) then jumps
  // back to loopStart, so the click is inD[bS-1] → inD[aS]. We rewrite the `xf` samples
  // ENDING AT loopEnd as (loop tail, fading out) + (the pre-roll ending just BEFORE
  // loopStart, fading in). After the fade the tail has become inD[aS-1]'s material, and
  // the loop restarts at inD[aS] — which is physically the NEXT sample, so the wrap is
  // continuous. Equal-power (cos/sin) keeps perceived level constant across the blend.
  // Needs `xf` samples of pre-roll before loopStart (aS ≥ xf) — capped below.
  private xfadeLoopBuffer(src: AudioBuffer, presetId: string, zoneIdx: number, a: number, b: number, xfadeSec: number): AudioBuffer {
    const N = src.length;
    const aS = Math.floor(a * N);
    const bS = Math.floor(b * N);
    const region = bS - aS;
    // fade length: the user's seconds, capped to half the loop AND to the pre-roll
    // available before loopStart (can't read before the buffer head).
    let xf = Math.floor(src.sampleRate * Math.max(0, xfadeSec));
    xf = Math.min(xf, Math.floor(region / 2), aS);
    const key = presetId + ":" + zoneIdx + ":" + a.toFixed(4) + ":" + b.toFixed(4) + ":" + xf;
    const hit = this._xfadeBufs[key];
    if (hit) return hit;
    if (xf < 8) return src; // fade off / too small / loop at buffer head → plain loop
    const c = this.ensureCtx();
    const out = c.createBuffer(src.numberOfChannels, N, src.sampleRate);
    for (let ch = 0; ch < src.numberOfChannels; ch++) {
      const inD = src.getChannelData(ch);
      const outD = out.getChannelData(ch);
      outD.set(inD); // copy all, then rewrite the last `xf` samples before loopEnd
      for (let i = 0; i < xf; i++) {
        const t = (i + 0.5) / xf; // 0..1 across the fade toward loopEnd
        const fadeOut = Math.cos((t * Math.PI) / 2); // outgoing loop tail
        const fadeIn = Math.sin((t * Math.PI) / 2); // incoming = pre-roll before loopStart
        // tail [bS-xf+i] morphs into the material that leads INTO loopStart [aS-xf+i]
        outD[bS - xf + i] = inD[bS - xf + i] * fadeOut + inD[aS - xf + i] * fadeIn;
      }
    }
    this._xfadeBufs[key] = out;
    return out;
  }

  // Snap a loop-point fraction to the nearest upward zero-crossing on channel 0, so a
  // loop's start and end both sit at ~0 amplitude → the seam is 0→0 (click-free) before
  // any crossfade. Searches ±`win` fraction of the buffer; if none found, returns the
  // original. "Upward" (neg→pos) on both ends keeps the waveform slope consistent too.
  private snapZeroCross(buf: AudioBuffer, frac: number, win = 0.02): number {
    const N = buf.length;
    const d = buf.getChannelData(0);
    const center = Math.min(N - 2, Math.max(1, Math.round(frac * N)));
    const span = Math.max(1, Math.floor(win * N));
    let best = -1;
    let bestDist = Infinity;
    for (let off = 0; off <= span; off++) {
      for (const i of off === 0 ? [center] : [center - off, center + off]) {
        if (i < 1 || i >= N) continue;
        if (d[i - 1] <= 0 && d[i] > 0) {
          // interpolate the sub-sample crossing for a tighter landing
          const frac2 = d[i] !== d[i - 1] ? -d[i - 1] / (d[i] - d[i - 1]) : 0;
          const dist = Math.abs(i - 1 + frac2 - center);
          if (dist < bestDist) {
            bestDist = dist;
            best = i - 1 + frac2;
          }
        }
      }
      if (best >= 0) break; // nearest ring found → stop widening
    }
    return best >= 0 ? best / N : frac;
  }

  // a 2-second looping noise buffer (white or pink), built once and reused by every
  // voice's noise source. Pink uses the cheap Paul Kellet approximation.
  private noiseBuf(type: "white" | "pink"): AudioBuffer {
    const cached = this._noiseBufs[type];
    if (cached) return cached;
    const c = this.ensureCtx();
    const len = c.sampleRate * 2;
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    if (type === "white") {
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    } else {
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + w * 0.0555179;
        b1 = 0.99332 * b1 + w * 0.0750759;
        b2 = 0.969 * b2 + w * 0.153852;
        b3 = 0.8665 * b3 + w * 0.3104856;
        b4 = 0.55 * b4 + w * 0.5329522;
        b5 = -0.7616 * b5 - w * 0.016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
        b6 = w * 0.115926;
      }
    }
    this._noiseBufs[type] = buf;
    return buf;
  }

  // ── voice factory (shared by live keyboard + sequencer scheduler) ──
  // Build and start a voice at an explicit context time `when`. Returns a handle
  // the caller releases via releaseVoice(handle, when). Used directly by the
  // scheduler (which can play the same pitch repeatedly, so it can't key by MIDI);
  // noteOn/noteOff wrap this and key by MIDI for the held-key keyboard.
  // `bends` (FL portamento): the voice starts at `midi` and ramps to each segment's
  // pitch by its absolute `at` time — one voice can glide through a whole legato run
  // of slide notes. Empty/undefined = a plain (non-sliding) note.
  // `vib` (vibrato): a sine LFO (rate Hz) → gain (depth cents) → the voice's detune.
  startVoiceAt(
    midi: number,
    vel: number,
    when: number,
    sel?: VoiceSel,
    bends?: { toMidi: number; from: number; at: number }[], // hold until `from`, glide to `toMidi` by `at`
    // vibrato: depth follows a clip-global automation curve over the note's window.
    // `whenOfBeat(absClipBeat)` maps a clip beat to absolute ctx time.
    autoVib?: { points: AutoPoint[]; startBeat: number; endBeat: number; whenOfBeat: (b: number) => number; rate?: number; intensity?: number },
  ): VoiceHandle {
    const c = this.ensureCtx();
    const n = this.nodes!;
    const t = when;
    // schedule the portamento pitch ramps on a pitch param. `mode` picks the unit:
    // "detune" → cents offset from `midi`; "freq" → absolute Hz; "rate" → playbackRate.
    const applyBends = (param: AudioParam, mode: "detune" | "freq" | "rate", base = 0) => {
      if (!bends || !bends.length) return;
      // base: detune→humanize offset (cents); freq→octave-shift semitones; rate→rootMidi
      const val = (m: number) =>
        mode === "detune"
          ? base + (m - midi) * 100
          : mode === "freq"
            ? 440 * Math.pow(2, (m + base - 69) / 12)
            : Math.pow(2, (m - base) / 12);
      param.setValueAtTime(val(midi), t);
      let prevPitch = midi;
      for (const b of bends) {
        // hold the current pitch until the slide note begins, THEN glide to it,
        // so the bend happens during the slide note (not from the head's start)
        param.setValueAtTime(val(prevPitch), Math.max(t, b.from));
        param.linearRampToValueAtTime(val(b.toMidi), Math.max(b.from + 0.005, b.at));
        prevPitch = b.toMidi;
      }
    };
    // build a vibrato LFO whose DEPTH follows the clip-global automation curve over
    // the note's window. Sine LFO at a fixed rate → depth gain (scheduled along the
    // curve, cents) → the detune targets. No curve / all-zero ⇒ no LFO.
    const addVibrato = (targets: AudioParam[]): OscillatorNode | undefined => {
      if (!autoVib || !autoVib.points.length) return undefined;
      const { points, startBeat, endBeat, whenOfBeat } = autoVib;
      // per-clip vibrato speed (Hz) + intensity (depth scale). Defaults preserve the
      // old fixed feel: rate = VIB_RATE, intensity = 1.
      const rate = autoVib.rate ?? AudioEngine.VIB_RATE;
      const scale = (autoVib.intensity ?? 1) * VIB_MAX_CENTS;
      // breakpoints inside the note's window, plus the window edges, give the ramp set
      const edges = [startBeat, ...points.map((p) => p.beat).filter((b) => b > startBeat && b < endBeat), endBeat];
      let anyDepth = false;
      const depth = c.createGain();
      depth.gain.setValueAtTime(sampleAuto(points, startBeat) * scale, t);
      for (const b of edges) {
        const cents = sampleAuto(points, b) * scale;
        if (cents > 0.01) anyDepth = true;
        depth.gain.linearRampToValueAtTime(cents, Math.max(t, whenOfBeat(b)));
      }
      if (!anyDepth) return undefined; // curve is flat-zero over this note → skip
      const lfo = c.createOscillator();
      lfo.type = "sine";
      lfo.frequency.value = rate;
      lfo.connect(depth);
      targets.forEach((p) => depth.connect(p));
      lfo.start(t);
      return lfo;
    };

    // resolve which instrument to voice: an explicit per-channel/track selection, or
    // the global live-keyboard/Audio-Lab patch when none is passed.
    const dest = sel?.dest ?? n.sum; // channel gain node, or straight to the FX rack

    // ── unified voice path ──
    // osc1 + osc2 + sub + noise + SAMPLE → (per-source level gain) → filter (+filtEnv)
    //   → amp gain (ampEnv) → dest. A sampled multisample is just another source into
    // the same filter→amp spine, so it gets the same envelopes/filter/LFO as the oscs.
    const p = sel?.patch ?? this.activePatch();
    const freqOf = (semi: number) => 440 * Math.pow(2, (midi + semi - 69) / 12);
    const vg = c.createGain(); // amp
    vg.gain.value = 0;
    const vf = c.createBiquadFilter();
    const filterOn = p.filter.on !== false;
    if (filterOn) {
      vf.type = p.filter.type;
      vf.Q.value = p.filter.q;
      // key-tracking: cutoff scales with how far the note is from C4
      const cutBase = Math.min(18000, p.filter.cut * Math.pow(2, (p.filter.keyTrack * (midi - 60)) / 12));
      // filter envelope (ADSR) on cutoff, peaking at cutBase + amt
      const fe = p.filtEnv;
      const cutPeak = Math.max(20, Math.min(18000, cutBase + fe.amt));
      const cutSus = Math.max(20, Math.min(18000, cutBase + fe.amt * fe.s));
      vf.frequency.setValueAtTime(cutBase, t);
      vf.frequency.linearRampToValueAtTime(cutPeak, t + Math.max(0.005, fe.a));
      vf.frequency.setTargetAtTime(cutSus, t + fe.a, Math.max(0.03, fe.d));
    } else {
      vf.type = "allpass"; // bypass: flat magnitude, sources still route through it
    }
    vf.connect(vg);
    vg.connect(dest);

    const oscs: OscillatorNode[] = [];
    // a pitched oscillator at `semi` offset, mixed at `level`, with portamento bends
    const addOsc = (wave: OscillatorType, semi: number, cents: number, level: number) => {
      if (level <= 0) return;
      const o = c.createOscillator();
      o.type = wave;
      o.frequency.value = freqOf(semi);
      o.detune.value = cents;
      applyBends(o.frequency, "freq", semi); // glide this osc's own pitch line
      const g = c.createGain();
      g.gain.value = level;
      o.connect(g);
      g.connect(vf);
      o.start(t);
      oscs.push(o);
    };
    addOsc(p.osc1.wave, p.osc1.semi, p.osc1.cents, p.osc1.level);
    if (p.osc2On) addOsc(p.osc2.wave, p.osc2.semi, p.osc2.cents, p.osc2.level);
    if (p.sub.level > 0) addOsc(p.sub.wave, p.sub.oct * 12, 0, p.sub.level);

    // noise source (unpitched) → its own level gain → filter
    let noiseSrc: AudioBufferSourceNode | undefined;
    if (p.noise.level > 0) {
      noiseSrc = c.createBufferSource();
      noiseSrc.buffer = this.noiseBuf(p.noise.type);
      noiseSrc.loop = true;
      const ng = c.createGain();
      ng.gain.value = p.noise.level;
      noiseSrc.connect(ng);
      ng.connect(vf);
      noiseSrc.start(t);
    }

    // sample source (a multisample as an "oscillator") → level gain → filter. Pitch
    // via playbackRate from the picked zone's root; humanize + portamento + vibrato
    // ride src.detune (cents), same as an osc. loop = sustain via loopStart/End.
    let sampleSrc: AudioBufferSourceNode | undefined;
    if (p.sample && p.sample.level > 0) {
      const preset = this.samplePresets.find((pr) => pr.id === p.sample!.presetId);
      const zone = preset ? this.pickZone(preset, midi) : null;
      if (preset && zone) {
        const s = c.createBufferSource();
        // varispeed: note pitch × independent transpose (semi + cents), speed-coupled
        const vari = (p.sample.semi ?? 0) / 12 + (p.sample.cents ?? 0) / 1200;
        s.playbackRate.value = Math.pow(2, (midi - zone.rootMidi) / 12 + vari);
        if (preset.humanize > 0 && s.detune) s.detune.value = (Math.random() * 2 - 1) * preset.humanize;
        // playback window (0..1 of the buffer). loop region defaults to the window.
        const dur = zone.buf.duration;
        const a = Math.min(0.999, Math.max(0, p.sample.start ?? 0));
        const b = Math.min(1, Math.max(a + 0.001, p.sample.end ?? 1));
        if (p.sample.loop) {
          let ls = p.sample.loopStart ?? a;
          let le = p.sample.loopEnd ?? b;
          // snap both loop points to zero-crossings so the seam is 0→0 (click-free); the
          // crossfade below then just polishes any residual. Default on.
          if (p.sample.snap !== false) {
            ls = this.snapZeroCross(zone.buf, ls);
            le = this.snapZeroCross(zone.buf, le);
            if (le <= ls) le = Math.min(1, ls + 0.001); // guard degenerate snap
          }
          // loop a buffer with the user's seam crossfade baked in → no click on wrap
          s.buffer = this.xfadeLoopBuffer(zone.buf, p.sample.presetId, zone.zoneIdx, ls, le, p.sample.xfade ?? 0);
          s.loop = true;
          s.loopStart = ls * dur;
          s.loopEnd = le * dur;
        } else {
          s.buffer = zone.buf;
        }
        if (bends && bends.length && s.detune) applyBends(s.detune, "detune", s.detune.value);
        const sg = c.createGain();
        sg.gain.value = p.sample.level;
        s.connect(sg);
        sg.connect(vf);
        // one-shot: play only the window. loop: start at the window, loop sustains.
        if (p.sample.loop) s.start(t, a * dur);
        else s.start(t, a * dur, (b - a) * dur);
        sampleSrc = s;
      }
    }

    // amp envelope
    const ae = p.ampEnv;
    const peak = p.vol * vel;
    vg.gain.setValueAtTime(0, t);
    vg.gain.linearRampToValueAtTime(peak, t + Math.max(0.005, ae.a));
    vg.gain.setTargetAtTime(peak * ae.s, t + ae.a, Math.max(0.03, ae.d));

    // pitch-modulation targets = every pitched source's detune (oscs + the sample)
    const pitchTargets = oscs.map((o) => o.detune);
    if (sampleSrc?.detune) pitchTargets.push(sampleSrc.detune);

    // LFOs: per-note vibrato + the patch LFO routed to its destination. Both are
    // stopped with the voice in releaseVoice.
    const lfos: OscillatorNode[] = [];
    const vibLfo = addVibrato(pitchTargets);
    if (vibLfo) lfos.push(vibLfo);
    if (p.lfo.dest !== "off" && p.lfo.depth > 0) {
      const l = c.createOscillator();
      l.type = "sine";
      l.frequency.value = p.lfo.rate;
      const lg = c.createGain();
      lg.gain.value = p.lfo.depth;
      l.connect(lg);
      if (p.lfo.dest === "pitch") pitchTargets.forEach((d) => lg.connect(d)); // depth = cents
      else if (p.lfo.dest === "cutoff" && filterOn) lg.connect(vf.frequency); // depth = Hz (no-op when bypassed)
      else lg.connect(vg.gain); // amp tremolo, depth = linear gain
      l.start(t);
      lfos.push(l);
    }
    return { kind: "synth", vg, r: ae.r, oscs, vf, noiseSrc, sampleSrc, lfos };
  }

  // Release a voice at an explicit time. `instant` skips the patch release.
  // `cancelAndHoldAtTime` holds the level the amp envelope has at `when` (the
  // sequencer calls this at schedule time, so `.value` would be a stale ~0), then
  // the release is an EXPONENTIAL decay via `setTargetAtTime` — a natural instrument
  // tail (fast at first, long quiet fade), not a linear straight-line fade that
  // sounds abrupt and gets re-articulated when the next chord lands. Sources are
  // stopped only once the exponential tail is well below audibility (~5 time
  // constants), so the tail rings out instead of being cut.
  releaseVoice(h: VoiceHandle, when: number, instant?: boolean) {
    const c = this.ctx!;
    const t = when;
    const r = Math.max(0.015, instant ? 0.03 : h.r);
    if (h.vg.gain.cancelAndHoldAtTime) h.vg.gain.cancelAndHoldAtTime(t);
    else {
      h.vg.gain.cancelScheduledValues(t);
      h.vg.gain.setValueAtTime(h.vg.gain.value, t);
    }
    // exponential approach to 0 (time constant r/3 → ~95% gone by r, inaudible by ~5·tc)
    const tc = r / 3;
    h.vg.gain.setTargetAtTime(0, t, tc);
    const stopAt = t + tc * 6 + 0.02; // let the exponential tail ring out before stop
    const stop = (node?: { stop: (w: number) => void }) => {
      if (!node) return;
      try {
        node.stop(stopAt);
      } catch {
        /* already stopped */
      }
    };
    h.oscs.forEach(stop);
    stop(h.noiseSrc);
    stop(h.sampleSrc);
    h.lfos?.forEach((l) => {
      try {
        l.stop(stopAt); // stop vibrato + patch LFOs with the voice
      } catch {
        /* already stopped */
      }
    });
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
    // drum-track preview: a note in the drum piano-roll triggers the pitch's kit lane
    // as a one-shot (no sustained voice), so it sounds like the drum it edits.
    const dt = cid ? this.arrangement.tracks.find((tr) => tr.id === cid && tr.kind === "drum") : undefined;
    if (dt) {
      const kit = KITS.find((k) => k.id === this.drumTrackKitId(dt)) || this.kit;
      const lane = kit.lanes[midi - DRUM_BASE];
      if (lane) this.voiceDrum(lane, this.ctx!.currentTime, vel > 0.85 ? 1 : 0.7, this.trackStrip(dt));
      return;
    }
    this.noteOff(midi, true, cid);
    // `cid` may name a beat-maker channel OR an arrangement track — resolve whichever
    // it is so previewing a note in the piano roll auditions that instrument, not the
    // global Audio-Lab patch. (ids don't collide: "ch…" vs "t…".)
    const sel = this.voiceForId(cid);
    this._liveVoices[this.liveKey(midi, cid)] = this.startVoiceAt(midi, vel, this.ctx!.currentTime, sel);
    this.emit("synth");
  }
  // the kit a drum track's clips use (from the first drum clip, else the current kit)
  private drumTrackKitId(t: ArrTrack): string {
    for (const clip of t.clips) if (clip.content.kind === "drum") return clip.content.pattern.kitId || this.kit.id;
    return this.kit.id;
  }
  // resolve a channel/track id to its voice selection (undefined = global patch)
  private voiceForId(id: string | undefined): VoiceSel | undefined {
    if (!id) return undefined;
    const ch = this.sequence.channels.find((c) => c.id === id);
    if (ch) return this.channelVoice(ch);
    const t = this.arrangement.tracks.find((tr) => tr.id === id);
    if (t && t.kind === "midi") return this.trackVoice(t);
    return undefined;
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
  // resolve an instrument id (a patch key OR a legacy sampled-preset id) to a live
  // SynthPatch, seeding a preset-patch on demand. Falls back to the active patch.
  private resolvePatch(id: string | undefined): SynthPatch {
    if (id && this.patches[id]) return this.patches[id];
    const pr = id ? this.samplePresets.find((p) => p.id === id) : undefined;
    if (pr) {
      if (!(pr.name in this.patches) && pr.zones.length) this.patches[pr.name] = patchFromPreset(pr, pr.id);
      if (this.patches[pr.name]) return this.patches[pr.name];
    }
    return this.currentPatch();
  }
  private channelVoice(ch: MidiChannel): VoiceSel {
    return { patch: this.resolvePatch(ch.presetId), dest: this.channelStrip(ch) };
  }

  // Group a clip's notes into FL-style legato voice runs. A `slide` note that is
  // contiguous with (or overlaps) the currently-open run bends that one voice to a
  // new pitch (no re-attack); anything else opens a fresh run. An orphan slide (no
  // open run to continue) articulates normally as its own head.
  //
  // Monophonic-per-channel: a `slide` chains onto the LAST-opened run. Non-slide
  // chord tones each open their own (independent) run, so a chord rings untouched —
  // but a slide placed right after a chord chains onto the top chord tone (the last
  // opened). For a clean sliding lead over chords, put the lead on its own channel.
  private buildRuns(notes: Note[]): NoteRun[] {
    const sorted = [...notes].sort((a, b) => a.start - b.start || a.pitch - b.pitch);
    const runs: NoteRun[] = [];
    let open: NoteRun | null = null;
    const EPS = 1e-4;
    for (const n of sorted) {
      // a slide note continues the open run if it starts at/before that run's end
      if (n.slide && open && n.start <= open.endBeat + EPS) {
        open.bends.push({ toMidi: n.pitch, fromBeat: n.start, atBeat: n.start + n.length });
        open.endBeat = Math.max(open.endBeat, n.start + n.length);
      } else {
        open = { startBeat: n.start, endBeat: n.start + n.length, pitch: n.pitch, vel: n.vel, bends: [] };
        runs.push(open);
      }
    }
    return runs;
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
    const presetId = this.synthPatches[0]; // a unified patch key (built-in / user / preset-patch)
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
    this.warmPatch(this.resolvePatch(presetId)); // decode a sampled patch's zones ahead of play
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

  // ── arrangement (linear timeline): tracks + placed clips ──────────────────
  private saveArr() {
    saveArrangement(this.arrangement);
    this.emit("arrange");
  }
  // lazily build a track's vol→pan→sum strip (mirrors channelStrip); returns the input gain
  private trackStrip(t: ArrTrack): GainNode {
    const c = this.ensureCtx();
    const n = this.nodes!;
    let s = this._arrStrips[t.id];
    if (!s) {
      const gain = c.createGain();
      const pan = c.createStereoPanner();
      gain.connect(pan);
      pan.connect(n.sum);
      s = this._arrStrips[t.id] = { gain, pan };
    }
    s.gain.gain.value = t.vol * this.trackGain(t);
    s.pan.pan.value = t.pan;
    return s.gain;
  }
  private anyTrackSolo(): boolean {
    return this.arrangement.tracks.some((t) => t.solo);
  }
  private trackGain(t: ArrTrack): number {
    if (t.mute) return 0;
    return this.anyTrackSolo() && !t.solo ? 0 : 1;
  }
  private refreshTrackGains() {
    if (!this.ctx) return;
    const tt = this.ctx.currentTime;
    for (const t of this.arrangement.tracks) {
      const s = this._arrStrips[t.id];
      if (s) s.gain.gain.setTargetAtTime(t.vol * this.trackGain(t), tt, 0.02);
    }
  }
  // resolve a midi track's instrument to a VoiceSel routed to its strip
  private trackVoice(t: ArrTrack): VoiceSel {
    return { patch: this.resolvePatch(t.presetId), dest: this.trackStrip(t) };
  }

  // ── track CRUD ──
  addTrack(kind: TrackKind, name?: string): ArrTrack {
    const n = this.arrangement.tracks.length + 1;
    const t: ArrTrack = {
      id: newTrackId(),
      name: name || (kind === "midi" ? "midi " + n : kind === "drum" ? "drums " + n : "audio " + n),
      kind,
      presetId: kind === "midi" ? this.synthPatches[0] : undefined, // unified patch key
      mute: false,
      solo: false,
      vol: 0.8,
      pan: 0,
      clips: [],
    };
    if (t.presetId) this.warmPatch(this.resolvePatch(t.presetId));
    this.arrangement.tracks.push(t);
    this.saveArr();
    return t;
  }
  removeTrack(id: string) {
    const t = this.findTrack(id);
    if (t) for (const c of t.clips) this.stopAudioForClip(c.id); // stop any live audio
    this.arrangement.tracks = this.arrangement.tracks.filter((t) => t.id !== id);
    const s = this._arrStrips[id];
    if (s) {
      try {
        s.gain.disconnect();
        s.pan.disconnect();
      } catch {
        /* fine */
      }
      delete this._arrStrips[id];
    }
    this.saveArr();
  }
  private findTrack(id: string) {
    return this.arrangement.tracks.find((t) => t.id === id);
  }
  renameTrack(id: string, name: string) {
    const t = this.findTrack(id);
    if (t) t.name = name;
    this.saveArr();
  }
  setTrackPreset(id: string, presetId: string) {
    const t = this.findTrack(id);
    if (!t) return;
    t.presetId = presetId;
    this.warmPatch(this.resolvePatch(presetId)); // decode a sampled patch's zones ahead of play
    this.saveArr();
  }
  setTrackVol(id: string, vol: number) {
    const t = this.findTrack(id);
    if (!t) return;
    t.vol = Math.min(1, Math.max(0, vol));
    const s = this._arrStrips[id];
    if (s && this.ctx) s.gain.gain.setTargetAtTime(t.vol * this.trackGain(t), this.ctx.currentTime, 0.02);
    this.saveArr();
  }
  setTrackPan(id: string, pan: number) {
    const t = this.findTrack(id);
    if (!t) return;
    t.pan = Math.min(1, Math.max(-1, pan));
    const s = this._arrStrips[id];
    if (s && this.ctx) s.pan.pan.setTargetAtTime(t.pan, this.ctx.currentTime, 0.02);
    this.saveArr();
  }
  toggleTrackMute(id: string) {
    const t = this.findTrack(id);
    if (t) t.mute = !t.mute;
    this.refreshTrackGains();
    this.saveArr();
  }
  toggleTrackSolo(id: string) {
    const t = this.findTrack(id);
    if (t) t.solo = !t.solo;
    this.refreshTrackGains(); // solo is global across tracks
    this.saveArr();
  }
  toggleTrackCollapsed(id: string) {
    const t = this.findTrack(id);
    if (t) t.collapsed = !t.collapsed;
    this.saveArr();
  }

  // ── clip CRUD ──
  private findClip(trackId: string, clipId: string): [ArrTrack, ArrClip] | null {
    const t = this.findTrack(trackId);
    const c = t?.clips.find((x) => x.id === clipId);
    return t && c ? [t, c] : null;
  }
  addClip(trackId: string, clip: Omit<ArrClip, "id">): ArrClip | null {
    const t = this.findTrack(trackId);
    if (!t) return null;
    const c: ArrClip = { ...clip, id: newClipId() };
    t.clips.push(c);
    this.resolveOverlaps(t, c);
    this.saveArr();
    return c;
  }
  // One track = one lane: no two clips may overlap. Given a just-placed/moved clip
  // `keep`, adjust every OTHER clip on the track so nothing overlaps [ks,ke):
  //  · fully covered  → removed
  //  · overlaps the front (starts before, ends inside) → trimmed to end at ks
  //  · overlaps the back  (starts inside, ends after)  → start pushed to ke, shortened
  private resolveOverlaps(t: ArrTrack, keep: ArrClip) {
    const ks = keep.startBeat;
    const ke = keep.startBeat + keep.lengthBeats;
    const out: ArrClip[] = [];
    for (const c of t.clips) {
      if (c.id === keep.id) { out.push(c); continue; }
      const cs = c.startBeat;
      const ce = c.startBeat + c.lengthBeats;
      if (ce <= ks || cs >= ke) { out.push(c); continue; } // no overlap
      if (cs >= ks && ce <= ke) { this.stopAudioForClip(c.id); continue; } // fully covered → drop
      if (cs < ks && ce > ks) {
        // front overlap → shorten to end at ks (and if it ALSO pokes out the back past
        // ke, we lose that tail; a split is out of scope — trimming is the simple rule)
        c.lengthBeats = Math.max(0.25, ks - cs);
        this.stopAudioForClip(c.id); // its geometry changed → re-fire fresh
        out.push(c);
      } else if (cs < ke && ce > ke) {
        // back overlap → push start to ke, keep the remaining tail length
        c.lengthBeats = Math.max(0.25, ce - ke);
        c.startBeat = ke;
        this.stopAudioForClip(c.id);
        out.push(c);
      } else {
        out.push(c);
      }
    }
    t.clips = out;
  }
  removeClip(trackId: string, clipId: string) {
    const t = this.findTrack(trackId);
    if (t) t.clips = t.clips.filter((c) => c.id !== clipId);
    this.stopAudioForClip(clipId); // kill its live source so deleting stops the sound
    this.saveArr();
  }
  // move a clip (optionally to another track); startBeat clamped ≥ 0
  moveClip(trackId: string, clipId: string, startBeat: number, toTrackId?: string) {
    const found = this.findClip(trackId, clipId);
    if (!found) return;
    const [from, c] = found;
    c.startBeat = Math.max(0, startBeat);
    let dest = from;
    if (toTrackId && toTrackId !== trackId) {
      const to = this.findTrack(toTrackId);
      if (to && to.kind === from.kind) {
        from.clips = from.clips.filter((x) => x.id !== clipId);
        to.clips.push(c);
        dest = to;
      }
    }
    this.stopAudioForClip(clipId); // re-fire at the new position/track next tick
    this.resolveOverlaps(dest, c);
    this.saveArr();
  }
  resizeClip(trackId: string, clipId: string, lengthBeats: number) {
    const found = this.findClip(trackId, clipId);
    if (!found) return;
    found[1].lengthBeats = Math.max(0.25, lengthBeats);
    this.stopAudioForClip(clipId); // re-fire with the new length (fixes stale stop time)
    this.resolveOverlaps(found[0], found[1]);
    this.saveArr();
  }
  duplicateClip(trackId: string, clipId: string): ArrClip | null {
    const found = this.findClip(trackId, clipId);
    if (!found) return null;
    const [t, c] = found;
    const copy: ArrClip = { ...structuredClone(c), id: newClipId(), startBeat: c.startBeat + c.lengthBeats };
    t.clips.push(copy);
    this.resolveOverlaps(t, copy);
    this.saveArr();
    return copy;
  }
  // write back edited clip content (from the piano roll / step grid / loop editor)
  setClipContent(trackId: string, clipId: string, content: ArrClip["content"]) {
    const found = this.findClip(trackId, clipId);
    const prev = found?.[1].content;
    if (found) found[1].content = content;
    // Reflect the edit on a clip that's playing RIGHT NOW:
    //  · RATE-only change (sync / semi / cents) → smoothly re-rate the live source (no
    //    gap) so a knob drag warbles continuously.
    //  · STRUCTURAL change (trim a/b, reverse, loop region, the buffer/source itself)
    //    can't be patched on a live node → stop it so the scheduler re-fires it fresh.
    if (content.kind === "audio" && this.ctx && prev?.kind === "audio") {
      const structural =
        prev.bufId !== content.bufId ||
        prev.loopId !== content.loopId ||
        prev.reverse !== content.reverse ||
        (prev.a ?? 0) !== (content.a ?? 0) ||
        (prev.b ?? 1) !== (content.b ?? 1) ||
        prev.loopA !== content.loopA ||
        prev.loopB !== content.loopB;
      if (structural) {
        this.stopAudioForClip(clipId); // re-fire with the new trim/reverse/loop next tick
      } else {
        const rate = this.audioClipRate(content);
        const tt = this.ctx.currentTime;
        for (const key in this._startedAudio) {
          if (!key.startsWith(clipId + "@")) continue;
          const a = this._startedAudio[key];
          a.src.playbackRate.setTargetAtTime(rate, tt, 0.02);
          a.synced = !!content.sync;
          a.baseRate = rate;
          a.baseBpm = this.bpm; // re-base so future tempo drags scale from here
        }
      }
    }
    this.saveArr();
  }
  toggleClipLoop(trackId: string, clipId: string) {
    const found = this.findClip(trackId, clipId);
    if (found) found[1].loop = !found[1].loop;
    this.saveArr();
  }
  getArrClip(trackId: string, clipId: string): ArrClip | null {
    return this.findClip(trackId, clipId)?.[1] || null;
  }

  setArrangementBpm(bpm: number) {
    this.arrangement.bpm = Math.min(220, Math.max(40, Math.round(bpm)));
    if (this.arrangeMode) this.setBpm(this.arrangement.bpm);
    else this.saveArr();
  }
  setArrangementLoop(start: number, end: number, on: boolean) {
    this.arrangement.loop = { start: Math.max(0, start), end: Math.max(start + 0.25, end), on };
    this.loopOn = on;
    this.saveArr();
  }

  // trigger one drum lane at an explicit time: decoded sample if present, else a
  // synthesized hit. Routes to n.sum so it shares the FX rack. `accent` boosts level.
  // beat-maker drum hit: the global kit, its own mute/solo, → sum.
  triggerDrum(laneId: string, when: number, accent = false) {
    const vel = (accent ? 1 : 0.7) * this.drumGain(laneId); // mute/solo → 0 = silent
    if (vel <= 0) return; // muted or solo'd-out — skip the voice entirely
    const lane = this.kit.lanes.find((l) => l.id === laneId);
    if (lane) this.voiceDrum(lane, when, vel, this.nodes!.sum);
  }

  // Voice one drum lane at `when`, into `dest`. Uses the lane's decoded one-shot when
  // available (looked up by lane id across kits), else its fallback synth voice. Shared
  // by the beat-maker (→ sum) and arrangement drum clips (→ the track strip).
  private voiceDrum(lane: DrumLane, when: number, vel: number, dest: AudioNode) {
    const c = this.ensureCtx();
    const buf = this._drumBufs[lane.id];
    if (buf) {
      const g = c.createGain();
      g.gain.value = vel;
      const src = c.createBufferSource();
      src.buffer = buf;
      src.connect(g);
      g.connect(dest);
      src.start(when);
      src.onended = () => {
        try {
          g.disconnect();
        } catch {
          /* fine */
        }
      };
    } else {
      this.synthDrum(lane.synth, when, vel, dest);
    }
  }

  // metronome click: a short pitched blip → straight to master (not through a track
  // strip, so mute/solo/FX don't touch it). Accent = higher pitch on the bar downbeat.
  private metroClick(when: number, accent: boolean) {
    const c = this.ensureCtx();
    const n = this.nodes!;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = "square";
    o.frequency.value = accent ? 2000 : 1400;
    const peak = this.metronomeVol * 0.5;
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(peak, when + 0.001);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.04);
    o.connect(g);
    g.connect(n.sum);
    o.start(when);
    o.stop(when + 0.05);
    o.onended = () => {
      try { g.disconnect(); } catch { /* fine */ }
    };
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
  private synthDrum(kind: DrumSynth, t: number, vel: number, dest?: AudioNode) {
    const c = this.ctx!;
    const n = this.nodes!;
    const out = c.createGain();
    out.gain.value = 1;
    out.connect(dest ?? n.sum);
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
    let a = Math.min(0.999, Math.max(0, st?.a ?? 0));
    let b = Math.max(a + 0.001, Math.min(1, st?.b ?? 1));
    if (st?.reverse) [a, b] = [1 - b, 1 - a]; // buffer is reversed → flip the region
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
      const raw = this._loopBufs[l.id];
      const st = this.sequence.loops[l.id];
      if (!raw || !st?.on) continue;
      const buf = st.reverse ? this.reversedBuffer("loop:" + l.id, raw) : raw;
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
    const d = AudioEngine.DECLICK;
    for (const id in this._loopNodes) {
      const { src, gain } = this._loopNodes[id];
      // declick: fade the loop gain to 0, then stop just after the fade completes
      try {
        gain.gain.cancelScheduledValues(now);
        gain.gain.setValueAtTime(gain.gain.value, now);
        gain.gain.linearRampToValueAtTime(0, now + d);
        src.stop(now + d + 0.005);
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
    // declick: linear fade to true 0 over DECLICK, stop just after it completes
    // (the old setTargetAtTime only approached 0 and was cut ~3 time-constants in).
    node.gain.gain.cancelScheduledValues(now);
    node.gain.gain.setValueAtTime(node.gain.gain.value, now);
    node.gain.gain.linearRampToValueAtTime(0, now + AudioEngine.DECLICK);
    try {
      node.src.stop(now + AudioEngine.DECLICK + 0.005);
    } catch {
      /* fine */
    }
    delete this._loopNodes[id];
  }

  // start a single loop on the next bar boundary (for mid-play toggles)
  private startOneLoopAligned(id: string) {
    const c = this.ctx!;
    const n = this.nodes!;
    const raw = this._loopBufs[id];
    const l = this.loops.find((x) => x.id === id);
    if (!raw || !l) return;
    const buf = this.sequence.loops[id]?.reverse ? this.reversedBuffer("loop:" + id, raw) : raw;
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
  // Reverse a loop's playback. Swapping the buffer can't be done on a live node, so
  // if it's playing we stop + restart it aligned to the next bar (a brief gap, like a
  // re-trigger). Stopped loops just flip the flag and reverse on next start.
  toggleLoopReverse(id: string) {
    const st = this.sequence.loops[id];
    if (!st) return;
    st.reverse = !st.reverse;
    if (this._loopNodes[id] && this.beatMode && this.sequencePlaying) {
      this.stopOneLoop(id);
      this.startOneLoopAligned(id);
    }
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

  // Does this audio clip overflow its content (so it auto-loops to fill)? Mirrors the
  // scheduler's rule: clipLenSec > contentSec at the clip's rate. Used by the editor to
  // show/hide the loop-seam controls.
  audioClipLoops(clip: ArrClip): boolean {
    if (clip.content.kind !== "audio") return false;
    const cc = clip.content;
    const buf = cc.bufId ? this._importBufs[cc.bufId] : cc.loopId ? this._loopBufs[cc.loopId] : undefined;
    if (!buf) return false;
    const a = Math.min(0.999, Math.max(0, cc.a ?? 0));
    const b = Math.min(1, Math.max(a + 0.001, cc.b ?? 1));
    let rate = 1;
    if (cc.sync && cc.rootBpm && cc.rootBpm > 0) rate = this.bpm / cc.rootBpm;
    rate *= Math.pow(2, (cc.semi ?? 0) / 12 + (cc.cents ?? 0) / 1200);
    const contentSec = rate > 0 ? ((b - a) * buf.duration) / rate : (b - a) * buf.duration;
    const clipLenSec = clip.lengthBeats * (60 / this.bpm);
    return clipLenSec > contentSec + 0.01;
  }

  // ── imported audio clips (session-only file import) ──
  // Decode a user-picked File into a session buffer; returns its bufId + the filename-
  // detected meta (bpm/key/bars, same parser LoopLanes use), so a dropped clip auto-fills.
  async importAudio(file: File): Promise<{ bufId: string; name: string; seconds: number; bpm?: number; bars?: number; key?: string } | null> {
    const c = this.ensureCtx();
    try {
      const ab = await file.arrayBuffer();
      const buf = await c.decodeAudioData(ab);
      const bufId = "imp" + ++this._importSeq + Date.now().toString(36);
      this._importBufs[bufId] = buf;
      this.emit("arrange");
      const stem = file.name.replace(/\.[^.]+$/, ""); // drop the extension
      const meta = parseLoopMeta(stem);
      return { bufId, name: meta.name || file.name, seconds: buf.duration, bpm: meta.bpm, bars: meta.bars, key: meta.key };
    } catch {
      return null; // undecodable file
    }
  }
  // reverse an imported buffer (cached), for reverse playback. Returns a NEW buffer.
  private _reverseBufs: Record<string, AudioBuffer> = {};
  private reversedBuffer(bufId: string, src: AudioBuffer): AudioBuffer {
    const hit = this._reverseBufs[bufId];
    if (hit) return hit;
    const c = this.ensureCtx();
    const out = c.createBuffer(src.numberOfChannels, src.length, src.sampleRate);
    for (let ch = 0; ch < src.numberOfChannels; ch++) {
      const inD = src.getChannelData(ch);
      const outD = out.getChannelData(ch);
      const N = inD.length;
      for (let i = 0; i < N; i++) outD[i] = inD[N - 1 - i];
    }
    this._reverseBufs[bufId] = out;
    return out;
  }
  hasImport(bufId: string): boolean {
    return !!this._importBufs[bufId];
  }
  importSeconds(bufId: string): number {
    return this._importBufs[bufId]?.duration ?? 0;
  }
  // waveform peaks for an imported buffer (same idiom as loopPeaks)
  importPeaks(bufId: string, bins: number): Float32Array | null {
    const buf = this._importBufs[bufId];
    if (!buf) return null;
    const key = bufId + ":" + bins;
    const cached = this._importPeaks[key];
    if (cached) return cached;
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
    this._importPeaks[key] = peaks;
    return peaks;
  }

  // the zone index of a preset nearest C4 (midi 60) — the one we show as the visual
  presetC4Zone(presetId: string): number {
    const preset = this.samplePresets.find((p) => p.id === presetId);
    if (!preset || !preset.zones.length) return -1;
    let idx = 0;
    let best = Infinity;
    preset.zones.forEach((z, i) => {
      const d = Math.abs(z.rootMidi - 60);
      if (d < best) {
        best = d;
        idx = i;
      }
    });
    return idx;
  }
  // waveform peaks for a decoded preset zone (mirrors loopPeaks). Cached per
  // "presetId:zoneIdx:bins". null if the zone isn't decoded yet.
  // Peak envelope over a fraction range [from,to] of the zone buffer, binned to `bins`.
  // Range support lets the sample view zoom in and still resolve fine detail. Cached per
  // (preset, zone, bins, range); the common whole-buffer call reuses one entry.
  presetPeaks(presetId: string, zoneIdx: number, bins: number, from = 0, to = 1): Float32Array | null {
    const buf = this._sampleBufs[presetId]?.[zoneIdx];
    if (!buf) return null;
    const key = presetId + ":" + zoneIdx + ":" + bins + ":" + from.toFixed(4) + ":" + to.toFixed(4);
    const cached = this._presetPeaks[key];
    if (cached) return cached;
    const ch0 = buf.getChannelData(0);
    const ch1 = buf.numberOfChannels > 1 ? buf.getChannelData(1) : ch0;
    const N = ch0.length;
    const s0 = Math.max(0, Math.floor(from * N));
    const s1 = Math.min(N, Math.ceil(to * N));
    const span = Math.max(1, s1 - s0);
    const per = Math.max(1, Math.floor(span / bins));
    const step = Math.max(1, Math.floor(per / 256)); // subsample big bins for speed
    const peaks = new Float32Array(bins);
    for (let b = 0; b < bins; b++) {
      let max = 0;
      const start = s0 + b * per;
      for (let i = start; i < start + per && i < s1; i += step) {
        const a = Math.abs((ch0[i] + ch1[i]) * 0.5);
        if (a > max) max = a;
      }
      peaks[b] = max;
    }
    this._presetPeaks[key] = peaks;
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
    const prevBpm = this.bpm; // for live re-rating of synced audio clips
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
      // synced audio clips re-rate live: playbackRate ∝ bpm, recomputed from the base
      // (drift-free across rapid drags). This is the real-time pitch rise/fall while
      // dragging the tempo — the tape-warble effect.
      if (bpm !== prevBpm) {
        for (const key in this._startedAudio) {
          const a = this._startedAudio[key];
          if (a.synced && a.baseBpm > 0) a.src.playbackRate.setTargetAtTime(a.baseRate * (bpm / a.baseBpm), tt, 0.02);
        }
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

  // total beats of whatever's currently playing. In beat mode the transport loops
  // over the LONGEST element — the drum grid, any MIDI channel clip, or any "on"
  // loop — rather than letting the drum grid alone dictate length. So a 2-bar MIDI
  // phrase under a 1-bar drum pattern plays its full length instead of being cut at
  // bar 1. (A stopgap until a real timeline; channels with their own `loop` flag
  // still repeat over their own clip within this total.)
  private activeTotalBeats(): number {
    if (this.arrangeMode) return arrangementBeats(this.arrangement);
    if (!this.beatMode) return this._clip ? clipBeats(this._clip) : 0;
    const seq = this.sequence;
    let total = seq.steps * STEP_BEATS; // drum grid
    for (const ch of seq.channels) total = Math.max(total, clipBeats(ch.clip));
    for (const l of this.loops) {
      if (this.sequence.loops[l.id]?.on) total = Math.max(total, l.bars * seq.beatsPerBar);
    }
    return total;
  }

  // current beat position from the ctx clock. In arrange mode the playhead wraps at
  // the loop BRACE (not [0,total)); otherwise it wraps the active loop cycle.
  private currentBeat(): number {
    if (!this.ctx) return 0;
    const elapsed = this.ctx.currentTime - this._seqAnchorTime;
    let beat = this._seqAnchorBeat + elapsed / this.beatDur();
    if (this.arrangeMode) {
      const br = this.loopOn && this.arrangement.loop?.on ? this.arrangement.loop : null;
      if (br) {
        const len = br.end - br.start;
        beat = br.start + (((beat - br.start) % len) + len) % len;
      }
      return Math.max(0, beat);
    }
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
      bars: this.arrangeMode ? Math.max(1, total / this.arrangement.beatsPerBar) : this.beatMode ? Math.max(1, total / this.sequence.beatsPerBar) : this._clip ? this._clip.bars : 0,
      playing: this.sequencePlaying,
      step: this.beatMode && !this.arrangeMode && this.sequencePlaying ? Math.floor(beat / STEP_BEATS) % this.sequence.steps : -1,
    };
  }

  // arrangement playhead beat for the timeline (or the pending seek when stopped)
  arrangementPosition(): number {
    if (this.arrangeMode && this.sequencePlaying) return this.currentBeat();
    return this._pendingSeekBeat;
  }

  playSequence(fromBeat = 0) {
    if (!this.arrangeMode && !this.beatMode && !this._clip) return;
    const c = this.ensureCtx();
    // transport mutual-exclusion: track playback and the sequencer can't both
    // drive the graph (double-sum + corrupt metering)
    if (this.playing) this.pause();
    this.transportMode = "sequence";
    this.sequencePlaying = true;
    let start = c.currentTime + 0.08; // small headroom before first note
    // count-in: schedule N bars of metronome click BEFORE the transport rolls, and push
    // the anchor forward by that duration so playback starts on the downbeat after it.
    if (this.arrangeMode && this.countInBars > 0) {
      const bpb = this.arrangement.beatsPerBar;
      const bd = 60 / this.arrangement.bpm;
      const beats = this.countInBars * bpb;
      for (let i = 0; i < beats; i++) this.metroClick(start + i * bd, i % bpb === 0);
      start += beats * bd;
    }
    this._seqAnchorTime = start;
    this._seqAnchorBeat = this.arrangeMode ? fromBeat || this._pendingSeekBeat : 0;
    this._pendingSeekBeat = 0;
    this._scheduledThrough = start;
    this._metroThrough = this._seqAnchorBeat - 1; // so the first in-song beat clicks
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
    this.stopAudioClips();
    this.emit("transport");
    this.emit("state");
  }
  // stop + forget any playing audio-clip sources (on stop/seek, so replay re-fires them)
  private stopAudioClips() {
    for (const key in this._startedAudio) {
      try { this._startedAudio[key].src.stop(); } catch { /* already ended */ }
    }
    this._startedAudio = {};
  }
  // Stop + forget any playing audio source(s) for ONE clip, so the scheduler re-fires it
  // fresh at the next tick with its new geometry. Called whenever a clip's position /
  // length changes, it's removed, or an overlap trims it — otherwise the old long-held
  // AudioBufferSourceNode keeps playing at the stale position/routing (ghost audio).
  private stopAudioForClip(clipId: string) {
    for (const key in this._startedAudio) {
      if (!key.startsWith(clipId + "@")) continue;
      try { this._startedAudio[key].src.stop(); } catch { /* already ended */ }
      delete this._startedAudio[key];
    }
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

  // ── arrangement transport ──
  // Start the linear timeline scheduler. `fromBeat` seeds the playhead (0 = song
  // start). Mirrors playBeat but sets arrangeMode; the loop brace drives looping.
  // decode the sampled presets every midi track uses, so restored/selected tracks
  // don't fall back to the synth (a preset with no decoded zones voices as glass pad).
  warmArrangement() {
    const warmedKits = new Set<string>();
    for (const t of this.arrangement.tracks) {
      if (t.kind === "midi" && t.presetId) this.warmPatch(this.resolvePatch(t.presetId));
      // decode each drum clip's kit one-shots so timeline drums play their samples
      for (const clip of t.clips) {
        if (clip.content.kind !== "drum") continue;
        const kitId = clip.content.pattern.kitId || this.kit.id;
        if (warmedKits.has(kitId)) continue;
        warmedKits.add(kitId);
        const kit = KITS.find((kt) => kt.id === kitId);
        if (kit) void this.loadKit(kit);
      }
    }
  }
  playArrangement(fromBeat = 0) {
    this.arrangeMode = true;
    this.beatMode = false;
    this.bpm = this.arrangement.bpm;
    this.loopOn = !!this.arrangement.loop?.on;
    this.warmArrangement(); // decode track instruments before scheduling
    void this.loadLoops(); // audio-loop buffers (Phase 3)
    this.playSequence(fromBeat);
  }
  stopArrangement() {
    this.stopSequence();
    this.arrangeMode = false;
  }
  toggleArrangement() {
    if (this.sequencePlaying && this.arrangeMode) this.stopArrangement();
    else this.playArrangement();
  }
  // ── transport verbs (playback pane) ──
  // play from the current playhead (a prior seek / where it was paused), not always 0
  playArrangementFromCursor() {
    if (this.sequencePlaying && this.arrangeMode) return;
    this.playArrangement(this._pendingSeekBeat);
  }
  // pause: stop the clock but REMEMBER the position (resume from here)
  pauseArrangement() {
    if (!(this.sequencePlaying && this.arrangeMode)) return;
    const at = this.currentBeat();
    this.stopArrangement();
    this._pendingSeekBeat = Math.max(0, at);
    this.emit("transport");
  }
  // stop: halt and return the playhead to the start (loop-brace start if looping, else 0)
  stopArrangementToStart() {
    const home = this.loopOn && this.arrangement.loop?.on ? this.arrangement.loop.start : 0;
    if (this.sequencePlaying && this.arrangeMode) this.stopArrangement();
    this._pendingSeekBeat = home;
    this.emit("transport");
  }
  // return-to-start without stopping playback (⏮): seek to home
  returnToStart() {
    const home = this.loopOn && this.arrangement.loop?.on ? this.arrangement.loop.start : 0;
    this.seekArrangement(home);
  }
  // time signature: beats per bar (drives the ruler grid + bar math everywhere)
  setBeatsPerBar(n: number) {
    this.arrangement.beatsPerBar = Math.min(12, Math.max(1, Math.round(n)));
    this.saveArr();
    this.emit("arrange");
    this.emit("transport");
  }
  setMetronome(on: boolean) {
    this.metronome = on;
    this.emit("transport");
  }
  setMetronomeVol(v: number) {
    this.metronomeVol = Math.min(1, Math.max(0, v));
    this.emit("transport");
  }
  setCountInBars(bars: number) {
    this.countInBars = Math.min(2, Math.max(0, Math.round(bars)));
    this.emit("transport");
  }
  setFollowPlayhead(on: boolean) {
    this.followPlayhead = on;
    this.emit("transport");
  }
  setSnapBeats(beats: number) {
    this.snapBeats = Math.max(0, beats);
    this.emit("transport");
  }
  // the insert marker: shared cursor for paste / create / split. Emits `arrange` so the
  // timeline redraws it.
  setInsertBeat(beat: number) {
    this.insertBeat = Math.max(0, beat);
    this.emit("arrange");
  }
  // tap tempo: average the intervals between recent taps (drops stale/outlier taps)
  private _taps: number[] = [];
  tapTempo() {
    const now = (this.ctx?.currentTime ?? performance.now() / 1000);
    const last = this._taps[this._taps.length - 1];
    if (last != null && now - last > 2.5) this._taps = []; // gap → start a new set
    this._taps.push(now);
    if (this._taps.length > 5) this._taps.shift();
    if (this._taps.length >= 2) {
      let sum = 0;
      for (let i = 1; i < this._taps.length; i++) sum += this._taps[i] - this._taps[i - 1];
      const avg = sum / (this._taps.length - 1);
      if (avg > 0) this.setArrangementBpm(Math.round(60 / avg));
    }
  }
  // move the playhead to `beat` while playing, via the re-anchor trick (same as
  // setBpm): anchor the clock at the target beat now, re-schedule from here.
  seekArrangement(beat: number) {
    beat = Math.max(0, beat);
    if (this.sequencePlaying && this.arrangeMode && this.ctx) {
      const now = this.ctx.currentTime;
      // release ringing voices + audio clips so a seek doesn't leave stuck sound
      this._seqVoices.forEach((h) => this.releaseVoice(h, now, true));
      this._seqVoices = [];
      this.stopAudioClips();
      this._seqAnchorBeat = beat;
      this._seqAnchorTime = now;
      this._scheduledThrough = now;
      this._metroThrough = Math.ceil(beat) - 1; // re-align clicks to the new position
      this.schedTick();
    } else {
      this._pendingSeekBeat = beat; // remembered until play (start from here)
    }
    this.emit("transport");
  }
  private _pendingSeekBeat = 0;

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

  // playbackRate for an audio clip: grid-sync (bpm/rootBpm) × varispeed (semi+cents).
  // The single source of truth for rate, shared by the scheduler and live re-rating.
  private audioClipRate(cc: { sync?: boolean; rootBpm?: number; semi?: number; cents?: number }): number {
    let rate = 1;
    if (cc.sync && cc.rootBpm && cc.rootBpm > 0) rate = this.bpm / cc.rootBpm;
    rate *= Math.pow(2, (cc.semi ?? 0) / 12 + (cc.cents ?? 0) / 1200);
    return rate;
  }

  // Start an audio clip's decoded buffer at its timeline position. Unlike note/drum
  // events (many short voices), an audio clip is ONE long source, so we fire it once
  // per playback pass (deduped in _startedAudio) when its start beat enters the window
  // — or immediately with an offset if the playhead began mid-clip. Honors a/b trim,
  // per-clip gain, the track strip, and the loop brace (one instance per brace pass).
  private scheduleAudioClip(
    t: ArrTrack,
    clip: ArrClip,
    fromBeatAbs: number,
    toBeatAbs: number,
    whenOf: (b: number) => number,
    bd: number,
    brace: { start: number; end: number } | null,
  ) {
    if (clip.content.kind !== "audio") return;
    const cc = clip.content;
    let srcBuf = cc.bufId ? this._importBufs[cc.bufId] : cc.loopId ? this._loopBufs[cc.loopId] : undefined;
    if (!srcBuf) return; // not imported yet
    // reverse: swap to the reversed buffer (imports only) and flip the trim/loop fractions
    // so a/b keep meaning "the region you selected on the forward waveform".
    const rev = !!cc.reverse && !!cc.bufId;
    let ta = cc.a ?? 0, tb = cc.b ?? 1;
    let tla = cc.loopA, tlb = cc.loopB;
    if (rev) {
      srcBuf = this.reversedBuffer(cc.bufId!, srcBuf);
      [ta, tb] = [1 - tb, 1 - ta];
      if (tla != null && tlb != null) [tla, tlb] = [1 - tlb, 1 - tla];
    }
    const rawBuf = srcBuf;
    const braceLen = brace ? brace.end - brace.start : 0;
    // a/b trim (0..1 of the buffer) → seconds; per-clip gain
    const a = Math.min(0.999, Math.max(0, ta));
    const b = Math.min(1, Math.max(a + 0.001, tb));
    const dur = rawBuf.duration;
    const gainVal = cc.gain ?? 1;
    const trimmedSec = (b - a) * dur;
    // ── rate: grid-sync (match the arrangement tempo via the sample's native rootBpm,
    //    same as LoopLanes) × varispeed (semi+cents). No rootBpm ⇒ sync is a no-op. ──
    const rate = this.audioClipRate(cc);
    // ── auto-loop (Ableton song rule): a clip loops ONLY when it's longer than its
    //    content. contentSec = how long the trimmed region [a,b] plays in clip seconds;
    //    if the clip's length exceeds that, loop the loopA/loopB sub-region (default a/b)
    //    to fill the remainder — re-hashing from the loop start. No user toggle. ──
    const clipLenSec = clip.lengthBeats * bd;
    const contentSec = rate > 0 ? trimmedSec / rate : trimmedSec;
    const looping = clipLenSec > contentSec + 0.01 && !!cc.bufId;
    let buf = rawBuf;
    let loopStartSec = a * dur;
    let loopEndSec = b * dur;
    if (looping && cc.bufId) {
      // loop the sub-region loopA/loopB (defaults to the a/b trim), click-free
      let ls = tla ?? a; // already flipped for reverse
      let le = tlb ?? b;
      if (cc.snap !== false) {
        ls = this.snapZeroCross(rawBuf, ls);
        le = this.snapZeroCross(rawBuf, le);
        if (le <= ls) le = Math.min(1, ls + 0.001);
      }
      // distinct xfade cache key when reversed (different buffer, same bufId)
      buf = this.xfadeLoopBuffer(rawBuf, cc.bufId + (rev ? ":rev" : ""), 0, ls, le, cc.xfade ?? 0);
      loopStartSec = ls * dur;
      loopEndSec = le * dur;
    }
    // fire one instance at absolute start beat `sb`, optionally offset into the clip
    const fire = (sb: number, clipOffsetBeats: number) => {
      const key = clip.id + "@" + sb.toFixed(3);
      if (this._startedAudio[key]) return;
      const c = this.ctx!;
      const g = c.createGain();
      g.gain.value = gainVal;
      const src = c.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = rate;
      g.connect(this.trackStrip(t));
      src.connect(g);
      const catchUp = Math.max(0, clipOffsetBeats) * bd; // seconds into the clip already elapsed
      const when = Math.max(c.currentTime, whenOf(sb + clipOffsetBeats));
      // buffer offset advances at `rate` (buffer seconds per clip second)
      const offSec = a * dur + catchUp * rate;
      // both paths are hard-cut at the clip's end on the timeline
      const stopAt = whenOf(sb + clip.lengthBeats);
      if (looping) {
        src.loop = true;
        src.loopStart = loopStartSec;
        src.loopEnd = loopEndSec;
        src.start(when, Math.min(offSec, b * dur - 0.001));
        if (stopAt > when) src.stop(stopAt);
      } else {
        // one-shot: play the trimmed region, but never past the clip end (cut). The
        // buffer duration to schedule is the smaller of (content left) and (clip left).
        const bufLeft = trimmedSec - catchUp * rate; // buffer seconds remaining in [a,b]
        const clipLeft = (stopAt - when) * rate; // buffer seconds until the clip end
        const remain = Math.min(bufLeft, clipLeft);
        if (remain <= 0.001) return;
        src.start(when, Math.min(offSec, b * dur - 0.001), remain);
      }
      src.onended = () => {
        try { g.disconnect(); } catch { /* fine */ }
      };
      this._startedAudio[key] = { src, synced: !!cc.sync, baseRate: rate, baseBpm: this.bpm };
    };
    // brace loop: an instance per pass whose start lands in the window. Without a brace,
    // fire once when startBeat enters the window (or immediately if we began mid-clip).
    const passStarts = brace
      ? (() => {
          const out: number[] = [];
          for (let k = Math.floor((fromBeatAbs - clip.startBeat) / braceLen); ; k++) {
            const sb = clip.startBeat + k * braceLen;
            if (sb >= toBeatAbs) break;
            if (sb + clip.lengthBeats <= fromBeatAbs) continue;
            out.push(sb);
          }
          return out;
        })()
      : [clip.startBeat];
    for (const sb of passStarts) {
      const clipEnd = sb + clip.lengthBeats;
      // in the window? either the start is imminent, or we're already inside the clip
      if (clipEnd <= fromBeatAbs || sb >= toBeatAbs) continue;
      const offsetBeats = fromBeatAbs > sb ? fromBeatAbs - sb : 0; // mid-clip catch-up
      fire(sb, offsetBeats);
    }
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

    // ── linear arrangement branch ──
    // Walk placed clips; a clip's content sits at `clip.startBeat`. The global loop
    // brace (arrangement.loop, on ⇒ loopOn) wraps the WHOLE window at the brace
    // bounds — so we shift the lookahead window back into the brace and also probe
    // the previous wrap for clips straddling the brace start. Phase 1: MIDI clips.
    if (this.arrangeMode) {
      const brace = this.loopOn && this.arrangement.loop?.on ? this.arrangement.loop : null;
      const braceLen = brace ? brace.end - brace.start : 0;
      // Emit a voice for a run at its timeline beat, mapping into the lookahead
      // window. With the loop brace, an event only fires if it lives inside the
      // brace, and it repeats every braceLen — so we scan the wrap iterations `k`
      // that land in the window (mirrors the loop grid's k*total wrap).
      const emitRun = (run: NoteRun, timelineBeat: number, sel: VoiceSel, vibLane?: AutoLane) => {
        if (brace && (timelineBeat < brace.start || timelineBeat >= brace.end)) return;
        let k = brace ? Math.floor((fromBeatAbs - timelineBeat) / braceLen) : 0;
        for (; ; k++) {
          const absBeat = timelineBeat + (brace ? k * braceLen : 0);
          if (absBeat >= toBeatAbs) break;
          if (absBeat < fromBeatAbs) {
            if (!brace) break;
            continue;
          }
          const when = whenOf(absBeat);
          const off = when + Math.max(0.04, (run.endBeat - run.startBeat) * bd);
          const bends = run.bends.length
            ? run.bends.map((b) => ({ toMidi: b.toMidi, from: when + (b.fromBeat - run.startBeat) * bd, at: when + (b.atBeat - run.startBeat) * bd }))
            : undefined;
          const autoVib = vibLane?.points.length ? { points: vibLane.points, startBeat: run.startBeat, endBeat: run.endBeat, whenOfBeat: (cb: number) => when + (cb - run.startBeat) * bd, rate: vibLane.rate, intensity: vibLane.intensity } : undefined;
          const h = this.startVoiceAt(run.pitch, run.vel, when, sel, bends, autoVib);
          this.releaseVoice(h, off);
          this._seqVoices.push(h);
          if (!brace) break;
        }
      };
      // one drum hit at a timeline beat, wrapped through the loop brace like emitRun
      const emitDrum = (lane: DrumLane, timelineBeat: number, vel: number, dest: AudioNode) => {
        if (brace && (timelineBeat < brace.start || timelineBeat >= brace.end)) return;
        let k = brace ? Math.floor((fromBeatAbs - timelineBeat) / braceLen) : 0;
        for (; ; k++) {
          const absBeat = timelineBeat + (brace ? k * braceLen : 0);
          if (absBeat >= toBeatAbs) break;
          if (absBeat < fromBeatAbs) {
            if (!brace) break;
            continue;
          }
          this.voiceDrum(lane, whenOf(absBeat), vel, dest);
          if (!brace) break;
        }
      };
      for (const t of this.arrangement.tracks) {
        if (this.trackGain(t) <= 0) continue;
        for (const clip of t.clips) {
          if (clip.content.kind === "midi") {
            const sel = this.trackVoice(t);
            const vibLane = clip.content.clip.autos?.find((a) => a.target === "vibrato");
            const runs = this.buildRuns(clip.content.clip.notes);
            const contentLen = Math.max(0.25, clipBeats(clip.content.clip));
            // song rule: content tiles to fill the clip length automatically (no loop flag)
            const reps = Math.max(1, Math.ceil(clip.lengthBeats / contentLen));
            for (let r = 0; r < reps; r++) {
              const repOffset = r * contentLen;
              for (const run of runs) {
                if (run.startBeat + repOffset >= clip.lengthBeats) continue; // past the clip length
                emitRun(run, clip.startBeat + run.startBeat + repOffset, sel, vibLane);
              }
            }
          } else if (clip.content.kind === "drum") {
            const pat = clip.content.pattern;
            const kit = KITS.find((kt) => kt.id === pat.kitId) || this.kit;
            const dest = this.trackStrip(t);
            const contentLen = Math.max(0.25, pat.steps * STEP_BEATS);
            // song rule: content tiles to fill the clip length automatically
            const reps = Math.max(1, Math.ceil(clip.lengthBeats / contentLen));
            const notes = clip.content.notes; // lossless source of truth when present
            for (let r = 0; r < reps; r++) {
              const repOffset = r * contentLen;
              if (notes) {
                // kit-voiced MIDI: each note → its lane at its own beat + velocity (off-grid,
                // variable length/vel, multi-hits all play exactly as edited in the roll)
                for (const nt of notes.notes) {
                  const beat = repOffset + nt.start;
                  if (beat >= clip.lengthBeats) continue;
                  const lane = kit.lanes[nt.pitch - DRUM_BASE];
                  if (lane) emitDrum(lane, clip.startBeat + beat, nt.vel, dest);
                }
              } else {
                for (let s = 0; s < pat.steps; s++) {
                  const stepBeat = repOffset + s * STEP_BEATS;
                  if (stepBeat >= clip.lengthBeats) continue;
                  for (const lane of kit.lanes) {
                    if (!pat.on[lane.id]?.[s]) continue;
                    emitDrum(lane, clip.startBeat + stepBeat, pat.accent[lane.id]?.[s] ? 1 : 0.7, dest);
                  }
                }
              }
            }
          } else if (clip.content.kind === "audio") {
            this.scheduleAudioClip(t, clip, fromBeatAbs, toBeatAbs, whenOf, bd, brace);
          }
        }
      }
      // metronome: a click on every integer beat in this window (accent on the bar
      // downbeat). Tracked in _metroThrough so a click is scheduled exactly once even as
      // the lookahead window slides. Ignores the loop brace (counts absolute beats).
      if (this.metronome) {
        const bpb = this.arrangement.beatsPerBar;
        const first = Math.max(Math.ceil(fromBeatAbs - 1e-6), Math.floor(this._metroThrough) + 1);
        for (let beat = first; beat < toBeatAbs; beat++) {
          this.metroClick(whenOf(beat), ((beat % bpb) + bpb) % bpb === 0);
          this._metroThrough = beat;
        }
      }
      if (this._seqVoices.length > 256) this._seqVoices = this._seqVoices.slice(-128);
      this._scheduledThrough = horizon;
      return;
    }

    if (this.beatMode) {
      const seq = this.sequence;
      // the drum pattern tiles over its OWN grid length (so a 1-bar pattern repeats
      // to fill a longer track), independent of the transport total.
      const gridBeats = seq.steps * STEP_BEATS;
      // swing pushes odd steps later by up to ~1/3 of a step
      const swingBeats = seq.swing * STEP_BEATS * 0.66;
      for (let s = 0; s < seq.steps; s++) {
        const stepBeat = s * STEP_BEATS + (s % 2 === 1 ? swingBeats : 0);
        let k = Math.floor((fromBeatAbs - stepBeat) / gridBeats);
        if (!this.loopOn) k = 0;
        for (; ; k++) {
          const absBeat = stepBeat + (this.loopOn ? k * gridBeats : 0);
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
        const vibLane = ch.clip.autos?.find((a) => a.target === "vibrato");
        // group into legato runs so `slide` notes bend the previous voice (FL-style)
        // instead of articulating a new one. One voice per run, per wrap pass.
        for (const run of this.buildRuns(ch.clip.notes)) {
          let k = Math.floor((fromBeatAbs - run.startBeat) / span);
          if (!wrap) k = 0;
          for (; ; k++) {
            const absBeat = run.startBeat + (wrap ? k * span : 0);
            if (absBeat >= toBeatAbs) break;
            if (absBeat < fromBeatAbs) {
              if (!wrap) break;
              continue;
            }
            const when = whenOf(absBeat);
            const off = when + Math.max(0.04, (run.endBeat - run.startBeat) * bd);
            // bend points: each slide note's END maps to an absolute ctx time
            const bends = run.bends.length
              ? run.bends.map((b) => ({ toMidi: b.toMidi, from: when + (b.fromBeat - run.startBeat) * bd, at: when + (b.atBeat - run.startBeat) * bd }))
              : undefined;
            const autoVib = vibLane?.points.length
              ? { points: vibLane.points, startBeat: run.startBeat, endBeat: run.endBeat, whenOfBeat: (cb: number) => when + (cb - run.startBeat) * bd, rate: vibLane.rate, intensity: vibLane.intensity }
              : undefined;
            const h = this.startVoiceAt(run.pitch, run.vel, when, sel, bends, autoVib);
            this.releaseVoice(h, off);
            this._seqVoices.push(h);
            if (!wrap) break;
          }
        }
      }
      // ponytail: voice ceiling. A subtractive synth voice is ≤ ~14 nodes (2 osc +
      // sub + noise + per-source gains + filter + amp + up to 2 LFOs); this prune
      // bounds total node accumulation across 8 channels × 64 steps. Upgrade path if
      // it ever bites: a per-channel polyphony cap before scheduling, not after.
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
    const clipVibLane = clip.autos?.find((a) => a.target === "vibrato");
    for (const run of this.buildRuns(clip.notes)) {
      let k = Math.floor((fromBeatAbs - run.startBeat) / total);
      if (!this.loopOn) k = 0;
      for (; ; k++) {
        const absBeat = run.startBeat + (this.loopOn ? k * total : 0);
        if (absBeat >= toBeatAbs) break;
        if (absBeat < fromBeatAbs) {
          if (!this.loopOn) break;
          continue;
        }
        const when = whenOf(absBeat);
        const off = when + Math.max(0.04, (run.endBeat - run.startBeat) * bd);
        const bends = run.bends.length
          ? run.bends.map((b) => ({ toMidi: b.toMidi, from: when + (b.fromBeat - run.startBeat) * bd, at: when + (b.atBeat - run.startBeat) * bd }))
          : undefined;
        const autoVib = clipVibLane?.points.length
          ? { points: clipVibLane.points, startBeat: run.startBeat, endBeat: run.endBeat, whenOfBeat: (cb: number) => when + (cb - run.startBeat) * bd, rate: clipVibLane.rate, intensity: clipVibLane.intensity }
          : undefined;
        const h = this.startVoiceAt(run.pitch, run.vel, when, undefined, bends, autoVib);
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
