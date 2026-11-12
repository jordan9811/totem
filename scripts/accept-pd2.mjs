// POST-DEPLOY PASS Gate 2 — PERSONA TINT + THE UNIFIED CROSS-PERSONA VIEW.
//
//   1. TINT IS PER PERSONA, AND NEVER ALONE: two personas of the same root render two different accents,
//      and every page that carries the wash also carries the persona PILL — the handle in text, at every
//      width. A colour that is the only cue is not a cue.
//   2. NEVER ON CONTENT: the wash is on the chrome (rails, header, tab bar) and on nothing else. Every
//      element carrying the class is a declared chrome element; no cast card carries it.
//   3. COLOURBLIND-SAFE BY MEASUREMENT: the assigned accents are simulated through deuteranopia and
//      protanopia and the closest pair is still separated. Asserted numerically, because a screenshot
//      needs a human to judge it and a suite does not have one.
//   4. MODE IS A SECOND CHANNEL: the border TREATMENT (solid/dashed/dotted/double) is derived from the
//      active mode, not from a constant — so persona and mode are readable at once, and the mode signal
//      survives greyscale on its own.
//   5. OFF BY DEFAULT, AT THE DATA LAYER: with the cross-persona view off, the search INDEX holds one
//      persona. Not a filtered wider index — the sibling's records are never read.
//   6. ON: RESULTS ACROSS PERSONAS, CORRECTLY ATTRIBUTED: every row names the persona that did it, and
//      the attribution matches that persona's real handle.
//   7. COMPARTMENT SUPPRESSES EVERY CROSS-PERSONA SURFACE: the search, the account switcher, the act-as
//      picker, and a sibling's stake history — all at the API. Turning the unified view on is refused
//      while it is held, and leaving it does not turn that view back on.
//   8. READ ONLY ACROSS PERSONAS: the unified view widens what you can SEE, never who you are. The
//      acting persona, and the actor's own log, stay the active persona.
//   9. TINT IS VAULT DATA: the personaChrome namespace is ciphertext on the validator, under one opaque
//      address, and no chosen colour appears anywhere in the DB in the clear.
//  10. NEVER FAIL OPEN: a corrupted chrome record is refused with a reason, not read as "no compartment,
//      no tints" — the sentence the module opens with, finally asserted rather than asserted about.
import { DatabaseSync } from "node:sqlite";
import { existsSync } from "node:fs";

const BASE = process.env.BASE_URL || `http://localhost:${process.env.LAYERS_APP_PORT || 3001}`;
const DB_PATH = process.env.LAYERS_DB || "validator/layers.db";
const results = [];
const ok = (n, extra) => { results.push(["PASS", n]); console.log("  PASS  " + n + (extra ? " — " + extra : "")); };
const fail = (n, d) => { results.push(["FAIL", n, d]); console.log("  FAIL  " + n + (d ? " — " + d : "")); };
async function check(name, fn) { try { const extra = await fn(); ok(name, typeof extra === "string" ? extra : undefined); } catch (e) { fail(name, e.message); } }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function retry(fn, attempts = 4) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try { const r = await fn(); if (r.status >= 200 && r.status < 300) return r; last = new Error("status " + r.status + " " + (r.json?.error ?? "")); }
    catch (e) { last = e; }
    await sleep(250 * (i + 1));
  }
  throw last;
}

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
async function html(path) {
  const headers = {};
  if (jar.size) headers.cookie = [...jar].map(([k, v]) => k + "=" + v).join("; ");
  const r = await fetch(BASE + path, { headers, cache: "no-store" });
  if (!r.ok) throw new Error(path + " answered " + r.status);
  return r.text();
}
/** every opening tag in the document, as raw text — enough to ask which tags carry a class */
const tags = (doc) => doc.match(/<[a-zA-Z][^>]*>/g) ?? [];
function attr(doc, testid, name) {
  const re = new RegExp('<[^>]*data-testid="' + testid + '"[^>]*>');
  const m = doc.match(re);
  if (!m) throw new Error('no element with data-testid="' + testid + '" in the document');
  const a = m[0].match(new RegExp(name + '="([^"]*)"'));
  return a ? a[1] : null;
}
function dbRows() {
  if (!existsSync(DB_PATH)) throw new Error("validator DB not found at " + DB_PATH);
  const d = new DatabaseSync(DB_PATH, { readOnly: true });
  try {
    const out = [];
    for (const t of d.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name)) {
      for (const row of d.prepare(`SELECT * FROM "${t}"`).all()) out.push([t, JSON.stringify(row)]);
    }
    return out;
  } finally { d.close(); }
}

