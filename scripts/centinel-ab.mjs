#!/usr/bin/env node
/**
 * Centinel A/B harness — dry vs wet WAV → f0 / cents metrics.
 *
 * Usage:
 *   node scripts/centinel-ab.mjs <dry.wav> <wet.wav> [--hop-ms=10] [--csv=out.csv]
 *
 * Latency: Centinel reports N/2 = 1024 samples. If wet is a live bounce of the
 * same phrase, pass --latency-ms=… or --latency-samp=1024 (default at 48k ≈ 21.3ms)
 * to align wet to dry before comparing.
 *
 * Metrics (voiced frames only, both tracks clear):
 *   mean |Δcents|, p50/p90 |Δcents|, % frames |Δ|>20¢ / >50¢, octave-error rate
 */

import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";

function parseArgs(argv) {
  const out = { hopMs: 10, latencySamp: null, latencyMs: null, csv: null, files: [] };
  for (const a of argv) {
    if (a.startsWith("--hop-ms=")) out.hopMs = Number(a.slice(9));
    else if (a.startsWith("--latency-samp=")) out.latencySamp = Number(a.slice(15));
    else if (a.startsWith("--latency-ms=")) out.latencyMs = Number(a.slice(13));
    else if (a.startsWith("--csv=")) out.csv = a.slice(6);
    else if (!a.startsWith("-")) out.files.push(a);
  }
  return out;
}

/** Minimal PCM WAV reader (16/24/32-bit PCM or 32-bit float). */
function readWav(path) {
  const buf = readFileSync(path);
  if (buf.toString("ascii", 0, 4) !== "RIFF" || buf.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error(`${path}: not a WAV file`);
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
      if (audioFormat === 3 && bitsPerSample === 32) {
        s = buf.readFloatLE(off);
      } else if (bitsPerSample === 16) {
        s = buf.readInt16LE(off) / 32768;
      } else if (bitsPerSample === 24) {
        const v = buf[off] | (buf[off + 1] << 8) | (buf[off + 2] << 16);
        s = ((v << 8) >> 8) / 8388608;
      } else if (bitsPerSample === 32 && audioFormat === 1) {
        s = buf.readInt32LE(off) / 2147483648;
      } else {
        throw new Error(`${path}: unsupported format ${audioFormat}/${bitsPerSample}`);
      }
      sum += s;
    }
    mono[i] = sum / channels;
  }
  return { sampleRate, mono, path };
}

