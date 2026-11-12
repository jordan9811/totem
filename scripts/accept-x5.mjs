// PERSONA LAUNCH P2 (BYX v1) — the RIG suite for "Bring your X": the archive read in the page, sealed and chunked at
// rest, the keyless index built from a LOCAL stub, "N of the K people you follow on X are on Farcaster", the
// Farcaster-verified badge, and the honesty gate. Pinned rig pair (3001/4001, ZK_DEV_HOOKS=true).
//   R1  Settings → "Import from X" reaches /settings/import-x by soft navigation; the page says the archive FILE never
//       leaves the browser and the picked parts go to this service, sealed (review UX-10: never "nothing is uploaded")
//   R2  the REAL file input takes the synthetic ZIP (20 MB of junk media inside) → "We read @synth_yeak: 3,000 posts
//       (400 retweets, 600 replies), 1,000 people you follow, 1,000 likes"; nothing the page sent carried the archive's
//       email, phone or a DM, and the account it sent has exactly four keys
//   R3  the follow list needs the fingerprint warning: Import stays disabled until it is ticked, and the server refuses
//       a commit without it (409) — the same session then commits with it (so the refusal is not vacuous)
//   R4  commit → "Imported"; the profile shelf says 2,600 posts from X · 400 retweets hidden, original dates, no
//       retweet on the first page until "Show retweets"
//   R5  AT REST: the shelf / follows / archive pieces EXIST on the validator as ciphertext — then no tweet text, no raw
//       X id (followed or tweet), no email/phone/account id appears anywhere in the stored state; sessions carry names
//   R6  reload → the shelf is intact
//   R7  dropSealedCaches → the next read is COLD: a piece flipped on the validator (rig hook) leaves the cached shelf
//       showing, then after dropSealedCaches the profile says the history couldn't be read (never an empty shelf);
//       restored + dropped again → intact
//   R8  POST /x/fc-index/build against the LOOPBACK stub → meta rows = the planted rows; a non-loopback source refused
//   R9  before the index: "isn't available on this site yet" (no count); after: "7 of the 1,000 people you follow on X
//       are on Farcaster", 7 rows, external links rel=noopener
//   R11 the Farcaster-verified badge for the persona whose fixture fid the stub index lists: one click attests it
//       (method farcaster-verified), the badge reads "X @synth_yeak, verified on Farcaster · since …", and the shelf
//       — whose archive is that same X account — now reads "verified on Farcaster"
//   R12 honesty: a fixture link reads "test link, not verified"; sync says fixture, never live; the fixture conveniences
//       are offered (this is the rig) — the fixture link, the fixture archive, the X destination for a test-linked
//       persona, MigrationPanel: the vacuity half of the owner-service / empty-world absences (review W1-R5;
//       scripts/unit-x-v1.mjs G0f/G0g measure the absent half on the same predicate)
//   R13 sweep safety: the fixture-delivery knob is disarmed, every Farcaster ledger row is fixture, live spend $0
// Run: bash <scratchpad>/att-run.sh scripts/accept-x5.mjs   (or `npm run test:x5` against a running rig pair)
import { chromium } from "playwright";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { assertServersUp, isInfraError, pollUntil, retryContent } from "./lib-health.mjs";
import { PLANT, TWEET_CANARY, synthTweets, synthFollowing, synthIndexRows, writeSynthArchive } from "./lib/x-archive-synth.mjs";
import { startIndexStub } from "./lib/x-index-stub.mjs";

const BASE = process.env.BASE_URL || `http://localhost:${process.env.LAYERS_APP_PORT || 3001}`;
const VALIDATOR = process.env.VALIDATOR_URL || `http://localhost:${process.env.LAYERS_VALIDATOR_PORT || 4001}`;
const personas = JSON.parse(readFileSync("seed/data/accounts.json", "utf8")).personas;
const pid = (h) => personas.find((p) => p.handle === h)?.id;
const VIEWER = pid("yeak__");
const OTHER = pid("crustcritic");

