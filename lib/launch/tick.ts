import "server-only";
// PERSONA LAUNCH P6 — THE LAUNCH TICK: what walks a confirmed launch to the end, on the prefetch loop's fixed schedule.
//
// THE UNIFORM READS. On EVERY tick, on EVERY device — with a launch pending or not — the device makes the same two
// public reads with the same parameters and no device headers, over an isolated socket:
//   1. the registrar's registrations list (GET /registrar/registrations: each registered account's custody, recovery,
//      fid, hour and active signer keys, newest first). A device never asks "is MY custody address registered?" or
//      "which keys does MY new fid have?": it reads everyone's and checks its own locally (fix LP-1: the per-fid chain
//      reads it used to make at the moment it noticed its registration were the first reads anyone made about that fid —
//      a beacon naming the new account). The first read of a process covers every hour (sinceHour=0, every device alike
//      on boot); later ones the last 7 days.
//   2. the COMPLETE public anon list (GET /registrar/anon-casts, paged: the whole list on a process's first tick, then
//      everything relayed since two hours before the last complete read). Of it the device keeps ONLY its own rows (the
//      ones it holds a sealed reveal secret for): THE OWN-ROWS MIRROR (fix W2-LAUNCH-REVEAL-200). The newest-200 feed
//      list it used to rely on dropped a persona's older posts out of the one-time batch reveal (D7), the preview, the
//      history and the proof; the preview now reads the mirror and fetches NOTHING.
// (lib/zk/prefetch.ts runs this after the wanted proofs; the live universe has no registrar — O1 — and reads nothing.)
//
// THE STEPS, each at a JITTERED later moment (uniform in the queue's 30 s – 15 min window, after the previous step), so
// no two of them line up with each other or with the registration:
//   proving → queued     the proof layer (lib/zk/gate.ts → noteLaunchOutcome); a launch the wanted set lost (a restart)
//                        is asked for again from its sealed record
//   queued → waiting     the jittered drain sent the request over the anonymous channel and the validator accepted it
//   waiting → registered its custody address appears in the registrations list WITH exactly this persona's derived key
//                        and recovery address on it (checked locally, from the list). NOTHING is written but the sealed
//                        launch record, on the queue's deferred schedule: that record IS the launched account's record
//                        (lib/fc/personaFid.ts reads it — fix LP-1; no immediate personaFids PUT at a launch step).
//                        Past the 48 hours promised it keeps WATCHING (never "failed": the registrar may be late), and
//                        the owner may launch again (lib/launch/confirm.ts) — the registrar takes a repeat for the same
//                        custody without a second row.
//   registered → revealed  THE BATCH REVEAL (lib/launch/reveal.ts): every anon post the persona made that the mirror
//                        shows relayed, at once, signed by the registered key — after waiting (up to a day) for any still
//                        on the way, so the batch holds them all (D7). A post that was refused is never posted and never
//                        revealed; what was left out, and why, is kept and shown (never silently).
//   revealed → profiled  the fname (a custody-signed proof, to the simulated name server) and the profile (UserDataAdd,
//                        signed by the account's key) through the thin relay — signed NOW, never at the click
//   profiled → done      the launch history (lib/launch/history.ts): one launch cast, then the chosen quote-casts
// After "done" the persona's post mode is a REQUIRED choice (preset anon: lib/identity/postMode.ts choiceRequired).
//
// FAILURE (fix UX-L6). Before registration a step that keeps failing ends the launch ("failed": nothing exists, nothing
// was revealed — the owner can launch again). FROM registration on nothing is ever terminal: the account exists, so a
// failing step is retried with a growing, jittered back-off (capped at 6 hours) and the status says what exists and what
// has not gone through; "Try again" (lib/launch/confirm.ts retryLaunchNow) brings the next attempt forward.
// ADOPTION (fix W2-LAUNCH-NO-ADOPTION): on every uniform read, an own public persona with no record walking toward an
// account whose derived custody, key and recovery ARE on a registered account gets its record rebuilt at "registered"
// (a record lost in a restart, or one given up on), and the launch continues to the reveal.
import { createHash } from "@/lib/platform/crypto";
import type { PendingLaunch } from "@/lib/zk/anon/queue";

