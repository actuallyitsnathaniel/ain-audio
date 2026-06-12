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

function PresetKeyboard({ octave, vel }: { octave: number; vel: number }) {
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
    <div className="relative flex h-[108px] touch-none overflow-hidden rounded-[3px] border border-line bg-inset select-none">
      {layout.keys
        .filter((k) => !k.black)
        .map((k) => (
          <div
            key={k.midi}
            className={
              "relative flex flex-1 cursor-pointer items-end justify-center border-r border-[#1a1a20] pb-[5px] transition-colors duration-[50ms] last:border-r-0 " +
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
  // computer-keyboard MIDI state (Ableton convention): Z/X octave, C/V velocity
  const [octave, setOctave] = useState(0); // semitone offset = octave * 12
  const [vel, setVel] = useState(0.85);
  // refs so the keydown closure always reads the latest octave/velocity
  const octaveRef = useRef(0);
  const velRef = useRef(0.85);
  octaveRef.current = octave;
  velRef.current = vel;

  // computer keyboard
  useEffect(() => {
    // map each held letter to the ABSOLUTE midi it triggered, so the right note
    // releases even if the octave changed while the key was down.
    const held: Record<string, number> = {};
    const dn = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement;
      const tag = (target.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || target.isContentEditable) return;
      const key = e.key.toLowerCase();
      // Z/X shift octave (±2 range), C/V step velocity — Ableton's typing keyboard
      if (key === "z") return setOctave((o) => Math.max(-3, o - 1));
      if (key === "x") return setOctave((o) => Math.min(3, o + 1));
      if (key === "c") return setVel((v) => Math.max(0.1, Math.round((v - 0.1) * 100) / 100));
      if (key === "v") return setVel((v) => Math.min(1, Math.round((v + 0.1) * 100) / 100));
      const base = PL_KEYMAP[key];
      if (base !== undefined && held[key] === undefined) {
        const m = base + octaveRef.current * 12;
        held[key] = m;
        engine.noteOn(m, velRef.current);
      }
    };
    const up = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (held[key] !== undefined) {
        engine.noteOff(held[key]);
        delete held[key];
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
        <span className="ml-auto flex items-center gap-[6px]">
          <span
            className="rounded-[3px] border border-line px-2 py-1 font-mono text-[10.5px] tracking-[0.05em] whitespace-nowrap text-faint"
            title="Z / X shift the typing-keyboard octave"
          >
            oct <span className={"text-accent " + (octave !== 0 ? "" : "opacity-60")}>{octave >= 0 ? "+" + octave : octave}</span>
          </span>
          <span
            className="rounded-[3px] border border-line px-2 py-1 font-mono text-[10.5px] tracking-[0.05em] whitespace-nowrap text-faint"
            title="C / V lower / raise the typing-keyboard velocity"
          >
            vel <span className="text-accent">{Math.round(vel * 127)}</span>
          </span>
          <span
            className={
              "rounded-[3px] border px-2 py-1 font-mono text-[10.5px] tracking-[0.05em] whitespace-nowrap " +
              (midiStatus.indexOf("device") > 0
                ? "border-[color-mix(in_srgb,var(--accent)_50%,transparent)] text-accent"
                : "border-line text-faint")
            }
            title="plug in a MIDI controller and just play"
          >
            midi: {midiStatus}
          </span>
        </span>
      </div>
      <PresetKeyboard octave={octave} vel={vel} />
      <div className="font-mono text-[10.5px] leading-[1.6] tracking-[0.03em] text-faint">
        click · computer keys A–K (W/E/T/Y/U for sharps) · <span className="text-dim">Z / X</span> octave down / up ·{" "}
        <span className="text-dim">C / V</span> velocity down / up · or a MIDI controller — runs through the fx rack
        above. real bounced preset one-shots, pitch-mapped across the keys.
      </div>
    </div>
  );
}
