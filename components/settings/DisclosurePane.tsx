"use client";
// Per-persona linkage visibility + audience picker + inner-circle roster +
// mutual-consent unlock inbox.
import { useCallback, useEffect, useState } from "react";
import type { DisclosureGrant, DisclosureLevel, PersonaSummary, UnlockRequest } from "@/lib/adapters/types";
import { ErrorNote, LoadingRows, Row, SettingsGroup } from "./Chrome";

const LEVELS: { value: DisclosureLevel; label: string; blurb: string }[] = [
  { value: "public", label: "Public", blurb: "Anyone can see this persona links to your other identities" },
  { value: "followers", label: "Followers", blurb: "Only accounts you follow back can see the link" },
  { value: "inner_circle", label: "Inner circle", blurb: "Only people you explicitly grant, or who unlocked mutually" },
  { value: "hidden", label: "Hidden", blurb: "Nobody can see the link from this persona" },
];

export function DisclosurePane({ personas }: { personas: PersonaSummary[] }) {
  const [grants, setGrants] = useState<Record<string, DisclosureGrant> | null>(null);
  const [requests, setRequests] = useState<UnlockRequest[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const entries = await Promise.all(
        personas.map(async (p) => {
          const res = await fetch(`/api/disclosure?personaId=${p.id}`);
          if (!res.ok) throw new Error((await res.json()).error ?? "could not load disclosure settings");
          const data = await res.json();
          return [p.id, data] as const;
        })
      );
      const grantMap: Record<string, DisclosureGrant> = {};
      let reqs: UnlockRequest[] = [];
      for (const [id, data] of entries) {
        grantMap[id] = data.grant;
        reqs = [...reqs, ...data.requests];
      }
      setGrants(grantMap);
      setRequests(reqs.filter((r, i, arr) => arr.findIndex((x) => x.id === r.id) === i));
    } catch (e) {
      setError((e as Error).message);
      setGrants({});
    }
  }, [personas]);

  useEffect(() => {
    load();
  }, [load]);

  async function setLevel(personaId: string, level: DisclosureLevel) {
    setBusy(personaId);
    setError(null);
    try {
      const res = await fetch("/api/disclosure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ personaId, level }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "could not update");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function respond(requestId: string, accept: boolean) {
    setBusy(requestId);
    try {
      await fetch("/api/disclosure/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, accept }),
      });
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (grants === null) return <LoadingRows count={3} />;

  return (
    <>
      {/* PERSONA LAUNCH P4 (DROP §5e, dx-critic IMMEDIATE): these legacy levels are stored but no surface of another
          person's client reads them yet — said plainly, so nobody believes they changed what others see. Rings
          (Settings › Rings) are what decide which people see which personas are you. */}
      <p data-testid="disclosure-not-active" className="mx-4 mt-3 rounded-2xl border border-[#cfd9de] bg-[#f7f9f9] p-3 text-[13px] leading-4 text-x-sec">
        <span className="font-bold text-x-text">Not active yet — this does not change what others see.</span> These levels only decide who may
        view a persona&rsquo;s stake history. To show people which personas are you, use Rings in Settings.
      </p>
      <ErrorNote error={error} onRetry={load} />

      {personas.map((persona) => {
        const grant = grants[persona.id];
        return (
          <SettingsGroup
            key={persona.id}
            title={`@${persona.handle}`}
            note="Who can see that this persona and your other personas belong to the same account."
          >
            {LEVELS.map((level) => (
              <Row
                key={level.value}
                testid={`disclosure-${persona.handle}-${level.value}`}
                label={level.label}
                sub={level.blurb}
                onClick={() => setLevel(persona.id, level.value)}
                right={
                  busy === persona.id ? (
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-x-border border-t-x-blue" />
                  ) : grant?.level === level.value ? (
                    <svg viewBox="0 0 24 24" width={18} height={18} fill="#1d9bf0">
                      <path d="M9.64 18.952l-5.55-4.861 1.317-1.504 3.951 3.459 8.459-10.948L19.4 6.32 9.64 18.952z" />
                    </svg>
                  ) : null
                }
              />
            ))}
            {grant?.level === "inner_circle" && (
              <p className="px-4 py-2 text-[13px] leading-4 text-x-sec">
                Inner circle: {grant.innerCircleViewerIds.length} account
                {grant.innerCircleViewerIds.length === 1 ? "" : "s"} granted.
              </p>
            )}
          </SettingsGroup>
        );
      })}

      <SettingsGroup
        title="Unlock requests"
        note="Mutual-consent unlock: when both sides accept, both reveal. Neither side reveals alone."
      >
        {requests.length === 0 ? (
          <p className="px-4 py-3 text-[15px] text-x-sec">No pending requests.</p>
        ) : (
          requests.map((req) => (
            <div key={req.id} className="border-b border-x-border px-4 py-3 last:border-b-0">
              <p className="text-[15px] leading-5">
                Request to link with <span className="font-bold">{req.targetPersonaId.replace("persona_", "@")}</span>
              </p>
              <p className="text-[13px] leading-4 text-x-sec">status: {req.status}</p>
              {req.status === "pending" && (
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={() => respond(req.id, true)}
                    disabled={busy === req.id}
                    className="h-8 rounded-full bg-x-black-btn px-3 text-[13px] font-bold text-white disabled:opacity-50"
                  >
                    Accept
                  </button>
                  <button
                    onClick={() => respond(req.id, false)}
                    disabled={busy === req.id}
                    className="h-8 rounded-full border border-[#cfd9de] px-3 text-[13px] font-bold disabled:opacity-50"
                  >
                    Decline
                  </button>
                </div>
              )}
            </div>
          ))
        )}
      </SettingsGroup>
      <div className="h-24" />
    </>
  );
}
