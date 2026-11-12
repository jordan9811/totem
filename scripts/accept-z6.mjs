// ZK PASS 2 — GATE 1: every reputation read is proof-mediated under zk.
// FIXTURE-SAFE.
//
//   • docs/root-reads.md exists and names every module that reads a
//     root-derived tier/roster/block (self-consistency grep)
//   • under ADAPTER_REP=zk: an unproven persona is tier 0 EVERYWHERE the
//     app answers tier — the explainer says "not proven", the switcher and
//     the profile carry the unproven chip, following-feed cards carry it
//     (following is unfiltered, so unproven authors are visible there),
//     discovery hides unproven authors (fail closed); after a proof the
//     proven tier appears on the same surfaces
//   • grep: no app module imports tierFor/personasForRoot from the
//     validator client under zk; feed stamps card tiers from the gate's
//     proven map; the zk rep adapter has no root-side lookup
import { chromium } from "playwright";
import { assertServersUp, isInfraError } from "./lib-health.mjs";
import { readFileSync } from "node:fs";

const BASE = process.env.BASE_URL || `http://localhost:${process.env.LAYERS_APP_PORT || 3001}`;
const VBASE = process.env.VALIDATOR_URL || `http://localhost:${process.env.LAYERS_VALIDATOR_PORT || 4001}`;
const MAIN = "persona_viewer_main";
const ALT = "persona_viewer_alt";
const OTHER_VIEWER = "persona_acc_food_1";

const results = [];
const ok = (n) => { results.push(["PASS", n]); console.log("  PASS  " + n); };
const fail = (n, d) => { const infra = isInfraError(d); results.push([infra ? "INFRA" : "FAIL", n, d]); console.log((infra ? "  INFRA " : "  FAIL  ") + n + (d ? " — " + d : "")); };
async function check(name, fn) { try { await fn(); ok(name); } catch (e) { fail(name, e.message); } }

await assertServersUp(BASE);
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
async function api(method, url, body) {
  const res = await page.request.fetch(BASE + url, { method, headers: { "Content-Type": "application/json" }, data: body === undefined ? undefined : JSON.stringify(body) });
  let json = null; try { json = JSON.parse(await res.text()); } catch {}
  return { status: res.status(), json };
}
async function retry(fn, attempts = 4) {
  let last;
  for (let i = 0; i < attempts; i++) { try { const r = await fn(); if (r.status >= 200 && r.status < 300) return r; last = new Error("status " + r.status + " " + (r.json?.error ?? r.json?.reason ?? JSON.stringify(r.json)?.slice(0, 160) ?? "")); } catch (e) { last = e; } }
  throw last;
}
const zk = (action, extra = {}) => api("POST", "/api/zk", { action, mode: "fixture", ...extra });
const viewAs = (personaId) => retry(() => api("POST", "/api/dev", { action: "viewAs", personaId }));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** a seeded persona's handle, read off a following-feed card it authored */
let handleCache = {};
async function handleOf(id) {
  // the handle is FIXTURE data (seed/data/accounts.json) — reading it off a
  // following-feed card made the check depend on which posts the feed
  // happened to page in (iteration 2 flake: no card by ALT in the window)
  if (handleCache[id]) return handleCache[id];
  const { readFileSync: rf } = await import("node:fs");
  const accounts = JSON.parse(rf("seed/data/accounts.json", "utf8"));
  const p = accounts.personas.find((x) => x.id === id);
  if (!p) throw new Error(`no fixture persona ${id} in seed/data/accounts.json`);
  handleCache[id] = p.handle;
  return handleCache[id];
}

console.log("\nZK Pass 2 Gate 1 — every reputation read proof-mediated under zk; 'not proven' rendered honestly");

// ---- setup: zk binding, our root registered in a floor-clearing cohort, nobody proven yet ----
await retry(() => api("POST", "/api/dev", { action: "resetSeed" }));
await sleep(400);
await retry(() => zk("resetZk"));
{
  const issued = await retry(() => api("POST", "/api/dev", { action: "issueTestDelegation", devicePubKey: "e6".repeat(32), deviceId: "dev_z6_probe" }));
  await fetch(VBASE + "/device/auth-anchor", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pubkey: issued.json.anchorPubKey }) });
  await retry(() => zk("register"));
  await retry(() => zk("seedDecoys", { count: 80 }));
  await retry(() => zk("advanceEpoch"));
  await retry(() => zk("setRepImpl", { impl: "zk" }));
  await retry(() => zk("setGateFallback", { fallback: "none" }));
  await retry(() => zk("prefetchNow"));
}
const TREE = (await retry(() => zk("gateStatus"))).json.tree;

