// ── FxChainRack — the generic modular device-chain editor ────────────────────
// Renders an ordered FxDeviceState[] as device panels (DeviceShell/Knob vocabulary)
// with add (dropdown), remove (✕), pick-up drag-to-reorder (⠿) and per-device on/off.
// Bound to a chain purely through callbacks, so the SAME component edits any
// track's chain and the master bus. `tail` renders fixed, non-reorderable panels
// after the chain (the master's safety limiter).

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  DEFAULT_DELAY_DIV,
  delayDivLabels,
  FILTER_MODES,
  FX_DEVICES,
  FX_DEVICE_TYPES,
  NOTE_NAMES,
  IMPARTIALER_SCALES,
  SCALE_PCS,
  DEFAULT_CENTINEL_CUSTOM_PCS,
  CENTINEL_INPUT_TYPES,
  CENTINEL_INPUT_HZ,
  type FilterMode,
  type FxDeviceType,
  type FxParams,
  type ImpartialerScale,
  type CentinelScale,
  type CentinelInputType,
} from "../fx-devices";
import type { FxDeviceState } from "../fx-chain";
import type { FxVizSlot } from "../spectral-viz";
import { Knob } from "./Knob";
import { DeviceShell } from "./DeviceShell";
import { openContextMenu } from "./context-menu-bus";
import { ImpartialerHeatmap } from "./fx-viz/ImpartialerHeatmap";
import { ImpartialerRta } from "./fx-viz/ImpartialerRta";
import { BandCurveEditor } from "./fx-viz/BandCurveEditor";
import { DisperserPhase } from "./fx-viz/DisperserPhase";
import { CentinelPitch } from "./fx-viz/CentinelPitch";
import { CliplimScope } from "./fx-viz/CliplimScope";
import {
  ChorusLfoViz,
  CombResponseViz,
  CompGrViz,
  CrushCurveViz,
  DelayEchoViz,
  FilterResponseViz,
  ReverbTailViz,
} from "./fx-viz/NativeFxViz";
import { EQ_MAX_BANDS, EQ_SHAPES, type EqShape } from "../eq-curve";

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
      const vizOn = p.viz !== false;
      const mode = (p.mode ?? "low") as FilterMode;
      return (
        <DeviceShell
          name="FILTER"
          on={p.on}
          onToggle={(v) => set({ on: v })}
          wide
          headerExtra={
            <div className="flex items-center gap-1">
              {FILTER_MODES.map((m) => (
                <FxChip
                  key={m}
                  label={m === "low" ? "LP" : m === "high" ? "HP" : m === "band" ? "BP" : "N"}
                  on={mode === m}
                  enabled={p.on}
                  title={
                    m === "low"
                      ? "Lowpass"
                      : m === "high"
                        ? "Highpass"
                        : m === "band"
                          ? "Bandpass"
                          : "Notch"
                  }
                  onClick={() => set({ mode: m })}
                />
              ))}
              <FxChip
                label="viz"
                on={vizOn}
                enabled
                title="Magnitude response"
                onClick={() => set({ viz: !vizOn })}
              />
            </div>
          }
          footer={
            vizOn ? (
              <FilterResponseViz
                on={p.on}
                mode={mode}
                freq={p.freq ?? 2000}
                reso={p.reso ?? 0.7}
                enabled={vizOn}
                height={88}
              />
            ) : null
          }
        >
          <Knob
            value={Math.log2((p.freq ?? 2000) / 20)}
            min={0}
            max={Math.log2(20000 / 20)}
            defaultValue={Math.log2(2000 / 20)}
            onChange={(v) => set({ freq: 20 * Math.pow(2, v) })}
            label="freq"
            disabled={!p.on}
            fmt={() => {
              const f = p.freq ?? 2000;
              return f >= 1000 ? (f / 1000).toFixed(1) + "k" : Math.round(f) + "Hz";
            }}
          />
          <Knob
            value={p.reso ?? 0.7}
            min={0.1}
            max={18}
            defaultValue={0.7}
            onChange={(v) => set({ reso: v })}
            label="reso"
            disabled={!p.on}
            fmt={(v) => v.toFixed(1)}
          />
        </DeviceShell>
      );
    }
    case "comp": {
      const p = d.params as FxParams["comp"];
      const vizOn = p.viz !== false;
      return (
        <DeviceShell
          name="COMP"
          on={p.on}
          onToggle={(v) => set({ on: v })}
          wide
          headerExtra={
            <FxChip
              label="viz"
              on={vizOn}
              enabled
              title="Live gain-reduction scope"
              onClick={() => set({ viz: !vizOn })}
            />
          }
          footer={
            vizOn ? (
              <CompGrViz
                deviceId={d.id}
                readViz={vizReader}
                threshold={p.threshold}
                enabled={vizOn}
                height={72}
              />
            ) : null
          }
        >
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
            value={p.attack ?? 0.01}
            min={0.001}
            max={0.2}
            defaultValue={0.01}
            onChange={(v) => set({ attack: v })}
            label="attack"
            disabled={!p.on}
            fmt={(v) => (v < 0.01 ? Math.round(v * 1000) + "ms" : v.toFixed(2) + "s")}
          />
          <Knob
            value={p.release ?? 0.18}
            min={0.02}
            max={1.5}
            defaultValue={0.18}
            onChange={(v) => set({ release: v })}
            label="release"
            disabled={!p.on}
            fmt={(v) => (v < 0.1 ? Math.round(v * 1000) + "ms" : v.toFixed(2) + "s")}
          />
          <Knob
            value={p.knee ?? 6}
            min={0}
            max={40}
            defaultValue={6}
            onChange={(v) => set({ knee: v })}
            label="knee"
            disabled={!p.on}
            fmt={(v) => Math.round(v) + "dB"}
          />
          <Knob
            value={p.makeup}
            min={0}
            max={24}
            defaultValue={0}
            onChange={(v) => set({ makeup: v })}
            label="makeup"
            disabled={!p.on}
            fmt={(v) => "+" + Math.round(v) + "dB"}
          />
          <Knob
            value={p.mix ?? 1}
            min={0}
            max={1}
            defaultValue={1}
            onChange={(v) => set({ mix: v })}
            label="mix"
            disabled={!p.on}
            fmt={(v) => Math.round(v * 100) + "%"}
          />
        </DeviceShell>
      );
    }
    case "delay": {
      const p = d.params as FxParams["delay"];
      const vizOn = p.viz !== false;
      return (
        <DeviceShell
          name="DELAY"
          on={p.on}
          onToggle={(v) => set({ on: v })}
          wide={vizOn}
          headerExtra={
            <FxChip
              label="viz"
              on={vizOn}
              enabled
              title="Echo tap diagram — spacing follows time/sync, height follows feedback"
              onClick={() => set({ viz: !vizOn })}
            />
          }
          footer={
            vizOn ? (
              <DelayEchoViz
                on={p.on}
                time={p.time}
                fb={p.fb}
                mix={p.mix}
                sync={p.sync}
                div={p.div}
                feel={p.feel}
                enabled={vizOn}
                height={72}
              />
            ) : null
          }
        >
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
    case "chorus": {
      const p = d.params as FxParams["chorus"];
      const vizOn = p.viz !== false;
      return (
        <DeviceShell
          name="CHORUS"
          on={p.on}
          onToggle={(v) => set({ on: v })}
          wide={vizOn}
          headerExtra={
            <FxChip
              label="viz"
              on={vizOn}
              enabled
              title="L/R LFO delay modulation"
              onClick={() => set({ viz: !vizOn })}
            />
          }
          footer={
            vizOn ? (
              <ChorusLfoViz
                on={p.on}
                rate={p.rate}
                depth={p.depth}
                mix={p.mix}
                enabled={vizOn}
                height={72}
              />
            ) : null
          }
        >
          <Knob
            value={p.rate}
            min={0.1}
            max={5}
            defaultValue={0.9}
            onChange={(v) => set({ rate: v })}
            label="rate"
            disabled={!p.on}
            fmt={(v) => v.toFixed(2) + "Hz"}
          />
          <Knob
            value={p.depth}
            min={0}
            max={1}
            defaultValue={0.45}
            onChange={(v) => set({ depth: v })}
            label="depth"
            disabled={!p.on}
            fmt={(v) => Math.round(v * 100) + "%"}
          />
          <Knob
            value={p.feedback}
            min={0}
            max={0.7}
            defaultValue={0.15}
            onChange={(v) => set({ feedback: v })}
            label="fdbk"
            disabled={!p.on}
            fmt={(v) => Math.round(v * 100) + "%"}
          />
          <Knob
            value={p.mix}
            min={0}
            max={1}
            defaultValue={0.35}
            onChange={(v) => set({ mix: v })}
            label="mix"
            disabled={!p.on}
            fmt={(v) => Math.round(v * 100) + "%"}
          />
        </DeviceShell>
      );
    }
    case "comb": {
      const p = d.params as FxParams["comb"];
      const vizOn = p.viz !== false;
      return (
        <DeviceShell
          name="COMB"
          on={p.on}
          onToggle={(v) => set({ on: v })}
          wide={vizOn}
          headerExtra={
            <FxChip
              label="viz"
              on={vizOn}
              enabled
              title="Comb magnitude response — peaks/notches at multiples of freq"
              onClick={() => set({ viz: !vizOn })}
            />
          }
          footer={
            vizOn ? (
              <CombResponseViz
                on={p.on}
                freq={p.freq}
                feedback={p.feedback}
                damp={p.damp}
                mix={p.mix}
                enabled={vizOn}
                height={88}
              />
            ) : null
          }
        >
          <Knob
            value={Math.log2(p.freq / 20)}
            min={0}
            max={Math.log2(4000 / 20)}
            defaultValue={Math.log2(220 / 20)}
            onChange={(v) => set({ freq: 20 * Math.pow(2, v) })}
            label="freq"
            disabled={!p.on}
            fmt={() =>
              p.freq >= 1000
                ? (p.freq / 1000).toFixed(1) + "k"
                : Math.round(p.freq) + "Hz"
            }
          />
          <Knob
            value={p.feedback}
            min={-0.95}
            max={0.95}
            defaultValue={0.55}
            bipolar
            onChange={(v) => set({ feedback: v })}
            label="fdbk"
            disabled={!p.on}
            fmt={(v) =>
              (v < 0 ? "−" : "") + Math.round(Math.abs(v) * 100) + "%"
            }
          />
          <Knob
            value={p.damp}
            min={0}
            max={1}
            defaultValue={0.25}
            onChange={(v) => set({ damp: v })}
            label="damp"
            disabled={!p.on}
            fmt={(v) => Math.round(v * 100) + "%"}
          />
          <Knob
            value={p.mix}
            min={0}
            max={1}
            defaultValue={0.5}
            onChange={(v) => set({ mix: v })}
            label="mix"
            disabled={!p.on}
            fmt={(v) => Math.round(v * 100) + "%"}
          />
        </DeviceShell>
      );
    }
    case "disperser": {
      const p = d.params as FxParams["disperser"];
      const vizOn = p.viz !== false;
      return (
        <DeviceShell
          name="DISPERSER"
          on={p.on}
          onToggle={(v) => set({ on: v })}
          wide={vizOn}
          headerExtra={
            <FxChip
              label="viz"
              on={vizOn}
              enabled
              title="Phase-response assistant — allpass cascade unwrap around the pin frequency"
              onClick={() => set({ viz: !vizOn })}
            />
          }
          footer={
            vizOn ? (
              <DisperserPhase
                on={p.on}
                freq={p.freq}
                amount={p.amount}
                enabled={vizOn}
                height={120}
              />
            ) : null
          }
        >
          <Knob
            value={Math.log2(p.freq / 20)}
            min={0}
            max={Math.log2(1000)}
            defaultValue={Math.log2(180 / 20)}
            onChange={(v) => set({ freq: 20 * Math.pow(2, v) })}
            label="freq"
            disabled={!p.on}
            fmt={() =>
              p.freq >= 1000
                ? (p.freq / 1000).toFixed(1) + "k"
                : Math.round(p.freq) + "Hz"
            }
          />
          <Knob
            value={p.amount}
            min={0}
            max={1}
            defaultValue={0.55}
            onChange={(v) => set({ amount: v })}
            label="amount"
            disabled={!p.on}
            fmt={(v) => Math.round(v * 100) + "%"}
          />
        </DeviceShell>
      );
    }
    case "crush": {
      const p = d.params as FxParams["crush"];
      const vizOn = p.viz !== false;
      return (
        <DeviceShell
          name="CRUSH"
          on={p.on}
          onToggle={(v) => set({ on: v })}
          wide={vizOn}
          headerExtra={
            <FxChip
              label="viz"
              on={vizOn}
              enabled
              title="Waveshaper transfer curve"
              onClick={() => set({ viz: !vizOn })}
            />
          }
          footer={
            vizOn ? (
              <CrushCurveViz
                on={p.on}
                drive={p.drive}
                autoGain={p.autoGain}
                enabled={vizOn}
                height={88}
              />
            ) : null
          }
        >
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
      const vizOn = p.viz !== false;
      return (
        <DeviceShell
          name="REVERB"
          on={p.on}
          onToggle={(v) => set({ on: v })}
          wide
          headerExtra={
            <FxChip
              label="viz"
              on={vizOn}
              enabled
              title="IR tail envelope sketch"
              onClick={() => set({ viz: !vizOn })}
            />
          }
          footer={
            vizOn ? (
              <ReverbTailViz
                on={p.on}
                decay={p.decay}
                mix={p.mix}
                predelay={p.predelay ?? 0}
                size={p.size ?? 0}
                damping={p.damping ?? 0}
                enabled={vizOn}
                height={80}
              />
            ) : null
          }
        >
          <Knob
            value={p.decay}
            min={0.2}
            max={8}
            defaultValue={2.2}
            onChange={(v) => set({ decay: v })}
            label="decay"
            disabled={!p.on}
            fmt={(v) => v.toFixed(1) + "s"}
          />
          <Knob
            value={p.size ?? 0}
            min={0}
            max={1}
            defaultValue={0}
            onChange={(v) => set({ size: v })}
            label="size"
            disabled={!p.on}
            fmt={(v) => Math.round(v * 100) + "%"}
          />
          <Knob
            value={p.predelay ?? 0}
            min={0}
            max={0.2}
            defaultValue={0}
            onChange={(v) => set({ predelay: v })}
            label="pre"
            disabled={!p.on}
            fmt={(v) => Math.round(v * 1000) + "ms"}
          />
          <Knob
            value={p.damping ?? 0}
            min={0}
            max={1}
            defaultValue={0}
            onChange={(v) => set({ damping: v })}
            label="damp"
            disabled={!p.on}
            fmt={(v) => Math.round(v * 100) + "%"}
          />
          <Knob
            value={p.diffusion ?? 0}
            min={0}
            max={1}
            defaultValue={0}
            onChange={(v) => set({ diffusion: v })}
            label="diffuse"
            disabled={!p.on}
            fmt={(v) => Math.round(v * 100) + "%"}
          />
          <Knob
            value={Math.log2((p.loCut ?? 20) / 20)}
            min={0}
            max={Math.log2(500 / 20)}
            defaultValue={0}
            onChange={(v) => set({ loCut: 20 * Math.pow(2, v) })}
            label="lo"
            disabled={!p.on}
            fmt={() => Math.round(p.loCut ?? 20) + "Hz"}
          />
          <Knob
            value={Math.log2((p.hiCut ?? 20000) / 1000)}
            min={0}
            max={Math.log2(20000 / 1000)}
            defaultValue={Math.log2(20000 / 1000)}
            onChange={(v) => set({ hiCut: 1000 * Math.pow(2, v) })}
            label="hi"
            disabled={!p.on}
            fmt={() =>
              (p.hiCut ?? 20000) >= 1000
                ? ((p.hiCut ?? 20000) / 1000).toFixed(1) + "k"
                : Math.round(p.hiCut ?? 20000) + "Hz"
            }
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
      const vizMode = p.vizMode === "trail" ? "trail" : "rta";
      return (
        <DeviceShell
          name="IMPARTIALER"
          on={p.on}
          onToggle={(v) => set({ on: v })}
          wide={vizOn}
          headerExtra={
            <div className="flex items-center gap-1">
              <FxChip
                label="viz"
                on={vizOn}
                enabled
                title="Spectral assistant — blue = raw harmonics, green = quantized × strength."
                onClick={() => set({ viz: !vizOn })}
              />
              {vizOn ? (
                <>
                  <FxChip
                    label="rta"
                    on={vizMode === "rta"}
                    enabled
                    title="Live mirrored line-spectrum — raw vs quantized"
                    onClick={() => set({ vizMode: "rta" })}
                  />
                  <FxChip
                    label="trail"
                    on={vizMode === "trail"}
                    enabled
                    title="~1s scrolling harmonic heatmap"
                    onClick={() => set({ vizMode: "trail" })}
                  />
                </>
              ) : null}
            </div>
          }
          footer={
            vizOn ? (
              vizMode === "trail" ? (
                <ImpartialerHeatmap
                  deviceId={d.id}
                  readViz={vizReader}
                  enabled={vizOn}
                  height={100}
                  historySec={1}
                />
              ) : (
                <ImpartialerRta
                  deviceId={d.id}
                  readViz={vizReader}
                  enabled={vizOn}
                  height={140}
                />
              )
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
    case "centinel": {
      const p = d.params as FxParams["centinel"];
      const vizOn = p.viz !== false;
      const formant = p.formant ?? 0;
      return (
        <DeviceShell
          name="CENTINEL"
          on={p.on}
          onToggle={(v) => set({ on: v })}
          wide={vizOn}
          headerExtra={
            <div className="flex items-center gap-1">
              <FxChip
                label="viz"
                on={vizOn}
                enabled
                title="Pitch graph — blue = detected · green = target · accent = corrected"
                onClick={() => set({ viz: !vizOn })}
              />
              <FxChip
                label="pop"
                on={
                  Math.abs(p.speed - 25) < 1 &&
                  Math.abs((p.tracking ?? 0) - 1) < 0.05 &&
                  (p.formant ?? 0) >= 0.5
                }
                enabled={p.on}
                title="Pop — ~25ms soft ratio under PSOLA (formant on), track 100%"
                onClick={() =>
                  set({
                    speed: 25,
                    flex: 0,
                    humanize: 0,
                    amount: 1,
                    formant: 1,
                    tracking: 1,
                  })
                }
              />
              <FxChip
                label="soft"
                on={
                  Math.abs(p.speed - 120) < 1 &&
                  p.humanize < 0.05 &&
                  (p.formant ?? 0) >= 0.5
                }
                enabled={p.on}
                title="Soft — ~120ms ratio chase under PSOLA"
                onClick={() =>
                  set({
                    speed: 120,
                    flex: 0,
                    humanize: 0,
                    amount: 1,
                    formant: 1,
                    tracking: 1,
                  })
                }
              />
              <FxChip
                label="robot"
                on={
                  p.speed < 0.5 &&
                  p.flex < 0.5 &&
                  p.humanize < 0.05 &&
                  Math.abs((p.amount ?? 1) - 1) < 0.05
                }
                enabled={p.on}
                title="Hard lock — always snap R* (Fairbanks if formant off)"
                onClick={() =>
                  set({
                    speed: 0,
                    flex: 0,
                    humanize: 0,
                    amount: 1,
                    formant: 0,
                    tracking: 1,
                    transpose: 0,
                  })
                }
              />
            </div>
          }
          footer={
            <>
              {vizOn ? (
                <CentinelPitch
                  deviceId={d.id}
                  readViz={vizReader}
                  enabled={vizOn}
                  height={140}
                />
              ) : null}
              <div
                className={
                  "mt-1.5 flex flex-wrap gap-1 " + (vizOn ? "border-t border-line pt-1.5" : "")
                }
              >
                <span className="mr-1 self-center font-mono text-[8px] tracking-widest text-faint">
                  map
                </span>
                {Array.from({ length: 12 }, (_, pc) => {
                  const abs = (p.key + pc) % 12;
                  const active =
                    p.scale === "custom"
                      ? (p.customPcs ?? DEFAULT_CENTINEL_CUSTOM_PCS).includes(pc)
                      : (SCALE_PCS[p.scale as ImpartialerScale] ?? SCALE_PCS.major).includes(pc);
                  return (
                    <FxChip
                      key={pc}
                      label={NOTE_NAMES[abs] ?? String(pc)}
                      on={active}
                      enabled={p.on}
                      title={
                        "Toggle " +
                        (NOTE_NAMES[abs] ?? pc) +
                        " in the custom scale map"
                      }
                      onClick={() => {
                        const base =
                          p.scale === "custom"
                            ? (p.customPcs ?? DEFAULT_CENTINEL_CUSTOM_PCS).slice()
                            : (
                                SCALE_PCS[p.scale as ImpartialerScale] ?? SCALE_PCS.major
                              ).slice();
                        const idx = base.indexOf(pc);
                        if (idx >= 0) {
                          if (base.length <= 1) return;
                          base.splice(idx, 1);
                        } else base.push(pc);
                        base.sort((a, b) => a - b);
                        set({ scale: "custom" as CentinelScale, customPcs: base });
                      }}
                    />
                  );
                })}
              </div>
            </>
          }
        >
          <Knob
            value={p.key}
            min={0}
            max={11}
            defaultValue={0}
            onChange={(v) => set({ key: Math.round(v) })}
            label="key"
            disabled={!p.on}
            fmt={(v) => NOTE_NAMES[Math.round(v)] ?? "C"}
            tip="Key center — scale degrees are relative to this root (C=0 … B=11)"
          />
          <Knob
            value={p.speed}
            min={0}
            max={400}
            defaultValue={25}
            onChange={(v) => set({ speed: v })}
            label="speed"
            disabled={!p.on}
            fmt={(v) => (v < 0.5 ? "lock" : Math.round(v) + "ms")}
            tip="Retune speed (ms). 0 = robot. Soft/pop under PSOLA chase the sticky note — but output is clamped so it can never be more off-key than the dry signal vs the natural scale note."
          />
          <Knob
            value={p.amount}
            min={0}
            max={1}
            defaultValue={1}
            onChange={(v) => set({ amount: v })}
            label="amount"
            disabled={!p.on}
            fmt={(v) => Math.round(v * 100) + "%"}
            tip="Correction strength — how far to pull toward the target note"
          />
          <Knob
            value={p.flex}
            min={0}
            max={100}
            defaultValue={0}
            onChange={(v) => set({ flex: v })}
            label="flex"
            disabled={!p.on}
            fmt={(v) => Math.round(v) + "¢"}
            tip="Dead-zone in cents — leave intentional detune alone inside this window"
          />
          <Knob
            value={p.humanize}
            min={0}
            max={1}
            defaultValue={0}
            onChange={(v) => set({ humanize: v })}
            label="human"
            disabled={!p.on}
            fmt={(v) => Math.round(v * 100) + "%"}
            tip="Not wired yet — leave at 0"
          />
          <Knob
            value={formant}
            min={0}
            max={1}
            defaultValue={0}
            onChange={(v) => set({ formant: v })}
            label="formant"
            disabled={!p.on}
            fmt={(v) => Math.round(v * 100) + "%"}
            tip="0–49% = Fairbanks (formants follow pitch; soft = within-note only) · 50%+ = PSOLA — enables real soft speed across notes. Pop/soft presets turn this on."
          />
          <Knob
            value={p.tracking}
            min={0}
            max={1}
            defaultValue={1}
            onChange={(v) => set({ tracking: v })}
            label="track"
            disabled={!p.on}
            fmt={(v) => Math.round(v * 100) + "%"}
            tip="Pitch tracking — 100% = grabby (follow quieter/faster moves); lower = pickier (ignore tails/noise)"
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
            tip="Dry/wet — latency-aligned so blends don’t comb"
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
            tip="Transpose target in semitones — shift the whole correction map (±12)"
          />
          <div className="flex flex-col gap-1 self-center">
            <FxChip
              label="midi"
              on={!!p.midiFollow}
              enabled={p.on}
              title="MIDI follow — retune to held keys / hardware / sounding MIDI clips; scale is the fallback"
              onClick={() => set({ midiFollow: !p.midiFollow })}
            />
            {CENTINEL_INPUT_TYPES.map((it) => {
              const meta = CENTINEL_INPUT_HZ[it];
              const short =
                it === "altoTenor"
                  ? "a/t"
                  : it === "lowMale"
                    ? "low"
                    : it === "bassInst"
                      ? "bass"
                      : it === "instrument"
                        ? "inst"
                        : "sop";
              return (
                <FxChip
                  key={it}
                  label={short}
                  on={(p.inputType ?? "altoTenor") === it}
                  enabled={p.on}
                  title={
                    meta.label +
                    " input — YIN " +
                    meta.fMin +
                    "–" +
                    meta.fMax +
                    " Hz (Auto-Tune–style; use Low Male / Bass for low octaves)"
                  }
                  onClick={() => set({ inputType: it as CentinelInputType })}
                />
              );
            })}
            {IMPARTIALER_SCALES.map((sc) => (
              <FxChip
                key={sc}
                label={sc === "chromatic" ? "chr" : sc.slice(0, 3)}
                on={p.scale === sc}
                enabled={p.on}
                title={
                  sc === "chromatic"
                    ? "Chromatic — snap to nearest semitone"
                    : sc.charAt(0).toUpperCase() +
                      sc.slice(1) +
                      " — snap to nearest scale degree"
                }
                onClick={() =>
                  set({
                    scale: sc as CentinelScale,
                    customPcs: SCALE_PCS[sc].slice(),
                  })
                }
              />
            ))}
            <FxChip
              label="map"
              on={p.scale === "custom"}
              enabled={p.on}
              title="Custom scale map — toggle degrees with the note chips under the graph"
              onClick={() =>
                set({
                  scale: "custom" as CentinelScale,
                  customPcs: (p.customPcs?.length
                    ? p.customPcs
                    : DEFAULT_CENTINEL_CUSTOM_PCS
                  ).slice(),
                })
              }
            />
          </div>
        </DeviceShell>
      );
    }
    case "cliplim": {
      const p = d.params as FxParams["cliplim"];
      const vizOn = p.viz !== false;
      return (
        <DeviceShell
          name="CLIPLIM"
          on={p.on}
          onToggle={(v) => set({ on: v })}
          wide={vizOn}
          headerExtra={
            <FxChip
              label="viz"
              on={vizOn}
              enabled
              title="In/out peak scope — red dashed line is the ceiling"
              onClick={() => set({ viz: !vizOn })}
            />
          }
          footer={
            vizOn ? (
              <CliplimScope
                deviceId={d.id}
                readViz={vizReader}
                ceilingDb={p.ceiling}
                enabled={vizOn}
                height={88}
              />
            ) : null
          }
        >
          <Knob
            value={p.ceiling}
            min={-12}
            max={0}
            defaultValue={-0.5}
            onChange={(v) => set({ ceiling: v })}
            label="ceil"
            disabled={!p.on}
            fmt={(v) => v.toFixed(1) + "dB"}
          />
          <Knob
            value={p.soft}
            min={0}
            max={1}
            defaultValue={0.35}
            onChange={(v) => set({ soft: v })}
            label="soft"
            disabled={!p.on}
            fmt={(v) => Math.round(v * 100) + "%"}
          />
          <Knob
            value={p.preserve}
            min={0}
            max={1}
            defaultValue={0.55}
            onChange={(v) => set({ preserve: v })}
            label="preserve"
            disabled={!p.on}
            fmt={(v) => Math.round(v * 100) + "%"}
          />
          <Knob
            value={p.lookahead}
            min={0}
            max={20}
            defaultValue={2}
            onChange={(v) => set({ lookahead: v })}
            label="look"
            disabled={!p.on}
            fmt={(v) => (v < 0.05 ? "off" : v.toFixed(1) + "ms")}
          />
          <Knob
            value={p.release}
            min={5}
            max={400}
            defaultValue={80}
            onChange={(v) => set({ release: v })}
            label="rel"
            disabled={!p.on || p.lookahead < 0.05}
            fmt={(v) => Math.round(v) + "ms"}
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
        </DeviceShell>
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
  const [sel, setSel] = useState<string | null>(curves[0]?.id ?? null);
  const selected = curves.find((c) => c.id === sel) ?? null;
  const patchCurve = (id: string, patch: Partial<import("../eq-curve").SpecCurve>) =>
    set({ curves: curves.map((c) => (c.id === id ? { ...c, ...patch } : c)) });

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
          title="RTA + dynamic threshold nodes — spectral compression, not an EQ. Nodes pull the threshold around a frequency; gold ghost = max GR (range)."
          onClick={() => set({ viz: !vizOn })}
        />
      }
      footer={
        vizOn ? (
          <div className="flex min-h-70 flex-col gap-1.5 [overflow-anchor:none]">
            <BandCurveEditor
              mode="speccomp"
              deviceId={dId}
              readViz={vizReader}
              enabled={vizOn}
              height={168}
              curves={curves}
              onCurvesChange={(next) => set({ curves: next, viz: true })}
              globalThreshold={p.threshold}
              globalTilt={p.tilt}
              selectedId={sel}
              onSelect={setSel}
            />
            {selected ? (
              <>
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <span title="Node center frequency">
                    <Knob
                      value={Math.log2(selected.freq / 20)}
                      min={0}
                      max={Math.log2(20000 / 20)}
                      defaultValue={Math.log2(1000 / 20)}
                      onChange={(v) => patchCurve(selected.id, { freq: 20 * Math.pow(2, v) })}
                      label="freq"
                      disabled={!p.on}
                      fmt={() =>
                        selected.freq >= 1000
                          ? (selected.freq / 1000).toFixed(1) + "k"
                          : Math.round(selected.freq) + "Hz"
                      }
                    />
                  </span>
                  <span title="Local threshold this node pulls toward (dB)">
                    <Knob
                      value={selected.threshold}
                      min={-60}
                      max={0}
                      defaultValue={-24}
                      onChange={(v) => patchCurve(selected.id, { threshold: v })}
                      label="thresh"
                      disabled={!p.on}
                      fmt={(v) => Math.round(v) + "dB"}
                    />
                  </span>
                  <span title="Bandwidth of the threshold pull (Q). Higher = narrower.">
                    <Knob
                      value={selected.q}
                      min={0.15}
                      max={8}
                      defaultValue={1.2}
                      onChange={(v) => patchCurve(selected.id, { q: v })}
                      label="Q"
                      disabled={!p.on}
                      fmt={(v) => v.toFixed(2)}
                    />
                  </span>
                  <FxChip
                    label={selected.on ? "on" : "off"}
                    on={selected.on}
                    enabled={p.on}
                    title="Bypass this node only"
                    onClick={() => patchCurve(selected.id, { on: !selected.on })}
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
                <div className="flex flex-wrap items-center justify-center gap-2 border-t border-line pt-1.5">
                  <span title="Max gain reduction this node may apply (dB). Ghost handle on the plot = thresh − range.">
                    <Knob
                      value={selected.range}
                      min={1}
                      max={24}
                      defaultValue={12}
                      onChange={(v) => patchCurve(selected.id, { range: v })}
                      label="range"
                      disabled={!p.on}
                      fmt={(v) => Math.round(v) + "dB"}
                    />
                  </span>
                  <span title="Local ratio when this node dominates the blend">
                    <Knob
                      value={selected.ratio}
                      min={1}
                      max={12}
                      defaultValue={4}
                      onChange={(v) => patchCurve(selected.id, { ratio: v })}
                      label="ratio"
                      disabled={!p.on}
                      fmt={(v) => v.toFixed(1) + ":1"}
                    />
                  </span>
                  <div className="max-w-44 font-mono text-[8.5px] leading-snug text-faint">
                    pulls threshold · caps GR at range
                    <br />
                    gold ghost = thresh − range
                  </div>
                </div>
              </>
            ) : (
              <div className="text-center font-mono text-[8.5px] text-faint">
                double-click analyzer to sculpt a threshold · Delete removes selection
              </div>
            )}
          </div>
        ) : null
      }
    >
      <div
        className="max-w-44 px-1 font-mono text-[9px] leading-snug text-dim"
        data-tip="Spectral compressor — sculpts a frequency-dependent threshold. Unlike EQ, this does not boost/cut statically; it only compresses when energy crosses the curve."
      >
        spectral dyn · {curves.length} node{curves.length === 1 ? "" : "s"}
        {selected ? (
          <>
            <br />
            <span className="text-faint">
              {selected.freq >= 1000
                ? (selected.freq / 1000).toFixed(1) + "k"
                : Math.round(selected.freq) + "Hz"}{" "}
              · {Math.round(selected.threshold)}dB · Q{selected.q.toFixed(1)}
              {!selected.on ? " · OFF" : ""}
            </span>
          </>
        ) : (
          <>
            <br />
            <span className="text-faint">{vizOn ? "select a node" : "open viz to sculpt"}</span>
          </>
        )}
      </div>
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
      <span title="Soft-knee width — how gradually compression engages around threshold">
        <Knob
          value={p.knee}
          min={0}
          max={24}
          defaultValue={6}
          onChange={(v) => set({ knee: v })}
          label="knee"
          disabled={!p.on}
          fmt={(v) => Math.round(v) + "dB"}
        />
      </span>
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
  const setBands = (next: import("../eq-curve").EqBand[]) =>
    set({ bands: next.slice(0, EQ_MAX_BANDS) });

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
              onBandsChange={setBands}
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
                      setBands(bands.filter((b) => b.id !== selected.id));
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
        parametric EQ · {bands.length}/{EQ_MAX_BANDS} band
        {bands.length === 1 ? "" : "s"}
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
  onCopy,
  onPaste,
  onDuplicate,
  canPaste,
  pasteLabel,
  readViz,
  tail,
}: {
  devices: FxDeviceState[];
  onAdd: (type: FxDeviceType) => void;
  onRemove: (id: string) => void;
  onMove: (id: string, toIndex: number) => void;
  onSetParams: (id: string, params: unknown) => void;
  /** Copy device type+params into the FX clipboard (cross-track). */
  onCopy?: (id: string) => void;
  /** Paste clipboard device onto this chain (append unless index given by caller). */
  onPaste?: () => void;
  /** Duplicate in-place (same chain, after source). */
  onDuplicate?: (id: string) => void;
  canPaste?: boolean;
  /** Short name of clipboard device for menu hint. */
  pasteLabel?: string | null;
  /** Poll spectral viz frames (master / track scope). */
  readViz?: (deviceId: string) => FxVizSlot | null;
  tail?: ReactNode;
}) {
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

  // Ableton-style pick-up reorder: lift a floating ghost, open a gap under the
  // cursor, commit onMove once on release (no live audio rewires mid-drag).
  //
  // Pointer tracking is on window — NOT the ⠿ handle. Starting a drag removes
  // the lifted device from the list (gap UX), which unmounts the handle; any
  // setPointerCapture / onPointerMove on that button dies with it.
  type DragState = {
    id: string;
    from: number;
    drop: number;
    ox: number;
    oy: number;
    w: number;
    h: number;
    x: number;
    y: number;
    label: string;
    on: boolean;
  };
  const [dragUi, setDragUi] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  // FLIP: visual lefts of sibling devices *before* the next gap move.
  const flipFromRef = useRef<Map<string, number>>(new Map());
  const devicesRef = useRef(devices);
  const onMoveRef = useRef(onMove);
  useEffect(() => {
    devicesRef.current = devices;
  }, [devices]);
  useEffect(() => {
    onMoveRef.current = onMove;
  }, [onMove]);

  const dropIndexAt = useCallback((clientX: number, id: string): number => {
    // Index among remaining devices (matches FxChain.moveDevice after splice-out).
    // Use offsetLeft (layout box), not getBoundingClientRect — siblings may be
    // mid-FLIP with a translateX that would skew hit-testing.
    const root = scroller.current;
    if (!root) return 0;
    const origin = root.getBoundingClientRect().left - root.scrollLeft;
    const list = devicesRef.current.filter((d) => d.id !== id);
    for (let i = 0; i < list.length; i++) {
      const el = root.querySelector(
        `[data-fxid="${list[i].id}"]`,
      ) as HTMLElement | null;
      if (!el) continue;
      const mid = origin + el.offsetLeft + el.offsetWidth / 2;
      if (clientX < mid) return i;
    }
    return list.length;
  }, []);

  const autoScroll = useCallback((clientX: number) => {
    const el = scroller.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const edge = 48;
    if (clientX < r.left + edge) el.scrollLeft -= 14;
    else if (clientX > r.right - edge) el.scrollLeft += 14;
  }, []);

  const captureFlipFrom = useCallback((liftId: string) => {
    const map = new Map<string, number>();
    const root = scroller.current;
    if (!root) {
      flipFromRef.current = map;
      return;
    }
    for (const d of devicesRef.current) {
      if (d.id === liftId) continue;
      const el = root.querySelector(`[data-fxid="${d.id}"]`) as HTMLElement | null;
      if (!el) continue;
      // Visual left (includes mid-flight transform) so chained gap moves stay smooth.
      map.set(d.id, el.getBoundingClientRect().left);
    }
    flipFromRef.current = map;
  }, []);

  const clearFlipStyles = useCallback(() => {
    const root = scroller.current;
    if (!root) return;
    for (const el of root.querySelectorAll<HTMLElement>("[data-fxid]")) {
      el.style.transition = "";
      el.style.transform = "";
    }
    flipFromRef.current = new Map();
  }, []);

  // After the gap reflows, invert sibling jumps then play translateX → 0.
  useLayoutEffect(() => {
    if (!dragUi) return;
    const root = scroller.current;
    if (!root) return;
    const from = flipFromRef.current;
    if (from.size === 0) return;

    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const playing: HTMLElement[] = [];

    for (const d of devicesRef.current) {
      if (d.id === dragUi.id) continue;
      const el = root.querySelector(`[data-fxid="${d.id}"]`) as HTMLElement | null;
      if (!el) continue;
      const first = from.get(d.id);
      if (first === undefined) continue;
      // Resting layout left (strip any in-flight FLIP before measuring Last).
      el.style.transition = "none";
      el.style.transform = "none";
      const last = el.getBoundingClientRect().left;
      const dx = first - last;
      if (Math.abs(dx) < 0.5 || reduce) continue;
      el.style.transform = `translateX(${dx}px)`;
      playing.push(el);
    }
    flipFromRef.current = new Map();
    if (playing.length === 0) return;

    // Force invert paint, then ease to resting layout.
    void root.offsetWidth;
    for (const el of playing) {
      el.style.transition = "transform 180ms cubic-bezier(0.22, 1, 0.36, 1)";
      el.style.transform = "translateX(0)";
    }
    // dragUi.x/y intentionally omitted — only re-FLIP when the gap slot moves
  }, [dragUi?.id, dragUi?.drop]);

  const stopDragTracking = useCallback(() => {
    dragCleanupRef.current?.();
    dragCleanupRef.current = null;
  }, []);

  const endDrag = useCallback((commit: boolean) => {
    const cur = dragRef.current;
    dragRef.current = null;
    clearFlipStyles();
    setDragUi(null);
    stopDragTracking();
    if (!commit || !cur) return;
    // from/drop share the same coordinate system: index among others after lift
    // (from was the pre-lift index, which equals the no-op insert slot).
    if (cur.drop !== cur.from) onMoveRef.current(cur.id, cur.drop);
  }, [clearFlipStyles, stopDragTracking]);

  const startDrag =
    (id: string) => (e: ReactPointerEvent<HTMLButtonElement>) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      // Tear down any orphaned session (e.g. lost pointerup).
      stopDragTracking();
      const wrap = e.currentTarget.closest("[data-fxid]") as HTMLElement | null;
      if (!wrap) return;
      const r = wrap.getBoundingClientRect();
      const from = devices.findIndex((d) => d.id === id);
      if (from < 0) return;
      const d = devices[from];
      const next: DragState = {
        id,
        from,
        drop: from,
        ox: e.clientX - r.left,
        oy: e.clientY - r.top,
        w: r.width,
        h: r.height,
        x: r.left,
        y: r.top,
        label: FX_DEVICES[d.type].label,
        on: !!(d.params as { on?: boolean }).on,
      };
      // Snapshot siblings before the lift reflow (gap replaces the device).
      captureFlipFrom(id);
      dragRef.current = next;
      setDragUi(next);

      const prevUserSelect = document.body.style.userSelect;
      document.body.style.userSelect = "none";

      const onMove = (ev: PointerEvent) => {
        const cur = dragRef.current;
        if (!cur) return;
        autoScroll(ev.clientX);
        const drop = dropIndexAt(ev.clientX, cur.id);
        if (drop !== cur.drop) captureFlipFrom(cur.id);
        const updated: DragState = {
          ...cur,
          drop,
          x: ev.clientX - cur.ox,
          y: ev.clientY - cur.oy,
        };
        dragRef.current = updated;
        // Ghost tracks every move; FLIP only when drop (sibling layout) changes.
        setDragUi(updated);
      };
      const onUp = () => endDrag(true);
      const onCancel = () => endDrag(false);

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onCancel);
      dragCleanupRef.current = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onCancel);
        document.body.style.userSelect = prevUserSelect;
      };
    };

  useEffect(() => {
    if (!dragUi) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      endDrag(false);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [dragUi, endDrag]);

  // Unmount / hot-reload: drop listeners so we don't leak.
  useEffect(() => () => stopDragTracking(), [stopDragTracking]);

  // Visual order while dragging: others + a gap slot at `drop`.
  const dragSlots: Array<{ kind: "device"; d: (typeof devices)[0] } | { kind: "gap" }> =
    (() => {
      if (!dragUi) return devices.map((d) => ({ kind: "device" as const, d }));
      const others = devices.filter((d) => d.id !== dragUi.id);
      const out: Array<{ kind: "device"; d: (typeof devices)[0] } | { kind: "gap" }> = [];
      others.forEach((d, i) => {
        if (dragUi.drop === i) out.push({ kind: "gap" });
        out.push({ kind: "device", d });
      });
      if (dragUi.drop >= others.length) out.push({ kind: "gap" });
      return out;
    })();

  return (
    // ONE row, never wraps — the chain scrolls horizontally forever, like Ableton's device view
    <div className="relative">
      <div
        ref={scroller}
        className="fx-scroll relative flex flex-nowrap items-stretch gap-2.5 overflow-x-auto pb-1.5"
      >
        {dragSlots.map((slot) => {
          if (slot.kind === "gap" && dragUi) {
            return (
              <div
                key="fx-drop-gap"
                className="shrink-0 rounded-sm border border-dashed border-accent/50 bg-[color-mix(in_srgb,var(--accent)_8%,transparent)]"
                style={{ width: dragUi.w, minHeight: Math.max(72, dragUi.h * 0.35) }}
                aria-hidden
              />
            );
          }
          if (slot.kind !== "device") return null;
          const d = slot.d;
          const on = !!(d.params as { on?: boolean }).on;
          return (
            <div
              key={d.id}
              data-fxid={d.id}
              className="relative shrink-0 will-change-transform"
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                openContextMenu({
                  x: e.clientX,
                  y: e.clientY,
                  title: FX_DEVICES[d.type].label,
                  items: [
                    {
                      label: "copy",
                      disabled: !onCopy,
                      onClick: () => onCopy?.(d.id),
                    },
                    {
                      label: "duplicate",
                      disabled: !onDuplicate,
                      onClick: () => onDuplicate?.(d.id),
                    },
                    {
                      label: "paste",
                      disabled: !onPaste || !canPaste,
                      onClick: () => onPaste?.(),
                    },
                    { separator: true },
                    {
                      label: "remove",
                      danger: true,
                      onClick: () => onRemove(d.id),
                    },
                  ],
                });
              }}
            >
              {folded.has(d.id) ? (
                // folded: a slim vertical strip — power dot + rotated name; click to expand.
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
                    type="button"
                    onPointerDown={startDrag(d.id)}
                    className="absolute top-0.75 right-5.5 z-3 flex h-6 w-4.5 cursor-grab touch-none items-center justify-center rounded-[3px] text-[15px] leading-none text-faint transition-colors hover:bg-panel hover:text-dim active:cursor-grabbing"
                    aria-label={"reorder " + FX_DEVICES[d.type].label}
                    title="drag to reorder — pick up; Esc cancels"
                    data-tip="Pick up and drag — devices slide apart to make room; release to drop · Esc cancels"
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
                ...(onPaste
                  ? [
                      {
                        label: "paste device",
                        hint: canPaste && pasteLabel ? pasteLabel : undefined,
                        disabled: !canPaste,
                        onClick: () => onPaste(),
                      },
                      { separator: true as const },
                    ]
                  : []),
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

      {/* Floating pick-up ghost */}
      {dragUi &&
        createPortal(
          <div
            className="pointer-events-none fixed z-90 overflow-hidden rounded-sm border border-accent bg-panel2 shadow-[0_18px_40px_-12px_rgba(0,0,0,0.85)]"
            style={{
              left: dragUi.x,
              top: dragUi.y,
              width: dragUi.w,
              height: dragUi.h,
              transform: "rotate(-1.5deg) scale(1.02)",
              opacity: 0.94,
            }}
            aria-hidden
          >
            <div className="flex items-center gap-2 border-b border-line px-2.5 py-1.75">
              <span
                className={
                  "size-1.5 rounded-full " +
                  (dragUi.on
                    ? "bg-accent shadow-[0_0_6px_var(--accent)]"
                    : "bg-faint")
                }
              />
              <span className="font-mono text-[10.5px] tracking-widest text-daw-text">
                {dragUi.label.toUpperCase()}
              </span>
              <span className="ml-auto font-mono text-[9px] text-faint">esc cancels</span>
            </div>
            <div className="flex h-[calc(100%-28px)] items-center justify-center bg-[color-mix(in_srgb,var(--panel)_70%,transparent)] font-mono text-[9px] text-faint">
              drop to place
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
