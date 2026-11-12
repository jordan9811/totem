import "server-only";
// POST AS YOU — THE rootSigner NAMESPACE: the sealed record of the visitor's OWN posting key for their own Farcaster
// account (the root, the account Sign in with Farcaster linked: lib/fc/siwf/links.ts).
//
// WHAT IT HOLDS: ONE opaque record (key "_") sealed under the vault key, padded so its ciphertext is EXACTLY
// ROOT_SIGNER_BYTES (1,024) long whether it holds a key or not: {v: 1, signer: null | {fid, priv, key, appFid, state
// ("pending" | "active"), token, deeplinkUrl, deadline, createdAt, activatedAt}, forgotten: null | {key, fid, at}}.
// `priv` is the Ed25519 PRIVATE key (64 hex), made in this tab by crypto.getRandomValues (via @noble's randomPrivateKey).
// Like the connector record's custody keys (lib/fc/connector.server.ts, "fcConnector"), it is a random key sealed in the
// vault: the validator holds ciphertext only. It is NOT derived from the seed and shares no derivation with any persona
// key (lib/crypto/kdf.ts), so posting as the root can never use, or reveal, a persona's key. `forgotten` keeps the PUBLIC
// half of a key a Disconnect forgot, so the page can still say which app key to remove in the Farcaster app.
//
// CONFINEMENT: the private key never leaves this module. signAsRoot() builds and signs a message here
// (lib/fc/hub/message.ts) and returns its bytes; status views carry the public key only. The DEBUG needle
// (rootSignerNeedlesForLeakGrep) exists for the leak grep under LAYERS_DEVICE_DEBUG=1 only.
//
// UNIFORM PRESENCE: lib/device/boot.ts seals the EMPTY record for every root that never sealed it
// (ensureRootSignerNamespace), so the namespace's existence and size on the validator carry no bit.
//
// THE accountLinks DISCIPLINE, rule for rule (never fail open): loadStrict reads with retries; a non-OK answer, an
// unreadable record, or an EMPTY/404 namespace this device sealed before (lib/vault/sealedPins.ts) THROWS; only a read
// document (or one this process sealed) is cached; writes run one at a time on top of loadStrict(); a 409 re-reads FIRST.
import { ed25519 } from "@noble/curves/ed25519";
import { decryptNamespace, encryptNamespace } from "@/lib/vault/vault";
import { flushVault, fetchState } from "@/lib/adapters/mock/persist";
import { bytesToHex, makeMessage, publicKeyHex, type HubBody, type HubMessage } from "@/lib/fc/hub/message";

export const ROOT_SIGNER_NS = "rootSigner";
export const ROOT_SIGNER_BYTES = 1024;
const PLAINTEXT_BYTES = ROOT_SIGNER_BYTES - 16;
const WRAPPER_BYTES = 15;
export const MAX_DOC_BYTES = PLAINTEXT_BYTES - WRAPPER_BYTES;

export type RootSignerState = "pending" | "active";
export interface RootSigner {
  fid: number;
  /** SECRET: the Ed25519 private key, 64 hex. Never leaves this module. */
  priv: string;
  /** the public key, "0x" + 64 hex */
  key: string;
  appFid: number;
  state: RootSignerState;
  /** pending only: Farcaster's request token and its link (they let the visitor finish an approval after a reload) */
  token: string | null;
  deeplinkUrl: string | null;
  /** the SignedKeyRequest's deadline, unix SECONDS */
  deadline: number;
  createdAt: number;
  activatedAt: number | null;
}
export interface RootSignerDoc {
  v: 1;
  signer: RootSigner | null;
  /** the last key a Disconnect forgot: its PUBLIC half, for "remove it in the Farcaster app" */
  forgotten: { key: string; fid: number; at: number } | null;
}
/** what may leave this module about the key: everything but `priv` */
export type RootSignerView = Omit<RootSigner, "priv">;

interface Loaded {
  doc: RootSignerDoc;
  present: boolean;
}
const g = globalThis as unknown as { __layersRootSigner?: Loaded | null; __layersRootSignerWrite?: Promise<unknown> };
const NS = ROOT_SIGNER_NS as Parameters<typeof flushVault>[0];
const utf8Bytes = (s: string) => new TextEncoder().encode(s).length;
const KEY_RE = /^0x[0-9a-f]{64}$/;
const PRIV_RE = /^[0-9a-f]{64}$/;

