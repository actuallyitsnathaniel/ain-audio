// ── PIANO ROLL — playable + editable MIDI clip editor ────────────────────
// A scrollable / zoomable viewport over the full MIDI range. ONE coordinate
// system for grid + notes (no squashing) so rows and notes always align.
//
// Edit (plain pointer):
//   click empty → add note (snapped to 1/16) · drag body → move ·
//   drag right edge → resize · double-click / alt-click / right-click → delete
// Navigate:
//   wheel → scroll pitches (vertical) · shift+wheel → scroll time (horizontal) ·
//   cmd/ctrl+wheel → zoom time around cursor · hold SPACE + drag (or middle-drag)
//   → pan both axes
//
// The working clip lives in a ref (mutated during drag for perf) and is pushed
// to engine.setActiveClip; the lookahead scheduler plays from there.

import { useEffect, useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { engine } from "../../engine";
import { useRafLoop } from "../../hooks/useRafLoop";
import { cloneClip, clipBeats, newNoteId, type Note, type NoteClip } from "../../data/clips";

const SNAP = 0.25; // beats (1/16)
const ROW_H = 14; // px per semitone row
const KEY_W = 30; // left piano-key gutter
const LO_MIDI = 12; // C0
const HI_MIDI = 108; // C8
const PITCH_SPAN = HI_MIDI - LO_MIDI; // rows below the top
const FULL_H = (PITCH_SPAN + 1) * ROW_H; // full grid height in px
const MIN_PPB = 28; // min pixels-per-beat (zoom out)
const MAX_PPB = 220; // max pixels-per-beat (zoom in)

const accent = () => getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#54adbd";
const snap = (b: number) => Math.round(b / SNAP) * SNAP;
const isBlack = (m: number) => [1, 3, 6, 8, 10].includes(((m % 12) + 12) % 12);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

type Drag =
  | { mode: "move"; id: string; grabBeat: number; startBeat: number }
  | { mode: "resize"; id: string }
  | { mode: "create"; id: string }
  | { mode: "pan"; startX: number; startY: number; baseX: number; baseY: number }
  | { mode: "play" }
  | null;

interface View {
  scrollX: number; // px scrolled in time
  scrollY: number; // px scrolled in pitch
  ppb: number; // pixels per beat (horizontal zoom)
}

export function PianoRoll({ height = 280 }: { height?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const clipRef = useRef<NoteClip | null>(null);
  const drag = useRef<Drag>(null);
  const gutterKey = useRef<number | null>(null); // pitch currently held via the gutter keyboard
  const spaceHeld = useRef(false);
  const view = useRef<View>({ scrollX: 0, scrollY: 0, ppb: 64 });

  const commit = () => {
    if (clipRef.current) engine.setActiveClip(clipRef.current);
  };

  // center the viewport vertically on a clip's notes (or middle C) on load
  const centerOn = (clip: NoteClip) => {
    const cv = ref.current;
    const h = cv ? cv.clientHeight : height;
    let mid = 60;
    if (clip.notes.length) {
      let lo = Infinity,
        hi = -Infinity;
      clip.notes.forEach((n) => {
        lo = Math.min(lo, n.pitch);
        hi = Math.max(hi, n.pitch);
      });
      mid = (lo + hi) / 2;
    }
    const midY = (HI_MIDI - mid) * ROW_H;
    view.current.scrollY = clamp(midY - h / 2, 0, Math.max(0, FULL_H - h));
    view.current.scrollX = 0;
  };

  const loadClip = (clip: NoteClip) => {
    clipRef.current = cloneClip(clip);
    centerOn(clipRef.current);
    commit();
  };

  useEffect(() => {
    loadClip(engine.getClip() || engine.samplePresets[0].defaultPhrase);
    const el = ref.current;
    if (!el) return;
    const onLoad = (e: Event) => loadClip((e as CustomEvent<NoteClip>).detail);
    el.addEventListener("pr-load", onLoad as EventListener);
    // wheel must be a non-passive native listener so we can preventDefault the
    // page from scrolling while we scroll/zoom the roll.
    el.addEventListener("wheel", handleWheel, { passive: false });
    // space-to-pan: track the key globally so it works while hovering the canvas.
    // preventDefault on space stops the page from scrolling while panning.
    const kd = (e: KeyboardEvent) => {
      if (e.code === "Space" && !isTypingTarget(e.target)) {
        spaceHeld.current = true;
        if (el.matches(":hover")) e.preventDefault();
      }
    };
    const ku = (e: KeyboardEvent) => {
      if (e.code === "Space") spaceHeld.current = false;
    };
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);
    return () => {
      el.removeEventListener("pr-load", onLoad as EventListener);
      el.removeEventListener("wheel", handleWheel);
      window.removeEventListener("keydown", kd);
      window.removeEventListener("keyup", ku);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── coordinate system (one source of truth, scroll-aware) ──
  const totalBeats = () => (clipRef.current ? clipBeats(clipRef.current) : 4);
  const maxScrollX = (w: number) => Math.max(0, totalBeats() * view.current.ppb - (w - KEY_W));
  const beatToX = (b: number) => KEY_W + b * view.current.ppb - view.current.scrollX;
  const xToBeat = (x: number) => (x - KEY_W + view.current.scrollX) / view.current.ppb;
  const pitchToY = (p: number) => (HI_MIDI - p) * ROW_H - view.current.scrollY;
  const yToPitch = (y: number) => HI_MIDI - Math.floor((y + view.current.scrollY) / ROW_H);

  // ── pointer edit ──
  const hitNote = (x: number, y: number): { note: Note; edge: boolean } | null => {
    if (!clipRef.current) return null;
    const beat = xToBeat(x);
    const pitch = yToPitch(y);
    for (let i = clipRef.current.notes.length - 1; i >= 0; i--) {
      const n = clipRef.current.notes[i];
      if (n.pitch !== pitch) continue;
      if (beat >= n.start && beat <= n.start + n.length) {
        const edgeX = beatToX(n.start + n.length);
        return { note: n, edge: x >= edgeX - 6 };
      }
    }
    return null;
  };

  const localXY = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = ref.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  // ── gutter keyboard (tap a left-edge key to audition the pitch) ──
  const gutterOn = (pitch: number) => {
    if (gutterKey.current === pitch) return;
    if (gutterKey.current !== null) engine.noteOff(gutterKey.current);
    gutterKey.current = pitch;
    engine.noteOn(pitch, 0.9);
  };
  const gutterOff = () => {
    if (gutterKey.current === null) return;
    engine.noteOff(gutterKey.current);
    gutterKey.current = null;
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!clipRef.current) return;
    const cv = ref.current!;
    cv.setPointerCapture(e.pointerId);
    const { x, y } = localXY(e);

    // pan: space-held or middle button, anywhere
    if (spaceHeld.current || e.button === 1) {
      drag.current = { mode: "pan", startX: e.clientX, startY: e.clientY, baseX: view.current.scrollX, baseY: view.current.scrollY };
      return;
    }
    // gutter: play the pitch under the pointer like a sideways keyboard
    if (x < KEY_W) {
      if (e.button === 0) {
        drag.current = { mode: "play" };
        gutterOn(clamp(yToPitch(y), LO_MIDI, HI_MIDI));
      }
      return;
    }

    const hit = hitNote(x, y);
    // right-click / alt → delete
    if (e.button === 2 || e.altKey) {
      if (hit) {
        clipRef.current.notes = clipRef.current.notes.filter((n) => n.id !== hit.note.id);
        commit();
      }
      return;
    }
    if (hit && hit.edge) {
      drag.current = { mode: "resize", id: hit.note.id };
    } else if (hit) {
      drag.current = { mode: "move", id: hit.note.id, grabBeat: xToBeat(x), startBeat: hit.note.start };
    } else {
      const note: Note = { id: newNoteId(), pitch: yToPitch(y), start: Math.max(0, snap(xToBeat(x) - SNAP / 2)), length: SNAP * 2, vel: 0.85 };
      clipRef.current.notes.push(note);
      drag.current = { mode: "create", id: note.id };
      engine.noteOn(note.pitch, note.vel);
      setTimeout(() => engine.noteOff(note.pitch), 140);
      commit();
    }
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    if (!d) return;
    const cv = ref.current!;
    const { x, y } = localXY(e);

    if (d.mode === "pan") {
      view.current.scrollX = clamp(d.baseX - (e.clientX - d.startX), 0, maxScrollX(cv.clientWidth));
      view.current.scrollY = clamp(d.baseY - (e.clientY - d.startY), 0, Math.max(0, FULL_H - cv.clientHeight));
      return;
    }
    if (d.mode === "play") {
      // slide up/down the keys to retrigger; slide into the lane to release
      if (x < KEY_W) gutterOn(clamp(yToPitch(y), LO_MIDI, HI_MIDI));
      else gutterOff();
      return;
    }
    if (!clipRef.current) return;
    const note = clipRef.current.notes.find((n) => n.id === d.id);
    if (!note) return;
    const tb = totalBeats();
    if (d.mode === "move") {
      const db = xToBeat(x) - d.grabBeat;
      note.start = clamp(snap(d.startBeat + db), 0, tb - note.length);
      note.pitch = clamp(yToPitch(y), LO_MIDI, HI_MIDI);
    } else if (d.mode === "resize" || d.mode === "create") {
      const end = snap(xToBeat(x));
      note.length = clamp(end - note.start, SNAP, tb - note.start);
    }
    commit();
  };

  const onPointerUp = () => {
    if (drag.current?.mode === "play") gutterOff();
    drag.current = null;
    commit();
  };

  const onDoubleClick = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const { x, y } = localXY(e);
    const hit = hitNote(x, y);
    if (hit && clipRef.current) {
      clipRef.current.notes = clipRef.current.notes.filter((n) => n.id !== hit.note.id);
      commit();
    }
  };

  // ── wheel: scroll / zoom (native non-passive so we can preventDefault) ──
  const handleWheel = (e: WheelEvent) => {
    const cv = ref.current;
    if (!cv) return;
    e.preventDefault();
    const v = view.current;
    if (e.ctrlKey || e.metaKey) {
      // zoom time around cursor — keep the beat under the cursor fixed
      const rect = cv.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const beatAt = xToBeat(cx);
      v.ppb = clamp(v.ppb * (e.deltaY < 0 ? 1.12 : 1 / 1.12), MIN_PPB, MAX_PPB);
      v.scrollX = clamp(beatAt * v.ppb - (cx - KEY_W), 0, maxScrollX(cv.clientWidth));
    } else if (e.shiftKey) {
      v.scrollX = clamp(v.scrollX + (e.deltaY || e.deltaX), 0, maxScrollX(cv.clientWidth));
    } else {
      v.scrollY = clamp(v.scrollY + e.deltaY, 0, Math.max(0, FULL_H - cv.clientHeight));
    }
  };

  // ── render: grid + notes + playhead, all in one scroll-aware pass ──
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
    g.fillStyle = "#08080a";
    g.fillRect(0, 0, w, h);

    const v = view.current;
    const tb = totalBeats();
    const bpb = clipRef.current?.beatsPerBar || 4;

    // visible pitch rows only
    const firstP = clamp(yToPitch(h), LO_MIDI, HI_MIDI);
    const lastP = clamp(yToPitch(0), LO_MIDI, HI_MIDI);
    for (let p = firstP; p <= lastP; p++) {
      const y = pitchToY(p);
      g.fillStyle = isBlack(p) ? "rgba(255,255,255,0.02)" : "rgba(255,255,255,0.045)";
      g.fillRect(KEY_W, y, w - KEY_W, ROW_H);
      g.fillStyle = "rgba(255,255,255,0.05)";
      g.fillRect(KEY_W, y, w - KEY_W, 1);
    }

    // beat / bar lines (vertical)
    for (let b = 0; b <= tb; b++) {
      const x = beatToX(b);
      if (x < KEY_W - 1 || x > w) continue;
      const bar = b % bpb === 0;
      g.fillStyle = bar ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.07)";
      g.fillRect(x, 0, bar ? 1.5 : 1, h);
    }
    // 1/16 sub-grid only when zoomed in enough to be readable
    if (v.ppb >= 90) {
      for (let b = 0; b <= tb; b += SNAP) {
        if (b % 1 === 0) continue;
        const x = beatToX(b);
        if (x < KEY_W || x > w) continue;
        g.fillStyle = "rgba(255,255,255,0.035)";
        g.fillRect(x, 0, 1, h);
      }
    }

    // notes + playhead, clipped to the lane area so they never paint over the gutter
    const ac = accent();
    const pos = engine.getSequencePosition();
    const notes = clipRef.current?.notes || [];
    g.save();
    g.beginPath();
    g.rect(KEY_W, 0, w - KEY_W, h);
    g.clip();
    notes.forEach((n) => {
      const x = beatToX(n.start);
      const y = pitchToY(n.pitch);
      if (y < -ROW_H || y > h) return;
      const wn = Math.max(3, n.length * v.ppb - 1.5);
      if (x + wn < KEY_W || x > w) return;
      const playing = pos.playing && pos.beat >= n.start && pos.beat < n.start + n.length;
      g.fillStyle = ac;
      g.globalAlpha = playing ? 1 : 0.5 + n.vel * 0.4;
      g.beginPath();
      g.roundRect(x, y + 1, wn, ROW_H - 2, 2);
      g.fill();
      g.globalAlpha = 1;
      g.fillStyle = "rgba(255,255,255,0.28)";
      g.fillRect(x, y + 1, wn, 1);
    });
    if (pos.playing) {
      const px = beatToX(pos.beat);
      g.fillStyle = "#ffffff";
      g.globalAlpha = 0.85;
      g.fillRect(px, 0, 1.5, h);
      g.globalAlpha = 1;
    }
    g.restore();

    // ── piano-key gutter (drawn last, fixed to the left, scrolls vertically) ──
    // tap-to-play sideways keyboard; the held key + every sounding pitch glow.
    const held = gutterKey.current;
    const sounding = new Set(engine.activeNotes());
    g.fillStyle = "#0c0c0e";
    g.fillRect(0, 0, KEY_W, h);
    for (let p = firstP; p <= lastP; p++) {
      const y = pitchToY(p);
      const lit = p === held || sounding.has(p);
      g.fillStyle = lit ? ac : isBlack(p) ? "#16161a" : "#c9c9cf";
      g.fillRect(0, y, KEY_W - 1, ROW_H - 1);
      if (p % 12 === 0) {
        g.fillStyle = lit ? "#0c0c0e" : "#3a3a40";
        g.font = "8px ui-monospace, monospace";
        g.fillText("C" + (Math.floor(p / 12) - 1), 3, y + ROW_H - 4);
      }
    }
    g.fillStyle = "rgba(255,255,255,0.12)";
    g.fillRect(KEY_W - 1, 0, 1, h);
  });

  return (
    <canvas
      ref={ref}
      className={"w-full touch-none rounded-[3px] border border-line bg-inset select-none " + (spaceHeld.current ? "cursor-grab" : "")}
      style={{ height }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
      onContextMenu={(e) => e.preventDefault()}
    />
  );
}

function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  const tag = (el?.tagName || "").toLowerCase();
  return tag === "input" || tag === "textarea" || !!el?.isContentEditable;
}
