// ── Drum kits + step-sequence clip ────────────────────────────────────────
// A kit is a set of named lanes (kick/snare/hat/…). Each lane plays either a
// bounced one-shot (auto-discovered from src/assets/kits/<kitId>/<lane>.m4a,
// like presets) or, until you bounce one, an engine-synthesized drum so the
// beat-maker works immediately. The SequenceClip is the 16-step grid the
// scheduler walks, sharing the Phase-2 clock.

import type { MidiChannel } from "./clips";

export type DrumSynth = "kick" | "snare" | "hat" | "clap" | "tom" | "rim";

export interface DrumLane {
  id: string; // stable lane id, also the sample filename stem
  name: string; // short display label
  synth: DrumSynth; // fallback synth voice when no sample is bounced
  url?: string; // resolved one-shot URL (set at build time if a file exists)
}

export interface DrumKit {
  id: string;
  name: string;
  lanes: DrumLane[];
}

// A loopable melodic sample — a sustained loop layered alongside the drums,
// playbackRate-matched to the grid tempo. Auto-discovered from src/assets/loops/.
export interface LoopLane {
  id: string; // filename stem
  name: string; // display label (prettified id)
  url: string; // resolved sample URL
  rootBpm: number; // tempo the loop was recorded at (for playbackRate match)
  rootKnown?: boolean; // true if rootBpm is a REAL known tempo (filename token / disk).
  // false/undefined = a guess (load-time grid tempo); locking adopts the current tempo
  // as the root so the lock itself is pitch-neutral and only later tempo moves warp it.
  bars: number; // its length in bars
  key?: string; // detected musical key / chord (e.g. "Am", "F#", "Cmaj7"), user-editable
}

// ── filename metadata parser (shared by build-time LOOPS + runtime addLoop) ──
// Pulls tempo / bar-count / key out of a filename stem and returns a cleaned name.
// Tokens are bounded by separators (start/end or space . _ -) so we don't grab the
// "A" inside a word or the "90" inside "90s".
//   tempo: explicit "128bpm" (high confidence), else a bare 2–3 digit run in 40–300
//   key:   root + optional accidental + optional quality (Am, F#m, Cmaj7, Bbsus2…)
//   bars:  "<n>bar"/"<n>bars"
const SEP = "(?:^|[\\s._-])"; // a leading separator
const SEPE = "(?=$|[\\s._-])"; // a trailing separator (lookahead, non-consuming)
const KEY_RE = new RegExp(SEP + "([A-G])([#b♯♭]?)(maj7|maj|min|m|aug|dim|sus2|sus4|sus|add\\d|°)?(\\d{0,2})" + SEPE);
export interface LoopMeta {
  name: string;
  bpm?: number; // undefined when nothing plausible was found
  bars?: number;
  key?: string;
}
export function parseLoopMeta(stem: string): LoopMeta {
  const bpmExplicit = /(\d{2,3})\s*bpm/i.exec(stem);
  const barTok = new RegExp("(\\d{1,2})\\s*bars?" + SEPE, "i").exec(stem);
  // bare-number bpm fallback: a separator-bounded 2–3 digit run in a musical range
  let bpmBare: number | undefined;
  if (!bpmExplicit) {
    const re = new RegExp(SEP + "(\\d{2,3})(?![\\d]|\\s*(?:bars?|bit|khz|hz))" + SEPE, "gi");
    for (let m = re.exec(stem); m; m = re.exec(stem)) {
      const n = parseInt(m[1], 10);
      if (n >= 40 && n <= 300) {
        bpmBare = n;
        break;
      }
    }
  }
  const bpm = bpmExplicit ? parseInt(bpmExplicit[1], 10) : bpmBare;

  const keyM = KEY_RE.exec(stem);
  let key: string | undefined;
  if (keyM) {
    const qual = keyM[3] === "m" ? "m" : keyM[3] || "";
    key = keyM[1] + (keyM[2] || "").replace("♯", "#").replace("♭", "b") + qual + (keyM[4] || "");
  }

  // strip the recognised tokens from the display name
  let name = stem;
  if (bpmExplicit) name = name.replace(bpmExplicit[0], " ");
  else if (bpmBare != null) name = name.replace(new RegExp(SEP + bpmBare + SEPE, "i"), " ");
  if (barTok) name = name.replace(barTok[0], " ");
  if (key && keyM) name = name.replace(keyM[0], " ");
  name = name.replace(/[-_.]+/g, " ").replace(/\s+/g, " ").trim();

  return { name, bpm, bars: barTok ? parseInt(barTok[1], 10) : undefined, key };
}

