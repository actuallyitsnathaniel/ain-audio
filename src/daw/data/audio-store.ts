// ── Imported-audio persistence (IndexedDB) ────────────────────────────────────
// Stores the RAW encoded bytes of each imported file (not decoded PCM — smaller and
// re-decodable) keyed by bufId, so arrangement audio clips survive a reload. Tiny raw
// IndexedDB wrapper, no dependency. All ops are best-effort (private mode / quota →
// resolve to a safe fallback rather than throw).

const DB = "ain-audio";
const STORE = "imports";

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

// store raw bytes + the display name under bufId
export async function putAudio(bufId: string, bytes: ArrayBuffer, name: string): Promise<void> {
  const db = await open();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put({ bytes, name }, bufId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
  db.close();
}

// load every stored import → [bufId, bytes, name]. Used once on boot.
export async function allAudio(): Promise<{ bufId: string; bytes: ArrayBuffer; name: string }[]> {
  const db = await open();
  if (!db) return [];
  const out = await new Promise<{ bufId: string; bytes: ArrayBuffer; name: string }[]>((resolve) => {
    const tx = db.transaction(STORE, "readonly");
    const store = tx.objectStore(STORE);
    const keysReq = store.getAllKeys();
    const valsReq = store.getAll();
    tx.oncomplete = () => {
      const keys = keysReq.result as IDBValidKey[];
      const vals = valsReq.result as { bytes: ArrayBuffer; name: string }[];
      resolve(keys.map((k, i) => ({ bufId: String(k), bytes: vals[i].bytes, name: vals[i].name })));
    };
    tx.onerror = () => resolve([]);
  });
  db.close();
  return out;
}

// remove imports no longer referenced by any clip (call after loading the arrangement)
export async function pruneAudio(keepIds: Set<string>): Promise<void> {
  const db = await open();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const req = store.getAllKeys();
    req.onsuccess = () => {
      for (const k of req.result as IDBValidKey[]) if (!keepIds.has(String(k))) store.delete(k);
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
  db.close();
}
