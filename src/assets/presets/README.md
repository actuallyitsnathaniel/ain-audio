# Preset one-shots — drop-in folder

Bounced synth-preset samples live here. They're auto-discovered at **build time**
by `src/daw/data/presets.ts` (via Vite `import.meta.glob`) — no manifest, no code
edit needed to add a preset. Drop a folder, reload the dev server, it appears in
the Preset Lab dropdown.

## Convention

```
src/assets/presets/
  <preset-folder>/        ← folder name = preset id; prettified = the dropdown label
    <NoteName>.m4a        ← filename = the MIDI note you bounced the sample at
    phrase.mid            ← (optional) the default piano-roll phrase for this preset
```

- **Folder name** → preset id and label. `neon-pluck/` shows as "neon pluck".
  Use hyphens or underscores; they become spaces.
- **Filename** is a note name: `C4`, `Fs3`, `Gb2`, `As-1`. **C4 = middle C = MIDI 60.**
  The engine pitch-shifts this sample across the keyboard from that root.
  - ⚠️ **Write sharps as `s`, not `#`** (`Fs2`, not `F#2`). A `#` in a filename breaks
    Vite's asset import (it's a URL fragment char). Flats use `b` (`Gb2`). The parser
    accepts both forms, but `#` won't survive bundling — always use `s`.
- **One file** = one zone, pitch-shifted everywhere. Past about ±7 semitones it
  starts to sound artificial — for wide-range sounds (bass, leads), bounce a few
  notes into the same folder and the engine picks the **nearest-root** zone per
  note (multisampling), minimizing pitch-shift distance.

### Recommended high-quality layout: tritone spacing, 3 octaves

For showcase presets, bounce a root **every tritone (6 semitones) across 3 octaves** —
7 files. Every played note then lands within **±3 semitones** of a root, which is
transparent (no chipmunking):

```
C2.m4a  Fs2.m4a  C3.m4a  Fs3.m4a  C4.m4a  Fs4.m4a  C5.m4a
```

This is the lightweight version of how big sample libraries (Kontakt-style) work:
narrow, centered zones, nearest-root selection. ~1 MB/preset at 256k AAC, decoded
lazily on first selection. Notes played past the top/bottom root shift the edge
sample, capped at ±7 semitones so they degrade gracefully rather than going silent.
A single `C4.m4a` is still fine for throwaway presets — multisampling is per-folder
and purely additive.

## Formats

`.m4a`, `.flac`, and `.ogg` are all accepted — mix them per preset:

- **`.m4a` (AAC, 256 kbps)** — the default. Universal browser support incl. iOS
  Safari, hardware-accelerated decode. Use this unless you have a reason not to.
- **`.flac`** — lossless. Worth it only for sounds that get pitch-shifted hard
  (deep bass) where AAC artifacts could surface. ~3–5× the file size.
- **`.ogg` (Opus)** — smallest. Fine on Chrome/Firefox/Android; **risky on Safari**
  — avoid for anything that must play for every visitor.

Everything decodes to identical PCM in the engine, so codec choice is about
download size + browser support, not playback quality. Bounce from a clean source
at a high bitrate — that's the real quality lever.

## Default piano-roll phrase (`.mid`)

Drop **one `.mid` file** into a preset folder and the piano roll auto-loads it as
that preset's default phrase — parsed at selection time (`src/daw/data/midi-file.ts`),
exactly like the audio is auto-discovered. The filename doesn't matter (`phrase.mid`
is the convention); if there are several, the last one wins.

- Export a **1–4 bar** MIDI clip — short and loopable. The roll loops it.
- **Tempo + time-signature** are read from the file → they set the roll's BPM and
  bar grid. **But Ableton's "Export MIDI Clip" omits tempo** (it's a Set property,
  not a clip property), so the file usually carries none. When it doesn't, the roll
  uses the preset's **`bpmHint`** override in `presets.ts` instead. So: set `bpmHint`
  per preset, OR export from Arrangement view (File → Export MIDI File) to bake the
  tempo into the file — a real MIDI tempo always wins over `bpmHint`.
- **Leading/trailing empty space is auto-trimmed** — Ableton exports the clip's
  whole span, so the parser shifts the first note to beat 0 and rounds the length
  up to whole bars. You don't need to tighten clips before exporting. (A deliberate
  pickup before the downbeat would be snapped to it — fine for loopable phrases.)
- **C4 = middle C = MIDI 60**, matching the audio root convention.
- Velocities carry through (they shade the notes and drive the sampler).
- No `.mid`? The roll uses the hand-authored `defaultPhrase` in `presets.ts`
  (or a generic arpeggio fallback). Adding a `.mid` later just overrides it.

### Exporting the phrase from Ableton

1. Write/record the phrase on a MIDI track (1–4 bars, set the Live set's tempo).
2. Right-click the clip → **Export MIDI Clip…** → save as `phrase.mid` into the
   preset's folder.
3. Reload the dev server; select the preset — the roll shows your phrase.

## Per-preset tuning (optional)

Amp envelope, output gain, custom display name, hard multisample zone ranges, and
`humanize` are defaulted by convention but can be overridden per folder id in the
`PRESET_OVERRIDES` map in [src/daw/data/presets.ts](../../daw/data/presets.ts).
A preset with no audio files but a `fallbackPatch` override plays the built-in
JS synth instead — that's how the original "glass pad / neon pluck / sub bass"
keep working until real files are bounced.

### `humanize` — restoring per-note "alive" detune

A single bounced sample replays *identically* every time, so a patch's subtle
per-voice detune (the thing that makes each note sound slightly alive) gets frozen
out. Set `humanize` (cents of random detune applied per note) on **only** the
presets that have that character:

```ts
"my-pluck": { humanize: 5 },   // ± up to 5 cents random per note
```

Off (`0`) by default. Keep it **conservative — ~3–8 cents**; more starts to sound
out of tune. This is the cheap fake; for true variation, bounce multiple takes per
zone (round-robin) — not yet implemented, ask when a hero preset needs it.
