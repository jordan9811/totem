// BROWSER KEYSTORE PASS Gate 2 — the device's custody API: save this identity under a method, unlock an identity by
// a method, attach a second method, export and import the 24 words. Every path ends in the same place — the seed the
// device holds, wrapped or unwrapped — and every secret it touches (PRF output, provider export, KEK) is kept only
// as long as the operation runs, then dropped (kept in `secretsForLeakGrep` for the smoke's grep alone).
import type { DeviceInfo } from "@/lib/device/boot";
import { assertPasskey, fromB64url, passkeyCapabilities, registerPasskey } from "@/lib/device/custody/passkey";
import { kekFromPrf, kekFromProvider, kekFromRelease, unwrapSeed, wrapSeed, bytesToHex, type WrappedSeed } from "@/lib/device/custody/wrap";
import { PROVIDER_METHODS, providerAdapter, providerAvailable, providerMethodId, type ProviderMethod } from "@/lib/device/custody/provider";
import { getBlob, getMethod, listMethods, localBlob, mirrorBlob, putBlob, putMethod, type MethodRecord } from "@/lib/device/custody/methods";
import type { BrowserStorage } from "@/lib/platform/storage.browser";

export type SavePath = "prf" | "wrap";
export interface SaveResult {
  methodId: string;
  kind: "passkey-prf" | "passkey-wrap" | "provider";
  /** true when this method was added to an identity that already had one (attach), false for a first save */
  attached: boolean;
}
export type UnlockResult =
  | { empty: false; info: DeviceInfo; methodId: string; kind: "passkey-prf" | "passkey-wrap" | "provider" }
  /** D-CU-2-A-LOGIN-THAT-FINDS-NOTHING-DOES-NOT-CREATE: the fork's signal */
  | { empty: true; methodId: string; kind: "passkey" | "provider"; subject?: string };

export interface CustodyStatus {
  persistent: boolean;
  methods: MethodRecord[];
  /** the method list could not be read — a save would be mislabelled, so the page says so instead */
  methodsUnknown: boolean;
  webauthn: boolean;
  platformAuthenticator: boolean;
  wrapPathAvailable: boolean;
  /** false on a public deployment without a real provider: the fixture is a rig adapter (attack-custody-1 #1) */
  providerAvailable: boolean;
  providerMethods: ProviderMethod[];
  rpId: string;
}

const orig = (): typeof fetch => ((globalThis as unknown as { __layersOrigFetch?: typeof fetch }).__layersOrigFetch ?? fetch);
const rpId = () => (/^\d+\.\d+\.\d+\.\d+$/.test(location.hostname) ? "localhost" : location.hostname);
async function serverJson(path: string, body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const r = await orig()(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: r.status, json: (await r.json().catch(() => ({}))) as Record<string, unknown> };
}

let storageRef: BrowserStorage | null = null;
export function bindStorage(s: BrowserStorage): void {
  storageRef = s;
}
const secrets: string[] = [];
const remember = (b: Uint8Array) => {
  secrets.push(bytesToHex(b));
};
/** for scripts/accept-cu2.mjs's leak grep only — every KEK, PRF output and provider export this device used */
export function secretsForLeakGrep(): string[] {
  return [...secrets];
}

async function currentSeedHex(): Promise<string> {
  const ks = await import("@/lib/identity/keystore");
  // a LINKED device holds no seed: it can neither wrap one under a new method nor export the 24 words
  if (ks.isLinkedDevice()) throw new Error("this device holds a LINKED root and no seed — save methods and export the 24 words on a device that holds the root");
  return ks.rootMaterialForLeakTest()[0];
}

/** install a seed the device now holds the right to: enrol under its anchor, restore its roster, re-boot the identity */
async function installSeed(seedHex: string, opts: { createAnchor?: boolean } = {}): Promise<DeviceInfo> {
  const current = await currentSeedHex();
  const boot = await import("@/lib/device/boot");
  if (seedHex === current) return boot.currentInfo();
  const { recoverIdentity } = await import("@/lib/identity/roster");
  await recoverIdentity(seedHex, opts);
  return boot.reloadIdentity();
}

let wrapProbe: boolean | null = null;
async function wrapPathAvailable(): Promise<boolean> {
  if (wrapProbe !== null) return wrapProbe;
  try {
    const r = await orig()("/api/custody/passkey/challenge", { method: "POST" });
    wrapProbe = r.status === 200;
  } catch {
    wrapProbe = false;
  }
  return wrapProbe;
}

