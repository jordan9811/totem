"use client";
// PERSONA LAUNCH P1 (SIWF) Gate 2 — the "Sign in with Farcaster" card on /device (lib/fc/siwf/flow.ts is the flow).
//
// Honest copy first: signing in shows which Farcaster account is yours; it does NOT save the identity (a passkey does).
// The disclosure — who sees what — is on the card BEFORE the first request: nothing is sent until the visitor presses
// "Sign in with Farcaster". Then: a QR (or "Open in the Farcaster app" on a phone), polled every 1.5 s while this tab
// is visible (and once at once when it becomes visible again), for at most ten minutes. Every answer is the route's
// fixed sentence; nothing here ever shows a token, a signature or an address.
//
// The sign-in link carries the relay's channel token, so the status view never does: the card asks for it once per
// request (POST {action: "approval"}) to make the phone button. A verified sign-in announces the "signed-in" moment,
// so the Save card can offer the passkey while the identity is still only in this tab.
//
// PERSONA LAUNCH P1 (review UX-13, UX-14, UX-17):
//   • a status read that fails leaves no section to show (every one is gated on the status), so the error carries a
//     "Try again" (siwf-retry) that re-reads it: never a card stuck on an error with no way forward (UX-13);
//   • past the deadline (plus one poll's grace) a tick makes ONE final poll — the device then ends the request as
//     expired and says so — instead of returning forever; and the card shows a still-open request past its deadline as
//     expired ITSELF (shownSession: no QR, no "Waiting…"), so a dead QR is never shown as live even when that final
//     poll cannot be made. Returning from the Farcaster app after ten minutes lands on "expired · start again" (UX-14).
//     pollStep and shownSession are pure and exported: scripts/unit-siwf.mjs U13 tests them (and mutates them);
//   • the DISCONNECT field has an accessible name, and the request's status line is a polite live region (UX-17).
//
// PUBLIC GO-LIVE — ONE IMPLEMENTATION, TWO PLACES, TWO SKINS. The guided first run (/welcome, components/onboarding)
// renders THIS card with skin="app" (the app's Tailwind look); /device keeps skin="device" (its own black cards). Same
// flow, same test ids, same words. Two additions, both for the app skin's phone case:
//   • QR on desktop, the Farcaster app on a phone: with `phone` the deep link ("Open in the Farcaster app") is the main
//     action and the QR code sits one tap away;
//   • KEEP BEFORE THE APP SWITCH (keepFirst): on a phone the Farcaster app opens, and the browser may reload this tab
//     when the visitor comes back. An identity that lives only in this tab would be gone, so BEFORE the request starts
//     (and so before any deep link exists) the card keeps the identity in this browser (window.__layersDevice.persist(),
//     the strip's "Keep in this browser"), and says so in one sentence. A keep that fails stops the sign-in with the
//     reason (never fail open: the app switch could lose the identity).
//
// PUBLIC GO-LIVE (F2) — SIGN IN AGAIN TO JOIN THE LIVE ANONYMOUS CROWD. While the site hands this tab the LIVE universe (the
// device env's ZK_ANON_UNIVERSE=live, lib/zk/anon/universe.ts), the device lets a signed-in visitor sign in AGAIN with the
// same account (lib/fc/siwf/flow.ts startSiwf), and that sign-in's nonce binds this identity's crowd commitment so the validator adds
// it to the live crowd (lib/zk/anon/fcJoin.ts). A sign-in made before the relay was armed — or one whose join the tab
// forgot on a reload (the join's outcome is memory only) — had no way to get there: the card offered only Disconnect.
// Now, for a signed-in link (not disconnected) in a hinted tab, the card reads GET /api/anon once, and when the route's own
// words ask for a Farcaster sign-in (lib/onboarding/state.ts rejoinOffered: code "crowd", no availableFrom, a sentence that
// asks to sign in with Farcaster) it shows the same disclosure and "Sign in again with Farcaster to join the anonymous
// crowd", which calls the SAME start action. After a sign-in verifies it reads again (now, and once more after the join's
// retries), so the button goes away once the route says when this browser can post. An unreadable answer offers nothing.
// data-rejoin on the card says which ("na", "checking", "offered", "not-offered") for the suites.
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { announceMoment } from "./SaveMoment";
import { REJOIN_LABEL, rejoinOffered } from "@/lib/onboarding/state";
import { liveUniverseHinted } from "@/lib/zk/anon/universe";
import { SIWF_SERVER_SEES_LIVE } from "@/components/help/privacy-copy";

