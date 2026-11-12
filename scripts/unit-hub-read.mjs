// FOLLOWING FROM THE HUB — the browser device's Neynar-free reads of the signed-in root's Farcaster graph, IN ONE
// PROCESS, with nothing real: lib/fc/hubRead/{read,copy}.ts and app/api/fc/hub/route.ts bundled with esbuild and run as a
// device (the runtime seam), against scripts/lib/farcaster-protocol-stub.mjs on loopback (a Snapchain node with the real
// node's JSON shapes, paging, CORS and OPTIONS-404, plus planted graphs and steering). Post as you
// (lib/fc/rootSigner/flow.ts) runs for real for H10: the root's key sealed in a temporary vault, its cast signed in the
// "tab" and relayed through a loopback stand-in of the validator's thin relay to the stub node. No request leaves the
// machine.
//
//   H1  every read is a plain GET to the configured node (no custom header, no cookie, no referrer: never preflighted);
//       a misconfigured node URL refuses with zero requests; no server answers the route (404 device_only, body unread)
//   H2  follows: paged 1,000 at a time (2,345 follows = 3 reads), the count, self-follows dropped, most recent first
//   H3  ORDER: the timeline is the ground truth's reverse-chronological order, exactly, for 50 and then 150 items, with a
//       prolific account (30 casts in the last hour) and a cast dated 40 years ahead (left out, counted)
//   H4  FAN-OUT CAP and CONCURRENCY: 1,500 follows → exactly the root + the 1,000 most recently followed are read, never
//       more than 8 requests in flight (and more than 1: it is parallel), a bounded request count, the page says so
//   H5  PROGRESSIVE: an early answer is loading, shows what is in (in order, all of it true) and keeps filling
//   H6  NEVER FAIL OPEN: a failed follows read is an ERROR (never "you follow nobody"), so is a timeline whose every read
//       failed (never "no posts"); some accounts failing is counted on the page; Retry recovers each
//   H7  TRUE EMPTIES only after reads that succeeded: follows nobody; follows accounts with no posts
//   H8  429: the node's Retry-After pauses every read (none goes out during it), the page says so, nothing marked failed
//   H9  INCREMENTAL REFRESH: only the accounts due on their own clock are re-read; a new cast shows on top, a deleted one goes
//   H10 POST AS YOU: the root's own cast (posted through the real flow) shows in Following at once and stays after the
//       node re-read; a delete removes it at once
//   H11 THREADS by protocol id (fid + hash): ancestors oldest first, the cast, its replies; the node's NotFound is "not on
//       the network", a failure is an error (never "not found"); a failed ancestor / replies read is said, the cast shows
//   H12 profiles: the profile op; a failed profile shows the account's number and is counted; mentions at their byte
//       positions; url, image and quote embeds
//   H13 shapes: a record under another fid is dropped; no fabricated counts; the read-only marks; the identifier-free hrefs
//   H14 identity: another root never sees the previous root's graph; resetHubReads drops everything
//   H15 PERSONA SEPARATION: no read names an own persona; nothing is read while a persona acts
//   H16 POST AS YOU ON HUB CARDS, the pressed state: the root's reactions are TWO plain GETs naming the root only
//       (Snapchain's Like / Recast names, one page of 200 each, cached); a like made through the real flow is pressed at
//       once; past the page a card older than the oldest reaction read is "unknown", never "not liked"; a failed read is
//       unknown too; another account's reaction in the answer is dropped; nothing is read while a persona acts; a card by
//       an own persona is marked (its writes stay off)
//   H17 YOUR MODE ON FOLLOWING (spec A, lib/fc/hubRead/mode.ts through the engine): a mode's rules hide and push down
//       Farcaster posts exactly as the evaluator decides a sample post with the same fields (a muted word in any case,
//       links only, push-down, hide replies); never-miss pins one post per account (a quarter of the page at most),
//       quiet sinks, banner strips (by fragment addresses); weights that need counts are SAID and move nothing; a
//       lens's reading length re-ranks; an author-tier rule hides every post; "Your mode hid all N posts" (never "No
//       posts yet"); a mode that cannot be read shows nothing; no mode causes a node read or shows a post past the page;
//       nothing while a persona acts, even one chosen while the mode was being read
//   H18 THE MODE LOADER (lib/fc/hubRead/modeSource.ts, its stores stood in for, the real delivery tiers): keyed as the
//       mode routes key it; refuses an unresolvable or malformed rule and an unreadable mode; tiers by fc:<fid> only;
//       an unreadable tier map is said; a lens gone missing and a pack about Totem accounts are said
//   H19 READWISE ON HUB POSTS (spec C, lib/fc/hubRead/extras.ts through the engine, the REAL readwise state over the stub
//       validator and the real readwise route): a long cast (the slider's shortest piece, 80 words) or one with a link is
//       a piece, a picture or a quote is not; dwell goes into the SEALED record (nothing in the clear, no request) and
//       crosses the length-scaled threshold; an unfinished piece off the page is requeued through the one queue (the
//       mode's cadence knob caps it, a priority folder first, a finished one never); the bin and Restore; the mode's hide
//       holds; nothing written while a persona acts; a cast not held is unknown; an unreadable state is said; 0 node reads
//   H20 DESK NOTES ON HUB POSTS (spec C): a subscribed desk's note shows on its (fid, hash) on the page; a noted post you
//       liked or recast, off the page, resurfaces through the queue; not one you never liked, not one never read, not
//       while your reactions are unread, not one the mode hides; desk actions and an unreadable desk list said; 0 reads
//   H21 CLOSE-FRIEND SENDS THROUGH A RING (spec C, the REAL envelope, outbound send and member inbox): refused while a
//       persona acts and for an own persona's post (nothing written); ids only, under the share-as name; on the page
//       "Sent to you by", off it spliced, one not held said and never read; another author's hash is not it; malformed
//       sends refuse the statement; a send never makes a note stop fitting; three days; one card per post; 0 reads
//   M   MUTATIONS: each guard removed in the BUNDLE ONLY, and the check that covers it must then FAIL
//
//   node scripts/unit-hub-read.mjs            (npm run test:hub-read-unit)
//   node scripts/unit-hub-read.mjs --only=H3
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SELF = fileURLToPath(import.meta.url);
const require = createRequire(path.join(ROOT, "package.json"));
const { build } = require("esbuild");
const ONLY = (process.argv.find((a) => a.startsWith("--only=")) || "").slice("--only=".length).split(",").filter(Boolean);
const want = (id) => ONLY.length === 0 || ONLY.includes(id);
const MUTATIONS = process.env.HUBREAD_MUTATION ? JSON.parse(process.env.HUBREAD_MUTATION) : [];
const QUIET = process.env.HUBREAD_UNIT_QUIET === "1";

let passed = 0;
let failed = 0;
const failedIds = [];
const out = (l) => (QUIET ? undefined : console.log(l));
async function check(id, name, fn) {
  if (!want(id)) return;
  try {
    const extra = await fn();
    passed++;
    out(`  PASS  ${id} ${name}${typeof extra === "string" ? " — " + extra : ""}`);
  } catch (e) {
    failed++;
    failedIds.push(id);
    out(`  FAIL  ${id} ${name} — ${e && e.message ? e.message : String(e)}`);
  }
}
const assert = (c, m) => {
  if (!c) throw new Error(m);
};

// ---------------------------------------------------------------------------------------------------- the bundle
const tmp = mkdtempSync(path.join(os.tmpdir(), "layers-hubread-unit-"));
process.env.KEYSTORE_DIR = path.join(tmp, "keystore");
const S = (n) => path.join(tmp, n);
const stubs = {
  "server-only.ts": "export {};\n",
  "next-server.ts": `export class NextResponse {
  status: number; body: unknown; headers: Record<string, string>;
  constructor(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) { this.status = init.status ?? 200; this.body = body; this.headers = init.headers ?? {}; }
  static json(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) { return new NextResponse(body, init); }
}
export class NextRequest {
  nextUrl: URL; method: string; private raw: string | undefined; readCount = 0;
  constructor(url: string, init: { method?: string; body?: string } = {}) { this.nextUrl = new URL(url); this.method = init.method ?? "GET"; this.raw = init.body; }
  async json() { this.readCount++; return JSON.parse(this.raw ?? ""); }
  async text() { this.readCount++; return this.raw ?? ""; }
}
`,
  "persist.ts": `export const validatorStore = new Map<string, Record<string, unknown>>();
export const persistCtl = { fail: false };
export async function fetchState(ns: string): Promise<{ status: number; ok: boolean; json: () => Promise<any> }> {
  if (persistCtl.fail) return { status: 503, ok: false, json: async () => ({ error: "down" }) };
  const entries = validatorStore.get(ns);
  if (!entries) return { status: 200, ok: true, json: async () => ({ entries: {} }) };
  return { status: 200, ok: true, json: async () => ({ entries: JSON.parse(JSON.stringify(entries)) }) };
}
export async function flushVault(ns: string, entries: Record<string, unknown>): Promise<void> { validatorStore.set(ns, JSON.parse(JSON.stringify(entries))); }
export async function flush(ns: string, entries: Record<string, unknown>): Promise<void> { return flushVault(ns, entries); }
export async function signedWriteHeaders(): Promise<Record<string, string>> { return {}; }
export function sealedNamespaces(): Set<string> { return new Set(); }
export function resetEnvelopeBootstrap(): void {}
// SPEC C (H21): the rings document reads through these; no whole-state hydrate copy here. The rest of the real module's
// exports, inert, so a module the rings code reaches transitively still bundles (none of them is called by a check)
export function hydratedNamespace(_ns: string): Record<string, unknown> | null | undefined { return undefined; }
export function hydratedNamespaceAt(_ns: string): number | undefined { return undefined; }
export function forgetHydratedNamespace(_ns: string): void {}
export async function deviceSignedWriteHeaders(): Promise<Record<string, string>> { return {}; }
export async function signedReadHeaders(): Promise<Record<string, string>> { return {}; }
export function markSealedName(_ns: string): void {}
export const STATE_BODY_LIMIT_BYTES = 262144;
export const FLUSH_RETRY_MS = [250, 500, 1000];
export class PersistError extends Error {}
export async function enrollWithSeed(): Promise<string> { throw new Error("not in the unit harness"); }
export async function loadAll(): Promise<Record<string, Record<string, unknown>>> { return {}; }
export async function loadAllStrict(): Promise<Record<string, Record<string, unknown>>> { return {}; }
export async function wipeAll(): Promise<void> {}
`,
  // PERSONA SEPARATION: the vault and the jar are the device's; every check injects own/acting through the runtime seam.
  // SPEC C (H21): the ring send's own guard reads them directly, so they are steerable here
  "separation.ts": `export const sepCtl = { acting: false, own: new Set<number>(), fail: false };
export async function ownPersonaAccounts() { if (sepCtl.fail) throw new Error("vault unreadable"); return { fids: new Set<number>(sepCtl.own), names: new Map<number, string | null>() }; }
export async function personaActing() { return sepCtl.acting; }
export async function rootActs() { return !sepCtl.acting; }
`,
  // SPEC C (H20): the desks the root subscribes to, stood in for (subscribedAnnotations hands over VALID annotations only;
  // its threshold and signatures are lib/curators/annotations.ts's own, pinned by its own suites)
  "annotations.ts": `export const annCtl = { list: [] as any[], fail: false, asked: [] as string[] };
export function subscribedAnnotations(viewer: string) { annCtl.asked.push(viewer); if (annCtl.fail) throw new Error("the desk store is unreadable"); return annCtl.list; }
`,
  // SPEC A (H18): the mode loader's own inputs, stood in for (the mode store, the acting identity, lenses and packs);
  // the delivery tiers are the REAL module over the stub validator above
  "active-persona.ts": `export const personaCtl = { id: "pub_self_unit", calls: 0 };
export function activeSeedPersonaId(): string { personaCtl.calls++; return personaCtl.id; }
`,
  "registry.ts": `export const modeCtl = { modes: new Map<string, any>(), active: new Map<string, string>(), rules: new Map<string, any>(), failActive: false, asked: [] as string[] };
export const folderCtl = { folders: [] as any[], fail: false, asked: [] as string[] };
export const adapters = {
  mode: { async getActive(personaId: string) { modeCtl.asked.push(personaId); if (modeCtl.failActive) throw new Error("mode store unreadable"); const m = modeCtl.modes.get(modeCtl.active.get(personaId) ?? ""); if (!m) throw new Error("no mode"); return m; } },
  rules: { async get(id: string) { return modeCtl.rules.get(id) ?? null; } },
  // SPEC C (H19): the folders the priority weight reads, and no sample readwise schedules
  space: { async listFolders(viewer: string) { folderCtl.asked.push(viewer); if (folderCtl.fail) throw new Error("folders unreadable"); return folderCtl.folders; } },
  feedHealth: { async getReadwiseSchedules() { return []; } },
};
`,
  "lens-service.ts": `export const lensCtl = { lenses: new Map<string, any>() };
export function getLens(id: string) { return lensCtl.lenses.get(id) ?? null; }
export function lensForMode(mode: any) {
  if (mode?.lens && lensCtl.lenses.has(mode.lens)) { const l = lensCtl.lenses.get(mode.lens); return { id: l.id, spec: l.spec, source: "mode" }; }
  return { id: "lens_canonical", spec: null, source: "canonical" };
}
`,
  "packs-service.ts": `export const packCtl = { packs: new Map<string, any>() };
export function packsForMode(ids: string[] | undefined) { return (ids ?? []).map((id) => packCtl.packs.get(id)).filter(Boolean); }
`,
  "entry.ts": `export * as read from "@/lib/fc/hubRead/read";
export * as copy from "@/lib/fc/hubRead/copy";
export * as mode from "@/lib/fc/hubRead/mode";
export * as modeSource from "@/lib/fc/hubRead/modeSource";
export * as evaluate from "@/lib/rules/evaluate";
export * as tiers from "@/lib/delivery/tiers";
export * as lensTypes from "@/lib/lens/types";
export * as persistStub from "@/lib/adapters/mock/persist";
export * as personaStub from "@/lib/activePersona";
export * as registryStub from "@/lib/adapters/registry";
export * as lensStub from "@/lib/lens/service";
export * as packStub from "@/lib/packs/service";
export * as route from "@/app/api/fc/hub/route";
export * as flow from "@/lib/fc/rootSigner/flow";
export * as store from "@/lib/fc/rootSigner/store";
export * as links from "@/lib/fc/siwf/links";
export * as nextStub from "next/server";
export * as extras from "@/lib/fc/hubRead/extras";
export * as extrasSource from "@/lib/fc/hubRead/extrasSource";
export * as readwiseState from "@/lib/readwise/state";
export * as readwiseRoute from "@/app/api/readwise/route";
export * as envelope from "@/lib/rings/envelope";
export * as received from "@/lib/rings/received";
export * as ringsOut from "@/lib/rings/outbound";
export * as ringsModel from "@/lib/rings/model";
export * as annStub from "@/lib/curators/annotations";
export * as sepStub from "@/lib/fc/hubRead/separation";
`,
};
for (const [n, src] of Object.entries(stubs)) writeFileSync(S(n), src);
const applied = new Set();
const mutatePlugin = {
  name: "mutate",
  setup(b) {
    if (!MUTATIONS.length) return;
    b.onLoad({ filter: /\.(ts|tsx)$/ }, (args) => {
      const rel = args.path.split(path.sep).join("/");
      const mine = MUTATIONS.filter((m) => rel.endsWith(m.file));
      if (!mine.length) return undefined;
      let src = readFileSync(args.path, "utf8").replace(/\r\n/g, "\n");
      for (const m of mine) {
        if (!src.includes(m.find)) throw new Error("MUTATION ANCHOR NOT FOUND in " + m.file + ": " + m.find.slice(0, 80));
        src = src.replace(m.find, m.replace);
        applied.add(m);
      }
      return { contents: src, loader: "ts", resolveDir: path.dirname(args.path) };
    });
  },
};
let M;
try {
  const outFile = S("bundle.mjs");
  await build({
    plugins: [mutatePlugin],
    absWorkingDir: ROOT,
    entryPoints: [S("entry.ts")],
    outfile: outFile,
    bundle: true,
    format: "esm",
    platform: "node",
    target: ["node20"],
    tsconfig: path.join(ROOT, "tsconfig.json"),
    logLevel: "error",
    nodePaths: [path.join(ROOT, "node_modules")],
    banner: { js: 'import { createRequire as __cr } from "node:module"; const require = __cr(import.meta.url);' },
    alias: {
      "server-only": S("server-only.ts"),
      "next/server": S("next-server.ts"),
      "@/lib/adapters/mock/persist": S("persist.ts"),
      "@/lib/fc/hubRead/separation": S("separation.ts"),
      "@/lib/activePersona": S("active-persona.ts"),
      "@/lib/adapters/registry": S("registry.ts"),
      "@/lib/lens/service": S("lens-service.ts"),
      "@/lib/packs/service": S("packs-service.ts"),
      "@/lib/curators/annotations": S("annotations.ts"),
    },
  });
  M = await import(pathToFileURL(outFile).href);
  if (MUTATIONS.length && applied.size !== MUTATIONS.length) throw new Error("MUTATION FILE NOT IN THE BUNDLE");
} catch (e) {
  console.log("cannot bundle the hub-read modules: " + (e && e.message ? e.message.split("\n").slice(0, 3).join(" | ") : String(e)));
  rmSync(tmp, { recursive: true, force: true });
  process.exit(2);
}
const { read, copy, route, flow, store, links, nextStub, mode: hubMode, modeSource, evaluate, tiers, lensTypes, persistStub, personaStub, registryStub, lensStub, packStub } = M;
const { extras: hubExtras, extrasSource, readwiseState, readwiseRoute, envelope, received, ringsOut, ringsModel, annStub, sepStub } = M;
const L = read.HUB_READ_LIMITS;

