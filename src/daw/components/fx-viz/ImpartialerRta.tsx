import { useRef } from "react";
import { useRafLoop } from "../../hooks/useRafLoop";
import type { FxVizSlot } from "../../spectral-viz";
import { VIZ_DRY, VIZ_DRY_RGB, VIZ_WET, VIZ_WET_RGB } from "./fx-viz-colors";

const HARM_FLOOR = 0.34;
const HARM_FULL = 0.68;
const MAX_VOICES = 48;
const MATCH_X = 0.035;

type Voice = {
  x: number;
  a: number;
  tx: number;
  ta: number;
  age: number;
};

/**
 * Mirrored live line-spectrum RTA for IMPARTIALER.
 * Quantized = soft mass · raw = hairline ghost · center = zero.
 */
export function ImpartialerRta({
  deviceId,
  readViz,
  enabled,
  height = 140,
}: {
  deviceId: string;
  readViz: (id: string) => FxVizSlot | null;
  enabled: boolean;
  height?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const dryVoices = useRef<Voice[]>([]);
  const wetVoices = useRef<Voice[]>([]);
  const lastGen = useRef(-1);
  const lastT = useRef(0);

  useRafLoop(() => {
    const cv = ref.current;
    if (!cv || !enabled) return;
    const now = performance.now();
    const dt = lastT.current ? Math.min(0.05, (now - lastT.current) / 1000) : 0.016;
    lastT.current = now;

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

    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, cssW, cssH);

    const mid = cssH * 0.5;
    const halfMax = cssH * 0.44;

    drawAtmosphere(g, cssW, cssH, mid);

    const slot = readViz(deviceId);
    if (slot && slot.kind === "impartialer" && slot.n > 0 && slot.gen !== lastGen.current) {
      lastGen.current = slot.gen;
      assignTargets(dryVoices.current, collectPeaks(slot.a, slot.xa, slot.n));
      assignTargets(wetVoices.current, collectPeaks(slot.b, slot.xb, slot.n));
    }

    const follow = 1 - Math.exp(-dt * 16);
    const decay = Math.exp(-dt * 5.5);
    tickVoices(dryVoices.current, follow, decay);
    tickVoices(wetVoices.current, follow, decay);

    // hierarchy: quantized fog first (mass), raw hairlines on top (ghost)
    drawFog(g, wetVoices.current, cssW, mid, halfMax, VIZ_WET_RGB);
    drawHairlines(g, dryVoices.current, cssW, mid, halfMax);
    if (slot && slot.kind === "impartialer" && slot.f0N > 0) {
      drawF0Marks(g, slot, cssW, mid, halfMax);
    }

    drawLegend(g, cssH);

    if (!slot || slot.kind !== "impartialer" || slot.n <= 0) {
      g.fillStyle = "#5c5c66";
      g.font = "9px JetBrains Mono, ui-monospace, monospace";
      g.textAlign = "center";
      g.fillText("waiting for spectrum…", cssW / 2, mid - 4);
      g.textAlign = "left";
    }
  });

  return (
    <canvas
      ref={ref}
      className="block w-full rounded-[3px] border border-line bg-inset"
      style={{ height }}
      data-tip="IMPARTIALER RTA — blue hairline = raw, green fog = quantized × strength, amber ticks = HPS F0."
      aria-hidden
    />
  );
}

function drawAtmosphere(
  g: CanvasRenderingContext2D,
  w: number,
  h: number,
  mid: number,
) {
  // base well
  const bg = g.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, "#040405");
  bg.addColorStop(0.5, "#0a0a0f");
  bg.addColorStop(1, "#040405");
  g.fillStyle = bg;
  g.fillRect(0, 0, w, h);

  // radial vignette — lit center, darker edges
  const vig = g.createRadialGradient(w * 0.5, mid, h * 0.08, w * 0.5, mid, Math.max(w, h) * 0.72);
  vig.addColorStop(0, "rgba(12,14,20,0)");
  vig.addColorStop(0.55, "rgba(4,4,6,0.25)");
  vig.addColorStop(1, "rgba(0,0,0,0.72)");
  g.fillStyle = vig;
  g.fillRect(0, 0, w, h);

  // horizontal breath band at equator
  const breath = g.createLinearGradient(0, mid - 28, 0, mid + 28);
  breath.addColorStop(0, "rgba(84,173,189,0)");
  breath.addColorStop(0.45, "rgba(84,173,189,0.045)");
  breath.addColorStop(0.5, "rgba(0,230,118,0.035)");
  breath.addColorStop(0.55, "rgba(84,173,189,0.045)");
  breath.addColorStop(1, "rgba(84,173,189,0)");
  g.fillStyle = breath;
  g.fillRect(0, mid - 28, w, 56);

  // zero hairline
  g.strokeStyle = "rgba(168,168,178,0.18)";
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(16, mid);
  g.lineTo(w - 16, mid);
  g.stroke();
}

