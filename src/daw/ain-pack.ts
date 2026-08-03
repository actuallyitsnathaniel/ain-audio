// ── .ain — AIN project format ───────────────────────────────────────────────
// Portable project container for actuallyitsnathaniel (extension invented here).
//
// On-disk shape (v2 container — audio-primary polyglot):
//   [ PCM16 WAV master bounce ][ zip project pack ][ 16-byte AIN1 trailer ]
//
// Media players that honor the RIFF size field play the bounce and ignore the
// trailer. The studio reads the trailer, slices the zip, and loads the session.
// Legacy v1 files (raw zip starting with PK) still open.
//
// Zip layout (unchanged):
//   README.txt               human identity card
//   manifest.json            format id + version + asset index
//   arrangement.json         session doc
//   master-fx.json           optional master bus chain
//   assets/<bufId>.<ext>     imported / recorded audio only (collect-and-save)
//
// Built-in catalog samples stay URL / loopId refs and are not duplicated.

import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import type { Arrangement } from "./data/arrangement";
import { sniffMime } from "./data/audio-store";
import { kitLaneBufIds } from "./data/kits";
import type { FxDeviceState } from "./fx-chain";

/** Pack schema version inside the zip (reject newer on open). */
export const AIN_VERSION = 1;
/** File extension — invented for this studio. */
export const AIN_EXT = ".ain";
/**
 * Manifest `format` id. Stable string — change only with a version bump + migration.
 */
export const AIN_FORMAT = "ain" as const;
/**
 * Download / sniff MIME — file starts as PCM WAV so players + some OSes treat it
 * as audio. Legacy zip-only packs used application/vnd.ain.project+zip.
 */
export const AIN_MIME = "audio/wav";
export const AIN_MIME_LEGACY = "application/vnd.ain.project+zip";
export const AIN_HOMEPAGE = "https://audio.actuallyitsnathaniel.com";
export const AIN_APP = "AIN";
/** File-type mark — refraction on black (`public/icons/`). */
export const AIN_ICON = "/icons/ain-file.png";
export const AIN_ICON_256 = "/icons/ain-file-256.png";

/** Trailer magic at EOF — identifies audio+zip container. */
export const AIN_TRAILER_MAGIC = "AIN1";
export const AIN_TRAILER_BYTES = 16;

export type AinManifest = {
  format: typeof AIN_FORMAT;
  version: number;
  name: string;
  createdAt: string;
  app: string;
  homepage: string;
  /** Short human blurb — also mirrored in README.txt */
  note: string;
  assets: { bufId: string; path: string; name?: string }[];
};

export type AinPack = {
  manifest: AinManifest;
  arrangement: Arrangement;
  assets: { bufId: string; bytes: ArrayBuffer; name?: string }[];
  masterFx?: FxDeviceState[];
  /** Master bounce bytes from the container head (WAV), when present. */
  preview?: ArrayBuffer;
};

function extFor(bytes: ArrayBuffer, name?: string): string {
  const mime = sniffMime(bytes, name ?? "");
  if (mime.includes("wav")) return "wav";
  if (mime.includes("webm")) return "webm";
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("mpeg") || mime.includes("mp3")) return "mp3";
  if (mime.includes("mp4") || mime.includes("m4a") || mime.includes("aac"))
    return "m4a";
  if (name) {
    const m = /\.([a-z0-9]+)$/i.exec(name);
    if (m) return m[1]!.toLowerCase();
  }
  return "bin";
}

const DEFAULT_NOTE =
  "AIN project — PCM16 WAV mix preview + zip pack (arrangement + imports).";

function readmeText(name: string): string {
  return [
    `${AIN_APP} project (.ain)`,
    "actuallyitsnathaniel",
    AIN_HOMEPAGE,
    "",
    `Name: ${name}`,
    `Format: ${AIN_FORMAT}  v${AIN_VERSION}  (container ${AIN_TRAILER_MAGIC})`,
    "",
    "This file starts as a playable PCM WAV (latest master bounce). After the",
    "WAV is a zip project pack, then a 16-byte AIN1 trailer. Open in the studio,",
    "or play in any media player that ignores trailing RIFF bytes. Unzip the",
    "middle slice to inspect (see trailer for offsets).",
    "",
    "Zip contains: README, manifest, arrangement, optional master-fx, assets/.",
    "Built-in catalog samples are referenced, not packed.",
    "",
  ].join("\n");
}