// ---------------------------------------------------------------------------------------------------- the network
const { startProtocolStub, decodeProto } = await import(pathToFileURL(path.join(ROOT, "scripts", "lib", "farcaster-protocol-stub.mjs")).href);
const hub = await startProtocolStub({ firstFid: 991500 });
// a loopback stand-in for the validator's thin relay (validator/keyrequest.js POST /fc/hub/submit): bytes in, the node's
// answer out (H10 posts through the REAL post-as-you flow)
const relay = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const bytes = Buffer.concat(chunks);
  const r = await fetch(hub.hubUrl + "/v1/submitMessage", { method: "POST", headers: { "content-type": "application/octet-stream" }, body: bytes });
  const j = await r.json().catch(() => null);
  res.writeHead(r.status === 200 ? 200 : 502, { "content-type": "application/json" });
  res.end(JSON.stringify(r.status === 200 ? { ok: true, hash: j.hash } : { error: "Farcaster's node refused it: " + (j && j.error_detail ? j.error_detail : "") }));
});
await new Promise((r) => relay.listen(0, "127.0.0.1", r));
const RELAY = "http://127.0.0.1:" + relay.address().port;

// every request the "tab" makes, recorded; `rewrite` lets a check doctor an answer (H13)
const seen = [];
let rewrite = null;
let skew = 0;
const tabFetch = async (url, init = {}) => {
  const u = String(url);
  seen.push({ url: u, method: init.method ?? "GET", credentials: init.credentials, referrerPolicy: init.referrerPolicy, headers: init.headers ?? null, at: Date.now() });
  const res = await fetch(url, init);
  if (rewrite) {
    const r = await rewrite(u, res);
    if (r) return r;
  }
  return res;
};
let acct = null;
const ENV = { FC_ROOT_HUB_URL: hub.hubUrl };
const useRoot = (fid, fname = null) => {
  acct = fid ? { fid, fname } : null;
};
const fresh = (env = ENV) => {
  read.resetHubReads();
  hub.clearHubSteering();
  hub.resetHubReads();
  seen.length = 0;
  rewrite = null;
  skew = 0;
  read.__setHubReadRuntimeForTests({ device: true, env, fetch: tabFetch, now: () => Date.now() + skew, account: async () => acct });
};
fresh();
const errOf = async (p) => {
  try {
    await p;
    return null;
  } catch (e) {
    return e;
  }
};
/** ask until the timeline settles (the island's loop) */
async function settle(opts = {}, tries = 60) {
  let v = null;
  for (let i = 0; i < tries; i++) {
    v = await read.hubTimeline({ waitMs: 2000, ...opts });
    if (v.state !== "loading") return v;
  }
  throw new Error("the timeline never settled: " + JSON.stringify({ state: v?.state, progress: v?.progress, items: v?.items?.length }));
}
const reads = (p) => hub.hubRead.reads.filter((r) => !p || r.path === p);
const hashes = (v) => v.items.map((c) => c.hash);
const firstDiff = (a, b) => {
  for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) return i;
  return -1;
};

out("\nHUB READ UNIT — the device's Neynar-free Following, against a loopback Snapchain stub" + (MUTATIONS.length ? "  [MUTATED BUNDLE]" : ""));

await check("H1", "every read is a plain GET to the configured node (no custom header, no cookie, no referrer); misconfigured refuses with zero requests; no server answers the route", async () => {
  fresh();
  hub.plantFollows(100, [{ fid: 101, ts: Date.now() - 3000 }, { fid: 102, ts: Date.now() - 2000 }, { fid: 100, ts: Date.now() - 1000 }]);
  useRoot(100, "hundred");
  const c = await read.hubFollowsCount();
  assert(c.count === 2 && c.account.fid === 100, "the count: " + JSON.stringify(c));
  assert(seen.length >= 1, "no request was made");
  for (const r of seen) {
    assert(r.url.startsWith(hub.hubUrl + "/v1/"), "a request went elsewhere: " + r.url);
    assert(r.method === "GET" && r.credentials === "omit" && r.referrerPolicy === "no-referrer" && r.headers === null, "not a plain GET: " + JSON.stringify(r));
  }
  assert(hub.hubRead.preflights === 0, "a preflight reached the node");
  const plain = seen.length;
  for (const bad of [{ FC_ROOT_HUB_URL: "https://evil.example/path?key=1" }, { FC_ROOT_HUB_URL: "ftp://x" }, { FC_ROOT_HUB_URL: hub.hubUrl, FC_ROOT_POST: "bad_config" }]) {
    fresh(bad);
    const e = await errOf(read.hubTimeline());
    assert(e && e.code === "bad_config" && e.status === 503 && seen.length === 0, "a misconfigured node was read or not refused: " + JSON.stringify(bad) + " " + (e ? e.code : "no error") + " " + seen.length);
  }
  fresh();
  // the route on a SERVER (no window): 404 device_only, and the body was never read
  const req = new nextStub.NextRequest("http://x/api/fc/hub", { method: "POST", body: JSON.stringify({ op: "people" }) });
  const r = await route.POST(req);
  assert(r.status === 404 && r.body.code === "device_only" && req.readCount === 0, "a server answered or read the body: " + r.status + " read " + req.readCount);
  const g = await route.GET();
  assert(g.status === 404 && g.body.code === "device_only", "GET on a server: " + g.status);
  return plain + " read(s), all plain GETs; 3 misconfigurations refused with 0 requests";
});

await check("H2", "follows: paged 1,000 at a time (2,345 = 3 reads), the count, self-follows dropped, most recently followed first", async () => {
  fresh();
  const now = Date.now();
  hub.plantSynthetic({ root: 110, n: 2345, castsPer: 1, base: 3_000_000, prolific: false, future: false });
  const list = hub.state.links.get(110);
  list.push({ target: 110, ts: list[list.length - 1].ts + 1 }); // a self-follow (the real node holds them: fid 3 follows 3)
  useRoot(110);
  const c = await read.hubFollowsCount();
  assert(c.count === 2345 && c.truncated === false, "count " + c.count);
  const pages = reads("/v1/linksByFid");
  assert(pages.length === 3 && pages.every((r) => r.fid === 110), "linksByFid reads: " + pages.length);
  assert(seen.filter((s) => s.url.includes("linksByFid")).every((s) => /pageSize=1000\b/.test(s.url)), "not 1,000 a page");
  const p = await read.hubPeople({ offset: 0, limit: 50 });
  assert(p.rows.length === 50 && p.rows[0].fid === 3_000_000 + 2344 && p.rows[1].fid === 3_000_000 + 2343 && p.more === true, "people order: " + p.rows.slice(0, 2).map((r) => r.fid));
  assert(p.rows.every((r) => r.profile === "ok" && r.user.username === "acct" + (r.fid - 3_000_000)), "profiles on the page");
  const userReads = reads("/v1/userDataByFid").length;
  assert(userReads === 50, "profiles were read for " + userReads + " accounts (only the page's 50)");
  const p2 = await read.hubPeople({ offset: 50, limit: 50 });
  assert(p2.rows[0].fid === 3_000_000 + 2294 && !p2.rows.some((r) => r.fid === 110), "page 2: " + p2.rows[0].fid);
  void now;
  return "3 follow pages, " + userReads + " profile reads for one page";
});

await check("H3", "ORDER: exactly the ground truth's reverse-chronological order for 50, then 400 items; a prolific account cannot hide a quieter account's newer post; a cast dated 40 years ahead is left out", async () => {
  fresh();
  // 60 accounts with 14 casts each over two weeks (more than one 10-cast page each), and one prolific account
  const syn = hub.plantSynthetic({ root: 200, n: 60, castsPer: 14, base: 3_100_000, seed: 7 });
  useRoot(200);
  const v = await settle({ want: 50 });
  assert(v.state === "ready", "state " + v.state + " " + v.reason);
  const truth = hub.truth(200, { limit: 50 }).map((c) => c.hash);
  const d = firstDiff(hashes(v), truth);
  assert(v.items.length === 50 && d === -1, "the first 50 differ from the truth at " + d + " (got " + v.items.length + ")");
  const futureHash = [...hub.state.castIdx.get(syn.futureFid)].find((h) => hub.state.casts.get(h).ts > Date.now() + 86_400_000);
  assert(futureHash && !hashes(v).includes(futureHash) && v.futureDated >= 1, "the future-dated cast: shown=" + hashes(v).includes(futureHash) + " counted=" + v.futureDated);
  // the prolific account (30 casts in the last hour) holds the horizon at first: its first 10 cannot reach back past an
  // hour, so its next page is read before any older cast of another account is shown. Then 400 items reach back past
  // most accounts' 10th cast: "Show older posts" pages every account at the horizon, step by bounded step
  const v2 = await settle({ want: 400 });
  const truth2 = hub.truth(200, { limit: 400 }).map((c) => c.hash);
  const d2 = firstDiff(hashes(v2), truth2);
  assert(v2.items.length === 400 && d2 === -1, "the first 400 differ from the truth at " + d2 + " (got " + v2.items.length + ")");
  const ts = v2.items.map((c) => c.timestamp);
  assert(ts.every((t, i) => i === 0 || t <= ts[i - 1]), "not newest first");
  const olderReads = seen.filter((s) => s.url.includes("castsByFid") && s.url.includes("pageToken=")).length;
  const olderFids = new Set(seen.filter((s) => s.url.includes("castsByFid") && s.url.includes("pageToken=")).map((s) => new URL(s.url).searchParams.get("fid")));
  assert(olderReads > 1 && olderFids.size > 1, "older pages read: " + olderReads + " from " + olderFids.size + " accounts: the horizon guard did not page the accounts holding it");
  return "50 and 400 match the truth; " + olderReads + " older-page reads from " + olderFids.size + " accounts";
});

await check("H4", "FAN-OUT CAP and CONCURRENCY: 1,500 follows → the root + the 1,000 most recently followed, never more than 8 in flight (and more than 1), a bounded request count, said on the page", async () => {
  fresh();
  hub.plantSynthetic({ root: 300, n: 1500, castsPer: 2, base: 3_200_000, seed: 11, prolific: false, future: false });
  hub.hubRead.delayMs = 4;
  useRoot(300);
  const v = await settle({ want: 50 });
  hub.hubRead.delayMs = 0;
  assert(v.state === "ready", "state " + v.state);
  const castFids = new Set(reads("/v1/castsByFid").map((r) => r.fid));
  assert(castFids.size === 1001 && castFids.has(300), "accounts read: " + castFids.size);
  const outside = [...castFids].filter((f) => f !== 300 && f < 3_200_000 + 500);
  assert(outside.length === 0, outside.length + " accounts outside the 1,000 most recently followed were read");
  assert(v.capped && v.capped.reading === 1000 && v.capped.of === 1500, "capped: " + JSON.stringify(v.capped));
  assert(v.progress.accounts === 1001 && v.progress.read === 1001, "progress " + JSON.stringify(v.progress));
  const max = hub.hubRead.maxInFlight;
  assert(max <= L.concurrency && max >= 2, "in flight at once: " + max);
  const total = hub.hubRead.reads.length;
  const profiles = reads("/v1/userDataByFid").length;
  assert(profiles <= 200, profiles + " profile reads (only what is on screen)");
  assert(total <= 2 + 1001 * 2 + 200 + L.extendBudget + L.quoteBudget, "requests " + total);
  return `${castFids.size} accounts read, ${max} in flight at most, ${total} requests (${profiles} profiles)`;
});

await check("H5", "PROGRESSIVE: an early answer is loading, shows what is in (in order, all true) and keeps filling; nothing on screen blinks out while it fills, even when a prolific account read last moves the horizon", async () => {
  fresh();
  // the prolific account (30 posts in the last hour) is the one followed longest ago, so it is read LAST: when it lands it
  // moves the horizon up, which is exactly when a naive window would drop posts it had already shown
  hub.plantSynthetic({ root: 400, n: 200, castsPer: 3, base: 3_300_000, seed: 13, prolific: true, future: false });
  hub.hubRead.delayMs = 25;
  useRoot(400);
  const early = await read.hubTimeline({ want: 50, waitMs: 400 });
  assert(early.state === "loading" && early.loading === true, "the early answer: " + early.state);
  assert(early.follows.count === 200 && early.progress.read < 201, "progress: " + JSON.stringify(early.progress) + " follows " + early.follows.count);
  assert(early.items.length > 0, "nothing shown while filling");
  const ts = early.items.map((c) => c.timestamp);
  assert(ts.every((t, i) => i === 0 || t <= ts[i - 1]), "an early answer out of order");
  const all = new Set(hub.truth(400, { limit: 10_000 }).map((c) => c.hash));
  assert(early.items.every((c) => all.has(c.hash)), "an early item that is not a real cast");
  // ask as fast as the island could, until it settles: a post shown in one answer must be in the next, unless the next
  // window is full of newer posts (pushed down, not blinked out)
  const key = (c) => [c.timestamp, c.hash];
  const older = (a, b) => a[0] < b[0] || (a[0] === b[0] && a[1] < b[1]);
  let prev = early;
  let answers = 1;
  let blinks = [];
  let done = null;
  for (let i = 0; i < 4000 && !done; i++) {
    const v = await read.hubTimeline({ want: 50, waitMs: 0 });
    answers++;
    const now = new Set(hashes(v));
    const last = v.items.length ? key(v.items[v.items.length - 1]) : null;
    for (const c of prev.items) {
      if (now.has(c.hash)) continue;
      const pushed = v.items.length >= 50 && last && older(key(c), last);
      if (!pushed) blinks.push(c.hash.slice(0, 10) + " (" + prev.items.length + "→" + v.items.length + " items)");
    }
    prev = v;
    if (v.state !== "loading") done = v;
    else await new Promise((r) => setTimeout(r, 4));
  }
  hub.hubRead.delayMs = 0;
  assert(done, "never settled");
  assert(blinks.length === 0, blinks.length + " post(s) blinked out while filling, e.g. " + blinks.slice(0, 3).join(", "));
  assert(done.state === "ready" && firstDiff(hashes(done), hub.truth(400, { limit: 50 }).map((c) => c.hash)) === -1, "the settled answer is not the truth");
  return `early: ${early.items.length} items from ${early.progress.read}/${early.progress.accounts} accounts; ${answers} answers, nothing blinked out; settled: the truth`;
});

await check("H6", "NEVER FAIL OPEN: a failed follows read is an ERROR, not 'you follow nobody'; every read failing is an ERROR, not 'no posts'; some failing is counted; Retry recovers", async () => {
  // (a) the follows
  fresh();
  hub.plantSynthetic({ root: 500, n: 12, castsPer: 2, base: 3_400_000, prolific: false, future: false });
  hub.hubRead.fails.push({ path: "/v1/linksByFid", fid: 500, status: 500, n: 1e9 });
  useRoot(500);
  const a = await settle();
  assert(a.state === "error" && a.code === "follows_unreadable" && a.items.length === 0 && a.followsNone === false && a.noPosts === false && /not an empty list/.test(a.reason), "a failed follows read: " + JSON.stringify({ state: a.state, code: a.code, followsNone: a.followsNone }));
  const ce = await errOf(read.hubFollowsCount());
  assert(ce && ce.code === "follows_unreadable" && ce.status === 503, "the count: " + (ce ? ce.code : "no error"));
  hub.clearHubSteering();
  const a2 = await settle({ retry: true });
  assert(a2.state === "ready" && a2.items.length > 0 && a2.follows.count === 12, "Retry did not recover: " + a2.state);
  // (b) every cast read failing
  fresh();
  hub.plantSynthetic({ root: 510, n: 8, castsPer: 2, base: 3_410_000, prolific: false, future: false });
  hub.hubRead.fails.push({ path: "/v1/castsByFid", fid: "*", status: 503, n: 1e9 });
  useRoot(510);
  const b = await settle();
  assert(b.state === "error" && b.code === "casts_unreadable" && b.noPosts === false && b.items.length === 0, "every read failing: " + JSON.stringify({ state: b.state, code: b.code, noPosts: b.noPosts }));
  // (c) some accounts failing
  fresh();
  hub.plantSynthetic({ root: 520, n: 20, castsPer: 2, base: 3_420_000, prolific: false, future: false });
  for (const f of [3_420_003, 3_420_007, 3_420_011]) hub.hubRead.fails.push({ path: "/v1/castsByFid", fid: f, status: 500, n: 1e9 });
  useRoot(520);
  const c = await settle({ want: 100 });
  assert(c.state === "ready" && c.partial && c.partial.failed === 3 && /3 of 21 accounts/.test(c.partial.sentence), "partial: " + JSON.stringify(c.partial));
  const missing = c.items.filter((x) => [3_420_003, 3_420_007, 3_420_011].includes(x.author.fid)).length;
  assert(missing === 0, "a failed account's posts appeared");
  hub.clearHubSteering();
  const c2 = await settle({ want: 100, retry: true });
  assert(c2.partial === null && c2.items.some((x) => x.author.fid === 3_420_007), "Retry: " + JSON.stringify(c2.partial));
  return "follows error, all-failed error, 3 of 21 counted, all recovered";
});

await check("H7", "TRUE EMPTIES only after reads that succeeded: follows nobody; follows accounts with no posts", async () => {
  fresh();
  hub.plantFollows(600, []);
  useRoot(600);
  const a = await settle();
  assert(a.state === "ready" && a.followsNone === true && a.code === null && a.follows.count === 0, "follows nobody: " + JSON.stringify({ state: a.state, followsNone: a.followsNone }));
  assert(copy.followsCountSentence(0, false) === "You don't follow anyone on Farcaster yet.", "the sentence");
  fresh();
  hub.plantFollows(610, [601, 602, 603].map((f, i) => ({ fid: f, ts: Date.now() - i * 1000 })));
  useRoot(610);
  const b = await settle();
  assert(b.state === "ready" && b.noPosts === true && b.followsNone === false && b.items.length === 0 && b.partial === null, "no posts: " + JSON.stringify({ state: b.state, noPosts: b.noPosts }));
});

await check("H8", "429: the node's Retry-After pauses every read (none goes out during it), the page says so, nothing is marked failed", async () => {
  fresh();
  hub.plantSynthetic({ root: 700, n: 30, castsPer: 2, base: 3_500_000, prolific: false, future: false });
  useRoot(700);
  await read.hubFollowsCount();
  hub.hubRead.rate = { n: 2, retryAfter: 2 };
  const early = await read.hubTimeline({ waitMs: 600 });
  assert(early.paused && /slow down/.test(early.paused.sentence), "no paused line: " + JSON.stringify(early.paused));
  const v = await settle();
  assert(v.state === "ready" && v.partial === null && v.progress.read === 31, "after the pause: " + JSON.stringify({ state: v.state, partial: v.partial, progress: v.progress }));
  // the reads already on the wire when the 429 came back land within a few ms of it; after that, NOTHING until the pause
  // (Retry-After 2 s) is over
  const r = hub.hubRead.reads;
  const lastRefused = r.map((x) => x.status).lastIndexOf(429);
  assert(lastRefused >= 0, "the stub never answered 429");
  const t = r[lastRefused].at;
  const during = r.filter((x) => x.at > t + 300 && x.at < t + 1500).length;
  const resumed = r.find((x) => x.at >= t + 1500);
  assert(during === 0 && resumed, during + " read(s) went out during the pause; resumed: " + !!resumed);
  return "nothing during the pause; resumed " + (resumed.at - t) + " ms after the 429 (Retry-After 2 s)";
});

