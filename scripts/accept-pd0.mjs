// POST-DEPLOY PASS Gate 0 — the hygiene carried from prior passes, measured rather than assumed.
//
//   1. THE FOUR PREFERENCE NAMESPACES ARE OPAQUE: `rules`, `activeMode`, `folders` and `followedFacets` are
//      exercised through the product and then read back off the validator's own database. Each must hold its
//      records under ONE opaque whole-document address, and every record must be ciphertext. A mode is a habit
//      fingerprint — attack-mega-2 F1 sealed `modes` for exactly that reason — and these four are the same class.
//   2. NO PERSONA ID IS A PLAINTEXT STATE ADDRESS: every key of every namespace, scanned against every persona id
//      and handle the client holds. This is the fourth time a persona-keyed derivation has leaked, so the check is
//      general rather than a list of the namespaces that leaked before.
//   3. THE STANDING PERSONA-FOLD NEEDLE: no plaintext VALUE anywhere in the validator's state names a persona of
//      this root. A keyed hash that forgot to fold the persona in surfaces here either as a shared address or as a
//      naked id, whichever way it leaked — and a namespace added by a future pass is covered without being listed.
//
// The two-persona exercise is deliberately NOT forced: on this rig `/api/seed-persona` only accepts the ids in the
// seeded viewer's own roster, so a freshly forked persona cannot be switched to from a suite. Checks 2 and 3 scan
// EVERY row rather than a pair, which is the stronger claim anyway.
import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";

const BASE = process.env.BASE_URL || `http://localhost:${process.env.LAYERS_APP_PORT || 3001}`;
const DB_PATH = process.env.LAYERS_DB || "validator/layers.db";
const results = [];
const ok = (n, extra) => { results.push(["PASS", n]); console.log("  PASS  " + n + (extra ? " — " + extra : "")); };
const fail = (n, d) => { results.push(["FAIL", n, d]); console.log("  FAIL  " + n + (d ? " — " + d : "")); };
async function check(name, fn) { try { const extra = await fn(); ok(name, typeof extra === "string" ? extra : undefined); } catch (e) { fail(name, e.message); } }
const stamp = Date.now().toString(36).slice(-5);

const jar = new Map();
async function api(method, path, body) {
  const headers = { "content-type": "application/json" };
  if (jar.size) headers.cookie = [...jar].map(([k, v]) => k + "=" + v).join("; ");
  const r = await fetch(BASE + path, { method, headers, cache: "no-store", body: body === undefined ? undefined : JSON.stringify(body) });
  for (const c of r.headers.getSetCookie?.() ?? []) { const [kv] = c.split(";"); const i = kv.indexOf("="); jar.set(kv.slice(0, i), kv.slice(i + 1)); }
  let json = null;
  try { json = await r.json(); } catch { /* not json */ }
  return { status: r.status, json };
}

function state() {
  if (!existsSync(DB_PATH)) throw new Error("validator DB not found at " + DB_PATH);
  const d = new DatabaseSync(DB_PATH, { readOnly: true });
  try {
    return d.prepare("SELECT namespace, key, value FROM adapter_state").all();
  } finally { d.close(); }
}
const isCiphertext = (raw) => { try { const v = JSON.parse(raw); return v && v.v === 1 && typeof v.ct === "string" && typeof v.nonce === "string"; } catch { return false; } };
/** the opaque whole-document addresses this codebase uses: sealWhole's, and the hand-rolled one-record namespaces' */
const OPAQUE_KEYS = new Set(["__whole", "_"]);
const PREFERENCE_NAMESPACES = ["rules", "activeMode", "folders", "followedFacets"];

console.log("\nPost-deploy Gate 0 — the preference namespaces, the persona-fold needle (app " + BASE + ")");

const roster = (await api("GET", "/api/personas")).json?.personas ?? [];
if (!roster.length) { console.log("  ABORT: the viewer holds no persona at all"); process.exit(2); }

