// ── LOOP LANES — loopable melodic samples layered alongside the drums ─────
// Each loop is a row: toggle it in, level knob, mute + solo. Loops start
// bar-aligned, playbackRate-matched to the grid tempo. Loops come from two
// sources: build-time (auto-discovered from src/assets/loops/) and runtime
// (drop an audio file here / pick one → decoded in-browser as a session lane).

import { useRef, useState } from "react";
import type { DragEvent as ReactDragEvent, PointerEvent as ReactPointerEvent } from "react";
import { engine } from "../../engine";
import { useEngine } from "../../hooks/useEngine";
import { useRafLoop } from "../../hooks/useRafLoop";
import { Knob } from "../Knob";
import type { LoopLane } from "../../data/kits";

// ── per-loop A→B region strip ──────────────────────────────────────────────
// A small waveform canvas with two draggable handles. Region is stored as 0..1
// fractions of the buffer; handles snap to the loop's 1/16 grid (⌘/ctrl = free).
function LoopWave({ loop }: { loop: LoopLane }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drag = useRef<"a" | "b" | null>(null);
  const st = engine.sequence.loops[loop.id];
  const a = st?.a ?? 0;
  const b = st?.b ?? 1;
  const snapStep = 1 / Math.max(1, loop.bars * 16); // one 1/16 of the loop

  const fracFromEvent = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    let f = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    if (!e.metaKey && !e.ctrlKey) f = Math.round(f / snapStep) * snapStep; // snap to grid
    return f;
  };
  const onDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const f = fracFromEvent(e);
    drag.current = Math.abs(f - a) <= Math.abs(f - b) ? "a" : "b"; // grab nearer handle
    onMove(e);
  };
  const onMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drag.current) return;
    const f = fracFromEvent(e);
    if (drag.current === "a") engine.setLoopRegion(loop.id, f, b);
    else engine.setLoopRegion(loop.id, a, f);
  };
  const onUp = () => {
    drag.current = null;
  };

  useRafLoop(() => {
    const cv = ref.current;
    if (!cv) return;
    const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth,
      h = cv.clientHeight;
    if (cv.width !== Math.floor(w * dpr) || cv.height !== Math.floor(h * dpr)) {
      cv.width = Math.floor(w * dpr);
      cv.height = Math.floor(h * dpr);
    }
    const g = cv.getContext("2d");
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const peaks = engine.loopPeaks(loop.id, Math.max(32, Math.floor(w)));
    const cs = getComputedStyle(cv);
    const accent = cs.getPropertyValue("--accent").trim() || "#54ADBD";
    const mid = h / 2;

    // snap grid (behind the waveform): a line at every 1/16, brighter on beats
    // (every 4th) and bars (every 16th) — shows exactly where A/B will land.
    const divs = Math.max(1, loop.bars * 16); // total 1/16 cells
    if (divs <= w / 2) {
      // skip if cells would be sub-2px (unreadable); waveform still shows
      for (let i = 0; i <= divs; i++) {
        const x = (i / divs) * w;
        const onBar = i % 16 === 0;
        const onBeat = i % 4 === 0;
        g.fillStyle = onBar ? "rgba(255,255,255,0.55)" : onBeat ? "rgba(255,255,255,0.32)" : "rgba(255,255,255,0.16)";
        g.fillRect(Math.min(w - 1, Math.round(x)), 0, onBar ? 1.5 : 1, h);
      }
    }

    // waveform
    g.fillStyle = "#2a2a32";
    if (peaks) {
      const bw = w / peaks.length;
      for (let i = 0; i < peaks.length; i++) {
        const ph = Math.max(1, peaks[i] * (h - 4));
        g.fillRect(i * bw, mid - ph / 2, Math.max(1, bw - 0.5), ph);
      }
    }
    // shade outside A..B
    g.fillStyle = "rgba(8,8,10,0.62)";
    g.fillRect(0, 0, a * w, h);
    g.fillRect(b * w, 0, w - b * w, h);
    // A/B handles
    g.fillStyle = accent;
    g.fillRect(a * w - 1, 0, 2, h);
    g.fillRect(b * w - 1, 0, 2, h);
    // playhead — where in the sample we currently are (white line)
    const pos = engine.loopPosition(loop.id); // 0..1 of the buffer, or -1
    if (pos >= 0) {
      g.fillStyle = "#ffffff";
      g.globalAlpha = 0.9;
      g.fillRect(pos * w, 0, 1.5, h);
      g.globalAlpha = 1;
    }
  });

  return (
    <canvas
      ref={ref}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      title="drag the A / B edges to set the loop region · gridlines mark the 1/16 snap (⌘/ctrl to ignore)"
      className="h-[44px] w-full cursor-ew-resize rounded-[3px] border border-line bg-[#0c0c10]"
    />
  );
}