const HOUR = 3_600_000;
const MAX_STEP_ATTEMPTS = 20;
const REVEAL_WAIT_MS = 24 * HOUR;
/** a launch still unregistered this long after the registrar accepted it is STALLED (the promise is 48 hours) — it
 *  keeps being watched, and the owner may launch again */
export const WAITING_STALLED_MS = 72 * HOUR;
/** the longest back-off between retries of a step after registration */
const RETRY_MAX_MS = 6 * HOUR;
const POST_REGISTRATION = new Set<PendingLaunch["stage"]>(["registered", "revealed", "profiled", "history"]);
export const STALLED_REASON =
  "The registrar hasn't created the account within the 48 hours it promised. Nothing was revealed. Totem keeps watching for the account; if the registrar dropped the request, you can launch again.";

export interface Registration {
  custody: string;
  recovery: string;
  fid: number;
  hour: number;
  /** the account's ACTIVE signer keys (64 lowercase hex) */
  keys: string[];
}

/** one of THIS device's own relayed anon posts, as the complete public list shows it */
export interface MirrorRow {
  /** the network hash the @anon cast went out under */
  hash: string;
  castHash: string;
  text: string;
  /** when it was relayed (hour-grained) */
  at: number;
  epoch: number | null;
  tree: string | null;
  treeSize: number | null;
}
export interface AnonMirror {
  /** true once a read of the WHOLE list has finished in this process */
  complete: boolean;
  /** when the last complete read STARTED (the next read covers everything relayed since two hours before it) */
  readAt: number;
  /** castHash → row: only this device's own posts */
  rows: Map<string, MirrorRow>;
  /** network hash → castHash */
  byNetwork: Map<string, string>;
}

export interface LaunchTickReport {
  at: number;
  mode: "fixture" | "live";
  read: "ok" | "error" | "skipped";
  readError?: string;
  registrations: number;
  /** the complete anon-list read (the own-rows mirror) */
  anonList: "ok" | "error" | "skipped";
  anonListError?: string;
  adopted: number;
  progressed: Array<{ launchCommit: string; from: string; to: string; note: string }>;
  retried: Array<{ launchCommit: string; stage: string; attempts: number; reason: string }>;
}

const g = globalThis as unknown as {
  __layersLaunchTick?: Promise<unknown>;
  __layersLaunchRegistrations?: { at: number; count: number };
  __layersLaunchRegFullRead?: boolean;
  __layersLaunchAnonMirror?: Partial<Record<"fixture" | "live", AnonMirror>>;
};

/** ONE tick (serialized: a scheduled tick and a forced one never run at once). `now` lets a rig run the jittered steps
 *  without waiting for them (dev hooks only — app/api/launch/route.ts). */
export function launchTick(mode: "fixture" | "live", opts: { now?: number } = {}): Promise<LaunchTickReport> {
  const prev = g.__layersLaunchTick ?? Promise.resolve();
  const run = prev.catch(() => undefined).then(() => tickOnce(mode, opts.now ?? Date.now()));
  g.__layersLaunchTick = run.catch(() => undefined);
  return run;
}

async function getJsonIsolated(url: string): Promise<unknown> {
  const { isolatedRequest } = await import("@/lib/zk/anon/client");
  const r = await isolatedRequest(url, { method: "GET" });
  if (r.status !== 200) throw new Error("the registrar answered " + r.status);
  return JSON.parse(new TextDecoder().decode(r.body)) as unknown;
}

const HEX64 = /^[0-9a-f]{64}$/;
const ADDR = /^0x[0-9a-f]{40}$/;

/** THE UNIFORM REGISTRATIONS READ — every device, every tick, the same request (the first of a process covers every
 *  hour; later ones the last 7 days, fixed relative to the hour) */