function readSigner(raw: unknown): RootSigner {
  const r = raw as Record<string, unknown>;
  const int = (v: unknown) => (Number.isSafeInteger(v) && (v as number) > 0 ? (v as number) : null);
  const str = (v: unknown, max: number) => (typeof v === "string" && v.length <= max ? v : null);
  if (!r || typeof r !== "object" || !int(r.fid) || !int(r.appFid) || typeof r.priv !== "string" || !PRIV_RE.test(r.priv) || typeof r.key !== "string" || !KEY_RE.test(r.key) || (r.state !== "pending" && r.state !== "active"))
    throw new Error("vault: rootSigner holds a key this device cannot read — refusing rather than guessing");
  // the record's key must be its private key's public half: a doctored record is refused, never posted with
  if ("0x" + publicKeyHex(r.priv) !== r.key) throw new Error("vault: rootSigner's key does not match its private key — refusing");
  return {
    fid: r.fid as number,
    priv: r.priv,
    key: r.key,
    appFid: r.appFid as number,
    state: r.state,
    token: str(r.token, 160),
    deeplinkUrl: str(r.deeplinkUrl, 300),
    deadline: int(r.deadline) ?? 0,
    createdAt: Number.isFinite(r.createdAt) ? (r.createdAt as number) : 0,
    activatedAt: Number.isFinite(r.activatedAt) ? (r.activatedAt as number) : null,
  };
}
function readForgotten(raw: unknown): RootSignerDoc["forgotten"] {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  return typeof r.key === "string" && KEY_RE.test(r.key) && Number.isSafeInteger(r.fid) && Number.isFinite(r.at) ? { key: r.key, fid: r.fid as number, at: r.at as number } : null;
}

async function loadStrict(): Promise<Loaded> {
  if (g.__layersRootSigner) return g.__layersRootSigner;
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetchState(ROOT_SIGNER_NS);
      let loaded: Loaded = { doc: { v: 1, signer: null, forgotten: null }, present: false };
      const { wasEverSealed } = await import("@/lib/vault/sealedPins");
      if (res.status === 404) {
        if (wasEverSealed(ROOT_SIGNER_NS)) throw new Error("vault: rootSigner answered 404 but this device has sealed it before — refusing rather than treating a missing namespace as a fresh one");
      } else {
        if (!res.ok) throw new Error("validator answered " + res.status);
        const { entries } = (await res.json()) as { entries?: Record<string, unknown> };
        if (entries && Object.keys(entries).length) {
          const plain = decryptNamespace(ROOT_SIGNER_NS, entries);
          const rec = plain["_"] as { m?: { v?: unknown; signer?: unknown; forgotten?: unknown } } | undefined;
          if (!rec || !rec.m || rec.m.v !== 1 || !("signer" in rec.m)) throw new Error("vault: rootSigner holds " + Object.keys(entries).length + " record(s), none readable by this device — refusing rather than treating a corrupted namespace as an empty one");
          loaded = { doc: { v: 1, signer: rec.m.signer === null ? null : readSigner(rec.m.signer), forgotten: readForgotten(rec.m.forgotten) }, present: true };
        } else if (wasEverSealed(ROOT_SIGNER_NS)) {
          throw new Error("vault: rootSigner is EMPTY on the validator but this device has sealed it before — refusing rather than treating a deleted namespace as a fresh one");
        }
      }
      g.__layersRootSigner = loaded;
      return loaded;
    } catch (e) {
      lastErr = e;
      if (String((e as Error)?.message ?? "").startsWith("vault:")) break;
      await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
    }
  }
  throw new Error("your posting key could not be read (" + ((lastErr as Error)?.message ?? "validator unreachable") + ") — refusing rather than treating it as none");
}

/** the sealed entries for `doc`: one record "_" whose ciphertext is EXACTLY ROOT_SIGNER_BYTES long */
export function sealRootSignerDoc(doc: RootSignerDoc): Record<string, unknown> {
  const inner = JSON.stringify(doc);
  const pad = PLAINTEXT_BYTES - WRAPPER_BYTES - utf8Bytes(inner);
  if (pad < 0) throw new Error("internal: the rootSigner document is larger than one padded record");
  return encryptNamespace(ROOT_SIGNER_NS, { _: { m: doc, pad: " ".repeat(pad) } });
}

