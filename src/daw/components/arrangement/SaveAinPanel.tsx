// ── SAVE AIN — name + optional .wav extension mask (same polyglot bytes)

import { useEffect, useId, useRef, useState } from "react";
import { AIN_EXT, AIN_ICON, safeAinFilename } from "../../ain-pack";
import { engine } from "../../engine";

const field =
  "h-7 w-full rounded-sm border border-line2 bg-panel2 px-2 font-mono text-[10px] text-daw-text placeholder:text-faint focus:border-accent focus:outline-none";
const ctl =
  "flex h-7 items-center justify-center rounded-sm border px-2.5 font-mono text-[10px] transition-colors ";

export function SaveAinPanel({
  onClose,
  onBusy,
}: {
  onClose: () => void;
  onBusy?: (busy: boolean) => void;
}) {
  const nameId = useId();
  const wavId = useId();
  const [name, setName] = useState("project");
  const [wavMask, setWavMask] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLDivElement>(null);

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

  const filename = safeAinFilename(name, { wavMask });
  const needsBounce = !engine.hasMixBounce();

  const save = async () => {
    if (busy) return;
    setErr(null);
    setBusy(true);
    onBusy?.(true);
    try {
      await engine.exportAin(name.trim() || "project", { wavMask });
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't save AIN project");
    } finally {
      setBusy(false);
      onBusy?.(false);
    }
  };

  return (
    <div
      ref={root}
      data-ain-save
      className="absolute top-[calc(100%+4px)] left-0 z-50 w-[min(340px,calc(100vw-24px))] rounded-sm border border-line bg-[#0e0e12] p-3 shadow-[0_12px_40px_rgba(0,0,0,0.55)]"
      role="dialog"
      aria-label="Save AIN project"
    >
      <div className="mb-2.5 flex items-start gap-2.5">
        <img
          src={AIN_ICON}
          alt=""
          width={36}
          height={36}
          draggable={false}
          className="size-9 shrink-0 rounded-[3px] object-cover ring-1 ring-line2"
        />
        <div className="min-w-0">
          <div className="font-mono text-[11px] tracking-[0.04em] text-daw-text">
            Save AIN project
          </div>
          <p className="mt-1 font-mono text-[9.5px] leading-snug text-faint">
            One file, two lives: the whole project pack, with your latest master
            bounce up front — playable as audio as-is (spacebar in Finder if you
            mask the name as .wav).
          </p>
        </div>
      </div>

      <label
        htmlFor={nameId}
        className="mb-1 block font-mono text-[9px] tracking-[0.06em] text-faint"
      >
        name
      </label>
      <input
        ref={nameRef}
        id={nameId}
        className={field + " mb-2"}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void save();
        }}
        disabled={busy}
        spellCheck={false}
        autoComplete="off"
      />

      <label
        htmlFor={wavId}
        className="mb-2 flex cursor-pointer items-start gap-2 rounded-sm border border-line2 bg-panel2/40 px-2 py-1.5 transition-colors hover:border-accent/50"
      >
        <input
          id={wavId}
          type="checkbox"
          className="mt-0.5 accent-[var(--accent)]"
          checked={wavMask}
          onChange={(e) => setWavMask(e.target.checked)}
          disabled={busy}
        />
        <span className="min-w-0">
          <span className="block font-mono text-[10px] text-dim">
            Save with .wav name (Finder preview)
          </span>
          <span className="mt-0.5 block font-mono text-[9px] leading-snug text-faint">
            Same AIN bytes — only the extension changes so macOS Quick Look /
            Music treat it as audio. Default stays {AIN_EXT}.
          </span>
        </span>
      </label>

      <div className="mb-2.5 font-mono text-[9px] text-faint">
        downloads as{" "}
        <span className="text-accent">{filename}</span>
        {needsBounce && (
          <span className="mt-1 block text-[color-mix(in_srgb,#e09860_90%,white)]">
            No mix bounce yet — Save will play through once to capture the
            preview.
          </span>
        )}
      </div>

      {err && (
        <div className="mb-2 font-mono text-[9.5px] leading-snug text-[#e98c79]">
          {err}
        </div>
      )}

      <div className="flex items-center justify-end gap-1.5">
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
          className={ctl + "border-accent text-accent hover:bg-[color-mix(in_srgb,var(--accent)_12%,transparent)]"}
          disabled={busy}
          onClick={() => void save()}
        >
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