export async function readRegistrations(): Promise<Registration[]> {
  const { VALIDATOR_URL } = await import("@/lib/zk/config");
  const full = g.__layersLaunchRegFullRead !== true;
  const sinceHour = full ? 0 : Math.max(0, Math.floor(Date.now() / HOUR) - 24 * 7);
  const j = (await getJsonIsolated(`${VALIDATOR_URL}/registrar/registrations?mode=fixture&sinceHour=${sinceHour}`)) as { registrations?: unknown };
  if (!Array.isArray(j.registrations)) throw new Error("the registrations list is malformed");
  const out: Registration[] = [];
  for (const x of j.registrations as Array<{ custody?: unknown; recovery?: unknown; fid?: unknown; hour?: unknown; keys?: unknown }>) {
    const custody = String(x.custody ?? "").toLowerCase();
    const recovery = String(x.recovery ?? "").toLowerCase();
    const fid = Number(x.fid);
    if (!ADDR.test(custody) || !Number.isInteger(fid) || fid <= 0) continue;
    const keys = Array.isArray(x.keys) ? x.keys.map((k) => String(k).toLowerCase()).filter((k) => HEX64.test(k)) : [];
    out.push({ custody, recovery: ADDR.test(recovery) ? recovery : "", fid, hour: Number(x.hour), keys });
  }
  g.__layersLaunchRegFullRead = true;
  g.__layersLaunchRegistrations = { at: Date.now(), count: out.length };
  return out;
}

/** this device's own-rows mirror of the complete anon list for a universe, or null before the first complete read */
export function anonMirror(mode: "fixture" | "live"): AnonMirror | null {
  return g.__layersLaunchAnonMirror?.[mode] ?? null;
}

/**
 * THE UNIFORM ANON-LIST READ (fix W2-LAUNCH-REVEAL-200): page through the COMPLETE public list (the whole of it on a
 * process's first tick; afterwards everything relayed since two hours before the last complete read — every device
 * reads the same pages) and keep only this device's own rows. A failed read leaves the previous mirror as it was (the
 * next tick reads again); a mirror that never completed is reported as such to every reader, which then refuses.
 */
export async function refreshAnonMirror(mode: "fixture"): Promise<{ pages: number; own: number }> {
  const { VALIDATOR_URL } = await import("@/lib/zk/config");
  const { attributionCastHashes } = await import("@/lib/zk/anon/queue");
  const cur = anonMirror(mode);
  const sinceHour = cur?.complete ? Math.max(0, Math.floor(cur.readAt / HOUR) - 2) : 0;
  const mine = new Set(await attributionCastHashes());
  const rows = new Map(cur?.complete ? cur.rows : []);
  const startedAt = Date.now();
  let before: string | null = null;
  let pages = 0;
  do {
    const j = (await getJsonIsolated(`${VALIDATOR_URL}/registrar/anon-casts?mode=${mode}&sinceHour=${sinceHour}${before ? "&before=" + encodeURIComponent(before) : ""}`)) as { casts?: unknown; next?: unknown };
    if (!Array.isArray(j.casts)) throw new Error("the anon list is malformed");
    for (const c of j.casts as Array<Record<string, unknown>>) {
      const castHash = String(c.castHash ?? "");
      if (!mine.has(castHash)) continue;
      rows.set(castHash, {
        hash: String(c.hash ?? ""),
        castHash,
        text: String(c.text ?? ""),
        at: Number(c.at),
        epoch: typeof c.epoch === "number" ? c.epoch : null,
        tree: typeof c.tree === "string" ? c.tree : null,
        treeSize: typeof c.treeSize === "number" ? c.treeSize : null,
      });
    }
    before = typeof j.next === "string" && j.next ? j.next : null;
    if (++pages > 100_000) throw new Error("the anon list did not end");
  } while (before);
  // a post whose sealed record is gone (a reset) is no longer this device's to show
  for (const h of [...rows.keys()]) if (!mine.has(h)) rows.delete(h);
  const byNetwork = new Map<string, string>();
  for (const r of rows.values()) if (r.hash) byNetwork.set(r.hash, r.castHash);
  (g.__layersLaunchAnonMirror ??= {})[mode] = { complete: true, readAt: startedAt, rows, byNetwork };
  return { pages, own: rows.size };
}

/** resetSeed / reloadIdentity / the rig's launch reset: forget the reads (the next tick reads everything again) */
export function resetLaunchReads(): void {
  g.__layersLaunchRegistrations = undefined;
  g.__layersLaunchRegFullRead = undefined;
  g.__layersLaunchAnonMirror = undefined;
}

