// ── Audio capability / acceptance — browser-DAW honesty helpers ─────────────
// Probe + one-time acceptance (ain-audio-accept). No server telemetry.

export const AUDIO_ACCEPT_VERSION = 1;
const ACCEPT_KEY = "ain-audio-accept";
const TIP_MONITOR_KEY = "ain-audio-tip-monitor";

export type AudioAcceptRecord = { v: number; at: string };

export type AudioCapabilityReport = {
  browser: string;
  os: string;
  sampleRate: number | null;
  baseLatencyMs: number | null;
  outputLatencyMs: number | null;
  inputReportedLatencyMs: number;
  estimatedLatencyMs: number;
  effectiveLatencyMs: number;
  capturePath: "worklet" | "scriptProcessor" | "none";
  inputStatus: "idle" | "pending" | "live" | "denied" | "unsupported";
  workletSupported: boolean;
  bufferSize: number;
  inputChannels: string;
  inputDeviceId: string | null;
  /** Resolved enumerateDevices label for the chosen id (null if Default / unknown). */
  inputDeviceLabel: string | null;
  /** default = no explicit id · builtin = laptop mic · interface = likely external I/O */
  inputDeviceKind: "default" | "builtin" | "interface";
  inputMonitor: boolean;
  outputDeviceId: string | null;
  outputDeviceLabel: string | null;
  /** Whether AudioContext.setSinkId is available (Safari often missing). */
  sinkIdSupported: boolean;
  /** IndexedDB take/bounce persist: opus (WebM) when WebCodecs can encode, else wav. */
  persistCodec: "opus" | "wav" | "unknown";
  /** Rolling average rAF frame time (ms) — UI thread, not DSP callback load. */
  uiFrameAvgMs: number;
  /** Rough UI frame pressure vs 60fps (honest label: not audio CPU %). */
  uiFrameLoadPct: number;
  heapMb: number | null;
  recommendations: string[];
};

export type AudioNudgeId =
  | "denied"
  | "scriptProcessor"
  | "hitch"
  | "monitorTip"
  | "outputSink";

export type AudioNudge = {
  id: AudioNudgeId;
  message: string;
  dismissible: boolean;
};

export function loadAudioAccepted(): boolean {
  try {
    const raw = localStorage.getItem(ACCEPT_KEY);
    if (!raw) return false;
    const p = JSON.parse(raw) as Partial<AudioAcceptRecord>;
    return p.v === AUDIO_ACCEPT_VERSION;
  } catch {
    return false;
  }
}

export function saveAudioAccepted(): void {
  try {
    localStorage.setItem(
      ACCEPT_KEY,
      JSON.stringify({
        v: AUDIO_ACCEPT_VERSION,
        at: new Date().toISOString(),
      } satisfies AudioAcceptRecord),
    );
  } catch {
    /* fine */
  }
}

export function loadMonitorTipSeen(): boolean {
  try {
    return localStorage.getItem(TIP_MONITOR_KEY) === "1";
  } catch {
    return false;
  }
}

export function saveMonitorTipSeen(): void {
  try {
    localStorage.setItem(TIP_MONITOR_KEY, "1");
  } catch {
    /* fine */
  }
}

