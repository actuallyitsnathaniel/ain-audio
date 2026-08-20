// Impartialer — spectral pitch mapper
// Upheaval: HPS acquire → soft-mask isolate → M× Hildebrand E/H refine → per-track β.
// Next: Bernsee phase continuity + sticky slew (see SPECTRAL.md §4.5).
//
// Dry/wet mixes INSIDE the worklet against a latency-aligned dry delay so strength
// blends don't comb. Bypass still runs the delay so latency stays constant when
// toggled (neutralize-in-place).
//
// Musical gate: out-of-key pitched energy is always locked onto the scale (or
// muted). Residual is aperiodic texture only — never a dry-pitch bleed.
// Soft masks: weight 1 at exact n·F0 → 0 at HPS_HARM_CENTS (not a perfect demix).
// E/H: US5973252A correction-mode window on the mono analysis ring, seeded by HPS.

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

const VIZ_BINS = 96;
const SPLIT_LO_HZ = 250;
const SPLIT_HI_HZ = 2500;

/** HPS (Noll): P(k)=∏_{r=1..R} |X(r·k)| — multi-F0 acquire. */
const HPS_R = 4;
const HPS_MAX_F0 = 4;
const HPS_FMIN = 55;
const HPS_FMAX = 800;
/** Relative HPS peak threshold vs frame HPS max. */
const HPS_THRESH = 0.025;
/** Peak may remap if within this many cents of n·F0 (n=1..HPS_HARM). */
const HPS_HARM_CENTS = 45;
const HPS_HARM = 8;
/** Reject a new F0 within this many cents of an already-accepted one. */
const HPS_SEP_CENTS = 70;

/**
 * US5973252A E/H correction-mode window (Centinel-faithful).
 * Hop-rate refine on the analysis ring, seeded by HPS F0.
 */
const EH_TRACK_N = 8;
const EH_EPS = 0.25;
const EH_EPS_LOOSE = 0.45;
const EH_RING = 2048;

/**
 * Harmonic Product Spectrum on a precomputed magnitude spectrum.
 * Writes top-M fundamentals into f0Hz / f0Score (descending score). Returns count.
 * All buffers preallocated by caller — no alloc.
 */
function runHps(mag, half, binHz, hps, f0Hz, f0Score) {
  for (let i = 0; i < HPS_MAX_F0; i++) {
    f0Hz[i] = 0;
    f0Score[i] = 0;
  }
  hps.fill(0);

  const kMin = Math.max(1, Math.ceil(HPS_FMIN / binHz));
  // Need r·k ≤ half for all r ≤ HPS_R
  const kMax = Math.min(
    Math.floor(half / HPS_R),
    Math.floor(HPS_FMAX / binHz),
  );
  if (kMax <= kMin + 1) return 0;

  let peakP = 1e-20;
  for (let k = kMin; k <= kMax; k++) {
    let p = mag[k];
    if (!(p > 1e-12)) continue;
    let ok = true;
    for (let r = 2; r <= HPS_R; r++) {
      const kr = k * r;
      const mr = mag[kr];
      if (!(mr > 1e-12)) {
        ok = false;
        break;
      }
      p *= mr;
    }
    if (!ok) continue;
    hps[k] = p;
    if (p > peakP) peakP = p;
  }

  const thresh = peakP * HPS_THRESH;
  let nFound = 0;

  for (let k = kMin + 1; k < kMax; k++) {
    const y0 = hps[k];
    if (!(y0 >= thresh)) continue;
    const ym1 = hps[k - 1];
    const yp1 = hps[k + 1];
    if (!(y0 >= ym1 && y0 >= yp1)) continue;

    // Parabolic refine in bin space (same shape as E/H quadratic trough refine)
    const denom = 2 * (2 * y0 - yp1 - ym1);
    let delta = 0;
    if (Math.abs(denom) > 1e-30) {
      delta = (yp1 - ym1) / denom;
      if (delta > 1.25 || delta < -1.25) delta = 0;
    }
    let hz = (k + delta) * binHz;
    if (!(hz >= HPS_FMIN && hz <= HPS_FMAX)) continue;

    // Prefer missing-fundamental: if ~½hz also an HPS local peak, use it
    const halfBin = Math.round((k + delta) * 0.5);
    if (
      halfBin >= kMin &&
      halfBin <= kMax &&
      hps[halfBin] >= thresh * 0.5 &&
      hps[halfBin] >= (hps[halfBin - 1] || 0) &&
      hps[halfBin] >= (hps[halfBin + 1] || 0)
    ) {
      hz = halfBin * binHz;
    }

    // Skip if too close to an already-kept F0
    let tooClose = false;
    for (let i = 0; i < nFound; i++) {
      const cents = (1200 * Math.log(hz / f0Hz[i])) / Math.LN2;
      if (Math.abs(cents) < HPS_SEP_CENTS) {
        tooClose = true;
        break;
      }
    }
    if (tooClose) continue;

    // Insert into top-M by descending score
    let slot = nFound;
    if (nFound < HPS_MAX_F0) {
      nFound++;
      slot = nFound - 1;
    } else if (y0 > f0Score[HPS_MAX_F0 - 1]) {
      slot = HPS_MAX_F0 - 1;
    } else {
      continue;
    }
    while (slot > 0 && y0 > f0Score[slot - 1]) {
      f0Score[slot] = f0Score[slot - 1];
      f0Hz[slot] = f0Hz[slot - 1];
      slot--;
    }
    f0Score[slot] = y0;
    f0Hz[slot] = hz;
  }

  return nFound;
}

