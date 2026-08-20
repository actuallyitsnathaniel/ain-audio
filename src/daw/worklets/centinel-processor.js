// Centinel — US5973252A (expired) pitch corrector.
// Detect: 8:1 DS + recursive E/H. Correct: Cycle_period → rate + ±1 cycle.
// Decay = Retune Speed. Desired = nearest scale / MIDI-follow.
// formant 0–1: cepstral LPC envelope copy after splice (settled |R*| only).
// PSOLA remains for CYCLE_SPLICE=false only — not the AT reference.
// Product: G3 sticky + Humanize / Flex / DC finish; G5 Nat Vib after Decay.
// g6a: splice seam — no overlapping ±cycle xfades; raised-cosine join.
// Untracked (consonant / reverb smear): rate=1, keep sticky. Tracking knob = ε.
// E/H analysis is HP'd + 2L body preference so room delays don't own Cycle_period.
// Splice still reads the wet take (not a dereverb). Insert/delete phase-aligns ±pe.
// Splice re-arm: exit onset unity on ONSET_SPLICE_MS even when formant≥0.5 (LPC is a post, not a path).
//
// Build stamp — bump when diagnosing "did the worklet reload?" (AudioWorklets do NOT HMR).
const CENTINEL_BUILD = "2026-08-19g6a-join";

const N = 2048;
const N2 = N >> 1;
/** Note/UI hop — sticky decide cadence (E/H period updates every sample). */
const NOVERLAP = 8;
const DETECT_EVERY = N / NOVERLAP;
/**
 * US5973252A autocorrelation track.
 * Detection: anti-alias + 8:1 DS, L∈[2,110], test E−2H ≤ εE.
 * Correction: N=8 lag window, update every sample, refine every 5.
 */
const EH_DS = 8;
const EH_LMIN = 2;
const EH_LMAX = 110;
const EH_TRACK_N = 8;
const EH_REFINE_EVERY = 5;
const EH_EPS_TIGHT = 0.1;
const EH_EPS_LOOSE = 0.4;
const EH_DS_BUF = 256;
/** Relative period jump/refine → tracking failure → re-detect. */
const EH_MAX_REL_STEP = 0.18;
/** Consecutive refine fails before leaving correction mode. */
const EH_FAIL_NEED = 2;
/** formant-off wet = patent cycle splice (false → Fairbanks OLA). */
const CYCLE_SPLICE = true;
/** Cepstral-smoothed LPC envelope copy onto splice. */
const LPC_P = 16;
const CEP_N = 1024;
const CEP_LIFT = 30;
const LPC_WIN = CEP_N;
const LPC_HOP = 256;
const LPC_PRE = 0.97;
const LPC_KMAX = 0.995;
/** Pole shrink after Levinson — kills F0-ripple peaks that chew. */
const LPC_BW = 0.96;
/** Apply envelope copy only once |R*| exceeds this (cents) — else identity. */
const FORMANT_SHIFT_MIN_CENTS = 8;
/** |wantTgt − audibleWant| must be under this (cents) — no copy mid-glide. */
const FORMANT_SETTLE_CENTS = 8;
/** Fade the preserve amount so the settled gate doesn't click. */
const FORMANT_XFADE_MS = 12;
/** Per-sample E/H detect/track → `_periodSamp`. */
const EH_LIVE = true;
/** Splice Cycle_period uses E/H `_periodSamp`. */
const EH_DRIVE = true;
const F_MIN_DEFAULT = 110;
const F_MAX_DEFAULT = 700;
const AREF = 440;
const VIZ_BINS = 96;
const MIDI_LO = 36;
const MIDI_HI = 84;
const VIZ_EVERY = 2;
/** Hop confirm before arm — E/H correction-mode lock is the real gate. */
const STABLE_NEED = 1;
const MAX_JUMP_SEMI = 7;
/** G3: keep committed note until live is clearly closer (semitones). */
const STICKY_HYST_SEMI = 0.4;
const FACT_MIN = 0.5;
const FACT_MAX = 2.0;
const RMS_GATE = 0.01;
const UNVOICED_DROP = 40;
/** Sustained below RMS_GATE this long (ms) → close wet (phrase-end ring). */
const EDGE_QUIET_MS = 45;
/** Faster dry↔wet when edge-quiet — tails were +6…+17 dB vs dry. */
const EDGE_WET_XFADE_MS = 12;

/** Silvertune-style: ignore YIN wander within this while locked (semitones). */
const STAYS_LOCKED_SEMI = 0.44;
/** Base hold before committing a new note (ms). Soft speed stretches this. */
const HOLD_MS_BASE = 15;
/**
 * Raw must beat the sticky scale target by this much (semitones) before we
 * even start a retarget hold — stops boundary flip-flops Autotune doesn't do.
 * Lever 3: raised — land-click still ~31% note-disagree vs AT (A↔G# etc.).
 */
const RETUNE_HYST_SEMI = 0.46;
/** Extra hyst while pitch is stationary (flat sustains were flipping neighbors). */
const RETUNE_HYST_STABLE_EXTRA = 0.2;
/**
 * |signed pitch vel| above this (st/s) → judge retarget on live raw, not
 * vib-center. Vib-center lag was holding sticky through scoops → audible dips.
 */
const RETARGET_RAW_VEL_ST_S = 2.2;
/** Block non-gesture retargets that jump more than this (semitones). */
const MAX_RETARGET_STEP_SEMI = 4.5;
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
/** Cycle-splice: no Fairbanks/PSOLA PE settle — exit unity after this (formant knob is LPC post). */
const ONSET_SPLICE_MS = 18;
/** Failsafe: never hold R=1 longer than this after arm (ms). */
const ONSET_UNITY_MAX_MS = 260;
/** Fairbanks↔PSOLA crossfade (ms) — shorter = less muffled path handoff. */
const PSOLA_GATE_MS = 16;
/** Release formant-mode unity once PSOLA mix is at least this high. */
const ONSET_PSOLA_READY = 0.88;
/** Dry↔corrected wet crossfade (ms). Hard cuts here were the post-fixant pops. */
const WET_XFADE_MS = 16;
/**
 * After a note commit, prefer a fresh PSOLA grain for this long (ms).
 * No dual-grain OLA — overlapping old+new grains read as a slap/delay.
 */
const COMMIT_RECAPTURE_MS = 28; // was 40 — long unity muffled note edges vs AT
/**
 * Cold start (re-arm after silence): tapered Retune Speed floor + dry gate so
 * bare riffs/runs don't audition a staircase into the first notes.
 */
const COLD_START_MS = 400;
const COLD_START_SPEED_FLOOR_MS = 150;
/** Stay on latency-dry until |want−audible| is under this (cents), while cold. */
const COLD_WET_CENTS = 28;
/** Soft+PSOLA: briefly floor speed after a note commit (rapid runs).
 * Keep a real floor on note hops (anti-staircase). Center-chase is capped
 * to ~0.9× Retune Speed so we don't soft-floor then Cher-snap. */
const COMMIT_SOFT_MS = 70;
const COMMIT_SOFT_FLOOR_MS = 62;
/**
 * When pitch is stationary, never raise Retune Speed above the knob
 * (floor = min(this, spd) — a 27 ms speed must stay 27, not 36).
 */
const COMMIT_SOFT_STABLE_FLOOR_MS = 28;
/** Decay commit-soft timer faster once stationary. */
const COMMIT_SOFT_STABLE_DECAY = 2.2;
/**
 * Hard center-latch (want≡tgt) only at Cher-range Retune Speed.
 * At 20ms latch was killing micro-variation → robot without speed=0.
 */
const ROBOT_LATCH_MAX_SPEED_MS = 8;
/**
 * Natural Vibrato at knob=0 ("leave"): fraction of AC residual re-added.
 * g3d skipped |v|<0.001 → ceramic at the documented leave detent.
 * g5a put leave on wantTgt — Decay/Humanize low-passed it (lagged 10s park).
 * g5b: offset rides after Decay. Center park and vibrato are separate.
 */
const VIB_LEAVE_SCALE = 0.5;
/** Clamp |det − vibCenter| before leave (st) — larger = scoop, not vibrato. */
const VIB_RESID_MAX_SEMI = 0.38;
/** Smooth hop-to-hop residual so E/H refine jitter isn't injected as vibrato. */
const VIB_RESID_SLEW_MS = 18;
/** |resid|/max below this → full leave gate; fade to 0 at the clamp. */
const VIB_GATE_FULL = 0.55;
/** Leave-gate slew (ms). */
const VIB_GATE_SLEW_MS = 14;
/** Cold wet fade — slower than normal so the dry→tuned handoff isn't a step. */
const COLD_WET_XFADE_MS = 28;
// Detector confidence (reverb / multipitch).
// Below RETARGET: don't start a new note hold.
// Ambiguous frames also floor soft Retune Speed briefly.
// Low conf closes wet via hysteresis (not a continuous 0..1 gain — that
// comb-filtered dry+OLA and clicked). Close is debounced so room flutter
// doesn't flash dry mid-vowel. R*/want untouched.
const CONF_RETARGET = 0.55;
/** Open wet only after conf rises above this (exit duck). */
const CONF_WET_HI = 0.48;
/** Close wet when conf stays below this (enter duck). */
const CONF_WET_LO = 0.28;
/** Sustained low-conf time before closing wet (ms) — room reflection flutter. */
const CONF_WET_CLOSE_MS = 100;
/** Conf-driven dry↔wet fade — slower than normal so gate flips don't click. */
const CONF_WET_XFADE_MS = 48;
const REVERB_SOFT_MS = 140;
const REVERB_SOFT_FLOOR_MS = 100;
/**
 * Humanize (Auto-Tune–style): after this note age, stretch Retune Speed on
 * sustains so short notes stay tight while long notes breathe.
 * Gated: no stretch while audible want is still off sticky center — that was
 * fighting center-tight and leaving holds ~loose vs AT.
 */
const HUMANIZE_SUSTAIN_MS = 100;
/** Ramp from 0→full humanize stretch over this many ms past the sustain gate. */
const HUMANIZE_RAMP_MS = 120;
/** Extra Retune Speed (ms) at humanize=1 once fully sustained. */
const HUMANIZE_EXTRA_MS = 190;
/** After a sticky flip, chase faster so the new note lands (20s E→F#). */
const COMMIT_FAST_MS = 40;
const COMMIT_FAST_SPEED_MS = 8;
/** Skip humanize stretch while |audibleWant − tgt| exceeds this (cents).
 * 20¢ was still mid-glide — Humanize slowed the finish → pitchy 15–35¢ parks.
 * Gate to near-center so Retune Speed owns the last cents, then breathe. */
const HUMANIZE_OFF_CENTER_CENTS = 8;
/**
 * Post-commit center lock — stationary only. Target sustained loose holds
 * (15–35¢ ≥80 ms) left after hum-soft; don't touch scoop path.
 */
const CENTER_LOCK_AGE_MS = 22;
/** |audibleWant − tgt| window (cents) once glide has settled. */
const CENTER_LOCK_CENTS = 58;
/** Center-chase tau floor (ms) while stationary. */
const CENTER_LOCK_SPEED_MS = 7;
/** Glide settled: |wantTgt − audibleWant| under this (cents) before speeding up. */
const CENTER_LOCK_SETTLE_CENTS = 32;
/** Fast chase while parked in the loose-hold band (cents). */
const LOOSE_HOLD_LO_CENTS = 8;
const LOOSE_HOLD_HI_CENTS = 55;
const LOOSE_HOLD_SPEED_MS = 6;
/** Orphan sticky: shorter Decay so A↔B landings don't score as wrong-note frames. */
const ORPHAN_COMMIT_SOFT_MS = 28;
const ORPHAN_AUDIBLE_BLEND = 0.58;
/**
 * Cold post-gap orphan (dry_2 @ ~20s): near-snap want + advance cold floor.
 * g2m9 full snap+cold-kill fixed dry-through but Cher'd; g2n1 0.86/0.7 lost 20s.
 */
