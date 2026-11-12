import "server-only";
// PERSONA LAUNCH P6 — THE CONFIRM: the one deliberate, permanent step of a launch.
//
// WHAT HAPPENS AT THE CLICK, AND WHAT DOES NOT. The owner has read the preview (lib/launch/preview.ts) and the no-undo
// sentence (on screen BEFORE the box they type into), and typed @handle exactly. Then, in this process's memory only:
//   1. the launch request is built and signed by the persona's own derived custody key (lib/launch/request.ts);
//   2. its commitment is handed to the proof layer's wanted set (lib/zk/gate.ts requestLaunchProof) — no request, no
//      proof leaves here: the next prefetch tick proves "one launch per person per window" over the anonymous channel
//      and the drain sends it at a jittered time;
//   3. a PENDING LAUNCH record is minted in the sealed zkQueue (lib/zk/anon/queue.ts putLaunchRecord) and persisted
//      ONLY on the queue's own deferred schedule, like an anon post's reveal secret. A write at confirm time — a
//      namespace of its own, a device-signed PUT — would be the click beacon the registrar's random 2–48 h timing exists
//      to hide.
// NOTHING is written at the click and nothing is fetched (the window comes from the last tick's snapshot).
//
// REFUSED, in plain words, before any of that: on a public deployment (anonymous proving in the browser is P7); on the
// LIVE universe (the Totem registrar is the owner's O1); without the proof layer; for a persona that is not this
// device's own, already has an account, or already has a launch; for a typed name that is not exactly @handle; for
// a second launch in the same anon window (the proof's scope is one launch per person per window — the device says so
// first); without a preview opened in the last 30 minutes in this process; and — fix LP-4 — without the explicit
// acknowledgement when that preview could not count the crowd the posts narrow the persona to, or counted it under the
// floor. A launch that failed before registration, or stalled past the registrar's promise with no account, may be
// launched again (fix UX-L5). Every screen says the registrar is SIMULATED and nothing is created on Farcaster.
import { isPublicDeployment } from "@/lib/platform/env-contract";
import { isPublicLive } from "@/lib/platform/publicLive";
import type { PendingLaunch } from "@/lib/zk/anon/queue";
import type { LaunchRequestInput } from "./request";

// the launch screens' fixed sentences live with the request (a module with no heavy imports, so the preview can share
// them without pulling in the proof layer)
import { LAUNCH_TIMING_SENTENCE, SIMULATED_NOTICE } from "./request";
export { LAUNCH_PRICE_SENTENCE, LAUNCH_TIMING_SENTENCE, SIMULATED_NOTICE, noUndoSentence } from "./request";

/** the deployment-wide refusal, or null when a launch can be made here */
export async function launchDeploymentRefusal(): Promise<{ status: number; code: string; reason: string } | null> {
  if (typeof window !== "undefined" || isPublicDeployment()) return { status: 409, code: "public_preview", reason: isPublicLive() ? "Launch isn't on this site yet." : "Launch isn't on this preview yet." }; // PUBLIC GO-LIVE (F11): the live site is no preview
  const { zkMode } = await import("@/lib/zk/config");
  if (zkMode() === "live") return { status: 409, code: "registrar_not_set_up", reason: "Launch needs the Totem registrar, which isn't set up yet." };
  const { currentRepImpl } = await import("@/lib/adapters/registry");
  if (currentRepImpl() !== "zk") return { status: 503, code: "unavailable", reason: "Launch needs the proof layer, which is off on this server." };
  return null;
}

/** the stages a launch is UNDER WAY in (confirmed, its batch reveal not landed yet) */
const UNDER_WAY = new Set(["proving", "queued", "submitted", "waiting", "registered"]);

/** this persona's launch record (any stage), or null — device-local, the sealed queue in memory */
export async function launchFor(personaId: string): Promise<PendingLaunch | null> {
  const { launchRecords } = await import("@/lib/zk/anon/queue");
  const all = (await launchRecords()).filter((r) => r.personaId === personaId);
  // a failed launch may be followed by a new one: the newest wins
  all.sort((a, b) => b.confirmedAt - a.confirmedAt);
  return all[0] ?? null;
}

/** is a launch of this persona under way (confirmed, not yet revealed, not failed)? */
export async function launchUnderWay(personaId: string): Promise<boolean> {
  const r = await launchFor(personaId);
  return !!r && UNDER_WAY.has(r.stage);
}

