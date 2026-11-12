// FC-READ (house) — THE RELAY'S OWN CHECKS, CALLED DIRECTLY (review: house-pathcheck-untested).
//
// scripts/accept-fcread.mjs measures what the relay SENDS: the one discovery request it builds, on real side apps.
// That cannot see a REFUSAL — the relay only ever builds the one correct path — so an edit that weakened the house
// exception in upstreamPathAllowed (`pathname === HOUSE_PATH` loosened to a prefix, the fid pin dropped, the
// exemption opened for another op) would pass every end-to-end check while SECURITY-POSTURE.md §19 still called the
// control measured. This harness closes that gap. It bundles lib/fc/readRelay.server.ts with esbuild (the repo's own
// devDependency; `server-only` shimmed, the @/ paths from tsconfig.json) and calls, in-process, with no server, no
// socket and no key:
//   U1. upstreamPathAllowed — THE ONE admitted house path (positive control: without it every refusal is vacuous)
//   U2. every other following shape refused in house mode: another fid (and a leading-zero spelling of the house fid),
//       an added viewer_fid / cursor / provider, a doubled fid, a missing or wrong limit or with_recasts, a missing
//       fid, no trailing slash, a suffix, a doubled slash, a fragment, /feed/?feed_type=following, /notifications
//   U3. no following path at all in list mode (houseFid undefined), for any op
//   U4. a house fid never opens HOUSE_PATH for thread / user / user-casts, and in house mode discovery's /feed/ (the
//       other source's shape) is refused
//   U5. a house fid that is not one plain positive integer refuses outright, even on the exact path
//   U6. arming (relayArmed + fcRead): a malformed FC_READ_HOUSE_FID — zero, a leading zero, a sign, a decimal, an
//       exponent, hex, a list, a space-separated pair, a username, an @handle, 11 digits, non-ASCII digits — leaves
//       the relay bad_config with the log line naming FC_READ_HOUSE_FID and never the value, discovery 503
//       fc_read_unarmed, and ZERO upstream fetches
//   U7. arming: both sources set → bad_config naming both; neither → bad_config naming both; a blank (or
//       whitespace-only) FC_READ_HOUSE_FID counts as unset; a house fid padded with spaces arms
//   U8. armed, discovery reads EXACTLY the configured source's one request (a fake fetch records it): house mode →
//       <base>/feed/following/?fid=<FC_READ_HOUSE_FID>&with_recasts=false&limit=25 with the key header, once; list
//       mode → <base>/feed/?feed_type=filter&filter_type=fids&fids=<FC_READ_FIDS>&with_recasts=false&limit=25
//
//   node scripts/unit-fcread-relay.mjs          (npm run test:fcread-unit; accept-fcread check 25 runs it too)
//
// The env is set per case on THIS process only (a loopback NEYNAR_READ_BASE_URL + FC_READ_RIG=stub is the relay's
// test arming; no hosted-platform marker is ever set, so the base-URL override is honoured), and fetch is replaced by
// a recorder — nothing leaves the machine. The key is makeStubKey()'s fake one.
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { RELAY, makeStubKey } from "./lib/neynar-stub.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(ROOT, "package.json"));
const { build } = require("esbuild");

let passed = 0;
let failed = 0;
function ok(name, extra) {
  passed++;
  console.log(`  PASS  ${name}${extra ? " — " + extra : ""}`);
}
function fail(name, why) {
  failed++;
  console.log(`  FAIL  ${name} — ${why}`);
}
async function check(name, fn) {
  try {
    const extra = await fn();
    ok(name, typeof extra === "string" ? extra : undefined);
  } catch (e) {
    fail(name, e && e.message ? e.message : String(e));
  }
}