await check("H9", "INCREMENTAL REFRESH: only the accounts due on their own clock are re-read; a new cast shows on top; a deleted one goes", async () => {
  fresh();
  const syn = hub.plantSynthetic({ root: 800, n: 30, castsPer: 4, base: 3_600_000, seed: 21, future: false });
  useRoot(800);
  await settle();
  hub.resetHubReads();
  const none = await settle({ refresh: "auto" });
  assert(reads("/v1/castsByFid").length === 0, "an auto refresh right after reading re-read " + reads("/v1/castsByFid").length + " accounts");
  skew = 15 * 60_000; // a quarter of an hour on: the prolific account (posted in the last hour) is due, quiet ones are not
  const newHash = hub.plantCast({ fid: syn.prolificFid, ts: Date.now() - (Date.now() % 1000), text: "a brand new cast", seed: "h9:new" });
  const after = await settle({ refresh: "auto" });
  const reread = new Set(reads("/v1/castsByFid").map((r) => r.fid));
  assert(reread.has(syn.prolificFid) && reread.size < 31 && reread.size > 0, "re-read " + reread.size + " accounts (prolific due: " + reread.has(syn.prolificFid) + ")");
  assert(after.items[0].hash === newHash, "the new cast is not on top: " + after.items[0].text);
  // delete it on the node: the next re-read of that account drops it
  hub.removeCast(newHash);
  skew += 5 * 60_000;
  const gone = await settle({ refresh: "auto" });
  assert(!hashes(gone).includes(newHash), "a deleted cast stayed");
  void none;
  return `${reread.size} of 31 accounts re-read after 15 minutes`;
});

await check("H10", "POST AS YOU: the root's own cast, posted through the real flow, shows in Following at once and stays after the node re-read; a delete removes it at once", async () => {
  fresh();
  const FID = 990777;
  hub.plantFollows(FID, [{ fid: 3_700_000, ts: Date.now() - 5000 }]);
  hub.plantProfile(FID, { username: "stubalice", display: "Stub Alice (on the node)" });
  hub.plantProfile(3_700_000, { username: "friend", display: "Friend" });
  hub.plantCast({ fid: 3_700_000, ts: Date.now() - 3_600_000 - ((Date.now() - 3_600_000) % 1000), text: "an older post", seed: "h10:1" });
  // the root signed in (the sealed accountLinks record) with an ACTIVE posting key the node lists
  links.resetAccountLinksCache();
  await links.updateAccountLinks(() => ({ v: 1, links: [{ kind: "farcaster", fid: FID, fname: "stubalice", displayName: "Stub Alice", pfpUrl: null, bio: null, personaId: "p_unit_self", authMethod: "custody", signer: "0x" + "ab".repeat(20), nonceHash: "00".repeat(32), messageHash: "11".repeat(32), verifiedAt: Date.now(), verifier: { rpcHost: "stub" }, disconnectedAt: null }] }));
  const pair = store.newRootKeyPair();
  await store.updateRootSigner((doc) => ({ ...doc, signer: { fid: FID, priv: pair.priv, key: pair.key, appFid: 990900, state: "active", token: null, deeplinkUrl: null, deadline: 0, createdAt: Date.now(), activatedAt: Date.now() } }));
  hub.seedAccount(FID, "0x" + FID.toString(16).padStart(40, "0"), pair.key);
  flow.__setRootPostRuntimeForTests({ device: true, env: { VALIDATOR_URL: RELAY, FC_ROOT_HUB_URL: hub.hubUrl }, fetch, now: () => Date.now() });
  // the hub read uses the REAL Sign in with Farcaster link here (no injected account)
  read.__setHubReadRuntimeForTests({ device: true, env: ENV, fetch: tabFetch, now: () => Date.now() + skew, account: undefined });
  const before = await settle();
  assert(before.account && before.account.fid === FID && before.items.length === 1, "before: " + JSON.stringify({ acct: before.account, n: before.items.length }));
  hub.resetHubReads();
  const posted = await flow.castAsRoot("hello from my own account");
  const at = await read.hubTimeline({ waitMs: 0 });
  assert(at.items[0] && at.items[0].hash === posted.hash && at.items[0].author.fid === FID, "not on top at once: " + (at.items[0] ? at.items[0].text : "nothing"));
  // at once, before the node's profile is read, the card names the root from its own sign-in, never a bare number
  assert(at.items[0].author.username === "stubalice" && at.items[0].author.displayName === "Stub Alice", "the root at once: " + JSON.stringify({ u: at.items[0].author.username, d: at.items[0].author.displayName }));
  assert(hub.state.casts.get(posted.hash) && hub.state.casts.get(posted.hash).fid === FID, "the node does not hold the cast");
  const later = await settle();
  assert(later.items[0].hash === posted.hash && later.items[0].text === "hello from my own account" && later.items[0].author.username === "stubalice" && later.items[0].author.displayName === "Stub Alice (on the node)", "after the re-read: " + later.items[0].text + " by " + later.items[0].author.displayName);
  assert(reads("/v1/castsByFid").some((r) => r.fid === FID), "the root's own casts were not re-read after posting");
  await flow.deleteAsRoot(posted.hash);
  const del = await read.hubTimeline({ waitMs: 0 });
  assert(!hashes(del).includes(posted.hash), "a deleted post stayed");
  const del2 = await settle();
  assert(!hashes(del2).includes(posted.hash), "a deleted post came back after the re-read");
  flow.__setRootPostRuntimeForTests(null);
  return "shown at once, kept after the node re-read, gone at once after Delete";
});

await check("H11", "THREADS by fid + hash: ancestors oldest first, the cast, its replies; NotFound is 'not on the network', a failure is an error; failed ancestors / replies are said", async () => {
  fresh();
  for (const [f, u] of [[810, "anna"], [811, "ben"], [812, "cy"], [813, "di"]]) hub.plantProfile(f, { username: u, display: u.toUpperCase() });
  const t0 = Date.now() - 3_600_000;
  const at = (k) => t0 + k * 60_000 - ((t0 + k * 60_000) % 1000);
  const a = hub.plantCast({ fid: 810, ts: at(1), text: "the first post", seed: "h11:a" });
  const b = hub.plantCast({ fid: 811, ts: at(2), text: "a reply", parent: { fid: 810, hash: a }, seed: "h11:b" });
  const c = hub.plantCast({ fid: 812, ts: at(3), text: "a reply to the reply", parent: { fid: 811, hash: b }, seed: "h11:c" });
  const d = hub.plantCast({ fid: 813, ts: at(4), text: "first answer", parent: { fid: 812, hash: c }, seed: "h11:d" });
  const e = hub.plantCast({ fid: 810, ts: at(5), text: "second answer", parent: { fid: 812, hash: c }, seed: "h11:e" });
  const t = await read.hubThread(812, c);
  assert(t.cast.hash === c && t.ancestors.map((x) => x.hash).join() === [a, b].join() && t.replies.map((x) => x.hash).join() === [d, e].join(), "the thread: " + JSON.stringify({ anc: t.ancestors.map((x) => x.text), rep: t.replies.map((x) => x.text) }));
  assert(t.cast.replyingTo === "@ben" && t.cast.parentHash === b && t.cast.author.username === "cy", "reply context: " + t.cast.replyingTo);
  const nf = await errOf(read.hubThread(812, "0x" + "ab".repeat(20)));
  assert(nf && nf.code === "not_found" && nf.status === 404, "a missing cast: " + (nf ? nf.code : "no error"));
  fresh();
  hub.hubRead.fails.push({ path: "/v1/castById", fid: 812, status: 503, n: 1e9 });
  const fe = await errOf(read.hubThread(812, c));
  assert(fe && fe.code === "cast_unreadable" && fe.status === 503, "a failed read was not an error: " + (fe ? fe.code : "no error"));
  fresh();
  hub.hubRead.fails.push({ path: "/v1/castById", fid: 810, status: 503, n: 1e9 });
  const pa = await read.hubThread(812, c);
  assert(pa.cast.hash === c && pa.ancestorsError && pa.ancestors.map((x) => x.hash).join() === b, "a failed ancestor: " + JSON.stringify({ err: pa.ancestorsError, anc: pa.ancestors.length }));
  fresh();
  hub.hubRead.fails.push({ path: "/v1/castsByParent", fid: "*", status: 503, n: 1e9 });
  const pr = await read.hubThread(812, c);
  assert(pr.cast.hash === c && pr.repliesError && pr.replies.length === 0, "failed replies: " + JSON.stringify({ err: pr.repliesError }));
  const bad = await errOf(read.hubThread(-1, c));
  assert(bad && bad.code === "bad_request", "a bad fid was asked about");
  return "ancestors, replies, not found, failures";
});

await check("H12", "profiles: the profile op; a failed profile shows the account's number and is counted; mentions at their byte positions; url, image and quote embeds", async () => {
  fresh();
  hub.plantProfile(900, { username: "zed", display: "Zed", bio: "hi", pfp: "https://imagedelivery.net/x/y/original" });
  hub.plantProfile(901, { username: "mentioned", display: "M" });
  const now = Date.now();
  const q = hub.plantCast({ fid: 901, ts: now - 7_200_000 - ((now - 7_200_000) % 1000), text: "the quoted one", seed: "h12:q" });
  hub.plantCast({ fid: 900, ts: now - 60_000 - ((now - 60_000) % 1000), text: "gm ü  and you", mentions: [901], mentionsPositions: [6], seed: "h12:m", embeds: [{ url: "https://example.org/page" }, { url: "https://i.imgur.com/a.png" }, { castId: { fid: 901, hash: q } }] });
  const p = await read.hubProfile(900);
  assert(p.user.username === "zed" && p.user.displayName === "Zed" && p.casts.length === 1, "profile: " + JSON.stringify(p.user).slice(0, 120));
  const cast = p.casts[0];
  assert(cast.text === "gm ü @mentioned and you", "mention not at its byte position: " + JSON.stringify(cast.text));
  const kinds = cast.embeds.map((e) => e.type).join(",");
  assert(kinds === "link,image,quote" || kinds === "link,image,link", "embeds: " + kinds);
  // the quote resolves once its read lands (the timeline asks again; here the profile op is asked again)
  await new Promise((r) => setTimeout(r, 200));
  const p2 = await read.hubProfile(900);
  assert(p2.casts[0].embeds[2].type === "quote" && p2.casts[0].embeds[2].quote.hash === q, "the quote never resolved");
  // a failed profile: the account's number, counted
  fresh();
  hub.plantFollows(910, [{ fid: 911, ts: now - 2000 }, { fid: 912, ts: now - 1000 }]);
  hub.plantProfile(911, { username: "ok911", display: "OK" });
  hub.hubRead.fails.push({ path: "/v1/userDataByFid", fid: 912, status: 500, n: 1e9 });
  useRoot(910);
  const pp = await read.hubPeople();
  const bad = pp.rows.find((r) => r.fid === 912);
  assert(bad && bad.profile === "failed" && bad.user.displayName === "Farcaster account 912" && bad.user.username === "!912" && pp.profilesFailed && pp.profilesFailed.failed === 1, "a failed profile: " + JSON.stringify(bad));
  const pe = await errOf(read.hubProfile(912));
  assert(pe && pe.code === "profile_unreadable", "the profile op on a failed read: " + (pe ? pe.code : "no error"));
});

await check("H13", "shapes: a record under another fid is dropped; no fabricated counts; the read-only marks; identifier-free hrefs", async () => {
  fresh();
  hub.plantFollows(920, [{ fid: 921, ts: Date.now() - 1000 }]);
  hub.plantProfile(921, { username: "real", display: "Real" });
  const good = hub.plantCast({ fid: 921, ts: Date.now() - 60_000 - ((Date.now() - 60_000) % 1000), text: "mine", seed: "h13:good" });
  // the node's answer for fid 921 doctored to carry a cast by fid 3 as well
  rewrite = async (u, res) => {
    if (!u.includes("castsByFid") || !u.includes("fid=921")) return null;
    const j = await res.clone().json();
    j.messages.push({ data: { type: "MESSAGE_TYPE_CAST_ADD", fid: 3, timestamp: j.messages[0].data.timestamp + 10, castAddBody: { text: "not 921's", embeds: [], mentions: [], mentionsPositions: [] } }, hash: "0x" + "77".repeat(20) });
    j.messages.push({ data: { type: "MESSAGE_TYPE_CAST_ADD", fid: 921, timestamp: 1, castAddBody: { text: "bad hash" } }, hash: "0xnothex" });
    return new Response(JSON.stringify(j), { status: 200, headers: { "content-type": "application/json" } });
  };
  useRoot(920);
  const v = await settle();
  assert(v.items.length === 1 && v.items[0].hash === good, "a foreign or malformed record was shown: " + v.items.map((c) => c.text));
  const c = v.items[0];
  assert(c.replies === 0 && c.likes === 0 && c.recasts === 0 && c.views === undefined, "a fabricated count");
  assert(c.network === true && c.hub === true && c.author.network === true && c.author.hub === true && c.live === true, "the marks");
  assert(copy.hubCastHref(921, good) === "/fc/cast#921/" + good && copy.hubProfileHref(921) === "/fc/profile#921", "the hrefs");
  assert(JSON.stringify(copy.parseHubCastFragment("#921/" + good)) === JSON.stringify({ fid: 921, hash: good }) && copy.parseHubCastFragment("#921/0x12") === null && copy.parseHubProfileFragment("#921") === 921 && copy.parseHubProfileFragment("#") === null, "the fragment parsers");
});

await check("H14", "identity: another root never sees the previous root's graph; resetHubReads drops everything", async () => {
  fresh();
  hub.plantSynthetic({ root: 930, n: 5, castsPer: 2, base: 3_800_000, prolific: false, future: false });
  hub.plantSynthetic({ root: 940, n: 5, castsPer: 2, base: 3_810_000, prolific: false, future: false });
  useRoot(930);
  const a = await settle();
  useRoot(940);
  const b = await settle();
  assert(b.account.fid === 940 && b.items.every((x) => x.author.fid === 940 || (x.author.fid >= 3_810_000 && x.author.fid < 3_810_005)), "root B saw root A's graph");
  assert(!b.items.some((x) => hashes(a).includes(x.hash)), "a shared item");
  read.resetHubReads();
  useRoot(null);
  const n = await read.hubTimeline();
  assert(n.state === "not_signed_in" && n.items.length === 0 && n.requests === 0, "after a reset with no root: " + n.state + " " + n.requests);
});

await check("H15", "PERSONA SEPARATION: no read ever names one of the visitor's own personas (followed, replied to, mentioned, quoted, an ancestor, its thread, its profile, the people list); while a persona acts every op refuses and nothing leaves the tab, a read queued before the switch included", async () => {
  fresh();
  const ROOTF = 960, OTHER = 961, OWN = 965;
  let acting = false;
  read.__setHubReadRuntimeForTests({
    device: true, env: ENV, fetch: tabFetch, now: () => Date.now(), account: async () => acct,
    own: async () => ({ fids: new Set([OWN]), names: new Map([[OWN, "mine"]]) }),
    acting: async () => acting,
  });
  const now = Date.now();
  const at = (k) => { const t = now - k * 60_000; return t - (t % 1000); };
  hub.plantFollows(ROOTF, [{ fid: OTHER, ts: now - 5000 }, { fid: OWN, ts: now - 1000 }]);
  hub.plantProfile(OTHER, { username: "other", display: "Other" });
  hub.plantProfile(OWN, { username: "mine-on-the-node", display: "Mine" });
  const ownPost = hub.plantCast({ fid: OWN, ts: at(30), text: "my persona's post", seed: "h15:own" });
  const reply = hub.plantCast({ fid: OTHER, ts: at(20), text: " about your post", parent: { fid: OWN, hash: ownPost }, mentions: [OWN], mentionsPositions: [0], embeds: [{ castId: { fid: OWN, hash: ownPost } }], seed: "h15:reply" });
  const top = hub.plantCast({ fid: OTHER, ts: at(10), text: "a post", seed: "h15:top" });
  const ownReply = hub.plantCast({ fid: OWN, ts: at(5), text: "persona answers", parent: { fid: OTHER, hash: top }, seed: "h15:ownreply" });
  useRoot(ROOTF);
  await settle();
  await new Promise((r) => setTimeout(r, 300));
  const v = await settle();
  assert(v.items.some((x) => x.hash === reply) && v.items.some((x) => x.hash === top) && !v.items.some((x) => x.author.fid === OWN), "timeline: " + JSON.stringify(v.items.map((x) => [x.author.fid, x.text])));
  assert(!v.partial && v.progress.failed === 0 && !v.profilesFailed, "a refused read surfaced as a failure: " + JSON.stringify({ partial: v.partial, progress: v.progress, pf: v.profilesFailed }));
  const rc = v.items.find((x) => x.hash === reply);
  const q = rc.embeds.find((e) => e.type === "link" && e.domain === "Farcaster");
  assert(q && /your personas/.test(q.title) && rc.replyingTo === "@mine", "the quote and reply context of a persona's post: " + JSON.stringify({ q, to: rc.replyingTo }));
  const t = await read.hubThread(OTHER, top);
  assert(t.replies.some((x) => x.hash === ownReply && x.author.username === "mine"), "the persona's reply in someone else's thread, named from the vault: " + JSON.stringify(t.replies.map((x) => x.author.username)));
  const rt = await read.hubThread(OTHER, reply);
  assert(rt.ancestors.length === 0 && !rt.ancestorsError && rt.ancestorMissing && /your personas/.test(rt.ancestorMissing), "an ancestor by the persona: " + JSON.stringify({ a: rt.ancestors.length, e: rt.ancestorsError, m: rt.ancestorMissing }));
  const te = await errOf(read.hubThread(OWN, ownPost));
  assert(te && te.code === "own_persona", "the persona's own thread: " + (te ? te.code : "no error"));
  const pe = await errOf(read.hubProfile(OWN));
  assert(pe && pe.code === "own_persona", "the persona's profile: " + (pe ? pe.code : "no error"));
  const pp = await read.hubPeople();
  const row = pp.rows.find((r) => r.fid === OWN);
  assert(row && row.user.username === "mine" && !pp.profilesFailed, "the people list names the persona from the vault: " + JSON.stringify(row && row.user));
  const named = reads().filter((r) => r.fid === OWN);
  assert(named.length === 0, named.length + " read(s) named the persona: " + named.map((r) => r.path).join(","));
  assert(reads().length >= 5, "vacuous: only " + reads().length + " read(s) at all");
  // a persona acting: every op refuses, nothing leaves
  acting = true;
  const before = reads().length;
  for (const [name, p] of [["timeline", read.hubTimeline({ refresh: "manual" })], ["count", read.hubFollowsCount()], ["people", read.hubPeople()], ["thread", read.hubThread(OTHER, top)], ["profile", read.hubProfile(OTHER)]]) {
    const e = await errOf(p);
    assert(e && e.code === "acting_persona" && e.status === 409, name + " while a persona acts: " + (e ? e.code : "it answered"));
  }
  assert(reads().length === before, reads().length - before + " read(s) left while a persona acted");
  // reads queued BEFORE the switch never leave after it
  acting = false;
  read.resetHubReads();
  hub.plantSynthetic({ root: 970, n: 60, castsPer: 2, base: 3_900_000, prolific: false, future: false });
  useRoot(970);
  hub.hubRead.delayMs = 150;
  await read.hubTimeline({ waitMs: 400 });
  acting = true;
  await new Promise((r) => setTimeout(r, 60));
  const atSwitch = reads().length;
  await new Promise((r) => setTimeout(r, 1500));
  hub.hubRead.delayMs = 0;
  assert(atSwitch > 0 && reads().length === atSwitch, reads().length - atSwitch + " queued read(s) left after the switch (of " + atSwitch + " before)");
  acting = false;
  return "0 reads named the persona; 5 ops refused while acting; 0 queued reads after the switch";
});

