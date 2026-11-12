"use client";
// PUBLIC GO-LIVE — THE NATIVE ANON PAGE (/anon): the anoncast-style door for Farcaster users who do not want the whole of
// Totem. Outside the (main) group on purpose: no Totem chrome, mobile first, one column.
//
// THE FLOW, all in this tab (the browser device; the public server holds no key and hears nothing about a post):
//   1. the device boots the way /device boots it (components/device/loadDevice.ts startDevice) and makes a light ROOT
//      silently — no persona is needed: the root is the crowd's member (its commitment is the leaf);
//   2. Sign in with Farcaster — the same flow as everywhere (lib/fc/siwf through /api/fc/siwf): a QR on a computer,
//      "Open in the Farcaster app" on a phone (the identity is KEPT IN THIS BROWSER first, said in one sentence, so the
//      switch to the Farcaster app and back loses nothing), and inside a Farcaster Mini App the SDK's own sign-in
//      (sdk.actions.signIn over the device's nonce; the device verifies the signature and the chain itself). The relay's
//      fid gate (D-PUBLIC-LIVE-TREE) joins the crowd right after a verified sign-in;
//      PUBLIC GO-LIVE (F3): a sign-in that will JOIN THE LIVE CROWD (the device env's ZK_ANON_UNIVERSE=live) keeps the
//      identity on this device FIRST, on every device, the Mini App included, and says so before the button: the join is
//      one place per Farcaster account, and a tab-only identity closed before it is kept loses that place (a new tab is a
//      new identity, and joining again restarts the wait for the next window). In the Mini App it also says that signing
//      in there MOVES the account's place off any other identity (the validator keeps one member per account). A join
//      recorded on the test crowd while the identity is still tab-only offers Save / keep at once (JOIN_KEEP_NOTE);
//      F4: "You're in the crowd" only when GET /api/anon shows a recorded join (availableFrom, or available); a signed-in
//      visitor the live crowd still asks to sign in gets "Sign in again with Farcaster to join the anonymous crowd"
//      (lib/onboarding/state.ts rejoinOffered, the main app's rule and words; flow.ts allows the live re-sign-in);
//      PRIV-LIVE-5: inside the Farcaster app the HOST runs this page and knows the account — said in one sentence before
//      the sign-in and the composer, with "Open in browser" (the SDK's openUrl);
//   3. write a post -> POST /api/anon {postAs: "root"} (components/anon/AnonComposer.tsx): proved in the worker, sent over
//      the web channel, relayed from @anon under the same caps, filter and terms as a Totem persona post;
//   4. recent @anon posts with Report and Share (components/anon/AnonFeed.tsx);
//   5. "Open Totem": a soft navigation to /welcome?from=anon in this same document, so the root and the sign-in come along
//      (components/anon/OpenLayersLink.tsx); inside a Mini App, Totem opens in the browser instead (separate storage).
//
// INSIDE FARCASTER: lib/miniapp/sdk.ts detects the host (only when framed or in a WebView; the SDK is never evaluated
// otherwise) and calls ready() once this first screen is drawn — before the device has booted, so the splash never
// waits on a 4 MB download. Outside a client nothing of the SDK runs.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { startDevice } from "@/components/device/loadDevice";
import { announceMoment, KEEP_TOAST, saveWithPasskey, tabOnly } from "@/components/device/SaveMoment";
import { POLL_MS, pollStep, shownSession, type SessionView } from "@/components/device/FarcasterSignIn";
import { AnonTermsLink } from "@/components/zk/AnonTermsLink";
import { AnonComposer, type AnonView } from "@/components/anon/AnonComposer";
import { AnonExplainer, offCrowd, postingOffForSite, type CrowdFacts } from "@/components/anon/AnonExplainer";
import { AnonFeed } from "@/components/anon/AnonFeed";
import { OpenLayersLink } from "@/components/anon/OpenLayersLink";
import { detectMiniApp, miniAppOpenUrl, miniAppReady, miniAppSignIn, miniAppUser, type MiniAppState } from "@/lib/miniapp/sdk";
import { MINIAPP_HOME_PATH } from "@/lib/miniapp/manifest";
import { REJOIN_LABEL, rejoinOffered } from "@/lib/onboarding/state";
import { liveUniverseHinted } from "@/lib/zk/anon/universe";
import { ZK_ANON_FLOOR } from "@/lib/zk/config";
import { ZK_TICK_EVENT } from "@/lib/device/bootState";