const results = [];
const ok = (n, extra) => {
  results.push(["PASS", n]);
  console.log("  PASS  " + n + (extra ? " — " + extra : ""));
};
const fail = (n, d) => {
  const infra = isInfraError(d);
  results.push([infra ? "INFRA" : "FAIL", n, d]);
  console.log((infra ? "  INFRA " : "  FAIL  ") + n + (d ? " — " + d : ""));
};
async function check(name, fn) {
  try {
    const extra = await fn();
    ok(name, typeof extra === "string" ? extra : undefined);
  } catch (e) {
    fail(name, e.message);
  }
}

await assertServersUp(BASE, VALIDATOR);
const TMP = mkdtempSync(path.join(os.tmpdir(), "layers-x5-"));
const synth = writeSynthArchive(TMP, { seed: 7, junkMB: 20 });
const tweets = synthTweets(7);
const follows = synthFollowing(7);
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1600 } });
const page = await ctx.newPage();
const sent = [];
page.on("request", (r) => {
  const u = r.url();
  if (u.includes("/api/x/")) sent.push({ url: u, method: r.method(), body: r.postData() ?? "" });
});

async function api(method, url, body, base = BASE) {
  const res = await page.request.fetch(base + url, {
    method,
    headers: { "Content-Type": "application/json" },
    data: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try {
    json = JSON.parse(await res.text());
  } catch {}
  return { status: res.status(), json };
}
async function retry(fn, attempts = 4) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await fn();
      if (r.status >= 200 && r.status < 300) return r;
      last = new Error("status " + r.status + " " + (r.json?.error ?? ""));
    } catch (e) {
      last = e;
    }
    await page.waitForTimeout(250 * (i + 1));
  }
  throw last;
}
const reset = async () => {
  await api("POST", "/api/dev", { action: "resetSeed" });
  await page.waitForTimeout(400);
};
const viewAs = async (p) => {
  await api("POST", "/api/dev", { action: "viewAs", personaId: p });
  await page.waitForTimeout(100);
};
const profileShelf = async () => {
  await page.goto(BASE + "/yeak__", { waitUntil: "networkidle" });
  await pollUntil(async () => (await page.locator("[data-testid=imported-from-x]").count()) === 1, { tries: 25, delayMs: 400, midway: () => page.reload({ waitUntil: "networkidle" }) });
  return page.locator("[data-testid=imported-from-x]");
};
const fmt = (ms) => new Date(ms).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });

console.log("\nBring your X v1 (rig) — archive " + Math.round(synth.zipBytes / 1048576) + " MB with 20 MB of junk media");

// the stub index: the 7 planted follow matches, noise to make 3 pages, and (R11) the viewer's own fixture fid
const stubRows = synthIndexRows({ noise: 2400 });
const stub = await startIndexStub({ rows: stubRows });

await reset();
// the rig validator keeps its X index on disk across seed resets (it is public data, not seed state): start from
// "not built" so R9a measures the unavailable state, and leave it cleared at the end
const cleared = await api("POST", "/x/fc-index/clear", {}, VALIDATOR);
if (cleared.status !== 200) {
  console.log("  ABORT: the rig validator has no /x/fc-index/clear (" + cleared.status + ") — is it the rig (ZK_DEV_HOOKS=true) on this pass's code?");
  process.exit(2);
}
await viewAs(VIEWER);

