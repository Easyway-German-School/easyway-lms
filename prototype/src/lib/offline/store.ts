"use client";

/**
 * The on-device store behind offline watching and offline notes.
 *
 * ---------------------------------------------------------------------------
 * WHY INDEXEDDB AND NOT THE SERVICE-WORKER CACHE
 * ---------------------------------------------------------------------------
 * The service worker (public/sw.js) deliberately refuses to touch `/api/`
 * responses — on a shared phone a cached API response is the previous user's
 * data handed to the next one, and a class recording is fetched from
 * `/api/files/…`. So the videos cannot live in the SW cache without punching a
 * hole in that rule.
 *
 * IndexedDB sidesteps it: the page (inside the installed app) fetches the file
 * itself, once, on an explicit tap, and stores the Blob here keyed by material
 * id. Playback is `URL.createObjectURL(blob)`. That also gives us what the
 * feature actually needs and a cache cannot express — a per-item expiry
 * timestamp, size accounting, and a delete sweep for the 14-day window.
 *
 * Everything here is client-only and defensive: a private window, a browser
 * with storage disabled, or a quota rejection must degrade to "no downloads",
 * never throw into a render.
 */

const DB_NAME = "easyway-offline";
const DB_VERSION = 1;
const STORE_MEDIA = "media";
const STORE_NOTES = "notes";
const STORE_KV = "kv";

/** Total bytes we let one device hold. Past this, a download is refused. */
export const OFFLINE_CAP_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB

export type OfflineMediaMeta = {
  title: string;
  kind: "video" | "recording";
  level: string | null;
  durationSeconds: number | null;
  isPrivate: boolean;
  lecturerName: string | null;
  recordedAt: string | null;
};

export type OfflineMedia = {
  materialId: string;
  blob: Blob;
  thumbBlob: Blob | null;
  meta: OfflineMediaMeta;
  downloadedAt: number;
  /** ms epoch; null = never expires (a lesson video / keep-forever recording). */
  expiresAt: number | null;
  sizeBytes: number;
};

/** What a list view needs — same as OfflineMedia without the heavy blob. */
export type OfflineMediaRow = Omit<OfflineMedia, "blob" | "thumbBlob">;

export type OfflineNoteKind = "study" | "class";

export type OfflineNote = {
  key: string; // `${kind}:${materialId}`
  materialId: string;
  kind: OfflineNoteKind;
  title: string;
  /** The rendered note payload — shapes from the notes APIs. */
  payload: unknown;
  downloadedAt: number;
};

function supported(): boolean {
  return typeof indexedDB !== "undefined";
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!supported()) {
      reject(new Error("IndexedDB is not available"));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_MEDIA)) db.createObjectStore(STORE_MEDIA, { keyPath: "materialId" });
      if (!db.objectStoreNames.contains(STORE_NOTES)) db.createObjectStore(STORE_NOTES, { keyPath: "key" });
      if (!db.objectStoreNames.contains(STORE_KV)) db.createObjectStore(STORE_KV);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open the offline store"));
  });
}

function tx<T>(store: string, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(store, mode);
        const request = run(transaction.objectStore(store));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        transaction.oncomplete = () => db.close();
        transaction.onabort = () => reject(transaction.error);
      }),
  );
}

function getAll<T>(store: string): Promise<T[]> {
  return tx<T[]>(store, "readonly", (s) => s.getAll() as IDBRequest<T[]>).catch(() => []);
}

// ---------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------

export async function putMedia(item: OfflineMedia): Promise<void> {
  await tx(STORE_MEDIA, "readwrite", (s) => s.put(item));
}

export async function getMedia(materialId: string): Promise<OfflineMedia | null> {
  try {
    const row = await tx<OfflineMedia | undefined>(STORE_MEDIA, "readonly", (s) => s.get(materialId));
    return row ?? null;
  } catch {
    return null;
  }
}

export async function hasMedia(materialId: string): Promise<boolean> {
  return (await getMedia(materialId)) !== null;
}

export async function deleteMedia(materialId: string): Promise<void> {
  try {
    await tx(STORE_MEDIA, "readwrite", (s) => s.delete(materialId));
  } catch {
    /* nothing to do */
  }
}

