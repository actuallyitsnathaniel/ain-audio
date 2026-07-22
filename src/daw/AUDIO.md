# Audio Engine Reference

Developer documentation for the Web Audio engine (`src/daw/engine.ts`, exported as the
singleton `engine`). One `AudioContext`, one global "master track", a preset sampler, and a
modular FX device system (per-track chains + the master chain). React subscribes via
`engine.on(event, fn)` / `off`; it never owns audio state. Companion to [DESIGN.md](DESIGN.md) (visual tokens) and
[../assets/presets/README.md](../assets/presets/README.md) (preset drop-in convention).

## Signal flow (the graph)

Built once in `buildGraph()` on first user gesture (`ensureCtx`). Top-to-bottom is series:

```
 track A (mix) ─┐                        synth/sampler voices ──┐
 tapMix→lm→gMix │                          (noteOn → voiceGain) │
 track B (mast) ┤→ sum ──[ MASTER FX CHAIN ]──→ anOut ──→ limiter ──→ master ──→ speakers
 tapMaster→gMaster                              (meter)   (safety)    (0.95)
                  ▲                                            ▲
           phase-locked A/B                          fixed tail — never reordered
           dry/wet crossfade
```

- **`sum`** is the junction everything feeds: the two track branches AND every synth/sampler
  voice (`voiceGain.connect(n.sum)`). Anything connected to `sum` runs through the whole rack.
- **Phase-lock invariant (do not break):** the A/B pair starts both buffer sources on the _same_
  context sample (`startSources`). The reorderable rack is strictly the `sum → … → anOut`
  segment — it never touches the track-source plumbing or the source-start timing.
- **`anOut`** is the output analyser (spectrum, meters). It sits _before_ the safety limiter, so
  meters read the program signal, not the limited signal.

## Modular FX device system

FX are **self-describing device modules** ([fx-devices.ts](fx-devices.ts)) instanced into
**ordered chains** ([fx-chain.ts](fx-chain.ts)). The same system drives the master bus and
every arrangement track.

**Devices** — `FX_DEVICES: Record<FxDeviceType, FxDeviceDef>`; each entry is
`{ label, build(ctx) → { in, out, apply }, defaults() }`. `build` creates the device's node
graph between one input GainNode and one output node; `apply(params, ctx, bpm)` pushes a params
blob into it (ramped via `setTargetAtTime`, click-safe). Adding a new effect = one registry entry.

| Type     | Node(s)                             | Notes                                                                                                                                                                                                                                                                                                                                  |
| -------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `filter` | BiquadFilter                        | bipolar morph: <0.5 lowpass, >0.5 highpass, ~0.5 off                                                                                                                                                                                                                                                                                   |
| `comp`   | DynamicsCompressor + makeup gain    | _creative_ dynamics; manual makeup. Off ⇒ threshold 0/ratio 1 (neutral)                                                                                                                                                                                                                                                                |
| `space`  | Delay + feedback (internal dry/wet) | internal parallel/feedback branch. **SYNC** locks delay time to the tempo: the `div` knob steps the straight divisions (`DELAY_DIVS`, 1/16→1/1); separate **`.`/`T`** chips set `feel` dotted (×1.5) / triplet (×2/3). `delaySec = beats × feelMult × 60/bpm`, clamped to 2s; `setBpm` re-applies every chain. Off = free ms (`time`). |
| `crush`  | WaveShaper (tanh) + auto-gain       | see loudness safety below                                                                                                                                                                                                                                                                                                              |
| `reverb` | Convolver (internal dry/wet)        | synth IR, regenerated from the decay knob (device-owned `makeReverbIR`)                                                                                                                                                                                                                                                                |

**Chains** — `FxChain(ctx, input, output)` owns an ordered list of live device instances wired
`input → [dev0 → dev1 → …] → output` (empty = passthrough). `addDevice`/`removeDevice`/
`moveDevice` rebuild the internal connections click-safely by ducking the chain's own output
gain ~8 ms around the rewire. Serialized form: `FxDeviceState = { id, type, params }` —
`states()` snapshots, `setDevices(states)` rebuilds. A device is **bypassed by neutralizing it
in place** via its `apply` (filter → 20 kHz, comp → neutral, wet gains → 0, shaper → null
curve), so on/off never reconnects — only add/remove/reorder do.

**Master chain** — `sum → [devices] → anOut`, persisted in localStorage (`ain-master-fx`);
fresh visitors get the classic five (filter · comp · space · crush · reverb), all bypassed.
Mutations: `engine.addMasterDevice(type)`, `removeMasterDevice(id)`, `moveMasterDevice(id, to)`,
`setMasterDeviceParams(id, params)`; `engine.masterDevices()` reads. The safety limiter is NOT
in the chain — it's the fixed tail, controlled by `engine.limiter` + `engine.setLimiter(patch)`.
The MASTER track's fader is `engine.masterVol` / `setMasterVol(v)` (the final `master` gain,
persisted in `ain-master-vol`).

**Per-track chains** — each arrangement track strip is `gain → [devices] → pan → sum`,
persisted on the track (`ArrTrack.devices`, absent = no FX). Mutations mirror the master:
`addTrackDevice(trackId, type)`, `removeTrackDevice(trackId, id)`, `moveTrackDevice(trackId,
id, to)`, `setTrackDeviceParams(trackId, id, params)`; `trackDevices(trackId)` reads. All
mutations emit `"fx"`.

