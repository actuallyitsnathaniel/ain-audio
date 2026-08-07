// Centinel — monophonic pitch corrector (Fairbanks / optional PSOLA).
// YIN f0 → stays_locked+hold commit → sticky want → R* = hz(want)/hz(det) → OLA.
// Soft speed: Fairbanks = within-note only; formant≥0.5 PSOLA = full ratio chase (D6).
// formant ≥ 0.5 → period PSOLA on clear vowels (hysteresis + crossfade to Fairbanks).
// Humanize = slower retune on sustains. Natural Vibrato scales AC residual.
// Detector confidence: multipitch/reverb (+ octave rivals) → hold retarget,
// hysteretic wet gate (not R*).
// Circular buffers N=2048; latency = N/2.
//
// Build stamp — bump when diagnosing "did the worklet reload?" (AudioWorklets do NOT HMR).
const CENTINEL_BUILD = "2026-08-07o-center-tight";

const N = 2048;
const N2 = N >> 1;
const NOVERLAP = 4;
const DETECT_EVERY = N / NOVERLAP;
const F_MIN_DEFAULT = 110;
const F_MAX_DEFAULT = 700;
const AREF = 440;
const VIZ_BINS = 96;
const MIDI_LO = 36;
const MIDI_HI = 84;
const VIZ_EVERY = 2;
const STABLE_NEED = 3;
const MAX_JUMP_SEMI = 7;
const FACT_MIN = 0.5;
const FACT_MAX = 2.0;
const RMS_GATE = 0.01;
const UNVOICED_DROP = 40;
/** Sustained below RMS_GATE this long (ms) → close wet (phrase-end ring). */
const EDGE_QUIET_MS = 45;
/** Faster dry↔wet when edge-quiet — tails were +6…+17 dB vs dry. */
const EDGE_WET_XFADE_MS = 12;

/** Silvertune-style: ignore YIN wander within this while locked (semitones). */
const STAYS_LOCKED_SEMI = 0.4;
/** Base hold before committing a new note (ms). Soft speed stretches this. */
const HOLD_MS_BASE = 15;
/**
 * Raw must beat the sticky scale target by this much (semitones) before we
 * even start a retarget hold — stops boundary flip-flops Autotune doesn't do.
 * Eased from 0.28 (f-strict-at too sticky/robotic) toward 0.35 pre-strict.
 */
const RETUNE_HYST_SEMI = 0.32;
/**
 * Soft speed may chase R* only when |ratio error| is under this (cents).
 * Larger jumps and every note-commit snap — Fairbanks cannot soft-glide
 * across a note without vowel morph.
 */
const WITHIN_NOTE_SOFT_CENTS = 40;
/** Enter PSOLA above this YIN clarity (hysteresis with OFF). */
const PSOLA_CLARITY_ON = 0.48;
/** Leave PSOLA below this clarity / unvoiced. */
const PSOLA_CLARITY_OFF = 0.32;
/** Extra clarity required below this f0 (Hz) — low notes octave-chatter on onset. */
const PSOLA_LOW_HZ = 140;
const PSOLA_LOW_CLARITY_BONUS = 0.14;
/**
 * After arm/re-voice, wait this long before PSOLA may engage (PE settle).
 * Pitch correction under formant mode stays at R=1 until PSOLA owns the path —
 * Fairbanks-shifting first is the classic phrase-start “low formant” glitch.
 */
const PSOLA_ONSET_MS = 80;
/** Consecutive analysis hops with stable PE before *entering* PSOLA. */
const PSOLA_PE_STABLE_NEED = 3;
/**
 * Mid-stream PE may jump this much (relative) without discarding the grain.
 * A major 3rd ≈ 26% period change — must NOT dump to Fairbanks (formant smear).
 */
const PSOLA_PE_KEEP_REL = 0.35;
/** Fairbanks-only: min unity settle before allowing R* (ms). */
const ONSET_UNITY_MS = 40;
/** Failsafe: never hold R=1 longer than this after arm (ms). */
const ONSET_UNITY_MAX_MS = 260;
/** Fairbanks↔PSOLA crossfade (ms) — shorter = less muffled path handoff. */
const PSOLA_GATE_MS = 16;
/** Release formant-mode unity once PSOLA mix is at least this high. */
const ONSET_PSOLA_READY = 0.88;
/** Dry↔corrected wet crossfade (ms). Hard cuts here were the post-fixant pops. */
const WET_XFADE_MS = 16;
/**
 * After a note commit, prefer a fresh PSOLA grain for this long (ms).
 * No dual-grain OLA — overlapping old+new grains read as a slap/delay.
 */
const COMMIT_RECAPTURE_MS = 28; // was 40 — long unity muffled note edges vs AT
/**
 * Cold start (re-arm after silence): tapered Retune Speed floor + dry gate so
 * bare riffs/runs don't audition a staircase into the first notes.
 */
const COLD_START_MS = 400;
const COLD_START_SPEED_FLOOR_MS = 150;
/** Stay on latency-dry until |want−audible| is under this (cents), while cold. */
const COLD_WET_CENTS = 28;
/** Soft+PSOLA: briefly floor speed after a note commit (rapid runs).
 * Eased from 50/48 — still below old 90/85 that lagged AT on short notes. */
const COMMIT_SOFT_MS = 70;
const COMMIT_SOFT_FLOOR_MS = 62;
/** Cold wet fade — slower than normal so the dry→tuned handoff isn't a step. */
const COLD_WET_XFADE_MS = 28;
// Detector confidence (reverb / multipitch).
// Below RETARGET: don't start a new note hold.
// Ambiguous frames also floor soft Retune Speed briefly.
// Low conf closes wet via hysteresis (not a continuous 0..1 gain — that
// comb-filtered dry+OLA and clicked). Close is debounced so room flutter
// doesn't flash dry mid-vowel. R*/want untouched.
const CONF_RETARGET = 0.55;
/** Open wet only after conf rises above this (exit duck). */
const CONF_WET_HI = 0.48;
/** Close wet when conf stays below this (enter duck). */
const CONF_WET_LO = 0.28;
/** Sustained low-conf time before closing wet (ms) — room reflection flutter. */
const CONF_WET_CLOSE_MS = 100;
/** Conf-driven dry↔wet fade — slower than normal so gate flips don't click. */
const CONF_WET_XFADE_MS = 48;
const REVERB_SOFT_MS = 140;
const REVERB_SOFT_FLOOR_MS = 100;
/**
 * Humanize (Auto-Tune–style): after this note age, stretch Retune Speed on
 * sustains so short notes stay tight while long notes breathe.
 */
const HUMANIZE_SUSTAIN_MS = 100;
/** Ramp from 0→full humanize stretch over this many ms past the sustain gate. */
const HUMANIZE_RAMP_MS = 120;
/** Extra Retune Speed (ms) at humanize=1 once fully sustained. */
const HUMANIZE_EXTRA_MS = 190;
/**
 * Post-commit center lock — stationary only (still_loose was ~10pp behind AT
 * on ≤15¢). Boundary-follow stays scoop-gated so shake doesn't return.
 */
const CENTER_LOCK_AGE_MS = 40;
/** |audibleWant − tgt| window (cents) once glide has settled. */
const CENTER_LOCK_CENTS = 42;
/** Center-chase tau floor (ms) while stationary. */
const CENTER_LOCK_SPEED_MS = 18;
/** Glide settled: |wantTgt − audibleWant| under this (cents) before speeding up. */
const CENTER_LOCK_SETTLE_CENTS = 12;
/** Pull strength of sticky want → scale center while stationary. */
const CENTER_WANT_PULL = 0.42;
/** Extra bias of wantBase onto tgt once parked near center (stationary). */
const CENTER_WANT_BIAS = 0.38;
/**
 * Boundary soften (pop flex=0): only on *directed* scoops/gestures.
 * Engaging whenever |raw−sticky| > ~30¢ let rough/pitchy sustains pull want
 * with YIN jitter → "shaky" tuned vocal (m bounce: +shake reversals).
 */
const BOUNDARY_FOLLOW_SEMI = 0.38;
/** Fraction of (det − stickyWant) to follow at full boundary. */
const BOUNDARY_FOLLOW_AMT = 0.38;
/** Semitone span over which boundary follow ramps 0→full. */
const BOUNDARY_FOLLOW_SPAN = 0.35;
/** Slow pitch center for Natural Vibrato extraction (ms). */
const VIB_CENTER_MS = 110;
/**
 * Pitch-velocity: season hold lightly; gate boundary-follow to gestures.
 */
const STABLE_VEL_ST_S = 2.8;
const GESTURE_VEL_ST_S = 8.0;
/** Medium scoop — may boundary-follow without full gesture flag. */
const SCOOP_VEL_ST_S = 4.5;
const STABLE_PITCH_MS = 28;
const HOLD_STABLE_SCALE = 0.88;
const HOLD_GESTURE_SCALE = 1.18;
/** Want-base slew — slower when stationary so roughness doesn't chatter. */
const WANT_BASE_SLEW_STABLE = 0.18;
const WANT_BASE_SLEW_GESTURE = 0.5;

const SCALE_PCS = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};
const DEFAULT_CUSTOM = [0, 2, 4, 5, 7, 9, 11];

/** Mirror of fx-devices CENTINEL_INPUT_HZ — keep in sync. */
const INPUT_HZ = {
  soprano: { fMin: 200, fMax: 1200 },
  altoTenor: { fMin: 110, fMax: 700 },
  lowMale: { fMin: 70, fMax: 380 },
  instrument: { fMin: 80, fMax: 1000 },
  bassInst: { fMin: 45, fMax: 250 },
};