/**
 * PERSONA LAUNCH P6 (fixes UX-L5, W2-LAUNCH-NO-ADOPTION): may the owner launch this persona AGAIN over this record? Only
 * when nothing exists for it: the launch failed before registration, or it has waited past the registrar's promise with
 * no account (STALLED — still watched; the registrar takes a repeat for the same custody without a second row, so a
 * request it still holds just registers once).
 */
export function canLaunchAgain(r: PendingLaunch, now: number = Date.now()): boolean {
  if (r.fid !== null) return false;
  if (r.stage === "failed") return true;
  return r.stage === "waiting" && now - r.stageAt > WAITING_STALLED_MS_FOR_CONFIRM;
}
/** DELIBERATE DUPLICATE of lib/launch/tick.ts WAITING_STALLED_MS (not imported: this module stays light for the route) */
const WAITING_STALLED_MS_FOR_CONFIRM = 72 * 3_600_000;

export type ConfirmResult = { ok: true; launchCommit: string; fname: string } | { ok: false; status: number; code: string; reason: string };

/**
 * THE CONFIRM (see the header). `typed` must be exactly "@" + the persona's handle (case-insensitive). `quoteOriginals`
 * are the anon posts (their internal cast hashes, from the preview) the launch history may quote — each one of THIS
 * persona's own, at most 10.
 */
export async function confirmLaunch(personaId: string, typed: unknown, input: LaunchRequestInput & { quoteOriginals?: unknown; acknowledgeCrowd?: unknown }, now: number = Date.now()): Promise<ConfirmResult> {
  const no = (status: number, code: string, reason: string): ConfirmResult => ({ ok: false, status, code, reason });
  const dep = await launchDeploymentRefusal();
  if (dep) return no(dep.status, dep.code, dep.reason);
  const { isOwnPostingPersona, handleOfPersona } = await import("@/lib/identity/postMode");
  const { isKeystoreRootedPersona } = await import("@/lib/identity/keys");
  if (typeof personaId !== "string" || !isOwnPostingPersona(personaId)) return no(403, "not_own", "That isn't one of your personas.");
  const handle = handleOfPersona(personaId);
  if (!handle || !isKeystoreRootedPersona(personaId)) return no(403, "not_launchable", "Only a persona made on this device can be launched — a demo persona's keys are public, so anyone could take its account.");
  const want = "@" + handle;
  if (typeof typed !== "string" || typed.trim().toLowerCase() !== want.toLowerCase()) return no(400, "typed", `Type ${want} exactly to confirm.`);
  const existing = await launchFor(personaId);
  // fix UX-L5 / W2-LAUNCH-NO-ADOPTION: a launch that failed before registration, or STALLED past the registrar's promise
  // with no account, may be launched again; anything else is under way or done
  if (existing && !canLaunchAgain(existing, now)) return no(409, "already", existing.stage === "done" ? `@${handle} is already launched.` : `@${handle} is already being launched.`);
  const { zkMode, anonPostWindowOf } = await import("@/lib/zk/config");
  const mode = zkMode();
  // ONE LAUNCH PER PERSON PER WINDOW — the proof's scope; the device says so first, from the last tick's snapshot (no
  // fetch at the click). No snapshot yet: the window cannot be known, so nothing is confirmed (fail closed).
  const { cachedSnapshot } = await import("@/lib/zk/prefetch");
  const snap = cachedSnapshot(mode);
  if (!snap) return no(503, "no_clock", "Totem hasn't read the validator's clock yet. Try again in a minute.");
  const window = anonPostWindowOf(snap.epoch.epoch);
  const { launchRecords } = await import("@/lib/zk/anon/queue");
  if ((await launchRecords()).some((r) => r.mode === mode && r.window === window && r.stage !== "failed"))
    return no(409, "window", "You already launched a persona in this 6-hour window. Launch again in the next window.");
  // fix LP-4 — THE CROWD: the confirm stands on the PREVIEW's verdict (kept in this process's memory by
  // lib/launch/preview.ts; nothing is fetched at the click). No recent preview: open it first. A crowd the preview could
  // not count, or one under the floor, needs the explicit acknowledgement the preview showed.
  const { previewVerdictFor } = await import("./preview");
  const verdict = previewVerdictFor(personaId, mode, now);
  if (!verdict) return no(409, "preview", "Open the preview again first: the launch confirms what the preview just showed you.");
  if (verdict.needsAck && input.acknowledgeCrowd !== true) return no(400, "crowd", "Tick the box that says you understand how far your posts narrow who you are, then confirm.");
  // the history's quote choices: this persona's OWN anon posts only, at most 10, no repeats
  const { attributionCastHashesFor } = await import("@/lib/zk/anonAttribution");
  const own = new Set(await attributionCastHashesFor(personaId));
  const picks = Array.isArray(input.quoteOriginals) ? input.quoteOriginals.filter((x): x is string => typeof x === "string") : [];
  if (picks.length > 10) return no(400, "quotes", "Pick at most 10 posts to quote.");
  if (new Set(picks).size !== picks.length || picks.some((h) => !own.has(h))) return no(400, "quotes", `You can only quote anonymous posts @${handle} made.`);
  const { buildLaunchRequest } = await import("./request");
  const built = await buildLaunchRequest(personaId, input, mode, now);
  if (!built.ok) return no(400, "request", built.reason);
  // in memory only: the proof is made at the next tick, from that tick's snapshot
  const gate = (await import("@/lib/zk/gate")) as unknown as { requestLaunchProof?: (c: string, r: string, at?: number) => { ok: boolean; reason?: string } };
  if (typeof gate.requestLaunchProof !== "function") return no(503, "unavailable", "Launch isn't available in this build (the launch proof is missing).");
  const asked = gate.requestLaunchProof(built.launchCommit, built.request, now);
  if (!asked.ok) return no(503, "unavailable", "Couldn't start the launch (" + (asked.reason ?? "refused") + "). Nothing was sent.");
  const { putLaunchRecord, updateLaunchRecord } = await import("@/lib/zk/anon/queue");
  // a STALLED launch this one replaces stops being walked (the new record watches for the same custody address); in
  // memory, on the queue's deferred write like everything else at the click
  if (existing && existing.stage !== "failed") await updateLaunchRecord(existing.launchCommit, { stage: "failed", reason: "Replaced by a newer launch of this persona." }, "replaced by a newer launch");
  const rec: PendingLaunch = {
    mode,
    personaId,
    launchCommit: built.launchCommit,
    request: built.request,
    custody: built.custody,
    recovery: built.recovery,
    signerKey: built.signerKey,
    fname: built.fname,
    profile: built.profile,
    quoteOriginals: picks,
    window,
    confirmedAt: now,
    stage: "proving",
    stageAt: now,
    nextAt: 0,
    fid: null,
    registeredHour: null,
    batchHash: null,
    revealed: 0,
    history: { launchCastHash: null, quoted: [] },
    attempts: 0,
    reason: null,
    log: [{ at: now, stage: "proving", note: "confirmed — the launch request waits for the next tick's proof; nothing was sent at the click" }],
  };
  await putLaunchRecord(rec);
  return { ok: true, launchCommit: built.launchCommit, fname: built.fname };
}

