#!/usr/bin/env node
/**
 * Centinel listen pass — aligned dry / wet / goal clips + wet↔goal pitch deltas.
 *
 *   npm run centinel:listen -- --wet=.tmp_centinel/g2k-loose-finish.wav
 *
 * Writes `.tmp_centinel/listen/<label>/{dry,wet,goal,ab}.wav` and `report.json`.
 * `ab.wav` is stereo: L = wet, R = goal (phase-aligned) for headphone A/B.
 */

import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const home = process.env.HOME || "";

const WINDOWS = [
  { id: "loose-3s", t0: 2.9, t1: 3.4, note: "loose park ~3.05–3.17" },
  { id: "orphan-6s", t0: 6.4, t1: 7.1, note: "A↔B orphan / scoop" },
  { id: "loose-8s", t0: 8.05, t1: 8.9, note: "loose parks ~8.2 / 8.6" },
  { id: "park-10s", t0: 9.6, t1: 10.9, note: "sharp park / DC finish" },
  { id: "loose-14s", t0: 14.1, t1: 14.9, note: "loose ~14.25 / 14.63" },
  { id: "loose-20s", t0: 19.95, t1: 20.45, note: "wet≈dry in-band ~20.2" },
  { id: "phrase-0", t0: 0.0, t1: 8.0, note: "opening phrase" },
  { id: "phrase-1", t0: 8.0, t1: 16.0, note: "mid phrase" },
];

function parseArgs(argv) {
  const out = {
    dry: resolve(home, "Downloads/dry_2.wav"),
    goal: resolve(home, "Downloads/output_goal.wav"),
    wet: resolve(root, ".tmp_centinel/g2k-loose-finish.wav"),
    outDir: resolve(root, ".tmp_centinel/listen"),
    latencySamp: 1024,
    goalLagSamp: -4864,
    play: null,
  };
  for (const a of argv) {
    if (a.startsWith("--dry=")) out.dry = resolve(a.slice(6).replace(/^~/, home));
    else if (a.startsWith("--goal="))
      out.goal = resolve(a.slice(7).replace(/^~/, home));
    else if (a.startsWith("--wet=")) out.wet = resolve(a.slice(6).replace(/^~/, home));
    else if (a.startsWith("--out=")) out.outDir = resolve(a.slice(6));
    else if (a.startsWith("--latency-samp=")) out.latencySamp = Number(a.slice(15));
    else if (a.startsWith("--goal-lag=")) out.goalLagSamp = Number(a.slice(11));
    else if (a.startsWith("--play=")) out.play = a.slice(7);
  }
  return out;
}

function readWav(path) {
  const buf = readFileSync(path);
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
        af: buf.readUInt16LE(body),
        ch: buf.readUInt16LE(body + 2),
        sr: buf.readUInt32LE(body + 4),
        bps: buf.readUInt16LE(body + 14),
      };
    } else if (id === "data") {
      dataOff = body;
      dataSize = size;
      break;
    }
    o = body + size + (size & 1);
  }
  const { ch, sr, bps, af } = fmt;
  const bpf = bps / 8;
  const frames = Math.floor(dataSize / (bpf * ch));
  const mono = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < ch; c++) {
      const off = dataOff + (i * ch + c) * bpf;
      if (off + bpf > buf.length) continue;
      let s;
      if (af === 3 && bps === 32) s = buf.readFloatLE(off);
      else if (bps === 16) s = buf.readInt16LE(off) / 32768;
      else if (bps === 24) {
        const v = buf[off] | (buf[off + 1] << 8) | (buf[off + 2] << 16);
        s = ((v << 8) >> 8) / 8388608;
      } else s = buf.readInt32LE(off) / 2147483648;
      sum += s;
    }
    mono[i] = sum / ch;
  }
  return { sampleRate: sr, mono, path };
}

function writeWavMono(path, mono, sr) {
  const dataSize = mono.length * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sr, 24);
  buf.writeUInt32LE(sr * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < mono.length; i++) {
    const s = Math.max(-1, Math.min(1, mono[i]));
    buf.writeInt16LE((s * 32767) | 0, 44 + i * 2);
  }
  writeFileSync(path, buf);
}

