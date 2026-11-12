// HELP: HOW LAYERS WORKS. The in-app explainer, in the spirit of Salvo's /how-it-works: what Totem is in one
// sentence, a picture, the honest status list, the questions a first-time reader asks (verdict first), privacy in
// plain words, a short glossary, and where to change things.
//
// A server component with no data access: it reads no validator, no vault, no persona and no device, and it is
// rendered outside the app group (app/help/page.tsx), so on the public site visiting it neither starts the browser
// device nor mints an identity, and no save nag appears. Everything it says about status comes from
// lib/status/features.ts; every privacy sentence comes from ./privacy-copy (verbatim, with data-cite).
//
// Navigation: every in-app link is next/link. Inside a tab whose identity is unsaved, a full document load would wipe
// it; a soft navigation keeps it. The full docs open in a NEW tab; DOCS UNDER APP: they are always there now, at
// /docs on this same app (or the address NEXT_PUBLIC_DOCS_URL overrides it with).
import Link from "next/link";
import type { ReactNode } from "react";
import { STATUS_CHECKED_ON, featureById, surfaceOf, type Feature, type SurfaceId } from "@/lib/status/features";
import { StatusList } from "./StatusList";
import { AtAGlance, ThreePanels } from "./HelpPicture";
import { EcosystemMapCompact } from "./EcosystemMapCompact";
// PERSONA LAUNCH P5: the For You label's own words, from the pure module that renders it (no imports, no state), so Help
// can never quote a label the app no longer shows
import { reachLabel } from "@/lib/reach/trees";
import { HelpGlyph } from "./HelpGlyph";
import { isPublicLive } from "@/lib/platform/publicLive";
import {
  ANON_SLOT_RESIDUAL,
  CITE,
  RING_NO_SIGNATURE,
  IDENTITY_IN_TAB,
  LABEL_CONDITIONS,
  LabelSentence,
  PLAIN_CONDITIONS,
  NEYNAR_SEES_ALL,
  OWNER_HOST_HOLDS_SEED,
  OWNER_LABEL_NOT_MET,
  OWNER_PASSPHRASE,
  PROOF_CLAIM,
  relayReadsSentence,
  SELF_GRAPH,
  SERVER_HOLDS,
  SIWF_NO_FORK,
  SIWF_NOT_A_SAVE,
  SIWF_READ_ONLY,
  SIWF_RELAY_SEES,
  SIWF_RPC_DEFAULT_HOST,
  SIWF_SERVER_SEES,
  SIWF_SERVER_SEES_LIVE_HELP,
  SIWF_SHOW_POSTS,
  ROOT_POST_BEFORE,
  ROOT_POST_MAIN_APP,
  TWO_PEOPLE,
  WRITES_OFF,
  LIVE_WRITES,
  X_ARCHIVE_STAYS,
  siwfRpcSees,
} from "./privacy-copy";

const H2 = "mt-12 scroll-mt-16 text-[23px] font-extrabold leading-7";
const H3 = "mt-6 text-[17px] font-bold leading-6";
const P = "mt-2 text-[15px] leading-6 text-x-text";
const MUTED = "mt-2 text-[15px] leading-6 text-x-sec";
const LINK = "font-bold text-x-blue hover:underline";

function Question({ id, q, verdict, children }: { id: string; q: string; verdict: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-16" data-testid="help-question">
      <h3 className={H3}>{q}</h3>
      <p className={P}>
        <strong>{verdict}</strong>
      </p>
      {children}
    </section>
  );
}

/** a privacy sentence, carrying the section it is quoted from */
function Cited({ cite, children, className = P }: { cite: string; children: ReactNode; className?: string }) {
  return (
    <p className={className} data-cite={cite}>
      {children}
    </p>
  );
}

/** a feature the page quotes by id; a missing id is a build-time mistake, so it throws rather than render a gap */
function status(id: string): Feature {
  const f = featureById(id);
  if (!f) throw new Error("components/help/HelpPage.tsx quotes unknown status id " + id);
  return f;
}

