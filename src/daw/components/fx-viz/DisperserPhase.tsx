// Phase-response assistant for DISPERSER — log-freq × unwrapped phase of the
// allpass cascade (RBJ coeffs, same maths as the live biquads). Param-driven;
// no analyser / worklet. Redraws via rAF so knob moves stay smooth.

import { useRef } from "react";
import { useRafLoop } from "../../hooks/useRafLoop";
import { disperserStageParams } from "../../fx-devices";
import { biquadPhaseRad } from "../audio-lab/filter-math";

const F_MIN = 20;
const F_MAX = 20000;
const SR = 44100;

function unwrapAlong(prev: number, next: number): number {
  let d = next - prev;
  while (d > Math.PI) {
    next -= 2 * Math.PI;
    d = next - prev;
  }
  while (d < -Math.PI) {
    next += 2 * Math.PI;
    d = next - prev;
  }
  return next;
}

export function DisperserPhase({
  on,
  freq,
  amount,
  enabled,
  height = 120,
}: {
  on: boolean;
  freq: number;
  amount: number;
  enabled: boolean;
  height?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useRafLoop(() => {
    const cv = ref.current;
    if (!cv || !enabled) return;

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
    const padL = 28;
    const padR = 6;
    const padT = 6;
    const padB = 16;
    const x0 = padL;
    const x1 = w - padR;
    const y0 = padT;
    const y1 = h - padB;

    const stages = disperserStageParams(on, freq, amount);
    const N = Math.max(64, Math.floor(x1 - x0));
    const phase = new Float32Array(N + 1);
    let prev = 0;
    for (let i = 0; i <= N; i++) {
      const f = F_MIN * Math.pow(F_MAX / F_MIN, i / N);
      let ph = 0;
      for (const s of stages) {
        ph += biquadPhaseRad("allpass", s.freq, s.q, f, SR);
      }
      if (i === 0) prev = ph;
      else ph = unwrapAlong(prev, ph);
      prev = ph;
      phase[i] = ph;
    }

    let lo = phase[0];
    let hi = phase[0];
    for (let i = 1; i <= N; i++) {
      if (phase[i] < lo) lo = phase[i];
      if (phase[i] > hi) hi = phase[i];
    }
    const span = Math.max(2 * Math.PI, hi - lo);
    const mid = (hi + lo) / 2;
    const yLo = mid - span * 0.55;
    const yHi = mid + span * 0.55;

    const xFor = (fHz: number) =>
      x0 + (Math.log2(fHz / F_MIN) / Math.log2(F_MAX / F_MIN)) * (x1 - x0);
    const yFor = (ph: number) => y0 + ((yHi - ph) / (yHi - yLo || 1)) * (y1 - y0);

    // π grid
    g.strokeStyle = "#1a1a22";
    g.lineWidth = 1;
    const k0 = Math.ceil(yLo / Math.PI);
    const k1 = Math.floor(yHi / Math.PI);
    for (let k = k0; k <= k1; k++) {
      const yy = yFor(k * Math.PI);
      if (yy < y0 || yy > y1) continue;
      g.beginPath();
      g.moveTo(x0, yy);
      g.lineTo(x1, yy);
      g.stroke();
    }

    // pin frequency
    const pinX = xFor(Math.max(F_MIN, Math.min(F_MAX, freq)));
    g.strokeStyle = "color-mix(in srgb, " + accent + " 35%, transparent)";
    g.beginPath();
    g.moveTo(pinX, y0);
    g.lineTo(pinX, y1);
    g.stroke();

    // fill toward 0 rad
    const yZero = yFor(0);
    g.beginPath();
    g.moveTo(x0, yZero);
    for (let i = 0; i <= N; i++) {
      g.lineTo(x0 + (i / N) * (x1 - x0), yFor(phase[i]));
    }
    g.lineTo(x1, yZero);
    g.closePath();
    g.fillStyle = "color-mix(in srgb, " + accent + " 14%, transparent)";
    g.fill();

    g.strokeStyle = on ? accent : "#3D6FA8";
    g.lineWidth = 1.6;
    g.lineJoin = "round";
    g.beginPath();
    for (let i = 0; i <= N; i++) {
      const px = x0 + (i / N) * (x1 - x0);
      const py = yFor(phase[i]);
      if (i === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
    g.stroke();

    g.fillStyle = "#555566";
    g.font = "8px JetBrains Mono, ui-monospace, monospace";
    g.textAlign = "right";
    g.textBaseline = "middle";
    // label a few π lines that fall in view
    for (const k of [0, 1, -1, 2, -2, 4, -4]) {
      const yy = yFor(k * Math.PI);
      if (yy < y0 + 4 || yy > y1 - 4) continue;
      g.fillText(k === 0 ? "0" : k === 1 ? "π" : k === -1 ? "−π" : k + "π", padL - 4, yy);
    }

    g.textAlign = "left";
    g.textBaseline = "alphabetic";
    g.fillStyle = "#666677";
    g.fillText("20", x0, h - 3);
    g.textAlign = "center";
    g.fillText("1k", xFor(1000), h - 3);
    g.textAlign = "right";
    g.fillText("20k", x1, h - 3);

    g.textAlign = "left";
    g.textBaseline = "top";
    g.fillStyle = accent;
    g.fillText("phase", x0 + 4, y0 + 2);
  });

  return (
    <canvas
      ref={ref}
      className="w-full rounded-[3px] border border-line bg-[#0c0c10]"
      style={{ height }}
      title="Allpass cascade phase vs frequency — pin marks the rotation center"
    />
  );
}
