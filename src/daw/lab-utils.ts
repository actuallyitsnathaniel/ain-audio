import { engine } from "./engine";
import type { Track } from "./data/tracks";

// Smooth-scroll to a section by id, accounting for the fixed transport bar.
export function scrollToId(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 64, behavior: "smooth" });
}

// Load any track into the global lab (from project pages / detail panel).
export function loadLabEntry(track: Track, jump = true) {
  void engine.loadTrack(track, { autoplay: true });
  if (jump) scrollToId("audiolab");
}

// Shared button styles translated from the prototype's .ab-snap.
export const abSnap =
  "rounded-[3px] border border-line2 px-[13px] py-2 font-mono text-[11px] tracking-[0.07em] whitespace-nowrap text-dim transition-all duration-150 hover:border-dim hover:text-daw-text";
export const abSnapActive =
  "rounded-[3px] border border-accent bg-accent px-[13px] py-2 font-mono text-[11px] font-semibold tracking-[0.07em] whitespace-nowrap text-[#111]";

export const lockChip =
  "rounded-[3px] border border-line2 px-[9px] py-1 font-mono text-[10.5px] tracking-[0.05em] whitespace-nowrap text-dim";
