// ── PLAYBACK PANE — the arrangement transport ─────────────────────────────────
// Standard DAW playback controls: ⏮ return-to-start · ▶/⏸ play/pause · ⏹ stop,
// bars.beats + mm:ss readout, tempo (+ tap), time signature, loop (toggle + numeric
// range), metronome (+ count-in), follow-playhead. Spacebar/Home/L keyboard transport.

import { useRef, type ReactNode } from "react";
import { engine } from "../../engine";
import { useEngine } from "../../hooks/useEngine";
import { useRafLoop } from "../../hooks/useRafLoop";
import { Knob } from "../Knob";

const SIGS: [number, string][] = [
  [4, "4/4"],
  [3, "3/4"],
  [6, "6/8"],
  [5, "5/4"],
  [7, "7/8"],
];

// ── one uniform control system: every button/select/input is 28px tall, same radius,
//    border, font. `ctl` is the shared base; state helpers only change color. ──
const ctl = "flex h-[28px] items-center justify-center rounded-[4px] border font-mono text-[10px] transition-colors ";
const idle = "border-line2 text-dim hover:border-accent hover:text-accent";
const activeCls = "border-accent bg-accent text-[#111]";
const onOff = (on: boolean) => (on ? "border-accent text-accent" : "border-line2 text-faint hover:border-accent hover:text-dim");
const iconBtn = ctl + "w-[30px] "; // square transport buttons
const px = "px-[10px] "; // standard horizontal padding for text controls
const fieldSel = ctl + "cursor-pointer appearance-none border-line2 bg-panel2 pl-[8px] pr-[20px] text-daw-text hover:border-accent focus:border-accent focus:outline-none";
const numIn = "h-[28px] w-[38px] rounded-[4px] border border-line2 bg-panel2 text-center font-mono text-[10px] text-daw-text focus:border-accent focus:outline-none";
const cap = "font-mono text-[9px] tracking-[0.06em] text-faint"; // small caption label

// a select styled to the shared control height, with an aligned caret
function Select({ value, onChange, title, children }: { value: number; onChange: (n: number) => void; title: string; children: ReactNode }) {
  return (
    <span className="relative inline-flex">
      <select value={value} onChange={(e) => onChange(Number(e.target.value))} title={title} className={fieldSel}>
        {children}
      </select>
      <span className="pointer-events-none absolute top-1/2 right-[7px] -translate-y-1/2 text-[7px] text-faint">▼</span>
    </span>
  );
}

