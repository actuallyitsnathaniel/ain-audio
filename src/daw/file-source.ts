// Best-effort origin of a user-imported File.
// Browsers hide the OS path for <input>/most drops (`file.name` only). Chromium
// drag + showOpenFilePicker can also give a FileSystemFileHandle (persistable in
// IndexedDB) so we can re-read the original later. Electron-style `file.path`
// is stored when present.

import { AIN_EXT, AIN_MIME, AIN_MIME_LEGACY } from "./ain-pack";

export type ImportSource = {
  /** Display / search path — OS path, relative folder drop, or basename. */
  sourcePath: string;
  sourceHandle?: FileSystemFileHandle;
  sourceSize?: number;
  sourceMtime?: number;
};

export type ImportFile = ImportSource & { file: File };

export const AUDIO_FILE_ACCEPT =
  "audio/*,.wav,.wave,.mp3,.m4a,.ogg,.opus,.flac,.aac,.webm,.aiff,.aif,.aifc,.caf";

const AUDIO_EXT =
  /\.(wav|wave|mp3|m4a|aac|ogg|opus|flac|webm|aiff|aif|aifc|caf|wma)$/i;
const MIDI_EXT = /\.(mid|midi)$/i;
const JUNK_NAME =
  /^(thumbs\.db|desktop\.ini|\.ds_store)$/i;
const JUNK_EXT = /\.(txt|md|json|zip|png|jpe?g|gif|webp|pdf|html?|css|js|ts|tsx)$/i;

type FileWithPath = File & { path?: string };

export function fileSourcePath(file: File): string {
  const path = (file as FileWithPath).path;
  if (typeof path === "string" && path.length > 0) return path;
  if (file.webkitRelativePath) return file.webkitRelativePath;
  return file.name;
}

export function importSourceFromFile(
  file: File,
  handle?: FileSystemFileHandle,
): ImportSource {
  return {
    sourcePath: fileSourcePath(file),
    sourceHandle: handle,
    sourceSize: file.size,
    sourceMtime: file.lastModified,
  };
}

export function fileIdentityKey(file: File): string {
  return `${file.name}|${file.size}|${file.lastModified}`;
}

export function looksLikeMidiFile(file: File): boolean {
  return MIDI_EXT.test(file.name);
}

export function looksLikeAudioFile(file: File): boolean {
  if (file.type.startsWith("audio/")) return true;
  return AUDIO_EXT.test(file.name);
}

export function isJunkDropFile(file: File): boolean {
  const base = file.name.split(/[/\\]/).pop() || file.name;
  if (base.startsWith(".")) return true;
  if (JUNK_NAME.test(base)) return true;
  if (looksLikeAudioFile(file) || looksLikeMidiFile(file)) return false;
  if (JUNK_EXT.test(base)) return true;
  return false;
}

// ── FSA handles arriving after the File snapshot (Chrome empties items if we await) ──

const handleByKey = new Map<string, FileSystemFileHandle>();
const handleWaiters = new Map<
  string,
  Array<(h: FileSystemFileHandle) => void>
>();

export function rememberFileHandle(
  file: File,
  handle: FileSystemFileHandle,
): void {
  const k = fileIdentityKey(file);
  handleByKey.set(k, handle);
  const wait = handleWaiters.get(k);
  if (!wait) return;
  handleWaiters.delete(k);
  for (const fn of wait) fn(handle);
}

export function whenFileHandle(
  file: File,
  ms = 4000,
): Promise<FileSystemFileHandle | undefined> {
  const k = fileIdentityKey(file);
  const hit = handleByKey.get(k);
  if (hit) return Promise.resolve(hit);
  return new Promise((resolve) => {
    const list = handleWaiters.get(k) ?? [];
    const timer = window.setTimeout(() => {
      const cur = handleWaiters.get(k);
      if (cur) {
        const next = cur.filter((fn) => fn !== onH);
        if (next.length) handleWaiters.set(k, next);
        else handleWaiters.delete(k);
      }
      resolve(undefined);
    }, ms);
    const onH = (h: FileSystemFileHandle) => {
      window.clearTimeout(timer);
      resolve(h);
    };
    list.push(onH);
    handleWaiters.set(k, list);
  });
}

type DataTransferItemEx = DataTransferItem & {
  getAsFileSystemHandle?: () => Promise<FileSystemHandle | null>;
};

function harvestHandle(raw: DataTransferItem): void {
  const item = raw as DataTransferItemEx;
  if (typeof item.getAsFileSystemHandle !== "function") return;
  void item
    .getAsFileSystemHandle()
    .then(async (h) => {
      if (!h) return;
      if (h.kind === "file") {
        const file = await (h as FileSystemFileHandle).getFile().catch(() => null);
        if (file) rememberFileHandle(file, h as FileSystemFileHandle);
        return;
      }
      if (h.kind === "directory")
        await harvestDirHandle(h as FileSystemDirectoryHandle, h.name);
    })
    .catch(() => undefined);
}

