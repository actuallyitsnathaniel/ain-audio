// ── Imported-audio persistence (IndexedDB) ────────────────────────────────────
// Stores encoded bytes keyed by bufId so arrangement audio clips survive a reload.
// Takes / bounces prefer Opus in WebM (WebCodecs via mediabunny) when the browser
// can encode it; otherwise float32 WAV. User imports keep their original file bytes.
// Best-effort (private mode / quota → no throw).

import {
  AudioBufferSource,
  BufferTarget,
  Output,
  QUALITY_HIGH,
  WebMOutputFormat,
  canEncodeAudio,
} from "mediabunny";

const DB = "ain-audio";
const STORE = "imports";

export type PersistMime = "audio/webm;codecs=opus" | "audio/wav" | string;

export type StoredAudio = {
  bufId: string;
  bytes: ArrayBuffer;
  name: string;
  /** Present on new writes; legacy rows may omit (decode via sniff). */
  mime: PersistMime;
};

/** Last successful buffer→disk codec (for System / capability UI). */
let _lastPersistCodec: "opus" | "wav" | null = null;

export function lastPersistCodec(): "opus" | "wav" | null {
  return _lastPersistCodec;
}

let _opusEncodeOk: boolean | null = null;

/** Cached probe — Opus via WebCodecs (Chromium-strong; Safari often false). */
export async function canPersistOpus(): Promise<boolean> {
  if (_opusEncodeOk != null) return _opusEncodeOk;
  try {
    _opusEncodeOk = await canEncodeAudio("opus", {
      numberOfChannels: 2,
      sampleRate: 48000,
      quality: QUALITY_HIGH,
    });
  } catch {
    _opusEncodeOk = false;
  }
  return _opusEncodeOk;
}

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

/** Store raw bytes (+ optional mime) under bufId. */
export async function putAudio(
  bufId: string,
  bytes: ArrayBuffer,
  name: string,
  mime: PersistMime = "application/octet-stream",
): Promise<void> {
  const db = await open();
  if (!db) return;
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put({ bytes, name, mime }, bufId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
  db.close();
}

/**
 * Encode an AudioBuffer for IndexedDB: Opus/WebM when WebCodecs allows,
 * else float32 WAV. In-memory playback stays on the original buffer — call
 * fire-and-forget after baking a take/bounce.
 */
export async function putAudioBuffer(
  bufId: string,
  buf: AudioBuffer,
  name: string,
): Promise<PersistMime> {
  const { bytes, mime } = await encodePersistable(buf);
  const base = name.replace(/\.(wav|webm|ogg|opus)$/i, "");
  const fileName =
    mime.startsWith("audio/webm") ? `${base}.webm` : `${base}.wav`;
  await putAudio(bufId, bytes, fileName, mime);
  return mime;
}

export async function encodePersistable(
  buf: AudioBuffer,
): Promise<{ bytes: ArrayBuffer; mime: PersistMime }> {
  if (await canPersistOpus()) {
    try {
      const encoded = await encodeOpusWebm(buf);
      if (encoded && encoded.byteLength > 64) {
        _lastPersistCodec = "opus";
        return { bytes: encoded, mime: "audio/webm;codecs=opus" };
      }
    } catch {
      /* fall through to WAV */
    }
  }
  _lastPersistCodec = "wav";
  return { bytes: encodeWav(buf), mime: "audio/wav" };
}

async function encodeOpusWebm(buf: AudioBuffer): Promise<ArrayBuffer | null> {
  const target = new BufferTarget();
  const output = new Output({
    format: new WebMOutputFormat(),
    target,
  });
  const source = new AudioBufferSource({
    codec: "opus",
    bitrate: QUALITY_HIGH,
  });
  output.addAudioTrack(source);
  await output.start();
  await source.add(buf);
  await output.finalize();
  return target.buffer ?? null;
}

// load every stored import → [bufId, bytes, name, mime]. Used once on boot.
export async function allAudio(): Promise<StoredAudio[]> {
  const db = await open();
  if (!db) return [];
  const out = await new Promise<StoredAudio[]>((resolve) => {
    const tx = db.transaction(STORE, "readonly");
    const store = tx.objectStore(STORE);
    const keysReq = store.getAllKeys();
    const valsReq = store.getAll();
    tx.oncomplete = () => {
      const keys = keysReq.result as IDBValidKey[];
      const vals = valsReq.result as {
        bytes: ArrayBuffer;
        name: string;
        mime?: string;
      }[];
      resolve(
        keys.map((k, i) => ({
          bufId: String(k),
          bytes: vals[i]!.bytes,
          name: vals[i]!.name,
          mime: vals[i]!.mime || sniffMime(vals[i]!.bytes, vals[i]!.name),
        })),
      );
    };
    tx.onerror = () => resolve([]);
  });
  db.close();
  return out;
}

function sniffMime(bytes: ArrayBuffer, name: string): PersistMime {
  const u8 = new Uint8Array(bytes);
  // WebM / EBML
  if (
    u8.length >= 4 &&
    u8[0] === 0x1a &&
    u8[1] === 0x45 &&
    u8[2] === 0xdf &&
    u8[3] === 0xa3
  )
    return "audio/webm";
  // RIFF WAVE
  if (
    u8.length >= 12 &&
    u8[0] === 0x52 &&
    u8[1] === 0x49 &&
    u8[2] === 0x46 &&
    u8[3] === 0x46 &&
    u8[8] === 0x57 &&
    u8[9] === 0x41 &&
    u8[10] === 0x56 &&
    u8[11] === 0x45
  )
    return "audio/wav";
  const lower = name.toLowerCase();
  if (lower.endsWith(".webm")) return "audio/webm";
  if (lower.endsWith(".wav")) return "audio/wav";
  if (lower.endsWith(".ogg") || lower.endsWith(".opus")) return "audio/ogg";
  if (lower.endsWith(".mp3")) return "audio/mpeg";
  if (lower.endsWith(".m4a") || lower.endsWith(".aac")) return "audio/mp4";
  return "application/octet-stream";
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
      for (const k of req.result as IDBValidKey[])
        if (!keepIds.has(String(k))) store.delete(k);
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
  db.close();
}

// ── WAV encode (fallback when Opus/WebCodecs unavailable) ─────────────────────
// 32-bit float WAV (format 3 + `fact` chunk) — lossless, universal decodeAudioData.
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
      v.setFloat32(o, chans[c]![i]!, true);
      o += 4;
    }
  return out;
}
