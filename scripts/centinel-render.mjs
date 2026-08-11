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
    formant: 1,
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
  }
  return out;
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
    resolve(process.env.HOME || "", "Downloads/dry.wav");
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
    async ({ dryB64, params }) => {
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
        },
      });
      let build = null;
      node.port.onmessage = (ev) => {
        if (ev.data?.type === "build") build = ev.data.build;
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
      });

      const src = off.createBufferSource();
      src.buffer = decoded;
      src.connect(node);
      node.connect(off.destination);
      src.start(0);

      const rendered = await off.startRendering();
      const left = Array.from(rendered.getChannelData(0));
      const right =
        rendered.numberOfChannels > 1
          ? Array.from(rendered.getChannelData(1))
          : left;
      return { left, right, sampleRate: sr, build, frames: rendered.length };
    },
    { dryB64, params },
  );

  await browser.close();

  writeWavStereo(args.out, result.left, result.right, result.sampleRate);
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
