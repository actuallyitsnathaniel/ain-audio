// Impartialer — spectral partial remapper
// Phase 1: global transpose · Phase 2: in-key snap · Phase 3: force remap to scale.
// STFT/OLA helpers stay inlined for now; extract to spectral-core.js when speccomp needs them.
//
// Dry/wet mixes INSIDE the worklet against a latency-aligned dry delay so strength
// blends don't comb. Bypass still runs the delay so latency stays constant when
// toggled (neutralize-in-place).

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

function makeHann(n) {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / n));
  return w;
}

/** In-place radix-2 FFT. inverse=true → IFFT with 1/n scaling. */
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
  };
}

/** Semitone delta toward nearest in-key pitch class.
 *  snap: only move if the *rounded* pitch class is out of key AND within ±maxShift
 *        (in-key notes keep their detune / color).
 *  remap: always quantize to the nearest scale degree (including fine-tune pulls).
 */
function mapSemitones(midi, key, scalePcs, maxShift, force) {
  const pc = ((midi % 12) + 12) % 12;
  const rel = (pc - key + 12) % 12;

  let best = 0;
  let bestAbs = Infinity;
  for (let i = 0; i < scalePcs.length; i++) {
    let d = scalePcs[i] - rel;
    if (d > 6) d -= 12;
    if (d < -6) d += 12;
    const a = Math.abs(d);
    if (a < bestAbs || (a === bestAbs && Math.abs(d) < Math.abs(best))) {
      bestAbs = a;
      best = d;
    }
  }

  if (force) return best; // remap — always land on the grid

  // snap — leave in-key notes alone (even if slightly sharp/flat)
  const roundedPc = ((Math.round(midi) % 12) + 12) % 12;
  const roundedRel = (roundedPc - key + 12) % 12;
  if (scalePcs.indexOf(roundedRel) >= 0) return 0;
  const limit = Math.max(1, maxShift | 0);
  if (bestAbs > limit) return 0;
  return best;
}

/**
 * Analyze frame → optional per-bin snap/remap + global transpose → synthesize OLA.
 * `mapMode`: "off" | "snap" | "remap"
 */
function processFrame(ch, window, fftSize, hop, opts) {
  const half = fftSize / 2;
  const { re, im, lastPhase, sumPhase, mag, freq, synMag, synFreq } = ch;
  const { pitchRatio, mapMode, key, scalePcs, maxShift, sampleRate } = opts;

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

  const mapOn = mapMode === "snap" || mapMode === "remap";
  const force = mapMode === "remap";
  const binHz = sampleRate / fftSize;

  for (let k = 0; k <= half; k++) {
    if (mag[k] < 1e-12) continue;

    let ratio = pitchRatio;
    if (mapOn && k > 0) {
      let fHz = (freq[k] * sampleRate) / fftSize;
      if (!(fHz > 20 && fHz < sampleRate * 0.45)) fHz = k * binHz;
      const midi = 69 + (12 * Math.log(fHz / 440)) / Math.LN2;
      const shift = mapSemitones(midi, key, scalePcs, maxShift, force);
      if (shift !== 0) ratio *= Math.pow(2, shift / 12);
    }

    const dest = (k * ratio + 0.5) | 0;
    if (dest < 0 || dest > half) continue;
    synMag[dest] += mag[k];
    synFreq[dest] = freq[k] * ratio;
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

/** Windowed identity OLA — keeps latency when processing is off. */
function identityFrame(ch, window, fftSize) {
  for (let i = 0; i < fftSize; i++) {
    const w = window[i];
    ch.outFifo[i] += ch.inFifo[i] * w * w;
  }
}

class AinImpartialerProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      {
        name: "strength",
        defaultValue: 0.7,
        minValue: 0,
        maxValue: 1,
        automationRate: "k-rate",
      },
      {
        name: "transpose",
        defaultValue: 0,
        minValue: -24,
        maxValue: 24,
        automationRate: "k-rate",
      },
      {
        name: "maxShift",
        defaultValue: 1,
        minValue: 1,
        maxValue: 12,
        automationRate: "k-rate",
      },
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
    this._mode = "snap";
    this._empty = null;
    this.port.onmessage = (ev) => {
      const d = ev.data || {};
      if (d.type !== "config") return;
      let reset = false;
      if (typeof d.on === "boolean" && d.on !== this._on) {
        this._on = d.on;
        reset = true;
      } else if (typeof d.on === "boolean") {
        this._on = d.on;
      }
      if (typeof d.key === "number") {
        const k = ((d.key % 12) + 12) % 12;
        if (k !== this._key) reset = true;
        this._key = k;
      }
      if (typeof d.scale === "string" && SCALE_PCS[d.scale]) {
        if (d.scale !== this._scale) reset = true;
        this._scale = d.scale;
      }
      if (typeof d.mode === "string") {
        if (d.mode !== this._mode) reset = true;
        this._mode = d.mode;
      }
      // Drop accumulated PV / OLA state so mode changes don't "stick"
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
      // keep inFifo / dryDelay so we don't click the input stream
    }
  }

  _emptyInput(n) {
    if (!this._empty || this._empty.length !== n) this._empty = new Float32Array(n);
    return this._empty;
  }

  _step(ch, x, pitchRatio, strength, doShift, maxShift) {
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
      const mapMode = this._mode === "off" ? "off" : this._mode;
      const snapOn = mapMode === "snap" || mapMode === "remap";
      const needPv = doShift || snapOn;

      if (needPv) {
        processFrame(ch, this.window, fftSize, hop, {
          pitchRatio,
          mapMode,
          key: this._key,
          scalePcs: SCALE_PCS[this._scale] || SCALE_PCS.major,
          maxShift: Math.max(1, Math.min(12, maxShift | 0)),
          sampleRate: sampleRate,
        });
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

    if (strength < 0.0001) return dry;
    return dry * (1 - strength) + wet * strength;
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

    const sArr = parameters.strength;
    const tArr = parameters.transpose;
    const mArr = parameters.maxShift;
    const s0 = sArr[0];
    const t0 = tArr[0];
    const m0 = mArr[0];
    const stereo = outR !== outL;

    for (let i = 0; i < n; i++) {
      const strength = this._on ? (sArr.length > 1 ? sArr[i] : s0) : 0;
      const transpose = tArr.length > 1 ? tArr[i] : t0;
      const maxShift = mArr.length > 1 ? mArr[i] : m0;
      const pitchRatio = Math.pow(2, transpose / 12);
      const doShift = Math.abs(transpose) > 0.02;

      outL[i] = this._step(this.L, inL[i] || 0, pitchRatio, strength, doShift, maxShift);
      if (stereo) {
        outR[i] = this._step(this.R, inR[i] || 0, pitchRatio, strength, doShift, maxShift);
      }
    }
    return true;
  }
}

registerProcessor("ain-impartialer", AinImpartialerProcessor);
