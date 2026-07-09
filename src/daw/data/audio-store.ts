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

// wipe ALL stored imports (new-project / clear-db)
export async function clearAudio(): Promise<void> {
  const db = await open();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
  db.close();
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

// ── WAV encode (for bounced buffers) ──────────────────────────────────────────
// Consolidate renders an AudioBuffer that never existed as a file — encode it as
// 32-bit float WAV (format 3, with the spec-required `fact` chunk) so it persists
// through the same raw-bytes store and re-decodes losslessly on reload.
export function encodeWav(buf: AudioBuffer): ArrayBuffer {
  const ch = buf.numberOfChannels;
  const n = buf.length;
  const sr = buf.sampleRate;
  const blockAlign = ch * 4; // float32
  const dataSize = n * blockAlign;
  // RIFF: "WAVE" + fmt(8+18) + fact(8+4) + data(8+dataSize)
  const out = new ArrayBuffer(58 + dataSize);
  const v = new DataView(out);
  const str = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, "RIFF");
  v.setUint32(4, 50 + dataSize, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 18, true); // fmt chunk size (18 = with cbSize field)
  v.setUint16(20, 3, true); // format 3 = IEEE float
  v.setUint16(22, ch, true);
  v.setUint32(24, sr, true);
  v.setUint32(28, sr * blockAlign, true);
  v.setUint16(32, blockAlign, true);
  v.setUint16(34, 32, true); // bits per sample
  v.setUint16(36, 0, true); // cbSize
  str(38, "fact");
  v.setUint32(42, 4, true);
  v.setUint32(46, n, true); // samples per channel
  str(50, "data");
  v.setUint32(54, dataSize, true);
  const chans: Float32Array[] = [];
  for (let c = 0; c < ch; c++) chans.push(buf.getChannelData(c));
  let o = 58;
  for (let i = 0; i < n; i++)
    for (let c = 0; c < ch; c++) {
      v.setFloat32(o, chans[c][i], true);
      o += 4;
    }
  return out;
}
