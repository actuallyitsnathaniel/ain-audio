// ── DRUM CLIP GRID — a step sequencer scoped to ONE arrangement drum clip ──────
// Unlike the beat-maker's StepGrid (which edits the global engine.sequence), this
// edits a clip's own `pattern` (a SequenceClip) and commits back via onCommit. Click
// a step to toggle it; shift-click toggles its accent. The kit comes from the clip's
// pattern.kitId. Playhead highlight reads engine.getArrangementBeat().

import { useRef } from "react";
import { engine } from "../../engine";
import { useEngine } from "../../hooks/useEngine";
import { useRafLoop } from "../../hooks/useRafLoop";
import { KITS, type SequenceClip } from "../../data/kits";
import type { NoteClip } from "../../data/clips";
import { stepDiscrepancy } from "../../data/drum-midi";

const BAR_STEPS = 16;
const STEP_BEATS = 0.25;

export function DrumClipGrid({ pattern, notes, startBeat, onCommit }: { pattern: SequenceClip; notes?: NoteClip; startBeat: number; onCommit: (p: SequenceClip) => void }) {
  useEngine(["transport"]);
  const kit = KITS.find((k) => k.id === pattern.kitId) || engine.kit;
  const gridRef = useRef<HTMLDivElement>(null);
  const bars = Math.ceil(pattern.steps / BAR_STEPS);

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

  return (
    <div ref={gridRef} className="flex flex-col gap-[5px]">
      {kit.lanes.map((lane) => {
        const on = pattern.on[lane.id] || [];
        const accent = pattern.accent[lane.id] || [];
        return (
          <div key={lane.id} className="flex items-center gap-[8px]">
            <span className="w-[44px] shrink-0 text-right font-mono text-[10px] tracking-[0.05em] text-dim">{lane.name}</span>
            <div className="flex flex-1 gap-[8px]">
              {Array.from({ length: bars }).map((_, b) => (
                <div key={b} className="flex flex-1 gap-[3px]">
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
                        onClick={(e) => toggle(lane.id, s, e.shiftKey)}
                        title={`${lane.name} · step ${s + 1}${disc ? " — has off-grid / variable detail (edit in piano roll)" : isOn ? " (shift-click: accent)" : ""}`}
                        style={
                          disc
                            ? { backgroundImage: "repeating-linear-gradient(45deg, transparent 0, transparent 2px, rgba(12,12,16,0.55) 2px, rgba(12,12,16,0.55) 4px)" }
                            : undefined
                        }
                        className={
                          "h-[24px] flex-1 rounded-[3px] border transition-colors " +
                          (isOn
                            ? isAccent
                              ? "border-accent bg-accent"
                              : "border-[color-mix(in_srgb,var(--accent)_60%,transparent)] bg-[color-mix(in_srgb,var(--accent)_55%,transparent)]"
                            : beatStart
                              ? "border-line2 bg-panel2 hover:bg-[#202028]"
                              : "border-line bg-[#141418] hover:bg-panel2")
                        }
                      />
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
