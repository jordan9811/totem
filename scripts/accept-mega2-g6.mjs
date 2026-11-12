// MEGA PASS 2 — Gate 6 acceptance (fixture): RELATIONSHIP PORTING ON X (extends alt-linking).
//   1. A GRANT TO A LINKED COUNTERPART: the port issues the in-app disclosure grant and the counterpart's client
//      renders the merged identity; a stranger sees nothing
//   2. PENDING → RESOLVES ON LINK: a port to an X handle nobody has attested waits; when a persona attests that
//      handle the grant issues to them — the onboarding hook
//   3. BOTH LIKES SCHEDULED with a non-zero delay inside 3–12 s, from this root's two handles
//   4. RATE LIMIT: alt-links and ports share the daily cap; over-frequency is refused, not queued
//   5. PRIVATE PERSONA REFUSED, in either role
//   6. BOTH X ACCOUNTS MUST BE THIS ROOT'S: no second handle → refused; the counterpart must be someone else
//   7. FIXTURE ONLY: porting spends nothing and calls nothing; the port record is sealed in the vault and a pending
//      counterpart's handle appears nowhere in plaintext until THEY link it
//   8. THE FLOW renders the ports and their states
// Fixture, pinned ports, no network, no spend.
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { chromium } from "playwright";
import { assertServersUp, isInfraError } from "./lib-health.mjs";

const BASE = process.env.BASE_URL || `http://localhost:${process.env.LAYERS_APP_PORT || 3001}`;
const VBASE = process.env.VALIDATOR_URL || `http://localhost:${process.env.LAYERS_VALIDATOR_PORT || 4001}`;
const DB_PATH = process.env.LAYERS_DB || "validator/layers.db";
const MAIN = "persona_viewer_main";
const ALT = "persona_viewer_alt";
const COUNTERPART = "persona_acc_crypto_1";
const STRANGER = "persona_acc_food_1";
const NEWCOMER = "persona_acc_astro_1";
const NEWCOMER_HANDLE = "newcomer_x";
const results = [];
const ok = (n) => { results.push(["PASS", n]); console.log("  PASS  " + n); };
const fail = (n, d) => { const infra = isInfraError(d); results.push([infra ? "INFRA" : "FAIL", n, d]); console.log((infra ? "  INFRA " : "  FAIL  ") + n + (d ? " — " + d : "")); };
async function check(name, fn) { try { await fn(); ok(name); } catch (e) { fail(name, e.message); } }

await assertServersUp(BASE);
async function api(method, url, body, headers = {}) {
  const r = await fetch(BASE + url, { method, headers: { "content-type": "application/json", ...headers }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => null) };
}
async function vapi(p) {
  let last;
  for (let i = 0; i < 4; i++) {
    try { const r = await fetch(VBASE + p); return { status: r.status, json: await r.json().catch(() => null) }; }
    catch (e) { last = e; await sleep(300 * (i + 1)); }
  }
  throw new Error("INFRA: fetch failed for " + p + " (" + (last?.cause?.code ?? last?.message ?? "no cause") + ")");
}
async function retry(fn, attempts = 4) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try { const r = await fn(); if (r.status >= 200 && r.status < 300) return r; last = new Error("status " + r.status + " " + (r.json?.error ?? JSON.stringify(r.json)?.slice(0, 200))); }
    catch (e) { last = e; }
    await sleep(250 * (i + 1));
  }
  throw last;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dev = (action, extra = {}) => api("POST", "/api/dev", { action, ...extra });
