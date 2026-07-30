import { useEffect, useRef, type ReactNode } from "react";

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
  const ref = useRef<HTMLElement>(null);

  // scrollToId dispatches this once the nav-triggered scroll to this section
  // settles (or immediately if we were already here) — see lab-utils.ts. Toggling
  // via remove/reflow/add (not React state) restarts the CSS glow on every click,
  // even repeat clicks that land mid-animation.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onGlow = () => {
      el.classList.remove("glow-active");
      void el.offsetWidth;
      el.classList.add("glow-active");
    };
    el.addEventListener("anchor-glow", onGlow);
    return () => el.removeEventListener("anchor-glow", onGlow);
  }, []);

  return (
    <section
      ref={ref}
      id={id}
      data-screen-label={label}
      className={
        "mx-auto grid max-w-7xl grid-cols-[56px_1fr] px-6 pt-18 pb-9 max-[760px]:grid-cols-1 max-[760px]:px-4 max-[760px]:pt-14 max-[760px]:pb-6 " +
        className
      }
    >
      <div className="mr-6 border-r border-line pt-2 font-mono text-[11px] tracking-widest text-faint max-[760px]:hidden">
        {rail}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}
