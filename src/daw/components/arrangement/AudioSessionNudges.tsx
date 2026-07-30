// ── Soft session chips for audio capability limits

import { engine } from "../../engine";
import { useEngine } from "../../hooks/useEngine";

export function AudioSessionNudges() {
  const eng = useEngine(["transport"]);
  if (!eng.audioNudges.length) return null;
  return (
    <div className="flex flex-col gap-1.5">
      {eng.audioNudges.map((n) => (
        <div
          key={n.id}
          className="flex items-start gap-2 rounded-sm border border-line2 bg-[color-mix(in_srgb,var(--accent)_8%,#0e0e12)] px-2.5 py-1.5 font-mono text-[10px] leading-snug text-dim"
          role="status"
        >
          <span className="min-w-0 flex-1">{n.message}</span>
          {n.dismissible && (
            <button
              type="button"
              className="shrink-0 text-faint transition-colors hover:text-accent"
              onClick={() => engine.dismissNudge(n.id)}
              title="dismiss"
            >
              ✕
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
