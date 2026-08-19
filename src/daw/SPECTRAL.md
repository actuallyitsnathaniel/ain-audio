# Spectral Processing Family

Design notes for **shared time–frequency DSP** that can power multiple FX devices in this
DAW — starting with **impartialer / pitch-map** and **spectral compressor**, without reinventing
STFT/OLA plumbing per effect.

Companion to [AUDIO.md](AUDIO.md) (engine + FxChain contract). Product inspiration:
PITCHMAP-style remapping + Chroma-style in-key snap; spectral dynamics akin to commercial
multiband/spectral compressors. Algorithm-level ideas are platform-agnostic; integration is
pinned to our **WASM / AudioWorklet per-device** rule (never a monolith spectral engine).

***

## 1. Why a shared backbone

Both impartialer/pitch-map and a spectral compressor need the same expensive loop:

1. Window incoming PCM → **STFT** (magnitude + phase per bin).
2. Decide **per-bin (or per-band / per-partial) gains or shifts**.
3. Reconstruct with **ISTFT + overlap-add** (and careful phase).

What differs is only the **decision layer**:

| Device | Decision | Output transform |
| --- | --- | --- |
| Global pitch shift | one ratio β for all bins | shift / resample bins |
| Impartialer snap | nearest in-key pitch class per bin/partial | small frequency shift |
| Pitch-map remap | target note / chord per pitch track | per-track β on partials |
| Spectral compressor | envelope vs threshold per band/bin | magnitude gain only |
| Spectral gate / expand | same envelopes, different curve | magnitude gain |
| Spectral freeze / blur | hold or smear mag/phase | mag/phase write |
| RTA EQ (future) | UI-driven per-band gain | magnitude gain |

**Carry-over is high** for analysis, buffering, windows, latency reporting, dry/wet, and
visualization summaries. **Carry-over is low** for musical mapping rules vs dynamics curves —
those stay device-specific modules plugged into the same frame pipeline.

```text
PCM in
  → SharedSpectralCore.analyze(frame)
       mag[k], phase[k], (optional peaks / bands)
  → DeviceDecision(mag, phase, params)   ← only this forks
       → gain[k] and/or shift[k] / β_i
  → SharedSpectralCore.synthesize(...)
  → PCM out (+ optional analysis message to main thread)
```

***

## 2. Shared spectral math (the reusable core)

### 2.1. STFT / ISTFT

- **Window:** Hann (or Blackman-Harris for lower sidelobes; Hann is the default trade-off).
- **Sizes (presets):**

  | Quality | FFT `N` | Hop `H` | Overlap | Ballpark latency @ 48 kHz |
  | --- | --- | --- | --- | --- |
  | `low` | 2048 | 512 | 75% | ~21–43 ms (OLA group delay ≈ `N/H` hops worth) |
  | `high` | 4096 | 1024 | 75% | ~43–85 ms |

- **Cola:** choose window + hop so constant overlap-add holds (Hann @ 50% or 75% with
  amplitude compensation).
- **Preallocate** all typed arrays in the Worklet; no per-block `new`.

Key identities:

- Bin center Hz: \( f_k = k \cdot f_s / N \)
- Hz → MIDI: \( m = 69 + 12 \log_2(f / 440) \)
- Semitone ratio: \( \beta = 2^{\Delta / 12} \)
- Pitch class: \( pc = ((round(m) \% 12) + 12) \% 12 \)

### 2.2. Phase

- **Magnitude-only devices** (compressor, gate, most EQ): keep input phase; multiply
  \( X(k) \) by real gain \( g_k \). Cheapest, least phasy.
- **Frequency-shift devices** (impartialer, pitch-map, global shift): need phase vocoder
  propagation or sinusoidal resynthesis — this is where artifacts and CPU concentrate.
- Do **not** share one phase-vocoder path for the compressor; keep compress as
  gain-on-bins so it stays lighter and cleaner.

### 2.3. Band grouping (shared helper)

Many devices do not need full per-bin logic:

- **ERB / third-octave / constant-Q-ish bands** — map FFT bins → ~24–48 bands.
- Per band: sum energy (or max), run one envelope / one decision, scatter gain back to
  member bins (optionally with neighbor smoothing to avoid musical noise).

