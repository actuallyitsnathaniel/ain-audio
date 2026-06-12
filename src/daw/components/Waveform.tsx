import { useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { engine } from "../engine";
import { useRafLoop } from "../hooks/useRafLoop";
import { labDuration } from "../lab-time";

// Waveform with scrub. Decoded peaks once available; placeholder before.
export function Waveform({ height = 110 }: { height?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const scrub = useRef<number | null>(null);

  const seekFromEvent = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const cv = ref.current!;
    const rect = cv.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    return frac * labDuration();
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    scrub.current = seekFromEvent(e);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (scrub.current === null) return;
    scrub.current = seekFromEvent(e);
  };
  const onPointerUp = () => {
    if (scrub.current === null) return;
    const t = scrub.current;
    scrub.current = null;
    if (engine.ready) engine.seek(t);
  };

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

    const cs = getComputedStyle(cv);
    const accent = cs.getPropertyValue("--accent").trim() || "#54ADBD";
    const dur = labDuration();
    const pos = scrub.current !== null ? scrub.current : engine.getPosition();
    const frac = Math.min(1, pos / dur);

    const BINS = Math.max(220, Math.floor(w / 3));
    const peaks = engine.getPeaks(BINS);
    const mid = h / 2;

    for (let i = 0; i < BINS; i++) {
      const x = (i / BINS) * w;
      const p = peaks ? peaks[i] : 0.22 + 0.16 * Math.abs(Math.sin(i * 0.21) * Math.sin(i * 0.043));
      const bh = Math.max(1.5, p * (h - 10));
      const played = i / BINS <= frac;
      g.fillStyle = played ? accent : "rgba(255,255,255,0.16)";
      g.globalAlpha = played ? 0.95 : 1;
      g.fillRect(x, mid - bh / 2, Math.max(1, w / BINS - 1), bh);
    }
    g.globalAlpha = 1;

    const phx = frac * w;
    g.fillStyle = "#fff";
    g.fillRect(phx - 0.5, 0, 1, h);
  });

  return (
    <canvas
      ref={ref}
      className="w-full cursor-crosshair rounded-[3px] border border-line bg-inset"
      style={{ touchAction: "none", height }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    />
  );
}
