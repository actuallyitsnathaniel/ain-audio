// ── Standard MIDI File (.mid) → NoteClip ──────────────────────────────────
// SMF format 0/1: merges tracks, pairs note-on/off, converts ticks → beats.
// Also captures CC1 (mod), pitch bend, and channel pressure into AutoLanes so
// protocol data the studio can use is preserved (not just notes).
//
// Used by presets.ts and studio timeline drop (`engine.importMidiFile`).

import {
  newNoteId,
  type AutoLane,
  type AutoPoint,
  type Note,
  type NoteClip,
} from "./clips";

export interface ParsedMidi {
  clip: NoteClip;
  bpm: number;
  hasTempo: boolean;
  /** True when the file carried CC / bend / pressure we mapped into autos. */
  hasExpression: boolean;
}

// ── byte reader ──
class Reader {
  private p = 0;
  constructor(private d: DataView) {}
  u8() {
    return this.d.getUint8(this.p++);
  }
  u16() {
    const v = this.d.getUint16(this.p);
    this.p += 2;
    return v;
  }
  u32() {
    const v = this.d.getUint32(this.p);
    this.p += 4;
    return v;
  }
  bytes(n: number) {
    const out: number[] = [];
    for (let i = 0; i < n; i++) out.push(this.u8());
    return out;
  }
  vlq() {
    let v = 0;
    for (;;) {
      const b = this.u8();
      v = (v << 7) | (b & 0x7f);
      if (!(b & 0x80)) break;
    }
    return v;
  }
  str(n: number) {
    return this.bytes(n)
      .map((c) => String.fromCharCode(c))
      .join("");
  }
  skip(n: number) {
    this.p += n;
  }
  get pos() {
    return this.p;
  }
  set pos(v: number) {
    this.p = v;
  }
  get done() {
    return this.p >= this.d.byteLength;
  }
}

type RawEvent =
  | { tick: number; type: "on" | "off"; pitch: number; vel: number }
  | { tick: number; type: "tempo"; usPerBeat: number }
  | { tick: number; type: "timesig"; num: number }
  | { tick: number; type: "cc"; cc: number; val: number }
  | { tick: number; type: "bend"; val: number } // 0..1, 0.5 = center
  | { tick: number; type: "pressure"; val: number }; // 0..1

function parseTrack(r: Reader, end: number): RawEvent[] {
  const events: RawEvent[] = [];
  let tick = 0;
  let running = 0;
  while (r.pos < end) {
    tick += r.vlq();
    let status = r.u8();
    if (status < 0x80) {
      r.pos -= 1;
      status = running;
    } else {
      running = status;
    }
    const hi = status & 0xf0;
    if (status === 0xff) {
      const meta = r.u8();
      const len = r.vlq();
      if (meta === 0x51 && len === 3) {
        const b = r.bytes(3);
        events.push({
          tick,
          type: "tempo",
          usPerBeat: (b[0]! << 16) | (b[1]! << 8) | b[2]!,
        });
      } else if (meta === 0x58 && len >= 2) {
        const b = r.bytes(len);
        events.push({ tick, type: "timesig", num: b[0]! });
      } else {
        r.skip(len);
      }
    } else if (status === 0xf0 || status === 0xf7) {
      const len = r.vlq();
      r.skip(len);
    } else if (hi === 0x90) {
      const pitch = r.u8();
      const vel = r.u8();
      events.push({
        tick,
        type: vel > 0 ? "on" : "off",
        pitch,
        vel,
      });
    } else if (hi === 0x80) {
      const pitch = r.u8();
      const vel = r.u8();
      events.push({ tick, type: "off", pitch, vel });
    } else if (hi === 0xa0) {
      r.u8(); // poly aftertouch pitch — unused for now
      const val = r.u8() / 127;
      events.push({ tick, type: "pressure", val });
    } else if (hi === 0xb0) {
      const cc = r.u8();
      const val = r.u8();
      events.push({ tick, type: "cc", cc, val });
    } else if (hi === 0xe0) {
      const lo = r.u8();
      const hiB = r.u8();
      const raw14 = (hiB << 7) | lo;
      events.push({ tick, type: "bend", val: raw14 / 16383 });
    } else if (hi === 0xc0) {
      r.skip(1); // program change — not mapped yet
    } else if (hi === 0xd0) {
      const val = r.u8() / 127;
      events.push({ tick, type: "pressure", val });
    } else {
      break;
    }
  }
  return events;
}

