// ── ENV GRAPH — a live ADSR curve ────────────────────────────────────────────
// Draws attack → decay → sustain → release as a filled curve that redraws whenever
// the patch changes (parent re-renders on "patch"). Time axis is log-ish (the four
// stages get proportional-but-clamped widths) so short + long stages both read.

import { useRef } from "react";
import { useRafLoop } from "../../hooks/useRafLoop";

export function EnvGraph({ a, d, s, r, height = 44 }: { a: number; d: number; s: number; r: number; height?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useRafLoop(() => {
    const cv = ref.current;
    if (!cv) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = cv.clientWidth;
    const h = cv.clientHeight;
    if (cv.width !== Math.floor(w * dpr) || cv.height !== Math.floor(h * dpr)) {
      cv.width = Math.floor(w * dpr);
      cv.height = Math.floor(h * dpr);
    }
    const g = cv.getContext("2d");
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const accent = getComputedStyle(cv).getPropertyValue("--accent").trim() || "#54adbd";
    const pad = 3;
    const x0 = pad;
    const x1 = w - pad;
    const yTop = pad;
    const yBot = h - pad;
    const yFor = (v: number) => yBot - v * (yBot - yTop); // v 0..1

    // stage widths: split the span so A/D/R share ~72% by their relative times, with
    // a fixed sustain plateau. sqrt keeps very short stages visible. ponytail: cosmetic
    // time-warp, not real seconds — the numbers on the knobs carry the truth.
    const span = x1 - x0;
    const plateau = span * 0.26; // the sustain hold
    const rest = span - plateau;
    const wa = Math.sqrt(Math.max(0.001, a));
    const wd = Math.sqrt(Math.max(0.001, d));
    const wr = Math.sqrt(Math.max(0.001, r));
    const sum = wa + wd + wr || 1;
    const xa = x0 + (wa / sum) * rest;
    const xd = xa + (wd / sum) * rest;
    const xs = xd + plateau;
    const xr = x1;

    // grid baseline
    g.strokeStyle = "#22222a";
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(x0, yBot);
    g.lineTo(x1, yBot);
    g.stroke();

    g.beginPath();
    g.moveTo(x0, yBot); // start silent
    g.lineTo(xa, yTop); // attack → peak
    g.lineTo(xd, yFor(s)); // decay → sustain
    g.lineTo(xs, yFor(s)); // sustain hold
    g.lineTo(xr, yBot); // release → 0
    const fill = g.createLinearGradient(0, yTop, 0, yBot);
    fill.addColorStop(0, "color-mix(in srgb, " + accent + " 34%, transparent)");
    fill.addColorStop(1, "color-mix(in srgb, " + accent + " 3%, transparent)");
    g.save();
    g.lineTo(xr, yBot);
    g.closePath();
    g.fillStyle = fill;
    g.fill();
    g.restore();

    // the curve stroke
    g.strokeStyle = accent;
    g.lineWidth = 1.5;
    g.lineJoin = "round";
    g.beginPath();
    g.moveTo(x0, yBot);
    g.lineTo(xa, yTop);
    g.lineTo(xd, yFor(s));
    g.lineTo(xs, yFor(s));
    g.lineTo(xr, yBot);
    g.stroke();

    // stage node dots
    g.fillStyle = accent;
    for (const [px, py] of [[xa, yTop], [xd, yFor(s)], [xs, yFor(s)]] as const) {
      g.beginPath();
      g.arc(px, py, 1.8, 0, Math.PI * 2);
      g.fill();
    }
  });

  return <canvas ref={ref} className="w-full rounded-[3px] border border-line bg-[#0c0c10]" style={{ height }} title="envelope" />;
}
