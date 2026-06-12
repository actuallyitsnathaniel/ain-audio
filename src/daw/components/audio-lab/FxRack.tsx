import { engine } from "../../engine";
import { useEngine } from "../../hooks/useEngine";
import { Knob } from "../Knob";
import { DeviceShell } from "../DeviceShell";

// Visitor FX rack — filter / delay / saturation, bypassed by default.
export function FxRack() {
  const eng = useEngine(["fx"]);
  const fx = eng.fx;
  return (
    <div className="border-t border-line pt-[14px]">
      <div className="mb-[10px] font-mono text-[10.5px] tracking-[0.06em] text-faint">
        visitor fx — mangle it, i don't mind · bypassed by default
      </div>
      <div className="flex flex-wrap gap-[10px]">
        <DeviceShell name="FILTER" on={fx.filter.on} onToggle={(v) => engine.setFx("filter", { on: v })}>
          <Knob
            value={fx.filter.morph}
            min={0}
            max={1}
            defaultValue={0.5}
            bipolar
            onChange={(v) => engine.setFx("filter", { morph: v })}
            label="lp ◂ ▸ hp"
            disabled={!fx.filter.on}
            fmt={(v) => (Math.abs(v - 0.5) < 0.02 ? "off" : v < 0.5 ? "LP" : "HP")}
          />
        </DeviceShell>
        <DeviceShell name="SPACE" on={fx.space.on} onToggle={(v) => engine.setFx("space", { on: v })}>
          <Knob value={fx.space.time} min={0.05} max={0.6} defaultValue={0.32} onChange={(v) => engine.setFx("space", { time: v })} label="time" disabled={!fx.space.on} fmt={(v) => Math.round(v * 1000) + "ms"} />
          <Knob value={fx.space.fb} min={0} max={0.75} defaultValue={0.35} onChange={(v) => engine.setFx("space", { fb: v })} label="fdbk" disabled={!fx.space.on} fmt={(v) => Math.round(v * 100) + "%"} />
          <Knob value={fx.space.mix} min={0} max={0.6} defaultValue={0.3} onChange={(v) => engine.setFx("space", { mix: v })} label="mix" disabled={!fx.space.on} fmt={(v) => Math.round((v / 0.6) * 100) + "%"} />
        </DeviceShell>
        <DeviceShell name="CRUSH" on={fx.crush.on} onToggle={(v) => engine.setFx("crush", { on: v })}>
          <Knob value={fx.crush.drive} min={0} max={1} defaultValue={0.35} onChange={(v) => engine.setFx("crush", { drive: v })} label="drive" disabled={!fx.crush.on} fmt={(v) => Math.round(v * 100) + "%"} />
        </DeviceShell>
      </div>
    </div>
  );
}
