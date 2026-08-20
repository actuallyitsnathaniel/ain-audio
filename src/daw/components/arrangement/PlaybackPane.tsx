// ── PLAYBACK PANE — the arrangement transport ─────────────────────────────────
// Dense DAW chrome (not a portfolio form row): transport · readout · loop brace
// controls · metro · grid · tempo. Loop range uses steppers (not finicky number
// inputs); brace editing itself lives on the timeline ruler.

import { useRef, type ReactNode } from "react";
import { engine } from "../../engine";
import { useEngine } from "../../hooks/useEngine";
import { useRafLoop } from "../../hooks/useRafLoop";
import { Knob } from "../Knob";
import { GridMenu } from "./GridMenu";

const SIGS: [number, string][] = [
  [4, "4/4"],
  [3, "3/4"],
  [6, "6/8"],
  [5, "5/4"],
  [7, "7/8"],
];

const ctl =
  "flex h-7 items-center justify-center rounded-sm border font-mono text-[10px] transition-colors ";
const idle = "border-line2 text-dim hover:border-accent hover:text-accent";
const activeCls = "border-accent bg-accent text-[#111]";
const onOff = (on: boolean) =>
  on
    ? "border-accent text-accent bg-[color-mix(in_srgb,var(--accent)_12%,transparent)]"
    : "border-line2 text-faint hover:border-accent hover:text-dim";
const iconBtn = ctl + "w-7.5 ";
const px = "px-2.5 ";
const fieldSel =
  ctl +
  "cursor-pointer appearance-none border-line2 bg-[#121218] pl-2 pr-5 text-daw-text hover:border-accent focus:border-accent focus:outline-none";
const cap = "font-mono text-[9px] tracking-[0.06em] text-faint";
const stepBtn =
  "flex h-7 w-5 shrink-0 items-center justify-center border border-line2 font-mono text-[11px] text-faint transition-colors hover:border-accent hover:text-accent disabled:opacity-30";

function Select({
  value,
  onChange,
  title,
  children,
}: {
  value: number;
  onChange: (n: number) => void;
  title: string;
  children: ReactNode;
}) {
  return (
    <span className="relative inline-flex">
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        title={title}
        className={fieldSel}
      >
        {children}
      </select>
      <span className="pointer-events-none absolute top-1/2 right-1.75 -translate-y-1/2 text-[7px] text-faint">
        ▼
      </span>
    </span>
  );
}

/** Format a beat as bar.beat (1-based), no rounding surprises. */
function fmtBarBeat(beat: number, bpb: number): string {
  const bar = Math.floor(beat / bpb) + 1;
  const b = Math.floor(beat % bpb) + 1;
  return `${bar}.${b}`;
}