function writeWavStereo(path, left, right, sr) {
  const n = Math.min(left.length, right.length);
  const dataSize = n * 4;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(sr, 24);
  buf.writeUInt32LE(sr * 4, 28);
  buf.writeUInt16LE(4, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < n; i++) {
    const l = Math.max(-1, Math.min(1, left[i]));
    const r = Math.max(-1, Math.min(1, right[i]));
    buf.writeInt16LE((l * 32767) | 0, 44 + i * 4);
    buf.writeInt16LE((r * 32767) | 0, 44 + i * 4 + 2);
  }
  writeFileSync(path, buf);
}

function align(mono, latencySamp) {
  if (!latencySamp) return mono;
  const out = new Float32Array(mono.length);
  const n = Math.max(0, mono.length - latencySamp);
  out.set(mono.subarray(latencySamp, latencySamp + n), 0);
  return out;
}

function alignGoal(mono, lagSamp) {
  if (lagSamp >= 0) return align(mono, lagSamp);
  const pad = -lagSamp;
  const g = new Float32Array(mono.length + pad);
  g.set(mono, pad);
  return g;
}

function yinF0(frame, sr) {
  const n = frame.length;
  const tauMax = Math.min(n - 2, Math.floor(sr / 70));
  const tauMin = Math.max(2, Math.floor(sr / 700));
  const d = new Float32Array(tauMax + 1);
  for (let tau = 1; tau <= tauMax; tau++) {
    let sum = 0;
    for (let i = 0; i < n - tau; i++) {
      const e = frame[i] - frame[i + tau];
      sum += e * e;
    }
    d[tau] = sum;
  }
  const cmnd = new Float32Array(tauMax + 1);
  cmnd[0] = 1;
  let run = 0;
  for (let tau = 1; tau <= tauMax; tau++) {
    run += d[tau];
    cmnd[tau] = run > 0 ? (d[tau] * tau) / run : 1;
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
    for (let tau = tauMin + 1; tau <= tauMax; tau++)
      if (cmnd[tau] < cmnd[best]) best = tau;
    if (cmnd[best] >= 0.45) return 0;
    tauEst = best;
  }
  let tau = tauEst;
  if (tau > 1 && tau < tauMax) {
    const s0 = cmnd[tau - 1];
    const s1 = cmnd[tau];
    const s2 = cmnd[tau + 1];
    const den = 2 * (2 * s1 - s2 - s0);
    if (Math.abs(den) > 1e-12) tau = tau + (s2 - s0) / den;
  }
  return sr / tau;
}

function trackF0(mono, sr) {
  const win = Math.max(512, Math.round(sr * 0.046));
  const hop = Math.max(64, Math.round(sr * 0.0116));
  const times = [];
  const midi = [];
  const frame = new Float32Array(win);
  for (let start = 0; start + win <= mono.length; start += hop) {
    for (let i = 0; i < win; i++) {
      const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / win);
      frame[i] = mono[start + i] * w;
    }
    const f0 = yinF0(frame, sr);
    times.push(start / sr);
    midi.push(f0 > 0 ? 69 + 12 * Math.log2(f0 / 440) : 0);
  }
  return { times, midi, hopSec: hop / sr };
}

function pcs() {
  return [0, 2, 4, 5, 7, 9, 11].map((d) => (d + 9) % 12);
}

function nearest(m, P) {
  const pc = ((m % 12) + 12) % 12;
  let bestD = 0;
  let bestA = Infinity;
  for (const p of P) {
    let d = p - pc;
    if (d > 6) d -= 12;
    if (d < -6) d += 12;
    const a = Math.abs(d);
    if (a < bestA) {
      bestA = a;
      bestD = d;
    }
  }
  return m + bestD;
}