type Stage = "pending" | "checking" | "verified" | "refused" | "expired";
interface LinkView {
  fname: string | null;
  displayName: string | null;
  personaId: string;
  handle: string | null;
  disconnected: boolean;
}
export interface SessionView {
  id: string;
  stage: Stage;
  deadline: number;
  code: string | null;
  note: string | null;
  retryable: boolean;
  approval: { qr: { viewBox: number; path: string } } | null;
}
interface StatusView {
  available: boolean;
  code: string | null;
  reason: string | null;
  mode: "live" | "fixture" | null;
  relayHost: string | null;
  rpcHost: string | null;
  link: LinkView | null;
  session: SessionView | null;
  moment?: "signed-in";
}

const card: React.CSSProperties = { border: "1px solid #2f3336", borderRadius: 16, padding: 16, background: "#000", color: "#e7e9ea" };
const btn: React.CSSProperties = { borderRadius: 9999, padding: "8px 16px", fontWeight: 700, border: "1px solid #536471", background: "#eff3f4", color: "#0f1419", cursor: "pointer" };
const btnQuiet: React.CSSProperties = { ...btn, background: "transparent", color: "#e7e9ea" };
const muted: React.CSSProperties = { color: "#71767b", fontSize: 13 };
const field: React.CSSProperties = { background: "#000", color: "#e7e9ea", border: "1px solid #536471", borderRadius: 8, padding: 6 };

/** PUBLIC GO-LIVE: the two skins — each part as the props an element spreads (the device page's inline styles, or the
 *  app's Tailwind classes) */
export type SignInSkin = "device" | "app";
type Part = { style?: React.CSSProperties; className?: string };
function kit(skin: SignInSkin) {
  if (skin === "app") {
    const btnApp = "inline-flex h-11 items-center justify-center rounded-full bg-x-black-btn px-5 text-[16px] font-bold text-white hover:bg-x-black-btn-hover disabled:opacity-50";
    const quietApp = "inline-flex h-10 items-center justify-center rounded-full border border-x-border-dark bg-white px-4 text-[15px] font-bold text-x-text hover:bg-x-hover disabled:opacity-50";
    return {
      card: { className: "rounded-2xl border border-x-border bg-white p-4 text-x-text" } as Part,
      title: { className: "text-[17px] font-bold leading-6" } as Part,
      muted: { className: "text-[14px] leading-5 text-x-sec" } as Part,
      btn: { className: btnApp } as Part,
      btnQuiet: { className: quietApp } as Part,
      field: { className: "w-36 rounded-md border border-[#cfd9de] px-2 py-1 text-[15px]" } as Part,
      link: { className: "font-bold text-x-text hover:underline" } as Part,
      error: { className: "mt-3 text-[14px] text-[#f4212e]" } as Part,
    };
  }
  return {
    card: { style: card } as Part,
    title: { style: { fontWeight: 700 } } as Part,
    muted: { style: muted } as Part,
    btn: { style: btn } as Part,
    btnQuiet: { style: btnQuiet } as Part,
    field: { style: { ...field, width: 140 } } as Part,
    link: { style: { fontWeight: 700, color: "#e7e9ea" } } as Part,
    error: { style: { marginTop: 12, color: "#f4212e", fontSize: 13 } } as Part,
  };
}
/** a part with extra inline layout (the device skin's grids keep their spacing; the app skin gets the same as classes) */
function withLayout(part: Part, skin: SignInSkin, style: React.CSSProperties, className: string): Part {
  return skin === "app" ? { className: [part.className, className].filter(Boolean).join(" ") } : { style: { ...(part.style ?? {}), ...style } };
}

