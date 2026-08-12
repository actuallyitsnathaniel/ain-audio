# Centinel vs Auto-Tune patent / Autotalent literature

Front-to-back reading of the three sources Nathaniel flagged, mapped onto live
Centinel (`src/daw/worklets/centinel-processor.js`, build era `p2b-soft-land`).

Interactive companion (open beside chat):
[`centinel-vs-autotune.canvas.tsx`](/Users/nate/.cursor/projects/Users-nate-Documents-development-website-ain-actuallyitsnathaniel-audio/canvases/centinel-vs-autotune.canvas.tsx).

## Strategy (locked in)

**[US5973252A](https://patents.google.com/patent/US5973252A/en) is expired** (term ended ~2018; public domain). Implement the preferred embodiment as closely as the text allows — not Autotalent/Lent as a stand-in.

**Order of work:**

1. **Patent-faithful core first** — detection mode (8:1 DS + \(E/H\) search) → correction mode (narrow-band recursive \(E/H\), quadratic period) → rate convert + ±1 `Cycle_period` insert/delete.
2. **Then refine past the patent** — Retune Speed / Humanize / Flex / Nat Vib / sticky/orphan on top. Keep what beats dry_2→AT goal.
3. **PSOLA / Fairbanks / PV** are fallbacks or optional formant paths, not the AT-matching reference.

## Open items ledger (for the next plan)

### G1 / patent E/H period track
- [x] Recursive \(E/H\) detect (8:1 DS, vocal-band best trough + octave check)
- [x] Correction-mode narrow lag window (N=8), refine every 5 samples
- [x] Live without poisoning audio (`EH_LIVE`) — must **not** write `_inphincTgt` (p1a–e bug: process copies tgt→inphinc every sample)
- [x] `EH_DRIVE`: splice uses `_periodSamp` (neutral/slight win vs YIN pe @ p1h)
- [ ] E/H as sole acquire (no YIN seed) without regressing notes
- [ ] Drive R*/`inphinc` from E/H Cycle_period (patent-faithful); today YIN owns note sticky + R*
- [x] Soft Retune (`Decay`) across notes on splice (`_softRatioChase`, p2)
- [ ] E/H-only acquire / R* drive — see **Item 1 review** below

### G2 — Cycle insert/delete
- [x] Rate-convert + ±1 cycle (formant-off, `CYCLE_SPLICE`)
- [x] Pop default `formant: 0` (render preset + chip + fx defaults)
- [x] vs Fairbanks @ f0: note-disagree **10%→~3%**
- [x] Center ≤15¢ **46%→51.1%** (goal ~54%) via soft Decay + tighter center chase (p2)
- [ ] Crossfade splice ↔ PSOLA on formant automation
- [ ] Listen pass vs AT goal
- [ ] loose_runs 7→2; dip_ms back from 0

### G3 — Sticky / DC finish
- [ ] ~6s A↔B scoop wrong-note latency (note-disagree still ~3%)
- [ ] ~10s sharp park / DC finish (center still ~2.6 pts shy of goal)
- [ ] Orphan/sticky timing vs modern AT

### G4 — Stay away
- [x] Do not merge Smuts phase vocoder into live Centinel

## Current scorecard (`p2b-soft-land`, pop = splice + soft Decay)

| Metric | p1-patent-core | **p2b** | goal |
|---|---|---|---|
| ≤15¢ | 46.4% | **51.1%** | ~54% |
| note-disagree | 2.5% | 3.0% | — |
| dry✓/wet✗ | 13 | 21 | — |
| loose runs | 11 | **7** | 2 |
| shake | 0.21 | 0.26 | — |

Flags: `CYCLE_SPLICE=true`, `EH_LIVE=true`, `EH_DRIVE=true` (splice pe only).

## Item 1 review — E/H-only / R* drive (do not flip yet)

| Path | Status | Evidence |
|---|---|---|
| `EH_LIVE` (shadow `_periodSamp`) | **ON — safe** | Must not write `_inphincTgt` (p1a–e poison) |
| `EH_DRIVE` (splice Cycle_period) | **ON — neutral** | p1h ≈ p1g on scorecard |
| E/H as sole acquire (no YIN seed) | **NOT ready** | p1a pure-E/H notes: disagree ~12%, ≤15¢ ~38% |
| Drive R*/`inphinc` from E/H | **NOT ready** | Same; YIN sticky + R* still owns musical decisions |

**Verdict:** Keep YIN for notes/R*. Next E/H work should be *validation* (log `|periodSamp − 1/inphinc|` vs dry_2) before any drive flip — not another blind `EH_DRIVE` expansion. Soft Decay + center chase bought more AT-match than E/H-as-detector did.

---

## Sources (read in full)

| # | Source | What it actually is |
|---|---|---|
| 1 | [US5973252A](https://patents.google.com/patent/US5973252A/en) — Hildebrand, filed 1997, issued 1999 | **The Auto-Tune patent.** Autocorrelation pitch lock + period-accurate resampling with **whole-cycle insert/delete**. |
| 2 | [Walter Smuts — Pitch Correction of Digital Audio (UCT, 2018)](https://www.waltersmuts.com/Walter%20Smuts%20-%20Pitch%20Correction%20of%20Digital%20Audio.pdf) | Student thesis. Surveys Auto-Tune / Autotalent; implements own ZCR/autocorr + OLA/PV. |
| 3 | [Valhalla DSP — Auto-Tune, autocorrelation, and seismic analysis](https://valhalladsp.com/2009/05/21/auto-tune-autocorrelation-and-seismic-analysis/) (2009 + **2016 Hildebrand email**) | Autotalent-era narrative mis-attributed Lent/PSOLA to Auto-Tune; Hildebrand clarifies. |

**Naming trap:** Smuts PDF ≠ Autotalent source. Centinel Fairbanks was Autotalent-lineage; patent corrector is cycle splice.

---

## What the Auto-Tune patent specifies

### Pitch detection — continuous autocorrelation

\[
E_i(L) = E_{i-1}(L) + x_i^2 - x_{i-2L}^2,\quad
H_i(L) = H_{i-1}(L) + x_i x_{i-L} - x_{i-L} x_{i-2L}
\]
\[
E_i(L) - 2H_i(L) \le \varepsilon\, E_i(L)
\]

**Detection mode:** anti-alias + 8:1 DS; search \(L\in[2,110]\); octave check; seed N=8 full-rate window.  
**Correction mode:** update E/H every sample in narrow band; refine ~every 5 samples; fail → re-detect.

### Pitch correction — rate convert + ±1 cycle

`Resample_Raw_Rate = Cycle_period / desired_Cycle_period`, smoothed by `Decay`. Advance output pointer by rate; on overrun/underrun ± exactly one `Cycle_period`. Explicitly rejects FFT OLA and Lent.

### Centinel map (p1)

| Layer | Patent | Centinel now |
|---|---|---|
| Detect | Recursive E/H, 8× DS | E/H live + YIN seed/notes |
| Period | Continuous correction track | `_periodSamp` (EH); splice via `EH_DRIVE` |
| Corrector | Rate + ±1 cycle | `CYCLE_SPLICE` (formant-off) |
| Softness | Decay | Retune Speed (within-note on splice; cross-note = open) |
| Product | — | Humanize / Flex / Nat Vib / sticky |

---

## Credits

- Hildebrand — [US5973252A](https://patents.google.com/patent/US5973252A/en)
- Costello / Hildebrand — [Valhalla 2009/2016](https://valhalladsp.com/2009/05/21/auto-tune-autocorrelation-and-seismic-analysis/)
- Smuts — [Pitch Correction of Digital Audio](https://www.waltersmuts.com/Walter%20Smuts%20-%20Pitch%20Correction%20of%20Digital%20Audio.pdf)
- Live — `src/daw/worklets/centinel-processor.js`
