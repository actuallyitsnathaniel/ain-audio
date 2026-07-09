// ── FxChainRack — the generic modular device-chain editor ────────────────────
// Renders an ordered FxDeviceState[] as device panels (DeviceShell/Knob vocabulary)
// with add (dropdown), remove (✕), drag-to-reorder (⠿) and per-device on/off.
// Bound to a chain purely through callbacks, so the SAME component edits any
// track's chain and the master bus. `tail` renders fixed, non-reorderable panels
// after the chain (the master's safety limiter).

import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { DEFAULT_DELAY_DIV, delayDivLabels, FX_DEVICES, FX_DEVICE_TYPES, type FxDeviceType, type FxParams } from "../fx-devices";
import type { FxDeviceState } from "../fx-chain";
import { Knob } from "./Knob";
import { DeviceShell } from "./DeviceShell";

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

// One device instance's param panel. Reads d.params, writes a full merged params
// object back through `set` (the chain owns application + persistence).
function DevicePanel({ d, set }: { d: FxDeviceState; set: (patch: object) => void }) {
  switch (d.type) {
    case "filter": {
      const p = d.params as FxParams["filter"];
      return (
        <DeviceShell name="FILTER" on={p.on} onToggle={(v) => set({ on: v })}>
          <Knob
            value={p.morph}
            min={0}
            max={1}
            defaultValue={0.5}
            bipolar
            onChange={(v) => set({ morph: v })}
            label="lp ◂ ▸ hp"
            disabled={!p.on}
            fmt={(v) => (Math.abs(v - 0.5) < 0.02 ? "off" : v < 0.5 ? "LP" : "HP")}
          />
        </DeviceShell>
      );
    }
    case "comp": {
      const p = d.params as FxParams["comp"];
      return (
        <DeviceShell name="COMP" on={p.on} onToggle={(v) => set({ on: v })}>
          <Knob value={p.threshold} min={-48} max={0} defaultValue={-18} onChange={(v) => set({ threshold: v })} label="thresh" disabled={!p.on} fmt={(v) => Math.round(v) + "dB"} />
          <Knob value={p.ratio} min={1} max={20} defaultValue={4} onChange={(v) => set({ ratio: v })} label="ratio" disabled={!p.on} fmt={(v) => v.toFixed(1) + ":1"} />
          <Knob value={p.makeup} min={0} max={18} defaultValue={0} onChange={(v) => set({ makeup: v })} label="makeup" disabled={!p.on} fmt={(v) => "+" + Math.round(v) + "dB"} />
        </DeviceShell>
      );
    }
    case "space": {
      const p = d.params as FxParams["space"];
      return (
        <DeviceShell name="SPACE" on={p.on} onToggle={(v) => set({ on: v })}>
          {p.sync ? (
            <Knob
              value={p.div}
              min={0}
              max={delayDivLabels.length - 1}
              defaultValue={DEFAULT_DELAY_DIV}
              onChange={(v) => set({ div: Math.round(v) })}
              label="div"
              disabled={!p.on}
              fmt={(v) => delayDivLabels[Math.round(v)] || "—"}
            />
          ) : (
            <Knob value={p.time} min={0.05} max={0.6} defaultValue={0.32} onChange={(v) => set({ time: v })} label="time" disabled={!p.on} fmt={(v) => Math.round(v * 1000) + "ms"} />
          )}
          <Knob value={p.fb} min={0} max={0.75} defaultValue={0.35} onChange={(v) => set({ fb: v })} label="fdbk" disabled={!p.on} fmt={(v) => Math.round(v * 100) + "%"} />
          <Knob value={p.mix} min={0} max={0.6} defaultValue={0.3} onChange={(v) => set({ mix: v })} label="mix" disabled={!p.on} fmt={(v) => Math.round((v / 0.6) * 100) + "%"} />
          {/* sync + feel: knob carries straight divisions, these flip dotted/triplet */}
          <div className="flex flex-col gap-[4px] self-center">
            <FxChip label="sync" on={p.sync} enabled={p.on} title="lock delay time to the tempo" onClick={() => set({ sync: !p.sync })} />
            <FxChip label="." on={p.sync && p.feel === "dotted"} enabled={p.on && p.sync} title="dotted (×1.5)" onClick={() => set({ feel: p.feel === "dotted" ? "straight" : "dotted" })} />
            <FxChip label="T" on={p.sync && p.feel === "triplet"} enabled={p.on && p.sync} title="triplet (×2/3)" onClick={() => set({ feel: p.feel === "triplet" ? "straight" : "triplet" })} />
          </div>
        </DeviceShell>
      );
    }
    case "crush": {
      const p = d.params as FxParams["crush"];
      return (
        <DeviceShell name="CRUSH" on={p.on} onToggle={(v) => set({ on: v })}>
          <Knob value={p.drive} min={0} max={1} defaultValue={0.35} onChange={(v) => set({ drive: v })} label="drive" disabled={!p.on} fmt={(v) => Math.round(v * 100) + "%"} />
          <FxChip
            label="auto"
            on={p.autoGain}
            enabled={p.on}
            title="auto-gain — keep loudness steady as you drive (recommended on)"
            onClick={() => set({ autoGain: !p.autoGain })}
          />
        </DeviceShell>
      );
    }
    case "reverb": {
      const p = d.params as FxParams["reverb"];
      return (
        <DeviceShell name="REVERB" on={p.on} onToggle={(v) => set({ on: v })}>
          <Knob value={p.decay} min={0.2} max={6} defaultValue={2.2} onChange={(v) => set({ decay: v })} label="decay" disabled={!p.on} fmt={(v) => v.toFixed(1) + "s"} />
          <Knob value={p.mix} min={0} max={1} defaultValue={0.25} onChange={(v) => set({ mix: v })} label="mix" disabled={!p.on} fmt={(v) => Math.round(v * 100) + "%"} />
        </DeviceShell>
      );
    }
  }
}

