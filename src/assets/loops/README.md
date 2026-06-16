# Loopable melodic samples — drop-in folder

Loops that layer over the beat-maker (`/beatmaker`). Auto-discovered at **build
time** by `src/daw/data/kits.ts` (Vite `import.meta.glob`), like presets/kits.
Unlike drums, there's **no synth fallback** — a loop is an audio file or nothing,
so the loop section stays empty until you add files.

## Convention

```
src/assets/loops/
  <name>-<rootBpm>bpm-<bars>bar.m4a
```

- The engine **tempo-matches** each loop to the grid by setting
  `playbackRate = gridBpm / rootBpm`, so it locks to the beat. (Pitch shifts with
  tempo — classic tracker/MPC behavior. Author loops near your usual tempo to keep
  it natural; true pitch-preserving time-stretch is out of scope for v1.)
- Encode **tempo + length in the filename** so the engine knows how to sync:
  - `dusty-keys-120bpm-2bar.m4a` → rootBpm 120, 2 bars.
  - Tokens are optional; missing ones default to **120 bpm / 1 bar**.
  - The leftover stem (tokens stripped) becomes the loop id + prettified label:
    `dusty-keys` → "dusty keys".
- Loops should be **clean, seamless one- to four-bar loops**, pre-trimmed to their
  exact bar length so the loop point is tight.

## In the beat-maker

Each discovered loop is a row: a **toggle** to layer it in, a **level** knob, and
**M**ute / **S**olo. Loops start on the next bar boundary and run in sync; changing
the grid tempo re-rates them live. Mute/solo/level update without restarting.

## Formats

`.m4a`, `.flac`, `.ogg`, `.wav` accepted — `.m4a` (256k AAC) is the safe default.
Loops can be longer than one-shots, so AAC's size win matters here; FLAC if you want
lossless. See the preset README for the full codec rationale.

## Per-loop overrides

Custom display name or explicit rootBpm/bars (instead of filename tokens) go in the
`LOOP_OVERRIDES` map in [src/daw/data/kits.ts](../../daw/data/kits.ts), keyed by loop id.
