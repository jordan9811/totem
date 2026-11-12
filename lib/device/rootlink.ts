// BROWSER KEYSTORE PASS Gate 3 / Gate 5 — root linking: link, not merge (docs/custody-model.md D-CU-0-14;
// notes/reports/REPORT-CUSTODY.md D-CU-3-A-ROOT-LINK-IS-A-CO-SIGNED-GRANT, D-CU-3-UNIFIED-MEANS-PRESENTED-TOGETHER-NOT-MERGED,
// and the Gate 5 rework after research/attack-custody-3.md findings 1, 2, 4, 7).
//
// The exchange, v2. A proposes: its anchor, its root id, an ephemeral X25519 key, a fingerprint seed. B answers:
// its anchor, its root id, its own ephemeral key, ITS ROSTER SEALED TO A'S KEY (HPKE), and a signature over the
// partial canonical that commits to that roster's hash. A completes: A'S ROSTER SEALED TO B'S KEY and a signature
// over the full canonical, which commits to both hashes. The relay holds anchors, root ids, ephemeral public keys,
// ciphertext and signatures — never a persona roster; only a party that holds one of the two ephemeral private
// keys can open the other side's roster. Every relay read is signed by an enrolled device. Both people confirm one
// fingerprint, derived from both ephemeral keys and the code, before the link completes.
import { Aes256Gcm, CipherSuite, DhkemX25519HkdfSha256, HkdfSha256 } from "@hpke/core";
import { validatorUrl } from "@/lib/ports";
import { fetchState, flushVault, signedReadHeaders, signedWriteHeaders } from "@/lib/adapters/mock/persist";
import { decryptNamespace, encryptNamespace } from "@/lib/vault/vault";
import { verifyCanonical } from "@/lib/crypto/ed25519";
import { createHash } from "@/lib/platform/crypto";

const NS = "rootLinks";
const suite = new CipherSuite({ kem: new DhkemX25519HkdfSha256(), kdf: new HkdfSha256(), aead: new Aes256Gcm() });
const te = new TextEncoder();
const td = new TextDecoder();
const hex = (b: ArrayBuffer | Uint8Array) => [...(b instanceof Uint8Array ? b : new Uint8Array(b))].map((x) => x.toString(16).padStart(2, "0")).join("");
const unhex = (h: string) => new Uint8Array((h.match(/.{2}/g) ?? []).map((x) => parseInt(x, 16)));
const buf = (u: Uint8Array): ArrayBuffer => u.slice().buffer as ArrayBuffer;
const orig = (): typeof fetch => ((globalThis as unknown as { __layersOrigFetch?: typeof fetch }).__layersOrigFetch ?? fetch);
const base = () => validatorUrl();
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

export interface PublicPersona {
  id: string;
  handle: string;
  name: string;
  avatarUrl: string | null;
}
export interface RootLinkGrant {
  v: 2;
  a: string;
  b: string;
  rootA: string;
  rootB: string;
  issuedAt: number;
  personasA: PublicPersona[];
  personasB: PublicPersona[];
  /** sha256 of the canonical JSON of each roster — what the signatures commit to */
  hA: string;
  hB: string;
  /** A signs the full canonical; B signs the partial (it does not yet know A's roster hash) */
  sigA: string;
  sigB: string;
}
export interface LinkedRootView {
  grantId: string;
  anchor: string;
  rootId: string;
  personas: PublicPersona[];
  issuedAt: number;
}

export const rosterHash = (p: PublicPersona[]): string => sha(JSON.stringify(p.map((x) => ({ id: x.id, handle: x.handle, name: x.name, avatarUrl: x.avatarUrl }))));
/** what B signs: everything but A's roster hash */
export function partialCanonical(g: Pick<RootLinkGrant, "a" | "b" | "rootA" | "rootB" | "issuedAt" | "hB">): string {
  return `layers/rootlink/v2|${g.a}|${g.b}|${g.rootA}|${g.rootB}|${g.issuedAt}|hB=${g.hB}`;
}
/** what A signs: the partial plus A's roster hash */
export function fullCanonical(g: Pick<RootLinkGrant, "a" | "b" | "rootA" | "rootB" | "issuedAt" | "hA" | "hB">): string {
  return partialCanonical(g) + `|hA=${g.hA}`;
}
export function grantId(g: Pick<RootLinkGrant, "a" | "b" | "rootA" | "rootB" | "issuedAt" | "hA" | "hB">): string {
  return sha(fullCanonical(g)).slice(0, 32);
}
/** the short string both people compare (D-CU-5-A-LINK-IS-CONFIRMED-ACROSS-DEVICES) */
export function fingerprintOf(code: string, ekA: string, ekB: string): string {
  const h = sha("layers/rootlink/fp/v1|" + code + "|" + ekA + "|" + ekB);
  return (h.slice(0, 4) + "-" + h.slice(4, 8)).toUpperCase();
}
const info = (code: string, who: "A" | "B") => buf(te.encode("layers/rootlink/roster/v2|" + code + "|" + who));

