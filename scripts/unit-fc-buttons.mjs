// BUILD A — node-only unit harness for "the app's buttons really post to Farcaster".
//
// Bundles the REAL action routes (app/api/actions/{cast,react,follow,delivery,act-as}/route.ts), the REAL helper
// (app/api/actions/farcasterDelivery.ts) and the REAL write door + ledger (lib/fc/writes.ts, lib/fc/writeLedger.ts,
// lib/adapters/neynar/mode.ts, lib/fc/networkMode.ts) with esbuild, and replaces everything stateful around them
// (the store, the vault records, the keystore, the session, the network-target helper, Neynar's content adapter)
// with in-memory mocks. fetch is a recorder that answers like Neynar — NOTHING leaves this machine, and the keys and
// signer uuids are fake strings.
//
//   node scripts/unit-fc-buttons.mjs            the checks (exit 0 = all pass)
//   MUT=<name> node scripts/unit-fc-buttons.mjs  a VACUITY run: one guard broken on purpose in a temp copy (the repo
//                                               is never touched); exit 0 = the named checks went red as they must
//                                               (names: guard, sibling, noaccount, target, doorpub, rigio, and the review's
//                                               binding, cardpersona, definitive, bytes, window, mainunknown, doorunknown,
//                                               names, pub7, ownextra, pending, actas, revoke)
// Everything it writes (mocks, the entry, the bundle) goes to a temp directory that is removed at the end.
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HERE = mkdtempSync(path.join(os.tmpdir(), "layers-fc-buttons-unit-"));
process.on("exit", () => rmSync(HERE, { recursive: true, force: true }));
const require = createRequire(path.join(ROOT, "package.json"));
const { build } = require("esbuild");

