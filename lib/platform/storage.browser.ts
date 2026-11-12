// BROWSER KEYSTORE PASS Gate 1 stage 3 — the storage backend the browser device registers (lib/platform/storage.ts).
//
// Everything the keystore modules write (root.json, device.json, zk-identity.json, zk-pins.json, envelope counters,
// issuer keys, retention files) lands in an in-memory map: ephemeral-first (docs/custody-model.md D-CU-0-6), a tab
// that closes takes its seed with it. When the visitor chooses to keep the identity on this device, persistence is
// enabled: a NON-EXTRACTABLE AES-256-GCM wrapping key is generated inside WebCrypto and stored in IndexedDB as a
// CryptoKey (structured-cloneable, never exportable), and every entry is written to IndexedDB as ciphertext under
// it with the entry's path as associated data. On the next visit the map is rebuilt by unwrapping. Nothing here
// reaches any server; the wrapping key never leaves the browser's key store.
import { setStorageBackend, type StorageBackend } from "@/lib/platform/storage";

const DB_NAME = "layers-device";
const DB_VERSION = 1;
const FILES = "files";
const KEYS = "keys";
const WRAP_KEY_ID = "wrap";

function idbOpen(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(FILES)) db.createObjectStore(FILES);
      if (!db.objectStoreNames.contains(KEYS)) db.createObjectStore(KEYS);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(db: IDBDatabase, store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const r = fn(t.objectStore(store));
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function allEntries(db: IDBDatabase, store: string): Promise<[IDBValidKey, unknown][]> {
  return new Promise((resolve, reject) => {
    const out: [IDBValidKey, unknown][] = [];
    const req = db.transaction(store, "readonly").objectStore(store).openCursor();
    req.onsuccess = () => {
      const c = req.result;
      if (!c) return resolve(out);
      out.push([c.key, c.value]);
      c.continue();
    };
    req.onerror = () => reject(req.error);
  });
}

interface SealedEntry {
  iv: Uint8Array;
  ct: Uint8Array;
}

const te = new TextEncoder();
const td = new TextDecoder();

// TypeScript 5.7 types typed arrays over ArrayBufferLike; WebCrypto wants ArrayBuffer-backed views — these are
const view = (b: Uint8Array): BufferSource => b as unknown as BufferSource;

async function seal(key: CryptoKey, path: string, plaintext: Uint8Array): Promise<SealedEntry> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: view(iv), additionalData: view(te.encode(path)) }, key, view(plaintext)));
  return { iv, ct };
}

async function open(key: CryptoKey, path: string, entry: SealedEntry): Promise<Uint8Array> {
  return new Uint8Array(
    await crypto.subtle.decrypt({ name: "AES-GCM", iv: view(entry.iv), additionalData: view(te.encode(path)) }, key, view(entry.ct))
  );
}

export interface BrowserStorage {
  /** true when a saved identity was found in IndexedDB and unwrapped into memory at open */
  restored: boolean;
  /** true once writes are being mirrored to IndexedDB under the wrapping key */
  persistent: boolean;
  /** keep this identity on this device: mint the wrapping key and mirror everything from now on */
  enablePersistence(): Promise<void>;
  /** forget everything on this device (memory and IndexedDB) */
  wipe(): Promise<void>;
  /** the paths currently held (for the smoke and the leak grep, never for a payload) */
  paths(): string[];
}

/** Open the device's storage, register it as THE storage backend, and report whether an identity was restored. */
export async function openBrowserStorage(): Promise<BrowserStorage> {
  const mem = new Map<string, Uint8Array>();
  const db = await idbOpen();
  let wrapKey: CryptoKey | null = (await tx<CryptoKey | undefined>(db, KEYS, "readonly", (s) => s.get(WRAP_KEY_ID))) ?? null;
  let restored = false;
  if (wrapKey) {
    for (const [k, v] of await allEntries(db, FILES)) {
      try {
        mem.set(String(k), await open(wrapKey, String(k), v as SealedEntry));
        restored = true;
      } catch (e) {
        // a record that does not open under this key is not ours to guess at: skip it loudly
        console.error("[device] storage: could not unwrap " + String(k), e);
      }
    }
  }
  let queue: Promise<unknown> = Promise.resolve();
  const mirror = (path: string, bytes: Uint8Array | null) => {
    if (!wrapKey) return;
    const key = wrapKey;
    queue = queue
      .then(async () => {
        if (bytes === null) {
          await tx(db, FILES, "readwrite", (s) => s.delete(path));
        } else {
          const sealed = await seal(key, path, bytes);
          await tx(db, FILES, "readwrite", (s) => s.put(sealed, path));
        }
      })
      .catch((e) => console.error("[device] storage: mirror failed for " + path, e));
  };
  const backend: StorageBackend = {
    exists: (path) => mem.has(path),
    readText: (path) => {
      const v = mem.get(path);
      if (v === undefined) throw Object.assign(new Error("ENOENT: " + path), { code: "ENOENT" });
      return td.decode(v);
    },
    readBytes: (path) => {
      const v = mem.get(path);
      if (v === undefined) throw Object.assign(new Error("ENOENT: " + path), { code: "ENOENT" });
      return v;
    },
    writeText: (path, text) => {
      const bytes = te.encode(text);
      mem.set(path, bytes);
      mirror(path, bytes);
    },
    writeBytes: (path, bytes) => {
      mem.set(path, bytes);
      mirror(path, bytes);
    },
    remove: (path) => {
      mem.delete(path);
      mirror(path, null);
    },
    list: (dir) => {
      const prefix = dir.endsWith("/") ? dir : dir + "/";
      return [...mem.keys()].filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length)).filter((k) => !k.includes("/"));
    },
  };
  setStorageBackend(backend);
  const api: BrowserStorage = {
    restored,
    get persistent() {
      return wrapKey !== null;
    },
    async enablePersistence() {
      if (wrapKey) return;
      const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
      await tx(db, KEYS, "readwrite", (s) => s.put(key, WRAP_KEY_ID));
      wrapKey = key;
      for (const [path, bytes] of mem) mirror(path, bytes);
      await queue;
    },
    async wipe() {
      // attack-custody-1 (noted): drop the key first so nothing new is enqueued, drain what was, THEN clear — a
      // write enqueued just before the wipe must not land after it
      mem.clear();
      wrapKey = null;
      await queue.catch(() => {});
      await tx(db, FILES, "readwrite", (s) => s.clear());
      await tx(db, KEYS, "readwrite", (s) => s.clear());
    },
    paths: () => [...mem.keys()],
  };
  return api;
}
