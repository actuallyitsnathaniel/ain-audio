// ── AUDIO CLIP EDITOR — import a file, trim it, set its level ──────────────────
// Empty state: drop an audio file (or click to pick). Loaded: the imported waveform
// with draggable A/B trim handles + a gain knob. Import is session-only (engine holds
// the decoded buffer by bufId); the clip stores the bufId + name + a/b + gain.

import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { engine } from "../../engine";
import { useRafLoop } from "../../hooks/useRafLoop";
import { Knob } from "../Knob";
import {
  warpModeOf,
  type ClipContent,
  type WarpMode,
} from "../../data/arrangement";

type AudioContentT = Extract<ClipContent, { kind: "audio" }>;

export function AudioClipEditor({
  content,
  looping = false,
  onCommit,
}: {
  content: AudioContentT;
  looping?: boolean;
  onCommit: (c: AudioContentT) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const hasBuf = !!content.bufId && engine.hasImport(content.bufId);

  const doImport = async (file: File) => {
    setBusy(true);
    setErr(null);
    const res = await engine.importAudio(file);
    setBusy(false);
    if (!res) {
      setErr("couldn't decode that file — try wav / mp3 / m4a / ogg");
      return;
    }
    onCommit({
      ...content,
      bufId: res.bufId,
      name: res.name,
      a: 0,
      b: 1,
      gain: content.gain ?? 1,
    });
  };

  if (!hasBuf) {
    return (
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const f = e.dataTransfer.files?.[0];
          if (f) void doImport(f);
        }}
        onClick={() => fileRef.current?.click()}
        className="flex h-30 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-sm border border-dashed border-line2 bg-[#0c0c10] text-center transition-colors hover:border-accent"
      >
        <input
          ref={fileRef}
          type="file"
          accept="audio/*,.wav,.mp3,.m4a,.ogg,.flac,.aac"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void doImport(f);
            e.target.value = "";
          }}
        />
        <span className="font-mono text-[11px] tracking-[0.05em] text-dim">
          {busy ? "decoding…" : "⤓ drop an audio file, or click to pick"}
        </span>
        <span className="font-mono text-[9px] text-faint">
          wav · mp3 · m4a · ogg · flac — imported for this session
        </span>
        {err && (
          <span className="font-mono text-[9px] text-[#e98c79]">{err}</span>
        )}
      </div>
    );
  }

  const toggle =
    "rounded-[3px] border px-[7px] py-[3px] font-mono text-[9px] transition-colors";
  const on = (v: boolean) =>
    v ? "border-accent text-accent" : "border-line text-faint";
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2.5">
        <ClipWave content={content} onCommit={onCommit} />
        <Knob
          size={38}
          label="gain"
          value={content.gain ?? 1}
          min={0}
          max={2}
          defaultValue={1}
          onChange={(v) => onCommit({ ...content, gain: v })}
          fmt={(v) => (v <= 0 ? "-∞" : (20 * Math.log10(v)).toFixed(1) + "dB")}
        />
      </div>

      {/* sample controls: varispeed · tempo-sync · reverse · loop. Loop ON (default) =
          a clip dragged longer than the sample re-hashes to fill; OFF = play once,
          silence after. The loop-seam controls appear only when the clip is actually
          overflowing AND loop is on. */}
      <div className="flex flex-wrap items-end gap-x-3 gap-y-1.5">
        <Knob
          size={34}
          label="semi"
          value={content.semi ?? 0}
          min={-24}
          max={24}
          defaultValue={0}
          bipolar
          onChange={(v) => onCommit({ ...content, semi: Math.round(v) })}
          fmt={(v) => (Math.round(v) > 0 ? "+" : "") + Math.round(v)}
        />
        <Knob
          size={34}
          label="fine"
          value={content.cents ?? 0}
          min={-100}
          max={100}
          defaultValue={0}
          bipolar
          onChange={(v) => onCommit({ ...content, cents: Math.round(v) })}
          fmt={(v) => Math.round(v) + "c"}
        />
        {/* the warp-algorithm dropdown (Ableton-style). Writing warpMode clears the
            legacy sync/warp flags — warpModeOf keeps old saves working. */}
        <label
          className="flex items-center gap-1 self-end font-mono text-[9px] text-faint"
          title="warp algorithm: off = natural speed (time-true) · varispeed = tape varispeed to the grid (pitch follows tempo) · beats = transient slicer, punch preserved (drums) · complex = pitch-locked stretch (melodic/full mixes). beats + complex need the native bpm below for tempo-fit; transpose stays pitch-true in complex, per-slice in beats"
        >
          <select
            value={warpModeOf(content)}
            onChange={(e) =>
              onCommit({
                ...content,
                warpMode:
                  e.target.value === "off"
                    ? undefined
                    : (e.target.value as WarpMode),
                sync: undefined,
                warp: undefined,
              })
            }
            aria-label="warp mode"
            className={
              "cursor-pointer appearance-none rounded-[3px] border px-1.75 py-0.75 font-mono text-[9px] transition-colors focus:outline-none " +
              (warpModeOf(content) !== "off"
                ? "border-accent bg-panel2 text-accent"
                : "border-line bg-panel2 text-faint")
            }
          >
            <option value="off">warp: off</option>
            <option value="varispeed">warp: varispeed</option>
            <option value="beats">warp: beats</option>
            <option value="complex">warp: complex</option>
          </select>
        </label>
        <button
          className={toggle + " self-end " + on(!!content.reverse)}
          title="play the sample backwards"
          onClick={() => onCommit({ ...content, reverse: !content.reverse })}
        >
          rev {content.reverse ? "on" : "off"}
        </button>
        <button
          className={toggle + " self-end " + on(content.loop !== false)}
          title="auto-loop: a clip dragged longer than the sample re-hashes from the loop region to fill. off = the sample plays once and the rest is silence"
          onClick={() => onCommit({ ...content, loop: content.loop === false })}
        >
          loop {content.loop !== false ? "on" : "off"}
        </button>
        <button
          className={toggle + " self-end " + on(!!content.norm)}
          title="auto-normalize: scanned peak → makeup gain to ≈ −1 dBFS (your gain knob rides on top)"
          onClick={() => onCommit({ ...content, norm: !content.norm })}
        >
          norm {content.norm ? "on" : "off"}
        </button>
        {looping && (
          <span className="flex items-end gap-3 rounded-[3px] border border-line bg-[color-mix(in_srgb,var(--accent)_8%,transparent)] px-2 py-0.75">
            <span className="self-center font-mono text-[8.5px] tracking-[0.08em] text-accent uppercase">
              loop ↻
            </span>
            <button
              className={toggle + " self-end " + on(content.snap !== false)}
              title="snap loop points to zero-crossings (click-free seam)"
              onClick={() =>
                onCommit({ ...content, snap: content.snap === false })
              }
            >
              snap {content.snap !== false ? "on" : "off"}
            </button>
            <Knob
              size={34}
              label="xfade"
              value={content.xfade ?? 0}
              min={0}
              max={0.2}
              defaultValue={0}
              onChange={(v) => onCommit({ ...content, xfade: v })}
              fmt={(v) => (v <= 0 ? "off" : Math.round(v * 1000) + "ms")}
            />
          </span>
        )}
      </div>

      <div className="flex items-center gap-2 font-mono text-[9px] text-faint">
        <span className="truncate text-dim">♪ {content.name || "audio"}</span>
        <span>· {engine.importSeconds(content.bufId!).toFixed(2)}s</span>
        {content.key && <span className="text-accent">· {content.key}</span>}
        {/* native tempo (detected from filename, editable) — drives grid-sync */}
        <label
          className="flex items-center gap-0.75"
          title="the sample's native tempo — grid-sync matches the arrangement to this"
        >
          <span>· bpm</span>
          <input
            type="number"
            value={content.rootBpm ?? ""}
            placeholder="—"
            onChange={(e) =>
              onCommit({
                ...content,
                rootBpm: e.target.value
                  ? Math.min(
                      300,
                      Math.max(40, Math.round(Number(e.target.value))),
                    )
                  : undefined,
              })
            }
            className="w-10.5 rounded-xs border border-line2 bg-panel2 px-0.75 py-px text-center text-daw-text focus:border-accent focus:outline-none"
          />
        </label>
        <button
          onClick={() =>
            onCommit({ ...content, bufId: undefined, name: undefined })
          }
          className="ml-auto rounded-[3px] border border-line px-1.75 py-0.5 text-faint transition-colors hover:border-accent hover:text-accent"
        >
          replace
        </button>
      </div>
    </div>
  );
}