await check("H16", "POST AS YOU ON HUB CARDS, the pressed state: two plain GETs naming the root only; a like through the real flow is pressed at once; past the page older cards are unknown, never 'not liked'; a failed read is unknown; another account's reaction dropped; nothing while a persona acts; an own persona's card marked", async () => {
  fresh();
  const ROOTF = 980, OTHER = 981, OWN = 985;
  let acting = false;
  const runtime = (account) =>
    read.__setHubReadRuntimeForTests({
      device: true, env: ENV, fetch: tabFetch, now: () => Date.now() + skew, account,
      own: async () => ({ fids: new Set([OWN]), names: new Map([[OWN, "mine"]]) }),
      acting: async () => acting,
    });
  runtime(async () => acct);
  const now = Date.now();
  const at = (min) => { const t = now - min * 60_000; return t - (t % 1000); };
  hub.plantFollows(ROOTF, [{ fid: OTHER, ts: now - 5000 }]);
  hub.plantProfile(OTHER, { username: "other", display: "Other" });
  const c1 = hub.plantCast({ fid: OTHER, ts: at(60), text: "liked already", seed: "h16:c1" });
  const c2 = hub.plantCast({ fid: OTHER, ts: at(120), text: "recast already", seed: "h16:c2" });
  const c3 = hub.plantCast({ fid: OTHER, ts: at(10), text: "not yet", seed: "h16:c3" });
  hub.plantReaction({ fid: ROOTF, kind: "like", target: { fid: OTHER, hash: c1 }, ts: at(30) });
  hub.plantReaction({ fid: ROOTF, kind: "recast", target: { fid: OTHER, hash: c2 }, ts: at(90) });
  hub.plantReaction({ fid: 3, kind: "like", target: { fid: OTHER, hash: c3 }, ts: at(5) }); // someone else's
  useRoot(ROOTF, "rootf");
  // (a) the read: two plain GETs, the root's fid only, Snapchain's names, one page, newest first
  const v = await read.hubReacted();
  assert(v.state === "ok" && v.account.fid === ROOTF && v.sentence === null, "the view: " + JSON.stringify(v).slice(0, 200));
  assert(v.like.hashes.includes(c1) && !v.like.hashes.includes(c3) && v.recast.hashes.includes(c2) && v.like.horizon === null && v.recast.horizon === null, "the sets: " + JSON.stringify({ like: v.like, recast: v.recast }));
  const rr = seen.filter((r) => r.url.includes("/v1/reactionsByFid"));
  assert(rr.length === 2 && rr.every((r) => r.method === "GET" && r.credentials === "omit" && r.referrerPolicy === "no-referrer" && r.headers === null), "not two plain GETs: " + JSON.stringify(rr).slice(0, 300));
  const qs = rr.map((r) => new URL(r.url).searchParams);
  assert(qs.every((q) => q.get("fid") === String(ROOTF) && q.get("pageSize") === String(L.reactionsPage) && q.get("reverse") === "true") && qs.map((q) => q.get("reaction_type")).sort().join() === "Like,Recast", "the queries: " + rr.map((r) => r.url.slice(r.url.indexOf("?"))).join(" | "));
  assert(copy.reactedState(v, "like", c1, at(60)) === true && copy.reactedState(v, "like", c3, at(10)) === false && copy.reactedState(v, "recast", c2, at(120)) === true && copy.reactedState(v, "recast", c1, at(60)) === false, "the pressed states");
  // cached: asked again (and a refresh within a minute) reads nothing
  await read.hubReacted();
  await read.hubReacted({ refresh: true });
  assert(seen.filter((r) => r.url.includes("/v1/reactionsByFid")).length === 2, "the cache did not answer");
  // (b) another account's reaction in the answer (a doctored node answer) is dropped, never counted as the root's
  read.resetHubReads();
  rewrite = async (u, res) => {
    if (!u.includes("/v1/reactionsByFid") || !u.includes("reaction_type=Like")) return null;
    const j = await res.clone().json();
    j.messages.push({ data: { type: "MESSAGE_TYPE_REACTION_ADD", fid: 3, timestamp: 1000, reactionBody: { type: "REACTION_TYPE_LIKE", targetCastId: { fid: OTHER, hash: c3 } } }, hash: "0x" + "99".repeat(20) });
    j.messages.push({ data: { type: "MESSAGE_TYPE_REACTION_ADD", fid: ROOTF, timestamp: 1000, reactionBody: { type: "REACTION_TYPE_RECAST", targetCastId: { fid: OTHER, hash: c3 } } }, hash: "0x" + "98".repeat(20) });
    return new Response(JSON.stringify(j), { status: 200, headers: { "content-type": "application/json" } });
  };
  const vd = await read.hubReacted();
  rewrite = null;
  assert(vd.state === "ok" && !vd.like.hashes.includes(c3) && !vd.recast.hashes.includes(c3), "a foreign or mis-kinded reaction was counted: " + JSON.stringify(vd.like.hashes));
  // (c) past one page: the horizon. 205 likes by another root; a card older than the 200th is unknown, never "not liked"
  const R2 = 982;
  for (let i = 0; i < 205; i++) hub.plantReaction({ fid: R2, kind: "like", target: { fid: OTHER, hash: "0x" + (i + 1).toString(16).padStart(40, "0") }, ts: at(i) });
  useRoot(R2);
  const vh = await read.hubReacted();
  assert(vh.state === "ok" && vh.like.hashes.length === 200 && vh.like.horizon === at(199) && vh.recast.horizon === null, "the horizon: " + JSON.stringify({ n: vh.like.hashes.length, h: vh.like.horizon, want: at(199) }));
  assert(copy.reactedState(vh, "like", "0x" + "f".repeat(40), at(300)) === null && copy.reactedState(vh, "like", "0x" + "f".repeat(40), at(100)) === false && copy.reactedState(vh, "like", "0x" + (1).toString(16).padStart(40, "0"), at(0)) === true, "older than the horizon must be unknown, newer not-liked");
  // (d) a failed read: unknown, never "not liked" (and said)
  const R3 = 983;
  hub.hubRead.fails.push({ path: "/v1/reactionsByFid", fid: R3, status: 500, n: 1e9 });
  useRoot(R3);
  const vf = await read.hubReacted();
  hub.clearHubSteering();
  assert(vf.state === "failed" && vf.sentence && /Couldn.t read/.test(vf.sentence) && copy.reactedState(vf, "like", c1, at(60)) === null, "a failed read: " + JSON.stringify({ s: vf.state, t: vf.sentence }));
  // (e) a like made through the REAL flow is pressed at once (no re-read), and its undo at once too
  read.resetHubReads();
  links.resetAccountLinksCache();
  await links.updateAccountLinks(() => ({ v: 1, links: [{ kind: "farcaster", fid: ROOTF, fname: "rootf", displayName: "Root F", pfpUrl: null, bio: null, personaId: "p_unit_self", authMethod: "custody", signer: "0x" + "ab".repeat(20), nonceHash: "00".repeat(32), messageHash: "11".repeat(32), verifiedAt: Date.now(), verifier: { rpcHost: "stub" }, disconnectedAt: null }] }));
  const pair = store.newRootKeyPair();
  await store.updateRootSigner((doc) => ({ ...doc, signer: { fid: ROOTF, priv: pair.priv, key: pair.key, appFid: 990900, state: "active", token: null, deeplinkUrl: null, deadline: 0, createdAt: Date.now(), activatedAt: Date.now() } }));
  hub.seedAccount(ROOTF, "0x" + ROOTF.toString(16).padStart(40, "0"), pair.key);
  flow.__setRootPostRuntimeForTests({ device: true, env: { VALIDATOR_URL: RELAY, FC_ROOT_HUB_URL: hub.hubUrl }, fetch, now: () => Date.now() });
  useRoot(ROOTF, "rootf");
  const v0 = await read.hubReacted();
  assert(copy.reactedState(v0, "like", c3, at(10)) === false, "c3 liked before the like");
  await new Promise((r) => setTimeout(r, 50)); // the listener's import settles
  const before = seen.filter((r) => r.url.includes("/v1/reactionsByFid")).length;
  await flow.reactAsRoot("like", { fid: OTHER, hash: c3 });
  const v1 = await read.hubReacted();
  assert(copy.reactedState(v1, "like", c3, at(10)) === true, "the like was not pressed at once");
  await flow.reactAsRoot("like", { fid: OTHER, hash: c3 }, true);
  const v2 = await read.hubReacted();
  assert(copy.reactedState(v2, "like", c3, at(10)) === false, "the unlike was not applied at once");
  assert(seen.filter((r) => r.url.includes("/v1/reactionsByFid")).length === before, "it re-read the node instead of applying the tab's own reaction");
  flow.__setRootPostRuntimeForTests(null);
  // (f) nothing is read while a persona acts: the op refuses, zero reads
  acting = true;
  read.resetHubReads();
  const n0 = reads().length;
  const ea = await errOf(read.hubReacted());
  acting = false;
  assert(ea && ea.code === "acting_persona" && reads().length === n0, "while a persona acts: " + (ea ? ea.code : "it answered") + ", " + (reads().length - n0) + " read(s)");
  // (g) a card by an own persona is marked (its like, recast and reply stay off); the others are not
  const top = hub.plantCast({ fid: OTHER, ts: at(8), text: "a post", seed: "h16:top" });
  const ownReply = hub.plantCast({ fid: OWN, ts: at(7), text: "my persona answers", parent: { fid: OTHER, hash: top }, seed: "h16:ownreply" });
  const t = await read.hubThread(OTHER, top);
  const or = t.replies.find((x) => x.hash === ownReply);
  assert(or && or.hubOwn === true && t.cast.hubOwn === undefined, "the own persona's card is not marked (or the other is): " + JSON.stringify({ own: or && or.hubOwn, other: t.cast.hubOwn }));
  const named = reads().filter((r) => r.fid === OWN);
  assert(named.length === 0, "a read named the persona");
  return "2 reads naming the root; pressed at once after a like and its undo; horizon at the 200th; failed = unknown; 0 reads while acting";
});

// ---------------------------------------------------------------------------------------------------- spec A: your mode
const ruleOf = (id, name, action, clauses, extra = {}) => ({ id, name, action, root: { combinator: "AND", clauses, ...extra }, createdAt: 0 });
const lensOf = (weights) => ({ signals: { ...lensTypes.zeroSignals(), ...weights }, influenceDistribution: {} });
/** a mode as the device's loader hands it over (lib/fc/hubRead/modeSource.ts): the Default preset's weights unless told */
const specOf = (o = {}) => {
  const t = o.tiers ?? {};
  return {
    id: o.id ?? "mode_unit",
    name: o.name ?? "Unit mode",
    ranking: { recency: 0.4, engagement: 0.3, authorAffinity: 0.2, clusterAffinity: 0.1, ...(o.ranking ?? {}) },
    calmRanking: !!o.calmRanking,
    longformOnly: !!o.longformOnly,
    hideReplies: !!o.hideReplies,
    kingOfTheHill: false,
    rules: o.rules ?? [],
    deliveryRules: Object.keys(t).length ? tiers.compileDeliveryRules([], new Set(Object.values(t))) : [],
    tiers: new Map(Object.entries(t).map(([k, v]) => [Number(k), v])),
    tiersUnreadable: !!o.tiersUnreadable,
    lens: { id: o.lens ? "lens_unit" : "lens_canonical", name: null, source: o.lens ? "mode" : "canonical", spec: o.lens ?? null, missing: false },
    packs: o.packs ?? [],
  };
};