// ---- R1 ----
await check("R1. Settings → 'Import from X' reaches /settings/import-x by SOFT navigation; the page says the archive file never leaves the browser and the picked parts go to this service, sealed", async () => {
  await page.goto(BASE + "/settings", { waitUntil: "networkidle" });
  const row = page.locator("[data-testid=settings-link-import-x]");
  await row.waitFor({ timeout: 30_000 });
  if (!/Import from X/.test(await row.innerText())) throw new Error("the row does not say Import from X");
  await page.evaluate(() => (window.__x5soft = 1));
  await row.click();
  await page.waitForURL((u) => new URL(u).pathname === "/settings/import-x", { timeout: 30_000 });
  if ((await page.evaluate(() => window.__x5soft)) !== 1) throw new Error("a full page load, not a soft navigation");
  // review UX-10: true words — the FILE never leaves; the picked parts go to this rig's server (savedBy "service")
  const local = page.locator("[data-testid=import-local-only]");
  await local.waitFor({ timeout: 30_000 });
  await pollUntil(async () => (await local.getAttribute("data-saved-by")) === "service", { tries: 30, delayMs: 300 });
  const t = (await local.innerText()).replace(/\s+/g, " ");
  if (!t.includes("The archive file never leaves this browser.") || !t.includes("Only the parts you pick below are sent to your service, which stores them sealed."))
    throw new Error("the local-only sentence reads: " + t);
  if (/Nothing is uploaded/.test(t)) throw new Error("the overstated 'Nothing is uploaded' is back");
  // the rig's identity lives on its server, never "only in this tab"
  if ((await page.locator("[data-testid=import-tab-only]").count()) !== 0) throw new Error("the rig's server-held identity was called tab-only");
});

// ---- R2 ----
await check("R2. the real file input takes the synthetic ZIP → the planted counts; nothing sent carried the email, phone or a DM", async () => {
  sent.length = 0;
  await page.setInputFiles("[data-testid=import-file]", synth.zipPath);
  await pollUntil(async () => (await page.locator("[data-testid=import-preview][data-source=page]").count()) === 1, { tries: 60, delayMs: 500 });
  const summary = await page.locator("[data-testid=import-summary]").innerText();
  for (const want of ["@synth_yeak", "3,000 posts (400 retweets, 600 replies)", "1,000 people you follow", "1,000 likes"])
    if (!summary.includes(want)) throw new Error(`summary lacks "${want}": ${summary}`);
  if ((await page.locator("[data-testid=lane-count-posts]").innerText()) !== "3000") throw new Error("posts lane count");
  const posted = sent.filter((s) => s.method === "POST");
  if (posted.length) throw new Error("the page sent something before Import was pressed: " + posted.map((p) => p.url).join(", "));
  return summary;
});

// ---- R3 ----
await check("R3. the follow list needs the warning: Import is disabled until it is ticked; the server refuses a commit without it, then takes the same session with it", async () => {
  if ((await page.locator("[data-testid=import-warning]").count()) !== 1) throw new Error("no fingerprint warning while the follow lane is on");
  const warn = await page.locator("[data-testid=import-warning]").innerText();
  if (!/a follow list is a fingerprint/.test(warn)) throw new Error("warning text: " + warn);
  if (!(await page.locator("[data-testid=import-commit]").isDisabled())) throw new Error("Import is enabled before the warning was acknowledged");
  // the server's own refusal, through the API (a session of a handful of posts)
  const b = await retry(() => api("POST", "/api/x/import", { action: "begin" }));
  const sid = b.json.sessionId;
  await retry(() => api("POST", "/api/x/import", { action: "account", sessionId: sid, account: { username: "synth_yeak", accountId: PLANT.account.accountId, displayName: "S", createdAt: null } }));
  await retry(() => api("POST", "/api/x/import", { action: "following", sessionId: sid, ids: follows.slice(0, 20), total: 20 }));
  const refused = await api("POST", "/api/x/import", { action: "commit", sessionId: sid, lanes: ["following"] });
  if (refused.status !== 409 || !/fingerprint/.test(refused.json?.error ?? "")) throw new Error("commit without the acknowledgement: " + refused.status + " " + JSON.stringify(refused.json));
  const discarded = await retry(() => api("POST", "/api/x/import", { action: "discard", sessionId: sid }));
  if (discarded.json.session.status !== "discarded") throw new Error("discard");
  await page.locator("[data-testid=import-ack-fingerprint]").check();
  if (await page.locator("[data-testid=import-commit]").isDisabled()) throw new Error("Import still disabled after the acknowledgement");
});

