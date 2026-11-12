// CRYPTO PASS — GATE 1: real signatures, verified at the decision gates.
// FIXTURE-SAFE: never posts to any real network, never spends.
//
// The shape of every check here: sign → verify → accept, then TAMPER →
// the object is ABSENT. Tampering goes through the dev tamperState hook,
// which replaces a persisted record wholesale exactly as a compromised
// validator could — the read side must treat the result as nonexistent.
import { chromium } from "playwright";
import { assertServersUp, isInfraError, retryContent } from "./lib-health.mjs";
import { readFileSync } from "node:fs";

const BASE = process.env.BASE_URL || `http://localhost:${process.env.LAYERS_APP_PORT || 3001}`;
const personas = JSON.parse(readFileSync("seed/data/accounts.json", "utf8")).personas;
const id = (h) => personas.find((p) => p.handle === h)?.id;
const posts = JSON.parse(readFileSync("seed/data/posts.json", "utf8")).posts;

const APERTURE = id("aperture_annie");   // in backyard_scope's private audience
const DUSK = id("duskorbiter");          // NOT in the audience
const ALT = "persona_viewer_alt";        // @backyard_scope, the private persona
const MAIN = "persona_viewer_main";

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
const page = await (await browser.newContext()).newPage();

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
  await retry(() => api("POST", "/api/dev", { action: "resetSeed" }));
  await page.waitForTimeout(400);
};
const viewAs = (personaId) => retry(() => api("POST", "/api/dev", { action: "viewAs", personaId }));
const probe = async () => (await retry(() => api("POST", "/api/dev", { action: "cryptoProbe" }))).json;
const privatePosts = async () => (await retry(() => api("GET", "/api/private/posts"))).json.posts ?? [];
const tamper = (ns, key, value) => retry(() => api("POST", "/api/dev", { action: "tamperState", ns, key, value }));

console.log("\nCRYPTO Gate 1 — real signatures, verification at the decision gates");

// ---- 1. every seeded grant verifies; per-signature cost reported ----
await check("1. The whole seeded grant world VERIFIES (and the cost is known)", async () => {
  await reset();
  const p = await probe();
  if (!p.grants || p.grants.total < 5) throw new Error(`implausibly few grants: ${p.grants?.total}`);
  if (p.grants.failed !== 0)
    throw new Error(`${p.grants.failed} of ${p.grants.total} seeded grants FAIL verification`);
  const per = p.grants.verifyMs / Math.max(1, p.grants.total);
  console.log(
    `        [perf] ${p.grants.total} grants verified in ${p.grants.verifyMs}ms (${per.toFixed(2)}ms/grant)`
  );
  if (per > 5) throw new Error(`per-grant verify cost ${per.toFixed(2)}ms — above the 5ms sanity line`);
});

// ---- 2. the disclosure gates run on VERIFIED grants ----
await check("2. Audience disclosure works through verification (granted sees, non-granted doesn't)", async () => {
  await viewAs(APERTURE);
  const granted = await retryContent(() => api("GET", "/api/private/posts"), (r) => (r.json.posts ?? []).length >= 3);
  if ((granted.json.posts ?? []).length < 3)
    throw new Error(`granted viewer sees ${(granted.json.posts ?? []).length} private posts, expected 3`);
  await viewAs(DUSK);
  const denied = await privatePosts();
  if (denied.length !== 0) throw new Error(`non-granted viewer sees ${denied.length} private posts`);
  await viewAs(null);
});

// ---- 3. THE ATTACK: a tampered grant grants NOTHING ----
await check("3. SAFETY: a validator-side tamper that rewrites an audience grant fails closed BOTH ways", async () => {
  // find the real audience grant for aperture_annie on the private persona
  const listing = await retry(() => api("GET", `/api/identity/grant?personaId=${ALT}`));
  const audienceGrant = (listing.json.grants ?? []).find(
    (g) => (g.kind ?? "linkage") === "audience" && g.audienceMember === APERTURE
  );
  if (!audienceGrant) throw new Error("could not locate the seeded audience grant");

  // the attack: point the grant at DUSK, keeping the old (now-wrong) signature
  await tamper("grantsV3", audienceGrant.id, { ...audienceGrant, audienceMember: DUSK });

  await viewAs(DUSK);
  const attacker = await privatePosts();
  if (attacker.length !== 0)
    throw new Error(`THE TAMPERED GRANT WORKED: non-granted viewer now sees ${attacker.length} private posts`);

  await viewAs(APERTURE);
  const victim = await privatePosts();
  if (victim.length !== 0)
    throw new Error("the original holder still resolves through a tampered row — verification is not gating");

  const p = await probe();
  if (p.grants.failed !== 1) throw new Error(`expected exactly 1 failing grant after tamper, got ${p.grants.failed}`);

  await viewAs(null);
  await reset(); // re-seeds a clean, verifying world
  await viewAs(APERTURE);
  const restored = await retryContent(() => api("GET", "/api/private/posts"), (r) => (r.json.posts ?? []).length >= 3);
  if ((restored.json.posts ?? []).length < 3) throw new Error("reset did not restore the verified grant world");
  await viewAs(null);
});

