/** Shared spectral FX visualization frames (worklet → main → canvas). */

export const SPECTRAL_VIZ_BINS = 96;

export type FxVizKind =
  | "impartialer"
  | "speccomp"
  | "eq"
  | "centinel"
  | "cliplim"
  | "comp";

/**
 * Latest analysis snapshot for a spectral / EQ device.
 * Mutated in place by the worklet port listener or EQ tick — read from rAF.
 *
 * impartialer: `a`/`b` = dry / (adjusted×strength) mags (0..1);
 *              `xa`/`xb` = log-freq peak centers 0..1 for each bin (argmax inside the bin)
 *              so RTA can place dry vs wet at true frequencies — not the same column.
 * speccomp:    `a` = dry band envelope (−60..0 → 0..1), `b` = GR amount (0..1 ≈ 0..24 dB)
 * eq:          `a` = input spectrum (0..1 over analyser −90..−10);
 *              `b` = dyn engagement flash per bin (0..1);
 *              `xa[0..EQ_MAX_BANDS)` = live per-band gains incl. dynamics (dB);
 *              `xb` = absolute spectrum dB per bin (analyser scale)
 * centinel:    `a`/`b` = scrolling detected / target MIDI (norm 0..1 over C2–C6);
 *              `xa` = hard-snapped MIDI (Autotalent Fairbanks path);
 *              `xa` = corrected output pitch history
 * cliplim:     `a`/`b` = scrolling input / output peak history (0..1 linear)
 * comp:        `a` = scrolling gain reduction (0..1 ≈ 0..24 dB)
 */
export interface FxVizSlot {
  kind: FxVizKind;
  n: number;
  a: Float32Array;
  b: Float32Array;
  /** Log-frequency 0..1 of the strongest FFT bin inside each viz column (dry). */
  xa: Float32Array;
  /** Log-frequency 0..1 of the strongest FFT bin inside each viz column (wet). */
  xb: Float32Array;
  gen: number;
}

export function createFxVizSlot(kind: FxVizKind, bins = SPECTRAL_VIZ_BINS): FxVizSlot {
  return {
    kind,
    n: 0,
    a: new Float32Array(bins),
    b: new Float32Array(bins),
    xa: new Float32Array(bins),
    xb: new Float32Array(bins),
    gen: 0,
  };
}

/** Apply a worklet `{ type:"viz", n, a, b, xa?, xb? }` message into a slot. */
export function ingestFxVizMessage(
  slot: FxVizSlot,
  data: {
    n?: number;
    a?: ArrayLike<number>;
    b?: ArrayLike<number>;
    xa?: ArrayLike<number>;
    xb?: ArrayLike<number>;
  },
): void {
  const n = Math.max(0, Math.min(slot.a.length, data.n ?? 0));
  if (n <= 0 || !data.a || !data.b) return;
  for (let i = 0; i < n; i++) {
    slot.a[i] = data.a[i] ?? 0;
    slot.b[i] = data.b[i] ?? 0;
    // fall back to bin center if worklet didn't send peak positions yet
    const fallback = (i + 0.5) / n;
    slot.xa[i] = data.xa ? (data.xa[i] ?? fallback) : fallback;
    slot.xb[i] = data.xb ? (data.xb[i] ?? fallback) : fallback;
  }
  slot.n = n;
  slot.gen = (slot.gen + 1) | 0;
}