**Gain staging + metering (channel-strip mixer).** Track/master volume is **linear gain in
`[0, GAIN_MAX]`** where `GAIN_MAX = db2lin(6)` (≈ +6 dB headroom above unity). New tracks default
to **unity (`vol: 1`, 0 dB)**. Faders use a **dB taper** ([db-fader.ts](db-fader.ts), self-checked
in `db-fader.check.mjs`): position `p∈[0,1]` maps unity at `p=0.75`, `+6 dB` at the top, `−60 dB`
→ −∞ below — two segments linear-in-dB (equal travel = equal dB). `posToGain`/`gainToPos` are exact
inverses (legacy `vol` values just re-derive a position). **Per-strip metering**: each track strip
has a post-fader/post-FX `AnalyserNode` tapped off `pan` (`_arrStrips[].an`); `engine.trackLevel(id)`
→ `{rms, peak}` dB. `engine.masterLevel()` reads **either** tap per the `masterMeterPost` toggle
(`setMasterMeterPost`, persisted `ain-master-meter`): **pre** = `anOut` (program level before the
safety limiter + master fader — what the chain produces), **post** = `anPost` off the final
`master` node (after limiter + makeup + fader — what leaves the speakers). Toggle is the pre/post
chip in the master header. The
[TrackFader](components/arrangement/TrackFader.tsx) draws an integrated meter behind the groove
(RMS fill + 1.4 s peak-hold tick + clip latch at ~0 dBFS) via `useRafLoop` — imperative, never
React state; the dB readout is click-to-type. Same fader on track headers and the master row.