async function me(): Promise<{ anchor: string; rootId: string; personas: PublicPersona[] }> {
  const ks = await import("@/lib/identity/keystore");
  const { currentInfo } = await import("@/lib/device/boot");
  const info = currentInfo();
  return {
    anchor: ks.deviceAuthPublicKey(),
    rootId: info.rootId,
    personas: ks.listPersonas().map((p) => ({ id: p.id, handle: p.handle, name: p.name, avatarUrl: p.avatarUrl })),
  };
}

// ---- the vault namespace
/** throws when the vault cannot be read: an empty default here would let the next write erase every grant
 *  (attack-custody-2 #19, the never-fail-open rule) */
async function readGrants(): Promise<Record<string, RootLinkGrant>> {
  const ks = await import("@/lib/identity/keystore");
  const res = await fetchState(NS);
  if (res.status === 404) return {};
  if (!res.ok) throw new Error("rootlink: the vault namespace did not read (" + res.status + ")");
  const stored = ((await res.json())?.entries ?? {}) as Record<string, unknown>;
  if (!Object.keys(stored).length) return {};
  const plain = decryptNamespace(NS, stored, ks.vaultKeyBytes()) as Record<string, { m?: Record<string, RootLinkGrant> }>;
  return plain["_"]?.m ?? {};
}
async function writeGrants(m: Record<string, RootLinkGrant>): Promise<void> {
  const ks = await import("@/lib/identity/keystore");
  const inner = JSON.stringify(m);
  const target = 1024 * Math.ceil((inner.length + 64) / 1024);
  await flushVault(NS, encryptNamespace(NS, { _: { m, pad: " ".repeat(Math.max(0, target - inner.length - 48)) } }, ks.vaultKeyBytes()));
}

// ---- the relay (every read signed by an enrolled device)
interface RelayRow {
  code: string;
  proposal: { a: string; rootA: string; issuedAt: number; ekA: string };
  answer: { b: string; rootB: string; ekB: string; rosterB: { enc: string; ct: string }; hB: string; sigB: string } | null;
  completion: { rosterA: { enc: string; ct: string }; hA: string; sigA: string } | null;
}
async function relayGet(code: string): Promise<RelayRow | null> {
  const r = await orig()(`${base()}/rootlink/${encodeURIComponent(code)}`, { cache: "no-store", headers: await signedReadHeaders("custody") });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error("rootlink: relay " + r.status);
  return (await r.json()) as RelayRow;
}
async function relaySigned(path: string, method: "POST" | "PUT" | "DELETE", body?: unknown, ns: "custody" | "custody:revoke" = "custody"): Promise<Record<string, unknown>> {
  const text = body === undefined ? "" : JSON.stringify(body);
  const headers = body === undefined ? await signedReadHeaders(ns) : { "content-type": "application/json", ...(await signedWriteHeaders(ns, text)) };
  const r = await orig()(`${base()}${path}`, { method, headers, body: body === undefined ? undefined : text });
  const json = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok) throw new Error("rootlink: " + method + " " + path + " → " + r.status + " " + String(json.error ?? ""));
  return json;
}
async function seal(to: string, code: string, who: "A" | "B", personas: PublicPersona[]): Promise<{ enc: string; ct: string }> {
  const pk = await suite.kem.deserializePublicKey(buf(unhex(to)));
  const sender = await suite.createSenderContext({ recipientPublicKey: pk, info: info(code, who) });
  const ct = await sender.seal(buf(te.encode(JSON.stringify(personas))));
  return { enc: hex(sender.enc), ct: hex(ct) };
}
async function open(kp: CryptoKeyPair, code: string, who: "A" | "B", sealed: { enc: string; ct: string }): Promise<PublicPersona[]> {
  const ctx = await suite.createRecipientContext({ recipientKey: kp, enc: buf(unhex(sealed.enc)), info: info(code, who) });
  const personas = JSON.parse(td.decode(await ctx.open(buf(unhex(sealed.ct))))) as PublicPersona[];
  if (!Array.isArray(personas)) throw new Error("rootlink: the sealed roster is not a list");
  return personas;
}

