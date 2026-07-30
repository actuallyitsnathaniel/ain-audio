/** Shared spectral FX visualization frames (worklet → main → canvas). */

export const SPECTRAL_VIZ_BINS = 48;

export type FxVizKind = "impartialer" | "speccomp" | "eq";

/**
 * Latest analysis snapshot for a spectral / EQ device.
 * Mutated in place by the worklet port listener or EQ tick — read from rAF.
 *
 * impartialer: `a` = dry mag, `b` = wet mag (0..1, log-binned)
 * speccomp:    `a` = band envelope (0..1), `b` = GR amount (0..1)
 * eq:          `a` = input spectrum (0..1, log-binned), `b` unused
 */
export interface FxVizSlot {
  kind: FxVizKind;
  n: number;
  a: Float32Array;
  b: Float32Array;
  gen: number;
}

export function createFxVizSlot(kind: FxVizKind, bins = SPECTRAL_VIZ_BINS): FxVizSlot {
  return {
    kind,
    n: 0,
    a: new Float32Array(bins),
    b: new Float32Array(bins),
    gen: 0,
  };
}

/** Apply a worklet `{ type:"viz", n, a, b }` message into a slot. */
export function ingestFxVizMessage(
  slot: FxVizSlot,
  data: { n?: number; a?: ArrayLike<number>; b?: ArrayLike<number> },
): void {
  const n = Math.max(0, Math.min(slot.a.length, data.n ?? 0));
  if (n <= 0 || !data.a || !data.b) return;
  for (let i = 0; i < n; i++) {
    slot.a[i] = data.a[i] ?? 0;
    slot.b[i] = data.b[i] ?? 0;
  }
  slot.n = n;
  slot.gen = (slot.gen + 1) | 0;
}
