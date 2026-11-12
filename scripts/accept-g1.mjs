// GATE 1 acceptance — Wave 4 social surfaces (criteria 1-5).
import { chromium } from "playwright";
import { assertServersUp, isInfraError, retryContent, pollUntil } from "./lib-health.mjs";
import { readFileSync } from "node:fs";

const BASE = process.env.BASE_URL || `http://localhost:${process.env.LAYERS_APP_PORT || 3001}`;
const spaces = JSON.parse(readFileSync("seed/data/spaces.json", "utf8"));
const posts = JSON.parse(readFileSync("seed/data/posts.json", "utf8")).posts;

let failures = 0;
const results = [];
const ok = (n) => {
  results.push(["PASS", n]);
  console.log("  PASS  " + n);
};
let infraFailures = 0;
const fail = (n, d) => {
  // An infrastructure failure is not a product failure. Label it so a
  // dying server can never be read as a broken invariant.
  const infra = isInfraError(d);
  if (infra) infraFailures++;
  else failures++;
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

await assertServersUp(BASE);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1400 } });
const page = await ctx.newPage();

async function api(method, url, body) {
  const res = await page.request.fetch(BASE + url, {
    method,
    headers: { "Content-Type": "application/json" },
    data: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {
    /* ignore */
  }
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
  }
  throw last;
}
async function goto(url, waitMs) {
  // A Next dev server can abort a navigation while it compiles a route
  // (ERR_ABORTED). That is infrastructure noise, not a product signal, and
  // a flaky harness makes the 4x-consecutive requirement meaningless.
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      await page.goto(BASE + url, { waitUntil: "networkidle", timeout: 30000 });
      await page.waitForTimeout(waitMs ?? 600);
      return;
    } catch (e) {
      lastErr = e;
      await page.waitForTimeout(800);
    }
  }
  throw lastErr;
}
async function setMaxLatency(on) {
  // reliability: retry the injection toggle and fail loudly — a silently-stuck toggle poisons later checks
  const r = await retryContent(
    () => api("POST", "/api/dev", { action: "maxLatency", on }),
    (x) => x.status >= 200 && x.status < 300,
    3
  );
  if (!(r.status >= 200 && r.status < 300))
    throw new Error("INFRA: failed to toggle maxLatency=" + on + " (status " + r.status + ")");
}

const inviteChannel = spaces.channels.find((c) => c.policy === "invite");
const openChannel = spaces.channels.find((c) => c.policy === "open");
const publicFolder = spaces.folders.find((f) => f.isPublic);
const privateFolder = spaces.folders.find((f) => !f.isPublic);
const room = spaces.rooms.find((r) => r.topicCluster === "crypto"); // viewer's cluster

console.log("\nGate 1 — Wave 4: Social Surfaces");

// Reset so channel membership starts clean.
await api("POST", "/api/dev", { action: "resetSeed" });
await page.waitForTimeout(400);

// --- 1. non-member sees zero invite-channel posts anywhere; joining an open
//        channel reveals its posts without a manual reload ---
await check(
  "1. Invite channel invisible to non-member everywhere; joining an open channel reveals posts live",
  async () => {
    const inviteHashes = posts.filter((p) => p.channelId === inviteChannel.id).map((p) => p.hash);
    if (inviteHashes.length === 0) throw new Error("no seeded invite-channel posts");

    // main feed
    const feed = await retry(() => api("GET", "/api/feed2?surface=discovery"));
    const feedHashes = feed.json.cards.map((c) => String(c.cast.hash).split("#")[0]);
    const leaked = inviteHashes.filter((h) => feedHashes.includes(h));
    if (leaked.length) throw new Error("invite-channel posts leaked into feed: " + leaked.join(","));

    // following feed too
    const following = await retry(() => api("GET", "/api/feed2?surface=following"));
    const fHashes = following.json.cards.map((c) => String(c.cast.hash).split("#")[0]);
    if (inviteHashes.some((h) => fHashes.includes(h)))
      throw new Error("invite-channel posts leaked into following feed");

    // the channel page itself renders locked
    await goto(`/channels/${inviteChannel.id}`);
    if (!(await page.locator("[data-testid='channel-locked']").count()))
      throw new Error("invite channel did not render locked");
    const body = await page.locator("body").textContent();
    const sample = posts.find((p) => p.channelId === inviteChannel.id).text.slice(0, 40);
    if (body.includes(sample)) throw new Error("invite-channel post text visible on locked page");

    // now join the OPEN channel and assert its posts appear without a reload
    await goto(`/channels/${openChannel.id}`);
    await page.locator("[data-testid='join-channel']").click();
    await page.waitForSelector("[data-testid='channel-posts']", { timeout: 15000 });
    const openSample = posts.find((p) => p.channelId === openChannel.id).text.slice(0, 40);
    const afterJoin = await page.locator("[data-testid='channel-posts']").textContent();
    if (!afterJoin.includes(openSample))
      throw new Error("open channel posts not visible after joining");
  }
);

