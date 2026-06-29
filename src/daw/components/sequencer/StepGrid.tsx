// ── STEP GRID — the drum sequencer's lane × step matrix ──────────────────
// DOM buttons (low cell count, good click ergonomics). Click toggles a step;
// shift-click toggles its accent. The current step highlights via rAF reading
// engine.getSequencePosition().step — only the highlighted column's class
// changes, the grid itself isn't re-rendered per frame.

import { useRef } from "react";
import { engine } from "../../engine";
import { useEngine } from "../../hooks/useEngine";
import { useRafLoop } from "../../hooks/useRafLoop";
import { openContextMenu } from "../context-menu-bus";

// right-click a drum lane → lane actions (Shift+right-click → browser menu)
function laneMenu(e: React.MouseEvent, laneId: string, name: string) {
  if (e.shiftKey) return;
  e.preventDefault();
  const mix = engine.sequence.laneMix?.[laneId];
  openContextMenu({
    x: e.clientX,
    y: e.clientY,
    title: "lane: " + name,
    items: [
      { label: mix?.mute ? "unmute" : "mute", onClick: () => engine.toggleDrumMute(laneId) },
      { label: mix?.solo ? "unsolo" : "solo", onClick: () => engine.toggleDrumSolo(laneId) },
      { separator: true },
      { label: "clear lane", danger: true, onClick: () => engine.clearDrumLane(laneId) },
      { separator: true },
      { label: "browser menu", hint: "⇧right-click", disabled: true },
    ],
  });
}

export function StepGrid() {
  useEngine(["clip", "transport"]);
  const seq = engine.sequence;
  const lanes = engine.kit.lanes;
  const gridRef = useRef<HTMLDivElement>(null);
  const BAR_STEPS = 16; // one bar of 1/16s
  const bars = Math.ceil(seq.steps / BAR_STEPS);

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
          <div key={lane.id} className="flex items-center gap-[8px]" onContextMenu={(e) => laneMenu(e, lane.id, lane.name)}>
            <span className="w-[44px] shrink-0 text-right font-mono text-[10px] tracking-[0.05em] text-dim">{lane.name}</span>
            <div className="flex flex-1 gap-[8px]">
              {Array.from({ length: bars }).map((_, b) => (
                <div key={b} className="flex flex-1 gap-[3px]">
                  {Array.from({ length: BAR_STEPS }).map((_, i) => {
                    const s = b * BAR_STEPS + i;
                    if (s >= seq.steps) return null;
                    const isOn = on[s];
                    const isAccent = accent[s];
                    const beatStart = i % 4 === 0; // group-of-4 emphasis
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
              ))}
            </div>
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
          </div>
        );
      })}
      {/* step ruler */}
      <div className="flex items-center gap-[8px]">
        <span className="w-[44px] shrink-0" />
        <div className="flex flex-1 gap-[8px]">
          {Array.from({ length: bars }).map((_, b) => (
            <div key={b} className="flex flex-1 gap-[3px]">
              {Array.from({ length: BAR_STEPS }).map((_, i) => {
                const s = b * BAR_STEPS + i;
                if (s >= seq.steps) return null;
                // label each bar's quarter-note downbeats: "<bar>.<beat>"
                return (
                  <span key={s} className={"flex-1 text-center font-mono text-[8px] " + (i % 4 === 0 ? "text-faint" : "text-transparent")}>
                    {b + 1}.{Math.floor(i / 4) + 1}
                  </span>
                );
              })}
            </div>
          ))}
        </div>
        <span className="w-[52px] shrink-0" />
      </div>
    </div>
  );
}