// ---- R4 ----
await check("R4. Import → 'Imported' (only on the commit's 200); the shelf: 2,600 posts from X · 400 retweets hidden, original dates, retweets only on request", async () => {
  await page.locator("[data-testid=import-commit]").click();
  await pollUntil(async () => (await page.locator("[data-testid=import-done], [data-testid=import-error]").count()) >= 1, { tries: 120, delayMs: 500 });
  if ((await page.locator("[data-testid=import-error]").count()) > 0) throw new Error("import error: " + (await page.locator("[data-testid=import-error]").innerText()));
  const landedPosts = await page.locator("[data-testid=landed-posts]").innerText();
  const landedFollowing = await page.locator("[data-testid=landed-following]").innerText();
  if (!landedPosts.includes("3,000 new") || !landedFollowing.includes("1,000 new")) throw new Error(`landed: ${landedPosts} / ${landedFollowing}`);
  // the page sent the parsed lanes only: no email, no phone, no DM, and an account of exactly four keys
  const bodies = sent.filter((s) => s.method === "POST").map((s) => s.body);
  const all = bodies.join("\n");
  if (all.includes(PLANT.account.email) || all.includes(PLANT.account.phoneNumber) || all.includes("a private DM")) throw new Error("the page sent archive content it must not");
  const acc = bodies.map((b) => JSON.parse(b)).find((b) => b.action === "account");
  if (!acc || JSON.stringify(Object.keys(acc.account).sort()) !== JSON.stringify(["accountId", "createdAt", "displayName", "username"])) throw new Error("account sent: " + JSON.stringify(acc?.account));
  const shelf = await profileShelf();
  if ((await shelf.getAttribute("data-state")) !== "ok") throw new Error("shelf state " + (await shelf.getAttribute("data-state")));
  const counts = page.locator("[data-testid=shelf-counts]");
  if ((await counts.getAttribute("data-total")) !== "3000" || (await counts.getAttribute("data-retweets")) !== "400") throw new Error("shelf counts " + (await counts.innerText()));
  const line = await counts.innerText();
  if (!line.includes("2,600 posts from X") || !line.includes("400 retweets hidden")) throw new Error("counts line: " + line);
  if ((await page.locator("[data-testid=imported-post][data-retweet=true]").count()) !== 0) throw new Error("a retweet on the default page");
  const firstShown = tweets.find((t) => !/^RT @/.test(t.tweet.full_text));
  const date = await page.locator("[data-testid=imported-post-date]").first().innerText();
  if (date !== fmt(Date.parse(firstShown.tweet.created_at))) throw new Error(`first date ${date}, want the original ${fmt(Date.parse(firstShown.tweet.created_at))}`);
  await page.locator("[data-testid=shelf-show-retweets]").click();
  await pollUntil(async () => (await page.locator("[data-testid=imported-post][data-retweet=true]").count()) > 0, { tries: 30, delayMs: 300 });
  return line + "; first date " + date;
});

