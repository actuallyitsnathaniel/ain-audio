// ── Custom right-click menu host ────────────────────────────────────────────
// Mounted once in DawShell. Surfaces call openContextMenu({x,y,title,items}); this
// renders the menu at the cursor (clamped to the viewport) and dismisses on click,
// Escape, scroll, or resize. Shift+right-click on any surface bypasses this and
// shows the browser's native menu (the "escape hatch" affordance).

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { setContextMenuHost, type MenuRequest } from "./context-menu-bus";

export function ContextMenu() {
  const [req, setReq] = useState<MenuRequest | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setContextMenuHost((r) => setReq(r));
    return () => setContextMenuHost(null);
  }, []);

  // dismiss on anything that should close a menu
  useEffect(() => {
    if (!req) return;
    const close = () => setReq(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    // close on a pointerdown OUTSIDE the menu. We must NOT close on a pointerdown
    // inside it — this listener runs in the capture phase (before the item's React
    // onClick), so closing here would unmount the button before its click fires.
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
    };
  }, [req]);

  // Position once measured: clamp to the viewport and dodge docked panels marked
  // [data-menu-avoid] (e.g. the hover-info panel) so menus don't cover them.
  // Applied imperatively so we don't cascade a second render for the clamp.
  useLayoutEffect(() => {
    if (!req || !ref.current) return;
    const el = ref.current;
    const { width, height } = el.getBoundingClientRect();
    const pad = 6;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let x = req.x;
    let y = req.y;

    // Flip above the open point when there isn't room below.
    if (y + height + pad > vh) y = Math.max(pad, req.y - height - 8);

    x = Math.max(pad, Math.min(x, vw - width - pad));
    y = Math.max(pad, Math.min(y, vh - height - pad));

    const obstacles = document.querySelectorAll<HTMLElement>("[data-menu-avoid]");
    for (const obs of obstacles) {
      const o = obs.getBoundingClientRect();
      const hitX = x < o.right + pad && x + width > o.left - pad;
      const hitY = y < o.bottom + pad && y + height > o.top - pad;
      if (!hitX || !hitY) continue;

      const leftOf = o.left - width - pad;
      const above = o.top - height - pad;
      // Prefer left of the panel (keeps the menu near a right-edge trigger),
      // then above it. Fall back to squeezing as high as the viewport allows.
      if (leftOf >= pad) x = leftOf;
      else if (above >= pad) y = above;
      else y = Math.max(pad, above);
    }

    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
  }, [req]);

  if (!req) return null;

  return (
    <div
      ref={ref}
      onContextMenu={(e) => e.preventDefault()}
      style={{ left: req.x, top: req.y }}
      className="fixed z-80 min-w-44 overflow-hidden rounded-[5px] border border-line2 bg-panel py-1 shadow-[0_14px_44px_rgba(0,0,0,0.55)]"
    >
      {req.title && (
        <div className="px-2.75 pt-0.75 pb-1.25 font-mono text-[9px] tracking-widest text-faint uppercase">
          {req.title}
        </div>
      )}
      {req.items.map((it, i) =>
        it.separator ? (
          <div key={i} className="my-0.75 h-px bg-line" />
        ) : (
          <button
            key={i}
            disabled={it.disabled}
            onClick={() => {
              setReq(null);
              it.onClick?.();
            }}
            className={
              "flex w-full items-center justify-between gap-3.5 px-2.75 py-1.25 text-left font-mono text-[11px] tracking-[0.02em] transition-colors " +
              (it.disabled
                ? "text-faint opacity-40"
                : it.danger
                  ? "text-[#e98c79] hover:bg-[color-mix(in_srgb,#e0654f_16%,transparent)]"
                  : "text-dim hover:bg-panel2 hover:text-daw-text")
            }
          >
            <span>{it.label}</span>
            {it.hint && (
              <span className="text-[9px] text-faint">{it.hint}</span>
            )}
          </button>
        ),
      )}
    </div>
  );
}
