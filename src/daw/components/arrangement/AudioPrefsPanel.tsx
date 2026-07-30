// ── AUDIO PREFS — small Ableton-style panel for input / buffer / latency / monitor

import { useEffect, useRef } from "react";
import {
  AUDIO_BUFFER_SIZES,
  INPUT_CHANNEL_MODES,
  engine,
  type AudioBufferSize,
  type InputChannelMode,
} from "../../engine";
import { useEngine } from "../../hooks/useEngine";

const ctl =
  "flex h-7 items-center justify-center rounded-sm border font-mono text-[10px] transition-colors ";
const idle = "border-line2 text-dim hover:border-accent hover:text-accent";
const onOff = (on: boolean) =>
  on
    ? "border-accent text-accent"
    : "border-line2 text-faint hover:border-accent hover:text-dim";
const field =
  "h-7 w-full cursor-pointer appearance-none rounded-sm border border-line2 bg-panel2 px-2 font-mono text-[10px] text-daw-text hover:border-accent focus:border-accent focus:outline-none";
const numIn =
  "h-7 w-14 rounded-sm border border-line2 bg-panel2 text-center font-mono text-[10px] text-daw-text focus:border-accent focus:outline-none";
const cap = "font-mono text-[9px] tracking-[0.06em] text-faint";

const STATUS: Record<string, string> = {
  idle: "idle — arm an audio track to open input",
  pending: "opening input…",
  live: "live",
  denied: "denied — allow mic in the browser",
  unsupported: "unsupported in this browser",
};

const CH_LABEL: Record<InputChannelMode, string> = {
  stereo: "stereo L/R",
  left: "mono ← L (in 1)",
  right: "mono ← R (in 2)",
  sum: "mono sum L+R",
};

export function AudioPrefsPanel({ onClose }: { onClose: () => void }) {
  const eng = useEngine(["transport", "clip"]);
  const prefs = eng.audioPrefs;
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void engine.listInputDevices();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onPtr = (e: PointerEvent) => {
      const el = root.current;
      if (!el) return;
      const t = e.target as Node;
      if (el.contains(t)) return;
      // keep open when clicking the opener chip
      if ((t as HTMLElement).closest?.("[data-audio-prefs-open]")) return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPtr, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPtr, true);
    };
  }, [onClose]);

  const est = eng.estimatedLatencyMs();
  const eff = eng.effectiveLatencyMs();

  return (
    <div
      ref={root}
      role="dialog"
      aria-label="audio preferences"
      className="absolute top-[calc(100%+6px)] right-0 z-40 w-[min(320px,calc(100vw-24px))] rounded-sm border border-line bg-[#0e0e12] p-3 shadow-[0_12px_40px_rgba(0,0,0,0.55)]"
    >
      <div className="mb-2.5 flex items-baseline justify-between gap-2">
        <span className="font-mono text-[11px] tracking-[0.08em] text-daw-text">audio</span>
        <span className={cap}>{STATUS[eng.inputStatus] || eng.inputStatus}</span>
      </div>

      <label className="mb-2.5 flex flex-col gap-1">
        <span className={cap}>input</span>
        <select
          className={field}
          value={prefs.inputDeviceId || ""}
          onChange={(e) =>
            engine.setAudioPrefs({
              inputDeviceId: e.target.value || null,
            })
          }
          title="audio input device"
        >
          <option value="">Default</option>
          {eng.inputDevices.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label}
            </option>
          ))}
        </select>
      </label>

      <label className="mb-2.5 flex flex-col gap-1">
        <span className={cap}>channels</span>
        <select
          className={field}
          value={prefs.inputChannels}
          onChange={(e) =>
            engine.setAudioPrefs({
              inputChannels: e.target.value as InputChannelMode,
            })
          }
          title="Scarlett mic on input 1 → mono ← L · stereo keeps both interface channels"
        >
          {INPUT_CHANNEL_MODES.map((m) => (
            <option key={m} value={m}>
              {CH_LABEL[m]}
            </option>
          ))}
        </select>
        <span className={cap}>
          interfaces usually look stereo — fold L for a mic on input 1
        </span>
      </label>

      <label className="mb-2.5 flex flex-col gap-1">
        <span className={cap}>buffer</span>
        <select
          className={field}
          value={prefs.bufferSize}
          onChange={(e) =>
            engine.setAudioPrefs({
              bufferSize: Number(e.target.value) as AudioBufferSize,
            })
          }
          title="capture buffer size — smaller = lower latency, more CPU"
        >
          {AUDIO_BUFFER_SIZES.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>

      <div className="mb-2.5 flex flex-col gap-1">
        <span className={cap}>latency compensation</span>
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            className={ctl + "px-2.5 " + onOff(prefs.latencyMode === "auto")}
            onClick={() => engine.setAudioPrefs({ latencyMode: "auto" })}
            title="estimate from buffer + AudioContext latencies"
          >
            auto
          </button>
          <button
            type="button"
            className={ctl + "px-2.5 " + onOff(prefs.latencyMode === "manual")}
            onClick={() =>
              engine.setAudioPrefs({
                latencyMode: "manual",
                latencyMs: prefs.latencyMs || est,
              })
            }
            title="set compensation in milliseconds"
          >
            manual
          </button>
          {prefs.latencyMode === "manual" ? (
            <span className="flex items-center gap-1">
              <input
                type="number"
                min={0}
                max={500}
                step={1}
                value={prefs.latencyMs}
                onChange={(e) =>
                  engine.setAudioPrefs({ latencyMs: Number(e.target.value) })
                }
                className={numIn}
                title="compensation (ms)"
              />
              <span className={cap}>ms</span>
            </span>
          ) : (
            <span className="font-mono text-[10px] text-dim">~{est} ms</span>
          )}
        </div>
        <span className={cap}>
          takes shift earlier by ~{eff} ms · USB/OS buffers not included
        </span>
      </div>

      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            className={ctl + "px-2.5 " + onOff(prefs.inputMonitor)}
            onClick={() =>
              engine.setAudioPrefs({ inputMonitor: !prefs.inputMonitor })
            }
            title="route live input to the armed audio track (use headphones)"
          >
            monitor {prefs.inputMonitor ? "on" : "off"}
          </button>
          <button type="button" className={ctl + "px-2 " + idle} onClick={onClose} title="close">
            ✕
          </button>
        </div>
        <span className={cap}>
          speakers can feedback — prefer headphones · bypasses FX/limiter for speed
        </span>
      </div>
    </div>
  );
}
