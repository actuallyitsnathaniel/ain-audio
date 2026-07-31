// ── AUDIO PREFS — Ableton-style panel: prefs | system (capability probe)

import { useEffect, useRef, useState } from "react";
import {
  AUDIO_BUFFER_SIZES,
  INPUT_CHANNEL_MODES,
  engine,
  type AudioBufferSize,
  type InputChannelMode,
} from "../../engine";
import { shortDeviceLabel } from "../../audio-capability";
import { useEngine } from "../../hooks/useEngine";
import { useRafLoop } from "../../hooks/useRafLoop";
import { requestMidiEnable } from "../midi-gate-bus";

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

const CALIB: Record<string, string> = {
  idle: "",
  running: "listening for clap…",
  done: "calibrated",
  failed: "no peak — clap louder / closer",
  needInput: "arm an audio track / allow mic first",
  unsupported: "input unsupported in this browser",
};

const CH_LABEL: Record<InputChannelMode, string> = {
  stereo: "stereo L/R",
  left: "mono ← L (in 1)",
  right: "mono ← R (in 2)",
  sum: "mono sum L+R",
};

const CEILINGS_BASE = [
  "No ASIO / Core Audio buffer control — the browser picks I/O buffering.",
  "USB/OS round-trip is invisible to the page; auto latency is approximate.",
  "Heavy FX + many tracks + tiny buffer can glitch on weaker machines.",
];

function ceilingMonitorLine(report: {
  inputDeviceKind: string;
  inputDeviceLabel: string | null;
}): string {
  if (report.inputDeviceKind === "interface" && report.inputDeviceLabel) {
    return `Software monitor cannot beat ${shortDeviceLabel(report.inputDeviceLabel)}’s hardware direct monitor.`;
  }
  if (report.inputDeviceKind === "builtin") {
    return "Built-in mics have no hardware direct monitor — software monitor is the only path.";
  }
  return "Software monitor cannot beat an interface’s hardware direct monitor.";
}