let passed = 0;
let failed = 0;
const failures = [];
async function check(name, fn) {
  try {
    const extra = await fn();
    passed++;
    console.log(`  PASS  ${name}${typeof extra === "string" ? " — " + extra : ""}`);
  } catch (e) {
    failed++;
    failures.push(name);
    console.log(`  FAIL  ${name} — ${e && e.stack ? e.stack.split("\n").slice(0, 3).join(" | ") : String(e)}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

// ------------------------------------------------------------------------------------------------ the test world
const THROWAWAY = 3348985;
const MAIN_FID = 777; // NEYNAR_VIEWER_FID — the owner's main as configured, and the connected main below
const T = {
  acting: "p_pub",
  seedViewer: { fid: 9152, rootId: "r", personas: ["persona_viewer_main"], activePersonaId: "persona_viewer_main", followingPersonaIds: [], likedPostHashes: [], bookmarkedPostHashes: [] },
  personaById: new Map(),
  postByHash: new Map(),
  minted: new Map(),
  kinds: new Map(),
  records: [],
  state: { fcWrites: new Map(), fcAttribution: new Map(), privatePosts: new Map() },
  persisted: [],
  hydrates: 0,
  vaultReads: 0,
  vaultThrows: false,
  localCasts: [],
  reactions: [],
  edges: [],
  casts: new Map(),
  liveMode: false,
  anonHashes: new Set(),
  anonThrows: false,
  liveAuthors: new Map(),
  liveLookups: 0,
  liveCastThrows: false,
  networkRefusal: null,
  unsignable: new Set(),
  privateVisible: new Map(),
  // BUILD A review knobs
  anonUnknown: false, // the live ZK universe is on and the anon relay config is unread (anonAccountFid throws)
  anonSnapshotFid: null, // the anon fid the ZK prefetch snapshot names (FC_ANON_FID unset on the app)
  disconnects: [],
  usernames: new Map(), // the fake Neynar's by_username answers (name → fid)
  signerStatus: new Map(), // the fake Neynar's GET /signer answers (uuid → status; default approved)
};
globalThis.__T = T;

function addPersona(id, handle, kind = "public") {
  const p = { id, handle, name: handle.toUpperCase(), avatarUrl: `https://i.pravatar.cc/80?u=${id}`, bio: "", tier: 3 };
  T.personaById.set(id, p);
  T.minted.set(id, { id, nonce: "n-" + id, kind, name: p.name, handle, avatarUrl: p.avatarUrl, bio: null, cluster: null, createdAt: Date.now() - 1000, forkedFrom: null });
  T.kinds.set(id, kind);
}
const custodyOf = (id) => "0x" + createHash("sha256").update("custody|" + id).digest("hex").slice(0, 40);
function record(id, fid, fname, { mode = "live", origin = mode === "live" ? "layers-fid-pass" : "fixture", uuid = "uuid-" + id, connected } = {}) {
  const r = {
    personaId: id,
    fid,
    fname,
    origin,
    custodyAddress: custodyOf(id),
    signer: { kind: "neynar-managed", uuid, derivedPubHex: "pub-" + id, derivedRegistered: false },
    registrant: "neynar-sponsor",
    funder: "neynar-sponsor",
    createdAt: Date.now(),
    mode,
    ...(connected ? { connected } : {}),
  };
  T.records.push(r);
  return r;
}
addPersona("p_pub", "pub-one");
addPersona("p_sib", "sib-two");
addPersona("p_none", "no-account");
addPersona("p_fix", "fixture-one");
addPersona("p_priv", "private-one", "private");
const REC_PUB = record("p_pub", 900001, "pub-one");
const REC_SIB = record("p_sib", 900002, "sib-two");
const REC_FIX = record("p_fix", 9000001, "fixture-one", { mode: "fixture", uuid: "fixture-uuid" });

// ------------------------------------------------------------------------------------------------ the mocks
const MOCKDIR = path.join(HERE, "fcbuttons-mocks");
rmSync(MOCKDIR, { recursive: true, force: true });
mkdirSync(MOCKDIR, { recursive: true });
const MOCKS = {
  "server-only": `export {};`,
  "next/server": `
export class NextResponse {
  constructor(body, init = {}) { this.body = body; this.status = init.status ?? 200; this.cookies = { set() {}, delete() {} }; }
  static json(obj, init = {}) { const r = new NextResponse(JSON.stringify(obj), init); r.jsonBody = obj; return r; }
  async json() { return this.jsonBody; }
}
export class NextRequest {
  constructor(url, init = {}) { this.url = url; this.nextUrl = new URL(url); this._body = init.body; this.headers = new Headers(init.headers ?? {}); this.cookies = { get: () => undefined }; }
  async json() { if (this._body === undefined) throw new Error("no body"); return JSON.parse(this._body); }
}`,
  "lib/adapters/mock/store": `
const T = globalThis.__T;
export const SEED_VIEWER = T.seedViewer;
export const personaById = T.personaById;
export const postByHash = T.postByHash;
export const rootByFid = new Map();
export function state() { return T.state; }
export async function persistNs(ns) { T.persisted.push(ns); }
export async function hydrate() { T.hydrates++; }`,
  "lib/data": `
const T = globalThis.__T;
export function addLocalCast(c) { T.localCasts.unshift(c); }
export function findLocalCast(hash) { const c = T.localCasts.find((x) => x.hash === hash); return c ? { text: c.text, personaId: c.personaId } : null; }
export function getSelf() { return { fid: 9152, username: "self", displayName: "Self", pfpUrl: "https://i.pravatar.cc/80?img=1", followerCount: 0, followingCount: 0 }; }
export function liveMode() { return T.liveMode; }
export function setReaction(hash, kind, on) { T.reactions.push({ hash, kind, on }); }
export async function getCast(hash) { return T.casts.get(hash) ?? null; }`,
  "lib/session": `
export async function getSession() {
  const T = globalThis.__T; const p = T.personaById.get(T.acting);
  return { rootId: null, personas: [], active: p ? { id: p.id, name: p.name, handle: p.handle, avatarUrl: p.avatarUrl } : null };
}`,
  "lib/activePersona": `export function activeSeedPersonaId() { return globalThis.__T.acting; }`,
  "lib/identity/personaKind": `
export function kindOf(id) { const T = globalThis.__T; if (!id) return "unknown"; return T.kinds.get(id) ?? (T.personaById.has(id) ? "public" : "unknown"); }
export function isPrivatePersona(id) { return kindOf(id) === "private"; }
export function mayPublishPublicly(id) { return kindOf(id) === "public"; }`,
  "lib/identity/keystore": `
export function getPersona(id) { const p = globalThis.__T.minted.get(id); return p ? { ...p } : null; }
export function isOwnPersona(id) { return globalThis.__T.minted.has(id); }
export function ownPersonaIds() { return [...globalThis.__T.minted.keys()]; }`,
  "lib/identity/keys": `
import { createHash } from "node:crypto";
const T = globalThis.__T;
const known = (id) => T.minted.has(id) || T.personaById.has(id);
export function fcSignerPublicKeyFor(id) { return known(id) ? "pub-" + id : null; }
export function fcCustodyAddressFor(id) { return known(id) ? "0x" + createHash("sha256").update("custody|" + id).digest("hex").slice(0, 40) : null; }
export function isViewerPersona(id) { return T.minted.has(id) || T.seedViewer.personas.includes(id); }
export function isKeystoreRootedPersona(id) { return T.minted.has(id); }
export function signForPersona(id) { return T.unsignable.has(id) ? null : "sig:" + id; }
export function publicKeyForPersona(id) { return "pk-" + id; }`,
  "lib/fc/personaFid": `
const T = globalThis.__T;
function rows() { if (T.vaultThrows) throw new Error("persona↔fid records unavailable (validator answered 503) — refusing rather than treating the vault as empty"); T.vaultReads++; return T.records; }
const copy = (r) => JSON.parse(JSON.stringify(r));
export const GATE1_THROWAWAY_FID = 3348985;
export async function personaFidRecord(id) { const r = rows().find((x) => x.personaId === id); return r ? copy(r) : null; }
export async function personaOfFid(fid) { return rows().find((x) => x.fid === fid)?.personaId ?? null; }
export async function allPersonaFids() { return rows().map(copy); }
export async function connectedRecords() { return rows().filter((r) => r.origin === "connected").map(copy); }
// the REAL rules (lib/fc/personaFid.ts), mirrored over this harness's records — connect-unit.mjs pins the real file's
const envFid = (n) => { const raw = (process.env[n] ?? "").trim(); return /^[1-9][0-9]{0,11}$/.test(raw) ? Number(raw) : null; };
const envFidList = (n) => (process.env[n] ?? "").split(",").map((s) => s.trim()).filter((s) => /^[1-9][0-9]{0,11}$/.test(s)).map(Number);
export function ownAccountFids(records, anonFid = null) { const out = new Set(envFidList("FC_RESERVED_FIDS")); const tw = envFid("FC_TEST_FID"); if (tw) out.add(tw); const anon = envFid("FC_ANON_FID"); if (anon) out.add(anon); if (anonFid) out.add(anonFid); for (const r of records) if (r.origin !== "connected") out.add(r.fid); return out; }
export async function anonAccountFid() { const env = envFid("FC_ANON_FID"); if (env) return env; if (T.anonUnknown) throw new Error("Totem hasn't read your anonymous account's settings from the validator yet"); return T.anonSnapshotFid ?? null; }
export async function ownAccountFidsWithAnon(records) { return ownAccountFids(records, await anonAccountFid()); }
export async function disconnectConnectedFid(personaId, reason = "owner") {
  const r = rows().find((x) => x.origin === "connected" && x.personaId === personaId);
  if (!r || !r.connected) return null;
  if (r.connected.disconnectedAt && reason === "revoked_in_app") return copy(r);
  r.signer.uuid = ""; r.connected.disconnectedAt = Date.now(); r.connected.disconnectReason = reason;
  T.disconnects.push({ personaId, reason });
  return copy(r);
}
export async function mainNameDerivation() { return null; }`,
  "lib/adapters/devControls": `export function consumeFcPublishDrop() { return false; }`,
  "lib/fc/networkTarget": `
export const NETWORK_HASH_RE = /^0x[0-9a-f]{40}$/;
export const NETWORK_READ_ONLY = { code: "NETWORK_READ_ONLY", error: "Posting to Farcaster isn't on this preview yet." };
export function isNetworkHashShape(h) { return typeof h === "string" && NETWORK_HASH_RE.test(h); }
export async function isNetworkCastTarget(h) {
  const T = globalThis.__T;
  if (T.anonThrows) throw new Error("the anon cast list could not be read");
  if (!isNetworkHashShape(h)) return false;
  if (T.anonHashes.has(h)) return false;
  if (T.localCasts.some((c) => c.hash === h)) return false;
  return true;
}
export function networkWritesRefused() { return !!globalThis.__T.networkRefusal; }
export async function networkWriteRefusal() { return globalThis.__T.networkRefusal ? NETWORK_READ_ONLY : null; }
export async function networkFollowRefusal() { return globalThis.__T.networkRefusal ? NETWORK_READ_ONLY : null; }`,
  "lib/fc/attribution": `export function attributionCanonical(h, p, at) { return ["layers-fc-attribution/1", h, p, String(at)].join("|"); }`,
  "lib/eventlog/log": `
export function eventIdempotencyKey() { return undefined; }
export function followingFor() { return new Set(); }
export async function logEdgeEvent(e) { globalThis.__T.edges.push(e); }
export async function resolveFirstInteraction() {}`,
  "lib/influence/stakes": `export async function placeStake() { return { ok: true, amount: 0 }; }`,
  "lib/influence/types": `export function isStakeDirection() { return false; }`,
  "lib/adapters/neynar/content": `
export class NeynarError extends Error { constructor(m, status) { super(m); this.status = status; this.name = "NeynarError"; } }
export async function liveCast(hash) {
  const T = globalThis.__T; T.liveLookups++;
  if (T.liveCastThrows) throw new NeynarError("neynar 500", 500);
  const fid = T.liveAuthors.get(hash);
  if (fid === undefined) throw new NeynarError("neynar 404", 404);
  return { value: { hash, author: { fid } }, stale: false };
}`,
  "lib/private/store": `export async function createPrivatePost(p) { return { hash: "0xpriv" + Date.now().toString(16), ...p }; }`,
  "lib/private/visibility": `export function visiblePrivatePost(h) { return globalThis.__T.privateVisible.get(h) ?? null; }`,
  "lib/crosspost/destinations": `export function boundDestinationsFor() { return []; }`,
  "lib/refutation/edges": `export async function declareEdge() {}`,
};
const mockFile = {};
for (const [k, src] of Object.entries(MOCKS)) {
  const f = path.join(MOCKDIR, k.replace(/[\\/]/g, "__") + ".mjs");
  writeFileSync(f, src.trim() + "\n");
  mockFile[k] = f;
}
const ROOT_N = path.resolve(ROOT);

// MUTATION RUNS (vacuity check): MUT=<name> bundles a deliberately BROKEN copy of one module — the real file is never
// touched — and the named checks must then FAIL. Relative imports in the copy are rewritten to their @/ form.
const MUTATIONS = {
  // the structural never-the-throwaway guard removed from the door
  guard: { file: "lib/fc/writes.ts", edits: [["assertWriteGuard(t, creds, guard);", ""], ["assertWriteGuard(t, creds, opts);", ""], ["if (opts.requireFid !== undefined && scopeFid !== opts.requireFid) {", "if (false) {"]], expect: ["U6"] },
  // the one-tap sibling / main / throwaway refusals removed
  // (BUILD A review: the guard's shape changed — main is the connected record OR NEYNAR_VIEWER_FID, and main pairs never
  // take Act as…'s waiver; the anchors follow it)
  sibling: { file: "app/api/actions/farcasterDelivery.ts", edits: [["if (!opts.siblingsAllowed || mainInvolved) {", "if (false && mainInvolved) {"], ["if (authorIsMain && !actorIsMain) {", "if (false) {"]], expect: ["U9", "U12"] },
  // a persona without an account sent to the door anyway (the door would fall back to the shared account)
  noaccount: { file: "app/api/actions/farcasterDelivery.ts", edits: [['if (!rec) return layers("no_account", { pointer: pointerFor(id, handle) });', 'if (!rec) return { to: "farcaster", personaId: id, handle: handle ?? id, fid: 900009, fname: null, mode: armed ? "live" : "fixture", message: "x" };']], expect: ["U4"] },
  // the reply route ignoring the target verdict
  target: { file: "app/api/actions/cast/route.ts", edits: [['if (t.verdict === "refuse") return NextResponse.json({ error: t.message, code: t.code }, { status: t.status });', ""]], expect: ["U9"] },
  // act-as no longer recognising a cast the Composer published (its local copy is found first)
  doorpub: { file: "app/api/actions/act-as/route.ts", edits: [["(target !== null && (target.live === true || doorPublished))", "(target !== null && target.live === true)"]], expect: ["U17"] },
  // the writes-off short cut removed (the rig would read the vault on every post)
  rigio: { file: "app/api/actions/farcasterDelivery.ts", edits: [['if (!armed && !knob) return layers("writes_off");', 'if (!armed && !knob) { await personaFidRecord(id ?? ""); return layers("writes_off"); }']], expect: ["U1"] },
  // ---- BUILD A / CONNECT MAIN review fixes ----
  // PUB-1: the cast route ignores the line the owner was shown
  binding: { file: "app/api/actions/cast/route.ts", edits: [["if (why) return deliveryChangedResponse(why, fresh);", ""]], expect: ["U27", "U28", "U29"] },
  // PUB-1: likes and follows no longer compare the card's persona with the acting one
  cardpersona: { file: "app/api/actions/farcasterDelivery.ts", edits: [['if (typeof sent !== "string" || !sent || sent === acting) return null;', "return null;"]], expect: ["U30"] },
  // PUB-2: a Neynar 4xx on publish is ambiguous again
  definitive: { file: "lib/fc/writes.ts", edits: [["res.status >= 400 && res.status < 500 ? { definitive: true, status: res.status } : { status: res.status }", "{ status: res.status }"]], expect: ["U31"] },
  // PUB-2: no byte limit before the door
  bytes: { file: "app/api/actions/cast/route.ts", edits: [["if (tooLong) return", "if (false) return"]], expect: ["U32"] },
  // UXC-04: a confirmed receipt blocks the same words forever again
  window: { file: "lib/fc/writeLedger.ts", edits: [['mine.find((e) => e.status === "sent" && now - e.at <= FC_RETRY_WINDOW_MS)', 'mine.find((e) => e.status === "sent")']], expect: ["U33"] },
  // PUB-3/PL-1: the buttons decide interactions on a guess about main again (both places)
  mainunknown: { file: "app/api/actions/farcasterDelivery.ts", edits: [["if ((await mainAccount()).fids.size === 0) return", "if (false) return"], ['if (d.mode === "live" && main.fids.size === 0) return', "if (false) return"]], expect: ["U36"] },
  // PUB-3/PL-1: the door's own fail-closed on an unknown main removed
  doorunknown: { file: "lib/fc/writes.ts", edits: [['if (mode === "live" && interacts) throw new FcMainUnknownError', "if (false) throw new FcMainUnknownError"]], expect: ["U36"] },
  // PL-3: @names judged only by the names this device holds again
  names: { file: "lib/fc/writes.ts", edits: [['if (cls === "stranger" && mode === "live") {', "if (false) {"]], expect: ["U37"] },
  // PUB-7: an attributed cast checked only by the persona it is attributed to
  pub7: { file: "app/api/actions/farcasterDelivery.ts", edits: [["let authorFid = hint ?? (known ? publishedFid(hash) ?? copy?.fid ?? null : null);", "let authorFid = hint;"]], expect: ["U38"] },
  // PUB-8/PL-2: the anonymous account and the reserved fids invisible to the one-tap guard again
  ownextra: { file: "app/api/actions/farcasterDelivery.ts", edits: [["const own = await ownAccountFidsWithAnon(records);", "const own = new Set<number>();"]], expect: ["U39"] },
  // PUB-6: a like still on its way no longer blocks its un-like
  pending: { file: "app/api/actions/react/route.ts", edits: [["if (pendingBefore(verb, d, String(hash))) {", "if (false) {"]], expect: ["U40"] },
  // UXC-08: main pairs told to "Use Act as…" again
  actas: { file: "app/api/actions/farcasterDelivery.ts", edits: [["message: mainInvolved", "message: false"]], expect: ["U42"] },
  // UXC-02: a refusal as main no longer asks Farcaster whether the owner removed Totem
  revoke: { file: "lib/fc/writes.ts", edits: [['if (status === "revoked" || status === "missing") await disconnectConnectedFid', "if (false) await disconnectConnectedFid"]], expect: ["U43"] },
};
const MUT = process.env.MUT || null;
const mutatedFile = {};
if (MUT) {
  const m = MUTATIONS[MUT];
  if (!m) {
    console.log("unknown MUT " + MUT + " — one of " + Object.keys(MUTATIONS).join(", "));
    process.exit(2);
  }
  const { readFileSync } = await import("node:fs");
  let src = readFileSync(path.join(ROOT_N, m.file), "utf8");
  for (const [from, to] of m.edits) {
    if (!src.includes(from)) {
      console.log(`MUT ${MUT}: anchor not found in ${m.file}: ${from.slice(0, 80)}`);
      process.exit(2);
    }
    src = src.split(from).join(to);
  }
  const dir = path.posix.dirname(m.file);
  src = src.replace(/from "(\.\.?\/[^"]+)"/g, (_, rel) => `from "@/${path.posix.normalize(path.posix.join(dir, rel))}"`);
  src = src.replace(/import\("(\.\.?\/[^"]+)"\)/g, (_, rel) => `import("@/${path.posix.normalize(path.posix.join(dir, rel))}")`);
  const f = path.join(MOCKDIR, "MUT__" + m.file.replace(/[\\/]/g, "__"));
  writeFileSync(f, src);
  mutatedFile[m.file.replace(/\.(ts|tsx)$/, "")] = f;
  console.log(`MUTATION ${MUT}: ${m.file} broken on purpose — expect ${m.expect.join(", ")} to FAIL`);
}

const plugin = {
  name: "fcbuttons-mocks",
  setup(b) {
    b.onResolve({ filter: /.*/ }, (args) => {
      if (mockFile[args.path]) return { path: mockFile[args.path] };
      let abs = null;
      if (args.path.startsWith("@/")) abs = path.join(ROOT_N, args.path.slice(2));
      else if (args.path.startsWith(".") && args.importer && !args.importer.startsWith(MOCKDIR)) abs = path.resolve(path.dirname(args.importer), args.path);
      if (!abs) return undefined;
      const rel = path.relative(ROOT_N, abs).split(path.sep).join("/").replace(/\.(ts|tsx|mjs|js)$/, "");
      if (mockFile[rel]) return { path: mockFile[rel] };
      if (mutatedFile[rel]) return { path: mutatedFile[rel] };
      return undefined;
    });
  },
};

const ENTRY = path.join(HERE, "fcbuttons-entry.ts");
writeFileSync(
  ENTRY,
  `export * as castRoute from "@/app/api/actions/cast/route";
export * as reactRoute from "@/app/api/actions/react/route";
export * as followRoute from "@/app/api/actions/follow/route";
export * as deliveryRoute from "@/app/api/actions/delivery/route";
export * as actAsRoute from "@/app/api/actions/act-as/route";
export * as fd from "@/app/api/actions/farcasterDelivery";
export * as writes from "@/lib/fc/writes";
export * as ledger from "@/lib/fc/writeLedger";
export * as line from "@/components/deliveryLine";
export * as limits from "@/lib/fc/castLimits";
export { NextRequest } from "next/server";
`
);

// ------------------------------------------------------------------------------------------------ the fake network
const BASE = "https://api.neynar.com/v2/farcaster";
// BUILD A review knobs: rejectCast(body) → Neynar answers 400 (nothing cast); serverErrorCast → 503 (nothing cast, but
// the client cannot know that); revoked → every write with that signer answers 403; reactionGate → a like waits for it;
// failNameLookup → by_username answers 500
const net = { casts: [], reactions: [], follows: [], calls: [], dropNextCastAfterCommit: 0, rejectCast: null, serverErrorCast: 0, revoked: new Set(), reactionGate: null, failNameLookup: 0 };
const uuidFid = () => {
  const m = new Map(T.records.filter((r) => r.signer.uuid).map((r) => [r.signer.uuid, r.fid]));
  m.set(process.env.FC_TEST_SIGNER_UUID, THROWAWAY);
  return m;
};
const resp = (status, obj) => ({ ok: status >= 200 && status < 300, status, json: async () => obj, text: async () => JSON.stringify(obj) });
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const method = (init.method || "GET").toUpperCase();
  const body = init.body ? JSON.parse(init.body) : null;
  net.calls.push({ method, url: u, body });
  if (!u.startsWith(BASE)) throw new Error("unexpected fetch outside the fake Neynar: " + u);
  const p = u.slice(BASE.length);
  if (method === "POST" && body && net.revoked.has(body.signer_uuid)) return resp(403, { message: "Signer is not approved (revoked)" });
  if (method === "POST" && p === "/cast") {
    const fid = uuidFid().get(body.signer_uuid);
    if (!fid) return resp(400, { message: "unknown signer" });
    if (net.rejectCast && net.rejectCast(body)) return resp(400, { message: "Text is too long" });
    if (net.serverErrorCast > 0) {
      net.serverErrorCast--;
      return resp(503, { message: "upstream unavailable" });
    }
    const hash = "0x" + createHash("sha1").update(`${fid}|${body.parent ?? ""}|${body.text}`).digest("hex");
    net.casts.push({ hash, fid, text: body.text, parent_hash: body.parent ?? null, signer: body.signer_uuid });
    if (net.dropNextCastAfterCommit > 0) {
      net.dropNextCastAfterCommit--;
      throw new TypeError("fetch failed (simulated: the connection dropped after the cast landed)");
    }
    return resp(200, { cast: { hash } });
  }
  if (method === "GET" && p.startsWith("/feed/user/casts")) {
    const fid = Number(new URL(u).searchParams.get("fid"));
    return resp(200, { casts: net.casts.filter((c) => c.fid === fid).slice(-25).reverse() });
  }
  if (method === "POST" && p === "/reaction") {
    if (net.reactionGate) await net.reactionGate;
    net.reactions.push({ fid: uuidFid().get(body.signer_uuid), kind: body.reaction_type, target: body.target, signer: body.signer_uuid });
    return resp(200, { success: true });
  }
  if (method === "GET" && p.startsWith("/user/by_username?")) {
    if (net.failNameLookup > 0) {
      net.failNameLookup--;
      return resp(500, { message: "boom" });
    }
    const name = new URL(u).searchParams.get("username");
    const fid = T.usernames.get(name);
    return fid === undefined ? resp(404, { message: "User not found" }) : resp(200, { user: { fid, username: name } });
  }
  if (method === "GET" && p.startsWith("/signer?")) {
    const uuid = new URL(u).searchParams.get("signer_uuid");
    const status = T.signerStatus.get(uuid) ?? "approved";
    return status === "missing" ? resp(404, { message: "signer not found" }) : resp(200, { signer_uuid: uuid, status, fid: uuidFid().get(uuid) });
  }
  if (method === "POST" && p === "/user/follow") {
    net.follows.push({ fid: uuidFid().get(body.signer_uuid), targets: body.target_fids, signer: body.signer_uuid });
    return resp(200, { success: true });
  }
  if (method === "GET" && p.startsWith("/cast?")) {
    const id = new URL(u).searchParams.get("identifier");
    const fid = T.liveAuthors.get(id);
    return fid === undefined ? resp(404, {}) : resp(200, { cast: { hash: id, author: { fid } } });
  }
  return resp(404, { message: "not in the fake" });
};
const posts = () => net.calls.filter((c) => c.method === "POST");