// ---- 4. issue + revoke: the revoked state is itself a signed claim ----
await check("4. Runtime issue verifies; REVOKE RE-SIGNS (id stable, signature fresh, still verifying)", async () => {
  const issued = await retry(() =>
    api("POST", "/api/identity/grant", {
      fromPersona: MAIN,
      toPersona: ALT,
      audienceMember: id("basisrisk"),
      tier: "whitelist",
    })
  );
  const g = issued.json.grant;
  if (!g?.id) throw new Error("issue returned no grant");
  if (!/^[0-9a-f]{128}$/.test(g.signature)) throw new Error("signature is not a 64-byte Ed25519 signature");
  let p = await probe();
  if (p.grants.failed !== 0) throw new Error("a freshly issued grant fails verification");

  const revoked = await retry(() => api("POST", "/api/identity/grant", { action: "revoke", grantId: g.id }));
  if (revoked.json.grant?.id !== g.id) throw new Error("revocation changed the grant id");
  if (revoked.json.grant?.revokedAt === null) throw new Error("revocation did not set revokedAt");
  if (revoked.json.grant?.signature === g.signature)
    throw new Error("revocation kept the ISSUANCE signature — the revoked state is unsigned");
  p = await probe();
  if (p.grants.failed !== 0)
    throw new Error("the revoked grant fails verification — revocation did not re-sign");
});

// ---- 5. an unsignable persona cannot issue ----
await check("5. SAFETY: issuing as a persona with no key REFUSES and stores nothing", async () => {
  const ghost = "persona_ghost_c1_999";
  const r = await api("POST", "/api/identity/grant", {
    fromPersona: ghost,
    toPersona: MAIN,
    tier: "public",
  });
  if (r.status === 200) throw new Error("a keyless persona issued a grant");
  const listing = await retry(() => api("GET", `/api/identity/grant?personaId=${ghost}`));
  if ((listing.json.grants ?? []).length !== 0) throw new Error("a refused grant was stored anyway");
});

// ---- 6. artifacts: author-key roundtrip; tampered artifact refused ----
await check("6. Artifact export verifies; a tampered artifact is refused at preview AND import", async () => {
  const modes = await retry(() => api("GET", "/api/modes"));
  const mode = (modes.json.modes ?? [])[0];
  if (!mode) throw new Error("no modes to export");
  const exported = await retry(() => api("POST", "/api/algo/export", { modeId: mode.id }));
  const artifact = exported.json.artifact;
  if (!artifact?.signature) throw new Error("export produced no signature");

  const previewOk = await retry(() => api("POST", "/api/algo/preview", { artifact }));
  if (previewOk.status !== 200) throw new Error(`clean artifact refused at preview: ${previewOk.status}`);

  const tampered = { ...artifact, name: artifact.name + " (tampered)" };
  const previewBad = await api("POST", "/api/algo/preview", { artifact: tampered });
  const importBad = await api("POST", "/api/algo/import", { artifact: tampered });
  if (previewBad.status === 200 && !previewBad.json?.preview?.violations?.length)
    throw new Error("tampered artifact sailed through preview");
  if (importBad.status === 200) throw new Error("tampered artifact IMPORTED");
});