const reset = () => retry(() => dev("resetSeed"));
const asViewer = (id) => ({ cookie: `layers_view_as=${id}` });
const linkAs = async (personaId, handle) => {
  const h = personaId === MAIN ? {} : asViewer(personaId);
  await retry(() => api("POST", "/api/x/link", { action: "begin" }, h));
  return (await retry(() => api("POST", "/api/x/link", { action: "link", fixtureHandle: handle }, h))).json;
};
const port = (body) => api("POST", "/api/x/port", body);
const ports = async () => (await retry(() => api("GET", "/api/x/port"))).json;
const linkedFor = async (personaId, viewer) => (await retry(() => api("GET", `/api/identity?personaId=${personaId}&viewerPersonaId=${viewer}`))).json?.identity?.linked;
const seedAccounts = JSON.parse(readFileSync("seed/data/accounts.json", "utf8"));
const seedList = [];
(function walk(o) { if (Array.isArray(o)) o.forEach(walk); else if (o && typeof o === "object") { if (o.handle && o.id) seedList.push(o); Object.values(o).forEach(walk); } })(seedAccounts);
const idOf = (h) => seedList.find((p) => p.handle === h)?.id;
const dbText = () => {
  const db = new DatabaseSync(DB_PATH, { readOnly: true });
  try {
    const out = [];
    for (const t of db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name)) for (const row of db.prepare(`SELECT * FROM "${t}"`).all()) out.push([t, JSON.stringify(row)]);
    return out;
  } finally { db.close(); }
};

await reset();
const stamp = Date.now().toString(36);
const forked = (await retry(() => api("POST", "/api/identity/fork", { fromPersona: idOf("brothandbones"), carry: [], newHandle: `ported_${stamp}` }))).json;
const PUB = forked.newPersona;
if (!PUB) { console.log("  INFRA  setup: fork produced no persona"); process.exit(2); }
await linkAs(MAIN, "main_handle_" + stamp.slice(-3));
await linkAs(PUB, "pub_handle_" + stamp.slice(-3));
await retry(() => api("POST", "/api/x/altlink", { action: "ackDisclaimer" }));
const TARGET = "1500000000000000001";

await check("1. A GRANT TO A LINKED COUNTERPART: the port issues the disclosure grant; the counterpart's client renders the merged identity; a stranger sees nothing", async () => {
  if (await linkedFor(PUB, COUNTERPART)) throw new Error("the counterpart already resolves the linkage before any port");
  const r = await port({ fromPersona: MAIN, toPersona: PUB, counterpart: { personaId: COUNTERPART }, targetPostId: TARGET });
  if (r.status !== 200) throw new Error("port refused: " + r.status + " " + JSON.stringify(r.json));
  const p = r.json.port;
  if (p.status !== "issued" || !p.grantId || !r.json.grant) throw new Error("no grant issued: " + JSON.stringify(p));
  if (!(await linkedFor(PUB, COUNTERPART))) throw new Error("the counterpart does not resolve the merged identity");
  if (await linkedFor(PUB, STRANGER)) throw new Error("a stranger resolves the linkage");
});

await check("2. PENDING → AN OFFER, NOT A GRANT: a port to an unattested X handle waits; proving the handle raises an offer that discloses nothing until the ISSUER confirms it", async () => {
  const r = await port({ fromPersona: MAIN, toPersona: PUB, counterpart: { handle: "@" + NEWCOMER_HANDLE }, targetPostId: TARGET });
  if (r.status !== 200 || r.json.port.status !== "pending" || r.json.port.grantId !== null) throw new Error("the port to an unlinked handle did not queue: " + r.status + " " + JSON.stringify(r.json).slice(0, 200));
  // the pending counterpart's handle is sealed — nowhere in plaintext until they link it themselves
  for (const [t, s] of dbText()) if (s.includes(NEWCOMER_HANDLE)) throw new Error(`${t} row carries the pending counterpart's handle in plaintext`);
  if (await linkedFor(PUB, NEWCOMER)) throw new Error("the newcomer resolves the linkage before linking");
  await linkAs(NEWCOMER, NEWCOMER_HANDLE);
  // POST-DEPLOY Gate 0: proving the handle earns an OFFER. Nothing is disclosed yet — that was the whole of
  // A-MEGA2-PORT-PENDING-TRUSTS-THE-HANDLE, and the 30-day lapse was its stopgap.
  const offered = (await ports()).ports.find((p) => p.counterpart.handle === NEWCOMER_HANDLE);
  if (!offered || offered.status !== "awaiting-confirmation" || offered.counterpart.personaId !== NEWCOMER) throw new Error("proving the handle did not raise an offer: " + JSON.stringify(offered));
  if (offered.grantId) throw new Error("an unconfirmed offer already carries a grant");
  if (await linkedFor(PUB, NEWCOMER)) throw new Error("the newcomer resolves the linkage before the issuer confirmed it");
  // the issuer's answer is what makes it real
  const conf = await port({ action: "confirm", portId: offered.id });
  if (conf.status !== 200 || conf.json?.port?.status !== "issued" || !conf.json?.port?.grantId) throw new Error("confirming the offer did not issue the grant: " + conf.status + " " + JSON.stringify(conf.json).slice(0, 160));
  if (!(await linkedFor(PUB, NEWCOMER))) throw new Error("the newcomer does not resolve the merged identity after the issuer confirmed");
  // and a second answer on a settled offer is refused rather than re-issuing
  const again = await port({ action: "confirm", portId: offered.id });
  if (again.status < 400) throw new Error("a settled offer accepted a second confirmation (" + again.status + ")");
});