/**
 * Nearest (trackIndex, |cents|) on any n·F0 ladder, or null if outside the gate.
 * Exclusive ownership — competing F0s: closest cents wins (not a perfect demix).
 */
function nearestHarmonicTrack(hz, f0Hz, nF0) {
  if (!(hz > 20) || nF0 <= 0 || !f0Hz) return null;
  let bestI = -1;
  let bestAbs = HPS_HARM_CENTS + 1;
  for (let i = 0; i < nF0; i++) {
    const f0 = f0Hz[i];
    if (!(f0 > 0)) continue;
    for (let n = 1; n <= HPS_HARM; n++) {
      const target = f0 * n;
      if (target > hz * 1.15) break;
      if (target < hz * 0.85) continue;
      const cents = Math.abs((1200 * Math.log(hz / target)) / Math.LN2);
      if (cents < bestAbs) {
        bestAbs = cents;
        bestI = i;
      }
    }
  }
  if (bestI < 0 || bestAbs > HPS_HARM_CENTS) return null;
  return { i: bestI, cents: bestAbs };
}

function bandAmtForHz(hz, loAmt, midAmt, hiAmt, duck) {
  let a = hz < SPLIT_LO_HZ ? loAmt : hz < SPLIT_HI_HZ ? midAmt : hiAmt;
  return a * (1 - duck);
}

/** Read mono from analysis ring (length EH_RING). */
function ehRingAt(ring, wr, at) {
  const j = ((wr - at) % EH_RING + EH_RING) % EH_RING;
  return ring[j];
}

/**
 * Snapshot E(L), H(L) over last 2L samples (US5973252A).
 * Writes into outE/outH scalars via return — no alloc beyond locals.
 */
function ehSnapshot(ring, wr, L) {
  let E = 0;
  let H = 0;
  for (let j = 0; j < 2 * L; j++) {
    const x = ehRingAt(ring, wr, j);
    E += x * x;
  }
  for (let j = 0; j < L; j++) {
    H += ehRingAt(ring, wr, j) * ehRingAt(ring, wr, j + L);
  }
  return { E, H };
}

/**
 * Correction-mode E/H refine around HPS seed F0.
 * Prealloc scratchE/scratchH length EH_TRACK_N.
 * Returns refined Hz, or 0 if ε gate fails (caller keeps HPS).
 *
 * τ* via quadratic on E−2H trough (patent FIGS 5A–5C / Gemini parabola).
 */