// ---- 7. fc attribution: a reattribution tamper renders bare FID ----
await check("7. SAFETY: tampered attribution rows render as bare FID, both attack shapes", async () => {
  await reset();
  const pub = await retry(() =>
    api("POST", "/api/fc/write", { action: "cast", text: "c1 attribution probe [layers-test fixture]" })
  );
  const hash = pub.json.hash;
  const att0 = await retry(() => api("GET", `/api/fc/attribution?hashes=${hash}`));
  const row = att0.json.attributions?.[hash];
  if (!row || row.id !== MAIN) throw new Error("staging: fixture publish did not attribute");

  // attack 1: reattribute to another persona, keeping the old signature
  const stored = (await api("GET", "/api/fc/write")).json; // ledger read forces hydrate
  void stored;
  const orig = (await api("POST", "/api/dev", { action: "tamperState", ns: "fcAttribution", key: hash, value: null }))
    .json.before;
  if (!orig?.signature) throw new Error("staging: stored attribution row has no signature field");
  await tamper("fcAttribution", hash, { ...orig, personaId: ALT });
  let att = await retry(() => api("GET", `/api/fc/attribution?hashes=${hash}`));
  if (att.json.attributions?.[hash] !== null)
    throw new Error("REATTRIBUTION TAMPER RENDERED: " + JSON.stringify(att.json.attributions?.[hash]));

  // attack 2: right persona, forged signature bytes
  await tamper("fcAttribution", hash, { ...orig, signature: "ab".repeat(64) });
  att = await retry(() => api("GET", `/api/fc/attribution?hashes=${hash}`));
  if (att.json.attributions?.[hash] !== null) throw new Error("forged-signature attribution rendered");

  // restore the genuine row: it must verify again (proves the gate, not luck)
  await tamper("fcAttribution", hash, orig);
  att = await retry(() => api("GET", `/api/fc/attribution?hashes=${hash}`));
  if (att.json.attributions?.[hash]?.id !== MAIN) throw new Error("genuine row no longer renders after restore");
});

// ---- 8. refutation edges: the Tier B teeth, now cryptographic ----
await check("8. SAFETY: a tampered author edge loses standing at READ time", async () => {
  await reset();
  // A verified author edge needs the ASSERTER to actually author the
  // from-cast, and a resolvable key. A seeded persona satisfies both:
  // view AS gwei_whisperer, declare a refutation FROM its own seeded cast.
  // (The /api/refute POST asserts as the active persona — no session
  // signer needed, unlike the cast composer.)
  const gwei = id("gwei_whisperer");
  const mine = posts.find((p) => p.authorPersonaId === gwei && !p.replyToHash);
  const victim = posts.find((p) => p.authorPersonaId !== gwei && !p.replyToHash);
  if (!mine || !victim) throw new Error("staging: could not find suitable seeded casts");

  await viewAs(gwei);
  await retry(() =>
    api("POST", "/api/refute", { fromCastId: mine.hash, toCastId: victim.hash, type: "refutes" })
  );
  const settled = await retryContent(
    () => api("GET", `/api/refute?castId=${victim.hash}`),
    (r) => (r.json.edges ?? []).some((e) => e.declaredBy === "author" && e.verified !== false),
    5
  );
  const edge = (settled.json.edges ?? []).find(
    (e) => e.declaredBy === "author" && e.assertedBy === gwei && e.verified !== false
  );
  await viewAs(null);
  if (!edge) throw new Error("staging: no verified author edge");
  if (!edge.signature) throw new Error("author edge carries no signature — Gate 1 did not land on edges");
  if (!/^[0-9a-f]{128}$/.test(edge.signature))
    throw new Error("edge signature is not a 64-byte Ed25519 signature");

  // the tamper: swap the asserter to a persona that did NOT author the
  // cast, keeping the (now-wrong) signature
  await tamper("refutationEdges", edge.id, { ...edge, assertedBy: DUSK });
  const after = await retry(() => api("GET", `/api/refute?castId=${victim.hash}`));
  const standing = (after.json.edges ?? []).filter((e) => e.id === edge.id && e.verified !== false);
  if (standing.length !== 0)
    throw new Error("a tampered author edge still holds standing — the stored boolean is still trusted");
});

await browser.close();
const fails = results.filter((r) => r[0] === "FAIL");
const infra = results.filter((r) => r[0] === "INFRA");
console.log(
  `\n${results.length - fails.length - infra.length}/${results.length} CRYPTO Gate 1 checks passed` +
    (fails.length ? `, ${fails.length} FAILED` : "") +
    (infra.length ? `, ${infra.length} infra` : "")
);
process.exitCode = fails.length ? 1 : infra.length ? 2 : 0;
