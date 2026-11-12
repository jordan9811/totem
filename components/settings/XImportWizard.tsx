"use client";
// THE IMPORT WIZARD — PERSONA LAUNCH P2 (BYX G3) rewrite.
//
//   1. Drop in the archive X gave you: the ZIP, or its extracted folder. "The archive file never leaves this browser"
//      is literally true — lib/x/archiveZip.ts reads the few files the importer needs, in this page, and the raw
//      archive (with its email, phone, DMs and media) never leaves it. Review UX-10: the PARSED lanes the person picks
//      do leave the page (to the in-tab device that seals them for the validator on a public deployment, to the
//      server on a single-owner service or the rig), so the sentence says exactly that, worded from the route's
//      `savedBy`, and never "nothing is uploaded".
//   2. What was read: "We read @handle: N posts (M retweets, R replies), K people you follow, L likes", which persona
//      receives it (private personas take the shelf only), which lanes (likes off by default), and THE WARNING: the
//      follow list is a fingerprint — it must be acknowledged before that lane can be imported.
//   3. Saving: the parsed lanes go to /api/x/import in batches (answered in this tab by the browser device on a public
//      deployment), then one commit seals them into the X documents.
//   4. "Imported" — shown ONLY on a 200 from commit. Any failure shows the server's own sentence; nothing partial is
//      kept by a refused commit, and trying again never duplicates (put-by-id).
// A refresh before Import means dropping the file again (the parsed lanes live in this page and, once sent, in the
// session's memory). On the rig, the "Load the test archive" button runs the fixture archive through the same steps.
//
// A TAB-ONLY IDENTITY (the public site, D-CU-0-6) loses everything on a full page load, so (reviews UX-1, UX-5): the
// pick step says so before the import, a landed import announces the Save moment (components/device/SaveMoment.tsx
// offers the passkey once, right then), and "See your history" is a SOFT navigation (next/link) — a plain <a href>
// reloaded the page and wiped the identity and the import that had just landed.
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { readArchive, type ParsedArchive } from "@/lib/x/archiveZip";
import { MOMENT_EVENT, tabOnly } from "@/components/device/SaveMoment";
import { DEVICE_EVENT } from "@/lib/device/bootState";

/**
 * Announce the Save moment for a landed import. Dispatched by NAME rather than through announceMoment's typed kind so
 * this file compiles whichever side lands first: the card shows it once SaveMoment's MOMENT_KINDS names "import"
 * (a cross-track change; scripts/smoke-x.mjs P5 fails until it does, so a silent no-op cannot ship). Never throws.
 */
function announceImportMoment(): void {
  try {
    window.dispatchEvent(new CustomEvent(MOMENT_EVENT, { detail: { kind: "import" } }));
  } catch {
    /* no window event support: the strip still says it */
  }
}

interface Lane {
  lane: string;
  count: number;
  sensitiveHeld?: number;
  retweets?: number;
  replies?: number;
  overCap?: { total: number; cap: number };
}

interface SessionInfo {
  id: string;
  status: string;
  personaId: string;
  archiveHandle: string | null;
  verified: boolean;
  files: string[];
  counts?: { posts: number; retweets: number; replies: number; following: number; likes: number; interests: number };
  committedLanes: string[];
  staged: boolean;
}

interface PersonaOption {
  id: string;
  handle: string;
  kind: "public" | "private";
}

interface Limits {
  maxPosts: number;
  maxFollows: number;
  maxLikes: number;
}

const LANE_LABEL: Record<string, string> = {
  posts: "Posts (your profile history, with their original dates)",
  likes: "Likes (private to you)",
  following: "Who you follow (to find them on Farcaster)",
  personalization: "Ad-interest profile (as x-inferred claims)",
};

const n = (x: number) => x.toLocaleString("en-US");

type Step =
  | { kind: "pick" }
  | { kind: "reading"; file: string; done: number; total: number }
  | { kind: "review"; source: "page"; parsed: ParsedArchive }
  | { kind: "review"; source: "fixture"; session: SessionInfo; lanes: Lane[] }
  | { kind: "saving"; what: string }
  | { kind: "done"; landed: Record<string, number>; hiddenRetweets: number; heldSensitive: number; handle: string | null };

