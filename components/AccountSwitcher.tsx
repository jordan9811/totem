"use client";
// Persona-layer UI (allowed divergence): the account switcher lists this
// root's personas with tier badges and offers "Create persona".
//
// PROD-LIVE (D-CU-0-4): on a public deployment the roster is the browser device's (Providers reads /api/personas
// after the device boots), so it has a LOADING and an ERROR state of its own — an unread roster is said out loud with
// a Retry, never rendered as an empty account. The compartment scope is enforced by the route (/api/personas narrows
// it) AND here: whenever the chrome's scope is not a readable "normal" (compartment, unreadable, still loading) the
// list is the active persona alone — the same fail-closed answer the rig's layout gives server-side. On the rig the
// roster arrives already narrowed by the server render and nothing here changes it.
//
// PERSONA LAUNCH P1 (SIWF): the visitor's own Farcaster account (the read-only "public self" Sign in with Farcaster
// minted, Persona.publicSelf) is listed with the chip "Farcaster · read-only" and is NEVER a switch target: its row is
// a soft link to its profile (/<handle>), not a switch (/api/seed-persona refuses it anyway: PUBLIC_SELF_READ_ONLY).
// A disconnected link shows "disconnected" (read from the device's GET /api/fc/siwf, only when such a row exists).
//
// ACTING AS YOURSELF (2026-11-05, lib/device/actingRoot.ts): on the LIVE site the same row is a switch target, "You": no
// persona acts, the visitor's own account does (its Following, posting as it, its likes and replies once Totem may post
// as it). Its check mark says so, and the row says a reload goes back to the first persona. Off the live site it stays
// the read-only link above.
import Link from "next/link";
import { mediaHostAllowed } from "./CastCard";
import { useEffect, useRef, useState } from "react";
import { useApp } from "./Providers";
import { useChromeScope } from "./ChromeScope";
import { TierBadge } from "./TierBadge";
import { VerifiedBadge } from "./icons";
import { localAvatar } from "@/lib/identity/localAvatar";
import { useRootAccounts } from "@/components/x/useRootAccounts";