/** the next step's moment: the REAL clock plus a CSPRNG jitter (the tick's `now` only decides what is due — a rig that
 *  moves it forward runs every due step without waiting, and never pushes the next step past its own reach) */
async function jitterFrom(_now: number): Promise<number> {
  void _now;
  const { uniformInt } = await import("@/lib/zk/anon/queue");
  const { ZK_JITTER_MIN_MS, ZK_JITTER_MAX_MS } = await import("@/lib/zk/config");
  return Date.now() + uniformInt(ZK_JITTER_MIN_MS, ZK_JITTER_MAX_MS);
}

async function tickOnce(mode: "fixture" | "live", now: number): Promise<LaunchTickReport> {
  const report: LaunchTickReport = { at: Date.now(), mode, read: "skipped", registrations: 0, anonList: "skipped", adopted: 0, progressed: [], retried: [] };
  // the BROWSER device (the public preview) has no launch this wave — anonymous proving in the browser is P7 — so every
  // browser device skips the reads alike (still uniform), and has no records to walk
  if (typeof window !== "undefined") return report;
  let regs: Registration[] | null = null;
  if (mode === "fixture") {
    try {
      regs = await readRegistrations();
      report.read = "ok";
      report.registrations = regs.length;
    } catch (e) {
      report.read = "error";
      report.readError = (e as Error).message;
    }
    try {
      await refreshAnonMirror(mode);
      report.anonList = "ok";
    } catch (e) {
      report.anonList = "error";
      report.anonListError = (e as Error).message;
    }
  }
  if (regs && regs.length) {
    try {
      report.adopted = await adoptOrphans(regs, mode, now, report);
    } catch {
      /* the next tick tries again; nothing was written */
    }
  }
  // a record this tick just moved (adopted) takes its next step at a later tick, like every other step
  const movedNow = new Set(report.progressed.map((p) => p.launchCommit));
  const { launchRecords } = await import("@/lib/zk/anon/queue");
  for (const rec of await launchRecords()) {
    if (rec.mode !== mode || rec.stage === "done" || movedNow.has(rec.launchCommit)) continue;
    if (rec.stage === "failed") {
      // a record an older build ended AFTER registration: the account exists, so it is resumed (fix UX-L6)
      if (rec.fid !== null) await resumeAfterRegistration(rec, now, report);
      continue;
    }
    try {
      await step(rec, regs, now, report);
    } catch (e) {
      await stepFailed(rec, (e as Error).message, report);
    }
  }
  return report;
}

async function moveTo(rec: PendingLaunch, to: PendingLaunch["stage"], patch: Partial<PendingLaunch>, note: string, report: LaunchTickReport): Promise<void> {
  const { updateLaunchRecord } = await import("@/lib/zk/anon/queue");
  await updateLaunchRecord(rec.launchCommit, { ...patch, stage: to, attempts: 0, reason: null }, note);
  report.progressed.push({ launchCommit: rec.launchCommit, from: rec.stage, to, note });
}

/** the words for a step that has not gone through AFTER registration: what exists, what has not happened yet */
function postRegistrationReason(stage: PendingLaunch["stage"], why: string): string {
  const what =
    stage === "registered"
      ? "Your account exists, but revealing your anonymous posts hasn't gone through yet"
      : stage === "revealed"
        ? "Your account exists and your posts are revealed, but setting its name and profile hasn't gone through yet"
        : "Your account exists and your posts are revealed, but posting the launch history hasn't gone through yet";
  return `${what} (${why}). Totem keeps trying.`;
}

