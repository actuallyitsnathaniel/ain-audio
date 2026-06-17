// ── Lab track descriptors ────────────────────────────────────────────────
// The Lab is one global "master track" — any entry can be loaded into it.
// A 'pair' (mix + master) gets the phase-locked A/B dry/wet dial; a 'single'
// preview plays straight through with metering. Ported from AINTRACKS.

import type { Project } from "./projects";

export interface PairTrack {
  id: string;
  kind: "pair";
  title: string;
  subtitle: string;
  mixUrl: string;
  masterUrl: string;
  lmDb: number;
  notes: string;
  art: string;
  color?: string;
  durationHint?: number;
}

export interface SingleTrack {
  id: string;
  kind: "single";
  title: string;
  subtitle: string;
  src: string;
  notes: string;
  art: string;
  color?: string;
  durationHint?: number;
}

export type Track = PairTrack | SingleTrack;

// Audio served statically from /public/audio (large binaries, runtime-fetched).
export const jlmTrack: PairTrack = {
  id: "jlm",
  kind: "pair",
  title: "Jessica Lea Mayfield",
  subtitle: "prod. Day Wave · alt grunge · mastered by AIN",
  mixUrl: "/audio/jlm-mix.m4a",
  masterUrl: "/audio/jlm-master.m4a",
  // PHASE-LOCK INVARIANT: mix + master MUST be exported sample-aligned (identical
  // start point, same length) or the A/B crossfade comb-filters. The engine starts
  // both on the same ctx sample, so any offset baked into the files plays as a fixed
  // delay. Prefer lossless (WAV/FLAC) — separate AAC encodes also drift the waveform.
  // (Jun 2026: the m4a pair measured a constant 9 ms / 397-sample offset; re-export aligned.)
  // measured offline: master is ≈ +1.7 dB RMS over the mix
  lmDb: 1.7,
  notes:
    "the mix came in sounding fantastic already — lots of guitar, sampled drums, and synths. my job was to finish it: specific-band dynamic saturation to bring up highs that were missing from the source, plus very modest punch from classic compression practices. flip the dial and listen for the air on the guitars and the front edge of the snare. hit LEVEL MATCH to compare tone instead of loudness.",
  art: "/src/assets/images/daw-art/jlm.webp",
  durationHint: 250.2,
};

export function trackForProject(p: Project): Track {
  if (p.id === "jlm") return jlmTrack;
  return {
    id: p.id,
    kind: "single",
    src: "/audio/previews/" + p.id + ".m4a",
    title: p.artist,
    subtitle: p.subtitle + " · preview",
    notes:
      p.labNotes ||
      "notes coming soon — this is where i'll share thoughts on this one.",
    art: p.art,
    color: p.color,
    durationHint: 30,
  };
}
