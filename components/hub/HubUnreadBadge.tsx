"use client";
// NOTIFICATIONS FROM FARCASTER — the unread badge on the Notifications entry of the left rail and the phone tab bar.
//
// ONE shared store for every badge on the page (the rail and the tab bar are both mounted), so one ask goes to the
// device, not one per badge: POST /api/fc/hub {op:"unread"} (no profile is read for it). It asks every 2 minutes while
// the tab is visible, again when the tab comes back into view or gets focus (at most every 30 s), and NEVER while the
// tab is hidden. The notifications page tells it the moment it has marked everything seen (noteHubUnread).
//
// ONLY WHILE THE ROOT ACTS (components/hub/rootActs.ts): while a persona acts the badge is the persona's world, which
// has none today, so nothing shows and nothing is asked; the store is emptied and an answer that lands after the switch
// is dropped. A count that cannot be told (a failed read, the seen record unreadable) is a dot with the reason, never 0
// and never hidden as "nothing new".
import { useEffect, useState } from "react";
import type { HubUnreadView } from "@/lib/fc/hubRead/copy";
import { NOTIF_BADGE_UNKNOWN, badgeText } from "@/lib/fc/hubRead/copy";
import { hubCall } from "./hubCall";
import { useRootReads } from "./rootActs";

const EVERY_MS = 120_000;
const FLOOR_MS = 30_000;
interface Store {
  value: HubUnreadView | null;
  error: boolean;
  at: number;
  /** bumped whenever the badge is switched off: an answer from an earlier epoch is dropped */
  epoch: number;
  p: Promise<void> | null;
  subs: Set<() => void>;
}
const store: Store = { value: null, error: false, at: 0, epoch: 0, p: null, subs: new Set() };
const emit = () => store.subs.forEach((f) => f());
function ask(force = false): Promise<void> {
  // no badge on screen as the root (none mounted, or a persona acts): nothing is asked
  if (store.subs.size === 0) return Promise.resolve();
  if (store.p) return store.p;
  if (!force && Date.now() - store.at < FLOOR_MS) return Promise.resolve();
  if (typeof document !== "undefined" && document.visibilityState === "hidden") return Promise.resolve();
  const epoch = store.epoch;
  store.at = Date.now();
  const p: Promise<void> = hubCall<HubUnreadView>({ op: "unread", refresh: "auto", waitMs: 2500 })
    .then((r) => {
      if (epoch !== store.epoch) return;
      if (r.ok) {
        store.value = r.data;
        store.error = false;
        // the first read is still filling: ask again shortly (still never while hidden)
        if (r.data.state === "loading" && store.subs.size > 0) window.setTimeout(() => void ask(true), 1500);
      } else store.error = true;
    })
    .finally(() => {
      if (store.p === p) store.p = null;
      if (epoch === store.epoch) emit();
    });
  store.p = p;
  return p;
}
function off(): void {
  store.epoch++;
  store.value = null;
  store.error = false;
  store.at = 0;
  store.p = null;
  emit();
}
/** the notifications page: what it just showed and marked seen (the badge follows at once, without another read) */
export function noteHubUnread(v: { unread: number | null; seenAt: number | null; newestAt: number | null }): void {
  store.value = { state: v.unread === null ? "error" : "ok", unread: v.unread, seenAt: v.seenAt, newestAt: v.newestAt, sentence: null };
  store.error = false;
  store.at = Date.now();
  emit();
}

// one clock and one pair of listeners for every badge on the page, started by the first and stopped with the last
let clock = 0;
const onVisible = () => {
  if (document.visibilityState === "visible") void ask();
};
function start(): void {
  if (clock) return;
  clock = window.setInterval(() => void ask(true), EVERY_MS);
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("focus", onVisible);
}
function stop(): void {
  if (!clock) return;
  window.clearInterval(clock);
  clock = 0;
  document.removeEventListener("visibilitychange", onVisible);
  window.removeEventListener("focus", onVisible);
}
function useUnread(enabled: boolean): { value: HubUnreadView | null; error: boolean } {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!enabled) {
      if (store.value || store.error || store.p) off();
      return;
    }
    const f = () => tick((n) => n + 1);
    store.subs.add(f);
    start();
    void ask();
    return () => {
      store.subs.delete(f);
      if (store.subs.size === 0) stop();
    };
  }, [enabled]);
  return enabled ? { value: store.value, error: store.error } : { value: null, error: false };
}

/** the badge itself, placed over the bell (`variant` only changes its offset) */
export function HubUnreadBadge({ variant }: { variant: "rail" | "tabbar" }) {
  const who = useRootReads(true);
  const { value, error } = useUnread(who === "root");
  if (who !== "root") return null;
  // the rail's badge sits on the bell itself; the tab bar's on the corner of its padded link
  const pos = variant === "rail" ? "-right-1 -top-1" : "right-0 top-0.5";
  if (error || (value && value.unread === null && value.state !== "loading")) {
    const why = value?.sentence ?? NOTIF_BADGE_UNKNOWN;
    return <span data-testid="notif-badge" data-state="unknown" title={why} aria-label={why} className={`absolute ${pos} h-2.5 w-2.5 rounded-full border-2 border-white bg-x-sec`} />;
  }
  if (!value || value.unread === null || value.unread <= 0) return null;
  return (
    <span data-testid="notif-badge" data-state="unread" data-count={value.unread} aria-label={`${value.unread} unread notifications`} className={`absolute ${pos} flex h-[18px] min-w-[18px] items-center justify-center rounded-full border border-white bg-x-blue px-1 text-[11px] font-bold leading-none text-white`}>
      {badgeText(value.unread)}
    </span>
  );
}
