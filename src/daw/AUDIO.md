# Audio Engine Reference

Developer documentation for the Web Audio engine (`src/daw/engine.ts`, exported as the
singleton `engine`). One `AudioContext`, one global "master track", a preset sampler, and a
reorderable FX rack. React subscribes via `engine.on(event, fn)` / `off`; it never owns audio
state. Companion to [DESIGN.md](DESIGN.md) (visual tokens) and
[../assets/presets/README.md](../assets/presets/README.md) (preset drop-in convention).

## Signal flow (the graph)

Built once in `buildGraph()` on first user gesture (`ensureCtx`). Top-to-bottom is series:

```
 track A (mix) ─┐                        synth/sampler voices ──┐
 tapMix→lm→gMix │                          (noteOn → voiceGain) │
 track B (mast) ┤→ sum ──[ REORDERABLE FX RACK ]──→ anOut ──→ limiter ──→ master ──→ speakers
 tapMaster→gMaster                                  (meter)   (safety)    (0.95)
                  ▲                                            ▲
           phase-locked A/B                          fixed tail — never reordered
           dry/wet crossfade
```

- **`sum`** is the junction everything feeds: the two track branches AND every synth/sampler
  voice (`voiceGain.connect(n.sum)`). Anything connected to `sum` runs through the whole rack.
- **Phase-lock invariant (do not break):** the A/B pair starts both buffer sources on the *same*
  context sample (`startSources`). The reorderable rack is strictly the `sum → … → anOut`
  segment — it never touches the track-source plumbing or the source-start timing.
- **`anOut`** is the output analyser (spectrum, meters). It sits *before* the safety limiter, so
  meters read the program signal, not the limited signal.

## Reorderable FX rack

Five effects, reorderable at runtime: **filter · comp · space · crush · reverb**
(default `FX_DEFAULT_ORDER`, a musical chain). Each is a module with a single input + output
GainNode (`FxModule { in, out }`), so the chain rewires cleanly at the gain boundaries.

| Key | Node(s) | Notes |
|-----|---------|-------|
| `filter` | BiquadFilter | bipolar morph: <0.5 lowpass, >0.5 highpass, ~0.5 off |
| `comp` | DynamicsCompressor + makeup gain | *creative* dynamics; manual makeup. Off ⇒ threshold 0/ratio 1 (neutral) |
| `space` | Delay + feedback (internal dry/wet) | internal parallel/feedback branch. **SYNC** locks delay time to the roll tempo: the `div` knob steps the 6 straight divisions (1/1→1/32, `DELAY_DIVS`); separate **`.`/`T`** chips set `feel` dotted (×1.5) / triplet (×2/3). `delaySec = beats × feelMult × 60/bpm`, clamped to 2s; `setBpm` re-applies it. Off = free ms (`time`). |
| `crush` | WaveShaper (tanh) + auto-gain | see loudness safety below |
| `reverb` | Convolver (internal dry/wet) | synth IR by default; real IR optional |

**Reordering** — `engine.setFxOrder(keys)` (a permutation of the 5). `rewireChain()`:
1. ducks `sum.gain` to 0 over ~8 ms (click-safe — the click comes from signal discontinuity,
   not the rewiring),
2. disconnects `sum` + every module `out`,
3. reconnects `sum → m0.in, m0.out → m1.in, … last.out → anOut` in `fxOrder`,
4. ramps `sum.gain` back to 1.