// ---- colour science, so check 3 is a measurement and not an opinion --------
const srgbToLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const linearToSrgb = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(Math.max(c, 0), 1 / 2.4) - 0.055);
const hexToRgb = (h) => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
/** Viénot–Brettel–Mollon dichromat simulation, in linear sRGB */
const SIM = {
  normal: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
  deuteranopia: [[0.625, 0.375, 0], [0.7, 0.3, 0], [0, 0.3, 0.7]],
  protanopia: [[0.56667, 0.43333, 0], [0.55833, 0.44167, 0], [0, 0.24167, 0.75833]],
  tritanopia: [[0.95, 0.05, 0], [0, 0.43333, 0.56667], [0, 0.475, 0.525]],
};
/** the worst separation between two accents across every vision model */
const separation = (a, b) => Math.min(...Object.keys(SIM).map((k) => deltaE(toLab(simulate(a, k)), toLab(simulate(b, k)))));
function simulate(hex, kind) {
  const [r, g, b] = hexToRgb(hex).map(srgbToLinear);
  const m = SIM[kind];
  return [m[0][0] * r + m[0][1] * g + m[0][2] * b, m[1][0] * r + m[1][1] * g + m[1][2] * b, m[2][0] * r + m[2][1] * g + m[2][2] * b].map(linearToSrgb);
}
function toLab([r, g, b]) {
  const X = (0.4124 * srgbToLinear(r) + 0.3576 * srgbToLinear(g) + 0.1805 * srgbToLinear(b)) / 0.95047;
  const Y = 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
  const Z = (0.0193 * srgbToLinear(r) + 0.1192 * srgbToLinear(g) + 0.9505 * srgbToLinear(b)) / 1.08883;
  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}
const deltaE = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** the app's own modeEdgeOf, duplicated here on purpose: the suite must compute the
 *  expected treatment independently, or it only asserts that a constant is a constant */
const MODE_EDGES = ["solid", "dashed", "dotted", "double"];
function expectedEdge(modeId) {
  if (!modeId) return "solid";
  let h = 0;
  for (let i = 0; i < modeId.length; i++) h = (h * 31 + modeId.charCodeAt(i)) >>> 0;
  return MODE_EDGES[h % MODE_EDGES.length];
}

console.log("\nPost-deploy Gate 2 — persona tint + the unified cross-persona view (app " + BASE + ")");

// ---------------------------------------------------------------- setup ----
// The roster comes from the ACT-AS options, not /api/personas: those are the two
// identity tracks this codebase keeps re-finding, and the tint, the search scope
// and the persona switch all live in the seeded one. Asserting against the other
// would have been asserting against a roster nothing under test reads.
const roster = (await api("GET", "/api/personas/act-as-options")).json?.options ?? [];
if (roster.length < 2) { console.log("  ABORT: this device holds fewer than two personas — the gate is about telling them apart"); process.exit(2); }
const A = roster[0];
const B = roster[1];
const switcher0 = ((await api("GET", "/api/personas")).json?.personas ?? []).length;
const chrome0 = await api("GET", "/api/persona/chrome");
if (chrome0.status !== 200) { console.log("  ABORT: /api/persona/chrome answered " + chrome0.status + " " + JSON.stringify(chrome0.json)); process.exit(2); }
// leave the rig as we found it, whatever happens below
async function restore() {
  await api("POST", "/api/persona/chrome", { action: "compartment", on: false }).catch(() => {});
  await api("POST", "/api/persona/chrome", { action: "unified", on: false }).catch(() => {});
  await api("POST", "/api/seed-persona", { personaId: A.id }).catch(() => {});
}
await api("POST", "/api/persona/chrome", { action: "compartment", on: false });
await api("POST", "/api/persona/chrome", { action: "unified", on: false });
await retry(() => api("POST", "/api/seed-persona", { personaId: A.id }));