/**
 * The proof layer's outcome log (lib/zk/gate.ts calls this; never awaited there, so it never throws): "queued" → the
 * request is in the jittered queue; "retrying" / "deferred" / "once" → still proving (with why); "dropped" → failed.
 */
export function noteLaunchOutcome(launchCommit: string, o: { stage: string; reason: string | null; queuedId?: string }): void {
  void (async () => {
    const { updateLaunchRecord, launchRecord } = await import("@/lib/zk/anon/queue");
    const rec = await launchRecord(launchCommit);
    if (!rec || !(rec.stage === "proving" || rec.stage === "queued")) return;
    if (o.stage === "queued") await updateLaunchRecord(launchCommit, { stage: "queued", reason: null }, "proved — queued for the anonymous channel at a random time");
    else if (o.stage === "dropped") await updateLaunchRecord(launchCommit, { stage: "failed", reason: "The launch request couldn't be proved: " + (o.reason ?? "refused") + ". Nothing was revealed; you can launch again." }, "dropped: " + (o.reason ?? ""));
    else await updateLaunchRecord(launchCommit, { reason: o.reason }, o.stage + ": " + (o.reason ?? ""));
  })().catch(() => undefined);
}

export interface LaunchStatusView {
  personaId: string;
  stage: PendingLaunch["stage"];
  /** plain words for the stage */
  words: string;
  fid: number | null;
  fname: string;
  revealed: number;
  reason: string | null;
  log: PendingLaunch["log"];
  /** fix UX-L6: a step after registration has not gone through and is being retried (the "Try again" button) */
  retrying: boolean;
  /** fix UX-L5: nothing exists for this launch and the owner may launch again from the preview */
  canLaunchAgain: boolean;
  /** fix W2-LAUNCH-REVEAL-200: what the reveal left out (posts never relayed, posts refused), or null */
  leftOut: { notRelayed: number; refused: number } | null;
  simulated: true;
  notice: string;
}

