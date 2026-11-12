// TIER A GATE 1 — the relationship event log.
//
// The invariant that outranks the features: the log contains only actions
// the user TOOK. Test 5 attacks that from both sides — the schema (grep) and
// the runtime (a forged impression through the real adapter path).
import { chromium } from "playwright";
import { assertServersUp, isInfraError, retryContent } from "./lib-health.mjs";
import { readFileSync } from "node:fs";

const BASE = process.env.BASE_URL || `http://localhost:${process.env.LAYERS_APP_PORT || 3001}`;
const personas = JSON.parse(readFileSync("seed/data/accounts.json", "utf8")).personas;
const byHandle = new Map(personas.map((p) => [p.handle, p]));
const id = (h) => {
  const p = byHandle.get(h);
  if (!p) throw new Error(`seed handle not found: ${h}`);
  return p.id;
};
const viewer = JSON.parse(readFileSync("seed/data/viewer.json", "utf8")).viewer;

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
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1200 } });
const page = await ctx.newPage();

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
  // reliability: retry the reset and fail loudly (INFRA) rather than proceeding on stale state
  const r = await retryContent(
    () => api("POST", "/api/dev", { action: "resetSeed" }),
    (x) => x.status >= 200 && x.status < 300,
    4
  );
  if (r.status < 200 || r.status >= 300)
    throw new Error(`INFRA: seed reset failed: status ${r.status} ${r.json?.error ?? ""}`);
  await page.waitForTimeout(400);
};
// reliability: settle CONTENT (optional per-call `complete` on the events array), not just status,
// before callers assert exact counts; retryContent returns the last result so assertions still run.
const events = async (complete) =>
  (
    await retryContent(
      () => retry(() => api("GET", "/api/eventlog")),
      (r) => Array.isArray(r.json?.events) && (!complete || complete(r.json.events)),
      4
    )
  ).json.events;
const ofType = (evs, type, target) =>
  evs.filter((e) => e.type === type && (!target || e.targetPersona === target) && !e.backfilled);

console.log("\nTier A Gate 1 — Relationship event log");

// ---- 1. follow produces exactly one event with the right receipts ----
await check("1. Follow produces exactly ONE event with target, context and triggering cast", async () => {
  await reset();
  const target = id("gwei_whisperer");
  const before = ofType(await events(), "follow", target).length;
  await retry(() =>
    api("POST", "/api/follow", {
      personaId: target,
      follow: true,
      triggeringCastId: "0xcr0001",
      context: "hover_card",
    })
  );
  const after = ofType(await events((es) => ofType(es, "follow", target).length > before), "follow", target);
  if (after.length - before !== 1)
    throw new Error(`expected exactly one new follow event, got ${after.length - before}`);
  const e = after[after.length - 1];
  if (e.triggeringCastId !== "0xcr0001") throw new Error(`triggering cast lost: ${e.triggeringCastId}`);
  if (e.context !== "hover_card") throw new Error(`context lost: ${e.context}`);
  // and the graph actually changed — follow is no longer chrome
  // reliability: re-fetch a transiently incomplete graph read before asserting membership
  const f = await retryContent(
    () => retry(() => api("GET", "/api/follow")),
    (r) => r.json.following.includes(target),
    4
  );
  if (!f.json.following.includes(target)) throw new Error("follow event logged but the graph did not change");
});

// ---- 2. exactly-one survives injected write failures, internal AND client ----
await check("2. Exactly-one survives forced record() failures — internal budget exhausted, client retry recovers", async () => {
  await reset();
  const target = id("secondhelpingsara");
  // Force enough record() failures to EXHAUST the route's 3-attempt internal
  // retryAdapter, so the first HTTP POST is guaranteed to 503. The client then
  // retries the identical POST — and because a follow's event id is now
  // content-derived (type+actor+target+cast+context), that client retry lands
  // on the SAME id, so idempotent put-by-id still keeps exactly one event.
  //
  // This is the property the old code lacked: ids were minted with randomBytes,
  // so a client retry logged a SECOND event. That is why this test could only
  // ever force ONE failure and had to leave internal-retry headroom against the
  // mocks' 2% injection (a real ~2%-per-run flake, seen as an INFRA in the
  // crypto-pass 4-sweep). It can now force past the whole internal budget and
  // lean on the client retry, with margin to spare.
  await api("POST", "/api/dev", { action: "forceFail", label: "eventLog.record", count: 3 });
  const r = await retry(() =>
    api("POST", "/api/follow", { personaId: target, follow: true, context: "profile" })
  );
  if (r.status !== 200)
    throw new Error(`follow never recovered under injected faults: ${r.status} ${r.json?.error ?? ""}`);
  const n = ofType(await events((es) => ofType(es, "follow", target).length >= 1), "follow", target).length;
  if (n !== 1) throw new Error(`expected exactly 1 follow event after internal+client retries, got ${n}`);
});

