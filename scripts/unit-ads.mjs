// ADS, PHASE 1 — placements, the per-mode ad dial, house ads, "Why this ad", hide controls, creative review and contextual
// matching ON THE DEVICE (docs/roadmap/ad-auction.md; SECURITY-POSTURE.md §41), IN ONE PROCESS, with nothing real:
// lib/ads/*, lib/injection.ts, app/api/ads/route.ts and app/api/modes/route.ts bundled with esbuild, the mode store, the
// acting identity and the persona kinds stood in for, the vault's sealing REAL over an in-memory validator.
//
//   A1  PLACEMENTS: Following's ads at rows 5, 20, 35, 50 (50 posts), For You's at 3, 18, 33, 48; never the last row
//       (4 posts: none; 5 posts: one, with a post after it); the slot count agrees with the queue; any other placement
//       (a thread) is refused; no server answers the route (404 device_only, the body never read)
//   A2  THE ONE QUEUE: an ad is an "ad" item of lib/injection.ts: a promoted card that duplicates a post on the page is
//       dropped; one house lot fills every slot; the every-N interleave of the other types is unchanged
//   A3  THE DIAL PER MODE: No ads places none ("No ads in this mode."); Generic only places the generic house lot;
//       Matched puts the lot that fits the mode first; defaults: generic for a public identity, none for a private
//       persona or an identity this device cannot place
//   A4  EVENT SAFE SPACE: allowAds false is none whatever is stored, said as "Event Safe Space never shows ads."; the mode
//       route refuses to set it, refuses a word that is not a setting, and saves a good one (null = back to default)
//   A5  CREATIVE REVIEW: only an approval under the current policy by a pinned key over the lot's exact words lists a
//       lot; unreviewed, rejected, edited after approval, another policy, an unpinned or small-order key, a malformed lot
//       and a link that is not https are never shown; the SHIPPED list (public/ads/lots.json) verifies in full
//   A6  CONTEXTUAL MATCHING: a "Sports" lot fits "Sunday Sports" (any case, whole words), not "Sport" or "Work", and
//       only under Matched; "Why this ad" says "Shown because you're in Sunday Sports mode." or that nothing about you
//       picked it; the plan's inputs carry nothing but the mode's name
//   A7  HIDE, SEALED: hiding writes ONE sealed record of exactly 4,096 bytes with no id in the clear; after a reload of
//       the record it still applies; "hide this advertiser" hides all its lots; Undo shows it again; a full record
//       refuses with a sentence; an unreadable record is NO ads, said (never the hidden ones)
//   A8  IDENTITY: the root's hides never apply to a persona or back; a page shaped under another identity's mode gets
//       nothing (409); a hide carrying another identity's tag, or one whose identity switches before the write, writes
//       nothing; the mode route refuses to set another identity's dial
//   A9  NO REQUESTS: planning, hiding and showing again make zero network requests beyond the sealed record's own
//       read and write (the lot list is in the bundle)
//   A10 UNIFORM PRESENCE: the empty record is sealed once at boot, the same size as a full one
//   A11 DORMANT: with the app's ADS unset, off or misspelt no feed carries an ad whatever the dial, said as "Ads aren't
//       running on Totem yet."; only ADS=on runs them; the device is told ADS=on only then and reads nothing else as
//       on; Settings is told; the device env builder spreads the hint (A1 to A10 run with ADS=on)
//   M   MUTATIONS: each guard removed in the BUNDLE ONLY, and the check that covers it must then FAIL
//
//   node scripts/unit-ads.mjs            (npm run test:ads-unit)
//   node scripts/unit-ads.mjs --only=A3
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SELF = fileURLToPath(import.meta.url);
const require = createRequire(path.join(ROOT, "package.json"));
const { build } = require("esbuild");
const { ed25519 } = require("@noble/curves/ed25519");
const ONLY = (process.argv.find((a) => a.startsWith("--only=")) || "").slice("--only=".length).split(",").filter(Boolean);
const want = (id) => ONLY.length === 0 || ONLY.includes(id);
const MUTATIONS = process.env.ADS_MUTATION ? JSON.parse(process.env.ADS_MUTATION) : [];
const QUIET = process.env.ADS_UNIT_QUIET === "1";

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
const tmp = mkdtempSync(path.join(os.tmpdir(), "layers-ads-unit-"));
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
export const knobs: { failFetch: Record<string, number>; conflictOnce: Record<string, boolean>; flushes: Array<{ ns: string; bytes: number }>; fetches: string[] } = { failFetch: {}, conflictOnce: {}, flushes: [], fetches: [] };
export async function fetchState(ns: string): Promise<{ status: number; ok: boolean; json: () => Promise<any> }> {
  knobs.fetches.push(ns);
  const f = knobs.failFetch[ns];
  if (f) return { status: f, ok: false, json: async () => ({}) };
  const entries = validatorStore.get(ns);
  if (!entries) return { status: 200, ok: true, json: async () => ({ entries: {} }) };
  return { status: 200, ok: true, json: async () => ({ entries: JSON.parse(JSON.stringify(entries)) }) };
}
export async function flushVault(ns: string, entries: Record<string, unknown>): Promise<void> {
  if (knobs.conflictOnce[ns]) { knobs.conflictOnce[ns] = false; throw new Error("validator answered HTTP 409 (a newer write)"); }
  knobs.flushes.push({ ns, bytes: JSON.stringify(entries).length });
  validatorStore.set(ns, JSON.parse(JSON.stringify(entries)));
}
export async function flush(ns: string, entries: Record<string, unknown>): Promise<void> { return flushVault(ns, entries); }
export async function signedWriteHeaders(): Promise<Record<string, string>> { return {}; }
export function sealedNamespaces(): Set<string> { return new Set(); }
export function resetEnvelopeBootstrap(): void {}
`,
  // the acting identity (the key every mode route uses), the mode store and the persona kinds: stood in for
  "active-persona.ts": `export const personaCtl = { id: "pub_self_unit" };
export function activeSeedPersonaId(): string { return personaCtl.id; }
`,
  "registry.ts": `export const modeCtl = { modes: new Map<string, any>(), failGet: false, updates: [] as Array<{ id: string; patch: any }> };
export const adapters = {
  mode: {
    async get(id: string) { if (modeCtl.failGet) throw new Error("mode store unreadable"); return modeCtl.modes.get(id) ?? null; },
    async update(id: string, patch: any) { modeCtl.updates.push({ id, patch }); const m = { ...modeCtl.modes.get(id), ...patch }; modeCtl.modes.set(id, m); return m; },
    async list(personaId: string) { return [...modeCtl.modes.values()].filter((m) => m.personaId === personaId); },
    async getActive(personaId: string) { return [...modeCtl.modes.values()].find((m) => m.personaId === personaId); },
  },
};
`,
  "persona-kind.ts": `export const kindCtl = { kinds: new Map<string, "public" | "private">() };
export function kindOf(id: string | null | undefined): "public" | "private" | "unknown" { return (id && kindCtl.kinds.get(id)) || "unknown"; }
`,
  "entry.ts": `export * as lots from "@/lib/ads/lots";
