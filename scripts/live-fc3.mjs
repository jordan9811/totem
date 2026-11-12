// FC PASS — GATE 3 LIVE WRITE VERIFICATION.
//
// THIS SCRIPT PUBLISHES REAL, PUBLIC, PERMANENT CASTS to the Farcaster
// network as the Gate 1 throwaway FID. It is never part of a sweep and
// never runs by accident: it refuses unless ENABLE_FC_WRITE=true is set
// in the SERVER's environment and throwaway credentials exist.
//
// Budget: 6 writes, exactly at the spec's ceiling.
//   1 cast   2 reply   3 like   4 recast   5 delete reply   6 delete cast
// Every one goes through the ONE write door (/api/fc/write), so every one
// is ledgered before it is sent. Total actions are printed at the end.
//
// The mid-publish-kill adversarial test is deliberately NOT here: it is
// proven in the fixture sim (scripts/accept-fc3.mjs), where an induced
// duplicate costs nothing. Running it against the public network would
// risk minting the very stray cast it exists to disprove.
//
// Evidence: shots/fc-live-w*.png plus the printed ledger.
import { chromium } from "playwright";
import { assertServersUp } from "./lib-health.mjs";
import { mkdirSync, readFileSync, existsSync } from "node:fs";

const BASE = process.env.BASE_URL || `http://localhost:${process.env.LAYERS_APP_PORT || 3001}`;
mkdirSync("shots", { recursive: true });

// Read the throwaway identity for display/verification only. Never printed
// beyond fid + fname, and private key lines are never touched.
function envLocal(key) {
  if (process.env[key]) return process.env[key];
  if (!existsSync(".env.local")) return "";
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const i = line.indexOf("=");
    if (i > 0 && line.slice(0, i).trim() === key) return line.slice(i + 1).trim();
  }
  return "";
}
const FID = envLocal("FC_TEST_FID");
const FNAME = envLocal("FC_TEST_FNAME");
const NEYNAR_KEY = envLocal("NEYNAR_API_KEY");

// A run marker makes every automated cast identifiable and disposable.
// Public and permanent means labeled — this is a spec requirement, not a
// nicety.
const runId = Math.random().toString(36).slice(2, 8);
const MARK = `[layers-test ${runId}]`;

const results = [];
const ok = (n, extra = "") => {
  results.push(["PASS", n]);
  console.log("  PASS  " + n + (extra ? " — " + extra : ""));
};
const fail = (n, d) => {
  results.push(["FAIL", n, d]);
  console.log("  FAIL  " + n + (d ? " — " + d : ""));
};
async function check(name, fn) {
  try {
    const extra = await fn();
    ok(name, typeof extra === "string" ? extra : "");
  } catch (e) {
    fail(name, e.message);
  }
}

await assertServersUp(BASE);
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1200 } });
const page = await ctx.newPage();

