# DAW Design Reference

The visual system for the `src/daw/` redesign. Tokens are defined in
[`../index.css`](../index.css); see [`../../CLAUDE.md`](../../CLAUDE.md) for architecture.

## Color tokens

Defined in the `@theme` block of `src/index.css`. Each maps to a Tailwind utility.

| Token (`@theme`)     | Hex       | Tailwind utility            | Role                              |
| -------------------- | --------- | --------------------------- | -------------------------------- |
| `--color-daw-bg`     | `#0c0c0e` | `bg-daw-bg`                 | page background (near-black)      |
| `--color-panel`      | `#141418` | `bg-panel`                  | cards / panels                    |
| `--color-panel2`     | `#1a1a20` | `bg-panel2`                 | nested / hover surfaces           |
| `--color-inset`      | `#08080a` | `bg-inset`                  | wells (waveform, spectrum, meters)|
| `--color-line`       | `#242429` | `border-line`               | hairline borders                  |
| `--color-line2`      | `#32323a` | `border-line2`              | stronger / active borders         |
| `--color-daw-text`   | `#d8d8dc` | `text-daw-text`             | primary text                      |
| `--color-dim`        | `#8e8e98` | `text-dim`                  | secondary text                    |
| `--color-faint`      | `#5c5c66` | `text-faint`                | tertiary / numeric labels         |
| `--color-accent`     | `#54ADBD` | `bg-accent` / `text-accent` | **the one accent** (muted cyan)   |

### Accent derivation

`#54ADBD` is **muted cyan `#4FA8C7` blended 70/30 with the Adidas×Messi project teal `#5FB8A6`**
(70% blue + 30% messi, per-channel). The original prototype shipped amber `#E8A33C`; it was changed
to blue then nudged toward teal. If asked to re-tint, blend from these two anchors.

### ⚠ Accent is defined in THREE places — update all of them together

1. `--color-accent` in the `@theme` block (`src/index.css`) — drives all Tailwind `*-accent` classes.
2. `--accent` in the `:root` block (`src/index.css`) — read by canvas/SVG at runtime.
3. Hardcoded `#54ADBD` fallbacks in `BgCanvas.tsx`, `components/Waveform.tsx`, `components/Spectrum.tsx`
   (only used if the CSS var is missing, but keep them in sync).

(Out of scope but noted: this triple definition could be de-duplicated into one source later.)

## Typography

- `--font-display` → **Archivo** (`font-display`, the default body font) — UI, headings, copy.
- `--font-mono` → **JetBrains Mono** (`font-mono`) — *all* data labels, numbers, eyebrows, nav.
- Both loaded via a Google Fonts `<link>` in [`../../index.html`](../../index.html) `<head>`.

## Layout & responsive

- **Section frame**: `TrackSection.tsx` — a `[56px_1fr]` rail+body grid, `max-w-[1280px]`, centered.
  The left rail (track number) hides under `max-[767px]`.
- **Breakpoints**: `max-[980px]` (lab columns collapse, hero/portrait stack) and `max-[767px]`
  (single column, rail hidden, mobile-specific layouts below).
- **Mobile project detail = bottom sheet.** On `≤767px`, tapping a clip in `ProjectsSection.tsx`
  opens the detail as a dismissible bottom sheet (so the selection change is visible); desktop keeps
  the inline panel. Gated by `useMediaQuery("(max-width: 767px)")`.
- **Mobile Audio Lab reorder.** In `components/audio-lab/AudioLab.tsx`, the three columns use
  `order-1/2/3` on mobile and the artwork is dropped (`max-[767px]:hidden`) so the player surfaces
  immediately. Description stays in the meta block (above the player).

## Plain-CSS escape hatches (in `src/index.css`)

Things Tailwind can't express cleanly — reuse these, don't reinvent:

- CSS play/pause/spinner glyphs: `.icon-play` (+ `.small`/`.tiny`), `.icon-pause`, `.play-spinner`.
- Keyframes: `spin`, `blink` (+ `.cursor-blink`), `fade-in`, `sheet-up` (bottom-sheet animations).
- `.tbar-bg` — the translucent blurred transport bar (`color-mix` + `backdrop-filter`).
- `.scrollbar-hide` — used by the mobile transport nav and other routes.

## Reusable building blocks

- **Class-string constants** in `lab-utils.ts`: `abSnap`, `abSnapActive` (A/B + patch buttons),
  `lockChip` (sample-lock / preview chips). Import these instead of re-typing the long class lists.
- **`Knob`** (`components/Knob.tsx`) — SVG arc dial; vertical drag, double-click reset, `bipolar` mode.
- **`SectionHead`, `RoleChip`, `DeviceShell`, `TrackSection`** — the shared DAW chrome.
- **`loadLabEntry(track)`** (`lab-utils.ts`) — load any track into the global lab and scroll to it.
