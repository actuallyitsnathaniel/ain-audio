// ── TIMELINE — the arrangement canvas (tracks × time, clips as blocks) ───────
// Models the PianoRoll canvas pattern: one useRafLoop render, beatToX/xToBeat time
// axis, but the vertical axis is a track index (not pitch). Clips are colored
// blocks placed at [beatToX(startBeat), trackY]; drag to move (snap, ⌘=free),
// drag the right edge to resize, ⌥-drag/⌘D to duplicate, double-click a MIDI clip
// to edit it below, right-click for the menu. The top ruler shows bars + the loop
// brace + playhead; click/drag the ruler to seek / set the loop.

import { useEffect, useRef } from "react";
import type { MutableRefObject, PointerEvent as ReactPointerEvent } from "react";
import { engine } from "../../engine";
import { useRafLoop } from "../../hooks/useRafLoop";
import { openContextMenu } from "../context-menu-bus";
import { clipBeats } from "../../data/clips";
import { DRUM_BASE } from "../../data/drum-midi";
import { type ArrClip, type ArrTrack } from "../../data/arrangement";

const HEAD_H = 22; // ruler height
const ROW_H = 64; // track lane height (must match ArrangementPage ROW_H)
const KEY_W = 0; // no gutter (headers are a separate column)
const MIN_PPB = 4;
const MAX_PPB = 64;

const accent = () => getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#54adbd";
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const cmd = (e: { metaKey: boolean; ctrlKey: boolean }) => e.metaKey || e.ctrlKey;
const CLIP_COLOR: Record<string, string> = { midi: "#4a7fd4", drum: "#5aa0b8", audio: "#7a9a4a" };

type Drag =
  // `multi` (set when the grabbed clip is part of a multi-selection) carries every
  // selected clip's gesture-start position → the whole selection drags as one unit
  | { mode: "move"; trackId: string; clipId: string; grabBeat: number; base: number; moved: boolean; dup: boolean; multi?: { trackId: string; clipId: string; base: number }[] }
  | { mode: "resize"; trackId: string; clipId: string; moved?: boolean }
  | { mode: "seek"; last: number }
  | { mode: "brace"; anchor: number }
  // drag over empty lane space: paint a time selection + marquee-select intersecting clips
  | { mode: "marquee"; x0: number; y0: number; anchorBeat: number; anchorTrack: number; moved: boolean }
  | null;

