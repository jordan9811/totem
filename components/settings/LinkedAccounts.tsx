"use client";
// LINKED ACCOUNTS — external platform attestations on the ACTIVE persona.
// The acting persona is unmistakable (same chrome discipline as the curator
// desk): linking binds THIS persona, and the panel says which one.
//
// PERSONA LAUNCH P2 (BYX G0 + G6):
//   - the label comes from the SERVER (GET /api/x/link `label`, lib/x/attestations.ts attestationLabel): a fixture link
//     reads "test link, not verified", a Farcaster verification "verified on Farcaster". Nothing here words a method.
//   - the handle box and the Link button exist only where the fixture link exists (`fixtureAvailable`: the rig); the
//     test-data sync buttons likewise.
//   - the badge "X @handle, verified on Farcaster · since <date>" is read from GET /api/x/identity: the persona's own
//     Farcaster account, looked up in the keyless index. Linking it is a click (POST attest), never a side effect.
//   - review UX-11: "verify it in a Farcaster app" is said only where it can be followed (the persona has a Farcaster
//     account AND the site has the list); everywhere else the panel says the feature isn't available on this site yet.
import { useCallback, useEffect, useState } from "react";

interface Attestation {
  platform: string;
  handle: string;
  verifiedAt: number;
  method: string;
  sourceVerifiedAt?: number | null;
  staleSince?: number | null;
}

type Identity =
  | { offered: false }
  | {
      offered: true;
      fid: number | null;
      x: { handle: string; verifiedAt: number } | null;
      index: { available: true; builtAt: string } | { available: false; reason: string };
      linked: boolean;
      stale: boolean;
    };

const sinceDate = (ms: number) => new Date(ms).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });

