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
import {
  clipBeats,
  newNoteId,
  sampleAuto,
  VIB_MAX_CENTS,
  type AutoLane,
  type AutoPoint,
  type Note,
  type NoteClip,
} from "./data/clips";
import { DRUM_BASE, patternToNotes } from "./data/drum-midi";
import {
  arrangementBeats,
  emptyArrangement,
  loadArrangement,
  newClipId,
  newTrackId,
  saveArrangement,
  slippedLocals,
  swingDelay,
  warpModeOf,
  type ArrClip,
  type Arrangement,
  type ArrTrack,
  type TrackKind,
  type WarpMode,
} from "./data/arrangement";
import { splitContent } from "./data/clip-split";
import {
  putAudio,
  putAudioBuffer,
  allAudio,
  pruneAudio,
  clearAudio,
  canPersistOpus,
  encodePersistable,
  encodeWavPcm16,
  lastPersistCodec,
  sniffMime,
} from "./data/audio-store";
import {
  downloadBlob,
  packAin,
  referencedImportIds,
  safeAinFilename,
  unpackAin,
} from "./ain-pack";
// pitch-preserving stretch (WASM/AudioWorklet) — see CREDITS.md "signalsmith-stretch"
import SignalsmithStretch, { type StretchNode } from "signalsmith-stretch";
import {
  buildCapabilityReport,
  loadAudioAccepted,
  loadMonitorTipSeen,
  saveAudioAccepted,
  saveMonitorTipSeen,
  classifyInputDevice,
  resolveInputDeviceLabel,
  shortDeviceLabel,
  type AudioNudge,
  type AudioCapabilityReport,
} from "./audio-capability";
import { FxChain, newFxId, type FxDeviceState } from "./fx-chain";
import { FX_DEVICES, FX_DEVICE_TYPES, migrateFxDeviceStates, type FxDeviceType } from "./fx-devices";
import {
  BUILTIN_PATCHES,
  patchFromPreset,
  type SynthPatch,
} from "./data/patches";
import { setOscillatorWave } from "./osc-phase";
import {
  DEFAULT_DRUM_AMP,
  DEFAULT_DRUM_FILT,
  DEFAULT_DRUM_FILT_ENV,
  partialFiltActive,
  resolveDrumTone,
  scheduleAmpAttack,
  scheduleAmpOneShot,
  scheduleFiltEnv,
  scheduleFiltEnvOneShot,
  type DrumPartialFilt,
} from "./voice-env";
import { parseMidi } from "./data/midi-file";
import {
  DEFAULT_KIT,
  defaultSequence,
  findKit,
  upsertUserKit,
  cloneKitAsUser,
  parseLoopMeta,
  type DrumKit,
  type DrumLane,
  type SequenceClip,
} from "./data/kits";

export type TransportMode = "track" | "sequence";

export const AUDIO_BUFFER_SIZES = [256, 512, 1024, 2048, 4096] as const;
export type AudioBufferSize = (typeof AUDIO_BUFFER_SIZES)[number];
/** How a stereo interface maps into the take / monitor. Mic on input 1 → `left`. */
export const INPUT_CHANNEL_MODES = ["stereo", "left", "right", "sum"] as const;
export type InputChannelMode = (typeof INPUT_CHANNEL_MODES)[number];
export type AudioPrefs = {
  inputDeviceId: string | null;
  outputDeviceId: string | null;
  bufferSize: AudioBufferSize;
  /** stereo keep L/R · left/right fold that channel to both · sum = (L+R)/2 */
  inputChannels: InputChannelMode;
  latencyMode: "auto" | "manual";
  latencyMs: number;
  inputMonitor: boolean;
  /**
   * Per-note voice randomness: osc start-phase jitter (voices.phase) + sample
   * preset humanize detune. Default off so MIDI/arrangement hits are identical.
   */
  voiceHumanize: boolean;
};

const DEFAULT_AUDIO_PREFS: AudioPrefs = {
  inputDeviceId: null,
  outputDeviceId: null,
  bufferSize: 512, // lower default — 256 is tighter but glitchier on slower machines
  inputChannels: "left", // USB interface input-1 mono is the common case
  latencyMode: "auto",
  latencyMs: 0,
  inputMonitor: false,
  voiceHumanize: false,
};

function loadAudioPrefs(): AudioPrefs {
  try {
    const raw = localStorage.getItem("ain-audio-prefs");
    if (!raw) return { ...DEFAULT_AUDIO_PREFS };
    const p = JSON.parse(raw) as Partial<AudioPrefs>;
    const buf = AUDIO_BUFFER_SIZES.includes(p.bufferSize as AudioBufferSize)
      ? (p.bufferSize as AudioBufferSize)
      : DEFAULT_AUDIO_PREFS.bufferSize;
    const ch = INPUT_CHANNEL_MODES.includes(p.inputChannels as InputChannelMode)
      ? (p.inputChannels as InputChannelMode)
      : DEFAULT_AUDIO_PREFS.inputChannels;
    return {
      inputDeviceId: typeof p.inputDeviceId === "string" ? p.inputDeviceId : null,
      outputDeviceId:
        typeof p.outputDeviceId === "string" ? p.outputDeviceId : null,
      bufferSize: buf,
      inputChannels: ch,
      latencyMode: p.latencyMode === "manual" ? "manual" : "auto",
      latencyMs:
        typeof p.latencyMs === "number" && Number.isFinite(p.latencyMs)
          ? Math.max(0, Math.min(500, Math.round(p.latencyMs)))
          : 0,
      inputMonitor: !!p.inputMonitor,
      // absent key (old prefs) → false so existing users get deterministic voicing
      voiceHumanize: p.voiceHumanize === true,
    };
  } catch {
    return { ...DEFAULT_AUDIO_PREFS };
  }
}

/** Map a stereo (or mono) ScriptProcessor block into stored L/R per prefs. */
function mapInputBlock(
  L: Float32Array,
  R: Float32Array | null,
  mode: InputChannelMode,
): Float32Array[] {
  const r = R || L;
  if (mode === "stereo") return [L, new Float32Array(r)];
  if (mode === "left") return [L, new Float32Array(L)];
  if (mode === "right") return [new Float32Array(r), new Float32Array(r)];
  const s = new Float32Array(L.length);
  for (let i = 0; i < L.length; i++) s[i] = (L[i] + r[i]) * 0.5;
  return [s, new Float32Array(s)];
}

const STEP_BEATS = 0.25; // one drum step = a 1/16 note

type EngineEvent =
  | "state"
  | "wet"
  | "fx"
  | "track"
  | "ready"
  | "synth"
  | "preset"
  | "transport"
  | "clip"
  | "midi"
  | "patch"
  | "arrange"
  | "select";

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
  // the reorderable fx live in the master FxChain (sum → [devices] → anOut)
  // ── fixed tail (never reordered) ──
  anOut: AnalyserNode; // pre-limiter program level (spectrum + pre-limiter master meter)
  limiter: DynamicsCompressorNode; // brickwall safety, always last
  limMakeup: GainNode;
  master: GainNode;
  anPost: AnalyserNode; // post-limiter final output (post-limiter master meter)
  /** Low-latency input monitor bus — skips FX + safety compressor → destination. */
  monitorBus: GainNode;
}

// the fixed master-bus safety limiter (the only effect NOT in the device chain)
interface LimiterState {
  on: boolean;
  ceiling: number;
}