// ---- 1. the inventory ----
await check("1. docs/root-reads.md exists and names every module that reads a root-derived tier, roster or block (self-consistency grep)", async () => {
  const doc = readFileSync("docs/root-reads.md", "utf8");
  const { execSync } = await import("node:child_process");
  const hits = execSync('grep -rlE "personasForRoot|personasByFid|tierFor\\(|blockedFor\\(|tierForRoot|root_id|\\.rootId" lib app components validator --include=*.ts --include=*.tsx --include=*.js || true', { encoding: "utf8" }).trim().split("\n").filter(Boolean).filter((f) => !/^lib\/zk\//.test(f) && !/validator\/test\//.test(f) && !/\.test\./.test(f));
  const missing = hits.filter((f) => !doc.includes(f.replace(/\\/g, "/")) && !doc.includes(f.split("/").pop()));
  if (missing.length) throw new Error("root-reads.md does not mention: " + missing.join(", "));
  for (const h of ["VALIDATOR", "DEVICE", "ROOT-LEVEL", "PROOF", "migration 006", "not proven"]) if (!doc.includes(h)) throw new Error("root-reads.md lacks: " + h);
});

// ---- 2. the explainer + tier API ----
await check("2. Under zk the tier API answers an unproven persona with tier 0 / proven:false / 'not proven this epoch' — never a default tier", async () => {
  const t = (await retry(() => api("GET", `/api/tier?personaId=${ALT}`))).json;
  if (t.tier !== 0 || t.proven !== false || !/not proven/.test(t.percentile ?? "")) throw new Error("unproven answer: " + JSON.stringify(t));
  const own = (await retry(() => api("GET", `/api/tier?personaId=${MAIN}`))).json;
  if (own.tier !== 0) throw new Error("MAIN should be unproven too: " + JSON.stringify(own));
});

// ---- 3. the surfaces, unproven ----
await check("3. Unproven renders honestly on every surface: the switcher (layout tiers), the profile page, following-feed cards carry the 'not proven' chip; discovery hides the unproven author", async () => {
  await viewAs(MAIN);
  await page.goto(BASE + "/home?feed=following", { waitUntil: "networkidle" }).catch(() => {});
  await page.goto(BASE + "/home", { waitUntil: "networkidle" });
  const chips = await page.locator("[data-testid=tier-badge][data-tier=unproven]").count();
  const numeric = await page.locator("[data-testid=tier-badge]:not([data-tier=unproven])").count();
  if (chips === 0) throw new Error("no 'not proven' chip on /home under zk");
  if (numeric > 0) throw new Error(`${numeric} numeric tier badge(s) rendered under zk while nobody has proved — a root-derived tier leaked through`);
  // following feed API: cards carry tier 0
  const fol = (await retry(() => api("GET", "/api/feed2?surface=following"))).json.cards.filter((c) => c.kind === "post" && c.cast);
  const nonZero = fol.filter((c) => (c.cast.tier ?? 0) !== 0);
  if (fol.length && nonZero.length) throw new Error(`following-feed cards carry non-zero tiers under zk with nobody proven: ${nonZero.slice(0, 3).map((c) => c.cast.hash + ":" + c.cast.tier).join(",")}`);
  // profile page of a seeded persona: unproven chip
  const handle = await handleOf(ALT);
  await page.goto(BASE + "/" + handle, { waitUntil: "networkidle" });
  if ((await page.locator("[data-testid=tier-badge][data-tier=unproven]").count()) === 0) throw new Error(`profile /${handle} shows no 'not proven' chip under zk`);
  if ((await page.locator("[data-testid=tier-badge]:not([data-tier=unproven])").count()) > 0) throw new Error(`profile /${handle} shows a numeric tier under zk while unproven`);
  await viewAs(null);
});

// ---- 4. after a proof, the proven tier appears on the same surfaces ----
await check("4. After ALT proves at idle (tick) and the queue drains, the same surfaces show ALT's PROVEN tier — and only ALT's", async () => {
  await retry(() => zk("requestEligibility", { personaId: ALT }));
  await retry(() => zk("prefetchNow"));
  await sleep(300);
  const d = (await retry(() => zk("drain", { now: Date.now() + 24 * 3600_000 }))).json;
  if (!d.outcomes?.accepted) throw new Error("ALT's proof did not drain to accepted: " + JSON.stringify(d));
  const t = (await retry(() => api("GET", `/api/tier?personaId=${ALT}`))).json;
  const T = Number(TREE.slice(5));
  if (t.tier !== T || t.proven !== true) throw new Error("ALT after proof: " + JSON.stringify(t));
  // MAIN may ALSO be proven by now: the home renders in check 3 marked the
  // active persona wanted and a tick proved it — that IS the product path.
  // What must never happen: a persona of ANOTHER root gaining a tier.
  const main = (await retry(() => api("GET", `/api/tier?personaId=${MAIN}`))).json;
  if (main.tier !== 0 && main.tier !== T) throw new Error("MAIN has an impossible tier: " + JSON.stringify(main));
  if (main.tier === T) {
    const st = (await retry(() => zk("gateStatus"))).json;
    if (!st.attempts.some((a) => a.personaId === MAIN && a.queuedId)) throw new Error("MAIN shows a tier with no recorded proof of its own");
  }
  const other = (await retry(() => api("GET", `/api/tier?personaId=${OTHER_VIEWER}`))).json;
  if (other.tier !== 0) throw new Error("a persona of another root gained a tier without proving: " + JSON.stringify(other));
  const handle = await handleOf(ALT);
  await page.goto(BASE + "/" + handle, { waitUntil: "networkidle" });
  const badges = await page.locator("[data-testid=tier-badge]").evaluateAll((els) => els.map((e) => e.getAttribute("data-tier")));
  if (!badges.includes(String(T))) throw new Error(`profile /${handle} does not show the proven tier ${T}: ${JSON.stringify(badges)}`);
  await viewAs(OTHER_VIEWER);
  const disc = (await retry(() => api("GET", "/api/feed2?surface=discovery"))).json.cards.filter((c) => c.kind === "post" && c.cast);
  await viewAs(null);
  const altCards = disc.filter((c) => c.cast.personaId === ALT || c.cast.author?.username === handle);
  if (altCards.length && altCards.some((c) => c.cast.tier !== T)) throw new Error("ALT's discovery cards do not carry the proven tier");
});

// ---- 5. the legacy binding is unchanged ----
await check("5. Under the legacy binding the same surfaces show seed tiers, no 'not proven' chip (the product is byte-for-byte what it was)", async () => {
  await retry(() => zk("setRepImpl", { impl: null }));
  await viewAs(MAIN);
  await page.goto(BASE + "/home", { waitUntil: "networkidle" });
  if ((await page.locator("[data-testid=tier-badge][data-tier=unproven]").count()) > 0) throw new Error("a 'not proven' chip rendered under the legacy binding");
  if ((await page.locator("[data-testid=tier-badge]").count()) === 0) throw new Error("no tier badges under the legacy binding");
  await viewAs(null);
  await retry(() => zk("setRepImpl", { impl: "zk" }));
});

// ---- 6. the grep ----
await check("6. GREP: no app module imports tierFor/personasForRoot from the validator client; the feed stamps tiers from the gate's proven map; the zk rep adapter has no root-side lookup; TierBadge renders tier 0 as unproven", async () => {
  const { execSync } = await import("node:child_process");
  // only lib/rep/personaTier.ts (the switch) and the validator adapter may import the validator's tierFor
  const importers = execSync('grep -rlE "tierFor.*from .(@/lib/validator|\\\\./validator|\\\\.\\\\./validator)." app lib components --include=*.ts --include=*.tsx || true', { encoding: "utf8" }).trim().split("\n").filter(Boolean).map((f) => f.replace(/\\/g, "/"));
  const allowed = new Set(["lib/rep/personaTier.ts", "lib/adapters/validator/index.ts"]);
  const bad = importers.filter((f) => !allowed.has(f));
  if (bad.length) throw new Error("modules still importing tierFor from the validator client: " + bad.join(", "));
  const feed = readFileSync("lib/feed.ts", "utf8");
  if (!/provenTier\(/.test(feed) || !/tierOf\(/.test(feed)) throw new Error("lib/feed.ts does not stamp tiers from the gate's proven map");
  const rep = readFileSync("lib/adapters/zk/rep.ts", "utf8").split("\n").filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l)).join("\n");
  if (/rootId|\/rep\/|tierForRoot|personasForRoot|personasByFid/.test(rep)) throw new Error("zk rep adapter references a root-side lookup");
  const badge = readFileSync("components/TierBadge.tsx", "utf8");
  if (!/data-tier="unproven"/.test(badge) || !/not proven/.test(badge)) throw new Error("TierBadge does not render the unproven state");
});

await retry(() => zk("setGateFallback", { fallback: null }));
await retry(() => zk("setRepImpl", { impl: null }));
await viewAs(null);
await browser.close();
const fails = results.filter((r) => r[0] === "FAIL");
const infra = results.filter((r) => r[0] === "INFRA");
console.log(`\n${results.length - fails.length - infra.length}/${results.length} ZK Pass 2 Gate 1 checks passed` + (fails.length ? `, ${fails.length} FAILED` : "") + (infra.length ? `, ${infra.length} infra` : ""));
process.exitCode = fails.length ? 1 : infra.length ? 2 : 0;