function refineF0Eh(ring, wr, f0Guess, sr, scratchE, scratchH) {
  if (!(f0Guess >= HPS_FMIN && f0Guess <= HPS_FMAX)) return 0;
  const peMin = Math.max(16, Math.floor(sr / HPS_FMAX));
  const peMax = Math.min((EH_RING >> 1) - 4, Math.floor(sr / HPS_FMIN));
  let pe = sr / f0Guess;
  if (!(pe >= peMin && pe <= peMax)) return 0;
  pe = Math.max(peMin, Math.min(peMax, pe));
  const L0 = Math.round(pe);
  const half = EH_TRACK_N >> 1;
  let off = L0 - half;
  if (off < peMin) off = peMin;
  if (off + EH_TRACK_N - 1 > peMax) off = Math.max(peMin, peMax - EH_TRACK_N + 1);

  let bestK = -1;
  let bestCost = Infinity;
  let bestE = 0;
  for (let k = 0; k < EH_TRACK_N; k++) {
    const L = off + k;
    const { E, H } = ehSnapshot(ring, wr, L);
    scratchE[k] = E;
    scratchH[k] = H;
    if (!(E > 1e-12)) continue;
    const cost = E - 2 * H;
    if (cost < bestCost) {
      bestCost = cost;
      bestK = k;
      bestE = E;
    }
  }
  if (bestK < 0) return 0;
  // ε gate — not periodic enough → keep HPS
  if (bestCost > EH_EPS_LOOSE * bestE) return 0;
  if (bestCost > EH_EPS * bestE && bestCost > 0.08 * bestE) {
    // soft accept only if clearly the trough
  }

  let L = off + bestK;
  if (bestK > 0 && bestK < EH_TRACK_N - 1) {
    const c0 = scratchE[bestK - 1] - 2 * scratchH[bestK - 1];
    const c1 = bestCost;
    const c2 = scratchE[bestK + 1] - 2 * scratchH[bestK + 1];
    const denom = 2 * (2 * c1 - c2 - c0);
    if (Math.abs(denom) > 1e-18) {
      const delta = (c2 - c0) / denom;
      if (delta > -1.25 && delta < 1.25) L += delta;
    }
  }
  if (!(L >= peMin && L <= peMax)) return 0;
  const hz = sr / L;
  if (!(hz >= HPS_FMIN && hz <= HPS_FMAX)) return 0;
  // Reject wild jumps from HPS seed (> ±3 semitones) — isolation not perfect yet
  const cents = Math.abs((1200 * Math.log(hz / f0Guess)) / Math.LN2);
  if (cents > 300) return 0;
  return hz;
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
    inputPhase: new Float32Array(half + 1),
    residualMag: new Float32Array(half + 1),
    identityMag: new Float32Array(half + 1),
    lastMag: new Float32Array(half + 1),
    onsetEnv: 0,
  };
}

/** Max-pool FFT bins into log columns; posOut = log-freq 0..1 of the argmax bin. */
function fillVizLog(src, half, magOut, posOut) {
  const n = magOut.length;
  const logHalf = Math.log(half);
  for (let i = 0; i < n; i++) {
    const t0 = i / n;
    const t1 = (i + 1) / n;
    const k0 = Math.max(1, Math.floor(Math.pow(half, t0)));
    const k1 = Math.max(k0 + 1, Math.min(half, Math.floor(Math.pow(half, t1))));
    let m = 0;
    let bestK = k0;
    for (let k = k0; k < k1; k++) {
      const v = src[k];
      if (v > m) {
        m = v;
        bestK = k;
      }
    }
    magOut[i] = m;
    posOut[i] = logHalf > 0 ? Math.log(Math.max(1, bestK)) / logHalf : t0;
  }
}

/** Soft-log normalize one viz buffer in place → 0..1 against its own peak. */
function softNorm(buf) {
  let peak = 1e-12;
  for (let i = 0; i < buf.length; i++) peak = Math.max(peak, buf[i]);
  const denom = Math.log10(1 + peak * 8);
  for (let i = 0; i < buf.length; i++) {
    buf[i] = denom > 0 ? Math.log10(1 + buf[i] * 8) / denom : 0;
  }
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
  if (pcInKey(midi, key, scalePcs)) return 0;
  const limit = Math.max(1, maxShift | 0);
  if (bestAbs > limit) return 0;
  return best;
}

