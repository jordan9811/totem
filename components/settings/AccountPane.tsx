"use client";
// /settings/account — the persona list and the facts about the identity underneath it.
//
// PROD-LIVE (D-CU-0-4): the page used to read the SEEDED viewer on the server (SEED_VIEWER.personas through the mock
// persona adapter, the fixture's fid and root). On a public deployment the server holds no identity, so that read
// either failed ("Couldn't load personas … refusing to mint") or rendered the rig's FIXTURE identity — the owner's
// real handle — as if it were the visitor's. Now:
//   • on the RIG the server computes exactly what it did and hands it over as `initial`; the DOM below is the
//     page's former DOM, unchanged;
//   • on a PUBLIC deployment `initial` is null: the roster and the acting persona are the device's (useApp(), read
//     from GET /api/personas and /api/persona/chrome in the browser), tiers are read per persona from the device
//     (GET /api/tier), and the identity facts are the device's PUBLIC values only — its device-auth anchor (a
//     public key the validator already holds) and whether it is kept on this device. Never the root id, never key
//     material, never the fixture's fid/root/handles. The page links to /device to save the identity, because an
//     unsaved one lives only in this tab.
// NEVER FAIL OPEN: an unread roster is an error with a Retry (a re-read, never a full page load — a full load
// would discard an unsaved identity and mint a new one), never an empty persona list presented as the truth.
//
// PERSONA LAUNCH P1 (review UX-8): the read-only public self (the account Sign in with Farcaster linked,
// PersonaSummary.publicSelf) is NEVER handed to PersonaSwitchList — that list makes every row a switch button that
// POSTs /api/seed-persona, which refuses the public self (PUBLIC_SELF_READ_ONLY), so the row was a button whose every
// click failed. It is listed here instead, as AccountSwitcher lists it: a soft link to its profile with the chip
// "Farcaster · read-only". Every avatar on this page goes through the held-media rule first (mediaHostAllowed, the
// same allowlist the feed and the switcher use): an avatar off the allowlist — the public self's comes from the
// Farcaster relay, its host chosen by whoever set it — is the neutral disc, never fetched (its host would learn the
// visitor's address), and the one image drawn here carries no referrer.
//
// PUBLIC GO-LIVE (public live mode, Providers.publicLive): the public branch gains the create form (a picture made on
// this device, and where its posts go: CreatePersonaForm), a "Finish setting up" link into the guided first run while
// it is incomplete (no Farcaster sign-in, unsaved, or no persona yet), and the Farcaster row's "Sign in with Farcaster"
// leads into the flow's Farcaster step (/welcome) instead of /device. With the flag off nothing here changes.
import Link from "next/link";
import { useEffect, useState } from "react";
import type { PersonaSummary } from "@/lib/adapters/types";
import { useApp } from "@/components/Providers";
import { mediaHostAllowed } from "@/components/CastCard";
import { DEVICE_EVENT } from "@/lib/device/bootState";
import { ErrorNote, LoadingRows, Row, SettingsGroup } from "./Chrome";
import { PersonaSwitchList } from "./PersonaSwitchList";
import { CreatePersonaForm } from "./CreatePersonaForm";
import { passkeySaveLabel, saveWithPasskey, usePasskeyCaps } from "@/components/device/SaveMoment";
import { welcomeHref } from "@/lib/onboarding/state";
import { RootPostSettings } from "@/components/root/RootPost";

/** UX-8: the roster split into what may be switched to and the read-only public self, each avatar held when its host
 *  is off the allowlist (null → PersonaSwitchList draws no request; the public-self row draws the neutral disc) */
export function splitRoster(personas: PersonaSummary[]): { switchable: PersonaSummary[]; selves: PersonaSummary[] } {
  const switchable: PersonaSummary[] = [];
  const selves: PersonaSummary[] = [];
  for (const p of personas) {
    const held = p.avatarUrl && !mediaHostAllowed(p.avatarUrl) ? { ...p, avatarUrl: null } : p;
    (p.publicSelf === true ? selves : switchable).push(held);
  }
  return { switchable, selves };
}