// ---- 3. block from the cast menu carries the triggering cast ----
await check("3. Block from the cast menu logs one event naming the cast", async () => {
  await reset();
  const target = id("drivethru_dave");
  await retry(() =>
    api("POST", "/api/block-seed", { personaId: target, triggeringCastId: "0xfd0003", context: "cast_menu" })
  );
  const evs = ofType(await events((es) => ofType(es, "block", target).length >= 1), "block", target);
  if (evs.length !== 1) throw new Error(`expected 1 block event, got ${evs.length}`);
  if (evs[0].triggeringCastId !== "0xfd0003") throw new Error("block lost its triggering cast");
  if (evs[0].context !== "cast_menu") throw new Error(`block context: ${evs[0].context}`);
});

// ---- 4. facet toggles log both directions ----
await check("4. Facet follow and unfollow each log one event", async () => {
  await reset();
  // reliability: retry until the facets list actually has content before asserting on it
  const facets = await retryContent(
    () => retry(() => api("GET", "/api/disclosure/facets?personaId=" + id("basisrisk"))),
    (r) => (r.json?.facets?.length ?? 0) > 0,
    4
  );
  const facet = facets.json.facets?.[0];
  if (!facet) throw new Error("no seeded facet to toggle");
  await retry(() => api("POST", "/api/disclosure/facets", { facetId: facet.id, follow: true }));
  await retry(() => api("POST", "/api/disclosure/facets", { facetId: facet.id, follow: false }));
  const evs = await events(
    (es) => ofType(es, "facet_follow", facet.id).length >= 1 && ofType(es, "facet_unfollow", facet.id).length >= 1
  );
  if (ofType(evs, "facet_follow", facet.id).length !== 1) throw new Error("facet_follow not logged once");
  if (ofType(evs, "facet_unfollow", facet.id).length !== 1) throw new Error("facet_unfollow not logged once");
});

// ---- 5. impressions are unrepresentable, schema AND runtime ----
await check("5. No impression event is representable — schema and runtime both refuse", async () => {
  const schema = readFileSync("lib/eventlog/types.ts", "utf8");
  const union = schema.slice(schema.indexOf("EDGE_EVENT_TYPES"), schema.indexOf("] as const"));
  for (const word of ["view", "impression", "dwell", "seen", "scroll"]) {
    if (union.toLowerCase().includes(word))
      throw new Error(`schema union contains forbidden type word "${word}"`);
  }
  for (const forged of ["impression", "view", "dwell_time"]) {
    const r = await api("POST", "/api/dev", { action: "forgeEvent", type: forged });
    if (r.json?.recorded !== false)
      throw new Error(`runtime accepted a forged "${forged}" event — the guard is not holding`);
  }
  // and the refusal is loud, not a silent drop
  const r = await api("POST", "/api/dev", { action: "forgeEvent", type: "impression" });
  if (!/not representable/.test(r.json?.refused ?? ""))
    throw new Error("refusal does not explain itself");
});

// ---- 6. co-interaction: reply, later follow -> pair resolves to the reply ----
await check("6. Co-interaction: reply in a thread, later follow the OP — pair resolves to that reply", async () => {
  await reset();
  // OP must be someone the viewer does NOT already follow.
  const op = "quietvalidator";
  const opId = id(op);
  const f0 = await retry(() => api("GET", "/api/follow"));
  if (f0.json.following.includes(opId)) throw new Error("seed drift: viewer already follows the OP");

  // a seeded post authored by the OP
  const posts = JSON.parse(readFileSync("seed/data/posts.json", "utf8")).posts;
  const parent = posts.find((p) => p.authorPersonaId === opId && !p.replyToHash);
  if (!parent) throw new Error("no seeded post by the OP");

  // The cast route needs the phase-1 session: stub signer AND a persona —
  // session.active is the active persona, not the signer.
  await retry(() => api("POST", "/api/signer", {}));
  await retry(() =>
    api("POST", "/api/personas", { name: "A1 Replier", handle: "a1rep_" + Date.now().toString(36) })
  );
  await retry(() =>
    api("POST", "/api/actions/cast", { text: "genuinely great thread", replyToHash: parent.hash })
  );

  // later, follow the OP
  await retry(() => api("POST", "/api/follow", { personaId: opId, follow: true, context: "profile" }));

  const evs = await events((es) => ofType(es, "first_interaction", opId).length >= 1);
  const pair = ofType(evs, "first_interaction", opId);
  if (pair.length !== 1) throw new Error(`expected 1 first_interaction, got ${pair.length}`);
  if (pair[0].triggeringCastId !== parent.hash)
    throw new Error(`pair resolves to ${pair[0].triggeringCastId}, expected the reply's thread ${parent.hash}`);
});

