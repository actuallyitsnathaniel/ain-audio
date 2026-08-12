#!/usr/bin/env node
/**
 * Centinel scorecard — dry + wet (+ optional AT goal) → the metrics we iterate on.
 *
 *   node scripts/centinel-score.mjs <dry.wav> <wet.wav> [goal.wav] [--json] [--latency-samp=1024]
 *
 * Prints center tightness, loose holds, shake, note-disagree vs goal, click steps.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";

function parseArgs(argv) {
  const out = {
    latencySamp: 1024,
    json: false,
    csv: null,
    dumpDisagree: false,
    dumpPath: null,
    key: 9, // A
    files: [],
  };
  for (const a of argv) {
    if (a.startsWith("--latency-samp=")) out.latencySamp = Number(a.slice(15));
    else if (a.startsWith("--latency-ms="))
      out.latencyMs = Number(a.slice(13));
    else if (a === "--json") out.json = true;
    else if (a === "--dump-disagree") out.dumpDisagree = true;
    else if (a.startsWith("--dump-disagree=")) {
      out.dumpDisagree = true;
      out.dumpPath = a.slice("--dump-disagree=".length);
    }
    else if (a.startsWith("--csv=")) out.csv = a.slice(6);
    else if (a.startsWith("--key=")) out.key = Number(a.slice(6));
    else if (!a.startsWith("-")) out.files.push(a);
  }
  return out;
}

function readWav(path) {
  const buf = readFileSync(path);
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error(`${path}: not a WAV`);
  }
  let o = 12;
  let fmt = null;
  let dataOff = 0;
  let dataSize = 0;
  while (o + 8 <= buf.length) {
    const id = buf.toString("ascii", o, o + 4);
    const size = buf.readUInt32LE(o + 4);
    const body = o + 8;
    if (id === "fmt ") {
      fmt = {
        audioFormat: buf.readUInt16LE(body),
        channels: buf.readUInt16LE(body + 2),
        sampleRate: buf.readUInt32LE(body + 4),
        bitsPerSample: buf.readUInt16LE(body + 14),
      };
    } else if (id === "data") {
      dataOff = body;
      dataSize = size;
      break;
    }
    o = body + size + (size & 1);
  }
  if (!fmt || !dataSize) throw new Error(`${path}: missing fmt/data`);
  const { channels, sampleRate, bitsPerSample, audioFormat } = fmt;
  const bytesPer = bitsPerSample / 8;
  const frames = Math.floor(dataSize / (bytesPer * channels));
  const mono = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) {
      const off = dataOff + (i * channels + c) * bytesPer;
      let s;
      if (audioFormat === 3 && bitsPerSample === 32) s = buf.readFloatLE(off);
      else if (bitsPerSample === 16) s = buf.readInt16LE(off) / 32768;
      else if (bitsPerSample === 24) {
        const v = buf[off] | (buf[off + 1] << 8) | (buf[off + 2] << 16);
        s = ((v << 8) >> 8) / 8388608;
      } else if (bitsPerSample === 32 && audioFormat === 1)
        s = buf.readInt32LE(off) / 2147483648;
      else throw new Error(`${path}: unsupported ${audioFormat}/${bitsPerSample}`);
      sum += s;
    }
    mono[i] = sum / channels;
  }
  return { sampleRate, mono, path };
}

function yinF0(frame, sr, fMin = 70, fMax = 700) {
  const n = frame.length;
  const tauMax = Math.min(n - 2, Math.floor(sr / fMin));
  const tauMin = Math.max(2, Math.floor(sr / fMax));
  if (tauMax <= tauMin + 2) return { f0: 0, clarity: 0 };
  const d = new Float32Array(tauMax + 1);
  for (let tau = 1; tau <= tauMax; tau++) {
    let sum = 0;
    const lim = n - tau;
    for (let i = 0; i < lim; i++) {
      const delta = frame[i] - frame[i + tau];
      sum += delta * delta;
    }
    d[tau] = sum;
  }
  const cmnd = new Float32Array(tauMax + 1);
  cmnd[0] = 1;
  let running = 0;
  for (let tau = 1; tau <= tauMax; tau++) {
    running += d[tau];
    cmnd[tau] = running > 0 ? (d[tau] * tau) / running : 1;
  }
  let tauEst = -1;
  for (let tau = tauMin; tau <= tauMax; tau++) {
    if (cmnd[tau] < 0.15) {
      while (tau + 1 <= tauMax && cmnd[tau + 1] < cmnd[tau]) tau++;
      tauEst = tau;
      break;
    }
  }
  if (tauEst < 0) {
    let best = tauMin;
    for (let tau = tauMin + 1; tau <= tauMax; tau++) {
      if (cmnd[tau] < cmnd[best]) best = tau;
    }
    if (cmnd[best] >= 0.45) return { f0: 0, clarity: 1 - cmnd[best] };
    tauEst = best;
  }
  let tau = tauEst;
  if (tau > 1 && tau < tauMax) {
    const s0 = cmnd[tau - 1];
    const s1 = cmnd[tau];
    const s2 = cmnd[tau + 1];
    const denom = 2 * (2 * s1 - s2 - s0);
    if (Math.abs(denom) > 1e-12) tau = tau + (s2 - s0) / denom;
  }
  return {
    f0: sr / tau,
    clarity: 1 - cmnd[Math.min(tauMax, Math.max(1, Math.round(tauEst)))],
  };
}

function trackF0(mono, sr, hopMs = 11.6) {
  const win = Math.max(512, Math.round(sr * 0.046));
  const hop = Math.max(64, Math.round((sr * hopMs) / 1000));
  const times = [];
  const f0s = [];
  const clarities = [];
  const frame = new Float32Array(win);
  for (let start = 0; start + win <= mono.length; start += hop) {
    for (let i = 0; i < win; i++) {
      const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / win);
      frame[i] = mono[start + i] * w;
    }
    const { f0, clarity } = yinF0(frame, sr);
    times.push(start / sr);
    f0s.push(f0);
    clarities.push(clarity);
  }
  return { times, f0s, clarities, hopSec: hop / sr };
}

function hzToMidi(hz) {
  return 69 + 12 * Math.log2(Math.max(hz, 1e-6) / 440);
}

/** A major pcs as absolute pitch classes (C=0). */
function scalePcsForKey(key) {
  const major = [0, 2, 4, 5, 7, 9, 11];
  return major.map((d) => (d + key) % 12);
}