/** Rounded pitch-class sits on the scale (key-relative). */
function pcInKey(midi, key, scalePcs) {
  const roundedPc = ((Math.round(midi) % 12) + 12) % 12;
  const roundedRel = (roundedPc - key + 12) % 12;
  return scalePcs.indexOf(roundedRel) >= 0;
}

function hzToMidi(hz) {
  return 69 + (12 * Math.log(hz / 440)) / Math.LN2;
}

function depositShift(synMag, synFreq, freq, k, m, ratio, half) {
  const dest = (k * ratio + 0.5) | 0;
  if (dest < 0 || dest > half) return;
  synMag[dest] += m;
  synFreq[dest] = freq[k] * ratio;
}

/**
 * Lock ratio for pitched energy. Out-of-key always force-quantizes (never
 * identity-pass original pitch). In-key snap stays put. `amt` scales remap
 * pull on in-key only.
 */
function lockRatio(hz, pitchRatio, key, scalePcs, maxShift, force, amt) {
  if (!(hz > 0) || !Number.isFinite(hz)) {
    return { ratio: pitchRatio, inKey: true };
  }
  // maxShift is ignored: out-of-key always force-locks (never identity-pass).
  void maxShift;
  const midi = hzToMidi(hz);
  const inKey = pcInKey(midi, key, scalePcs);
  if (inKey && !force) return { ratio: pitchRatio, inKey: true };
  const shift = mapSemitones(midi, key, scalePcs, maxShift, true);
  const pull = inKey ? Math.min(1, Math.max(0, amt)) : 1;
  const ratio =
    shift !== 0 ? pitchRatio * Math.pow(2, (shift * pull) / 12) : pitchRatio;
  return { ratio, inKey: false };
}

/**
 * Analyze frame → HPS F0s → harmonic soft-masks → per-track β → OLA.
 * Musical gate: out-of-key pitched energy never identity-passes when mapping is on.
 * Residual knob scales aperiodic (non-peak) texture only.
 */
