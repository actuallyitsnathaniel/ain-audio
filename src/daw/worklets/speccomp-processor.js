// Speccomp — spectral compressor (v1: fixed/log bands, magnitude gains, phase intact).
// STFT/OLA helpers duplicated from impartialer for now (classic worklet scope; extract
// to spectral-core.js when we have a clean Vite module-worklet path).
//
// Dry/wet mixes INSIDE the worklet against a latency-aligned dry delay.

const PRESETS = {
  low: { fftSize: 2048, hop: 512 },
  high: { fftSize: 4096, hop: 1024 },
};

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

function createChannel(fftSize, hop, nBands) {
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
    env: new Float32Array(nBands),
    bandGain: new Float32Array(nBands),
  };
}

/** Log-spaced band edges in bin indices [1 .. half]. */
function buildBandMap(fftSize, sampleRate, nBands) {
  const half = fftSize / 2;
  const fMin = 40;
  const fMax = sampleRate * 0.45;
  const edges = new Uint16Array(nBands + 1);
  edges[0] = 1;
  for (let b = 1; b <= nBands; b++) {
    const t = b / nBands;
    const hz = fMin * Math.pow(fMax / fMin, t);
    edges[b] = Math.min(half, Math.max(edges[b - 1] + 1, Math.round((hz * fftSize) / sampleRate)));
  }
  edges[nBands] = half;
  return edges;
}

function db2lin(db) {
  return Math.pow(10, db / 20);
}

function lin2db(x) {
  return 20 * Math.log10(Math.max(1e-12, x));
}

/** Soft-knee downward compressor gain in dB for one band level. */
function compGainDb(levelDb, threshDb, ratio, kneeDb) {
  const over = levelDb - threshDb;
  if (kneeDb <= 0.01) {
    return over <= 0 ? 0 : (-over * (1 - 1 / ratio));
  }
  const half = kneeDb * 0.5;
  if (over < -half) return 0;
  if (over > half) return -over * (1 - 1 / ratio);
  // soft region
  const x = over + half;
  return ((1 / ratio - 1) * x * x) / (2 * kneeDb);
}

