import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getLiveOnX, getNews, getSelf, getTrends, getWhoToFollow } from "@/lib/data";
import { getSession } from "@/lib/session";
import { legacyValidatorTier, personaTier } from "@/lib/rep/personaTier";
import { Providers } from "@/components/Providers";
import { RightRailSwitcher } from "@/components/RightRailSwitcher";
import { ComposeModalHost } from "@/components/ComposeModal";
import { FloatingActions } from "@/components/FloatingActions";
import { MobileFab, MobileTabBar } from "@/components/MobileChrome";
import { adapters } from "@/lib/adapters/registry";
import { retryAdapter } from "@/lib/adapters/retry";
import { activeSeedPersonaId } from "@/lib/activePersona";
import { deviceEnv } from "@/lib/device/deviceEnv.server";
import { isPublicDeployment } from "@/lib/platform/env-contract";
import { isPublicLive } from "@/lib/platform/publicLive";
import { docsUrl, postureUrl } from "@/lib/platform/preview";
import { DeviceHostMount } from "@/components/device/DeviceHostMount";
import { IdentityNudge } from "@/components/device/IdentityNudge";
import { PreviewBanner } from "@/components/PreviewBanner";
import { ChromeRoot, type ChromeInitial } from "@/components/ChromeRoot";
import { modeEdgeOf, tintsFor, viewScope, washOf } from "@/lib/identity/chrome";
import { OWNER_COOKIE, OWNER_LOGIN_PATH, ownerSessionRefused, readOwnerSecret } from "@/lib/platform/owner-access";
import { ownerGateStateSource } from "@/lib/platform/owner-store.server";
import { OwnerSessionWatch } from "@/components/owner/OwnerSessionWatch";

export const dynamic = "force-dynamic";

