// ── Drum kits + step-sequence clip ────────────────────────────────────────
// A kit is a set of named lanes (kick/snare/hat/…). Each lane plays either a
// bounced one-shot (auto-discovered from src/assets/kits/<kitId>/<lane>.m4a,
// like presets) or, until you bounce one, an engine-synthesized drum so the
// beat-maker works immediately. The SequenceClip is the 16-step grid the
// scheduler walks, sharing the Phase-2 clock.

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
  bars: number; // its length in bars
}

// per-loop mixer state, keyed by loop id.
export interface LoopState {
  on: boolean; // layered in?
  level: number; // 0–1 gain
  mute: boolean;
  solo: boolean;
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
}
const LOOP_OVERRIDES: Record<string, LoopOverride> = {
  // "dusty-keys": { name: "dusty keys", rootBpm: 120, bars: 2 },
};

const loopPretty = (id: string) => id.replace(/[-_]+/g, " ").trim();

export const LOOPS: LoopLane[] = Object.keys(LOOP_FILES)
  .map((path) => {
    const file = path.split("/").pop()!;
    const stem = file.replace(KIT_EXT_RE, "");
    const bpmTok = /(\d+)\s*bpm/i.exec(stem);
    const barTok = /(\d+)\s*bar/i.exec(stem);
    // id = stem with the bpm/bar tokens stripped
    const id = stem
      .replace(/[-_]?\d+\s*bpm/i, "")
      .replace(/[-_]?\d+\s*bar/i, "")
      .replace(/[-_]+$/g, "")
      .trim();
    const ov = LOOP_OVERRIDES[id] || {};
    return {
      id,
      name: ov.name || loopPretty(id),
      url: LOOP_FILES[path],
      rootBpm: ov.rootBpm ?? (bpmTok ? parseInt(bpmTok[1], 10) : 120),
      bars: ov.bars ?? (barTok ? parseInt(barTok[1], 10) : 1),
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

export const IRS: ReverbIR[] = Object.keys(IR_FILES)
  .map((path) => {
    const stem = path.split("/").pop()!.replace(KIT_EXT_RE, "");
    return { id: stem, name: loopPretty(stem), url: IR_FILES[path] };
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

export function defaultSequence(kit: DrumKit = DEFAULT_KIT): SequenceClip {
  const on: Record<string, boolean[]> = {};
  const accent: Record<string, boolean[]> = {};
  kit.lanes.forEach((l) => {
    on[l.id] = empty();
    accent[l.id] = empty();
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
  return { steps: STEPS, beatsPerBar: 4, bpm: 120, swing: 0, on, accent, loops };
}
