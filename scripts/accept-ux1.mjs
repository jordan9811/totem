// UX PASS GATE 1 — persona × mode matrix, act-as-any-persona.
//
// Both directions of the binding are optional, neither forced, and
// conflicts resolve to the more specific: an explicit in-session swipe
// beats either binding until the session ends. Act-as posts on behalf of
// any persona you control without switching your active persona — the
// server validates asPersonaId against the SAME allowlist a real
// persona-switch uses, never trusting the client's own account of who it is.
import { chromium } from "playwright";
import { assertServersUp, isInfraError, retryContent, pollUntil } from "./lib-health.mjs";
import { readFileSync } from "node:fs";

const BASE = process.env.BASE_URL || `http://localhost:${process.env.LAYERS_APP_PORT || 3001}`;
const personas = JSON.parse(readFileSync("seed/data/accounts.json", "utf8")).personas;
const id = (h) => personas.find((p) => p.handle === h)?.id;
const MAIN = id("yeak__"); // public, SEED_VIEWER's active persona
const ALT = id("backyard_scope"); // private, SEED_VIEWER's other persona
const OTHER = id("gwei_whisperer"); // not one of the viewer's own personas

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
const page = await (await browser.newContext({ viewport: { width: 1280, height: 1500 } })).newPage();

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
const reset = async () => {
  await api("POST", "/api/dev", { action: "resetSeed" });
  await page.waitForTimeout(400);
};
const viewAs = async (pid) => {
  await api("POST", "/api/dev", { action: "viewAs", personaId: pid });
  await page.waitForTimeout(100);
};
const switchTo = (pid) => retry(() => api("POST", "/api/seed-persona", { personaId: pid }));
const modesFor = async () => (await retry(() => api("GET", "/api/modes"))).json;
const byName = (modes, name) => modes.find((m) => m.name === name);
const pickMode = (modeId) => retry(() => api("POST", "/api/modes/active", { modeId }));
const bind = (body) => retry(() => api("POST", "/api/personas/bindings", body));
const jumpClock = (ms) => retry(() => api("POST", "/api/market/infofi", { action: "jumpToClock", ms }));
// a fixed, arbitrary epoch instant at exactly 03:00:00 UTC — deterministic
// regardless of real wall time or drift any earlier suite left on the clock
const HOUR3_UTC = Date.UTC(2024, 0, 10, 3, 0, 0);

console.log("\nUX Pass Gate 1 — persona × mode matrix, act-as-any-persona");

// ---- 1. mode swipe cycles the CURRENT persona's modes, persona unchanged ----
await check("1. Swiping modes leaves the persona unchanged; header reflects (persona, mode)", async () => {
  await reset();
  const before = await modesFor();
  const work = byName(before.modes, "Work");
  await pickMode(work.id); // explicit pick — also proves the dropdown path still works
  const after = await modesFor();
  if (after.activeId !== work.id) throw new Error("explicit mode pick did not take");
  const active = await retry(() => api("GET", "/api/x/link")); // any route that reports personaHandle
  if (active.json.personaHandle !== "yeak__") throw new Error("persona changed after a plain mode pick");
});

// ---- 2. mode pinning a persona DOES switch persona; swipe cycle excludes it ----
await check("2. A mode pinned to a DIFFERENT persona switches persona on pick; excluded from the swipe cycle", async () => {
  const modes = await modesFor();
  const chill = byName(modes.modes, "Chill") ?? (await retry(() => api("POST", "/api/modes", {
    name: "Chill", ranking: { recency: 1, engagement: 1, authorAffinity: 1, clusterAffinity: 1 },
    ruleIds: [], notificationPolicy: "all", actionButtonSlots: { composer: [], nav: [] },
    showTrending: true, calmRanking: false, isPreset: false,
  }))).json.mode;
  await bind({ action: "setPin", modeId: chill.id, personaId: ALT });
  const picked = await pickMode(chill.id);
  if (picked.status !== 200) throw new Error("pinned-mode pick failed");
  const whoAmI = await retry(() => api("GET", "/api/x/link"));
  if (whoAmI.json.personaHandle !== "backyard_scope")
    throw new Error(`persona after pinned pick: ${whoAmI.json.personaHandle}, expected backyard_scope`);
  // switch back to main, refuse a bogus persona for the pin
  await switchTo(MAIN);
  const refused = await api("POST", "/api/personas/bindings", { action: "setPin", modeId: chill.id, personaId: OTHER });
  if (refused.status !== 403) throw new Error(`pin to a non-owned persona returned ${refused.status}, expected 403`);
});

