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
    const padL = mode === "eq" ? 22 : 0;
    const padB = mode === "eq" ? 14 : 0;
    const plotW = w - padL;
    const plotH = h - padB;

    // EQ: muted plot well; SPECCOMP: flat inset (already bg)
    if (mode === "eq") {
      g.fillStyle = "#0a0a0e";
      g.fillRect(padL, 0, plotW, plotH);
    }

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

    // EQ axis labels
    if (mode === "eq") {
      g.fillStyle = "#5c5c66";
      g.font = "8px JetBrains Mono, ui-monospace, monospace";
      g.textAlign = "right";
      for (const db of [12, 0, -12]) {
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
    }

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
            const barH = Math.max(1, env * (plotH - 4));
            g.globalAlpha = 0.35;
            g.fillStyle = accent;
            g.fillRect(x, plotH - barH - 1, bw, barH);
            if (gr > 0.02) {
              g.fillStyle = "rgba(12,12,14,0.55)";
              g.fillRect(x, plotH - barH - 1, bw, barH * Math.min(1, gr));
            }
          }
        }
        g.globalAlpha = 1;
      }
    }

    // SPECCOMP: dashed global thresh + solid effective thresh
    if (mode === "speccomp") {
      g.beginPath();
      for (let i = 0; i <= 64; i++) {
        const t = i / 64;
        const freq = FREQ_MIN * Math.pow(FREQ_MAX / FREQ_MIN, t);
        const bandT = t * 2 - 1;
        const thr = globalThreshold + globalTilt * bandT * 12;
        const x = freqToX(freq, plotW);
        const y = dbToY(thr, plotH, minDb, maxDb);
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.strokeStyle = "rgba(142,142,152,0.35)";
      g.setLineDash([3, 3]);
      g.lineWidth = 1;
      g.stroke();
      g.setLineDash([]);

      if (curves && curves.length) {
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
            curves,
          );
          const x = freqToX(freq, plotW);
          const y = dbToY(thr, plotH, minDb, maxDb);
          if (i === 0) g.moveTo(x, y);
          else g.lineTo(x, y);
        }
        g.strokeStyle = accent;
        g.globalAlpha = 0.75;
        g.lineWidth = 1.25;
        g.stroke();
        g.globalAlpha = 1;
      }
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
        g.arc(x, y, active ? 5.5 : 4, 0, Math.PI * 2);
        g.fill();
      }
      g.globalAlpha = 1;
      if (active) {
        g.strokeStyle = "#d8d8dc";
        g.lineWidth = 1.25;
        g.stroke();
      }
      const qSpan = Math.min(80, 28 / Math.max(0.2, n.q));
      g.strokeStyle = n.on ? accent : "#5c5c66";
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
      g.fillText("DYN · dbl-click empty = add · Delete = remove · wheel Q", 4, 11);
    }
  });

  const plotGeom = (cv: HTMLCanvasElement) => {
    const r = cv.getBoundingClientRect();
    const padL = mode === "eq" ? 22 : 0;
    const padB = mode === "eq" ? 14 : 0;
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
          : "Spectral dynamics — double-click empty space to add a threshold node. Drag, wheel for Q. Delete/Backspace or del chip removes the selection (⌥-click also deletes)."
      }
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
    />
  );
}
