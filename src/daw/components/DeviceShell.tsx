import type { ReactNode } from "react";

// A device panel in the FX rack: power dot + name header, body for controls.
export function DeviceShell({
  name,
  on,
  onToggle,
  children,
}: {
  name: string;
  on: boolean;
  onToggle: (v: boolean) => void;
  children: ReactNode;
}) {
  return (
    <div
      className={
        "min-w-[96px] rounded-[4px] border bg-panel2 transition-[opacity,border-color] duration-150 " +
        (on ? "border-line2 opacity-100" : "border-line opacity-[0.78]")
      }
    >
      <div className="flex items-center gap-2 border-b border-line px-[10px] py-[7px]">
        <button
          className={
            "flex h-4 w-4 items-center justify-center rounded-full border " +
            (on ? "border-line2" : "border-line2")
          }
          onClick={() => onToggle(!on)}
          aria-label={"toggle " + name}
        >
          <span
            className={
              "h-[6px] w-[6px] rounded-full transition-[background,box-shadow] duration-150 " +
              (on ? "bg-accent shadow-[0_0_6px_var(--accent)]" : "bg-faint")
            }
          />
        </button>
        <span className={"font-mono text-[10.5px] tracking-[0.1em] " + (on ? "text-daw-text" : "text-dim")}>
          {name}
        </span>
      </div>
      <div className="flex justify-center gap-[6px] px-3 py-[10px]">{children}</div>
    </div>
  );
}