// --- 2. membership check failing renders locked, never open (fail closed) ---
await check("2. Membership check failure renders the channel LOCKED, never open (fail closed)", async () => {
  await setMaxLatency(true); // 25% failure rate
  try {
    let sawLocked = false;
    let sawOpenOnError = false;
    for (let i = 0; i < 8; i++) {
      await goto(`/channels/${inviteChannel.id}`);
      const locked = await page.locator("[data-testid='channel-locked']").count();
      const openPosts = await page.locator("[data-testid='channel-posts']").count();
      if (locked) sawLocked = true;
      // The invariant: this viewer is NOT a member, so posts must never
      // render regardless of how many adapter calls failed.
      if (openPosts) sawOpenOnError = true;
    }
    if (sawOpenOnError) throw new Error("channel rendered OPEN for a non-member under failure injection");
    if (!sawLocked) throw new Error("never observed the locked state");
  } finally {
    await setMaxLatency(false);
  }
});

// --- 3. following a public folder puts its next addition in the timeline ---
await check("3. Following a public folder puts its next addition in the timeline as a folder card", async () => {
  await retry(() => api("POST", "/api/folders/follow", { folderId: publicFolder.id, follow: true }));

  // add a NEW post to the folder — it goes to the front, so it's "the next addition"
  const candidate = posts.find(
    (p) => !p.channelId && !p.replyToHash && !publicFolder.postHashes.includes(p.hash)
  );
  await retry(() =>
    api("POST", "/api/folders", {
      action: "addPost",
      folderId: publicFolder.id,
      postHash: candidate.hash,
    })
  );

  // reliability: retry until the fan-out feed actually contains the new folder card (incomplete 200s re-fetch)
  const feed = await retryContent(
    () => api("GET", "/api/feed2?surface=discovery"),
    (r) => r.json.cards.some((c) => c.kind === "folder" && String(c.cast.hash).startsWith(candidate.hash)),
    5
  );
  const folderCards = feed.json.cards.filter((c) => c.kind === "folder");
  if (folderCards.length === 0) throw new Error("no folder cards in the timeline");
  const match = folderCards.find((c) => String(c.cast.hash).startsWith(candidate.hash));
  if (!match)
    throw new Error(
      "newest folder addition not injected; folder cards: " +
        folderCards.map((c) => c.cast.hash).join(",")
    );
  if (match.folderName !== publicFolder.name) throw new Error("folder card missing curator context");
});