// ---- R5 ----
await check("R5. AT REST: the X pieces exist on the validator as ciphertext — and the stored state carries no tweet text, raw X id, email, phone or account id; sessions carry file NAMES only", async () => {
  const st = await retryContent(() => api("GET", "/state", undefined, VALIDATOR), (r) => r.status === 200 && r.json?.state, 4);
  const state = st.json.state;
  const pieces = Object.entries(state).filter(([ns]) => /^x(Shelf|Follows|Archive)\.(m|g[01]\.\d+)$/.test(ns));
  const names = pieces.map(([ns]) => ns);
  for (const want of ["xShelf.m", "xFollows.m", "xArchive.m"]) if (!names.includes(want)) throw new Error("missing " + want + " among " + names.join(","));
  if (names.filter((n) => n.startsWith("xShelf.g")).length < 8) throw new Error("the shelf is not chunked: " + names.join(","));
  for (const [ns, entries] of pieces) {
    const w = entries.__whole;
    if (!w || typeof w.ct !== "string" || Object.keys(entries).length !== 1) throw new Error(ns + " is not one sealed record");
  }
  const text = JSON.stringify(state);
  if (text.includes(TWEET_CANARY)) throw new Error("tweet text at rest");
  // VERIFY (wave 2): name WHERE a hit is (the namespace and the characters around it), so a failure says whether the id
  // sits in plaintext or inside a hex ciphertext by chance
  const where = (needle) => {
    for (const [ns, v] of Object.entries(state)) {
      const s = JSON.stringify(v);
      const i = s.indexOf(needle);
      if (i >= 0) return ns + " …" + s.slice(Math.max(0, i - 24), i + needle.length + 24) + "…";
    }
    return "?";
  };
  // PUBLIC GO-LIVE (final verify): a digit string INSIDE a hex ciphertext run is chance, not an id at rest. Closing sweep 3 of
  // 2026-10-19 failed here on "9615352" inside "…1587d86096153522fa…" of xShelf's sealed bytes: a 7-digit follow id turns up
  // in ~1 MB of random hex now and then. A hit counts unless the whole run of hex characters around it is 64 or longer (a
  // sealed blob); a plaintext id is a JSON value or key, its own short run. Both halves are asserted on planted text first,
  // so this rule can never pass vacuously.
  const plainHit = (hay, needle) => {
    for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + 1)) {
      let a = i, b = i + needle.length;
      while (a > 0 && /[0-9a-f]/.test(hay[a - 1])) a--;
      while (b < hay.length && /[0-9a-f]/.test(hay[b])) b++;
      if (b - a < 64) return true;
    }
    return false;
  };
  const blob = "ab".repeat(20) + "9615352" + "cd".repeat(20);
  if (!plainHit(JSON.stringify({ follows: ["9615352"] }), "9615352") || !plainHit(JSON.stringify({ k: "x9615352" }), "9615352") || !plainHit(JSON.stringify({ ct: blob, id: 9615352 }), "9615352")) throw new Error("the at-rest rule misses a planted plaintext id");
  if (plainHit(JSON.stringify({ ct: blob }), "9615352")) throw new Error("the at-rest rule counts an id inside a 64+ hex run");
  for (const id of follows) if (plainHit(text, id)) throw new Error("a raw followed X id at rest: " + id + " in " + where(id));
  for (const t of tweets.slice(0, 300)) if (plainHit(text, t.tweet.id_str)) throw new Error("a raw tweet id at rest");
  for (const s of [PLANT.account.email, PLANT.account.phoneNumber, PLANT.account.accountId]) if (plainHit(text, s)) throw new Error("account facts at rest");
  const sum = await retry(() => api("GET", "/api/x/import?view=summary"));
  for (const s of sum.json.sessions) {
    if (!Array.isArray(s.files) || s.files.some((f) => typeof f !== "string" || f.length > 80 || !/\.js$/.test(f))) throw new Error("a session carries more than file names: " + JSON.stringify(s.files).slice(0, 200));
    if ("content" in s || "posts" in s) throw new Error("a session carries content");
  }
  return pieces.length + " sealed pieces; state " + text.length + " chars, " + (text.match(/[0-9a-f]{64,}/g) ?? []).reduce((a, x) => a + x.length, 0) + " of them in hex runs";
});

// ---- R6 ----
await check("R6. reload → the shelf is intact", async () => {
  await page.reload({ waitUntil: "networkidle" });
  const shelf = await profileShelf();
  if ((await shelf.getAttribute("data-state")) !== "ok") throw new Error("state");
  if ((await page.locator("[data-testid=shelf-counts]").getAttribute("data-total")) !== "3000") throw new Error("total");
});