const COLD_ORPHAN_BLEND = 0.94;
/** Jump cold clock to this fraction of COLD_START_MS (keep a little attack soft). */
const COLD_ORPHAN_ADVANCE = 0.88;
/**
 * Soft-land: light brake in last cents. g2e over-sped chase and *added* loose
 * runs — keep moderate; kill parks by pinning wantBase (soft park latch).
 */
const SOFT_LAND_CENTS = 10;
/** Chase tau near dead-center while soft-landing (ms). */
const SOFT_LAND_FLOOR_MS = 14;
/** Allow center-chase while commit-soft has this much left (ms). */
const CENTER_LOCK_COMMIT_SOFT_MAX_MS = 48;
/**
 * Soft park latch (pop speeds): pin wantBase→tgt after note is aged + stable.
 * Hard centerLatch stays Cher-only; this kills 15–35¢ score parks without
 * robot plateaus. Escape on scoop / |det−tgt| growth.
 */
const SOFT_PARK_AGE_MS = 40;
const SOFT_PARK_AUD_HI_CENTS = 45;
const SOFT_PARK_DET_SEMI = 0.55;
/** Enter center latch once this close (cents), stationary — no hard R* snap. */
const SNAP_CENTER_CENTS = 7;
/** Leave center latch when |det − tgt| exceeds this (semitones). */
const CENTER_LATCH_ESCAPE_SEMI = 0.32;
/** Pull strength of sticky want → scale center while stationary. */
const CENTER_WANT_PULL = 0.68;
/** Extra bias of wantBase onto tgt once parked near center (stationary). */
const CENTER_WANT_BIAS = 0.72;
/**
 * Boundary soften (pop flex=0): only on *directed* scoops/gestures.
 * Engaging whenever |raw−sticky| > ~30¢ let rough/pitchy sustains pull want
 * with YIN jitter → "shaky" tuned vocal (m bounce: +shake reversals).
 */
/**
 * Boundary soften: follow det away from sticky on scoops so hard centers don't
 * fight an upward scoop (read as a weird downward bend vs dry).
 * Was 0.38 enter — too late; scoop already sounded bent.
 */
const BOUNDARY_FOLLOW_SEMI = 0.18;
/** Fraction of (det − stickyWant) to follow at full boundary. */
const BOUNDARY_FOLLOW_AMT = 0.55;
/** Semitone span over which boundary follow ramps 0→full. */
const BOUNDARY_FOLLOW_SPAN = 0.4;
/** Slow pitch center for Natural Vibrato extraction (ms). */
const VIB_CENTER_MS = 110;
/**
 * Pitch-velocity: season hold lightly; gate boundary-follow to gestures.
 */
const STABLE_VEL_ST_S = 2.8;
const GESTURE_VEL_ST_S = 8.0;
/** Medium scoop — may boundary-follow without full gesture flag. */
const SCOOP_VEL_ST_S = 4.5;
const STABLE_PITCH_MS = 28;
/** Longer confirm when parked — short stable holds were committing wrong neighbors. */
const HOLD_STABLE_SCALE = 1.45;
const HOLD_GESTURE_SCALE = 1.05;
/** Want-base slew — slower when stationary so roughness doesn't chatter. */
const WANT_BASE_SLEW_STABLE = 0.18;
const WANT_BASE_SLEW_GESTURE = 0.5;
/**
 * Midzone refine (p left mid→snap ~57 vs AT 44): enter earlier, softer hyst,
 * stronger pre-glide — still requires directed scoop (signed vel). Stationary
 * anti-shake / center path untouched by these gates.
 * dry_2: commit the neighbor sooner so we don't hard-park on the old note
 * through the scoop (y-ride sounded worse — this only shortens hold).
 */
const MIDZONE_ENTER_SEMI = 0.18;
const MIDZONE_CLOSE_SLACK = 0.2;
/** Midzone may lead, but 0.42 made neighbor flips hair-trigger on scoops. */
const MIDZONE_HYST_SCALE = 0.6;
const MIDZONE_HOLD_SCALE = 0.7;
/** Lower vel floor than SCOOP for midzone detection only. */
const MIDZONE_VEL_ST_S = 3.2;
/** Min |signed vel| toward neighbor (st/s). */
const MIDZONE_TOWARD_ST_S = 0.85;
/** Arm early hold once approach u reaches this. */
const MIDZONE_HOLD_ARM_U = 0.42;
/** Pre-glide strength before hold arms — 0.95 yanked toward wrong neighbor. */
const MIDZONE_PREGLIDE = 0.55;

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

/**
 * Flex-Tune island. 0 = always pull (pop). Higher = smaller radius around
 * the sticky note; scoops outside the island pass through.
 */
function flexCorrectionStrength(absErrSemi, flexCents) {
  const f = Math.max(0, Math.min(100, flexCents));
  if (f < 0.5) return 1;
  const u = f / 100;
  const radius = 0.5 * (1 - 0.8 * u);
  if (absErrSemi >= radius) return 0;
  const x = absErrSemi / Math.max(1e-6, radius);
  return (1 - x) * (1 - x);
}

function pullToward(det, tgt, amount, flexCents) {
  const err = tgt - det;
  const amt = Math.max(0, Math.min(1, amount));
  return det + err * amt * flexCorrectionStrength(Math.abs(err), flexCents);
}

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

/** Levinson–Durbin → reflection coeffs k[0..p). false on silence / unstable. */
function lpcLevinson(r, p, k, a, at) {
  let e = r[0];
  if (!(e > 1e-10)) return false;
  a[0] = 1;
  for (let i = 1; i <= p; i++) a[i] = 0;
  for (let m = 1; m <= p; m++) {
    let acc = r[m];
    for (let j = 1; j < m; j++) acc += a[j] * r[m - j];
    let km = -acc / e;
    if (km > LPC_KMAX) km = LPC_KMAX;
    else if (km < -LPC_KMAX) km = -LPC_KMAX;
    k[m - 1] = km;
    for (let j = 1; j < m; j++) at[j] = a[j] + km * a[m - j];
    for (let j = 1; j < m; j++) a[j] = at[j];
    a[m] = km;
    e *= 1 - km * km;
    if (!(e > 1e-12)) return false;
  }
  return true;
}

/** k → LPC a[0]=1, a[1..p]. `at` is scratch length p+1. */
function lpcKToA(k, a, at) {
  const p = k.length;
  a[0] = 1;
  for (let i = 1; i <= p; i++) a[i] = 0;
  for (let m = 1; m <= p; m++) {
    const km = k[m - 1];
    for (let j = 1; j < m; j++) at[j] = a[j] + km * a[m - j];
    for (let j = 1; j < m; j++) a[j] = at[j];
    a[m] = km;
  }
}

/** e = x + a[1]x[n-1] + … (whitening). z[i] = x[n-1-i]. */
function lpcWhiten(x, a, z) {
  const p = a.length - 1;
  let e = x;
  for (let i = 0; i < p; i++) e += a[i + 1] * z[i];
  for (let i = p - 1; i > 0; i--) z[i] = z[i - 1];
  z[0] = x;
  return e;
}

/** y = e − a[1]y[n-1] − … (all-pole). z[i] = y[n-1-i]. */
function lpcShape(e, a, z) {
  const p = a.length - 1;
  let y = e;
  for (let i = 0; i < p; i++) y -= a[i + 1] * z[i];
  for (let i = p - 1; i > 0; i--) z[i] = z[i - 1];
  z[0] = y;
  return y;
}

