// ── SEQUENCER TRANSPORT — play/stop + tempo + swing + kit + pattern save/load ──
import { useState } from "react";
import { engine } from "../../engine";
import { useEngine } from "../../hooks/useEngine";
import { Knob } from "../Knob";
import { abSnap, abSnapActive } from "../../lab-utils";
import { KITS, STEP_COUNTS, type SequenceClip } from "../../data/kits";

const SLOTS_KEY = "ain-beats"; // localStorage: { slotName: SequenceClip }
const selectCls =
  "cursor-pointer appearance-none rounded-[3px] border border-line2 bg-panel2 py-[5px] pr-[24px] pl-[10px] font-mono text-[11px] tracking-[0.03em] text-daw-text transition-colors hover:border-accent focus:border-accent focus:outline-none";

function readSlots(): Record<string, SequenceClip> {
  try {
    return JSON.parse(localStorage.getItem(SLOTS_KEY) || "{}");
  } catch {
    return {};
  }
}

export function SequencerTransport() {
  const eng = useEngine(["transport", "clip"]);
  const playing = eng.sequencePlaying && eng.beatMode;
  const seq = eng.sequence;

  const [slots, setSlots] = useState<Record<string, SequenceClip>>(readSlots);
  const [slot, setSlot] = useState("");
  const names = Object.keys(slots).sort();

  const persist = (next: Record<string, SequenceClip>) => {
    localStorage.setItem(SLOTS_KEY, JSON.stringify(next));
    setSlots(next);
  };
  const save = () => {
    const name = (slot || window.prompt("save pattern as", "pattern " + (names.length + 1)) || "").trim();
    if (!name) return;
    persist({ ...slots, [name]: structuredClone(seq) });
    setSlot(name);
  };
  const load = () => {
    if (!slots[slot]) return;
    engine.setSequence(structuredClone(slots[slot]));
  };
  const del = () => {
    if (!slots[slot]) return;
    const next = { ...slots };
    delete next[slot];
    persist(next);
    setSlot("");
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button
        className={(playing ? abSnapActive : abSnap) + " flex items-center gap-2 px-[14px] py-[7px] text-[11px]"}
        onClick={() => engine.toggleBeat()}
      >
        <span className={playing ? "icon-pause small" : "icon-play small"} aria-hidden />
        {playing ? "stop" : "play"}
      </button>

      <span className="flex items-center gap-[14px]">
        <Knob
          value={seq.bpm}
          min={60}
          max={180}
          defaultValue={120}
          size={42}
          onChange={(v) => engine.setBeatBpm(v)}
          label="tempo"
          fmt={(v) => Math.round(v) + " bpm"}
        />
        <Knob
          value={seq.swing}
          min={0}
          max={0.7}
          defaultValue={0}
          size={42}
          onChange={(v) => engine.setSwing(v)}
          label="swing"
          fmt={(v) => Math.round((v / 0.7) * 100) + "%"}
        />
      </span>

      {/* kit selector */}
      <span className="relative inline-flex items-center">
        <select
          value={eng.kit.id}
          onChange={(e) => {
            const k = KITS.find((k) => k.id === e.target.value);
            if (k) engine.setKit(k);
          }}
          aria-label="drum kit"
          className={selectCls}
        >
          {KITS.map((k) => (
            <option key={k.id} value={k.id} className="bg-panel2 text-daw-text">
              {k.name} kit
            </option>
          ))}
        </select>
        <span className="pointer-events-none absolute right-[9px] text-[8px] text-faint">▼</span>
      </span>

      {/* step-count selector — 16/32/48/64 (whole bars of 1/16s) */}
      <span className="flex items-center gap-[3px]" aria-label="step count">
        {STEP_COUNTS.map((n) => (
          <button
            key={n}
            onClick={() => engine.setStepCount(n)}
            title={`${n} steps (${n / 16} ${n === 16 ? "bar" : "bars"})`}
            className={(seq.steps === n ? abSnapActive : abSnap) + " px-[9px] py-[6px] text-[10.5px] tabular-nums"}
          >
            {n}
          </button>
        ))}
      </span>

      {/* pattern save / load — localStorage named slots */}
      <span className="ml-auto flex items-center gap-[6px]">
        <span className="relative inline-flex items-center">
          <select value={slot} onChange={(e) => setSlot(e.target.value)} aria-label="pattern slot" className={selectCls}>
            <option value="" className="bg-panel2 text-daw-text">
              {names.length ? "— pattern —" : "no saves"}
            </option>
            {names.map((n) => (
              <option key={n} value={n} className="bg-panel2 text-daw-text">
                {n}
              </option>
            ))}
          </select>
          <span className="pointer-events-none absolute right-[9px] text-[8px] text-faint">▼</span>
        </span>
        <button className={abSnap + " px-[12px] py-[7px] text-[11px]"} onClick={save} title="save the current pattern to a slot">
          save
        </button>
        <button
          className={abSnap + " px-[12px] py-[7px] text-[11px]" + (slots[slot] ? "" : " pointer-events-none opacity-40")}
          onClick={load}
          title="load the selected pattern"
        >
          load
        </button>
        <button
          className={abSnap + " px-[12px] py-[7px] text-[11px]" + (slots[slot] ? "" : " pointer-events-none opacity-40")}
          onClick={del}
          title="delete the selected pattern"
        >
          del
        </button>
      </span>
    </div>
  );
}
