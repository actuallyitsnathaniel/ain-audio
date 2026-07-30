// ── FxChainRack — the generic modular device-chain editor ────────────────────
// Renders an ordered FxDeviceState[] as device panels (DeviceShell/Knob vocabulary)
// with add (dropdown), remove (✕), drag-to-reorder (⠿) and per-device on/off.
// Bound to a chain purely through callbacks, so the SAME component edits any
// track's chain and the master bus. `tail` renders fixed, non-reorderable panels
// after the chain (the master's safety limiter).

import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import {
  DEFAULT_DELAY_DIV,
  delayDivLabels,
  FX_DEVICES,
  FX_DEVICE_TYPES,
  NOTE_NAMES,
  IMPARTIALER_SCALES,
  type FxDeviceType,
  type FxParams,
  type ImpartialerScale,
} from "../fx-devices";
import type { FxDeviceState } from "../fx-chain";
import { Knob } from "./Knob";
import { DeviceShell } from "./DeviceShell";
import { openContextMenu } from "./context-menu-bus";

// Small labelled toggle chip with a glowing dot — used for sync / feel / auto-gain.
function FxChip({
  label,
  on,
  enabled,
  title,
  onClick,
}: {
  label: string;
  on: boolean;
  enabled: boolean;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      className={
        "flex items-center justify-center gap-1 rounded-[3px] border px-1.5 py-0.75 font-mono text-[8.5px] leading-none tracking-[0.05em] transition-colors " +
        (on
          ? "border-[color-mix(in_srgb,var(--accent)_55%,transparent)] text-accent"
          : "border-line text-faint") +
        (enabled ? " cursor-pointer" : " pointer-events-none opacity-50")
      }
      onClick={onClick}
      title={title}
    >
      <span
        className={
          "h-1.25 w-1.25 rounded-full " +
          (on ? "bg-accent shadow-[0_0_5px_var(--accent)]" : "bg-faint")
        }
      />
      {label}
    </button>
  );
}