const STAGE_WORDS: Record<PendingLaunch["stage"], string> = {
  proving: "Preparing the anonymous launch request. Nothing has left this device yet.",
  queued: "The launch request is waiting to be sent anonymously at a random time.",
  submitted: "The launch request was sent anonymously.",
  waiting: "The registrar has the request. " + LAUNCH_TIMING_SENTENCE,
  registered: "The account exists. Revealing your anonymous posts next.",
  revealed: "Your anonymous posts are revealed. Setting the name and profile next.",
  profiled: "Name and profile set. Posting the launch history next.",
  history: "Posting the launch history.",
  done: "Launched. Choose where this persona's posts go next.",
  failed: "The launch didn't finish. Nothing was revealed.",
};

/** fix UX-L6: a step after registration that has not gone through says what EXISTS, not "the launch didn't finish" */
const RETRY_WORDS: Partial<Record<PendingLaunch["stage"], string>> = {
  registered: "Your account exists, but revealing your anonymous posts hasn't gone through yet. Totem keeps trying.",
  revealed: "Your account exists and your posts are revealed, but setting its name and profile hasn't gone through yet. Totem keeps trying.",
  profiled: "Your account exists and your posts are revealed, but posting the launch history hasn't gone through yet. Totem keeps trying.",
  history: "Your account exists and your posts are revealed, but posting the launch history hasn't gone through yet. Totem keeps trying.",
};

export async function launchStatusFor(personaId: string, now: number = Date.now()): Promise<LaunchStatusView | null> {
  const r = await launchFor(personaId);
  if (!r) return null;
  const retrying = r.fid !== null && r.attempts > 0 && !!RETRY_WORDS[r.stage];
  const again = canLaunchAgain(r, now);
  const words = retrying
    ? RETRY_WORDS[r.stage]!
    : r.stage === "waiting" && again
      ? "The registrar hasn't created the account within the 48 hours it promised. Totem keeps watching for it. Nothing was revealed."
      : STAGE_WORDS[r.stage];
  return { personaId, stage: r.stage, words, fid: r.fid, fname: r.fnameSet ?? r.fname, revealed: r.revealed, reason: r.reason, log: r.log, retrying, canLaunchAgain: again, leftOut: r.leftOut ?? null, simulated: true, notice: SIMULATED_NOTICE };
}

/**
 * fix UX-L6 — "TRY AGAIN": bring the next attempt of a step AFTER registration forward to the next tick (the tick still
 * runs it on its own schedule — nothing is sent from here). Refused for anything else, in plain words.
 */
export async function retryLaunchNow(personaId: string): Promise<{ ok: true } | { ok: false; status: number; reason: string }> {
  const r = await launchFor(personaId);
  if (!r) return { ok: false, status: 404, reason: "No launch for this persona." };
  if (r.fid === null || !RETRY_WORDS[r.stage]) return { ok: false, status: 409, reason: "There is nothing to try again: the launch isn't waiting on a step that failed." };
  const { updateLaunchRecord } = await import("@/lib/zk/anon/queue");
  await updateLaunchRecord(r.launchCommit, { nextAt: 0 }, "the owner asked to try again");
  return { ok: true };
}

/** resetSeed and reloadIdentity: the launch modules' in-process caches (the records themselves live in the sealed queue,
 *  which those paths reset and re-hydrate) — the tick's reads (registrations, the own-rows anon mirror) and the
 *  preview's in-memory verdicts */
export function resetLaunchCaches(): void {
  const g = globalThis as unknown as {
    __layersLaunchTick?: unknown;
    __layersLaunchRegistrations?: unknown;
    __layersLaunchRegFullRead?: unknown;
    __layersLaunchAnonMirror?: unknown;
    __layersLaunchPreviewVerdicts?: unknown;
  };
  g.__layersLaunchTick = undefined;
  g.__layersLaunchRegistrations = undefined;
  g.__layersLaunchRegFullRead = undefined;
  g.__layersLaunchAnonMirror = undefined;
  g.__layersLaunchPreviewVerdicts = undefined;
}
