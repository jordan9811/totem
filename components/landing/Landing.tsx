// PUBLIC PREVIEW Gate 1 (run as BROWSER KEYSTORE PASS Gate 6) — the front door. A server component with no data
// access: no validator call, no vault read, no persona context, no device. It renders for a visitor with nothing.
//
// Content rules from the prompt: what this is, in one paragraph lifted from the docs' mission page (cited); the
// problem it solves; and HONEST STATUS — this is a preview, the privacy layer's conditions are not all met, nothing
// here is a guarantee — in the posture document's own narrow phrasing, never a new claim. Two doors of equal weight.
// Visual language: the app's own (X parity tokens).
// DOCS UNDER APP (D-DOCS-UNDER-APP): the docs door is ALWAYS there now — the app serves the docs itself at /docs
// (app/docs/[[...slug]]/route.ts), built by `npm run build`, so no deployment is without them. Its href is docsUrl():
// "/docs", unless NEXT_PUBLIC_DOCS_URL names another address (a future custom docs domain). A plain <a> in a new tab:
// the docs are a separate static site, never a soft navigation, and they boot no device.
//
// HELP: the status sentences now live in components/help/privacy-copy.tsx, shared with the Help page, so the landing
// and /help can never word a privacy statement two ways; the rendered text is unchanged. Under the doors, an always-on
// "How Totem works" link goes to /help. It is NOT the docs door and must never say "Read the docs" (accept-help check
// 5 asserts that landing-help never does). A next/link: /help is a static page outside the app group, so following it
// starts no device and mints no identity.
//
// PERSONA LAUNCH P1 (review UX-7): the Sign in with Farcaster sentence is rendered ONLY where the device offers it
// (siwfOfferedHere(): FC_SIWF "on"). It used to be unconditional, so the kill switch, the owner service, an empty world
// and a refused relay URL each had a landing promising what /device then called unavailable. app/page.tsx is
// force-dynamic, so this is the deployment's own configuration at request time, never the build machine's.
//
// PUBLIC GO-LIVE (public live mode, lib/platform/publicLive.ts): the landing is the PRODUCT's front door, in the owner's
// words (2026-11-05; components/onboarding/copy.ts, shared with /welcome's own welcome screen): "One you. Many personas.",
// one line, and the doors — "Sign in with Farcaster" (door-start → /welcome#next, the guided first run's step 1: a full
// document load, like "Enter the app" was, so the device boots from a clean document), "Continue with X" shown DISABLED
// and marked Soon (door-x) until the deployment carries an X app (SIGN IN WITH X, 2026-11-06: then door-x-on, a real door
// to the same step 1, where the X card says who sees what before anything is sent), "I've used Totem before"
// (door-unlock → /welcome#unlock), "No Farcaster account yet? Get one free" (door-get-farcaster → farcaster.xyz) and a
// quiet "Just looking?" link to the anonymous feed (door-app → /anon: a guest's /home has nothing to show in live mode).
// The long context-collapse paragraph is the docs' (docs/mission), not the landing's any more. The docs door and "How
// Totem works" stay. No "preview" pill and no "for testing" footer. The status box keeps the posture's own sentences (the label sentence is unchanged and still
// computed in the app), with LIVE_WRITES in place of WRITES_OFF (true whether or not the anonymous relay is armed).
// With the flag off every element below is exactly what it was (accept-cu6 1-3, accept-help 4/5/6b, accept-siwf-prod
// P16, unit-siwf U14 read it).
import Link from "next/link";
import { docsUrl, postureUrl } from "@/lib/platform/preview";
import { siwfOfferedHere } from "@/lib/fc/siwf/flow";
import { xSigninOfferedHere } from "@/lib/x/signin/config";
import { XLogo } from "@/components/icons";
import { isPublicLive } from "@/lib/platform/publicLive";
import { IDENTITY_IN_TAB, LIVE_WRITES, LabelSentence, SERVER_HOLDS, TWO_PEOPLE, WRITES_OFF, relayReadsSentence } from "@/components/help/privacy-copy";
import { CONTINUE_WITH_X, FRONT_HEADLINE, FRONT_LINE, GET_FARCASTER_ASK, GET_FARCASTER_LINK, GET_FARCASTER_URL, SIGN_IN_FARCASTER, USED_BEFORE } from "@/components/onboarding/copy";

