// AudioWorklet: capture PCM on the audio thread (replaces ScriptProcessor).
// Main thread enables capturing via port messages; we batch to `bufferSize` then post.

class AinInputCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.capturing = false;
    this.bufferSize = 512;
    this._L = null;
    this._R = null;
    this._filled = 0;
    this.port.onmessage = (ev) => {
      const d = ev.data || {};
      if (d.type === "config") {
        if (typeof d.bufferSize === "number" && d.bufferSize > 0) {
          const next = d.bufferSize | 0;
          if (next !== this.bufferSize) {
            this.bufferSize = next;
            this._L = null;
            this._R = null;
            this._filled = 0;
          }
        }
        if (typeof d.capturing === "boolean") {
          this.capturing = d.capturing;
          if (!this.capturing) {
            this._filled = 0;
          }
        }
      }
    };
  }

  _ensureBufs() {
    if (!this._L || this._L.length !== this.bufferSize) {
      this._L = new Float32Array(this.bufferSize);
      this._R = new Float32Array(this.bufferSize);
      this._filled = 0;
    }
  }

  process(inputs, outputs) {
    // Keep the node alive; silence the output (we only capture).
    const out = outputs[0];
    if (out) {
      for (let c = 0; c < out.length; c++) out[c].fill(0);
    }

    const input = inputs[0];
    if (!this.capturing || !input || !input[0]) return true;

    this._ensureBufs();
    const L = input[0];
    const R = input[1] || input[0];
    let i = 0;
    while (i < L.length) {
      const need = this.bufferSize - this._filled;
      const n = Math.min(need, L.length - i);
      this._L.set(L.subarray(i, i + n), this._filled);
      this._R.set(R.subarray(i, i + n), this._filled);
      this._filled += n;
      i += n;
      if (this._filled >= this.bufferSize) {
        const outL = this._L;
        const outR = this._R;
        this._L = new Float32Array(this.bufferSize);
        this._R = new Float32Array(this.bufferSize);
        this._filled = 0;
        this.port.postMessage({ type: "chunk", L: outL, R: outR }, [
          outL.buffer,
          outR.buffer,
        ]);
      }
    }
    return true;
  }
}

registerProcessor("ain-input-capture", AinInputCaptureProcessor);