await check("3. BOTH LIKES SCHEDULED with a non-zero delay inside 3–12 s, from this root's two handles", async () => {
  const all = (await ports()).ports;
  if (all.length < 2) throw new Error("expected two ports");
  for (const p of all) {
    if (!(p.delayMs >= 3000 && p.delayMs < 12000)) throw new Error("delay out of range: " + p.delayMs);
    if (p.likedAt[1] - p.likedAt[0] !== p.delayMs) throw new Error("the second like is not scheduled delay after the first");
    if (p.handles.length !== 2 || p.handles[0] === p.handles[1] || !p.handles[0].startsWith("main_handle") || !p.handles[1].startsWith("pub_handle")) throw new Error("the likes are not from this root's two handles: " + JSON.stringify(p.handles));
    if (!["scheduled", "completed"].includes(p.state)) throw new Error("state malformed");
  }
});

await check("4. RATE LIMIT: alt-links and ports share the daily cap; over-frequency is refused, not queued", async () => {
  const c = (await ports()).constants;
  const third = await port({ fromPersona: MAIN, toPersona: PUB, counterpart: { personaId: STRANGER }, targetPostId: TARGET });
  if (third.status !== 200) throw new Error("the third port within the cap was refused: " + JSON.stringify(third.json));
  const fourth = await port({ fromPersona: MAIN, toPersona: PUB, counterpart: { personaId: idOf("gwei_whisperer") }, targetPostId: TARGET });
  if (fourth.status !== 429 || fourth.json?.code !== "rate_limited") throw new Error(`the ${c.dailyCap + 1}th port was not refused as rate_limited: ` + fourth.status + " " + JSON.stringify(fourth.json));
  if ((await ports()).ports.length !== c.dailyCap) throw new Error("a refused port was queued");
});

await check("5. PRIVATE PERSONA REFUSED, in either role", async () => {
  const toPriv = await port({ fromPersona: MAIN, toPersona: ALT, counterpart: { personaId: COUNTERPART }, targetPostId: TARGET });
  if (toPriv.status !== 400 || !/private/.test(toPriv.json?.error ?? "")) throw new Error("porting TO a private persona was not refused by name: " + toPriv.status + " " + JSON.stringify(toPriv.json));
  const fromPriv = await port({ fromPersona: ALT, toPersona: PUB, counterpart: { personaId: COUNTERPART }, targetPostId: TARGET });
  if (fromPriv.status !== 400 || !/private/.test(fromPriv.json?.error ?? "")) throw new Error("porting FROM a private persona was not refused by name");
});

