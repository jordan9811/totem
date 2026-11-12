// CONNECT MAIN (BUILD B) — rig acceptance, FIXTURE network only. Connecting the owner's own Farcaster account by QR,
// end to end through the real routes, and the self-link guard at the write door. No request leaves the machine: on the
// laptop rig (no OWNER_ACCESS_SECRET) /api/fc/connect runs lib/fc/connect.ts's in-process fixture network, and every
// Farcaster write goes to the fixture sim. No spend.
//
//   0. availability: GET /api/fc/connect on the rig → fixture mode, the fixture connector configured
//   1. refusals before any signer: one of our own accounts as main (a persona's fid), a malformed handle, an unknown
//      account. (The shared test account, FC_RESERVED_FIDS and FC_ANON_FID come from the owner service's environment —
//      never from source, which ships publicly — so their refusals are covered by the unit harness, where the env is set.)
//   2. start → pending: an approval link of Farcaster's shape, a QR path, and NO signer uuid anywhere in the answer
//   3. the WRONG account approves → wrong_account, an honest note, finish refuses, nothing recorded
//   4. a doctored chain fact (requestFid = a persona's fid) → finish refuses, the session stops (refused), nothing recorded
//   5. the right account approves → poll approved → finish → connected; GET /api/fc/persona lists the record with origin
//      "connected" and the uuid redacted; identityProbe answers main's fid
//   6. posting as main through /api/fc/write goes out under main's fid (sim)
//   7. THE GUARD, both directions: main ↔ a persona with its own fid — reply, like, follow, mention — all 403
//   8. allowed: main ↔ a stranger's fixture cast; persona ↔ persona (the A-FID-SELF-GRAPH waiver stands)
//   9. fail closed: main replying to a cast nobody can attribute → 403
//  10. disconnect: main's writes refuse; the guard still keeps main apart
//  11. the page renders; no fixture signer uuid in any answer or in the validator's database in plaintext
//
//   node scripts/accept-connect-main.mjs        (rig: app :3001 + validator :4001, ZK_DEV_HOOKS=true, no owner secret)
import { existsSync } from "node:fs";
import { assertServersUp, isInfraError } from "./lib-health.mjs";

const BASE = process.env.BASE_URL || `http://localhost:${process.env.LAYERS_APP_PORT || 3001}`;
const DB_PATH = process.env.LAYERS_DB || "validator/layers.db";
const FIXTURE_UUID_RE = /fixture-[0-9a-f]{24}/;
const RUN = Date.now().toString(36).slice(-6);
const MAIN_USER = "fxmain-" + RUN; // a fresh fixture main per run (lib/fc/connect.ts fixture directory; an fname is ≤ 16 characters)
const SEED_MAIN = "persona_viewer_main";

const results = [];
const ok = (n) => {
  results.push(["PASS", n]);
  console.log("  PASS  " + n);
};
const fail = (n, d) => {
  const infra = isInfraError(d);
  results.push([infra ? "INFRA" : "FAIL", n, d]);
  console.log((infra ? "  INFRA " : "  FAIL  ") + n + (d ? " — " + d : ""));
};
async function check(name, fn) {
  try {
    await fn();
    ok(name);
  } catch (e) {
    fail(name, e.message);
  }
}
const answers = [];
async function api(method, url, body) {
  const r = await fetch(BASE + url, { method, headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  answers.push(text);
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: r.status, json, text };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function retry(fn, attempts = 4) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await fn();
      if (r.status >= 200 && r.status < 300) return r;
      last = new Error("status " + r.status + " " + (r.json?.error ?? JSON.stringify(r.json)?.slice(0, 200)));
    } catch (e) {
      last = e;
    }
    await sleep(250 * (i + 1));
  }
  throw last;
}
const connect = (body) => api("POST", "/api/fc/connect", body);
const write = (body) => api("POST", "/api/fc/write", body);
const persona = (action, extra = {}) => api("POST", "/api/fc/persona", { action, ...extra });
const dev = (action, extra = {}) => api("POST", "/api/dev", { action, ...extra });
const expect = (r, status, code, what) => {
  if (r.status !== status || (code && r.json?.code !== code)) throw new Error(`${what}: expected ${status}${code ? " " + code : ""}, got ${r.status} ${r.json?.code ?? ""} ${r.json?.error ?? ""}`);
};
const refusedAsSelfLink = (r, what) => {
  if (r.status !== 403 || !/must never interact|could not establish/.test(r.json?.error ?? "")) throw new Error(`${what}: expected a 403 self-link refusal, got ${r.status} ${r.json?.error ?? ""}`);
};

await assertServersUp(BASE);
await retry(() => dev("resetSeed"));