let pendingA: { code: string; kp: CryptoKeyPair; ekA: string } | null = null;
let pendingB: { code: string; kp: CryptoKeyPair; ekB: string; fingerprint: string } | null = null;

/** A: propose a link; show the code to the person holding the other root */
export async function propose(): Promise<{ code: string }> {
  const m = await me();
  const kp = await suite.kem.generateKeyPair();
  const ekA = hex(await suite.kem.serializePublicKey(kp.publicKey));
  const proposal = { a: m.anchor, rootA: m.rootId, issuedAt: Date.now(), ekA };
  const j = await relaySigned("/rootlink/offer", "POST", { proposal });
  pendingA = { code: String(j.code), kp, ekA };
  return { code: String(j.code) };
}

/** A: once B has answered, the fingerprint both people must see (read it before confirming completion) */
export async function proposalFingerprint(): Promise<string | null> {
  if (!pendingA) return null;
  const row = await relayGet(pendingA.code);
  if (!row?.answer) return null;
  return fingerprintOf(row.code, row.proposal.ekA, row.answer.ekB);
}

/** B: answer a proposal with the other root — the roster sealed to A's key — and learn the fingerprint to show */
export async function answer(code: string): Promise<{ fingerprint: string }> {
  const ks = await import("@/lib/identity/keystore");
  const m = await me();
  const row = await relayGet(code.trim().toUpperCase());
  if (!row) throw new Error("no such link code (it may have expired)");
  if (row.answer) throw new Error("that code was already answered");
  if (row.proposal.a === m.anchor) throw new Error("that is this root's own proposal");
  const kp = await suite.kem.generateKeyPair();
  const ekB = hex(await suite.kem.serializePublicKey(kp.publicKey));
  const hB = rosterHash(m.personas);
  const partial = { a: row.proposal.a, b: m.anchor, rootA: row.proposal.rootA, rootB: m.rootId, issuedAt: row.proposal.issuedAt, hB };
  const sigB = ks.signAsDeviceAuth(partialCanonical(partial));
  const rosterB = await seal(row.proposal.ekA, row.code, "B", m.personas);
  await relaySigned(`/rootlink/${encodeURIComponent(row.code)}/answer`, "PUT", { answer: { b: m.anchor, rootB: m.rootId, ekB, rosterB, hB, sigB } });
  const fingerprint = fingerprintOf(row.code, row.proposal.ekA, ekB);
  pendingB = { code: row.code, kp, ekB, fingerprint };
  return { fingerprint };
}

/** A: verify B, confirm the fingerprint the person read on the other device, seal A's roster to B, sign, store */
export async function complete(code: string, confirmedFingerprint: string, opts: { timeoutMs?: number } = {}): Promise<LinkedRootView> {
  const ks = await import("@/lib/identity/keystore");
  const m = await me();
  const c = code.trim().toUpperCase();
  if (!pendingA || pendingA.code !== c) throw new Error("that proposal is not pending on this device");
  const deadline = Date.now() + (opts.timeoutMs ?? 10 * 60_000);
  let row: RelayRow | null = null;
  while (Date.now() < deadline) {
    row = await relayGet(c);
    if (!row) throw new Error("no such link code (it may have expired)");
    if (row.answer) break;
    await new Promise((r) => setTimeout(r, 750));
  }
  if (!row?.answer) throw new Error("timed out waiting for the other root to answer");
  if (row.proposal.a !== m.anchor) throw new Error("that proposal is not this root's");
  const fp = fingerprintOf(row.code, row.proposal.ekA, row.answer.ekB);
  if (confirmedFingerprint.trim().toUpperCase() !== fp) throw new Error("the fingerprint does not match what the other device shows — do not complete this link");
  const personasB = await open(pendingA.kp, row.code, "B", row.answer.rosterB);
  if (rosterHash(personasB) !== row.answer.hB) throw new Error("the other root's roster does not match what it signed");
  const partial = { a: m.anchor, b: row.answer.b, rootA: m.rootId, rootB: row.answer.rootB, issuedAt: row.proposal.issuedAt, hB: row.answer.hB };
  if (!verifyCanonical(row.answer.sigB, partialCanonical(partial), row.answer.b)) throw new Error("the other root's signature does not verify");
  const hA = rosterHash(m.personas);
  const full = { ...partial, hA };
  const sigA = ks.signAsDeviceAuth(fullCanonical(full));
  const rosterA = await seal(row.answer.ekB, row.code, "A", m.personas);
  await relaySigned(`/rootlink/${encodeURIComponent(row.code)}/complete`, "PUT", { completion: { rosterA, hA, sigA } });
  const grant: RootLinkGrant = { v: 2, ...full, personasA: m.personas, personasB, sigA, sigB: row.answer.sigB };
  const grants = await readGrants();
  grants[grantId(grant)] = grant;
  await writeGrants(grants);
  pendingA = null;
  return { grantId: grantId(grant), anchor: grant.b, rootId: grant.rootB, personas: personasB, issuedAt: grant.issuedAt };
}