/** PUBLIC GO-LIVE: the one sentence the phone case says before the Farcaster app opens (keepFirst) */
export const KEEP_BEFORE_APP_SWITCH = "On a phone the Farcaster app opens and this page may reload when you come back, so Totem first keeps your identity in this browser.";

interface KeepDevice {
  info?: { restored?: boolean; persistent?: boolean } | null;
  isPersistent?: () => boolean;
  persist?: () => Promise<void>;
}
/** keep the identity in this browser unless it already is (restored or persisted); THROWS a plain reason when it cannot */
export async function keepBeforeAppSwitch(d: KeepDevice | null | undefined): Promise<"kept" | "already"> {
  if (!d || typeof d.persist !== "function") throw new Error("this page is still starting; try again in a moment.");
  const already = d.info?.restored === true || d.info?.persistent === true || (typeof d.isPersistent === "function" && d.isPersistent());
  if (already) return "already";
  try {
    await d.persist();
  } catch {
    throw new Error("Totem couldn't keep your identity in this browser, so the sign-in did not start (the app switch could lose it). Try again.");
  }
  return "kept";
}

/** PUBLIC GO-LIVE (F2): the device env this page booted with (a page-settable global: the hint chooses UI, it grants nothing;
 *  the device itself decides whether a second sign-in may start) */
function pageDeviceEnv(): Record<string, string | undefined> {
  if (typeof window === "undefined") return {};
  return (window as unknown as { __LAYERS_DEVICE_ENV?: Record<string, string | undefined> }).__LAYERS_DEVICE_ENV ?? {};
}
/** F2: after a verified sign-in, the second read waits out the join's retries (lib/zk/anon/fcJoin.ts: 4 s, then 15 s) */
const REJOIN_REREAD_MS = 20_000;
type RejoinState = "na" | "checking" | "offered" | "not-offered";

export const POLL_MS = 1500;
const STILL_TRYING = "Couldn't check the request just now. Still trying.";
/** lib/fc/siwf/flow.ts SENTENCES.siwf_expired, word for word (unit-siwf U13 compares them: the card and the device
 *  must never word an expired request two ways) */
export const EXPIRED_NOTE = "The sign-in request expired. Start again.";
export const DISCONNECT_LABEL = "Type DISCONNECT to confirm";

/** UX-14: what one tick does. Until the deadline plus one poll's grace it polls; past it, ONE final poll (the device
 *  answers a poll past the deadline by ending the request as expired); after that, nothing. */
export function pollStep(now: number, deadline: number, finalSent: boolean): "poll" | "final" | "stop" {
  if (now <= deadline + POLL_MS) return "poll";
  return finalSent ? "stop" : "final";
}

/** UX-14: the request as the card shows it. Still open (pending / checking) past its deadline plus one poll's grace =
 *  expired, with no QR — whatever the last answer said. Anything else is shown as answered. */
export function shownSession(s: SessionView | null, now: number): SessionView | null {
  if (!s || (s.stage !== "pending" && s.stage !== "checking") || now <= s.deadline + POLL_MS) return s;
  return { ...s, stage: "expired", code: "siwf_expired", note: EXPIRED_NOTE, retryable: false, approval: null };
}

