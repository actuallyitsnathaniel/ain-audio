// ── .ain — AIN project format ───────────────────────────────────────────────
// Portable project container for actuallyitsnathaniel (extension invented here).
// Under the hood it's a zip so it's storage-friendly and inspectable, but the
// layout + manifest identity are fixed — this is not a generic archive.
//
// Layout:
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

/** Current pack schema version (reject newer on open). */
export const AIN_VERSION = 1;
/** File extension — invented for this studio. */
export const AIN_EXT = ".ain";
/**
 * Manifest `format` id. Stable string — change only with a version bump + migration.
 */
export const AIN_FORMAT = "ain" as const;
/** Vendor MIME (zip payload). Browsers may still sniff as application/zip. */
export const AIN_MIME = "application/vnd.ain.project+zip";
export const AIN_HOMEPAGE = "https://audio.actuallyitsnathaniel.com";
export const AIN_APP = "AIN";

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
  "AIN project — collect-and-save pack (arrangement + imported audio).";

function readmeText(name: string): string {
  return [
    `${AIN_APP} project (.ain)`,
    "actuallyitsnathaniel",
    AIN_HOMEPAGE,
    "",
    `Name: ${name}`,
    `Format: ${AIN_FORMAT}  v${AIN_VERSION}`,
    "",
    "This file is a zip with a fixed layout. Open it in the studio, or unzip",
    "to inspect. See manifest.json for the machine-readable index.",
    "",
    "Collected under assets/: imported and recorded audio only.",
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

export function packAin(opts: {
  name: string;
  arrangement: Arrangement;
  assets: { bufId: string; bytes: ArrayBuffer; name?: string }[];
  masterFx?: FxDeviceState[];
}): Blob {
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

  const zipped = zipSync(files, { level: 6 });
  return new Blob([zipped], { type: AIN_MIME });
}

export function unpackAin(data: ArrayBuffer): AinPack {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(new Uint8Array(data));
  } catch {
    throw new Error("Not a valid .ain project (corrupt or not an AIN pack)");
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

export function safeAinFilename(name: string): string {
  const base = name
    .trim()
    .replace(/[^\w-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 64);
  return `${base || "project"}${AIN_EXT}`;
}