const GLOSSARY: { term: string; def: string; cite?: string }[] = [
  { term: "Root", def: "Your one private identity. Every persona is made from it. On the public site it lives in your browser." },
  { term: "Persona", def: "One face of you: your main, a finsta, an alt. Other people see personas." },
  { term: "Passkey", def: "A login your phone or computer keeps for you, unlocked with Face ID, a fingerprint or a PIN. On the public site it is the first way to save your identity; on the owner's private service, one signs the owner in." },
  { term: "The 24 words", def: "Your identity written out as 24 words: the advanced backup, under Advanced. Whoever has them has your identity, so keep them offline." },
  { term: "Sign in with Farcaster", def: "Scanning a QR code with the Farcaster app to show which Farcaster account is yours. It links that account to your identity read-only; it does not save the identity." },
  { term: "Public self", def: "Your own Farcaster account, shown in Totem after you sign in with it, marked \"that's me\". Once you allow Totem to post as you, the Post box posts as it; it never acts as a persona." },
  { term: "Custody address", def: "The wallet address that owns a Farcaster account. Signing in with it is checked against Farcaster's registry on the Optimism blockchain." },
  { term: "Auth address", def: "A second address a Farcaster account can approve to sign in for it. Totem checks that the account really approved it, on the same blockchain." },
  { term: "Device link", def: "Opening the same identity in a second browser. The new browser shows a short code, and you check that both screens show the same matching characters." },
  { term: "Ring", def: "A group of people you pick, up to 16 rings, each seeing a deeper version of you: that a persona is you, or also which anonymous posts it wrote. Built, test data only." },
  { term: "Ring address", def: "A private address you hand someone, over Signal or in person, so they can put you in one of their rings." },
  { term: "Reach tier", def: "A follower bucket an anonymous post can prove (an account with 1k, 10k or 100k followers) to get more reach in For You, without saying which account. Offered only while 50 accounts are in it. Built, test data only." },
  { term: "Launch", def: "Giving a persona its own Farcaster account, made by a Totem registrar, and revealing all of its anonymous posts at once. Permanent. Built on test data with a simulated registrar." },
  { term: "Reputation tier", def: "A level you earn from activity. A higher one unlocks parts of the feed. It has nothing to do with who sees your personas, or with reach tiers." },
  { term: "Delivery tier", def: "How loudly one account's posts reach you: never miss, a banner, normal, only in its own facet, or quiet." },
  { term: "Grant", def: "A permission you give one person: to read a private post, or to see that two of your personas are linked." },
  { term: "Farcaster", def: "An open social network. An account there belongs to whoever holds its keys, not to an app." },
  { term: "Cast", def: "A post on Farcaster." },
  { term: "Anonymous account", def: "@anon: a shared Farcaster account with no name on it that posts for members, the anoncast idea. A persona without its own account posts through it by default." },
  { term: "Post mode", def: "Where a persona's posts go: through @anon, in Totem only, or to its own account. You set it under the Post box." },
  { term: "Preview only", def: "The mark on an anonymous post made on the public site: it is test data, stays inside the preview and was never posted to Farcaster." },
  { term: "Totem on X", def: "A Totem account on X that would post copies of anonymous posts after a moderator reads them, and that you could DM a tweet to save it. Built on test data only: nothing reaches X." },
  { term: "Validator", def: "The Totem server that stores sealed data and checks proofs." },
  { term: "Sealed", def: "Locked with a key only your device holds, so whoever stores it sees scrambled data." },
  { term: "Neynar", def: "The company whose service Totem uses to read from and post to Farcaster." },
  { term: "Signer", def: "The key that signs posts for a Farcaster account. For the owner's personas, Neynar holds it." },
  { term: "Railway", def: "The hosting company the sites run on." },
  { term: "Proof", def: "Maths that shows something is true without showing who." },
];