async function stepFailed(rec: PendingLaunch, reason: string, report: LaunchTickReport): Promise<void> {
  const { updateLaunchRecord } = await import("@/lib/zk/anon/queue");
  const attempts = rec.attempts + 1;
  if (POST_REGISTRATION.has(rec.stage) || rec.fid !== null) {
    // fix UX-L6: the account EXISTS — never terminal. A growing back-off (1 min, 2, 4 … capped at 6 h) after the jitter.
    const backoff = Math.min(RETRY_MAX_MS, 60_000 * 2 ** Math.min(attempts - 1, 12));
    const words = postRegistrationReason(rec.stage, reason);
    await updateLaunchRecord(rec.launchCommit, { attempts, reason: words, nextAt: (await jitterFrom(Date.now())) + backoff }, `${rec.stage} retry ${attempts}: ${reason}`);
    report.retried.push({ launchCommit: rec.launchCommit, stage: rec.stage, attempts, reason });
    return;
  }
  if (attempts >= MAX_STEP_ATTEMPTS) {
    await updateLaunchRecord(rec.launchCommit, { stage: "failed", attempts, reason: "The launch stopped: " + reason + ". Nothing was revealed; you can launch again." }, "gave up: " + reason);
    report.progressed.push({ launchCommit: rec.launchCommit, from: rec.stage, to: "failed", note: reason });
  } else {
    await updateLaunchRecord(rec.launchCommit, { attempts, reason }, rec.stage + " retry: " + reason);
    report.retried.push({ launchCommit: rec.launchCommit, stage: rec.stage, attempts, reason });
  }
}

/** a "failed" record that holds a fid (an older build gave up after registration): back to the step it stopped at */
async function resumeAfterRegistration(rec: PendingLaunch, now: number, report: LaunchTickReport): Promise<void> {
  const to: PendingLaunch["stage"] = !rec.batchHash && rec.revealed === 0 ? "registered" : rec.history.launchCastHash ? "history" : "revealed";
  await moveTo(rec, to, { nextAt: await jitterFrom(now) }, "the account exists — resuming the launch where it stopped", report);
}

/** the queued launch SUBMISSION for this record (the proof layer's envelope carries the commitment) */
async function submissionFor(launchCommit: string): Promise<{ status: string; outcome: string | null } | null> {
  const { hydrate, state } = await import("@/lib/adapters/mock/store");
  await hydrate();
  for (const q of state().zkQueue.values()) {
    if (q.claimKind !== "persona-launch" || !q.envelope) continue;
    const c = (q.envelope as { publicInputs?: { launchCommit?: unknown } }).publicInputs?.launchCommit;
    if (c === launchCommit) return { status: q.status, outcome: q.outcome };
  }
  return null;
}

/** the commitment an ADOPTED record is keyed by (its real request is unknown) — one per custody address */
function adoptedCommit(custody: string): string {
  return createHash("sha256").update("layers-launch-adopted/1|" + custody, "utf8").digest("hex");
}

/**
 * ADOPTION (fix W2-LAUNCH-NO-ADOPTION): an own public persona whose derived custody, key AND recovery are on a registered
 * account, with no record walking toward it (none at all — lost in a restart — or only failed ones), gets its record
 * (re)built at "registered". Local: the registrations list was read anyway; nothing is fetched or written but the sealed
 * record (deferred). Returns how many were adopted.
 */
