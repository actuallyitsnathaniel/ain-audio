# Centinel vs Auto-Tune patent / Autotalent literature

Front-to-back reading of the three sources Nathaniel flagged, mapped onto live
Centinel (`src/daw/worklets/centinel-processor.js`, build `g4a-env`).

Interactive companions (open beside chat):
[`centinel-vs-autotune.canvas.tsx`](/Users/nate/.cursor/projects/Users-nate-Documents-development-website-ain-actuallyitsnathaniel-audio/canvases/centinel-vs-autotune.canvas.tsx)
· [`centinel-pipeline.canvas.tsx`](/Users/nate/.cursor/projects/Users-nate-Documents-development-website-ain-actuallyitsnathaniel-audio/canvases/centinel-pipeline.canvas.tsx).

## Strategy (locked in)

**[US5973252A](https://patents.google.com/patent/US5973252A/en) is expired** (term ended ~2018; public domain). Implement the preferred embodiment as closely as the text allows — not Autotalent/Lent as a stand-in.

**Order of work:**

1. **Patent-faithful core first** — detection mode (8:1 DS + \(E/H\) search) → correction mode (narrow-band recursive \(E/H\), quadratic period) → rate convert + ±1 `Cycle_period` insert/delete.
2. **Then refine past the patent** — Retune Speed is Decay. Humanize / Flex / Nat Vib / sticky sit **on top of** the G1 core (`g1l-oct`). Do not mix them in to chase a scorecard hole; one knob at a time.
3. **PSOLA / Fairbanks / PV** are fallbacks (`CYCLE_SPLICE=false`), not the AT-matching reference. Pop formant LPC post is **parked**. Do not gut Lent-adjacent code until a later cleanup audit (see G4).

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
- [x] Pop default `formant: 0.85` — LPC post **parked** (`g2f`; chewed on transitions)
- [x] **Seam** (`g2a-seam`) — patent ±1 `Cycle_period` per sample (was up to 8 hard jumps) + short equal-power blend on the jump.
- [x] **One path** (`g2e-wire`) — splice output *is* the signal. `rate=1` ≡ dry (same N2 tap). No parallel latency-dry×shifted-wet (cold-start double pitch). Mix knob is the only blend.
- [x] **Untracked** (`g2g-untrk`) — consonant / smear: rate=1, keep sticky. No last-lock retune.
- [x] **Body vs room** (`g2h-body`) — analysis HP + 2L preference so reflection delays don't own `Cycle_period`. Splice still reads the wet take (not a dereverb).
- [x] **Join align** (`g2i-join`) — ±1 cycle, phase-aligned to the current tap.
- [x] **Envelope post** (`g4a-env`) — LPC preserve after splice; settled `|R*|` + voiced only. Knob is amount. IIR stays warm at amt=0.
- [ ] Optional formant *shift* (raise/lower independently) — later

### G3 — Sticky / DC finish (on G1 core, not the old YIN stack)
- [x] **Minimal sticky** (`g3b-hyst`) — keep committed note until live is closer by 0.4 st, same-side only. No orphan, no ownedSustain, no Flex/Humanize.
- [x] Disagree dump: 6.4% was **not** 40¢ wobble. 24 frames / 279ms at 20.76s were octave (wet C#5, dry+AT C#4) — closed in `g1l-oct`. Leftover is 12ms 50¢-line neighbor ticks. Do **not** chase those with orphan / Flex / ownedSustain.
- [x] **Splice re-arm** (`g3c-rearm`) — pop formant is 0.85 (LPC parked). The old `!formantOn` splice-ready gate never fired, so every post-gap re-arm sat on `rate=1` until `ONSET_UNITY_MAX_MS` (~260ms). That was the 20s dry-through (g2i wet≈dry 61%). Exit unity at 18ms whenever splice owns the path; seed R* from committed want; do not pin want to `lockedDet` on splice.
- [x] **Product knobs** (`g3d-knobs`) — Humanize (Decay stretch on-center), Flex island (0 = always pull), Nat Vib (0 = leave), DC finish (stationary loose park). Scoop-toward past-mid sticky flip. No orphan / midzone / hold clocks.
- [x] **Commit-fast land** (`g3e-land`) — 40ms @ 8ms after sticky flip so the new note lands. Global ≤15 **beats AT** (54.2% vs 53.6%). ~20s 44% vs 46% — leave the last 2 pts. Do not chase with orphan.

### G4 — Formant post / stay away
- [x] Do not merge Smuts phase vocoder into live Centinel
- [x] **LPC preserve** (`g4a-env`) — after splice, settled `|R*|` only. Not a second shifter.
- [ ] Optional formant *shift* (`1/R` pole warp / throat) — after preserve does not chew
- [ ] **Later — Lent-adjacent cleanup audit:** do **not** gut Fairbanks/PSOLA now.
  Pop/AT path already demoted them (`CYCLE_SPLICE` + `formant:0`). Revisit whether
  Fairbanks fallback, period-PSOLA formant lane, and related gates can be slimmed,
  renamed, or isolated once formant crossfade exists and 14s/20s gaps are closed.
  Killing formant mode to “purge Lent” would be the wrong move.

## Current scorecard (`g4a-env`; G1 freeze was `g1l-oct`)

| Metric | g4a | g3e | Goal |
|---|---|---|---|
| ≤15¢ of scale | **53.8%** | 54.2% | 53.7% |
| loose holds (15–35¢ ≥80ms) | **1** | 1 | 2 |
| listen ~14s ≤15 | **60%** | 59% | 47% |
| listen ~20s ≤15 | **41%** | 44% | 46% |
| clicks wet/dry | 20 / 21 | 20 / 21 | — |

LPC preserve is gated off mid-glide; ¢ is not the pass bar. Ears on transitions. Clicks unchanged vs g3e.

Flags: `CYCLE_SPLICE=true`, `EH_LIVE=true`, `EH_DRIVE=true`.

## Item 1 — G1 closed

| Path | Status |
|---|---|
| `EH_LIVE` / `EH_DRIVE` | ON |
| E/H sole acquire | ON — `yinPitch` deleted |
| `inphinc` from E/H | ON — `1/periodSamp` in `process()` |
| Product pitch-law | G3 sticky only; Flex/Humanize/orphan parked |

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
| Detect | Recursive E/H, 8× DS | **E/H owns notes** (`g1l-oct`); analysis HP + 2L body (`g2h`) |
| Period | Continuous correction track | `_periodSamp`; `inphinc = 1/periodSamp` |
| Corrector | Rate + ±1 cycle | `CYCLE_SPLICE` (one path; `rate=1` ≡ dry; ±pe aligned `g2i`) |
| Formant | Rejected Lent | LPC preserve after splice, settled `|R*|` only (`g4a-env`) |
| Softness | Decay | Retune Speed |
| Product | — | G3: sticky + Humanize / Flex / Nat Vib / DC finish / commit-fast land. Orphan parked |

---

## Credits

- Hildebrand — [US5973252A](https://patents.google.com/patent/US5973252A/en)
- Costello / Hildebrand — [Valhalla 2009/2016](https://valhalladsp.com/2009/05/21/auto-tune-autocorrelation-and-seismic-analysis/)
- Smuts — [Pitch Correction of Digital Audio](https://www.waltersmuts.com/Walter%20Smuts%20-%20Pitch%20Correction%20of%20Digital%20Audio.pdf)
- Live — `src/daw/worklets/centinel-processor.js`