// editable bpm + key (chord) for a loop. Click a value to type it; detected from
// the filename on import, but always user-overridable.
function LoopMetaEdit({ loop }: { loop: LoopLane }) {
  const [edit, setEdit] = useState<"bpm" | "key" | null>(null);
  const inputCls = "rounded-[2px] border border-accent bg-panel2 px-[3px] py-[1px] font-mono text-[9px] text-daw-text focus:outline-none";

  if (edit === "bpm") {
    return (
      <input
        autoFocus
        type="number"
        defaultValue={loop.rootBpm}
        min={40}
        max={300}
        onBlur={(e) => {
          if (e.target.value) engine.setLoopBpm(loop.id, parseInt(e.target.value, 10));
          setEdit(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") setEdit(null);
        }}
        className={inputCls + " w-[42px]"}
        aria-label="loop bpm"
      />
    );
  }
  if (edit === "key") {
    return (
      <input
        autoFocus
        defaultValue={loop.key ?? ""}
        placeholder="key"
        maxLength={8}
        onBlur={(e) => {
          engine.setLoopKey(loop.id, e.target.value);
          setEdit(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") setEdit(null);
        }}
        className={inputCls + " w-[44px]"}
        aria-label="loop key"
      />
    );
  }
  return (
    <span className="flex items-center gap-[5px]">
      <button onClick={() => setEdit("bpm")} title="loop tempo — click to edit" className="tabular-nums transition-colors hover:text-accent">
        {loop.rootBpm}bpm
      </button>
      <button onClick={() => setEdit("key")} title="loop key / chord — click to edit" className={"transition-colors hover:text-accent " + (loop.key ? "text-dim" : "italic text-faint")}>
        {loop.key || "key?"}
      </button>
    </span>
  );
}

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
        in <span className="text-daw-text">src/assets/loops/</span> to bake them in. tempo · key · length are auto-detected from the
        filename, e.g. <span className="text-daw-text">dusty-keys-120bpm-Am-2bar.m4a</span> (a bare 3-digit number reads as bpm too) —
        and every field is editable on the lane.
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
              "flex flex-col gap-[7px] rounded-[4px] border px-[10px] py-[7px] transition-colors " +
              (st.on ? "border-line2 bg-panel2" : "border-line bg-[#101014]")
            }
          >
            <div className="flex items-center gap-[10px]">
            <button
              onClick={() => engine.toggleLoop(l.id)}
              className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-line2"
              aria-label={"toggle " + l.name}
              title="layer this loop in"
            >
              <span className={"h-[6px] w-[6px] rounded-full transition-[background,box-shadow] " + (st.on ? "bg-accent shadow-[0_0_6px_var(--accent)]" : "bg-faint")} />
            </button>

            <span className={"min-w-[90px] font-mono text-[11px] tracking-[0.03em] " + (st.on ? "text-daw-text" : "text-dim")}>{l.name}</span>
            <span className="flex items-center gap-[6px] font-mono text-[9px] tracking-[0.04em] text-faint">
              <LoopMetaEdit loop={l} />
              <span className="flex items-center rounded-[3px] border border-line" title="loop length (bars) — fixes grid alignment if the file's bar count is wrong">
                <button onClick={() => engine.setLoopBars(l.id, l.bars - 1)} className="px-[5px] py-[1px] text-[10px] transition-colors hover:text-accent" aria-label="fewer bars">
                  −
                </button>
                <span className="min-w-[30px] text-center tabular-nums text-dim">{l.bars}bar</span>
                <button onClick={() => engine.setLoopBars(l.id, l.bars + 1)} className="px-[5px] py-[1px] text-[10px] transition-colors hover:text-accent" aria-label="more bars">
                  +
                </button>
              </span>
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
            {st.on && <LoopWave loop={l} />}
          </div>
        );
      })}
    </div>
  );
}