// ---------------------------------------------------------------- the module under test, bundled
const tmp = mkdtempSync(path.join(os.tmpdir(), "layers-fcread-unit-"));
let mod;
try {
  const shim = path.join(tmp, "server-only.mjs");
  writeFileSync(shim, "export {};\n");
  const out = path.join(tmp, "readRelay.mjs");
  await build({
    absWorkingDir: ROOT,
    entryPoints: [path.join(ROOT, "lib/fc/readRelay.server.ts")],
    outfile: out,
    bundle: true,
    format: "esm",
    platform: "node",
    target: ["node20"],
    tsconfig: path.join(ROOT, "tsconfig.json"),
    alias: { "server-only": shim },
    logLevel: "error",
  });
  mod = await import(pathToFileURL(out).href);
} catch (e) {
  console.log("cannot bundle lib/fc/readRelay.server.ts: " + (e && e.message ? e.message.split("\n")[0] : String(e)));
  rmSync(tmp, { recursive: true, force: true });
  process.exit(2);
}
rmSync(tmp, { recursive: true, force: true });
const { upstreamPathAllowed, relayArmed, fcRead, resetFcReadRelay } = mod;
for (const [n, f] of Object.entries({ upstreamPathAllowed, relayArmed, fcRead, resetFcReadRelay })) {
  if (typeof f !== "function") {
    console.log(`lib/fc/readRelay.server.ts no longer exports ${n} — this harness cannot run`);
    process.exit(2);
  }
}

console.log("\nFC-READ UNIT — the relay's own path check and arming, called in-process (no server, no socket)");

// the relay's paths are relative to its base (…/v2/farcaster); the stub's contract names the full path
const PREFIX = "/v2/farcaster";
const HOUSE_PATH = RELAY.house.path.slice(PREFIX.length); // "/feed/following/"
const FEED_PATH = RELAY.discovery.path.slice(PREFIX.length); // "/feed/"
const LIMIT = RELAY.house.params.limit; // "25", the relay's FEED_LIMIT as the stub pins it
const H = 990100; // a house fid (the stub's own synthetic house account)
const house = (q) => `${HOUSE_PATH}?${q}`;
const PINNED = `fid=${H}&with_recasts=false&limit=${LIMIT}`;
const FIDS_OK = `${FEED_PATH}?feed_type=filter&filter_type=fids&fids=3,1&with_recasts=false&limit=${LIMIT}`;

/** each [label, args, expected]; returns the labels whose answer differed */
function matrix(rows) {
  const wrong = [];
  for (const [label, args, expected] of rows) {
    let got;
    try {
      got = upstreamPathAllowed(...args);
    } catch (e) {
      got = "threw " + (e && e.message ? e.message : e);
    }
    if (got !== expected) wrong.push(`${label}: ${JSON.stringify(got)} (expected ${expected})`);
  }
  return wrong;
}

await check(`U1. THE ONE ADMITTED HOUSE PATH: discovery on ${HOUSE_PATH}?${PINNED} with houseFid=${H} is allowed (the positive control), and list mode's own /feed/ path still is`, async () => {
  const wrong = matrix([
    ["the pinned house request", ["discovery", house(PINNED), undefined, H], true],
    ["the same three parameters in another order", ["discovery", house(`limit=${LIMIT}&with_recasts=false&fid=${H}`), undefined, H], true],
    ["list mode's discovery path", ["discovery", FIDS_OK, undefined, undefined], true],
  ]);
  if (wrong.length) throw new Error(wrong.join(" | "));
  return "3 admitted";
});

