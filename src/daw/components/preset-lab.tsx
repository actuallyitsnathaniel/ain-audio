// ── PRESET KEYBOARD — the playable on-screen keyboard ─────────────────────────
// Extracted from the old PRESET LAB panel; the merged Instrument panel owns the
// octave/vel/computer-keyboard state and renders this. Voices route through the FX
// chain. (The typing keymap lives in ./audio-lab/synth-ui.)

import { useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { engine } from "../engine";
import { useEngine } from "../hooks/useEngine";

const PL_START = 48; // C3
const PL_END = 64; // E4
const PL_BLACK = [1, 3, 6, 8, 10];

interface PLKey {
  midi: number;
  black: boolean;
  whiteIdx: number;
}

// Build the key layout for a given octave offset. Positions are identical across
// octaves; only the underlying MIDI numbers shift, so the lit keys + clicked
// pitches follow the typing-keyboard's Z/X octave shift.
function plBuildKeys(octave: number) {
  const keys: PLKey[] = [];
  let whiteIdx = 0;
  const shift = octave * 12;
  for (let m = PL_START; m <= PL_END; m++) {
    const black = PL_BLACK.indexOf(m % 12) >= 0;
    keys.push({ midi: m + shift, black, whiteIdx: black ? whiteIdx - 1 : whiteIdx });
    if (!black) whiteIdx++;
  }
  return { keys, whites: whiteIdx };
}

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const midiLabel = (m: number) => NOTE_NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);

export function PresetKeyboard({ octave, vel }: { octave: number; vel: number }) {
  useEngine(["synth"]);
  const active = engine.activeNotes();
  const layout = plBuildKeys(octave);
  const down = useRef<Record<number, boolean>>({});

  const on = (m: number) => {
    if (down.current[m]) return;
    down.current[m] = true;
    engine.noteOn(m, vel);
  };
  const off = (m: number) => {
    if (!down.current[m]) return;
    delete down.current[m];
    engine.noteOff(m);
  };

  const keyProps = (m: number) => ({
    onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      if (e.currentTarget.releasePointerCapture) e.currentTarget.releasePointerCapture(e.pointerId);
      on(m);
    },
    onPointerUp: () => off(m),
    onPointerLeave: () => off(m),
    onPointerEnter: (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.buttons > 0) on(m);
    },
  });

  const ww = 100 / layout.whites;
  return (
    <div className="relative flex h-27 touch-none overflow-hidden rounded-[3px] border border-line bg-inset select-none">
      {layout.keys
        .filter((k) => !k.black)
        .map((k) => (
          <div
            key={k.midi}
            className={
              "relative flex flex-1 cursor-pointer items-end justify-center border-r border-panel2 pb-1.25 transition-colors duration-50 last:border-r-0 " +
              (active.indexOf(k.midi) >= 0 ? "bg-accent" : "bg-[#d4d4d8]")
            }
            {...keyProps(k.midi)}
          >
            {k.midi % 12 === 0 ? (
              <span className="pointer-events-none font-mono text-[8px] tracking-[0.02em] text-[#6a6a72]">{midiLabel(k.midi)}</span>
            ) : null}
          </div>
        ))}
      {layout.keys
        .filter((k) => k.black)
        .map((k) => (
          <div
            key={k.midi}
            className={
              "absolute top-0 z-2 h-[60%] cursor-pointer rounded-b-xs border border-t-0 border-black transition-colors duration-50 " +
              (active.indexOf(k.midi) >= 0 ? "bg-accent" : "bg-[#121215]")
            }
            style={{ left: (k.whiteIdx + 1) * ww - ww * 0.31 + "%", width: ww * 0.62 + "%" }}
            {...keyProps(k.midi)}
          />
        ))}
    </div>
  );
}