function nearestScaleMidi(midi, pcs) {
  const pc = ((midi % 12) + 12) % 12;
  let bestD = 0;
  let bestAbs = Infinity;
  for (const p of pcs) {
    let d = p - pc;
    if (d > 6) d -= 12;
    if (d < -6) d += 12;
    const a = Math.abs(d);
    if (a < bestAbs) {
      bestAbs = a;
      bestD = d;
    }
  }
  return midi + bestD;
}

const PC_NAMES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
];

function midiName(m) {
  if (!(m > 0)) return "—";
  const n = Math.round(m);
  const cents = Math.round((m - n) * 100);
  const pc = ((n % 12) + 12) % 12;
  const oct = Math.floor(n / 12) - 1;
  const c = cents === 0 ? "" : cents > 0 ? `+${cents}` : `${cents}`;
  return `${PC_NAMES[pc]}${oct}${c}`;
}

function clusterDisagree(frames, hopSec) {
  const runs = [];
  let cur = null;
  for (const f of frames) {
    if (cur && f.i <= cur.i1 + 2) {
      cur.i1 = f.i;
      cur.t1 = f.t;
      cur.n++;
      cur.frames.push(f);
    } else {
      if (cur) runs.push(cur);
      cur = { i0: f.i, i1: f.i, t0: f.t, t1: f.t, n: 1, frames: [f] };
    }
  }
  if (cur) runs.push(cur);
  for (const r of runs) {
    r.ms = (r.i1 - r.i0 + 1) * hopSec * 1000;
    const kinds = { dryAt: 0, scoop: 0, oct: 0, other: 0 };
    for (const f of r.frames) {
      const step = Math.abs(f.qw - f.qg);
      if (step >= 11 && step <= 13) kinds.oct++;
      else if (f.qd === f.qg) kinds.dryAt++;
      else kinds.scoop++;
    }
    r.kind =
      kinds.oct >= r.n * 0.5
        ? "octave"
        : kinds.dryAt >= r.n * 0.5
          ? "dry+goal vs wet"
          : "goal≠dry (timing)";
    const mid = r.frames[Math.floor(r.n / 2)];
    r.dry = mid.dryName;
    r.wet = mid.wetName;
    r.goal = mid.goalName;
    r.q = `${PC_NAMES[((mid.qd % 12) + 12) % 12]}→${PC_NAMES[((mid.qw % 12) + 12) % 12]} (goal ${PC_NAMES[((mid.qg % 12) + 12) % 12]})`;
  }
  return runs;
}

