// ── BOUNCE CANCEL CONFIRM — Space during a realtime bounce asks before binning it
// A bounce is a realtime capture: it costs as long as the music, so a stray keypress
// shouldn't throw it away. Space (the transport reflex) raises this instead of
// stopping the transport mid-recording; Esc backs out and the bounce keeps rolling.
//
// This is a real dialog, not window.confirm — a native confirm blocks the main
// thread, which would stall the lookahead scheduler and glitch the audio it's
// recording.

import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";

const ctl =
  "flex h-7 items-center justify-center rounded-sm border px-3 font-mono text-[10px] transition-colors ";

export function BounceCancelConfirm({
  onKeep,
  onCancelBounce,
}: {
  onKeep: () => void;
  onCancelBounce: () => void;
}) {
  const titleId = useId();
  const keepRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    keepRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onKeep();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onKeep]);

  return createPortal(
    <div
      className="fixed inset-0 z-100 flex items-center justify-center p-4"
      role="presentation"
    >
      <div className="absolute inset-0 bg-black/65 backdrop-blur-[2px]" />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="relative z-1 w-full max-w-sm rounded-sm border border-line2 bg-[#0e0e12] p-4 shadow-[0_24px_80px_rgba(0,0,0,0.65)]"
      >
        <h2
          id={titleId}
          className="m-0 mb-2 font-mono text-[11px] tracking-[0.14em] text-accent uppercase"
        >
          cancel bounce?
        </h2>
        <p className="mb-4 font-mono text-[10px] leading-relaxed text-dim">
          A bounce records in real time. Cancelling stops the transport now and
          writes no file.
        </p>
        <div className="flex justify-end gap-2">
          <button
            ref={keepRef}
            type="button"
            className={ctl + "border-line2 text-dim hover:border-accent hover:text-daw-text"}
            onClick={onKeep}
          >
            Keep bouncing
            <span className="ml-1.5 text-[9px] text-faint">Esc</span>
          </button>
          <button
            type="button"
            className={ctl + "border-[#e0654f] text-[#e98c79] hover:bg-[color-mix(in_srgb,#e0654f_14%,transparent)]"}
            onClick={onCancelBounce}
          >
            Cancel bounce
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