Effects are **always all in-chain**. "Bypass" (the power dot) neutralizes the node *in place*
via `applyFx()` (filter → 20 kHz, comp → neutral, wet gains → 0, shaper → null curve), so
toggling never reorders the rack. The UI ([components/audio-lab/FxRack.tsx](components/audio-lab/FxRack.tsx))
renders devices in `engine.fxOrder`. Each device has a **⠿ drag handle** that reorders via
**pointer events** (mouse + touch + pen — not HTML5 DnD, which doesn't fire on touch). The handle
captures the pointer; `onPointerMove` hit-tests the device under the pointer (`elementFromPoint` →
`data-fxkey`) and calls `setFxOrder` live, so the chain visibly rearranges as you drag. The handle
is a separate target from the knobs, so knob-dragging is unaffected; `touch-none` on it stops the
page scrolling mid-drag.

## Loudness safety (two independent safeguards, both default ON)

Saturation, resonance, and stacked delay feedback can all spike level — and with a reorderable
chain the peak is unpredictable. Two guards, deliberately separate:

1. **Crush auto-gain** (`fx.crush.autoGain`, default on) — `applyFx` trims `crushComp.gain` by
   `1/sqrt(1 + drive·3.5)` as drive rises, so driving the waveshaper changes *grit*, not
   *loudness*. Toggleable per the "auto" button on the CRUSH device.
2. **Safety limiter** (`fx.limiter`, default on) — a brickwall `DynamicsCompressorNode`
   (ratio 20:1, fast attack, ceiling ≈ −1.5 dBFS) in the **fixed tail after `anOut`**, *outside*
   the reorderable rack so it can never be moved or bypassed by reordering. Catches any peak
   regardless of fx order. User-toggleable (off = audition raw output, at their own risk).
   `engine.getReduction()` returns its live gain reduction (dB) — the LIMIT device's "peak" LED
   lights when it engages (rAF-driven, imperative, lint-safe).

## Sequencer scheduler + piano roll

The piano roll plays a **clip** (a bar-length phrase of notes in musical time) through a
**lookahead scheduler** in the engine.

**Voice factory (shared).** `noteOn`/`noteOff` were refactored into `startVoiceAt(midi, vel,
when)` → `VoiceHandle` and `releaseVoice(handle, when, instant?)`, both taking an **explicit
context time**. The live keyboard wraps these (keying held notes by MIDI); the scheduler calls
them directly with future `when` values (it can't key by MIDI — a phrase repeats pitches). One
voice factory, three callers (keyboard, roll, future beat-maker).

**Clip model** ([data/clips.ts](data/clips.ts)). `Note { id, pitch, start, length, vel }` with
`start`/`length` in **beats** (float; `seconds = beat * 60 / bpm`). `NoteClip { bars, beatsPerBar,
notes }`. Each preset ships a `defaultPhrase` (authored with the `phrase()` helper in
[data/presets.ts](data/presets.ts)); the roll clones it (`cloneClip`) so edits never mutate the
shipped data.

**The scheduler** (Chris Wilson "Tale of Two Clocks"). A `setInterval(~25 ms)` walks
`ctx.currentTime`; each tick schedules every note whose start falls in the window
`(_scheduledThrough, currentTime + 0.12s]`, mapping clip-beats → absolute ctx times and wrapping
at the loop boundary, calling `startVoiceAt`/`releaseVoice` with sample-accurate times.
**rAF is never used for audio timing** (it jitters and pauses in background tabs) — only the visual
playhead reads `getSequencePosition()` (a pure clock read) from `useRafLoop`. Tempo changes
re-anchor the clock so the playhead doesn't jump. API: `setActiveClip`/`getClip`, `setBpm`,
`setLoop`, `playSequence`/`stopSequence`/`toggleSequence`, `getSequencePosition()`.

**Transport mutual-exclusion.** `transportMode: "track" | "sequence"`. `playSequence()` calls
`pause()` (track playback feeds the taps; the sequencer feeds `sum` — both at once double-sums and
corrupts metering); `play()` calls `stopSequence()`.

**The editor** ([components/piano-roll/PianoRoll.tsx](components/piano-roll/PianoRoll.tsx)). One
`<canvas>` over the full MIDI range (C0–C8) with a **scroll-aware single coordinate system** for
grid + notes (`pitchToY(p) = (HI_MIDI - p)*ROW_H - scrollY`) — no squashing, so rows and notes
always align. Drawn per-frame in `useRafLoop` (grid → notes/playhead clipped to the lane → key
gutter on top). The working clip lives in a **ref** (mutated during drag for perf), pushed to
`engine.setActiveClip` on change.
A **selection model** (`sel: Set<note id>`) underlies the gesture set, which models Ableton Live's
MIDI Note Editor (non-draw-mode). The canvas is `tabIndex=0` (focusable) so keyboard editing works.
- **Select:** click a note · shift+click add/remove · drag empty → marquee (shift adds) ·
  shift+click a gutter key → toggle the whole pitch row · esc clears. Selected notes get a white
  outline; the HUD (top-right) shows live `sel / note / vel / len`.
- **Edit (mouse):** click empty → draw (snap 1/16) · drag a selected note → move the whole selection ·
  drag right edge → resize the selection · **hold ⌘/ctrl/⌥ to bypass snap** · **⌥+drag → duplicate**
  the selection (clone-in-place then move) · double-click / right-click → delete.
- **Edit (keys, when focused):** ←/→ nudge · ⌥+←/→ nudge without snap · shift+←/→ resize · ↑/↓
  transpose semitone · **shift+↑/↓ octave** · **⌘/ctrl+↑/↓ velocity ±10** · ⌘/ctrl+A select all ·
  ⌘/ctrl+D duplicate (+1 beat) · delete/backspace · esc. A transpose/velocity change blips the
  representative note so you hear the edit.
- **Navigate:** wheel → scroll pitch · shift+wheel → scroll time · ⌘/ctrl+wheel → zoom time around
  cursor · hold Space (or middle-drag) → pan. Wheel is a **non-passive native listener** so it can
  `preventDefault` the page scroll.
- **Velocity lane:** a docked band (`VEL_H` px) at the canvas bottom sharing the time axis. Each note
  draws a stem+cap with height ∝ velocity; drag a stem up/down to set velocity, sweep across notes to
  paint a ramp (a multi-note selection sets together). The pitch grid renders into `gridH = h - VEL_H`;
  pointer presses with `y ≥ gridH` are velocity edits (`Drag` mode `"vel"`).
- **Per-note pitch modulation** (right-click a note → menu). Both are native AudioParam automation in
  `startVoiceAt`, no DSP: **portamento** (`Note.slideFrom`, a MIDI pitch) glides the voice's pitch from
  that source into the note's own pitch over the note's length — sample path ramps `src.detune` (cents),
  synth path ramps `osc.frequency`; drawn as an amber diagonal lead-in. **vibrato** (`Note.vibrato =
  {rate Hz, depth cents}`) adds a sine LFO → gain → the voice's `detune` (stopped with the voice in
  `releaseVoice`); drawn as a violet squiggle whose amplitude tracks depth. Menu presets set
  light/medium/heavy depth; "clear" removes them.
- **Right-click menu** (`context-menu-bus` + `<ContextMenu/>` host in DawShell): note/velocity/portamento/
  vibrato/clip actions in the roll, channel/lane/loop actions elsewhere on the beat page. Shift+right-click
  bypasses to the native browser menu.
- **Gutter keyboard:** the left key column is tap-to-play — pointer-down auditions the pitch
  (`engine.noteOn`), sliding up/down retriggers, releasing/leaving the gutter stops. Held + sounding
  pitches glow (reads `engine.activeNotes(channelId)` each frame).
- **Platform convention** (matching Live): ⌘(mac)/ctrl(win) is the "command"/snap-bypass key; ⌥ also
  bypasses snap and triggers duplicate-drag. `cmd(e)` helper centralizes the mac/win check.
- **Purity:** the clip + selection refs are populated in the mount effect / handlers and only read
  inside handlers/rAF — never during render (react-hooks v7 `refs` rule).

[components/piano-roll/RollLab.tsx](components/piano-roll/RollLab.tsx) wraps it with play/stop, a
tempo `Knob`, loop + reset, and loads the selected preset's `defaultPhrase` on preset change (via a
`pr-load` CustomEvent on the canvas).

