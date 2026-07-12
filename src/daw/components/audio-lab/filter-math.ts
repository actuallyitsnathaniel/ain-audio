// ── biquad magnitude response (RBJ cookbook: https://www.w3.org/TR/audio-eq-cookbook/) ──
// Coefficients for the four filter types the synth exposes, then the magnitude of
// H(e^jw) = (b0 + b1 z⁻¹ + b2 z⁻²)/(a0 + a1 z⁻¹ + a2 z⁻²) at frequency f. This is the
// exact transfer function a BiquadFilterNode implements, so FilterGraph matches audio.

// returns normalized [b0,b1,b2,a0,a1,a2]
function coeffs(type: BiquadFilterType, cut: number, q: number, sr: number): [number, number, number, number, number, number] {
  const w0 = (2 * Math.PI * cut) / sr;
  const cw = Math.cos(w0);
  const sw = Math.sin(w0);
  const alpha = sw / (2 * Math.max(0.0001, q));
  let b0 = 1, b1 = 0, b2 = 0, a0 = 1, a1 = 0, a2 = 0;
  switch (type) {
    case "lowpass":
      b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = (1 - cw) / 2;
      a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
      break;
    case "highpass":
      b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = (1 + cw) / 2;
      a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
      break;
    case "bandpass": // constant 0 dB peak (BiquadFilterNode's bandpass)
      b0 = alpha; b1 = 0; b2 = -alpha;
      a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
      break;
    case "notch":
      b0 = 1; b1 = -2 * cw; b2 = 1;
      a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
      break;
    default: // lowshelf/highshelf/peaking/allpass not exposed — flat
      break;
  }
  return [b0, b1, b2, a0, a1, a2];
}

export function biquadMagDb(type: BiquadFilterType, cut: number, q: number, f: number, sr: number): number {
  const [b0, b1, b2, a0, a1, a2] = coeffs(type, cut, q, sr);
  const w = (2 * Math.PI * f) / sr;
  // evaluate on the unit circle: z⁻¹ = e^-jw = cos w - j sin w
  const cos1 = Math.cos(w), sin1 = Math.sin(w);
  const cos2 = Math.cos(2 * w), sin2 = Math.sin(2 * w);
  const numRe = b0 + b1 * cos1 + b2 * cos2;
  const numIm = -(b1 * sin1 + b2 * sin2);
  const denRe = a0 + a1 * cos1 + a2 * cos2;
  const denIm = -(a1 * sin1 + a2 * sin2);
  const numMag = Math.hypot(numRe, numIm);
  const denMag = Math.hypot(denRe, denIm) || 1e-9;
  return 20 * Math.log10(numMag / denMag);
}