/** List without pulling every video blob into memory. */
export async function listMedia(): Promise<OfflineMediaRow[]> {
  const rows = await getAll<OfflineMedia>(STORE_MEDIA);
  return rows
    .map(({ blob: _blob, thumbBlob: _thumb, ...rest }) => rest)
    .sort((a, b) => b.downloadedAt - a.downloadedAt);
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

export function noteKey(kind: OfflineNoteKind, materialId: string): string {
  return `${kind}:${materialId}`;
}

export async function putNote(note: Omit<OfflineNote, "key" | "downloadedAt">): Promise<void> {
  const row: OfflineNote = { ...note, key: noteKey(note.kind, note.materialId), downloadedAt: Date.now() };
  await tx(STORE_NOTES, "readwrite", (s) => s.put(row));
}

export async function getNote(kind: OfflineNoteKind, materialId: string): Promise<OfflineNote | null> {
  try {
    const row = await tx<OfflineNote | undefined>(STORE_NOTES, "readonly", (s) => s.get(noteKey(kind, materialId)));
    return row ?? null;
  } catch {
    return null;
  }
}

export async function deleteNote(kind: OfflineNoteKind, materialId: string): Promise<void> {
  try {
    await tx(STORE_NOTES, "readwrite", (s) => s.delete(noteKey(kind, materialId)));
  } catch {
    /* nothing to do */
  }
}

export async function listNotes(): Promise<OfflineNote[]> {
  const rows = await getAll<OfflineNote>(STORE_NOTES);
  return rows.sort((a, b) => b.downloadedAt - a.downloadedAt);
}

// ---------------------------------------------------------------------------
// KV — sweep bookkeeping
// ---------------------------------------------------------------------------

const KV_LAST_CLEARED = "lastClearedCount";
const KV_LAST_SWEEP = "lastSweepAt";

async function kvGet<T>(key: string): Promise<T | null> {
  try {
    const value = await tx<T | undefined>(STORE_KV, "readonly", (s) => s.get(key));
    return value ?? null;
  } catch {
    return null;
  }
}

async function kvPut(key: string, value: unknown): Promise<void> {
  try {
    await tx(STORE_KV, "readwrite", (s) => s.put(value, key));
  } catch {
    /* nothing to do */
  }
}

/**
 * Delete expired media and notes. Call on app open. Returns how many media
 * items went, and stashes it so the offline page can show one honest toast
 * ("3 old class recordings were cleared") instead of a silent disappearance.
 */
export async function sweepExpired(now: number = Date.now()): Promise<{ cleared: number }> {
  if (!supported()) return { cleared: 0 };
  const media = await getAll<OfflineMedia>(STORE_MEDIA);
  const expired = media.filter((m) => m.expiresAt != null && m.expiresAt <= now);
  for (const item of expired) await deleteMedia(item.materialId);
  await kvPut(KV_LAST_SWEEP, now);
  if (expired.length > 0) await kvPut(KV_LAST_CLEARED, expired.length);
  return { cleared: expired.length };
}

/** Read-and-clear the "we removed N items last sweep" counter, for the toast. */
export async function takeLastClearedCount(): Promise<number> {
  const value = (await kvGet<number>(KV_LAST_CLEARED)) ?? 0;
  if (value > 0) await kvPut(KV_LAST_CLEARED, 0);
  return value;
}

// ---------------------------------------------------------------------------
// Usage
// ---------------------------------------------------------------------------

export async function usage(): Promise<{ bytes: number; count: number; quota: number | null; capBytes: number }> {
  const rows = await listMedia();
  const bytes = rows.reduce((sum, row) => sum + (row.sizeBytes || 0), 0);
  let quota: number | null = null;
  try {
    if (navigator.storage?.estimate) {
      const est = await navigator.storage.estimate();
      quota = typeof est.quota === "number" ? est.quota : null;
    }
  } catch {
    quota = null;
  }
  return { bytes, count: rows.length, quota, capBytes: OFFLINE_CAP_BYTES };
}

export async function wouldExceedCap(nextBytes: number): Promise<boolean> {
  const { bytes } = await usage();
  return bytes + nextBytes > OFFLINE_CAP_BYTES;
}

export function isOfflineStoreSupported(): boolean {
  return supported();
}
