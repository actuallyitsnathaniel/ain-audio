// ── GRID MENU — snap / launch / follow / keys (decluttered from the transport bar)

import { useEffect, useRef, useState, type ReactNode } from "react";
import { engine } from "../../engine";
import { useEngine } from "../../hooks/useEngine";

const ctl =
  "flex h-7 items-center justify-center rounded-sm border font-mono text-[10px] transition-colors ";
const px = "px-2.5 ";
const onOff = (on: boolean) =>
  on
    ? "border-accent text-accent"
    : "border-line2 text-faint hover:border-accent hover:text-dim";
const fieldSel =
  ctl +
  "w-full cursor-pointer appearance-none border-line2 bg-panel2 pl-2 pr-5 text-daw-text hover:border-accent focus:border-accent focus:outline-none";
const cap = "font-mono text-[9px] tracking-[0.06em] text-faint";

function Select({
  value,
  onChange,
  title,
  children,
}: {
  value: number;
  onChange: (n: number) => void;
  title: string;
  children: ReactNode;
}) {
  return (
    <span className="relative inline-flex w-full">
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        title={title}
        className={fieldSel}
      >
        {children}
      </select>
      <span className="pointer-events-none absolute top-1/2 right-1.75 -translate-y-1/2 text-[7px] text-faint">
        ▼
      </span>
    </span>
  );
}

function snapLabel(n: number, bpb: number): string {
  if (n === 0) return "off";
  if (n === bpb) return "bar";
  if (n === 1) return "1/4";
  if (n === 0.5) return "1/8";
  if (n === 0.25) return "1/16";
  if (n === 0.125) return "1/32";
  return String(n);
}

function launchLabel(n: number, bpb: number): string {
  if (n === 0) return "off";
  if (n === 0.5) return "1/8";
  if (n === 1) return "1/4";
  if (n === bpb) return "bar";
  if (n === bpb * 2) return "2 bar";
  return String(n);
}

export function GridMenu() {
  const eng = useEngine(["transport", "arrange"]);
  const bpb = eng.arrangement.beatsPerBar;
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onPtr = (e: PointerEvent) => {
      const el = root.current;
      if (!el) return;
      if (el.contains(e.target as Node)) return;
      setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPtr, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPtr, true);
    };
  }, [open]);

  const summary = snapLabel(eng.snapBeats, bpb);
  const activeExtras = eng.midiKeys || eng.launchQuant > 0;

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        className={ctl + px + onOff(open || activeExtras)}
        onClick={() => setOpen((o) => !o)}
        title="grid — snap, launch quantize, computer MIDI keys"
        aria-expanded={open}
      >
        grid · {summary}
        {eng.midiKeys ? " · keys" : ""}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="grid settings"
          className="absolute top-[calc(100%+6px)] left-0 z-40 w-[220px] rounded-sm border border-line bg-[#0e0e12] p-3 shadow-[0_12px_40px_rgba(0,0,0,0.55)]"
        >
          <label className="mb-2.5 flex flex-col gap-1">
            <span className={cap}>snap</span>
            <Select
              value={eng.snapBeats}
              onChange={(n) => engine.setSnapBeats(n)}
              title="clip snap grid (⌘1 finer · ⌘2 coarser)"
            >
              <option value={bpb}>bar</option>
              <option value={1}>1/4</option>
              <option value={0.5}>1/8</option>
              <option value={0.25}>1/16</option>
              <option value={0.125}>1/32</option>
              <option value={0}>off</option>
            </Select>
          </label>

          <label className="mb-2.5 flex flex-col gap-1">
            <span className={cap}>launch</span>
            <Select
              value={eng.launchQuant}
              onChange={(n) => engine.setLaunchQuant(n)}
              title="launch quantize: while playing, a jump waits for the next boundary"
            >
              <option value={0}>off</option>
              <option value={0.5}>1/8</option>
              <option value={1}>1/4</option>
              <option value={bpb}>bar</option>
              <option value={bpb * 2}>2 bar</option>
            </Select>
            <span className={cap}>
              now {launchLabel(eng.launchQuant, bpb)}
            </span>
          </label>

          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              className={ctl + px + onOff(eng.midiKeys)}
              onClick={() => engine.toggleMidiKeys()}
              title="Computer MIDI Keyboard (M): ON = A–; play the armed/selected track"
            >
              keys {eng.midiKeys ? "on" : "off"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