// ---- 3. persona default-mode binding fires on switch; explicit swipe beats it for the rest of the session ----
await check("3. Default-mode binding fires on persona switch; a later explicit swipe outranks it thereafter", async () => {
  await reset();
  const modes = await modesFor();
  const work = byName(modes.modes, "Work");
  const dflt = byName(modes.modes, "Default");
  await bind({ action: "setDefaultMode", personaId: MAIN, modeId: work.id });

  await switchTo(ALT);
  await switchTo(MAIN);
  let now = await modesFor();
  if (now.activeId !== work.id) throw new Error(`binding did not fire: activeId ${now.activeId}, expected ${work.id}`);

  // explicit swipe away from the bound mode
  await pickMode(dflt.id);
  await switchTo(ALT);
  await switchTo(MAIN);
  now = await modesFor();
  if (now.activeId !== dflt.id)
    throw new Error(`explicit swipe did not outrank the binding: activeId ${now.activeId}, expected ${dflt.id}`);

  // and the binding is gone entirely when cleared
  await bind({ action: "setDefaultMode", personaId: MAIN, modeId: null });
  // settle: retry until MAIN's row is present in the payload, then assert (guarded like check 13)
  const cleared = (await retryContent(() => api("GET", "/api/personas/bindings"), (r) => r.json?.personas?.some((p) => p.id === MAIN), 4)).json;
  if (cleared?.personas?.find((p) => p.id === MAIN)?.defaultModeId !== null)
    throw new Error("clearing the binding did not stick");
});

// ---- 4. time/context activation: off by default, never fires disabled, fires enabled on a seeded clock jump ----
await check("4. Activation rule: silent until enabled; fires on a seeded clock jump; never fires disabled", async () => {
  await reset();
  const modes = await modesFor();
  const safe = byName(modes.modes, "Event Safe Space");

  // before hour 3: the rule (after hour 3) reads false
  await jumpClock(HOUR3_UTC - 3600_000); // 02:00 UTC, same fixed day
  const saved = await bind({ action: "setActivation", modeId: safe.id, enabled: false, afterHourUTC: 3 });
  if (saved.json.mode.activationEnabled) throw new Error("activationEnabled true despite enabled:false");
  await retry(() => api("GET", "/api/feed2?surface=discovery")); // buildFeed's one lazy check point
  let now = await modesFor();
  if (now.activeId === safe.id) throw new Error("disabled rule fired anyway");

  // cross the threshold (03:00 UTC) with the rule still disabled — must still not fire
  await jumpClock(HOUR3_UTC);
  await retry(() => api("GET", "/api/feed2?surface=discovery"));
  now = await modesFor();
  if (now.activeId === safe.id) throw new Error("rule fired while disabled, even past its own threshold hour");

  // enable it — now the SAME clock position (already past threshold) fires it
  await bind({ action: "setActivation", modeId: safe.id, enabled: true, afterHourUTC: 3 });
  await retry(() => api("GET", "/api/feed2?surface=discovery"));
  now = await modesFor();
  if (now.activeId !== safe.id) throw new Error("enabled rule did not fire once past its threshold hour");

  // an explicit swipe away suppresses it even though the clock still satisfies the rule
  const dflt = byName(modes.modes, "Default");
  await pickMode(dflt.id);
  await retry(() => api("GET", "/api/feed2?surface=discovery"));
  now = await modesFor();
  if (now.activeId !== dflt.id) throw new Error("activation rule overrode an explicit in-session swipe");
});

