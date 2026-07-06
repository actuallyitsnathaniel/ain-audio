// ── TIMELINE — the arrangement canvas (tracks × time, clips as blocks) ───────
// Models the PianoRoll canvas pattern: one useRafLoop render, beatToX/xToBeat time
// axis, but the vertical axis is a track index (not pitch). Clips are colored
// blocks placed at [beatToX(startBeat), trackY]; drag to move (snap, ⌘=free),
// drag the right edge to resize, ⌥-drag/⌘D to duplicate, double-click a MIDI clip
// to edit it below, right-click for the menu. The top ruler shows bars + the loop
// brace + playhead; click/drag the ruler to seek / set the loop.

import { useEffect, useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { engine } from "../../engine";
import { useRafLoop } from "../../hooks/useRafLoop";
import { openContextMenu } from "../context-menu-bus";
import { clipBeats } from "../../data/clips";
import { type ArrClip, type ArrTrack } from "../../data/arrangement";

const HEAD_H = 22; // ruler height
const ROW_H = 56; // track lane height
const KEY_W = 0; // no gutter (headers are a separate column)
const MIN_PPB = 4;
const MAX_PPB = 64;

const accent = () => getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#54adbd";
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const cmd = (e: { metaKey: boolean; ctrlKey: boolean }) => e.metaKey || e.ctrlKey;
const CLIP_COLOR: Record<string, string> = { midi: "#4a7fd4", drum: "#5aa0b8", audio: "#7a9a4a" };

type Drag =
  | { mode: "move"; trackId: string; clipId: string; grabBeat: number; base: number; moved: boolean; dup: boolean }
  | { mode: "resize"; trackId: string; clipId: string }
  | { mode: "seek" }
  | { mode: "brace"; anchor: number }
  | null;

export function Timeline({ height = 320, selectedClip, onSelectClip }: { height?: number; selectedClip: string | null; onSelectClip: (trackId: string | null, clipId: string | null) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drag = useRef<Drag>(null);
  const view = useRef({ scrollX: 0, ppb: 24 });

  const tracks = () => engine.arrangement.tracks;
  const beatToX = (b: number) => KEY_W + b * view.current.ppb - view.current.scrollX;
  const xToBeat = (x: number) => (x - KEY_W + view.current.scrollX) / view.current.ppb;
  const trackYOf = (i: number) => HEAD_H + i * ROW_H;
  const yToTrackIndex = (y: number) => Math.floor((y - HEAD_H) / ROW_H);
  // snap grid from the playback pane (engine.snapBeats; 0 or ⌘ = free)
  const snapBeat = (b: number, free: boolean) => {
    const g = engine.snapBeats;
    return free || g <= 0 ? b : Math.round(b / g) * g;
  };

  // hit-test a clip at (x,y): returns {track, clip, edge} or null
  const hitClip = (x: number, y: number): { t: ArrTrack; c: ArrClip; edge: boolean } | null => {
    const ti = yToTrackIndex(y);
    const t = tracks()[ti];
    if (!t) return null;
    const beat = xToBeat(x);
    for (let i = t.clips.length - 1; i >= 0; i--) {
      const c = t.clips[i];
      if (beat >= c.startBeat && beat <= c.startBeat + c.lengthBeats) {
        const edge = x >= beatToX(c.startBeat + c.lengthBeats) - 7;
        return { t, c, edge };
      }
    }
    return null;
  };

  const localXY = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const cv = ref.current!;
    cv.setPointerCapture(e.pointerId);
    const { x, y } = localXY(e);

    // ruler: click to seek, drag to set the loop brace (⌘/shift while dragging)
    if (y < HEAD_H) {
      const beat = Math.max(0, snapBeat(xToBeat(x), cmd(e)));
      if (e.shiftKey) {
        drag.current = { mode: "brace", anchor: beat };
      } else {
        engine.seekArrangement(beat);
        drag.current = { mode: "seek" };
      }
      return;
    }

    if (e.button === 2) return; // right-click handled by onContextMenu

    const hit = hitClip(x, y);
    if (hit) {
      onSelectClip(hit.t.id, hit.c.id);
      if (hit.edge) {
        drag.current = { mode: "resize", trackId: hit.t.id, clipId: hit.c.id };
      } else {
        drag.current = { mode: "move", trackId: hit.t.id, clipId: hit.c.id, grabBeat: xToBeat(x), base: hit.c.startBeat, moved: false, dup: e.altKey };
      }
      return;
    }

    // empty lane, bare click: place the insert marker + clear the clip selection.
    // (creation is an explicit act — double-click, per Ableton; a click never creates.)
    if (e.button === 0) {
      engine.setInsertBeat(Math.max(0, snapBeat(xToBeat(x), cmd(e))));
      onSelectClip(null, null);
    }
  };
  // create an (empty) clip on a track at a beat — the double-click gesture
  const createClipAt = (t: ArrTrack, beat: number) => {
    const bpb = engine.arrangement.beatsPerBar;
    const created = engine.addClip(t.id, {
      startBeat: Math.max(0, beat),
      lengthBeats: bpb,
      loop: false,
      content: t.kind === "midi" ? { kind: "midi", clip: { bars: 1, beatsPerBar: bpb, notes: [] } } : t.kind === "drum" ? { kind: "drum", pattern: emptyDrumPattern(bpb) } : { kind: "audio", loopId: "" },
    });
    if (created) onSelectClip(t.id, created.id);
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    if (!d) return;
    const { x } = localXY(e);
    const beat = Math.max(0, snapBeat(xToBeat(x), cmd(e)));
    if (d.mode === "seek") {
      engine.seekArrangement(beat);
    } else if (d.mode === "brace") {
      const s = Math.min(d.anchor, beat);
      const en = Math.max(d.anchor, beat);
      if (en > s) engine.setArrangementLoop(s, en, true);
    } else if (d.mode === "move") {
      if (!d.moved && d.dup) {
        // ⌥-drag: duplicate first, then drag the copy
        const copy = engine.duplicateClip(d.trackId, d.clipId);
        if (copy) {
          d.clipId = copy.id;
          d.base = copy.startBeat;
        }
        d.dup = false;
      }
      d.moved = true;
      const dBeat = beat - snapBeat(d.grabBeat, cmd(e));
      const ti = yToTrackIndex(localXY(e).y);
      const toTrack = tracks()[ti];
      engine.moveClip(d.trackId, d.clipId, d.base + dBeat, toTrack?.id);
      if (toTrack && toTrack.id !== d.trackId && toTrack.kind === tracks().find((t) => t.id === d.trackId)?.kind) d.trackId = toTrack.id;
    } else if (d.mode === "resize") {
      const c = tracks().find((t) => t.id === d.trackId)?.clips.find((x) => x.id === d.clipId);
      if (c) engine.resizeClip(d.trackId, d.clipId, Math.max(0.25, beat - c.startBeat));
    }
  };

  const onPointerUp = () => {
    drag.current = null;
  };

  const onDoubleClick = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const { x, y } = localXY(e);
    if (y < HEAD_H) {
      engine.setInsertBeat(0); // double-click the ruler → insert marker back to start
      return;
    }
    const hit = hitClip(x, y);
    if (hit) {
      onSelectClip(hit.t.id, hit.c.id); // opens the editor below
    } else {
      // double-click empty lane → CREATE a clip here (the create gesture)
      const t = tracks()[yToTrackIndex(y)];
      if (t) createClipAt(t, snapBeat(xToBeat(x), cmd(e)));
    }
  };

  const onContextMenu = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (e.shiftKey) return;
    e.preventDefault();
    const r = ref.current!.getBoundingClientRect();
    const hit = hitClip(e.clientX - r.left, e.clientY - r.top);
    if (!hit) return;
    openContextMenu({
      x: e.clientX,
      y: e.clientY,
      title: hit.c.content.kind + " clip",
      items: [
        { label: "duplicate", onClick: () => engine.duplicateClip(hit.t.id, hit.c.id) },
        { separator: true },
        { label: "delete clip", danger: true, onClick: () => engine.removeClip(hit.t.id, hit.c.id) },
      ],
    });
  };

  // drop an audio file onto an audio-track lane → create a clip there + import it.
  // preventDefault on dragover is REQUIRED or the browser navigates to the file.
  const onDragOver = (e: React.DragEvent<HTMLCanvasElement>) => {
    if (Array.from(e.dataTransfer.types).includes("Files")) e.preventDefault();
  };
  const onDrop = async (e: React.DragEvent<HTMLCanvasElement>) => {
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    e.preventDefault();
    const r = ref.current!.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    const beat = Math.max(0, snapBeat(xToBeat(x), cmd(e)));
    const res = await engine.importAudio(file);
    if (!res) return; // undecodable
    // clip length FOLLOWS THE SAMPLE: its actual duration in beats at the current tempo
    // (¼-beat granularity). Dragging the clip longer later auto-loops; shorter cuts.
    const secPerBeat = 60 / engine.arrangement.bpm;
    const lengthBeats = Math.max(0.25, Math.round((res.seconds / secPerBeat) * 4) / 4);
    const audioContent = {
      kind: "audio" as const,
      bufId: res.bufId,
      name: res.name,
      a: 0,
      b: 1,
      gain: 1,
      cents: 0,
      semi: 0,
      snap: true,
      rootBpm: res.bpm, // detected native tempo (drives grid-sync)
      bars: res.bars,
      key: res.key,
    };

    // over an existing AUDIO clip? → replace its content (keeps its position/length)
    const hit = y >= HEAD_H ? hitClip(x, y) : null;
    if (hit && hit.c.content.kind === "audio") {
      engine.setClipContent(hit.t.id, hit.c.id, { ...audioContent });
      onSelectClip(hit.t.id, hit.c.id);
      return;
    }
    // otherwise → a NEW audio track with the clip on it (the default gesture)
    const track = engine.addTrack("audio");
    const created = engine.addClip(track.id, { startBeat: beat, lengthBeats, loop: false, content: { ...audioContent } });
    if (created) onSelectClip(track.id, created.id);
  };

  // wheel: horizontal scroll; ⌘/ctrl = zoom around cursor
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = view.current;
      if (e.metaKey || e.ctrlKey) {
        const rect = cv.getBoundingClientRect();
        const cx = e.clientX - rect.left;
        const beatAt = xToBeat(cx);
        v.ppb = clamp(v.ppb * (e.deltaY < 0 ? 1.1 : 1 / 1.1), MIN_PPB, MAX_PPB);
        v.scrollX = Math.max(0, beatAt * v.ppb - (cx - KEY_W));
      } else {
        v.scrollX = Math.max(0, v.scrollX + (e.deltaX || e.deltaY));
      }
    };
    cv.addEventListener("wheel", onWheel, { passive: false });
    return () => cv.removeEventListener("wheel", onWheel);
  }, []);

  // ── render ──
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
    // follow-playhead: keep the playhead within a comfortable band by scrolling the view
    // (only while playing, following, and not mid-drag so it never fights a user scroll).
    if (engine.followPlayhead && engine.sequencePlaying && engine.arrangeMode && !drag.current) {
      const v = view.current;
      const px = KEY_W + engine.arrangementPosition() * v.ppb - v.scrollX;
      const lead = w * 0.15; // keep ~15% margin on the trailing edge
      if (px > w - lead || px < KEY_W) {
        // recenter so the playhead sits at the left-lead position
        v.scrollX = Math.max(0, engine.arrangementPosition() * v.ppb - lead);
      }
    }
    g.clearRect(0, 0, w, h);
    g.fillStyle = "#0c0c10";
    g.fillRect(0, 0, w, h);
    const ac = accent();
    const bpb = engine.arrangement.beatsPerBar;
    // Draw the grid across the VISIBLE viewport, not a fixed content length — the
    // timeline extends indefinitely. Only on-screen beats are iterated, so it's free.
    const firstBeat = Math.max(0, Math.floor(xToBeat(KEY_W)));
    const lastBeat = Math.ceil(xToBeat(w)) + 1;
    // label every beat only if there's room (~24px), else only bar downbeats
    const beatPx = view.current.ppb;
    const labelEveryBeat = beatPx >= 22;
    const showBeatLines = beatPx >= 12;

    // track lane backgrounds + separators
    tracks().forEach((_, i) => {
      const y = trackYOf(i);
      g.fillStyle = i % 2 === 0 ? "#101014" : "#0e0e12";
      g.fillRect(0, y, w, ROW_H);
      g.fillStyle = "rgba(255,255,255,0.05)";
      g.fillRect(0, y + ROW_H - 1, w, 1);
    });

    // gridlines across the visible range (labels drawn later, over the ruler bg)
    for (let b = firstBeat; b <= lastBeat; b++) {
      const x = beatToX(b);
      if (x < KEY_W - 1 || x > w) continue;
      const isBar = b % bpb === 0;
      if (!isBar && !showBeatLines) continue; // too zoomed out to show beat lines
      g.fillStyle = isBar ? "rgba(255,255,255,0.13)" : "rgba(255,255,255,0.045)";
      g.fillRect(x, HEAD_H, 1, h - HEAD_H);
    }

    // ruler bg + loop brace
    g.fillStyle = "#141418";
    g.fillRect(0, 0, w, HEAD_H);
    g.fillStyle = "rgba(255,255,255,0.08)";
    g.fillRect(0, HEAD_H - 1, w, 1);
    // bar.beat labels ON the ruler (1-based both) — bars always, beats when there's room
    g.font = "8px ui-monospace, monospace";
    for (let b = firstBeat; b <= lastBeat; b++) {
      const x = beatToX(b);
      if (x < KEY_W - 1 || x > w) continue;
      const isBar = b % bpb === 0;
      if (!isBar && !labelEveryBeat) continue;
      const bar = Math.floor(b / bpb) + 1;
      const beat = (b % bpb) + 1;
      g.fillStyle = isBar ? "#7a7a86" : "#4a4a52";
      g.fillText(`${bar}.${beat}`, x + 3, HEAD_H - 6);
    }
    const loop = engine.arrangement.loop;
    if (loop?.on) {
      const lx = beatToX(loop.start);
      const lw = (loop.end - loop.start) * view.current.ppb;
      g.fillStyle = "color-mix(in srgb, " + ac + " 30%, transparent)";
      g.fillRect(lx, 0, lw, HEAD_H - 2);
      g.strokeStyle = ac;
      g.lineWidth = 1;
      g.strokeRect(lx + 0.5, 0.5, lw, HEAD_H - 3);
    }

    // clips
    const selId = selectedClip;
    tracks().forEach((t, i) => {
      const y = trackYOf(i);
      const base = CLIP_COLOR[t.kind] || "#4a7fd4";
      t.clips.forEach((c) => {
        const x = beatToX(c.startBeat);
        const cw = Math.max(4, c.lengthBeats * view.current.ppb);
        if (x + cw < 0 || x > w) return;
        const selected = c.id === selId;
        g.fillStyle = c.color || base;
        g.globalAlpha = t.mute ? 0.35 : 0.9;
        g.beginPath();
        g.roundRect(x, y + 3, cw, ROW_H - 8, 3);
        g.fill();
        g.globalAlpha = 1;
        // mini content preview (MIDI notes)
        if (c.content.kind === "midi" && c.content.clip.notes.length) {
          const notes = c.content.clip.notes;
          let lo = 127, hi = 0;
          notes.forEach((n) => {
            lo = Math.min(lo, n.pitch);
            hi = Math.max(hi, n.pitch);
          });
          const span = Math.max(1, hi - lo);
          const clen = Math.max(0.25, clipBeats(c.content.clip));
          g.fillStyle = "rgba(255,255,255,0.55)";
          notes.forEach((n) => {
            const nx = x + (n.start / clen) * Math.min(cw, c.lengthBeats * view.current.ppb);
            const nw = Math.max(1, (n.length / clen) * cw);
            const ny = y + 6 + (1 - (n.pitch - lo) / span) * (ROW_H - 16);
            if (nx > x + cw) return;
            g.fillRect(nx, ny, Math.min(nw, x + cw - nx), 2);
          });
        }
        // name + selection outline
        g.fillStyle = "rgba(0,0,0,0.6)";
        g.font = "8px ui-monospace, monospace";
        g.fillText(c.name || t.name, x + 4, y + 13);
        if (selected) {
          g.strokeStyle = "#ffffff";
          g.lineWidth = 1.5;
          g.beginPath();
          g.roundRect(x + 0.75, y + 3.75, cw - 1.5, ROW_H - 9.5, 3);
          g.stroke();
        }
      });
    });

    // insert marker (the shared cursor — where paste / create / split reference)
    const ix = beatToX(engine.insertBeat);
    if (ix >= KEY_W && ix <= w) {
      g.strokeStyle = ac;
      g.globalAlpha = 0.85;
      g.setLineDash([2, 3]);
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(ix, HEAD_H);
      g.lineTo(ix, h);
      g.stroke();
      g.setLineDash([]);
      g.globalAlpha = 1;
    }

    // playhead
    const pos = engine.arrangementPosition();
    const px = beatToX(pos);
    if (px >= 0 && px <= w) {
      g.fillStyle = "#ffffff";
      g.globalAlpha = 0.9;
      g.fillRect(px, 0, 1.5, h);
      g.globalAlpha = 1;
    }

    // empty-state hint (no tracks → no lanes, so the bare grid looks broken)
    if (tracks().length === 0) {
      g.fillStyle = "#3a3a42";
      g.font = "11px ui-monospace, monospace";
      g.textAlign = "center";
      g.fillText("add a track, then double-click a lane to create a clip", w / 2, (HEAD_H + h) / 2);
      g.textAlign = "left";
    }
  });

  return (
    <canvas
      ref={ref}
      className="w-full touch-none rounded-[3px] border border-line bg-inset outline-none select-none"
      style={{ height }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      onDragOver={onDragOver}
      onDrop={onDrop}
    />
  );
}

// a blank drum pattern sized to one bar (reuses SequenceClip shape minimally)
function emptyDrumPattern(bpb: number) {
  return { steps: 16, beatsPerBar: bpb, kitId: engine.kit.id, bpm: engine.arrangement.bpm, swing: 0, on: {}, accent: {}, loops: {}, laneMix: {}, channels: [] };
}