const MISSION = // docs/mission/index.md, first paragraph, verbatim
  "People are not one audience. The person who posts about a chronic illness, the person who argues about monetary policy, the person who shows their garden to their neighbours and the person who is looking for a job are one person — and on every mainstream network they share one account, one follower list, one algorithm and one name. That is context collapse: every post is read by the union of every audience, so people post for the strictest one and say nothing to the rest.";

export function Landing() {
  const docs = docsUrl();
  const live = isPublicLive();
  return (
    <main className="mx-auto flex min-h-full w-full max-w-[600px] flex-col px-4 py-10 text-x-text" data-mode={live ? "live" : undefined}>
      <header className="flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icon.svg" alt="" width={36} height={36} className="rounded-full" />
        <span className="text-[20px] font-bold">Totem</span>
        {live ? null : (
          <span className="ml-auto rounded-full border border-x-border-dark px-3 py-0.5 text-[12px] font-bold text-x-sec" data-testid="landing-preview-pill">
            preview
          </span>
        )}
      </header>

      <section className="mt-8">
        {live ? (
          <>
            <h1 className="text-[31px] font-extrabold leading-9 tracking-tight">{FRONT_HEADLINE}</h1>
            <p className="mt-4 text-[17px] leading-6 text-x-sec" data-testid="landing-pitch">
              {FRONT_LINE}
            </p>
          </>
        ) : (
          <>
            <h1 className="text-[31px] font-extrabold leading-9 tracking-tight">One root. Many personas. Your keys stay in your browser.</h1>
            <p className="mt-4 text-[17px] leading-6 text-x-sec" data-testid="landing-mission" data-cite="docs/mission/index.md">
              {MISSION}
            </p>
            <p className="mt-3 text-[15px] leading-5">
              Totem is a client built on the premise that the fix is structural, not a settings page: one root identity held on your own device, any number of personas derived from it, disclosure that is the owner&apos;s and granular, and a server that
              is untrusted by construction — it stores ciphertext and public state, never a key.
            </p>
          </>
        )}
      </section>

      {live ? (
        <section className="mt-8 grid grid-cols-1 gap-3" data-testid="landing-doors">
          {/* PUBLIC GO-LIVE: full document loads into the app, as "Enter the app" was: the device boots from a clean document */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/welcome#next" className="flex items-center justify-center rounded-full bg-x-black-btn px-6 py-3 text-[17px] font-bold text-white hover:bg-x-black-btn-hover" data-testid="door-start">
            {SIGN_IN_FARCASTER}
          </a>
          {/* SIGN IN WITH X: a real door to step 1 once this deployment carries an X app (X_CLIENT_ID; xSigninOfferedHere) —
              until then shown, never offered as working */}
          {xSigninOfferedHere(process.env) ? (
            // eslint-disable-next-line @next/next/no-html-link-for-pages
            <a href="/welcome#next" className="flex items-center justify-center gap-2 rounded-full border border-x-border-dark bg-white px-6 py-3 text-[17px] font-bold text-x-text hover:bg-x-hover" data-testid="door-x-on">
              <XLogo size={18} />
              {CONTINUE_WITH_X}
            </a>
          ) : (
          <button type="button" disabled className="flex items-center justify-center gap-2 rounded-full border border-x-border-dark bg-white px-6 py-3 text-[17px] font-bold text-x-text opacity-60" data-testid="door-x">
            {CONTINUE_WITH_X}
            <span className="rounded-full bg-x-pill px-2 py-0.5 text-[12px] font-bold text-x-sec">Soon</span>
          </button>
          )}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/welcome#unlock" className="flex items-center justify-center rounded-full border border-x-border-dark bg-white px-6 py-3 text-[17px] font-bold text-x-text hover:bg-x-hover" data-testid="door-unlock">
            {USED_BEFORE}
          </a>
          <p className="text-center text-[15px]">
            <span className="text-x-sec">{GET_FARCASTER_ASK} </span>
            <a href={GET_FARCASTER_URL} target="_blank" rel="noopener noreferrer" className="font-bold text-x-blue hover:underline" data-testid="door-get-farcaster">
              {GET_FARCASTER_LINK}
            </a>
          </p>
          <p className="text-center text-[15px]">
            <span className="text-x-sec">Just looking? </span>
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/anon" className="font-bold text-x-blue hover:underline" data-testid="door-app">
              Read the anonymous feed
            </a>
          </p>
          <a href={docs} target="_blank" rel="noreferrer" className="text-center text-[15px] font-bold text-x-blue hover:underline" data-testid="door-docs">
            Read the docs
          </a>
        </section>
      ) : (
        <section className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2" data-testid="landing-doors">
          {/* PROD-LIVE (D-CU-0-4): the ONE intentional full document load into the app. The device boots from a clean
              document every time (boot.js before hydration, then the bundle), instead of being grafted onto a page that
              soft-navigated in. Everywhere else inside the app, navigation is soft, because a full load would wipe an
              unsaved identity — here there is none yet. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/home" className="flex items-center justify-center rounded-full bg-x-black-btn px-6 py-3 text-[17px] font-bold text-white hover:bg-x-black-btn-hover" data-testid="door-app">
            Enter the app
          </a>
          <a href={docs} target="_blank" rel="noreferrer" className="flex items-center justify-center rounded-full border border-x-border-dark bg-white px-6 py-3 text-[17px] font-bold text-x-text hover:bg-x-hover" data-testid="door-docs">
            Read the docs
          </a>
        </section>
      )}
      {/* PERSONA LAUNCH P1 (SIWF): one sentence under the doors — no new door. It never says "Read the docs" (that is the
          docs door's own label; accept-cu6 check 1 and accept-help check 5 assert no other element says it). */}
      {siwfOfferedHere() ? (
        <p className="mt-4 text-center text-[15px] text-x-sec" data-testid="landing-siwf">
          {live
            ? "Signing in only reads your public Farcaster profile; Totem keeps your account with a passkey, not a password."
            : "Have a Farcaster account? You can sign in with it inside the app; your identity is still saved with a passkey."}
        </p>
      ) : null}
      <p className="mt-2 text-center text-[15px]">
        <Link href="/help" className="font-bold text-x-blue hover:underline" data-testid="landing-help">
          How Totem works
        </Link>
        <span className="text-x-sec">: what works today, and plain answers to the obvious questions.</span>
      </p>

      <section id="status" className="mt-10 rounded-2xl border border-x-border p-4" data-testid="landing-status">
        <h2 className="text-[17px] font-bold">{live ? "Status, honestly labelled" : "Status: a preview, honestly labelled"}</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-[15px] leading-5 text-x-sec">
          <li>
            <LabelSentence />
          </li>
          {/* FC-READ (SECURITY-POSTURE.md §19, A-FCREAD-OPERATOR-SEES-READS): this page reads no state, so it cannot know
              whether the relay is armed — the sentence is conditional on purpose and true either way. It names what
              the server then sees, in the posture document's own narrow terms; the banner inside the app says when
              the device is actually in relay mode.
              FC-READ (no channels): "channels" left this sentence with the relay's channel op — channels are not a v1
              emphasis, so no channel is read through the server; what it sees is posts (discovery, threads) and profiles. */}
          {/* PUBLIC GO-LIVE (F11): "this site", not "this preview", in live mode (privacy-copy.tsx relayReadsSentence) */}
          <li>{[IDENTITY_IN_TAB, SERVER_HOLDS, relayReadsSentence(live)].join(" ")}</li>
          <li>{live ? LIVE_WRITES : WRITES_OFF}</li>
          <li>{TWO_PEOPLE}</li>
        </ul>
      </section>

      <footer className="mt-10 text-[13px] text-x-sec">
        <p>
          {live
            ? "Questions and reports help: where the label, the banner or the docs disagree with what you experienced."
            : "This is a preview for testing, not a launch. Feedback that helps: where the label, the banner or the docs disagree with what you experienced."}
          {" "}
          The security posture, section by section, is in{" "}
          <a href={postureUrl(docs)} target="_blank" rel="noreferrer" className="underline" data-testid="landing-posture">
            the docs
          </a>
          .
        </p>
      </footer>
    </main>
  );
}