/**
 * Collect bufIds pointed at by audio clips + kit lane samples (imports /
 * recordings — not catalog URLs). Kit lanes live in localStorage kits, not the
 * arrangement doc, so they must be included or prune/export drops them.
 */
export function referencedImportIds(a: Arrangement): Set<string> {
  const ids = new Set<string>();
  for (const t of a.tracks)
    for (const cl of t.clips)
      if (cl.content.kind === "audio" && cl.content.bufId)
        ids.add(cl.content.bufId);
  for (const id of kitLaneBufIds()) ids.add(id);
  return ids;
}

function buildZip(opts: {
  name: string;
  arrangement: Arrangement;
  assets: { bufId: string; bytes: ArrayBuffer; name?: string }[];
  masterFx?: FxDeviceState[];
}): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  const assetMeta: AinManifest["assets"] = [];

  for (const a of opts.assets) {
    const ext = extFor(a.bytes, a.name);
    const path = `assets/${a.bufId}.${ext}`;
    files[path] = new Uint8Array(a.bytes);
    assetMeta.push({ bufId: a.bufId, path, name: a.name });
  }

  const manifest: AinManifest = {
    format: AIN_FORMAT,
    version: AIN_VERSION,
    name: opts.name,
    createdAt: new Date().toISOString(),
    app: AIN_APP,
    homepage: AIN_HOMEPAGE,
    note: DEFAULT_NOTE,
    assets: assetMeta,
  };
  files["README.txt"] = strToU8(readmeText(opts.name));
  files["manifest.json"] = strToU8(JSON.stringify(manifest, null, 2));
  files["arrangement.json"] = strToU8(JSON.stringify(opts.arrangement));
  if (opts.masterFx)
    files["master-fx.json"] = strToU8(JSON.stringify(opts.masterFx));

  return zipSync(files, { level: 6 });
}

function writeTrailer(audioLen: number, zipLen: number): Uint8Array {
  const t = new Uint8Array(AIN_TRAILER_BYTES);
  const v = new DataView(t.buffer);
  for (let i = 0; i < 4; i++)
    t[i] = AIN_TRAILER_MAGIC.charCodeAt(i);
  v.setUint32(4, audioLen >>> 0, true);
  v.setUint32(8, zipLen >>> 0, true);
  v.setUint32(12, 0, true); // flags / reserved
  return t;
}

/** Parse AIN1 trailer at EOF. Returns null if not a v2 container. */
export function readAinTrailer(
  data: ArrayBuffer,
): { audioLen: number; zipLen: number } | null {
  if (data.byteLength < AIN_TRAILER_BYTES) return null;
  const u8 = new Uint8Array(data);
  const off = u8.length - AIN_TRAILER_BYTES;
  const magic = String.fromCharCode(u8[off]!, u8[off + 1]!, u8[off + 2]!, u8[off + 3]!);
  if (magic !== AIN_TRAILER_MAGIC) return null;
  const v = new DataView(data, off, AIN_TRAILER_BYTES);
  const audioLen = v.getUint32(4, true);
  const zipLen = v.getUint32(8, true);
  if (audioLen + zipLen + AIN_TRAILER_BYTES !== data.byteLength) return null;
  if (audioLen < 12 || zipLen < 4) return null;
  return { audioLen, zipLen };
}

function isZipLocalHeader(u8: Uint8Array, at = 0): boolean {
  return (
    u8.length >= at + 4 &&
    u8[at] === 0x50 &&
    u8[at + 1] === 0x4b &&
    u8[at + 2] === 0x03 &&
    u8[at + 3] === 0x04
  );
}

/**
 * Split an .ain file into preview WAV + project zip.
 * Supports AIN1 trailer containers and legacy raw-zip packs.
 */
export function splitAinContainer(data: ArrayBuffer): {
  preview?: ArrayBuffer;
  zip: ArrayBuffer;
} {
  const trailer = readAinTrailer(data);
  if (trailer) {
    const { audioLen, zipLen } = trailer;
    return {
      preview: data.slice(0, audioLen),
      zip: data.slice(audioLen, audioLen + zipLen),
    };
  }
  const u8 = new Uint8Array(data);
  if (isZipLocalHeader(u8)) return { zip: data };
  throw new Error("Not a valid .ain project (corrupt or not an AIN pack)");
}

/**
 * Pack arrangement + assets into a downloadable `.ain`:
 * PCM16 WAV preview (master bounce) + zip + AIN1 trailer.
 */