await check("H17", "YOUR MODE ON FOLLOWING (spec A): the mode's rules hide and push down Farcaster posts exactly as the evaluator decides a sample post with the same fields; never-miss pins one post per account (a quarter of the page at most), quiet sinks, banner strips; count-based weights are said, not used; a lens's reading length re-ranks; 'Your mode hid all N posts'; a mode that cannot be read shows nothing; no mode causes a node read; nothing while a persona acts", async () => {
  fresh();
  const R = 970, A = 9701, B = 9702, C = 9703, D = 9704, E = 9705, F = 9706, G = 9707, H = 9708;
  let modeNow = null;
  let modeFail = null;
  let modeCalls = 0;
  let acting = false;
  let actOnLoad = false;
  read.__setHubReadRuntimeForTests({
    device: true, env: ENV, fetch: tabFetch, now: () => Date.now(), account: async () => acct, acting: async () => acting,
    mode: async () => {
      modeCalls++;
      if (actOnLoad) acting = true;
      if (modeFail) throw modeFail;
      return modeNow;
    },
  });
  const now = Date.now();
  const at = (k) => { const t = now - k * 60_000; return t - (t % 1000); };
  hub.plantFollows(R, [A, B, C, D, E, F, G, H].map((f, i) => ({ fid: f, ts: now - (20 - i) * 1000 })));
  const LONG = "a long read about the stars ".repeat(20); // 560 characters: long-form (> 480)
  const plan = [
    ["c1", A, 1, "hello zebra world", {}],
    ["c2", B, 2, "plain words", {}],
    ["c3", C, 3, "with a link", { embeds: [{ url: "https://example.org/a" }] }],
    ["c4", A, 4, LONG, {}],
    ["c5", D, 5, "a reply", { parentOf: "c2" }],
    ["c6", E, 6, "Zebra again", {}],
    ["c7", F, 7, "the quiet one", {}],
    ["c8", B, 8, "an older post from b", {}],
    ["c9", C, 9, "an image", { embeds: [{ url: "https://i.imgur.com/x.png" }] }],
    ["c10", D, 10, "d again", {}],
    // past the page (want 10): read, never on screen, their authors' profiles never read
    ["c11", G, 11, "g one", {}],
    ["c12", H, 12, "h one", {}],
    ["c13", G, 13, "g two", {}],
    ["c14", H, 14, "h two", {}],
  ];
  const P = {};
  const posts = [];
  for (const [k, fid, m, text, x] of plan) {
    const parent = x.parentOf ? { fid: posts.find((p) => p.k === x.parentOf).fid, hash: P[x.parentOf] } : undefined;
    P[k] = hub.plantCast({ fid, ts: at(m), text, embeds: x.embeds, parent, seed: "h17:" + k });
    posts.push({ k, h: P[k], fid, ts: at(m), text, embeds: (x.embeds ?? []).length, reply: !!parent });
  }
  const page = posts.slice(0, 10);
  const K = (hashesList) => hashesList.map((h) => posts.find((p) => p.h === h)?.k ?? h).join(",");
  useRoot(R);
  const base = await settle({ want: 10 });
  assert(base.state === "ready" && K(hashes(base)) === page.map((p) => p.k).join(","), "the page as read: " + K(hashes(base)));
  assert(base.mode === null && base.more === true, "no mode in the harness by default; older posts exist: " + JSON.stringify({ mode: base.mode, more: base.more }));
  await new Promise((r) => setTimeout(r, 200)); // the page's profile reads settle
  await settle({ want: 10 });
  const reads0 = reads().length;
  const ask = async (spec) => {
    modeNow = spec;
    return read.hubTimeline({ want: 10, waitMs: 0 });
  };
  /** the context the SAMPLE feed builds for a post with these fields (lib/feed.ts): the evaluator's verdict on it */
  const sampleCtx = (p) => ({ post: { hash: p.h, topicId: null, isUpdate: false, hasMedia: p.embeds > 0, ageMinutes: Math.max(0, (Date.now() - p.ts) / 60_000), text: p.text }, author: { personaId: "seed_author", tier: 5, cluster: "crypto" }, viewer: { personaId: "seed_viewer", followingPersonaIds: [] }, delivery: { tier: "normal" } });
  const sampleHides = (rule) => new Set(page.filter((p) => evaluate.ruleActions([rule], sampleCtx(p)).hide).map((p) => p.h));
  const notIn = (set) => page.filter((p) => !set.has(p.h)).map((p) => p.k).join(",");
  const done = [];

  // (a) the Default preset's weights: newest first, exactly as read; engagement and topic affinity SAID, not used
  const v0 = await ask(specOf());
  assert(K(hashes(v0)) === K(hashes(base)) && v0.mode.state === "ok" && v0.mode.hidden === 0 && v0.mode.ranked === false && v0.mode.sentence === null, "the Default weights changed the page: " + K(hashes(v0)) + " " + JSON.stringify({ ranked: v0.mode.ranked, hidden: v0.mode.hidden }));
  const g0 = v0.mode.gaps.map((g) => g.term);
  assert(g0.includes("engagement") && g0.includes("topic affinity") && v0.mode.gaps.every((g) => g.sentence.length > 20), "Default's count-based weight not said: " + JSON.stringify(v0.mode.gaps));
  done.push("default = as read");

  // (b) a muted word (any case), decided exactly as the evaluator decides a sample post with the same text
  const rText = ruleOf("r_text", "No zebras", "hide", [{ field: "post.text", op: "contains", value: "ZEBRA" }]);
  const expText = sampleHides(rText);
  assert(K([...expText].sort()) === K([P.c1, P.c6].sort()), "the evaluator's own verdict on the sample shape: " + K([...expText]));
  const vt = await ask(specOf({ rules: [rText] }));
  assert(K(hashes(vt)) === notIn(expText) && vt.mode.hidden === 2 && vt.mode.sentence === "Your mode hid 2 of these 10 posts.", "the muted word on Following: " + K(hashes(vt)) + " " + vt.mode.sentence);
  // (c) only posts with links or pictures: hide where has media is false
  const rMedia = ruleOf("r_media", "Only links", "hide", [{ field: "post.hasMedia", op: "eq", value: false }]);
  const expMedia = sampleHides(rMedia);
  const vm = await ask(specOf({ rules: [rMedia] }));
  assert(K(hashes(vm)) === notIn(expMedia) && K(hashes(vm)) === "c3,c9", "only links: " + K(hashes(vm)));
  // (d) a push-down rule: the post goes to the bottom, the rest keep their order
  const rDown = ruleOf("r_down", "Older last", "downrank", [{ field: "post.text", op: "contains", value: "older" }]);
  const vd = await ask(specOf({ rules: [rDown] }));
  const downByEval = page.filter((p) => evaluate.ruleActions([rDown], sampleCtx(p)).downrank).map((p) => p.k);
  assert(downByEval.join() === "c8" && K(hashes(vd)) === "c1,c2,c3,c4,c5,c6,c7,c9,c10,c8" && vd.mode.quiet.join() === P.c8, "push-down: " + K(hashes(vd)) + " eval " + downByEval);
  // (e) hide replies (the mode flag)
  const vr = await ask(specOf({ hideReplies: true }));
  assert(K(hashes(vr)) === "c1,c2,c3,c4,c6,c7,c8,c9,c10" && vr.mode.hidden === 1, "hide replies: " + K(hashes(vr)));
  done.push("rules = the evaluator's verdicts");

  // (f) delivery tiers, per account (fid): never-miss pins ONE post of B at the top, quiet sinks F, banner strips D
  const vtier = await ask(specOf({ tiers: { [B]: "never-miss", [F]: "quiet", [D]: "banner" } }));
  assert(K(hashes(vtier)) === "c2,c1,c3,c4,c5,c6,c8,c9,c10,c7", "tiers: " + K(hashes(vtier)));
  assert(vtier.mode.pinned.join() === P.c2 && vtier.mode.quiet.join() === P.c7 && K(vtier.mode.strip.map((s) => s.hash)) === "c5,c10", "tier marks: " + JSON.stringify({ pinned: K(vtier.mode.pinned), quiet: K(vtier.mode.quiet), strip: K(vtier.mode.strip.map((s) => s.hash)) }));
  assert(vtier.mode.strip.every((s) => s.href === copy.hubCastHref(s.fid, s.hash)), "a strip item opens by a server path: " + JSON.stringify(vtier.mode.strip.map((s) => s.href)));
  // at most a quarter of the page: three never-miss accounts, a page of 10 → 2 pinned (their newest)
  const vcap = await ask(specOf({ tiers: { [A]: "never-miss", [B]: "never-miss", [C]: "never-miss" } }));
  assert(vcap.mode.pinned.length === 2 && K(hashes(vcap)).startsWith("c1,c2,c3,c4"), "the pin cap: " + K(vcap.mode.pinned) + " / " + K(hashes(vcap)));
  done.push("tiers per fid");

  // (g) weights that need counts: said, and they move nothing; the lens's reading length (dwell) re-ranks
  const vc = await ask(specOf({ calmRanking: true, lens: lensOf({ likes: 2, recasts: 1, tier: 1 }) }));
  const gc = vc.mode.gaps.map((g) => g.term);
  for (const t of ["engagement", "calm ranking", "likes", "recasts", "tier"]) assert(gc.includes(t), "not said: " + t + " in " + JSON.stringify(gc));
  assert(K(hashes(vc)) === K(hashes(base)) && vc.mode.ranked === false, "a count-based weight moved the page: " + K(hashes(vc)));
  const vdw = await ask(specOf({ lens: lensOf({ dwell: 3 }) }));
  assert(hashes(vdw)[0] === P.c4 && vdw.mode.ranked === true && !vdw.mode.gaps.some((g) => g.term === "dwell"), "the dwell lens: " + K(hashes(vdw)));
  done.push("counts said, dwell ranks");

  // (h) a rule on the author's Totem tier: a Farcaster account carries none, so it hides every post (hide-when-unsure)
  const rTier = ruleOf("r_tier", "No low tiers", "hide", [{ field: "author.tier", op: "lt", value: 3 }]);
  const vti = await ask(specOf({ rules: [rTier] }));
  assert(vti.items.length === 0 && vti.mode.hidAll === true && vti.mode.gaps.some((g) => g.kind === "rule" && /hides every post/.test(g.sentence)), "an author rule on strangers: " + vti.items.length + " " + JSON.stringify(vti.mode.gaps));
  // (i) everything hidden: "Your mode hid all N posts", never "No posts yet", and older posts still offered
  const rAll = ruleOf("r_all", "Everything", "hide", [{ field: "post.age", op: "gte", value: 0 }]);
  const va = await ask(specOf({ rules: [rAll] }));
  assert(va.items.length === 0 && va.mode.hidAll === true && va.mode.sentence === "Your mode hid all 10 posts." && va.noPosts === false && va.more === true && va.state === "ready", "hid all: " + JSON.stringify({ n: va.items.length, s: va.mode.sentence, noPosts: va.noPosts, more: va.more, state: va.state }));
  // nothing past the page is ever shown under a mode: every post on screen is one of the page's
  for (const v of [vt, vm, vd, vr, vtier, vcap, vc, vdw]) assert(hashes(v).every((h) => page.some((p) => p.h === h)), "a post from past the page was shown: " + K(hashes(v)));
  done.push("hid all said");

  // (j) NO MODE CAUSES A READ: every answer above came from what was already read
  assert(reads().length === reads0, reads().length - reads0 + " node read(s) caused by a mode: " + JSON.stringify(reads().slice(reads0).map((r) => r.path + "?" + r.fid)));
  assert(!reads().some((r) => r.path === "/v1/userDataByFid" && (r.fid === G || r.fid === H)), "a profile past the page was read");
  done.push("0 node reads");

  // (k) a mode that cannot be read or applied: NOTHING on the page (never the posts it might hide), said, then back
  modeFail = Object.assign(new Error(copy.hubModeRuleErrorSentence("Work")), { name: "HubModeError" });
  const ve = await ask(specOf());
  assert(ve.items.length === 0 && ve.mode.state === "error" && ve.mode.reason === copy.hubModeRuleErrorSentence("Work"), "a mode error: " + JSON.stringify({ n: ve.items.length, mode: ve.mode }));
  modeFail = new Error("anything else");
  const ve2 = await ask(specOf());
  assert(ve2.items.length === 0 && ve2.mode.reason === copy.HUB_MODE_ERROR_SENTENCE, "an unnamed failure: " + ve2.mode.reason);
  modeFail = null;
  const vback = await ask(specOf());
  assert(K(hashes(vback)) === K(hashes(base)), "Retry did not bring the page back");
  // the tier map unreadable: Normal for every account, and said
  const vtu = await ask(specOf({ tiersUnreadable: true }));
  assert(vtu.mode.tiers.unreadable === copy.HUB_TIERS_UNREADABLE_SENTENCE && K(hashes(vtu)) === K(hashes(base)), "unreadable tiers: " + vtu.mode.tiers.unreadable);
  done.push("errors said");

  // (l) PERSONA SEPARATION: while a persona acts the mode is not even asked for; one chosen while it is read gets nothing
  acting = true;
  const calls = modeCalls;
  const ea = await errOf(ask(specOf()));
  acting = false;
  assert(ea && ea.code === "acting_persona" && modeCalls === calls, "while a persona acts: " + (ea ? ea.code : "answered") + ", mode read " + (modeCalls - calls) + "x");
  actOnLoad = true;
  const eb = await errOf(ask(specOf()));
  actOnLoad = false;
  acting = false;
  assert(eb && eb.code === "acting_persona", "a persona chosen while the mode was read still got the root's page: " + (eb ? eb.code : "answered"));
  assert(reads().length === reads0, "a read while a persona acted");
  done.push("separation");
  read.__setHubReadRuntimeForTests({ device: true, env: ENV, fetch: tabFetch, now: () => Date.now(), account: async () => acct });
  return done.join("; ");
});

await check("H18", "THE MODE LOADER (spec A): keyed exactly as the mode routes key it (activeSeedPersonaId); the mode's rules resolved; a rule it cannot resolve or walk, or an unreadable mode, refuses (never an unfiltered page); tiers keyed fc:<fid> apply (a persona-keyed tier does not), an unreadable tier map is said; a lens gone missing and a pack about Totem accounts are said", async () => {
  const { modeCtl } = registryStub;
  const { personaCtl } = personaStub;
  const wellRule = ruleOf("rule_w", "Muted", "hide", [{ field: "post.text", op: "contains", value: "spoiler" }]);
  modeCtl.rules.set(wellRule.id, wellRule);
  const mk = (id, extra = {}) => ({ id, personaId: personaCtl.id, name: "Mode " + id, isPreset: false, ranking: { recency: 0.4, engagement: 0.3, authorAffinity: 0.2, clusterAffinity: 0.1 }, ruleIds: [], notificationPolicy: "all", actionButtonSlots: { composer: [], nav: [] }, showTrending: true, calmRanking: false, createdAt: 0, ...extra });
  personaCtl.id = "pub_self_unit";
  modeCtl.modes.set("m_ok", mk("m_ok", { ruleIds: [wellRule.id], hideReplies: true, lens: "lens_gone", filterPackIds: ["pack_claims"] }));
  modeCtl.active.set("pub_self_unit", "m_ok");
  packStub.packCtl.packs.set("pack_claims", { id: "pack_claims", artifact: { name: "Longform Standard", attestationPredicates: [{ claim: "longform_reader", mode: "lacking" }] } });
  // (a) keyed to what activeSeedPersonaId answers (the public self while no persona acts), and only that
  modeCtl.asked.length = 0;
  tiers.resetDeliveryCache();
  await tiers.setTier("m_ok", copy.hubAccountKey(4242), "never-miss");
  await tiers.setTier("m_ok", "seed_persona_x", "quiet");
  await tiers.setTier("m_other", copy.hubAccountKey(4243), "quiet");
  const s = await modeSource.hubModeSpec();
  assert(modeCtl.asked.length === 1 && modeCtl.asked[0] === "pub_self_unit" && s.id === "m_ok", "not keyed to the acting identity: " + JSON.stringify(modeCtl.asked));
  assert(s.rules.length === 1 && s.rules[0].id === wellRule.id && s.hideReplies === true, "the rules: " + JSON.stringify(s.rules.map((r) => r.id)));
  assert(s.tiers.size === 1 && s.tiers.get(4242) === "never-miss" && s.deliveryRules.some((r) => r.action === "pin") && !s.tiersUnreadable, "the tiers: " + JSON.stringify([...s.tiers]));
  assert(s.lens.missing === true && s.packs.length === 1 && s.packs[0].perAccount === true, "lens / packs: " + JSON.stringify({ lens: s.lens, packs: s.packs }));
  const gaps = hubMode.gapsFor(s).map((g) => g.kind + ":" + g.term);
  assert(gaps.includes("lens:lens") && gaps.includes("pack:Longform Standard"), "not said: " + JSON.stringify(gaps));
  // (b) a rule the mode names that this device cannot resolve: refused, by the mode's name
  modeCtl.modes.set("m_missing", mk("m_missing", { name: "Work", ruleIds: ["rule_nowhere"] }));
  modeCtl.active.set("pub_self_unit", "m_missing");
  const e1 = await errOf(modeSource.hubModeSpec());
  assert(e1 && e1.name === "HubModeError" && e1.message === copy.hubModeRuleErrorSentence("Work"), "an unresolvable rule: " + (e1 ? e1.message : "accepted"));
  // (c) a stored rule whose tree the evaluator cannot walk (no clause list): refused
  modeCtl.rules.set("rule_broken", { id: "rule_broken", name: "Broken", action: "hide", root: { op: "and", conditions: [{ field: "text", cmp: "contains", value: "x" }] }, createdAt: 0 });
  modeCtl.modes.set("m_broken", mk("m_broken", { name: "Broken mode", ruleIds: ["rule_broken"] }));
  modeCtl.active.set("pub_self_unit", "m_broken");
  const e2 = await errOf(modeSource.hubModeSpec());
  assert(e2 && e2.name === "HubModeError" && /Broken mode/.test(e2.message), "a malformed rule: " + (e2 ? e2.message : "accepted"));
  // (d) the mode store unreadable: refused with the fixed sentence
  modeCtl.failActive = true;
  const e3 = await errOf(modeSource.hubModeSpec());
  modeCtl.failActive = false;
  assert(e3 && e3.name === "HubModeError" && e3.message === copy.HUB_MODE_ERROR_SENTENCE, "an unreadable mode: " + (e3 ? e3.message : "accepted"));
  // (e) the tier map unreadable: Normal for every account, flagged (said on the page), never a refusal of the page
  modeCtl.active.set("pub_self_unit", "m_ok");
  tiers.resetDeliveryCache();
  persistStub.persistCtl.fail = true;
  const s2 = await modeSource.hubModeSpec();
  persistStub.persistCtl.fail = false;
  assert(s2.tiersUnreadable === true && s2.tiers.size === 0 && s2.deliveryRules.length === 0, "an unreadable tier map: " + JSON.stringify({ u: s2.tiersUnreadable, n: s2.tiers.size }));
  // (f) the key helpers
  assert(copy.fidOfHubAccountKey(copy.hubAccountKey(77)) === 77 && copy.fidOfHubAccountKey("fc:0") === null && copy.fidOfHubAccountKey("fc:7|x") === null && copy.fidOfHubAccountKey("seed_x") === null, "the fc:<fid> key");
  tiers.resetDeliveryCache();
  return "keyed to " + modeCtl.asked[0] + "; 3 refusals; tiers by fid; unreadable tiers flagged";
});

// ---------------------------------------------------------------------------------------------------- spec C: the extras
const WORDS = (n, w = "word") => Array.from({ length: n }, (_, i) => w + i).join(" ");
/** the readwise route, as the tab answers it (POST /api/readwise) */
const rwCall = async (body) => {
  const r = await readwiseRoute.POST(new nextStub.NextRequest("http://x/api/readwise", { method: "POST", body: JSON.stringify(body) }));
  return { status: r.status, body: r.body };
};
/** a runtime with the REAL extras loader (its stores stood in for: the desks, the folders; the real readwise state over the
 *  stub validator; the real ring inbox in memory) */
const extrasRuntime = (o = {}) =>
  read.__setHubReadRuntimeForTests({
    device: true, env: ENV, fetch: tabFetch, now: () => Date.now(), account: async () => acct,
    acting: o.acting ?? (async () => false),
    mode: o.mode ?? (async () => null),
    extras: (id) => extrasSource.hubExtrasSpec(id),
  });
/** the page's own reads (its quotes are read for the page, outside the timeline's busy test) have all landed */
async function quiet(want = 10) {
  let n = -1;
  for (let i = 0; i < 40 && n !== reads().length; i++) {
    n = reads().length;
    await new Promise((r) => setTimeout(r, 150));
    await read.hubTimeline({ want, waitMs: 100 });
  }
}
const pageOf = (v) => v.cards.filter((c) => c.placement === "page");
const queueOf = (v) => v.cards.filter((c) => c.placement === "queue");
const cardOf = (v, h) => v.cards.find((c) => c.cast.hash === h);

