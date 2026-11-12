// PUBLIC GO-LIVE — THE GUIDED FIRST RUN'S X STEP: "is the Farcaster account you signed in with verified on X?"
//
// Farcaster lets an account verify an X handle; the keyless X index (validator/xindex.js, VALIDATOR_X_INDEX=on) lists
// those verifications, and the device downloads it WHOLE and looks its own account up locally (byFid). So there is NO
// per-account request anywhere: the validator sees "this address downloaded the index", the same file everyone gets
// (A-X-INDEX-FETCH-IS-A-PAGE-VIEW), never which account matched. It is NEVER looked up through the read relay: a relay
// lookup of the visitor's own account would hand the relay's operator the visitor's account number together with
// their address.
//
// NEVER FAIL OPEN. Four answers, and only one of them says "no X account":
//   connected  — the index lists this account with an X handle;
//   none       — the index was READ and lists no X handle for this account;
//   unknown    — the index is not built on this site (503), the download failed or was damaged: the step says it
//                couldn't check here, never "no X account";
//   no-account — there is no signed-in Farcaster account to look up (the step offers the archive import alone).
// Pure over its inputs (the index fetcher is passed in): scripts/unit-onboarding.mjs drives every branch with a fake.

/** the parts of lib/x/indexClient.ts's XIndex this lookup reads */
export interface IndexLike {
  byFid: Map<number, number[]>;
  xu: string[];
  at: ArrayLike<number>;
}
export type IndexFetch = () => Promise<{ available: true; index: IndexLike } | { available: false; reason: string }>;

export type XHandleAnswer =
  | { state: "connected"; handle: string; verifiedAt: number }
  | { state: "none" }
  | { state: "unknown"; reason: string }
  | { state: "no-account" };

/** the row for a fid in a downloaded index: the most recently verified X handle when Farcaster lists more than one */
export function handleForFid(index: IndexLike, fid: number): { handle: string; verifiedAt: number } | null {
  const rows = index.byFid.get(fid);
  if (!rows || rows.length === 0) return null;
  let best = rows[0];
  for (const i of rows) if ((index.at[i] ?? 0) > (index.at[best] ?? 0)) best = i;
  const handle = String(index.xu[best] ?? "").trim();
  if (!handle) return null;
  return { handle, verifiedAt: Math.round((index.at[best] ?? 0) * 1000) };
}

/**
 * The X step's answer for the signed-in account `fid` (null = no signed-in account). The index is downloaded whole by
 * `fetchIndex` (the device's lib/x/indexClient.ts fetchIndex in the app); a throw or an unavailable index is "unknown".
 */
export async function xHandleForFid(fid: number | null, fetchIndex: IndexFetch): Promise<XHandleAnswer> {
  if (fid === null || !Number.isSafeInteger(fid) || fid <= 0) return { state: "no-account" };
  let answer: Awaited<ReturnType<IndexFetch>>;
  try {
    answer = await fetchIndex();
  } catch (e) {
    return { state: "unknown", reason: String((e as Error)?.message ?? e).slice(0, 200) || "the X list could not be downloaded" };
  }
  if (!answer || answer.available !== true) {
    const reason = answer && answer.available === false && typeof answer.reason === "string" ? answer.reason : "the X list is not available on this site";
    return { state: "unknown", reason: reason.slice(0, 200) };
  }
  const row = handleForFid(answer.index, fid);
  return row ? { state: "connected", handle: row.handle, verifiedAt: row.verifiedAt } : { state: "none" };
}

/** the step's sentence for an answer (plain words; "couldn't check here" is never "no X account") */
export function xHandleSentence(a: XHandleAnswer): string {
  switch (a.state) {
    case "connected":
      return `Your Farcaster account is verified as @${a.handle} on X.`;
    case "none":
      return "Your Farcaster account has no X account verified on it.";
    case "unknown":
      return "We couldn't check here whether your Farcaster account has an X account verified on it.";
    case "no-account":
      return "Sign in with Farcaster to see an X account verified on it.";
  }
}

/** read a route answer back into an XHandleAnswer (anything malformed is "unknown", never "none") */
export function readXHandleAnswer(j: unknown): XHandleAnswer {
  const o = (j && typeof j === "object" ? (j as { x?: unknown }).x : null) as Record<string, unknown> | null;
  if (!o || typeof o !== "object") return { state: "unknown", reason: "the answer could not be read" };
  if (o.state === "connected" && typeof o.handle === "string" && o.handle.trim()) return { state: "connected", handle: o.handle, verifiedAt: typeof o.verifiedAt === "number" ? o.verifiedAt : 0 };
  if (o.state === "none") return { state: "none" };
  if (o.state === "no-account") return { state: "no-account" };
  return { state: "unknown", reason: typeof o.reason === "string" ? o.reason : "the answer could not be read" };
}