async function adoptOrphans(regs: Registration[], mode: "fixture" | "live", now: number, report: LaunchTickReport): Promise<number> {
  const byCustody = new Map(regs.map((r) => [r.custody, r]));
  const { listPersonas } = await import("@/lib/identity/keystore");
  const { isKeystoreRootedPersona, fcCustodyAddressFor, fcRecoveryAddressFor, fcSignerPublicKeyFor } = await import("@/lib/identity/keys");
  const { kindOf } = await import("@/lib/identity/personaKind");
  const { launchRecords, putLaunchRecord } = await import("@/lib/zk/anon/queue");
  const records = (await launchRecords()).filter((r) => r.mode === mode);
  let adopted = 0;
  for (const p of listPersonas()) {
    if (p.publicSelf === true || !isKeystoreRootedPersona(p.id) || kindOf(p.id) !== "public") continue;
    const custody = fcCustodyAddressFor(p.id)?.toLowerCase();
    const hit = custody ? byCustody.get(custody) : undefined;
    if (!custody || !hit) continue;
    const mine = records.filter((r) => r.personaId === p.id).sort((a, b) => b.confirmedAt - a.confirmedAt);
    // a record that holds the account already, or is walking toward it (the waiting step matches it itself)
    if (mine.some((r) => r.fid !== null || r.stage !== "failed")) continue;
    // an account this persona has another way (a vault record) is not a launch to adopt
    const { personaFidRecord } = await import("@/lib/fc/personaFid");
    if (await personaFidRecord(p.id)) continue;
    const signerKey = fcSignerPublicKeyFor(p.id);
    const recovery = fcRecoveryAddressFor(p.id)?.toLowerCase();
    // exactly this persona's key and recovery on the account — or it is not this persona's launch, and never adopted
    if (!signerKey || !recovery || !hit.keys.includes(signerKey) || hit.recovery !== recovery) continue;
    const note = "found this persona's account in the registrar's list (this device had lost track of the launch) — continuing to the reveal";
    const prior = mine[0];
    if (prior) {
      await moveTo(prior, "registered", { fid: hit.fid, registeredHour: hit.hour, nextAt: await jitterFrom(now) }, note, report);
    } else {
      const { proposedAccount } = await import("./request");
      const { mainNameDerivation } = await import("@/lib/fc/personaFid");
      const proposed = await proposedAccount(p.id);
      // the name step must never set a name sharing a stem with main (buildLaunchRequest checks it for a confirmed launch)
      const fname = (await mainNameDerivation(proposed.fname)) ? "" : proposed.fname;
      const commit = adoptedCommit(custody);
      await putLaunchRecord({
        mode,
        personaId: p.id,
        launchCommit: commit,
        request: "",
        custody,
        recovery,
        signerKey,
        fname,
        profile: proposed.profile,
        quoteOriginals: [],
        window: null,
        confirmedAt: hit.hour * HOUR,
        stage: "registered",
        stageAt: Date.now(),
        nextAt: await jitterFrom(now),
        fid: hit.fid,
        registeredHour: hit.hour,
        batchHash: null,
        revealed: 0,
        history: { launchCastHash: null, quoted: [] },
        attempts: 0,
        reason: null,
        adopted: true,
        log: [{ at: Date.now(), stage: "registered", note }],
      });
      report.progressed.push({ launchCommit: commit, from: "none", to: "registered", note });
    }
    adopted++;
  }
  return adopted;
}