function downsampleLane(
  points: AutoPoint[],
  maxPts = 256,
): AutoPoint[] {
  if (points.length <= maxPts) return points;
  const out: AutoPoint[] = [];
  const step = (points.length - 1) / (maxPts - 1);
  for (let i = 0; i < maxPts; i++) {
    const idx = Math.min(points.length - 1, Math.round(i * step));
    out.push(points[idx]!);
  }
  return out;
}

export function parseMidi(buf: ArrayBuffer): ParsedMidi | null {
  const r = new Reader(new DataView(buf));
  if (r.str(4) !== "MThd") return null;
  r.u32();
  r.u16();
  const nTracks = r.u16();
  const division = r.u16();
  if (division & 0x8000) return null;
  const tpb = division || 480;

  const all: RawEvent[] = [];
  for (let t = 0; t < nTracks && !r.done; t++) {
    if (r.str(4) !== "MTrk") break;
    const len = r.u32();
    const end = r.pos + len;
    all.push(...parseTrack(r, end));
    r.pos = end;
  }
  all.sort((a, b) => a.tick - b.tick);

  let usPerBeat = 500000;
  let beatsPerBar = 4;
  let hasTempo = false;
  for (const e of all) {
    if (e.type === "tempo") {
      usPerBeat = e.usPerBeat;
      hasTempo = true;
      break;
    }
  }
  for (const e of all) {
    if (e.type === "timesig") {
      beatsPerBar = e.num;
      break;
    }
  }
  const bpm = Math.round(60000000 / usPerBeat);

  const open: Record<number, { tick: number; vel: number }[]> = {};
  const notes: Note[] = [];
  const modPts: AutoPoint[] = [];
  const bendPts: AutoPoint[] = [];
  const pressPts: AutoPoint[] = [];

  for (const e of all) {
    if (e.type === "on" || e.type === "off") {
      if (e.type === "on") {
        (open[e.pitch] = open[e.pitch] || []).push({
          tick: e.tick,
          vel: e.vel,
        });
      } else {
        const stack = open[e.pitch];
        const started = stack && stack.shift();
        if (started) {
          const start = started.tick / tpb;
          const length = Math.max(0.0625, (e.tick - started.tick) / tpb);
          notes.push({
            id: newNoteId(),
            pitch: e.pitch,
            start,
            length,
            vel: clampVel(started.vel / 127),
          });
        }
      }
      continue;
    }
    if (e.type === "cc" && e.cc === 1) {
      modPts.push({ beat: e.tick / tpb, value: e.val / 127 });
    } else if (e.type === "cc" && (e.cc === 11 || e.cc === 7)) {
      // expression / channel volume → also into mod lane as a useful stand-in
      modPts.push({ beat: e.tick / tpb, value: e.val / 127 });
    } else if (e.type === "bend") {
      bendPts.push({ beat: e.tick / tpb, value: e.val });
    } else if (e.type === "pressure") {
      pressPts.push({ beat: e.tick / tpb, value: e.val });
    }
  }
  if (!notes.length) return null;

  const firstStart = Math.min(...notes.map((n) => n.start));
  if (firstStart > 1e-6) {
    notes.forEach((n) => (n.start -= firstStart));
    const shift = (pts: AutoPoint[]) => {
      for (const p of pts) p.beat = Math.max(0, p.beat - firstStart);
    };
    shift(modPts);
    shift(bendPts);
    shift(pressPts);
  }

  const lastBeat = notes.reduce((m, n) => Math.max(m, n.start + n.length), 0);
  const bars = Math.max(1, Math.ceil(lastBeat / beatsPerBar - 1e-6));

  const autos: AutoLane[] = [];
  // pressure → vibrato depth curve (audible with existing vib engine)
  if (pressPts.length)
    autos.push({
      target: "vibrato",
      points: downsampleLane(pressPts),
      intensity: 1,
    });
  if (modPts.length)
    autos.push({ target: "mod", points: downsampleLane(modPts) });
  if (bendPts.length)
    autos.push({ target: "bend", points: downsampleLane(bendPts) });

  return {
    clip: {
      bars,
      beatsPerBar,
      notes,
      autos: autos.length ? autos : undefined,
    },
    bpm,
    hasTempo,
    hasExpression: autos.length > 0,
  };
}

const clampVel = (v: number) =>
  Math.min(1, Math.max(0.05, Math.round(v * 100) / 100));
