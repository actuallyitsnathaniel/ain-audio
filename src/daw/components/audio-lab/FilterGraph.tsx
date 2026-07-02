// ── FILTER GRAPH — a live magnitude response ──────────────────────────────────
// Plots |H(e^jw)| for the current biquad (type/cutoff/Q) across 20 Hz–20 kHz on a
// log-frequency axis, in dB. Uses the RBJ cookbook coefficients — the same maths a
// BiquadFilterNode uses — so the curve matches what you hear, without spinning up an
// AudioContext node every frame. Redraws on every patch change (parent re-renders).

import { useRef } from "react";
import { useRafLoop } from "../../hooks/useRafLoop";
import { biquadMagDb } from "./filter-math";

export function FilterGraph({ type, cut, q, height = 44 }: { type: BiquadFilterType; cut: number; q: number; height?: number }) {
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
    const fMin = 20;
    const fMax = 20000;
    const sr = 44100;
    const DB_HI = 18; // top of the plot
    const DB_LO = -36; // bottom
    const yFor = (db: number) => yTop + ((DB_HI - Math.max(DB_LO, Math.min(DB_HI, db))) / (DB_HI - DB_LO)) * (yBot - yTop);

    // 0 dB reference line
    g.strokeStyle = "#22222a";
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(x0, yFor(0));
    g.lineTo(x1, yFor(0));
    g.stroke();

    // cutoff marker (log x)
    const xFor = (f: number) => x0 + (Math.log2(f / fMin) / Math.log2(fMax / fMin)) * (x1 - x0);
    const cx = xFor(Math.max(fMin, Math.min(fMax, cut)));
    g.strokeStyle = "color-mix(in srgb, " + accent + " 30%, transparent)";
    g.beginPath();
    g.moveTo(cx, yTop);
    g.lineTo(cx, yBot);
    g.stroke();

    // the response curve
    g.strokeStyle = accent;
    g.lineWidth = 1.5;
    g.lineJoin = "round";
    g.beginPath();
    const N = Math.max(48, Math.floor(w));
    for (let i = 0; i <= N; i++) {
      const f = fMin * Math.pow(fMax / fMin, i / N);
      const db = biquadMagDb(type, cut, q, f, sr);
      const px = x0 + (i / N) * (x1 - x0);
      const py = yFor(db);
      if (i === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
    g.stroke();
  });

  return <canvas ref={ref} className="w-full rounded-[3px] border border-line bg-[#0c0c10]" style={{ height }} title="filter response" />;
}
