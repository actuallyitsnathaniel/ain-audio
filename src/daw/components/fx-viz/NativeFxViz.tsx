/** Compact visual assistants for native FX (filter · comp · delay · chorus · crush · reverb). */

import { useRef } from "react";
import { useRafLoop } from "../../hooks/useRafLoop";
import { engine } from "../../engine";
import {
  DELAY_DIVS,
  DELAY_FEEL_MULT,
  filterParamsToBiquad,
  type DelayFeel,
  type FilterMode,
} from "../../fx-devices";
import { biquadMagDb } from "../audio-lab/filter-math";
import type { FxVizSlot } from "../../spectral-viz";
import { VIZ_DRY, VIZ_WET } from "./fx-viz-colors";

const F_MIN = 20;
const F_MAX = 20_000;

function accentOf(el: HTMLElement): string {
  return getComputedStyle(el).getPropertyValue("--accent").trim() || "#54adbd";
}

function prep(
  cv: HTMLCanvasElement,
): { g: CanvasRenderingContext2D; w: number; h: number } | null {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = cv.clientWidth;
  const h = cv.clientHeight;
  if (w < 2 || h < 2) return null;
  if (cv.width !== Math.floor(w * dpr) || cv.height !== Math.floor(h * dpr)) {
    cv.width = Math.floor(w * dpr);
    cv.height = Math.floor(h * dpr);
  }
  const g = cv.getContext("2d");
  if (!g) return null;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  return { g, w, h };
}

