# CLAUDE.md

DAW "session view" audio portfolio for `audio.actuallyitsnathaniel.com` — a dark, near-black,
Ableton-flavored UI with a working Web Audio engine at its center. **React 19 + Vite 7 + React
Router 7 + Tailwind 4 + TypeScript.** Deploys to Vercel.

## Commands

```bash
npm run dev      # Vite dev server, port 3000
npm run build    # Vite/esbuild → build/
npm run lint     # eslint (must stay clean)
```

## Architecture

The live site is **`src/daw/`**. Almost everything is there.

- **`engine.ts`** — vanilla Web Audio singleton (`export const engine`). One `AudioContext`, an
  equal-power dry/wet crossfade, level-match, a filter→delay→waveshaper FX chain, RMS/peak metering,
  decoded-peak waveform cache, `localStorage` position persistence, and a preset synth. Pub/sub via
  `engine.on(event, fn)` / `engine.off(...)`; events: `state | wet | fx | track | ready | synth`.
- **Hooks** (`src/daw/hooks/`): `useEngine(events?)` (subscribe + re-render), `useRafLoop(fn)`
  (rAF loop with a stall fallback), `useMediaQuery(q)`.
- **Shell**: `DawShell` (fixed transport bar + audio-reactive bg canvas + sets the default track)
  wraps both the home and the project route.
- **Home sections**: `Hero`, `ProjectsSection`, `AudioLabSection`, `PressSection`, `ContactSection`
  (assembled by `DawHome`).
- **Audio Lab**: `components/audio-lab/{AudioLab, ABDial, FxRack, LabErrorBanner}` +
  `components/preset-lab.tsx`.
- **Primitives**: `components/{Knob, LevelMeter, Spectrum, Waveform, DeviceShell, SectionHead,
  RoleChip, PlayButton, TimeReadout, TrackSection, Discography}`.
- **Data** (typed, art via Vite imports): `src/daw/data/{projects, discography, site, tracks}.ts`.
- **Shared utils**: `src/daw/lab-utils.ts` (`loadLabEntry`, `scrollToId`, reusable class strings),
  `src/daw/lab-time.ts` (`fmtTime`, `labDuration`).

**Routing** ([src/main.tsx](src/main.tsx)): `/` → [src/routes/root.tsx](src/routes/root.tsx) (DAW
home); `/projects/:projectId` → [src/routes/music/project-page.tsx](src/routes/music/project-page.tsx)
(lazy → `daw/DawProjectPage`); `/events`; `/secret`.

**Old code is deleted.** The only surviving pieces under `src/components/` are
`{seo, navbar, footer, video-background}` — and they're used **only** by `/events` and `/secret`.
The previous home/about/projects-strip and the per-artist `routes/music/projects/*.tsx` pages were
removed. Don't go looking for them or recreate those patterns; build new UI in `src/daw/`.

## Conventions & gotchas

- **Tailwind 4**: design tokens live in `@theme` in [src/index.css](src/index.css). `tailwind.config.js`
  is legacy and ignored — don't add theme values there.
- **Mobile breakpoint is `max-[767px]`** (matches `useMediaQuery("(max-width: 767px)")`). Secondary
  layout breakpoint at 980px.
- **Build (esbuild) does not typecheck.** Run `npx tsc --noEmit` to surface type errors — but note a
  few *pre-existing* ones live in the surviving old files; the build and lint are the real gates.
- **Lint enforces React purity** (`react-hooks` v7): no `ref.current = x` or `performance.now()`
  *during render*. See `hooks/useRafLoop.ts` and `TransportBar.tsx`'s `CpuMeter` for the accepted
  patterns (assign refs in an effect; lazy-init refs).
- **Canvas/SVG read `--accent` at runtime** via `getComputedStyle`, so theme changes are live.
  Meters/waveform/spectrum are **imperative ref-driven**, not React-state-driven — don't convert them.
- **Engine invariant — don't break phase lock.** The JLM mix↔master A/B starts both buffer sources on
  the *same* `AudioContext` sample (`engine` → `startSources`). Re-ordering or re-timing the source
  start will comb-filter the audio. Leave it alone.

## Pinned / not yet built

- **Project preview clips** — drop `public/audio/previews/<id>.m4a` and per-project labs come alive.
  Until then they show a graceful "no preview uploaded yet" state. (JLM is the flagship A/B pair and
  already works.)
- **Preset Lab → real sampler** — currently demo synth patches; needs bounced one-shots of real presets.
- **Stem isolation player** — not built; needs stem files.

## More detail

Design tokens, the accent-color derivation, layout/breakpoint conventions, and the plain-CSS escape
hatches → **[src/daw/DESIGN.md](src/daw/DESIGN.md)**.