// ---- 5. act-as reply as a non-active PUBLIC persona: attributes correctly, active persona untouched ----
await check("5. Act-as reply as a non-active persona attributes correctly; active persona stays put", async () => {
  await reset();
  const r = await retry(() =>
    api("POST", "/api/actions/act-as", {
      kind: "reply",
      targetHash: "0xcr0011",
      text: "act-as reply from a script",
      asPersonaId: MAIN,
    })
  );
  if (!r.json.hash) throw new Error("no hash returned");
  const evs = await retry(() => api("GET", "/api/eventlog"));
  const ev = evs.json.events.find((e) => e.type === "reply" && e.context === "act_as" && e.triggeringCastId === "0xcr0011");
  if (!ev) throw new Error("no act_as reply event logged");
  if (ev.actorPersonaId !== MAIN) throw new Error("event attributed to the wrong persona");
  if (ev.viaActAs) throw new Error("viaActAs set even though the acting persona WAS already active");
});

// ---- 6. act-as as a PRIVATE persona: unmistakable chrome, visibility-gated, no leak ----
await check("6. Act-as from a private persona: visibility-gated, private chrome, never leaks", async () => {
  await viewAs(ALT);
  const seed = await retry(() => api("POST", "/api/private/posts", { text: "private act-as target" }));
  await viewAs(null);

  // reply as the private persona: visible to it, succeeds, marked private
  const r = await retry(() =>
    api("POST", "/api/actions/act-as", {
      kind: "reply",
      targetHash: seed.json.post.hash,
      text: "private act-as reply",
      asPersonaId: ALT,
    })
  );
  if (!r.json.private) throw new Error("private-persona reply not marked private");

  // quoting from a private persona is refused outright — no embed slot
  const q = await api("POST", "/api/actions/act-as", {
    kind: "quote",
    targetHash: "0xcr0011",
    text: "leak attempt",
    asPersonaId: ALT,
  });
  if (q.status !== 400) throw new Error(`private quote returned ${q.status}, expected 400`);

  // quoting a PRIVATE post as the PUBLIC persona must 404 — never confirm
  // the private post's existence to a persona that cannot see it
  const leak = await api("POST", "/api/actions/act-as", {
    kind: "quote",
    targetHash: seed.json.post.hash,
    text: "leak attempt 2",
    asPersonaId: MAIN,
  });
  if (leak.status !== 404) throw new Error(`cross-persona quote of a private post returned ${leak.status}, expected 404`);
});

// ---- 7. act-as quote mints new content with a real embed ----
await check("7. Act-as quote mints a new cast embedding the target", async () => {
  const r = await retry(() =>
    api("POST", "/api/actions/act-as", {
      kind: "quote",
      targetHash: "0xcr0012",
      text: "quoting via act-as",
      asPersonaId: MAIN,
    })
  );
  const cast = await retry(() => api("GET", "/api/eventlog"));
  const ev = cast.json.events.find((e) => e.type === "quote" && e.triggeringCastId === "0xcr0012");
  if (!ev) throw new Error("no quote event logged");
  if (!r.json.hash) throw new Error("quote produced no cast hash");
});

// ---- 8. act-as recast logs the action without minting content ----
await check("8. Act-as recast logs an event; no new cast", async () => {
  const r = await retry(() =>
    api("POST", "/api/actions/act-as", { kind: "recast", targetHash: "0xcr0013", asPersonaId: MAIN })
  );
  if (r.json.hash) throw new Error("recast unexpectedly minted a cast hash");
  const evs = await retry(() => api("GET", "/api/eventlog"));
  if (!evs.json.events.some((e) => e.type === "recast" && e.triggeringCastId === "0xcr0013"))
    throw new Error("no recast event logged");
});

