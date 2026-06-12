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
```

- **Folder name** → preset id and label. `neon-pluck/` shows as "neon pluck".
  Use hyphens or underscores; they become spaces.
- **Filename** is a note name: `C4`, `F#3`, `Gb2`, `A#-1`. **C4 = middle C = MIDI 60.**
  The engine pitch-shifts this sample across the keyboard from that root.
- **One file** = one zone, pitch-shifted everywhere. Past about ±7 semitones it
  starts to sound artificial — for wide-range sounds (bass, leads), bounce a few
  notes into the same folder and the engine picks the **nearest-root** zone per
  note (multisampling), minimizing pitch-shift distance.

### Recommended high-quality layout: tritone spacing, 3 octaves

For showcase presets, bounce a root **every tritone (6 semitones) across 3 octaves** —
7 files. Every played note then lands within **±3 semitones** of a root, which is
transparent (no chipmunking):

```
C2.m4a  F#2.m4a  C3.m4a  F#3.m4a  C4.m4a  F#4.m4a  C5.m4a
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

## Per-preset tuning (optional)

Amp envelope, output gain, custom display name, and hard multisample zone ranges
are defaulted by convention but can be overridden per folder id in the
`PRESET_OVERRIDES` map in [src/daw/data/presets.ts](../../daw/data/presets.ts).
A preset with no audio files but a `fallbackPatch` override plays the built-in
JS synth instead — that's how the original "glass pad / neon pluck / sub bass"
keep working until real files are bounced.