export function packAin(opts: {
  name: string;
  arrangement: Arrangement;
  assets: { bufId: string; bytes: ArrayBuffer; name?: string }[];
  masterFx?: FxDeviceState[];
  /** Required PCM16 WAV bytes for the playable head. */
  previewWav: ArrayBuffer;
}): Blob {
  const zipped = buildZip(opts);
  const preview = new Uint8Array(opts.previewWav);
  const trailer = writeTrailer(preview.byteLength, zipped.byteLength);
  const out = new Uint8Array(
    preview.byteLength + zipped.byteLength + trailer.byteLength,
  );
  out.set(preview, 0);
  out.set(zipped, preview.byteLength);
  out.set(trailer, preview.byteLength + zipped.byteLength);
  return new Blob([out], { type: AIN_MIME });
}

function unpackZip(zipData: ArrayBuffer): Omit<AinPack, "preview"> {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(new Uint8Array(zipData));
  } catch {
    throw new Error("Not a valid .ain project (corrupt zip pack)");
  }

  const manRaw = files["manifest.json"];
  if (!manRaw) throw new Error("Missing manifest.json — not an AIN project");
  const raw = JSON.parse(strFromU8(manRaw)) as Partial<AinManifest> & {
    format?: string;
  };
  if (raw.format !== AIN_FORMAT)
    throw new Error(
      `Unknown project format “${raw.format ?? "?"}” (expected ${AIN_FORMAT})`,
    );
  if (typeof raw.version !== "number" || raw.version > AIN_VERSION)
    throw new Error(
      `Unsupported .ain version ${raw.version} (this app reads ≤${AIN_VERSION})`,
    );
  if (typeof raw.name !== "string")
    throw new Error("Invalid .ain manifest (missing name)");

  const manifest: AinManifest = {
    format: AIN_FORMAT,
    version: raw.version,
    name: raw.name,
    createdAt:
      typeof raw.createdAt === "string"
        ? raw.createdAt
        : new Date().toISOString(),
    app: typeof raw.app === "string" ? raw.app : AIN_APP,
    homepage: typeof raw.homepage === "string" ? raw.homepage : AIN_HOMEPAGE,
    note: typeof raw.note === "string" ? raw.note : DEFAULT_NOTE,
    assets: Array.isArray(raw.assets) ? raw.assets : [],
  };

  const arrRaw = files["arrangement.json"];
  if (!arrRaw) throw new Error("Missing arrangement.json");
  const arrangement = JSON.parse(strFromU8(arrRaw)) as Arrangement;

  const assets: AinPack["assets"] = [];
  for (const meta of manifest.assets) {
    const file = files[meta.path];
    if (!file) continue;
    const bytes = file.buffer.slice(
      file.byteOffset,
      file.byteOffset + file.byteLength,
    ) as ArrayBuffer;
    assets.push({ bufId: meta.bufId, bytes, name: meta.name });
  }
  if (assets.length === 0) {
    for (const [path, file] of Object.entries(files)) {
      const m = /^assets\/([^/]+)\.[^.]+$/i.exec(path);
      if (!m) continue;
      const bytes = file.buffer.slice(
        file.byteOffset,
        file.byteOffset + file.byteLength,
      ) as ArrayBuffer;
      assets.push({ bufId: m[1]!, bytes });
    }
  }

  let masterFx: FxDeviceState[] | undefined;
  const fxRaw = files["master-fx.json"];
  if (fxRaw) {
    try {
      masterFx = JSON.parse(strFromU8(fxRaw)) as FxDeviceState[];
    } catch {
      /* ignore */
    }
  }

  return { manifest, arrangement, assets, masterFx };
}

export function unpackAin(data: ArrayBuffer): AinPack {
  const { preview, zip } = splitAinContainer(data);
  return { ...unpackZip(zip), preview };
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function safeAinBasename(name: string): string {
  return (
    name
      .trim()
      .replace(/[^\w-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 64) || "project"
  );
}

/**
 * Download filename for an AIN pack. Same polyglot bytes either way —
 * `.wav` is an extension mask so Finder Quick Look treats it as audio.
 */
export function safeAinFilename(
  name: string,
  opts?: { wavMask?: boolean },
): string {
  const base = safeAinBasename(name);
  return opts?.wavMask ? `${base}.wav` : `${base}${AIN_EXT}`;
}
