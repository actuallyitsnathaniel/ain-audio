/**
 * Oscillator phase control via PeriodicWave.
 * Built-in OscillatorNode types always start at phase 0, so unison stacks comb;
 * a phase-rotated Fourier series gives the same waveform at an arbitrary offset.
 */

/** Apply `wave` at `phaseRad` (0 = locked / native type). */
export function setOscillatorWave(
  ctx: BaseAudioContext,
  osc: OscillatorNode,
  wave: OscillatorType,
  phaseRad = 0,
): void {
  if (wave === "custom") return;
  if (!phaseRad) {
    osc.type = wave;
    return;
  }
  const N = 128;
  const real = new Float32Array(N);
  const imag = new Float32Array(N);
  for (let n = 1; n < N; n++) {
    let mag = 0;
    switch (wave) {
      case "sine":
        mag = n === 1 ? 1 : 0;
        break;
      case "square":
        mag = n % 2 === 1 ? 1 / n : 0;
        break;
      case "sawtooth":
        mag = 1 / n;
        break;
      case "triangle":
        mag = n % 2 === 1 ? 1 / (n * n) : 0;
        break;
    }
    if (!mag) continue;
    const ph = phaseRad * n;
    // sin(ωt + φ) = sin(ωt)cos(φ) + cos(ωt)sin(φ) → imag=cos, real=sin
    real[n] = mag * Math.sin(ph);
    imag[n] = mag * Math.cos(ph);
  }
  osc.setPeriodicWave(ctx.createPeriodicWave(real, imag));
}
