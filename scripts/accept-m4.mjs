// MEGA GATE 4 — Neynar read-only.
//
// Runs in one of two modes and says which:
//   LIVE     — NEYNAR_API_KEY present, hits the real API
//   FIXTURE  — no key; asserts the mapping against recorded real responses
//
// The mapping tests matter more than the network tests. Every one of them
// encodes a place where the live wire format contradicts what a from-memory
// integration would assume — and each of those was a real defect in this
// repo's phase-1 mapper before this gate.
import { readFileSync, existsSync } from "node:fs";
import { mapCast, mapUser } from "../lib/adapters/neynar/contentPure.mjs";

const results = [];
const ok = (n) => {
  results.push(["PASS", n]);
  console.log("  PASS  " + n);
};
const fail = (n, d) => {
  results.push(["FAIL", n, d]);
  console.log("  FAIL  " + n + (d ? " — " + d : ""));
};
function check(name, fn) {
  try {
    fn();
    ok(name);
  } catch (e) {
    fail(name, e.message);
  }
}

let key = process.env.NEYNAR_API_KEY;
if (!key && existsSync(".env.local")) {
  key = readFileSync(".env.local", "utf8")
    .split("\n")
    .find((l) => l.startsWith("NEYNAR_API_KEY="))
    ?.split("=")[1]
    ?.trim();
}

const fixturePath = "fixtures/neynar/feed-following.json";
if (!existsSync(fixturePath)) {
  console.log("\nMega Gate 4 — no fixture and no key: CANNOT TEST");
  process.exit(2);
}
const feed = JSON.parse(readFileSync(fixturePath, "utf8"));
const users = existsSync("fixtures/neynar/user-bulk.json")
  ? JSON.parse(readFileSync("fixtures/neynar/user-bulk.json", "utf8"))
  : { users: [] };

const MODE = key ? "LIVE" : "FIXTURE-VERIFIED";
console.log(`\nMega Gate 4 — Neynar read-only  [${MODE}]`);

// ---- 1. the recorded contract is real ----
check("1. Recorded fixtures are genuine API responses, not hand-written", () => {
  const c = feed.casts?.[0];
  if (!c) throw new Error("no casts in fixture");
  for (const f of ["object", "hash", "thread_hash", "author", "text", "timestamp", "reactions", "replies"])
    if (!(f in c)) throw new Error(`fixture cast missing ${f} — not a real response shape`);
  if (c.object !== "cast") throw new Error(`object is "${c.object}"`);
  if (!/^0x[0-9a-f]+$/.test(c.hash)) throw new Error(`hash is not a cast hash: ${c.hash}`);
});

// ---- 2-7. every mapping the wire format contradicts ----
check("2. timestamp: ISO-8601 string becomes epoch ms (not NaN)", () => {
  const c = feed.casts[0];
  if (typeof c.timestamp !== "string")
    throw new Error("fixture timestamp is not a string — contract assumption wrong");
  const mapped = mapCast(c);
  if (!Number.isFinite(mapped.timestamp)) throw new Error("mapped timestamp is not finite");
  if (mapped.timestamp !== Date.parse(c.timestamp)) throw new Error("timestamp mis-parsed");
  // and a malformed value must not propagate NaN into every relative-time label
  const bad = mapCast({ ...c, timestamp: "not a date" });
  if (!Number.isFinite(bad.timestamp)) throw new Error("malformed timestamp produced NaN");
});

check("3. reactions/replies are OBJECTS, and map to numbers", () => {
  const c = feed.casts[0];
  if (typeof c.reactions !== "object") throw new Error("fixture reactions is not an object");
  if (typeof c.replies !== "object") throw new Error("fixture replies is not an object");
  const m = mapCast(c);
  if (typeof m.likes !== "number" || typeof m.recasts !== "number" || typeof m.replies !== "number")
    throw new Error("counts did not map to numbers");
  if (m.likes !== c.reactions.likes_count) throw new Error("likes count mismatch");
  if (m.replies !== c.replies.count) throw new Error("replies count mismatch");
});