// per-loop mixer state, keyed by loop id.
export interface LoopState {
  on: boolean; // layered in?
  level: number; // 0–1 gain
  mute: boolean;
  solo: boolean;
  sync?: boolean; // locked to grid tempo (playbackRate = bpm/rootBpm)? off = original speed
  a?: number; // loop region start, fraction 0..1 of the buffer (default 0 = whole loop)
  b?: number; // loop region end, fraction 0..1 of the buffer (default 1)
}

// per-lane step arrays live in SequenceClip keyed by lane id.
export interface SequenceClip {
  steps: number; // 16
  beatsPerBar: number; // 4 → 16 steps = 1 bar of 1/16s
  bpm: number;
  swing: number; // 0–0.7, shifts odd 1/16s later
  on: Record<string, boolean[]>; // laneId → per-step on/off
  accent: Record<string, boolean[]>; // laneId → per-step accent (louder hit)
  loops: Record<string, LoopState>; // loopId → mixer state
  laneMix: Record<string, { mute: boolean; solo: boolean }>; // drum laneId → mute/solo
  channels: MidiChannel[]; // melodic MIDI channels, played on the same clock
}

// ── lane definitions for the default kit ──
const DEFAULT_LANES: DrumLane[] = [
  { id: "kick", name: "kick", synth: "kick" },
  { id: "snare", name: "snare", synth: "snare" },
  { id: "hat", name: "hat", synth: "hat" },
  { id: "clap", name: "clap", synth: "clap" },
  { id: "tom", name: "tom", synth: "tom" },
];