export async function status(): Promise<CustodyStatus> {
  const caps = await passkeyCapabilities();
  let methods: MethodRecord[] = [];
  let methodsUnknown = false;
  try {
    methods = await listMethods();
  } catch {
    methodsUnknown = true;
  }
  return {
    persistent: storageRef?.persistent ?? false,
    methods,
    methodsUnknown,
    webauthn: caps.webauthn,
    platformAuthenticator: caps.platform,
    wrapPathAvailable: await wrapPathAvailable(),
    providerAvailable: providerAvailable(),
    providerMethods: PROVIDER_METHODS,
    rpId: rpId(),
  };
}

/** Save (or attach): a passkey. PRF where the authenticator offers it, the wrap path otherwise, recorded on the method. */
export async function savePasskey(): Promise<SaveResult & { path: SavePath }> {
  const reg = await registerPasskey({ rpId: rpId(), rpName: "Totem", userName: "Totem identity" });
  const methodId = "pk:" + reg.credentialId;
  const had = (await listMethods()).length > 0; // throws if the list cannot be read: a save is never mislabelled (attack-custody-2 #19)
  let kek: Uint8Array;
  let kind: "passkey-prf" | "passkey-wrap";
  if (reg.prfEnabled) {
    const a = await assertPasskey({ rpId: rpId(), evalPrf: true, allow: [reg.credentialId] });
    if (!a.prf) throw new Error("passkey: the authenticator enabled PRF at creation but returned none on assertion");
    remember(a.prf);
    kek = kekFromPrf(a.prf);
    kind = "passkey-prf";
  } else {
    if (!(await wrapPathAvailable())) throw new Error("this passkey has no PRF and the server offers no wrap path — use a social login or a PRF-capable passkey");
    const c = await serverJson("/api/custody/passkey/challenge", {});
    if (c.status !== 200) throw new Error("wrap path: no challenge (" + c.status + ")");
    const a = await assertPasskey({ rpId: rpId(), challenge: fromB64url(String(c.json.challenge)), evalPrf: false, allow: [reg.credentialId] });
    const r = await serverJson("/api/custody/passkey/release", { challenge: c.json, assertion: a.assertion, credentialId: reg.credentialId, spkiHex: reg.spkiHex, alg: reg.alg });
    if (r.status !== 200 || typeof r.json.kek !== "string") throw new Error("wrap path: release refused (" + r.status + ") " + String(r.json.error ?? ""));
    kek = kekFromRelease(r.json.kek);
    kind = "passkey-wrap";
  }
  remember(kek);
  await putMethod(methodId, { kind, pubkeySpki: reg.spkiHex, alg: reg.alg });
  const blob = wrapSeed(await currentSeedHex(), kek, methodId);
  if (kind === "passkey-prf") await putBlob(methodId, blob); // reachable by the same synced passkey anywhere
  await storageRef?.enablePersistence(); // the local copy — for the wrap path, the ONLY copy (D-CU-0-8)
  mirrorBlob(methodId, blob);
  return { methodId, kind, attached: had, path: kind === "passkey-prf" ? "prf" : "wrap" };
}

