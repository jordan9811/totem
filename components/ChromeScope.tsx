"use client";
// PROD-LIVE (D-CU-0-4) — the switcher's scope as the chrome read it (components/ChromeRoot.tsx provides it). Its own
// module so the switcher surfaces (AccountSwitcher, the mobile drawer) can read it without an import cycle through
// ChromeRoot -> LeftRail -> AccountSwitcher.
//
// On a public deployment every roster surface narrows to the ACTIVE persona whenever this is not a readable
// "normal" — compartment mode, an unreadable chrome record, or the moment before the device answers. That is the
// rig's fail-closed answer (app/(main)/layout.tsx narrows the roster server-side), applied where a public
// deployment's roster actually arrives: in the browser. /api/personas narrows the same way at the data layer.
import { createContext, useContext } from "react";

/** "loading" exists only on a public deployment, between mount and the device's answer */
export type ChromeScope = "normal" | "compartment" | "unavailable" | "loading";

export const ChromeScopeContext = createContext<ChromeScope | null>(null);

/** null outside the chrome */
export function useChromeScope(): ChromeScope | null {
  return useContext(ChromeScopeContext);
}