Pitch-map wants **peaks + harmonic groups** more than fixed bands; compressor wants
**bands** (or smoothed per-bin). Same `mag[]` feed both.

### 2.4. Envelopes (shared dynamics helper)

Reusable for compressor / gate / expander / “spectral duck”:

- Per band (or bin): \( e[n] = \mathrm{ballistics}(|X|) \) with attack / release.
- Optional **crest** (peak vs RMS) for transient-aware spectral compression.
- Soft-knee gain computer from threshold / ratio / makeup — same formulas as a
  broadband compressor, applied N times.

### 2.5. Peak / partial helpers (shared analysis helper)

Reusable for impartialer / pitch-map / future “harmonic focus”:

1. Peak-pick local maxima above a noise floor.
2. Optional harmonic grouping around candidate \( f_0 \).
3. Salience + simple inter-frame tracking (smoothing; Kalman later if needed).

Compressor v1 can ignore this entirely.

### 2.6. Dry/wet + residual

- **Dry/wet (`strength` / `mix`):** always available at the device wrapper (GainNodes),
  not inside the FFT — click-safe, automatable, matches reverb/delay.
- **Residual / transient split** (optional Phase 2+): crude high-frequency or
  onset-weighted residual passed with less processing. Useful for both impartialer
  (keep drums) and spectral comp (preserve attacks). Same splitter, different wet mix.

***

## 3. What carries over vs what forks

### Carries over (build once)

- Worklet load / warm on `ensureCtx`
- Circular input buffer, window, FFT, IFFT, OLA output buffer
- Quality presets → `N`, `H`, reported **`latencySamples`**
- Bin ↔ Hz ↔ MIDI / pitch-class utilities
- Band mapper (bin → band index)
- Envelope ballistics
- Downsampled analysis messages for UI (spectrum, band gains, in-key flags)
- FxChain hosting: `{ in, out, apply }`, bypass = neutralize wet path

### Forks per device (small modules)

| Module | Impartialer / pitch-map | Spectral compressor |
| --- | --- | --- |
| Decision | scale / key / mode → shift map | thresh / ratio / knee → gain |
| Domain | frequency shift (phase care) | magnitude only |
| Analysis extras | peaks, harmonics, tracks | bands + envelopes |
| Params | key, scale, mode, maxShift, transpose | thresh, ratio, attack, release, bands, tilt |
| CPU profile | heavier | moderate |

### Partial carry-over

- **Max shift / strength** UX patterns → analogous to **range / mix** on the compressor.
- **Visualization:** same magnitude frame; impartialer colors in-key vs shifted bins; compressor
  colors gain reduction per band.
- **Quality / latency knob:** identical user-facing control, same core presets.

***

## 4. Branch A — Impartialer / Pitch-Map (`impartialer`)

### 4.1. Product

Real-time polyphonic **spectral pitch mapper**:

- Analyze → pitch candidates / partials
- **Snap to key** (Chroma-style): out-of-key energy → nearest in-key class, clamped by
  `maxShift`
- **Remap to scale** (PITCHMAP-lite): force tracks into scale / chord targets
- Blend wet with dry via `strength`
- **Detail pass:** map only peaks; unshifted bins keep input phase (`residual`);
  lo/mid/hi amounts; onset duck (`hits`). Not a mag-only spectral gate.
- Non-goals v1: AI demix, offline mastering, ML pitch models

### 4.2. Params (`FxParams["impartialer"]`)

```ts
type MappingMode = "off" | "snap" | "remap"; // custom map = later

impartialer: {
  on: boolean;
  key: number;       // 0–11, C = 0
  scale: "major" | "minor" | "dorian" | "chromatic";
  mode: MappingMode;
  strength: number;  // 0–1 overall dry/wet
  transpose: number; // −12…+12 post-map
  maxShift: number;  // 1 | 2 | 12
  quality: "low" | "high";
  residual: number;  // 0–1 wet gain on identity (unshifted) bins
  floor: number;     // 0–1 of frame peak — peak gate
  lo: number;        // 0–1 snap/remap below 250 Hz
  mid: number;       // 0–1 snap/remap 250 Hz–2.5 kHz
  hi: number;        // 0–1 snap/remap above 2.5 kHz
  hits: number;      // 0–1 onset flux duck
}
```