async function call(method: "GET" | "POST", body?: Record<string, unknown>): Promise<{ ok: boolean; json: Record<string, unknown> }> {
  const r = await fetch("/api/fc/siwf", method === "GET" ? { cache: "no-store" } : { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });
  const json = ((await r.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  return { ok: r.ok, json };
}

export function FarcasterSignIn({
  publicDeployment,
  onChange,
  skin = "device",
  phone = false,
  keepFirst = false,
}: {
  publicDeployment: boolean;
  onChange?: () => void;
  /** PUBLIC GO-LIVE: "app" in the guided first run, "device" on /device (the default, unchanged) */
  skin?: SignInSkin;
  /** PUBLIC GO-LIVE: this is a phone — the Farcaster app is the main action, the QR one tap away */
  phone?: boolean;
  /** PUBLIC GO-LIVE: keep the identity in this browser before the request starts (the phone case of the guided run) */
  keepFirst?: boolean;
}) {
  const k = kit(skin);
  const [qrShown, setQrShown] = useState(false);
  const [keepNote, setKeepNote] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusView | null>(null);
  const [error, setError] = useState<{ text: string; code: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [approvalUrl, setApprovalUrl] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const polling = useRef(false);
  // UX-13: a status re-read in flight (the retry button says so and cannot be pressed twice)
  const [reading, setReading] = useState(false);
  // UX-14: the id of a request whose deadline passed in this tab (shown expired), and of the one already given its
  // final poll
  const [lapsed, setLapsed] = useState<string | null>(null);
  const finalSent = useRef<string | null>(null);
  // F2: the live crowd's "sign in again" offer, and the tick that re-reads it after a sign-in
  const [rejoin, setRejoin] = useState<RejoinState>("na");
  const [anonTick, setAnonTick] = useState(0);
  const rereadTimer = useRef<number | null>(null);
  // the parent's callback, held in a ref: a new function on every parent render must not re-run the status read
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(
    () => () => {
      if (rereadTimer.current !== null) window.clearTimeout(rereadTimer.current);
    },
    []
  );

  const take = useCallback((j: Record<string, unknown>) => {
    const next = j as unknown as StatusView;
    setStatus(next);
    if (next.moment === "signed-in") {
      announceMoment("signed-in");
      onChangeRef.current?.();
      // F2: read the crowd answer again now, and once more after the join's retries
      setAnonTick((t) => t + 1);
      if (typeof window !== "undefined") {
        if (rereadTimer.current !== null) window.clearTimeout(rereadTimer.current);
        rereadTimer.current = window.setTimeout(() => setAnonTick((t) => t + 1), REJOIN_REREAD_MS);
      }
    }
    return next;
  }, []);

  const load = useCallback(async () => {
    setReading(true);
    try {
      const r = await call("GET").catch(() => null);
      if (!r || !r.ok) {
        setError({ text: String(r?.json?.error ?? "Couldn't read Sign in with Farcaster just now."), code: String(r?.json?.code ?? "unreachable") });
        return;
      }
      setError(null);
      take(r.json);
    } finally {
      setReading(false);
    }
  }, [take]);

  useEffect(() => {
    void load();
  }, [load]);

  const raw = status?.session ?? null;
  // UX-14: once this tab has seen the deadline pass, the request is shown expired (shownSession), whatever the last
  // answer said. Memoised: the same object between renders, so the effects below do not re-run on every render.
  const session = useMemo(() => (raw && lapsed === raw.id ? shownSession(raw, Date.now()) : raw), [raw, lapsed]);
  const open = !!session && (session.stage === "pending" || session.stage === "checking");

  // the phone button's link: asked for once per request (it carries the channel token; the status view never does)
  useEffect(() => {
    setApprovalUrl(null);
    if (!session || session.stage !== "pending" || !session.approval) return;
    let alive = true;
    void call("POST", { action: "approval", sessionId: session.id }).then((r) => {
      if (alive && r.ok && typeof r.json.url === "string") setApprovalUrl(r.json.url);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id, session?.stage]);

  const pollOnce = useCallback(async () => {
    if (!session || polling.current) return;
    polling.current = true;
    try {
      const r = await call("POST", { action: "poll", sessionId: session.id });
      if (r.ok) take(r.json);
      else if (r.json.code === "no_session") await load();
    } catch {
      /* a poll that could not be made is tried again on the next tick */
    } finally {
      polling.current = false;
    }
  }, [session, take, load]);

  // every 1.5 s while visible, one poll at once on becoming visible; past the deadline ONE final poll (the device ends
  // the request as expired) and the card shows it expired at once (UX-14), then nothing
  useEffect(() => {
    if (!open || !session) return;
    const tick = () => {
      if (document.visibilityState !== "visible") return;
      const step = pollStep(Date.now(), session.deadline, finalSent.current === session.id);
      if (step === "stop") return;
      if (step === "final") {
        finalSent.current = session.id;
        setLapsed(session.id);
      }
      void pollOnce();
    };
    const timer = window.setInterval(tick, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [open, session, pollOnce]);

  const act = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      const r = await call("POST", body);
      if (!r.ok) {
        setError({ text: String(r.json.error ?? "That did not work."), code: String(r.json.code ?? "error") });
        return;
      }
      take(r.json);
      onChangeRef.current?.();
    } catch {
      setError({ text: "That request could not be made. Try again.", code: "unreachable" });
    } finally {
      setBusy(false);
    }
  };

  const link = status?.link ?? null;
  const name = link ? "@" + (link.fname ?? link.handle ?? "your account") : "";

  // F2: a signed-in link in a tab handed the live universe asks the anon route whether it should sign in again
  const signedInLink = !!status?.available && !!link && !link.disconnected;
  const linkId = link?.personaId ?? null;
  useEffect(() => {
    if (!signedInLink || !liveUniverseHinted(pageDeviceEnv())) {
      setRejoin("na");
      return;
    }
    let alive = true;
    setRejoin("checking");
    fetch("/api/anon", { cache: "no-store" })
      .then((r) => r.json().catch(() => null))
      .then((j) => {
        if (alive) setRejoin(rejoinOffered({ hinted: true, signedIn: true, answer: j }) ? "offered" : "not-offered");
      })
      .catch(() => {
        if (alive) setRejoin("not-offered"); // an answer that could not be read offers nothing
      });
    return () => {
      alive = false;
    };
  }, [signedInLink, linkId, anonTick]);
  const sessionText = (() => {
    if (!session) return null;
    if (session.stage === "pending") return session.code === "siwf_relay" ? STILL_TRYING : "Waiting for you to approve in the Farcaster app…";
    if (session.stage === "checking") return session.note ?? "Checking your account…";
    if (session.stage === "verified") return null;
    return session.note;
  })();

  // PUBLIC GO-LIVE (keepFirst): on a phone, keep the identity in this browser BEFORE the request starts — the deep link
  // only exists once it has, so the app switch can never take an identity that lived only in this tab
  const start = async () => {
    if (keepFirst) {
      setBusy(true);
      setError(null);
      try {
        const how = await keepBeforeAppSwitch((window as unknown as { __layersDevice?: KeepDevice }).__layersDevice);
        if (how === "kept") setKeepNote("Kept in this browser.");
      } catch (e) {
        setError({ text: (e as Error).message, code: "not_kept" });
        setBusy(false);
        return;
      }
      setBusy(false);
    }
    await act({ action: "start" });
  };
  const appSkin = skin === "app";

  return (
    <div id="farcaster" {...k.card} data-testid="link-farcaster-card" data-skin={skin} data-rejoin={rejoin}>
      <div {...k.title}>Sign in with Farcaster</div>
      <div {...k.muted}>This shows which Farcaster account is yours. It does not save your identity: save with a passkey first.</div>

      {status && !status.available ? (
        <div data-testid="siwf-unavailable" data-code={status.code ?? ""} {...withLayout(k.muted, skin, { marginTop: 12 }, "mt-3")}>
          {status.reason}
        </div>
      ) : null}

      {status?.available && link ? (
        <div {...withLayout({}, skin, { marginTop: 12, display: "grid", gap: 8 }, "mt-3 grid gap-2")}>
          <div data-testid="siwf-status" data-state={link.disconnected ? "disconnected" : "signed-in"}>
            {publicDeployment && link.handle ? (
              <Link href={"/" + link.handle} {...k.link}>
                {name}
              </Link>
            ) : (
              <span style={appSkin ? undefined : { fontWeight: 700 }} className={appSkin ? "font-bold" : undefined}>
                {name}
              </span>
            )}{" "}
            <span {...k.muted}>· {link.disconnected ? "disconnected" : "that's me"}</span>
          </div>
          {link.disconnected ? (
            <div {...k.muted}>Disconnected. Only this same Farcaster account can sign in here again.</div>
          ) : confirming ? (
            <div {...withLayout({}, skin, { display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }, "flex flex-wrap items-center gap-2")}>
              <span id="siwf-disconnect-help" {...k.muted}>
                Type DISCONNECT to confirm. Your Farcaster persona stays, marked disconnected.
              </span>
              <input
                data-testid="siwf-disconnect-confirm"
                aria-label={DISCONNECT_LABEL}
                aria-describedby="siwf-disconnect-help"
                autoComplete="off"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                {...k.field}
              />
              <button
                type="button"
                data-testid="siwf-disconnect-submit"
                {...k.btnQuiet}
                disabled={busy || confirmText !== "DISCONNECT"}
                onClick={() => act({ action: "disconnect", confirm: confirmText }).then(() => setConfirming(false))}
              >
                Disconnect
              </button>
            </div>
          ) : (
            <div>
              <button type="button" data-testid="siwf-disconnect" {...k.btnQuiet} disabled={busy} onClick={() => setConfirming(true)}>
                Disconnect
              </button>
            </div>
          )}
          {/* F2: sign in again with the same account to join the live anonymous crowd — the disclosure first, as always */}
          {!link.disconnected && rejoin === "offered" && !open ? (
            <div data-testid="siwf-rejoin-section" {...withLayout({}, skin, { marginTop: 4, display: "grid", gap: 8 }, "mt-1 grid gap-3")}>
              <div data-testid="siwf-rejoin-disclosure" {...k.muted}>
                Farcaster&rsquo;s sign-in service will see that you signed in to Totem, and your internet address. Your browser then checks the account on the
                Optimism blockchain through {status.rpcHost ?? "a blockchain node"}, which sees your internet address too. {SIWF_SERVER_SEES_LIVE}
              </div>
              {keepFirst ? (
                <div data-testid="siwf-keep-first" {...k.muted}>
                  {KEEP_BEFORE_APP_SWITCH}
                </div>
              ) : null}
              <div>
                <button type="button" data-testid="siwf-rejoin" {...k.btn} disabled={busy} onClick={() => void start()}>
                  {REJOIN_LABEL}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {status?.available && (!link || link.disconnected) && !open ? (
        <div {...withLayout({}, skin, { marginTop: 12, display: "grid", gap: 8 }, "mt-3 grid gap-3")}>
          {/* the disclosure, BEFORE any request is made */}
          <div data-testid="siwf-disclosure" data-joins-crowd={liveUniverseHinted(pageDeviceEnv()) ? "yes" : "no"} {...k.muted}>
            Farcaster&rsquo;s sign-in service will see that you signed in to Totem, and your internet address. Your browser then checks the account on the
            Optimism blockchain through {status.rpcHost ?? "a blockchain node"}, which sees your internet address too.{" "}
            {/* PUBLIC GO-LIVE (PRIV-LIVE-1): a sign-in that joins the live crowd is seen by Totem's validator, and says so */}
            {liveUniverseHinted(pageDeviceEnv()) ? (
              <>{SIWF_SERVER_SEES_LIVE}</>
            ) : (
              <>Totem&rsquo;s server sees nothing.</>
            )}
          </div>
          {/* PUBLIC GO-LIVE (keepFirst): said BEFORE the button, so the keep is never a surprise */}
          {keepFirst ? (
            <div data-testid="siwf-keep-first" {...k.muted}>
              {KEEP_BEFORE_APP_SWITCH}
            </div>
          ) : null}
          <div>
            <button type="button" data-testid="link-farcaster" {...k.btn} disabled={busy} onClick={() => void start()}>
              {link?.disconnected ? "Sign in again with Farcaster" : "Sign in with Farcaster"}
            </button>
          </div>
        </div>
      ) : null}

      {open && session ? (
        <div {...withLayout({}, skin, { marginTop: 12, display: "grid", gap: 8, justifyItems: "start" }, "mt-3 grid justify-items-start gap-3")}>
          {keepNote ? (
            <div data-testid="siwf-kept" {...k.muted}>
              {keepNote}
            </div>
          ) : null}
          {session.approval ? (
            phone && appSkin ? (
              // PUBLIC GO-LIVE: on a phone the Farcaster app is the main action; the QR (for another device) is one tap away
              <>
                {approvalUrl ? (
                  <a data-testid="siwf-open-app" href={approvalUrl} target="_blank" rel="noopener noreferrer" className={k.btn.className + " no-underline"}>
                    Open in the Farcaster app
                  </a>
                ) : (
                  <div {...k.muted}>Getting the link for the Farcaster app…</div>
                )}
                {qrShown ? (
                  <svg
                    data-testid="siwf-qr"
                    viewBox={`0 0 ${session.approval.qr.viewBox} ${session.approval.qr.viewBox}`}
                    width={200}
                    height={200}
                    role="img"
                    aria-label="Sign-in QR code"
                    className="rounded-lg bg-white"
                    shapeRendering="crispEdges"
                  >
                    <path d={session.approval.qr.path} fill="#000" />
                  </svg>
                ) : (
                  <button type="button" data-testid="siwf-show-qr" {...k.btnQuiet} onClick={() => setQrShown(true)}>
                    Farcaster on another device? Show a QR code
                  </button>
                )}
              </>
            ) : (
              <>
                <div {...k.muted}>Scan this with your phone&rsquo;s camera, then approve in the Farcaster app.</div>
                <svg
                  data-testid="siwf-qr"
                  viewBox={`0 0 ${session.approval.qr.viewBox} ${session.approval.qr.viewBox}`}
                  width={200}
                  height={200}
                  role="img"
                  aria-label="Sign-in QR code"
                  style={appSkin ? undefined : { background: "#fff", borderRadius: 8 }}
                  className={appSkin ? "rounded-lg border border-x-border bg-white" : undefined}
                  shapeRendering="crispEdges"
                >
                  <path d={session.approval.qr.path} fill="#000" />
                </svg>
                {approvalUrl ? (
                  <a
                    data-testid="siwf-open-app"
                    href={approvalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={appSkin ? undefined : { ...btnQuiet, textDecoration: "none" }}
                    className={appSkin ? k.btnQuiet.className + " no-underline" : undefined}
                  >
                    On this phone? Open in the Farcaster app
                  </a>
                ) : null}
              </>
            )
          ) : null}
          <div data-testid="siwf-session" data-stage={session.stage} data-code={session.code ?? ""} aria-live="polite" {...k.muted}>
            {sessionText}
          </div>
          <button type="button" data-testid="siwf-cancel" {...k.btnQuiet} disabled={busy} onClick={() => act({ action: "cancel", sessionId: session.id })}>
            Cancel
          </button>
        </div>
      ) : null}

      {session && (session.stage === "refused" || session.stage === "expired") ? (
        <div data-testid="siwf-error" data-code={session.code ?? ""} role="alert" {...k.error}>
          {session.note}
        </div>
      ) : null}
      {error ? (
        <div data-testid="siwf-error" data-code={error.code} role="alert" {...k.error}>
          {error.text}
          {/* UX-13: with no status read there is no section to act from — the error itself is the way forward */}
          {!status ? (
            <div style={appSkin ? undefined : { marginTop: 8 }} className={appSkin ? "mt-2" : undefined}>
              <button type="button" data-testid="siwf-retry" {...k.btnQuiet} disabled={reading} onClick={() => void load()}>
                {reading ? "Trying…" : "Try again"}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
