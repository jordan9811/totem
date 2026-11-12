import "server-only";
// PERSONA LAUNCH P8 — the @totem X outbox, the DEVICE's half (what app/api/x/outbox/route.ts answers). Everything here
// runs on the device that holds the identity (the rig's or the owner service's server process). Three things:
//   • OFFERED? — only where anonymous posting is on, not a labelled preview, not the public browser device
//     (D-X-PUBLIC-OFF), and in the FIXTURE universe (no live transport exists: O4). Said in plain words when not.
//   • SUBMIT — lib/zk/gate.ts requestXAnonPost: every refusal BEFORE anything is minted or written; the copy waits in the
//     wanted set for the next tick. Its refusals map to statuses here.
//   • VIEW — this device's copies, each matched against the outbox's PUBLIC list as the last tick read it
//     (lib/x/outbox/status.ts); the queue counts; whether this device holds a moderator key the validator honours.
//   • MODERATE / REVIEW — signed on this device (lib/x/outbox/moderation.ts), sent to the validator. An identified act by
//     design: the moderator is the owner, deciding in the open what the shared account may say.
// Every answer carries testData: true. Nothing here reaches X: the validator's fixture transport is the only one.

export const X_STATUS_OF_CODE: Record<string, number> = { unavailable: 503, "bad-text": 400, window: 409, persona: 403, "post-mode": 409, "relay-cap": 409, full: 429, copy: 400 };

/** is posting a copy to @totem on X offered on this device right now? Never throws (unreadable = not offered). */
export async function xOffered(): Promise<{ offered: boolean; reason: string | null; scope: "deployment" | "now" | null }> {
  try {
    const { X_NOT_BUILT_SENTENCE, X_PREVIEW_OFF_SENTENCE, X_NO_MODERATOR_SENTENCE, X_MODERATION_UNREAD_SENTENCE } = await import("@/lib/zk/gate");
    if (typeof window !== "undefined") return { offered: false, reason: X_PREVIEW_OFF_SENTENCE, scope: "deployment" };
    const { zkMode } = await import("@/lib/zk/config");
    const { anonPostingAvailability } = await import("@/lib/zk/anon/availability");
    const mode = zkMode();
    const av = anonPostingAvailability({ mode });
    if (av.previewOnly) return { offered: false, reason: X_PREVIEW_OFF_SENTENCE, scope: "deployment" };
    if (mode !== "fixture") return { offered: false, reason: X_NOT_BUILT_SENTENCE, scope: "deployment" };
    if (!av.on) return { offered: false, reason: av.reason ?? "Anonymous posting is off here, so nothing goes to @totem on X either.", scope: av.scope ?? "deployment" };
    // PERSONA LAUNCH wave 3 (UXH-6): NOTHING GOES OUT WITHOUT A MODERATOR. A copy offered where no moderator exists spent
    // the window's X slot and then sat in "Waiting for review" for good while its status line polled — and the toggle
    // promised "a moderator reads it". Judged from the LAST TICK's outbox read (no fetch here); a config not read, or one
    // that does not say, is "not offered" (scope "now": the next check may say otherwise) — never a pass.
    const { cachedXOutbox } = await import("@/lib/zk/prefetch");
    const cfg = cachedXOutbox(mode)?.config ?? null;
    if (!cfg || typeof cfg.moderated !== "boolean") return { offered: false, reason: X_MODERATION_UNREAD_SENTENCE, scope: "now" };
    if (cfg.moderated !== true) return { offered: false, reason: X_NO_MODERATOR_SENTENCE, scope: "now" };
    return { offered: true, reason: null, scope: null };
  } catch (e) {
    return { offered: false, reason: "Couldn't check whether posting to @totem on X is on here (" + (e as Error).message + ").", scope: "now" };
  }
}

/** POST {text, personaId?, copyOf?, force?} — the compose gate; `force` only reaches it on a rig (the route checks) */
export async function submitXCopy(body: { text?: unknown; personaId?: unknown; copyOf?: unknown; force?: boolean }): Promise<{ status: number; json: Record<string, unknown> }> {
  const { requestXAnonPost } = await import("@/lib/zk/gate");
  let personaId: string | null;
  if (body.personaId !== undefined) personaId = typeof body.personaId === "string" ? body.personaId : "";
  else {
    const { defaultPostingPersonaId } = await import("@/lib/identity/postMode");
    personaId = await defaultPostingPersonaId().catch(() => null);
  }
  if (!personaId) return { status: 409, json: { error: "No persona yet — create one in Settings › Account & Personas first.", code: "persona", testData: true } };
  if (body.copyOf !== undefined && body.copyOf !== null && typeof body.copyOf !== "string") return { status: 400, json: { error: "that isn't one of your anonymous posts", code: "copy", testData: true } };
  const r = await requestXAnonPost(typeof body.text === "string" ? body.text : "", { personaId, copyOf: typeof body.copyOf === "string" ? body.copyOf : null, force: body.force === true });
  if (!r.ok) return { status: X_STATUS_OF_CODE[r.code ?? ""] ?? 400, json: { error: r.reason, code: r.code ?? null, testData: true } };
  return {
    status: 202,
    json: {
      queued: true,
      xHash: r.xHash,
      testData: true,
      note: "proved at idle, sent at a random time inside the window, held for a moderator's review, then posted at the outbox's next slot — through the test transport only: nothing reaches X",
    },
  };
}

