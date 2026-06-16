// ── LOOP LANES — loopable melodic samples layered alongside the drums ─────
// Each discovered loop is a row: toggle it in, level knob, mute + solo. Loops
// start bar-aligned, playbackRate-matched to the grid tempo. Empty until you
// drop files in src/assets/loops/.

import { engine } from "../../engine";
import { useEngine } from "../../hooks/useEngine";
import { Knob } from "../Knob";

export function LoopLanes() {
  useEngine(["clip", "transport"]);
  const loops = engine.loops;
  const state = engine.sequence.loops;

  if (!loops.length) {
    return (
      <div className="rounded-[4px] border border-dashed border-line bg-[#0e0e12] px-[14px] py-[16px] font-mono text-[10.5px] leading-[1.6] tracking-[0.03em] text-faint">
        <span className="text-dim">loop lanes</span> — drop loopable melodic samples in{" "}
        <span className="text-daw-text">src/assets/loops/</span> and they appear here to layer over the beat. encode tempo
        + length in the filename, e.g. <span className="text-daw-text">dusty-keys-120bpm-2bar.m4a</span>. they lock to the
        grid tempo automatically.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-[6px]">
      <span className="font-mono text-[10px] tracking-[0.08em] text-faint">LOOP LANES</span>
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
            </span>
          </div>
        );
      })}
    </div>
  );
}