export function FxChainRack({
  devices,
  onAdd,
  onRemove,
  onMove,
  onSetParams,
  tail,
}: {
  devices: FxDeviceState[];
  onAdd: (type: FxDeviceType) => void;
  onRemove: (id: string) => void;
  onMove: (id: string, toIndex: number) => void;
  onSetParams: (id: string, params: unknown) => void;
  tail?: ReactNode;
}) {
  const [dragId, setDragId] = useState<string | null>(null);
  // Ableton-style device fold: a folded device is a slim vertical strip (UI state
  // only — never persisted with the chain).
  const [folded, setFolded] = useState<Set<string>>(new Set());
  const toggleFold = (id: string) =>
    setFolded((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  // Overflow affordance: edge fades + chevrons whenever content extends past the
  // visible row. The styled scrollbar alone is easy to miss (and iOS/Firefox may
  // keep it hidden), so this is the explicit "there's more this way" cue.
  const scroller = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const updateEdges = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const left = el.scrollLeft > 1;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    // bail out on no change so the every-render effect below can't loop
    setEdges((prev) => (prev.left === left && prev.right === right ? prev : { left, right }));
  }, []);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    el.addEventListener("scroll", updateEdges, { passive: true });
    const ro = new ResizeObserver(updateEdges);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", updateEdges);
      ro.disconnect();
    };
  }, [updateEdges]);
  // content changes (add/remove/fold) re-render without resizing the container —
  // re-measure after every render (three property reads, cheap)
  useEffect(updateEdges);

  // pointer-based reorder (works on mouse + touch + pen, unlike HTML5 DnD).
  // dragging a handle live-reorders as the pointer passes over other devices.
  const drag = useRef<{ id: string } | null>(null);

  // which device sits under this client point (via data-fxid)?
  const idAtPoint = (x: number, y: number): string | null => {
    let el = document.elementFromPoint(x, y) as HTMLElement | null;
    while (el) {
      const id = el.dataset?.fxid;
      if (id) return id;
      el = el.parentElement;
    }
    return null;
  };

  const startDrag = (id: string) => (e: ReactPointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { id };
    setDragId(id);
  };
  const moveDrag = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (!drag.current) return;
    const over = idAtPoint(e.clientX, e.clientY);
    if (!over || over === drag.current.id) return;
    // "take the hovered slot": target = hovered index in the FULL list. moveDevice
    // splices the dragged one out first, so this is insert-after when dragging right
    // and insert-before when dragging left — a 2-device chain stays swappable both ways.
    const to = devices.findIndex((d) => d.id === over);
    if (to >= 0) onMove(drag.current.id, to); // live reorder + rewire as you drag
  };
  const endDrag = () => {
    drag.current = null;
    setDragId(null);
  };

  return (
    // ONE row, never wraps — the chain scrolls horizontally forever, like Ableton's device view
    <div className="relative">
      <div ref={scroller} className="fx-scroll flex flex-nowrap items-stretch gap-[10px] overflow-x-auto pb-[6px]">
      {devices.map((d) => {
        const on = !!(d.params as { on?: boolean }).on;
        return (
          <div key={d.id} data-fxid={d.id} className={"relative shrink-0 transition-opacity " + (dragId === d.id ? "opacity-40" : "")}>
            {folded.has(d.id) ? (
              // folded: a slim vertical strip — power dot + rotated name; click to expand.
              // Still a data-fxid drop target, so reorder-drags pass over it correctly.
              <button
                onClick={() => toggleFold(d.id)}
                className="flex h-full w-[26px] flex-col items-center gap-[7px] rounded-[4px] border border-line bg-panel2 py-[8px] transition-colors hover:border-line2"
                title={"expand " + FX_DEVICES[d.type].label}
              >
                <span className="text-[11px] leading-none text-faint" aria-hidden>
                  ▶
                </span>
                <span className={"h-[6px] w-[6px] shrink-0 rounded-full " + (on ? "bg-accent shadow-[0_0_5px_var(--accent)]" : "bg-faint")} />
                <span style={{ writingMode: "vertical-rl" }} className={"font-mono text-[9px] tracking-[0.09em] " + (on ? "text-daw-text" : "text-dim")}>
                  {FX_DEVICES[d.type].label.toUpperCase()}
                </span>
              </button>
            ) : (
              <>
                <button
                  onClick={() => toggleFold(d.id)}
                  className="absolute top-[3px] right-[41px] z-[3] flex h-[24px] w-[18px] items-center justify-center rounded-[3px] text-[12px] leading-none text-faint transition-colors hover:bg-panel hover:text-dim"
                  aria-label={"fold " + FX_DEVICES[d.type].label}
                  title="fold device"
                >
                  ▼
                </button>
                <button
                  onPointerDown={startDrag(d.id)}
                  onPointerMove={moveDrag}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                  className="absolute top-[3px] right-[22px] z-[3] flex h-[24px] w-[18px] cursor-grab touch-none items-center justify-center rounded-[3px] text-[15px] leading-none text-faint transition-colors hover:bg-panel hover:text-dim active:cursor-grabbing"
                  aria-label={"reorder " + FX_DEVICES[d.type].label}
                  title="drag to reorder"
                >
                  ⠿
                </button>
                <button
                  onClick={() => onRemove(d.id)}
                  className="absolute top-[3px] right-[3px] z-[3] flex h-[24px] w-[18px] items-center justify-center rounded-[3px] text-[11px] leading-none text-faint transition-colors hover:bg-panel hover:text-[#e98c79]"
                  aria-label={"remove " + FX_DEVICES[d.type].label}
                  title="remove device"
                >
                  ✕
                </button>
                <DevicePanel d={d} set={(patch) => onSetParams(d.id, { ...(d.params as object), ...patch })} />
              </>
            )}
          </div>
        );
      })}
      {devices.length === 0 && (
        <div className="flex shrink-0 items-center rounded-[4px] border border-dashed border-line px-[12px] font-mono text-[9.5px] text-faint">no devices — add one →</div>
      )}
      <label className="flex shrink-0 items-center">
        <select
          value=""
          onChange={(e) => {
            if (e.target.value) onAdd(e.target.value as FxDeviceType);
          }}
          aria-label="add device"
          className="cursor-pointer appearance-none rounded-[3px] border border-line2 bg-panel2 px-[8px] py-[5px] font-mono text-[9.5px] tracking-[0.05em] text-dim transition-colors hover:border-accent hover:text-accent focus:border-accent focus:outline-none"
        >
          <option value="" disabled className="bg-panel2 text-daw-text">
            + device
          </option>
          {FX_DEVICE_TYPES.map((t) => (
            <option key={t} value={t} className="bg-panel2 text-daw-text">
              {FX_DEVICES[t].label}
            </option>
          ))}
        </select>
      </label>
      {tail}
      </div>
      {/* clipped-content indicators — pointer-events-none, stop above the scrollbar (6px pad + 8px bar) */}
      {edges.left && (
        <div className="pointer-events-none absolute top-0 bottom-[14px] left-0 flex w-[56px] items-center justify-start bg-[linear-gradient(to_left,transparent,var(--panel))]">
          <span className="pl-[2px] text-[11px] leading-none text-accent" aria-hidden>
            ◀
          </span>
        </div>
      )}
      {edges.right && (
        <div className="pointer-events-none absolute top-0 right-0 bottom-[14px] flex w-[56px] items-center justify-end bg-[linear-gradient(to_right,transparent,var(--panel))]">
          <span className="pr-[2px] text-[11px] leading-none text-accent" aria-hidden>
            ▶
          </span>
        </div>
      )}
    </div>
  );
}
