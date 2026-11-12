"use client";
// ANON REVIEW (A2-2, R3-02, R3-14) — the plain-words status of ONE anonymous post, after the composer queued it.
//
// Before this, the composer toasted "Queued anonymously" and nothing on screen ever said what happened next: a proof
// refused on the tick vanished, and a post that was simply waiting for the hourly relay slot read as broken. This
// polls GET /api/anon?castHash= (the queue item, the outcome log and the timing) and says, in clock times, where the
// post is: waiting for its proof, proof sent, will post before HH:MM, posted, or refused with the reason. Mounted by
// the composer right after a 202 (see the Composer diff in the anon pass notes); it renders nothing once the owner
// dismisses it.
import { useEffect, useState } from "react";
import { plainRelayRefusal } from "@/lib/zk/anon/slots";

interface Status {
  /** the post this line is about (every answer carries it; the recent list keys on it) */
  castHash?: string;
  status: string;
  item: { status: string; outcome: string | null; notBefore: number; sentAt: number | null } | null;
  outcome: { stage: string; reason: string | null; lastStage: string | null; attempts: number; warnings: string[] } | null;
  validatorRefusal: { reason: string; at: number } | null;
  /** PERSONA LAUNCH P3: for a replay — whether the public list holds THIS cast (null: not asked / unreadable) */
  relayed?: boolean | null;
  /** PERSONA LAUNCH P3 (D4): relaySpreadMs — the post lands at a random moment within this after its slot (30 minutes
   *  on the public site, 0 on the owner service; absent from an older server = 0) */
  timing: { nextTickWithinMs: number; jitterMaxMs: number; relayIntervalMs: number; relaySlotJitterMaxMs: number; relaySpreadMs?: number };
  /** PERSONA LAUNCH P7: where this device runs — "tab" (the visitor's browser device) or "server"; absent = server */
  host?: "tab" | "server";
  /** PERSONA LAUNCH P7: the public preview's test universe — an accepted post stays inside the preview */
  previewOnly?: boolean;
  /** PERSONA LAUNCH P7 (UXH-3): sent after the end of the window its proof was made for (judged on the device from the
   *  last check's epoch timing — app/api/anon/route.ts statusOf), so the closed-tab sentence shows without the validator */
  expiredWindow?: boolean;
}

/** PERSONA LAUNCH P7 (A-WEB-TAB-CLOSED-POST-EXPIRES): the validator refuses a proof made for an epoch that has ended (an
 *  anonymous post gets no grace). In a browser that is what happens to a post proved before the tab was closed and sent
 *  after it was opened again in a later window — said in plain words instead of the channel's bare "refused" */
export const EXPIRED_IN_CLOSED_TAB =
  "Not posted: its proof was made for an earlier window, which ended while this tab was closed. Nothing was consumed, but the validator has seen these words: write it differently to post again.";
/** PERSONA LAUNCH wave 3 (L7): the device EXPIRED it before sending — its window ended first (a closed tab, an app that
 *  was off), so it never left this device (lib/zk/anon/queue.ts expireStaleNoGraceItems: status refused, outcome
 *  "expired"). Nothing was seen, so the same words may go again. */
export const EXPIRED_NEVER_SENT =
  "Not posted: its window ended before it could be sent, so it never left this device. Nothing was consumed; you can post it again.";
export const LOST_WITH_TAB =
  "Not posted: it was still waiting for its proof when this tab was closed, and a post that hasn't been proved yet lives only in the open tab. Post it again if you still want it.";
export const PREVIEW_ACCEPTED =
  "Accepted. It shows on this preview as an anonymous post (test data: it stays inside this preview and is never posted to Farcaster). Nothing else to do.";
/** PERSONA LAUNCH P7 (UXH-3): said on every line of a post that still lives in THIS tab (waiting for its proof, retrying,
 *  waiting for the next window, or proved and not yet sent) — closing the tab loses a post not yet proved and delays one
 *  not yet sent (and a phone pauses a tab in the background). The device also asks before the tab closes while it holds
 *  one (lib/device/entry.ts, beforeunload). */
