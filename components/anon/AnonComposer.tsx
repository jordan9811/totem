"use client";
// PUBLIC GO-LIVE — THE /anon COMPOSER: a post made as the ROOT, with no persona (relay's contract: POST /api/anon
// {text, postAs: "root"}; the sealed reveal record keeps personaId null and the reveal secret). The browser device in this
// tab answers the route: the post waits in the tab's wanted set, the next check proves membership in the Web Worker, and
// the web channel sends it with no identity on it; the validator relays it from @anon under the same caps, text filter
// and terms as every Totem persona post. Nothing here talks to a server with a key.
//
// THE WORDS ARE RELAY'S: before the click, GET /api/anon's destinationSentence (where a post goes) and its availability
// sentence (why posting is off now, and from when it is on); after the click, the 202's postedSentence and then the post's
// own status line (AnonPostStatus's describeAnonStatus, the same words the Totem composer shows) with castUrl once
// relayed. Where an older device answers without those fields, the page says only what the answer does say.
//
// Pre-click text checks (lib/zk/anon/textCheck.ts; the device and the validator refuse the same words again): the
// automatic filter (anonFilterRefusal: slurs, phone numbers, email and street addresses, known scam links), and a mention
// of this visitor's own names (the Farcaster account they signed in with) — from @anon that would be a public edge to
// them forever. After the first post, ONE line offers to keep the identity (a passkey, or this
// browser) while it lives only in this tab.
import { useCallback, useEffect, useRef, useState } from "react";
import { describeAnonStatus } from "@/components/AnonPostStatus";
import { announceMoment, KEEP_TOAST, saveWithPasskey, tabOnly } from "@/components/device/SaveMoment";
import { anonFilterRefusal, checkAnonText } from "@/lib/zk/anon/textCheck";
import { ZK_ANON_POST_MAX_CHARS } from "@/lib/zk/config";
import { isFarcasterWebUrl } from "@/lib/miniapp/manifest";
import { ShareToFarcaster } from "./ShareToFarcaster";

/** GET /api/anon as this page reads it (relay's contract; every field optional on purpose: unknown is never "yes") */
export interface AnonView {
  mode?: string;
  available?: boolean | null;
  unavailableReason?: string | null;
  unavailableCode?: string | null;
  anonDeploymentOff?: boolean;
  availableFrom?: number | null;
  previewOnly?: boolean;
  previewSentence?: string | null;
  destination?: "farcaster" | "layers" | "off";
  destinationSentence?: string | null;
  postedSentence?: string | null;
  config?: { maxChars?: number } | null;
  reach?: { plainTree?: string } | null;
  error?: string;
}

type PostStatus = Parameters<typeof describeAnonStatus>[0] & { castUrl?: unknown; postedSentence?: unknown };