// PROD-LIVE (D-CU-0-4, built: "a production server renders public state only").
//
// On a PUBLIC deployment the server holds no identity by design — no keystore, no device key; the visitor's identity
// is the browser device that answers /api/* in the tab. Every identity read this layout used to make (getSession, the
// tier loop, the active mode, the persona-chrome vault record, activeSeedPersonaId) reaches for a device key the
// server refuses to mint, and hydrate() memoises its failed promise per process, so ONE such read broke every later
// adapter call on the server. So on a public deployment this layout reads NOTHING that is identity: it renders the
// shell (fixture right-rail content is public), mounts the device, and hands the chrome to ChromeRoot with
// `initial={null}` — the island reads /api/persona/chrome and /api/modes through the device once it boots, and
// Providers reads the roster the same way. The server's fixture persona id is never handed to a client there.
//
// On the RIG (ZK_DEV_HOOKS=true — how every acceptance suite runs) every read below happens exactly as before and
// ChromeRoot renders the result as its initial data: the DOM the post-deploy suites assert (the tint root's data
// attributes, the pill, the rail) is unchanged.
//
// renderNonce is new on every server render, so router.refresh() changes it and every island that fetched its own
// data (useApiJson) fetches again — the half of router.refresh() a keyless server cannot render.
export default async function MainLayout({ children }: { children: React.ReactNode }) {
  // PROD-LIVE (D-PRODLIVE-OWNER-SERVICE; review: the favicon matcher bypass) — DEFENCE IN DEPTH. On the owner service
  // this layout renders the owner's roster, tier map and chrome, so it verifies the owner's session cookie itself
  // (the same readOwnerCookie + ownerSessionLive middleware.ts runs) and sends anyone without one to the login page BEFORE any read
  // below. The middleware stays the gate; this is what keeps the roster out of the payload when a matcher mistake
  // lets a request past it. A no-op without OWNER_ACCESS_SECRET — the rig laptop and the public preview never read
  // the cookie store here. Scope, stated: in the App Router a page renders in parallel with its layout (the layout
  // is handed a LayoutRouter; the page's segment is a separate slot of the payload), so a redirect thrown here does
  // not stop a PAGE's own server render — the middleware is the only gate for what pages compute.
  // OWNER PASSKEYS: "a session" means a LIVE one — the current epoch, and its passkey (if it came from one) still
  // registered — read here straight from the owner app's volume.
  if (await ownerSessionRefused(() => cookies().get(OWNER_COOKIE)?.value, process.env, ownerGateStateSource)) redirect(OWNER_LOGIN_PATH);
  const deviceIsThePage = isPublicDeployment();
  // PUBLIC GO-LIVE (lib/platform/publicLive.ts): live mode on the public site. The server's right rail reads the empty
  // twin of the fixture bank (lib/world-flag.ts bank), the device in the tab runs the empty world, and the chrome is told
  // so (Providers.publicLive / emptyWorld): no fixture fallbacks, the guided first run at /welcome, honest copy.
  const live = deviceIsThePage && isPublicLive();
  const renderNonce = randomUUID();
  const [trends, news, liveRooms, whoToFollow] = await Promise.all([
    getTrends(),
    getNews(),
    getLiveOnX(),
    getWhoToFollow(),
  ]);
  const rightRail = <RightRailSwitcher trends={trends} news={news} live={liveRooms} whoToFollow={whoToFollow} publicLive={live} />;

  if (deviceIsThePage) {
    // BROWSER KEYSTORE PASS Gate 6 (D-CU-0-3, at the app group: D-CU-6-THE-APP-GROUP-IS-THE-DEVICE-ON-A-PUBLIC-
    // DEPLOYMENT): every page under this group runs the visitor's own device. The early bootstrap (boot.js) is loaded
    // by the ROOT layout with next/script "beforeInteractive", so it runs before hydration on every document —
    // including one reached by a soft navigation, where a <script> element React inserts is never executed (the old
    // in-group tag was exactly that on a soft navigation). DeviceHostMount then boots the device, drains what was
    // queued, and renders the boot state (DeviceStatus).
    return (
      <Providers personas={[]} activePersonaId={null} tiers={{}} deviceIsThePage renderNonce={renderNonce} actingPersonaId={null} {...(live ? { emptyWorld: true, publicLive: true } : {})}>
        <DeviceHostMount env={publicDeviceEnv()} />
        <PreviewBanner docsUrl={docsUrl()} postureHref={postureUrl(docsUrl())} {...(live ? { live: true } : {})} />
        <IdentityNudge />
        <ChromeRoot initial={null} rightRail={rightRail}>
          {children}
        </ChromeRoot>
        <FloatingActions />
        <MobileTabBar />
        <MobileFab />
        <ComposeModalHost />
      </Providers>
    );
  }

  // ------------------------------------------------------------------ the rig: every read as before ----------
  const session = await getSession();
  // The active mode's nav slots. Fails OPEN, like the composer half: failing
  // closed on navigation strands the user on a page with no way out.
  let navSlots: string[] | undefined;
  let activeMode: { id: string; name: string } | null = null;
  try {
    // LAYERS_WORLD=empty (lib/world.ts): with no persona yet there is no mode to read — and asking would mint preset
    // modes for the persona "" (the demo world always has its seeded self here)
    const forPersona = activeSeedPersonaId();
    if (!forPersona && (await import("@/lib/world")).isEmptyWorld()) throw new Error("no persona yet");
    const mode = await retryAdapter(() => adapters.mode.getActive(forPersona));
    activeMode = { id: mode.id, name: mode.name };
    const configured = mode.actionButtonSlots?.nav;
    if (Array.isArray(configured) && configured.length) navSlots = configured;
  } catch {
    navSlots = undefined;
  }

  // POST-DEPLOY Gate 2 — PERSONA TINT + SCOPE.
  //
  // The tint keys off the SEEDED acting persona (the one a post would be made
  // as), not the Providers roster — those are two identity tracks, and tinting
  // the chrome for one while acting as the other is precisely the confusion
  // this cue exists to remove.
  //
  // It fails OPEN, and only this far: an unreadable chrome record leaves the
  // chrome UNTINTED (no wash, no edge) and the pill unchanged. The pill is the
  // real signal and it does not depend on the vault; losing the shortcut is a
  // degradation, losing the handle would be a lie. The SCOPE half never fails
  // open — viewScope throws, and the routes that enforce it answer 503.
  const actingId = activeSeedPersonaId();
  const { personaById } = await import("@/lib/adapters/mock/store");
  // LAYERS_WORLD=empty (lib/world.ts): no real persona yet means no acting handle at all (null — the pill says so),
  // never a fallback to anybody's
  const { isEmptyWorld } = await import("@/lib/world");
  const actingHandle = isEmptyWorld() && !actingId ? null : personaById.get(actingId)?.handle ?? getSelf().username;
  let tintColor: string | null = null;
  let tintSource = "unavailable";
  let visibleIds: string[] | null = null;
  let scopeUnavailable = false;
  // GATE 5 (attack-post-3 F-4): the tint and the SCOPE are caught SEPARATELY, because they
  // fail in opposite directions. Losing the tint is a degradation — the chrome renders
  // untinted and the pill still names the persona. Losing the scope is a PROTECTION
  // failure, and one shared catch meant a single unreadable record left the switcher
  // showing the full roster while compartment mode was on.
  try {
    // The auto-assignment is DISTINCT-ACROSS-SIBLINGS, so it has to see the
    // whole roster: asking for one persona at a time would hand every persona
    // the first palette entry and quietly defeat the entire cue.
    const { ownPersonaIdsAll } = await import("@/lib/influence/allowance");
    const own = await ownPersonaIdsAll();
    const tints = await tintsFor(own.includes(actingId) ? own : [...own, actingId]);
    tintColor = tints[actingId]?.color ?? null;
    tintSource = tints[actingId]?.source ?? "unavailable";
  } catch {
    tintColor = null;
    tintSource = "unavailable";
  }
  try {
    // The SWITCHER's roster is the session track; the TINT is the seeded acting
    // track. They are two identity universes in this codebase and scoping one by
    // the other's active id emptied the switcher entirely — compartment mode is
    // meant to narrow a roster to its active persona, never to erase it.
    const scope = await viewScope(session.active?.id ?? actingId, session.personas.map((p) => p.id));
    visibleIds = scope.visiblePersonaIds;
  } catch {
    // FAIL CLOSED. An unreadable chrome record cannot be read as "no compartment":
    // the roster narrows to the active persona until the record can be read again,
    // which is the same answer compartment mode itself would give.
    visibleIds = session.active ? [session.active.id] : [];
    scopeUnavailable = true;
  }
  const modeEdge = modeEdgeOf(activeMode?.id ?? null);
  // Compartment mode suppresses the switcher's roster at the DATA layer too
  // (/api/personas filters the same way) — this is the server render agreeing
  // with the route, not a second opinion.
  const visiblePersonas = visibleIds ? session.personas.filter((p) => visibleIds!.includes(p.id)) : session.personas;

  // ZK PASS 2 Gate 1: PROOF under zk (0 = not proven, rendered as such);
  // the phase-1 validator read under the legacy bindings, unchanged.
  //
  // PROD-LIVE (review: the tier map outran the roster): the map is built for the VISIBLE personas only, AFTER the
  // scope is known. It used to be filled from the unscoped session.personas before the scope was read, so with
  // compartment mode on (or the scope unreadable) the switcher's roster narrowed while the payload handed to the
  // client still carried a tier keyed by every hidden sibling's id — the persona set the roster exists to withhold,
  // in the RSC payload, and one legacy tier read per hidden persona. It now fails closed exactly as the roster does
  // (an unreadable scope leaves the active persona's tier, or none). The DOM is unchanged: AccountSwitcher only ever
  // rendered tiers[p.id] for the personas it was handed, which were already the visible ones.
  const tiers: Record<string, number> = {};
  // ZK PASS 2 Gate 4 (attack-z2-1 #1): under zk the switcher reads the
  // gate's eligibility MAP once (the same read the feed build makes) and
  // indexes it locally — never one device-signed read PER OWN PERSONA,
  // which handed the operator the device's persona set on every render.
  const { currentRepImpl } = await import("@/lib/adapters/registry");
  if (currentRepImpl() === "zk") {
    const { fetchEligibilityMap } = await import("@/lib/zk/validatorClient");
    const { zkMode } = await import("@/lib/zk/config");
    const { GATE_ID } = await import("@/lib/zk/gate");
    let map: Record<string, number> = {};
    try {
      map = await fetchEligibilityMap(zkMode(), GATE_ID);
    } catch {
      map = {};
    }
    for (const p of visiblePersonas) tiers[p.id] = map[p.id] ?? 0;
  } else {
    for (const p of visiblePersonas) {
      const t = await personaTier(p.id, () => legacyValidatorTier(p.id));
      if (t !== undefined) tiers[p.id] = t;
    }
  }

  // PROD-LIVE: the same values the tint root and the pills rendered from, handed to the client chrome as its initial
  // data (ChromeRoot renders them without fetching). washOf/modeEdgeOf stay the server's own (lib/identity/chrome.ts).
  const chrome: ChromeInitial = {
    actingId,
    actingHandle,
    tint: tintColor,
    tintSource,
    wash: tintColor ? washOf(tintColor) : null,
    modeEdge,
    modeId: activeMode?.id ?? "",
    modeName: activeMode?.name ?? null,
    scope: scopeUnavailable ? "unavailable" : visibleIds && visibleIds.length === 1 && session.personas.length > 1 ? "compartment" : "normal",
    navSlots,
    selfHandle: getSelf().username,
  };

  return (
    <Providers
      personas={visiblePersonas}
      activePersonaId={session.active?.id ?? null}
      tiers={tiers}
      renderNonce={renderNonce}
      actingPersonaId={actingId}
      emptyWorld={isEmptyWorld()}
    >
      <ChromeRoot initial={chrome} rightRail={rightRail}>
        {children}
      </ChromeRoot>
      <FloatingActions />
      <MobileTabBar />
      <MobileFab />
      <ComposeModalHost />
      {/* OWNER PASSKEYS (review UX-14): on the owner service only — a session that ends while a page is open says so */}
      {readOwnerSecret() !== null ? <OwnerSessionWatch /> : null}
    </Providers>
  );
}

/**
 * The environment the browser device boots with on a public deployment (unchanged from Gate 6). FC-READ: built by
 * lib/device/deviceEnv.server.ts, the ONE helper this layout and app/device/page.tsx share, so the live-read relay's
 * mode hint (FC_READ_RELAY, present only while the relay is armed) cannot reach one copy and miss the other.
 */
function publicDeviceEnv(): Record<string, string> {
  return deviceEnv();
}
