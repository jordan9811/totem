"use client";
// CONNECT MAIN — Settings › Connect your Farcaster account (owner service). The owner types his username, scans the QR
// (or taps the button on his phone), approves in the Farcaster app. The page polls the request, then finishes it: the
// server reads the approval back from the chain and records the account (lib/fc/connect.ts).
//
// Honesty rules for this page: it never says "connected" before the server recorded it; every refusal is shown as the
// server said it; the connector-account requirement and its cost are stated plainly when it is missing.
//
// CONNECT MAIN review:
//   UXC-01  with no connector configured this page cannot be completed — it says so FIRST ("not available on this
//           service yet"), and "No seed phrase" is only said where it is true (a configured connector); setting one
//           up today means creating an account and handling its private key yourself
//   UXC-02  a key the owner removed in the Farcaster app is shown as removed (the server asks Farcaster on every read)
//   UXC-09  a poll the server could not answer, and a save that kept failing, are said out loud (with a retry)
//   UXC-10  declining in the Farcaster app is never reported back — the pending card says what to do instead
//
// CONNECTOR SETUP (lib/fc/connector.server.ts): the connector account is created and kept by the owner service, so
// the "not available" state no longer tells the owner to handle a private key. It says what to run
// (scripts\owner\arm-connector.ps1) and, once a sealed connector exists, where that setup stands (its stage, the
// address to fund with the exact sentence the script prints, the fid once registered). Nothing here changes the
// connect flow itself; it reads `status.connector.source` and `status.connector.setup`.
import { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "@/components/Providers";
import type { ConnectSessionView, ConnectStatusView } from "@/lib/fc/connect";

type ApiError = { error?: string; code?: string; retryable?: boolean };

async function call(method: "GET" | "POST", body?: Record<string, unknown>): Promise<{ ok: boolean; status: number; data: ConnectStatusView & ApiError }> {
  const res = await fetch("/api/fc/connect", {
    method,
    cache: "no-store",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = (await res.json().catch(() => ({ error: `HTTP ${res.status}` }))) as ConnectStatusView & ApiError;
  return { ok: res.ok, status: res.status, data };
}

const POLL_MS = 3000;
const FINISH_RETRY_MS = 4000;
const FINISH_MAX_TRIES = 20;

function timeOf(unixSeconds: number): string {
  try {
    return new Date(unixSeconds * 1000).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  } catch {
    return "";
  }
}

export function ConnectMainAccount({ initial = null }: { initial?: ConnectStatusView | null }) {
  const { refresh } = useApp();
  // the server's first answer (the page reads it while rendering), so there is no loading flash; the island re-reads it
  const [status, setStatus] = useState<ConnectStatusView | null>(initial);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [handle, setHandle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [finishing, setFinishing] = useState<string | null>(null);
  const [confirm, setConfirm] = useState("");
  const [finishRound, setFinishRound] = useState(0);
  // UXC-09: the last poll could not be answered (the request may still be waiting — the page keeps asking)
  const [pollTrouble, setPollTrouble] = useState<string | null>(null);
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    try {
      const r = await call("GET");
      if (!r.ok) throw new Error(r.data.error ?? `HTTP ${r.status}`);
      setStatus(r.data);
      setLoadError(null);
    } catch (e) {
      setLoadError((e as Error).message || "Couldn't load the connection status.");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const act = useCallback(async (body: Record<string, unknown>): Promise<boolean> => {
    setBusy(true);
    setError(null);
    try {
      const r = await call("POST", body);
      if (!r.ok) {
        setError(r.data.error ?? `HTTP ${r.status}`);
        return false;
      }
      setStatus(r.data);
      return true;
    } catch (e) {
      setError((e as Error).message || "The request failed.");
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  const session: ConnectSessionView | null = status?.session ?? null;
  const sessionId = session?.id ?? null;
  const stage = session?.stage ?? null;

  // POLL while the request waits for approval (paused while the tab is hidden — nothing to see, nothing to spend)
  useEffect(() => {
    if (!sessionId || stage !== "pending_approval") return;
    let stopped = false;
    const tick = async () => {
      if (stopped || inFlight.current || (typeof document !== "undefined" && document.hidden)) return;
      inFlight.current = true;
      try {
        const r = await call("POST", { action: "poll", sessionId });
        if (stopped) return;
        if (r.ok) {
          setStatus(r.data);
          setPollTrouble(null);
        } else if (r.status === 404) {
          setPollTrouble(null);
          load();
        } else {
          // UXC-09: never "waiting for your approval" while the server cannot actually check it
          setPollTrouble(`Couldn't check the request just now (${r.data.error ?? `HTTP ${r.status}`}) — still trying.`);
        }
      } catch {
        if (!stopped) setPollTrouble("Couldn't reach this service to check the request — still trying.");
      } finally {
        inFlight.current = false;
      }
    };
    const timer = setInterval(tick, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [sessionId, stage, load]);

  // FINISH once approved: the server re-reads the approval and the chain; "not onchain yet" is retried a while
  useEffect(() => {
    if (!sessionId || stage !== "approved") return;
    let stopped = false;
    let tries = 0;
    const attempt = async () => {
      if (stopped) return;
      tries++;
      setFinishing("Approved. Checking the chain and saving your account…");
      try {
        const r = await call("POST", { action: "finish", sessionId });
        if (stopped) return;
        if (r.ok) {
          setFinishing(null);
          setStatus(r.data);
          refresh();
          return;
        }
        if (r.data.retryable && tries < FINISH_MAX_TRIES) {
          setFinishing((r.data.error ?? "Not finished yet.") + " (trying again)");
          setTimeout(attempt, FINISH_RETRY_MS);
          return;
        }
        setFinishing(null);
        setError(r.data.error ?? `HTTP ${r.status}`);
        load();
      } catch {
        if (stopped) return;
        if (tries < FINISH_MAX_TRIES) setTimeout(attempt, FINISH_RETRY_MS);
        else {
          // UXC-09: the last attempt failed too — stop saying "checking", say why, and offer the retry button
          setFinishing(null);
          setError("Couldn't reach this service to save your account. Your approval is still valid — try saving again.");
        }
      }
    };
    setError(null);
    attempt();
    return () => {
      stopped = true;
    };
  }, [sessionId, stage, load, refresh, finishRound]);

  if (loadError && !status)
    return (
      <p data-testid="connect-error" role="alert" className="px-4 py-4 text-[15px] text-[#f4212e]">
        {loadError}
      </p>
    );
  if (!status) return <p className="px-4 py-4 text-[15px] text-x-sec">Loading…</p>;

  if (!status.available)
    return (
      <div data-testid="connect-unavailable" data-code={status.code ?? ""} className="mx-4 my-4 rounded-2xl border border-x-border p-4">
        <p className="text-[15px] font-bold leading-5">Not available here</p>
        <p className="mt-1 text-[15px] leading-5 text-x-sec">{status.reason}</p>
      </div>
    );

  const connected = status.connected;
  const connector = status.connector;
  const stopped = stage === "wrong_account" || stage === "revoked" || stage === "expired" || stage === "refused";
  const showForm = !session || stopped;
  // UXC-01: without a connector account nothing on this page can be completed — that comes first, in plain words
  const blocked = !!connector && !connector.configured && (!connected || connected.disconnected);
  // CONNECTOR SETUP: the sealed connector's public state, when the owner service has started creating one
  const setup = connector?.setup ?? null;
  const setupLine =
    setup === null
      ? null
      : setup.stage === "registering"
        ? "Its registration transaction is waiting to be mined. Run the script again; it keeps checking until the account exists."
        : setup.fid
          ? `It is registered as fid ${setup.fid}${setup.fname ? ` (@${setup.fname})` : ", with no name yet"}.`
          : `It is created and not registered yet. Send about 0.0005 ETH on Optimism to ${setup.address} from an exchange withdrawal (never from the Neynar wallet, your main wallet or a persona), then run the script again and type REGISTER.`;

  return (
    <div data-testid="connect-main" data-mode={status.mode ?? ""} className="pb-8">
      {blocked ? (
        <div data-testid="connect-intro" data-available="false" className="mx-4 mt-4 rounded-2xl bg-[#fff8e1] px-4 py-3">
          <p className="text-[15px] font-bold leading-5">Connecting your main account isn&rsquo;t set up on this service yet.</p>
          <p className="mt-1 text-[15px] leading-5">
            It needs a connector account: a small Farcaster account of its own that nothing else uses. Totem creates and keeps it
            for you on this service; you never see or type a key. Your personas can still get their own Farcaster accounts and
            post as them.
          </p>
        </div>
      ) : (
        <p data-testid="connect-intro" data-available="true" className="px-4 pt-4 text-[15px] leading-5">
          Post as your own Farcaster account from Totem. You approve it once in the Farcaster app, with no seed phrase.
        </p>
      )}
      {status.mode === "fixture" && (
        <p data-testid="connect-fixture-note" className="px-4 pt-2 text-[13px] leading-4 text-x-sec">
          Test rig: this runs against a simulated network. Nothing reaches Farcaster.
        </p>
      )}

      {error && (
        <p data-testid="connect-error" role="alert" className="mx-4 mt-3 rounded-xl bg-[#fdeef0] px-3 py-2 text-[14px] leading-5 text-[#b0182b]">
          {error}
        </p>
      )}

      {connected && !connected.disconnected && (
        <section data-testid="connect-connected" className="mx-4 mt-4 rounded-2xl border border-x-border p-4">
          <p className="text-[17px] font-extrabold leading-6">
            Connected: @{connected.fname ?? connected.fid}
            <span className="ml-2 text-[13px] font-normal text-x-sec">fid {connected.fid}</span>
          </p>
          <p className="mt-1 text-[15px] leading-5">
            Totem can post as you. You can revoke it any time in the Farcaster app&rsquo;s connected apps.
          </p>
          {connected.signerCheck === "unknown" && (
            <p data-testid="connect-signer-unknown" className="mt-1 text-[13px] leading-4 text-x-sec">
              Couldn&rsquo;t check the connection with Farcaster just now. If you removed Totem in the Farcaster app, posting as this
              account will be refused.
            </p>
          )}
          <p className="mt-2 text-[15px] leading-5">
            Your personas stay unlinked. Totem refuses any reply, like, recast, follow or mention between your main account and
            your other accounts (your personas, the shared test account and the anonymous account), in either direction, and
            refuses when it can&rsquo;t tell whose account something is.
          </p>
          {connected.handle && <p className="mt-2 text-[13px] leading-4 text-x-sec">In Totem it is the persona @{connected.handle}.</p>}
          <div className="mt-4 border-t border-x-border pt-3">
            <p className="text-[13px] leading-4 text-x-sec">
              Disconnecting stops Totem posting as @{connected.fname ?? connected.fid}. To remove the key itself, open the Farcaster app,
              then Settings, then Connected apps.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input
                data-testid="connect-disconnect-confirm"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Type DISCONNECT"
                className="h-9 w-48 rounded-md border border-[#cfd9de] px-3 text-[14px] outline-none focus:border-x-blue"
              />
              <button
                type="button"
                data-testid="connect-disconnect"
                disabled={busy || confirm !== "DISCONNECT"}
                onClick={async () => {
                  if (await act({ action: "disconnect", confirm })) {
                    setConfirm("");
                    refresh();
                  }
                }}
                className="h-9 rounded-full border border-[#cfd9de] px-4 text-[14px] font-bold disabled:opacity-50"
              >
                Disconnect
              </button>
            </div>
          </div>
        </section>
      )}

      {connected && connected.disconnected && !session && (
        <p data-testid="connect-disconnected" data-removed-in-app={connected.removedInApp ? "true" : undefined} className="mx-4 mt-4 text-[15px] leading-5">
          {connected.removedInApp ? (
            <>
              Removed in the Farcaster app: Totem can&rsquo;t post as @{connected.fname ?? connected.fid} any more. Your other accounts still
              stay apart from it.{blocked ? "" : " Connect it again below."}
            </>
          ) : (
            <>
              Disconnected: Totem can&rsquo;t post as @{connected.fname ?? connected.fid}. Your other accounts still stay apart from it.
              {blocked ? "" : " Connect it again below."}
            </>
          )}
        </p>
      )}

      {blocked && connector && (
        <section data-testid="connect-connector-missing" className="mx-4 mt-4 rounded-2xl border border-x-border p-4">
          <p className="text-[17px] font-extrabold leading-6">What it needs: a connector account</p>
          <p className="mt-2 text-[15px] leading-5">
            Farcaster records, publicly and for good, which app asked for each connection. So Totem needs a small account of its
            own to be that app: a connector account that nothing else ever uses.
          </p>
          <p className="mt-2 text-[15px] leading-5">
            It costs about $1 of ETH on Optimism, once. Afterwards people can see that your main account uses a private app. They
            can&rsquo;t see which other accounts you have.
          </p>
          <p className="mt-2 text-[15px] leading-5">
            Whether to set one up is your call. If you do, run <code className="rounded bg-[#eff3f4] px-1">scripts\owner\arm-connector.ps1</code> on
            your laptop. It creates the account&rsquo;s address on this service, asks you to send about 0.0005 ETH on Optimism to it
            from an exchange withdrawal (never from your main wallet, a persona, or the Totem app wallet), registers the account
            when you type REGISTER (about $1 all in), and offers it a neutral name that doesn&rsquo;t say Totem. You never handle a
            key.
          </p>
          {setupLine && (
            <p data-testid="connect-connector-setup" data-stage={setup?.stage ?? ""} className="mt-2 text-[15px] font-bold leading-5">
              Where the connector stands: {setupLine}
            </p>
          )}
          <p className="mt-2 text-[15px] leading-5">
            If your main account&rsquo;s custody already sits in a browser wallet, there is a $0 way instead: your main account can be
            its own connector. Totem hasn&rsquo;t built that path yet.
          </p>
          {connector.reason && <p className="mt-2 text-[13px] leading-4 text-x-sec">{connector.reason}</p>}
        </section>
      )}

      {!blocked && connector?.configured && connector.source === "sealed" && (!connected || connected.disconnected) && (
        <p data-testid="connect-connector-sealed" className="mx-4 mt-3 text-[13px] leading-4 text-x-sec">
          The connector is the account this service created and keeps for you: fid {connector.appFid}
          {setup?.fname ? ` (@${setup.fname})` : ", with no name yet — the approval screen shows it by number. A neutral name is optional: arm-connector.ps1 -Fname <name>"}.
        </p>
      )}

      {session && stage === "pending_approval" && session.approval && (
        <section data-testid="connect-pending" className="mx-4 mt-4 rounded-2xl border border-x-border p-4">
          <p className="text-[17px] font-extrabold leading-6">Approve in your Farcaster app</p>
          <p className="mt-1 text-[15px] leading-5">
            Approve in your Farcaster app. Totem can then post as you; you can revoke it any time in the app&rsquo;s connected apps.
            Your personas stay unlinked.
          </p>
          <p className="mt-2 text-[15px] font-bold leading-5">Make sure the Farcaster app is logged in as @{session.expectedUsername}.</p>
          <div className="mt-3 flex flex-col items-start gap-4 sm:flex-row sm:items-center">
            <svg
              data-testid="connect-qr"
              role="img"
              aria-label="QR code: scan it with your phone to open the request in the Farcaster app"
              viewBox={`0 0 ${session.approval.qr.viewBox} ${session.approval.qr.viewBox}`}
              width={232}
              height={232}
              shapeRendering="crispEdges"
              className="shrink-0 rounded-lg border border-x-border bg-white"
            >
              <rect width={session.approval.qr.viewBox} height={session.approval.qr.viewBox} fill="#ffffff" />
              <path d={session.approval.qr.path} fill="#000000" />
            </svg>
            <div className="min-w-0">
              <p className="text-[15px] leading-5">On a computer: scan this with your phone&rsquo;s camera.</p>
              <p className="mt-2 text-[15px] leading-5">On your phone:</p>
              <a
                data-testid="connect-open-app"
                href={session.approval.url}
                rel="noreferrer"
                className="mt-1 inline-flex h-9 items-center rounded-full bg-x-black-btn px-4 text-[14px] font-bold text-white hover:bg-x-black-btn-hover"
              >
                Open in the Farcaster app
              </a>
              <p className="mt-3 text-[13px] leading-4 text-x-sec">
                The request comes from @{session.appUsername ?? `fid ${session.appFid}`}, the connector account.
                {session.sponsored ? " Neynar pays the onchain fee." : " The Farcaster app may ask you to pay the onchain fee."}
              </p>
            </div>
          </div>
          {pollTrouble ? (
            <p data-testid="connect-status" data-trouble="true" role="status" className="mt-4 text-[14px] leading-5 text-[#b0182b]">
              {pollTrouble} This request expires at {timeOf(session.deadline)}.
            </p>
          ) : (
            <p data-testid="connect-status" className="mt-4 text-[14px] leading-5 text-x-sec">
              Waiting for your approval. This request expires at {timeOf(session.deadline)}.
            </p>
          )}
          <p data-testid="connect-decline-note" className="mt-1 text-[13px] leading-4 text-x-sec">
            Declined it, or scanned it with the wrong account? Farcaster doesn&rsquo;t tell Totem about a decline: press Cancel and
            start again.
          </p>
          <button
            type="button"
            data-testid="connect-cancel"
            disabled={busy}
            onClick={() => act({ action: "cancel", sessionId: session.id })}
            className="mt-3 h-9 rounded-full border border-[#cfd9de] px-4 text-[14px] font-bold disabled:opacity-50"
          >
            Cancel
          </button>
        </section>
      )}

      {session && stage === "approved" && (
        <section data-testid="connect-finishing" className="mx-4 mt-4 rounded-2xl border border-x-border p-4">
          <p className="text-[15px] leading-5">{finishing ?? (error ? "Approved, but not saved yet." : "Approved. Saving your account…")}</p>
          {!finishing && error && (
            <button
              type="button"
              data-testid="connect-finish-retry"
              onClick={() => setFinishRound((n) => n + 1)}
              className="mt-3 h-9 rounded-full bg-x-black-btn px-4 text-[14px] font-bold text-white"
            >
              Try saving again
            </button>
          )}
        </section>
      )}

      {session && stopped && (
        <p data-testid="connect-stopped" data-stage={stage ?? ""} className="mx-4 mt-4 rounded-xl bg-[#fff8e1] px-3 py-2 text-[14px] leading-5">
          {session.note ?? "That request stopped. Start again."}
        </p>
      )}

      {showForm && connector?.configured && (!connected || connected.disconnected) && (
        <form
          data-testid="connect-form"
          className="mx-4 mt-4"
          onSubmit={async (e) => {
            e.preventDefault();
            await act({ action: "start", handle });
          }}
        >
          <label htmlFor="connect-handle" className="block text-[15px] font-bold leading-5">
            Your Farcaster username
          </label>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              id="connect-handle"
              data-testid="connect-handle"
              value={handle}
              onChange={(e) => setHandle(e.target.value.trim().slice(0, 70))}
              placeholder={connected?.fname ?? "alice or alice.eth"}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              className="h-9 w-64 max-w-full rounded-md border border-[#cfd9de] px-3 text-[15px] outline-none focus:border-x-blue"
            />
            <button
              type="submit"
              data-testid="connect-start"
              disabled={busy || !handle}
              className="h-9 rounded-full bg-x-black-btn px-4 text-[14px] font-bold text-white disabled:opacity-50"
            >
              {busy ? "Preparing…" : "Connect"}
            </button>
          </div>
          <p className="mt-2 text-[13px] leading-4 text-x-sec">
            Totem asks Neynar for a signer and shows a code to approve. Nothing is posted.
          </p>
        </form>
      )}
    </div>
  );
}
