// ── BEFORE YOU RECORD — one-time browser-DAW acceptance sheet

import { useState } from "react";
import { engine } from "../../engine";

const cap = "font-mono text-[9px] tracking-[0.06em] text-faint";
const ctl =
  "flex h-7 items-center justify-center rounded-sm border font-mono text-[10px] transition-colors ";

const CHECKS = [
  {
    id: "latency",
    label: "I understand monitoring/latency limits in a browser",
  },
  {
    id: "prefs",
    label: "I know audio prefs control device, channels, buffer, compensation",
  },
  {
    id: "machine",
    label: "I accept that performance depends on this machine and browser",
  },
] as const;

export function AudioAcceptSheet({
  onDone,
  reread = false,
}: {
  onDone: () => void;
  /** Re-open from System — does not require re-checking if already accepted (still show copy). */
  reread?: boolean;
}) {
  const [on, setOn] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(CHECKS.map((c) => [c.id, false])),
  );
  const all = CHECKS.every((c) => on[c.id]);
  const canContinue = reread || all;

  const finish = () => {
    if (!reread) engine.acceptAudioLimits();
    onDone();
  };

  return (
    <div
      className="fixed inset-0 z-80 flex items-center justify-center bg-black/65 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ain-audio-accept-title"
    >
      <div className="w-[min(440px,100%)] rounded-sm border border-line bg-[#0e0e12] p-4 shadow-[0_16px_48px_rgba(0,0,0,0.65)]">
        <h2
          id="ain-audio-accept-title"
          className="font-mono text-[13px] tracking-[0.08em] text-daw-text"
        >
          Before you record
        </h2>
        <p className="mt-2 font-mono text-[10px] leading-relaxed text-dim">
          This studio runs in the <span className="text-daw-text">browser</span>
          — not as a native ASIO / Core Audio driver stack. Latency will never
          match an audio interface’s hardware direct-monitor loop. Glitches under heavy FX, many
          tracks, or a tiny buffer are often a machine/browser limit, not a
          silent bug. Mic permission and the correct input device live in{" "}
          <span className="text-daw-text">audio</span> prefs. Takes stay in this
          browser (IndexedDB); clearing site data deletes them.
        </p>

        {!reread && (
          <ul className="mt-3 flex flex-col gap-2">
            {CHECKS.map((c) => (
              <li key={c.id}>
                <label className="flex cursor-pointer items-start gap-2 font-mono text-[10px] text-dim">
                  <input
                    type="checkbox"
                    checked={!!on[c.id]}
                    onChange={(e) =>
                      setOn((s) => ({ ...s, [c.id]: e.target.checked }))
                    }
                    className="mt-0.5 accent-(--accent)"
                  />
                  <span>{c.label}</span>
                </label>
              </li>
            ))}
          </ul>
        )}

        {reread && (
          <p className={cap + " mt-3"}>
            You already accepted these limits for this browser profile.
          </p>
        )}

        <div className="mt-4 flex items-center justify-end gap-1.5">
          <button
            type="button"
            className={
              ctl +
              "px-3 " +
              (canContinue
                ? "border-accent bg-accent text-[#111]"
                : "border-line2 text-faint opacity-50")
            }
            disabled={!canContinue}
            onClick={finish}
          >
            {reread ? "close" : "continue"}
          </button>
        </div>
      </div>
    </div>
  );
}