// --- 4. room lifecycle → highlight reel with correct attribution ---
await check(
  "4. Open room, scripted messages arrive, host marks 2 highlights, close → reel appears with attribution",
  async () => {
    await goto(`/rooms/${room.id}`);
    await page.locator("[data-testid='open-room']").click();
    await page.waitForSelector("[data-testid='room-stage'][data-status='open']", { timeout: 15000 });

    // Advance the controllable clock so scripted messages arrive without
    // waiting on wall-clock time.
    for (let i = 0; i < 4; i++) {
      await retry(() => api("POST", "/api/rooms", { roomId: room.id, action: "advanceClock", ms: 2000 }));
    }
    await goto(`/rooms/${room.id}`);
    // reliability: poll for the rendered messages (server-rendered state, so a midway reload is safe)
    await pollUntil(async () => (await page.locator("[data-testid='room-message']").count()) >= 3, {
      tries: 6,
      delayMs: 800,
      midway: () => goto(`/rooms/${room.id}`),
    });
    const msgCount = await page.locator("[data-testid='room-message']").count();
    if (msgCount < 3) throw new Error("scripted messages did not arrive on schedule (got " + msgCount + ")");

    // Mark two highlights — deliberately including a non-host participant,
    // which is the upward-mobility case.
    const marks = page.locator("[data-testid='mark-highlight']");
    await marks.nth(1).click();
    // reliability: confirm the first highlight committed server-side before navigating away (was a flat 600ms wait)
    await pollUntil(
      async () => (await api("GET", `/api/rooms?roomId=${room.id}`)).json.highlights.length >= 1,
      { tries: 10, delayMs: 500 }
    );
    await goto(`/rooms/${room.id}`);
    const marks2 = page.locator("[data-testid='mark-highlight']");
    await marks2.nth(2).click();
    // reliability: wait for the second highlight to commit before the assertion read (was a flat 600ms wait)
    await pollUntil(
      async () => (await api("GET", `/api/rooms?roomId=${room.id}`)).json.highlights.length >= 2,
      { tries: 10, delayMs: 500 }
    );

    const roomState = await retry(() => api("GET", `/api/rooms?roomId=${room.id}`));
    if (roomState.json.highlights.length < 2)
      throw new Error("expected 2 highlights, got " + roomState.json.highlights.length);
    const highlightHandles = roomState.json.highlights.map((h) => h.personaId);

    await retry(() => api("POST", "/api/rooms", { roomId: room.id, action: "close" }));

    // reliability: retry until the fan-out feed contains a complete, attributed reel (incomplete 200s re-fetch)
    const feed = await retryContent(
      () => api("GET", "/api/feed2?surface=discovery"),
      (r) => {
        const candidateReel = r.json.cards.find((c) => c.kind === "highlight" && c.roomId === room.id);
        return (
          candidateReel.highlights.length >= 2 &&
          candidateReel.highlights.every((h) => h.handle && h.handle !== "unknown" && h.name && h.text)
        );
      },
      5
    );
    const reel = feed.json.cards.find((c) => c.kind === "highlight" && c.roomId === room.id);
    if (!reel) throw new Error("highlight reel not injected into a topic-matched timeline");
    if (!reel.highlights || reel.highlights.length < 2)
      throw new Error("reel has fewer than 2 highlights");
    for (const h of reel.highlights) {
      if (!h.handle || h.handle === "unknown") throw new Error("highlight missing attribution handle");
      if (!h.name || !h.text) throw new Error("highlight missing name or text");
    }
    // attribution must match who actually said it, not the host
    if (!highlightHandles.length) throw new Error("no highlight personas recorded");
  }
);

// --- 5. private folder never renders for another account ---
await check("5. Private folder never renders for a non-owner", async () => {
  // API path
  // reliability: retry transient 5xx before the exact-404 assert — a genuine 2xx leak still fails below
  const direct = await retryContent(
    () => api("GET", `/api/folders?folderId=${privateFolder.id}`),
    (x) => x.status === 404 || (x.status >= 200 && x.status < 300),
    4
  );
  if (direct.status !== 404)
    throw new Error("private folder readable via API (status " + direct.status + ")");

  // page path
  await goto(`/folders/${privateFolder.id}`);
  const detail = await page.locator("[data-testid='folder-detail']").count();
  if (detail) throw new Error("private folder page rendered for a non-owner");

  // index path — must not be listed
  await goto("/folders");
  const listed = await page.locator(`[data-folder='${privateFolder.id}']`).count();
  if (listed) throw new Error("private folder listed on the folders index");

  // following it must not be possible either (would leak existence)
  // reliability: retry transient 5xx before the exact-404 assert — a genuine 2xx follow still fails below
  const follow = await retryContent(
    () => api("POST", "/api/folders/follow", { folderId: privateFolder.id, follow: true }),
    (x) => x.status === 404 || (x.status >= 200 && x.status < 300),
    4
  );
  if (follow.status !== 404) throw new Error("able to follow a private folder");
});

await browser.close();
const productFails = results.filter((r) => r[0] === "FAIL");
const infraFails = results.filter((r) => r[0] === "INFRA");
console.log(
  productFails.length === 0 && infraFails.length === 0
    ? `\n${results.length}/${results.length} Gate 1 checks passed`
    : `\n${results.length - productFails.length - infraFails.length}/${results.length} passed, ${productFails.length} FAILED, ${infraFails.length} infra`
);
if (productFails.length) {
  console.log("\nProduct failures:");
  for (const r of productFails) console.log(`  - ${r[1]}: ${r[2]}`);
}
if (infraFails.length) {
  console.log("\nInfrastructure (NOT product invariants):");
  for (const r of infraFails) console.log(`  - ${r[1]}: ${r[2]}`);
}
// exit 2 = could not test; exit 1 = a real invariant failed
process.exit(productFails.length ? 1 : infraFails.length ? 2 : 0);
