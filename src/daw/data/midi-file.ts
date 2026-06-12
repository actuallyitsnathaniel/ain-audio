// ── Standard MIDI File (.mid) → NoteClip ──────────────────────────────────
// A small SMF parser: reads format-0 and format-1 files, merges all tracks,
// pairs note-on/off into notes, and converts ticks → beats so the result drops
// straight into the piano roll. Tempo + time-signature meta events are read to
// derive bpmHint and beatsPerBar; clip length is rounded up to whole bars.
//
// Used by presets.ts to auto-import src/assets/presets/<id>/*.mid as a preset's
// defaultPhrase. Vite imports the file as a URL; we fetch + parse at load.

import { newNoteId, type Note, type NoteClip } from "./clips";

interface ParsedMidi {
  clip: NoteClip;
  bpm: number;
  hasTempo: boolean; // false when the file carried no tempo meta (caller should use its own hint)
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
  // variable-length quantity (7 bits per byte, high bit = continue)
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

interface RawEvent {
  tick: number;
  type: "on" | "off" | "tempo" | "timesig";
  pitch?: number;
  vel?: number;
  usPerBeat?: number;
  num?: number; // time-sig numerator
}

// Parse a single MTrk chunk's events (absolute ticks), tracking running status.
function parseTrack(r: Reader, end: number): RawEvent[] {
  const events: RawEvent[] = [];
  let tick = 0;
  let running = 0;
  while (r.pos < end) {
    tick += r.vlq();
    let status = r.u8();
    if (status < 0x80) {
      // running status: reuse last, and this byte is actually data
      r.pos -= 1;
      status = running;
    } else {
      running = status;
    }
    const hi = status & 0xf0;
    if (status === 0xff) {
      // meta event
      const meta = r.u8();
      const len = r.vlq();
      if (meta === 0x51 && len === 3) {
        const b = r.bytes(3);
        events.push({ tick, type: "tempo", usPerBeat: (b[0] << 16) | (b[1] << 8) | b[2] });
      } else if (meta === 0x58 && len >= 2) {
        const b = r.bytes(len);
        events.push({ tick, type: "timesig", num: b[0] }); // denom = 2^b[1]
      } else {
        r.skip(len);
      }
    } else if (status === 0xf0 || status === 0xf7) {
      // sysex — skip
      const len = r.vlq();
      r.skip(len);
    } else if (hi === 0x90) {
      const pitch = r.u8();
      const vel = r.u8();
      events.push({ tick, type: vel > 0 ? "on" : "off", pitch, vel });
    } else if (hi === 0x80) {
      const pitch = r.u8();
      const vel = r.u8();
      events.push({ tick, type: "off", pitch, vel });
    } else if (hi === 0xa0 || hi === 0xb0 || hi === 0xe0) {
      r.skip(2); // poly-aftertouch / control-change / pitch-bend (2 data bytes)
    } else if (hi === 0xc0 || hi === 0xd0) {
      r.skip(1); // program-change / channel-pressure (1 data byte)
    } else {
      break; // unknown — bail this track
    }
  }
  return events;
}

export function parseMidi(buf: ArrayBuffer): ParsedMidi | null {
  const r = new Reader(new DataView(buf));
  if (r.str(4) !== "MThd") return null;
  r.u32(); // header length (6)
  r.u16(); // format (0 or 1)
  const nTracks = r.u16();
  const division = r.u16();
  if (division & 0x8000) return null; // SMPTE timecode division unsupported
  const tpb = division || 480; // ticks per beat

  // gather all events across tracks (absolute ticks)
  const all: RawEvent[] = [];
  for (let t = 0; t < nTracks && !r.done; t++) {
    if (r.str(4) !== "MTrk") break;
    const len = r.u32();
    const end = r.pos + len;
    all.push(...parseTrack(r, end));
    r.pos = end;
  }
  all.sort((a, b) => a.tick - b.tick);

  // tempo + time-sig (first ones win for the hint). hasTempo lets the caller fall
  // back to its own bpmHint when the file carries no tempo (Ableton's "Export MIDI
  // Clip" omits it — tempo is a Set property, not a clip property).
  let usPerBeat = 500000; // 120 bpm default
  let beatsPerBar = 4;
  let hasTempo = false;
  for (const e of all) {
    if (e.type === "tempo" && e.usPerBeat) {
      usPerBeat = e.usPerBeat;
      hasTempo = true;
      break;
    }
  }
  for (const e of all) {
    if (e.type === "timesig" && e.num) {
      beatsPerBar = e.num;
      break;
    }
  }
  const bpm = Math.round(60000000 / usPerBeat);

  // pair note-on → note-off (FIFO per pitch)
  const open: Record<number, { tick: number; vel: number }[]> = {};
  const notes: Note[] = [];
  let lastTick = 0;
  for (const e of all) {
    if (e.pitch == null) continue;
    lastTick = Math.max(lastTick, e.tick);
    if (e.type === "on") {
      (open[e.pitch] = open[e.pitch] || []).push({ tick: e.tick, vel: e.vel ?? 100 });
    } else if (e.type === "off") {
      const stack = open[e.pitch];
      const started = stack && stack.shift();
      if (started) {
        const start = started.tick / tpb;
        const length = Math.max(0.0625, (e.tick - started.tick) / tpb);
        notes.push({ id: newNoteId(), pitch: e.pitch, start, length, vel: clampVel(started.vel / 127) });
      }
    }
  }
  if (!notes.length) return null;

  // ── auto-trim leading/trailing space ──
  // Ableton's "Export MIDI Clip" writes the clip's full span incl. empty space
  // before the first note and after the last. Shift the earliest note to beat 0
  // (trim the lead) and round the clip length up to whole bars from the last
  // note-off (trim the tail). Right for short loopable phrases; a deliberate
  // pickup would be snapped to the downbeat, which is the intended trade-off.
  const firstStart = Math.min(...notes.map((n) => n.start));
  if (firstStart > 1e-6) notes.forEach((n) => (n.start -= firstStart));

  const lastBeat = notes.reduce((m, n) => Math.max(m, n.start + n.length), 0);
  const bars = Math.max(1, Math.ceil(lastBeat / beatsPerBar - 1e-6));
  return { clip: { bars, beatsPerBar, notes }, bpm, hasTempo };
}

const clampVel = (v: number) => Math.min(1, Math.max(0.05, Math.round(v * 100) / 100));