interface SiwfLink {
  fname: string | null;
  displayName: string | null;
  handle: string | null;
  disconnected: boolean;
}
interface SiwfView {
  available: boolean;
  code: string | null;
  reason: string | null;
  rpcHost: string | null;
  link: SiwfLink | null;
  session: SessionView | null;
  moment?: "signed-in";
}
interface DeviceLike {
  ready: Promise<unknown>;
  info?: { persistent?: boolean; restored?: boolean } | null;
  isPersistent?: () => boolean;
  persist?: () => Promise<void>;
}
const device = () => (window as unknown as { __layersDevice?: DeviceLike }).__layersDevice ?? null;

async function siwfCall(method: "GET" | "POST", body?: Record<string, unknown>): Promise<{ ok: boolean; status: number; json: Record<string, unknown> }> {
  const r = await fetch("/api/fc/siwf", method === "GET" ? { cache: "no-store" } : { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });
  const json = ((await r.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  return { ok: r.ok, status: r.status, json };
}

/** a phone (a coarse pointer): the sign-in leaves for the Farcaster app, so the identity is kept in this browser first */
function onPhone(): boolean {
  try {
    return window.matchMedia("(pointer: coarse)").matches;
  } catch {
    return false;
  }
}

export const PHONE_KEEP_NOTE = "On a phone, signing in keeps your identity in this browser first, so switching to the Farcaster app and back loses nothing.";
export const MINIAPP_SIWF_NOT_READY = "Signing in from inside Farcaster isn't ready on this site yet. Open this page in your browser to sign in.";
/** F3: said before the button whenever the sign-in will join the LIVE crowd (every device, the Mini App included) */
export const LIVE_KEEP_NOTE = "Signing in adds this identity to the crowd, so Totem first keeps it on this device: closing the page won't lose your place.";
/** F3: inside the Farcaster app, joining the live crowd moves the account's one place off any other identity */
export const MINIAPP_MOVES_PLACE =
  "Signing in here gives your Farcaster account's place in the crowd to the identity this Farcaster app keeps for the page. If you joined from a browser before, that browser loses its place, and you wait for the next 6-hour window here.";
/** F3 (at minimum): a join recorded while the identity still lives only in this tab */
export const JOIN_KEEP_NOTE = "Your place in the crowd lives only in this tab: closing it first loses the place, and joining again waits for the next window.";
/** PRIV-LIVE-5: inside the Farcaster app the host runs the page (said before the sign-in and above the composer) */
export const MINIAPP_HOST_SEES = "The Farcaster app runs this page and knows your account, so it could see what you post here. For the most privacy, open this page in a browser.";
/** PRIV-LIVE-1/4: the LIVE join, named in the disclosure before the first request (the validator checks the sign-in itself) */
export const LIVE_JOIN_DISCLOSURE = "Then Totem checks the same sign-in and records that your Farcaster account joined the crowd, with your internet address.";
/** F4: the signed-in line, with "in the crowd" only when the route shows a recorded join */
export const SIGNED_IN_JOINED = "You're in the crowd. Your account never goes on your posts.";
export const SIGNED_IN_NOT_JOINED = "Your account never goes on your posts.";

/** F4: when the composer's answer is read again after a verified sign-in (after the join's own retries: 4 s, then 15 s) */
const JOIN_REREAD_MS = [6_000, 21_000] as const;

/** F4: has GET /api/anon recorded this browser's join (a window it can post from, or posting already on)? Unknown is no. */
export function joinRecorded(view: { available?: boolean | null; availableFrom?: number | null } | null | undefined): boolean {
  return !!view && (view.available === true || (typeof view.availableFrom === "number" && Number.isFinite(view.availableFrom)));
}

/** the device env this page booted with (a page-settable global: it chooses UI, it grants nothing), else the server's */
function pageDeviceEnv(fallback: Record<string, string>): Record<string, string | undefined> {
  try {
    return (window as unknown as { __LAYERS_DEVICE_ENV?: Record<string, string | undefined> }).__LAYERS_DEVICE_ENV ?? fallback;
  } catch {
    return fallback;
  }
}

/** F3: keep the identity on this device unless it already is; THROWS a plain reason when it cannot (never fails open) */
async function keepIdentityFirst(d: DeviceLike | null): Promise<void> {
  if (!d || typeof d.persist !== "function") throw new Error("this page is still starting; try again in a moment");
  const kept = d.info?.restored === true || d.info?.persistent === true || (typeof d.isPersistent === "function" && d.isPersistent());
  if (kept) return;
  await d.persist();
}

export function AnonApp({ env, origin }: { env: Record<string, string>; origin: string }) {
  const [boot, setBoot] = useState<"booting" | "ready" | "failed">("booting");
  const [bootError, setBootError] = useState<string | null>(null);
  const [mini, setMini] = useState<MiniAppState | null>(null);
  const [siwf, setSiwf] = useState<SiwfView | null>(null);
  const [siwfError, setSiwfError] = useState<{ text: string; code: string } | null>(null);
  const [siwfNote, setSiwfNote] = useState<string | null>(null);
  const [siwfBusy, setSiwfBusy] = useState(false);
  const [approvalUrl, setApprovalUrl] = useState<string | null>(null);
  const [lapsed, setLapsed] = useState<string | null>(null);
  const finalSent = useRef<string | null>(null);
  const polling = useRef(false);
  const [view, setView] = useState<AnonView | null>(null);
  const [viewLoading, setViewLoading] = useState(false);
  const [crowd, setCrowd] = useState<CrowdFacts | null>(null);
  const [feedKey, setFeedKey] = useState(0);
  const lastReadAt = useRef(0);
  const inMiniApp = mini?.inside === true;
  /** F3: will a sign-in here join the LIVE crowd? (the device env, read once the device has booted; null until then) */
  const [joinsLive, setJoinsLive] = useState<boolean | null>(null);
  const [joinKeepBusy, setJoinKeepBusy] = useState(false);
  const [joinKeepNote, setJoinKeepNote] = useState<string | null>(null);
  const [joinKeepDone, setJoinKeepDone] = useState(false);
  const [hostNote, setHostNote] = useState<string | null>(null);

  // ---------------------------------------------------------------- inside Farcaster? (and hide its splash once drawn)
  useEffect(() => {
    let alive = true;
    void detectMiniApp().then((s) => {
      if (!alive) return;
      setMini(s);
      if (s.inside) void miniAppReady();
    });
    return () => {
      alive = false;
    };
  }, []);

  // ---------------------------------------------------------------- the device
  useEffect(() => {
    let alive = true;
    startDevice(env)
      .then(() => alive && setBoot("ready"))
      .catch((e) => {
        if (!alive) return;
        setBoot("failed");
        setBootError((e as Error).message);
        // a device that boots after the deadline is followed, not stranded (loadDevice.ts DEVICE_BOOT_DEADLINE_MS)
        device()?.ready.then(
          () => {
            if (alive) {
              setBoot("ready");
              setBootError(null);
            }
          },
          () => {}
        );
      });
    return () => {
      alive = false;
    };
  }, [env]);

  // ---------------------------------------------------------------- what the composer may do, and the crowd
  const loadView = useCallback(async () => {
    lastReadAt.current = Date.now();
    setViewLoading(true);
    try {
      let j: AnonView | null = null;
      for (let attempt = 0; attempt < 3 && !j; attempt++) {
        if (attempt) await new Promise((r) => setTimeout(r, 800 * attempt));
        const r = await fetch("/api/anon?postAs=root", { cache: "no-store" }).catch(() => null);
        const body = r ? ((await r.json().catch(() => null)) as AnonView | null) : null;
        // a 503 still carries the reason (the route's fail-closed answer): shown as it is, never as "yes"
        if (body && typeof body === "object") j = r && !r.ok ? { ...body, available: false } : body;
      }
      setView(j ?? { available: false, unavailableReason: "Whether you can post from here couldn't be read just now. Reload to try again." });
      // PUBLIC GO-LIVE (verify): posting OFF for this site (a live site before its @anon is switched on, or the kill
      // switch) says so where the crowd line goes — never the test universe's count as "posts are open"
      if (postingOffForSite(j)) setCrowd(offCrowd(j?.unavailableReason ?? null, ZK_ANON_FLOOR));
      // the crowd: the device's last check (members of the tree it proves into), with no fetch of its own
      else if (j?.mode) {
        const r = await fetch("/api/zk", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "prefetchStatus", mode: j.mode }) }).catch(() => null);
        const st = r && r.ok ? ((await r.json().catch(() => null)) as { snapshot?: { members?: unknown } | null } | null) : null;
        const members = typeof st?.snapshot?.members === "number" ? st.snapshot.members : null;
        setCrowd({ members, floor: ZK_ANON_FLOOR, availableFrom: typeof j.availableFrom === "number" ? j.availableFrom : null, unreadable: !st, checking: !!st && !st.snapshot });
      } else setCrowd({ members: null, floor: ZK_ANON_FLOOR, availableFrom: null, unreadable: true });
    } finally {
      setViewLoading(false);
    }
  }, []);

  // ---------------------------------------------------------------- Sign in with Farcaster
  // F4: the live join runs in the device right after a verified sign-in (lib/zk/anon/fcJoin.ts, fire and forget, retried at
  // 4 s and 15 s), so the composer's answer is read again once those can have landed — never left on "sign in first" until
  // the next check (ten minutes on a deployment)
  const rereads = useRef<number[]>([]);
  useEffect(
    () => () => {
      for (const t of rereads.current) window.clearTimeout(t);
    },
    []
  );
  const takeSiwf = useCallback(
    (j: Record<string, unknown>) => {
      const next = j as unknown as SiwfView;
      setSiwf(next);
      if (next.moment === "signed-in") {
        announceMoment("signed-in");
        void loadView();
        for (const t of rereads.current) window.clearTimeout(t);
        rereads.current = [JOIN_REREAD_MS[0], JOIN_REREAD_MS[1]].map((ms) => window.setTimeout(() => void loadView(), ms));
      }
      return next;
    },
    [loadView]
  );
  const loadSiwf = useCallback(async () => {
    const r = await siwfCall("GET").catch(() => null);
    if (!r || !r.ok) {
      setSiwfError({ text: String(r?.json?.error ?? "Couldn't read Sign in with Farcaster just now."), code: String(r?.json?.code ?? "unreachable") });
      return;
    }
    setSiwfError(null);
    takeSiwf(r.json);
  }, [takeSiwf]);

  useEffect(() => {
    if (boot !== "ready") return;
    setJoinsLive(liveUniverseHinted(pageDeviceEnv(env)));
    void loadSiwf();
    void loadView();
  }, [boot, loadSiwf, loadView, env]);

  // the composer's answer and the crowd follow the device's checks: after a check lands (the device announces it, with no
  // value: lib/device/bootState.ts ZK_TICK_EVENT) the page reads again — at most once every 15 s — and once more just after
  // the moment a fresh member's first window opens, so "you can post from 14:00" turns into the Post button by itself
  useEffect(() => {
    if (boot !== "ready") return;
    const onTick = () => {
      if (Date.now() - lastReadAt.current < 15_000) return;
      void loadView();
    };
    window.addEventListener(ZK_TICK_EVENT, onTick);
    return () => window.removeEventListener(ZK_TICK_EVENT, onTick);
  }, [boot, loadView]);
  useEffect(() => {
    const at = view?.availableFrom;
    if (typeof at !== "number" || !Number.isFinite(at)) return;
    const wait = at - Date.now() + 3000;
    if (wait <= 0 || wait > 7 * 3_600_000) return;
    const timer = window.setTimeout(() => void loadView(), wait);
    return () => window.clearTimeout(timer);
  }, [view?.availableFrom, loadView]);

  const raw = siwf?.session ?? null;
  const session = useMemo(() => (raw && lapsed === raw.id ? shownSession(raw, Date.now()) : raw), [raw, lapsed]);
  const open = !!session && (session.stage === "pending" || session.stage === "checking");

  // the phone button's link: asked for once per request (it carries the relay's channel token)
  useEffect(() => {
    setApprovalUrl(null);
    if (!session || session.stage !== "pending" || !session.approval) return;
    let alive = true;
    void siwfCall("POST", { action: "approval", sessionId: session.id }).then((r) => {
      if (alive && r.ok && typeof r.json.url === "string") setApprovalUrl(r.json.url);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id, session?.stage]);

  // poll every 1.5 s while visible; past the deadline ONE final poll, then the request is shown expired (FarcasterSignIn's rule)
  useEffect(() => {
    if (!open || !session) return;
    const pollOnce = async () => {
      if (polling.current) return;
      polling.current = true;
      try {
        const r = await siwfCall("POST", { action: "poll", sessionId: session.id });
        if (r.ok) takeSiwf(r.json);
        else if (r.json.code === "no_session") await loadSiwf();
      } catch {
        /* the next tick tries again */
      } finally {
        polling.current = false;
      }
    };
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
  }, [open, session, takeSiwf, loadSiwf]);

  const act = async (body: Record<string, unknown>) => {
    setSiwfBusy(true);
    setSiwfError(null);
    try {
      const r = await siwfCall("POST", body);
      if (!r.ok) {
        setSiwfError({ text: String(r.json.error ?? "That did not work."), code: String(r.json.code ?? "error") });
        return null;
      }
      return takeSiwf(r.json);
    } catch {
      setSiwfError({ text: "That request could not be made. Try again.", code: "unreachable" });
      return null;
    } finally {
      setSiwfBusy(false);
    }
  };

  /**
   * F3: keep the identity on this device BEFORE a sign-in that will join the LIVE crowd (every device, the Mini App
   * included), or that leaves for the Farcaster app (a phone, outside the Mini App). Read at the click, from the device
   * env this tab booted with. false (and a plain error, nothing sent) when it cannot be kept: never a sign-in that could
   * lose its place.
   */
  const keepBeforeSignIn = async (where: "relay" | "miniapp"): Promise<boolean> => {
    const live = liveUniverseHinted(pageDeviceEnv(env));
    const phone = where === "relay" && onPhone();
    if (!live && !phone) return true;
    try {
      await keepIdentityFirst(device());
      return true;
    } catch (e) {
      const why = live ? "before joining the crowd" : "before leaving for the Farcaster app";
      setSiwfError({ text: "Couldn't keep your identity on this device " + why + " (" + (e as Error).message + "). Nothing was sent.", code: "persist" });
      return false;
    }
  };

  /** the relay flow (a QR, or the Farcaster app on a phone); kept first when it joins the live crowd or leaves for the app */
  const startSignIn = async () => {
    setSiwfNote(null);
    setSiwfError(null);
    if (!(await keepBeforeSignIn("relay"))) return;
    await act({ action: "start" });
  };

  /** inside a Farcaster Mini App: the host signs over the device's nonce; the device verifies it like a relay completion */
  const startMiniAppSignIn = async () => {
    setSiwfNote(null);
    setSiwfError(null);
    if (!(await keepBeforeSignIn("miniapp"))) return;
    setSiwfBusy(true);
    try {
      const s = await siwfCall("POST", { action: "miniappStart" });
      if (!s.ok) {
        if (s.json.code === "bad_request") setSiwfNote(MINIAPP_SIWF_NOT_READY);
        else setSiwfError({ text: String(s.json.error ?? "That did not work."), code: String(s.json.code ?? "error") });
        return;
      }
      const sessionId = typeof s.json.sessionId === "string" ? s.json.sessionId : "";
      const nonce = typeof s.json.nonce === "string" ? s.json.nonce : "";
      const expirationTime = typeof s.json.expirationTime === "string" ? s.json.expirationTime : undefined;
      if (!sessionId || !nonce) {
        setSiwfNote(MINIAPP_SIWF_NOT_READY);
        return;
      }
      const signed = await miniAppSignIn(nonce, expirationTime);
      if (!signed) {
        setSiwfError({ text: "Farcaster didn't answer the sign-in. Try again.", code: "miniapp" });
        void siwfCall("POST", { action: "cancel", sessionId });
        return;
      }
      if ("rejected" in signed) {
        setSiwfNote("Sign-in cancelled. Nothing was saved.");
        void siwfCall("POST", { action: "cancel", sessionId });
        return;
      }
      const user = await miniAppUser();
      const f = await siwfCall("POST", {
        action: "miniappFinish",
        sessionId,
        message: signed.message,
        signature: signed.signature,
        ...(signed.authMethod ? { authMethod: signed.authMethod } : {}),
        ...(user ? { profile: { fid: user.fid, username: user.username, displayName: user.displayName, pfpUrl: user.pfpUrl } } : {}),
      });
      if (!f.ok) setSiwfError({ text: String(f.json.error ?? "That did not work."), code: String(f.json.code ?? "error") });
      else takeSiwf(f.json);
    } finally {
      setSiwfBusy(false);
    }
  };

  const link = siwf?.link ?? null;
  const signedIn = !!link && !link.disconnected;
  const name = link ? "@" + (link.fname ?? link.handle ?? "your account") : "";
  const ownNames = useMemo(() => [link?.fname, link?.handle].filter((x): x is string => typeof x === "string" && x.length > 0), [link?.fname, link?.handle]);
  const siwfOff = !!siwf && !siwf.available;
  const showComposer = boot === "ready" && (signedIn || siwfOff);
  // F4: "in the crowd" only on a recorded join; the live crowd asking a signed-in visitor to sign in offers a re-sign-in
  const joined = joinRecorded(view);
  const rejoin = boot === "ready" && rejoinOffered({ hinted: joinsLive === true, signedIn, answer: view });
  // F3 (at minimum): a join recorded (a window to post from) while the identity still lives only in this tab
  const showJoinKeep = boot === "ready" && signedIn && !joinKeepDone && typeof view?.availableFrom === "number" && tabOnly();
  // F3: before a sign-in that joins the live crowd, the identity is kept first (said before the button, unless it is kept)
  const keepNote = joinsLive === true && tabOnly() ? LIVE_KEEP_NOTE : null;

  const saveJoin = async () => {
    setJoinKeepBusy(true);
    setJoinKeepNote(null);
    try {
      setJoinKeepNote(await saveWithPasskey());
      setJoinKeepDone(true);
    } catch (e) {
      setJoinKeepNote("Not saved: " + (e as Error).message);
    } finally {
      setJoinKeepBusy(false);
    }
  };
  const keepJoin = async () => {
    setJoinKeepBusy(true);
    setJoinKeepNote(null);
    try {
      await keepIdentityFirst(device());
      setJoinKeepNote(KEEP_TOAST);
      setJoinKeepDone(true);
    } catch (e) {
      setJoinKeepNote("Not kept: " + (e as Error).message);
    } finally {
      setJoinKeepBusy(false);
    }
  };
  /** PRIV-LIVE-5: leave the Farcaster app's page for the browser (the SDK's openUrl) */
  const openInBrowser = async () => {
    setHostNote(null);
    const ok = await miniAppOpenUrl(origin + MINIAPP_HOME_PATH);
    if (!ok) setHostNote("The browser didn't open. Open " + origin + MINIAPP_HOME_PATH + " in your browser.");
  };

  const sessionText = (() => {
    if (!session) return null;
    if (session.stage === "pending") return session.code === "siwf_relay" ? "Couldn't check the request just now. Still trying." : "Waiting for you to approve in the Farcaster app…";
    if (session.stage === "checking") return session.note ?? "Checking your account…";
    if (session.stage === "verified") return null;
    return session.note;
  })();

  // what the sign-in shows to whom, before the first request (PRIV-LIVE-1/4: the LIVE join is named; "Totem's server sees
  // nothing" only where it holds — the preview, whose sign-in stays in this browser)
  const disclosure = siwf
    ? (inMiniApp
        ? "Farcaster asks you to approve the sign-in. Your browser then checks the account on the Optimism blockchain through " + (siwf.rpcHost ?? "a blockchain node") + ", which sees your internet address."
        : "Farcaster's sign-in service will see that you signed in to Totem, and your internet address. Your browser then checks the account on the Optimism blockchain through " +
          (siwf.rpcHost ?? "a blockchain node") +
          ", which sees your internet address too.") + (joinsLive === true ? " " + LIVE_JOIN_DISCLOSURE : inMiniApp ? "" : " Totem's server sees nothing.")
    : "";

  /** the words said before a sign-in button: the keep (F3) and, inside the Farcaster app on the live crowd, the move (F3) */
  const beforeButton = (
    <>
      {keepNote ? (
        <p data-testid="anon-keep-note" className="text-[13px] leading-4 text-x-sec">
          {keepNote}
        </p>
      ) : !inMiniApp ? (
        <p data-testid="anon-phone-note" className="text-[13px] leading-4 text-x-sec">
          {PHONE_KEEP_NOTE}
        </p>
      ) : null}
      {inMiniApp && joinsLive === true ? (
        <p data-testid="anon-miniapp-moves" className="text-[13px] leading-4 text-x-sec">
          {MINIAPP_MOVES_PLACE}
        </p>
      ) : null}
    </>
  );

  /** an open sign-in request (the QR, the phone link, its status) and a refused or expired one: the same in both branches */
  const sessionBlock = (
    <>
      {open && session ? (
        <div className="grid justify-items-start gap-2">
          {session.approval ? (
            <>
              <p className="text-[13px] text-x-sec">Scan this with your phone&rsquo;s camera, then approve in the Farcaster app.</p>
              <svg
                data-testid="anon-siwf-qr"
                viewBox={"0 0 " + session.approval.qr.viewBox + " " + session.approval.qr.viewBox}
                width={200}
                height={200}
                role="img"
                aria-label="Sign-in QR code"
                className="rounded-lg bg-white"
                shapeRendering="crispEdges"
              >
                <path d={session.approval.qr.path} fill="#000" />
              </svg>
              {approvalUrl ? (
                <a data-testid="anon-siwf-open-app" href={approvalUrl} target="_blank" rel="noopener noreferrer" className="inline-flex h-9 items-center rounded-full border border-x-border-dark px-4 text-[15px] font-bold">
                  On this phone? Open in the Farcaster app
                </a>
              ) : null}
            </>
          ) : null}
          <p data-testid="anon-siwf-session" data-stage={session.stage} data-code={session.code ?? ""} aria-live="polite" className="text-[13px] text-x-sec">
            {sessionText}
          </p>
          <button type="button" data-testid="anon-siwf-cancel" disabled={siwfBusy} onClick={() => void act({ action: "cancel", sessionId: session.id })} className="text-[13px] text-x-sec hover:underline">
            Cancel
          </button>
        </div>
      ) : null}
      {session && (session.stage === "refused" || session.stage === "expired") ? (
        <p data-testid="anon-siwf-error" data-code={session.code ?? ""} role="alert" className="text-[13px] text-[#f4212e]">
          {session.note}
        </p>
      ) : null}
    </>
  );

  return (
    <main data-testid="anon-app" data-boot={boot} data-miniapp={mini ? (inMiniApp ? "inside" : "outside") : "checking"} className="mx-auto flex w-full max-w-[600px] flex-col gap-3 px-4 py-4">
      <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-[17px] font-extrabold">Anon Wire</span>
        <AnonTermsLink />
      </header>

      <AnonExplainer crowd={crowd} previewOnly={view?.previewOnly === true} liveJoin={joinsLive} />

      {/* PRIV-LIVE-5: inside the Farcaster app, before the sign-in and above the composer */}
      {inMiniApp ? (
        <section data-testid="anon-miniapp-host-note" className="rounded-2xl border border-x-border-dark p-4">
          <p className="text-[13px] leading-4 text-x-sec">{MINIAPP_HOST_SEES}</p>
          <button
            type="button"
            data-testid="anon-open-browser"
            onClick={() => void openInBrowser()}
            className="mt-2 h-8 rounded-full border border-x-border-dark px-4 text-[13px] font-bold hover:bg-x-hover"
          >
            Open in browser
          </button>
          {hostNote ? (
            <p role="alert" className="mt-2 text-[13px] text-[#f4212e]">
              {hostNote}
            </p>
          ) : null}
        </section>
      ) : null}

      {boot === "booting" ? (
        <p data-testid="anon-boot" className="text-[13px] text-x-sec">
          Starting… the first visit downloads about 5 MB, so this can take a moment.
        </p>
      ) : null}
      {boot === "failed" ? (
        <div data-testid="anon-boot-failed" role="alert" className="rounded-2xl border border-x-border-dark p-4 text-[15px]">
          <p className="text-[#f4212e]">This page couldn&rsquo;t start ({bootError ?? "unknown reason"}).</p>
          <button type="button" onClick={() => window.location.reload()} className="mt-2 font-bold text-x-blue hover:underline">
            Reload
          </button>
        </div>
      ) : null}

      {boot === "ready" ? (
        <section data-testid="anon-signin" data-state={siwfOff ? "unavailable" : signedIn ? "signed-in" : open ? "pending" : siwf ? "signed-out" : "loading"} className="rounded-2xl border border-x-border-dark p-4">
          {siwfOff ? (
            <p data-testid="anon-signin-unavailable" data-code={siwf?.code ?? ""} className="text-[13px] leading-4 text-x-sec">
              {siwf?.reason}
            </p>
          ) : signedIn ? (
            <div className="grid gap-2">
              <p data-testid="anon-signed-in" data-joined={joined ? "yes" : "no"} className="text-[15px] leading-5">
                Signed in as <span className="font-bold">{name}</span>. {joined ? SIGNED_IN_JOINED : SIGNED_IN_NOT_JOINED}
              </p>
              {rejoin && !open ? (
                <>
                  <p data-testid="anon-siwf-disclosure" className="text-[13px] leading-4 text-x-sec">
                    {disclosure}
                  </p>
                  {beforeButton}
                  <div>
                    <button
                      type="button"
                      data-testid="anon-rejoin"
                      data-mode={inMiniApp ? "miniapp" : "relay"}
                      disabled={siwfBusy}
                      onClick={() => void (inMiniApp ? startMiniAppSignIn() : startSignIn())}
                      className="h-9 rounded-full bg-x-black-btn px-4 text-[15px] font-bold text-white hover:bg-x-black-btn-hover disabled:opacity-50"
                    >
                      {REJOIN_LABEL}
                    </button>
                  </div>
                </>
              ) : null}
              {showJoinKeep ? (
                <p data-testid="anon-join-keep" className="text-[13px] leading-4 text-x-sec">
                  {JOIN_KEEP_NOTE}{" "}
                  <button type="button" data-testid="anon-join-save" disabled={joinKeepBusy} onClick={() => void saveJoin()} className="font-bold text-x-blue hover:underline">
                    Save with a passkey
                  </button>{" "}
                  or{" "}
                  <button type="button" data-testid="anon-join-keep-browser" disabled={joinKeepBusy} onClick={() => void keepJoin()} className="font-bold text-x-blue hover:underline">
                    keep it in this browser
                  </button>
                  .
                </p>
              ) : null}
              {joinKeepNote ? (
                <p data-testid="anon-join-keep-note" className="text-[13px] leading-4 text-x-sec">
                  {joinKeepNote}
                </p>
              ) : null}
              {sessionBlock}
            </div>
          ) : siwf ? (
            <div className="grid gap-2">
              <p className="text-[15px] font-bold">Sign in with Farcaster to post</p>
              <p className="text-[13px] leading-4 text-x-sec">
                Your sign-in is how you join the crowd. It never goes on your posts.
                {link?.disconnected ? " This browser was signed in before: only that same Farcaster account can sign in here again." : ""}
              </p>
              {!open ? (
                <>
                  <p data-testid="anon-siwf-disclosure" className="text-[13px] leading-4 text-x-sec">
                    {disclosure}
                  </p>
                  {beforeButton}
                  <div>
                    <button
                      type="button"
                      data-testid="anon-siwf-start"
                      data-mode={inMiniApp ? "miniapp" : "relay"}
                      disabled={siwfBusy}
                      onClick={() => void (inMiniApp ? startMiniAppSignIn() : startSignIn())}
                      className="h-9 rounded-full bg-x-black-btn px-4 text-[15px] font-bold text-white hover:bg-x-black-btn-hover disabled:opacity-50"
                    >
                      {link?.disconnected ? "Sign in again with Farcaster" : "Sign in with Farcaster"}
                    </button>
                  </div>
                </>
              ) : null}
              {sessionBlock}
            </div>
          ) : (
            <p className="text-[13px] text-x-sec">Checking Sign in with Farcaster…</p>
          )}
          {siwfNote ? (
            <p data-testid="anon-siwf-note" className="mt-2 text-[13px] leading-4 text-x-sec">
              {siwfNote}
            </p>
          ) : null}
          {siwfError ? (
            <div data-testid="anon-siwf-error" data-code={siwfError.code} role="alert" className="mt-2 text-[13px] text-[#f4212e]">
              {siwfError.text}
              {!siwf ? (
                <button type="button" data-testid="anon-siwf-retry" onClick={() => void loadSiwf()} className="ml-2 font-bold text-x-blue hover:underline">
                  Try again
                </button>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      {showComposer ? (
        <AnonComposer view={view} loading={viewLoading} onReload={loadView} ownNames={ownNames} origin={origin} inMiniApp={inMiniApp} onPosted={() => setFeedKey((k) => k + 1)} />
      ) : null}

      {boot === "ready" ? <AnonFeed origin={origin} inMiniApp={inMiniApp} refreshKey={feedKey} previewOnly={view?.previewOnly === true} /> : null}

      <OpenLayersLink inMiniApp={inMiniApp} origin={origin} />
    </main>
  );
}
