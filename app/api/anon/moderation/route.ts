import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// PUBLIC GO-LIVE (the relay track) — THE PUBLIC @anon's TAKEDOWN QUEUE, from this device (Settings › Moderation).
//
// GET                       this device's moderator PUBLIC key (lib/zk/anon/moderation.ts, HKDF branch "layers/anon-moderator/1"
//                           of the vault key — the key to copy into arm-public-anon.ps1 -ModeratorKey), whether it is one of
//                           the validator's moderators (its public list), and whether the site has a moderator at all. It
//                           answers for EVERY visitor: a non-moderator hears "You are not a moderator on this site", never
//                           an error (a key that cannot be read here is said so, plainly, beside that sentence).
// GET ?list=1               a moderator's SIGNED read of the reported posts and the removed ones (validator/anonpublic.js
//                           review). Signed on this device; the validator verifies it against the moderators' PUBLIC keys.
// POST {action:"decide", castHash, decision: "remove" | "keep"}   a SIGNED decision. Remove: the post is hidden in Totem at
//                           once (kept, never deleted) and — live — deleted from Farcaster through the agent signer, retried
//                           a bounded number of times; the answer says where the delete stands. Keep: the reports so far
//                           are dismissed. PUBLIC GO-LIVE (ASM-2C): an optional universe ("live" | "fixture", default this tab's)
//                           names which universe the post is in — signed into the decision, so a moderator in a live tab can
//                           still remove a test-universe post by its hash (Settings › Moderation offers it for a pasted hash).
// RIG ONLY (ZK_DEV_HOOKS=true, never under LAYERS_WORLD=empty): {action:"registerTestModerator"} adds this device's key to the
//                           rig validator's test moderators (memory).
// Answered by the visitor's browser device on the public site; NO node-only import at the top.

const NOT_A_MODERATOR = "You are not a moderator on this site.";
/** the delete states, in plain words (validator/anonpublic.js decide / deleteDue) */
const DELETE_STATE_WORDS: Record<string, string> = {
  pending: "Hidden in Totem. Deleting it from Farcaster now.",
  retrying: "Hidden in Totem. Farcaster didn't confirm the delete yet; trying again.",
  deleted: "Hidden in Totem and deleted from Farcaster.",
  "not-found": "Hidden in Totem. Farcaster says the post isn't there any more.",
  unknown: "Hidden in Totem. Couldn't confirm it was deleted from Farcaster after several tries; check the @anon account on Farcaster.",
  "never-posted": "Hidden in Totem. It hadn't reached Farcaster yet, and now it never will.",
  "not-on-network": "Hidden in Totem. It was a test post and never reached Farcaster.",
  // PUBLIC GO-LIVE (ASM-4): the @anon key was taken off the site (arm-public-anon.ps1 -Disarm -RevokeKey), so nothing can be
  // deleted from Farcaster until it is back (switching the relay off alone never stops a delete)
  waiting: "Hidden in Totem. It will be deleted from Farcaster once the @anon account's key is back on the site.",
  none: "Kept.",
};

async function moderatorFacts(mode: "fixture" | "live") {
  let publicKey: string | null = null;
  let keyError: string | null = null;
  try {
    publicKey = await (await import("@/lib/zk/anon/moderation")).anonModeratorPublicKey();
  } catch (e) {
    keyError = "This identity's moderator key couldn't be read here (" + String((e as Error)?.message ?? e).slice(0, 120) + ").";
  }
  let moderators: string[] | null = null;
  let listError: string | null = null;
  try {
    moderators = (await (await import("@/lib/zk/validatorClient")).fetchAnonPublicStatus(mode)).moderators;
  } catch (e) {
    listError = "Couldn't read the site's moderators just now (" + String((e as Error)?.message ?? e).slice(0, 120) + ").";
  }
  const isModerator = !!publicKey && Array.isArray(moderators) && moderators.includes(publicKey);
  return { publicKey, keyError, moderators, listError, isModerator };
}

