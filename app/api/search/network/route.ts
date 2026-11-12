import { NextRequest, NextResponse } from "next/server";
// NEYNAR AS A SWITCH (SECURITY-POSTURE.md §42) — SEARCH ON FARCASTER, VIA NEYNAR, AFTER THE DEVICE.
//
// GET ?q=  The search page's second section. The device's own search (/api/search, /api/search/unified) always runs and
// shows first; this route adds posts and people found through the read relay's search ops (lib/fc/readRelay.server.ts
// "search-casts" / "search-users"), ONLY while the operator switched search to Neynar (FC_SOURCE_SEARCH=neynar|auto, the
// device hint) and the relay is armed. The browser device answers it in the tab (a server render never relays).
//
// What the relay is sent: the visitor's query, normalised (lib/fc/source/switch.ts normaliseSearchQuery), and nothing
// else — no fid, no persona, no handle list, no viewer_fid (the relay refuses every other body key and every other upstream
// parameter). One more guard on THIS side, because the relay cannot know who is asking: a query that names one of this
// visitor's own accounts (a persona's handle, the root's fname or handle, any of their fids) is NEVER sent — Totem's
// server would see that name from this browser's address. Unknown (the vault or the link unreadable) refuses the send
// (fail closed), and says so.
//
// The answer always says where its results came from and why there are none: source "neynar" (label "Via Neynar"),
// "network" (search is not switched to Neynar: the device was searched alone), "unarmed" (switched on, no read key),
// "names_you" (the guard). Never an empty list that reads as "nothing on Farcaster".
import { deviceNeynarOn, deviceNeynarUnarmed, FC_SOURCE_LABELS, normaliseSearchQuery, queryNamesOwnAccount, searchQueryAllowed } from "@/lib/fc/source/switch";

export const dynamic = "force-dynamic";

// (not exported: a route module may export only its handlers and route options)
const SEARCH_SENTENCES = {
  network: "Search isn't switched to Neynar on this site, so only your device was searched. Farcaster's network has no search.",
  unarmed: "Search via Neynar is switched on, but Neynar isn't connected on this site (no read key), so only your device was searched.",
  namesYou: "This search names one of your own accounts, so it was not sent to Neynar: only your device was searched.",
  ownUnknown: "Couldn't check that this search names none of your own accounts, so it was not sent to Neynar.",
} as const;

/** this visitor's own account names and fids: every persona's handle, the persona accounts' fnames and fids, and the
 *  root's linked Farcaster account. THROWS when any of them cannot be read (the caller sends nothing). */
async function ownAccounts(): Promise<{ names: string[]; fids: number[] }> {
  const names: string[] = [];
  const fids: number[] = [];
  const { getSession } = await import("@/lib/session");
  await getSession(); // adopt the roster (a persona minted after boot) before reading the handles
  const { ownPersonaIdsAll } = await import("@/lib/influence/allowance");
  const { personaById } = await import("@/lib/adapters/mock/store");
  const { activeSeedPersonaId } = await import("@/lib/activePersona");
  const ids = new Set(await ownPersonaIdsAll());
  const active = activeSeedPersonaId();
  if (active) ids.add(active);
  for (const id of ids) {
    const h = personaById.get(id)?.handle;
    if (h) names.push(h);
  }
  const { ownPersonaAccounts } = await import("@/lib/fc/hubRead/separation");
  const own = await ownPersonaAccounts();
  for (const f of own.fids) fids.push(f);
  for (const n of own.names.values()) if (n) names.push(n);
  const { mainLink } = await import("@/lib/fc/siwf/links");
  const link = await mainLink();
  if (link) {
    fids.push(link.fid);
    if (link.fname) names.push(link.fname);
  }
  return { names, fids };
}

export async function GET(req: NextRequest) {
  const q = normaliseSearchQuery(req.nextUrl.searchParams.get("q") ?? "");
  if (!searchQueryAllowed(q)) return NextResponse.json({ error: "a search is 2 to 64 characters", code: "bad_query" }, { status: 400 });
  const empty = { q, casts: [], users: [] };
  if (!deviceNeynarOn("search")) {
    const unarmed = deviceNeynarUnarmed("search");
    return NextResponse.json({ ...empty, source: unarmed ? "unarmed" : "network", label: FC_SOURCE_LABELS.device, sentence: unarmed ? SEARCH_SENTENCES.unarmed : SEARCH_SENTENCES.network });
  }
  let own: { names: string[]; fids: number[] };
  try {
    own = await ownAccounts();
  } catch {
    return NextResponse.json({ error: SEARCH_SENTENCES.ownUnknown, code: "own_unreadable" }, { status: 503 });
  }
  if (queryNamesOwnAccount(q, own)) {
    return NextResponse.json({ ...empty, source: "names_you", label: FC_SOURCE_LABELS.device, sentence: SEARCH_SENTENCES.namesYou });
  }
  const { relaySearchCasts, relaySearchUsers, RelayReadError } = await import("@/lib/adapters/neynar/content");
  try {
    const [casts, users] = await Promise.all([relaySearchCasts(q), relaySearchUsers(q)]);
    const stale = casts.stale || users.stale;
    return NextResponse.json({ q, source: "neynar", label: FC_SOURCE_LABELS.neynar, state: stale ? "stale" : "live", casts: casts.value, users: users.value });
  } catch (e) {
    if (e instanceof RelayReadError) return NextResponse.json({ error: e.message, code: e.code }, { status: 503 });
    return NextResponse.json({ error: "Farcaster could not be searched via Neynar just now.", code: "search_failed" }, { status: 503 });
  }
}
