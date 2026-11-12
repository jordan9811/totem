"use client";
// PERSONA LAUNCH P2 (BYX G5-lite) — FIND YOUR PEOPLE, read-only in this wave.
//
// "N of the K people you follow on X are on Farcaster", one row each: the X handle (opens x.com in a new tab), the
// Farcaster name (opens farcaster.xyz), when they verified it; your own accounts are marked and never offered.
// "Check again" downloads the list again (POST /api/x/match rematch) and says what it checked against. When the site
// has no list, it says exactly that — never "0 matches". Keep / Queue / Follow are a later wave (BYX G5).
import { useCallback, useEffect, useState } from "react";

interface Item {
  fid: number;
  fname: string;
  xHandle: string;
  xId: string;
  verifiedAt: number;
  state: string;
}
type IndexStatus =
  | { available: true; builtAt: string; rows: number; fnameCoverage: number; ageHours: number | null }
  | { available: false; reason: string };
interface Answer {
  index: IndexStatus;
  counts: { follows: number; matched: number; own: number; unmatched: number };
  items: Item[];
  lastMatchedAt: number | null;
  /** where the follow list is matched and kept (app/api/x/match savedBy) */
  savedBy?: "device" | "service";
}

const day = (ms: number) => new Date(ms).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
const n = (x: number) => x.toLocaleString("en-US");

export function XPeoplePanel() {
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (method: "GET" | "POST") => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/x/match", method === "GET" ? { cache: "no-store" } : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "rematch", force: true }) });
      const j = await res.json().catch(() => null);
      if (!res.ok || !j?.counts) throw new Error((j && typeof j.error === "string" && j.error) || `HTTP ${res.status}`);
      setAnswer(j as Answer);
    } catch (e) {
      setError(`Couldn't check who you follow: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load("GET");
    const again = () => void load("GET");
    window.addEventListener("layers:x-imported", again);
    return () => window.removeEventListener("layers:x-imported", again);
  }, [load]);

  const idx = answer?.index;
  const follows = answer?.counts.follows ?? 0;
  const people = answer ? answer.items.filter((i) => i.state !== "own") : [];
  const own = answer ? answer.items.filter((i) => i.state === "own") : [];

  return (
    <div id="x-people" data-testid="x-people" className="border-t border-x-border px-4 py-4">
      <h3 className="text-[17px] font-extrabold">Find your people on Farcaster</h3>
      {error && (
        <p className="mt-1 text-[13px] text-[#f4212e]" data-testid="x-people-error">
          {error}
        </p>
      )}
      {!answer && !error && <p className="mt-1 text-[13px] text-x-sec">Checking…</p>}
      {answer && follows === 0 && (
        <p className="mt-1 text-[14px] text-x-sec" data-testid="x-people-none">
          Import who you follow from your X archive (above) to see who of them is on Farcaster.
        </p>
      )}
      {answer && follows > 0 && idx && !idx.available && (
        <p className="mt-1 text-[14px] text-x-sec" data-testid="x-people-unavailable">
          The matching list isn&rsquo;t available on this site yet, so Totem can&rsquo;t say who of the {n(follows)} people you follow on X is on Farcaster.
        </p>
      )}
      {answer && follows > 0 && idx?.available && answer.lastMatchedAt === null && (
        <p className="mt-1 text-[14px] text-x-sec" data-testid="x-people-unchecked">
          Not checked yet. Press &ldquo;Check again&rdquo; to compare the {n(follows)} people you follow on X with Farcaster&rsquo;s list.
        </p>
      )}
      {answer && follows > 0 && answer.lastMatchedAt !== null && (
        <>
          <p className="mt-1 text-[15px]" data-testid="x-people-sentence" data-matched={answer.counts.matched} data-follows={follows}>
            <span className="font-bold">{n(answer.counts.matched)}</span> of the {n(follows)} people you follow on X are on Farcaster.
          </p>
          {own.length > 0 && (
            <p className="text-[13px] text-x-sec" data-testid="x-people-own">
              {own.length === 1 ? "One of them is" : `${own.length} of them are`} your own account{own.length === 1 ? "" : "s"}, so not listed below.
            </p>
          )}
          <div className="mt-2">
            {people.map((p) => (
              <div key={p.fid + ":" + p.xId} data-testid="x-people-row" data-fid={p.fid} data-state={p.state} className="flex items-center justify-between border-b border-x-border py-2 text-[14px]">
                <span className="min-w-0">
                  <a href={"https://x.com/" + encodeURIComponent(p.xHandle)} target="_blank" rel="noopener noreferrer" className="font-bold hover:underline" data-testid="x-people-x">
                    @{p.xHandle}
                  </a>
                  <span className="text-x-sec"> on X is </span>
                  {p.fname ? (
                    <a href={"https://farcaster.xyz/" + encodeURIComponent(p.fname)} target="_blank" rel="noopener noreferrer" className="font-bold hover:underline" data-testid="x-people-fc">
                      @{p.fname}
                    </a>
                  ) : (
                    <a href={"https://farcaster.xyz/~/profiles/" + p.fid} target="_blank" rel="noopener noreferrer" className="font-bold hover:underline" data-testid="x-people-fc">
                      fid {p.fid}
                    </a>
                  )}
                  <span className="text-x-sec"> on Farcaster</span>
                </span>
                <span className="ml-2 shrink-0 text-[12px] text-x-sec">verified {day(p.verifiedAt)}</span>
              </div>
            ))}
          </div>
        </>
      )}
      {answer && follows > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button data-testid="x-people-check" disabled={busy} onClick={() => void load("POST")} className="h-8 rounded-full border border-[#cfd9de] px-4 text-[13px] font-bold hover:bg-x-hover">
            {busy ? "Checking…" : "Check again"}
          </button>
          {idx?.available && (
            <span className="text-[12px] text-x-sec" data-testid="x-people-checked">
              {answer.lastMatchedAt ? `checked ${day(answer.lastMatchedAt)} ` : ""}against the list built {idx.builtAt ? day(Date.parse(idx.builtAt)) : "recently"}
              {idx.ageHours !== null && idx.ageHours >= 48 ? ` (${Math.round(idx.ageHours / 24)} days old)` : ""}
              {idx.ageHours !== null && idx.ageHours >= 24 * 30 ? "; the list is out of date" : ""}
            </span>
          )}
        </div>
      )}
      {/* review UX-10: true words about where the follow list goes — a sealed copy IS stored, so never "never sent anywhere" */}
      <p className="mt-2 text-[12px] text-x-sec" data-testid="x-people-privacy" data-saved-by={answer?.savedBy ?? ""}>
        Following them on Farcaster from here comes later. The list is Farcaster&rsquo;s public record of verified X accounts,
        downloaded whole
        {answer?.savedBy === "service"
          ? "; who you follow is matched on your own service, which stores it sealed."
          : answer?.savedBy === "device"
            ? "; who you follow is matched on your own device, and Totem’s server keeps only a sealed copy it can’t read."
            : "."}
      </p>
    </div>
  );
}
