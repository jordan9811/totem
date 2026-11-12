"use client";
// PUBLIC GO-LIVE (the relay track) — Settings › Moderation: the public @anon's takedown queue.
//
// For EVERY visitor it renders cleanly: this identity's moderator key (public — the owner copies it into
// scripts/owner/arm-public-anon.ps1 -ModeratorKey) and, when this device is not one of the site's moderators, the plain
// sentence "You are not a moderator on this site." (never an error: the route walk reads this page as a normal page).
// On a moderator's device: the reported posts (a SIGNED read), each with Remove and Keep. Remove asks first, then hides the
// post in Totem at once (kept, never deleted) and, live, deletes it from Farcaster through the @anon signer — the line says
// where that delete stands, in plain words ("couldn't confirm" is said as such, never as "deleted"). Keep dismisses the
// reports so far. The removed posts of the last 7 days sit in a collapsed list with their delete state.
// PUBLIC GO-LIVE (ASM-2C): "Remove a post by its hash" — for a post that is not in the queue (no report yet, or a test post
// left over on a live site), the moderator pastes its hash and says which posts it is in (Farcaster or test): only there is
// the universe offered, and it is signed into the decision (app/api/anon/moderation/route.ts).
import { useCallback, useEffect, useState } from "react";

interface View {
  mode: string;
  publicKey: string | null;
  keyError: string | null;
  isModerator: boolean;
  moderated: boolean | null;
  listError: string | null;
  sentence: string;
  devHooks?: boolean;
}
interface Reported {
  castHash: string;
  text: string;
  reports: number;
  reasons: Record<string, number>;
  castUrl: string | null;
}
interface Removed {
  castHash: string;
  text: string;
  deleteState: string;
  deleteWords: string;
  castUrl: string | null;
}

