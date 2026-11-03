// Smooth-scroll to a section by id. Sections use scroll-mt-* to clear the fixed
// transport bar — don't subtract an extra offset here or you get a double gap.
export function scrollToId(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "start" });
}

// Shared button styles translated from the prototype's .ab-snap.
export const abSnap =
  "rounded-[3px] border border-line2 px-[13px] py-2 font-mono text-[11px] tracking-[0.07em] whitespace-nowrap text-dim transition-all duration-150 hover:border-dim hover:text-daw-text";
export const abSnapActive =
  "rounded-[3px] border border-accent bg-accent px-[13px] py-2 font-mono text-[11px] font-semibold tracking-[0.07em] whitespace-nowrap text-[#111]";

export const lockChip =
  "rounded-[3px] border border-line2 px-[9px] py-1 font-mono text-[10.5px] tracking-[0.05em] whitespace-nowrap text-dim";