/** Unlock by passkey: one discoverable assertion, no username. */
export async function unlockPasskey(): Promise<UnlockResult> {
  const wrapOk = await wrapPathAvailable();
  const c = wrapOk ? await serverJson("/api/custody/passkey/challenge", {}) : null;
  const a = await assertPasskey({ rpId: rpId(), challenge: c && c.status === 200 ? fromB64url(String(c.json.challenge)) : undefined, evalPrf: true });
  const methodId = "pk:" + a.credentialId;
  // attack-custody-2 #13: "empty" is a confirmed 404 from the validator AND no local copy — a lookup that failed
  // otherwise throws (getMethod), and a device that holds the blob locally is not an empty account
  const rec = await getMethod(methodId);
  if (!rec) {
    const local = localBlob(methodId);
    if (!local) return { empty: true, methodId, kind: "passkey" };
    throw new Error("this device holds a wrapped identity under that passkey but the validator no longer records it — restore from the 24 words, or link a device that holds the root");
  }
  let kek: Uint8Array;
  let blob: WrappedSeed | null;
  if (rec.kind === "passkey-prf") {
    if (!a.prf) throw new Error("this passkey was saved with PRF but this browser evaluated none");
    remember(a.prf);
    kek = kekFromPrf(a.prf);
    blob = (await getBlob(methodId)) ?? localBlob(methodId);
  } else if (rec.kind === "passkey-wrap") {
    if (!c || c.status !== 200) throw new Error("this passkey is on the wrap path and the server offers no release");
    const r = await serverJson("/api/custody/passkey/release", { challenge: c.json, assertion: a.assertion, credentialId: a.credentialId });
    if (r.status !== 200 || typeof r.json.kek !== "string") throw new Error("wrap path: release refused (" + r.status + ")");
    kek = kekFromRelease(r.json.kek);
    blob = localBlob(methodId);
    if (!blob) throw new Error("this passkey is device-bound: its wrapped identity lives only on the device that saved it — link that device, or use the 24 words");
  } else {
    throw new Error("unexpected method kind " + rec.kind);
  }
  if (!blob) throw new Error("no wrapped identity under this passkey");
  remember(kek);
  const seedHex = unwrapSeed(blob, kek, methodId);
  const info = await installSeed(seedHex);
  return { empty: false, info, methodId, kind: rec.kind };
}

/** Save (or attach): a provider login. The provider's export is a KEK source, never the root. */
export async function saveProvider(method: ProviderMethod, hint?: string): Promise<SaveResult & { subject: string }> {
  const p = providerAdapter();
  const login = await p.login(method, hint);
  remember(login.exported);
  const methodId = providerMethodId(p.name, method, login.subject);
  const had = (await listMethods()).length > 0; // throws if the list cannot be read: a save is never mislabelled (attack-custody-2 #19)
  const kek = kekFromProvider(login.exported);
  remember(kek);
  await putMethod(methodId, { kind: "provider" });
  const blob = wrapSeed(await currentSeedHex(), kek, methodId);
  await putBlob(methodId, blob);
  await storageRef?.enablePersistence();
  mirrorBlob(methodId, blob);
  return { methodId, kind: "provider", attached: had, subject: login.subject };
}

/** Unlock by provider: a login that resolves to no record is an EMPTY account, reported, never created here. */
export async function unlockProvider(method: ProviderMethod, hint?: string): Promise<UnlockResult> {
  const p = providerAdapter();
  const login = await p.login(method, hint);
  const methodId = providerMethodId(p.name, method, login.subject);
  const rec = await getMethod(methodId);
  if (!rec) {
    // attack-custody-2 #13, the provider side: a confirmed 404 with no local copy is EMPTY; a local copy under a
    // method the validator no longer records is a fault the person must hear about, not a fresh empty account
    const local = localBlob(methodId);
    if (!local) return { empty: true, methodId, kind: "provider", subject: login.subject };
    throw new Error("this device holds a wrapped identity under that login but the validator no longer records it — restore from the 24 words, or link a device that holds the root");
  }
  if (rec.kind !== "provider") throw new Error("unexpected method kind " + rec.kind + " under a provider id"); // attack-custody-2 #24
  remember(login.exported);
  const kek = kekFromProvider(login.exported);
  remember(kek);
  const blob = (await getBlob(methodId)) ?? localBlob(methodId);
  if (!blob) throw new Error("no wrapped identity under this login");
  const seedHex = unwrapSeed(blob, kek, methodId);
  const info = await installSeed(seedHex);
  return { empty: false, info, methodId, kind: "provider" };
}

/** the 24 words, produced in the device, shown in the browser, never transmitted */
export async function exportPhrase(): Promise<string> {
  const { seedToMnemonic } = await import("@/lib/recovery/mnemonic");
  return seedToMnemonic(await currentSeedHex());
}

/** 24 words in: the crypto pass's recovery, then a re-boot of the device identity under the recovered root */
export async function importPhrase(words: string): Promise<DeviceInfo> {
  const { mnemonicToSeed } = await import("@/lib/recovery/mnemonic");
  const seedHex = mnemonicToSeed(words.trim().split(/\s+/).join(" "));
  // attack-custody-2 #20: the 24 words are the root's proof of possession — a phrase whose anchor was never
  // registered (generated on a device that never wrote) enrols and CREATES its anchor here; the method paths above
  // keep existingOnly, because a wrapped blob only exists for a root that already wrote
  return installSeed(seedHex, { createAnchor: true });
}