await check("U2. EVERY OTHER FOLLOWING SHAPE IS REFUSED IN HOUSE MODE: another fid, a leading-zero spelling, viewer_fid, cursor, provider, a doubled fid, a wrong or missing limit / with_recasts / fid, no trailing slash, a suffix, a doubled slash, a fragment, /feed/?feed_type=following, /notifications", async () => {
  const rows = [
    ["another fid (3)", ["discovery", house(`fid=3&with_recasts=false&limit=${LIMIT}`), undefined, H]],
    ["the house fid + 1", ["discovery", house(`fid=${H + 1}&with_recasts=false&limit=${LIMIT}`), undefined, H]],
    ["a leading-zero spelling of the house fid", ["discovery", house(`fid=0${H}&with_recasts=false&limit=${LIMIT}`), undefined, H]],
    ["an added viewer_fid", ["discovery", house(`${PINNED}&viewer_fid=${H}`), undefined, H]],
    ["an added cursor", ["discovery", house(`${PINNED}&cursor=abc`), undefined, H]],
    ["an added provider", ["discovery", house(`${PINNED}&provider=x`), undefined, H]],
    ["an added unknown parameter", ["discovery", house(`${PINNED}&feed_type=filter`), undefined, H]],
    ["fid twice", ["discovery", house(`${PINNED}&fid=${H}`), undefined, H]],
    ["limit 26", ["discovery", house(`fid=${H}&with_recasts=false&limit=26`), undefined, H]],
    ["limit 100", ["discovery", house(`fid=${H}&with_recasts=false&limit=100`), undefined, H]],
    ["no limit", ["discovery", house(`fid=${H}&with_recasts=false`), undefined, H]],
    ["with_recasts=true", ["discovery", house(`fid=${H}&with_recasts=true&limit=${LIMIT}`), undefined, H]],
    ["no with_recasts", ["discovery", house(`fid=${H}&limit=${LIMIT}`), undefined, H]],
    ["no fid", ["discovery", house(`with_recasts=false&limit=${LIMIT}`), undefined, H]],
    ["no query at all", ["discovery", HOUSE_PATH, undefined, H]],
    ["no trailing slash", ["discovery", `/feed/following?${PINNED}`, undefined, H]],
    ["a suffix", ["discovery", `/feed/following/x?${PINNED}`, undefined, H]],
    ["a doubled slash", ["discovery", `/feed/following//?${PINNED}`, undefined, H]],
    ["a nested following path", ["discovery", `/feed/following/following/?${PINNED}`, undefined, H]],
    ["a fragment on the last value", ["discovery", house(`${PINNED}#x`), undefined, H]],
    ["/feed/?feed_type=following with the house fid", ["discovery", `${FEED_PATH}?feed_type=following&fid=${H}&with_recasts=false&limit=${LIMIT}`, undefined, H]],
    ["/feed/ with no feed_type (the following feed upstream)", ["discovery", `${FEED_PATH}?fid=${H}&with_recasts=false&limit=${LIMIT}`, undefined, H]],
    ["/notifications with the house fid", ["discovery", `/notifications?fid=${H}`, undefined, H]],
  ].map(([l, a]) => [l, a, false]);
  const wrong = matrix(rows);
  if (wrong.length) throw new Error(wrong.join(" | "));
  return `${rows.length} shape(s) refused`;
});

await check("U3. NO FOLLOWING PATH IN LIST MODE: with no house fid, the exact house request, /feed/following without the slash, /feed/?feed_type=following and /notifications are refused for every op", async () => {
  const rows = [];
  for (const op of ["discovery", "thread", "user", "user-casts"]) {
    rows.push([`${op}: the exact house request`, [op, house(PINNED), op === "user-casts" ? H : undefined, undefined], false]);
    rows.push([`${op}: /feed/following without the slash`, [op, `/feed/following?${PINNED}`, op === "user-casts" ? H : undefined, undefined], false]);
    rows.push([`${op}: /feed/?feed_type=following`, [op, `${FEED_PATH}?feed_type=following&fid=${H}&with_recasts=false&limit=${LIMIT}`, op === "user-casts" ? H : undefined, undefined], false]);
    rows.push([`${op}: /notifications`, [op, `/notifications?fid=${H}`, op === "user-casts" ? H : undefined, undefined], false]);
  }
  const wrong = matrix(rows);
  if (wrong.length) throw new Error(wrong.join(" | "));
  return `${rows.length} (op, shape) pair(s) refused`;
});