// ------------------------------------------------------------------------------------------------ env + bundle
function ownerEnv() {
  process.env.ENABLE_FC_WRITE = "true";
  process.env.FC_TEST_FID = String(THROWAWAY);
  process.env.FC_TEST_SIGNER_UUID = "uuid-THROWAWAY-fake";
  process.env.NEYNAR_API_KEY = "FAKE-KEY-not-real-000000";
  process.env.NEYNAR_VIEWER_FID = String(MAIN_FID);
  delete process.env.ZK_DEV_HOOKS;
  delete process.env.OWNER_ACCESS_SECRET;
  delete process.env.LAYERS_WORLD;
  delete process.env.DATA_SOURCE;
  delete process.env.PERSONA_NETWORK_MODE;
  delete process.env.NEYNAR_SIGNER_UUID;
  delete process.env.FC_TEST_CUSTODY_PRIVATE_KEY;
}
function rigEnv() {
  ownerEnv();
  delete process.env.ENABLE_FC_WRITE;
  delete process.env.NEYNAR_VIEWER_FID;
  process.env.ZK_DEV_HOOKS = "true";
}
ownerEnv();
delete process.env.FC_FOLLOWS_PER_DAY;
delete process.env.FC_CASTS_PER_DAY;
delete process.env.FC_ACTIONS_PER_DAY;

const OUT = path.join(HERE, "fcbuttons-bundle.mjs");
try {
  await build({
    absWorkingDir: ROOT_N,
    entryPoints: [ENTRY],
    outfile: OUT,
    bundle: true,
    format: "esm",
    platform: "node",
    target: ["node20"],
    tsconfig: path.join(ROOT_N, "tsconfig.json"),
    plugins: [plugin],
    loader: { ".json": "json" },
    logLevel: "error",
  });
} catch (e) {
  console.log("cannot bundle: " + (e && e.message ? e.message.split("\n").slice(0, 6).join(" | ") : String(e)));
  process.exit(2);
}
const M = await import(pathToFileURL(OUT).href);
const { castRoute, reactRoute, followRoute, deliveryRoute, actAsRoute, fd, writes, ledger, line, limits, NextRequest } = M;

async function call(route, method, url, body) {
  const req = new NextRequest("http://localhost" + url, body === undefined ? {} : { body: JSON.stringify(body) });
  const res = await route[method](req);
  return { status: res.status, json: await res.json() };
}
const castRaw = (body) => call(castRoute, "POST", "/api/actions/cast", body);
/** what the Composer does (BUILD A review, PUB-1): ask where the post goes, then send that line back with the post. A
 *  body that names `expect` itself (even null) is sent exactly as given. */
async function cast(body) {
  if ("expect" in body) return castRaw(body);
  const q = body.replyToHash ? "?replyTo=" + encodeURIComponent(body.replyToHash) : "";
  const shown = await call(deliveryRoute, "GET", "/api/actions/delivery" + q);
  return castRaw({ ...body, expect: shown.status === 200 ? line.expectationFrom(shown.json.delivery) : null });
}
const react = (body) => call(reactRoute, "POST", "/api/actions/react", body);
const follow = (body) => call(followRoute, "POST", "/api/actions/follow", body);
const actAs = (body) => call(actAsRoute, "POST", "/api/actions/act-as", body);
const deliveryGet = (q = "") => call(deliveryRoute, "GET", "/api/actions/delivery" + q);
const deliveryPost = (body) => call(deliveryRoute, "POST", "/api/actions/delivery", body);
const entries = () => [...T.state.fcWrites.values()];
const hex40 = (s) => "0x" + createHash("sha1").update(s).digest("hex");

console.log("\nBUILD A UNIT — the app's buttons through the Farcaster write door (real routes + real door, fake network)\n");

// ================================================================== the rig and the public preview: unchanged
await check("U1. WRITES OFF (every rig suite, every public preview): Post saves in Totem with NO vault read and NO network call, and says so — never 'Your post was sent.'", async () => {
  rigEnv();
  delete process.env.ZK_DEV_HOOKS;
  const reads = T.vaultReads;
  const before = net.calls.length;
  T.acting = "p_pub";
  const r = await cast({ text: "rig post" });
  assert(r.status === 200, "status " + r.status + " " + JSON.stringify(r.json));
  assert(String(r.json.hash).startsWith("0xlocal"), "hash " + r.json.hash);
  assert(r.json.delivery?.to === "layers" && r.json.delivery?.reason === "writes_off", JSON.stringify(r.json.delivery));
  assert(r.json.delivery.message === "Saved in Totem only — Farcaster posting is off on this service", r.json.delivery.message);
  assert(T.vaultReads === reads, "the vault was read on the writes-off path");
  assert(net.calls.length === before, "a network call on the writes-off path");
  assert(entries().length === 0, "a ledger entry on the writes-off path");
  const l = await react({ hash: "0xcr0001", kind: "like", on: true });
  assert(l.status === 200 && l.json.delivery?.to === "layers", "like: " + JSON.stringify(l.json));
  assert(T.vaultReads === reads, "the like read the vault");
  return r.json.delivery.message;
});

// ================================================================== the owner service, armed
await check("U2. OWNER, persona WITH its own live account: Post goes out through the door as THAT account (its signer, never the throwaway's), ledgered, attributed, a local copy under the network hash, 'Posted to Farcaster as @pub-one' + its farcaster.xyz address", async () => {
  ownerEnv();
  T.acting = "p_pub";
  const r = await cast({ text: "hello, farcaster" });
  assert(r.status === 200, "status " + r.status + " " + JSON.stringify(r.json));
  const p = posts().filter((c) => c.url.endsWith("/cast"));
  assert(p.length === 1, "POST /cast count " + p.length);
  assert(p[0].body.signer_uuid === "uuid-p_pub", "signer " + p[0].body.signer_uuid);
  assert(!p[0].body.parent, "a top-level cast carried a parent");
  const d = r.json.delivery;
  assert(d.to === "farcaster" && d.mode === "live" && d.fid === REC_PUB.fid, JSON.stringify(d));
  assert(d.message === "Posted to Farcaster as @pub-one", d.message);
  assert(r.json.hash === net.casts[0].hash && d.url === `https://farcaster.xyz/pub-one/${r.json.hash.slice(0, 10)}`, "url " + d.url);
  const e = entries().find((x) => x.castHash === r.json.hash);
  assert(e && e.kind === "cast" && e.fid === REC_PUB.fid && e.mode === "live" && e.status === "sent", "ledger " + JSON.stringify(e));
  assert(T.state.fcAttribution.get(r.json.hash)?.personaId === "p_pub", "attribution");
  const copy = T.localCasts.find((c) => c.hash === r.json.hash);
  assert(copy && copy.author.fid === REC_PUB.fid && copy.text.endsWith(" layers:persona:p_pub") && copy.views === undefined, "local copy " + JSON.stringify(copy));
  return d.url;
});

await check("U3. The same text again: the door's check-before-retry finds it — 'Already on Farcaster … nothing new went out', still ONE cast on the network and one local copy", async () => {
  const r = await cast({ text: "hello, farcaster" });
  assert(r.status === 200 && r.json.delivery?.deduped === true, JSON.stringify(r.json));
  assert(/^Already on Farcaster as @pub-one/.test(r.json.delivery.message), r.json.delivery.message);
  assert(net.casts.length === 1, "network casts " + net.casts.length);
  assert(T.localCasts.filter((c) => c.hash === r.json.hash).length === 1, "local copies");
});

await check("U4. A persona with NO account: 'Saved in Totem only — @no-account has no Farcaster account yet' + the command that creates one; NO network call, NO ledger entry — never the shared account", async () => {
  T.acting = "p_none";
  const before = net.calls.length;
  const n = entries().length;
  const r = await cast({ text: "no account here" });
  assert(r.status === 200 && String(r.json.hash).startsWith("0xlocal"), JSON.stringify(r.json));
  assert(r.json.delivery.reason === "no_account" && r.json.delivery.message === "Saved in Totem only — @no-account has no Farcaster account yet", r.json.delivery.message);
  assert(/acquire-fid\.ps1 -PersonaId p_none/.test(r.json.delivery.pointer ?? ""), "pointer " + r.json.delivery.pointer);
  assert(net.calls.length === before && entries().length === n, "something reached the door");
  return r.json.delivery.pointer.slice(0, 60) + "…";
});