/** this device's moderator key, and whether the validator (as the last tick read it) honours it */
async function moderatorView(moderators: string[] | null): Promise<{ pubkey: string | null; isModerator: boolean; configured: boolean; error: string | null }> {
  try {
    const { moderatorPublicKey } = await import("./moderation");
    const pubkey = await moderatorPublicKey();
    return { pubkey, isModerator: !!moderators && moderators.includes(pubkey), configured: !!moderators && moderators.length > 0, error: null };
  } catch (e) {
    return { pubkey: null, isModerator: false, configured: !!moderators && moderators.length > 0, error: (e as Error).message };
  }
}

/** PERSONA LAUNCH wave 3 (UXH-1): the view could not read which personas it may show — the route answers 503 */
export class XOutboxScopeError extends Error {}

/**
 * GET — offered or why not, the client's K_X, the last tick's config, the queue counts, this device's copies (or one).
 *
 * PERSONA LAUNCH wave 3 (UXH-1) — SCOPED LIKE EVERY OWN-DATA VIEW. The copies are filtered to the personas this view may
 * enumerate (lib/identity/chrome.ts visibleOwnPersonaIds: the active persona alone under compartment mode), for ?xHash=
 * too — a sibling's copy, the words it posted and which anon post it copies, is "one of MY things the view hides". A
 * scope that cannot be read throws XOutboxScopeError (the route answers 503), never an unscoped list. A copy whose
 * persona the sealed record does not name (none is minted without one) is shown to no scope. And the answer carries
 * neither personaId nor copyOf (nothing on the page reads them); a RIG reads them through the envelope read only.
 */
export async function xOutboxView(xHash: string | null): Promise<Record<string, unknown>> {
  const offer = await xOffered();
  const { ZK_X_ANON_POST_SLOTS, zkMode } = await import("@/lib/zk/config");
  const mode = zkMode();
  const devHooks = process.env.ZK_DEV_HOOKS === "true" && !(await import("@/lib/world-flag")).isEmptyWorld();
  const base: Record<string, unknown> = { testData: true, mode, offered: offer.offered, reason: offer.reason, scope: offer.scope, slotsPerWindow: ZK_X_ANON_POST_SLOTS, devHooks };
  if (!offer.offered && offer.scope === "deployment") return base;
  const { cachedXOutbox } = await import("@/lib/zk/prefetch");
  const { xRecords, xSubmissionItems } = await import("@/lib/zk/anon/queue");
  const { wantedXPosts } = await import("@/lib/zk/gate");
  const { xOutcome } = await import("@/lib/zk/anon/outcomes");
  const { xCopyStatus, xQueueCounts } = await import("./status");
  const snap = cachedXOutbox(mode);
  const list = snap?.list ?? null;
  const byId = new Map((list ?? []).map((r) => [r.id, r]));
  const items = await xSubmissionItems();
  const itemOf = new Map(items.filter((q) => q.xHash).map((q) => [q.xHash as string, q]));
  const wantedList = wantedXPosts();
  const wanted = new Set(wantedList.map((w) => w.xHash));
  const view = (rec: { xHash: string; personaId: string | null; copyOf: string | null; at: number; settled?: { status: string; outcome: string | null } | null }) => {
    const o = xOutcome(rec.xHash);
    const st = xCopyStatus({ row: byId.get(rec.xHash) ?? null, item: itemOf.get(rec.xHash) ?? null, settled: rec.settled ?? null, outcome: o, wanted: wanted.has(rec.xHash) });
    const row = byId.get(rec.xHash);
    // the tick's last word on it (which stage, why) — device-local, for the status line's detail and the rig. UXH-1: no
    // personaId, no copyOf (the scope below already decided this persona may be shown; nothing on the page reads them)
    return { xHash: rec.xHash, ...st, text: row?.status === "posted" ? row.text : null, lastStage: o?.lastStage ?? null, lastReason: o?.reason ?? null };
  };
  // UXH-1: the personas this view may show (compartment mode: the active one alone) — unreadable is a refusal, not "all"
  let visible: Set<string>;
  try {
    const { visibleOwnPersonaIds } = await import("@/lib/identity/chrome");
    visible = new Set(await visibleOwnPersonaIds());
  } catch (e) {
    throw new XOutboxScopeError("couldn't read which of your personas this view may show (" + (e as Error).message + ")");
  }
  const records = (await xRecords(mode)).filter((r) => r.personaId !== null && visible.has(r.personaId));
  const config = snap?.config ?? null;
  const out: Record<string, unknown> = {
    ...base,
    outboxReadAt: snap?.fetchedAt ?? null,
    outboxError: snap ? snap.error : "not read yet — the next check reads it",
    config: config
      ? { xSlotsPerWindow: config.xSlotsPerWindow, dailyCap: config.dailyCap, dailyUsed: config.dailyUsed, postedToday: config.postedToday, relayIntervalMs: config.relayIntervalMs, relaySpreadMs: config.relaySpreadMs, moderated: config.moderated, transport: config.transport }
      : null,
    counts: xQueueCounts(list),
    moderator: await moderatorView(config ? config.moderators : null),
  };
  if (xHash !== null) {
    if (!/^[0-9a-f]{64}$/.test(xHash)) return { ...out, error: "xHash must be 64 hex" };
    const rec = records.find((r) => r.xHash === xHash);
    if (rec) {
      out.item = view(rec);
      return out;
    }
    // no sealed record in THIS scope: what the tick's log and the wanted set say — but only for a copy of a persona this
    // scope may see (a dropped copy keeps no record; its log entry names its persona). A sibling's copy, or a hash this
    // device never sent, gets the same "no record" answer, so the view cannot be used to probe a hidden persona's copies.
    const o0 = xOutcome(xHash);
    const o = o0 && typeof o0.personaId === "string" && visible.has(o0.personaId) ? o0 : null;
    const w = wantedList.find((x) => x.xHash === xHash);
    const isWanted = !!w && typeof w.personaId === "string" && visible.has(w.personaId);
    out.item = { xHash, ...xCopyStatus({ row: null, item: null, settled: null, outcome: o, wanted: isWanted }), lastStage: o?.lastStage ?? null, lastReason: o?.reason ?? null };
    return out;
  }
  out.items = records.map(view);
  return out;
}

