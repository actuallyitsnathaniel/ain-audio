// Hover-help prefs: floating tooltips (fast) vs Ableton-style info panel.
// Native browser `title` tooltips are ~1s; tip mode uses 1/4 of that.

export type HoverInfoMode = "tip" | "panel";

const LS = "ain-hover-info-mode";

/** Approximate Chromium/Firefox `title` delay — tip mode is 4× faster. */
export const NATIVE_TITLE_DELAY_MS = 1000;
export const TIP_DELAY_MS = NATIVE_TITLE_DELAY_MS / 4; // 250ms

function load(): HoverInfoMode {
  try {
    const v = localStorage.getItem(LS);
    if (v === "tip" || v === "panel") return v;
  } catch {
    /* private mode */
  }
  return "tip";
}

let mode: HoverInfoMode = load();
const listeners = new Set<() => void>();

export function getHoverInfoMode(): HoverInfoMode {
  return mode;
}

export function setHoverInfoMode(next: HoverInfoMode) {
  if (next === mode) return;
  mode = next;
  try {
    localStorage.setItem(LS, next);
  } catch {
    /* quota */
  }
  listeners.forEach((l) => l());
}

export function subscribeHoverInfoMode(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Pull help text from title / data-tip; migrate title → data-tip to kill the native delay. */
export function tipTextFrom(el: Element | null): string | null {
  if (!el || !(el instanceof HTMLElement)) return null;
  const data = el.getAttribute("data-tip");
  if (data && data.trim()) return data.trim();
  const title = el.getAttribute("title");
  if (title && title.trim()) {
    el.setAttribute("data-tip", title);
    el.removeAttribute("title");
    return title.trim();
  }
  return null;
}

export function closestTipEl(start: EventTarget | null): HTMLElement | null {
  if (!(start instanceof Element)) return null;
  const el = start.closest("[data-tip], [title]") as HTMLElement | null;
  if (!el) return null;
  // Ignore the floating tip / info panel surfaces (not the transport toggle)
  if (el.closest("[data-hover-info-ui]")) return null;
  return el;
}
