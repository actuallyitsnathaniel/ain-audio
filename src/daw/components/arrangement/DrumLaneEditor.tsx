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
  FLAT_FILT_ENV,
  defaultDrumTone,
  resolveDrumTone,
  type DrumBodyWave,
  type DrumFiltMode,
  type DrumPartialFilt,
  type DrumTailSource,
  type DrumTone,
  type FiltAdsr,
} from "../../voice-env";
import { Knob } from "../Knob";
import { EnvGraph } from "../audio-lab/EnvGraph";
import { FilterGraph } from "../audio-lab/FilterGraph";
import { fmtSec } from "../audio-lab/synth-ui";

const FILT_TYPES = ["lowpass", "highpass", "bandpass", "notch"] as const;
const PARTIAL_FILT_MODES: DrumFiltMode[] = [
  "off",
  "lowpass",
  "highpass",
  "bandpass",
];

const fmtHz = (v: number) =>
  v >= 1000 ? (v / 1000).toFixed(1) + "k" : Math.round(v) + "";

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

  const hasSample = engine.hasDrumLaneSample(lane, kit.id);
  const amp = lane.ampEnv ?? DEFAULT_DRUM_AMP;
  const filt = lane.filter ?? DEFAULT_DRUM_FILT;
  const fe = lane.filtEnv ?? DEFAULT_DRUM_FILT_ENV;
  const filtOn = filt.on !== false;
  const tone = resolveDrumTone(lane.synth, lane.tone);
  const recipe = defaultDrumTone(lane.synth);

  const patch = (partial: Parameters<typeof engine.setKitLaneVoice>[2]) => {
    const id = engine.setKitLaneVoice(kit.id, lane.id, partial);
    if (id !== kitId) onKitId?.(id);
  };

  const patchTone = (partial: Partial<DrumTone>) => {
    patch({ tone: { ...tone, ...partial } });
  };

  const loadFile = async (file: File) => {
    const ok = await engine.setKitLaneSample(kit.id, lane.id, file);
    if (!ok) window.alert("Couldn't load that sample for this lane");
  };

  const secs = hasSample ? engine.drumLaneSeconds(lane.id, kit.id) : 0;

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
            : `synth · ${lane.synth}`}
        </span>
        <button
          type="button"
          onClick={() => engine.auditionDrumLane(kit.id, lane.id)}
          className="rounded-[3px] border border-line px-1.5 py-0.5 font-mono text-[8px] text-faint hover:border-accent hover:text-accent"
          title="Audition this lane"
        >
          ▶
        </button>
        {hasSample ? (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="ml-auto rounded-[3px] border border-line px-1.5 py-0.5 font-mono text-[8px] text-faint hover:border-accent hover:text-accent"
            title="Replace this lane’s one-shot"
          >
            replace
          </button>
        ) : (
          <button
            type="button"
            onClick={() => patch({ tone: { ...recipe } })}
            className="ml-auto rounded-[3px] border border-line px-1.5 py-0.5 font-mono text-[8px] text-faint hover:border-accent hover:text-accent"
            title="Reset tone to recipe defaults"
          >
            reset
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
        <>
          {/* ── BODY ── */}
          <div className="flex flex-wrap items-end gap-2">
            <span className="w-full font-mono text-[8px] tracking-[0.08em] text-faint">
              BODY
            </span>
            <select
              value={tone.bodyWave}
              onChange={(e) =>
                patchTone({ bodyWave: e.target.value as DrumBodyWave })
              }
              className="cursor-pointer appearance-none rounded-xs border border-line2 bg-panel2 px-1.5 py-0.5 font-mono text-[9px] text-daw-text"
              title="body waveform"
            >
              {(["sine", "triangle", "square"] as const).map((w) => (
                <option key={w} value={w} className="bg-panel2">
                  {w}
                </option>
              ))}
            </select>
            <Knob
              size={30}
              label="start"
              value={tone.startHz}
              min={20}
              max={4000}
              defaultValue={recipe.startHz}
              onChange={(v) => patchTone({ startHz: Math.round(v) })}
              fmt={fmtHz}
            />
            <Knob
              size={30}
              label="end"
              value={tone.endHz}
              min={20}
              max={4000}
              defaultValue={recipe.endHz}
              onChange={(v) => patchTone({ endHz: Math.round(v) })}
              fmt={fmtHz}
            />
            <Knob
              size={28}
              label="sweep"
              value={tone.sweep}
              min={0}
              max={0.5}
              defaultValue={recipe.sweep}
              onChange={(v) => patchTone({ sweep: v })}
              fmt={fmtSec}
            />
            <Knob
              size={28}
              label="decay"
              value={tone.bodyDecay}
              min={0.01}
              max={1.5}
              defaultValue={recipe.bodyDecay}
              onChange={(v) => patchTone({ bodyDecay: v })}
              fmt={fmtSec}
            />
            <Knob
              size={28}
              label="level"
              value={tone.bodyLevel}
              min={0}
              max={1}
              defaultValue={recipe.bodyLevel}
              onChange={(v) => patchTone({ bodyLevel: v })}
              fmt={(v) => Math.round(v * 100) + "%"}
            />
            <div className="mt-0.5 min-w-40 flex-1 basis-full">
              <PitchEnvGraph
                startHz={tone.startHz}
                endHz={tone.endHz}
                sweep={tone.sweep}
                decay={tone.bodyDecay}
                level={tone.bodyLevel}
              />
            </div>
          </div>
          <PartialFiltRow
            label="BODY FILT"
            filt={tone.bodyFilt}
            followDecay={tone.bodyDecay}
            seedAmt={800}
            onChange={(bodyFilt) => patchTone({ bodyFilt })}
          />

          {/* ── HEAD ── */}
          <div className="flex flex-wrap items-end gap-2 border-t border-line pt-2">
            <span className="w-full font-mono text-[8px] tracking-[0.08em] text-faint">
              HEAD · NOISE
            </span>
            <Knob
              size={28}
              label="level"
              value={tone.noiseLevel}
              min={0}
              max={1}
              defaultValue={recipe.noiseLevel}
              onChange={(v) => patchTone({ noiseLevel: v })}
              fmt={(v) => Math.round(v * 100) + "%"}
            />
            <Knob
              size={28}
              label="decay"
              value={tone.noiseDecay}
              min={0.01}
              max={1}
              defaultValue={recipe.noiseDecay}
              onChange={(v) => patchTone({ noiseDecay: v })}
              fmt={fmtSec}
            />
            <Knob
              size={28}
              label="HP"
              value={tone.noiseHp}
              min={20}
              max={16000}
              defaultValue={recipe.noiseHp}
              onChange={(v) => patchTone({ noiseHp: Math.round(v) })}
              fmt={fmtHz}
              disabled={tone.noiseBp > 0}
            />
            <Knob
              size={28}
              label="BP"
              value={tone.noiseBp}
              min={0}
              max={8000}
              defaultValue={recipe.noiseBp}
              onChange={(v) => patchTone({ noiseBp: Math.round(v) })}
              fmt={(v) => (v <= 0 ? "off" : fmtHz(v))}
            />
            {tone.noiseBp > 0 && (
              <Knob
                size={28}
                label="Q"
                value={tone.noiseQ}
                min={0.1}
                max={12}
                defaultValue={recipe.noiseQ}
                onChange={(v) => patchTone({ noiseQ: v })}
                fmt={(v) => v.toFixed(1)}
              />
            )}
            <Knob
              size={28}
              label="bursts"
              value={tone.bursts}
              min={1}
              max={6}
              defaultValue={recipe.bursts}
              onChange={(v) => patchTone({ bursts: Math.round(v) })}
              fmt={(v) => Math.round(v) + ""}
            />
            {tone.bursts > 1 && (
              <Knob
                size={28}
                label="gap"
                value={tone.burstGap}
                min={0}
                max={0.08}
                defaultValue={recipe.burstGap}
                onChange={(v) => patchTone({ burstGap: v })}
                fmt={(v) => Math.round(v * 1000) + "ms"}
              />
            )}
          </div>
          <HeadFiltEnvRow
            env={tone.noiseFiltEnv}
            decay={tone.noiseDecay}
            useBp={tone.noiseBp > 0}
            onChange={(noiseFiltEnv) => patchTone({ noiseFiltEnv })}
          />

          {/* ── TAIL ── */}
          <div className="flex flex-wrap items-end gap-2 border-t border-line pt-2">
            <span className="w-full font-mono text-[8px] tracking-[0.08em] text-faint">
              TAIL
              <span className="ml-1.5 tracking-normal text-[7px] opacity-70">
                length / air · off when level 0
              </span>
            </span>
            <select
              value={tone.tailSource}
              onChange={(e) =>
                patchTone({
                  tailSource: e.target.value as DrumTailSource,
                })
              }
              className="cursor-pointer appearance-none rounded-xs border border-line2 bg-panel2 px-1.5 py-0.5 font-mono text-[9px] text-daw-text"
            >
              <option value="noise" className="bg-panel2">
                noise
              </option>
              <option value="sine" className="bg-panel2">
                sine
              </option>
            </select>
            <Knob
              size={28}
              label="level"
              value={tone.tailLevel}
              min={0}
              max={1}
              defaultValue={0}
              onChange={(v) => patchTone({ tailLevel: v })}
              fmt={(v) => Math.round(v * 100) + "%"}
            />
            <Knob
              size={28}
              label="decay"
              value={tone.tailDecay}
              min={0.02}
              max={2}
              defaultValue={recipe.tailDecay}
              onChange={(v) => patchTone({ tailDecay: v })}
              fmt={fmtSec}
            />
            {tone.tailSource === "sine" ? (
              <Knob
                size={28}
                label="Hz"
                value={tone.tailHz}
                min={20}
                max={800}
                defaultValue={recipe.tailHz}
                onChange={(v) => patchTone({ tailHz: Math.round(v) })}
                fmt={fmtHz}
              />
            ) : (
              <>
                <Knob
                  size={28}
                  label="HP"
                  value={tone.tailHp}
                  min={20}
                  max={16000}
                  defaultValue={recipe.tailHp}
                  onChange={(v) => patchTone({ tailHp: Math.round(v) })}
                  fmt={fmtHz}
                  disabled={tone.tailBp > 0}
                />
                <Knob
                  size={28}
                  label="BP"
                  value={tone.tailBp}
                  min={0}
                  max={8000}
                  defaultValue={recipe.tailBp}
                  onChange={(v) => patchTone({ tailBp: Math.round(v) })}
                  fmt={(v) => (v <= 0 ? "off" : fmtHz(v))}
                />
                {tone.tailBp > 0 && (
                  <Knob
                    size={28}
                    label="Q"
                    value={tone.tailQ}
                    min={0.1}
                    max={12}
                    defaultValue={recipe.tailQ}
                    onChange={(v) => patchTone({ tailQ: v })}
                    fmt={(v) => v.toFixed(1)}
                  />
                )}
              </>
            )}
          </div>
          <PartialFiltRow
            label="TAIL FILT"
            filt={tone.tailFilt}
            followDecay={tone.tailDecay}
            seedAmt={tone.tailSource === "sine" ? 400 : 1200}
            onChange={(tailFilt) => patchTone({ tailFilt })}
          />

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
            className="flex cursor-pointer items-center justify-center gap-2 rounded-sm border border-dashed border-line2 px-2 py-1.5 text-center transition-colors hover:border-accent"
          >
            <span className="font-mono text-[8px] text-faint">
              or drop a one-shot to replace synth → sample
            </span>
          </div>
        </>
      ) : (
        <>
          {/* sample window — waveform with A/B trim + level */}
          <div className="flex items-end gap-2">
            <LaneWave
              kitId={kit.id}
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

/** Shared mode/cut/Q + bipolar filt env for body & tail partials. */
function PartialFiltRow({
  label,
  filt,
  followDecay,
  seedAmt,
  onChange,
}: {
  label: string;
  filt: DrumPartialFilt;
  followDecay: number;
  seedAmt: number;
  onChange: (f: DrumPartialFilt) => void;
}) {
  const envOff = filt.env.amt === 0 && filt.mode === "off";
  return (
    <div className="flex flex-wrap items-end gap-2 border-t border-line/60 pt-1.5">
      <span className="flex w-full items-center gap-1.5 font-mono text-[8px] tracking-[0.08em] text-faint">
        {label}
        <select
          value={filt.mode}
          onChange={(e) =>
            onChange({
              ...filt,
              mode: e.target.value as DrumFiltMode,
            })
          }
          className="cursor-pointer appearance-none rounded-xs border border-line2 bg-panel2 px-1 py-0.25 font-mono text-[8px] tracking-normal text-daw-text"
        >
          {PARTIAL_FILT_MODES.map((m) => (
            <option key={m} value={m} className="bg-panel2">
              {m === "off" ? "filt off" : m.slice(0, 2).toUpperCase()}
            </option>
          ))}
        </select>
        <button
          type="button"
          title="Match filt decay to partial amp decay"
          onClick={() =>
            onChange({
              ...filt,
              mode: filt.mode === "off" ? "lowpass" : filt.mode,
              env: {
                ...filt.env,
                a: 0.002,
                d: Math.max(0.02, followDecay),
                s: 0,
                r: 0.04,
                amt: filt.env.amt === 0 ? seedAmt : filt.env.amt,
              },
            })
          }
          className="ml-auto rounded-[3px] border border-line px-1 py-0.25 font-mono text-[7px] tracking-normal text-faint hover:border-accent hover:text-accent"
        >
          follow amp
        </button>
      </span>
      <Knob
        size={26}
        label="cut"
        value={filt.cut}
        min={40}
        max={18000}
        defaultValue={18000}
        disabled={filt.mode === "off" && filt.env.amt === 0}
        onChange={(v) => onChange({ ...filt, cut: Math.round(v) })}
        fmt={fmtHz}
      />
      <Knob
        size={26}
        label="Q"
        value={filt.q}
        min={0.1}
        max={12}
        defaultValue={0.7}
        disabled={filt.mode === "off" && filt.env.amt === 0}
        onChange={(v) => onChange({ ...filt, q: v })}
        fmt={(v) => v.toFixed(1)}
      />
      <FiltEnvKnobs
        env={filt.env}
        disabled={envOff && filt.mode === "off"}
        onChange={(env) => onChange({ ...filt, env })}
      />
    </div>
  );
}

/** Head keeps implicit HP/BP from noiseHp/noiseBp — only the env knobs here. */
function HeadFiltEnvRow({
  env,
  decay,
  useBp,
  onChange,
}: {
  env: FiltAdsr;
  decay: number;
  useBp: boolean;
  onChange: (e: FiltAdsr) => void;
}) {
  return (
    <div className="flex flex-wrap items-end gap-2 border-t border-line/60 pt-1.5">
      <span className="flex w-full items-center gap-1.5 font-mono text-[8px] tracking-[0.08em] text-faint">
        HEAD FILT ENV
        <span className="tracking-normal text-[7px] opacity-70">
          {useBp ? "→ BP center" : "→ HP cut"}
        </span>
        <button
          type="button"
          title="Match filt decay to noise amp decay"
          onClick={() =>
            onChange({
              ...env,
              a: 0.002,
              d: Math.max(0.02, decay),
              s: 0,
              r: 0.04,
              amt: env.amt === 0 ? (useBp ? 600 : 2000) : env.amt,
            })
          }
          className="ml-auto rounded-[3px] border border-line px-1 py-0.25 font-mono text-[7px] tracking-normal text-faint hover:border-accent hover:text-accent"
        >
          follow amp
        </button>
      </span>
      <FiltEnvKnobs env={env} onChange={onChange} />
    </div>
  );
}

function FiltEnvKnobs({
  env,
  onChange,
  disabled,
}: {
  env: FiltAdsr;
  onChange: (e: FiltAdsr) => void;
  disabled?: boolean;
}) {
  const off = env.amt === 0;
  return (
    <>
      <Knob
        size={28}
        label="amt"
        value={env.amt}
        min={-6000}
        max={6000}
        defaultValue={0}
        bipolar
        disabled={disabled}
        onChange={(v) => onChange({ ...env, amt: Math.round(v) })}
        fmt={(v) =>
          v === 0
            ? "off"
            : v >= 1000 || v <= -1000
              ? (v / 1000).toFixed(1) + "k"
              : Math.round(v) + ""
        }
      />
      <Knob
        size={26}
        label="A"
        value={env.a}
        min={0.001}
        max={0.5}
        defaultValue={FLAT_FILT_ENV.a}
        disabled={disabled || off}
        onChange={(v) => onChange({ ...env, a: v })}
        fmt={fmtSec}
      />
      <Knob
        size={26}
        label="D"
        value={env.d}
        min={0.005}
        max={1}
        defaultValue={FLAT_FILT_ENV.d}
        disabled={disabled || off}
        onChange={(v) => onChange({ ...env, d: v })}
        fmt={fmtSec}
      />
      <Knob
        size={26}
        label="S"
        value={env.s}
        min={0}
        max={1}
        defaultValue={FLAT_FILT_ENV.s}
        disabled={disabled || off}
        onChange={(v) => onChange({ ...env, s: v })}
        fmt={(v) => Math.round(v * 100) + "%"}
      />
      <Knob
        size={26}
        label="R"
        value={env.r}
        min={0.005}
        max={1}
        defaultValue={FLAT_FILT_ENV.r}
        disabled={disabled || off}
        onChange={(v) => onChange({ ...env, r: v })}
        fmt={fmtSec}
      />
      <div
        className={
          "mt-0.5 min-w-40 flex-1 basis-full " + (off ? "opacity-40" : "")
        }
      >
        <EnvGraph a={env.a} d={env.d} s={env.s} r={env.r} height={36} />
      </div>
    </>
  );
}

function PitchEnvGraph({
  startHz,
  endHz,
  sweep,
  decay,
  level,
  height = 40,
}: {
  startHz: number;
  endHz: number;
  sweep: number;
  decay: number;
  level: number;
  height?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

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
    const pad = 4;
    const x0 = pad;
    const x1 = w - pad;
    const yTop = pad;
    const yBot = h - pad;

    if (level <= 0.001) {
      g.fillStyle = "#5a5a64";
      g.font = "8px ui-monospace, monospace";
      g.textAlign = "center";
      g.fillText("body off", w / 2, h / 2 + 3);
      g.textAlign = "left";
      return;
    }

    const logMin = Math.log(20);
    const logMax = Math.log(4000);
    const yForHz = (hz: number) => {
      const t = (Math.log(Math.max(20, hz)) - logMin) / (logMax - logMin);
      return yBot - t * (yBot - yTop);
    };
    const total = Math.max(0.02, decay);
    const sweepT = Math.min(total, Math.max(0, sweep));
    const xSweep = x0 + (sweepT / total) * (x1 - x0);

    // baseline
    g.strokeStyle = "#22222a";
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(x0, yBot);
    g.lineTo(x1, yBot);
    g.stroke();

    const y0 = yForHz(startHz);
    const y1 = yForHz(endHz);
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(xSweep, y1);
    g.lineTo(x1, y1);
    g.strokeStyle = accent;
    g.lineWidth = 1.5;
    g.stroke();

    g.fillStyle = accent;
    g.beginPath();
    g.arc(x0, y0, 2, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.arc(xSweep, y1, 2, 0, Math.PI * 2);
    g.fill();

    g.fillStyle = "#5a5a64";
    g.font = "7px ui-monospace, monospace";
    g.textAlign = "left";
    const label = (hz: number) =>
      hz >= 1000 ? (hz / 1000).toFixed(1) + "k" : Math.round(hz) + "";
    g.fillText(label(startHz), x0 + 3, Math.max(10, y0 - 3));
    g.textAlign = "right";
    g.fillText(label(endHz), x1 - 2, Math.max(10, y1 - 3));
    g.textAlign = "left";
  });

  return (
    <canvas
      ref={ref}
      className="w-full rounded-[3px] border border-line bg-[#0c0c10]"
      style={{ height }}
      title="pitch envelope (start → end over sweep)"
    />
  );
}

function LaneWave({
  kitId,
  laneId,
  a,
  b,
  onTrim,
  height = 56,
}: {
  kitId: string;
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
    const peaks = engine.drumLanePeaks(
      laneId,
      Math.max(32, Math.floor(w)),
      kitId,
    );
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
