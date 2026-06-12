// ── PRESET LAB — play synth patches via click / computer keys / Web MIDI ──
// Demo web-synth patches for now; swaps to a sampler once real preset
// one-shots are bounced. Voices route through the visitor FX chain.

import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { engine } from "../engine";
import { useEngine } from "../hooks/useEngine";

const PL_START = 48; // C3
const PL_END = 64; // E4
const PL_BLACK = [1, 3, 6, 8, 10];
const PL_KEYMAP: Record<string, number> = {
  a: 48, w: 49, s: 50, e: 51, d: 52, f: 53, t: 54, g: 55, y: 56, h: 57, u: 58, j: 59, k: 60, o: 61, l: 62, p: 63, ";": 64,
};

interface PLKey {
  midi: number;
  black: boolean;
  whiteIdx: number;
}

function plBuildKeys() {
  const keys: PLKey[] = [];
  let whiteIdx = 0;
  for (let m = PL_START; m <= PL_END; m++) {
    const black = PL_BLACK.indexOf(m % 12) >= 0;
    keys.push({ midi: m, black, whiteIdx: black ? whiteIdx - 1 : whiteIdx });
    if (!black) whiteIdx++;
  }
  return { keys, whites: whiteIdx };
}
const PL_LAYOUT = plBuildKeys();

function PresetKeyboard() {
  useEngine(["synth"]);
  const active = engine.activeNotes();
  const down = useRef<Record<number, boolean>>({});

  const on = (m: number) => {
    if (down.current[m]) return;
    down.current[m] = true;
    engine.noteOn(m);
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

  const ww = 100 / PL_LAYOUT.whites;
  return (
    <div className="relative flex h-[108px] touch-none overflow-hidden rounded-[3px] border border-line bg-inset select-none">
      {PL_LAYOUT.keys
        .filter((k) => !k.black)
        .map((k) => (
          <div
            key={k.midi}
            className={
              "relative flex-1 cursor-pointer border-r border-[#1a1a20] transition-colors duration-[50ms] last:border-r-0 " +
              (active.indexOf(k.midi) >= 0 ? "bg-accent" : "bg-[#d4d4d8]")
            }
            {...keyProps(k.midi)}
          />
        ))}
      {PL_LAYOUT.keys
        .filter((k) => k.black)
        .map((k) => (
          <div
            key={k.midi}
            className={
              "absolute top-0 z-[2] h-[60%] cursor-pointer rounded-b-[2px] border border-t-0 border-black transition-colors duration-[50ms] " +
              (active.indexOf(k.midi) >= 0 ? "bg-accent" : "bg-[#121215]")
            }
            style={{ left: (k.whiteIdx + 1) * ww - ww * 0.31 + "%", width: ww * 0.62 + "%" }}
            {...keyProps(k.midi)}
          />
        ))}
    </div>
  );
}

export function PresetLab() {
  const eng = useEngine(["synth", "preset"]);
  const [midiStatus, setMidiStatus] = useState("unavailable");

  // computer keyboard
  useEffect(() => {
    const held: Record<number, boolean> = {};
    const dn = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement;
      const tag = (target.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || target.isContentEditable) return;
      const m = PL_KEYMAP[e.key.toLowerCase()];
      if (m !== undefined && !held[m]) {
        held[m] = true;
        engine.noteOn(m);
      }
    };
    const up = (e: KeyboardEvent) => {
      const m = PL_KEYMAP[e.key.toLowerCase()];
      if (m !== undefined && held[m]) {
        delete held[m];
        engine.noteOff(m);
      }
    };
    window.addEventListener("keydown", dn);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", dn);
      window.removeEventListener("keyup", up);
    };
  }, []);

  // Web MIDI
  useEffect(() => {
    if (!navigator.requestMIDIAccess) {
      setMidiStatus("unsupported");
      return;
    }
    let access: MIDIAccess | null = null;
    const wire = () => {
      let count = 0;
      access!.inputs.forEach((inp) => {
        count++;
        inp.onmidimessage = (msg: MIDIMessageEvent) => {
          if (!msg.data) return;
          const st = msg.data[0] & 0xf0;
          const note = msg.data[1];
          const vel = msg.data[2];
          if (st === 144 && vel > 0) engine.noteOn(note, vel / 127);
          else if (st === 128 || (st === 144 && vel === 0)) engine.noteOff(note);
        };
      });
      setMidiStatus(count ? count + " device" + (count > 1 ? "s" : "") : "no device");
    };
    navigator.requestMIDIAccess().then(
      (acc) => {
        access = acc;
        wire();
        acc.onstatechange = wire;
      },
      () => setMidiStatus("denied"),
    );
  }, []);

  return (
    <div className="flex flex-col gap-[10px] border-t border-line pt-[14px]">
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-mono text-[10.5px] tracking-[0.1em] whitespace-nowrap text-daw-text">PRESET LAB</span>
        <span className="relative inline-flex items-center">
          <select
            value={eng.samplePreset}
            onChange={(e) => engine.setSynthPatch(e.target.value)}
            aria-label="preset"
            className="cursor-pointer appearance-none rounded-[3px] border border-line2 bg-panel2 py-[5px] pr-[26px] pl-[10px] font-mono text-[11px] tracking-[0.03em] text-daw-text transition-colors hover:border-accent focus:border-accent focus:outline-none"
          >
            {engine.samplePresets.map((preset) => (
              <option key={preset.id} value={preset.id} className="bg-panel2 text-daw-text">
                {preset.name}
              </option>
            ))}
          </select>
          <span className="pointer-events-none absolute right-[9px] text-[8px] text-faint">▼</span>
        </span>
        <span
          className={
            "ml-auto rounded-[3px] border px-2 py-1 font-mono text-[10.5px] tracking-[0.05em] whitespace-nowrap " +
            (midiStatus.indexOf("device") > 0
              ? "border-[color-mix(in_srgb,var(--accent)_50%,transparent)] text-accent"
              : "border-line text-faint")
          }
          title="plug in a MIDI controller and just play"
        >
          midi: {midiStatus}
        </span>
      </div>
      <PresetKeyboard />
      <div className="font-mono text-[10.5px] leading-[1.6] tracking-[0.03em] text-faint">
        click · computer keys A–K (W/E/T/Y/U for sharps) · or a MIDI controller — runs through the fx rack above. real
        bounced preset one-shots, pitch-mapped across the keys.
      </div>
    </div>
  );
}