// ---- R7 ----
await check("R7. dropSealedCaches makes the next read COLD: a flipped piece is invisible to the cached shelf, then refused after the drop (an error, never an empty shelf); restored → intact", async () => {
  const st = (await retry(() => api("GET", "/state", undefined, VALIDATOR))).json.state;
  const live = Object.keys(st).find((ns) => /^xShelf\.g[01]\.0$/.test(ns));
  if (!live) throw new Error("no live shelf piece");
  await retry(() => api("POST", "/api/x/import", { action: "devTamperChunk", ns: live }));
  try {
    let shelf = await profileShelf();
    if ((await shelf.getAttribute("data-state")) !== "ok") throw new Error("the cached shelf should still show before the drop");
    await retry(() => api("POST", "/api/dev", { action: "dropSealedCaches" }));
    shelf = await profileShelf();
    await pollUntil(async () => (await shelf.getAttribute("data-state")) === "error", { tries: 10, delayMs: 300, midway: () => page.reload({ waitUntil: "networkidle" }) });
    if ((await shelf.getAttribute("data-state")) !== "error") throw new Error("after dropSealedCaches the shelf did not re-read (the cache answered)");
    const err = await page.locator("[data-testid=shelf-error]").innerText();
    if (!/couldn.t be read/.test(err) || !/nothing was changed/.test(err)) throw new Error("error text: " + err);
  } finally {
    await retry(() => api("POST", "/api/x/import", { action: "devRestoreChunk", ns: live }));
    await retry(() => api("POST", "/api/dev", { action: "dropSealedCaches" }));
  }
  const shelf = await profileShelf();
  await pollUntil(async () => (await shelf.getAttribute("data-state")) === "ok", { tries: 10, delayMs: 300, midway: () => page.reload({ waitUntil: "networkidle" }) });
  if ((await page.locator("[data-testid=shelf-counts]").getAttribute("data-total")) !== "3000") throw new Error("not intact after the restore");
});

// ---- R9 (before) ----
await check("R9a. before any index: the people panel says the list isn't available on this site — no count, no '0 matches'", async () => {
  await page.goto(BASE + "/settings/import-x", { waitUntil: "networkidle" });
  await pollUntil(async () => (await page.locator("[data-testid=x-people-unavailable], [data-testid=x-people-sentence]").count()) >= 1, { tries: 30, delayMs: 400 });
  if ((await page.locator("[data-testid=x-people-sentence]").count()) !== 0) throw new Error("a count was shown without an index");
  const t = await page.locator("[data-testid=x-people-unavailable]").innerText();
  if (!/isn.t available on this site yet/.test(t) || /0 of/.test(t)) throw new Error("unavailable text: " + t);
});

// ---- R11 setup + R8 ----
let ownFid = null;
await check("R8. the index builds from the LOOPBACK stub (the viewer's fixture fid included) → meta rows = the planted rows; a non-loopback source is refused", async () => {
  const recs = (await retry(() => api("GET", "/api/fc/persona"))).json.records ?? [];
  let rec = recs.find((r) => r.personaId === VIEWER);
  if (!rec) rec = (await retry(() => api("POST", "/api/fc/persona", { action: "acquire", personaId: VIEWER }))).json.record;
  ownFid = rec?.fid;
  if (!Number.isInteger(ownFid)) throw new Error("no fixture fid for the viewer");
  stub.stub.addRow({ fid: ownFid, platform: "x", platformId: PLANT.account.accountId, platformUsername: PLANT.account.username, verifiedAt: Math.floor(Date.UTC(2025, 5, 1) / 1000), fname: "" });
  const refused = await api("POST", "/x/fc-index/build", { sourceUrl: "https://api.farcaster.xyz", fnamesUrl: "https://fnames.farcaster.xyz" }, VALIDATOR);
  if (refused.status !== 400) throw new Error("a real source was not refused: " + refused.status);
  const built = await api("POST", "/x/fc-index/build", { sourceUrl: stub.url, fnamesUrl: stub.url, minIntervalMs: 50 }, VALIDATOR);
  if (built.status !== 200) throw new Error("build: " + built.status + " " + JSON.stringify(built.json));
  const planted = stubRows.length + 1;
  if (built.json.meta.rows !== planted) throw new Error(`meta rows ${built.json.meta.rows}, planted ${planted}`);
  const meta = (await retry(() => api("GET", "/x/fc-index/meta", undefined, VALIDATOR))).json;
  if (!meta.available || meta.rows !== planted) throw new Error("meta " + JSON.stringify(meta));
  return planted + " rows, " + meta.bytes + " bytes gzip";
});

