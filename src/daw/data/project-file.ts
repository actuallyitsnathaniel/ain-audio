// Last-opened / last-saved `.ain` handle (Chromium File System Access).
// IndexedDB can structured-clone FileSystemFileHandle; localStorage cannot.

const DB = "ain-project-file";
const STORE = "ref";
const KEY = "current";

export type ProjectFileRef = {
  handle: FileSystemFileHandle;
  name: string;
  wavMask: boolean;
};

function open(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function loadProjectFileRef(): Promise<ProjectFileRef | null> {
  const db = await open();
  if (!db) return null;
  const row = await new Promise<ProjectFileRef | null>((resolve) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(KEY);
    req.onsuccess = () => {
      const v = req.result as ProjectFileRef | undefined;
      resolve(v?.handle ? v : null);
    };
    req.onerror = () => resolve(null);
  });
  db.close();
  return row;
}

export async function saveProjectFileRef(
  ref: ProjectFileRef,
): Promise<boolean> {
  const db = await open();
  if (!db) return false;
  const ok = await new Promise<boolean>((resolve) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(ref, KEY);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
  });
  db.close();
  return ok;
}

export async function clearProjectFileRef(): Promise<void> {
  const db = await open();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
  db.close();
}
