// BUILD A review — the pure half of what the Composer and Act as… show about where an action went. No React, no fetch:
// the node unit harness imports it as-is (scratchpad overnight-unit/fix-review), so what it asserts is what renders.

/** the server's answer about where a post goes or went (app/api/actions/farcasterDelivery.ts FcDelivery, the fields the
 *  UI reads); "unknown" = the question could not be answered */
export interface LineDelivery {
  to: "farcaster" | "layers" | "unknown";
  message: string;
  personaId?: string | null;
  fid?: number | null;
  mode?: "fixture" | "live";
  pointer?: string;
  hash?: string;
  url?: string | null;
  warning?: string;
  refused?: boolean;
}

/** PUB-1: what a post carries back to /api/actions/cast — the line the owner was shown. Nothing shown (or the question
 *  failed) sends nothing, and the server then refuses a real-network post until a line has been shown. */
export function expectationFrom(where: LineDelivery | null | undefined): { to: "farcaster" | "layers"; personaId: string | null; fid: number | null } | null {
  if (!where || (where.to !== "farcaster" && where.to !== "layers")) return null;
  return {
    to: where.to,
    personaId: typeof where.personaId === "string" && where.personaId ? where.personaId : null,
    fid: typeof where.fid === "number" && Number.isInteger(where.fid) && where.fid > 0 ? where.fid : null,
  };
}

/**
 * PERSONA LAUNCH P3 (PRIV-2, UX-3) — may the composer say "@x posts through @anon by default; this post stays in Totem"?
 * Only when ALL hold:
 *   - anonymous posting is unavailable right now (`available === false`) for a reason of this server's moment — never a
 *     DEPLOYMENT-WIDE one (the public preview, a server without the proof layer): there nothing posts through @anon, so
 *     "by default" would describe a feature that does not exist here (UX-3);
 *   - the persona's mode is "anon";
 *   - the DELIVERY LINE the server answered agrees that a plain post stays in Totem (`to === "layers"`). The line is the
 *     truth about where the words go: before PRIV-2 the note was shown on the mode alone while an account-owning persona
 *     in "anon" mode published publicly. A line not answered yet, failed, or saying Farcaster: no note.
 */
export function anonDefaultNoteShown(x: {
  available: boolean | null | undefined;
  deploymentOff: boolean | null | undefined;
  postAsMode: string | null | undefined;
  where: Pick<LineDelivery, "to"> | null | undefined;
}): boolean {
  return x.available === false && x.deploymentOff !== true && x.postAsMode === "anon" && !!x.where && x.where.to === "layers";
}

/** PUB-2 / UXC-03: how a refused answer is shown — only an outcome Farcaster did not confirm is "unconfirmed" (with
 *  its "doing it again is safe" hint); a definitive refusal, a cap, a guard, a changed line are all plain refusals */
export function refusalKind(code: unknown): "unconfirmed" | "refused" {
  return code === "FC_UNCONFIRMED" ? "unconfirmed" : "refused";
}

/** PUB-4 / UXC-05: the Act as… picker's line after an answer — the route's own `delivery` sentence (and the cast's
 *  address on farcaster.xyz when it went there), never a fixed "Posted as @x." */
export interface ActAsOutcome {
  tone: "farcaster" | "layers" | "error";
  message: string;
  url: string | null;
  detail: string | null;
}

export function actAsOutcome(ok: boolean, body: unknown, fallbackHandle: string | null): ActAsOutcome {
  const j = (body && typeof body === "object" ? body : {}) as { error?: unknown; hint?: unknown; delivery?: { to?: unknown; message?: unknown; url?: unknown; warning?: unknown; pointer?: unknown } };
  if (!ok) {
    return {
      tone: "error",
      message: typeof j.error === "string" && j.error ? j.error : "Something went wrong. Try again.",
      url: null,
      detail: typeof j.hint === "string" && j.hint ? j.hint : null,
    };
  }
  const d = j.delivery;
  if (d && typeof d.message === "string" && d.message) {
    const toFarcaster = d.to === "farcaster";
    return {
      tone: toFarcaster ? "farcaster" : "layers",
      message: d.message,
      url: toFarcaster && typeof d.url === "string" && /^https:\/\/farcaster\.xyz\//.test(d.url) ? d.url : null,
      detail: typeof d.warning === "string" && d.warning ? d.warning : typeof d.pointer === "string" && d.pointer ? d.pointer : null,
    };
  }
  // an answer with no delivery line (a route that predates it): say only what is known — it was saved here
  return { tone: "layers", message: `Saved in Totem as @${fallbackHandle ?? "this persona"}.`, url: null, detail: null };
}