await check("U4. A HOUSE FID NEVER OPENS THE HOUSE PATH FOR ANOTHER OP, and in house mode discovery's /feed/ (the other source's shape) is refused", async () => {
  const rows = [
    ["thread on the house path", ["thread", house(PINNED), undefined, H], false],
    ["user on the house path", ["user", house(PINNED), undefined, H], false],
    ["user-casts on the house path (resolved fid = the house fid)", ["user-casts", house(PINNED), H, H], false],
    ["house mode: discovery on list mode's /feed/", ["discovery", FIDS_OK, undefined, H], false],
    // the other ops keep their own one path whatever houseFid says (the positive controls for this row)
    ["user-casts on its own path, the resolved fid", ["user-casts", `/feed/user/casts?fid=3&limit=10`, 3, H], true],
    ["user-casts on its own path, the house fid instead of the resolved one", ["user-casts", `/feed/user/casts?fid=${H}&limit=10`, 3, H], false],
    ["user on its own path", ["user", `/user/by_username?username=dwr`, undefined, H], true],
  ];
  const wrong = matrix(rows);
  if (wrong.length) throw new Error(wrong.join(" | "));
  return `${rows.filter((r) => r[2] === false).length} refused, ${rows.filter((r) => r[2] === true).length} own-path control(s) admitted`;
});

await check("U5. A HOUSE FID THAT IS NOT ONE PLAIN POSITIVE INTEGER REFUSES OUTRIGHT, even on the exact path carrying that same value", async () => {
  const rows = [];
  for (const bad of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53, 12345678901]) {
    rows.push([`houseFid ${bad}`, ["discovery", house(`fid=${bad}&with_recasts=false&limit=${LIMIT}`), undefined, bad], false]);
  }
  const wrong = matrix(rows);
  if (wrong.length) throw new Error(wrong.join(" | "));
  return `${rows.length} value(s) refused`;
});

// ---------------------------------------------------------------- arming, through the module's own exports
const KEY = makeStubKey();
const BASE = "http://127.0.0.1:9/v2/farcaster"; // loopback, never opened: fetch is replaced below
const RELAY_ENV = [
  "FC_READ", "NEYNAR_READ_API_KEY", "NEYNAR_READ_BASE_URL", "FC_READ_RIG", "FC_READ_FIDS", "FC_READ_HOUSE_FID",
  "FC_READ_DAILY_CREDITS", "FC_READ_MIN_SCORE", "FC_READ_DENY", "FC_READ_CHANNELS", "FC_SOURCE_FORYOU",
  // hosted-platform markers (lib/platform/env-contract.ts isHostedPlatform): with one set the loopback override disarms
  "RAILWAY_ENVIRONMENT", "RAILWAY_ENVIRONMENT_NAME", "RAILWAY_ENVIRONMENT_ID", "RAILWAY_PROJECT_ID", "RAILWAY_SERVICE_ID", "LAYERS_HOSTED",
];
const fetches = [];
globalThis.fetch = async (url, init) => {
  fetches.push({ url: String(url), method: init?.method, key: init?.headers?.["x-api-key"] });
  return new Response(JSON.stringify({ casts: [], next: { cursor: null } }), { status: 200, headers: { "content-type": "application/json" } });
};
const realLog = console.log;

/** one arming, from a clean relay state: returns what relayArmed said, the [fc-read] line(s), and discovery's answer */
async function arm(sources) {
  for (const n of RELAY_ENV) delete process.env[n];
  // NEYNAR AS A SWITCH (§42): discovery is answered only while the operator's FC_SOURCE_FORYOU asks for Neynar
  // (scripts/unit-fc-source.mjs measures the switch itself); this harness measures what the relay then SENDS
  Object.assign(process.env, { NEYNAR_READ_API_KEY: KEY, NEYNAR_READ_BASE_URL: BASE, FC_READ_RIG: "stub", FC_SOURCE_FORYOU: "neynar" }, sources);
  resetFcReadRelay();
  fetches.length = 0;
  const lines = [];
  console.log = (...a) => {
    const s = a.map(String).join(" ");
    if (s.startsWith("[fc-read]")) lines.push(s);
    else realLog(...a);
  };
  try {
    const armed = relayArmed();
    const status = await fcRead("status", undefined, "local");
    const discovery = await fcRead("discovery", undefined, "local");
    return { armed, lines, status, discovery, fetched: [...fetches] };
  } finally {
    console.log = realLog;
  }
}