export const KEEP_TAB_OPEN = "Keep this tab open (and in front on a phone) until it says Accepted: closing it loses or delays the post.";
const expiredEpoch = (reason: string | null | undefined) => typeof reason === "string" && /current epoch|neither current nor within/.test(reason);
/** a sentence ends once: a reason that already ends in a full stop, a question, an ellipsis or a closing quote gets none */
const endSentence = (t: string) => (/[.!?…”"]$/.test(t.trim()) ? t.trim() : t.trim() + ".");

const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
/** the latest moment the post goes out after `t`: the next multiple of the relay interval, plus the slot's own jitter,
 *  plus the spread inside which each post's own moment is drawn (PERSONA LAUNCH P3) */
const spreadOf = (timing: Status["timing"]) => (typeof timing.relaySpreadMs === "number" && timing.relaySpreadMs > 0 ? timing.relaySpreadMs : 0);
const slotBefore = (t: number, timing: Status["timing"]) => (Math.floor(t / timing.relayIntervalMs) + 1) * timing.relayIntervalMs + timing.relaySlotJitterMaxMs + spreadOf(timing);
/** "hourly" or "30-minute" — the relay cadence in plain words */
const cadenceWord = (timing: Status["timing"]) => (timing.relayIntervalMs === 3_600_000 ? "hourly" : `${Math.max(1, Math.round(timing.relayIntervalMs / 60_000))}-minute`);

export function describeAnonStatus(s: Status, now: number): { tone: "wait" | "ok" | "bad"; text: string } {
  const t = s.timing;
  const o = s.outcome;
  // UXH-3: a line about a post this tab still holds says to keep the tab open
  const inTab = (text: string) => (s.host === "tab" ? text + " " + KEEP_TAB_OPEN : text);
  if (s.item) {
    const i = s.item;
    if (i.status === "queued") return { tone: "wait", text: inTab(`Proof made. It is sent at a random moment before ${clock(i.notBefore)}, then posted at the next ${cadenceWord(t)} slot (before ${clock(slotBefore(i.notBefore, t))}).`) };
    if (i.status === "sent" && i.outcome === "accepted" && s.previewOnly === true) return { tone: "ok", text: PREVIEW_ACCEPTED };
    if (i.status === "sent" && i.outcome === "accepted") return { tone: "ok", text: `Accepted. The anonymous account posts it at its next slot, before ${clock(slotBefore(i.sentAt ?? now, t))}. Nothing else to do.` };
    // PERSONA LAUNCH P3 (PRIV-1): a replay is either this post sent twice (it IS posted) or its slot already spent by
    // another of your posts — K slots are drawn per device, so two devices can draw the same one
    // (A-ANON-SLOT-COLLISION-ACROSS-DEVICES). The public list can CONFIRM the first (relayed === true, the only green
    // line); it can never prove the second (relayed rows only, the newest 200, while the original may wait up to its slot
    // plus jitter plus spread). So false and null are "not confirmed" — never "not posted" — and the line NEVER advises
    // posting the same words again: the validator holds them under the earlier post's nullifier, so a fresh slot would
    // publish a post it can tie to that one (lib/zk/gate.ts refuses those words, REPLAYED_WORDS_SENTENCE).
    if (i.status === "sent" && i.outcome === "replay") {
      if (s.relayed === true) return { tone: "ok", text: "Already accepted earlier (the same proof was sent twice; it is posted once)." };
      const dont = "Don't post the same words again: the validator would link the two posts.";
      const deadline = (i.sentAt ?? now) + t.relayIntervalMs + t.relaySlotJitterMaxMs + spreadOf(t);
      if (s.relayed === null) return { tone: "wait", text: `Not confirmed yet: its slot was already used, by this post or another of yours, and the list of anonymous posts could not be read to tell which. ${dont}` };
      if (now < deadline) return { tone: "wait", text: `Not confirmed yet: its slot was already used, by this post sent twice or by another of yours that may still be waiting to go out. Totem keeps checking until ${clock(deadline)}. ${dont}` };
      return { tone: "wait", text: `Not confirmed: its slot was already used, and this post isn't among the anonymous account's recent posts, so another of your posts most likely took the slot. ${dont}` };
    }
    // PERSONA LAUNCH wave 3 (L7): expired on the device before it was sent — never on the wire, nothing seen
    if (i.status === "refused" && i.outcome === "expired") return { tone: "bad", text: EXPIRED_NEVER_SENT };
    if ((i.status === "sent" || i.status === "refused") && s.host === "tab" && (s.expiredWindow === true || expiredEpoch(s.validatorRefusal?.reason))) return { tone: "bad", text: EXPIRED_IN_CLOSED_TAB };
    if (i.status === "sent" || i.status === "refused") {
      // UX-2: the validator's reason in plain words (its cap refusals mapped, no variable names); a cap refusal is not
      // fixed by posting again now
      const r = s.validatorRefusal ? plainRelayRefusal(s.validatorRefusal.reason) : null;
      if (r?.cap) return { tone: "bad", text: `Not posted: ${r.text}. Nothing was consumed; posting again now would be refused the same way.` };
      // PUBLIC GO-LIVE (PRIV-LIVE-2): a tab never asks the validator for the reason (that read would name this post from this
      // browser), so its line says the reason stays unknown here, by design
      const why =
        r?.text ??
        (i.outcome === "transport-error"
          ? "the anonymous channel could not be reached three times"
          : s.host === "tab"
            ? "the anonymous channel gives no reason by design, and this browser doesn't ask, so nothing ties the refusal to you"
            : "the anonymous channel gives no reason by design; the validator's own log has it");
      // PERSONA LAUNCH wave 3 (L7): a submission the validator RECEIVED (status sent) has had its words read — the device
      // refuses the same words again (lib/zk/gate.ts REFUSED_WORDS_SENTENCE), so the line never invites them; one that
      // never reached it (a transport error) may go again as it was
      const again = i.status === "sent" ? "Nothing was consumed, but the validator has seen these words: write it differently to post again." : "Nothing was consumed; you can post it again.";
      return { tone: "bad", text: `Not posted: the validator refused it (${why}). ${again}` };
    }
  }
  if (o?.stage === "dropped") return { tone: "bad", text: "Not posted: " + endSentence(o.reason ?? "the proof was refused") };
  if (o?.stage === "deferred") return { tone: "wait", text: inTab(`Waiting for the next 6-hour window to start (too close to its end for the random send delay). ${o.reason ?? ""}`.trim()) };
  if (o?.stage === "retrying") return { tone: "wait", text: inTab(`Not proved yet (${o.reason ?? "refused on the last check"}); tried ${o.attempts} time(s), checked again within ${Math.ceil(t.nextTickWithinMs / 60_000)} minutes.`) };
  if (s.status === "wanted" || o?.stage === "wanted") return { tone: "wait", text: inTab(`Waiting for its proof: the next check runs within ${Math.ceil(t.nextTickWithinMs / 60_000)} minutes, then it is sent at a random moment within ${Math.ceil(t.jitterMaxMs / 60_000)} minutes and posted at the next ${cadenceWord(t)} slot. Expect about ${Math.ceil((t.nextTickWithinMs + t.jitterMaxMs + t.relayIntervalMs + t.relaySlotJitterMaxMs + spreadOf(t)) / 60_000)} minutes at most.`) };
  if (s.host === "tab") return { tone: "bad", text: LOST_WITH_TAB };
  return { tone: "bad", text: "No record of this post on this server (a restart may have forgotten it before it was proved). Post it again if it never appears." };
}

/** the line itself — shared by the per-post poll below and the composer's recent list (UXH-3) */
function AnonStatusLine({ s, onDismiss, testId = "anon-post-status" }: { s: Status | null; onDismiss: () => void; testId?: string }) {
  const d = s ? describeAnonStatus(s, Date.now()) : { tone: "wait" as const, text: "Checking where your anonymous post is…" };
  const warnings = s?.outcome?.warnings ?? [];
  return (
    <div data-testid={testId} data-tone={d.tone} className="mt-2 flex flex-col gap-1 rounded-xl border border-x-border p-2 text-[13px] leading-4">
      <div className="flex items-start justify-between gap-2">
        <span className={d.tone === "bad" ? "text-[#f4212e]" : d.tone === "ok" ? "text-[#00ba7c]" : "text-x-sec"}>
          <span className="font-bold">Anonymous post: </span>
          {d.text}
        </span>
        <button type="button" aria-label="dismiss" onClick={onDismiss} className="text-x-sec hover:underline">
          ×
        </button>
      </div>
      {warnings.map((w) => (
        <p key={w} className="text-x-sec">
          Note: {w}.
        </p>
      ))}
    </div>
  );
}

/**
 * PERSONA LAUNCH P7 (UXH-3) — THIS DEVICE'S ANONYMOUS POSTS THAT STILL NEED YOU, shown by the composer on mount (the
 * per-post line below exists only from the composer's own state after a 202, so a reload, a reopen or a navigation lost
 * it and a post could vanish without a word). Reads GET /api/anon?recent=1 — memory only on the device, no validator
 * read — every 20 s, and draws each post's line with the same words as the per-post line (the closed-tab sentences
 * included). Dismissing hides a line for as long as this page is open (in memory only: an anonymous post's hash is
 * never written to the browser's plain storage); it is never deleted.
 */
const dismissedRecent = new Set<string>();
export function AnonRecentStatus({ exclude }: { exclude?: string | null }) {
  const [list, setList] = useState<Status[]>([]);
  const [, setHidden] = useState(0);
  useEffect(() => {
    let alive = true;
    const tick = () =>
      fetch("/api/anon?recent=1", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => {
          if (alive && j && Array.isArray(j.recent)) setList((j.recent as Status[]).filter((x) => x && typeof x.castHash === "string" && !!x.timing));
        })
        .catch(() => {});
    void tick();
    const timer = setInterval(() => void tick(), 20_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  const shown = list.filter((x) => typeof x.castHash === "string" && x.castHash !== exclude && !dismissedRecent.has(x.castHash));
  if (!shown.length) return null;
  return (
    <div data-testid="anon-recent-status">
      {shown.map((x) => (
        <AnonStatusLine
          key={x.castHash}
          s={x}
          testId="anon-recent-post-status"
          onDismiss={() => {
            if (typeof x.castHash === "string") dismissedRecent.add(x.castHash);
            setHidden((n) => n + 1);
          }}
        />
      ))}
    </div>
  );
}

export function AnonPostStatus({ castHash, onDismiss }: { castHash: string; onDismiss?: () => void }) {
  const [s, setS] = useState<Status | null>(null);
  const [gone, setGone] = useState(false);
  useEffect(() => {
    let alive = true;
    const tick = () =>
      fetch("/api/anon?castHash=" + encodeURIComponent(castHash), { cache: "no-store" })
        .then((r) => r.json())
        .then((j) => {
          if (alive && j && j.timing) setS(j as Status);
        })
        .catch(() => {});
    void tick();
    const timer = setInterval(() => void tick(), 20_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [castHash]);
  if (gone) return null;
  return (
    <AnonStatusLine
      s={s}
      onDismiss={() => {
        setGone(true);
        onDismiss?.();
      }}
    />
  );
}

// PERSONA LAUNCH P7 — WHERE YOUR PROOFS ARE MADE, for Settings › ZK privacy layer. Lives in this file (the track's own
// client module) rather than a new one: one small island beside the anonymous post status it explains. It asks the
// device's read-only `proverStatus` (POST /api/zk — answered in the browser on the public site, by the server on the rig
// and the owner service), never fetches anything else, and shows public values only: where proofs run, and when and how
// long the last one in this tab took. Unreadable is said as such, never as "no proofs".
interface ProverStatusView {
  where: "browser-worker" | "server-process" | "server-in-process" | string;
  lastProve: { op: string; at: number; ms: number; mode: string } | null;
}
export function proverWhereSentence(s: ProverStatusView | null, failed: boolean): string {
  if (failed) return "Where your proofs are made couldn't be read just now.";
  if (!s) return "Checking where your proofs are made…";
  const where =
    s.where === "browser-worker"
      ? "Your proofs are made in this browser, in a separate background worker. Your secret never leaves this tab."
      : s.where === "server-process"
        ? "Your proofs are made on your own server, in a separate process."
        : "Your proofs are made on your own server (test proofs, computed in place).";
  if (!s.lastProve) return where + " No proof has been made since this page opened.";
  const secs = (s.lastProve.ms / 1000).toFixed(s.lastProve.ms < 10_000 ? 1 : 0);
  const kind = s.lastProve.op === "live-prove" ? "real proof" : "test proof";
  return `${where} The last ${kind} took ${secs} s, at ${clock(s.lastProve.at)}.`;
}
export function ProverWhereLine() {
  const [s, setS] = useState<ProverStatusView | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    fetch("/api/zk", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "proverStatus" }), cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status))))
      .then((j) => {
        if (alive && j && typeof j.where === "string") setS({ where: j.where, lastProve: j.lastProve ?? null });
        else if (alive) setFailed(true);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, []);
  return (
    <p data-testid="zk-prover-where" data-where={s?.where ?? (failed ? "unreadable" : "checking")} className="px-4 py-2 text-[13px] leading-4 text-x-sec">
      {proverWhereSentence(s, failed)}
    </p>
  );
}
