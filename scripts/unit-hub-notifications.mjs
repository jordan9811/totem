// NOTIFICATIONS FROM FARCASTER — the browser device's Neynar-free notifications for the signed-in root, IN ONE PROCESS,
// with nothing real: lib/fc/hubRead/{notifications,seen,read,copy}.ts and app/api/fc/hub/route.ts bundled with esbuild and
// run as a device (the hub read core's runtime seam), against scripts/lib/farcaster-protocol-stub.mjs on loopback (a
// Snapchain node with the real node's JSON shapes and its PER-SHARD by-target pages, measured 2026-11-06), and the vault
// sealing for real on a temporary KEYSTORE_DIR (only the validator's storage is an in-memory stand-in). No request
// leaves the machine.
//
//   N1  the reads: plain GETs naming the root only, exactly the measured paths and page sizes (3 heads + 3 per post), no
//       token followed; a misconfigured node refuses with zero requests; no server answers the new ops (404, body unread)
//   N2  GROUPED AND ORDERED like X: likes and recasts per post, follows per day, replies and mentions one by one (a reply
//       that also mentions the root once, as a reply); newest first; the sentences ("A, B and 12 others liked your post");
//       the tabs (Priority without likes and recasts, Mentions = replies + mentions); the root's own actions left out;
//       replies and mentions are hub cards
//   N3  SHARDS: the node's two-shard pages are merged to the exact newest 50 followers; a post's replies are read ONCE
//       (castsByParent's token never ends); a full reactions page says "at least"
//   N4  UNREAD and the SEALED seen record: never seen = all unread; viewing marks seen and the count is 0; a new like after
//       that is its own group, the only unread; the record is one 256-byte ciphertext with no plaintext; it never moves
//       back; an event dated 40 years ahead is left out (counted) and cannot mark the future seen; a record for another
//       account reads as never; uniform presence seals the empty record once
//   N5  NEVER FAIL OPEN: every read failing is an ERROR (never "no notifications"); one source failing is counted and the
//       rest shown; a failed re-read keeps the earlier read and is counted; Retry recovers; an unreadable seen record is
//       said and the count is null (never 0); a seen write that fails is seen_unsaved
//   N6  TRUE EMPTY only after every read succeeded
//   N7  INCREMENTAL: nothing re-read inside a minute; then the heads and only the posts due on their own clock; "Check
//       now" floors at 30 s; a new root post enters the window and is read, one that fell out goes
//   N8  PERSONA SEPARATION: what an own persona did is left out and no read names it; while a persona acts every op
//       refuses and nothing leaves, a read queued before the switch included; the guard covers `target_fid=`
//   N9  429: the node's Retry-After pauses the reads, said on the page, nothing marked failed
//   N10 the badge op: the same count with no profile read
//   N11 identity: another root never sees the previous root's notifications; resetHubReads drops them
//   N12 shapes: a record of another kind, another post or another target in an answer is dropped
//   M   MUTATIONS: each guard removed in the BUNDLE ONLY, and the check that covers it must then FAIL
//
//   node scripts/unit-hub-notifications.mjs            (npm run test:hub-notif-unit)
//   node scripts/unit-hub-notifications.mjs --only=N4
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
const MUTATIONS = process.env.HUBNOTIF_MUTATION ? JSON.parse(process.env.HUBNOTIF_MUTATION) : [];
const QUIET = process.env.HUBNOTIF_UNIT_QUIET === "1";

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
const tmp = mkdtempSync(path.join(os.tmpdir(), "layers-hubnotif-unit-"));
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
  // the validator's storage, in memory, with failure knobs (the vault's sealing is the real module)
  "persist.ts": `export const validatorStore = new Map<string, Record<string, unknown>>();
export const knobs: { failFetch: Record<string, number>; failFlush: Record<string, number>; flushes: Array<{ ns: string; at: number }> } = { failFetch: {}, failFlush: {}, flushes: [] };
export async function fetchState(ns: string): Promise<{ status: number; ok: boolean; json: () => Promise<any> }> {
  const f = knobs.failFetch[ns];
  if (f) return { status: f, ok: false, json: async () => ({}) };
  const entries = validatorStore.get(ns);
  if (!entries) return { status: 200, ok: true, json: async () => ({ entries: {} }) };
  return { status: 200, ok: true, json: async () => ({ entries: JSON.parse(JSON.stringify(entries)) }) };
}
export async function flushVault(ns: string, entries: Record<string, unknown>): Promise<void> {
  if (knobs.failFlush[ns] && knobs.failFlush[ns] > 0) { knobs.failFlush[ns]--; throw new Error("validator answered 503"); }
  knobs.flushes.push({ ns, at: Date.now() });
  validatorStore.set(ns, JSON.parse(JSON.stringify(entries)));
}
export async function flush(ns: string, entries: Record<string, unknown>): Promise<void> { return flushVault(ns, entries); }
export async function signedWriteHeaders(): Promise<Record<string, string>> { return {}; }
export function sealedNamespaces(): Set<string> { return new Set(); }
export function resetEnvelopeBootstrap(): void {}
`,
  // SPEC A (merged 2026-11-06): the hub timeline's mode loader reads the mode store, a stateful edge; stood in for here
  "modeSource.ts": "export async function hubModeSpec() { return null; }\n",
  // SPEC C: the extras' loader reads the readwise state, the desks and the ring inbox, stateful edges too; stood in for
  // the same way (scripts/unit-hub-read.mjs H19-H21 cover the extras)
  "extrasSource.ts": "export async function hubExtrasSpec() { return null; }\n",
  "separation.ts": `export async function ownPersonaAccounts() { return { fids: new Set<number>(), names: new Map<number, string | null>() }; }
export async function personaActing() { return false; }
`,
  "entry.ts": `export * as read from "@/lib/fc/hubRead/read";
export * as copy from "@/lib/fc/hubRead/copy";
export * as notif from "@/lib/fc/hubRead/notifications";
export * as seen from "@/lib/fc/hubRead/seen";
export * as pins from "@/lib/vault/sealedPins";
export * as route from "@/app/api/fc/hub/route";
export * as nextStub from "next/server";
export * as persistStub from "@/lib/adapters/mock/persist";
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
    alias: { "server-only": S("server-only.ts"), "next/server": S("next-server.ts"), "@/lib/adapters/mock/persist": S("persist.ts"), "@/lib/fc/hubRead/separation": S("separation.ts"), "@/lib/fc/hubRead/modeSource": S("modeSource.ts"), "@/lib/fc/hubRead/extrasSource": S("extrasSource.ts") },
  });
  M = await import(pathToFileURL(outFile).href);
  if (MUTATIONS.length && applied.size !== MUTATIONS.length) throw new Error("MUTATION FILE NOT IN THE BUNDLE");
} catch (e) {
  console.log("cannot bundle the notifications modules: " + (e && e.message ? e.message.split("\n").slice(0, 3).join(" | ") : String(e)));
  rmSync(tmp, { recursive: true, force: true });
  process.exit(2);
}
const { read, copy, notif, seen, pins, route, nextStub, persistStub } = M;
const L = notif.HUB_NOTIF_LIMITS;

// ---------------------------------------------------------------------------------------------------- the network
const { startProtocolStub } = await import(pathToFileURL(path.join(ROOT, "scripts", "lib", "farcaster-protocol-stub.mjs")).href);
const hub = await startProtocolStub({ firstFid: 992500 });
const seenReq = [];
let rewrite = null;
let skew = 0;
const tabFetch = async (url, init = {}) => {
  const u = String(url);
  seenReq.push({ url: u, method: init.method ?? "GET", credentials: init.credentials, referrerPolicy: init.referrerPolicy, headers: init.headers ?? null });
  const res = await fetch(url, init);
  if (rewrite) {
    const r = await rewrite(u, res);
    if (r) return r;
  }
  return res;
};
let acct = null;
let ownSet = { fids: new Set(), names: new Map() };
let acting = false;
const ENV = { FC_ROOT_HUB_URL: hub.hubUrl };
const useRoot = (fid, fname = null) => {
  acct = fid ? { fid, fname } : null;
};
const fresh = (env = ENV) => {
  read.resetHubReads();
  seen.resetNotifSeenCache();
  hub.clearHubSteering();
  hub.resetHubReads();
  seenReq.length = 0;
  rewrite = null;
  skew = 0;
  acting = false;
  ownSet = { fids: new Set(), names: new Map() };
  persistStub.knobs.failFetch = {};
  persistStub.knobs.failFlush = {};
  read.__setHubReadRuntimeForTests({ device: true, env, fetch: tabFetch, now: () => Date.now() + skew, account: async () => acct, own: async () => ownSet, acting: async () => acting });
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
/** ask until the page's answer settles (the island's loop) */
async function settle(opts = {}, tries = 40) {
  let v = null;
  for (let i = 0; i < tries; i++) {
    v = await notif.hubNotifications({ waitMs: 2500, ...opts });
    if (v.state !== "loading") return v;
    opts = { ...opts, refresh: null, retry: false };
  }
  throw new Error("the notifications never settled: " + JSON.stringify({ state: v?.state, items: v?.items?.length }));
}
const reads = (p) => hub.hubRead.reads.filter((r) => !p || r.path === p);
const at = (min) => {
  const t = Date.now() - min * 60_000;
  return t - (t % 1000);
};
let seq = 0;
/** a root with posts: returns their hashes (newest first) */
function plantRoot(root, nPosts, { name = "root" + root, startMin = 30, stepMin = 60 } = {}) {
  hub.plantProfile(root, { username: name, display: "Root " + root });
  const hashes = [];
  for (let i = 0; i < nPosts; i++) hashes.push(hub.plantCast({ fid: root, ts: at(startMin + i * stepMin), text: "post " + i + " by the root", seed: "root:" + root + ":" + i + ":" + ++seq }));
  return hashes;
}
const person = (fid, name) => hub.plantProfile(fid, { username: name, display: name[0].toUpperCase() + name.slice(1) });

out("\nHUB NOTIFICATIONS UNIT — the device's Neynar-free notifications, against a loopback Snapchain stub" + (MUTATIONS.length ? "  [MUTATED BUNDLE]" : ""));

await check("N1", "the reads: plain GETs naming the root only, exactly the measured paths and page sizes (3 heads + 3 per post), no token followed; misconfigured refuses with zero requests; no server answers the new ops", async () => {
  fresh();
  const R = 600;
  const posts = plantRoot(R, 4);
  person(601, "alice");
  hub.plantFollow({ fid: 601, target: R, ts: at(5) });
  hub.plantReaction({ fid: 601, kind: "like", target: { fid: R, hash: posts[0] }, ts: at(4) });
  hub.hubRead.shardedParents = true;
  useRoot(R, "root600");
  const v = await settle();
  assert(v.state === "ready" && v.items.length === 2, "the view: " + v.state + " " + v.items.length);
  const node = seenReq.filter((r) => r.url.startsWith(hub.hubUrl));
  assert(node.length === seenReq.length, "a request went elsewhere");
  for (const r of node) assert(r.method === "GET" && r.credentials === "omit" && r.referrerPolicy === "no-referrer" && r.headers === null, "not a plain GET: " + JSON.stringify(r));
  assert(hub.hubRead.preflights === 0, "a preflight reached the node");
  const q = (p) => node.filter((r) => new URL(r.url).pathname === p).map((r) => new URL(r.url).searchParams);
  const lt = q("/v1/linksByTargetFid");
  assert(lt.length === 1 && lt[0].get("target_fid") === String(R) && lt[0].get("link_type") === "follow" && lt[0].get("pageSize") === "50" && lt[0].get("reverse") === "true" && !lt[0].get("pageToken"), "linksByTargetFid: " + lt.map(String));
  const cm = q("/v1/castsByMention");
  assert(cm.length === 1 && cm[0].get("fid") === String(R) && cm[0].get("pageSize") === "50" && cm[0].get("reverse") === "true", "castsByMention: " + cm.map(String));
  const cf = q("/v1/castsByFid");
  assert(cf.length === 1 && cf[0].get("fid") === String(R) && cf[0].get("pageSize") === String(L.posts) && cf[0].get("reverse") === "true", "castsByFid: " + cf.map(String));
  const cp = q("/v1/castsByParent");
  assert(cp.length === 4 && cp.every((s) => s.get("fid") === String(R) && s.get("pageSize") === "50" && posts.includes(s.get("hash")) && !s.get("pageToken")), "castsByParent: " + cp.map(String));
  const rc = q("/v1/reactionsByCast");
  assert(rc.length === 8 && rc.every((s) => s.get("target_fid") === String(R) && s.get("pageSize") === "100" && posts.includes(s.get("target_hash")) && !s.get("pageToken")) && rc.filter((s) => s.get("reaction_type") === "Like").length === 4 && rc.filter((s) => s.get("reaction_type") === "Recast").length === 4, "reactionsByCast: " + rc.map(String));
  const named = reads().filter((r) => !["/v1/userDataByFid", "/v1/castById"].includes(r.path));
  assert(named.length === 3 + 3 * 4 && named.every((r) => r.fid === R), "the fan-out named someone else or the count is off: " + named.length + " " + [...new Set(named.map((r) => r.fid))]);
  // misconfigured: refused with no request
  for (const bad of [{ FC_ROOT_HUB_URL: "https://evil.example/path?key=1" }, { FC_ROOT_HUB_URL: hub.hubUrl, FC_ROOT_POST: "bad_config" }]) {
    fresh(bad);
    useRoot(R);
    for (const p of [notif.hubNotifications(), notif.hubUnread(), notif.hubNotificationsSeen({ upTo: Date.now() })]) {
      const e = await errOf(p);
      assert(e && e.code === "bad_config" && seenReq.length === 0, "a misconfigured node was read or not refused: " + (e ? e.code : "no error") + " " + seenReq.length);
    }
  }
  fresh();
  // the route on a SERVER (no window): 404 device_only for the new ops, the body never read
  for (const op of ["notifications", "unread", "seen"]) {
    const req = new nextStub.NextRequest("http://x/api/fc/hub", { method: "POST", body: JSON.stringify({ op, upTo: Date.now() }) });
    const r = await route.POST(req);
    assert(r.status === 404 && r.body.code === "device_only" && req.readCount === 0, op + ": a server answered or read the body: " + r.status + " read " + req.readCount);
  }
  return node.length + " plain GETs (" + named.length + " naming the root, the rest profiles); 2 misconfigurations refused with 0 requests";
});

await check("N2", "GROUPED AND ORDERED like X: likes and recasts per post, follows per day, replies and mentions one by one; newest first; the sentences; the tabs; the root's own actions left out; replies and mentions are hub cards", async () => {
  fresh();
  const R = 610;
  const [p0, p1] = plantRoot(R, 3, { startMin: 600, stepMin: 120 });
  const fans = Array.from({ length: 14 }, (_, i) => 6110 + i);
  fans.forEach((f, i) => person(f, "fan" + i));
  // 14 likes on p0 (the newest by fan0, 20 minutes ago), 2 recasts on p1, 3 new followers today, a reply, a mention,
  // a reply that ALSO mentions the root (shown once, as a reply), and the root's own self-like and self-reply (left out)
  fans.forEach((f, i) => hub.plantReaction({ fid: f, kind: "like", target: { fid: R, hash: p0 }, ts: at(20 + i) }));
  hub.plantReaction({ fid: fans[0], kind: "recast", target: { fid: R, hash: p1 }, ts: at(50) });
  hub.plantReaction({ fid: fans[1], kind: "recast", target: { fid: R, hash: p1 }, ts: at(55) });
  hub.plantReaction({ fid: R, kind: "like", target: { fid: R, hash: p0 }, ts: at(1) });
  for (const [i, f] of fans.slice(0, 3).entries()) hub.plantFollow({ fid: f, target: R, ts: at(10) - i * 1000 });
  hub.plantFollow({ fid: R, target: R, ts: at(2) }); // a self-follow (the real node lists them)
  const reply = hub.plantCast({ fid: fans[3], ts: at(15), text: "nice post", parent: { fid: R, hash: p0 }, seed: "n2:reply" });
  const replyMention = hub.plantCast({ fid: fans[4], ts: at(12), text: " agreed", parent: { fid: R, hash: p1 }, mentions: [R], mentionsPositions: [0], seed: "n2:rm" });
  const mention = hub.plantCast({ fid: fans[5], ts: at(8), text: "hey  look", mentions: [R], mentionsPositions: [4], seed: "n2:mention" });
  hub.plantCast({ fid: R, ts: at(3), text: "my own follow-up", parent: { fid: R, hash: p0 }, seed: "n2:self" });
  useRoot(R, "root610");
  const v = await settle();
  assert(v.state === "ready" && !v.partial, "the view: " + v.state + " " + JSON.stringify(v.partial));
  const kinds = v.items.map((i) => i.kind + ":" + (i.cast ? i.cast.hash.slice(0, 8) : i.target ? i.target.hash.slice(0, 8) : "") + ":" + i.count);
  const want = ["mention:" + mention.slice(0, 8) + ":1", "follow::3", "reply:" + replyMention.slice(0, 8) + ":1", "reply:" + reply.slice(0, 8) + ":1", "like:" + p0.slice(0, 8) + ":14", "recast:" + p1.slice(0, 8) + ":2"];
  assert(JSON.stringify(kinds) === JSON.stringify(want), "the groups, in order: " + JSON.stringify(kinds) + " want " + JSON.stringify(want));
  const ts = v.items.map((i) => i.at);
  assert(ts.every((t, i) => i === 0 || t <= ts[i - 1]), "not newest first");
  const like = v.items.find((i) => i.kind === "like");
  assert(like.actors.length === L.actorsShown && like.actors[0].fid === fans[0] && like.actors[1].fid === fans[1] && like.at === at(20) && !like.atLeast, "the like group's actors: " + like.actors.map((a) => a.fid));
  assert(copy.notifSentence(like) === "Fan0, Fan1 and 12 others liked your post", "the sentence: " + copy.notifSentence(like));
  assert(like.target.fid === R && like.target.text === "post 0 by the root", "the target: " + JSON.stringify(like.target));
  const rec = v.items.find((i) => i.kind === "recast");
  assert(copy.notifSentence(rec) === "Fan0 and Fan1 recast your post", "the recast sentence: " + copy.notifSentence(rec));
  const fol = v.items.find((i) => i.kind === "follow");
  assert(copy.notifSentence(fol) === "Fan0, Fan1 and 1 other followed you" && !fol.actors.some((a) => a.fid === R), "the follow sentence: " + copy.notifSentence(fol));
  const rc = v.items.find((i) => i.kind === "reply" && i.cast.hash === reply).cast;
  assert(rc.hub === true && rc.parentHash === p0 && rc.replyingTo === "@root610" && rc.author.username === "fan3" && !rc.hubOwn, "the reply card: " + JSON.stringify({ hub: rc.hub, p: rc.parentHash, to: rc.replyingTo, a: rc.author.username }));
  const mc = v.items.find((i) => i.kind === "mention").cast;
  assert(mc.text === "hey @root610 look", "the mention's text at its byte position: " + mc.text);
  assert(!v.items.some((i) => (i.cast && i.cast.author.fid === R) || i.actors.some((a) => a.fid === R)), "the root's own action shown");
  assert(v.unread === 6 && v.items.every((i) => i.unread) && v.seenAt === null && v.newestAt === at(8), "never seen = all unread: " + JSON.stringify({ u: v.unread, s: v.seenAt, n: v.newestAt }));
  const pr = await notif.hubNotifications({ tab: "priority" });
  assert(pr.tab === "priority" && pr.items.map((i) => i.kind).join() === "mention,follow,reply,reply", "Priority: " + pr.items.map((i) => i.kind));
  const mn = await notif.hubNotifications({ tab: "mentions" });
  assert(mn.items.map((i) => i.kind).join() === "mention,reply,reply" && mn.unread === 6, "Mentions: " + mn.items.map((i) => i.kind) + " unread " + mn.unread);
  return v.items.length + " groups in order; '" + copy.notifSentence(like) + "'";
});

await check("N3", "SHARDS: the node's two-shard pages merged to the exact newest 50 followers; a post's replies read ONCE (castsByParent's token never ends); a full reactions page says 'at least'", async () => {
  fresh();
  const R = 620;
  const [p0, p1] = plantRoot(R, 2);
  hub.hubRead.shardedParents = true;
  // 120 followers over both shards (60 each, so each shard's page of 50 is full), one a minute; the newest 50 (followers
  // 119 down to 70) are the truth
  const F = (i) => 62_000 + i;
  for (let i = 0; i < 120; i++) {
    person(F(i), "f" + i);
    hub.plantFollow({ fid: F(i), target: R, ts: at(200 - i) });
  }
  // 12 replies to p0, and 130 likes on p1 (more than one page of 100)
  for (let i = 0; i < 12; i++) hub.plantCast({ fid: F(i), ts: at(100 - i), text: "reply " + i, parent: { fid: R, hash: p0 }, seed: "n3:r" + i });
  for (let i = 0; i < 130; i++) hub.plantReaction({ fid: 63_000 + i, kind: "like", target: { fid: R, hash: p1 }, ts: at(300 - i) });
  useRoot(R);
  const v = await settle();
  const linksAnswer = reads("/v1/linksByTargetFid");
  assert(linksAnswer.length === 1, "followers read " + linksAnswer.length + " times");
  const followerFids = v.items.filter((i) => i.kind === "follow").flatMap((i) => i.count);
  const totalFollowers = followerFids.reduce((s, n) => s + n, 0);
  assert(totalFollowers === 50, "followers shown: " + totalFollowers + " (want exactly the newest 50 of the 2 shards' 100)");
  const shownActors = new Set(v.items.filter((i) => i.kind === "follow").flatMap((i) => i.actors.map((a) => a.fid)));
  assert(shownActors.size > 0 && [...shownActors].every((f) => f >= F(70)), "an older follower beat a newer one: " + [...shownActors].filter((f) => f < F(70)));
  assert(v.items.filter((i) => i.kind === "follow")[0].actors[0].fid === F(119), "the newest follower is not first");
  const replies = v.items.filter((i) => i.kind === "reply");
  assert(replies.length === 12 && new Set(replies.map((r) => r.cast.hash)).size === 12, "replies: " + replies.length);
  assert(reads("/v1/castsByParent").length === 2, "castsByParent read " + reads("/v1/castsByParent").length + " times for 2 posts (a never-ending token was followed)");
  const likes = v.items.find((i) => i.kind === "like" && i.target.hash === p1);
  assert(likes && likes.count === 100 && likes.atLeast === true, "the full reactions page: " + JSON.stringify(likes && { c: likes.count, a: likes.atLeast }));
  assert(/^.+, .+ and at least 98 others liked your post$/.test(copy.notifSentence(likes)), "the sentence: " + copy.notifSentence(likes));
  return "50 of 70 followers (2 shards), 12 replies in one read per post, 130 likes = 'at least 98 others'";
});

await check("N4", "UNREAD and the SEALED seen record: viewing marks seen (count 0); a new like after that is its own group, the only unread; one 256-byte ciphertext, no plaintext; never moves back; a post dated 40 years ahead is left out and cannot mark the future seen; another account's record reads as never; uniform presence once", async () => {
  fresh();
  persistStub.validatorStore.delete("fcNotifications");
  pins.resetSealedPins?.();
  const R = 630;
  const [p0] = plantRoot(R, 1);
  person(631, "ann");
  person(632, "ben");
  person(633, "cy");
  hub.plantReaction({ fid: 631, kind: "like", target: { fid: R, hash: p0 }, ts: at(20) });
  hub.plantReaction({ fid: 632, kind: "like", target: { fid: R, hash: p0 }, ts: at(10) });
  // a reply dated 40 years ahead (a real node holds such casts): left out, counted, never the "newest"
  const future = hub.plantCast({ fid: 633, ts: Date.now() + 40 * 365 * 86_400_000 - ((Date.now() + 40 * 365 * 86_400_000) % 1000), text: "from the future", parent: { fid: R, hash: p0 }, seed: "n4:future" });
  useRoot(R);
  // uniform presence: the empty record sealed once, then present
  const e1 = await seen.ensureNotifSeenNamespace();
  const e2 = await seen.ensureNotifSeenNamespace();
  assert(e1 === "sealed" && e2 === "present", "uniform presence: " + e1 + " " + e2);
  const v0 = await settle();
  assert(v0.unread === 1 && v0.seenAt === null && v0.items.length === 1 && v0.items[0].count === 2 && v0.items[0].unread, "never seen: " + JSON.stringify({ u: v0.unread, n: v0.items.length }));
  assert(v0.futureDated === 1 && v0.newestAt === at(10) && !v0.items.some((i) => i.cast && i.cast.hash === future), "the future-dated reply: " + JSON.stringify({ f: v0.futureDated, n: v0.newestAt }));
  // viewing: seen up to the newest shown
  const s1 = await notif.hubNotificationsSeen({ upTo: v0.newestAt });
  assert(s1.seenAt === at(10), "seen: " + JSON.stringify(s1));
  const v1 = await notif.hubNotifications();
  assert(v1.unread === 0 && v1.seenAt === at(10) && v1.items.every((i) => !i.unread), "after viewing: " + JSON.stringify({ u: v1.unread, s: v1.seenAt }));
  const u1 = await notif.hubUnread();
  assert(u1.state === "ok" && u1.unread === 0, "the badge after viewing: " + JSON.stringify(u1));
  // the record: one opaque record of exactly 256 bytes, sealed, no plaintext
  const entries = persistStub.validatorStore.get("fcNotifications");
  assert(entries && Object.keys(entries).length === 1 && entries._ && /^[0-9a-f]+$/.test(entries._.ct) && entries._.ct.length / 2 === seen.NOTIF_SEEN_BYTES, "not one 256-byte opaque record: " + JSON.stringify(entries).slice(0, 160));
  const raw = JSON.stringify(entries);
  const keys = Object.keys(entries._).sort().join();
  assert(!raw.includes(String(at(10))) && !raw.includes("seenAt") && !raw.includes('"m"') && !raw.includes("pad") && /^[a-z,]+$/.test(keys) && !/\bm\b|seen|fid/.test(keys), "plaintext in the stored record: " + keys);
  const empty = seen.sealNotifSeenDoc({ v: 1, fid: null, seenAt: null });
  const full = seen.sealNotifSeenDoc({ v: 1, fid: 2 ** 40, seenAt: 8_640_000_000_000 });
  assert(empty._.ct.length === full._.ct.length && empty._.ct.length / 2 === seen.NOTIF_SEEN_BYTES, "sizes differ: " + empty._.ct.length + " / " + full._.ct.length);
  // a cold read of the record (another tab) says the same
  seen.resetNotifSeenCache();
  const v1b = await notif.hubNotifications();
  assert(v1b.seenAt === at(10) && v1b.unread === 0, "a cold read of the record: " + JSON.stringify({ s: v1b.seenAt, u: v1b.unread }));
  // never back: an older upTo leaves it
  const s2 = await notif.hubNotificationsSeen({ upTo: at(60) });
  assert(s2.seenAt === at(10), "it moved back: " + s2.seenAt);
  // a new like: its own group (":new"), the only unread; the old group keeps its two
  hub.plantReaction({ fid: 633, kind: "like", target: { fid: R, hash: p0 }, ts: at(1) });
  skew = 31 * 60_000; // past the post's own clock
  const v2 = await settle({ refresh: "auto" });
  const nw = v2.items.find((i) => i.id.endsWith(":new"));
  const old = v2.items.find((i) => i.id.endsWith(":old"));
  assert(v2.unread === 1 && nw && nw.count === 1 && nw.actors[0].fid === 633 && nw.unread && old && old.count === 2 && !old.unread, "the new like's group: " + JSON.stringify(v2.items.map((i) => [i.id, i.count, i.unread])));
  // an upTo past "now" plus the clock allowance is clamped: the future cannot be marked seen
  const far = Date.now() + 365 * 86_400_000;
  const s3 = await notif.hubNotificationsSeen({ upTo: far });
  assert(s3.seenAt !== null && s3.seenAt <= Date.now() + skew + L.futureSkewMs + 1000, "the future was marked seen: " + s3.seenAt);
  for (const bad of [null, "1", -1, 1.5, 0]) {
    const e = await errOf(notif.hubNotificationsSeen({ upTo: bad }));
    assert(e && e.code === "bad_request", "upTo " + JSON.stringify(bad) + " was accepted");
  }
  // a record for ANOTHER Farcaster account reads as never seen
  skew = 0;
  const R2 = 635;
  plantRoot(R2, 1);
  hub.plantFollow({ fid: 631, target: R2, ts: at(5) });
  useRoot(R2);
  const v3 = await settle();
  assert(v3.seenAt === null && v3.unread === 1, "another account's record was used: " + JSON.stringify({ s: v3.seenAt, u: v3.unread }));
  return "seen at the newest, count 0; a new like = 1 unread in its own group; 256-byte sealed record; clamped; per account";
});

await check("N5", "NEVER FAIL OPEN: every read failing is an ERROR; one source failing is counted and the rest shown; a failed re-read keeps the earlier read and is counted; Retry recovers; an unreadable seen record is said and the count is null; a failed seen write is seen_unsaved", async () => {
  fresh();
  const R = 640;
  const [p0] = plantRoot(R, 2);
  person(641, "dee");
  hub.plantFollow({ fid: 641, target: R, ts: at(5) });
  hub.plantReaction({ fid: 641, kind: "like", target: { fid: R, hash: p0 }, ts: at(4) });
  hub.plantCast({ fid: 641, ts: at(3), text: "hi ", mentions: [R], mentionsPositions: [3], seed: "n5:m" });
  useRoot(R);
  // (a) every read fails: an ERROR, never "no notifications"
  hub.hubRead.fails.push({ path: "*", fid: "*", status: 500, n: 1e9 });
  const v = await settle();
  assert(v.state === "error" && v.code === "notifications_unreadable" && v.items.length === 0 && !v.empty && v.unread === null && /not an empty list/.test(v.reason), "every read failed: " + JSON.stringify({ s: v.state, c: v.code, e: v.empty, u: v.unread }));
  const u = await notif.hubUnread();
  assert(u.state === "error" && u.unread === null, "the badge when every read failed: " + JSON.stringify(u));
  // Retry recovers
  hub.clearHubSteering();
  const r = await settle({ retry: true });
  assert(r.state === "ready" && r.items.length === 3 && !r.partial, "Retry: " + JSON.stringify({ s: r.state, n: r.items.length, p: r.partial }));
  // (b) one source fails (mentions), the rest shown, the failure counted and said
  fresh();
  useRoot(R);
  hub.hubRead.fails.push({ path: "/v1/castsByMention", fid: "*", status: 500, n: 1e9 });
  const p = await settle();
  assert(p.state === "ready" && p.items.length === 2 && p.partial && p.partial.failed === 1 && /your mentions/.test(p.partial.sentence) && !p.empty, "a failed mentions read: " + JSON.stringify({ s: p.state, n: p.items.length, p: p.partial }));
  // per-post failures are counted too
  fresh();
  useRoot(R);
  hub.hubRead.fails.push({ path: "/v1/reactionsByCast", fid: "*", status: 503, n: 1e9 });
  const pp = await settle();
  assert(pp.partial && pp.partial.failed === 2 && /2 of your posts/.test(pp.partial.sentence) && pp.items.some((i) => i.kind === "follow"), "failed reactions on 2 posts: " + JSON.stringify(pp.partial));
  // (c) a failed RE-read keeps what was read, and is counted
  fresh();
  useRoot(R);
  const ok = await settle();
  assert(ok.items.length === 3 && !ok.partial, "the first read");
  hub.hubRead.fails.push({ path: "/v1/linksByTargetFid", fid: "*", status: 500, n: 1e9 });
  skew = 61_000;
  const re = await settle({ refresh: "auto" });
  assert(re.items.some((i) => i.kind === "follow") && re.partial && /your new followers/.test(re.partial.sentence), "a failed re-read: " + JSON.stringify({ n: re.items.map((i) => i.kind), p: re.partial }));
  hub.clearHubSteering();
  const rr = await settle({ retry: true });
  assert(!rr.partial, "Retry after a failed re-read: " + JSON.stringify(rr.partial));
  // (d) the seen record unreadable: said, nothing marked new, the count null (never 0)
  seen.resetNotifSeenCache();
  persistStub.knobs.failFetch = { fcNotifications: 503 };
  const sv = await notif.hubNotifications();
  assert(sv.seenError && /Couldn.t read which notifications/.test(sv.seenError) && sv.unread === null && sv.items.length === 3 && sv.items.every((i) => !i.unread), "an unreadable seen record: " + JSON.stringify({ e: sv.seenError, u: sv.unread }));
  const su = await notif.hubUnread();
  assert(su.state === "error" && su.unread === null, "the badge with the seen record unreadable: " + JSON.stringify(su));
  const se = await errOf(notif.hubNotificationsSeen({ upTo: at(3) }));
  assert(se && se.code === "seen_unsaved" && se.status === 503, "marking seen with the record unreadable: " + (se ? se.code : "it answered"));
  // (e) a write that fails: seen_unsaved, and the next view is still unread
  persistStub.knobs.failFetch = {};
  persistStub.knobs.failFlush = { fcNotifications: 1e9 };
  const we = await errOf(notif.hubNotificationsSeen({ upTo: at(3) }));
  persistStub.knobs.failFlush = {};
  assert(we && we.code === "seen_unsaved", "a failed seen write: " + (we ? we.code : "it answered"));
  const after = await notif.hubNotifications();
  assert(after.unread === 3, "a failed write was taken as seen: " + after.unread);
  return "error / counted / kept / Retry / seen unreadable = null / seen_unsaved";
});

await check("N6", "TRUE EMPTY only after every read succeeded", async () => {
  fresh();
  const R = 650;
  plantRoot(R, 2);
  useRoot(R);
  const v = await settle();
  assert(v.state === "ready" && v.empty === true && v.items.length === 0 && v.unread === 0 && !v.partial, "a root with nothing: " + JSON.stringify({ s: v.state, e: v.empty, u: v.unread }));
  fresh();
  useRoot(R);
  hub.hubRead.fails.push({ path: "/v1/castsByParent", fid: "*", status: 500, n: 1e9 });
  const f = await settle();
  assert(f.empty === false && f.partial && f.partial.failed === 2, "an empty answer with a failed read said empty: " + JSON.stringify({ e: f.empty, p: f.partial }));
  fresh();
  useRoot(651);
  const n = await settle();
  assert(n.empty === true && n.items.length === 0, "an account with no posts and no followers: " + JSON.stringify({ e: n.empty, s: n.state }));
  return "empty only when every read worked";
});

await check("N7", "INCREMENTAL: nothing re-read inside a minute; then the heads and only the posts due on their own clock; 'Check now' floors at 30 s; a new root post enters the window, one that fell out goes", async () => {
  fresh();
  const R = 660;
  // one post 2 minutes old (its clock: 1 minute), one 10 hours old (its clock: 30 minutes)
  const young = hub.plantCast({ fid: R, ts: at(2), text: "young", seed: "n7:young" });
  const old = hub.plantCast({ fid: R, ts: at(600), text: "old", seed: "n7:old" });
  useRoot(R);
  await settle();
  const n0 = reads().length;
  await settle({ refresh: "auto" });
  assert(reads().length === n0, "re-read inside a minute: " + (reads().length - n0));
  const postHashes = () => seenReq.filter((s) => /\/v1\/(castsByParent|reactionsByCast)\?/.test(s.url)).map((s) => new URL(s.url).searchParams.get("hash") ?? new URL(s.url).searchParams.get("target_hash"));
  hub.resetHubReads();
  seenReq.length = 0;
  skew = 61_000;
  await settle({ refresh: "auto" });
  const due = postHashes();
  const h2 = ["/v1/linksByTargetFid", "/v1/castsByMention", "/v1/castsByFid"].map((p) => reads(p).length);
  assert(h2.every((n) => n === 1) && due.length === 3 && due.every((h) => h === young), "after a minute: heads " + h2 + ", per-post reads " + due.length + " for " + [...new Set(due)].map((h) => (h === young ? "young" : h === old ? "old" : h)) + " (only the young post is due)");
  // "Check now" floors at 30 s: right after, only what was not read in the last 30 s (the old post), no head
  hub.resetHubReads();
  seenReq.length = 0;
  await settle({ refresh: "manual" });
  const m1 = postHashes();
  assert(["/v1/linksByTargetFid", "/v1/castsByMention", "/v1/castsByFid"].every((p) => reads(p).length === 0) && m1.length === 3 && m1.every((h) => h === old), "a manual check inside 30 s: " + reads().length + " reads, posts " + m1.length);
  skew += 31_000;
  hub.resetHubReads();
  seenReq.length = 0;
  await settle({ refresh: "manual" });
  assert(reads().filter((r) => r.path !== "/v1/userDataByFid" && r.path !== "/v1/castById").length === 3 + 6, "a manual check after 30 s: " + reads().length + " (want 3 heads + both posts)");
  // new root posts enter the window and are read at once; the 25-post window drops the two older ones
  for (let i = 0; i < L.posts; i++) hub.plantCast({ fid: R, ts: at(1) - i * 1000, text: "new " + i, seed: "n7:new" + i });
  skew += 61_000;
  hub.resetHubReads();
  seenReq.length = 0;
  const v = await settle({ refresh: "auto" });
  const moved = postHashes();
  assert(moved.length === 3 * L.posts && !moved.includes(old) && !moved.includes(young), "the window: " + moved.length + " per-post reads, old " + moved.includes(old) + ", young " + moved.includes(young));
  assert(v.state === "ready", "the view: " + v.state);
  return "0 reads inside a minute; then 3 heads + the young post only; manual floor 30 s; the window moved to 25 new posts";
});

await check("N8", "PERSONA SEPARATION: what an own persona did is left out and no read names it; while a persona acts every op refuses and nothing leaves, a queued read included; the guard covers target_fid", async () => {
  fresh();
  const R = 670, OWN = 675, OTHER = 671;
  const [p0] = plantRoot(R, 1);
  person(OTHER, "other");
  hub.plantProfile(OWN, { username: "mine-on-the-node", display: "Mine" });
  ownSet = { fids: new Set([OWN]), names: new Map([[OWN, "mine"]]) };
  // the persona follows the root, likes and recasts its post, replies to it and mentions it; OTHER likes it too
  hub.plantFollow({ fid: OWN, target: R, ts: at(5) });
  hub.plantReaction({ fid: OWN, kind: "like", target: { fid: R, hash: p0 }, ts: at(4) });
  hub.plantReaction({ fid: OWN, kind: "recast", target: { fid: R, hash: p0 }, ts: at(4) });
  hub.plantReaction({ fid: OTHER, kind: "like", target: { fid: R, hash: p0 }, ts: at(3) });
  hub.plantCast({ fid: OWN, ts: at(2), text: "persona reply", parent: { fid: R, hash: p0 }, seed: "n8:reply" });
  hub.plantCast({ fid: OWN, ts: at(1), text: "persona mention ", mentions: [R], mentionsPositions: [16], seed: "n8:mention" });
  // OTHER mentions the root AND the persona: shown (OTHER's post), the persona's name from the vault, never read
  const both = hub.plantCast({ fid: OTHER, ts: at(1), text: " and ", mentions: [R, OWN], mentionsPositions: [0, 5], seed: "n8:both" });
  useRoot(R);
  const v = await settle();
  assert(v.items.length === 2 && v.items.some((i) => i.kind === "like" && i.count === 1 && i.actors[0].fid === OTHER) && v.items.some((i) => i.kind === "mention" && i.cast.hash === both), "the root's screen: " + JSON.stringify(v.items.map((i) => [i.kind, i.count, i.actors.map((a) => a.fid)])));
  assert(!v.items.some((i) => i.actors.some((a) => a.fid === OWN) || (i.cast && i.cast.author.fid === OWN)), "the persona's actions shown on the root's screen");
  const bc = v.items.find((i) => i.kind === "mention").cast;
  assert(bc.text === "@root670 and @mine", "the persona named from the vault: " + bc.text);
  const named = reads().filter((r) => r.fid === OWN);
  assert(named.length === 0, named.length + " read(s) named the persona: " + named.map((r) => r.path));
  assert(reads().length >= 6, "vacuous: only " + reads().length + " reads");
  // a persona acting: every op refuses, nothing leaves the tab
  acting = true;
  const before = reads().length;
  for (const [name, p] of [["notifications", notif.hubNotifications({ refresh: "manual" })], ["unread", notif.hubUnread({ refresh: "auto" })], ["seen", notif.hubNotificationsSeen({ upTo: at(1) })]]) {
    const e = await errOf(p);
    assert(e && e.code === "acting_persona" && e.status === 409, name + " while a persona acts: " + (e ? e.code : "it answered"));
  }
  assert(reads().length === before, reads().length - before + " read(s) left while a persona acted");
  // reads queued BEFORE the switch never leave after it
  acting = false;
  read.resetHubReads();
  const R2 = 677;
  plantRoot(R2, 25);
  useRoot(R2);
  hub.hubRead.delayMs = 150;
  await notif.hubNotifications({ waitMs: 200 });
  acting = true;
  await new Promise((r) => setTimeout(r, 60));
  const atSwitch = reads().length;
  await new Promise((r) => setTimeout(r, 1500));
  hub.hubRead.delayMs = 0;
  assert(atSwitch > 0 && reads().length === atSwitch, reads().length - atSwitch + " queued read(s) left after the switch (of " + atSwitch + " before)");
  acting = false;
  // the seen write asks again right before it writes: a persona chosen after the op was admitted stops it, nothing sealed
  fresh();
  useRoot(R);
  let calls = 0;
  read.__setHubReadRuntimeForTests({ device: true, env: ENV, fetch: tabFetch, now: () => Date.now(), account: async () => acct, own: async () => ownSet, acting: async () => ++calls > 1 });
  const sealed0 = persistStub.knobs.flushes.filter((f) => f.ns === "fcNotifications").length;
  const late = await errOf(notif.hubNotificationsSeen({ upTo: at(1) }));
  assert(late && late.code === "acting_persona" && calls >= 2 && persistStub.knobs.flushes.filter((f) => f.ns === "fcNotifications").length === sealed0, "a persona chosen before the seen write: " + (late ? late.code : "it was written") + " (acting asked " + calls + " times)");
  // the guard covers target_fid=: with the root itself in the own set, no read naming it leaves, by fid= or target_fid=
  fresh();
  useRoot(R);
  ownSet = { fids: new Set([R]), names: new Map([[R, "root"]]) };
  await settle();
  assert(reads().length === 0, reads().length + " read(s) naming an own fid left: " + [...new Set(reads().map((r) => r.path))]);
  return "0 reads named the persona; its 6 actions left out; 3 ops refused while acting; 0 queued reads after the switch; target_fid guarded";
});

await check("N9", "429: the node's Retry-After pauses the reads, said on the page, nothing marked failed", async () => {
  fresh();
  const R = 680;
  const [p0] = plantRoot(R, 1);
  person(681, "eve");
  hub.plantReaction({ fid: 681, kind: "like", target: { fid: R, hash: p0 }, ts: at(2) });
  useRoot(R);
  hub.hubRead.rate = { n: 2, retryAfter: 1 };
  const first = await notif.hubNotifications({ waitMs: 300 });
  assert(first.paused && /slow down/.test(first.paused.sentence), "the pause is not said: " + JSON.stringify(first.paused));
  const v = await settle();
  assert(v.state === "ready" && !v.partial && v.items.length === 1, "after the pause: " + JSON.stringify({ s: v.state, p: v.partial, n: v.items.length }));
  return "paused, said, then read";
});

await check("N10", "the badge op: the same count as the page, with no profile read", async () => {
  fresh();
  const R = 690;
  const [p0, p1] = plantRoot(R, 2);
  for (let i = 0; i < 4; i++) hub.plantFollow({ fid: 6910 + i, target: R, ts: at(5 + i) });
  hub.plantReaction({ fid: 6910, kind: "recast", target: { fid: R, hash: p1 }, ts: at(3) });
  hub.plantCast({ fid: 6911, ts: at(1), text: "a reply", parent: { fid: R, hash: p0 }, seed: "n10:r" });
  useRoot(R);
  let u = null;
  for (let i = 0; i < 20 && (!u || u.state !== "ok"); i++) u = await notif.hubUnread({ waitMs: 2000 });
  assert(u.state === "ok" && u.unread === 3 && u.newestAt === at(1), "the badge: " + JSON.stringify(u));
  assert(reads("/v1/userDataByFid").length === 0 && reads("/v1/castById").length === 0, "the badge read profiles or casts: " + reads("/v1/userDataByFid").length);
  const v = await settle();
  assert(v.unread === u.unread, "page " + v.unread + " vs badge " + u.unread);
  return "3 unread, 0 profile reads";
});

await check("N11", "identity: another root never sees the previous root's notifications; resetHubReads drops them", async () => {
  fresh();
  const A = 700, B = 710;
  const [pa] = plantRoot(A, 1);
  plantRoot(B, 1);
  hub.plantReaction({ fid: 701, kind: "like", target: { fid: A, hash: pa }, ts: at(2) });
  useRoot(A);
  const a = await settle();
  assert(a.items.length === 1, "root A: " + a.items.length);
  useRoot(B);
  const b = await settle();
  assert(b.account.fid === B && b.items.length === 0 && b.empty, "root B saw root A's notifications: " + b.items.length);
  read.resetHubReads();
  useRoot(null);
  const n = await notif.hubNotifications();
  assert(n.state === "not_signed_in" && n.items.length === 0, "after a reset with no root: " + n.state);
  const nu = await notif.hubUnread();
  assert(nu.state === "not_signed_in" && nu.unread === null, "the badge with no root: " + JSON.stringify(nu));
});

await check("N12", "shapes: a record of another kind, another post or another target in an answer is dropped", async () => {
  fresh();
  const R = 720;
  const [p0, p1] = plantRoot(R, 2);
  person(721, "fay");
  hub.plantReaction({ fid: 721, kind: "like", target: { fid: R, hash: p0 }, ts: at(2) });
  useRoot(R);
  const msg = (data, hash) => ({ data, hash: hash ?? "0x" + "77".repeat(20) });
  rewrite = async (u, res) => {
    const p = new URL(u).pathname;
    if (!["/v1/reactionsByCast", "/v1/linksByTargetFid", "/v1/castsByMention", "/v1/castsByParent"].includes(p)) return null;
    const j = await res.clone().json();
    const ts = Math.floor((at(1) - 1_609_459_200_000) / 1000);
    if (p === "/v1/reactionsByCast" && u.includes(p0) && u.includes("reaction_type=Like")) {
      j.messages.push(msg({ type: "MESSAGE_TYPE_REACTION_ADD", fid: 722, timestamp: ts, reactionBody: { type: "REACTION_TYPE_LIKE", targetCastId: { fid: R, hash: p1 } } })); // another post
      j.messages.push(msg({ type: "MESSAGE_TYPE_REACTION_ADD", fid: 723, timestamp: ts, reactionBody: { type: "REACTION_TYPE_RECAST", targetCastId: { fid: R, hash: p0 } } })); // another kind
      j.messages.push(msg({ type: "MESSAGE_TYPE_REACTION_REMOVE", fid: 724, timestamp: ts, reactionBody: { type: "REACTION_TYPE_LIKE", targetCastId: { fid: R, hash: p0 } } })); // a removal
    }
    if (p === "/v1/linksByTargetFid") j.messages.push(msg({ type: "MESSAGE_TYPE_LINK_ADD", fid: 725, timestamp: ts, linkBody: { type: "follow", targetFid: 999 } })); // another target
    if (p === "/v1/castsByMention") j.messages.push(msg({ type: "MESSAGE_TYPE_CAST_ADD", fid: 726, timestamp: ts, castAddBody: { text: "no mention here", mentions: [], mentionsPositions: [], embeds: [] } }, "0x" + "66".repeat(20)));
    if (p === "/v1/castsByParent" && u.includes(p1)) j.messages.push(msg({ type: "MESSAGE_TYPE_CAST_ADD", fid: 727, timestamp: ts, castAddBody: { text: "a reply to another post", parentCastId: { fid: R, hash: p0 }, mentions: [], mentionsPositions: [], embeds: [] } }, "0x" + "55".repeat(20)));
    return new Response(JSON.stringify(j), { status: 200, headers: { "content-type": "application/json" } });
  };
  const v = await settle();
  rewrite = null;
  const fids = v.items.flatMap((i) => [...i.actors.map((a) => a.fid), ...(i.cast ? [i.cast.author.fid] : [])]);
  assert(v.items.length === 1 && v.items[0].kind === "like" && v.items[0].count === 1 && fids.every((f) => f === 721), "a doctored record was kept: " + JSON.stringify(v.items.map((i) => [i.kind, i.count])) + " " + fids);
  return "5 doctored records dropped";
});

if (!MUTATIONS.length && ONLY.length === 0) {
  const F = "lib/fc/hubRead/notifications.ts";
  const R = "lib/fc/hubRead/read.ts";
  const SEEN = "lib/fc/hubRead/seen.ts";
  const runs = [
    ["the guard does not cover target_fid=", "N8", [{ file: R, find: "  for (const m of path.matchAll(/[?&](?:target_)?fid=(\\d+)/g)) if (isOwn(Number(m[1]))) throw new HubFail(\"own\");", replace: "  for (const m of path.matchAll(/[?&]fid=(\\d+)/g)) if (isOwn(Number(m[1]))) throw new HubFail(\"own\");" }]],
    ["the ops answer while a persona acts", "N8", [{ file: F, find: "  const rt = C.gate();\n  await C.admit(rt);\n  const acct = await C.signedIn(rt);", replace: "  const rt = C.gate();\n  const acct = await C.signedIn(rt);" }]],
    ["the seen write not asked again right before it writes", "N8", [{ file: SEEN, find: "      await guard();\n", replace: "" }]],
    ["an own persona's actions shown on the root's screen", "N8", [{ file: F, find: "    if (C.isOwn(fid)) {\n      ownLeftOut++;\n      return true;\n    }", replace: "" }]],
    ["a failed read swallowed into an empty list", "N5", [{ file: F, find: "      if (!alive(e)) return;\n      s.state = \"failed\";", replace: "      if (!alive(e)) return;\n      s.items = s.items ?? [];\n      s.state = \"ok\";" }]],
    ["every read failing reported as nothing", "N5", [{ file: F, find: "  const error = settled && !h.anyRead && h.anyFailed;", replace: "  const error = false;" }]],
    ["a failed source not counted", "N5", [{ file: F, find: "    partial: !error && h.failed ? { failed: h.failed, sentence: h.sentence as string } : null,", replace: "    partial: null," }]],
    ["an unreadable seen record read as never seen", "N5", [{ file: F, find: "  } catch {\n    seenError = NOTIF_SEEN_UNREADABLE_SENTENCE;\n  }", replace: "  } catch {\n    seenAt = null;\n  }" }]],
    ["a failed seen write taken as saved", "N5", [{ file: F, find: "    if (e instanceof HubReadError && e.code === \"acting_persona\") throw e;\n    throw new HubReadError(\"seen_unsaved\");", replace: "    if (e instanceof HubReadError && e.code === \"acting_persona\") throw e;\n    return { seenAt: at };" }]],
    ["a future-dated event kept", "N4", [{ file: F, find: "    if (ts > limit) {\n      future++;\n      return true;\n    }", replace: "" }]],
    ["seen moves back", "N4", [{ file: SEEN, find: "      if (prev !== null && prev >= at) return prev;", replace: "" }]],
    ["seen not clamped to now", "N4", [{ file: F, find: "  const at = Math.min(upTo, rt.now() + P.futureSkewMs);", replace: "  const at = upTo;" }]],
    ["another account's seen record used", "N4", [{ file: SEEN, find: "  return doc.fid === fid ? doc.seenAt : null;", replace: "  return doc.seenAt;" }]],
    ["the seen record unpadded", "N4", [{ file: SEEN, find: "  return encryptNamespace(NOTIF_SEEN_NS, { _: { m: JSON.parse(inner), pad: \" \".repeat(pad) } });", replace: "  return encryptNamespace(NOTIF_SEEN_NS, { _: { m: JSON.parse(inner) } });" }]],
    ["new events not split from seen ones", "N4", [{ file: F, find: "      for (const ev of list) evs.push({ id: kind + \":\" + ps.rec.hash + \":\" + (fresh(ev.ts) ? \"new\" : \"old\"),", replace: "      for (const ev of list) evs.push({ id: kind + \":\" + ps.rec.hash + \":\" + \"old\"," }]],
    ["the shards' page not cut to the newest", "N3", [{ file: F, find: "  return [...best.values()].sort(evNewest).slice(0, limit);", replace: "  return [...best.values()].sort(evNewest);" }]],
    ["a full page not said as 'at least'", "N3", [{ file: F, find: "      const oldest = s.capped && list.length ? list[list.length - 1] : null;", replace: "      const oldest = null;" }]],
    ["mentions not merged with replies (a reply that mentions the root shown twice)", "N2", [{ file: F, find: "  for (const r of e.mentions.items ?? []) if (!leave(r.fid, r.ts)) talk.set(r.hash, r);", replace: "  for (const r of e.mentions.items ?? []) if (!leave(r.fid, r.ts)) evs.push({ id: \"mention:\" + r.hash, kind: \"mention\", ts: r.ts, fid: r.fid, rec: r });" }]],
    ["the root's own actions shown", "N2", [{ file: F, find: "    if (fid === root) return true; // the root's own reply to itself, its self-like, a self-follow", replace: "" }]],
    ["oldest first", "N2", [{ file: F, find: "  evs.sort((a, b) => b.ts - a.ts || a.fid - b.fid);", replace: "  evs.sort((a, b) => a.ts - b.ts || a.fid - b.fid);" }, { file: F, find: "  const list = [...groups.values()].sort((a, b) => b.at - a.at ||", replace: "  const list = [...groups.values()].sort((a, b) => a.at - b.at ||" }]],
    ["every post re-read on every ask", "N7", [{ file: F, find: "      if (kind !== null && t - ps.checkedAt >= wait) readPost(e, rt, lane, ps, \"all\");", replace: "      if (kind !== null) readPost(e, rt, lane, ps, \"all\");" }]],
    ["a post that fell out of the window read again", "N7", [{ file: F, find: "    void run(e, rt, e.own, () => loadOwn(rt, lane, e.fid), () => reconcilePosts(e, rt, lane)).then(posts);\n  } else posts();", replace: "    posts();\n    void run(e, rt, e.own, () => loadOwn(rt, lane, e.fid), () => reconcilePosts(e, rt, lane));\n  } else posts();" }]],
    ["a reaction on another post kept", "N12", [{ file: F, find: "!t || t.fid !== root || t.hash !== hash ||", replace: "!t ||" }]],
    ["a link to another account kept", "N12", [{ file: F, find: 'lb.type !== "follow" || lb.targetFid !== root ||', replace: 'lb.type !== "follow" ||' }]],
    ["a cast not mentioning the root kept as a mention", "N12", [{ file: F, find: "  return { items: newestRecs(raw.filter((m) => mentionsRoot(m, root)).map(C.recOf), P.mentions),", replace: "  return { items: newestRecs(raw.map(C.recOf), P.mentions)," }]],
    ["a 429 does not pause the reads", "N9", [{ file: R, find: "        n.pausedUntil = Math.max(n.pausedUntil, Date.now() + retryAfterMs(res.headers.get(\"retry-after\"), Date.now()));", replace: "" }]],
    ["another root keeps the previous root's notifications", "N11", [{ file: F, find: "  if (cur && cur.fid === acct.fid) {\n    cur.fname = acct.fname;", replace: "  if (cur) {\n    cur.fname = acct.fname;" }]],
    ["the route reads the body on a server", "N1", [{ file: "app/api/fc/hub/route.ts", find: "  // FIRST, before the body is read: no server reads a visitor's graph\n  if (typeof window === \"undefined\") return deviceOnly();", replace: "  await req.json().catch(() => null);\n  if (typeof window === \"undefined\") return deviceOnly();" }]],
    ["a never-ending castsByParent token followed", "N3", [{ file: F, find: "  const raw = messages(await C.hubGet(rt, `/v1/castsByParent?fid=${root}&hash=${hash}&pageSize=${P.repliesPage}&reverse=true`, lane));", replace: "  let raw: unknown[] = [];\n  let tok = \"\";\n  for (let i = 0; i < 3; i++) {\n    const a = await C.hubGet(rt, `/v1/castsByParent?fid=${root}&hash=${hash}&pageSize=${P.repliesPage}&reverse=true` + (tok ? \"&pageToken=\" + encodeURIComponent(tok) : \"\"), lane);\n    raw = raw.concat(messages(a));\n    tok = a.kind === \"ok\" && typeof a.json.nextPageToken === \"string\" ? a.json.nextPageToken : \"\";\n    if (!tok) break;\n  }" }]],
  ];
  await check("M", "MUTATIONS: each guard removed in the bundle only — the check that covers it FAILS (" + runs.length + " mutations)", async () => {
    const survived = [];
    for (const [label, target, muts] of runs) {
      const r = spawnSync(process.execPath, [SELF, "--only=" + target], {
        cwd: ROOT,
        env: { ...process.env, HUBNOTIF_MUTATION: JSON.stringify(muts), HUBNOTIF_UNIT_QUIET: "1", KEYSTORE_DIR: "" },
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
const summary = `${passed}/${passed + failed} hub-notifications unit checks passed` + (failed ? ` — FAILED: ${failedIds.join(",")}` : "");
console.log((QUIET ? "" : "\n") + summary);
process.exit(failed ? 1 : 0);
