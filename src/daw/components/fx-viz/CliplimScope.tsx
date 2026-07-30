// Scrolling in/out peak scope for CLIPLIM — blue input · green output · ceiling line.

import { useRef } from "react";
import { useRafLoop } from "../../hooks/useRafLoop";
import type { FxVizSlot } from "../../spectral-viz";
import { VIZ_DRY, VIZ_WET } from "./fx-viz-colors";

export function CliplimScope({
  deviceId,
  readViz,
  ceilingDb,
  enabled,
  height = 88,
}: {
  deviceId: string;
  readViz: (id: string) => FxVizSlot | null;
  ceilingDb: number;
  enabled: boolean;
  height?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useRafLoop(() => {
    const cv = ref.current;
    if (!cv || !enabled) return;
    const slot = readViz(deviceId);
    if (!slot || slot.n <= 0) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = cv.clientWidth;
    const h = cv.clientHeight;
    if (w < 2 || h < 2) return;
    if (cv.width !== Math.floor(w * dpr) || cv.height !== Math.floor(h * dpr)) {
      cv.width = Math.floor(w * dpr);
      cv.height = Math.floor(h * dpr);
    }
    const g = cv.getContext("2d");
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);

    const pad = 4;
    const x0 = pad;
    const x1 = w - pad;
    const y0 = pad;
    const y1 = h - pad;
    const n = slot.n;
    const ceilLin = Math.pow(10, Math.max(-48, Math.min(0, ceilingDb)) / 20);

    const yFor = (v: number) => y1 - Math.max(0, Math.min(1, v)) * (y1 - y0);

    // ceiling
    const cy = yFor(ceilLin);
    g.strokeStyle = "rgba(255,80,80,0.45)";
    g.lineWidth = 1;
    g.setLineDash([3, 3]);
    g.beginPath();
    g.moveTo(x0, cy);
    g.lineTo(x1, cy);
    g.stroke();
    g.setLineDash([]);

    const stroke = (arr: Float32Array, color: string, width: number) => {
      g.strokeStyle = color;
      g.lineWidth = width;
      g.beginPath();
      for (let i = 0; i < n; i++) {
        const px = x0 + (i / Math.max(1, n - 1)) * (x1 - x0);
        const py = yFor(arr[i] ?? 0);
        if (i === 0) g.moveTo(px, py);
        else g.lineTo(px, py);
      }
      g.stroke();
    };
    stroke(slot.a, VIZ_DRY, 1.4);
    stroke(slot.b, VIZ_WET, 1.6);

    g.font = "8px JetBrains Mono, ui-monospace, monospace";
    g.fillStyle = VIZ_DRY;
    g.textAlign = "left";
    g.textBaseline = "top";
    g.fillText("in", x0 + 2, y0);
    g.fillStyle = VIZ_WET;
    g.fillText("out", x0 + 18, y0);
    g.fillStyle = "rgba(255,80,80,0.7)";
    g.textAlign = "right";
    g.fillText(ceilingDb.toFixed(1) + " dB", x1 - 2, y0);
  });

  return (
    <canvas
      ref={ref}
      className="w-full rounded-[3px] border border-line bg-[#0c0c10]"
      style={{ height }}
      title="Input vs output peaks — red dashed = ceiling"
    />
  );
}