/** RIG ONLY (the route checks the dev hooks): an X copy's sealed record — the persona it was sent as and the anon post it
 *  copies (UXH-1: the product view no longer carries either) — or null when this device keeps none */
export async function xRecordForRig(xHash: string): Promise<{ personaId: string | null; copyOf: string | null } | null> {
  const { xRecord } = await import("@/lib/zk/anon/queue");
  const r = await xRecord(xHash);
  return r ? { personaId: r.personaId, copyOf: r.copyOf } : null;
}

/** RIG ONLY (the route checks the dev hooks): an X copy's queued envelope, or null once it was sent and pruned */
export async function xEnvelopeForRig(xHash: string): Promise<unknown> {
  const { hydrate, state } = await import("@/lib/adapters/mock/store");
  await hydrate();
  for (const q of state().zkQueue.values()) {
    if (q.claimKind !== "x-anon-post" || !q.envelope) continue;
    if ((q.envelope as { publicInputs?: { xHash?: unknown } }).publicInputs?.xHash === xHash) return { status: q.status, outcome: q.outcome, envelope: q.envelope };
  }
  return null;
}

/** POST {action:"moderate", id, decision} — sign on this device, send to the validator, answer what it said */
export async function moderateFromThisDevice(id: unknown, decision: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  if (typeof id !== "string" || !/^[0-9a-f]{64}$/.test(id)) return { status: 400, json: { error: "id must be the post's 64-hex id", testData: true } };
  if (decision !== "approve" && decision !== "reject") return { status: 400, json: { error: "decision must be approve or reject", testData: true } };
  const { zkMode } = await import("@/lib/zk/config");
  if (zkMode() !== "fixture") return { status: 503, json: { error: "Posting to @totem on X runs on test data only.", testData: true } };
  const { signModeration } = await import("./moderation");
  const { postXModeration } = await import("@/lib/zk/validatorClient");
  const signed = await signModeration("fixture", id, decision);
  const r = await postXModeration(signed);
  return { status: r.status, json: { ...(r.json ?? {}), testData: true } };
}

/** POST {action:"review"} — this device's signed read of the texts waiting for a decision */
export async function reviewFromThisDevice(): Promise<{ status: number; json: Record<string, unknown> }> {
  const { zkMode } = await import("@/lib/zk/config");
  if (zkMode() !== "fixture") return { status: 503, json: { error: "Posting to @totem on X runs on test data only.", testData: true } };
  const { signReview } = await import("./moderation");
  const { fetchXReview } = await import("@/lib/zk/validatorClient");
  const r = await fetchXReview(await signReview("fixture"));
  return { status: r.status, json: { ...(r.json ?? {}), testData: true } };
}