function unarmedProblems(label, r, { line, values }) {
  const p = [];
  if (r.armed !== false) p.push(`${label}: relayArmed() said ${r.armed}`);
  if (r.status.status !== 200 || r.status.body?.armed !== false || r.status.body?.reason !== "bad_config") p.push(`${label}: status ${JSON.stringify(r.status.body)}`);
  if (r.discovery.status !== 503 || r.discovery.body?.code !== "fc_read_unarmed") p.push(`${label}: discovery → ${r.discovery.status} ${JSON.stringify(r.discovery.body)}`);
  if (r.fetched.length) p.push(`${label}: ${r.fetched.length} upstream fetch(es)`);
  const got = r.lines.filter((l) => l.startsWith("[fc-read] unarmed"));
  if (got.length !== 1 || got[0] !== line) p.push(`${label}: log ${JSON.stringify(r.lines)} (expected exactly ${JSON.stringify(line)})`);
  for (const v of values) if (r.lines.some((l) => l.includes(v))) p.push(`${label}: the log printed the value`);
  return p;
}

await check("U6. A MALFORMED FC_READ_HOUSE_FID → bad_config naming FC_READ_HOUSE_FID and never the value, discovery 503 fc_read_unarmed, ZERO upstream fetches — zero, a leading zero, a sign, a decimal, an exponent, hex, a list, a spaced pair, a username, an @handle, 11 digits, non-ASCII digits", async () => {
  // the positive control first: the same key, base and switch arm on a well-formed house fid
  const good = await arm({ FC_READ_HOUSE_FID: String(H) });
  if (good.armed !== true) throw new Error(`a well-formed FC_READ_HOUSE_FID did not arm (${JSON.stringify(good.lines)}) — every refusal below would be vacuous`);
  const LINE = "[fc-read] unarmed: bad_config (FC_READ_HOUSE_FID)";
  const cases = [
    ["zero", "0"], ["double zero", "00"], ["a leading zero", `0${H}`], ["a negative", "-1"], ["a plus sign", `+${H}`],
    ["a decimal", `${H}.5`], ["an exponent", "1e5"], ["hex", "0x1f"], ["a list", `${H},${H + 1}`], ["a spaced pair", `${H} ${H + 1}`],
    ["a username", "fcreadhousetypo"], ["an @handle", "@fcread-house"], ["11 digits", "12345678901"], ["non-ASCII digits", "٩٩٠"],
  ];
  const problems = [];
  for (const [label, value] of cases) {
    const r = await arm({ FC_READ_HOUSE_FID: value });
    // "0" and short values appear in any log by accident; the exact-line match above is the real no-value check
    problems.push(...unarmedProblems(label, r, { line: LINE, values: value.length >= 3 ? [value] : [] }));
  }
  if (problems.length) throw new Error(problems.join(" | "));
  return `positive control armed; ${cases.length} malformed value(s) → bad_config (FC_READ_HOUSE_FID), 0 fetches each`;
});

