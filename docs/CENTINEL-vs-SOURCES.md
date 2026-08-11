# Centinel vs Auto-Tune patent / Autotalent literature

Front-to-back reading of the three sources Nathaniel flagged, mapped onto live
Centinel (`src/daw/worklets/centinel-processor.js`, build era `g2a-cycle-splice`).

## Strategy (locked in)

**[US5973252A](https://patents.google.com/patent/US5973252A/en) is expired** (term ended ~2018; public domain). We are free to implement the preferred embodiment as closely as the text allows — not Autotalent/Lent as a stand-in.

**Order of work:**

1. **Patent-faithful core first** — detection mode (8:1 DS + \(E/H\) search) → correction mode (narrow-band recursive \(E/H\), quadratic period) → rate convert + ±1 `Cycle_period` insert/delete. Match the math/figures before inventing.
2. **Then refine past the patent** — our Retune Speed / Humanize / Flex / Nat Vib / sticky/orphan sit *on top* of that core. Keep what beats dry_2→AT goal; drop what fights it.
3. **PSOLA / Fairbanks / PV** are fallbacks or optional formant paths, not the AT-matching reference.

Half-measures (YIN-hop + Autotalent OLA + “vibes of the patent”) are what left us pitchy. Faithful core, then product layer.

## Open items ledger (for the next plan)

Unfinished / deferred per gap — do not treat as done just because code exists.

### G1 — Continuous period refine
- [x] Scaffolding: narrow-band DF refine → `_periodSamp`
- [ ] `TRACK_DRIVE=true` without regressing g3 (≤15¢ ~50.8%, note-disagree ~10%)
- [ ] True recursive patent \(E/H\) (h1a recursive attempt failed offline)
- [ ] Drive R*/`inphinc` from tracked period in lockstep with note sticky
- [ ] Mid-hop refine without ever touching `_analysisRms` when drive is on

### G2 — Cycle insert/delete corrector
- [x] Prototype rate-convert + ±1 `Cycle_period` (formant-off, `CYCLE_SPLICE`)
- [x] Apples-to-apples win vs Fairbanks @ `--formant=0` (note-disagree 10%→2.5%)
- [ ] Pop chip still defaults `formant=1` (PSOLA) — not yet the AT-matching default
- [ ] Soft Retune across notes on splice path (today formant-off = within-note only)
- [ ] Center ≤15¢ on splice+f0 still ~46% vs pop/PSOLA ~51% and goal ~54%
- [ ] Period source still hop YIN/`inphinc`, not G1 continuous track
- [ ] Crossfade / handoff splice ↔ PSOLA when formant automation moves
- [ ] Listen pass vs AT goal (metrics ≠ ears)

### G3 — Sticky / DC finish (untouched this pass)
- [ ] ~6s A↔B scoop wrong-note latency
- [ ] ~10s sharp park / DC finish
- [ ] Orphan/sticky timing vs modern AT

### G4 — Stay away
- [x] Confirmed: do not merge Smuts phase vocoder into live Centinel

Interactive companion (open beside chat):
`canvases/centinel-vs-autotune.canvas.tsx` in the Cursor projects folder for this workspace.

---

## Sources (read in full)

| # | Source | What it actually is |
|---|---|---|
| 1 | [US5973252A](https://patents.google.com/patent/US5973252A/en) — Hildebrand, filed 1997, issued 1999 | **The Auto-Tune patent.** Autocorrelation pitch lock + period-accurate resampling with **whole-cycle insert/delete**. |
| 2 | [Walter Smuts — Pitch Correction of Digital Audio (UCT, 2018)](https://www.waltersmuts.com/Walter%20Smuts%20-%20Pitch%20Correction%20of%20Digital%20Audio.pdf) | Student thesis. **Surveys** Auto-Tune / Autotalent / Smule; **implements its own** ZCR/autocorr + OLA/phase-vocoder system. Appendix B references Autotalent’s flow diagram. |
| 3 | [Valhalla DSP — Auto-Tune, autocorrelation, and seismic analysis](https://valhalladsp.com/2009/05/21/auto-tune-autocorrelation-and-seismic-analysis/) (2009 + **2016 Hildebrand email correction**) | Peripheral but decisive: public Autotalent-era narrative mis-attributed Lent/PSOLA to Auto-Tune; Hildebrand clarifies the real corrector. |

**Important naming trap:** Smuts’s PDF is *not* Tom Baran’s Autotalent paper/source. Autotalent appears there as a surveyed open-source system (autocorr + PSOLA + experimental formants). Centinel’s Fairbanks path is Autotalent-lineage; Auto-Tune’s patented corrector is a different shifter.

---

## 1. What the Auto-Tune patent actually specifies

### Pitch detection — continuous autocorrelation, not FFT

Hildebrand rejects zero-crossing, peak, threshold, and multi-estimate schemes that hang on one waveform attribute. He also rejects FFT overlap-and-save as a *corrector* (block-constant pitch, windowing distortion).

Core test (recursive, per prospective period \(L\)):

\[
E_i(L) = E_{i-1}(L) + x_i^2 - x_{i-2L}^2
\]
\[
H_i(L) = H_{i-1}(L) + x_i x_{i-L} - x_{i-L} x_{i-2L}
\]
\[
E_i(L) - 2H_i(L) \le \varepsilon\, E_i(L)
\]

- \(E\): energy over **two periods** (ACF at lag 0).
- \(H\): ACF at lag \(L\).
- Near-equality only when \(L\) is a true repetition period.
- \(\varepsilon\) (“eps”) user 0…0.40 — looser = more tolerant of cycle-shape change (maps conceptually to our **tracking** / confidence).

**Detection mode (pitch unknown):**

1. Anti-alias + **8:1 downsample**.
2. Search \(L \in [2,110]\) on downsampled data → ~50 Hz … ~2.7 kHz @ 44.1 kHz.
3. Local min of \(E-2H\) satisfying the threshold; second min for missing-fundamental / octave.
4. Seed a small full-rate lag window (\(N=8\)) around the found period.

**Correction / tracking mode (pitch known):**

- Update \(E/H\) every sample in a **narrow lag band**.
- Every ~5 samples: find min, quadratic refine period, slide the lag window as pitch moves.
- Fail (energy / rate-of-change / threshold) → fall back to detection, pass-through rate = 1.

Claimed: period lock “within a few cycles,” often before the note is audible.

### Pitch correction — rate convert + repeat/drop whole cycles

Patent objects to Lent: Lent windows and recombines **without** true resampling; spectra get “augmented” → unnatural.

Preferred embodiment:

1. `Resample_Raw_Rate = Cycle_period / desired_Cycle_period`
2. Smooth with user **Decay** ∈ [0,1] (0 = instant Cher lock; →1 = gradual) → `Resample_Rate1`
3. Optional vibrato modulates rate → `Resample_Rate2`
4. Advance output pointer by rate each sample:
   - rate > 1 (sharper): when output catches input → **subtract one `Cycle_period`** → **repeat a cycle**
   - rate < 1 (flatter): when output lags → **add one `Cycle_period`** → **drop a cycle**
5. Interpolate input at the fractional output address.

This is **period-synchronous cycle splicing with continuous period knowledge**, not FFT and not Lent grain PSOLA.

### Target pitch

- Nearest note of a musical scale, **or**
- MIDI note-on (+ pitch bend).

### Vibrato

LFO on the resample rate after Decay smoothing (depth / rate / onset). Product-era Natural Vibrato (scale existing vibrato) is a later control-law layer; the patent describes an additive vibrato path.

---

## 2. What Hildebrand clarified in 2016 (Valhalla)

Sean Costello’s 2009 post correctly noted that Time Magazine oversold “FFT from oil,” that autocorrelation pitch detection long predates Auto-Tune, and that Lent (1989) / PSOLA is the usual *formant-preserving* shifter family. He initially assumed Auto-Tune = Lent + better detection.

**Hildebrand’s emailed correction (reprinted 2016):**

> No, I don’t use the Lent algorithm: way too imprecise. … The math in the patent is absolutely precise to what I do. But that math is used continuously to track pitch as well. I always know exactly what the pitch is. I run a simple rate converter from that point and when I have to repeat a cycle (going sharper) or delete a cycle (going flatter) I can because I know exactly what the period is at every instant.

So the public “Auto-Tune = PSOLA” story is **wrong**. The patent math is both detector *and* continuous period tracker; the corrector is cycle insert/delete on a rate converter.

---

## 3. What Smuts (2018) contributes — and what it doesn’t

### Survey (useful)

- History: Chipmunk → Eventide Harmonizer → Hildebrand/Antares → Cher → Autotalent → Smule.
- Autotalent (Baran) as he describes it: **autocorrelation detect + confidence**, pitch-manipulation block, **PSOLA** shifter, cubic resample, **experimental formant** pre/post filters.
- Auto-Tune patent summarized as “modified autocorr + Lent” — **repeat of the patent’s Lent citations; superseded by Hildebrand’s 2016 clarification.**

### Own implementation (not our lineage)

Smuts builds Octave: ZCR or autocorr detect → 12-TET nearest + Schmitt → **OLA or Ellis phase vocoder**. Best combo ZCR+PV: pitch improvement **4.38×**, similarity **44%**. He concludes it is **not** robust on non-cherry-picked vocals and recommends SOLA next — i.e. he never reaches Autotalent/AT-quality time-domain splicing.

**Takeaway for Centinel:** treat Smuts as a map of the design space and a warning that **phase vocoder “wins” student metrics ≠ commercial Auto-Tune**. Do not adopt his PV path for Centinel.

---

## 4. Where Centinel sits

Live Centinel pipeline:

```
YIN f0 (win 1024 / hop 256)
  → stays_locked + hysteretic hold (+ midzone / orphan fast paths)
  → sticky scale/MIDI tgt + Flex-Tune / amount want
  → R* = hz(audibleWant) / hz(lockedDet)   [do-no-harm clamp]
  → Fairbanks OLA resample   OR   period-PSOLA grain place
     (phasein/phaseout period insert-delete; latency N/2 = 1024)
```

| Layer | Patent Auto-Tune | Autotalent (as surveyed) | Centinel now | Verdict |
|---|---|---|---|---|
| Detector family | Recursive \(E-2H\) ACF, 8× DS search, N=8 track | Autocorr (+ confidence) | **YIN / CMNDF** | **Partial** — same lag-domain idea, different estimator |
| Continuous period | Yes — track every instant | Per-hop detect | YIN every 256 smp; lockedDet EMA | **Behind** on continuous period |
| Corrector | Rate convert + **±1 cycle** pointer | PSOLA + spline | Fairbanks OLA **or** period PSOLA | **Divergent from patent**; **closer to Autotalent** |
| Formants | Implicit (cycle splice keeps shape) | Experimental filters | Fairbanks moves formants; PSOLA preserves period shape | **Partial** (no throat model) |
| Target | Nearest scale / MIDI | Scale + confidence soften | Scale / MIDI-follow + sticky/hyst/orphan | **Ahead** on sticky machinery; **aligned** on targets |
| Softness | Decay on rate | (product Retune Speed later) | Retune Speed + Humanize + soft-land | **Aligned** in product semantics |
| Nat Vib | Patent: LFO on rate | — | Scale existing vibrato residual | **Ahead** of patent; matches modern AT UX |
| Flex-Tune | Not in ’97 patent | — | flexCorrectionStrength island | **Product-era** (we have it) |
| Latency | Unstated (sample ISR) | Plugin-typical | **N/2 = 1024** (~21 ms @ 48 kHz) | Explicit / Autotalent-like |
| FFT / PV | Explicitly rejected | Autotalent avoids; Smuts uses PV | **Not in live path** | **Aligned with patent** |

---

## 5. Gaps that explain remaining “pitchiness”

Ranked by how directly the sources implicate them:

### G1 — Continuous period refine (HIGH) — scaffolding in `h1g-track-gated`

Patent: period known “at every instant” via sliding \(E/H\).  
Centinel now has correction-mode machinery (narrow-band DF refine around locked τ → `_periodSamp`). Attempts to **drive** `inphinc`/R* from it (h1a–h1e) regressed dry_2 vs AT vs `g3` (≤15¢ down to 37–48%, note-disagree up). Mid-hop `_readMonoWindow` also polluted `_analysisRms`.

`TRACK_DRIVE = false` (default): audio path matches `g3` (≤15¢ ~50.8%, note-disagree ~10%). Flip the flag to experiment; don’t ship drive until it beats that baseline.

**Still open:** beat g3 with TRACK_DRIVE; true recursive E/H; G2 cycle splice; G3 sticky.

### G2 — Cycle insert/delete (HIGH) — prototype ON in `g2a-cycle-splice`

Patent: resample + repeat/drop **exactly one measured cycle**.  
Centinel formant-off + `CYCLE_SPLICE`: delay-line rate convert; when delay leaves `N2±pe`, ± one period. Fairbanks remains fallback if `CYCLE_SPLICE=false`. Formant≥0.5 still PSOLA.

**Offline dry_2 @ formant=0 (same control law):**

| | Fairbanks | Cycle splice |
|---|---|---|
| ≤15¢ | 45.9% | 46.2% |
| note-disagree | 10.0% | **2.5%** |
| dry✓/wet✗ | 146 | **12** |
| shake | 0.222 | 0.209 |

**Still open:** see ledger above (pop still formant=1; center tightness; G1 period; soft cross-note).

### G3 — Control law is ahead of the patent, still behind modern AT UX (MED)

We already have Retune Speed, Humanize (sustain stretch, gated ≤8¢), Flex-Tune, Nat Vib leave, sticky/midzone/orphan. Patent only has Decay + vibrato LFO + nearest/MIDI.

Remaining pitchiness after g3 is often **sticky timing** and **DC finish**, not missing knobs — orphan-sticky helped note-disagree (10.7%→10.0%) but A↔B scoops still lag tens of ms.

### G4 — Smuts/PV is a dead end for us (LOW / avoid)

His best lab result used phase vocoder. Patent rejects FFT/OLA-save quality; SPECTRAL.md already parked YIN+PV as smear, not Centinel. Do not re-merge.

---

## 6. Ahead / behind scorecard (honest)

**Ahead of the ’97 patent (product layer):**

- Humanize, Flex-Tune, Natural Vibrato (leave/flatten/amplify), Input Type bands, MIDI-follow, confidence wet gate, cold-start / commit-soft, do-no-harm clamp, transport reset.

**Behind the patent (core DSP):**

- Continuous recursive ACF period track vs hop YIN.
- Cycle-accurate insert/delete corrector vs Fairbanks/PSOLA grain engines.

**Aligned:**

- Time-domain, monophonic, scale/MIDI target, soft rate toward target, no live FFT.

**Closer to Autotalent than to Auto-Tune on the shifter** — that mismatch is the structural gap the sources expose.

---

## 7. Recommended reconcile order (no new knobs)

1. **Continuous period refine** around locked \(L\) (patent correction mode) — keep YIN for acquisition if needed.
2. **Cycle insert/delete corrector** prototype (formant-off / pop default) driven by that period.
3. Keep sticky/orphan/Humanize/Flex work — it sits on top of whatever shifter we use.
4. Leave PSOLA as optional formant mode; don’t use it as the AT-matching reference path.
5. Do not adopt Smuts phase vocoder.

---

## Credits / links

- Hildebrand, H. A. — [US5973252A](https://patents.google.com/patent/US5973252A/en)
- Costello, S. / Hildebrand email — [Valhalla DSP, 2009/2016](https://valhalladsp.com/2009/05/21/auto-tune-autocorrelation-and-seismic-analysis/)
- Smuts, W. — [Pitch Correction of Digital Audio](https://www.waltersmuts.com/Walter%20Smuts%20-%20Pitch%20Correction%20of%20Digital%20Audio.pdf) (UCT 2018)
- Live Centinel — `src/daw/worklets/centinel-processor.js`; architecture notes in `src/daw/AUDIO.md`, `src/daw/SPECTRAL.md` §11