// One device instance's param panel. Reads d.params, writes a full merged params
// object back through `set` (the chain owns application + persistence).
function DevicePanel({
  d,
  set,
}: {
  d: FxDeviceState;
  set: (patch: object) => void;
}) {
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
            fmt={(v) =>
              Math.abs(v - 0.5) < 0.02 ? "off" : v < 0.5 ? "LP" : "HP"
            }
          />
        </DeviceShell>
      );
    }
    case "comp": {
      const p = d.params as FxParams["comp"];
      return (
        <DeviceShell name="COMP" on={p.on} onToggle={(v) => set({ on: v })}>
          <Knob
            value={p.threshold}
            min={-48}
            max={0}
            defaultValue={-18}
            onChange={(v) => set({ threshold: v })}
            label="thresh"
            disabled={!p.on}
            fmt={(v) => Math.round(v) + "dB"}
          />
          <Knob
            value={p.ratio}
            min={1}
            max={20}
            defaultValue={4}
            onChange={(v) => set({ ratio: v })}
            label="ratio"
            disabled={!p.on}
            fmt={(v) => v.toFixed(1) + ":1"}
          />
          <Knob
            value={p.makeup}
            min={0}
            max={18}
            defaultValue={0}
            onChange={(v) => set({ makeup: v })}
            label="makeup"
            disabled={!p.on}
            fmt={(v) => "+" + Math.round(v) + "dB"}
          />
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
            <Knob
              value={p.time}
              min={0.05}
              max={0.6}
              defaultValue={0.32}
              onChange={(v) => set({ time: v })}
              label="time"
              disabled={!p.on}
              fmt={(v) => Math.round(v * 1000) + "ms"}
            />
          )}
          <Knob
            value={p.fb}
            min={0}
            max={0.75}
            defaultValue={0.35}
            onChange={(v) => set({ fb: v })}
            label="fdbk"
            disabled={!p.on}
            fmt={(v) => Math.round(v * 100) + "%"}
          />
          <Knob
            value={p.mix}
            min={0}
            max={0.6}
            defaultValue={0.3}
            onChange={(v) => set({ mix: v })}
            label="mix"
            disabled={!p.on}
            fmt={(v) => Math.round((v / 0.6) * 100) + "%"}
          />
          {/* sync + feel: knob carries straight divisions, these flip dotted/triplet */}
          <div className="flex flex-col gap-1 self-center">
            <FxChip
              label="sync"
              on={p.sync}
              enabled={p.on}
              title="lock delay time to the tempo"
              onClick={() => set({ sync: !p.sync })}
            />
            <FxChip
              label="."
              on={p.sync && p.feel === "dotted"}
              enabled={p.on && p.sync}
              title="dotted (×1.5)"
              onClick={() =>
                set({ feel: p.feel === "dotted" ? "straight" : "dotted" })
              }
            />
            <FxChip
              label="T"
              on={p.sync && p.feel === "triplet"}
              enabled={p.on && p.sync}
              title="triplet (×2/3)"
              onClick={() =>
                set({ feel: p.feel === "triplet" ? "straight" : "triplet" })
              }
            />
          </div>
        </DeviceShell>
      );
    }
    case "crush": {
      const p = d.params as FxParams["crush"];
      return (
        <DeviceShell name="CRUSH" on={p.on} onToggle={(v) => set({ on: v })}>
          <Knob
            value={p.drive}
            min={0}
            max={1}
            defaultValue={0.35}
            onChange={(v) => set({ drive: v })}
            label="drive"
            disabled={!p.on}
            fmt={(v) => Math.round(v * 100) + "%"}
          />
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
          <Knob
            value={p.decay}
            min={0.2}
            max={6}
            defaultValue={2.2}
            onChange={(v) => set({ decay: v })}
            label="decay"
            disabled={!p.on}
            fmt={(v) => v.toFixed(1) + "s"}
          />
          <Knob
            value={p.mix}
            min={0}
            max={1}
            defaultValue={0.25}
            onChange={(v) => set({ mix: v })}
            label="mix"
            disabled={!p.on}
            fmt={(v) => Math.round(v * 100) + "%"}
          />
        </DeviceShell>
      );
    }
    case "impartialer": {
      const p = d.params as FxParams["impartialer"];
      const mapOn = p.mode === "snap" || p.mode === "remap";
      return (
        <DeviceShell name="IMPARTIALER" on={p.on} onToggle={(v) => set({ on: v })}>
          <Knob
            value={p.key}
            min={0}
            max={11}
            defaultValue={0}
            onChange={(v) => set({ key: Math.round(v) })}
            label="key"
            disabled={!p.on || !mapOn}
            fmt={(v) => NOTE_NAMES[Math.round(v)] ?? "C"}
          />
          <Knob
            value={p.transpose}
            min={-12}
            max={12}
            defaultValue={0}
            bipolar
            onChange={(v) => set({ transpose: Math.round(v) })}
            label="trans"
            disabled={!p.on}
            fmt={(v) => (v > 0 ? "+" : "") + Math.round(v)}
          />
          <Knob
            value={p.strength}
            min={0}
            max={1}
            defaultValue={0.7}
            onChange={(v) => set({ strength: v })}
            label="strength"
            disabled={!p.on}
            fmt={(v) => Math.round(v * 100) + "%"}
          />
          <Knob
            value={p.maxShift}
            min={1}
            max={2}
            defaultValue={1}
            onChange={(v) => set({ maxShift: Math.round(v) })}
            label="max±"
            disabled={!p.on || p.mode !== "snap"}
            fmt={(v) => "±" + Math.round(v)}
          />
          <div className="flex flex-col gap-1 self-center">
            <FxChip
              label="snap"
              on={p.mode === "snap"}
              enabled={p.on}
              title="snap — only nudge out-of-key notes (within max±); in-key color stays"
              onClick={() => set({ mode: "snap" })}
            />
            <FxChip
              label="remap"
              on={p.mode === "remap"}
              enabled={p.on}
              title="remap — force every partial onto the scale grid (stronger lock)"
              onClick={() => set({ mode: "remap" })}
            />
            <FxChip
              label="off"
              on={p.mode === "off"}
              enabled={p.on}
              title="mapping off — transpose only (original tonality through the mapper)"
              onClick={() => set({ mode: "off" })}
            />
            <FxChip
              label="lo"
              on={p.quality === "low"}
              enabled={p.on}
              title="low latency (2048 FFT)"
              onClick={() => set({ quality: "low" })}
            />
            <FxChip
              label="hi"
              on={p.quality === "high"}
              enabled={p.on}
              title="high quality (4096 FFT, more latency)"
              onClick={() => set({ quality: "high" })}
            />
          </div>
          <div className="flex flex-col gap-1 self-center">
            {IMPARTIALER_SCALES.map((sc) => (
              <FxChip
                key={sc}
                label={sc === "chromatic" ? "chr" : sc.slice(0, 3)}
                on={p.scale === sc}
                enabled={p.on && mapOn}
                title={sc}
                onClick={() => set({ scale: sc as ImpartialerScale })}
              />
            ))}
          </div>
        </DeviceShell>
      );
    }
    case "speccomp": {
      const p = d.params as FxParams["speccomp"];
      return (
        <DeviceShell name="SPECCOMP" on={p.on} onToggle={(v) => set({ on: v })}>
          <Knob
            value={p.threshold}
            min={-48}
            max={0}
            defaultValue={-24}
            onChange={(v) => set({ threshold: v })}
            label="thresh"
            disabled={!p.on}
            fmt={(v) => Math.round(v) + "dB"}
          />
          <Knob
            value={p.ratio}
            min={1}
            max={12}
            defaultValue={4}
            onChange={(v) => set({ ratio: v })}
            label="ratio"
            disabled={!p.on}
            fmt={(v) => v.toFixed(1) + ":1"}
          />
          <Knob
            value={p.attack}
            min={0.001}
            max={0.2}
            defaultValue={0.01}
            onChange={(v) => set({ attack: v })}
            label="attack"
            disabled={!p.on}
            fmt={(v) => Math.round(v * 1000) + "ms"}
          />
          <Knob
            value={p.release}
            min={0.02}
            max={0.8}
            defaultValue={0.12}
            onChange={(v) => set({ release: v })}
            label="release"
            disabled={!p.on}
            fmt={(v) => Math.round(v * 1000) + "ms"}
          />
          <Knob
            value={p.makeup}
            min={0}
            max={18}
            defaultValue={0}
            onChange={(v) => set({ makeup: v })}
            label="makeup"
            disabled={!p.on}
            fmt={(v) => "+" + Math.round(v) + "dB"}
          />
          <Knob
            value={p.mix}
            min={0}
            max={1}
            defaultValue={1}
            onChange={(v) => set({ mix: v })}
            label="mix"
            disabled={!p.on}
            fmt={(v) => Math.round(v * 100) + "%"}
          />
          <span title="bias threshold toward lows (−) or highs (+)">
            <Knob
              value={p.tilt}
              min={-1}
              max={1}
              defaultValue={0}
              bipolar
              onChange={(v) => set({ tilt: v })}
              label="tilt"
              disabled={!p.on}
              fmt={(v) => (Math.abs(v) < 0.05 ? "flat" : v > 0 ? "hi" : "lo")}
            />
          </span>
          <span title="band count — fewer wide bands ↔ more narrow bands">
            <Knob
              value={p.focus}
              min={0}
              max={1}
              defaultValue={0.35}
              onChange={(v) => set({ focus: v })}
              label="focus"
              disabled={!p.on}
              fmt={(v) => String(12 + Math.round(v * 36))}
            />
          </span>
          <div className="flex flex-col gap-1 self-center">
            <FxChip
              label="lo"
              on={p.quality === "low"}
              enabled={p.on}
              title="low latency (2048 FFT)"
              onClick={() => set({ quality: "low" })}
            />
            <FxChip
              label="hi"
              on={p.quality === "high"}
              enabled={p.on}
              title="high quality (4096 FFT, more latency)"
              onClick={() => set({ quality: "high" })}
            />
          </div>
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
    setEdges((prev) =>
      prev.left === left && prev.right === right ? prev : { left, right },
    );
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

  const startDrag =
    (id: string) => (e: ReactPointerEvent<HTMLButtonElement>) => {
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
      <div
        ref={scroller}
        className="fx-scroll flex flex-nowrap items-stretch gap-2.5 overflow-x-auto pb-1.5"
      >
        {devices.map((d) => {
          const on = !!(d.params as { on?: boolean }).on;
          return (
            <div
              key={d.id}
              data-fxid={d.id}
              className={
                "relative shrink-0 transition-opacity " +
                (dragId === d.id ? "opacity-40" : "")
              }
            >
              {folded.has(d.id) ? (
                // folded: a slim vertical strip — power dot + rotated name; click to expand.
                // Still a data-fxid drop target, so reorder-drags pass over it correctly.
                <button
                  onClick={() => toggleFold(d.id)}
                  className="flex h-full w-6.5 flex-col items-center gap-1.75 rounded-sm border border-line bg-panel2 py-2 transition-colors hover:border-line2"
                  title={"expand " + FX_DEVICES[d.type].label}
                >
                  <span
                    className="text-[11px] leading-none text-faint"
                    aria-hidden
                  >
                    ▶
                  </span>
                  <span
                    className={
                      "size-1.5  shrink-0 rounded-full " +
                      (on
                        ? "bg-accent shadow-[0_0_5px_var(--accent)]"
                        : "bg-faint")
                    }
                  />
                  <span
                    style={{ writingMode: "vertical-rl" }}
                    className={
                      "font-mono text-[9px] tracking-[0.09em] " +
                      (on ? "text-daw-text" : "text-dim")
                    }
                  >
                    {FX_DEVICES[d.type].label.toUpperCase()}
                  </span>
                </button>
              ) : (
                <>
                  <button
                    onClick={() => toggleFold(d.id)}
                    className="absolute top-0.75 right-10.25 z-3 flex h-6 w-4.5 items-center justify-center rounded-[3px] text-[12px] leading-none text-faint transition-colors hover:bg-panel hover:text-dim"
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
                    className="absolute top-0.75 right-5.5 z-3 flex h-6 w-4.5 cursor-grab touch-none items-center justify-center rounded-[3px] text-[15px] leading-none text-faint transition-colors hover:bg-panel hover:text-dim active:cursor-grabbing"
                    aria-label={"reorder " + FX_DEVICES[d.type].label}
                    title="drag to reorder"
                  >
                    ⠿
                  </button>
                  <button
                    onClick={() => onRemove(d.id)}
                    className="absolute top-0.75 right-0.75 z-3 flex h-6 w-4.5 items-center justify-center rounded-[3px] text-[11px] leading-none text-faint transition-colors hover:bg-panel hover:text-[#e98c79]"
                    aria-label={"remove " + FX_DEVICES[d.type].label}
                    title="remove device"
                  >
                    ✕
                  </button>
                  <DevicePanel
                    d={d}
                    set={(patch) =>
                      onSetParams(d.id, { ...(d.params as object), ...patch })
                    }
                  />
                </>
              )}
            </div>
          );
        })}
        {devices.length === 0 && (
          <div className="flex shrink-0 items-center rounded-sm border border-dashed border-line px-3 font-mono text-[9.5px] text-faint">
            no devices — add one →
          </div>
        )}
        <button
          type="button"
          aria-label="add device"
          aria-haspopup="menu"
          className="cursor-pointer rounded-[3px] border border-line2 bg-panel2 px-2 py-1.25 font-mono text-[9.5px] tracking-[0.05em] text-dim transition-colors hover:border-accent hover:text-accent focus:border-accent focus:outline-none"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            // native stack first, then spectral worklets (same options-menu chrome)
            const native = FX_DEVICE_TYPES.filter(
              (t) => t !== "impartialer" && t !== "speccomp",
            );
            const spectral = FX_DEVICE_TYPES.filter(
              (t) => t === "impartialer" || t === "speccomp",
            );
            openContextMenu({
              x: r.left,
              y: r.bottom + 4,
              title: "add device",
              items: [
                ...native.map((t) => ({
                  label: FX_DEVICES[t].label,
                  onClick: () => onAdd(t),
                })),
                ...(spectral.length ? [{ separator: true as const }] : []),
                ...spectral.map((t) => ({
                  label: FX_DEVICES[t].label,
                  hint: "spectral",
                  onClick: () => onAdd(t),
                })),
              ],
            });
          }}
        >
          + device
        </button>
        {tail}
      </div>
      {/* clipped-content indicators — pointer-events-none, stop above the scrollbar (6px pad + 8px bar) */}
      {edges.left && (
        <div className="pointer-events-none absolute top-0 bottom-3.5 left-0 flex w-14 items-center justify-start bg-[linear-gradient(to_left,transparent,var(--panel))]">
          <span
            className="pl-0.5 text-[11px] leading-none text-accent"
            aria-hidden
          >
            ◀
          </span>
        </div>
      )}
      {edges.right && (
        <div className="pointer-events-none absolute top-0 right-0 bottom-3.5 flex w-14 items-center justify-end bg-[linear-gradient(to_right,transparent,var(--panel))]">
          <span
            className="pr-0.5 text-[11px] leading-none text-accent"
            aria-hidden
          >
            ▶
          </span>
        </div>
      )}
    </div>
  );
}
