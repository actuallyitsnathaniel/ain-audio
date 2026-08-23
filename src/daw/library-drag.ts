// Shared drag payload for library → timeline / kit lane (not a File re-decode).

export const LIBRARY_MIME = "text/ain-library";
const PLAIN_PREFIX = "ain-lib:";

/** Live ids for the in-flight library drag. `getData` is empty on dragover. */
let liveIds: string[] = [];
let dragImage: HTMLCanvasElement | null = null;
let dragEndBound = false;

function bindDragEnd() {
  if (dragEndBound || typeof window === "undefined") return;
  dragEndBound = true;
  window.addEventListener("dragend", clearLibraryDrag);
}

export function clearLibraryDrag(): void {
  liveIds = [];
}

export function peekLibraryDragIds(): string[] {
  return liveIds;
}

export function setLibraryDrag(
  dt: DataTransfer,
  bufIds: string | string[],
): void {
  const ids = (Array.isArray(bufIds) ? bufIds : [bufIds]).filter(Boolean);
  liveIds = ids;
  bindDragEnd();
  const packed = ids.join(",");
  dt.setData(LIBRARY_MIME, packed);
  dt.setData("text/plain", PLAIN_PREFIX + packed);
  dt.effectAllowed = "all";
  // Tiny drag image so the row ghost doesn't cover the timeline clip preview.
  try {
    if (!dragImage) {
      dragImage = document.createElement("canvas");
      dragImage.width = 1;
      dragImage.height = 1;
    }
    dt.setDragImage(dragImage, 0, 0);
  } catch {
    /* Safari / some OS drags */
  }
}

export function dragHasLibrary(dt: DataTransfer): boolean {
  const types = Array.from(dt.types);
  // `text/plain` is the Safari/Firefox fallback; ⌘-drag on Mac can omit custom MIMEs.
  return types.includes(LIBRARY_MIME) || types.includes("text/plain");
}

export function dragHasOsFiles(dt: DataTransfer): boolean {
  const types = Array.from(dt.types);
  return (
    types.includes("Files") ||
    types.includes("public.file-url") ||
    types.includes("text/uri-list") ||
    types.includes("application/x-moz-file")
  );
}

export function dragHasAudioIntake(dt: DataTransfer): boolean {
  return dragHasOsFiles(dt) || dragHasLibrary(dt);
}

/** All bufIds in a library drag (empty if this isn't one). */
export function libraryBufIdsFromDrag(dt: DataTransfer): string[] {
  const typed = dt.getData(LIBRARY_MIME);
  const raw = typed || dt.getData("text/plain");
  if (!raw) return [];
  const packed = raw.startsWith(PLAIN_PREFIX)
    ? raw.slice(PLAIN_PREFIX.length)
    : raw;
  if (typed || raw.startsWith(PLAIN_PREFIX))
    return packed
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  return [];
}

/** First bufId. Prefer the dedicated MIME; `text/plain` is the Safari/Firefox fallback. */
export function libraryBufIdFromDrag(dt: DataTransfer): string | null {
  return libraryBufIdsFromDrag(dt)[0] ?? null;
}