function yinF0(frame, sr, fMin = 70, fMax = 800) {
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

  const thresh = 0.15;
  let tauEst = -1;
  for (let tau = tauMin; tau <= tauMax; tau++) {
    if (cmnd[tau] < thresh) {
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

  // Parabolic refine
  let tau = tauEst;
  if (tau > 1 && tau < tauMax) {
    const s0 = cmnd[tau - 1];
    const s1 = cmnd[tau];
    const s2 = cmnd[tau + 1];
    const denom = 2 * (2 * s1 - s2 - s0);
    if (Math.abs(denom) > 1e-12) tau = tau + (s2 - s0) / denom;
  }
  const f0 = sr / tau;
  const clarity = 1 - cmnd[Math.min(tauMax, Math.max(1, Math.round(tauEst)))];
  return { f0, clarity };
}

function trackF0(mono, sr, hopMs) {
  const win = Math.max(512, Math.round(sr * 0.04));
  const hop = Math.max(64, Math.round((sr * hopMs) / 1000));
  const times = [];
  const f0s = [];
  const clarities = [];
  const frame = new Float32Array(win);
  for (let start = 0; start + win <= mono.length; start += hop) {
    for (let i = 0; i < win; i++) frame[i] = mono[start + i];
    // light Hann
    for (let i = 0; i < win; i++) {
      frame[i] *= 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / win);
    }
    const { f0, clarity } = yinF0(frame, sr);
    times.push(start / sr);
    f0s.push(f0);
    clarities.push(clarity);
  }
  return { times, f0s, clarities, hop };
}

function hzToMidi(hz) {
  return 69 + (12 * Math.log2(hz / 440));
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  if (lo === hi) return sorted[lo];
  return sorted[lo] * (hi - i) + sorted[hi] * (i - lo);
}

function alignWet(wetMono, latencySamp) {
  if (!latencySamp || latencySamp <= 0) return wetMono;
  const out = new Float32Array(wetMono.length);
  const n = Math.max(0, wetMono.length - latencySamp);
  out.set(wetMono.subarray(latencySamp, latencySamp + n), 0);
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.files.length < 2) {
    console.error(
      "Usage: node scripts/centinel-ab.mjs <dry.wav> <wet.wav> [--hop-ms=10] [--latency-samp=1024] [--latency-ms=21.3] [--csv=out.csv]",
    );
    process.exit(1);
  }

  const dry = readWav(args.files[0]);
  const wetIn = readWav(args.files[1]);
  if (dry.sampleRate !== wetIn.sampleRate) {
    console.error(`sample-rate mismatch: dry ${dry.sampleRate} vs wet ${wetIn.sampleRate}`);
    process.exit(1);
  }
  const sr = dry.sampleRate;
  let latencySamp = args.latencySamp;
  if (latencySamp == null && args.latencyMs != null) {
    latencySamp = Math.round((args.latencyMs / 1000) * sr);
  }
  if (latencySamp == null) {
    // Centinel N/2 default — best guess for worklet bounce
    latencySamp = 1024;
  }

  const wetMono = alignWet(wetIn.mono, latencySamp);
  const dryT = trackF0(dry.mono, sr, args.hopMs);
  const wetT = trackF0(wetMono, sr, args.hopMs);
  const n = Math.min(dryT.f0s.length, wetT.f0s.length);

  const absCents = [];
  let voicedBoth = 0;
  let octaveErr = 0;
  let over20 = 0;
  let over50 = 0;
  const rows = [];

  for (let i = 0; i < n; i++) {
    const fd = dryT.f0s[i];
    const fw = wetT.f0s[i];
    const cd = dryT.clarities[i];
    const cw = wetT.clarities[i];
    const t = dryT.times[i];
    let cents = null;
    const clear = fd > 0 && fw > 0 && cd >= 0.35 && cw >= 0.35;
    if (clear) {
      voicedBoth++;
      // Octave-fold wet toward dry for cents (flag true octave errors separately)
      let fwAdj = fw;
      while (fwAdj > fd * Math.SQRT2) fwAdj *= 0.5;
      while (fwAdj < fd / Math.SQRT2) fwAdj *= 2;
      if (Math.abs(Math.log2(fw / fd)) > 0.8) octaveErr++;
      cents = 1200 * Math.log2(fwAdj / fd);
      const ac = Math.abs(cents);
      absCents.push(ac);
      if (ac > 20) over20++;
      if (ac > 50) over50++;
    }
    rows.push({
      t: t.toFixed(4),
      dryHz: fd > 0 ? fd.toFixed(2) : "",
      wetHz: fw > 0 ? fw.toFixed(2) : "",
      cents: cents == null ? "" : cents.toFixed(1),
      dryMidi: fd > 0 ? hzToMidi(fd).toFixed(2) : "",
      wetMidi: fw > 0 ? hzToMidi(fw).toFixed(2) : "",
    });
  }

  absCents.sort((a, b) => a - b);
  const mean =
    absCents.length === 0
      ? 0
      : absCents.reduce((s, x) => s + x, 0) / absCents.length;

  console.log(`dry: ${basename(dry.path)}  (${dry.mono.length} samp @ ${sr} Hz)`);
  console.log(`wet: ${basename(wetIn.path)}  (aligned −${latencySamp} samp / ${((latencySamp / sr) * 1000).toFixed(2)} ms)`);
  console.log(`hop: ${args.hopMs} ms · frames compared: ${n} · voiced-both: ${voicedBoth}`);
  console.log("");
  console.log("=== pitch delta (wet vs dry, octave-folded) ===");
  console.log(`mean |Δ¢|:  ${mean.toFixed(2)}`);
  console.log(`p50  |Δ¢|:  ${percentile(absCents, 0.5).toFixed(2)}`);
  console.log(`p90  |Δ¢|:  ${percentile(absCents, 0.9).toFixed(2)}`);
  console.log(`|>20¢|:     ${voicedBoth ? ((100 * over20) / voicedBoth).toFixed(1) : 0}%`);
  console.log(`|>50¢|:     ${voicedBoth ? ((100 * over50) / voicedBoth).toFixed(1) : 0}%`);
  console.log(`octave err: ${voicedBoth ? ((100 * octaveErr) / voicedBoth).toFixed(1) : 0}%  (|log2(fw/fd)| > 0.8 before fold)`);

  if (args.csv) {
    const header = "t,dryHz,wetHz,cents,dryMidi,wetMidi\n";
    const body = rows.map((r) => `${r.t},${r.dryHz},${r.wetHz},${r.cents},${r.dryMidi},${r.wetMidi}`).join("\n");
    writeFileSync(args.csv, header + body + "\n");
    console.log(`\nwrote ${args.csv}`);
  }
}

main();
