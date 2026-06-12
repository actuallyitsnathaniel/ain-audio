// ── ROLL LAB — piano-roll transport + editor, scoped to the current preset ──
// Sits under the Preset Lab. Shows the selected preset's default phrase; play
// sweeps a synced playhead (lookahead scheduler), and the roll is fully editable.
// Switching preset loads that preset's default phrase; "reset" restores it.

import { useEffect, useRef } from "react";
import { engine } from "../../engine";
import { useEngine } from "../../hooks/useEngine";
import { useRafLoop } from "../../hooks/useRafLoop";
import { Knob } from "../Knob";
import { cloneClip } from "../../data/clips";
import { PianoRoll } from "./PianoRoll";
import { abSnap, abSnapActive } from "../../lab-utils";

// imperatively tell the PianoRoll canvas to load a clip (reset / preset change)
function loadClipInto(canvas: HTMLElement | null, clip: ReturnType<typeof cloneClip>) {
  canvas?.dispatchEvent(new CustomEvent("pr-load", { detail: clip }));
}

function PlayStop() {
  useEngine(["transport"]);
  const playing = engine.sequencePlaying;
  return (
    <button
      className={(playing ? abSnapActive : abSnap) + " flex items-center gap-2 px-[12px] py-[6px] text-[11px]"}
      onClick={() => engine.toggleSequence()}
    >
      <span className={playing ? "icon-pause small" : "icon-play small"} aria-hidden />
      {playing ? "stop" : "play"}
    </button>
  );
}

export function RollLab() {
  const eng = useEngine(["transport", "synth", "preset"]);
  const wrapRef = useRef<HTMLDivElement>(null);
  const lastPreset = useRef<string>(eng.samplePreset);

  const canvasEl = () => wrapRef.current?.querySelector("canvas") || null;

  // load the active preset's default phrase when the preset changes
  useEffect(() => {
    if (lastPreset.current === eng.samplePreset) return;
    lastPreset.current = eng.samplePreset;
    const preset = engine.samplePresets.find((p) => p.id === eng.samplePreset);
    if (preset) {
      if (preset.bpmHint) engine.setBpm(preset.bpmHint);
      loadClipInto(canvasEl(), cloneClip(preset.defaultPhrase));
    }
  }, [eng.samplePreset]);

  const resetPhrase = () => {
    const preset = engine.samplePresets.find((p) => p.id === eng.samplePreset);
    if (preset) loadClipInto(canvasEl(), cloneClip(preset.defaultPhrase));
  };

  // live bar/beat readout
  const readout = useRef<HTMLSpanElement>(null);
  useRafLoop(() => {
    if (!readout.current) return;
    const pos = engine.getSequencePosition();
    const bpb = engine.getClip()?.beatsPerBar || 4;
    const bar = Math.floor(pos.beat / bpb) + 1;
    const beat = Math.floor(pos.beat % bpb) + 1;
    readout.current.textContent = pos.playing ? `${bar}.${beat}` : "—";
  });

  return (
    <div className="flex flex-col gap-[10px] border-t border-line pt-[14px]" ref={wrapRef}>
      <div className="flex flex-wrap items-center gap-3">
        <span className="font-mono text-[10.5px] tracking-[0.1em] whitespace-nowrap text-daw-text">PIANO ROLL</span>
        <PlayStop />
        <span className="font-mono text-[10.5px] tabular-nums text-accent" ref={readout}>
          —
        </span>
        <button
          className={(eng.loopOn ? abSnapActive : abSnap) + " px-[10px] py-[5px] text-[10.5px]"}
          onClick={() => engine.setLoop(!eng.loopOn)}
          title="loop the phrase"
        >
          loop
        </button>
        <button className={abSnap + " px-[10px] py-[5px] text-[10.5px]"} onClick={resetPhrase} title="restore the preset's default phrase">
          reset
        </button>
        <span className="ml-auto flex items-center gap-2">
          <Knob
            value={eng.bpm}
            min={60}
            max={180}
            defaultValue={eng.samplePresets.find((p) => p.id === eng.samplePreset)?.bpmHint || 110}
            size={40}
            onChange={(v) => engine.setBpm(v)}
            label="tempo"
            fmt={(v) => Math.round(v) + " bpm"}
          />
        </span>
      </div>
      <PianoRoll />
      <div className="flex flex-col gap-[3px] font-mono text-[10.5px] leading-[1.55] tracking-[0.03em] text-faint">
        <span>
          <span className="text-dim">draw / select</span> · click empty to draw · click a note to select · shift+click
          to add · drag empty for a marquee · double-click / right-click to delete · tap left keys to hear
        </span>
        <span>
          <span className="text-dim">keys</span> · ←/→ nudge · ↑/↓ transpose · shift+↑/↓ octave · shift+←/→ resize ·
          ⌘/ctrl+↑/↓ velocity · ⌥ free move · ⌥+drag or ⌘/ctrl+D duplicate · ⌘/ctrl+A all · ⌫ delete
        </span>
        <span>
          <span className="text-dim">move around</span> · scroll = pitch · shift+scroll = time · ⌘/ctrl+scroll = zoom ·
          space (or middle-drag) to pan · state shows top-right
        </span>
      </div>
    </div>
  );
}
