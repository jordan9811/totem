// BROWSER KEYSTORE PASS Gate 1, stage 3 — where the device keeps its small files.
//
// The keystore (root.json), the device key (device.json), the zk identity index and pins, the envelope counters,
// the issuer keys and the retention files were all node:fs reads and writes under .keystore/. The device is now the
// browser as well as the rig's server process (docs/custody-model.md D-CU-0-2), so those modules read and write
// through THIS layer: on Node it is the filesystem, atomic writes included; in the browser it is an in-memory
// mirror loaded from IndexedDB at device boot and persisted back on every write, every value wrapped at rest under
// the device's non-extractable wrapping key (lib/device/browser/storage.ts registers that backend).
//
// The API is synchronous on purpose: the callers are synchronous (a signature has no await in it), and a backend
// that needs async I/O does it behind the mirror.
export interface StorageBackend {
  exists(path: string): boolean;
  readText(path: string): string;
  readBytes(path: string): Uint8Array;
  writeText(path: string, text: string): void;
  writeBytes(path: string, bytes: Uint8Array): void;
  remove(path: string): void;
  list(dir: string): string[];
}

function nodeBackend(): StorageBackend {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require("node:fs") as typeof import("node:fs");
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const p = require("node:path") as typeof import("node:path");
  const atomic = (file: string, data: string | Uint8Array) => {
    fs.mkdirSync(p.dirname(file), { recursive: true });
    const tmp = file + ".tmp";
    fs.writeFileSync(tmp, data);
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        fs.renameSync(tmp, file);
        lastErr = null;
        break;
      } catch (e) {
        // Windows: a concurrent reader can hold the destination for a moment; back off and retry
        lastErr = e;
        const until = Date.now() + 25 * (attempt + 1);
        while (Date.now() < until) {
          /* spin */
        }
      }
    }
    if (lastErr) {
      fs.writeFileSync(file, data);
      try {
        fs.unlinkSync(tmp);
      } catch {
        /* nothing to clean */
      }
    }
  };
  return {
    exists: (path) => fs.existsSync(path),
    readText: (path) => fs.readFileSync(path, "utf8"),
    readBytes: (path) => new Uint8Array(fs.readFileSync(path)),
    writeText: (path, text) => atomic(path, text),
    writeBytes: (path, bytes) => atomic(path, bytes),
    remove: (path) => {
      try {
        fs.unlinkSync(path);
      } catch {
        /* already gone */
      }
    },
    list: (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir) : []),
  };
}

const g = globalThis as unknown as { __layersStorage?: StorageBackend };

/** the browser device registers its backend before anything reads a key; Node needs nothing */
export function setStorageBackend(backend: StorageBackend): void {
  g.__layersStorage = backend;
}

function backend(): StorageBackend {
  if (g.__layersStorage) return g.__layersStorage;
  if (typeof process !== "undefined" && process.versions?.node && typeof window === "undefined") {
    g.__layersStorage = nodeBackend();
    return g.__layersStorage;
  }
  throw new Error("platform/storage: no storage backend registered — the browser device must call setStorageBackend() at boot");
}

export const storage = {
  exists: (path: string) => backend().exists(path),
  readText: (path: string) => backend().readText(path),
  readBytes: (path: string) => backend().readBytes(path),
  writeText: (path: string, text: string) => backend().writeText(path, text),
  writeBytes: (path: string, bytes: Uint8Array) => backend().writeBytes(path, bytes),
  remove: (path: string) => backend().remove(path),
  list: (dir: string) => backend().list(dir),
};