/** UX-8: the visitor's own Farcaster account — shown, opened, never switched to */
function PublicSelfRows({ selves, disconnected }: { selves: PersonaSummary[]; disconnected: boolean }) {
  if (!selves.length) return null;
  return (
    <SettingsGroup title="Your Farcaster account" note="Read-only here: it shows which Farcaster account is yours. Tap it to open its profile.">
      {selves.map((p) => (
        <Link
          key={p.id}
          href={"/" + p.handle}
          data-testid={`account-public-self-${p.handle}`}
          data-public-self="true"
          title="Your Farcaster account. Read-only here: it opens your profile."
          className="flex w-full items-center px-4 py-3 hover:bg-x-hover"
        >
          {p.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={p.avatarUrl} alt="" referrerPolicy="no-referrer" className="h-10 w-10 shrink-0 rounded-full object-cover" />
          ) : (
            <span aria-hidden className="h-10 w-10 shrink-0 rounded-full bg-x-pill" />
          )}
          <span className="ml-3 flex min-w-0 flex-1 flex-col items-start">
            <span className="truncate text-[15px] font-bold leading-5">{p.name}</span>
            <span className="truncate text-[15px] leading-5 text-x-sec">@{p.handle}</span>
            <span data-testid="public-self-chip" className="mt-0.5 rounded-full border border-x-border px-2 text-[12px] leading-4 text-x-sec">
              Farcaster · read-only{disconnected ? " · disconnected" : ""}
            </span>
          </span>
        </Link>
      ))}
    </SettingsGroup>
  );
}

/** what the rig's server hands over — the same values its page rendered. (No key is named `rootId`: the root-leak
 *  suite greps this page's RSC payload for that key; the rig rendered the root id as a row's text, and still does.) */
export interface AccountInitial {
  personas: PersonaSummary[];
  tiers: Record<string, number>;
  activeId: string;
  error: string | null;
  rootRows: { fid: string; root: string };
  /** LAYERS_WORLD=empty (lib/world.ts): the demo world is hidden — the page says so, and offers a plain create */
  emptyWorld?: boolean;
}

/** the device's PUBLIC facts — picked field by field from window.__layersDevice.info, never the whole object */
interface DeviceFacts {
  anchor: string;
  persistent: boolean;
  restored: boolean;
}
interface DeviceGlobal {
  __layersDevice?: { ready: Promise<unknown>; info: { anchor?: unknown; persistent?: unknown; restored?: unknown } | null };
}

function pickFacts(info: unknown): DeviceFacts | null {
  if (!info || typeof info !== "object") return null;
  const i = info as { anchor?: unknown; persistent?: unknown; restored?: unknown };
  if (typeof i.anchor !== "string") return null;
  return { anchor: i.anchor, persistent: i.persistent === true, restored: i.restored === true };
}

/** PROD-LIVE: wait for the in-page device (DeviceHostMount loads it after first paint), then read its public facts */
function useDeviceFacts(enabled: boolean, tick: number): { facts: DeviceFacts | null; error: string | null } {
  const [state, setState] = useState<{ facts: DeviceFacts | null; error: string | null }>({ facts: null, error: null });
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    let timer: number | undefined;
    const started = Date.now();
    const attempt = () => {
      const d = (window as unknown as DeviceGlobal).__layersDevice;
      if (!d) {
        if (Date.now() - started > 30_000) {
          if (alive) setState({ facts: null, error: "the device in this page did not start" });
          return;
        }
        timer = window.setTimeout(attempt, 250);
        return;
      }
      Promise.resolve(d.ready).then(
        (booted) => {
          if (!alive) return;
          const facts = pickFacts(d.info ?? booted);
          setState(facts ? { facts, error: null } : { facts: null, error: "the device reported no identity" });
        },
        (e: unknown) => {
          if (alive) setState({ facts: null, error: e instanceof Error ? e.message : String(e) });
        }
      );
    };
    attempt();
    // PROD-LIVE: the device announces every change to these facts on DEVICE_EVENT — persist() (the chrome's "Keep in
    // this browser"), a passkey or provider save, an unlock that re-boots the identity — and re-reading `info` then is
    // how the "Saved" row stops saying "Unsaved" about an identity that was just kept. Only a readable answer is
    // taken; an event without one leaves the last good read (or the error) where it is.
    const onDevice = () => {
      const d = (window as unknown as DeviceGlobal).__layersDevice;
      const facts = d ? pickFacts(d.info) : null;
      if (alive && facts) setState({ facts, error: null });
    };
    window.addEventListener(DEVICE_EVENT, onDevice);
    return () => {
      alive = false;
      if (timer !== undefined) window.clearTimeout(timer);
      window.removeEventListener(DEVICE_EVENT, onDevice);
    };
  }, [enabled, tick]);
  return state;
}