await check("H19", "READWISE ON HUB POSTS (spec C): a long cast (80 words, the shortest piece the slider allows) or one with a link is a reading piece, a picture or a quote is not; its dwell goes through the readwise route into the SEALED record (nothing in the clear, no request), crosses the length-scaled threshold and shows read; an unfinished piece off the page is requeued through the one queue (the mode's cadence knob caps it, a priority folder first); the bin takes it off and Restore brings it back; the mode's hide holds; while a persona acts nothing is written; a cast not held is unknown; an unreadable state is said and resurfaces nothing; zero node reads", async () => {
  fresh();
  let acting = false;
  let modeNow = null;
  extrasRuntime({ acting: async () => acting, mode: async () => modeNow });
  readwiseState.resetReadwiseStateCache();
  registryStub.folderCtl.folders = [];
  annStub.annCtl.list = [];
  received.resetReceived();
  const R = 960, A = 9601, B = 9602, C = 9603, D = 9604;
  const now = Date.now();
  const at = (k) => { const t = now - k * 60_000; return t - (t % 1000); };
  hub.plantFollows(R, [A, B, C, D].map((f, i) => ({ fid: f, ts: now - (10 - i) * 1000 })));
  const P = {};
  P.long = hub.plantCast({ fid: A, ts: at(1), text: WORDS(80, "star"), seed: "h19:long" });
  P.short = hub.plantCast({ fid: B, ts: at(2), text: WORDS(79, "moon"), seed: "h19:short" });
  P.link = hub.plantCast({ fid: C, ts: at(3), text: "an essay worth the time", embeds: [{ url: "https://example.org/essay" }], seed: "h19:link" });
  P.pic = hub.plantCast({ fid: D, ts: at(4), text: "a picture", embeds: [{ url: "https://imagedelivery.net/abc/def" }], seed: "h19:pic" });
  P.quote = hub.plantCast({ fid: A, ts: at(5), text: "a quote", embeds: [{ castId: { fid: B, hash: P.short } }], seed: "h19:quote" });
  P.png = hub.plantCast({ fid: B, ts: at(6), text: "a png", embeds: [{ url: "https://example.org/x.png" }], seed: "h19:png" });
  for (let i = 0; i < 6; i++) hub.plantCast({ fid: [A, B, C, D][i % 4], ts: at(7 + i), text: "filler " + i, seed: "h19:fill" + i });
  // past the page (want 10): read for the Following, never on screen
  P.old1 = hub.plantCast({ fid: C, ts: at(30), text: "an older essay", embeds: [{ url: "https://example.org/old1" }], seed: "h19:old1" });
  P.old2 = hub.plantCast({ fid: D, ts: at(31), text: WORDS(90, "oldtwo"), seed: "h19:old2" });
  P.old3 = hub.plantCast({ fid: A, ts: at(32), text: "the priority one", embeds: [{ url: "https://example.org/old3" }], seed: "h19:old3" });
  useRoot(R, "rootr");
  // (a) the rule, and its constant pinned to the slider's own
  assert(copy.HUB_PIECE_MIN_WORDS === readwiseState.LIMITS.chunkWords[0], "the piece threshold is not the slider's shortest piece: " + copy.HUB_PIECE_MIN_WORDS + " vs " + readwiseState.LIMITS.chunkWords[0]);
  const isP = (text, embeds = []) => copy.isHubReadingPiece({ text, embeds });
  assert(isP(WORDS(80)) && !isP(WORDS(79)) && isP("x", [{ url: "https://example.org/a" }]) && isP("x", [{ url: "http://example.org/a" }]) && !isP("x", [{ url: "https://i.imgur.com/a" }]) && !isP("x", [{ url: "https://example.org/a.JPG?x=1" }]) && !isP("x", [{ castId: { fid: 1, hash: "0x" + "1".repeat(40) } }]) && !isP("x", [{ url: "javascript:alert(1)" }]), "the piece rule");
  // (b) through the engine: the page as cards, the pieces marked, nothing spliced, the order the page's
  const v = await settle({ want: 10 });
  assert(Array.isArray(v.cards) && v.extras, "no cards / extras in the answer");
  assert(pageOf(v).map((c) => c.cast.hash).join() === hashes(v).join() && hashes(v).length === 10, "the page's cards are not the page in its order");
  const pieces = pageOf(v).filter((c) => c.piece).map((c) => c.cast.hash).sort();
  assert(pieces.join() === [P.long, P.link].sort().join(), "the pieces on the page: " + pieces.length + " " + JSON.stringify(pageOf(v).filter((c) => c.piece).map((c) => c.cast.text.slice(0, 20))));
  const longCard = cardOf(v, P.long);
  assert(longCard.piece.chunkId === P.long + "#chunk1" && longCard.piece.read === false && longCard.piece.priority === false, "the piece view: " + JSON.stringify(longCard.piece));
  assert(queueOf(v).length === 0 && v.extras.pieces === 2 && v.extras.requeued === 0, "something was spliced into a fresh page");
  await quiet();
  const reads0 = reads().length;
  // (c) dwell: under the threshold (80 words at 240 wpm, half of it = 10 s), then over it — sealed, nothing in the clear
  const req0 = seen.length;
  const d1 = await rwCall({ action: "dwell", chunkId: P.long + "#chunk1", ms: 2000 });
  assert(d1.status === 200 && d1.body.read === false && d1.body.thresholdMs === readwiseState.dwellThresholdMs(WORDS(80, "star")) && d1.body.thresholdMs === 10_000 && d1.body.requeues === 1, "the first dwell: " + JSON.stringify(d1.body));
  const d2 = await rwCall({ action: "dwell", chunkId: P.long + "#chunk1", ms: 9000 });
  assert(d2.status === 200 && d2.body.read === true && d2.body.dwellMs === 11_000, "the second dwell: " + JSON.stringify(d2.body));
  assert(seen.length === req0, "the dwell made a request: " + seen.slice(req0).map((r) => r.url).join(", "));
  const sealed = JSON.stringify(persistStub.validatorStore.get("readwiseState") ?? null);
  assert(sealed.length > 200, "no sealed record was written");
  for (const needle of [P.long, P.long.slice(2), "#chunk", "dwell", "11000"]) assert(!sealed.includes(needle), "the sealed record carries " + needle + " in the clear");
  const v2 = await read.hubTimeline({ want: 10, waitMs: 300 });
  assert(cardOf(v2, P.long).piece.read === true && v2.extras.piecesRead === 1, "the read piece is not shown read");
  // (d) the requeue: unfinished pieces off the page come back through the queue, the mode's cadence knob caps them, a
  //     priority folder first
  for (const h of [P.old1, P.old2, P.old3]) assert((await rwCall({ action: "dwell", chunkId: h + "#chunk1", ms: 400 })).body.read === false, "an old piece read at once");
  const v3 = await read.hubTimeline({ want: 10, waitMs: 300 });
  const q3 = queueOf(v3);
  assert(q3.length === 3 && q3.every((c) => c.kind === "readwise" && c.piece && c.piece.read === false) && q3.map((c) => c.cast.hash).join() === [P.old1, P.old2, P.old3].join(), "the requeue: " + q3.map((c) => c.kind + ":" + c.cast.text.slice(0, 12)).join(", "));
  assert(v3.cards.indexOf(q3[0]) === 4 && v3.cards.indexOf(q3[1]) === 9, "the queue did not splice every 4 posts: " + v3.cards.map((c) => c.placement[0]).join(""));
  registryStub.folderCtl.folders = [{ id: "f_prio", name: "Priority", ownerPersonaId: "pub_self_unit", isPublic: false, postHashes: [P.old3], createdAt: 0 }];
  await readwiseState.setPriorityFolder("f_prio", true);
  modeNow = specOf({ id: "m_rw" });
  await readwiseState.setKnobs("m_rw", { perBuild: 1 });
  const v4 = await read.hubTimeline({ want: 10, waitMs: 300 });
  const q4 = queueOf(v4);
  assert(q4.length === 1 && q4[0].cast.hash === P.old3 && q4[0].piece.priority === true, "the cadence knob or the priority folder: " + q4.map((c) => c.cast.text.slice(0, 12) + ":" + c.piece?.priority).join(", "));
  assert(v4.extras.dropped.filter((d) => d.type === "readwise" && d.reason === "cap").length === 2, "the capped pieces are not listed: " + JSON.stringify(v4.extras.dropped));
  await readwiseState.setKnobs("m_rw", { perBuild: 4 });
  // (e) the mode's hide holds for a requeued piece too
  modeNow = specOf({ id: "m_rw", rules: [ruleOf("r_old2", "Mute old two", "hide", [{ field: "post.text", op: "contains", value: "OLDTWO3" }])] });
  const v5 = await read.hubTimeline({ want: 10, waitMs: 300 });
  assert(queueOf(v5).length === 2 && !cardOf(v5, P.old2), "a piece the mode hides came back: " + queueOf(v5).map((c) => c.cast.text.slice(0, 12)).join(", "));
  modeNow = specOf({ id: "m_rw" });
  // (f) the bin: an off-page piece buried never comes back; an on-page piece buried shows as a plain post; Restore
  const b1 = await rwCall({ action: "bury", chunkId: P.old1 + "#chunk1" });
  const b2 = await rwCall({ action: "bury", chunkId: P.link + "#chunk1" });
  assert(b1.status === 200 && b2.status === 200 && b2.body.buried.text === "an essay worth the time" && b2.body.buried.postHash === P.link, "the bury: " + JSON.stringify([b1.body, b2.body]).slice(0, 300));
  const v6 = await read.hubTimeline({ want: 10, waitMs: 300 });
  assert(!cardOf(v6, P.old1) && cardOf(v6, P.link) && cardOf(v6, P.link).piece === null && cardOf(v6, P.link).placement === "page", "the bin did not take the pieces off");
  const bin = await readwiseState.binEntries();
  assert(bin.some((x) => x.chunkId === P.link + "#chunk1") && bin.some((x) => x.chunkId === P.old1 + "#chunk1"), "the bin does not list them");
  assert((await rwCall({ action: "restore", chunkId: P.link + "#chunk1" })).status === 200, "restore");
  const v7 = await read.hubTimeline({ want: 10, waitMs: 300 });
  assert(cardOf(v7, P.link).piece && cardOf(v7, P.link).piece.chunkId === P.link + "#chunk1", "Restore did not bring the piece back");
  // a piece you finish off the page stops coming back (read is done)
  assert(queueOf(v7).map((c) => c.cast.hash).sort().join() === [P.old2, P.old3].sort().join(), "before reading old3: " + queueOf(v7).map((c) => c.cast.text.slice(0, 12)).join(", "));
  assert((await rwCall({ action: "dwell", chunkId: P.old3 + "#chunk1", ms: 60_000 })).body.read === true, "old3 not read");
  const v8 = await read.hubTimeline({ want: 10, waitMs: 300 });
  assert(queueOf(v8).map((c) => c.cast.hash).join() === P.old2, "a piece read off the page came back: " + queueOf(v8).map((c) => c.cast.text.slice(0, 12)).join(", "));
  // (g) the route refuses a cast it does not hold, a held post that is not a piece, and anything while a persona acts
  const before = JSON.stringify(persistStub.validatorStore.get("readwiseState"));
  const u1 = await rwCall({ action: "dwell", chunkId: "0x" + "ab".repeat(20) + "#chunk1", ms: 5000 });
  const u2 = await rwCall({ action: "dwell", chunkId: P.short + "#chunk1", ms: 5000 });
  const u3 = await rwCall({ action: "dwell", chunkId: P.long + "#chunk2", ms: 5000 });
  assert(u1.status === 404 && u2.status === 404 && u3.status === 404, "a cast not held / not a piece / a second chunk: " + [u1.status, u2.status, u3.status].join(","));
  acting = true;
  const ua = await rwCall({ action: "dwell", chunkId: P.link + "#chunk1", ms: 5000 });
  const ub = await rwCall({ action: "bury", chunkId: P.link + "#chunk1" });
  acting = false;
  assert(ua.status === 409 && ua.body.code === "acting_persona" && ub.status === 409, "while a persona acts: " + ua.status + " " + JSON.stringify(ua.body).slice(0, 120));
  // the route's own reading of the jar: a hub piece is not restored from a persona's tab, nor listed in its pane
  registryStub.modeCtl.modes.set("m_h19", { id: "m_h19", name: "H19", ruleIds: [] });
  registryStub.modeCtl.active.set("pub_self_unit", "m_h19");
  sepStub.sepCtl.acting = true;
  const ur = await rwCall({ action: "restore", chunkId: P.old1 + "#chunk1" });
  const gb = await readwiseRoute.GET();
  sepStub.sepCtl.acting = false;
  const ga = await readwiseRoute.GET();
  assert(ur.status === 409 && ur.body.code === "acting_persona", "a restore from a persona's tab: " + ur.status);
  assert(gb.status === 200 && !gb.body.bin.some((b) => b.chunkId === P.old1 + "#chunk1") && ga.body.bin.some((b) => b.chunkId === P.old1 + "#chunk1"), "the bin a persona's pane lists: " + JSON.stringify(gb.body.bin ?? gb.body).slice(0, 200));
  assert(JSON.stringify(persistStub.validatorStore.get("readwiseState")) === before, "something was written by a refused call");
  // (h) an unreadable state: no marks, no requeue, said — never "nothing read, nothing in the bin"
  readwiseState.resetReadwiseStateCache();
  persistStub.persistCtl.fail = true;
  const vf = await read.hubTimeline({ want: 10, waitMs: 300 });
  persistStub.persistCtl.fail = false;
  readwiseState.resetReadwiseStateCache();
  assert(vf.cards.every((c) => !c.piece) && queueOf(vf).length === 0 && vf.extras.notices.some((n) => n.kind === "readwise_unavailable" && /Couldn.t read your reading queue/.test(n.sentence)) && vf.items.length === 10, "an unreadable readwise state: " + JSON.stringify(vf.extras.notices));
  // (i) unreadable folders weigh nothing and are said
  registryStub.folderCtl.fail = true;
  const vg = await read.hubTimeline({ want: 10, waitMs: 300 });
  registryStub.folderCtl.fail = false;
  assert(vg.extras.notices.some((n) => n.kind === "folders_unreadable") && queueOf(vg).every((c) => !c.piece.priority), "unreadable folders: " + JSON.stringify(vg.extras.notices));
  // (j) none of it read Farcaster's node
  assert(reads().length === reads0, reads().length - reads0 + " node read(s) for the extras: " + JSON.stringify(reads().slice(reads0).map((r) => r.path + "?" + r.fid)));
  registryStub.folderCtl.folders = [];
  return "2 pieces of 6 shapes; dwell sealed (0 requests, nothing in the clear), read at 10 s; 3 requeued every 4 posts, the knob caps to the priority one; the bin and Restore; 409 while a persona acts; 0 node reads";
});

await check("H20", "DESK NOTES ON HUB POSTS (spec C): a subscribed desk's note on (fid, hash) shows on that post on the page (the first by author AND hash: a note naming the hash under another fid is not it); a noted post you liked or recast, off the page, RESURFACES through the queue with the note; one you never liked does not; one this browser does not hold is never read; with your reactions unread nothing resurfaces; the mode's hide holds; desk demote/auto-block said as not applied; an unreadable desk list said; keyed to the root's own subscriptions; zero node reads", async () => {
  fresh();
  let modeNow = null;
  extrasRuntime({ mode: async () => modeNow });
  readwiseState.resetReadwiseStateCache();
  received.resetReceived();
  const R = 950, A = 9501, B = 9502, C = 9503, D = 9504;
  const now = Date.now();
  const at = (k) => { const t = now - k * 60_000; return t - (t % 1000); };
  hub.plantFollows(R, [A, B, C, D].map((f, i) => ({ fid: f, ts: now - (10 - i) * 1000 })));
  const n1 = hub.plantCast({ fid: A, ts: at(1), text: "noted on the page", seed: "h20:n1" });
  for (let i = 0; i < 11; i++) hub.plantCast({ fid: [A, B, C, D][i % 4], ts: at(2 + i), text: "filler " + i, seed: "h20:fill" + i });
  const n2 = hub.plantCast({ fid: B, ts: at(40), text: "liked, noted since", seed: "h20:n2" });
  const n3 = hub.plantCast({ fid: C, ts: at(41), text: "noted, never liked", seed: "h20:n3" });
  const n4 = hub.plantCast({ fid: D, ts: at(42), text: "recast, noted since", seed: "h20:n4" });
  const notHeld = "0x" + "cd".repeat(20);
  const ann = (fid, hash, claim, o = {}) => ({ annotation: { id: "ann_" + claim.length, targetCastId: copy.hubCastTargetId(fid, hash), claim, evidenceLink: "https://example.org/e/" + claim.length, flagsAuthor: !!o.flags }, feed: { name: o.desk ?? "Records Desk" }, action: o.action ?? "badge" });
  annStub.annCtl.list = [
    ann(D, n1, "the wrong author: the same hash under another account"),
    ann(A, n1, "a note on the page"),
    ann(B, n2, "a note on a post you liked"),
    ann(C, n3, "a note on a post you never liked"),
    ann(D, n4, "a note on a post you recast"),
    ann(A, notHeld, "a note on a post this browser never read"),
    { annotation: { id: "ann_seed", targetCastId: "0xas0377", claim: "a Totem post's note", evidenceLink: "", flagsAuthor: false }, feed: { name: "Footnote Desk" }, action: "badge" },
  ];
  annStub.annCtl.asked = [];
  hub.plantReaction({ fid: R, kind: "like", target: { fid: B, hash: n2 }, ts: at(39) });
  hub.plantReaction({ fid: R, kind: "recast", target: { fid: D, hash: n4 }, ts: at(39) });
  useRoot(R, "rootn");
  // (a) before the root's reactions are read: notes show on the page, nothing resurfaces (it can't tell what you liked)
  const v0 = await settle({ want: 10 });
  const c1 = cardOf(v0, n1);
  assert(c1 && c1.placement === "page" && c1.note && c1.note.claim === "a note on the page" && c1.note.desk === "Records Desk" && c1.note.evidenceLink === "https://example.org/e/18", "the note on the page: " + JSON.stringify(c1 && c1.note));
  assert(queueOf(v0).length === 0, "something resurfaced before the reactions were read: " + queueOf(v0).map((c) => c.cast.text).join(", "));
  assert(annStub.annCtl.asked.every((x) => x === "pub_self_unit") && annStub.annCtl.asked.length > 0, "the desks were read under another key: " + JSON.stringify(annStub.annCtl.asked));
  // (b) the cards' own reactions read (POST AS YOU on hub cards: two reads naming the root), then: the liked and the recast
  //     noted posts come back with their notes; the never-liked one does not; the one never read is not read for it
  await read.hubReacted();
  await quiet();
  const reads0 = reads().length;
  const v1 = await read.hubTimeline({ want: 10, waitMs: 300 });
  const q1 = queueOf(v1);
  assert(q1.length === 2 && q1.every((c) => c.kind === "correction" && c.note) && q1.map((c) => c.cast.hash).sort().join() === [n2, n4].sort().join(), "resurfaced: " + q1.map((c) => c.kind + ":" + c.cast.text).join(", "));
  assert(cardOf(v1, n2).note.claim === "a note on a post you liked" && v1.extras.notes.onPage === 1 && v1.extras.notes.resurfaced === 2, "the resurfaced note or the counts: " + JSON.stringify(v1.extras.notes));
  assert(!cardOf(v1, n3), "a noted post you never liked resurfaced");
  assert(v1.cards.filter((c) => c.cast.hash === n1).length === 1, "the noted post on the page has a second card");
  // (c) the mode's hide holds for a resurfaced post
  modeNow = specOf({ id: "m_n", rules: [ruleOf("r_n2", "Mute it", "hide", [{ field: "post.text", op: "contains", value: "liked, noted" }])] });
  const v2 = await read.hubTimeline({ want: 10, waitMs: 300 });
  assert(!cardOf(v2, n2) && queueOf(v2).length === 1, "a post the mode hides resurfaced: " + queueOf(v2).map((c) => c.cast.text).join(", "));
  modeNow = null;
  // (d) a desk that demotes or auto-blocks a flagged author: said as not applied to Farcaster accounts (the note shows)
  annStub.annCtl.list = [...annStub.annCtl.list, ann(C, n3, "flags the author", { action: "autoblock", flags: true })];
  const v3 = await read.hubTimeline({ want: 10, waitMs: 300 });
  assert(v3.extras.notices.some((n) => n.kind === "desk_actions" && /don.t act on Farcaster accounts yet/.test(n.sentence)), "the desk actions not said: " + JSON.stringify(v3.extras.notices));
  // (e) the desk list unreadable: no notes, said; the Following itself still shows
  annStub.annCtl.fail = true;
  const v4 = await read.hubTimeline({ want: 10, waitMs: 300 });
  annStub.annCtl.fail = false;
  assert(v4.cards.every((c) => !c.note) && queueOf(v4).length === 0 && v4.extras.notices.some((n) => n.kind === "notes_unreadable") && v4.items.length === 10, "an unreadable desk list: " + JSON.stringify(v4.extras.notices));
  // (f) zero node reads for any of it (no castById for the post never read, no profile for a resurfaced author)
  assert(reads().length === reads0, reads().length - reads0 + " node read(s) for the notes: " + JSON.stringify(reads().slice(reads0).map((r) => r.path + "?" + r.fid)));
  annStub.annCtl.list = [];
  return "on the page (by author and hash); 2 resurfaced (a like, a recast), not the unliked one, not one never read; the mode's hide holds; desk actions and an unreadable list said; 0 node reads";
});