// the other own accounts: the seeded main persona with a fixture fid, and a minted public persona (a fork) with its own
const seedRec = (await retry(() => persona("acquire", { personaId: SEED_MAIN }))).json.record;
const forked = await retry(() => api("POST", "/api/identity/fork", { fromPersona: SEED_MAIN, carry: [], newHandle: "cm_pub_" + RUN }));
const PUB = forked.json.newPersona;
const pubRec = forked.json.newFid
  ? (await retry(() => api("GET", "/api/fc/persona"))).json.records.find((r) => r.personaId === PUB)
  : (await retry(() => persona("acquire", { personaId: PUB }))).json.record;

await check("0 the rig answers in FIXTURE mode with the fixture connector configured", async () => {
  const r = await retry(() => api("GET", "/api/fc/connect"));
  if (!r.json.available || r.json.mode !== "fixture" || !r.json.connector?.configured || !r.json.connector.fixture) throw new Error(JSON.stringify(r.json));
});

await check("1 refusals before any signer: a persona's fid, a malformed handle, an unknown account", async () => {
  if (!seedRec?.fid || !pubRec?.fid) throw new Error("setup: personas own no fixture fid");
  expect(await connect({ action: "start", handle: String(seedRec.fid) }), 403, "main_is_own_account", "seed persona's fid");
  expect(await connect({ action: "start", handle: String(pubRec.fid) }), 403, "main_is_own_account", "forked persona's fid");
  expect(await connect({ action: "start", handle: "not a handle!" }), 400, "bad_handle", "malformed");
  expect(await connect({ action: "start", handle: "nobody-at-all" }), 404, "no_such_account", "unknown");
});

let session = null;
await check("2 start → pending: Farcaster's approval link, a QR path, and no signer uuid in the answer", async () => {
  const r = await connect({ action: "start", handle: "@" + MAIN_USER });
  expect(r, 200, null, "start");
  session = r.json.session;
  if (!session || session.stage !== "pending_approval") throw new Error(JSON.stringify(r.json));
  if (!/^https:\/\/client\.farcaster\.xyz\/deeplinks\/signed-key-request\?token=0x[0-9a-f]+$/.test(session.approval?.url ?? "")) throw new Error("link " + session.approval?.url);
  if (!/^M\d+ \d+h\d+v1h-\d+z/.test(session.approval?.qr?.path ?? "")) throw new Error("no QR path");
  if (FIXTURE_UUID_RE.test(r.text) || /signerUuid/.test(r.text)) throw new Error("the signer uuid is in the answer");
});

await check("3 the WRONG account approves → wrong_account, finish refuses, nothing recorded", async () => {
  await retry(() => connect({ action: "fixtureApprove", sessionId: session.id, fid: 9200002 }));
  const p = await retry(() => connect({ action: "poll", sessionId: session.id }));
  if (p.json.session?.stage !== "wrong_account" || !/nothing was saved/.test(p.json.session.note ?? "")) throw new Error(JSON.stringify(p.json.session));
  expect(await connect({ action: "finish", sessionId: session.id }), 409, "not_approved", "finish");
  const g = await retry(() => api("GET", "/api/fc/connect"));
  if (g.json.connected) throw new Error("recorded");
});

await check("4 a doctored chain fact (requestFid = a persona's fid) → finish refuses, the session stops, nothing recorded", async () => {
  const s = await retry(() => connect({ action: "start", handle: MAIN_USER }));
  const id = s.json.session.id;
  await retry(() => connect({ action: "fixtureApprove", sessionId: id, requestFid: pubRec.fid }));
  await retry(() => connect({ action: "poll", sessionId: id }));
  expect(await connect({ action: "finish", sessionId: id }), 409, "chain_mismatch", "finish");
  const g = await retry(() => api("GET", "/api/fc/connect"));
  if (g.json.connected) throw new Error("recorded");
  if (g.json.session?.stage !== "refused" || !/Connected apps/.test(g.json.session.note ?? "")) throw new Error("session not stopped: " + JSON.stringify(g.json.session));
});

let MAIN = null;
let MAIN_FID = null;
await check("5 the right account approves → connected; the record is origin connected with the uuid redacted; identityProbe answers main", async () => {
  const s = await retry(() => connect({ action: "start", handle: MAIN_USER }));
  const id = s.json.session.id;
  await retry(() => connect({ action: "fixtureApprove", sessionId: id }));
  const p = await retry(() => connect({ action: "poll", sessionId: id }));
  if (p.json.session?.stage !== "approved") throw new Error("poll " + JSON.stringify(p.json.session));
  const f = await retry(() => connect({ action: "finish", sessionId: id }));
  MAIN = f.json.connected?.personaId;
  MAIN_FID = f.json.connected?.fid;
  if (!MAIN || !MAIN_FID || f.json.connected.disconnected) throw new Error(JSON.stringify(f.json));
  const view = await retry(() => api("GET", "/api/fc/persona"));
  const rec = view.json.records.find((r) => r.personaId === MAIN);
  if (rec && (rec.origin !== "connected" || rec.signer.uuid !== "<vault>" || rec.connected?.publicSelf !== true)) throw new Error(JSON.stringify(rec));
  const probe = await persona("identityProbe", { personaId: MAIN });
  if (probe.status !== 200 || probe.json.fid !== MAIN_FID) throw new Error("probe " + JSON.stringify(probe.json));
});