function scalePcsOf(scale, customPcs) {
  if (scale === "custom") {
    const pcs = Array.isArray(customPcs)
      ? customPcs.filter((n) => n >= 0 && n <= 11)
      : [];
    return pcs.length ? pcs : DEFAULT_CUSTOM;
  }
  return SCALE_PCS[scale] || SCALE_PCS.major;
}

function nearestMidiNote(det, notes) {
  let best = det;
  let bestAbs = Infinity;
  for (let i = 0; i < notes.length; i++) {
    const n = notes[i];
    const m = n + 12 * Math.round((det - n) / 12);
    const a = Math.abs(m - det);
    if (a < bestAbs) {
      bestAbs = a;
      best = m;
    }
  }
  return best;
}

function hzToMidi(hz) {
  return 69 + (12 * Math.log(hz / AREF)) / Math.LN2;
}

function midiToHz(m) {
  return AREF * Math.pow(2, (m - 69) / 12);
}

function midiToNorm(m) {
  return Math.max(0, Math.min(1, (m - MIDI_LO) / (MIDI_HI - MIDI_LO)));
}

function nearestScaleMidi(midi, key, scalePcs) {
  const pc = ((midi % 12) + 12) % 12;
  const rel = (pc - key + 12) % 12;
  let best = 0;
  let bestAbs = Infinity;
  for (let i = 0; i < scalePcs.length; i++) {
    let d = scalePcs[i] - rel;
    if (d > 6) d -= 12;
    if (d < -6) d += 12;
    const a = Math.abs(d);
    if (a < bestAbs) {
      bestAbs = a;
      best = d;
    }
  }
  return midi + best;
}

/** Hold time: longer when soft so we don't commit to a wrong neighbor mid-glide.
 * Midway: AT-ish settle without f-strict-at robotics (cap was 48 → 60). */
function holdMsForSpeed(speedMs, coldStart, pitchConf) {
  if (!(speedMs >= 0.5)) return HOLD_MS_BASE;
  let ms = Math.max(HOLD_MS_BASE, Math.min(60, speedMs * 0.32));
  // Cold re-arm: slight extra hold — first note of a run still needs a beat of trust.
  if (coldStart) ms = Math.max(ms, Math.min(72, ms + 18));
  // Reverb / low confidence: commit slower — fewer false neighbor snaps.
  if (pitchConf < CONF_RETARGET) {
    ms = Math.max(ms, Math.min(95, ms + 26));
  }
  return ms;
}

function octaveLock(midi, ref) {
  let m = midi;
  while (m - ref > 6) m -= 12;
  while (ref - m > 6) m += 12;
  return m;
}

function yinPitch(buf, sr, fMin, fMax, d, cmnd) {
  const n = buf.length;
  const tauMax = Math.min(n - 2, Math.floor(sr / fMin));
  const tauMin = Math.max(2, Math.floor(sr / fMax));
  if (tauMax <= tauMin + 2)
    return { f0: 0, clarity: 0, confidence: 0, ambiguous: false };

  for (let tau = 1; tau <= tauMax; tau++) {
    let sum = 0;
    const lim = n - tau;
    for (let i = 0; i < lim; i++) {
      const delta = buf[i] - buf[i + tau];
      sum += delta * delta;
    }
    d[tau] = sum;
  }

  cmnd[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= tauMax; tau++) {
    running += d[tau];
    cmnd[tau] = running > 0 ? (d[tau] * tau) / running : 1;
  }

  const thresh = 0.12;
  let tau = tauMin;
  for (; tau <= tauMax; tau++) {
    if (cmnd[tau] < thresh) {
      while (tau + 1 <= tauMax && cmnd[tau + 1] < cmnd[tau]) tau++;
      break;
    }
  }
  if (tau >= tauMax || cmnd[tau] >= 1) {
    return { f0: 0, clarity: 0, confidence: 0, ambiguous: false };
  }

  const tau2 = tau * 2;
  if (tau2 + 1 <= tauMax) {
    let t2 = tau2;
    if (t2 > 1 && cmnd[t2 - 1] < cmnd[t2]) t2--;
    if (t2 + 1 <= tauMax && cmnd[t2 + 1] < cmnd[t2]) t2++;
    // Prefer longer period only when *clearly* better. Rooms make 2τ look
    // "as good" as τ (early reflection / subharmonic) — 1.02 was octave-downing.
    if (cmnd[t2] < cmnd[tau] * 0.95 && cmnd[t2] < 0.08) tau = t2;
  }

  const x0 = tau > 1 ? cmnd[tau - 1] : cmnd[tau];
  const x1 = cmnd[tau];
  const x2 = tau + 1 <= tauMax ? cmnd[tau + 1] : cmnd[tau];
  const denom = 2 * (2 * x1 - x2 - x0);
  const better = denom !== 0 ? tau + (x2 - x0) / denom : tau;
  const f0 = sr / better;
  const clarity = Math.max(0, Math.min(1, 1 - cmnd[tau]));
  if (!(f0 >= fMin && f0 <= fMax)) {
    return { f0: 0, clarity: 0, confidence: 0, ambiguous: false };
  }

  const primary = cmnd[tau];
  // Non-octave multipitch (other notes / clutter). Near-τ skipped as same trough.
  let second = 1;
  const nearLo = tau * 0.78;
  const nearHi = tau * 1.28;
  const octLo = tau * 1.85;
  const octHi = tau * 2.2;
  const halfLo = tau * 0.48;
  const halfHi = tau * 0.54;
  for (let t = tauMin; t <= tauMax; t++) {
    if (t >= nearLo && t <= nearHi) continue;
    if (t >= octLo && t <= octHi) continue;
    if (t >= halfLo && t <= halfHi) continue;
    if (cmnd[t] < second) second = cmnd[t];
  }
  // Room reflections love ≈2τ / ≈½τ rivals that clean harmonics also show —
  // only flag when the rival is nearly as deep as the primary (not "expected weak").
  let octBest = 1;
  for (
    let t = Math.max(tauMin, Math.floor(octLo));
    t <= Math.min(tauMax, Math.ceil(octHi));
    t++
  ) {
    if (cmnd[t] < octBest) octBest = cmnd[t];
  }
  let halfBest = 1;
  for (
    let t = Math.max(tauMin, Math.floor(halfLo));
    t <= Math.min(tauMax, Math.ceil(halfHi));
    t++
  ) {
    if (cmnd[t] < halfBest) halfBest = cmnd[t];
  }
  const octaveRival =
    (octBest <= primary * 1.18 && octBest < 0.16) ||
    (halfBest <= primary * 1.12 && halfBest < 0.14);
  const multiOther = second < primary * 1.4 && second < 0.22;
  const ambiguous = multiOther || octaveRival;
  let confidence = clarity;
  if (octaveRival) confidence *= 0.32;
  else if (multiOther) confidence *= 0.42;
  // Soften when primary trough isn't crisp either
  if (primary > 0.1) confidence *= 0.85;

  return { f0, clarity, confidence, ambiguous };
}

function cubicAt(buf, indd) {
  const n = buf.length;
  const ind1 = Math.floor(indd);
  const ind0 = ind1 - 1;
  const ind2 = ind1 + 1;
  const ind3 = ind1 + 2;
  const val0 = buf[((ind0 % n) + n) % n];
  const val1 = buf[((ind1 % n) + n) % n];
  const val2 = buf[((ind2 % n) + n) % n];
  const val3 = buf[((ind3 % n) + n) % n];
  let vald = 0;
  vald -= 0.166666666667 * val0 * (indd - ind1) * (indd - ind2) * (indd - ind3);
  vald += 0.5 * val1 * (indd - ind0) * (indd - ind2) * (indd - ind3);
  vald -= 0.5 * val2 * (indd - ind0) * (indd - ind1) * (indd - ind3);
  vald += 0.166666666667 * val3 * (indd - ind0) * (indd - ind1) * (indd - ind2);
  return vald;
}

class AinCentinelProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      {
        name: "mix",
        defaultValue: 1,
        minValue: 0,
        maxValue: 1,
        automationRate: "k-rate",
      },
      {
        name: "amount",
        defaultValue: 1,
        minValue: 0,
        maxValue: 1,
        automationRate: "k-rate",
      },
      {
        name: "speed",
        defaultValue: 25,
        minValue: 0,
        maxValue: 400,
        automationRate: "k-rate",
      },
      {
        name: "flex",
        defaultValue: 0,
        minValue: 0,
        maxValue: 100,
        automationRate: "k-rate",
      },
      {
        name: "humanize",
        defaultValue: 0,
        minValue: 0,
        maxValue: 1,
        automationRate: "k-rate",
      },
      {
        name: "vibrato",
        defaultValue: 0,
        minValue: -1,
        maxValue: 1,
        automationRate: "k-rate",
      },
      {
        name: "tracking",
        defaultValue: 1,
        minValue: 0,
        maxValue: 1,
        automationRate: "k-rate",
      },
      {
        name: "formant",
        defaultValue: 0,
        minValue: 0,
        maxValue: 1,
        automationRate: "k-rate",
      },
      {
        name: "transpose",
        defaultValue: 0,
        minValue: -12,
        maxValue: 12,
        automationRate: "k-rate",
      },
    ];
  }

  constructor() {
    super();
    this.cbiL = new Float32Array(N);
    this.cbiR = new Float32Array(N);
    this.cboL = new Float32Array(N);
    this.cboR = new Float32Array(N);
    this.fragL = new Float32Array(N);
    this.fragR = new Float32Array(N);
    /** PSOLA grain snapshot (separate from Fairbanks frag — D5b crossfade). */
    this.psolaL = new Float32Array(N);
    this.psolaR = new Float32Array(N);
    this.cbiwr = 0;
    this.cbord = 0;

    this.hann = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      this.hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
    }

    this._yinScratch = new Float32Array(N2);
    this._yinD = new Float32Array(N2);
    this._yinCmnd = new Float32Array(N2);

    this._on = true;
    this._key = 0;
    this._scale = "major";
    this._customPcs = DEFAULT_CUSTOM.slice();
    this._midiFollow = false;
    this._midiNotes = [];
    this._viz = true;
    this._empty = null;

    this.phasein = 0;
    this.phaseout = 0;
    this.inphinc = AREF / sampleRate;
    this._inphincTgt = this.inphinc;
    this.outphinc = this.inphinc;
    this.phincfact = 1;
    this._phincSlew = 1;
    /** Target pitch ratio R* = hz(committedWant)/hz(lockedDet); chased in process. */
    this._rStar = 1;
    /** Prefer fresh PSOLA grain after note commit (single buffer — no slap). */
    this._commitRecapture = false;
    this._commitRecaptureMs = 0;
    this.fragsize = 0;
    /** Input ring index of last analysis pitch mark (PSOLA grain center). */
    this._pitchMark = 0;
    /** Half-length of last snapped PSOLA grain (samples); 0 = none. */
    this._psolaHalf = 0;
    /** Analysis period used for that grain. */
    this._psolaPeIn = 64;
    /** Smoothed PSOLA COLA scale — unsmoothed peOut/peIn pumped on soft R* chase. */
    this._psolaOla = 0.7;
    /** Sticky want (clarity hysteresis) — gate slews toward this. */
    this._psolaWant = false;
    /** Sticky Fairbanks/PSOLA path — hysteresis avoids hard-switch clicks. */
    this._psolaPath = false;
    /** 0..1 Fairbanks→PSOLA crossfade (sample-rate smoothed). */
    this._psolaGate = 0;
    /** ms since arm/re-voice — PSOLA blocked until PSOLA_ONSET_MS. */
    this._psolaOnsetMs = 0;
    /** Previous analysis PE for stability check. */
    this._psolaPePrev = 0;
    this._psolaPeStable = 0;
    /**
     * Hold R=1 after arm (no gain duck). Formant mode stays here until PSOLA
     * is carrying; Fairbanks-only releases after a short PE settle.
     */
    this._onsetUnity = false;
    this._onsetUnityMs = 0;

    this._detMidi = 60;
    this._tgtMidi = 60;
    this._outMidi = 60;
    this._corrMidi = 60;
    /** Locked input pitch for ratio denominator (stays_locked). */
    this._lockedDet = 60;
    /** Committed snapped target for ratio numerator (hold-gated). */
    this._committedWant = 60;
    /** Scale/MIDI target note for hysteresis (sticky until real commit). */
    this._committedTgt = 60;
    /** Nearest scale target for *current* det — do-no-harm guardrail. */
    this._naturalTgt = 60;
    this._holdCand = 60;
    this._holdAccumMs = 0;
    /** True while waiting for hold before a note commit. */
    this._pendingHold = false;
    this._noteLocked = false;
    this._havePitch = false;
    this._voiced = false;
    this._clarity = 0;
    /** Smoothed detector confidence (clarity × multipitch penalty). */
    this._pitchConf = 0;
    /**
     * Hysteretic wet enable from confidence. Continuous conf→wet gain
     * comb-filtered latency-dry vs pitched OLA (stretch + clicks).
     */
    this._confWetOpen = true;
    /** Accumulated ms with conf < LO while gate open (close debounce). */
    this._confWetLowMs = 0;
    this._ambiguous = false;
    /** Brief soft speed floor after ambiguous (reverb) frames. */
    this._reverbSoftMs = 0;
    this._stable = 0;
    this._armed = false;
    this._everLocked = false;
    this._olaGain = 0;
    /** 0 = latency dry · 1 = corrected wet — always slewed (never hard-cut). */
    this._wetMix = 0;
    this._unvoicedN = 0;
    this._analysisRms = 0;
    /** Sustained low-RMS: close wet before full UNVOICED_DROP (edge ring). */
    this._edgeQuiet = false;
    this._edgeQuietMs = 0;
    this._speedMs = 0;
    /** Speed after Humanize sustain stretch — drives ratio chase. */
    this._effSpeedMs = 0;
    this._vibrato = 0;
    /** ms since last note commit (Humanize sustain gate). */
    this._noteAgeMs = 0;
    /** Slow det center for Natural Vibrato residual. */
    this._vibCenter = 60;
    /** |d pitch / dt| (st/s), smoothed — portamento vs stationary. */
    this._pitchVel = 0;
    this._prevRawVel = 60;
    this._haveRawVel = false;
    /** ms with pitchVel under STABLE_VEL (DPW-style critical time). */
    this._stablePitchMs = 0;
    /** Slewed want base — prevents soft pops from hop-to-hop boundary jumps. */
    this._wantBaseSlew = 60;
    /** Re-arm after silence — softer first correction under soft+PSOLA. */
    this._coldStart = false;
    this._coldStartMs = 0;
    /** ms of post-commit soft speed floor (rapid runs). */
    this._commitSoftMs = 0;
    /**
     * Soft+PSOLA: Retune Speed slews this toward sticky want (per-sample).
     * Robot snaps. Avoids R*-jump + fact-chase double staircase.
     */
    this._audibleWant = 60;
    /** Target for audible want (committedWant + natural-vibrato offset). */
    this._wantTgt = 60;
    this._formant = 0;
    this._vizTick = 0;
    this._warmup = N;
    this._detectDt = DETECT_EVERY / sampleRate;
    this._hpCoeff = Math.exp((-2 * Math.PI * 120) / sampleRate);
    this._fMin = F_MIN_DEFAULT;
    this._fMax = F_MAX_DEFAULT;
    this._inputType = "altoTenor";
    this._buildAnnounced = false;

    this._vizDet = new Float32Array(VIZ_BINS);
    this._vizTgt = new Float32Array(VIZ_BINS);
    this._vizOut = new Float32Array(VIZ_BINS);
    this._vizDet.fill(midiToNorm(60));
    this._vizTgt.fill(midiToNorm(60));
    this._vizOut.fill(midiToNorm(60));

    this.port.onmessage = (ev) => {
      const d = ev.data || {};
      if (d.type === "midi") {
        this._midiNotes = Array.isArray(d.notes) ? d.notes : [];
        return;
      }
      if (d.type !== "config") return;
      if (typeof d.on === "boolean") this._on = d.on;
      if (typeof d.key === "number") this._key = ((d.key % 12) + 12) % 12;
      if (typeof d.scale === "string") this._scale = d.scale;
      if (Array.isArray(d.customPcs)) {
        this._customPcs = d.customPcs.filter((n) => n >= 0 && n <= 11);
      }
      if (typeof d.midiFollow === "boolean") this._midiFollow = d.midiFollow;
      if (typeof d.viz === "boolean") this._viz = d.viz;
      if (typeof d.inputType === "string" && INPUT_HZ[d.inputType]) {
        this._inputType = d.inputType;
        this._fMin = INPUT_HZ[d.inputType].fMin;
        this._fMax = INPUT_HZ[d.inputType].fMax;
      }
    };
  }

  /** Fold octave errors into the selected input-type band. */
  _foldIntoRange(midi) {
    const lo = hzToMidi(this._fMin);
    const hi = hzToMidi(this._fMax);
    let m = midi;
    let guard = 0;
    while (m > hi + 0.5 && m - 12 >= lo - 0.5 && guard++ < 4) m -= 12;
    guard = 0;
    while (m < lo - 0.5 && m + 12 <= hi + 0.5 && guard++ < 4) m += 12;
    return m;
  }

  _emptyInput(n) {
    if (!this._empty || this._empty.length !== n)
      this._empty = new Float32Array(n);
    return this._empty;
  }

  _pushViz(det, tgt, out) {
    this._vizDet.copyWithin(0, 1);
    this._vizTgt.copyWithin(0, 1);
    this._vizOut.copyWithin(0, 1);
    this._vizDet[VIZ_BINS - 1] = midiToNorm(det);
    this._vizTgt[VIZ_BINS - 1] = midiToNorm(tgt);
    this._vizOut[VIZ_BINS - 1] = midiToNorm(out);
    if (!this._viz) return;
    const a = this._vizDet.slice();
    const b = this._vizTgt.slice();
    const xa = this._vizOut.slice();
    this.port.postMessage({ type: "viz", n: VIZ_BINS, a, b, xa }, [
      a.buffer,
      b.buffer,
      xa.buffer,
    ]);
  }

  _readMonoWindow(into) {
    const n = into.length;
    let idx = this.cbiwr - n;
    if (idx < 0) idx += N;
    const R = this._hpCoeff;
    let hp = 0;
    let prev = 0;
    let sumSq = 0;
    for (let i = 0; i < n; i++) {
      const j = (idx + i) % N;
      const x = 0.5 * (this.cbiL[j] + this.cbiR[j]);
      if (i === 0) {
        prev = x;
        hp = 0;
      } else {
        hp = R * (hp + x - prev);
        prev = x;
      }
      const w = 0.35 + 0.65 * (i / (n - 1 || 1));
      const y = hp * w;
      into[i] = y;
      sumSq += y * y;
    }
    this._analysisRms = Math.sqrt(sumSq / n);
  }

  /** Snap R* (Fairbanks / robot). Soft-PSOLA leaves phincfact to chase. */
  _seedPhases(rStar) {
    const r = Math.max(FACT_MIN, Math.min(FACT_MAX, rStar));
    this._rStar = r;
    this.phincfact = r;
    this._phincSlew = r;
  }

  /** Arm / re-voice: set period targets without clicking mid-buffer. */
  _setUnityPhases(midi) {
    const hz = midiToHz(midi);
    const inc = hz / sampleRate;
    this._inphincTgt = inc;
    this.inphinc = inc;
    this.outphinc = inc;
    this.phincfact = 1;
    this._phincSlew = 1;
  }

  /** True when formant mode + soft (effective) speed — ratio may glide across notes. */
  _softPsola() {
    return this._formant >= 0.5 && this._effSpeedMs >= 0.5;
  }

  /**
   * Auto-Tune Humanize: keep Retune Speed for attacks/short notes; stretch it
   * on the sustained portion of longer notes.
   */
  _effectiveSpeed(speedMs, humanize) {
    let spd = Math.max(0, speedMs);
    if (this._formant >= 0.5 && spd >= 0.5) {
      // Cold: taper floor → base speed over COLD_START_MS (no cliff at expiry).
      if (this._coldStart) {
        const u = Math.min(1, this._coldStartMs / COLD_START_MS);
        const floor = COLD_START_SPEED_FLOOR_MS * (1 - u) + spd * u;
        if (floor > spd) spd = floor;
      }
      // Rapid-run commits: brief floor so each note isn't a 25ms staircase.
      if (this._commitSoftMs > 0 && spd < COMMIT_SOFT_FLOOR_MS) {
        spd = COMMIT_SOFT_FLOOR_MS;
      }
      if (this._reverbSoftMs > 0 && spd < REVERB_SOFT_FLOOR_MS) {
        spd = REVERB_SOFT_FLOOR_MS;
      }
    }
    const h = Math.max(0, Math.min(1, humanize));
    if (h < 0.001 || this._noteAgeMs <= HUMANIZE_SUSTAIN_MS) return spd;
    const sustain = Math.min(
      1,
      (this._noteAgeMs - HUMANIZE_SUSTAIN_MS) / HUMANIZE_RAMP_MS,
    );
    return spd + h * sustain * HUMANIZE_EXTRA_MS;
  }

  /** Mark note-commit: refresh grain in-place ASAP (never dual-place). */
  _beginCommitRecapture() {
    this._commitRecapture = true;
    this._commitRecaptureMs = 0;
  }

  _clearCommitRecapture() {
    this._commitRecapture = false;
    this._commitRecaptureMs = 0;
  }

  /** Snap locked det → scale/MIDI want (amount + flex). */
  _wantFromDet(det, amount, flexCents, transpose) {
    const scalePcs = scalePcsOf(this._scale, this._customPcs);
    let tgt;
    if (this._midiFollow && this._midiNotes.length > 0) {
      tgt = nearestMidiNote(det, this._midiNotes) + transpose;
    } else {
      tgt = nearestScaleMidi(det, this._key, scalePcs) + transpose;
    }
    const err = tgt - det;
    const absErr = Math.abs(err);
    const flexSemi = Math.max(0, flexCents) / 100;
    const amt = Math.max(0, Math.min(1, amount));
    let pull = err;
    if (absErr <= flexSemi) pull = 0;
    else pull = err - Math.sign(err) * flexSemi;
    const want = det + pull * amt;
    return { tgt, want };
  }

  /**
   * Autotune-style: keep sticky scale target until raw is clearly closer to
   * another note (hysteresis). Nearest-neighbor alone flip-flops at midpoints.
   * (l used vib-center here and lagged scoops — retarget stays on live pitch.)
   */
  _shouldRetarget(rawMidi, amount, flexCents, transpose) {
    // Reverb multipitch / octave rival: don't chase a new neighbor.
    if (this._ambiguous || this._pitchConf < CONF_RETARGET) return false;
    const fresh = this._wantFromDet(rawMidi, amount, flexCents, transpose);
    const sticky = this._committedTgt;
    if (Math.abs(fresh.tgt - sticky) < 0.25) return false;
    const dSticky = Math.abs(rawMidi - sticky);
    const dFresh = Math.abs(rawMidi - fresh.tgt);
    // Stronger hysteresis when confidence is merely OK (verby).
    const hyst = RETUNE_HYST_SEMI + (1 - Math.min(1, this._pitchConf)) * 0.28;
    return dFresh + hyst < dSticky;
  }

  _commitWant(det, amount, flexCents, transpose) {
    const c = this._wantFromDet(det, amount, flexCents, transpose);
    this._committedWant = c.want;
    this._committedTgt = c.tgt;
    this._tgtMidi = c.tgt;
    this._corrMidi = c.want;
    return c;
  }

  /**
   * Do-no-harm: corrected pitch must never be more off-key than dry vs the note
   * the dry pitch actually belongs to, and must stay on the det↔want segment
   * (no pull past the correction target). Soft lag + sticky-old-want was
   * yanking past the recording toward a stale note — this forbids that.
   */
  _guardRatio(inHz, fact, detMidi, wantMidi, naturalTgt) {
    if (!(inHz > 1e-6) || !(fact > 1e-6)) return 1;
    let out = hzToMidi(inHz * fact);

    // Stay between dry and correction target (no overshoot past want)
    let lo = Math.min(detMidi, wantMidi);
    let hi = Math.max(detMidi, wantMidi);
    if (out < lo) out = lo;
    if (out > hi) out = hi;

    // Never worse than dry relative to the natural scale note for this det
    const nat = naturalTgt;
    const maxErr = Math.abs(detMidi - nat);
    if (Math.abs(out - nat) > maxErr + 1e-4) {
      lo = Math.min(detMidi, nat);
      hi = Math.max(detMidi, nat);
      if (out < lo) out = lo;
      if (out > hi) out = hi;
    }

    let f = midiToHz(out) / inHz;
    if (f < FACT_MIN) f = FACT_MIN;
    if (f > FACT_MAX) f = FACT_MAX;
    return f;
  }

  /**
   * Note commit: stays_locked + hysteretic hold.
   * Sticky tgt until raw clearly prefers another note; R* always tracks
   * hz(committedWant)/hz(liveDet). Do-no-harm clamp applied in process().
   */
  _applyCorrection(rawMidi, amount, speedMs, flexCents, transpose, vibrato) {
    const dtMs = this._detectDt * 1000;
    // Pitch velocity — mild seasoning only (see HOLD_* / boundary follow).
    if (!this._haveRawVel) {
      this._prevRawVel = rawMidi;
      this._haveRawVel = true;
      this._pitchVel = 0;
      this._stablePitchMs = 0;
    } else {
      const dSt =
        Math.abs(rawMidi - this._prevRawVel) /
        Math.max(1e-4, this._detectDt);
      this._pitchVel += (dSt - this._pitchVel) * 0.4;
      this._prevRawVel = rawMidi;
      if (this._pitchVel < STABLE_VEL_ST_S) this._stablePitchMs += dtMs;
      else this._stablePitchMs = 0;
    }
    const isStable = this._stablePitchMs >= STABLE_PITCH_MS;
    const isGesture = this._pitchVel >= GESTURE_VEL_ST_S;
    // Vib-center for boundary soften / stays widen — not for retarget lag.
    const pitchSoft =
      this._noteAgeMs > VIB_CENTER_MS * 0.35 ? this._vibCenter : rawMidi;

    let needHold = holdMsForSpeed(speedMs, this._coldStart, this._pitchConf);
    if (isStable) needHold *= HOLD_STABLE_SCALE;
    else if (isGesture) needHold *= HOLD_GESTURE_SCALE;
    let justCommitted = false;

    if (!this._noteLocked) {
      this._lockedDet = rawMidi;
      this._holdCand = rawMidi;
      this._holdAccumMs = 0;
      this._pendingHold = false;
      this._noteLocked = true;
      this._commitWant(rawMidi, amount, flexCents, transpose);
      justCommitted = true;
    } else if (this._pendingHold) {
      // Reverb: freeze hold clock while ambiguous — abort→recommit clicked.
      if (this._ambiguous || this._pitchConf < CONF_RETARGET * 0.9) {
        this._lockedDet += (rawMidi - this._lockedDet) * 0.1;
      } else if (Math.abs(rawMidi - this._holdCand) <= STAYS_LOCKED_SEMI) {
        this._holdCand += (rawMidi - this._holdCand) * 0.4;
        this._holdAccumMs += dtMs;
        // Live det still tracks so R* keeps output on sticky want
        this._lockedDet += (rawMidi - this._lockedDet) * 0.25;
        if (this._holdAccumMs >= needHold) {
          this._lockedDet = this._holdCand;
          this._holdAccumMs = 0;
          this._pendingHold = false;
          this._commitWant(this._lockedDet, amount, flexCents, transpose);
          justCommitted = true;
        }
      } else if (this._shouldRetarget(rawMidi, amount, flexCents, transpose)) {
        // New candidate wins — restart hold
        this._holdCand = rawMidi;
        this._holdAccumMs = dtMs;
        this._lockedDet += (rawMidi - this._lockedDet) * 0.25;
      } else {
        // Drifted but sticky still wins — cancel hold
        this._pendingHold = false;
        this._holdAccumMs = 0;
        this._lockedDet += (rawMidi - this._lockedDet) * 0.15;
      }
    } else if (
      Math.abs(pitchSoft - this._committedTgt) <= STAYS_LOCKED_SEMI ||
      Math.abs(rawMidi - this._lockedDet) <= STAYS_LOCKED_SEMI
    ) {
      // Near sticky: slow det track — rough vocals were pumping R* via lockedDet.
      const detA = isGesture ? 0.22 : 0.08;
      this._lockedDet += (rawMidi - this._lockedDet) * detA;
      this._tgtMidi = this._committedTgt;
      // Always allow retarget (l gated on stable||gesture → mid-zone starvation).
      if (this._shouldRetarget(rawMidi, amount, flexCents, transpose)) {
        this._holdCand = rawMidi;
        this._holdAccumMs = dtMs;
        this._pendingHold = true;
      }
    } else if (this._shouldRetarget(rawMidi, amount, flexCents, transpose)) {
      this._holdCand = rawMidi;
      this._holdAccumMs = dtMs;
      this._pendingHold = true;
      this._lockedDet += (rawMidi - this._lockedDet) * 0.25;
    } else {
      // Outside stays window but sticky still preferred — ease det, keep want
      const detA = isGesture ? 0.22 : 0.1;
      this._lockedDet += (rawMidi - this._lockedDet) * detA;
      this._tgtMidi = this._committedTgt;
    }

    const det = this._lockedDet;
    this._detMidi = det;
    this._corrMidi = this._committedWant;
    const tgt = this._committedTgt;
    this._tgtMidi = tgt;
    // Full-snap natural target for current det (amount=1, flex=0) — guardrail ref
    this._naturalTgt = this._wantFromDet(det, 1, 0, transpose).tgt;

    // Note age + vibrato center (Humanize / Natural Vibrato)
    if (justCommitted) {
      this._noteAgeMs = 0;
      this._vibCenter = det;
      this._wantBaseSlew = this._committedWant;
      this._stablePitchMs = 0;
    } else {
      this._noteAgeMs += dtMs;
      const vibA = 1 - Math.exp(-this._detectDt / (VIB_CENTER_MS / 1000));
      this._vibCenter += (det - this._vibCenter) * vibA;
    }

    // Post-commit: pull sticky want onto scale center while stationary.
    // Gestures / pending holds skip — that's scoop territory (anti-shake).
    if (
      !justCommitted &&
      !this._pendingHold &&
      !isGesture &&
      isStable &&
      this._noteAgeMs >= CENTER_LOCK_AGE_MS
    ) {
      const residCents =
        Math.abs(this._committedWant - this._committedTgt) * 100;
      if (residCents > 0.25 && residCents <= 50) {
        const u = Math.min(
          1,
          (this._noteAgeMs - CENTER_LOCK_AGE_MS) / 55,
        );
        this._committedWant +=
          (this._committedTgt - this._committedWant) *
          (CENTER_WANT_PULL * u);
      }
    }

    // Want base: sticky + hold pre-glide. Boundary soften only on directed
    // scoops — rough sustains near ±30–40¢ must stay hard on sticky (anti-shake).
    let wantBase = this._committedWant;
    if (this._pendingHold && this._holdAccumMs > 0 && !justCommitted) {
      const cand = this._wantFromDet(
        this._holdCand,
        amount,
        flexCents,
        transpose,
      );
      const u = Math.min(1, this._holdAccumMs / Math.max(8, needHold));
      const u2 = u * u;
      wantBase =
        this._committedWant + (cand.want - this._committedWant) * u2;
    } else if (
      !justCommitted &&
      this._noteLocked &&
      (isGesture || this._pitchVel >= SCOOP_VEL_ST_S)
    ) {
      const dSticky = Math.abs(rawMidi - this._committedTgt);
      if (dSticky > BOUNDARY_FOLLOW_SEMI) {
        const u = Math.min(
          1,
          (dSticky - BOUNDARY_FOLLOW_SEMI) / BOUNDARY_FOLLOW_SPAN,
        );
        const amt = isGesture
          ? BOUNDARY_FOLLOW_AMT
          : BOUNDARY_FOLLOW_AMT * 0.65;
        wantBase =
          this._committedWant + (det - this._committedWant) * u * amt;
      }
    } else if (
      !justCommitted &&
      isStable &&
      !isGesture &&
      this._noteAgeMs >= CENTER_LOCK_AGE_MS
    ) {
      // Stationary park: bias want onto integer center (closes the loose gap).
      wantBase +=
        (this._committedTgt - wantBase) * CENTER_WANT_BIAS;
    }

    // Slew wantBase (boundary hop jumps were soft-popping).
    if (justCommitted) {
      this._wantBaseSlew = wantBase;
    } else {
      let a = WANT_BASE_SLEW_STABLE;
      if (isGesture) a = WANT_BASE_SLEW_GESTURE;
      else if (isStable && this._noteAgeMs >= CENTER_LOCK_AGE_MS) a = 0.3;
      this._wantBaseSlew += (wantBase - this._wantBaseSlew) * a;
    }

    // Natural Vibrato: −1 flatten … 0 leave … +1 amplify AC residual onto want
    const vibAmt = Math.max(-1, Math.min(1, vibrato));
    const vibSemi = det - this._vibCenter;
    const wantEff = this._wantBaseSlew + vibSemi * vibAmt;
    // Confidence ducks wet amount in process() — do not bend want/R* here.
    this._wantTgt = wantEff;
    // Soft+PSOLA slews _audibleWant in process(); robot snaps here.
    if (!(this._formant >= 0.5 && this._speedMs >= 0.5)) {
      this._audibleWant = wantEff;
    }
    this._corrMidi = this._audibleWant;

    // R* from audible want (soft: lags sticky want at Retune Speed)
    const inHz = midiToHz(det);
    const outHz = midiToHz(this._audibleWant);
    let rStar = outHz / Math.max(1e-12, inHz);
    if (rStar < FACT_MIN) rStar = FACT_MIN;
    if (rStar > FACT_MAX) rStar = FACT_MAX;
    this._rStar = rStar;

    if (justCommitted) {
      if (this._formant >= 0.5) {
        this._beginCommitRecapture();
        if (this._speedMs >= 0.5) {
          this._commitSoftMs = COMMIT_SOFT_MS;
          // Keep audible want where it was — Retune Speed glides to the new note.
        } else {
          this._audibleWant = wantEff;
        }
      } else {
        this._clearCommitRecapture();
        this._psolaHalf = 0;
        this._audibleWant = wantEff;
      }
      // Seed from *base* speed — Humanize must not turn a robot commit into a glide.
      if (!(this._formant >= 0.5 && this._speedMs >= 0.5))
        this._seedPhases(this._rStar);
    }

    this._inphincTgt = inHz / sampleRate;
    this.inphinc = this._inphincTgt;
    // outphinc updated in process from live inphinc * phincSlew
    const outMidi = hzToMidi(inHz * this.phincfact);
    this._outMidi = outMidi;
    return { det, tgt, out: outMidi };
  }

  _lowRate(amount, speedMs, flexCents, tracking, transpose, humanize, vibrato) {
    if (this._warmup > 0) {
      this._warmup -= DETECT_EVERY;
      this.phincfact = 1;
      this._phincSlew = 1;
      return;
    }

    this._readMonoWindow(this._yinScratch);
    const { f0, clarity, confidence, ambiguous } = yinPitch(
      this._yinScratch,
      sampleRate,
      this._fMin,
      this._fMax,
      this._yinD,
      this._yinCmnd,
    );
    this._clarity = clarity;
    this._ambiguous = !!ambiguous;
    // EMA confidence — reverb chatters frame-to-frame
    const confInst = f0 > 0 ? confidence : clarity * 0.3;
    if (!this._havePitch) this._pitchConf = confInst;
    else this._pitchConf += (confInst - this._pitchConf) * 0.28;
    if (ambiguous) this._reverbSoftMs = REVERB_SOFT_MS;
    // Hysteresis + debounce close: room reflections dip conf for a hop or two —
    // don't flash dry mid-vowel. Reopen is still immediate above HI.
    const dtMs = this._detectDt * 1000;
    if (this._confWetOpen) {
      if (this._pitchConf < CONF_WET_LO) {
        this._confWetLowMs += dtMs;
        if (this._confWetLowMs >= CONF_WET_CLOSE_MS) {
          this._confWetOpen = false;
          this._confWetLowMs = 0;
        }
      } else {
        this._confWetLowMs = 0;
      }
    } else if (this._pitchConf > CONF_WET_HI) {
      this._confWetOpen = true;
      this._confWetLowMs = 0;
    }

    const gate = 0.14 + (1 - Math.max(0, Math.min(1, tracking))) * 0.5;
    const loudEnough = this._analysisRms >= RMS_GATE;
    // Phrase-end ring: wet stayed open until UNVOICED_DROP (~450 ms). Debounce
    // quiet so consonants don't flash dry, then force wantWet→0 in process().
    if (!loudEnough) {
      this._edgeQuietMs += this._detectDt * 1000;
      if (this._edgeQuietMs >= EDGE_QUIET_MS) this._edgeQuiet = true;
    } else {
      this._edgeQuietMs = 0;
      this._edgeQuiet = false;
    }
    // Voiced vs unvoiced uses clarity. Confidence only damps trust/retarget —
    // routing ambiguous frames as unvoiced yanked R*→1 and clicked.

    let det = this._detMidi;
    let tgt = this._tgtMidi;
    let out = this._outMidi;

    if (loudEnough && clarity >= gate && f0 > 0) {
      let midi = this._foldIntoRange(hzToMidi(f0));
      if (this._havePitch) {
        midi = octaveLock(midi, this._lockedDet || this._detMidi);
        midi = this._foldIntoRange(midi);
        const jump = Math.abs(midi - (this._lockedDet || this._detMidi));
        if (jump > MAX_JUMP_SEMI) {
          this._stable = Math.max(0, this._stable - 2);
          midi = this._lockedDet || this._detMidi;
        } else {
          this._stable++;
          const trust = Math.max(
            0.12,
            Math.min(1, (this._pitchConf - gate) / 0.4),
          );
          const prev = this._lockedDet || this._detMidi;
          midi = prev + (midi - prev) * (0.15 + 0.85 * trust);
        }
      } else {
        if (this._stable === 0) {
          this._detMidi = midi;
          this._lockedDet = midi;
          this._corrMidi = midi;
          this._stable = 1;
        } else if (Math.abs(midi - this._detMidi) <= 1.5) {
          this._detMidi += (midi - this._detMidi) * 0.5;
          midi = this._detMidi;
          this._stable++;
        } else {
          this._detMidi = midi;
          this._stable = 1;
        }
        midi = this._detMidi;
        if (this._stable >= STABLE_NEED) {
          this._havePitch = true;
          this._armed = true;
          this._lockedDet = midi;
          this._noteLocked = true;
          this._holdCand = midi;
          this._holdAccumMs = 0;
          this._pendingHold = false;
          // Clean onset: unity ratio until PE settles — never duck olaGain (that gated)
          this._commitWant(midi, amount, flexCents, transpose);
          this._setUnityPhases(midi); // lock inphinc/outphinc to *this* note before OLA runs
          this._seedPhases(1);
          this.phasein = 0;
          this.phaseout = 0;
          this.fragsize = 0;
          this._onsetUnity = true;
          this._onsetUnityMs = 0;
          this._psolaOnsetMs = 0;
          this._psolaWant = false;
          this._psolaGate = 0;
          this._psolaHalf = 0;
          this._psolaPeStable = 0;
          this._psolaPePrev = 0;
          this._psolaOla = 0.7;
          this._psolaPath = false;
          // Bare riff/run after silence — soften first audible correction
          this._coldStart = true;
          this._coldStartMs = 0;
          this._commitSoftMs = 0;
          this._beginCommitRecapture();
          this._noteAgeMs = 0;
          this._vibCenter = midi;
          this._audibleWant = midi;
          this._wantTgt = midi;
          this._wantBaseSlew = midi;
          this._haveRawVel = false;
          this._pitchVel = 0;
          this._stablePitchMs = 0;
        }
      }

      this._voiced = true;
      this._unvoicedN = 0;
      if (this._armed) {
        this._psolaOnsetMs += this._detectDt * 1000;
      }

      if (this._armed) {
        this._everLocked = true;
        const c = this._applyCorrection(
          midi,
          amount,
          speedMs,
          flexCents,
          transpose,
          vibrato,
        );
        det = c.det;
        tgt = c.tgt;
        out = c.out;
      } else {
        this._setUnityPhases(midi);
        det = midi;
        this._detMidi = midi;
        tgt =
          nearestScaleMidi(
            midi,
            this._key,
            scalePcsOf(this._scale, this._customPcs),
          ) + transpose;
        this._tgtMidi = tgt;
        out = midi;
      }
    } else if (loudEnough && this._armed && this._havePitch) {
      // Still energy but weak clarity: hold last lock — do not unvoice (R*→1 clicked).
      this._voiced = true;
      this._unvoicedN = Math.max(0, this._unvoicedN - 1);
      this._psolaOnsetMs += this._detectDt * 1000;
      const midi = this._lockedDet;
      const c = this._applyCorrection(
        midi,
        amount,
        speedMs,
        flexCents,
        transpose,
        vibrato,
      );
      det = c.det;
      tgt = c.tgt;
      out = c.out;
    } else {
      this._voiced = false;
      this._unvoicedN++;
      this._clarity *= 0.9;
      this._stable = Math.max(0, this._stable - 1);
      this.phincfact += (1 - this.phincfact) * 0.04;
      this._phincSlew += (this.phincfact - this._phincSlew) * 0.04;
      this.outphinc =
        this.inphinc * Math.max(FACT_MIN, Math.min(FACT_MAX, this.phincfact));
      if (this._unvoicedN >= UNVOICED_DROP) {
        this._armed = false;
        this._havePitch = false;
        this._noteLocked = false;
        this._pendingHold = false;
        this._holdAccumMs = 0;
        this._psolaHalf = 0;
        this._psolaWant = false;
        this._psolaGate = 0;
        this._psolaOnsetMs = 0;
        this._psolaPeStable = 0;
        this._psolaPePrev = 0;
        this._psolaPath = false;
        this._clearCommitRecapture();
        this._noteAgeMs = 0;
        this._coldStart = false;
        this._coldStartMs = 0;
        this._commitSoftMs = 0;
        this._reverbSoftMs = 0;
        this._haveRawVel = false;
        this._pitchVel = 0;
        this._stablePitchMs = 0;
        this._pitchConf = 0;
        this._confWetOpen = true;
        this._confWetLowMs = 0;
        this._edgeQuiet = false;
        this._edgeQuietMs = 0;
        this._onsetUnity = false;
        this._onsetUnityMs = 0;
        // Stop synthesizing at the *previous* phrase's period across the gap.
        // Leaving everLocked/phases live was the ab_12.1 octave-down onset.
        this._everLocked = false;
        this.fragsize = 0;
        this.phasein = 0;
        this.phaseout = 0;
        this.phincfact = 1;
        this._phincSlew = 1;
        this._rStar = 1;
        // Don't cbo.fill(0) here — hard silence under a live read clicks.
        // _wetMix slews to 0; priming resumes on next arm.
      }
      tgt =
        nearestScaleMidi(
          det,
          this._key,
          scalePcsOf(this._scale, this._customPcs),
        ) + transpose;
      this._tgtMidi = tgt;
      out = det;
    }

    this._updatePsolaWant();

    this._vizTick++;
    if (this._vizTick >= VIZ_EVERY) {
      this._vizTick = 0;
      this._pushViz(det, tgt, this._armed && this._voiced ? out : det);
    }
  }

  /** Clarity hysteresis so PSOLA doesn't chatter at consonant edges. */
  _updatePsolaWant() {
    if (this._formant < 0.5 || !this._armed) {
      this._psolaWant = false;
      return;
    }
    // Keep PSOLA open across note-commit recapture (don't drop to Fairbanks slap).
    if (this._commitRecapture && this._psolaHalf >= 8) {
      this._psolaWant = true;
      return;
    }
    // Onset grace — low octaves glitch if PSOLA grabs before PE settles
    if (this._psolaOnsetMs < PSOLA_ONSET_MS) {
      this._psolaWant = false;
      return;
    }
    const inHz = midiToHz(this._lockedDet);
    const clarityOn =
      PSOLA_CLARITY_ON + (inHz < PSOLA_LOW_HZ ? PSOLA_LOW_CLARITY_BONUS : 0);
    if (
      this._voiced &&
      this._clarity >= clarityOn &&
      this._psolaPeStable >= PSOLA_PE_STABLE_NEED
    ) {
      this._psolaWant = true;
    } else if (!this._voiced || this._clarity < PSOLA_CLARITY_OFF) {
      this._psolaWant = false;
    }
  }

  _captureFrag() {
    const ti2 = this.cbiwr - N2;
    for (let ti = -N2; ti < N2; ti++) {
      const src = (((ti + ti2) % N) + N) % N;
      const dst = (((ti + N) % N) + N) % N;
      this.fragL[dst] = this.cbiL[src];
      this.fragR[dst] = this.cbiR[src];
    }
  }

  _clampPe(pe) {
    if (pe < 16) return 16;
    if (pe > N2 - 4) return N2 - 4;
    return pe;
  }

  /** Snapshot ~2·PE grain into psolaL/R (Fairbanks keeps frag[] for crossfade). */
  _capturePsolaGrain(peIn) {
    const half = Math.min(N2 - 2, Math.floor(peIn));
    if (half < 8) {
      this._psolaHalf = 0;
      return;
    }
    const mark = this._pitchMark;
    for (let i = -half; i < half; i++) {
      const src = (((mark + i) % N) + N) % N;
      const dst = ((i % N) + N) % N;
      this.psolaL[dst] = this.cbiL[src];
      this.psolaR[dst] = this.cbiR[src];
    }
    this._psolaHalf = half;
    this._psolaPeIn = peIn;
    if (this._commitRecapture) this._clearCommitRecapture();
  }

  /**
   * Analysis period: always refresh Fairbanks frag. PSOLA grains:
   *  - trusted refresh when PE is stable
   *  - provisional refresh on interval jumps while already in PSOLA (keep formants)
   * Never clear half on a mere PE step — that dumped large leaps to Fairbanks.
   * Reject grains whose PE disagrees with live inphinc (octave / period errors).
   */
  _onAnalysisPeriod() {
    const nominal = (((this.cbiwr - N2) % N) + N) % N;
    const inHz = midiToHz(this._lockedDet);
    const peIn = this._clampPe(
      sampleRate / Math.max(this._fMin, Math.min(this._fMax, inHz)),
    );

    this._pitchMark = nominal;
    this._captureFrag();

    let peRel = 0;
    if (this._psolaPePrev > 0) {
      peRel = Math.abs(peIn - this._psolaPePrev) / this._psolaPePrev;
      if (peRel < 0.08) this._psolaPeStable++;
      else this._psolaPeStable = 0;
    } else {
      this._psolaPeStable = 0;
    }
    this._psolaPePrev = peIn;

    // Live period from phase — must agree with PE or PSOLA opens an octave off
    // (second dip in ab_12.1 @ ~+100ms after arm, when PSOLA_ONSET_MS expires).
    const livePe = this.inphinc > 1e-6 ? this._clampPe(1 / this.inphinc) : peIn;
    const peVsLive = Math.abs(peIn - livePe) / Math.max(livePe, 1);
    const peMatchesLive = peVsLive < 0.18;

    const voicedOk =
      this._formant >= 0.5 &&
      this._voiced &&
      this._clarity >= PSOLA_CLARITY_OFF &&
      peMatchesLive;

    // Steady-state: refresh when PE stable. Commit-recapture: first live-matched
    // grain in-place (single buffer — dual old+new OLA was the slap/delay).
    if (voicedOk && this._commitRecapture && peMatchesLive) {
      this._capturePsolaGrain(peIn);
    } else if (voicedOk && this._psolaPeStable >= PSOLA_PE_STABLE_NEED) {
      this._capturePsolaGrain(peIn);
    } else if (
      !this._voiced ||
      this._clarity < PSOLA_CLARITY_OFF ||
      !peMatchesLive
    ) {
      if (
        !(this._psolaWant && this._psolaHalf >= 8 && peRel <= PSOLA_PE_KEEP_REL)
      ) {
        this._psolaHalf = 0;
      }
      // else: keep last grain across the leap
    }
  }

  /** Fairbanks: resample fragment by phincfact (formants move with pitch). */
  _placeFragFairbanks(scale) {
    if (scale < 0.001) {
      this.fragsize = 0;
      return;
    }
    let fragsize = this.fragsize * 2;
    if (fragsize > N) fragsize = N;
    this.fragsize = 0;

    const fact = this._phincSlew;
    let ti3 = (fragsize / Math.max(0.5, fact)) | 0;
    if (ti3 >= N2) ti3 = N2 - 1;
    if (ti3 < 16) return;

    const ti2 = this.cbord + N2;
    const half = (ti3 / 2) | 0;
    for (let ti = -half; ti < half; ti++) {
      const hIdx = N2 + (((ti * N) / ti3) | 0);
      const tf = this.hann[((hIdx % N) + N) % N] * scale;
      const indd = fact * ti;
      const valdL = cubicAt(this.fragL, indd);
      const valdR = cubicAt(this.fragR, indd);
      const dst = (((ti + ti2) % N) + N) % N;
      this.cboL[dst] += valdL * tf;
      this.cboR[dst] += valdR * tf;
    }
  }

  /**
   * Period PSOLA: place last snapped ~2·PE grain with no resample.
   * Synthesis hop from phaseout; COLA ≈ peOut/peIn; `scale` for D5b crossfade.
   */
  _placeFragPsola(scale) {
    const half = this._psolaHalf;
    if (half < 8 || scale < 0.001) return;

    const peInGrain = this._clampPe(this._psolaPeIn);
    const livePe =
      this.inphinc > 1e-6 ? this._clampPe(1 / this.inphinc) : peInGrain;
    const fact = Math.max(FACT_MIN, Math.min(FACT_MAX, this._phincSlew));
    // While waiting for a post-commit grain, do NOT pitch-shift the stale
    // vowel (old grain × new R* = slap/delay). Exception: cold soft chase
    // runs under dry — allow real fact so the silent chase is primed.
    const useFact =
      this._commitRecapture && !(this._coldStart && this._speedMs >= 0.5)
        ? 1
        : fact;
    const peOut = this._clampPe(livePe / Math.max(FACT_MIN, useFact));
    const dstCenter = this.cbord + N2;
    const olaT = Math.max(0.45, Math.min(1.05, peOut / Math.max(livePe, 1)));
    this._psolaOla += (olaT - this._psolaOla) * 0.04;
    const ola = this._psolaOla * scale;

    for (let i = -half; i < half; i++) {
      const w = (0.5 - 0.5 * Math.cos((Math.PI * (i + half)) / half)) * ola;
      const dst = (((dstCenter + i) % N) + N) % N;
      const src = ((i % N) + N) % N;
      this.cboL[dst] += this.psolaL[src] * w;
      this.cboR[dst] += this.psolaR[src] * w;
    }
  }

  _placeFrag() {
    if (this._formant < 0.5) {
      this._psolaPath = false;
      this._placeFragFairbanks(1);
      return;
    }
    const g = this._psolaGate;
    const halfOk = this._psolaHalf >= 8;
    if (!halfOk) this._psolaPath = false;
    else if (g >= 0.58) this._psolaPath = true;
    else if (g < 0.38) this._psolaPath = false;
    if (!this._psolaPath) {
      this._placeFragFairbanks(1);
      return;
    }
    this.fragsize = 0;
    this._placeFragPsola(1);
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!output || !output[0]) return true;

    if (!this._buildAnnounced) {
      this._buildAnnounced = true;
      try {
        this.port.postMessage({ type: "build", build: CENTINEL_BUILD });
      } catch {
        /* port closed */
      }
    }

    const outL = output[0];
    const outR = output[1] || output[0];
    const n = outL.length;
    const inL = (input && input[0]) || this._emptyInput(n);
    const inR = (input && input[1]) || inL;
    const stereo = outR !== outL;
    const mix0 = parameters.mix[0];
    const amount = parameters.amount[0];
    const speed = parameters.speed[0];
    const flex = parameters.flex[0];
    const humanize = parameters.humanize[0];
    const vibrato = parameters.vibrato[0];
    const tracking = parameters.tracking[0];
    const transpose = parameters.transpose[0];
    this._speedMs = Math.max(0, speed);
    this._vibrato = vibrato;
    this._effSpeedMs = this._effectiveSpeed(this._speedMs, humanize);
    this._formant = parameters.formant[0];
    if (this._formant < 0.5) this._psolaWant = false;

    // Ratio chase: effective Retune Speed (Humanize may stretch on sustains).
    // Robot snaps. Fairbanks = within-note only. Soft+PSOLA = full chase.
    const spd = this._effSpeedMs;
    let ratioAlpha = 1;
    if (spd >= 0.5) {
      const tauSamp = Math.max(1, (spd / 1000) * sampleRate);
      ratioAlpha = 1 - Math.exp(-1 / tauSamp);
    }
    // Tiny ease after snaps so placeFrag doesn't zipper (~0.5 ms)
    const slewAlpha = 1 - Math.exp(-1 / Math.max(1, 0.0005 * sampleRate));
    const gateAlpha =
      1 - Math.exp(-1 / Math.max(1, (PSOLA_GATE_MS / 1000) * sampleRate));
    const wetXfadeMs = (() => {
      // Phrase-end: close wet fast (ring was loud vs dry).
      if (this._edgeQuiet) return EDGE_WET_XFADE_MS;
      let ms = WET_XFADE_MS;
      if (this._coldStart && this._formant >= 0.5 && this._speedMs >= 0.5) {
        ms = Math.max(ms, COLD_WET_XFADE_MS);
      }
      // Conf gate closed, or mid dry↔wet: slower fade (avoids click/comb chatter).
      if (!this._confWetOpen || (this._wetMix > 0.02 && this._wetMix < 0.98)) {
        ms = Math.max(ms, CONF_WET_XFADE_MS);
      }
      return ms;
    })();
    const wetXfadeAlpha =
      1 - Math.exp(-1 / Math.max(1, (wetXfadeMs / 1000) * sampleRate));
    const softPsola = this._formant >= 0.5 && spd >= 0.5;
    // Default: Retune Speed through note transitions. Stationary + near center
    // → finish last cents faster (closes ≤15¢ gap vs AT without scoop shake).
    let wantChaseMs = spd;
    if (
      softPsola &&
      spd >= 0.5 &&
      this._noteAgeMs >= CENTER_LOCK_AGE_MS &&
      this._stablePitchMs >= STABLE_PITCH_MS &&
      this._commitSoftMs <= 0 &&
      this._pitchVel < SCOOP_VEL_ST_S &&
      !this._commitRecapture &&
      !this._coldStart &&
      !this._onsetUnity &&
      !this._pendingHold
    ) {
      const audErrCents =
        Math.abs(this._audibleWant - this._committedTgt) * 100;
      const glideErrCents =
        Math.abs(this._wantTgt - this._audibleWant) * 100;
      if (
        audErrCents <= CENTER_LOCK_CENTS &&
        glideErrCents <= CENTER_LOCK_SETTLE_CENTS
      ) {
        wantChaseMs = Math.min(wantChaseMs, CENTER_LOCK_SPEED_MS);
      }
    }
    const wantAlpha =
      softPsola && wantChaseMs >= 0.5
        ? 1 - Math.exp(-1 / Math.max(1, (wantChaseMs / 1000) * sampleRate))
        : 1;

    for (let i = 0; i < n; i++) {
      const xl = inL[i] || 0;
      const xr = inR[i] || 0;

      this.cbiL[this.cbiwr] = xl;
      this.cbiR[this.cbiwr] = xr;

      if (this.cbiwr % DETECT_EVERY === 0) {
        this._lowRate(
          amount,
          speed,
          flex,
          tracking,
          transpose,
          humanize,
          vibrato,
        );
      }

      const dryIdx = (((this.cbiwr - N2) % N) + N) % N;
      const dryL = this.cbiL[dryIdx];
      const dryR = this.cbiR[dryIdx];

      if (this._on) {
        this.inphinc = this._inphincTgt;

        const gateT =
          this._formant >= 0.5 && this._psolaWant && this._psolaHalf >= 8
            ? 1
            : 0;
        this._psolaGate += (gateT - this._psolaGate) * gateAlpha;

        if (this._commitRecapture) {
          this._commitRecaptureMs += 1000 / sampleRate;
          if (this._commitRecaptureMs >= COMMIT_RECAPTURE_MS) {
            this._clearCommitRecapture();
          }
        }

        if (this._coldStart) {
          this._coldStartMs += 1000 / sampleRate;
          if (this._coldStartMs >= COLD_START_MS) {
            this._coldStart = false;
          }
        }
        if (this._commitSoftMs > 0) {
          this._commitSoftMs -= 1000 / sampleRate;
          if (this._commitSoftMs < 0) this._commitSoftMs = 0;
        }
        if (this._reverbSoftMs > 0) {
          this._reverbSoftMs -= 1000 / sampleRate;
          if (this._reverbSoftMs < 0) this._reverbSoftMs = 0;
        }

        // Soft+PSOLA: Retune Speed owns want glide (per-sample). Robot snaps in lowRate.
        if (softPsola && !this._onsetUnity) {
          this._audibleWant += (this._wantTgt - this._audibleWant) * wantAlpha;
          const inHzA = Math.max(1e-12, this.inphinc * sampleRate);
          let rA = midiToHz(this._audibleWant) / inHzA;
          if (rA < FACT_MIN) rA = FACT_MIN;
          if (rA > FACT_MAX) rA = FACT_MAX;
          this._rStar = rA;
          this._corrMidi = this._audibleWant;
        }

        if (this._onsetUnity) {
          this.phincfact = 1;
          this._phincSlew = 1;
          this.outphinc = this.inphinc;
          this._audibleWant = this._lockedDet;
          this._wantTgt = this._lockedDet;
          this._onsetUnityMs += 1000 / sampleRate;

          const formantOn = this._formant >= 0.5;
          const psolaReady =
            formantOn &&
            this._psolaGate >= ONSET_PSOLA_READY &&
            this._psolaHalf >= 8;
          const fairbanksReady =
            !formantOn &&
            this._onsetUnityMs >= ONSET_UNITY_MS &&
            (this._psolaPeStable >= PSOLA_PE_STABLE_NEED ||
              this._onsetUnityMs >= ONSET_UNITY_MS * 2);
          const timedOut = this._onsetUnityMs >= ONSET_UNITY_MAX_MS;

          if (psolaReady || fairbanksReady || timedOut) {
            this._onsetUnity = false;
            const inHz = midiToHz(this._lockedDet);
            let r = midiToHz(this._committedWant) / Math.max(1e-12, inHz);
            if (r < FACT_MIN) r = FACT_MIN;
            if (r > FACT_MAX) r = FACT_MAX;
            this._rStar = r;
            // Soft+PSOLA: always ease from unity (never dump R* on a cold entrance).
            // Robot / Fairbanks: snap. Chase may run under dry until cold wet opens.
            if (
              softPsola ||
              (formantOn && this._coldStart && this._speedMs >= 0.5)
            ) {
              this.phincfact = 1;
              this._phincSlew = 1;
              this._beginCommitRecapture();
            } else {
              this.phincfact = r;
              this._phincSlew = r;
            }
          }
        } else if (
          this._commitRecapture &&
          this._formant >= 0.5 &&
          !(this._coldStart && this._speedMs >= 0.5)
        ) {
          // Stale grain still up — hold unity (pitching it caused the slap/delay).
          // Skip during cold soft chase: we stay on dry while R* eases in.
          this.phincfact = 1;
          this._phincSlew = 1;
          this.outphinc = this.inphinc;
        } else {
          const cur = Math.max(1e-6, this.phincfact);
          const ratioCents = (1200 * Math.log(this._rStar / cur)) / Math.LN2;
          if (spd < 0.5 || softPsola) {
            // Soft: want already glides at Retune Speed — lock ratio to R* (tiny slew below).
            this.phincfact = this._rStar;
          } else if (Math.abs(ratioCents) > WITHIN_NOTE_SOFT_CENTS) {
            this.phincfact = this._rStar;
          } else {
            this.phincfact += (this._rStar - this.phincfact) * ratioAlpha;
          }
          if ((this.phincfact - this._rStar) * (cur - this._rStar) < 0) {
            this.phincfact = this._rStar;
          }
          const inHzG = this.inphinc * sampleRate;
          this.phincfact = this._guardRatio(
            inHzG,
            this.phincfact,
            this._lockedDet,
            this._corrMidi,
            this._naturalTgt,
          );
          this._phincSlew += (this.phincfact - this._phincSlew) * slewAlpha;
          this._phincSlew = this._guardRatio(
            inHzG,
            this._phincSlew,
            this._lockedDet,
            this._corrMidi,
            this._naturalTgt,
          );
          this.outphinc = this.inphinc * this._phincSlew;
        }

        if (!(this.inphinc > 1e-6) || !(this.inphinc < 0.5)) {
          this.inphinc = AREF / sampleRate;
        }
        if (!(this.outphinc > 1e-6) || !(this.outphinc < 0.5)) {
          this.outphinc = this.inphinc;
        }

        // Corrected wet only after onset unity ends — slew, never hard-cut.
        // Cold soft+PSOLA: keep latency-dry until chase is close so bare riffs
        // don't audition the detect-rate staircase into the first note.
        // Conf: hysteretic open/closed only — continuous conf gain comb-filtered.
        // Edge quiet: close wet before UNVOICED_DROP so OLA doesn't ring past dry.
        let wantWet = 0;
        if (
          this._armed &&
          this._everLocked &&
          !this._onsetUnity &&
          this._confWetOpen &&
          !this._edgeQuiet
        ) {
          wantWet = 1;
          if (
            this._coldStart &&
            this._formant >= 0.5 &&
            this._speedMs >= 0.5
          ) {
            const cents = Math.abs(this._wantTgt - this._audibleWant) * 100;
            const open =
              1 - (cents - COLD_WET_CENTS * 0.4) / (COLD_WET_CENTS * 1.2);
            wantWet = open < 0 ? 0 : open > 1 ? 1 : open;
          }
        }
        this._wetMix += (wantWet - this._wetMix) * wetXfadeAlpha;
        if (this._wetMix < 0.001) this._wetMix = 0;
        if (this._wetMix > 0.999) this._wetMix = 1;

        if (this._edgeQuiet) {
          this._olaGain += (0 - this._olaGain) * 0.12;
        } else if (this._everLocked || this._onsetUnity) {
          this._olaGain += (1 - this._olaGain) * 0.04;
          if (this._olaGain > 0.999) this._olaGain = 1;
        } else {
          this._olaGain += (0 - this._olaGain) * 0.05;
        }

        // Prime / run OLA whenever we might need wet soon (armed or fading)
        const runOla =
          this._armed ||
          this._onsetUnity ||
          this._wetMix > 0.001 ||
          this._olaGain > 0.001;
        if (runOla) {
          this.phasein += this.inphinc;
          this.phaseout += this.outphinc;

          if (this.phasein >= 1) {
            this.phasein -= Math.floor(this.phasein);
            if (this.phasein < 0 || this.phasein >= 1) this.phasein = 0;
            this._onAnalysisPeriod();
          }

          if (this.phaseout >= 1) {
            this.phaseout -= Math.floor(this.phaseout);
            if (this.phaseout < 0 || this.phaseout >= 1) this.phaseout = 0;
            this._placeFrag();
          }
          this.fragsize++;
          if (this.fragsize > N) this.fragsize = N;
        }
      } else {
        this._phincSlew = 1;
        this.phincfact = 1;
        this._rStar = 1;
        this.fragsize = 0;
        this._psolaHalf = 0;
        this._psolaWant = false;
        this._psolaGate = 0;
        this._psolaOnsetMs = 0;
        this._psolaPeStable = 0;
        this._psolaPath = false;
        this._clearCommitRecapture();
        this._noteAgeMs = 0;
        this._coldStart = false;
        this._coldStartMs = 0;
        this._commitSoftMs = 0;
        this._reverbSoftMs = 0;
        this._haveRawVel = false;
        this._pitchVel = 0;
        this._stablePitchMs = 0;
        this._pitchConf = 0;
        this._confWetOpen = true;
        this._confWetLowMs = 0;
        this._edgeQuiet = false;
        this._edgeQuietMs = 0;
        this._onsetUnity = false;
        this._onsetUnityMs = 0;
        this._armed = false;
        this._stable = 0;
        this._everLocked = false;
        this._noteLocked = false;
        this._pendingHold = false;
        this._holdAccumMs = 0;
        this._olaGain += (0 - this._olaGain) * 0.05;
        this._wetMix += (0 - this._wetMix) * wetXfadeAlpha;
        this.phasein = 0;
        this.phaseout = 0;
      }

      let wetL = this.cboL[this.cbord];
      let wetR = this.cboR[this.cbord];
      this.cboL[this.cbord] = 0;
      this.cboR[this.cbord] = 0;

      const lim = 1.5;
      if (wetL > lim) wetL = lim;
      else if (wetL < -lim) wetL = -lim;
      if (wetR > lim) wetR = lim;
      else if (wetR < -lim) wetR = -lim;

      // Soft dry↔wet: _wetMix is the anti-click layer; olaGain covers first-lock fade.
      const wm = this._wetMix * this._olaGain;
      let shiftedL;
      let shiftedR;
      if (wm < 0.001) {
        shiftedL = dryL;
        shiftedR = dryR;
      } else if (wm > 0.999) {
        shiftedL = wetL;
        shiftedR = wetR;
      } else {
        shiftedL = dryL * (1 - wm) + wetL * wm;
        shiftedR = dryR * (1 - wm) + wetR * wm;
      }

      const mix = this._on ? mix0 : 0;
      if (mix < 0.0001) {
        outL[i] = dryL;
        if (stereo) outR[i] = dryR;
      } else if (mix > 0.995) {
        outL[i] = shiftedL;
        if (stereo) outR[i] = shiftedR;
      } else {
        outL[i] = dryL * (1 - mix) + shiftedL * mix;
        if (stereo) outR[i] = dryR * (1 - mix) + shiftedR * mix;
      }

      this.cbiwr++;
      if (this.cbiwr >= N) this.cbiwr = 0;
      this.cbord++;
      if (this.cbord >= N) this.cbord = 0;
    }
    return true;
  }
}

registerProcessor("ain-centinel", AinCentinelProcessor);