await check("H21", "CLOSE-FRIEND SENDS THROUGH A RING (spec C): the ring's owner sends a post by its id only (refused while a persona acts and for an own persona's post, nothing written); it rides the sealed statement with the ring's share-as name; the member's device opens it (memory only) and its Following shows it: on the page as 'Sent to you by', off the page spliced through the one queue, a post it does not hold counted and said, never read; a send naming the hash under another author is not it; the statement validator refuses a malformed send; a send never makes a ring's note stop fitting; past three days it is not sealed or shown; one post noted, sent and requeued is ONE card; zero node reads", async () => {
  fresh();
  let modeNow = null;
  extrasRuntime({ mode: async () => modeNow });
  readwiseState.resetReadwiseStateCache();
  received.resetReceived();
  annStub.annCtl.list = [];
  sepStub.sepCtl.acting = false;
  sepStub.sepCtl.own = new Set();
  const R = 940, A = 9401, B = 9402, C = 9403, OWN = 9409;
  const now = Date.now();
  const at = (k) => { const t = now - k * 60_000; return t - (t % 1000); };
  hub.plantFollows(R, [A, B, C].map((f, i) => ({ fid: f, ts: now - (10 - i) * 1000 })));
  const s1 = hub.plantCast({ fid: A, ts: at(1), text: "sent, on the page", seed: "h21:s1" });
  for (let i = 0; i < 11; i++) hub.plantCast({ fid: [A, B, C][i % 3], ts: at(2 + i), text: "filler " + i, seed: "h21:fill" + i });
  const s2 = hub.plantCast({ fid: B, ts: at(40), text: "sent, off the page", seed: "h21:s2" });
  const s3 = hub.plantCast({ fid: C, ts: at(41), text: "sent, noted and unfinished", embeds: [{ url: "https://example.org/s3" }], seed: "h21:s3" });
  const notHeld = "0x" + "ef".repeat(20);
  // ---- the owner's side (this process's rings document)
  const { id: ringId } = await ringsOut.createRing("Close", "Jordan");
  const stored = () => JSON.stringify(persistStub.validatorStore.get("rings") ?? null);
  const before = stored();
  sepStub.sepCtl.acting = true;
  const r1 = await errOf(ringsOut.sendToRing(ringId, { fid: A, hash: s1 }));
  sepStub.sepCtl.acting = false;
  sepStub.sepCtl.own = new Set([OWN]);
  const r2 = await errOf(ringsOut.sendToRing(ringId, { fid: OWN, hash: s1 }));
  const r3 = await errOf(ringsOut.sendToRing(ringId, { fid: A, hash: "0x12" }));
  assert(r1 && r1.name === "RingSendRefused" && r1.status === 409 && r1.code === "acting_persona", "a send while a persona acts: " + (r1 ? r1.name + " " + r1.code : "sent"));
  assert(r2 && r2.name === "RingSendRefused" && r2.status === 403 && r2.code === "own_persona", "a send of an own persona's post: " + (r2 ? r2.name + " " + r2.code : "sent"));
  assert(r3 && /names a Farcaster post/.test(r3.message), "a malformed target: " + (r3 ? r3.message : "sent"));
  assert(stored() === before, "a refused send wrote the rings document");
  for (const [fid, hash] of [[C, s3], [A, notHeld], [B, s2], [A, s1]]) await ringsOut.sendToRing(ringId, { fid, hash });
  const again = await ringsOut.sendToRing(ringId, { fid: B, hash: s2 }); // sent again: one entry, on top
  assert(again.sends === 4 && again.members === 0, "the send's answer: " + JSON.stringify(again));
  const doc = await ringsModel.loadRingsDoc();
  const ring = doc.rings[ringId];
  assert(ring.sends.length === 4 && ring.sends[0].hash === s2 && new Set(ring.sends.map((s) => s.hash)).size === 4, "the ring's sends: " + JSON.stringify(ring.sends));
  assert(!stored().includes(s2) && !stored().includes(s2.slice(2)), "the rings document carries a sent hash in the clear");
  // ---- the member: an address (its keys), the owner's statement sealed to it, opened as the tick would
  const { randomBytes } = await import("node:crypto");
  const key = await envelope.inboxKeyFrom(new Uint8Array(randomBytes(32)), new Uint8Array(randomBytes(32)));
  const m = { id: "0".repeat(16), kind: "address", addrId: key.addrId, pkHex: key.pkHex, pskHex: key.pskHex, label: null, addedAt: 0, seq: 0, since: {}, hiddenAt: null };
  const stmt = ringsOut.buildStatement(doc, ring, m, null, [], Date.now());
  assert(stmt.label === "Jordan" && stmt.sends.length === 4 && stmt.sends.every((s) => Object.keys(s).sort().join() === "at,fid,hash"), "the statement's sends: " + JSON.stringify(stmt.sends));
  assert(!JSON.stringify(stmt).includes("sent, off the page"), "a send carried the post's text");
  const sealedRow = await envelope.sealStatement(stmt, m);
  const fetched = (rows) => ({ full: true, nowHour: 0, count: rows.length, rows: rows.map((x, i) => ({ id: String(i).padStart(32, "a"), enc: x.enc, ct: x.ct, hint: x.hint, expiresHour: 0 })), at: Date.now() });
  await received.applyFetch(fetched([sealedRow]), [key]);
  const rs = received.receivedSends();
  assert(rs.length === 4 && rs.every((x) => x.from === "Jordan") && rs.map((x) => x.hash).sort().join() === [s1, s2, s3, notHeld].sort().join(), "what the member received: " + JSON.stringify(rs));
  // ---- the member's Following (this harness's root): on the page, spliced, not held
  useRoot(R, "roots");
  const v0 = await settle({ want: 10 });
  await quiet();
  const reads0 = reads().length;
  const v = await read.hubTimeline({ want: 10, waitMs: 300 });
  assert(cardOf(v, s1).placement === "page" && cardOf(v, s1).sentBy === "Jordan" && v.cards.filter((c) => c.cast.hash === s1).length === 1, "the sent post on the page: " + JSON.stringify(cardOf(v, s1) && { p: cardOf(v, s1).placement, s: cardOf(v, s1).sentBy }));
  const q = queueOf(v);
  assert(q.length === 2 && q.every((c) => c.kind === "sent" && c.sentBy === "Jordan") && q.map((c) => c.cast.hash).sort().join() === [s2, s3].sort().join(), "spliced: " + q.map((c) => c.kind + ":" + c.cast.text).join(", "));
  assert(v.extras.sent.notHeld === 1 && v.extras.notices.some((n) => n.kind === "sent_not_held" && /1 post sent to you isn.t shown/.test(n.sentence)), "the post not held: " + JSON.stringify(v.extras.sent) + " " + JSON.stringify(v.extras.notices));
  assert(v0.cards.length === v.cards.length, "the answers differ");
  // the mode's hide holds for a sent post
  modeNow = specOf({ id: "m_s", rules: [ruleOf("r_s2", "Mute it", "hide", [{ field: "post.text", op: "contains", value: "sent, off" }])] });
  const vm = await read.hubTimeline({ want: 10, waitMs: 300 });
  assert(!cardOf(vm, s2) && queueOf(vm).length === 1, "a sent post the mode hides was spliced");
  modeNow = null;
  // ---- ONE card for one post: s3 noted (and recast), sent, and an unfinished piece — the correction wins, the others drop
  annStub.annCtl.list = [{ annotation: { id: "ann_s3", targetCastId: copy.hubCastTargetId(C, s3), claim: "noted", evidenceLink: "", flagsAuthor: false }, feed: { name: "Desk" }, action: "badge" }];
  hub.plantReaction({ fid: R, kind: "recast", target: { fid: C, hash: s3 }, ts: at(5) });
  assert(reads().length === reads0, reads().length - reads0 + " node read(s) for the sends");
  await read.hubReacted();
  const readsR = reads().length;
  await rwCall({ action: "dwell", chunkId: s3 + "#chunk1", ms: 300 });
  const vd = await read.hubTimeline({ want: 10, waitMs: 300 });
  const s3cards = vd.cards.filter((c) => c.cast.hash === s3);
  assert(s3cards.length === 1 && s3cards[0].kind === "correction", "one post, several extras: " + s3cards.map((c) => c.kind).join(","));
  const dups = vd.extras.dropped.filter((d) => d.reason === "duplicate").map((d) => d.type).sort().join();
  assert(dups === "readwise,sent", "the duplicates are not listed: " + JSON.stringify(vd.extras.dropped));
  annStub.annCtl.list = [];
  // ---- a FAILED read of the drop hides what was received (never a stale send shown), the next full read brings it back
  await received.applyFetch({ full: false, error: "down", at: Date.now() }, [key]);
  assert(received.receivedSends().length === 0, "a failed read still shows sends");
  await received.applyFetch(fetched([sealedRow]), [key]);
  assert(received.receivedSends().length === 4, "the next full read did not bring them back");
  // ---- three days: an old send is not sealed by the owner, and not shown by a member that got one anyway
  const oldRing = { ...ring, sends: [{ fid: B, hash: s2, at: Date.now() - 73 * 3_600_000 }] };
  assert(ringsOut.liveSends(oldRing, Date.now()).length === 0 && !("sends" in ringsOut.buildStatement(doc, oldRing, m, null, [], Date.now())), "a send older than three days is still sealed");
  const oldStmt = { ...stmt, seq: stmt.seq + 1, sends: [{ fid: B, hash: s2, at: Date.now() - 73 * 3_600_000 }] };
  received.resetReceived();
  await received.applyFetch(fetched([await envelope.sealStatement(oldStmt, m)]), [key]);
  assert(received.receivedSends().length === 0, "a member shows a send older than three days");
  received.resetReceived();
  // ---- the statement validator: a malformed send refuses the WHOLE statement
  const okStmt = JSON.parse(JSON.stringify(stmt));
  assert(envelope.validateStatement(okStmt, m.addrId, Date.now()).ok === true, "the good statement is refused");
  const bad = (sends) => envelope.validateStatement({ ...okStmt, sends }, m.addrId, Date.now());
  const one = okStmt.sends[0];
  const cases = { five: [...okStmt.sends, one], badHash: [{ ...one, hash: "0x12" }], extraKey: [{ ...one, text: "words" }], future: [{ ...one, at: Date.now() + 3_600_000 }], fidZero: [{ ...one, fid: 0 }], notArray: { ...one } };
  for (const [name, sends] of Object.entries(cases)) assert(bad(sends).ok === false, "a malformed send accepted: " + name);
  // ---- a send never makes a ring's note stop fitting: dropped before the note is refused
  const fill = (n, len) => Array.from({ length: n }, (_, i) => ({ ref: i.toString(16).padStart(16, "0"), handle: "h" + i, display: "x".repeat(len), kind: "persona", depth: "name" }));
  let big = { ...okStmt, subjects: fill(16, 10) };
  const sendsBytes = JSON.stringify(okStmt.sends).length + 10;
  for (let len = 10; len < 400; len++) {
    const t = { ...okStmt, subjects: fill(16, len) };
    const noSends = { ...t };
    delete noSends.sends;
    const a = new TextEncoder().encode(JSON.stringify(noSends)).length;
    if (a > envelope.ENVELOPE_PLAINTEXT_BYTES - sendsBytes / 2 && a <= envelope.ENVELOPE_PLAINTEXT_BYTES) {
      big = t;
      break;
    }
  }
  const enc = envelope.encodeStatement(big);
  const decoded = JSON.parse(new TextDecoder().decode(enc.bytes));
  assert(enc.sendsDropped === true && !("sends" in decoded) && decoded.subjects.length === 16, "a note that fits only without its sends: " + JSON.stringify({ dropped: enc.sendsDropped, has: "sends" in decoded }));
  const tooBig = { ...okStmt, subjects: fill(16, 400) };
  assert((await errOf(Promise.resolve().then(() => envelope.encodeStatement(tooBig)))).name === "RingStatementTooLarge", "an oversize note was not refused");
  // ---- the pure rule: a send naming a hash under another author is not that post
  const recA = { hash: s2, fid: B, ts: 1, text: "x", embeds: [] };
  const shaped = hubExtras.shapeExtras({ page: [], held: new Map([[s2, recA]]), engaged: null, spec: { readwise: { state: "unavailable" }, notes: { state: "ok", list: [] }, sends: [{ fid: A, hash: s2, at: 1, from: "Jordan" }] } });
  assert(shaped.cards.length === 0 && shaped.view.sent.notHeld === 1, "a send under another author was shown: " + JSON.stringify(shaped.view.sent));
  // ---- zero node reads for any of it (beyond the cards' own two reactions reads, which name the root only)
  assert(reads().length === readsR && readsR - reads0 === 2, "node reads for the extras: " + (reads().length - readsR) + " after, " + (readsR - reads0) + " for the reactions");
  return "refused while acting / own persona, nothing written; 4 sends by id under 'Jordan'; on the page + 2 spliced + 1 not held (said); the mode's hide; one card for three extras; failed read hides; 3 days; 6 malformed refused; dropped before refusing; 0 node reads";
});