// ---- R9 (after) ----
await check("R9. 'Check again' → '7 of the 1,000 people you follow on X are on Farcaster', 7 rows, external links rel=noopener", async () => {
  await page.goto(BASE + "/settings/import-x", { waitUntil: "networkidle" });
  await page.locator("[data-testid=x-people-check]").waitFor({ timeout: 30_000 });
  await page.locator("[data-testid=x-people-check]").click();
  await pollUntil(async () => (await page.locator("[data-testid=x-people-sentence]").count()) === 1, { tries: 60, delayMs: 500 });
  const s = await page.locator("[data-testid=x-people-sentence]").innerText();
  if (!s.includes("7 of the 1,000 people you follow on X are on Farcaster")) throw new Error("sentence: " + s);
  const rows = await page.locator("[data-testid=x-people-row]").count();
  if (rows !== 7) throw new Error(rows + " rows");
  const rels = await page.locator("[data-testid=x-people-x]").evaluateAll((as) => as.map((a) => [a.getAttribute("href"), a.getAttribute("rel"), a.getAttribute("target")]));
  if (!rels.some(([h]) => h === "https://x.com/dwr")) throw new Error("no x.com/dwr link");
  if (!rels.every(([, rel, tgt]) => /noopener/.test(rel ?? "") && tgt === "_blank")) throw new Error("an external link without noopener: " + JSON.stringify(rels));
  const fc = await page.locator("[data-testid=x-people-fc]").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
  if (!fc.includes("https://farcaster.xyz/dwr.eth")) throw new Error("fname link: " + fc.join(","));
  return s;
});

// ---- R11 ----
await check("R11. the Farcaster-verified badge: one click attests (method farcaster-verified), the badge reads 'verified on Farcaster · since', and the matching archive's shelf now reads verified", async () => {
  const ident = (await retry(() => api("GET", "/api/x/identity"))).json;
  if (!ident.offered || ident.fid !== ownFid || ident.x?.handle !== PLANT.account.username) throw new Error("identity " + JSON.stringify(ident));
  await page.goto(BASE + "/settings/attestations", { waitUntil: "networkidle" });
  await page.locator("[data-testid=x-identity-attest]").waitFor({ timeout: 30_000 });
  await page.locator("[data-testid=x-identity-attest]").click();
  await pollUntil(async () => (await page.locator("[data-testid=x-verified-badge]").count()) === 1, { tries: 30, delayMs: 400 });
  const badge = await page.locator("[data-testid=x-verified-badge]").innerText();
  if (!badge.includes("X @synth_yeak, verified on Farcaster · since ")) throw new Error("badge: " + badge);
  const link = (await retry(() => api("GET", "/api/x/link"))).json;
  if (link.attestation?.method !== "farcaster-verified" || !/^fc-index:.+:fid:\d+$/.test(link.attestation?.proofRef ?? "")) throw new Error("attestation " + JSON.stringify(link.attestation));
  if (link.label !== "verified on Farcaster") throw new Error("label " + link.label);
  await profileShelf();
  await pollUntil(async () => (await page.locator("[data-testid=import-verified]").count()) === 1, { tries: 15, delayMs: 400, midway: () => page.reload({ waitUntil: "networkidle" }) });
  if ((await page.locator("[data-testid=import-verified]").innerText()) !== "verified on Farcaster") throw new Error("shelf attribution");
  return badge;
});

