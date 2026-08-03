# `.ain` on macOS — Finder icon, Quick Look, Open With

The `.ain` container is **audio-primary** (PCM16 WAV head + zip pack + `AIN1`
trailer). That makes the *bytes* playable in many media players. Finder still
keys icons and Quick Look off **extension → UTI**, not magic bytes alone — so a
downloaded `song.ain` will look like a generic document until something on the
Mac registers the type.

## Extension mask (Finder spacebar without a helper)

Same polyglot bytes; only the download name changes:

- Default: `project.ain`
- Optional: `project.wav` via **File → Save project… → “Save with .wav name
  (Finder preview)”** — Quick Look / Music treat it as audio; the studio still
  opens it by reading the `AIN1` trailer (Open accepts `.ain` and `.wav`).

No OS install required for that preview path.


## What macOS needs for friendliness

A small **app bundle** (Tauri / Swift / Automator-wrapped helper) that:

1. **Exports a UTI** for `.ain` (you own the type).
2. Declares it **conforms to `public.audio`** (and thus `public.data`) so Launch
   Services treats it as audio-ish for Open With / some system behaviors.
3. Ships an **`.icns`** (your refraction mark) via `UTTypeIconFile` /
   `UTTypeIcons` — Catalina+ resolves document icons from the **exported UTI**,
   not only `CFBundleTypeIconFile`.
4. Lists the type under **`CFBundleDocumentTypes`** with role `Editor` or
   `Viewer` and `LSItemContentTypes` = your UTI (so “Open With → AIN Studio”).
5. Optionally installs a **Quick Look Preview** / Thumbnail extension that either
   strips to the WAV head or reuses the system audio preview for `public.wav`
   after extracting `audioLen` from the trailer.

### Sketch `Info.plist` (exported type)

```xml
<key>UTExportedTypeDeclarations</key>
<array>
  <dict>
    <key>UTTypeIdentifier</key>
    <string>com.actuallyitsnathaniel.ain</string>
    <key>UTTypeDescription</key>
    <string>AIN Project</string>
    <key>UTTypeConformsTo</key>
    <array>
      <string>public.audio</string>
      <string>public.data</string>
    </array>
    <key>UTTypeIconFile</key>
    <string>AINFile</string>
    <key>UTTypeTagSpecification</key>
    <dict>
      <key>public.filename-extension</key>
      <array>
        <string>ain</string>
      </array>
      <key>public.mime-type</key>
      <array>
        <string>audio/wav</string>
        <string>application/vnd.ain.project+zip</string>
      </array>
    </dict>
  </dict>
</array>
```

Notes:

- Prefer **`UTExportedTypeDeclarations`** (you invent `.ain`) over imported.
- Conforming only to `public.wav` is tempting for Quick Look inheritance, but a
  custom extension usually still needs your own QL generator or a helper that
  hands the WAV slice to the system. Conforming to `public.audio` + custom icon
  is the honest model: it’s *your* format that *contains* audio.
- Put the `.icns` in the bundle **Resources** folder (not only an asset catalog)
  if using `UTTypeIconFile`.
- After install, verify with:

```bash
mdls -name kMDItemContentType -name kMDItemContentTypeTree song.ain
# expect com.actuallyitsnathaniel.ain (not dyn.…)
```

## Recommended product path

1. **Now (web):** polyglot `.ain` + in-app / PWA icon (done).
2. **Next:** tiny “AIN Opener” macOS app — registers UTI + icon, opens
   `https://audio.actuallyitsnathaniel.com/studio` with the file (or uses
   File Handling / custom URL). No need to ship the whole DAW natively.
3. **Later:** Quick Look extension that reads the `AIN1` trailer and previews the
   WAV head; optional thumbnail waveform.

PWA `file_handlers` remains a Chromium-desktop shortcut; it does **not** replace
Launch Services registration on macOS.
