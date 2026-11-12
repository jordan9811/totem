"use client";
// PERSONA LAUNCH P6: with `launchLinks` (the rig and the owner service — AccountPane's server-rendered roster; never the
// public preview, where launch isn't on yet), each public persona's row also carries "Launch @handle", a link to its
// launch page (preview → confirm → status). A link beside the switch button, never inside it (a button holds no link).
import Link from "next/link";
import { useEffect, useState } from "react";
import type { PersonaSummary } from "@/lib/adapters/types";
import { useApp } from "@/components/Providers";
import { mediaHostAllowed } from "@/components/CastCard";
import { ErrorNote, SettingsGroup } from "./Chrome";
import { TierBadge } from "../TierBadge";

export function PersonaSwitchList({
  personas,
  tiers,
  activeId,
  launchLinks = false,
}: {
  personas: PersonaSummary[];
  tiers: Record<string, number>;
  activeId: string;
  /** PERSONA LAUNCH P6: show "Launch @handle" on public personas' rows */
  launchLinks?: boolean;
}) {
  // PROD-LIVE (D-CU-0-4): refresh() is router.refresh() plus a refetch of every island — on a public deployment the
  // roster, the acting persona and this page's own data come from the browser device, which a server re-render
  // alone would not re-read. On the rig it is the router.refresh() this list always did.
  const { refresh } = useApp();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(activeId);
  // the acting persona can arrive after first render (the device's answer) or change under us (a switch from the
  // chrome): follow it
  useEffect(() => {
    setActive(activeId);
  }, [activeId]);

  async function switchTo(personaId: string) {
    setBusy(personaId);
    setError(null);
    try {
      const res = await fetch("/api/seed-persona", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ personaId }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "switch failed");
      setActive(personaId);
      refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <ErrorNote error={error} />
      <SettingsGroup title="Your personas" note="Each persona is a display identity. Casts publish under your signer; the client renders the persona.">
        {/* PERSONA LAUNCH P1 (review UX-8, defence in depth): a read-only public self is never a switch button
            (/api/seed-persona refuses it: PUBLIC_SELF_READ_ONLY); AccountPane lists it as a read-only row instead */}
        {personas.filter((persona) => persona.publicSelf !== true).map((persona) => (
          <div key={persona.id} className="flex w-full items-center">
          <button
            data-testid={`persona-switch-${persona.handle}`}
            onClick={() => switchTo(persona.id)}
            disabled={busy !== null}
            className="flex w-full items-center px-4 py-3 text-left transition-colors hover:bg-x-hover disabled:opacity-60"
          >
            {persona.avatarUrl && mediaHostAllowed(persona.avatarUrl) ? (
              // the held-media rule: an off-allowlist host would learn the visitor's address
              <img src={persona.avatarUrl} alt="" referrerPolicy="no-referrer" className="h-10 w-10 shrink-0 rounded-full bg-x-pill object-cover" />
            ) : (
              <span aria-hidden className="h-10 w-10 shrink-0 rounded-full bg-x-pill" />
            )}
            <span className="ml-3 min-w-0 flex-1">
              <span className="flex items-center text-[15px] font-bold leading-5">
                <span className="truncate">{persona.name}</span>
                <TierBadge tier={tiers[persona.id]} />
              </span>
              <span className="block truncate text-[15px] leading-5 text-x-sec">@{persona.handle}</span>
            </span>
            {busy === persona.id ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-x-border border-t-x-blue" />
            ) : persona.id === active ? (
              <svg viewBox="0 0 24 24" width={18} height={18} fill="#00ba7c">
                <path d="M9.64 18.952l-5.55-4.861 1.317-1.504 3.951 3.459 8.459-10.948L19.4 6.32 9.64 18.952z" />
              </svg>
            ) : null}
          </button>
          {launchLinks && persona.kind !== "private" ? (
            <Link
              href={`/launch/${encodeURIComponent(persona.id)}`}
              data-testid={`persona-launch-${persona.handle}`}
              className="mr-4 shrink-0 rounded-full border border-x-border px-3 py-1 text-[13px] font-bold text-x-text hover:bg-x-hover"
            >
              Launch @{persona.handle}
            </Link>
          ) : null}
          </div>
        ))}
      </SettingsGroup>
    </>
  );
}