// ---- R12 ----
await check("R12. honesty: a fixture link reads 'test link, not verified'; sync says fixture, never live; the rig offers the fixture conveniences", async () => {
  await viewAs(OTHER);
  await page.goto(BASE + "/settings/attestations", { waitUntil: "networkidle" });
  await page.locator("[data-testid=link-fixture-handle]").waitFor({ timeout: 30_000 });
  await page.locator("[data-testid=link-fixture-handle]").fill("x5_test_link");
  await page.locator("[data-testid=link-connect]").click();
  await pollUntil(async () => (await page.locator("[data-testid=link-method]").count()) === 1, { tries: 30, delayMs: 400 });
  const label = await page.locator("[data-testid=link-method]").innerText();
  if (label !== "test link, not verified") throw new Error("label: " + label);
  if (/verified via/.test(await page.locator("[data-testid=linked-accounts]").innerText())) throw new Error("the old 'verified via' wording is back");
  const sync = await retry(() => api("POST", "/api/x/sync", { kind: "bookmarks" }));
  if (sync.json.mode !== "fixture") throw new Error("sync mode " + sync.json.mode);
  const linkGet = (await retry(() => api("GET", "/api/x/link"))).json;
  if (linkGet.fixtureAvailable !== true) throw new Error("the rig must offer the fixture link");
  // review W1-R5, the rig half: every X fixture convenience the owner service and the empty world must NOT have is here
  // retryContent: the fan-out read can 200 with a destination silently dropped (adapters fail 2% by design, accept-x1)
  const cp = (await retryContent(() => api("GET", "/api/crosspost?text=probe"), (r) => r.status === 200 && (r.json?.destinations ?? []).some((d) => d.id === "x"), 6)).json ?? {};
  if (!(cp.destinations ?? []).some((d) => d.id === "x")) throw new Error("the rig does not offer the X destination to a test-linked persona: " + JSON.stringify((cp.destinations ?? []).map((d) => d.id)));
  const sum = (await retry(() => api("GET", "/api/x/import?view=summary"))).json;
  if (sum.fixtureAvailable !== true || sum.savedBy !== "service") throw new Error("the import summary on the rig: " + JSON.stringify({ fixtureAvailable: sum.fixtureAvailable, savedBy: sum.savedBy }));
  await page.goto(BASE + "/settings/import-x", { waitUntil: "networkidle" });
  await page.locator("[data-testid=migration-panel]").waitFor({ timeout: 30_000 });
  await page.locator("[data-testid=import-load-fixture]").waitFor({ timeout: 30_000 });
  await retry(() => api("POST", "/api/x/link", { action: "unlink", handle: "x5_test_link" }));
  await viewAs(VIEWER);
});

// ---- R13 ----
await check("R13. sweep safety: the fixture-delivery knob is disarmed, every Farcaster ledger row is fixture, live spend is $0", async () => {
  const where = (await retry(() => api("GET", "/api/actions/delivery"))).json;
  if (where.fixtureDelivery !== false) throw new Error("the knob is armed");
  const ledger = (await retry(() => api("GET", "/api/fc/write"))).json;
  const live = (ledger.entries ?? []).filter((e) => e.mode !== "fixture");
  if (live.length) throw new Error(live.length + " non-fixture ledger rows");
  const spend = (await retry(() => api("GET", "/api/x/spend"))).json;
  if (spend.totals?.liveTotal !== 0) throw new Error("live spend " + spend.totals?.liveTotal);
});

await stub.close();
await api("POST", "/x/fc-index/clear", {}, VALIDATOR);
await reset();
await viewAs(null);
await browser.close();
rmSync(TMP, { recursive: true, force: true });

const productFails = results.filter((r) => r[0] === "FAIL");
const infraFails = results.filter((r) => r[0] === "INFRA");
console.log(
  productFails.length === 0 && infraFails.length === 0
    ? `\n${results.length}/${results.length} BYX rig checks passed`
    : `\n${results.length - productFails.length - infraFails.length}/${results.length} passed, ${productFails.length} FAILED, ${infraFails.length} infra`
);
if (productFails.length) {
  console.log("\nProduct failures:");
  for (const r of productFails) console.log(`  - ${r[1]}: ${r[2]}`);
}
process.exit(productFails.length ? 1 : infraFails.length ? 2 : 0);
