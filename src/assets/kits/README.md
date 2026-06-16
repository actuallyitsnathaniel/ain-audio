# Drum kit one-shots — drop-in folder

Bounced drum samples for the beat-maker (`/beatmaker`). Auto-discovered at **build
time** by `src/daw/data/kits.ts` (Vite `import.meta.glob`), exactly like the preset
one-shots. Until you drop a file in, that lane plays an **engine-synthesized** drum
so the beat-maker works immediately — no assets required.

## Convention

```
src/assets/kits/
  <kit-folder>/         ← folder name = kit id (the default kit is "house")
    kick.m4a            ← filename = the lane id it plays
    snare.m4a
    hat.m4a
    clap.m4a
    tom.m4a
```

- **Folder** = kit id. The default kit the engine loads is `house`, so files in
  `src/assets/kits/house/` light up the default lanes immediately.
- **Filename** = lane id: `kick`, `snare`, `hat`, `clap`, `tom` (the lanes in
  `DEFAULT_LANES` in `kits.ts`). Add the matching file and that lane swaps from the
  synth voice to your real sample.
- Each is a **single one-shot** — a short, pre-trimmed hit (no tail-gating; it plays
  to the end of the buffer). Bounce them tight.

## Formats

`.m4a`, `.flac`, `.ogg`, `.wav` are all accepted. **`.m4a` (256k AAC)** is the safe
default (universal incl. iOS Safari). `.wav` is fine here too since drum one-shots are
tiny — use it if you want zero encoding. See the preset README for the full codec
rationale; it's the same trade-off.

## Adding lanes or kits

New lanes (e.g. `rim`, `ride`) or whole new kits need a small edit to `DEFAULT_LANES`
/ `KITS` in [src/daw/data/kits.ts](../../daw/data/kits.ts) — each lane needs a
`synth` fallback type. Ask and I'll wire a kit selector once there's more than one.