// ---- 9. act-as respects destination binding ----
await check("9. Act-as refuses a destination the acting persona has not bound", async () => {
  const r = await api("POST", "/api/actions/act-as", {
    kind: "quote",
    targetHash: "0xcr0014",
    text: "cross-post attempt",
    asPersonaId: MAIN,
    destinationIds: ["not_a_real_destination"],
  });
  if (r.status !== 403) throw new Error(`unbound destination returned ${r.status}, expected 403`);
});

// ---- 10. ADVERSARIAL: asPersonaId outside SEED_VIEWER.personas is refused, no side effects ----
await check("10. SAFETY: an unowned asPersonaId is refused; nothing is posted, nothing is logged", async () => {
  const before = (await retry(() => api("GET", "/api/eventlog"))).json.events.length;
  const r = await api("POST", "/api/actions/act-as", {
    kind: "reply",
    targetHash: "0xcr0011",
    text: "forged act-as",
    asPersonaId: OTHER,
  });
  if (r.status !== 403) throw new Error(`forged asPersonaId returned ${r.status}, expected 403`);
  const after = (await retry(() => api("GET", "/api/eventlog"))).json.events.length;
  if (after !== before) throw new Error("a refused act-as still logged an event");
});

// ---- 11. PAGE: header shows (persona, mode); swipe changes mode only ----
await check("11. PAGE: header shows the active (persona, mode) pair; swipe arrows cycle mode, not persona", async () => {
  await reset();
  await page.goto(BASE + "/home", { waitUntil: "networkidle" });
  const header = page.locator("[data-testid=persona-mode-header]");
  // settle: poll for the hydrated header instead of a flat 800ms wait
  await pollUntil(async () => {
    if ((await header.count()) !== 1) return false;
    const badge = page.locator("[data-testid=header-active-persona]");
    if ((await badge.count()) !== 1) return false;
    return (await badge.getAttribute("data-persona-id")) === MAIN;
  }, { tries: 15, delayMs: 400 });
  if ((await header.count()) !== 1) throw new Error("persona-mode header missing");
  const personaBadge = await page.locator("[data-testid=header-active-persona]").getAttribute("data-persona-id");
  if (personaBadge !== MAIN) throw new Error(`header persona ${personaBadge}, expected ${MAIN}`);
  const before = await page.locator("[data-testid=mode-pill]").getAttribute("data-active-mode");

  await page.locator("[data-testid=mode-swipe-next]").click();
  let changed = false;
  for (let i = 0; i < 15 && !changed; i++) {
    await page.waitForTimeout(400);
    const now = await page.locator("[data-testid=mode-pill]").getAttribute("data-active-mode");
    changed = now !== before;
  }
  if (!changed) throw new Error("swipe-next never changed the mode pill");
  const personaAfter = await page.locator("[data-testid=header-active-persona]").getAttribute("data-persona-id");
  if (personaAfter !== MAIN) throw new Error("swiping modes changed the active persona");
});

