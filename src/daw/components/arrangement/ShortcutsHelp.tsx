// ── SHORTCUTS HELP — compact chip + popover (replaces the long footer <details>)

import { useEffect, useRef, useState, type ReactNode } from "react";

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
      <div className="mb-0.5 text-[9px] tracking-widest text-faint uppercase">
        {title}
      </div>
      <ul className="flex flex-col gap-y-1">{children}</ul>
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
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onPtr = (e: PointerEvent) => {
      const el = root.current;
      if (!el || el.contains(e.target as Node)) return;
      setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPtr, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPtr, true);
    };
  }, [open]);

  return (
    <div ref={root} className="relative shrink-0">
      <button
        type="button"
        className={ctl + "px-2.5 " + (open ? on : idle)}
        onClick={() => setOpen((o) => !o)}
        title="arrangement shortcuts"
        aria-expanded={open}
      >
        help
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="arrangement shortcuts"
          className="absolute bottom-[calc(100%+6px)] left-0 z-40 max-h-[min(70vh,520px)] w-[min(360px,calc(100vw-24px))] overflow-y-auto rounded-sm border border-line bg-[#0e0e12] p-3 shadow-[0_12px_40px_rgba(0,0,0,0.55)] font-mono text-[10.5px] leading-[1.55] tracking-[0.03em] text-faint"
        >
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-[9px] tracking-widest text-faint uppercase">
              shortcuts
            </span>
            <button
              type="button"
              className={ctl + "px-2 " + idle}
              onClick={() => setOpen(false)}
              title="close"
            >
              ✕
            </button>
          </div>

          {/* .keycap (index.css) inflates unicode key glyphs to match this mono size */}
          <div className="flex flex-col gap-y-2.5">
            <Sec title="focus & navigation">
              <Li label="focus">
                click a pane to key-focus (edit keys follow focused pane;
                space/undo are global)
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
                <span className="keycap">↓</span> change track · R reverse · 0
                mute
              </Li>
              <Li label="play">Space (from cursor)</Li>
              <Li label="zoom">
                + / <span className="keycap">−</span>
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
                drag edge (<span className="keycap">⌥</span> = stretch content)
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
              <Li label="loop">L · or shift+drag the ruler</Li>
              <Li label="move cursor">click timeline / ruler</Li>
            </Sec>
          </div>
        </div>
      )}
    </div>
  );
}