function processFrame(ch, window, fftSize, hop, opts) {
  const half = fftSize / 2;
  const {
    re,
    im,
    lastPhase,
    sumPhase,
    mag,
    freq,
    synMag,
    synFreq,
    inputPhase,
    residualMag,
    identityMag,
    lastMag,
  } = ch;
  const {
    pitchRatio,
    mapMode,
    key,
    scalePcs,
    maxShift,
    sampleRate,
    residual,
    floor,
    bandLo,
    bandMid,
    bandHi,
    hits,
  } = opts;

  for (let i = 0; i < fftSize; i++) {
    re[i] = ch.inFifo[i] * window[i];
    im[i] = 0;
  }
  fft(re, im, false);

  const expect = (2 * Math.PI * hop) / fftSize;
  let peakMag = 1e-12;
  let energy = 0;
  let flux = 0;
  for (let k = 0; k <= half; k++) {
    const mr = re[k];
    const mi = im[k];
    const m = Math.hypot(mr, mi);
    const p = Math.atan2(mi, mr);
    let delta = p - lastPhase[k];
    lastPhase[k] = p;
    inputPhase[k] = p;
    delta -= k * expect;
    const qpd = Math.round(delta / Math.PI);
    if (qpd >= 0) delta -= Math.PI * (qpd + (qpd & 1));
    else delta -= Math.PI * (qpd - (qpd & 1));
    mag[k] = m;
    freq[k] = ((k * expect + delta) * fftSize) / (2 * Math.PI * hop);
    if (m > peakMag) peakMag = m;
    energy += m;
    const prev = lastMag[k];
    if (m > prev) flux += m - prev;
    lastMag[k] = m;
  }

  const onset = flux / (energy + 1e-12);
  ch.onsetEnv = onset > ch.onsetEnv ? onset : ch.onsetEnv * 0.82;
  const duck =
    Math.min(1, Math.max(0, hits)) * Math.min(1, ch.onsetEnv * 2.2);

  synMag.fill(0);
  synFreq.fill(0);
  residualMag.fill(0);
  identityMag.fill(0);

  const mapOn = mapMode === "snap" || mapMode === "remap";
  const force = mapMode === "remap";
  const binHz = sampleRate / fftSize;
  const floorAbs = peakMag * Math.min(1, Math.max(0, floor));
  const resAmt = Math.min(1, Math.max(0, residual));
  const doGlobal = Math.abs(pitchRatio - 1) > 0.001;
  const loAmt = Math.min(1, Math.max(0, bandLo));
  const midAmt = Math.min(1, Math.max(0, bandMid));
  const hiAmt = Math.min(1, Math.max(0, bandHi));

  // §1 HPS acquire — L recomputes; R reuses F0 list
  let nF0 = 0;
  if (opts.runHps && opts.hps && opts.f0Hz && opts.f0Score) {
    nF0 = runHps(mag, half, binHz, opts.hps, opts.f0Hz, opts.f0Score);
    if (opts.f0N) opts.f0N[0] = nF0;
  } else if (opts.f0N) {
    nF0 = opts.f0N[0] | 0;
  }
  const f0Hz = opts.f0Hz;
  const trackRatio = opts.trackRatio;

  // §3 M× Hildebrand E/H — refine each HPS seed on the mono analysis ring
  if (
    opts.runHps &&
    nF0 > 0 &&
    f0Hz &&
    opts.ehRing &&
    opts.ehScratchE &&
    opts.ehScratchH &&
    typeof opts.ehWr === "number"
  ) {
    for (let i = 0; i < nF0; i++) {
      const seed = f0Hz[i];
      if (!(seed > 0)) continue;
      const refined = refineF0Eh(
        opts.ehRing,
        opts.ehWr,
        seed,
        sampleRate,
        opts.ehScratchE,
        opts.ehScratchH,
      );
      if (refined > 0) f0Hz[i] = refined;
    }
  }

  // §2 Isolate — one β per (E/H-refined) F0 track
  if (trackRatio && f0Hz && nF0 > 0) {
    for (let i = 0; i < HPS_MAX_F0; i++) trackRatio[i] = pitchRatio;
    if (mapOn) {
      for (let i = 0; i < nF0; i++) {
        const f0 = f0Hz[i];
        if (!(f0 > 0)) continue;
        const midi = hzToMidi(f0);
        const inKey = pcInKey(midi, key, scalePcs);
        // Out-of-key: full lock (no hits duck, no lo/mid/hi leak).
        const amt = inKey
          ? bandAmtForHz(f0, loAmt, midAmt, hiAmt, duck)
          : 1;
        const lock = lockRatio(
          f0,
          pitchRatio,
          key,
          scalePcs,
          maxShift,
          force,
          amt,
        );
        trackRatio[i] = lock.ratio;
      }
    }
  }

  if (nF0 > 0 && f0Hz && trackRatio) {
    for (let k = 0; k <= half; k++) {
      const m = mag[k];
      if (m < 1e-12) continue;
      const hz = k * binHz;
      const own = nearestHarmonicTrack(hz, f0Hz, nF0);
      if (own) {
        // Entire owned bin takes the track β — leftover must not identity-pass.
        const ratio = trackRatio[own.i];
        const moved = Math.abs(ratio - 1) > 0.001;
        if (moved || doGlobal) depositShift(synMag, synFreq, freq, k, m, ratio, half);
        else identityMag[k] += m;
        continue;
      }

      const isPeak =
        k > 0 &&
        k < half &&
        m >= mag[k - 1] &&
        m >= mag[k + 1] &&
        m >= floorAbs;

      if (mapOn && isPeak) {
        // Untracked pitched: lock out-of-key onto the scale; in-key stays.
        let fHz = (freq[k] * sampleRate) / fftSize;
        if (!(fHz > 20 && fHz < sampleRate * 0.45)) fHz = hz;
        const lock = lockRatio(
          fHz,
          pitchRatio,
          key,
          scalePcs,
          maxShift,
          force,
          1,
        );
        const moved = Math.abs(lock.ratio - 1) > 0.001;
        if (moved || doGlobal) {
          depositShift(synMag, synFreq, freq, k, m, lock.ratio, half);
        } else {
          identityMag[k] += m;
        }
      } else if (doGlobal) {
        depositShift(synMag, synFreq, freq, k, m, pitchRatio, half);
      } else if (isPeak) {
        identityMag[k] += m;
      } else {
        residualMag[k] = m;
      }
    }
  } else {
    // No F0s — peak remap with the same musical gate
    for (let k = 0; k <= half; k++) {
      const m = mag[k];
      if (m < 1e-12) continue;

      const hz = k * binHz;
      const isPeak =
        k > 0 &&
        k < half &&
        m >= mag[k - 1] &&
        m >= mag[k + 1] &&
        m >= floorAbs;

      if (mapOn && isPeak) {
        const midi = hzToMidi(hz > 20 ? hz : k * binHz);
        const inKey = pcInKey(midi, key, scalePcs);
        const amt = inKey ? bandAmtForHz(hz, loAmt, midAmt, hiAmt, duck) : 1;
        let fHz = (freq[k] * sampleRate) / fftSize;
        if (!(fHz > 20 && fHz < sampleRate * 0.45)) fHz = hz;
        const lock = lockRatio(
          fHz,
          pitchRatio,
          key,
          scalePcs,
          maxShift,
          force,
          amt,
        );
        const moved = Math.abs(lock.ratio - 1) > 0.001;
        if (moved || doGlobal) {
          depositShift(synMag, synFreq, freq, k, m, lock.ratio, half);
        } else {
          identityMag[k] += m;
        }
      } else if (doGlobal) {
        depositShift(synMag, synFreq, freq, k, m, pitchRatio, half);
      } else if (isPeak) {
        identityMag[k] += m;
      } else {
        residualMag[k] = m;
      }
    }
  }

  for (let k = 0; k <= half; k++) {
    let rr = 0;
    let ii = 0;
    if (synMag[k] > 0) {
      const p = sumPhase[k];
      rr += synMag[k] * Math.cos(p);
      ii += synMag[k] * Math.sin(p);
      sumPhase[k] += (2 * Math.PI * synFreq[k] * hop) / fftSize;
    } else {
      sumPhase[k] += k * expect;
    }
    // In-key / unshifted pitched — original phase, not residual-scaled
    if (identityMag[k] > 0) {
      const p = inputPhase[k];
      rr += identityMag[k] * Math.cos(p);
      ii += identityMag[k] * Math.sin(p);
      synMag[k] += identityMag[k];
    }
    if (residualMag[k] > 0 && resAmt > 0) {
      const p = inputPhase[k];
      rr += residualMag[k] * resAmt * Math.cos(p);
      ii += residualMag[k] * resAmt * Math.sin(p);
      synMag[k] += residualMag[k] * resAmt;
    }
    re[k] = rr;
    im[k] = ii;
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
      {
        name: "residual",
        defaultValue: 1,
        minValue: 0,
        maxValue: 1,
        automationRate: "k-rate",
      },
      {
        name: "floor",
        defaultValue: 0.08,
        minValue: 0,
        maxValue: 1,
        automationRate: "k-rate",
      },
      {
        name: "bandLo",
        defaultValue: 1,
        minValue: 0,
        maxValue: 1,
        automationRate: "k-rate",
      },
      {
        name: "bandMid",
        defaultValue: 1,
        minValue: 0,
        maxValue: 1,
        automationRate: "k-rate",
      },
      {
        name: "bandHi",
        defaultValue: 0.4,
        minValue: 0,
        maxValue: 1,
        automationRate: "k-rate",
      },
      {
        name: "hits",
        defaultValue: 0.75,
        minValue: 0,
        maxValue: 1,
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
    this._viz = false;
    this._vizCountdown = 0;
    this._vizDry = new Float32Array(VIZ_BINS);
    this._vizWet = new Float32Array(VIZ_BINS);
    this._vizDryPos = new Float32Array(VIZ_BINS);
    this._vizWetPos = new Float32Array(VIZ_BINS);
    // HPS acquire (shared across L analysis; stereo R reuses last F0s for gate)
    const half = this.fftSize / 2;
    this._hps = new Float32Array(half + 1);
    this._f0Hz = new Float32Array(HPS_MAX_F0);
    this._f0Score = new Float32Array(HPS_MAX_F0);
    this._f0Log = new Float32Array(HPS_MAX_F0);
    this._f0N = new Int32Array(1);
    this._trackRatio = new Float32Array(HPS_MAX_F0);
    this._ehRing = new Float32Array(EH_RING);
    this._ehWr = 0;
    this._ehScratchE = new Float32Array(EH_TRACK_N);
    this._ehScratchH = new Float32Array(EH_TRACK_N);
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
      if (typeof d.viz === "boolean") this._viz = d.viz;
      // residual / floor / bands / hits are AudioParams (apply from main thread)
      // Drop accumulated PV / OLA state so mode changes don't "stick"
      if (reset) this._resetSynthState();
    };
  }

  _emitViz(ch, strength) {
    const half = this.fftSize / 2;
    const s = Math.min(1, Math.max(0, strength));
    fillVizLog(ch.mag, half, this._vizDry, this._vizDryPos);
    fillVizLog(ch.synMag, half, this._vizWet, this._vizWetPos);
    // Normalize shapes first, THEN apply strength to wet only.
    softNorm(this._vizDry);
    softNorm(this._vizWet);
    // Green = adjusted harmonics × strength: invisible at 0%, full at 100%.
    for (let i = 0; i < VIZ_BINS; i++) {
      this._vizWet[i] *= s;
    }
    // F0 markers: log(bin)/log(half) to match fillVizLog peak positions
    const nF0 = this._f0N[0] | 0;
    const binHz = sampleRate / this.fftSize;
    const logHalf = Math.log(half);
    for (let i = 0; i < HPS_MAX_F0; i++) {
      if (i < nF0 && this._f0Hz[i] > 0 && logHalf > 0) {
        const k = Math.max(1, this._f0Hz[i] / binHz);
        this._f0Log[i] = Math.log(k) / logHalf;
      } else {
        this._f0Log[i] = -1;
      }
    }
    this.port.postMessage({
      type: "viz",
      n: VIZ_BINS,
      a: this._vizDry,
      b: this._vizWet,
      xa: this._vizDryPos,
      xb: this._vizWetPos,
      f0: this._f0Log,
      f0N: nF0,
    });
  }

  _resetSynthState() {
    for (const ch of [this.L, this.R]) {
      ch.lastPhase.fill(0);
      ch.sumPhase.fill(0);
      ch.outFifo.fill(0);
      ch.outQueue.fill(0);
      ch.outAvail = 0;
      ch.outRead = 0;
      ch.lastMag.fill(0);
      ch.onsetEnv = 0;
      // keep inFifo / dryDelay so we don't click the input stream
    }
  }

  _emptyInput(n) {
    if (!this._empty || this._empty.length !== n) this._empty = new Float32Array(n);
    return this._empty;
  }

  _step(ch, x, frameOpts, emitViz) {
    const { fftSize, hop, olaGain } = this;
    const { pitchRatio, strength, doShift, maxShift } = frameOpts;

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

    // Mono analysis ring for M× E/H (L only — avoid double-write in stereo)
    if (emitViz) {
      this._ehRing[this._ehWr] = x;
      this._ehWr++;
      if (this._ehWr >= EH_RING) this._ehWr = 0;
    }

    if (ch.fill >= fftSize) {
      const mapMode = this._mode === "off" ? "off" : this._mode;
      const snapOn = mapMode === "snap" || mapMode === "remap";
      // Residual / peak split still needs processFrame when mapping is on,
      // even at unity transpose — identity OLA would skip the residual path.
      const needPv = doShift || snapOn;

      if (needPv) {
        processFrame(ch, this.window, fftSize, hop, {
          pitchRatio,
          mapMode,
          key: this._key,
          scalePcs: SCALE_PCS[this._scale] || SCALE_PCS.major,
          maxShift: Math.max(1, Math.min(12, maxShift | 0)),
          sampleRate: sampleRate,
          residual: frameOpts.residual,
          floor: frameOpts.floor,
          bandLo: frameOpts.bandLo,
          bandMid: frameOpts.bandMid,
          bandHi: frameOpts.bandHi,
          hits: frameOpts.hits,
          runHps: emitViz, // L only — stereo R reuses F0 list
          hps: this._hps,
          f0Hz: this._f0Hz,
          f0Score: this._f0Score,
          f0N: this._f0N,
          trackRatio: this._trackRatio,
          ehRing: this._ehRing,
          ehWr: this._ehWr,
          ehScratchE: this._ehScratchE,
          ehScratchH: this._ehScratchH,
        });
        if (emitViz && this._viz) {
          this._vizCountdown--;
          if (this._vizCountdown <= 0) {
            // every hop (~86 Hz @ 48k/512) — UI tweens between frames
            this._vizCountdown = 1;
            this._emitViz(ch, strength);
          }
        }
      } else {
        identityFrame(ch, this.window, fftSize);
        // still show dry spectrum when mapping is idle but viz is on
        if (emitViz && this._viz) {
          this._vizCountdown--;
          if (this._vizCountdown <= 0) {
            this._vizCountdown = 1;
            // analyze magnitudes without PV for the dry view
            const half = fftSize / 2;
            for (let i = 0; i < fftSize; i++) {
              ch.re[i] = ch.inFifo[i] * this.window[i];
              ch.im[i] = 0;
            }
            fft(ch.re, ch.im, false);
            for (let k = 0; k <= half; k++) {
              ch.mag[k] = Math.hypot(ch.re[k], ch.im[k]);
              ch.synMag[k] = ch.mag[k];
            }
            this._emitViz(ch, strength);
          }
        }
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
    const rArr = parameters.residual || [1];
    const fArr = parameters.floor || [0.08];
    const loArr = parameters.bandLo || [1];
    const midArr = parameters.bandMid || [1];
    const hiArr = parameters.bandHi || [0.4];
    const hArr = parameters.hits || [0.75];
    const s0 = sArr[0];
    const t0 = tArr[0];
    const m0 = mArr[0];
    const r0 = rArr[0];
    const f0 = fArr[0];
    const lo0 = loArr[0];
    const mid0 = midArr[0];
    const hi0 = hiArr[0];
    const h0 = hArr[0];
    const stereo = outR !== outL;

    for (let i = 0; i < n; i++) {
      const strength = this._on ? (sArr.length > 1 ? sArr[i] : s0) : 0;
      const transpose = tArr.length > 1 ? tArr[i] : t0;
      const maxShift = mArr.length > 1 ? mArr[i] : m0;
      const pitchRatio = Math.pow(2, transpose / 12);
      const doShift = Math.abs(transpose) > 0.02;
      const frameOpts = {
        pitchRatio,
        strength,
        doShift,
        maxShift,
        residual: rArr.length > 1 ? rArr[i] : r0,
        floor: fArr.length > 1 ? fArr[i] : f0,
        bandLo: loArr.length > 1 ? loArr[i] : lo0,
        bandMid: midArr.length > 1 ? midArr[i] : mid0,
        bandHi: hiArr.length > 1 ? hiArr[i] : hi0,
        hits: hArr.length > 1 ? hArr[i] : h0,
      };

      outL[i] = this._step(this.L, inL[i] || 0, frameOpts, true);
      if (stereo) {
        outR[i] = this._step(this.R, inR[i] || 0, frameOpts, false);
      }
    }
    return true;
  }
}

registerProcessor("ain-impartialer", AinImpartialerProcessor);
