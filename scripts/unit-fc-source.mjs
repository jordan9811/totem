// NEYNAR AS A SWITCH (SECURITY-POSTURE.md §42) — THE PER-SURFACE SOURCE SWITCH, CALLED DIRECTLY.
//
// Bundles lib/fc/source/switch.ts and lib/fc/readRelay.server.ts with esbuild (`server-only` shimmed, the @/ paths from
// tsconfig.json) and measures, in-process, with no server, no socket and a fake key:
//   S1  THE SWITCH PARSES: unset/blank → unset; network/neynar/auto in any case, padded; anything else → invalid (read as
//       network); the boot line names an unknown value's VARIABLE and its LENGTH, never the value
//   S2  THE HARD RULE: Following, notifications and counts under every value are network (counts: unavailable); neynar and
//       auto are REFUSED with the sentence ("would hand your account to Totem's server" / "which posts you are looking
//       at"), said at boot; the server never allows Neynar for them; the device never asks (even handed a forged hint with
//       the relay on); no hint is ever forwarded for them
//   S3  FOR YOU AND SEARCH: neynar/auto + an armed relay → Via Neynar; + no read key → OFF, said ("isn't connected"), never
//       an empty list; network/unset/invalid → the network (search: the device only)
//   S4  THE DEVICE HINTS: every switch unset → nothing (a page byte for byte what it was); only FC_SOURCE_FORYOU and
//       FC_SOURCE_SEARCH, only for neynar/auto; the device reads a hint only beside FC_READ_RELAY=on and never on a server
//   S5  THE RELAY OBEYS THE SERVER'S SWITCH, not the tab's: default (every switch unset) → discovery, both searches, thread,
//       user, user-casts all 503 fc_source_off with ZERO upstream fetches; FC_SOURCE_SEARCH=neynar → the searches and the
//       lookups answer, discovery stays off; FC_SOURCE_FORYOU=neynar → discovery answers, the searches stay off; Following,
//       notifications and counts set to neynar open NOTHING
//   S6  THE RELAY NEVER RECEIVES A FID, A PERSONA OR A VISITOR LIST: a search's one upstream GET is <base>/cast/search/?q=
//       <the normalised query>&limit=10 (users: /user/search/?q=…&limit=5) with exactly those two parameters; the path
//       check refuses viewer_fid, author_fid, fid, cursor, channel_id, parent_url, another limit and a missing q; the op
//       refuses an array, an object, a number, a control character, 1 or 65+ characters; results pass the score floor
//   S7  THE DEVICE'S OWN-ACCOUNT GUARD: a query naming an own handle (@alice, Alice, "posts by alice", alice's), an own
//       fname (alice.eth, and alice for alice.eth) or an own fid is never sent; malice, alicex, 123456 are
//   S8  THE LABELS: "From Farcaster's network", "Via Neynar", "From your device", each surface's label, and the UI sources
//       that draw them (the relay chip says Via Neynar; the hub feeds carry data-source="network"; the Neynar search
//       section says Via Neynar; device search says From your device)
//   S9  THE WIRING, as source: the device env builder spreads the hints, the boot says the lines, the relay route is
//       untouched (op/arg only), the network-search route guards the query before the relay and gates on the switch,
//       data.ts makes no relay read of the visitor's own account (the retired "Show my Farcaster posts here"), the
//       Developer page renders the panel on both shapes
//   M   MUTATIONS: each guard removed (in the bundle or in the source read), the check that covers it FAILS
//
//   node scripts/unit-fc-source.mjs          (npm run test:fc-source-unit)
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { makeStubKey } from "./lib/neynar-stub.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SELF = fileURLToPath(import.meta.url);
const require = createRequire(path.join(ROOT, "package.json"));
const { build } = require("esbuild");

const MUTATIONS = process.env.FCS_MUTATION ? JSON.parse(process.env.FCS_MUTATION) : [];
const ONLY = (process.argv.find((a) => a.startsWith("--only=")) ?? "").slice(7).split(",").filter(Boolean);
const QUIET = process.env.FCS_UNIT_QUIET === "1";

let passed = 0;
let failed = 0;
const failedIds = [];
async function check(id, name, fn) {
  if (ONLY.length && !ONLY.includes(id)) return;
  try {
    const extra = await fn();
    passed++;
    if (!QUIET) console.log(`  PASS  ${id}. ${name}${typeof extra === "string" ? " — " + extra : ""}`);
  } catch (e) {
    failed++;
    failedIds.push(id);
    if (!QUIET) console.log(`  FAIL  ${id}. ${name} — ${e && e.message ? e.message : String(e)}`);
  }
}
const assert = (c, m) => {
  if (!c) throw new Error(m);
};

// ---------------------------------------------------------------- the modules under test, bundled (mutations applied)
const tmp = mkdtempSync(path.join(os.tmpdir(), "layers-fcsource-unit-"));
const S = (n) => path.join(tmp, n);
writeFileSync(S("server-only.ts"), "export {};\n");
writeFileSync(S("entry.ts"), 'export * as sw from "@/lib/fc/source/switch";\nexport * as relay from "@/lib/fc/readRelay.server";\n');
const applied = new Set();
const applyTo = (rel, src) => {
  for (const m of MUTATIONS.filter((x) => rel.endsWith(x.file))) {
    if (!src.includes(m.find)) throw new Error("MUTATION ANCHOR NOT FOUND in " + m.file + ": " + m.find.slice(0, 80));
    src = src.replace(m.find, m.replace);
    applied.add(m);
  }
  return src;
};
const mutatePlugin = {
  name: "mutate",
  setup(b) {
    if (!MUTATIONS.length) return;
    b.onLoad({ filter: /\.(ts|tsx|mjs)$/ }, (args) => {
      const rel = args.path.split(path.sep).join("/");
      if (!MUTATIONS.some((m) => rel.endsWith(m.file))) return undefined;
      const src = applyTo(rel, readFileSync(args.path, "utf8").replace(/\r\n/g, "\n"));
      return { contents: src, loader: args.path.endsWith(".mjs") ? "js" : "ts", resolveDir: path.dirname(args.path) };
    });
  },
};
/** a repository file as source text, with this run's mutations applied (the S8/S9 source checks read through it). An
 *  anchor that is not there exits 2 at once: a mutation that was never applied must never count as caught. */
