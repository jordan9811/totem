// MEGA GATE 3 — private personas as a product.
//
// The private X account inside a normal account. @backyard_scope is the
// viewer's own second persona; making IT private is the point — this is not a
// separate app, it is one more persona under the same root, with an audience
// instead of a public.
//
// Tests 1-4 are the leak tests and were written before the read path existed.
// The spec's failure mode for this gate is fanning private posts into
// per-viewer feed stores; the assertion that catches it is test 5 (revoke),
// because a fanned-out copy cannot be retracted.
import { chromium } from "playwright";
import { assertServersUp, isInfraError, retryContent, pollUntil } from "./lib-health.mjs";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const BASE = process.env.BASE_URL || `http://localhost:${process.env.LAYERS_APP_PORT || 3001}`;
const personas = JSON.parse(readFileSync("seed/data/accounts.json", "utf8")).personas;
const byHandle = new Map(personas.map((p) => [p.handle, p]));
const id = (h) => {
  const p = byHandle.get(h);
  if (!p) throw new Error(`seed handle not found: ${h}`);
  return p.id;
};

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

await assertServersUp(BASE);
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1400 } });
const page = await ctx.newPage();

// The mocks fail 2% of calls BY DESIGN. Any test step that creates state
// through an adapter must retry, or the suite fails its own harness rather
// than the product (set-2 run-2 of the Tier B final sweeps caught exactly
// that: an unretried mode.create drew the 2% and the check TypeErrored).
async function retryApi(method, url, body, attempts = 4) {
  let last;
  for (let i = 0; i < attempts; i++) {
    const r = await api(method, url, body);
    if (r.status >= 200 && r.status < 300) return r;
    last = r;
  }
  return last;
}

