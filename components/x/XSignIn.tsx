"use client";
// SIGN IN WITH X (2026-11-06) — the "Continue with X" card (lib/x/signin/flow.ts is the flow; SECURITY-POSTURE.md §38).
//
// Honest copy first: signing in shows which X account is yours; it does NOT save the identity (a passkey does). The
// disclosure — who sees what — is on the card BEFORE the first request: nothing is sent until the visitor presses
// "Continue with X". Then, in this order: the identity is KEPT in this browser (x.com opens in this tab and replaces this
// page, so an identity that lived only in this tab would be gone — the phone case of Sign in with Farcaster, every time
// here), the device draws the PKCE verifier and state into this tab's sessionStorage, and the tab goes to X. A keep that
// fails stops the sign-in with the reason (never fail open).
//
// DORMANT: while the site carries no X app (no X_CLIENT_ID), the device answers xsi_dormant and the card is exactly the
// button the first run always showed: "Continue with X", disabled, marked Soon. Every answer is the device's fixed sentence;
// nothing here ever shows a code, a verifier, a state or a token (the tab never holds a token at all).
import { useCallback, useEffect, useState } from "react";
import { keepBeforeAppSwitch } from "@/components/device/FarcasterSignIn";
import { mediaHostAllowed } from "@/components/CastCard";
import { XLogo } from "@/components/icons";

/** the card's words before the first request (SECURITY-POSTURE.md §38 quotes them) */
export const X_SIGNIN_DISCLOSURE =
  "X will see that you're signing in to Totem, and your internet address. X opens in this tab, so Totem first keeps your identity in this browser. When you come back, Totem's server sees only that this browser returned from X. Totem's validator then trades X's one-time code for your public X profile, keeps nothing and logs nothing: it is the one Totem server that sees which X account signed in.";
/** what the card promises about personas (the separation rule, said where it applies) */
export const X_SIGNIN_NO_PERSONA = "This is your own account, never a persona: no persona is involved, and X is not told about any.";
export const X_DISCONNECT_LABEL = "Type DISCONNECT to confirm";

interface XLinkView {
  username: string;
  name: string | null;
  pfpUrl: string | null;
  handle: string | null;
  disconnected: boolean;
}
interface XStatusView {
  available: boolean;
  code: string | null;
  reason: string | null;
  authorizeHost: string | null;
  relayHost: string | null;
  link: XLinkView | null;
  pending: boolean;
}

interface KeepDevice {
  info?: { restored?: boolean; persistent?: boolean } | null;
  isPersistent?: () => boolean;
  persist?: () => Promise<void>;
}

async function call(method: "GET" | "POST", body?: Record<string, unknown>): Promise<{ ok: boolean; json: Record<string, unknown> }> {
  const r = await fetch("/api/x/signin", method === "GET" ? { cache: "no-store" } : { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });
  const json = ((await r.json().catch(() => null)) ?? {}) as Record<string, unknown>;
  return { ok: r.ok, json };
}

/** the authorize URL the device answered, checked once more before the tab leaves: X's own page, or a loopback stub */
export function safeAuthorizeUrl(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 4096) return null;
  try {
    const u = new URL(raw);
    if (u.username || u.password) return null;
    if (u.protocol === "https:" && u.hostname === "x.com" && u.pathname === "/i/oauth2/authorize") return u.toString();
    const loop = u.hostname === "127.0.0.1" || u.hostname === "localhost" || u.hostname === "[::1]";
    if ((u.protocol === "http:" || u.protocol === "https:") && loop && u.pathname === "/i/oauth2/authorize") return u.toString();
  } catch {
    return null;
  }
  return null;
}