function drawLegend(g: CanvasRenderingContext2D, h: number) {
  const y = h - 10;
  g.font = "8px JetBrains Mono, ui-monospace, monospace";
  g.textBaseline = "middle";
  g.textAlign = "left";
  g.globalAlpha = 0.7;
  g.fillStyle = VIZ_DRY;
  g.beginPath();
  g.arc(10, y, 2.5, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "rgba(142,142,152,0.9)";
  g.fillText("raw", 16, y);
  g.fillStyle = VIZ_WET;
  g.beginPath();
  g.arc(42, y, 2.5, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = "rgba(142,142,152,0.9)";
  g.fillText("quantized", 48, y);
  g.fillStyle = "rgba(232,168,74,0.95)";
  g.fillRect(108, y - 3, 2, 6);
  g.fillStyle = "rgba(142,142,152,0.9)";
  g.fillText("F0", 114, y);
  g.globalAlpha = 1;
}

/** Amber ticks at HPS fundamentals (log-freq 0..1). */
function drawF0Marks(
  g: CanvasRenderingContext2D,
  slot: FxVizSlot,
  w: number,
  mid: number,
  halfMax: number,
) {
  g.save();
  for (let i = 0; i < slot.f0N; i++) {
    const t = slot.f0[i];
    if (!(t >= 0 && t <= 1)) continue;
    const x = t * w;
    g.strokeStyle = "rgba(232,168,74,0.55)";
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(x, mid - halfMax * 0.92);
    g.lineTo(x, mid + halfMax * 0.92);
    g.stroke();
    g.fillStyle = "rgba(232,168,74,0.9)";
    g.beginPath();
    g.arc(x, mid, 2.2, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
}

/**
 * Quantized layer — wide soft fog with strong tip dissolve (no hard caps).
 */
function drawFog(
  g: CanvasRenderingContext2D,
  voices: Voice[],
  w: number,
  mid: number,
  halfMax: number,
  rgb: readonly [number, number, number],
) {
  const [r, gch, b] = rgb;
  for (const v of voices) {
    if (v.a < 0.03) continue;
    const x = v.x * w;
    const h = v.a * halfMax;
    if (h < 2) continue;
    // wide mass
    const halfW = 3.5 + v.a * 9;
    const grad = g.createLinearGradient(x, mid - h, x, mid + h);
    const tip = `rgba(${r},${gch},${b},0)`;
    // long transparent tips → dissolve
    grad.addColorStop(0, tip);
    grad.addColorStop(0.12, tip);
    grad.addColorStop(0.28, `rgba(${r},${gch},${b},${0.04 + v.a * 0.1})`);
    grad.addColorStop(0.5, `rgba(${r},${gch},${b},${0.14 + v.a * 0.32})`);
    grad.addColorStop(0.72, `rgba(${r},${gch},${b},${0.04 + v.a * 0.1})`);
    grad.addColorStop(0.88, tip);
    grad.addColorStop(1, tip);
    g.fillStyle = grad;
    roundRect(g, x - halfW, mid - h, halfW * 2, h * 2, halfW);
    g.fill();

    // inner softer core (still fog, not a needle)
    const innerW = 1.2 + v.a * 2.8;
    const core = g.createLinearGradient(x, mid - h * 0.85, x, mid + h * 0.85);
    core.addColorStop(0, tip);
    core.addColorStop(0.2, tip);
    core.addColorStop(0.5, `rgba(${r},${gch},${b},${0.18 + v.a * 0.35})`);
    core.addColorStop(0.8, tip);
    core.addColorStop(1, tip);
    g.fillStyle = core;
    roundRect(g, x - innerW, mid - h * 0.85, innerW * 2, h * 1.7, innerW);
    g.fill();
  }
}

/** Raw layer — thin dim hairlines that peek through the fog. */
function drawHairlines(
  g: CanvasRenderingContext2D,
  voices: Voice[],
  w: number,
  mid: number,
  halfMax: number,
) {
  const [r, gch, b] = VIZ_DRY_RGB;
  g.lineCap = "round";
  g.lineWidth = 0.9;
  for (const v of voices) {
    if (v.a < 0.03) continue;
    const x = v.x * w;
    const h = v.a * halfMax * 1.02;
    if (h < 1) continue;
    const grad = g.createLinearGradient(x, mid - h, x, mid + h);
    const tip = `rgba(${r},${gch},${b},0)`;
    // dimmer than quantized; dissolves at tips
    grad.addColorStop(0, tip);
    grad.addColorStop(0.15, tip);
    grad.addColorStop(0.5, `rgba(${r},${gch},${b},${0.22 + v.a * 0.35})`);
    grad.addColorStop(0.85, tip);
    grad.addColorStop(1, tip);
    g.strokeStyle = grad;
    g.beginPath();
    g.moveTo(x, mid - h);
    g.lineTo(x, mid + h);
    g.stroke();
  }
}

function roundRect(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const rr = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + rr, y);
  g.arcTo(x + w, y, x + w, y + h, rr);
  g.arcTo(x + w, y + h, x, y + h, rr);
  g.arcTo(x, y + h, x, y, rr);
  g.arcTo(x, y, x + w, y, rr);
  g.closePath();
}

function collectPeaks(
  mag: Float32Array,
  pos: Float32Array,
  n: number,
): { x: number; a: number }[] {
  const peak = peakOf(mag, n);
  const floor = peak * HARM_FLOOR;
  const full = peak * HARM_FULL;
  const out: { x: number; a: number }[] = [];
  for (let i = 0; i < n; i++) {
    const v = mag[i] ?? 0;
    const wt = smoothstep(floor, full, v);
    if (wt <= 0) continue;
    const l = i > 0 ? (mag[i - 1] ?? 0) : 0;
    const ri = i < n - 1 ? (mag[i + 1] ?? 0) : 0;
    if (v < l || v < ri) continue;
    let x = pos[i] ?? (i + 0.5) / n;
    if (i > 0 && i < n - 1) {
      const y0 = mag[i - 1];
      const y1 = mag[i];
      const y2 = mag[i + 1];
      const denom = y0 - 2 * y1 + y2;
      if (Math.abs(denom) > 1e-12) {
        const delta = Math.max(-0.5, Math.min(0.5, (0.5 * (y0 - y2)) / denom));
        x = x * 0.65 + ((i + delta) / n) * 0.35;
      }
    }
    out.push({
      x: Math.min(1, Math.max(0, x)),
      a: Math.min(1, wt * v * 1.3),
    });
  }
  return out;
}

function assignTargets(voices: Voice[], peaks: { x: number; a: number }[]) {
  const used = new Set<number>();
  for (const v of voices) v.age += 1;

  for (const p of peaks) {
    let best = -1;
    let bestD = MATCH_X;
    for (let i = 0; i < voices.length; i++) {
      if (used.has(i)) continue;
      const d = Math.abs(voices[i].x - p.x);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best >= 0) {
      used.add(best);
      voices[best].tx = p.x;
      voices[best].ta = p.a;
      voices[best].age = 0;
    } else if (voices.length < MAX_VOICES) {
      voices.push({ x: p.x, a: 0, tx: p.x, ta: p.a, age: 0 });
    }
  }

  for (let i = 0; i < voices.length; i++) {
    if (!used.has(i) && voices[i].age > 0) voices[i].ta = 0;
  }
}

function tickVoices(voices: Voice[], follow: number, decay: number) {
  for (let i = voices.length - 1; i >= 0; i--) {
    const v = voices[i];
    v.x += (v.tx - v.x) * follow;
    v.a += (v.ta - v.a) * follow;
    if (v.ta < 0.01 && v.age > 2) v.a *= decay;
    if (v.a < 0.008 && v.ta < 0.01) voices.splice(i, 1);
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
