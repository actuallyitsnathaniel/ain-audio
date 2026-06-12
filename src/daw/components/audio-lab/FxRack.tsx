import { useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { engine, delayDivLabels, type FxKey } from "../../engine";
import { useEngine } from "../../hooks/useEngine";
import { useRafLoop } from "../../hooks/useRafLoop";
import { Knob } from "../Knob";
import { DeviceShell } from "../DeviceShell";

// Small labelled toggle chip with a glowing dot — used for sync / feel / auto-gain.
function FxChip({ label, on, enabled, title, onClick }: { label: string; on: boolean; enabled: boolean; title: string; onClick: () => void }) {
  return (
    <button
      className={
        "flex items-center justify-center gap-[4px] rounded-[3px] border px-[6px] py-[3px] font-mono text-[8.5px] leading-none tracking-[0.05em] transition-colors " +
        (on ? "border-[color-mix(in_srgb,var(--accent)_55%,transparent)] text-accent" : "border-line text-faint") +
        (enabled ? " cursor-pointer" : " pointer-events-none opacity-50")
      }
      onClick={onClick}
      title={title}
    >
      <span className={"h-[5px] w-[5px] rounded-full " + (on ? "bg-accent shadow-[0_0_5px_var(--accent)]" : "bg-faint")} />
      {label}
    </button>
  );
}

// Each reorderable device renders from engine.fx[key]. Order is driven by
// engine.fxOrder; dragging a panel calls engine.setFxOrder with the new order.
function renderDevice(key: FxKey, fx: typeof engine.fx) {
  switch (key) {
    case "filter":
      return (
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
      );
    case "comp":
      return (
        <DeviceShell name="COMP" on={fx.comp.on} onToggle={(v) => engine.setFx("comp", { on: v })}>
          <Knob value={fx.comp.threshold} min={-48} max={0} defaultValue={-18} onChange={(v) => engine.setFx("comp", { threshold: v })} label="thresh" disabled={!fx.comp.on} fmt={(v) => Math.round(v) + "dB"} />
          <Knob value={fx.comp.ratio} min={1} max={20} defaultValue={4} onChange={(v) => engine.setFx("comp", { ratio: v })} label="ratio" disabled={!fx.comp.on} fmt={(v) => v.toFixed(1) + ":1"} />
          <Knob value={fx.comp.makeup} min={0} max={18} defaultValue={0} onChange={(v) => engine.setFx("comp", { makeup: v })} label="makeup" disabled={!fx.comp.on} fmt={(v) => "+" + Math.round(v) + "dB"} />
        </DeviceShell>
      );
    case "space":
      return (
        <DeviceShell name="SPACE" on={fx.space.on} onToggle={(v) => engine.setFx("space", { on: v })}>
          {fx.space.sync ? (
            <Knob
              value={fx.space.div}
              min={0}
              max={delayDivLabels.length - 1}
              defaultValue={fx.space.div}
              onChange={(v) => engine.setFx("space", { div: Math.round(v) })}
              label="div"
              disabled={!fx.space.on}
              fmt={(v) => delayDivLabels[Math.round(v)] || "—"}
            />
          ) : (
            <Knob value={fx.space.time} min={0.05} max={0.6} defaultValue={0.32} onChange={(v) => engine.setFx("space", { time: v })} label="time" disabled={!fx.space.on} fmt={(v) => Math.round(v * 1000) + "ms"} />
          )}
          <Knob value={fx.space.fb} min={0} max={0.75} defaultValue={0.35} onChange={(v) => engine.setFx("space", { fb: v })} label="fdbk" disabled={!fx.space.on} fmt={(v) => Math.round(v * 100) + "%"} />
          <Knob value={fx.space.mix} min={0} max={0.6} defaultValue={0.3} onChange={(v) => engine.setFx("space", { mix: v })} label="mix" disabled={!fx.space.on} fmt={(v) => Math.round((v / 0.6) * 100) + "%"} />
          {/* sync + feel: knob carries straight divisions, these flip dotted/triplet */}
          <div className="flex flex-col gap-[4px] self-center">
            <FxChip label="sync" on={fx.space.sync} enabled={fx.space.on} title="lock delay time to the piano-roll tempo" onClick={() => engine.setFx("space", { sync: !fx.space.sync })} />
            <FxChip label="." on={fx.space.sync && fx.space.feel === "dotted"} enabled={fx.space.on && fx.space.sync} title="dotted (×1.5)" onClick={() => engine.setFx("space", { feel: fx.space.feel === "dotted" ? "straight" : "dotted" })} />
            <FxChip label="T" on={fx.space.sync && fx.space.feel === "triplet"} enabled={fx.space.on && fx.space.sync} title="triplet (×2/3)" onClick={() => engine.setFx("space", { feel: fx.space.feel === "triplet" ? "straight" : "triplet" })} />
          </div>
        </DeviceShell>
      );
    case "crush":
      return (
        <DeviceShell name="CRUSH" on={fx.crush.on} onToggle={(v) => engine.setFx("crush", { on: v })}>
          <Knob value={fx.crush.drive} min={0} max={1} defaultValue={0.35} onChange={(v) => engine.setFx("crush", { drive: v })} label="drive" disabled={!fx.crush.on} fmt={(v) => Math.round(v * 100) + "%"} />
          <FxChip
            label="auto"
            on={fx.crush.autoGain}
            enabled={fx.crush.on}
            title="auto-gain — keep loudness steady as you drive (recommended on)"
            onClick={() => engine.setFx("crush", { autoGain: !fx.crush.autoGain })}
          />
        </DeviceShell>
      );
    case "reverb":
      return (
        <DeviceShell name="REVERB" on={fx.reverb.on} onToggle={(v) => engine.setFx("reverb", { on: v })}>
          <Knob value={fx.reverb.decay} min={0.2} max={6} defaultValue={2.2} onChange={(v) => engine.setFx("reverb", { decay: v })} label="decay" disabled={!fx.reverb.on} fmt={(v) => v.toFixed(1) + "s"} />
          <Knob value={fx.reverb.mix} min={0} max={1} defaultValue={0.25} onChange={(v) => engine.setFx("reverb", { mix: v })} label="mix" disabled={!fx.reverb.on} fmt={(v) => Math.round(v * 100) + "%"} />
        </DeviceShell>
      );
  }
}

// Live gain-reduction indicator for the safety limiter (imperative, rAF-driven).
function LimitLed() {
  const dot = useRef<HTMLSpanElement>(null);
  useRafLoop(() => {
    const red = engine.getReduction(); // dB, ≤ 0
    const active = red < -0.4;
    if (dot.current) {
      dot.current.style.background = active ? "var(--accent)" : "var(--color-faint, #5c5c66)";
      dot.current.style.boxShadow = active ? "0 0 6px var(--accent)" : "none";
    }
  });
  return <span ref={dot} className="h-[6px] w-[6px] rounded-full bg-faint" aria-hidden />;
}

export function FxRack() {
  const eng = useEngine(["fx"]);
  const fx = eng.fx;
  const order = eng.fxOrder;
  const [dragKey, setDragKey] = useState<FxKey | null>(null);
  // pointer-based reorder (works on mouse + touch + pen, unlike HTML5 DnD).
  // dragging a handle live-reorders as the pointer passes over other devices.
  const drag = useRef<{ key: FxKey } | null>(null);

  // which reorderable device sits under this client point (via data-fxkey)?
  const keyAtPoint = (x: number, y: number): FxKey | null => {
    let el = document.elementFromPoint(x, y) as HTMLElement | null;
    while (el) {
      const k = el.dataset?.fxkey;
      if (k) return k as FxKey;
      el = el.parentElement;
    }
    return null;
  };

  const startDrag = (key: FxKey) => (e: ReactPointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { key };
    setDragKey(key);
  };
  const moveDrag = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (!drag.current) return;
    const over = keyAtPoint(e.clientX, e.clientY);
    if (!over || over === drag.current.key) return;
    const cur = engine.fxOrder;
    const next = cur.filter((k) => k !== drag.current!.key);
    next.splice(next.indexOf(over), 0, drag.current.key);
    engine.setFxOrder(next); // live reorder + rewire as you drag
  };
  const endDrag = () => {
    drag.current = null;
    setDragKey(null);
  };

  return (
    <div className="border-t border-line pt-[14px]">
      <div className="mb-[10px] font-mono text-[10.5px] tracking-[0.06em] text-faint">
        visitor fx — mangle it, i don't mind · drag the ⠿ handle to reorder the chain · bypassed by default
      </div>
      <div className="flex flex-wrap items-stretch gap-[10px]">
        {order.map((key) => (
          <div
            key={key}
            data-fxkey={key}
            className={"relative transition-opacity " + (dragKey === key ? "opacity-40" : "")}
          >
            <button
              onPointerDown={startDrag(key)}
              onPointerMove={moveDrag}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              className="absolute top-[3px] right-[3px] z-[3] flex h-[24px] w-[22px] cursor-grab touch-none items-center justify-center rounded-[3px] text-[15px] leading-none text-faint transition-colors hover:bg-panel hover:text-dim active:cursor-grabbing"
              aria-label={"reorder " + key}
              title="drag to reorder"
            >
              ⠿
            </button>
            {renderDevice(key, fx)}
          </div>
        ))}
        {/* fixed master-bus safety limiter — never reordered, lives after the rack */}
        <div className="flex items-center px-[2px] font-mono text-[14px] text-faint" aria-hidden>
          ▸
        </div>
        <DeviceShell name="LIMIT" on={fx.limiter.on} onToggle={(v) => engine.setFx("limiter", { on: v })}>
          <Knob value={fx.limiter.ceiling} min={-12} max={0} defaultValue={-1.5} onChange={(v) => engine.setFx("limiter", { ceiling: v })} label="ceiling" disabled={!fx.limiter.on} fmt={(v) => v.toFixed(1) + "dB"} />
          <span className="flex flex-col items-center justify-center gap-[3px] font-mono text-[8.5px] tracking-[0.05em] text-faint">
            <LimitLed />
            peak
          </span>
        </DeviceShell>
      </div>
    </div>
  );
}
