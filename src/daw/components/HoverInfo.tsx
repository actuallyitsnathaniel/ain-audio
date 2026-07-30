// Hover help host — one document listener (cheap). Mode tip = floating tooltip at
// 250ms (4× faster than native title). Mode panel = bottom-right Ableton-style info.

import { useEffect, useRef, useState } from "react";
import {
  TIP_DELAY_MS,
  closestTipEl,
  subscribeHoverInfoMode,
  tipTextFrom,
} from "../hover-info";
import { useHoverInfoMode } from "../hooks/useHoverInfoMode";

export function HoverInfoHost() {
  const [mode] = useHoverInfoMode();
  const [text, setText] = useState<string | null>(null);
  const [tipPos, setTipPos] = useState<{ x: number; y: number } | null>(null);
  const [tipVisible, setTipVisible] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeEl = useRef<HTMLElement | null>(null);

  // Drop floating tip when the user flips tips ↔ info
  useEffect(() => {
    return subscribeHoverInfoMode(() => {
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
      activeEl.current = null;
      setTipVisible(false);
      setTipPos(null);
      setText(null);
    });
  }, []);

  useEffect(() => {
    const clearTimer = () => {
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
    };

    const clear = () => {
      clearTimer();
      activeEl.current = null;
      setText(null);
      setTipVisible(false);
      setTipPos(null);
    };

    const showFor = (el: HTMLElement, help: string) => {
      activeEl.current = el;
      setText(help);
      if (mode === "panel") {
        clearTimer();
        setTipVisible(false);
        setTipPos(null);
        return;
      }
      const r = el.getBoundingClientRect();
      const x = Math.min(window.innerWidth - 16, Math.max(16, r.left));
      let y = r.bottom + 8;
      if (y > window.innerHeight - 48) y = Math.max(8, r.top - 8);
      setTipPos({ x, y });
      setTipVisible(false);
      clearTimer();
      timer.current = setTimeout(() => setTipVisible(true), TIP_DELAY_MS);
    };

    const onOver = (e: Event) => {
      const el = closestTipEl(e.target);
      if (!el) return;
      const help = tipTextFrom(el);
      if (!help) return;
      if (el === activeEl.current) return;
      showFor(el, help);
    };

    const onOut = (e: Event) => {
      const me = e as MouseEvent;
      const from = closestTipEl(me.target);
      if (!from || from !== activeEl.current) return;
      const to = closestTipEl(me.relatedTarget);
      if (to === activeEl.current) return;
      if (to) {
        const help = tipTextFrom(to);
        if (help) {
          showFor(to, help);
          return;
        }
      }
      clear();
    };

    const onFocusIn = (e: FocusEvent) => {
      const el = closestTipEl(e.target);
      if (!el) return;
      const help = tipTextFrom(el);
      if (help) showFor(el, help);
    };

    const onFocusOut = (e: FocusEvent) => {
      const from = closestTipEl(e.target);
      if (!from || from !== activeEl.current) return;
      const to = closestTipEl(e.relatedTarget);
      if (to === activeEl.current) return;
      if (to) {
        const help = tipTextFrom(to);
        if (help) {
          showFor(to, help);
          return;
        }
      }
      clear();
    };

    document.addEventListener("mouseover", onOver, true);
    document.addEventListener("mouseout", onOut, true);
    document.addEventListener("focusin", onFocusIn, true);
    document.addEventListener("focusout", onFocusOut, true);
    return () => {
      clearTimer();
      document.removeEventListener("mouseover", onOver, true);
      document.removeEventListener("mouseout", onOut, true);
      document.removeEventListener("focusin", onFocusIn, true);
      document.removeEventListener("focusout", onFocusOut, true);
    };
  }, [mode]);

  const flipUp = tipPos != null && tipPos.y < 40;

  return (
    <div className="pointer-events-none">
      {mode === "tip" && tipVisible && tipPos && text && (
        <div
          data-hover-info-ui
          className="fixed z-80 max-w-72 rounded-[3px] border border-line2 bg-panel2 px-2.5 py-1.5 font-mono text-[11px] leading-snug text-daw-text shadow-[0_6px_20px_-8px_rgba(0,0,0,0.8)]"
          style={{
            left: tipPos.x,
            top: tipPos.y,
            transform: flipUp ? "translateY(-100%) translateY(-8px)" : undefined,
          }}
          role="tooltip"
        >
          {text}
        </div>
      )}

      {mode === "panel" && (
        <aside
          data-hover-info-ui
          data-menu-avoid
          className="fixed right-3 bottom-3 z-70 flex w-[min(100%-1.5rem,22rem)] flex-col gap-1.5 rounded-[4px] border border-line2 bg-[color-mix(in_srgb,var(--panel)_92%,transparent)] px-3 py-2.5 shadow-[0_12px_40px_-16px_rgba(0,0,0,0.85)] backdrop-blur-sm max-[767px]:hidden"
          aria-live="polite"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-[9px] tracking-[0.14em] text-faint uppercase">
              Info
            </span>
            <span className="font-mono text-[9px] tracking-[0.06em] text-faint">
              hover a control
            </span>
          </div>
          <p className="min-h-10 font-mono text-[11px] leading-relaxed text-daw-text">
            {text ?? (
              <span className="text-faint">
                Details for knobs, buttons, and clips show up here.
              </span>
            )}
          </p>
        </aside>
      )}
    </div>
  );
}

/** Transport chips: tips ↔ info panel. */
export function HoverInfoModeToggle() {
  const [mode, setMode] = useHoverInfoMode();
  const chip =
    "rounded-[3px] border px-1.75 py-1 font-mono text-[10px] tracking-[0.05em] transition-colors max-[760px]:hidden ";
  return (
    <div className="flex items-center gap-0.5">
      <button
        type="button"
        className={
          chip +
          (mode === "tip"
            ? "border-accent text-accent"
            : "border-line text-faint hover:border-accent hover:text-dim")
        }
        onClick={() => setMode("tip")}
        data-tip="floating tooltips — show near the control after a short delay (4× faster than the browser default)"
        aria-pressed={mode === "tip"}
      >
        tips
      </button>
      <button
        type="button"
        className={
          chip +
          (mode === "panel"
            ? "border-accent text-accent"
            : "border-line text-faint hover:border-accent hover:text-dim")
        }
        onClick={() => setMode("panel")}
        data-tip="info panel — Ableton-style help in the bottom-right corner as you hover"
        aria-pressed={mode === "panel"}
      >
        info
      </button>
    </div>
  );
}
