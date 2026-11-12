import { NextRequest, NextResponse } from "next/server";
// PUBLIC GO-LIVE — THE GUIDED FIRST RUN'S DEVICE QUESTIONS (components/onboarding/Onboarding.tsx).
//
// A DEVICE ROUTE (scripts/device-routes.mjs does not list it as server-only): on the public site the visitor's tab
// answers it in-process, and the app server never hears of it. A request that reaches a PUBLIC server is refused
// 404 device_only before anything is read (the /api/fc/siwf precedent). On the rig and the owner service there is no
// guided first run (their app pages run no browser device): it answers "not offered here".
//
//   GET          the public self in two booleans (signed in, disconnected), read from the sealed accountLinks record on
//                this device — fail closed: an unreadable record is a 503, never "not signed in". SIGN IN WITH X: and the
//                root's X account in two more (xSignedIn, xDisconnected), from the same read of the same record.
//   GET ?x=1     This is you's X row: the signed-in Farcaster account's X handle as Farcaster verifies it, looked up in
//                the WHOLE keyless X index downloaded by this device (lib/onboarding/xHandle.ts: never a per-account
//                request, never the read relay). The account number never leaves this route; the answer carries only
//                the handle.
//   GET ?profile=1  This is you: the root's picture, name and username as Totem holds them (the public self persona Sign
//                in with Farcaster minted), the Farcaster username, and — when the username the Farcaster account would
//                take is already someone else's inside Totem — `taken` and three free alternatives. SIGN IN WITH X: a root
//                signed in with X only gets the same answer from its X account (via "x", xUsername, xPfp); POST then
//                takes the X picture, and Show shows the X account it signed in with (X said so: no index lookup).
//   POST         This is you, confirmed: {name, handle, avatarUrl, showX} — the root's name, its username INSIDE Totem
//                (its Farcaster username is untouched), its picture (the Farcaster one or one made on this device), and
//                whether its Totem profile shows the X account Farcaster verified (looked up again here, never trusted
//                from the page). Written to the keystore persona, the rendering maps and both rosters; a roster that
//                cannot be written is a 503 (the same request again finishes it).
import { isPublicDeployment } from "@/lib/platform/env-contract";

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

function offDevice(): NextResponse | null {
  if (typeof window !== "undefined") return null;
  if (isPublicDeployment()) return NextResponse.json({ error: "This is answered in your browser.", code: "device_only" }, { status: 404, headers: NO_STORE });
  return NextResponse.json({ offered: false, reason: "The guided first run is the public site's; here, use Settings › Account." }, { headers: NO_STORE });
}

type Link = { fid: number; fname: string | null; pfpUrl: string | null; personaId: string; disconnectedAt: number | null };
type XLink = { xid: string; username: string; name: string | null; pfpUrl: string | null; personaId: string; disconnectedAt: number | null };

/** SIGN IN WITH X: both of the root's accounts, from ONE read of the sealed record. THROWS on an unreadable record. */
async function readLinks(): Promise<{ farcaster: Link | null; x: XLink | null }> {
  const { rootLinks } = await import("@/lib/fc/siwf/links");
  return rootLinks();
}

const UNREADABLE = () => NextResponse.json({ error: "We couldn't check your Farcaster sign-in just now. Try again.", code: "unreadable" }, { status: 503, headers: NO_STORE });

/** is `handle` someone else's inside Totem (this device's handle namespace: its own personas and every account it knows) */
async function takenBy(selfId: string): Promise<(h: string) => boolean> {
  const { personaByHandle } = await import("@/lib/adapters/mock/store");
  const ks = await import("@/lib/identity/keystore");
  const own = ks.listPersonas().filter((p) => p.id !== selfId);
  return (h: string) => {
    const x = h.toLowerCase();
    const other = personaByHandle.get(x);
    if (other && other.id !== selfId) return true;
    return own.some((p) => p.handle.toLowerCase() === x);
  };
}

/** SIGN IN WITH X — This is you for a root that signed in with X only: its public self, filled in from X */
async function xProfile(xl: XLink): Promise<NextResponse> {
  try {
    const { getSession } = await import("@/lib/session");
    await getSession(); // the session adopts the keystore roster into the handle maps first (never answer from half of them)
    const ks = await import("@/lib/identity/keystore");
    const self = ks.getPersona(xl.personaId);
    if (!self || self.publicSelf !== true) throw new Error("the signed-in account's persona is not on this device");
    const { handleSuggestions } = await import("@/lib/onboarding/state");
    const { handleFromX } = await import("@/lib/x/signin/pkce");
    const wanted = handleFromX(xl.username);
    const isTaken = await takenBy(self.id);
    const taken = self.handle !== wanted && isTaken(wanted);
    return NextResponse.json(
      {
        offered: true,
        publicSelf: false,
        xSignedIn: true,
        profile: {
          name: self.name,
          handle: self.handle,
          avatarUrl: self.avatarUrl,
          farcasterPfp: null,
          fname: null,
          wanted,
          taken,
          suggestions: taken ? handleSuggestions(wanted, isTaken, 3) : [],
          xShown: typeof self.xShown === "string" ? self.xShown : null,
          via: "x",
          xUsername: xl.username,
          xPfp: xl.pfpUrl,
        },
      },
      { headers: NO_STORE }
    );
  } catch (e) {
    console.error("[onboarding] the profile could not be read: " + ((e as Error)?.name ?? "Error"));
    return NextResponse.json({ error: "We couldn't read your profile just now. Try again.", code: "profile_unreadable" }, { status: 503, headers: NO_STORE });
  }
}

