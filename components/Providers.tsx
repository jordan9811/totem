"use client";
import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Persona } from "@/lib/types";
import { announceMoment } from "@/components/device/SaveMoment";

interface AppState {
  personas: Persona[];
  activePersona: Persona | null;
  tiers: Record<string, number>;
  /** PROD-LIVE (D-CU-0-4): true on a PUBLIC deployment — the server holds no identity, the browser device answers
   *  every /api/* route, and every identity-bearing island fetches its own data (lib/client/useApiJson.ts). */
  deviceIsThePage: boolean;
  /** LAYERS_WORLD=empty (lib/world.ts), computed by the server render: the demo world is hidden, so the chrome has no
   *  fixture self to fall back on — no "jordan", no @yeak__, no stock face, no fixture follower counts, no check mark
   *  (review WORLD-LEAK-1). Always false on a public deployment (the device is the page there). */
  emptyWorld: boolean;
  /** PUBLIC GO-LIVE (lib/platform/publicLive.ts), computed by the server render: public live mode — no demo world, the
   *  guided first run at /welcome, honest live-product copy. False on the rig, the owner service and the preview. */
  publicLive: boolean;
  /** new on every server render of the (main) layout, so a router.refresh() re-runs the islands' fetches */
  renderNonce: string;
  /** bumps on refresh(): the client-side half of router.refresh() for data the server cannot render */
  refreshTick: number;
  /** a refetch of every island (use this after a write): router.refresh() + the tick on the rig, the tick ALONE on a
   *  public deployment (see the PROD-LIVE note on the implementation) */
  refresh: () => void;
  /** the SEEDED ACTING persona — the one a post is made as (activeSeedPersonaId() on the rig; the device's answer
   *  from /api/persona/chrome on a public deployment). null until known. Panes take their persona from here, never
   *  from a server prop on a public deployment (the server's fallback is the fixture persona, not the visitor). */
  actingPersonaId: string | null;
  /** where the roster came from: the server render (rig), or the device (public) */
  rosterStatus: "server" | "loading" | "ready" | "error";
  rosterError: string | null;
  composeOpen: boolean;
  setComposeOpen: (open: boolean) => void;
  toast: (msg: string) => void;
  toastMsg: string | null;
  switchPersona: (id: string) => Promise<void>;
  /** ACTING AS YOURSELF (lib/device/actingRoot.ts): the live site only — no persona acts; the visitor's own Farcaster
   *  account is the identity (the public self). A refusal is said, never swallowed. */
  switchToRoot: () => Promise<void>;
  /** ACTING AS YOURSELF: the live site's device, signed in with Farcaster, and no persona is acting (the visitor chose
   *  "You", or has no persona). False while the roster is unread. */
  actingAsYou: boolean;
  createPersona: (input: { name: string; handle: string; bio?: string }) => Promise<Persona | null>;
  /** PUBLIC GO-LIVE: create a persona with a picture and a post mode, and say why when it did not work (the route's own
   *  words — never "handle taken?" as a guess). The post mode is saved after the create; a failure there keeps the
   *  persona and says so. */
  makePersona: (input: NewPersonaInput) => Promise<{ persona: Persona | null; error: string | null }>;
  blockPersona: (personaId: string) => Promise<void>;
}

/** PUBLIC GO-LIVE: what the guided first run, Settings › Account and the switcher send to create a persona */
export interface NewPersonaInput {
  name: string;
  handle: string;
  bio?: string;
  /** a picture made on the device (lib/identity/localAvatar.ts), never a third-party URL */
  avatarUrl?: string;
  /** "anon" is the default for a persona without its own account (lib/identity/postMode.ts); only "private" is sent */
  postMode?: "anon" | "private";
}

const Ctx = createContext<AppState | null>(null);

export function useApp() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useApp outside Providers");
  return ctx;
}