await check("6. BOTH X ACCOUNTS MUST BE THIS ROOT'S: no second handle → refused; the counterpart must be someone else", async () => {
  await reset();
  const f2 = (await retry(() => api("POST", "/api/identity/fork", { fromPersona: idOf("brothandbones"), carry: [], newHandle: `unlinked_${stamp}` }))).json;
  await linkAs(MAIN, "main_only_" + stamp.slice(-3));
  await retry(() => api("POST", "/api/x/altlink", { action: "ackDisclaimer" }));
  const noSecond = await port({ fromPersona: MAIN, toPersona: f2.newPersona, counterpart: { personaId: COUNTERPART }, targetPostId: TARGET });
  if (noSecond.status !== 400 || noSecond.json?.code !== "no_alt_handle") throw new Error("a port without a second linked handle was not refused: " + noSecond.status + " " + JSON.stringify(noSecond.json));
  await linkAs(f2.newPersona, "second_" + stamp.slice(-3));
  const self = await port({ fromPersona: MAIN, toPersona: f2.newPersona, counterpart: { personaId: MAIN }, targetPostId: TARGET });
  if (self.status !== 403 || self.json?.code !== "not_own") throw new Error("porting to one's own persona was not refused: " + self.status);
  const unknown = await port({ fromPersona: MAIN, toPersona: f2.newPersona, counterpart: { personaId: "persona_does_not_exist" }, targetPostId: TARGET });
  if (unknown.status !== 400) throw new Error("an unknown counterpart was not refused");
});

await check("7. FIXTURE ONLY: porting spends nothing and calls nothing; the port record is sealed in the vault", async () => {
  const spend = (await retry(() => api("GET", "/api/x/spend"))).json;
  if ((spend.entries ?? []).some((e) => /port/i.test(e.note ?? ""))) throw new Error("porting wrote to the spend ledger");
  const f3 = (await retry(() => api("POST", "/api/identity/fork", { fromPersona: idOf("brothandbones"), carry: [], newHandle: `sealed_${stamp}` }))).json;
  await linkAs(f3.newPersona, "third_" + stamp.slice(-3));
  const r = await port({ fromPersona: MAIN, toPersona: f3.newPersona, counterpart: { personaId: COUNTERPART }, targetPostId: TARGET });
  if (r.status !== 200) throw new Error("port failed: " + JSON.stringify(r.json));
  const st = (await vapi("/state")).json?.state ?? {};
  const ns = st.relationshipPorts ?? {};
  if (!Object.keys(ns).length) throw new Error("the relationshipPorts namespace is empty on the validator");
  for (const [k, v] of Object.entries(ns)) if (!(v && typeof v === "object" && typeof v.ct === "string")) throw new Error(`relationshipPorts/${k} is not ciphertext`);
  for (const [t, s] of dbText()) if (/port_[0-9a-f]{12}|targetPostId|1500000000000000001/.test(s)) throw new Error(`${t} row carries a port in plaintext`);
});

await check("8. THE FLOW renders the ports and their states", async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.goto(BASE + "/settings/porting", { waitUntil: "networkidle" });
    await page.locator("[data-testid='port-list']").waitFor({ timeout: 10000 });
    if (Number(await page.locator("[data-testid='port-list']").getAttribute("data-count")) < 1) throw new Error("no ports rendered");
    const first = page.locator("[data-testid='port']").first();
    if (!["issued", "pending"].includes((await first.getAttribute("data-status")) ?? "")) throw new Error("port status not rendered");
    if (!(await page.locator("[data-testid='port-submit']").count())) throw new Error("the flow's submit is missing");
  } finally {
    await browser.close();
  }
});

await reset();
const passed = results.filter((r) => r[0] === "PASS").length;
const failed = results.filter((r) => r[0] === "FAIL").length;
const infra = results.filter((r) => r[0] === "INFRA").length;
console.log(`\n${passed}/${results.length} Mega pass 2 Gate 6 (relationship porting) checks passed${failed || infra ? `, ${failed} FAILED, ${infra} infra` : ""}`);
process.exitCode = failed ? 1 : infra ? 2 : 0;