export * as match from "@/lib/ads/match";
export * as dial from "@/lib/ads/dial";
export * as plan from "@/lib/ads/plan";
export * as hides from "@/lib/ads/hides";
export * as policy from "@/lib/ads/policy";
export * as adsSwitch from "@/lib/ads/switch";
export * as canonical from "@/lib/ads/canonical.mjs";
export * as injection from "@/lib/injection";
export * as route from "@/app/api/ads/route";
export * as modesRoute from "@/app/api/modes/route";
export * as vault from "@/lib/vault/vault";
export * as pins from "@/lib/vault/sealedPins";
export * as persistStub from "@/lib/adapters/mock/persist";
export * as personaStub from "@/lib/activePersona";
export * as registryStub from "@/lib/adapters/registry";
export * as kindStub from "@/lib/identity/personaKind";
export * as nextStub from "next/server";
`,
};
for (const [n, src] of Object.entries(stubs)) writeFileSync(S(n), src);
const applied = new Set();
const mutatePlugin = {
  name: "mutate",
  setup(b) {
    if (!MUTATIONS.length) return;
    b.onLoad({ filter: /\.(ts|tsx|mjs)$/ }, (args) => {
      const rel = args.path.split(path.sep).join("/");
      const mine = MUTATIONS.filter((m) => rel.endsWith(m.file));
      if (!mine.length) return undefined;
      let src = readFileSync(args.path, "utf8").replace(/\r\n/g, "\n");
      for (const m of mine) {
        if (!src.includes(m.find)) throw new Error("MUTATION ANCHOR NOT FOUND in " + m.file + ": " + m.find.slice(0, 80));
        src = src.replace(m.find, m.replace);
        applied.add(m);
      }
      return { contents: src, loader: args.path.endsWith(".mjs") ? "js" : "ts", resolveDir: path.dirname(args.path) };
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
      "@/lib/activePersona": S("active-persona.ts"),
      "@/lib/adapters/registry": S("registry.ts"),
      "@/lib/identity/personaKind": S("persona-kind.ts"),
    },
  });
  M = await import(pathToFileURL(outFile).href);
  if (MUTATIONS.length && applied.size !== MUTATIONS.length) throw new Error("MUTATION FILE NOT IN THE BUNDLE");
} catch (e) {
  console.log("cannot bundle the ads modules: " + (e && e.message ? e.message.split("\n").slice(0, 3).join(" | ") : String(e)));
  rmSync(tmp, { recursive: true, force: true });
  process.exit(2);
}
const { lots, match, dial, plan, hides, policy, adsSwitch, canonical, injection, route, modesRoute, vault, pins, persistStub, personaStub, registryStub, kindStub, nextStub } = M;
// A1 to A10 measure Phase 1 SWITCHED ON (the app's ADS=on); A11 measures it dormant
process.env.ADS = "on";
const { modeCtl } = registryStub;
const { kindCtl } = kindStub;
const { personaCtl } = personaStub;
const knobs = persistStub.knobs;

// ---------------------------------------------------------------------------------------------------- fixtures
// a test reviewer, signing exactly as scripts/ads-approve.mjs does (the canonical line is the bundle's own module)
const SEED = Uint8Array.from(randomBytes(32));
const PUB = Buffer.from(ed25519.getPublicKey(SEED)).toString("hex");
const OTHER_SEED = Uint8Array.from(randomBytes(32));
const OTHER_PUB = Buffer.from(ed25519.getPublicKey(OTHER_SEED)).toString("hex");
const POLICY = policy.AD_POLICY_ID;
const sha = (s) => createHash("sha256").update(Buffer.from(s, "utf8")).digest("hex");
function signed(lot, { decision = "approved", pol = POLICY, seed = SEED, pub = PUB, at = "2026-11-07" } = {}) {
  const { review: _r, ...terms } = lot;
  const line = canonical.reviewCanonical(pol, lot.id, sha(canonical.lotTermsString(terms)), decision, at);
  return { ...terms, review: { decision, policy: pol, reviewer: pub, reviewedAt: at, sig: Buffer.from(ed25519.sign(new TextEncoder().encode(line), seed)).toString("hex") } };
}
const lotOf = (id, over = {}) => ({
  id,
  placement: "following",
  audience: { kind: "generic" },
  house: true,
  advertiser: { id: "house", name: "Totem", handle: "ontotem" },
  creative: { headline: "Headline " + id, body: "Body of " + id, url: "https://example.org/" + id, cta: "Go" },
  ...over,
});
const listOf = (items) => ({ v: 1, version: 7, policy: POLICY, lots: items });
const useLots = (items, keys = [PUB]) => lots.__setAdLotSourceForTests({ list: listOf(items), keys });
const ROOT_ID = "pub_self_unit";
const PERSONA_ID = "p_unit_persona";
const modeOf = (id, personaId, over = {}) => ({ id, personaId, name: "Default", isPreset: true, ranking: {}, ruleIds: [], notificationPolicy: "all", actionButtonSlots: { composer: [], nav: [] }, showTrending: true, calmRanking: false, createdAt: 0, ...over });
function freshWorld() {
  modeCtl.modes.clear();
  modeCtl.updates.length = 0;
  modeCtl.failGet = false;
  kindCtl.kinds.clear();
  kindCtl.kinds.set(ROOT_ID, "public");
  kindCtl.kinds.set(PERSONA_ID, "public");
  personaCtl.id = ROOT_ID;
  persistStub.validatorStore.clear();
  knobs.failFetch = {};
  knobs.conflictOnce = {};
  knobs.flushes.length = 0;
  knobs.fetches.length = 0;
  hides.resetAdHidesCache();
  pins.resetSealedPins();
  modeCtl.modes.set("m_root_default", modeOf("m_root_default", ROOT_ID));
  modeCtl.modes.set("m_root_sports", modeOf("m_root_sports", ROOT_ID, { name: "Sunday Sports", isPreset: false, adDial: "matched" }));
  modeCtl.modes.set("m_root_work", modeOf("m_root_work", ROOT_ID, { name: "Work", adDial: "matched" }));
  modeCtl.modes.set("m_root_safe", modeOf("m_root_safe", ROOT_ID, { name: "Event Safe Space", allowAds: false }));
  modeCtl.modes.set("m_persona_default", modeOf("m_persona_default", PERSONA_ID));
}
const posts = (n, tag = "h") => Array.from({ length: n }, (_, i) => "0x" + tag + String(i).padStart(4, "0"));
const doPlan = (modeId, n = 50, placement = "following") => plan.adPlan({ placement, modeId, posts: posts(n) });
const adPositions = (p) => p.rows.map((r, i) => (r.kind === "ad" ? i + 1 : 0)).filter(Boolean);
const errOf = async (p) => {
  try {
    await p;
    return null;
  } catch (e) {
    return e;
  }
};
const sports = () => lotOf("sports-lot", { advertiser: { id: "acme-sports", name: "Acme Sports", handle: "acme" }, audience: { kind: "mode", modes: ["Sports"] }, house: false });
const STANDARD = () => [signed(lotOf("house-a")), signed(sports())];

// every request the harness sees: the bundle's own fetch must never be called by the planner
const realFetch = globalThis.fetch;
const netCalls = [];
globalThis.fetch = async (u, init) => {
  netCalls.push(String(u));
  return realFetch(u, init);
};

out("\nADS UNIT — Phase 1 on the device: placements, the dial, review, matching, hides" + (MUTATIONS.length ? "  [MUTATED BUNDLE]" : ""));

await check("A1", "placements: Following at 5, 20, 35, 50; For You at 3, 18, 33, 48; never last; the slot count agrees; a thread is refused; no server answers", async () => {
  freshWorld();
  useLots([signed(lotOf("house-a")), signed(lotOf("house-fy", { placement: "forYou" }))]);
  const f = await doPlan("m_root_default", 50);
  assert(f.state === "ok", "the plan: " + f.state + " " + f.reason);
  assert(adPositions(f).join() === "5,20,35,50", "Following's ad rows: " + adPositions(f).join());
  assert(f.rows.length === 54 && f.rows[f.rows.length - 1].kind === "post" && f.ads === 4, "rows " + f.rows.length + ", ads " + f.ads);
  assert(f.rows.filter((r) => r.kind === "post").map((r) => r.hash).join() === posts(50).join(), "the posts moved or went missing");
  assert(f.rows.filter((r) => r.kind === "ad").every((r, k) => r.ad.slot === k && r.ad.position === [5, 20, 35, 50][k]), "slot / position fields");
  const y = await doPlan("m_root_default", 50, "forYou");
  assert(adPositions(y).join() === "3,18,33,48", "For You's ad rows: " + adPositions(y).join());
  const four = await doPlan("m_root_default", 4);
  assert(adPositions(four).length === 0, "an ad on a 4-post page (it would be last): " + adPositions(four).join());
  const five = await doPlan("m_root_default", 5);
  assert(adPositions(five).join() === "5" && five.rows.length === 6 && five.rows[5].kind === "post", "5 posts: " + adPositions(five).join());
  for (const n of [0, 1, 4, 5, 18, 19, 20, 33, 34, 50, 64, 65, 200]) {
    const p = await doPlan("m_root_default", n);
    assert(adPositions(p).length === match.adSlotCount(match.AD_PLACEMENTS.following, n), n + " posts: " + adPositions(p).length + " ads vs a count of " + match.adSlotCount(match.AD_PLACEMENTS.following, n));
    assert(p.rows.length === 0 || p.rows[p.rows.length - 1].kind === "post", n + " posts: an ad is the last row");
  }
  for (const bad of ["thread", "profile", "", "notifications"]) {
    const e = await errOf(plan.adPlan({ placement: bad, modeId: "m_root_default", posts: posts(50) }));
    assert(e && e.code === "bad_placement" && e.status === 400, bad + ": " + (e ? e.code : "answered"));
  }
  const req = new nextStub.NextRequest("http://x/api/ads", { method: "POST", body: JSON.stringify({ op: "plan", placement: "following", modeId: "m_root_default", posts: posts(5) }) });
  const r = await route.POST(req);
  assert(r.status === 404 && r.body.code === "device_only" && req.readCount === 0, "a server answered or read the body: " + r.status + " read " + req.readCount);
  const gr = await route.GET();
  assert(gr.status === 404 && gr.body.code === "device_only", "GET on a server: " + gr.status);
  // as the device (a window): the route answers the plan
  globalThis.window = {};
  try {
    const dr = await route.POST(new nextStub.NextRequest("http://x/api/ads", { method: "POST", body: JSON.stringify({ op: "plan", placement: "following", modeId: "m_root_default", posts: posts(20) }) }));
    assert(dr.status === 200 && adPositions(dr.body).join() === "5,20", "the device route: " + dr.status + " " + JSON.stringify(dr.body).slice(0, 120));
    const tr = await route.POST(new nextStub.NextRequest("http://x/api/ads", { method: "POST", body: JSON.stringify({ op: "plan", placement: "thread", modeId: "m_root_default", posts: posts(20) }) }));
    assert(tr.status === 400 && tr.body.code === "bad_placement", "a thread through the route: " + tr.status);
  } finally {
    delete globalThis.window;
  }
  return "5,20,35,50 / 3,18,33,48; never last over 13 page sizes; 4 placements refused; device-only";
});

await check("A2", "the one queue: a promoted duplicate of a post is dropped; one house lot fills every slot; the every-N interleave of other types is unchanged", async () => {
  const card = (hash, kind = "post") => ({ kind, cast: { hash } });
  const P = posts(40).map((h) => card(h));
  const dup = { type: "ad", card: card("ad-dup", "ad"), sourceHash: P[7].cast.hash };
  const ok1 = { type: "ad", card: card("ad-1", "ad"), sourceHash: "ad:house-a" };
  const ok2 = { type: "ad", card: card("ad-2", "ad"), sourceHash: "ad:house-a" };
  const r = injection.injectIntoFeed(P, [dup, ok1, ok2], { caps: { ad: 3 }, slots: { ad: { first: 5, every: 15 } } });
  const at = r.cards.map((c, i) => (c.kind === "ad" ? i + 1 + ":" + c.cast.hash : "")).filter(Boolean);
  assert(at.join() === "5:ad-1,20:ad-2", "the ads landed at " + at.join());
  assert(r.dropped.some((d) => d.reason === "duplicate" && d.sourceHash === P[7].cast.hash), "the promoted duplicate was not dropped: " + JSON.stringify(r.dropped));
  // a slotted card past the page's end is dropped as "slot", never appended
  const short = injection.injectIntoFeed(P.slice(0, 6), [ok1, ok2], { caps: { ad: 3 }, slots: { ad: { first: 5, every: 15 } } });
  assert(short.cards.filter((c) => c.kind === "ad").length === 1 && short.dropped.some((d) => d.reason === "slot") && short.cards[short.cards.length - 1].kind === "post", "6 posts: " + JSON.stringify(short.dropped));
  // the queue itself never makes an ad the last row, whatever its caller asks (4 posts, a slot at 5)
  const four = injection.injectIntoFeed(P.slice(0, 4), [ok1], { caps: { ad: 3 }, slots: { ad: { first: 5, every: 15 } } });
  assert(four.cards.length === 4 && four.cards.every((c) => c.kind === "post") && four.dropped.some((d) => d.reason === "slot"), "4 posts: " + four.cards.map((c) => c.kind[0]).join(""));
  // the existing interleave: readwise every 4, unchanged by the slots option
  const rw = [0, 1].map((i) => ({ type: "readwise", card: card("rw" + i, "readwise"), sourceHash: "src" }));
  const mixed = injection.injectIntoFeed(P.slice(0, 12), [...rw, ok1], { every: 4, slots: { ad: { first: 5, every: 15 } } });
  const kinds = mixed.cards.map((c) => (c.kind === "post" ? "p" : c.kind === "ad" ? "A" : "r")).join("");
  // the interleave first (pppp r pppp r pppp), then the ad into row 5
  assert(kinds === "ppppArpppprpppp", "the mixed order: " + kinds);
  const plain = injection.injectIntoFeed(P.slice(0, 8), [...rw], { every: 4 });
  assert(plain.cards.map((c) => c.kind[0]).join("") === "pppprppppr", "the interleave without slots: " + plain.cards.map((c) => c.kind[0]).join(""));
  return "ads at 5 and 20 from one lot; a duplicate of a post dropped; past the end dropped as 'slot'; readwise every 4 unchanged";
});

await check("A3", "the dial per mode: No ads places none and says so; Generic only places the generic lot; Matched puts the fitting lot first; defaults by identity kind", async () => {
  freshWorld();
  useLots(STANDARD());
  // an explicit No ads
  modeCtl.modes.set("m_root_default", { ...modeCtl.modes.get("m_root_default"), adDial: "none" });
  const none = await doPlan("m_root_default");
  assert(none.state === "off" && none.ads === 0 && adPositions(none).length === 0 && none.reason === "No ads in this mode." && none.dial === "none", "No ads: " + JSON.stringify({ s: none.state, r: none.reason, d: none.dial }));
  assert(match.pickAds((await lots.listedLots()).listed, { placement: "following", dial: "none", modeName: "Sunday Sports", hiddenLots: new Set(), hiddenAdvertisers: new Set() }).length === 0, "pickAds under none");
  // Generic only: the house lot, never the sports lot (even in a sports mode)
  modeCtl.modes.set("m_root_sports", { ...modeCtl.modes.get("m_root_sports"), adDial: "generic" });
  const gen = await doPlan("m_root_sports");
  const genLots = gen.rows.filter((r) => r.kind === "ad").map((r) => r.ad.lotId);
  assert(gen.state === "ok" && genLots.length === 4 && genLots.every((l) => l === "house-a"), "Generic only: " + genLots.join());
  // Matched: the sports lot first, then the generic one, in turn
  modeCtl.modes.set("m_root_sports", { ...modeCtl.modes.get("m_root_sports"), adDial: "matched" });
  const mat = await doPlan("m_root_sports");
  assert(mat.rows.filter((r) => r.kind === "ad").map((r) => r.ad.lotId).join() === "sports-lot,house-a,sports-lot,house-a", "Matched: " + mat.rows.filter((r) => r.kind === "ad").map((r) => r.ad.lotId).join());
  // defaults: a public identity's mode with no setting is generic; a private persona's is none; an unknown identity's is none
  modeCtl.modes.set("m_root_default", { ...modeCtl.modes.get("m_root_default"), adDial: undefined });
  const def = await doPlan("m_root_default");
  assert(def.dial === "generic" && def.dialIsDefault === true && def.ads === 4, "a public identity's default: " + def.dial + " " + def.ads);
  kindCtl.kinds.set(PERSONA_ID, "private");
  personaCtl.id = PERSONA_ID;
  const priv = await doPlan("m_persona_default");
  assert(priv.dial === "none" && priv.dialIsDefault && priv.ads === 0 && priv.state === "off", "a private persona's default: " + priv.dial + " " + priv.ads);
  kindCtl.kinds.delete(PERSONA_ID);
  const unk = await doPlan("m_persona_default");
  assert(unk.dial === "none" && unk.ads === 0, "an identity this device cannot place: " + unk.dial);
  const e = dial.effectiveAdDial({ adDial: "bogus" }, "public");
  assert(e.dial === "generic" && e.isDefault, "a stored word that is not a setting reads as the default: " + JSON.stringify(e));
  return "none 0 ads (said); generic 4× house; matched sports,house alternating; defaults generic / none / none";
});

await check("A4", "Event Safe Space: forced none whatever is stored, said; the mode route refuses to set it, refuses a bad word, saves a good one and null", async () => {
  freshWorld();
  useLots(STANDARD());
  modeCtl.modes.set("m_root_safe", { ...modeCtl.modes.get("m_root_safe"), adDial: "matched" });
  const s = await doPlan("m_root_safe");
  assert(s.state === "off" && s.ads === 0 && s.forced === true && s.dial === "none" && s.reason === "Event Safe Space never shows ads.", "Event Safe Space: " + JSON.stringify({ s: s.state, a: s.ads, f: s.forced, r: s.reason }));
  const patch = (modeId, adDial) => modesRoute.PATCH(new nextStub.NextRequest("http://x/api/modes", { method: "PATCH", body: JSON.stringify({ modeId, patch: { adDial } }) }));
  const r1 = await patch("m_root_safe", "generic");
  assert(r1.status === 400 && r1.body.code === "ads_forced_off" && !modeCtl.updates.length, "setting Event Safe Space to generic: " + r1.status);
  const r2 = await patch("m_root_default", "lots");
  assert(r2.status === 400 && r2.body.code === "bad_ad_dial" && !modeCtl.updates.length, "a word that is not a setting: " + r2.status);
  const r3 = await patch("m_root_default", "none");
  assert(r3.status === 200 && modeCtl.modes.get("m_root_default").adDial === "none", "a good word: " + r3.status + " " + modeCtl.modes.get("m_root_default").adDial);
  assert((await doPlan("m_root_default")).ads === 0, "the saved dial is not what the plan reads");
  const r4 = await patch("m_root_default", null);
  assert(r4.status === 200 && modeCtl.modes.get("m_root_default").adDial === undefined && (await doPlan("m_root_default")).dial === "generic", "null back to default: " + r4.status);
  const r5 = await patch("m_root_safe", "none");
  assert(r5.status === 200, "setting Event Safe Space to none (what it already is) is fine: " + r5.status);
  // the GET says each mode's dial as it applies
  const g = await modesRoute.GET();
  assert(g.status === 200 && g.body.adDials.m_root_safe.forced === true && g.body.adDials.m_root_default.dial === "generic", "GET /api/modes: " + JSON.stringify(g.body.adDials ?? null).slice(0, 200));
  return "forced off and said; 3 refusals/acceptances on the route; GET reports the dials";
});

await check("A5", "creative review: only an approval under this policy by a pinned key over the exact words lists a lot; everything else is refused; the shipped list verifies", async () => {
  freshWorld();
  const good = signed(lotOf("good"));
  const tampered = { ...signed(lotOf("tampered")), creative: { ...lotOf("tampered").creative, body: "Now with a different promise" } };
  const rejected = signed(lotOf("rejected"), { decision: "rejected" });
  const oldPolicy = signed(lotOf("old-policy"), { pol: "totem-ad-policy/0" });
  const stranger = signed(lotOf("stranger"), { seed: OTHER_SEED, pub: OTHER_PUB });
  const unreviewed = lotOf("unreviewed");
  const http = signed(lotOf("http-link", { creative: { ...lotOf("x").creative, url: "http://example.org/x" } }));
  const creds = signed(lotOf("creds-link", { creative: { ...lotOf("x").creative, url: "https://user:pw@example.org/x" } }));
  const extra = signed({ ...lotOf("extra-field"), tracking: "pixel" });
  const dupe = signed(lotOf("good", { creative: { ...lotOf("good").creative, body: "second of the same id" } }));
  const v = await lots.verifyLotList(listOf([good, tampered, rejected, oldPolicy, stranger, unreviewed, http, creds, extra, dupe]), [PUB]);
  assert(v.listed.map((l) => l.id).join() === "good", "listed: " + v.listed.map((l) => l.id).join());
  const why = Object.fromEntries(v.refused.map((r) => [r.id, r.reason]));
  const wantWhy = { tampered: "bad_signature", rejected: "rejected", "old-policy": "other_policy", stranger: "unknown_reviewer", unreviewed: "unreviewed", "http-link": "unsafe_link", "creds-link": "unsafe_link", "extra-field": "malformed" };
  for (const [id, reason] of Object.entries(wantWhy)) assert(why[id] === reason, id + " refused as " + why[id] + ", not " + reason);
  assert(v.refused.some((r) => r.id === "good" && r.reason === "duplicate"), "the second 'good' was not refused as a duplicate");
  // a small-order key pinned as a reviewer approves nothing (an all-zero key and signature)
  const zero = { ...lotOf("zero"), review: { decision: "approved", policy: POLICY, reviewer: "0".repeat(64), reviewedAt: "2026-11-07", sig: "0".repeat(128) } };
  const vz = await lots.verifyLotList(listOf([zero]), ["0".repeat(64)]);
  assert(vz.listed.length === 0, "a small-order key approved a lot");
  // an unreadable list lists nothing
  for (const bad of [null, { v: 2, version: 1, lots: [good] }, { v: 1, lots: "x" }, { v: 1, version: 1.5, lots: [] }]) {
    const vb = await lots.verifyLotList(bad, [PUB]);
    assert(vb.listed.length === 0 && vb.error, "an unreadable list listed something: " + JSON.stringify(bad).slice(0, 60));
  }
  // through the plan: nothing refused ever reaches a row, and the count is said
  useLots([tampered, rejected, unreviewed, stranger]);
  const p = await doPlan("m_root_default");
  assert(p.ads === 0 && p.state === "off" && p.refused === 4 && p.reason === "No ad fits this mode right now.", "the plan over refused lots: " + JSON.stringify({ a: p.ads, s: p.state, n: p.refused, r: p.reason }));
  // THE SHIPPED LIST: both house lots verify under the pinned reviewer (a stale approval in the repository fails here)
  lots.__setAdLotSourceForTests(null);
  const shipped = await lots.listedLots();
  assert(!shipped.error && shipped.refused.length === 0 && shipped.listed.length >= 2 && shipped.listed.every((l) => l.house) && shipped.listed.some((l) => l.placement === "following") && shipped.listed.some((l) => l.placement === "forYou"), "public/ads/lots.json: listed " + shipped.listed.map((l) => l.id).join() + ", refused " + JSON.stringify(shipped.refused));
  const sp = await doPlan("m_root_default");
  assert(sp.ads === 4 && sp.rows.filter((r) => r.kind === "ad").every((r) => r.ad.house && r.ad.lotId === "house-following"), "the shipped house ad on Following: " + sp.ads);
  return "1 of 10 listed (9 refusals by reason); small-order key inert; 4 unreadable lists; the shipped list: " + shipped.listed.map((l) => l.id).join(", ");
});

await check("A6", "contextual matching: 'Sports' fits 'Sunday Sports' as whole words, not 'Sport' or 'Work', only under Matched; Why this ad", async () => {
  freshWorld();
  useLots(STANDARD());
  assert(match.modeFits("Sunday Sports", ["Sports"]) && match.modeFits("SPORTS!", ["sports"]) && match.modeFits("weekend: sports", ["Sports"]), "a fit missed");
  assert(!match.modeFits("Sport", ["Sports"]) && !match.modeFits("Esports", ["Sports"]) && !match.modeFits("Work", ["Sports"]) && !match.modeFits(null, ["Sports"]), "a non-fit matched");
  assert(match.modeFits("Fantasy football analysis", ["fantasy football"]), "a two-word term");
  const s = await doPlan("m_root_sports");
  const first = s.rows.find((r) => r.kind === "ad").ad;
  assert(first.lotId === "sports-lot" && first.whyKind === "mode" && first.why === "Shown because you're in Sunday Sports mode.", "the sports ad's why: " + JSON.stringify(first));
  const second = s.rows.filter((r) => r.kind === "ad")[1].ad;
  assert(second.lotId === "house-a" && second.whyKind === "generic" && second.why === "Shown to everyone who has ads on. Nothing about you or your mode picked it.", "the generic ad's why: " + second.why);
  const w = await doPlan("m_root_work");
  assert(w.ads === 4 && w.rows.filter((r) => r.kind === "ad").every((r) => r.ad.lotId === "house-a"), "the sports lot showed in Work");
  // the same mode name gives the same ads whoever acts (nothing about the identity is an input to matching)
  personaCtl.id = PERSONA_ID;
  modeCtl.modes.set("m_persona_sports", modeOf("m_persona_sports", PERSONA_ID, { name: "Sunday Sports", adDial: "matched" }));
  const ps = await doPlan("m_persona_sports");
  assert(ps.rows.map((r) => (r.kind === "ad" ? r.ad.lotId + ":" + r.ad.why : "p")).join() === s.rows.map((r) => (r.kind === "ad" ? r.ad.lotId + ":" + r.ad.why : "p")).join(), "a persona's Sunday Sports mode got other ads than the root's");
  return "whole-word fits; sports first then house in Sunday Sports; house only in Work; why sentences exact";
});

await check("A7", "hide, sealed: one 4,096-byte sealed record with no id in the clear; still applied after a reload; advertiser hides all its lots; Undo; full refuses; unreadable = no ads, said", async () => {
  freshWorld();
  useLots([signed(lotOf("house-a")), signed(lotOf("house-b")), signed(sports())]);
  modeCtl.modes.set("m_root_default", { ...modeCtl.modes.get("m_root_default"), adDial: "generic" });
  const p0 = await doPlan("m_root_default");
  assert(p0.rows.filter((r) => r.kind === "ad").map((r) => r.ad.lotId).join() === "house-a,house-b,house-a,house-b", "before: " + p0.rows.filter((r) => r.kind === "ad").map((r) => r.ad.lotId).join());
  const h = await plan.adHide({ what: "ad", lot: "house-a", actor: p0.actor });
  assert(h.ok && h.changed, "the hide: " + JSON.stringify(h));
  const stored = persistStub.validatorStore.get(hides.AD_HIDES_NS);
  const recs = Object.values(stored ?? {});
  assert(recs.length === 1 && Object.keys(stored)[0] === "_", "not one record: " + Object.keys(stored ?? {}).join());
  assert(recs[0].ct.length === hides.AD_HIDES_BYTES * 2, "the ciphertext is " + recs[0].ct.length / 2 + " bytes, not " + hides.AD_HIDES_BYTES);
  const raw = JSON.stringify(stored);
  for (const needle of ["house-a", "house", ROOT_ID, "lots", "advertisers"]) assert(!raw.includes(needle), "the sealed record carries '" + needle + "' in the clear");
  // a reload (the cache forgotten): the hide is read back from the sealed record and still applies
  hides.resetAdHidesCache();
  const p1 = await doPlan("m_root_default");
  assert(p1.rows.filter((r) => r.kind === "ad").every((r) => r.ad.lotId === "house-b") && p1.ads === 4, "after a reload: " + p1.rows.filter((r) => r.kind === "ad").map((r) => r.ad.lotId).join());
  // the advertiser: every lot of it goes
  await plan.adHide({ what: "advertiser", lot: "house-b", actor: p1.actor });
  const p2 = await doPlan("m_root_default");
  assert(p2.ads === 0 && p2.state === "off", "after hiding the advertiser: " + p2.ads);
  // Undo the advertiser: house-b is back (house-a stays hidden on its own)
  const u = await plan.adUnhide({ what: "advertiser", id: "house", actor: p2.actor });
  assert(u.ok && u.changed, "undo: " + JSON.stringify(u));
  const p3 = await doPlan("m_root_default");
  assert(p3.rows.filter((r) => r.kind === "ad").every((r) => r.ad.lotId === "house-b") && p3.ads === 4, "after undo: " + p3.rows.filter((r) => r.kind === "ad").map((r) => r.ad.lotId).join());
  const listed = await plan.adHidden();
  assert(listed.lots.map((l) => l.id).join() === "house-a" && listed.lots[0].label === "Headline house-a" && listed.advertisers.length === 0, "the hidden list: " + JSON.stringify(listed));
  await plan.adShowAll({ actor: p3.actor });
  assert((await doPlan("m_root_default")).rows.filter((r) => r.kind === "ad").map((r) => r.ad.lotId).join() === "house-a,house-b,house-a,house-b", "show all again");
  // the size never changes with what it holds
  const sizes = new Set(knobs.flushes.filter((f) => f.ns === hides.AD_HIDES_NS).map((f) => f.bytes));
  assert(sizes.size === 1, "the sealed record's size changed with its content: " + [...sizes].join());
  // a 409 (another tab wrote first) re-reads and lands
  knobs.conflictOnce[hides.AD_HIDES_NS] = true;
  const c = await plan.adHide({ what: "ad", lot: "house-a", actor: p3.actor });
  assert(c.ok && c.changed && (await plan.adHidden()).lots.length === 1, "after a 409");
  // full: refused with a sentence, nothing over-written
  const doc = { v: 1, by: { [ROOT_ID]: { lots: Array.from({ length: hides.AD_HIDES_MAX }, (_, i) => "filler-" + i), advertisers: [] } } };
  persistStub.validatorStore.set(hides.AD_HIDES_NS, hides.sealAdHidesDoc(doc));
  hides.resetAdHidesCache();
  const before = JSON.stringify(persistStub.validatorStore.get(hides.AD_HIDES_NS));
  const full = await errOf(plan.adHide({ what: "ad", lot: "house-b", actor: p3.actor }));
  assert(full && full.code === "full" && /as many ads as this device keeps/.test(full.message) && JSON.stringify(persistStub.validatorStore.get(hides.AD_HIDES_NS)) === before, "a full record: " + (full ? full.code + " " + full.message : "accepted"));
  // unreadable: no ads, said, never the hidden ones
  hides.resetAdHidesCache();
  knobs.failFetch[hides.AD_HIDES_NS] = 503;
  const un = await doPlan("m_root_default");
  knobs.failFetch[hides.AD_HIDES_NS] = 0;
  assert(un.state === "error" && un.ads === 0 && un.reason === plan.AD_SENTENCES.hidesUnreadable, "an unreadable record: " + JSON.stringify({ s: un.state, a: un.ads, r: un.reason }));
  // a record that answers empty after this device sealed it: refused, not read as "nothing hidden"
  hides.resetAdHidesCache();
  persistStub.validatorStore.delete(hides.AD_HIDES_NS);
  const gone = await doPlan("m_root_default");
  assert(gone.state === "error" && gone.ads === 0, "a deleted record read as fresh: " + gone.state);
  return "one 4,096-byte record, no id in the clear; survives a reload; advertiser + undo + show all; 409 retried; full and unreadable refuse";
});

await check("A8", "identity: hides never cross root and persona; a page shaped under another identity's mode gets nothing; a stale tag or a switch before the write writes nothing; the route refuses another identity's dial", async () => {
  freshWorld();
  useLots([signed(lotOf("house-a"))]);
  const root = await doPlan("m_root_default");
  await plan.adHide({ what: "ad", lot: "house-a", actor: root.actor });
  assert((await doPlan("m_root_default")).ads === 0, "the root's hide did not apply to the root");
  personaCtl.id = PERSONA_ID;
  const per = await doPlan("m_persona_default");
  assert(per.ads === 4 && per.actor !== root.actor, "the root's hide applied to the persona: " + per.ads);
  // the persona hides; back as the root, the root's own state is exactly as it was
  await plan.adHide({ what: "advertiser", lot: "house-a", actor: per.actor });
  personaCtl.id = ROOT_ID;
  const hiddenRoot = await plan.adHidden();
  assert(hiddenRoot.lots.map((l) => l.id).join() === "house-a" && hiddenRoot.advertisers.length === 0, "the persona's advertiser hide shows under the root: " + JSON.stringify(hiddenRoot));
  // a page shaped under the persona's mode, planned while the root acts: refused (and the other way round)
  const e1 = await errOf(doPlan("m_persona_default"));
  assert(e1 && e1.code === "identity_changed" && e1.status === 409, "the root planned with the persona's mode: " + (e1 ? e1.code : "answered"));
  personaCtl.id = PERSONA_ID;
  const e2 = await errOf(doPlan("m_root_default"));
  assert(e2 && e2.code === "identity_changed", "the persona planned with the root's mode");
  // a hide carrying the root's tag while the persona acts: refused, nothing written
  const n0 = knobs.flushes.length;
  const e3 = await errOf(plan.adHide({ what: "ad", lot: "house-a", actor: root.actor }));
  assert(e3 && e3.code === "identity_changed" && knobs.flushes.length === n0, "a hide with another identity's tag: " + (e3 ? e3.code : "accepted"));
  // the identity switches between the check and the write: nothing written
  personaCtl.id = ROOT_ID;
  await plan.adShowAll({ actor: root.actor });
  const n1 = knobs.flushes.length;
  // switch to the persona the moment the sealed record is read (after the tag was checked, before the write's guard)
  let switched = false;
  const realPush = knobs.fetches.push.bind(knobs.fetches);
  knobs.fetches.push = (ns) => {
    if (ns === hides.AD_HIDES_NS && !switched) {
      switched = true;
      personaCtl.id = PERSONA_ID;
    }
    return realPush(ns);
  };
  hides.resetAdHidesCache();
  const e4 = await errOf(plan.adHide({ what: "ad", lot: "house-a", actor: root.actor }));
  knobs.fetches.push = realPush;
  assert(switched && e4 && e4.code === "identity_changed" && knobs.flushes.length === n1, "a switch before the write: " + (e4 ? e4.code : "written") + " flushes " + (knobs.flushes.length - n1));
  // the mode route: setting another identity's dial is refused
  personaCtl.id = ROOT_ID;
  const r = await modesRoute.PATCH(new nextStub.NextRequest("http://x/api/modes", { method: "PATCH", body: JSON.stringify({ modeId: "m_persona_default", patch: { adDial: "none" } }) }));
  assert(r.status === 409 && r.body.code === "other_identity" && modeCtl.modes.get("m_persona_default").adDial === undefined, "the root set the persona's dial: " + r.status);
  return "separate hides; 2 cross-identity plans refused; a stale tag and a mid-write switch wrote nothing; the route refused the persona's dial";
});

await check("A9", "no requests: planning, hiding, Undo and the hidden list make zero network requests (the lot list is in the bundle)", async () => {
  freshWorld();
  lots.__setAdLotSourceForTests(null); // the shipped list, as the device holds it
  netCalls.length = 0;
  const p = await doPlan("m_root_default");
  await plan.adHide({ what: "ad", lot: "house-following", actor: p.actor });
  await doPlan("m_root_default");
  await plan.adUnhide({ what: "ad", id: "house-following", actor: p.actor });
  await plan.adHidden();
  await doPlan("m_root_default", 50, "forYou");
  assert(netCalls.length === 0, netCalls.length + " network request(s): " + netCalls.slice(0, 3).join(", "));
  const fetched = new Set(knobs.fetches);
  assert([...fetched].every((n) => n === hides.AD_HIDES_NS), "the sealed reads touched other namespaces: " + [...fetched].join());
  assert(knobs.flushes.every((f) => f.ns === hides.AD_HIDES_NS), "writes to another namespace");
  return "0 network requests; sealed reads/writes of adHides only (" + knobs.fetches.length + " read, " + knobs.flushes.length + " written)";
});

await check("A10", "uniform presence: boot seals the empty record once; it is the same size as a full one", async () => {
  freshWorld();
  const a = await hides.ensureAdHidesNamespace();
  const b = await hides.ensureAdHidesNamespace();
  const empty = persistStub.validatorStore.get(hides.AD_HIDES_NS);
  assert(a === "sealed" && b === "present" && Object.keys(empty).length === 1, a + " " + b);
  const full = hides.sealAdHidesDoc({ v: 1, by: { [ROOT_ID]: { lots: Array.from({ length: 30 }, (_, i) => "lot-" + i), advertisers: ["adv-1"] } } });
  assert(Object.values(empty)[0].ct.length === Object.values(full)[0].ct.length, "empty " + Object.values(empty)[0].ct.length + " vs full " + Object.values(full)[0].ct.length);
  return "sealed, then present; empty = full = " + hides.AD_HIDES_BYTES + " bytes";
});

await check("A11", "dormant: ADS unset, off or misspelt places no ad whatever the dial, and says so; only ADS=on runs them; the device is told and reads ADS=on only; Settings is told; the device env builder spreads the hint", async () => {
  freshWorld();
  useLots(STANDARD());
  const saved = process.env.ADS;
  const S = adsSwitch.ADS_DORMANT_SENTENCE;
  try {
    let n = 0;
    for (const v of [undefined, "", "off", "OFF", "yes", "true", "1", "enabled", "on please"]) {
      if (v === undefined) delete process.env.ADS;
      else process.env.ADS = v;
      for (const m of ["m_root_default", "m_root_sports", "m_root_work"]) {
        const p = await doPlan(m);
        assert(p.dormant === true && p.state === "off" && p.ads === 0 && adPositions(p).length === 0 && p.reason === S, "ADS=" + JSON.stringify(v) + " in " + m + ": " + JSON.stringify({ d: p.dormant, s: p.state, a: p.ads, r: p.reason }));
        assert(p.rows.map((r) => r.hash).join() === posts(50).join(), "the posts changed under a dormant plan");
        n++;
      }
      assert(JSON.stringify(adsSwitch.adsDeviceHints(process.env)) === "{}", "ADS=" + JSON.stringify(v) + " forwarded a hint: " + JSON.stringify(adsSwitch.adsDeviceHints(process.env)));
      const g = await modesRoute.GET();
      assert(g.status === 200 && g.body.adsRunning === false, "Settings was told ads run under ADS=" + JSON.stringify(v));
    }
    const warn = adsSwitch.adsBootWarning({ ADS: "zzqx" });
    assert(warn && warn.startsWith("ADS must be") && !warn.includes("zzqx") && adsSwitch.adsBootWarning({ ADS: "on" }) === null && adsSwitch.adsBootWarning({}) === null, "the boot line: " + warn);
    // on: exactly Phase 1
    for (const v of ["on", " On "]) {
      process.env.ADS = v;
      const p = await doPlan("m_root_default");
      assert(p.dormant === false && p.ads === 4 && adPositions(p).join() === "5,20,35,50", "ADS=" + JSON.stringify(v) + ": " + p.ads + " ads");
      assert(adsSwitch.adsDeviceHints(process.env).ADS === "on", "ADS=" + JSON.stringify(v) + " forwarded no hint");
      assert((await modesRoute.GET()).body.adsRunning === true, "Settings not told ads run");
    }
    // the device reads ONLY the env it was handed, and only the exact hint
    globalThis.window = {};
    try {
      assert(adsSwitch.adsRunning({ ADS: "on" }) === true && adsSwitch.adsRunning({}) === false && adsSwitch.adsRunning({ ADS: "true" }) === false && adsSwitch.adsRunning({ ADS: " on" }) === false, "the device's reading of its hint");
      process.env.ADS = "true";
      const d = await doPlan("m_root_default");
      assert(d.dormant === true && d.ads === 0, "a device handed ADS=true placed ads");
      process.env.ADS = "on";
      const d2 = await doPlan("m_root_default");
      assert(d2.dormant === false && d2.ads === 4, "a device handed ADS=on placed " + d2.ads);
    } finally {
      delete globalThis.window;
    }
    // the page's device env is built with the hint (lib/device/deviceEnv.server.ts, not bundled here: read as source)
    const de = readFileSync(path.join(ROOT, "lib", "device", "deviceEnv.server.ts"), "utf8");
    assert(/^\s*\.\.\.adsDeviceHints\(process\.env\),\s*$/m.test(de) && /import \{ adsDeviceHints \} from "@\/lib\/ads\/switch";/.test(de), "lib/device/deviceEnv.server.ts does not spread adsDeviceHints(process.env)");
    return n + " dormant plans (9 values × 3 modes, all dials) with 0 ads; on and ' On ' run Phase 1; the device reads only ADS=on; the builder spreads the hint";
  } finally {
    if (saved === undefined) delete process.env.ADS;
    else process.env.ADS = saved;
  }
});

if (!MUTATIONS.length && ONLY.length === 0) {
  const MT = "lib/ads/match.ts";
  const LT = "lib/ads/lots.ts";
  const PL = "lib/ads/plan.ts";
  const HD = "lib/ads/hides.ts";
  const DL = "lib/ads/dial.ts";
  const IJ = "lib/injection.ts";
  const MR = "app/api/modes/route.ts";
  const runs = [
    ["Following's first slot moved", "A1", [{ file: MT, find: "following: Object.freeze({ first: 5, every: 15 }),", replace: "following: Object.freeze({ first: 4, every: 15 })," }]],
    ["an ad allowed as the last row", "A2", [{ file: IJ, find: "      if (at >= merged.length) {", replace: "      if (at > merged.length) {" }]],
    ["ads deduplicated against each other (one house lot fills one slot)", "A1", [{ file: IJ, find: 'if (item.type !== "readwise" && item.type !== "ad") seen.add(item.sourceHash);', replace: 'if (item.type !== "readwise") seen.add(item.sourceHash);' }]],
    ["the ad cap left at the queue's default (2 a page)", "A1", [{ file: PL, find: "{ caps: { ad: count }, slots: { ad: rule } }", replace: "{ slots: { ad: rule } }" }]],
    ["the route reads the body on a server", "A1", [{ file: "app/api/ads/route.ts", find: "  // FIRST, before the body is read: no server decides, or learns, a visitor's ads\n  if (typeof window === \"undefined\") return deviceOnly();", replace: "  await req.json().catch(() => null);\n  if (typeof window === \"undefined\") return deviceOnly();" }]],
    ["a thread accepted as a placement", "A1", [{ file: PL, find: 'if (placement !== "following" && placement !== "forYou") throw', replace: 'if (false) throw' }]],
    ["a promoted duplicate of a post kept", "A2", [{ file: IJ, find: "    if (seen.has(item.sourceHash)) {\n      dropped.push({ type: item.type, reason: \"duplicate\", sourceHash: item.sourceHash });\n      continue;\n    }", replace: "" }]],
    ["No ads ignored by the plan", "A3", [{ file: PL, find: '  if (d.dial === "none") return { ...withDial, reason: d.forced ? FORCED_OFF_SENTENCE : AD_SENTENCES.dialNone };', replace: "" }]],
    ["No ads ignored by the matcher", "A3", [{ file: MT, find: '  if (ctx.dial === "none") return [];', replace: "" }]],
    ["a private persona's default is generic", "A3", [{ file: DL, find: 'dial: ownerKind === "public" ? "generic" : "none"', replace: 'dial: ownerKind === "private" ? "none" : "generic"' }]],
    ["Event Safe Space not forced off", "A4", [{ file: DL, find: '  if (mode.allowAds === false) return { dial: "none", isDefault: false, forced: true };', replace: "" }]],
    ["the route lets Event Safe Space be set", "A4", [{ file: MR, find: '    if (target.allowAds === false && want !== null && want !== "none")', replace: "    if (false)" }]],
    ["the route stores any word", "A4", [{ file: MR, find: "    if (want !== null && !isAdDial(want))", replace: "    if (false)" }]],
    ["a rejection listed", "A5", [{ file: LT, find: '    if (r.decision !== "approved") {\n      refused.push({ id, reason: "rejected" });', replace: '    if (false) {\n      refused.push({ id, reason: "rejected" });' }]],
    ["the signature not checked (an edit after approval listed)", "A5", [{ file: LT, find: "    if (!HEX128.test(r.sig) || !verifyCanonical(r.sig, line, r.reviewer)) {", replace: "    if (!HEX128.test(r.sig)) {" }]],
    ["any key may approve", "A5", [{ file: LT, find: "    if (!pinned.has(r.reviewer)) {", replace: "    if (false) {" }]],
    ["another policy's approval counts", "A5", [{ file: LT, find: "    if (r.policy !== policy) {", replace: "    if (false) {" }]],
    ["an unreviewed lot listed", "A5", [{ file: LT, find: "    if (!r) {\n      refused.push({ id, reason: \"unreviewed\" });\n      continue;\n    }", replace: "    if (!r) {\n      listed.push(lot);\n      continue;\n    }" }]],
    ["a non-https link listed", "A5", [{ file: LT, find: '    return p.protocol === "https:" && !!p.hostname && !p.username && !p.password;', replace: "    return !!p.hostname;" }]],
    ["Generic only lets mode lots in", "A3", [{ file: MT, find: '  if (ctx.dial === "generic") return generic;', replace: "" }]],
    ["mode terms matched inside words", "A6", [{ file: MT, find: '    return n.length > 0 && name.includes(" " + n + " ");', replace: "    return n.length > 0 && name.includes(n);" }]],
    ["Why this ad does not name the mode", "A6", [{ file: MT, find: "  if (pick.why === \"mode\") return `Shown because you're in ${modeName ?? \"this\"} mode.`;", replace: "  if (pick.why === \"mode\") return \"Shown because it matched.\";" }]],
    ["a hidden lot still shown", "A7", [{ file: MT, find: "l.placement === ctx.placement && !ctx.hiddenLots.has(l.id) &&", replace: "l.placement === ctx.placement &&" }]],
    ["a hidden advertiser still shown", "A7", [{ file: MT, find: " && !ctx.hiddenAdvertisers.has(l.advertiser.id));", replace: ");" }]],
    ["unreadable hides read as none hidden (fail open)", "A7", [{ file: PL, find: "  } catch {\n    return { ...counted, state: \"error\", reason: AD_SENTENCES.hidesUnreadable };\n  }", replace: "  } catch {\n    hidden = { lots: new Set<string>(), advertisers: new Set<string>() };\n  }" }]],
    ["the record not padded (its size says how much was hidden)", "A7", [{ file: HD, find: '{ _: { m: JSON.parse(inner), pad: " ".repeat(pad) } }', replace: '{ _: { m: JSON.parse(inner), pad: "" } }' }]],
    ["a deleted record read as fresh", "A7", [{ file: HD, find: "        } else if (wasEverSealed(AD_HIDES_NS)) {\n          throw new Error(\"vault: adHides is EMPTY", replace: "        } else if (false) {\n          throw new Error(\"vault: adHides is EMPTY" }]],
    ["a full record over-written", "A7", [{ file: HD, find: "      if (total(cur) >= AD_HIDES_MAX) throw new AdHidesFull();", replace: "      if (total(cur) >= AD_HIDES_MAX) cur.by[identity] = { lots: e.lots.slice(1), advertisers: e.advertisers };" }]],
    ["hides read for every identity at once", "A8", [{ file: HD, find: "  const e = doc.by[identity];\n  return { lots: new Set(e?.lots ?? []),", replace: "  const e = { lots: Object.values(doc.by).flatMap((x) => x.lots), advertisers: Object.values(doc.by).flatMap((x) => x.advertisers) };\n  return { lots: new Set(e?.lots ?? [])," }]],
    ["a page planned under another identity's mode", "A8", [{ file: PL, find: "  if (mode.personaId !== identity) throw new AdPlanError(\"identity_changed\", 409, AD_SENTENCES.identityChanged);", replace: "" }]],
    ["a hide accepted with another identity's tag", "A8", [{ file: PL, find: 'if (!identity || typeof actor !== "string" || actor !== (await actorTag(identity))) throw', replace: "if (!identity) throw" }]],
    ["the identity not re-checked right before the write", "A8", [{ file: HD, find: "      if (!fits(doc)) throw new AdHidesFull();\n      await guard();", replace: "      if (!fits(doc)) throw new AdHidesFull();" }]],
    ["the route sets another identity's dial", "A8", [{ file: MR, find: "    if (target.personaId !== activeSeedPersonaId()) return", replace: "    if (false) return" }]],
    ["the plan asks the network for the list", "A9", [{ file: PL, find: '  const { listedLots } = await import("./lots");\n  const lots = await listedLots();', replace: '  const { listedLots } = await import("./lots");\n  await fetch("https://ads.invalid/lots.json").catch(() => null);\n  const lots = await listedLots();' }]],
    // DORMANT: a missing, off or misspelt switch must never show ads
    ["the plan ignores the switch (ads with ADS unset)", "A11", [{ file: PL, find: "  if (!adsRunning()) return { ...base, dormant: true, reason: ADS_DORMANT_SENTENCE };", replace: "" }]],
    ["a misspelt switch read as on", "A11", [{ file: "lib/ads/switch.ts", find: '  if (v === "on") return "on";', replace: '  if (v !== "" && v !== "off") return "on";' }]],
    ["the device runs ads without its hint", "A11", [{ file: "lib/ads/switch.ts", find: "  if (typeof window !== \"undefined\") return (env[ADS_ENV] ?? \"\") === ADS_DEVICE_VALUE;", replace: "  if (typeof window !== \"undefined\") return true;" }]],
    ["the device told ADS=on whatever the app says", "A11", [{ file: "lib/ads/switch.ts", find: "  return adsSwitchValue(env) === \"on\" ? { [ADS_ENV]: ADS_DEVICE_VALUE } : {};", replace: "  return { [ADS_ENV]: ADS_DEVICE_VALUE };" }]],
    ["boot seals nothing when absent", "A10", [{ file: HD, find: "    if (loaded.present) return \"present\" as const;\n    await save({ v: 1, by: {} });", replace: "    if (loaded.present || true) return \"present\" as const;\n    await save({ v: 1, by: {} });" }]],
  ];
  await check("M", "MUTATIONS: each guard removed in the bundle only — the check that covers it FAILS (" + runs.length + " mutations)", async () => {
    const survived = [];
    for (const [label, target, muts] of runs) {
      const r = spawnSync(process.execPath, [SELF, "--only=" + target], {
        cwd: ROOT,
        env: { ...process.env, ADS_MUTATION: JSON.stringify(muts), ADS_UNIT_QUIET: "1", KEYSTORE_DIR: "" },
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

globalThis.fetch = realFetch;
lots.__setAdLotSourceForTests(null);
rmSync(tmp, { recursive: true, force: true });
const summary = `${passed}/${passed + failed} ads unit checks passed` + (failed ? ` — FAILED: ${failedIds.join(",")}` : "");
console.log((QUIET ? "" : "\n") + summary);
process.exit(failed ? 1 : 0);
