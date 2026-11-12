// MULTI-FID PASS — Gate 4 LIVE recorder: ONE real anonymous cast through the shared anon account.
//
// The USER's action, never a sweep's. Refuses unless:
//   - ENABLE_FC_WRITE=true in THIS process's environment (the explicit arming flag),
//   - the running app answers on the pinned port and is on the LIVE zk universe (ZK_MODE=live),
//   - the running validator reports a live anon relay (its own FC_ANON_FID + FC_ANON_SIGNER_UUID + NEYNAR_API_KEY).
// Then: POST /api/anon { text } (queued; the app proves at idle and sends at a jittered time over the
// anonymous channel), poll the queue item until it is sent, read the public anon list for the network
// hash, and record research/live-fid4.json (hash, castHash, fid, time — never a key, never a persona).
import { existsSync, mkdirSync, writeFileSync } from "node:fs";

const BASE = process.env.BASE_URL || `http://localhost:${process.env.LAYERS_APP_PORT || 3001}`;
const VBASE = process.env.VALIDATOR_URL || `http://localhost:${process.env.LAYERS_VALIDATOR_PORT || 4001}`;
// a refusal sets the exit code and lets the event loop drain (process.exit during an in-flight fetch
// can fail-fast on Windows with 0xC0000409 — the code, not the message, was wrong)
class Refusal extends Error {}
const refuse = (why) => {
  throw new Refusal(why);
};
try {
  await main();
} catch (e) {
  if (e instanceof Refusal) {
    console.error("REFUSED: " + e.message);
    process.exitCode = 2;
  } else {
    console.error("ERROR: " + (e?.stack ?? e));
    process.exitCode = 1;
  }
}

async function main() {
if (process.env.ENABLE_FC_WRITE !== "true") refuse("ENABLE_FC_WRITE=true is required — this command makes ONE real network write through the shared anon account");
const health = await fetch(BASE + "/api/health").then((r) => r.json()).catch(() => null);
if (!health) refuse("the app is not answering on " + BASE);
const status = await fetch(BASE + "/api/anon").then((r) => r.json()).catch(() => null);
if (!status?.config) refuse("the app cannot read the validator's anon-post config: " + JSON.stringify(status).slice(0, 200));
const mode = status.mode ?? null;
if (mode !== "live") refuse("the app is on the '" + mode + "' zk universe — the live recorder needs ZK_MODE=live (a fixture proof is not anonymity)");
if (status.config.liveRelay !== true) refuse("the validator reports no live anon relay (FC_ANON_FID / FC_ANON_SIGNER_UUID / NEYNAR_API_KEY on the VALIDATOR)");
if (status.privacy && status.privacy.private !== true) console.warn("NOTE: the privacy label is DEMO — " + status.privacy.label + " — the cast is still relayed with zero attribution; the label names what is not yet private about the CHANNEL");

// MULTI-FID Gate 5 (attack-fid-1 #6): the default text carries no marker used by any persona fid
const text = process.argv.slice(2).join(" ").trim() || `a thought for the window, ${new Date().toISOString().slice(0, 16)}`;
const post = await fetch(BASE + "/api/anon", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
const pj = await post.json().catch(() => null);
if (post.status !== 202 || !pj?.castHash) refuse("the app did not queue the anon post: " + post.status + " " + JSON.stringify(pj).slice(0, 200));
console.log("queued anonymously: castHash " + pj.castHash + " (proved at idle, sent at a random time inside the window — this may take up to the jitter maximum)");
const deadline = Date.now() + Number(process.env.LIVE_FID4_WAIT_MS ?? 20 * 60_000);
let item = null;
while (Date.now() < deadline) {
  const s = await fetch(BASE + "/api/anon?castHash=" + pj.castHash).then((r) => r.json()).catch(() => null);
  item = s?.item ?? null;
  if (item?.status === "sent" || item?.status === "refused") break;
  await new Promise((r) => setTimeout(r, 15_000));
}
if (!item || item.status !== "sent" || item.outcome !== "accepted") refuse("the anon post was not accepted within the wait: " + JSON.stringify(item));
const casts = await fetch(VBASE + "/zk/anon-casts?mode=live").then((r) => r.json()).catch(() => null);
const cast = casts?.casts?.find((c) => c.castHash === pj.castHash) ?? null;
if (!cast) refuse("accepted, but the validator's public anon list does not show the cast yet: " + JSON.stringify(casts).slice(0, 200));
if (!existsSync("research")) mkdirSync("research");
const record = { at: new Date().toISOString(), castHash: pj.castHash, networkHash: cast.hash, fid: cast.fid, relayedAt: cast.at, text, url: `https://warpcast.com/~/conversations/${cast.hash}` };
writeFileSync("research/live-fid4.json", JSON.stringify(record, null, 2) + "\n");
console.log("recorded research/live-fid4.json: " + JSON.stringify(record));
}
