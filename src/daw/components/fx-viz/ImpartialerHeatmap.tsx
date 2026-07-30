import { useRef } from "react";
import { useRafLoop } from "../../hooks/useRafLoop";
import type { FxVizSlot } from "../../spectral-viz";

function parseAccent(cv: HTMLElement): [number, number, number] {
  const raw = getComputedStyle(cv).getPropertyValue("--accent").trim() || "#54ADBD";
  if (raw.startsWith("#") && raw.length >= 7) {
    return [
      parseInt(raw.slice(1, 3), 16),
      parseInt(raw.slice(3, 5), 16),
      parseInt(raw.slice(5, 7), 16),
    ];
  }
  return [84, 173, 189];
}

/**
 * Scrolling dry/wet spectral heatmap for IMPARTIALER.
 * X = time, Y = log-freq. Cool/faint = dry, accent = wet.
 */
export function ImpartialerHeatmap({
  deviceId,
  readViz,
  enabled,
  height = 72,
}: {
  deviceId: string;
  readViz: (id: string) => FxVizSlot | null;
  enabled: boolean;
  height?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const lastGen = useRef(-1);
  const pixels = useRef<ImageData | null>(null);

  useRafLoop(() => {
    const cv = ref.current;
    if (!cv || !enabled) return;
    const dpr = window.devicePixelRatio || 1;
    const cssW = Math.max(1, cv.clientWidth);
    const cssH = Math.max(1, cv.clientHeight);
    const pw = Math.floor(cssW * dpr);
    const ph = Math.floor(cssH * dpr);
    if (cv.width !== pw || cv.height !== ph) {
      cv.width = pw;
      cv.height = ph;
      pixels.current = null;
    }
    const g = cv.getContext("2d");
    if (!g) return;
    // ImageData is device-pixel sized — identity transform
    g.setTransform(1, 0, 0, 1, 0, 0);

    const slot = readViz(deviceId);
    if (!slot || slot.kind !== "impartialer" || slot.n <= 0) {
      g.fillStyle = "#08080a";
      g.fillRect(0, 0, pw, ph);
      return;
    }

    if (!pixels.current || pixels.current.width !== pw || pixels.current.height !== ph) {
      pixels.current = g.createImageData(pw, ph);
      const d = pixels.current.data;
      for (let i = 0; i < d.length; i += 4) {
        d[i] = 8;
        d[i + 1] = 8;
        d[i + 2] = 10;
        d[i + 3] = 255;
      }
    }

    const img = pixels.current;
    const data = img.data;
    if (slot.gen !== lastGen.current) {
      lastGen.current = slot.gen;
      // scroll left 1 device pixel
      for (let y = 0; y < ph; y++) {
        const row = y * pw * 4;
        data.copyWithin(row, row + 4, row + pw * 4);
      }
      const [ar, ag, ab] = parseAccent(cv);
      const n = slot.n;
      for (let y = 0; y < ph; y++) {
        // top = high freq
        const t = 1 - (y + 0.5) / ph;
        const i = Math.min(n - 1, Math.max(0, Math.floor(t * n)));
        const dry = slot.a[i] ?? 0;
        const wet = slot.b[i] ?? 0;
        const o = (y * pw + (pw - 1)) * 4;
        data[o] = Math.min(255, 18 + dry * 70 + wet * ar);
        data[o + 1] = Math.min(255, 18 + dry * 70 + wet * ag);
        data[o + 2] = Math.min(255, 22 + dry * 80 + wet * ab);
        data[o + 3] = 255;
      }
    }

    g.putImageData(img, 0, 0);
  });

  return (
    <canvas
      ref={ref}
      className="block w-full rounded-[3px] border border-line bg-inset"
      style={{ height }}
      aria-hidden
    />
  );
}