Defaults: off, C major, `snap`, strength 0.7, transpose 0, maxShift 1, quality `low`,
residual 1, floor 0.08, lo/mid 1, hi 0.4, hits 0.75.

PV runs **only when a bin actually moves**. In-key / below-floor / out-of-band
energy stays at the analysis phase and is mixed by `residual`. Global transpose
still forces the PV path (the bin has to move).

### 4.3. Worklet surface

- Processor name: `ain-impartialer`
- **AudioParams:** `strength`, `transpose`, `maxShift`, `residual`, `floor`,
  `bandLo`, `bandMid`, `bandHi`, `hits` (k-rate)
- **port messages:** `{ type: "config", key, scale, mode, viz }` and quality rebuild
- Quality change rebuilds the node (FFT size baked at construct); duck ~8 ms like FxChain
  rewire

### 4.4. Phases

1. **Global spectral shift** — STFT + one β (transpose only). Proves OLA + phase in-rack.
2. **Snap to key** — per-bin / per-peak pitch-class snap + strength + maxShift + UI.
3. **Polyphonic remap** — harmonic grouping, per-track β, `remap` mode.
4. Quality presets, residual split, viz messages.
5. **Detail pass** — residual wired, peak floor, lo/mid/hi, onset duck. (Living note:
   impartialer-detail canvas.)
6. Optional: custom map, MIDI targets, sidechain key detect, faster-hop quality.

### 4.5. Upheaval — multi-F0 track engine (reconciled)

The interim device still maps **spectral peaks → MIDI**. That is not true polyphonic
F0 detection; it is what washed the signal (noise peaks treated as notes). A Gemini
brief proposed HPS → comb isolate → “Hildebrand ACF” → phase-locked remap. We keep
the **pipeline shape** and reject the scaffolding / mislabels. Living note:
impartialer-detail canvas (Upheaval tab).

**Target phases**

1. **HPS acquire** — on the existing STFT magnitude:  
   \(P(\omega)=\prod_{r=1}^{R}|X(r\omega)|\) (R≈4). Local maxima of \(P\) → at most
   \(M\) fundamental candidates (e.g. 4). Refresh on hop, not every sample.
   **Shipped (step 1):** `runHps` in `impartialer-processor.js`; amber F0 ticks on RTA.
2. **Isolate** — per \(F_{0,n}\), a harmonic mask / light feedback comb  
   \(H(z)=\frac{1}{1-\alpha z^{-K}}\) (\(K\approx f_s/F_0\)) as an *enhancer*, plus
   residual \(= x - \sum\) masked tracks. A comb does **not** fully null competing
   notes; do not claim demix.
   **Shipped (step 2):** soft spectral masks — weight \(1 - |¢|/45\) on nearest
   \(n\cdot F_0\) ladder; one \(\beta\) per F0 applied to the owned group; leftover
   + untracked → residual. No IIR comb yet (mask is the honest isolate).
3. **Track** — per isolated mono ring, **US5973252A recursive E/H** (same math as
   Centinel — not block \(R(\tau)\) branded “Hildebrand”). \(\varepsilon\) gate +
   quadratic \(\tau^\*\). Latency win is continuous E/H between HPS refreshes.
   **Shipped (step 3):** hop-rate correction-mode E/H on a shared mono analysis
   ring, seeded by each HPS \(F_0\). Refined \(F_0\) drives mask ownership + \(\beta\).
   Fail \(\varepsilon\) → keep HPS seed. Per-track isolated rings (true demix feed)
   still later.
4. **Remap + sum** — one \(\beta=2^{\Delta/12}\) per track applied to the whole
   harmonic group (snap/remap/MIDI). Phase continuity via public phase-vocoder /
   instantaneous-frequency practice (Bernsee). Do **not** implement US11079418
   (Zynaptiq, 2021) claims. Sum tracks + `residual`·untracked + outer `strength`.

**Keep from detail pass:** strength, residual, hits, lo/mid/hi (as F0-range gates),
viz, FxChain hosting (`ain-impartialer` only — no greenfield PitchMapperNode).