async function api(method, url, body) {
  const res = await page.request.fetch(BASE + url, {
    method,
    headers: { "Content-Type": "application/json" },
    data: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  let text = "";
  try {
    text = await res.text();
    json = JSON.parse(text);
  } catch {}
  return { status: res.status(), json, text };
}

const viewAs = async (handle) => {
  await api("POST", "/api/dev", { action: "viewAs", personaId: handle ? id(handle) : null });
  await page.waitForTimeout(150);
};
const reset = async () => {
  await api("POST", "/api/dev", { action: "resetSeed" });
  await page.waitForTimeout(700);
};

const OWNER = "backyard_scope"; // the private persona
const GRANTED = "aperture_annie"; // on its audience
const OUTSIDER = "drivethru_dave"; // never granted
// A token that appears ONLY in seeded private posts.
const NEEDLE = "water tower";

/** Render a page AS a persona and read what the DOM actually shows. */
async function pageAs(path, viewerHandle) {
  await viewAs(viewerHandle);
  await page.goto(BASE + path, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  return {
    privateBadges: await page.locator("[data-testid=private-badge]").count(),
    body: await page.locator("body").innerText(),
  };
}

async function feedText(handle) {
  await viewAs(handle);
  const r = await api("GET", "/api/feed2?surface=discovery");
  return r.text;
}

console.log("\nMega Gate 3 — Private personas");

// ---- 1. the data path, not the render ----
await check("1. Non-granted viewer's feed DATA never contains a private post", async () => {
  await reset();
  // reliability: settle the flaky feed read; the original assertion still runs
  const granted = await retryContent(() => feedText(GRANTED), (t) => t.includes(NEEDLE), 4);
  if (!granted.includes(NEEDLE))
    throw new Error("granted viewer's feed has no private post — nothing to leak, test is vacuous");

  // and it is BADGE-MARKED for the viewer who may see it
  const shot = await pageAs("/home", GRANTED);
  // reliability: poll for the server-rendered badge, then re-read for the original assertion
  await pollUntil(async () => (await page.locator("[data-testid=private-badge]").count()) > 0, { tries: 6, delayMs: 500, midway: () => page.reload({ waitUntil: "networkidle" }) });
  shot.privateBadges = await page.locator("[data-testid=private-badge]").count();
  if (shot.privateBadges === 0)
    throw new Error("granted viewer's private post is not badge-marked in the timeline");

  for (const outsider of [OUTSIDER, "crustcritic", "yeak__"]) {
    const body = await feedText(outsider);
    if (body.includes(NEEDLE))
      throw new Error(`FAIL-OPEN: private text reached @${outsider}'s feed payload`);
    if (body.includes("0xpriv"))
      throw new Error(`FAIL-OPEN: private post hash reached @${outsider}'s feed payload`);
  }
});

// ---- 2. fail closed, not open ----
await check("2. When the grant lookup fails, BOTH viewers lose access (fails toward less)", async () => {
  await reset();
  await api("POST", "/api/dev", { action: "forceFail", label: "identity.privatePosts", count: 40 });
  const outsider = await feedText(OUTSIDER);
  if (outsider.includes(NEEDLE)) throw new Error("FAIL-OPEN: outsider gained access during a failure");
  const granted = await feedText(GRANTED);
  if (granted.includes(NEEDLE))
    throw new Error("a grant-read failure granted access anyway — this must fail CLOSED");
  await reset();
});

// ---- 3. direct hash access ----
await check("3. Knowing the hash buys a non-granted viewer nothing", async () => {
  await reset();
  await viewAs(GRANTED);
  // reliability: retry the flaky list read; the original vacuity assertion still runs
  const list = await retryContent(() => api("GET", "/api/private/posts"), (r) => (r.json?.posts ?? []).length > 0, 4);
  const hashes = (list.json?.posts ?? []).map((p) => p.hash);
  if (hashes.length === 0) throw new Error("granted viewer sees no private posts — test is vacuous");

  await viewAs(OUTSIDER);
  for (const hash of hashes) {
    // reliability: retry transient 5xx; a genuine 2xx leak still fails the original 404 assertions
    const one = await retryContent(() => api("GET", `/api/private/posts/${hash}`), (x) => x.status === 404 || (x.status >= 200 && x.status < 300), 4);
    if (one.status !== 404) throw new Error(`direct hash read returned ${one.status}, expected 404`);
    if (one.text.includes(NEEDLE)) throw new Error("FAIL-OPEN: post text in a 404 body");
    // a write attempt must not land either
    const like = await retryContent(() => api("POST", "/api/private/react", { hash, action: "like" }), (x) => x.status === 404 || (x.status >= 200 && x.status < 300), 4);
    if (like.status !== 404) throw new Error(`react as outsider returned ${like.status}, expected 404`);
  }

  // and the writes really did not land
  await viewAs(GRANTED);
  const after = await api("GET", "/api/private/posts");
  const liked = (after.json?.posts ?? []).filter((p) => (p.likes ?? []).length > 0);
  if (liked.length) throw new Error("an outsider's like landed on a private post");
});

// ---- 4. one store, or revoke is a lie ----
await check("4. Single store: the code never copies private posts per viewer", async () => {
  // Structural, not behavioural. If private posts are ever fanned out into
  // per-viewer stores, revoke cannot retract them — the spec's stated failure
  // mode for this gate. Enforce the chokepoint by grep rather than by hope.
  // The invariant is about the RAW STORE: nothing outside lib/private/ may
  // reach into state().privatePosts. Calling the adapter is the sanctioned
  // path and must not trip this.
  const hits = execSync('grep -rn "privatePosts" lib app components || true', {
    encoding: "utf8",
    cwd: process.cwd(),
  })
    .split(String.fromCharCode(10))
    .filter(Boolean)
    .filter((l) => /.privatePosts/.test(l.replace(/visiblePrivatePosts/g, "")))
    .filter((l) => !l.includes("lib/private/"))
    .filter((l) => !l.includes("lib/adapters/mock/store.ts"))
    .filter((l) => !l.includes("lib/adapters/mock/persist.ts"))
    .filter((l) => !l.includes("lib/adapters/mock/privateStore.ts"));
  if (hits.length)
    throw new Error(`privatePosts read outside the chokepoint:\n    ${hits.join("\n    ")}`);
});

// ---- 5. revoke actually retracts ----
await check("5. Revoking the audience retracts access to posts already seen", async () => {
  await reset();
  // reliability: settle the flaky feed read; the original vacuity assertion still runs
  const before = await retryContent(() => feedText(GRANTED), (t) => t.includes(NEEDLE), 4);
  if (!before.includes(NEEDLE)) throw new Error("granted viewer never had access — test is vacuous");

  // reliability: state-changing write goes through retryApi per the header-comment contract
  const rev = await retryApi("POST", "/api/private/audience", {
    personaId: id(OWNER),
    audienceMember: id(GRANTED),
    action: "revoke",
  });
  if (rev.status !== 200) throw new Error(`revoke failed: ${rev.status} ${rev.json?.error ?? ""}`);

  const after = await feedText(GRANTED);
  if (after.includes(NEEDLE))
    throw new Error("FAIL-OPEN: revoked viewer still receives the private post — posts were fanned out");
  await reset();
});

// ---- 6. deletion is real ----
await check("6. Deletion removes the post from the granted viewer too", async () => {
  await reset();
  await viewAs(GRANTED);
  // reliability: retry the flaky list read; the original guard still runs
  const list = await retryContent(() => api("GET", "/api/private/posts"), (r) => (r.json?.posts ?? []).some((p) => p.text.includes(NEEDLE)), 4);
  const target = (list.json?.posts ?? []).find((p) => p.text.includes(NEEDLE));
  if (!target) throw new Error("seeded private post not found");

  // a non-author cannot delete
  const notMine = await api("DELETE", `/api/private/posts/${target.hash}`);
  if (notMine.status === 200) throw new Error("a non-author deleted someone else's private post");

  await viewAs(OWNER);
  // reliability: mutating call retried on transient failure; original assertion still runs
  const del = await retryApi("DELETE", `/api/private/posts/${target.hash}`);
  if (del.status !== 200) throw new Error(`author delete failed: ${del.status}`);

  await viewAs(GRANTED);
  const after = await api("GET", "/api/private/posts");
  if ((after.json?.posts ?? []).some((p) => p.hash === target.hash))
    throw new Error("deleted post still returned to the granted viewer");
  const feed = await feedText(GRANTED);
  if (feed.includes(NEEDLE)) throw new Error("deleted post still in the granted viewer's feed");

  // gone from the persisted store, not merely hidden
  const st = await page.request.fetch(`http://localhost:${process.env.LAYERS_VALIDATOR_PORT || 4001}/state`);
  const raw = await st.text();
  if (raw.includes(target.hash)) throw new Error("deleted post still present in the validator store");
  await reset();
});

// ---- 7. composer chrome ----
await check("7. Composing as a private persona is visually unmistakable and non-dismissable", async () => {
  await reset();
  await viewAs(OWNER);
  await page.goto(BASE + "/home", { waitUntil: "networkidle" });
  // reliability: poll for the server-rendered composer chrome instead of a flat wait
  await pollUntil(async () => (await page.locator("[data-persona-kind]").count()) > 0, { tries: 5, delayMs: 500, midway: () => page.reload({ waitUntil: "networkidle" }) });
  const wrapper = page.locator("[data-persona-kind]").first();
  if ((await wrapper.count()) === 0) throw new Error("composer does not declare the persona kind");
  if ((await wrapper.getAttribute("data-persona-kind")) !== "private")
    throw new Error("composer chrome is not in private mode for a private persona");
  const audience = page.locator("[data-testid=composer-audience]");
  if ((await audience.count()) === 0) throw new Error("no audience line on the private composer");
  const text = await audience.first().innerText();
  if (!/\d/.test(text)) throw new Error(`audience line does not say who can see it: "${text}"`);

  await viewAs("yeak__");
  await page.goto(BASE + "/home", { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  const pub = await page.locator("[data-persona-kind]").first().getAttribute("data-persona-kind");
  if (pub === "private") throw new Error("public persona got private composer chrome");
});

// ---- 8. the server does not trust the client ----
await check("8. A private persona cannot publish publicly even if the client asks", async () => {
  await reset();
  await viewAs(OWNER);
  const res = await api("POST", "/api/actions/cast", {
    text: "escaping to the public timeline " + NEEDLE,
    audience: "public",
  });
  if (res.status === 200) throw new Error("FAIL-OPEN: a private persona published to the public path");
  for (const who of [OUTSIDER, "yeak__"]) {
    const body = await feedText(who);
    if (body.includes("escaping to the public timeline"))
      throw new Error(`FAIL-OPEN: the forced public post reached @${who}`);
  }
});

// ---- 9-10. search: relevance and privacy ----
await check("9. Search returns real results across posts, people and channels", async () => {
  await reset();
  await viewAs("yeak__");
  // reliability: settle each flaky search read; the original assertions still run
  const posts = await retryContent(() => api("GET", "/api/search?q=restaking"), (r) => (r.json?.posts ?? []).length > 0, 4);
  if (!(posts.json?.posts ?? []).length) throw new Error("no post results for a term that is in the seed");
  const people = await retryContent(() => api("GET", "/api/search?q=basisrisk"), (r) => (r.json?.people ?? []).length > 0, 4);
  if (!(people.json?.people ?? []).length) throw new Error("no people results for a seeded handle");
  const chans = await retryContent(() => api("GET", "/api/search?q=crypto"), (r) => (r.json?.channels ?? []).length > 0, 4);
  if (!(chans.json?.channels ?? []).length) throw new Error("no channel results for a seeded channel");
  const none = await api("GET", "/api/search?q=zzzzznotathinganywhere");
  if ((none.json?.posts ?? []).length) throw new Error("nonsense query returned post results");
});

await check("10. Search ranks the better match first", async () => {
  await viewAs("yeak__");
  // reliability: settle the flaky search read; the original assertions still run
  const r = await retryContent(() => api("GET", "/api/search?q=basisrisk"), (x) => (x.json?.people ?? []).length > 0, 4);
  const first = (r.json?.people ?? [])[0];
  if (!first) throw new Error("no people results");
  if (first.handle !== "basisrisk")
    throw new Error(`exact handle match not ranked first, got @${first.handle}`);
});

await check("11. PRIVACY: private posts appear in search only for granted viewers", async () => {
  await reset();
  await viewAs(GRANTED);
  // reliability: settle the flaky search read; the original vacuity assertion still runs
  const granted = await retryContent(() => api("GET", `/api/search?q=${encodeURIComponent(NEEDLE)}`), (r) => (r.json?.posts ?? []).length > 0, 4);
  if (!(granted.json?.posts ?? []).length)
    throw new Error("granted viewer cannot find their own private post — test is vacuous");

  for (const who of [OUTSIDER, "yeak__", "crustcritic"]) {
    await viewAs(who);
    const r = await api("GET", `/api/search?q=${encodeURIComponent(NEEDLE)}`);
    if ((r.json?.posts ?? []).length)
      throw new Error(`FAIL-OPEN: @${who} found a private post by searching`);
    if (r.text.includes("0xpriv")) throw new Error(`FAIL-OPEN: private hash in @${who}'s search payload`);
    // and no oracle: the response must not admit that something was withheld
    if (/withheld|hidden|redacted|\bprivate\b/i.test(r.text))
      throw new Error(`search response hints at withheld content for @${who}: ${r.text.slice(0, 200)}`);
  }
});

await check("12. PRIVACY: a hidden linkage is not matchable in search", async () => {
  // @aperture_annie <-> @collimationking is the deliberately hidden pair.
  // Searching one must never surface the other, and the result row must not
  // render as merged. Matching on a hidden sibling's handle IS the disclosure.
  await reset();
  await viewAs(OUTSIDER);
  const r = await api("GET", "/api/search?q=aperture_annie");
  if (r.text.includes("collimationking"))
    throw new Error("FAIL-OPEN: hidden sibling surfaced by searching its pair");
  const row = (r.json?.people ?? []).find((p) => p.handle === "aperture_annie");
  if (row?.merged) throw new Error("hidden linkage rendered as a merged identity in search");
  if (row?.linked) throw new Error("hidden linkage exposed on a search result row");

  // the reverse direction too
  const back = await api("GET", "/api/search?q=collimationking");
  if (back.text.includes("aperture_annie"))
    throw new Error("FAIL-OPEN: hidden sibling surfaced from the other direction");
});

// ---- 13-15. the dead fields become enforced ----
await check("13. A mode can pin the acting persona, and the composer follows it", async () => {
  await reset();
  // Clear view-as rather than setting it: view-as is a demo lens and
  // deliberately outranks a mode pin, so leaving one on would mask the pin.
  await viewAs(null);
  const made = await retryApi("POST", "/api/modes", {
    name: "Close Friends",
    pinnedPersonaId: id(OWNER),
    notificationPolicy: "all",
  });
  if (made.status !== 200) throw new Error(`mode create failed: ${made.status} ${made.json?.error ?? ""}`);
  const act = await retryApi("POST", "/api/modes/active", { modeId: made.json.mode.id });
  if (act.status !== 200) throw new Error(`mode activate failed: ${act.status}`);

  await page.goto(BASE + "/home", { waitUntil: "networkidle" });
  // reliability: poll for the server-driven composer identity instead of a flat wait
  await pollUntil(async () => (await page.locator('[data-persona-kind="private"]').count()) > 0, { tries: 5, delayMs: 500, midway: () => page.reload({ waitUntil: "networkidle" }) });
  const kind = await page.locator("[data-persona-kind]").first().getAttribute("data-persona-kind");
  if (kind !== "private")
    throw new Error("activating a persona-pinned mode did not switch the composer identity");
  await reset();
});

await check("14. notificationPolicy is ENFORCED, not merely stored", async () => {
  await reset();
  await viewAs("yeak__");
  await page.goto(BASE + "/notifications", { waitUntil: "networkidle" });
  // reliability: poll for server-rendered rows instead of a flat wait; the vacuity assertion still runs
  await pollUntil(async () => (await page.locator("[data-testid=notification-row]").count()) > 0, { tries: 6, delayMs: 500, midway: () => page.reload({ waitUntil: "networkidle" }) });
  const baseline = await page.locator("[data-testid=notification-row]").count();
  if (baseline === 0) throw new Error("no notifications rendered at baseline — test is vacuous");

  const muted = await retryApi("POST", "/api/modes", { name: "Muted", notificationPolicy: "muted" });
  if (!muted.json?.mode) throw new Error(`mode create failed persistently: ${muted.status}`);
  await retryApi("POST", "/api/modes/active", { modeId: muted.json.mode.id });
  await page.goto(BASE + "/notifications", { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  const after = await page.locator("[data-testid=notification-row]").count();
  if (after !== 0) throw new Error(`muted mode still rendered ${after} notifications`);

  const mentions = await retryApi("POST", "/api/modes", {
    name: "Mentions",
    notificationPolicy: "mentions_only",
  });
  if (!mentions.json?.mode) throw new Error(`mode create failed persistently: ${mentions.status}`);
  await retryApi("POST", "/api/modes/active", { modeId: mentions.json.mode.id });
  await page.goto(BASE + "/notifications", { waitUntil: "networkidle" });
  // reliability: poll for the condition the assertion needs; a non-subset still fails below
  await pollUntil(async () => { const c = await page.locator("[data-testid=notification-row]").count(); return c > 0 && c < baseline; }, { tries: 6, delayMs: 500, midway: () => page.reload({ waitUntil: "networkidle" }) });
  const mentionCount = await page.locator("[data-testid=notification-row]").count();
  if (mentionCount === 0 || mentionCount >= baseline)
    throw new Error(`mentions_only rendered ${mentionCount} of ${baseline} — expected a strict subset`);
  await reset();
});

await check("15. actionButtonSlots are ENFORCED, not merely stored", async () => {
  await reset();
  await viewAs("yeak__");
  await page.goto(BASE + "/home", { waitUntil: "networkidle" });
  // reliability: poll for the fully-rendered default chrome instead of a flat wait
  await pollUntil(async () => (await page.locator("[data-testid=composer-action]").count()) >= 2 && (await page.locator("[data-testid=nav-item]").count()) >= 10, { tries: 5, delayMs: 500, midway: () => page.reload({ waitUntil: "networkidle" }) });
  const baseline = await page.locator("[data-testid=composer-action]").count();
  if (baseline < 2) throw new Error(`baseline composer has ${baseline} action buttons — test is vacuous`);
  const navBaseline = await page.locator("[data-testid=nav-item]").count();
  // Default must render the FULL sidebar. Enforcing a previously-dead field
  // made its stored values suddenly matter, and the presets shared a
  // three-item nav written when nothing read it — which amputated the
  // sidebar for every mode including Default. A floor of 3 would have passed
  // that; the real assertion is that Default restricts nothing.
  if (navBaseline < 10)
    throw new Error(`Default mode renders only ${navBaseline} nav items — it should not restrict`);

  const slim = await retryApi("POST", "/api/modes", {
    name: "Slim",
    actionButtonSlots: { composer: ["media"], nav: ["home"] },
  });
  if (!slim.json?.mode) throw new Error(`mode create failed persistently: ${slim.status}`);
  await retryApi("POST", "/api/modes/active", { modeId: slim.json.mode.id });
  await page.goto(BASE + "/home", { waitUntil: "networkidle" });
  // reliability: poll for the exact restricted counts; a genuine over-render still fails below
  await pollUntil(async () => (await page.locator("[data-testid=composer-action]").count()) === 1 && (await page.locator("[data-testid=nav-item]").count()) === 1, { tries: 5, delayMs: 500, midway: () => page.reload({ waitUntil: "networkidle" }) });
  const after = await page.locator("[data-testid=composer-action]").count();
  if (after !== 1) throw new Error(`composer:["media"] rendered ${after} buttons, expected 1`);

  // The NAV half of the same field. Enforcing only the composer half would
  // leave actionButtonSlots half-dead, which is the defect this gate exists
  // to close.
  const navItems = await page.locator("[data-testid=nav-item]").count();
  if (navItems !== 1)
    throw new Error(`nav:["home"] rendered ${navItems} items, expected 1`);
  const slot = await page.locator("[data-testid=nav-item]").first().getAttribute("data-slot");
  if (slot !== "home") throw new Error(`nav rendered slot "${slot}", expected home`);
  await reset();
});

// ---- 16. parity ----
await check("16. Replies, likes and bookmarks work on private posts", async () => {
  await reset();
  await viewAs(GRANTED);
  // reliability: retry the flaky list read; the original guard still runs
  const list = await retryContent(() => api("GET", "/api/private/posts"), (r) => (r.json?.posts ?? []).length > 0, 4);
  const target = (list.json?.posts ?? [])[0];
  if (!target) throw new Error("no private posts");

  // reliability: mutating writes retried on transient failure; original assertions still run
  const liked = await retryApi("POST", "/api/private/react", { hash: target.hash, action: "like" });
  if (liked.status !== 200) throw new Error(`like failed: ${liked.status}`);
  if (!(liked.json?.post?.likes ?? []).includes(id(GRANTED)))
    throw new Error("like did not record the viewer");

  const marked = await retryContent(() => api("POST", "/api/private/react", { hash: target.hash, action: "bookmark" }), (r) => (r.json?.post?.bookmarkedBy ?? []).includes(id(GRANTED)), 4);
  if (!(marked.json?.post?.bookmarkedBy ?? []).includes(id(GRANTED)))
    throw new Error("bookmark did not record the viewer");

  const reply = await retryApi("POST", "/api/private/posts", {
    text: "same, clouded out here too",
    replyToHash: target.hash,
  });
  if (reply.status !== 200) throw new Error(`reply failed: ${reply.status} ${reply.json?.error ?? ""}`);

  // reliability: settle the flaky thread read; the original assertion still runs
  const thread = await retryContent(() => api("GET", `/api/private/posts/${target.hash}`), (r) => (r.json?.replies ?? []).some((x) => x.text.includes("clouded out here too")), 4);
  if (!(thread.json?.replies ?? []).some((r) => r.text.includes("clouded out here too")))
    throw new Error("reply not returned with the thread");

  // and the reply is private too
  await viewAs(OUTSIDER);
  const leak = await feedText(OUTSIDER);
  if (leak.includes("clouded out here too")) throw new Error("FAIL-OPEN: a private reply reached an outsider");
  await reset();
});

// ---- 17. the search BOX, not just the search API ----
await check("17. The search input actually searches, and the page honours privacy", async () => {
  // Gate 1's lesson: an API-only assertion proves very little. Two search
  // inputs existed before this gate and neither had a handler — they were
  // styled divs. This drives the real one.
  await reset();
  await viewAs(GRANTED);
  await page.goto(BASE + "/explore", { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  const box = page.locator("[data-testid=search-input]").first();
  if ((await box.count()) === 0) throw new Error("no working search input on /explore");
  await box.fill(NEEDLE);
  await box.press("Enter");
  await page.waitForURL(/\/search\?q=/, { timeout: 8000 });
  // reliability: poll for the server-rendered results instead of a flat wait
  await pollUntil(async () => (await page.locator("body").innerText()).includes(NEEDLE), { tries: 8, delayMs: 500, midway: () => page.reload({ waitUntil: "networkidle" }) });

  const granted = await page.locator("body").innerText();
  if (!granted.includes(NEEDLE))
    throw new Error("granted viewer's search page does not show their private post");
  if ((await page.locator("[data-testid=search-private-badge]").count()) === 0)
    throw new Error("private result is not marked as shared-with-you");

  // the same URL as an outsider
  await viewAs(OUTSIDER);
  await page.goto(BASE + "/search?q=" + encodeURIComponent(NEEDLE), { waitUntil: "networkidle" });
  await page.waitForTimeout(700);
  const outsider = await page.locator("body").innerText();
  if (outsider.includes(NEEDLE.split(" ")[0] + " " + NEEDLE.split(" ")[1]) && outsider.includes("Shared with you"))
    throw new Error("FAIL-OPEN: outsider's search page rendered a private post");
  if ((await page.locator("[data-testid=search-post]").count()) > 0)
    throw new Error("FAIL-OPEN: outsider got post results for a private-only term");
  // reliability: settle the server-rendered empty state before the original assertion
  await pollUntil(async () => (await page.locator("[data-testid=search-empty]").count()) > 0, { tries: 4, delayMs: 500, midway: () => page.reload({ waitUntil: "networkidle" }) });
  if ((await page.locator("[data-testid=search-empty]").count()) === 0)
    throw new Error("outsider did not get the ordinary no-results page");
  await reset();
});

await viewAs(null);
await reset();
await browser.close();

const productFails = results.filter((r) => r[0] === "FAIL");
const infraFails = results.filter((r) => r[0] === "INFRA");
console.log(
  productFails.length === 0 && infraFails.length === 0
    ? `\n${results.length}/${results.length} Mega Gate 3 checks passed`
    : `\n${results.length - productFails.length - infraFails.length}/${results.length} passed, ${productFails.length} FAILED, ${infraFails.length} infra`
);
if (productFails.length) {
  console.log("\nProduct failures:");
  for (const r of productFails) console.log(`  - ${r[1]}: ${r[2]}`);
}
process.exit(productFails.length ? 1 : infraFails.length ? 2 : 0);