async function save(doc: RootSignerDoc): Promise<void> {
  if (!g.__layersRootSigner) throw new Error("internal: rootSigner save() before any successful load");
  if (doc === g.__layersRootSigner.doc) throw new Error("internal: rootSigner save() was handed the cached document — build a new one");
  await flushVault(NS, sealRootSignerDoc(doc));
  const { markEverSealed } = await import("@/lib/vault/sealedPins");
  markEverSealed(ROOT_SIGNER_NS);
  g.__layersRootSigner = { doc, present: true };
}
function withWrite<T>(fn: () => Promise<T>): Promise<T> {
  const run = (g.__layersRootSignerWrite ?? Promise.resolve()).then(fn, fn);
  g.__layersRootSignerWrite = run.catch(() => undefined);
  return run;
}
const clone = (d: RootSignerDoc): RootSignerDoc => ({ v: 1, signer: d.signer ? { ...d.signer } : null, forgotten: d.forgotten ? { ...d.forgotten } : null });

/** apply `mutate` to the document the validator holds and seal it; a 409 re-reads first and applies it again, once */
export function updateRootSigner(mutate: (doc: RootSignerDoc) => RootSignerDoc): Promise<RootSignerDoc> {
  return withWrite(async () => {
    const attempt = async () => {
      const next = mutate(clone((await loadStrict()).doc));
      if (next.signer && next.signer.deeplinkUrl && next.signer.deeplinkUrl.length > 300) throw new Error("internal: the deeplink is too long to keep");
      await save(next);
      return next;
    };
    try {
      return await attempt();
    } catch (e) {
      if (!/HTTP 409\b/.test(String((e as Error)?.message ?? ""))) throw e;
      g.__layersRootSigner = null;
      return attempt();
    }
  });
}

/** a fresh Ed25519 key pair (the private half stays in the returned object, which only this module's callers seal) */
export function newRootKeyPair(): { priv: string; key: string } {
  const priv = bytesToHex(ed25519.utils.randomPrivateKey());
  return { priv, key: "0x" + publicKeyHex(priv) };
}

/** the key as it may be shown (never the private half); null when there is none. THROWS when it cannot be read. */
export async function rootSignerView(): Promise<{ signer: RootSignerView | null; forgotten: RootSignerDoc["forgotten"] }> {
  const { doc } = await loadStrict();
  if (!doc.signer) return { signer: null, forgotten: doc.forgotten };
  const { priv: _priv, ...view } = doc.signer;
  void _priv;
  return { signer: view, forgotten: doc.forgotten };
}

/**
 * Build and sign one message as the root with the ACTIVE key for `fid`. Refuses (throws, plain words) when the key is
 * not active, is for another account, or the body is one the node would refuse. Returns the signed message only.
 */
export async function signAsRoot(fid: number, body: HubBody, timestampMs = Date.now()): Promise<HubMessage> {
  const { doc } = await loadStrict();
  const s = doc.signer;
  if (!s || s.state !== "active") throw new Error("Totem has no active posting key for your account.");
  if (s.fid !== fid) throw new Error("This posting key belongs to another Farcaster account.");
  return makeMessage({ fid, timestampMs, body, privateKeyHex: s.priv });
}

/** UNIFORM PRESENCE: seal the empty record for a root that never sealed it (boot). THROWS when it cannot be read. */
export function ensureRootSignerNamespace(): Promise<"sealed" | "present"> {
  return withWrite(async () => {
    const loaded = await loadStrict();
    if (loaded.present) return "present" as const;
    await save({ v: 1, signer: null, forgotten: null });
    return "sealed" as const;
  });
}

/** DEBUG ONLY (LAYERS_DEVICE_DEBUG=1, the leak grep): the private key this device holds, if any */
export async function rootSignerNeedlesForLeakGrep(): Promise<string[]> {
  if (process.env.LAYERS_DEVICE_DEBUG !== "1") return [];
  const s = g.__layersRootSigner?.doc.signer;
  return s ? [s.priv] : [];
}

/** reloadIdentity / resetSeed: forget the cached document (a different root, or a wiped validator) */
export function resetRootSignerCache(): void {
  g.__layersRootSigner = null;
}