**Share with Centinel:** E/H helper when a second copy would drift. Centinel’s
corrector stays cycle-splice; impartialer’s stays spectral group shift.

***

## 5. Branch B — Spectral compressor (`speccomp`)

### 5.1. Product

Dynamics in the **frequency domain**: loud bins/bands get turned down (or quiet ones up)
independently, so dense mixes breathe without a single broadband gain riding the whole
signal. Familiar relatives: multiband compressors, “spectral” / “dynamic EQ-like”
processors — we are **not** cloning a specific plugin; we share the STFT gain path.

Typical uses in this DAW:

- Tame harsh resonances on loops without static EQ
- Level uneven vocal/harmonic energy on stems
- Creative pumping per band (high ratio + fast release)

### 5.2. How much of impartialer’s processing carries over?

| Layer | Shared with impartialer? |
| --- | --- |
| STFT / ISTFT / OLA / windows / quality / latency | **Yes — same core** |
| Dry/wet wrapper, Worklet hosting, FxChain entry | **Yes** |
| Band mapper + envelopes + knee math | **Yes (new shared dynamics helpers)** |
| Peak / harmonic / pitch-class / shift | **No** — unused in v1 compressor |
| Phase vocoder / bin shifting | **No** — magnitude gains only |

So: **one SharedSpectralCore + two decision plugins**. The compressor should ship *faster*
than full pitch-map if the core exists, because it avoids the hard polyphonic / phase-shift
problem.

### 5.3. Params (`FxParams["speccomp"]`) — proposed

```ts
speccomp: {
  on: boolean;
  threshold: number;  // dB, e.g. −48…0
  ratio: number;      // 1…20
  attack: number;     // sec
  release: number;    // sec
  knee: number;       // dB soft knee
  makeup: number;     // dB
  mix: number;        // 0–1
  tilt: number;       // −1…+1 bias thresh toward low vs high bands
  focus: number;      // 0–1: fewer wide bands ↔ more narrow bands (resolution)
  quality: "low" | "high";
}
```

Optional later: upward compression mix, transient / residual bypass, sidechain input
(second Worklet input or analysis-only sidechain from another track — big product
decision; defer).

### 5.4. Algorithm (v1)

1. STFT → `mag[k]`, keep `phase[k]`.
2. Map bins → `B` bands (from `focus` + quality).
3. Band energy → envelope (attack/release).
4. Gain computer (threshold + tilt-adjusted per band, ratio, knee) → `g_b`.
5. Scatter `g_b` to bins (smooth across band edges).
6. \( Y(k) = g_k \cdot X(k) \) (phase unchanged).
7. ISTFT / OLA; parallel dry via wrapper `mix`.

### 5.5. Phases

1. Fixed ~24-band spectral compressor, quality `low` only.
2. `focus` / tilt / soft knee polish; `high` quality preset.
3. Upward mode / residual; optional GR visualization.
4. Sidechain / sculp modes — only if product need is clear.

***

## 6. Integration with this DAW

### 6.1. Architecture rule (from AUDIO.md)

Native Web Audio nodes remain the default. Spectral devices are **AudioWorklet
(+ optional WASM later) modules** hosted identically to filter/comp/delay via:

```ts
build(ctx) → { in, out, apply }
```

No shared global “spectral engine” singleton that all tracks call into — each device
instance owns its core (or a small pool later if profiling demands it).

### 6.2. Latency contract (precondition)

These were the first **intentionally latent** FX-rack devices. Shipped:

- Optional `latencySamples` on `FxDeviceDef`
  (`number | ((params, sampleRate) => number)`).
- **Mini-ADC wired** — track strips pad via post-FX `DelayNode` to the longest peer
  (`engine.refreshTrackAdc`). `cliplim` reports lookahead samples; STFT devices report FFT size.
- Impartialer / speccomp report latency from the active quality preset.
  Centinel reports `N/2` samples (Autotalent-style Fairbanks OLA; not STFT).

Broadband `comp` stays zero-latency native. Spectral comp is a **separate** device type.

### 6.3. Registry sketch

