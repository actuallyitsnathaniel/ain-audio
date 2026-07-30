// ── SESSION CLUSTER — global I/O prefs + new project (not transport)

import { useState } from "react";
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
