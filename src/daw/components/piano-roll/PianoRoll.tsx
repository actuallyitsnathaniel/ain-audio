// ── PIANO ROLL — playable + editable MIDI clip editor ────────────────────
// A scrollable / zoomable viewport over the full MIDI range. ONE coordinate
// system for grid + notes (no squashing) so rows and notes always align.
// Gesture set models Ableton Live's MIDI Note Editor (non-draw-mode).
//
// Edit:
//   click empty → draw a note · click a note → select · shift+click → add/remove ·
//   drag empty → marquee select (shift adds) · drag a note → move the selection ·
//   drag right edge → resize · hold ⌘/ctrl while moving/resizing → bypass snap ·
//   ⌥/ctrl+drag a note → duplicate the selection · double-click / right-click → delete
// Keyboard (when the roll has focus):
//   ←/→ nudge in time · ⌘/ctrl+←/→ nudge w/o snap · shift+←/→ resize ·
//   ↑/↓ transpose semitone · shift+↑/↓ octave · delete/backspace · ⌘/ctrl+A all ·
//   ⌘/ctrl+D duplicate · esc deselect
// Navigate:
//   wheel → pitch · shift+wheel → time · ⌘/ctrl+wheel → zoom · space/middle-drag → pan
// Velocity lane (docked bottom band):
//   drag a note's stem up/down → set its velocity · sweep across notes → paint a ramp ·
//   (with a multi-note selection, dragging any selected note's stem sets the whole selection)
//
// The working clip lives in a ref (mutated during drag for perf) and is pushed
// to engine.setActiveClip; the lookahead scheduler plays from there.

import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { engine } from "../../engine";
import { openContextMenu, type MenuItem } from "../context-menu-bus";
import { useRafLoop } from "../../hooks/useRafLoop";
import { cloneClip, clipBeats, newNoteId, type AutoPoint, type Note, type NoteClip } from "../../data/clips";

const SNAP = 0.25; // beats (1/16)
const ROW_H = 14; // px per semitone row
const KEY_W = 30; // left piano-key gutter
const LO_MIDI = 12; // C0
const HI_MIDI = 108; // C8
const PITCH_SPAN = HI_MIDI - LO_MIDI;
const FULL_H = (PITCH_SPAN + 1) * ROW_H;
const MIN_PPB = 28;
const MAX_PPB = 220;
const DRAG_SLOP = 3; // px before a press becomes a drag
const VEL_H = 52; // automation lane height (px) docked at the canvas bottom when open
const LANE_TAB_H = 16; // collapsed: just the VEL|VIB tab strip

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const noteName = (m: number) => NOTE_NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);

const accent = () => getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#54adbd";
const snapTo = (b: number) => Math.round(b / SNAP) * SNAP;
const isBlack = (m: number) => [1, 3, 6, 8, 10].includes(((m % 12) + 12) % 12);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
// Live's modifier convention: ⌘(mac)/ctrl(win) bypasses snap & is the "command" key
const cmd = (e: { metaKey: boolean; ctrlKey: boolean }) => e.metaKey || e.ctrlKey;

type Drag =
  | { mode: "move"; grabBeat: number; grabPitch: number; base: Map<string, { start: number; pitch: number }>; moved: boolean; dup: boolean }
  | { mode: "resize"; base: Map<string, number>; anchor: string; moved: boolean }
  | { mode: "create"; id: string }
  | { mode: "marquee"; x0: number; y0: number; x1: number; y1: number; add: Set<string> }
  | { mode: "pan"; startX: number; startY: number; baseX: number; baseY: number }
  | { mode: "play" }
  | { mode: "vel" } // drag in the velocity lane; sweeping paints a ramp
  | { mode: "auto"; pt: number } // drag a vibrato breakpoint (index into the curve)
  | { mode: "autoDraw" } // freehand-draw vibrato breakpoints by sweeping
  | null;

interface View {
  scrollX: number;
  scrollY: number;
  ppb: number;
}