```ts
type FxDeviceType =
  | "filter" | "comp" | "delay" | "chorus" | "disperser" | "crush" | "reverb"
  | "impartialer"    // pitch snap / remap
  | "centinel"          // monophonic hard-tune (Autotalent Fairbanks OLA; not STFT)
  // future: spectral-time / smear — see §11 (pinned YIN+PV archive)
  | "speccomp"          // spectral compressor
  | "cliplim";          // lookahead clip + preserve (worklet; category native)
```

UI: panels in [FxChainRack.tsx](components/FxChainRack.tsx) — knobs + chip rows (key/scale
or quality), same DeviceShell vocabulary.

### 6.4. Suggested repo layout

```text
src/daw/
  SPECTRAL.md                 ← this doc
  worklets/
    spectral-core.js          ← STFT/OLA + band map + envelopes (shared)
    impartialer-processor.js
    spectral-comp-processor.js
  fx-devices.ts               ← buildImpartialer / buildSpecComp wrappers
```

If the core grows heavy, move hot paths to WASM **per module** (same as signalsmith-stretch
for warp) — still one device at a time.

### 6.5. Main-thread ↔ Worklet

- Prefer **AudioParam** for continuous automatable values.
- **port.postMessage** for discrete config (key, scale, mode) and sparse viz
  (every 2–4 blocks: band GR, pitch-class histogram — not full FFT every quantum).
- Warm worklet modules once from `ensureCtx` (mirror `ensureCaptureWorklet`).

***

## 7. Future branches off the same core

Once analyze → decide → synthesize is stable, cheap extensions:

| Device idea | Decision plug-in |
| --- | --- |
| Spectral gate / expand | envelope vs open/close thresholds |
| Dynamic EQ / “spectral tilt” | per-band gain from slow envelopes + UI |
| Spectral blur / smear | temporal smoothing of mag |
| Freeze / scrub | hold mag frames |
| Noise / hiss focus | high-band-only gate |
| Pitch correct (mono) | single f0 track + shift (subset of impartialer) |

**“Spectral vocoder” (name TBD — think on this).** Classic vocoders already *are*
spectral: modulator envelope per band stamped onto a carrier. Calling it “spectral”
is almost redundant, but there’s a real branch here once we have two analyzed frames
in play — e.g. imprint one track’s mag contour onto another’s phase (or partials),
cross-synthesis / “talking drums” / texture transfer without a literal robot-voice
filterbank UI. Likely needs a sidechain / second input (same open question as
speccomp sidechain). Don’t spec it yet; just don’t forget the core already wants
carrier×modulator-shaped decisions.

RTA-driven static EQ can share **analysis + band map** with a much simpler synthesize
path (or even native biquads driven by analysis) — evaluate when EQ research lands; do not
force every EQ through ISTFT if a parametric stack sounds better/cheaper.

***

## 8. Risks & mitigations

| Risk | Mitigation |
| --- | --- |
| Polyphonic pitch detection CPU / quality | Ship coarse snap first; remap later |
| Phase-vocoder smear on impartialer | residual path; quality presets; clamp maxShift |
| Too many FFT instances on a busy project | Instance-per-device but profile; share module code, not state; allow only one heavy spectral device per chain in UI copy if needed |
| Latency vs live monitoring | Report `latencySamples`; prefer `low` default; keep software monitor path FX-free (already true) |
| Scope creep (“one spectral god plugin”) | Two registry types, shared core file — product separation stays clear |

***

## 9. Deliverables checklist

Shared

- [x] `latencySamples` on `FxDeviceDef` + AUDIO.md note
- [ ] `spectral-core` Worklet utilities extracted (still inlined in impartialer processor)
- [x] Module warm on context start
- [ ] Quality → latency table verified at 44.1 / 48 kHz

Impartialer

- [x] `impartialer` registry entry + rack UI
- [x] Phase 1 global shift
- [x] Phase 2 snap-to-key
- [x] Phase 3 remap (force nearest scale degree; polyphonic-lite / per-bin)
- [x] Detail pass: residual + peak floor + lo/mid/hi + hits (onset duck)
- [x] Upheaval step 1: HPS acquire + harmonic-gated peak remap + RTA F0 ticks
- [x] Upheaval step 2: soft harmonic masks + one β per F0 group + residual
- [x] Upheaval step 3: M× E/H refine (HPS-seeded, mono ring) → drive β / masks
- [ ] Upheaval step 4+: Bernsee phase continuity / sticky slew / per-track iso rings
  (see §4.5; canvas Upheaval / Path tabs)

