// ── SHORTCUTS HELP — toolbar chip that opens a centered modal

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

const ctl =
  "flex h-7 items-center justify-center rounded-sm border font-mono text-[10px] transition-colors ";
const idle = "border-line2 text-dim hover:border-accent hover:text-accent";
const on = "border-accent text-accent";

function Sec({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="mb-1.5 text-[9px] tracking-widest text-faint uppercase">
        {title}
      </div>
      <ul className="flex flex-col gap-y-1.5">{children}</ul>
    </div>
  );
}

function Li({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <li>
      <span className="text-dim">{label}</span> · {children}
    </li>
  );
}

export function ShortcutsHelp() {
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        className={ctl + "px-2.5 " + (open ? on : idle)}
        onClick={() => setOpen(true)}
        title="arrangement shortcuts"
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        help
      </button>

      {open &&
        createPortal(
          <div
            className="fixed inset-0 z-100 flex items-center justify-center p-4"
            role="presentation"
          >
            <button
              type="button"
              aria-label="close shortcuts"
              className="absolute inset-0 bg-black/65 backdrop-blur-[2px]"
              onClick={() => setOpen(false)}
            />
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
              className="relative z-1 flex max-h-[min(80vh,640px)] w-full max-w-xl flex-col overflow-hidden rounded-sm border border-line2 bg-[#0e0e12] shadow-[0_24px_80px_rgba(0,0,0,0.65)]"
            >
              <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-4 py-3">
                <h2
                  id={titleId}
                  className="m-0 font-mono text-[11px] tracking-[0.14em] text-accent uppercase"
                >
                  shortcuts
                </h2>
                <button
                  ref={closeRef}
                  type="button"
                  className={ctl + "px-2.5 " + idle}
                  onClick={() => setOpen(false)}
                  title="close (Esc)"
                >
                  ✕
                </button>
              </div>

              {/* .keycap (index.css) inflates unicode key glyphs to match this mono size */}
              <div className="grid gap-5 overflow-y-auto px-4 py-4 font-mono text-[11px] leading-[1.55] tracking-[0.03em] text-faint sm:grid-cols-2">
                <Sec title="focus & navigation">
                  <Li label="focus">
                    click a pane to key-focus (edit keys follow focused pane;
                    space/undo are global)
                  </Li>
                  <Li label="scroll">
                    wheel = tracks · Shift+wheel = time ·{" "}
                    <span className="keycap">⌘</span>+wheel = zoom ·{" "}
                    <span className="keycap">⌘⌥</span>-drag = pan
                  </Li>
                  <Li label="no selection">
                    <span className="keycap">←</span>/
                    <span className="keycap">→</span> move cursor ·{" "}
                    <span className="keycap">⌘</span> fine ·{" "}
                    <span className="keycap">⌘⇧</span> edge jump · Home/End
                  </Li>
                  <Li label="with selection">
                    <span className="keycap">←</span>/
                    <span className="keycap">→</span> nudge · Shift+
                    <span className="keycap">←</span>/
                    <span className="keycap">→</span> resize ·{" "}
                    <span className="keycap">↑</span>/
                    <span className="keycap">↓</span> change track · R reverse ·
                    0 mute
                  </Li>
                  <Li label="play">Space (from cursor)</Li>
                  <Li label="zoom">
                    + / <span className="keycap">−</span> · double-click ruler
                    = zoom to selection
                  </Li>
                  <Li label="grid">
                    <span className="keycap">⌘</span>1 /{" "}
                    <span className="keycap">⌘</span>2
                  </Li>
                </Sec>

                <Sec title="selection, creation & clipboard">
                  <Li label="multi-select">Shift+click</Li>
                  <Li label="marquee">drag empty area</Li>
                  <Li label="create clip">double-click empty lane</Li>
                  <Li label="insert">
                    <span className="keycap">⌘</span>I
                  </Li>
                  <Li label="duplicate">
                    <span className="keycap">⌘</span>D or{" "}
                    <span className="keycap">⌥</span>-drag
                  </Li>
                  <Li label="copy/cut/paste">
                    <span className="keycap">⌘</span>C /{" "}
                    <span className="keycap">⌘</span>X /{" "}
                    <span className="keycap">⌘</span>V
                  </Li>
                  <Li label="delete">
                    <span className="keycap">⌫</span>
                  </Li>
                  <Li label="undo">
                    <span className="keycap">⌘</span>Z
                  </Li>
                </Sec>

                <Sec title="editing, movement & arrangement">
                  <Li label="move clip">
                    drag (<span className="keycap">⌘</span> = free, multi-select
                    drags together)
                  </Li>
                  <Li label="slip content">
                    Shift+<span className="keycap">⌥</span>-drag
                  </Li>
                  <Li label="resize clip">
                    drag edge (<span className="keycap">⌥</span> = stretch
                    content)
                  </Li>
                  <Li label="split">
                    <span className="keycap">⌘</span>E
                  </Li>
                  <Li label="consolidate">
                    <span className="keycap">⌘</span>J{" "}
                    <span className="text-faint">(audio = real bounce)</span>
                  </Li>
                </Sec>

                <Sec title="midi, instruments & special">
                  <Li label="record">Shift+R</Li>
                  <Li label="computer keys as midi">M</Li>
                  <Li label="loop on/off">L</Li>
                  <Li label="loop = selection">
                    <span className="keycap">⌘</span>L
                  </Li>
                  <Li label="select loop">
                    <span className="keycap">⌘⇧</span>L · or click brace
                  </Li>
                  <Li label="brace keys">
                    <span className="keycap">←</span>/
                    <span className="keycap">→</span> nudge ·{" "}
                    <span className="keycap">↑</span>/
                    <span className="keycap">↓</span> by length ·{" "}
                    <span className="keycap">⌘</span>+arrows
                    resize/halve/double
                  </Li>
                  <Li label="brace mouse">
                    drag grips · drag body · Shift-drag ruler to draw
                  </Li>
                  <Li label="move cursor">click timeline / ruler</Li>
                </Sec>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
