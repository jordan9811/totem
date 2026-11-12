// FOR YOU FROM THE HUB (SPEC B) — the browser device's Neynar-free discovery feed for the signed-in root, IN ONE PROCESS,
// with nothing real: lib/fc/hubRead/{forYou,read,mode,copy}.ts and app/api/fc/hub/route.ts bundled with esbuild and run as
// a device (the hub read core's runtime seam), against scripts/lib/farcaster-protocol-stub.mjs on loopback (a Snapchain
// node with the real node's JSON shapes; plantTwoHop plants a 2-hop graph and forYouTruth computes what For You should
// show from the stub's own state). No request leaves the machine.
//
//   F1  the reads: plain GETs to the node only, exactly the measured paths and page sizes (the activity check, each
//       sampled follow's likes, recasts and newest follows, the posts, the accounts' newest posts, profiles), no token
//       followed; a misconfigured node refuses with zero requests; no server answers the op (404, body unread)
//   F2  CANDIDATES = the stub's ground truth for the keyed half: the sample (the active follows, most recently followed
//       first), the posts they liked or recast (2 a follow), the accounts at least 2 of them follow (their posts of the
//       last 7 days), each card's proof (likes, recasts, followed by); never the root, an account it follows or an own
//       persona (never named in a read); what is covered said in words
//   F3  BOUNDS: 1,500 follows with 100 active → the first 40 active, checked 40 at a time (400 checks, not 1,500); 1,200
//       quiet follows → 1,000 checks and a TRUE empty saying so; at most 8 in flight; 30 accounts at most
//   F4  THE KEYED HALF: derived from the vault key (pinned), the same key gives the same coin in a new tab, about half of
//       all accounts; nothing beyond the follows is read or shown outside the half, profiles of mentioned / replied-to
//       accounts and quoted posts included; an unreadable vault key reads nothing (vault)
//   F5  YOUR MODE: recency only = newest first; engagement only = most liked by the people you follow first; a muted word
//       hides exactly those posts and says so; a mode hiding all says so; For You's gaps and signals; a mode that cannot
//       be read shows nothing; NO mode switch causes a node read (every candidate's reads are made whatever the mode)
//   F6  PROGRESSIVE: an early answer is loading and shows what is in; nothing on screen blinks out while it fills, even
//       when newer posts arrive later and push it past the page
//   F7  NEVER FAIL OPEN: a failed follows read is an error (and is not re-read on every ask, only on Retry); every
//       activity check failing is an error; every post read failing is an error, never "nothing here"; some failing is
//       counted and the rest shown; Retry recovers
//   F8  TRUE EMPTIES: follows nobody; nobody active; the active ones liked only posts by accounts the root follows
//   F9  429: the node's Retry-After pauses the reads, said on the page, nothing marked failed
//   F10 REFRESH: nothing re-read inside a minute; then a light refresh re-reads the sample's reactions and the accounts'
//       posts only (no activity check, no follows of follows) and a new like shows; after 30 minutes the full check;
//       nothing on screen blinks out across a refresh
//   F11 PERSONA SEPARATION: while a persona acts the op refuses and ZERO requests leave the tab; a persona chosen mid-load
//       stops the queued reads; an answer put together while one is chosen is refused; back as the root, the
//       interrupted load runs again
//   F12 identity: another root never sees the previous root's For You; resetHubReads drops it
//   F13 shapes: a reaction or link by another account in an answer is dropped; a cast under another fid is dropped; a post
//       dated decades ahead is left out and counted; the cards are hub cards with no counts
//   F14 THE PRODUCTION SUITE'S TRUTH: accept-hub-foryou-prod cannot know the tab's vault key, so it checks every card
//       against forYouTruth's any-half superset; under keys chosen blind, every card is in it with its proof, and the
//       every-account pick (what that suite used before, failing about one run in two) is shown NOT to be a superset
//   M   MUTATIONS: each guard removed in the BUNDLE ONLY, and the check that covers it must then FAIL
//
//   node scripts/unit-hub-foryou.mjs            (npm run test:hub-foryou-unit)
//   node scripts/unit-hub-foryou.mjs --only=F2
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SELF = fileURLToPath(import.meta.url);
const require = createRequire(path.join(ROOT, "package.json"));
const { build } = require("esbuild");
const ONLY = (process.argv.find((a) => a.startsWith("--only=")) || "").slice("--only=".length).split(",").filter(Boolean);
const want = (id) => ONLY.length === 0 || ONLY.includes(id);
const MUTATIONS = process.env.HUBFY_MUTATION ? JSON.parse(process.env.HUBFY_MUTATION) : [];
const QUIET = process.env.HUBFY_UNIT_QUIET === "1";

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
const tmp = mkdtempSync(path.join(os.tmpdir(), "layers-hubfy-unit-"));
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
  "persist.ts": `export async function fetchState(): Promise<{ status: number; ok: boolean; json: () => Promise<any> }> { return { status: 200, ok: true, json: async () => ({ entries: {} }) }; }
export async function flushVault(): Promise<void> {}
export async function flush(): Promise<void> {}
export async function signedWriteHeaders(): Promise<Record<string, string>> { return {}; }
export function sealedNamespaces(): Set<string> { return new Set(); }
export function resetEnvelopeBootstrap(): void {}
`,
  // the mode is injected through the runtime seam (every check that needs one); the loader is stood in for
  "modeSource.ts": "export async function hubModeSpec() { return null; }\n",
  // SPEC C (merged 2026-11-07): the extras loader reads the device's stores, a stateful edge; stood in for here
  "extrasSource.ts": "export async function hubExtrasSpec() { return null; }\n",
  "separation.ts": `export async function ownPersonaAccounts() { return { fids: new Set<number>(), names: new Map<number, string | null>() }; }
export async function personaActing() { return false; }
`,
  "entry.ts": `export * as read from "@/lib/fc/hubRead/read";
export * as copy from "@/lib/fc/hubRead/copy";
export * as fy from "@/lib/fc/hubRead/forYou";
export * as mode from "@/lib/fc/hubRead/mode";
export * as route from "@/app/api/fc/hub/route";
export * as nextStub from "next/server";
export * as tiers from "@/lib/delivery/tiers";
export * as lensTypes from "@/lib/lens/types";
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
      return { contents: src, loader: args.path.endsWith(".tsx") ? "tsx" : "ts", resolveDir: path.dirname(args.path) };
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
    alias: { "server-only": S("server-only.ts"), "next/server": S("next-server.ts"), "@/lib/adapters/mock/persist": S("persist.ts"), "@/lib/fc/hubRead/separation": S("separation.ts"), "@/lib/fc/hubRead/modeSource": S("modeSource.ts"), "@/lib/fc/hubRead/extrasSource": S("extrasSource.ts") },
  });
  M = await import(pathToFileURL(outFile).href);
  if (MUTATIONS.length && applied.size !== MUTATIONS.length) throw new Error("MUTATION FILE NOT IN THE BUNDLE");
} catch (e) {
  console.log("cannot bundle the For You modules: " + (e && e.message ? e.message.split("\n").slice(0, 3).join(" | ") : String(e)));
  rmSync(tmp, { recursive: true, force: true });
  process.exit(2);
}
const { read, copy, fy, route, nextStub, tiers, lensTypes } = M;
const L = fy.HUB_FORYOU_LIMITS;

// ---------------------------------------------------------------------------------------------------- the network
const { startProtocolStub } = await import(pathToFileURL(path.join(ROOT, "scripts", "lib", "farcaster-protocol-stub.mjs")).href);
const hub = await startProtocolStub({ firstFid: 993500 });
const seenReq = [];
let rewrite = null;
let skew = 0;
const tabFetch = async (url, init = {}) => {
  const u = String(url);
  seenReq.push({ url: u, method: init.method ?? "GET", credentials: init.credentials, referrerPolicy: init.referrerPolicy, headers: init.headers ?? null, at: Date.now() });
  const res = await fetch(url, init);
  if (rewrite) {
    const r = await rewrite(u, res);
    if (r) return r;
  }
  return res;
};
// the vault key the half is drawn under (a test constant; a real tab uses its own vault's)
const VAULT_KEY = new Uint8Array(32).fill(7);
const KEY = fy.forYouHalfKey(VAULT_KEY);
const inHalf = (fid) => fy.inForYouHalf(KEY, fid);
let acct = null;
let ownSet = { fids: new Set(), names: new Map() };
let acting = false;
let modeNow = null;
let modeFail = null;
let actOnMode = false;
let keyFail = false;
/** the vault key the tab hands over (F14 tries others: a production tab's is its own vault's, unknown to a suite) */
let vaultKey = VAULT_KEY;
const ENV = { FC_ROOT_HUB_URL: hub.hubUrl };
const useRoot = (fid, fname = null) => {
  acct = fid ? { fid, fname } : null;
};
const runtime = (env = ENV) => ({
  device: true,
  env,
  fetch: tabFetch,
  now: () => Date.now() + skew,
  account: async () => acct,
  own: async () => ownSet,
  acting: async () => acting,
  mode: async () => {
    if (actOnMode) acting = true;
    if (modeFail) throw modeFail;
    return modeNow;
  },
  halfKey: async () => {
    if (keyFail) throw new Error("vault locked");
    return vaultKey;
  },
});
const fresh = (env = ENV) => {
  read.resetHubReads();
  hub.clearHubSteering();
  hub.resetHubReads();
  seenReq.length = 0;
  rewrite = null;
  skew = 0;
  acting = false;
  actOnMode = false;
  keyFail = false;
  vaultKey = VAULT_KEY;
  modeNow = null;
  modeFail = null;
  ownSet = { fids: new Set(), names: new Map() };
  read.__setHubReadRuntimeForTests(runtime(env));
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
/** ask until the feed settles (the island's loop) */
async function settle(opts = {}, tries = 60) {
  let v = null;
  for (let i = 0; i < tries; i++) {
    v = await fy.hubForYou({ waitMs: 2500, ...opts });
    if (v.state !== "loading") return v;
    opts = { ...opts, refresh: null, retry: false };
  }
  throw new Error("For You never settled: " + JSON.stringify({ state: v?.state, items: v?.items?.length, progress: v?.progress }));
}
const reads = (p) => hub.hubRead.reads.filter((r) => !p || r.path === p);
const node = () => seenReq.filter((r) => r.url.startsWith(hub.hubUrl));
const params = (p) => node().filter((r) => new URL(r.url).pathname === p).map((r) => new URL(r.url).searchParams);
const hashes = (v) => v.items.map((c) => c.hash);
const sameSet = (a, b) => a.length === b.length && [...a].sort().join() === [...b].sort().join();
const ago = (min) => {
  const t = Date.now() - min * 60_000;
  return t - (t % 1000);
};
/** the stub's own answer to "what should For You show", for the keyed half and the own set in force */
const truthOf = (root, extra = {}) => hub.forYouTruth(root, { eligible: inHalf, own: ownSet.fids, ...extra });
/** a 2-hop graph whose eligible part is not empty under the test key (the planted outer accounts are spread over both halves) */
function plant(root, o = {}) {
  hub.plantProfile(root, { username: "root" + root, display: "Root " + root });
  return hub.plantTwoHop({ root, ...o });
}
const ruleOf = (id, name, action, clauses) => ({ id, name, action, root: { combinator: "AND", clauses }, createdAt: 0 });
const lensOf = (weights) => ({ signals: { ...lensTypes.zeroSignals(), ...weights }, influenceDistribution: {} });
/** a mode as the device's loader hands it over (lib/fc/hubRead/modeSource.ts): the Default preset's weights unless told */
const specOf = (o = {}) => {
  const t = o.tiers ?? {};
  return {
    id: o.id ?? "mode_unit",
    name: o.name ?? "Unit mode",
    ranking: { recency: 0.4, engagement: 0.3, authorAffinity: 0.2, clusterAffinity: 0.1, ...(o.ranking ?? {}) },
    calmRanking: !!o.calmRanking,
    longformOnly: false,
    hideReplies: !!o.hideReplies,
    kingOfTheHill: false,
    rules: o.rules ?? [],
    deliveryRules: Object.keys(t).length ? tiers.compileDeliveryRules([], new Set(Object.values(t))) : [],
    tiers: new Map(Object.entries(t).map(([k, v]) => [Number(k), v])),
    tiersUnreadable: false,
    lens: { id: o.lens ? "lens_unit" : "lens_canonical", name: null, source: o.lens ? "mode" : "canonical", spec: o.lens ?? null, missing: false },
    packs: [],
  };
};

out("\nHUB FOR YOU UNIT — the device's Neynar-free For You, against a loopback Snapchain stub" + (MUTATIONS.length ? "  [MUTATED BUNDLE]" : ""));

await check("F1", "the reads: plain GETs to the node only, exactly the measured paths and page sizes, no token followed; misconfigured refuses with zero requests; no server answers the op", async () => {
  fresh();
  const R = 7100;
  const g = plant(R, { base: 3_100_000, outerBase: 3_150_000 });
  useRoot(R, "root7100");
  const v = await settle();
  assert(v.state === "ready" && v.items.length > 0, "the view: " + v.state + " " + v.items.length + " " + JSON.stringify(v.partial));
  assert(node().length === seenReq.length, "a request went somewhere other than the node");
  for (const r of node()) assert(r.method === "GET" && r.credentials === "omit" && r.referrerPolicy === "no-referrer" && r.headers === null, "not a plain GET: " + JSON.stringify(r));
  assert(hub.hubRead.preflights === 0, "a preflight reached the node");
  for (const s of node().map((r) => new URL(r.url).searchParams)) assert(!s.get("pageToken"), "a page token was followed: " + s);
  const rf = params("/v1/reactionsByFid");
  const probes = rf.filter((s) => s.get("pageSize") === "1");
  assert(probes.length === g.follows.length && probes.every((s) => s.get("reaction_type") === "Like" && s.get("reverse") === "true"), "the activity checks: " + probes.length + " " + probes.slice(0, 2).map(String));
  const pages = rf.filter((s) => s.get("pageSize") === String(L.reactionsPage));
  assert(pages.length === 2 * g.active.length && pages.every((s) => s.get("reverse") === "true" && g.active.includes(Number(s.get("fid")))) && pages.filter((s) => s.get("reaction_type") === "Recast").length === g.active.length, "the sampled reactions: " + pages.length);
  assert(rf.length === probes.length + pages.length, "another reactionsByFid read: " + rf.filter((s) => !["1", String(L.reactionsPage)].includes(s.get("pageSize"))).map(String));
  const lf = params("/v1/linksByFid");
  const rootLinks = lf.filter((s) => s.get("fid") === String(R));
  const sampleLinks = lf.filter((s) => s.get("fid") !== String(R));
  assert(rootLinks.length === 1 && sampleLinks.length === g.active.length && sampleLinks.every((s) => s.get("pageSize") === String(L.linksPage) && s.get("reverse") === "true" && s.get("link_type") === "follow" && g.active.includes(Number(s.get("fid")))), "linksByFid: " + lf.map(String).slice(0, 3));
  const t = truthOf(R);
  const cf = params("/v1/castsByFid");
  assert(sameSet(cf.map((s) => Number(s.get("fid"))), t.accounts) && cf.every((s) => s.get("pageSize") === String(L.castsPage) && s.get("reverse") === "true"), "castsByFid: " + cf.map((s) => s.get("fid")) + " want " + t.accounts);
  const cb = params("/v1/castById");
  assert(sameSet(cb.map((s) => s.get("hash")), t.liked), "castById: " + cb.length + " want " + t.liked.length);
  assert(params("/v1/castsByParent").length === 0 && params("/v1/linksByTargetFid").length === 0 && params("/v1/reactionsByCast").length === 0, "a read For You does not make");
  const said = node().length + " reads: " + probes.length + " checks, " + pages.length + " reaction pages, " + sampleLinks.length + " follows pages, " + cb.length + " posts, " + cf.length + " accounts";
  // misconfigured: refused with no request
  for (const bad of [{ FC_ROOT_HUB_URL: "https://evil.example/path?key=1" }, { FC_ROOT_HUB_URL: hub.hubUrl, FC_ROOT_POST: "bad_config" }]) {
    fresh(bad);
    useRoot(R);
    const e = await errOf(fy.hubForYou());
    assert(e && e.code === "bad_config" && seenReq.length === 0, "a misconfigured node was read or not refused: " + (e ? e.code : "no error") + " " + seenReq.length);
  }
  fresh();
  const req = new nextStub.NextRequest("http://x/api/fc/hub", { method: "POST", body: JSON.stringify({ op: "foryou" }) });
  const r = await route.POST(req);
  assert(r.status === 404 && r.body.code === "device_only" && req.readCount === 0, "a server answered the op or read the body: " + r.status + " read " + req.readCount);
  return said + "; 2 misconfigurations refused with 0 requests";
});

await check("F2", "CANDIDATES = the ground truth for the keyed half: the sample, the posts they liked or recast, the accounts several follow; proofs; never the root, a followed account or an own persona (never named); coverage said", async () => {
  fresh();
  // the root and the followed account whose post every active follow liked are IN the half: otherwise the keyed coin alone
  // would keep them out, and "never the root, never a followed account" would prove nothing about those two guards
  const R = Array.from({ length: 64 }, (_, i) => 7200 + i).find(inHalf);
  const FB = Array.from({ length: 64 }, (_, i) => 3_200_000 + i * 200).find(inHalf);
  const OWN = Array.from({ length: 64 }, (_, i) => 3_290_000 + i).find(inHalf);
  const OWN2 = OWN + 1000; // a persona account the root itself follows: never checked for activity
  ownSet = { fids: new Set([OWN, OWN2]), names: new Map([[OWN, "ownpersona"], [OWN2, "ownpersona2"]]) };
  const g = plant(R, { base: FB, outerBase: 3_250_000, own: OWN, extraFollowed: [OWN2] });
  // a follow the root followed last: active (it liked a post by an account the root follows, just now), but its likes of
  // eligible posts are 5 days old, so it brings nothing in
  const STALE = FB + 100;
  hub.plantFollow({ fid: R, target: STALE, ts: Date.now() });
  hub.plantReaction({ fid: STALE, kind: "like", target: { fid: g.followedPost.fid, hash: g.followedPost.hash }, ts: ago(1) });
  for (const o of g.outer.filter(inHalf).slice(-3)) hub.plantReaction({ fid: STALE, kind: "like", target: { fid: o, hash: g.outerCasts[o][2].hash }, ts: ago(5 * 24 * 60) });
  // the own persona must be in the half and above the bar, or "never read" would be vacuous
  assert(inHalf(OWN), "the test key leaves the own persona out of the half (pick another fid)");
  useRoot(R, "root" + R);
  const v = await settle();
  const t = truthOf(R);
  assert(v.state === "ready" && !v.partial && !v.empty, "the view: " + v.state + " " + JSON.stringify(v.partial) + " " + JSON.stringify(v.empty));
  const sampleWant = [STALE, ...g.active];
  assert(JSON.stringify(t.sample) === JSON.stringify(sampleWant) && v.coverage.active === sampleWant.length && v.coverage.probed === g.follows.length + 1, "the sample: " + JSON.stringify({ truth: t.sample.length, active: v.coverage.active, probed: v.coverage.probed }));
  // the reads For You chose are exactly the truth's: the posts brought in (castById) and the accounts read (castsByFid)
  assert(sameSet(params("/v1/castById").map((s) => s.get("hash")), t.liked), "the posts read: " + params("/v1/castById").length + " want " + t.liked.length);
  assert(sameSet(params("/v1/castsByFid").map((s) => Number(s.get("fid"))), t.accounts), "the accounts read: " + params("/v1/castsByFid").map((s) => s.get("fid")) + " want " + t.accounts);
  const probedFids = params("/v1/reactionsByFid").filter((s) => s.get("pageSize") === "1").map((s) => Number(s.get("fid")));
  assert(!probedFids.includes(OWN2) && probedFids.includes(STALE), "the activity checks named the followed persona, or missed the newest follow");
  assert(t.posts.length >= 8 && t.accounts.length >= 3, "the truth is too thin to mean anything: " + t.posts.length + " posts, " + t.accounts.length + " accounts");
  assert(sameSet(hashes(v), t.posts.map((p) => p.hash)), "the posts differ from the truth: " + v.items.length + " vs " + t.posts.length);
  assert(JSON.stringify(hashes(v)) === JSON.stringify(t.posts.map((p) => p.hash)), "with no mode, not newest first");
  for (const p of t.posts) {
    const pr = v.proof[p.hash];
    assert(pr && pr.likes === p.likes && pr.recasts === p.recasts && pr.followedBy === p.followedBy, "the proof of " + p.text + ": " + JSON.stringify(pr && { l: pr.likes, r: pr.recasts, f: pr.followedBy }) + " want " + JSON.stringify(p));
  }
  const shared = t.posts.find((p) => p.likes >= 2);
  assert(shared && /^Liked by Follow \d+ and /.test(v.proof[shared.hash].sentence), "a shared like's sentence: " + (shared ? v.proof[shared.hash].sentence : "none planted"));
  const only2hop = t.posts.find((p) => p.likes === 0 && p.recasts === 0);
  assert(only2hop && v.proof[only2hop.hash].sentence === `Followed by ${only2hop.followedBy} people you follow`, "a 2-hop post's sentence: " + (only2hop ? v.proof[only2hop.hash].sentence : "none"));
  // never the root, a followed account or the own persona; the persona never named in a read
  const followed = new Set(g.follows);
  for (const c of v.items) assert(c.author.fid !== R && !followed.has(c.author.fid) && c.author.fid !== OWN && c.hub === true && c.network === true, "a card by " + c.author.fid);
  for (const h of [g.followedPost.hash, g.rootPost.hash, g.ownPost.hash]) assert(!hashes(v).includes(h), "an excluded post is shown: " + h);
  const named = node().filter((r) => [String(OWN), String(OWN2)].includes(/[?&](?:target_)?fid=(\d+)/.exec(r.url)?.[1]));
  assert(named.length === 0, named.length + " read(s) named an own persona");
  // old 2-hop posts (10 days) stay out; the quiet follows were never sampled
  for (const o of t.accounts) assert(!hashes(v).includes(g.outerCasts[o].find((c) => c.old).hash), "a 10-day-old post is shown");
  const sentence = `From ${sampleWant.length} people you follow who liked a post in the last 3 days, and ${t.accounts.length} accounts several of them follow.`;
  assert(v.coverage.sentence === sentence && v.coverage.accounts === t.accounts.length, "the coverage: " + v.coverage.sentence + " want " + sentence);
  assert(v.items.every((c) => c.likes === 0 && c.recasts === 0 && c.replies === 0), "a card carries a count");
  return v.items.length + " posts = the truth (" + t.liked.length + " liked or recast, " + t.accounts.length + " accounts); own persona never named; " + sentence;
});

await check("F3", "BOUNDS: 1,500 follows with 100 active → the first 40 active, 400 checks; 1,200 quiet → 1,000 checks and an empty that says so; at most 8 in flight; at most 30 accounts", async () => {
  fresh();
  const R = 7300;
  const base = 3_300_000;
  const OUT = 3_340_000;
  const now = Date.now();
  // 1,500 follows (the LAST most recently followed); in recency order every 10th is active (positions 0, 10, ...)
  const fl = Array.from({ length: 1500 }, (_, i) => base + i);
  hub.plantFollows(R, fl.map((f, i) => ({ fid: f, ts: now - (1500 - i) * 60_000 })));
  const byRecency = [...fl].reverse();
  const outers = Array.from({ length: 160 }, (_, k) => OUT + k);
  for (const o of outers) hub.plantCast({ fid: o, ts: ago(30 + (o % 50)), text: "outer " + o, seed: "f3:" + o });
  const activeAll = byRecency.filter((_, i) => i % 10 === 0).slice(0, 100);
  for (const [i, a] of activeAll.entries()) {
    const author = outers[i % 160];
    const liked = hub.plantCast({ fid: author, ts: ago(60 + i), text: "liked " + i, seed: "f3l:" + i });
    hub.plantReaction({ fid: a, kind: "like", target: { fid: author, hash: liked }, ts: ago(5 + (i % 50)) });
    // each follows 50 of the outer accounts (their newest 50 is all of it), so 160 accounts are each followed by many
    hub.plantFollows(a, Array.from({ length: 50 }, (_, j) => ({ fid: outers[(i * 7 + j) % 160], ts: now - (j + 1) * 3_600_000 })));
  }
  useRoot(R);
  // a small delay on the node, so the stub can see how many reads are in flight at once
  hub.hubRead.delayMs = 4;
  const v = await settle();
  hub.hubRead.delayMs = 0;
  const t = truthOf(R);
  const probes = params("/v1/reactionsByFid").filter((s) => s.get("pageSize") === "1");
  assert(v.coverage.active === L.sample && JSON.stringify(t.sample) === JSON.stringify(activeAll.slice(0, L.sample)) && v.coverage.probed === 400 && probes.length === 400, "the sample: " + JSON.stringify({ active: v.coverage.active, probed: v.coverage.probed, reads: probes.length }));
  assert(v.coverage.accounts === L.accounts && sameSet(params("/v1/castsByFid").map((s) => Number(s.get("fid"))), t.accounts) && t.accounts.length === L.accounts, "the accounts: " + v.coverage.accounts + " read " + params("/v1/castsByFid").length + " truth " + t.accounts.length);
  const inFlight = hub.hubRead.maxInFlight;
  assert(inFlight <= 8 && inFlight > 1, "in flight: " + inFlight);
  assert(v.state === "ready" && v.items.length > 0 && !v.partial, "the page: " + v.state + " " + v.items.length + " " + JSON.stringify(v.partial));
  // 1,200 quiet follows: 1,000 checks, then a TRUE empty that says how many were checked
  fresh();
  const R2 = 7301;
  const q = Array.from({ length: 1200 }, (_, i) => 3_360_000 + i);
  hub.plantFollows(R2, q.map((f, i) => ({ fid: f, ts: now - (1200 - i) * 60_000 })));
  useRoot(R2);
  const v2 = await settle();
  const p2 = params("/v1/reactionsByFid").filter((s) => s.get("pageSize") === "1");
  assert(v2.state === "ready" && v2.empty && v2.empty.kind === "none-active" && p2.length === L.probeMax && v2.coverage.probed === L.probeMax, "the quiet graph: " + JSON.stringify({ state: v2.state, empty: v2.empty, probes: p2.length }));
  assert(v2.empty.sentence === "None of the 1,000 people you follow that were checked liked a post in the last 3 days, so there's nothing to show here yet.", "the empty sentence: " + v2.empty.sentence);
  return "400 checks for 40 active of 1,500; 1,000 checks for 1,200 quiet; " + inFlight + " in flight at most";
});

await check("F4", "THE KEYED HALF: pinned derivation, stable across tabs, about half; nothing beyond the follows read or shown outside it (profiles of mentioned and replied-to accounts, and quoted posts, included); an unreadable vault key reads nothing", async () => {
  // the derivation: HKDF-SHA256 of the vault key, info "totem/foryou-half/1"; a different vault, a different coin
  const k2 = fy.forYouHalfKey(new Uint8Array(32).fill(8));
  assert(Buffer.from(KEY).toString("hex") === Buffer.from(fy.forYouHalfKey(new Uint8Array(32).fill(7))).toString("hex") && Buffer.from(KEY).toString("hex") !== Buffer.from(k2).toString("hex") && fy.FOR_YOU_HALF_INFO === "totem/foryou-half/1", "the derivation is not pinned");
  const fids = Array.from({ length: 4000 }, (_, i) => 1 + i * 37);
  const ins = fids.filter(inHalf).length;
  const agree = fids.filter((f) => fy.inForYouHalf(KEY, f) === fy.inForYouHalf(k2, f)).length;
  assert(ins > 1800 && ins < 2200 && agree > 1800 && agree < 2200, "not about half: " + ins + " in, " + agree + " agree across vaults");
  fresh();
  const R = 7400;
  const g = plant(R, { base: 3_400_000, outerBase: 3_450_000, outer: 30 });
  // a candidate that mentions and replies to accounts beyond the follows, and quotes another's post: an in-half and an
  // out-of-half one of each
  const outs = Array.from({ length: 400 }, (_, i) => 3_470_000 + i);
  const IN = outs.filter(inHalf).slice(0, 3);
  const OUTH = outs.filter((f) => !inHalf(f)).slice(0, 3);
  for (const f of [...IN, ...OUTH]) hub.plantProfile(f, { username: "x" + f, display: "X " + f });
  const inParent = hub.plantCast({ fid: IN[0], ts: ago(300), text: "in parent", seed: "f4:ip" });
  const outParent = hub.plantCast({ fid: OUTH[0], ts: ago(301), text: "out parent", seed: "f4:op" });
  const inQuoted = hub.plantCast({ fid: IN[1], ts: ago(302), text: "in quoted", seed: "f4:iq" });
  const outQuoted = hub.plantCast({ fid: OUTH[1], ts: ago(303), text: "out quoted", seed: "f4:oq" });
  const carrierOuter = g.outer.find((o) => inHalf(o) && g.outer.indexOf(o) <= 3);
  assert(carrierOuter, "no in-half outer account among the top four");
  hub.plantCast({ fid: carrierOuter, ts: ago(1), text: "  and  said", mentions: [IN[2], OUTH[2]], mentionsPositions: [0, 6], parent: { fid: IN[0], hash: inParent }, seed: "f4:c1" });
  hub.plantCast({ fid: carrierOuter, ts: ago(2), text: "a reply out", parent: { fid: OUTH[0], hash: outParent }, embeds: [{ castId: { fid: IN[1], hash: inQuoted } }, { castId: { fid: OUTH[1], hash: outQuoted } }], seed: "f4:c2" });
  useRoot(R);
  const v = await settle();
  await new Promise((r) => setTimeout(r, 300));
  const v2 = await settle();
  const followed = new Set([R, ...g.follows]);
  const beyond = node().map((r) => Number(/[?&]fid=(\d+)/.exec(r.url)?.[1])).filter((f) => f && !followed.has(f));
  const outside = beyond.filter((f) => !inHalf(f));
  assert(beyond.length > 10 && outside.length === 0, "reads beyond the follows outside the half: " + [...new Set(outside)].slice(0, 5) + " (of " + beyond.length + ")");
  for (const c of v2.items) assert(inHalf(c.author.fid), "a card by an account outside the half: " + c.author.fid);
  const ud = params("/v1/userDataByFid").map((s) => Number(s.get("fid")));
  assert(ud.includes(IN[0]) && ud.includes(IN[2]) && !ud.includes(OUTH[0]) && !ud.includes(OUTH[2]), "the mentioned / replied-to profiles: in " + [IN[0], IN[2]].map((f) => ud.includes(f)) + " out " + [OUTH[0], OUTH[2]].map((f) => ud.includes(f)));
  const qb = params("/v1/castById").map((s) => s.get("hash"));
  assert(qb.includes(inQuoted) && !qb.includes(outQuoted), "the quoted posts: in " + qb.includes(inQuoted) + " out " + qb.includes(outQuoted));
  const c2 = v2.items.find((c) => c.text === "a reply out");
  assert(c2 && c2.replyingTo === "@!" + OUTH[0], "the out-of-half parent shows its number: " + (c2 && c2.replyingTo));
  // the same key in a new tab: the same accounts read
  const accounts1 = params("/v1/castsByFid").map((s) => s.get("fid")).sort().join();
  fresh();
  useRoot(R);
  await settle();
  assert(params("/v1/castsByFid").map((s) => s.get("fid")).sort().join() === accounts1, "another tab with the same vault read other accounts");
  // no vault key: nothing is read, the op says why
  fresh();
  keyFail = true;
  useRoot(R);
  const e = await errOf(fy.hubForYou({ waitMs: 200 }));
  assert(e && e.code === "vault" && seenReq.length === 0, "an unreadable vault key: " + (e ? e.code : "no error") + " " + seenReq.length + " reads");
  return ins + "/4000 in the half; " + beyond.length + " reads beyond the follows, all in it; the out-of-half parent shows its number";
});

await check("F5", "YOUR MODE: recency only = newest first; engagement only = most liked first; a muted word hides exactly those; hiding all is said; For You's gaps and signals; an unreadable mode shows nothing; no mode switch causes a node read", async () => {
  fresh();
  const R = 7500;
  plant(R, { base: 3_500_000, outerBase: 3_550_000 });
  const t = truthOf(R);
  // the first answer under a mode that HIDES posts (one account's): every candidate's reads are made all the same
  const word = "outer " + (t.accounts[1] - 3_550_000) + " ";
  const zebra = ruleOf("r_z", "No " + word.trim(), "hide", [{ field: "post.text", op: "contains", value: word.toUpperCase() }]);
  modeNow = specOf({ rules: [zebra] });
  useRoot(R);
  const v0 = await settle();
  const hid = t.posts.filter((p) => p.text.toLowerCase().includes(word)).length;
  assert(hid > 0 && v0.mode.hidden === hid && v0.items.length === t.posts.length - hid && v0.mode.sentence === `Your mode hid ${hid} of these ${t.posts.length} posts.`, "the muted words: " + JSON.stringify({ hidden: v0.mode.hidden, hid, items: v0.items.length, s: v0.mode.sentence }));
  assert(v0.items.every((c) => !c.text.toLowerCase().includes(word)), "a muted post is shown");
  const r0 = node().length;
  // recency only: newest first, exactly
  modeNow = specOf({ ranking: { recency: 1, engagement: 0, authorAffinity: 0, clusterAffinity: 0 } });
  const vr = await settle();
  assert(JSON.stringify(hashes(vr)) === JSON.stringify(t.posts.map((p) => p.hash)), "recency only is not newest first");
  // engagement only: the most liked or recast by the people you follow first (lib/feed.ts's curve)
  modeNow = specOf({ ranking: { recency: 0, engagement: 1, authorAffinity: 0, clusterAffinity: 0 } });
  const ve = await settle();
  const eng = (h) => {
    const p = ve.proof[h];
    return Math.log10(1 + p.likes + 3 * p.recasts);
  };
  const es = hashes(ve).map(eng);
  assert(es.every((x, i) => i === 0 || x <= es[i - 1] + 1e-12) && es[0] > es[es.length - 1] && ve.mode.ranked === true, "engagement only is not most-engaged first: " + es.map((x) => x.toFixed(2)).join(","));
  // author affinity only: the most followed authors first
  modeNow = specOf({ ranking: { recency: 0, engagement: 0, authorAffinity: 1, clusterAffinity: 0 } });
  const va = await settle();
  const fb = hashes(va).map((h) => va.proof[h].followedBy);
  assert(fb.every((x, i) => i === 0 || x <= fb[i - 1]) && fb[0] > fb[fb.length - 1], "affinity only is not most-followed first: " + fb.join(","));
  // a lens's likes weight reads the same counts
  modeNow = specOf({ ranking: { recency: 0, engagement: 0, authorAffinity: 0, clusterAffinity: 0 }, lens: lensOf({ likes: 3 }) });
  const vl = await settle();
  const ls = hashes(vl).map((h) => vl.proof[h].likes);
  assert(ls.every((x, i) => i === 0 || x <= ls[i - 1]) && ls[0] > ls[ls.length - 1], "the lens's likes weight: " + ls.join(","));
  // hiding everything is said, never an empty For You
  modeNow = specOf({ rules: [ruleOf("r_all", "All", "hide", [{ field: "post.age", op: "gte", value: 0 }])] });
  const vh = await settle();
  assert(vh.items.length === 0 && vh.mode.hidAll === true && vh.mode.sentence === `Your mode hid all ${t.posts.length} posts.` && vh.empty === null, "hide all: " + JSON.stringify({ n: vh.items.length, all: vh.mode.hidAll, s: vh.mode.sentence, empty: vh.empty }));
  // the Default weights: engagement is USED here (not a gap), topic affinity is a gap; the signals sentence is said
  modeNow = specOf();
  const vd = await settle();
  const gaps = vd.mode.gaps.map((g) => g.term);
  assert(!gaps.includes("engagement") && gaps.includes("topic affinity") && vd.signals === copy.FOR_YOU_SIGNALS_SENTENCE, "the gaps on For You: " + JSON.stringify(gaps) + " signals " + vd.signals);
  modeNow = specOf({ calmRanking: true, lens: lensOf({ likes: 1, recasts: 1, tier: 1 }) });
  const vc = await settle();
  const gc = vc.mode.gaps.map((g) => g.term);
  assert(!gc.includes("calm ranking") && !gc.includes("likes") && !gc.includes("recasts") && gc.includes("tier"), "calm ranking and the lens counts on For You: " + JSON.stringify(gc));
  // a mode that cannot be read: nothing, never the page unfiltered
  modeFail = new Error("unreadable");
  const vx = await fy.hubForYou({ waitMs: 0 });
  modeFail = null;
  assert(vx.items.length === 0 && vx.mode.state === "error" && vx.mode.reason === copy.HUB_MODE_ERROR_SENTENCE, "an unreadable mode: " + JSON.stringify({ n: vx.items.length, m: vx.mode }));
  const r1 = node().length;
  assert(r1 === r0, r1 - r0 + " node read(s) across the mode switches");
  return "hid " + hid + "; newest first; most engaged first; most followed first; hide-all said; 0 node reads across 8 switches";
});

await check("F6", "PROGRESSIVE: an early answer is loading and shows what is in; nothing on screen blinks out while it fills, even when newer posts arrive later and push it past the page", async () => {
  fresh();
  const R = 7600;
  const base = 3_600_000;
  const OUT = 3_650_000;
  const now = Date.now();
  // 12 active follows, each liking two OLD posts (a day old) by in-half accounts; all of them follow the same 6 in-half
  // accounts, whose posts are NEWER (minutes old): those arrive last (after every sampled follow's follows are read)
  const fl = Array.from({ length: 12 }, (_, i) => base + i);
  hub.plantFollows(R, fl.map((f, i) => ({ fid: f, ts: now - (12 - i) * 60_000 })));
  const pool = Array.from({ length: 300 }, (_, k) => OUT + k).filter(inHalf);
  const likedAuthors = pool.slice(0, 24);
  const twoHop = pool.slice(24, 30);
  for (const [i, f] of fl.entries()) {
    for (let j = 0; j < 2; j++) {
      const a = likedAuthors[i * 2 + j];
      const h = hub.plantCast({ fid: a, ts: ago(24 * 60 + i * 2 + j), text: "old liked " + i + ":" + j, seed: "f6:l:" + i + ":" + j });
      hub.plantReaction({ fid: f, kind: "like", target: { fid: a, hash: h }, ts: ago(1 + i) });
    }
    hub.plantFollows(f, twoHop.map((t, j) => ({ fid: t, ts: now - (j + 1) * 3_600_000 })));
  }
  for (const [k, t] of twoHop.entries()) for (let j = 0; j < 3; j++) hub.plantCast({ fid: t, ts: ago(1 + k * 3 + j), text: "fresh " + k + ":" + j, seed: "f6:t:" + k + ":" + j });
  hub.hubRead.delayMs = 25;
  useRoot(R);
  const want = 10;
  let sawEarly = false;
  const everShown = new Set();
  let v = null;
  for (let i = 0; i < 300; i++) {
    v = await fy.hubForYou({ want, waitMs: 60 });
    const hs = hashes(v);
    for (const h of everShown) assert(hs.includes(h), "a shown post blinked out at answer " + i + " (" + v.state + ", " + hs.length + " on screen)");
    for (const h of hs) everShown.add(h);
    if (v.state === "loading" && hs.length > 0) sawEarly = true;
    if (v.state !== "loading") break;
  }
  hub.hubRead.delayMs = 0;
  assert(v.state === "ready", "never settled: " + v.state);
  assert(sawEarly, "no early answer with posts (not progressive)");
  const early = [...everShown].filter((h) => !v.items.slice(0, want).some((c) => c.hash === h));
  assert(v.items.slice(0, want).every((c) => c.text.startsWith("fresh")) && early.length > 0 && v.items.length > want && v.more === true, "the newer posts did not slot in above what was shown: " + v.items.slice(0, 12).map((c) => c.text).join(" | ") + " more " + v.more);
  return everShown.size + " posts shown along the way, none blinked out; " + want + " newer posts slotted in above " + early.length + " shown earlier";
});

await check("F7", "NEVER FAIL OPEN: a failed follows read is an error (re-read only on Retry); every activity check failing is an error; every post read failing is an error; some failing is counted; Retry recovers", async () => {
  fresh();
  const R = 7700;
  const g = plant(R, { base: 3_700_000, outerBase: 3_750_000 });
  useRoot(R);
  // (a) the follows read fails: an error, not "you follow nobody"; asking again does not re-read; Retry does
  hub.hubRead.fails.push({ path: "/v1/linksByFid", fid: R, status: 500, n: 1e9 });
  const a = await settle();
  assert(a.state === "error" && a.code === "follows_unreadable" && a.items.length === 0 && !a.empty && /not an empty list/.test(a.reason), "a failed follows read: " + JSON.stringify({ s: a.state, c: a.code, e: a.empty }));
  const n0 = reads("/v1/linksByFid").length;
  for (let i = 0; i < 3; i++) {
    skew += 2 * 60_000;
    await fy.hubForYou({ waitMs: 50, refresh: i % 2 ? "auto" : "manual" });
  }
  skew = 0;
  assert(reads("/v1/linksByFid").length === n0, "a failed follows read is re-read on every ask: " + (reads("/v1/linksByFid").length - n0));
  hub.clearHubSteering();
  const a2 = await settle({ retry: true });
  assert(a2.state === "ready" && a2.items.length > 0, "Retry did not recover: " + a2.state);
  // (b) every activity check fails: an error ("not an empty feed"), never "nobody is active"
  fresh();
  useRoot(R);
  hub.hubRead.fails.push({ path: "/v1/reactionsByFid", fid: "*", status: 500, n: 1e9 });
  const b = await settle();
  assert(b.state === "error" && b.code === "foryou_unreadable" && !b.empty && /not an empty feed/.test(b.reason), "every check failing: " + JSON.stringify({ s: b.state, c: b.code, e: b.empty }));
  // (c) every post read fails: an error, not "nothing here"
  fresh();
  useRoot(R);
  hub.hubRead.fails.push({ path: "/v1/castById", fid: "*", status: 500, n: 1e9 }, { path: "/v1/castsByFid", fid: "*", status: 500, n: 1e9 });
  const c = await settle();
  assert(c.state === "error" && c.code === "foryou_unreadable" && !c.empty, "every post read failing: " + JSON.stringify({ s: c.state, c: c.code, e: c.empty }));
  // (d) some failing: counted, the rest shown; Retry recovers
  fresh();
  useRoot(R);
  const t = truthOf(R);
  const failAcct = t.accounts[0];
  const failFollow = g.active[0];
  hub.hubRead.fails.push({ path: "/v1/castsByFid", fid: failAcct, status: 500, n: 1e9 }, { path: "/v1/linksByFid", fid: failFollow, status: 500, n: 1e9 });
  const d = await settle();
  assert(d.state === "ready" && d.items.length > 0 && d.partial && d.partial.failed === 2 && d.partial.sentence === "Couldn't read what 1 person you follow liked or follow and the newest posts of 1 account just now, so some posts may be missing.", "partial: " + JSON.stringify(d.partial));
  hub.clearHubSteering();
  const d2 = await settle({ retry: true });
  assert(d2.state === "ready" && !d2.partial && sameSet(hashes(d2), truthOf(R).posts.map((p) => p.hash)), "after Retry: " + JSON.stringify({ p: d2.partial, n: d2.items.length }));
  return "follows error (no re-read until Retry); checks error; posts error; 2 failures counted; Retry = the truth";
});

await check("F8", "TRUE EMPTIES only after reads that worked: follows nobody; nobody active; the active ones liked only posts by accounts the root follows", async () => {
  fresh();
  useRoot(7800);
  hub.plantFollows(7800, []);
  const a = await settle();
  assert(a.state === "ready" && a.empty?.kind === "follows-none" && a.empty.sentence.startsWith("You don't follow anyone on Farcaster yet") && !a.coverage.sentence, "follows nobody: " + JSON.stringify(a.empty));
  fresh();
  const R = 7801;
  const now = Date.now();
  hub.plantFollows(R, [{ fid: 3_801_000, ts: now - 60_000 }, { fid: 3_801_001, ts: now - 120_000 }]);
  hub.plantReaction({ fid: 3_801_000, kind: "like", target: { fid: 3_801_001, hash: hub.plantCast({ fid: 3_801_001, ts: ago(10), text: "by a followed account", seed: "f8:x" }) }, ts: ago(5) });
  useRoot(R);
  const c = await settle();
  assert(c.state === "ready" && c.empty?.kind === "nothing-new" && c.coverage.active === 1, "only followed accounts' posts: " + JSON.stringify({ e: c.empty, a: c.coverage.active }));
  fresh();
  const R2 = 7802;
  hub.plantFollows(R2, [{ fid: 3_802_000, ts: now - 60_000 }]);
  useRoot(R2);
  const b = await settle();
  assert(b.state === "ready" && b.empty?.kind === "none-active" && b.empty.sentence === "The 1 person you follow hasn't liked a post in the last 3 days, so there's nothing to show here yet.", "nobody active: " + JSON.stringify(b.empty));
  return "follows-none, nothing-new, none-active";
});

await check("F9", "429: the node's Retry-After pauses the reads (the shared pause), said on the page, nothing marked failed", async () => {
  fresh();
  const R = 7900;
  plant(R, { base: 3_900_000, outerBase: 3_950_000 });
  useRoot(R);
  hub.hubRead.rate = { n: 1, retryAfter: 1 };
  const v1 = await fy.hubForYou({ waitMs: 300 });
  assert(v1.paused && /slow down/.test(v1.paused.sentence), "the pause is not said: " + JSON.stringify(v1.paused));
  const v = await settle();
  assert(v.state === "ready" && !v.partial && sameSet(hashes(v), truthOf(R).posts.map((p) => p.hash)), "after the pause: " + JSON.stringify({ s: v.state, p: v.partial }));
  return "paused, said, then the truth";
});

await check("F10", "REFRESH: nothing inside a minute; then a light refresh (reactions + accounts' posts, no checks, no follows of follows) shows a new like; after 30 minutes the full check; nothing on screen blinks out", async () => {
  fresh();
  const R = 8000;
  const g = plant(R, { base: 4_000_000, outerBase: 4_050_000 });
  useRoot(R);
  const v0 = await settle({ refresh: "auto" });
  const shown0 = hashes(v0);
  const n0 = node().length;
  await settle({ refresh: "manual" });
  assert(node().length === n0, "a manual refresh inside a minute read " + (node().length - n0));
  // a new like by a sampled follow of a new in-half account's post
  const NEWA = Array.from({ length: 50 }, (_, i) => 4_080_000 + i).find(inHalf);
  hub.plantProfile(NEWA, { username: "newacct", display: "New Account" });
  const nh = hub.plantCast({ fid: NEWA, ts: ago(1), text: "a brand new post", seed: "f10:new" });
  skew = 2 * 60_000;
  hub.plantReaction({ fid: g.active[0], kind: "like", target: { fid: NEWA, hash: nh }, ts: Date.now() + skew - 30_000 });
  seenReq.length = 0;
  const v1 = await settle({ refresh: "manual" });
  const p = node().map((r) => new URL(r.url));
  const probes = p.filter((u) => u.pathname === "/v1/reactionsByFid" && u.searchParams.get("pageSize") === "1").length;
  const lf = p.filter((u) => u.pathname === "/v1/linksByFid" && u.searchParams.get("fid") !== String(R)).length;
  const rp = p.filter((u) => u.pathname === "/v1/reactionsByFid" && u.searchParams.get("pageSize") === String(L.reactionsPage)).length;
  assert(probes === 0 && lf === 0 && rp === 2 * g.active.length, "the light refresh read: " + JSON.stringify({ probes, links: lf, reactions: rp }));
  assert(hashes(v1).includes(nh), "the new like's post did not show");
  for (const h of shown0) assert(hashes(v1).includes(h), "a shown post blinked out across the refresh");
  // after 30 minutes: the full check again
  skew = 31 * 60_000;
  seenReq.length = 0;
  await settle({ refresh: "auto" });
  const probes2 = params("/v1/reactionsByFid").filter((s) => s.get("pageSize") === "1").length;
  assert(probes2 === g.follows.length, "the full check after 30 minutes: " + probes2);
  return "0 reads inside a minute; light refresh = " + rp + " reaction pages, 0 checks; the new post shown; full check after 30 min";
});

await check("F11", "PERSONA SEPARATION: while a persona acts the op refuses and ZERO requests leave; a persona chosen mid-load stops the queued reads; an answer put together while one is chosen is refused; back as the root, the load runs again", async () => {
  fresh();
  const R = 8100;
  plant(R, { base: 4_100_000, outerBase: 4_150_000 });
  useRoot(R);
  acting = true;
  const e = await errOf(fy.hubForYou({ waitMs: 300 }));
  assert(e && e.code === "acting_persona" && seenReq.length === 0, "while a persona acts: " + (e ? e.code : "answered") + ", " + seenReq.length + " request(s)");
  // mid-load: a persona chosen while the reads are queued; nothing more leaves
  acting = false;
  hub.hubRead.delayMs = 40;
  await fy.hubForYou({ waitMs: 120 });
  acting = true;
  await new Promise((r) => setTimeout(r, 30));
  const n0 = seenReq.length;
  await new Promise((r) => setTimeout(r, 1500));
  hub.hubRead.delayMs = 0;
  assert(seenReq.length === n0, seenReq.length - n0 + " request(s) left after the persona was chosen");
  const e2 = await errOf(fy.hubForYou({ waitMs: 100 }));
  assert(e2 && e2.code === "acting_persona", "the op answered while the persona acts");
  // back as the root: the interrupted load runs again, to the truth
  acting = false;
  const v = await settle();
  assert(v.state === "ready" && !v.partial && sameSet(hashes(v), truthOf(R).posts.map((p) => p.hash)), "back as the root: " + JSON.stringify({ s: v.state, p: v.partial, n: v.items.length }));
  // an answer put together while a persona is being chosen is refused
  actOnMode = true;
  const e3 = await errOf(fy.hubForYou({ waitMs: 0 }));
  actOnMode = false;
  acting = false;
  assert(e3 && e3.code === "acting_persona", "an answer put together while a persona was chosen: " + (e3 ? e3.code : "answered"));
  return "0 requests while acting; " + n0 + " before the mid-load switch, none after; the root's load ran again";
});

await check("F12", "identity: another root never sees the previous root's For You; resetHubReads drops it", async () => {
  fresh();
  const A = 8200;
  const B = 8201;
  plant(A, { base: 4_200_000, outerBase: 4_250_000 });
  plant(B, { base: 4_210_000, outerBase: 4_260_000 });
  useRoot(A);
  const va = await settle();
  useRoot(B);
  const vb = await settle();
  assert(vb.account.fid === B && sameSet(hashes(vb), truthOf(B).posts.map((p) => p.hash)) && !hashes(vb).some((h) => hashes(va).includes(h)), "root B sees root A's For You");
  read.resetHubReads();
  useRoot(B);
  const v0 = await fy.hubForYou({ waitMs: 0 });
  assert(v0.items.length === 0 && v0.state === "loading", "resetHubReads kept the For You: " + v0.items.length);
  return "two roots apart; reset drops it";
});

await check("F13", "shapes: a reaction or link by another account dropped; a cast under another fid dropped; a post dated decades ahead left out and counted; hub cards with no counts", async () => {
  fresh();
  const R = 8300;
  const g = plant(R, { base: 4_300_000, outerBase: 4_350_000 });
  const t0 = truthOf(R);
  // a post by an in-half outer account dated 40 years ahead, followed by the sample like the others
  const top = t0.accounts[0];
  const futureHash = hub.plantCast({ fid: top, ts: Date.now() + 40 * 365 * 86_400_000, text: "oh so we're time traveling now?", seed: "f13:future" });
  // doctor the answers: a sampled follow's reactions page carries another account's like; its follows page another's link;
  // an account's casts page a cast under another fid
  const INJ = Array.from({ length: 50 }, (_, i) => 4_380_000 + i).filter(inHalf);
  const injected = hub.plantCast({ fid: INJ[0], ts: ago(3), text: "injected", seed: "f13:inj" });
  rewrite = async (u, res) => {
    const url = new URL(u);
    if (url.pathname === "/v1/reactionsByFid" && url.searchParams.get("fid") === String(g.active[0]) && url.searchParams.get("reaction_type") === "Like") {
      const j = await res.clone().json();
      const m = JSON.parse(JSON.stringify(j.messages[0]));
      m.data.fid = 1; // another account's like, in this follow's answer
      m.data.reactionBody.targetCastId = { fid: INJ[0], hash: injected };
      m.data.timestamp = Math.floor((Date.now() - 1_609_459_200_000) / 1000);
      j.messages.unshift(m);
      return new Response(JSON.stringify(j), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.pathname === "/v1/reactionsByFid" && url.searchParams.get("pageSize") === "1") {
      // an activity check answered with another account's like: not activity
      const j = await res.clone().json();
      if (url.searchParams.get("fid") === String(g.follows[0])) {
        j.messages = [{ data: { type: "MESSAGE_TYPE_REACTION_ADD", fid: 1, timestamp: Math.floor((Date.now() - 1_609_459_200_000) / 1000), reactionBody: { type: "REACTION_TYPE_LIKE", targetCastId: { fid: INJ[0], hash: injected } } }, hash: "0x" + "ab".repeat(20) }];
        return new Response(JSON.stringify(j), { status: 200, headers: { "content-type": "application/json" } });
      }
    }
    if (url.pathname === "/v1/linksByFid" && [String(g.active[1]), String(g.active[2])].includes(url.searchParams.get("fid"))) {
      const j = await res.clone().json();
      for (const k of [0, 1, 2]) j.messages.unshift({ data: { type: "MESSAGE_TYPE_LINK_ADD", fid: 1, timestamp: 1, linkBody: { type: "follow", targetFid: INJ[1] } }, hash: "0x" + "cd".repeat(20) });
      return new Response(JSON.stringify(j), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.pathname === "/v1/castsByFid" && url.searchParams.get("fid") === String(top)) {
      const j = await res.clone().json();
      const m = JSON.parse(JSON.stringify(j.messages.find((x) => x.data.timestamp * 1000 + 1_609_459_200_000 < Date.now())));
      m.data.fid = INJ[2];
      m.hash = "0x" + "ef".repeat(20);
      j.messages.unshift(m);
      return new Response(JSON.stringify(j), { status: 200, headers: { "content-type": "application/json" } });
    }
    return null;
  };
  useRoot(R);
  const v = await settle();
  rewrite = null;
  assert(!hashes(v).includes(injected) && !v.items.some((c) => c.author.fid === INJ[2]) && !params("/v1/castsByFid").some((s) => s.get("fid") === String(INJ[1])), "an injected record was used: " + JSON.stringify({ inj: hashes(v).includes(injected), other: v.items.some((c) => c.author.fid === INJ[2]) }));
  assert(v.coverage.active === g.active.length, "another account's like counted as a follow's activity: " + v.coverage.active);
  assert(!hashes(v).includes(futureHash) && v.futureDated >= 1, "the future post: shown " + hashes(v).includes(futureHash) + ", counted " + v.futureDated);
  assert(v.items.every((c) => c.hub === true && c.live === true && c.likes === 0 && c.recasts === 0 && c.replies === 0 && !c.hubOwn), "a card is not a plain hub card");
  return "injected records dropped; the future post left out (" + v.futureDated + ")";
});

await check("F14", "THE PRODUCTION SUITE'S TRUTH: under any vault key every card is in the stub's any-half truth, with its proof, and that truth holds nothing by the root or a follow; the every-account pick is NOT a superset (a half reaches posts it never picks)", async () => {
  // accept-hub-foryou-prod's graph (60 follows, 12 active, 20 accounts beyond them) under keys chosen without looking at
  // their coin, as a production tab's vault key is: what that suite checks every card against must hold for each. The
  // every-account pick it used before failed about one run in two (2026-11-07): a follow brings in its 2 newest reactions
  // by accounts IN the half, so a half that leaves some out reaches further down its list.
  const R = 8400;
  const g = plant(R, { base: 4_400_000, follows: 60, active: 12, outerBase: 4_450_000, outer: 20 });
  const followed = new Set(g.follows);
  const any = hub.forYouTruth(R, { anyHalf: true });
  const sup = new Map(any.posts.map((p) => [p.hash, p]));
  const allIn = new Set(hub.forYouTruth(R).posts.map((p) => p.hash));
  for (const p of any.posts) assert(p.fid !== R && !followed.has(p.fid), "the any-half truth holds a post by the root or a follow: " + p.text);
  for (const h of [g.followedPost.hash, g.rootPost.hash]) assert(!sup.has(h), "the any-half truth holds an excluded post");
  assert([...allIn].every((h) => sup.has(h)) && sup.size < allIn.size + 10, "the any-half truth is not the every-account pick plus what a half reaches: " + sup.size + " vs " + allIn.size);
  const tried = [];
  const beyond = [];
  for (let i = 0; i < 16 && (tried.length < 4 || !beyond.length); i++) {
    fresh();
    vaultKey = new Uint8Array(32).fill(40 + i);
    useRoot(R, "root" + R);
    const v = await settle();
    assert(v.state === "ready" && v.items.length >= 5 && !v.partial, "key " + (40 + i) + ": " + v.state + " " + v.items.length + " " + JSON.stringify(v.partial));
    for (const c of v.items) {
      const t = sup.get(c.hash);
      assert(t, "key " + (40 + i) + ": a card outside the any-half truth: '" + c.text + "' by " + c.author.fid);
      const pr = v.proof[c.hash];
      assert(pr && pr.likes === t.likes && pr.recasts === t.recasts && pr.followedBy === t.followedBy, "key " + (40 + i) + ": the proof of " + t.text + ": " + JSON.stringify(pr && { l: pr.likes, r: pr.recasts, f: pr.followedBy }) + " want " + JSON.stringify(t));
    }
    tried.push(v.items.length);
    for (const c of v.items) if (!allIn.has(c.hash)) beyond.push("key " + (40 + i) + ": '" + c.text + "'");
  }
  assert(beyond.length, "none of " + tried.length + " keys reached a post the every-account pick never picks (the check would be vacuous)");
  return tried.length + " keys (" + tried.join(", ") + " cards), every card in the any-half truth (" + sup.size + " posts); beyond the every-account pick (" + allIn.size + "): " + beyond.join(", ");
});

if (!MUTATIONS.length && ONLY.length === 0) {
  const FY = "lib/fc/hubRead/forYou.ts";
  const MF = "lib/fc/hubRead/mode.ts";
  const runs = [
    ["an account the root follows is eligible", "F2", [{ file: FY, find: "  return fid !== e.fid && !run.followed.has(fid) && !C.isOwn(fid) && half(e, fid);", replace: "  return fid !== e.fid && !C.isOwn(fid) && half(e, fid);" }]],
    ["the root itself is eligible", "F2", [{ file: FY, find: "  return fid !== e.fid && !run.followed.has(fid) && !C.isOwn(fid) && half(e, fid);", replace: "  return !run.followed.has(fid) && !C.isOwn(fid) && half(e, fid);" }]],
    ["an own persona is eligible", "F2", [{ file: FY, find: "  return fid !== e.fid && !run.followed.has(fid) && !C.isOwn(fid) && half(e, fid);", replace: "  return fid !== e.fid && !run.followed.has(fid) && half(e, fid);" }]],
    ["the keyed half removed from the candidates", "F4", [{ file: FY, find: "  return fid !== e.fid && !run.followed.has(fid) && !C.isOwn(fid) && half(e, fid);", replace: "  return fid !== e.fid && !run.followed.has(fid) && !C.isOwn(fid);" }]],
    ["the keyed half removed from mentions, parents and quotes", "F4", [{ file: FY, find: "  return !C.isOwn(fid) && half(e, fid);\n}", replace: "  return !C.isOwn(fid);\n}" }]],
    ["an own persona followed by the root is checked for activity", "F2", [{ file: FY, find: "  const list = follows.list.filter((f) => f !== e.fid && !C.isOwn(f));", replace: "  const list = follows.list.filter((f) => f !== e.fid);" }]],
    ["a quiet follow sampled (no activity window)", "F2", [{ file: FY, find: "        if (g.value >= since && run.active.length < F.sample) {", replace: "        if (run.active.length < F.sample) {" }]],
    ["the activity check does not stop at the sample", "F3", [{ file: FY, find: "    for (let i = 0; i < max && run.active.length < F.sample; i += F.probeBatch) {", replace: "    for (let i = 0; i < max; i += F.probeBatch) {" }]],
    ["the activity check cap removed", "F3", [{ file: FY, find: "    const max = Math.min(list.length, F.probeMax);", replace: "    const max = list.length;" }]],
    ["a follow brings in every post it liked", "F2", [{ file: FY, find: "    if (took >= F.likedPerFollow || run.likedSelected >= F.likedMax) break;", replace: "    if (run.likedSelected >= F.likedMax) break;" }]],
    ["an old reaction brings a post in", "F2", [{ file: FY, find: "    if (r.ts < since || e.liked.has(r.target.hash) || !eligible(e, run, r.target.fid)) continue;", replace: "    if (e.liked.has(r.target.hash) || !eligible(e, run, r.target.fid)) continue;" }]],
    ["an account followed by one sampled follow counts as several", "F2", [{ file: FY, find: "x) => run.followed.has(x)).length >= F.minFollowedBy && eligible(e, run, f))", replace: "x) => run.followed.has(x)).length >= 1 && eligible(e, run, f))" }]],
    ["the accounts cap removed", "F3", [{ file: FY, find: "        .slice(0, F.accounts)\n", replace: "" }]],
    ["old posts of the accounts shown", "F2", [{ file: FY, find: "    if (windowed && r.ts < since) return;", replace: "" }]],
    ["a post dated decades ahead kept", "F13", [{ file: FY, find: "    if (r.ts > limit) {\n      future++;\n      return;\n    }", replace: "" }]],
    ["a failed follows read swallowed into an empty one", "F7", [{ file: FY, find: '    run.followsState = "failed";\n    await failed(rt, run);\n    return;', replace: '    run.followsState = "ok";\n    run.followsCount = 0;\n    return;' }]],
    ["nothing shown after failures reported as empty", "F7", [{ file: FY, find: "  const nothing = settled && list.length === 0 && anyFail;", replace: "  const nothing = false;" }]],
    ["reads that failed are not counted", "F7", [{ file: FY, find: "    partial: !code && anyFail ? {", replace: "    partial: false ? {" }]],
    ["what is on screen blinks out while filling", "F6", [{ file: FY, find: "  const page = sh.items.filter((c, i) => i < e.want || e.shown.has(c.rec.hash)).slice(0, F.maxWant);", replace: "  const page = sh.items.slice(0, e.want);" }]],
    ["the mode decides what is read (names only for the page)", "F5", [{ file: FY, find: "  const fids = namesFor(e, rt, run, list);\n  const sh = shaped(e, list, mode, now);", replace: "  const sh = shaped(e, list, mode, now);\n  const fids = namesFor(e, rt, run, sh.items);" }]],
    ["an unreadable mode serves the page unfiltered", "F5", [{ file: FY, find: '  if ("error" in mode) return { items: [], view:', replace: '  if ("error" in mode) return { items: list, view:' }]],
    ["For You's counts not handed to the mode", "F5", [{ file: FY, find: "proof: { likes: c.proof.likes, recasts: c.proof.recasts, affinity: Math.min(1, c.proof.followedBy / denom) }, c }));", replace: "c }));" }]],
    ["engagement ignored on For You", "F5", [{ file: MF, find: "    s += engagement * w(spec.ranking.engagement);", replace: "" }]],
    ["the lens's likes not read on For You", "F5", [{ file: MF, find: "likes: proof?.likes ?? 0, recasts: proof?.recasts ?? 0,", replace: "likes: 0, recasts: 0," }]],
    ["engagement said as not available on For You", "F5", [{ file: MF, find: '  return surface === "foryou" ? out.filter', replace: '  return false ? out.filter' }]],
    ["a light refresh checks activity again", "F10", [{ file: FY, find: "      if (full && now - full.at < F.fullFreshMs && full.active.length) reuse = [...full.active];", replace: "" }]],
    ["a refresh inside the floor reads", "F10", [{ file: FY, find: '      const due = refresh === "manual" ? age >= F.manualFloorMs : refresh === "auto" ? age >= F.lightFreshMs : false;', replace: "      const due = true;" }]],
    ["the op answers while a persona acts (admission removed)", "F11", [{ file: FY, find: "  const rt = C.gate();\n  await C.admit(rt);\n  const acct = await C.signedIn(rt);\n  if (!acct) return notSignedIn();", replace: "  const rt = C.gate();\n  const acct = await C.signedIn(rt);\n  if (!acct) return notSignedIn();" }]],
    ["an answer put together while a persona is chosen is not refused", "F11", [{ file: FY, find: '  if (await rt.acting()) throw new HubReadError("acting_persona");\n  return view(e, rt, mode);', replace: "  return view(e, rt, mode);" }]],
    ["a load a persona's switch interrupted is never run again", "F11", [{ file: FY, find: "    if (!retry && !run.interrupted) {", replace: "    if (!retry) {" }]],
    ["an unreadable vault key fails open", "F4", [{ file: FY, find: '    } catch {\n      throw new HubReadError("vault");\n    }', replace: "    } catch {\n      e.key = new Uint8Array(32);\n    }" }]],
    ["another root keeps the previous root's For You", "F12", [{ file: FY, find: "  if (cur && cur.fid === acct.fid) {\n    cur.fname = acct.fname;\n    return cur;\n  }\n  // a different root (or none before): nothing of the previous one's For You survives", replace: "  if (cur) {\n    cur.fname = acct.fname;\n    return cur;\n  }\n  // a different root (or none before): nothing of the previous one's For You survives" }]],
    ["resetHubReads keeps For You", "F12", [{ file: "lib/fc/hubRead/read.ts", find: "  (globalThis as unknown as { __layersHubForYou?: unknown }).__layersHubForYou = null;\n", replace: "" }]],
    ["another account's reaction counted as a follow's", "F13", [{ file: FY, find: '    if (!d || d.type !== "MESSAGE_TYPE_REACTION_ADD" || d.fid !== fid || !b || b.type !== want) continue;', replace: '    if (!d || !b) continue;' }]],
    ["another account's like counted as a follow's activity", "F13", [{ file: FY, find: '    if (!d || d.type !== "MESSAGE_TYPE_REACTION_ADD" || d.fid !== fid) continue;\n    const ts = tsOf(d);\n    if (ts !== null) newest = Math.max(newest, ts);', replace: "    if (!d) continue;\n    const ts = tsOf(d);\n    if (ts !== null) newest = Math.max(newest, ts);" }]],
    ["another account's follow counted", "F13", [{ file: FY, find: '    if (!d || d.type !== "MESSAGE_TYPE_LINK_ADD" || d.fid !== fid || !lb || lb.type !== "follow" || !C.isFid(lb.targetFid)) continue;', replace: '    if (!d || !lb || !C.isFid(lb.targetFid)) continue;' }]],
    ["a cast under another fid kept", "F13", [{ file: FY, find: "  return C.dedupe(raw.map(C.recOf).filter((r): r is HubRec => !!r && r.fid === fid));", replace: "  return C.dedupe(raw.map(C.recOf).filter((r): r is HubRec => !!r));" }]],
    ["the route reads the body on a server", "F1", [{ file: "app/api/fc/hub/route.ts", find: "  // FIRST, before the body is read: no server reads a visitor's graph\n  if (typeof window === \"undefined\") return deviceOnly();", replace: "  await req.json().catch(() => null);\n  if (typeof window === \"undefined\") return deviceOnly();" }]],
  ];
  await check("M", "MUTATIONS: each guard removed in the bundle only — the check that covers it FAILS (" + runs.length + " mutations)", async () => {
    const survived = [];
    for (const [label, target, muts] of runs) {
      const r = spawnSync(process.execPath, [SELF, "--only=" + target], {
        cwd: ROOT,
        env: { ...process.env, HUBFY_MUTATION: JSON.stringify(muts), HUBFY_UNIT_QUIET: "1", KEYSTORE_DIR: "" },
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
await hub.close();
rmSync(tmp, { recursive: true, force: true });
const summary = `${passed}/${passed + failed} hub For You unit checks passed` + (failed ? ` — FAILED: ${failedIds.join(",")}` : "");
console.log((QUIET ? "" : "\n") + summary);
process.exit(failed ? 1 : 0);
