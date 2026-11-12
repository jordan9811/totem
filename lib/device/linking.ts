// BROWSER KEYSTORE PASS Gate 3 — device linking in the browser topology (docs/custody-model.md D-CU-0-13;
// notes/reports/REPORT-CUSTODY.md D-CU-3-THE-CODE-COMES-FROM-THE-NEW-DEVICE, D-CU-3-THE-PAYLOAD-IS-THE-MATERIAL-A-DEVICE-NEEDS).
//
// NEW device: mints an X25519 keypair in memory, posts an OFFER (its device key, its HPKE public key), shows the code.
// OLD device (holds the root): enters the code, fetches the offer, issues a delegation for the new device's key,
// seals the material TO THE OFFER'S KEY with HPKE and posts it back under its own envelope.
// NEW device: polls, opens with the private key that never left memory, installs the linked root, re-boots.
// The seed never crosses; neither does the device-auth private key.
import { Aes256Gcm, CipherSuite, DhkemX25519HkdfSha256, HkdfSha256 } from "@hpke/core";
import { validatorUrl } from "@/lib/ports";
import { signedReadHeaders, signedWriteHeaders } from "@/lib/adapters/mock/persist";
import { createHash } from "@/lib/platform/crypto";
import { verifyCanonical } from "@/lib/crypto/ed25519";
import type { KeystorePersona, LinkedRoot } from "@/lib/identity/keystore";

const suite = new CipherSuite({ kem: new DhkemX25519HkdfSha256(), kdf: new HkdfSha256(), aead: new Aes256Gcm() });
const te = new TextEncoder();
const td = new TextDecoder();
const hex = (b: ArrayBuffer | Uint8Array) => [...(b instanceof Uint8Array ? b : new Uint8Array(b))].map((x) => x.toString(16).padStart(2, "0")).join("");
const unhex = (h: string) => new Uint8Array((h.match(/.{2}/g) ?? []).map((x) => parseInt(x, 16)));
const buf = (u: Uint8Array): ArrayBuffer => u.slice().buffer as ArrayBuffer;
const orig = (): typeof fetch => ((globalThis as unknown as { __layersOrigFetch?: typeof fetch }).__layersOrigFetch ?? fetch);
const base = () => validatorUrl();
const info = (code: string, deviceId: string) => buf(te.encode("layers/link/2|" + code + "|" + deviceId));

export interface LinkPayloadV2 {
  v: 2;
  rootId: string;
  anchorPubHex: string;
  delegation: unknown;
  vaultKeyHex: string;
  zkMasterHex: string | null;
  personas: KeystorePersona[];
  personaKeys: LinkedRoot["personaKeys"];
}

interface Offer {
  code: string;
  deviceId: string;
  devicePubKey: string;
  hpkePub: string;
  sealed: { enc: string; ct: string } | null;
  anchor: string | null;
  rootId: string | null;
  expiresAt: number;
}

let pending: { code: string; kp: CryptoKeyPair; deviceId: string; fingerprint: string } | null = null;
let lastPayloadJson: string | null = null;

/** the short string BOTH people compare before the root's device approves (attack-custody-3 #4): a function of the
 *  code and the two keys in the offer, so a swapped offer shows a different fingerprint on the approving side */
export function fingerprintOf(code: string, hpkePub: string, devicePubKey: string): string {
  const h = createHash("sha256").update("layers/link/fp/v1|" + code + "|" + hpkePub + "|" + devicePubKey).digest("hex");
  return (h.slice(0, 4) + "-" + h.slice(4, 8)).toUpperCase();
}

/** NEW device: post an offer, keep the private key in memory, return the code AND the fingerprint to show */
export async function offer(): Promise<{ code: string; expiresAt: number; fingerprint: string }> {
  const dk = await import("@/lib/identity/deviceKeys");
  const device = dk.deviceIdentity();
  const kp = await suite.kem.generateKeyPair();
  const hpkePub = hex(await suite.kem.serializePublicKey(kp.publicKey));
  const r = await orig()(`${base()}/link/offer`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ deviceId: device.deviceId, devicePubKey: device.pubHex, hpkePub }),
  });
  if (!r.ok) throw new Error("link: offer refused (" + r.status + ")");
  const j = (await r.json()) as { code: string; expiresAt: number };
  const fingerprint = fingerprintOf(j.code, hpkePub, device.pubHex);
  pending = { code: j.code, kp, deviceId: device.deviceId, fingerprint };
  return { ...j, fingerprint };
}

export function pendingFingerprint(): string | null {
  return pending?.fingerprint ?? null;
}

async function getOffer(code: string): Promise<Offer | null> {
  const r = await orig()(`${base()}/link/${encodeURIComponent(code)}`, { cache: "no-store" });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error("link: offer lookup " + r.status);
  return (await r.json()) as Offer;
}

/** OLD device (holds the root): read the offer, show its fingerprint, and only after the person confirms it matches
 *  what the new device shows (D-CU-5-A-LINK-IS-CONFIRMED-ACROSS-DEVICES), seal the material to the offer's key */