export function Timeline({
  height = 320,
  onEditClip,
  zoomApiRef,
}: {
  height?: number;
  onEditClip: (trackId: string, clipId: string) => void;
  // filled by Timeline for the page's keyboard authority (+/− zoom lives up there)
  zoomApiRef?: MutableRefObject<{ zoom: (factor: number) => void } | null>;
}) {
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
  // scrub quantum: the snap grid, falling back to whole beats when snap is off —
  // ruler scrubbing always lands on a gridline
  const scrubQuantize = (b: number) => {
    const q = engine.snapBeats || 1;
    return Math.round(b / q) * q;
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

    // ruler: click to seek, drag to set the loop brace (⌘/shift while dragging).
    // Scrubbing QUANTIZES to the grid (snap, or whole beats when snap is off) — a
    // seek re-anchors the clock + restarts sources, so it fires only when the target
    // crosses onto a NEW gridline, never continuously with the mouse. ⌘ = free.
    if (y < HEAD_H) {
      const beat = Math.max(0, cmd(e) ? xToBeat(x) : scrubQuantize(xToBeat(x)));
      if (e.shiftKey) {
        drag.current = { mode: "brace", anchor: beat };
      } else {
        engine.seekArrangement(beat);
        drag.current = { mode: "seek", last: beat };
      }
      return;
    }

    if (e.button === 2) return; // right-click handled by onContextMenu

    const hit = hitClip(x, y);
    if (hit) {
      // shift+click toggles in the multi-selection; a bare click selects just this clip
      if (e.shiftKey) engine.toggleClipInSel(hit.c.id);
      else if (!engine.isClipSelected(hit.c.id)) engine.selectClip(hit.c.id);
      if (hit.edge) {
        drag.current = { mode: "resize", trackId: hit.t.id, clipId: hit.c.id };
      } else {
        // grabbed a clip inside a multi-selection → snapshot every selected clip's
        // position so the move handler drags them as one unit
        const multi =
          engine.isClipSelected(hit.c.id) && engine.selClips.size > 1
            ? tracks().flatMap((t) => t.clips.filter((c) => engine.isClipSelected(c.id)).map((c) => ({ trackId: t.id, clipId: c.id, base: c.startBeat })))
            : undefined;
        drag.current = { mode: "move", trackId: hit.t.id, clipId: hit.c.id, grabBeat: xToBeat(x), base: hit.c.startBeat, moved: false, dup: e.altKey, multi };
      }
      return;
    }

    // empty lane: start a marquee (drag → paint a time selection + select intersecting
    // clips). A bare click that doesn't move ends up placing the insert marker (in up).
    if (e.button === 0) {
      drag.current = { mode: "marquee", x0: x, y0: y, anchorBeat: xToBeat(x), anchorTrack: yToTrackIndex(y), moved: false };
    }
  };
  // create an (empty) clip on a track at a beat — the double-click gesture
  const createClipAt = (t: ArrTrack, beat: number) => {
    engine.pushUndo();
    const bpb = engine.arrangement.beatsPerBar;
    const created = engine.addClip(t.id, {
      startBeat: Math.max(0, beat),
      lengthBeats: bpb,
      loop: false,
      content: t.kind === "midi" ? { kind: "midi", clip: { bars: 1, beatsPerBar: bpb, notes: [] } } : t.kind === "drum" ? { kind: "drum", pattern: emptyDrumPattern(bpb) } : { kind: "audio", loopId: "" },
    });
    if (created) engine.selectClip(created.id);
  };

  // ── cursor feedback: the pointer always shows the gesture it would perform ──
  const setCursor = (c: string) => {
    const cv = ref.current;
    if (cv && cv.style.cursor !== c) cv.style.cursor = c;
  };
  const hoverCursor = (x: number, y: number): string => {
    if (y < HEAD_H) return "pointer"; // ruler: seek (shift = loop brace)
    const hit = hitClip(x, y);
    if (hit) return hit.edge ? "ew-resize" : "grab";
    return yToTrackIndex(y) < tracks().length ? "crosshair" : "default"; // lane: marquee/insert
  };
  const DRAG_CURSOR: Record<string, string> = { move: "grabbing", resize: "ew-resize", marquee: "crosshair", seek: "pointer", brace: "col-resize" };

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    if (!d) {
      const p = localXY(e);
      setCursor(hoverCursor(p.x, p.y));
      return;
    }
    setCursor(DRAG_CURSOR[d.mode] || "default");
    const { x } = localXY(e);
    const beat = Math.max(0, snapBeat(xToBeat(x), cmd(e)));
    if (d.mode === "seek") {
      const target = Math.max(0, cmd(e) ? xToBeat(x) : scrubQuantize(xToBeat(x)));
      if (Math.abs(target - d.last) > 1e-9) {
        engine.seekArrangement(target);
        d.last = target;
      }
    } else if (d.mode === "brace") {
      const s = Math.min(d.anchor, beat);
      const en = Math.max(d.anchor, beat);
      if (en > s) engine.setArrangementLoop(s, en, true);
    } else if (d.mode === "move") {
      if (!d.moved) engine.pushUndo(); // snapshot ONCE at the start of the drag
      if (!d.moved && d.dup) {
        // ⌥-drag: duplicate first, then drag the copy (single-clip — a dup breaks multi)
        const copy = engine.duplicateClip(d.trackId, d.clipId);
        if (copy) {
          d.clipId = copy.id;
          d.base = copy.startBeat;
          d.multi = undefined;
        }
        d.dup = false;
      }
      d.moved = true;
      const dBeat = beat - snapBeat(d.grabBeat, cmd(e));
      if (d.multi) {
        // multi-selection: drag every selected clip by the same delta (beat-move only;
        // uniform delta keeps the selection's layout → no mutual trimming)
        engine.dragSelectionTo(d.multi, dBeat);
      } else {
        const ti = yToTrackIndex(localXY(e).y);
        const toTrack = tracks()[ti];
        engine.moveClip(d.trackId, d.clipId, d.base + dBeat, toTrack?.id);
        if (toTrack && toTrack.id !== d.trackId && toTrack.kind === tracks().find((t) => t.id === d.trackId)?.kind) d.trackId = toTrack.id;
      }
    } else if (d.mode === "resize") {
      if (!d.moved) { engine.pushUndo(); d.moved = true; } // snapshot once
      const c = tracks().find((t) => t.id === d.trackId)?.clips.find((x) => x.id === d.clipId);
      if (c) {
        let len = Math.max(0.25, beat - c.startBeat);
        // ⌥+edge-drag = STRETCH the content to the new length (all clip kinds):
        // MIDI/drum notes scale; audio gets a stretch factor (pitch-preserved when
        // warped beats/complex, tape-style otherwise). No content-end magnet — the
        // content end IS the thing being moved.
        if (e.altKey) {
          engine.stretchClipTo(d.trackId, d.clipId, len);
          return;
        }
        // magnetic CONTENT END for audio: when the (snapped) edge lands near where the
        // sample actually ends, snap exactly there — "reveal through to the end" never
        // overshoots into a loop sliver / silence by one grid line.
        if (c.content.kind === "audio") {
          const wv = engine.audioClipWave(c);
          if (wv) {
            const endB = (wv.endSec - wv.startSec) / wv.rate / wv.secPerBeat;
            const tol = Math.max((engine.snapBeats || 0.25) / 2, 6 / view.current.ppb);
            if (Math.abs(len - endB) < tol) len = endB;
          }
        }
        engine.resizeClip(d.trackId, d.clipId, len);
      }
    } else if (d.mode === "marquee") {
      const { y } = localXY(e);
      if (!d.moved && Math.abs(x - d.x0) < 3 && Math.abs(y - d.y0) < 3) return; // slop
      d.moved = true;
      // time range (snapped) + track span from the drag box
      const b0 = snapBeat(d.anchorBeat, cmd(e));
      const b1 = snapBeat(xToBeat(x), cmd(e));
      const t0 = Math.min(d.anchorTrack, yToTrackIndex(y));
      const t1 = Math.max(d.anchorTrack, yToTrackIndex(y));
      const spanTracks = tracks().slice(Math.max(0, t0), t1 + 1);
      engine.setTimeSel(Math.min(b0, b1), Math.max(b0, b1), spanTracks.map((t) => t.id));
      // select every clip intersecting the box
      const lo = Math.min(b0, b1), hi = Math.max(b0, b1);
      const ids: string[] = [];
      for (const t of spanTracks) for (const c of t.clips) {
        if (c.startBeat < hi && c.startBeat + c.lengthBeats > lo) ids.push(c.id);
      }
      engine.setSelectedClips(ids);
    }
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    // a marquee that never moved = a bare click → insert marker + clear selection
    if (d?.mode === "marquee" && !d.moved) {
      const { x } = localXY(e);
      engine.setInsertBeat(Math.max(0, snapBeat(xToBeat(x), cmd(e))));
      engine.clearSelection();
    }
    drag.current = null;
    const p = localXY(e);
    setCursor(hoverCursor(p.x, p.y)); // back to the hover state under the pointer
  };

  const onDoubleClick = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const { x, y } = localXY(e);
    if (y < HEAD_H) {
      engine.setInsertBeat(0); // double-click the ruler → insert marker back to start
      return;
    }
    const hit = hitClip(x, y);
    if (hit) {
      engine.selectClip(hit.c.id);
      onEditClip(hit.t.id, hit.c.id); // opens the editor below
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
    const cx = e.clientX - r.left;
    const beat = snapBeat(xToBeat(cx), cmd(e));
    engine.setInsertBeat(Math.max(0, beat)); // where "split here" cuts / paste lands
    const hit = hitClip(cx, e.clientY - r.top);
    if (!hit) {
      // empty space menu — paste here / select all
      openContextMenu({
        x: e.clientX,
        y: e.clientY,
        title: "arrangement",
        items: [
          { label: "paste here", hint: "⌘V", disabled: !engine.hasClipboard(), onClick: () => engine.pasteClipboard() },
          { label: "insert silence", hint: "⌘I", onClick: () => engine.insertSilence() },
          { separator: true },
          { label: "select all", hint: "⌘A", onClick: () => engine.selectAllClips() },
        ],
      });
      return;
    }
    if (!engine.isClipSelected(hit.c.id)) engine.selectClip(hit.c.id);
    const multi = engine.selClips.size > 1;
    openContextMenu({
      x: e.clientX,
      y: e.clientY,
      title: multi ? engine.selClips.size + " clips" : hit.c.content.kind + " clip",
      items: [
        { label: "split here", hint: "⌘E", onClick: () => engine.splitAtInsert() },
        ...(multi ? [{ label: "consolidate", hint: "⌘J", onClick: () => void engine.consolidateSelection() }] : []),
        { label: "duplicate", hint: "⌘D", onClick: () => (multi ? engine.duplicateSelectedClips() : engine.duplicateClip(hit.t.id, hit.c.id)) },
        { label: hit.c.muted ? "unmute" : "mute", hint: "0", onClick: () => engine.toggleMuteSelection() },
        { separator: true },
        { label: multi ? "delete clips" : "delete clip", danger: true, hint: "⌫", onClick: () => (multi ? engine.deleteSelectedClips() : engine.removeClip(hit.t.id, hit.c.id)) },
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
      norm: true, // new imports auto-normalize (deferral #7)
      rootBpm: res.bpm, // detected native tempo (drives grid-sync / warp)
      bars: res.bars,
      key: res.key,
    };

    engine.pushUndo();
    // empty space in an AUDIO track's lane → place the clip THERE. A drop ON an
    // existing clip never replaces it — that space is taken, so the file gets a NEW
    // track (as does a drop on a midi/drum row or below the tracks).
    const hit = y >= HEAD_H ? hitClip(x, y) : null;
    const rowTrack = y >= HEAD_H ? tracks()[yToTrackIndex(y)] : undefined;
    const track = !hit && rowTrack?.kind === "audio" ? rowTrack : engine.addTrack("audio");
    const created = engine.addClip(track.id, { startBeat: beat, lengthBeats, loop: false, content: { ...audioContent } });
    if (created) { engine.selectClip(created.id); onEditClip(track.id, created.id); }
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

  // keyboard zoom (+/−, routed from the page's key handler): same math as ⌘+wheel,
  // anchored at the viewport center so the view zooms in place
  useEffect(() => {
    if (!zoomApiRef) return;
    zoomApiRef.current = {
      zoom: (factor: number) => {
        const cv = ref.current;
        if (!cv) return;
        const v = view.current;
        const cx = cv.getBoundingClientRect().width / 2;
        const beatAt = xToBeat(cx);
        v.ppb = clamp(v.ppb * factor, MIN_PPB, MAX_PPB);
        v.scrollX = Math.max(0, beatAt * v.ppb - (cx - KEY_W));
      },
    };
    return () => {
      zoomApiRef.current = null;
    };
  }, [zoomApiRef]);

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

    // gridlines across the visible range (labels drawn later, over the ruler bg).
    // Hierarchy: bars (strong) → beats (medium) → SNAP subdivisions (faint) — the
    // sub-beat lines appear/disappear with the snap setting (⌘1/⌘2), like Ableton's
    // grid, and only when they have ≥6px of room.
    const snap = engine.snapBeats;
    for (let b = firstBeat; b <= lastBeat; b++) {
      const x = beatToX(b);
      if (x < KEY_W - 1 || x > w) continue;
      const isBar = b % bpb === 0;
      if (!isBar && !showBeatLines) continue; // too zoomed out to show beat lines
      if (!isBar && snap >= bpb) continue; // bar-snap: no beat lines between bars
      g.fillStyle = isBar ? "rgba(255,255,255,0.13)" : "rgba(255,255,255,0.045)";
      g.fillRect(x, HEAD_H, 1, h - HEAD_H);
    }
    if (snap > 0 && snap < 1 && snap * beatPx >= 6) {
      g.fillStyle = "rgba(255,255,255,0.022)";
      for (let b = firstBeat; b < lastBeat; b += snap) {
        if (Math.abs(b - Math.round(b)) < 1e-6) continue; // integer beats already drawn
        const x = beatToX(b);
        if (x < KEY_W - 1 || x > w) continue;
        g.fillRect(x, HEAD_H, 1, h - HEAD_H);
      }
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

    // time selection band (the marquee / drag-select highlight over its track span)
    const ts = engine.timeSel;
    if (ts) {
      const tx = beatToX(ts.start);
      const tw = (ts.end - ts.start) * view.current.ppb;
      g.fillStyle = "color-mix(in srgb, " + ac + " 12%, transparent)";
      for (let i = 0; i < tracks().length; i++) {
        if (!ts.trackIds.includes(tracks()[i].id)) continue;
        g.fillRect(tx, trackYOf(i), tw, ROW_H);
      }
      // range edges in the ruler
      g.strokeStyle = "color-mix(in srgb, " + ac + " 60%, transparent)";
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(tx + 0.5, HEAD_H); g.lineTo(tx + 0.5, h);
      g.moveTo(tx + tw + 0.5, HEAD_H); g.lineTo(tx + tw + 0.5, h);
      g.stroke();
    }

    // clips
    tracks().forEach((t, i) => {
      const y = trackYOf(i);
      const base = CLIP_COLOR[t.kind] || "#4a7fd4";
      t.clips.forEach((c) => {
        const x = beatToX(c.startBeat);
        const cw = Math.max(4, c.lengthBeats * view.current.ppb);
        if (x + cw < 0 || x > w) return;
        const selected = engine.isClipSelected(c.id);
        const dim = t.mute || !!c.muted; // muted clip = deactivated (drawn dim, silent)
        g.fillStyle = c.color || base;
        g.globalAlpha = dim ? 0.35 : 0.9;
        g.beginPath();
        g.roundRect(x, y + 3, cw, ROW_H - 8, 3);
        g.fill();
        g.globalAlpha = dim ? 0.45 : 1;
        // audio waveform, drawn in PLAYBACK TRUTH: each pixel maps its timeline beat →
        // buffer seconds through the same geometry the scheduler uses (rate, trim,
        // auto-loop wrap, cut at content end). Unsynced clips stretch/squeeze across
        // beats as the tempo changes — the picture is always what plays there.
        // does the content LOOP/TILE to fill the clip? (drives the end-corner marker)
        let tiles = false;
        if (c.content.kind === "midi") tiles = c.content.clip.notes.length > 0 && c.lengthBeats > clipBeats(c.content.clip) + 1e-6;
        else if (c.content.kind === "drum") tiles = c.lengthBeats > c.content.pattern.steps * 0.25 + 1e-6; // step = 1/16
        if (c.content.kind === "audio") {
          const wv = engine.audioClipWave(c);
          if (wv) {
            tiles = wv.looping;
            const gain = Math.min(1.5, wv.gain); // effective gain (incl. auto-normalize)
            const midY = y + 3 + (ROW_H - 8) / 2;
            const half = (ROW_H - 8) / 2 - 4;
            const n = wv.peaks.length;
            const loopLen = wv.loopEndSec - wv.loopStartSec;
            // ── content boundaries (clip-beats): every loop-wrap seam, or the one-shot
            // content end. The wave TAPERS into each one so a repeat reads before the
            // seam line does. linear beats of a buffer position = (sec−start)/rate/spb.
            const contentBeat = (sec: number) => (sec - wv.startSec) / wv.rate / wv.secPerBeat;
            const boundaries: number[] = [];
            let oneShotEnd: number | null = null;
            if (wv.looping) {
              const period = loopLen / wv.rate / wv.secPerBeat;
              if (period > 0.05) for (let b = contentBeat(wv.loopEndSec); b < c.lengthBeats - 1e-6; b += period) boundaries.push(b);
            } else {
              const e = contentBeat(wv.endSec);
              if (e < c.lengthBeats - 1e-6) { oneShotEnd = e; boundaries.push(e); }
            }
            const bpx = boundaries.map((b) => beatToX(c.startBeat + b));
            const TAPER_PX = 12;
            let bi = 0;
            g.globalAlpha = dim ? 0.35 : 1;
            g.fillStyle = "rgba(255,255,255,0.5)";
            const px0 = Math.max(Math.ceil(x), KEY_W);
            const px1 = Math.min(x + cw, w);
            for (let px = px0; px < px1; px++) {
              const clipBeat = xToBeat(px) - c.startBeat;
              if (clipBeat < 0) continue;
              let pos = wv.startSec + clipBeat * wv.secPerBeat * wv.rate;
              if (wv.looping) {
                if (pos > wv.loopEndSec && loopLen > 0) pos = wv.loopStartSec + ((pos - wv.loopStartSec) % loopLen);
              } else if (pos >= wv.endSec) {
                continue; // content over — silence to the clip's end
              }
              while (bi < bpx.length && bpx[bi] < px) bi++;
              const taper = bi < bpx.length && bpx[bi] - px < TAPER_PX ? (bpx[bi] - px) / TAPER_PX : 1;
              const pk = (wv.peaks[Math.min(n - 1, Math.floor((pos / wv.durSec) * n))] || 0) * gain;
              const hh = Math.max(0.5, Math.min(1, pk) * half * taper);
              g.fillRect(px, midY - hh, 1, hh * 2);
            }
            // seam lines: dark separator at each loop wrap; bright caps at content start
            // + the true sample end (one-shot) — "the sample lives between the caps"
            g.fillStyle = "rgba(0,0,0,0.45)";
            for (const sx of bpx) {
              if (sx > x + 1 && sx < x + cw - 1) g.fillRect(sx, y + 3, 1, ROW_H - 8);
            }
            g.fillStyle = "rgba(255,255,255,0.65)";
            if (x >= KEY_W) g.fillRect(x + 1, y + 4, 1.5, ROW_H - 10);
            if (oneShotEnd != null) {
              const ex = beatToX(c.startBeat + oneShotEnd);
              if (ex > x + 2 && ex < x + cw - 1) g.fillRect(ex - 0.5, y + 4, 1.5, ROW_H - 10);
            }
            g.globalAlpha = dim ? 0.45 : 1; // back to the clip's preview alpha
          }
        }
        // mini content preview (MIDI notes) — drawn at TRUE beat scale and TILED like
        // playback (content repeats at its own length); never stretched to the block
        if (c.content.kind === "midi" && c.content.clip.notes.length) {
          const notes = c.content.clip.notes;
          let lo = 127, hi = 0;
          notes.forEach((n) => {
            lo = Math.min(lo, n.pitch);
            hi = Math.max(hi, n.pitch);
          });
          const span = Math.max(1, hi - lo);
          const clen = Math.max(0.25, clipBeats(c.content.clip));
          const reps = Math.min(64, Math.max(1, Math.ceil(c.lengthBeats / clen)));
          g.fillStyle = "rgba(255,255,255,0.55)";
          for (let r = 0; r < reps; r++) {
            const off = r * clen;
            notes.forEach((n) => {
              const sb2 = off + n.start;
              if (sb2 >= c.lengthBeats) return;
              const nx = x + (sb2 / c.lengthBeats) * cw;
              const nw = Math.max(1, (n.length / c.lengthBeats) * cw);
              const ny = y + 6 + (1 - (n.pitch - lo) / span) * (ROW_H - 16);
              if (nx > x + cw) return;
              g.fillRect(nx, ny, Math.min(nw, x + cw - nx), 2);
            });
          }
        }
        // end-corner marker (Ableton-style): ◥ = the clip simply ends here;
        // ◥◥ doubled = the content loops/tiles to fill the clip
        if (cw > 18) {
          const tri = (tx: number) => {
            g.beginPath();
            g.moveTo(tx, y + 4);
            g.lineTo(tx - 6, y + 4);
            g.lineTo(tx, y + 10);
            g.closePath();
            g.fill();
          };
          g.fillStyle = "rgba(255,255,255,0.8)";
          tri(x + cw - 2);
          if (tiles) tri(x + cw - 9);
        }
        // mini content preview (DRUM hits) — the piano-roll notes are the lossless
        // truth (lane = pitch − DRUM_BASE); a notes-less clip falls back to the grid
        if (c.content.kind === "drum") {
          const pat = c.content.pattern;
          const clen = Math.max(0.25, pat.steps * 0.25); // step = 1/16
          const dots: { beat: number; lane: number }[] = [];
          if (c.content.notes?.notes.length) {
            for (const n of c.content.notes.notes) dots.push({ beat: n.start, lane: n.pitch - DRUM_BASE });
          } else {
            Object.keys(pat.on).forEach((laneId, li) => (pat.on[laneId] || []).forEach((on, s) => { if (on) dots.push({ beat: s * 0.25, lane: li }); }));
          }
          if (dots.length) {
            let lo = Infinity, hi = -Infinity;
            dots.forEach((d) => { lo = Math.min(lo, d.lane); hi = Math.max(hi, d.lane); });
            const span = Math.max(1, hi - lo);
            const reps = Math.min(64, Math.max(1, Math.ceil(c.lengthBeats / clen)));
            g.fillStyle = "rgba(255,255,255,0.55)";
            for (let r = 0; r < reps; r++) {
              const off = r * clen;
              dots.forEach((d) => {
                const sb2 = off + d.beat;
                if (sb2 >= c.lengthBeats) return;
                const dx = x + (sb2 / c.lengthBeats) * cw;
                const dy = y + 6 + (1 - (d.lane - lo) / span) * (ROW_H - 16);
                if (dx > x + cw - 2) return;
                g.fillRect(dx, dy, 2, 2);
              });
            }
          }
        }
        // name + selection outline (always full alpha)
        g.globalAlpha = 1;
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
      onPointerLeave={() => {
        if (!drag.current) setCursor("default");
      }}
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
