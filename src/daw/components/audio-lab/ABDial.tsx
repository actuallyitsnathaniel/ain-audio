import { engine } from "../../engine";
import { useEngine } from "../../hooks/useEngine";
import { Knob } from "../Knob";
import { abSnap, abSnapActive } from "../../lab-utils";

// MIX ← dry/wet dial → MASTER. Equal-power crossfade lives in the engine.
export function ABDial() {
  const eng = useEngine(["wet"]);
  const wet = eng.wet;
  return (
    <div className="flex items-center justify-center gap-[22px] px-0 pt-2 pb-[2px]">
      <button className={wet < 0.02 ? abSnapActive : abSnap} onClick={() => engine.setWet(0)}>
        A · MIX
      </button>
      <Knob
        value={wet}
        min={0}
        max={1}
        defaultValue={1}
        size={104}
        onChange={(v) => engine.setWet(v)}
        label="dry / wet"
        fmt={(v) => (v * 100).toFixed(0) + "% master"}
      />
      <button className={wet > 0.98 ? abSnapActive : abSnap} onClick={() => engine.setWet(1)}>
        B · MASTER
      </button>
    </div>
  );
}
