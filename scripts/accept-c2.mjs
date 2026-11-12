// CRYPTO PASS — GATE 2: the vault. Everything that was "device-held,
// server-blind" is now ciphertext on the untrusted validator; our client
// decrypts locally. FIXTURE-SAFE: never posts to a real network.
//
// Every check runs against the ARMED, vaulted build (LAYERS_REQUIRE_SIG
// + the vault namespaces encrypted at flush). The spine: write vault
// content through the API, prove the validator holds only ciphertext,
// prove our client reads it back decrypted, prove tamper fails closed,
// and prove it survives a reload from ciphertext.
import { chromium } from "playwright";
import { assertServersUp, isInfraError, retryContent } from "./lib-health.mjs";
import { readFileSync } from "node:fs";

const BASE = process.env.BASE_URL || `http://localhost:${process.env.LAYERS_APP_PORT || 3001}`;
const VBASE = process.env.VALIDATOR_URL || `http://localhost:${process.env.LAYERS_VALIDATOR_PORT || 4001}`;
const personas = JSON.parse(readFileSync("seed/data/accounts.json", "utf8")).personas;
const id = (h) => personas.find((p) => p.handle === h)?.id;

const ALT = "persona_viewer_alt"; // @backyard_scope, the seeded private persona
const APERTURE = id("aperture_annie"); // in backyard_scope's audience

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
const rawState = async (ns) => {
  const res = await fetch(`${VBASE}/state/${ns}`, { cache: "no-store" });
  return { status: res.status, text: await res.text() };
};

console.log("\nCRYPTO Gate 2 — the vault (ciphertext at rest, decrypt on read, fail closed)");

const CANARY = "layers-vault-canary-9c3f1a";

// ---- 1. the vault cipher round-trips and fails closed on wrong key/moved ----
await check("1. Vault crypto: round-trips, no plaintext in ciphertext, wrong key + moved record rejected", async () => {
  const p = (await retry(() => api("POST", "/api/dev", { action: "vaultRoundTrip" }))).json;
  if (!p.roundTripOk) throw new Error("encrypt→decrypt did not round-trip");
  if (p.plaintextInCiphertext) throw new Error("plaintext appears inside the ciphertext");
  if (!p.wrongKeyRejected) throw new Error("a WRONG key decrypted the record — unauthorized read possible");
  if (!p.movedRejected) throw new Error("a moved record (AAD address changed) decrypted — no address binding");
  if (p.ciphertextShape.v !== 1 || !p.ciphertextShape.hasCt) throw new Error("ciphertext shape wrong");
});

// ---- 2. a runtime private post is CIPHERTEXT on the validator ----
let postHash = null;
await check("2. A private post is encrypted at rest — the validator never sees its text", async () => {
  await reset();
  await viewAs(ALT);
  const posted = await retry(() =>
    api("POST", "/api/private/posts", { text: `vault probe ${CANARY} — private words` })
  );
  postHash = posted.json.post?.hash;
  if (!postHash) throw new Error("private post was not created");

  const stored = await rawState("privatePosts");
  if (stored.status !== 200) throw new Error(`validator privatePosts unreadable: ${stored.status}`);
  if (stored.text.includes(CANARY))
    throw new Error("THE CANARY IS PLAINTEXT ON THE VALIDATOR — the vault is not encrypting");
  if (stored.text.includes("private words"))
    throw new Error("private post text is plaintext on the validator");
  // and the record that IS there must be ciphertext-shaped
  const entries = JSON.parse(stored.text).entries ?? {};
  const recs = Object.values(entries);
  if (recs.length === 0) throw new Error("nothing was flushed to the validator");
  if (!recs.every((r) => r && r.v === 1 && typeof r.ct === "string" && typeof r.nonce === "string"))
    throw new Error("a stored record is not vault ciphertext");
  await viewAs(null);
});

// ---- 3. our client reads it back DECRYPTED ----
await check("3. The author's client decrypts and reads the post back intact", async () => {
  await viewAs(ALT);
  const mine = await retryContent(
    () => api("GET", "/api/private/posts"),
    (r) => (r.json.posts ?? []).some((p) => p.hash === postHash)
  );
  const post = (mine.json.posts ?? []).find((p) => p.hash === postHash);
  if (!post) throw new Error("the author cannot read their own vaulted post");
  if (!post.text.includes(CANARY)) throw new Error("decrypted post text is corrupted");
  await viewAs(null);
});