await check("U7. EXACTLY ONE SOURCE: both set → bad_config naming both; neither → bad_config naming both; a blank or whitespace-only FC_READ_HOUSE_FID is unset (list mode arms); a house fid padded with spaces arms", async () => {
  const problems = [];
  const both = await arm({ FC_READ_FIDS: "3,1", FC_READ_HOUSE_FID: String(H) });
  problems.push(...unarmedProblems("both set", both, { line: "[fc-read] unarmed: bad_config (FC_READ_FIDS and FC_READ_HOUSE_FID are both set; set exactly one)", values: ["3,1", String(H)] }));
  const neither = await arm({});
  problems.push(...unarmedProblems("neither set", neither, { line: "[fc-read] unarmed: bad_config (FC_READ_FIDS or FC_READ_HOUSE_FID: set exactly one)", values: [] }));
  const blanks = await arm({ FC_READ_FIDS: "", FC_READ_HOUSE_FID: "   " });
  problems.push(...unarmedProblems("both blank", blanks, { line: "[fc-read] unarmed: bad_config (FC_READ_FIDS or FC_READ_HOUSE_FID: set exactly one)", values: [] }));
  for (const [label, env] of [["a blank house fid beside a list", { FC_READ_FIDS: "3,1", FC_READ_HOUSE_FID: "" }], ["a whitespace-only house fid beside a list", { FC_READ_FIDS: "3,1", FC_READ_HOUSE_FID: " \t " }], ["a house fid padded with spaces", { FC_READ_HOUSE_FID: `  ${H}  ` }]]) {
    const r = await arm(env);
    if (r.armed !== true || r.status.body?.reason !== "armed") problems.push(`${label}: did not arm (${JSON.stringify(r.lines)})`);
  }
  if (problems.length) throw new Error(problems.join(" | "));
  return "both / neither / both blank → bad_config with 0 fetches; blank = unset; padded arms";
});

await check(`U8. ARMED, DISCOVERY READS EXACTLY THE CONFIGURED SOURCE'S ONE REQUEST: house → ${HOUSE_PATH}?fid=<FC_READ_HOUSE_FID>&with_recasts=false&limit=${LIMIT}; list → ${FEED_PATH}?feed_type=filter&filter_type=fids&fids=<FC_READ_FIDS>&…; one GET each with the key; the status body is the same three fields in both`, async () => {
  const problems = [];
  const h = await arm({ FC_READ_HOUSE_FID: String(H) });
  const wantH = `${BASE}${HOUSE_PATH}?fid=${H}&with_recasts=false&limit=${LIMIT}`;
  if (h.discovery.status !== 200) problems.push(`house: discovery → ${h.discovery.status} ${JSON.stringify(h.discovery.body)}`);
  if (h.fetched.length !== 1 || h.fetched[0].url !== wantH || h.fetched[0].method !== "GET" || h.fetched[0].key !== KEY) problems.push(`house: fetched ${JSON.stringify(h.fetched.map((f) => ({ ...f, key: f.key === KEY ? "<the key>" : "<other>" })))} (expected one GET ${wantH})`);
  const l = await arm({ FC_READ_FIDS: "3,1" });
  const wantL = `${BASE}${FEED_PATH}?feed_type=filter&filter_type=fids&fids=3,1&with_recasts=false&limit=${LIMIT}`;
  if (l.discovery.status !== 200) problems.push(`list: discovery → ${l.discovery.status} ${JSON.stringify(l.discovery.body)}`);
  if (l.fetched.length !== 1 || l.fetched[0].url !== wantL || l.fetched[0].method !== "GET" || l.fetched[0].key !== KEY) problems.push(`list: fetched ${JSON.stringify(l.fetched.map((f) => ({ ...f, key: f.key === KEY ? "<the key>" : "<other>" })))} (expected one GET ${wantL})`);
  const hs = JSON.stringify(h.status.body);
  const ls = JSON.stringify(l.status.body);
  if (hs !== ls || JSON.stringify(Object.keys(h.status.body ?? {})) !== JSON.stringify(RELAY.statusKeys)) problems.push(`the status bodies differ or carry other fields: house ${hs}, list ${ls}`);
  if (problems.length) throw new Error(problems.join(" | "));
  return `house: 1 GET …${HOUSE_PATH}?fid=${H}&with_recasts=false&limit=${LIMIT}; list: 1 GET …${FEED_PATH}?…fids=3,1…; status ${hs} in both`;
});

for (const n of RELAY_ENV) delete process.env[n];
console.log(`\n${passed}/${passed + failed} fc-read unit checks passed`);
process.exit(failed ? 1 : 0);