/** PERSONA LAUNCH P1 (SIWF): the visitor's Sign in with Farcaster link, as the device's GET /api/fc/siwf answers it
 *  ("unknown" while reading or when it could not be read — never "none" on a failed read) */
type FarcasterRow =
  | { state: "loading" }
  | { state: "unknown"; error: string }
  | { state: "unavailable" }
  | { state: "none" }
  | { state: "signed-in" | "disconnected"; fname: string; handle: string | null };

function useFarcasterRow(enabled: boolean, tick: number): { row: FarcasterRow; retry: () => void } {
  const [row, setRow] = useState<FarcasterRow>({ state: "loading" });
  const [again, setAgain] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    (async () => {
      try {
        const r = await fetch("/api/fc/siwf", { cache: "no-store" });
        const j = (await r.json().catch(() => null)) as { available?: boolean; link?: { fname?: string | null; handle?: string | null; disconnected?: boolean } | null; error?: string } | null;
        if (!alive) return;
        if (!r.ok || !j) return setRow({ state: "unknown", error: (j && j.error) || "HTTP " + r.status });
        if (!j.available) return setRow({ state: "unavailable" });
        if (!j.link) return setRow({ state: "none" });
        setRow({ state: j.link.disconnected ? "disconnected" : "signed-in", fname: j.link.fname ?? j.link.handle ?? "your account", handle: j.link.handle ?? null });
      } catch (e) {
        if (alive) setRow({ state: "unknown", error: (e as Error).message || "could not be read" });
      }
    })();
    return () => {
      alive = false;
    };
  }, [enabled, tick, again]);
  return { row, retry: () => setAgain((n) => n + 1) };
}

/** SIGN IN WITH X: the root's X account, as the device's GET /api/x/signin answers it ("unknown" while reading or when it
 *  could not be read — never "none" on a failed read; "soon" while the site carries no X app) */
type XRow =
  | { state: "loading" }
  | { state: "unknown"; error: string }
  | { state: "soon" }
  | { state: "unavailable"; reason: string }
  | { state: "none" }
  | { state: "signed-in" | "disconnected"; username: string; handle: string | null };

function useXRow(enabled: boolean, tick: number): { row: XRow; retry: () => void } {
  const [row, setRow] = useState<XRow>({ state: "loading" });
  const [again, setAgain] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    (async () => {
      try {
        const r = await fetch("/api/x/signin", { cache: "no-store" });
        const j = (await r.json().catch(() => null)) as { available?: boolean; code?: string | null; reason?: string | null; link?: { username?: string; handle?: string | null; disconnected?: boolean } | null; error?: string } | null;
        if (!alive) return;
        if (!r.ok || !j) return setRow({ state: "unknown", error: (j && j.error) || "HTTP " + r.status });
        if (!j.available) return setRow(j.code === "xsi_dormant" ? { state: "soon" } : { state: "unavailable", reason: j.reason ?? "not offered here" });
        if (!j.link || !j.link.username) return setRow({ state: "none" });
        setRow({ state: j.link.disconnected ? "disconnected" : "signed-in", username: j.link.username, handle: j.link.handle ?? null });
      } catch (e) {
        if (alive) setRow({ state: "unknown", error: (e as Error).message || "could not be read" });
      }
    })();
    return () => {
      alive = false;
    };
  }, [enabled, tick, again]);
  return { row, retry: () => setAgain((n) => n + 1) };
}

