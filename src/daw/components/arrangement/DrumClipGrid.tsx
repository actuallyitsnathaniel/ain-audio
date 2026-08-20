// ── DRUM CLIP GRID — a step sequencer scoped to ONE arrangement drum clip ──────
// Unlike the beat-maker's StepGrid (which edits the global engine.sequence), this
// edits a clip's own `pattern` (a SequenceClip) and commits back via onCommit. Click
// a step to toggle it; shift-click toggles its accent. The kit comes from the clip's
// pattern.kitId. Playhead highlight reads engine.getArrangementBeat().
//
// Sample intake: each lane has a dedicated well (drop / click-to-pick). Selecting a
// lane (click name or well) docks the voice inspector below via selectedLaneId.

import { useRef } from "react";
import { engine } from "../../engine";
import { useEngine } from "../../hooks/useEngine";
import { useRafLoop } from "../../hooks/useRafLoop";
import { findKit, type SequenceClip } from "../../data/kits";
import type { NoteClip } from "../../data/clips";
import { stepDiscrepancy } from "../../data/drum-midi";
import {
  dragHasAudioIntake,
  libraryBufIdFromDrag,
} from "../../library-drag";
import { filesFromDataTransfer } from "../../file-source";

const BAR_STEPS = 16;
const STEP_BEATS = 0.25;

