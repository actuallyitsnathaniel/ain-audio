import { useRef } from "react";
import { engine } from "./engine";
import { useRafLoop } from "./hooks/useRafLoop";

// Audio-reactive background. Reactivity is baked to 55% (a permanent tweak).
const REACTIVITY = 55;

export function BgCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);
  const data = useRef(new Uint8Array(1024));

  useRafLoop(() => {
    const cv = ref.current;
    if (!cv) return;
    const dpr = Math.min(1.5, window.devicePixelRatio || 1);
    const w = window.innerWidth,
      h = window.innerHeight;
    if (cv.width !== Math.floor(w * dpr)) {
      cv.width = Math.floor(w * dpr);
      cv.height = Math.floor(h * dpr);
    }
    const g = cv.getContext("2d");
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);

    const amt = REACTIVITY / 100;
    if (amt <= 0.01) return;
    const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#54ADBD";
    const live = engine.playing && engine.getSpectrum(data.current);
    const t = performance.now() / 1000;

    const BARS = 96;
    const bw = w / BARS;
    g.fillStyle = accent;
    for (let i = 0; i < BARS; i++) {
      let v;
      if (live) {
        const j = Math.floor(Math.pow(i / BARS, 2.0) * 600);
        v = (data.current[j] || 0) / 255;
      } else {
        v = 0.12 + 0.1 * Math.sin(i * 0.35 + t * 0.5) * Math.sin(i * 0.071 - t * 0.23);
        v = Math.max(0, v);
      }
      const bh = v * h * 0.28 * amt * (live ? 1 : 0.5);
      g.globalAlpha = (live ? 0.05 : 0.03) + 0.04 * amt;
      g.fillRect(i * bw, h - bh, bw - 1.5, bh);
    }
    g.globalAlpha = 1;
  });

  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-0 h-full w-full"
    />
  );
}
