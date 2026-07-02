// ── SAMPLE WAVE — the C4 waveform of a sample-source preset, with edit handles ──
// Static waveform of the preset's zone nearest C4 (the visual reference for the
// sample source). Draggable start/end handles set the playback window; when looping,
// draggable loop-start/loop-end handles set the sustain region inside it. Reuses the
// engine's cached peaks (presetPeaks) + the LoopWave canvas idiom.

import { useEffect, useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { engine } from "../../engine";
import { useRafLoop } from "../../hooks/useRafLoop";

type Edit = { start?: number; end?: number; loopStart?: number; loopEnd?: number };

export function SampleWave({
  presetId,
  loop,
  start = 0,
  end = 1,
  loopStart,
  loopEnd,
  onEdit,
  height = 52,
}: {
  presetId: string;
  loop: boolean;
  start?: number;
  end?: number;
  loopStart?: number;
  loopEnd?: number;
  onEdit?: (e: Edit) => void;
  height?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  // warm the preset so its zones decode → peaks become available
  useEffect(() => {
    engine.warmPreset(presetId);
  }, [presetId]);

  // loop region defaults to the playback window (matches the engine)
  const ls = loopStart ?? start;
  const le = loopEnd ?? end;
  // which handle is being dragged; ref so the pointer handlers stay stable
  const drag = useRef<null | "start" | "end" | "loopStart" | "loopEnd">(null);
  // latest bounds mirrored into a ref for the rAF draw + pointer handlers (assigned
  // in an effect, not during render — react-hooks purity)
  const live = useRef({ start, end, ls, le });
  useEffect(() => {
    live.current = { start, end, ls, le };
  }, [start, end, ls, le]);

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
    const mid = h / 2;
    const zoneIdx = engine.presetC4Zone(presetId);
    const peaks = zoneIdx >= 0 ? engine.presetPeaks(presetId, zoneIdx, Math.max(32, Math.floor(w))) : null;

    if (!peaks) {
      g.fillStyle = "#2a2a32";
      g.font = "9px ui-monospace, monospace";
      g.textAlign = "center";
      g.fillText("decoding sample…", w / 2, mid + 3);
      g.textAlign = "left";
      return;
    }
    const { start: a, end: b, ls: lsv, le: lev } = live.current;

    // dim the excluded regions (before start / after end)
    g.fillStyle = "rgba(0,0,0,0.55)";
    g.fillRect(0, 0, a * w, h);
    g.fillRect(b * w, 0, (1 - b) * w, h);

    // loop-region shading inside the window
    if (loop) {
      g.fillStyle = "color-mix(in srgb, " + accent + " 14%, transparent)";
      g.fillRect(lsv * w, 0, (lev - lsv) * w, h);
    }

    // center-mirrored waveform bars
    g.fillStyle = "#3a4a52";
    const bw = w / peaks.length;
    for (let i = 0; i < peaks.length; i++) {
      const ph = Math.max(1, peaks[i] * (h - 4));
      g.fillRect(i * bw, mid - ph / 2, Math.max(1, bw - 0.5), ph);
    }

    // handle bars: start/end (solid accent) + loop bounds (dashed, only when looping)
    const bar = (x: number, color: string, dash = false) => {
      g.strokeStyle = color;
      g.lineWidth = 1.5;
      if (dash) g.setLineDash([3, 3]);
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, h);
      g.stroke();
      g.setLineDash([]);
    };
    bar(Math.max(1, a * w), accent);
    bar(Math.min(w - 1, b * w), accent);
    if (loop) {
      const dim = "color-mix(in srgb, " + accent + " 55%, transparent)";
      bar(lsv * w, dim, true);
      bar(lev * w, dim, true);
    }
  });

  // pick the nearest handle within a small px threshold on pointer-down
  const pxToFrac = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  };
  const down = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!onEdit) return;
    const f = pxToFrac(e);
    const { start: a, end: b, ls: lsv, le: lev } = live.current;
    const cands: [typeof drag.current, number][] = [["start", a], ["end", b]];
    if (loop) cands.push(["loopStart", lsv], ["loopEnd", lev]);
    let best: typeof drag.current = null;
    let bestD = 0.04; // ~grab threshold in fractions
    for (const [name, pos] of cands) {
      const d = Math.abs(f - pos);
      if (d < bestD) { bestD = d; best = name; }
    }
    if (!best) return;
    drag.current = best;
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drag.current || !onEdit) return;
    const f = pxToFrac(e);
    const { start: a, end: b, ls: lsv, le: lev } = live.current;
    if (drag.current === "start") onEdit({ start: Math.min(f, b - 0.01) });
    else if (drag.current === "end") onEdit({ end: Math.max(f, a + 0.01) });
    else if (drag.current === "loopStart") onEdit({ loopStart: Math.min(Math.max(f, a), lev - 0.01) });
    else if (drag.current === "loopEnd") onEdit({ loopEnd: Math.max(Math.min(f, b), lsv + 0.01) });
  };
  const up = () => { drag.current = null; };

  return (
    <canvas
      ref={ref}
      className={"w-full rounded-[3px] border border-line bg-[#0c0c10] " + (onEdit ? "cursor-ew-resize touch-none" : "")}
      style={{ height }}
      title="drag the bars to set start / end (and loop region when looping)"
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
    />
  );
}
