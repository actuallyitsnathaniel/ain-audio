// ── Clip split — partition a clip's content at a local beat ───────────────────
// Splitting a clip at timeline beat B means: local split point p = B - clip.startBeat.
// The left half spans [startBeat, B) with length p; the right half spans [B, end) with
// length (len - p). This returns the two CONTENT halves (the caller sets positions).
// Per-kind slicing:
//   midi/drum-notes — partition notes by start; right-half starts shift back by p.
//   drum-pattern    — split the step arrays at the step nearest p.
//   audio           — both halves reference the same buffer; the right half's play
//                     offset (a) advances by the fraction of content p consumed. Looping
//                     clips just re-hash from each half's own start (Ableton-ish).

import type { NoteClip } from "./clips";
import { newNoteId } from "./clips";
import type { SequenceClip } from "./kits";
import type { ClipContent } from "./arrangement";

const STEP_BEATS = 0.25;

function splitNotes(clip: NoteClip, p: number): [NoteClip, NoteClip] {
  const left: NoteClip["notes"] = [];
  const right: NoteClip["notes"] = [];
  for (const n of clip.notes) {
    if (n.start < p - 1e-9) {
      // clamp a note that straddles the cut so it ends at p
      const len = Math.min(n.length, p - n.start);
      left.push({ ...n, id: newNoteId(), length: Math.max(0.01, len) });
    } else {
      right.push({ ...n, id: newNoteId(), start: n.start - p });
    }
  }
  const bpb = clip.beatsPerBar;
  const lc: NoteClip = { bars: Math.max(1, Math.ceil(p / bpb)), beatsPerBar: bpb, notes: left };
  return [lc, { bars: Math.max(1, Math.ceil(1 / bpb)), beatsPerBar: bpb, notes: right }];
}

function splitPattern(pat: SequenceClip, p: number): [SequenceClip, SequenceClip] {
  const cut = Math.round(p / STEP_BEATS); // step index of the cut
  const sliceRow = (row: boolean[] | undefined, from: number, to: number) => {
    const out: boolean[] = [];
    for (let i = from; i < to; i++) out.push(!!row?.[i]);
    return out;
  };
  const mk = (from: number, to: number): SequenceClip => {
    const steps = Math.max(1, to - from);
    const on: Record<string, boolean[]> = {};
    const accent: Record<string, boolean[]> = {};
    for (const id in pat.on) on[id] = sliceRow(pat.on[id], from, from + steps);
    for (const id in pat.accent) accent[id] = sliceRow(pat.accent[id], from, from + steps);
    return { ...pat, steps, on, accent };
  };
  return [mk(0, cut), mk(cut, pat.steps)];
}

// audio: right half starts `fracConsumed` deeper into the played region [a,b].
function splitAudio(cc: Extract<ClipContent, { kind: "audio" }>, p: number, len: number): [ClipContent, ClipContent] {
  const a = cc.a ?? 0;
  const b = cc.b ?? 1;
  const frac = len > 0 ? Math.min(0.999, Math.max(0, p / len)) : 0;
  const mid = a + frac * (b - a); // buffer fraction reached at the cut
  const left: ClipContent = { ...cc, a, b: mid };
  const right: ClipContent = { ...cc, a: mid, b };
  return [left, right];
}

// Split a clip's content at local beat p (0 < p < len). Returns [left, right] content.
export function splitContent(content: ClipContent, p: number, len: number): [ClipContent, ClipContent] {
  if (content.kind === "midi") {
    const [l, r] = splitNotes(content.clip, p);
    return [{ kind: "midi", clip: l }, { kind: "midi", clip: r }];
  }
  if (content.kind === "drum") {
    // notes are the source of truth when present → split those; else split the pattern
    if (content.notes) {
      const [ln, rn] = splitNotes(content.notes, p);
      const [lp, rp] = splitPattern(content.pattern, p);
      return [
        { kind: "drum", pattern: lp, notes: ln },
        { kind: "drum", pattern: rp, notes: rn },
      ];
    }
    const [lp, rp] = splitPattern(content.pattern, p);
    return [{ kind: "drum", pattern: lp }, { kind: "drum", pattern: rp }];
  }
  return splitAudio(content, p, len);
}
