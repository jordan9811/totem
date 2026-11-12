"use client";
// PUBLIC GO-LIVE — "Share": opens a Farcaster cast composer with the post's link (/anon/p/<castHash>) as its one embed,
// so the cast shows the post's page and the fc:miniapp button that opens /anon inside Farcaster.
//
//   * inside a Farcaster Mini App: the SDK's composeCast (lib/miniapp/sdk.ts), the host's own composer;
//   * on the web: the intent URL docs.farcaster.xyz documents, https://farcaster.xyz/~/compose?embeds[]=<link>
//     (lib/miniapp/manifest.ts farcasterComposeUrl), as a plain link in a new tab with no opener and no referrer (a link,
//     not window.open: no popup blocker, no script between the press and the tab).
//
// SAYING THE COST FIRST: a share is a cast from YOUR account. Sharing an anonymous post right after it went out tells
// people you probably wrote it, so the first press shows that sentence and "Share anyway"; nothing opens until then. The
// button is on every post in the feed, not only on yours, so a share is not by itself an author's act (the more people
// share posts they did not write, the less a share says). The composer gets no text from us: only the link.
import { useState } from "react";
import { anonSharePath, farcasterComposeUrl } from "@/lib/miniapp/manifest";
import { miniAppCompose } from "@/lib/miniapp/sdk";

export const SHARE_COST = "Sharing posts this from your own Farcaster account. If you share a post you just wrote, people may guess it was you.";

export function ShareToFarcaster({ castHash, origin, inMiniApp, compact = false }: { castHash: string; origin: string; inMiniApp: boolean; compact?: boolean }) {
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const link = origin + anonSharePath(castHash);
  const composeInHost = async () => {
    setNote(null);
    const opened = await miniAppCompose(link);
    if (!opened) setNote("The Farcaster composer didn't open. Try again.");
    else setAsking(false);
  };
  return (
    <span className="inline-flex flex-col gap-1" data-testid="anon-share-wrap">
      {asking ? (
        <span className="flex flex-wrap items-center gap-2 text-[13px] leading-4">
          <span data-testid="anon-share-cost" className="text-x-sec">
            {SHARE_COST}
          </span>
          {inMiniApp ? (
            <button type="button" data-testid="anon-share-confirm" onClick={() => void composeInHost()} className="font-bold text-x-blue hover:underline">
              Share anyway
            </button>
          ) : (
            <a
              data-testid="anon-share-confirm"
              href={farcasterComposeUrl(link)}
              target="_blank"
              rel="noopener noreferrer"
              referrerPolicy="no-referrer"
              onClick={() => setAsking(false)}
              className="font-bold text-x-blue hover:underline"
            >
              Share anyway
            </a>
          )}
          <button type="button" data-testid="anon-share-cancel" onClick={() => setAsking(false)} className="text-x-sec hover:underline">
            Not now
          </button>
        </span>
      ) : (
        <button
          type="button"
          data-testid="anon-share"
          data-link={link}
          onClick={() => setAsking(true)}
          className={compact ? "text-[13px] text-x-sec hover:text-x-blue hover:underline" : "h-8 rounded-full border border-x-border-dark px-3 text-[14px] font-bold hover:bg-x-hover"}
        >
          Share
        </button>
      )}
      {note ? (
        <span role="alert" className="text-[13px] text-[#f4212e]">
          {note}
        </span>
      ) : null}
    </span>
  );
}
