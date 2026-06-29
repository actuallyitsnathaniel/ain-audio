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
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4" onClick={decline}>
      <div
        className="w-full max-w-[440px] rounded-[6px] border border-line2 bg-panel p-[22px] shadow-[0_20px_60px_rgba(0,0,0,0.5)]"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-[10px] font-mono text-[13px] tracking-[0.06em] text-daw-text">🎹🔌 connect a MIDI keyboard?</h3>
        <p className="mb-[8px] text-[12px] leading-[1.6] text-dim">
          {/* DRAFT — placeholder copy, pending your edit */}
          To play these channels from a hardware MIDI keyboard, your browser needs permission to see your connected music
          devices. In a moment it&apos;ll ask &quot;allow this site to access your MIDI devices?&quot; — that&apos;s this.
        </p>
        <p className="mb-[18px] text-[12px] leading-[1.6] text-faint">
          {/* DRAFT — placeholder copy, pending your edit */}
          We only listen for notes you play; nothing is recorded or sent anywhere. You can skip this and still play with
          your computer keyboard.
        </p>
        <div className="flex items-center justify-end gap-[8px]">
          <button
            onClick={decline}
            className="rounded-[3px] border border-line px-[12px] py-[6px] font-mono text-[11px] text-faint transition-colors hover:text-dim"
          >
            skip — use computer keys
          </button>
          <button
            onClick={confirm}
            className="rounded-[3px] border border-[color-mix(in_srgb,var(--accent)_60%,transparent)] bg-[color-mix(in_srgb,var(--accent)_18%,transparent)] px-[12px] py-[6px] font-mono text-[11px] text-accent transition-colors hover:bg-[color-mix(in_srgb,var(--accent)_28%,transparent)]"
          >
            connect MIDI
          </button>
        </div>
      </div>
    </div>
  );
}