export function XSignIn({ onChange }: { onChange?: () => void }) {
  const [status, setStatus] = useState<XStatusView | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState("");
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    setReadError(null);
    call("GET").then(
      ({ ok, json }) => {
        if (!alive) return;
        if (!ok) return setReadError(typeof json.error === "string" ? json.error : "your X sign-in could not be checked");
        setStatus(json as unknown as XStatusView);
      },
      () => alive && setReadError("the request could not be made")
    );
    return () => {
      alive = false;
    };
  }, [tick]);

  const start = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const d = (window as unknown as { __layersDevice?: KeepDevice }).__layersDevice;
      // x.com replaces this page: keep the identity in this browser FIRST (it THROWS a plain reason when it cannot)
      await keepBeforeAppSwitch(d);
      const { ok, json } = await call("POST", { action: "start" });
      if (!ok) throw new Error(typeof json.error === "string" ? json.error : "the sign-in did not start");
      const url = safeAuthorizeUrl(json.authorizeUrl);
      if (!url) throw new Error("The sign-in link pointed somewhere unexpected, so Totem did not open it. Nothing was saved.");
      window.location.assign(url);
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
      setBusy(false);
    }
  }, []);

  const disconnect = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const { ok, json } = await call("POST", { action: "disconnect", confirm });
      if (!ok) throw new Error(typeof json.error === "string" ? json.error : "it was not disconnected");
      setStatus(json as unknown as XStatusView);
      setConfirm("");
      onChange?.();
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  }, [confirm, onChange]);

  const soon = (
    <button
      type="button"
      data-testid="xsi-soon"
      disabled
      className="inline-flex h-11 items-center justify-center gap-2 rounded-full border border-x-border-dark bg-white px-5 text-[16px] font-bold text-x-text opacity-60"
    >
      Continue with X
      <span className="rounded-full bg-x-pill px-2 py-0.5 text-[12px] font-bold text-x-sec">Soon</span>
    </button>
  );

  if (readError) {
    return (
      <div data-testid="xsi-card" data-state="error" className="rounded-2xl border border-x-border bg-white p-4 text-x-text">
        <p role="alert" className="text-[14px] text-[#f4212e]">
          Couldn&apos;t check Sign in with X: {readError}.
        </p>
        <button type="button" data-testid="xsi-retry" onClick={() => setTick((t) => t + 1)} className="mt-2 text-[14px] font-bold text-x-blue hover:underline">
          Try again
        </button>
      </div>
    );
  }
  if (!status) {
    return (
      <div data-testid="xsi-card" data-state="loading" className="rounded-2xl border border-x-border bg-white p-4 text-[14px] text-x-sec">
        Checking Sign in with X…
      </div>
    );
  }
  if (!status.available) {
    return (
      <div data-testid="xsi-card" data-state={status.code === "xsi_dormant" ? "dormant" : "unavailable"} data-code={status.code ?? ""} className="grid gap-2">
        {soon}
        {status.code !== "xsi_dormant" && status.reason ? <p className="text-[13px] leading-4 text-x-sec">{status.reason}</p> : null}
      </div>
    );
  }
  const link = status.link;
  const pic = link?.pfpUrl && mediaHostAllowed(link.pfpUrl) ? link.pfpUrl : null;
  return (
    <div data-testid="xsi-card" data-state={link ? (link.disconnected ? "disconnected" : "signed-in") : "ready"} className="rounded-2xl border border-x-border bg-white p-4 text-x-text">
      {link && !link.disconnected ? (
        <>
          <div className="flex items-center gap-3">
            {pic ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={pic} alt="" referrerPolicy="no-referrer" className="h-10 w-10 rounded-full object-cover" />
            ) : (
              <span aria-hidden className="h-10 w-10 shrink-0 rounded-full bg-x-pill" />
            )}
            <p data-testid="xsi-signed-in" className="min-w-0 flex-1 text-[15px] leading-5">
              Signed in with X as <span className="font-bold">@{link.username}</span>
              {link.name ? <span className="text-x-sec"> · {link.name}</span> : null}
            </p>
          </div>
          <p className="mt-2 text-[13px] leading-4 text-x-sec">{X_SIGNIN_NO_PERSONA}</p>
          <details className="mt-3">
            <summary className="cursor-pointer text-[14px] font-bold text-x-sec">Disconnect X</summary>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input
                data-testid="xsi-disconnect-confirm"
                aria-label={X_DISCONNECT_LABEL}
                placeholder="DISCONNECT"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="w-36 rounded-md border border-[#cfd9de] px-2 py-1 text-[15px]"
              />
              <button type="button" data-testid="xsi-disconnect" disabled={busy || confirm !== "DISCONNECT"} onClick={() => void disconnect()} className="inline-flex h-9 items-center rounded-full border border-x-border-dark px-4 text-[14px] font-bold disabled:opacity-50">
                Disconnect
              </button>
            </div>
            <p className="mt-1 text-[12px] leading-4 text-x-sec">Your profile stays; only this same X account can sign in here again.</p>
          </details>
        </>
      ) : (
        <>
          {link?.disconnected ? (
            <p data-testid="xsi-disconnected" className="mb-2 text-[14px] leading-5 text-x-sec">
              @{link.username} is disconnected. Only this same X account can sign in here again.
            </p>
          ) : null}
          <p data-testid="xsi-disclosure" className="text-[13px] leading-4 text-x-sec">
            {X_SIGNIN_DISCLOSURE}
          </p>
          <p className="mt-1 text-[13px] leading-4 text-x-sec">{X_SIGNIN_NO_PERSONA}</p>
          <button
            type="button"
            data-testid="xsi-start"
            disabled={busy}
            onClick={() => void start()}
            className="mt-3 inline-flex h-11 items-center justify-center gap-2 rounded-full border border-x-border-dark bg-white px-5 text-[16px] font-bold text-x-text hover:bg-x-hover disabled:opacity-50"
          >
            <XLogo size={18} />
            {busy ? "Opening X…" : "Continue with X"}
          </button>
        </>
      )}
      {error ? (
        <p data-testid="xsi-error" role="alert" className="mt-3 text-[14px] text-[#f4212e]">
          {error}
        </p>
      ) : null}
    </div>
  );
}
