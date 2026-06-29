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

  // clamp into the viewport once measured
  const [pos, setPos] = useState({ x: 0, y: 0 });
  useLayoutEffect(() => {
    if (!req || !ref.current) return;
    const { width, height } = ref.current.getBoundingClientRect();
    const pad = 6;
    setPos({
      x: Math.min(req.x, window.innerWidth - width - pad),
      y: Math.min(req.y, window.innerHeight - height - pad),
    });
  }, [req]);

  if (!req) return null;

  return (
    <div
      ref={ref}
      onContextMenu={(e) => e.preventDefault()}
      style={{ left: pos.x, top: pos.y }}
      className="fixed z-[70] min-w-[176px] overflow-hidden rounded-[5px] border border-line2 bg-panel py-[4px] shadow-[0_14px_44px_rgba(0,0,0,0.55)]"
    >
      {req.title && (
        <div className="px-[11px] pt-[3px] pb-[5px] font-mono text-[9px] tracking-[0.1em] text-faint uppercase">{req.title}</div>
      )}
      {req.items.map((it, i) =>
        it.separator ? (
          <div key={i} className="my-[3px] h-px bg-line" />
        ) : (
          <button
            key={i}
            disabled={it.disabled}
            onClick={() => {
              setReq(null);
              it.onClick?.();
            }}
            className={
              "flex w-full items-center justify-between gap-[14px] px-[11px] py-[5px] text-left font-mono text-[11px] tracking-[0.02em] transition-colors " +
              (it.disabled
                ? "text-faint opacity-40"
                : it.danger
                  ? "text-[#e98c79] hover:bg-[color-mix(in_srgb,#e0654f_16%,transparent)]"
                  : "text-dim hover:bg-panel2 hover:text-daw-text")
            }
          >
            <span>{it.label}</span>
            {it.hint && <span className="text-[9px] text-faint">{it.hint}</span>}
          </button>
        ),
      )}
    </div>
  );
}
