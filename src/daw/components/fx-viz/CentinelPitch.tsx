// Auto-Tune–style scrolling pitch graph for CENTINEL.
// Blue = detected · green = scale target · accent = corrected output.

import { useRef } from "react";
import { useRafLoop } from "../../hooks/useRafLoop";
import type { FxVizSlot } from "../../spectral-viz";
import { VIZ_DRY, VIZ_WET } from "./fx-viz-colors";

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const MIDI_LO = 36;
const MIDI_HI = 84;

function midiFromNorm(n: number): number {
  return MIDI_LO + n * (MIDI_HI - MIDI_LO);
}

export function CentinelPitch({
  deviceId,
  readViz,
  enabled,
  height = 140,
}: {
  deviceId: string;
  readViz: (id: string) => FxVizSlot | null;
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

    const accent = getComputedStyle(cv).getPropertyValue("--accent").trim() || "#54adbd";
    const padL = 26;
    const padR = 6;
    const padT = 14;
    const padB = 4;
    const x0 = padL;
    const x1 = w - padR;
    const y0 = padT;
    const y1 = h - padB;
    const n = slot.n;

    const yFor = (norm: number) => y1 - Math.max(0, Math.min(1, norm)) * (y1 - y0);

    g.strokeStyle = "#16161c";
    g.lineWidth = 1;
    for (let m = MIDI_LO; m <= MIDI_HI; m++) {
      if (m % 12 !== 0 && m % 12 !== 5) continue;
      const yy = yFor((m - MIDI_LO) / (MIDI_HI - MIDI_LO));
      g.beginPath();
      g.moveTo(x0, yy);
      g.lineTo(x1, yy);
      g.stroke();
    }

    const strokeSeries = (arr: Float32Array, color: string, width: number) => {
      g.strokeStyle = color;
      g.lineWidth = width;
      g.lineJoin = "round";
      g.beginPath();
      for (let i = 0; i < n; i++) {
        const px = x0 + (i / Math.max(1, n - 1)) * (x1 - x0);
        const py = yFor(arr[i] ?? 0);
        if (i === 0) g.moveTo(px, py);
        else g.lineTo(px, py);
      }
      g.stroke();
    };

    // target (green staircase-ish) under detected
    strokeSeries(slot.b, VIZ_WET, 1.3);
    // detected (blue)
    strokeSeries(slot.a, VIZ_DRY, 1.5);
    // corrected output (accent) on top
    strokeSeries(slot.xa, accent, 1.8);

    const det = midiFromNorm(slot.a[n - 1] ?? 0.5);
    const out = midiFromNorm(slot.xa[n - 1] ?? slot.a[n - 1] ?? 0.5);
    const note = NOTE_NAMES[((Math.round(out) % 12) + 12) % 12];
    const cents = Math.round((out - Math.round(out)) * 100);
    const centsStr = (cents >= 0 ? "+" : "") + cents;
    const err = Math.round((out - det) * 100);

    g.font = "8px JetBrains Mono, ui-monospace, monospace";
    g.textAlign = "left";
    g.textBaseline = "top";
    g.fillStyle = VIZ_DRY;
    g.fillText("in", x0 + 4, 2);
    g.fillStyle = VIZ_WET;
    g.fillText("tgt", x0 + 22, 2);
    g.fillStyle = accent;
    g.fillText("out", x0 + 44, 2);

    g.fillStyle = "#aaaabb";
    g.textAlign = "right";
    g.fillText(
      note + " " + centsStr + "¢  corr " + (err >= 0 ? "+" : "") + err + "¢",
      x1 - 2,
      2,
    );

    g.fillStyle = "#555566";
    g.textAlign = "right";
    g.textBaseline = "middle";
    for (const m of [48, 60, 72]) {
      const yy = yFor((m - MIDI_LO) / (MIDI_HI - MIDI_LO));
      g.fillText(NOTE_NAMES[m % 12] + (Math.floor(m / 12) - 1), padL - 4, yy);
    }
  });

  return (
    <canvas
      ref={ref}
      className="w-full rounded-[3px] border border-line bg-[#0c0c10]"
      style={{ height }}
      data-tip="Pitch graph — blue = detected f0 · green = scale target · accent = hard-snapped output"
    />
  );
}
