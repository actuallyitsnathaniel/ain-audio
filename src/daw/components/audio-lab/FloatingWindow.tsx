// ── FLOATING WINDOW — an internal draggable/resizable panel ──────────────────
// A position:fixed window inside the page (no OS window — same DOM/React/engine).
// Drag by the title bar, resize from the bottom-right corner; both use pointer
// capture (the codebase idiom). Position + size are clamped to the viewport and
// persisted per `id` in localStorage so a panel reopens where you left it.

import { useEffect, useRef, useState, type ReactNode } from "react";

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
const MIN_W = 260;
const MIN_H = 140;
const LS = (id: string) => "ain-win:" + id;

const clampRect = (r: Rect): Rect => {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = Math.max(MIN_W, Math.min(r.w, vw - 16));
  const h = Math.max(MIN_H, Math.min(r.h, vh - 16));
  return {
    w,
    h,
    x: Math.max(8, Math.min(r.x, vw - w - 8)),
    y: Math.max(8, Math.min(r.y, vh - h - 8)),
  };
};

function loadRect(id: string, fallback: Rect): Rect {
  try {
    const v = localStorage.getItem(LS(id));
    if (v) return clampRect({ ...fallback, ...JSON.parse(v) });
  } catch {
    /* ignore */
  }
  return clampRect(fallback);
}

export function FloatingWindow({ id, title, onDock, children }: { id: string; title: string; onDock: () => void; children: ReactNode }) {
  // initial: centred-ish, sized to a comfortable default
  const [rect, setRect] = useState<Rect>(() => loadRect(id, { x: window.innerWidth / 2 - 230, y: 110, w: 460, h: 420 }));
  const drag = useRef<{ mode: "move" | "resize"; px: number; py: number; base: Rect } | null>(null);

  const persist = (r: Rect) => {
    try {
      localStorage.setItem(LS(id), JSON.stringify(r));
    } catch {
      /* ignore */
    }
  };

  const onDown = (mode: "move" | "resize") => (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { mode, px: e.clientX, py: e.clientY, base: rect };
    e.preventDefault();
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.px;
    const dy = e.clientY - d.py;
    setRect(
      clampRect(
        d.mode === "move"
          ? { ...d.base, x: d.base.x + dx, y: d.base.y + dy }
          : { ...d.base, w: d.base.w + dx, h: d.base.h + dy },
      ),
    );
  };
  const onUp = () => {
    if (drag.current) {
      drag.current = null;
      persist(rect);
    }
  };

  // re-clamp if the viewport shrinks under the window
  useEffect(() => {
    const onResize = () => setRect((r) => clampRect(r));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return (
    <div
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
      className="fixed z-[55] flex flex-col overflow-hidden rounded-[6px] border border-line2 bg-panel shadow-[0_18px_56px_rgba(0,0,0,0.55)]"
    >
      <div
        onPointerDown={onDown("move")}
        onPointerMove={onMove}
        onPointerUp={onUp}
        className="flex cursor-grab items-center gap-2 border-b border-line bg-panel2 px-[11px] py-[7px] active:cursor-grabbing"
      >
        <span className="text-[9px] text-faint">⠿</span>
        <span className="font-mono text-[10.5px] tracking-[0.1em] text-daw-text">{title}</span>
        <button
          // stop the title-bar drag handler from capturing this press (it would
          // swallow the button's click via pointer capture)
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onDock}
          title="dock back inline"
          className="ml-auto rounded-[3px] border border-line px-[7px] py-[2px] font-mono text-[9px] text-faint transition-colors hover:border-accent hover:text-accent"
        >
          dock
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-[12px]">{children}</div>
      {/* resize grip (bottom-right) */}
      <div
        onPointerDown={onDown("resize")}
        onPointerMove={onMove}
        onPointerUp={onUp}
        title="resize"
        className="absolute right-0 bottom-0 h-[16px] w-[16px] cursor-nwse-resize"
        style={{ background: "linear-gradient(135deg, transparent 50%, color-mix(in srgb, var(--accent) 45%, transparent) 50%)" }}
      />
    </div>
  );
}
