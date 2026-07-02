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
import { arrangementBeats, type ArrClip, type ArrTrack } from "../../data/arrangement";

const HEAD_H = 22; // ruler height
const ROW_H = 56; // track lane height
const KEY_W = 0; // no gutter (headers are a separate column)
const MIN_PPB = 4;
const MAX_PPB = 64;
const SNAP = 1; // snap to the beat by default (⌘ = free)

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

export function Timeline({ height = 320, selectedClip, onSelectClip }: { height?: number; selectedClip: string | null; onSelectClip: (trackId: string, clipId: string) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drag = useRef<Drag>(null);
  const view = useRef({ scrollX: 0, ppb: 16 });

  const tracks = () => engine.arrangement.tracks;
  const beatToX = (b: number) => KEY_W + b * view.current.ppb - view.current.scrollX;
  const xToBeat = (x: number) => (x - KEY_W + view.current.scrollX) / view.current.ppb;
  const trackYOf = (i: number) => HEAD_H + i * ROW_H;
  const yToTrackIndex = (y: number) => Math.floor((y - HEAD_H) / ROW_H);
  const snapBeat = (b: number, free: boolean) => (free ? b : Math.round(b / SNAP) * SNAP);
  const totalBeats = () => Math.max(arrangementBeats(engine.arrangement), 16);

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

    // empty lane: place a new clip here (1 bar) on that track
    const ti = yToTrackIndex(y);
    const t = tracks()[ti];
    if (t && e.button === 0) {
      const beat = Math.max(0, snapBeat(xToBeat(x), cmd(e)));
      const bpb = engine.arrangement.beatsPerBar;
      const created = engine.addClip(t.id, {
        startBeat: beat,
        lengthBeats: bpb,
        loop: false,
        content: t.kind === "midi" ? { kind: "midi", clip: { bars: 1, beatsPerBar: bpb, notes: [] } } : t.kind === "drum" ? { kind: "drum", pattern: emptyDrumPattern(bpb) } : { kind: "audio", loopId: "" },
      });
      if (created) onSelectClip(t.id, created.id);
    }
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
    if (y < HEAD_H) return;
    const hit = hitClip(x, y);
    if (hit) onSelectClip(hit.t.id, hit.c.id); // the bottom editor opens it
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
        { label: hit.c.loop ? "loop off" : "loop on", onClick: () => engine.toggleClipLoop(hit.t.id, hit.c.id) },
        { separator: true },
        { label: "delete clip", danger: true, onClick: () => engine.removeClip(hit.t.id, hit.c.id) },
      ],
    });
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
    g.clearRect(0, 0, w, h);
    g.fillStyle = "#0c0c10";
    g.fillRect(0, 0, w, h);
    const ac = accent();
    const bpb = engine.arrangement.beatsPerBar;
    const tb = totalBeats();

    // track lane backgrounds + separators
    tracks().forEach((_, i) => {
      const y = trackYOf(i);
      g.fillStyle = i % 2 === 0 ? "#101014" : "#0e0e12";
      g.fillRect(0, y, w, ROW_H);
      g.fillStyle = "rgba(255,255,255,0.05)";
      g.fillRect(0, y + ROW_H - 1, w, 1);
    });

    // bar gridlines
    for (let b = 0; b <= tb; b += bpb) {
      const x = beatToX(b);
      if (x < -1 || x > w) continue;
      g.fillStyle = "rgba(255,255,255,0.12)";
      g.fillRect(x, HEAD_H, 1, h - HEAD_H);
      g.fillStyle = "#4a4a52";
      g.font = "8px ui-monospace, monospace";
      g.fillText(String(b / bpb + 1), x + 3, HEAD_H - 6);
    }
    // beat sub-lines when zoomed in
    if (view.current.ppb >= 24) {
      for (let b = 0; b <= tb; b++) {
        if (b % bpb === 0) continue;
        const x = beatToX(b);
        if (x < 0 || x > w) continue;
        g.fillStyle = "rgba(255,255,255,0.04)";
        g.fillRect(x, HEAD_H, 1, h - HEAD_H);
      }
    }

    // ruler bg + loop brace
    g.fillStyle = "#141418";
    g.fillRect(0, 0, w, HEAD_H);
    g.fillStyle = "rgba(255,255,255,0.08)";
    g.fillRect(0, HEAD_H - 1, w, 1);
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
      g.fillText("add a track, then click here to place a clip", w / 2, (HEAD_H + h) / 2);
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
    />
  );
}

// a blank drum pattern sized to one bar (reuses SequenceClip shape minimally)
function emptyDrumPattern(bpb: number) {
  return { steps: 16, beatsPerBar: bpb, bpm: engine.arrangement.bpm, swing: 0, on: {}, accent: {}, loops: {}, laneMix: {}, channels: [] };
}