function src(rel) {
  try {
    return applyTo(rel, readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n"));
  } catch (e) {
    console.log(e && e.message ? e.message : String(e));
    process.exit(2);
  }
}
let M;
try {
  const out = S("bundle.mjs");
  await build({
    plugins: [mutatePlugin],
    absWorkingDir: ROOT,
    entryPoints: [S("entry.ts")],
    outfile: out,
    bundle: true,
    format: "esm",
    platform: "node",
    target: ["node20"],
    tsconfig: path.join(ROOT, "tsconfig.json"),
    alias: { "server-only": S("server-only.ts") },
    logLevel: "error",
  });
  M = await import(pathToFileURL(out).href);
} catch (e) {
  console.log("cannot bundle the switch and the relay: " + (e && e.message ? e.message.split("\n").slice(0, 3).join(" | ") : String(e)));
  rmSync(tmp, { recursive: true, force: true });
  process.exit(2);
}
const { sw, relay } = M;

if (!QUIET) console.log("\nNEYNAR AS A SWITCH — the per-surface source switch and the relay's obedience, in-process (no server, no socket)");

const SURFACES = ["following", "notifications", "forYou", "search", "counts", "channels"];
const VAR = { following: "FC_SOURCE_FOLLOWING", notifications: "FC_SOURCE_NOTIFICATIONS", forYou: "FC_SOURCE_FORYOU", search: "FC_SOURCE_SEARCH", counts: "FC_SOURCE_COUNTS", channels: "FC_SOURCE_CHANNELS" };
const VALUES = [undefined, "", "  ", "network", "NETWORK", "neynar", " Neynar ", "auto", "AUTO", "typo", "true", "on", "neynar,auto", "https://api.neynar.com"];
const ACCOUNT = "would hand your account to Totem's server";

// ---------------------------------------------------------------- S1
await check("S1", "THE SWITCH PARSES: unset/blank, the three values in any case and padding, anything else invalid (network); an unknown value's boot line says its name and length, never the value", async () => {
  const want = { undefined: "unset", "": "unset", "  ": "unset", network: "network", NETWORK: "network", neynar: "neynar", " Neynar ": "neynar", auto: "auto", AUTO: "auto" };
  const wrong = [];
  for (const s of SURFACES) {
    for (const v of VALUES) {
      const got = sw.askedSource(v === undefined ? {} : { [VAR[s]]: v }, s);
      const exp = want[String(v)] ?? "invalid";
      if (got !== exp) wrong.push(`${s}=${JSON.stringify(v)} → ${got} (expected ${exp})`);
    }
  }
  assert(!wrong.length, wrong.slice(0, 6).join(" | "));
  const secret = "https://api.neynar.com/secretvalue";
  const lines = sw.fcSourceBootLines({ FC_SOURCE_SEARCH: secret }, true);
  const line = lines.warn.find((l) => l.includes("FC_SOURCE_SEARCH"));
  assert(line && line.includes(`${secret.length} character(s)`) && line.includes("reads as network"), "the unknown value's boot line: " + JSON.stringify(lines.warn));
  assert(!JSON.stringify(lines).includes("secretvalue") && !JSON.stringify(lines).includes("api.neynar"), "the boot lines echo the value");
  const st = sw.surfaceState({ FC_SOURCE_SEARCH: secret }, "search", true);
  assert(st.effective === "network" && st.reason === "invalid" && !st.sentence.includes("secretvalue"), "an unknown search value: " + JSON.stringify(st));
  return `${SURFACES.length * VALUES.length} (surface, value) pairs; the unknown value said as ${secret.length} character(s)`;
});

// ---------------------------------------------------------------- S2
await check("S2", "THE HARD RULE: Following, notifications and counts are network-only under every value; neynar/auto refused with the sentence at boot; the server never allows Neynar; the device never asks, even with a forged hint and the relay on; no hint forwarded", async () => {
  const problems = [];
  for (const s of ["following", "notifications", "counts"]) {
    for (const v of VALUES) {
      for (const armed of [true, false]) {
        const env = v === undefined ? {} : { [VAR[s]]: v };
        const st = sw.surfaceState(env, s, armed);
        const exp = s === "counts" ? "unavailable" : "network";
        if (st.effective !== exp) problems.push(`${s}=${JSON.stringify(v)} armed=${armed} → ${st.effective}`);
        if (sw.serverNeynarAllowed(env, s)) problems.push(`the server allows Neynar for ${s}=${JSON.stringify(v)}`);
        const asked = sw.askedSource(env, s);
        if ((asked === "neynar" || asked === "auto") && (st.reason !== "refused" || !st.sentence.includes(s === "counts" ? "which posts you are looking at" : ACCOUNT))) problems.push(`${s}=${v} not refused with the sentence: ${st.reason} ${st.sentence}`);
      }
    }
    if (!sw.FC_NETWORK_ONLY.has(s)) problems.push(s + " is not in FC_NETWORK_ONLY");
    // the boot says the refusal, with the sentence
    const boot = sw.fcSourceBootLines({ [VAR[s]]: "neynar" }, true);
    if (!boot.warn.some((l) => l.includes("REFUSED") && l.includes(VAR[s] + "=neynar") && l.includes(s === "counts" ? "which posts you are looking at" : ACCOUNT))) problems.push(`no boot refusal for ${VAR[s]}=neynar: ${JSON.stringify(boot.warn)}`);
    if (!boot.info.includes(`${s}=${s === "counts" ? "unavailable" : "network"}`)) problems.push(`the boot summary says ${boot.info}`);
    // the device: a forged hint with the relay on still asks nothing
    globalThis.window = {};
    try {
      for (const v of ["neynar", "auto"]) if (sw.deviceNeynarOn(s, { [VAR[s]]: v, FC_READ_RELAY: "on" })) problems.push(`the device asks Neynar for ${s} with a forged ${v} hint`);
    } finally {
      delete globalThis.window;
    }
    const hints = sw.fcSourceDeviceHints({ [VAR[s]]: "neynar", FC_SOURCE_FOLLOWING: "auto", FC_SOURCE_NOTIFICATIONS: "neynar", FC_SOURCE_COUNTS: "auto" });
    if (Object.keys(hints).length) problems.push(`a hint is forwarded for ${s}: ${JSON.stringify(hints)}`);
  }
  assert(!problems.length, problems.slice(0, 6).join(" | "));
  return `3 surfaces × ${VALUES.length} values × armed/unarmed: network (counts unavailable), refused with the sentence, no server allowance, no device read, no hint`;
});

// ---------------------------------------------------------------- S3
await check("S3", "FOR YOU AND SEARCH: neynar/auto + armed → Via Neynar; + no read key → off, said (never an empty list); network/unset/invalid → the network (search: the device)", async () => {
  const problems = [];
  for (const s of ["forYou", "search"]) {
    for (const v of ["neynar", "auto", " NEYNAR "]) {
      const on = sw.surfaceState({ [VAR[s]]: v }, s, true);
      if (on.effective !== "neynar" || on.label !== "Via Neynar") problems.push(`${s}=${v} armed → ${on.effective} ${on.label}`);
      if (!sw.serverNeynarAllowed({ [VAR[s]]: v }, s)) problems.push(`the server refuses ${s}=${v}`);
      const off = sw.surfaceState({ [VAR[s]]: v }, s, false);
      if (off.effective !== "off" || off.reason !== "neynar_unarmed" || !/isn't connected/.test(off.sentence)) problems.push(`${s}=${v} unarmed → ${off.effective} ${off.reason}: ${off.sentence}`);
      const boot = sw.fcSourceBootLines({ [VAR[s]]: v }, false);
      if (!boot.warn.some((l) => l.includes(VAR[s]) && l.includes("OFF"))) problems.push(`no unarmed boot line for ${s}=${v}`);
    }
    for (const v of [undefined, "network", "typo"]) {
      const st = sw.surfaceState(v === undefined ? {} : { [VAR[s]]: v }, s, true);
      const label = s === "search" ? "From your device" : "From Farcaster's network";
      if (st.effective !== "network" || st.label !== label) problems.push(`${s}=${v} → ${st.effective} ${st.label}`);
      if (sw.serverNeynarAllowed(v === undefined ? {} : { [VAR[s]]: v }, s)) problems.push(`the server allows ${s}=${v}`);
    }
  }
  const ch = sw.surfaceState({ FC_SOURCE_CHANNELS: "neynar" }, "channels", true);
  if (ch.effective !== "off" || ch.reason !== "not_built" || sw.serverNeynarAllowed({ FC_SOURCE_CHANNELS: "neynar" }, "channels")) problems.push("channels: " + JSON.stringify(ch));
  // the device's "switched on, not connected" reading
  globalThis.window = {};
  try {
    if (!sw.deviceNeynarUnarmed("search", { FC_SOURCE_SEARCH: "neynar" })) problems.push("the device does not see search switched on but unarmed");
    if (sw.deviceNeynarUnarmed("search", { FC_SOURCE_SEARCH: "neynar", FC_READ_RELAY: "on" })) problems.push("the device reads armed search as unarmed");
  } finally {
    delete globalThis.window;
  }
  assert(!problems.length, problems.slice(0, 6).join(" | "));
  return "neynar/auto armed → Via Neynar; unarmed → off, said; network/unset/typo → network (search: the device); channels not built";
});

// ---------------------------------------------------------------- S4
await check("S4", "THE DEVICE HINTS: unset → nothing; only FC_SOURCE_FORYOU / FC_SOURCE_SEARCH for neynar/auto; the device needs FC_READ_RELAY=on, and a server never reads them", async () => {
  const problems = [];
  if (JSON.stringify(sw.fcSourceDeviceHints({})) !== "{}") problems.push("unset forwards " + JSON.stringify(sw.fcSourceDeviceHints({})));
  const allNetwork = Object.fromEntries(SURFACES.map((s) => [VAR[s], "network"]));
  if (JSON.stringify(sw.fcSourceDeviceHints(allNetwork)) !== "{}") problems.push("all network forwards " + JSON.stringify(sw.fcSourceDeviceHints(allNetwork)));
  const allNeynar = Object.fromEntries(SURFACES.map((s) => [VAR[s], "neynar"]));
  const h = sw.fcSourceDeviceHints(allNeynar);
  if (JSON.stringify(h) !== JSON.stringify({ FC_SOURCE_FORYOU: "neynar", FC_SOURCE_SEARCH: "neynar" })) problems.push("all neynar forwards " + JSON.stringify(h));
  if (JSON.stringify(sw.fcSourceDeviceHints({ FC_SOURCE_SEARCH: " Auto " })) !== JSON.stringify({ FC_SOURCE_SEARCH: "auto" })) problems.push("auto is not forwarded as auto");
  if (JSON.stringify(sw.fcSourceDeviceHints({ FC_SOURCE_SEARCH: "typo" })) !== "{}") problems.push("an unknown value is forwarded");
  // a server never relays
  if (sw.deviceNeynarOn("search", { FC_SOURCE_SEARCH: "neynar", FC_READ_RELAY: "on" })) problems.push("deviceNeynarOn is true off the device");
  globalThis.window = {};
  try {
    if (!sw.deviceNeynarOn("search", { FC_SOURCE_SEARCH: "neynar", FC_READ_RELAY: "on" })) problems.push("the device does not read its search hint");
    if (sw.deviceNeynarOn("search", { FC_SOURCE_SEARCH: "neynar" })) problems.push("the device reads search on without the relay hint");
    if (sw.deviceNeynarOn("forYou", { FC_SOURCE_SEARCH: "neynar", FC_READ_RELAY: "on" })) problems.push("search's hint turns For You on");
  } finally {
    delete globalThis.window;
  }
  assert(!problems.length, problems.join(" | "));
  return "unset/network/typo → {}; all neynar → exactly For You and search; the device needs the relay hint; a server never";
});

// ---------------------------------------------------------------- the relay, armed on a recorder
const KEY = makeStubKey();
const BASE = "http://127.0.0.1:9/v2/farcaster";
const FEED = JSON.parse(readFileSync(path.join(ROOT, "fixtures/neynar/feed-following.json"), "utf8")).casts.filter((c) => !c.parent_hash);
const USERS = JSON.parse(readFileSync(path.join(ROOT, "fixtures/neynar/user-bulk.json"), "utf8")).users;
const LOW = { ...USERS[1], fid: 990001, username: "lowscore", score: 0.1, experimental: { neynar_user_score: 0.1 } };
const fetches = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const u = String(url);
  fetches.push({ url: u, key: init?.headers?.["x-api-key"] });
  const p = new URL(u).pathname.replace(/^\/v2\/farcaster/, "");
  const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });
  if (p === "/cast/search/") return json({ result: { casts: FEED.slice(0, 3), next: { cursor: null } } });
  if (p === "/user/search/") return json({ result: { users: [USERS[0], LOW], next: { cursor: null } } });
  if (p === "/feed/") return json({ casts: FEED.slice(0, 5), next: { cursor: null } });
  if (p === "/user/by_username") return json({ user: USERS[0] });
  return json({ message: "not found" }, 404);
};
const ENV_NAMES = ["FC_READ", "NEYNAR_READ_API_KEY", "NEYNAR_READ_BASE_URL", "FC_READ_RIG", "FC_READ_FIDS", "FC_READ_HOUSE_FID", "FC_READ_DAILY_CREDITS", "FC_READ_MIN_SCORE", "FC_READ_DENY", ...Object.values(VAR), "RAILWAY_ENVIRONMENT", "RAILWAY_PROJECT_ID", "RAILWAY_SERVICE_ID", "LAYERS_HOSTED", "NODE_ENV", "ZK_DEV_HOOKS"];
const saved = Object.fromEntries(ENV_NAMES.map((n) => [n, process.env[n]]));
function armWith(switches) {
  for (const n of ENV_NAMES) delete process.env[n];
  Object.assign(process.env, { NEYNAR_READ_API_KEY: KEY, NEYNAR_READ_BASE_URL: BASE, FC_READ_RIG: "stub", FC_READ_FIDS: "194,3" }, switches);
  relay.resetFcReadRelay();
  fetches.length = 0;
}
const realLog = console.log;
const realWarn = console.warn;
async function quiet(fn) {
  console.log = (...a) => (String(a[0]).startsWith("[fc-read]") ? undefined : realLog(...a));
  console.warn = () => undefined;
  try {
    return await fn();
  } finally {
    console.log = realLog;
    console.warn = realWarn;
  }
}
const OPS = [
  ["discovery", undefined],
  ["search-casts", "fcsourceprobe"],
  ["search-users", "fcsourceprobe"],
  ["thread", "0x" + "ab".repeat(20)],
  ["user", "dwr"],
  ["user-casts", "dwr"],
];
async function answers(switches) {
  armWith(switches);
  return quiet(async () => {
    const out = {};
    for (const [op, arg] of OPS) out[op] = await relay.fcRead(op, arg, "local");
    return { out, fetched: [...fetches] };
  });
}