// ---- 7. co-interaction, already-follows direction ----
await check("7. Co-interaction: liking a followed author records the pair from that like", async () => {
  await reset();
  const target = id("basisrisk"); // seeded as followed
  const posts = JSON.parse(readFileSync("seed/data/posts.json", "utf8")).posts;
  const post = posts.find((p) => p.authorPersonaId === target);
  await retry(() => api("POST", "/api/actions/react", { hash: post.hash, kind: "like", on: true }));
  const pair = ofType(await events((es) => ofType(es, "first_interaction", target).length >= 1), "first_interaction", target);
  if (pair.length !== 1) throw new Error(`expected 1 first_interaction, got ${pair.length}`);
  if (pair[0].triggeringCastId !== post.hash) throw new Error("pair did not originate from the like");
});

// ---- 8. backfill: seeded follows have marked synthetic origins ----
await check("8. Every seeded follow has a synthetic origin marked backfilled", async () => {
  await reset();
  const evs = await events((es) =>
    viewer.followingPersonaIds.every((t) =>
      es.some((e) => e.type === "follow" && e.backfilled && e.targetPersona === t)
    )
  );
  const backfilled = evs.filter((e) => e.type === "follow" && e.backfilled);
  const missing = viewer.followingPersonaIds.filter(
    (t) => !backfilled.some((e) => e.targetPersona === t)
  );
  if (missing.length) throw new Error(`seeded follows without backfilled origin: ${missing.join(",")}`);
  // and no backfilled row pretends to be a real action
  if (backfilled.some((e) => e.context !== "backfill"))
    throw new Error("a backfilled event carries a non-backfill context");
});