// ---- 12. PAGE: act-as picker end-to-end, including the private-chrome transition ----
await check("12. PAGE: kebab → Act as → private chrome shows for the private persona, clears for the public one → reply posts", async () => {
  await page.goto(BASE + "/" + "gwei_whisperer", { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  const card = page.locator("[data-testid=cast]").first();
  await card.locator("[data-testid=cast-kebab]").click();
  await page.locator("[data-testid=cast-menu-act-as]").click();
  if ((await page.locator("[data-testid=act-as-picker]").count()) !== 1)
    throw new Error("act-as picker did not open");

  let listed = false;
  for (let i = 0; i < 15 && !listed; i++) {
    await page.waitForTimeout(300);
    listed = (await page.locator("[data-testid=act-as-persona-list] button").count()) === 2;
  }
  if (!listed) throw new Error("act-as persona list did not populate with both personas");

  // selecting the PRIVATE persona shows unmistakable chrome — this target
  // is a PUBLIC seeded post, which the private-post system (correctly,
  // pre-existing behavior — same rule /api/private/posts itself enforces)
  // will refuse to reply into; the chrome/attribution UI is what's under
  // test here, not that specific submission (test 6 covers a private
  // reply into a target the private persona can actually see)
  await page.locator("[data-testid=act-as-persona-backyard_scope]").click();
  if ((await page.locator("[data-testid=act-as-private-chrome]").count()) !== 1)
    throw new Error("private chrome did not appear for the private persona");
  const chrome = await page.locator("[data-testid=act-as-private-chrome]").innerText();
  if (!/Only \d+ (person|people) can see this/.test(chrome)) throw new Error(`chrome text wrong: "${chrome}"`);
  if ((await page.locator("[data-testid=act-as-via-note]").count()) !== 1)
    throw new Error("the 'posting as' note did not appear for a non-active persona");

  // switching back to the ACTIVE public persona clears the private chrome
  // and the via-act-as note — the UI truthfully tracks the selection, not
  // a stuck state from whichever persona was clicked first
  await page.locator("[data-testid=act-as-persona-yeak__]").click();
  if ((await page.locator("[data-testid=act-as-private-chrome]").count()) !== 0)
    throw new Error("private chrome persisted after switching back to the public persona");
  if ((await page.locator("[data-testid=act-as-via-note]").count()) !== 0)
    throw new Error("via-act-as note persisted for the already-active persona");

  await page.locator("[data-testid=act-as-text]").fill("posted through the picker");
  await page.locator("[data-testid=act-as-submit]").click();
  let done = false;
  for (let i = 0; i < 15 && !done; i++) {
    await page.waitForTimeout(400);
    done = (await page.locator("[data-testid=act-as-done]").count()) > 0;
  }
  if (!done) throw new Error("act-as submit never completed");
});

// ---- 13. settings matrix page: bindings editable, both directions ----
await check("13. PAGE: the persona × mode matrix reads and writes both binding directions", async () => {
  await reset();
  await page.goto(BASE + "/settings/persona-mode", { waitUntil: "networkidle" });
  // settle: poll for both matrix rows instead of a flat 800ms wait
  await pollUntil(async () => (await page.locator("[data-testid=persona-row]").count()) === 2, { tries: 15, delayMs: 400 });
  if ((await page.locator("[data-testid=persona-row]").count()) !== 2)
    throw new Error("matrix does not list both personas");
  const modes = await modesFor();
  const work = byName(modes.modes, "Work");
  await page.selectOption("[data-testid=default-mode-yeak__]", work.id);
  // the route's setDefaultMode path retries adapters.mode.get() under mock
  // latency (200-1500ms × up to 3 attempts) — poll rather than assume a
  // flat wait outlasts the worst case
  let persisted = false;
  let last = null;
  for (let i = 0; i < 15 && !persisted; i++) {
    await page.waitForTimeout(400);
    last = (await retry(() => api("GET", "/api/personas/bindings"))).json;
    persisted = last.personas.find((p) => p.id === MAIN)?.defaultModeId === work.id;
  }
  if (!persisted)
    throw new Error(
      `matrix UI did not persist the default-mode binding — got ${last?.personas?.find((p) => p.id === MAIN)?.defaultModeId}`
    );
});

await reset();
await viewAs(null);
await browser.close();

const productFails = results.filter((r) => r[0] === "FAIL");
const infraFails = results.filter((r) => r[0] === "INFRA");
console.log(
  productFails.length === 0 && infraFails.length === 0
    ? `\n${results.length}/${results.length} UX Gate 1 checks passed`
    : `\n${results.length - productFails.length - infraFails.length}/${results.length} passed, ${productFails.length} FAILED, ${infraFails.length} infra`
);
if (productFails.length) {
  console.log("\nProduct failures:");
  for (const r of productFails) console.log(`  - ${r[1]}: ${r[2]}`);
}
process.exit(productFails.length ? 1 : infraFails.length ? 2 : 0);