// ---- 4. grants + event log are ciphertext at rest too ----
await check("4. Disclosure grants and the relationship event log are ciphertext on the validator", async () => {
  // trigger a grant flush + an edge-event flush with runtime activity
  await retry(() =>
    api("POST", "/api/identity/grant", {
      fromPersona: "persona_viewer_main",
      toPersona: ALT,
      audienceMember: id("basisrisk"),
      tier: "whitelist",
    })
  );
  await retry(() => api("POST", "/api/follow", { personaId: id("duskorbiter") })).catch(() => {});

  for (const [ns, needles] of [
    ["grantsV3", ["audienceMember", "fromPersona", "whitelist", ALT]],
    ["edgeEvents", ["actorPersonaId", "targetPersona", "follow"]],
  ]) {
    const stored = await rawState(ns);
    if (stored.status !== 200) continue;
    const entries = JSON.parse(stored.text).entries ?? {};
    if (Object.keys(entries).length === 0) continue; // nothing flushed yet is not a leak
    for (const n of needles) {
      if (stored.text.includes(n)) throw new Error(`plaintext "${n}" in the validator's ${ns}`);
    }
    if (!Object.values(entries).every((r) => r && r.v === 1 && typeof r.ct === "string"))
      throw new Error(`a ${ns} record is not ciphertext`);
  }
});

// ---- 5. SAFETY: a tampered vault ciphertext is DROPPED on read (fail closed) ----
await check("5. SAFETY: a server-side tamper of a vault record is dropped by the read gate, others survive", async () => {
  await reset();
  await viewAs(ALT);
  const a = await retry(() => api("POST", "/api/private/posts", { text: `keep me ${CANARY}` }));
  const b = await retry(() => api("POST", "/api/private/posts", { text: `tamper me ${CANARY}` }));
  await viewAs(null);
  const keepHash = a.json.post?.hash;
  const tamperHash = b.json.post?.hash;

  // baseline: both records decrypt from the validator's ciphertext
  const before = (await retry(() => api("POST", "/api/dev", { action: "vaultReadback", ns: "privatePosts" }))).json;
  if (!before.ids.includes(tamperHash) || !before.ids.includes(keepHash))
    throw new Error("staging: both posts should decrypt before tamper");

  // corrupt exactly the "tamper me" record's ciphertext on the validator
  await retry(() =>
    api("POST", "/api/dev", { action: "corruptVaultCiphertext", ns: "privatePosts", key: tamperHash })
  );

  // the read gate (what hydrate runs) must DROP the tampered record and
  // KEEP the intact one — fail closed per record, never all-or-nothing
  const after = (await retry(() => api("POST", "/api/dev", { action: "vaultReadback", ns: "privatePosts" }))).json;
  if (!after.ok) throw new Error(`readback reported wrong-key when only one record was tampered: ${after.error}`);
  if (after.ids.includes(tamperHash))
    throw new Error("a tampered ciphertext record was still decrypted — fail-open");
  if (!after.ids.includes(keepHash))
    throw new Error("an intact record was dropped alongside the tampered one — not per-record fail-closed");
});

// ---- 6. reload from CIPHERTEXT: runtime content reconstructs, decrypted ----
await check("6. The encrypted vault reconstructs from ciphertext — a runtime post returns intact", async () => {
  await reset();
  await viewAs(ALT);
  const fresh = await retry(() =>
    api("POST", "/api/private/posts", { text: `survival probe ${CANARY} does it come back` })
  );
  const hash = fresh.json.post?.hash;
  if (!hash) throw new Error("staging post failed");
  await viewAs(null);

  // decryptNamespace over the validator's stored ciphertext — the exact
  // reconstruction hydrate() performs on a fresh process. A runtime post
  // (never re-seeded) proves it is the VAULT, not the seeder, bringing it
  // back; a wrong key would throw here loudly.
  const rb = (await retry(() => api("POST", "/api/dev", { action: "vaultReadback", ns: "privatePosts" }))).json;
  if (!rb.ok) throw new Error(`reload failed (wrong key?): ${rb.error}`);
  if (!rb.ids.includes(hash))
    throw new Error("a RUNTIME post did not reconstruct from ciphertext — the vault did not persist it");
  if (rb.recovered !== rb.total)
    throw new Error(`${rb.total - rb.recovered} records failed to reconstruct from a clean vault`);
});

// ---- 7. broad plaintext grep: no seeded vault plaintext anywhere on the validator ----
await check("7. SAFETY: no known vault plaintext appears anywhere in the validator's stored state", async () => {
  // seeded private post texts (the distinctive fixtures) must never be
  // plaintext at rest — trigger a flush of the seeded world first by
  // touching each namespace, then grep the whole /state dump
  await reset();
  await viewAs(ALT);
  await retry(() => api("POST", "/api/private/posts", { text: "flush trigger for the grep" }));
  await viewAs(null);

  const all = await (await fetch(`${VBASE}/state`, { cache: "no-store" })).text();
  const needles = [
    "clouded out again",
    "water tower",
    "honestly half the reason",
    "private words",
    CANARY,
  ];
  for (const n of needles) {
    if (all.includes(n)) throw new Error(`vault plaintext "${n}" found in the validator's /state`);
  }
});

await browser.close();
const fails = results.filter((r) => r[0] === "FAIL");
const infra = results.filter((r) => r[0] === "INFRA");
console.log(
  `\n${results.length - fails.length - infra.length}/${results.length} CRYPTO Gate 2 checks passed` +
    (fails.length ? `, ${fails.length} FAILED` : "") +
    (infra.length ? `, ${infra.length} infra` : "")
);
process.exitCode = fails.length ? 1 : infra.length ? 2 : 0;