export function AudioPrefsPanel({
  onClose,
  onRereadAccept,
}: {
  onClose: () => void;
  onRereadAccept?: () => void;
}) {
  const eng = useEngine(["transport", "clip", "midi"]);
  const prefs = eng.audioPrefs;
  const root = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<"prefs" | "system">("prefs");
  const [, bump] = useState(0);
  const lastSample = useRef(0);
  const lastBump = useRef(0);

  useEffect(() => {
    void engine.refreshAudioDevices();
    void engine.probePersistCodec();
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
      if ((t as HTMLElement).closest?.("[data-audio-prefs-open]")) return;
      if ((t as HTMLElement).closest?.("[data-file-menu]")) return;
      if ((t as HTMLElement).closest?.("[data-audio-accept]")) return;
      onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPtr, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPtr, true);
    };
  }, [onClose]);

  useRafLoop(() => {
    const now = performance.now();
    if (!lastSample.current) {
      lastSample.current = now;
      return;
    }
    const dt = now - lastSample.current;
    lastSample.current = now;
    engine.sampleUiFrame(dt);
    if (tab === "system" && now - lastBump.current > 250) {
      lastBump.current = now;
      bump((x) => x + 1);
    }
  });

  const est = eng.estimatedLatencyMs();
  const eff = eng.effectiveLatencyMs();
  const report = eng.audioCapabilityReport();

  return (
    <div
      ref={root}
      role="dialog"
      aria-label="audio preferences"
      className="absolute top-[calc(100%+6px)] left-0 z-40 w-[min(340px,calc(100vw-24px))] rounded-sm border border-line bg-[#0e0e12] p-3 shadow-[0_12px_40px_rgba(0,0,0,0.55)]"
    >
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <button
            type="button"
            className={ctl + "px-2.5 " + onOff(tab === "prefs")}
            onClick={() => setTab("prefs")}
          >
            prefs
          </button>
          <button
            type="button"
            className={ctl + "px-2.5 " + onOff(tab === "system")}
            onClick={() => setTab("system")}
          >
            system
          </button>
        </div>
        <span className={cap}>{STATUS[eng.inputStatus] || eng.inputStatus}</span>
      </div>

      {tab === "prefs" ? (
        <>
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
            <span className={cap}>output</span>
            <select
              className={field}
              value={prefs.outputDeviceId || ""}
              disabled={!eng.supportsSinkId()}
              onChange={(e) =>
                engine.setAudioPrefs({
                  outputDeviceId: e.target.value || null,
                })
              }
              title={
                eng.supportsSinkId()
                  ? "audio output device (AudioContext.setSinkId)"
                  : "setSinkId not supported in this browser — system default only"
              }
            >
              <option value="">Default</option>
              {eng.outputDevices.map((d) => (
                <option key={d.deviceId} value={d.deviceId}>
                  {d.label}
                </option>
              ))}
            </select>
            {!eng.supportsSinkId() && (
              <span className={cap}>
                this browser can’t pick an output sink — system default
              </span>
            )}
          </label>

          <div className="mb-2.5 flex flex-col gap-1">
            <span className={cap}>midi</span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                className={
                  ctl +
                  "flex-1 px-2.5 " +
                  onOff(eng.midiStatus.indexOf("device") >= 0)
                }
                onClick={() => requestMidiEnable()}
                title="Connect a hardware MIDI keyboard / controller (Web MIDI)"
              >
                {eng.midiStatus === "idle"
                  ? "connect MIDI…"
                  : eng.midiStatus === "unsupported"
                    ? "MIDI unsupported"
                    : eng.midiStatus === "denied"
                      ? "MIDI denied — retry"
                      : eng.midiStatus === "no device"
                        ? "no device — retry"
                        : eng.midiStatus}
              </button>
              <button
                type="button"
                className={ctl + "px-2 " + idle}
                onClick={() => engine.panicMidiNotes()}
                title="All notes off — release stuck voices / clear sustain"
              >
                panic
              </button>
            </div>
          </div>

          <div className="mb-2.5 flex flex-col gap-1">
            <span className={cap}>synth voice</span>
            <button
              type="button"
              className={ctl + "px-2.5 " + onOff(prefs.voiceHumanize)}
              onClick={() =>
                engine.setAudioPrefs({
                  voiceHumanize: !prefs.voiceHumanize,
                })
              }
              title="Per-note osc phase jitter + sample humanize. Off (default) = identical MIDI / arrangement hits."
            >
              humanize {prefs.voiceHumanize ? "on" : "off"}
            </button>
            <span className={cap}>
              off = locked phase · on = random phase / sample detune each note
            </span>
          </div>

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
              title="mic on interface input 1 → mono ← L · stereo keeps both channels"
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
                className={
                  ctl + "px-2.5 " + onOff(prefs.latencyMode === "manual")
                }
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
              <button
                type="button"
                className={ctl + "px-2.5 " + idle}
                disabled={eng.calibrateStatus === "running"}
                onClick={() => void engine.calibrateLatency()}
                title="play a click — clap (or peak) against it to measure round-trip → sets manual ms"
              >
                calibrate
              </button>
            </div>
            <span className={cap}>
              takes shift earlier by ~{eff} ms · USB/OS buffers not included
              {eng.calibrateStatus !== "idle" && CALIB[eng.calibrateStatus]
                ? ` · ${CALIB[eng.calibrateStatus]}${
                    eng.calibrateStatus === "done" && eng.lastCalibrateMs != null
                      ? ` ${eng.lastCalibrateMs} ms`
                      : ""
                  }`
                : eng.lastCalibrateMs != null
                  ? ` · last calibrate ${eng.lastCalibrateMs} ms`
                  : ""}
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
                title="route live input to the monitor bus (use headphones)"
              >
                monitor {prefs.inputMonitor ? "on" : "off"}
              </button>
              <button
                type="button"
                className={ctl + "px-2 " + idle}
                onClick={onClose}
                title="close"
              >
                ✕
              </button>
            </div>
            <span className={cap}>
              speakers can feedback — prefer headphones · bypasses FX/limiter
            </span>
          </div>
        </>
      ) : (
        <div className="flex flex-col gap-2.5">
          <div className="rounded-sm border border-line2 bg-panel2 px-2 py-1.5 font-mono text-[10px] text-dim">
            <div>
              {report.browser} · {report.os}
              {report.sampleRate != null ? ` · ${report.sampleRate} Hz` : ""}
            </div>
            <div className="mt-1 text-faint">
              input{" "}
              <span className="text-daw-text">
                {report.inputDeviceLabel
                  ? shortDeviceLabel(report.inputDeviceLabel, 42)
                  : report.inputDeviceKind === "default"
                    ? "Default"
                    : "—"}
              </span>
              {" · "}
              out{" "}
              <span className="text-daw-text">
                {report.sinkIdSupported
                  ? report.outputDeviceLabel
                    ? shortDeviceLabel(report.outputDeviceLabel, 28)
                    : "Default"
                  : "system default"}
              </span>
              {" · "}
              store{" "}
              <span className="text-daw-text">
                {report.persistCodec === "opus"
                  ? "Opus/WebM"
                  : report.persistCodec === "wav"
                    ? "WAV"
                    : "…"}
              </span>
              {" · "}
              capture{" "}
              <span className="text-daw-text">{report.capturePath}</span>
              {" · "}~{report.effectiveLatencyMs} ms comp
              {" · "}UI frames ~{report.uiFrameAvgMs} ms (
              {report.uiFrameLoadPct}% load — not DSP)
            </div>
            {(report.baseLatencyMs != null || report.outputLatencyMs != null) && (
              <div className="mt-1 text-faint">
                ctx base {report.baseLatencyMs ?? "—"} ms · out{" "}
                {report.outputLatencyMs ?? "—"} ms
                {report.heapMb != null ? ` · heap ${report.heapMb} MB` : ""}
              </div>
            )}
          </div>

          <div>
            <span className={cap}>ceilings</span>
            <ul className="mt-1 flex flex-col gap-1">
              {[...CEILINGS_BASE, ceilingMonitorLine(report)].map((line) => (
                <li
                  key={line}
                  className="font-mono text-[9.5px] leading-snug text-faint"
                >
                  · {line}
                </li>
              ))}
            </ul>
          </div>

          <div>
            <span className={cap}>on this machine</span>
            <ul className="mt-1 flex flex-col gap-1.5">
              {report.recommendations.map((line) => (
                <li
                  key={line}
                  className="font-mono text-[9.5px] leading-snug text-dim"
                >
                  · {line}
                </li>
              ))}
            </ul>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              className={ctl + "px-2.5 " + idle}
              disabled={eng.calibrateStatus === "running"}
              onClick={() => void engine.calibrateLatency()}
              title="play a click — clap against it to measure latency → manual ms"
            >
              calibrate latency
            </button>
            {onRereadAccept && (
              <button
                type="button"
                className={ctl + "px-2.5 " + idle}
                onClick={onRereadAccept}
              >
                re-read acceptance
              </button>
            )}
            <button
              type="button"
              className={ctl + "ml-auto px-2 " + idle}
              onClick={onClose}
              title="close"
            >
              ✕
            </button>
          </div>
          {(eng.calibrateStatus !== "idle" || eng.lastCalibrateMs != null) && (
            <span className={cap}>
              {eng.calibrateStatus !== "idle" && CALIB[eng.calibrateStatus]
                ? `${CALIB[eng.calibrateStatus]}${
                    eng.calibrateStatus === "done" && eng.lastCalibrateMs != null
                      ? ` ${eng.lastCalibrateMs} ms`
                      : ""
                  }`
                : eng.lastCalibrateMs != null
                  ? `last calibrate ${eng.lastCalibrateMs} ms`
                  : ""}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
