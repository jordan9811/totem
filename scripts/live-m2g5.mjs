// MEGA PASS 2 Gate 5 — THE LIVE RECORDER for the @totem inbox: ONE real, read-only DM poll, itemized through the
// spend ledger. This is the USER's command. It refuses unless the Totem account's read token, the X client id and
// ENABLE_X_READ=true are all present, and it never replies on X (this pass is read-only there).
//
//   X_API_CLIENT_ID=… X_LAYERS_INBOX_TOKEN=… ENABLE_X_READ=true node scripts/live-m2g5.mjs
//
// It prints the poll's itemized cost from the ledger and what landed (persona ids and post hashes only — never a
// DM's text, which goes straight into the recipient's vault). Nothing is written to research/ unless the poll ran.
import { writeFileSync } from "node:fs";

const BASE = process.env.BASE_URL || `http://localhost:${process.env.LAYERS_APP_PORT || 3001}`;
const missing = ["X_API_CLIENT_ID", "X_LAYERS_INBOX_TOKEN"].filter((k) => !process.env[k]);
if (missing.length || process.env.ENABLE_X_READ !== "true") {
  console.log("REFUSED: live inbox read needs X_API_CLIENT_ID, X_LAYERS_INBOX_TOKEN and ENABLE_X_READ=true (missing: " + [...missing, ...(process.env.ENABLE_X_READ !== "true" ? ["ENABLE_X_READ"] : [])].join(", ") + "). No network call was made.");
  process.exit(2);
}
const info = await fetch(BASE + "/api/x/inbox").then((r) => r.json());
if (info.mode !== "live") {
  console.log("REFUSED: the app's inbox is in " + info.mode + " mode — start it with the same environment. No network call was made.");
  process.exit(2);
}
const before = (await fetch(BASE + "/api/x/spend").then((r) => r.json()).catch(() => null)) ?? {};
const r = await fetch(BASE + "/api/x/inbox", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "poll" }) });
const j = await r.json();
if (!r.ok) {
  console.log("REFUSED by the ledger or the API: " + (j.error ?? r.status));
  process.exit(1);
}
const after = (await fetch(BASE + "/api/x/spend").then((r2) => r2.json()).catch(() => null)) ?? {};
const record = {
  at: new Date().toISOString(),
  mode: j.mode,
  cost: j.cost,
  polled: j.polled,
  landed: j.landed.map((l) => ({ personaId: l.personaId, hash: l.hash })),
  replied: j.replied.length,
  skipped: j.skipped.length,
  cursor: j.cursor,
  ledgerBefore: before.liveTotal ?? null,
  ledgerAfter: after.liveTotal ?? null,
};
writeFileSync("research/live-m2g5.json", JSON.stringify(record, null, 2));
console.log("ONE live inbox read, itemized: $" + Number(j.cost).toFixed(3) + " — " + j.polled + " DMs polled, " + j.landed.length + " landed, " + j.replied.length + " unlinked (replies recorded, not sent). Written to research/live-m2g5.json");
