// ── FILE MENU — Ableton-style File panel (top-left, above transport)
// New / Open / Save · Bounce · I/O prefs. Project + audio session actions live here.

import { useEffect, useRef, useState } from "react";
import { engine } from "../../engine";
import { useEngine } from "../../hooks/useEngine";
import { AudioPrefsPanel } from "./AudioPrefsPanel";
import { AudioAcceptSheet } from "./AudioAcceptSheet";
import { AudioSessionNudges } from "./AudioSessionNudges";

const ctl =
  "flex h-7 items-center justify-center rounded-sm border font-mono text-[10px] transition-colors ";
const px = "px-2.5 ";
const onOff = (on: boolean) =>
  on
    ? "border-accent text-accent"
    : "border-line2 text-faint hover:border-accent hover:text-dim";

const item =
  "flex w-full items-center justify-between gap-3 px-2.5 py-1.5 text-left font-mono text-[10.5px] text-dim transition-colors hover:bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] hover:text-daw-text disabled:opacity-40";
const dangerItem =
  "flex w-full items-center justify-between gap-3 px-2.5 py-1.5 text-left font-mono text-[10.5px] text-[#e98c79] transition-colors hover:bg-[color-mix(in_srgb,#e0654f_14%,transparent)] disabled:opacity-40";
const sep = "my-1 border-t border-line2";
const kbd = "font-mono text-[9px] text-faint";

export function FileMenu({
  onRequestAccept,
  onNewProject,
  prefsOpen,
  onPrefsOpenChange,
}: {
  onRequestAccept?: (afterContinue: () => void) => void;
  onNewProject: () => void;
  /** Controlled I/O panel — shared with StudioStatusStrip. */
  prefsOpen: boolean;
  onPrefsOpenChange: (open: boolean) => void;
}) {
  const eng = useEngine(["transport"]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [rereadAccept, setRereadAccept] = useState(false);
  const [busy, setBusy] = useState<"save" | "open" | "bounce" | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    const onPtr = (e: PointerEvent) => {
      const el = root.current;
      if (!el) return;
      const t = e.target as Node;
      if (el.contains(t)) return;
      if ((t as HTMLElement).closest?.("[data-audio-prefs-open]")) return;
      if ((t as HTMLElement).closest?.("[data-audio-accept]")) return;
      setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPtr, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPtr, true);
    };
  }, [menuOpen]);

  const openPrefs = () => {
    setMenuOpen(false);
    const go = () => onPrefsOpenChange(true);
    if (!engine.hasAudioAccepted() && onRequestAccept) {
      onRequestAccept(go);
      return;
    }
    onPrefsOpenChange(true);
  };

  const ioLive =
    prefsOpen ||
    eng.inputStatus === "live" ||
    eng.inputStatus === "pending";

  const saveAin = async () => {
    if (busy) return;
    setMenuOpen(false);
    const name =
      window.prompt("Save AIN project as…", "project")?.trim() || "project";
    setBusy("save");
    try {
      await engine.exportAin(name);
    } catch (e) {
      window.alert(
        e instanceof Error ? e.message : "Couldn't save AIN project",
      );
    } finally {
      setBusy(null);
    }
  };

  const openAin = async (file: File) => {
    if (busy) return;
    if (
      !window.confirm(
        `Open “${file.name}”? This replaces the current studio and imported audio (same as New project). Continue?`,
      )
    ) {
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    setBusy("open");
    try {
      await engine.importAin(file);
    } catch (e) {
      window.alert(
        e instanceof Error ? e.message : "Couldn't open AIN project",
      );
    } finally {
      setBusy(null);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const bounceMix = async () => {
    if (busy) return;
    setMenuOpen(false);
    const name = window.prompt("Export mix as…", "mix")?.trim() || "mix";
    if (
      !window.confirm(
        "Bounce will play the arrangement in real time and download the mix (you’ll hear it). Continue?",
      )
    )
      return;
    setBusy("bounce");
    try {
      await engine.bounceMix(name);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : "Couldn't bounce mix");
    } finally {
      setBusy(null);
    }
  };

  const newProject = () => {
    setMenuOpen(false);
    onNewProject();
  };

  const fileLabel =
    busy === "save"
      ? "File · saving…"
      : busy === "open"
        ? "File · opening…"
        : busy === "bounce" || eng.bouncing
          ? "File · bounce…"
          : ioLive
            ? eng.inputStatus === "pending"
              ? "File · I/O…"
              : "File · I/O live"
            : "File";

  return (
    <div className="flex flex-col gap-1.5">
      <div ref={root} className="relative flex items-center gap-2">
        <button
          type="button"
          data-file-menu
          className={ctl + px + onOff(menuOpen || ioLive || busy !== null)}
          onClick={() => setMenuOpen((o) => !o)}
          aria-expanded={menuOpen}
          title="File — new, open, save, bounce, I/O"
        >
          {fileLabel}
          <span className="ml-1.5 text-[8px] text-faint" aria-hidden>
            ▾
          </span>
        </button>

        {menuOpen && (
          <div
            role="menu"
            aria-label="File"
            className="absolute top-[calc(100%+4px)] left-0 z-50 min-w-[220px] rounded-sm border border-line bg-[#0e0e12] py-1 shadow-[0_12px_40px_rgba(0,0,0,0.55)]"
          >
            <button
              type="button"
              role="menuitem"
              className={dangerItem}
              disabled={busy !== null}
              onClick={newProject}
            >
              <span>New Project…</span>
            </button>
            <button
              type="button"
              role="menuitem"
              className={item}
              disabled={busy !== null}
              onClick={() => {
                setMenuOpen(false);
                fileRef.current?.click();
              }}
            >
              <span>Open .ain…</span>
            </button>
            <button
              type="button"
              role="menuitem"
              className={item}
              disabled={busy !== null}
              onClick={() => void saveAin()}
            >
              <span>{busy === "save" ? "Saving…" : "Save .ain…"}</span>
            </button>

            <div className={sep} role="separator" />

            <button
              type="button"
              role="menuitem"
              className={item}
              disabled={busy !== null}
              onClick={() => void bounceMix()}
            >
              <span>
                {busy === "bounce" || eng.bouncing
                  ? "Bouncing…"
                  : "Bounce Mix…"}
              </span>
            </button>

            <div className={sep} role="separator" />

            <button
              type="button"
              role="menuitem"
              data-audio-prefs-open
              className={item}
              onClick={openPrefs}
            >
              <span>
                I/O Preferences…
                {eng.inputStatus === "live"
                  ? " · live"
                  : eng.inputStatus === "denied"
                    ? " · denied"
                    : eng.inputStatus === "pending"
                      ? "…"
                      : ""}
              </span>
              <span className={kbd}>audio</span>
            </button>
          </div>
        )}

        <input
          ref={fileRef}
          type="file"
          accept=".ain,application/vnd.ain.project+zip,application/zip"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void openAin(f);
          }}
        />

        {prefsOpen && (
          <AudioPrefsPanel
            onClose={() => onPrefsOpenChange(false)}
            onRereadAccept={() => setRereadAccept(true)}
          />
        )}
      </div>

      <AudioSessionNudges />

      {rereadAccept && (
        <div
          data-audio-accept
          className="w-full max-w-[min(340px,calc(100vw-24px))]"
        >
          <AudioAcceptSheet reread onDone={() => setRereadAccept(false)} />
        </div>
      )}
    </div>
  );
}
