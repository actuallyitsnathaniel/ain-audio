// Centinel — patent-core pitch corrector (US5973252A, expired) + product layer.
// Detect: 8:1 DS + recursive E/H search. Correct: narrow-band E/H track →
// Cycle_period → rate convert + ±1 cycle insert/delete (formant-off).
// formant ≥ 0.5: optional period PSOLA (Lent-adjacent). Fairbanks = splice off.
// Product on top: Retune Speed / Humanize / Flex / Nat Vib / sticky. Latency N/2.
//
// Build stamp — bump when diagnosing "did the worklet reload?" (AudioWorklets do NOT HMR).
const CENTINEL_BUILD = "2026-08-11g2n5i-flatslew";

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
const EH_FAIL_NEED = 6;
/** formant-off wet = patent cycle splice (false → Fairbanks OLA). */
const CYCLE_SPLICE = true;
/**
 * Run patent E/H per-sample (updates `_periodSamp` only).
 * Must NOT write `_inphincTgt` — process() copies that → inphinc every sample
 * (p1a–e silent regression). Drive into splice/R* only via EH_DRIVE when ready.
 */
const EH_LIVE = true;
/** When true, splice Cycle_period uses E/H `_periodSamp` (gated — needs offline win). */
const EH_DRIVE = true;
/**
 * Note commit / retarget only every N detect hops — keeps hold/hyst at the old
 * ~11.6 ms cadence so faster YIN doesn't hair-trigger neighbor flips.
 */
const NOTE_DECIDE_HOPS = 2;
const F_MIN_DEFAULT = 110;
const F_MAX_DEFAULT = 700;
const AREF = 440;
const VIZ_BINS = 96;
const MIDI_LO = 36;
const MIDI_HI = 84;
const VIZ_EVERY = 2;
const STABLE_NEED = 5; // was 3 @ hop512 (~35ms); 5 @ hop256 ≈ 29ms arm
const MAX_JUMP_SEMI = 7;
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
/** Cycle-splice (formant-off): no Fairbanks PE settle — exit unity sooner after re-arm. */
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
 * 1.0 (c2) shook from YIN; 0 (pre-c2) ceramic. Partial leave + slew = life.
 */
const VIB_LEAVE_SCALE = 0.5;
/** Clamp |det − vibCenter| before leave (st) — larger = scoop, not vibrato. */
const VIB_RESID_MAX_SEMI = 0.38;
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
 * AT Flex-Tune strength: correction only as pitch approaches the target note.
 * flex=0 → always correct (hard). Higher flexCents → smaller correction radius
 * (manual: more expressive variation allowed through).
 * Hard mode still tapers when far from sticky so scoops aren't yanked opposite
 * the gesture (Retune-Speed interaction AT gets for free; we approximate).
 */
function flexCorrectionStrength(absErrSemi, flexCents) {
  const f = Math.max(0, Math.min(100, flexCents));
  if (f < 0.5) {
    // Hard / pop flex=0: full pull near center; ease out so scoops aren't inverted.
    // hardLo 0.28 (g2j) beat center but opened dips — keep a1.
    const hardLo = 0.22;
    const hardSpan = 0.4;
    if (absErrSemi <= hardLo) return 1;
    return Math.max(0, 1 - (absErrSemi - hardLo) / hardSpan);
  }
  // flex 0.5..100 → radius ~0.50..0.10 st (higher flex = tighter island).
  const u = f / 100;
  const radius = 0.5 * (1 - 0.8 * u);
  if (absErrSemi >= radius) return 0;
  const x = absErrSemi / Math.max(1e-6, radius);
  return (1 - x) * (1 - x);
}

