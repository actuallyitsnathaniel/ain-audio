// Cliplim — lookahead clip-limiter with Au5-style detail preserve.
// Ceiling clip (soft knee) + optional lookahead gain stage.
// Transient / HF detail: highpassed(delta) where delta = delayed − clipped,
// mixed back by `preserve` (highpassed foldback / detail restore).
//
// Constant latency = lookahead samples (delay kept when bypassed).
// Dry/wet mixes against the same delay so blends don't comb.

const MAX_LOOK_MS = 20;
const VIZ_BINS = 64;

function softClip(x, thresh, soft) {
  const a = Math.abs(x);
  if (a <= thresh) return x;
  const sign = x < 0 ? -1 : 1;
  if (soft < 0.001) return sign * thresh;
  const over = (a - thresh) / Math.max(1e-6, 1 - thresh);
  const softCeil = thresh + (1 - thresh) * Math.tanh(over * (1 + soft * 3));
  return sign * (thresh * (1 - soft) + softCeil * soft);
}

class AinCliplimProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: "ceiling", defaultValue: -0.5, minValue: -24, maxValue: 0, automationRate: "k-rate" },
      { name: "soft", defaultValue: 0.35, minValue: 0, maxValue: 1, automationRate: "k-rate" },
      { name: "preserve", defaultValue: 0.55, minValue: 0, maxValue: 1, automationRate: "k-rate" },
      { name: "lookahead", defaultValue: 2, minValue: 0, maxValue: MAX_LOOK_MS, automationRate: "k-rate" },
      { name: "release", defaultValue: 80, minValue: 5, maxValue: 500, automationRate: "k-rate" },
      { name: "mix", defaultValue: 1, minValue: 0, maxValue: 1, automationRate: "k-rate" },
    ];
  }

  constructor() {
    super();
    const maxLook = Math.ceil((sampleRate * MAX_LOOK_MS) / 1000) + 8;
    this._maxLook = maxLook;
    this._bufL = new Float32Array(maxLook);
    this._bufR = new Float32Array(maxLook);
    this._w = 0;
    this._gr = 1;
    this._lpL = 0;
    this._lpR = 0;
    this._on = true;
    this._viz = true;
    this._vizIn = new Float32Array(VIZ_BINS);
    this._vizOut = new Float32Array(VIZ_BINS);
    this._vizAccIn = 0;
    this._vizAccOut = 0;
    this._vizCount = 0;
    this._hpCoeff = 1 - Math.exp((-2 * Math.PI * 2800) / sampleRate);

    this.port.onmessage = (ev) => {
      const d = ev.data || {};
      if (d.type !== "config") return;
      if (typeof d.on === "boolean") this._on = d.on;
      if (typeof d.viz === "boolean") this._viz = d.viz;
    };
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!output || !output[0]) return true;

    const outL = output[0];
    const outR = output[1] || output[0];
    const n = outL.length;
    const empty = this._empty || (this._empty = new Float32Array(n));
    const inL = (input && input[0]) || empty;
    const inR = (input && input[1]) || inL;
    const stereo = outR !== outL;

    const ceilingLin = Math.pow(
      10,
      Math.max(-48, Math.min(0, parameters.ceiling[0])) / 20,
    );
    const soft = parameters.soft[0];
    const preserve = parameters.preserve[0];
    const lookMs = parameters.lookahead[0];
    const releaseMs = parameters.release[0];
    const mix0 = parameters.mix[0];
    const look = Math.max(
      0,
      Math.min(this._maxLook - 1, Math.round((sampleRate * lookMs) / 1000)),
    );
    const relCoeff = 1 - Math.exp(-1 / Math.max(1, (releaseMs / 1000) * sampleRate));
    const N = this._maxLook;

    for (let i = 0; i < n; i++) {
      const mix = this._on ? mix0 : 0;
      const xl = inL[i] || 0;
      const xr = inR[i] || 0;
      const w = this._w;
      this._bufL[w] = xl;
      this._bufR[w] = xr;
      const r = (w - look + N) % N;
      const dL = this._bufL[r];
      const dR = this._bufR[r];

      // stereo-linked peak in the lookahead window
      let peak = 0;
      if (look > 0) {
        for (let k = 0; k <= look; k++) {
          const idx = (w - k + N) % N;
          const a = Math.max(Math.abs(this._bufL[idx]), Math.abs(this._bufR[idx]));
          if (a > peak) peak = a;
        }
        let targetGr = peak > ceilingLin ? ceilingLin / peak : 1;
        if (targetGr < this._gr) this._gr = targetGr;
        else this._gr += (1 - this._gr) * relCoeff;
      } else {
        this._gr = 1;
      }

      const apply = (delayed, lpRef) => {
        const pre = delayed * this._gr;
        const clipped = softClip(pre, ceilingLin, soft);
        const delta = delayed - clipped;
        const lp = lpRef.v + this._hpCoeff * (delta - lpRef.v);
        lpRef.v = lp;
        const hp = delta - lp;
        const wet = clipped + hp * preserve;
        if (mix < 0.0001) return delayed;
        return delayed * (1 - mix) + wet * mix;
      };

      const lpL = { v: this._lpL };
      const lpR = { v: this._lpR };
      outL[i] = apply(dL, lpL);
      this._lpL = lpL.v;
      if (stereo) {
        outR[i] = apply(dR, lpR);
        this._lpR = lpR.v;
      }

      this._w = (w + 1) % N;

      if (this._viz) {
        this._vizAccIn = Math.max(this._vizAccIn, Math.abs(xl), Math.abs(xr));
        this._vizAccOut = Math.max(
          this._vizAccOut,
          Math.abs(outL[i]),
          stereo ? Math.abs(outR[i]) : 0,
        );
        this._vizCount++;
        if (this._vizCount >= 32) {
          this._vizIn.copyWithin(0, 1);
          this._vizOut.copyWithin(0, 1);
          this._vizIn[VIZ_BINS - 1] = Math.min(1, this._vizAccIn);
          this._vizOut[VIZ_BINS - 1] = Math.min(1, this._vizAccOut);
          this._vizAccIn = 0;
          this._vizAccOut = 0;
          this._vizCount = 0;
          this.port.postMessage({
            type: "viz",
            n: VIZ_BINS,
            a: this._vizIn,
            b: this._vizOut,
          });
        }
      }
    }
    return true;
  }
}

registerProcessor("ain-cliplim", AinCliplimProcessor);
