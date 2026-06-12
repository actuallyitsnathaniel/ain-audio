import { useRef } from "react";
import type { Levels } from "../engine";
import { useRafLoop } from "../hooks/useRafLoop";

// Vertical level meter fed by a getter → {rms, peak} in dBFS.
export function LevelMeter({
  getLevel,
  label,
  floor = -48,
}: {
  getLevel: () => Levels;
  label: string;
  floor?: number;
}) {
  const rmsRef = useRef<HTMLDivElement>(null);
  const peakRef = useRef<HTMLDivElement>(null);
  const readRef = useRef<HTMLDivElement>(null);
  const hold = useRef({ v: -90, t: 0 });

  useRafLoop(() => {
    const { rms, peak } = getLevel();
    const now = performance.now();
    if (peak > hold.current.v || now - hold.current.t > 1400) {
      hold.current = { v: peak, t: now };
    }
    const pct = (db: number) => Math.min(100, Math.max(0, ((db - floor) / -floor) * 100));
    if (rmsRef.current) rmsRef.current.style.height = pct(rms) + "%";
    if (peakRef.current) peakRef.current.style.bottom = pct(hold.current.v) + "%";
    if (readRef.current) readRef.current.textContent = rms <= -89 ? "−∞" : rms.toFixed(1);
  });

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative h-[130px] w-4 overflow-hidden rounded-[2px] border border-line bg-[#0e0e11]">
        <div
          ref={rmsRef}
          className="absolute right-0 bottom-0 left-0 h-0 bg-gradient-to-t from-accent to-[color-mix(in_srgb,var(--accent)_55%,white)] transition-[height] duration-[60ms] ease-linear"
        />
        <div ref={peakRef} className="absolute right-0 bottom-0 left-0 h-[1.5px] bg-white/85" />
      </div>
      <div ref={readRef} className="font-mono text-[10.5px] text-daw-text">
        −∞
      </div>
      <div className="font-mono text-[9.5px] tracking-[0.1em] text-dim">{label}</div>
    </div>
  );
}
