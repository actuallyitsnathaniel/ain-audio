// ── MIDI permission gate (host) ─────────────────────────────────────────────
// One app-wide explainer modal that ALWAYS precedes the browser's Web-MIDI prompt,
// no matter which surface asked (arming a channel, the Preset Lab chip, …). Callers
// use `requestMidiEnable()` from ./midi-gate-bus; this host renders the modal and
// only calls engine.enableMidi() on confirm. Mounted once in DawShell.

import { useEffect, useState } from "react";
import { engine } from "../engine";
import { markMidiAsked, setMidiGateHost } from "./midi-gate-bus";

export function MidiGate() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    setMidiGateHost(() => setOpen(true));
    return () => setMidiGateHost(null);
  }, []);

  if (!open) return null;
  const close = () => setOpen(false);
  const confirm = () => {
    markMidiAsked();
    close();
    void engine.enableMidi(); // fires the browser permission prompt now
  };
  const decline = () => {
    markMidiAsked();
    close();
  };

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center bg-black/60 p-4" onClick={decline}>
      <div
        className="w-full max-w-110 rounded-md border border-line2 bg-panel p-5.5 shadow-[0_20px_60px_rgba(0,0,0,0.5)]"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-2.5 font-mono text-[13px] tracking-[0.06em] text-daw-text">
          connect a MIDI keyboard?
        </h3>
        <p className="mb-2 text-[12px] leading-[1.6] text-dim">
          To play from a hardware MIDI keyboard or pad controller, your browser
          needs permission to see connected music devices. Next it&apos;ll ask
          to allow MIDI access — that&apos;s this.
        </p>
        <p className="mb-4.5 text-[12px] leading-[1.6] text-faint">
          We only listen for notes (and sustain / all-notes-off). Nothing is
          recorded or sent anywhere unless you arm ● record. You can skip and
          still play with computer keys.
        </p>
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={decline}
            className="rounded-[3px] border border-line px-3 py-1.5 font-mono text-[11px] text-faint transition-colors hover:text-dim"
          >
            skip — use computer keys
          </button>
          <button
            onClick={confirm}
            className="rounded-[3px] border border-[color-mix(in_srgb,var(--accent)_60%,transparent)] bg-[color-mix(in_srgb,var(--accent)_18%,transparent)] px-3 py-1.5 font-mono text-[11px] text-accent transition-colors hover:bg-[color-mix(in_srgb,var(--accent)_28%,transparent)]"
          >
            connect MIDI
          </button>
        </div>
      </div>
    </div>
  );
}
