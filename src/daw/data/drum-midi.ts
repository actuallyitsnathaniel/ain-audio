// ── Drum ↔ MIDI bridge ────────────────────────────────────────────────────────
// A drum clip can be edited as a step grid OR a piano roll. In the roll, each kit
// lane maps to a MIDI pitch so on/off steps become real notes (with variable length,
// off-grid timing, per-note velocity). Lane index i → pitch DRUM_BASE + i (36 = kick,
// GM-ish), so the roll's rows read bottom-up as the kit's lanes.

import type { DrumKit } from "./kits";
import type { Note, NoteClip } from "./clips";
import type { SequenceClip } from "./kits";
import { newNoteId } from "./clips";

export const DRUM_BASE = 36; // MIDI pitch of the first (lowest) kit lane

// lane id ↔ MIDI pitch, given a kit's lane order
export function laneToPitch(kit: DrumKit, laneId: string): number {
  const i = kit.lanes.findIndex((l) => l.id === laneId);
  return DRUM_BASE + (i < 0 ? 0 : i);
}
export function pitchToLane(kit: DrumKit, pitch: number): string | null {
  const i = pitch - DRUM_BASE;
  return i >= 0 && i < kit.lanes.length ? kit.lanes[i].id : null;
}
// pitch → the kit lane's display name (for the roll's key labels); null if off-kit
export function pitchLaneName(kit: DrumKit, pitch: number): string | null {
  const i = pitch - DRUM_BASE;
  return i >= 0 && i < kit.lanes.length ? kit.lanes[i].name : null;
}

const STEP_BEATS = 0.25; // 1/16

// step pattern → note clip: every "on" step becomes a 1/16 note at its lane's pitch.
// accent → higher velocity. This is the seed when you first open a step clip in the roll.
export function patternToNotes(pat: SequenceClip, kit: DrumKit): NoteClip {
  const notes: Note[] = [];
  for (const lane of kit.lanes) {
    const on = pat.on[lane.id];
    if (!on) continue;
    const pitch = laneToPitch(kit, lane.id);
    const acc = pat.accent[lane.id] || [];
    for (let s = 0; s < pat.steps; s++) {
      if (!on[s]) continue;
      notes.push({ id: newNoteId(), pitch, start: s * STEP_BEATS, length: STEP_BEATS, vel: acc[s] ? 1 : 0.7 });
    }
  }
  const bars = Math.max(1, Math.ceil((pat.steps * STEP_BEATS) / pat.beatsPerBar));
  return { bars, beatsPerBar: pat.beatsPerBar, notes };
}

// note clip → step pattern: quantise each note to the nearest 1/16, light that lane's
// step, velocity ≥ 0.85 → accent. Off-grid detail is LOST (the step grid can't hold it);
// that's the expected lossy direction (roll → grid). Notes off the kit are dropped.
export function notesToPattern(clip: NoteClip, kit: DrumKit, steps: number): SequenceClip {
  const on: Record<string, boolean[]> = {};
  const accent: Record<string, boolean[]> = {};
  for (const lane of kit.lanes) {
    on[lane.id] = Array(steps).fill(false);
    accent[lane.id] = Array(steps).fill(false);
  }
  for (const n of clip.notes) {
    const laneId = pitchToLane(kit, n.pitch);
    if (!laneId) continue; // note isn't on a kit lane
    const s = Math.round(n.start / STEP_BEATS);
    if (s < 0 || s >= steps) continue;
    on[laneId][s] = true;
    if (n.vel >= 0.85) accent[laneId][s] = true;
  }
  return { steps, beatsPerBar: clip.beatsPerBar, bpm: 120, swing: 0, on, accent, loops: {}, laneMix: {}, channels: [] };
}

// Does the note detail on (lane, step) exceed what the step grid can show? The grid can
// only represent: one hit, exactly on the 1/16 grid, one 1/16 long, at normal/accent
// velocity. Anything beyond that is a "discrepancy" the sequencer flags with a hatch:
//   · off-grid   — a note near this step but not exactly on it
//   · length     — a note not ~one step long
//   · multi      — more than one note landing in this step
//   · velocity   — velocity that isn't ~0.7 (normal) or ~1.0 (accent)
export function stepDiscrepancy(notes: NoteClip, kit: DrumKit, laneId: string, step: number): boolean {
  const pitch = laneToPitch(kit, laneId);
  const center = step * STEP_BEATS;
  let hits = 0;
  for (const n of notes.notes) {
    if (n.pitch !== pitch) continue;
    // does this note belong to this step's cell? (nearest-step quantisation)
    if (Math.round(n.start / STEP_BEATS) !== step) continue;
    hits++;
    if (Math.abs(n.start - center) > 0.001) return true; // off-grid
    if (Math.abs(n.length - STEP_BEATS) > 0.001) return true; // non-1/16 length
    if (Math.abs(n.vel - 0.7) > 0.05 && Math.abs(n.vel - 1) > 0.05) return true; // mid velocity
  }
  return hits > 1; // multiple hits collapsed into one cell
}

// Reconcile a grid edit against the lossless notes WITHOUT nuking off-grid detail. The
// grid `pat` is the on-grid truth the user just edited; for each (lane, step): if the
// grid has it ON but no note lands in that cell, add an on-grid note (accent→vel); if the
// grid has it OFF but a note is there, remove that cell's notes. Notes that already match
// the grid (including off-grid ones whose cell is still ON) are left untouched — so
// toggling one step never disturbs a nudged/held hit elsewhere.
export function reconcileGridEdit(prev: NoteClip, pat: SequenceClip, kit: DrumKit): NoteClip {
  const kept: Note[] = [];
  // index prev notes by (pitch, step-cell)
  const cellHas = new Set<string>();
  for (const n of prev.notes) {
    const laneId = pitchToLane(kit, n.pitch);
    if (!laneId) { kept.push(n); continue; } // off-kit note: leave it
    const s = Math.round(n.start / STEP_BEATS);
    if (s < 0 || s >= pat.steps) { kept.push(n); continue; } // outside the grid window: not the grid's to delete
    const cellOn = pat.on[laneId]?.[s];
    if (cellOn) { kept.push(n); cellHas.add(laneId + ":" + s); } // grid still wants this cell → keep the note
    // else: grid turned this cell off → drop the note
  }
  // add on-grid notes for grid cells that are ON but had no surviving note
  for (const lane of kit.lanes) {
    const on = pat.on[lane.id];
    if (!on) continue;
    const acc = pat.accent[lane.id] || [];
    const pitch = laneToPitch(kit, lane.id);
    for (let s = 0; s < pat.steps; s++) {
      if (!on[s] || cellHas.has(lane.id + ":" + s)) continue;
      kept.push({ id: newNoteId(), pitch, start: s * STEP_BEATS, length: STEP_BEATS, vel: acc[s] ? 1 : 0.7 });
    }
  }
  const bars = Math.max(1, Math.ceil((pat.steps * STEP_BEATS) / pat.beatsPerBar));
  return { bars, beatsPerBar: pat.beatsPerBar, notes: kept };
}
