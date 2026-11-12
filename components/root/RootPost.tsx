"use client";
// POST AS YOU — the visitor's own Farcaster account in the composer and in Settings › Account: "Allow Totem to post as
// you" (the connect panel: the approval in the Farcaster app, a link on a phone and a QR code on a computer, polled until
// the account approved it AND Farcaster's network lists the key), the root composer ("Posts go to Farcaster as @you."),
// and Disconnect. Every word about what happened is the device route's (app/api/fc/root/route.ts →
// lib/fc/rootSigner/flow.ts); this file adds the honest notes before the click and never invents a success.
import { useCallback, useEffect, useRef, useState } from "react";
import { FC_CAST_MAX_BYTES, castBytes } from "@/lib/fc/castLimits";
import { ALLOW_LABEL, MAIN_APP_NOTE, ONLY_YOURS, REMOVE_IN_APP, beforeYouAllow, postsGoAsLine } from "@/lib/fc/rootSigner/copy";
import { ROOT_CAST_EVENT } from "@/components/hub/hubCall";
import { noteRootStatus } from "@/components/hub/HubWrite";

export interface RootPostStatusView {
  available: boolean;
  reason: string | null;
  code: string | null;
  account: { fid: number; fname: string | null } | null;
  state: "none" | "pending" | "active";
  stage: "waiting" | "approved" | "waiting_for_hub" | null;
  key: string | null;
  appFid: number | null;
  deadline: number | null;
  activatedAt: number | null;
  approval: { url: string; qr: { viewBox: number; path: string } } | null;
  sponsored: boolean;
  forgotten: { key: string; at: number } | null;
  posted: Array<{ hash: string; text: string; at: number; url: string | null }>;
  hubHost: string;
}


type Json = Record<string, unknown>;
async function call(body?: Json): Promise<{ ok: boolean; json: Json | null }> {
  try {
    const r = await fetch("/api/fc/root", body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { cache: "no-store" });
    const json = (await r.json().catch(() => null)) as Json | null;
    return { ok: r.ok, json };
  } catch {
    return { ok: false, json: { error: "Couldn't reach your browser's device just now. Try again.", code: "device" } };
  }
}
const errorOf = (j: Json | null, fallback: string) => (j && typeof j.error === "string" && j.error ? j.error : fallback);
function isStatus(j: Json | null): j is Json & RootPostStatusView {
  return !!j && typeof j.available === "boolean" && (j.state === "none" || j.state === "pending" || j.state === "active");
}

/** the device's answer about posting as the root, re-read on demand */
export function useRootPost(enabled: boolean): { status: RootPostStatusView | null; error: string | null; reload: () => void; set: (s: RootPostStatusView) => void } {
  const [status, setStatus] = useState<RootPostStatusView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    call().then(({ json }) => {
      if (!alive) return;
      if (isStatus(json)) {
        setStatus(json);
        setError(null);
        noteRootStatus(json); // POST AS YOU ON HUB CARDS: the cards' buttons follow the same answer
      } else setError(errorOf(json, "Couldn't check whether Totem can post as you."));
    });
    return () => {
      alive = false;
    };
  }, [enabled, tick]);
  const set = useCallback((s: RootPostStatusView) => {
    setStatus(s);
    noteRootStatus(s);
  }, []);
  return { status, error, reload: () => setTick((t) => t + 1), set };
}

const isPhone = () => typeof navigator !== "undefined" && /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