async function harvestDirHandle(
  dir: FileSystemDirectoryHandle,
  prefix: string,
): Promise<void> {
  const iter = (
    dir as FileSystemDirectoryHandle & {
      values?: () => AsyncIterable<FileSystemHandle>;
    }
  ).values;
  if (typeof iter !== "function") return;
  try {
    for await (const handle of iter.call(dir)) {
      if (handle.name.startsWith(".") || handle.name === "__MACOSX") continue;
      if (handle.kind === "directory") {
        await harvestDirHandle(
          handle as FileSystemDirectoryHandle,
          prefix + "/" + handle.name,
        );
        continue;
      }
      const fileHandle = handle as FileSystemFileHandle;
      const file = await fileHandle.getFile().catch(() => null);
      if (file) rememberFileHandle(file, fileHandle);
    }
  } catch {
    /* permission / unsupported iterator */
  }
}

async function collectFromEntries(
  entries: FileSystemEntry[],
): Promise<ImportFile[]> {
  const out: ImportFile[] = [];
  for (const entry of entries) await walkEntry(entry, "", out);
  return out;
}

async function walkEntry(
  entry: FileSystemEntry,
  prefix: string,
  out: ImportFile[],
): Promise<void> {
  if (entry.name.startsWith(".") || entry.name === "__MACOSX") return;
  if (entry.isFile) {
    const file = await new Promise<File | null>((resolve) => {
      (entry as FileSystemFileEntry).file(resolve, () => resolve(null));
    });
    if (!file || isJunkDropFile(file)) return;
    const sourcePath = prefix ? prefix + "/" + file.name : fileSourcePath(file);
    out.push({
      file,
      sourcePath,
      sourceSize: file.size,
      sourceMtime: file.lastModified,
    });
    return;
  }
  if (!entry.isDirectory) return;
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  const children = await readAllEntries(reader);
  const next = prefix ? prefix + "/" + entry.name : entry.name;
  for (const child of children) await walkEntry(child, next, out);
}

function readAllEntries(
  reader: FileSystemDirectoryReader,
): Promise<FileSystemEntry[]> {
  return new Promise((resolve) => {
    const all: FileSystemEntry[] = [];
    const pump = () => {
      reader.readEntries(
        (batch) => {
          if (!batch.length) {
            resolve(all);
            return;
          }
          all.push(...batch);
          pump();
        },
        () => resolve(all),
      );
    };
    pump();
  });
}

export async function filesFromDataTransfer(
  dt: DataTransfer,
): Promise<ImportFile[]> {
  // Snapshot files in this tick. Do not await FSA first — Chrome will empty
  // later items, and getAsFileSystemHandle can hang (permission) and block
  // every subsequent drop. Handles attach in the background via whenFileHandle.
  const filesSnap = Array.from(dt.files);
  const entries: FileSystemEntry[] = [];
  if (dt.items?.length) {
    for (const raw of Array.from(dt.items)) {
      if (raw.kind !== "file") continue;
      harvestHandle(raw);
      const entry = raw.webkitGetAsEntry?.() ?? null;
      if (entry) entries.push(entry);
    }
  }

  const hasDir = entries.some((e) => e.isDirectory);
  if (hasDir) {
    const walked = await collectFromEntries(
      entries.filter((e) => e.isDirectory),
    );
    if (walked.length) return dedupeImportFiles(walked);
  }
  if (filesSnap.length) {
    return dedupeImportFiles(
      filesSnap
        .filter((file) => !isJunkDropFile(file))
        .map((file) => ({ file, ...importSourceFromFile(file) })),
    );
  }
  if (entries.length) return dedupeImportFiles(await collectFromEntries(entries));
  return [];
}

function dedupeImportFiles(files: ImportFile[]): ImportFile[] {
  const seen = new Set<string>();
  const out: ImportFile[] = [];
  for (const one of files) {
    const k = fileIdentityKey(one.file);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(one);
  }
  return out;
}

export async function readHandleFile(
  handle: FileSystemFileHandle,
  mode: "read" | "readwrite" = "read",
): Promise<File | null> {
  try {
    const h = handle as FileSystemFileHandle & {
      queryPermission?: (d: {
        mode: "read" | "readwrite";
      }) => Promise<PermissionState>;
      requestPermission?: (d: {
        mode: "read" | "readwrite";
      }) => Promise<PermissionState>;
    };
    if (typeof h.queryPermission === "function") {
      let state = await h.queryPermission({ mode });
      if (state !== "granted" && typeof h.requestPermission === "function")
        state = await h.requestPermission({ mode });
      if (state !== "granted") return null;
    }
    return await handle.getFile();
  } catch {
    return null;
  }
}