**Not yet implemented (Ableton parity, future):** alt-drag-vertical on a note for velocity (the lane
covers the common case), and note-stretch markers (scale a selection in time).
See [[piano-roll-ableton-gestures]] for the full reference.

## Beat-maker (drum step sequencer)

A step drum sequencer (+ melodic MIDI channels) on the lazy **`/beatmaker`** route
([routes/beatmaker.tsx](../routes/beatmaker.tsx) → `DawShell` →
[components/sequencer/Beatmaker.tsx](components/sequencer/Beatmaker.tsx)). It **reuses the Phase-2
scheduler** — `beatMode` flips `schedTick` from walking the note clip to walking the step grid.

- **Data** ([data/kits.ts](data/kits.ts)): `DrumKit` = named `DrumLane`s (kick/snare/hat/clap/tom);
  `SequenceClip` = `{ steps, beatsPerBar, bpm, swing, on: Record<lane, bool[]>, accent: …, channels: MidiChannel[] }`.
  `DEFAULT_KIT` + `defaultSequence()` ship a starter groove. One-shots are **auto-discovered** from
  `src/assets/kits/<kitId>/<laneId>.m4a` (glob, like presets) — see
  [../assets/kits/README.md](../assets/kits/README.md).
- **Voices**: `triggerDrum(laneId, when, accent)` plays the decoded one-shot if present, else
  `synthDrum()` — **engine-synthesized** kick (pitched sine sweep), snare/hat/clap (filtered noise),
  tom, rim. Both route to `n.sum` → the shared FX rack. So the beat-maker works with **zero assets**;
  drop real samples in later and those lanes switch automatically.
