"use client";
// FOLLOW MIGRATION — "N of your X follows are here", one confirm, and the
// deferred controls. The pending remainder is a COUNT, never a list — the
// non-matches exist only as hashes.
//
// PERSONA LAUNCH P2 (BYX G0): RIG-ONLY. It matches X follows against handles OTHER Totem personas linked, and every
// such link is a test link today, so off the rig it would find nobody real while looking like it works. The import
// page renders it only on the rig (app/(main)/settings/import-x/page.tsx); everywhere else "find your people" is the
// keyless Farcaster index (XPeoplePanel). Its suite (accept-x4) keeps running on the rig.
import { useCallback, useEffect, useState } from "react";

interface Match {
  matchedHandle: string;
  xHandle: string;
  alreadyFollowing: boolean;
}

export function MigrationPanel() {
  const [matches, setMatches] = useState<Match[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [deferred, setDeferred] = useState(true);
  const [excluded, setExcluded] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const j = await fetch("/api/x/migrate", { cache: "no-store" }).then((r) => r.json());
      setMatches(j.matches ?? []);
      setPendingCount(j.pendingCount ?? 0);
      setDeferred(j.prefs?.deferred ?? true);
      setExcluded((j.prefs?.excludedHandles ?? []).join(", "));
    } catch {
      /* surface stays quiet; the wizard above reports import errors */
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const migrate = async () => {
    setBusy(true);
    try {
      const j = await fetch("/api/x/migrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "migrate" }),
      }).then((r) => r.json());
      setResult(`Followed ${j.followed}${j.cleared ? ` (${j.cleared} already followed)` : ""}.`);
    } finally {
      setBusy(false);
      refresh();
    }
  };

  const savePrefs = async (patch: Record<string, unknown>) => {
    await fetch("/api/x/migrate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "prefs", ...patch }),
    });
    refresh();
  };

  const newMatches = matches.filter((m) => !m.alreadyFollowing);

  return (
    <div data-testid="migration-panel" className="border-t border-x-border px-4 py-4">
      <h3 className="text-[17px] font-extrabold">Follow migration</h3>
      {matches.length > 0 ? (
        <>
          <p className="mt-0.5 text-[15px]" data-testid="migration-count">
            <span className="font-bold">{matches.length}</span> of your X follows{" "}
            {matches.length === 1 ? "is" : "are"} here
            {newMatches.length !== matches.length && ` (${newMatches.length} new)`}.
          </p>
          <button
            data-testid="migration-confirm"
            disabled={busy || newMatches.length === 0}
            onClick={migrate}
            className="mt-2 h-9 rounded-full bg-x-black-btn px-4 text-[14px] font-bold text-white disabled:opacity-50"
          >
            Follow {newMatches.length === 1 ? "them" : `all ${newMatches.length}`}
          </button>
        </>
      ) : (
        <p className="mt-0.5 text-[15px] text-x-sec" data-testid="migration-empty">
          No matches yet.
        </p>
      )}
      {pendingCount > 0 && (
        <p className="mt-1 text-[13px] text-x-sec" data-testid="migration-pending">
          {pendingCount} from your list aren&rsquo;t here yet — stored as hashes only. If they
          join and link X, you&rsquo;ll auto-follow{deferred ? "" : " (currently off)"}.
        </p>
      )}
      {result && (
        <p className="mt-1.5 text-[13px] font-bold text-[#00ba7c]" data-testid="migration-result">
          {result}
        </p>
      )}
      <label className="mt-3 flex items-center gap-2 text-[14px]">
        <input
          type="checkbox"
          data-testid="migration-deferred"
          checked={deferred}
          onChange={(e) => savePrefs({ deferred: e.target.checked })}
        />
        Auto-follow when someone from your X list joins and links
      </label>
      <label className="mt-2 block text-[13px] text-x-sec">
        Never auto-follow these X handles (comma-separated):
        <input
          data-testid="migration-excluded"
          value={excluded}
          onChange={(e) => setExcluded(e.target.value)}
          onBlur={() =>
            savePrefs({
              excludedHandles: excluded
                .split(",")
                .map((h) => h.trim())
                .filter(Boolean),
            })
          }
          className="mt-1 w-full rounded-md border border-[#cfd9de] px-2 py-1 text-[14px] text-x-text"
        />
      </label>
    </div>
  );
}