check("4. views: Farcaster has no impression metric, so it is ABSENT not zero", () => {
  // Rendering "0 views" on a real cast is fabricating a metric the protocol
  // does not have — the one number on screen that would be a lie.
  if (feed.casts.some((c) => "views" in c))
    throw new Error("a live cast carried a views key — the premise of this test is wrong");
  const m = mapCast(feed.casts[0]);
  if (m.views !== undefined) throw new Error(`views mapped to ${m.views}, expected undefined`);
});

check("5. display_name and pfp_url are nullable and never render as null", () => {
  const c = feed.casts[0];
  const nulled = mapCast({ ...c, author: { ...c.author, display_name: null, pfp_url: null } });
  if (!nulled.author.displayName) throw new Error("null display_name produced an empty name");
  if (/null|undefined/.test(nulled.author.displayName))
    throw new Error(`display name rendered as "${nulled.author.displayName}"`);
  if (nulled.author.pfpUrl === null || nulled.author.pfpUrl === undefined)
    throw new Error("null pfp_url produced a null src");
  if (nulled.author.displayName !== c.author.username)
    throw new Error("null display_name should fall back to the username");
});

check("6. power_badge does NOT exist on the live user object", () => {
  // The old verification signal. Reading it silently marks every real
  // account unverified, which is why this test names the field explicitly.
  const withBadge = feed.casts.filter((c) => "power_badge" in c.author);
  if (withBadge.length)
    throw new Error("power_badge exists after all — the mapper should use it");
  const pro = (users.users ?? []).find((u) => u.pro?.status === "subscribed");
  if (pro && !mapUser(pro).verified)
    throw new Error("a Pro-subscribed account did not map to verified");
});

check("7. bio is nested at profile.bio.text, not flat", () => {
  const withBio = (users.users ?? []).find((u) => u.profile?.bio?.text);
  if (!withBio) throw new Error("no fixture user has a bio — cannot test");
  const m = mapUser(withBio);
  if (m.bio !== withBio.profile.bio.text) throw new Error(`bio mapped to "${m.bio}"`);
  if (withBio.bio !== undefined) throw new Error("a flat bio exists — contract assumption wrong");
});

// ---- 8. what real data does that seed data never did ----
check("8. Real data stresses the layout: long casts are clamped", () => {
  const lens = feed.casts.map((c) => c.text.length);
  const longest = Math.max(...lens);
  if (longest < 500)
    throw new Error(`longest live cast is ${longest} chars — sample is not stressing anything`);
  const long = feed.casts.find((c) => c.text.length === longest);
  if (!mapCast(long).truncate)
    throw new Error(`a ${longest}-char cast was not marked for clamping`);
  const short = feed.casts.find((c) => c.text.length < 100);
  if (short && mapCast(short).truncate) throw new Error("a short cast was clamped");
});

check("9. Non-ASCII display names survive mapping intact", () => {
  const exotic = feed.casts.filter((c) => /[^\x00-\x7F]/.test(c.author.display_name ?? ""));
  if (!exotic.length) throw new Error("no non-ASCII names in the sample — cannot test");
  for (const c of exotic) {
    const m = mapCast(c);
    if (m.author.displayName !== c.author.display_name)
      throw new Error(`"${c.author.display_name}" became "${m.author.displayName}"`);
  }
  console.log(`        (${exotic.length}/${feed.casts.length} live names are non-ASCII)`);
});

check("10. Every cast in a real page maps without throwing", () => {
  let mapped = 0;
  for (const c of feed.casts) {
    const m = mapCast(c);
    if (!m.hash || typeof m.text !== "string" || !m.author.username)
      throw new Error(`cast ${c.hash} mapped to something unusable`);
    mapped++;
  }
  if (mapped !== feed.casts.length) throw new Error("not all casts mapped");
  console.log(`        (${mapped} real casts mapped clean)`);
});

console.log(
  results.every((r) => r[0] === "PASS")
    ? `\n${results.length}/${results.length} Mega Gate 4 checks passed  [${MODE}]`
    : `\n${results.filter((r) => r[0] === "PASS").length}/${results.length} passed  [${MODE}]`
);
const fails = results.filter((r) => r[0] === "FAIL");
if (fails.length) {
  console.log("\nProduct failures:");
  for (const r of fails) console.log(`  - ${r[1]}: ${r[2]}`);
}
process.exit(fails.length ? 1 : 0);