function processFrame(ch, window, fftSize, hop, edges, params) {
  const { re, im, env, bandGain } = ch;
  const nBands = edges.length - 1;
  const {
    threshold,
    ratio,
    attack,
    release,
    knee,
    makeup,
    tilt,
    hopSec,
  } = params;

  for (let i = 0; i < fftSize; i++) {
    re[i] = ch.inFifo[i] * window[i];
    im[i] = 0;
  }
  fft(re, im, false);

  const atkCoef = Math.exp((-hopSec) / Math.max(0.001, attack));
  const relCoef = Math.exp((-hopSec) / Math.max(0.001, release));
  const makeupLin = db2lin(makeup);

  // per-band energy → envelope → gain
  for (let b = 0; b < nBands; b++) {
    const i0 = edges[b];
    const i1 = edges[b + 1];
    let sum = 0;
    let n = 0;
    for (let k = i0; k < i1; k++) {
      const mr = re[k];
      const mi = im[k];
      sum += mr * mr + mi * mi;
      n++;
    }
    const rms = Math.sqrt(sum / Math.max(1, n));
    // envelope on linear magnitude
    const coef = rms > env[b] ? atkCoef : relCoef;
    env[b] = coef * env[b] + (1 - coef) * rms;

    const bandT = nBands <= 1 ? 0 : (b / (nBands - 1)) * 2 - 1; // −1 low … +1 high
    const threshDb = threshold + tilt * bandT * 12;
    const gDb = compGainDb(lin2db(env[b]), threshDb, ratio, knee);
    bandGain[b] = db2lin(gDb) * makeupLin;
  }

  // apply band gains to bins (phase unchanged)
  for (let b = 0; b < nBands; b++) {
    const g = bandGain[b];
    const i0 = edges[b];
    const i1 = edges[b + 1];
    for (let k = i0; k < i1; k++) {
      re[k] *= g;
      im[k] *= g;
    }
  }
  // DC + Nyquist lightly follow first/last band
  re[0] *= bandGain[0];
  im[0] = 0;
  const lastG = bandGain[nBands - 1];
  re[fftSize / 2] *= lastG;
  im[fftSize / 2] = 0;

  for (let k = 1; k < fftSize / 2; k++) {
    re[fftSize - k] = re[k];
    im[fftSize - k] = -im[k];
  }

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

class AinSpeccompProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: "threshold", defaultValue: -24, minValue: -60, maxValue: 0, automationRate: "k-rate" },
      { name: "ratio", defaultValue: 4, minValue: 1, maxValue: 20, automationRate: "k-rate" },
      { name: "attack", defaultValue: 0.01, minValue: 0.001, maxValue: 0.5, automationRate: "k-rate" },
      { name: "release", defaultValue: 0.12, minValue: 0.01, maxValue: 2, automationRate: "k-rate" },
      { name: "knee", defaultValue: 6, minValue: 0, maxValue: 24, automationRate: "k-rate" },
      { name: "makeup", defaultValue: 0, minValue: 0, maxValue: 24, automationRate: "k-rate" },
      { name: "mix", defaultValue: 1, minValue: 0, maxValue: 1, automationRate: "k-rate" },
      { name: "tilt", defaultValue: 0, minValue: -1, maxValue: 1, automationRate: "k-rate" },
      { name: "focus", defaultValue: 0.35, minValue: 0, maxValue: 1, automationRate: "k-rate" },
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
    this.nBands = 24;
    this.edges = buildBandMap(this.fftSize, sampleRate, this.nBands);
    this.L = createChannel(this.fftSize, this.hop, 48);
    this.R = createChannel(this.fftSize, this.hop, 48);
    this._on = true;
    this._empty = null;
    this.port.onmessage = (ev) => {
      const d = ev.data || {};
      if (d.type !== "config") return;
      if (typeof d.on === "boolean") this._on = d.on;
    };
  }

  _emptyInput(n) {
    if (!this._empty || this._empty.length !== n) this._empty = new Float32Array(n);
    return this._empty;
  }

  _ensureBands(focus) {
    const n = Math.max(12, Math.min(48, 12 + Math.round(focus * 36)));
    if (n === this.nBands) return;
    this.nBands = n;
    this.edges = buildBandMap(this.fftSize, sampleRate, n);
  }

  _step(ch, x, mix, active, frameParams) {
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
      if (active) processFrame(ch, this.window, fftSize, hop, this.edges, frameParams);
      else identityFrame(ch, this.window, fftSize);

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

    const p = (name) => {
      const a = parameters[name];
      return a.length > 1 ? a : null;
    };
    const s = (name, arr) => (arr ? arr[0] : parameters[name][0]);

    const thrA = p("threshold");
    const ratA = p("ratio");
    const atkA = p("attack");
    const relA = p("release");
    const kneeA = p("knee");
    const mkA = p("makeup");
    const mixA = p("mix");
    const tiltA = p("tilt");
    const focA = p("focus");

    const thr0 = s("threshold", thrA);
    const rat0 = s("ratio", ratA);
    const atk0 = s("attack", atkA);
    const rel0 = s("release", relA);
    const knee0 = s("knee", kneeA);
    const mk0 = s("makeup", mkA);
    const mix0 = s("mix", mixA);
    const tilt0 = s("tilt", tiltA);
    const foc0 = s("focus", focA);

    // rebuild band map once per block from focus (cheap)
    this._ensureBands(focA ? focA[0] : foc0);

    const hopSec = this.hop / sampleRate;
    const frameParams = {
      threshold: thr0,
      ratio: Math.max(1.01, rat0),
      attack: atk0,
      release: rel0,
      knee: knee0,
      makeup: mk0,
      tilt: tilt0,
      hopSec,
    };

    for (let i = 0; i < n; i++) {
      if (thrA) frameParams.threshold = thrA[i];
      if (ratA) frameParams.ratio = Math.max(1.01, ratA[i]);
      if (atkA) frameParams.attack = atkA[i];
      if (relA) frameParams.release = relA[i];
      if (kneeA) frameParams.knee = kneeA[i];
      if (mkA) frameParams.makeup = mkA[i];
      if (tiltA) frameParams.tilt = tiltA[i];

      const mix = this._on ? (mixA ? mixA[i] : mix0) : 0;
      const active = this._on && mix > 0.001;

      outL[i] = this._step(this.L, inL[i] || 0, mix, active, frameParams);
      if (stereo) {
        outR[i] = this._step(this.R, inR[i] || 0, mix, active, frameParams);
      }
    }
    return true;
  }
}

registerProcessor("ain-speccomp", AinSpeccompProcessor);
