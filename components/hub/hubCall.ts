"use client";
// FOLLOWING FROM THE HUB — the islands' one way to ask the browser device (POST /api/fc/hub, answered in this tab by
// app/api/fc/hub/route.ts → lib/fc/hubRead/read.ts). Every argument rides the POST body, never a URL. A failure is an
// error with the device's own sentence, never an empty answer.

/** a cast or delete as the root (components/root/RootPost.tsx dispatches it): the Following island asks again */
export const ROOT_CAST_EVENT = "totem:root-cast";

export type HubCall<T> = { ok: true; data: T } | { ok: false; error: string; code: string | null; status: number };

const UNREACHABLE = "Couldn't reach your browser's device just now. Try again.";

export async function hubCall<T>(body: Record<string, unknown>): Promise<HubCall<T>> {
  try {
    const r = await fetch("/api/fc/hub", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
    const j = (await r.json().catch(() => null)) as (T & { error?: unknown; code?: unknown }) | null;
    if (r.ok && j && typeof j === "object") return { ok: true, data: j as T };
    return {
      ok: false,
      error: j && typeof j.error === "string" && j.error ? j.error : UNREACHABLE,
      code: j && typeof j.code === "string" ? j.code : null,
      status: r.status,
    };
  } catch {
    return { ok: false, error: UNREACHABLE, code: "device", status: 0 };
  }
}