async function step(rec: PendingLaunch, regs: Registration[] | null, now: number, report: LaunchTickReport): Promise<void> {
  const mode = rec.mode;
  if (rec.stage === "proving" || rec.stage === "queued" || rec.stage === "submitted") {
    const sub = await submissionFor(rec.launchCommit);
    if (!sub) {
      // nothing queued: still wanted, or the wanted set was lost (a restart) — ask again from the sealed record
      const gate = (await import("@/lib/zk/gate")) as unknown as { wantedLaunchRequests?: () => string[]; requestLaunchProof?: (c: string, r: string, at?: number) => { ok: boolean; reason?: string } };
      const wanted = typeof gate.wantedLaunchRequests === "function" ? gate.wantedLaunchRequests() : [];
      if (!wanted.includes(rec.launchCommit) && typeof gate.requestLaunchProof === "function") {
        const asked = gate.requestLaunchProof(rec.launchCommit, rec.request, rec.confirmedAt);
        if (!asked.ok) throw new Error(asked.reason ?? "the launch proof could not be asked for again");
      }
      return;
    }
    if (sub.status === "queued") {
      if (rec.stage === "proving") await moveTo(rec, "queued", {}, "proved — waiting for its random moment on the anonymous channel", report);
      return;
    }
    if (sub.status === "sent" && (sub.outcome === "accepted" || sub.outcome === "replay")) {
      await moveTo(rec, "waiting", {}, "sent anonymously and accepted — the registrar's batch registers it 2 to 48 hours after the click", report);
      return;
    }
    const { updateLaunchRecord } = await import("@/lib/zk/anon/queue");
    const reason = sub.status === "refused" ? "The launch request couldn't reach the anonymous channel. Nothing was revealed; you can launch again." : "The registrar refused the launch request (the anonymous channel doesn't say why). Nothing was revealed; you can launch again.";
    await updateLaunchRecord(rec.launchCommit, { stage: "failed", reason }, "submission " + sub.status + "/" + sub.outcome);
    report.progressed.push({ launchCommit: rec.launchCommit, from: rec.stage, to: "failed", note: reason });
    return;
  }
  if (rec.stage === "waiting") {
    if (!regs) return; // the uniform read failed this tick: nothing to learn
    const hit = regs.find((r) => r.custody === rec.custody);
    if (!hit) {
      // the promise is 2 to 48 hours: well past it (the REAL clock — a rig's moved `now` never trips this), say so and
      // KEEP WATCHING (never terminal: the registrar may only be late, and the account would then be stranded)
      if (Date.now() - rec.stageAt > WAITING_STALLED_MS && rec.reason !== STALLED_REASON) {
        const { updateLaunchRecord } = await import("@/lib/zk/anon/queue");
        await updateLaunchRecord(rec.launchCommit, { reason: STALLED_REASON }, "no registration after " + Math.round((Date.now() - rec.stageAt) / HOUR) + " h — still watching");
      }
      return;
    }
    // the account must carry exactly this persona's derived key and recovery address — or it is not this launch's
    const { fcSignerPublicKeyFor, fcCustodyAddressFor } = await import("@/lib/identity/keys");
    if (fcSignerPublicKeyFor(rec.personaId) !== rec.signerKey || fcCustodyAddressFor(rec.personaId)?.toLowerCase() !== rec.custody) throw new Error("the persona's keys no longer match its launch request");
    // fix LP-1: checked LOCALLY against the uniform list's row (its recovery and active keys) — no per-fid chain read, and
    // NOTHING written but this sealed record on its deferred schedule (it is the launched account's record from here on)
    if (hit.custody !== rec.custody || !hit.keys.includes(rec.signerKey) || hit.recovery !== rec.recovery) throw new Error("the registered account does not list this persona's key");
    await moveTo(rec, "registered", { fid: hit.fid, registeredHour: hit.hour, nextAt: await jitterFrom(now) }, `registered as fid ${hit.fid} (simulated chain)`, report);
    return;
  }
  if (now < rec.nextAt || !rec.fid) return;
  if (rec.stage === "registered") {
    const mirror = anonMirror(mode);
    // the own-rows mirror must have read the WHOLE list: a reveal from a partial list would leave posts out for good
    if (!mirror || !mirror.complete) throw new Error("this device hasn't finished reading the anonymous posts yet");
    const { attributionSecretsFor, anonPostOutcomes } = await import("@/lib/zk/anon/queue");
    const secrets = await attributionSecretsFor(rec.personaId, mode);
    const outcomes = await anonPostOutcomes(secrets.map((s) => s.castHash));
    const ready = secrets.filter((s) => mirror.rows.has(s.castHash));
    // refused: never posted and never will be (the channel or the validator refused it) — never "on the way"
    const refused = secrets.filter((s) => !mirror.rows.has(s.castHash) && outcomes.get(s.castHash) === "refused").length;
    const onTheWay = secrets.length - ready.length - refused;
    if (onTheWay > 0 && now - rec.stageAt < REVEAL_WAIT_MS) {
      const { updateLaunchRecord } = await import("@/lib/zk/anon/queue");
      await updateLaunchRecord(rec.launchCommit, { reason: `Waiting for ${onTheWay} anonymous post${onTheWay === 1 ? "" : "s"} still on the way to @anon, so the reveal holds them all.` });
      return;
    }
    const { sendBatchReveal, revealParts } = await import("./reveal");
    const parts = revealParts(ready.map((s) => ({ castHash: s.castHash, secret: s.secret })));
    const hashes: string[] = [];
    let revealed = 0;
    for (const part of parts) {
      const r = await sendBatchReveal(rec.personaId, rec.fid, mode, part);
      if (!r.ok) throw new Error(r.reason ?? "the reveal was refused");
      if (r.batchHash) hashes.push(r.batchHash);
      revealed += r.revealed ?? part.length;
    }
    const left = [onTheWay ? `${onTheWay} never relayed` : "", refused ? `${refused} refused, never posted` : ""].filter(Boolean).join(", ");
    await moveTo(
      rec,
      "revealed",
      { batchHash: hashes[0] ?? null, ...(hashes.length > 1 ? { batchHashes: hashes } : {}), revealed, leftOut: onTheWay || refused ? { notRelayed: onTheWay, refused } : null, nextAt: await jitterFrom(now) },
      `revealed ${revealed} anonymous post(s) in ${parts.length <= 1 ? "one batch" : parts.length + " batches"}${left ? ` (left out: ${left})` : ""}`,
      report
    );
    return;
  }
  if (rec.stage === "revealed") {
    const notes: string[] = [];
    const { submitUsernameProof, submitThinMessage, thinCanonical } = await import("@/lib/fc/thinRelay");
    const { signCustodyTypedDataFor, fcSignerPublicKeyFor, signAsFcSignerFor } = await import("@/lib/identity/keys");
    // the NAME: an EIP-712 UserNameProof by the account's CUSTODY key, signed NOW (never at the click). Once the name
    // server took it, a retry of this step does not send it again.
    if (!rec.fname) {
      notes.push("no name was set (the persona's handle shares a stem with your main account)");
    } else if (rec.fnameSet !== rec.fname) {
      const { FNAME_DOMAIN, USERNAME_PROOF_TYPES } = await import("./request");
      const ts = Math.floor(Date.now() / 1000);
      const sig = await signCustodyTypedDataFor(rec.personaId, { domain: FNAME_DOMAIN, types: USERNAME_PROOF_TYPES, primaryType: "UserNameProof", message: { name: rec.fname, timestamp: BigInt(ts), owner: rec.custody } });
      if (!sig) throw new Error("this device could not sign with the account's custody key");
      const named = await submitUsernameProof(mode, { type: "UsernameProof", fid: rec.fid, name: rec.fname, owner: rec.custody, timestamp: ts, signature: sig.toLowerCase() });
      if (named.ok) {
        // fix LP-1: the accepted name rides the SEALED launch record (deferred persist) — never an immediate personaFids save
        const { updateLaunchRecord } = await import("@/lib/zk/anon/queue");
        await updateLaunchRecord(rec.launchCommit, { fnameSet: rec.fname }, `the name @${rec.fname} is set`);
      } else if (named.code === "refused") {
        // only a TAKEN name (409) is final; a server error is retried (fix W2-LAUNCH-FNAME-TRANSIENT)
        notes.push(`the name @${rec.fname} was not available (${named.reason}); the account stays without a name for now`);
      } else throw new Error(named.reason);
    }
    // the PROFILE: UserDataAdds signed by the account's own key, through the thin relay
    const signerPubKey = fcSignerPublicKeyFor(rec.personaId);
    if (!signerPubKey) throw new Error("this device holds no signer key for that persona");
    for (const [field, value] of [["display", rec.profile.displayName], ["bio", rec.profile.bio], ["pfp", rec.profile.pfpUrl]] as const) {
      if (!value) continue;
      const unsigned = { type: "UserDataAdd" as const, fid: rec.fid, signerPubKey, timestamp: Date.now(), field, value };
      const signature = signAsFcSignerFor(rec.personaId, thinCanonical(mode, unsigned));
      if (!signature) throw new Error("this device could not sign as that persona");
      const r = await submitThinMessage(mode, { ...unsigned, signature });
      if (!r.ok) throw new Error("the profile was refused: " + r.reason);
    }
    await moveTo(rec, "profiled", { nextAt: await jitterFrom(now) }, ["name and profile set", ...notes].join("; "), report);
    return;
  }
  if (rec.stage === "profiled" || rec.stage === "history") {
    const { postLaunchHistory } = await import("./history");
    const h = await postLaunchHistory(rec.personaId, rec.fid, mode, rec.quoteOriginals, rec.history, rec.revealed);
    if (!h.ok) {
      const { updateLaunchRecord } = await import("@/lib/zk/anon/queue");
      await updateLaunchRecord(rec.launchCommit, { stage: "history", history: { launchCastHash: h.launchCastHash, quoted: h.quoted } });
      throw new Error(h.reason ?? "the history was not posted");
    }
    await moveTo(rec, "done", { history: { launchCastHash: h.launchCastHash, quoted: h.quoted } }, [`history posted: the launch cast and ${h.quoted.length} quote(s)`, ...h.notes].join("; "), report);
  }
}

/** for the dev status: when the uniform read last answered and how many registrations it listed */
export function lastRegistrationsRead(): { at: number; count: number } | null {
  return g.__layersLaunchRegistrations ?? null;
}
