"use client";
// PUBLIC GO-LIVE — WHAT @anon IS, AND WHO SEES WHAT, in plain words at the top of /anon (the native anon page for
// Farcaster users; app/anon/AnonApp.tsx). Every sentence here is a claim the code keeps:
//   * one shared Farcaster account posts every anonymous post (the validator's relay account);
//   * a post carries no name or account: it is proved in this browser (a Web Worker) and sent with no identity on it, so
//     the PROOF says only that SOMEONE in the crowd sent it (SECURITY-POSTURE §27, §31);
//   * PUBLIC GO-LIVE (PRIV-LIVE-4): and NOT "nobody learns which posts are yours, Totem included". The sign-in (the join:
//     the validator records which Farcaster account holds which crowd member), the posts and the reports all reach the
//     validator straight from the visitor's internet address (ZK_RELAY is direct: no outside relay yet), so the people who
//     run Totem could match them by that address. ADDRESS_SENTENCE says so, with the one thing a visitor can do about it;
//   * the other residuals: Neynar (which carries the post to Farcaster) and the Totem operator see the words and the
//     hour; Farcaster's main app, under its new owner, may hide or label @anon; and your own writing style is yours to watch;
//   * the crowd: how many people have joined (a post is offered only once at least `floor` have — the tab's own floor,
//     lib/zk/config.ts ZK_ANON_FLOOR) and, for a browser that just joined, from what time it can post (new members are let
//     in at the next 6-hour window).
// The crowd figures come from the page (the device's last check and GET /api/anon's availableFrom); unknown is said as
// unknown, never as a number.
import { useState } from "react";

export interface CrowdFacts {
  /** people in the crowd at the last check, or null when no check could read it */
  members: number | null;
  /** the crowd this tab needs before it offers a post */
  floor: number;
  /** when this browser can post (a fresh member is let in at the next window); null when it can already, or unknown */
  availableFrom: number | null;
  /** the check could not be read at all */
  unreadable: boolean;
  /** no check has run in this tab yet (the device runs its first one right after boot) */
  checking?: boolean;
  /** PUBLIC GO-LIVE (verify): posting is OFF for this site (the composer's answer says destination "off": a live site whose
   *  public @anon is not switched on yet, or the kill switch). The sentence to show instead of a crowd count: the test
   *  universe's members would otherwise read as "posts are open" on a site where nothing can be posted. */
  off?: string | null;
}

/** PUBLIC GO-LIVE (verify): the crowd facts when the composer's answer says posting is off for this site */
export const CROWD_OFF_FALLBACK = "Anonymous posting isn't switched on for this site yet.";
export function offCrowd(reason: string | null | undefined, floor: number): CrowdFacts {
  return { members: null, floor, availableFrom: null, unreadable: false, off: typeof reason === "string" && reason.trim() ? reason : CROWD_OFF_FALLBACK };
}
/** does the composer's answer say posting is off for this whole site (never offered from here, whatever the crowd)? */
export function postingOffForSite(view: { destination?: string | null; anonDeploymentOff?: boolean | null } | null | undefined): boolean {
  return !!view && (view.destination === "off" || view.anonDeploymentOff === true);
}

/** PUBLIC GO-LIVE (PRIV-LIVE-4): the internet-address residual, in the words /anon uses everywhere it comes up (the suites
 *  look for these words) */
export const ADDRESS_SENTENCE =
  "Your sign-in, your posts and your reports all reach Totem from your internet address, so the people who run Totem could match them by that address. Posting from a different network than the one you signed in on avoids that (Totem has no outside relay to hide the address yet).";
/** what the explainer says a post is, with no claim about who learns what (the list below says that) */
export const POST_CARRIES_NO_NAME = "Your post is checked in this browser and sent with no name or account on it: it proves only that someone in the crowd wrote it.";
/** the sign-in, honestly. LIVE (the site's anonymous posts go to Farcaster): the sign-in joins the crowd at the validator,
 *  which records which Farcaster account holds which member (lib/zk/anon/fcJoin.ts). Otherwise (the preview's test crowd,
 *  joined by this browser's identity, or a site whose anonymous posts are not live) the sign-in stays in this browser, so
 *  the sentence names no record. Unknown (before the device boots) says the live one: toward more disclosure, never less. */
export const SIGN_IN_JOINS_LIVE = "Signing in with Farcaster lets you into the crowd: Totem records which Farcaster account joined. Your account never goes on your posts.";
export const SIGN_IN_JOINS_PREVIEW = "Signing in with Farcaster lets you into the crowd. Your account never goes on your posts.";

const clock = (ms: number) => new Date(ms).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" });

/** the crowd line, exported for scripts/unit-miniapp.mjs (the words are the contract) */
export function crowdSentence(c: CrowdFacts | null): string {
  if (c && c.off) return c.off;
  if (!c || (c.checking && !c.unreadable)) return "Checking how many people have joined…";
  if (c.unreadable || c.members === null) return "How many people have joined couldn't be read just now.";
  const n = c.members;
  const base = n >= c.floor ? `${n} people have joined, so posts are open.` : `${n} of ${c.floor} people have joined. Posting opens at ${c.floor}.`;
  return c.availableFrom !== null ? `${base} This browser can post from ${clock(c.availableFrom)} (new members are let in every 6 hours).` : base;
}

export function AnonExplainer({ crowd, previewOnly, liveJoin = null }: { crowd: CrowdFacts | null; previewOnly: boolean; liveJoin?: boolean | null }) {
  const [open, setOpen] = useState(false);
  return (
    <section data-testid="anon-explainer" className="rounded-2xl border border-x-border-dark p-4">
      <h1 className="text-[23px] font-extrabold leading-7">Post on Farcaster with no name on it</h1>
      <p className="mt-2 text-[15px] leading-5">
        <span className="font-bold">@anon</span> is one shared Farcaster account. Everything posted here goes out from it. {POST_CARRIES_NO_NAME}
      </p>
      {previewOnly ? (
        <p data-testid="anon-preview-note" className="mt-2 rounded-xl bg-x-pill p-2 text-[13px] leading-4 text-x-sec">
          This site is a test preview right now: posts stay inside it and are not posted to Farcaster.
        </p>
      ) : null}
      <p data-testid="anon-crowd" className="mt-2 text-[13px] leading-4 text-x-sec">
        {crowdSentence(crowd)}
      </p>
      <button type="button" data-testid="anon-who-sees" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="mt-2 text-[13px] font-bold text-x-blue hover:underline">
        {open ? "Hide who sees what" : "Who sees what"}
      </button>
      {open ? (
        <ul data-testid="anon-who-sees-list" className="mt-2 list-disc space-y-1 pl-5 text-[13px] leading-4 text-x-sec">
          <li>Everyone on Farcaster sees the post, from @anon, with no name on it.</li>
          <li data-testid="anon-signin-residual">{liveJoin === false ? SIGN_IN_JOINS_PREVIEW : SIGN_IN_JOINS_LIVE}</li>
          <li>Neynar (the service that carries posts to Farcaster) and the people who run Totem see the words and the hour they were posted.</li>
          <li data-testid="anon-address-residual">{ADDRESS_SENTENCE}</li>
          <li>Farcaster&rsquo;s main app has a new owner and new rules, and it may hide or label @anon. The posts still exist on Farcaster and show here.</li>
          <li>How you write is yours to watch: a style people know can give you away.</li>
        </ul>
      ) : null}
    </section>
  );
}