await check("U5. A persona whose account record is FIXTURE on an armed service: Totem only ('isn't live yet') — never a simulated success", async () => {
  T.acting = "p_fix";
  const before = net.calls.length;
  const r = await cast({ text: "fixture on the owner service" });
  assert(r.status === 200 && r.json.delivery.reason === "account_not_live", JSON.stringify(r.json.delivery));
  assert(net.calls.length === before && writes.fcSimNetworkCasts().length === 0, "a write happened");
});

await check("U6. NEVER THE THROWAWAY, structurally: a guarded door call whose persona record has vanished (or names another fid) refuses before the ledger and the network — publish, like and follow", async () => {
  const n = entries().length;
  const before = net.calls.length;
  const errs = [];
  for (const fn of [
    () => writes.publishFcCast("vanished", "cast", undefined, { personaId: "p_none", requireFid: 900009, requireMode: "live" }),
    () => writes.publishFcCast("wrong fid", "cast", undefined, { personaId: "p_pub", requireFid: 123, requireMode: "live" }),
    () => writes.reactFc("like", hex40("x"), { personaId: "p_none", requireFid: 900009, requireMode: "live" }),
    () => writes.followFc(4242, { personaId: "p_none", requireFid: 900009, requireMode: "live" }),
    () => writes.reactFc("like", hex40("y"), { personaId: "p_pub", requireFid: REC_PUB.fid, requireMode: "fixture" }),
  ]) {
    try {
      await fn();
      errs.push("no refusal");
    } catch (e) {
      if (!(e instanceof writes.FcIdentityError)) errs.push("not FcIdentityError: " + e.message);
    }
  }
  assert(errs.length === 0, errs.join("; "));
  assert(entries().length === n, "a ledger entry opened");
  assert(net.calls.length === before, "a network call happened");
});

await check("U7. A reply under a post that is NOT on Farcaster (a local post): 'Saved in Totem only — the post you replied to isn't on Farcaster', no network call", async () => {
  T.acting = "p_pub";
  const before = net.calls.length;
  const r = await cast({ text: "reply to local", replyToHash: "0xlocal123" });
  assert(r.status === 200 && r.json.delivery.reason === "target_local", JSON.stringify(r.json.delivery));
  assert(r.json.delivery.message === "Saved in Totem only — the post you replied to isn't on Farcaster", r.json.delivery.message);
  assert(net.calls.length === before, "network call");
});

const STRANGER_CAST = hex40("stranger cast");
const MAIN_CAST = hex40("main cast");
const SIB_CAST = hex40("sibling cast");
const ANON_CAST = hex40("anon cast");
const THROWAWAY_CAST = hex40("throwaway cast");
T.liveAuthors.set(STRANGER_CAST, 555);
T.liveAuthors.set(MAIN_CAST, MAIN_FID);
T.liveAuthors.set(SIB_CAST, REC_SIB.fid);
T.liveAuthors.set(THROWAWAY_CAST, THROWAWAY);
T.anonHashes.add(ANON_CAST);

await check("U8. A reply to a stranger's live cast (no hint: the author is looked up) goes out as a REPLY — parent carried, ledgered as reply", async () => {
  const lookups = T.liveLookups;
  const r = await cast({ text: "nice one", replyToHash: STRANGER_CAST });
  assert(r.status === 200 && r.json.delivery?.to === "farcaster", JSON.stringify(r.json));
  assert(r.json.delivery.message === "Replied on Farcaster as @pub-one", r.json.delivery.message);
  const p = posts().filter((c) => c.url.endsWith("/cast")).pop();
  assert(p.body.parent === STRANGER_CAST, "parent " + p.body.parent);
  assert(entries().find((x) => x.castHash === r.json.hash)?.kind === "reply", "ledger kind");
  assert(T.liveLookups === lookups + 1, "author lookups " + (T.liveLookups - lookups));
  assert(T.localCasts.find((c) => c.hash === r.json.hash)?.replyingTo === STRANGER_CAST, "local copy not threaded");
});

