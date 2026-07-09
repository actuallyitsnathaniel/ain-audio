// ── FxRack — the MASTER bus device chain ─────────────────────────────────────
// A thin binding of the generic FxChainRack to the engine's master chain
// (add/remove/reorder/params via the addMasterDevice… API), plus the fixed
// safety-limiter tail that always sits after the chain. Mounted in the audio
// lab ("visitor fx") and on the studio page (pass a `hint` to rebrand).

import { useRef } from "react";
import { engine } from "../../engine";
import { useEngine } from "../../hooks/useEngine";
import { useRafLoop } from "../../hooks/useRafLoop";
import { Knob } from "../Knob";
import { DeviceShell } from "../DeviceShell";
import { FxChainRack } from "../FxChainRack";

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

export function FxRack({ hint }: { hint?: string }) {
  const eng = useEngine(["fx"]);
  const limiter = eng.limiter;
  return (
    <div className="border-t border-line pt-[14px]">
      <div className="mb-[10px] font-mono text-[10.5px] tracking-[0.06em] text-faint">
        {hint ?? "visitor fx — mangle it, i don't mind · the master chain: add devices, drag ⠿ to reorder"}
      </div>
      <FxChainRack
        devices={eng.masterDevices()}
        onAdd={(t) => engine.addMasterDevice(t)}
        onRemove={(id) => engine.removeMasterDevice(id)}
        onMove={(id, to) => engine.moveMasterDevice(id, to)}
        onSetParams={(id, p) => engine.setMasterDeviceParams(id, p)}
        tail={
          <>
            {/* fixed master-bus safety limiter — never reordered, lives after the chain */}
            <div className="flex shrink-0 items-center px-[2px] font-mono text-[14px] text-faint" aria-hidden>
              ▸
            </div>
            <div className="shrink-0">
              <DeviceShell name="LIMIT" on={limiter.on} onToggle={(v) => engine.setLimiter({ on: v })}>
                <Knob value={limiter.ceiling} min={-12} max={0} defaultValue={-1.5} onChange={(v) => engine.setLimiter({ ceiling: v })} label="ceiling" disabled={!limiter.on} fmt={(v) => v.toFixed(1) + "dB"} />
                <span className="flex flex-col items-center justify-center gap-[3px] font-mono text-[8.5px] tracking-[0.05em] text-faint">
                  <LimitLed />
                  peak
                </span>
              </DeviceShell>
            </div>
          </>
        }
      />
    </div>
  );
}