export function Providers({
  children,
  personas: serverPersonas,
  activePersonaId: serverActiveId,
  tiers,
  deviceIsThePage = false,
  emptyWorld = false,
  publicLive = false,
  renderNonce = "",
  actingPersonaId: serverActingId = null,
}: {
  children: React.ReactNode;
  personas: Persona[];
  activePersonaId: string | null;
  tiers: Record<string, number>;
  deviceIsThePage?: boolean;
  emptyWorld?: boolean;
  publicLive?: boolean;
  renderNonce?: string;
  actingPersonaId?: string | null;
}) {
  const router = useRouter();
  const [composeOpen, setComposeOpen] = useState(false);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  // PROD-LIVE (D-CU-0-4): on a public deployment the roster and the acting persona are the DEVICE's, read after it
  // boots (boot.js queues these fetches until it has). On the rig the server's render is the answer, unchanged.
  const [devicePersonas, setDevicePersonas] = useState<Persona[]>([]);
  const [deviceActiveId, setDeviceActiveId] = useState<string | null>(null);
  const [deviceActingId, setDeviceActingId] = useState<string | null>(null);
  const [rosterStatus, setRosterStatus] = useState<AppState["rosterStatus"]>(deviceIsThePage ? "loading" : "server");
  const [rosterError, setRosterError] = useState<string | null>(null);
  useEffect(() => {
    if (!deviceIsThePage) {
      setRosterStatus("server");
      return;
    }
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/personas", { cache: "no-store" });
        const body = await res.json().catch(() => null);
        if (!res.ok || !body) throw new Error((body && body.error) || `HTTP ${res.status}`);
        let acting: string | null = null;
        try {
          const c = await fetch("/api/persona/chrome", { cache: "no-store" });
          const cb = await c.json().catch(() => null);
          if (c.ok && cb && typeof cb.activePersonaId === "string") acting = cb.activePersonaId;
        } catch {
          acting = null;
        }
        if (!alive) return;
        setDevicePersonas(Array.isArray(body.personas) ? body.personas : []);
        setDeviceActiveId(typeof body.activeId === "string" ? body.activeId : null);
        setDeviceActingId(acting ?? (typeof body.activeId === "string" ? body.activeId : null));
        setRosterError(null);
        setRosterStatus("ready");
      } catch (e) {
        if (!alive) return;
        // never fail open: an unread roster is an ERROR state, not an empty account
        setRosterError((e as Error).message || "could not read your personas");
        setRosterStatus("error");
      }
    })();
    return () => {
      alive = false;
    };
  }, [deviceIsThePage, renderNonce, refreshTick]);

  const personas = deviceIsThePage ? devicePersonas : serverPersonas;
  const activePersonaId = deviceIsThePage ? deviceActiveId : serverActiveId;
  const actingPersonaId = deviceIsThePage ? deviceActingId : serverActingId;
  const activePersona = personas.find((p) => p.id === activePersonaId) ?? personas[0] ?? null;

  // PROD-LIVE: on a public deployment refresh() is the TICK ALONE. It used to be tick + router.refresh() everywhere,
  // and router.refresh() re-renders the (main) layout, which mints a new renderNonce — so every island (useApiJson
  // keys on both) and the roster fetch above ran TWICE per write, each a device read. The public server render
  // carries no identity data, so re-rendering it after a write re-reads nothing the write changed; the tick is the
  // whole refresh there. On the rig the server render IS the data: router.refresh() + tick, unchanged. A component
  // that calls router.refresh() itself still refetches every island through the nonce — one read, not two.
  const refresh = useCallback(() => {
    setRefreshTick((t) => t + 1);
    if (!deviceIsThePage) router.refresh();
  }, [router, deviceIsThePage]);

  const toast = useCallback((msg: string) => {
    setToastMsg(msg);
    window.setTimeout(() => setToastMsg(null), 3200);
  }, []);

  const switchPersona = useCallback(
    async (id: string) => {
      // PROD-LIVE: on a public deployment the persona a post is made AS is the device session shim's
      // activeSeedPersonaId() (lib/device/shims/session.ts), which reads layers_view_as / layers_seed_persona — never
      // the layers_active_persona cookie /api/personas/active sets. So a switch through that route alone changed the
      // switcher's checkmark and nothing else: the pill, the composer and every write stayed on the old persona.
      // /api/seed-persona is the switch the acting track honours: it checks the persona against the session roster,
      // registers it with allowActingAs, sets the cookie and applies the persona's default-mode binding (the same
      // call PersonaSwitchList makes). It goes FIRST and a refusal is said, never swallowed: the two cookies must not
      // name different personas because the second write was skipped silently. The rig path is unchanged.
      if (deviceIsThePage) {
        try {
          const res = await fetch("/api/seed-persona", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ personaId: id }),
          });
          if (!res.ok) {
            const body = await res.json().catch(() => null);
            throw new Error((body && body.error) || `HTTP ${res.status}`);
          }
        } catch (e) {
          toast("Couldn't switch persona: " + ((e as Error).message || "unknown error"));
          return;
        }
      }
      await fetch("/api/personas/active", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ personaId: id }),
      });
      refresh();
    },
    [deviceIsThePage, refresh, toast]
  );

  // ACTING AS YOURSELF: one call to the device (it clears the persona it acted as and keeps boot from naming one again
  // during this tab's life), then every island re-reads (Following becomes the hub's, the composer the root's)
  const switchToRoot = useCallback(async () => {
    try {
      const res = await fetch("/api/seed-persona", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ asRoot: true }) });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error((body && body.error) || `HTTP ${res.status}`);
      }
    } catch (e) {
      toast("Couldn't switch to yourself: " + ((e as Error).message || "unknown error"));
      return;
    }
    refresh();
  }, [refresh, toast]);
  const actingAsYou =
    deviceIsThePage &&
    publicLive &&
    rosterStatus === "ready" &&
    personas.some((p) => p.publicSelf === true) &&
    !personas.some((p) => p.id === actingPersonaId && p.publicSelf !== true);

  const createPersona = useCallback(
    async (input: { name: string; handle: string; bio?: string }) => {
      const res = await fetch("/api/personas", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) return null;
      const data = await res.json();
      refresh();
      // PERSONA LAUNCH P1 (SIWF): a first useful moment — the Save card (components/device/SaveMoment.tsx, mounted by the
      // public chrome's IdentityNudge) offers the passkey once while the identity is only in this tab
      announceMoment("persona");
      return data.persona as Persona;
    },
    [refresh]
  );

  // PUBLIC GO-LIVE: the create the guided first run, Settings › Account and the switcher share — the picture rides the
  // create, the post mode is saved right after it (POST /api/personas/post-mode, the picker's own route). Every refusal
  // is the route's own sentence; nothing is guessed.
  const makePersona = useCallback(
    async (input: NewPersonaInput): Promise<{ persona: Persona | null; error: string | null }> => {
      let res: Response;
      try {
        res = await fetch("/api/personas", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: input.name, handle: input.handle, ...(input.bio ? { bio: input.bio } : {}), ...(input.avatarUrl ? { avatarUrl: input.avatarUrl } : {}) }),
        });
      } catch {
        return { persona: null, error: "the request could not be made. Try again." };
      }
      const body = (await res.json().catch(() => null)) as { persona?: Persona; error?: unknown } | null;
      if (!res.ok || !body?.persona) return { persona: null, error: body && typeof body.error === "string" && body.error ? body.error : "the persona was not created (HTTP " + res.status + "). Try again." };
      const persona = body.persona;
      let error: string | null = null;
      if (input.postMode === "private") {
        try {
          const r = await fetch("/api/personas/post-mode", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ personaId: persona.id, mode: "private" }) });
          if (!r.ok) {
            const j = (await r.json().catch(() => null)) as { error?: unknown } | null;
            error = "@" + persona.handle + " was created, but its post mode was not saved: " + (j && typeof j.error === "string" && j.error ? j.error : "HTTP " + r.status) + ". Change it under the composer.";
          }
        } catch {
          error = "@" + persona.handle + " was created, but its post mode was not saved. Change it under the composer.";
        }
      }
      refresh();
      announceMoment("persona");
      return { persona, error };
    },
    [refresh]
  );

  const blockPersona = useCallback(
    async (personaId: string) => {
      await fetch("/api/block", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ personaId }),
      });
      toast("They're blocked — all of their personas.");
      refresh();
    },
    [refresh, toast]
  );

  // Keyboard shortcuts: n / Cmd+N compose (j/k live in Timeline).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing =
        target.tagName === "TEXTAREA" ||
        target.tagName === "INPUT" ||
        target.isContentEditable;
      if ((e.key === "n" || e.key === "N") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setComposeOpen(true);
      } else if (e.key === "n" && !typing && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        setComposeOpen(true);
      } else if (e.key === "Escape") {
        setComposeOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <Ctx.Provider
      value={{
        personas,
        activePersona,
        tiers,
        deviceIsThePage,
        emptyWorld,
        publicLive,
        renderNonce,
        refreshTick,
        refresh,
        actingPersonaId,
        rosterStatus,
        rosterError,
        composeOpen,
        setComposeOpen,
        toast,
        toastMsg,
        switchPersona,
        switchToRoot,
        actingAsYou,
        createPersona,
        makePersona,
        blockPersona,
      }}
    >
      {children}
      {toastMsg && (
        <div
          data-testid="toast"
          className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[100] animate-toastup rounded-[4px] bg-x-blue px-4 py-2.5 text-[15px] font-normal text-white shadow-md"
        >
          {toastMsg}
        </div>
      )}
    </Ctx.Provider>
  );
}