export function PlaybackPane() {
  const eng = useEngine(["transport", "arrange", "clip", "select"]);
  const audition = !!eng.libraryPreviewing();
  const playing = (eng.sequencePlaying && eng.arrangeMode) || audition;
  const bpb = eng.arrangement.beatsPerBar;
  const loop = eng.arrangement.loop;
  const loopOn = !!loop?.on;
  const hasSel = !!(eng.timeSel || eng.selClips.size);
  const barBeat = useRef<HTMLSpanElement>(null);
  const timeStr = useRef<HTMLSpanElement>(null);
  const lastSample = useRef(0);

  useRafLoop(() => {
    const beat = engine.arrangementPosition();
    if (barBeat.current) {
      const bar = Math.floor(beat / bpb) + 1;
      const b = Math.floor(beat % bpb) + 1;
      const sub = Math.floor((beat % 1) * 4) + 1;
      barBeat.current.textContent = `${bar}.${b}.${sub}`;
    }
    if (timeStr.current) {
      const secs = beat * (60 / eng.arrangement.bpm);
      const m = Math.floor(secs / 60);
      const s = Math.floor(secs % 60);
      const ms = Math.floor((secs % 1) * 1000);
      timeStr.current.textContent = `${m}:${String(s).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
    }
    const now = performance.now();
    if (lastSample.current) engine.sampleUiFrame(now - lastSample.current);
    lastSample.current = now;
  });

  const toggleLoop = () => {
    const l = engine.arrangement.loop;
    if (l) engine.setArrangementLoop(l.start, l.end, !l.on);
    else engine.setArrangementLoop(0, bpb * 4, true);
  };

  /** Nudge loop start or end by bars (default) or beats (shift). */
  const nudgeLoop = (
    which: "start" | "end",
    dir: -1 | 1,
    fine: boolean,
  ) => {
    const l = engine.arrangement.loop || {
      start: 0,
      end: bpb * 4,
      on: true,
    };
    const step = fine ? 1 : bpb;
    let start = l.start;
    let end = l.end;
    if (which === "start") start = Math.max(0, start + dir * step);
    else end = end + dir * step;
    engine.setArrangementLoop(start, end, l.on ?? true);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 border-b border-line bg-[#0a0a0e] px-2.5 py-1.5">
        {/* transport */}
        <div className="flex items-center gap-0.5">
          <button
            className={iconBtn + idle}
            onClick={() => engine.returnToStart()}
            title="return to start (Home)"
          >
            ⏮
          </button>
          <button
            className={iconBtn + (playing ? activeCls : idle)}
            onClick={() => engine.toggleArrangement()}
            title={audition && !eng.sequencePlaying ? "stop preview (Space)" : "play / stop (Space)"}
          >
            <span
              className={playing ? "icon-pause small" : "icon-play small"}
              aria-hidden
            />
          </button>
          <button
            className={
              iconBtn +
              (eng.recording
                ? "border-red-500 bg-red-500 text-[#111]"
                : idle)
            }
            onClick={() => engine.toggleRecord()}
            title="record into the armed track (Shift+R)"
          >
            <span
              className={
                "inline-block size-2.5 rounded-full " +
                (eng.recording ? "bg-[#111]" : "bg-red-500")
              }
              aria-hidden
            />
          </button>
          <button
            className={iconBtn + idle}
            onClick={() => engine.stopArrangementToStart()}
            title="stop → return to start (also stops library preview)"
          >
            ⏹
          </button>
        </div>

        {/* readout */}
        <div className="flex h-7 min-w-18 flex-col justify-center leading-none">
          <span
            ref={barBeat}
            className="font-mono text-[13px] tabular-nums text-accent"
          >
            1.1.1
          </span>
          <span
            ref={timeStr}
            className="mt-0.5 font-mono text-[9px] tabular-nums text-faint"
          >
            0:00.000
          </span>
        </div>

        <span className="hidden h-5 w-px bg-line sm:block" aria-hidden />

        {/* loop — steppers, not number inputs */}
        <div
          className={
            "flex items-center gap-0.5 rounded-sm " +
            (loopOn
              ? "bg-[color-mix(in_srgb,var(--accent)_8%,transparent)]"
              : "")
          }
        >
          <button
            className={ctl + px + onOff(loopOn)}
            onClick={toggleLoop}
            title="toggle loop (L) · drag brace grips on the ruler · Shift-drag to draw · click brace = select loop (⌘⇧L)"
          >
            loop
          </button>
          <div
            className={
              "flex items-center gap-px " + (loopOn ? "opacity-100" : "opacity-45")
            }
          >
            <button
              type="button"
              className={stepBtn + " rounded-l-sm"}
              disabled={!loop}
              onClick={(e) => nudgeLoop("start", -1, e.shiftKey)}
              title="loop start earlier (Shift = 1 beat)"
            >
              ‹
            </button>
            <span
              className="flex h-7 min-w-9 items-center justify-center border-y border-line2 bg-[#121218] px-1 font-mono text-[10px] tabular-nums text-daw-text"
              title="loop start (bar.beat)"
            >
              {loop ? fmtBarBeat(loop.start, bpb) : "—"}
            </span>
            <button
              type="button"
              className={stepBtn}
              disabled={!loop}
              onClick={(e) => nudgeLoop("start", 1, e.shiftKey)}
              title="loop start later (Shift = 1 beat)"
            >
              ›
            </button>
            <span className="px-0.5 font-mono text-[9px] text-faint">–</span>
            <button
              type="button"
              className={stepBtn}
              disabled={!loop}
              onClick={(e) => nudgeLoop("end", -1, e.shiftKey)}
              title="loop end earlier (Shift = 1 beat)"
            >
              ‹
            </button>
            <span
              className="flex h-7 min-w-9 items-center justify-center border-y border-line2 bg-[#121218] px-1 font-mono text-[10px] tabular-nums text-daw-text"
              title="loop end (bar.beat)"
            >
              {loop ? fmtBarBeat(loop.end, bpb) : "—"}
            </span>
            <button
              type="button"
              className={stepBtn + " rounded-r-sm"}
              disabled={!loop}
              onClick={(e) => nudgeLoop("end", 1, e.shiftKey)}
              title="loop end later (Shift = 1 beat)"
            >
              ›
            </button>
          </div>
          <button
            type="button"
            className={ctl + "px-1.5 " + onOff(false)}
            disabled={!hasSel}
            onClick={() => engine.loopFromSelection()}
            title="set loop brace to the time / clip selection (⌘L)"
          >
            sel
          </button>
        </div>

        <span className="hidden h-5 w-px bg-line md:block" aria-hidden />

        {/* sig + metro */}
        <label className="flex items-center gap-1">
          <span className={cap}>sig</span>
          <Select
            value={bpb}
            onChange={(n) => engine.setBeatsPerBar(n)}
            title="time signature"
          >
            {SIGS.map(([n, label]) => (
              <option key={label} value={n} className="bg-panel2">
                {label}
              </option>
            ))}
          </Select>
        </label>

        <button
          className={ctl + px + onOff(eng.metronome)}
          onClick={() => engine.setMetronome(!eng.metronome)}
          title="metronome"
        >
          ♩
        </button>
        <label className="flex items-center gap-1">
          <span className={cap}>in</span>
          <Select
            value={eng.countInBars}
            onChange={(n) => engine.setCountInBars(n)}
            title="count-in bars"
          >
            <option value={0}>off</option>
            <option value={1}>1</option>
            <option value={2}>2</option>
          </Select>
        </label>

        <button
          className={ctl + px + onOff(eng.followPlayhead)}
          onClick={() => engine.setFollowPlayhead(!eng.followPlayhead)}
          title="follow playhead"
        >
          follow
        </button>

        <GridMenu />

        <button
          className={ctl + px + onOff(eng.midiKeys)}
          onClick={() => engine.toggleMidiKeys()}
          title="Computer MIDI Keyboard (M): ON = A–; plays the armed / selected MIDI track"
        >
          keys {eng.midiKeys ? "on" : "off"}
        </button>

        {/* tempo */}
        <span className="ml-auto flex items-center gap-2">
          <button
            className={ctl + px + idle}
            onClick={() => engine.tapTempo()}
            title="tap tempo"
          >
            tap
          </button>
          <Knob
            value={eng.arrangement.bpm}
            min={40}
            max={220}
            defaultValue={120}
            size={36}
            onChange={(v) => engine.setArrangementBpm(v)}
            label="tempo"
            fmt={(v) => Math.round(v) + ""}
          />
        </span>
      </div>

      {eng.recording && loopOn && (
        <div className="px-2.5 font-mono text-[9.5px] text-faint" role="status">
          punch = loop brace — audio keeps PCM inside the loop
        </div>
      )}
    </div>
  );
}