// ── auto-discover bounced one-shots (mirrors presets.ts) ──
// Drop src/assets/kits/<kitId>/<laneId>.m4a and that lane plays the real sample.
const KIT_FILES = import.meta.glob("/src/assets/kits/**/*.{m4a,flac,ogg,wav}", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

const KIT_EXT_RE = /\.(m4a|flac|ogg|wav)$/i;

// kitId → (laneId → url)
const sampleMap: Record<string, Record<string, string>> = {};
for (const path in KIT_FILES) {
  const parts = path.split("/");
  const file = parts[parts.length - 1];
  const kitId = parts[parts.length - 2];
  const laneId = file.replace(KIT_EXT_RE, "");
  (sampleMap[kitId] = sampleMap[kitId] || {})[laneId] = KIT_FILES[path];
}

function withSamples(kitId: string, lanes: DrumLane[]): DrumLane[] {
  const m = sampleMap[kitId] || {};
  return lanes.map((l) => (m[l.id] ? { ...l, url: m[l.id] } : l));
}

export const DEFAULT_KIT: DrumKit = {
  id: "house",
  name: "house",
  lanes: withSamples("house", DEFAULT_LANES),
};

// A second kit sharing the same lane ids (so patterns/saves remap cleanly) but a
// different synth voicing — boom-bap leans on the rim/tom side. Synth-only until
// real one-shots are dropped under src/assets/kits/boombap/.
const BOOMBAP_LANES: DrumLane[] = [
  { id: "kick", name: "kick", synth: "kick" },
  { id: "snare", name: "snare", synth: "snare" },
  { id: "hat", name: "hat", synth: "hat" },
  { id: "clap", name: "rim", synth: "rim" },
  { id: "tom", name: "tom", synth: "tom" },
];

export const BOOMBAP_KIT: DrumKit = {
  id: "boombap",
  name: "boom bap",
  lanes: withSamples("boombap", BOOMBAP_LANES),
};

export const KITS: DrumKit[] = [DEFAULT_KIT, BOOMBAP_KIT];

// ── auto-discover loopable melodic samples ──
// Drop src/assets/loops/<name>.m4a. Encode tempo + length in the filename so the
// engine can sync it: "<name>-<rootBpm>bpm-<bars>bar.m4a" (e.g. dusty-keys-120bpm-2bar.m4a).
// Missing tokens default to 120 bpm / 1 bar, or use LOOP_OVERRIDES below.
const LOOP_FILES = import.meta.glob("/src/assets/loops/**/*.{m4a,flac,ogg,wav}", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

interface LoopOverride {
  name?: string;
  rootBpm?: number;
  bars?: number;
  key?: string;
}
const LOOP_OVERRIDES: Record<string, LoopOverride> = {
  // "dusty-keys": { name: "dusty keys", rootBpm: 120, bars: 2, key: "Am" },
};

export const LOOPS: LoopLane[] = Object.keys(LOOP_FILES)
  .map((path) => {
    const file = path.split("/").pop()!;
    const stem = file.replace(KIT_EXT_RE, "");
    const meta = parseLoopMeta(stem);
    const id = (meta.name || "loop").toLowerCase().replace(/\s+/g, "-");
    const ov = LOOP_OVERRIDES[id] || {};
    const bpm = ov.rootBpm ?? meta.bpm;
    return {
      id,
      name: ov.name || meta.name || id,
      url: LOOP_FILES[path],
      rootBpm: bpm ?? 120, // last-resort default; rootKnown stays false so lock re-bases
      rootKnown: ov.rootBpm != null || meta.bpm != null, // a real tempo from override/filename
      bars: ov.bars ?? meta.bars ?? 1,
      key: ov.key ?? meta.key,
    };
  })
  .sort((a, b) => a.name.localeCompare(b.name));

// ── auto-discover reverb impulse responses ──
// Drop src/assets/irs/<name>.wav and it appears in the REVERB device's IR selector
// (loadReverbIR swaps it in). Empty folder → selector shows only the synth IR.
const IR_FILES = import.meta.glob("/src/assets/irs/*.{wav,flac,m4a,ogg}", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

export interface ReverbIR {
  id: string; // filename stem
  name: string; // prettified display label
  url: string;
}

const prettyId = (id: string) => id.replace(/[-_]+/g, " ").trim();

export const IRS: ReverbIR[] = Object.keys(IR_FILES)
  .map((path) => {
    const stem = path.split("/").pop()!.replace(KIT_EXT_RE, "");
    return { id: stem, name: prettyId(stem), url: IR_FILES[path] };
  })
  .sort((a, b) => a.name.localeCompare(b.name));

// ── starter beat (a simple four-on-the-floor + backbeat groove) ──
const STEPS = 16;
const row = (...idx: number[]) => {
  const a = new Array(STEPS).fill(false);
  idx.forEach((i) => (a[i] = true));
  return a;
};
const empty = () => new Array(STEPS).fill(false);

// allowed grid lengths — multiples of 16 so each block is a whole bar of 1/16s
export const STEP_COUNTS = [16, 32, 48, 64] as const;

// grow with `false` / shrink by slice, preserving existing steps
export const resizeRow = (arr: boolean[] | undefined, n: number): boolean[] => {
  const a = (arr || []).slice(0, n);
  while (a.length < n) a.push(false);
  return a;
};

export function defaultSequence(kit: DrumKit = DEFAULT_KIT): SequenceClip {
  const on: Record<string, boolean[]> = {};
  const accent: Record<string, boolean[]> = {};
  const laneMix: Record<string, { mute: boolean; solo: boolean }> = {};
  kit.lanes.forEach((l) => {
    on[l.id] = empty();
    accent[l.id] = empty();
    laneMix[l.id] = { mute: false, solo: false };
  });
  // a usable groove out of the box
  on.kick = row(0, 4, 8, 12);
  on.snare = row(4, 12);
  on.hat = row(2, 6, 10, 14);
  on.clap = row(12);
  accent.kick = row(0, 8);
  accent.snare = row(4);
  // loop mixer state — off by default, unity level
  const loops: Record<string, LoopState> = {};
  LOOPS.forEach((l) => (loops[l.id] = { on: false, level: 0.8, mute: false, solo: false }));
  return { steps: STEPS, beatsPerBar: 4, bpm: 120, swing: 0, on, accent, loops, laneMix, channels: [] };
}
