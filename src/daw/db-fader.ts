// ── dB fader taper ────────────────────────────────────────────────────────────
// Maps a normalized fader position p∈[0,1] to a linear gain, with a musically useful
// curve: UNITY (0 dB) sits at p = UNITY_POS (¾ travel), +MAX_DB at the top, and the
// bottom third curves down to MIN_DB then hard-zero at p = 0 (−∞). This gives fine
// control around unity and a natural fade to silence — like a real console fader.
//
// Two segments, both LINEAR IN dB (so equal travel = equal dB, the pro-fader feel):
//   p ∈ [UNITY_POS, 1] : 0 dB → +MAX_DB
//   p ∈ (0, UNITY_POS) : MIN_DB → 0 dB
//   p = 0              : −∞ (silence)

export const MAX_DB = 6;
export const MIN_DB = -60;
export const UNITY_POS = 0.75;
const db2lin = (db: number) => Math.pow(10, db / 20);
export const lin2db = (g: number) => (g > 1e-6 ? 20 * Math.log10(g) : -Infinity);

// fader position (0..1) → dB (−Infinity at 0)
export function posToDb(p: number): number {
  p = Math.min(1, Math.max(0, p));
  if (p <= 0) return -Infinity;
  if (p >= UNITY_POS) return (MAX_DB * (p - UNITY_POS)) / (1 - UNITY_POS);
  return MIN_DB * (1 - p / UNITY_POS);
}
// fader position (0..1) → linear gain (the stored track/master vol)
export function posToGain(p: number): number {
  const db = posToDb(p);
  return db === -Infinity ? 0 : db2lin(db);
}
// linear gain → fader position (inverse of posToGain), for rendering the stored value
export function gainToPos(g: number): number {
  if (g <= 0) return 0;
  const db = lin2db(g);
  if (db >= 0) return UNITY_POS + (db / MAX_DB) * (1 - UNITY_POS);
  return Math.max(0, UNITY_POS * (1 - db / MIN_DB));
}
// a dB peak level (−∞..~+6) → normalized meter fill height, same taper as the fader
// so the meter reads directly against the fader scale
export function dbToMeter(db: number): number {
  if (!isFinite(db)) return 0;
  return Math.min(1, Math.max(0, gainToPos(db2lin(db))));
}
// format a dB value for the readout: "−∞", "0.0", "+3.2", "−12.4"
export function fmtDb(db: number): string {
  if (!isFinite(db)) return "−∞";
  const r = Math.round(db * 10) / 10;
  return (r > 0 ? "+" : r < 0 ? "−" : "") + Math.abs(r).toFixed(1);
}