// `channelId` binds the roll to a beat-maker MIDI channel's clip instead of the
// global Audio-Lab clip; everything else (gestures, render, playhead) is identical.
export function PianoRoll({ height = 280, channelId, initialClip, onCommit }: { height?: number; channelId?: string; initialClip?: NoteClip; onCommit?: (clip: NoteClip) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const clipRef = useRef<NoteClip | null>(null);
  const sel = useRef<Set<string>>(new Set()); // selected note ids
  const drag = useRef<Drag>(null);
  const pressXY = useRef<{ x: number; y: number } | null>(null); // for drag-slop
  const gutterKey = useRef<number | null>(null);
  const spaceHeld = useRef(false);
  const view = useRef<View>({ scrollX: 0, scrollY: 0, ppb: 64 });
  // bottom lane: which automation it shows, and whether it's expanded. A ref mirror
  // (assigned in an effect, not during render) lets the rAF canvas read it.
  const [lane, setLane] = useState<{ mode: "vel" | "vib"; open: boolean }>({ mode: "vel", open: true });
  const laneRef = useRef(lane);
  useEffect(() => {
    laneRef.current = lane;
  }, [lane]);
  const laneH = () => (laneRef.current.open ? VEL_H : LANE_TAB_H);

  const commit = () => {
    if (!clipRef.current) return;
    if (onCommit) onCommit(clipRef.current); // arrangement clip binding
    else if (channelId) engine.setChannelClip(channelId, clipRef.current);
    else engine.setActiveClip(clipRef.current);
  };

  const centerOn = (clip: NoteClip) => {
    const h = gridH();
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
    view.current.scrollY = clamp((HI_MIDI - mid) * ROW_H - h / 2, 0, Math.max(0, FULL_H - h));
    view.current.scrollX = 0;
  };

  const loadClip = (clip: NoteClip) => {
    clipRef.current = cloneClip(clip);
    sel.current = new Set();
    centerOn(clipRef.current);
    commit();
  };

  useEffect(() => {
    loadClip(initialClip || (channelId ? engine.getChannelClip(channelId) || { bars: 1, beatsPerBar: 4, notes: [] } : engine.getClip() || engine.samplePresets[0].defaultPhrase));
    const el = ref.current;
    if (!el) return;
    const onLoad = (e: Event) => loadClip((e as CustomEvent<NoteClip>).detail);
    el.addEventListener("pr-load", onLoad as EventListener);
    el.addEventListener("wheel", handleWheel, { passive: false });
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

  // ── coordinate system ──
  // the pitch grid occupies the canvas above the docked velocity lane
  const gridH = () => Math.max(0, (ref.current?.clientHeight ?? height) - laneH());
  const totalBeats = () => (clipRef.current ? clipBeats(clipRef.current) : 4);
  const maxScrollX = (w: number) => Math.max(0, totalBeats() * view.current.ppb - (w - KEY_W));
  const beatToX = (b: number) => KEY_W + b * view.current.ppb - view.current.scrollX;
  const xToBeat = (x: number) => (x - KEY_W + view.current.scrollX) / view.current.ppb;
  const pitchToY = (p: number) => (HI_MIDI - p) * ROW_H - view.current.scrollY;
  const yToPitch = (y: number) => HI_MIDI - Math.floor((y + view.current.scrollY) / ROW_H);

  const notes = () => clipRef.current?.notes || [];
  const byId = (id: string) => notes().find((n) => n.id === id);

  const hitNote = (x: number, y: number): { note: Note; edge: boolean } | null => {
    if (!clipRef.current) return null;
    const beat = xToBeat(x);
    const pitch = yToPitch(y);
    for (let i = clipRef.current.notes.length - 1; i >= 0; i--) {
      const n = clipRef.current.notes[i];
      if (n.pitch !== pitch) continue;
      if (beat >= n.start && beat <= n.start + n.length) {
        return { note: n, edge: x >= beatToX(n.start + n.length) - 6 };
      }
    }
    return null;
  };

  const localXY = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = ref.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const blip = (pitch: number) => {
    engine.noteOn(pitch, 0.85, channelId);
    setTimeout(() => engine.noteOff(pitch, false, channelId), 140);
  };

  // ── gutter keyboard ──
  const gutterOn = (pitch: number) => {
    if (gutterKey.current === pitch) return;
    if (gutterKey.current !== null) engine.noteOff(gutterKey.current, false, channelId);
    gutterKey.current = pitch;
    engine.noteOn(pitch, 0.9, channelId);
  };
  const gutterOff = () => {
    if (gutterKey.current === null) return;
    engine.noteOff(gutterKey.current, false, channelId);
    gutterKey.current = null;
  };

  // shift+click a gutter key → select/deselect the whole pitch row
  const togglePitchRow = (pitch: number) => {
    const ids = notes().filter((n) => n.pitch === pitch).map((n) => n.id);
    if (!ids.length) return;
    const allSel = ids.every((id) => sel.current.has(id));
    ids.forEach((id) => (allSel ? sel.current.delete(id) : sel.current.add(id)));
  };

  // velocity from a y inside the lane: lane top = 1.0, lane bottom = 0.0
  const velFromY = (y: number) => {
    const gh = gridH();
    const laneH = (ref.current?.clientHeight ?? height) - gh;
    return clamp(1 - (y - gh) / Math.max(1, laneH), 0, 1);
  };
  // set velocity of the note whose stem is nearest x (within ~6px). If a selection
  // exists and the hit note is in it, set the whole selection (Live's behavior).
  const applyVel = (x: number, y: number) => {
    if (!clipRef.current) return;
    const vel = Math.round(velFromY(y) * 100) / 100;
    let nearest: Note | null = null;
    let best = 7; // px tolerance
    notes().forEach((n) => {
      const d = Math.abs(beatToX(n.start) - x);
      if (d < best) {
        best = d;
        nearest = n;
      }
    });
    if (!nearest) return;
    const hit: Note = nearest;
    const targets = sel.current.has(hit.id) && sel.current.size > 1 ? [...sel.current].map(byId).filter(Boolean) as Note[] : [hit];
    targets.forEach((n) => (n.vel = vel));
    commit();
  };

  // ── vibrato automation-lane editing ──
  const laneBand = (gh: number) => ({ top: gh + 16, bottom: (ref.current?.clientHeight ?? height) - 3 });
  const sortVib = (pts: AutoPoint[]) => pts.sort((a, b) => a.beat - b.beat);
  // index of a breakpoint within grab range of (x,y), else -1
  const hitVibPoint = (x: number, y: number, gh: number) => {
    const { top, bottom } = laneBand(gh);
    let idx = -1;
    let best = 7;
    vibPoints().forEach((p, i) => {
      const d = Math.hypot(beatToX(p.beat) - x, laneYFromVal(p.value, top, bottom) - y);
      if (d < best) {
        best = d;
        idx = i;
      }
    });
    return idx;
  };
  const laneVibDown = (e: ReactPointerEvent<HTMLCanvasElement>, x: number, y: number, gh: number) => {
    const { top, bottom } = laneBand(gh);
    const pts = ensureVibLane();
    const idx = hitVibPoint(x, y, gh);
    // right-click / ⌥ on a point → delete it
    if ((e.button === 2 || e.altKey) && idx >= 0) {
      pts.splice(idx, 1);
      commit();
      return;
    }
    if (e.button === 2) return;
    if (idx >= 0) {
      drag.current = { mode: "auto", pt: idx };
      return;
    }
    // empty: add a breakpoint here and grab it (⌘/ctrl = freehand-draw instead)
    const beat = clamp(cmd(e) ? xToBeat(x) : snapTo(xToBeat(x)), 0, totalBeats());
    const value = laneValFromY(y, top, bottom);
    pts.push({ beat, value });
    sortVib(pts);
    commit();
    drag.current = cmd(e) ? { mode: "autoDraw" } : { mode: "auto", pt: pts.findIndex((p) => p.beat === beat && p.value === value) };
  };
  // move the dragged breakpoint to (x,y); keep the array sorted, re-find its index
  const laneVibMove = (x: number, y: number, gh: number) => {
    const d = drag.current;
    if (!clipRef.current || (d?.mode !== "auto" && d?.mode !== "autoDraw")) return;
    const { top, bottom } = laneBand(gh);
    const pts = ensureVibLane();
    const value = laneValFromY(y, top, bottom);
    if (d.mode === "autoDraw") {
      // freehand: drop a point at the snapped beat, replacing any at the same beat
      const beat = clamp(snapTo(xToBeat(x)), 0, totalBeats());
      const at = pts.findIndex((p) => Math.abs(p.beat - beat) < 1e-6);
      if (at >= 0) pts[at].value = value;
      else {
        pts.push({ beat, value });
        sortVib(pts);
      }
      commit();
      return;
    }
    const p = pts[d.pt];
    if (!p) return;
    p.beat = clamp(snapTo(xToBeat(x)), 0, totalBeats());
    p.value = value;
    sortVib(pts);
    drag.current = { mode: "auto", pt: pts.indexOf(p) }; // re-locate after sort
    commit();
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!clipRef.current) return;
    const cv = ref.current!;
    cv.focus();
    cv.setPointerCapture(e.pointerId);
    const { x, y } = localXY(e);
    pressXY.current = { x, y };

    if (spaceHeld.current || e.button === 1) {
      drag.current = { mode: "pan", startX: e.clientX, startY: e.clientY, baseX: view.current.scrollX, baseY: view.current.scrollY };
      return;
    }
    // gutter
    if (x < KEY_W) {
      if (e.button === 0 && e.shiftKey) {
        togglePitchRow(clamp(yToPitch(y), LO_MIDI, HI_MIDI));
      } else if (e.button === 0) {
        drag.current = { mode: "play" };
        gutterOn(clamp(yToPitch(y), LO_MIDI, HI_MIDI));
      }
      return;
    }

    // bottom automation lane. The VEL/VIB/collapse tabs are real DOM buttons
    // overlaid on the top strip (they intercept their own clicks); editing happens
    // below them.
    if (y >= gridH()) {
      const gh = gridH();
      if (!laneRef.current.open || y < gh + 16) return; // collapsed, or on the tab strip
      if (laneRef.current.mode === "vel") {
        drag.current = { mode: "vel" };
        applyVel(x, y);
      } else {
        laneVibDown(e, x, y, gh);
      }
      return;
    }

    const hit = hitNote(x, y);
    // right-click is handled by onContextMenu (custom menu); ignore the pointerdown
    if (e.button === 2) return;

    if (hit) {
      const id = hit.note.id;
      if (e.shiftKey) {
        // toggle in/out of selection
        if (sel.current.has(id)) sel.current.delete(id);
        else sel.current.add(id);
      } else if (!sel.current.has(id)) {
        // fresh selection of just this note
        sel.current = new Set([id]);
      }
      if (hit.edge && sel.current.has(id)) {
        const base = new Map<string, number>();
        sel.current.forEach((sid) => {
          const n = byId(sid);
          if (n) base.set(sid, n.length);
        });
        drag.current = { mode: "resize", base, anchor: id, moved: false };
      } else if (sel.current.has(id)) {
        const base = new Map<string, { start: number; pitch: number }>();
        sel.current.forEach((sid) => {
          const n = byId(sid);
          if (n) base.set(sid, { start: n.start, pitch: n.pitch });
        });
        // ⌥(mac)/ctrl(win) or alt at press → duplicate-drag
        drag.current = { mode: "move", grabBeat: xToBeat(x), grabPitch: yToPitch(y), base, moved: false, dup: e.altKey };
      }
    } else if (e.button === 0) {
      // empty: marquee (shift adds to selection) — promoted from a press once it
      // exceeds the slop; a plain click that doesn't drag draws a note on up.
      drag.current = { mode: "marquee", x0: x, y0: y, x1: x, y1: y, add: e.shiftKey ? new Set(sel.current) : new Set() };
      if (!e.shiftKey) sel.current = new Set();
    }
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    if (!d) return;
    const cv = ref.current!;
    const { x, y } = localXY(e);

    if (d.mode === "pan") {
      view.current.scrollX = clamp(d.baseX - (e.clientX - d.startX), 0, maxScrollX(cv.clientWidth));
      view.current.scrollY = clamp(d.baseY - (e.clientY - d.startY), 0, Math.max(0, FULL_H - gridH()));
      return;
    }
    if (d.mode === "play") {
      if (x < KEY_W) gutterOn(clamp(yToPitch(y), LO_MIDI, HI_MIDI));
      else gutterOff();
      return;
    }
    if (d.mode === "vel") {
      // sweeping with y tracking the pointer paints a ramp across notes naturally
      applyVel(x, y);
      return;
    }
    if (d.mode === "auto" || d.mode === "autoDraw") {
      laneVibMove(x, y, gridH());
      return;
    }
    if (!clipRef.current) return;
    const free = cmd(e) || e.altKey; // bypass snap while held
    const tb = totalBeats();

    if (d.mode === "marquee") {
      d.x1 = x;
      d.y1 = y;
      // live-select notes intersecting the box
      const b0 = xToBeat(Math.min(d.x0, x));
      const b1 = xToBeat(Math.max(d.x0, x));
      const p0 = yToPitch(Math.max(d.y0, y));
      const p1 = yToPitch(Math.min(d.y0, y));
      const next = new Set(d.add);
      notes().forEach((n) => {
        const hit = n.pitch >= p0 && n.pitch <= p1 && n.start + n.length >= b0 && n.start <= b1;
        if (hit) next.add(n.id);
      });
      sel.current = next;
      return;
    }

    if (d.mode === "move") {
      if (!d.moved && pressXY.current && Math.hypot(x - pressXY.current.x, y - pressXY.current.y) < DRAG_SLOP) return;
      // on first real movement, if duplicating, clone the selection in place
      if (!d.moved && d.dup) duplicateSelection(0, 0, true);
      d.moved = true;
      const dBeatRaw = xToBeat(x) - d.grabBeat;
      const dPitch = yToPitch(y) - d.grabPitch;
      d.base.forEach((b, id) => {
        const n = byId(id);
        if (!n) return;
        const ns = free ? b.start + dBeatRaw : snapTo(b.start + dBeatRaw);
        n.start = clamp(ns, 0, tb - n.length);
        n.pitch = clamp(b.pitch + dPitch, LO_MIDI, HI_MIDI);
      });
      commit();
      return;
    }

    if (d.mode === "resize") {
      if (!d.moved && pressXY.current && Math.hypot(x - pressXY.current.x, y - pressXY.current.y) < DRAG_SLOP) return;
      d.moved = true;
      const anchor = byId(d.anchor);
      if (!anchor) return;
      const end = free ? xToBeat(x) : snapTo(xToBeat(x));
      const newLen = clamp(end - anchor.start, SNAP, tb - anchor.start);
      const dLen = newLen - (d.base.get(d.anchor) || newLen);
      d.base.forEach((len0, id) => {
        const n = byId(id);
        if (!n) return;
        n.length = clamp(len0 + dLen, SNAP, tb - n.start);
      });
      commit();
      return;
    }
  };

  const onPointerUp = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.mode === "play") {
      gutterOff();
      return;
    }
    if (d.mode === "marquee") {
      // a click that never dragged on empty space → draw a note
      const moved = pressXY.current && Math.hypot(d.x1 - d.x0, d.y1 - d.y0) >= DRAG_SLOP;
      if (!moved && clipRef.current) {
        const { x, y } = localXY(e);
        if (x >= KEY_W) {
          const note: Note = { id: newNoteId(), pitch: clamp(yToPitch(y), LO_MIDI, HI_MIDI), start: clamp(snapTo(xToBeat(x) - SNAP / 2), 0, totalBeats() - SNAP * 2), length: SNAP * 2, vel: 0.85 };
          clipRef.current.notes.push(note);
          sel.current = new Set([note.id]);
          blip(note.pitch);
          commit();
        }
      }
      return;
    }
    if ((d.mode === "move" && !d.moved) || (d.mode === "resize" && !d.moved)) {
      // a plain click on a note (no drag): selection already set in pointerDown
      return;
    }
    commit();
  };

  const onDoubleClick = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const { x, y } = localXY(e);
    const hit = hitNote(x, y);
    if (hit) deleteNotes([hit.note.id]);
  };

  // ── editing ops ──
  const deleteNotes = (ids: string[]) => {
    if (!clipRef.current) return;
    const kill = new Set(ids);
    clipRef.current.notes = clipRef.current.notes.filter((n) => !kill.has(n.id));
    ids.forEach((id) => sel.current.delete(id));
    commit();
  };

  // clone the current selection; if inPlace, leaves copies on top (for dup-drag),
  // else offsets by (dBeat, dPitch). New copies become the selection.
  const duplicateSelection = (dBeat: number, dPitch: number, inPlace = false) => {
    if (!clipRef.current || !sel.current.size) return;
    const fresh: string[] = [];
    const tb = totalBeats();
    [...sel.current].forEach((id) => {
      const n = byId(id);
      if (!n) return;
      const copy: Note = {
        id: newNoteId(),
        pitch: clamp(n.pitch + dPitch, LO_MIDI, HI_MIDI),
        start: clamp(n.start + dBeat, 0, tb - n.length),
        length: n.length,
        vel: n.vel,
      };
      clipRef.current!.notes.push(copy);
      fresh.push(copy.id);
    });
    if (!inPlace) sel.current = new Set(fresh);
    commit();
  };

  const nudge = (dBeat: number, dPitch: number, free: boolean) => {
    if (!sel.current.size) return;
    const tb = totalBeats();
    sel.current.forEach((id) => {
      const n = byId(id);
      if (!n) return;
      if (dBeat) n.start = clamp(free ? n.start + dBeat : snapTo(n.start + dBeat), 0, tb - n.length);
      if (dPitch) n.pitch = clamp(n.pitch + dPitch, LO_MIDI, HI_MIDI);
    });
    if (dPitch) {
      const first = byId([...sel.current][0]);
      if (first) blip(first.pitch);
    }
    commit();
  };

  const resizeSel = (dBeat: number) => {
    if (!sel.current.size) return;
    const tb = totalBeats();
    sel.current.forEach((id) => {
      const n = byId(id);
      if (!n) return;
      n.length = clamp(snapTo(n.length + dBeat), SNAP, tb - n.start);
    });
    commit();
  };

  // shift every selected note's velocity by dV (0–1). Reports the new value of
  // the selection's representative note to the HUD readout.
  const velSel = (dV: number) => {
    if (!sel.current.size) return;
    sel.current.forEach((id) => {
      const n = byId(id);
      if (!n) return;
      n.vel = clamp(Math.round((n.vel + dV) * 100) / 100, 0.05, 1);
    });
    commit();
  };

  // ── context-menu action helpers (also reused by the right-click menu) ──
  const setVelSel = (v: number) => {
    if (!sel.current.size) return;
    sel.current.forEach((id) => {
      const n = byId(id);
      if (n) n.vel = clamp(v, 0.05, 1);
    });
    commit();
  };
  const quantizeSel = () => {
    const ids = sel.current.size ? [...sel.current] : notes().map((n) => n.id);
    ids.forEach((id) => {
      const n = byId(id);
      if (n) n.start = snapTo(n.start);
    });
    commit();
  };
  const selectAll = () => {
    sel.current = new Set(notes().map((n) => n.id));
  };
  const clearClip = () => {
    if (!clipRef.current) return;
    clipRef.current.notes = [];
    sel.current = new Set();
    commit();
  };
  // portamento: glide a note from a source pitch into its own. Default source = the
  // FL-style portamento: flagging a note `slide` makes it bend the PREVIOUS note's
  // voice to its pitch (no re-attack) instead of articulating. Engine groups the
  // legato run; here we just toggle the flag.
  const setSlide = (on: boolean) => {
    if (!sel.current.size) return;
    sel.current.forEach((id) => {
      const n = byId(id);
      if (n) n.slide = on || undefined;
    });
    commit();
  };
  // the note immediately preceding `n` in time (for drawing the slide lead-in)
  const prevNote = (n: Note): Note | null => {
    let best: Note | null = null;
    notes().forEach((m) => {
      if (m.id !== n.id && m.start < n.start && (!best || m.start > (best as Note).start)) best = m;
    });
    return best;
  };

  // Right-click → custom menu (Shift+right-click falls through to the browser's).
  // Items adapt: a note under the cursor gets note/velocity actions; the clip-wide
  // actions are always present.
  const onContextMenu = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (e.shiftKey) return; // escape hatch → native menu
    e.preventDefault();
    const rect = ref.current!.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    // right-click inside the open vibrato lane deletes a breakpoint (no menu)
    if (y >= gridH() && laneRef.current.open && laneRef.current.mode === "vib") {
      const idx = hitVibPoint(x, y, gridH());
      if (idx >= 0) {
        ensureVibLane().splice(idx, 1);
        commit();
      }
      return;
    }
    const hit = hitNote(x, y);
    // right-clicking a note that isn't selected makes it the selection
    if (hit && !sel.current.has(hit.note.id)) sel.current = new Set([hit.note.id]);
    const selCount = sel.current.size;
    const items: MenuItem[] = [];
    if (hit || selCount) {
      const anySlide = [...sel.current].some((id) => byId(id)?.slide);
      items.push(
        { label: selCount > 1 ? `delete ${selCount} notes` : "delete note", danger: true, onClick: () => deleteNotes([...sel.current]) },
        { label: "duplicate", hint: "⌘D", onClick: () => duplicateSelection(1, 0) },
        { separator: true },
        { label: "velocity 100%", onClick: () => setVelSel(1) },
        { label: "velocity 75%", onClick: () => setVelSel(0.75) },
        { label: "velocity 50%", onClick: () => setVelSel(0.5) },
        { separator: true },
        anySlide
          ? { label: "clear slide", onClick: () => setSlide(false) }
          : { label: "make slide note (bend prev)", onClick: () => setSlide(true) },
        { separator: true },
        { label: "octave up", hint: "⇧↑", onClick: () => nudge(0, 12, false) },
        { label: "octave down", hint: "⇧↓", onClick: () => nudge(0, -12, false) },
        { label: "quantize to grid", onClick: quantizeSel },
        { separator: true },
      );
    }
    items.push(
      { label: "select all", hint: "⌘A", onClick: selectAll },
      { label: "clear clip", danger: true, disabled: !notes().length, onClick: clearClip },
      { separator: true },
      { label: "browser menu", hint: "⇧right-click", disabled: true },
    );
    openContextMenu({ x: e.clientX, y: e.clientY, title: channelId ? "midi notes" : "piano roll", items });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLCanvasElement>) => {
    if (!clipRef.current) return;
    const k = e.key;
    if (k === "Escape") {
      sel.current = new Set();
      return;
    }
    if (cmd(e) && (k === "a" || k === "A")) {
      sel.current = new Set(notes().map((n) => n.id));
      e.preventDefault();
      return;
    }
    if (cmd(e) && (k === "d" || k === "D")) {
      duplicateSelection(1, 0); // duplicate one beat to the right
      e.preventDefault();
      return;
    }
    if (k === "Delete" || k === "Backspace") {
      deleteNotes([...sel.current]);
      e.preventDefault();
      return;
    }
    if (!sel.current.size) return;
    const altFree = e.altKey; // alt = bypass snap on time nudge (Live convention)
    if (k === "ArrowLeft") {
      e.preventDefault();
      if (e.shiftKey) resizeSel(-SNAP);
      else nudge(-SNAP, 0, altFree);
    } else if (k === "ArrowRight") {
      e.preventDefault();
      if (e.shiftKey) resizeSel(SNAP);
      else nudge(SNAP, 0, altFree);
    } else if (k === "ArrowUp") {
      e.preventDefault();
      if (cmd(e)) velSel(0.1); // ⌘/ctrl+↑ → velocity +10 (Live convention)
      else nudge(0, e.shiftKey ? 12 : 1, altFree); // ↑ semitone · shift+↑ octave
    } else if (k === "ArrowDown") {
      e.preventDefault();
      if (cmd(e)) velSel(-0.1);
      else nudge(0, e.shiftKey ? -12 : -1, altFree);
    }
  };

  const handleWheel = (e: WheelEvent) => {
    const cv = ref.current;
    if (!cv) return;
    e.preventDefault();
    const v = view.current;
    if (e.ctrlKey || e.metaKey) {
      const rect = cv.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const beatAt = xToBeat(cx);
      v.ppb = clamp(v.ppb * (e.deltaY < 0 ? 1.12 : 1 / 1.12), MIN_PPB, MAX_PPB);
      v.scrollX = clamp(beatAt * v.ppb - (cx - KEY_W), 0, maxScrollX(cv.clientWidth));
    } else if (e.shiftKey) {
      v.scrollX = clamp(v.scrollX + (e.deltaY || e.deltaX), 0, maxScrollX(cv.clientWidth));
    } else {
      v.scrollY = clamp(v.scrollY + e.deltaY, 0, Math.max(0, FULL_H - gridH()));
    }
  };

  // ── bottom automation lane (VEL | VIB tab; collapsible) ──
  // the lane's vibrato curve points (clip-global). Reads/creates lazily.
  const vibLane = () => clipRef.current?.autos?.find((a) => a.target === "vibrato");
  const vibPoints = () => vibLane()?.points || [];
  const ensureVibLane = (): AutoPoint[] => {
    if (!clipRef.current) return [];
    clipRef.current.autos = clipRef.current.autos || [];
    let l = clipRef.current.autos.find((a) => a.target === "vibrato");
    if (!l) {
      l = { target: "vibrato", points: [] };
      clipRef.current.autos.push(l);
    }
    return l.points;
  };
  // map a lane y to a 0..1 value (top = 1) and back, within the lane band [top,bottom]
  const laneValFromY = (y: number, top: number, bottom: number) => clamp(1 - (y - top) / Math.max(1, bottom - top), 0, 1);
  const laneYFromVal = (val: number, top: number, bottom: number) => top + (1 - val) * (bottom - top);

  const drawLane = (
    g: CanvasRenderingContext2D,
    w: number,
    gh: number,
    h: number,
    ac: string,
    pos: { playing: boolean; beat: number },
  ) => {
    g.fillStyle = "#0a0a0d";
    g.fillRect(0, gh, w, h - gh);
    g.fillStyle = "rgba(255,255,255,0.12)";
    g.fillRect(0, gh, w, 1); // divider
    if (!laneRef.current.open) return; // collapsed → just the tab strip (DOM buttons)

    const top = gh + 16; // leave room for the overlaid tab buttons
    const bottom = h - 3;
    g.save();
    g.beginPath();
    g.rect(KEY_W, gh + 1, w - KEY_W, h - gh);
    g.clip();

    if (laneRef.current.mode === "vel") {
      notes().forEach((n) => {
        const x = beatToX(n.start);
        if (x < KEY_W - 2 || x > w) return;
        const barH = Math.max(2, n.vel * (bottom - top));
        const y = bottom - barH;
        const selected = sel.current.has(n.id);
        const playing = pos.playing && pos.beat >= n.start && pos.beat < n.start + n.length;
        g.fillStyle = selected ? "#ffffff" : playing ? ac : "rgba(84,173,189,0.7)";
        g.fillRect(x, y, 2, barH);
        g.beginPath();
        g.arc(x + 1, y, 2.5, 0, Math.PI * 2);
        g.fill();
      });
    } else {
      // vibrato curve: piecewise-linear through the breakpoints + endpoints
      const pts = vibPoints();
      const tb = totalBeats();
      g.strokeStyle = "#9a7ff0"; // violet
      g.lineWidth = 1.5;
      g.beginPath();
      if (pts.length === 0) {
        // flat-zero baseline
        g.moveTo(KEY_W, bottom);
        g.lineTo(w, bottom);
      } else {
        const first = pts[0];
        g.moveTo(beatToX(0), laneYFromVal(first.value, top, bottom));
        pts.forEach((p) => g.lineTo(beatToX(p.beat), laneYFromVal(p.value, top, bottom)));
        g.lineTo(beatToX(tb), laneYFromVal(pts[pts.length - 1].value, top, bottom));
      }
      g.stroke();
      // filled area under the curve (subtle)
      g.lineTo(beatToX(tb), bottom);
      g.lineTo(beatToX(0), bottom);
      g.closePath();
      g.fillStyle = "rgba(154,127,240,0.12)";
      g.fill();
      // breakpoint handles
      pts.forEach((p) => {
        const px = beatToX(p.beat);
        if (px < KEY_W - 3 || px > w) return;
        g.fillStyle = "#9a7ff0";
        g.beginPath();
        g.arc(px, laneYFromVal(p.value, top, bottom), 3, 0, Math.PI * 2);
        g.fill();
      });
    }
    g.restore();
  };

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
    g.fillStyle = "#08080a";
    g.fillRect(0, 0, w, h);

    const v = view.current;
    const gh = h - laneH(); // pitch-grid height; the automation lane occupies the rest
    const tb = totalBeats();
    const bpb = clipRef.current?.beatsPerBar || 4;
    const firstP = clamp(yToPitch(gh), LO_MIDI, HI_MIDI);
    const lastP = clamp(yToPitch(0), LO_MIDI, HI_MIDI);

    for (let p = firstP; p <= lastP; p++) {
      const y = pitchToY(p);
      g.fillStyle = isBlack(p) ? "rgba(255,255,255,0.02)" : "rgba(255,255,255,0.045)";
      g.fillRect(KEY_W, y, w - KEY_W, ROW_H);
      g.fillStyle = "rgba(255,255,255,0.05)";
      g.fillRect(KEY_W, y, w - KEY_W, 1);
    }
    for (let b = 0; b <= tb; b++) {
      const x = beatToX(b);
      if (x < KEY_W - 1 || x > w) continue;
      const bar = b % bpb === 0;
      g.fillStyle = bar ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.07)";
      g.fillRect(x, 0, bar ? 1.5 : 1, gh);
    }
    if (v.ppb >= 90) {
      for (let b = 0; b <= tb; b += SNAP) {
        if (b % 1 === 0) continue;
        const x = beatToX(b);
        if (x < KEY_W || x > w) continue;
        g.fillStyle = "rgba(255,255,255,0.035)";
        g.fillRect(x, 0, 1, gh);
      }
    }

    const ac = accent();
    // a channel-bound roll follows ITS OWN loop position (channels can loop at a
    // length different from the grid); the Audio-Lab roll follows the transport.
    const pos = channelId
      ? (() => {
          const b = engine.channelPosition(channelId); // -1 when not playing
          return { playing: b >= 0, beat: b < 0 ? 0 : b };
        })()
      : engine.getSequencePosition();
    g.save();
    g.beginPath();
    g.rect(KEY_W, 0, w - KEY_W, gh);
    g.clip();
    notes().forEach((n) => {
      const x = beatToX(n.start);
      const y = pitchToY(n.pitch);
      if (y < -ROW_H || y > gh) return;
      const wn = Math.max(3, n.length * v.ppb - 1.5);
      if (x + wn < KEY_W || x > w) return;
      const playing = pos.playing && pos.beat >= n.start && pos.beat < n.start + n.length;
      const selected = sel.current.has(n.id);
      g.fillStyle = ac;
      g.globalAlpha = playing ? 1 : 0.5 + n.vel * 0.4;
      g.beginPath();
      g.roundRect(x, y + 1, wn, ROW_H - 2, 2);
      g.fill();
      g.globalAlpha = 1;
      if (selected) {
        g.strokeStyle = "#ffffff";
        g.lineWidth = 1.25;
        g.beginPath();
        g.roundRect(x + 0.5, y + 1.5, wn - 1, ROW_H - 3, 2);
        g.stroke();
      } else {
        g.fillStyle = "rgba(255,255,255,0.28)";
        g.fillRect(x, y + 1, wn, 1);
      }
      // slide glyph: an amber diagonal from the PREVIOUS note's pitch (at this note's
      // start) up/down to this note's own pitch (at its end) — the bend the engine
      // will play. Orphan slide (no previous note) gets a small amber underline tag.
      if (n.slide) {
        const prev = prevNote(n);
        const yTo = y + ROW_H / 2;
        g.strokeStyle = "#e0a24f";
        g.lineWidth = 1.5;
        if (prev) {
          const yFrom = pitchToY(prev.pitch) + ROW_H / 2;
          g.beginPath();
          g.moveTo(x, yFrom);
          g.lineTo(x + wn, yTo);
          g.stroke();
          g.fillStyle = "#e0a24f";
          g.beginPath();
          g.arc(x, yFrom, 2.5, 0, Math.PI * 2);
          g.fill();
        } else {
          g.beginPath(); // orphan: no prev to bend → plays normally; mark it faintly
          g.moveTo(x, yTo + ROW_H / 2 - 1);
          g.lineTo(x + wn, yTo + ROW_H / 2 - 1);
          g.stroke();
        }
      }
    });
    // marquee box
    if (drag.current?.mode === "marquee") {
      const d = drag.current;
      const mx = Math.min(d.x0, d.x1),
        my = Math.min(d.y0, d.y1);
      g.strokeStyle = "rgba(255,255,255,0.55)";
      g.setLineDash([3, 3]);
      g.lineWidth = 1;
      g.strokeRect(mx + 0.5, my + 0.5, Math.abs(d.x1 - d.x0), Math.abs(d.y1 - d.y0));
      g.setLineDash([]);
      g.fillStyle = "rgba(255,255,255,0.05)";
      g.fillRect(mx, my, Math.abs(d.x1 - d.x0), Math.abs(d.y1 - d.y0));
    }
    if (pos.playing) {
      const px = beatToX(pos.beat);
      g.fillStyle = "#ffffff";
      g.globalAlpha = 0.85;
      g.fillRect(px, 0, 1.5, gh);
      g.globalAlpha = 1;
    }
    g.restore();

    // gutter keyboard (pitch area only)
    const held = gutterKey.current;
    const sounding = new Set(engine.activeNotes(channelId));
    g.save();
    g.beginPath();
    g.rect(0, 0, KEY_W, gh);
    g.clip();
    g.fillStyle = "#0c0c0e";
    g.fillRect(0, 0, KEY_W, gh);
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
    g.restore();
    g.fillStyle = "rgba(255,255,255,0.12)";
    g.fillRect(KEY_W - 1, 0, 1, gh);

    // ── velocity lane (docked at the bottom; shares the time axis) ──
    drawLane(g, w, gh, h, ac, pos);

    // ── HUD readout (top-right): live state of the selection's params ──
    const ids = [...sel.current];
    const rep = ids.length ? byId(ids[0]) : null;
    g.font = "9px ui-monospace, monospace";
    const lines: string[] = [];
    if (rep) {
      const vMin = Math.min(...ids.map((id) => byId(id)?.vel ?? 1));
      const vMax = Math.max(...ids.map((id) => byId(id)?.vel ?? 0));
      const velStr = Math.abs(vMax - vMin) < 0.005 ? `${Math.round(rep.vel * 127)}` : `${Math.round(vMin * 127)}–${Math.round(vMax * 127)}`;
      lines.push(`sel ${ids.length}`);
      lines.push(`note ${noteName(rep.pitch)}`);
      lines.push(`vel ${velStr}`);
      lines.push(`len ${rep.length.toFixed(2)}b`);
    } else {
      lines.push("no selection");
    }
    const pad = 6;
    let bw = 0;
    lines.forEach((l) => (bw = Math.max(bw, g.measureText(l).width)));
    const boxW = bw + pad * 2;
    const boxH = lines.length * 12 + pad * 2 - 2;
    const bx = w - boxW - 6;
    const by = 6;
    g.fillStyle = "rgba(8,8,10,0.82)";
    g.beginPath();
    g.roundRect(bx, by, boxW, boxH, 3);
    g.fill();
    g.strokeStyle = "rgba(255,255,255,0.1)";
    g.lineWidth = 1;
    g.stroke();
    lines.forEach((l, i) => {
      const isLabelVal = l.includes(" ");
      const label = isLabelVal ? l.slice(0, l.indexOf(" ")) : l;
      const val = isLabelVal ? l.slice(l.indexOf(" ") + 1) : "";
      const ty = by + pad + 8 + i * 12;
      g.fillStyle = "#5c5c66";
      g.fillText(label, bx + pad, ty);
      if (val) {
        g.fillStyle = ac;
        g.fillText(val, bx + pad + g.measureText(label + " ").width, ty);
      }
    });
  });

  // lane tab buttons (real DOM, overlaid on the canvas) — sit at the lane's top-left.
  // `bottom` = lane height minus a hair, so they hug the top edge of the lane band.
  const tabBtn = (active: boolean) =>
    "rounded-[3px] border px-[7px] py-[2px] font-mono text-[10px] leading-none transition-colors " +
    (active ? "border-accent bg-[color-mix(in_srgb,var(--accent)_22%,transparent)] text-accent" : "border-line bg-panel text-faint hover:text-dim");

  return (
    <div className="relative">
      <canvas
        ref={ref}
        tabIndex={0}
        className="w-full touch-none rounded-[3px] border border-line bg-inset outline-none select-none focus:border-line2"
        style={{ height }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
        onKeyDown={onKeyDown}
        onContextMenu={onContextMenu}
      />
      <div className="pointer-events-none absolute right-[6px] left-[4px] flex items-center gap-[4px]" style={{ bottom: (lane.open ? VEL_H : LANE_TAB_H) - 15 }}>
        <button className={"pointer-events-auto " + tabBtn(lane.mode === "vel")} onClick={() => setLane((l) => ({ ...l, mode: "vel", open: true }))} title="velocity lane">
          vel
        </button>
        <button className={"pointer-events-auto " + tabBtn(lane.mode === "vib")} onClick={() => setLane((l) => ({ ...l, mode: "vib", open: true }))} title="vibrato automation lane">
          vib
        </button>
        <button
          className="pointer-events-auto ml-auto rounded-[3px] border border-line bg-panel px-[6px] py-[2px] font-mono text-[10px] leading-none text-faint transition-colors hover:text-accent"
          onClick={() => setLane((l) => ({ ...l, open: !l.open }))}
          title={lane.open ? "collapse lane" : "expand lane"}
        >
          {lane.open ? "▾" : "▸"}
        </button>
      </div>
    </div>
  );
}

function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  const tag = (el?.tagName || "").toLowerCase();
  return tag === "input" || tag === "textarea" || !!el?.isContentEditable;
}
