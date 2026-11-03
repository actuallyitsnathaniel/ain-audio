import type { ReactNode } from "react";

// The repeated DAW "track" layout: a left rail with the track number and the
// section body. Collapses to a single column under 760px (rail hidden).
export function TrackSection({
  id,
  rail,
  label,
  className = "",
  fill = true,
  children,
}: {
  id?: string;
  rail: string;
  label?: string;
  className?: string;
  /** When true (default), desktop sections stretch to at least one viewport tall. */
  fill?: boolean;
  children: ReactNode;
}) {
  // Callers may pass pt-* (e.g. hero clears the fixed transport); don't also
  // emit the default pt-* or Tailwind's stylesheet order can keep the smaller pad.
  const hasPt = /\bpt-/.test(className);

  return (
    <section
      id={id}
      data-screen-label={label}
      className={
        // Desktop only: full viewport tall so the next section stays below the
        // fold. Mobile stays content-sized. scroll-mt-13 clears the transport.
        "mx-auto grid w-full scroll-mt-13 grid-cols-[56px_1fr] px-6 pb-9 max-[760px]:grid-cols-1 max-[760px]:px-4 max-[760px]:pb-6 " +
        (fill ? "min-[761px]:min-h-dvh min-[761px]:grid-rows-[1fr] " : "") +
        (hasPt ? "" : "pt-8 max-[760px]:pt-6 ") +
        className
      }
    >
      <div className="mr-6 self-stretch border-r border-line pt-2 font-mono text-[11px] tracking-[0.1em] text-faint max-[760px]:hidden">
        {rail}
      </div>
      <div className="flex h-full min-h-0 min-w-0 flex-col">{children}</div>
    </section>
  );
}