function windowReport(dT, wT, gT, t0, t1) {
  const P = pcs();
  let n = 0;
  let sumWg = 0;
  let sumWc = 0;
  let sumGc = 0;
  let le15W = 0;
  let le15G = 0;
  let wetEqDry = 0;
  const series = [];
  const nFrames = Math.min(dT.midi.length, wT.midi.length, gT.midi.length);
  for (let i = 0; i < nFrames; i++) {
    const t = dT.times[i];
    if (t < t0 || t > t1) continue;
    const md = dT.midi[i];
    const mw = wT.midi[i];
    const mg = gT.midi[i];
    if (!(md > 0 && mw > 0 && mg > 0)) continue;
    n++;
    let mwAdj = mw;
    while (mwAdj > mg + 6) mwAdj -= 12;
    while (mwAdj < mg - 6) mwAdj += 12;
    const dWg = Math.abs(mwAdj - mg) * 100;
    sumWg += dWg;
    const wc = Math.abs(mw - nearest(mw, P)) * 100;
    const gc = Math.abs(mg - nearest(mg, P)) * 100;
    sumWc += wc;
    sumGc += gc;
    if (wc <= 15) le15W++;
    if (gc <= 15) le15G++;
    if (Math.abs(mw - md) * 100 < 3) wetEqDry++;
    if (series.length < 80 && i % 2 === 0) {
      series.push({
        t: +t.toFixed(3),
        dry: +md.toFixed(2),
        wet: +mw.toFixed(2),
        goal: +mg.toFixed(2),
        wetCents: +wc.toFixed(0),
        goalCents: +gc.toFixed(0),
        wetVsGoal: +dWg.toFixed(0),
      });
    }
  }
  return {
    voiced: n,
    meanWetVsGoalCents: n ? sumWg / n : 0,
    meanWetScaleCents: n ? sumWc / n : 0,
    meanGoalScaleCents: n ? sumGc / n : 0,
    wetLe15: n ? (100 * le15W) / n : 0,
    goalLe15: n ? (100 * le15G) / n : 0,
    wetEqDryPct: n ? (100 * wetEqDry) / n : 0,
    series,
  };
}

function slice(mono, sr, t0, t1) {
  const a = Math.max(0, Math.floor(t0 * sr));
  const b = Math.min(mono.length, Math.ceil(t1 * sr));
  return mono.subarray(a, b);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  mkdirSync(args.outDir, { recursive: true });

  const dry = readWav(args.dry);
  const wetIn = readWav(args.wet);
  const goalIn = readWav(args.goal);
  const sr = dry.sampleRate;
  const wet = align(wetIn.mono, args.latencySamp);
  const goal = alignGoal(goalIn.mono, args.goalLagSamp);
  const nSamp = Math.min(dry.mono.length, wet.length, goal.length);
  const dryM = dry.mono.subarray(0, nSamp);
  const wetM = wet.subarray(0, nSamp);
  const goalM = goal.subarray(0, nSamp);

  console.log(`[centinel:listen] wet=${basename(args.wet)}`);
  console.log(
    `[centinel:listen] align wet -${args.latencySamp}  goal lag ${args.goalLagSamp}`,
  );

  const dT = trackF0(dryM, sr);
  const wT = trackF0(wetM, sr);
  const gT = trackF0(goalM, sr);

  const report = {
    wet: basename(args.wet),
    dry: basename(args.dry),
    goal: basename(args.goal),
    latencySamp: args.latencySamp,
    goalLagSamp: args.goalLagSamp,
    outDir: args.outDir,
    windows: [],
  };

  for (const w of WINDOWS) {
    const dir = resolve(args.outDir, w.id);
    mkdirSync(dir, { recursive: true });
    const d = slice(dryM, sr, w.t0, w.t1);
    const v = slice(wetM, sr, w.t0, w.t1);
    const g = slice(goalM, sr, w.t0, w.t1);
    writeWavMono(resolve(dir, "dry.wav"), d, sr);
    writeWavMono(resolve(dir, "wet.wav"), v, sr);
    writeWavMono(resolve(dir, "goal.wav"), g, sr);
    writeWavStereo(resolve(dir, "ab.wav"), v, g, sr);

    const metrics = windowReport(dT, wT, gT, w.t0, w.t1);
    const entry = { ...w, ...metrics, clips: dir };
    report.windows.push(entry);

    console.log(
      `\n${w.id}  ${w.t0}–${w.t1}s  (${w.note})`,
    );
    console.log(
      `  wet↔goal mean |Δ¢|=${metrics.meanWetVsGoalCents.toFixed(1)}  wet≤15=${metrics.wetLe15.toFixed(0)}% goal≤15=${metrics.goalLe15.toFixed(0)}%  wet≈dry=${metrics.wetEqDryPct.toFixed(0)}%`,
    );
    console.log(`  clips: ${dir}`);
  }

  const reportPath = resolve(args.outDir, "report.json");
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(`\n[centinel:listen] wrote ${reportPath}`);
  console.log(
    "A/B tip: afplay .tmp_centinel/listen/<id>/ab.wav  (L=wet R=goal)",
  );

  if (args.play) {
    const clip = resolve(args.outDir, args.play, "ab.wav");
    console.log(`[centinel:listen] playing ${clip}`);
    spawnSync("afplay", [clip], { stdio: "inherit" });
  }
}

main();
