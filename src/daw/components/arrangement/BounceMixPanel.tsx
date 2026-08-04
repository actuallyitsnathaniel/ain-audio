// ── BOUNCE MIX — name + range (loop / full) + format (wav / webm)

import { useEffect, useId, useRef, useState } from "react";
import { engine } from "../../engine";

const field =
  "h-7 w-full rounded-sm border border-line2 bg-panel2 px-2 font-mono text-[10px] text-daw-text placeholder:text-faint focus:border-accent focus:outline-none";
const ctl =
  "flex h-7 items-center justify-center rounded-sm border px-2.5 font-mono text-[10px] transition-colors ";
const seg =
  "flex overflow-hidden rounded-sm border border-line2 [&_button]:flex-1 [&_button]:px-2 [&_button]:py-1.5 [&_button]:font-mono [&_button]:text-[10px]";
const segOn = "bg-accent/20 text-accent";
const segOff = "text-faint hover:text-dim";

export type BounceFormat = "wav" | "webm";
export type BounceRange = "loop" | "full";

export function BounceMixPanel({
  onClose,
  onBusy,
}: {
  onClose: () => void;
  onBusy?: (busy: boolean) => void;
}) {
  const nameId = useId();
  const loopOn = !!engine.arrangement.loop?.on;
  const [name, setName] = useState("mix");
  const [range, setRange] = useState<BounceRange>(loopOn ? "loop" : "full");
  const [format, setFormat] = useState<BounceFormat>("wav");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
    nameRef.current?.select();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onClose]);

  const bounce = async () => {
    if (busy) return;
    setErr(null);
    setBusy(true);
    onBusy?.(true);
    try {
      await engine.bounceMix(name.trim() || "mix", { range, format });
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't bounce mix");
    } finally {
      setBusy(false);
      onBusy?.(false);
    }
  };

  return (
    <div
      data-ain-bounce
      className="absolute top-[calc(100%+4px)] left-0 z-50 w-[min(320px,calc(100vw-24px))] rounded-sm border border-line bg-[#0e0e12] p-3 shadow-[0_12px_40px_rgba(0,0,0,0.55)]"
      role="dialog"
      aria-label="Bounce mix"
    >
      <div className="mb-2.5 font-mono text-[11px] tracking-[0.04em] text-daw-text">
        Bounce Mix
      </div>
      <p className="mb-3 font-mono text-[9.5px] leading-snug text-faint">
        Plays the arrangement in real time and downloads the mix (you’ll hear
        it). Metronome and count-in are muted for the bounce.
      </p>

      <label
        htmlFor={nameId}
        className="mb-1 block font-mono text-[9px] tracking-[0.06em] text-faint uppercase"
      >
        Name
      </label>
      <input
        id={nameId}
        ref={nameRef}
        className={field + " mb-3"}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void bounce();
        }}
        disabled={busy}
      />

      <div className="mb-1 font-mono text-[9px] tracking-[0.06em] text-faint uppercase">
        Range
      </div>
      <div className={seg + " mb-3"} role="group" aria-label="Bounce range">
        <button
          type="button"
          className={range === "loop" ? segOn : segOff}
          disabled={!loopOn || busy}
          title={
            loopOn
              ? "One pass of the loop brace (+ FX tail)"
              : "Turn on the loop brace first"
          }
          onClick={() => setRange("loop")}
        >
          Loop
        </button>
        <button
          type="button"
          className={range === "full" ? segOn : segOff}
          disabled={busy}
          title="From beat 0 through the arrangement end (+ FX tail)"
          onClick={() => setRange("full")}
        >
          Full
        </button>
      </div>

      <div className="mb-1 font-mono text-[9px] tracking-[0.06em] text-faint uppercase">
        Format
      </div>
      <div className={seg + " mb-3"} role="group" aria-label="Bounce format">
        <button
          type="button"
          className={format === "wav" ? segOn : segOff}
          disabled={busy}
          title="PCM WAV — opens in every DAW / encoder"
          onClick={() => setFormat("wav")}
        >
          WAV
        </button>
        <button
          type="button"
          className={format === "webm" ? segOn : segOff}
          disabled={busy}
          title="Opus in WebM (or M4A on Safari) — smaller, less portable"
          onClick={() => setFormat("webm")}
        >
          WebM
        </button>
      </div>

      {err && (
        <p className="mb-2 font-mono text-[10px] text-[#e98c79]" role="alert">
          {err}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          className={ctl + "border-line2 text-faint hover:text-dim"}
          disabled={busy}
          onClick={onClose}
        >
          Cancel
        </button>
        <button
          type="button"
          className={ctl + "border-accent text-accent"}
          disabled={busy}
          onClick={() => void bounce()}
        >
          {busy ? "Bouncing…" : "Bounce"}
        </button>
      </div>
    </div>
  );
}