export async function GET(req: NextRequest) {
  const { zkMode } = await import("@/lib/zk/config");
  const mode = zkMode();
  const f = await moderatorFacts(mode);
  const base = {
    mode,
    publicKey: f.publicKey,
    keyError: f.keyError,
    isModerator: f.isModerator,
    // null = the list could not be read (never "no moderator" on a failed read)
    moderated: Array.isArray(f.moderators) ? f.moderators.length > 0 : null,
    listError: f.listError,
    sentence: f.isModerator ? "This device moderates the site's anonymous posts." : NOT_A_MODERATOR,
    devHooks: process.env.ZK_DEV_HOOKS === "true",
  };
  if (req.nextUrl.searchParams.get("list") !== "1") return NextResponse.json(base);
  if (!f.isModerator) return NextResponse.json({ ...base, items: null, removed: null }, { status: 403 });
  try {
    const { signAnonReview } = await import("@/lib/zk/anon/moderation");
    const { fetchAnonModeration } = await import("@/lib/zk/validatorClient");
    const r = await fetchAnonModeration(await signAnonReview(mode));
    if (r.status !== 200 || !r.json) return NextResponse.json({ ...base, items: null, removed: null, error: typeof r.json?.error === "string" ? r.json.error : "the validator answered " + r.status }, { status: r.status === 403 ? 403 : 502 });
    const removed = Array.isArray(r.json.removed) ? (r.json.removed as Array<Record<string, unknown>>).map((x) => ({ ...x, deleteWords: DELETE_STATE_WORDS[String(x.deleteState)] ?? String(x.deleteState) })) : [];
    return NextResponse.json({ ...base, items: r.json.items ?? [], removed });
  } catch (e) {
    return NextResponse.json({ ...base, items: null, removed: null, error: "Couldn't read the reported posts just now (" + (e as Error).message + ")." }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { action?: unknown; castHash?: unknown; decision?: unknown; universe?: unknown };
  const { zkMode } = await import("@/lib/zk/config");
  const tabMode = zkMode();
  if (body.action === "registerTestModerator") {
    if (process.env.ZK_DEV_HOOKS !== "true") return NextResponse.json({ error: "this is a test-rig action — refused unless ZK_DEV_HOOKS=true" }, { status: 403 });
    if ((await import("@/lib/world-flag")).isEmptyWorld()) return NextResponse.json({ error: "refused under LAYERS_WORLD=empty — the owner service is not a test rig" }, { status: 403 });
    const { anonModeratorPublicKey } = await import("@/lib/zk/anon/moderation");
    const r = await (await import("@/lib/zk/validatorClient")).anonDevModerator(await anonModeratorPublicKey());
    return NextResponse.json(r.json ?? {}, { status: r.status });
  }
  if (body.action !== "decide") return NextResponse.json({ error: "action must be decide" }, { status: 400 });
  const castHash = typeof body.castHash === "string" ? body.castHash.toLowerCase() : "";
  if (!/^[0-9a-f]{64}$/.test(castHash)) return NextResponse.json({ error: "That isn't an anonymous post's hash." }, { status: 400 });
  if (body.decision !== "remove" && body.decision !== "keep") return NextResponse.json({ error: "decision must be remove or keep" }, { status: 400 });
  // ASM-2C: the universe the post is in — named explicitly (a pasted hash), else this tab's; signed into the decision below
  if (body.universe !== undefined && body.universe !== "live" && body.universe !== "fixture") return NextResponse.json({ error: "universe must be live or fixture" }, { status: 400 });
  const mode: "fixture" | "live" = body.universe === "live" || body.universe === "fixture" ? body.universe : tabMode;
  const f = await moderatorFacts(mode);
  if (!f.isModerator) return NextResponse.json({ error: f.keyError ?? f.listError ?? NOT_A_MODERATOR }, { status: 403 });
  try {
    const { signTakedown } = await import("@/lib/zk/anon/moderation");
    const { postAnonModeration } = await import("@/lib/zk/validatorClient");
    const r = await postAnonModeration(await signTakedown(mode, castHash, body.decision));
    const state = typeof r.json?.deleteState === "string" ? r.json.deleteState : null;
    if (r.status === 200) return NextResponse.json({ ...(r.json ?? {}), sentence: body.decision === "keep" ? "Kept. Its reports are dismissed." : DELETE_STATE_WORDS[state ?? ""] ?? "Removed." });
    // ASM-2C: say WHICH universe was looked in, so a moderator can try the other one for a pasted hash
    if (r.status === 404) return NextResponse.json({ ...(r.json ?? {}), error: "No anonymous post with that hash in the " + (mode === "live" ? "live (Farcaster)" : "test") + " posts.", sentence: null }, { status: 404 });
    return NextResponse.json({ ...(r.json ?? {}), sentence: state ? DELETE_STATE_WORDS[state] ?? null : null }, { status: r.status >= 400 && r.status < 600 ? r.status : 502 });
  } catch (e) {
    return NextResponse.json({ error: "The decision wasn't recorded (" + (e as Error).message + ")." }, { status: 503 });
  }
}
