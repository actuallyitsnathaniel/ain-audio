#!/usr/bin/env node
/**
 * Headless Centinel bounce — OfflineAudioContext + AudioWorklet via Playwright.
 *
 * Requires Vite dev (or preview) serving the worklet. Default: http://127.0.0.1:3000
 *
 *   node scripts/centinel-render.mjs \
 *     --dry=/path/dry.wav --out=.tmp_centinel/render.wav [--base=http://127.0.0.1:3000]
 *
 * Pop preset is the default (matches FxChainRack "pop" chip). Override with --preset=nat|soft
 * or individual --speed=50 --humanize=0.18 etc.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { chromium } from "playwright";

const PRESETS = {
  pop: {
    speed: 20,
    flex: 0,
    humanize: 0.18,
    vibrato: 0,
    amount: 1,
    // Patent cycle-splice + LPC formant preserve (not PSOLA).
    formant: 0.85,
    tracking: 1,
    mix: 1,
    transpose: 0,
    key: 9,
    scale: "major",
    inputType: "altoTenor",
  },
  nat: {
    speed: 55,
    flex: 18,
    humanize: 0.3,
    vibrato: 0,
    amount: 0.85,
    formant: 0.35,
    tracking: 0.32,
    mix: 1,
    transpose: 0,
    key: 9,
    scale: "major",
    inputType: "altoTenor",
  },
  soft: {
    speed: 120,
    flex: 0,
    humanize: 0.35,
    vibrato: 0.15,
    amount: 1,
    formant: 1,
    tracking: 1,
    mix: 1,
    transpose: 0,
    key: 9,
    scale: "major",
    inputType: "altoTenor",
  },
};

function parseArgs(argv) {
  const out = {
    dry: null,
    out: resolve(".tmp_centinel/render.wav"),
    base: process.env.CENTINEL_BASE || "http://localhost:3000",
    preset: "pop",
    params: {},
    ehValidate: false,
  };
  for (const a of argv) {
    if (a.startsWith("--dry=")) out.dry = resolve(a.slice(6));
    else if (a.startsWith("--out=")) out.out = resolve(a.slice(6));
    else if (a.startsWith("--base=")) out.base = a.slice(7);
    else if (a.startsWith("--preset=")) out.preset = a.slice(9);
    else if (a.startsWith("--speed=")) out.params.speed = Number(a.slice(8));
    else if (a.startsWith("--humanize="))
      out.params.humanize = Number(a.slice(11));
    else if (a.startsWith("--formant="))
      out.params.formant = Number(a.slice(10));
    else if (a.startsWith("--key=")) out.params.key = Number(a.slice(6));
    else if (a.startsWith("--tracking="))
      out.params.tracking = Number(a.slice(11));
    else if (a === "--eh-validate") out.ehValidate = true;
  }
  return out;
}

function pctile(sorted, p) {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
  return sorted[i];
}

function windowStats(frames, t0, t1) {
  const w = frames.filter((f) => f.t >= t0 && f.t <= t1 && f.voiced && f.ok && f.peEh > 1 && f.peYin > 1);
  const abs = w.map((f) => Math.abs(f.cents)).sort((a, b) => a - b);
  const oct = w.filter((f) => f.oct).length;
  return {
    n: w.length,
    med: abs.length ? pctile(abs, 50) : 0,
    p90: abs.length ? pctile(abs, 90) : 0,
    octPct: w.length ? (100 * oct) / w.length : 0,
  };
}

function summarizeEhVal(frames) {
  const all = frames.length;
  const voiced = frames.filter((f) => f.voiced);
  const ok = voiced.filter((f) => f.ok && f.peEh > 1 && f.peYin > 1);
  const abs = ok.map((f) => Math.abs(f.cents)).sort((a, b) => a - b);
  const oct = ok.filter((f) => f.oct).length;
  const det = voiced.filter((f) => f.det).length;
  const trackOk = voiced.filter((f) => f.ok).length;
  const gt15 = ok.filter((f) => Math.abs(f.cents) > 15).length;
  const gt50 = ok.filter((f) => Math.abs(f.cents) > 50).length;
  return {
    frames: all,
    voiced: voiced.length,
    compared: ok.length,
    trackOkPct: voiced.length ? (100 * trackOk) / voiced.length : 0,
    detectModePct: voiced.length ? (100 * det) / voiced.length : 0,
    medianAbsCents: abs.length ? pctile(abs, 50) : 0,
    p90AbsCents: abs.length ? pctile(abs, 90) : 0,
    gt15Pct: ok.length ? (100 * gt15) / ok.length : 0,
    gt50Pct: ok.length ? (100 * gt50) / ok.length : 0,
    octavePct: ok.length ? (100 * oct) / ok.length : 0,
    loose14s: windowStats(frames, 14.1, 14.9),
    loose20s: windowStats(frames, 19.95, 20.45),
  };
}

function writeWavStereo(path, left, right, sampleRate) {
  const n = Math.min(left.length, right.length);
  const dataSize = n * 2 * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write("WAVE", 8);
  buf.write("fmt ", 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 4, 28);
  buf.writeUInt16LE(4, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(dataSize, 40);
  let o = 44;
  for (let i = 0; i < n; i++) {
    const l = Math.max(-1, Math.min(1, left[i]));
    const r = Math.max(-1, Math.min(1, right[i]));
    buf.writeInt16LE((l * 32767) | 0, o);
    buf.writeInt16LE((r * 32767) | 0, o + 2);
    o += 4;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, buf);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dryPath =
    args.dry ||
    process.env.CENTINEL_DRY ||
    resolve(
      process.env.HOME || "",
      args.ehValidate ? "Downloads/dry_2.wav" : "Downloads/dry.wav",
    );
  const params = { ...PRESETS[args.preset] || PRESETS.pop, ...args.params };

  const dryBytes = readFileSync(dryPath);
  const dryB64 = dryBytes.toString("base64");

  // Probe base
  try {
    const r = await fetch(args.base, { signal: AbortSignal.timeout(2000) });
    if (!r.ok && r.status !== 404) {
      /* vite may 404 / — still fine if worklet serves */
    }
  } catch {
    console.error(
      `Dev server not reachable at ${args.base}. Start \`npm run dev\` first.`,
    );
    process.exit(1);
  }

  const browser = await chromium.launch({
    channel: "chrome",
    headless: true,
  });
  const page = await browser.newPage();
  // Same origin as Vite so addModule can load the worklet source.
  await page.goto(args.base, { waitUntil: "domcontentloaded", timeout: 30000 });

  const result = await page.evaluate(
    async ({ dryB64, params, ehValidate }) => {
      const bin = Uint8Array.from(atob(dryB64), (c) => c.charCodeAt(0));
      const probe = new AudioContext();
      const decoded = await probe.decodeAudioData(bin.buffer.slice(0));
      const sr = decoded.sampleRate;
      await probe.close();

      // Centinel latency N/2 = 1024; pad so the tail isn't clipped.
      const pad = 2048;
      const frames = decoded.length + pad;
      const off = new OfflineAudioContext(2, frames, sr);
      const bust = Date.now();
      await off.audioWorklet.addModule(
        `/src/daw/worklets/centinel-processor.js?t=${bust}`,
      );

      const node = new AudioWorkletNode(off, "ain-centinel", {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCount: 2,
        processorOptions: {
          on: true,
          key: params.key,
          scale: params.scale,
          customPcs: [0, 2, 4, 5, 7, 9, 11],
          inputType: params.inputType,
          ehValidate,
        },
      });
      let build = null;
      const ehval = [];
      node.port.onmessage = (ev) => {
        if (ev.data?.type === "build") build = ev.data.build;
        if (ev.data?.type === "ehval") ehval.push(ev.data);
      };

      const t0 = off.currentTime;
      const set = (name, v) =>
        node.parameters.get(name)?.setValueAtTime(v, t0);
      set("mix", params.mix);
      set("amount", params.amount);
      set("speed", params.speed);
      set("flex", params.flex);
      set("humanize", params.humanize);
      set("vibrato", params.vibrato);
      set("tracking", params.tracking);
      set("formant", params.formant);
      set("transpose", params.transpose);
      // Mirror config on the port too (live UI path); options cover quantum 0.
      node.port.postMessage({
        type: "config",
        on: true,
        key: params.key,
        scale: params.scale,
        customPcs: [0, 2, 4, 5, 7, 9, 11],
        midiFollow: false,
        inputType: params.inputType,
        viz: false,
        ehValidate,
      });

      const src = off.createBufferSource();
      src.buffer = decoded;
      src.connect(node);
      node.connect(off.destination);
      src.start(0);

      const rendered = await off.startRendering();
      if (ehValidate) await new Promise((r) => setTimeout(r, 200));
      const left = Array.from(rendered.getChannelData(0));
      const right =
        rendered.numberOfChannels > 1
          ? Array.from(rendered.getChannelData(1))
          : left;
      return {
        left,
        right,
        sampleRate: sr,
        build,
        frames: rendered.length,
        ehval,
      };
    },
    { dryB64, params, ehValidate: args.ehValidate },
  );

  await browser.close();

  writeWavStereo(args.out, result.left, result.right, result.sampleRate);
  let ehSummary = null;
  if (args.ehValidate) {
    ehSummary = summarizeEhVal(result.ehval || []);
    const jsonPath = resolve(dirname(args.out), "eh-validate.json");
    writeFileSync(
      jsonPath,
      JSON.stringify({ build: result.build, summary: ehSummary, frames: result.ehval }, null, 2),
    );
    const s = ehSummary;
    console.error(
      `[centinel:eh-validate] build=${result.build} compared=${s.compared}/${s.voiced} voiced`,
    );
    console.error(
      `  |Δ¢| med=${s.medianAbsCents.toFixed(1)} p90=${s.p90AbsCents.toFixed(1)}  >15¢=${s.gt15Pct.toFixed(1)}%  >50¢=${s.gt50Pct.toFixed(1)}%  octave=${s.octavePct.toFixed(1)}%`,
    );
    console.error(
      `  trackOk=${s.trackOkPct.toFixed(1)}%  detectMode=${s.detectModePct.toFixed(1)}%`,
    );
    console.error(
      `  ~14s n=${s.loose14s.n} med=${s.loose14s.med.toFixed(1)} p90=${s.loose14s.p90.toFixed(1)} oct=${s.loose14s.octPct.toFixed(1)}%`,
    );
    console.error(
      `  ~20s n=${s.loose20s.n} med=${s.loose20s.med.toFixed(1)} p90=${s.loose20s.p90.toFixed(1)} oct=${s.loose20s.octPct.toFixed(1)}%`,
    );
    console.error(`  wrote ${jsonPath}`);
  }
  console.log(
    JSON.stringify(
      {
        out: args.out,
        build: result.build,
        sampleRate: result.sampleRate,
        frames: result.frames,
        preset: args.preset,
        params,
        dry: dryPath,
        ehValidate: args.ehValidate,
        ehSummary,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
