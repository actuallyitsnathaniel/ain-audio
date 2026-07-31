// ── SESSION CLUSTER — global I/O prefs + project I/O (not transport)

import { useRef, useState } from "react";
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
const danger =
  "border-line2 text-faint hover:border-[#e0654f] hover:text-[#e98c79]";

export function SessionCluster({
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
  const [rereadAccept, setRereadAccept] = useState(false);
  const [busy, setBusy] = useState<"save" | "open" | "bounce" | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const openPrefs = () => {
    const go = () => onPrefsOpenChange(true);
    if (!engine.hasAudioAccepted() && onRequestAccept) {
      onRequestAccept(go);
      return;
    }
    onPrefsOpenChange(!prefsOpen);
  };

  const ioLive =
    prefsOpen ||
    eng.inputStatus === "live" ||
    eng.inputStatus === "pending";

  const saveAin = async () => {
    if (busy) return;
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
    )
      return;
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
    const name =
      window.prompt("Export mix as…", "mix")?.trim() || "mix";
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
      window.alert(
        e instanceof Error ? e.message : "Couldn't bounce mix",
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="ml-auto flex flex-col items-end gap-1.5">
      <div className="relative flex items-center gap-1.5">
        <span className="font-mono text-[9px] tracking-widest text-faint">
          SESSION
        </span>
        <button
          type="button"
          data-audio-prefs-open
          className={ctl + px + onOff(ioLive)}
          onClick={() => {
            if (prefsOpen) onPrefsOpenChange(false);
            else openPrefs();
          }}
          title="I/O — input/output device, buffer, latency, monitor, system"
        >
          {eng.inputStatus === "pending"
            ? "I/O…"
            : eng.inputStatus === "live"
              ? "I/O · live"
              : eng.inputStatus === "denied"
                ? "I/O · denied"
                : "I/O"}
        </button>
        <button
          type="button"
          className={ctl + px + onOff(eng.bouncing)}
          disabled={busy !== null}
          onClick={() => void bounceMix()}
          title="Bounce mix — realtime record of the master bus (audio + MIDI + FX)"
        >
          {busy === "bounce" || eng.bouncing ? "bounce…" : "bounce mix"}
        </button>
        <button
          type="button"
          className={ctl + px + onOff(false)}
          disabled={busy !== null}
          onClick={() => void saveAin()}
          title="Save AIN project (.ain) — arrangement + collected imports"
        >
          {busy === "save" ? "save…" : "save .ain"}
        </button>
        <button
          type="button"
          className={ctl + px + onOff(false)}
          disabled={busy !== null}
          onClick={() => fileRef.current?.click()}
          title="Open AIN project (.ain) — replaces current studio"
        >
          {busy === "open" ? "open…" : "open .ain"}
        </button>
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
        <button
          type="button"
          className={ctl + px + danger}
          onClick={onNewProject}
          title="clear the studio + all imported audio, start fresh"
        >
          new project
        </button>
        {prefsOpen && (
          <AudioPrefsPanel
            onClose={() => onPrefsOpenChange(false)}
            onRereadAccept={() => setRereadAccept(true)}
          />
        )}
      </div>

      <AudioSessionNudges />

      {rereadAccept && (
        <div data-audio-accept className="w-full max-w-[min(340px,calc(100vw-24px))]">
          <AudioAcceptSheet reread onDone={() => setRereadAccept(false)} />
        </div>
      )}
    </div>
  );
}