export function PlaybackPane() {
  const eng = useEngine(["transport", "arrange"]);
  const playing = eng.sequencePlaying && eng.arrangeMode;
  const bpb = eng.arrangement.beatsPerBar;
  const loop = eng.arrangement.loop;
  const barBeat = useRef<HTMLSpanElement>(null);
  const timeStr = useRef<HTMLSpanElement>(null);

  // imperative readouts (rAF, no per-frame React render)
  useRafLoop(() => {
    const beat = engine.arrangementPosition();
    if (barBeat.current) {
      const bar = Math.floor(beat / bpb) + 1;
      const b = Math.floor(beat % bpb) + 1;
      const sub = Math.floor(((beat % 1) * 4)) + 1; // 1/16 subdivision
      barBeat.current.textContent = `${bar}.${b}.${sub}`;
    }
    if (timeStr.current) {
      const secs = beat * (60 / eng.arrangement.bpm);
      const m = Math.floor(secs / 60);
      const s = Math.floor(secs % 60);
      const ms = Math.floor((secs % 1) * 1000);
      timeStr.current.textContent = `${m}:${String(s).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
    }
  });

  // keyboard transport lives in ArrangementPage (the page-level key authority), so it
  // works regardless of DOM focus. Buttons here just call the same engine verbs.
  const toggleLoop = () => {
    const l = engine.arrangement.loop;
    if (l) engine.setArrangementLoop(l.start, l.end, !l.on);
    else engine.setArrangementLoop(0, engine.arrangement.beatsPerBar * 4, true);
  };

  // loop range as bar numbers (1-based)
  const loopBar = (beat: number) => Math.round(beat / bpb) + 1;
  const setLoopBar = (which: "start" | "end", bar: number) => {
    const l = engine.arrangement.loop || { start: 0, end: bpb * 4, on: true };
    const beat = Math.max(0, (bar - 1) * bpb);
    const start = which === "start" ? beat : l.start;
    const end = which === "end" ? beat : l.end;
    engine.setArrangementLoop(start, end, l.on ?? true);
  };

  return (
    <div className="flex flex-wrap items-center gap-x-[12px] gap-y-[8px] rounded-[4px] border border-line bg-[#0e0e12] px-[12px] py-[8px]">
      {/* transport buttons */}
      <div className="flex items-center gap-[4px]">
        <button className={iconBtn + idle} onClick={() => engine.returnToStart()} title="return to start (Home)">⏮</button>
        <button className={iconBtn + (playing ? activeCls : idle)} onClick={() => engine.toggleArrangement()} title="play / stop (Space)">
          <span className={playing ? "icon-pause small" : "icon-play small"} aria-hidden />
        </button>
        <button className={iconBtn + idle} onClick={() => engine.stopArrangementToStart()} title="stop → return to start">⏹</button>
      </div>

      {/* dual readout */}
      <div className="flex h-[28px] flex-col justify-center leading-none">
        <span ref={barBeat} className="font-mono text-[13px] tabular-nums text-accent">1.1.1</span>
        <span ref={timeStr} className="mt-[2px] font-mono text-[9px] tabular-nums text-faint">0:00.000</span>
      </div>

      {/* loop: toggle + numeric range (bars) */}
      <div className="flex items-center gap-[5px]">
        <button className={ctl + px + onOff(!!loop?.on)} onClick={toggleLoop} title="toggle the loop brace (L · or shift+drag the ruler)">
          loop
        </button>
        {loop && (
          <span className="flex items-center gap-[3px] font-mono text-[9px] text-faint">
            <input type="number" min={1} value={loopBar(loop.start)} onChange={(e) => setLoopBar("start", Number(e.target.value))} className={numIn} title="loop start (bar)" />
            <span>–</span>
            <input type="number" min={1} value={loopBar(loop.end)} onChange={(e) => setLoopBar("end", Number(e.target.value))} className={numIn} title="loop end (bar)" />
          </span>
        )}
      </div>

      {/* time signature */}
      <label className="flex items-center gap-[5px]">
        <span className={cap}>sig</span>
        <Select value={bpb} onChange={(n) => engine.setBeatsPerBar(n)} title="time signature (beats per bar)">
          {SIGS.map(([n, label]) => (
            <option key={label} value={n} className="bg-panel2">{label}</option>
          ))}
        </Select>
      </label>

      {/* metronome + count-in */}
      <div className="flex items-center gap-[6px]">
        <button className={ctl + px + onOff(eng.metronome)} onClick={() => engine.setMetronome(!eng.metronome)} title="metronome click">
          ♩ click
        </button>
        <label className="flex items-center gap-[5px]">
          <span className={cap}>count</span>
          <Select value={eng.countInBars} onChange={(n) => engine.setCountInBars(n)} title="count-in bars before playback rolls">
            <option value={0}>off</option>
            <option value={1}>1 bar</option>
            <option value={2}>2 bars</option>
          </Select>
        </label>
      </div>

      {/* snap grid */}
      <label className="flex items-center gap-[5px]">
        <span className={cap}>snap</span>
        <Select value={eng.snapBeats} onChange={(n) => engine.setSnapBeats(n)} title="clip snap grid (⌘1 finer · ⌘2 coarser)">
          <option value={bpb}>bar</option>
          <option value={1}>1/4</option>
          <option value={0.5}>1/8</option>
          <option value={0.25}>1/16</option>
          <option value={0.125}>1/32</option>
          <option value={0}>off</option>
        </Select>
      </label>

      {/* follow playhead */}
      <button className={ctl + px + onOff(eng.followPlayhead)} onClick={() => engine.setFollowPlayhead(!eng.followPlayhead)} title="auto-scroll the timeline to follow the playhead">
        follow
      </button>

      {/* tempo + tap */}
      <span className="ml-auto flex items-center gap-[10px]">
        <button className={ctl + px + idle} onClick={() => engine.tapTempo()} title="tap tempo — hit repeatedly to set the BPM">
          tap
        </button>
        <Knob value={eng.arrangement.bpm} min={40} max={220} defaultValue={120} size={40} onChange={(v) => engine.setArrangementBpm(v)} label="tempo" fmt={(v) => Math.round(v) + " bpm"} />
      </span>
    </div>
  );
}