export function DrumClipGrid({
  pattern,
  notes,
  startBeat,
  kitId,
  selectedLaneId,
  onSelectLane,
  onCommit,
}: {
  pattern: SequenceClip;
  notes?: NoteClip;
  startBeat: number;
  kitId?: string;
  selectedLaneId: string;
  onSelectLane: (laneId: string) => void;
  onCommit: (p: SequenceClip) => void;
}) {
  useEngine(["transport", "arrange"]);
  const kit = findKit(kitId || pattern.kitId);
  const gridRef = useRef<HTMLDivElement>(null);
  const bars = Math.ceil(pattern.steps / BAR_STEPS);

  const onLaneDrop = async (
    laneId: string,
    e: React.DragEvent<HTMLDivElement>,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    onSelectLane(laneId);
    const libId = libraryBufIdFromDrag(e.dataTransfer);
    if (libId) {
      if (!engine.setKitLaneBuf(kit.id, laneId, libId))
        window.alert("Couldn't load that sample for this lane");
      return;
    }
    const got = (await filesFromDataTransfer(e.dataTransfer))[0];
    if (!got) return;
    const ok = await engine.setKitLaneSample(kit.id, laneId, got.file, got);
    if (!ok) window.alert("Couldn't load that sample for this lane");
  };

  const onLanePick = async (laneId: string, file: File) => {
    onSelectLane(laneId);
    const ok = await engine.setKitLaneSample(kit.id, laneId, file);
    if (!ok) window.alert("Couldn't load that sample for this lane");
  };

  // toggle a step (or its accent) on a cloned pattern → commit
  const toggle = (laneId: string, s: number, accent: boolean) => {
    const p: SequenceClip = { ...pattern, on: { ...pattern.on }, accent: { ...pattern.accent } };
    const on = (p.on[laneId] = [...(p.on[laneId] || Array(p.steps).fill(false))]);
    const ac = (p.accent[laneId] = [...(p.accent[laneId] || Array(p.steps).fill(false))]);
    if (accent) {
      if (on[s]) ac[s] = !ac[s]; // shift-click an on step flips accent
    } else {
      on[s] = !on[s];
      if (!on[s]) ac[s] = false; // turning off clears accent
    }
    onCommit(p);
  };
  // per-lane mute/solo within this clip's pattern
  const toggleMix = (laneId: string, field: "mute" | "solo") => {
    const laneMix = { ...(pattern.laneMix || {}) };
    const cur = laneMix[laneId] || { mute: false, solo: false };
    laneMix[laneId] = { ...cur, [field]: !cur[field] };
    onCommit({ ...pattern, laneMix });
  };
  const msBtn = (on: boolean, danger?: boolean) =>
    "w-4 rounded-xs border py-0.25 font-mono text-[8px] leading-none transition-colors " +
    (on ? (danger ? "border-[color-mix(in_srgb,#e0654f_60%,transparent)] bg-[color-mix(in_srgb,#e0654f_22%,transparent)] text-[#e98c79]" : "border-accent bg-[color-mix(in_srgb,var(--accent)_22%,transparent)] text-accent") : "border-line text-faint hover:text-dim");

  // imperative playhead highlight (no per-frame React render)
  useRafLoop(() => {
    const el = gridRef.current;
    if (!el) return;
    // which step of THIS clip is under the arrangement playhead (-1 when outside)
    const beat = engine.arrangementPosition();
    let cur = -1;
    if (engine.arrangeMode && beat >= startBeat) {
      const local = beat - startBeat;
      const contentBeats = pattern.steps * STEP_BEATS;
      cur = Math.floor((local % contentBeats) / STEP_BEATS) % pattern.steps;
    }
    el.querySelectorAll<HTMLElement>("[data-step]").forEach((c) => {
      const s = Number(c.dataset.step);
      c.style.outline = s === cur ? "1px solid color-mix(in srgb, var(--accent) 70%, transparent)" : "";
    });
  });

  // pinned label + sample-well column; steps scroll horizontally for long patterns.
  return (
    <div ref={gridRef} className="flex gap-2">
      <div className="flex shrink-0 flex-col gap-1.25">
        {kit.lanes.map((lane) => {
          const mix = pattern.laneMix?.[lane.id];
          const hasSample = engine.hasDrumLaneSample(lane, kit.id);
          const selected = selectedLaneId === lane.id;
          return (
            <div
              key={lane.id}
              className={
                "flex h-6 items-center gap-1.5 rounded-xs border px-0.5 " +
                (selected
                  ? "border-accent bg-[color-mix(in_srgb,var(--accent)_10%,transparent)]"
                  : "border-transparent hover:border-line2")
              }
              style={
                selected
                  ? { borderLeftWidth: 2, borderLeftColor: "var(--accent)" }
                  : undefined
              }
            >
              <button
                type="button"
                onClick={() => onSelectLane(lane.id)}
                className={
                  "w-11 shrink-0 text-right font-mono text-[10px] tracking-[0.05em] " +
                  (hasSample ? "text-accent" : "text-dim")
                }
                title={`Select ${lane.name} voice`}
              >
                {lane.name}
              </button>
              <span className="flex shrink-0 gap-0.5">
                <button className={msBtn(!!mix?.mute, true)} onClick={() => toggleMix(lane.id, "mute")} title="mute lane">M</button>
                <button className={msBtn(!!mix?.solo)} onClick={() => toggleMix(lane.id, "solo")} title="solo lane">S</button>
              </span>
              <SampleWell
                kitId={kit.id}
                laneId={lane.id}
                hasSample={hasSample}
                label={lane.name}
                selected={selected}
                onSelect={() => onSelectLane(lane.id)}
                onDrop={(e) => void onLaneDrop(lane.id, e)}
                onPick={(f) => void onLanePick(lane.id, f)}
              />
            </div>
          );
        })}
      </div>
      <div className="fx-scroll min-w-0 flex-1 overflow-x-auto pb-1">
        <div className="flex w-max flex-col gap-1.25">
          {kit.lanes.map((lane) => {
            const on = pattern.on[lane.id] || [];
            const accent = pattern.accent[lane.id] || [];
            const selected = selectedLaneId === lane.id;
            return (
              <div
                key={lane.id}
                className={
                  "flex gap-2 rounded-xs " +
                  (selected ? "bg-[color-mix(in_srgb,var(--accent)_6%,transparent)]" : "")
                }
              >
                {Array.from({ length: bars }).map((_, b) => (
                  <div key={b} className="flex gap-0.75">
                    {Array.from({ length: BAR_STEPS }).map((_, i) => {
                      const s = b * BAR_STEPS + i;
                      if (s >= pattern.steps) return null;
                      const isOn = on[s];
                      const isAccent = accent[s];
                      const beatStart = i % 4 === 0;
                      // discrepancy: this on-step hides note detail the grid can't show
                      // (off-grid / length / multi-hit / mid-velocity) → diagonal hatch
                      const disc = isOn && !!notes && stepDiscrepancy(notes, kit, lane.id, s);
                      return (
                        <button
                          key={s}
                          data-step={s}
                          onClick={(e) => {
                            onSelectLane(lane.id);
                            toggle(lane.id, s, e.shiftKey);
                          }}
                          title={`${lane.name} · step ${s + 1}${disc ? " — has off-grid / variable detail (edit in piano roll)" : isOn ? " (shift-click: accent)" : ""}`}
                          style={
                            disc
                              ? { backgroundImage: "repeating-linear-gradient(45deg, transparent 0, transparent 2px, rgba(12,12,16,0.55) 2px, rgba(12,12,16,0.55) 4px)" }
                              : undefined
                          }
                          className={
                            "h-6 w-5.5 shrink-0 rounded-[3px] border transition-colors " +
                            (isOn
                              ? isAccent
                                ? "border-accent bg-accent"
                                : "border-[color-mix(in_srgb,var(--accent)_60%,transparent)] bg-[color-mix(in_srgb,var(--accent)_55%,transparent)]"
                              : beatStart
                                ? "border-line2 bg-panel2 hover:bg-[#202028]"
                                : "border-line bg-panel hover:bg-panel2")
                          }
                        />
                      );
                    })}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** Per-lane one-shot slot: dashed empty drop, or mini waveform when loaded. */
function SampleWell({
  kitId,
  laneId,
  hasSample,
  label,
  selected,
  onSelect,
  onDrop,
  onPick,
}: {
  kitId: string;
  laneId: string;
  hasSample: boolean;
  label: string;
  selected: boolean;
  onSelect: () => void;
  onDrop: (e: React.DragEvent<HTMLDivElement>) => void;
  onPick: (file: File) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const waveRef = useRef<HTMLCanvasElement>(null);

  useRafLoop(() => {
    const cv = waveRef.current;
    if (!cv || !hasSample) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = cv.clientWidth;
    const h = cv.clientHeight;
    if (w < 2 || h < 2) return;
    if (cv.width !== Math.floor(w * dpr) || cv.height !== Math.floor(h * dpr)) {
      cv.width = Math.floor(w * dpr);
      cv.height = Math.floor(h * dpr);
    }
    const g = cv.getContext("2d");
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const accent =
      getComputedStyle(cv).getPropertyValue("--accent").trim() || "#54adbd";
    const peaks = engine.drumLanePeaks(
      laneId,
      Math.max(16, Math.floor(w)),
      kitId,
    );
    if (!peaks) return;
    const mid = h / 2;
    g.fillStyle = accent;
    const bw = w / peaks.length;
    for (let i = 0; i < peaks.length; i++) {
      const ph = Math.max(1, peaks[i] * (h - 2));
      g.fillRect(i * bw, mid - ph / 2, Math.max(1, bw - 0.4), ph);
    }
  });

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => {
        onSelect();
        if (!hasSample) fileRef.current?.click();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
          if (!hasSample) fileRef.current?.click();
        }
      }}
      onDragOver={(e) => {
        if (dragHasAudioIntake(e.dataTransfer)) e.preventDefault();
      }}
      onDrop={onDrop}
      title={
        hasSample
          ? `${label} sample — drop to replace · click to select`
          : `Drop a one-shot for ${label}, or click to pick`
      }
      className={
        "relative flex h-5 w-18 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-[3px] " +
        (hasSample
          ? "border border-solid bg-[#0c0c10] " +
            (selected ? "border-accent" : "border-line2")
          : "border border-dashed " +
            (selected
              ? "border-accent text-accent"
              : "border-line2 text-faint hover:border-accent hover:text-dim"))
      }
    >
      <input
        ref={fileRef}
        type="file"
        accept="audio/*,.wav,.mp3,.m4a,.ogg,.flac,.aac"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onPick(f);
          e.target.value = "";
        }}
      />
      {hasSample ? (
        <canvas ref={waveRef} className="pointer-events-none size-full" />
      ) : (
        <span className="font-mono text-[7px] tracking-[0.04em]">drop</span>
      )}
    </div>
  );
}