if (!MUTATIONS.length && ONLY.length === 0) {
  const F = "lib/fc/hubRead/read.ts";
  const MF = "lib/fc/hubRead/mode.ts";
  const SF = "lib/fc/hubRead/modeSource.ts";
  const runs = [
    ["a failed follows read swallowed into an empty list", "H6", [{ file: F, find: "      else e.follows = { ...e.follows, state: \"failed\", p: null };", replace: "      else e.follows = { ...e.follows, list: [], state: \"ok\", at: rt.now(), p: null };" }]],
    ["every read failing reported as no posts", "H6", [{ file: F, find: "  const allFailed = settled && selected > 0 && m.ok === 0 && m.failed === selected;", replace: "  const allFailed = false;" }]],
    ["accounts that failed are not counted", "H6", [{ file: F, find: "    partial: m.failed > 0 && !allFailed ? { failed: m.failed, sentence: partialSentence(m.failed, selected) } : null,", replace: "    partial: null," }]],
    ["the fan-out cap removed", "H4", [{ file: F, find: "  const sel = [e.fid, ...list.slice(0, L.maxTimelineAccounts).map((f) => f.fid).filter((f) => !isOwn(f))];", replace: "  const sel = [e.fid, ...list.map((f) => f.fid).filter((f) => !isOwn(f))];" }]],
    ["a followed own persona read on the timeline", "H15", [{ file: F, find: "  const sel = [e.fid, ...list.slice(0, L.maxTimelineAccounts).map((f) => f.fid).filter((f) => !isOwn(f))];", replace: "  const sel = [e.fid, ...list.slice(0, L.maxTimelineAccounts).map((f) => f.fid)];" }]],
    ["an own persona's profile read from the node", "H15", [{ file: F, find: "  if (isOwn(fid)) {\n    // PERSONA SEPARATION: an own persona's name comes from its vault record", replace: "  if (false) {\n    // PERSONA SEPARATION: an own persona's name comes from its vault record" }]],
    ["a cast by an own persona read (quote, ancestor)", "H15", [{ file: F, find: "  if (isOwn(fid)) {\n    // PERSONA SEPARATION: a cast by an own persona is never read as the root", replace: "  if (false) {\n    // PERSONA SEPARATION: a cast by an own persona is never read as the root" }]],
    ["the last-word guard removed (a queued read leaves after a switch)", "H15", [{ file: F, find: "  if (await rt.acting()) throw new HubFail(\"own\");\n  for (const m of path.matchAll(/[?&](?:target_)?fid=(\\d+)/g)) if (isOwn(Number(m[1]))) throw new HubFail(\"own\");", replace: "" }]],
    ["the ops answer while a persona acts", "H15", [{ file: F, find: "  if (await rt.acting()) {\n    gr.__layersHubOwn = null;\n    throw new HubReadError(\"acting_persona\");\n  }", replace: "" }]],
    ["an own persona's thread read", "H15", [{ file: F, find: "  if (isOwn(fid)) throw new HubReadError(\"own_persona\");\n  const main = await ensureCast(rt, fid, h);", replace: "  const main = await ensureCast(rt, fid, h);" }]],
    ["the concurrency limit removed", "H4", [{ file: F, find: "  while (n.busy >= L.concurrency) await", replace: "  while (false) await" }]],
    ["the horizon removed", "H3", [{ file: F, find: "  const visible = h ? merged.filter((r) => cmpKey(r, h) >= 0) : merged;", replace: "  const visible = merged;" }]],
    ["oldest first", "H3", [{ file: F, find: "const newestFirst = (a: Rec, b: Rec): number => cmpKey(b, a);", replace: "const newestFirst = (a: Rec, b: Rec): number => cmpKey(a, b);" }]],
    ["future-dated casts kept in the order", "H3", [{ file: F, find: "        if (r.ts > limit) future++;\n        else all.push(r);", replace: "        all.push(r);" }]],
    ["a 429 does not pause the reads", "H8", [{ file: F, find: "        n.pausedUntil = Math.max(n.pausedUntil, Date.now() + retryAfterMs(res.headers.get(\"retry-after\"), Date.now()));", replace: "" }]],
    ["a failure read as not found", "H11", [{ file: F, find: "        } else if (res.status === 400 && /notfound|not found/i.test(text)) return { kind: \"not_found\" };", replace: "        } else if (res.status === 400 || res.status >= 500) return { kind: \"not_found\" };" }]],
    ["a refresh re-reads every account", "H9", [{ file: F, find: "    const due = kind === \"manual\" ? now - s.checkedAt >= L.manualRefreshFloorMs || s.nextCheckAt <= now : s.nextCheckAt <= now;", replace: "    const due = true;" }]],
    ["the root's own post is not told to the timeline", "H10", [{ file: "lib/fc/rootSigner/flow.ts", find: "    emitRootCast({ kind: \"cast\", fid: acct.fid, hash, text: t, at: rt.now(), parent });", replace: "" }]],
    ["a record under another fid is kept", "H13", [{ file: F, find: "    const recs = raw.map(recOf).filter((r): r is Rec => !!r && r.fid === fid);", replace: "    const recs = raw.map(recOf).filter((r): r is Rec => !!r);" }]],
    ["the route reads the body on a server", "H1", [{ file: "app/api/fc/hub/route.ts", find: "  // FIRST, before the body is read: no server reads a visitor's graph\n  if (typeof window === \"undefined\") return deviceOnly();", replace: "  await req.json().catch(() => null);\n  if (typeof window === \"undefined\") return deviceOnly();" }]],
    ["another root keeps the previous root's graph", "H14", [{ file: F, find: "  if (cur && cur.fid === acct.fid) {", replace: "  if (cur) {" }]],
    ["what is on screen blinks out when the horizon moves while filling", "H5", [{ file: F, find: "  if (!settled || busy(e)) {\n    const cut = new Set(m.visible.map((r) => r.hash));", replace: "  if (false) {\n    const cut = new Set(m.visible.map((r) => r.hash));" }]],
    ["the root shows as a bare number until its profile is read", "H10", [{ file: F, find: "  return e && e.fid === fid && e.rootProfile.username ? e.rootProfile : null;", replace: "  return null;" }]],
    // POST AS YOU ON HUB CARDS (the pressed state)
    ["the reactions op answers while a persona acts", "H16", [{ file: F, find: "export async function hubReacted(opts: { refresh?: boolean } = {}): Promise<HubReactedView> {\n  const rt = gate();\n  await admit(rt);", replace: "export async function hubReacted(opts: { refresh?: boolean } = {}): Promise<HubReactedView> {\n  const rt = gate();" }]],
    ["a failed reactions read reads as 'not liked'", "H16", [{ file: F, find: '      if (r.state !== "ok") r.state = "failed";', replace: '      r.state = "ok";' }]],
    ["past one page, older cards read as 'not liked'", "H16", [{ file: F, find: "    return { hashes, horizon: more ? oldest ?? Number.MAX_SAFE_INTEGER : null };", replace: "    return { hashes, horizon: null };" }]],
    ["another account's reaction counted as the root's", "H16", [{ file: F, find: '      if (!d || d.type !== "MESSAGE_TYPE_REACTION_ADD" || d.fid !== fid || !b || b.type !== want) continue;', replace: '      if (!d || !b) continue;' }]],
    ["this tab's like is not pressed at once", "H16", [{ file: F, find: "          if (r && r.fid === ev.fid) r.local.set(ev.reaction + \":\" + ev.target.hash, { on: ev.on, at: ev.at });", replace: "" }]],
    ["the flow does not tell its likes", "H16", [{ file: "lib/fc/rootSigner/flow.ts", find: '    emitRootCast({ kind: "react", fid: acct.fid, reaction, target: { fid: target.fid, hash: target.hash }, on: !remove, at: rt.now() });', replace: "" }]],
    ["an own persona's card is not marked", "H16", [{ file: F, find: "    isOwn(r.fid) ? { hubOwn: true as const } : {}", replace: "    {}" }]],
    // SPEC A: your mode on Following
    ["a mode's hide rule ignored on Following", "H17", [{ file: MF, find: "    if (act.hide) {\n      hidden++;", replace: "    if (false) {\n      hidden++;" }]],
    ["hide-replies ignored", "H17", [{ file: MF, find: "    if (spec.hideReplies && p.reply) {", replace: "    if (false) {" }]],
    ["an author rule lets Farcaster strangers through", "H17", [{ file: MF, find: "    if (authorHide) {", replace: "    if (false) {" }]],
    ["never-miss pins every post of an account", "H17", [{ file: MF, find: "    if (!pinnedWant.has(p.hash) || pinnedAuthors.has(p.fid)) continue;", replace: "    if (!pinnedWant.has(p.hash)) continue;" }]],
    ["the never-miss cap removed", "H17", [{ file: MF, find: "    if (pinned.size >= pinCap) break;\n", replace: "" }]],
    ["quiet does not sink", "H17", [{ file: MF, find: "      quiet: (r) => quiet.has(r.p.hash),", replace: "      quiet: () => false," }]],
    ["the tiers left out of the rule context (inert on Farcaster posts)", "H17", [{ file: MF, find: '    delivery: { tier: spec.tiers.get(p.fid) ?? "normal" },', replace: '    delivery: { tier: "normal" },' }]],
    ["the mode's ranking does not order the page (a lens does nothing)", "H17", [{ file: MF, find: "      rank: (r) => score.get(r.p.hash) as number,", replace: "      rank: () => 0," }]],
    ["a count-based mode weight quietly left out (not said)", "H17", [{ file: MF, find: "  if (w(spec.ranking.engagement) !== 0)", replace: "  if (false)" }]],
    ["a count-based lens weight quietly left out (not said)", "H17", [{ file: MF, find: "      if (HUB_LENS_SIGNALS.has(s) || w(spec.lens.spec.signals[s]) === 0) continue;", replace: "      continue;" }]],
    ["'Your mode hid all N posts' never said", "H17", [{ file: F, find: "      hidAll: page.length > 0 && s.items.length === 0,", replace: "      hidAll: false," }]],
    ["a mode that cannot be read serves the page unfiltered", "H17", [{ file: F, find: '  if ("error" in mode) return { items: [], view:', replace: '  if ("error" in mode) return { items: page, view:' }]],
    ["the mode applied before the page is cut (a mode changes what is read and shown)", "H17", [{ file: F, find: "  e.shownFids = fidsFor(page);\n  for (const f of e.shownFids) void ensureProfile(rt, f);\n  void quotesFor(rt, page);\n  const shaped = modeOf(page, mode, now, e.want);", replace: "  const shaped = modeOf(shown, mode, now, e.want);\n  shaped.items = shaped.items.slice(0, e.want);\n  e.shownFids = fidsFor(shaped.items);\n  for (const f of e.shownFids) void ensureProfile(rt, f);\n  void quotesFor(rt, shaped.items);" }]],
    ["a persona chosen while the mode is read still gets the root's page", "H17", [{ file: F, find: "  if (await rt.acting()) {\n    gr.__layersHubOwn = null;\n    throw new HubReadError(\"acting_persona\");\n  }\n  return view(e, rt, mode, extras);", replace: "  return view(e, rt, mode, extras);" }]],
    ["the shared per-post decision skips push-down", "H17", [{ file: "lib/rules/evaluate.ts", find: '    if (a !== "hide" && a !== "pin" && a !== "banner" && a !== "downrank") continue;', replace: '    if (a !== "hide" && a !== "pin" && a !== "banner") continue;' }]],
    ["a muted word matched only in its own case", "H17", [{ file: "lib/rules/evaluate.ts", find: "actual.toLowerCase().includes(expected.toLowerCase())", replace: "actual.includes(expected)" }]],
    ["the mode read under another key than the routes'", "H18", [{ file: SF, find: "    viewer = activeSeedPersonaId();", replace: '    viewer = "";' }]],
    ["a rule the mode names but cannot resolve is skipped", "H18", [{ file: SF, find: "    if (!rule || !isWellFormedGroup(rule.root) || validateRuleGroup(rule.root).length) throw new HubModeError(hubModeRuleErrorSentence(mode.name));\n    rules.push(rule);", replace: "    if (!rule) continue;\n    rules.push(rule);" }]],
    ["a rule tree the evaluator cannot walk is accepted", "H18", [{ file: SF, find: "!rule || !isWellFormedGroup(rule.root) ||", replace: "!rule ||" }]],
    ["an unreadable mode read as no mode", "H18", [{ file: SF, find: "  } catch {\n    throw new HubModeError(HUB_MODE_ERROR_SENTENCE);\n  }\n  const rules = [];", replace: "  } catch {\n    return null as never;\n  }\n  const rules = [];" }]],
    ["an unreadable tier map left unsaid", "H18", [{ file: SF, find: "    tiersUnreadable = true;\n", replace: "" }]],
    ["a persona-keyed tier applied to Farcaster posts", "H18", [{ file: SF, find: "      if (fid !== null) tiers.set(fid, tier);", replace: "      tiers.set(fid ?? -1, tier);" }]],
    // SPEC C: readwise, desk notes and sends on the real Following
    ...(() => {
      const EF = "lib/fc/hubRead/extras.ts";
      const XS = "lib/fc/hubRead/extrasSource.ts";
      const CP = "lib/fc/hubRead/copy.ts";
      const EV = "lib/rings/envelope.ts";
      const OB = "lib/rings/outbound.ts";
      const RC = "lib/rings/received.ts";
      return [
        ["a piece in the bin keeps its reading chrome", "H19", [{ file: EF, find: "    if (rw.buried.has(chunkId)) return null; // in the bin", replace: "    if (false) return null; // in the bin" }]],
        ["a buried piece is requeued", "H19", [{ file: EF, find: "      if (!d || d.read || rw.buried.has(id)) continue;", replace: "      if (!d || d.read) continue;" }]],
        ["a piece you finished is requeued", "H19", [{ file: EF, find: "      if (!d || d.read || rw.buried.has(id)) continue;", replace: "      if (!d || rw.buried.has(id)) continue;" }]],
        ["the requeue ignores the mode's cadence knob", "H19", [{ file: EF, find: "caps: { readwise: rw ? rw.perBuild : 0 }", replace: "caps: { readwise: 99 }" }]],
        ["an extra brings back a post the mode hides", "H19", [{ file: EF, find: "const offPage = (r: R | null): r is R => !!r && !onPage.has(r.hash) && !hides(r);", replace: "const offPage = (r: R | null): r is R => !!r && !onPage.has(r.hash);" }]],
        ["the extras skip the mode's own per-post decision", "H19", [{ file: MF, find: "  return ruleActions([...spec.deliveryRules, ...spec.rules], hubEvalContext(p, spec, now)).hide;", replace: "  return false;" }]],
        ["a note resurfaces a post you never liked", "H20", [{ file: EF, find: "      if (!offPage(r) || !engaged.has(r.hash)) continue;", replace: "      if (!offPage(r)) continue;" }]],
        ["a note matched by hash alone (another author's)", "H20", [{ file: EF, find: "    const n0 = notes.find((x) => x.hash === r.hash && x.fid === r.fid);", replace: "    const n0 = notes.find((x) => x.hash === r.hash);" }]],
        ["a note resurfaces while your reactions are unread", "H20", [{ file: F, find: "  let engaged: Set<string> | null = null;", replace: "  let engaged: Set<string> | null = new Set(held.map((x) => x.hash));" }]],
        ["a sent post this browser does not hold goes unsaid", "H21", [{ file: EF, find: "    if (!r) {\n      notHeld++;\n      continue;\n    }", replace: "    if (!r) {\n      continue;\n    }" }]],
        ["a send naming the hash under another author shown as that post", "H21", [{ file: EF, find: "    return r && r.fid === fid ? r : null;", replace: "    return r ?? null;" }]],
        ["the one queue's dedupe removed (one post, several cards)", "H21", [{ file: "lib/injection.ts", find: '    if (seen.has(item.sourceHash)) {\n      dropped.push({ type: item.type, reason: "duplicate", sourceHash: item.sourceHash });', replace: '    if (false) {\n      dropped.push({ type: item.type, reason: "duplicate", sourceHash: item.sourceHash });' }]],
        ["an unreadable readwise state read as empty (what you dismissed comes back)", "H19", [{ file: XS, find: '  } catch {\n    return { state: "unavailable" };\n  }', replace: '  } catch {\n    return { state: "ok", dwell: {}, buried: new Set(), priority: new Set(), perBuild: 4, foldersUnreadable: false };\n  }' }]],
        ["unreadable folders left unsaid", "H19", [{ file: XS, find: "      foldersUnreadable = true;\n", replace: "" }]],
        ["an unreadable desk list read as no desks", "H20", [{ file: XS, find: '  } catch {\n    return { state: "unreadable" };\n  }', replace: '  } catch {\n    return { state: "ok", list: [] };\n  }' }]],
        ["the desks read under another key than the routes'", "H20", [{ file: XS, find: "    viewer = activeSeedPersonaId();", replace: '    viewer = "";' }]],
        ["a dwell or a bin entry written while a persona acts", "H19", [{ file: F, find: "  const rt = gate();\n  await admit(rt);\n  const e = ge.__layersHubEngine;\n  if (!e) return null;", replace: "  const rt = gate();\n  const e = ge.__layersHubEngine;\n  if (!e) return null;" }]],
        ["any held post taken as a reading piece by the route", "H19", [{ file: F, find: "  if (!rec || e.removed.has(h) || isOwn(rec.fid) || !isHubReadingPiece(rec)) return null;", replace: "  if (!rec) return null;" }]],
        ["a hub piece restored from a persona's tab", "H19", [{ file: "app/api/readwise/route.ts", find: "      if (HUB_PIECE_RE.test(chunkId) && (await personaActsHere()))", replace: "      if (false)" }]],
        ["a persona's pane lists the root's reading pieces", "H19", [{ file: "app/api/readwise/route.ts", find: "      bin: (await binEntries()).filter((b) => !(HUB_PIECE_RE.test(b.chunkId) && hubActing)),", replace: "      bin: await binEntries()," }]],
        ["the route swallows the persona refusal into 'unknown'", "H19", [{ file: "app/api/readwise/route.ts", find: '      if (e instanceof HubReadError && e.code === "acting_persona") throw new HubPieceRefused(409, e.code, e.message);', replace: '      if (e instanceof HubReadError && e.code === "acting_persona") return null;' }]],
        ["a picture counted as a link to read", "H19", [{ file: CP, find: "    if (!hubEmbedIsImage(e.url, host)) return true;", replace: "    return true;" }]],
        ["the piece threshold drifts from the slider's shortest piece", "H19", [{ file: CP, find: "export const HUB_PIECE_MIN_WORDS = 80;", replace: "export const HUB_PIECE_MIN_WORDS = 79;" }]],
        ["more than four sends accepted", "H21", [{ file: EV, find: '    if (!Array.isArray(s.sends) || s.sends.length > MAX_RING_SENDS) return { ok: false, reason: "sends" };', replace: '    if (!Array.isArray(s.sends)) return { ok: false, reason: "sends" };' }]],
        ["a send carrying more than its id accepted", "H21", [{ file: EV, find: '      if (!x || typeof x !== "object" || Object.keys(x).sort().join() !== "at,fid,hash") return { ok: false, reason: "send shape" };', replace: '      if (!x || typeof x !== "object") return { ok: false, reason: "send shape" };' }]],
        ["a send makes a ring's note stop fitting", "H21", [{ file: EV, find: "  if (raw.length > ENVELOPE_PLAINTEXT_BYTES && s.sends?.length) {", replace: "  if (false) {" }]],
        ["a send while a persona acts", "H21", [{ file: OB, find: '  if (acting) throw new RingSendRefused(409, "acting_persona", HUB_READ_SENTENCES.acting_persona);', replace: "" }]],
        ["a send of an own persona's post", "H21", [{ file: OB, find: '  if (own.has(fid as number)) throw new RingSendRefused(403, "own_persona", HUB_READ_SENTENCES.own_persona);', replace: "" }]],
        ["a send older than three days sealed", "H21", [{ file: OB, find: "    .filter((s) => s.at > now - RING_SEND_TTL_MS && s.at <= now + 5 * 60_000)", replace: "    .filter(() => true)" }]],
        ["a send shown from a drop read that failed", "H21", [{ file: RC, find: "    if (!renderable(rec, now)) continue;\n    for (const x of rec.sends ?? []) {", replace: "    for (const x of rec.sends ?? []) {" }]],
        ["a member shows a send older than three days", "H21", [{ file: RC, find: "      if (x.at <= now - RING_SEND_TTL_MS) continue;\n", replace: "" }]],
      ];
    })(),
  ];
  await check("M", "MUTATIONS: each guard removed in the bundle only — the check that covers it FAILS (" + runs.length + " mutations)", async () => {
    const survived = [];
    for (const [label, target, muts] of runs) {
      const r = spawnSync(process.execPath, [SELF, "--only=" + target], {
        cwd: ROOT,
        env: { ...process.env, HUBREAD_MUTATION: JSON.stringify(muts), HUBREAD_UNIT_QUIET: "1", KEYSTORE_DIR: "" },
        encoding: "utf8",
        timeout: 300_000,
      });
      const tail = (r.stdout || "").trim().split("\n").pop() || "";
      if (r.status === 2) survived.push(label + " (could not be applied: " + (r.stdout || r.stderr || "").trim().slice(0, 160) + ")");
      else if (r.status === 0) survived.push(label + " (" + target + " still passed)");
      else if (!new RegExp("FAILED: .*\\b" + target + "\\b").test(tail)) survived.push(label + " (the run failed, but not " + target + ": " + tail + ")");
    }
    assert(!survived.length, survived.length + " mutation(s) survived: " + survived.join(" | "));
    return runs.length + " mutations, each caught";
  });
}

read.__setHubReadRuntimeForTests(null);
relay.close();
await hub.close();
rmSync(tmp, { recursive: true, force: true });
const summary = `${passed}/${passed + failed} hub-read unit checks passed` + (failed ? ` — FAILED: ${failedIds.join(",")}` : "");
console.log((QUIET ? "" : "\n") + summary);
process.exit(failed ? 1 : 0);
