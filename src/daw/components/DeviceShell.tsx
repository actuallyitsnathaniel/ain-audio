import type { ReactNode } from "react";

// A device panel in the FX rack: power dot + name header, body for controls.
export function DeviceShell({
  name,
  on,
  onToggle,
  children,
  headerExtra,
  footer,
  wide,
}: {
  name: string;
  on: boolean;
  onToggle: (v: boolean) => void;
  children: ReactNode;
  /** Chips / toggles in the header row (e.g. viz assistant). */
  headerExtra?: ReactNode;
  /** Optional assistant strip under the knobs (heatmap / RTA). */
  footer?: ReactNode;
  /** Wider panel when a viz assistant is open. */
  wide?: boolean;
}) {
  return (
    <div
      className={
        "rounded-sm border bg-panel2 transition-[opacity,border-color] duration-150 [overflow-anchor:none] " +
        (wide ? "min-w-70" : "min-w-34") +
        " " +
        (on ? "border-line2 opacity-100" : "border-line opacity-[0.78]")
      }
    >
      <div className="flex items-center gap-2 border-b border-line px-2.5 py-1.75 pr-16">
        <button
          className="flex size-4 items-center justify-center rounded-full border border-line2"
          onClick={() => onToggle(!on)}
          aria-label={"toggle " + name}
        >
          <span
            className={
              "size-1.5 rounded-full transition-[background,box-shadow] duration-150 " +
              (on ? "bg-accent shadow-[0_0_6px_var(--accent)]" : "bg-faint")
            }
          />
        </button>
        <span
          className={
            "font-mono text-[10.5px] tracking-widest " +
            (on ? "text-daw-text" : "text-dim")
          }
        >
          {name}
        </span>
        {headerExtra}
      </div>
      <div className="flex flex-wrap justify-center gap-2.5 px-2.5 py-3">{children}</div>
      {footer ? <div className="border-t border-line px-2 pb-2 pt-1.5">{footer}</div> : null}
    </div>
  );
}
