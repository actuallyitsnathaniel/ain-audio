// ── Custom menu host ────────────────────────────────────────────────────────
// Mounted once in DawShell. Surfaces call openContextMenu({x,y,title,items});
// this renders the menu (clamped to the viewport, dodging [data-menu-avoid]
// panels), supports arrow / typeahead / Enter keyboard nav, and dismisses on
// outside click, Escape, scroll, or resize. Re-open with the same `anchor`
// toggles closed. Shift+right-click on any surface bypasses this and shows the
// browser's native menu (the "escape hatch" affordance).

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  setContextMenuHost,
  type MenuItem,
  type MenuRequest,
} from "./context-menu-bus";

function actionableIndices(items: MenuItem[]): number[] {
  return items
    .map((it, i) => (!it.separator && !it.disabled ? i : -1))
    .filter((i) => i >= 0);
}

export function ContextMenu() {
  const [req, setReq] = useState<MenuRequest | null>(null);
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const reqRef = useRef<MenuRequest | null>(null);
  const activeRef = useRef(0);
  const typeBuf = useRef("");
  const typeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const select = (i: number) => {
    activeRef.current = i;
    setActive(i);
  };

  useEffect(() => {
    setContextMenuHost({
      open: (r) => {
        const first = actionableIndices(r.items)[0] ?? 0;
        activeRef.current = first;
        reqRef.current = r;
        setActive(first);
        setReq(r);
      },
      close: () => {
        reqRef.current = null;
        setReq(null);
      },
      isOpen: () => reqRef.current != null,
      getAnchor: () => reqRef.current?.anchor ?? null,
    });
    return () => setContextMenuHost(null);
  }, []);

  // dismiss on anything that should close a menu
  useEffect(() => {
    if (!req) return;
    const close = () => setReq(null);
    // close on a pointerdown OUTSIDE the menu (and outside the anchor — the
    // anchor toggles via openContextMenu on click, so we must not dismiss first).
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t)) return;
      if (req.anchor && (req.anchor === t || req.anchor.contains(t))) return;
      close();
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
    };
  }, [req]);

  // Keyboard: Escape, arrows, Home/End, Enter/Space, typeahead
  useEffect(() => {
    if (!req) return;
    const indices = () => actionableIndices(req.items);

    const move = (delta: number) => {
      const idxs = indices();
      if (!idxs.length) return;
      const cur = activeRef.current;
      const at = idxs.indexOf(cur);
      const from = at < 0 ? (delta > 0 ? -1 : 0) : at;
      select(idxs[(from + delta + idxs.length) % idxs.length]!);
    };

    const jump = (to: "first" | "last") => {
      const idxs = indices();
      if (!idxs.length) return;
      select(to === "first" ? idxs[0]! : idxs[idxs.length - 1]!);
    };

    const activate = () => {
      const it = req.items[activeRef.current];
      if (!it || it.separator || it.disabled) return;
      reqRef.current = null;
      setReq(null);
      it.onClick?.();
    };

    const typeahead = (ch: string) => {
      if (typeTimer.current) clearTimeout(typeTimer.current);
      typeBuf.current += ch.toLowerCase();
      typeTimer.current = setTimeout(() => {
        typeBuf.current = "";
      }, 500);
      const buf = typeBuf.current;
      const idxs = indices();
      const hit = idxs.find((i) =>
        (req.items[i]?.label ?? "").toLowerCase().startsWith(buf),
      );
      if (hit != null) select(hit);
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        reqRef.current = null;
        setReq(null);
        req.anchor?.focus();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        move(1);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        move(-1);
        return;
      }
      if (e.key === "Home") {
        e.preventDefault();
        jump("first");
        return;
      }
      if (e.key === "End") {
        e.preventDefault();
        jump("last");
        return;
      }
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        activate();
        return;
      }
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        typeahead(e.key);
      }
    };

    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (typeTimer.current) clearTimeout(typeTimer.current);
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

    // Focus the active item for keyboard users (imperative — no extra render).
    const btn = el.querySelector<HTMLButtonElement>(
      `[data-menu-idx="${active}"]`,
    );
    btn?.focus();
  }, [req, active]);

  if (!req) return null;

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={req.title ?? "menu"}
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
          <div key={i} role="separator" className="my-0.75 h-px bg-line" />
        ) : (
          <button
            key={i}
            type="button"
            role="menuitem"
            data-menu-idx={i}
            disabled={it.disabled}
            tabIndex={i === active ? 0 : -1}
            onMouseEnter={() => {
              if (!it.disabled) select(i);
            }}
            onClick={() => {
              reqRef.current = null;
              setReq(null);
              it.onClick?.();
            }}
            className={
              "flex w-full items-center justify-between gap-3.5 px-2.75 py-1.25 text-left font-mono text-[11px] tracking-[0.02em] transition-colors " +
              (it.disabled
                ? "text-faint opacity-40"
                : it.danger
                  ? "text-[#e98c79] " +
                    (i === active
                      ? "bg-[color-mix(in_srgb,#e0654f_16%,transparent)]"
                      : "hover:bg-[color-mix(in_srgb,#e0654f_16%,transparent)]")
                  : i === active
                    ? "bg-panel2 text-daw-text"
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
