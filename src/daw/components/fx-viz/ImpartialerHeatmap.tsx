import { useRef } from "react";
import { useRafLoop } from "../../hooks/useRafLoop";
import type { FxVizSlot } from "../../spectral-viz";
import { VIZ_DRY, VIZ_DRY_RGB, VIZ_WET, VIZ_WET_RGB } from "./fx-viz-colors";

const HARM_FLOOR = 0.38;
const HARM_FULL = 0.72;
/** ~gens/sec from worklet viz throttle — used to size a 1s trail. */
const VIZ_GENS_PER_SEC = 28;

/**
 * Scrolling harmonic trail for IMPARTIALER (optional history mode).
 * Fixed ~1s window stretched to full width. Blue dry · green adjusted×strength.
 */
export function ImpartialerHeatmap({
  deviceId,
  readViz,
  enabled,
  height = 96,
  historySec = 1,
}: {
  deviceId: string;
  readViz: (id: string) => FxVizSlot | null;
  enabled: boolean;
  height?: number;
  /** Visible history length in seconds (default 1). */
  historySec?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const offRef = useRef<HTMLCanvasElement | null>(null);
  const lastGen = useRef(-1);
  const pixels = useRef<ImageData | null>(null);
  const dryW = useRef<Float32Array | null>(null);
  const wetW = useRef<Float32Array | null>(null);
  const histCols = Math.max(24, Math.round(historySec * VIZ_GENS_PER_SEC));

  useRafLoop(() => {
    const cv = ref.current;
    if (!cv || !enabled) return;
    const dpr = window.devicePixelRatio || 1;
    const cssW = Math.max(1, cv.clientWidth);
    const cssH = Math.max(1, cv.clientHeight);
    const pw = Math.floor(cssW * dpr);
    const ph = Math.floor(cssH * dpr);
    if (cv.width !== pw || cv.height !== ph) {
      cv.width = pw;
      cv.height = ph;
    }
    const g = cv.getContext("2d");
    if (!g) return;

    const slot = readViz(deviceId);
    const has = !!(slot && slot.kind === "impartialer" && slot.n > 0);

    // history buffer: one column per viz gen, ~historySec wide
    if (!pixels.current || pixels.current.width !== histCols || pixels.current.height !== ph) {
      pixels.current = new ImageData(histCols, ph);
      fillBg(pixels.current);
      lastGen.current = -1;
    }

    const img = pixels.current;
    if (has && slot!.gen !== lastGen.current) {
      lastGen.current = slot!.gen;
      if (!dryW.current || dryW.current.length !== ph) {
        dryW.current = new Float32Array(ph);
        wetW.current = new Float32Array(ph);
      }
      scrollLeft(img);
      smearEdge(img);
      paintColumn(img, slot!, dryW.current, wetW.current!);
    }

    if (!offRef.current) offRef.current = document.createElement("canvas");
    const off = offRef.current;
    if (off.width !== histCols || off.height !== ph) {
      off.width = histCols;
      off.height = ph;
    }
    const og = off.getContext("2d");
    if (!og) return;
    og.putImageData(img, 0, 0);

    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = "#08080a";
    g.fillRect(0, 0, pw, ph);
    // stretch 1s trail across full width
    g.imageSmoothingEnabled = true;
    g.drawImage(off, 0, 0, histCols, ph, 0, 0, pw, ph);

    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.font = "9px JetBrains Mono, ui-monospace, monospace";
    g.textBaseline = "top";
    g.fillStyle = "rgba(8,8,10,0.65)";
    g.fillRect(2, 2, 148, 12);
    g.fillStyle = VIZ_DRY;
    g.fillRect(4, 4, 7, 7);
    g.fillStyle = "#8e8e98";
    g.fillText("raw", 14, 3);
    g.fillStyle = VIZ_WET;
    g.fillRect(36, 4, 7, 7);
    g.fillStyle = "#8e8e98";
    g.fillText(`quantized · ~${historySec}s`, 46, 3);

    if (!has) {
      g.fillStyle = "#5c5c66";
      g.fillText("waiting for spectrum…", 4, cssH / 2 - 4);
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
  });

  return (
    <canvas
      ref={ref}
      className="block w-full rounded-[3px] border border-line bg-inset"
      style={{ height }}
      data-tip={`IMPARTIALER trail — ~${historySec}s scrolling harmonic history. Blue = dry, green = adjusted × strength.`}
      aria-hidden
    />
  );
}

function fillBg(img: ImageData) {
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = 8;
    d[i + 1] = 8;
    d[i + 2] = 10;
    d[i + 3] = 255;
  }
}

function scrollLeft(img: ImageData) {
  const { data, width: pw, height: ph } = img;
  for (let y = 0; y < ph; y++) {
    const row = y * pw * 4;
    data.copyWithin(row, row + 4, row + pw * 4);
  }
}

function smearEdge(img: ImageData) {
  const { data, width: pw, height: ph } = img;
  if (pw < 3) return;
  for (let y = 0; y < ph; y++) {
    const a = (y * pw + (pw - 2)) * 4;
    const b = (y * pw + (pw - 1)) * 4;
    data[b] = (data[a] * 3 + data[b]) >> 2;
    data[b + 1] = (data[a + 1] * 3 + data[b + 1]) >> 2;
    data[b + 2] = (data[a + 2] * 3 + data[b + 2]) >> 2;
  }
}

function peakOf(arr: Float32Array, n: number): number {
  let p = 1e-12;
  for (let i = 0; i < n; i++) p = Math.max(p, arr[i] ?? 0);
  return p;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / Math.max(1e-9, edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function harmonicWeights(arr: Float32Array, n: number, out: Float32Array) {
  const peak = peakOf(arr, n);
  const floor = peak * HARM_FLOOR;
  const full = peak * HARM_FULL;
  for (let i = 0; i < n; i++) {
    const v = arr[i] ?? 0;
    const w = smoothstep(floor, full, v);
    if (w <= 0) {
      out[i] = 0;
      continue;
    }
    const l = i > 0 ? (arr[i - 1] ?? 0) : 0;
    const r = i < n - 1 ? (arr[i + 1] ?? 0) : 0;
    out[i] = w * (v >= l && v >= r ? 1 : 0.45);
  }
}

function paintColumn(
  img: ImageData,
  slot: FxVizSlot,
  dryCol: Float32Array,
  wetCol: Float32Array,
) {
  const { data, width: pw, height: ph } = img;
  const n = slot.n;
  const dry = slot.a;
  const wet = slot.b;

  const dryBin = new Float32Array(n);
  const wetBin = new Float32Array(n);
  harmonicWeights(dry, n, dryBin);
  harmonicWeights(wet, n, wetBin);

  dryCol.fill(0);
  wetCol.fill(0);
  for (let y = 0; y < ph; y++) {
    const t = 1 - (y + 0.5) / ph;
    const fi = t * (n - 1);
    const i0 = Math.max(0, Math.min(n - 1, Math.floor(fi)));
    const i1 = Math.min(n - 1, i0 + 1);
    const frac = fi - i0;
    dryCol[y] = dryBin[i0] * (1 - frac) + dryBin[i1] * frac;
    wetCol[y] = wetBin[i0] * (1 - frac) + wetBin[i1] * frac;
  }
  blur1D(dryCol);
  blur1D(wetCol);

  const x = pw - 1;
  for (let y = 0; y < ph; y++) {
    const o = (y * pw + x) * 4;
    const dryAmt = dryCol[y] * Math.min(1, sampleBin(dry, n, y, ph) * 1.15);
    const wetAmt = wetCol[y] * Math.min(1, sampleBin(wet, n, y, ph) * 1.35);

    let r = 8;
    let gch = 8;
    let b = 10;
    if (dryAmt > 0.01) {
      r = lerp(r, VIZ_DRY_RGB[0], dryAmt);
      gch = lerp(gch, VIZ_DRY_RGB[1], dryAmt);
      b = lerp(b, VIZ_DRY_RGB[2], dryAmt);
    }
    if (wetAmt > 0.008) {
      r = lerp(r, VIZ_WET_RGB[0], wetAmt);
      gch = lerp(gch, VIZ_WET_RGB[1], wetAmt);
      b = lerp(b, VIZ_WET_RGB[2], wetAmt);
    }
    const dither = (((x * 7 + y * 13) & 7) - 3) * 0.35;
    data[o] = clamp8(r + dither);
    data[o + 1] = clamp8(gch + dither);
    data[o + 2] = clamp8(b + dither);
    data[o + 3] = 255;
  }
}

function sampleBin(arr: Float32Array, n: number, y: number, ph: number): number {
  const t = 1 - (y + 0.5) / ph;
  const fi = t * (n - 1);
  const i0 = Math.max(0, Math.min(n - 1, Math.floor(fi)));
  const i1 = Math.min(n - 1, i0 + 1);
  const frac = fi - i0;
  return (arr[i0] ?? 0) * (1 - frac) + (arr[i1] ?? 0) * frac;
}

function blur1D(col: Float32Array) {
  const n = col.length;
  const tmp = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = i > 0 ? col[i - 1] : col[i];
    const b = col[i];
    const c = i < n - 1 ? col[i + 1] : col[i];
    tmp[i] = a * 0.2 + b * 0.6 + c * 0.2;
  }
  col.set(tmp);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * Math.min(1, Math.max(0, t));
}

function clamp8(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v | 0;
}
