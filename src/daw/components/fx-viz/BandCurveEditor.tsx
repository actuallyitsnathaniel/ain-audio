import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { useRafLoop } from "../../hooks/useRafLoop";
import type { FxVizSlot } from "../../spectral-viz";
import {
  DYN_DB_MAX,
  DYN_DB_MIN,
  FREQ_MAX,
  FREQ_MIN,
  GAIN_MAX,
  GAIN_MIN,
  clampFreq,
  dbToY,
  defaultEqBand,
  defaultSpecCurve,
  eqResponseCurve,
  freqToX,
  specThresholdAt,
  xToFreq,
  yToDb,
  type EqBand,
  type SpecCurve,
} from "../../eq-curve";
import { VIZ_DRY, VIZ_WET } from "./fx-viz-colors";

type DragKind = "move" | null;

/**
 * Pro-Q–inspired interactive analyzer:
 * - click empty space → add node
 * - drag node → freq + gain/threshold
 * - wheel on node → Q
 * - double-click node → remove
 *
 * `mode: "eq"` draws static response + gain handles.
 * `mode: "speccomp"` draws threshold handles + RTA/GR from the worklet.
 */
export function BandCurveEditor({
  mode,
  deviceId,
  readViz,
  enabled,
  height = 160,
  // EQ
  bands,
  onBandsChange,
  // SPECCOMP
  curves,
  onCurvesChange,
  globalThreshold = -24,
  globalTilt = 0,
  selectedId,
  onSelect,
}: {
  mode: "eq" | "speccomp";
  deviceId?: string;
  readViz?: (id: string) => FxVizSlot | null;
  enabled: boolean;
  height?: number;
  bands?: EqBand[];
  onBandsChange?: (bands: EqBand[]) => void;
  curves?: SpecCurve[];
  onCurvesChange?: (curves: SpecCurve[]) => void;
  globalThreshold?: number;
  globalTilt?: number;
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [localSel, setLocalSel] = useState<string | null>(null);
  const sel = selectedId !== undefined ? selectedId : localSel;
  const drag = useRef<{ id: string; kind: DragKind } | null>(null);
  const minDb = mode === "eq" ? GAIN_MIN : DYN_DB_MIN;
  const maxDb = mode === "eq" ? GAIN_MAX : DYN_DB_MAX;

  const select = (id: string | null) => {
    if (selectedId === undefined) setLocalSel(id);
    onSelect?.(id);
  };

  // React's onWheel is passive — use a native listener so Q-scroll doesn't move the page
  useEffect(() => {
    const cv = ref.current;
    if (!cv || !enabled) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const id = selectedId !== undefined ? selectedId : localSel;
      if (!id) return;
      const delta = e.deltaY > 0 ? -0.08 : 0.08;
      if (mode === "eq" && onBandsChange && bands) {
        onBandsChange(
          bands.map((b) =>
            b.id === id ? { ...b, q: Math.min(8, Math.max(0.15, b.q + delta)) } : b,
          ),
        );
      } else if (mode === "speccomp" && onCurvesChange && curves) {
        onCurvesChange(
          curves.map((c) =>
            c.id === id ? { ...c, q: Math.min(8, Math.max(0.15, c.q + delta)) } : c,
          ),
        );
      }
    };
    cv.addEventListener("wheel", onWheel, { passive: false });
    return () => cv.removeEventListener("wheel", onWheel);
  }, [
    enabled,
    mode,
    selectedId,
    localSel,
    bands,
    curves,
    onBandsChange,
    onCurvesChange,
  ]);

  const nodes: { id: string; freq: number; yDb: number; q: number; on: boolean }[] =
    mode === "eq"
      ? (bands ?? []).map((b) => ({
          id: b.id,
          freq: b.freq,
          yDb: b.gain,
          q: b.q,
          on: b.on,
        }))
      : (curves ?? []).map((c) => ({
          id: c.id,
          freq: c.freq,
          yDb: c.threshold,
          q: c.q,
          on: c.on,
        }));

  const hitTest = (x: number, y: number, w: number, h: number): string | null => {
    let best: string | null = null;
    let bestD = 14;
    for (const n of nodes) {
      const nx = freqToX(n.freq, w);
      const ny = dbToY(n.yDb, h, minDb, maxDb);
      const d = Math.hypot(nx - x, ny - y);
      if (d < bestD) {
        bestD = d;
        best = n.id;
      }
    }
    return best;
  };

  useRafLoop(() => {
    const cv = ref.current;
    if (!cv || !enabled) return;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, cv.clientWidth);
    const h = Math.max(1, cv.clientHeight);
    if (cv.width !== Math.floor(w * dpr) || cv.height !== Math.floor(h * dpr)) {
      cv.width = Math.floor(w * dpr);
      cv.height = Math.floor(h * dpr);
    }
    const g = cv.getContext("2d");
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    g.fillStyle = "#08080a";
    g.fillRect(0, 0, w, h);

    const accent = getComputedStyle(cv).getPropertyValue("--accent").trim() || "#54ADBD";
    // SPECCOMP dry/wet: cool blue = input (untouched), muted green = GR / tuned.
    // Brand cyan stays on EQ + controls; this pair is only for spectral dynamics.
    const DRY = VIZ_DRY;
    const WET = VIZ_WET;
    const padL = 22;
    const padB = 14;
    const plotW = w - padL;
    const plotH = h - padB;

    g.fillStyle = "#0a0a0e";
    g.fillRect(padL, 0, plotW, plotH);

    // grid
    g.strokeStyle = mode === "eq" ? "rgba(50,50,58,0.7)" : "rgba(36,36,41,0.9)";
    g.lineWidth = 1;
    for (const hz of [100, 1000, 10000]) {
      const x = padL + freqToX(hz, plotW);
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, plotH);
      g.stroke();
    }
    const zeroY = dbToY(0, plotH, minDb, maxDb);
    g.strokeStyle = mode === "eq" ? "rgba(142,142,152,0.45)" : "rgba(50,50,58,0.9)";
    g.beginPath();
    g.moveTo(padL, zeroY);
    g.lineTo(w, zeroY);
    g.stroke();

    // axis labels (dB + freq) — shared chrome for EQ + SPECCOMP
    g.fillStyle = "#5c5c66";
    g.font = "8px JetBrains Mono, ui-monospace, monospace";
    g.textAlign = "right";
    const dbTicks = mode === "eq" ? [12, 0, -12] : [0, -24, -48];
    for (const db of dbTicks) {
      const y = dbToY(db, plotH, minDb, maxDb);
      g.fillText((db > 0 ? "+" : "") + db, padL - 3, y + 3);
    }
    g.textAlign = "center";
    for (const [hz, lab] of [
      [100, "100"],
      [1000, "1k"],
      [10000, "10k"],
    ] as const) {
      g.fillText(lab, padL + freqToX(hz, plotW), h - 3);
    }
    g.textAlign = "left";

    // RTA behind the curve
    if (deviceId && readViz) {
      const slot = readViz(deviceId);
      if (slot && slot.n > 0 && (slot.kind === mode || (mode === "eq" && slot.kind === "eq"))) {
        const n = slot.n;
        const gap = 1;
        const bw = Math.max(1, (plotW - gap * (n + 1)) / n);
        for (let i = 0; i < n; i++) {
          const env = slot.a[i] ?? 0;
          const gr = slot.b[i] ?? 0;
          const x = padL + gap + i * (bw + gap);
          if (mode === "eq") {
            // spectrum as soft fill from 0dB downward (pre-EQ energy), not accent bars
            const barH = Math.max(1, env * (plotH - zeroY) * 0.95);
            g.globalAlpha = 0.22;
            g.fillStyle = "#8e8e98";
            g.fillRect(x, zeroY, bw, barH);
            // dyn engagement flash
            if (gr > 0.05) {
              g.globalAlpha = 0.35 + gr * 0.45;
              g.fillStyle = accent;
              g.fillRect(x, zeroY - 2, bw, 3);
            }
          } else {
            // a = dry input (−60..0 → 0..1); b = GR (0..1 ≈ 0..24 dB).
            // Blue = dry; green = wet (post-GR level). Green always shows with signal;
            // blue peeks above green when compressing.
            const dryT = Math.min(1, Math.max(0, env));
            const grDb = Math.min(24, Math.max(0, gr * 24));
            const dryDb = minDb + dryT * (maxDb - minDb);
            const wetDb = Math.max(minDb, dryDb - grDb);
            const wetT = (wetDb - minDb) / (maxDb - minDb);
            const dryTop = plotH * (1 - dryT);
            const wetTop = plotH * (1 - Math.min(1, Math.max(0, wetT)));
            const dryH = Math.max(1, plotH - dryTop);
            const wetH = Math.max(1, plotH - wetTop);
            // dry (full input) — only the tip peeks when GR is active
            g.globalAlpha = 0.5;
            g.fillStyle = DRY;
            g.fillRect(x, dryTop, bw, dryH);
            // wet (post-GR) — primary visible color
            g.globalAlpha = 0.88;
            g.fillStyle = WET;
            g.fillRect(x, wetTop, bw, wetH);
          }
        }
        g.globalAlpha = 1;
      }
    }

    // SPECCOMP: dashed global thresh (dry blue) + solid effective (wet green)
    if (mode === "speccomp") {
      g.beginPath();
      for (let i = 0; i <= 64; i++) {
        const t = i / 64;
        const freq = FREQ_MIN * Math.pow(FREQ_MAX / FREQ_MIN, t);
        const bandT = t * 2 - 1;
        const thr = globalThreshold + globalTilt * bandT * 12;
        const x = padL + freqToX(freq, plotW);
        const y = dbToY(thr, plotH, minDb, maxDb);
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.strokeStyle = "rgba(74,122,176,0.45)";
      g.setLineDash([3, 3]);
      g.lineWidth = 1;
      g.stroke();
      g.setLineDash([]);

      const hasNodes = !!(curves && curves.some((c) => c.on));
      g.beginPath();
      for (let i = 0; i <= 96; i++) {
        const t = i / 96;
        const freq = FREQ_MIN * Math.pow(FREQ_MAX / FREQ_MIN, t);
        const bandT = t * 2 - 1;
        const { threshold: thr } = specThresholdAt(
          freq,
          globalThreshold,
          globalTilt,
          bandT,
          curves ?? [],
        );
        const x = padL + freqToX(freq, plotW);
        const y = dbToY(thr, plotH, minDb, maxDb);
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.strokeStyle = WET;
      g.globalAlpha = 1;
      g.lineWidth = hasNodes ? 2.25 : 1.75;
      g.stroke();
      // soft fill above threshold (compression region)
      g.lineTo(w, 0);
      g.lineTo(padL, 0);
      g.closePath();
      g.fillStyle = WET;
      g.globalAlpha = hasNodes ? 0.14 : 0.08;
      g.fill();
      g.globalAlpha = 1;
    }

    // EQ composite response (accurate biquad magnitude)
    if (mode === "eq" && bands && bands.length) {
      const curve = eqResponseCurve(bands, 128);
      g.beginPath();
      for (let i = 0; i < curve.freqs.length; i++) {
        const x = padL + freqToX(curve.freqs[i], plotW);
        const y = dbToY(curve.db[i], plotH, minDb, maxDb);
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.strokeStyle = accent;
      g.lineWidth = 2;
      g.stroke();
      g.lineTo(w, zeroY);
      g.lineTo(padL, zeroY);
      g.closePath();
      g.fillStyle = accent;
      g.globalAlpha = 0.16;
      g.fill();
      g.globalAlpha = 1;
    }

    // node handles
    for (const n of nodes) {
      const band = mode === "eq" ? bands?.find((b) => b.id === n.id) : null;
      const curve = mode === "speccomp" ? curves?.find((c) => c.id === n.id) : null;
      const x = padL + freqToX(n.freq, plotW);
      const y = dbToY(n.yDb, plotH, minDb, maxDb);
      const active = n.id === sel;
      const dimmed =
        mode === "eq" &&
        bands?.some((b) => b.on && b.solo) &&
        band &&
        !band.solo;

      // EQ dyn: ghost target at gain+range
      if (mode === "eq" && band?.dyn && active) {
        const ty = dbToY(
          Math.min(GAIN_MAX, Math.max(GAIN_MIN, band.gain + band.dynRange)),
          plotH,
          minDb,
          maxDb,
        );
        g.strokeStyle = accent;
        g.globalAlpha = 0.45;
        g.setLineDash([2, 3]);
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x, ty);
        g.stroke();
        g.setLineDash([]);
        g.beginPath();
        g.arc(x, ty, 3, 0, Math.PI * 2);
        g.stroke();
        g.globalAlpha = 1;
      }

      // SPECCOMP: ghost at threshold − range (max GR this node allows)
      if (mode === "speccomp" && curve && active && curve.on) {
        const ty = dbToY(
          Math.min(DYN_DB_MAX, Math.max(DYN_DB_MIN, curve.threshold - curve.range)),
          plotH,
          minDb,
          maxDb,
        );
        g.strokeStyle = "#e8c070";
        g.globalAlpha = 0.5;
        g.setLineDash([2, 3]);
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x, ty);
        g.stroke();
        g.setLineDash([]);
        g.beginPath();
        g.arc(x, ty, 3, 0, Math.PI * 2);
        g.stroke();
        g.globalAlpha = 1;
      }

      g.fillStyle = n.on ? accent : "#5c5c66";
      g.globalAlpha = !n.on ? 0.45 : dimmed ? 0.25 : 1;
      g.beginPath();
      if (mode === "eq") {
        // shape-coded handles: square shelf, diamond cut, circle bell
        const shape = band?.shape ?? "bell";
        const r = active ? 5.5 : 4.5;
        if (shape === "lowshelf" || shape === "highshelf" || shape === "tilt") {
          g.rect(x - r, y - r, r * 2, r * 2);
        } else if (shape === "lowcut" || shape === "highcut" || shape === "notch" || shape === "bandpass") {
          g.moveTo(x, y - r);
          g.lineTo(x + r, y);
          g.lineTo(x, y + r);
          g.lineTo(x - r, y);
          g.closePath();
        } else {
          g.arc(x, y, r, 0, Math.PI * 2);
        }
        g.fill();
        if (band?.dyn) {
          g.strokeStyle = "#e8c070";
          g.lineWidth = 1.5;
          g.stroke();
        }
      } else {
        g.fillStyle = n.on ? WET : "#5c5c66";
        g.globalAlpha = n.on ? 1 : 0.45;
        g.beginPath();
        g.arc(x, y, active ? 5.5 : 4, 0, Math.PI * 2);
        g.fill();
        // gold ring = has local range/ratio sculpting
        if (curve && curve.range > 0) {
          g.strokeStyle = "#e8c070";
          g.lineWidth = 1.25;
          g.stroke();
        }
      }
      g.globalAlpha = 1;
      if (active) {
        g.strokeStyle = "#d8d8dc";
        g.lineWidth = 1.25;
        g.stroke();
      }
      const qSpan = Math.min(80, 28 / Math.max(0.2, n.q));
      g.strokeStyle = n.on ? (mode === "speccomp" ? WET : accent) : "#5c5c66";
      g.globalAlpha = 0.35;
      g.beginPath();
      g.moveTo(x - qSpan, y);
      g.lineTo(x + qSpan, y);
      g.stroke();
      g.globalAlpha = 1;
    }

    g.fillStyle = "#5c5c66";
    g.font = "9px JetBrains Mono, ui-monospace, monospace";
    if (mode === "eq") {
      g.fillText("dbl-click empty = add · Delete = remove · gold = dyn", padL + 4, 11);
    } else {
      // always-on color key (so wet green is visible even before audio)
      g.fillStyle = DRY;
      g.fillRect(padL + 4, 4, 8, 8);
      g.fillStyle = WET;
      g.fillRect(padL + 16, 4, 8, 8);
      g.fillStyle = "#8e8e98";
      g.fillText("dry / wet · gold = range", padL + 28, 11);
    }
  });

  const plotGeom = (cv: HTMLCanvasElement) => {
    const r = cv.getBoundingClientRect();
    const padL = 22;
    const padB = 14;
    return {
      r,
      padL,
      padB,
      plotW: r.width - padL,
      plotH: r.height - padB,
    };
  };

  const removeId = (id: string) => {
    if (mode === "eq" && onBandsChange && bands) {
      onBandsChange(bands.filter((b) => b.id !== id));
    } else if (mode === "speccomp" && onCurvesChange && curves) {
      onCurvesChange(curves.filter((c) => c.id !== id));
    }
    if (sel === id) select(null);
  };

  // Delete / Backspace removes the selected node (when not typing in an input)
  useEffect(() => {
    if (!enabled || !sel) return;
    const id = sel;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      e.preventDefault();
      if (mode === "eq" && onBandsChange && bands) {
        onBandsChange(bands.filter((b) => b.id !== id));
      } else if (mode === "speccomp" && onCurvesChange && curves) {
        onCurvesChange(curves.filter((c) => c.id !== id));
      }
      if (selectedId === undefined) setLocalSel(null);
      onSelect?.(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    enabled,
    sel,
    mode,
    bands,
    curves,
    onBandsChange,
    onCurvesChange,
    selectedId,
    onSelect,
  ]);

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!enabled) return;
    e.preventDefault();
    const cv = ref.current;
    if (!cv) return;
    const { r, padL, plotW, plotH } = plotGeom(cv);
    const x = e.clientX - r.left - padL;
    const y = e.clientY - r.top;
    if (x < 0 || y > plotH) return;
    const hit = hitTest(x, y, plotW, plotH);
    if (hit) {
      if (e.altKey) {
        removeId(hit);
        return;
      }
      select(hit);
      drag.current = { id: hit, kind: "move" };
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }
    // empty click: deselect only (add is double-click)
    select(null);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drag.current || drag.current.kind !== "move") return;
    const cv = ref.current;
    if (!cv) return;
    const { r, padL, plotW, plotH } = plotGeom(cv);
    const x = e.clientX - r.left - padL;
    const y = e.clientY - r.top;
    const freq = clampFreq(xToFreq(x, plotW));
    const db = yToDb(y, plotH, minDb, maxDb);
    const id = drag.current.id;
    if (mode === "eq" && onBandsChange && bands) {
      onBandsChange(
        bands.map((b) =>
          b.id === id
            ? { ...b, freq, gain: Math.min(GAIN_MAX, Math.max(GAIN_MIN, db)) }
            : b,
        ),
      );
    } else if (mode === "speccomp" && onCurvesChange && curves) {
      onCurvesChange(
        curves.map((c) =>
          c.id === id
            ? {
                ...c,
                freq,
                threshold: Math.min(DYN_DB_MAX, Math.max(DYN_DB_MIN, db)),
              }
            : c,
        ),
      );
    }
  };

  const onPointerUp = () => {
    drag.current = null;
  };

  const onDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!enabled) return;
    e.preventDefault();
    const cv = ref.current;
    if (!cv) return;
    const { r, padL, plotW, plotH } = plotGeom(cv);
    const x = e.clientX - r.left - padL;
    const y = e.clientY - r.top;
    if (x < 0 || y > plotH) return;
    if (hitTest(x, y, plotW, plotH)) return; // handle dbl-click: ignore
    const freq = clampFreq(xToFreq(x, plotW));
    const db = yToDb(y, plotH, minDb, maxDb);
    if (mode === "eq" && onBandsChange && bands) {
      const b = defaultEqBand({ freq, gain: Math.min(GAIN_MAX, Math.max(GAIN_MIN, db)) });
      onBandsChange([...bands, b]);
      select(b.id);
    } else if (mode === "speccomp" && onCurvesChange && curves) {
      const c = defaultSpecCurve({
        freq,
        threshold: Math.min(DYN_DB_MAX, Math.max(DYN_DB_MIN, db)),
      });
      onCurvesChange([...curves, c]);
      select(c.id);
    }
  };

  return (
    <canvas
      ref={ref}
      tabIndex={-1}
      className="block w-full cursor-crosshair rounded-[3px] border border-line bg-inset [overflow-anchor:none]"
      style={{ height, touchAction: "none" }}
      data-tip={
        mode === "eq"
          ? "Parametric EQ — double-click empty space to add a band. Drag handles for freq/gain. Wheel = Q. Delete/Backspace or the del chip removes the selected band (⌥-click also deletes)."
          : "Spectral dynamics — blue = dry input, green = wet output (post-compression). When compressing, blue peeks above green. Double-click to add a threshold node."
      }
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
    />
  );
}
