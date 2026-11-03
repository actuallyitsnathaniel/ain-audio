import type { ReactNode } from "react";

// The repeated DAW "track" layout: a left rail with the track number and the
// section body. Collapses to a single column under 760px (rail hidden).
export function TrackSection({
  id,
  rail,
  label,
  className = "",
  children,
}: {
  id?: string;
  rail: string;
  label?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      data-screen-label={label}
      className={
        // scroll-mt-13 clears the fixed transport bar (h-13); keep pt modest so
        // nav/hash jumps don't leave a double gap under the header.
        "mx-auto grid max-w-[1280px] scroll-mt-13 grid-cols-[56px_1fr] px-6 pt-8 pb-9 max-[760px]:grid-cols-1 max-[760px]:px-4 max-[760px]:pt-6 max-[760px]:pb-6 " +
        className
      }
    >
      <div className="mr-6 border-r border-line pt-2 font-mono text-[11px] tracking-[0.1em] text-faint max-[760px]:hidden">
        {rail}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}