/** FILTER — |H(f)| for Low / High / Band / Notch + reso. */
export function FilterResponseViz({
  on,
  mode,
  freq,
  reso,
  enabled,
  height = 88,
}: {
  on: boolean;
  mode: FilterMode;
  freq: number;
  reso: number;
  enabled: boolean;
  height?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useRafLoop(() => {
    const cv = ref.current;
    if (!cv || !enabled) return;
    const ctx = prep(cv);
    if (!ctx) return;
    const { g, w, h } = ctx;
    const accent = accentOf(cv);
    const pad = 4;
    const x0 = pad;
    const x1 = w - pad;
    const y0 = pad;
    const y1 = h - pad;
    const { type, cut, q } = filterParamsToBiquad(mode, freq, reso, on);
    const DB_HI = 12;
    const DB_LO = -36;
    const yFor = (db: number) =>
      y0 + ((DB_HI - Math.max(DB_LO, Math.min(DB_HI, db))) / (DB_HI - DB_LO)) * (y1 - y0);

    g.strokeStyle = "#1a1a22";
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(x0, yFor(0));
    g.lineTo(x1, yFor(0));
    g.stroke();

    const pin =
      x0 +
      ((Math.log(Math.max(F_MIN, Math.min(F_MAX, cut))) - Math.log(F_MIN)) /
        (Math.log(F_MAX) - Math.log(F_MIN))) *
        (x1 - x0);
    g.strokeStyle = "color-mix(in srgb, " + accent + " 30%, transparent)";
    g.beginPath();
    g.moveTo(pin, y0);
    g.lineTo(pin, y1);
    g.stroke();

    const N = Math.max(48, Math.floor(x1 - x0));
    g.strokeStyle = on ? accent : "#3a3a44";
    g.lineWidth = 1.6;
    g.beginPath();
    for (let i = 0; i <= N; i++) {
      const f = F_MIN * Math.pow(F_MAX / F_MIN, i / N);
      const db = biquadMagDb(type, cut, q, f, 44100);
      const x = x0 + (i / N) * (x1 - x0);
      const y = yFor(db);
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();

    g.fillStyle = "#5c5c66";
    g.font = "8px JetBrains Mono, ui-monospace, monospace";
    g.textAlign = "left";
    g.textBaseline = "top";
    const cutLab =
      cut >= 1000 ? (cut / 1000).toFixed(1) + "k" : Math.round(cut) + "Hz";
    const modeLab =
      mode === "low" ? "LP" : mode === "high" ? "HP" : mode === "band" ? "BP" : "Notch";
    g.fillText(on ? modeLab + " · " + cutLab + " · Q " + q.toFixed(1) : "bypass", x0 + 2, y0);
  });
  return (
    <canvas
      ref={ref}
      className="w-full rounded-[3px] border border-line bg-[#0c0c10]"
      style={{ height }}
      data-tip="Filter magnitude — LP / HP / BP / Notch · freq + resonance"
    />
  );
}

/** COMP — scrolling gain-reduction history (live from DynamicsCompressor.reduction). */
export function CompGrViz({
  deviceId,
  readViz,
  threshold,
  enabled,
  height = 72,
}: {
  deviceId: string;
  readViz: (id: string) => FxVizSlot | null;
  threshold: number;
  enabled: boolean;
  height?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useRafLoop(() => {
    const cv = ref.current;
    if (!cv || !enabled) return;
    const ctx = prep(cv);
    if (!ctx) return;
    const { g, w, h } = ctx;
    const slot = readViz(deviceId);
    const pad = 4;
    const x0 = pad;
    const x1 = w - pad;
    const y0 = pad;
    const y1 = h - pad;
    const maxGr = 24;

    g.fillStyle = "#5c5c66";
    g.font = "8px JetBrains Mono, ui-monospace, monospace";
    g.textAlign = "left";
    g.textBaseline = "top";
    g.fillText("GR 0", x0 + 2, y0);
    g.textBaseline = "bottom";
    g.fillText("−24", x0 + 2, y1);
    g.textAlign = "right";
    g.textBaseline = "top";
    g.fillStyle = VIZ_DRY;
    g.fillText("thr " + Math.round(threshold) + "dB", x1 - 2, y0);

    if (!slot || slot.n <= 0) return;
    const n = slot.n;
    g.strokeStyle = VIZ_WET;
    g.lineWidth = 1.5;
    g.beginPath();
    for (let i = 0; i < n; i++) {
      const gr = (slot.a[i] ?? 0) * maxGr; // 0..24 dB
      const x = x0 + (i / Math.max(1, n - 1)) * (x1 - x0);
      const y = y0 + (gr / maxGr) * (y1 - y0);
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();
    g.lineTo(x1, y0);
    g.lineTo(x0, y0);
    g.closePath();
    g.fillStyle = VIZ_WET;
    g.globalAlpha = 0.18;
    g.fill();
    g.globalAlpha = 1;
  });
  return (
    <canvas
      ref={ref}
      className="w-full rounded-[3px] border border-line bg-[#0c0c10]"
      style={{ height }}
      data-tip="Compressor gain reduction over time — green = how hard it's ducking"
    />
  );
}

/** DELAY — decaying echo taps on a time axis. */
export function DelayEchoViz({
  on,
  time,
  fb,
  mix,
  sync,
  div,
  feel,
  enabled,
  height = 72,
}: {
  on: boolean;
  time: number;
  fb: number;
  mix: number;
  sync: boolean;
  div: number;
  feel: DelayFeel;
  enabled: boolean;
  height?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useRafLoop(() => {
    const cv = ref.current;
    if (!cv || !enabled) return;
    const ctx = prep(cv);
    if (!ctx) return;
    const { g, w, h } = ctx;
    const accent = accentOf(cv);
    const pad = 6;
    const x0 = pad;
    const x1 = w - pad;
    const y0 = pad;
    const y1 = h - pad - 10;
    const bpm = Math.max(40, engine.bpm || 120);
    const baseBeats = DELAY_DIVS[div]?.beats ?? 0.5;
    const syncedSec = baseBeats * DELAY_FEEL_MULT[feel] * (60 / bpm);
    const delaySec = sync ? Math.min(2, syncedSec) : time;
    const span = Math.max(0.35, Math.min(2.2, delaySec * 5.5));

    g.strokeStyle = "#1a1a22";
    g.beginPath();
    g.moveTo(x0, y1);
    g.lineTo(x1, y1);
    g.stroke();

    // dry impulse
    g.fillStyle = on ? VIZ_DRY : "#3a3a44";
    g.fillRect(x0, y0 + 4, 3, y1 - y0 - 4);

    let amp = on ? mix : 0;
    for (let n = 1; n <= 8 && amp > 0.02; n++) {
      const t = n * delaySec;
      if (t > span) break;
      const x = x0 + (t / span) * (x1 - x0);
      const barH = (y1 - y0 - 4) * amp;
      g.fillStyle = VIZ_WET;
      g.globalAlpha = 0.35 + amp * 0.65;
      g.fillRect(x - 1.5, y1 - barH, 3, barH);
      amp *= fb;
    }
    g.globalAlpha = 1;

    g.fillStyle = "#5c5c66";
    g.font = "8px JetBrains Mono, ui-monospace, monospace";
    g.textAlign = "left";
    g.textBaseline = "top";
    const ms = Math.round(delaySec * 1000);
    g.fillText(
      (sync ? "sync · " : "") + ms + "ms" + (on ? "" : " · off"),
      x0,
      y1 + 2,
    );
    g.fillStyle = accent;
    g.textAlign = "right";
    g.fillText("echoes", x1, y1 + 2);
  });
  return (
    <canvas
      ref={ref}
      className="w-full rounded-[3px] border border-line bg-[#0c0c10]"
      style={{ height }}
      data-tip="Delay echoes — blue = dry hit, green taps decay with feedback"
    />
  );
}

/** CHORUS — dual LFO delay-mod traces (L/R). */
export function ChorusLfoViz({
  on,
  rate,
  depth,
  mix,
  enabled,
  height = 72,
}: {
  on: boolean;
  rate: number;
  depth: number;
  mix: number;
  enabled: boolean;
  height?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const t0 = useRef<number | null>(null);
  useRafLoop(() => {
    const cv = ref.current;
    if (!cv || !enabled) return;
    const ctx = prep(cv);
    if (!ctx) return;
    const { g, w, h } = ctx;
    if (t0.current == null) t0.current = performance.now();
    const pad = 4;
    const x0 = pad;
    const x1 = w - pad;
    const mid = h * 0.5;
    const amp = h * 0.32 * (on ? depth : 0) * (0.35 + mix * 0.65);
    const now = (performance.now() - t0.current) / 1000;
    const N = Math.max(48, Math.floor(x1 - x0));
    const rates = [rate, rate * 1.27];
    const phases = [0, 0.37 * Math.PI * 2];
    const colors = [VIZ_DRY, VIZ_WET];
    for (let v = 0; v < 2; v++) {
      g.strokeStyle = colors[v];
      g.globalAlpha = on ? 0.9 : 0.25;
      g.lineWidth = 1.4;
      g.beginPath();
      for (let i = 0; i <= N; i++) {
        const u = i / N;
        const x = x0 + u * (x1 - x0);
        const ph = phases[v] + now * rates[v] * Math.PI * 2 + u * Math.PI * 2;
        const y = mid + Math.sin(ph) * amp;
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.stroke();
    }
    g.globalAlpha = 1;
    g.fillStyle = "#5c5c66";
    g.font = "8px JetBrains Mono, ui-monospace, monospace";
    g.textAlign = "left";
    g.textBaseline = "top";
    g.fillText("L", x0 + 2, 2);
    g.fillStyle = VIZ_WET;
    g.fillText("R", x0 + 14, 2);
  });
  return (
    <canvas
      ref={ref}
      className="w-full rounded-[3px] border border-line bg-[#0c0c10]"
      style={{ height }}
      data-tip="Chorus LFO — blue/green = L/R delay modulation (rate × depth)"
    />
  );
}

/**
 * COMB — |H(f)| of a feedback comb: 1 / |1 − g e^(−j2πf/fc)| (damp softens peaks).
 */
export function CombResponseViz({
  on,
  freq,
  feedback,
  damp,
  mix,
  enabled,
  height = 88,
}: {
  on: boolean;
  freq: number;
  feedback: number;
  damp: number;
  mix: number;
  enabled: boolean;
  height?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useRafLoop(() => {
    const cv = ref.current;
    if (!cv || !enabled) return;
    const ctx = prep(cv);
    if (!ctx) return;
    const { g, w, h } = ctx;
    const accent = accentOf(cv);
    const pad = 4;
    const x0 = pad;
    const x1 = w - pad;
    const y0 = pad;
    const y1 = h - pad;
    const fc = Math.max(20, Math.min(4000, freq));
    const gFb = on ? Math.max(-0.95, Math.min(0.95, feedback)) : 0;
    const dampAmt = Math.max(0, Math.min(1, damp));
    const mixAmt = on ? Math.max(0, Math.min(1, mix)) : 0;
    const DB_HI = 18;
    const DB_LO = -24;
    const yFor = (db: number) =>
      y0 + ((DB_HI - Math.max(DB_LO, Math.min(DB_HI, db))) / (DB_HI - DB_LO)) * (y1 - y0);

    g.strokeStyle = "#1a1a22";
    g.beginPath();
    g.moveTo(x0, yFor(0));
    g.lineTo(x1, yFor(0));
    g.stroke();

    // pin fundamental
    const pin =
      x0 +
      ((Math.log(fc) - Math.log(F_MIN)) / (Math.log(F_MAX) - Math.log(F_MIN))) * (x1 - x0);
    g.strokeStyle = "color-mix(in srgb, " + accent + " 35%, transparent)";
    g.beginPath();
    g.moveTo(pin, y0);
    g.lineTo(pin, y1);
    g.stroke();

    const N = Math.max(64, Math.floor(x1 - x0));
    g.strokeStyle = on ? accent : "#3a3a44";
    g.lineWidth = 1.5;
    g.beginPath();
    for (let i = 0; i <= N; i++) {
      const f = F_MIN * Math.pow(F_MAX / F_MIN, i / N);
      // feedback comb magnitude; damp reduces |g| at high f
      const dampG = gFb * (1 - dampAmt * Math.min(1, f / 8000));
      const phase = (2 * Math.PI * f) / fc;
      const den = Math.sqrt(
        1 + dampG * dampG - 2 * dampG * Math.cos(phase),
      );
      const hComb = 1 / Math.max(1e-6, den);
      // blend toward unity with mix (wet path only shows comb; dry is flat)
      const hOut = (1 - mixAmt) + mixAmt * hComb;
      const db = 20 * Math.log10(Math.max(1e-6, hOut));
      const x = x0 + (i / N) * (x1 - x0);
      const y = yFor(db);
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();

    g.fillStyle = "#5c5c66";
    g.font = "8px JetBrains Mono, ui-monospace, monospace";
    g.textAlign = "left";
    g.textBaseline = "top";
    const fLab = fc >= 1000 ? (fc / 1000).toFixed(1) + "k" : Math.round(fc) + "Hz";
    g.fillText(
      fLab + (gFb < 0 ? " · inv" : "") + " · fb " + Math.round(Math.abs(gFb) * 100) + "%",
      x0 + 2,
      y0,
    );
  });
  return (
    <canvas
      ref={ref}
      className="w-full rounded-[3px] border border-line bg-[#0c0c10]"
      style={{ height }}
      data-tip="Comb magnitude — peaks/notches at multiples of freq. Negative feedback inverts."
    />
  );
}

/** CRUSH — waveshaper transfer curve (tanh drive). */
export function CrushCurveViz({
  on,
  drive,
  autoGain,
  enabled,
  height = 88,
}: {
  on: boolean;
  drive: number;
  autoGain: boolean;
  enabled: boolean;
  height?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useRafLoop(() => {
    const cv = ref.current;
    if (!cv || !enabled) return;
    const ctx = prep(cv);
    if (!ctx) return;
    const { g, w, h } = ctx;
    const accent = accentOf(cv);
    const pad = 6;
    const x0 = pad;
    const x1 = w - pad;
    const y0 = pad;
    const y1 = h - pad;
    const midX = (x0 + x1) / 2;
    const midY = (y0 + y1) / 2;

    g.strokeStyle = "#1a1a22";
    g.beginPath();
    g.moveTo(midX, y0);
    g.lineTo(midX, y1);
    g.moveTo(x0, midY);
    g.lineTo(x1, midY);
    g.stroke();

    // unity reference
    g.strokeStyle = "rgba(142,142,152,0.35)";
    g.setLineDash([2, 3]);
    g.beginPath();
    g.moveTo(x0, y1);
    g.lineTo(x1, y0);
    g.stroke();
    g.setLineDash([]);

    const k = on && drive > 0.001 ? 1 + drive * 24 : 1;
    const norm = Math.tanh(k) || 1;
    const gAuto = autoGain && on ? 1 / Math.sqrt(1 + drive * 3.5) : 1;
    const N = 96;
    g.strokeStyle = on ? accent : "#3a3a44";
    g.lineWidth = 1.7;
    g.beginPath();
    for (let i = 0; i <= N; i++) {
      const x = (i / N) * 2 - 1;
      const y = (Math.tanh(k * x) / norm) * gAuto;
      const px = midX + x * ((x1 - x0) / 2);
      const py = midY - y * ((y1 - y0) / 2);
      if (i === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
    g.stroke();

    g.fillStyle = "#5c5c66";
    g.font = "8px JetBrains Mono, ui-monospace, monospace";
    g.textAlign = "left";
    g.textBaseline = "top";
    g.fillText(
      on ? "drive " + Math.round(drive * 100) + "%" + (autoGain ? " · auto" : "") : "bypass",
      x0,
      y0,
    );
  });
  return (
    <canvas
      ref={ref}
      className="w-full rounded-[3px] border border-line bg-[#0c0c10]"
      style={{ height }}
      data-tip="Crush transfer curve — input → output. Steeper = more saturation."
    />
  );
}

/** REVERB — synthetic IR envelope sketch from decay × mix (+ predelay gap). */
export function ReverbTailViz({
  on,
  decay,
  mix,
  predelay = 0.02,
  size = 0.55,
  damping = 0.35,
  enabled,
  height = 72,
}: {
  on: boolean;
  decay: number;
  mix: number;
  predelay?: number;
  size?: number;
  damping?: number;
  enabled: boolean;
  height?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useRafLoop(() => {
    const cv = ref.current;
    if (!cv || !enabled) return;
    const ctx = prep(cv);
    if (!ctx) return;
    const { g, w, h } = ctx;
    const pad = 4;
    const x0 = pad;
    const x1 = w - pad;
    const y0 = pad;
    const y1 = h - pad - 10;
    const pd = Math.max(0, Math.min(0.2, predelay));
    const span = Math.max(1.2, Math.min(10, pd + decay * (1.1 + size * 0.4)));
    const N = Math.max(48, Math.floor(x1 - x0));

    g.beginPath();
    g.moveTo(x0, y1);
    for (let i = 0; i <= N; i++) {
      const t = (i / N) * span;
      let a = 0;
      if (t >= pd) {
        const u = (t - pd) / Math.max(0.05, decay);
        const env = Math.pow(1 - Math.min(1, u), 1.6 + size * 0.9);
        // damping pulls the late envelope down faster visually
        const damp = 1 - damping * Math.min(1, u) * 0.55;
        a = (on ? mix : 0) * env * damp;
      }
      const x = x0 + (i / N) * (x1 - x0);
      const y = y1 - a * (y1 - y0 - 2);
      g.lineTo(x, y);
    }
    g.lineTo(x1, y1);
    g.closePath();
    g.fillStyle = VIZ_WET;
    g.globalAlpha = on ? 0.35 : 0.12;
    g.fill();
    g.globalAlpha = 1;
    g.strokeStyle = on ? VIZ_WET : "#3a3a44";
    g.lineWidth = 1.4;
    g.beginPath();
    for (let i = 0; i <= N; i++) {
      const t = (i / N) * span;
      let a = 0;
      if (t >= pd) {
        const u = (t - pd) / Math.max(0.05, decay);
        const env = Math.pow(1 - Math.min(1, u), 1.6 + size * 0.9);
        const damp = 1 - damping * Math.min(1, u) * 0.55;
        a = (on ? mix : 0) * env * damp;
      }
      const x = x0 + (i / N) * (x1 - x0);
      const y = y1 - a * (y1 - y0 - 2);
      if (i === 0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
    g.stroke();

    // predelay marker
    if (pd > 0.001) {
      const px = x0 + (pd / span) * (x1 - x0);
      g.strokeStyle = "rgba(142,142,152,0.45)";
      g.setLineDash([2, 3]);
      g.beginPath();
      g.moveTo(px, y0);
      g.lineTo(px, y1);
      g.stroke();
      g.setLineDash([]);
    }

    // dry
    g.fillStyle = VIZ_DRY;
    g.globalAlpha = on ? 0.55 : 0.2;
    g.fillRect(x0, y0 + 2, 3, y1 - y0 - 2);
    g.globalAlpha = 1;

    g.fillStyle = "#5c5c66";
    g.font = "8px JetBrains Mono, ui-monospace, monospace";
    g.textAlign = "left";
    g.textBaseline = "top";
    g.fillText(
      Math.round(pd * 1000) +
        "ms pre · " +
        decay.toFixed(1) +
        "s · damp " +
        Math.round(damping * 100) +
        "%",
      x0,
      y1 + 2,
    );
  });
  return (
    <canvas
      ref={ref}
      className="w-full rounded-[3px] border border-line bg-[#0c0c10]"
      style={{ height }}
      data-tip="Reverb tail — gap = predelay; length = decay; slope darkens with damping"
    />
  );
}