- **Step = a 1/16 note** (`STEP_BEATS = 0.25`); grid length = `steps × 0.25` beats. **Swing** pushes
  odd steps later by up to ~⅓ step. Per-step **accent** boosts level.
- **Grid length is variable** — `setStepCount(n)` resizes to 16/32/48/64 (`STEP_COUNTS`, whole bars of
  1/16s), growing/shrinking every lane's `on`/`accent` row via `resizeRow` (preserves existing steps)
  and re-anchoring the playhead if playing (same trick as `setBpm`). `StepGrid` groups steps into bars
  of 16 with a gap; the ruler labels `bar.beat`.
- **Transport**: `playBeat`/`stopBeat`/`toggleBeat`, `setBeatBpm`, `setSwing`, `toggleStep`. Shares
  the `transportMode` mutual-exclusion — playing a beat stops track + piano-roll playback and vice
  versa. `getSequencePosition().step` drives the grid's current-step highlight (rAF, imperative).
- **UI**: [StepGrid.tsx](components/sequencer/StepGrid.tsx) (DOM buttons — low cell count;
  shift-click = accent; highlight updates one column's outline per frame, no React re-render) +
  [SequencerTransport.tsx](components/sequencer/SequencerTransport.tsx) (play/stop, tempo + swing
  `Knob`s).

**Melodic MIDI channels** — `seq.channels: MidiChannel[]` ([data/clips.ts](data/clips.ts)). Each
channel is its own instrument + `NoteClip`, scheduled on the **same clock** as the drums: `schedTick`'s
beat branch walks `seq.channels` after the drum loop, wrapping each clip's notes against the grid total.
- **Per-channel voice** — the voice factory `startVoiceAt(midi, vel, when, sel?)` takes an optional
  resolved `VoiceSel = { preset?, patch, dest? }`. No `sel` ⇒ global live-keyboard/Audio-Lab selection
  (unchanged); a channel passes `channelVoice(ch)` so each channel sounds its own preset/patch and routes
  to its own strip (`dest`). Sample buffers are cached by **preset id** (`_sampleBufs[id]`), so two
  channels on the same preset share one decode.
- **Vol / pan strip** — `channelStrip(ch)` lazily builds `gain → StereoPanner → n.sum` per channel
  (`_chNodes[id]`); voices connect to its gain (the `dest`). `setChannelVol`/`setChannelPan` ramp the
  live nodes; mute/solo fold into the gain via `refreshChannelGains`. `removeChannel`/`setSequence` tear
  down orphaned strips. Stored as `ch.vol` (0..1, def 0.8) / `ch.pan` (-1..1, def 0).
- **API** (all emit `clip`): `addChannel` / `removeChannel` / `setChannelPreset` / `setChannelClip` /
  `getChannelClip` / `toggleChannelMute` / `toggleChannelSolo` / `renameChannel` / `toggleChannelLoop` /
  `toggleChannelCollapsed` / `setChannelVol` / `setChannelPan` / `setChannelLength`. `channelGain`
  mirrors the drum mute/solo rule.
- **Per-channel loop + length** — `ch.loop` makes a channel repeat over **its own clip length**
  (`clipBeats(ch.clip)`), independent of the grid (a 2-bar bass loops twice under a 4-bar grid).
  `setChannelLength(id, bars)` edits `clip.bars` (1..16) so the loop window is adjustable; the UI reloads
  the roll (`pr-load`) so its visible grid follows. `schedTick` wraps each channel's notes against
  `span = ch.loop ? clipBeats(ch.clip) : total`, looping if `ch.loop || loopOn`.
- **Phrase save/load** — per-channel clip slots in `localStorage["ain-channel-clips"]` (mirrors the drum
  pattern slots in `SequencerTransport`); load dispatches `pr-load` to refresh the live roll.
- **Nameable / collapsible / marker** — `renameChannel` (inline edit), `ch.collapsed` folds the
  `PianoRoll` to a one-line header (controls stay), and `channelPosition(id)` drives a thin imperative
  position marker (rAF, beats into the channel's loop span) — see
  [MidiChannels.tsx](components/sequencer/MidiChannels.tsx).
- **UI** — [MidiChannels.tsx](components/sequencer/MidiChannels.tsx) renders each channel as a lane
  (instrument selector + name + M/S + remove) with a [PianoRoll.tsx](components/piano-roll/PianoRoll.tsx)
  bound via its new `channelId` prop (reuses the whole gesture/canvas editor; only the clip
  read/write endpoints switch from `setActiveClip`/`getClip` to `setChannelClip`/`getChannelClip`).
- **Live audition + arm** — `noteOn/noteOff/activeNotes` take an optional `channelId`; live voices are
  keyed `"<channelId|_>:<midi>"` so each channel's keys play its own voice without colliding. The
  **global keyboard** (no explicit id) follows `armedChannel` — `armChannel(id|null)` arms one channel
  at a time; the lane shows a lit **ARM** button + accent outline. Disarm reverts to the global voice.
- **Memory guard** (the explicit constraint): hard cap `MAX_CHANNELS = 8` (add button disabled),
  soft warning at `SOFT_CHANNELS = 4`, shared per-preset buffer cache, and the scheduler's existing
  256-voice prune (`_seqVoices`) as the voice ceiling for dense channel×step patterns.

**Loop lanes** (done) — `LoopLanes.tsx`: loopable melodic samples auto-discovered from
`src/assets/loops/`, each a sustained looped source started bar-aligned, `playbackRate = gridBpm /
rootBpm` so it locks to tempo; per-loop toggle / level / mute / solo; `setBpm` re-rates live loops.
- **A→B region** — `LoopState.a/b` (fractions 0..1 of the buffer; absent = whole loop). The source's
  native `loopStart`/`loopEnd` (buffer seconds, **independent of `playbackRate`**) bound the slice, and
  it `start()`s at the A offset. `setLoopRegion(id, a, b)` updates state + a live source instantly.
  The strip is a small waveform canvas (`loopPeaks(id, bins)`, cached per loop, mirrors `getPeaks`)
  with two pointer-draggable A/B handles that snap to the loop's 1/16 grid (⌘/ctrl = free).

**Not yet wired to UI** (engine seams exist, no callers): `loadReverbIR`/`useSynthReverbIR`
(real IR files).

## Preset sampler

Selecting a preset (`setSynthPatch(id)`) lazily fetches + decodes its zone files
(`loadPreset` mirrors `fetchBuf`). `noteOn(midi, vel)` branches: if the current preset has a
decoded zone, it plays an `AudioBufferSourceNode` pitch-shifted by `playbackRate` from the
zone's root (`pickZone` = nearest-root + a ±7-semitone shift cap), wrapped in an amp ADSR,
`→ sum` (so it shares the FX rack). No decoded zone ⇒ falls back to the JS-synth `PATCHES`.
Presets are **auto-discovered** from `src/assets/presets/` at build time — see
[../assets/presets/README.md](../assets/presets/README.md) for the folder/file convention,
multisampling, and formats.

## Reverb impulse response

Default is a **synthesised IR** (`makeReverbIR`): exponentially-decaying, lightly low-passed,
L/R-decorrelated noise. The `decay` knob regenerates it. To use a **real IR file** instead, call
`engine.loadReverbIR(url)` — it fetches/decodes via `fetchBuf`, pins the convolver buffer, and
disables decay regeneration; `engine.useSynthReverbIR()` reverts. Real IRs can live alongside the
preset assets and be loaded on demand (no fixed convention wired yet — add one when needed).

## Events (`EngineEvent`)

`state | wet | fx | track | ready | synth | preset | transport | clip`. Subscribe with
`useEngine([...])` (the hook force-re-renders on those events). **The union is duplicated** in
[hooks/useEngine.ts](hooks/useEngine.ts) — update both when adding an event.

## Gotchas

- **esbuild build does not typecheck.** Run `npx tsc --noEmit` (a few *pre-existing* errors live
  in the surviving old `src/components/*` files; lint + build are the real gates).
- **react-hooks v7 purity** — no `ref.current = x` or `performance.now()` *during render*. All
  imperative meter/LED drawing happens inside `useRafLoop` callbacks (see `LimitLed`, `LevelMeter`).
- **Canvas/SVG read `--accent` at runtime** via `getComputedStyle`, so theme changes are live.
