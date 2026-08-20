// Best-effort origin of a user-imported File.
// Browsers hide the OS path for <input>/most drops (`file.name` only). Chromium
// drag + showOpenFilePicker can also give a FileSystemFileHandle (persistable in
// IndexedDB) so we can re-read the original later. Electron-style `file.path`
// is stored when present.

export type ImportSource = {
  /** Display / search path — OS path, relative folder drop, or basename. */
  sourcePath: string;
  sourceHandle?: FileSystemFileHandle;
};

export type ImportFile = ImportSource & { file: File };

export const AUDIO_FILE_ACCEPT = "audio/*,.wav,.mp3,.m4a,.ogg,.flac,.aac,.webm";

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
  return { sourcePath: fileSourcePath(file), sourceHandle: handle };
}

type DataTransferItemEx = DataTransferItem & {
  getAsFileSystemHandle?: () => Promise<FileSystemHandle | null>;
};

export async function filesFromDataTransfer(
  dt: DataTransfer,
): Promise<ImportFile[]> {
  // Snapshot files in this tick. Do not await FSA first — Chrome will empty
  // later items, and getAsFileSystemHandle can hang (permission) and block
  // every subsequent drop.
  const filesSnap = Array.from(dt.files);
  const handlePs: Promise<FileSystemFileHandle | undefined>[] = [];
  if (dt.items?.length) {
    for (const raw of Array.from(dt.items)) {
      if (raw.kind !== "file") continue;
      const item = raw as DataTransferItemEx;
      handlePs.push(
        typeof item.getAsFileSystemHandle === "function"
          ? item
              .getAsFileSystemHandle()
              .then((h) =>
                h && h.kind === "file"
                  ? (h as FileSystemFileHandle)
                  : undefined,
              )
              .catch(() => undefined)
          : Promise.resolve(undefined),
      );
    }
  }

  const handles = handlePs.length
    ? await Promise.race([
        Promise.all(handlePs),
        new Promise<(FileSystemFileHandle | undefined)[]>((resolve) =>
          setTimeout(
            () => resolve(handlePs.map(() => undefined)),
            80,
          ),
        ),
      ])
    : [];

  if (filesSnap.length) {
    return filesSnap.map((file, i) => ({
      file,
      ...importSourceFromFile(file, handles[i]),
    }));
  }

  const out: ImportFile[] = [];
  for (let i = 0; i < handles.length; i++) {
    const handle = handles[i];
    if (!handle) continue;
    const file = await handle.getFile().catch(() => null);
    if (file) out.push({ file, ...importSourceFromFile(file, handle) });
  }
  return out;
}

export async function readHandleFile(
  handle: FileSystemFileHandle,
): Promise<File | null> {
  try {
    const h = handle as FileSystemFileHandle & {
      queryPermission?: (d: { mode: "read" }) => Promise<PermissionState>;
      requestPermission?: (d: { mode: "read" }) => Promise<PermissionState>;
    };
    if (typeof h.queryPermission === "function") {
      let state = await h.queryPermission({ mode: "read" });
      if (state !== "granted" && typeof h.requestPermission === "function")
        state = await h.requestPermission({ mode: "read" });
      if (state !== "granted") return null;
    }
    return await handle.getFile();
  } catch {
    return null;
  }
}

type PickerWindow = Window & {
  showOpenFilePicker?: (opts: {
    multiple?: boolean;
    types?: { description: string; accept: Record<string, string[]> }[];
  }) => Promise<FileSystemFileHandle[]>;
};

/** Chromium: picker returns handles (path + re-read). Elsewhere: hidden input. */
export async function pickAudioFiles(
  multiple = true,
): Promise<ImportFile[]> {
  const w = window as PickerWindow;
  if (typeof w.showOpenFilePicker === "function") {
    try {
      const handles = await w.showOpenFilePicker({
        multiple,
        types: [
          {
            description: "Audio",
            accept: {
              "audio/*": [
                ".wav",
                ".mp3",
                ".m4a",
                ".ogg",
                ".flac",
                ".aac",
                ".webm",
              ],
            },
          },
        ],
      });
      const out: ImportFile[] = [];
      for (const handle of handles) {
        const file = await handle.getFile();
        out.push({ file, ...importSourceFromFile(file, handle) });
      }
      return out;
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return [];
    }
  }
  return pickViaInput(multiple);
}

function pickViaInput(
  multiple: boolean,
): Promise<ImportFile[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = AUDIO_FILE_ACCEPT;
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