/** Short browser + OS labels from userAgent (good enough for System panel). */
export function parseBrowserEnv(ua = navigator.userAgent): {
  browser: string;
  os: string;
} {
  let os = "unknown OS";
  if (/Mac OS X|Macintosh/.test(ua)) os = "macOS";
  else if (/Windows/.test(ua)) os = "Windows";
  else if (/Android/.test(ua)) os = "Android";
  else if (/iPhone|iPad|iPod/.test(ua)) os = "iOS";
  else if (/Linux/.test(ua)) os = "Linux";

  let browser = "browser";
  if (/Edg\//.test(ua)) browser = "Edge";
  else if (/Chrome\//.test(ua) && !/Edg\//.test(ua)) browser = "Chrome";
  else if (/Firefox\//.test(ua)) browser = "Firefox";
  else if (/Safari\//.test(ua) && !/Chrome\//.test(ua)) browser = "Safari";

  return { browser, os };
}

const BUILTIN_INPUT_RE =
  /macbook|imac|built-?in|internal\s*mic|default|communications|microphone\s*\(/i;

/** Truncate long USB product strings for UI copy. */
export function shortDeviceLabel(label: string, max = 36): string {
  const t = label.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  return t.slice(0, max - 1) + "…";
}

export function classifyInputDevice(
  deviceId: string | null,
  label: string | null,
): AudioCapabilityReport["inputDeviceKind"] {
  if (!deviceId) return "default";
  if (!label || BUILTIN_INPUT_RE.test(label)) return "builtin";
  return "interface";
}

/** Resolve label for a stored deviceId from the current enumerateDevices list. */
export function resolveInputDeviceLabel(
  deviceId: string | null,
  devices: { deviceId: string; label: string }[],
): string | null {
  if (!deviceId) return null;
  const hit = devices.find((d) => d.deviceId === deviceId);
  const label = hit?.label?.trim();
  return label || null;
}

export function hardwareMonitorAdvice(
  kind: AudioCapabilityReport["inputDeviceKind"],
  label: string | null,
): string {
  if (kind === "interface" && label) {
    return `Use ${shortDeviceLabel(label)}’s hardware direct monitor while singing/playing in.`;
  }
  if (kind === "builtin") {
    return "You’re on a built-in mic — software monitor is all the browser can offer; an external interface with hardware direct monitor will feel tighter.";
  }
  return "Use your audio interface’s hardware direct monitor while singing/playing in.";
}

export function recommendationsFor(
  r: Omit<AudioCapabilityReport, "recommendations">,
): string[] {
  const out: string[] = [];
  if (r.capturePath === "scriptProcessor") {
    out.push(
      "Capture is on ScriptProcessor (main thread). Prefer fewer tracks/FX, or raise the buffer if you hear glitches.",
    );
  }
  if (r.effectiveLatencyMs > 40) {
    out.push(hardwareMonitorAdvice(r.inputDeviceKind, r.inputDeviceLabel));
  }
  if (r.inputStatus === "denied") {
    out.push(
      "Microphone permission is blocked. Allow mic for this site in the browser address bar (or I/O → allow mic to list devices), then re-arm the audio track.",
    );
  }
  if (
    r.inputStatus !== "denied" &&
    r.inputStatus !== "unsupported" &&
    !r.inputDeviceLabel &&
    r.inputDeviceId
  ) {
    out.push(
      "A saved input device id is set, but the browser hasn’t named devices yet — use I/O → allow mic to list devices.",
    );
  }
  if (r.inputStatus === "unsupported") {
    out.push(
      "This browser cannot open an audio input stream (getUserMedia missing).",
    );
  }
  if (r.browser === "Safari") {
    out.push(
      "Safari is stricter on worklets and input constraints — if arming fails or feels laggy, try Chrome for recording sessions.",
    );
    if (!r.sinkIdSupported) {
      out.push(
        "This browser has no AudioContext.setSinkId — output stays on the system default (Chrome/Edge can pick a device).",
      );
    }
  } else if (!r.sinkIdSupported) {
    out.push(
      "Output device selection is unavailable here — playback uses the browser/OS default sink.",
    );
  }
  if (r.persistCodec === "opus") {
    out.push(
      "Takes & bounces persist as Opus in WebM (IndexedDB) — much smaller than WAV.",
    );
  } else if (r.persistCodec === "wav") {
    out.push(
      "This browser can’t encode Opus for storage — takes fall back to float WAV in IndexedDB.",
    );
  }
  if (r.uiFrameAvgMs > 32) {
    out.push(
      "UI frame pacing is struggling (not the same as audio DSP load). Close other tabs or simplify the session if playback stutters.",
    );
  }
  if (!r.workletSupported && r.sampleRate != null) {
    out.push(
      "AudioWorklet is unavailable — capture will use a higher-latency fallback path.",
    );
  }
  if (r.bufferSize <= 256 && r.capturePath !== "none") {
    out.push(
      "Buffer 256 is aggressive. If you hear clicks, step up to 512/1024 in audio prefs.",
    );
  }
  if (r.inputDeviceKind === "interface" && r.inputDeviceLabel) {
    out.push(
      `Input is set to ${shortDeviceLabel(r.inputDeviceLabel)} — confirm channels (mono ← L is common for input 1).`,
    );
  }
  if (out.length === 0) {
    if (r.inputDeviceKind === "interface" && r.inputDeviceLabel) {
      out.push(
        `Looking good. For the tightest tracking feel, use ${shortDeviceLabel(r.inputDeviceLabel)}’s hardware direct monitor — software monitor stays best-effort.`,
      );
    } else {
      out.push(
        "This machine looks fine for browser recording. Still: hardware direct monitor on an audio interface beats software for zero-feel tracking.",
      );
    }
  }
  return out;
}

export function buildCapabilityReport(args: {
  prefs: {
    bufferSize: number;
    inputChannels: string;
    inputDeviceId: string | null;
    outputDeviceId: string | null;
    inputMonitor: boolean;
  };
  inputDevices: { deviceId: string; label: string }[];
  outputDevices: { deviceId: string; label: string }[];
  sinkIdSupported: boolean;
  persistCodec: "opus" | "wav" | "unknown";
  ctx: AudioContext | null;
  inputStatus: AudioCapabilityReport["inputStatus"];
  inputReportedLatencySec: number;
  captureUsesWorklet: boolean;
  hasCaptureNode: boolean;
  estimatedLatencyMs: number;
  effectiveLatencyMs: number;
  uiFrameAvgMs: number;
}): AudioCapabilityReport {
  const { browser, os } = parseBrowserEnv();
  const c = args.ctx;
  const base = c ? (c.baseLatency || 0) * 1000 : null;
  const outLat = c
    ? ((c as AudioContext & { outputLatency?: number }).outputLatency || 0) *
      1000
    : null;
  let heapMb: number | null = null;
  try {
    const m = (
      performance as unknown as { memory?: { usedJSHeapSize: number } }
    ).memory;
    if (m) heapMb = Math.round(m.usedJSHeapSize / 1048576);
  } catch {
    heapMb = null;
  }
  const uiFrameAvgMs = args.uiFrameAvgMs;
  const uiFrameLoadPct = Math.min(
    99,
    Math.max(1, Math.round((uiFrameAvgMs / 16.7) * 8)),
  );
  const capturePath: AudioCapabilityReport["capturePath"] = !args.hasCaptureNode
    ? "none"
    : args.captureUsesWorklet
      ? "worklet"
      : "scriptProcessor";
  const inputDeviceLabel = resolveInputDeviceLabel(
    args.prefs.inputDeviceId,
    args.inputDevices,
  );
  const inputDeviceKind = classifyInputDevice(
    args.prefs.inputDeviceId,
    inputDeviceLabel,
  );
  const outputDeviceLabel = resolveInputDeviceLabel(
    args.prefs.outputDeviceId,
    args.outputDevices,
  );
  const baseReport = {
    browser,
    os,
    sampleRate: c?.sampleRate ?? null,
    baseLatencyMs: base != null ? Math.round(base * 10) / 10 : null,
    outputLatencyMs: outLat != null ? Math.round(outLat * 10) / 10 : null,
    inputReportedLatencyMs: Math.round(args.inputReportedLatencySec * 1000),
    estimatedLatencyMs: args.estimatedLatencyMs,
    effectiveLatencyMs: args.effectiveLatencyMs,
    capturePath,
    inputStatus: args.inputStatus,
    workletSupported: !!(
      c?.audioWorklet || typeof AudioWorkletNode !== "undefined"
    ),
    bufferSize: args.prefs.bufferSize,
    inputChannels: args.prefs.inputChannels,
    inputDeviceId: args.prefs.inputDeviceId,
    inputDeviceLabel,
    inputDeviceKind,
    inputMonitor: args.prefs.inputMonitor,
    outputDeviceId: args.prefs.outputDeviceId,
    outputDeviceLabel,
    sinkIdSupported: args.sinkIdSupported,
    persistCodec: args.persistCodec,
    uiFrameAvgMs: Math.round(uiFrameAvgMs * 10) / 10,
    uiFrameLoadPct,
    heapMb,
  };
  return {
    ...baseReport,
    recommendations: recommendationsFor(baseReport),
  };
}