export function AnonModerationPane() {
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<Reported[] | null>(null);
  const [removed, setRemoved] = useState<Removed[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [pasted, setPasted] = useState("");
  const [pastedUniverse, setPastedUniverse] = useState<"live" | "fixture">("live");
  const [pastedConfirm, setPastedConfirm] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/api/anon/moderation", { cache: "no-store" });
      const j = (await r.json().catch(() => null)) as View | null;
      if (!j) setError("Couldn't read this site's moderation settings just now.");
      else {
        setView(j);
        setError(null);
      }
    } catch {
      setError("Couldn't read this site's moderation settings just now.");
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const loadQueue = async () => {
    setBusy(true);
    try {
      const r = await fetch("/api/anon/moderation?list=1", { cache: "no-store" });
      const j = (await r.json().catch(() => null)) as { items?: Reported[] | null; removed?: Removed[] | null; error?: string } | null;
      if (r.ok && Array.isArray(j?.items)) {
        setItems(j!.items as Reported[]);
        setRemoved(Array.isArray(j?.removed) ? (j!.removed as Removed[]) : []);
        setNote(null);
      } else setNote(j?.error ?? "Couldn't load the reported posts.");
    } finally {
      setBusy(false);
    }
  };
  const decide = async (castHash: string, decision: "remove" | "keep", universe?: "live" | "fixture") => {
    setConfirm(null);
    setPastedConfirm(false);
    setBusy(true);
    try {
      const r = await fetch("/api/anon/moderation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "decide", castHash, decision, ...(universe ? { universe } : {}) }) });
      const j = (await r.json().catch(() => null)) as { sentence?: string | null; error?: string } | null;
      setNote(j?.sentence ?? j?.error ?? (r.ok ? "Done." : "The decision wasn't recorded."));
    } finally {
      setBusy(false);
    }
    await loadQueue();
  };
  const becomeTestModerator = async () => {
    const r = await fetch("/api/anon/moderation", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "registerTestModerator" }) });
    const j = (await r.json().catch(() => null)) as { error?: string } | null;
    setNote(r.ok ? "This device is now a test moderator on this rig's validator." : j?.error ?? "Refused.");
    await refresh();
  };

  return (
    <div data-testid="anon-moderation" className="px-4 pb-8">
      <p className="my-3 text-[15px] leading-5 text-x-sec">
        Anonymous posts reach Farcaster from one shared account. Anyone can report a post; a moderator can take it down. A removed post is hidden in Totem and deleted from Farcaster; its record is kept, never erased.
      </p>
      {error ? <p data-testid="anon-moderation-error" className="my-3 text-[15px] text-x-sec">{error}</p> : null}
      {view ? (
        <section data-testid="anon-moderation-status" data-moderator={view.isModerator ? "true" : "false"} className="py-2">
          <p data-testid="anon-moderation-sentence" className="text-[15px] font-bold leading-5">
            {view.sentence}
          </p>
          {view.moderated === false ? <p className="mt-1 text-[13px] leading-4 text-x-sec">No moderator is set up on this site yet.</p> : null}
          {view.listError ? <p className="mt-1 text-[13px] leading-4 text-x-sec">{view.listError}</p> : null}
          {view.publicKey ? (
            <p className="mt-2 text-[12px] leading-4 text-x-sec">
              This identity&rsquo;s moderator key (public, safe to share): <span data-testid="anon-moderator-key" className="break-all font-mono">{view.publicKey}</span>. It is the same on every device that unlocks or links this identity. To make this identity a moderator, the site&rsquo;s owner adds this key when switching on @anon.
            </p>
          ) : view.keyError ? (
            <p className="mt-2 text-[12px] leading-4 text-x-sec">{view.keyError}</p>
          ) : null}
          {!view.isModerator && view.devHooks ? (
            <button data-testid="anon-moderation-dev-moderator" onClick={() => void becomeTestModerator()} className="mt-2 h-8 rounded-full border border-[#cfd9de] px-3 text-[13px] font-bold hover:bg-x-hover">
              Make this device a test moderator (test rig only)
            </button>
          ) : null}
        </section>
      ) : !error ? (
        <p className="my-3 text-[15px] text-x-sec">Loading…</p>
      ) : null}
      {view?.isModerator ? (
        <section className="py-4" data-testid="anon-moderation-queue">
          <h2 className="text-[17px] font-bold leading-6">Reported posts</h2>
          <button data-testid="anon-moderation-load" disabled={busy} onClick={() => void loadQueue()} className="mt-2 h-9 rounded-full bg-x-blue px-4 text-[15px] font-bold text-white hover:bg-x-blue-hover disabled:opacity-50">
            Show reported posts
          </button>
          {items ? (
            <ul data-testid="anon-moderation-items" data-count={items.length} className="mt-3 space-y-3">
              {items.map((it) => (
                <li key={it.castHash} data-testid="anon-moderation-item" data-cast={it.castHash} className="rounded-xl border border-x-border p-3 text-[15px] leading-5">
                  <p>{it.text}</p>
                  <p className="mt-1 text-[12px] text-x-sec">
                    {it.reports === 1 ? "1 report" : it.reports + " reports"}: {Object.entries(it.reasons).map(([k, n]) => k + (n > 1 ? " ×" + n : "")).join(", ")}
                    {it.castUrl ? (
                      <>
                        {" · "}
                        <a href={it.castUrl} target="_blank" rel="noreferrer" className="text-x-blue hover:underline">
                          on Farcaster
                        </a>
                      </>
                    ) : null}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {confirm === it.castHash ? (
                      <>
                        <span className="text-[13px] text-x-sec">Remove it? It is hidden in Totem and deleted from Farcaster. This can&rsquo;t be undone on Farcaster.</span>
                        <button data-testid="anon-moderation-remove-confirm" disabled={busy} onClick={() => void decide(it.castHash, "remove")} className="h-8 rounded-full bg-x-black-btn px-3 text-[13px] font-bold text-white disabled:opacity-50">
                          Yes, remove
                        </button>
                        <button disabled={busy} onClick={() => setConfirm(null)} className="h-8 rounded-full px-3 text-[13px] font-bold text-x-blue hover:underline disabled:opacity-50">
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <button data-testid="anon-moderation-remove" disabled={busy} onClick={() => setConfirm(it.castHash)} className="h-8 rounded-full bg-x-black-btn px-3 text-[13px] font-bold text-white disabled:opacity-50">
                          Remove
                        </button>
                        <button data-testid="anon-moderation-keep" disabled={busy} onClick={() => void decide(it.castHash, "keep")} className="h-8 rounded-full border border-[#cfd9de] px-3 text-[13px] font-bold hover:bg-x-hover disabled:opacity-50">
                          Keep
                        </button>
                      </>
                    )}
                  </div>
                </li>
              ))}
              {items.length === 0 ? <li className="text-[13px] text-x-sec">No reported posts are waiting.</li> : null}
            </ul>
          ) : null}
          <div data-testid="anon-moderation-by-hash" className="mt-4 rounded-xl border border-x-border p-3">
            <h3 className="text-[15px] font-bold leading-5">Remove a post by its hash</h3>
            <p className="mt-1 text-[13px] leading-4 text-x-sec">For a post that isn&rsquo;t in the list above. Paste its 64-character hash and say where it was posted.</p>
            <input
              data-testid="anon-moderation-hash"
              value={pasted}
              onChange={(e) => {
                setPasted(e.target.value.trim().toLowerCase());
                setPastedConfirm(false);
              }}
              placeholder="Paste the hash (64 characters)"
              className="mt-2 w-full rounded-md border border-x-border px-2 py-1 font-mono text-[12px]"
            />
            {/^[0-9a-f]{64}$/.test(pasted) ? (
              <div className="mt-2 flex flex-wrap items-center gap-3 text-[13px]">
                <label className="flex items-center gap-1">
                  <input type="radio" name="anon-moderation-universe" data-testid="anon-moderation-universe-live" checked={pastedUniverse === "live"} onChange={() => setPastedUniverse("live")} /> Posted to Farcaster
                </label>
                <label className="flex items-center gap-1">
                  <input type="radio" name="anon-moderation-universe" data-testid="anon-moderation-universe-fixture" checked={pastedUniverse === "fixture"} onChange={() => setPastedUniverse("fixture")} /> A test post (never on Farcaster)
                </label>
                {pastedConfirm ? (
                  <>
                    <span className="text-x-sec">{pastedUniverse === "live" ? "Remove it? It is hidden in Totem and deleted from Farcaster. This can’t be undone on Farcaster." : "Remove it? It is hidden in Totem."}</span>
                    <button data-testid="anon-moderation-hash-confirm" disabled={busy} onClick={() => void decide(pasted, "remove", pastedUniverse)} className="h-8 rounded-full bg-x-black-btn px-3 text-[13px] font-bold text-white disabled:opacity-50">
                      Yes, remove
                    </button>
                    <button disabled={busy} onClick={() => setPastedConfirm(false)} className="h-8 rounded-full px-3 text-[13px] font-bold text-x-blue hover:underline disabled:opacity-50">
                      Cancel
                    </button>
                  </>
                ) : (
                  <button data-testid="anon-moderation-hash-remove" disabled={busy} onClick={() => setPastedConfirm(true)} className="h-8 rounded-full bg-x-black-btn px-3 text-[13px] font-bold text-white disabled:opacity-50">
                    Remove
                  </button>
                )}
              </div>
            ) : null}
          </div>
          {removed && removed.length ? (
            <details data-testid="anon-moderation-removed" className="mt-3">
              <summary className="cursor-pointer text-[13px] font-bold text-x-sec">Removed in the last 7 days ({removed.length})</summary>
              <ul className="mt-2 space-y-3">
                {removed.map((r) => (
                  <li key={r.castHash} data-testid="anon-moderation-removed-item" data-state={r.deleteState} className="rounded-xl border border-x-border p-3 text-[15px] leading-5">
                    <p>{r.text}</p>
                    <p className="mt-1 text-[12px] text-x-sec">{r.deleteWords}</p>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </section>
      ) : null}
      {note ? (
        <p data-testid="anon-moderation-note" className="mt-2 text-[13px] text-x-sec">
          {note}
        </p>
      ) : null}
    </div>
  );
}