export async function writeBlobToHandle(
  handle: FileSystemFileHandle,
  blob: Blob,
): Promise<boolean> {
  try {
    const h = handle as FileSystemFileHandle & {
      queryPermission?: (d: { mode: "readwrite" }) => Promise<PermissionState>;
      requestPermission?: (d: { mode: "readwrite" }) => Promise<PermissionState>;
    };
    if (typeof h.requestPermission === "function") {
      let state =
        (await h.queryPermission?.({ mode: "readwrite" })) ?? "prompt";
      if (state !== "granted")
        state = await h.requestPermission({ mode: "readwrite" });
      if (state !== "granted") return false;
    }
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    return true;
  } catch {
    return false;
  }
}

type WellKnownDir =
  | "desktop"
  | "documents"
  | "downloads"
  | "music"
  | "pictures"
  | "videos";

type PickerWindow = Window & {
  showOpenFilePicker?: (opts: {
    multiple?: boolean;
    id?: string;
    startIn?: WellKnownDir | FileSystemHandle;
    types?: { description: string; accept: Record<string, string[]> }[];
  }) => Promise<FileSystemFileHandle[]>;
  showSaveFilePicker?: (opts: {
    suggestedName?: string;
    id?: string;
    startIn?: WellKnownDir | FileSystemHandle;
    types?: { description: string; accept: Record<string, string[]> }[];
  }) => Promise<FileSystemFileHandle>;
};

export function canOpenFilePicker(): boolean {
  return typeof (window as PickerWindow).showOpenFilePicker === "function";
}

export function canSaveFilePicker(): boolean {
  return typeof (window as PickerWindow).showSaveFilePicker === "function";
}

const AUDIO_PICKER_TYPES = [
  {
    description: "Audio",
    accept: {
      "audio/*": [
        ".wav",
        ".wave",
        ".mp3",
        ".m4a",
        ".ogg",
        ".opus",
        ".flac",
        ".aac",
        ".webm",
        ".aiff",
        ".aif",
        ".caf",
      ],
    },
  },
];

const AIN_OPEN_TYPES = [
  {
    description: "AIN project",
    accept: {
      "audio/wav": [AIN_EXT, ".wav"],
      [AIN_MIME_LEGACY]: [AIN_EXT],
    },
  },
];

/** Chromium: picker returns handles (path + re-read). Elsewhere: hidden input. */
export async function pickAudioFiles(
  multiple = true,
): Promise<ImportFile[]> {
  const w = window as PickerWindow;
  if (typeof w.showOpenFilePicker === "function") {
    try {
      const handles = await w.showOpenFilePicker({
        multiple,
        id: "ain-audio",
        startIn: "music",
        types: AUDIO_PICKER_TYPES,
      });
      const out: ImportFile[] = [];
      for (const handle of handles) {
        const file = await handle.getFile();
        rememberFileHandle(file, handle);
        out.push({ file, ...importSourceFromFile(file, handle) });
      }
      return out;
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return [];
    }
  }
  return pickViaInput(multiple, AUDIO_FILE_ACCEPT);
}

export type PickedAin = { file: File; handle?: FileSystemFileHandle };

export async function pickAinProject(): Promise<PickedAin | null> {
  const w = window as PickerWindow;
  if (typeof w.showOpenFilePicker === "function") {
    try {
      const [handle] = await w.showOpenFilePicker({
        multiple: false,
        id: "ain-project",
        startIn: "documents",
        types: AIN_OPEN_TYPES,
      });
      if (!handle) return null;
      const file = await handle.getFile();
      return { file, handle };
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return null;
    }
  }
  const got = await pickViaInput(
    false,
    `${AIN_EXT},.wav,${AIN_MIME},${AIN_MIME_LEGACY},application/zip`,
  );
  const one = got[0];
  return one ? { file: one.file } : null;
}

/** Handle if saved; `null` if the user cancelled; `undefined` if no picker API. */
export async function pickAinSave(
  suggestedName: string,
  wavMask?: boolean,
): Promise<FileSystemFileHandle | null | undefined> {
  const w = window as PickerWindow;
  if (typeof w.showSaveFilePicker !== "function") return undefined;
  try {
    return await w.showSaveFilePicker({
      suggestedName,
      id: "ain-project",
      startIn: "documents",
      types: wavMask
        ? [
            {
              description: "AIN project (WAV name)",
              accept: { "audio/wav": [".wav"] },
            },
          ]
        : [
            {
              description: "AIN project",
              accept: {
                [AIN_MIME]: [AIN_EXT],
                [AIN_MIME_LEGACY]: [AIN_EXT],
              },
            },
          ],
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") return null;
    return null;
  }
}

function pickViaInput(
  multiple: boolean,
  accept: string,
): Promise<ImportFile[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.multiple = multiple;
    input.addEventListener("change", () => {
      resolve(
        Array.from(input.files ?? []).map((file) => ({
          file,
          ...importSourceFromFile(file),
        })),
      );
    });
    input.addEventListener("cancel", () => resolve([]));
    input.click();
  });
}
