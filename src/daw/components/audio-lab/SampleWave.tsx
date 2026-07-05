// ── SAMPLE WAVE — the C4 waveform of a sample-source preset, with edit handles ──
// Static waveform of the preset's zone nearest C4 (the visual reference for the
// sample source). Draggable start/end handles set the playback window; when looping,
// draggable loop-start/loop-end handles set the sustain region. Zoomable: wheel to zoom
// around the cursor, shift-wheel or drag-the-background to pan, double-click to reset.

import { useEffect, useRef } from "react";
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from "react";
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
  height = 64,
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
  useEffect(() => {
    engine.warmPreset(presetId);
  }, [presetId]);

  // non-passive wheel listener so zoom can preventDefault the page scroll
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const stop = (e: WheelEvent) => e.preventDefault();
    cv.addEventListener("wheel", stop, { passive: false });
    return () => cv.removeEventListener("wheel", stop);
  }, []);

  // loop region defaults to the playback window (matches the engine)
  const ls = loopStart ?? start;
  const le = loopEnd ?? end;
  // view window into the buffer (fractions). [0,1] = whole sample; wheel zooms in.
  const view = useRef({ v0: 0, v1: 1 });
  const drag = useRef<null | "start" | "end" | "loopStart" | "loopEnd" | "pan">(null);
  const panFrom = useRef({ x: 0, v0: 0, v1: 1 });
  const live = useRef({ start, end, ls, le });
  useEffect(() => {
    live.current = { start, end, ls, le };
  }, [start, end, ls, le]);

  // map a buffer fraction → canvas x (0..w) through the current view, and back
  const fracToX = (f: number, w: number) => {
    const { v0, v1 } = view.current;
    return ((f - v0) / Math.max(1e-6, v1 - v0)) * w;
  };
  const xToFrac = (x: number, w: number) => {
    const { v0, v1 } = view.current;
    return v0 + (x / w) * (v1 - v0);
  };

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
    const { v0, v1 } = view.current;
    const peaks = zoneIdx >= 0 ? engine.presetPeaks(presetId, zoneIdx, Math.max(32, Math.floor(w)), v0, v1) : null;

    if (!peaks) {
      g.fillStyle = "#6a6a76";
      g.font = "9px ui-monospace, monospace";
      g.textAlign = "center";
      g.fillText("decoding sample…", w / 2, mid + 3);
      g.textAlign = "left";
      return;
    }
    const { start: a, end: b, ls: lsv, le: lev } = live.current;
    const xA = fracToX(a, w);
    const xB = fracToX(b, w);

    // dim the excluded regions (before start / after end), clamped to canvas
    g.fillStyle = "rgba(0,0,0,0.55)";
    if (xA > 0) g.fillRect(0, 0, Math.min(w, xA), h);
    if (xB < w) g.fillRect(Math.max(0, xB), 0, w - Math.max(0, xB), h);

    // loop-region shading inside the window
    if (loop) {
      g.fillStyle = "color-mix(in srgb, " + accent + " 14%, transparent)";
      const xls = fracToX(lsv, w);
      const xle = fracToX(lev, w);
      g.fillRect(xls, 0, xle - xls, h);
    }

    // center-mirrored waveform bars (peaks already cover just the view range)
    g.fillStyle = "#5a6f78";
    const bw = w / peaks.length;
    for (let i = 0; i < peaks.length; i++) {
      const ph = Math.max(1, peaks[i] * (h - 4));
      g.fillRect(i * bw, mid - ph / 2, Math.max(1, bw - 0.5), ph);
    }

    // zero line
    g.strokeStyle = "rgba(255,255,255,0.06)";
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(0, mid);
    g.lineTo(w, mid);
    g.stroke();

    // handle bars: start/end (solid) + loop bounds (dashed when looping); only if in view
    const bar = (f: number, color: string, dash = false) => {
      const x = fracToX(f, w);
      if (x < -1 || x > w + 1) return;
      g.strokeStyle = color;
      g.lineWidth = 1.5;
      if (dash) g.setLineDash([3, 3]);
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, h);
      g.stroke();
      g.setLineDash([]);
    };
    bar(a, accent);
    bar(b, accent);
    if (loop) {
      const dim = "color-mix(in srgb, " + accent + " 55%, transparent)";
      bar(lsv, dim, true);
      bar(lev, dim, true);
    }

    // zoom indicator when zoomed in
    if (v1 - v0 < 0.999) {
      g.fillStyle = "rgba(255,255,255,0.35)";
      g.font = "8px ui-monospace, monospace";
      g.textAlign = "right";
      g.fillText(Math.round(1 / (v1 - v0)) + "×", w - 4, 10);
      g.textAlign = "left";
    }
  });

  const localX = (e: ReactPointerEvent<HTMLCanvasElement> | ReactWheelEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, w: r.width };
  };

  const down = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!onEdit) return;
    const { x, w } = localX(e);
    const f = xToFrac(x, w);
    const { start: a, end: b, ls: lsv, le: lev } = live.current;
    // pick the nearest handle within a px threshold (converted to fractions via the view)
    const grabFrac = (12 / w) * (view.current.v1 - view.current.v0);
    const cands: [Exclude<typeof drag.current, null | "pan">, number][] = [["start", a], ["end", b]];
    if (loop) cands.push(["loopStart", lsv], ["loopEnd", lev]);
    let best: typeof drag.current = null;
    let bestD = grabFrac;
    for (const [name, pos] of cands) {
      const d = Math.abs(f - pos);
      if (d < bestD) { bestD = d; best = name; }
    }
    if (!best) {
      // background → pan (only useful when zoomed in)
      drag.current = "pan";
      panFrom.current = { x, v0: view.current.v0, v1: view.current.v1 };
    } else {
      drag.current = best;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const move = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drag.current) return;
    const { x, w } = localX(e);
    if (drag.current === "pan") {
      const span = panFrom.current.v1 - panFrom.current.v0;
      const dv = ((panFrom.current.x - x) / w) * span;
      const nv0 = Math.max(0, Math.min(1 - span, panFrom.current.v0 + dv));
      view.current = { v0: nv0, v1: nv0 + span };
      return;
    }
    if (!onEdit) return;
    const f = Math.min(1, Math.max(0, xToFrac(x, w)));
    const { start: a, end: b, ls: lsv, le: lev } = live.current;
    if (drag.current === "start") onEdit({ start: Math.min(f, b - 0.01) });
    else if (drag.current === "end") onEdit({ end: Math.max(f, a + 0.01) });
    else if (drag.current === "loopStart") onEdit({ loopStart: Math.min(Math.max(f, a), lev - 0.01) });
    else if (drag.current === "loopEnd") onEdit({ loopEnd: Math.max(Math.min(f, b), lsv + 0.01) });
  };

  const up = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    drag.current = null;
    if (e.currentTarget.hasPointerCapture?.(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  // wheel: zoom around the cursor (shift = pan instead). Non-passive via onWheel.
  const wheel = (e: ReactWheelEvent<HTMLCanvasElement>) => {
    const { x, w } = localX(e);
    const { v0, v1 } = view.current;
    const span = v1 - v0;
    if (e.shiftKey) {
      const dv = (e.deltaY / w) * span;
      const nv0 = Math.max(0, Math.min(1 - span, v0 + dv));
      view.current = { v0: nv0, v1: nv0 + span };
      return;
    }
    const cursor = v0 + (x / w) * span; // buffer frac under the cursor (anchor)
    const factor = e.deltaY > 0 ? 1.2 : 1 / 1.2; // out / in
    const nspan = Math.min(1, Math.max(0.002, span * factor)); // cap max zoom at 500×
    const nv0 = Math.max(0, Math.min(1 - nspan, cursor - (x / w) * nspan));
    view.current = { v0: nv0, v1: nv0 + nspan };
  };

  const reset = () => { view.current = { v0: 0, v1: 1 }; };

  return (
    <canvas
      ref={ref}
      className={"w-full rounded-[3px] border border-line bg-[#0c0c10] " + (onEdit ? "cursor-ew-resize touch-none" : "")}
      style={{ height }}
      title="wheel = zoom · shift-wheel or drag = pan · double-click = reset · drag bars = start/end (+ loop when looping)"
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onWheel={wheel}
      onDoubleClick={reset}
    />
  );
}
