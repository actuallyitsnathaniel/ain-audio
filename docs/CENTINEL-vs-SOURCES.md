# Centinel vs Auto-Tune patent / Autotalent literature

Front-to-back reading of the three sources Nathaniel flagged, mapped onto live
Centinel (`src/daw/worklets/centinel-processor.js`, build `g1l-oct`).

Interactive companion (open beside chat):
[`centinel-vs-autotune.canvas.tsx`](/Users/nate/.cursor/projects/Users-nate-Documents-development-website-ain-actuallyitsnathaniel-audio/canvases/centinel-vs-autotune.canvas.tsx).

## Strategy (locked in)

**[US5973252A](https://patents.google.com/patent/US5973252A/en) is expired** (term ended ~2018; public domain). Implement the preferred embodiment as closely as the text allows — not Autotalent/Lent as a stand-in.

**Order of work:**

1. **Patent-faithful core first** — detection mode (8:1 DS + \(E/H\) search) → correction mode (narrow-band recursive \(E/H\), quadratic period) → rate convert + ±1 `Cycle_period` insert/delete.
2. **Then refine past the patent** — Retune Speed is Decay. Humanize / Flex / Nat Vib / sticky sit **on top of** the G1 core (`g1l-oct`). Do not mix them in to chase a scorecard hole; one knob at a time.
3. **PSOLA / Fairbanks / PV** are fallbacks or optional formant paths, not the AT-matching reference. Do not gut Lent-adjacent code until a later cleanup audit (see G4).

## Open items ledger (for the next plan)

### G1 / patent E/H period track — **closed** (`g1l-oct`)
- [x] Recursive \(E/H\) detect (8:1 DS, vocal-band best trough + octave check)
- [x] Correction-mode narrow lag window (N=8), refine every 5 samples
- [x] `EH_LIVE` + `EH_DRIVE`: splice Cycle_period = `_periodSamp`
- [x] Decay = Retune Speed across notes on splice
- [x] E/H owns notes; `yinPitch` deleted
- [x] `process()` sets `_inphincTgt = 1/periodSamp` when tracking (0¢ vs period). The old “never write `_inphincTgt`” rule was for the YIN-babysitter era (p1a–e); it does not apply now.
- [x] Product pitch-law stripped so the core could be judged alone
- [x] ~14s beats AT without Flex taper (54% vs 47%)
- [x] ~20s mix actually opens (wet≈dry 85%→0%; leftover hole is nearest-note/Decay, not dry-through)
- [x] Patent octave check (DS 2L/4L) + notes follow period. YIN-era `octaveLock`/`MAX_JUMP` was shifting a correct C#4 period back up (`R*=2`) — that was the 279ms 20.76s C#5 run.

Freeze this core. Do **not** open another detector/slew/ε cut unless a listen shows the *period* is wrong.

### G2 — Cycle insert/delete
- [x] Rate-convert + ±1 cycle (formant-off, `CYCLE_SPLICE`)
- [x] Pop default `formant: 0.85` (LPC envelope copy — not PSOLA)
- [x] **Seam** (`g2a-seam`) — patent ±1 `Cycle_period` per sample (was up to 8 hard jumps) + short equal-power blend on the jump.
- [x] **Cepstral envelope** (`g2d-cep`) — lifter the log spectrum before Levinson so poles follow the throat, not the F0 comb. Same IIR copy onto splice; no STFT delay.
- [ ] Optional formant *shift* (raise/lower independently) — later

### G3 — Sticky / DC finish (on G1 core, not the old YIN stack)
- [x] **Minimal sticky** (`g3b-hyst`) — keep committed note until live is closer by 0.4 st, same-side only. No orphan, no ownedSustain, no Flex/Humanize.
- [x] Disagree dump: 6.4% was **not** 40¢ wobble. 24 frames / 279ms at 20.76s were octave (wet C#5, dry+AT C#4) — closed in `g1l-oct`. Leftover is 12ms 50¢-line neighbor ticks. Do **not** chase those with orphan / Flex / ownedSustain.
- [ ] Listen ~20s ≤15 vs AT ~46% (still 37%; scoop release is Decay, not missing hyst)
- [ ] Humanize / Flex / Nat Vib — later, one at a time

### G4 — Stay away / later
- [x] Do not merge Smuts phase vocoder into live Centinel
- [ ] **Later — Lent-adjacent cleanup audit:** do **not** gut Fairbanks/PSOLA now.
  Pop/AT path already demoted them (`CYCLE_SPLICE` + `formant:0`). Revisit whether
  Fairbanks fallback, period-PSOLA formant lane, and related gates can be slimmed,
  renamed, or isolated once formant crossfade exists and 14s/20s gaps are closed.
  Killing formant mode to “purge Lent” would be the wrong move.

## Current scorecard (`g1l-oct` = G1 octave check + notes follow period + G3 sticky)

| Metric | g1l | g3b | Goal |
|---|---|---|---|
| ≤15¢ of scale | **50.7%** | 50.6% | 53.7% |
| loose holds (15–35¢ ≥80ms) | **0** | 0 | 2 |
| listen ~14s ≤15 | **54%** | 54% | 47% |
| listen ~20s ≤15 | **37%** | 37% | 46% |
| ~20s wet≈dry | **0%** | 0% | — |
| lag dips | 26 / 1474ms | 26 / 1474 | — |
| clicks wet/dry | 19 / 21 | 20 / 21 | — |
| note-disagree | **5.3%** | 6.4% | — |
| octave disagree | **0** | 24 frames / 279ms | — |

G1 freeze: `inphinc` vs `_periodSamp` **0¢**. 14s beats AT. 20s mix opens. 21s C#5 run gone. Remaining disagree is 50¢-line neighbor ticks — leave them.

Flags: `CYCLE_SPLICE=true`, `EH_LIVE=true`, `EH_DRIVE=true`.

## Item 1 — G1 closed

| Path | Status |
|---|---|
| `EH_LIVE` / `EH_DRIVE` | ON |
| E/H sole acquire | ON — `yinPitch` deleted |
| `inphinc` from E/H | ON — `1/periodSamp` in `process()` |
| Product pitch-law | G3 sticky in progress; Flex/Humanize/orphan still parked |

`npm run centinel:eh-validate` → `.tmp_centinel/eh-validate.json`

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
| Detect | Recursive E/H, 8× DS | **E/H owns notes** (`g1l-oct`; YIN deleted; notes follow period octave) |
| Period | Continuous correction track | `_periodSamp`; `inphinc = 1/periodSamp` |
| Corrector | Rate + ±1 cycle | `CYCLE_SPLICE` (formant-off) |
| Softness | Decay | Retune Speed |
| Product | — | G3: sticky first; Humanize / Flex / Nat Vib parked |

---

## Credits

- Hildebrand — [US5973252A](https://patents.google.com/patent/US5973252A/en)
- Costello / Hildebrand — [Valhalla 2009/2016](https://valhalladsp.com/2009/05/21/auto-tune-autocorrelation-and-seismic-analysis/)
- Smuts — [Pitch Correction of Digital Audio](https://www.waltersmuts.com/Walter%20Smuts%20-%20Pitch%20Correction%20of%20Digital%20Audio.pdf)
- Live — `src/daw/worklets/centinel-processor.js`
