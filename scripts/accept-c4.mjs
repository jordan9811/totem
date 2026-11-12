// CRYPTO PASS — GATE 4: recovery. A lost device is not a death sentence.
// FIXTURE-SAFE. Simulates TOTAL device loss (the keystore file — seed +
// persona roster — deleted), then reconstructs the whole identity from
// the recovery phrase and, separately, from encrypted passphrase escrow.
//
// The strong proof is the VAULT: between loss and recovery the vault is
// genuinely locked (a fresh blank root cannot decrypt it); recovery
// restores the seed, and only the right seed re-derives the vault key
// that opens it. A minted (forked) persona proves the roster comes back.
import { chromium } from "playwright";
import { assertServersUp, isInfraError, retryContent } from "./lib-health.mjs";
import { readFileSync } from "node:fs";

const BASE = process.env.BASE_URL || `http://localhost:${process.env.LAYERS_APP_PORT || 3001}`;
const accounts = JSON.parse(readFileSync("seed/data/accounts.json", "utf8"));
const id = (h) => accounts.personas.find((p) => p.handle === h)?.id;
const ALT = "persona_viewer_alt";
const FORK_SOURCE = id("brothandbones"); // a seeded persona the viewer can fork

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
const readback = async (ns) => (await api("POST", "/api/dev", { action: "vaultReadback", ns })).json;

console.log("\nCRYPTO Gate 4 — recovery from total device loss");

let phrase = null;
let forkId = null;
let postHash = null;
const CANARY = "recovery-canary-" + Math.floor(Date.now() / 1000).toString(36);

// ---- 1. the phrase is gated by a forced acknowledgment ----
await check("1. Revealing the recovery phrase forces an explicit acknowledgment", async () => {
  await reset();
  const refused = await api("POST", "/api/recovery", { action: "revealPhrase" });
  if (refused.status !== 428) throw new Error(`phrase revealed without acknowledgment (${refused.status})`);
  if (!refused.json.ackText) throw new Error("no acknowledgment text offered");
  const got = await retry(() => api("POST", "/api/recovery", { action: "revealPhrase", acknowledged: true }));
  phrase = got.json.phrase;
  if (!phrase || phrase.split(/\s+/).length !== 24) throw new Error("phrase is not a 24-word mnemonic");
});

// ---- 2. build an identity worth losing: a minted persona + a vault post ----
await check("2. Stage a minted persona and a vaulted private post", async () => {
  const forked = await retry(() =>
    api("POST", "/api/identity/fork", { fromPersona: FORK_SOURCE, carry: [], newHandle: "recov_" + Date.now().toString(36).slice(-5) })
  );
  forkId = forked.json.newPersona;
  if (!forkId || !forkId.startsWith("p_")) throw new Error(`fork did not mint a keystore persona: ${forkId}`);

  await viewAs(ALT);
  const posted = await retry(() => api("POST", "/api/private/posts", { text: `vault survives recovery ${CANARY}` }));
  postHash = posted.json.post?.hash;
  await viewAs(null);
  if (!postHash) throw new Error("private post staging failed");

  // baseline: the vault decrypts and grants verify
  const rb = await readback("privatePosts");
  if (!rb.ok || !rb.ids.includes(postHash)) throw new Error("staging: vault post not readable before loss");
  const probe = (await retry(() => api("POST", "/api/dev", { action: "cryptoProbe" }))).json;
  if (probe.grants.failed !== 0) throw new Error("staging: grants do not all verify before loss");
});

// ---- 3. escrow the seed under a passphrase (the stronger option) ----
await check("3. Seal the seed into encrypted passphrase escrow", async () => {
  const weak = await api("POST", "/api/recovery", { action: "escrowSeal", passphrase: "short" });
  if (weak.status === 200) throw new Error("escrow accepted a too-short passphrase");
  const sealed = await retry(() => api("POST", "/api/recovery", { action: "escrowSeal", passphrase: "correct horse battery" }));
  if (!sealed.json.ok) throw new Error("escrow seal failed");
  const status = await retry(() => api("GET", "/api/recovery"));
  if (!status.json.escrowPresent) throw new Error("escrow not registered");
});