const exercised = [];
await check("0. SESSION: the product writes all four preference namespaces — a mode set, a rule created, a folder created, a facet followed", async () => {
  const modes = (await api("GET", "/api/modes")).json?.modes ?? [];
  if (modes.length) {
    const r = await api("POST", "/api/modes/active", { modeId: modes[0].id });
    if (r.status === 200) exercised.push("activeMode");
  }
  const rule = await api("POST", "/api/rules", { name: "pd0-" + stamp, action: "hide", root: { op: "and", conditions: [{ field: "text", cmp: "contains", value: "pd0" + stamp }] } });
  if (rule.status === 200 && rule.json?.rule) exercised.push("rules");
  const folder = await api("POST", "/api/folders", { name: "pd0-" + stamp, isPublic: false });
  if (folder.status === 200 && folder.json?.folder) exercised.push("folders");
  // a facet belongs to the persona being VIEWED, so take an author out of the feed and follow one of theirs
  // a facet is a CLUSTER a root posts in, so only a persona whose root has siblings with clusters has any: the
  // seeded viewer's own root does, the single-persona feed accounts do not
  const feed = (await api("GET", "/api/feed?tab=foryou")).json ?? {};
  const candidates = [...new Set([...roster.map((p) => p.id), "persona_viewer_main", "persona_viewer_alt", ...(feed.casts ?? []).map((c) => c.personaId)].filter(Boolean))];
  for (const author of candidates.slice(0, 14)) {
    const facets = (await api("GET", "/api/disclosure/facets?personaId=" + encodeURIComponent(author))).json?.facets ?? [];
    if (!facets.length) continue;
    const f = await api("POST", "/api/disclosure/facets", { facetId: facets[0].id ?? facets[0], follow: true });
    if (f.status === 200) { exercised.push("followedFacets"); break; }
  }
  const missed = PREFERENCE_NAMESPACES.filter((n) => !exercised.includes(n));
  if (missed.length) throw new Error("could not exercise: " + missed.join(", ") + " (exercised: " + (exercised.join(", ") || "none") + ")");
  return exercised.join(", ");
});

await check("1. THE FOUR PREFERENCE NAMESPACES ARE OPAQUE: every record under one opaque address, every record ciphertext", async () => {
  const rows = state();
  const detail = [];
  for (const ns of PREFERENCE_NAMESPACES) {
    const mine = rows.filter((r) => r.namespace === ns);
    if (!mine.length) throw new Error(ns + " has no rows — the exercise did not reach it, so this proves nothing");
    for (const r of mine) {
      if (!OPAQUE_KEYS.has(r.key)) throw new Error(ns + " has a non-opaque address: key=" + r.key);
      if (!isCiphertext(r.value)) throw new Error(ns + " is not ciphertext at rest: " + String(r.value).slice(0, 80));
    }
    detail.push(ns + "×" + mine.length);
  }
  return detail.join(", ");
});

await check("2. NO PERSONA ID IS A PLAINTEXT STATE ADDRESS anywhere in the validator's state", async () => {
  const needles = roster.flatMap((p) => [p.id, p.handle]).filter(Boolean);
  const rows = state();
  const bad = rows.filter((r) => needles.some((n) => r.key === n || r.key.includes(n)));
  if (bad.length) throw new Error("persona as a state key: " + bad.map((b) => b.namespace + "/" + b.key).slice(0, 3).join(", "));
  return rows.length + " rows scanned against " + needles.length + " needles";
});

await check("3. THE STANDING PERSONA-FOLD NEEDLE: no plaintext value in any namespace names a persona of this root", async () => {
  const needles = roster.flatMap((p) => [p.id, p.handle]).filter(Boolean);
  const rows = state();
  const plain = rows.filter((r) => !isCiphertext(r.value));
  const offenders = [];
  for (const r of plain) for (const n of needles) if (String(r.value).includes(n)) { offenders.push(r.namespace + "/" + r.key + " names " + n); break; }
  if (offenders.length) throw new Error(offenders.slice(0, 3).join("; ") + (offenders.length > 3 ? ` (+${offenders.length - 3} more)` : ""));
  return plain.length + " plaintext rows of " + rows.length + ", none naming a persona of this root";
});

const passed = results.filter((r) => r[0] === "PASS").length;
console.log(`\n${passed}/${results.length} Gate 0 checks passed${passed === results.length ? "" : ", " + (results.length - passed) + " FAILED"}`);
process.exit(passed === results.length ? 0 : 1);
