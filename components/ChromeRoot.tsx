"use client";
// PROD-LIVE (D-CU-0-4, built) — the app chrome's identity half as ONE client island: the persona-tint scope root,
// the persona pill (mobile), the left rail (with its own pill) and the slot the page renders into.
//
// POST-DEPLOY Gate 2 put the tint, the mode edge and the switcher's scope on a server-rendered div in the (main)
// layout. That read the SEEDED acting persona, the sealed personaChrome vault record and the active mode on the
// server — and on a PUBLIC deployment the server has no identity at all: every one of those reads reaches for a
// device key the server refuses to mint. So:
//   * RIG (ZK_DEV_HOOKS=true): the layout computes every value exactly as before (lib/identity/chrome.ts) and hands
//     it here as `initial`. Nothing is fetched; the DOM is the one accept-pd0..pd4 assert, byte for byte.
//   * PUBLIC: `initial` is null. After the browser device boots (boot.js queues the reads until it has), this island
//     reads GET /api/persona/chrome (acting persona, tints, scope) and GET /api/modes (the active mode, its nav
//     slots) — answered in the tab by the device — and sets the same data attributes and CSS custom properties.
//     useApiJson refetches them on every router.refresh() (a new render nonce) and every Providers.refresh().
//
// The failure directions are the rig's, unchanged:
//   * the TINT fails OPEN into "untinted" (a degradation — the pill still names the persona);
//   * the SCOPE fails CLOSED: an unreadable chrome record is data-scope="unavailable", and the switcher narrows to
//     the active persona (useChromeScope, read by AccountSwitcher and the mobile drawer), never the full roster;
//   * the HANDLE is never invented: until the device names the acting persona the pill says so in words, and it is
//     never the fixture's handle (the server's fallback identity is the owner's, not the visitor's).
//   * NAV SLOTS fail open (all nav), as in the layout: failing closed on navigation strands the visitor.
import { useCallback } from "react";
import { useApp } from "./Providers";
import { LeftRail } from "./LeftRail";
import { PersonaPill } from "./PersonaPill";
import { ChromeScopeContext, type ChromeScope } from "./ChromeScope";
import { useApiJson } from "@/lib/client/useApiJson";
import { isTint, modeEdgeOf, washOf } from "@/lib/identity/chromeCues";

/** what the rig's server render computed (app/(main)/layout.tsx), in the shape this island renders */
export interface ChromeInitial {
  actingId: string;
  /** LAYERS_WORLD=empty (lib/world.ts): null when this device has no persona yet (the pill says "No persona yet") */
  actingHandle: string | null;
  tint: string | null;
  tintSource: string;
  /** washOf(tint), computed on the server by lib/identity/chrome.ts */
  wash: string | null;
  modeEdge: string;
  modeId: string;
  modeName: string | null;
  scope: "normal" | "compartment" | "unavailable";
  navSlots?: string[];
  /** the rail's profile link target (getSelf().username on the rig) */
  selfHandle: string;
}

interface ChromeResponse {
  activePersonaId?: unknown;
  scope?: { compartment?: unknown; unified?: unknown; visiblePersonaIds?: unknown } | null;
  tints?: { personaId?: unknown; color?: unknown; source?: unknown; handle?: unknown }[] | null;
}
interface ModesResponse {
  modes?: { id?: unknown; name?: unknown; actionButtonSlots?: { nav?: unknown } | null }[] | null;
  activeId?: unknown;
}