export async function GET(req: NextRequest) {
  const off = offDevice();
  if (off) return off;
  let link: Link | null;
  let xl: XLink | null;
  try {
    ({ farcaster: link, x: xl } = await readLinks());
  } catch (e) {
    console.error("[onboarding] the sign-in record could not be read: " + ((e as Error)?.name ?? "Error"));
    return UNREADABLE();
  }
  const signedIn = !!link && link.disconnectedAt === null;
  // SIGN IN WITH X: the root's X account, signed in (not a tombstone)
  const xSignedIn = !!xl && xl.disconnectedAt === null;
  const q = req.nextUrl.searchParams;
  if (q.get("profile") === "1") {
    if (!signedIn && xSignedIn && xl) return xProfile(xl);
    if (!signedIn || !link) return NextResponse.json({ offered: true, publicSelf: false, xSignedIn, profile: null }, { headers: NO_STORE });
    try {
      const { getSession } = await import("@/lib/session");
      await getSession(); // the session adopts the keystore roster into the handle maps first (never answer from half of them)
      const ks = await import("@/lib/identity/keystore");
      const self = ks.getPersona(link.personaId);
      if (!self || self.publicSelf !== true) throw new Error("the signed-in account's persona is not on this device");
      const { handleFromFname, handleSuggestions } = await import("@/lib/onboarding/state");
      const wanted = handleFromFname(link.fname);
      const isTaken = await takenBy(self.id);
      const taken = isTaken(wanted);
      return NextResponse.json(
        {
          offered: true,
          publicSelf: true,
          profile: {
            name: self.name,
            handle: self.handle,
            avatarUrl: self.avatarUrl,
            farcasterPfp: link.pfpUrl,
            fname: link.fname,
            wanted,
            taken,
            suggestions: taken ? handleSuggestions(wanted, isTaken, 3) : [],
            xShown: typeof self.xShown === "string" ? self.xShown : null,
            // SIGN IN WITH X: the X account this root also signed in with (This is you shows it as its own row)
            via: "farcaster",
            xUsername: xSignedIn && xl ? xl.username : null,
          },
        },
        { headers: NO_STORE }
      );
    } catch (e) {
      console.error("[onboarding] the profile could not be read: " + ((e as Error)?.name ?? "Error"));
      return NextResponse.json({ error: "We couldn't read your profile just now. Try again.", code: "profile_unreadable" }, { status: 503, headers: NO_STORE });
    }
  }
  if (q.get("x") !== "1")
    return NextResponse.json(
      { offered: true, publicSelf: signedIn, disconnected: !!link && link.disconnectedAt !== null, xSignedIn, xDisconnected: !!xl && xl.disconnectedAt !== null },
      { headers: NO_STORE }
    );
  const { xHandleForFid } = await import("@/lib/onboarding/xHandle");
  const { fetchIndex } = await import("@/lib/x/indexClient");
  const x = await xHandleForFid(signedIn ? link!.fid : null, () => fetchIndex());
  return NextResponse.json({ offered: true, publicSelf: signedIn, x }, { headers: NO_STORE });
}

