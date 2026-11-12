// ADS, PHASE 1 — THE CREATIVE REVIEW, OWNER-SIGNED (docs/roadmap/ad-auction.md §7; SECURITY-POSTURE.md §41).
//
// A lot in public/ads/lots.json is shown only when its `review` is an approval under the current policy
// (lib/ads/policy.ts AD_POLICY_ID), signed by a reviewer key pinned in lib/ads/reviewers.json, over the lot's exact
// terms (lib/ads/canonical.mjs: the same code the browser runs to check it). Edit any word of a lot and its approval
// stops counting until this script signs it again.
//
//   npm run ads:approve                         show what needs a review (nothing is written)
//   npm run ads:approve -- --yes                approve every lot that needs it, as the reviewer on this machine
//   npm run ads:approve -- --yes --lot <id>     only that lot
//   npm run ads:approve -- --yes --reject <id>  record a rejection (the lot is never shown)
//   npm run ads:approve -- --new-reviewer       make this machine's reviewer key and pin it (REPLACES the pinned keys:
//                                               every lot signed by an old key needs approving again)
//   npm run ads:approve -- --check              exit 1 when any lot would not be shown (for a pre-deploy check)
//
// THE KEY: .keystore/ad-reviewer.json (gitignored, never committed, never sent anywhere), or AD_REVIEWER_KEY_FILE. A
// random Ed25519 seed; only its public half goes into the repository. Running the script IS the review: read the lot it
// prints against the policy it prints before adding --yes.
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(ROOT, "package.json"));
const { ed25519 } = require("@noble/curves/ed25519");
const { lotTermsString, reviewCanonical } = await import(pathToFileURL(path.join(ROOT, "lib", "ads", "canonical.mjs")).href);

const LOTS = path.join(ROOT, "public", "ads", "lots.json");
const REVIEWERS = path.join(ROOT, "lib", "ads", "reviewers.json");
const POLICY_TS = path.join(ROOT, "lib", "ads", "policy.ts");
const KEY_FILE = process.env.AD_REVIEWER_KEY_FILE || path.join(ROOT, ".keystore", "ad-reviewer.json");

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const valueOf = (n) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] ?? null : null;
};
const YES = flag("--yes");
const ONLY = valueOf("--lot");
const REJECT = valueOf("--reject");
const CHECK = flag("--check");
const NEW = flag("--new-reviewer");

const hex = (u8) => Buffer.from(u8).toString("hex");
const sha256hex = (s) => createHash("sha256").update(Buffer.from(s, "utf8")).digest("hex");
const writeJson = (file, obj) => writeFileSync(file, JSON.stringify(obj, null, 2).replace(/\n/g, "\r\n") + "\r\n");
const today = () => new Date().toISOString().slice(0, 10);

const policySrc = readFileSync(POLICY_TS, "utf8");
const POLICY = (policySrc.match(/export const AD_POLICY_ID = "([^"]+)"/) || [])[1];
const POLICY_TEXT = (policySrc.match(/export const AD_POLICY_TEXT =\s*"([^"]+)"/) || [])[1] || "(see lib/ads/policy.ts)";
if (!POLICY) {
  console.log("ads:approve: cannot read AD_POLICY_ID from lib/ads/policy.ts");
  process.exit(2);
}
const list = JSON.parse(readFileSync(LOTS, "utf8"));
let pinned = JSON.parse(readFileSync(REVIEWERS, "utf8"));
if (!Array.isArray(pinned.keys)) pinned = { ...pinned, keys: [] };

function loadKey() {
  if (!existsSync(KEY_FILE)) return null;
  const k = JSON.parse(readFileSync(KEY_FILE, "utf8"));
  if (k.v !== 1 || !/^[0-9a-f]{64}$/.test(k.seed || "")) throw new Error("ads:approve: " + KEY_FILE + " is not a reviewer key file");
  const seed = Uint8Array.from(Buffer.from(k.seed, "hex"));
  return { seed, pub: hex(ed25519.getPublicKey(seed)) };
}