// ---- 9. the log is nowhere but its own endpoint ----
await check("9. Event-log material appears in no other payload", async () => {
  await reset();
  // generate some real events first so there is something to leak
  await retry(() => api("POST", "/api/follow", { personaId: id("gwei_whisperer"), follow: true, context: "profile" }));
  // PROD-LIVE (D-CU-0-4): the page-view routes the browser device answers on a public deployment (and the rig pages
  // compute through the same lib/views builders) are outward payloads too. Event-log material belongs to the
  // /api/eventlog family (/api/eventlog, /api/eventlog/history) and nowhere else — /api/profile in particular leaves
  // the relationship history out on purpose, so it is asked for the account the viewer just followed. Real seeded
  // ids: a top-level post by that account (seed/data/posts.json) and a card off the seeded algo shelf (its id is
  // minted from a fixture signature, so it is read, not hard-coded). A view route that answers an error would make
  // its scan vacuous, so those must answer 2xx (retried like every other read here).
  const posts = JSON.parse(readFileSync("seed/data/posts.json", "utf8")).posts;
  const threadPost = posts.find((p) => p.authorPersonaId === id("gwei_whisperer") && !p.replyToHash);
  if (!threadPost) throw new Error("no seeded top-level post by gwei_whisperer");
  const algoCard = (await retry(() => api("GET", "/api/algo"))).json?.cards?.[0];
  if (!algoCard?.id) throw new Error("no seeded algo card on GET /api/algo");
  const viewRoutes = [
    "/api/profile?handle=gwei_whisperer",
    `/api/thread?hash=${threadPost.hash}`,
    "/api/notifications",
    "/api/history",
    "/api/home",
    "/api/folders/view",
    "/api/channels/view",
    "/api/rooms/view",
    `/api/algo/view?id=${algoCard.id}`,
  ];
  for (const route of ["/api/feed2?surface=discovery", "/api/search?q=follow", "/api/personas", "/api/graph", ...viewRoutes]) {
    const r = viewRoutes.includes(route) ? await retry(() => api("GET", route)) : await api("GET", route);
    if (/"ev_[0-9a-f]/.test(r.text)) throw new Error(`event id leaked into ${route}`);
    if (/"triggeringCastId"/.test(r.text)) throw new Error(`event schema leaked into ${route}`);
  }
});

// ---- 10. a repeated identical follow POST is idempotent at the HTTP boundary ----
await check("10. Two identical follow POSTs (a bare client retry) log exactly ONE event", async () => {
  await reset();
  const target = id("gwei_whisperer");
  const body = { personaId: target, follow: true, triggeringCastId: "0xcr0010", context: "hover_card" };
  // No injected faults — this is the PURE client-retry case the old randomBytes
  // ids could not survive: two identical POSTs logged two events. Content-derived
  // ids collapse them to one, with no client-supplied key required.
  const a = await retry(() => api("POST", "/api/follow", body));
  if (a.status !== 200) throw new Error(`first follow failed: ${a.status} ${a.json?.error ?? ""}`);
  const b = await retry(() => api("POST", "/api/follow", body));
  if (b.status !== 200) throw new Error(`second follow failed: ${b.status} ${b.json?.error ?? ""}`);
  const n = ofType(await events((es) => ofType(es, "follow", target).length >= 1), "follow", target).length;
  if (n !== 1) throw new Error(`two identical follow POSTs logged ${n} follow events, expected exactly 1`);
});

// ---- 11. the hybrid boundary: countable actions stay distinct, keys collapse them ----
await check("11. Two replies to one cast log TWO events; the same idempotency key collapses them to one", async () => {
  const posts = JSON.parse(readFileSync("seed/data/posts.json", "utf8")).posts;
  const op = "quietvalidator"; // not followed by the viewer, so no first_interaction noise
  const opId = id(op);
  const parent = posts.find((p) => p.authorPersonaId === opId && !p.replyToHash);
  if (!parent) throw new Error("no seeded post by the OP");

  // (a) DISTINCT replies to the same parent are two real actions — reply is a
  // countable/authored type, deliberately NOT collapsed by content-derivation.
  await reset();
  await retry(() => api("POST", "/api/signer", {}));
  await retry(() =>
    api("POST", "/api/personas", { name: "A1 Replier", handle: "a1r11a_" + Date.now().toString(36) })
  );
  await retry(() => api("POST", "/api/actions/cast", { text: "first reply", replyToHash: parent.hash }));
  await retry(() => api("POST", "/api/actions/cast", { text: "second reply", replyToHash: parent.hash }));
  let replies = ofType(await events((es) => ofType(es, "reply", opId).length >= 2), "reply", opId);
  if (replies.length !== 2)
    throw new Error(`two distinct replies logged ${replies.length} reply events, expected 2 (countable, not collapsed)`);

  // (b) the escape hatch: two sends carrying the SAME idempotency key collapse
  // to ONE reply event, even for a countable action.
  await reset();
  await retry(() => api("POST", "/api/signer", {}));
  await retry(() =>
    api("POST", "/api/personas", { name: "A1 Replier", handle: "a1r11b_" + Date.now().toString(36) })
  );
  const key = "a1-reply-key-" + Date.now().toString(36);
  const keyed = () =>
    api("POST", "/api/actions/cast", { text: "keyed reply", replyToHash: parent.hash, idempotencyKey: key });
  await retry(keyed);
  await retry(keyed);
  replies = ofType(await events((es) => ofType(es, "reply", opId).length >= 1), "reply", opId);
  if (replies.length !== 1)
    throw new Error(`two sends sharing one idempotency key logged ${replies.length} reply events, expected 1`);
});

await reset().catch(() => {}); // final cleanup is best-effort: the summary and exit code below must still run
await browser.close();

const productFails = results.filter((r) => r[0] === "FAIL");
const infraFails = results.filter((r) => r[0] === "INFRA");
console.log(
  productFails.length === 0 && infraFails.length === 0
    ? `\n${results.length}/${results.length} Tier A Gate 1 checks passed`
    : `\n${results.length - productFails.length - infraFails.length}/${results.length} passed, ${productFails.length} FAILED, ${infraFails.length} infra`
);
if (productFails.length) {
  console.log("\nProduct failures:");
  for (const r of productFails) console.log(`  - ${r[1]}: ${r[2]}`);
}
process.exit(productFails.length ? 1 : infraFails.length ? 2 : 0);