await check("U9. D-FID-5: a reply to the owner's MAIN account (NEYNAR_VIEWER_FID) is refused 403 FC_SELF_LINK — nothing sent, nothing saved", async () => {
  const before = posts().length;
  const local = T.localCasts.length;
  const r = await cast({ text: "hi me", replyToHash: MAIN_CAST });
  assert(r.status === 403 && r.json.code === "FC_SELF_LINK", r.status + " " + JSON.stringify(r.json));
  // BUILD A review: the BUTTONS refuse it, in their own words, before the write door is asked — the door now refuses
  // it too (main as configured, on the real network), and this keeps each layer's check from hiding behind the other
  assert(/^Not sent — that's your main Farcaster account/.test(r.json.error), "refused by the door, not the buttons: " + r.json.error);
  assert(posts().length === before && T.localCasts.length === local, "sent or saved");
  return r.json.error;
});

await check("U10. Like a stranger's live cast (the card's author fid as the hint): POST /reaction as the persona's own signer; local heart synced; 'Liked on Farcaster as @pub-one'", async () => {
  const lookups = T.liveLookups;
  const r = await react({ hash: STRANGER_CAST, kind: "like", on: true, authorFid: 555 });
  assert(r.status === 200 && r.json.delivery?.message === "Liked on Farcaster as @pub-one", JSON.stringify(r.json));
  const last = net.reactions[net.reactions.length - 1];
  assert(last && last.signer === "uuid-p_pub" && last.kind === "like" && last.target === STRANGER_CAST, JSON.stringify(last));
  assert(T.reactions.some((x) => x.hash === STRANGER_CAST && x.on === true), "local heart");
  assert(T.liveLookups === lookups, "the hint should have spared the lookup");
});

await check("U11. Like it again: 'Already liked', no second POST; un-like: 409 FC_UNDO_UNSUPPORTED (nothing changed anywhere)", async () => {
  const n = net.reactions.length;
  const again = await react({ hash: STRANGER_CAST, kind: "like", on: true, authorFid: 555 });
  assert(again.status === 200 && again.json.delivery?.already === true && net.reactions.length === n, JSON.stringify(again.json));
  const localBefore = T.reactions.length;
  const off = await react({ hash: STRANGER_CAST, kind: "like", on: false, authorFid: 555 });
  assert(off.status === 409 && off.json.code === "FC_UNDO_UNSUPPORTED", off.status + " " + JSON.stringify(off.json));
  assert(net.reactions.length === n && T.reactions.length === localBefore, "an un-like changed something");
  return off.json.error;
});

await check("U12. Like ANOTHER of your personas' casts / the throwaway's / main's from a one-tap button: 403 FC_SELF_LINK, nothing sent", async () => {
  const n = net.reactions.length;
  for (const [h, fid] of [[SIB_CAST, REC_SIB.fid], [THROWAWAY_CAST, THROWAWAY], [MAIN_CAST, MAIN_FID]]) {
    const r = await react({ hash: h, kind: "like", on: true, authorFid: fid });
    assert(r.status === 403 && r.json.code === "FC_SELF_LINK", `${fid}: ${r.status} ${JSON.stringify(r.json)}`);
  }
  // the hint is not needed: an unhinted like of the sibling's cast is looked up and refused the same way
  const r2 = await react({ hash: SIB_CAST, kind: "recast", on: true });
  assert(r2.status === 403 && r2.json.code === "FC_SELF_LINK", "unhinted: " + JSON.stringify(r2.json));
  assert(net.reactions.length === n, "a reaction was sent");
});

await check("U13. Like a LOCAL post: Totem only (no network); like an ANON post: Totem only (would tie the persona to it); an unreadable anon list or a failed author lookup REFUSES (503), never guesses", async () => {
  const n = net.reactions.length;
  const a = await react({ hash: "0xcr0001", kind: "like", on: true });
  assert(a.status === 200 && a.json.delivery.reason === "target_local", JSON.stringify(a.json));
  const b = await react({ hash: ANON_CAST, kind: "like", on: true });
  assert(b.status === 200 && b.json.delivery.reason === "target_anon", JSON.stringify(b.json));
  T.anonThrows = true;
  const c = await react({ hash: hex40("unknown 1"), kind: "like", on: true, authorFid: 555 });
  T.anonThrows = false;
  assert(c.status === 503 && c.json.code === "FC_UNCHECKED", "anon list down: " + JSON.stringify(c.json));
  T.liveCastThrows = true;
  const d = await react({ hash: hex40("unknown 2"), kind: "like", on: true });
  T.liveCastThrows = false;
  assert(d.status === 503 && d.json.code === "FC_UNCHECKED", "lookup down: " + JSON.stringify(d.json));
  assert(net.reactions.length === n, "a reaction was sent");
});

await check("U14. FOLLOW a stranger: POST /user/follow as the persona's signer, ledgered WITH the target fid; again → 'Already following' (no second send); unfollow → 409", async () => {
  const r = await follow({ targetFid: 4242, targetHandle: "stranger" });
  assert(r.status === 200 && r.json.delivery?.message === "Following @stranger on Farcaster as @pub-one", JSON.stringify(r.json));
  const f = net.follows[net.follows.length - 1];
  assert(f && f.signer === "uuid-p_pub" && f.targets[0] === 4242, JSON.stringify(f));
  assert(entries().some((e) => e.kind === "follow" && e.targetFid === 4242 && e.fid === REC_PUB.fid), "ledger targetFid");
  const n = net.follows.length;
  const again = await follow({ targetFid: 4242 });
  assert(again.status === 200 && again.json.delivery?.already === true && net.follows.length === n, JSON.stringify(again.json));
  const off = await follow({ targetFid: 4242, follow: false });
  assert(off.status === 409 && off.json.code === "FC_UNDO_UNSUPPORTED", JSON.stringify(off.json));
});

await check("U15. Follow main / a sibling persona / yourself / the throwaway: refused, nothing sent; a persona without an account: 'Not followed — @no-account has no Farcaster account yet'", async () => {
  const n = net.follows.length;
  for (const [fid, code] of [[MAIN_FID, "FC_SELF_LINK"], [REC_SIB.fid, "FC_SELF_LINK"], [REC_PUB.fid, "FC_SELF_FOLLOW"], [THROWAWAY, "FC_SELF_LINK"]]) {
    const r = await follow({ targetFid: fid });
    assert(r.json.code === code && r.status >= 400, `${fid}: ${r.status} ${JSON.stringify(r.json)}`);
  }
  T.acting = "p_none";
  const none = await follow({ targetFid: 4243 });
  T.acting = "p_pub";
  assert(none.status === 409 && none.json.error === "Not followed — @no-account has no Farcaster account yet", JSON.stringify(none.json));
  assert(net.follows.length === n, "a follow was sent");
});

await check("U16. THE FOLLOW BUDGET: 10 follows a day (inside the 30-action cap); the 11th answers 429 follows_per_day and sends nothing", async () => {
  const already = entries().filter((e) => e.kind === "follow" && e.mode === "live").length;
  for (let i = already; i < ledger.FC_FOLLOWS_PER_DAY; i++) {
    const r = await follow({ targetFid: 5000 + i });
    assert(r.status === 200, `follow ${i}: ${r.status} ${JSON.stringify(r.json)}`);
  }
  const n = net.follows.length;
  const r = await follow({ targetFid: 6000 });
  assert(r.status === 429 && r.json.cap === "follows_per_day", r.status + " " + JSON.stringify(r.json));
  assert(net.follows.length === n, "the refused follow was sent");
  assert(ledger.ledgerSummary().live.follows === ledger.FC_FOLLOWS_PER_DAY && ledger.ledgerSummary().capFollows === 10, JSON.stringify(ledger.ledgerSummary()));
  return r.json.error;
});

await check("U17. ACT AS: a reply to a live cast as the persona goes out under ITS fid (network:true kept for the fid suites) with a delivery line; a recast goes through the door; a FIXTURE-record persona's reply on an armed service stays in Totem", async () => {
  T.casts.set(STRANGER_CAST, { hash: STRANGER_CAST, live: true, author: { fid: 555, username: "stranger" }, text: "x", embeds: [], replies: 0, likes: 0, recasts: 0, timestamp: Date.now() });
  const r = await actAs({ kind: "reply", targetHash: STRANGER_CAST, text: "act-as reply", asPersonaId: "p_pub" });
  assert(r.status === 200 && r.json.network === true && r.json.fid === REC_PUB.fid && r.json.delivery?.to === "farcaster", JSON.stringify(r.json));
  const nr = net.reactions.length;
  const rc = await actAs({ kind: "recast", targetHash: STRANGER_CAST, asPersonaId: "p_pub" });
  assert(rc.status === 200 && rc.json.delivery?.message === "Recast on Farcaster as @pub-one" && net.reactions.length === nr + 1 && rc.json.hash === undefined, JSON.stringify(rc.json));
  const before = net.calls.length;
  const fx = await actAs({ kind: "reply", targetHash: STRANGER_CAST, text: "fixture act-as", asPersonaId: "p_fix" });
  assert(fx.status === 200 && fx.json.network !== true && fx.json.delivery?.reason === "account_not_live", JSON.stringify(fx.json));
  assert(net.calls.length === before && writes.fcSimNetworkCasts().length === 0, "the fixture persona wrote somewhere");
  // a cast the Composer published: getCast finds its LOCAL copy (not live) first — it is still a network target
  const mine = T.localCasts.find((c) => c.text === "hello, farcaster layers:persona:p_pub");
  assert(mine, "U2's local copy is missing");
  T.casts.set(mine.hash, { ...mine, live: undefined });
  const sib = await actAs({ kind: "reply", targetHash: mine.hash, text: "sibling replies (waiver)", asPersonaId: "p_sib" });
  assert(sib.status === 200 && sib.json.network === true && sib.json.fid === REC_SIB.fid, "door-published target: " + JSON.stringify(sib.json));
  const p = posts().filter((c) => c.url.endsWith("/cast")).pop();
  assert(p.body.parent === mine.hash && p.body.signer_uuid === "uuid-p_sib", JSON.stringify(p.body));
});

await check("U18. AN UNCONFIRMED PUBLISH (the connection drops after the cast landed): 502 FC_UNCONFIRMED with the retry hint, no local copy; the retry is CHECKED and finds it — exactly one cast, one local copy", async () => {
  net.dropNextCastAfterCommit = 1;
  const a = await cast({ text: "dropped mid-publish" });
  assert(a.status === 502 && a.json.code === "FC_UNCONFIRMED" && /posting the same text again finds it/.test(a.json.hint ?? ""), JSON.stringify(a.json));
  assert(entries().some((e) => e.status === "pending" && e.note.includes("dropped mid-publish")), "no pending receipt");
  const landed = net.casts.filter((c) => c.text === "dropped mid-publish");
  assert(landed.length === 1 && !T.localCasts.some((c) => c.hash === landed[0].hash), "local copy before confirmation");
  const b = await cast({ text: "dropped mid-publish" });
  assert(b.status === 200 && b.json.delivery?.deduped === true && b.json.hash === landed[0].hash, JSON.stringify(b.json));
  assert(net.casts.filter((c) => c.text === "dropped mid-publish").length === 1, "duplicated on the network");
  assert(T.localCasts.filter((c) => c.hash === landed[0].hash).length === 1, "local copy count");
});

await check("U19. THE DAILY CAST CAP: casts until 10, the 11th answers 429 casts_per_day — nothing sent, nothing saved", async () => {
  let i = 0;
  while (ledger.ledgerSummary().live.casts < ledger.FC_CASTS_PER_DAY && i < 20) {
    const r = await cast({ text: "filler " + i++ });
    assert(r.status === 200, "filler " + r.status + " " + JSON.stringify(r.json));
  }
  const before = net.casts.length;
  const local = T.localCasts.length;
  const r = await cast({ text: "the eleventh" });
  assert(r.status === 429 && r.json.cap === "casts_per_day", r.status + " " + JSON.stringify(r.json));
  assert(net.casts.length === before && T.localCasts.length === local, "sent or saved past the cap");
  return r.json.error;
});

await check("U20. The vault cannot be read: 503 FC_UNCHECKED ('Couldn't check …'), nothing posted anywhere — never 'no account, saved in Totem'", async () => {
  T.vaultThrows = true;
  const before = net.calls.length;
  const local = T.localCasts.length;
  const r = await cast({ text: "vault down" });
  T.vaultThrows = false;
  assert(r.status === 503 && r.json.code === "FC_UNCHECKED", JSON.stringify(r.json));
  assert(net.calls.length === before && T.localCasts.length === local, "posted or saved");
});

await check("U21. SHARED MODE (PERSONA_NETWORK_MODE=shared-fid): the buttons never use the shared account — Totem only, no network", async () => {
  process.env.PERSONA_NETWORK_MODE = "shared-fid";
  const before = net.calls.length;
  const r = await cast({ text: "shared mode" });
  delete process.env.PERSONA_NETWORK_MODE;
  assert(r.status === 200 && r.json.delivery.reason === "shared_mode", JSON.stringify(r.json.delivery));
  assert(net.calls.length === before, "network call");
});

await check("U22. THE PRE-POST LINE (GET /api/actions/delivery): 'Posts to Farcaster as @pub-one — public'; a reply under a local post says it stays in Totem; no account says so with the pointer", async () => {
  T.acting = "p_pub";
  const a = await deliveryGet();
  assert(a.status === 200 && a.json.delivery.message === "Posts to Farcaster as @pub-one — public", JSON.stringify(a.json));
  const b = await deliveryGet("?replyTo=0xlocal999");
  assert(b.json.delivery.to === "layers" && b.json.delivery.message === "Replies to this post stay in Totem — it isn't on Farcaster", JSON.stringify(b.json));
  const lookups = T.liveLookups;
  const c = await deliveryGet("?replyTo=" + hex40("never seen"));
  assert(c.json.delivery.to === "farcaster" && T.liveLookups === lookups, "the probe spent a lookup: " + JSON.stringify(c.json));
  T.acting = "p_none";
  const d = await deliveryGet();
  T.acting = "p_pub";
  assert(d.json.delivery.reason === "no_account" && d.json.delivery.pointer, JSON.stringify(d.json));
  // on Farcaster the account goes by its fname, which the protocol grammar can make differ from the Totem handle
  addPersona("p_us", "under_score");
  record("p_us", 900003, "under-score");
  const us = await fd.deliveryFor("p_us");
  T.records = T.records.filter((x) => x.personaId !== "p_us");
  assert(us.message === "Posts to Farcaster as @under-score — public", us.message);
});

await check("U23. THE CONNECTED MAIN (Build B's origin): its own record passes the buttons' guard (requireFid admits 'connected'); a like by main on a persona's cast is refused", async () => {
  addPersona("p_main", "the-owner");
  record("p_main", MAIN_FID, "the-owner", {
    origin: "connected",
    connected: { publicSelf: true, requestFid: 31337, requestSigner: "0x" + "1".repeat(40), signerPublicKey: "0x" + "2".repeat(64), keyAddTx: null, submittedBy: null, approvedAt: Date.now(), verifiedAt: Date.now(), disconnectedAt: null },
  });
  T.acting = "p_main";
  // the daily caps are shared by every account of the root (U19 spent today's casts): a fresh day for this check
  const savedLedger = T.state.fcWrites;
  T.state.fcWrites = new Map();
  try {
  const d = await fd.deliveryFor("p_main");
  assert(d.to === "farcaster" && d.fid === MAIN_FID, "main's delivery: " + JSON.stringify(d));
  const r = await cast({ text: "main speaks" });
  assert(r.status === 200 && r.json.delivery?.fid === MAIN_FID, JSON.stringify(r.json));
  const p = posts().filter((c) => c.url.endsWith("/cast")).pop();
  assert(p.body.signer_uuid === "uuid-p_main", "main's signer");
  const n = net.reactions.length;
  const lk = await react({ hash: SIB_CAST, kind: "like", on: true, authorFid: REC_SIB.fid });
  assert(lk.status === 403 && lk.json.code === "FC_SELF_LINK" && net.reactions.length === n, JSON.stringify(lk.json));
  } finally {
    T.state.fcWrites = savedLedger;
    T.acting = "p_pub";
    T.records = T.records.filter((x) => x.personaId !== "p_main");
  }
});

await check("U23b. THE OWNER SERVICE AS IT RUNS (LAYERS_WORLD=empty + OWNER_ACCESS_SECRET, writes armed): Post as a persona with its own account goes to Farcaster; one without says so", async () => {
  ownerEnv();
  process.env.LAYERS_WORLD = "empty";
  process.env.OWNER_ACCESS_SECRET = "o".repeat(32);
  const savedLedger = T.state.fcWrites;
  T.state.fcWrites = new Map();
  try {
    T.acting = "p_pub";
    const r = await cast({ text: "from the owner service" });
    assert(r.status === 200 && r.json.delivery?.to === "farcaster" && r.json.delivery.fid === REC_PUB.fid, JSON.stringify(r.json));
    T.acting = "p_none";
    const n = await cast({ text: "owner service, no account" });
    assert(n.status === 200 && n.json.delivery?.reason === "no_account", JSON.stringify(n.json));
    const k = await deliveryPost({ action: "fixtureDelivery", on: true });
    assert(k.status === 403, "the knob armed on the owner service: " + k.status);
  } finally {
    T.state.fcWrites = savedLedger;
    T.acting = "p_pub";
    ownerEnv();
  }
});

// ================================================================== the rig's fixture knob
await check("U24. THE RIG KNOB: refused without ZK_DEV_HOOKS, with writes armed, on the owner service, under LAYERS_WORLD=empty and under live content", async () => {
  const tries = [];
  ownerEnv(); // armed
  process.env.ZK_DEV_HOOKS = "true";
  tries.push(["armed", await deliveryPost({ action: "fixtureDelivery", on: true })]);
  rigEnv();
  delete process.env.ZK_DEV_HOOKS;
  tries.push(["no hooks", await deliveryPost({ action: "fixtureDelivery", on: true })]);
  rigEnv();
  process.env.OWNER_ACCESS_SECRET = "x".repeat(24);
  tries.push(["owner", await deliveryPost({ action: "fixtureDelivery", on: true })]);
  rigEnv();
  process.env.LAYERS_WORLD = "empty";
  tries.push(["empty world", await deliveryPost({ action: "fixtureDelivery", on: true })]);
  rigEnv();
  process.env.DATA_SOURCE = "neynar";
  tries.push(["live content", await deliveryPost({ action: "fixtureDelivery", on: true })]);
  rigEnv();
  const bad = tries.filter(([, r]) => r.status !== 403);
  assert(bad.length === 0, "not refused: " + bad.map(([n, r]) => n + "=" + r.status).join(", "));
  assert(fd.fixtureDeliveryArmed() === false, "armed after refusals");
});

await check("U25. THE RIG KNOB, armed: a FIXTURE-record persona's Post goes through the door to the SIMULATED network under its fid ('Posted to Farcaster (simulated network)'), no fetch; a LIVE-record persona never writes there; a seed reset (a new store object) disarms the knob", async () => {
  rigEnv();
  const k = await deliveryPost({ action: "fixtureDelivery", on: true });
  assert(k.status === 200 && k.json.fixtureDelivery === true, JSON.stringify(k.json));
  T.acting = "p_fix";
  const before = net.calls.length;
  const r = await cast({ text: "sim hello" });
  assert(r.status === 200 && r.json.delivery?.mode === "fixture" && r.json.delivery.message === "Posted to Farcaster (simulated network) as @fixture-one", JSON.stringify(r.json));
  const sim = writes.fcSimNetworkCasts().find((c) => c.hash === r.json.hash);
  assert(sim && sim.fid === REC_FIX.fid, "sim " + JSON.stringify(sim));
  assert(net.calls.length === before, "the knob reached the network");
  assert(r.json.delivery.url === null, "a simulated cast has no public address");
  const lk = await react({ hash: r.json.hash, kind: "like", on: true });
  assert(lk.status === 200 && lk.json.delivery?.to === "farcaster" && lk.json.delivery.mode === "fixture", "sim like " + JSON.stringify(lk.json));
  T.acting = "p_pub";
  const live = await cast({ text: "a live account on the sim" });
  assert(live.status === 200 && live.json.delivery.reason === "account_not_live", JSON.stringify(live.json.delivery));
  const old = T.state;
  T.state = { fcWrites: new Map(old.fcWrites), fcAttribution: new Map(old.fcAttribution), privatePosts: new Map() };
  assert(fd.fixtureDeliveryArmed() === false, "the knob survived a reset");
  T.state = old;
  await deliveryPost({ action: "fixtureDelivery", on: false });
});

await check("U26. Every user-facing sentence this build adds is free of 'Your post was sent.'", async () => {
  const { readFileSync } = await import("node:fs");
  for (const f of ["components/Composer.tsx", "app/api/actions/farcasterDelivery.ts", "app/api/actions/cast/route.ts", "app/api/actions/react/route.ts", "app/api/actions/act-as/route.ts", "app/api/actions/follow/route.ts", "app/api/actions/delivery/route.ts"]) {
    const src = readFileSync(path.join(ROOT_N, f), "utf8");
    assert(!src.includes("Your post was sent"), f + " still says it");
  }
  // and the positive control: the files read are the right ones (a missing file would have thrown above)
  assert(readFileSync(path.join(ROOT_N, "components/Composer.tsx"), "utf8").includes("Posted to your Totem preview, not to Farcaster"), "the preview sentence is gone");
});


// ================================================================== BUILD A / CONNECT MAIN REVIEW — the fixes, pinned
// Each check names the finding it pins (PUB-*, PL-*, UXC-*). Same world as above: real routes + the real door, the fake
// Neynar — nothing leaves this machine.
console.log("\nREVIEW FIXES — PUB-1..8, PL-1..3, UXC-02/03/04/05/06/07/08/11\n");
const freshLedger = () => {
  T.state.fcWrites = new Map();
};
const castPosts = () => posts().filter((c) => c.url.endsWith("/cast"));
const CONNECTED = () => ({ publicSelf: true, requestFid: 31337, requestSigner: "0x" + "1".repeat(40), signerPublicKey: "0x" + "2".repeat(64), keyAddTx: null, submittedBy: null, approvedAt: Date.now(), verifiedAt: Date.now(), disconnectedAt: null });
function connectMain() {
  addPersona("p_main", "the-owner");
  record("p_main", MAIN_FID, "the-owner", { origin: "connected", connected: CONNECTED() });
}
function dropMain() {
  T.records = T.records.filter((x) => x.personaId !== "p_main");
}

await check("U27. PUB-1: the line named @pub-one; another tab switched the shared acting persona to main; this tab's Post carrying its line → 409 FC_DELIVERY_CHANGED, NOTHING sent or saved, the fresh line names main; Post again with the fresh line → out as main", async () => {
  ownerEnv();
  freshLedger();
  connectMain();
  try {
    T.acting = "p_pub";
    const shown = await deliveryGet();
    assert(shown.json.delivery.personaId === "p_pub" && shown.json.delivery.fid === REC_PUB.fid, "the line carries its persona and account: " + JSON.stringify(shown.json.delivery));
    T.acting = "p_main"; // tab B
    const n = castPosts().length;
    const local = T.localCasts.length;
    const r = await castRaw({ text: "meant for my alt", expect: line.expectationFrom(shown.json.delivery) });
    assert(r.status === 409 && r.json.code === "FC_DELIVERY_CHANGED", r.status + " " + JSON.stringify(r.json));
    assert(r.json.delivery?.personaId === "p_main" && r.json.delivery.fid === MAIN_FID && /@the-owner/.test(r.json.delivery.message), "fresh line: " + JSON.stringify(r.json.delivery));
    assert(castPosts().length === n && T.localCasts.length === local && entries().length === 0, "something was sent or saved");
    const again = await castRaw({ text: "meant for my alt", expect: line.expectationFrom(r.json.delivery) });
    assert(again.status === 200 && again.json.delivery?.fid === MAIN_FID, JSON.stringify(again.json));
    return r.json.error;
  } finally {
    T.acting = "p_pub";
    dropMain();
  }
});

await check("U28. PUB-1: the line said 'Saved in Totem only — no account yet'; acquire-fid then recorded the account; the same tab's Post → 409 (nothing public); the reverse (the line said Farcaster, the record went away) → 409 too", async () => {
  ownerEnv();
  freshLedger();
  T.acting = "p_none";
  const shown = await deliveryGet();
  assert(shown.json.delivery.to === "layers" && shown.json.delivery.reason === "no_account", JSON.stringify(shown.json.delivery));
  const rec = record("p_none", 900077, "no-account");
  try {
    const n = castPosts().length;
    const r = await castRaw({ text: "a thought I meant to keep in Totem", expect: line.expectationFrom(shown.json.delivery) });
    assert(r.status === 409 && r.json.code === "FC_DELIVERY_CHANGED" && r.json.delivery?.to === "farcaster", JSON.stringify(r.json));
    assert(castPosts().length === n && entries().length === 0, "a cast went out");
    const shownF = await deliveryGet();
    T.records = T.records.filter((x) => x !== rec);
    const back = await castRaw({ text: "meant public", expect: line.expectationFrom(shownF.json.delivery) });
    assert(back.status === 409 && back.json.code === "FC_DELIVERY_CHANGED" && back.json.delivery?.to === "layers", JSON.stringify(back.json));
  } finally {
    T.records = T.records.filter((x) => x !== rec);
    T.acting = "p_pub";
  }
});

await check("U29. PUB-1: a REAL-network post with NO line is refused (409, nothing sent); Totem-only posts and the rig's simulated network still accept a caller that sends none", async () => {
  ownerEnv();
  freshLedger();
  T.acting = "p_pub";
  const n = castPosts().length;
  const r = await castRaw({ text: "no line shown" });
  assert(r.status === 409 && r.json.code === "FC_DELIVERY_CHANGED" && r.json.delivery?.to === "farcaster", JSON.stringify(r.json));
  assert(castPosts().length === n, "sent");
  T.acting = "p_none";
  const l = await castRaw({ text: "layers only, no line" });
  assert(l.status === 200 && l.json.delivery?.to === "layers", JSON.stringify(l.json));
  rigEnv();
  const k = await deliveryPost({ action: "fixtureDelivery", on: true });
  assert(k.status === 200, "knob " + JSON.stringify(k.json));
  T.acting = "p_fix";
  const s = await castRaw({ text: "sim, no line" });
  await deliveryPost({ action: "fixtureDelivery", on: false });
  ownerEnv();
  T.acting = "p_pub";
  assert(s.status === 200 && s.json.delivery?.mode === "fixture", JSON.stringify(s.json));
});

await check("U30. PUB-1: a like / follow names the persona its card was rendered for — another one → 409 FC_PERSONA_CHANGED, nothing sent; the acting one (or none, an older caller) goes through; an un-like (sends nothing) is never refused for it", async () => {
  ownerEnv();
  freshLedger();
  T.acting = "p_pub";
  const H = hex40("binding target");
  T.liveAuthors.set(H, 555);
  const nr = net.reactions.length;
  const nf = net.follows.length;
  const a = await react({ hash: H, kind: "like", on: true, authorFid: 555, actingPersonaId: "p_sib" });
  assert(a.status === 409 && a.json.code === "FC_PERSONA_CHANGED" && /@pub-one/.test(a.json.error), JSON.stringify(a.json));
  const f = await follow({ targetFid: 4250, actingPersonaId: "p_sib" });
  assert(f.status === 409 && f.json.code === "FC_PERSONA_CHANGED", JSON.stringify(f.json));
  assert(net.reactions.length === nr && net.follows.length === nf && entries().length === 0, "sent");
  const ok = await react({ hash: H, kind: "like", on: true, authorFid: 555, actingPersonaId: "p_pub" });
  assert(ok.status === 200 && net.reactions.length === nr + 1, JSON.stringify(ok.json));
  const older = await react({ hash: H, kind: "recast", on: true, authorFid: 555 });
  assert(older.status === 200, "an older caller: " + JSON.stringify(older.json));
  const off = await react({ hash: hex40("never liked"), kind: "like", on: false, actingPersonaId: "p_sib" });
  assert(off.status === 200, JSON.stringify(off.json));
});

await check("U31. PUB-2/UXC-03: Neynar REFUSES a post (400): 502 FC_REFUSED 'Farcaster refused this post (…) — nothing was posted', no 'may have gone through' hint, the ledger entry FAILED; the same text again → refused the same way (never 'a prior live receipt'); ten refused drafts hold NO slot of the shared cap", async () => {
  ownerEnv();
  freshLedger();
  T.acting = "p_pub";
  net.rejectCast = (body) => String(body.text).startsWith("rejected");
  try {
    const a = await cast({ text: "rejected draft" });
    assert(a.status === 502 && a.json.code === "FC_REFUSED" && a.json.ambiguous === false && a.json.hint === undefined, JSON.stringify(a.json));
    assert(a.json.error === "Farcaster refused this post (neynar cast failed: 400: Text is too long) — nothing was posted.", a.json.error);
    assert(entries().length === 1 && entries()[0].status === "failed", "ledger: " + JSON.stringify(entries().map((e) => e.status)));
    const b = await cast({ text: "rejected draft" });
    assert(b.status === 502 && b.json.code === "FC_REFUSED" && !/prior live receipt/.test(b.json.error), JSON.stringify(b.json));
    for (let i = 0; i < 10; i++) await cast({ text: "rejected draft " + i });
    assert(ledger.ledgerSummary().live.casts === 0, "refused drafts hold cap slots: " + JSON.stringify(ledger.ledgerSummary().live));
    T.acting = "p_sib";
    const sib = await cast({ text: "a valid post from another persona" });
    assert(sib.status === 200 && sib.json.delivery?.to === "farcaster", JSON.stringify(sib.json));
    return a.json.error;
  } finally {
    net.rejectCast = null;
    T.acting = "p_pub";
  }
});

await check("U32. PUB-2: a Farcaster post over 320 BYTES (an emoji is 4) → 422 FC_TOO_LONG before the door (no network call, no ledger row); exactly 320 goes out; a Totem-only post may be longer", async () => {
  ownerEnv();
  freshLedger();
  T.acting = "p_pub";
  const long = "🙂".repeat(81); // 81 characters, 324 bytes
  assert(limits.castBytes(long) === 324 && typeof limits.castTooLong(long) === "string" && limits.castTooLong("a".repeat(320)) === null, "castBytes / castTooLong");
  const n = net.calls.length;
  const r = await cast({ text: long });
  assert(r.status === 422 && r.json.code === "FC_TOO_LONG" && /324 of 320 bytes/.test(r.json.error), JSON.stringify(r.json));
  assert(net.calls.length === n && entries().length === 0, "it reached the door");
  const ok = await cast({ text: "a".repeat(320) });
  assert(ok.status === 200 && ok.json.delivery?.to === "farcaster", JSON.stringify(ok.json));
  T.acting = "p_none";
  const lay = await cast({ text: "b".repeat(500) });
  T.acting = "p_pub";
  assert(lay.status === 200 && lay.json.delivery?.to === "layers", JSON.stringify(lay.json));
});

await check("U33. UXC-04: 'gm' twice in a row is deduped (a double submit), but 'gm' after the retry window is a NEW post (two casts); 'gm!' right after its first cast was pushed out of the latest 25 is a new post too — a confirmed receipt never blocks the words", async () => {
  ownerEnv();
  freshLedger();
  T.acting = "p_pub";
  const a = await cast({ text: "gm" });
  assert(a.status === 200 && !a.json.delivery.deduped, JSON.stringify(a.json));
  const quick = await cast({ text: "gm" });
  assert(quick.status === 200 && quick.json.delivery.deduped === true, "a double submit inside the window: " + JSON.stringify(quick.json));
  for (const e of entries()) e.at -= ledger.FC_RETRY_WINDOW_MS + 60_000; // "tomorrow"
  const later = await cast({ text: "gm" });
  assert(later.status === 200 && !later.json.delivery.deduped && /^Posted to Farcaster as @pub-one$/.test(later.json.delivery.message), JSON.stringify(later.json));
  assert(net.casts.filter((c) => c.text === "gm" && c.fid === REC_PUB.fid).length === 2, "casts: " + net.casts.filter((c) => c.text === "gm").length);
  const b = await cast({ text: "gm!" });
  for (let i = 0; i < 25; i++) net.casts.push({ hash: hex40("other client " + i), fid: REC_PUB.fid, text: "from another client " + i, parent_hash: null, signer: "other" });
  const c = await cast({ text: "gm!" });
  assert(b.status === 200 && c.status === 200 && !c.json.delivery.deduped, JSON.stringify(c.json));
});

await check("U34. UXC-03: a 5xx on publish is AMBIGUOUS (502 FC_UNCONFIRMED with the 'finds it' hint, the entry PENDING); the retry cannot see it in the window → 409 FC_RETRY_UNCONFIRMED in plain words, nothing sent, no 'may have gone through' hint", async () => {
  ownerEnv();
  freshLedger();
  T.acting = "p_pub";
  net.serverErrorCast = 1;
  const a = await cast({ text: "a 5xx draft" });
  assert(a.status === 502 && a.json.code === "FC_UNCONFIRMED" && a.json.ambiguous === true && /finds it/.test(a.json.hint ?? ""), JSON.stringify(a.json));
  assert(entries().filter((e) => e.status === "pending").length === 1, "pending");
  const n = castPosts().length;
  const b = await cast({ text: "a 5xx draft" });
  assert(b.status === 409 && b.json.code === "FC_RETRY_UNCONFIRMED" && b.json.hint === undefined && /Nothing was sent/.test(b.json.error), JSON.stringify(b.json));
  assert(castPosts().length === n, "re-sent");
  assert(line.refusalKind(b.json.code) === "refused" && line.refusalKind(a.json.code) === "unconfirmed", "how the Composer shows them");
  return b.json.error;
});

await check("U35. UXC-03: a like Neynar answers NO (403: a revoked signer) → 502 FC_REFUSED 'Farcaster refused this like (…) — nothing was sent', no 'It may have gone through' hint; the ledger entry failed", async () => {
  ownerEnv();
  freshLedger();
  T.acting = "p_pub";
  const H = hex40("refused like target");
  T.liveAuthors.set(H, 555);
  net.revoked.add("uuid-p_pub");
  try {
    const l = await react({ hash: H, kind: "like", on: true, authorFid: 555 });
    assert(l.status === 502 && l.json.code === "FC_REFUSED" && l.json.ambiguous === false && l.json.hint === undefined && /^Farcaster refused this like \(/.test(l.json.error) && /nothing was sent\.$/.test(l.json.error), JSON.stringify(l.json));
    assert(entries().length === 1 && entries()[0].status === "failed", JSON.stringify(entries()));
  } finally {
    net.revoked.delete("uuid-p_pub");
  }
});

await check("U36. PUB-3/PL-1: main UNKNOWN (no connected record, NEYNAR_VIEWER_FID unset), real network: like / reply / follow → 409 FC_MAIN_UNKNOWN naming the setting, nothing sent, no lookups; the pre-post line for that reply says so; a plain post goes out; a post with an @mention is refused by the door", async () => {
  ownerEnv();
  delete process.env.NEYNAR_VIEWER_FID;
  freshLedger();
  T.acting = "p_pub";
  try {
    const H = hex40("a cast by the owner's main account, unknown here");
    T.liveAuthors.set(H, MAIN_FID);
    const before = net.calls.length;
    const lookups = T.liveLookups;
    const lk = await react({ hash: H, kind: "like", on: true, authorFid: MAIN_FID });
    const rp = await cast({ text: "replying", replyToHash: H });
    const fl = await follow({ targetFid: MAIN_FID });
    for (const [n, r] of [["like", lk], ["reply", rp], ["follow", fl]])
      assert(r.status === 409 && r.json.code === "FC_MAIN_UNKNOWN" && /NEYNAR_VIEWER_FID/.test(r.json.error), n + ": " + r.status + " " + JSON.stringify(r.json));
    assert(net.calls.length === before && T.liveLookups === lookups && entries().length === 0, "something was sent or looked up");
    const shown = await deliveryGet("?replyTo=" + H);
    assert(shown.json.delivery.refused === true && /NEYNAR_VIEWER_FID/.test(shown.json.delivery.message), JSON.stringify(shown.json.delivery));
    const plain = await cast({ text: "a plain post touches no one" });
    assert(plain.status === 200 && plain.json.delivery?.to === "farcaster", JSON.stringify(plain.json));
    const m = await cast({ text: "gm @jordan-main" });
    assert(m.status === 409 && m.json.code === "FC_MAIN_UNKNOWN", JSON.stringify(m.json));
    assert(!castPosts().some((c) => c.body.text === "gm @jordan-main"), "the mention went out");
    return lk.json.error.slice(0, 90) + "…";
  } finally {
    ownerEnv();
  }
});

await check("U37. PL-1/PL-3: with main known (NEYNAR_VIEWER_FID), a persona's '@name' is judged by the account the name reaches NOW (by_username): main's name → 403 FC_SELF_LINK, nothing sent; a stranger → posted, the answer cached; a name that cannot be looked up → refused (fail closed)", async () => {
  ownerEnv();
  freshLedger();
  T.acting = "p_pub";
  T.usernames.set("jordan-main", MAIN_FID);
  T.usernames.set("a-stranger", 4321);
  const n = castPosts().length;
  const m = await cast({ text: "gm @jordan-main" });
  assert(m.status === 403 && m.json.code === "FC_SELF_LINK", JSON.stringify(m.json));
  const s = await cast({ text: "gm @a-stranger" });
  assert(s.status === 200, JSON.stringify(s.json));
  const lookups = () => net.calls.filter((c) => c.url.includes("/user/by_username")).length;
  const l0 = lookups();
  const s2 = await cast({ text: "gm again @a-stranger" });
  assert(s2.status === 200 && lookups() === l0, "the name was looked up again");
  net.failNameLookup = 3;
  const f = await cast({ text: "hi @someone-unreadable" });
  net.failNameLookup = 0;
  assert(f.status === 403 && f.json.code === "FC_SELF_LINK" && /could not establish/.test(f.json.error), JSON.stringify(f.json));
  assert(castPosts().length === n + 2, "posts: " + (castPosts().length - n));
});

await check("U38. PUB-7: a Composer reply to a cast ATTRIBUTED to the acting persona but published by the SHARED test account (its ledger row) → 403 FC_SELF_LINK, nothing sent (the pre-post line already says so); a reply to its own attributed cast (its own fid) goes out", async () => {
  ownerEnv();
  freshLedger();
  T.acting = "p_pub";
  const TW = hex40("old shared-account cast by p_pub");
  T.state.fcAttribution.set(TW, { personaId: "p_pub", at: Date.now(), signature: "sig:p_pub" });
  T.state.fcWrites.set("fcw_shared", { id: "fcw_shared", kind: "cast", status: "sent", contentHash: "x1", castHash: TW, fid: THROWAWAY, mode: "live", at: Date.now() - 86_400_000, note: "cast: old" });
  const shown = await deliveryGet("?replyTo=" + TW);
  assert(shown.json.delivery.refused === true, "line: " + JSON.stringify(shown.json.delivery));
  const n = castPosts().length;
  const r = await cast({ text: "following up on my old post", replyToHash: TW });
  assert(r.status === 403 && r.json.code === "FC_SELF_LINK" && /shared Totem test account/.test(r.json.error), JSON.stringify(r.json));
  assert(castPosts().length === n, "sent");
  const OWN = hex40("p_pub's own attributed cast");
  T.state.fcAttribution.set(OWN, { personaId: "p_pub", at: Date.now(), signature: "sig:p_pub" });
  T.state.fcWrites.set("fcw_own", { id: "fcw_own", kind: "cast", status: "sent", contentHash: "y1", castHash: OWN, fid: REC_PUB.fid, mode: "live", at: Date.now() - 86_400_000, note: "cast: own" });
  const ok = await cast({ text: "adding to my own post", replyToHash: OWN });
  assert(ok.status === 200 && ok.json.delivery?.to === "farcaster", JSON.stringify(ok.json));
});

await check("U39. PUB-8/PL-2: the anonymous account and the reserved Totem fids are OWN accounts to the one-tap guard — a persona's Follow of FC_ANON_FID / a reserved fid / an anon fid named only by the ZK snapshot → 403, nothing sent; while the anon account cannot be named a Follow is REFUSED (503); the door refuses the CONNECTED main following it", async () => {
  ownerEnv();
  freshLedger();
  T.acting = "p_pub";
  const nf = net.follows.length;
  process.env.FC_ANON_FID = "4444";
  process.env.FC_RESERVED_FIDS = "3348986";
  try {
    const a = await follow({ targetFid: 4444, targetHandle: "anon-account" });
    const b = await follow({ targetFid: 3348986 });
    assert(a.status === 403 && a.json.code === "FC_SELF_LINK" && b.status === 403 && b.json.code === "FC_SELF_LINK", JSON.stringify([a.json, b.json]));
  } finally {
    delete process.env.FC_ANON_FID;
    delete process.env.FC_RESERVED_FIDS;
  }
  T.anonSnapshotFid = 4445;
  const c = await follow({ targetFid: 4445 });
  T.anonSnapshotFid = null;
  assert(c.status === 403 && c.json.code === "FC_SELF_LINK", "snapshot-named anon: " + JSON.stringify(c.json));
  T.anonUnknown = true;
  const d = await follow({ targetFid: 4446 });
  T.anonUnknown = false;
  assert(d.status === 503 && d.json.code === "FC_UNCHECKED", "unknown anon: " + JSON.stringify(d.json));
  assert(net.follows.length === nf, "a follow went out");
  connectMain();
  T.anonSnapshotFid = 4447;
  try {
    let refused = false;
    try {
      await writes.followFc(4447, { personaId: "p_main" });
    } catch (e) {
      refused = e instanceof writes.FcIdentityError && /must never interact/.test(e.message);
    }
    assert(refused && net.follows.length === nf, "the door let main follow the anon account");
  } finally {
    T.anonSnapshotFid = null;
    dropMain();
  }
});

await check("U40. PUB-6: like, then un-like while the like is still on its way (a double tap) → 409 'still being sent' and the heart is NOT cleared in Totem; the like then lands and says so", async () => {
  ownerEnv();
  freshLedger();
  T.acting = "p_pub";
  const H = hex40("race target");
  T.liveAuthors.set(H, 555);
  let release;
  net.reactionGate = new Promise((r) => (release = r));
  const before = T.reactions.length;
  const likeP = react({ hash: H, kind: "like", on: true, authorFid: 555 });
  await new Promise((r) => setTimeout(r, 40));
  const un = await react({ hash: H, kind: "like", on: false, authorFid: 555 });
  release();
  net.reactionGate = null;
  const like = await likeP;
  assert(un.status === 409 && un.json.code === "FC_UNDO_UNSUPPORTED" && /still being sent/.test(un.json.error), JSON.stringify(un.json));
  assert(like.status === 200 && like.json.delivery?.message === "Liked on Farcaster as @pub-one", JSON.stringify(like.json));
  const local = T.reactions.slice(before).filter((x) => x.hash === H).map((x) => x.on);
  assert(JSON.stringify(local) === "[true]", "local writes " + JSON.stringify(local));
});

await check("U41. UXC-11: un-like of a Totem-only like on a SIBLING's Farcaster cast (liked before this persona had an account) → 200 'Like removed in Totem only — nothing changed on Farcaster': no refusal, no lookup", async () => {
  ownerEnv();
  freshLedger();
  T.acting = "p_pub";
  const sibCast = hex40("sib cast for unlike");
  T.state.fcAttribution.set(sibCast, { personaId: "p_sib", at: Date.now(), signature: "sig" });
  const lookups = T.liveLookups;
  const u = await react({ hash: sibCast, kind: "like", on: false, authorFid: REC_SIB.fid });
  assert(u.status === 200 && u.json.delivery?.message === "Like removed in Totem only — nothing changed on Farcaster", JSON.stringify(u.json));
  assert(T.liveLookups === lookups && T.reactions.some((x) => x.hash === sibCast && x.on === false), "a lookup, or no local undo");
});

await check("U42. UXC-08: a one-tap like between MAIN and another account (either way) is refused WITHOUT 'Use Act as…' ('Your main account never interacts with your other accounts on Farcaster.'); persona → sibling keeps the Act as… pointer", async () => {
  ownerEnv();
  freshLedger();
  connectMain();
  try {
    T.acting = "p_main";
    const a = await react({ hash: SIB_CAST, kind: "like", on: true, authorFid: REC_SIB.fid });
    assert(a.status === 403 && !/Act as/.test(a.json.error) && /Your main account never interacts with your other accounts on Farcaster\./.test(a.json.error), JSON.stringify(a.json));
    T.acting = "p_pub";
    const b = await react({ hash: MAIN_CAST, kind: "like", on: true, authorFid: MAIN_FID });
    assert(b.status === 403 && !/Act as/.test(b.json.error) && /Your main account never interacts/.test(b.json.error), JSON.stringify(b.json));
    const c = await react({ hash: SIB_CAST, kind: "like", on: true, authorFid: REC_SIB.fid });
    assert(c.status === 403 && /Use Act as… on the post if you mean to\./.test(c.json.error), JSON.stringify(c.json));
    return a.json.error;
  } finally {
    T.acting = "p_pub";
    dropMain();
  }
});

await check("U43. UXC-02: a refusal that is NOT a revocation records nothing; once the owner removed Totem in the Farcaster app, a post as main → 502 FC_REFUSED (nothing posted), Totem asks Neynar about main's signer and records it, and the next line says 'Saved in Totem only — your main account removed Totem in the Farcaster app — connect it again in Settings › Connect your Farcaster account'", async () => {
  ownerEnv();
  freshLedger();
  connectMain();
  T.acting = "p_main";
  const d0 = T.disconnects.length;
  try {
    net.rejectCast = (b) => b.text === "rejected for main";
    const r0 = await cast({ text: "rejected for main" });
    net.rejectCast = null;
    assert(r0.status === 502 && r0.json.code === "FC_REFUSED" && T.disconnects.length === d0, "a plain refusal recorded a disconnect: " + JSON.stringify(T.disconnects));
    net.revoked.add("uuid-p_main");
    T.signerStatus.set("uuid-p_main", "revoked");
    const r = await cast({ text: "after revoking in the app" });
    assert(r.status === 502 && r.json.code === "FC_REFUSED", JSON.stringify(r.json));
    assert(T.disconnects.slice(d0).some((x) => x.personaId === "p_main" && x.reason === "revoked_in_app"), "not recorded: " + JSON.stringify(T.disconnects));
    const next = await deliveryGet();
    assert(
      next.json.delivery.to === "layers" &&
        next.json.delivery.reason === "main_removed" &&
        next.json.delivery.message === "Saved in Totem only — your main account removed Totem in the Farcaster app — connect it again in Settings › Connect your Farcaster account",
      JSON.stringify(next.json.delivery)
    );
    return next.json.delivery.message;
  } finally {
    net.rejectCast = null;
    net.revoked.delete("uuid-p_main");
    T.signerStatus.delete("uuid-p_main");
    T.acting = "p_pub";
    dropMain();
  }
});

await check("U44. UXC-07: the cast-cap refusal says the budget is SHARED by all your accounts and names the setting that raises it", async () => {
  ownerEnv();
  freshLedger();
  T.acting = "p_pub";
  for (let i = 0; i < ledger.FC_CASTS_PER_DAY; i++) await cast({ text: "cap filler " + i });
  T.acting = "p_sib";
  const r = await cast({ text: "one more, from another persona" });
  T.acting = "p_pub";
  assert(r.status === 429 && r.json.cap === "casts_per_day" && /shared by all your accounts/.test(r.json.error) && /FC_CASTS_PER_DAY/.test(r.json.error), JSON.stringify(r.json));
  return r.json.error;
});

await check("U45. PUB-4/UXC-05: Act as… shows the ROUTE's own sentence — a quote 'Quoted in Totem only — …' (neutral), a recast 'Recast on Farcaster as @pub-one', a reply with its farcaster.xyz address, a no-account reply 'Saved in Totem only — …', a refusal with its hint — never 'Posted as @x.'", async () => {
  ownerEnv();
  freshLedger();
  T.acting = "p_pub";
  const H = hex40("stranger cast for act-as review");
  T.liveAuthors.set(H, 555);
  T.casts.set(H, { hash: H, live: true, author: { fid: 555, username: "stranger" }, text: "x", embeds: [], replies: 0, likes: 0, recasts: 0, timestamp: Date.now() });
  const q = await actAs({ kind: "quote", targetHash: H, text: "my take", asPersonaId: "p_pub" });
  const rc = await actAs({ kind: "recast", targetHash: H, asPersonaId: "p_pub" });
  const rp = await actAs({ kind: "reply", targetHash: H, text: "act-as reply, review", asPersonaId: "p_pub" });
  const rn = await actAs({ kind: "reply", targetHash: H, text: "no account reply", asPersonaId: "p_none" });
  const oq = line.actAsOutcome(q.status < 300, q.json, "pub-one");
  const orc = line.actAsOutcome(rc.status < 300, rc.json, "pub-one");
  const orp = line.actAsOutcome(rp.status < 300, rp.json, "pub-one");
  const orn = line.actAsOutcome(rn.status < 300, rn.json, "no-account");
  assert(oq.tone === "layers" && oq.message === "Quoted in Totem only — quote posts aren't sent to Farcaster yet", JSON.stringify(oq));
  assert(orc.tone === "farcaster" && orc.message === "Recast on Farcaster as @pub-one" && orc.url === null, JSON.stringify(orc));
  assert(orp.tone === "farcaster" && orp.message === "Replied on Farcaster as @pub-one" && /^https:\/\/farcaster\.xyz\/pub-one\/0x/.test(orp.url ?? ""), JSON.stringify(orp));
  assert(orn.tone === "layers" && orn.message === "Saved in Totem only — @no-account has no Farcaster account yet", JSON.stringify(orn));
  const err = line.actAsOutcome(false, { error: "neynar cast failed: 503", code: "FC_UNCONFIRMED", hint: "If it reached Farcaster, sending the same reply again finds it instead of posting it twice." }, "x");
  assert(err.tone === "error" && /^If it reached Farcaster/.test(err.detail ?? ""), JSON.stringify(err));
  for (const o of [oq, orc, orp, orn]) assert(!/^Posted as @/.test(o.message), "the old fixed sentence: " + o.message);
});

await check("U46. PUB-1/PUB-2 pure halves: expectationFrom sends exactly what the line said (nothing for an unanswered line); refusalKind keeps the 'unconfirmed' look for FC_UNCONFIRMED alone; castBytes counts UTF-8 bytes", async () => {
  assert(line.expectationFrom(null) === null && line.expectationFrom({ to: "unknown", message: "x" }) === null, "unknown");
  const e = line.expectationFrom({ to: "farcaster", message: "m", personaId: "p", fid: 9, mode: "live" });
  assert(JSON.stringify(e) === JSON.stringify({ to: "farcaster", personaId: "p", fid: 9 }), JSON.stringify(e));
  assert(JSON.stringify(line.expectationFrom({ to: "layers", message: "m", personaId: "p" })) === JSON.stringify({ to: "layers", personaId: "p", fid: null }), "layers");
  assert(line.refusalKind("FC_UNCONFIRMED") === "unconfirmed" && ["FC_REFUSED", "FC_RETRY_UNCONFIRMED", "FC_RETRY_UNCHECKED", "FC_DELIVERY_CHANGED", "FC_CAP", "FC_MAIN_UNKNOWN", "FC_TOO_LONG", undefined].every((c) => line.refusalKind(c) === "refused"), "refusalKind");
  assert(limits.castBytes("é") === 2 && limits.castBytes("🙂") === 4 && limits.FC_CAST_MAX_BYTES === 320, "bytes");
  assert(fd.parseExpectation({ to: "farcaster", personaId: "", fid: -1 })?.personaId === null && fd.parseExpectation({ to: "nowhere" }) === null && fd.parseExpectation("x") === null, "parseExpectation");
});

await check("U47. The UI wiring a node harness cannot render: the Composer sends its line and re-asks on focus / visibilitychange and holds Post over 320 bytes; the card sends actingPersonaId and waits for one answer per button; Act as… renders the route's sentence; the settings index links /settings/connect on the owner service under the name the door's refusal uses", async () => {
  const { readFileSync } = await import("node:fs");
  const src = (f) => readFileSync(path.join(ROOT_N, f), "utf8");
  const composer = src("components/Composer.tsx");
  for (const needle of ["expect: expectationFrom(where)", 'window.addEventListener("focus"', '"visibilitychange"', 'j?.code === "FC_DELIVERY_CHANGED"', "refusalKind(j?.code)"]) assert(composer.includes(needle), "Composer lacks " + needle);
  // the Post button itself holds over 320 bytes (PERSONA LAUNCH wave 3, final verify: P8 added "|| xHold" after it, so the
  // old needle "|| overLimit}" stopped matching; this reads the Post button's own disabled expression, which is stricter)
  const submitBtn = composer.slice(composer.indexOf('data-testid="composer-submit"'), composer.indexOf('data-testid="composer-submit"') + 400);
  assert(composer.includes('data-testid="composer-submit"') && /disabled=\{[^}]*\|\| overLimit(?: \|\||\})/.test(submitBtn), "Composer's Post button is not held by overLimit");
  const card = src("components/CastCard.tsx");
  for (const needle of ["authorFid: typeof cast.author?.fid === \"number\" ? cast.author.fid : null, actingPersonaId }", "targetHandle: username, actingPersonaId }", "if (inflight.current.like) return;", "if (inflight.current.recast) return;", 'j?.code === "FC_PERSONA_CHANGED"']) assert(card.includes(needle), "CastCard lacks " + needle);
  const picker = src("components/ActAsPicker.tsx");
  assert(picker.includes("actAsOutcome(res.ok, j,") && !picker.includes("Posted as @{chosen?.handle}."), "ActAsPicker still prints the fixed line");
  const settings = src("app/(main)/settings/page.tsx");
  assert(settings.includes('href="/settings/connect"') && settings.includes('data-testid="settings-link-connect"') && settings.includes("Connect your Farcaster account"), "no owner-only connect row");
  assert(src("lib/fc/writes.ts").includes("Settings › Connect your Farcaster account") && !src("lib/fc/writes.ts").includes("Settings > Connect"), "the door's refusal names another place");
});

ownerEnv();
console.log(`\n${passed} passed, ${failed} failed${failed ? " — " + failures.join("; ") : ""}`);
if (MUT) {
  // a mutation run PASSES when every expected check went red
  const expect = MUTATIONS[MUT].expect;
  const caught = expect.filter((id) => failures.some((f) => f.startsWith(id + ".")));
  const missed = expect.filter((id) => !caught.includes(id));
  console.log(missed.length ? `MUTATION ${MUT} NOT CAUGHT by ${missed.join(", ")} — those checks are vacuous` : `MUTATION ${MUT} caught by ${caught.join(", ")}`);
  process.exitCode = missed.length ? 1 : 0;
} else {
  process.exitCode = failed ? 1 : 0;
}
