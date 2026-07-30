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
import type { FxVizSlot } from "../spectral-viz";
import { Knob } from "./Knob";
import { DeviceShell } from "./DeviceShell";
import { openContextMenu } from "./context-menu-bus";
import { ImpartialerHeatmap } from "./fx-viz/ImpartialerHeatmap";
import { BandCurveEditor } from "./fx-viz/BandCurveEditor";
import { EQ_SHAPES, type EqShape } from "../eq-curve";

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
      type="button"
      className={
        "flex items-center justify-center gap-1 rounded-[3px] border px-1.5 py-0.75 font-mono text-[8.5px] leading-none tracking-[0.05em] transition-colors " +
        (on
          ? "border-[color-mix(in_srgb,var(--accent)_55%,transparent)] text-accent"
          : "border-line text-faint") +
        (enabled ? " cursor-pointer" : " pointer-events-none opacity-50")
      }
      onMouseDown={(e) => e.preventDefault()} // keep focus/scroll from jumping the viewport
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
  readViz,
}: {
  d: FxDeviceState;
  set: (patch: object) => void;
  readViz?: (id: string) => FxVizSlot | null;
}) {
  const vizReader = readViz ?? (() => null);
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
      const vizOn = !!p.viz;
      return (
        <DeviceShell
          name="IMPARTIALER"
          on={p.on}
          onToggle={(v) => set({ on: v })}
          wide={vizOn}
          headerExtra={
            <FxChip
              label="viz"
              on={vizOn}
              enabled
              title="spectral heatmap — dry (cool) vs wet (accent)"
              onClick={() => set({ viz: !vizOn })}
            />
          }
          footer={
            vizOn ? (
              <ImpartialerHeatmap
                deviceId={d.id}
                readViz={vizReader}
                enabled={vizOn}
              />
            ) : null
          }
        >
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
      const vizOn = !!p.viz;
      const curves = p.curves ?? [];
      return (
        <SpeccompPanel
          dId={d.id}
          p={p}
          curves={curves}
          vizOn={vizOn}
          set={set}
          vizReader={vizReader}
        />
      );
    }
    case "eq": {
      const p = d.params as FxParams["eq"];
      const vizOn = p.viz !== false;
      const bands = p.bands ?? [];
      return (
        <EqPanel
          dId={d.id}
          p={p}
          bands={bands}
          vizOn={vizOn}
          set={set}
          vizReader={vizReader}
        />
      );
    }
  }
}