function pullToward(det, tgt, amount, flexCents, ownedFinish = false) {
  const err = tgt - det;
  const absErr = Math.abs(err);
  const amt = Math.max(0, Math.min(1, amount));
  let strength = flexCorrectionStrength(absErr, flexCents);
  // Listen gaps ~14.2–14.5: owned sticky, dry wobbles flat and hard taper
  // zeros → wet≈dry. Finish hard when flat; stay gentle when sharp (lag-dips).
  if (ownedFinish && flexCents < 0.5 && absErr <= 0.9) {
    const flat = err > 0; // sticky above det
    const floor = flat
      ? absErr <= 0.22
        ? 1
        : absErr <= 0.35
          ? 0.96
          : absErr <= 0.48
            ? 0.9
            : absErr <= 0.6
              ? 0.78
              : absErr <= 0.75
                ? 0.6
                : 0.45
      : absErr <= 0.22
        ? 1
        : absErr <= 0.35
          ? 0.9
          : absErr <= 0.48
            ? 0.55
            : 0.28;
    strength = Math.max(strength, floor);
  }
  return det + err * amt * strength;
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

/** Hold time: longer when soft so we don't commit to a wrong neighbor mid-glide.
 * Midway: AT-ish settle without f-strict-at robotics (cap was 48 → 60). */
function holdMsForSpeed(speedMs, coldStart, pitchConf) {
  if (!(speedMs >= 0.5)) return HOLD_MS_BASE;
  let ms = Math.max(HOLD_MS_BASE, Math.min(60, speedMs * 0.32));
  // Cold re-arm: slight extra hold — first note of a run still needs a beat of trust.
  if (coldStart) ms = Math.max(ms, Math.min(72, ms + 18));
  // Reverb / low confidence: commit slower — fewer false neighbor snaps.
  if (pitchConf < CONF_RETARGET) {
    ms = Math.max(ms, Math.min(95, ms + 26));
  }
  return ms;
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
  if (tauMax <= tauMin + 2)
    return { f0: 0, clarity: 0, confidence: 0, ambiguous: false };

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
  if (tau >= tauMax || cmnd[tau] >= 1) {
    return { f0: 0, clarity: 0, confidence: 0, ambiguous: false };
  }

  const tau2 = tau * 2;
  if (tau2 + 1 <= tauMax) {
    let t2 = tau2;
    if (t2 > 1 && cmnd[t2 - 1] < cmnd[t2]) t2--;
    if (t2 + 1 <= tauMax && cmnd[t2 + 1] < cmnd[t2]) t2++;
    // Prefer longer period only when *clearly* better. Rooms make 2τ look
    // "as good" as τ (early reflection / subharmonic) — 1.02 was octave-downing.
    if (cmnd[t2] < cmnd[tau] * 0.95 && cmnd[t2] < 0.08) tau = t2;
  }

  const x0 = tau > 1 ? cmnd[tau - 1] : cmnd[tau];
  const x1 = cmnd[tau];
  const x2 = tau + 1 <= tauMax ? cmnd[tau + 1] : cmnd[tau];
  const denom = 2 * (2 * x1 - x2 - x0);
  const better = denom !== 0 ? tau + (x2 - x0) / denom : tau;
  const f0 = sr / better;
  const clarity = Math.max(0, Math.min(1, 1 - cmnd[tau]));
  if (!(f0 >= fMin && f0 <= fMax)) {
    return { f0: 0, clarity: 0, confidence: 0, ambiguous: false };
  }

  const primary = cmnd[tau];
  // Non-octave multipitch (other notes / clutter). Near-τ skipped as same trough.
  let second = 1;
  const nearLo = tau * 0.78;
  const nearHi = tau * 1.28;
  const octLo = tau * 1.85;
  const octHi = tau * 2.2;
  const halfLo = tau * 0.48;
  const halfHi = tau * 0.54;
  for (let t = tauMin; t <= tauMax; t++) {
    if (t >= nearLo && t <= nearHi) continue;
    if (t >= octLo && t <= octHi) continue;
    if (t >= halfLo && t <= halfHi) continue;
    if (cmnd[t] < second) second = cmnd[t];
  }
  // Room reflections love ≈2τ / ≈½τ rivals that clean harmonics also show —
  // only flag when the rival is nearly as deep as the primary (not "expected weak").
  let octBest = 1;
  for (
    let t = Math.max(tauMin, Math.floor(octLo));
    t <= Math.min(tauMax, Math.ceil(octHi));
    t++
  ) {
    if (cmnd[t] < octBest) octBest = cmnd[t];
  }
  let halfBest = 1;
  for (
    let t = Math.max(tauMin, Math.floor(halfLo));
    t <= Math.min(tauMax, Math.ceil(halfHi));
    t++
  ) {
    if (cmnd[t] < halfBest) halfBest = cmnd[t];
  }
  const octaveRival =
    (octBest <= primary * 1.18 && octBest < 0.16) ||
    (halfBest <= primary * 1.12 && halfBest < 0.14);
  const multiOther = second < primary * 1.4 && second < 0.22;
  const ambiguous = multiOther || octaveRival;
  let confidence = clarity;
  if (octaveRival) confidence *= 0.32;
  else if (multiOther) confidence *= 0.42;
  // Soften when primary trough isn't crisp either
  if (primary > 0.1) confidence *= 0.85;

  return { f0, clarity, confidence, ambiguous };
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

    this._yinScratch = new Float32Array(N2);
    this._yinD = new Float32Array(N2);
    this._yinCmnd = new Float32Array(N2);
    /** Patent E/H — downsampled detect + full-rate correction track. */
    this._ed = new Float32Array(EH_LMAX + 1);
    this._hd = new Float32Array(EH_LMAX + 1);
    this._dsBuf = new Float32Array(EH_DS_BUF);
    this._dsWr = 0;
    this._dsN = 0;
    this._dsAcc = 0;
    this._dsLpf = 0;
    this._dsLpfCoeff = Math.exp((-2 * Math.PI * (0.45 * sampleRate) / EH_DS) / sampleRate);
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
    /** Speed after Humanize sustain stretch — drives ratio chase. */
    this._effSpeedMs = 0;
    this._vibrato = 0;
    /** ms since last note commit (Humanize sustain gate). */
    this._noteAgeMs = 0;
    /** Slow det center for Natural Vibrato residual. */
    this._vibCenter = 60;
    /** Slewed vibrato residual (anti-shake from YIN hop noise). */
    this._vibSemiSlew = 0;
    /** Slewed leave-gate 0..1 (no hard motion on/off). */
    this._vibGateSlew = 0;
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
    /** Target for audible want (committedWant + natural-vibrato offset). */
    this._wantTgt = 60;
    /** Parked on sticky center — hold want at tgt until scoop/commit (anti-click). */
    this._centerLatched = false;
    /** Next commit is orphan sticky release — faster audible blend. */
    this._orphanCommit = false;
    this._formant = 0;
    this._vizTick = 0;
    this._warmup = N;
    this._detectDt = DETECT_EVERY / sampleRate;
    /** Hold/retarget clock — NOTE_DECIDE_HOPS × detect (legacy cadence). */
    this._noteDt = (DETECT_EVERY * NOTE_DECIDE_HOPS) / sampleRate;
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
    this._stopPeriodTrack();
    if (clearRing) this._wetMix = 0;
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
  }

  _resetCycleSplice() {
    this._spliceDelay = N2;
    this._spliceInit = false;
  }

  /** True when formant-off patent cycle-splice owns the wet path. */
  _useCycleSplice() {
    return CYCLE_SPLICE && this._formant < 0.5;
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
      const { E, H } = this._ehSnapshot(L, wr, this._ringMono);
      this._trackE[k] = E;
      this._trackH[k] = H;
    }
    this._periodSamp = pe;
    this._periodMidi = this._foldIntoRange(hzToMidi(sampleRate / pe));
    this._detectionMode = false;
    this._trackOk = true;
    this._ehRefineCnt = 0;
    this._ehFail = 0;
    this._ehSeeded = true;
    // Do not touch _inphincTgt here (see EH_LIVE comment).
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
    let bestScore = Infinity;
    for (let L = lDsMin; L <= lDsMax; L++) {
      const E = this._ed[L];
      if (!(E > 1e-8)) continue;
      const cost = E - 2 * this._hd[L];
      if (cost > eps * E) continue;
      const c0 = L > lDsMin ? this._ed[L - 1] - 2 * this._hd[L - 1] : Infinity;
      const c2 = L < lDsMax ? this._ed[L + 1] - 2 * this._hd[L + 1] : Infinity;
      if (cost <= c0 && cost <= c2 && cost < bestScore) {
        bestScore = cost;
        bestL = L;
      }
    }
    if (!bestL) return;

    // Missing-fundamental: if ~2× lag is nearly as good on full-rate, prefer it.
    let pe = bestL * EH_DS;
    const pe2 = pe * 2;
    if (pe2 >= peMin && pe2 <= peMax) {
      const wr = this.cbiwr;
      const a = this._ehSnapshot(pe, wr, this._ringMono);
      const b = this._ehSnapshot(pe2, wr, this._ringMono);
      const ca = a.E > 1e-12 ? (a.E - 2 * a.H) / a.E : Infinity;
      const cb = b.E > 1e-12 ? (b.E - 2 * b.H) / b.E : Infinity;
      if (cb <= ca * 1.05) pe = pe2;
    }
    this._ehFail = 0;
    this._ehEnterCorrection(pe);
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
    // Clarity from how tight E−2H is vs energy (1 = perfect period match).
    const fit = bestE > 1e-12 ? Math.max(0, 1 - bestCost / bestE) : 0;
    this._ehClarity = Math.max(0, Math.min(1, fit));

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
    const x = this._ringMono(this.cbiwr);
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
      const xiL = this._ringMono(this.cbiwr - L);
      const xi2L = this._ringMono(this.cbiwr - 2 * L);
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
   * ± one Cycle_period when delay leaves the N2±pe window.
   * @returns {[number, number]} wet L/R
   */
  _cycleSpliceSample(rate) {
    if (!this._spliceInit) {
      this._spliceDelay = N2;
      this._spliceInit = true;
    }
    // Cycle_period: E/H when EH_DRIVE; else YIN-locked inphinc (g2a-winning path).
    let pe =
      EH_DRIVE && this._trackOk && this._periodSamp > 1
        ? this._periodSamp
        : this.inphinc > 1e-6
          ? 1 / this.inphinc
          : sampleRate / Math.max(1e-6, midiToHz(this._lockedDet));
    pe = this._clampPe(pe);
    const r = Math.max(FACT_MIN, Math.min(FACT_MAX, rate));

    this._spliceDelay += 1 - r;

    const minD = Math.max(pe * 0.35, N2 - pe);
    const maxD = Math.min(N - pe - 4, N2 + pe);
    let guard = 0;
    while (this._spliceDelay < minD && guard++ < 8) this._spliceDelay += pe;
    guard = 0;
    while (this._spliceDelay > maxD && guard++ < 8) this._spliceDelay -= pe;
    if (this._spliceDelay < 4) this._spliceDelay = 4;
    if (this._spliceDelay > N - 4) this._spliceDelay = N - 4;

    const indd = this.cbiwr - this._spliceDelay;
    return [cubicAt(this.cbiL, indd), cubicAt(this.cbiR, indd)];
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
   * Auto-Tune Humanize: keep Retune Speed for attacks/short notes; stretch it
   * on the sustained portion of longer notes — but not while still finishing
   * into note center (humanize was undoing center-tight on pop).
   */
  _effectiveSpeed(speedMs, humanize) {
    let spd = Math.max(0, speedMs);
    if (this._softRatioChase()) {
      // Cold: taper floor → base speed over COLD_START_MS (no cliff at expiry).
      if (this._coldStart) {
        const u = Math.min(1, this._coldStartMs / COLD_START_MS);
        const floor = COLD_START_SPEED_FLOOR_MS * (1 - u) + spd * u;
        if (floor > spd) spd = floor;
      }
      // Rapid-run commits: brief floor so each note isn't a 25ms staircase.
      // Stationary: cap floor at the knob so pop-speed (~27) isn't slowed.
      if (this._commitSoftMs > 0) {
        const stable =
          this._stablePitchMs >= STABLE_PITCH_MS &&
          this._pitchVel < SCOOP_VEL_ST_S &&
          !this._pendingHold;
        // Stationary: cap floor at the knob. Transitions: full commit soft floor
        // (anti-staircase). Center-chase capped separately so no soft→Cher snap.
        const floor = stable
          ? Math.min(COMMIT_SOFT_STABLE_FLOOR_MS, spd)
          : COMMIT_SOFT_FLOOR_MS;
        if (spd < floor) spd = floor;
      }
      if (this._reverbSoftMs > 0 && spd < REVERB_SOFT_FLOOR_MS) {
        spd = REVERB_SOFT_FLOOR_MS;
      }
    }
    const h = Math.max(0, Math.min(1, humanize));
    if (h < 0.001 || this._noteAgeMs <= HUMANIZE_SUSTAIN_MS) return spd;
    // Lever 1: no humanize stretch while off sticky center.
    const centerErrCents =
      Math.abs(this._audibleWant - this._committedTgt) * 100;
    if (centerErrCents > HUMANIZE_OFF_CENTER_CENTS) return spd;
    if (this._pendingHold) return spd;
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

  /** Snap locked det → scale/MIDI want (amount + AT Flex-Tune). */
  _wantFromDet(det, amount, flexCents, transpose) {
    const scalePcs = scalePcsOf(this._scale, this._customPcs);
    let tgt;
    if (this._midiFollow && this._midiNotes.length > 0) {
      tgt = nearestMidiNote(det, this._midiNotes) + transpose;
    } else {
      tgt = nearestScaleMidi(det, this._key, scalePcs) + transpose;
    }
    const want = pullToward(det, tgt, amount, flexCents);
    return { tgt, want };
  }

  /**
   * Autotune-style: keep sticky scale target until raw is clearly closer to
   * another note (hysteresis). Directed scoops use softer hyst so midzone
   * doesn't park then cliff. Lever 3: stable vib-center + latch + step cap.
   */
  _shouldRetarget(
    rawMidi,
    amount,
    flexCents,
    transpose,
    midzone,
    isStable,
  ) {
    // Reverb multipitch / octave rival: don't chase a new neighbor.
    if (this._ambiguous || this._pitchConf < CONF_RETARGET) return false;
    // Soft-land park: only a directed scoop may leave the latched note.
    const scooping =
      Math.abs(this._signedPitchVel) >= RETARGET_RAW_VEL_ST_S ||
      this._pitchVel >= SCOOP_VEL_ST_S;
    if (
      this._centerLatched &&
      !(midzone && midzone.u >= 0.45) &&
      !scooping &&
      this._pitchVel < GESTURE_VEL_ST_S
    ) {
      return false;
    }
    // Stationary: judge retarget on vib-center so vibrato/flatness doesn't
    // flip A↔G#. Directed scoops must use live raw — vib-center lag dipped.
    // Exception: if live raw has already left sticky farther than vib-center,
    // vib-center lag was *hiding* orphan sticky (dry_2 @ ~6.0 / ~9.6: raw on
    // A, vib-center still near B → never released).
    let pitch =
      isStable && !midzone && !scooping ? this._vibCenter : rawMidi;
    const sticky = this._committedTgt;
    if (
      isStable &&
      !scooping &&
      Math.abs(rawMidi - sticky) > Math.abs(this._vibCenter - sticky) + 0.12
    ) {
      pitch = rawMidi;
    }
    const fresh = this._wantFromDet(pitch, amount, flexCents, transpose);
    let tgt = octaveLock(fresh.tgt, sticky);
    if (Math.abs(tgt - sticky) < 0.25) return false;
    if (
      Math.abs(tgt - sticky) > MAX_RETARGET_STEP_SEMI &&
      this._pitchVel < GESTURE_VEL_ST_S
    ) {
      return false;
    }
    // Anti-dip: never retarget opposite the scoop (was A→G# while dry rose).
    const stepDir = Math.sign(tgt - sticky);
    if (
      scooping &&
      stepDir !== 0 &&
      this._signedPitchVel * stepDir < -0.5
    ) {
      return false;
    }
    // Neighbor must lie on the same side of sticky as live pitch — blocks
    // brief reverse dips (dry 57.6→57.1) from arming the lower neighbor.
    const side = Math.sign(pitch - sticky);
    if (stepDir !== 0 && side !== 0 && stepDir !== side) {
      return false;
    }
    const dSticky = Math.abs(pitch - sticky);
    const dFresh = Math.abs(pitch - tgt);
    // Stronger hysteresis when confidence is merely OK (verby) / parked.
    let hyst = RETUNE_HYST_SEMI + (1 - Math.min(1, this._pitchConf)) * 0.28;
    if (isStable && !midzone && !scooping) hyst += RETUNE_HYST_STABLE_EXTRA;
    if (midzone) hyst *= MIDZONE_HYST_SCALE;
    // Scooping: lighten hyst so sticky doesn't drag through the bend.
    // dry_2: 0.72 armed ~0.8st late; 0.4 opened wobble — land in between.
    if (scooping && !midzone) hyst *= 0.55;
    // Past the midpoint toward neighbor: sticky no longer owns the pitch.
    // Without this, a scoop can land closer to A while sticky=B, vel drops,
    // stable hyst engages, and we park on the wrong note (dry_2 ~5.5 / ~9.6).
    const mid = (sticky + tgt) * 0.5;
    const pastMid =
      stepDir !== 0 && (pitch - mid) * stepDir > 0;
    if (pastMid) hyst *= 0.32;
    // Orphan sticky: clearly closer to fresh than sticky — release even parked.
    if (!scooping && dFresh + 0.28 < dSticky) hyst *= 0.4;
    return dFresh + hyst < dSticky;
  }

  /** True if hold candidate still beats sticky — re-check before committing. */
  _holdStillWins(holdMidi, amount, flexCents, transpose, midzone, isStable) {
    return this._shouldRetarget(
      holdMidi,
      amount,
      flexCents,
      transpose,
      midzone,
      isStable,
    ) || !!(midzone && midzone.u >= 0.55);
  }

  /**
   * Live pitch clearly owns a neighbor over sticky (past midpoint / far closer).
   * Used to skip the hold wait — sticky+stable-hyst was parking wrong notes
   * for tens of ms after the scoop already landed (dry_2 @ 6.0s A←B).
   */
  _orphanNeighbor(rawMidi, amount, flexCents, transpose) {
    // Cold re-entry: conf/ambiguous gates were blocking the E→F# land @ ~20s
    // right after the phrase gap (YIN conf still slewing up).
    if (
      !this._coldStart &&
      (this._ambiguous || this._pitchConf < CONF_RETARGET * 0.85)
    ) {
      return null;
    }
    const sticky = this._committedTgt;
    const fresh = this._wantFromDet(rawMidi, amount, flexCents, transpose);
    const tgt = octaveLock(fresh.tgt, sticky);
    if (Math.abs(tgt - sticky) < 0.25) return null;
    if (Math.abs(tgt - sticky) > MAX_RETARGET_STEP_SEMI) return null;
    const dS = Math.abs(rawMidi - sticky);
    const dF = Math.abs(rawMidi - tgt);
    const toward = Math.sign(tgt - sticky);
    const side = Math.sign(rawMidi - sticky);
    if (toward !== 0 && side !== 0 && toward !== side) return null;
    const mid = (sticky + tgt) * 0.5;
    const pastMid = toward !== 0 && (rawMidi - mid) * toward > 0;
    // g3: slightly earlier release — dry_2 @ 6.67 / 9.88 parked on B while
    // raw already owned A (stable hyst hid shouldRetarget; orphan must fire).
    if (pastMid && dF + 0.14 < dS) return { tgt, want: fresh.want };
    if (dF + 0.32 < dS) return { tgt, want: fresh.want };
    // g2l: dry firmly on natural (|err|≤42¢) while sticky is another note —
    // flex-to-stale was dry-through @ ~20s. Release without waiting pastMid.
    if (dF <= 0.42 && dS >= 0.7 && dF + 0.22 < dS) {
      return { tgt, want: fresh.want };
    }
    // g2m: post-silence scoop (dry_2 @ ~20s) — cold re-entry still has mild
    // vel / conf; release as soon as natural clearly owns over sticky.
    if (
      this._coldStart &&
      dF <= 0.5 &&
      dS >= 0.55 &&
      dF + 0.08 < dS
    ) {
      return { tgt, want: fresh.want };
    }
    return null;
  }

  /**
   * Scoop clearly heading toward a neighbor through the midzone.
   * Returns null, or { want, tgt, u } with u in 0..1 (how committed the approach is).
   */
  _midzoneApproach(rawMidi, amount, flexCents, transpose) {
    if (this._ambiguous || this._pitchConf < CONF_RETARGET * 0.8) return null;
    if (this._pitchVel < MIDZONE_VEL_ST_S) return null;
    const fresh = this._wantFromDet(rawMidi, amount, flexCents, transpose);
    const sticky = this._committedTgt;
    const neigh = octaveLock(fresh.tgt, sticky);
    if (Math.abs(neigh - sticky) < 0.25) return null;
    if (Math.abs(neigh - sticky) > MAX_RETARGET_STEP_SEMI) return null;
    const dSticky = Math.abs(rawMidi - sticky);
    const dFresh = Math.abs(rawMidi - neigh);
    if (dSticky < MIDZONE_ENTER_SEMI) return null;
    // Still clearly owned by sticky (not closing).
    if (dFresh > dSticky + MIDZONE_CLOSE_SLACK) return null;
    // Motion must be toward the neighbor, not vibrato chatter / opposite dip.
    const toward = Math.sign(neigh - sticky);
    if (!(this._signedPitchVel * toward > MIDZONE_TOWARD_ST_S)) return null;
    if (this._signedPitchVel * toward < 0) return null;
    // Same-side gate: pitch must already be on the neighbor's side of sticky.
    const side = Math.sign(rawMidi - sticky);
    if (toward !== 0 && side !== 0 && toward !== side) return null;
    // u: rises as soon as we're past enter + closing; →1 as neighbor wins.
    const gap = dSticky - dFresh;
    const u = Math.max(
      0,
      Math.min(
        1,
        (dSticky - MIDZONE_ENTER_SEMI) / 0.35 +
          (gap + MIDZONE_CLOSE_SLACK) / (0.28 + MIDZONE_CLOSE_SLACK) * 0.55,
      ),
    );
    // Want pulled toward octave-locked neighbor (not a flipped register).
    const want = pullToward(rawMidi, neigh, amount, flexCents);
    return { want, tgt: neigh, u, dSticky, dFresh };
  }

  _commitWant(det, amount, flexCents, transpose) {
    const c = this._wantFromDet(det, amount, flexCents, transpose);
    let tgt = c.tgt;
    let want = c.want;
    // Keep register with prior sticky — octave flips were a chunk of disagree.
    // (w1 commit-time sticky-keep raised owned-note misses — retarget hyst
    // alone gates the switch; once hold wins, take the fresh neighbor.)
    if (this._everLocked) {
      const locked = octaveLock(tgt, this._committedTgt);
      if (Math.abs(locked - tgt) > 0.05) {
        tgt = locked;
        want = pullToward(det, tgt, amount, flexCents);
      }
    }
    this._committedWant = want;
    this._committedTgt = tgt;
    this._tgtMidi = tgt;
    this._corrMidi = want;
    return { tgt, want };
  }

  /**
   * Do-no-harm: corrected pitch must never be more off-key than dry vs the note
   * the dry pitch actually belongs to, and must stay on the det↔want segment
   * (no pull past the correction target). Soft lag + sticky-old-want was
   * yanking past the recording toward a stale note — this forbids that.
   */
  _guardRatio(inHz, fact, detMidi, wantMidi, naturalTgt) {
    if (!(inHz > 1e-6) || !(fact > 1e-6)) return 1;
    let out = hzToMidi(inHz * fact);

    // Stay between dry and correction target (no overshoot past want)
    let lo = Math.min(detMidi, wantMidi);
    let hi = Math.max(detMidi, wantMidi);
    if (out < lo) out = lo;
    if (out > hi) out = hi;

    // Never worse than dry relative to the natural scale note for this det
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
   * Note commit: stays_locked + hysteretic hold.
   * Sticky tgt until raw clearly prefers another note; R* always tracks
   * hz(committedWant)/hz(liveDet). Do-no-harm clamp applied in process().
   * @param {boolean} decideNote — false: update vel/want/R* only (fast YIN);
   *   true: also run hold/retarget (legacy ~11.6 ms decide rate).
   */
  _applyCorrection(
    rawMidi,
    amount,
    speedMs,
    flexCents,
    transpose,
    vibrato,
    decideNote,
  ) {
    const dtMs = this._detectDt * 1000;
    const noteDtMs = this._noteDt * 1000;
    const livePitch =
      typeof this._liveYinMidi === "number" ? this._liveYinMidi : rawMidi;
    // Pitch velocity — mild seasoning only (see HOLD_* / boundary follow).
    if (!this._haveRawVel) {
      this._prevRawVel = livePitch;
      this._haveRawVel = true;
      this._pitchVel = 0;
      this._signedPitchVel = 0;
      this._stablePitchMs = 0;
    } else {
      const dRaw = livePitch - this._prevRawVel;
      const dSt = dRaw / Math.max(1e-4, this._detectDt);
      this._signedPitchVel += (dSt - this._signedPitchVel) * 0.4;
      this._pitchVel += (Math.abs(dSt) - this._pitchVel) * 0.4;
      this._prevRawVel = livePitch;
      if (this._pitchVel < STABLE_VEL_ST_S) this._stablePitchMs += dtMs;
      else this._stablePitchMs = 0;
    }
    const isStable = this._stablePitchMs >= STABLE_PITCH_MS;
    const isGesture = this._pitchVel >= GESTURE_VEL_ST_S;
    // Vib-center for boundary soften / stays widen — not for retarget lag.
    const pitchSoft =
      this._noteAgeMs > VIB_CENTER_MS * 0.35 ? this._vibCenter : livePitch;
    const midzone = this._noteLocked
      ? this._midzoneApproach(livePitch, amount, flexCents, transpose)
      : null;

    let needHold = holdMsForSpeed(speedMs, this._coldStart, this._pitchConf);
    if (midzone) needHold *= MIDZONE_HOLD_SCALE;
    else if (isStable) needHold *= HOLD_STABLE_SCALE;
    else if (isGesture) needHold *= HOLD_GESTURE_SCALE;
    // Orphan / past-mid holds: don't wait a full stable hold on the wrong note.
    if (this._pendingHold && this._noteLocked) {
      const candTgt = octaveLock(
        this._wantFromDet(this._holdCand, amount, flexCents, transpose).tgt,
        this._committedTgt,
      );
      const mid = (this._committedTgt + candTgt) * 0.5;
      const toward = Math.sign(candTgt - this._committedTgt);
      if (
        toward !== 0 &&
        (rawMidi - mid) * toward > 0 &&
        Math.abs(rawMidi - candTgt) + 0.2 < Math.abs(rawMidi - this._committedTgt)
      ) {
        needHold *= 0.55;
      }
    }
    let justCommitted = false;

    if (!decideNote) {
      // Fast path: track det, refresh Flex-Tune want — no note flip this hop.
      if (this._noteLocked) {
        const detA = isGesture || midzone ? 0.28 : 0.12;
        this._lockedDet += (rawMidi - this._lockedDet) * detA;
        this._tgtMidi = this._committedTgt;
      }
    } else if (!this._noteLocked) {
      this._lockedDet = rawMidi;
      this._holdCand = rawMidi;
      this._holdAccumMs = 0;
      this._pendingHold = false;
      this._noteLocked = true;
      this._commitWant(rawMidi, amount, flexCents, transpose);
      justCommitted = true;
    } else if (this._pendingHold) {
      // Reverb: freeze hold clock while ambiguous — abort→recommit clicked.
      if (this._ambiguous || this._pitchConf < CONF_RETARGET * 0.9) {
        this._lockedDet += (rawMidi - this._lockedDet) * 0.1;
      } else if (this._orphanNeighbor(livePitch, amount, flexCents, transpose)) {
        // Scoop already landed on the neighbor — don't wait out needHold.
        // g3: orphan alone is enough; holdStillWins re-applied stable hyst and
        // aborted the fast commit (wet sat on sticky center of the wrong note).
        this._lockedDet = livePitch;
        this._holdAccumMs = 0;
        this._pendingHold = false;
        this._orphanCommit = true;
        this._commitWant(this._lockedDet, amount, flexCents, transpose);
        justCommitted = true;
      } else if (Math.abs(livePitch - this._holdCand) <= STAYS_LOCKED_SEMI) {
        this._holdCand += (livePitch - this._holdCand) * 0.4;
        this._holdAccumMs += noteDtMs;
        // Live det still tracks so R* keeps output on sticky want
        this._lockedDet += (rawMidi - this._lockedDet) * 0.25;
        if (this._holdAccumMs >= needHold) {
          // Re-validate at commit — flat sustains often no longer beat sticky.
          if (
            !this._holdStillWins(
              this._holdCand,
              amount,
              flexCents,
              transpose,
              midzone,
              isStable,
            )
          ) {
            this._pendingHold = false;
            this._holdAccumMs = 0;
          } else {
            this._lockedDet = this._holdCand;
            this._holdAccumMs = 0;
            this._pendingHold = false;
            this._commitWant(this._lockedDet, amount, flexCents, transpose);
            justCommitted = true;
          }
        }
      } else if (
        this._shouldRetarget(
          livePitch,
          amount,
          flexCents,
          transpose,
          !!midzone,
          isStable,
        )
      ) {
        // New candidate wins — restart hold
        this._holdCand = livePitch;
        this._holdAccumMs = noteDtMs;
        this._lockedDet += (rawMidi - this._lockedDet) * 0.25;
      } else if (midzone && midzone.u > 0.12) {
        // Still scooping toward neighbor — keep hold alive, don't abort.
        this._holdCand += (livePitch - this._holdCand) * 0.4;
        this._holdAccumMs += noteDtMs * 0.95;
        this._lockedDet += (rawMidi - this._lockedDet) * 0.28;
        if (this._holdAccumMs >= needHold) {
          if (
            !this._holdStillWins(
              this._holdCand,
              amount,
              flexCents,
              transpose,
              midzone,
              isStable,
            )
          ) {
            this._pendingHold = false;
            this._holdAccumMs = 0;
          } else {
            this._lockedDet = this._holdCand;
            this._holdAccumMs = 0;
            this._pendingHold = false;
            this._commitWant(this._lockedDet, amount, flexCents, transpose);
            justCommitted = true;
          }
        }
      } else {
        // Drifted but sticky still wins — cancel hold
        this._pendingHold = false;
        this._holdAccumMs = 0;
        this._lockedDet += (rawMidi - this._lockedDet) * 0.15;
      }
    } else if (
      Math.abs(pitchSoft - this._committedTgt) <= STAYS_LOCKED_SEMI ||
      Math.abs(livePitch - this._committedTgt) <= STAYS_LOCKED_SEMI
    ) {
      // Near sticky: slow det track — rough vocals were pumping R* via lockedDet.
      const detA = isGesture || midzone ? 0.22 : 0.08;
      this._lockedDet += (rawMidi - this._lockedDet) * detA;
      this._tgtMidi = this._committedTgt;
      // g3: orphan is independent of shouldRetarget — vib-center lag / stable
      // hyst often false-negative while raw already owns the neighbor.
      const orphan = this._orphanNeighbor(
        livePitch,
        amount,
        flexCents,
        transpose,
      );
      if (orphan) {
        this._lockedDet = livePitch;
        this._pendingHold = false;
        this._holdAccumMs = 0;
        this._orphanCommit = true;
        this._commitWant(livePitch, amount, flexCents, transpose);
        justCommitted = true;
      } else {
        const wantRetarget =
          this._shouldRetarget(
            livePitch,
            amount,
            flexCents,
            transpose,
            !!midzone,
            isStable,
          ) || (midzone && midzone.u >= MIDZONE_HOLD_ARM_U);
        if (wantRetarget) {
          this._holdCand = livePitch;
          this._holdAccumMs = noteDtMs;
          this._pendingHold = true;
        }
      }
    } else if (
      this._shouldRetarget(
        livePitch,
        amount,
        flexCents,
        transpose,
        !!midzone,
        isStable,
      ) ||
      (midzone && midzone.u >= MIDZONE_HOLD_ARM_U)
    ) {
      const orphan = this._orphanNeighbor(
        livePitch,
        amount,
        flexCents,
        transpose,
      );
      if (orphan) {
        this._lockedDet = livePitch;
        this._pendingHold = false;
        this._holdAccumMs = 0;
        this._orphanCommit = true;
        this._commitWant(livePitch, amount, flexCents, transpose);
        justCommitted = true;
      } else {
        this._holdCand = livePitch;
        this._holdAccumMs = noteDtMs;
        this._pendingHold = true;
        this._lockedDet += (rawMidi - this._lockedDet) * 0.25;
      }
    } else {
      // Outside stays window — still release if raw already owns a neighbor.
      const orphan = this._orphanNeighbor(
        livePitch,
        amount,
        flexCents,
        transpose,
      );
      if (orphan) {
        this._lockedDet = livePitch;
        this._pendingHold = false;
        this._holdAccumMs = 0;
        this._orphanCommit = true;
        this._commitWant(livePitch, amount, flexCents, transpose);
        justCommitted = true;
      } else {
        // Sticky still preferred — ease det, keep want
        const detA = isGesture || midzone ? 0.22 : 0.1;
        this._lockedDet += (rawMidi - this._lockedDet) * detA;
        this._tgtMidi = this._committedTgt;
      }
    }

    const det = this._lockedDet;
    this._detMidi = det;
    this._corrMidi = this._committedWant;
    const tgt = this._committedTgt;
    this._tgtMidi = tgt;
    // Full-snap natural target for current det (amount=1, flex=0) — guardrail ref
    this._naturalTgt = this._wantFromDet(det, 1, 0, transpose).tgt;

    // Note age + vibrato center (Humanize / Natural Vibrato)
    if (justCommitted) {
      this._noteAgeMs = 0;
      this._vibCenter = det;
      this._vibSemiSlew = 0;
      this._vibGateSlew = 0;
      this._wantBaseSlew = this._committedWant;
      this._stablePitchMs = 0;
      this._ownedSustainHoldMs = 0;
    } else {
      this._noteAgeMs += dtMs;
      const vibA = 1 - Math.exp(-this._detectDt / (VIB_CENTER_MS / 1000));
      this._vibCenter += (det - this._vibCenter) * vibA;
    }

    // Post-commit: pull sticky want onto scale center while stationary.
    // Gestures / pending / midzone skip — scoop territory (anti-shake).
    if (
      !justCommitted &&
      !this._pendingHold &&
      !isGesture &&
      !midzone &&
      isStable &&
      this._noteAgeMs >= CENTER_LOCK_AGE_MS
    ) {
      const residCents =
        Math.abs(this._committedWant - this._committedTgt) * 100;
      if (residCents > 0.15 && residCents <= 55) {
        const u = Math.min(
          1,
          (this._noteAgeMs - CENTER_LOCK_AGE_MS) / 40,
        );
        this._committedWant +=
          (this._committedTgt - this._committedWant) *
          (CENTER_WANT_PULL * u);
        // Near-center / loose-hold band: finish hard (≤15¢ + kill 15–35¢ parks).
        if (residCents <= 38) {
          this._committedWant +=
            (this._committedTgt - this._committedWant) * (0.48 * u);
        }
        // Score loose band: extra pull so Decay doesn't linger 80ms+ at ~25¢.
        if (residCents >= LOOSE_HOLD_LO_CENTS && residCents <= 35) {
          this._committedWant +=
            (this._committedTgt - this._committedWant) * (0.4 * u);
        }
      }
    }

    // Want base: live Flex-Tune pull toward sticky (not frozen commit want).
    // AT: correction only near the note — far scoops pass through.
    const nat = this._wantFromDet(det, 1, 0, transpose);
    const dSticky = Math.abs(det - this._committedTgt);
    const dNat = Math.abs(det - nat.tgt);
    // Live YIN (pre trust-blend) — trust blend toward lockedDet was hiding
    // post-gap landings from orphan/landedNatural (dry_2 @ ~20.2).
    const live =
      typeof this._liveYinMidi === "number" ? this._liveYinMidi : rawMidi;
    const rawNat = this._wantFromDet(live, 1, 0, transpose);
    const dStickyRaw = Math.abs(live - this._committedTgt);
    const dNatRaw = Math.abs(live - rawNat.tgt);
    const quietPark =
      !isGesture &&
      !midzone &&
      !this._pendingHold &&
      !justCommitted &&
      this._pitchVel < SCOOP_VEL_ST_S &&
      this._noteAgeMs >= 35;
    // 14s: mild YIN wobble keeps vel 5–12 (above SCOOP) and isStable false —
    // quietPark never sticks, hard taper parks want ~25¢ then collapses.
    // Gate on *live* natural too — lockedDet lag + stale sticky caused lag-dips.
    const sticky = this._committedTgt;
    // Flat-only arm: 14s sits 25–90¢ under sticky. Sharp-side finish yanks
    // wet below dry (lag-dips @ ~5s / ~10s / ~16s). Hysteresis on the hold
    // so brief YIN chatter across center doesn't drop the 14s finish.
    const flatOfSticky = live <= sticky + 0.08 && det <= sticky + 0.08;
    const ownedSustainNow =
      !justCommitted &&
      !midzone &&
      !this._pendingHold &&
      this._noteAgeMs >= 28 &&
      this._pitchVel < GESTURE_VEL_ST_S * 1.7 &&
      flatOfSticky &&
      sticky - det <= 0.95 &&
      sticky - live <= 0.95 &&
      Math.abs(nat.tgt - sticky) < 0.25 &&
      Math.abs(rawNat.tgt - sticky) < 0.25;
    if (ownedSustainNow) this._ownedSustainHoldMs = 58;
    else if (
      midzone ||
      this._pendingHold ||
      Math.abs(rawNat.tgt - sticky) >= 0.25 ||
      live > sticky + 0.22 ||
      live < sticky - 0.98
    ) {
      this._ownedSustainHoldMs = 0;
    } else {
      this._ownedSustainHoldMs = Math.max(0, this._ownedSustainHoldMs - dtMs);
    }
    const ownedSustain = ownedSustainNow || this._ownedSustainHoldMs > 0;
    let wantBase;
    // Post-gap scoop (dry_2 @ ~20s): arm on E, pitch lands on F#, soft-chase
    // audibleWant catches det → R*→1 (listen wet≈dry). Judge on rawMidi.
    const landedNatural =
      !justCommitted &&
      dNatRaw <= 0.4 &&
      dStickyRaw >= 0.85 &&
      Math.abs(rawNat.tgt - this._committedTgt) >= 0.5 &&
      (this._coldStart ||
        (!this._ambiguous && this._pitchConf >= CONF_RETARGET * 0.65));
    if (landedNatural) {
      this._lockedDet = live;
      this._pendingHold = false;
      this._holdAccumMs = 0;
      this._orphanCommit = true;
      this._commitWant(live, amount, flexCents, transpose);
      justCommitted = true;
      this._noteAgeMs = 0;
      this._vibCenter = live;
      this._vibSemiSlew = 0;
      // Strong blend (not Cher snap) — g2m9 full assign was the stair.
      this._audibleWant += (rawNat.tgt - this._audibleWant) * COLD_ORPHAN_BLEND;
      this._wantBaseSlew = rawNat.tgt;
      this._wantTgt = rawNat.tgt;
      this._committedWant = rawNat.tgt;
      this._coldStartMs = Math.max(
        this._coldStartMs,
        COLD_START_MS * COLD_ORPHAN_ADVANCE,
      );
      if (this._coldStartMs >= COLD_START_MS) this._coldStart = false;
      this._commitSoftMs = Math.min(this._commitSoftMs, ORPHAN_COMMIT_SOFT_MS);
    }
    const naturalOwns =
      landedNatural ||
      (!midzone &&
        dSticky > 0.55 &&
        dNat <= 0.42 &&
        Math.abs(nat.tgt - this._committedTgt) >= 0.5 &&
        this._pitchConf >= CONF_RETARGET * 0.7) ||
      (!midzone &&
        dStickyRaw > 0.55 &&
        dNatRaw <= 0.42 &&
        Math.abs(rawNat.tgt - this._committedTgt) >= 0.5 &&
        this._pitchConf >= CONF_RETARGET * 0.7);
    if (
      (quietPark || ownedSustain) &&
      det <= sticky + 0.08 &&
      sticky - det <= 0.9
    ) {
      // Owned sticky, flat only: finish up to center (14s). Sharp-side
      // ownedFinish scored as lag-dips (wet≪dry).
      wantBase = pullToward(
        det,
        sticky,
        amount,
        flexCents,
        true,
      );
      const resid = sticky - wantBase;
      if (resid >= 0.06 && resid <= 0.42) {
        wantBase += resid * 0.78;
      } else if (resid > 0.42 && resid <= 0.9) {
        wantBase += resid * 0.5;
      }
    } else if (naturalOwns) {
      // Sticky lag dry-through (20s): dry already owns natural; flex-to-stale
      // sticky was strength→0 → wet≡dry. Pull toward natural until orphan lands.
      const pullTgt = dNatRaw <= dNat ? rawNat.tgt : nat.tgt;
      wantBase = pullToward(
        dNatRaw <= dNat ? live : det,
        pullTgt,
        amount,
        0,
        true,
      );
    } else {
      wantBase = pullToward(det, this._committedTgt, amount, flexCents);
    }
    // Keep committedWant coherent for center-lock / viz.
    this._committedWant += (wantBase - this._committedWant) * 0.35;
    if (this._pendingHold && this._holdAccumMs > 0 && !justCommitted) {
      const cand = this._wantFromDet(
        this._holdCand,
        amount,
        flexCents,
        transpose,
      );
      const candTgt = octaveLock(cand.tgt, this._committedTgt);
      const sideRaw = Math.sign(livePitch - this._committedTgt);
      const sideCand = Math.sign(candTgt - this._committedTgt);
      // Don't pre-glide toward a neighbor on the opposite side of live pitch
      // (brief reverse dips were bending want through the floor — ~9s A→G#).
      if (sideCand === 0 || sideRaw === 0 || sideCand === sideRaw) {
        const u = Math.min(1, this._holdAccumMs / Math.max(8, needHold));
        const ease = midzone ? Math.min(1, u * 1.15) : u * u;
        wantBase = wantBase + (cand.want - wantBase) * ease;
      }
    } else if (midzone && midzone.u > 0.08 && !justCommitted) {
      // Before hold arms: ease toward neighbor through the midzone.
      wantBase =
        wantBase +
        (midzone.want - wantBase) * (MIDZONE_PREGLIDE * midzone.u);
    } else if (
      !justCommitted &&
      (isStable || ownedSustain) &&
      !isGesture &&
      !midzone &&
      this._noteAgeMs >= CENTER_LOCK_AGE_MS
    ) {
      // Stationary park: bias want onto integer center.
      // Hard flex=0 strength falls below 0.55 by ~40¢ — that skipped bias and
      // left dry_2 ~10s sharp parks (AT finishes; we sat at pullToward residual).
      // ownedSustain: same bias when mild wobble keeps isStable false (14s).
      const absPark = Math.abs(det - this._committedTgt);
      const near =
        absPark <= 0.55 ||
        flexCorrectionStrength(absPark, flexCents) > 0.28 ||
        ownedSustain;
      if (near) {
        const biasScale = Math.min(
          1,
          Math.max(0.78, (this._speedMs - ROBOT_LATCH_MAX_SPEED_MS) / 40),
        );
        // Sharp: don't extra-bias onto center (wet≪dry lag-dips).
        const sharp = det > sticky + 0.05;
        if (!(ownedSustain && sharp)) {
          wantBase += (sticky - wantBase) * CENTER_WANT_BIAS * biasScale;
          if (flexCents < 0.5 && absPark <= 0.55) {
            wantBase += (sticky - wantBase) * 0.22;
          }
        }
      }
    }

    // Slew wantBase (boundary hop jumps were soft-popping).
    if (justCommitted) {
      this._wantBaseSlew = wantBase;
    } else {
      let a = WANT_BASE_SLEW_STABLE;
      if (isGesture || midzone) a = WANT_BASE_SLEW_GESTURE;
      else if (ownedSustain && det <= sticky + 0.08) {
        a = 0.55;
        const looseCents =
          Math.abs(this._wantBaseSlew - this._committedTgt) * 100;
        if (looseCents >= LOOSE_HOLD_LO_CENTS && looseCents <= LOOSE_HOLD_HI_CENTS) {
          a = Math.max(a, 0.78);
        }
      } else if (isStable && this._noteAgeMs >= CENTER_LOCK_AGE_MS) {
        a = 0.42;
        // Loose park: snap wantBase onto sticky faster (pitchy 15–35¢ holds).
        const looseCents =
          Math.abs(this._wantBaseSlew - this._committedTgt) * 100;
        if (looseCents >= LOOSE_HOLD_LO_CENTS && looseCents <= LOOSE_HOLD_HI_CENTS) {
          a = Math.max(a, 0.72);
        }
      }
      // If slew is stuck on the wrong side of sticky vs live pitch, snap back
      // faster (kills lingering bend after an aborted opposite-side hold).
      const sideSlew = Math.sign(this._wantBaseSlew - this._committedTgt);
      const sideRaw2 = Math.sign(livePitch - this._committedTgt);
      if (
        sideSlew !== 0 &&
        sideRaw2 !== 0 &&
        sideSlew !== sideRaw2 &&
        amount >= 0.85
      ) {
        a = Math.max(a, 0.55);
        wantBase = this._committedWant;
      }
      this._wantBaseSlew += (wantBase - this._wantBaseSlew) * a;
    }

    // Natural Vibrato: −1 flatten … 0 leave … +1 amplify.
    // Correct mapping uses leave≠0 at knob 0, but c2's raw (1+knob)*vibSemi
    // shook (YIN) and hard motion gates flapped. Slew residual + continuous gate.
    const vibAmt = Math.max(-1, Math.min(1, vibrato));
    const vibRaw = Math.max(
      -VIB_RESID_MAX_SEMI,
      Math.min(VIB_RESID_MAX_SEMI, det - this._vibCenter),
    );
    this._vibSemiSlew += (vibRaw - this._vibSemiSlew) * 0.22;
    // Knob → scale: -1→0, 0→VIB_LEAVE_SCALE, +1→~1.4
    const knobScale =
      vibAmt >= 0
        ? VIB_LEAVE_SCALE + vibAmt * (1.4 - VIB_LEAVE_SCALE)
        : VIB_LEAVE_SCALE * (1 + vibAmt);
    let gateT = 1;
    {
      const velU = Math.min(1, this._pitchVel / GESTURE_VEL_ST_S);
      gateT = (1 - velU) * (1 - velU);
      if (justCommitted || midzone || this._pendingHold) gateT *= 0.12;
      else if (!isStable || isGesture) gateT *= 0.35;
      gateT *= Math.min(1, this._noteAgeMs / Math.max(1, VIB_CENTER_MS * 0.75));
      // Sustained flat/sharp vs sticky is DC error, not vibrato — don't "leave" it
      // (dry_2 ~10s sat ~30–40¢ sharp because leave re-injected the offset).
      const dcCents = Math.abs(det - tgt) * 100;
      if (isStable && dcCents > 18) gateT *= 0.08;
      else if (isStable && dcCents > 10) gateT *= 0.28;
    }
    this._vibGateSlew += (gateT - this._vibGateSlew) * 0.16;
    const vibScale = knobScale * this._vibGateSlew;
    let wantEff = this._wantBaseSlew + this._vibSemiSlew * vibScale;
    // Soft-land without hard R* snaps (those clicked at ~detect rate on t-soft-land).
    // Latch want onto sticky center only in Cher-range speed — at 20ms latch
    // read as robot plateaus (wet hops >30¢ ≫ goal).
    const flexOwn =
      flexCorrectionStrength(Math.abs(det - tgt), flexCents) > 0.55;
    const allowLatch = this._speedMs < ROBOT_LATCH_MAX_SPEED_MS;
    const audErrNow = Math.abs(this._audibleWant - tgt) * 100;
    const softPark =
      isStable &&
      !isGesture &&
      !midzone &&
      !this._pendingHold &&
      !justCommitted &&
      this._noteAgeMs >= SOFT_PARK_AGE_MS &&
      this._pitchVel < STABLE_VEL_ST_S &&
      Math.abs(det - tgt) <= SOFT_PARK_DET_SEMI &&
      audErrNow >= LOOSE_HOLD_LO_CENTS &&
      audErrNow <= SOFT_PARK_AUD_HI_CENTS;
    // g2n2: 14s parked want at ~25¢ while mild YIN wobble kept isStable false —
    // allow pin without full stable gate (still block scoops).
    const loosePark =
      !softPark &&
      !isGesture &&
      !midzone &&
      !this._pendingHold &&
      !justCommitted &&
      this._noteAgeMs >= SOFT_PARK_AGE_MS &&
      this._pitchVel < GESTURE_VEL_ST_S &&
      Math.abs(det - tgt) <= 0.7 &&
      audErrNow >= 15 &&
      audErrNow <= 38;
    if (
      justCommitted ||
      isGesture ||
      midzone ||
      this._pendingHold ||
      !flexOwn ||
      (!allowLatch && !softPark && !loosePark) ||
      Math.abs(det - tgt) > CENTER_LATCH_ESCAPE_SEMI
    ) {
      this._centerLatched = false;
    } else if (
      isStable &&
      this._noteAgeMs >= CENTER_LOCK_AGE_MS &&
      Math.abs(this._audibleWant - tgt) * 100 <= SNAP_CENTER_CENTS &&
      Math.abs(this._wantBaseSlew - tgt) * 100 <= SNAP_CENTER_CENTS + 6
    ) {
      this._centerLatched = true;
    }
    if (this._centerLatched || softPark || loosePark) {
      // Pin base to sticky center; keep (DC-gated) vibrato residual only.
      wantEff = tgt + this._vibSemiSlew * Math.max(0, vibScale);
      const pin = softPark || loosePark ? (loosePark ? 0.68 : 0.55) : 1;
      this._wantBaseSlew += (tgt - this._wantBaseSlew) * pin;
      if (this._centerLatched) {
        this._wantBaseSlew = tgt;
        this._committedWant = tgt;
      } else {
        this._committedWant += (tgt - this._committedWant) * (loosePark ? 0.58 : 0.45);
      }
      // 14s flat park: nudge audible toward sticky without Cher snap.
      if (
        loosePark &&
        audErrNow >= 15 &&
        audErrNow <= 40 &&
        this._audibleWant <= tgt + 0.05
      ) {
        this._audibleWant += (tgt - this._audibleWant) * 0.35;
      }
    } else if (
      !justCommitted &&
      isStable &&
      !isGesture &&
      !midzone &&
      !this._pendingHold &&
      this._noteAgeMs >= CENTER_LOCK_AGE_MS
    ) {
      // Clamp corrected base through center; re-apply slewed vibrato after.
      const aud = this._audibleWant;
      let base = this._wantBaseSlew;
      if ((aud - tgt) * (base - tgt) < 0) base = tgt;
      wantEff = base + this._vibSemiSlew * vibScale;
    }
    // Confidence ducks wet amount in process() — do not bend want/R* here.
    this._wantTgt = wantEff;
    // Soft chase (PSOLA or patent splice) slews _audibleWant in process(); robot snaps.
    if (!this._softRatioChase()) {
      this._audibleWant = wantEff;
    }
    this._corrMidi = this._audibleWant;

    // R* from sticky want / lockedDet (YIN note path). Cycle_period from E/H
    // feeds the splice pointer only — driving R* from raw E/H regressed notes.
    const inHz = midiToHz(det);
    const outHz = midiToHz(this._audibleWant);
    let rStar = outHz / Math.max(1e-12, inHz);
    if (rStar < FACT_MIN) rStar = FACT_MIN;
    if (rStar > FACT_MAX) rStar = FACT_MAX;
    this._rStar = rStar;

    if (justCommitted) {
      const orphan = this._orphanCommit;
      this._orphanCommit = false;
      if (this._formant >= 0.5) {
        this._beginCommitRecapture();
        if (this._speedMs >= 0.5) {
          this._commitSoftMs = orphan ? ORPHAN_COMMIT_SOFT_MS : COMMIT_SOFT_MS;
          if (orphan) {
            this._audibleWant +=
              (wantEff - this._audibleWant) * ORPHAN_AUDIBLE_BLEND;
          }
          // Keep audible want — Retune Speed glides to the new note.
        } else {
          this._audibleWant = wantEff;
        }
      } else if (this._softRatioChase()) {
        // Patent splice + Decay: glide want across notes; no PSOLA grain.
        this._clearCommitRecapture();
        this._psolaHalf = 0;
        this._commitSoftMs = orphan ? ORPHAN_COMMIT_SOFT_MS : COMMIT_SOFT_MS;
        if (orphan) {
          // Post-gap land: strong blend + advance cold floor (not Cher snap).
          if (this._coldStart || this._coldStartMs > 0) {
            this._audibleWant +=
              (wantEff - this._audibleWant) * COLD_ORPHAN_BLEND;
            this._wantBaseSlew +=
              (wantEff - this._wantBaseSlew) * COLD_ORPHAN_BLEND;
            this._wantTgt = wantEff;
            this._coldStartMs = Math.max(
              this._coldStartMs,
              COLD_START_MS * COLD_ORPHAN_ADVANCE,
            );
            if (this._coldStartMs >= COLD_START_MS) this._coldStart = false;
            this._commitSoftMs = ORPHAN_COMMIT_SOFT_MS;
          } else {
            this._audibleWant +=
              (wantEff - this._audibleWant) * ORPHAN_AUDIBLE_BLEND;
          }
        }
      } else {
        this._clearCommitRecapture();
        this._psolaHalf = 0;
        this._audibleWant = wantEff;
      }
      if (!this._softRatioChase()) this._seedPhases(this._rStar);
    }

    this._inphincTgt = inHz / sampleRate;
    this.inphinc = this._inphincTgt;
    // outphinc updated in process from live inphinc * phincSlew
    const outMidi = hzToMidi(inHz * this.phincfact);
    this._outMidi = outMidi;
    return { det, tgt, out: outMidi };
  }

  _lowRate(amount, speedMs, flexCents, tracking, transpose, humanize, vibrato) {
    if (this._warmup > 0) {
      this._warmup -= DETECT_EVERY;
      this.phincfact = 1;
      this._phincSlew = 1;
      return;
    }

    // Tracking knob → patent ε (looser = tolerate cycle-shape change).
    const tr = Math.max(0, Math.min(1, tracking));
    this._ehEps = EH_EPS_LOOSE + (EH_EPS_TIGHT - EH_EPS_LOOSE) * tr;

    // Notes/sticky: YIN (stable vs AT goal). E/H runs per-sample for Cycle_period
    // on the splice path; YIN also seeds/reanchors correction mode.
    this._readMonoWindow(this._yinScratch);
    const yin = yinPitch(
      this._yinScratch,
      sampleRate,
      this._fMin,
      this._fMax,
      this._yinD,
      this._yinCmnd,
    );
    const f0 = yin.f0;
    const clarity = yin.clarity;
    const ambiguous = yin.ambiguous;
    if (EH_LIVE && f0 > 0 && clarity >= 0.3) {
      const pe = sampleRate / f0;
      if (this._detectionMode || !this._trackOk) {
        this._ehEnterCorrection(pe);
      } else {
        const rel =
          Math.abs(pe - this._periodSamp) / Math.max(1, this._periodSamp);
        if (rel > 0.2) this._ehEnterCorrection(pe);
      }
      this._ehClarity = Math.max(this._ehClarity, clarity);
    }
    this._clarity = clarity;
    this._ambiguous = !!ambiguous;
    const confInst = f0 > 0 ? (yin.confidence ?? clarity) : clarity * 0.3;
    if (!this._havePitch) this._pitchConf = confInst;
    else this._pitchConf += (confInst - this._pitchConf) * 0.28;
    if (ambiguous) this._reverbSoftMs = REVERB_SOFT_MS;
    // Hysteresis + debounce close: room reflections dip conf for a hop or two —
    // don't flash dry mid-vowel. Reopen is still immediate above HI.
    const dtMs = this._detectDt * 1000;
    if (this._confWetOpen) {
      if (this._pitchConf < CONF_WET_LO) {
        this._confWetLowMs += dtMs;
        if (this._confWetLowMs >= CONF_WET_CLOSE_MS) {
          this._confWetOpen = false;
          this._confWetLowMs = 0;
        }
      } else {
        this._confWetLowMs = 0;
      }
    } else if (this._pitchConf > CONF_WET_HI) {
      this._confWetOpen = true;
      this._confWetLowMs = 0;
    }

    const gate = 0.14 + (1 - Math.max(0, Math.min(1, tracking))) * 0.5;
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

    if (loudEnough && clarity >= gate && f0 > 0) {
      let midi = this._foldIntoRange(hzToMidi(f0));
      // Pre-smooth YIN (octave-locked only) — trust blend toward lockedDet was
      // hiding post-gap landings from orphan/landedNatural (dry_2 @ ~20.2).
      let liveYin = midi;
      if (this._havePitch) {
        liveYin = octaveLock(midi, this._lockedDet || this._detMidi);
        liveYin = this._foldIntoRange(liveYin);
        midi = liveYin;
        const jump = Math.abs(midi - (this._lockedDet || this._detMidi));
        if (jump > MAX_JUMP_SEMI) {
          this._stable = Math.max(0, this._stable - 2);
          midi = this._lockedDet || this._detMidi;
          liveYin = midi;
        } else {
          this._stable++;
          const trust = Math.max(
            0.12,
            Math.min(1, (this._pitchConf - gate) / 0.4),
          );
          const prev = this._lockedDet || this._detMidi;
          midi = prev + (midi - prev) * (0.15 + 0.85 * trust);
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
          this._commitWant(midi, amount, flexCents, transpose);
          this._setUnityPhases(midi); // lock inphinc/outphinc to *this* note before OLA runs
          this._seedPhases(1);
          this.phasein = 0;
          this.phaseout = 0;
          this.fragsize = 0;
          this._resetCycleSplice();
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
          this._audibleWant = midi;
          this._wantTgt = midi;
          this._wantBaseSlew = midi;
          this._haveRawVel = false;
          this._pitchVel = 0;
          this._signedPitchVel = 0;
          this._stablePitchMs = 0;
        }
        liveYin = midi;
      }

      this._voiced = true;
      this._unvoicedN = 0;
      if (this._armed) {
        this._psolaOnsetMs += this._detectDt * 1000;
      }

      if (this._armed) {
        this._everLocked = true;
        this._detectHop = (this._detectHop + 1) | 0;
        const decideNote = this._detectHop % NOTE_DECIDE_HOPS === 0;
        this._liveYinMidi = liveYin;
        const c = this._applyCorrection(
          midi,
          amount,
          speedMs,
          flexCents,
          transpose,
          vibrato,
          decideNote,
        );
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
      // Still energy but weak clarity: hold last lock — do not unvoice (R*→1 clicked).
      this._voiced = true;
      this._unvoicedN = Math.max(0, this._unvoicedN - 1);
      this._psolaOnsetMs += this._detectDt * 1000;
      const midi = this._lockedDet;
      const c = this._applyCorrection(
        midi,
        amount,
        speedMs,
        flexCents,
        transpose,
        vibrato,
      );
      det = c.det;
      tgt = c.tgt;
      out = c.out;
    } else {
      this._voiced = false;
      this._unvoicedN++;
      this._clarity *= 0.9;
      this._stable = Math.max(0, this._stable - 1);
      this.phincfact += (1 - this.phincfact) * 0.04;
      this._phincSlew += (this.phincfact - this._phincSlew) * 0.04;
      this.outphinc =
        this.inphinc * Math.max(FACT_MIN, Math.min(FACT_MAX, this.phincfact));
      if (this._unvoicedN >= UNVOICED_DROP) {
        // Phrase gap: clear sticky note/detect hop, keep ring (no click).
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
    const flex = parameters.flex[0];
    const humanize = parameters.humanize[0];
    const vibrato = parameters.vibrato[0];
    const tracking = parameters.tracking[0];
    const transpose = parameters.transpose[0];
    this._speedMs = Math.max(0, speed);
    this._vibrato = vibrato;
    this._effSpeedMs = this._effectiveSpeed(this._speedMs, humanize);
    this._formant = parameters.formant[0];
    if (this._formant < 0.5) this._psolaWant = false;

    // Ratio chase: effective Retune Speed (Humanize may stretch on sustains).
    // Robot snaps. Fairbanks = within-note only. Soft+PSOLA = full chase.
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
      if (this._coldStart && this._softRatioChase()) {
        ms = Math.max(ms, COLD_WET_XFADE_MS);
      }
      // Conf gate closed, or mid dry↔wet: slower fade (avoids click/comb chatter).
      if (!this._confWetOpen || (this._wetMix > 0.02 && this._wetMix < 0.98)) {
        ms = Math.max(ms, CONF_WET_XFADE_MS);
      }
      return ms;
    })();
    const wetXfadeAlpha =
      1 - Math.exp(-1 / Math.max(1, (wetXfadeMs / 1000) * sampleRate));
    const softPsola = this._softRatioChase();
    // Default: Retune Speed through note transitions. Stationary + near center
    // → finish last cents faster. Allow late commit-soft so loose holds don't
    // wait out the full soft window before the chase engages.
    let wantChaseMs = spd;
    // Knob Retune Speed (pre-Humanize) — finishing into center must not wait
    // on sustain stretch or we park pitchy in the 15–35¢ band.
    const knobSpd = Math.max(0.5, this._speedMs);
    const audErrPre =
      Math.abs(this._audibleWant - this._committedTgt) * 100;
    const audFlat =
      this._audibleWant <= this._committedTgt + 0.08;
    // g3: mild dry wobble resets stablePitchMs; still finish *existing* loose
    // parks (not mid-scoop — that regressed dips on g3c).
    // Flat-only speedup: sharp-side chase was wet≪dry lag-dips.
    const parkFinish =
      this._stablePitchMs >= STABLE_PITCH_MS ||
      (audFlat &&
        audErrPre >= LOOSE_HOLD_LO_CENTS &&
        audErrPre <= LOOSE_HOLD_HI_CENTS &&
        this._noteAgeMs >= 40 &&
        this._pitchVel < GESTURE_VEL_ST_S);
    // g2g: commit-soft was blocking loose finish for ~70ms after note hops —
    // exponential math says 15–35¢ should clear in ~17ms @ 20ms tau *unless*
    // chase stays floored / gated. Allow loose-band finish through commit-soft.
    const looseBandFinish =
      softPsola &&
      audFlat &&
      audErrPre >= 15 &&
      audErrPre <= 35 &&
      this._noteAgeMs >= 28 &&
      this._pitchVel < GESTURE_VEL_ST_S &&
      !this._pendingHold &&
      !this._coldStart &&
      !this._onsetUnity &&
      !this._commitRecapture;
    if (looseBandFinish) {
      const loose = Math.max(LOOSE_HOLD_SPEED_MS, knobSpd * 0.6);
      wantChaseMs = Math.min(wantChaseMs, loose);
    }
    if (
      softPsola &&
      spd >= 0.5 &&
      this._noteAgeMs >= CENTER_LOCK_AGE_MS &&
      parkFinish &&
      this._commitSoftMs <= CENTER_LOCK_COMMIT_SOFT_MAX_MS &&
      this._pitchVel < SCOOP_VEL_ST_S &&
      !this._commitRecapture &&
      !this._coldStart &&
      !this._onsetUnity &&
      !this._pendingHold
    ) {
      const audErrCents = audErrPre;
      const glideErrCents =
        Math.abs(this._wantTgt - this._audibleWant) * 100;
      if (
        this._stablePitchMs >= STABLE_PITCH_MS &&
        audErrCents <= CENTER_LOCK_CENTS &&
        glideErrCents <= CENTER_LOCK_SETTLE_CENTS
      ) {
        // Cap vs knob, not humanized spd — still no Cher snap below ~0.85× knob.
        const tighten = Math.max(CENTER_LOCK_SPEED_MS, knobSpd * 0.82);
        wantChaseMs = Math.min(wantChaseMs, tighten);
      }
      // Sustained loose parks vs AT: finish under the score's 80ms threshold.
      if (
        audErrCents >= LOOSE_HOLD_LO_CENTS &&
        audErrCents <= LOOSE_HOLD_HI_CENTS &&
        glideErrCents <= 48
      ) {
        const loose = Math.max(LOOSE_HOLD_SPEED_MS, knobSpd * 0.65);
        wantChaseMs = Math.min(wantChaseMs, loose);
      }
      // Soft-land brake: ease tau back up in the last cents (lighter than pre-p2
      // so we don't re-park in the 15–35¢ band after a quick loose chase).
      if (audErrCents < SOFT_LAND_CENTS) {
        const u = audErrCents / SOFT_LAND_CENTS;
        const brake =
          Math.max(SOFT_LAND_FLOOR_MS, knobSpd * 0.7) * (1 - u) * (1 - u) +
          wantChaseMs * (1 - (1 - u) * (1 - u));
        wantChaseMs = Math.max(wantChaseMs, brake);
      }
    }
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
        this._lowRate(
          amount,
          speed,
          flex,
          tracking,
          transpose,
          humanize,
          vibrato,
        );
      }

      // Patent E/H: detect/track every sample after the write (gated — see EH_LIVE).
      if (EH_LIVE) this._ehOnSample();

      const dryIdx = (((this.cbiwr - N2) % N) + N) % N;
      const dryL = this.cbiL[dryIdx];
      const dryR = this.cbiR[dryIdx];

      if (this._on) {
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
        if (softPsola && !this._onsetUnity) {
          this._audibleWant += (this._wantTgt - this._audibleWant) * wantAlpha;
          const inHzA = Math.max(1e-12, this.inphinc * sampleRate);
          let rA = midiToHz(this._audibleWant) / inHzA;
          if (rA < FACT_MIN) rA = FACT_MIN;
          if (rA > FACT_MAX) rA = FACT_MAX;
          this._rStar = rA;
          this._corrMidi = this._audibleWant;
        }

        if (this._onsetUnity) {
          this.phincfact = 1;
          this._phincSlew = 1;
          this.outphinc = this.inphinc;
          // Splice: keep want/audible from note logic during unity — forcing them
          // to lagged lockedDet wiped post-gap land snaps (dry_2 @ ~20s E→F#).
          // PSOLA still pins to lockedDet (grain capture expects a stable want).
          if (this._formant >= 0.5) {
            this._audibleWant = this._lockedDet;
            this._wantTgt = this._lockedDet;
          }
          this._onsetUnityMs += 1000 / sampleRate;

          const formantOn = this._formant >= 0.5;
          const psolaReady =
            formantOn &&
            this._psolaGate >= ONSET_PSOLA_READY &&
            this._psolaHalf >= 8;
          // Splice path never runs _onAnalysisPeriod → peStable stays 0, so the
          // old Fairbanks gate waited 80ms of forced rate=1 after every re-arm
          // (dry_2 silence→20s). Exit on a short timer instead.
          const spliceReady =
            !formantOn &&
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
            // Soft+PSOLA: always ease from unity (never dump R* on a cold entrance).
            // Soft+splice: seed toward committed want — easing from 1 under a
            // stale sticky left R*≈1 for the whole cold window (@ ~20s).
            // Robot / Fairbanks: snap. Chase may run under dry until cold wet opens.
            if (formantOn && softPsola) {
              this.phincfact = 1;
              this._phincSlew = 1;
              this._beginCommitRecapture();
            } else if (formantOn && this._coldStart && this._speedMs >= 0.5) {
              this.phincfact = 1;
              this._phincSlew = 1;
              this._beginCommitRecapture();
            } else if (softPsola && this._useCycleSplice()) {
              this.phincfact = r;
              this._phincSlew = r;
              this._clearCommitRecapture();
            } else {
              this.phincfact = r;
              this._phincSlew = r;
            }
          }
        } else if (
          this._commitRecapture &&
          this._formant >= 0.5 &&
          !(this._coldStart && this._speedMs >= 0.5)
        ) {
          // Stale grain still up — hold unity (pitching it caused the slap/delay).
          // Skip during cold soft chase: we stay on dry while R* eases in.
          this.phincfact = 1;
          this._phincSlew = 1;
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

        // Corrected wet only after onset unity ends — slew, never hard-cut.
        // Cold soft+PSOLA: keep latency-dry until chase is close so bare riffs
        // don't audition the detect-rate staircase into the first note.
        // Conf: hysteretic open/closed only — continuous conf gain comb-filtered.
        // Edge quiet: close wet before UNVOICED_DROP so OLA doesn't ring past dry.
        let wantWet = 0;
        if (
          this._armed &&
          this._everLocked &&
          !this._onsetUnity &&
          this._confWetOpen &&
          !this._edgeQuiet
        ) {
          wantWet = 1;
          // Cold wet duck is for soft+PSOLA staircase into the first note.
          // Cycle-splice has no grain staircase — ducking kept phrase re-entry
          // on latency-dry while sticky lagged (listen wet≈dry @ ~20s).
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
        if (this._wetMix < 0.001) this._wetMix = 0;
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
          !this._armed || this._onsetUnity ? 1 : this._phincSlew;
        const pair = this._cycleSpliceSample(spliceRate);
        wetL = pair[0];
        wetR = pair[1];
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

      // Soft dry↔wet: _wetMix is the anti-click layer; olaGain covers first-lock fade.
      const wm = this._wetMix * this._olaGain;
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