// ---------------------------------------------------------------- S5
await check("S5", "THE RELAY OBEYS THE SERVER'S SWITCH: default → every op 503 fc_source_off and ZERO upstream fetches; search=neynar → searches and lookups, discovery off; forYou=neynar → discovery and lookups, searches off; following/notifications/counts=neynar open nothing", async () => {
  const problems = [];
  const offAll = (label, r) => {
    for (const [op] of OPS) if (r.out[op].status !== 503 || r.out[op].body?.code !== "fc_source_off") problems.push(`${label}: ${op} → ${r.out[op].status} ${JSON.stringify(r.out[op].body).slice(0, 80)}`);
    if (r.fetched.length) problems.push(`${label}: ${r.fetched.length} upstream fetch(es)`);
  };
  offAll("default", await answers({}));
  offAll("all network", await answers(Object.fromEntries(Object.values(VAR).map((n) => [n, "network"]))));
  offAll("following+notifications+counts+channels neynar", await answers({ FC_SOURCE_FOLLOWING: "neynar", FC_SOURCE_NOTIFICATIONS: "auto", FC_SOURCE_COUNTS: "neynar", FC_SOURCE_CHANNELS: "neynar" }));
  offAll("search typo", await answers({ FC_SOURCE_SEARCH: "neynr" }));
  const s = await answers({ FC_SOURCE_SEARCH: "neynar" });
  for (const op of ["search-casts", "search-users", "user"]) if (s.out[op].status !== 200) problems.push(`search=neynar: ${op} → ${s.out[op].status} ${JSON.stringify(s.out[op].body).slice(0, 80)}`);
  if (s.out.thread.status !== 404) problems.push(`search=neynar: a thread lookup → ${s.out.thread.status} (expected the lookup made: 404)`);
  if (s.out.discovery.body?.code !== "fc_source_off") problems.push("search=neynar opened discovery: " + JSON.stringify(s.out.discovery.body).slice(0, 80));
  if (s.fetched.some((f) => /\/feed\/\?/.test(f.url))) problems.push("search=neynar fetched discovery");
  const a = await answers({ FC_SOURCE_SEARCH: "auto" });
  if (a.out["search-casts"].status !== 200) problems.push("search=auto: search-casts → " + a.out["search-casts"].status);
  const f = await answers({ FC_SOURCE_FORYOU: "neynar" });
  if (f.out.discovery.status !== 200) problems.push("forYou=neynar: discovery → " + f.out.discovery.status);
  for (const op of ["search-casts", "search-users"]) if (f.out[op].body?.code !== "fc_source_off") problems.push(`forYou=neynar opened ${op}`);
  if (f.fetched.some((x) => /search/.test(x.url))) problems.push("forYou=neynar fetched a search");
  // and an unarmed relay with every switch on answers unarmed, at no cost
  for (const n of ENV_NAMES) delete process.env[n];
  Object.assign(process.env, { FC_SOURCE_SEARCH: "neynar", FC_SOURCE_FORYOU: "neynar" });
  relay.resetFcReadRelay();
  fetches.length = 0;
  const un = await quiet(() => relay.fcRead("search-casts", "fcsourceprobe", "local"));
  if (un.status !== 503 || un.body?.code !== "fc_read_unarmed" || fetches.length) problems.push("no key, search=neynar → " + un.status + " " + JSON.stringify(un.body) + " with " + fetches.length + " fetch(es)");
  assert(!problems.length, problems.slice(0, 8).join(" | "));
  return "default/network/hard-rule-only/typo: 6 ops off, 0 fetches; search=neynar|auto and forYou=neynar each open their own ops; no key → unarmed, 0 fetches";
});