/** "Allow Totem to post as you": the button, then the approval (link + QR) polled until it settles */
export function RootPostConnect({ status, onChange, compact = false }: { status: RootPostStatusView; onChange: (s: RootPostStatusView) => void; compact?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(status.state === "pending");
  const polling = useRef(false);
  const start = async () => {
    setBusy(true);
    setError(null);
    const { json } = await call({ action: "start" });
    setBusy(false);
    if (isStatus(json)) {
      onChange(json);
      setOpen(true);
    } else setError(errorOf(json, "Couldn't start the approval. Nothing was sent."));
  };
  const cancel = async () => {
    const { json } = await call({ action: "cancel" });
    if (isStatus(json)) onChange(json);
    setOpen(false);
  };
  // while pending: one look every 3 seconds; a refusal stops it and is shown; a retryable one keeps looking
  const pending = status.state === "pending";
  const poll = useCallback(async () => {
    if (polling.current) return;
    polling.current = true;
    const { json } = await call({ action: "poll" });
    polling.current = false;
    if (isStatus(json)) {
      setError(null);
      onChange(json);
      return;
    }
    const retryable = !!json && json.retryable === true;
    setError(errorOf(json, "Couldn't check the approval."));
    if (!retryable) {
      const again = await call();
      if (isStatus(again.json)) onChange(again.json);
    }
  }, [onChange]);
  useEffect(() => {
    if (!pending) return;
    const t = window.setInterval(poll, 3000);
    return () => window.clearInterval(t);
  }, [pending, poll]);

  if (!status.available) {
    return (
      <p data-testid="root-post-unavailable" className="text-[14px] leading-5 text-x-sec">
        <span className="font-bold">{ALLOW_LABEL}</span>: {status.reason ?? "not available here."}
      </p>
    );
  }
  if (status.state === "pending" && status.approval) {
    const phone = isPhone();
    return (
      <div data-testid="root-post-approve" data-stage={status.stage ?? "waiting"} className="rounded-2xl border border-x-border p-3">
        <p className="text-[15px] font-bold leading-5">Approve in the Farcaster app</p>
        <p className="mt-0.5 text-[13px] leading-4 text-x-sec">
          {status.stage === "approved"
            ? "Approved. Waiting for Farcaster to add the key…"
            : status.stage === "waiting_for_hub"
              ? "Approved. Waiting for Farcaster's network to list the key…"
              : phone
                ? "Open the link, approve Totem, then come back here."
                : "Scan this with your phone's camera, approve Totem in the Farcaster app, then come back here."}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          {!phone ? (
            <svg data-testid="root-post-qr" viewBox={`0 0 ${status.approval.qr.viewBox} ${status.approval.qr.viewBox}`} width={168} height={168} role="img" aria-label="QR code to approve Totem in the Farcaster app" className="rounded-lg bg-white p-1">
              <path d={status.approval.qr.path} fill="#000" />
            </svg>
          ) : null}
          <div className="flex flex-col gap-2">
            <a data-testid="root-post-link" href={status.approval.url} className="inline-flex h-9 items-center rounded-full bg-x-black-btn px-4 text-[15px] font-bold text-white hover:bg-x-black-btn-hover">
              {phone ? "Open the Farcaster app" : "On your phone? Open the link"}
            </a>
            <button type="button" data-testid="root-post-cancel" onClick={cancel} className="text-left text-[13px] font-bold text-x-sec hover:underline">
              Cancel
            </button>
          </div>
        </div>
        <p data-testid="root-post-only-yours" className="mt-2 text-[13px] leading-4 text-x-sec">
          {ONLY_YOURS}
        </p>
        {error ? (
          <p data-testid="root-post-error" role="alert" className="mt-2 text-[13px] text-[#f4212e]">
            {error}
          </p>
        ) : null}
      </div>
    );
  }
  return (
    <div data-testid="root-post-connect" className={compact ? "" : "rounded-2xl border border-x-border p-3"}>
      {open || !compact ? <p className="mb-2 text-[13px] leading-4 text-x-sec">{beforeYouAllow(status.sponsored)}</p> : null}
      <button type="button" data-testid="root-post-allow" disabled={busy} onClick={start} className="inline-flex h-9 items-center rounded-full bg-x-black-btn px-4 text-[15px] font-bold text-white hover:bg-x-black-btn-hover disabled:opacity-60">
        {busy ? "Asking Farcaster…" : ALLOW_LABEL}
      </button>
      {error ? (
        <p data-testid="root-post-error" role="alert" className="mt-2 text-[13px] text-[#f4212e]">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** the composer for the root, once Totem may post as it */
export function RootComposer({ handle, avatar, status, onChange, autoFocus = false, onBack, note }: { handle: string; avatar: string | null; status: RootPostStatusView; onChange: (s: RootPostStatusView) => void; autoFocus?: boolean; onBack?: () => void; note?: string }) {
  const [text, setText] = useState("");
  const [posting, setPosting] = useState(false);
  const [line, setLine] = useState<{ kind: "ok" | "error"; message: string; url?: string | null } | null>(null);
  const bytes = castBytes(text);
  const over = bytes > FC_CAST_MAX_BYTES;
  const reload = async () => {
    const { json } = await call();
    if (isStatus(json)) onChange(json);
  };
  const post = async () => {
    if (!text.trim() || over || posting) return;
    setPosting(true);
    setLine(null);
    const { ok, json } = await call({ action: "cast", text });
    setPosting(false);
    if (ok && json && typeof json.hash === "string") {
      setText("");
      setLine({ kind: "ok", message: `Posted to Farcaster as @${handle}.`, url: typeof json.url === "string" ? json.url : null });
      // FOLLOWING FROM THE HUB: the Following timeline (if it is on screen) shows the post at once
      window.dispatchEvent(new Event(ROOT_CAST_EVENT));
      await reload();
    } else setLine({ kind: "error", message: "Not posted: " + errorOf(json, "Farcaster did not accept it.") });
  };
  const del = async (hash: string) => {
    const { ok, json } = await call({ action: "delete", hash });
    setLine(ok ? { kind: "ok", message: "Deleted from Farcaster." } : { kind: "error", message: "Not deleted: " + errorOf(json, "Farcaster did not accept it.") });
    if (ok) window.dispatchEvent(new Event(ROOT_CAST_EVENT));
    await reload();
  };
  return (
    <div data-testid="root-composer" data-root={handle} className="border-b border-x-border px-4 py-3">
      <div className="flex gap-3">
        {avatar ? <img src={avatar} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover" /> : <span aria-hidden="true" className="h-10 w-10 shrink-0 rounded-full bg-x-pill" />}
        <div className="min-w-0 flex-1">
          <p data-testid="composer-posting-as" className="text-[15px] font-bold leading-5">
            Posting as @{handle}
          </p>
          {/* ACTING AS YOURSELF: a visitor with personas who chose "You" is told which identity is acting */}
          {note ? (
            <p data-testid="composer-acting-as-you" className="text-[13px] leading-4 text-x-sec">
              {note}
            </p>
          ) : null}
          <textarea
            data-testid="root-composer-text"
            value={text}
            autoFocus={autoFocus}
            onChange={(e) => setText(e.target.value)}
            placeholder="What's happening?"
            rows={3}
            className="mt-1 w-full resize-none bg-transparent text-[20px] leading-6 outline-none placeholder:text-x-sec"
          />
          <div className="flex items-center justify-between border-t border-x-border pt-2">
            <span data-testid="root-composer-bytes" className={`text-[13px] ${over ? "text-[#f4212e]" : "text-x-sec"}`}>
              {bytes}/{FC_CAST_MAX_BYTES}
            </span>
            <button
              type="button"
              data-testid="root-composer-submit"
              onClick={post}
              disabled={!text.trim() || over || posting}
              className={`h-9 rounded-full px-4 text-[15px] font-bold text-white ${text.trim() ? "bg-x-blue hover:bg-x-blue-hover disabled:opacity-50" : "bg-[#c2c6c9]"}`}
            >
              {posting ? "Posting…" : "Post"}
            </button>
          </div>
          <p data-testid="root-composer-line" className="mt-1.5 text-[13px] leading-4 text-x-sec">
            {postsGoAsLine(handle)}
          </p>
          <p data-testid="root-composer-main-app-note" className="mt-1 text-[12px] leading-4 text-x-sec">
            {MAIN_APP_NOTE}
          </p>
          {line ? (
            <p data-testid="root-composer-result" data-kind={line.kind} role={line.kind === "error" ? "alert" : "status"} className={`mt-1.5 text-[13px] leading-4 ${line.kind === "ok" ? "text-[#00ba7c]" : "text-[#f4212e]"}`}>
              {line.message}
              {line.url ? (
                <>
                  {" · "}
                  <a href={line.url} target="_blank" rel="noopener noreferrer" className="font-bold text-x-blue hover:underline">
                    view it on Farcaster
                  </a>
                </>
              ) : null}
            </p>
          ) : null}
          {status.posted.length ? (
            <ul data-testid="root-composer-posted" className="mt-2 space-y-1">
              {status.posted.map((p) => (
                <li key={p.hash} className="flex items-center justify-between gap-2 text-[13px] leading-4">
                  <span className="min-w-0 truncate text-x-sec">{p.text}</span>
                  <button type="button" data-testid="root-composer-delete" onClick={() => del(p.hash)} className="shrink-0 font-bold text-[#f4212e] hover:underline">
                    Delete
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {onBack ? (
            <button type="button" data-testid="root-composer-back" onClick={onBack} className="mt-2 text-[13px] font-bold text-x-blue hover:underline">
              Post as a persona instead
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** Settings › Account: posting as you — connected (with Disconnect), or the connect panel */
export function RootPostSettings() {
  const { status, error, reload, set } = useRootPost(true);
  const [confirm, setConfirm] = useState("");
  const [said, setSaid] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (error) {
    return (
      <p data-testid="root-post-settings-error" role="alert" className="px-4 py-3 text-[14px] text-[#f4212e]">
        {error}{" "}
        <button type="button" onClick={reload} className="font-bold underline">
          Try again
        </button>
      </p>
    );
  }
  if (!status) return <p className="px-4 py-3 text-[14px] text-x-sec">Checking…</p>;
  const handle = status.account?.fname ?? "you";
  return (
    <div data-testid="root-post-settings" data-state={status.state} className="px-4 py-3">
      {status.state === "active" ? (
        <>
          <p className="text-[15px] font-bold leading-5">Totem can post as @{handle}</p>
          <p className="mt-0.5 text-[13px] leading-4 text-x-sec">
            With a key kept in your vault ({status.key ? status.key.slice(0, 10) + "…" : ""}). {MAIN_APP_NOTE}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input data-testid="root-post-disconnect-confirm" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Type DISCONNECT" className="h-8 rounded-full border border-x-border bg-transparent px-3 text-[14px]" />
            <button
              type="button"
              data-testid="root-post-disconnect"
              disabled={busy || confirm !== "DISCONNECT"}
              onClick={async () => {
                setBusy(true);
                const { json } = await call({ action: "disconnect", confirm });
                setBusy(false);
                if (isStatus(json)) {
                  set(json);
                  setConfirm("");
                  setSaid(typeof json.removeHow === "string" ? json.removeHow : null);
                } else setSaid(errorOf(json, "Not disconnected."));
              }}
              className="h-8 rounded-full border border-[#f4212e] px-4 text-[14px] font-bold text-[#f4212e] disabled:opacity-50"
            >
              Disconnect
            </button>
          </div>
        </>
      ) : (
        <RootPostConnect status={status} onChange={set} />
      )}
      {said || (status.state !== "active" && status.forgotten) ? (
        <p data-testid="root-post-remove-how" className="mt-2 text-[13px] leading-4 text-x-sec">
          {said ?? "A key Totem forgot can still post until you remove it. " + REMOVE_IN_APP}
        </p>
      ) : null}
    </div>
  );
}