async function api(method, url, body) {
  const res = await page.request.fetch(BASE + url, {
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

/** Poll a predicate until it is TRUE, not until a thing merely exists. */
async function pollUntil(pred, { tries = 30, delayMs = 1000 } = {}) {
  for (let i = 0; i < tries; i++) {
    try {
      if (await pred(i)) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return false;
}

/** The test fid's recent casts, straight from the network. */
async function networkCasts() {
  const res = await fetch(
    `https://api.neynar.com/v2/farcaster/feed/user/casts?fid=${FID}&limit=25`,
    { headers: { "x-api-key": NEYNAR_KEY } }
  );
  if (!res.ok) throw new Error(`neynar read failed: ${res.status}`);
  return (await res.json()).casts ?? [];
}

console.log(`\nFC Gate 3 LIVE WRITE verification — ${new Date().toISOString()}`);
console.log(`identity: fid ${FID} (@${FNAME})   run marker: ${MARK}`);

// ---- 0. PREFLIGHT. Refuse loudly rather than silently writing to fixture.
const pre = await api("GET", "/api/fc/write");
if (!pre.json?.writeEnabled) {
  console.log(
    "\nREFUSING TO RUN: the server reports writeEnabled=false.\n" +
      "This script only ever runs against a server started with ENABLE_FC_WRITE=true.\n" +
      "Nothing was written. Restart the server with that set and re-run."
  );
  await browser.close();
  process.exitCode = 2;
} else if (!pre.json?.throwawayConfigured) {
  console.log("\nREFUSING TO RUN: no throwaway credentials configured. Nothing was written.");
  await browser.close();
  process.exitCode = 2;
} else if (!FID || !NEYNAR_KEY) {
  console.log("\nREFUSING TO RUN: FC_TEST_FID / NEYNAR_API_KEY not readable. Nothing was written.");
  await browser.close();
  process.exitCode = 2;
} else {
  const before = pre.json.ledger;
  console.log(`ledger before: ${JSON.stringify(before)}\n`);

  // live content so the read-back path is the real one
  await api("POST", "/api/dev", { action: "setDataSource", source: "neynar" });

  let castHash = null;
  let replyHash = null;

  // ---- 1. WRITE 1 — publish a real cast -----------------------------------
  await check("W1. publish a real cast as the throwaway fid", async () => {
    const text = `Totem live-write check. ${MARK}`;
    const r = await api("POST", "/api/fc/write", { action: "cast", text });
    if (r.status !== 200) throw new Error(`status ${r.status}: ${JSON.stringify(r.json)}`);
    if (r.json.mode !== "live")
      throw new Error(`published in "${r.json.mode}" mode — this must be a LIVE write`);
    castHash = r.json.hash;
    if (!/^0x[0-9a-f]+$/i.test(castHash)) throw new Error(`implausible hash: ${castHash}`);
    return `hash ${castHash}`;
  });

  // ---- 2. it actually appears on the network -------------------------------
  // Never fake-confirm from the request having succeeded: poll the real
  // read path until the cast is genuinely there.
  await check("W2. the cast appears in the live read path (polled, not assumed)", async () => {
    if (!castHash) throw new Error("no cast to look for");
    const found = await pollUntil(async () => (await networkCasts()).some((c) => c.hash === castHash));
    if (!found) throw new Error("cast did not appear on the network within 30s");
    return "confirmed on the public network";
  });

  // ---- 3. exactly one -----------------------------------------------------
  await check("W3. EXACTLY ONE cast carries this run marker (no duplicate)", async () => {
    const mine = (await networkCasts()).filter((c) => (c.text ?? "").includes(MARK));
    if (mine.length !== 1) throw new Error(`expected exactly 1, found ${mine.length}`);
    return "1 cast, as intended";
  });

  // ---- 4. our client renders it -------------------------------------------
  await check("W4. our own client renders the live cast at its permalink (screenshot)", async () => {
    if (!castHash) throw new Error("no cast");
    await page.goto(`${BASE}/${FNAME}/status/${castHash}`, { waitUntil: "networkidle" });
    // poll for the CONTENT, not merely for the element to exist
    const rendered = await pollUntil(async () =>
      (await page.locator("main").innerText()).includes(runId)
    );
    await page.screenshot({ path: `shots/fc-live-w-permalink-${runId}.png` });
    if (!rendered) throw new Error("permalink did not render the cast text");
    return `shots/fc-live-w-permalink-${runId}.png`;
  });

  // ---- 5. WRITE 2 — reply -------------------------------------------------
  await check("W5. reply to it, carrying a real parent hash", async () => {
    if (!castHash) throw new Error("no parent");
    const r = await api("POST", "/api/fc/write", {
      action: "reply",
      text: `Reply leg of the lifecycle. ${MARK}`,
      parentHash: castHash,
    });
    if (r.status !== 200) throw new Error(`status ${r.status}: ${JSON.stringify(r.json)}`);
    replyHash = r.json.hash;
    // prove it is a REPLY on the network, not a top-level cast that merely
    // succeeded — the exact defect this pass found in the live transport
    const landed = await pollUntil(async () =>
      (await networkCasts()).some((c) => c.hash === replyHash && c.parent_hash === castHash)
    );
    if (!landed) throw new Error("reply never appeared with the expected parent_hash");
    return `${replyHash} -> parent ${castHash}`;
  });

  // ---- 6. WRITE 3 — like --------------------------------------------------
  await check("W6. like the cast", async () => {
    const r = await api("POST", "/api/fc/write", { action: "like", targetHash: castHash });
    if (r.status !== 200) throw new Error(`status ${r.status}: ${JSON.stringify(r.json)}`);
    if (r.json.mode !== "live") throw new Error(`mode ${r.json.mode}, expected live`);
  });

  // ---- 7. WRITE 4 — recast ------------------------------------------------
  await check("W7. recast the cast", async () => {
    const r = await api("POST", "/api/fc/write", { action: "recast", targetHash: castHash });
    if (r.status !== 200) throw new Error(`status ${r.status}: ${JSON.stringify(r.json)}`);
    if (r.json.mode !== "live") throw new Error(`mode ${r.json.mode}, expected live`);
  });

  // ---- 8. WRITES 5 & 6 — delete both --------------------------------------
  // Deletes are ADVISORY on Farcaster: hubs and indexers may retain the
  // content regardless. We delete anyway (leaving no orphaned reply) and
  // report the advisory nature rather than claiming erasure.
  await check("W8. delete the reply, then the cast (advisory — hubs may retain)", async () => {
    const a = await api("POST", "/api/fc/write", { action: "delete", hash: replyHash });
    if (a.status !== 200) throw new Error(`reply delete status ${a.status}: ${JSON.stringify(a.json)}`);
    const b = await api("POST", "/api/fc/write", { action: "delete", hash: castHash });
    if (b.status !== 200) throw new Error(`cast delete status ${b.status}: ${JSON.stringify(b.json)}`);
    return "both delete calls accepted";
  });

  // ---- 9. the ledger is the record ---------------------------------------
  await check("W9. every write is in the ledger, all mode=live, none pending", async () => {
    const after = await api("GET", "/api/fc/write");
    const mine = (after.json.entries ?? []).filter(
      (e) => (e.note ?? "").includes(runId) || [castHash, replyHash].includes(e.castHash)
    );
    if (mine.length !== 6) throw new Error(`expected 6 ledger entries for this run, found ${mine.length}`);
    const wrongMode = mine.filter((e) => e.mode !== "live");
    if (wrongMode.length) throw new Error(`${wrongMode.length} entries were not mode=live`);
    const stuck = mine.filter((e) => e.status === "pending");
    if (stuck.length) throw new Error(`${stuck.length} entries left pending`);
    console.log(`  ledger after: ${JSON.stringify(after.json.ledger)}`);
    return `6 entries, all live, all settled`;
  });

  await api("POST", "/api/dev", { action: "setDataSource", source: "seed" });
  await browser.close();

  const fails = results.filter((r) => r[0] === "FAIL");
  console.log(`\nNETWORK WRITES THIS RUN: 6 (1 cast, 1 reply, 1 like, 1 recast, 2 deletes)`);
  console.log(`run marker: ${MARK}   fid: ${FID}`);
  console.log(
    fails.length === 0
      ? `\nGATE 3 LIVE VERIFICATION PASSED (${results.length}/${results.length})`
      : `\n${fails.length} of ${results.length} LIVE WRITE checks FAILED`
  );
  process.exitCode = fails.length ? 1 : 0;
}