// ---------------------------------------------------------------- S6
await check("S6", "THE RELAY NEVER RECEIVES A FID, A PERSONA OR A VISITOR LIST: a search is one GET of q and limit only; the path check refuses every other parameter; the op refuses non-strings and bad lengths; results pass the score floor", async () => {
  const problems = [];
  const r = await answers({ FC_SOURCE_SEARCH: "neynar" });
  const searches = r.fetched.filter((x) => /\/(cast|user)\/search\//.test(x.url));
  if (searches.length !== 2) problems.push(`${searches.length} search fetch(es) (expected 2)`);
  for (const x of searches) {
    const u = new URL(x.url);
    const names = [...u.searchParams.keys()].sort().join(",");
    if (names !== "limit,q") problems.push(`${u.pathname} carried ${names}`);
    if (u.searchParams.get("q") !== "fcsourceprobe") problems.push(`${u.pathname} q=${u.searchParams.get("q")}`);
    if (x.key !== KEY) problems.push("a search went without the key");
  }
  const casts = searches.find((x) => /cast\/search/.test(x.url));
  const users = searches.find((x) => /user\/search/.test(x.url));
  if (!casts || new URL(casts.url).searchParams.get("limit") !== "10") problems.push("the cast search limit is not 10");
  if (!users || new URL(users.url).searchParams.get("limit") !== "5") problems.push("the user search limit is not 5");
  // the normalised query is the cache key and the upstream q: case and spacing variants are ONE upstream read
  armWith({ FC_SOURCE_SEARCH: "neynar" });
  await quiet(async () => {
    await relay.fcRead("search-casts", "  Hello   World ", "local");
    await relay.fcRead("search-casts", "hello world", "local");
    await relay.fcRead("search-casts", "HELLO WORLD", "local");
  });
  const hw = fetches.filter((x) => /cast\/search/.test(x.url));
  if (hw.length !== 1 || new URL(hw[0].url).searchParams.get("q") !== "hello world") problems.push(`case/space variants made ${hw.length} upstream read(s): ${hw.map((x) => x.url).join(" ")}`);
  // the score floor: the low-score user never leaves
  const ul = r.out["search-users"].body?.value ?? [];
  if (!Array.isArray(ul) || ul.some((u) => u.fid === LOW.fid) || !ul.some((u) => u.fid === USERS[0].fid)) problems.push("the user search answer: " + JSON.stringify(ul).slice(0, 120));
  const keys = new Set(Object.keys(ul[0] ?? {}));
  for (const k of ["custody_address", "verifications", "viewer_context", "score"]) if (keys.has(k)) problems.push("a projected user carries " + k);
  // the path check, by name
  const P = (q) => relay.upstreamPathAllowed("search-casts", "/cast/search/?" + q);
  if (!P("q=x&limit=10")) problems.push("the one admitted search path is refused (the positive control)");
  for (const q of ["q=x&limit=10&viewer_fid=3", "q=x&limit=10&author_fid=3", "q=x&limit=10&fid=3", "q=x&limit=10&cursor=a", "q=x&limit=10&channel_id=art", "q=x&limit=10&parent_url=x", "q=x&limit=25", "limit=10", "q=x&q=y&limit=10", "q=x"]) {
    if (P(q)) problems.push("the path check admits /cast/search/?" + q);
  }
  if (relay.upstreamPathAllowed("search-users", "/user/search/?q=x&limit=5&viewer_fid=3")) problems.push("the user search admits viewer_fid");
  if (relay.upstreamPathAllowed("search-users", "/cast/search/?q=x&limit=10")) problems.push("the user search op admits the cast search path");
  // the op's argument rules: never anything but one query string
  armWith({ FC_SOURCE_SEARCH: "neynar" });
  const bad = [["an array of names", ["alice", "bob"]], ["an object with a fid", { q: "x", fid: 3 }], ["a number", 194], ["one character", "a"], ["65 characters", "x".repeat(65)], ["a control character", "ab\u0007cd"], ["nothing", undefined]];
  for (const [label, arg] of bad) {
    const a = await quiet(() => relay.fcRead("search-casts", arg, "local"));
    if (a.status !== 400 || a.body?.code !== "bad_op") problems.push(`${label} → ${a.status} ${JSON.stringify(a.body).slice(0, 60)}`);
  }
  if (fetches.length) problems.push(fetches.length + " fetch(es) for refused arguments");
  assert(!problems.length, problems.slice(0, 8).join(" | "));
  return "2 GETs, q+limit only; 1 upstream read for 3 spellings; the floor holds; 11 path shapes and 7 arguments refused, 0 fetches";
});

// ---------------------------------------------------------------- S7
await check("S7", "THE DEVICE'S OWN-ACCOUNT GUARD: a query naming an own handle, an own fname or an own fid is never sent; near misses are", async () => {
  const own = { names: ["alice", "@Bob_Two", "carol.eth", "dave.base.eth"], fids: [194, 3] };
  const named = ["alice", "@alice", "Alice", "posts by alice", "alice's thread", "bob_two", "@BOB_TWO hello", "carol.eth", "carol", "what did carol say", "dave.base.eth", "194", "fid 194", "3", "#3"];
  const notNamed = ["malice", "alicex", "alice2", "bob", "two", "1945", "123456", "caroline", "eth", "base"];
  const wrong = [];
  for (const q of named) if (!sw.queryNamesOwnAccount(q, own)) wrong.push("not caught: " + q);
  for (const q of notNamed) if (sw.queryNamesOwnAccount(q, own)) wrong.push("caught by mistake: " + q);
  if (sw.queryNamesOwnAccount("", own) || sw.queryNamesOwnAccount("alice", { names: [], fids: [] })) wrong.push("the empty cases");
  assert(!wrong.length, wrong.join(" | "));
  return `${named.length} own-account queries caught, ${notNamed.length} near misses sent`;
});

// ---------------------------------------------------------------- S8
await check("S8", "THE LABELS: the three words, each surface's label, and the UI sources that draw them", async () => {
  const problems = [];
  const L = sw.FC_SOURCE_LABELS;
  if (L.network !== "From Farcaster's network" || L.neynar !== "Via Neynar" || L.device !== "From your device") problems.push("the labels are " + JSON.stringify(L));
  const states = sw.allSurfaceStates({ FC_SOURCE_FORYOU: "neynar", FC_SOURCE_SEARCH: "neynar" }, true);
  const by = Object.fromEntries(states.map((s) => [s.surface, s.label]));
  const want = { following: "From Farcaster's network", notifications: "From Farcaster's network", forYou: "Via Neynar", search: "Via Neynar", counts: null, channels: null };
  for (const [k, v] of Object.entries(want)) if (by[k] !== v) problems.push(`${k}'s label is ${JSON.stringify(by[k])}`);
  const chip = src("components/SeededTimeline.tsx");
  if (!/s === "live"\s*\?\s*"Live from Farcaster · Via Neynar · read-only"/.test(chip) || !/data-via="neynar"/.test(chip)) problems.push("the relay chip does not say Via Neynar");
  for (const f of ["components/hub/HubFollowing.tsx", "components/hub/HubForYou.tsx"]) if (!/data-testid="feed-source" data-source="network"/.test(src(f))) problems.push(f + " carries no network source marker");
  if (!/data-testid="hub-notifs-coverage" data-source="network"/.test(src("components/hub/HubNotifications.tsx"))) problems.push("notifications carry no network source marker");
  const ns = src("components/search/NetworkSearchIsland.tsx");
  if (!/<SourceLabel source="neynar"/.test(ns) || !/· Via Neynar/.test(ns) || !/data-via="neynar"/.test(ns)) problems.push("the Neynar search section does not say Via Neynar on each result");
  if (!/<SourceLabel source="device"/.test(src("components/search/SearchResultsIsland.tsx"))) problems.push("device search does not say From your device");
  if (!/\{FC_SOURCE_LABELS\[source\]\}/.test(src("components/source/SourceLabel.tsx"))) problems.push("SourceLabel does not draw the shared labels");
  assert(!problems.length, problems.join(" | "));
  return "network / Via Neynar / device; 6 surface labels; chip, 3 hub feeds, Neynar search, device search";
});

// ---------------------------------------------------------------- S9
await check("S9", "THE WIRING, as source: hints spread, boot lines said, the network-search route guards and gates before the relay, no relay read of your own account, the Developer panel on both shapes", async () => {
  const problems = [];
  const de = src("lib/device/deviceEnv.server.ts");
  if (!/^\s*\.\.\.fcSourceDeviceHints\(process\.env\),\s*$/m.test(de)) problems.push("deviceEnv does not spread fcSourceDeviceHints(process.env)");
  const ins = src("instrumentation.ts");
  if (!/fcSourceBootLines\(process\.env, relayArmed\(\)\)/.test(ins) || !/for \(const w of fcSources\.warn\) console\.warn/.test(ins)) problems.push("the boot does not say the source lines");
  const route = src("app/api/search/network/route.ts");
  const iGate = route.indexOf('if (!deviceNeynarOn("search"))');
  const iGuard = route.indexOf("if (queryNamesOwnAccount(q, own))");
  const iRelay = route.indexOf("relaySearchCasts(q)");
  if (iGate < 0 || iGuard < 0 || iRelay < 0 || !(iGate < iGuard && iGuard < iRelay)) problems.push(`the network search route's order: gate ${iGate}, guard ${iGuard}, relay ${iRelay}`);
  if (!/catch \{\s*return NextResponse\.json\(\{ error: SEARCH_SENTENCES\.ownUnknown/.test(route)) problems.push("an unreadable own-account set does not refuse the send");
  const data = src("lib/data.ts");
  const m = /export async function getPublicSelfLiveSourced\([^)]*\)[^{]*\{([\s\S]*?)\n\}/.exec(data);
  if (!m || /relayUser|relayUserCasts|relayRead/.test(m[1]) || !/return null;/.test(m[1])) problems.push("data.ts reads the visitor's own account through the relay");
  if (!/relayLookups\(\) && isRelayHandleShape\(handle\)/.test(data) || !/if \(!relayLookups\(\)\) return false;/.test(data) || !/if \(relayForYou\(\) && !opts\.seedOnly/.test(data)) problems.push("data.ts does not gate the relay on the switch");
  const feed = src("lib/feed.ts");
  if (!/const relayWanted = relayArmedHere && deviceNeynarOn\("forYou"\);/.test(feed)) problems.push("feed.ts does not gate For You's relay base on the switch");
  const prof = src("app/api/profile/route.ts");
  if (!/code: "names_you"/.test(prof)) problems.push("live=1 does not answer names_you");
  if (/data-testid="show-my-posts"/.test(src("components/profile/ProfileIsland.tsx"))) problems.push("the retired button is still drawn");
  const dev = src("app/(main)/settings/developer/page.tsx");
  if ((dev.match(/\{sources\}/g) ?? []).length !== 2 || !/allSurfaceStates\(process\.env, armed\)/.test(dev)) problems.push("the Developer page does not render the sources panel on both shapes");
  // the relay route itself is unchanged: op and arg only (a fid, a persona or a list cannot ride along)
  const rr = src("app/api/fc/read/route.ts");
  if (!/keys\.some\(\(k\) => k !== "op" && k !== "arg"\)/.test(rr)) problems.push("the relay route no longer refuses every body key but op/arg");
  assert(!problems.length, problems.join(" | "));
  return "hints, boot, route order (gate → guard → relay), fail-closed guard, no own-account relay read, relay gates in data/feed, names_you, no button, the panel twice, op/arg only";
});

// ---------------------------------------------------------------- M
if (!MUTATIONS.length && ONLY.length === 0) {
  const SW = "lib/fc/source/switch.ts";
  const RL = "lib/fc/readRelay.server.ts";
  const runs = [
    ["Following dropped from the network-only set", "S2", [{ file: SW, find: 'new Set<FcSurface>(["following", "notifications", "counts"])', replace: 'new Set<FcSurface>(["notifications", "counts"])' }]],
    ["the server allows Neynar for any surface that asks", "S2", [{ file: SW, find: "  return FC_NEYNAR_CAPABLE.has(surface) && asksNeynar(askedSource(env, surface));", replace: "  return asksNeynar(askedSource(env, surface));" }]],
    ["the device asks for any surface with a hint", "S2", [{ file: SW, find: "  if (!FC_NEYNAR_CAPABLE.has(surface)) return false;\n  const v = String(env[FC_SOURCE_ENV[surface]] ?? \"\");\n  return (v === \"neynar\" || v === \"auto\") && env.FC_READ_RELAY === \"on\";", replace: "  const v = String(env[FC_SOURCE_ENV[surface]] ?? \"\");\n  return (v === \"neynar\" || v === \"auto\") && env.FC_READ_RELAY === \"on\";" }]],
    ["the refusal sentence loses its reason", "S2", [{ file: SW, find: "Following stays on Farcaster's network: read through Neynar, it would hand your account to Totem's server.", replace: "Following stays on Farcaster's network." }]],
    ["an unknown value read as neynar", "S1", [{ file: SW, find: "  return \"invalid\";\n}", replace: "  return \"neynar\";\n}" }]],
    ["the boot echoes an unknown value", "S1", [{ file: SW, find: "is not network, neynar or auto (a value of ${lengthClass(env, st.surface)} character(s)); it reads as network`", replace: "is not network, neynar or auto (${env[st.variable]}); it reads as network`" }]],
    ["no read key ignored (neynar with no relay reads as Neynar)", "S3", [{ file: SW, find: "    if (!relayArmed) return { ...base, effective: \"off\"", replace: "    if (false) return { ...base, effective: \"off\"" }]],
    ["the device ignores the relay hint", "S4", [{ file: SW, find: "  return (v === \"neynar\" || v === \"auto\") && env.FC_READ_RELAY === \"on\";\n}\n\n/** THE DEVICE: the hint asks", replace: "  return v === \"neynar\" || v === \"auto\";\n}\n\n/** THE DEVICE: the hint asks" }]],
    ["every surface forwarded as a hint", "S4", [{ file: SW, find: "  for (const s of [\"forYou\", \"search\"] as const) {", replace: "  for (const s of FC_SURFACES) {" }]],
    ["a server reads the device hint", "S4", [{ file: SW, find: "export function deviceNeynarOn(surface: FcSurface, env: Env = processEnv()): boolean {\n  if (typeof window === \"undefined\") return false;", replace: "export function deviceNeynarOn(surface: FcSurface, env: Env = processEnv()): boolean {" }]],
    ["the relay ignores the switch", "S5", [{ file: RL, find: "  if (!opSwitchedOn(parsed.op)) {", replace: "  if (false) {" }]],
    ["discovery opened by the search switch", "S5", [{ file: RL, find: '  discovery: ["forYou"],', replace: '  discovery: ["forYou", "search"],' }]],
    ["the searches opened by the For You switch", "S5", [{ file: RL, find: '  "search-casts": ["search"],', replace: '  "search-casts": ["search", "forYou"],' }]],
    // (the first occurrence of the anchor is UPSTREAM_PARAMS, the allowlist; REQUIRED_PARAMS repeats the two lines later)
    ["author_fid admitted on a search", "S6", [{ file: RL, find: '  "/cast/search/": ["q", "limit"],\n  "/user/search/": ["q", "limit"],\n};', replace: '  "/cast/search/": ["q", "limit", "author_fid"],\n  "/user/search/": ["q", "limit"],\n};' }, { file: RL, find: '"provider", "author_fid", "channel_id", "parent_url"]', replace: '"provider", "channel_id", "parent_url"]' }]],
    ["any search argument taken", "S6", [{ file: RL, find: "    return searchQueryAllowed(q) ? { op, q } : null;", replace: "    return { op, q: q || String(arg) };" }]],
    ["the query not normalised (spelling variants are separate reads)", "S6", [{ file: RL, find: "    const q = normaliseSearchQuery(arg);", replace: "    const q = arg.trim();" }]],
    ["the user search below the score floor", "S6", [{ file: RL, find: "        if (!admitted(cfg, u, new Map())) continue;\n        const p = projectUser(mapUser(u));", replace: "        const p = projectUser(mapUser(u));" }]],
    ["the guard does not check fids", "S7", [{ file: SW, find: "    if (Number.isInteger(f) && f > 0 && tokens.has(String(f))) return true;", replace: "" }]],
    ["the guard does not check names", "S7", [{ file: SW, find: "    if (tokens.has(n)) return true;", replace: "" }]],
    ["the guard matches inside words", "S7", [{ file: SW, find: "    if (tokens.has(n)) return true;", replace: "    if (text.includes(n)) return true;" }]],
    ["the Neynar label reworded", "S8", [{ file: SW, find: '  neynar: "Via Neynar",', replace: '  neynar: "Live",' }]],
    ["the relay chip says nothing of Neynar", "S8", [{ file: "components/SeededTimeline.tsx", find: '"Live from Farcaster · Via Neynar · read-only"', replace: '"Live from Farcaster · read-only"' }]],
    ["Following's source marker dropped", "S8", [{ file: "components/hub/HubFollowing.tsx", find: '<span data-testid="feed-source" data-source="network">', replace: "<span>" }]],
    ["the device hints not spread", "S9", [{ file: "lib/device/deviceEnv.server.ts", find: "    ...fcSourceDeviceHints(process.env),", replace: "" }]],
    ["the network search sends before the guard", "S9", [{ file: "app/api/search/network/route.ts", find: "  if (queryNamesOwnAccount(q, own)) {", replace: "  if (false && queryNamesOwnAccount(q, own)) {" }]],
    ["an unreadable own set sends anyway", "S9", [{ file: "app/api/search/network/route.ts", find: "  } catch {\n    return NextResponse.json({ error: SEARCH_SENTENCES.ownUnknown", replace: "  } catch {\n    own = { names: [], fids: [] };\n    void NextResponse.json({ error: SEARCH_SENTENCES.ownUnknown" }]],
    ["the visitor's own account read through the relay again", "S9", [{ file: "lib/data.ts", find: "  void fname;\n  return null;\n}", replace: "  const r = await relayUser(fname);\n  void r;\n  return null;\n}" }]],
    ["For You's relay base ignores the switch", "S9", [{ file: "lib/feed.ts", find: '  const relayWanted = relayArmedHere && deviceNeynarOn("forYou");', replace: "  const relayWanted = relayArmedHere;" }]],
  ];
  await check("M", "MUTATIONS: each guard removed in the bundle or the source read — the check that covers it FAILS (" + runs.length + " mutations)", async () => {
    const survived = [];
    for (const [label, target, muts] of runs) {
      const r = spawnSync(process.execPath, [SELF, "--only=" + target], {
        cwd: ROOT,
        env: { ...process.env, FCS_MUTATION: JSON.stringify(muts), FCS_UNIT_QUIET: "1" },
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

for (const [n, v] of Object.entries(saved)) {
  if (v === undefined) delete process.env[n];
  else process.env[n] = v;
}
globalThis.fetch = realFetch;
rmSync(tmp, { recursive: true, force: true });
if (MUTATIONS.length && applied.size !== MUTATIONS.length) {
  console.log("MUTATION FILE NOT READ: " + MUTATIONS.filter((m) => !applied.has(m)).map((m) => m.file).join(", "));
  process.exit(2);
}
const summary = `${passed}/${passed + failed} fc-source unit checks passed` + (failed ? ` — FAILED: ${failedIds.join(",")}` : "");
console.log((QUIET ? "" : "\n") + summary);
process.exit(failed ? 1 : 0);