interface View {
  actingId: string;
  actingHandle: string | null;
  tint: string | null;
  tintSource: string;
  wash: string | null;
  modeEdge: string;
  modeId: string;
  modeName: string | null;
  scope: ChromeScope;
  navSlots?: string[];
  selfHandle: string | null;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

export function ChromeRoot({
  initial,
  rightRail,
  children,
}: {
  initial: ChromeInitial | null;
  rightRail: React.ReactNode;
  children: React.ReactNode;
}) {
  const { deviceIsThePage, actingPersonaId, personas, rosterStatus } = useApp();
  const fromDevice = !initial;
  // url null => no fetch (the rig: the server's copy is the answer)
  const chromeQ = useApiJson<ChromeResponse>(fromDevice && deviceIsThePage ? "/api/persona/chrome" : null);
  const modesQ = useApiJson<ModesResponse>(fromDevice && deviceIsThePage ? "/api/modes" : null);
  const reloadChrome = chromeQ.reload;
  const reloadModes = modesQ.reload;
  const retry = useCallback(() => {
    reloadChrome();
    reloadModes();
  }, [reloadChrome, reloadModes]);

  let view: View;
  if (initial) {
    view = { ...initial };
  } else {
    const c = chromeQ.data;
    const m = modesQ.data;
    const chromeLoading = !c && !chromeQ.error;
    const actingId = str(c?.activePersonaId) ?? actingPersonaId ?? "";
    const rec = actingId && Array.isArray(c?.tints) ? c!.tints!.find((t) => t && t.personaId === actingId) : undefined;
    // the route falls back to the id when it has no handle for it — that is not a handle
    const routeHandle = rec && str(rec.handle) && rec.handle !== actingId ? (rec.handle as string) : null;
    const rosterHandle = actingId ? personas.find((p) => p.id === actingId)?.handle ?? null : null;
    const actingHandle = routeHandle ?? rosterHandle;
    const tint = rec && isTint(rec.color) ? rec.color : null;
    const mode = m && Array.isArray(m.modes) ? m.modes.find((x) => x && x.id === m.activeId) : undefined;
    const modeId = str(mode?.id) ?? str(m?.activeId) ?? "";
    const nav = mode?.actionButtonSlots?.nav;
    const navSlots = Array.isArray(nav) ? nav.filter((s): s is string => typeof s === "string") : [];
    const compartment = c?.scope && typeof c.scope.compartment === "boolean" ? c.scope.compartment : null;
    view = {
      actingId,
      actingHandle,
      tint,
      tintSource: chromeQ.error ? "unavailable" : chromeLoading ? "loading" : str(rec?.source) ?? "unavailable",
      wash: tint ? washOf(tint) : null,
      modeEdge: modeEdgeOf(modeId || null),
      modeId,
      modeName: str(mode?.name),
      // FAIL CLOSED: an error, or an answer without a readable scope, is "unavailable" — never "normal"
      scope: chromeQ.error ? "unavailable" : chromeLoading ? "loading" : compartment === null ? "unavailable" : compartment ? "compartment" : "normal",
      navSlots: navSlots.length ? navSlots : undefined,
      selfHandle: actingHandle,
    };
  }

  const tintVars = view.tint
    ? ({ ["--persona-tint"]: view.tint, ["--persona-tint-wash"]: view.wash ?? washOf(view.tint), ["--persona-mode-edge"]: view.modeEdge } as React.CSSProperties)
    : undefined;
  // on a public deployment only: where the chrome's answer stands (the rig's DOM carries no extra attribute)
  const sourceAttr = fromDevice
    ? { "data-chrome-source": chromeQ.error ? "error" : chromeQ.data ? "device" : "loading" }
    : {};
  const pending =
    fromDevice && !view.actingHandle && !chromeQ.error && (chromeQ.loading || !chromeQ.data || rosterStatus === "loading");
  const onRetry = fromDevice && !view.actingHandle && !pending ? retry : undefined;
  // LAYERS_WORLD=empty: the server said there is no acting persona (the rig always names one)
  const none = !fromDevice && view.actingHandle === null;
  // built as a value (not an inline literal) so it compiles against a LeftRail whose pill type does not name `none` yet
  const railPill = { handle: view.actingHandle, modeName: view.modeName, pending, onRetry, none };

  return (
    <ChromeScopeContext.Provider value={view.scope}>
      <div
        data-testid="persona-tint-root"
        data-persona-id={view.actingId}
        data-persona-handle={view.actingHandle ?? ""}
        data-tint={view.tint ?? ""}
        data-tint-source={view.tintSource}
        data-mode-edge={view.modeEdge}
        data-mode-id={view.modeId}
        data-scope={view.scope}
        style={tintVars}
        className="contents"
        {...sourceAttr}
      >
        <PersonaPill handle={view.actingHandle} modeName={view.modeName} variant="mobile" pending={pending} onRetry={onRetry} none={none} />
        <div className="mx-auto flex min-h-screen w-full max-w-[1265px] justify-center">
          <LeftRail
            selfHandle={view.selfHandle}
            navSlots={view.navSlots}
            pill={railPill}
          />
          <div className="flex w-full min-w-0 justify-start">
            <main className="min-h-screen w-full max-w-[600px] border-x border-x-border pb-[53px] sm:pb-0">{children}</main>
            {rightRail}
          </div>
        </div>
      </div>
    </ChromeScopeContext.Provider>
  );
}
