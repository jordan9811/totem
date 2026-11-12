"use client";
// POST AS YOU ON HUB CARDS — Reply, Like and Recast (and their undo), and Delete on the root's own casts, on the cards
// Totem reads straight from a Farcaster node (cast.hub: components/hub/*), acting as the visitor's OWN Farcaster account.
// Every write goes to the device route the composer uses (POST /api/fc/root, answered in this tab by
// app/api/fc/root/route.ts → lib/fc/rootSigner/flow.ts), which signs it with the root's key and hands the bytes to the
// validator's relay. Nothing here invents a success: a button is pressed only after the route says the node accepted it,
// and a refusal is a sentence on the card.
//
// WHEN THE BUTTONS WORK (useHubWriteGate): post as you is active, no persona is acting, and the card is not by one of the
// visitor's own personas. Otherwise they stay disabled with the one-line reason. The device refuses the same cases on
// its own (acting_persona, own_persona), so this is the honest note before the click, never the only guard.
//
// PRESSED STATE (useHubReacted): the root's newest likes and recasts, read by this tab from the node (the hub route's
// "reacted" op: two reads naming the root only, cached in the tab). A card older than what was read shows as not pressed
// with a note that it cannot be told; a failed read never says "not liked".
//
// Two shared stores (one ask per page, not per card): the device's post-as-you status and the reactions.
import { useEffect, useState } from "react";
import type { Cast } from "@/lib/types";
import type { HubReactedView } from "@/lib/fc/hubRead/copy";
import { reactedState } from "@/lib/fc/hubRead/copy";
import { FC_CAST_MAX_BYTES, castBytes } from "@/lib/fc/castLimits";
import { ROOT_NOT_ON_OWN_PERSONA, ROOT_OFF_WHILE_PERSONA, hubWritesNeedKey } from "@/lib/fc/rootSigner/copy";
import { useApp } from "@/components/Providers";
import type { RootPostStatusView } from "@/components/root/RootPost";
import { ROOT_CAST_EVENT, hubCall } from "./hubCall";

type Json = Record<string, unknown>;
const UNREACHABLE = "Couldn't reach your browser's device just now. Nothing was sent; try again.";

/** one ask of the device's post-as-you route (in-tab); a failure carries the route's own sentence */
export async function rootCall(body?: Json): Promise<{ ok: boolean; json: Json | null; error: string; code: string | null }> {
  try {
    const r = await fetch("/api/fc/root", body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : { cache: "no-store" });
    const json = (await r.json().catch(() => null)) as Json | null;
    const error = json && typeof json.error === "string" && json.error ? json.error : r.ok ? "" : "Farcaster did not accept it.";
    return { ok: r.ok, json, error, code: json && typeof json.code === "string" ? json.code : null };
  } catch {
    return { ok: false, json: null, error: UNREACHABLE, code: "device" };
  }
}

// ------------------------------------------------------------------------------------------------- a tiny shared store
interface Shared<T> {
  value: T | null;
  error: string | null;
  at: number;
  p: Promise<void> | null;
  subs: Set<() => void>;
  freshMs: number;
  load: (force: boolean) => Promise<T>;
}
function shared<T>(load: (force: boolean) => Promise<T>, freshMs: number): Shared<T> {
  return { value: null, error: null, at: 0, p: null, subs: new Set(), freshMs, load };
}
function emit<T>(s: Shared<T>): void {
  s.subs.forEach((f) => f());
}
function refreshShared<T>(s: Shared<T>, force = false): Promise<void> {
  if (s.p) return s.p;
  s.p = s
    .load(force)
    .then((v) => {
      s.value = v;
      s.error = null;
    })
    .catch((e: unknown) => {
      // the last good answer stays; the error is said beside it
      s.error = e instanceof Error && e.message ? e.message : UNREACHABLE;
    })
    .finally(() => {
      s.at = Date.now();
      s.p = null;
      emit(s);
    });
  return s.p;
}
function setShared<T>(s: Shared<T>, v: T): void {
  s.value = v;
  s.error = null;
  s.at = Date.now();
  emit(s);
}
function useShared<T>(s: Shared<T>, enabled: boolean): { value: T | null; error: string | null } {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const f = () => tick((n) => n + 1);
    s.subs.add(f);
    if (!s.p && (s.at === 0 || Date.now() - s.at > s.freshMs || s.error)) void refreshShared(s);
    return () => {
      s.subs.delete(f);
    };
  }, [s, enabled]);
  return { value: s.value, error: s.error };
}

const isStatus = (j: Json | null): j is Json & RootPostStatusView => !!j && typeof j.available === "boolean" && (j.state === "none" || j.state === "pending" || j.state === "active");
const statusStore = shared<RootPostStatusView>(async () => {
  const r = await rootCall();
  if (isStatus(r.json)) return r.json;
  throw new Error(r.error || "Couldn't check whether Totem can post as you.");
}, 60_000);
/** the composer and Settings › Account tell the cards when the device's answer changed (connect, disconnect) */
export function noteRootStatus(s: RootPostStatusView): void {
  setShared(statusStore, s);
}

const reactedStore = shared<HubReactedView>(async (force) => {
  const r = await hubCall<HubReactedView>({ op: "reacted", refresh: force });
  if (!r.ok) throw new Error(r.error);
  return r.data;
}, 120_000);
/** the root's reactions as this tab last read them (null until read); re-asked while the read is still loading */
export function useHubReacted(enabled: boolean): HubReactedView | null {
  const { value } = useShared(reactedStore, enabled);
  useEffect(() => {
    if (!enabled || !value || value.state !== "loading") return;
    const t = window.setTimeout(() => void refreshShared(reactedStore), 1500);
    return () => window.clearTimeout(t);
  }, [enabled, value]);
  return value;
}