// the imported waveform + draggable A/B trim handles (dims the trimmed-out regions)
function ClipWave({
  content,
  onCommit,
  height = 60,
}: {
  content: AudioContentT;
  onCommit: (c: AudioContentT) => void;
  height?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drag = useRef<null | "a" | "b">(null);
  const live = useRef({ a: content.a ?? 0, b: content.b ?? 1 });
  useEffect(() => {
    live.current = { a: content.a ?? 0, b: content.b ?? 1 };
  }, [content.a, content.b]);

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
    const peaks = content.bufId
      ? engine.importPeaks(content.bufId, Math.max(32, Math.floor(w)))
      : null;
    if (!peaks) return;
    const { a, b } = live.current;

    g.fillStyle = "#5a6f78";
    const bw = w / peaks.length;
    for (let i = 0; i < peaks.length; i++) {
      const ph = Math.max(1, peaks[i] * (h - 4));
      g.fillRect(i * bw, mid - ph / 2, Math.max(1, bw - 0.5), ph);
    }
    // dim the trimmed-out regions
    g.fillStyle = "rgba(0,0,0,0.55)";
    g.fillRect(0, 0, a * w, h);
    g.fillRect(b * w, 0, (1 - b) * w, h);
    // A/B bars
    const bar = (x: number) => {
      g.strokeStyle = accent;
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, h);
      g.stroke();
    };
    bar(Math.max(1, a * w));
    bar(Math.min(w - 1, b * w));
  });

  const frac = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
  };
  const down = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const f = frac(e);
    const { a, b } = live.current;
    drag.current = Math.abs(f - a) <= Math.abs(f - b) ? "a" : "b";
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drag.current) return;
    const f = frac(e);
    const { a, b } = live.current;
    if (drag.current === "a")
      onCommit({ ...content, a: Math.min(f, b - 0.01) });
    else onCommit({ ...content, b: Math.max(f, a + 0.01) });
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