Speccomp

- [x] `speccomp` registry entry + rack UI
- [x] Fixed-band magnitude compressor (12–48 log bands via focus)
- [x] Tilt / focus / high quality
- [ ] Upward mode / residual / GR viz

Docs / credits

- [x] Keep this file as the design source of truth
- [ ] Any adopted external DSP/code → [CREDITS.md](../../CREDITS.md) at adoption time

***

## 10. Recommended build order

1. **Latency field** on the device contract (no compensation yet).
2. **Shared core** + a trivial “gain all bins by 1” or global-shift impartialer Phase 1 — proves
   hosting in FxChain.
3. **Spectral compressor v1** — high user value, reuses core, avoids pitch/phase hell.
4. **Impartialer snap (Phase 2)** — musical differentiator.
5. **Impartialer remap + polish** — only after snap feels useful on real loops.

That order maximizes reuse: compressor validates bands/envelopes; impartialer then adds the
shift path on the same analyze/synthesize spine.

***

## 11. Pinned: spectral-time / smear (ex-Centinel YIN+PV)

**Status:** architecture pinned, not shipped as a rack device yet.
**Code seed:** [`worklets/spectral-smear-processor.js`](worklets/spectral-smear-processor.js)
(archived former Centinel — **not** registered; do not confuse with live
[`worklets/centinel-processor.js`](worklets/centinel-processor.js)).

Live **centinel** is YIN + **stays_locked / hold** note commit + **ratio** control
into Fairbanks OLA (or period **PSOLA** when `formant ≥ 0.5`). Soft **speed** under
Fairbanks is *within-note* only; under PSOLA it chases `R*` across note changes (D6).
Phrase onset (formant on): hold **R=1** with level up until PSOLA mix is ready, then
chase — never Fairbanks-shift first (that was the low-formant / gate / click trap).
Unvoiced DROP must clear `_everLocked` + phases — otherwise the prior phrase’s period
keeps synthesizing across the gap and the next onset reads an octave low (~15–25ms)
before snapping (see `ab_12.1_octave.wav`). Soft MIDI springs were removed — they diphthonged by lagging `out` while `in`
tracked live det. Neural F0 (PESTO / SwiftF0) is a later detector option if YIN
still limits quality; do not swap the shifter for that. The YIN + phase-vocoder path was the wrong latency class for
Auto-Tune–style hard lock, but it is a solid starting point for a **spectral-time /
smear** effect that *wants* STFT group delay and hop-rate morphing.

### Capabilities to carry forward

| Piece | Notes |
| --- | --- |
| STFT quality presets | `low` 2048/512 · `high` 4096/1024 — report `latencySamples = fftSize` |
| Global β PV shift | bin remap + phase propagation (`processFrame`) |
| Formant preserve | log-mag envelope smooth + fine/env split remap |
| YIN f0 (optional) | useful if smear is pitch-aware / pitched freeze |
| Scale / MIDI target map | musical decision layer already wired in the archive |
| speed / flex / humanize | smoothing of β over hops — reads as smear/glide when slow |
| Stereo dual FFT | L/R independent PV state |
| Dry/wet vs delay | delay length = `fftSize` (latency-aligned) |
| Pitch-graph viz | reuse pattern: scrolling det / target / out MIDI norms |

### Product sketch (later)

Not a tuner. Think: spectral smear, freeze-adjacent trails, pitched blur, “time in
the frequency domain” — the PV path’s smear and latency become the *feature*.
Possible names TBD (`smear` / `spectime` / …). Registry type stays separate from
`centinel`; shared STFT core still the long-term extract (§6.4).

### Why Centinel left this stack

Hard lock requires period-scale latency and period-rate updates. Hop-quantized PV
β cannot compete with Antares-class response. Keep this archive for the smear
device; do not re-merge it into Centinel.