export function AccountSwitcher({ onClose }: { onClose: () => void }) {
  const { personas: roster, activePersona, tiers, switchPersona, switchToRoot, actingAsYou, publicLive, deviceIsThePage, emptyWorld, rosterStatus, rosterError, refresh } = useApp();
  const youSelectable = publicLive && deviceIsThePage;
  const scope = useChromeScope();
  const narrowed = deviceIsThePage && scope !== "normal";
  const personas = narrowed ? (activePersona ? [activePersona] : []) : roster;
  const [creating, setCreating] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  // PERSONA LAUNCH P1 (SIWF): whether the public self's link is a tombstone — asked only when such a row exists
  const hasPublicSelf = personas.some((p) => p.publicSelf === true);
  const [selfDisconnected, setSelfDisconnected] = useState<boolean | null>(null);
  // SIGN IN WITH X: which accounts the public self is (Farcaster, X, or both) — the chip names them; unknown says Farcaster,
  // as it always did
  const accounts = useRootAccounts(hasPublicSelf && deviceIsThePage);
  const selfVia = accounts && accounts.x ? (accounts.farcaster ? "Farcaster and X" : "X") : "Farcaster";
  useEffect(() => {
    if (!hasPublicSelf) return;
    let alive = true;
    fetch("/api/fc/siwf", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { link?: { disconnected?: boolean } | null } | null) => {
        if (alive) setSelfDisconnected(j && j.link ? j.link.disconnected === true : null);
      })
      .catch(() => {
        if (alive) setSelfDisconnected(null);
      });
    return () => {
      alive = false;
    };
  }, [hasPublicSelf]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [onClose]);

  return (
    <div
      ref={ref}
      data-testid="account-switcher"
      className="absolute bottom-[70px] left-0 z-50 w-[300px] rounded-2xl bg-white py-3 shadow-[0_0_15px_rgba(101,119,134,0.2),0_0_3px_1px_rgba(101,119,134,0.15)]"
    >
      {deviceIsThePage && rosterStatus === "loading" && !roster.length ? (
        <div data-testid="account-switcher-loading" className="flex items-center px-4 py-3" aria-busy="true">
          <span className="skeleton h-10 w-10 rounded-full bg-x-pill" />
          <span className="ml-3 flex-1">
            <span className="skeleton block h-3.5 w-32 rounded-full bg-x-pill" />
            <span className="skeleton mt-2 block h-3 w-24 rounded-full bg-x-pill" />
          </span>
        </div>
      ) : null}
      {deviceIsThePage && rosterStatus === "error" ? (
        <div data-testid="account-switcher-error" className="mx-3 mb-1 rounded-2xl border border-[#fdc9ce] bg-[#f4212e0d] p-3">
          <p className="text-[14px] leading-5 text-[#f4212e]">Couldn&apos;t read your personas{rosterError ? ": " + rosterError : "."}</p>
          <button type="button" onClick={refresh} className="mt-2 h-8 rounded-full bg-x-blue px-4 text-[14px] font-bold text-white">
            Retry
          </button>
        </div>
      ) : null}
      {personas.map((p) =>
        p.publicSelf === true && youSelectable ? (
          <button
            key={p.id}
            type="button"
            data-testid={`persona-row-${p.handle}`}
            data-public-self="true"
            data-you="true"
            data-acting={actingAsYou ? "true" : "false"}
            onClick={() => {
              if (!actingAsYou) void switchToRoot();
              onClose();
            }}
            title={"Act as yourself: your own " + selfVia + " account, with no persona."}
            className="flex w-full items-center px-4 py-3 text-left hover:bg-x-hover"
          >
            {p.avatarUrl && mediaHostAllowed(p.avatarUrl) ? (
              <img src={p.avatarUrl} alt="" referrerPolicy="no-referrer" className="h-10 w-10 rounded-full object-cover" />
            ) : (
              <span aria-hidden className="h-10 w-10 shrink-0 rounded-full bg-x-pill" />
            )}
            <div className="ml-3 flex min-w-0 flex-1 flex-col items-start">
              <span className="truncate text-[15px] font-bold leading-5">You</span>
              <span className="text-[15px] leading-5 text-x-sec">@{p.handle}</span>
              <span data-testid="public-self-chip" className="mt-0.5 rounded-full border border-x-border px-2 text-[12px] leading-4 text-x-sec">
                {selfVia} · your own account{selfDisconnected === true ? " · disconnected" : ""}
              </span>
              {actingAsYou ? (
                <span data-testid="you-acting-note" className="mt-1 text-[12px] leading-4 text-x-sec">
                  Acting as you, no persona. A reload goes back to your first persona.
                </span>
              ) : null}
            </div>
            {actingAsYou && (
              <svg viewBox="0 0 24 24" width={18.75} height={18.75} fill="#00ba7c" aria-label="Acting">
                <path d="M9.64 18.952l-5.55-4.861 1.317-1.504 3.951 3.459 8.459-10.948L19.4 6.32 9.64 18.952z" />
              </svg>
            )}
          </button>
        ) : p.publicSelf === true ? (
          <Link
            key={p.id}
            href={"/" + p.handle}
            data-testid={`persona-row-${p.handle}`}
            data-public-self="true"
            onClick={onClose}
            title="Your Farcaster account. Read-only here: it opens your profile."
            className="flex w-full items-center px-4 py-3 hover:bg-x-hover"
          >
            {/* the held-media rule: an avatar off the allowlist is a neutral disc here (its host would learn your address) */}
            {p.avatarUrl && mediaHostAllowed(p.avatarUrl) ? (
              <img src={p.avatarUrl} alt="" referrerPolicy="no-referrer" className="h-10 w-10 rounded-full object-cover" />
            ) : (
              <span aria-hidden className="h-10 w-10 shrink-0 rounded-full bg-x-pill" />
            )}
            <div className="ml-3 flex min-w-0 flex-1 flex-col items-start">
              <span className="truncate text-[15px] font-bold leading-5">{p.name}</span>
              <span className="text-[15px] leading-5 text-x-sec">@{p.handle}</span>
              <span data-testid="public-self-chip" className="mt-0.5 rounded-full border border-x-border px-2 text-[12px] leading-4 text-x-sec">
                {selfVia} · read-only{selfDisconnected === true ? " · disconnected" : ""}
              </span>
            </div>
          </Link>
        ) : (
        <button
          key={p.id}
          data-testid={`persona-row-${p.handle}`}
          onClick={() => {
            switchPersona(p.id);
            onClose();
          }}
          className="flex w-full items-center px-4 py-3 hover:bg-x-hover"
        >
          {(deviceIsThePage || emptyWorld) && !p.avatarUrl ? (
            // PROD-LIVE: no stock (fixture) face for a device persona without an avatar (nor under LAYERS_WORLD=empty)
            <span aria-hidden className="h-10 w-10 shrink-0 rounded-full bg-x-pill" />
          ) : (
            <img
              src={p.avatarUrl ?? "https://i.pravatar.cc/160?img=12"}
              alt=""
              className="h-10 w-10 rounded-full object-cover"
            />
          )}
          <div className="ml-3 flex min-w-0 flex-1 flex-col items-start">
            <span className="flex items-center text-[15px] font-bold leading-5">
              <span className="truncate">{p.name}</span>
              {/* LAYERS_WORLD=empty (review WORLD-LEAK-1): a real persona is not "verified" — the check mark was the
                  fixture self's */}
              {emptyWorld ? null : <VerifiedBadge size={16} className="ml-0.5 shrink-0" />}
              <TierBadge tier={tiers[p.id]} />
            </span>
            <span className="text-[15px] leading-5 text-x-sec">@{p.handle}</span>
          </div>
          {activePersona?.id === p.id && !actingAsYou && (
            <svg viewBox="0 0 24 24" width={18.75} height={18.75} fill="#00ba7c">
              <path d="M9.64 18.952l-5.55-4.861 1.317-1.504 3.951 3.459 8.459-10.948L19.4 6.32 9.64 18.952z" />
            </svg>
          )}
        </button>
        )
      )}

      <CreatePersonaRow creating={creating} setCreating={setCreating} onClose={onClose} />

      <div className="mt-1 border-t border-x-border pt-1">
        {/* PROD-LIVE: a soft navigation (next/link) — a full load would wipe an unsaved identity */}
        <Link
          href="/settings/account"
          data-testid="switcher-manage-personas"
          onClick={onClose}
          className="block w-full px-4 py-3 text-left text-[15px] font-bold hover:bg-x-hover"
        >
          Manage personas
        </Link>
        {activePersona ? (
          <button className="w-full px-4 py-3 text-left text-[15px] font-bold hover:bg-x-hover">
            Log out @{activePersona.handle}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function CreatePersonaRow({
  creating,
  setCreating,
  onClose,
}: {
  creating: boolean;
  setCreating: (v: boolean) => void;
  onClose: () => void;
}) {
  const { createPersona, makePersona, publicLive, toast } = useApp();
  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  const [err, setErr] = useState<string | null>(null);

  if (!creating)
    return (
      <button
        data-testid="create-persona-button"
        onClick={() => setCreating(true)}
        className="w-full px-4 py-3 text-left text-[15px] font-bold hover:bg-x-hover"
      >
        Create persona
      </button>
    );

  return (
    <div className="px-4 py-2">
      <input
        data-testid="persona-name-input"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Display name"
        className="mb-2 w-full rounded-md border border-[#cfd9de] px-3 py-2 text-[15px] outline-none focus:border-x-blue"
      />
      <input
        data-testid="persona-handle-input"
        value={handle}
        onChange={(e) => setHandle(e.target.value.replace(/[^A-Za-z0-9_]/g, ""))}
        placeholder="Handle"
        className="mb-2 w-full rounded-md border border-[#cfd9de] px-3 py-2 text-[15px] outline-none focus:border-x-blue"
      />
      {err && <p className="mb-2 text-[13px] text-[#f4212e]">{err}</p>}
      <button
        data-testid="persona-create-submit"
        onClick={async () => {
          // PUBLIC GO-LIVE (public live mode): a picture made on this device (no third-party image host learns the
          // handle) and the route's own refusal, never a guess. With the flag off the old create, unchanged.
          if (publicLive) {
            const r = await makePersona({ name, handle, avatarUrl: localAvatar(handle) });
            if (r.persona) {
              toast(r.error ?? "Persona created");
              setCreating(false);
              onClose();
            } else {
              setErr("Couldn't create it: " + (r.error ?? "try again"));
            }
            return;
          }
          const p = await createPersona({ name, handle });
          if (p) {
            toast("Persona created");
            setCreating(false);
            onClose();
          } else {
            setErr("Could not create persona (handle taken?)");
          }
        }}
        disabled={!name || !handle}
        className="h-8 w-full rounded-full bg-x-black-btn text-[14px] font-bold text-white disabled:opacity-50"
      >
        Create
      </button>
    </div>
  );
}
