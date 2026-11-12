"use client";
// ADS, PHASE 1 — the islands' one way to ask the browser device for a page's ads (POST /api/ads, answered in this tab by
// app/api/ads/route.ts → lib/ads/plan.ts). Every argument rides the POST body, never a URL. A failure is no ads plus the
// device's own sentence, never an ad the plan did not place.
//
// THE SEAM FOR FOR YOU: any feed island that shows a page of posts calls useAdPlan(placement, modeId, hashes, nonce) and
// renders plan.rows (posts by hash, ads as <AdUnit>), exactly as components/hub/HubFollowing.tsx does for Following.
import { useCallback, useEffect, useRef, useState } from "react";
import type { AdPlanView } from "@/lib/ads/plan";

export type AdsCall<T> = { ok: true; data: T } | { ok: false; error: string; code: string | null; status: number };
const UNREACHABLE = "Couldn't reach your browser's device just now, so no ads are shown.";

export async function adsCall<T>(body: Record<string, unknown>): Promise<AdsCall<T>> {
  try {
    const r = await fetch("/api/ads", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
    const j = (await r.json().catch(() => null)) as (T & { error?: unknown; code?: unknown }) | null;
    if (r.ok && j && typeof j === "object") return { ok: true, data: j as T };
    return { ok: false, error: j && typeof j.error === "string" && j.error ? j.error : UNREACHABLE, code: j && typeof j.code === "string" ? j.code : null, status: r.status };
  } catch {
    return { ok: false, error: UNREACHABLE, code: "device", status: 0 };
  }
}

/** the plan for this page, re-asked whenever the posts, the mode or `nonce` change, and on replan() (after a hide) */
export function useAdPlan(placement: "following" | "forYou", modeId: string | null, hashes: readonly string[], nonce: string | number) {
  const key = modeId ? [placement, modeId, String(nonce), hashes.join(",")].join("|") : null;
  const [gen, setGen] = useState(0);
  const [answer, setAnswer] = useState<{ key: string; plan: AdPlanView | null; error: string | null } | null>(null);
  const last = useRef<{ key: string; plan: AdPlanView } | null>(null);
  const hashesRef = useRef(hashes);
  hashesRef.current = hashes;
  useEffect(() => {
    if (!key || !modeId) return;
    let live = true;
    const asked = key + "#" + gen;
    void adsCall<AdPlanView>({ op: "plan", placement, modeId, posts: [...hashesRef.current] }).then((r) => {
      if (!live) return;
      setAnswer({ key: asked, plan: r.ok ? r.data : null, error: r.ok ? null : r.error });
      if (r.ok) last.current = { key, plan: r.data };
    });
    return () => {
      live = false;
    };
  }, [key, gen, placement, modeId]);
  const replan = useCallback(() => setGen((n) => n + 1), []);
  const current = answer && key && answer.key === key + "#" + gen ? answer : null;
  // while a re-ask for the SAME page is in flight (a hide, a nonce), keep the last plan; a different page waits for its own
  const plan = current ? current.plan : last.current && last.current.key === key ? last.current.plan : null;
  return { plan, error: current?.error ?? null, replan };
}