let tintA = null;
let tintB = null;
await check("1. TINT IS PER PERSONA, AND NEVER ALONE: two personas render two accents, and the pill is on every page that carries the wash", async () => {
  const homeA = await html("/home");
  tintA = attr(homeA, "persona-tint-root", "data-tint");
  const handleA = attr(homeA, "persona-tint-root", "data-persona-handle");
  if (!tintA || !/^#[0-9a-f]{6}$/.test(tintA)) throw new Error("no tint on the app chrome while acting as @" + A.handle + ": " + tintA);
  if (handleA !== A.handle) throw new Error("the tint scope names @" + handleA + " while acting as @" + A.handle);
  if (attr(homeA, "persona-pill", "data-persona-handle") !== A.handle) throw new Error("the persona pill does not name @" + A.handle);

  // a page that is NOT /home: the pill lives in the layout and the rail, never in a page,
  // so a page that forgot it cannot exist
  const other = await html("/notifications");
  if (!attr(other, "persona-tint-root", "data-tint")) throw new Error("/notifications carries the wash with no tint");
  if (attr(other, "persona-pill", "data-persona-handle") !== A.handle) throw new Error("/notifications carries the wash without the pill");

  await retry(() => api("POST", "/api/seed-persona", { personaId: B.id }));
  const homeB = await html("/home");
  tintB = attr(homeB, "persona-tint-root", "data-tint");
  if (attr(homeB, "persona-tint-root", "data-persona-handle") !== B.handle) throw new Error("switching persona did not move the tint scope");
  if (attr(homeB, "persona-pill", "data-persona-handle") !== B.handle) throw new Error("the pill did not follow the persona switch");
  if (tintA === tintB) throw new Error("both personas render the SAME accent (" + tintA + ") — the auto-assignment is not distinct");
  await retry(() => api("POST", "/api/seed-persona", { personaId: A.id }));
  return "@" + A.handle + " " + tintA + " · @" + B.handle + " " + tintB + ", pill present on both";
});

await check("2. NEVER ON CONTENT: every element carrying the wash is a declared chrome element, and no cast card is one", async () => {
  const doc = await html("/home");
  const washed = tags(doc).filter((t) => /class="[^"]*\bpersona-chrome\b/.test(t));
  if (washed.length < 2) throw new Error("the wash is on fewer than two chrome elements: " + washed.length);
  const undeclared = washed.filter((t) => !/data-chrome="/.test(t));
  if (undeclared.length) throw new Error("an element carries the wash without declaring itself chrome: " + undeclared[0].slice(0, 120));
  const casts = tags(doc).filter((t) => /data-testid="cast"/.test(t));
  if (!casts.length) throw new Error("no cast card rendered — this check would pass vacuously");
  const tinted = casts.filter((t) => /persona-chrome/.test(t));
  if (tinted.length) throw new Error("a cast card carries the wash: " + tinted[0].slice(0, 120));
  const kinds = [...new Set(washed.map((t) => (t.match(/data-chrome="([^"]*)"/) ?? [])[1]))];
  return washed.length + " chrome elements (" + kinds.join(", ") + "), " + casts.length + " cast cards, none tinted";
});

await check("3. COLOURBLIND-SAFE BY MEASUREMENT: EVERY pair in the palette stays separated under all four vision models", async () => {
  const r = await api("GET", "/api/persona/chrome");
  const palette = r.json?.palette ?? [];
  const assigned = (r.json?.tints ?? []).map((t) => t.color);
  if (palette.length < 4) throw new Error("the palette is too small to assert anything: " + JSON.stringify(palette));
  if (assigned.length < 2) throw new Error("fewer than two accents assigned: " + JSON.stringify(assigned));
  // the WHOLE palette, not just the pair in use: the owner can pick any two by hand,
  // and a pair that was never checked is a pair that was never safe
  const worstOf = (colors) => {
    const w = { kind: null, d: Infinity, pair: null };
    for (const kind of Object.keys(SIM)) for (let i = 0; i < colors.length; i++) for (let j = i + 1; j < colors.length; j++) {
      const d = deltaE(toLab(simulate(colors[i], kind)), toLab(simulate(colors[j], kind)));
      if (d < w.d) { w.d = d; w.kind = kind; w.pair = colors[i] + "/" + colors[j]; }
    }
    return w;
  };
  const wp = worstOf(palette);
  // CIE76 dE of ~12 is "obvious at a glance on adjacent chrome"; below ~5 is a coin flip
  if (wp.d < 12) throw new Error("under " + wp.kind + ", " + wp.pair + " collapse to dE " + wp.d.toFixed(1));
  const wa = worstOf(assigned);
  if (wa.d < 12) throw new Error("the ASSIGNED accents collide: " + wa.pair + " at dE " + wa.d.toFixed(1) + " under " + wa.kind);
  // and the belt: the cue is never the colour alone
  const doc = await html("/home");
  if (!attr(doc, "persona-pill", "data-persona-handle")) throw new Error("no non-colour signal on the page");
  return palette.length + " accents, closest pair dE " + wp.d.toFixed(1) + " under " + wp.kind + " (" + wp.pair + "); assigned closest " + wa.d.toFixed(1) + "; pill present";
});

await check("4. MODE IS A SECOND CHANNEL: the border treatment is derived from the active mode, not fixed", async () => {
  const doc = await html("/home");
  const edge = attr(doc, "persona-tint-root", "data-mode-edge");
  const modeId = attr(doc, "persona-tint-root", "data-mode-id");
  if (!MODE_EDGES.includes(edge)) throw new Error("the mode edge is not one of the four treatments: " + edge);
  if (!modeId) throw new Error("the chrome names no active mode, so the treatment cannot be tracking one");
  const want = expectedEdge(modeId);
  if (edge !== want) throw new Error("the treatment does not follow the mode: got " + edge + ", the mode id implies " + want);
  const headers = tags(doc).filter((t) => /class="[^"]*\bpersona-mode-edge\b/.test(t));
  if (!headers.length) throw new Error("nothing renders the mode edge");
  return edge + " for mode " + modeId.slice(0, 18) + ", on " + headers.length + " header(s)";
});

let soloIndexed = 0;
await check("5. OFF BY DEFAULT, AT THE DATA LAYER: the index itself holds one persona — not a wider index filtered at the end", async () => {
  const chrome = await api("GET", "/api/persona/chrome");
  if (chrome.json?.scope?.unified !== false) throw new Error("the cross-persona view is not off: " + JSON.stringify(chrome.json?.scope));
  const st = (await api("GET", "/api/search/unified?status=1")).json;
  if (!st?.scope) throw new Error("the search status reports no scope");
  if (st.scope.personaIds.length !== 1) throw new Error("the index spans " + st.scope.personaIds.length + " personas with the view off");
  if (st.scope.personaIds[0] !== A.id) throw new Error("the index is scoped to " + st.scope.personaIds[0] + ", not the active persona");
  soloIndexed = st.indexed;
  const browse = (await api("GET", "/api/search/unified?browse=1")).json;
  const hits = (browse?.groups ?? []).flatMap((g) => g.hits);
  if (!hits.length) throw new Error("the view returned nothing at all, so this check proves nothing");
  const strangers = hits.filter((h) => h.personaId !== A.id);
  if (strangers.length) throw new Error("a sibling's record is in the single-persona view: " + JSON.stringify(strangers[0]).slice(0, 140));
  return soloIndexed + " records, all @" + A.handle;
});

let unifiedIndexed = 0;
await check("6. ON: RESULTS ACROSS PERSONAS, EACH ONE ATTRIBUTED TO THE PERSONA THAT DID IT", async () => {
  const on = await retry(() => api("POST", "/api/persona/chrome", { action: "unified", on: true }));
  if (on.json?.scope?.unified !== true) throw new Error("the toggle did not take: " + JSON.stringify(on.json));
  const browse = (await api("GET", "/api/search/unified?browse=1&limit=200")).json;
  const hits = (browse?.groups ?? []).flatMap((g) => g.hits);
  unifiedIndexed = browse?.indexed ?? 0;
  const personas = [...new Set(hits.map((h) => h.personaId))];
  if (personas.length < 2) throw new Error("the cross-persona view still spans one persona: " + JSON.stringify(personas));
  if (!(unifiedIndexed > soloIndexed)) throw new Error("the index did not widen: " + soloIndexed + " → " + unifiedIndexed);
  const byId = new Map(roster.map((p) => [p.id, p.handle]));
  const wrong = hits.filter((h) => byId.has(h.personaId) && h.as !== byId.get(h.personaId));
  if (wrong.length) throw new Error("a row is attributed to the wrong persona: " + JSON.stringify(wrong[0]).slice(0, 140));
  const unattributed = hits.filter((h) => !h.as);
  if (unattributed.length) throw new Error(unattributed.length + " rows carry no attribution at all");
  return soloIndexed + " → " + unifiedIndexed + " records across " + personas.length + " personas, every row attributed";
});

await check("7. COMPARTMENT SUPPRESSES EVERY CROSS-PERSONA SURFACE, AT THE API", async () => {
  const on = await retry(() => api("POST", "/api/persona/chrome", { action: "compartment", on: true }));
  if (on.json?.scope?.compartment !== true) throw new Error("compartment mode did not take: " + JSON.stringify(on.json));
  if (on.json?.unified !== false) throw new Error("compartment mode left the cross-persona view on");

  const st = (await api("GET", "/api/search/unified?status=1")).json;
  if (st?.scope?.personaIds.length !== 1) throw new Error("the search index still spans " + st?.scope?.personaIds.length + " personas");
  if (!(st.indexed < unifiedIndexed)) throw new Error("the index did not narrow: " + unifiedIndexed + " → " + st.indexed);

  const actAs = (await api("GET", "/api/personas/act-as-options")).json;
  if ((actAs?.options ?? []).length !== 1) throw new Error("the act-as picker still offers " + actAs?.options?.length + " personas");
  if (actAs.options[0].id !== A.id) throw new Error("the act-as picker offers the wrong persona");
  if (!(roster.length > 1)) throw new Error("the picker held one persona before compartment mode too — this check would prove nothing");

  // the OTHER roster (the session track) narrows by the same chokepoint; on this rig it
  // already holds one persona, so the assertion is that it never GREW and never emptied
  const people = (await api("GET", "/api/personas")).json;
  const n = (people?.personas ?? []).length;
  if (n > switcher0) throw new Error("the account switcher grew under compartment mode: " + switcher0 + " → " + n);
  if (switcher0 > 0 && n === 0) throw new Error("compartment mode emptied the account switcher instead of narrowing it");

  const sib = await api("GET", "/api/influence?view=history&personaId=" + encodeURIComponent(B.id));
  if (sib.status !== 403 || sib.json?.code !== "compartment") throw new Error("a sibling's stake history answered " + sib.status + " " + JSON.stringify(sib.json).slice(0, 120));

  const tryOn = await api("POST", "/api/persona/chrome", { action: "unified", on: true });
  if (tryOn.status !== 409 || tryOn.json?.code !== "compartment") throw new Error("turning the cross-persona view on was not refused: " + tryOn.status);

  const off = await retry(() => api("POST", "/api/persona/chrome", { action: "compartment", on: false }));
  if (off.json?.scope?.unified !== false) throw new Error("leaving compartment mode turned the cross-persona view back ON — a scope you can leave by accident is not one");
  return "search " + unifiedIndexed + " → " + st.indexed + ", act-as " + roster.length + " → 1, switcher " + switcher0 + " → " + n + ", sibling history 403, toggle 409, leaving restores nothing";
});

await check("8. READ ONLY ACROSS PERSONAS: the unified view widens what you can SEE, never who you are", async () => {
  await retry(() => api("POST", "/api/persona/chrome", { action: "unified", on: true }));
  const log = await api("GET", "/api/eventlog");
  if (log.status !== 200) throw new Error("the actor's own log answered " + log.status);
  if (log.json?.actor !== A.id) throw new Error("the acting persona moved when the view widened: " + log.json?.actor);
  const strangers = (log.json?.events ?? []).filter((e) => e.actorPersonaId && e.actorPersonaId !== A.id);
  if (strangers.length) throw new Error("the actor's own log widened to a sibling: " + JSON.stringify(strangers[0]).slice(0, 120));
  const doc = await html("/home");
  if (attr(doc, "persona-tint-root", "data-persona-id") !== A.id) throw new Error("the chrome claims a different acting persona than the log");
  await retry(() => api("POST", "/api/persona/chrome", { action: "unified", on: false }));
  return "actor still @" + A.handle + " with the view on, log unwidened";
});

await check("9. TINT IS VAULT DATA: the chrome record is ciphertext under one opaque address, and no chosen colour is in the DB in the clear", async () => {
  try {
    return await tintVaultCheck();
  } finally {
    // restore whatever the run found, ALWAYS. A failed assertion used to leave a
    // chosen tint in the vault, and the next run then failed check 3 on state
    // this suite had created — a suite that dirties the rig on failure is a suite
    // that reports its own leftovers as product defects.
    await api("POST", "/api/persona/chrome", { action: "clearTint", personaId: B.id }).catch(() => {});
  }
});

async function tintVaultCheck() {
  // a colour far from every sibling's, CHOSEN by the suite's own colour maths
  // rather than hardcoded: this device holds four personas and the auto-assignment
  // had already taken the hardcoded one, so the product correctly refused it and
  // the suite read its own collision as a product failure
  const now = (await api("GET", "/api/persona/chrome")).json ?? {};
  const others = (now.tints ?? []).filter((t) => t.personaId !== B.id).map((t) => t.color);
  const pick = (now.palette ?? []).find((c) => !others.includes(c) && others.every((o) => separation(c, o) >= 12));
  if (!pick) throw new Error("no free accent left to test with: " + JSON.stringify(others));
  const set = await retry(() => api("POST", "/api/persona/chrome", { action: "tint", personaId: B.id, color: pick }));
  if (set.json?.tint?.color !== pick) throw new Error("the tint did not take: " + JSON.stringify(set.json).slice(0, 120));
  const bad = await api("POST", "/api/persona/chrome", { action: "tint", personaId: B.id, color: "puce" });
  if (bad.status !== 400) throw new Error("a malformed colour was accepted: " + bad.status);
  const notMine = await api("POST", "/api/persona/chrome", { action: "tint", personaId: "persona_not_mine_" + Date.now(), color: pick });
  if (notMine.status !== 403) throw new Error("a tint was set on a persona this device does not own: " + notMine.status);
  // the collision rule: a hand-picked colour that collapses onto a sibling's under
  // any vision model is refused, and the refusal names the model
  const aTint = ((await api("GET", "/api/persona/chrome")).json?.tints ?? []).find((t) => t.personaId === A.id);
  if (!aTint) throw new Error("the active persona has no accent to collide with");
  const collide = await api("POST", "/api/persona/chrome", { action: "tint", personaId: B.id, color: aTint.color });
  if (collide.status !== 409 || collide.json?.code !== "collides") throw new Error("a colliding colour was accepted: " + collide.status + " " + JSON.stringify(collide.json).slice(0, 140));

  const rows = dbRows();
  // the RECORDS live in adapter_state; envelope_counters legitimately names the
  // namespace (it counts signed writes per device) and holds no record at all,
  // so scoping the ciphertext assertion to the state table is the difference
  // between checking the record and checking the word
  const chromeRows = rows.filter(([t, s]) => t === "adapter_state" && s.includes("personaChrome"));
  if (!chromeRows.length) throw new Error("the personaChrome namespace never reached the validator state");
  for (const [t, s] of chromeRows) {
    const o = JSON.parse(s);
    const val = o.value ?? o.data ?? s;
    const parsed = typeof val === "string" ? (() => { try { return JSON.parse(val); } catch { return null; } })() : val;
    if (!parsed || typeof parsed !== "object" || !("ct" in parsed)) throw new Error("a personaChrome row is not ciphertext: " + t + " " + s.slice(0, 140));
    if (o.key && !["_", "__whole"].includes(o.key)) throw new Error("personaChrome is addressed by " + o.key + ", not one opaque key");
  }
  // THE NEEDLE KEEPS ITS "#", and the closing sweep is why.
  //
  // This searched for the bare six hex digits, and the validator's state is nine million
  // characters of hex ciphertext — so the expected number of chance occurrences of any given
  // six-hex needle is about one in two. The check passed by luck on a small database and
  // failed on a full one, reporting a leak that was never there. A needle that short in a
  // haystack that large is not a test, it is a coin.
  //
  // "#" never appears in hex, and "#rrggbb" is the form the product actually stores, so the
  // needle is now both meaningful and collision-free. The bare-hex case it was reaching for
  // is covered by the assertion above: every personaChrome row is ciphertext, and a bare hex
  // colour cannot be read out of a sealed record.
  const leaked = rows.filter(([t, s]) => t !== "envelope_counters" && s.toLowerCase().includes(pick.toLowerCase()));
  if (leaked.length) throw new Error("a chosen colour is in a validator row in the clear: " + leaked[0][0] + " " + leaked[0][1].slice(0, 120));
  return chromeRows.length + " sealed chrome row(s), " + rows.length + " rows scanned; malformed, not-own and colliding all refused";
}

await check("10. NEVER FAIL OPEN: a corrupted chrome record is REFUSED, not read as an empty one", async () => {
  // GATE 5 (attack-post-3 F-12): neither suite had a single unreadable-vault check, so
  // "never fail open" — the sentence both modules open with — was verified by nothing. The
  // rig's own tamper hook corrupts a sealed record; the claim is that every surface refuses
  // rather than answering as though the record said "no compartment, no tints".
  const before = (await api("GET", "/api/persona/chrome")).json;
  if (!before?.scope) throw new Error("the chrome route does not answer normally, so a refusal proves nothing");
  // the chrome record has to EXIST before it can be corrupted
  await retry(() => api("POST", "/api/persona/chrome", { action: "tint", personaId: A.id, color: "#536471" }));
  const tamper = await api("POST", "/api/dev", { action: "corruptVaultCiphertext", ns: "personaChrome" });
  if (tamper.status !== 200) {
    // the hook is rig-only; on a build without it this check cannot run, and saying so is
    // better than passing
    throw new Error("the corruptVaultCiphertext hook answered " + tamper.status + " — the fail-closed path is untested here");
  }
  // A process that has already decrypted the document does not re-read it, so the corruption
  // is invisible until the cache is cold. That is true of every sealed namespace and is worth
  // saying rather than hiding: tampering is caught at the next COLD read, not instantly.
  await retry(() => api("POST", "/api/dev", { action: "dropSealedCaches" }));
  try {
    const after = await api("GET", "/api/persona/chrome");
    if (after.status === 200)
      throw new Error("a corrupted chrome record answered 200 with " + JSON.stringify(after.json?.scope) + " — that is the fail-open this module exists to refuse");
    if (after.status !== 503) throw new Error("expected a 503 refusal, got " + after.status);
    if (!/vault|refus/i.test(String(after.json?.error ?? ""))) throw new Error("the refusal does not say why: " + JSON.stringify(after.json).slice(0, 140));
    return "corrupted record -> 503, reason stated";
  } finally {
    await api("POST", "/api/dev", { action: "resetSeed" });
  }
});

await restore();
const passed = results.filter((r) => r[0] === "PASS").length;
console.log(`\n${passed}/${results.length} Gate 2 checks passed${passed === results.length ? "" : ", " + (results.length - passed) + " FAILED"}`);
process.exit(passed === results.length ? 0 : 1);