/** B: wait for A to complete, verify A, store the grant, forget the relay row */
export async function finish(opts: { timeoutMs?: number } = {}): Promise<LinkedRootView> {
  if (!pendingB) throw new Error("no answered proposal is pending on this device");
  const { code, kp, ekB } = pendingB;
  const m = await me();
  const deadline = Date.now() + (opts.timeoutMs ?? 10 * 60_000);
  let row: RelayRow | null = null;
  while (Date.now() < deadline) {
    row = await relayGet(code);
    if (!row) throw new Error("the proposal expired before it was completed");
    if (row.completion) break;
    await new Promise((r) => setTimeout(r, 750));
  }
  if (!row?.completion || !row.answer) throw new Error("timed out waiting for the other root to complete");
  if (row.answer.ekB !== ekB) throw new Error("the relay row no longer carries this device's key");
  const personasA = await open(kp, code, "A", row.completion.rosterA);
  if (rosterHash(personasA) !== row.completion.hA) throw new Error("the other root's roster does not match what it signed");
  const full = { a: row.proposal.a, b: m.anchor, rootA: row.proposal.rootA, rootB: m.rootId, issuedAt: row.proposal.issuedAt, hA: row.completion.hA, hB: row.answer.hB };
  if (!verifyCanonical(row.completion.sigA, fullCanonical(full), row.proposal.a)) throw new Error("the other root's signature does not verify");
  const grant: RootLinkGrant = { v: 2, ...full, personasA, personasB: m.personas, sigA: row.completion.sigA, sigB: row.answer.sigB };
  const grants = await readGrants();
  grants[grantId(grant)] = grant;
  await writeGrants(grants);
  await relaySigned(`/rootlink/${encodeURIComponent(code)}`, "DELETE", undefined, "custody:revoke").catch(() => {});
  pendingB = null;
  return { grantId: grantId(grant), anchor: grant.a, rootId: grant.rootA, personas: personasA, issuedAt: grant.issuedAt };
}

export function pendingFingerprint(): string | null {
  return pendingB?.fingerprint ?? null;
}

/** the roots linked to this one — revocations on the relay honoured on every read. The probe is a signed,
 *  party-scoped read; a link whose probe FAILED is not presented and not deleted (attack-custody-1, noted: an
 *  unreachable check used to read as "not revoked") */
export async function linked(): Promise<LinkedRootView[]> {
  const m = await me();
  const grants = await readGrants();
  const out: LinkedRootView[] = [];
  let changed = false;
  for (const [id, g] of Object.entries(grants)) {
    let revoked: boolean | null = null;
    try {
      const r = await orig()(`${base()}/rootlink/revoked/${encodeURIComponent(id)}`, { cache: "no-store", headers: await signedReadHeaders("custody") });
      if (r.ok) revoked = ((await r.json()) as { revoked?: boolean }).revoked === true;
    } catch {
      revoked = null;
    }
    if (revoked === null) continue; // unknown: neither shown nor dropped
    if (revoked) {
      delete grants[id];
      changed = true;
      continue;
    }
    const other = g.a === m.anchor ? { anchor: g.b, rootId: g.rootB, personas: g.personasB } : { anchor: g.a, rootId: g.rootA, personas: g.personasA };
    out.push({ grantId: id, ...other, issuedAt: g.issuedAt });
  }
  if (changed) await writeGrants(grants);
  return out;
}

/** symmetric: revoke on the relay (signed by this root) and drop this vault's copy */
export async function unlink(id: string): Promise<void> {
  await relaySigned("/rootlink/revoke", "POST", { grantId: id }, "custody:revoke");
  const grants = await readGrants();
  if (grants[id]) {
    delete grants[id];
    await writeGrants(grants);
  }
}
