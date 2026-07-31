// ── STUDIO STATUS STRIP — master peek + I/O session readout under the toolbar

import { useRef } from "react";
import { engine } from "../../engine";
import { useEngine } from "../../hooks/useEngine";
import { useRafLoop } from "../../hooks/useRafLoop";
import { shortDeviceLabel } from "../../audio-capability";
import { dbToMeter, fmtDb, lin2db } from "../../db-fader";

const chip =
  "rounded-[3px] border border-line px-1.5 py-0.5 font-mono text-[9px] text-faint transition-colors hover:border-accent hover:text-dim";

export function StudioStatusStrip({
  onOpenIo,
}: {
  onOpenIo: () => void;
}) {
  const eng = useEngine(["transport", "fx", "arrange", "midi"]);
  const rmsRef = useRef<HTMLDivElement>(null);
  const peakRef = useRef<HTMLDivElement>(null);
  const dbRef = useRef<HTMLSpanElement>(null);

  useRafLoop(() => {
    const { rms, peak } = engine.masterLevel();
    if (rmsRef.current) rmsRef.current.style.width = dbToMeter(rms) * 100 + "%";
    if (peakRef.current)
      peakRef.current.style.left = dbToMeter(peak) * 100 + "%";
    if (dbRef.current) dbRef.current.textContent = fmtDb(lin2db(eng.masterVol));
  });

  const label = eng.selectedInputLabel();
  const short = label ? shortDeviceLabel(label, 22) : null;
  const report = eng.audioCapabilityReport();
  const status = eng.inputStatus;
  const statusTone =
    status === "live"
      ? "text-accent"
      : status === "denied"
        ? "text-[#e98c79]"
        : status === "pending"
          ? "text-dim"
          : "text-faint";

  const store =
    report.persistCodec === "opus"
      ? "Opus"
      : report.persistCodec === "wav"
        ? "WAV"
        : "…";

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-sm border border-line2 bg-[#0c0c10] px-2.5 py-1.5">
      {/* master peek */}
      <div className="flex min-w-0 flex-1 items-center gap-2 sm:max-w-[280px]">
        <span className="shrink-0 font-mono text-[9px] tracking-[0.08em] text-accent">
          master
        </span>
        <div
          className="relative h-2.5 min-w-16 flex-1 overflow-hidden rounded-[2px] border border-line bg-[#0a0a0e]"
          title="master bus level (same tap as the master strip)"
        >
          <div
            ref={rmsRef}
            className="absolute inset-y-0 left-0 w-0 bg-linear-to-r from-[color-mix(in_srgb,var(--accent)_40%,transparent)] to-accent"
          />
          <div
            ref={peakRef}
            className="absolute inset-y-0 w-px bg-white/70"
            style={{ left: 0 }}
          />
        </div>
        <span
          ref={dbRef}
          className="w-9 shrink-0 text-right font-mono text-[9px] tabular-nums text-dim"
        >
          −∞
        </span>
        <button
          type="button"
          className={chip}
          onClick={() => engine.setMasterMeterPost(!eng.masterMeterPost)}
          title="master meter tap — pre = before safety limiter · post = final output"
        >
          {eng.masterMeterPost ? "post" : "pre"}
        </button>
      </div>

      {/* I/O session status — click opens prefs */}
      <button
        type="button"
        data-audio-prefs-open
        onClick={onOpenIo}
        className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-left font-mono text-[9.5px] transition-colors hover:text-daw-text"
        title="open I/O preferences"
      >
        <span className={"tracking-[0.06em] " + statusTone}>
          I/O · {status === "idle" ? "idle" : status}
        </span>
        <span className="text-faint">·</span>
        <span className="truncate text-dim">
          {short || (status === "live" ? "Default in" : "no input")}
        </span>
        <span className="text-faint">·</span>
        <span className="text-dim">~{eng.effectiveLatencyMs()} ms</span>
        <span className="text-faint">·</span>
        <span className="text-dim">
          mon {eng.audioPrefs.inputMonitor ? "on" : "off"}
        </span>
        <span className="text-faint">·</span>
        <span className="text-dim">store {store}</span>
        <span className="text-faint">·</span>
        <span
          className={
            eng.midiStatus.indexOf("device") >= 0
              ? "text-accent"
              : eng.midiStatus === "denied"
                ? "text-[#e98c79]"
                : "text-dim"
          }
        >
          midi{" "}
          {eng.midiStatus === "idle"
            ? "off"
            : eng.midiStatus === "unsupported"
              ? "n/a"
              : eng.midiStatus}
        </span>
        {eng.armedChannel && (
          <>
            <span className="text-faint">·</span>
            <span className="text-[#e98c79]">
              armed{" "}
              {eng.arrangement.tracks.find((t) => t.id === eng.armedChannel)
                ?.name || "track"}
            </span>
          </>
        )}
      </button>
    </div>
  );
}