export function HelpPage({ surface, rig, docs }: { surface: SurfaceId; rig: boolean; docs: string }) {
  // PUBLIC GO-LIVE (lib/platform/publicLive.ts): in public live mode the landing's third status sentence is LIVE_WRITES
  // (not WRITES_OFF), and Help says the same words wherever it quoted WRITES_OFF (scripts/accept-help.mjs check 4: the
  // landing's status sentences appear word for word here). A server component: read once per render.
  const live = surface === "public" && isPublicLive();
  const writes = live ? LIVE_WRITES : WRITES_OFF;
  // PUBLIC GO-LIVE (F11): the reads sentence says "this site" in live mode, as the landing does (privacy-copy.tsx)
  const reads = relayReadsSentence(live);
  const pub = surface === "public";
  const here = surfaceOf(surface);
  const checked = new Date(STATUS_CHECKED_ON + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  return (
    <div className="min-h-full bg-white text-x-text" data-testid="help-page" data-surface={surface}>
      <header className="sticky top-0 z-20 border-b border-x-border bg-white/90 backdrop-blur-md">
        <div className="mx-auto flex h-[53px] w-full max-w-[680px] items-center gap-3 px-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.svg" alt="" width={28} height={28} className="rounded-full" />
          <span className="flex items-center gap-1.5 text-[17px] font-bold">
            Totem <span className="text-x-sec">Help</span>
          </span>
          <Link
            href="/home"
            data-testid="help-back"
            className="ml-auto rounded-full border border-x-border-dark px-4 py-1.5 text-[14px] font-bold text-x-text hover:bg-x-hover"
          >
            Open the app
          </Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[680px] px-4 pb-24 pt-8">
        <p className="flex items-center gap-2 text-[13px] font-bold uppercase tracking-wide text-x-sec">
          <HelpGlyph size={16} /> Help
        </p>
        <h1 className="mt-2 text-[31px] font-extrabold leading-9 tracking-tight">How Totem works</h1>
        <p className="mt-3 text-[19px] leading-7 text-x-text" data-testid="help-lede">
          Totem is a social app where one private identity on your device runs many personas, and you decide who sees which one.
        </p>

        <div className="mt-5 rounded-2xl border border-[#f5d48a] bg-[#fff8e6] p-4" role="note" data-testid="help-status-box">
          <p className="text-[15px] font-bold leading-5 text-[#6b5200]">Status: a preview, partly built</p>
          <p className="mt-1 text-[15px] leading-6 text-[#4d3b00]">
            Making personas works on the public site today, and so does posting inside Totem, though a post lasts only until you reload. Saving your identity is deployed but has only been checked on a local copy. Much of the rest is built
            but has only run on test data: on the public site, signing in with Farcaster (read-only) and saving with Face ID first; on both sites, bringing in your X archive; on the owner&apos;s private service, personas posting through
            the anonymous account, the Post box and buttons reaching Farcaster, the owner&apos;s Face ID sign-in and hiding the demo world. All of these are deployed and not yet used there; none of them has been seen working on a deployed site. Newer, built on test data, deployed on 12 October 2026 and not yet used:
            rings that choose who sees which persona, on both sites; and, on the owner&apos;s private service, reach tiers, and launching a persona against a simulated registrar that creates nothing on Farcaster. Newest, built on test
            data and not deployed yet: on the public site, anonymous posts proved in your own browser, which stay inside the preview; and copies of anonymous posts to a Totem account on X, tested on a laptop copy of the owner&apos;s
            private service, which wait for a moderator and never reach X. Signing in with X is coming soon. <a href="#today" className="font-bold underline">What works today</a> says exactly which, on which site.
          </p>
        </div>
        <p className={MUTED} data-testid="help-surface">
          You are reading this on the <strong className="text-x-text">{rig ? "development copy (the rig)" : here.label.toLowerCase()}</strong>.{" "}
          {rig ? "It has the shape of the owner's private service, with test data." : here.meaning}
        </p>

        <h2 id="idea" className={H2}>
          The idea
        </h2>
        <p className={P}>
          Sign in with the Farcaster account you already have <em>(built, test data only; X: coming soon)</em>. Save your identity with Face ID or a passkey. Then make personas: your main, a finsta, a few alts. They are linked to each
          other privately <em>(not private yet)</em>, and you decide who sees which one, like a MySpace Top 16 where each ring sees a deeper version of you <em>(built, test data only)</em>. A persona without its own account posts to Farcaster
          through @anon, a shared account with no name on it <em>(built, test data only, on the owner&apos;s private service; on the public site such posts stay inside the preview)</em>, and the people in your rings can see which
          persona wrote it <em>(built, test data only)</em>.
        </p>
        <p className={P}>
          That is the plan, and not all of it is built: the words in brackets say which parts are not, and <a href="#today" className={LINK}>What works today</a> says how far each one is, on which site.
        </p>
        <ThreePanels surface={surface} />

        <h2 id="at-a-glance" className={H2}>
          At a glance
        </h2>
        <AtAGlance />

        <h2 id="big-picture" className={H2}>
          The big picture: Totem, Farcaster and X
        </h2>
        <EcosystemMapCompact surface={surface} />

        <StatusList surface={surface} rig={rig} />

        <h2 id="questions" className={H2}>
          The obvious questions
        </h2>

        <Question id="q-same-person" q="Can people tell my personas are the same person?" verdict="Assume they can, for now.">
          <Cited cite={CITE.label}>
            <LabelSentence />
          </Cited>
          <Cited cite={CITE.network}>
            Some things give personas away whatever the label says. The app puts the first one plainly: {SELF_GRAPH} The second is what you write, since a style, a topic or a posting schedule can match.
          </Cited>
          <Cited cite={CITE.network}>
            On the owner&apos;s private service, persona accounts would post through Neynar, the company that runs the Farcaster accounts for the owner&apos;s personas, so Neynar can see they all belong together. In the security notes&apos;
            words: {NEYNAR_SEES_ALL}
          </Cited>
        </Question>

        <Question id="q-close-tab" q="What if I close the tab before saving?" verdict="On the public site, your identity is gone.">
          <Cited cite={CITE.custody}>{IDENTITY_IN_TAB}</Cited>
          <p className={P}>
            A full page reload does the same: it replaces an unsaved identity with a new one. Moving between pages inside the app is safe, because the app changes pages without reloading. To keep it, press{" "}
            <strong>Save with Face ID / fingerprint</strong> (or Save with a passkey) on the strip at the top of the app, or open{" "}
            {pub ? (
              <Link href="/device" className={LINK} data-testid="help-device">
                Your device
              </Link>
            ) : (
              "Your device"
            )}
            . Keep in this browser also works, in this browser only (clearing the site&apos;s data still loses it).
          </p>
          <p className={P}>
            The 24 words are the advanced backup, under Advanced on Your device. Writing them down does not save the tab by itself: they are your way back in. After the tab is gone, open Your device, paste them into Restore from 24 words
            and press Restore. Signing in with Farcaster does not save your identity either.
          </p>
          <p className={MUTED}>
            The passkey-first screens were deployed on 11 October 2026 and have only been checked on a local copy so far. On the owner&apos;s private service there is nothing to save: the server keeps the owner&apos;s identity.
          </p>
        </Question>

        <Question id="q-siwf" q="Can I sign in with Farcaster?" verdict="Yes, on the public site, read-only. Built, and not yet checked on the deployed site.">
          <p className={P} data-status-from="sign-in-farcaster">
            {status("sign-in-farcaster").notes.public}
          </p>
          <Cited cite={CITE.siwf}>
            It shows who you are; it does not save you. In the card&apos;s own words: {SIWF_NOT_A_SAVE}
          </Cited>
          <Cited cite={CITE.siwf}>
            Before the first request the card says who sees what: {SIWF_RELAY_SEES} {siwfRpcSees(SIWF_RPC_DEFAULT_HOST)} {SIWF_SERVER_SEES}
            {live ? " " + SIWF_SERVER_SEES_LIVE_HELP : null}
          </Cited>
          <Cited cite={CITE.siwf}>
            Your account never acts as a persona here: {SIWF_READ_ONLY} A persona cannot be forked from it either: {SIWF_NO_FORK}
          </Cited>
          <Cited cite={CITE.rootPost}>
            Allow Totem to post as you, and the Post box posts as your own account, with a key kept in your vault that you approve in the Farcaster app. Before you allow it, the panel says: {ROOT_POST_BEFORE} {ROOT_POST_MAIN_APP}
          </Cited>
          <Cited cite={CITE.sources}>On your account&apos;s profile here, the page says: {SIWF_SHOW_POSTS}</Cited>
          <p className={MUTED}>
            {status("sign-in-x").name}: {status("sign-in-x").notes[surface]} On the owner&apos;s private service, connecting a main account with a posting key is under Settings instead.
          </p>
        </Question>

        <Question id="q-farcaster" q="Does my post reach Farcaster?" verdict="Not yet.">
          <Cited cite={live ? CITE.web : CITE.owner}>On the public site: {writes}</Cited>
          {/* the owner-side facts move fastest, so they are the status file's own notes, never a second copy. These two lines
              quote the OWNER service's note on every site (the question is about where a post can reach Farcaster at all),
              so they DECLARE it: data-status-site="owner" (scripts/accept-help.mjs check 11 holds a declared line to exactly
              that site's note) */}
          <p className={P} data-status-from="post-to-farcaster" data-status-site="owner">
            On the owner&apos;s private service: {status("post-to-farcaster").notes.owner}
          </p>
          <p className={P} data-status-from="persona-accounts" data-status-site="owner">
            {status("persona-accounts").name}: {status("persona-accounts").notes.owner}
          </p>
        </Question>

        <Question id="q-post-mode" q="What does “Posts from @x go” mean?" verdict="It is where a persona's posts go, chosen per persona under the Post box.">
          <p className={P}>
            <strong>Through @anon</strong> is the default for a persona without its own Farcaster account: the post goes out from @anon, a shared account with no name on it, at a random time. <strong>In Totem only</strong> keeps it
            inside Totem. <strong>To its own account</strong> appears only once the persona has a Farcaster account of its own.
          </p>
          <p className={P} data-status-from="anon-account">
            {status("anon-account").notes[surface]}
          </p>
        </Question>

        <Question id="q-anon-limit" q="Why only 4 anonymous posts every 6 hours?" verdict="Because the limit is per person, and that is what keeps one person from looking like a crowd.">
          <Cited cite={CITE.anon}>
            Each person gets 4 slots per 6-hour window, shared across all their personas, and each post proves it took a free slot without saying whose. A fifth post in the same window is refused. Posts go out in batches at random times,
            so on the public site a post would appear within about 75 minutes, and the whole site is capped at 500 anonymous posts a day. On the owner&apos;s private service the cap stays at one post until the owner has seen the first one
            on the network.
          </Cited>
        </Question>

        <Question id="q-anon-link" q="Does posting anonymously from two personas link them?" verdict="Not by the proof: two posts use two different slots, so they carry two different one-time codes.">
          <Cited cite={CITE.anon}>
            Which persona wrote a post is kept in a sealed record that only your device can open, so you can claim it later. What the slot number still says, in the security notes&apos; words: {ANON_SLOT_RESIDUAL}
          </Cited>
          <Cited cite={CITE.network}>
            Your words, your posting hours and Neynar, which runs the anonymous account, can still link posts. On the owner&apos;s private service there is one person, so there is no crowd to hide in.
          </Cited>
        </Question>

        {/* PERSONA LAUNCH P7: anonymous posting from the public site. The status line is the PUBLIC site's note on both sites
            (the question is about the public site), so it declares the site it quotes (accept-help check 11) */}
        <Question
          id="q-anon-public"
          q="Can I post anonymously on the public site?"
          verdict="Built, test data only, and not deployed yet: your browser makes the proof, and the post stays inside the preview."
        >
          <p className={P} data-status-from="anon-account" data-status-site="public">
            {status("anon-account").notes.public}
          </p>
          <Cited cite={CITE.web}>
            The proof is made in a background worker in your own tab, and your secret is handed to it inside the tab, never sent anywhere. The post then leaves in a request of one fixed size, with no cookie and no referrer.
          </Cited>
          <Cited cite={CITE.web}>
            What the server still sees: with no outside relay set up, the internet address and the browser&apos;s own description of itself (its user agent) on every anonymous post, which is one reason the label reads DEMO. A post that is still
            waiting for its proof lives only in the open tab, so closing the tab loses it.
          </Cited>
        </Question>

        <Question id="q-x" q="Can I bring my X?" verdict="Built, test data only: drop in your archive. X is never called, and it costs nothing.">
          <p className={P} data-status-from="x-archive">
            {status("x-archive").notes[surface]}
          </p>
          <Cited cite={CITE.byx}>
            Drop in the ZIP X gives you, or its extracted folder, under Settings, Import from X. In the page&apos;s words: {X_ARCHIVE_STAYS} Only the parts you pick are saved, sealed. An archive over 4 GB has to be extracted first. Importing who you follow into a persona shows a warning first, because a
            follow list is a fingerprint: it ties that persona to your X self.
          </Cited>
          <p className={P} data-status-from="x-find-people">
            Finding your people: {status("x-find-people").notes[surface]}
          </p>
          <p className={MUTED}>
            Posting to X, syncing bookmarks and signing in with X cost money under X&apos;s pay-per-use pricing, about $0.015 a post or $0.20 with a link, so they wait for the owner&apos;s yes.
          </p>
        </Question>

        <Question id="q-keys" q="Where are my keys?" verdict="On the public site, in your browser.">
          <Cited cite={CITE.custody}>The server keeps only locked copies of your data and public keys, not the keys themselves. In the security notes&apos; words: {SERVER_HOLDS}</Cited>
          <Cited cite={CITE.owner}>
            On the owner&apos;s private service it is different by design: the keys sit in a plain file on the server&apos;s disk at the hosting company, Railway, and the passphrase does not encrypt them. In the security notes&apos; words:{" "}
            {OWNER_HOST_HOLDS_SEED}
          </Cited>
          <Cited cite={CITE.network}>Persona accounts on Farcaster post through Neynar, which holds their signing keys.</Cited>
        </Question>

        <Question id="q-server" q="Who runs the server, and what can it see?" verdict="Whoever operates this site. Here is what its server sees.">
          <Cited cite={CITE.reads}>{reads}</Cited>
          <Cited cite={CITE.custody}>{TWO_PEOPLE}</Cited>
          <Cited cite={CITE.owner}>
            On the owner&apos;s private service, every page and API route except health, login and the static build files needs the owner&apos;s sign-in: the passphrase, or Face ID / fingerprint added on that device after a passphrase
            sign-in. {OWNER_PASSPHRASE}
          </Cited>
        </Question>

        {/* the owner's own device question; it describes the private service, so it reads the same on both sites */}
        <Question id="q-lost-device" q="Lost a device? (the owner's private service)" verdict="Settings > Security > Lost this device?">
          <p className={P}>
            Next to that device&apos;s Face ID / fingerprint: it removes that sign-in AND signs out every device (for an iPhone, also erase it in Find My). A lost device that never added Face ID / fingerprint: <strong>Sign out everywhere</strong>.
          </p>
          <p className={P}>
            On a borrowed or shared computer, use <strong>Sign out of this device</strong> when you are done, or tap <strong>This isn&apos;t my device</strong> when the app offers Face ID / fingerprint: that computer is then signed out within 2
            hours. A new passphrase also signs out every device and removes every Face ID / fingerprint sign-in.
          </p>
          <p className={MUTED}>Deployed to the private service on 10 October 2026 and not yet used there: the status list says when it has been.</p>
        </Question>

        {/* PERSONA LAUNCH P8: the @totem X outbox and the DM inbox, test data only */}
        <Question
          id="q-x-outbox"
          q="What is Totem on X?"
          verdict="A Totem account on X that would post copies of anonymous posts, after a moderator reads them. Built on test data only: nothing reaches X."
        >
          <p className={P} data-status-from="x-anon-outbox">
            {status("x-anon-outbox").notes[surface]}
          </p>
          <Cited cite={CITE.xout}>
            A copy has the same words as its anonymous post, so anyone can pair the two, and if you later launch that persona the copy reads as yours too. A launch never reveals a copy itself. Whoever moderates reads every copy&apos;s
            words, rejected ones included, and never learns who wrote one. Copies to X follow X&apos;s own limits and the rules for a shared account: no @mentions, one link at most, and an article goes as a short quote and its link,
            never in full.
          </Cited>
          <p className={MUTED}>DM a tweet to @totem to save it (test data: no DM is read from X yet).</p>
        </Question>

        <Question
          id="q-who-sees"
          q="Who can see which persona?"
          verdict="The people you put in your rings: built, test data only, deployed on 12 October 2026 and not yet used there."
        >
          <p className={P}>
            Your Top 16 is up to 16 rings. A ring is a group of people you pick, and for each of your public personas you choose what that ring sees: that the persona is you, or also which of its anonymous posts it wrote. Where a ring is
            shown your anonymous posts, as on the owner&apos;s private service, its people see a half-and-half picture on those posts, your face on the left and the persona&apos;s on the right; they see it too on the posts of a
            persona that has its own Farcaster account. The deployed public site has no anonymous posts yet (posting them from your browser is built on test data and not deployed) and its personas have no Farcaster accounts, so there a
            ring shows a text list instead: which of your personas are you, under &ldquo;Rings you are in&rdquo;. Everyone else sees only the persona, or plain @anon.
          </p>
          <p className={P} data-status-from="who-sees-what">
            {status("who-sees-what").notes[surface]}
          </p>
          <p className={P}>
            To add someone, they give you a private address from their Settings › Rings, over Signal or in person. Someone without Totem can get a link instead: it opens a private card on the Totem site, not inside their Farcaster app.
            The Privacy &amp; Disclosure settings page is an older model: it does not change who can link your personas or who sees your posts; it only decides who may view a persona&apos;s stake history.
          </p>
          <p className={P} data-status-from="rings">
            {status("rings").description} {status("rings").notes[surface]}
          </p>
        </Question>

        <Question
          id="q-ring-outside"
          q="Does anyone outside my rings see the link?"
          verdict="No: the server stores only sealed notes, each kind of one fixed size; everyone else sees plain @anon."
        >
          <Cited cite={CITE.rings}>
            Every anonymous post carries a sealed note of exactly 256 bytes, a real one or random bytes, so a post with an audience looks the same as one without. Your device publishes ring notes padded to groups of 4. What the server
            does learn: that your device publishes them, about how many and when, and the internet address of every device that reads them. Someone you remove from a ring stops seeing your new posts and keeps what it was already sent.
            If you post from more than one device, a post from another device can still use the old key for up to about 25 minutes after the removal, until that device next checks.
          </Cited>
        </Question>

        <Question
          id="q-ring-proof"
          q="Can a ring member prove to someone else which persona is you?"
          verdict="No: the note carries no signature, so a member who passes it on passes on a claim, not proof."
        >
          <Cited cite={CITE.rings}>In the security notes&apos; words: {RING_NO_SIGNATURE}</Cited>
          <Cited cite={CITE.rings}>
            The same lack of a signature cuts the other way: everyone in a ring holds the same key for your persona, so a member could put a note naming that persona on an anonymous post of their own, and other members would read it as
            yours. Signed notes that only a ring member could check are a later version.
          </Cited>
        </Question>

        <Question
          id="q-reach"
          q="What is a reach tier? Is it the same as a ring?"
          verdict="No. A reach tier says how big the account behind an anonymous post is. A ring is the people you chose."
        >
          <Cited cite={CITE.reach}>
            An anonymous post can be boosted in For You with a label like &ldquo;{reachLabel("fc.reach", "gte-10k")}&rdquo;, without ever saying which account. A tier is offered only while at least 50 accounts are in it. A ring is a
            group of people you choose who can see which of your personas wrote an anonymous post.
          </Cited>
          <Cited cite={CITE.reach}>
            What it costs: everyone can see the tier a post proved, so a boosted post hides among that tier&apos;s accounts, not among everyone who posts anonymously. The part of Totem that checks your follower count knows which accounts
            are in each tier, never which post.
          </Cited>
          <p className={P} data-status-from="reach-tier">
            {status("reach-tier").notes[surface]}
          </p>
        </Question>

        <Question
          id="q-launch"
          q="What does launching a persona do?"
          verdict="It gives the persona its own Farcaster account and reveals all of its anonymous posts at once. It is permanent."
        >
          <p className={P}>
            First a preview lists every anonymous post it will link, and what that gives away: the reach tier those posts proved, your posting hours, your writing style and the 6-hour windows you used. You confirm by typing the
            persona&apos;s handle, after a line that says there is no undo. The account is made by a Totem registrar, not by your wallet, and appears 2 to 48 hours later at a random time. Then come one launch post with a proof page,
            up to 10 quotes of its earlier anonymous posts, and a choice of where its next posts go.
          </p>
          <Cited cite={CITE.launch}>
            The launch request goes out anonymously, one per person per window, and names no root, device or other persona. Your other personas&apos; anonymous posts stay hidden, but the windows this persona used hint where they could be.
          </Cited>
          <p className={P} data-status-from="persona-launch">
            {status("persona-launch").notes[surface]}
          </p>
        </Question>

        <Question id="q-live" q="Is it live?" verdict="Partly.">
          <p className={P}>
            See <a href="#today" className={LINK}>What works today</a>: nothing there is called live until it has run on the site it describes.
          </p>
        </Question>

        <section aria-labelledby="privacy" data-testid="help-privacy">
          <h2 id="privacy" className={H2}>
            Privacy, in plain words
          </h2>
          <Cited cite={CITE.label} className={MUTED}>
            On the public site, a banner at the top of the app shows a privacy label. The label may claim privacy only when every condition below holds, and today they do not all hold.
          </Cited>
          <Cited cite={CITE.label}>
            <LabelSentence />
          </Cited>
          <h3 className={H3}>The eight conditions, in plain words</h3>
          <ol className="mt-2 list-decimal space-y-1 pl-6 text-[15px] leading-6" data-cite={CITE.label} data-testid="help-conditions-plain">
            {PLAIN_CONDITIONS.map((c) => (
              <li key={c.plain}>
                {c.plain}{" "}
                {pub ? (
                  <span className="text-x-sec">{c.publicSite === "fails" ? "Not met on the public site." : "Checked on your device each time."}</span>
                ) : null}
              </li>
            ))}
          </ol>
          <details className="mt-3 rounded-2xl border border-x-border px-4 py-3 text-[15px] leading-6">
            <summary className="cursor-pointer font-bold">The exact wording</summary>
            <ol className="mt-2 list-decimal space-y-1 pl-6" data-cite={CITE.label} data-testid="help-conditions">
              {LABEL_CONDITIONS.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ol>
            <p className="mt-2 text-x-sec" data-cite={CITE.hidden}>
              {PROOF_CLAIM}
            </p>
          </details>

          <h3 className={H3}>On the public site</h3>
          <ul className="mt-2 list-disc space-y-1.5 pl-6 text-[15px] leading-6">
            <li data-cite={CITE.custody}>
              {IDENTITY_IN_TAB} A reload loses it too. {SERVER_HOLDS}
            </li>
            <li data-cite={CITE.reads}>{reads}</li>
            <li data-cite={live ? CITE.web : CITE.owner}>{writes}</li>
            <li data-cite={CITE.custody}>{TWO_PEOPLE}</li>
            <li data-cite={CITE.siwf}>
              Signing in with Farcaster: {SIWF_RELAY_SEES} {siwfRpcSees(SIWF_RPC_DEFAULT_HOST)} {SIWF_SERVER_SEES}
              {live ? " " + SIWF_SERVER_SEES_LIVE_HELP : null}
            </li>
          </ul>

          <h3 className={H3}>On the owner&apos;s private service</h3>
          <ul className="mt-2 list-disc space-y-1.5 pl-6 text-[15px] leading-6">
            <li data-cite={CITE.owner}>{OWNER_LABEL_NOT_MET}</li>
            <li data-cite={CITE.owner}>The keys sit in a plain file on the server&apos;s disk at Railway; the passphrase does not encrypt them. {OWNER_HOST_HOLDS_SEED}</li>
            <li data-cite={CITE.owner}>{OWNER_PASSPHRASE}</li>
            <li data-cite={CITE.network}>Neynar, which would run the persona accounts, can see they all belong together. {NEYNAR_SEES_ALL}</li>
          </ul>

          <div className="mt-6 rounded-2xl border border-x-border bg-[#f7f9f9] p-4" role="note">
            <p className="text-[15px] font-bold leading-5">What this does not protect</p>
            <p className="mt-1 text-[15px] leading-6 text-x-sec">
              Anything you post that is public by design, anything two of your accounts do to each other in public, and, on the owner&apos;s private service, anything from whoever holds its passphrase or runs its host. Treat the public site
              as a test: do not put anything real or sensitive in it.
            </p>
          </div>
        </section>

        <h2 id="glossary" className={H2}>
          Words we use
        </h2>
        <dl className="mt-3 divide-y divide-x-border rounded-2xl border border-x-border" data-testid="help-glossary">
          {GLOSSARY.map((g) => (
            <div key={g.term} className="flex flex-col gap-0.5 px-4 py-3 sm:flex-row sm:gap-4">
              <dt className="shrink-0 text-[15px] font-bold leading-6 sm:w-[150px]">{g.term}</dt>
              <dd className="min-w-0 text-[15px] leading-6 text-x-sec" data-cite={g.cite}>
                {g.def}
              </dd>
            </div>
          ))}
        </dl>

        <h2 id="settings" className={H2}>
          Where to change things
        </h2>
        <nav className="mt-3 overflow-hidden rounded-2xl border border-x-border" data-testid="help-settings" aria-label="Settings">
          {[
            ...(pub ? [{ href: "/device", label: "Your device", blurb: "Save with Face ID or a passkey, sign in with Farcaster; the 24 words under Advanced" }] : []),
            { href: "/settings/account", label: "Account & Personas", blurb: "Switch personas, or create your first one" },
            { href: "/settings/import-x", label: "Import from X", blurb: "Drop in the archive X gives you: your posts and who you follow (test data only so far)" },
            // the owner's own pages: the private service only (the public site has no owner sign-in and no connector)
            ...(pub
              ? []
              : [
                  { href: "/settings/owner-security", label: "Security", blurb: "Face ID / fingerprint sign-ins, Lost this device?, Sign out everywhere" },
                  { href: "/settings/connect", label: "Connect your Farcaster account", blurb: "Post as your own account; approve once in the Farcaster app by QR (not available until a connector account exists)" },
                ]),
            { href: "/settings/modes", label: "Modes", blurb: "Ranking, filters, notifications, action buttons" },
            { href: "/settings/rules", label: "Rules & Filters", blurb: "Build rules, preview what they catch" },
            { href: "/settings/delivery", label: "Delivery", blurb: "Where each account shows up, per mode" },
            { href: "/settings/zk", label: "ZK privacy layer", blurb: "Which privacy conditions hold right now" },
            { href: "/settings", label: "All settings", blurb: "Everything else" },
          ].map((s) => (
            <Link
              key={s.href}
              href={s.href}
              data-testid="help-settings-link"
              className="flex items-center justify-between border-b border-x-border px-4 py-3.5 last:border-b-0 hover:bg-x-hover"
            >
              <span className="min-w-0">
                <span className="block text-[15px] leading-5">{s.label}</span>
                <span className="block truncate text-[13px] leading-4 text-x-sec">{s.blurb}</span>
              </span>
              <span className="ml-3 shrink-0 text-x-sec">›</span>
            </Link>
          ))}
        </nav>

        <h2 id="docs" className={H2}>
          The full docs
        </h2>
        {/* DOCS UNDER APP (D-DOCS-UNDER-APP): every deployment serves the docs at /docs, so the link is always here
            (docs is never empty: lib/platform/preview.ts docsUrl()); the "not published yet" line is gone with the
            separate docs service. A new tab: the docs are their own static site and boot no device. */}
        <p className={P}>
          This page is the short version. The documentation goes deeper, from how the keys fit together to how to run Totem yourself.{" "}
          <a href={docs} target="_blank" rel="noreferrer" className={LINK} data-testid="help-docs">
            Read the full docs
          </a>{" "}
          (opens in a new tab).
        </p>

        <p className="mt-12 border-t border-x-border pt-4 text-[13px] leading-5 text-x-sec">
          Every status on this page was checked against the running sites on {checked}. Nothing here is a guarantee.
        </p>
      </main>
    </div>
  );
}