/** may this page offer the Post button? Only an answer that SAYS yes (exported for scripts/unit-miniapp.mjs) */
export function postOffered(v: AnonView | null): boolean {
  return !!v && v.available === true && v.destination !== "off";
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function AnonComposer({
  view,
  loading,
  onReload,
  ownNames,
  origin,
  inMiniApp,
  onPosted,
}: {
  view: AnonView | null;
  loading: boolean;
  onReload: () => Promise<void>;
  ownNames: string[];
  origin: string;
  inMiniApp: boolean;
  onPosted: (castHash: string) => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [posted, setPosted] = useState<{ castHash: string; sentence: string; previewOnly: boolean; warnings: string[] } | null>(null);
  const [status, setStatus] = useState<PostStatus | null>(null);
  const [saveNote, setSaveNote] = useState<string | null>(null);
  const [saveBusy, setSaveBusy] = useState(false);
  const [showSave, setShowSave] = useState(false);
  const checking = useRef(false);
  /** the one post whose status is being followed (a newer post, or leaving the page, ends the older loop) */
  const following = useRef<string | null>(null);
  useEffect(
    () => () => {
      following.current = null;
    },
    []
  );

  const max = typeof view?.config?.maxChars === "number" && view.config.maxChars > 0 ? view.config.maxChars : ZK_ANON_POST_MAX_CHARS;
  const filtered = text.trim() ? anonFilterRefusal(text) : null;
  const check = text.trim() ? checkAnonText(text, ownNames) : { ok: true, warnings: [] as string[] };
  const offered = postOffered(view);
  const canPost = offered && !busy && text.trim().length > 0 && text.length <= max && check.ok && !filtered;

  // "checking": no check has said yet whether this browser may post — the memory-only poll, then the full read once it
  // says something else (the device runs the first check itself; this only waits for it)
  useEffect(() => {
    if (view?.unavailableCode !== "checking" || checking.current) return;
    checking.current = true;
    let alive = true;
    void (async () => {
      for (let i = 0; i < 30 && alive; i++) {
        await sleep(3000);
        const r = await fetch("/api/anon?availability=1", { cache: "no-store" }).catch(() => null);
        const j = r && r.ok ? ((await r.json().catch(() => null)) as { unavailableCode?: unknown } | null) : null;
        if (j && j.unavailableCode !== "checking") break;
      }
      checking.current = false;
      if (alive) await onReload();
    })();
    return () => {
      alive = false;
    };
  }, [view?.unavailableCode, onReload]);

  // the posted cast's own status: often at first, then every 20 s, until it is out (or refused)
  const pollStatus = useCallback(async (castHash: string) => {
    following.current = castHash;
    for (let i = 0; i < 200; i++) {
      await sleep(i < 12 ? 5000 : 20_000);
      if (following.current !== castHash) return;
      try {
        const r = await fetch("/api/anon?castHash=" + encodeURIComponent(castHash), { cache: "no-store" });
        const j = (await r.json().catch(() => null)) as PostStatus | null;
        if (j && j.timing) {
          setStatus(j);
          const done = isFarcasterWebUrl(j.castUrl) || describeAnonStatus(j, Date.now()).tone === "bad" || (j.previewOnly === true && j.item?.outcome === "accepted");
          if (done) return;
        }
      } catch {
        /* the next round reads it again */
      }
    }
  }, []);

  const post = async () => {
    if (!canPost) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/anon", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, postAs: "root" }) });
      const j = (await r.json().catch(() => null)) as { castHash?: unknown; error?: unknown; postedSentence?: unknown; previewOnly?: unknown; previewSentence?: unknown; warnings?: unknown } | null;
      if (r.status !== 202 || !j || typeof j.castHash !== "string") {
        setError(typeof j?.error === "string" && j.error ? j.error : "That didn't post (the page answered " + r.status + "). Your words are still here.");
        if (r.status === 409 || r.status === 503) void onReload();
        return;
      }
      const sentence =
        typeof j.postedSentence === "string" && j.postedSentence
          ? j.postedSentence
          : j.previewOnly === true && typeof j.previewSentence === "string"
            ? j.previewSentence
            : "Queued. It is proved in this browser and goes out from @anon at the next posting slot.";
      setPosted({ castHash: j.castHash, sentence, previewOnly: j.previewOnly === true, warnings: Array.isArray(j.warnings) ? (j.warnings as unknown[]).filter((w): w is string => typeof w === "string") : [] });
      setStatus(null);
      setText("");
      setShowSave(tabOnly());
      announceMoment("post");
      onPosted(j.castHash);
      void pollStatus(j.castHash);
    } catch {
      setError("That request couldn't be made. Your words are still here; try again.");
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    setSaveBusy(true);
    setSaveNote(null);
    try {
      const sentence = await saveWithPasskey();
      setSaveNote(sentence);
      setShowSave(false);
    } catch (e) {
      setSaveNote("Not saved: " + (e as Error).message);
    } finally {
      setSaveBusy(false);
    }
  };
  const keep = async () => {
    setSaveBusy(true);
    setSaveNote(null);
    try {
      const d = (window as unknown as { __layersDevice?: { persist?: () => Promise<void> } }).__layersDevice;
      if (!d?.persist) throw new Error("this page is still starting; try again in a moment.");
      await d.persist();
      setSaveNote(KEEP_TOAST);
      setShowSave(false);
    } catch (e) {
      setSaveNote("Not kept: " + (e as Error).message);
    } finally {
      setSaveBusy(false);
    }
  };

  const statusLine = status ? describeAnonStatus(status, Date.now()) : null;
  const castUrl = status && isFarcasterWebUrl(status.castUrl) ? (status.castUrl as string) : null;
  const shareable = !!posted && (!!castUrl || (posted.previewOnly && status?.item?.outcome === "accepted"));

  return (
    <section data-testid="anon-composer" data-offered={offered ? "yes" : "no"} className="rounded-2xl border border-x-border-dark p-4">
      <label htmlFor="anon-input" className="text-[15px] font-bold">
        Write a post
      </label>
      {view?.destinationSentence && view.destination !== "off" ? (
        <p data-testid="anon-destination" data-destination={view.destination ?? ""} className="mt-1 text-[13px] leading-4 text-x-sec">
          {view.destinationSentence}
        </p>
      ) : null}
      {view?.previewOnly && view.previewSentence ? (
        <p data-testid="anon-preview-sentence" className="mt-1 text-[13px] leading-4 text-x-sec">
          {view.previewSentence}
        </p>
      ) : null}
      <textarea
        id="anon-input"
        data-testid="anon-input"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        maxLength={max + 50}
        placeholder="What do you want to say, with no name on it?"
        className="mt-2 w-full resize-y rounded-xl border border-x-border-dark p-3 text-[17px] leading-6 outline-none focus:border-x-blue"
      />
      <div className="mt-1 flex items-center justify-between text-[13px] text-x-sec">
        <span data-testid="anon-count" className={text.length > max ? "text-[#f4212e]" : ""}>
          {text.length}/{max}
        </span>
        <button
          type="button"
          data-testid="anon-post"
          disabled={!canPost}
          onClick={() => void post()}
          className="h-9 rounded-full bg-x-blue px-5 text-[15px] font-bold text-white disabled:opacity-50"
        >
          {busy ? "Posting…" : "Post"}
        </button>
      </div>
      {filtered ? (
        <p data-testid="anon-text-filtered" data-rule={filtered.rule} role="alert" className="mt-2 text-[13px] leading-4 text-[#f4212e]">
          {filtered.sentence}
        </p>
      ) : null}
      {!check.ok && check.reason ? (
        <p data-testid="anon-text-refused" role="alert" className="mt-2 text-[13px] leading-4 text-[#f4212e]">
          Not posted: {check.reason}.
        </p>
      ) : null}
      {check.ok && check.warnings.length ? (
        <ul data-testid="anon-text-warnings" className="mt-2 list-disc pl-5 text-[13px] leading-4 text-x-sec">
          {check.warnings.map((w) => (
            <li key={w}>Note: {w}.</li>
          ))}
        </ul>
      ) : null}
      {loading && !view ? <p className="mt-2 text-[13px] text-x-sec">Checking whether you can post from here…</p> : null}
      {view && !offered ? (
        <p data-testid="anon-unavailable" data-code={view.unavailableCode ?? ""} className="mt-2 text-[13px] leading-4 text-x-sec">
          {view.unavailableReason || view.error || "Posting isn't open from here right now."}
        </p>
      ) : null}
      {error ? (
        <p data-testid="anon-error" role="alert" className="mt-2 text-[13px] leading-4 text-[#f4212e]">
          {error}
        </p>
      ) : null}
      {posted ? (
        <div data-testid="anon-posted" data-cast-hash={posted.castHash} className="mt-3 rounded-xl border border-x-border p-3 text-[13px] leading-4">
          <p data-testid="anon-posted-sentence" className="font-bold">
            {posted.sentence}
          </p>
          {posted.warnings.map((w) => (
            <p key={w} className="mt-1 text-x-sec">
              Note: {w}.
            </p>
          ))}
          <p data-testid="anon-status" data-tone={statusLine?.tone ?? "wait"} className={"mt-1 " + (statusLine?.tone === "bad" ? "text-[#f4212e]" : statusLine?.tone === "ok" ? "text-x-green" : "text-x-sec")}>
            {statusLine ? statusLine.text : "Checking where your post is…"}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            {castUrl ? (
              <a data-testid="anon-cast-link" href={castUrl} target="_blank" rel="noopener noreferrer" referrerPolicy="no-referrer" className="font-bold text-x-blue hover:underline">
                See it on Farcaster
              </a>
            ) : null}
            {shareable ? <ShareToFarcaster castHash={posted.castHash} origin={origin} inMiniApp={inMiniApp} /> : null}
          </div>
          {showSave ? (
            <p data-testid="anon-save" className="mt-2 text-x-sec">
              This identity lives only in this tab.{" "}
              <button type="button" data-testid="anon-save-passkey" disabled={saveBusy} onClick={() => void save()} className="font-bold text-x-blue hover:underline">
                Save with a passkey
              </button>{" "}
              or{" "}
              <button type="button" data-testid="anon-keep" disabled={saveBusy} onClick={() => void keep()} className="font-bold text-x-blue hover:underline">
                keep it in this browser
              </button>
              .
            </p>
          ) : null}
          {saveNote ? (
            <p data-testid="anon-save-note" className="mt-1 text-x-sec">
              {saveNote}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
