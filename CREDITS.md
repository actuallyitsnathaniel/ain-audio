# Credits

Everything third-party this site uses or draws on. New adoptions from
[docs/RESOURCES.md](docs/RESOURCES.md) (or anywhere else) get an entry here **at adoption time**.

The audio engine, DSP, and UI are written from scratch — no vendored or copied code. Where an
implementation follows a published technique, the source is credited below and linked at the
point of use in the code/docs.

## Runtime libraries (MIT)

- [React](https://react.dev) + [React DOM](https://react.dev)
- [React Router](https://reactrouter.com)
- [Tailwind CSS 4](https://tailwindcss.com)
- [Framer Motion](https://motion.dev)
- [@unhead/react](https://unhead.unjs.io)
- [signalsmith-stretch](https://signalsmith-audio.co.uk/code/stretch/) (Signalsmith Audio, MIT) —
  polyphonic pitch-shift / time-stretch (WASM + AudioWorklet). Powers the studio's per-clip
  WARP mode: pitch-preserving tempo-fit + duration-preserving transpose, rendered offline into
  cached buffers in `engine.ts` (`stretchRender`).
- [fflate](https://github.com/101arrowz/fflate) — zip pack/unpack for the AIN
  `.ain` project format (`src/daw/ain-pack.ts`: WAV preview + zip arrangement pack).

## Runtime libraries (other)

- [Mediabunny](https://mediabunny.dev/) (MPL-2.0) — tree-shaken WebM mux + WebCodecs Opus encode
  for studio take/bounce persistence in IndexedDB (`src/daw/data/audio-store.ts`). Falls back to
  float WAV when the browser cannot encode Opus.

## Build / dev toolchain

- [Vite](https://vite.dev) (+ `@vitejs/plugin-react`)
- [TypeScript](https://www.typescriptlang.org)
- [ESLint](https://eslint.org) + `typescript-eslint`, `eslint-plugin-react-hooks`, `eslint-plugin-react-refresh`
- [Prettier](https://prettier.io) + `prettier-plugin-tailwindcss`
- [PostCSS](https://postcss.org) + `autoprefixer`
- [vite-plugin-image-optimizer](https://github.com/FatehAK/vite-plugin-image-optimizer) (backed by [sharp](https://sharp.pixelplumbing.com) + [SVGO](https://svgo.dev))
- Deployed on [Vercel](https://vercel.com)

## DSP & technique sources

Implemented from scratch, following these published techniques:

- **[Audio EQ Cookbook](https://www.w3.org/TR/audio-eq-cookbook/)** — Robert Bristow-Johnson.
  Biquad coefficients + magnitude response for the filter graphs
  (`src/daw/components/audio-lab/filter-math.ts`, `FilterGraph.tsx`).
- **[YIN](http://auditory.org/postings/2002/26.html)** — Alain de Cheveigné & Hideki Kawahara.
  Fundamental-frequency estimator used by the centinel worklet
  (`src/daw/worklets/centinel-processor.js`) and the pinned spectral-smear archive
  (`src/daw/worklets/spectral-smear-processor.js`).
- **[Autotalent](http://tombaran.info/autotalent.html)** — Thomas A. Baran.
  Pitch-synchronous Fairbanks overlap-add hard-tune technique (circular buffer,
  phase-in/phase-out, Hann fragment, cubic interp). Centinel reimplements the
  *approach* in original JS — not a paste of the GPL LADSPA sources.
- **[Silvertune](https://github.com/epsilver/silvertune)** / [silvertune-web](https://github.com/verticalrectangle/silvertune-web)
  — behavioral reference for Centinel soft speed: `stays_locked` hysteresis,
  hold-before-commit, and exponential chase of **pitch ratio** (not MIDI springs).
- **[zita-at2](https://hal.science/hal-05096064)** — Fons Adriaensen (LAC 2025).
  Period-synchronous PSOLA for formant-preserving retune; Centinel’s formant
  dial (≥50%) uses a JS reimplementation of that grain placement idea.
- **SwiftF0 / PESTO** (2025) — candidate neural F0 sidecars if YIN still limits
  Centinel; not adopted yet (keep classical detector until ratio+PSOLA settle).
- **TD-PSOLA** — classic monophonic pitch-correction family; Centinel defaults to
  Autotalent Fairbanks, with optional PSOLA when formant is engaged.
- **[Paul Kellet's refined pink-noise method](https://www.firstpr.com.au/dsp/pink-noise/)** —
  the pink-noise filter coefficients in the synth's noise oscillator (`src/daw/engine.ts` → `noiseBuf`).
- **["A Tale of Two Clocks"](https://web.dev/articles/audio-scheduling)** — Chris Wilson.
  The lookahead scheduler pattern behind the sequencer (`src/daw/AUDIO.md` → scheduler).
- **REAPER** — names the transport-declick behavior ("tiny fade at play and stop") our engine mirrors.
- **Xfer Serum** (unison voicing style), **FL Studio** (portamento/legato behavior),
  **Ableton Live** (session/arrangement UX) — behavioral inspiration only, no code.
- **FabFilter Pro-Q 3** — interactive EQ analyzer UX (band handles, solo, dyn, ST/M/S);
  our `eq` device is original Web Audio DSP + UI, not their code.
- **Kilohearts Disperser** (product category) — phase-dispersal via cascaded allpasses;
  our `disperser` device is an original Web Audio allpass cascade, not their DSP.
- **Au5** (transient / detail preservation technique) — clip, then restore
  highpassed(`dry − clipped`) into the limited signal; used by `cliplim`
  (`src/daw/worklets/cliplim-processor.js`). Behavioral inspiration; original DSP.

## Fonts

- [Archivo](https://fonts.google.com/specimen/Archivo) and
  [JetBrains Mono](https://fonts.google.com/specimen/JetBrains+Mono) — SIL Open Font License,
  served via [Google Fonts](https://fonts.google.com).

## Brand marks

Spotify, Apple Music, SoundCloud, Tidal, YouTube, Instagram, and Gmail logos
(`src/assets/images/icons/`) are trademarks of their respective owners, used solely to link to
the artist's presence on those platforms.

## Artwork

Album/EP covers and label/client art under `src/assets/images/projects/` are © their respective
artists, labels, and brands, shown as part of the artist's portfolio/discography.

## Tools & services

- [potrace](https://potrace.sourceforge.net) (Peter Selinger) — traced the pinned-tab favicon SVG.
- [Songstats](https://songstats.com) — music-data API (configured, not yet live on the site).
