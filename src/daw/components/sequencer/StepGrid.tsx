// ── STEP GRID — the drum sequencer's lane × step matrix ──────────────────
// DOM buttons (low cell count, good click ergonomics). Click toggles a step;
// shift-click toggles its accent. The current step highlights via rAF reading
// engine.getSequencePosition().step — only the highlighted column's class
// changes, the grid itself isn't re-rendered per frame.

import { useRef } from "react";
import { engine } from "../../engine";
import { useEngine } from "../../hooks/useEngine";
import { useRafLoop } from "../../hooks/useRafLoop";

export function StepGrid() {
  useEngine(["clip", "transport"]);
  const seq = engine.sequence;
  const lanes = engine.kit.lanes;
  const gridRef = useRef<HTMLDivElement>(null);

  // imperative current-step highlight (no per-frame React render)
  useRafLoop(() => {
    const el = gridRef.current;
    if (!el) return;
    const cur = engine.getSequencePosition().step; // -1 when not playing
    const cells = el.querySelectorAll<HTMLElement>("[data-step]");
    cells.forEach((c) => {
      const s = Number(c.dataset.step);
      c.style.outline = s === cur ? "1px solid color-mix(in srgb, var(--accent) 70%, transparent)" : "";
    });
  });

  return (
    <div ref={gridRef} className="flex flex-col gap-[5px]">
      {lanes.map((lane) => {
        const on = seq.on[lane.id] || [];
        const accent = seq.accent[lane.id] || [];
        const mix = seq.laneMix?.[lane.id];
        return (
          <div key={lane.id} className="flex items-center gap-[8px]">
            <span className="w-[44px] shrink-0 text-right font-mono text-[10px] tracking-[0.05em] text-dim">{lane.name}</span>
            <span className="flex w-[52px] shrink-0 gap-[3px]">
              <button
                onClick={() => engine.toggleDrumMute(lane.id)}
                title="mute"
                className={
                  "flex-1 rounded-[3px] border py-[3px] font-mono text-[9px] tracking-[0.06em] transition-colors " +
                  (mix?.mute ? "border-[color-mix(in_srgb,#e0654f_60%,transparent)] bg-[color-mix(in_srgb,#e0654f_22%,transparent)] text-[#e98c79]" : "border-line text-faint hover:text-dim")
                }
              >
                M
              </button>
              <button
                onClick={() => engine.toggleDrumSolo(lane.id)}
                title="solo"
                className={
                  "flex-1 rounded-[3px] border py-[3px] font-mono text-[9px] tracking-[0.06em] transition-colors " +
                  (mix?.solo ? "border-[color-mix(in_srgb,var(--accent)_60%,transparent)] bg-[color-mix(in_srgb,var(--accent)_22%,transparent)] text-accent" : "border-line text-faint hover:text-dim")
                }
              >
                S
              </button>
            </span>
            <div className="flex flex-1 gap-[3px]">
              {Array.from({ length: seq.steps }).map((_, s) => {
                const isOn = on[s];
                const isAccent = accent[s];
                const beatStart = s % 4 === 0; // group-of-4 emphasis
                return (
                  <button
                    key={s}
                    data-step={s}
                    onClick={(e) => engine.toggleStep(lane.id, s, e.shiftKey)}
                    title={`${lane.name} · step ${s + 1}${isOn ? " (shift-click: accent)" : ""}`}
                    className={
                      "h-[26px] flex-1 rounded-[3px] border transition-colors " +
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
          </div>
        );
      })}
      {/* step ruler */}
      <div className="flex items-center gap-[8px]">
        <span className="w-[44px] shrink-0" />
        <span className="w-[52px] shrink-0" />
        <div className="flex flex-1 gap-[3px]">
          {Array.from({ length: seq.steps }).map((_, s) => (
            <span key={s} className={"flex-1 text-center font-mono text-[8px] " + (s % 4 === 0 ? "text-faint" : "text-transparent")}>
              {s + 1}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