// an undo step: the arrangement + the mixer state ⌘Z should restore with it.
// `scope` tags the edit source so the editor pane can prefer content undos
// (piano-roll / clip edits) without a second stack — see undo(preferredScope).
interface UndoSnap {
  a: Arrangement;
  masterVol: number;
  scope?: string; // "arrange" (default) · "content:<clipId>" · coalesce keys
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
const LS_MASTER_FX = "ain-master-fx"; // master-bus device chain: FxDeviceState[]
const LS_MASTER_VOL = "ain-master-vol"; // master track fader
const LS_MASTER_METER = "ain-master-meter"; // master meter tap: "pre" | "post"
const LS_LAUNCH_QUANT = "ain-launch-quant"; // launch quantize in beats (0 = off)
const posKey = (id: string) => "ain-pos:" + id;
const db2lin = (db: number) => Math.pow(10, db / 20);
// mixer gain ceiling: +6 dB of headroom above unity (linear ~1.995) for the
// dB-calibrated faders. Stored track/master vol is linear gain in [0, GAIN_MAX].
export const GAIN_MAX = db2lin(6);

function loadMasterVol(): number {
  const v = parseFloat(localStorage.getItem(LS_MASTER_VOL) || "");
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.95;
}

// the persisted master chain; fresh visitors get the classic five devices, all bypassed
function loadMasterDevices(): FxDeviceState[] {
  try {
    const raw = localStorage.getItem(LS_MASTER_FX);
    if (raw) {
      const parsed = JSON.parse(raw) as FxDeviceState[];
      if (Array.isArray(parsed)) return migrateFxDeviceStates(parsed) as FxDeviceState[];
    }
  } catch {
    /* corrupted → default */
  }
  return FX_DEVICE_TYPES.map((t) => ({
    id: newFxId(),
    type: t,
    params: FX_DEVICES[t].defaults(),
  }));
}

function loadUserPatches(): Record<string, SynthPatch> {
  try {
    return JSON.parse(localStorage.getItem(LS_PATCHES) || "{}");
  } catch {
    return {};
  }
}

// shallow-recursive partial + merge for editing a patch (its nesting is one level:
// osc1/osc2/sub/noise/filter/filtEnv/ampEnv/lfo are flat objects of primitives).
type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? Partial<T[K]> : T[K];
};
function deepMerge<T extends object>(base: T, patch: DeepPartial<T>): T {
  const out = { ...base } as T;
  for (const k in patch) {
    const v = patch[k];
    if (v && typeof v === "object" && !Array.isArray(v)) {
      out[k] = { ...(base[k] as object), ...(v as object) } as T[Extract<
        keyof T,
        string
      >];
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
  limiter: LimiterState = { on: true, ceiling: -1.5 };
  // the MASTER track's fader (final gain before the speakers, after the limiter)
  masterVol = loadMasterVol();
  // master-bus device chain: the persisted truth; `_masterFx` is its live twin once a ctx exists
  private _masterDevices: FxDeviceState[] = loadMasterDevices();
  // current reverb IR for the UI selector: "synth" or a loaded IR url
  reverbIR = "synth";

  synthPatch = "glass pad"; // active synth patch id
  // merged patch store: built-ins + user patches (loaded from localStorage at boot).
  // Built-ins can be edited live for the session but are NOT persisted — they reset
  // to factory on reload; `saveUserPatch` captures the working sound as a user patch.
  patches: Record<string, SynthPatch> = {
    ...structuredClone(BUILTIN_PATCHES),
    ...loadUserPatches(),
  };
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
      if (!(pr.name in this.patches))
        this.patches[pr.name] = patchFromPreset(pr, pr.id);
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
    if (this.synthPatch === name)
      this.synthPatch = Object.keys(BUILTIN_PATCHES)[0];
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
    for (const id in this.patches)
      if (!this.isBuiltinPatch(id)) user[id] = this.patches[id];
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
  // launch quantize: a seek requested WHILE PLAYING waits for the next quantum
  // boundary (Ableton-style), so the musical phase never breaks. 0 = off (immediate).
  launchQuant = ((): number => {
    const v = parseFloat(localStorage.getItem(LS_LAUNCH_QUANT) || "");
    return Number.isFinite(v) && v >= 0 ? v : 0;
  })(); // beats (0 · 1 · 2 · 4 · 8 …), persisted
  // a queued launch: jump to `target` when the song reaches beat `atBeat`. Re-aiming
  // (a new seek before the boundary) replaces `target` but keeps `atBeat`.
  private _pendingLaunch: { target: number; atBeat: number } | null = null;
  private static VIB_RATE = 5.5; // Hz — vibrato LFO rate (depth is automated)
  // "tiny fade at play and stop" (REAPER-style): a short gain ramp on every source
  // start/stop so the transport never hard-cuts a buffer mid-cycle (which clicks).
  // ≤15 ms keeps the stop tight/performative (below the ~20 ms perceptual threshold).
  private static DECLICK = 0.012; // s

  // scheduler walks the linear arrangement (vs the Audio Lab's single-clip audition,
  // which plays `_clip` when arrangeMode is false)
  arrangeMode = false;
  // ── transport / playback pane ──
  metronome = false; // click on each beat (accent on bar 1) during arrangement playback
  metronomeVol = 0.6; // 0..1
  countInBars = 0; // bars of count-in click before the transport rolls (0 = off)
  followPlayhead = true; // timeline auto-scrolls to keep the playhead in view (UI reads it)
  snapBeats = 1; // timeline clip snap grid in beats (0 = off/free); UI reads it
  insertBeat = 0; // the arrangement "insert marker" — where paste/create/split reference
  // arrangement selection model (Ableton-style): a set of selected clips + an optional
  // time range spanning a set of tracks. Emits `select` so the timeline + editor react.
  selClips = new Set<string>(); // selected clip ids
  timeSel: { start: number; end: number; trackIds: string[] } | null = null;
  // undo/redo: snapshot the whole arrangement before each mutation (simple + correct;
  // no per-op inverse logic). Bounded stacks. Clipboard holds copied clips (relative).
  private _undo: UndoSnap[] = [];
  private _redo: UndoSnap[] = [];
  private _clipboard: { clips: ArrClip[]; trackKinds: TrackKind[] } | null =
    null;
  /** Device clipboard — type + params only (fresh id on paste). Separate from clip clipboard. */
  private _fxClipboard: { type: FxDeviceType; params: unknown } | null = null;
  private static UNDO_MAX = 60;
  private _metroThrough = -1; // last beat we've scheduled a click for (arrangement clock)
  arrangement: Arrangement = loadArrangement();
  private _arrStrips: Record<
    string,
    {
      in: GainNode; // unity junction sources connect to
      gain: GainNode; // post-FX fader
      pan: StereoPannerNode;
      fx: FxChain;
      an: AnalyserNode;
      /** Post-FX delay for mini-ADC (pads shorter tracks up to the longest peer). */
      adc: DelayNode;
    }
  > = {}; // per-track FX → ADC → vol → pan strip + post-fader meter tap
  kit: DrumKit = DEFAULT_KIT;
  sequence: SequenceClip = defaultSequence(DEFAULT_KIT);
  private _drumBufs: Record<string, AudioBuffer | null> = {}; // `${kitId}:${laneId}` → decoded one-shot (null = failed / synth)
  private _noiseBufs: Partial<Record<"white" | "pink", AudioBuffer>> = {}; // synth noise sources, built once
  // imported audio-clip buffers (session-only; bufId → decoded buffer + its peak cache)
  private _importBufs: Record<string, AudioBuffer> = {};
  private _importPeaks: Record<string, Float32Array> = {};
  private _importSeq = 0;
  // audio clips are long one-shots (not per-note events) — track which have been started
  // this playback pass so the lookahead scheduler doesn't retrigger them every tick.
  // `synced` clips re-rate live when the tempo changes (the tape-warble effect):
  // `baseRate` is the rate at `baseBpm`, so a new tempo → baseRate·(bpm/baseBpm). Drift-free.
  private _startedAudio: Record<
    string,
    {
      src: AudioBufferSourceNode;
      synced: boolean;
      baseRate: number;
      baseBpm: number;
    }
  > = {};
  private _presetPeaks: Record<string, Float32Array> = {}; // "presetId:zoneIdx" → cached peaks

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
    // transport clock starts in lockstep with the restored arrangement — otherwise the
    // timeline (waveform geometry) is drawn at the boot default until first play
    this.bpm = this.arrangement.bpm;
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
  // Graph build + the master device chain live above the constructor (buildGraph,
  // master-device API, applyLimiter); debug() at the bottom dumps live state.
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
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      // interactive = lowest glitch-free output buffer the browser will give us
      this.ctx = new Ctor({ latencyHint: "interactive" });
      this.buildGraph();
      void this.applyOutputSink();
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

    // ── fixed tail (never reordered): anOut → safety limiter → master → out ──
    n.anOut = c.createAnalyser();
    n.anOut.fftSize = 2048;
    n.anOut.smoothingTimeConstant = 0.82;
    n.limiter = c.createDynamicsCompressor();
    n.limMakeup = c.createGain();
    n.master = c.createGain();
    n.master.gain.value = this.masterVol;
    n.anOut.connect(n.limiter);
    n.limiter.connect(n.limMakeup);
    n.limMakeup.connect(n.master);
    n.master.connect(c.destination);
    // post-limiter meter tap off the final output node (measure only)
    n.anPost = c.createAnalyser();
    n.anPost.fftSize = 2048;
    n.anPost.smoothingTimeConstant = 0;
    n.master.connect(n.anPost);

    // Input monitor bypasses track/master FX and the DynamicsCompressor (those add
    // audible delay). Direct to destination; level follows armed track vol/mute.
    n.monitorBus = c.createGain();
    n.monitorBus.gain.value = 1;
    n.monitorBus.connect(c.destination);

    this.nodes = n;
    // ── the modular master FxChain: sum → [devices] → anOut ──
    // Seeded from the persisted device list. The limiter tail above is NOT in the
    // chain (it's the fixed safety stage).
    this._masterFx = new FxChain(c, n.sum, n.anOut);
    this._masterFx.setDevices(
      this._masterDevices.map((d) => structuredClone(d)),
    );
    this._masterFx.applyAll(this.bpm);
    this.applyWet(true);
    this.applyLimiter();
    // Warm spectral worklets; re-apply so passthrough fallbacks remount
    void this.ensureSpectralWorklets().then((ok) => {
      if (ok) this._masterFx?.applyAll(this.bpm);
    });
    this.ensureFxTick();
  }
  private _masterFx: FxChain | null = null;
  private _fxTickTimer = 0;

  /** ~30 Hz tick for EQ dynamics + per-device analysers (independent of transport). */
  private ensureFxTick() {
    if (this._fxTickTimer) return;
    this._fxTickTimer = window.setInterval(() => {
      this._masterFx?.tick();
      for (const id of Object.keys(this._arrStrips)) {
        this._arrStrips[id]?.fx.tick();
      }
      this.syncCentinelMidiTargets();
    }, 16);
  }

  private _centinelMidiSig = "";
  /** Held keyboard/hardware notes + arrangement MIDI under the playhead → centinel. */
  private collectCentinelMidiTargets(): number[] {
    const out = new Set<number>();
    for (const k of Object.keys(this._liveVoices)) {
      const colon = k.indexOf(":");
      const midi = Number(k.slice(colon + 1));
      if (Number.isFinite(midi)) out.add(midi | 0);
    }
    if (this.sequencePlaying && this.arrangeMode) {
      const beat = this.currentBeat();
      for (const t of this.arrangement.tracks) {
        if (t.kind !== "midi") continue;
        for (const c of t.clips) {
          if (c.content.kind !== "midi") continue;
          const rel = beat - c.startBeat;
          if (rel < 0 || rel >= c.lengthBeats) continue;
          for (const n of c.content.clip.notes) {
            if (n.muted) continue;
            if (rel >= n.start && rel < n.start + n.length) out.add(n.pitch | 0);
          }
        }
      }
    }
    return [...out].sort((a, b) => a - b);
  }

  private syncCentinelMidiTargets() {
    const notes = this.collectCentinelMidiTargets();
    const sig = notes.join(",");
    if (sig === this._centinelMidiSig) return;
    this._centinelMidiSig = sig;
    this._masterFx?.setMidiTargets(notes);
    for (const id of Object.keys(this._arrStrips)) {
      this._arrStrips[id]?.fx.setMidiTargets(notes);
    }
  }

  // ── master-bus device chain API (same shape as the per-track one below) ──
  // Mutations ensure the graph exists (a user gesture is driving them), mutate the
  // live chain, then persist its serialized state.
  private saveMasterFx() {
    if (this._masterFx) this._masterDevices = this._masterFx.states();
    try {
      localStorage.setItem(LS_MASTER_FX, JSON.stringify(this._masterDevices));
    } catch {
      /* quota — the live chain still works, it just won't persist */
    }
    this.emit("fx");
  }
  masterDevices(): FxDeviceState[] {
    return (
      this._masterFx?.states() ??
      this._masterDevices.map((d) => structuredClone(d))
    );
  }
  addMasterDevice(type: FxDeviceType) {
    this.ensureCtx();
    if (type === "impartialer" || type === "speccomp" || type === "centinel" || type === "cliplim")
      void this.ensureSpectralWorklets();
    this._masterFx!.addDevice(type);
    this.saveMasterFx();
    if (type === "impartialer" || type === "speccomp" || type === "centinel" || type === "cliplim") {
      void this.ensureSpectralWorklets().then((ok) => {
        if (ok) this._masterFx?.applyAll(this.bpm);
      });
    }
  }
  removeMasterDevice(deviceId: string) {
    this.ensureCtx();
    this._masterFx!.removeDevice(deviceId);
    this.saveMasterFx();
  }
  moveMasterDevice(deviceId: string, toIndex: number) {
    this.ensureCtx();
    this._masterFx!.moveDevice(deviceId, toIndex);
    this.saveMasterFx();
  }
  setMasterDeviceParams(deviceId: string, params: unknown) {
    this.ensureCtx();
    this._masterFx!.setParams(deviceId, params, this.bpm);
    this.saveMasterFx();
  }

  /** Latest spectral viz frame from a master-chain device (poll from rAF). */
  readMasterFxViz(deviceId: string) {
    return this._masterFx?.readViz(deviceId) ?? null;
  }

  hasFxClipboard(): boolean {
    return !!this._fxClipboard;
  }

  copyMasterDevice(deviceId: string) {
    const d = this.masterDevices().find((x) => x.id === deviceId);
    if (!d) return;
    this._fxClipboard = { type: d.type, params: structuredClone(d.params) };
    this.emit("fx");
  }

  pasteMasterDevice(atIndex?: number) {
    if (!this._fxClipboard) return;
    this.ensureCtx();
    const type = this._fxClipboard.type;
    if (type === "impartialer" || type === "speccomp" || type === "centinel" || type === "cliplim")
      void this.ensureSpectralWorklets();
    this._masterFx!.insertDevice(this._fxClipboard, atIndex);
    this.saveMasterFx();
    if (type === "impartialer" || type === "speccomp" || type === "centinel" || type === "cliplim") {
      void this.ensureSpectralWorklets().then((ok) => {
        if (ok) this._masterFx?.applyAll(this.bpm);
      });
    }
  }

  duplicateMasterDevice(deviceId: string) {
    const list = this.masterDevices();
    const i = list.findIndex((x) => x.id === deviceId);
    if (i < 0) return;
    this.copyMasterDevice(deviceId);
    this.pasteMasterDevice(i + 1);
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

  // SAFETY LIMITER — the fixed, always-last brickwall tail (NOT in the chain). Catches
  // any peak regardless of device order. Bypassed (threshold 0 / ratio 1) only if disabled.
  private applyLimiter() {
    const n = this.nodes;
    if (!n) return;
    const t = this.ctx!.currentTime;
    if (this.limiter.on) {
      n.limiter.threshold.setTargetAtTime(this.limiter.ceiling, t, 0.02);
      n.limiter.ratio.setTargetAtTime(20, t, 0.02);
      n.limiter.knee.setTargetAtTime(0, t, 0.02);
      n.limiter.attack.setTargetAtTime(0.002, t, 0.02);
      n.limiter.release.setTargetAtTime(0.12, t, 0.02);
      n.limMakeup.gain.setTargetAtTime(
        db2lin(-this.limiter.ceiling * 0.25),
        t,
        0.02,
      );
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
    this._offset =
      parseFloat(localStorage.getItem(posKey(track.id)) || "0") || 0;
    this.emit("track");
    this.emit("state");
  }

  async loadTrack(track: Track, opts?: { autoplay?: boolean }) {
    const autoplay = opts && opts.autoplay;
    if (
      this.track &&
      this.track.id === track.id &&
      (this.ready || this.loading)
    ) {
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
    setTimeout(
      () =>
        srcs.forEach((s) => {
          try {
            s.disconnect();
          } catch {
            /* fine */
          }
        }),
      (d + 0.02) * 1000,
    );
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
    const pos =
      this._offset + Math.max(0, this.ctx.currentTime - this._startCtx);
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
    if (this.track)
      localStorage.setItem(posKey(this.track.id), String(this._offset));
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
      this.nodes.lm.gain.setTargetAtTime(
        on ? db2lin(this.lmDb) : 1,
        this.ctx!.currentTime,
        0.02,
      );
    }
    this.emit("state");
  }

  setMasterVol(v: number) {
    this.pushUndoCoalesced("mastervol"); // one undo step per fader gesture
    this.masterVol = Math.min(GAIN_MAX, Math.max(0, v));
    this.applyMasterVol();
  }
  private applyMasterVol() {
    if (this.ctx && this.nodes)
      this.nodes.master.gain.setTargetAtTime(
        this.masterVol,
        this.ctx.currentTime,
        0.02,
      );
    try {
      localStorage.setItem(LS_MASTER_VOL, String(this.masterVol));
    } catch {
      /* fine */
    }
    this.emit("fx");
  }

  setLimiter(patch: Partial<LimiterState>) {
    Object.assign(this.limiter, patch);
    if (this.ctx) {
      this.ensureCtx();
      this.applyLimiter();
    }
    this.emit("fx");
  }

  // ponytail: unused — wired by the reverb IR-file selector (see AUDIO.md "not yet wired")
  // Load a real impulse-response file to replace the synthesised reverb.
  // ponytail: 0 callers (unbuilt IR-selector UI). The reverb IR is now owned by the reverb
  // DEVICE (fx-devices.ts), which self-generates it from decay. A real-IR override would be
  // a device param — wire it when the IR selector is built. Kept as a no-op stub for the API.
  async loadReverbIR(url: string) {
    this.reverbIR = url;
    this.emit("fx");
  }
  useSynthReverbIR() {
    this.reverbIR = "synth";
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
    if (!this.nodes)
      return { mix: { rms: -90, peak: -90 }, master: { rms: -90, peak: -90 } };
    return {
      mix: this.levelOf(this.nodes.anMix),
      master: this.levelOf(this.nodes.anMaster),
    };
  }

  // ── mixer metering (post-fader, per strip) ──
  // Live RMS+peak dB for ONE arrangement track's strip. Returns floor level (-90) if
  // the strip hasn't been built yet (no sound ever routed through it). Imperative:
  // the fader UI reads this every rAF frame, never through React state.
  trackLevel(id: string): Levels {
    const s = this._arrStrips[id];
    return s ? this.levelOf(s.an) : { rms: -90, peak: -90 };
  }
  // master meter tap point (user toggle in the master header): "pre" = anOut, the
  // program signal before the safety limiter + master fader (what the chain produces);
  // "post" = the final output node, after limiter + makeup + master fader (what leaves
  // the speakers). Persisted so the choice survives reloads.
  masterMeterPost = localStorage.getItem(LS_MASTER_METER) === "post";
  setMasterMeterPost(post: boolean) {
    this.masterMeterPost = post;
    try {
      localStorage.setItem(LS_MASTER_METER, post ? "post" : "pre");
    } catch {
      /* fine */
    }
    this.emit("fx");
  }
  masterLevel(): Levels {
    if (!this.nodes) return { rms: -90, peak: -90 };
    return this.levelOf(this.masterMeterPost ? this.nodes.anPost : this.nodes.anOut);
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
        if (!(pr.name in this.patches) && pr.zones.length)
          this.patches[pr.name] = patchFromPreset(pr, pr.id);
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
    if (
      p.sample?.presetId &&
      this.samplePresets.some((pr) => pr.id === p.sample!.presetId)
    )
      void this.loadPreset(p.sample.presetId);
  }
  // public: decode a preset's zones by id (for the sample waveform / manual warm)
  warmPreset(presetId: string) {
    if (this.samplePresets.some((pr) => pr.id === presetId))
      void this.loadPreset(presetId);
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
  async loadPresetPhrase(
    id: string,
  ): Promise<{ clip: NoteClip; bpm?: number } | null> {
    const preset = this.samplePresets.find((pr) => pr.id === id);
    if (!preset) return null;
    if (!preset.phraseUrl)
      return { clip: preset.defaultPhrase, bpm: preset.bpmHint };
    if (this._phraseCache[id]) return this._phraseCache[id];
    try {
      const res = await fetch(preset.phraseUrl);
      if (!res.ok) throw new Error("mid " + res.status);
      const parsed = parseMidi(await res.arrayBuffer());
      if (!parsed) throw new Error("mid parse");
      // use the .mid's tempo only if it actually carried one; otherwise fall back
      // to the preset's bpmHint (Ableton clip-export omits tempo).
      const out = {
        clip: parsed.clip,
        bpm: parsed.hasTempo ? parsed.bpm : preset.bpmHint,
      };
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
  private pickZone(
    preset: SampledPreset,
    midi: number,
  ): { buf: AudioBuffer; rootMidi: number; zoneIdx: number } | null {
    const bufs = this._sampleBufs[preset.id];
    if (!bufs) return null;
    let containing = -1;
    let nearest = -1;
    let nearestDist = Infinity;
    preset.zones.forEach((z, i) => {
      if (!bufs[i]) return;
      if (
        z.loMidi != null &&
        z.hiMidi != null &&
        midi >= z.loMidi &&
        midi <= z.hiMidi
      )
        containing = i;
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
    const effRoot =
      midi > root + cap ? midi - cap : midi < root - cap ? midi + cap : root;
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
  private xfadeLoopBuffer(
    src: AudioBuffer,
    presetId: string,
    zoneIdx: number,
    a: number,
    b: number,
    xfadeSec: number,
  ): AudioBuffer {
    const N = src.length;
    const aS = Math.floor(a * N);
    const bS = Math.floor(b * N);
    const region = bS - aS;
    // fade length: the user's seconds, capped to half the loop AND to the pre-roll
    // available before loopStart (can't read before the buffer head).
    let xf = Math.floor(src.sampleRate * Math.max(0, xfadeSec));
    xf = Math.min(xf, Math.floor(region / 2), aS);
    const key =
      presetId +
      ":" +
      zoneIdx +
      ":" +
      a.toFixed(4) +
      ":" +
      b.toFixed(4) +
      ":" +
      xf;
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
        outD[bS - xf + i] =
          inD[bS - xf + i] * fadeOut + inD[aS - xf + i] * fadeIn;
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
  // voice's noise source. Pink uses the cheap Paul Kellet approximation
  // (https://www.firstpr.com.au/dsp/pink-noise/).
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
      let b0 = 0,
        b1 = 0,
        b2 = 0,
        b3 = 0,
        b4 = 0,
        b5 = 0,
        b6 = 0;
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
    autoVib?: {
      points: AutoPoint[];
      startBeat: number;
      endBeat: number;
      whenOfBeat: (b: number) => number;
      rate?: number;
      intensity?: number;
    },
  ): VoiceHandle {
    const c = this.ensureCtx();
    const n = this.nodes!;
    const t = when;
    // schedule the portamento pitch ramps on a pitch param. `mode` picks the unit:
    // "detune" → cents offset from `midi`; "freq" → absolute Hz; "rate" → playbackRate.
    const applyBends = (
      param: AudioParam,
      mode: "detune" | "freq" | "rate",
      base = 0,
    ) => {
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
        param.linearRampToValueAtTime(
          val(b.toMidi),
          Math.max(b.from + 0.005, b.at),
        );
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
      const edges = [
        startBeat,
        ...points
          .map((p) => p.beat)
          .filter((b) => b > startBeat && b < endBeat),
        endBeat,
      ];
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

    // MONO mode: last-note priority per destination — starting a note steals the one
    // still sounding into this dest (fast release; releaseVoice is double-stop safe).
    const patch0 = sel?.patch ?? this.activePatch();
    if (patch0.voices?.mode === "mono") {
      const prev = this._monoVoices.get(dest);
      if (prev) this.releaseVoice(prev, t, true);
    }

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
      const cutBase = Math.min(
        18000,
        p.filter.cut * Math.pow(2, (p.filter.keyTrack * (midi - 60)) / 12),
      );
      // filter envelope (ADSR) on cutoff, peaking at cutBase + amt
      scheduleFiltEnv(vf.frequency, t, cutBase, p.filtEnv);
    } else {
      vf.type = "allpass"; // bypass: flat magnitude, sources still route through it
    }
    vf.connect(vg);
    vg.connect(dest);

    // ── unison (Serum-style): osc1/osc2 replicate ×N with a symmetric cents spread
    // and stereo placement; level normalizes by 1/√N. Sub/noise/sample stay single
    // (a widened sub loses its low-end focus). Phase randomize is gated by the
    // global voiceHumanize pref (default OFF) so MIDI hits stay identical. ──
    const vc = p.voices;
    const uniN = Math.max(1, Math.min(8, Math.round(vc?.unison ?? 1)));
    const uniDet = vc?.detune ?? 0; // cents at the extremes
    const uniW = Math.max(0, Math.min(1, vc?.width ?? 0)); // stereo spread
    // locked phase unless voiceHumanize is on; then voices.phase (default full)
    const uniPhase = this.audioPrefs.voiceHumanize
      ? Math.max(0, Math.min(1, vc?.phase ?? 1))
      : 0;

    const oscs: OscillatorNode[] = [];
    // a pitched oscillator at `semi` offset, mixed at `level`, with portamento bends.
    // `uni` voices spread across ±uniDet cents / ±uniW pan (1 = plain center voice).
    const addOsc = (
      wave: OscillatorType,
      semi: number,
      cents: number,
      level: number,
      uni = 1,
    ) => {
      if (level <= 0) return;
      const norm = level / Math.sqrt(uni);
      for (let i = 0; i < uni; i++) {
        const k = uni === 1 ? 0 : (i / (uni - 1)) * 2 - 1; // −1 … +1 across the stack
        const o = c.createOscillator();
        const ph = uniPhase > 0.001 ? Math.random() * uniPhase * Math.PI * 2 : 0;
        setOscillatorWave(c, o, wave, ph);
        o.frequency.value = freqOf(semi);
        o.detune.value = cents + k * uniDet;
        applyBends(o.frequency, "freq", semi); // glide this osc's own pitch line
        const g = c.createGain();
        g.gain.value = norm;
        o.connect(g);
        if (uni > 1 && uniW > 0.001) {
          const pan = c.createStereoPanner();
          pan.pan.value = k * uniW;
          g.connect(pan);
          pan.connect(vf);
        } else {
          g.connect(vf);
        }
        o.start(t);
        oscs.push(o);
      }
    };
    addOsc(p.osc1.wave, p.osc1.semi, p.osc1.cents, p.osc1.level, uniN);
    if (p.osc2On)
      addOsc(p.osc2.wave, p.osc2.semi, p.osc2.cents, p.osc2.level, uniN);
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
      const preset = this.samplePresets.find(
        (pr) => pr.id === p.sample!.presetId,
      );
      const zone = preset ? this.pickZone(preset, midi) : null;
      if (preset && zone) {
        const s = c.createBufferSource();
        // varispeed: note pitch × independent transpose (semi + cents), speed-coupled
        const vari = (p.sample.semi ?? 0) / 12 + (p.sample.cents ?? 0) / 1200;
        s.playbackRate.value = Math.pow(2, (midi - zone.rootMidi) / 12 + vari);
        // per-note ±cents jitter — only when global voiceHumanize is on
        if (
          this.audioPrefs.voiceHumanize &&
          preset.humanize > 0 &&
          s.detune
        )
          s.detune.value = (Math.random() * 2 - 1) * preset.humanize;
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
          s.buffer = this.xfadeLoopBuffer(
            zone.buf,
            p.sample.presetId,
            zone.zoneIdx,
            ls,
            le,
            p.sample.xfade ?? 0,
          );
          s.loop = true;
          s.loopStart = ls * dur;
          s.loopEnd = le * dur;
        } else {
          s.buffer = zone.buf;
        }
        if (bends && bends.length && s.detune)
          applyBends(s.detune, "detune", s.detune.value);
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
    scheduleAmpAttack(vg.gain, t, ae, peak);

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
      if (p.lfo.dest === "pitch")
        pitchTargets.forEach((d) => lg.connect(d)); // depth = cents
      else if (p.lfo.dest === "cutoff" && filterOn)
        lg.connect(vf.frequency); // depth = Hz (no-op when bypassed)
      else lg.connect(vg.gain); // amp tremolo, depth = linear gain
      l.start(t);
      lfos.push(l);
    }
    const handle: VoiceHandle = {
      kind: "synth",
      vg,
      r: ae.r,
      oscs,
      vf,
      noiseSrc,
      sampleSrc,
      lfos,
    };
    if (p.voices?.mode === "mono") this._monoVoices.set(dest, handle);
    return handle;
  }
  // the last-started voice per destination, for mono-mode stealing (stale handles are
  // fine — releaseVoice tolerates already-stopped sources)
  private _monoVoices = new Map<AudioNode, VoiceHandle>();

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
  /** Damper pedal (CC 64) — holds sounding notes until released. */
  private _midiSustain = false;
  /** liveKey strings deferred by sustain (released on pedal up / all-notes-off). */
  private _midiSustained = new Set<string>();

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
          this.handleMidiMessage(msg);
        };
      });
      this.midiStatus = count
        ? count + " device" + (count > 1 ? "s" : "")
        : "no device";
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

  /** Parse a hardware MIDI message → noteOn/Off (+ sustain / all-notes-off). */
  private handleMidiMessage(msg: MIDIMessageEvent) {
    const data = msg.data;
    if (!data || data.length < 1) return;
    const st = data[0]! & 0xf0;
    // ignore realtime / sysex / active sensing / clock
    if (data[0]! === 0xf0 || st === 0xf0) return;

    if (st === 0xb0 && data.length >= 3) {
      const cc = data[1]!;
      const val = data[2]!;
      // CC 64 sustain / damper
      if (cc === 64) {
        const on = val >= 64;
        if (this._midiSustain && !on) this.releaseMidiSustain();
        this._midiSustain = on;
        return;
      }
      // CC 120 all sound off / 123 all notes off
      if (cc === 120 || cc === 123) {
        this.panicMidiNotes();
        return;
      }
      return;
    }

    if (data.length < 2) return;
    const note = data[1]!;
    const vel = data.length >= 3 ? data[2]! : 0;
    if (st === 0x90 && vel > 0) this.noteOn(note, vel / 127);
    else if (st === 0x80 || (st === 0x90 && vel === 0)) this.noteOff(note);
  }

  private releaseMidiSustain() {
    if (!this._midiSustained.size) return;
    const keys = [...this._midiSustained];
    this._midiSustained.clear();
    for (const key of keys) {
      const h = this._liveVoices[key];
      if (!h) continue;
      delete this._liveVoices[key];
      if (this.ctx) this.releaseVoice(h, this.ctx.currentTime);
    }
    this.emit("synth");
    this._centinelMidiSig = "";
    this.syncCentinelMidiTargets();
  }

  /** Kill all live keyboard/hardware voices (sustain cleared). */
  panicMidiNotes() {
    this._midiSustain = false;
    this._midiSustained.clear();
    const now = this.ctx?.currentTime ?? 0;
    for (const key of Object.keys(this._liveVoices)) {
      const h = this._liveVoices[key];
      if (!h) continue;
      delete this._liveVoices[key];
      if (this.ctx) this.releaseVoice(h, now, true);
    }
    this.emit("synth");
    this._centinelMidiSig = "";
    this.syncCentinelMidiTargets();
  }

  // ── live keyboard (held notes keyed by channel:midi; retrigger replaces) ──
  // `channelId` selects a beat-maker MIDI channel's instrument for the audition;
  // omitted ⇒ the global Audio-Lab/keyboard voice. Voices are keyed per channel so
  // tapping a channel's keys plays THAT channel's sound and doesn't collide with
  // the global keyboard or other channels.
  private liveKey(midi: number, channelId?: string) {
    return (channelId ?? "_") + ":" + midi;
  }
  // live-keyboard routing: explicit channel > armed channel > the SELECTED midi track
  // (so playing the Instrument panel of a selected track sounds THAT track — through
  // its FX strip — without arming; unrouted keys fall back to the global lab patch)
  private liveCid(channelId?: string): string | undefined {
    if (channelId) return channelId;
    if (this.armedChannel) return this.armedChannel;
    const selId = this._selTrackId;
    if (selId && this.arrangement.tracks.some((t) => t.id === selId && t.kind === "midi")) return selId;
    return undefined;
  }
  noteOn(midi: number, vel?: number, channelId?: string) {
    vel = vel == null ? 1 : vel;
    this.ensureCtx();
    const cid = this.liveCid(channelId);
    // drum-track preview: a note in the drum piano-roll triggers the pitch's kit lane
    // as a one-shot (no sustained voice), so it sounds like the drum it edits.
    const dt = cid
      ? this.arrangement.tracks.find(
          (tr) => tr.id === cid && tr.kind === "drum",
        )
      : undefined;
    if (dt) {
      const kit =
        findKit(this.drumTrackKitId(dt));
      const lane = kit.lanes[midi - DRUM_BASE];
      if (lane)
        this.voiceDrum(
          lane,
          this.ctx!.currentTime,
          vel > 0.85 ? 1 : 0.7,
          this.trackStrip(dt),
          kit.id,
        );
      this.recordNoteOn(midi, vel); // drum hits still capture when recording
      return;
    }
    this.noteOff(midi, true, cid);
    // `cid` names an arrangement track — resolve it so previewing a note in the piano
    // roll auditions that track's instrument, not the global Audio-Lab patch.
    const sel = this.voiceForId(cid);
    this._liveVoices[this.liveKey(midi, cid)] = this.startVoiceAt(
      midi,
      vel,
      this.ctx!.currentTime,
      sel,
    );
    this.recordNoteOn(midi, vel);
    this.emit("synth");
    this._centinelMidiSig = ""; // force push on next sync
    this.syncCentinelMidiTargets();
  }
  // the kit a drum track's clips use (from the first drum clip, else the current kit)
  private drumTrackKitId(t: ArrTrack): string {
    for (const clip of t.clips)
      if (clip.content.kind === "drum")
        return clip.content.pattern.kitId || this.kit.id;
    return this.kit.id;
  }
  // resolve an arrangement-track id to its voice selection (undefined = global patch)
  private voiceForId(id: string | undefined): VoiceSel | undefined {
    if (!id) return undefined;
    const t = this.arrangement.tracks.find((tr) => tr.id === id);
    if (t && t.kind === "midi") return this.trackVoice(t);
    return undefined;
  }

  noteOff(midi: number, instant?: boolean, channelId?: string) {
    this.recordNoteOff(midi); // close a recorded note even for drum one-shots (no live voice)
    const cid = this.liveCid(channelId); // must mirror noteOn or the release misses its key
    const key = this.liveKey(midi, cid);
    const gKey = this.liveKey(midi, undefined);
    // fall back to the global slot in case the note was pressed before arming
    const h = this._liveVoices[key] ?? this._liveVoices[gKey];
    if (!h) return;
    // damper pedal: keep sounding until pedal up (instant = retrigger / panic path)
    if (this._midiSustain && !instant) {
      this._midiSustained.add(this._liveVoices[key] ? key : gKey);
      return;
    }
    this._midiSustained.delete(key);
    this._midiSustained.delete(gKey);
    delete this._liveVoices[key];
    delete this._liveVoices[gKey];
    this.releaseVoice(h, this.ctx!.currentTime, instant);
    this.emit("synth");
    this._centinelMidiSig = "";
    this.syncCentinelMidiTargets();
  }

  // held pitches, optionally scoped to one channel (for that grid's key glow)
  activeNotes(channelId?: string): number[] {
    const prefix = (channelId ?? "_") + ":";
    return Object.keys(this._liveVoices)
      .filter((k) => k.startsWith(prefix))
      .map((k) => Number(k.slice(prefix.length)));
  }

  // ── drum kit voices (arrangement drum clips + note-preview auditions) ──
  // Cache keyed by kitId:laneId so warmArrangement can decode multiple kits
  // without clobbering URL one-shots from earlier clips.
  async loadKit(kit: DrumKit) {
    const c = this.ensureCtx();
    await Promise.all(
      kit.lanes.map(async (l) => {
        const key = kit.id + ":" + l.id;
        if (l.bufId && this._importBufs[l.bufId]) {
          this._drumBufs[key] = this._importBufs[l.bufId]!;
          return;
        }
        if (!l.url) {
          this._drumBufs[key] = null;
          return;
        }
        if (this._drumBufs[key]) return; // already decoded
        try {
          this._drumBufs[key] = await this.fetchBuf(l.url, c);
        } catch {
          this._drumBufs[key] = null; // fall back to synth
        }
      }),
    );
    this.emit("transport");
  }

  /** Resolved one-shot — bufId imports win; url cache only when no bufId. */
  private resolveDrumLaneBuf(
    lane: DrumLane,
    kitId: string,
  ): AudioBuffer | null {
    if (lane.bufId) return this._importBufs[lane.bufId] ?? null;
    if (lane.url) return this._drumBufs[kitId + ":" + lane.id] ?? null;
    return null;
  }

  /** True when the lane has a decoded buffer ready (not merely a dangling bufId/url). */
  hasDrumLaneSample(lane: DrumLane, kitId?: string): boolean {
    return !!this.resolveDrumLaneBuf(lane, kitId ?? this.kit.id);
  }

  // Grow/shrink the step grid (16/32/48/64), preserving existing steps. Resizes
  // ── live keyboard routing ──
  armedChannel: string | null = null; // which track the keyboard/MIDI plays into
  // Ableton "Computer MIDI Keyboard" (M): when on, letter keys play the armed /
  // selected track; when off, they stay single-key shortcuts (L loop, R reverse…).
  // Default OFF so the studio's shortcut set works until the user opts in.
  midiKeys = (() => {
    try {
      return localStorage.getItem("ain-midi-keys") === "1";
    } catch {
      return false;
    }
  })();
  midiOctave = 0; // Z/X while midiKeys is on (−3…+3)
  midiVel = 0.85; // C/V while midiKeys is on

  // Arm an arrangement TRACK for keyboard / audio input (one at a time).
  // midi/drum → computer keys + Web MIDI into that track; audio → mic on ● record.
  armChannel(id: string | null) {
    const t = id ? this.arrangement.tracks.find((x) => x.id === id) : null;
    const ok = t && (t.kind === "midi" || t.kind === "drum" || t.kind === "audio");
    const prev = this.armedChannel;
    this.armedChannel = ok ? t!.id : null;
    // warm the armed MIDI track's instrument so the first note isn't silent
    if (this.armedChannel && t?.kind === "midi" && t.presetId)
      this.warmPatch(this.resolvePatch(t.presetId));
    // leaving an audio arm → release the mic (privacy); arming audio → request it
    if (prev && prev !== this.armedChannel) this.teardownInput();
    if (this.armedChannel && t?.kind === "audio") {
      void this.enableInput();
      void this.ensureCaptureWorklet(); // warm the worklet module during arm pending
    } else this.syncInputMonitor();
    this.emit("clip");
    this.emit("transport");
  }

  toggleMidiKeys() {
    this.midiKeys = !this.midiKeys;
    try {
      localStorage.setItem("ain-midi-keys", this.midiKeys ? "1" : "0");
    } catch {
      /* fine */
    }
    this.emit("transport");
    this.emit("clip");
  }
  setMidiOctave(n: number) {
    this.midiOctave = Math.min(3, Math.max(-3, Math.round(n)));
    this.emit("transport");
  }
  setMidiVel(v: number) {
    this.midiVel = Math.min(1, Math.max(0.1, Math.round(v * 100) / 100));
    this.emit("transport");
  }

  // ── Record (MIDI notes + live audio input) ──
  // ● / Shift+R. Reuses count-in from playSequence — capture is gated until
  // the anchor. MIDI → noteOn/Off into a midi/drum clip. Audio → getUserMedia PCM
  // into a new audio clip on the armed audio track. Prefs: device / buffer /
  // latency compensation / input monitor (ain-audio-prefs). No punch/takes yet.
  recording = false;
  recordStamp = 0; // bumped when a take finishes → ClipEditor remounts
  inputStatus: "idle" | "pending" | "live" | "denied" | "unsupported" = "idle";
  audioPrefs: AudioPrefs = loadAudioPrefs();
  inputDevices: { deviceId: string; label: string }[] = [];
  outputDevices: { deviceId: string; label: string }[] = [];
  /** Latency calibrate UI: idle | running | done | needInput | unsupported | failed */
  calibrateStatus:
    | "idle"
    | "running"
    | "done"
    | "needInput"
    | "unsupported"
    | "failed" = "idle";
  lastCalibrateMs: number | null = null;
  /** IndexedDB take/bounce codec after probe (or last successful encode). */
  private _persistCodec: "opus" | "wav" | "unknown" = "unknown";
  private _recTarget: { trackId: string; clipId: string } | null = null;
  private _recOpen = new Map<number, { startBeat: number; vel: number }>(); // midi holds
  private _recMode: "midi" | "audio" | null = null;
  private _recTrackId: string | null = null; // audio takes land on this track
  private _recStartBeat = 0;
  private _recCapturing = false;
  private _inputStream: MediaStream | null = null;
  private _inputSource: MediaStreamAudioSourceNode | null = null;
  private _recWorklet: AudioWorkletNode | null = null;
  private _recProc: ScriptProcessorNode | null = null; // fallback if worklet fails
  private _recSink: GainNode | null = null; // mute sink so the processor runs
  private _monitorGain: GainNode | null = null; // live input → monitorBus
  private _monitorNodes: AudioNode[] = []; // splitter/merger/gains for channel fold
  private _recChunks: Float32Array[][] = []; // each callback: per-channel copies
  /** Live waveform bins while capturing (max-abs per hop) — Timeline draws these. */
  private _recPeaks: number[] = [];
  private _recPeakCarry = 0;
  private _recPeakCarryN = 0;
  private static readonly REC_PEAK_HOP = 512;
  private _deviceListen = false;
  private _inputOpenGen = 0; // ignore stale getUserMedia resolutions
  /** From MediaStreamTrack.getSettings().latency when the browser reports it (seconds). */
  private _inputReportedLatencySec = 0;
  private _captureWorkletReady: Promise<boolean> | null = null;
  private _captureUsesWorklet = false;
  private _punchStarted = false; // light punch: first chunk inside loop brace
  private _calibActive = false;
  private _calibChunks: Float32Array[][] = [];
  private _calibClickAt = 0; // AudioContext time of calibration click
  /** Rolling UI frame dt (ms) — sampleUiFrame from a rAF loop. */
  private _uiFrameAvgMs = 16.7;
  private _hitchSince = 0;
  audioNudges: AudioNudge[] = [];

  // true while playSequence's count-in clicks are still running (anchor is in the future)
  private inCountIn(): boolean {
    return !!(
      this.ctx &&
      this.sequencePlaying &&
      this.ctx.currentTime < this._seqAnchorTime - 1e-4
    );
  }

  private persistAudioPrefs() {
    try {
      localStorage.setItem("ain-audio-prefs", JSON.stringify(this.audioPrefs));
    } catch {
      /* fine */
    }
  }

  hasAudioAccepted(): boolean {
    return loadAudioAccepted();
  }

  acceptAudioLimits() {
    saveAudioAccepted();
    this.emit("transport");
  }

  /** Call from a rAF loop so System / hitch nudges reflect UI thread health. */
  sampleUiFrame(dtMs: number) {
    if (!(dtMs > 0) || dtMs > 2000) return;
    this._uiFrameAvgMs = this._uiFrameAvgMs * 0.95 + dtMs * 0.05;
    const playingOrRec =
      this.recording || (this.sequencePlaying && this.arrangeMode);
    if (playingOrRec && this._uiFrameAvgMs > 32) {
      if (!this._hitchSince) this._hitchSince = performance.now();
      else if (
        performance.now() - this._hitchSince > 2000 &&
        !this.audioNudges.some((n) => n.id === "hitch")
      ) {
        this.pushNudge({
          id: "hitch",
          dismissible: true,
          message:
            "UI frames are lagging while audio runs — simplify the session or close other tabs if you hear glitches.",
        });
      }
    } else {
      this._hitchSince = 0;
    }
  }

  audioCapabilityReport(): AudioCapabilityReport {
    return buildCapabilityReport({
      prefs: this.audioPrefs,
      inputDevices: this.inputDevices,
      outputDevices: this.outputDevices,
      sinkIdSupported: this.supportsSinkId(),
      persistCodec: lastPersistCodec() ?? this._persistCodec,
      ctx: this.ctx,
      inputStatus: this.inputStatus,
      inputReportedLatencySec: this._inputReportedLatencySec,
      captureUsesWorklet: this._captureUsesWorklet,
      hasCaptureNode: !!(this._recWorklet || this._recProc),
      estimatedLatencyMs: this.estimatedLatencyMs(),
      effectiveLatencyMs: this.effectiveLatencyMs(),
      uiFrameAvgMs: this._uiFrameAvgMs,
    });
  }

  /** Probe WebCodecs Opus encode once for System / capability (non-blocking). */
  async probePersistCodec(): Promise<"opus" | "wav"> {
    this._persistCodec = (await canPersistOpus()) ? "opus" : "wav";
    this.emit("transport");
    return this._persistCodec;
  }

  /** Chosen input’s product label when prefs point at a specific device. */
  selectedInputLabel(): string | null {
    return resolveInputDeviceLabel(
      this.audioPrefs.inputDeviceId,
      this.inputDevices,
    );
  }

  dismissNudge(id: AudioNudge["id"]) {
    this.audioNudges = this.audioNudges.filter((n) => n.id !== id);
    if (id === "monitorTip") saveMonitorTipSeen();
    this.emit("transport");
  }

  private pushNudge(n: AudioNudge) {
    if (this.audioNudges.some((x) => x.id === n.id)) return;
    this.audioNudges = [...this.audioNudges, n];
    this.emit("transport");
  }

  private maybeNudgeMonitorTip() {
    if (!this.audioPrefs.inputMonitor || loadMonitorTipSeen()) return;
    const label = this.selectedInputLabel();
    const kind = classifyInputDevice(this.audioPrefs.inputDeviceId, label);
    const message =
      kind === "interface" && label
        ? `Software monitor is best-effort — headphones help; ${shortDeviceLabel(label)}’s hardware direct monitor is still lower latency.`
        : kind === "builtin"
          ? "Software monitor is best-effort on a built-in mic — headphones help; an interface with hardware direct monitor will feel tighter."
          : "Software monitor is best-effort — headphones help; your interface’s hardware direct monitor is still lower latency.";
    this.pushNudge({
      id: "monitorTip",
      dismissible: true,
      message,
    });
  }

  private maybeNudgeInputStatus() {
    if (this.inputStatus === "denied") {
      this.pushNudge({
        id: "denied",
        dismissible: true,
        message:
          "Mic access denied — allow this site in the browser, then re-arm the audio track.",
      });
    }
  }

  /** Approximate input→clip latency (ms). USB/OS buffers are mostly invisible to the page. */
  estimatedLatencyMs(): number {
    const c = this.ctx;
    const sr = c?.sampleRate || 48000;
    // Worklet render quantum (~128) is the real capture delay; ScriptProcessor uses bufferSize.
    const captureFrames = this._captureUsesWorklet
      ? 128
      : this.audioPrefs.bufferSize;
    const bufMs = (captureFrames / sr) * 1000;
    const base = c ? (c.baseLatency || 0) * 1000 : 0;
    const out = c
      ? ((c as AudioContext & { outputLatency?: number }).outputLatency || 0) *
        1000
      : 0;
    const reported = this._inputReportedLatencySec * 1000;
    return Math.round(Math.max(bufMs + base + out, reported + bufMs));
  }

  effectiveLatencyMs(): number {
    return this.audioPrefs.latencyMode === "manual"
      ? Math.max(0, this.audioPrefs.latencyMs)
      : this.estimatedLatencyMs();
  }

  setAudioPrefs(partial: Partial<AudioPrefs>) {
    const prev = { ...this.audioPrefs };
    if (partial.inputDeviceId !== undefined)
      this.audioPrefs.inputDeviceId = partial.inputDeviceId || null;
    if (partial.outputDeviceId !== undefined)
      this.audioPrefs.outputDeviceId = partial.outputDeviceId || null;
    if (partial.bufferSize !== undefined && AUDIO_BUFFER_SIZES.includes(partial.bufferSize))
      this.audioPrefs.bufferSize = partial.bufferSize;
    if (
      partial.inputChannels !== undefined &&
      INPUT_CHANNEL_MODES.includes(partial.inputChannels)
    )
      this.audioPrefs.inputChannels = partial.inputChannels;
    if (partial.latencyMode === "auto" || partial.latencyMode === "manual")
      this.audioPrefs.latencyMode = partial.latencyMode;
    if (partial.latencyMs !== undefined)
      this.audioPrefs.latencyMs = Math.max(0, Math.min(500, Math.round(partial.latencyMs)));
    if (partial.inputMonitor !== undefined)
      this.audioPrefs.inputMonitor = !!partial.inputMonitor;
    if (partial.voiceHumanize !== undefined)
      this.audioPrefs.voiceHumanize = !!partial.voiceHumanize;
    this.persistAudioPrefs();

    const deviceChanged = prev.inputDeviceId !== this.audioPrefs.inputDeviceId;
    const outputChanged =
      prev.outputDeviceId !== this.audioPrefs.outputDeviceId;
    const bufChanged = prev.bufferSize !== this.audioPrefs.bufferSize;
    const monChanged =
      prev.inputMonitor !== this.audioPrefs.inputMonitor ||
      prev.inputChannels !== this.audioPrefs.inputChannels;

    if (outputChanged) void this.applyOutputSink();

    if (deviceChanged && (this._inputStream || this.armedAudioTrack())) {
      void this.reopenInput();
      return;
    }
    if (bufChanged && (this._recProc || this._recWorklet)) {
      const wasCapturing = this._recCapturing;
      this.stopAudioCaptureGraph(true);
      this.ensureInputSource();
      if (this.recording && this._recMode === "audio") {
        void this.ensureAudioCaptureGraph().then(() => {
          this.setRecCapturing(wasCapturing);
        });
      } else {
        this.syncInputMonitor();
      }
    } else if (monChanged) {
      this.syncInputMonitor();
      if (this.audioPrefs.inputMonitor) this.maybeNudgeMonitorTip();
    }
    this.emit("transport");
  }

  private armedAudioTrack(): ArrTrack | null {
    if (!this.armedChannel) return null;
    const t = this.findTrack(this.armedChannel);
    return t?.kind === "audio" ? t : null;
  }

  private ensureDeviceListen() {
    if (this._deviceListen || !navigator.mediaDevices?.addEventListener) return;
    this._deviceListen = true;
    navigator.mediaDevices.addEventListener("devicechange", () => {
      void this.refreshAudioDevices();
    });
  }

  async listInputDevices(): Promise<{ deviceId: string; label: string }[]> {
    await this.refreshAudioDevices();
    return this.inputDevices;
  }

  async listOutputDevices(): Promise<{ deviceId: string; label: string }[]> {
    await this.refreshAudioDevices();
    return this.outputDevices;
  }

  /** @deprecated use refreshAudioDevices — kept so older call sites still work */
  async refreshInputDevices() {
    return this.refreshAudioDevices();
  }

  async refreshAudioDevices() {
    this.ensureDeviceListen();
    if (!navigator.mediaDevices?.enumerateDevices) {
      this.inputDevices = [];
      this.outputDevices = [];
      this.emit("transport");
      return;
    }
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      this.inputDevices = all
        .filter((d) => d.kind === "audioinput")
        .map((d, i) => ({
          deviceId: d.deviceId,
          label: d.label || "input " + (i + 1),
        }));
      this.outputDevices = all
        .filter((d) => d.kind === "audiooutput")
        .map((d, i) => ({
          deviceId: d.deviceId,
          label: d.label || "output " + (i + 1),
        }));
      const inId = this.audioPrefs.inputDeviceId;
      if (inId && !this.inputDevices.some((d) => d.deviceId === inId)) {
        this.audioPrefs.inputDeviceId = null;
        this.persistAudioPrefs();
        if (this._inputStream) void this.reopenInput();
      }
      const outId = this.audioPrefs.outputDeviceId;
      if (outId && !this.outputDevices.some((d) => d.deviceId === outId)) {
        this.audioPrefs.outputDeviceId = null;
        this.persistAudioPrefs();
        void this.applyOutputSink();
      }
    } catch {
      this.inputDevices = [];
      this.outputDevices = [];
    }
    this.emit("transport");
  }

  supportsSinkId(): boolean {
    const c = this.ctx as (AudioContext & { setSinkId?: unknown }) | null;
    return typeof c?.setSinkId === "function" || typeof (AudioContext.prototype as unknown as { setSinkId?: unknown }).setSinkId === "function";
  }

  private async applyOutputSink() {
    const c = this.ensureCtx() as AudioContext & {
      setSinkId?: (id: string) => Promise<void>;
    };
    if (typeof c.setSinkId !== "function") return;
    try {
      await c.setSinkId(this.audioPrefs.outputDeviceId || "");
    } catch {
      this.audioPrefs.outputDeviceId = null;
      this.persistAudioPrefs();
      this.pushNudge({
        id: "outputSink",
        dismissible: true,
        message:
          "Could not switch output device — fell back to the browser default.",
      });
      try {
        await c.setSinkId("");
      } catch {
        /* fine */
      }
    }
    this.emit("transport");
  }

  private audioConstraints(): MediaTrackConstraints {
    const c: MediaTrackConstraints & { latency?: number } = {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      // ask the browser for the lowest input buffering it will allow
      latency: 0,
    };
    if (this.audioPrefs.inputDeviceId)
      c.deviceId = { exact: this.audioPrefs.inputDeviceId };
    return c;
  }

  private readInputTrackLatency(stream: MediaStream) {
    const track = stream.getAudioTracks()[0];
    if (!track?.getSettings) {
      this._inputReportedLatencySec = 0;
      return;
    }
    const settings = track.getSettings() as MediaTrackSettings & {
      latency?: number;
    };
    const lat = settings.latency;
    this._inputReportedLatencySec =
      typeof lat === "number" && Number.isFinite(lat) ? Math.max(0, lat) : 0;
  }

  // Request mic/interface access and keep the stream warm while an audio track is armed.
  async enableInput(): Promise<boolean> {
    return this.openInput(false);
  }

  private async reopenInput(): Promise<boolean> {
    this.teardownInput();
    if (!this.armedAudioTrack()) {
      this.emit("transport");
      return false;
    }
    return this.openInput(false);
  }

  private async openInput(retried: boolean): Promise<boolean> {
    if (!navigator.mediaDevices?.getUserMedia) {
      this.inputStatus = "unsupported";
      this.emit("transport");
      return false;
    }
    if (this._inputStream) {
      this.inputStatus = "live";
      this.ensureInputSource();
      this.syncInputMonitor();
      void this.refreshInputDevices();
      this.emit("transport");
      return true;
    }
    // show arm spinner while the browser / interface opens the stream
    if (!retried) {
      this.inputStatus = "pending";
      this.emit("transport");
      this.emit("clip");
    }
    const gen = ++this._inputOpenGen;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: this.audioConstraints(),
      });
      if (gen !== this._inputOpenGen) {
        for (const t of stream.getTracks()) t.stop();
        return !!this._inputStream;
      }
      this._inputStream = stream;
      this.inputStatus = "live";
      this.readInputTrackLatency(stream);
      this.ensureInputSource();
      this.syncInputMonitor();
      void this.refreshInputDevices();
      this.emit("transport");
      this.emit("clip");
      return true;
    } catch {
      if (!retried && this.audioPrefs.inputDeviceId) {
        this.audioPrefs.inputDeviceId = null;
        this.persistAudioPrefs();
        return this.openInput(true);
      }
      this.inputStatus = "denied";
      this.maybeNudgeInputStatus();
      this.emit("transport");
      this.emit("clip");
      return false;
    }
  }

  private ensureInputSource() {
    if (!this._inputStream || this._inputSource) return;
    const c = this.ensureCtx();
    this._inputSource = c.createMediaStreamSource(this._inputStream);
  }

  private syncInputMonitor() {
    for (const n of this._monitorNodes) {
      try {
        n.disconnect();
      } catch {
        /* fine */
      }
    }
    this._monitorNodes = [];
    this._monitorGain = null;
    const t = this.armedAudioTrack();
    if (!t || !this._inputStream) return;
    this.ensureInputSource();
    if (!this._inputSource) return;
    const c = this.ensureCtx();
    // Ensure strip + analyser exist so the track fader meters input even when
    // the audible path bypasses FX/limiter (monitorBus).
    this.trackStrip(t);
    const an = this._arrStrips[t.id]?.an;
    if (!an) return;

    const fold = c.createGain();
    fold.gain.value = 1;
    const mode = this.audioPrefs.inputChannels;
    if (mode === "stereo") {
      this._inputSource.connect(fold);
      this._monitorNodes.push(fold);
    } else {
      const split = c.createChannelSplitter(2);
      const merge = c.createChannelMerger(2);
      this._inputSource.connect(split);
      if (mode === "left") {
        split.connect(merge, 0, 0);
        split.connect(merge, 0, 1);
      } else if (mode === "right") {
        split.connect(merge, 1, 0);
        split.connect(merge, 1, 1);
      } else {
        const gL = c.createGain();
        const gR = c.createGain();
        const sum = c.createGain();
        gL.gain.value = 0.5;
        gR.gain.value = 0.5;
        split.connect(gL, 0);
        split.connect(gR, 1);
        gL.connect(sum);
        gR.connect(sum);
        sum.connect(merge, 0, 0);
        sum.connect(merge, 0, 1);
        this._monitorNodes.push(gL, gR, sum);
      }
      merge.connect(fold);
      this._monitorNodes.push(split, merge, fold);
    }

    // Meter tap (silent leaf) — always on while armed so the fader reacts to input.
    fold.connect(an);

    // Audible path — low-latency bus only when monitor is enabled.
    const bus = this.nodes?.monitorBus;
    if (this.audioPrefs.inputMonitor && bus) {
      const hear = c.createGain();
      hear.gain.value = t.vol * this.trackGain(t);
      fold.connect(hear);
      hear.connect(bus);
      this._monitorNodes.push(hear);
      this._monitorGain = hear;
    }
  }

  private teardownInput() {
    this.stopAudioCaptureGraph(true);
    if (this._inputStream) {
      for (const t of this._inputStream.getTracks()) t.stop();
      this._inputStream = null;
    }
    this._inputReportedLatencySec = 0;
    this.inputStatus = "idle";
  }

  /** Tear down capture nodes. When `full`, also drop the MediaStreamSource + monitor. */
  private stopAudioCaptureGraph(full = true) {
    this.setRecCapturing(false);
    try {
      this._recWorklet?.port.postMessage({ type: "config", capturing: false });
    } catch {
      /* fine */
    }
    try {
      this._recWorklet?.disconnect();
    } catch {
      /* fine */
    }
    try {
      this._recProc?.disconnect();
    } catch {
      /* fine */
    }
    try {
      this._recSink?.disconnect();
    } catch {
      /* fine */
    }
    this._recWorklet = null;
    this._recProc = null;
    this._recSink = null;
    this._captureUsesWorklet = false;
    if (!full) return;
    for (const n of this._monitorNodes) {
      try {
        n.disconnect();
      } catch {
        /* fine */
      }
    }
    this._monitorNodes = [];
    this._monitorGain = null;
    try {
      this._inputSource?.disconnect();
    } catch {
      /* fine */
    }
    this._inputSource = null;
  }

  private setRecCapturing(on: boolean) {
    this._recCapturing = on;
    this.syncCaptureWorkletConfig();
  }

  private setCalibActive(on: boolean) {
    this._calibActive = on;
    this.syncCaptureWorkletConfig();
  }

  private syncCaptureWorkletConfig() {
    if (!this._recWorklet) return;
    try {
      this._recWorklet.port.postMessage({
        type: "config",
        capturing: this._recCapturing || this._calibActive,
        bufferSize: this.audioPrefs.bufferSize,
      });
    } catch {
      /* fine */
    }
  }

  /** Loop-brace punch: when loop is on, only keep audio inside [start, end). */
  private inPunchWindow(beat?: number): boolean {
    const l = this.arrangement.loop;
    if (!l?.on) return true;
    const b = beat ?? this.currentBeat();
    return b >= l.start - 1e-9 && b < l.end - 1e-9;
  }

  private ingestInputChunk(L: Float32Array, R: Float32Array | null) {
    const mapped = mapInputBlock(L, R, this.audioPrefs.inputChannels);
    if (this._calibActive) {
      this._calibChunks.push(mapped);
      return;
    }
    if (!this._recCapturing || !this.recording || this._recMode !== "audio")
      return;
    if (!this.inPunchWindow()) return;
    if (!this._punchStarted) {
      this._punchStarted = true;
      this._recStartBeat = this.currentBeat();
      this._recChunks = [];
      this.resetRecPeaks();
    }
    this._recChunks.push(mapped);
    this.appendRecPeaks(mapped[0]!);
  }

  private resetRecPeaks() {
    this._recPeaks = [];
    this._recPeakCarry = 0;
    this._recPeakCarryN = 0;
  }

  private appendRecPeaks(L: Float32Array) {
    const hop = AudioEngine.REC_PEAK_HOP;
    for (let i = 0; i < L.length; i++) {
      const a = Math.abs(L[i]!);
      if (a > this._recPeakCarry) this._recPeakCarry = a;
      this._recPeakCarryN++;
      if (this._recPeakCarryN >= hop) {
        this._recPeaks.push(this._recPeakCarry);
        this._recPeakCarry = 0;
        this._recPeakCarryN = 0;
      }
    }
  }

  /**
   * Live audio-take preview for the timeline (rAF). Null when not in an audio take,
   * or still in count-in / waiting for the loop brace (light punch).
   */
  audioRecordPreview(): {
    trackId: string;
    startBeat: number;
    endBeat: number;
    peaks: number[];
    waiting: boolean;
  } | null {
    if (!this.recording || this._recMode !== "audio" || !this._recTrackId)
      return null;
    const endBeat = this.sequencePlaying
      ? this.currentBeat()
      : this.insertBeat;
    if (!this._punchStarted) {
      // count-in or outside loop brace — show a thin waiting stub at the cursor
      return {
        trackId: this._recTrackId,
        startBeat: endBeat,
        endBeat: endBeat + 0.05,
        peaks: [],
        waiting: true,
      };
    }
    return {
      trackId: this._recTrackId,
      startBeat: this._recStartBeat,
      endBeat: Math.max(this._recStartBeat + 0.05, endBeat),
      peaks: this._recPeaks,
      waiting: false,
    };
  }

  private ensureCaptureWorklet(): Promise<boolean> {
    if (this._captureWorkletReady) return this._captureWorkletReady;
    this._captureWorkletReady = (async () => {
      try {
        const c = this.ensureCtx();
        await c.audioWorklet.addModule(
          new URL("./worklets/input-capture-processor.js", import.meta.url),
        );
        return true;
      } catch {
        this._captureWorkletReady = null; // allow retry
        return false;
      }
    })();
    return this._captureWorkletReady;
  }

  private _spectralWorkletsReady: Promise<boolean> | null = null;
  /** Warm impartialer + speccomp STFT worklets so FxChain can construct nodes sync. */
  ensureSpectralWorklets(): Promise<boolean> {
    if (this._spectralWorkletsReady) return this._spectralWorkletsReady;
    this._spectralWorkletsReady = (async () => {
      try {
        const c = this.ensureCtx();
        // AudioWorklet modules stick to the AudioContext — HMR never replaces them.
        // Full page reload is required after editing worklets (see hot.accept below).
        await Promise.all([
          c.audioWorklet.addModule(
            new URL("./worklets/impartialer-processor.js", import.meta.url),
          ),
          c.audioWorklet.addModule(
            new URL("./worklets/speccomp-processor.js", import.meta.url),
          ),
          c.audioWorklet.addModule(
            new URL("./worklets/centinel-processor.js", import.meta.url),
          ),
          c.audioWorklet.addModule(
            new URL("./worklets/cliplim-processor.js", import.meta.url),
          ),
        ]);
        return true;
      } catch {
        this._spectralWorkletsReady = null;
        return false;
      }
    })();
    return this._spectralWorkletsReady;
  }
  /** @deprecated use ensureSpectralWorklets */
  ensureImpartialerWorklet(): Promise<boolean> {
    return this.ensureSpectralWorklets();
  }

  // MediaStream → AudioWorklet (preferred) or ScriptProcessor fallback.
  // Chunks append only while capturing. Monitor is a parallel low-latency tap.
  private async ensureAudioCaptureGraph() {
    if (!this._inputStream || this._recWorklet || this._recProc) return;
    this.ensureInputSource();
    const src = this._inputSource;
    if (!src) return;
    const c = this.ensureCtx();
    const size = this.audioPrefs.bufferSize;
    const sink = c.createGain();
    sink.gain.value = 0;

    const useWorklet = await this.ensureCaptureWorklet();
    if (useWorklet) {
      try {
        const node = new AudioWorkletNode(c, "ain-input-capture", {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [2],
          channelCount: 2,
        });
        node.port.onmessage = (ev) => {
          const d = ev.data;
          if (!d || d.type !== "chunk") return;
          this.ingestInputChunk(d.L, d.R);
        };
        this._recWorklet = node;
        this.syncCaptureWorkletConfig();
        src.connect(node);
        node.connect(sink);
        sink.connect(c.destination);
        this._recSink = sink;
        this._captureUsesWorklet = true;
        this.syncInputMonitor();
        return;
      } catch {
        /* fall through to ScriptProcessor */
      }
    }

    const proc = c.createScriptProcessor(size, 2, 2);
    proc.onaudioprocess = (ev) => {
      if (!this._recCapturing && !this._calibActive) return;
      const n = ev.inputBuffer.numberOfChannels;
      const L = new Float32Array(ev.inputBuffer.getChannelData(0));
      const R =
        n > 1 ? new Float32Array(ev.inputBuffer.getChannelData(1)) : null;
      this.ingestInputChunk(L, R);
    };
    src.connect(proc);
    proc.connect(sink);
    sink.connect(c.destination);
    this._recProc = proc;
    this._recSink = sink;
    this._captureUsesWorklet = false;
    this.pushNudge({
      id: "scriptProcessor",
      dismissible: true,
      message:
        "AudioWorklet capture unavailable — using ScriptProcessor (higher latency / main-thread load).",
    });
    this.syncInputMonitor();
  }

  // Resolve which clip/track receives the take.
  private ensureRecTarget(): { trackId: string; clipId: string } | null {
    const beat =
      this.arrangeMode && this.sequencePlaying
        ? this.currentBeat()
        : this.insertBeat;
    const primary = this.primaryClip();
    if (primary) {
      const found = this.findClip(primary.trackId, primary.clipId);
      if (
        found &&
        (found[0].kind === "midi" || found[0].kind === "drum") &&
        found[1].content.kind !== "audio"
      )
        return primary;
    }
    const trackId =
      this.armedChannel ||
      (this._selTrackId &&
      this.arrangement.tracks.some(
        (t) =>
          t.id === this._selTrackId &&
          (t.kind === "midi" || t.kind === "drum"),
      )
        ? this._selTrackId
        : null) ||
      this.arrangement.tracks.find((t) => t.kind === "midi" || t.kind === "drum")
        ?.id ||
      null;
    if (!trackId) return null;
    const t = this.findTrack(trackId);
    if (!t) return null;
    const hit = t.clips.find(
      (c) =>
        c.content.kind !== "audio" &&
        beat >= c.startBeat - 1e-6 &&
        beat < c.startBeat + c.lengthBeats + 1e-6,
    );
    if (hit) return { trackId, clipId: hit.id };
    const bpb = this.arrangement.beatsPerBar;
    const start = Math.max(0, Math.floor(beat / bpb) * bpb);
    const content =
      t.kind === "drum"
        ? {
            kind: "drum" as const,
            pattern: {
              steps: 16,
              beatsPerBar: bpb,
              kitId: this.kit.id,
              bpm: this.arrangement.bpm,
              swing: 0,
              on: {},
              accent: {},
              laneMix: {},
            },
            notes: { bars: 1, beatsPerBar: bpb, notes: [] },
          }
        : {
            kind: "midi" as const,
            clip: { bars: 1, beatsPerBar: bpb, notes: [] },
          };
    const created = this.addClip(trackId, {
      startBeat: start,
      lengthBeats: bpb,
      loop: false,
      content,
    });
    if (!created) return null;
    this.selectClip(created.id);
    return { trackId, clipId: created.id };
  }

  // ● record: start a take (and play from the cursor if stopped), or finish the
  // current take without stopping playback.
  toggleRecord() {
    if (this.recording) {
      this.finishRecording();
      return;
    }
    void this.beginRecord();
  }

  private async beginRecord() {
    this.arrangeMode = true;
    const armed = this.armedChannel
      ? this.findTrack(this.armedChannel)
      : null;
    const selAudio =
      this._selTrackId &&
      this.findTrack(this._selTrackId)?.kind === "audio"
        ? this._selTrackId
        : null;
    const audioTrackId =
      armed?.kind === "audio" ? armed.id : !armed ? selAudio : null;

    if (audioTrackId) {
      const ok = await this.enableInput();
      if (!ok || !this._inputStream) {
        this.emit("transport");
        return;
      }
      await this.ensureAudioCaptureGraph();
      this.pushUndo("arrange");
      this._recMode = "audio";
      this._recTrackId = audioTrackId;
      this._recTarget = null;
      this._recChunks = [];
      this._punchStarted = false;
      this.resetRecPeaks();
      this.setRecCapturing(false);
      this._recStartBeat = this.insertBeat;
      this.recording = true;
      if (!(this.sequencePlaying && this.arrangeMode))
        this.playArrangement(this.insertBeat);
      else this.emit("transport");
      if (!this.inCountIn()) this.beginAudioCapture();
      return;
    }

    void this.enableMidi();
    const target = this.ensureRecTarget();
    if (!target) {
      this.emit("transport");
      return;
    }
    this.pushUndo("content:" + target.clipId);
    this._recMode = "midi";
    this._recTrackId = null;
    this._recTarget = target;
    this._recOpen.clear();
    this.recording = true;
    if (!(this.sequencePlaying && this.arrangeMode))
      this.playArrangement(this.insertBeat);
    else this.emit("transport");
  }

  private beginAudioCapture() {
    if (this._recMode !== "audio" || this._recCapturing) return;
    this._recStartBeat = this.currentBeat();
    this._recChunks = [];
    this._punchStarted = false;
    this.setRecCapturing(true);
  }

  // called from schedTick so count-in → capture is transport-clock accurate
  private maybeStartAudioCapture() {
    if (
      this.recording &&
      this._recMode === "audio" &&
      !this._recCapturing &&
      !this.inCountIn()
    )
      this.beginAudioCapture();
  }

  private finishRecording(endBeat?: number) {
    if (!this.recording) return;
    const at =
      endBeat ??
      (this.sequencePlaying ? this.currentBeat() : this.insertBeat);
    if (this._recMode === "audio") {
      this.bakeAudioTake(at);
    } else if (!this.inCountIn()) {
      for (const midi of [...this._recOpen.keys()]) this.commitRecNote(midi, at);
    }
    this._recOpen.clear();
    this.setRecCapturing(false);
    this._recChunks = [];
    this.resetRecPeaks();
    this.recording = false;
    this._recTarget = null;
    this._recMode = null;
    this._recTrackId = null;
    this.recordStamp++;
    this.saveArr();
    this.emit("transport");
  }

  // Concatenate capture chunks → AudioBuffer → imported clip on the track.
  private bakeAudioTake(endBeat: number) {
    this.setRecCapturing(false);
    const trackId = this._recTrackId;
    const c = this.ctx;
    if (!trackId || !c || this._recChunks.length === 0) return;
    const loop = this.arrangement.loop;
    let startBeat = this._recStartBeat;
    let end = endBeat;
    if (loop?.on) {
      startBeat = Math.max(startBeat, loop.start);
      end = Math.min(end, loop.end);
    }
    const lenBeats = Math.max(0.25, end - startBeat);
    const compBeats =
      (this.effectiveLatencyMs() / 1000) * (this.arrangement.bpm / 60);
    let place = Math.max(0, startBeat - compBeats);
    if (loop?.on) place = Math.max(loop.start, place);
    let frames = 0;
    for (const block of this._recChunks) frames += block[0].length;
    if (frames < 64) return; // nothing useful
    const nCh = this._recChunks[0].length;
    const buf = c.createBuffer(nCh, frames, c.sampleRate);
    let o = 0;
    for (const block of this._recChunks) {
      const n = block[0].length;
      for (let ch = 0; ch < nCh; ch++)
        buf.copyToChannel(block[ch] as Float32Array<ArrayBuffer>, ch, o);
      o += n;
    }
    const bufId = "rec" + ++this._importSeq + Date.now().toString(36);
    this._importBufs[bufId] = buf;
    void putAudioBuffer(bufId, buf, "take");
    const name =
      "take " +
      (Math.floor(startBeat / this.arrangement.beatsPerBar) + 1) +
      "." +
      (Math.floor(startBeat % this.arrangement.beatsPerBar) + 1);
    const created = this.addClip(trackId, {
      startBeat: place,
      lengthBeats: lenBeats,
      loop: false,
      content: {
        kind: "audio",
        bufId,
        name,
        rootBpm: this.arrangement.bpm,
        norm: true,
        loop: false,
      },
    });
    if (created) this.selectClip(created.id);
  }

  /**
   * Play a click, capture ~1s of input, measure peak delay → manual latencyMs.
   * Needs mic permission (arm an audio track or allow input first).
   */
  async calibrateLatency(): Promise<number | null> {
    if (this._calibActive || this.calibrateStatus === "running") return null;
    if (!navigator.mediaDevices?.getUserMedia) {
      this.calibrateStatus = "unsupported";
      this.emit("transport");
      return null;
    }
    this.calibrateStatus = "running";
    this.lastCalibrateMs = null;
    this.emit("transport");

    const ok = await this.enableInput();
    if (!ok || !this._inputStream) {
      this.calibrateStatus = "needInput";
      this.emit("transport");
      return null;
    }
    await this.ensureAudioCaptureGraph();
    this._calibChunks = [];
    const c = this.ensureCtx();
    const t0 = c.currentTime;
    const clickAt = t0 + 0.08;
    this._calibClickAt = clickAt;
    this.metroClick(clickAt, true);
    this.setCalibActive(true);

    await new Promise<void>((r) => setTimeout(r, 1100));
    this.setCalibActive(false);

    const sr = c.sampleRate;
    let frames = 0;
    for (const block of this._calibChunks) frames += block[0].length;
    if (frames < sr * 0.05) {
      this.calibrateStatus = "failed";
      this._calibChunks = [];
      this.emit("transport");
      return null;
    }
    const mono = new Float32Array(frames);
    let o = 0;
    for (const block of this._calibChunks) {
      const L = block[0];
      mono.set(L, o);
      o += L.length;
    }
    this._calibChunks = [];

    let peakI = 0;
    let peakAbs = 0;
    const searchFrom = Math.max(0, Math.floor(0.02 * sr));
    for (let i = searchFrom; i < mono.length; i++) {
      const a = Math.abs(mono[i]!);
      if (a > peakAbs) {
        peakAbs = a;
        peakI = i;
      }
    }
    if (peakAbs < 0.02) {
      this.calibrateStatus = "failed";
      this.emit("transport");
      return null;
    }
    const peakTime = t0 + peakI / sr;
    let ms = Math.round((peakTime - clickAt) * 1000);
    ms = Math.max(0, Math.min(500, ms));
    this.setAudioPrefs({ latencyMode: "manual", latencyMs: ms });
    this.lastCalibrateMs = ms;
    this.calibrateStatus = "done";
    this.emit("transport");
    return ms;
  }

  private commitRecNote(midi: number, endBeat: number) {
    const open = this._recOpen.get(midi);
    const target = this._recTarget;
    if (!open || !target) return;
    this._recOpen.delete(midi);
    const found = this.findClip(target.trackId, target.clipId);
    if (!found) return;
    const [tr, clip] = found;
    const localStart = open.startBeat - clip.startBeat;
    if (localStart < -1e-6) return; // landed before the clip window
    const start = Math.max(0, localStart);
    const length = Math.max(0.05, endBeat - open.startBeat);
    // grow the clip window if the note runs past its end
    if (start + length > clip.lengthBeats) {
      clip.lengthBeats = start + length;
      this.resolveOverlaps(tr, clip);
    }
    const note = {
      id: newNoteId(),
      pitch: midi,
      start,
      length,
      vel: open.vel,
    };
    if (clip.content.kind === "midi") {
      const nc = clip.content.clip;
      nc.notes.push(note);
      const need = Math.ceil((start + length) / Math.max(1, nc.beatsPerBar));
      if (need > nc.bars) nc.bars = need;
    } else if (clip.content.kind === "drum") {
      const bpb = this.arrangement.beatsPerBar;
      if (!clip.content.notes)
        clip.content.notes = { bars: 1, beatsPerBar: bpb, notes: [] };
      const nc = clip.content.notes;
      nc.notes.push(note);
      const need = Math.ceil((start + length) / Math.max(1, nc.beatsPerBar));
      if (need > nc.bars) nc.bars = need;
    }
    this.saveArr();
  }

  private recordNoteOn(midi: number, vel: number) {
    if (!this.recording || this._recMode !== "midi") return;
    if (!this.arrangeMode || !this.sequencePlaying) return;
    if (this.inCountIn()) return; // monitor-only during count-in
    if (!this._recTarget) return;
    // retrigger: close the previous hold for this pitch first
    if (this._recOpen.has(midi)) this.commitRecNote(midi, this.currentBeat());
    this._recOpen.set(midi, {
      startBeat: this.currentBeat(),
      vel: Math.min(1, Math.max(0.05, vel)),
    });
  }

  private recordNoteOff(midi: number) {
    if (!this.recording || this._recMode !== "midi" || !this._recOpen.has(midi))
      return;
    if (this.inCountIn()) {
      this._recOpen.delete(midi); // never started a recorded note
      return;
    }
    this.commitRecNote(midi, this.currentBeat());
  }

  // resolve an instrument id (a patch key OR a legacy sampled-preset id) to a live
  // SynthPatch, seeding a preset-patch on demand. Falls back to the active patch.
  private resolvePatch(id: string | undefined): SynthPatch {
    if (id && this.patches[id]) return this.patches[id];
    const pr = id ? this.samplePresets.find((p) => p.id === id) : undefined;
    if (pr) {
      if (!(pr.name in this.patches) && pr.zones.length)
        this.patches[pr.name] = patchFromPreset(pr, pr.id);
      if (this.patches[pr.name]) return this.patches[pr.name];
    }
    return this.currentPatch();
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
    // muted (deactivated) notes stay in the clip but are never voiced
    const sorted = notes
      .filter((n) => !n.muted)
      .sort((a, b) => a.start - b.start || a.pitch - b.pitch);
    const runs: NoteRun[] = [];
    let open: NoteRun | null = null;
    const EPS = 1e-4;
    for (const n of sorted) {
      // a slide note continues the open run if it starts at/before that run's end
      if (n.slide && open && n.start <= open.endBeat + EPS) {
        open.bends.push({
          toMidi: n.pitch,
          fromBeat: n.start,
          atBeat: n.start + n.length,
        });
        open.endBeat = Math.max(open.endBeat, n.start + n.length);
      } else {
        open = {
          startBeat: n.start,
          endBeat: n.start + n.length,
          pitch: n.pitch,
          vel: n.vel,
          bends: [],
        };
        runs.push(open);
      }
    }
    return runs;
  }
  // ── arrangement (linear timeline): tracks + placed clips ──────────────────
  private saveArr() {
    saveArrangement(this.arrangement);
    this.emit("arrange");
  }
  // lazily build a track's FX→ADC→vol→pan→sum strip; returns the unity input junction.
  // Fader is POST-FX so level-dependent devices (crush waveshaper, filter resonance,
  // delay feedback) keep their character when the track volume moves — standard
  // channel-strip order. Mute/solo still ride the same post-FX gain node.
  // Mini-ADC: each strip's `adc` DelayNode pads shorter (less latent) tracks so they
  // align with the longest peer at the sum bus.
  private trackStrip(t: ArrTrack): GainNode {
    const c = this.ensureCtx();
    const n = this.nodes!;
    let s = this._arrStrips[t.id];
    if (!s) {
      const input = c.createGain(); // unity; sources land here
      const adc = c.createDelay(1.0);
      adc.delayTime.value = 0;
      const gain = c.createGain(); // post-FX fader
      const pan = c.createStereoPanner();
      adc.connect(gain);
      gain.connect(pan);
      pan.connect(n.sum);
      // post-strip meter tap: pan → analyser (measure only; also → sum). Reflects the
      // true post-fader, post-FX signal this track contributes.
      const an = c.createAnalyser();
      an.fftSize = 2048;
      an.smoothingTimeConstant = 0;
      pan.connect(an);
      // in → [devices] → adc → gain → pan → sum. Seeded from the track's persisted device
      // list (empty = clean passthrough).
      const fx = new FxChain(c, input, adc);
      fx.setDevices((t.devices || []).map((d) => structuredClone(d)));
      fx.applyAll(this.bpm);
      s = this._arrStrips[t.id] = { in: input, gain, pan, fx, an, adc };
      this.refreshTrackAdc();
    }
    s.gain.gain.value = t.vol * this.trackGain(t);
    s.pan.pan.value = t.pan;
    return s.in;
  }

  /** Recompute per-track ADC delays from live FX chain latencies. */
  private refreshTrackAdc() {
    if (!this.ctx) return;
    const sr = this.ctx.sampleRate;
    const t = this.ctx.currentTime;
    let maxL = 0;
    const lat: Record<string, number> = {};
    for (const id of Object.keys(this._arrStrips)) {
      const s = this._arrStrips[id];
      const L = s.fx.latencySamples(sr);
      lat[id] = L;
      if (L > maxL) maxL = L;
    }
    for (const id of Object.keys(this._arrStrips)) {
      const s = this._arrStrips[id];
      const sec = Math.min(1, Math.max(0, (maxL - (lat[id] ?? 0)) / sr));
      s.adc.delayTime.setTargetAtTime(sec, t, 0.02);
    }
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
    // keep low-latency monitor level in sync with mute/solo/fader
    if (this._monitorGain && this.audioPrefs.inputMonitor) {
      const armed = this.armedAudioTrack();
      if (armed)
        this._monitorGain.gain.setTargetAtTime(
          armed.vol * this.trackGain(armed),
          tt,
          0.02,
        );
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
      name:
        name ||
        (kind === "midi"
          ? "midi " + n
          : kind === "drum"
            ? "drums " + n
            : "audio " + n),
      kind,
      presetId: kind === "midi" ? this.synthPatches[0] : undefined, // unified patch key
      mute: false,
      solo: false,
      vol: 1, // unity (0 dB) — the conventional DAW default; headroom lives at the master
      pan: 0,
      clips: [],
    };
    if (t.presetId) this.warmPatch(this.resolvePatch(t.presetId));
    this.arrangement.tracks.push(t);
    this.saveArr();
    return t;
  }
  removeTrack(id: string) {
    if (this.armedChannel === id) this.armChannel(null);
    const t = this.findTrack(id);
    if (t)
      for (const c of t.clips) {
        this.stopAudioForClip(c.id); // stop any live audio
        this.disposeStretch(c.id);
      }
    this.arrangement.tracks = this.arrangement.tracks.filter(
      (t) => t.id !== id,
    );
    const s = this._arrStrips[id];
    if (s) {
      try {
        s.fx.dispose();
        s.in.disconnect();
        s.adc.disconnect();
        s.gain.disconnect();
        s.pan.disconnect();
        s.an.disconnect();
      } catch {
        /* fine */
      }
      delete this._arrStrips[id];
    }
    this.refreshTrackAdc();
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
    this.pushUndoCoalesced("vol:" + id); // one undo step per knob gesture
    t.vol = Math.min(GAIN_MAX, Math.max(0, vol));
    const s = this._arrStrips[id];
    if (s && this.ctx)
      s.gain.gain.setTargetAtTime(
        t.vol * this.trackGain(t),
        this.ctx.currentTime,
        0.02,
      );
    this.saveArr();
  }
  setTrackPan(id: string, pan: number) {
    const t = this.findTrack(id);
    if (!t) return;
    this.pushUndoCoalesced("pan:" + id); // one undo step per knob gesture
    t.pan = Math.min(1, Math.max(-1, pan));
    const s = this._arrStrips[id];
    if (s && this.ctx)
      s.pan.pan.setTargetAtTime(t.pan, this.ctx.currentTime, 0.02);
    this.saveArr();
  }

  // ── per-track FX chain API (the per-track FX UI drives these) ──
  // ensures the live strip+chain exists (builds it if the track was never voiced yet),
  // then returns it. Keeps t.devices (persisted) in sync after each mutation.
  private trackFx(
    id: string,
  ): {
    s: {
      in: GainNode;
      gain: GainNode;
      pan: StereoPannerNode;
      fx: FxChain;
    };
    t: ArrTrack;
  } | null {
    const t = this.findTrack(id);
    if (!t) return null;
    this.trackStrip(t); // idempotent build
    const s = this._arrStrips[id];
    return s ? { s, t } : null;
  }
  trackDevices(id: string): FxDeviceState[] {
    return (
      this._arrStrips[id]?.fx.states() ?? this.findTrack(id)?.devices ?? []
    );
  }
  addTrackDevice(id: string, type: FxDeviceType) {
    if (type === "impartialer" || type === "speccomp" || type === "centinel" || type === "cliplim")
      void this.ensureSpectralWorklets();
    const r = this.trackFx(id);
    if (!r) return;
    r.s.fx.addDevice(type);
    r.t.devices = r.s.fx.states();
    this.saveArr();
    this.emit("fx");
    this.refreshTrackAdc();
    if (type === "impartialer" || type === "speccomp" || type === "centinel" || type === "cliplim") {
      void this.ensureSpectralWorklets().then((ok) => {
        if (ok) {
          r.s.fx.applyAll(this.bpm);
          this.refreshTrackAdc();
        }
      });
    }
  }
  removeTrackDevice(id: string, deviceId: string) {
    const r = this.trackFx(id);
    if (!r) return;
    r.s.fx.removeDevice(deviceId);
    r.t.devices = r.s.fx.states();
    this.saveArr();
    this.emit("fx");
    this.refreshTrackAdc();
  }
  moveTrackDevice(id: string, deviceId: string, toIndex: number) {
    const r = this.trackFx(id);
    if (!r) return;
    r.s.fx.moveDevice(deviceId, toIndex);
    r.t.devices = r.s.fx.states();
    this.saveArr();
    this.emit("fx");
    this.refreshTrackAdc();
  }
  setTrackDeviceParams(id: string, deviceId: string, params: unknown) {
    const r = this.trackFx(id);
    if (!r) return;
    r.s.fx.setParams(deviceId, params, this.bpm);
    r.t.devices = r.s.fx.states();
    this.saveArr();
    this.emit("fx");
    this.refreshTrackAdc();
  }

  /** Latest spectral viz frame from a track-chain device (poll from rAF). */
  readTrackFxViz(trackId: string, deviceId: string) {
    return this._arrStrips[trackId]?.fx.readViz(deviceId) ?? null;
  }

  copyTrackDevice(trackId: string, deviceId: string) {
    const d = this.trackDevices(trackId).find((x) => x.id === deviceId);
    if (!d) return;
    this._fxClipboard = { type: d.type, params: structuredClone(d.params) };
    this.emit("fx");
  }

  /** Label of the device on the FX clipboard (for paste menus), or null. */
  fxClipboardLabel(): string | null {
    return this._fxClipboard ? FX_DEVICES[this._fxClipboard.type].label : null;
  }

  pasteTrackDevice(trackId: string, atIndex?: number) {
    if (!this._fxClipboard) return;
    const type = this._fxClipboard.type;
    if (type === "impartialer" || type === "speccomp" || type === "centinel" || type === "cliplim")
      void this.ensureSpectralWorklets();
    const r = this.trackFx(trackId);
    if (!r) return;
    r.s.fx.insertDevice(this._fxClipboard, atIndex);
    r.t.devices = r.s.fx.states();
    this.saveArr();
    this.emit("fx");
    this.refreshTrackAdc();
    if (type === "impartialer" || type === "speccomp" || type === "centinel" || type === "cliplim") {
      void this.ensureSpectralWorklets().then((ok) => {
        if (ok) {
          r.s.fx.applyAll(this.bpm);
          this.refreshTrackAdc();
        }
      });
    }
  }

  duplicateTrackDevice(trackId: string, deviceId: string) {
    const list = this.trackDevices(trackId);
    const i = list.findIndex((x) => x.id === deviceId);
    if (i < 0) return;
    this.copyTrackDevice(trackId, deviceId);
    this.pasteTrackDevice(trackId, i + 1);
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
  private findClip(
    trackId: string,
    clipId: string,
  ): [ArrTrack, ArrClip] | null {
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
      if (c.id === keep.id) {
        out.push(c);
        continue;
      }
      const cs = c.startBeat;
      const ce = c.startBeat + c.lengthBeats;
      if (ce <= ks || cs >= ke) {
        out.push(c);
        continue;
      } // no overlap
      if (cs >= ks && ce <= ke) {
        this.stopAudioForClip(c.id);
        continue;
      } // fully covered → drop
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
    this.disposeStretch(clipId);
    this.saveArr();
  }
  // move a clip (optionally to another track); startBeat clamped ≥ 0
  moveClip(
    trackId: string,
    clipId: string,
    startBeat: number,
    toTrackId?: string,
  ) {
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
  // With the loop toggle OFF an audio clip is pinned to its material: returns the
  // content's span in beats (the clip's max length), or null when no cap applies.
  private clipContentCap(c: ArrClip): number | null {
    if (c.content.kind !== "audio" || c.content.loop !== false) return null;
    const bd = 60 / this.arrangement.bpm;
    const s = this.audioClipSource(c, bd, this.arrangement.bpm);
    return s ? Math.max(0.25, s.trimmedSec / s.rate / bd) : null;
  }
  resizeClip(trackId: string, clipId: string, lengthBeats: number) {
    const found = this.findClip(trackId, clipId);
    if (!found) return;
    let len = Math.max(0.25, lengthBeats);
    const cap = this.clipContentCap(found[1]);
    if (cap != null) len = Math.min(len, cap); // loop OFF: the edge stops at the sample's end
    found[1].lengthBeats = len;
    this.stopAudioForClip(clipId); // re-fire with the new length (fixes stale stop time)
    this.resolveOverlaps(found[0], found[1]);
    this.saveArr();
  }
  // Live multi-clip mouse drag: place every item at base + delta (a UNIFORM delta,
  // clamped so nothing crosses beat 0 — same rule as nudgeSelection). Because the
  // selection keeps its relative layout, selected clips can never trim each other in
  // resolveOverlaps; only non-selected clips under the drop get trimmed (as in a
  // single-clip drag). Beat-move only — cross-track hops stay single-clip / ↑↓ keys.
  dragSelectionTo(
    items: { trackId: string; clipId: string; base: number }[],
    delta: number,
  ) {
    if (!items.length) return;
    const minBase = Math.min(...items.map((i) => i.base));
    const d = Math.max(delta, -minBase);
    const moved: { t: ArrTrack; c: ArrClip }[] = [];
    for (const it of items) {
      const found = this.findClip(it.trackId, it.clipId);
      if (!found) continue;
      found[1].startBeat = Math.max(0, it.base + d);
      moved.push({ t: found[0], c: found[1] });
    }
    for (const m of moved) this.resolveOverlaps(m.t, m.c);
    for (const m of moved) this.stopAudioForClip(m.c.id); // re-fire at the new spots
    this.saveArr();
  }
  duplicateClip(trackId: string, clipId: string): ArrClip | null {
    const found = this.findClip(trackId, clipId);
    if (!found) return null;
    const [t, c] = found;
    const copy: ArrClip = {
      ...structuredClone(c),
      id: newClipId(),
      startBeat: c.startBeat + c.lengthBeats,
    };
    t.clips.push(copy);
    this.resolveOverlaps(t, copy);
    this.saveArr();
    return copy;
  }
  // ⌥+edge-drag STRETCH: content scales to the new clip length (vs. plain resize,
  // which tiles/cuts). MIDI/drum scale their notes (lossless — the grid hatches
  // off-grid results); audio stores a cumulative `stretch` factor — tape-style in
  // off/varispeed, PITCH-PRESERVED in beats/complex (it folds into the warp ratio).
  // Called live per drag move (self-correcting: the factor re-derives each call).
  stretchClipTo(trackId: string, clipId: string, lengthBeats: number) {
    const found = this.findClip(trackId, clipId);
    if (!found) return;
    const [t, c] = found;
    const newLen = Math.max(0.25, lengthBeats);
    const f = newLen / c.lengthBeats;
    if (Math.abs(f - 1) < 1e-9) return;
    if (c.content.kind === "midi") {
      const nc = c.content.clip;
      for (const n of nc.notes) {
        n.start *= f;
        n.length *= f;
      }
      nc.bars = Math.max(1, Math.ceil(newLen / nc.beatsPerBar));
    } else if (c.content.kind === "drum") {
      // notes are the truth (convert a grid-only pattern first so nothing is lost)
      const dc = c.content; // narrow once — closures below would lose the discriminant
      const kit = findKit(dc.pattern.kitId);
      const notes = dc.notes ?? patternToNotes(dc.pattern, kit);
      for (const n of notes.notes) {
        n.start *= f;
        n.length *= f;
      }
      notes.bars = Math.max(1, Math.ceil(newLen / notes.beatsPerBar));
      const steps = Math.max(1, Math.round(dc.pattern.steps * f));
      c.content = { ...dc, pattern: { ...dc.pattern, steps }, notes };
    } else {
      const cur = c.content.stretch && c.content.stretch > 0 ? c.content.stretch : 1;
      c.content = { ...c.content, stretch: Math.min(16, Math.max(1 / 16, cur * f)) };
    }
    c.lengthBeats = newLen;
    this.stopAudioForClip(clipId); // live sources re-fire with the new geometry
    this.resolveOverlaps(t, c);
    this.saveArr();
  }

  // per-clip swing (0.5 = straight … 0.75 = hard). Scheduler-side only — stored notes
  // stay straight, so the piano roll / grid always shows the unswung truth. Undoable as
  // one step per knob gesture (coalesced — the knob has no pointer-down hook).
  setClipSwing(trackId: string, clipId: string, swing: number) {
    const found = this.findClip(trackId, clipId);
    if (!found) return;
    this.pushUndoCoalesced("swing:" + clipId);
    const v = Math.min(0.75, Math.max(0.5, swing));
    found[1].swing = v > 0.505 ? v : undefined;
    this.saveArr();
  }

  // Slip edit: shift content under fixed clip bounds (beats). Coalesced per clip so
  // a Shift+⌥ drag is one ⌘Z. Live audio re-fires (structural — offset into buffer).
  setClipSlip(trackId: string, clipId: string, slip: number) {
    const found = this.findClip(trackId, clipId);
    if (!found) return;
    this.pushUndoCoalesced("slip:" + clipId);
    const v = Number.isFinite(slip) ? slip : 0;
    found[1].slip = Math.abs(v) < 1e-9 ? undefined : v;
    this.stopAudioForClip(clipId); // offset into the buffer can't patch a live node
    this.saveArr();
  }

  // write back edited clip content (from the piano roll / step grid / loop editor)
  setClipContent(
    trackId: string,
    clipId: string,
    content: ArrClip["content"],
    undoable = true,
  ) {
    const found = this.findClip(trackId, clipId);
    const prev = found?.[1].content;
    // content edits (piano-roll/drum-grid commits, audio-param knobs) are undo steps —
    // coalesced per clip so a knob drag or a burst of note edits is ONE ⌘Z. Without
    // this, ⌘Z after editing notes silently reverted the last TIMELINE op instead.
    if (found && undoable) this.pushUndoCoalesced("content:" + clipId);
    if (found) found[1].content = content;
    // left complex mode → the live stretch node is dead weight; drop it
    if (
      found &&
      content.kind === "audio" &&
      warpModeOf(content) !== "complex" &&
      this._stretch[clipId]
    )
      this.disposeStretch(clipId);
    // loop OFF pins the clip to its material — toggling loop off (or shrinking the
    // content via trim/transpose/sync) pulls an over-long clip's edge in with it
    if (found) {
      const cap = this.clipContentCap(found[1]);
      if (cap != null && found[1].lengthBeats > cap + 1e-6) {
        found[1].lengthBeats = cap;
        this.stopAudioForClip(clipId); // a live node's stop time is stale after the trim
      }
    }
    // Reflect the edit on a clip that's playing RIGHT NOW:
    //  · off/varispeed RATE-only (sync / semi / cents / stretch) → smoothly re-rate the
    //    live buffer source so a knob drag warbles continuously.
    //  · complex → push rate+semitones onto the live stretch node (playbackRate is not
    //    the pitch path — that was why transpose only applied after stop/play).
    //  · beats → semis are baked into the sliced buffer; stop so the scheduler re-fires
    //    once the new render lands.
    //  · STRUCTURAL (trim a/b, reverse, loop region, buffer, warp mode, …) → stop + re-fire.
    if (content.kind === "audio" && this.ctx && prev?.kind === "audio") {
      const structural =
        prev.bufId !== content.bufId ||
        prev.loopId !== content.loopId ||
        prev.reverse !== content.reverse ||
        (prev.loop ?? true) !== (content.loop ?? true) || // loop toggle changes the source's loop config
        warpModeOf(prev) !== warpModeOf(content) || // a warp-mode change swaps the whole source path
        !!prev.norm !== !!content.norm || // normalize changes the fire-time gain
        (prev.a ?? 0) !== (content.a ?? 0) ||
        (prev.b ?? 1) !== (content.b ?? 1) ||
        prev.loopA !== content.loopA ||
        prev.loopB !== content.loopB;
      if (structural) {
        this.stopAudioForClip(clipId); // re-fire with the new trim/reverse/loop next tick
      } else {
        const mode = warpModeOf(content);
        const tt = this.ctx.currentTime;
        if (mode === "complex") {
          const st = this._stretch[clipId];
          if (st?.ready && st.node) {
            const { ratio, semis } = this.warpParams(content);
            // one-slot queue: this pops any deferred deactivate — mark stopSent false so
            // the stretch sweep re-sends it (same bookkeeping as a live tempo drag)
            st.node.schedule({
              output: tt,
              rate: ratio,
              semitones: semis,
            });
            for (const key in this._stretchFired) {
              if (!key.startsWith(clipId + "@")) continue;
              const f = this._stretchFired[key];
              f.when = Math.min(f.when, tt);
              f.stopSent = false;
            }
          }
          // tape fallback while the node is still warming: tempo-fit only (no pitch)
          const fallbackRate = this.warpParams(content).ratio;
          for (const key in this._startedAudio) {
            if (!key.startsWith(clipId + "@")) continue;
            const a = this._startedAudio[key];
            a.src.playbackRate.setTargetAtTime(fallbackRate, tt, 0.02);
            a.synced = false;
            a.baseRate = fallbackRate;
            a.baseBpm = this.bpm;
          }
        } else if (mode === "beats") {
          this.stopAudioForClip(clipId); // new slice render keyed on semis
        } else {
          const rate = this.audioClipRate(content);
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
    const prev = this.arrangement.bpm;
    const next = Math.min(220, Math.max(40, Math.round(bpm)));
    if (next !== prev) {
      // UNSYNCED audio clips are TIME-TRUE: their wall-clock span survives a tempo
      // change, so their beat-length rescales with it — end points move, the sample is
      // never cut (nor left looping) by a tempo move. Synced/WARPED clips stretch with
      // the grid instead (varispeed / stretch render), so their beat-span stays put.
      // No overlap resolution here: a grown clip may overlap a neighbor visually until
      // the user next edits — trimming neighbors mid-tempo-drag would be destructive.
      const ratio = next / prev;
      for (const t of this.arrangement.tracks) {
        for (const c of t.clips) {
          if (c.content.kind === "audio" && warpModeOf(c.content) === "off")
            c.lengthBeats = Math.max(0.01, c.lengthBeats * ratio);
        }
      }
    }
    this.arrangement.bpm = next;
    // keep the transport clock in lockstep even when stopped — waveform geometry, the
    // consolidate bounce, and tempo-synced FX all read the live bpm
    this.setBpm(next);
    this.saveArr();
  }
  setArrangementLoop(start: number, end: number, on: boolean) {
    this.arrangement.loop = {
      start: Math.max(0, start),
      end: Math.max(start + 0.25, end),
      on,
    };
    this.loopOn = on;
    this.saveArr();
  }

  // Voice one drum lane at `when`, into `dest`. Sample path reuses the same
  // filter + filt-env + amp-env math as the synth sample oscillator (`voice-env.ts`).
  private voiceDrum(
    lane: DrumLane,
    when: number,
    vel: number,
    dest: AudioNode,
    kitId: string = this.kit.id,
  ) {
    const c = this.ensureCtx();
    const buf = this.resolveDrumLaneBuf(lane, kitId);
    if (!buf) {
      this.synthDrum(lane, when, vel, dest);
      return;
    }

    const a = Math.min(0.999, Math.max(0, lane.a ?? 0));
    const b = Math.min(1, Math.max(a + 0.001, lane.b ?? 1));
    const startSec = a * buf.duration;
    const playDur = Math.max(0.01, (b - a) * buf.duration);
    const peak = vel * (lane.gain ?? 1);
    const ampEnv = lane.ampEnv ?? DEFAULT_DRUM_AMP;
    const filt = lane.filter ?? DEFAULT_DRUM_FILT;
    const filtEnv = lane.filtEnv ?? DEFAULT_DRUM_FILT_ENV;
    const filterOn = filt.on !== false;

    const vg = c.createGain();
    vg.gain.value = 0;
    // one-shot: begin release near the end of the played region (no note-off)
    const releaseAt =
      when + Math.max(0.02, playDur - Math.max(0.02, ampEnv.r));
    const ampEnd = scheduleAmpOneShot(vg.gain, when, ampEnv, peak, releaseAt);
    vg.connect(dest);

    const vf = c.createBiquadFilter();
    if (filterOn) {
      vf.type = filt.type;
      vf.Q.value = filt.q;
      if (Math.abs(filtEnv.amt) > 1) {
        scheduleFiltEnvOneShot(
          vf.frequency,
          when,
          filt.cut,
          filtEnv,
          releaseAt,
        );
      } else {
        vf.frequency.value = filt.cut;
      }
      vf.connect(vg);
    } else {
      vf.type = "allpass";
      vf.connect(vg);
    }

    const src = c.createBufferSource();
    src.buffer = buf;
    src.connect(vf);
    src.start(when, startSec, playDur);
    const stopAt = Math.max(when + playDur, ampEnd) + 0.05;
    try {
      src.stop(stopAt);
    } catch {
      /* fine */
    }
    src.onended = () => {
      try {
        vg.disconnect();
        vf.disconnect();
      } catch {
        /* fine */
      }
    };
  }

  /** Patch voice params on a kit lane (promotes builtin → user kit). Returns kit id. */
  setKitLaneVoice(
    kitId: string,
    laneId: string,
    partial: Partial<
      Pick<
        DrumLane,
        "a" | "b" | "gain" | "filter" | "filtEnv" | "ampEnv" | "name" | "tone"
      >
    >,
  ): string {
    let kit = findKit(kitId);
    const wasBuiltin = !kit.user;
    const prevId = kit.id;
    if (wasBuiltin) kit = cloneKitAsUser(kit, kit.name + " (custom)");
    const lanes = kit.lanes.map((l) => {
      if (l.id !== laneId) return { ...l };
      return {
        ...l,
        ...partial,
        filter: partial.filter
          ? { ...(l.filter ?? DEFAULT_DRUM_FILT), ...partial.filter }
          : l.filter,
        filtEnv: partial.filtEnv
          ? { ...(l.filtEnv ?? DEFAULT_DRUM_FILT_ENV), ...partial.filtEnv }
          : l.filtEnv,
        ampEnv: partial.ampEnv
          ? { ...(l.ampEnv ?? DEFAULT_DRUM_AMP), ...partial.ampEnv }
          : l.ampEnv,
        tone: partial.tone
          ? resolveDrumTone(l.synth, { ...l.tone, ...partial.tone })
          : l.tone,
      };
    });
    const next: DrumKit = { ...kit, lanes, user: true };
    upsertUserKit(next);
    this.kit = next;
    if (wasBuiltin) {
      for (const t of this.arrangement.tracks)
        for (const cl of t.clips) {
          if (cl.content.kind !== "drum") continue;
          const id = cl.content.pattern.kitId || prevId;
          if (id !== prevId) continue;
          cl.content = {
            ...cl.content,
            pattern: { ...cl.content.pattern, kitId: next.id },
          };
        }
      this.saveArr();
    }
    this.emit("transport");
    this.emit("arrange");
    return next.id;
  }

  /** Fire one hit of a kit lane (synth or sample) into the master bus — UI audition. */
  auditionDrumLane(kitId: string, laneId: string, vel = 1) {
    const kit = findKit(kitId);
    const lane = kit.lanes.find((l) => l.id === laneId);
    if (!lane) return;
    const c = this.ensureCtx();
    void c.resume();
    const n = this.nodes;
    if (!n) return;
    this.voiceDrum(lane, c.currentTime + 0.02, vel, n.sum, kit.id);
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
      try {
        g.disconnect();
      } catch {
        /* fine */
      }
    };
  }

  // ── synthesized drum voices (Web Audio, when no sample is bounced) ──
  // Params come from lane.tone (or recipe defaults). Head / body / tail
  // partials each can carry a filter + bipolar Hz envelope.
  private synthDrum(lane: DrumLane, t: number, vel: number, dest?: AudioNode) {
    const c = this.ctx!;
    const n = this.nodes!;
    const tone = resolveDrumTone(lane.synth, lane.tone);
    const out = c.createGain();
    out.gain.value = 1;
    out.connect(dest ?? n.sum);
    const env = (g: GainNode, peak: number, dec: number, at = t) => {
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(peak, at + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0001, at + Math.max(0.01, dec));
    };
    let pending = 0;
    const track = (node: AudioScheduledSourceNode, at: number) => {
      pending++;
      try {
        node.stop(at);
      } catch {
        /* fine */
      }
      node.onended = () => {
        pending--;
        if (pending > 0) return;
        try {
          out.disconnect();
        } catch {
          /* fine */
        }
      };
    };
    /** Insert optional partial filter; returns filt-env end time (or `when`). */
    const throughFilt = (
      src: AudioNode,
      destNode: AudioNode,
      pf: DrumPartialFilt,
      when: number,
      releaseAt: number,
    ): number => {
      if (!partialFiltActive(pf)) {
        src.connect(destNode);
        return when;
      }
      const f = c.createBiquadFilter();
      f.type = pf.mode === "off" ? "lowpass" : pf.mode;
      f.Q.value = Math.max(0.1, pf.q);
      const cut = Math.max(20, pf.cut);
      let end = when;
      if (Math.abs(pf.env.amt) > 1) {
        end = scheduleFiltEnvOneShot(f.frequency, when, cut, pf.env, releaseAt);
      } else {
        f.frequency.value = cut;
      }
      src.connect(f);
      f.connect(destNode);
      return end;
    };

    // ── BODY — pitched oscillator ──
    if (tone.bodyLevel > 0.001) {
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = tone.bodyWave;
      const startHz = Math.max(20, tone.startHz);
      const endHz = Math.max(20, tone.endHz);
      o.frequency.setValueAtTime(startHz, t);
      if (tone.sweep > 0.001 && Math.abs(startHz - endHz) > 0.5) {
        o.frequency.exponentialRampToValueAtTime(endHz, t + tone.sweep);
      }
      env(g, tone.bodyLevel * vel, tone.bodyDecay);
      const ampEnd = t + tone.bodyDecay;
      const filtEnd = throughFilt(o, g, tone.bodyFilt, t, ampEnd);
      g.connect(out);
      o.start(t);
      track(o, Math.max(ampEnd, filtEnd) + 0.05);
    }

    // ── HEAD — noise / click (optional multi-burst) ──
    if (tone.noiseLevel > 0.001) {
      const bursts = Math.max(1, Math.min(6, Math.round(tone.bursts)));
      const gap = Math.max(0, tone.burstGap);
      const useBp = tone.noiseBp > 0;
      const cutBase = useBp
        ? Math.max(20, tone.noiseBp)
        : Math.max(20, tone.noiseHp);
      const nfe = tone.noiseFiltEnv;
      const sharedNoise = this.noiseBuf("white");
      for (let i = 0; i < bursts; i++) {
        const off = i * gap;
        const ns = c.createBufferSource();
        const isLast = i === bursts - 1;
        const peak =
          tone.noiseLevel * vel * (bursts > 1 && !isLast ? 0.7 : 1);
        const dec =
          bursts > 1 && !isLast
            ? Math.max(0.03, tone.noiseDecay * 0.28)
            : tone.noiseDecay;
        const ampEnd = t + off + Math.max(0.01, dec);
        const filt = c.createBiquadFilter();
        if (useBp) {
          filt.type = "bandpass";
          filt.Q.value = Math.max(0.1, tone.noiseQ);
        } else {
          filt.type = "highpass";
          filt.Q.value = 0.7;
        }
        let filtEnd = ampEnd;
        if (Math.abs(nfe.amt) > 1) {
          filtEnd = scheduleFiltEnvOneShot(
            filt.frequency,
            t + off,
            cutBase,
            nfe,
            ampEnd,
          );
        } else {
          filt.frequency.value = cutBase;
        }
        // Shared noise buffer — fixed offset when humanize off (repeatable hits).
        ns.buffer = sharedNoise;
        const playDur = Math.max(0.04, filtEnd - (t + off) + 0.02);
        const startOff = this.audioPrefs.voiceHumanize
          ? Math.random() * Math.max(0.01, sharedNoise.duration - playDur)
          : Math.min(sharedNoise.duration * 0.25, i * 0.011);
        const g = c.createGain();
        g.gain.setValueAtTime(0, t + off);
        g.gain.linearRampToValueAtTime(peak, t + off + 0.001);
        g.gain.exponentialRampToValueAtTime(0.0001, ampEnd);
        ns.connect(filt);
        filt.connect(g);
        g.connect(out);
        ns.start(t + off, startOff, playDur);
        track(ns, Math.max(ampEnd, filtEnd) + 0.05);
      }
    }

    // ── TAIL — length / air / soft bloom ──
    if (tone.tailLevel > 0.001) {
      const g = c.createGain();
      env(g, tone.tailLevel * vel, tone.tailDecay);
      g.connect(out);
      const ampEnd = t + tone.tailDecay;
      if (tone.tailSource === "sine") {
        const o = c.createOscillator();
        o.type = "sine";
        o.frequency.value = Math.max(20, tone.tailHz);
        const filtEnd = throughFilt(o, g, tone.tailFilt, t, ampEnd);
        o.start(t);
        track(o, Math.max(ampEnd, filtEnd) + 0.05);
      } else {
        const ns = c.createBufferSource();
        const sharedNoise = this.noiseBuf("white");
        ns.buffer = sharedNoise;
        const pre = c.createBiquadFilter();
        if (tone.tailBp > 0) {
          pre.type = "bandpass";
          pre.frequency.value = Math.max(20, tone.tailBp);
          pre.Q.value = Math.max(0.1, tone.tailQ);
        } else {
          pre.type = "highpass";
          pre.frequency.value = Math.max(20, tone.tailHp);
          pre.Q.value = 0.7;
        }
        ns.connect(pre);
        const filtEnd = throughFilt(pre, g, tone.tailFilt, t, ampEnd);
        const playDur = Math.max(0.04, Math.max(ampEnd, filtEnd) - t + 0.02);
        const startOff = this.audioPrefs.voiceHumanize
          ? Math.random() * Math.max(0.01, sharedNoise.duration - playDur)
          : 0;
        ns.start(t, startOff, playDur);
        track(ns, Math.max(ampEnd, filtEnd) + 0.05);
      }
    }

    if (pending === 0) {
      try {
        out.disconnect();
      } catch {
        /* fine */
      }
    }
  }


  // Does this audio clip overflow its content (so it auto-loops to fill)? Asks the
  // SAME resolver the scheduler uses (warp/varispeed/trim all included), gated by
  // the per-clip loop toggle. Used by the editor to show/hide the loop-seam controls.
  audioClipLoops(clip: ArrClip): boolean {
    if (clip.content.kind !== "audio") return false;
    const cc = clip.content;
    if (cc.loop === false || !cc.bufId) return false;
    const bd = 60 / this.arrangement.bpm;
    const s = this.audioClipSource(clip, bd, this.arrangement.bpm);
    if (!s) return false;
    const contentSec = s.rate > 0 ? s.trimmedSec / s.rate : s.trimmedSec;
    const clipLenSec = clip.lengthBeats * bd;
    return clipLenSec > contentSec + 0.01;
  }

  // ── imported audio clips (session-only file import) ──
  // Decode a user-picked File into a session buffer; returns its bufId + the filename-
  // detected meta (bpm/key/bars, same parser LoopLanes use), so a dropped clip auto-fills.
  async importAudio(
    file: File,
  ): Promise<{
    bufId: string;
    name: string;
    seconds: number;
    bpm?: number;
    bars?: number;
    key?: string;
  } | null> {
    const c = this.ensureCtx();
    try {
      const ab = await file.arrayBuffer();
      // decodeAudioData DETACHES the buffer → keep a copy to persist before decoding
      const raw = ab.slice(0);
      const buf = await c.decodeAudioData(ab);
      const bufId = "imp" + ++this._importSeq + Date.now().toString(36);
      this._importBufs[bufId] = buf;
      void putAudio(
        bufId,
        raw,
        file.name,
        file.type || "application/octet-stream",
      ); // persist original bytes for reload (best-effort)
      this.emit("arrange");
      const stem = file.name.replace(/\.[^.]+$/, ""); // drop the extension
      const meta = parseLoopMeta(stem);
      return {
        bufId,
        name: meta.name || file.name,
        seconds: buf.duration,
        bpm: meta.bpm,
        bars: meta.bars,
        key: meta.key,
      };
    } catch {
      return null; // undecodable file
    }
  }

  /**
   * Import a Standard MIDI File → midi clip on a midi track (or new track).
   * Applies file tempo/time-sig when present. Returns clip placement info.
   */
  async importMidiFile(
    file: File,
    atBeat = 0,
    trackId?: string,
  ): Promise<{ trackId: string; clipId: string } | null> {
    let buf: ArrayBuffer;
    try {
      buf = await file.arrayBuffer();
    } catch {
      return null;
    }
    const parsed = parseMidi(buf);
    if (!parsed) return null;

    this.pushUndo();
    if (parsed.hasTempo) this.setArrangementBpm(parsed.bpm);
    if (parsed.clip.beatsPerBar > 0)
      this.setBeatsPerBar(parsed.clip.beatsPerBar);

    let tid = trackId;
    let t = tid ? this.findTrack(tid) : undefined;
    if (!t || t.kind !== "midi") {
      t = this.addTrack("midi", file.name.replace(/\.[^.]+$/, "") || "MIDI");
      tid = t.id;
    }
    const lengthBeats = parsed.clip.bars * parsed.clip.beatsPerBar;
    const created = this.addClip(tid!, {
      startBeat: atBeat,
      lengthBeats,
      loop: false,
      name: file.name.replace(/\.[^.]+$/, "") || "MIDI",
      content: { kind: "midi", clip: parsed.clip },
    });
    if (!created) return null;
    this.selectClip(created.id);
    this.emit("arrange");
    return { trackId: tid!, clipId: created.id };
  }

  /** Drop a one-shot onto a kit lane (user kit or clone of builtin → user). */
  async setKitLaneSample(
    kitId: string,
    laneId: string,
    file: File,
  ): Promise<boolean> {
    const res = await this.importAudio(file);
    if (!res) return false;
    let kit = findKit(kitId);
    const wasBuiltin = !kit.user;
    const prevId = kit.id;
    // builtins are read-only — clone into a user kit on first sample drop
    if (wasBuiltin) kit = cloneKitAsUser(kit, kit.name + " (custom)");
    const lanes = kit.lanes.map((l) =>
      l.id === laneId
        ? {
            ...l,
            bufId: res.bufId,
            url: undefined,
            a: 0,
            b: 1,
            gain: 1,
            ampEnv: l.ampEnv ?? DEFAULT_DRUM_AMP,
            filter: l.filter ?? DEFAULT_DRUM_FILT,
            filtEnv: l.filtEnv ?? DEFAULT_DRUM_FILT_ENV,
          }
        : { ...l },
    );
    const next: DrumKit = { ...kit, lanes, user: true };
    upsertUserKit(next);
    this.kit = next;
    if (this._importBufs[res.bufId])
      this._drumBufs[next.id + ":" + laneId] = this._importBufs[res.bufId]!;
    void this.loadKit(next);
    // remount drum clips that pointed at the old builtin kit id
    if (wasBuiltin) {
      for (const t of this.arrangement.tracks) {
        for (const cl of t.clips) {
          if (cl.content.kind !== "drum") continue;
          const id = cl.content.pattern.kitId || prevId;
          if (id !== prevId) continue;
          cl.content = {
            ...cl.content,
            pattern: { ...cl.content.pattern, kitId: next.id },
          };
        }
      }
      this.saveArr();
    }
    this.emit("transport");
    this.emit("arrange");
    return true;
  }

  /** Persist the current engine kit under a name (always as a user kit). */
  saveCurrentKitAs(name: string): DrumKit {
    const base = this.kit.user
      ? this.kit
      : cloneKitAsUser(this.kit, name.trim() || "my kit");
    const next: DrumKit = {
      ...base,
      name: name.trim() || base.name,
      user: true,
    };
    upsertUserKit(next);
    this.kit = next;
    this.emit("transport");
    this.emit("arrange");
    return next;
  }
  // New project: wipe the arrangement + all imported audio (localStorage + IndexedDB, in
  // sync so no clip is left with a dangling bufId) and reset to a blank studio. Stops
  // playback and clears selection/undo/clipboard.
  async newProject(): Promise<void> {
    await this.wipeStudioSession();
    this.arrangement = emptyArrangement();
    saveArrangement(this.arrangement);
    this.bpm = this.arrangement.bpm;
    this.emit("arrange");
    this.emit("select");
    this.emit("transport");
  }

  /** Stop playback, clear imports/caches/strips/undo — shared by new + .ain open. */
  private async wipeStudioSession(): Promise<void> {
    if (this.sequencePlaying) this.stopArrangement();
    this.stopAudioClips();
    this._importBufs = {};
    this._drumBufs = {};
    this._reverseBufs = {};
    this._importPeaks = {};
    this._waveCache = {};
    this._warpCache.clear();
    for (const id in this._stretch) this.disposeStretch(id);
    for (const id of Object.keys(this._arrStrips)) {
      const s = this._arrStrips[id];
      if (!s) continue;
      try {
        s.fx.dispose();
        s.in.disconnect();
        s.adc.disconnect();
        s.gain.disconnect();
        s.pan.disconnect();
        s.an.disconnect();
      } catch {
        /* fine */
      }
      delete this._arrStrips[id];
    }
    this.insertBeat = 0;
    this.clearSelection();
    this._lastMixBounce = null;
    this._undo = [];
    this._redo = [];
    this._clipboard = null;
    await clearAudio();
  }

  /**
   * Collect-and-save: PCM16 WAV master bounce + zip (arrangement + imports) +
   * AIN1 trailer → downloadable `.ain`. Working copy stays in LS + IndexedDB.
   * Uses the last mix bounce when present; otherwise records one first.
   */
  async exportAin(
    name = "project",
    opts?: { wavMask?: boolean },
  ): Promise<void> {
    this.saveArr();
    const ids = referencedImportIds(this.arrangement);
    const stored = await allAudio();
    const byId = new Map(stored.map((s) => [s.bufId, s]));
    const assets: { bufId: string; bytes: ArrayBuffer; name?: string }[] = [];
    for (const bufId of ids) {
      const hit = byId.get(bufId);
      if (hit) {
        assets.push({ bufId, bytes: hit.bytes, name: hit.name });
        continue;
      }
      const buf = this._importBufs[bufId];
      if (!buf) continue;
      const { bytes } = await encodePersistable(buf);
      let clipName = "audio";
      for (const t of this.arrangement.tracks)
        for (const cl of t.clips)
          if (cl.content.kind === "audio" && cl.content.bufId === bufId)
            clipName = cl.content.name || cl.name || clipName;
      assets.push({ bufId, bytes, name: clipName });
    }
    const previewWav = await this.ensureAinPreviewWav();
    const blob = packAin({
      name,
      arrangement: this.arrangement,
      assets,
      masterFx: this.masterDevices(),
      previewWav,
    });
    downloadBlob(blob, safeAinFilename(name, opts));
  }

  /** Last realtime mix bounce (MediaRecorder blob), used as .ain preview source. */
  private _lastMixBounce: { bytes: ArrayBuffer; mime: string } | null = null;

  hasMixBounce(): boolean {
    return !!this._lastMixBounce;
  }

  /**
   * Realtime mix bounce: record the master bus while playing the arrangement
   * (full FX / MIDI / drums — whatever you hear). Returns the recorded blob and
   * caches it for `.ain` preview embedding.
   *
   * `range: "loop"` plays one pass of the loop brace (no wrap). `range: "full"`
   * (default when the brace is off) plays from 0 through the arrangement end.
   */
  bouncing = false;
  async recordMixBounce(
    opts: { range?: "loop" | "full" } = {},
  ): Promise<Blob> {
    if (this.bouncing) throw new Error("Bounce already in progress");
    const c = this.ensureCtx();
    const n = this.nodes;
    if (!n) throw new Error("Audio engine not ready");
    if (typeof MediaRecorder === "undefined")
      throw new Error("This browser can’t record a mixdown (no MediaRecorder)");

    const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
      ? "audio/webm;codecs=opus"
      : MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : MediaRecorder.isTypeSupported("audio/mp4")
          ? "audio/mp4"
          : "";
    if (!mime) throw new Error("No supported MediaRecorder audio type");

    const loop = this.arrangement.loop;
    const useLoop =
      opts.range === "loop" &&
      !!loop &&
      loop.end > loop.start + 1e-6;
    if (opts.range === "loop" && !useLoop)
      throw new Error("Turn on the loop brace (or set a range) before bouncing the loop");

    const startBeat = useLoop ? loop!.start : 0;
    const endBeat = useLoop
      ? loop!.end
      : Math.max(
          arrangementBeats(this.arrangement),
          this.arrangement.beatsPerBar,
        );
    // +1.5s tail for master FX / reverb
    const durationMs =
      (((endBeat - startBeat) * 60) / this.arrangement.bpm + 1.5) * 1000;

    if (this.sequencePlaying) this.stopArrangement();
    this.bouncing = true;
    this.emit("transport");

    const dest = c.createMediaStreamDestination();
    n.master.connect(dest);

    const chunks: BlobPart[] = [];
    const rec = new MediaRecorder(dest.stream, { mimeType: mime });
    rec.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    const finished = new Promise<Blob>((resolve, reject) => {
      rec.onstop = () => resolve(new Blob(chunks, { type: mime }));
      rec.onerror = () => reject(new Error("Mix recording failed"));
    });

    // Don't bake count-in / metronome / loop-wrap into the download.
    const savedCountIn = this.countInBars;
    const savedMetro = this.metronome;
    this.countInBars = 0;
    this.metronome = false;

    try {
      rec.start(100);
      this.arrangeMode = true;
      this.bpm = this.arrangement.bpm;
      this.loopOn = false; // one pass — no brace wrap mid-bounce
      this.warmArrangement();
      this.playSequence(startBeat);
      await new Promise<void>((r) => setTimeout(r, durationMs));
      if (this.sequencePlaying) this.stopArrangement();
      await new Promise<void>((r) => setTimeout(r, 250)); // flush into recorder
      if (rec.state === "recording") rec.stop();
      const blob = await finished;
      this._lastMixBounce = {
        bytes: await blob.arrayBuffer(),
        mime: blob.type || mime,
      };
      return blob;
    } finally {
      this.countInBars = savedCountIn;
      this.metronome = savedMetro;
      try {
        n.master.disconnect(dest);
      } catch {
        /* fine */
      }
      this.bouncing = false;
      this.emit("transport");
    }
  }

  /** Decode last bounce (or record one) → PCM16 WAV for the .ain playable head. */
  private async ensureAinPreviewWav(): Promise<ArrayBuffer> {
    if (!this._lastMixBounce) await this.recordMixBounce();
    const bounce = this._lastMixBounce;
    if (!bounce) throw new Error("Couldn't capture mix bounce for .ain preview");
    const c = this.ensureCtx();
    let buf: AudioBuffer;
    try {
      buf = await c.decodeAudioData(bounce.bytes.slice(0));
    } catch {
      throw new Error(
        "Couldn't decode mix bounce for .ain preview (try Bounce Mix… first)",
      );
    }
    return encodeWavPcm16(buf);
  }

  /**
   * Realtime mix bounce → download. Default format is PCM WAV (opens in every
   * DAW). `webm` keeps the raw MediaRecorder Opus/WebM (or m4a on Safari).
   * Also refreshes the cached bounce used when saving `.ain`.
   */
  async bounceMix(
    name = "mix",
    opts: { range?: "loop" | "full"; format?: "wav" | "webm" } = {},
  ): Promise<void> {
    const format = opts.format ?? "wav";
    const blob = await this.recordMixBounce({ range: opts.range ?? "full" });
    const base = name
      .trim()
      .replace(/[^\w-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 64) || "mix";

    if (format === "wav") {
      const c = this.ensureCtx();
      // Prefer the cached copy — decodeAudioData detaches its input buffer.
      const src = this._lastMixBounce?.bytes.slice(0) ?? (await blob.arrayBuffer());
      let buf: AudioBuffer;
      try {
        buf = await c.decodeAudioData(src);
      } catch {
        throw new Error("Couldn't decode mix bounce to WAV");
      }
      const wav = encodeWavPcm16(buf);
      downloadBlob(new Blob([wav], { type: "audio/wav" }), `${base}.wav`);
      return;
    }

    const mime = blob.type;
    const ext = mime.includes("mp4") ? "m4a" : "webm";
    downloadBlob(blob, `${base}.${ext}`);
  }

  /**
   * Open a `.ain` pack: replaces the current studio (same as new project, then load).
   * Returns the project name from the manifest.
   */
  async importAin(file: File | Blob): Promise<string> {
    const pack = unpackAin(await file.arrayBuffer());
    await this.wipeStudioSession();

    for (const a of pack.assets) {
      const mime = sniffMime(a.bytes, a.name ?? "");
      await putAudio(a.bufId, a.bytes, a.name || a.bufId, mime);
    }

    const c = this.ensureCtx();
    for (const a of pack.assets) {
      try {
        this._importBufs[a.bufId] = await c.decodeAudioData(a.bytes.slice(0));
      } catch {
        /* undecodable asset — clip stays silent until re-import */
      }
    }

    // Cache container preview as the last mix bounce when present
    if (pack.preview && pack.preview.byteLength > 44) {
      this._lastMixBounce = { bytes: pack.preview, mime: "audio/wav" };
    }

    const arr = pack.arrangement;
    if (!arr || !Array.isArray(arr.tracks))
      throw new Error("Invalid arrangement in .ain");
    for (const t of arr.tracks) {
      if (t.devices)
        t.devices = migrateFxDeviceStates(t.devices) as typeof t.devices;
    }
    this.arrangement = arr;
    saveArrangement(this.arrangement);
    this.bpm = this.arrangement.bpm;

    if (pack.masterFx) {
      this._masterDevices = migrateFxDeviceStates(
        pack.masterFx,
      ) as FxDeviceState[];
      if (this._masterFx) {
        this._masterFx.setDevices(
          this._masterDevices.map((d) => structuredClone(d)),
        );
        this._masterFx.applyAll(this.bpm);
      }
      this.saveMasterFx();
    }

    for (const t of this.arrangement.tracks)
      for (const cl of t.clips)
        if (cl.content.kind === "audio" && warpModeOf(cl.content) === "complex")
          this.ensureStretchNode(cl);

    this.emit("arrange");
    this.emit("select");
    this.emit("transport");
    this.emit("fx");
    return pack.manifest.name || "project";
  }

  // Re-hydrate persisted imports on boot: decode each stored file into _importBufs, then
  // prune any that no clip references. Called once from the arrangement page on mount.
  async loadPersistedAudio(): Promise<void> {
    void this.probePersistCodec();
    const c = this.ensureCtx();
    const stored = await allAudio();
    for (const { bufId, bytes } of stored) {
      if (this._importBufs[bufId]) continue;
      try {
        this._importBufs[bufId] = await c.decodeAudioData(bytes.slice(0));
      } catch {
        /* corrupt entry — skip */
      }
    }
    // prune imports no arrangement clip or kit lane points at
    void pruneAudio(referencedImportIds(this.arrangement));
    // warm the live stretch nodes for restored COMPLEX clips (first play = no fallback)
    for (const t of this.arrangement.tracks)
      for (const cl of t.clips)
        if (cl.content.kind === "audio" && warpModeOf(cl.content) === "complex")
          this.ensureStretchNode(cl);
    this.emit("arrange");
  }
  // reverse an imported buffer (cached), for reverse playback. Returns a NEW buffer.
  private _reverseBufs: Record<string, AudioBuffer> = {};
  private reversedBuffer(bufId: string, src: AudioBuffer): AudioBuffer {
    const hit = this._reverseBufs[bufId];
    if (hit) return hit;
    const c = this.ensureCtx();
    const out = c.createBuffer(
      src.numberOfChannels,
      src.length,
      src.sampleRate,
    );
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
    return this.peaksFromBuf(buf, "imp:" + bufId, bins);
  }

  /** Peaks for a kit lane one-shot (session import or decoded kit url). */
  drumLanePeaks(
    laneId: string,
    bins: number,
    kitId?: string,
  ): Float32Array | null {
    const kit = kitId ? findKit(kitId) : this.kit;
    const lane = kit.lanes.find((l) => l.id === laneId);
    if (!lane) return null;
    const buf = this.resolveDrumLaneBuf(lane, kit.id);
    if (!buf) return null;
    const key = lane.bufId
      ? "imp:" + lane.bufId
      : "drum:" + kit.id + ":" + laneId;
    return this.peaksFromBuf(buf, key, bins);
  }

  drumLaneSeconds(laneId: string, kitId?: string): number {
    const kit = kitId ? findKit(kitId) : this.kit;
    const lane = kit.lanes.find((l) => l.id === laneId);
    if (!lane) return 0;
    return this.resolveDrumLaneBuf(lane, kit.id)?.duration ?? 0;
  }

  private peaksFromBuf(
    buf: AudioBuffer,
    cacheKey: string,
    bins: number,
  ): Float32Array {
    const key = cacheKey + ":" + bins;
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
  presetPeaks(
    presetId: string,
    zoneIdx: number,
    bins: number,
    from = 0,
    to = 1,
  ): Float32Array | null {
    const buf = this._sampleBufs[presetId]?.[zoneIdx];
    if (!buf) return null;
    const key =
      presetId +
      ":" +
      zoneIdx +
      ":" +
      bins +
      ":" +
      from.toFixed(4) +
      ":" +
      to.toFixed(4);
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
    // a tempo-synced delay must track the new tempo — master + every per-track chain
    if (this.ctx) {
      this._masterFx?.applyAll(bpm);
      for (const id in this._arrStrips) this._arrStrips[id].fx.applyAll(bpm);
    }
    if (this.ctx) {
      const tt = this.ctx.currentTime;
      // synced audio clips re-rate live: playbackRate ∝ bpm, recomputed from the base
      // (drift-free across rapid drags). This is the real-time pitch rise/fall while
      // dragging the tempo — the tape-warble effect.
      if (bpm !== prevBpm) {
        // LIVE warp nodes just take the new rate — pitch stays locked through the
        // drag, and input position stays beat-continuous (a warp clip consumes
        // 60/rootBpm input-seconds per beat at ANY tempo, and the clock re-anchored).
        // The rate schedule POPS all queued changes at/after now (worklet semantics),
        // so: re-add the CURRENT pass's end stop at its new wall time, and drop the
        // dedupe keys of popped FUTURE passes so schedTick re-fires them.
        if (this.sequencePlaying && this.arrangeMode) {
          const curBeat = this.currentBeat();
          for (const clipId in this._stretch) {
            const e = this._stretch[clipId];
            if (!e.ready || !e.node) continue;
            const wc = this.arrangement.tracks
              .flatMap((t2) => t2.clips)
              .find((x) => x.id === clipId);
            if (!wc || wc.content.kind !== "audio") continue;
            // this schedule pops ANY queued change on the node (one-slot queue) —
            // the bookkeeping below re-establishes what got popped
            e.node.schedule({
              output: tt,
              rate: this.warpParams(wc.content).ratio, // bpm/rootBpm ÷ ⌥-stretch
            });
            for (const key in this._stretchFired) {
              if (!key.startsWith(clipId + "@")) continue;
              const sb = parseFloat(key.slice(clipId.length + 1));
              const f = this._stretchFired[key];
              if (curBeat >= sb && curBeat < sb + wc.lengthBeats) {
                // playing pass: its end moved with the tempo — recompute + re-send later
                f.off = tt + (sb + wc.lengthBeats - curBeat) * (60 / bpm);
                f.when = Math.min(f.when, tt); // start already effective
                f.stopSent = false; // the sweep re-sends it at the new wall time
              } else if (sb > curBeat) {
                delete this._stretchFired[key]; // its queued start was popped — re-fire
              }
            }
          }
        }
        for (const key in this._startedAudio) {
          const a = this._startedAudio[key];
          if (a.synced && a.baseBpm > 0)
            a.src.playbackRate.setTargetAtTime(
              a.baseRate * (bpm / a.baseBpm),
              tt,
              0.02,
            );
          else if (!a.synced) {
            // UNSYNCED clips are beat-anchored (content position ≡ clip-beats × sec/beat):
            // a tempo change moves every beat's wall time, so the live node no longer sits
            // where the timeline (and its drawn waveform) says. Stop it + drop the dedupe
            // key — the scheduler re-fires it this tick at the correct catch-up offset.
            try {
              a.src.stop();
            } catch {
              /* already stopped */
            }
            delete this._startedAudio[key];
          }
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

  // total beats of whatever's currently playing: the arrangement span, or the Audio
  // Lab audition clip's length.
  private activeTotalBeats(): number {
    if (this.arrangeMode) return arrangementBeats(this.arrangement);
    return this._clip ? clipBeats(this._clip) : 0;
  }

  // current beat position from the ctx clock. In arrange mode the playhead wraps at
  // the loop BRACE (not [0,total)); otherwise it wraps the active loop cycle.
  private currentBeat(): number {
    if (!this.ctx) return 0;
    const elapsed = this.ctx.currentTime - this._seqAnchorTime;
    let beat = this._seqAnchorBeat + elapsed / this.beatDur();
    if (this.arrangeMode) {
      const br =
        this.loopOn && this.arrangement.loop?.on ? this.arrangement.loop : null;
      if (br) {
        const len = br.end - br.start;
        beat = br.start + ((((beat - br.start) % len) + len) % len);
      }
      return Math.max(0, beat);
    }
    const total = this.activeTotalBeats();
    if (this.loopOn && total > 0) beat = ((beat % total) + total) % total;
    return beat;
  }

  // for the visual playhead (pure read — lint-safe in rAF).
  getSequencePosition(): {
    beat: number;
    bars: number;
    playing: boolean;
  } {
    const total = this.activeTotalBeats();
    const beat = this.sequencePlaying ? this.currentBeat() : 0;
    return {
      beat,
      bars: this.arrangeMode
        ? Math.max(1, total / this.arrangement.beatsPerBar)
        : this._clip
          ? this._clip.bars
          : 0,
      playing: this.sequencePlaying,
    };
  }

  // the arrangement CURSOR beat: the live playhead while playing, else the stopped
  // cursor (= insertBeat, the merged marker/playhead). Drives the timeline's one line.
  arrangementPosition(): number {
    if (this.arrangeMode && this.sequencePlaying) return this.currentBeat();
    return this.insertBeat;
  }

  playSequence(fromBeat = 0) {
    if (!this.arrangeMode && !this._clip) return;
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
      for (let i = 0; i < beats; i++)
        this.metroClick(start + i * bd, i % bpb === 0);
      start += beats * bd;
    }
    this._seqAnchorTime = start;
    // arrange: start at the beat the caller passed (the cursor / insertBeat). beat
    // mode (lab audition) always starts at 0.
    this._seqAnchorBeat = this.arrangeMode ? Math.max(0, fromBeat) : 0;
    this._scheduledThrough = start;
    this._metroThrough = this._seqAnchorBeat - 1; // so the first in-song beat clicks
    if (this._schedTimer) clearInterval(this._schedTimer);
    this._schedTimer = window.setInterval(
      () => this.schedTick(),
      AudioEngine.SCHED_INTERVAL,
    );
    this.schedTick();
    this.emit("transport");
    this.emit("state");
  }

  stopSequence() {
    // capture the stop beat BEFORE clearing the playing flag (finishRecording needs it)
    const endBeat =
      this.arrangeMode && this.sequencePlaying && this.ctx
        ? this.currentBeat()
        : this.insertBeat;
    if (this._schedTimer) {
      clearInterval(this._schedTimer);
      this._schedTimer = 0;
    }
    this.sequencePlaying = false;
    this.transportMode = "track";
    this._pendingLaunch = null; // a queued launch is moot once stopped
    // release any voices still ringing from scheduled notes
    const now = this.ctx ? this.ctx.currentTime : 0;
    this._seqVoices.forEach((h) => this.releaseVoice(h, now, true));
    this._seqVoices = [];
    this.stopAudioClips();
    if (this.recording) this.finishRecording(endBeat); // transport stop ends the take
    this.emit("transport");
    this.emit("state");
  }
  // stop + forget any playing audio-clip sources (on stop/seek, so replay re-fires them)
  private stopAudioClips() {
    for (const key in this._startedAudio) {
      try {
        this._startedAudio[key].src.stop();
      } catch {
        /* already ended */
      }
    }
    this._startedAudio = {};
    // silence every live warp node + forget its passes (they re-fire on next play)
    for (const clipId in this._stretch) {
      const e = this._stretch[clipId];
      if (e.ready && e.node && this.ctx)
        e.node.schedule({ output: this.ctx.currentTime, active: false }); // no outputTime: silence NOW + wipe the queued passes (intended)
    }
    this._stretchFired = {};
  }
  // Stop + forget any playing audio source(s) for ONE clip, so the scheduler re-fires it
  // fresh at the next tick with its new geometry. Called whenever a clip's position /
  // length changes, it's removed, or an overlap trims it — otherwise the old long-held
  // AudioBufferSourceNode keeps playing at the stale position/routing (ghost audio).
  private stopAudioForClip(clipId: string) {
    for (const key in this._startedAudio) {
      if (!key.startsWith(clipId + "@")) continue;
      try {
        this._startedAudio[key].src.stop();
      } catch {
        /* already ended */
      }
      delete this._startedAudio[key];
    }
    // the live warp node (if any) goes silent + forgets its passes — it re-fires
    // next tick with fresh geometry
    const e = this._stretch[clipId];
    if (e?.ready && e.node && this.ctx)
      e.node.schedule({ output: this.ctx.currentTime, active: false }); // no outputTime: silence NOW + wipe the queued passes (intended)
    for (const key in this._stretchFired)
      if (key.startsWith(clipId + "@")) delete this._stretchFired[key];
  }

  // piano-roll transport — the Audio Lab's clip audition (RollLab). Plays the active
  // `_clip` through the shared lookahead scheduler (not the arrangement).
  toggleSequence() {
    if (this.sequencePlaying) {
      this.stopSequence();
    } else {
      this.playSequence();
    }
  }

  // ── arrangement transport ──
  // Start the linear timeline scheduler. `fromBeat` seeds the playhead (0 = song
  // start). Mirrors playBeat but sets arrangeMode; the loop brace drives looping.
  // decode the sampled presets every midi track uses, so restored/selected tracks
  // don't fall back to the synth (a preset with no decoded zones voices as glass pad).
  warmArrangement() {
    const warmedKits = new Set<string>();
    for (const t of this.arrangement.tracks) {
      if (t.kind === "midi" && t.presetId)
        this.warmPatch(this.resolvePatch(t.presetId));
      // decode each drum clip's kit one-shots so timeline drums play their samples
      for (const clip of t.clips) {
        if (clip.content.kind !== "drum") continue;
        const kitId = clip.content.pattern.kitId || this.kit.id;
        if (warmedKits.has(kitId)) continue;
        warmedKits.add(kitId);
        const kit = findKit(kitId);
        if (kit) void this.loadKit(kit);
      }
    }
  }
  playArrangement(fromBeat = 0) {
    this.arrangeMode = true;
    this.bpm = this.arrangement.bpm;
    this.loopOn = !!this.arrangement.loop?.on;
    this.warmArrangement(); // decode track instruments before scheduling
    this.playSequence(fromBeat);
  }
  stopArrangement() {
    this.stopSequence();
    this.arrangeMode = false;
  }
  // ── ONE cursor: the insert marker IS the stopped playhead (Ableton) ──
  // Play starts from `insertBeat`; pause/stop write the position back to it. While
  // playing, the live playhead is `currentBeat()`; when stopped, it's `insertBeat`.
  // bare Space: if playing → stop; if stopped → play FROM the cursor.
  toggleArrangement() {
    if (this.sequencePlaying && this.arrangeMode) this.stopArrangement();
    else this.playArrangement(this.insertBeat);
  }
  // ── transport verbs (playback pane) ──
  // play from the cursor (same as bare Space now that marker + playhead are merged)
  playArrangementFromCursor() {
    if (this.sequencePlaying && this.arrangeMode) return;
    this.playArrangement(this.insertBeat);
  }
  // pause: stop the clock and leave the cursor where playback stopped (resume from here)
  pauseArrangement() {
    if (!(this.sequencePlaying && this.arrangeMode)) return;
    const at = this.currentBeat();
    this.stopArrangement();
    this.setInsertBeat(Math.max(0, at));
    this.emit("transport");
  }
  // stop: halt and return the cursor to the start (loop-brace start if looping, else 0)
  stopArrangementToStart() {
    const home =
      this.loopOn && this.arrangement.loop?.on
        ? this.arrangement.loop.start
        : 0;
    if (this.sequencePlaying && this.arrangeMode) this.stopArrangement();
    this.setInsertBeat(home);
    this.emit("transport");
  }
  // return-to-start without stopping playback (⏮): seek to home
  returnToStart() {
    const home =
      this.loopOn && this.arrangement.loop?.on
        ? this.arrangement.loop.start
        : 0;
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
  // the piano roll's OWN grid — deliberately separate from the timeline's snap
  // (editing notes at 1/32 shouldn't coarsen/refine clip placement, and vice versa)
  rollSnapBeats = 0.25; // 1/16
  setRollSnapBeats(beats: number) {
    this.rollSnapBeats = Math.min(1, Math.max(0.0625, beats));
    this.emit("transport");
  }
  // the insert marker: shared cursor for paste / create / split. Emits `arrange` so the
  // timeline redraws it.
  setInsertBeat(beat: number) {
    this.insertBeat = Math.max(0, beat);
    this.emit("arrange");
  }
  // step the cursor one grid unit in the arrow direction (dir = ±1), snapping to the
  // grid. `fine` (⌘) forces a 1/16 step regardless of the snap setting. When STOPPED
  // it moves the marker; when PLAYING it seeks the transport (←/→ scrubs live too).
  moveCursor(dir: -1 | 1, fine = false) {
    const from = this.arrangeMode && this.sequencePlaying ? this.currentBeat() : this.insertBeat;
    const g = fine ? 0.25 : this.snapBeats > 0 ? this.snapBeats : 1;
    // from an off-grid position, one step lands on the near grid line in `dir`;
    // from an on-grid position, it advances a full grid unit.
    const onGrid = Math.abs(from / g - Math.round(from / g)) < 1e-6;
    const target = Math.max(0, onGrid ? Math.round(from / g) * g + dir * g : dir > 0 ? Math.ceil(from / g) * g : Math.floor(from / g) * g);
    if (this.arrangeMode && this.sequencePlaying) this.seekArrangement(target);
    else this.setInsertBeat(target);
  }
  // jump the cursor to song start / end (Home / End)
  cursorToStart() {
    this.seekArrangement(0);
  }
  cursorToEnd() {
    this.seekArrangement(arrangementBeats(this.arrangement));
  }
  // snap the cursor to the previous/next CLIP EDGE across all tracks (⌘⇧←/→) — the
  // fast way to land exactly on a boundary. Considers every clip's start and end.
  cursorToClipEdge(dir: -1 | 1) {
    const from = this.arrangeMode && this.sequencePlaying ? this.currentBeat() : this.insertBeat;
    const edges = new Set<number>([0]);
    for (const t of this.arrangement.tracks)
      for (const c of t.clips) {
        edges.add(c.startBeat);
        edges.add(c.startBeat + c.lengthBeats);
      }
    const sorted = [...edges].sort((a, b) => a - b);
    const target = dir > 0 ? sorted.find((e) => e > from + 1e-6) : [...sorted].reverse().find((e) => e < from - 1e-6);
    if (target != null) {
      if (this.arrangeMode && this.sequencePlaying) this.seekArrangement(target);
      else this.setInsertBeat(target);
    }
  }

  // ── arrangement selection (clips + time range) ──
  // The `primary` selected clip is what the ClipEditor shows (first of the set, or the
  // last one added — we track it separately so the editor is stable).
  private _primaryClipId: string | null = null;
  primaryClip(): { trackId: string; clipId: string } | null {
    if (!this._primaryClipId) return null;
    for (const t of this.arrangement.tracks) {
      if (t.clips.some((c) => c.id === this._primaryClipId))
        return { trackId: t.id, clipId: this._primaryClipId };
    }
    return null;
  }
  isClipSelected(id: string) {
    return this.selClips.has(id);
  }
  // replace the selection with a single clip (a bare click); also sets the time range to
  // its span so time-ops target it (Ableton behavior). null clears the selection.
  selectClip(clipId: string | null) {
    this.selClips = new Set(clipId ? [clipId] : []);
    this._primaryClipId = clipId;
    this.timeSel = clipId ? this._clipTimeRange(clipId) : null;
    this._selTrackId = null;
    this.emit("select");
  }
  toggleClipInSel(clipId: string) {
    if (this.selClips.has(clipId)) {
      this.selClips.delete(clipId);
      if (this._primaryClipId === clipId)
        this._primaryClipId = this.selClips.values().next().value ?? null;
    } else {
      this.selClips.add(clipId);
      this._primaryClipId = clipId;
    }
    this.selClips = new Set(this.selClips); // new ref so React re-renders
    this.emit("select");
  }
  // set the whole selection at once (used by the marquee)
  setSelectedClips(ids: string[]) {
    this.selClips = new Set(ids);
    if (ids.length) this._primaryClipId = ids[ids.length - 1];
    else this._primaryClipId = null;
    this.emit("select");
  }
  clearSelection() {
    this.selClips = new Set();
    this._primaryClipId = null;
    this._selTrackId = null;
    this.timeSel = null;
    this.emit("select");
  }
  selectAllClips() {
    const ids: string[] = [];
    for (const t of this.arrangement.tracks)
      for (const c of t.clips) ids.push(c.id);
    this.setSelectedClips(ids);
  }
  // select every clip on one track (clicking its header) + a whole-track time selection
  selectTrack(trackId: string) {
    const t = this.arrangement.tracks.find((x) => x.id === trackId);
    if (!t) return;
    this.setSelectedClips(t.clips.map((c) => c.id));
    const end = Math.max(0, ...t.clips.map((c) => c.startBeat + c.lengthBeats));
    this.timeSel = end > 0 ? { start: 0, end, trackIds: [trackId] } : null;
    this._selTrackId = trackId;
    this.emit("select");
  }
  private _selTrackId: string | null = null;
  get selTrackId() {
    return this._selTrackId;
  }
  // a time range spanning tracks (the marquee / drag-select on empty lane space)
  setTimeSel(start: number, end: number, trackIds: string[]) {
    const s = Math.max(0, Math.min(start, end));
    const e = Math.max(start, end);
    this.timeSel = e > s ? { start: s, end: e, trackIds } : null;
    this.emit("select");
  }
  private _clipTimeRange(
    clipId: string,
  ): { start: number; end: number; trackIds: string[] } | null {
    for (const t of this.arrangement.tracks) {
      const c = t.clips.find((x) => x.id === clipId);
      if (c)
        return {
          start: c.startBeat,
          end: c.startBeat + c.lengthBeats,
          trackIds: [t.id],
        };
    }
    return null;
  }
  // delete every selected clip (multi-select Delete)
  deleteSelectedClips() {
    const ids = [...this.selClips];
    if (!ids.length) return;
    this.pushUndo();
    for (const t of this.arrangement.tracks) {
      for (const c of t.clips)
        if (ids.includes(c.id)) {
          this.stopAudioForClip(c.id);
          this.disposeStretch(c.id);
        }
      t.clips = t.clips.filter((c) => !ids.includes(c.id));
    }
    this.clearSelection();
    this.saveArr();
  }
  // duplicate every selected clip (⌘D); the copies become the new selection
  duplicateSelectedClips() {
    const ids = [...this.selClips];
    if (!ids.length) return;
    this.pushUndo();
    const newIds: string[] = [];
    for (const t of this.arrangement.tracks) {
      for (const c of [...t.clips]) {
        if (!ids.includes(c.id)) continue;
        const copy = this.duplicateClip(t.id, c.id);
        if (copy) newIds.push(copy.id);
      }
    }
    if (newIds.length) this.setSelectedClips(newIds);
  }

  // ── arrow-key ops on the selection (Phase 5) ──
  // helper: the (track, clip) pairs currently selected
  private selectedPairs(): { t: ArrTrack; c: ArrClip }[] {
    const out: { t: ArrTrack; c: ArrClip }[] = [];
    for (const t of this.arrangement.tracks)
      for (const c of t.clips) if (this.selClips.has(c.id)) out.push({ t, c });
    return out;
  }
  // nudge every selected clip by `delta` beats (← / →). Clamped so none goes below 0.
  nudgeSelection(delta: number) {
    const pairs = this.selectedPairs();
    if (!pairs.length) return;
    const minStart = Math.min(...pairs.map((p) => p.c.startBeat));
    const d = Math.max(delta, -minStart); // don't push any clip before beat 0
    if (d === 0) return;
    this.pushUndo();
    for (const { c } of pairs) c.startBeat = Math.max(0, c.startBeat + d);
    for (const { t, c } of pairs) this.resolveOverlaps(t, c);
    for (const { c } of pairs) this.stopAudioForClip(c.id);
    this.saveArr();
    this.emit("select");
  }
  // "0" — deactivate/reactivate the selected clips (Ableton): if any is active, mute
  // all; else unmute all. Muted audio clips stop their live sources immediately;
  // unmuted ones re-fire fresh from the scheduler next tick.
  toggleMuteSelection() {
    const pairs = this.selectedPairs();
    if (!pairs.length) return;
    this.pushUndo();
    const anyActive = pairs.some(({ c }) => !c.muted);
    for (const { c } of pairs) {
      c.muted = anyActive || undefined;
      this.stopAudioForClip(c.id);
    }
    this.saveArr();
    this.emit("select");
  }
  // resize every selected clip by `delta` beats (shift+← / →). Min length 0.25.
  resizeSelection(delta: number) {
    const pairs = this.selectedPairs();
    if (!pairs.length) return;
    this.pushUndo();
    for (const { t, c } of pairs) {
      c.lengthBeats = Math.max(0.25, c.lengthBeats + delta);
      const cap = this.clipContentCap(c);
      if (cap != null) c.lengthBeats = Math.min(c.lengthBeats, cap); // loop OFF: pinned to material
      this.resolveOverlaps(t, c);
      this.stopAudioForClip(c.id);
    }
    this.saveArr();
    this.emit("select");
  }
  // move the selection up/down a track (↑ / ↓): each clip hops to the adjacent track of
  // the SAME kind (audio↔audio etc.), keeping its beat position. Skips if no such track.
  moveSelectionTracks(dir: -1 | 1) {
    const pairs = this.selectedPairs();
    if (!pairs.length) return;
    const tracks = this.arrangement.tracks;
    // resolve each clip's destination track first; abort if any can't move
    const moves: { from: ArrTrack; to: ArrTrack; c: ArrClip }[] = [];
    for (const { t, c } of pairs) {
      const i = tracks.indexOf(t);
      // walk to the next track of the same kind in `dir`
      let j = i + dir;
      while (j >= 0 && j < tracks.length && tracks[j].kind !== t.kind) j += dir;
      if (j < 0 || j >= tracks.length) return; // one can't move → cancel the whole op
      moves.push({ from: t, to: tracks[j], c });
    }
    this.pushUndo();
    for (const m of moves) {
      m.from.clips = m.from.clips.filter((x) => x.id !== m.c.id);
      m.to.clips.push(m.c);
      this.resolveOverlaps(m.to, m.c);
      this.stopAudioForClip(m.c.id);
    }
    this.saveArr();
    this.emit("select");
  }
  // reverse every selected AUDIO clip (R) — toggles its reverse flag
  reverseSelection() {
    const audio = this.selectedPairs().filter(
      (p) => p.c.content.kind === "audio",
    );
    if (!audio.length) return;
    this.pushUndo();
    for (const { t, c } of audio) {
      if (c.content.kind !== "audio") continue;
      this.setClipContent(
        t.id,
        c.id,
        { ...c.content, reverse: !c.content.reverse },
        false,
      ); // reverseSelection pushed its own undo frame
    }
    this.emit("select");
  }

  // ── undo / redo (snapshot-based) ──
  // Call pushUndo() BEFORE a mutation to make it undoable. Discrete ops call it once;
  // drag gestures call it at pointer-down (so the whole drag is one undo step). Any
  // pushUndo clears the redo stack (new branch of history).
  private _snapshot(scope?: string): UndoSnap {
    return {
      a: structuredClone(this.arrangement),
      masterVol: this.masterVol,
      scope,
    };
  }
  // Discrete undo push. Optional `scope` tags the edit ("arrange" default, or
  // "content:<clipId>" for roll/clip commits) so pane-focused undo can prefer it.
  pushUndo(scope = "arrange") {
    this._coalesceKey = null; // a discrete op breaks any continuous-param run
    this._undo.push(this._snapshot(scope));
    if (this._undo.length > AudioEngine.UNDO_MAX) this._undo.shift();
    this._redo = [];
  }
  // Coalesced pushUndo for CONTINUOUS params whose UI has no gesture hook (knob
  // onChange fires per pointermove): rapid same-key calls collapse into ONE undo step —
  // the pre-gesture snapshot. A pause (>1.2s), a different key, any discrete pushUndo,
  // or an undo/redo starts a fresh step. The coalesce key IS the snap scope.
  private _coalesceKey: string | null = null;
  private _coalesceAt = 0;
  pushUndoCoalesced(key: string) {
    const now = Date.now();
    if (this._coalesceKey === key && now - this._coalesceAt < 1200) {
      this._coalesceAt = now; // same gesture — keep the original snapshot
      return;
    }
    this.pushUndo(key);
    this._coalesceKey = key;
    this._coalesceAt = now;
  }
  canUndo(preferredScope?: string) {
    if (!preferredScope) return this._undo.length > 0;
    const top = this._undo[this._undo.length - 1];
    return !!top && this._scopeMatches(top.scope, preferredScope);
  }
  canRedo(preferredScope?: string) {
    if (!preferredScope) return this._redo.length > 0;
    const top = this._redo[this._redo.length - 1];
    return !!top && this._scopeMatches(top.scope, preferredScope);
  }
  // When `preferredScope` is set (editor pane focused on a clip), only pop if the
  // TOP snap matches that scope — roll-local undo without a second stack. Timeline
  // focus passes no scope → undoes anything. Content scopes: "content:<id>" also
  // matches slip/swing coalesced keys for the same clip.
  private _scopeMatches(snapScope: string | undefined, preferred: string) {
    const s = snapScope || "arrange";
    if (s === preferred) return true;
    // content:<id> preference also accepts slip:<id> / swing:<id> for that clip
    if (preferred.startsWith("content:")) {
      const id = preferred.slice("content:".length);
      return s === "slip:" + id || s === "swing:" + id;
    }
    return false;
  }
  undo(preferredScope?: string) {
    const top = this._undo[this._undo.length - 1];
    if (!top) return;
    if (preferredScope && !this._scopeMatches(top.scope, preferredScope)) return;
    this._undo.pop();
    this._redo.push(this._snapshot(top.scope));
    this._restoreArrangement(top);
  }
  redo(preferredScope?: string) {
    const top = this._redo[this._redo.length - 1];
    if (!top) return;
    if (preferredScope && !this._scopeMatches(top.scope, preferredScope)) return;
    this._redo.pop();
    this._undo.push(this._snapshot(top.scope));
    this._restoreArrangement(top);
  }
  // bumped on every undo/redo restore — editors key on it to remount with the
  // restored content (a piano roll must never keep a stale working copy)
  undoStamp = 0;
  private _restoreArrangement(snap: UndoSnap) {
    this._coalesceKey = null; // time-travel invalidates any in-flight gesture run
    this.stopAudioClips(); // any playing sources reference clips that may be gone
    this.arrangement = snap.a;
    // mixer state rides in the snapshot: master fader + every live strip must FOLLOW the
    // restored values (vol/pan/devices live in nodes, not just in the arrangement)
    this.masterVol = snap.masterVol;
    this.applyMasterVol();
    if (this.ctx) {
      const tt = this.ctx.currentTime;
      this.refreshTrackGains();
      for (const t of this.arrangement.tracks) {
        const s = this._arrStrips[t.id];
        if (!s) continue;
        s.pan.pan.setTargetAtTime(t.pan, tt, 0.02);
        // re-sync the live FX chain when the restored device list differs (FX edits
        // aren't undoable themselves, but snapshots carry whatever devices existed)
        if (JSON.stringify(s.fx.states()) !== JSON.stringify(t.devices || [])) {
          s.fx.setDevices((t.devices || []).map((d) => structuredClone(d)));
          s.fx.applyAll(this.bpm);
        }
      }
    }
    // keep whatever selection still EXISTS in the restored state — undo must not
    // yank the editor out from under the user; only vanished ids are dropped
    const alive = new Set<string>();
    for (const t of this.arrangement.tracks)
      for (const cl of t.clips) alive.add(cl.id);
    this.selClips = new Set([...this.selClips].filter((id) => alive.has(id)));
    if (this._primaryClipId && !alive.has(this._primaryClipId))
      this._primaryClipId = this.selClips.values().next().value ?? null;
    if (
      this._selTrackId &&
      !this.arrangement.tracks.some((t) => t.id === this._selTrackId)
    )
      this._selTrackId = null;
    this.timeSel = null; // a time range rarely survives a restore meaningfully
    this.undoStamp++;
    saveArrangement(this.arrangement);
    this.emit("arrange");
    this.emit("fx");
    this.emit("select");
  }

  // ── clipboard (copy / cut / paste) ──
  // Copy the selected clips, normalized so the earliest start becomes 0 (paste re-anchors
  // to the insert marker). Records each clip's track KIND so paste lands on a matching track.
  copySelection() {
    const clips: ArrClip[] = [];
    const kinds: TrackKind[] = [];
    let origin = Infinity;
    for (const t of this.arrangement.tracks) {
      for (const c of t.clips)
        if (this.selClips.has(c.id)) origin = Math.min(origin, c.startBeat);
    }
    if (!isFinite(origin)) return;
    for (const t of this.arrangement.tracks) {
      for (const c of t.clips) {
        if (!this.selClips.has(c.id)) continue;
        clips.push({ ...structuredClone(c), startBeat: c.startBeat - origin });
        kinds.push(t.kind);
      }
    }
    this._clipboard = { clips, trackKinds: kinds };
  }
  cutSelection() {
    if (!this.selClips.size) return;
    this.copySelection();
    this.deleteSelectedClips(); // pushes undo itself
  }
  // Paste the clipboard at the insert marker. Each copied clip lands on the FIRST track
  // whose kind matches its source kind, at insertBeat + its relative start. New ids; the
  // pasted clips become the selection.
  pasteClipboard() {
    const cb = this._clipboard;
    if (!cb || !cb.clips.length) return;
    this.pushUndo();
    const at = this.insertBeat;
    const usedByKind: Record<string, number> = {};
    const newIds: string[] = [];
    cb.clips.forEach((c, i) => {
      const kind = cb.trackKinds[i];
      // find the next track of this kind (round-robin so multi-track copies spread out)
      const tracksOfKind = this.arrangement.tracks.filter(
        (t) => t.kind === kind,
      );
      if (!tracksOfKind.length) return;
      const idx = usedByKind[kind] ?? 0;
      const t = tracksOfKind[Math.min(idx, tracksOfKind.length - 1)];
      const clip: ArrClip = {
        ...structuredClone(c),
        id: newClipId(),
        startBeat: Math.max(0, at + c.startBeat),
      };
      t.clips.push(clip);
      this.resolveOverlaps(t, clip);
      newIds.push(clip.id);
    });
    if (newIds.length) this.setSelectedClips(newIds);
    this.saveArr();
  }
  hasClipboard() {
    return !!this._clipboard?.clips.length;
  }

  // ── time-editing ops (insert marker + time selection) ──
  // Split every clip crossing the insert beat into two clips at that point (⌘E). If a
  // time selection with clips is active, splits the selected clips; else splits all
  // clips under the insert beat. The two halves become the new selection.
  splitAtInsert() {
    const beat = this.insertBeat;
    const onlySel = this.selClips.size > 0;
    this.pushUndo();
    const newIds: string[] = [];
    for (const t of this.arrangement.tracks) {
      const add: ArrClip[] = [];
      for (const c of t.clips) {
        const crosses =
          c.startBeat < beat - 1e-6 &&
          c.startBeat + c.lengthBeats > beat + 1e-6;
        if (!crosses || (onlySel && !this.selClips.has(c.id))) {
          add.push(c);
          continue;
        }
        const p = beat - c.startBeat; // local split beat
        const [lc, rc] = splitContent(c.content, p, c.lengthBeats);
        const left: ArrClip = {
          ...c,
          id: newClipId(),
          lengthBeats: p,
          content: lc,
        };
        const right: ArrClip = {
          ...c,
          id: newClipId(),
          startBeat: beat,
          lengthBeats: c.lengthBeats - p,
          content: rc,
        };
        this.stopAudioForClip(c.id);
        add.push(left, right);
        newIds.push(left.id, right.id);
      }
      t.clips = add;
    }
    if (newIds.length) this.setSelectedClips(newIds);
    else this._undo.pop(); // nothing split → drop the empty undo frame
    this.saveArr();
  }

  // Consolidate the selected clips on each track into ONE clip spanning their extent
  // (⌘J). Per track: the merged clip runs from the earliest start to the latest end;
  // its content is the source clips laid end-to-end (gaps become silence). MIDI/drum
  // merge notes at their offsets; audio consolidation keeps the FIRST clip's source
  // (a true audio bounce is out of scope — flagged).
  // Render one track's selected audio clips into a single stereo buffer spanning
  // [startBeat, startBeat + lenBeats). Ableton-consolidate semantics: clip-level
  // gain/rate/trim/loop/reverse are printed; track FX / vol / pan are NOT (they keep
  // applying live to the bounced clip). Returns null when no clip has a decoded buffer.
  private async renderAudioSpan(
    sel: ArrClip[],
    startBeat: number,
    lenBeats: number,
  ): Promise<AudioBuffer | null> {
    const c = this.ensureCtx();
    const bd = 60 / this.arrangement.bpm; // bounce at the ARRANGEMENT's tempo, playing or not
    const sr = c.sampleRate;
    const frames = Math.max(1, Math.ceil(lenBeats * bd * sr));
    const off = new OfflineAudioContext(2, frames, sr);
    // bounce quality: WAIT for beats/complex renders instead of printing the fallback
    for (const clip of sel) {
      if (clip.content.kind !== "audio" || !clip.content.bufId) continue;
      const cc = clip.content;
      const mode = warpModeOf(cc);
      if (mode !== "beats" && mode !== "complex") continue;
      let src = this._importBufs[cc.bufId!];
      if (!src) continue;
      const rev = !!cc.reverse;
      if (rev) src = this.reversedBuffer(cc.bufId!, src);
      const key = this.warpKey(cc, rev, mode);
      if (!this._warpCache.has(key)) {
        const { ratio, semis } = this.warpParams(cc);
        try {
          this._warpCache.set(
            key,
            mode === "beats"
              ? this.beatsRender(src, ratio, semis, cc.rootBpm ?? 0)
              : await this.stretchRender(src, ratio, semis),
          );
          this._warpGen++;
        } catch {
          /* render failed → the bounce prints the varispeed fallback */
        }
      }
    }
    let any = false;
    for (const clip of sel) {
      const s = this.audioClipSource(clip, bd, this.arrangement.bpm);
      if (!s) continue;
      const when = (clip.startBeat - startBeat) * bd;
      const stopAt = when + clip.lengthBeats * bd;
      const g = off.createGain();
      g.gain.value = s.gain;
      g.connect(off.destination);
      const src = off.createBufferSource();
      src.buffer = s.buf;
      src.playbackRate.value = s.rate;
      src.connect(g);
      // mirrors scheduleAudioClip's fire() with catchUp = 0 and no brace
      if (s.looping) {
        src.loop = true;
        src.loopStart = s.loopStartSec;
        src.loopEnd = s.loopEndSec;
        src.start(when, Math.min(s.startSec, s.endSec - 0.001));
        src.stop(stopAt);
      } else {
        const remain = Math.min(s.trimmedSec, (stopAt - when) * s.rate);
        if (remain <= 0.001) continue;
        src.start(when, Math.min(s.startSec, s.endSec - 0.001), remain);
      }
      any = true;
    }
    if (!any) return null;
    return await off.startRendering();
  }

  async consolidateSelection() {
    const ids = [...this.selClips];
    if (!ids.length) return;
    // phase 1 — build every track's merged clip WITHOUT mutating (audio tracks render
    // an offline bounce, which is async); phase 2 applies synchronously under one undo.
    const plans: { t: ArrTrack; sel: ArrClip[]; merged: ArrClip }[] = [];
    for (const t of this.arrangement.tracks) {
      const sel = t.clips
        .filter((c) => ids.includes(c.id))
        .sort((a, b) => a.startBeat - b.startBeat);
      if (sel.length < 2) continue;
      const start = sel[0].startBeat;
      const end = Math.max(...sel.map((c) => c.startBeat + c.lengthBeats));
      const len = end - start;
      const bpb = this.arrangement.beatsPerBar;
      let merged: ArrClip;
      if (t.kind === "audio") {
        const rendered = await this.renderAudioSpan(sel, start, len).catch(
          () => null,
        );
        if (rendered) {
          // a REAL bounce: new buffer in the import store (Opus/WebM or WAV → IndexedDB)
          const bufId = "imp" + ++this._importSeq + Date.now().toString(36);
          this._importBufs[bufId] = rendered;
          void putAudioBuffer(bufId, rendered, sel[0].name || "bounce");
          merged = {
            id: newClipId(),
            startBeat: start,
            lengthBeats: len,
            loop: false,
            name: sel[0].name,
            color: sel[0].color,
            content: {
              kind: "audio",
              bufId,
              name: sel[0].name || "bounce",
              gain: 1,
              a: 0,
              b: 1,
              // the bounce is already tempo-fitted at the bounce bpm; varispeed keeps it
              // grid-locked across future tempo changes when any source clip was warped
              warpMode: sel.some(
                (c) =>
                  c.content.kind === "audio" && warpModeOf(c.content) !== "off",
              )
                ? ("varispeed" as const)
                : undefined,
              rootBpm: this.arrangement.bpm,
              bars: Math.max(1, Math.round(len / bpb)),
            },
          };
        } else {
          // no decoded buffers (nothing imported yet) → old behavior: keep the earliest
          // clip's source spanning the whole extent
          merged = {
            ...sel[0],
            id: newClipId(),
            startBeat: start,
            lengthBeats: len,
          };
        }
      } else {
        // merge notes at their timeline offset relative to `start`
        const notes: NoteClip["notes"] = [];
        for (const c of sel) {
          const src =
            c.content.kind === "midi"
              ? c.content.clip.notes
              : c.content.kind === "drum"
                ? c.content.notes?.notes
                : undefined;
          if (!src) continue;
          const off = c.startBeat - start;
          for (const n of src)
            notes.push({ ...n, id: newNoteId(), start: n.start + off });
        }
        const clip: NoteClip = {
          bars: Math.max(1, Math.ceil(len / bpb)),
          beatsPerBar: bpb,
          notes,
        };
        const content: ArrClip["content"] =
          t.kind === "drum"
            ? {
                kind: "drum",
                pattern: {
                  ...(sel[0].content as { pattern: SequenceClip }).pattern,
                  steps: Math.max(16, Math.ceil(len / STEP_BEATS)),
                },
                notes: clip,
              }
            : { kind: "midi", clip };
        merged = {
          ...sel[0],
          id: newClipId(),
          startBeat: start,
          lengthBeats: len,
          content,
        };
      }
      plans.push({ t, sel, merged });
    }
    if (!plans.length) return; // nothing merged (need ≥2 selected on a track)
    this.pushUndo();
    const newIds: string[] = [];
    for (const p of plans) {
      for (const c of p.sel) this.stopAudioForClip(c.id);
      p.t.clips = [...p.t.clips.filter((c) => !ids.includes(c.id)), p.merged];
      newIds.push(p.merged.id);
    }
    this.setSelectedClips(newIds);
    this.saveArr();
  }

  // Insert silence at the insert marker (⌘I): push every clip that starts at/after the
  // insert beat later by `beats` (defaults to the time selection length, else one bar).
  insertSilence(beats?: number) {
    const at = this.insertBeat;
    const span =
      beats ??
      (this.timeSel
        ? this.timeSel.end - this.timeSel.start
        : this.arrangement.beatsPerBar);
    if (span <= 0) return;
    this.pushUndo();
    for (const t of this.arrangement.tracks) {
      for (const c of t.clips) {
        if (c.startBeat >= at - 1e-6) c.startBeat += span;
        else if (c.startBeat + c.lengthBeats > at + 1e-6) {
          // a clip straddling the insert point is split: left stays, right shifts
          const p = at - c.startBeat;
          const [lc, rc] = splitContent(c.content, p, c.lengthBeats);
          const rightLen = c.lengthBeats - p;
          c.lengthBeats = p;
          c.content = lc;
          this.stopAudioForClip(c.id);
          t.clips.push({
            ...c,
            id: newClipId(),
            startBeat: at + span,
            lengthBeats: rightLen,
            content: rc,
          });
        }
      }
    }
    this.saveArr();
    this.emit("arrange");
  }

  // tap tempo: average the intervals between recent taps (drops stale/outlier taps)
  private _taps: number[] = [];
  tapTempo() {
    const now = this.ctx?.currentTime ?? performance.now() / 1000;
    const last = this._taps[this._taps.length - 1];
    if (last != null && now - last > 2.5) this._taps = []; // gap → start a new set
    this._taps.push(now);
    if (this._taps.length > 5) this._taps.shift();
    if (this._taps.length >= 2) {
      let sum = 0;
      for (let i = 1; i < this._taps.length; i++)
        sum += this._taps[i] - this._taps[i - 1];
      const avg = sum / (this._taps.length - 1);
      if (avg > 0) this.setArrangementBpm(Math.round(60 / avg));
    }
  }
  // move the playhead to `beat` while playing, via the re-anchor trick (same as
  // setBpm): anchor the clock at the target beat now, re-schedule from here.
  // launch-quantize setting (playback pane). 0 = immediate seeks.
  setLaunchQuant(beats: number) {
    this.launchQuant = Math.max(0, beats);
    if (this.launchQuant === 0) this._pendingLaunch = null; // turning it off drops any queue
    try {
      localStorage.setItem(LS_LAUNCH_QUANT, String(this.launchQuant));
    } catch {
      /* fine */
    }
    this.emit("transport");
  }
  // the next quantum boundary strictly after `from` (in the WRAPPED beat domain, so it
  // respects an active loop brace). Boundaries are multiples of `q` measured from the
  // brace start (or song 0). If the next multiple lands at/after the brace end, it
  // wraps to the brace start — the boundary is the loop point itself.
  private nextQuantBoundary(from: number, q: number): number {
    if (q <= 0) return from;
    const br =
      this.loopOn && this.arrangement.loop?.on ? this.arrangement.loop : null;
    const origin = br ? br.start : 0;
    const rel = from - origin;
    const next = origin + (Math.floor(rel / q + 1e-9) + 1) * q;
    if (br && next >= br.end - 1e-9) return br.start; // boundary is the loop wrap point
    return next;
  }
  // the pending-launch target for the timeline indicator (null when none queued)
  pendingLaunch(): { target: number; atBeat: number } | null {
    return this._pendingLaunch;
  }

  seekArrangement(beat: number) {
    beat = Math.max(0, beat);
    // QUANTIZED LAUNCH: while playing, defer the jump to the next quantum boundary so
    // the phase never breaks. Re-aiming before the boundary replaces the target but
    // keeps the same boundary (Ableton clip-launch feel).
    if (this.launchQuant > 0 && this.sequencePlaying && this.arrangeMode && this.ctx) {
      const cur = this.currentBeat();
      const atBeat = this._pendingLaunch
        ? this._pendingLaunch.atBeat // keep the boundary; just re-aim
        : this.nextQuantBoundary(cur, this.launchQuant);
      this._pendingLaunch = { target: beat, atBeat };
      this.emit("transport");
      return;
    }
    this._doSeek(beat);
  }
  // the actual re-anchor jump (immediate). Shared by immediate seeks + the pending-
  // launch firing in schedTick.
  private _doSeek(beat: number) {
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
      this.setInsertBeat(beat); // stopped → the cursor moves there (play resumes from it)
    }
    this.emit("transport");
  }

  // playbackRate for an audio clip in VARISPEED (tape) mode: grid-fit (bpm/rootBpm) ×
  // varispeed (semi+cents). The single source of truth for rate, shared by the
  // scheduler and live re-rating. Other warp modes bake their rate into renders/nodes.
  private audioClipRate(
    cc: {
      warpMode?: WarpMode;
      warp?: boolean;
      sync?: boolean;
      rootBpm?: number;
      semi?: number;
      cents?: number;
      stretch?: number;
    },
    bpm = this.bpm,
  ): number {
    let rate = 1;
    if (warpModeOf(cc) === "varispeed" && cc.rootBpm && cc.rootBpm > 0)
      rate = bpm / cc.rootBpm;
    rate *= Math.pow(2, (cc.semi ?? 0) / 12 + (cc.cents ?? 0) / 1200);
    // ⌥-stretch: tape-style here (rate drops, pitch follows); beats/complex absorb it pitch-preserved
    if (cc.stretch && cc.stretch > 0) rate /= cc.stretch;
    return rate;
  }

  // ── WARP — pitch-preserving tempo-fit + duration-preserving transpose ────────
  // LIVE playback uses persistent stretch nodes (below). The OFFLINE renders here
  // serve the consolidate bounce (renderAudioSpan awaits them) and, when present,
  // improve the brief not-yet-ready fallback.
  private _warpCache = new Map<string, AudioBuffer>();
  private _warpGen = 0; // bumped when a render lands — wave-cache invalidation
  private warpParams(cc: { rootBpm?: number; semi?: number; cents?: number; stretch?: number }) {
    // ⌥-stretch divides the ratio: stretch 2 = content fills twice the beats,
    // pitch-preserved (the render/node absorbs it)
    const ratio =
      (cc.rootBpm && cc.rootBpm > 0 ? this.arrangement.bpm / cc.rootBpm : 1) /
      (cc.stretch && cc.stretch > 0 ? cc.stretch : 1);
    const semis = (cc.semi ?? 0) + (cc.cents ?? 0) / 100;
    return { ratio, semis };
  }
  private warpKey(
    cc: { bufId?: string; rootBpm?: number; semi?: number; cents?: number; stretch?: number },
    rev: boolean,
    algo: "complex" | "beats",
  ) {
    const { ratio, semis } = this.warpParams(cc);
    return `${algo}|${cc.bufId}|${rev ? 1 : 0}|${ratio.toFixed(4)}|${semis.toFixed(2)}|${cc.rootBpm ?? 0}`;
  }
  // ── BEATS mode — the drum warp: a transient-preserving SLICER, not a stretcher.
  // The source is cut at its own 1/16 grid (rootBpm); each slice plays at NATURAL
  // rate (repitched by `semis` via per-slice resampling) but slice STARTS land on the
  // re-spaced output grid. Faster tempo → slices overlap (short crossfades); slower →
  // gated silence after each slice. Pure buffer math, rendered once per settled tempo.
  private beatsRender(
    src: AudioBuffer,
    ratio: number,
    semis: number,
    rootBpm: number,
  ): AudioBuffer {
    const c = this.ensureCtx();
    const sr = src.sampleRate;
    const srcLen = src.length;
    const sliceSrc = Math.max(
      32,
      Math.round(
        (60 / (rootBpm > 0 ? rootBpm : this.arrangement.bpm)) * 0.25 * sr,
      ),
    ); // 1/16 in source frames
    const sliceOut = sliceSrc / ratio; // slice-start spacing in the output
    const outLen = Math.max(1, Math.ceil(srcLen / ratio));
    const out = c.createBuffer(src.numberOfChannels, outLen, sr);
    const pitch = Math.pow(2, semis / 12); // per-slice repitch = resampled read
    const fadeIn = Math.max(1, Math.round(sr * 0.002));
    const fadeOut = Math.max(1, Math.round(sr * 0.005));
    const nSlices = Math.ceil(srcLen / sliceSrc);
    for (let ch = 0; ch < src.numberOfChannels; ch++) {
      const s = src.getChannelData(ch);
      const d = out.getChannelData(ch);
      for (let i = 0; i < nSlices; i++) {
        const srcStart = i * sliceSrc;
        const outStart = Math.round(i * sliceOut);
        // the slice plays until ITS OWN source material runs out (never bleeds into
        // the next slice's transient) or the render ends
        const copyLen = Math.min(
          Math.floor(sliceSrc / pitch),
          outLen - outStart,
        );
        for (let j = 0; j < copyLen; j++) {
          const sp = srcStart + j * pitch;
          const si = Math.floor(sp);
          if (si >= srcLen - 1) break;
          const frac = sp - si;
          let v = s[si] * (1 - frac) + s[si + 1] * frac;
          if (j < fadeIn) v *= j / fadeIn;
          const left = copyLen - j;
          if (left < fadeOut) v *= left / fadeOut;
          d[outStart + j] += v; // += : overlapping slices crossfade via the edge fades
        }
      }
    }
    return out;
  }
  // debounced beats render — ARMED ONCE per key, never reset (schedTick re-requests
  // every ~25ms; a reset-on-call debounce would never fire — learned the hard way),
  // with liveness re-checked at fire time so tempo drags only render the settled ratio.
  private _beatsTimers: Record<string, ReturnType<typeof setTimeout>> = {};
  private requestBeats(key: string, clipId: string) {
    if (this._warpCache.has(key) || this._beatsTimers[key] != null) return;
    this._beatsTimers[key] = setTimeout(() => {
      delete this._beatsTimers[key];
      if (this._warpCache.has(key)) return;
      const wc = this.arrangement.tracks
        .flatMap((t) => t.clips)
        .find((x) => x.id === clipId);
      if (
        !wc ||
        wc.content.kind !== "audio" ||
        warpModeOf(wc.content) !== "beats"
      )
        return;
      const cc = wc.content;
      const bufId = cc.bufId;
      if (!bufId) return;
      if (this.warpKey(cc, !!cc.reverse, "beats") !== key) return; // superseded
      let src = this._importBufs[bufId];
      if (!src) return;
      if (cc.reverse) src = this.reversedBuffer(bufId, src);
      const { ratio, semis } = this.warpParams(cc);
      this._warpCache.set(
        key,
        this.beatsRender(src, ratio, semis, cc.rootBpm ?? 0),
      );
      if (this._warpCache.size > 12)
        this._warpCache.delete(this._warpCache.keys().next().value!);
      this._warpGen++;
      this.stopAudioForClip(clipId); // fallback node → re-fire sliced next tick
      this.emit("arrange");
    }, 200);
  }

  private async stretchRender(
    src: AudioBuffer,
    ratio: number,
    semitones: number,
  ): Promise<AudioBuffer> {
    const frames = Math.max(1, Math.ceil(src.length / ratio));
    const off = new OfflineAudioContext(
      src.numberOfChannels,
      frames,
      src.sampleRate,
    );
    const node = await SignalsmithStretch(off);
    node.connect(off.destination);
    const chans: Float32Array[] = [];
    for (let ch = 0; ch < src.numberOfChannels; ch++)
      chans.push(src.getChannelData(ch));
    await node.addBuffers(chans);
    node.schedule({
      output: 0,
      active: true,
      input: 0,
      rate: ratio,
      semitones,
    });
    return await off.startRendering();
  }
  // ── LIVE warp playback: one persistent stretch node per warp clip ────────────
  // The node holds the clip's input buffers (loaded ONCE per buffer/reverse variant)
  // and plays pitch-locked in real time — the scheduler fires it via schedule()
  // (input position, rate, semitones, loop region), and a tempo drag just re-schedules
  // `rate`: a warp clip consumes exactly 60/rootBpm input-seconds per BEAT at any
  // tempo, so with the re-anchored clock the input position stays continuous — no
  // stop/refire, no pitch snap. The tape fallback below covers only the async warm-up.
  private _stretch: Record<
    string,
    {
      node: StretchNode | null;
      gain: GainNode;
      loadedKey: string;
      ready: boolean;
    }
  > = {};
  // per-pass bookkeeping. PROVEN worklet semantics (see the repro in warp-stretch memory):
  // the node's timeline keeps at most ONE queued future change — any schedule() call
  // pops every queued change at/after "now". So a pass's deactivate must be sent ONLY
  // after its start has taken effect; `stopSent` tracks that deferred send.
  private _stretchFired: Record<
    string,
    { when: number; off: number; stopSent: boolean }
  > = {};
  private ensureStretchNode(clip: ArrClip) {
    if (clip.content.kind !== "audio" || warpModeOf(clip.content) !== "complex")
      return;
    const cc = clip.content;
    const bufId = cc.bufId;
    if (!bufId) return;
    const src0 = this._importBufs[bufId];
    if (!src0) return;
    const rev = !!cc.reverse;
    const loadKey = bufId + (rev ? ":rev" : "");
    const cur = this._stretch[clip.id];
    if (cur && cur.loadedKey === loadKey) return; // loaded (or loading) the right variant
    if (cur) this.disposeStretch(clip.id); // buffer/reverse changed → rebuild
    const c = this.ensureCtx();
    const entry = {
      node: null as StretchNode | null,
      gain: c.createGain(),
      loadedKey: loadKey,
      ready: false,
    };
    this._stretch[clip.id] = entry;
    void SignalsmithStretch(c)
      .then(async (node) => {
        if (this._stretch[clip.id] !== entry) {
          try {
            node.disconnect();
          } catch {
            /* fine */
          }
          return; // superseded while loading
        }
        entry.node = node;
        // stock preset — the one config their demos use; a custom blockMs is the only
        // unverified deviation, so it's out until proven needed
        // a processor exception kills the node FOREVER while `ready` stays true —
        // make that audible (tape fallback) + visible instead of silent
        node.onprocessorerror = () => {
          console.warn(
            "[warp] stretch processor died for clip",
            clip.id,
            "— tape fallback engaged",
          );
          this.disposeStretch(clip.id);
        };
        node.connect(entry.gain);
        const src = rev ? this.reversedBuffer(bufId, src0) : src0;
        const chans: Float32Array[] = [];
        for (let ch = 0; ch < src.numberOfChannels; ch++)
          chans.push(src.getChannelData(ch).slice()); // copies — the worklet may transfer
        await node.addBuffers(chans);
        if (this._stretch[clip.id] !== entry) return;
        entry.ready = true;
      })
      .catch(() => {
        if (this._stretch[clip.id] === entry) delete this._stretch[clip.id]; // node failed → tape fallback stands
      });
  }
  private disposeStretch(clipId: string) {
    const e = this._stretch[clipId];
    if (!e) return;
    try {
      e.node?.stop();
      e.node?.disconnect();
    } catch {
      /* fine */
    }
    try {
      e.gain.disconnect();
    } catch {
      /* fine */
    }
    delete this._stretch[clipId];
    for (const key in this._stretchFired)
      if (key.startsWith(clipId + "@")) delete this._stretchFired[key];
  }

  // dev console probe: `engine.debugStretch()` dumps live-warp state and plays a 1s
  // 440Hz beep through a FRESH stretch node wired straight to the speakers (no strips,
  // no clips). Beep heard = library + ctx fine (fault is in our plumbing); no beep =
  // node-level failure. Watch the console for inputTime ticks + processor errors.
  async debugStretch() {
    const c = this.ensureCtx();
    console.log("[warp] ctx", c.state, "t=", c.currentTime.toFixed(3));
    console.log(
      "[warp] nodes:",
      Object.entries(this._stretch).map(([id, e]) => ({
        id,
        ready: e.ready,
        key: e.loadedKey,
      })),
    );
    console.log("[warp] fired:", Object.keys(this._stretchFired));
    const node = await SignalsmithStretch(c);
    node.onprocessorerror = () => console.warn("[warp] PROBE processor error");
    node.connect(c.destination);
    const n = Math.floor(c.sampleRate * 1);
    const sine = new Float32Array(n);
    for (let i = 0; i < n; i++)
      sine[i] = Math.sin((i / c.sampleRate) * 2 * Math.PI * 440) * 0.2;
    await node.addBuffers([sine]);
    const t0 = c.currentTime + 0.1;
    // proven pattern: start only (one-slot queue) — the stop is sent after it's playing
    node.schedule({
      output: t0,
      active: true,
      input: 0,
      rate: 1,
      semitones: 0,
    });
    node.setUpdateInterval(0.25, () =>
      console.log("[warp] probe inputTime", node.inputTime.toFixed(3)),
    );
    console.log("[warp] probe scheduled — you should hear a 1s beep");
    setTimeout(
      () => node.schedule({ output: c.currentTime, active: false }),
      1100,
    );
    setTimeout(() => {
      try {
        node.disconnect();
      } catch {
        /* fine */
      }
    }, 2500);
  }

  // full-scan |peak| of a buffer, cached per AudioBuffer (one-time cost) — drives
  // the auto-normalize makeup gain
  private _peakScalar = new WeakMap<AudioBuffer, number>();
  private peakOf(buf: AudioBuffer): number {
    const hit = this._peakScalar.get(buf);
    if (hit != null) return hit;
    let p = 0;
    for (let ch = 0; ch < buf.numberOfChannels; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < d.length; i++) {
        const a = Math.abs(d[i]);
        if (a > p) p = a;
      }
    }
    this._peakScalar.set(buf, p);
    return p;
  }

  // Resolve an audio clip's playable source — the buffer (reversed / warped /
  // loop-xfaded as needed), rate, trim seconds, loop points, per-clip gain (incl.
  // auto-normalize makeup). Shared by the live scheduler and the consolidate bounce
  // so both voice a clip IDENTICALLY.
  private audioClipSource(
    clip: ArrClip,
    bd: number,
    bpm = this.bpm,
    opts?: { noWarpSwap?: boolean },
  ) {
    if (clip.content.kind !== "audio") return null;
    const cc = clip.content;
    let srcBuf = cc.bufId ? this._importBufs[cc.bufId] : undefined;
    if (!srcBuf) return null; // not imported yet
    // reverse: swap to the reversed buffer (imports only) and flip the trim/loop fractions
    // so a/b keep meaning "the region you selected on the forward waveform".
    const rev = !!cc.reverse && !!cc.bufId;
    let ta = cc.a ?? 0,
      tb = cc.b ?? 1;
    let tla = cc.loopA,
      tlb = cc.loopB;
    if (rev) {
      srcBuf = this.reversedBuffer(cc.bufId!, srcBuf);
      [ta, tb] = [1 - tb, 1 - ta];
      if (tla != null && tlb != null) [tla, tlb] = [1 - tlb, 1 - tla];
    }
    // ── WARP MODES (beats/complex): swap in a cached render (plays at rate 1 —
    //    tempo-fit + transpose baked in). A miss keeps the tempo-fit tape fallback;
    //    beats kicks its debounced slicer render. complex renders come only from the
    //    bounce cache (live playback uses the stretch NODE — see noWarpSwap). ──
    let rawBuf = srcBuf;
    let bufKey = cc.bufId + (rev ? ":rev" : ""); // identity for the xfade-loop cache
    let warped = false;
    const mode = warpModeOf(cc);
    if (
      (mode === "beats" || mode === "complex") &&
      cc.bufId &&
      !opts?.noWarpSwap
    ) {
      const key = this.warpKey(cc, rev, mode);
      const hit = this._warpCache.get(key);
      if (hit) {
        rawBuf = hit;
        bufKey = "warp:" + key;
        warped = true;
      } else if (mode === "beats") {
        this.requestBeats(key, clip.id);
      }
    }
    // a/b trim (0..1 of the buffer) → seconds; per-clip gain
    const a = Math.min(0.999, Math.max(0, ta));
    const b = Math.min(1, Math.max(a + 0.001, tb));
    const dur = rawBuf.duration;
    const trimmedSec = (b - a) * dur;
    // ── rate: warped buffers already sit on the grid (rate 1). A beats/complex clip
    //    whose render/node is pending plays the TAPE fallback tempo-fitted (bpm/rootBpm,
    //    NO varispeed transpose — grid timing wins over provisional pitch). varispeed/off:
    //    grid-fit × varispeed as before. ──
    const rate = warped
      ? 1
      : mode === "beats" || mode === "complex"
        ? this.warpParams(cc).ratio // tempo-fit ÷ ⌥-stretch (transpose stays out of the fallback)
        : this.audioClipRate(cc, bpm);
    // auto-normalize: scanned peak → makeup toward ≈ −1 dBFS (capped at +18 dB)
    let gain = cc.gain ?? 1;
    if (cc.norm) {
      const pk = this.peakOf(rawBuf);
      if (pk > 1e-4) gain *= Math.min(8, 0.89 / pk);
    }
    // ── auto-loop (Ableton song rule): a clip loops ONLY when it's longer than its
    //    content. contentSec = how long the trimmed region [a,b] plays in clip seconds;
    //    if the clip's length exceeds that, loop the loopA/loopB sub-region (default a/b)
    //    to fill the remainder — re-hashing from the loop start. The per-clip `loop`
    //    toggle (absent = on) turns this off: play once, silence to the clip's end. ──
    const clipLenSec = clip.lengthBeats * bd;
    const contentSec = rate > 0 ? trimmedSec / rate : trimmedSec;
    const looping =
      clipLenSec > contentSec + 0.01 && !!cc.bufId && cc.loop !== false;
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
      // distinct xfade cache key per source variant (reversed / warped buffers differ)
      buf = this.xfadeLoopBuffer(rawBuf, bufKey, 0, ls, le, cc.xfade ?? 0);
      loopStartSec = ls * dur;
      loopEndSec = le * dur;
    }
    return {
      buf,
      rate,
      gain,
      startSec: a * dur,
      endSec: b * dur,
      trimmedSec,
      looping,
      loopStartSec,
      loopEndSec,
    };
  }

  // ── timeline waveforms ──
  // |peak| buckets over a whole buffer, cached per AudioBuffer object (WeakMap — the
  // reversed/xfade-baked variants are distinct buffers and cache independently).
  private _peakCache = new WeakMap<AudioBuffer, Float32Array>();
  private peaksOf(buf: AudioBuffer): Float32Array {
    const hit = this._peakCache.get(buf);
    if (hit) return hit;
    const buckets = Math.min(
      4096,
      Math.max(256, Math.floor(buf.duration * 50)),
    ); // ~50/sec
    const p = new Float32Array(buckets);
    for (let ch = 0; ch < buf.numberOfChannels; ch++) {
      const d = buf.getChannelData(ch);
      const per = d.length / buckets;
      const step = Math.max(1, Math.floor(per / 32));
      for (let i = 0; i < buckets; i++) {
        let m = 0;
        const e = Math.min(d.length, Math.floor((i + 1) * per));
        for (let j = Math.floor(i * per); j < e; j += step) {
          const a = Math.abs(d[j]);
          if (a > m) m = a;
        }
        if (m > p[i]) p[i] = m;
      }
    }
    this._peakCache.set(buf, p);
    return p;
  }
  // Drawing info for an audio clip on the timeline: peaks of the EXACT buffer playback
  // uses (same audioClipSource resolver) + the geometry to map clip-beats → buffer
  // seconds. Recomputed when the clip's params or the tempo change (keyed cache), so
  // the picture tracks playback truthfully — an UNSYNCED clip's wave stretches across
  // more/fewer beats as the tempo moves, exactly like what you hear.
  private _waveCache: Record<
    string,
    { key: string; wave: NonNullable<ReturnType<AudioEngine["buildClipWave"]>> }
  > = {};
  private buildClipWave(clip: ArrClip) {
    // the timeline is defined by the ARRANGEMENT's tempo — never the transport clock,
    // which other pages (lab/legacy sequencer) may have left at their own bpm
    const bd = 60 / this.arrangement.bpm;
    const s = this.audioClipSource(clip, bd, this.arrangement.bpm);
    if (!s) return null;
    return {
      peaks: this.peaksOf(s.buf),
      durSec: s.buf.duration,
      startSec: s.startSec,
      endSec: s.endSec,
      rate: s.rate,
      gain: s.gain, // effective gain incl. auto-normalize makeup (the wave shows it)
      looping: s.looping,
      loopStartSec: s.loopStartSec,
      loopEndSec: s.loopEndSec,
      secPerBeat: bd,
    };
  }
  audioClipWave(clip: ArrClip) {
    if (clip.content.kind !== "audio") return null;
    const cc = clip.content;
    const mode = warpModeOf(cc);
    const key = [
      cc.bufId,
      cc.loopId,
      cc.a,
      cc.b,
      cc.semi,
      cc.cents,
      mode,
      cc.rootBpm,
      cc.loopA,
      cc.loopB,
      cc.xfade,
      cc.snap,
      cc.reverse,
      cc.loop,
      cc.norm,
      cc.stretch,
      clip.slip,
      mode === "beats" || mode === "complex" ? this._warpGen : 0,
      this.arrangement.bpm,
      clip.lengthBeats,
    ].join("|");
    const hit = this._waveCache[clip.id];
    if (hit && hit.key === key) return hit.wave;
    const wave = this.buildClipWave(clip);
    if (!wave) return null;
    this._waveCache[clip.id] = { key, wave };
    return wave;
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
    // live COMPLEX warp: keep the per-clip stretch node warm; once ready it plays this
    // clip pitch-locked (the buffer path below is only the async warm-up fallback)
    const isComplex = warpModeOf(cc) === "complex";
    if (isComplex) this.ensureStretchNode(clip);
    const st = isComplex ? this._stretch[clip.id] : undefined;
    const useLive = !!(st && st.ready && st.node);
    const s = this.audioClipSource(clip, bd, this.bpm, { noWarpSwap: useLive });
    if (!s) return; // not imported yet
    const braceLen = brace ? brace.end - brace.start : 0;
    // fire one instance at absolute start beat `sb`, optionally offset into the clip
    const fire = (sb: number, clipOffsetBeats: number) => {
      const key = clip.id + "@" + sb.toFixed(3);
      if (useLive && st && st.node) {
        // ── live stretch path: drive the persistent node instead of a buffer source.
        // s came with noWarpSwap, so rate/positions are in ORIGINAL-buffer terms. ──
        if (this._stretchFired[key]) return;
        const c = this.ctx!;
        const catchUp = Math.max(0, clipOffsetBeats) * bd;
        const when = Math.max(c.currentTime, whenOf(sb + clipOffsetBeats));
        const stopAt = whenOf(sb + clip.lengthBeats);
        const slipSec = (clip.slip ?? 0) * bd;
        const input = s.startSec + (catchUp + slipSec) * s.rate;
        // one-shot content may run out before the clip's edge (silence after)
        const contentOut = s.rate > 0 ? (s.endSec - input) / s.rate : 0;
        const off = s.looping
          ? stopAt
          : Math.min(stopAt, when + Math.max(0, contentOut));
        if (off <= when) return;
        this._stretchFired[key] = { when, off, stopSent: false };
        // the node takes over from any tape-fallback source still playing this pass
        const fb = this._startedAudio[key];
        if (fb) {
          try {
            fb.src.stop();
          } catch {
            /* already ended */
          }
          delete this._startedAudio[key];
        }
        st.gain.gain.value = s.gain;
        try {
          st.gain.disconnect();
        } catch {
          /* not connected */
        }
        st.gain.connect(this.trackStrip(t));
        // START only — never pass `outputTime`, and never queue the stop here: the
        // worklet holds ONE queued future change, so a second schedule() would pop
        // this start (that was the total-silence bug). The deactivate is sent by the
        // sweep below once this start has taken effect.
        st.node.schedule({
          output: when,
          active: true,
          input,
          rate: s.rate,
          semitones: (cc.semi ?? 0) + (cc.cents ?? 0) / 100,
          loopStart: s.looping ? s.loopStartSec : 0,
          loopEnd: s.looping ? s.loopEndSec : 0, // equal values = looping disabled
        });
        return;
      }
      if (this._startedAudio[key]) return;
      const c = this.ctx!;
      const g = c.createGain();
      g.gain.value = s.gain;
      const src = c.createBufferSource();
      src.buffer = s.buf;
      src.playbackRate.value = s.rate;
      g.connect(this.trackStrip(t));
      src.connect(g);
      const catchUp = Math.max(0, clipOffsetBeats) * bd; // seconds into the clip already elapsed
      const when = Math.max(c.currentTime, whenOf(sb + clipOffsetBeats));
      // buffer offset advances at `rate` (buffer seconds per clip second); slip shifts
      // content under fixed clip bounds (same concept as MIDI slippedLocals)
      const slipSec = (clip.slip ?? 0) * bd;
      let offSec = s.startSec + (catchUp + slipSec) * s.rate;
      // both paths are hard-cut at the clip's end on the timeline
      const stopAt = whenOf(sb + clip.lengthBeats);
      if (s.looping) {
        src.loop = true;
        src.loopStart = s.loopStartSec;
        src.loopEnd = s.loopEndSec;
        // wrap slip+catchUp into the loop region so a large slip doesn't start past loopEnd
        const loopLen = s.loopEndSec - s.loopStartSec;
        if (loopLen > 0 && offSec >= s.loopEndSec) {
          offSec = s.loopStartSec + ((offSec - s.loopStartSec) % loopLen);
        }
        src.start(when, Math.min(offSec, s.endSec - 0.001));
        if (stopAt > when) src.stop(stopAt);
      } else {
        // one-shot: play the trimmed region, but never past the clip end (cut). The
        // buffer duration to schedule is the smaller of (content left) and (clip left).
        const bufLeft = s.trimmedSec - (catchUp + slipSec) * s.rate; // buffer seconds remaining in [a,b]
        const clipLeft = (stopAt - when) * s.rate; // buffer seconds until the clip end
        const remain = Math.min(bufLeft, clipLeft);
        if (remain <= 0.001) return;
        src.start(when, Math.min(offSec, s.endSec - 0.001), remain);
      }
      src.onended = () => {
        try {
          g.disconnect();
        } catch {
          /* fine */
        }
      };
      this._startedAudio[key] = {
        src,
        synced: warpModeOf(cc) === "varispeed",
        baseRate: s.rate,
        baseBpm: this.bpm,
      };
    };
    // brace loop: an instance per pass whose start lands in the window. Without a brace,
    // fire once when startBeat enters the window (or immediately if we began mid-clip).
    const passStarts = brace
      ? (() => {
          const out: number[] = [];
          for (
            let k = Math.floor((fromBeatAbs - clip.startBeat) / braceLen);
            ;
            k++
          ) {
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
    // ── deferred pass-end stops for the live stretch node. The worklet keeps ONE
    // queued future change (proven in the repro), so each pass's deactivate is sent
    // only once its start has taken effect and the end is near. (Brace edge: a stop
    // popped by the next pass's start at the same instant is harmless — the new
    // start replaces it.) ──
    if (useLive && st && st.node && this.ctx) {
      const nowT = this.ctx.currentTime;
      for (const k in this._stretchFired) {
        if (!k.startsWith(clip.id + "@")) continue;
        const f = this._stretchFired[k];
        if (
          !f.stopSent &&
          nowT >= f.when &&
          f.off <= nowT + AudioEngine.SCHED_AHEAD * 2
        ) {
          st.node.schedule({ output: f.off, active: false });
          f.stopSent = true;
        }
      }
    }
  }

  // schedule every event landing in (_scheduledThrough, currentTime+AHEAD],
  // mapping clip beats onto absolute ctx times and wrapping at the loop boundary.
  // Branches: the linear arrangement, or the Audio Lab's single-clip audition.
  private schedTick() {
    const c = this.ctx;
    if (!c || !this.sequencePlaying) return;
    // audio record: roll past count-in → start PCM capture on the transport clock
    this.maybeStartAudioCapture();
    // fire a pending quantized launch once the song reaches its boundary. Do it BEFORE
    // scheduling this window so the jump re-anchors first. `_doSeek` clears + re-ticks,
    // so null the queue first to avoid re-entry.
    if (this._pendingLaunch && this.arrangeMode) {
      const pl = this._pendingLaunch;
      if (this.currentBeat() >= pl.atBeat - 1e-6) {
        this._pendingLaunch = null;
        this._doSeek(pl.target);
        return; // _doSeek re-ticked from the new anchor
      }
    }
    const total = this.activeTotalBeats();
    if (total <= 0) return;
    const bd = this.beatDur();
    const horizon = c.currentTime + AudioEngine.SCHED_AHEAD;
    const fromBeatAbs =
      this._seqAnchorBeat + (this._scheduledThrough - this._seqAnchorTime) / bd;
    const toBeatAbs =
      this._seqAnchorBeat + (horizon - this._seqAnchorTime) / bd;
    const whenOf = (absBeat: number) =>
      this._seqAnchorTime + (absBeat - this._seqAnchorBeat) * bd;

    // ── linear arrangement branch ──
    // Walk placed clips; a clip's content sits at `clip.startBeat`. The global loop
    // brace (arrangement.loop, on ⇒ loopOn) wraps the WHOLE window at the brace
    // bounds — so we shift the lookahead window back into the brace and also probe
    // the previous wrap for clips straddling the brace start. Phase 1: MIDI clips.
    if (this.arrangeMode) {
      const brace =
        this.loopOn && this.arrangement.loop?.on ? this.arrangement.loop : null;
      const braceLen = brace ? brace.end - brace.start : 0;
      // Emit a voice for a run at its timeline beat, mapping into the lookahead
      // window. With the loop brace, an event only fires if it lives inside the
      // brace, and it repeats every braceLen — so we scan the wrap iterations `k`
      // that land in the window (mirrors the loop grid's k*total wrap).
      const emitRun = (
        run: NoteRun,
        timelineBeat: number,
        sel: VoiceSel,
        vibLane?: AutoLane,
      ) => {
        if (brace && (timelineBeat < brace.start || timelineBeat >= brace.end))
          return;
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
            ? run.bends.map((b) => ({
                toMidi: b.toMidi,
                from: when + (b.fromBeat - run.startBeat) * bd,
                at: when + (b.atBeat - run.startBeat) * bd,
              }))
            : undefined;
          const autoVib = vibLane?.points.length
            ? {
                points: vibLane.points,
                startBeat: run.startBeat,
                endBeat: run.endBeat,
                whenOfBeat: (cb: number) => when + (cb - run.startBeat) * bd,
                rate: vibLane.rate,
                intensity: vibLane.intensity,
              }
            : undefined;
          const h = this.startVoiceAt(
            run.pitch,
            run.vel,
            when,
            sel,
            bends,
            autoVib,
          );
          this.releaseVoice(h, off);
          this._seqVoices.push(h);
          if (!brace) break;
        }
      };
      // one drum hit at a timeline beat, wrapped through the loop brace like emitRun
      const emitDrum = (
        lane: DrumLane,
        timelineBeat: number,
        vel: number,
        dest: AudioNode,
        kitId: string,
      ) => {
        if (brace && (timelineBeat < brace.start || timelineBeat >= brace.end))
          return;
        let k = brace ? Math.floor((fromBeatAbs - timelineBeat) / braceLen) : 0;
        for (; ; k++) {
          const absBeat = timelineBeat + (brace ? k * braceLen : 0);
          if (absBeat >= toBeatAbs) break;
          if (absBeat < fromBeatAbs) {
            if (!brace) break;
            continue;
          }
          this.voiceDrum(lane, whenOf(absBeat), vel, dest, kitId);
          if (!brace) break;
        }
      };
      for (const t of this.arrangement.tracks) {
        if (this.trackGain(t) <= 0) continue;
        for (const clip of t.clips) {
          if (clip.muted) continue; // deactivated clip — drawn dim, never scheduled
          if (clip.content.kind === "midi") {
            const sel = this.trackVoice(t);
            const vibLane = clip.content.clip.autos?.find(
              (a) => a.target === "vibrato",
            );
            const runs = this.buildRuns(clip.content.clip.notes);
            const contentLen = Math.max(0.25, clipBeats(clip.content.clip));
            for (const run of runs) {
              for (const local of slippedLocals(
                run.startBeat,
                clip.slip,
                contentLen,
                clip.lengthBeats,
              )) {
                // swing delays the run's head; the run rides along rigidly (bends/length unwarped)
                emitRun(
                  run,
                  clip.startBeat + local + swingDelay(local, clip.swing),
                  sel,
                  vibLane,
                );
              }
            }
          } else if (clip.content.kind === "drum") {
            const pat = clip.content.pattern;
            const kit = findKit(pat.kitId);
            const dest = this.trackStrip(t);
            const contentLen = Math.max(0.25, pat.steps * STEP_BEATS);
            const notes = clip.content.notes; // lossless source of truth when present
            // per-lane mute/solo within THIS clip's pattern: a lane is audible unless
            // muted, or a solo is up on some lane and this isn't one.
            const mix = pat.laneMix || {};
            const anySolo = Object.values(mix).some((m) => m?.solo);
            const audible = (laneId: string) => {
              const m = mix[laneId];
              if (m?.mute) return false;
              return !anySolo || !!m?.solo;
            };
            if (notes) {
              for (const nt of notes.notes) {
                if (nt.muted) continue; // deactivated hit
                const lane = kit.lanes[nt.pitch - DRUM_BASE];
                if (!lane || !audible(lane.id)) continue;
                for (const local of slippedLocals(
                  nt.start,
                  clip.slip,
                  contentLen,
                  clip.lengthBeats,
                )) {
                  emitDrum(
                    lane,
                    clip.startBeat + local + swingDelay(local, clip.swing),
                    nt.vel,
                    dest,
                    kit.id,
                  );
                }
              }
            } else {
              for (let s = 0; s < pat.steps; s++) {
                const stepBeat = s * STEP_BEATS;
                for (const local of slippedLocals(
                  stepBeat,
                  clip.slip,
                  contentLen,
                  clip.lengthBeats,
                )) {
                  for (const lane of kit.lanes) {
                    if (!pat.on[lane.id]?.[s] || !audible(lane.id)) continue;
                    emitDrum(
                      lane,
                      clip.startBeat +
                        local +
                        swingDelay(local, clip.swing),
                      pat.accent[lane.id]?.[s] ? 1 : 0.7,
                      dest,
                      kit.id,
                    );
                  }
                }
              }
            }
          } else if (clip.content.kind === "audio") {
            this.scheduleAudioClip(
              t,
              clip,
              fromBeatAbs,
              toBeatAbs,
              whenOf,
              bd,
              brace,
            );
          }
        }
      }
      // metronome: a click on every integer beat in this window (accent on the bar
      // downbeat). Tracked in _metroThrough so a click is scheduled exactly once even as
      // the lookahead window slides. Ignores the loop brace (counts absolute beats).
      if (this.metronome) {
        const bpb = this.arrangement.beatsPerBar;
        const first = Math.max(
          Math.ceil(fromBeatAbs - 1e-6),
          Math.floor(this._metroThrough) + 1,
        );
        for (let beat = first; beat < toBeatAbs; beat++) {
          this.metroClick(whenOf(beat), ((beat % bpb) + bpb) % bpb === 0);
          this._metroThrough = beat;
        }
      }
      if (this._seqVoices.length > 256)
        this._seqVoices = this._seqVoices.slice(-128);
      this._scheduledThrough = horizon;
      return;
    }

    // Audio Lab single-clip audition (RollLab): the shared scheduler walks `_clip`.
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
          ? run.bends.map((b) => ({
              toMidi: b.toMidi,
              from: when + (b.fromBeat - run.startBeat) * bd,
              at: when + (b.atBeat - run.startBeat) * bd,
            }))
          : undefined;
        const autoVib = clipVibLane?.points.length
          ? {
              points: clipVibLane.points,
              startBeat: run.startBeat,
              endBeat: run.endBeat,
              whenOfBeat: (cb: number) => when + (cb - run.startBeat) * bd,
              rate: clipVibLane.rate,
              intensity: clipVibLane.intensity,
            }
          : undefined;
        const h = this.startVoiceAt(
          run.pitch,
          run.vel,
          when,
          undefined,
          bends,
          autoVib,
        );
        this.releaseVoice(h, off);
        this._seqVoices.push(h);
        if (!this.loopOn) break;
      }
    }
    if (this._seqVoices.length > 256)
      this._seqVoices = this._seqVoices.slice(-128);
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
        arrangeMode: this.arrangeMode,
        loopOn: this.loopOn,
        bpm: this.bpm,
        position: c
          ? this._offset +
            (this.playing ? Math.max(0, c.currentTime - this._startCtx) : 0)
          : this._offset,
      },
      track: {
        id: this.track?.id ?? null,
        ready: this.ready,
        loading: this.loading,
        error: this.error,
        duration: this.duration,
      },
      graph: {
        ctxState: c?.state ?? "none",
        ctxTime: c?.currentTime ?? 0,
        sampleRate: c?.sampleRate ?? 0,
        wet: this.wet,
        levelMatch: this.levelMatch,
      },
      fx: { master: this.masterDevices(), limiter: { ...this.limiter } },
      voices: {
        liveKeyboard: Object.keys(this._liveVoices).length,
        scheduler: this._seqVoices.length,
        playingSources: this._srcs?.length ?? 0,
        activeNotes: Object.keys(this._liveVoices), // "<channelId|_>:<midi>"
      },
    };
  }
}

export const engine = new AudioEngine();

// Dev-only console handle: `engine.debug()` in the browser. Statically false in
// production builds, so it tree-shakes out. ponytail: drop if it ever ships.
if (import.meta.env.DEV)
  (globalThis as { engine?: AudioEngine }).engine = engine;

// AudioWorklet processors register once per AudioContext and never hot-swap.
// Editing a worklet without a full reload silently keeps the old DSP running.
if (import.meta.hot) {
  const reload = (file: string) => {
    console.warn(`[ain] ${file} changed — full reload (AudioWorklet cannot HMR)`);
    location.reload();
  };
  import.meta.hot.accept("./worklets/centinel-processor.js", () =>
    reload("centinel-processor.js"),
  );
  import.meta.hot.accept("./worklets/impartialer-processor.js", () =>
    reload("impartialer-processor.js"),
  );
  import.meta.hot.accept("./worklets/speccomp-processor.js", () =>
    reload("speccomp-processor.js"),
  );
  import.meta.hot.accept("./worklets/cliplim-processor.js", () =>
    reload("cliplim-processor.js"),
  );
}