function align(mono, latencySamp) {
  if (!latencySamp) return mono;
  const out = new Float32Array(mono.length);
  const n = Math.max(0, mono.length - latencySamp);
  out.set(mono.subarray(latencySamp, latencySamp + n), 0);
  return out;
}

function bigSteps(mono, sr, thr = 0.12) {
  const w = Math.max(1, Math.round(0.005 * sr));
  let hits = 0;
  let i = 1;
  const refractory = Math.round(0.015 * sr);
  while (i < mono.length) {
    const d = Math.abs(mono[i] - mono[i - 1]);
    if (d > thr) {
      let loc = 0;
      const a = Math.max(0, i - w);
      const b = Math.min(mono.length, i + w);
      for (let j = a; j < b; j++) loc += mono[j] * mono[j];
      loc = Math.sqrt(loc / Math.max(1, b - a));
      if (d / (loc + 0.002) > 2.5) {
        hits++;
        i += refractory;
        continue;
      }
    }
    i++;
  }
  return hits;
}

export function scoreCentinel({
  dryPath,
  wetPath,
  goalPath = null,
  latencySamp = 1024,
  key = 9,
}) {
  const dry = readWav(dryPath);
  const wetIn = readWav(wetPath);
  const goal = goalPath ? readWav(goalPath) : null;
  if (dry.sampleRate !== wetIn.sampleRate) {
    throw new Error(
      `sr mismatch dry ${dry.sampleRate} vs wet ${wetIn.sampleRate}`,
    );
  }
  const sr = dry.sampleRate;
  const wet = align(wetIn.mono, latencySamp);
  let goalMono = null;
  let goalLagSamp = 0;
  if (goal) {
    // Align goal→dry by envelope corr over ±200 ms (AT exports vary).
    let bestLag = 0;
    let bestC = -1;
    const hop = 256;
    const nmax = Math.min(sr * 10, dry.mono.length, goal.mono.length);
    const er = new Float64Array(Math.floor(nmax / hop));
    const eg = new Float64Array(Math.floor(goal.mono.length / hop));
    for (let i = 0; i < er.length; i++) {
      let s = 0;
      const o = i * hop;
      for (let j = 0; j < hop && o + j < dry.mono.length; j++)
        s += dry.mono[o + j] ** 2;
      er[i] = s;
    }
    for (let i = 0; i < eg.length; i++) {
      let s = 0;
      const o = i * hop;
      for (let j = 0; j < hop && o + j < goal.mono.length; j++)
        s += goal.mono[o + j] ** 2;
      eg[i] = s;
    }
    const maxLag = Math.floor((0.2 * sr) / hop);
    const n = Math.min(er.length, eg.length) - maxLag - 1;
    for (let lag = -maxLag; lag <= maxLag; lag++) {
      let dot = 0;
      let a2 = 0;
      let b2 = 0;
      for (let i = 0; i < n; i++) {
        const ai = lag >= 0 ? i : i - lag;
        const bi = lag >= 0 ? i + lag : i;
        if (ai >= er.length || bi >= eg.length) break;
        const a = er[ai];
        const b = eg[bi];
        dot += a * b;
        a2 += a * a;
        b2 += b * b;
      }
      const c = dot / (Math.sqrt(a2 * b2) + 1e-12);
      if (c > bestC) {
        bestC = c;
        bestLag = lag * hop;
      }
    }
    goalLagSamp = bestLag;
    if (bestLag >= 0) goalMono = align(goal.mono, bestLag);
    else {
      // goal leads dry — pad goal
      const pad = -bestLag;
      const g = new Float32Array(goal.mono.length + pad);
      g.set(goal.mono, pad);
      goalMono = g;
    }
  }

  const nSamp = Math.min(
    dry.mono.length,
    wet.length,
    goalMono ? goalMono.length : Infinity,
  );
  const dryT = trackF0(dry.mono.subarray(0, nSamp), sr);
  const wetT = trackF0(wet.subarray(0, nSamp), sr);
  const goalT = goalMono
    ? trackF0(goalMono.subarray(0, nSamp), sr)
    : null;

  const pcs = scalePcsForKey(key);
  const n = Math.min(
    dryT.f0s.length,
    wetT.f0s.length,
    goalT ? goalT.f0s.length : Infinity,
  );
  const hop = dryT.hopSec;

  let voiced = 0;
  let le15 = 0;
  let le25 = 0;
  let absCentSum = 0;
  const absCents = [];
  let shakeRev = 0;
  let shakeSteps = 0;
  let lastSign = 0;
  let disagree = 0;
  let disagreeDryAt = 0; // dry agrees AT, wet not
  const disagreeFrames = [];
  // Lever-3 proxy that doesn't need AT align: dry clearly owns a scale note
  // (|err|≤25¢) but wet quantized to a different degree.
  let owned = 0;
  let ownedMiss = 0;

  // loose hold state
  let looseRuns = 0;
  let looseMs = 0;
  let looseStart = -1;

  const md = new Float64Array(n);
  const mw = new Float64Array(n);
  const mg = goalT ? new Float64Array(n) : null;
  const mask = new Uint8Array(n);

  for (let i = 0; i < n; i++) {
    const t = dryT.times[i];
    const clear =
      dryT.f0s[i] > 0 &&
      wetT.f0s[i] > 0 &&
      dryT.clarities[i] >= 0.35 &&
      wetT.clarities[i] >= 0.35 &&
      (!goalT ||
        (goalT.f0s[i] > 0 && goalT.clarities[i] >= 0.35)) &&
      t > 0.4 &&
      t < dryT.times[n - 1] - 0.4;
    mask[i] = clear ? 1 : 0;
    md[i] = dryT.f0s[i] > 0 ? hzToMidi(dryT.f0s[i]) : 0;
    mw[i] = wetT.f0s[i] > 0 ? hzToMidi(wetT.f0s[i]) : 0;
    if (mg) mg[i] = goalT.f0s[i] > 0 ? hzToMidi(goalT.f0s[i]) : 0;
  }

  for (let i = 0; i < n; i++) {
    if (!mask[i]) {
      if (looseStart >= 0) {
        const ms = (i - looseStart) * hop * 1000;
        if (ms >= 80) {
          looseRuns++;
          looseMs += ms;
        }
        looseStart = -1;
      }
      lastSign = 0;
      continue;
    }
    voiced++;
    const tgtW = nearestScaleMidi(mw[i], pcs);
    const errW = Math.abs(mw[i] - tgtW) * 100;
    absCents.push(errW);
    absCentSum += errW;
    if (errW <= 15) le15++;
    if (errW <= 25) le25++;
    if (errW >= 15 && errW <= 35) {
      if (looseStart < 0) looseStart = i;
    } else if (looseStart >= 0) {
      const ms = (i - looseStart) * hop * 1000;
      if (ms >= 80) {
        looseRuns++;
        looseMs += ms;
      }
      looseStart = -1;
    }

    if (i > 0 && mask[i - 1]) {
      const dm = (mw[i] - mw[i - 1]) * 100;
      if (Math.abs(dm) >= 2) {
        const s = Math.sign(dm);
        if (lastSign && s !== lastSign) shakeRev++;
        lastSign = s;
        shakeSteps++;
      }
    }

    const qd = Math.round(nearestScaleMidi(md[i], pcs));
    const qw = Math.round(nearestScaleMidi(mw[i], pcs));
    const dryErr = Math.abs(md[i] - nearestScaleMidi(md[i], pcs)) * 100;
    if (dryErr <= 25) {
      owned++;
      if (qw !== qd) ownedMiss++;
    }
    if (mg) {
      const qg = Math.round(nearestScaleMidi(mg[i], pcs));
      if (qw !== qg) {
        disagree++;
        if (qd === qg) disagreeDryAt++;
        disagreeFrames.push({
          i,
          t: +dryT.times[i].toFixed(3),
          dry: +md[i].toFixed(2),
          wet: +mw[i].toFixed(2),
          goal: +mg[i].toFixed(2),
          qd,
          qw,
          qg,
          dryName: midiName(md[i]),
          wetName: midiName(mw[i]),
          goalName: midiName(mg[i]),
          dryAt: qd === qg ? 1 : 0,
        });
      }
    }
  }
  if (looseStart >= 0) {
    const ms = (n - looseStart) * hop * 1000;
    if (ms >= 80) {
      looseRuns++;
      looseMs += ms;
    }
  }

  absCents.sort((a, b) => a - b);
  const pct = (p) => {
    if (!absCents.length) return 0;
    const i = (absCents.length - 1) * p;
    const lo = Math.floor(i);
    const hi = Math.ceil(i);
    return lo === hi
      ? absCents[lo]
      : absCents[lo] * (hi - i) + absCents[hi] * (i - lo);
  };

  let goalLe15 = null;
  let goalLoose = null;
  let goalDisagree = null;
  if (goalT) {
    let gv = 0;
    let g15 = 0;
    let gLoose = 0;
    let gLooseMs = 0;
    let gs = -1;
    for (let i = 0; i < n; i++) {
      if (!mask[i]) {
        if (gs >= 0) {
          const ms = (i - gs) * hop * 1000;
          if (ms >= 80) {
            gLoose++;
            gLooseMs += ms;
          }
          gs = -1;
        }
        continue;
      }
      gv++;
      const err = Math.abs(mg[i] - nearestScaleMidi(mg[i], pcs)) * 100;
      if (err <= 15) g15++;
      if (err >= 15 && err <= 35) {
        if (gs < 0) gs = i;
      } else if (gs >= 0) {
        const ms = (i - gs) * hop * 1000;
        if (ms >= 80) {
          gLoose++;
          gLooseMs += ms;
        }
        gs = -1;
      }
    }
    if (gs >= 0) {
      const ms = (n - gs) * hop * 1000;
      if (ms >= 80) {
        gLoose++;
        gLooseMs += ms;
      }
    }
    goalLe15 = gv ? (100 * g15) / gv : 0;
    goalLoose = { runs: gLoose, ms: gLooseMs };
    goalDisagree = voiced ? (100 * disagree) / voiced : 0;
  }

  const clicks = bigSteps(wet.subarray(0, nSamp), sr);
  const dryClicks = bigSteps(dry.mono.subarray(0, nSamp), sr);

  // Lag dips: wet >35¢ below dry for ≥30ms while dry local std <25¢.
  let dipRuns = 0;
  let dipMs = 0;
  let dipStart = -1;
  const win = Math.max(1, Math.round(0.04 / hop));
  for (let i = 0; i < n; i++) {
    if (!mask[i] || md[i] <= 0 || mw[i] <= 0) {
      if (dipStart >= 0) {
        const ms = (i - dipStart) * hop * 1000;
        if (ms >= 30) {
          dipRuns++;
          dipMs += ms;
        }
        dipStart = -1;
      }
      continue;
    }
    let wMidi = mw[i];
    while (wMidi > md[i] + 6) wMidi -= 12;
    while (wMidi < md[i] - 6) wMidi += 12;
    const dlt = (wMidi - md[i]) * 100;
    let dryStd = 0;
    {
      const a = Math.max(0, i - win);
      const b = Math.min(n, i + win);
      let s = 0;
      let c = 0;
      let m = 0;
      for (let j = a; j < b; j++) {
        if (!mask[j]) continue;
        m += md[j];
        c++;
      }
      if (c > 2) {
        m /= c;
        for (let j = a; j < b; j++) {
          if (!mask[j]) continue;
          s += (md[j] - m) ** 2;
        }
        dryStd = Math.sqrt(s / c) * 100;
      }
    }
    if (dlt < -35 && dryStd < 25) {
      if (dipStart < 0) dipStart = i;
    } else if (dipStart >= 0) {
      const ms = (i - dipStart) * hop * 1000;
      if (ms >= 30) {
        dipRuns++;
        dipMs += ms;
      }
      dipStart = -1;
    }
  }
  if (dipStart >= 0) {
    const ms = (n - dipStart) * hop * 1000;
    if (ms >= 30) {
      dipRuns++;
      dipMs += ms;
    }
  }

  return {
    dry: basename(dryPath),
    wet: basename(wetPath),
    goal: goalPath ? basename(goalPath) : null,
    sr,
    latencySamp,
    voiced,
    center: {
      le15: voiced ? (100 * le15) / voiced : 0,
      le25: voiced ? (100 * le25) / voiced : 0,
      med: pct(0.5),
      p90: pct(0.9),
      mean: voiced ? absCentSum / voiced : 0,
    },
    goalCenterLe15: goalLe15,
    loose: { runs: looseRuns, ms: looseMs },
    goalLoose,
    shake: {
      rev: shakeRev,
      steps: shakeSteps,
      rate: shakeSteps ? shakeRev / shakeSteps : 0,
    },
    noteDisagreePct: goalDisagree,
    noteDisagreeDryAtFrames: disagreeDryAt,
    disagreeFrames,
    disagreeRuns: goalT ? clusterDisagree(disagreeFrames, hop) : [],
    /** Wet leaves a scale note dry clearly owns (≤25¢) — primary lever-3 metric. */
    ownedNoteMissPct: owned ? (100 * ownedMiss) / owned : 0,
    ownedNoteFrames: owned,
    clicks: { wet: clicks, dry: dryClicks },
    dips: { runs: dipRuns, ms: dipMs },
    goalLagSamp,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.files.length < 2) {
    console.error(
      "Usage: node scripts/centinel-score.mjs <dry.wav> <wet.wav> [goal.wav] [--json] [--latency-samp=1024]",
    );
    process.exit(1);
  }
  let latencySamp = args.latencySamp;
  if (args.latencyMs != null) {
    const dry = readWav(args.files[0]);
    latencySamp = Math.round((args.latencyMs / 1000) * dry.sampleRate);
  }
  const s = scoreCentinel({
    dryPath: args.files[0],
    wetPath: args.files[1],
    goalPath: args.files[2] || null,
    latencySamp,
    key: args.key,
  });
  if (args.json) {
    console.log(JSON.stringify(s, null, 2));
    return;
  }
  console.log(`dry: ${s.dry}  wet: ${s.wet}${s.goal ? `  goal: ${s.goal}` : ""}`);
  console.log(`voiced frames: ${s.voiced}  latency: ${s.latencySamp} samp`);
  console.log("");
  console.log("=== center (scale) ===");
  console.log(
    `wet: ≤15¢=${s.center.le15.toFixed(1)}% ≤25=${s.center.le25.toFixed(1)}% med=${s.center.med.toFixed(1)} p90=${s.center.p90.toFixed(1)}`,
  );
  if (s.goalCenterLe15 != null)
    console.log(`goal ≤15¢=${s.goalCenterLe15.toFixed(1)}%`);
  console.log("");
  console.log("=== loose holds 15–35¢ ≥80ms ===");
  console.log(`wet: ${s.loose.runs} runs, ${s.loose.ms.toFixed(0)}ms`);
  if (s.goalLoose)
    console.log(`goal: ${s.goalLoose.runs} runs, ${s.goalLoose.ms.toFixed(0)}ms`);
  console.log("");
  console.log(
    `=== shake rate ${s.shake.rate.toFixed(3)} (${s.shake.rev}/${s.shake.steps}) ===`,
  );
  console.log("");
  console.log(
    `=== owned-note miss (dry≤25¢ of scale, wet elsewhere): ${s.ownedNoteMissPct.toFixed(1)}% of ${s.ownedNoteFrames} ===`,
  );
  if (s.noteDisagreePct != null) {
    console.log(
      `=== note disagree vs goal: ${s.noteDisagreePct.toFixed(1)}%  (dry+goal agree / wet wrong: ${s.noteDisagreeDryAtFrames} frames) ===`,
    );
  }
  if (args.dumpDisagree && s.disagreeRuns) {
    console.log("");
    console.log(`=== disagree runs (${s.disagreeRuns.length} clusters, ${s.disagreeFrames.length} frames) ===`);
    console.log(
      "t0–t1".padEnd(16) +
        "ms".padStart(5) +
        "n".padStart(4) +
        "  " +
        "kind".padEnd(18) +
        "  dry        wet        goal       q",
    );
    for (const r of s.disagreeRuns) {
      const span = `${r.t0.toFixed(2)}–${r.t1.toFixed(2)}`;
      console.log(
        `${span.padEnd(16)} ${r.ms.toFixed(0).padStart(5)} ${String(r.n).padStart(3)}  ${r.kind.padEnd(18)}  ${r.dry.padEnd(10)} ${r.wet.padEnd(10)} ${r.goal.padEnd(10)} ${r.q}`,
      );
    }
    const byKind = {};
    let longMs = 0;
    for (const r of s.disagreeRuns) {
      byKind[r.kind] = (byKind[r.kind] || 0) + r.n;
      if (r.ms >= 40) longMs += r.ms;
    }
    console.log("");
    console.log(
      "by frames: " +
        Object.entries(byKind)
          .map(([k, n]) => `${k} ${n}`)
          .join(" · ") +
        `  ·  runs ≥40ms: ${s.disagreeRuns.filter((r) => r.ms >= 40).length} (${longMs.toFixed(0)}ms)`,
    );
    const dumpPath =
      args.dumpPath || ".tmp_centinel/disagree.json";
    writeFileSync(
      dumpPath,
      JSON.stringify(
        {
          wet: s.wet,
          voiced: s.voiced,
          disagreePct: s.noteDisagreePct,
          dryAtFrames: s.noteDisagreeDryAtFrames,
          runs: s.disagreeRuns.map((r) => ({
            t0: r.t0,
            t1: r.t1,
            ms: +r.ms.toFixed(1),
            n: r.n,
            kind: r.kind,
            dry: r.dry,
            wet: r.wet,
            goal: r.goal,
            q: r.q,
            frames: r.frames,
          })),
        },
        null,
        2,
      ),
    );
    console.log(`\nwrote ${dumpPath}`);
  }
  console.log("");
  console.log(
    `=== click-ish steps Δ>0.12: wet=${s.clicks.wet} dry=${s.clicks.dry} ===`,
  );
  console.log(
    `=== lag dips (wet≪dry, dry stable): ${s.dips.runs} runs, ${s.dips.ms.toFixed(0)}ms ===`,
  );
  if (args.csv) writeFileSync(args.csv, JSON.stringify(s, null, 2));
}

const isMain =
  process.argv[1] &&
  (process.argv[1].endsWith("centinel-score.mjs") ||
    process.argv[1].includes("centinel-score"));
if (isMain) main();
