// Centinel — monophonic pitch corrector (Fairbanks / optional PSOLA).
// YIN f0 → Phase B stays_locked+hold commit → scale snap → Phase C ratio chase → OLA.
// formant ≥ 0.5 → period PSOLA; else Fairbanks. humanize inert.
//
// Circular buffers N=2048; latency = N/2.

const N = 2048;
const N2 = N >> 1;
const NOVERLAP = 4;
const DETECT_EVERY = N / NOVERLAP;
const F_MIN = 80;
const F_MAX = 700;
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
/** Hold before committing a new note (ms). Short enough for pop; not stacked-hard. */
const HOLD_MS = 18;

const SCALE_PCS = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};
const DEFAULT_CUSTOM = [0, 2, 4, 5, 7, 9, 11];

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
    if (cmnd[t2] <= cmnd[tau] * 1.08) tau = t2;
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
    this.outphinc = this.inphinc;
    this.phincfact = 1;
    this._phincSlew = 1;
    /** Target pitch ratio R* = hz(committedWant)/hz(lockedDet); chased in process. */
    this._rStar = 1;
    this.fragsize = 0;
    /** Input write index at last period mark (PSOLA grain center). */
    this._pitchMark = 0;

    this._detMidi = 60;
    this._tgtMidi = 60;
    this._outMidi = 60;
    this._corrMidi = 60;
    /** Locked input pitch for ratio denominator (stays_locked). */
    this._lockedDet = 60;
    /** Committed snapped target for ratio numerator (hold-gated). */
    this._committedWant = 60;
    this._holdCand = 60;
    this._holdAccumMs = 0;
    /** True while waiting for HOLD_MS before a note commit. */
    this._pendingHold = false;
    this._noteLocked = false;
    this._havePitch = false;
    this._voiced = false;
    this._clarity = 0;
    this._stable = 0;
    this._armed = false;
    this._everLocked = false;
    this._olaGain = 0;
    this._unvoicedN = 0;
    this._analysisRms = 0;
    this._speedMs = 0;
    this._formant = 0;
    this._vizTick = 0;
    this._warmup = N;
    this._detectDt = DETECT_EVERY / sampleRate;
    this._hpCoeff = Math.exp((-2 * Math.PI * 120) / sampleRate);

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
    };
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

  _setUnityPhases(midi) {
    const hz = midiToHz(midi);
    this.inphinc = hz / sampleRate;
    this.outphinc = this.inphinc;
    this.phincfact = 1;
    this._phincSlew = 1;
  }

  /**
   * On note commit: always snap ratio. Fairbanks moves formants with pitch ratio —
   * chasing R* across a note change sounds like a vowel diphthong.
   * Soft speed only eases *small* within-note corrections in process().
   */
  _seedPhases(rStar) {
    const r = Math.max(FACT_MIN, Math.min(FACT_MAX, rStar));
    this._rStar = r;
    this.phincfact = r;
    this._phincSlew = r;
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
   * Phase B — stays_locked + hold.
   * committedWant is STICKY until a real note commit.
   * Pending hold FREEZES lockedDet + R* (OLA keeps running — no dry↔wet stutter).
   * Phase C — soft speed chases R* while locked on the same note.
   */
  _applyCorrection(rawMidi, amount, speedMs, flexCents, transpose) {
    const dtMs = this._detectDt * 1000;
    let justCommitted = false;

    if (!this._noteLocked) {
      this._lockedDet = rawMidi;
      this._holdCand = rawMidi;
      this._holdAccumMs = 0;
      this._pendingHold = false;
      this._noteLocked = true;
      const first = this._wantFromDet(rawMidi, amount, flexCents, transpose);
      this._committedWant = first.want;
      this._tgtMidi = first.tgt;
      justCommitted = true;
    } else if (Math.abs(rawMidi - this._lockedDet) <= STAYS_LOCKED_SEMI) {
      this._lockedDet += (rawMidi - this._lockedDet) * 0.15;
      this._holdCand = this._lockedDet;
      this._holdAccumMs = 0;
      this._pendingHold = false;
      const held = this._wantFromDet(this._lockedDet, amount, flexCents, transpose);
      this._tgtMidi = held.tgt;
      if (Math.abs(held.want - this._committedWant) > 0.55) {
        this._holdCand = rawMidi;
        this._holdAccumMs = dtMs;
        this._pendingHold = true;
      }
    } else if (Math.abs(rawMidi - this._holdCand) <= STAYS_LOCKED_SEMI) {
      this._holdCand += (rawMidi - this._holdCand) * 0.4;
      this._holdAccumMs += dtMs;
      this._pendingHold = true;
      if (this._holdAccumMs >= HOLD_MS) {
        this._lockedDet = this._holdCand;
        this._holdAccumMs = 0;
        this._pendingHold = false;
        const c = this._wantFromDet(this._lockedDet, amount, flexCents, transpose);
        this._committedWant = c.want;
        this._tgtMidi = c.tgt;
        justCommitted = true;
      }
    } else {
      this._holdCand = rawMidi;
      this._holdAccumMs = dtMs;
      this._pendingHold = true;
    }

    const det = this._lockedDet;
    this._detMidi = det;
    this._corrMidi = this._committedWant;
    const tgt = this._tgtMidi;

    const inHz = midiToHz(det);
    // Pending: freeze R* (don't retarget mid-hold). OLA keeps going — no dry gate.
    if (!this._pendingHold) {
      const outHz = midiToHz(this._committedWant);
      let rStar = outHz / Math.max(1e-12, inHz);
      if (rStar < FACT_MIN) rStar = FACT_MIN;
      if (rStar > FACT_MAX) rStar = FACT_MAX;
      this._rStar = rStar;
    }

    if (justCommitted) {
      this._seedPhases(this._rStar);
    }

    this.inphinc = inHz / sampleRate;
    this.outphinc = this.inphinc * this.phincfact;
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
      F_MIN,
      F_MAX,
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
      let midi = hzToMidi(f0);
      if (this._havePitch) {
        midi = octaveLock(midi, this._lockedDet || this._detMidi);
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
          this._committedWant = midi;
          this._noteLocked = true;
          this._holdCand = midi;
          this._holdAccumMs = 0;
          this._pendingHold = false;
          this._corrMidi = midi;
        }
      }

      this._voiced = true;
      this._unvoicedN = 0;

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
      }
      tgt = nearestScaleMidi(det, this._key, scalePcsOf(this._scale, this._customPcs)) + transpose;
      this._tgtMidi = tgt;
      out = det;
    }

    this._vizTick++;
    if (this._vizTick >= VIZ_EVERY) {
      this._vizTick = 0;
      this._pushViz(det, tgt, this._armed && this._voiced ? out : det);
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

  /** Fairbanks: resample fragment by phincfact (formants move with pitch). */
  _placeFragFairbanks() {
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
      const tf = this.hann[((hIdx % N) + N) % N];
      const indd = fact * ti;
      const valdL = cubicAt(this.fragL, indd);
      const valdR = cubicAt(this.fragR, indd);
      const dst = ((ti + ti2) % N + N) % N;
      this.cboL[dst] += valdL * tf;
      this.cboR[dst] += valdR * tf;
    }
  }

  /**
   * Period PSOLA (zita-at2-style): grain ~2·PE_in from a delayed pitch mark
   * (never the write head — that reads wrap garbage and sounds like noise).
   * No resample → formants stay; hop = peOut; gain × peOut/peIn for COLA.
   */
  _placeFragPsola() {
    this.fragsize = 0;
    const inHz = midiToHz(this._lockedDet);
    let peIn = sampleRate / Math.max(F_MIN, Math.min(F_MAX, inHz));
    if (peIn < 16) peIn = 16;
    if (peIn > N2 - 4) peIn = N2 - 4;
    const fact = Math.max(FACT_MIN, Math.min(FACT_MAX, this._phincSlew));
    let peOut = peIn / fact;
    if (peOut < 16) peOut = 16;
    if (peOut > N2 - 4) peOut = N2 - 4;

    const grainLen = Math.min(N - 2, Math.floor(2 * peIn));
    const half = grainLen >> 1;
    if (half < 8) return;

    // Always look back into settled input (same region Fairbanks captures)
    const srcCenter = ((this.cbiwr - N2) % N + N) % N;
    const dstCenter = this.cbord + N2;
    // Pitch-up packs more grains → scale down so overlaps don't clip/harsh
    const ola = Math.max(0.25, Math.min(1.25, peOut / peIn));
    for (let i = -half; i < half; i++) {
      const w = (0.5 - 0.5 * Math.cos((Math.PI * (i + half)) / half)) * ola;
      const src = ((srcCenter + i) % N + N) % N;
      const dst = ((dstCenter + i) % N + N) % N;
      this.cboL[dst] += this.cbiL[src] * w;
      this.cboR[dst] += this.cbiR[src] * w;
    }
  }

  _placeFrag() {
    // Hard switch only when clearly engaged — avoids accidental PSOLA from tiny knob moves
    if (this._formant >= 0.5) this._placeFragPsola();
    else this._placeFragFairbanks();
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!output || !output[0]) return true;

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

    // Soft speed: chase only small ratio errors. Large jumps snap — Fairbanks
    // formants ride the ratio, so a long chase reads as a vowel diphthong.
    const spd = this._speedMs;
    let ratioAlpha = 1;
    if (spd >= 0.5) {
      const tauSamp = Math.max(1, (spd / 1000) * sampleRate);
      ratioAlpha = 1 - Math.exp(-1 / tauSamp);
    }
    // Tiny ease after snaps so placeFrag doesn't zipper (~0.5 ms)
    const slewAlpha = 1 - Math.exp(-1 / Math.max(1, 0.0005 * sampleRate));
    const FORMANT_SNAP_CENTS = 40;

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
        const cur = Math.max(1e-6, this.phincfact);
        const ratioCents = (1200 * Math.log(this._rStar / cur)) / Math.LN2;
        if (spd < 0.5 || Math.abs(ratioCents) > FORMANT_SNAP_CENTS) {
          this.phincfact = this._rStar;
        } else {
          this.phincfact += (this._rStar - this.phincfact) * ratioAlpha;
        }
        this._phincSlew += (this.phincfact - this._phincSlew) * slewAlpha;
        this.outphinc = this.inphinc * this._phincSlew;

        if (!(this.inphinc > 1e-6) || !(this.inphinc < 0.5)) {
          this.inphinc = AREF / sampleRate;
        }
        if (!(this.outphinc > 1e-6) || !(this.outphinc < 0.5)) {
          this.outphinc = this.inphinc;
        }

        if (this._everLocked) {
          this._olaGain += (1 - this._olaGain) * 0.04;
          if (this._olaGain > 0.999) this._olaGain = 1;
        } else {
          this._olaGain += (0 - this._olaGain) * 0.01;
        }

        this.phasein += this.inphinc;
        this.phaseout += this.outphinc;

        if (this.phasein >= 1) {
          this.phasein -= Math.floor(this.phasein);
          if (this.phasein < 0 || this.phasein >= 1) this.phasein = 0;
          this._pitchMark = ((this.cbiwr - N2) % N + N) % N;
          this._captureFrag();
        }

        if (this.phaseout >= 1) {
          this.phaseout -= Math.floor(this.phaseout);
          if (this.phaseout < 0 || this.phaseout >= 1) this.phaseout = 0;
          this._placeFrag();
        }
        this.fragsize++;
        if (this.fragsize > N) this.fragsize = N;
      } else {
        this._phincSlew = 1;
        this.phincfact = 1;
        this._rStar = 1;
        this.fragsize = 0;
        this._armed = false;
        this._stable = 0;
        this._everLocked = false;
        this._noteLocked = false;
        this._pendingHold = false;
        this._holdAccumMs = 0;
        this._olaGain += (0 - this._olaGain) * 0.01;
        this.phasein = 0;
        this.phaseout = 0;
      }

      let wetL = this.cboL[this.cbord];
      let wetR = this.cboR[this.cbord];
      this.cboL[this.cbord] = 0;
      this.cboR[this.cbord] = 0;

      // Soft peak limit only — never swap wet→dry (that stuttered at grain/hop rate)
      const lim = 1.5;
      if (wetL > lim) wetL = lim;
      else if (wetL < -lim) wetL = -lim;
      if (wetR > lim) wetR = lim;
      else if (wetR < -lim) wetR = -lim;

      const g = this._olaGain;
      let shiftedL;
      let shiftedR;
      if (g > 0.995) {
        shiftedL = wetL;
        shiftedR = wetR;
      } else {
        shiftedL = dryL * (1 - g) + wetL * g;
        shiftedR = dryR * (1 - g) + wetR * g;
      }

      const mix = this._on ? mix0 : 0;
      if (mix < 0.0001 || g < 0.0001) {
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
