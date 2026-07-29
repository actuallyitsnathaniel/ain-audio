// ── LAB PANEL — shared chrome for Audio-Lab sections ─────────────────────────
// Unifies the divider + header (caret · title · inline controls) that PresetLab,
// SynthEditor, RollLab, etc. each used to hand-roll. Collapsible to just the header
// so heavy panels (the synth editor) don't force a long scroll. `controls` sit on
// the header line (selectors / transport); `children` is the collapsible body.

import { useState, type ReactNode } from "react";
import { FloatingWindow } from "./FloatingWindow";

export function LabPanel({
  title,
  controls,
  children,
  defaultOpen = true,
}: {
  title: string;
  controls?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [floating, setFloating] = useState(false);

  const header = (
    <div className="flex flex-wrap items-center gap-3">
      <button
        onClick={() => !floating && setOpen((o) => !o)}
        aria-label={(open ? "collapse " : "expand ") + title}
        className="flex items-center gap-1.75 font-mono text-[10.5px] tracking-widest whitespace-nowrap text-daw-text transition-colors hover:text-accent"
      >
        {!floating && <span className="text-[27px] leading-none text-faint">{open ? "▾" : "▸"}</span>}
        {title}
      </button>
      {!floating && controls}
      {!floating && (
        <button
          onClick={() => setFloating(true)}
          title="pop out into a floating window"
          aria-label={"pop out " + title}
          className="ml-auto rounded-[3px] border border-line px-1.75 py-0.75 font-mono text-[10px] text-faint transition-colors hover:border-accent hover:text-accent"
        >
          ▱
        </button>
      )}
    </div>
  );

  return (
    <div className="flex flex-col gap-2.5 border-t border-line pt-3.5">
      {header}
      {floating ? (
        <span className="font-mono text-[10px] tracking-[0.03em] text-faint">
          popped out —{" "}
          <button onClick={() => setFloating(false)} className="text-dim underline-offset-2 transition-colors hover:text-accent hover:underline">
            dock back
          </button>
        </span>
      ) : (
        open && children
      )}
      {floating && (
        <FloatingWindow id={title} title={title} onDock={() => setFloating(false)}>
          {controls && <div className="mb-2.5 flex flex-wrap items-center gap-3">{controls}</div>}
          {children}
        </FloatingWindow>
      )}
    </div>
  );
}