function fftRadix2(re, im, inverse) {
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
      const half = len >> 1;
      for (let j = 0; j < half; j++) {
        const uRe = re[i + j];
        const uIm = im[i + j];
        const vRe = re[i + j + half] * wRe - im[i + j + half] * wIm;
        const vIm = re[i + j + half] * wIm + im[i + j + half] * wRe;
        re[i + j] = uRe + vRe;
        im[i + j] = uIm + vIm;
        re[i + j + half] = uRe - vRe;
        im[i + j + half] = uIm - vIm;
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

class AinCentinelProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      {
        name: "mix",
        defaultValue: 1,
        minValue: 0,
        maxValue: 1,
        automationRate: "k-rate",
      },
      {
        name: "amount",
        defaultValue: 1,
        minValue: 0,
        maxValue: 1,
        automationRate: "k-rate",
      },
      {
        name: "speed",
        defaultValue: 25,
        minValue: 0,
        maxValue: 400,
        automationRate: "k-rate",
      },
      {
        name: "flex",
        defaultValue: 0,
        minValue: 0,
        maxValue: 100,
        automationRate: "k-rate",
      },
      {
        name: "humanize",
        defaultValue: 0,
        minValue: 0,
        maxValue: 1,
        automationRate: "k-rate",
      },
      {
        name: "vibrato",
        defaultValue: 0,
        minValue: -1,
        maxValue: 1,
        automationRate: "k-rate",
      },
      {
        name: "tracking",
        defaultValue: 1,
        minValue: 0,
        maxValue: 1,
        automationRate: "k-rate",
      },
      {
        name: "formant",
        defaultValue: 0,
        minValue: 0,
        maxValue: 1,
        automationRate: "k-rate",
      },
      {
        name: "transpose",
        defaultValue: 0,
        minValue: -12,
        maxValue: 12,
        automationRate: "k-rate",
      },
    ];
  }

  constructor(options) {
    super(options);
    this.cbiL = new Float32Array(N);
    this.cbiR = new Float32Array(N);
    this.cboL = new Float32Array(N);
    this.cboR = new Float32Array(N);
    this.fragL = new Float32Array(N);
    this.fragR = new Float32Array(N);
    /** PSOLA grain snapshot (separate from Fairbanks frag — D5b crossfade). */
    this.psolaL = new Float32Array(N);
    this.psolaR = new Float32Array(N);
    this.cbiwr = 0;
    this.cbord = 0;
    this._sampleCount = 0;

    this.hann = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      this.hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
    }

    this._rmsWin = new Float32Array(N2);
    /** Patent E/H — downsampled detect + full-rate correction track. */
    this._ed = new Float32Array(EH_LMAX + 1);
    this._hd = new Float32Array(EH_LMAX + 1);
    this._dsBuf = new Float32Array(EH_DS_BUF);
    this._dsWr = 0;
    this._dsN = 0;
    this._dsAcc = 0;
    this._dsLpf = 0;
    this._dsLpfCoeff = Math.exp((-2 * Math.PI * (0.45 * sampleRate) / EH_DS) / sampleRate);
    /** Analysis-only DC block (~120 Hz). Splice still reads raw cbi. */
    this._ehHp = 0;
    this._ehHpPrev = 0;
    this._ehHpBuf = new Float32Array(N);
    this._trackE = new Float32Array(EH_TRACK_N);
    this._trackH = new Float32Array(EH_TRACK_N);
    this._ehOffset = 0;
    this._ehRefineCnt = 0;
    this._ehSeeded = false;
    this._detectionMode = true;
    this._ehClarity = 0;
    this._ehEps = EH_EPS_TIGHT;
    this._ehFail = 0;

    this._on = true;
    this._key = 0;
    this._scale = "major";
    this._customPcs = DEFAULT_CUSTOM.slice();
    this._midiFollow = false;
    this._midiNotes = [];
    this._viz = true;
    this._empty = null;
    // Offline/headless: apply key/scale from processorOptions so the first
    // quantum isn't C-major before a port "config" arrives (bimodal scores).
    const po = (options && options.processorOptions) || {};
    if (typeof po.key === "number") this._key = ((po.key % 12) + 12) % 12;
    if (typeof po.scale === "string") this._scale = po.scale;
    if (Array.isArray(po.customPcs)) {
      this._customPcs = po.customPcs.filter((n) => n >= 0 && n <= 11);
    }
    if (typeof po.inputType === "string" && INPUT_HZ[po.inputType]) {
      this._inputType = po.inputType;
      this._fMin = INPUT_HZ[po.inputType].fMin;
      this._fMax = INPUT_HZ[po.inputType].fMax;
    }
    if (typeof po.on === "boolean") this._on = po.on;
    /** Offline only: post |periodSamp − 1/inphinc| (G1 Step 0). Live UI off. */
    this._ehValidate = !!po.ehValidate;
    this._ehValHop = 0;

    this.phasein = 0;
    this.phaseout = 0;
    this.inphinc = AREF / sampleRate;
    this._inphincTgt = this.inphinc;
    this.outphinc = this.inphinc;
    this.phincfact = 1;
    this._phincSlew = 1;
    /** Target pitch ratio R* = hz(committedWant)/hz(lockedDet); chased in process. */
    this._rStar = 1;
    /**
     * G2 cycle-splice: read delay (samples) behind cbiwr. Nominal = N2 so wet
     * lines up with latency-dry. rate>1 shrinks delay → +=pe (repeat cycle);
     * rate<1 grows delay → −=pe (delete cycle).
     */
    this._spliceDelay = N2;
    this._spliceInit = false;
    this._spliceXf = 0;
    this._spliceXfN = 24;
    this._spliceXfDelay = N2;
    this._lpcR = new Float32Array(LPC_P + 1);
    this._lpcAWork = new Float32Array(LPC_P + 1);
    this._lpcAt = new Float32Array(LPC_P + 1);
    this._cepRe = new Float32Array(CEP_N);
    this._cepIm = new Float32Array(CEP_N);
    this._cepHann = new Float32Array(CEP_N);
    for (let i = 0; i < CEP_N; i++)
      this._cepHann[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / CEP_N));
    this._lpcKDry = new Float32Array(LPC_P);
    this._lpcKWet = new Float32Array(LPC_P);
    this._lpcKDryTgt = new Float32Array(LPC_P);
    this._lpcKWetTgt = new Float32Array(LPC_P);
    this._lpcADry = new Float32Array(LPC_P + 1);
    this._lpcAWet = new Float32Array(LPC_P + 1);
    this._lpcADry[0] = 1;
    this._lpcAWet[0] = 1;
    this._lpcZxL = new Float32Array(LPC_P);
    this._lpcZxR = new Float32Array(LPC_P);
    this._lpcZyL = new Float32Array(LPC_P);
    this._lpcZyR = new Float32Array(LPC_P);
    this._lpcWetL = new Float32Array(LPC_WIN);
    this._lpcWetR = new Float32Array(LPC_WIN);
    this._lpcWetWr = 0;
    this._lpcHop = 0;
    this._lpcPreXL = 0;
    this._lpcPreXR = 0;
    this._lpcPreYL = 0;
    this._lpcPreYR = 0;
    this._lpcHave = false;
    this._lpcKAlpha = 1 - Math.exp(-1 / Math.max(1, 0.006 * sampleRate));
    this._formantAmt = 0;
    /** Prefer fresh PSOLA grain after note commit (single buffer — no slap). */
    this._commitRecapture = false;
    this._commitRecaptureMs = 0;
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
    /** Sticky Fairbanks/PSOLA path — hysteresis avoids hard-switch clicks. */
    this._psolaPath = false;
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
    /** Cycle_period (samples) from E/H correction mode; 0 = unknown. */
    this._periodSamp = 0;
    this._periodMidi = 60;
    this._trackOk = false;
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
    /** Smoothed detector confidence (clarity × multipitch penalty). */
    this._pitchConf = 0;
    /**
     * Hysteretic wet enable from confidence. Continuous conf→wet gain
     * comb-filtered latency-dry vs pitched OLA (stretch + clicks).
     */
    this._confWetOpen = true;
    /** Accumulated ms with conf < LO while gate open (close debounce). */
    this._confWetLowMs = 0;
    this._ambiguous = false;
    /** Brief soft speed floor after ambiguous (reverb) frames. */
    this._reverbSoftMs = 0;
    this._stable = 0;
    this._armed = false;
    this._everLocked = false;
    this._olaGain = 0;
    /** 0 = latency dry · 1 = corrected wet — always slewed (never hard-cut). */
    this._wetMix = 0;
    this._unvoicedN = 0;
    this._analysisRms = 0;
    /** Sustained low-RMS: close wet before full UNVOICED_DROP (edge ring). */
    this._edgeQuiet = false;
    this._edgeQuietMs = 0;
    this._speedMs = 0;
    /** Speed after Humanize / DC finish — drives ratio chase. */
    this._effSpeedMs = 0;
    this._humanize = 0;
    this._flexCents = 0;
    this._vibrato = 0;
    /** ms since last note commit (Humanize sustain gate). */
    this._noteAgeMs = 0;
    /** Slow det center for Natural Vibrato residual. */
    this._vibCenter = 60;
    /** Slewed vibrato residual (anti-shake from hop-rate E/H jitter). */
    this._vibSemiSlew = 0;
    /** Slewed leave-gate 0..1 (no hard motion on/off). */
    this._vibGateSlew = 0;
    /** AC residual (st) added after Decay — not on wantTgt. */
    this._vibOffset = 0;
    /** |d pitch / dt| (st/s), smoothed — portamento vs stationary. */
    this._pitchVel = 0;
    /** Signed pitch velocity (st/s) — direction of scoops. */
    this._signedPitchVel = 0;
    this._prevRawVel = 60;
    this._haveRawVel = false;
    /** ms with pitchVel under STABLE_VEL (DPW-style critical time). */
    this._stablePitchMs = 0;
    /** Hold owned-sustain finish across brief vel spikes (14s park). */
    this._ownedSustainHoldMs = 0;
    /** Slewed want base — prevents soft pops from hop-to-hop boundary jumps. */
    this._wantBaseSlew = 60;
    /** Re-arm after silence — softer first correction under soft+PSOLA. */
    this._coldStart = false;
    this._coldStartMs = 0;
    /** ms of post-commit soft speed floor (rapid runs). */
    this._commitSoftMs = 0;
    /**
     * Soft+PSOLA: Retune Speed slews this toward sticky want (per-sample).
     * Robot snaps. Avoids R*-jump + fact-chase double staircase.
     */
    this._audibleWant = 60;
    /** Target for audible want (committedWant only — Nat Vib is after Decay). */
    this._wantTgt = 60;
    /** Parked on sticky center — hold want at tgt until scoop/commit (anti-click). */
    this._centerLatched = false;
    /** Next commit is orphan sticky release — faster audible blend. */
    this._orphanCommit = false;
    this._formant = 0;
    this._vizTick = 0;
    this._warmup = N;
    this._detectDt = DETECT_EVERY / sampleRate;
    this._noteDt = DETECT_EVERY / sampleRate;
    this._detectHop = 0;
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
      // Transport seek / loop wrap — sticky note + detect phase must not
      // carry across; that was "random" wrong notes on identical loops.
      if (d.type === "reset") {
        this._resetCorrectionState();
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
      if (typeof d.ehValidate === "boolean") this._ehValidate = d.ehValidate;
      if (typeof d.inputType === "string" && INPUT_HZ[d.inputType]) {
        this._inputType = d.inputType;
        this._fMin = INPUT_HZ[d.inputType].fMin;
        this._fMax = INPUT_HZ[d.inputType].fMax;
      }
    };
  }

  /**
   * Clear pitch / OLA sticky state. Transport seek/loop: clearRing so detect
   * phase restarts clean. Phrase unvoiced: keep the ring (zeroing under a live
   * dry read clicks).
   */
  _resetCorrectionState(clearRing = true) {
    if (clearRing) {
      this.cbiL.fill(0);
      this.cbiR.fill(0);
      this.cbiwr = 0;
      this._warmup = N;
    }
    this._detectHop = 0;
    this._armed = false;
    this._havePitch = false;
    this._noteLocked = false;
    this._pendingHold = false;
    this._holdAccumMs = 0;
    this._stable = 0;
    this._voiced = false;
    this._unvoicedN = 0;
    this._clarity = 0;
    this._pitchConf = 0;
    this._ambiguous = false;
    this._everLocked = false;
    this._centerLatched = false;
    this._orphanCommit = false;
    this._coldStart = false;
    this._coldStartMs = 0;
    this._commitSoftMs = 0;
    this._reverbSoftMs = 0;
    this._noteAgeMs = 0;
    this._haveRawVel = false;
    this._pitchVel = 0;
    this._signedPitchVel = 0;
    this._stablePitchMs = 0;
    this._confWetOpen = true;
    this._confWetLowMs = 0;
    this._edgeQuiet = false;
    this._edgeQuietMs = 0;
    this._onsetUnity = false;
    this._onsetUnityMs = 0;
    this._clearCommitRecapture();
    this._psolaHalf = 0;
    this._psolaWant = false;
    this._psolaGate = 0;
    this._psolaOnsetMs = 0;
    this._psolaPeStable = 0;
    this._psolaPePrev = 0;
    this._psolaPath = false;
    this._psolaOla = 0.7;
    this.fragsize = 0;
    this.phasein = 0;
    this.phaseout = 0;
    this.phincfact = 1;
    this._phincSlew = 1;
    this._rStar = 1;
    this.inphinc = 0;
    this.outphinc = 0;
    this._inphincTgt = 0;
    this._resetCycleSplice();
    this._detMidi = 60;
    this._tgtMidi = 60;
    this._outMidi = 60;
    this._corrMidi = 60;
    this._lockedDet = 60;
    this._committedWant = 60;
    this._committedTgt = 60;
    this._naturalTgt = 60;
    this._holdCand = 60;
    this._audibleWant = 60;
    this._wantTgt = 60;
    this._wantBaseSlew = 60;
    this._vibCenter = 60;
    this._vibSemiSlew = 0;
    this._vibGateSlew = 0;
    this._vibOffset = 0;
    if (clearRing) {
      this._stopPeriodTrack();
      this._wetMix = 0;
    } else {
      // Phrase gap: fail → re-detect, keep DS E/H so the next onset isn't cold.
      this._trackOk = false;
      this._periodSamp = 0;
      this._detectionMode = true;
      this._ehRefineCnt = 0;
      this._ehSeeded = false;
      this._ehFail = 0;
      this._trackE.fill(0);
      this._trackH.fill(0);
    }
  }

  _stopPeriodTrack() {
    this._trackOk = false;
    this._periodSamp = 0;
    this._detectionMode = true;
    this._ehRefineCnt = 0;
    this._ehSeeded = false;
    this._ehClarity = 0;
    this._ehFail = 0;
    this._ed.fill(0);
    this._hd.fill(0);
    this._trackE.fill(0);
    this._trackH.fill(0);
    this._dsBuf.fill(0);
    this._dsWr = 0;
    this._dsN = 0;
    this._dsAcc = 0;
    this._dsLpf = 0;
    this._ehHp = 0;
    this._ehHpPrev = 0;
    this._ehHpBuf.fill(0);
  }

  _resetCycleSplice() {
    this._spliceDelay = N2;
    this._spliceInit = false;
    this._spliceXf = 0;
    this._spliceXfDelay = N2;
    this._lpcReset();
  }

  _lpcReset() {
    this._lpcKDry.fill(0);
    this._lpcKWet.fill(0);
    this._lpcKDryTgt.fill(0);
    this._lpcKWetTgt.fill(0);
    this._lpcADry.fill(0);
    this._lpcAWet.fill(0);
    this._lpcADry[0] = 1;
    this._lpcAWet[0] = 1;
    this._lpcZxL.fill(0);
    this._lpcZxR.fill(0);
    this._lpcZyL.fill(0);
    this._lpcZyR.fill(0);
    this._lpcWetL.fill(0);
    this._lpcWetR.fill(0);
    this._lpcWetWr = 0;
    this._lpcHop = 0;
    this._lpcPreXL = 0;
    this._lpcPreXR = 0;
    this._lpcPreYL = 0;
    this._lpcPreYR = 0;
    this._lpcHave = false;
    this._formantAmt = 0;
  }

  /** True when patent cycle-splice owns the wet path. formant = envelope preserve. */
  _useCycleSplice() {
    return CYCLE_SPLICE;
  }

  /**
   * Soft Retune / patent Decay: glide want→tgt across notes at Retune Speed.
   * PSOLA formant path, or cycle-splice (formant-off) — Fairbanks stays
   * within-note-only when CYCLE_SPLICE is off.
   */
  _softRatioChase() {
    if (!(this._effSpeedMs >= 0.5)) return false;
    if (this._formant >= 0.5) return true;
    return this._useCycleSplice();
  }

  _ringMono(at) {
    const j = ((at % N) + N) % N;
    return 0.5 * (this.cbiL[j] + this.cbiR[j]);
  }

  _dsMono(at) {
    const j = ((at % EH_DS_BUF) + EH_DS_BUF) % EH_DS_BUF;
    return this._dsBuf[j];
  }

  /** HP'd analysis ring — E/H only. Splice still uses cbi. */
  _ehMono(at) {
    const j = ((at % N) + N) % N;
    return this._ehHpBuf[j];
  }

  /** Snapshot E(L), H(L) over last 2L samples ending at wr. */
  _ehSnapshot(L, wr, monoFn) {
    let E = 0;
    let H = 0;
    for (let j = 0; j < 2 * L; j++) {
      const x = monoFn.call(this, wr - j);
      E += x * x;
    }
    for (let j = 0; j < L; j++) {
      H += monoFn.call(this, wr - j) * monoFn.call(this, wr - j - L);
    }
    return { E, H };
  }

  _ehEnterCorrection(peFull) {
    const peMin = Math.max(16, Math.floor(sampleRate / this._fMax));
    const peMax = Math.min(N2 - 4, Math.floor(sampleRate / this._fMin));
    let pe = peFull;
    if (!(pe >= peMin && pe <= peMax)) return false;
    pe = Math.max(peMin, Math.min(peMax, pe));
    const L0 = Math.round(pe);
    const half = EH_TRACK_N >> 1;
    let off = L0 - half;
    if (off < peMin) off = peMin;
    if (off + EH_TRACK_N - 1 > peMax) off = Math.max(peMin, peMax - EH_TRACK_N + 1);
    this._ehOffset = off | 0;
    const wr = this.cbiwr;
    for (let k = 0; k < EH_TRACK_N; k++) {
      const L = this._ehOffset + k;
      const { E, H } = this._ehSnapshot(L, wr, this._ehMono);
      this._trackE[k] = E;
      this._trackH[k] = H;
    }
    const prevPe = this._periodSamp;
    this._periodSamp = pe;
    this._periodMidi = this._foldIntoRange(hzToMidi(sampleRate / pe));
    this._detectionMode = false;
    this._trackOk = true;
    this._ehRefineCnt = 0;
    this._ehFail = 0;
    this._ehSeeded = true;
    // Period octave (harmonic→f0): notes / R* follow E/H. octaveLock-to-old-midi
    // was a YIN leftover that shifted a correct C#4 period back up to C#5.
    if (prevPe > 1) {
      const ratio = pe / prevPe;
      const oct = (ratio > 1.8 && ratio < 2.3) || (ratio > 0.43 && ratio < 0.56);
      if (oct) {
        const pm = this._periodMidi;
        this._lockedDet = pm;
        this._detMidi = pm;
        if (typeof this._committedTgt === "number")
          this._committedTgt = octaveLock(this._committedTgt, pm);
        if (typeof this._audibleWant === "number")
          this._audibleWant = octaveLock(this._audibleWant, pm);
        if (typeof this._wantTgt === "number")
          this._wantTgt = octaveLock(this._wantTgt, pm);
      }
    }
    // inphinc is written from periodSamp in process() (E/H owns the period).
    if (this._ehClarity < 0.4) this._ehClarity = 0.55;
    return true;
  }

  _ehFailToDetect() {
    this._ehFail++;
    if (this._ehFail < EH_FAIL_NEED) return;
    this._detectionMode = true;
    this._trackOk = false;
    this._periodSamp = 0;
    this._ehClarity *= 0.5;
    this._ehFail = 0;
    // Patent: fail → re-detect, rate = 1. Do not keep shifting on a stale R*.
    this.phincfact = 1;
    this._phincSlew = 1;
    this._rStar = 1;
  }

  /**
   * Detection mode: best local min of E−2H ≤ εE inside the input-type band
   * (patent searches L=2…110 then octave-checks; we restrict to vocal lags so
   * the first short-L harmonic trough doesn't win).
   */
  _ehDetectFromDown() {
    const eps = this._ehEps;
    const peMin = Math.max(16, Math.floor(sampleRate / this._fMax));
    const peMax = Math.min(N2 - 4, Math.floor(sampleRate / this._fMin));
    const lDsMin = Math.max(EH_LMIN, Math.ceil(peMin / EH_DS));
    const lDsMax = Math.min(EH_LMAX, Math.floor(peMax / EH_DS));
    if (lDsMax <= lDsMin + 1) return;

    let bestL = 0;
    let bestNrm = Infinity;
    let bestBody = -1;
    for (let L = lDsMin; L <= lDsMax; L++) {
      const E = this._ed[L];
      if (!(E > 1e-8)) continue;
      const cost = E - 2 * this._hd[L];
      if (cost > eps * E) continue;
      const c0 = L > lDsMin ? this._ed[L - 1] - 2 * this._hd[L - 1] : Infinity;
      const c2 = L < lDsMax ? this._ed[L + 1] - 2 * this._hd[L + 1] : Infinity;
      if (!(cost <= c0 && cost <= c2)) continue;
      const nrm = cost / E;
      // Well-bodied f0: 2L still meets ε. A room-delay trough usually doesn't.
      // Prefer that class, then lowest normalized cost. Output is still the wet take.
      let body = 0;
      const L2 = L * 2;
      if (L2 <= lDsMax) {
        const E2 = this._ed[L2];
        if (E2 > 1e-8) {
          const n2 = (E2 - 2 * this._hd[L2]) / E2;
          if (n2 <= EH_EPS_LOOSE) body = 1;
        }
      }
      if (body > bestBody || (body === bestBody && nrm < bestNrm)) {
        bestBody = body;
        bestNrm = nrm;
        bestL = L;
      }
    }
    if (!bestL) return;

    // Patent octave check on the same DS E/H: 2L/4L often still meet ε when
    // the search landed on a harmonic. Stop before subharmonic (~C#3).
    let L = bestL;
    for (let k = 0; k < 2; k++) {
      const L2 = L * 2;
      if (L2 > lDsMax) break;
      const pe2 = L2 * EH_DS;
      if (pe2 > peMax || sampleRate / pe2 < 140) break;
      const E2 = this._ed[L2];
      if (!(E2 > 1e-8)) break;
      const n2 = (E2 - 2 * this._hd[L2]) / E2;
      if (n2 <= EH_EPS_LOOSE) L = L2;
      else break;
    }
    this._ehFail = 0;
    this._ehEnterCorrection(L * EH_DS);
  }

  /**
   * Correction-mode refine (every EH_REFINE_EVERY samples): min E−2H in window,
   * quadratic period, slide lag band (US5973252A FIGS 5A–5C).
   * @returns {boolean} false → tracking failed
   */
  _ehRefineTrack() {
    const eps = this._ehEps;
    let bestK = -1;
    let bestCost = Infinity;
    let bestE = 0;
    for (let k = 0; k < EH_TRACK_N; k++) {
      const E = this._trackE[k];
      if (!(E > 1e-12)) continue;
      const cost = E - 2 * this._trackH[k];
      if (cost < bestCost) {
        bestCost = cost;
        bestK = k;
        bestE = E;
      }
    }
    if (bestK < 0 || bestCost > EH_EPS_LOOSE * bestE) return false;
    // Soft accept absolute min even if slightly above eps (shape change).
    if (bestCost > eps * bestE && bestCost > 0.05 * bestE) {
      // Still ok if clearly the trough
    }

    let L = this._ehOffset + bestK;
    if (bestK > 0 && bestK < EH_TRACK_N - 1) {
      const c0 = this._trackE[bestK - 1] - 2 * this._trackH[bestK - 1];
      const c1 = bestCost;
      const c2 = this._trackE[bestK + 1] - 2 * this._trackH[bestK + 1];
      const denom = 2 * (2 * c1 - c2 - c0);
      if (Math.abs(denom) > 1e-18) {
        const delta = (c2 - c0) / denom;
        if (delta > -1.25 && delta < 1.25) L += delta;
      }
    }

    const peMin = Math.max(16, sampleRate / this._fMax);
    const peMax = Math.min(N2 - 4, sampleRate / this._fMin);
    let pe = Math.max(peMin, Math.min(peMax, L));
    const prev = this._periodSamp;
    if (prev > 1) {
      const rel = Math.abs(pe - prev) / prev;
      if (rel > EH_MAX_REL_STEP) return false;
    }
    this._periodSamp = pe;
    this._periodMidi = this._foldIntoRange(hzToMidi(sampleRate / pe));
    this._trackOk = true;
    this._ehFail = 0;
    const fit = bestE > 1e-12 ? Math.max(0, 1 - bestCost / bestE) : 0;
    this._ehClarity = Math.max(0, Math.min(1, fit));

    // Locked on a harmonic: 2L still meets ε → re-seed on the fundamental.
    // hz>450 so F#4 (~370) stays. Above ~520 Hz (C#5+) fold even if the
    // harmonic trough is tighter — that's this 21s C#4 sung as C#5.
    const pe2 = pe * 2;
    const hz = sampleRate / pe;
    const hz2 = sampleRate / pe2;
    if (hz > 450 && pe2 >= peMin && pe2 <= peMax && hz2 >= 140) {
      const b = this._ehSnapshot(pe2, this.cbiwr, this._ehMono);
      const cb = b.E > 1e-12 ? (b.E - 2 * b.H) / b.E : Infinity;
      if (cb <= EH_EPS_LOOSE || hz > 520) {
        this._ehEnterCorrection(pe2);
        return true;
      }
    }

    // Slide lag window when min hugs an edge (patent EH_Offset shift).
    if (bestK <= 1 || bestK >= EH_TRACK_N - 2) {
      this._ehEnterCorrection(pe);
    }
    return true;
  }

  /**
   * Per-sample patent path: DS detect updates + full-rate E/H track.
   * Call after writing cbi[cbiwr].
   */
  _ehOnSample() {
    const xRaw = this._ringMono(this.cbiwr);
    // Analysis HP (~120 Hz): drop LF room so E/H locks the glottal/body cycle.
    // Splice still interpolates raw cbi — this is not a dereverb.
    const R = this._hpCoeff;
    const x = R * (this._ehHp + xRaw - this._ehHpPrev);
    this._ehHp = x;
    this._ehHpPrev = xRaw;
    this._ehHpBuf[this.cbiwr] = x;
    // Anti-alias (one-pole) + 8:1 downsample for detection mode.
    const a = this._dsLpfCoeff;
    this._dsLpf = a * this._dsLpf + (1 - a) * x;
    this._dsN++;
    if (this._dsN >= EH_DS) {
      this._dsN = 0;
      const y = this._dsLpf;
      this._dsBuf[this._dsWr] = y;
      // Recursive Edown/Hdown for L∈[2,110]
      const dwr = this._dsWr;
      const y2 = y * y;
      for (let L = EH_LMIN; L <= EH_LMAX; L++) {
        const yL = this._dsMono(dwr - L);
        const y2L = this._dsMono(dwr - 2 * L);
        let E = this._ed[L] + y2 - y2L * y2L;
        let H = this._hd[L] + y * yL - yL * y2L;
        if (E < 0) E = 0;
        this._ed[L] = E;
        this._hd[L] = H;
      }
      this._dsWr++;
      if (this._dsWr >= EH_DS_BUF) this._dsWr = 0;
      if (this._detectionMode) this._ehDetectFromDown();
    }

    if (this._detectionMode) return;

    if (this._ehSeeded) {
      this._ehSeeded = false;
      return;
    }

    // Correction mode: update narrow E/H every sample.
    const xi = x;
    const xi2 = xi * xi;
    for (let k = 0; k < EH_TRACK_N; k++) {
      const L = this._ehOffset + k;
      const xiL = this._ehMono(this.cbiwr - L);
      const xi2L = this._ehMono(this.cbiwr - 2 * L);
      let E = this._trackE[k] + xi2 - xi2L * xi2L;
      let H = this._trackH[k] + xi * xiL - xiL * xi2L;
      if (E < 0) E = 0;
      this._trackE[k] = E;
      this._trackH[k] = H;
    }
    this._ehRefineCnt++;
    if (this._ehRefineCnt % EH_REFINE_EVERY === 0) {
      if (!this._ehRefineTrack()) this._ehFailToDetect();
    }
  }

  /**
   * US5973252A corrector: interpolate input at a rate-converted read pointer;
   * ± one Cycle_period when delay leaves the N2±pe window. One join at a
   * time — wait out the seam before the next ±cycle (g6a).
   * @returns {[number, number]} wet L/R
   */
  _cycleSpliceSample(rate) {
    if (!this._spliceInit) {
      this._spliceDelay = N2;
      this._spliceInit = true;
    }
    // Cycle_period: E/H when tracking; else last inphinc.
    let pe =
      EH_DRIVE && this._trackOk && this._periodSamp > 1
        ? this._periodSamp
        : this.inphinc > 1e-6
          ? 1 / this.inphinc
          : sampleRate / Math.max(1e-6, midiToHz(this._lockedDet));
    pe = this._clampPe(pe);
    const r = Math.max(FACT_MIN, Math.min(FACT_MAX, rate));

    this._spliceDelay += 1 - r;
    if (this._spliceXf > 0) this._spliceXfDelay += 1 - r;

    const minD = Math.max(pe * 0.35, N2 - pe);
    const maxD = Math.min(N - pe - 4, N2 + pe);
    const before = this._spliceDelay;
    // Patent: ± one Cycle_period. Do not start another join while a seam
    // is still fading — overlapping xfades warble on note runs (g6a).
    const canJoin = this._spliceXf <= 0;
    if (canJoin && this._spliceDelay < minD)
      this._spliceDelay += this._alignedPe(this._spliceDelay, pe, 1);
    else if (canJoin && this._spliceDelay > maxD)
      this._spliceDelay -= this._alignedPe(this._spliceDelay, pe, -1);
    if (this._spliceDelay < 4) this._spliceDelay = 4;
    if (this._spliceDelay > N - 4) this._spliceDelay = N - 4;

    if (this._spliceDelay !== before) {
      this._spliceXfDelay = before;
      this._spliceXfN = Math.max(8, Math.min(48, pe * 0.25));
      this._spliceXf = 1;
    }

    const indd = this.cbiwr - this._spliceDelay;
    let l = cubicAt(this.cbiL, indd);
    let rS = cubicAt(this.cbiR, indd);
    if (this._spliceXf > 0) {
      const ind0 = this.cbiwr - this._spliceXfDelay;
      // Raised-cosine, sums to 1 — smoother than a linear dump, no extra
      // boost on a phase-aligned cycle (equal-power would bump).
      const t = 1 - this._spliceXf;
      const wOld = 0.5 * (1 + Math.cos(Math.PI * t));
      const wNew = 1 - wOld;
      l = wOld * cubicAt(this.cbiL, ind0) + wNew * l;
      rS = wOld * cubicAt(this.cbiR, ind0) + wNew * rS;
      this._spliceXf -= 1 / this._spliceXfN;
      if (this._spliceXf < 0) this._spliceXf = 0;
    }
    return [l, rS];
  }

  /**
   * Distance along ±Cycle_period that best matches the current delay tap.
   * Still one cycle — a few-sample phase hunt, not a second period estimate.
   */
  _alignedPe(delay, pe, dir) {
    const span = Math.max(2, Math.min(14, (pe * 0.12) | 0));
    const nW = Math.max(8, Math.min(20, (pe * 0.18) | 0));
    const wr = this.cbiwr;
    let best = pe;
    let bestErr = Infinity;
    for (let k = -span; k <= span; k++) {
      const cand = pe + k;
      if (cand < 8 || cand > N2 - 4) continue;
      let err = 0;
      for (let i = 0; i < nW; i++) {
        const a = this._ringMono(wr - delay - i);
        const b = this._ringMono(wr - (delay + dir * cand) - i);
        const d = a - b;
        err += d * d;
      }
      if (err < bestErr) {
        bestErr = err;
        best = cand;
      }
    }
    return best;
  }

  /**
   * Cepstral-smoothed autocorr → Levinson. Lifter strips F0 harmonic ripples
   * so the IIR follows the throat, not the pitch comb.
   */
  _lpcFitRing(buf, wr, kTgt) {
    const nBuf = buf.length;
    const re = this._cepRe;
    const im = this._cepIm;
    const hann = this._cepHann;
    for (let i = 0; i < CEP_N; i++) {
      const x = buf[(((wr - (CEP_N - 1 - i)) % nBuf) + nBuf) % nBuf];
      re[i] = x * hann[i];
      im[i] = 0;
    }
    fftRadix2(re, im, false);
    const half = CEP_N >> 1;
    re[0] = Math.log(Math.abs(re[0]) + 1e-12);
    im[0] = 0;
    for (let k = 1; k < half; k++) {
      const mag = Math.hypot(re[k], im[k]) + 1e-12;
      const lg = Math.log(mag);
      re[k] = lg;
      re[CEP_N - k] = lg;
      im[k] = 0;
      im[CEP_N - k] = 0;
    }
    re[half] = Math.log(Math.abs(re[half]) + 1e-12);
    im[half] = 0;
    fftRadix2(re, im, true);
    for (let i = CEP_LIFT + 1; i < CEP_N - CEP_LIFT; i++) {
      re[i] = 0;
      im[i] = 0;
    }
    for (let i = 0; i < CEP_N; i++) im[i] = 0;
    fftRadix2(re, im, false);
    for (let k = 0; k <= half; k++) {
      const pwr = Math.exp(2 * re[k]);
      re[k] = pwr;
      if (k > 0 && k < half) re[CEP_N - k] = pwr;
      im[k] = 0;
      if (k > 0) im[CEP_N - k] = 0;
    }
    im[half] = 0;
    fftRadix2(re, im, true);
    const r = this._lpcR;
    for (let lag = 0; lag <= LPC_P; lag++) r[lag] = re[lag];
    if (!lpcLevinson(r, LPC_P, kTgt, this._lpcAWork, this._lpcAt)) return false;
    let bw = LPC_BW;
    for (let i = 0; i < LPC_P; i++) {
      kTgt[i] *= bw;
      bw *= LPC_BW;
    }
    return true;
  }

  /**
   * Copy dry cepstral envelope onto spliced wet (source-filter).
   * Amount = formant knob after settled-|R*| gate. IIR always runs once
   * poles exist so opening the gate does not start from a cold filter.
   */
  _formantRestore(sL, sR, amt) {
    this._lpcWetL[this._lpcWetWr] = sL;
    this._lpcWetR[this._lpcWetWr] = sR;
    this._lpcWetWr++;
    if (this._lpcWetWr >= LPC_WIN) this._lpcWetWr = 0;

    this._lpcHop++;
    if (this._lpcHop >= LPC_HOP) {
      this._lpcHop = 0;
      const dryWr = this.cbiwr - N2;
      const dryOk = this._lpcFitRing(this.cbiL, dryWr, this._lpcKDryTgt);
      const wetOk = this._lpcFitRing(
        this._lpcWetL,
        this._lpcWetWr - 1,
        this._lpcKWetTgt,
      );
      this._lpcHave = dryOk && wetOk;
    }

    if (!this._lpcHave) return [sL, sR];

    const ka = this._lpcKAlpha;
    for (let i = 0; i < LPC_P; i++) {
      this._lpcKDry[i] += (this._lpcKDryTgt[i] - this._lpcKDry[i]) * ka;
      this._lpcKWet[i] += (this._lpcKWetTgt[i] - this._lpcKWet[i]) * ka;
    }
    lpcKToA(this._lpcKDry, this._lpcADry, this._lpcAt);
    lpcKToA(this._lpcKWet, this._lpcAWet, this._lpcAt);

    const preL = sL - LPC_PRE * this._lpcPreXL;
    this._lpcPreXL = sL;
    const yL =
      lpcShape(lpcWhiten(preL, this._lpcAWet, this._lpcZxL), this._lpcADry, this._lpcZyL) +
      LPC_PRE * this._lpcPreYL;
    this._lpcPreYL = yL;

    const preR = sR - LPC_PRE * this._lpcPreXR;
    this._lpcPreXR = sR;
    const yR =
      lpcShape(lpcWhiten(preR, this._lpcAWet, this._lpcZxR), this._lpcADry, this._lpcZyR) +
      LPC_PRE * this._lpcPreYR;
    this._lpcPreYR = yR;

    const a = amt < 0.001 ? 0 : amt;
    return [sL + (yL - sL) * a, sR + (yR - sR) * a];
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
    if (!this._empty || this._empty.length !== n)
      this._empty = new Float32Array(n);
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

  _readMonoWindow(into, updateRms = true) {
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
    if (updateRms) this._analysisRms = Math.sqrt(sumSq / n);
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

  /** True when formant mode + soft (effective) speed — ratio may glide across notes. */
  _softPsola() {
    // Legacy name: soft ratio chase (PSOLA formant OR patent splice + Retune Speed).
    return this._softRatioChase();
  }

  /**
   * Decay = Retune Speed, then product:
   * DC finish speeds a stationary loose park; Humanize stretches after
   * the note is on-center. Neither runs on a scoop.
   */
  _effectiveSpeed(speedMs, humanize) {
    let spd = Math.max(0, speedMs);
    if (this._noteAgeMs < COMMIT_FAST_MS && spd > COMMIT_FAST_SPEED_MS) {
      spd = COMMIT_FAST_SPEED_MS;
    }
    const scooping =
      this._pitchVel >= SCOOP_VEL_ST_S ||
      Math.abs(this._signedPitchVel) >= RETARGET_RAW_VEL_ST_S;
    if (
      !scooping &&
      this._stablePitchMs >= STABLE_PITCH_MS &&
      this._noteAgeMs >= CENTER_LOCK_AGE_MS
    ) {
      const errC = Math.abs(this._audibleWant - this._committedTgt) * 100;
      const settleC = Math.abs(this._wantTgt - this._audibleWant) * 100;
      if (
        errC >= LOOSE_HOLD_LO_CENTS &&
        errC <= LOOSE_HOLD_HI_CENTS &&
        settleC <= CENTER_LOCK_SETTLE_CENTS &&
        spd > LOOSE_HOLD_SPEED_MS
      ) {
        spd = LOOSE_HOLD_SPEED_MS;
      }
    }
    const h = Math.max(0, Math.min(1, humanize));
    if (h < 0.001 || this._noteAgeMs <= HUMANIZE_SUSTAIN_MS) return spd;
    if (scooping) return spd;
    const centerErrCents =
      Math.abs(this._audibleWant - this._committedTgt) * 100;
    if (centerErrCents > HUMANIZE_OFF_CENTER_CENTS) return spd;
    const sustain = Math.min(
      1,
      (this._noteAgeMs - HUMANIZE_SUSTAIN_MS) / HUMANIZE_RAMP_MS,
    );
    return spd + h * sustain * HUMANIZE_EXTRA_MS;
  }

  /** Mark note-commit: refresh grain in-place ASAP (never dual-place). */
  _beginCommitRecapture() {
    this._commitRecapture = true;
    this._commitRecaptureMs = 0;
  }

  _clearCommitRecapture() {
    this._commitRecapture = false;
    this._commitRecaptureMs = 0;
  }

  /** Nearest scale (or MIDI-follow). Octave-lock to ref when provided. */
  _nearestTgt(det, transpose, refMidi) {
    const scalePcs = scalePcsOf(this._scale, this._customPcs);
    let tgt;
    if (this._midiFollow && this._midiNotes.length > 0) {
      tgt = nearestMidiNote(det, this._midiNotes) + transpose;
    } else {
      tgt = nearestScaleMidi(det, this._key, scalePcs) + transpose;
    }
    if (typeof refMidi === "number") tgt = octaveLock(tgt, refMidi);
    return tgt;
  }

  _commitWant(det, amount, transpose) {
    const tgt = this._nearestTgt(det, transpose);
    const want = pullToward(det, tgt, amount, this._flexCents);
    this._committedWant = want;
    this._committedTgt = tgt;
    this._tgtMidi = tgt;
    this._corrMidi = want;
    return { tgt, want };
  }

  /**
   * Keep committed scale note until live owns a neighbor (past midpoint)
   * or is clearly closer by hyst. Same-side only — no opposite-neighbor dips.
   */
  _stickyRetarget(det, transpose) {
    const sticky = this._committedTgt;
    const fresh = this._nearestTgt(det, transpose, sticky);
    if (Math.abs(fresh - sticky) < 0.25) return sticky;
    const toward = Math.sign(fresh - sticky);
    const side = Math.sign(det - sticky);
    if (toward !== 0 && side !== 0 && toward !== side) return sticky;
    const dS = Math.abs(det - sticky);
    const dF = Math.abs(det - fresh);
    // Directed scoop past the midpoint: flip now. Hyst stays for stationary
    // vibrato so A↔B doesn't chatter (g3b). This is the ~20s E→F# leftover.
    const scoopToward =
      toward !== 0 &&
      this._signedPitchVel * toward >= RETARGET_RAW_VEL_ST_S;
    if (scoopToward && dF < dS) return fresh;
    if (dF + STICKY_HYST_SEMI < dS) return fresh;
    return sticky;
  }

  /**
   * Nat Vib AC residual (st). Knob 0 = leave. + amplify · − fade residual.
   * Does not write wantTgt — Decay would low-pass it (g5a 10s lag).
   */
  _updateNaturalVibrato(det, dtMs) {
    let resid = det - this._vibCenter;
    if (resid > VIB_RESID_MAX_SEMI) resid = VIB_RESID_MAX_SEMI;
    else if (resid < -VIB_RESID_MAX_SEMI) resid = -VIB_RESID_MAX_SEMI;
    const slewA = 1 - Math.exp(-dtMs / VIB_RESID_SLEW_MS);
    this._vibSemiSlew += (resid - this._vibSemiSlew) * slewA;
    resid = this._vibSemiSlew;
    const span = Math.max(1e-6, VIB_RESID_MAX_SEMI);
    const u = Math.abs(resid) / span;
    const gateTgt =
      u <= VIB_GATE_FULL
        ? 1
        : Math.max(0, 1 - (u - VIB_GATE_FULL) / (1 - VIB_GATE_FULL));
    const gateA = 1 - Math.exp(-dtMs / VIB_GATE_SLEW_MS);
    this._vibGateSlew += (gateTgt - this._vibGateSlew) * gateA;
    resid *= this._vibGateSlew;

    const v = this._vibrato;
    const leave = VIB_LEAVE_SCALE;
    const scale =
      v >= 0 ? leave + v * (1 - leave) : leave * (1 + v);
    this._vibOffset = resid * scale;
  }

  /** Parked want + Nat Vib residual. R* / viz use this; Decay chases wantTgt. */
  _soundingWant() {
    return this._audibleWant + this._vibOffset;
  }

  /**
   * Do-no-harm: stay on the det↔want segment; never farther from the natural
   * scale note than dry. Safety rail, not a second detector.
   */
  _guardRatio(inHz, fact, detMidi, wantMidi, naturalTgt) {
    if (!(inHz > 1e-6) || !(fact > 1e-6)) return 1;
    let out = hzToMidi(inHz * fact);
    let lo = Math.min(detMidi, wantMidi);
    let hi = Math.max(detMidi, wantMidi);
    if (out < lo) out = lo;
    if (out > hi) out = hi;
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
   * Desired = sticky scale note from E/H midi. Flex sits on want.
   * Nat Vib residual is after Decay (`_soundingWant`). Decay slews
   * audibleWant in process().
   */
  _applyCorrection(rawMidi, amount, transpose) {
    const dtMs = this._detectDt * 1000;
    if (!this._haveRawVel) {
      this._prevRawVel = rawMidi;
      this._haveRawVel = true;
      this._pitchVel = 0;
      this._signedPitchVel = 0;
      this._stablePitchMs = 0;
    } else {
      const dSt = (rawMidi - this._prevRawVel) / Math.max(1e-4, this._detectDt);
      this._signedPitchVel += (dSt - this._signedPitchVel) * 0.4;
      this._pitchVel += (Math.abs(dSt) - this._pitchVel) * 0.4;
      this._prevRawVel = rawMidi;
      if (this._pitchVel < STABLE_VEL_ST_S) this._stablePitchMs += dtMs;
      else this._stablePitchMs = 0;
    }

    this._lockedDet = rawMidi;
    const det = this._lockedDet;
    this._detMidi = det;
    const vibA = 1 - Math.exp(-dtMs / VIB_CENTER_MS);
    this._vibCenter += (det - this._vibCenter) * vibA;

    const fresh = this._nearestTgt(det, transpose);
    let tgt = this._committedTgt;
    if (this._everLocked) {
      tgt = this._stickyRetarget(det, transpose);
      if (Math.abs(tgt - this._committedTgt) >= 0.25) this._noteAgeMs = 0;
    } else {
      tgt = fresh;
    }
    let want = pullToward(det, tgt, amount, this._flexCents);
    const v = this._vibrato;
    if (v < -0.001) want += (tgt - want) * -v;
    this._updateNaturalVibrato(det, dtMs);
    this._committedTgt = tgt;
    this._committedWant = want;
    this._tgtMidi = tgt;
    this._naturalTgt = fresh;
    this._wantTgt = want;
    this._noteAgeMs += dtMs;

    if (!this._softRatioChase()) {
      this._audibleWant = want;
    }

    const inHz =
      this._trackOk && this._periodSamp > 1
        ? sampleRate / this._periodSamp
        : midiToHz(det);
    const sounding = this._soundingWant();
    const outHz = midiToHz(sounding);
    let rStar = outHz / Math.max(1e-12, inHz);
    if (rStar < FACT_MIN) rStar = FACT_MIN;
    if (rStar > FACT_MAX) rStar = FACT_MAX;
    this._rStar = rStar;

    this._inphincTgt = inHz / sampleRate;
    this.inphinc = this._inphincTgt;
    const outMidi = hzToMidi(inHz * this.phincfact);
    this._outMidi = outMidi;
    this._corrMidi = sounding;
    return { det, tgt, out: outMidi };
  }

  _lowRate(amount, tracking, transpose) {
    if (this._warmup > 0) {
      this._warmup -= DETECT_EVERY;
      this.phincfact = 1;
      this._phincSlew = 1;
      return;
    }

    // Tracking knob → patent ε (looser = tolerate cycle-shape change).
    const tr = Math.max(0, Math.min(1, tracking));
    this._ehEps = EH_EPS_LOOSE + (EH_EPS_TIGHT - EH_EPS_LOOSE) * tr;

    // Notes from patent E/H period (US5973252A).
    this._readMonoWindow(this._rmsWin);
    const peEh = this._periodSamp;
    const f0 = this._trackOk && peEh > 1 ? sampleRate / peEh : 0;
    const clarity = this._ehClarity;
    const ambiguous = false;
    this._clarity = clarity;
    this._ambiguous = false;
    const confInst = f0 > 0 ? clarity : clarity * 0.3;
    if (!this._havePitch) this._pitchConf = confInst;
    else this._pitchConf += (confInst - this._pitchConf) * 0.28;
    if (ambiguous) this._reverbSoftMs = REVERB_SOFT_MS;
    // Conf→wet duck was a YIN multipitch gate. After phrase reset it latched
    // closed (conf starts at 0, reopen needs >0.48) and left ~20s as latency-dry
    // while E/H was already tracking. Patent path: if we have a period, correct.
    this._confWetOpen = true;
    this._confWetLowMs = 0;

    const loudEnough = this._analysisRms >= RMS_GATE;
    // Phrase-end ring: wet stayed open until UNVOICED_DROP (~450 ms). Debounce
    // quiet so consonants don't flash dry, then force wantWet→0 in process().
    if (!loudEnough) {
      this._edgeQuietMs += this._detectDt * 1000;
      if (this._edgeQuietMs >= EDGE_QUIET_MS) this._edgeQuiet = true;
    } else {
      this._edgeQuietMs = 0;
      this._edgeQuiet = false;
    }
    // Voiced vs unvoiced uses clarity. Confidence only damps trust/retarget —
    // routing ambiguous frames as unvoiced yanked R*→1 and clicked.

    let det = this._detMidi;
    let tgt = this._tgtMidi;
    let out = this._outMidi;

    // Patent: correction mode (trackOk) is the voiced gate — not YIN-style clarity.
    if (loudEnough && f0 > 0) {
      let midi = this._foldIntoRange(hzToMidi(f0));
      if (this._havePitch) {
        midi = this._foldIntoRange(midi);
        const prev = this._lockedDet || this._detMidi;
        const jump = Math.abs(midi - prev);
        if (jump >= 11 && jump <= 13) {
          // E/H period octave — follow. Do not snap back via octaveLock/MAX_JUMP.
          this._stable++;
        } else if (jump > MAX_JUMP_SEMI) {
          // Loop wrap / phrase cut: old MAX_JUMP pin kept the previous note and
          // R* retuned the new period onto it (very wrong note on pass 2).
          // Notes follow period; sticky recommits.
          this._lockedDet = midi;
          this._detMidi = midi;
          this._commitWant(midi, amount, transpose);
          this._audibleWant = midi;
          this._wantTgt = midi;
          this._stable = STABLE_NEED;
        } else {
          this._stable++;
          midi = prev + (midi - prev) * 0.55;
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
          this._commitWant(midi, amount, transpose);
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
          this._psolaPath = false;
          // Bare riff/run after silence — soften first audible correction
          this._coldStart = true;
          this._coldStartMs = 0;
          this._commitSoftMs = 0;
          this._beginCommitRecapture();
          this._noteAgeMs = 0;
          this._vibCenter = midi;
          this._vibSemiSlew = 0;
          this._vibGateSlew = 0;
          this._vibOffset = 0;
          this._audibleWant = midi;
          this._wantTgt = midi;
          this._wantBaseSlew = midi;
          this._haveRawVel = false;
          this._pitchVel = 0;
          this._signedPitchVel = 0;
          this._stablePitchMs = 0;
        }
      }

      this._voiced = true;
      this._unvoicedN = 0;
      if (this._armed) {
        this._psolaOnsetMs += this._detectDt * 1000;
      }

      if (this._armed) {
        this._everLocked = true;
        this._detectHop = (this._detectHop + 1) | 0;
        const c = this._applyCorrection(midi, amount, transpose);
        det = c.det;
        tgt = c.tgt;
        out = c.out;
      } else {
        this._setUnityPhases(midi);
        det = midi;
        this._detMidi = midi;
        tgt =
          nearestScaleMidi(
            midi,
            this._key,
            scalePcsOf(this._scale, this._customPcs),
          ) + transpose;
        this._tgtMidi = tgt;
        out = midi;
      }
    } else if (loudEnough && this._armed && this._havePitch) {
      // Energy but no period (consonant / baked-reverb smear): identity.
      // Keep sticky so the next vowel resumes. Do not retune noise with the
      // last lock (that chewed transitions). spliceRate is 1 while !_trackOk.
      this._voiced = false;
      this._unvoicedN++;
      if (this._unvoicedN >= UNVOICED_DROP) {
        this._resetCorrectionState(false);
      }
      det = this._lockedDet;
      tgt = this._committedTgt;
      out = det;
    } else {
      this._voiced = false;
      this._unvoicedN++;
      this._clarity *= 0.9;
      this._stable = Math.max(0, this._stable - 1);
      // Phrase gap: rate=1 now (patent fail). The 0.04 ease still shifted
      // consonants/tails. Splice identity is the same tap — no click.
      this.phincfact = 1;
      this._phincSlew = 1;
      this._rStar = 1;
      this.outphinc = this.inphinc;
      if (this._unvoicedN >= UNVOICED_DROP) {
        // Phrase gap: clear note lock, keep ring + DS E/H (re-detect, not cold).
        this._resetCorrectionState(false);
      } else if (this._unvoicedN > 6 && !this._detectionMode) {
        this._ehFailToDetect();
      }
      tgt =
        nearestScaleMidi(
          det,
          this._key,
          scalePcsOf(this._scale, this._customPcs),
        ) + transpose;
      this._tgtMidi = tgt;
      out = det;
    }

    this._updatePsolaWant();

    this._vizTick++;
    if (this._vizTick >= VIZ_EVERY) {
      this._vizTick = 0;
      this._pushViz(det, tgt, this._armed && this._voiced ? out : det);
    }
    if (this._ehValidate) {
      this._ehValHop++;
      if (this._ehValHop % 4 === 0) {
        const peEh = this._periodSamp;
        const peYin = this.inphinc > 1e-9 ? 1 / this.inphinc : 0;
        let cents = 0;
        let oct = 0;
        if (peEh > 1 && peYin > 1) {
          let octs = Math.log(peEh / peYin) / Math.LN2;
          oct = Math.abs(octs) >= 0.5 ? 1 : 0;
          while (octs > 0.5) octs -= 1;
          while (octs < -0.5) octs += 1;
          cents = octs * 1200;
        }
        try {
          this.port.postMessage({
            type: "ehval",
            t: +(this._sampleCount / sampleRate).toFixed(3),
            peEh: +peEh.toFixed(2),
            peYin: +peYin.toFixed(2),
            cents: +cents.toFixed(1),
            oct,
            ok: this._trackOk ? 1 : 0,
            det: this._detectionMode ? 1 : 0,
            voiced: this._armed && this._voiced ? 1 : 0,
            armed: this._armed ? 1 : 0,
            unity: this._onsetUnity ? 1 : 0,
            ever: this._everLocked ? 1 : 0,
            edge: this._edgeQuiet ? 1 : 0,
            r: +this._rStar.toFixed(4),
            wet: +this._wetMix.toFixed(3),
            want: +this._audibleWant.toFixed(2),
            midi: +this._lockedDet.toFixed(2),
            tgt: +this._committedTgt.toFixed(2),
          });
        } catch {
          /* port closed */
        }
      }
    }
  }

  /** Clarity hysteresis so PSOLA doesn't chatter at consonant edges. */
  _updatePsolaWant() {
    if (this._formant < 0.5 || !this._armed) {
      this._psolaWant = false;
      return;
    }
    // Keep PSOLA open across note-commit recapture (don't drop to Fairbanks slap).
    if (this._commitRecapture && this._psolaHalf >= 8) {
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
    if (
      this._voiced &&
      this._clarity >= clarityOn &&
      this._psolaPeStable >= PSOLA_PE_STABLE_NEED
    ) {
      this._psolaWant = true;
    } else if (!this._voiced || this._clarity < PSOLA_CLARITY_OFF) {
      this._psolaWant = false;
    }
  }

  _captureFrag() {
    const ti2 = this.cbiwr - N2;
    for (let ti = -N2; ti < N2; ti++) {
      const src = (((ti + ti2) % N) + N) % N;
      const dst = (((ti + N) % N) + N) % N;
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
      const src = (((mark + i) % N) + N) % N;
      const dst = ((i % N) + N) % N;
      this.psolaL[dst] = this.cbiL[src];
      this.psolaR[dst] = this.cbiR[src];
    }
    this._psolaHalf = half;
    this._psolaPeIn = peIn;
    if (this._commitRecapture) this._clearCommitRecapture();
  }

  /**
   * Analysis period: always refresh Fairbanks frag. PSOLA grains:
   *  - trusted refresh when PE is stable
   *  - provisional refresh on interval jumps while already in PSOLA (keep formants)
   * Never clear half on a mere PE step — that dumped large leaps to Fairbanks.
   * Reject grains whose PE disagrees with live inphinc (octave / period errors).
   */
  _onAnalysisPeriod() {
    const nominal = (((this.cbiwr - N2) % N) + N) % N;
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
    const livePe = this.inphinc > 1e-6 ? this._clampPe(1 / this.inphinc) : peIn;
    const peVsLive = Math.abs(peIn - livePe) / Math.max(livePe, 1);
    const peMatchesLive = peVsLive < 0.18;

    const voicedOk =
      this._formant >= 0.5 &&
      this._voiced &&
      this._clarity >= PSOLA_CLARITY_OFF &&
      peMatchesLive;

    // Steady-state: refresh when PE stable. Commit-recapture: first live-matched
    // grain in-place (single buffer — dual old+new OLA was the slap/delay).
    if (voicedOk && this._commitRecapture && peMatchesLive) {
      this._capturePsolaGrain(peIn);
    } else if (voicedOk && this._psolaPeStable >= PSOLA_PE_STABLE_NEED) {
      this._capturePsolaGrain(peIn);
    } else if (
      !this._voiced ||
      this._clarity < PSOLA_CLARITY_OFF ||
      !peMatchesLive
    ) {
      if (
        !(this._psolaWant && this._psolaHalf >= 8 && peRel <= PSOLA_PE_KEEP_REL)
      ) {
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
      const dst = (((ti + ti2) % N) + N) % N;
      this.cboL[dst] += valdL * tf;
      this.cboR[dst] += valdR * tf;
    }
  }

  /**
   * Period PSOLA: place last snapped ~2·PE grain with no resample.
   * Synthesis hop from phaseout; COLA ≈ peOut/peIn; `scale` for D5b crossfade.
   */
  _placeFragPsola(scale) {
    const half = this._psolaHalf;
    if (half < 8 || scale < 0.001) return;

    const peInGrain = this._clampPe(this._psolaPeIn);
    const livePe =
      this.inphinc > 1e-6 ? this._clampPe(1 / this.inphinc) : peInGrain;
    const fact = Math.max(FACT_MIN, Math.min(FACT_MAX, this._phincSlew));
    // While waiting for a post-commit grain, do NOT pitch-shift the stale
    // vowel (old grain × new R* = slap/delay). Exception: cold soft chase
    // runs under dry — allow real fact so the silent chase is primed.
    const useFact =
      this._commitRecapture && !(this._coldStart && this._speedMs >= 0.5)
        ? 1
        : fact;
    const peOut = this._clampPe(livePe / Math.max(FACT_MIN, useFact));
    const dstCenter = this.cbord + N2;
    const olaT = Math.max(0.45, Math.min(1.05, peOut / Math.max(livePe, 1)));
    this._psolaOla += (olaT - this._psolaOla) * 0.04;
    const ola = this._psolaOla * scale;

    for (let i = -half; i < half; i++) {
      const w = (0.5 - 0.5 * Math.cos((Math.PI * (i + half)) / half)) * ola;
      const dst = (((dstCenter + i) % N) + N) % N;
      const src = ((i % N) + N) % N;
      this.cboL[dst] += this.psolaL[src] * w;
      this.cboR[dst] += this.psolaR[src] * w;
    }
  }

  _placeFrag() {
    if (this._formant < 0.5) {
      this._psolaPath = false;
      this._placeFragFairbanks(1);
      return;
    }
    const g = this._psolaGate;
    const halfOk = this._psolaHalf >= 8;
    if (!halfOk) this._psolaPath = false;
    else if (g >= 0.58) this._psolaPath = true;
    else if (g < 0.38) this._psolaPath = false;
    if (!this._psolaPath) {
      this._placeFragFairbanks(1);
      return;
    }
    this.fragsize = 0;
    this._placeFragPsola(1);
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
    const tracking = parameters.tracking[0];
    const transpose = parameters.transpose[0];
    this._speedMs = Math.max(0, speed);
    this._flexCents = parameters.flex[0];
    this._humanize = parameters.humanize[0];
    this._vibrato = parameters.vibrato[0];
    this._effSpeedMs = this._effectiveSpeed(this._speedMs, this._humanize);
    this._formant = parameters.formant[0];
    if (this._formant < 0.5) this._psolaWant = false;

    // Ratio chase: Retune Speed = patent Decay. Robot snaps.
    const spd = this._effSpeedMs;
    let ratioAlpha = 1;
    if (spd >= 0.5) {
      const tauSamp = Math.max(1, (spd / 1000) * sampleRate);
      ratioAlpha = 1 - Math.exp(-1 / tauSamp);
    }
    // Tiny ease after snaps so placeFrag doesn't zipper (~0.5 ms)
    const slewAlpha = 1 - Math.exp(-1 / Math.max(1, 0.0005 * sampleRate));
    const gateAlpha =
      1 - Math.exp(-1 / Math.max(1, (PSOLA_GATE_MS / 1000) * sampleRate));
    const wetXfadeMs = (() => {
      // Phrase-end: close wet fast (ring was loud vs dry).
      if (this._edgeQuiet) return EDGE_WET_XFADE_MS;
      let ms = WET_XFADE_MS;
      // Cold xfade is PSOLA-only (anti-staircase). On splice it was slower
      // than the 0.001 wetMix floor → mix stuck at 0 for COLD_START_MS (~20s).
      if (
        this._coldStart &&
        this._softRatioChase() &&
        this._formant >= 0.5
      ) {
        ms = Math.max(ms, COLD_WET_XFADE_MS);
      }
      if (!this._confWetOpen || (this._wetMix > 0.02 && this._wetMix < 0.98)) {
        ms = Math.max(ms, CONF_WET_XFADE_MS);
      }
      return ms;
    })();
    const wetXfadeAlpha =
      1 - Math.exp(-1 / Math.max(1, (wetXfadeMs / 1000) * sampleRate));
    const formantAlpha =
      1 - Math.exp(-1 / Math.max(1, (FORMANT_XFADE_MS / 1000) * sampleRate));
    const softPsola = this._softRatioChase();
    // Patent Decay: Retune Speed is the only chase tau.
    const wantChaseMs = spd;
    const wantAlpha =
      softPsola && wantChaseMs >= 0.5
        ? 1 - Math.exp(-1 / Math.max(1, (wantChaseMs / 1000) * sampleRate))
        : 1;

    for (let i = 0; i < n; i++) {
      const xl = inL[i] || 0;
      const xr = inR[i] || 0;

      this.cbiL[this.cbiwr] = xl;
      this.cbiR[this.cbiwr] = xr;

      if (this.cbiwr % DETECT_EVERY === 0) {
        this._lowRate(amount, tracking, transpose);
      }

      // Patent E/H: detect/track every sample after the write (gated — see EH_LIVE).
      if (EH_LIVE) this._ehOnSample();

      const dryIdx = (((this.cbiwr - N2) % N) + N) % N;
      const dryL = this.cbiL[dryIdx];
      const dryR = this.cbiR[dryIdx];

      if (this._on) {
        // Cycle_period → inphinc every sample (patent rate denominator).
        if (this._trackOk && this._periodSamp > 1) {
          this._inphincTgt = 1 / this._periodSamp;
        }
        this.inphinc = this._inphincTgt;

        const gateT =
          this._formant >= 0.5 && this._psolaWant && this._psolaHalf >= 8
            ? 1
            : 0;
        this._psolaGate += (gateT - this._psolaGate) * gateAlpha;

        if (this._commitRecapture) {
          this._commitRecaptureMs += 1000 / sampleRate;
          if (this._commitRecaptureMs >= COMMIT_RECAPTURE_MS) {
            this._clearCommitRecapture();
          }
        }

        if (this._coldStart) {
          this._coldStartMs += 1000 / sampleRate;
          if (this._coldStartMs >= COLD_START_MS) {
            this._coldStart = false;
          }
        }
        if (this._commitSoftMs > 0) {
          const decay =
            this._stablePitchMs >= STABLE_PITCH_MS &&
            this._pitchVel < SCOOP_VEL_ST_S
              ? COMMIT_SOFT_STABLE_DECAY
              : 1;
          this._commitSoftMs -= (1000 / sampleRate) * decay;
          if (this._commitSoftMs < 0) this._commitSoftMs = 0;
        }
        if (this._reverbSoftMs > 0) {
          this._reverbSoftMs -= 1000 / sampleRate;
          if (this._reverbSoftMs < 0) this._reverbSoftMs = 0;
        }

        // Soft+PSOLA: Retune Speed owns want glide (per-sample). Robot snaps in lowRate.
        // Soft-land brake + wantTgt clamp handle overshoot — never hard-assign
        // audibleWant (that tore PSOLA at ~12 ms and read as muted clicks).
        // When E/H track is ok, denominator follows continuous period (not hop YIN).
        // Untracked: don't chase want off a dead period (consonant / reverb).
        if (softPsola && !this._onsetUnity && this._trackOk) {
          this._audibleWant += (this._wantTgt - this._audibleWant) * wantAlpha;
          const inHzA = Math.max(1e-12, this.inphinc * sampleRate);
          let rA = midiToHz(this._soundingWant()) / inHzA;
          if (rA < FACT_MIN) rA = FACT_MIN;
          if (rA > FACT_MAX) rA = FACT_MAX;
          this._rStar = rA;
          this._corrMidi = this._soundingWant();
        }

        if (this._onsetUnity) {
          this.phincfact = 1;
          this._phincSlew = 1;
          this.outphinc = this.inphinc;
          // Splice: keep want/audible from note logic during unity — forcing them
          // to lagged lockedDet wiped post-gap land snaps (dry_2 @ ~20s E→F#).
          // PSOLA (Fairbanks path only) still pins to lockedDet for grain capture.
          // formant≥0.5 is LPC amount on splice, not a path switch — do not pin.
          if (this._formant >= 0.5 && !this._useCycleSplice()) {
            this._audibleWant = this._lockedDet;
            this._wantTgt = this._lockedDet;
          }
          this._onsetUnityMs += 1000 / sampleRate;

          const formantOn = this._formant >= 0.5;
          const psolaReady =
            formantOn &&
            !this._useCycleSplice() &&
            this._psolaGate >= ONSET_PSOLA_READY &&
            this._psolaHalf >= 8;
          // Splice never runs _onAnalysisPeriod → peStable stays 0. Pop formant
          // is 0.85 (LPC post) so !formantOn never fired and we sat on rate=1
          // until ONSET_UNITY_MAX_MS (~260ms) — dry_2 @ ~20s wet≈dry.
          const spliceReady =
            this._useCycleSplice() &&
            this._onsetUnityMs >= ONSET_SPLICE_MS;
          const fairbanksReady =
            !formantOn &&
            !this._useCycleSplice() &&
            this._onsetUnityMs >= ONSET_UNITY_MS &&
            (this._psolaPeStable >= PSOLA_PE_STABLE_NEED ||
              this._onsetUnityMs >= ONSET_UNITY_MS * 2);
          const timedOut = this._onsetUnityMs >= ONSET_UNITY_MAX_MS;

          if (psolaReady || spliceReady || fairbanksReady || timedOut) {
            this._onsetUnity = false;
            const inHz = midiToHz(this._lockedDet);
            let r = midiToHz(this._committedWant) / Math.max(1e-12, inHz);
            if (r < FACT_MIN) r = FACT_MIN;
            if (r > FACT_MAX) r = FACT_MAX;
            this._rStar = r;
            // Splice owns wet: seed R* now. formant≥0.5 is LPC post, not PSOLA —
            // the old formantOn&&softPsola branch left phincfact=1 after every re-arm.
            if (this._useCycleSplice()) {
              this.phincfact = r;
              this._phincSlew = r;
              this._clearCommitRecapture();
            } else if (formantOn && softPsola) {
              this.phincfact = 1;
              this._phincSlew = 1;
              this._beginCommitRecapture();
            } else if (formantOn && this._coldStart && this._speedMs >= 0.5) {
              this.phincfact = 1;
              this._phincSlew = 1;
              this._beginCommitRecapture();
            } else {
              this.phincfact = r;
              this._phincSlew = r;
            }
          }
        } else if (
          this._commitRecapture &&
          this._formant >= 0.5 &&
          !this._useCycleSplice() &&
          !(this._coldStart && this._speedMs >= 0.5)
        ) {
          // Stale grain still up — hold unity (pitching it caused the slap/delay).
          // Skip during cold soft chase: we stay on dry while R* eases in.
          this.phincfact = 1;
          this._phincSlew = 1;
          this.outphinc = this.inphinc;
        } else if (!this._trackOk) {
          // Consonant / reverb smear: freeze R*. spliceRate is already 1.
          this.outphinc = this.inphinc;
        } else {
          const cur = Math.max(1e-6, this.phincfact);
          const ratioCents = (1200 * Math.log(this._rStar / cur)) / Math.LN2;
          if (spd < 0.5 || softPsola) {
            // Soft: want already glides at Retune Speed — lock ratio to R* (tiny slew below).
            this.phincfact = this._rStar;
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
            this._corrMidi,
            this._naturalTgt,
          );
          this._phincSlew += (this.phincfact - this._phincSlew) * slewAlpha;
          this._phincSlew = this._guardRatio(
            inHzG,
            this._phincSlew,
            this._lockedDet,
            this._corrMidi,
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

        // Patent: the delay-line read is the output. rate=1 is dry. Never
        // crossfade a parallel latency-dry against an already-shifted wet
        // (that was the cold-start double-pitch). PSOLA still ducks via _wetMix.
        let wantWet = 0;
        if (this._useCycleSplice()) {
          wantWet = 1;
        } else if (
          this._armed &&
          this._everLocked &&
          !this._onsetUnity &&
          this._confWetOpen &&
          !this._edgeQuiet
        ) {
          wantWet = 1;
          if (
            this._coldStart &&
            this._softRatioChase() &&
            this._formant >= 0.5
          ) {
            const cents = Math.abs(this._wantTgt - this._audibleWant) * 100;
            const open =
              1 - (cents - COLD_WET_CENTS * 0.4) / (COLD_WET_CENTS * 1.2);
            wantWet = open < 0 ? 0 : open > 1 ? 1 : open;
          }
        }
        this._wetMix += (wantWet - this._wetMix) * wetXfadeAlpha;
        if (this._wetMix < 1e-6) this._wetMix = 0;
        if (this._wetMix > 0.999) this._wetMix = 1;

        if (this._edgeQuiet) {
          this._olaGain += (0 - this._olaGain) * 0.12;
        } else if (this._everLocked || this._onsetUnity) {
          this._olaGain += (1 - this._olaGain) * 0.04;
          if (this._olaGain > 0.999) this._olaGain = 1;
        } else {
          this._olaGain += (0 - this._olaGain) * 0.05;
        }

        // G2 cycle-splice replaces Fairbanks OLA when formant-off.
        // PSOLA (formant≥0.5) still uses the grain engine below.
        const useSplice = this._useCycleSplice();
        if (!useSplice && this._spliceInit) this._resetCycleSplice();

        const runOla =
          !useSplice &&
          (this._armed ||
            this._onsetUnity ||
            this._wetMix > 0.001 ||
            this._olaGain > 0.001);
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
        } else if (useSplice) {
          // Keep fragsize from growing forever while splice owns wet.
          this.fragsize = 0;
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
        this._psolaPath = false;
        this._clearCommitRecapture();
        this._resetCycleSplice();
        this._noteAgeMs = 0;
        this._coldStart = false;
        this._coldStartMs = 0;
        this._commitSoftMs = 0;
        this._reverbSoftMs = 0;
        this._haveRawVel = false;
        this._pitchVel = 0;
        this._signedPitchVel = 0;
        this._stablePitchMs = 0;
        this._pitchConf = 0;
        this._confWetOpen = true;
        this._confWetLowMs = 0;
        this._edgeQuiet = false;
        this._edgeQuietMs = 0;
        this._onsetUnity = false;
        this._onsetUnityMs = 0;
        this._armed = false;
        this._stable = 0;
        this._everLocked = false;
        this._noteLocked = false;
        this._pendingHold = false;
        this._holdAccumMs = 0;
        this._centerLatched = false;
        this._olaGain += (0 - this._olaGain) * 0.05;
        this._wetMix += (0 - this._wetMix) * wetXfadeAlpha;
        this.phasein = 0;
        this.phaseout = 0;
      }

      let wetL;
      let wetR;
      if (this._on && this._useCycleSplice()) {
        // rate=1 while unity / unarmed → wet ≈ latency-dry (delay stays ~N2)
        const spliceRate =
          !this._armed ||
          this._onsetUnity ||
          this._edgeQuiet ||
          !this._trackOk
            ? 1
            : this._phincSlew;
        const pair = this._cycleSpliceSample(spliceRate);
        let sL = pair[0];
        let sR = pair[1];
        // Envelope copy after splice. Gate: voiced + settled |R*| — mid-glide
        // copy chewed (g2f). amt=0 still runs the LPC hop so the IIR stays warm.
        const shiftCents =
          spliceRate > 1e-12
            ? Math.abs((1200 * Math.log(spliceRate)) / Math.LN2)
            : 0;
        const settled =
          Math.abs(this._wantTgt - this._audibleWant) * 100 <
          FORMANT_SETTLE_CENTS;
        const allow =
          this._trackOk &&
          this._armed &&
          !this._onsetUnity &&
          !this._edgeQuiet &&
          shiftCents >= FORMANT_SHIFT_MIN_CENTS &&
          settled;
        const tgtAmt = allow ? this._formant : 0;
        this._formantAmt += (tgtAmt - this._formantAmt) * formantAlpha;
        if (this._formantAmt < 1e-4) this._formantAmt = 0;
        const env = this._formantRestore(sL, sR, this._formantAmt);
        wetL = env[0];
        wetR = env[1];
        this.cboL[this.cbord] = 0;
        this.cboR[this.cbord] = 0;
      } else {
        wetL = this.cboL[this.cbord];
        wetR = this.cboR[this.cbord];
        this.cboL[this.cbord] = 0;
        this.cboR[this.cbord] = 0;
      }

      const lim = 1.5;
      if (wetL > lim) wetL = lim;
      else if (wetL < -lim) wetL = -lim;
      if (wetR > lim) wetR = lim;
      else if (wetR < -lim) wetR = -lim;

      // Splice: one path. rate=1 ≡ dry (same N2 tap). Parallel dry+wet is two
      // pitches — AT never does that. Mix knob below is the only blend.
      const useSpliceOut = this._on && this._useCycleSplice();
      const wm = useSpliceOut ? 1 : this._wetMix * this._olaGain;
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
      this._sampleCount++;
      this.cbord++;
      if (this.cbord >= N) this.cbord = 0;
    }
    return true;
  }
}

registerProcessor("ain-centinel", AinCentinelProcessor);
