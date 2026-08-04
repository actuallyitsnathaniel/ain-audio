// Centinel — monophonic pitch corrector (Fairbanks / optional PSOLA).
// YIN f0 → stays_locked+hold commit → sticky want → R* = hz(want)/hz(det) → OLA.
// Soft speed: Fairbanks = within-note only; formant≥0.5 PSOLA = full ratio chase (D6).
// formant ≥ 0.5 → period PSOLA on clear vowels (hysteresis + crossfade to Fairbanks).
// humanize inert. Circular buffers N=2048; latency = N/2.
//
// Build stamp — bump when diagnosing "did the worklet reload?" (AudioWorklets do NOT HMR).
const CENTINEL_BUILD = "2026-08-04g-commit-xfade";

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

/** Silvertune-style: ignore YIN wander within this while locked (semitones). */
const STAYS_LOCKED_SEMI = 0.4;
/** Base hold before committing a new note (ms). Soft speed stretches this. */
const HOLD_MS_BASE = 18;
/**
 * Raw must beat the sticky scale target by this much (semitones) before we
 * even start a retarget hold — stops boundary flip-flops Autotune doesn't do.
 */
const RETUNE_HYST_SEMI = 0.35;
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
/** Fairbanks↔PSOLA crossfade (ms) — longer = less click at handoff. */
const PSOLA_GATE_MS = 22;
/** Release formant-mode unity once PSOLA mix is at least this high. */
const ONSET_PSOLA_READY = 0.88;
/** Dry↔corrected wet crossfade (ms). Hard cuts here were the post-fixant pops. */
const WET_XFADE_MS = 12;
/**
 * Note-commit PSOLA grain crossfade (ms). Waveform continuity only — Retune
 * Speed owns the R* chase; do not stack extra ratio easings on commit.
 */
const COMMIT_GRAIN_MS = 22;

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