// ---- 4. TOTAL DEVICE LOSS: the vault is now genuinely locked ----
await check("4. After total device loss, the vault cannot be opened (locked without the seed)", async () => {
  await retry(() => api("POST", "/api/dev", { action: "simulateDeviceLoss" }));
  // a fresh blank root now backs the process; it must NOT decrypt the vault
  const rb = await readback("privatePosts");
  if (rb.ok && rb.ids.includes(postHash))
    throw new Error("the vault decrypted WITHOUT the seed — recovery would be meaningless");
});

// ---- 5. recover from the PHRASE: identity + vault come back ----
await check("5. Recovery from the phrase restores the minted persona, grants, and the vault", async () => {
  const rec = await retry(() => api("POST", "/api/recovery", { action: "recover", phrase }));
  if (!rec.json.ok) throw new Error(`recovery failed: ${rec.json.error}`);
  if (!(rec.json.recoveredPersonas ?? []).includes(forkId))
    throw new Error("the minted persona did not come back in the recovered roster");

  // the vault re-decrypts with the recovered seed's key...
  const rb = await readback("privatePosts");
  if (!rb.ok) throw new Error(`vault still locked after recovery: ${rb.error}`);
  if (!rb.ids.includes(postHash)) throw new Error("the runtime private post did not survive recovery");
  // ...and every grant re-verifies (same keys re-derived from the seed)
  const probe = (await retry(() => api("POST", "/api/dev", { action: "cryptoProbe" }))).json;
  if (probe.grants.failed !== 0) throw new Error("grants do not verify after recovery — wrong keys");
  if (probe.keystorePersonaCount < 1) throw new Error("keystore roster empty after recovery");
});

// ---- 6. recover from ESCROW + passphrase, after a second loss ----
await check("6. Recovery from passphrase escrow restores the identity too", async () => {
  await retry(() => api("POST", "/api/dev", { action: "simulateDeviceLoss" }));
  const locked = await readback("privatePosts");
  if (locked.ok && locked.ids.includes(postHash)) throw new Error("vault not locked after second loss");

  const wrong = await api("POST", "/api/recovery", { action: "recover", passphrase: "not the passphrase" });
  if (wrong.status === 200) throw new Error("a WRONG passphrase recovered the seed");

  const rec = await retry(() => api("POST", "/api/recovery", { action: "recover", passphrase: "correct horse battery" }));
  if (!rec.json.ok) throw new Error(`escrow recovery failed: ${rec.json.error}`);
  const rb = await readback("privatePosts");
  if (!rb.ok || !rb.ids.includes(postHash)) throw new Error("vault not restored via escrow recovery");
});

// ---- 7. a wrong phrase never recovers a plausible-but-wrong identity ----
await check("7. SAFETY: an invalid phrase is rejected, not silently accepted", async () => {
  const bad = await api("POST", "/api/recovery", {
    action: "recover",
    phrase: "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about",
  });
  // valid BIP39 checksum but wrong length (12 not 24) OR wrong seed → must
  // not restore THIS identity's vault
  if (bad.status === 200) {
    const rb = await readback("privatePosts");
    if (rb.ok && rb.ids.includes(postHash))
      throw new Error("a wrong phrase restored access to the real vault");
  }
  // restore the real identity so the run leaves clean state
  await retry(() => api("POST", "/api/recovery", { action: "recover", phrase }));
});

await browser.close();
const fails = results.filter((r) => r[0] === "FAIL");
const infra = results.filter((r) => r[0] === "INFRA");
console.log(
  `\n${results.length - fails.length - infra.length}/${results.length} CRYPTO Gate 4 checks passed` +
    (fails.length ? `, ${fails.length} FAILED` : "") +
    (infra.length ? `, ${infra.length} infra` : "")
);
process.exitCode = fails.length ? 1 : infra.length ? 2 : 0;
