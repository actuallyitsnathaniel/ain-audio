// ── SEQUENCER TRANSPORT — play/stop + tempo + swing for the beat-maker ──
import { engine } from "../../engine";
import { useEngine } from "../../hooks/useEngine";
import { Knob } from "../Knob";
import { abSnap, abSnapActive } from "../../lab-utils";

export function SequencerTransport() {
  const eng = useEngine(["transport", "clip"]);
  const playing = eng.sequencePlaying && eng.beatMode;
  const seq = eng.sequence;
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

      <span className="ml-auto font-mono text-[10.5px] tracking-[0.05em] text-faint">{eng.kit.name} kit</span>
    </div>
  );
}
