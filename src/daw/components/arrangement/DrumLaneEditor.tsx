// ── Per-lane drum voice inspector — sample window + amp/filter envs ─────────
// Docked under the drum grid; always bound to selectedLaneId (no second picker).
// Waveform + EnvGraph + FilterGraph mirror the Instrument sample/filter/amp tabs.

import { useEffect, useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { engine } from "../../engine";
import { useEngine } from "../../hooks/useEngine";
import { useRafLoop } from "../../hooks/useRafLoop";
import { findKit } from "../../data/kits";
import {
  DEFAULT_DRUM_AMP,
  DEFAULT_DRUM_FILT,
  DEFAULT_DRUM_FILT_ENV,
} from "../../voice-env";
import { Knob } from "../Knob";
import { EnvGraph } from "../audio-lab/EnvGraph";
import { FilterGraph } from "../audio-lab/FilterGraph";
import { fmtSec } from "../audio-lab/synth-ui";

const FILT_TYPES = ["lowpass", "highpass", "bandpass", "notch"] as const;

export function DrumLaneEditor({
  kitId,
  laneId,
  onLaneId,
  onKitId,
}: {
  kitId: string;
  laneId: string;
  onLaneId?: (id: string) => void;
  /** When a builtin kit is promoted, parent updates clip.pattern.kitId. */
  onKitId?: (id: string) => void;
}) {
  useEngine(["arrange", "transport"]);
  const kit = findKit(kitId);
  const lane = kit.lanes.find((l) => l.id === laneId) ?? kit.lanes[0];
  const fileRef = useRef<HTMLInputElement>(null);
  const resolvedId = lane?.id;

  // keep selection valid when kit lanes change
  useEffect(() => {
    if (resolvedId && resolvedId !== laneId) onLaneId?.(resolvedId);
  }, [resolvedId, laneId, onLaneId]);

  if (!lane) return null;

  const hasSample = !!(lane.bufId || lane.url);
  const amp = lane.ampEnv ?? DEFAULT_DRUM_AMP;
  const filt = lane.filter ?? DEFAULT_DRUM_FILT;
  const fe = lane.filtEnv ?? DEFAULT_DRUM_FILT_ENV;
  const filtOn = filt.on !== false;

  const patch = (partial: Parameters<typeof engine.setKitLaneVoice>[2]) => {
    const id = engine.setKitLaneVoice(kit.id, lane.id, partial);
    if (id !== kitId) onKitId?.(id);
  };

  const loadFile = async (file: File) => {
    const ok = await engine.setKitLaneSample(kit.id, lane.id, file);
    if (!ok) window.alert("Couldn't load that sample for this lane");
  };

  const secs = hasSample ? engine.drumLaneSeconds(lane.id) : 0;

  return (
    <div
      className="mt-0.5 flex flex-col gap-2 rounded-sm border border-accent/40 bg-[#0c0c10] p-2"
      style={{ borderLeftWidth: 2, borderLeftColor: "var(--accent)" }}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-mono text-[9px] tracking-[0.08em] text-accent">
          {lane.name.toUpperCase()} VOICE
        </span>
        <span className="font-mono text-[8px] text-faint">
          {hasSample
            ? secs > 0
              ? `sample · ${secs.toFixed(2)}s`
              : "sample"
            : "synth · drop a one-shot to shape"}
        </span>
        {hasSample && (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="ml-auto rounded-[3px] border border-line px-1.5 py-0.5 font-mono text-[8px] text-faint hover:border-accent hover:text-accent"
            title="Replace this lane’s one-shot"
          >
            replace
          </button>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="audio/*,.wav,.mp3,.m4a,.ogg,.flac,.aac"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void loadFile(f);
            e.target.value = "";
          }}
        />
      </div>

      {!hasSample ? (
        <div
          onDragOver={(e) => {
            if (Array.from(e.dataTransfer.types).includes("Files"))
              e.preventDefault();
          }}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files?.[0];
            if (f) void loadFile(f);
          }}
          onClick={() => fileRef.current?.click()}
          className="flex h-16 cursor-pointer flex-col items-center justify-center gap-1 rounded-sm border border-dashed border-line2 text-center transition-colors hover:border-accent"
        >
          <span className="font-mono text-[10px] text-dim">
            drop a one-shot for {lane.name}
          </span>
          <span className="font-mono text-[8px] text-faint">
            or click to pick · wav · mp3 · m4a · ogg
          </span>
        </div>
      ) : (
        <>
          {/* sample window — waveform with A/B trim + level */}
          <div className="flex items-end gap-2">
            <LaneWave
              laneId={lane.id}
              a={lane.a ?? 0}
              b={lane.b ?? 1}
              onTrim={(a, b) => patch({ a, b })}
            />
            <Knob
              size={32}
              label="level"
              value={lane.gain ?? 1}
              min={0}
              max={4}
              defaultValue={1}
              onChange={(v) => patch({ gain: v })}
              fmt={(v) =>
                v <= 0 ? "-∞" : (20 * Math.log10(v)).toFixed(1) + "dB"
              }
            />
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <Knob
              size={28}
              label="start"
              value={lane.a ?? 0}
              min={0}
              max={1}
              defaultValue={0}
              onChange={(v) =>
                patch({ a: Math.min(v, (lane.b ?? 1) - 0.01) })
              }
              fmt={(v) => Math.round(v * 100) + "%"}
            />
            <Knob
              size={28}
              label="end"
              value={lane.b ?? 1}
              min={0}
              max={1}
              defaultValue={1}
              onChange={(v) =>
                patch({ b: Math.max(v, (lane.a ?? 0) + 0.01) })
              }
              fmt={(v) => Math.round(v * 100) + "%"}
            />
          </div>

          {/* amp envelope */}
          <div className="flex flex-wrap items-end gap-2 border-t border-line pt-2">
            <span className="w-full font-mono text-[8px] tracking-[0.08em] text-faint">
              AMP ENV
            </span>
            <AdsrKnobs env={amp} onChange={(ampEnv) => patch({ ampEnv })} />
            <div className="mt-0.5 min-w-40 flex-1 basis-full">
              <EnvGraph a={amp.a} d={amp.d} s={amp.s} r={amp.r} height={40} />
            </div>
          </div>

          {/* filter + response curve + filt env */}
          <div className="flex flex-wrap items-end gap-2 border-t border-line pt-2">
            <span className="w-full font-mono text-[8px] tracking-[0.08em] text-faint">
              FILTER
            </span>
            <button
              type="button"
              onClick={() =>
                patch({ filter: { ...filt, on: filt.on === false } })
              }
              className={
                "rounded-[3px] border px-1.5 py-0.75 font-mono text-[9px] " +
                (filtOn
                  ? "border-accent text-accent"
                  : "border-line text-faint")
              }
            >
              {filtOn ? "on" : "off"}
            </button>
            <select
              value={filt.type}
              disabled={!filtOn}
              onChange={(e) =>
                patch({
                  filter: {
                    ...filt,
                    type: e.target.value as BiquadFilterType,
                  },
                })
              }
              className="cursor-pointer appearance-none rounded-xs border border-line2 bg-panel2 px-1.5 py-0.5 font-mono text-[9px] text-daw-text disabled:opacity-40"
            >
              {FILT_TYPES.map((t) => (
                <option key={t} value={t} className="bg-panel2">
                  {t.slice(0, 2).toUpperCase()}
                </option>
              ))}
            </select>
            <Knob
              size={30}
              label="cut"
              value={filt.cut}
              min={40}
              max={18000}
              defaultValue={18000}
              disabled={!filtOn}
              onChange={(v) =>
                patch({ filter: { ...filt, cut: Math.round(v) } })
              }
              fmt={(v) =>
                v >= 1000 ? (v / 1000).toFixed(1) + "k" : Math.round(v) + ""
              }
            />
            <Knob
              size={30}
              label="reso"
              value={filt.q}
              min={0.1}
              max={20}
              defaultValue={0.7}
              disabled={!filtOn}
              onChange={(v) => patch({ filter: { ...filt, q: v } })}
              fmt={(v) => v.toFixed(1)}
            />
            <div
              className={
                "mt-0.5 min-w-40 flex-1 basis-full " +
                (!filtOn ? "opacity-40" : "")
              }
            >
              <FilterGraph
                type={filtOn ? filt.type : "allpass"}
                cut={filt.cut}
                q={filt.q}
                height={40}
              />
            </div>
          </div>

          <div
            className={
              "flex flex-wrap items-end gap-2 border-t border-line pt-2 " +
              (!filtOn ? "opacity-40" : "")
            }
          >
            <span className="w-full font-mono text-[8px] tracking-[0.08em] text-faint">
              FILTER ENV
            </span>
            <Knob
              size={28}
              label="amt"
              value={fe.amt}
              min={-6000}
              max={9000}
              defaultValue={0}
              bipolar
              disabled={!filtOn}
              onChange={(v) =>
                patch({ filtEnv: { ...fe, amt: Math.round(v) } })
              }
              fmt={(v) =>
                v >= 1000 || v <= -1000
                  ? (v / 1000).toFixed(1) + "k"
                  : Math.round(v) + ""
              }
            />
            <AdsrKnobs
              env={fe}
              disabled={!filtOn}
              onChange={(e) => patch({ filtEnv: { ...fe, ...e } })}
            />
            <div className="mt-0.5 min-w-40 flex-1 basis-full">
              <EnvGraph a={fe.a} d={fe.d} s={fe.s} r={fe.r} height={40} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function LaneWave({
  laneId,
  a,
  b,
  onTrim,
  height = 56,
}: {
  laneId: string;
  a: number;
  b: number;
  onTrim: (a: number, b: number) => void;
  height?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drag = useRef<null | "a" | "b">(null);
  const live = useRef({ a, b });
  useEffect(() => {
    live.current = { a, b };
  }, [a, b]);

  useRafLoop(() => {
    const cv = ref.current;
    if (!cv) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = cv.clientWidth;
    const h = cv.clientHeight;
    if (cv.width !== Math.floor(w * dpr) || cv.height !== Math.floor(h * dpr)) {
      cv.width = Math.floor(w * dpr);
      cv.height = Math.floor(h * dpr);
    }
    const g = cv.getContext("2d");
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const accent =
      getComputedStyle(cv).getPropertyValue("--accent").trim() || "#54adbd";
    const mid = h / 2;
    const peaks = engine.drumLanePeaks(laneId, Math.max(32, Math.floor(w)));
    if (!peaks) {
      g.fillStyle = "#6a6a76";
      g.font = "9px ui-monospace, monospace";
      g.textAlign = "center";
      g.fillText("decoding…", w / 2, mid + 3);
      g.textAlign = "left";
      return;
    }
    const { a: la, b: lb } = live.current;

    g.fillStyle = "#5a6f78";
    const bw = w / peaks.length;
    for (let i = 0; i < peaks.length; i++) {
      const ph = Math.max(1, peaks[i] * (h - 4));
      g.fillRect(i * bw, mid - ph / 2, Math.max(1, bw - 0.5), ph);
    }
    // dim trimmed-out regions
    g.fillStyle = "rgba(0,0,0,0.55)";
    g.fillRect(0, 0, la * w, h);
    g.fillRect(lb * w, 0, (1 - lb) * w, h);
    // active window tint
    g.fillStyle = "color-mix(in srgb, " + accent + " 10%, transparent)";
    g.fillRect(la * w, 0, (lb - la) * w, h);
    // A/B bars
    const bar = (x: number) => {
      g.strokeStyle = accent;
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, h);
      g.stroke();
    };
    bar(Math.max(1, la * w));
    bar(Math.min(w - 1, lb * w));
    // zero line
    g.strokeStyle = "rgba(255,255,255,0.06)";
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(0, mid);
    g.lineTo(w, mid);
    g.stroke();
  });

  const frac = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  };
  const down = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const f = frac(e);
    const { a: la, b: lb } = live.current;
    drag.current = Math.abs(f - la) <= Math.abs(f - lb) ? "a" : "b";
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drag.current) return;
    const f = frac(e);
    const { a: la, b: lb } = live.current;
    if (drag.current === "a") onTrim(Math.min(f, lb - 0.01), lb);
    else onTrim(la, Math.max(f, la + 0.01));
  };
  const up = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    drag.current = null;
    if (e.currentTarget.hasPointerCapture?.(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
  };

  return (
    <canvas
      ref={ref}
      className="min-w-0 flex-1 cursor-ew-resize touch-none rounded-[3px] border border-line bg-[#0c0c10]"
      style={{ height }}
      title="drag the bars to trim the played region"
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
    />
  );
}

function AdsrKnobs({
  env,
  onChange,
  disabled,
}: {
  env: { a: number; d: number; s: number; r: number };
  onChange: (e: { a: number; d: number; s: number; r: number }) => void;
  disabled?: boolean;
}) {
  return (
    <>
      <Knob
        size={28}
        label="A"
        value={env.a}
        min={0.001}
        max={4}
        defaultValue={0.002}
        disabled={disabled}
        onChange={(v) => onChange({ ...env, a: v })}
        fmt={fmtSec}
      />
      <Knob
        size={28}
        label="D"
        value={env.d}
        min={0.005}
        max={4}
        defaultValue={0.18}
        disabled={disabled}
        onChange={(v) => onChange({ ...env, d: v })}
        fmt={fmtSec}
      />
      <Knob
        size={28}
        label="S"
        value={env.s}
        min={0}
        max={1}
        defaultValue={0}
        disabled={disabled}
        onChange={(v) => onChange({ ...env, s: v })}
        fmt={(v) => Math.round(v * 100) + "%"}
      />
      <Knob
        size={28}
        label="R"
        value={env.r}
        min={0.005}
        max={6}
        defaultValue={0.12}
        disabled={disabled}
        onChange={(v) => onChange({ ...env, r: v })}
        fmt={fmtSec}
      />
    </>
  );
}