/** Hold time: longer when soft so we don't commit to a wrong neighbor mid-glide. */
function holdMsForSpeed(speedMs) {
  if (!(speedMs >= 0.5)) return HOLD_MS_BASE;
  return Math.max(HOLD_MS_BASE, Math.min(90, speedMs * 0.45));
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
  if (tauMax <= tauMin + 2) return { f0: 0, clarity: 0 };

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
  if (tau >= tauMax || cmnd[tau] >= 1) return { f0: 0, clarity: 0 };

  const tau2 = tau * 2;
  if (tau2 + 1 <= tauMax) {
    let t2 = tau2;
    if (t2 > 1 && cmnd[t2 - 1] < cmnd[t2]) t2--;
    if (t2 + 1 <= tauMax && cmnd[t2 + 1] < cmnd[t2]) t2++;
    // Prefer longer period only when it is *clearly* as good — 1.08 was
    // octave-downing clean high notes (half-period trough is always deep).
    if (cmnd[t2] <= cmnd[tau] * 1.02 && cmnd[t2] < 0.1) tau = t2;
  }

  const x0 = tau > 1 ? cmnd[tau - 1] : cmnd[tau];
  const x1 = cmnd[tau];
  const x2 = tau + 1 <= tauMax ? cmnd[tau + 1] : cmnd[tau];
  const denom = 2 * (2 * x1 - x2 - x0);
  const better = denom !== 0 ? tau + (x2 - x0) / denom : tau;
  const f0 = sr / better;
  const clarity = Math.max(0, Math.min(1, 1 - cmnd[tau]));
  if (!(f0 >= fMin && f0 <= fMax)) return { f0: 0, clarity: 0 };
  return { f0, clarity };
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
      { name: "mix", defaultValue: 1, minValue: 0, maxValue: 1, automationRate: "k-rate" },
      { name: "amount", defaultValue: 1, minValue: 0, maxValue: 1, automationRate: "k-rate" },
      { name: "speed", defaultValue: 25, minValue: 0, maxValue: 400, automationRate: "k-rate" },
      { name: "flex", defaultValue: 0, minValue: 0, maxValue: 100, automationRate: "k-rate" },
      { name: "humanize", defaultValue: 0, minValue: 0, maxValue: 1, automationRate: "k-rate" },
      { name: "tracking", defaultValue: 1, minValue: 0, maxValue: 1, automationRate: "k-rate" },
      { name: "formant", defaultValue: 0, minValue: 0, maxValue: 1, automationRate: "k-rate" },
      { name: "transpose", defaultValue: 0, minValue: -12, maxValue: 12, automationRate: "k-rate" },
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
    /** Previous grain during note-commit crossfade. */
    this.psolaOldL = new Float32Array(N);
    this.psolaOldR = new Float32Array(N);
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
    /** 0 = old grain · 1 = new grain (note-commit PSOLA crossfade). */
    this._grainXfade = 1;
    /** Waiting for first stable grain after commit before raising xfade. */
    this._commitGrainPending = false;
    this._psolaOldHalf = 0;
    this._psolaOldPeIn = 64;
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
    this._stable = 0;
    this._armed = false;
    this._everLocked = false;
    this._olaGain = 0;
    /** 0 = latency dry · 1 = corrected wet — always slewed (never hard-cut). */
    this._wetMix = 0;
    this._unvoicedN = 0;
    this._analysisRms = 0;
    this._speedMs = 0;
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
    if (!this._empty || this._empty.length !== n) this._empty = new Float32Array(n);
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

  /** True when formant mode + soft speed — ratio may glide across note changes. */
  _softPsola() {
    return this._formant >= 0.5 && this._speedMs >= 0.5;
  }

  /**
   * Note-commit transition: keep placing the old PSOLA grain while a new one
   * builds, then crossfade. Pitch chase stays on Retune Speed alone.
   */
  _beginCommitGrainXfade() {
    const half = this._psolaHalf;
    if (half < 8) return;
    this.psolaOldL.set(this.psolaL);
    this.psolaOldR.set(this.psolaR);
    this._psolaOldHalf = half;
    this._psolaOldPeIn = this._psolaPeIn;
    this._grainXfade = 0;
    this._commitGrainPending = true;
    this._psolaPeStable = 0;
  }

  _clearCommitGrain() {
    this._psolaOldHalf = 0;
    this._grainXfade = 1;
    this._commitGrainPending = false;
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
   * Autotune-style: keep sticky scale target until raw is *clearly* closer to
   * another note (hysteresis). Nearest-neighbor alone flip-flops at midpoints.
   */
  _shouldRetarget(rawMidi, amount, flexCents, transpose) {
    const fresh = this._wantFromDet(rawMidi, amount, flexCents, transpose);
    const sticky = this._committedTgt;
    if (Math.abs(fresh.tgt - sticky) < 0.25) return false;
    const dSticky = Math.abs(rawMidi - sticky);
    const dFresh = Math.abs(rawMidi - fresh.tgt);
    return dFresh + RETUNE_HYST_SEMI < dSticky;
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
  _applyCorrection(rawMidi, amount, speedMs, flexCents, transpose) {
    const dtMs = this._detectDt * 1000;
    const needHold = holdMsForSpeed(speedMs);
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
      // Accumulate hold toward a candidate; don't clear on stays_locked chatter
      if (Math.abs(rawMidi - this._holdCand) <= STAYS_LOCKED_SEMI) {
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
    } else if (Math.abs(rawMidi - this._lockedDet) <= STAYS_LOCKED_SEMI) {
      this._lockedDet += (rawMidi - this._lockedDet) * 0.15;
      this._tgtMidi = this._committedTgt;
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
      this._lockedDet += (rawMidi - this._lockedDet) * 0.2;
      this._tgtMidi = this._committedTgt;
    }

    const det = this._lockedDet;
    this._detMidi = det;
    this._corrMidi = this._committedWant;
    const tgt = this._committedTgt;
    this._tgtMidi = tgt;
    // Full-snap natural target for current det (amount=1, flex=0) — guardrail ref
    this._naturalTgt = this._wantFromDet(det, 1, 0, transpose).tgt;

    // Always R* = hz(sticky want)/hz(live det)
    const inHz = midiToHz(det);
    const outHz = midiToHz(this._committedWant);
    let rStar = outHz / Math.max(1e-12, inHz);
    if (rStar < FACT_MIN) rStar = FACT_MIN;
    if (rStar > FACT_MAX) rStar = FACT_MAX;
    this._rStar = rStar;

    if (justCommitted) {
      if (this._formant >= 0.5 && this._psolaHalf >= 8) {
        this._beginCommitGrainXfade();
      } else {
        this._clearCommitGrain();
        if (this._formant < 0.5) this._psolaHalf = 0;
      }
      // Retune Speed owns R*: robot / Fairbanks snap; soft-PSOLA keeps chasing.
      if (!this._softPsola()) this._seedPhases(this._rStar);
    }

    this._inphincTgt = inHz / sampleRate;
    this.inphinc = this._inphincTgt;
    // outphinc updated in process from live inphinc * phincSlew
    const outMidi = hzToMidi(inHz * this.phincfact);
    this._outMidi = outMidi;
    return { det, tgt, out: outMidi };
  }

  _lowRate(amount, speedMs, flexCents, tracking, transpose) {
    if (this._warmup > 0) {
      this._warmup -= DETECT_EVERY;
      this.phincfact = 1;
      this._phincSlew = 1;
      return;
    }

    this._readMonoWindow(this._yinScratch);
    const { f0, clarity } = yinPitch(
      this._yinScratch,
      sampleRate,
      this._fMin,
      this._fMax,
      this._yinD,
      this._yinCmnd,
    );
    this._clarity = clarity;
    const gate = 0.14 + (1 - Math.max(0, Math.min(1, tracking))) * 0.5;
    const loudEnough = this._analysisRms >= RMS_GATE;

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
        }
      }

      this._voiced = true;
      this._unvoicedN = 0;
      if (this._armed) {
        this._psolaOnsetMs += this._detectDt * 1000;
      }

      if (this._armed) {
        this._everLocked = true;
        const c = this._applyCorrection(midi, amount, speedMs, flexCents, transpose);
        det = c.det;
        tgt = c.tgt;
        out = c.out;
      } else {
        this._setUnityPhases(midi);
        det = midi;
        this._detMidi = midi;
        tgt = nearestScaleMidi(midi, this._key, scalePcsOf(this._scale, this._customPcs)) + transpose;
        this._tgtMidi = tgt;
        out = midi;
      }
    } else {
      this._voiced = false;
      this._unvoicedN++;
      this._clarity *= 0.9;
      this._stable = Math.max(0, this._stable - 1);
      this.phincfact += (1 - this.phincfact) * 0.12;
      this._phincSlew += (this.phincfact - this._phincSlew) * 0.12;
      this.outphinc = this.inphinc * Math.max(FACT_MIN, Math.min(FACT_MAX, this.phincfact));
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
        this._clearCommitGrain();
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
      tgt = nearestScaleMidi(det, this._key, scalePcsOf(this._scale, this._customPcs)) + transpose;
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
    // Keep PSOLA open across note-commit grain crossfade (don't drop to Fairbanks).
    if (
      this._psolaOldHalf >= 8 &&
      (this._commitGrainPending || this._grainXfade < 0.999)
    ) {
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
    if (this._voiced && this._clarity >= clarityOn && this._psolaPeStable >= PSOLA_PE_STABLE_NEED) {
      this._psolaWant = true;
    } else if (!this._voiced || this._clarity < PSOLA_CLARITY_OFF) {
      this._psolaWant = false;
    }
  }

  _captureFrag() {
    const ti2 = this.cbiwr - N2;
    for (let ti = -N2; ti < N2; ti++) {
      const src = ((ti + ti2) % N + N) % N;
      const dst = ((ti + N) % N + N) % N;
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
      const src = ((mark + i) % N + N) % N;
      const dst = ((i % N) + N) % N;
      this.psolaL[dst] = this.cbiL[src];
      this.psolaR[dst] = this.cbiR[src];
    }
    this._psolaHalf = half;
    this._psolaPeIn = peIn;
    if (this._commitGrainPending) this._commitGrainPending = false;
  }

  /**
   * Analysis period: always refresh Fairbanks frag. PSOLA grains:
   *  - trusted refresh when PE is stable
   *  - provisional refresh on interval jumps while already in PSOLA (keep formants)
   * Never clear half on a mere PE step — that dumped large leaps to Fairbanks.
   * Reject grains whose PE disagrees with live inphinc (octave / period errors).
   */
  _onAnalysisPeriod() {
    const nominal = ((this.cbiwr - N2) % N + N) % N;
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
    const livePe =
      this.inphinc > 1e-6 ? this._clampPe(1 / this.inphinc) : peIn;
    const peVsLive = Math.abs(peIn - livePe) / Math.max(livePe, 1);
    const peMatchesLive = peVsLive < 0.18;

    const voicedOk =
      this._formant >= 0.5 &&
      this._voiced &&
      this._clarity >= PSOLA_CLARITY_OFF &&
      peMatchesLive;

    // Only refresh grain once PE is stable. Mid-leap provisional recapture
    // swapped the waveform under the read head and clicked on note changes.
    // Old grain + new R* still preserves formants (pitch from placement rate).
    if (voicedOk && this._psolaPeStable >= PSOLA_PE_STABLE_NEED) {
      this._capturePsolaGrain(peIn);
    } else if (!this._voiced || this._clarity < PSOLA_CLARITY_OFF || !peMatchesLive) {
      if (!(this._psolaWant && this._psolaHalf >= 8 && peRel <= PSOLA_PE_KEEP_REL)) {
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
      const dst = ((ti + ti2) % N + N) % N;
      this.cboL[dst] += valdL * tf;
      this.cboR[dst] += valdR * tf;
    }
  }

  /**
   * Period PSOLA: place last snapped ~2·PE grain with no resample.
   * Synthesis hop from phaseout; COLA ≈ peOut/peIn; `scale` for D5b crossfade.
   */
  _placeOnePsolaGrain(srcL, srcR, half, peInGrain, scale, mix) {
    if (half < 8 || scale < 0.001 || mix < 0.001) return;
    const livePe =
      this.inphinc > 1e-6 ? this._clampPe(1 / this.inphinc) : this._clampPe(peInGrain);
    const fact = Math.max(FACT_MIN, Math.min(FACT_MAX, this._phincSlew));
    const peOut = this._clampPe(livePe / fact);
    const dstCenter = this.cbord + N2;
    const olaT = Math.max(0.45, Math.min(1.05, peOut / Math.max(livePe, 1)));
    this._psolaOla += (olaT - this._psolaOla) * 0.04;
    const ola = this._psolaOla * scale * mix;

    for (let i = -half; i < half; i++) {
      const w = (0.5 - 0.5 * Math.cos((Math.PI * (i + half)) / half)) * ola;
      const dst = ((dstCenter + i) % N + N) % N;
      const src = ((i % N) + N) % N;
      this.cboL[dst] += srcL[src] * w;
      this.cboR[dst] += srcR[src] * w;
    }
  }

  _placeFragPsola(scale) {
    const g = this._grainXfade;
    const oldH = this._psolaOldHalf;
    const newH = this._psolaHalf;
    if (newH < 8 && oldH < 8) return;
    if (oldH >= 8 && g < 0.999) {
      this._placeOnePsolaGrain(
        this.psolaOldL,
        this.psolaOldR,
        oldH,
        this._psolaOldPeIn,
        scale,
        1 - g,
      );
    }
    if (newH >= 8) {
      this._placeOnePsolaGrain(
        this.psolaL,
        this.psolaR,
        newH,
        this._psolaPeIn,
        scale,
        oldH >= 8 ? g : 1,
      );
    }
  }

  _placeFrag() {
    if (this._formant < 0.5) {
      this._placeFragFairbanks(1);
      return;
    }
    const g = this._psolaGate;
    if (g < 0.02 || this._psolaHalf < 8) {
      this._placeFragFairbanks(1);
      return;
    }
    if (g > 0.98) {
      this.fragsize = 0;
      this._placeFragPsola(1);
      return;
    }
    // Mid crossfade: both into OLA (brief; hysteresis keeps this rare)
    this._placeFragFairbanks(1 - g);
    this._placeFragPsola(g);
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
    const tracking = parameters.tracking[0];
    const transpose = parameters.transpose[0];
    this._speedMs = Math.max(0, speed);
    this._formant = parameters.formant[0];
    if (this._formant < 0.5) this._psolaWant = false;

    // Ratio chase: Retune Speed is the only tau. Robot snaps. Fairbanks =
    // within-note only. Soft+PSOLA = full chase. No stacked commit easings.
    const spd = this._speedMs;
    let ratioAlpha = 1;
    if (spd >= 0.5) {
      const tauSamp = Math.max(1, (spd / 1000) * sampleRate);
      ratioAlpha = 1 - Math.exp(-1 / tauSamp);
    }
    // Tiny ease after snaps so placeFrag doesn't zipper (~0.5 ms)
    const slewAlpha = 1 - Math.exp(-1 / Math.max(1, 0.0005 * sampleRate));
    const gateAlpha = 1 - Math.exp(-1 / Math.max(1, (PSOLA_GATE_MS / 1000) * sampleRate));
    const wetXfadeAlpha = 1 - Math.exp(-1 / Math.max(1, (WET_XFADE_MS / 1000) * sampleRate));
    const grainAlpha = 1 - Math.exp(-1 / Math.max(1, (COMMIT_GRAIN_MS / 1000) * sampleRate));
    const softPsola = this._formant >= 0.5 && spd >= 0.5;

    for (let i = 0; i < n; i++) {
      const xl = inL[i] || 0;
      const xr = inR[i] || 0;

      this.cbiL[this.cbiwr] = xl;
      this.cbiR[this.cbiwr] = xr;

      if (this.cbiwr % DETECT_EVERY === 0) {
        this._lowRate(amount, speed, flex, tracking, transpose);
      }

      const dryIdx = ((this.cbiwr - N2) % N + N) % N;
      const dryL = this.cbiL[dryIdx];
      const dryR = this.cbiR[dryIdx];

      if (this._on) {
        this.inphinc = this._inphincTgt;

        const gateT =
          this._formant >= 0.5 &&
          this._psolaWant &&
          (this._psolaHalf >= 8 || this._psolaOldHalf >= 8)
            ? 1
            : 0;
        this._psolaGate += (gateT - this._psolaGate) * gateAlpha;

        // Commit grain xfade: wait for new grain, then rise 0→1
        if (this._psolaOldHalf >= 8 && !this._commitGrainPending) {
          this._grainXfade += (1 - this._grainXfade) * grainAlpha;
          if (this._grainXfade > 0.999) {
            this._grainXfade = 1;
            this._psolaOldHalf = 0;
          }
        }

        if (this._onsetUnity) {
          this.phincfact = 1;
          this._phincSlew = 1;
          this.outphinc = this.inphinc;
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
            if (formantOn && Math.abs(Math.log2(Math.max(1e-6, r))) > 0.01) {
              if (!softPsola) {
                this.phincfact = r;
                this._phincSlew = r;
              } else {
                this.phincfact = 1;
                this._phincSlew = 1;
              }
            } else if (!softPsola) {
              this.phincfact = r;
              this._phincSlew = r;
            }
          }
        } else {
          const cur = Math.max(1e-6, this.phincfact);
          const ratioCents = (1200 * Math.log(this._rStar / cur)) / Math.LN2;
          if (spd < 0.5) {
            this.phincfact = this._rStar;
          } else if (softPsola) {
            this.phincfact += (this._rStar - this.phincfact) * ratioAlpha;
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
            this._committedWant,
            this._naturalTgt,
          );
          this._phincSlew += (this.phincfact - this._phincSlew) * slewAlpha;
          this._phincSlew = this._guardRatio(
            inHzG,
            this._phincSlew,
            this._lockedDet,
            this._committedWant,
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
        // During onsetUnity we still run OLA at R=1 so the buffer is primed
        // and the crossfade lands on nearly-matched audio.
        const wantWet =
          this._armed && this._everLocked && !this._onsetUnity ? 1 : 0;
        this._wetMix += (wantWet - this._wetMix) * wetXfadeAlpha;
        if (this._wetMix < 0.001) this._wetMix = 0;
        if (this._wetMix > 0.999) this._wetMix = 1;

        if (this._everLocked || this._onsetUnity) {
          this._olaGain += (1 - this._olaGain) * 0.04;
          if (this._olaGain > 0.999) this._olaGain = 1;
        } else {
          this._olaGain += (0 - this._olaGain) * 0.05;
        }

        // Prime / run OLA whenever we might need wet soon (armed or fading)
        const runOla =
          this._armed || this._onsetUnity || this._wetMix > 0.001 || this._olaGain > 0.001;
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
        this._clearCommitGrain();
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
