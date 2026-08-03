// PINNED ARCHIVE — former Centinel (YIN + phase-vocoder STFT).
// Not registered. Kept as the seed for a future **spectral-time / smear** device
// (see SPECTRAL.md §11). Do not load as `ain-centinel`; live Centinel is TD-PSOLA
// in `centinel-processor.js`.
//
// Capabilities preserved here:
// - YIN f0 → scale / MIDI-follow snap → speed / flex / humanize / amount / tracking
// - Global β pitch shift via phase vocoder (FFT 2048/4096, hop 512/1024)
// - Optional formant preserve (spectral envelope + fine structure remap)
// - Stereo dual-channel STFT, quality remount, dry/wet vs fftSize delay
// - Auto-Tune–style scrolling pitch viz (detected / target / corrected)
//
// Why it was retired for Centinel: STFT group delay (~43–85 ms) + hop-rate
// pitch updates make hard-lock feel sluggish — fine for spectral smear /
// time-frequency morph, wrong for real-time monophonic retune.
//
// Pitch detection: YIN (de Cheveigné & Kawahara).

const PRESETS = {
  low: { fftSize: 2048, hop: 512 },
  high: { fftSize: 4096, hop: 1024 },
};

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

/** Snap detected MIDI toward the nearest held MIDI note (octave-matched). */
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

const VIZ_BINS = 96;
const MIDI_LO = 36;
const MIDI_HI = 84;
const YIN_SIZE = 1024;

function makeHann(n) {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / n));
  return w;
}

function fft(re, im, inverse) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i];
      re[i] = re[j];
      re[j] = t;
      t = im[i];
      im[i] = im[j];
      im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len;
    const wlenRe = Math.cos(ang);
    const wlenIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let wRe = 1;
      let wIm = 0;
      for (let j = 0; j < len / 2; j++) {
        const uRe = re[i + j];
        const uIm = im[i + j];
        const vRe = re[i + j + len / 2] * wRe - im[i + j + len / 2] * wIm;
        const vIm = re[i + j + len / 2] * wIm + im[i + j + len / 2] * wRe;
        re[i + j] = uRe + vRe;
        im[i + j] = uIm + vIm;
        re[i + j + len / 2] = uRe - vRe;
        im[i + j + len / 2] = uIm - vIm;
        const nRe = wRe * wlenRe - wIm * wlenIm;
        wIm = wRe * wlenIm + wIm * wlenRe;
        wRe = nRe;
      }
    }
  }
  if (inverse) {
    const inv = 1 / n;
    for (let i = 0; i < n; i++) {
      re[i] *= inv;
      im[i] *= inv;
    }
  }
}

function createChannel(fftSize, hop) {
  const half = fftSize / 2;
  return {
    inFifo: new Float32Array(fftSize),
    outFifo: new Float32Array(fftSize),
    outQueue: new Float32Array(hop),
    dryDelay: new Float32Array(fftSize),
    fill: 0,
    outRead: 0,
    outAvail: 0,
    dryIdx: 0,
    re: new Float32Array(fftSize),
    im: new Float32Array(fftSize),
    lastPhase: new Float32Array(half + 1),
    sumPhase: new Float32Array(half + 1),
    mag: new Float32Array(half + 1),
    freq: new Float32Array(half + 1),
    synMag: new Float32Array(half + 1),
    synFreq: new Float32Array(half + 1),
    env: new Float32Array(half + 1),
    synEnv: new Float32Array(half + 1),
    synFine: new Float32Array(half + 1),
  };
}