// ------------------------------------------------------------------------------------------------- the gate
export interface HubWriteGate {
  /** a hub card: false for every other card (nothing here applies) */
  hub: boolean;
  /** the buttons work */
  ok: boolean;
  /** why not, in one line (null when ok) */
  reason: string | null;
  /** the root's handle (for the words) and fid */
  handle: string | null;
  rootFid: number | null;
  /** the card is the root's OWN cast (Delete is offered) */
  mine: boolean;
}
const INERT: HubWriteGate = { hub: false, ok: false, reason: null, handle: null, rootFid: null, mine: false };
const CHECKING = "Checking whether Totem can post as you…";

/** may this hub card be liked, recast and replied to as the root, right now, and if not, why not */
export function useHubWriteGate(cast: Cast | null, offSite: string | null = null): HubWriteGate {
  const { publicLive, deviceIsThePage, personas, actingPersonaId, rosterStatus } = useApp();
  const hub = !!cast && cast.hub === true;
  const root = personas.find((p) => p.publicSelf === true) ?? null;
  // PERSONA SEPARATION: the same test as the Following tab's (components/home/HomeFeed.tsx)
  const acting = !!actingPersonaId && personas.some((p) => p.id === actingPersonaId && p.publicSelf !== true);
  const live = hub && publicLive && deviceIsThePage && rosterStatus === "ready" && !!root && !acting;
  const { value: status, error } = useShared(statusStore, live);
  if (!hub || !cast) return INERT;
  const off = (reason: string): HubWriteGate => ({ hub: true, ok: false, reason, handle: root ? root.handle : null, rootFid: null, mine: false });
  if (!publicLive || !deviceIsThePage) return off(offSite ?? "Liking, recasting and replying to Farcaster posts works on the live site only.");
  if (rosterStatus !== "ready") return off(CHECKING);
  if (!root) return off("Sign in with Farcaster first: Totem acts only as the account you signed in with.");
  if (acting) return off(ROOT_OFF_WHILE_PERSONA);
  if (cast.hubOwn) return off(ROOT_NOT_ON_OWN_PERSONA);
  if (error && !status) return off(error);
  if (!status) return off(CHECKING);
  if (status.state !== "active" || !status.account) return off(hubWritesNeedKey(root.handle));
  return { hub: true, ok: true, reason: null, handle: root.handle, rootFid: status.account.fid, mine: cast.author.fid === status.account.fid };
}
/** after a refusal that means the device's answer changed (the key went, the account was disconnected) */
export function recheckRootWrites(code: string | null): void {
  if (code && ["no_key", "not_armed", "not_signed_in", "disconnected_account", "vault"].includes(code)) void refreshShared(statusStore, true);
}

/** the pressed state of one card for one kind: true, false, or null (cannot be told) */
export function pressedOf(v: HubReactedView | null, kind: "like" | "recast", cast: Cast): boolean | null {
  return reactedState(v, kind, cast.hash, cast.timestamp);
}

// ------------------------------------------------------------------------------------------------- the reply composer
/** a reply as the root (parent = the card's fid + hash); used under a hub card and on the thread page */
export function HubReplyComposer({
  parent,
  handle,
  testid,
  autoFocus = false,
  onPosted,
  className = "border-b border-x-border px-4 py-3",
}: {
  parent: { fid: number; hash: string };
  handle: string;
  /** "hub-reply" on the thread page, "hub-card-reply" under a card */
  testid: string;
  autoFocus?: boolean;
  onPosted?: () => void;
  className?: string;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [line, setLine] = useState<{ kind: "ok" | "error"; message: string } | null>(null);
  const bytes = castBytes(text);
  const over = bytes > FC_CAST_MAX_BYTES;
  const send = async () => {
    if (!text.trim() || over || busy) return;
    setBusy(true);
    setLine(null);
    const r = await rootCall({ action: "cast", text, parent });
    setBusy(false);
    if (r.ok && r.json && typeof r.json.hash === "string") {
      setText("");
      setLine({ kind: "ok", message: `Replied on Farcaster as @${handle}.` });
      window.dispatchEvent(new Event(ROOT_CAST_EVENT));
      onPosted?.();
    } else {
      setLine({ kind: "error", message: "Not posted: " + (r.error || "Farcaster did not accept it.") });
      recheckRootWrites(r.code);
    }
  };
  return (
    // a click in the box never opens the post underneath
    <div data-testid={testid} data-parent={parent.hash} onClick={(e) => e.stopPropagation()} className={className}>
      <textarea data-testid={testid + "-text"} value={text} autoFocus={autoFocus} onChange={(e) => setText(e.target.value)} placeholder="Post your reply" rows={2} className="w-full resize-none bg-transparent text-[17px] leading-6 outline-none placeholder:text-x-sec" />
      <div className="flex items-center justify-between">
        <span className={`text-[13px] ${over ? "text-[#f4212e]" : "text-x-sec"}`}>
          {bytes}/{FC_CAST_MAX_BYTES} · posts as @{handle}
        </span>
        <button type="button" data-testid={testid + "-submit"} disabled={!text.trim() || over || busy} onClick={send} className="h-9 rounded-full bg-x-blue px-4 text-[15px] font-bold text-white hover:bg-x-blue-hover disabled:opacity-50">
          {busy ? "Replying…" : "Reply"}
        </button>
      </div>
      {line ? (
        <p data-testid={testid + "-result"} data-kind={line.kind} role={line.kind === "error" ? "alert" : "status"} className={`mt-1.5 text-[13px] ${line.kind === "ok" ? "text-[#00ba7c]" : "text-[#f4212e]"}`}>
          {line.message}
        </p>
      ) : null}
    </div>
  );
}