/** SPECCOMP with Pro-Q-style malleable dynamic curves on the RTA. */
function SpeccompPanel({
  dId,
  p,
  curves,
  vizOn,
  set,
  vizReader,
}: {
  dId: string;
  p: FxParams["speccomp"];
  curves: import("../eq-curve").SpecCurve[];
  vizOn: boolean;
  set: (patch: object) => void;
  vizReader: (id: string) => FxVizSlot | null;
}) {
  const [sel, setSel] = useState<string | null>(null);
  const selected = curves.find((c) => c.id === sel) ?? null;
  return (
    <DeviceShell
      name="SPECCOMP"
      on={p.on}
      onToggle={(v) => set({ on: v })}
      wide={vizOn}
      headerExtra={
        <FxChip
          label="viz"
          on={vizOn}
          enabled
          title="RTA + dynamic threshold nodes — this is spectral compression, not an EQ. Nodes pull the threshold around a frequency."
          onClick={() => set({ viz: !vizOn })}
        />
      }
      footer={
        vizOn ? (
          <div className="flex flex-col gap-1.5">
            <div className="px-0.5 font-mono text-[8.5px] text-faint">
              spectral dynamics · threshold sculptor (not boost/cut)
            </div>
            <BandCurveEditor
              mode="speccomp"
              deviceId={dId}
              readViz={vizReader}
              enabled={vizOn}
              height={148}
              curves={curves}
              onCurvesChange={(next) =>
                set({ curves: next, viz: true })
              }
              globalThreshold={p.threshold}
              globalTilt={p.tilt}
              selectedId={sel}
              onSelect={setSel}
            />
            {selected ? (
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Knob
                  value={selected.range}
                  min={1}
                  max={24}
                  defaultValue={12}
                  onChange={(v) =>
                    set({
                      curves: curves.map((c) =>
                        c.id === selected.id ? { ...c, range: v } : c,
                      ),
                    })
                  }
                  label="range"
                  disabled={!p.on}
                  fmt={(v) => Math.round(v) + "dB"}
                />
                <Knob
                  value={selected.ratio}
                  min={1}
                  max={12}
                  defaultValue={4}
                  onChange={(v) =>
                    set({
                      curves: curves.map((c) =>
                        c.id === selected.id ? { ...c, ratio: v } : c,
                      ),
                    })
                  }
                  label="ratio"
                  disabled={!p.on}
                  fmt={(v) => v.toFixed(1) + ":1"}
                />
                <FxChip
                  label={selected.on ? "on" : "off"}
                  on={selected.on}
                  enabled={p.on}
                  title="bypass this node"
                  onClick={() =>
                    set({
                      curves: curves.map((c) =>
                        c.id === selected.id ? { ...c, on: !c.on } : c,
                      ),
                    })
                  }
                />
                <FxChip
                  label="del"
                  on={false}
                  enabled
                  title="Remove this node (or press Delete / Backspace). ⌥-click a handle also deletes."
                  onClick={() => {
                    set({ curves: curves.filter((c) => c.id !== selected.id) });
                    setSel(null);
                  }}
                />
              </div>
            ) : (
              <div className="text-center font-mono text-[8.5px] text-faint">
                double-click analyzer to add a node · Delete removes selection
              </div>
            )}
          </div>
        ) : null
      }
    >
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

/** Parametric EQ — Pro-Q-style curve + clear selected-band inspector. */
function EqPanel({
  dId,
  p,
  bands,
  vizOn,
  set,
  vizReader,
}: {
  dId: string;
  p: FxParams["eq"];
  bands: import("../eq-curve").EqBand[];
  vizOn: boolean;
  set: (patch: object) => void;
  vizReader: (id: string) => FxVizSlot | null;
}) {
  const [sel, setSel] = useState<string | null>(bands[0]?.id ?? null);
  const selected = bands.find((b) => b.id === sel) ?? null;
  const patchBand = (id: string, patch: Partial<import("../eq-curve").EqBand>) =>
    set({ bands: bands.map((b) => (b.id === id ? { ...b, ...patch } : b)) });

  return (
    <DeviceShell
      name="EQ"
      on={p.on}
      onToggle={(v) => set({ on: v })}
      wide
      headerExtra={
        <div className="flex items-center gap-1">
          <FxChip
            label="ST"
            on={(p.stereoMode ?? "stereo") === "stereo"}
            enabled={p.on}
            title="Stereo — EQ both channels equally"
            onClick={() => set({ stereoMode: "stereo" })}
          />
          <FxChip
            label="M"
            on={p.stereoMode === "mid"}
            enabled={p.on}
            title="Mid only — EQ the mono mid (L+R); sides pass dry"
            onClick={() => set({ stereoMode: "mid" })}
          />
          <FxChip
            label="S"
            on={p.stereoMode === "side"}
            enabled={p.on}
            title="Side only — EQ the stereo sides (L−R); mid passes dry"
            onClick={() => set({ stereoMode: "side" })}
          />
          <FxChip
            label="curve"
            on={vizOn}
            enabled
            title="Show the parametric frequency response + input spectrum."
            onClick={() => set({ viz: !vizOn })}
          />
        </div>
      }
      footer={
        vizOn ? (
          <div className="flex min-h-70 flex-col gap-1.5 [overflow-anchor:none]">
            <BandCurveEditor
              mode="eq"
              deviceId={dId}
              readViz={vizReader}
              enabled={vizOn}
              height={168}
              bands={bands}
              onBandsChange={(next) => set({ bands: next })}
              selectedId={sel}
              onSelect={setSel}
            />
            {selected ? (
              <>
                <div className="flex flex-wrap items-center justify-center gap-1.5">
                  {EQ_SHAPES.map((sh) => (
                    <FxChip
                      key={sh}
                      label={
                        sh === "lowshelf"
                          ? "LS"
                          : sh === "highshelf"
                            ? "HS"
                            : sh === "lowcut"
                              ? "LC"
                              : sh === "highcut"
                                ? "HC"
                                : sh === "bandpass"
                                  ? "BP"
                                  : sh.slice(0, 3)
                      }
                      on={selected.shape === sh}
                      enabled={p.on}
                      title={`Filter shape: ${sh}`}
                      onClick={() => patchBand(selected.id, { shape: sh as EqShape })}
                    />
                  ))}
                </div>
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <span title="Band center / corner frequency">
                    <Knob
                      value={Math.log2(selected.freq / 20)}
                      min={0}
                      max={Math.log2(20000 / 20)}
                      defaultValue={Math.log2(1000 / 20)}
                      onChange={(v) => patchBand(selected.id, { freq: 20 * Math.pow(2, v) })}
                      label="freq"
                      disabled={!p.on}
                      fmt={() =>
                        selected.freq >= 1000
                          ? (selected.freq / 1000).toFixed(1) + "k"
                          : Math.round(selected.freq) + "Hz"
                      }
                    />
                  </span>
                  <span title="Static boost/cut for this band (always-on part of the EQ)">
                    <Knob
                      value={selected.gain}
                      min={-24}
                      max={24}
                      defaultValue={0}
                      bipolar
                      onChange={(v) => patchBand(selected.id, { gain: v })}
                      label="gain"
                      disabled={!p.on || selected.shape === "lowcut" || selected.shape === "highcut"}
                      fmt={(v) => (v > 0 ? "+" : "") + v.toFixed(1) + "dB"}
                    />
                  </span>
                  <span title="Bandwidth / resonance (Q). Higher = narrower bell.">
                    <Knob
                      value={selected.q}
                      min={0.15}
                      max={8}
                      defaultValue={1}
                      onChange={(v) => patchBand(selected.id, { q: v })}
                      label="Q"
                      disabled={!p.on}
                      fmt={(v) => v.toFixed(2)}
                    />
                  </span>
                  <FxChip
                    label="solo"
                    on={!!selected.solo}
                    enabled={p.on}
                    title="Solo this band — other bands are bypassed while any solo is on (Pro-Q style)"
                    onClick={() => patchBand(selected.id, { solo: !selected.solo })}
                  />
                  <FxChip
                    label="dyn"
                    on={selected.dyn}
                    enabled={p.on}
                    title="Dynamic EQ — when this band's energy goes over Threshold, Gain moves toward Gain+Range. Negative Range ducks loud resonances; positive boosts them."
                    onClick={() => patchBand(selected.id, { dyn: !selected.dyn })}
                  />
                  <FxChip
                    label={selected.on ? "on" : "off"}
                    on={selected.on}
                    enabled={p.on}
                    title="Bypass this band only"
                    onClick={() => patchBand(selected.id, { on: !selected.on })}
                  />
                  <FxChip
                    label="del"
                    on={false}
                    enabled
                    title="Remove this band (or press Delete / Backspace). ⌥-click a handle also deletes."
                    onClick={() => {
                      set({ bands: bands.filter((b) => b.id !== selected.id) });
                      setSel(null);
                    }}
                  />
                </div>
                {selected.dyn ? (
                  <div className="flex flex-wrap items-center justify-center gap-2 border-t border-line pt-1.5">
                    <span title="Band energy level where dynamics start engaging (dBFS-ish)">
                      <Knob
                        value={selected.dynThreshold}
                        min={-48}
                        max={0}
                        defaultValue={-24}
                        onChange={(v) => patchBand(selected.id, { dynThreshold: v })}
                        label="thresh"
                        disabled={!p.on}
                        fmt={(v) => Math.round(v) + "dB"}
                      />
                    </span>
                    <span title="Extra gain applied when fully over threshold (added on top of Gain). Try -6 for a de-esser-style duck.">
                      <Knob
                        value={selected.dynRange}
                        min={-24}
                        max={24}
                        defaultValue={-6}
                        bipolar
                        onChange={(v) => patchBand(selected.id, { dynRange: v })}
                        label="range"
                        disabled={!p.on}
                        fmt={(v) => (v > 0 ? "+" : "") + Math.round(v) + "dB"}
                      />
                    </span>
                    <div className="max-w-40 font-mono text-[8.5px] leading-snug text-faint">
                      dyn: quiet → Gain · loud → Gain+Range
                      <br />
                      ghost handle on curve = dyn target
                    </div>
                  </div>
                ) : null}
              </>
            ) : (
              <div className="text-center font-mono text-[8.5px] text-faint">
                Select or double-click the curve to add a band — Delete / del removes it
              </div>
            )}
          </div>
        ) : null
      }
    >
      <div
        className="max-w-48 px-1 font-mono text-[9px] leading-snug text-dim"
        data-tip="Parametric equalizer — place bands on the analyzer to boost or cut. Unlike SPECCOMP, this changes tone with filters, not spectral compression."
      >
        parametric EQ · {bands.length} band{bands.length === 1 ? "" : "s"}
        {selected ? (
          <>
            <br />
            <span className="text-faint">
              {selected.shape} ·{" "}
              {selected.freq >= 1000
                ? (selected.freq / 1000).toFixed(1) + "k"
                : Math.round(selected.freq) + "Hz"}{" "}
              · {selected.gain >= 0 ? "+" : ""}
              {selected.gain.toFixed(1)}dB
              {selected.dyn ? " · DYN" : ""}
              {selected.solo ? " · SOLO" : ""}
            </span>
          </>
        ) : (
          <>
            <br />
            <span className="text-faint">open curve to edit</span>
          </>
        )}
      </div>
    </DeviceShell>
  );
}


export function FxChainRack({
  devices,
  onAdd,
  onRemove,
  onMove,
  onSetParams,
  readViz,
  tail,
}: {
  devices: FxDeviceState[];
  onAdd: (type: FxDeviceType) => void;
  onRemove: (id: string) => void;
  onMove: (id: string, toIndex: number) => void;
  onSetParams: (id: string, params: unknown) => void;
  /** Poll spectral viz frames (master / track scope). */
  readViz?: (deviceId: string) => FxVizSlot | null;
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
                    readViz={readViz}
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
            const btn = e.currentTarget;
            const r = btn.getBoundingClientRect();
            const native = FX_DEVICE_TYPES.filter(
              (t) => (FX_DEVICES[t].category ?? "native") === "native",
            );
            const spectral = FX_DEVICE_TYPES.filter(
              (t) => FX_DEVICES[t].category === "spectral",
            );
            openContextMenu({
              x: r.left,
              y: r.bottom + 4,
              anchor: btn,
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
