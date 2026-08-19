import { readFileSync } from "fs";
import { resolve } from "path";

const home = process.env.HOME || "";

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
      let s;
      if (af === 3 && bps === 32) s = buf.readFloatLE(off);
      else s = buf.readInt16LE(off) / 32768;
      sum += s;
    }
    mono[i] = sum / ch;
  }
  return { sr, mono };
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
  const cm = new Float32Array(tauMax + 1);
  let run = 0;
  cm[0] = 1;
  for (let tau = 1; tau <= tauMax; tau++) {
    run += d[tau];
    cm[tau] = run > 0 ? (d[tau] * tau) / run : 1;
  }
  let tauEst = -1;
  for (let tau = tauMin; tau <= tauMax; tau++) {
    if (cm[tau] < 0.15) {
      while (tau + 1 <= tauMax && cm[tau + 1] < cm[tau]) tau++;
      tauEst = tau;
      break;
    }
  }
  if (tauEst < 0) {
    let best = tauMin;
    for (let tau = tauMin + 1; tau <= tauMax; tau++)
      if (cm[tau] < cm[best]) best = tau;
    if (cm[best] >= 0.45) return 0;
    tauEst = best;
  }
  return sr / tauEst;
}

function track(mono, sr) {
  const win = Math.max(512, Math.round(sr * 0.046));
  const hop = Math.max(64, Math.round((sr * 11.6) / 1000));
  const times = [];
  const f0s = [];
  const frame = new Float32Array(win);
  for (let start = 0; start + win <= mono.length; start += hop) {
    for (let i = 0; i < win; i++) {
      const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / win);
      frame[i] = mono[start + i] * w;
    }
    times.push(start / sr);
    f0s.push(yinF0(frame, sr));
  }
  return { times, f0s };
}

function midi(hz) {
  return hz > 1 ? 69 + 12 * Math.log2(hz / 440) : 0;
}

function align(m, lat) {
  const o = new Float32Array(m.length);
  o.set(m.subarray(lat), 0);
  return o;
}

const dry = readWav(resolve(home, "Downloads/dry_2.wav"));
const goal = readWav(resolve(home, "Downloads/output_goal.wav"));
const g3c = readWav(".tmp_centinel/g3c-rearm.wav");
const g2i = readWav(".tmp_centinel/g2i-join.wav");
const g1l = readWav(".tmp_centinel/g1l-oct.wav");
const sr = dry.sr;
const w3 = align(g3c.mono, 1024);
const w = align(g2i.mono, 1024);
const w1 = align(g1l.mono, 1024);
const g = new Float32Array(goal.mono.length + 4864);
g.set(goal.mono, 4864);

const td = track(dry.mono, sr);
const t3 = track(w3, sr);
const tw = track(w, sr);
const t1 = track(w1, sr);
const tg = track(g, sr);

console.log("t     dry    g3c    g2i    g1l    goal  c3c  c2i  c1l   rms");
for (let i = 0; i < td.times.length; i++) {
  const t = td.times[i];
  if (t < 19.35 || t > 21.15) continue;
  const md = midi(td.f0s[i]);
  const m3 = midi(t3.f0s[i] || 0);
  const mw = midi(tw.f0s[i] || 0);
  const m1 = midi(t1.f0s[i] || 0);
  const mg = midi(tg.f0s[i] || 0);
  const a = Math.floor(t * sr);
  const b = Math.min(dry.mono.length, a + Math.floor(0.03 * sr));
  let s = 0;
  for (let k = a; k < b; k++) s += dry.mono[k] * dry.mono[k];
  const rms = Math.sqrt(s / Math.max(1, b - a));
  const nm = (x) => (x > 20 ? x.toFixed(2) : "  — ");
  const c3 = m3 && md ? (Math.abs(m3 - md) * 100).toFixed(0) : "  ";
  const c2 = mw && md ? (Math.abs(mw - md) * 100).toFixed(0) : "  ";
  const c1 = m1 && md ? (Math.abs(m1 - md) * 100).toFixed(0) : "  ";
  console.log(
    t.toFixed(2),
    nm(md),
    nm(m3),
    nm(mw),
    nm(m1),
    nm(mg),
    String(c3).padStart(4),
    String(c2).padStart(4),
    String(c1).padStart(4),
    rms.toFixed(4),
  );
}
