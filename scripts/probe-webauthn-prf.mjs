// BROWSER KEYSTORE PASS Gate 2 — does the fixture authenticator speak PRF? A CDP virtual authenticator with hasPrf,
// a discoverable credential created with the prf extension, and two assertions evaluating the same salt: the PRF
// output must be present, 32 bytes, and IDENTICAL across assertions (that determinism is what makes it a KEK).
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || `http://127.0.0.1:${process.env.LAYERS_APP_PORT || 3001}`;
const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();
const cdp = await ctx.newCDPSession(page);
await cdp.send("WebAuthn.enable", { enableUI: false });
const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
  options: { protocol: "ctap2", ctap2Version: "ctap2_1", transport: "internal", hasResidentKey: true, hasUserVerification: true, isUserVerified: true, hasPrf: true, automaticPresenceSimulation: true },
});
await page.goto(BASE + "/device/smoke.html", { waitUntil: "load" });
const out = await page.evaluate(async () => {
  const te = new TextEncoder();
  const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
  const cred = await navigator.credentials.create({
    publicKey: {
      rp: { name: "Totem", id: location.hostname },
      user: { id: crypto.getRandomValues(new Uint8Array(16)), name: "layers", displayName: "Totem" },
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      pubKeyCredParams: [{ type: "public-key", alg: -8 }, { type: "public-key", alg: -7 }],
      authenticatorSelection: { residentKey: "required", userVerification: "required" },
      extensions: { prf: {} },
    },
  });
  const ext = cred.getClientExtensionResults();
  const spki = cred.response.getPublicKey ? hex(cred.response.getPublicKey()) : null;
  const alg = cred.response.getPublicKeyAlgorithm ? cred.response.getPublicKeyAlgorithm() : null;
  const get = async () => {
    const a = await navigator.credentials.get({
      publicKey: { challenge: crypto.getRandomValues(new Uint8Array(32)), rpId: location.hostname, userVerification: "required", extensions: { prf: { eval: { first: te.encode("layers/prf/v1") } } } },
    });
    const r = a.getClientExtensionResults();
    return { id: a.id, prf: r.prf?.results?.first ? hex(r.prf.results.first) : null };
  };
  const g1 = await get();
  const g2 = await get();
  return { created: cred.id, prfEnabled: ext.prf?.enabled ?? null, alg, spkiLen: spki ? spki.length / 2 : null, g1, g2, same: g1.prf === g2.prf, discoverableMatch: g1.id === cred.id };
});
console.log(JSON.stringify({ ...out, g1: { ...out.g1, prf: out.g1.prf ? out.g1.prf.slice(0, 8) + "…(" + out.g1.prf.length / 2 + " bytes)" : null }, g2: { ...out.g2, prf: out.g2.prf ? "…" : null } }, null, 2));
await cdp.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId });
await browser.close();
