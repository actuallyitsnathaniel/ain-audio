// ── LOOP LANES — loopable melodic samples layered alongside the drums ─────
// Each loop is a row: toggle it in, level knob, mute + solo. Loops start
// bar-aligned, playbackRate-matched to the grid tempo. Loops come from two
// sources: build-time (auto-discovered from src/assets/loops/) and runtime
// (drop an audio file here / pick one → decoded in-browser as a session lane).

import { useRef, useState } from "react";
import type { DragEvent as ReactDragEvent } from "react";
import { engine } from "../../engine";
import { useEngine } from "../../hooks/useEngine";
import { Knob } from "../Knob";

// decode + register every audio file in a dropped/picked list as a session loop.
async function importFiles(files: FileList | File[]) {
  for (const f of Array.from(files)) {
    if (f.type.startsWith("audio/") || /\.(m4a|flac|ogg|wav|mp3|aac)$/i.test(f.name)) {
      await engine.addLoop(f);
    }
  }
}

export function LoopLanes() {
  useEngine(["clip", "transport"]);
  const loops = engine.loops;
  const state = engine.sequence.loops;
  const [over, setOver] = useState(false); // drag-hover highlight
  const fileInput = useRef<HTMLInputElement>(null);

  // preventDefault on dragover is what stops the browser from navigating to /
  // opening the dropped audio file in a new tab — the bug we're fixing.
  const onDragOver = (e: ReactDragEvent) => {
    e.preventDefault();
    if (!over) setOver(true);
  };
  const onDragLeave = (e: ReactDragEvent) => {
    if (e.currentTarget === e.target) setOver(false);
  };
  const onDrop = (e: ReactDragEvent) => {
    e.preventDefault();
    setOver(false);
    if (e.dataTransfer.files.length) void importFiles(e.dataTransfer.files);
  };

  const dropProps = { onDragOver, onDragLeave, onDrop };
  const ring = over ? " border-accent bg-[color-mix(in_srgb,var(--accent)_8%,#0e0e12)]" : "";

  const pickButton = (
    <button
      onClick={() => fileInput.current?.click()}
      className="rounded-[3px] border border-line2 px-[9px] py-[4px] font-mono text-[9px] tracking-[0.06em] text-dim transition-colors hover:border-accent hover:text-accent"
      title="load an audio file as a loop lane"
    >
      + load loop
    </button>
  );
  const hiddenInput = (
    <input
      ref={fileInput}
      type="file"
      accept="audio/*,.m4a,.flac,.ogg,.wav,.mp3,.aac"
      multiple
      className="hidden"
      onChange={(e) => {
        if (e.target.files?.length) void importFiles(e.target.files);
        e.target.value = ""; // allow re-picking the same file
      }}
    />
  );

  if (!loops.length) {
    return (
      <div
        {...dropProps}
        className={"rounded-[4px] border border-dashed border-line bg-[#0e0e12] px-[14px] py-[16px] font-mono text-[10.5px] leading-[1.6] tracking-[0.03em] text-faint transition-colors" + ring}
      >
        <div className="mb-[10px] flex items-center gap-[10px]">
          <span className="text-dim">loop lanes</span>
          {pickButton}
          {hiddenInput}
        </div>
        <span className="text-daw-text">drop an audio file here</span> to layer a loop over the beat (session only), or drop files
        in <span className="text-daw-text">src/assets/loops/</span> to bake them in. encode tempo + length in the filename, e.g.{" "}
        <span className="text-daw-text">dusty-keys-120bpm-2bar.m4a</span> — they lock to the grid tempo automatically.
      </div>
    );
  }

  return (
    <div {...dropProps} className={"flex flex-col gap-[6px] rounded-[4px] border border-transparent p-[2px] transition-colors" + ring}>
      <div className="flex items-center gap-[10px]">
        <span className="font-mono text-[10px] tracking-[0.08em] text-faint">LOOP LANES</span>
        {pickButton}
        {hiddenInput}
        <span className="font-mono text-[9px] tracking-[0.03em] text-faint">drop audio to add</span>
      </div>
      {loops.map((l) => {
        const st = state[l.id];
        if (!st) return null;
        return (
          <div
            key={l.id}
            className={
              "flex items-center gap-[10px] rounded-[4px] border px-[10px] py-[7px] transition-colors " +
              (st.on ? "border-line2 bg-panel2" : "border-line bg-[#101014]")
            }
          >
            <button
              onClick={() => engine.toggleLoop(l.id)}
              className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-line2"
              aria-label={"toggle " + l.name}
              title="layer this loop in"
            >
              <span className={"h-[6px] w-[6px] rounded-full transition-[background,box-shadow] " + (st.on ? "bg-accent shadow-[0_0_6px_var(--accent)]" : "bg-faint")} />
            </button>

            <span className={"min-w-[90px] font-mono text-[11px] tracking-[0.03em] " + (st.on ? "text-daw-text" : "text-dim")}>{l.name}</span>
            <span className="font-mono text-[9px] tracking-[0.04em] text-faint">
              {l.rootBpm}bpm · {l.bars}bar
            </span>

            <span className="ml-auto flex items-center gap-[10px]">
              <Knob value={st.level} min={0} max={1} defaultValue={0.8} size={34} onChange={(v) => engine.setLoopLevel(l.id, v)} label="lvl" disabled={!st.on} fmt={(v) => Math.round(v * 100) + "%"} />
              <button
                onClick={() => engine.toggleLoopSync(l.id)}
                title={st.sync ? "locked to grid tempo — click to play at original speed" : "playing at original speed — click to lock to grid tempo"}
                className={
                  "rounded-[3px] border px-[7px] py-[4px] font-mono text-[9px] tracking-[0.06em] transition-colors " +
                  (st.sync ? "border-[color-mix(in_srgb,var(--accent)_60%,transparent)] bg-[color-mix(in_srgb,var(--accent)_22%,transparent)] text-accent" : "border-line text-faint hover:text-dim")
                }
              >
                lock
              </button>
              <button
                onClick={() => engine.toggleLoopMute(l.id)}
                title="mute"
                className={
                  "rounded-[3px] border px-[7px] py-[4px] font-mono text-[9px] tracking-[0.06em] transition-colors " +
                  (st.mute ? "border-[color-mix(in_srgb,#e0654f_60%,transparent)] bg-[color-mix(in_srgb,#e0654f_22%,transparent)] text-[#e98c79]" : "border-line text-faint hover:text-dim")
                }
              >
                M
              </button>
              <button
                onClick={() => engine.toggleLoopSolo(l.id)}
                title="solo"
                className={
                  "rounded-[3px] border px-[7px] py-[4px] font-mono text-[9px] tracking-[0.06em] transition-colors " +
                  (st.solo ? "border-[color-mix(in_srgb,var(--accent)_60%,transparent)] bg-[color-mix(in_srgb,var(--accent)_22%,transparent)] text-accent" : "border-line text-faint hover:text-dim")
                }
              >
                S
              </button>
              <button
                onClick={() => engine.removeLoop(l.id)}
                title="remove this loop"
                aria-label={"remove " + l.name}
                className="rounded-[3px] border border-line px-[7px] py-[4px] font-mono text-[9px] text-faint transition-colors hover:border-[color-mix(in_srgb,#e0654f_60%,transparent)] hover:text-[#e98c79]"
              >
                ✕
              </button>
            </span>
          </div>
        );
      })}
    </div>
  );
}