export function XImportWizard() {
  const [step, setStep] = useState<Step>({ kind: "pick" });
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [fixtureAvailable, setFixtureAvailable] = useState(false);
  const [limits, setLimits] = useState<Limits>({ maxPosts: 20000, maxFollows: 10000, maxLikes: 500 });
  const [batch, setBatch] = useState({ posts: 500, following: 2000, likes: 500, interests: 2000 });
  const [personas, setPersonas] = useState<PersonaOption[]>([]);
  const [personaId, setPersonaId] = useState<string>("");
  const [selected, setSelected] = useState<Set<string>>(new Set(["posts", "following", "personalization"]));
  const [ack, setAck] = useState(false);
  const [newest, setNewest] = useState<Record<string, boolean>>({});
  const [queue, setQueue] = useState<{ key: string; category: string; name: string }[]>([]);
  const [resumed, setResumed] = useState(false);
  /** who keeps the parsed lanes (the route says; null until it has) — the local-only sentence is worded from it */
  const [savedBy, setSavedBy] = useState<"device" | "service" | null>(null);
  /** this identity lives only in this tab (the public site, not saved yet): said before an import, re-read on boot */
  const [tabOnlyNow, setTabOnlyNow] = useState(false);
  const busy = step.kind === "reading" || step.kind === "saving";

  useEffect(() => {
    const read = () => setTabOnlyNow(tabOnly());
    read();
    window.addEventListener(DEVICE_EVENT, read);
    return () => window.removeEventListener(DEVICE_EVENT, read);
  }, []);

  const post = useCallback(async (body: Record<string, unknown>) => {
    const res = await fetch("/api/x/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = await res.json().catch(() => null);
    if (!res.ok) throw new Error((j && typeof j.error === "string" && j.error) || `the import route answered ${res.status}`);
    return j;
  }, []);

  const loadPreview = useCallback(async (sessionId: string) => {
    const res = await fetch("/api/x/import?sessionId=" + encodeURIComponent(sessionId), { cache: "no-store" });
    const j = await res.json().catch(() => null);
    if (!res.ok || !j?.session) throw new Error((j && j.error) || "the import could not be previewed");
    const lanes: Lane[] = j.lanes ?? [];
    setSelected(new Set(lanes.map((l) => l.lane).filter((l) => l !== "likes")));
    setStep({ kind: "review", source: "fixture", session: j.session as SessionInfo, lanes });
  }, []);

  // what this site offers, the persona list, and a resumable (server-staged) import
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/x/import?view=summary", { cache: "no-store" });
        const j = await res.json().catch(() => null);
        if (!res.ok) {
          setError((j && j.error) || "Couldn't read your X import status.");
          return;
        }
        setFixtureAvailable(j.fixtureAvailable === true);
        if (j.savedBy === "device" || j.savedBy === "service") setSavedBy(j.savedBy);
        if (j.limits) setLimits(j.limits);
        if (j.batch) setBatch(j.batch);
        setQueue(j.sensitiveQueue ?? []);
        const open = (j.sessions ?? []).find((x: SessionInfo) => x.status !== "committed" && x.status !== "discarded");
        if (open && open.staged && open.files.length > 0) {
          setResumed(true);
          await loadPreview(open.id);
        } else if (open && !open.staged && open.files.length > 0) {
          setNote("An earlier import was not finished, and Totem has restarted since. Nothing from it was kept: drop the archive in again.");
          post({ action: "discard", sessionId: open.id }).catch(() => undefined);
        }
      } catch {
        /* fresh start */
      }
    })();
    (async () => {
      try {
        const j = await fetch("/api/personas/act-as-options", { cache: "no-store" }).then((r) => r.json());
        const opts: PersonaOption[] = (j.options ?? []).map((o: PersonaOption) => ({ id: o.id, handle: o.handle, kind: o.kind }));
        setPersonas(opts);
        setPersonaId((cur) => cur || j.activeId || opts[0]?.id || "");
      } catch {
        /* the acting persona receives it */
      }
    })();
  }, [loadPreview, post]);

  const persona = personas.find((p) => p.id === personaId) ?? null;
  const isPrivate = persona?.kind === "private";

  const readFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setError(null);
    setNote(null);
    setResumed(false);
    setStep({ kind: "reading", file: "", done: 0, total: 0 });
    try {
      const parsed = await readArchive(files.length === 1 ? files[0] : files, {
        onProgress: (p) => setStep({ kind: "reading", file: p.file, done: p.done, total: p.total }),
      });
      setSelected(new Set(["posts", "following", "personalization"].filter((l) => (l === "posts" ? parsed.counts.posts : l === "following" ? parsed.counts.following : parsed.counts.interests) > 0)));
      setAck(false);
      setNewest({});
      setStep({ kind: "review", source: "page", parsed });
    } catch (e) {
      setError(`Couldn't read that archive: ${(e as Error).message}`);
      setStep({ kind: "pick" });
    }
  };

  const loadFixture = async () => {
    setError(null);
    setNote(null);
    setStep({ kind: "saving", what: "Loading the test archive…" });
    try {
      const begun = await post({ action: "begin", personaId: personaId || undefined });
      await post({ action: "ingestFixture", sessionId: begun.sessionId });
      setAck(false);
      await loadPreview(begun.sessionId);
    } catch (e) {
      setError((e as Error).message);
      setStep({ kind: "pick" });
    }
  };

  // the lanes on offer, with counts and caps, for whichever source the review shows
  const review = step.kind === "review" ? step : null;
  const offered: Lane[] = useMemo(() => {
    if (!review) return [];
    if (review.source === "fixture") return review.lanes;
    const c = review.parsed.counts;
    const out: Lane[] = [];
    const cap = (count: number, max: number) => (count > max ? { overCap: { total: count, cap: max } } : {});
    if (c.posts) out.push({ lane: "posts", count: c.posts, retweets: c.retweets, replies: c.replies, ...cap(c.posts, limits.maxPosts) });
    if (c.following) out.push({ lane: "following", count: c.following, ...cap(c.following, limits.maxFollows) });
    if (c.likes) out.push({ lane: "likes", count: c.likes, ...cap(c.likes, limits.maxLikes) });
    if (c.interests) out.push({ lane: "personalization", count: c.interests });
    return out;
  }, [review, limits]);

  const handle = review ? (review.source === "page" ? review.parsed.account?.username ?? null : review.session.archiveHandle) : null;
  const followingOn = selected.has("following") && !isPrivate;
  const blockedByCap = offered.some((l) => selected.has(l.lane) && l.overCap && !newest[l.lane]);
  const canImport = !!review && selected.size > 0 && (!followingOn || ack) && !blockedByCap && !(isPrivate && selected.size === 1 && selected.has("following"));

  const commit = async () => {
    if (!review) return;
    setError(null);
    const lanes = [...selected].filter((l) => !(l === "following" && isPrivate));
    try {
      let sessionId: string;
      if (review.source === "fixture") {
        sessionId = review.session.id;
      } else {
        const p = review.parsed;
        setStep({ kind: "saving", what: "Starting…" });
        const begun = await post({ action: "begin", personaId: personaId || undefined });
        sessionId = begun.sessionId;
        await post({ action: "account", sessionId, account: p.account });
        if (lanes.includes("posts")) {
          const take = newest.posts ? p.posts.slice(0, limits.maxPosts) : p.posts;
          for (let i = 0; i < take.length; i += batch.posts) {
            setStep({ kind: "saving", what: `Sending your posts: ${n(Math.min(take.length, i + batch.posts))} of ${n(take.length)}` });
            await post({ action: "posts", sessionId, part: i / batch.posts, totalParts: Math.ceil(take.length / batch.posts), total: p.posts.length, newestOnly: !!newest.posts, posts: take.slice(i, i + batch.posts) });
          }
        }
        if (lanes.includes("following")) {
          const take = newest.following ? p.following.slice(0, limits.maxFollows) : p.following;
          for (let i = 0; i < take.length; i += batch.following) {
            setStep({ kind: "saving", what: `Sending who you follow: ${n(Math.min(take.length, i + batch.following))} of ${n(take.length)}` });
            await post({ action: "following", sessionId, part: i / batch.following, totalParts: Math.ceil(take.length / batch.following), total: p.following.length, newestOnly: !!newest.following, ids: take.slice(i, i + batch.following) });
          }
        }
        if (lanes.includes("likes")) {
          const take = newest.likes ? p.likes.slice(0, limits.maxLikes) : p.likes;
          for (let i = 0; i < take.length; i += batch.likes) {
            await post({ action: "likes", sessionId, part: i / batch.likes, totalParts: Math.ceil(take.length / batch.likes), total: p.likes.length, newestOnly: !!newest.likes, likes: take.slice(i, i + batch.likes) });
          }
        }
        if (lanes.includes("personalization") && p.interests.length) await post({ action: "interests", sessionId, names: p.interests.slice(0, batch.interests) });
      }
      setStep({ kind: "saving", what: "Saving your X data, sealed…" });
      const j = await post({ action: "commit", sessionId, lanes, personaId: personaId || undefined, acknowledgedFingerprintWarning: followingOn ? ack : false });
      setStep({ kind: "done", landed: j.landed ?? {}, hiddenRetweets: j.hidden?.retweets ?? 0, heldSensitive: j.heldSensitive ?? 0, handle: persona?.handle ?? null });
      const q = await fetch("/api/x/import?view=summary", { cache: "no-store" }).then((r) => r.json()).catch(() => null);
      if (q) setQueue(q.sensitiveQueue ?? []);
      window.dispatchEvent(new CustomEvent("layers:x-imported"));
      // the first useful moment on a tab-only identity: thousands of rows that a reload would lose (review UX-5)
      announceImportMoment();
    } catch (e) {
      // the server's own sentence ("Couldn't save your X data: …", "Your X archive has 20,001 posts…")
      setError((e as Error).message);
      setStep(review);
    }
  };

  const toggle = (lane: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(lane)) next.delete(lane);
      else next.add(lane);
      return next;
    });

  return (
    <div data-testid="x-import-wizard" data-step={step.kind} className="px-4 py-4">
      {error && (
        <p className="mb-2 text-[13px] text-[#f4212e]" data-testid="import-error">
          {error}
        </p>
      )}
      {note && (
        <p className="mb-2 rounded-lg bg-[#f7f9f9] px-3 py-2 text-[13px] text-x-sec" data-testid="import-note">
          {note}
        </p>
      )}

      {step.kind === "pick" && (
        <div data-testid="import-drop">
          <p className="text-[15px] leading-5">Bring in the archive X gives you: the ZIP, or the folder you extracted from it.</p>
          <p className="mt-1 text-[13px] font-bold text-x-text" data-testid="import-local-only" data-saved-by={savedBy ?? ""}>
            The archive file never leaves this browser.
            {savedBy === "device" && " Only the parts you pick below are saved, sealed so Totem’s server can’t read them."}
            {savedBy === "service" && " Only the parts you pick below are sent to your service, which stores them sealed."}
          </p>
          {tabOnlyNow && (
            <p className="mt-1 rounded-lg bg-[#fff8e1] px-3 py-2 text-[13px] text-x-text" data-testid="import-tab-only">
              This identity lives only in this tab; save it before importing so your history is here tomorrow.
            </p>
          )}
          <p className="mt-0.5 text-[13px] text-x-sec">
            Totem reads only your posts, who you follow, your likes and your ad interests. Your email, phone number,
            messages and media are never read. Get the archive from X: Settings, Your account, Download an archive of your data.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <label className="h-9 cursor-pointer rounded-full bg-x-black-btn px-4 text-[14px] font-bold leading-9 text-white">
              Choose the ZIP
              <input data-testid="import-file" type="file" accept=".zip,application/zip,.js" multiple className="hidden" onChange={(e) => readFiles(e.target.files)} />
            </label>
            <label className="h-9 cursor-pointer rounded-full border border-[#cfd9de] px-4 text-[14px] font-bold leading-9">
              Choose the extracted folder
              <input
                data-testid="import-folder"
                type="file"
                className="hidden"
                onChange={(e) => readFiles(e.target.files)}
                {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
              />
            </label>
            {fixtureAvailable && (
              <button
                data-testid="import-load-fixture"
                disabled={busy}
                onClick={loadFixture}
                className="h-9 rounded-full border border-dashed border-[#cfd9de] px-4 text-[14px] font-bold hover:bg-x-hover"
              >
                Load the test archive
              </button>
            )}
          </div>
          <p className="mt-2 text-[12px] text-x-sec">An archive over 4 GB has to be extracted first; then pick its data folder.</p>
        </div>
      )}

      {step.kind === "reading" && (
        <p className="text-[14px] text-x-sec" data-testid="import-reading">
          Reading your archive in this browser{step.total ? `: ${step.done} of ${step.total} files` : "…"}
        </p>
      )}

      {step.kind === "saving" && (
        <p className="text-[14px] text-x-sec" data-testid="import-progress">
          {step.what}
        </p>
      )}

      {review && (
        <div data-testid="import-preview" data-source={review.source}>
          {resumed && (
            <p className="mb-2 rounded-lg bg-[#f7f9f9] px-3 py-2 text-[13px] text-x-sec" data-testid="import-resumed">
              Resumed an import that was not finished; nothing was lost.
            </p>
          )}
          <p className="text-[15px]" data-testid="import-summary">
            We read <span className="font-bold">@{handle ?? "…"}</span>
            {review.source === "page" && (
              <>
                : {n(review.parsed.counts.posts)} posts ({n(review.parsed.counts.retweets)} retweets, {n(review.parsed.counts.replies)} replies),{" "}
                {n(review.parsed.counts.following)} people you follow, {n(review.parsed.counts.likes)} likes
              </>
            )}
            .
          </p>
          {personas.length > 0 && (
            <label className="mt-2 block text-[14px]">
              Bring it into{" "}
              <select
                data-testid="import-persona"
                value={personaId}
                onChange={(e) => setPersonaId(e.target.value)}
                disabled={review.source === "fixture"}
                className="rounded-md border border-[#cfd9de] px-2 py-1 text-[14px]"
              >
                {personas.map((p) => (
                  <option key={p.id} value={p.id}>
                    @{p.handle}
                    {p.kind === "private" ? " (private)" : ""}
                  </option>
                ))}
              </select>
            </label>
          )}
          {isPrivate && (
            <p className="mt-1 text-[13px] text-x-sec" data-testid="import-private-note">
              Private personas never post or follow on Farcaster, so @{persona?.handle} takes your history only, not who you follow.
            </p>
          )}
          <div className="mt-2">
            {offered.map((l) => {
              const disabled = l.lane === "following" && isPrivate;
              return (
                <div key={l.lane} className="border-b border-x-border py-2.5">
                  <label className="flex items-center justify-between text-[15px]">
                    <span>
                      {LANE_LABEL[l.lane] ?? l.lane}
                      {l.lane === "likes" && <span className="block text-[13px] text-x-sec">Off unless you turn it on; up to {n(limits.maxLikes)}.</span>}
                      {l.sensitiveHeld ? (
                        <span className="block text-[13px] text-x-sec" data-testid="preview-sensitive-held">
                          {l.sensitiveHeld} sensitive item{l.sensitiveHeld === 1 ? "" : "s"} held behind
                          per-category opt-in, never imported automatically
                        </span>
                      ) : null}
                    </span>
                    <span className="flex items-center gap-3">
                      <span data-testid={`lane-count-${l.lane}`} className="font-bold">
                        {l.count}
                      </span>
                      <input
                        type="checkbox"
                        data-testid={`lane-toggle-${l.lane}`}
                        checked={selected.has(l.lane) && !disabled}
                        disabled={disabled || busy}
                        onChange={() => toggle(l.lane)}
                      />
                    </span>
                  </label>
                  {l.overCap && selected.has(l.lane) && (
                    <label className="mt-1 flex items-center gap-2 text-[13px]" data-testid={`import-over-cap-${l.lane}`}>
                      <input type="checkbox" data-testid={`import-newest-${l.lane}`} checked={!!newest[l.lane]} onChange={(e) => setNewest((m) => ({ ...m, [l.lane]: e.target.checked }))} />
                      Your archive has {n(l.overCap.total)}, more than the {n(l.overCap.cap)} this import takes. Import the newest {n(l.overCap.cap)}.
                    </label>
                  )}
                </div>
              );
            })}
          </div>
          {followingOn && (
            <div className="mt-3 rounded-xl border border-[#f4c542] bg-[#fff8e1] p-2.5" data-testid="import-warning">
              <p className="text-[14px] leading-5">
                Importing who you follow into <span className="font-bold">@{persona?.handle ?? "this persona"}</span> ties it to{" "}
                <span className="font-bold">@{handle ?? "your X account"}</span>: a follow list is a fingerprint. If @
                {persona?.handle ?? "this persona"} is not meant to be your X self, pick another persona or skip this lane.
              </p>
              <label className="mt-1.5 flex items-center gap-2 text-[14px] font-bold">
                <input type="checkbox" data-testid="import-ack-fingerprint" checked={ack} onChange={(e) => setAck(e.target.checked)} />
                I understand: bring my X follow list into @{persona?.handle ?? "this persona"}
              </label>
            </div>
          )}
          <button
            data-testid="import-commit"
            disabled={busy || !canImport}
            onClick={commit}
            className="mt-3 h-9 rounded-full bg-x-black-btn px-4 text-[14px] font-bold text-white disabled:opacity-50"
          >
            Import
          </button>
          <button
            data-testid="import-cancel"
            disabled={busy}
            onClick={() => {
              if (review.source === "fixture") post({ action: "discard", sessionId: review.session.id }).catch(() => undefined);
              setStep({ kind: "pick" });
              setResumed(false);
            }}
            className="ml-2 mt-3 h-9 rounded-full border border-[#cfd9de] px-4 text-[14px] font-bold"
          >
            Cancel
          </button>
        </div>
      )}

      {step.kind === "done" && (
        <div data-testid="import-done">
          <p className="text-[15px] font-bold">Imported.</p>
          {Object.entries(step.landed).map(([lane, count]) => (
            <p key={lane} className="text-[14px] text-x-sec" data-testid={`landed-${lane}`}>
              {LANE_LABEL[lane] ?? lane}: {n(count)} new
            </p>
          ))}
          {step.hiddenRetweets > 0 && (
            <p className="text-[13px] text-x-sec" data-testid="done-retweets-hidden">
              {n(step.hiddenRetweets)} retweets are on your shelf but hidden; you can show them there.
            </p>
          )}
          {step.heldSensitive > 0 && (
            <p className="mt-1 text-[13px] text-x-sec" data-testid="done-sensitive-held">
              {step.heldSensitive} sensitive items remain held below.
            </p>
          )}
          <p className="mt-2 text-[14px]">
            <a href="#x-people" className="font-bold text-x-blue" data-testid="done-find-people">
              Find your people on Farcaster
            </a>
            {step.handle && (
              <>
                {" · "}
                {/* a SOFT navigation: a full load would wipe a tab-only identity and this import with it (review UX-1) */}
                <Link href={"/" + step.handle} className="font-bold text-x-blue" data-testid="done-see-shelf">
                  See your history on @{step.handle}
                </Link>
              </>
            )}
          </p>
        </div>
      )}

      {queue.length > 0 && (
        <div className="mt-4 border-t border-x-border pt-3" data-testid="sensitive-queue">
          <p className="text-[15px] font-bold">Held: sensitive inferences from X</p>
          <p className="text-[13px] text-x-sec">
            X inferred these about you. Each imports only after you opt in to its category in
            Graph settings: off by default, one category at a time.
          </p>
          {queue.map((q) => (
            <p key={q.key} className="mt-1.5 text-[14px]" data-testid="sensitive-item" data-category={q.category}>
              {q.name} <span className="text-[13px] text-x-sec">({q.category})</span>
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
