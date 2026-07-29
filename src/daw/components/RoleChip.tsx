import type { ReactNode } from "react";

export function RoleChip({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-[3px] border border-line2 bg-panel px-2.25 py-1 font-mono text-[11px] tracking-[0.04em] whitespace-nowrap text-dim">
      {children}
    </span>
  );
}