**UI** — [components/FxChainRack.tsx](components/FxChainRack.tsx) is the generic chain editor
(device panels, add-dropdown, ✕ remove, per-device power dot), bound to a chain purely through
callbacks. It renders as ONE non-wrapping row that scrolls horizontally forever (always-visible themed
scrollbar via the `.fx-scroll` escape hatch in `src/index.css`, plus scroll-state-driven edge
fades with accent chevrons whenever content is clipped — the explicit affordance on browsers
that hide overlay scrollbars); each device folds Ableton-style (▼ in its header) to a slim
vertical strip — ▶ + power dot + rotated name, click to expand. Fold state is UI-only, never
persisted with the chain. [components/audio-lab/FxRack.tsx](components/audio-lab/FxRack.tsx) binds it to the
master chain + the LIMIT tail (always visible in the audio lab as "visitor fx"; in the studio it
toggles from the pinned MASTER track row's `fx` chip — the mix bus rendered as its own
Ableton-style track under the track list, with the master fader). The studio's per-track panel
(`TrackFxPanel` in ArrangementPage) binds it to a track. Each device has a
**⠿ drag handle** that reorders via **pointer events** (mouse + touch + pen — not HTML5 DnD,
which doesn't fire on touch). The handle captures the pointer; `onPointerMove` hit-tests the
device under the pointer (`elementFromPoint` → `data-fxid`) and live-reorders with **take-the-slot**
semantics (target index = hovered device's index in the full list → insert-after when dragging
right, insert-before when dragging left, so a 2-device chain swaps both ways). The handle is a
separate target from the knobs, so knob-dragging is unaffected; `touch-none` on it stops the
page scrolling mid-drag.

## Loudness safety (two independent safeguards, both default ON)

Saturation, resonance, and stacked delay feedback can all spike level — and with a reorderable
chain the peak is unpredictable. Two guards, deliberately separate:

1. **Crush auto-gain** (the crush device's `autoGain` param, default on) — the device's `apply`
   trims its makeup gain by `1/sqrt(1 + drive·3.5)` as drive rises, so driving the waveshaper
   changes _grit_, not _loudness_. Toggleable per the "auto" button on the CRUSH device.
2. **Safety limiter** (`engine.limiter`, default on) — a brickwall `DynamicsCompressorNode`
   (ratio 20:1, fast attack, ceiling ≈ −1.5 dBFS) in the **fixed tail after `anOut`**, _outside_
   the master chain so it can never be moved, removed, or bypassed by reordering. Catches any
   peak regardless of device order. User-toggleable (off = audition raw output, at their own risk).
   `engine.getReduction()` returns its live gain reduction (dB) — the LIMIT device's "peak" LED
   lights when it engages (rAF-driven, imperative, lint-safe).

## Click safety (declick) — how the engine matches pro-DAW practice

Any time a buffer/oscillator source is `stop()`ed while its gain is non-zero, the waveform is cut
mid-cycle → a click. The engine avoids this everywhere a source starts/stops:

- **Note release** (`releaseVoice`) — `cancelAndHoldAtTime` holds the amp-env level, then an
  **exponential** decay (`setTargetAtTime(0, …, r/3)`); the source is stopped ~6 time-constants later so
  the tail rings out naturally (a linear ramp sounded abrupt and re-articulated on the next chord).
- **Transport declick** — the "tiny fade at play and stop" every pro DAW ships (REAPER names it exactly
  that; ~10 ms, kept ≤15 ms so the stop stays tight/performative). Applied via `AudioEngine.DECLICK`:
  `startSources` fades the track tap gains 0→1 on start; `stopSources` fades 1→0 then stops just after;
  `stopLoops`/`stopOneLoop` fade each loop's gain to 0 then stop. Gain-only ramps don't touch source
  _timing_, so the A/B **phase-lock invariant** is preserved.
- **Synth drums** already use `exponentialRampToValueAtTime(0.0001)`; every **FxChain rewire**
  (add/remove/reorder) ducks the chain's own output gain around the reconnect.

**Deliberately NOT declicked** — parameter automations (FX mix, channel vol/pan, level-match, delay/
reverb) already ramp via `setTargetAtTime` with time constants (zipper-free); adding fades there would
be redundant. And native-DSP hygiene (denormals, lock-free, block processing) is the **browser's** job —
Web Audio nodes run in its C++ audio thread; we only schedule `AudioParam` goals ahead of time (the
control-rate/audio-rate "two-speed" split, done via the lookahead scheduler). Zero-crossing snapping is
an _editing_ technique, not a real-time transport one, so it doesn't apply here.

## Sequencer scheduler + piano roll

The piano roll plays a **clip** (a bar-length phrase of notes in musical time) through a
**lookahead scheduler** in the engine.

**Voice factory (shared).** `noteOn`/`noteOff` were refactored into `startVoiceAt(midi, vel,
when)` → `VoiceHandle` and `releaseVoice(handle, when, instant?)`, both taking an **explicit
context time**. The live keyboard wraps these (keying held notes by MIDI); the scheduler calls
them directly with future `when` values (it can't key by MIDI — a phrase repeats pitches). One
voice factory, two callers (the live keyboard and the lookahead scheduler).

**Clip model** ([data/clips.ts](data/clips.ts)). `Note { id, pitch, start, length, vel }` with
`start`/`length` in **beats** (float; `seconds = beat * 60 / bpm`). `NoteClip { bars, beatsPerBar,
notes }`. Each preset ships a `defaultPhrase` (authored with the `phrase()` helper in
[data/presets.ts](data/presets.ts)); the roll clones it (`cloneClip`) so edits never mutate the
shipped data.

**The scheduler** (Chris Wilson, ["A Tale of Two Clocks"](https://web.dev/articles/audio-scheduling)).
A `setInterval(~25 ms)` walks
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

**Consolidate = real bounce (audio).** `consolidateSelection()` (⌘J) is async: audio tracks
render their selected clips through an `OfflineAudioContext` (`renderAudioSpan`) into ONE new
stereo buffer — clip-level gain/rate/trim/loop/reverse are printed, track FX/vol/pan are NOT
(Ableton semantics; they keep applying live). The voicing comes from `audioClipSource(clip, bd)`,
the same resolver the live scheduler uses, so the bounce sounds exactly like playback. The result
lands in the import store (`encodeWav` in [data/audio-store.ts](data/audio-store.ts) → float32
WAV bytes in IndexedDB) as a clean full-width clip tempo-tagged at the bounce bpm. No decoded
buffers yet (rare) → falls back to the old keep-earliest-source merge. MIDI/drum consolidation
(note merge) is unchanged. Mutation happens synchronously AFTER all rendering, under one undo.

**Timeline audio waveforms (playback truth).** Audio clips draw their waveform on the timeline
via `engine.audioClipWave(clip)`: |peak| buckets of the EXACT buffer playback uses (same
`audioClipSource` resolver — reversed/xfade-baked variants cache per-buffer in a WeakMap), plus
the geometry to map each pixel's clip-beat → buffer seconds (start offset, rate, auto-loop wrap,
cut at content end). Cached per clip, keyed on the clip's audio params + bpm + length.
**Tempo source of truth:** all arrangement-domain geometry (wave, bounce) reads
`arrangement.bpm`, never the transport clock `engine.bpm` — the transport can sit at another
page's tempo until play. They're kept in lockstep anyway (boot + `setArrangementBpm` sync
`bpm` unconditionally, `playArrangement` re-asserts it), so playing never "snaps" the picture. Because
`secPerBeat` is part of the mapping, an **unsynced** clip's wave stretches/squeezes across beats
as the tempo changes — the picture at any beat is always what plays there. **Content boundaries**
are drawn from the same geometry: the wave tapers (~12 px) into every **loop-wrap seam** (dark
separator line, one per auto-loop pass at `contentBeat(loopEnd) + k·period`) and into the
**one-shot content end** (bright cap — sound left of it, silence right); a bright cap also marks
content start at the clip's left edge. This boundary math is the intended base for future clip
manipulation UI (stretch/squish/cut handles). The engine enforces
the same law on live playback: audio clips are **beat-anchored** (content position ≡ clip-beats ×
sec/beat), so on a tempo change `setBpm` re-rates synced nodes (tape warble) and **stops +
re-fires unsynced nodes** at the corrected catch-up offset (dedupe key dropped, scheduler
re-fires same tick). **Unsynced clip LENGTHS are time-true**: `setArrangementBpm` rescales their
`lengthBeats` by the tempo ratio (start stays beat-anchored, the END moves), so a tempo change
never cuts a sample short nor makes it re-loop — a clip that exactly fit its content keeps
fitting at every tempo. Deliberately no overlap resolution on rescale (trimming neighbors every
tick of a tempo drag would be destructive); overlaps resolve on the next user edit.

**⌥+edge-drag = STRETCH (all clip kinds).** Plain edge-resize tiles/cuts content (and the
timeline previews now TILE at true beat scale — they used to draw content stretched across the
block, which read as "resize stretches MIDI"). Holding ⌥ while dragging the edge stretches the
CONTENT to the new length via `engine.stretchClipTo`: MIDI/drum scale their notes (lossless;
the step grid hatches off-grid results; grid-only patterns convert to notes first) and
`bars`/`steps` follow; audio stores a cumulative `stretch` factor (1/16×–16×) that divides the
warp ratio — **pitch-preserved under beats/complex**, tape-style under off/varispeed
(`audioClipRate` divides by it). The factor telescopes correctly across a drag (re-derived per
move) and joins the wave cache key.

**Multi-clip mouse drag.** Dragging a clip that's part of a multi-selection moves the whole
selection: the Timeline snapshots every selected clip's start at pointer-down and each move calls
`engine.dragSelectionTo(items, delta)` — a UNIFORM delta (clamped at beat 0, like
`nudgeSelection`) so the selection keeps its relative layout and selected clips can never trim
each other in `resolveOverlaps`; only non-selected clips under the drop get trimmed. Beat-move
only — cross-track hops stay single-clip (or ↑↓ keys); ⌥-dup during a drag reverts to
single-clip.

**Keyboard zoom.** `+`/`−` (and ⌘+/−, intercepted from browser zoom) zoom the timeline around
the viewport center — same math as ⌘+wheel. The Timeline publishes `{ zoom(factor) }` into a
`zoomApiRef` prop; the page's single keyboard authority calls it (no canvas focus needed).
**⌘1/⌘2** step the snap grid finer/coarser, Ableton-style — **pane-aware**: with the timeline
focused they walk the timeline ladder (bar → 1/4 → 1/8 → 1/16 → 1/32, `engine.snapBeats`);
with the editor focused they walk the piano roll's OWN grid (`engine.rollSnapBeats`,
1/4 → 1/32, its select lives in the roll's lane strip). The two snaps are deliberately
independent — editing notes at 1/32 shouldn't coarsen clip placement or vice versa.
**Ruler scrubbing is grid-quantized**: a seek re-anchors the clock + restarts sources, so the
scrub target rounds to the snap grid (whole beats when snap is off; ⌘ = free) and re-seeks only
when it crosses onto a NEW gridline — never continuously with the mouse.

**ONE cursor (merged insert-marker + playhead, Ableton-style).** There is a single arrangement
cursor: `engine.insertBeat` is the stopped position (paste/create/split anchor AND where play
starts), and while playing the live playhead `currentBeat()` takes over.
`engine.arrangementPosition()` resolves whichever applies — the Timeline draws exactly ONE line
from it: **solid white while playing**, else a **dotted accent line with a downward ruler
triangle tag** (the old separate dashed insert-marker is gone; `_pendingSeekBeat` was deleted —
`insertBeat` is the single stopped-cursor value written by `_doSeek`'s stopped branch,
`pauseArrangement`, `stopArrangementToStart`, and `playArrangementFromCursor`). Cursor keys
(timeline pane, NO clip selection): **←/→** step the cursor by the snap grid
(`moveCursor(dir, fine)` — on-grid steps a full grid unit, off-grid snaps to the near line,
clamped ≥ 0; self-checked in the scratchpad `cursor-check.mjs`); **⌘←/→** fine-steps 1/16;
**⌘⇧←/→** jumps to the previous/next CLIP EDGE across all tracks (`cursorToClipEdge` — the
sorted set of every clip start/end plus 0); **Home/End** = `cursorToStart`/`cursorToEnd`
(beat 0 / arrangement end). While STOPPED these move the marker; while PLAYING they route
through `seekArrangement`, so arrow-scrub honors launch quantize below (deliberate — queued,
Ableton clip-launch feel; confirmed by the user). With clips selected, ←/→ keep their
nudge/resize meaning (unchanged).

**Launch quantize** (`engine.launchQuant`, beats, 0 = off; separate `launch` selector in the
playback pane, persisted `ain-launch-quant`). While PLAYING, `seekArrangement` doesn't jump
immediately — it QUEUES a `_pendingLaunch = { target, atBeat }` and lets the playhead keep
rolling until it reaches the next quantum boundary (`nextQuantBoundary`, which respects an active
loop brace: boundaries measured from the brace start, a boundary at/after the brace end wraps to
the brace start). `schedTick` fires the queued launch at its boundary via `_doSeek` (the shared
re-anchor jump). Re-aiming (a new seek before the boundary) replaces `target` but keeps the same
`atBeat` — Ableton clip-launch feel. Cleared on stop. The timeline draws a dashed accent line +
ruler triangle at the pending target (`engine.pendingLaunch()`). Launch-quant OFF or stopped =
the old immediate seek. The timeline GRID follows the snap setting:
sub-beat lines (faint) appear at the snap subdivisions when they have ≥6px of room, and
bar-snap hides the beat lines between bars — the drawn grid always shows where things will land.
Drum clips draw a mini hit preview on their timeline blocks (piano-roll notes = truth,
`lane = pitch − DRUM_BASE`; grid fallback for notes-less clips). The track/master `fx` chip
glows ONLY while that chain's pane is open (a has-devices glow on every track caused
wrong-track edits); device count lives in the chip's tooltip.

**Pane key focus (Ableton/Logic last-clicked-area model).** The studio has two key-focus panes:
the **timeline** (default — toolbar, track headers, canvas, master row) and the **editor** (the
bottom region: Instrument, clip editor / piano roll, FX panels). Clicking a pane takes key
focus (pointer-down capture; double-click-to-edit focuses the editor); the focused pane shows a
subtle accent ring while the editor is open. **Transport (Space/Home/L) + undo (⌘Z/⇧⌘Z/⌘Y) are
global**; every other shortcut is timeline-scoped and simply skipped when the editor has focus —
the piano roll's own keys (on its DOM-focused canvas) then act alone. Taking focus back to the
timeline blurs any focused canvas so keys can never double-fire. When the editor region closes,
focus falls back to the timeline.

**WARP MODES — the per-clip algorithm dropdown (Ableton-style).** `warpMode?: "off" |
"varispeed" | "beats" | "complex"` on audio content, resolved via `warpModeOf` (legacy
`sync` → varispeed, `warp` → complex — old saves keep working; the dropdown clears the legacy
flags on write). **off** = natural rate, time-true length. **varispeed** = tape re-rate to the
grid (`bpm/rootBpm` × transpose varispeed; live warble on tempo change). **beats** = the DRUM
warp: `beatsRender` slices the source at ITS OWN 1/16 grid (rootBpm) and plays each slice at
natural rate (transients never stretched) on the re-spaced output grid — gated gaps when
slower, edge-crossfaded overlaps when faster; transpose = per-slice resampled repitch; pure
buffer math, rendered offline per settled tempo (armed-once debounce `requestBeats`, tape
fallback meanwhile), cached in `_warpCache` keyed by algo. **complex** = the live
signalsmith-stretch node below.

**COMPLEX — pitch-preserving tempo-fit + duration-preserving transpose.** Powered by
[signalsmith-stretch](https://signalsmith-audio.co.uk/code/stretch/) (WASM/AudioWorklet — see
CREDITS.md). **Live playback = one persistent stretch node per warp clip** (`_stretch`,
`ensureStretchNode`): input buffers load once per buffer/reverse variant (channel COPIES —
the worklet may transfer), `configure({blockMs: 80})`, node → per-clip gain → track strip.
The scheduler fires it via `schedule({output, active, input, rate, semitones, loopStart/End})`
with its own `_stretchFired` dedupe; one-shot content deactivates at
`min(clip end, content end)`. **A tempo change just re-schedules `rate`** — pitch stays locked
through the whole drag and the input position stays beat-continuous because a warp clip consumes
exactly `60/rootBpm` input-seconds per beat at ANY tempo (self-checked invariant). `audioClipSource`
is called with `noWarpSwap` for the live path so rate/positions are in original-buffer terms.
The tape-style tempo-fit fallback covers only the async node warm-up (and node failure);
`stopAudioForClip`/`stopAudioClips` deactivate nodes + clear passes; nodes dispose on clip/track
delete, warp-off, and newProject; `loadPersistedAudio` pre-warms restored warp clips. OFFLINE
renders (`stretchRender` in an `OfflineAudioContext`, `_warpCache`) remain for the ⌘J bounce
(awaited — never prints the fallback). Warped clips keep a constant beat-span across tempo
changes (excluded from the time-true length rescale). No `rootBpm` ⇒ ratio 1 — warp still gives
duration-preserving transpose.

**Auto-normalize (deferral #7).** Per-clip `norm?: boolean` (new imports default ON): `peakOf`
full-scans the buffer once (WeakMap-cached) and `audioClipSource` folds `min(8, 0.89/peak)`
(≈ −1 dBFS target, +18 dB cap) into the effective gain — scheduler, bounce, and the timeline
wave (which now reads `wv.gain`) all agree. The gain knob rides on top; `norm` toggle in the
clip editor.

**Per-clip audio loop toggle + content-end magnet.** The audio content's `loop?: boolean`
(absent = ON, so old saves keep looping) gates the auto-loop: OFF = **the clip is pinned to its
material** — `clipContentCap` clamps `lengthBeats` to the content's span in every path
(`resizeClip`, `resizeSelection`, and `setClipContent`, so toggling loop off or shrinking the
content via trim/transpose/sync pulls an over-long clip's edge in). The edge simply stops at
the sample's end; no silence tail, no loop slivers. Toggled in the AudioClipEditor (`loop on/off` chip next to
sync/rev); it's a STRUCTURAL live-clip change (stop + re-fire) and part of the wave cache key.
Edge-resize also has a **content-end magnet**: when the snapped edge lands within half a grid
step (or 6 px) of where the sample actually ends, it snaps exactly there.

**Per-clip swing (arrangement clips, optional).** `ArrClip.swing` ∈ (0.5, 0.75] — absent/0.5 =
straight. MPC/Ableton-style: the 2nd 16th of every 8th-note pair lands `swing` of the way through
the pair (2/3 ≈ triplet feel, 0.75 = hard). Applied **at schedule time** via
`swingDelay(clipBeat, clip.swing)` ([data/arrangement.ts](data/arrangement.ts)) in `schedTick`'s
three emit paths (MIDI runs — the head is delayed, the run rides rigidly; drum notes; drum grid
steps). Stored notes stay straight (lossless — the roll/grid always shows the unswung truth), the
warp is piecewise-linear per pair so pair boundaries are fixed and off-grid hits shift
proportionally. Set via `engine.setClipSwing(trackId, clipId, v)` — the swing knob in the clip
editor (MIDI + drum clips; audio clips don't swing). Undoable as **one step per knob gesture**
via `pushUndoCoalesced(key)` — rapid same-key pushes (<1.2 s apart) collapse into the
pre-gesture snapshot; any discrete `pushUndo`, a different key, a pause, or undo/redo breaks the
run (the generic mechanism for continuous params whose UI has no pointer-down hook).
**Clip-content commits use it too** (`setClipContent` → `"content:"+clipId`): piano-roll /
drum-grid gesture commits and audio-param knobs are each one ⌘Z step — internal callers that
already pushed a frame pass `undoable=false`. ⌘Z itself is GLOBAL (one app-wide history).
Undo keeps the editor open: `_restoreArrangement` retains the selection ids that survive the
restore, and bumps `engine.undoStamp` — the ClipEditor keys its roll/grid on `clipId + stamp`,
remounting them with the restored content (they edit a working copy, so a remount is what
prevents a stale roll from re-committing old notes).
**Track vol/pan and the master fader use the same mechanism** — undo snapshots are `UndoSnap { a,
masterVol }` (the master fader isn't arrangement state), and `_restoreArrangement` re-syncs the
live mixer: master gain, strip gains/pans, and each strip's FX chain when the restored device
list differs. Legacy beat-mode keeps its separate `sequence.swing`.

**Playback pane** ([components/arrangement/PlaybackPane.tsx](components/arrangement/PlaybackPane.tsx))
— the arrangement transport. Verbs: `toggleArrangement` (play/stop; play starts FROM the cursor),
`playArrangementFromCursor`, `pauseArrangement` (writes the stop position back to `insertBeat` —
the ONE cursor; resume plays from there), `stopArrangementToStart`/`returnToStart`
(home = loop-brace start if looping else 0). `setBeatsPerBar` (time sig), `setArrangementBpm` +
`tapTempo` (averages recent tap intervals), `setArrangementLoop` (numeric bar range or shift-drag),
`setSnapBeats` (Timeline clip snap grid; 0/⌘ = free), `setFollowPlayhead` (Timeline auto-scrolls to
keep the playhead in a band). **Metronome**: `metronome`/`metronomeVol` → `metroClick` (square blip,
2 kHz accent on the bar downbeat / 1.4 kHz else) fired per integer beat in the arrangement branch,
deduped via `_metroThrough`. **Count-in**: `countInBars` (0–2) pre-schedules that many bars of click
before the anchor, pushing `_seqAnchorTime` forward. Keyboard: Space = play/stop (from the cursor),
Home = `cursorToStart`, End = `cursorToEnd`, L = loop; ←/→ move the cursor when nothing is
selected (⌘ fine, ⌘⇧ clip edges — see the ONE-cursor section).

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
- **Edit (mouse):** **double-click empty → create** (snap 1/16; a plain click only deselects —
  Live's EDITOR mode, not Draw mode) · drag a selected note → move the whole selection ·
  drag right edge → resize the selection · **hold ⌘/ctrl/⌥ to bypass snap** · **⌥+drag → duplicate**
  the selection (clone-in-place then move) · double-click / right-click a note → delete.
- **Edit (keys, when focused):** ←/→ nudge · ⌥+←/→ nudge without snap · shift+←/→ resize · ↑/↓
  transpose semitone · **shift+↑/↓ octave** · **⌘/ctrl+↑/↓ velocity ±10** · **0 mute/unmute**
  (deactivate, Ableton: gray + never voiced — `Note.muted`, filtered in `buildRuns` and the
  drum-note path) · ⌘/ctrl+A select all · ⌘/ctrl+D duplicate (+1 beat) · delete/backspace · esc.
  A transpose/velocity change blips the representative note so you hear the edit. The same "0"
  on the TIMELINE pane deactivates the selected clips (`ArrClip.muted`, `toggleMuteSelection` —
  dim, skipped by `schedTick`, live audio stopped; undoable).
- **Navigate:** wheel → scroll pitch · shift+wheel → scroll time · ⌘/ctrl+wheel → zoom time around
  cursor · hold Space (or middle-drag) → pan. Wheel is a **non-passive native listener** so it can
  `preventDefault` the page scroll.
- **Automation lane** (switchable, collapsible) — a docked bottom band with a `VEL | VIB` tab + a
  collapse caret. The pitch grid renders into `gridH = h - laneH()` (`laneH` = `VEL_H` open / `LANE_TAB_H`
  collapsed). **VEL**: per-note velocity stems (drag/sweep). **VIB**: a free-draw **clip-global vibrato
  curve** — `AutoLane{target:"vibrato", points:[{beat,value 0..1}]}` on `NoteClip.autos`; click to add a
  breakpoint, drag to move, ⌘/ctrl-drag to freehand, right-click/⌥ to delete. The engine samples it
  (`sampleAuto`, piecewise-linear) and schedules the **vibrato LFO depth** along the curve over each
  note's window (`VIB_MAX_CENTS` at value 1). Two knobs overlay the lane (shown when VIB is open):
  **speed** (`AutoLane.rate` Hz, default `VIB_RATE` 5.5) and **depth** (`AutoLane.intensity`, 0..2 scale on
  the curve, default 1) — clip-global, set on the lane (not its points), copied by `cloneClip`, threaded
  through all three scheduler call sites (arrangement / beat channels / piano-roll).
  `Drag` modes `"vel" | "auto" | "autoDraw"`.
- **Portamento (FL-style, `Note.slide`)** — a `slide` note does **not** articulate a new voice; it bends
  the **previous note's still-ringing voice** to its pitch (no re-attack). The scheduler groups each
  clip into legato **voice runs** via `buildRuns()` (head note + chained slide bends), emitting **one
  voice per run**: `startVoiceAt(…, bends)` ramps the voice's pitch param through each bend point
  (sample → `src.detune` cents; synth → `osc.frequency`). Monophonic-per-channel — chord tones each open
  their own run and ring untouched, so a sliding lead over chords works by putting the lead on its own
  channel. Orphan slide (no run to continue) articulates normally. Glyph: amber diagonal from the prev
  note's pitch into this note.
- **Vibrato** is now the **automation lane** above (clip-global curve → time-varying LFO depth), not a
  per-note value. `Note.vibrato` was removed.
- **Track length** — in beat mode the transport loops over the **longest** element (drum grid, any
  channel clip, any "on" loop) via `activeTotalBeats`, not the drum grid alone, so a long MIDI phrase
  isn't cut at the grid length. The drum pattern tiles over its own grid length to fill the longer track.
  (Stopgap until a real timeline.)
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

## Drums (kit voices + the drum-pattern model)

The standalone beat-maker (its own route, step grid, melodic MIDI channels, and loop lanes) was
**removed 2026-07-13** — `/beatmaker` redirects to `/studio` and the whole parallel scheduling
path (`beatMode`, `playBeat`, `startLoops`/LoopLane scheduling, `sequence.channels`, the global
drum mute/solo) is gone. Drums now live **only** as arrangement drum clips
(`{kind:"drum", pattern}`) on the timeline. What remains:

- **Kits** ([data/kits.ts](data/kits.ts)): `DrumKit` = named `DrumLane`s (kick/snare/hat/clap/tom);
  one-shots **auto-discovered** from `src/assets/kits/<kitId>/<laneId>.m4a` — see
  [../assets/kits/README.md](../assets/kits/README.md). `loadKit(kit)` decodes them; `voiceDrum(lane,
when, vel, dest)` plays the one-shot if present, else the **engine-synthesized** `synthDrum()`
  (pitched-sine kick, filtered-noise snare/hat/clap, tom, rim). Zero assets required.
- **The pattern model** — `SequenceClip = { steps, beatsPerBar, kitId?, bpm, swing, on, accent,
laneMix }` is the DRUM CLIP's data (edited in `DrumClipGrid` + the kit-labeled piano roll; see
  [[drum-midi-bridge]]). The scheduler's arrangement drum branch voices it via `voiceDrum` into the
  track strip, honoring the clip's own `laneMix` (per-clip mute/solo) and swing. `STEP_BEATS = 0.25`
  (a step = 1/16). `defaultSequence()` still ships a starter groove used as the new-drum-clip seed.

**Not yet wired to UI** (engine seams exist, no callers): `loadReverbIR`/`useSynthReverbIR`
(real IR files).

## Preset sampler (the sample _catalog_ — how zones decode)

`SampledPreset`s are the **source catalog** for the sample voice source (not a parallel current-instrument
selector). Each is seeded into `engine.patches` as an editable patch at boot (see the unified-instrument
section). `loadPreset`/`warmPreset` lazily fetch + decode a preset's zone files (`fetchBuf`);
`pickZone(preset, midi)` picks the nearest-root zone (±7-semitone shift cap) and playback uses
`playbackRate` from that root. There is **no separate sampled voice branch** anymore — a sampled patch's
`sample` source runs through the same filter + envelopes + LFO as the oscillators (`startVoiceAt`).
Presets are **auto-discovered** from `src/assets/presets/` at build time — see
[../assets/presets/README.md](../assets/presets/README.md) for the folder/file convention,
multisampling, and formats. `presetC4Zone`/`presetPeaks` back the C4 waveform strip.

## Unified instrument — subtractive synth + sample source (`data/patches.ts` + `startVoiceAt`)

**One voice path, one instrument model.** There is no longer a separate sampled branch: a sampled
multisample is just another source into the shared spine. Every instrument — built-in, user-designed, or
sampled preset — is a `SynthPatch`.

**Signal path:** **osc1 + osc2 + sub + noise + SAMPLE → per-source level gain → multi-mode filter →
amp gain → dest**. Two independent ADSRs (filter env on cutoff with `amt` + key-track; amp env on the
gain) and **one routable LFO** (off / pitch→detune / cutoff→`filter.frequency` / amp→`gain`). Portamento
`applyBends` drives **every** pitched source (osc frequency + sample detune); per-note vibrato and the
patch LFO coexist. Noise buffers (white / [Paul Kellet](https://www.firstpr.com.au/dsp/pink-noise/)
pink) are built **once** and cached. `releaseVoice`
stops oscs + sub + noise + **sampleSrc** + all LFOs. A voice is ≤ ~14 nodes (bounded vs. the 256-voice cap).

- **Sample source** (`SynthPatch.sample: SampleSource`) — a `SampledPreset`'s multisample used like an
  oscillator, through the SAME filter + envelopes + LFO as the oscs. Fields: `presetId`, `level` (0..4 —
  **>1 is makeup gain**, up to +12 dB), `loop` (one-shot vs. sustained), `semi`/`cents`
  (**independent varispeed transpose**, speed-coupled — pitch and duration move together, decoupled from
  the played note), `start`/`end` (0..1 playback window into the buffer), `loopStart`/`loopEnd` (0..1,
  default to the window). Zone pitch comes from the picked zone's root via `playbackRate`; the window is
  applied through `s.start(t, offset, duration)` (one-shot) or `s.start(t, offset)` + `s.loop` (sustain).
  Buffers cached by **preset id** (`_sampleBufs[id]`), so instruments sharing a preset share one decode.
- **Filter ON/OFF** — `filter.on` (omitted = enabled). Bypass swaps the biquad to `allpass` (flat
  magnitude, path shape unchanged); the cutoff envelope + cutoff-LFO are skipped.
- **Voicing** (`SynthPatch.voices`, absent = poly · 1 voice) — Serum-style: `mode` poly/mono,
  `unison` (1–8), `detune` (cents at the stack extremes), `width` (stereo spread 0–1). Unison
  replicates **osc1/osc2 only** (sub/noise/sample stay single/centered): voice k of N sits at
  `k∈[−1,+1]` symmetric → `detune·k` cents through a per-voice `StereoPanner` at `width·k`,
  levels normalized by `1/√N` (constant power). Odd N keeps an exact center voice; the spread
  centers on each osc's own cents. **Mono = last-note priority per destination**: starting a
  note fast-releases the voice still sounding into that dest (`_monoVoices` map; releaseVoice is
  double-stop safe). Edited in the Instrument panel's VOICES tab — which always writes the FULL
  `voices` object (deepMerge over an absent field would store a partial).
- **Patch store** — `engine.patches` = `BUILTIN_PATCHES` (glass pad / neon pluck / sub bass) merged over
  user patches (`localStorage["ain-synth-patches"]`), **plus one seeded patch per sampled preset**
  (`seedPresetPatches`, keyed by preset name, `patchFromPreset` → sample source on). `engine.synthPatches`
  (the keys) is the **single unified instrument list** used everywhere. `resolvePatch(id)` accepts a patch
  key OR a legacy raw preset id (resolves to the seeded name-patch); `warmPatch`/`warmPreset` pre-decode
  zones. API (all emit `patch`): `updateActivePatch(deepPartial)` (live edit, latched per next note),
  `saveUserPatch`, `deleteUserPatch`, `revertPatch`, `isBuiltinPatch`. Built-ins edit live but never persist.
- **INSTRUMENT panel** — [components/audio-lab/Instrument.tsx](components/audio-lab/Instrument.tsx) merges
  the old PRESET LAB + SYNTH into one panel: instrument selector (`synthPatches`) + patch bar + on-screen
  `PresetKeyboard` + a **tabbed dashboard** (SOURCES / FILTER / AMP / LFO). Live visuals:
  [EnvGraph](components/audio-lab/EnvGraph.tsx) (ADSR curve, on AMP + FILTER tabs),
  [FilterGraph](components/audio-lab/FilterGraph.tsx) (|H(f)| response via
  [RBJ](https://www.w3.org/TR/audio-eq-cookbook/) biquad math in
  [filter-math.ts](components/audio-lab/filter-math.ts), no AudioContext), and
  [SampleWave](components/audio-lab/SampleWave.tsx) (C4 waveform with **draggable start/end + loop
  handles**). Subscribes to `["patch","synth","preset","midi"]`.
- **Alignment** — the arrangement track picker (`ArrangementPage`) lists `synthPatches`;
  `setTrackPreset` stores a patch key and `warmPatch`es it. `trackVoice` → `{ patch:
resolvePatch(presetId), dest }`. Legacy arrangement `presetId`s (raw preset ids) are migrated to
  patch-key names at boot.

## Reverb impulse response

Default is a **synthesised IR** (`makeReverbIR`): exponentially-decaying, lightly low-passed,
L/R-decorrelated noise. The `decay` knob regenerates it. To use a **real IR file** instead, call
`engine.loadReverbIR(url)` — it fetches/decodes via `fetchBuf`, pins the convolver buffer, and
disables decay regeneration; `engine.useSynthReverbIR()` reverts. Real IRs can live alongside the
preset assets and be loaded on demand (no fixed convention wired yet — add one when needed).

## Events (`EngineEvent`)

`state | wet | fx | track | ready | synth | preset | transport | clip | midi | patch | arrange`. Subscribe with
`useEngine([...])` (the hook force-re-renders on those events). **The union is duplicated** in
[hooks/useEngine.ts](hooks/useEngine.ts) — update both when adding an event.

## Gotchas

- **esbuild build does not typecheck.** Run `npx tsc --noEmit` (a few _pre-existing_ errors live
  in the surviving old `src/components/*` files; lint + build are the real gates).
- **react-hooks v7 purity** — no `ref.current = x` or `performance.now()` _during render_. All
  imperative meter/LED drawing happens inside `useRafLoop` callbacks (see `LimitLed`, `LevelMeter`).
- **Canvas/SVG read `--accent` at runtime** via `getComputedStyle`, so theme changes are live.