export async function approve(code: string, confirmedFingerprint: string): Promise<{ deviceId: string }> {
  const ks = await import("@/lib/identity/keystore");
  const dk = await import("@/lib/identity/deviceKeys");
  const roster = await import("@/lib/identity/rootRoster");
  const { pseudoFid } = await import("@/lib/device/boot");
  const o = await getOffer(code.trim().toUpperCase());
  if (!o) throw new Error("no such link code (it may have expired)");
  if (o.sealed) throw new Error("that code was already used");
  if (!/^[0-9a-f]{64}$/.test(o.devicePubKey) || !/^[0-9a-f]{64}$/.test(o.hpkePub)) throw new Error("malformed offer");
  const fp = fingerprintOf(o.code, o.hpkePub, o.devicePubKey);
  if ((confirmedFingerprint ?? "").trim().toUpperCase() !== fp) throw new Error("the fingerprint does not match what the other device shows — do not approve this link");
  const baseDelegation = {
    v: 1 as const,
    deviceId: o.deviceId,
    devicePubKey: o.devicePubKey,
    scopes: ["state-write", "vault-read"],
    issuedAt: Date.now(),
    expiresAt: null,
  };
  const delegation = { ...baseDelegation, signature: ks.signAsDeviceAuth(dk.delegationCanonical(baseDelegation)) };
  const anchorPubHex = ks.deviceAuthPublicKey();
  const rootId = (await roster.rootForFid(pseudoFid(anchorPubHex))) ?? "";
  const material = ks.linkMaterial();
  const payload: LinkPayloadV2 = { v: 2, rootId, anchorPubHex, delegation, ...material };
  const pk = await suite.kem.deserializePublicKey(buf(unhex(o.hpkePub)));
  const sender = await suite.createSenderContext({ recipientPublicKey: pk, info: info(o.code, o.deviceId) });
  const ct = await sender.seal(buf(te.encode(JSON.stringify(payload))));
  const body = JSON.stringify({ enc: hex(sender.enc), ct: hex(ct), rootId });
  const r = await orig()(`${base()}/link/${encodeURIComponent(o.code)}/sealed`, {
    method: "PUT",
    headers: { "content-type": "application/json", ...(await signedWriteHeaders("custody", body)) },
    body,
  });
  if (!r.ok) throw new Error("link: the relay refused the sealed material (" + r.status + ")");
  return { deviceId: o.deviceId };
}

/** NEW device: wait for the sealed material, open it, install the linked root, re-boot as that root */
export async function accept(opts: { timeoutMs?: number } = {}): Promise<import("@/lib/device/boot").DeviceInfo> {
  if (!pending) throw new Error("link: no offer is pending on this device");
  const { code, kp, deviceId } = pending;
  const deadline = Date.now() + (opts.timeoutMs ?? 10 * 60_000);
  let o: Offer | null = null;
  while (Date.now() < deadline) {
    o = await getOffer(code);
    if (!o) throw new Error("the offer expired before it was approved");
    if (o.sealed) break;
    await new Promise((r) => setTimeout(r, 750));
  }
  if (!o?.sealed) throw new Error("timed out waiting for the other device");
  const recipient = await suite.createRecipientContext({ recipientKey: kp, enc: buf(unhex(o.sealed.enc)), info: info(code, deviceId) });
  const pt = td.decode(await recipient.open(buf(unhex(o.sealed.ct))));
  const payload = JSON.parse(pt) as LinkPayloadV2;
  lastPayloadJson = pt;
  const dk = await import("@/lib/identity/deviceKeys");
  const me = dk.deviceIdentity();
  const del = payload.delegation as { v: 1; devicePubKey?: string; deviceId?: string; scopes?: string[]; issuedAt?: number; expiresAt?: number | null; signature?: string };
  if (payload.v !== 2 || del?.devicePubKey !== me.pubHex || del?.deviceId !== me.deviceId) throw new Error("link: the material is not for this device");
  // attack-custody-2 #17: the delegation must verify against the anchor the material names BEFORE anything is
  // installed — the validator would refuse it later, but a keystore is not written on a promise
  if (!/^[0-9a-f]{64}$/.test(payload.anchorPubHex) || typeof del.signature !== "string") throw new Error("link: malformed anchor or delegation");
  const { signature: _sig, ...delBase } = del;
  if (!verifyCanonical(del.signature, dk.delegationCanonical(delBase as Parameters<typeof dk.delegationCanonical>[0]), payload.anchorPubHex))
    throw new Error("link: the delegation does not verify against the anchor it names");
  const ks = await import("@/lib/identity/keystore");
  ks.installLinkedRoot(
    { anchorPubHex: payload.anchorPubHex, rootId: payload.rootId, vaultKeyHex: payload.vaultKeyHex, zkMasterHex: payload.zkMasterHex, delegation: payload.delegation, personaKeys: payload.personaKeys },
    payload.personas
  );
  pending = null;
  const boot = await import("@/lib/device/boot");
  const infoOut = await boot.reloadIdentity();
  // the offer served its purpose: forget it on the relay (signed now — this device is enrolled under the root)
  await orig()(`${base()}/link/${encodeURIComponent(code)}`, { method: "DELETE", headers: await signedReadHeaders("custody:revoke") }).catch(() => {});
  return infoOut;
}

/** for the payload grep in scripts/accept-cu3.mjs only: what the last accepted link carried, as text */
export function lastPayload(): string | null {
  return lastPayloadJson;
}

export function pendingCode(): string | null {
  return pending?.code ?? null;
}