export function LinkedAccounts() {
  const [mode, setMode] = useState<string>("");
  const [personaHandle, setPersonaHandle] = useState<string>("");
  const [attestation, setAttestation] = useState<Attestation | null>(null);
  const [label, setLabel] = useState<string | null>(null);
  const [fixtureAvailable, setFixtureAvailable] = useState(false);
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [fixtureHandle, setFixtureHandle] = useState("yeak_offchain");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [syncNote, setSyncNote] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const j = await fetch("/api/x/link", { cache: "no-store" }).then((r) => r.json());
      setMode(j.mode ?? "");
      setPersonaHandle(j.personaHandle ?? "");
      setAttestation(j.attestation ?? null);
      setLabel(typeof j.label === "string" ? j.label : null);
      setFixtureAvailable(j.fixtureAvailable === true);
    } catch {
      setError("Couldn't load link status.");
    }
    try {
      const r = await fetch("/api/x/identity", { cache: "no-store" });
      const j = await r.json();
      setIdentity(r.ok ? (j as Identity) : null);
      if (!r.ok && typeof j?.error === "string") setError(j.error);
    } catch {
      setIdentity(null);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const act = async (url: string, body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await res.json().catch(() => null);
      if (!res.ok) setError((j && typeof j.error === "string" && j.error) || "That didn't work. Try again.");
    } finally {
      setBusy(false);
      refresh();
    }
  };

  const verifiedBadge =
    attestation && attestation.method === "farcaster-verified" && !attestation.staleSince && identity?.offered && !identity.stale
      ? attestation
      : null;

  return (
    <div data-testid="linked-accounts" className="border-t border-x-border px-4 py-4">
      <h3 className="text-[17px] font-extrabold">Linked accounts</h3>
      <p className="mt-0.5 text-[13px] text-x-sec" data-testid="link-acting-persona">
        Account links land on <span className="font-bold">@{personaHandle}</span>, the
        persona you are acting as right now.
        {fixtureAvailable && mode === "fixture" && " (fixture mode: recorded OAuth exchange, a test link only)"}
      </p>

      {error && (
        <p className="mt-1.5 text-[13px] text-[#f4212e]" data-testid="link-error">
          {error}
        </p>
      )}

      {attestation ? (
        <div className="mt-2" data-testid="link-status" data-linked="true" data-method={attestation.method}>
          <p className="text-[15px]">
            <span className="font-bold">X</span> · @{attestation.handle}
            <span
              data-testid="link-method"
              data-method={attestation.method}
              className="ml-2 rounded-full border border-[#cfd9de] px-2 py-0.5 text-[12px] text-x-sec"
            >
              {label ?? "not verified"}
            </span>
          </p>
          {verifiedBadge && (
            <p className="mt-1 text-[13px]" data-testid="x-verified-badge">
              X @{verifiedBadge.handle}, verified on Farcaster
              {verifiedBadge.sourceVerifiedAt ? ` · since ${sinceDate(verifiedBadge.sourceVerifiedAt)}` : ""}
            </p>
          )}
          <button
            data-testid="link-unlink"
            disabled={busy}
            onClick={() => act("/api/x/link", { action: "unlink", handle: attestation.handle })}
            className="mt-2 h-8 rounded-full border border-[#cfd9de] px-4 text-[14px] font-bold hover:bg-x-hover"
          >
            Unlink
          </button>
          <p className="mt-1 text-[12px] text-x-sec">
            Unlinking removes the link and stops follow matching. Anything already
            imported stays (it&rsquo;s your data), marked &ldquo;source unlinked&rdquo;.
          </p>
          {fixtureAvailable && (
            <div className="mt-2 flex items-center gap-2">
              <button
                data-testid="sync-bookmarks"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const r = await fetch("/api/x/sync", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ kind: "bookmarks" }),
                    }).then((x) => x.json());
                    setSyncNote(
                      r.error ?? `${r.newItems} new bookmark${r.newItems === 1 ? "" : "s"} · $${r.cost} (${r.mode})`
                    );
                  } finally {
                    setBusy(false);
                  }
                }}
                className="h-8 rounded-full border border-[#cfd9de] px-3 text-[13px] font-bold hover:bg-x-hover"
              >
                Sync bookmarks (test data)
              </button>
              <button
                data-testid="sync-follows"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const r = await fetch("/api/x/sync", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ kind: "follows" }),
                    }).then((x) => x.json());
                    setSyncNote(
                      r.error ?? `${r.newItems} follow change${r.newItems === 1 ? "" : "s"} · $${r.cost} (${r.mode})`
                    );
                  } finally {
                    setBusy(false);
                  }
                }}
                className="h-8 rounded-full border border-[#cfd9de] px-3 text-[13px] font-bold hover:bg-x-hover"
              >
                Sync follows (test data)
              </button>
            </div>
          )}
          {syncNote && (
            <p className="mt-1 text-[12px] text-x-sec" data-testid="sync-note">
              {syncNote}. On-demand only, every request through the spend ledger.
            </p>
          )}
        </div>
      ) : (
        <div className="mt-2" data-testid="link-status" data-linked="false">
          {fixtureAvailable ? (
            <>
              <input
                data-testid="link-fixture-handle"
                value={fixtureHandle}
                onChange={(e) => setFixtureHandle(e.target.value)}
                className="mr-2 w-48 rounded-md border border-[#cfd9de] px-2 py-1 text-[14px]"
                placeholder="X handle (test link)"
              />
              <button
                data-testid="link-connect"
                disabled={busy}
                onClick={() => act("/api/x/link", { action: "link", fixtureHandle })}
                className="h-8 rounded-full bg-x-black-btn px-4 text-[14px] font-bold text-white"
              >
                Make a test link
              </button>
            </>
          ) : identity === null ? null : identity.offered && identity.fid !== null && identity.index.available ? (
            // review UX-11: the how-to only where it can be followed — this persona HAS a Farcaster account and this
            // site HAS the list to read the verification from; anywhere else it sent people on an errand that ends nowhere
            <p className="text-[13px] text-x-sec" data-testid="link-how">
              To show your X account here, verify it in a Farcaster app on the Farcaster account this persona uses.
              Totem then reads that verification from Farcaster&rsquo;s public list.
            </p>
          ) : (
            <p className="text-[13px] text-x-sec" data-testid="link-unavailable">
              Showing your X account on a persona isn&rsquo;t available on this site yet.
            </p>
          )}
        </div>
      )}

      {identity?.offered && identity.x && !(attestation && attestation.method === "farcaster-verified" && attestation.handle === identity.x.handle.toLowerCase()) && (
        <div className="mt-2 rounded-xl border border-x-border p-2.5" data-testid="x-identity-offer">
          <p className="text-[14px]">
            Farcaster says this persona&rsquo;s account verified X <span className="font-bold">@{identity.x.handle}</span>.
          </p>
          <button
            data-testid="x-identity-attest"
            disabled={busy}
            onClick={() => act("/api/x/identity", { action: "attest" })}
            className="mt-1.5 h-8 rounded-full bg-x-black-btn px-4 text-[13px] font-bold text-white"
          >
            Show it on @{personaHandle}
          </button>
        </div>
      )}
      {attestation && identity?.offered && identity.fid !== null && !identity.index.available && (
        <p className="mt-2 text-[12px] text-x-sec" data-testid="x-identity-unavailable">
          The Farcaster list of verified X accounts isn&rsquo;t available on this site yet.
        </p>
      )}
    </div>
  );
}