if (NEW) {
  let key = loadKey();
  if (!key) {
    mkdirSync(path.dirname(KEY_FILE), { recursive: true });
    const seed = randomBytes(32);
    writeFileSync(KEY_FILE, JSON.stringify({ v: 1, seed: seed.toString("hex"), createdAt: new Date().toISOString() }) + "\n", { mode: 0o600 });
    key = loadKey();
    console.log("ads:approve: made a reviewer key at " + path.relative(ROOT, KEY_FILE) + " (keep it; it is never committed)");
  }
  pinned = { ...pinned, keys: [key.pub] };
  writeJson(REVIEWERS, pinned);
  console.log("ads:approve: pinned reviewer " + key.pub + " in lib/ads/reviewers.json (the only pinned key now)");
  console.log("ads:approve: every lot signed by another key needs approving again: run with --yes");
  if (!YES) process.exit(0);
}

/** why a lot would not be shown as it stands (null: it would be) */
function standing(lot) {
  const r = lot.review;
  if (!r) return "not reviewed";
  if (r.policy !== POLICY) return "reviewed under " + r.policy + ", not " + POLICY;
  if (!pinned.keys.includes(r.reviewer)) return "signed by a key that is not pinned";
  const line = reviewCanonical(r.policy, lot.id, sha256hex(lotTermsString(lot)), r.decision, r.reviewedAt);
  let ok = false;
  try {
    ok = ed25519.verify(Uint8Array.from(Buffer.from(r.sig, "hex")), new TextEncoder().encode(line), Uint8Array.from(Buffer.from(r.reviewer, "hex")));
  } catch {
    ok = false;
  }
  if (!ok) return "changed since it was reviewed (the signature no longer matches its words)";
  if (r.decision !== "approved") return "rejected";
  return null;
}

const lots = Array.isArray(list.lots) ? list.lots : [];
const needing = lots.filter((l) => (ONLY ? l.id === ONLY : true) && (REJECT ? l.id === REJECT : true)).map((l) => ({ lot: l, why: standing(l) }));
console.log("\nTotem ad review — policy " + POLICY + ":\n  " + POLICY_TEXT + "\n");
for (const { lot, why } of needing) {
  console.log("  " + lot.id + " (" + lot.placement + ", " + (lot.audience?.kind === "mode" ? "modes: " + lot.audience.modes.join(", ") : "generic") + (lot.house ? ", house" : "") + "): " + (why ? why.toUpperCase() : "approved, shown"));
  if (why || REJECT) {
    console.log("      " + lot.advertiser?.name + " @" + lot.advertiser?.handle);
    console.log("      " + JSON.stringify(lot.creative?.headline) + " — " + JSON.stringify(lot.creative?.body));
    console.log("      [" + lot.creative?.cta + "] → " + lot.creative?.url);
  }
}
if (CHECK) {
  const bad = lots.filter((l) => standing(l) !== null && standing(l) !== "rejected");
  console.log("\n" + (bad.length ? bad.length + " lot(s) would not be shown: " + bad.map((l) => l.id).join(", ") : "every lot is reviewed under " + POLICY));
  process.exit(bad.length ? 1 : 0);
}
const todo = needing.filter(({ why }) => (REJECT ? true : why !== null && why !== "rejected"));
if (!todo.length) {
  console.log("\nnothing needs a review");
  process.exit(0);
}
if (!YES) {
  console.log("\n" + todo.length + " lot(s) need a review. Read them against the policy above, then run again with --yes" + (REJECT ? "" : " (or --yes --reject <id>)"));
  process.exit(0);
}
const key = loadKey();
if (!key) {
  console.log("\nads:approve: no reviewer key on this machine (" + path.relative(ROOT, KEY_FILE) + "). Run with --new-reviewer once to make and pin one.");
  process.exit(2);
}
if (!pinned.keys.includes(key.pub)) {
  console.log("\nads:approve: this machine's reviewer key " + key.pub + " is not pinned in lib/ads/reviewers.json. Run with --new-reviewer to pin it.");
  process.exit(2);
}
const at = today();
for (const { lot } of todo) {
  const decision = REJECT ? "rejected" : "approved";
  const { review: _old, ...terms } = lot;
  const line = reviewCanonical(POLICY, lot.id, sha256hex(lotTermsString(terms)), decision, at);
  const sig = hex(ed25519.sign(new TextEncoder().encode(line), key.seed));
  lot.review = { decision, policy: POLICY, reviewer: key.pub, reviewedAt: at, sig };
  console.log("  " + decision + ": " + lot.id);
}
list.version = (Number.isSafeInteger(list.version) ? list.version : 0) + 1;
writeJson(LOTS, list);
console.log("\nwrote public/ads/lots.json (version " + list.version + "); rebuild and deploy for it to reach the site");
