// MEGA GATE 2 — FORKING. The recovery mechanic.
//
// The premise: a leaked linkage cannot be un-leaked, so the product's answer
// is "move". Mint a fresh persona, carry forward the grant-holders you still
// trust, and publish a forward pointer only THEY can resolve. The leaker is
// left holding a pointer to a persona that has stopped mattering.
//
// Test 1 is the containment test and it was written FIRST, before the moved
// card existed. A forward pointer that leaks through the injection queue to a
// dropped holder does not merely fail this gate — it inverts the feature,
// because the person you forked away from is exactly the person who must not
// be told where you went.
import { chromium } from "playwright";
import { assertServersUp, isInfraError, retryContent, pollUntil } from "./lib-health.mjs";
import { readFileSync } from "node:fs";

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

async function api(method, url, body) {
  const res = await page.request.fetch(BASE + url, {
    method,
    headers: { "Content-Type": "application/json" },
    data: body === undefined ? undefined : JSON.stringify(body),
  });
  let json = null;
  try {
    json = await res.json();
  } catch {}
  return { status: res.status(), json };
}

/** Load a page AS a given persona and return its DOM facts. */
async function pageAs(path, viewerHandle) {
  // retried so a transient viewAs failure cannot leave the prior viewer active (audit)
  await retryContent(
    () =>
      api("POST", "/api/dev", {
        action: "viewAs",
        personaId: viewerHandle ? id(viewerHandle) : null,
      }),
    (r) => r.status === 200,
    3
  );
  await page.waitForTimeout(200);
  await page.goto(BASE + path, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  return {
    moved: await page.locator("[data-testid=moved-card]").count(),
    casts: await page.locator("[data-testid=cast]").count(),
    body: await page.locator("body").innerText(),
  };
}

const LEAKER = "crustcritic"; // the designated betrayer in the seeded drama
const KEEPER = "yeak__"; // the grant-holder carried forward
const VICTIM = "brothandbones"; // whitelist-linked to linescoreluke

async function freshFork(from = VICTIM, carry = [KEEPER]) {
  // retry the whole reset+fork round (the reset makes it idempotent) so a synthetic adapter failure cannot flake every test (audit)
  const r = await retryContent(
    async () => {
      await api("POST", "/api/dev", { action: "resetSeed" });
      await page.waitForTimeout(600);
      return api("POST", "/api/identity/fork", {
        fromPersona: id(from),
        carry: carry.map(id),
        newName: "Broth and Bones",
        newHandle: "brothandbones_new",
      });
    },
    (x) => x.status === 200 && !!x.json?.newPersona,
    4
  );
  if (r.status !== 200) throw new Error(`fork failed: ${r.status} ${r.json?.error ?? ""}`);
  return r.json;
}

console.log("\nMega Gate 2 — Forking");

// ---- 1. CONTAINMENT (written before the card existed) ----
await check("1. Forward pointer does NOT reach the dropped holder — UI or forced adapter call", async () => {
  const fork = await freshFork();

  // (a) forced adapter call: the dropped holder asks the API directly
  // retried until the read itself succeeds, so a dropped read cannot vacuously pass containment (audit)
  const forced = await retryContent(
    () => api("GET", `/api/identity/fork?resolve=${id(VICTIM)}&viewerPersonaId=${id(LEAKER)}`),
    (r) => r.status === 200,
    4
  );
  if (forced.json?.moved)
    throw new Error(`FAIL-OPEN: dropped holder resolved the pointer to ${forced.json.moved}`);
  if (forced.json?.persona) throw new Error("FAIL-OPEN: dropped holder got the new persona object");

  // (b) the rendered timeline — the surface that actually ships
  const feed = await pageAs("/home", LEAKER);
  if (feed.moved > 0) throw new Error("FAIL-OPEN: moved card injected into the dropped holder's feed");
  if (feed.body.includes(fork.newHandle))
    throw new Error("FAIL-OPEN: new handle leaked into dropped holder's feed text");
  if (feed.body.includes("Broth and Bones"))
    throw new Error("FAIL-OPEN: new display name leaked into dropped holder's feed");

  // (c) the old persona's profile, viewed by the leaker: still no pointer
  const prof = await pageAs("/" + VICTIM, LEAKER);
  if (prof.body.includes(fork.newHandle))
    throw new Error("FAIL-OPEN: new handle leaked onto the old profile for the leaker");

  // (d) an unrelated third party sees nothing either
  const third = await pageAs("/home", "drivethru_dave");
  if (third.moved > 0) throw new Error("FAIL-OPEN: moved card shown to an unrelated viewer");
  if (third.body.includes(fork.newHandle))
    throw new Error("FAIL-OPEN: new handle leaked to an unrelated viewer");
});

// ---- 2. the carried holder DOES get it (a negative case needs a positive) ----
await check("2. Carried holder sees the moved card and can resolve the pointer", async () => {
  const fork = await freshFork();
  // settle the read with retries; the original assertions below still decide (audit)
  const resolved = await retryContent(
    () => api("GET", `/api/identity/fork?resolve=${id(VICTIM)}&viewerPersonaId=${id(KEEPER)}`),
    (r) => r.status === 200 && !!r.json?.moved,
    4
  );
  if (!resolved.json?.moved) throw new Error("carried holder could not resolve the forward pointer");
  if (resolved.json.moved !== fork.newPersona) throw new Error("pointer resolved to the wrong persona");
  if (resolved.json.persona?.handle !== fork.newHandle)
    throw new Error("resolved persona object missing or incorrect");

  // the moved card arrives via the injection queue after load — re-render (server-rendered feed) until it lands, then run the original assertions (audit: flat-wait)
  const feed = await retryContent(
    () => pageAs("/home", KEEPER),
    (r) => r.moved > 0 && r.body.includes(fork.newHandle),
    4
  );
  if (feed.moved === 0) throw new Error("carried holder's feed has no moved card");
  if (!feed.body.includes(fork.newHandle)) throw new Error("moved card does not name the new persona");
});

// ---- 3. reputation carries — the whole point of rep living on the root ----
await check("3. New persona's tier equals the root's tier immediately", async () => {
  const fork = await freshFork();
  // each tier read retried past the synthetic failure rate; assertions unchanged (audit)
  const before = await retryContent(() => api("GET", `/api/tier?personaId=${id(VICTIM)}`), (r) => r.json?.tier !== undefined, 4);
  const after = await retryContent(() => api("GET", `/api/tier?personaId=${fork.newPersona}`), (r) => r.json?.tier !== undefined, 4);
  const t0 = before.json?.tier;
  const t1 = after.json?.tier;
  if (t0 === undefined || t1 === undefined)
    throw new Error(`tier unreadable (before=${t0} after=${t1})`);
  if (t0 !== t1) throw new Error(`tier did not carry: root ${t0} vs forked ${t1}`);
  if (fork.tier !== t0)
    throw new Error(`fork response tier ${fork.tier} disagrees with rep adapter ${t0}`);
});

// ---- 4. the old persona is not destroyed ----
await check("4. Old persona stays live with its history intact", async () => {
  // settle per-item cast hydration before measuring; original assertions unchanged (audit: content-gap)
  const beforeFork = await retryContent(() => pageAs("/" + VICTIM, KEEPER), (r) => r.casts > 0, 3);
  const had = beforeFork.casts;
  if (!had) throw new Error("pre-fork profile rendered no posts — test cannot measure history");
  await freshFork();
  // retried so a per-item cast drop cannot spuriously undercount; a genuine loss still fails below (audit: content-gap)
  const prof = await retryContent(() => pageAs("/" + VICTIM, KEEPER), (r) => r.casts >= had, 3);
  if (!prof.body.includes(VICTIM)) throw new Error("old persona profile no longer renders");
  if (prof.casts < had)
    throw new Error(`history lost: ${had} posts before fork, ${prof.casts} after`);
});

// ---- 5. carried grants reissued under the new persona ----
await check("5. Carried grants reissue to the REAL sibling, and a move is not a linkage", async () => {
  const fork = await freshFork();
  // retried past dropped reads and fail-closed degraded rounds; the original assertion still decides (audit)
  const keeper = await retryContent(
    () => api("GET", `/api/identity?personaId=${fork.newPersona}&viewerPersonaId=${id(KEEPER)}`),
    (r) => r.status === 200 && !!r.json?.identity?.linked,
    4
  );
  const linked = keeper.json?.identity?.linked;
  if (!linked) throw new Error("carried holder cannot resolve the new persona linkage");
  // The bug this encodes: forward pointers and linkage grants shared a table,
  // so the resolver merged the fork's old and new persona into one displayed
  // identity — wrong (they are not simultaneous) and destructive (it crowded
  // out the genuine sibling). A move is not a linkage.
  if (linked.handle !== "linescoreluke")
    throw new Error(`reissued linkage points at ${linked.handle}, not the real sibling`);

  const oldSide = await api(
    "GET",
    `/api/identity?personaId=${id(VICTIM)}&viewerPersonaId=${id(KEEPER)}`
  );
  const oldLinked = oldSide.json?.identity?.linked;
  if (oldLinked && oldLinked.id === fork.newPersona)
    throw new Error("the forward pointer is being rendered as a simultaneous linkage");

  // the read must succeed for the negative assertion to prove anything (audit: vacuous-pass shape)
  const leaker = await retryContent(
    () => api("GET", `/api/identity?personaId=${fork.newPersona}&viewerPersonaId=${id(LEAKER)}`),
    (r) => r.status === 200,
    4
  );
  if (leaker.json?.identity?.linked)
    throw new Error("FAIL-OPEN: dropped holder resolved the NEW persona linkage");
});

// ---- 6. the mechanic composes ----
await check("6. Re-fork: forking the fork works and keeps containment", async () => {
  const first = await freshFork();
  const second = await api("POST", "/api/identity/fork", {
    fromPersona: first.newPersona,
    carry: [], // trust nobody the second time
    newName: "BnB",
    newHandle: "bnb_third",
  });
  if (second.status !== 200)
    throw new Error(`re-fork failed: ${second.status} ${second.json?.error ?? ""}`);
  if (second.json.newPersona === first.newPersona) throw new Error("re-fork returned the same persona");

  // the first-round keeper was NOT carried this time, so they lose the trail
  // the read must succeed for the negative assertion to prove anything (audit: vacuous-pass shape)
  const keeperTries = await retryContent(
    () => api("GET", `/api/identity/fork?resolve=${first.newPersona}&viewerPersonaId=${id(KEEPER)}`),
    (r) => r.status === 200,
    4
  );
  if (keeperTries.json?.moved)
    throw new Error("FAIL-OPEN: holder dropped on the second fork still resolved the pointer");

  // and the original pointer still resolves for them — forking forward does
  // not retroactively erase what they were legitimately told
  // resolve read retried; the original assertion still decides (audit)
  const original = await retryContent(
    () => api("GET", `/api/identity/fork?resolve=${id(VICTIM)}&viewerPersonaId=${id(KEEPER)}`),
    (r) => r.status === 200 && r.json?.moved !== undefined,
    4
  );
  if (original.json?.moved !== first.newPersona)
    throw new Error("first-hop pointer broke after re-fork");
});

// ---- 7. the wizard is real ----
await check("7. Fork wizard lists real grant holders and the leaker is unchecked by default", async () => {
  await api("POST", "/api/dev", { action: "resetSeed" });
  // poll for the restored grant graph instead of a fixed settle (audit: flat-wait)
  await pollUntil(
    async () =>
      ((await api("GET", `/api/identity/fork?personaId=${id(VICTIM)}`)).json?.holders ?? []).length >= 2,
    { tries: 8, delayMs: 300 }
  );
  // holders read retried past per-item drops; original assertions unchanged (audit: content-gap)
  const holders = await retryContent(
    () => api("GET", `/api/identity/fork?personaId=${id(VICTIM)}`),
    (r) => {
      const h = (r.json?.holders ?? []).map((x) => x.handle);
      return h.includes(KEEPER) && h.includes(LEAKER);
    }
  );
  const hs = (holders.json?.holders ?? []).map((h) => h.handle);
  if (!hs.includes(KEEPER)) throw new Error(`wizard missing grant holder ${KEEPER}: got ${hs.join(",")}`);
  if (!hs.includes(LEAKER)) throw new Error(`wizard missing grant holder ${LEAKER}: got ${hs.join(",")}`);

  await api("POST", "/api/dev", { action: "viewAs", personaId: id(VICTIM) });
  await page.goto(BASE + "/settings/identity/fork", { waitUntil: "networkidle" });
  // poll for the hydrated holder checkboxes instead of a fixed settle; the list is server-backed so a midway reload is safe (audit: flat-wait)
  await pollUntil(
    async () =>
      (await page.locator(`[data-testid=carry-${id(LEAKER)}]`).count()) > 0 &&
      (await page.locator(`[data-testid=carry-${id(KEEPER)}]`).count()) > 0,
    { tries: 10, delayMs: 400, midway: () => page.reload({ waitUntil: "networkidle" }) }
  );
  const body = await page.locator("body").innerText();
  if (!body.includes(KEEPER)) throw new Error("fork wizard page does not list grant holders");
  const leakerBox = page.locator(`[data-testid=carry-${id(LEAKER)}]`);
  if ((await leakerBox.count()) === 0) throw new Error("fork wizard has no checkbox for the leaker");
  if (await leakerBox.isChecked())
    throw new Error("the designated leaker is checked by default — the demo must not pre-trust them");
  const keeperBox = page.locator(`[data-testid=carry-${id(KEEPER)}]`);
  if (!(await keeperBox.isChecked())) throw new Error("a trusted holder is unchecked by default");
});

await api("POST", "/api/dev", { action: "viewAs", personaId: null });
await api("POST", "/api/dev", { action: "resetSeed" });
await browser.close();

const productFails = results.filter((r) => r[0] === "FAIL");
const infraFails = results.filter((r) => r[0] === "INFRA");
console.log(
  productFails.length === 0 && infraFails.length === 0
    ? `\n${results.length}/${results.length} Mega Gate 2 checks passed`
    : `\n${results.length - productFails.length - infraFails.length}/${results.length} passed, ${productFails.length} FAILED, ${infraFails.length} infra`
);
if (productFails.length) {
  console.log("\nProduct failures:");
  for (const r of productFails) console.log(`  - ${r[1]}: ${r[2]}`);
}
process.exit(productFails.length ? 1 : infraFails.length ? 2 : 0);