export async function POST(req: NextRequest) {
  const off = offDevice();
  if (off) return off;
  const body = (await req.json().catch(() => null)) as { name?: unknown; handle?: unknown; avatarUrl?: unknown; showX?: unknown } | null;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const handle = typeof body?.handle === "string" ? body.handle.trim().toLowerCase() : "";
  if (!name || name.length > 50) return NextResponse.json({ error: "Your name needs 1 to 50 characters.", code: "bad_name" }, { status: 400, headers: NO_STORE });
  if (!/^[a-z0-9_]{1,30}$/.test(handle)) return NextResponse.json({ error: "Your username needs 1 to 30 letters, digits or underscores.", code: "bad_handle" }, { status: 400, headers: NO_STORE });
  let link: Link | null;
  let xl: XLink | null;
  try {
    ({ farcaster: link, x: xl } = await readLinks());
  } catch {
    return UNREADABLE();
  }
  const fcLive = !!link && link.disconnectedAt === null;
  // SIGN IN WITH X: a root signed in with X only confirms This is you the same way, from its X account
  const xLive = !!xl && xl.disconnectedAt === null;
  if (!fcLive && !xLive) return NextResponse.json({ error: "Sign in with Farcaster first.", code: "not_signed_in" }, { status: 409, headers: NO_STORE });
  const { getSession } = await import("@/lib/session");
  const session = await getSession();
  const ks = await import("@/lib/identity/keystore");
  const self = ks.getPersona(fcLive ? link!.personaId : xl!.personaId);
  if (!self || self.publicSelf !== true)
    return NextResponse.json(
      { error: fcLive ? "Your Farcaster account's profile isn't on this device. Sign in with Farcaster again." : "Your X account's profile isn't on this device. Sign in with X again.", code: "no_public_self" },
      { status: 409, headers: NO_STORE }
    );

  // the username: free inside Totem, and never one a persona of yours shares a name with (matching names publicly link
  // the persona to you — the handle stem rule, lib/identity/handleStem.ts)
  if (handle !== self.handle) {
    const isTaken = await takenBy(self.id);
    if (isTaken(handle)) {
      const { handleSuggestions } = await import("@/lib/onboarding/state");
      return NextResponse.json({ error: "@" + handle + " is taken on Totem.", code: "handle_taken", suggestions: handleSuggestions(handle, isTaken, 3) }, { status: 409, headers: NO_STORE });
    }
    const { handleDerivedFrom } = await import("@/lib/identity/handleStem");
    const clash = ks.listPersonas().find((p) => p.id !== self.id && handleDerivedFrom(handle, p.handle));
    if (clash) return NextResponse.json({ error: "Your persona @" + clash.handle + " shares a name with @" + handle + ". Matching names would publicly link them: pick another username.", code: "handle_stem" }, { status: 409, headers: NO_STORE });
  }

  // the picture: the Farcaster account's own (SIGN IN WITH X: or the X account's), or one made on this device — nothing
  // else is taken from the page
  const { isLocalAvatar } = await import("@/lib/identity/localAvatar");
  const pic = body?.avatarUrl;
  const accountPic = (s: string) => (fcLive && !!link!.pfpUrl && s === link!.pfpUrl) || (xLive && !!xl!.pfpUrl && s === xl!.pfpUrl);
  let avatarUrl: string | null;
  if (pic === null || pic === undefined) avatarUrl = self.avatarUrl;
  else if (typeof pic === "string" && (accountPic(pic) || pic === self.avatarUrl || (isLocalAvatar(pic) && pic.length <= 2000))) avatarUrl = pic;
  else return NextResponse.json({ error: "That picture can't be used here.", code: "bad_picture" }, { status: 400, headers: NO_STORE });

  // the X account: SIGN IN WITH X — the X account this root signed in with, when it did (X itself said so); otherwise the
  // one its Farcaster account verifies, looked up again from the whole downloaded index (never trusted from the page); a
  // lookup that fails is a refusal with the reason, never "no X account"
  let xShown: string | null = null;
  if (body?.showX === true && xLive) xShown = xl!.username;
  else if (body?.showX === true && fcLive) {
    const { xHandleForFid } = await import("@/lib/onboarding/xHandle");
    const { fetchIndex } = await import("@/lib/x/indexClient");
    const x = await xHandleForFid(link!.fid, () => fetchIndex());
    if (x.state === "unknown") return NextResponse.json({ error: "We couldn't check your X account just now (" + x.reason + "). Try again, or turn Show off.", code: "x_unknown" }, { status: 503, headers: NO_STORE });
    xShown = x.state === "connected" ? x.handle : null;
  }

  const updated = ks.updatePersona(self.id, { name, handle, avatarUrl, xShown });
  if (!updated) return NextResponse.json({ error: "Your profile vanished from this device's keystore; nothing was changed.", code: "no_public_self" }, { status: 409, headers: NO_STORE });
  // the rendering maps: the new handle resolves, the old one no longer does
  const { personaById, personaByHandle } = await import("@/lib/adapters/mock/store");
  const prev = personaById.get(self.id);
  if (prev) {
    if (prev.handle !== handle && personaByHandle.get(prev.handle) === prev) personaByHandle.delete(prev.handle);
    const next = { ...prev, name, handle, avatarUrl: avatarUrl ?? "" };
    personaById.set(self.id, next);
    personaByHandle.set(handle, next);
  }
  try {
    if (session.rootId) {
      const { recordPersona } = await import("@/lib/identity/rootRoster");
      await recordPersona(session.rootId, self.id, { id: self.id, name, handle, avatarUrl, bio: updated.bio, createdAt: updated.createdAt, publicSelf: true });
    }
    const { syncRoster } = await import("@/lib/identity/roster");
    await syncRoster();
  } catch (e) {
    return NextResponse.json({ error: "Saved on this device, but your roster could not be written (" + (e as Error).message + "). Press Continue again to finish.", code: "roster_unavailable" }, { status: 503, headers: NO_STORE });
  }
  return NextResponse.json({ ok: true, profile: { name, handle, avatarUrl, xShown } }, { headers: NO_STORE });
}