export function AccountPane({ initial }: { initial: AccountInitial | null }) {
  const app = useApp();
  const server = initial !== null;
  const [deviceTick, setDeviceTick] = useState(0);
  const device = useDeviceFacts(!server, deviceTick + app.refreshTick);
  // PERSONA LAUNCH P1 (SIWF): passkey first — the callout saves inline; the Farcaster row reads the device's sign-in
  const caps = usePasskeyCaps();
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const farcaster = useFarcasterRow(!server, app.refreshTick);
  // SIGN IN WITH X: the root's X account (live site only: the rig and the owner service are not offered it)
  const xrow = useXRow(!server && app.publicLive, app.refreshTick);

  // PROD-LIVE: tiers from the device, one read per persona. A tier that cannot be read leaves that persona's badge
  // off — the rig's page made exactly that call ("tier unavailable — badge simply doesn't render"); the badge is
  // decoration, the roster above it is not.
  const [tiers, setTiers] = useState<Record<string, number>>({});
  const idsKey = server ? "" : app.personas.map((p) => p.id).join(",");
  useEffect(() => {
    if (server || !idsKey) return;
    let alive = true;
    (async () => {
      const next: Record<string, number> = {};
      for (const id of idsKey.split(",")) {
        try {
          const r = await fetch(`/api/tier?personaId=${encodeURIComponent(id)}`, { cache: "no-store" });
          const j = await r.json().catch(() => null);
          if (r.ok && j && typeof j.tier === "number") next[id] = j.tier;
        } catch {
          // tier unavailable — badge simply doesn't render for that persona
        }
      }
      if (alive) setTiers(next);
    })();
    return () => {
      alive = false;
    };
  }, [server, idsKey, app.refreshTick]);

  if (initial) {
    // UX-8: on the rig and the owner service too — a public self in the server's roster is never a switch button
    const rigRoster = splitRoster(initial.personas);
    return (
      <>
        {initial.error && <p className="px-4 py-4 text-[15px] text-[#f4212e]">Couldn&rsquo;t load personas. {initial.error}</p>}
        {initial.emptyWorld && initial.personas.length === 0 && !initial.error ? (
          <div data-testid="world-no-personas" className="border-b border-x-border px-4 py-4">
            <p className="text-[17px] font-bold leading-6">No personas yet</p>
            <p className="mt-1 text-[15px] leading-5 text-x-sec">
              This service shows only what is real — no demo accounts. Create your first persona below; once you have
              one, this page links to its fork page, and you can make more here.
            </p>
          </div>
        ) : null}
        {/* PERSONA LAUNCH P6: "Launch @persona" on each public persona's row — here only (the public preview's device
            roster below has no launch yet: anonymous proving in the browser is P7) */}
        <PersonaSwitchList personas={rigRoster.switchable} tiers={initial.tiers} activeId={initial.activeId} launchLinks />
        <PublicSelfRows selves={rigRoster.selves} disconnected={false} />
        {/* review F6: the fork is reachable from here (it was named as "Settings › Fork this persona", an entry that does
            not exist). A next/link, like every settings link. Only when there is a persona to fork. */}
        {initial.emptyWorld && initial.personas.length > 0 ? (
          <div className="border-b border-x-border px-4 py-3">
            <Link href="/settings/identity/fork" data-testid="world-fork-link" className="text-[15px] font-bold text-x-blue hover:underline">
              Fork the persona you act as &rsaquo;
            </Link>
            <p className="mt-0.5 text-[13px] leading-4 text-x-sec">A new persona that carries what you choose from this one (Settings › Identity › Fork).</p>
          </div>
        ) : null}
        {initial.emptyWorld ? <CreatePersonaForm first={initial.personas.length === 0} /> : null}
        <SettingsGroup title="Root account" note="All your personas share one underlying signer and one reputation score.">
          <Row label="Farcaster ID" sub={initial.rootRows.fid} />
          <Row label="Root id" sub={initial.rootRows.root} />
          <Row label="Personas" sub={`${initial.personas.length} on this root`} />
        </SettingsGroup>
        <div className="h-24" />
      </>
    );
  }

  // ---------- PUBLIC: the visitor's own device ----------
  // Only the DEVICE's roster counts here. "server" would mean the chrome was not told the device is the page, and a
  // keyless server's roster is empty — shown as the visitor's, that would be failing open. It waits instead.
  const rosterReady = app.rosterStatus === "ready";
  const saved = device.facts?.persistent === true;
  const roster = splitRoster(app.personas);
  // PUBLIC GO-LIVE: the guided first run is incomplete while a fact it sets up is missing (read facts only: an unread
  // roster or sign-in row never counts as "missing" and never as "done" — the link simply waits). A persona is NOT one of
  // them (the owner's flow, 2026-11-05: personas are optional, made from the home feed's card).
  const live = app.publicLive;
  const setupIncomplete = live && rosterReady && !!device.facts && (farcaster.row.state === "none" || !saved);
  // PUBLIC GO-LIVE (F5): "Continue setting up" lands on the FIRST step this page knows is missing (the guided run's explicit
  // target: past the returning-visitor rule, which would otherwise send a restored visitor straight home)
  const firstMissing = farcaster.row.state === "none" ? "farcaster" : "save";
  return (
    <>
      {setupIncomplete ? (
        <div data-testid="account-finish-setup" className="mx-4 mt-3 rounded-2xl border border-x-border p-3">
          <p className="text-[15px] font-bold leading-5">Finish setting up</p>
          <p className="mt-0.5 text-[13px] leading-4 text-x-sec">Sign in with Farcaster and keep your account with Face ID, one step at a time.</p>
          <Link href={welcomeHref(firstMissing)} data-testid="account-finish-setup-link" data-step={firstMissing} className="mt-2 inline-flex h-8 items-center rounded-full bg-x-black-btn px-4 text-[14px] font-bold text-white">
            Continue setting up
          </Link>
        </div>
      ) : null}
      <div
        data-testid="account-device-callout"
        data-saved={device.facts ? (saved ? "true" : "false") : "unknown"}
        className={`mx-4 my-3 rounded-2xl border p-3 ${saved ? "border-[#00ba7c66]" : "border-[#ffd40099] bg-[#ffd4000d]"}`}
      >
        <p className="text-[15px] font-bold leading-5">
          {device.facts ? (saved ? "This identity is kept on this device" : "Unsaved — this identity lives in this tab") : "Your identity lives in this browser"}
        </p>
        <p className="mt-0.5 text-[13px] leading-4 text-x-sec">
          {device.facts
            ? saved
              ? "Closing the tab keeps it. A passkey keeps it safe beyond this browser."
              : "Closing the tab loses it, and a full page reload replaces it with a new one. Save it to keep it."
            : "The server holds no key for it — everything on this page is read from your browser."}
        </p>
        {/* PERSONA LAUNCH P1 (SIWF): PASSKEY FIRST — the save happens here, inline (the same call /device makes); "More
            options" is a soft link to /device (Sign in with Farcaster, and the 24 words under Advanced). A failed save is
            said here and nothing changes (never fail open). */}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {!saved && device.facts && passkeySaveLabel(caps) ? (
            <button
              type="button"
              data-testid="account-save-passkey"
              disabled={saving}
              onClick={async () => {
                setSaving(true);
                setSaveError(null);
                try {
                  app.toast(await saveWithPasskey());
                  setDeviceTick((t) => t + 1);
                  app.refresh();
                } catch (e) {
                  setSaveError((e as Error)?.message || "the passkey was not saved");
                } finally {
                  setSaving(false);
                }
              }}
              className="h-8 rounded-full bg-x-blue px-4 text-[14px] font-bold leading-8 text-white hover:bg-x-blue-hover disabled:opacity-60"
            >
              {saving ? "Saving…" : passkeySaveLabel(caps)}
            </button>
          ) : null}
          <Link
            href="/device"
            data-testid="account-save-identity"
            className={
              !saved && device.facts && passkeySaveLabel(caps)
                ? "text-[14px] font-bold text-x-blue hover:underline"
                : "inline-block h-8 rounded-full bg-x-blue px-4 text-[14px] font-bold leading-8 text-white hover:bg-x-blue-hover"
            }
          >
            {saved ? "Manage this identity" : passkeySaveLabel(caps) && device.facts ? "More options" : "Save this identity"}
          </Link>
        </div>
        {saveError ? (
          <p data-testid="account-save-error" role="alert" className="mt-1 text-[13px] text-[#f4212e]">
            Not saved: {saveError}
          </p>
        ) : null}
      </div>

      {app.rosterStatus === "error" ? (
        <ErrorNote error={`Couldn't load your personas. ${app.rosterError ?? ""}`} onRetry={app.refresh} />
      ) : !rosterReady ? (
        <LoadingRows count={2} />
      ) : (
        <>
          <PersonaSwitchList personas={roster.switchable} tiers={tiers} activeId={app.actingPersonaId ?? ""} />
          <PublicSelfRows selves={roster.selves} disconnected={farcaster.row.state === "disconnected"} />
          {/* PUBLIC GO-LIVE: in live mode the device has no auto-made personas — the create form is here */}
          {live ? <CreatePersonaForm first={roster.switchable.length === 0} /> : null}
        </>
      )}

      <SettingsGroup title="This identity" note="All your personas share one root, held by this browser. The server never sees it.">
        {device.error ? (
          <ErrorNote
            error={`Couldn't read this device. ${device.error}`}
            onRetry={() => setDeviceTick((t) => t + 1)}
          />
        ) : null}
        <Row
          label="Saved"
          sub={device.facts ? (saved ? "kept on this device" : "not yet — only in this tab") : device.error ? "unknown" : "starting your device…"}
          testid="account-device-saved"
        />
        <Row
          label="Device key"
          sub={device.facts ? device.facts.anchor.slice(0, 16) + "…" : "—"}
          testid="account-device-anchor"
        />
        {/* PERSONA LAUNCH P1 (SIWF): the visitor's own Farcaster account, as Sign in with Farcaster linked it (sealed on
            this device; the server never sees it). Read-only: it is shown, never acted as. */}
        {farcaster.row.state === "unknown" ? (
          <ErrorNote error={`Couldn't read your Farcaster sign-in. ${farcaster.row.error}`} onRetry={farcaster.retry} />
        ) : null}
        <div data-testid="account-farcaster" data-state={farcaster.row.state}>
          {farcaster.row.state === "signed-in" || farcaster.row.state === "disconnected" ? (
            farcaster.row.handle ? (
              <Link href={"/" + farcaster.row.handle} className="block hover:bg-x-hover">
                <Row label="Farcaster" sub={`@${farcaster.row.fname} · ${farcaster.row.state === "signed-in" ? "that's me" : "disconnected"}`} />
              </Link>
            ) : (
              <Row label="Farcaster" sub={`@${farcaster.row.fname} · ${farcaster.row.state === "signed-in" ? "that's me" : "disconnected"}`} />
            )
          ) : farcaster.row.state === "none" ? (
            // PUBLIC GO-LIVE (F5): straight to the guided run's Farcaster step (its explicit target), whoever is asking
            <Link href={live ? welcomeHref("farcaster") : "/device#farcaster"} data-testid="account-farcaster-signin" className="block hover:bg-x-hover">
              <Row label="Farcaster" sub="none · Sign in with Farcaster" />
            </Link>
          ) : (
            <Row
              label="Farcaster"
              sub={farcaster.row.state === "unavailable" ? "not offered here" : farcaster.row.state === "loading" ? "…" : "unknown"}
            />
          )}
        </div>
        {farcaster.row.state === "signed-in" ? (
          <Link href="/device#farcaster" data-testid="account-farcaster-disconnect" className="block hover:bg-x-hover">
            <Row label="Disconnect" sub="On Your device: type DISCONNECT to confirm" />
          </Link>
        ) : null}
        {/* SIGN IN WITH X: the root's own X account, as Sign in with X linked it (sealed on this device; the server never
            sees it). Shown, never acted as; connect and disconnect live on the guided run's Sign in step. */}
        {live ? (
          <>
            {xrow.row.state === "unknown" ? <ErrorNote error={`Couldn't read your X sign-in. ${xrow.row.error}`} onRetry={xrow.retry} /> : null}
            <div data-testid="account-x" data-state={xrow.row.state}>
              {xrow.row.state === "signed-in" || xrow.row.state === "disconnected" ? (
                <Link href={xrow.row.handle ? "/" + xrow.row.handle : welcomeHref("farcaster")} data-testid="account-x-row" className="block hover:bg-x-hover">
                  <Row label="X" sub={`@${xrow.row.username} · ${xrow.row.state === "signed-in" ? "that's me" : "disconnected"}`} />
                </Link>
              ) : xrow.row.state === "none" ? (
                <Link href={welcomeHref("farcaster")} data-testid="account-x-signin" className="block hover:bg-x-hover">
                  <Row label="X" sub="none · Continue with X" />
                </Link>
              ) : (
                <Row label="X" sub={xrow.row.state === "soon" ? "Sign in with X is coming soon" : xrow.row.state === "unavailable" ? xrow.row.reason : xrow.row.state === "loading" ? "…" : "unknown"} />
              )}
            </div>
          </>
        ) : null}
        <Row
          label="Personas"
          sub={rosterReady ? `${app.personas.length} on this identity` : app.rosterStatus === "error" ? "unknown" : "…"}
          testid="account-device-personas"
        />
      </SettingsGroup>
      {/* POST AS YOU: the visitor's own Farcaster account, posted to with a key in their own vault — on the public live
          site, once signed in (the device answers; no server is asked) */}
      {live && farcaster.row.state === "signed-in" ? (
        <div id="post-as-you">
          <SettingsGroup title="Post as you" note="Your own Farcaster account, from Totem. The key lives in your vault; you approve it in the Farcaster app and can remove it there any time.">
            <RootPostSettings />
          </SettingsGroup>
        </div>
      ) : null}
      <div className="h-24" />
    </>
  );
}
