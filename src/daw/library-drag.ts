// Shared drag payload for library → timeline / kit lane (not a File re-decode).

export const LIBRARY_MIME = "text/ain-library";
const PLAIN_PREFIX = "ain-lib:";

export function setLibraryDrag(dt: DataTransfer, bufId: string): void {
  dt.setData(LIBRARY_MIME, bufId);
  dt.setData("text/plain", PLAIN_PREFIX + bufId);
  dt.effectAllowed = "copy";
}

export function dragHasLibrary(dt: DataTransfer): boolean {
  const types = Array.from(dt.types);
  return types.includes(LIBRARY_MIME);
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

/** Read bufId. Prefer the dedicated MIME; `text/plain` is the Safari/Firefox fallback. */
export function libraryBufIdFromDrag(dt: DataTransfer): string | null {
  const typed = dt.getData(LIBRARY_MIME);
  if (typed) return typed;
  const plain = dt.getData("text/plain");
  if (plain.startsWith(PLAIN_PREFIX)) return plain.slice(PLAIN_PREFIX.length);
  return null;
}