let mainCast = null;
await check("6 posting as main through the write door goes out under main's fid (sim)", async () => {
  const r = await retry(() => write({ action: "cast", text: "connect-main rig " + RUN, personaId: MAIN }));
  if (r.json.fid !== MAIN_FID || r.json.mode !== "fixture") throw new Error(JSON.stringify(r.json));
  mainCast = r.json.hash;
});

let pubCast = null;
await check("7 THE GUARD: main ↔ another own account — reply, like, follow, mention — refused both ways", async () => {
  pubCast = (await retry(() => write({ action: "cast", text: "a persona's cast " + RUN, personaId: PUB }))).json.hash;
  refusedAsSelfLink(await write({ action: "reply", text: "hi", parentHash: pubCast, personaId: MAIN }), "main replies to the persona");
  refusedAsSelfLink(await write({ action: "like", targetHash: pubCast, personaId: MAIN }), "main likes the persona");
  refusedAsSelfLink(await write({ action: "follow", targetFid: pubRec.fid, personaId: MAIN }), "main follows the persona");
  refusedAsSelfLink(await write({ action: "cast", text: "hey @" + pubRec.fname, personaId: MAIN }), "main mentions the persona");
  refusedAsSelfLink(await write({ action: "reply", text: "hi", parentHash: mainCast, personaId: PUB }), "the persona replies to main");
  refusedAsSelfLink(await write({ action: "like", targetHash: mainCast, personaId: SEED_MAIN }), "the seeded persona likes main");
  refusedAsSelfLink(await write({ action: "follow", targetFid: MAIN_FID, personaId: PUB }), "the persona follows main");
  refusedAsSelfLink(await write({ action: "cast", text: "gm @" + MAIN_USER, personaId: PUB }), "the persona mentions main");
});

await check("8 allowed: main ↔ a stranger's fixture cast; persona ↔ persona", async () => {
  await retry(() => write({ action: "like", targetHash: "0xa1b2c301", personaId: MAIN })); // fixture corpus, author 1000001
  await retry(() => write({ action: "follow", targetFid: 1000001, personaId: MAIN }));
  await retry(() => write({ action: "like", targetHash: pubCast, personaId: SEED_MAIN }));
});

await check("9 fail closed: main replying to a cast nobody can attribute → 403", async () => {
  refusedAsSelfLink(await write({ action: "reply", text: "hi", parentHash: "0xdeadbeef01", personaId: MAIN }), "unknown parent");
});

await check("10 disconnect: main's writes refuse; the guard still keeps main apart", async () => {
  expect(await connect({ action: "disconnect", confirm: "nope" }), 400, "confirm_required", "unconfirmed");
  const d = await retry(() => connect({ action: "disconnect", confirm: "DISCONNECT" }));
  if (!d.json.connected?.disconnected) throw new Error(JSON.stringify(d.json.connected));
  const w = await write({ action: "cast", text: "after disconnect " + RUN, personaId: MAIN });
  if (w.status !== 403 || !/disconnected/.test(w.json?.error ?? "")) throw new Error(`expected 403 disconnected, got ${w.status} ${w.json?.error}`);
  refusedAsSelfLink(await write({ action: "follow", targetFid: MAIN_FID, personaId: PUB }), "the persona follows main after the disconnect");
});

await check("11 the page renders; no fixture signer uuid in any answer, nor in the validator's database in plaintext", async () => {
  const page = await fetch(BASE + "/settings/connect");
  const html = await page.text();
  if (page.status !== 200 || !html.includes("Connect your Farcaster account")) throw new Error("page " + page.status);
  if (answers.some((t) => FIXTURE_UUID_RE.test(t))) throw new Error("a signer uuid appeared in an answer");
  if (existsSync(DB_PATH)) {
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(DB_PATH, { readOnly: true });
    try {
      for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all())
        for (const row of db.prepare(`SELECT * FROM "${name}"`).all()) if (FIXTURE_UUID_RE.test(JSON.stringify(row))) throw new Error("plaintext signer uuid in table " + name);
    } finally {
      db.close();
    }
  }
});

await retry(() => dev("resetSeed"));
const failedN = results.filter((r) => r[0] === "FAIL").length;
const infraN = results.filter((r) => r[0] === "INFRA").length;
console.log(`\n${results.length - failedN - infraN}/${results.length} passed${infraN ? `, ${infraN} infra` : ""}`);
process.exit(failedN ? 1 : infraN ? 2 : 0);