function hzToMidi(hz) {
  return 69 + (12 * Math.log(hz / 440)) / Math.LN2;
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

/** Snap candidate MIDI into ±6 semitones of `ref` (kills YIN octave flips). */
function octaveLock(midi, ref) {
  let m = midi;
  while (m - ref > 6) m -= 12;
  while (ref - m > 6) m += 12;
  return m;
}

/**
 * YIN pitch estimate. Mutates scratch d/cmnd.
 * @see de Cheveigné & Kawahara, YIN
 */
function yinPitch(buf, sr, fMin, fMax, d, cmnd) {
  const n = buf.length;
  const tauMax = Math.min(n - 2, Math.floor(sr / fMin));
  const tauMin = Math.max(2, Math.floor(sr / fMax));
  if (tauMax <= tauMin + 2) return { f0: 0, clarity: 0 };

  for (let tau = 1; tau <= tauMax; tau++) {
    let sum = 0;
    for (let i = 0; i < n - tau; i++) {
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

  const thresh = 0.15;
  let tau = tauMin;
  for (; tau <= tauMax; tau++) {
    if (cmnd[tau] < thresh) {
      while (tau + 1 <= tauMax && cmnd[tau + 1] < cmnd[tau]) tau++;
      break;
    }
  }
  if (tau >= tauMax || cmnd[tau] >= 1) return { f0: 0, clarity: 0 };

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

function fillEnvelope(mag, half, env, passes) {
  for (let k = 0; k <= half; k++) env[k] = Math.log(mag[k] + 1e-12);
  for (let p = 0; p < passes; p++) {
    let prev = env[0];
    for (let k = 1; k < half; k++) {
      const cur = env[k];
      const next = env[k + 1];
      env[k] = 0.25 * prev + 0.5 * cur + 0.25 * next;
      prev = cur;
    }
  }
  for (let k = 0; k <= half; k++) env[k] = Math.exp(env[k]);
}

/**
 * Global β pitch shift via phase vocoder.
 * `formant` 0 = formants ride pitch · 1 = keep spectral envelope.
 */
function processFrame(ch, window, fftSize, hop, pitchRatio, formant) {
  const half = fftSize / 2;
  const { re, im, lastPhase, sumPhase, mag, freq, synMag, synFreq, env, synEnv, synFine } = ch;
  const fAmt = Math.max(0, Math.min(1, formant));

  for (let i = 0; i < fftSize; i++) {
    re[i] = ch.inFifo[i] * window[i];
    im[i] = 0;
  }
  fft(re, im, false);

  const expect = (2 * Math.PI * hop) / fftSize;
  for (let k = 0; k <= half; k++) {
    const mr = re[k];
    const mi = im[k];
    const m = Math.hypot(mr, mi);
    const p = Math.atan2(mi, mr);
    let delta = p - lastPhase[k];
    lastPhase[k] = p;
    delta -= k * expect;
    const qpd = Math.round(delta / Math.PI);
    if (qpd >= 0) delta -= Math.PI * (qpd + (qpd & 1));
    else delta -= Math.PI * (qpd - (qpd & 1));
    mag[k] = m;
    freq[k] = ((k * expect + delta) * fftSize) / (2 * Math.PI * hop);
  }

  synMag.fill(0);
  synFreq.fill(0);

  if (fAmt < 0.02) {
    for (let k = 0; k <= half; k++) {
      if (mag[k] < 1e-12) continue;
      const dest = (k * pitchRatio + 0.5) | 0;
      if (dest < 0 || dest > half) continue;
      synMag[dest] += mag[k];
      synFreq[dest] = freq[k] * pitchRatio;
    }
  } else {
    fillEnvelope(mag, half, env, 5);
    synFine.fill(0);
    synEnv.fill(0);
    const formantRatio = pitchRatio + (1 - pitchRatio) * fAmt;
    for (let k = 0; k <= half; k++) {
      if (mag[k] < 1e-12) continue;
      const e = env[k] || 1e-12;
      const fine = mag[k] / e;
      const dFine = (k * pitchRatio + 0.5) | 0;
      if (dFine >= 0 && dFine <= half) {
        synFine[dFine] += fine;
        synFreq[dFine] = freq[k] * pitchRatio;
      }
      const dEnv = (k * formantRatio + 0.5) | 0;
      if (dEnv >= 0 && dEnv <= half && e > synEnv[dEnv]) synEnv[dEnv] = e;
    }
    for (let k = 0; k <= half; k++) {
      synMag[k] = synFine[k] * (synEnv[k] > 1e-12 ? synEnv[k] : 1e-12);
    }
  }

  for (let k = 0; k <= half; k++) {
    const p = sumPhase[k];
    re[k] = synMag[k] * Math.cos(p);
    im[k] = synMag[k] * Math.sin(p);
    sumPhase[k] += (2 * Math.PI * synFreq[k] * hop) / fftSize;
  }
  for (let k = 1; k < half; k++) {
    re[fftSize - k] = re[k];
    im[fftSize - k] = -im[k];
  }
  im[0] = 0;
  im[half] = 0;
  fft(re, im, true);
  for (let i = 0; i < fftSize; i++) {
    ch.outFifo[i] += re[i] * window[i];
  }
}

function identityFrame(ch, window, fftSize) {
  for (let i = 0; i < fftSize; i++) {
    const w = window[i];
    ch.outFifo[i] += ch.inFifo[i] * w * w;
  }
}

class AinCentinelProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: "mix", defaultValue: 1, minValue: 0, maxValue: 1, automationRate: "k-rate" },
      { name: "amount", defaultValue: 1, minValue: 0, maxValue: 1, automationRate: "k-rate" },
      { name: "speed", defaultValue: 40, minValue: 0, maxValue: 400, automationRate: "k-rate" },
      { name: "flex", defaultValue: 12, minValue: 0, maxValue: 100, automationRate: "k-rate" },
      { name: "humanize", defaultValue: 0.4, minValue: 0, maxValue: 1, automationRate: "k-rate" },
      { name: "tracking", defaultValue: 0.35, minValue: 0, maxValue: 1, automationRate: "k-rate" },
      { name: "formant", defaultValue: 0.7, minValue: 0, maxValue: 1, automationRate: "k-rate" },
      { name: "transpose", defaultValue: 0, minValue: -12, maxValue: 12, automationRate: "k-rate" },
    ];
  }

  constructor(options) {
    super();
    const q = (options.processorOptions && options.processorOptions.quality) || "low";
    const preset = PRESETS[q] || PRESETS.low;
    this.fftSize = preset.fftSize;
    this.hop = preset.hop;
    this.window = makeHann(this.fftSize);
    this.olaGain = (2 * this.hop) / this.fftSize;
    this.L = createChannel(this.fftSize, this.hop);
    this.R = createChannel(this.fftSize, this.hop);

    this._on = true;
    this._key = 0;
    this._scale = "major";
    this._customPcs = DEFAULT_CUSTOM.slice();
    this._midiFollow = false;
    this._midiNotes = [];
    this._viz = true;
    this._empty = null;

    this._yinBuf = new Float32Array(YIN_SIZE);
    this._yinWrite = 0;
    this._yinFilled = false;
    this._yinScratch = new Float32Array(YIN_SIZE);
    this._yinD = new Float32Array(YIN_SIZE);
    this._yinCmnd = new Float32Array(YIN_SIZE);
    this._detMidi = 60;
    this._tgtMidi = 60;
    this._outMidi = 60;
    this._centerMidi = 60;
    this._corrMidi = 60;
    this._havePitch = false;
    this._voiced = false;
    this._clarity = 0;
    this._liveRatio = 1;
    this._yinEvery = 0; // run YIN every other hop (CPU)

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
      let reset = false;
      if (typeof d.on === "boolean") {
        if (d.on !== this._on) reset = true;
        this._on = d.on;
      }
      if (typeof d.key === "number") {
        const k = ((d.key % 12) + 12) % 12;
        if (k !== this._key) reset = true;
        this._key = k;
      }
      if (typeof d.scale === "string") {
        if (d.scale !== this._scale) reset = true;
        this._scale = d.scale;
      }
      if (Array.isArray(d.customPcs)) {
        this._customPcs = d.customPcs.filter((n) => n >= 0 && n <= 11);
      }
      if (typeof d.midiFollow === "boolean") this._midiFollow = d.midiFollow;
      if (typeof d.viz === "boolean") this._viz = d.viz;
      if (reset) this._resetSynthState();
    };
  }

  _resetSynthState() {
    for (const ch of [this.L, this.R]) {
      ch.lastPhase.fill(0);
      ch.sumPhase.fill(0);
      ch.outFifo.fill(0);
      ch.outQueue.fill(0);
      ch.outAvail = 0;
      ch.outRead = 0;
    }
    this._liveRatio = 1;
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
    if (this._viz) {
      this.port.postMessage({
        type: "viz",
        n: VIZ_BINS,
        a: this._vizDet,
        b: this._vizTgt,
        xa: this._vizOut,
      });
    }
  }

  _updatePitch(amount, speedMs, flexCents, humanize, tracking, transpose) {
    const hopSec = this.hop / sampleRate;
    const scalePcs = scalePcsOf(this._scale, this._customPcs);
    const gate = 0.12 + tracking * 0.55;

    this._yinEvery++;
    const runYin = this._yinFilled && this._yinEvery % 2 === 0;

    if (runYin) {
      const tmp = this._yinScratch;
      const w = this._yinWrite;
      tmp.set(this._yinBuf.subarray(w), 0);
      tmp.set(this._yinBuf.subarray(0, w), YIN_SIZE - w);

      const { f0, clarity } = yinPitch(tmp, sampleRate, 70, 900, this._yinD, this._yinCmnd);
      this._clarity = clarity;

      if (clarity >= gate && f0 > 0) {
        let midi = hzToMidi(f0);
        if (this._havePitch) midi = octaveLock(midi, this._detMidi);
        if (!this._havePitch) {
          this._detMidi = midi;
          this._centerMidi = midi;
          this._corrMidi = midi;
          this._outMidi = midi;
          this._havePitch = true;
        } else {
          this._detMidi += (midi - this._detMidi) * 0.5;
        }
        this._voiced = true;
      } else {
        this._voiced = false;
        this._clarity *= 0.92;
      }
    }

    const det = this._detMidi;
    let tgt;
    if (this._midiFollow && this._midiNotes.length > 0) {
      tgt = nearestMidiNote(det, this._midiNotes) + transpose;
    } else {
      tgt = nearestScaleMidi(det, this._key, scalePcs) + transpose;
    }
    this._tgtMidi = tgt;

    // unvoiced → ease correction toward transpose-only (don't yank the trail)
    if (!this._voiced || this._clarity < 0.1) {
      const idle = Math.pow(2, transpose / 12);
      this._liveRatio += (idle - this._liveRatio) * 0.12;
      this._pushViz(det, tgt, this._outMidi);
      return this._liveRatio;
    }

    const errCents = (tgt - det) * 100;
    const flex = Math.max(0, flexCents);
    let pullCents = errCents;
    if (Math.abs(errCents) <= flex) pullCents = 0;
    else pullCents = errCents - Math.sign(errCents) * flex;

    const centerTau = 0.08 + humanize * 0.22;
    const cA = 1 - Math.exp(-hopSec / centerTau);
    this._centerMidi += (det - this._centerMidi) * cA;
    const vibrato = det - this._centerMidi;

    const wantCenter = this._centerMidi + (pullCents / 100) * amount;
    const spd = Math.max(0, speedMs);
    if (spd < 0.5) this._corrMidi = wantCenter;
    else {
      const a = 1 - Math.exp(-hopSec / (spd / 1000));
      this._corrMidi += (wantCenter - this._corrMidi) * a;
    }

    const outMidi = this._corrMidi + vibrato * humanize;
    this._outMidi = outMidi;
    this._pushViz(det, tgt, outMidi);

    return Math.pow(2, (outMidi - det) / 12);
  }

  _feedYin(mono) {
    this._yinBuf[this._yinWrite] = mono;
    this._yinWrite++;
    if (this._yinWrite >= YIN_SIZE) {
      this._yinWrite = 0;
      this._yinFilled = true;
    }
  }

  _step(ch, x, mix, doShift, pitchOpts, formant, isMaster) {
    const { fftSize, hop, olaGain } = this;

    const dry = ch.dryDelay[ch.dryIdx];
    ch.dryDelay[ch.dryIdx] = x;
    ch.dryIdx++;
    if (ch.dryIdx >= fftSize) ch.dryIdx = 0;

    let wet = 0;
    if (ch.outAvail > 0) {
      wet = ch.outQueue[ch.outRead] * olaGain;
      ch.outRead++;
      ch.outAvail--;
    }

    ch.inFifo[ch.fill] = x;
    ch.fill++;

    if (ch.fill >= fftSize) {
      let ratio = this._liveRatio || 1;
      if (isMaster && pitchOpts && this._on) {
        ratio = this._updatePitch(
          pitchOpts.amount,
          pitchOpts.speed,
          pitchOpts.flex,
          pitchOpts.humanize,
          pitchOpts.tracking,
          pitchOpts.transpose,
        );
        this._liveRatio = ratio;
      } else if (isMaster && !this._on) {
        this._liveRatio = 1;
        ratio = 1;
      } else {
        ratio = this._liveRatio || 1;
      }

      if (doShift && Math.abs(ratio - 1) > 0.0005) {
        processFrame(ch, this.window, fftSize, hop, ratio, formant);
      } else {
        identityFrame(ch, this.window, fftSize);
      }

      for (let i = 0; i < hop; i++) ch.outQueue[i] = ch.outFifo[i];
      ch.outRead = 0;
      ch.outAvail = hop;
      ch.inFifo.copyWithin(0, hop);
      ch.outFifo.copyWithin(0, hop);
      ch.outFifo.fill(0, fftSize - hop);
      ch.fill = fftSize - hop;
    }

    if (mix < 0.0001) return dry;
    return dry * (1 - mix) + wet * mix;
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
    const formant = parameters.formant[0];
    const pitchOpts = {
      amount: parameters.amount[0],
      speed: parameters.speed[0],
      flex: parameters.flex[0],
      humanize: parameters.humanize[0],
      tracking: parameters.tracking[0],
      transpose: parameters.transpose[0],
    };

    for (let i = 0; i < n; i++) {
      const mix = this._on ? mix0 : 0;
      const xl = inL[i] || 0;
      const xr = inR[i] || 0;
      this._feedYin(0.5 * (xl + xr));

      const doShift = this._on && mix > 0.001;
      outL[i] = this._step(this.L, xl, mix, doShift, pitchOpts, formant, true);
      if (stereo) outR[i] = this._step(this.R, xr, mix, doShift, null, formant, false);
    }
    return true;
  }
}

// Not registered — pin only. Future device might use "ain-spectral-smear".
// registerProcessor("ain-spectral-smear", AinCentinelProcessor);
