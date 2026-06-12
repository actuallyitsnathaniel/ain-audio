import { useRef } from "react";
import { engine } from "../engine";
import { useRafLoop } from "../hooks/useRafLoop";

// Output spectrum analyzer (log-spaced bars).
export function Spectrum({ height = 120 }: { height?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const data = useRef(new Uint8Array(1024));

  useRafLoop(() => {
    const cv = ref.current;
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth,
      h = cv.clientHeight;
    if (cv.width !== w * dpr) {
      cv.width = w * dpr;
      cv.height = h * dpr;
    }
    const g = cv.getContext("2d");
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);

    const ok = engine.getSpectrum(data.current);
    const accent = getComputedStyle(cv).getPropertyValue("--accent").trim() || "#54ADBD";
    const BARS = 56;
    const bw = w / BARS;
    g.fillStyle = accent;
    for (let i = 0; i < BARS; i++) {
      // log mapping into the 1024 bins (skip the very top)
      const f0 = Math.floor(Math.pow(i / BARS, 2.2) * 700);
      const f1 = Math.max(f0 + 1, Math.floor(Math.pow((i + 1) / BARS, 2.2) * 700));
      let v = 0;
      for (let j = f0; j < f1; j++) v = Math.max(v, data.current[j] || 0);
      const bh = ok ? (v / 255) * (h - 4) : 1;
      g.globalAlpha = ok && engine.playing ? 0.9 : 0.25;
      g.fillRect(i * bw + 1, h - bh - 1, Math.max(1, bw - 2), Math.max(1, bh));
    }
    g.globalAlpha = 1;
  });

  return (
    <canvas
      ref={ref}
      className="w-full rounded-[3px] border border-line bg-inset"
      style={{ height }}
    />
  );
}
