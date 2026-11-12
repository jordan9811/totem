// WHAT WORKS TODAY — the one list, read by the in-app Help page (app/help/page.tsx) and by the docs site's generator.
//
// Every "what works" sentence a reader sees comes from here, so the Help page and the docs cannot drift apart. The
// app's code never reads docs/ (D-CU-6; DOCS UNDER APP serves the built docs at /docs, still without importing them);
// the docs may read this file. Two consumers, two read paths:
//   * the app imports FEATURES, LEGEND and SURFACES below, typed;
//   * scripts (the docs generator, scripts/accept-help.mjs) read the THREE JSON BLOCKS between the @status-json markers
//     as text and JSON.parse them, because a Node script cannot import TypeScript. So each block is strict JSON:
//     double quotes, no trailing commas, no comments inside. Keep it that way, or every reader breaks loudly.
//
// THE RULES THE ENTRIES FOLLOW (the Salvo template's voice rules, plus the honesty rules of this project):
//   * conservative: a capability is "live" on a surface only when it has run on that DEPLOYED service, not on the
//     rig and not in a suite. Built-and-tested-on-test-data is "fixture", whatever the code could do with a key.
//   * every unbuilt part of the owner's pitch (pitch: true) is "soon" on the surface where it is unbuilt, never
//     "designed": a reader of the pitch is told plainly that it is coming, not that a document exists.
//   * "off" means built, deployed and waiting for the owner to switch it on. A surface that does not offer a
//     capability by design (its configuration refuses it, or it has nothing to do there) is "na", never "off", so a
//     reader is not told to wait for something that is not coming to that site.
//   * per surface: "public" is the open preview anyone can visit (the browser device answers /api/*); "owner" is the
//     owner's private service (a rig-shaped deployment behind a passphrase, SECURITY-POSTURE.md section 18). The
//     laptop rig has no column: it is the owner-service shape on test data.
//   * no em dashes, verdict first, concrete numbers, plain words. No privacy CLAIM is made here: a note may state a
//     limit, never a protection. Privacy sentences live in components/help/privacy-copy.tsx, verbatim and cited.
//   * `sources` names where each status was checked (report sections, code, SECURITY-POSTURE assumption ids). They
//     are pointers for reviewers and the docs, not rendered on the Help page.
//
// Derived from the read-only status audit of 2026-10-07 (public site at 48d0edf, owner service at e749cc9). When a
// capability changes state, change it HERE first; scripts/accept-help.mjs checks that the Help page renders exactly
// these rows with exactly these statuses.
//
// OVERNIGHT 2026-10-08 (the morning-deploy integration): the owner passkey sign-in, the Post box / Like / Recast /
// Follow going to Farcaster, the QR connect flow, the anon arm script and the empty world are all BUILT and
// node-harnessed but not yet on either deployed service, so every one of them is "fixture" on the owner column (never
// "live": the rule above) until the lead sees it on the deployed service and flips it here. STATUS_CHECKED_ON stays
// the audit's date on purpose: the running sites were not re-checked tonight.
//
// PERSONA LAUNCH P0 (2026-10-10, research/plan-persona-launch-2026-10-10.md): the pass's model, honestly. Why these
// rows and not others: the pass ships its built pieces as "fixture" on the site they were built for (sign-in-farcaster,
// the passkey-first save, x-archive / x-find-people / x-link for Bring your X v1, persona-scoped posting through @anon
// in anon-account), because none of them has run on a DEPLOYED service; its later waves (rings, reach-tier,
// persona-launch, x-anon-outbox) are "soon" on both sites, since each is part of the plan and unbuilt. anon-account's
// public column moved from "na" to "soon": the plan's P7 brings anonymous posting to strangers on the public site, so it
// is no longer "not coming to that site". "sign-in" split into sign-in-farcaster (built) and sign-in-x (not built, by
// decision). A "reach tier" (an anon post's follower bucket) is not a "ring" (people you pick) and not a reputation
// tier (activity): three words, three rows. STATUS_CHECKED_ON is the board's re-check of the running sites (099c60a on
// both), the same day; with it, three owner rows (owner-passkey, post-to-farcaster, empty-world) say "deployed
// 2026-10-10, not yet used" as docs/roadmap/index.md records, and stay "fixture" because nobody has used them there.
//
// PERSONA LAUNCH WAVE 2 (2026-10-12: P4 rings, P5 reach tiers, P6 launch), built and swept on test data, then deployed to
// both sites on 2026-10-12 (see the last paragraph).
// Why these statuses: rings and show-to-a-friend are "fixture" on BOTH sites, because the public site runs them in the
// browser device (the production-shaped suite drove a stranger's device-signed publish and the /d card) and the owner
// service runs the same code, publishing to its own validator (A-RING-OWNER-SERVICE-DROP, said in its note).
// who-sees-what follows them, checked against the suites (2026-10-12): on the public shape accept-rings-prod drives a
// stranger's device-signed publish, the member's device listing the persona and the /d card, so the "that it is you"
// depth works there and "coming soon" would understate it; the "anonymous posts" depth has nothing to show there until
// P7, and its note says so. On the owner shape accept-rings shows members seeing exactly the shared posts; its note
// says the service's own validator reaches nobody else yet. reach-tier and
// persona-launch are "fixture" on the owner column only (the rig is that shape) and stay "soon" on the public site,
// because both ride anonymous posting, which reaches that site with the browser prover (P7, wave 3). The registrar is
// SIMULATED, a launch spends $0 and nothing reaches the real network, and every note says so. x-anon-outbox stays
// "soon" (P8, wave 3). Wave 1 was deployed on 2026-10-11 (docs commit 1ab5b8d), so its two public rows that still said
// "not deployed yet" now say deployed and not yet used there; STATUS_CHECKED_ON stays: nobody re-checked the sites.
//
// WAVE 2 DEPLOYED (2026-10-12): every wave 2 note that said "not deployed yet" now says deployed on 2026-10-12 and keeps
// its qualifier (test data only, not yet used, a SIMULATED registrar); no status moved, because nobody has used any of
// it on a deployed site. D-REACH-ISSUER-HOST-ONLY (2026-10-12, lead): in the public site's browser device fc.reach and
// x.reach refuse to register or issue (lib/attest/registry.ts HOST_ONLY_ISSUERS / issuerUnavailableHere, checked first
// in lib/attest/subject.ts requestIssuance), because the visitor's own key would squat the open registry's id and could
// self-issue any tier; reach-tier stays "soon" on the public site until an issuer Totem runs exists (a later step).
//
// PERSONA LAUNCH WAVE 3 (2026-10-13: P7 anonymous posting from the public site, P8 the @totem X outbox), built on test
// data and NOT deployed yet. Why these statuses: anon-account's public column moves from "soon" to "fixture", because a
// stranger's tab now proves in a Web Worker and sends over the browser's anonymous channel (accept-anon-prod, on the
// production shape against a throwaway validator); the posts are TEST-UNIVERSE posts that stay inside the preview, and
// the note says so, and says that posting to Farcaster from a browser is still not on the preview ("soon" in words,
// since one row has one status per site). x-anon-outbox moves to "fixture" on the owner column only (the rig is that
// shape: a fixture X transport and a moderation queue, nothing reaches X) and stays "soon" on the public site, where it
// is not offered this wave (D-X-PUBLIC-OFF). reach-tier and persona-launch keep "soon" on the public site (the browser
// proves only the plain anon tree, D-PUBLIC-ANON-TREE; launch still refuses there), but their notes no longer give "no
// prover in the browser" as the reason. rings and who-sees-what keep their statuses; their public notes say the
// deployed site has no anonymous posts yet and that no suite has shown a ring member opening a note on a public-site
// anon post. x-paid's owner note gains the DM inbox's one sentence, the same words Settings shows (lib/x/inbox.ts
// inboxStatus). STATUS_CHECKED_ON stays: nobody re-checked the running sites, and nothing of wave 3 runs on them.
//
// PUBLIC GO-LIVE (2026-10-17: the owner's direction, "the public site is the product"; notes/runbooks/GO-LIVE-TODAY.md is the steps to
// take it live). NO STATUS MOVED TO "live", by the rule at the top: the go-live build is built and tested against
// stand-ins (a stand-in Neynar, a stand-in sign-in and chain, throwaway validators) and has not run on a deployed site,
// and every live piece is armed only by the owner. Why these rows: two new rows, "onboarding" (the guided start at
// /welcome) and "anon-page" (/anon and its Farcaster Mini App), both "fixture" on the public column and "na" on the
// owner's (the guided start and the anon page are the public site's; the private service's /welcome points to Settings).
// empty-world's public column moves from "na" to "fixture": live mode (PUBLIC_LIVE=true) brings the empty world to the
// public site, built and not deployed, so "not offered here" would now be wrong. anon-account stays "fixture" on the
// public column (scripts/accept-help.mjs check 12 measures the Help picture's cap against it); its note names the public
// @anon relay, the fid gate, the filter, reports and takedowns, and what a live site says until the owner arms it.
// post-to-farcaster stays "soon" on the public column: it means posting AS the persona's own account, and persona posts
// reach Farcaster through @anon instead, which its note says. sign-in-x stays "soon" ("coming later"). The live
// registrar and live X that the stopped go-live run wrote for the owner service were PARKED (SECURITY-POSTURE.md §29,
// §30), so persona-launch, x-paid and x-anon-outbox keep their wave-3 notes (x-anon-outbox's owner note: deployed to
// that service on 2026-10-13). STATUS_CHECKED_ON stays: nobody re-checked the running sites.

// POST AS YOU (2026-11-05): "Allow Totem to post as you" is built on test data and NOT deployed yet, so connect-main's
// public column moves from "soon" to "fixture" (the rule above: built and tested on test data, never "live" until the
// owner has approved a real key and posted on the deployed site). Its note says what it needs first (Totem's app account,
// made and armed) and who may pay the network fee (the visitor's Farcaster app, until the app account can sponsor). The
// rows that said posting as your own account "isn't built" (onboarding, sign-in-farcaster, post-to-farcaster) now point
// at connect-main. STATUS_CHECKED_ON stays: nobody re-checked the running sites.
//
// POST AS YOU ARMED (2026-11-05): Totem's app account (@ontotem, fid 3358029) is armed on the live public validator
// (GET /fc/app-account answered ready:true, sponsored:false, read 2026-11-05), so connect-main's public note says
// "deployed and switched on, the first real approval not done yet". Its status stays "fixture" by the rule above: no real
// key has been approved and nothing has been posted this way. The hub-card writes and acting as yourself ("You" in the
// account menu) are built on test data only and not deployed, and the notes say so.

export type StatusId = "live" | "fixture" | "designed" | "off" | "soon" | "na";
export type SurfaceId = "public" | "owner";

export interface LegendEntry {
  id: StatusId;
  /** what a reader sees on a chip */
  label: string;
  /** one sentence: what the label promises, and what it does not */
  meaning: string;
  /** the docs site's status tags this maps to (docs/features/index.md vocabulary) */
  docsTags: string[];
}

export interface SurfaceInfo {
  id: SurfaceId;
  label: string;
  meaning: string;
}

export interface Feature {
  id: string;
  /** a plain name, the words a user would use */
  name: string;
  /** one line: what it is, as a user meets it */
  description: string;
  /** true when this capability is part of the owner's pitch (log in, passkey, personas, links, tiers, anon account) */
  pitch: boolean;
  /** how real it is on each surface: a LEGEND id (the docs generator reads this key, per surface) */
  status: Record<SurfaceId, StatusId>;
  /** what is true on each surface today, in one or two plain sentences */
  notes: Record<SurfaceId, string>;
  /** what is still missing before it works everywhere, in plain words */
  missing: string;
  /** where the status was checked: report sections, code paths, assumption ids */
  sources: string[];
}

/** the day every status below was last checked against the running sites (ISO date; change it with the entries) */
export const STATUS_CHECKED_ON = "2026-10-10";

/** The status legend, in the order the owner named it and the Help page groups by. */
export const LEGEND: readonly LegendEntry[] = /* @status-json:legend:begin */ [
  {
    "id": "live",
    "label": "Works live",
    "meaning": "Runs on the deployed site named, and was checked there, not only in tests.",
    "docsTags": ["SHIPPED"]
  },
  {
    "id": "fixture",
    "label": "Built, test data only",
    "meaning": "The code exists and its tests pass, but it has only run on test data or a local copy, never on the live site.",
    "docsTags": ["SHIPPED-FIXTURE"]
  },
  {
    "id": "designed",
    "label": "Designed",
    "meaning": "Written down in detail. No code yet.",
    "docsTags": ["SPECCED"]
  },
  {
    "id": "off",
    "label": "Off on purpose",
    "meaning": "Built and deployed, then switched off until the owner turns it on.",
    "docsTags": ["SHIPPED-FIXTURE"]
  },
  {
    "id": "soon",
    "label": "Coming soon",
    "meaning": "Part of the plan and not built yet. Some of these already have a written design.",
    "docsTags": ["SPECCED", "IDEA"]
  },
  {
    "id": "na",
    "label": "Not offered here",
    "meaning": "This site does not offer it, by design. It is not waiting to be switched on.",
    "docsTags": []
  }
] /* @status-json:legend:end */;

/** The two deployed shapes a reader can be on. */
export const SURFACES: readonly SurfaceInfo[] = /* @status-json:surfaces:begin */ [
  {
    "id": "public",
    "label": "Public site",
    "meaning": "The open preview anyone can visit. Your identity lives in your own browser."
  },
  {
    "id": "owner",
    "label": "Owner's private service",
    "meaning": "A private copy of Totem for one person, behind the owner's own sign-in. Its server holds the owner's keys, so personas can have real Farcaster accounts."
  }
] /* @status-json:surfaces:end */;

/** Every capability, in the order a user meets them. */
export const FEATURES: readonly Feature[] = /* @status-json:features:begin */ [
  {
    "id": "owner-passkey",
    "name": "Owner sign-in with Face ID or a fingerprint (passkeys)",
    "description": "On the owner's private service: sign in once with the passphrase, then add Face ID, Touch ID, a fingerprint or Windows Hello for that device, and sign in with one tap from then on.",
    "pitch": false,
    "status": { "public": "na", "owner": "fixture" },
    "notes": {
      "public": "Not offered: the public site has no owner sign-in. Your own identity is saved with a passkey instead (see Save it with a passkey or 24 words).",
      "owner": "Deployed to this service on 2026-10-10, not yet used there. Sign in once per device with the passphrase, tap Add Face ID / fingerprint for this device, and that device stays signed in for 30 days at a time; the 24 words are never needed to sign in. Settings, Security has Lost this device?, Sign out of this device and Sign out everywhere. Checked by a node-only harness (46 checks and 20 mutations), not yet on the deployed service."
    },
    "missing": "One sign-in each on the owner's laptop and phone on the deployed service.",
    "sources": ["lib/platform/owner-access.ts", "lib/platform/owner-passkeys.server.ts", "components/owner/OwnerSecurityPanel.tsx", "scripts/unit-owner-passkeys.mjs (46/46, 20/20 mutations)", "SECURITY-POSTURE.md section 18"]
  },
  {
    "id": "identity",
    "name": "One private identity, the root",
    "description": "One private root identity holds all your personas. On the public site it is made in your browser the moment you open the app.",
    "pitch": true,
    "status": { "public": "live", "owner": "live" },
    "notes": {
      "public": "Checked on the deployed site: two browsers get two separate identities. The go-live build (not deployed yet) starts a new visitor at the guided start, which leads with Sign in with Farcaster; the identity itself is still made in your browser.",
      "owner": "The server keeps the owner's root in a plain file on its Railway volume. The passphrase guards logins and does not encrypt the root."
    },
    "missing": "Nothing for the basics. On the public site an unsaved identity lives only in the open tab: close or reload the tab before saving and it is gone.",
    "sources": ["notes/reports/REPORT-CUSTODY.md, What was verified against the deployment", "SECURITY-POSTURE.md section 16", "SECURITY-POSTURE.md section 18, A-PRODLIVE-THE-HOST-HOLDS-THE-SEED"]
  },
  {
    "id": "onboarding",
    "name": "The guided start: sign in with Farcaster, this is you, keep your account",
    "description": "Three screens at /welcome: sign in with Farcaster, see your Farcaster profile as you in Totem (picture, name, username, your verified X account), and keep it with Face ID. Then the home feed, with your people, your X posts and an optional persona one tap away.",
    "pitch": true,
    "status": { "public": "fixture", "owner": "na" },
    "notes": {
      "public": "Built, test data only, and not deployed yet: tested on a local copy shaped like this site with live mode on. Sign in with Farcaster, This is you and Keep your account, three dots and Back; no persona is asked for (one is made, if you want, from Pick up where you left off on the home feed). This is you fills in your Farcaster picture, name and username, editable, offers three free usernames when yours is taken in Totem, and shows the X account your Farcaster account verified (looked up in a list every visitor downloads whole) with Show. Continue with X is shown marked Soon until the owner arms Sign in with X; then it signs you in with X the same way, filling This is you from your X account (built, test data only: see Sign in with X). On the home feed you are your Farcaster account, and the Post box offers Allow Totem to post as you (built, test data only: see Connect your main Farcaster account). It picks up where you left off after a reload, from what your browser already holds, and stores no marker of its own. Nobody has used it on a deployed site.",
      "owner": "Not offered: the private service starts with the owner's passphrase and passkey, and its personas, sign-in and saving live in Settings. Its /welcome says so."
    },
    "missing": "The go-live deploy with live mode on, the site's final web address (passkeys are tied to it), the list of Farcaster-verified X accounts switched on so This is you can find a handle (VALIDATOR_X_INDEX=on; off, it says it couldn't check), a first real post as your own account from Totem (built: Totem's app account must be made and armed first), signing in with X (a paid X developer app), and a first run through it on the deployed site, including Find your people's count of who you follow on Farcaster (built, test data only: see Your Farcaster Following).",
    "sources": ["app/(main)/welcome/page.tsx", "app/api/onboarding/route.ts", "components/onboarding/Onboarding.tsx", "components/onboarding/steps/*", "components/home/PickUp.tsx", "lib/onboarding/state.ts", "lib/onboarding/xHandle.ts", "lib/identity/localAvatar.ts", "lib/platform/publicLive.ts", "scripts/unit-onboarding.mjs", "scripts/accept-onboard-prod.mjs", "SECURITY-POSTURE.md section 32", "notes/runbooks/GO-LIVE-TODAY.md steps 1, 2, 3 and 8"]
  },
  {
    "id": "sign-in-farcaster",
    "name": "Sign in with Farcaster",
    "description": "Scan a QR code with the Farcaster app, or tap into it on your phone, and approve: your Farcaster account shows here as yours. It shows who you are; it does not save your identity, a passkey does.",
    "pitch": true,
    "status": { "public": "fixture", "owner": "na" },
    "notes": {
      "public": "Deployed here on 2026-10-11 and not yet used: scan a QR or tap into the Farcaster app, approve, and your account shows here as a read-only public self marked \"that's me\". Tested on a local copy shaped like this site, never on the deployed one.",
      "owner": "Not offered: the private service opens with the owner's passphrase or passkey, and connects a main account with a signer under Settings."
    },
    "missing": "The owner's first real sign-in on the deployed site. In the go-live build (not deployed yet) it is the guided start's first step (on a phone your identity is kept in this browser before the Farcaster app opens) and also how you join the anonymous crowd for the public @anon: the server keeps which Farcaster account joined, one member per account. Posting as that account from Totem is its own step once you are signed in (Allow Totem to post as you: see Connect your main Farcaster account). Signing in does not save your identity: a passkey does.",
    "sources": ["lib/fc/siwf/flow.ts", "lib/fc/siwf/verify.ts", "lib/fc/siwf/links.ts", "app/api/fc/siwf/route.ts", "components/device/FarcasterSignIn.tsx", "scripts/unit-siwf.mjs", "scripts/accept-siwf.mjs", "scripts/accept-siwf-prod.mjs", "SECURITY-POSTURE.md section 21", "docs/custody-model.md D-SIWF-1 to D-SIWF-4"]
  },
  {
    "id": "sign-in-x",
    "name": "Sign in with X",
    "description": "Continue with X, approve on X, and your X account is you in Totem: your name, username and picture. Connect Farcaster later and the same identity shows both.",
    "pitch": true,
    "status": { "public": "fixture", "owner": "na" },
    "notes": {
      "public": "Built, test data only, and not deployed yet; dormant until the owner arms it (X_CLIENT_ID, scripts/owner/arm-x-signin.ps1): until then Continue with X says Soon. Tested against a stand-in for X on a local copy shaped like this site with live mode on, never against X itself. X's sign-in page opens in this tab (your identity is kept in this browser first); X's one-time code comes back to this tab, and Totem's validator trades it for your public profile and revokes the token at once. No persona is involved. Farcaster parts (your Following, posting as yourself, the anonymous crowd) say they need a Farcaster account and offer Connect Farcaster.",
      "owner": "Not offered: the private service connects accounts its own way, in Settings."
    },
    "missing": "The owner's X developer app (a Single page App with the callback https://ontotem.com/welcome/x, and pay-per-use credits: about $0.01 per sign-in if X bills its users/me read), the arm script run, the go-live deploy, and a first real sign-in with X on the deployed site. Your X follows come from your X archive; reading them from X's API is off by decision ($0.01 per account returned).",
    "sources": ["lib/x/signin/flow.ts", "lib/x/signin/pkce.ts", "lib/x/signin/config.ts", "validator/xsignin.js", "app/api/x/signin/route.ts", "app/(main)/welcome/x/page.tsx", "components/x/XSignIn.tsx", "scripts/unit-x-signin.mjs", "validator/test/xsignin.test.js", "scripts/accept-x-signin-prod.mjs", "SECURITY-POSTURE.md section 38", "docs/mechanism/sign-in-with-x.md (X's docs and pricing, read 2026-11-06)"]
  },
  {
    "id": "save",
    "name": "Save it with Face ID or a passkey",
    "description": "Save your identity with Face ID, a fingerprint or another passkey, so it is still here tomorrow. Keep in this browser and your 24 words sit under Advanced, as the backup.",
    "pitch": true,
    "status": { "public": "fixture", "owner": "na" },
    "notes": {
      "public": "Deployed here, but its checks ran only on a local copy shaped like this site, not on the deployed one. The passkey-first screens (Save with Face ID first, a save card after your first post, persona or Farcaster sign-in, the 24 words under Advanced) were deployed on 2026-10-11 and have not been used there yet. In the go-live build (not deployed yet) it is the guided start's second step, Save with Face ID.",
      "owner": "Not offered: the owner's identity lives on the server, so there is nothing to save in a browser."
    },
    "missing": "One passkey check and one 24-word check on the deployed public site. Signing in with Farcaster is not a way to save: a passkey, this browser or the 24 words bring an identity back. Passkeys are tied to the site's web address, so the address is chosen before strangers save: the first step of going live, before the go-live deploy.",
    "sources": ["SECURITY-POSTURE.md section 16, A-CU-2-REAL-PROVIDER-NOT-EXERCISED", "SECURITY-POSTURE.md section 16, A-CU-6-RP-ID-IS-THE-HOST", "components/device/SaveMoment.tsx", "components/device/IdentityNudge.tsx", "components/device/DeviceApp.tsx", "scripts/accept-siwf.mjs R1 and R9", "notes/reports/REPORT-CUSTODY.md, custom domain"]
  },
  {
    "id": "device-link",
    "name": "Use it on a second device",
    "description": "Open the same identity in another browser. The new browser shows a short code, and you check that both screens show the same matching characters.",
    "pitch": false,
    "status": { "public": "fixture", "owner": "na" },
    "notes": {
      "public": "Built and tested on a local copy of the public site. Not yet checked on the deployed one.",
      "owner": "Not offered: the owner's identity lives on the server."
    },
    "missing": "One check on the deployed public site. A passkey that stays on one device (Windows Hello keeps it on that computer, for one) opens the identity there only: a second device is linked instead, the way the go-live runbook's phone step does it (notes/runbooks/GO-LIVE-TODAY.md step 8).",
    "sources": ["notes/reports/REPORT-CUSTODY.md GATE 3", "scripts/smoke-deployed.mjs (does not cover linking)"]
  },
  {
    "id": "personas",
    "name": "Personas: your main, a finsta, alts",
    "description": "Make as many personas as you like from one identity and switch between them. Give each a colour, or show only one at a time.",
    "pitch": true,
    "status": { "public": "live", "owner": "live" },
    "notes": {
      "public": "Each visitor has their own. The deployed check covered creating a persona and posting as it. Personas are optional (go-live build, not deployed yet): the guided start never asks for one; Make a persona on the home feed's Pick up where you left off gives one a picture made on your device and a choice of where its posts go: through @anon (the default) or in Totem only.",
      "owner": "The owner's personas, kept by the server."
    },
    "missing": "On the public site personas live inside Totem only. They are not Farcaster accounts. Cloning a persona is built and tested, but no button in the app reaches it yet.",
    "sources": ["notes/reports/REPORT-CUSTODY.md, What was verified against the deployment", "notes/runbooks/MORNING.md (post-deploy pass: tint, compartment, cloning)"]
  },
  {
    "id": "private-links",
    "name": "Links between your personas stay private, even from us",
    "description": "The goal: nobody, including whoever runs the server, can tell which personas are yours. It is not met yet.",
    "pitch": true,
    "status": { "public": "soon", "owner": "soon" },
    "notes": {
      "public": "Partly built. The proof layer runs on test data, and the app's privacy label reads DEMO, not yet private, because not every condition holds.",
      "owner": "Partly built, and the label reads DEMO here too. On this service the owner also runs the server, and Neynar holds every persona account's signing key under one API key."
    },
    "missing": "A network relay run by an independent third party, a live proof system with enough members to hide among, and signing keys you hold yourself instead of Neynar.",
    "sources": ["lib/zk/privacy.ts", "SECURITY-POSTURE.md section 4", "SECURITY-POSTURE.md section 14, A-FID-NEYNAR-SEES-ALL", "SECURITY-POSTURE.md section 18"]
  },
  {
    "id": "who-sees-what",
    "name": "Who sees which persona (your Top 16)",
    "description": "Pick people and put them in rings; each ring sees a deeper version of you. Everyone else sees only the persona, with no link to you, or nothing at all.",
    "pitch": true,
    "status": { "public": "fixture", "owner": "fixture" },
    "notes": {
      "public": "Built as rings, test data only, deployed here on 2026-10-12 and not yet used; tested on a local copy of this site: Settings › Rings makes up to 16 rings, each person you add hands you a private address (or you send them a link), and their device then lists which of your personas are you under \"Rings you are in\" (a link opens a private card instead). The deeper level, which anonymous posts a persona wrote, has nothing to show on the deployed site yet: anonymous posting from this site is built on test data and not deployed, and no test has yet shown a ring member opening its notes here. Ordinary posts here stay in your own browser, so a ring member does not see your persona's posts. One-to-one grants are built and tested in code, but no button in the app makes one.",
      "owner": "Built as rings, test data only, deployed to this service on 2026-10-12 and not yet used there. On a laptop copy of this service, ring members see which personas are you and which anonymous posts they wrote. Rings made here are published to this service's own validator, which no device outside this service reads, so for now a ring made here reaches nobody (see Rings). One-to-one grants are built and tested and show up in the demo data, but no button in the app makes one."
    },
    "missing": "Rings used on a deployed site. On the public site, anonymous posting deployed (built on test data, not deployed yet) and a ring member shown opening its notes there, without which the deeper level has nothing to show; on the private service, the ring mailbox on the public site's server, so its rings reach people there (see Rings). A private persona's audience is still a one-to-one grant with no button. The Privacy & Disclosure settings page is an older model: it does not change who can link your personas or who sees your posts; it only decides who may view a persona's stake history.",
    "sources": ["lib/rings/model.ts", "components/settings/RingsPane.tsx", "components/device/DeviceApp.tsx (Rings you are in)", "scripts/accept-rings.mjs (the rig: members see exactly the shared posts)", "scripts/accept-rings-prod.mjs checks 2 and 3 (the production shape: a stranger's device publishes, the member's device lists the persona; the /d card)", "lib/identity/resolver.ts", "lib/private/visibility.ts", "notes/reports/REPORT-CUSTODY.md D-CU-3-THE-FIXTURE-WORLD-IS-NOT-A-VISITOR'S", "components/settings/DisclosurePane.tsx", "lib/influence/stakes.ts historyFor (the legacy disclosure model gates stake history)", "no component calls /api/identity/grant or /api/private/audience (grep, 2026-10-07)", "SECURITY-POSTURE.md section 24"]
  },
  {
    "id": "show-to-a-friend",
    "name": "Show a persona to a friend, anywhere",
    "description": "Let a friend you pick, on another device or in a plain Farcaster app, see that two of your accounts are both you.",
    "pitch": true,
    "status": { "public": "fixture", "owner": "fixture" },
    "notes": {
      "public": "Built on test data as part of Rings, deployed here on 2026-10-12 and not yet used: a ring can hold a link instead of a Totem address; the link opens a private card on this site (/d) that reads the note in the visitor's browser, with no account and no identity made. Nothing appears inside their Farcaster app.",
      "owner": "Built, test data only, deployed to this service on 2026-10-12 and not yet used there. Links made on this service are behind its sign-in, so use them from the public site."
    },
    "missing": "One real link opened on the deployed site. Your main account appears on the card only once Totem knows it (Sign in with Farcaster, or a connected main account).",
    "sources": ["app/d/page.tsx", "components/rings/DropCard.tsx", "lib/rings/envelope.ts (linkInboxKey)", "scripts/accept-rings.mjs check 9", "scripts/accept-rings-prod.mjs check 3", "research/spec-friend-whitelist-2026-10-08.txt", "SECURITY-POSTURE.md section 24, A-DROP-LINK-IS-THE-CHANNEL"]
  },
  {
    "id": "posting",
    "name": "Post, like and follow inside Totem",
    "description": "Write posts as any persona, like and follow.",
    "pitch": false,
    "status": { "public": "live", "owner": "live" },
    "notes": {
      "public": "Posts stay inside the preview, in this tab's memory: a reload clears them. A persona posting through @anon reaches Farcaster only through the public @anon (see the anonymous account row), once the owner switches it on.",
      "owner": "Kept in memory inside the owner's Totem until the next restart. A post that went to Farcaster stays there; the in-app copy is kept in memory until the next restart."
    },
    "missing": "Posts that are kept: today a public post lives only in memory. Private-persona posts are the only ones sealed and stored. Reaching Farcaster: see Your posts reach Farcaster.",
    "sources": ["notes/reports/REPORT-CUSTODY.md, What was verified against the deployment", "app/api/actions/cast/route.ts"]
  },
  {
    "id": "post-to-farcaster",
    "name": "Your posts reach Farcaster",
    "description": "A post, like, recast or follow by a persona goes out to Farcaster as that persona.",
    "pitch": true,
    "status": { "public": "soon", "owner": "fixture" },
    "notes": {
      "public": "Posting as a persona's own Farcaster account is coming. In the go-live build (not deployed yet) a persona's posts reach Farcaster through the shared @anon account instead, with no name on them, once the owner switches the public @anon on (see the anonymous account row). Likes, recasts and follows stay in Totem. Posting as your own main account is the Connect your main Farcaster account row (Allow Totem to post as you).",
      "owner": "Built and tested on test data, deployed to this service on 2026-10-10, and not yet used for a real post. Post, Reply, Like, Recast and Follow go to Farcaster as the persona's own account once it has one, and the app says \"Posted to Farcaster as @name\" with a link. The line under the Post box says where a post goes before you press Post, and the post is refused if that changed (another tab switched persona, or an account was created meanwhile). Farcaster takes 320 bytes per post. A persona without its own account says \"Saved in Totem only\" and how to create one; the shared test account is never used. A persona's replies, likes, recasts, follows and @mentions need NEYNAR_VIEWER_FID (your main account's fid) set on this service; without it they are refused. Quotes stay in Totem. Undoing a like, recast or follow on Farcaster is not available from the app yet. Daily limits, shared by all your accounts: 10 posts, 10 follows, 30 actions. Writes were switched on 2026-10-07; no real post from this service is on record yet."
    },
    "missing": "On the private service: a first real post from the app on the deployed build; undo (unlike, unrecast, unfollow) on Farcaster; the profile page's Follow on a live account. On the public site: signing posts in your browser, plus a server that passes them on to Farcaster.",
    "sources": ["components/Composer.tsx", "app/api/actions/cast/route.ts", "app/api/actions/farcasterDelivery.ts", "lib/fc/writes.ts", "scripts/unit-fc-buttons.mjs (27/27)", "scripts/accept-fc-buttons.mjs (written, not yet run)", "notes/runbooks/GO-LIVE-FARCASTER.md (e) and (h)"]
  },
  {
    "id": "persona-accounts",
    "name": "Each persona as its own Farcaster account",
    "description": "A persona gets a real Farcaster account, with its own name and keys.",
    "pitch": true,
    "status": { "public": "na", "owner": "off" },
    "notes": {
      "public": "Not offered on the public site: its configuration refuses the keys this needs.",
      "owner": "Built and ready. No persona has its own account yet; the owner creates each one, for about $0.35 to $0.90 of ETH each."
    },
    "missing": "On the private service, the owner runs the account-creation step once per persona, after one decision: accounts drawn from the current Neynar app wallet sit on the blockchain beside the Totem-named test account (same registering wallet, same minutes), so anyone reading the chain can group them. The account script states this and asks for a typed SIBLINGS (the current wallet) or FRESH (a wallet that has not touched the test account). Until an account exists, real posts go out from one shared test account. Launch (an account made by a Totem registrar instead of this wallet, after revealing the persona's anonymous posts) is a separate path, built on test data only: see Launch a persona.",
    "sources": ["notes/reports/REPORT-FID.md GATE 2 (met on test data; the live half is the owner's action)", "lib/platform/env-contract.ts", "lib/fc/writes.ts", "SECURITY-POSTURE.md section 14, A-FID-REGISTRANT-BY-FIAT (refuted onchain, 2026-10-07)"]
  },
  {
    "id": "anon-account",
    "name": "Personas post through an anonymous account (the anoncast idea)",
    "description": "A persona's post goes out through @anon, a shared Farcaster account with no name on it, at random times: up to 4 anonymous posts every 6 hours, shared across your personas. A new persona without its own account posts this way by default.",
    "pitch": true,
    "status": { "public": "fixture", "owner": "fixture" },
    "notes": {
      "public": "Built, test data only, and not deployed yet. In the build that is deployed nothing a browser sends reaches Farcaster. The go-live build adds the public @anon: your browser makes the proof in a background worker and the public server relays the post from one shared @anon account at a random moment in the next 30-minute slot. Only Farcaster-verified people join the crowd (one per Farcaster account, by signing in), a new member's first post waits for the next 6-hour window, and posting opens once 50 have joined. A filter refuses the obvious (slurs, phone numbers, email and street addresses, scam links), every @anon post has a Report button, and the owner removes posts from a takedown queue (deleted from Farcaster, hidden in Totem, the record kept). It is tested against stand-ins only, and it runs only once the owner switches it on: until then a live site says \"Anonymous posting isn't switched on for this site yet, so nothing can be posted anonymously right now.\" and a test preview keeps its posts inside, marked \"Preview only · not on Farcaster\".",
      "owner": "Built and tested on test data, never run live. Up to 4 anonymous posts every 6 hours, shared across your personas. Each is made as one of your personas, and that persona is kept in a sealed record so you can claim the post later. Under the Post box, Posts from @persona go: through @anon (the default for a persona without its own account), in Totem only, or to its own account. On a service with one owner it is an extra account with no name on it, not a crowd to hide in. The owner switches it on with one script and a cap of one post; a claim of a past post is visible inside Totem only (nothing changes on Farcaster)."
    },
    "missing": "On the public site: the go-live deploy, then the owner's public @anon: its own Farcaster account made on the protocol with scripts/owner/make-anon-account.ps1 (about $0.20 of ETH on Optimism, a typed CONFIRM) and armed with scripts/owner/arm-public-anon.ps1 -Transport hub (a typed ANON; no Neynar at all: the hub route, built on test data only), or the older Neynar agent route (a typed THIRD and ANON), with caps of 500 posts a day for the site and 20 in total until he raises them, its own off switch, his yes on the terms, 50 Farcaster-verified people in the crowd, and a first post seen on Farcaster. Whoever relays a post sees its text first (the hub on the hub route, Neynar on the Neynar route), and an outside relay (OHTTP) is still needed so the server stops seeing each poster's internet address and browser. On the private service: the owner's third Neynar app and its agent account, then scripts/owner/arm-anon.ps1 (a typed ANON, a cap of one post, its own kill switch). The option to claim a post later stays unreviewed and off.",
    "sources": ["notes/runbooks/GO-LIVE-FARCASTER.md (f) and (k)", "scripts/owner/arm-anon.ps1", "validator/zk.js", "validator/anon.js (POST /zk/anon/web, GET /zk/anon/web/head)", "lib/zk/config.ts", "lib/zk/anon/slots.ts", "lib/zk/anon/availability.ts (D-ANON-SWITCH)", "lib/zk/anon/webChannel.ts", "lib/zk/prover/browser-worker.ts", "lib/zk/transport/browser.ts", "lib/identity/postMode.ts", "components/PostModePicker.tsx", "components/CastCard.tsx (Preview only, not on Farcaster)", "scripts/unit-anon-slots.mjs", "scripts/accept-anon-slots.mjs", "scripts/accept-linkage6.mjs", "scripts/unit-prover.mjs", "scripts/accept-anon-prod.mjs (the production shape, against a throwaway validator)", "shots/p7-browser-prover.json", "SECURITY-POSTURE.md section 14.1", "SECURITY-POSTURE.md section 20", "SECURITY-POSTURE.md section 23", "SECURITY-POSTURE.md section 24 (the ring note on every anon post)", "SECURITY-POSTURE.md section 25 (the tree a post proves)", "SECURITY-POSTURE.md section 27 (the public site)", "scripts/lib/gpl-source.mjs (the prover's GPL-3.0 source, served at /device/source/)", "validator/test/fixtures/railway-hop-headers.json (the edge headers the web route accepts behind TRUST_PROXY)", "research/plan-persona-launch-2026-10-10.md P3, P7, D2, D4"]
  },
  {
    "id": "anon-page",
    "name": "The anon page and the Farcaster Mini App",
    "description": "For Farcaster people who skip the full app: post as plain @anon from a page of its own, or inside the Farcaster app as the Mini App Anon Wire, see recent @anon posts, share one, and open Totem with one button.",
    "pitch": true,
    "status": { "public": "fixture", "owner": "na" },
    "notes": {
      "public": "Built, test data only, and not deployed yet: tested against stand-ins (a stand-in Farcaster sign-in, a stand-in for Neynar and a throwaway server). Sign in with Farcaster to join the crowd, write, and the post goes out from @anon under the same caps, filter, Report button and terms as a persona's post. Inside the Farcaster app it opens as a Mini App only once its manifest is signed for the site's final web address. Nothing it sends has reached Farcaster.",
      "owner": "Not offered: the anon page and its Mini App are the public site's door to the public @anon. The private service gates the page like every page."
    },
    "missing": "The go-live deploy, the public @anon switched on, the Mini App signed for the final web address by the Farcaster account that owns it (in the Farcaster app's developer tools, then scripts/owner/arm-miniapp.ps1 and a typed SIGN), and a first post from inside Farcaster seen on the network.",
    "sources": ["app/anon/page.tsx", "app/anon/AnonApp.tsx", "components/anon/*", "app/anon/p/[castHash]/page.tsx", "lib/miniapp/manifest.ts", "lib/miniapp/sdk.ts", "app/.well-known/farcaster.json/route.ts", "middleware.ts (the framing exception)", "scripts/unit-miniapp.mjs", "scripts/accept-anon-page-prod.mjs", "scripts/owner/arm-miniapp.ps1", "SECURITY-POSTURE.md section 33", "notes/runbooks/GO-LIVE-TODAY.md step 5"]
  },
  {
    "id": "rings",
    "name": "Rings: your people see who wrote your anon posts",
    "description": "Up to 16 rings of people you pick. Where a ring is shown your anon posts, its people see which of your personas wrote each one, with a half-and-half picture: your face on the left, the persona's on the right. Everyone else sees plain @anon.",
    "pitch": true,
    "status": { "public": "fixture", "owner": "fixture" },
    "notes": {
      "public": "Built and tested on a local copy of the public site, test data only, and deployed here on 2026-10-12: Settings › Rings makes up to 16 rings; each person you add hands you a private address (or you send them a link); your device publishes sealed notes, signed by your device and padded to groups of 4; their device reads them on its background check and lists which of your personas are you under \"Rings you are in\" (a link opens a private card instead). The \"@persona · shared with you by\" line and the half-and-half picture appear on posts; the deployed site has no anonymous posts yet and its personas have no Farcaster accounts, so here a ring shows only that list. Anonymous posting from this site, built since on test data and not deployed yet, puts the sealed note on every post it makes, but no test has yet shown a ring member opening one on a copy of this site. Nobody has used rings on a deployed site. New, built on test data and not deployed yet: acting as yourself, you can send the people in a ring a Farcaster post from its menu (by its id only); it shows in their Following as Sent to you by the name you chose, if their browser already read that post for their Following.",
      "owner": "Built, test data only, deployed to this service on 2026-10-12 and not yet used there. Rings made here are published to this service's own validator, so people on the public site cannot read them yet (see what is missing)."
    },
    "missing": "A ring used on the deployed public site; anonymous posting from the public site deployed (built on test data, not deployed yet) and a ring member shown opening its notes there; rings made on the private service reaching people on the public site (the shared mailbox must move to the public site's server); anonymous publishing authorized by a proof instead of your device's signature (a later version).",
    "sources": ["lib/rings/*", "lib/rings/outbound.ts sendToRing (spec C)", "SECURITY-POSTURE.md section 39", "scripts/accept-hub-read-prod.mjs HR22", "validator/ringdrop.js", "app/api/rings/route.ts", "components/settings/RingsPane.tsx", "components/rings/SplitAvatar.tsx", "app/d/page.tsx", "scripts/unit-rings.mjs", "scripts/accept-rings.mjs", "scripts/accept-rings-prod.mjs", "validator/migrations.js migration 23 (ring_drop)", "research/plan-persona-launch-2026-10-10.md P4, R8, D8", "research/spec-friend-whitelist-2026-10-08.txt", "SECURITY-POSTURE.md section 24"]
  },
  {
    "id": "reach-tier",
    "name": "Reach tiers for anon posts",
    "description": "An anon post from a proven big Farcaster account gets more reach in For You, labelled like \"posted by an account with 10k+ followers\", without saying which account. Not the same as a reputation tier or a ring.",
    "pitch": true,
    "status": { "public": "soon", "owner": "fixture" },
    "notes": {
      "public": "Coming soon here. Anonymous posting from your browser is now built (test data, preview only, not deployed yet), but it proves only the plain anonymous crowd: no reach tier is offered in the browser. The part that vouches for your follower count has to be run by Totem, not by your browser: in your browser its signing key would be your own, so the first visitor to take its name in the shared list could give themselves any tier. Since 2026-10-12 this site refuses to run it in your browser, so reach tiers here also wait for an issuer Totem runs, a later step. Built and tested on the laptop rig, on test data: 1k+, 10k+ or 100k+ Farcaster followers of your main account, with a Neynar score of 0.7 or more to enter, offered only while at least 50 accounts are in that tier.",
      "owner": "Built, test data only, deployed to this service on 2026-10-12 and not yet used there. Reach tiers: an anonymous post can be boosted as 1k+, 10k+ or 100k+ Farcaster followers of your main account once at least 50 accounts are in that tier and at least 50 more in the tier below it; the post then carries the label \"posted by an account with 10k+ followers\" wherever it shows, Following included, never which account, and only For You gives it a head start of 1 to 4 hours. With one owner no tier reaches 50, so none is offered on this service. Tested on the laptop rig only."
    },
    "missing": "Live follower counts (Neynar read credits on the owner's plan); X followers need an xAI key, so they are test data only; for the public site, an issuer Totem runs (your browser refuses to be one) and reach tiers offered to the browser prover, which proves only the plain anonymous crowd today; a tier with 50 real accounts in it. The boost exists inside Totem only.",
    "sources": ["lib/reach/trees.ts", "lib/reach/boost.ts", "lib/reach/held.ts", "lib/attest/issuers/fcReach.ts", "lib/attest/issuers/xReach.ts", "components/ReachPicker.tsx", "components/ReachBadge.tsx", "app/api/reach/route.ts", "lib/attest/registry.ts (HOST_ONLY_ISSUERS, issuerUnavailableHere: D-REACH-ISSUER-HOST-ONLY)", "lib/attest/subject.ts (requestIssuance refuses first)", "scripts/unit-reach.mjs I3", "validator/zk.js (reachFloor, tree_size)", "validator/migrations.js migration 24 (tree_size)", "scripts/unit-reach.mjs", "scripts/accept-reach.mjs", "research/plan-persona-launch-2026-10-10.md P5, R6, D1", "SECURITY-POSTURE.md section 25"]
  },
  {
    "id": "persona-launch",
    "name": "Launch a persona",
    "description": "When a persona is ready, reveal all of its anon posts at once and give it its own Farcaster account, made by a Totem wallet. Permanent, and your choice.",
    "pitch": true,
    "status": { "public": "soon", "owner": "fixture" },
    "notes": {
      "public": "Launch isn't on this preview yet. Anonymous posts made from this site are test data that stay inside the preview, and launching from here also needs the Totem registrar.",
      "owner": "On test data, tested on the laptop rig, deployed to this service on 2026-10-12 and not yet used there: a preview of every anon post it links and what that narrows, a typed confirmation, the anonymous launch request, a SIMULATED Totem registrar (the account appears 2 to 48 hours later at a random time, $0), one batch reveal anyone can check against the account's registered key, a proof page, the launch post with up to 10 quotes, and a required choice of where its posts go next. Nothing is created on Farcaster. Once this service runs on real data, it says: Launch needs the Totem registrar, which isn't set up yet."
    },
    "missing": "Going live needs the Totem registrar: a fresh wallet with ETH on Optimism, a Farcaster account of its own to vouch for every key, the real account-creation call, a real check of each account's keys, the real name server and a thin relay that forwards posts. A price of about $5 a launch, paid with prepaid credits that do not tie the payer to the persona, is a later pass.",
    "sources": ["lib/launch/*", "validator/registrar.js", "validator/simchain.js", "lib/fc/thinRelay.ts", "lib/fc/chain/*", "app/(main)/launch/[personaId]", "app/proof/[fid]", "components/launch/*", "validator/migrations.js migration 25 (launch_registrar)", "scripts/accept-launch.mjs", "scripts/unit-launch.mjs", "research/plan-persona-launch-2026-10-10.md P6, R1, R2, R7, D3, D5, D6, D7", "SECURITY-POSTURE.md section 26"]
  },
  {
    "id": "live-reads",
    "name": "Read real Farcaster posts",
    "description": "See real Farcaster posts in the app, read-only.",
    "pitch": false,
    "status": { "public": "off", "owner": "off" },
    "notes": {
      "public": "Built and deployed, switched off until the owner adds a read key. When on, it shows posts from a list of authors the owner picked, read through our server, which sees what is read. In live mode (go-live build, not deployed yet) these posts, your personas' posts and @anon posts are the whole home feed: no sample content.",
      "owner": "Optional: the owner chooses whether this service shows live content. When it does, the feed and notifications are one chosen account's, not each persona's."
    },
    "missing": "A read key alone no longer shows anything once the per-surface switch is deployed (built, test data only): the owner also switches For You (for personas and signed-out visitors) and search to Neynar, one at a time (see Neynar as a switch). Channels stay sample content. Following and notifications never come from these reads: for a visitor signed in with Farcaster they are read by their browser straight from a Farcaster node (see Your Farcaster Following). Nor does For You for that visitor while they act as themselves (see For You from Farcaster, without Neynar; built on test data only).",
    "sources": ["SECURITY-POSTURE.md section 19", "SECURITY-POSTURE.md section 42", "notes/runbooks/GO-LIVE-FARCASTER.md (c) and (h)", "scripts/owner/arm-live-reads.ps1"]
  },
  {
    "id": "neynar-switch",
    "name": "Neynar as a switch, per surface",
    "description": "Where each Farcaster surface reads from is the owner's switch: Farcaster's own network (the default), Neynar, or auto. Following and notifications always read Farcaster's network. Every feed and result says where it came from, and Settings, Developer lists each surface's source and why.",
    "pitch": false,
    "status": { "public": "fixture", "owner": "na" },
    "notes": {
      "public": "Built, test data only, not deployed, and it ships with Neynar off everywhere and no spend: tested with a local stand-in of Neynar. Switched on, search adds posts and people via Neynar after your device's own results, and For You for a persona or a signed-out visitor is the owner's curated list via Neynar. What you type goes to Totem's server and to Neynar, never who you are, and a search that names one of your own accounts is never sent. Like and recast totals stay unavailable on posts read from Farcaster's network, and channels are not built. The old Show my Farcaster posts here button is gone: it named your account to Totem's server.",
      "owner": "Not offered: the owner's service is not the public site."
    },
    "missing": "A deploy, then the owner's decision to buy a Neynar plan and switch search on first (notes/runbooks/OWNER-CHECKLIST.md, Neynar as a switch). The cost of a Neynar post search is not on Neynar's price page yet and is assumed until the first real use. Counts and channels have no source to switch to. A user setting is not offered: a wrong pick would leak quietly.",
    "sources": ["lib/fc/source/switch.ts", "lib/fc/readRelay.server.ts (search-casts, search-users, fc_source_off)", "app/api/search/network/route.ts", "components/search/NetworkSearchIsland.tsx", "components/settings/FcSourcesPanel.tsx", "scripts/unit-fc-source.mjs", "scripts/accept-fc-source-prod.mjs (every switch neynar, and the default)", "SECURITY-POSTURE.md section 42", "notes/runbooks/MORNING-NOV-7.md section 6"]
  },
  {
    "id": "farcaster-following",
    "name": "Your Farcaster Following, and Find your people",
    "description": "Sign in with Farcaster and the Following tab is the people your Farcaster account follows and their posts, newest first; the home card says how many you follow and lists them. Read by your browser straight from a Farcaster node, with no Neynar.",
    "pitch": true,
    "status": { "public": "fixture", "owner": "na" },
    "notes": {
      "public": "Built, test data only, and not deployed yet: tested against a local stand-in of a Farcaster node, and measured read-only against the real one (a root following 965 accounts: 50 posts on screen in under a second, everything read in about 5 seconds). It reads the 1,000 accounts you followed most recently, 8 requests at a time, shows posts as they arrive, and opens a post as its thread and an author as their profile. Your own post as yourself shows on top at once. Once Totem may post as you, the cards reply, like and recast (and undo) as your own account, and your own posts can be deleted; a button is pressed only after Farcaster accepted it, and never while you act as a persona or on one of your personas' posts. A read that fails says so with Retry, never an empty feed. The node sees your internet address with your account and what you read; Totem's servers see none of it. Which of the people you follow use Totem is not marked yet.",
      "owner": "Not offered: the owner's service is not the public site."
    },
    "missing": "The deploy, and a first look at a real account's Following on the deployed site. Marking which people you follow use Totem. A first real like, recast and reply from these cards on the deployed site (acting as yourself, You in the account menu, is how a visitor with personas reaches them; built on test data only).",
    "sources": ["lib/fc/hubRead/read.ts", "lib/fc/hubRead/copy.ts", "app/api/fc/hub/route.ts", "components/hub/HubFollowing.tsx", "components/hub/HubPeople.tsx", "components/hub/HubThread.tsx", "components/hub/HubProfile.tsx", "components/hub/HubWrite.tsx", "components/home/PickUp.tsx", "scripts/unit-hub-read.mjs", "scripts/accept-hub-read-prod.mjs", "SECURITY-POSTURE.md section 36"]
  },
  {
    "id": "farcaster-notifications",
    "name": "Notifications from Farcaster",
    "description": "Sign in with Farcaster and, while you act as yourself, Notifications shows who followed you, who mentioned you, and the replies, likes and recasts on your newest posts, grouped like X (\"Alice, Bob and 12 others liked your post\"), with an unread count on the bell. Read by your browser straight from a Farcaster node, with no Neynar.",
    "pitch": false,
    "status": { "public": "fixture", "owner": "na" },
    "notes": {
      "public": "Built, test data only, and not deployed yet: tested against a local stand-in of a Farcaster node that answers the way the real one does (two shards per page), and measured read-only against the real one (78 node reads for any account with 25 posts, about 1 to 1.6 seconds with names, and 4 reads for a new account). It covers your newest 50 followers and 50 mentions, and the replies, likes and recasts on your newest 25 posts, and says so on the page. A reply or mention opens as its thread and works like a Following card (reply, like and recast as yourself once Totem may post as you). Viewing the page marks them seen, kept sealed in your vault, so the badge clears on every device. A read that fails says so with Retry, never an empty list. While a persona acts, Notifications and the badge are the persona's, and nothing is read as you. Your mode's notification setting does not filter these yet, and quote posts of yours are not shown.",
      "owner": "Not offered: the owner's service is not the public site."
    },
    "missing": "The deploy, and a first look at a real account's notifications on the deployed site. Quote posts of yours, your mode's notification setting applied to them, and anything outside the window (older posts, followers past the newest 50).",
    "sources": ["lib/fc/hubRead/notifications.ts", "lib/fc/hubRead/seen.ts", "lib/fc/hubRead/copy.ts", "app/api/fc/hub/route.ts", "components/hub/HubNotifications.tsx", "components/hub/HubUnreadBadge.tsx", "components/notifications/NotificationsBody.tsx", "scripts/unit-hub-notifications.mjs", "scripts/accept-hub-notifications-prod.mjs", "SECURITY-POSTURE.md section 37"]
  },
  {
    "id": "farcaster-for-you",
    "name": "For You from Farcaster, without Neynar",
    "description": "Sign in with Farcaster and, while you act as yourself, For You shows posts the people you follow liked or recast lately, and recent posts from accounts several of them follow, each saying why (\"Liked by Alice and 2 others you follow\"), ordered by your mode. Read by your browser straight from a Farcaster node, with no Neynar.",
    "pitch": false,
    "status": { "public": "fixture", "owner": "na" },
    "notes": {
      "public": "Built, test data only, and not deployed yet: tested against a local stand-in of a Farcaster node, and measured read-only against the real one (four real accounts: 300 to 1,200 node reads, 1.7 to 5.7 seconds, 100 to 150 posts to show). It finds up to 40 of the people you follow who liked a post in the last 3 days (checking at most the 1,000 you followed most recently), reads what they liked, recast and follow, and the newest posts of up to 30 accounts several of them follow, and says so on the page. Your mode orders it; its engagement and the lens's likes and recasts count only the people you follow. It reads only about half of the accounts beyond your follows it could (picked by a key in your vault, so that what it skips says little about your personas), so about half of what it might show you never appears. A read that fails says so with Retry, never an empty feed. While a persona acts, For You is the persona's and nothing is read as you. The node sees your internet address and which accounts beyond your follows you are shown; Totem's servers see none of it.",
      "owner": "Not offered: the owner's service is not the public site."
    },
    "missing": "The deploy, and a first look at a real account's For You on the deployed site. No network-wide ranking (Farcaster's node keeps no counts), so it is only what your own graph surfaces; a follow that only recasts is not found active; there is no switch to the curated relay feed for your own For You (FC_SOURCE_FORYOU=neynar gives it to personas and signed-out visitors only).",
    "sources": ["lib/fc/hubRead/forYou.ts", "lib/fc/hubRead/mode.ts", "lib/fc/hubRead/copy.ts", "app/api/fc/hub/route.ts", "components/hub/HubForYou.tsx", "components/home/HomeFeed.tsx", "scripts/unit-hub-foryou.mjs", "scripts/accept-hub-foryou-prod.mjs", "SECURITY-POSTURE.md section 40"]
  },
  {
    "id": "empty-world",
    "name": "No demo world: live mode on the public site, the empty world on the owner's service",
    "description": "The public site in live mode, and the owner's private service, hide the sample people, posts, feeds and rooms, and show only your own personas, @anon posts and live Farcaster content when that is switched on.",
    "pitch": false,
    "status": { "public": "fixture", "owner": "fixture" },
    "notes": {
      "public": "Built, test data only, and not deployed yet: live mode (PUBLIC_LIVE=true) hides the sample people, posts, trends, curators and desks on the public site too, in each visitor's own tab; nothing is deleted. Tested on a local copy shaped like this site. Without it the public preview shows the sample world, so a visitor has something to read.",
      "owner": "Deployed on 2026-10-10 (LAYERS_WORLD=empty): the service's boot log says the demo world is hidden, and the owner has not looked yet. It hides the demo world: no sample name, picture or counts anywhere, \"No persona yet\" until the first persona is made, and feeds that show live content or say \"Nothing here yet\". Nothing is deleted; the demo rows are hidden and come back if the switch is removed. Its review's fixes are in; checked on the development copy only."
    },
    "missing": "On the public site: the go-live deploy with PUBLIC_LIVE=true and a look at it (no sample identity anywhere). On the owner's service: a look at the deployed service, no sample identity in the chrome, and the owner's first persona made from Settings, Account & Personas.",
    "sources": ["lib/world.ts", "lib/world-flag.ts", "scripts/accept-world-empty.mjs", "notes/runbooks/GO-LIVE-FARCASTER.md, the owner services' variables (LAYERS_WORLD)"]
  },
  {
    "id": "feed-controls",
    "name": "Tune your feed",
    "description": "Modes, rules, filters, lenses, delivery tiers, readwise and scroll zones decide what you see, and when.",
    "pitch": false,
    "status": { "public": "live", "owner": "live" },
    "notes": {
      "public": "Works on sample posts, and now applies to your real Farcaster Following when you sign in with Farcaster: your mode's rules, packs, lens and delivery tiers decide it, in your browser. Readwise works there too: a long Farcaster post (80 words or more) or one with a link is a reading piece, with the same time-on-screen measure, read mark, bin and comeback as a saved article. A note from a desk you subscribe to shows on the Farcaster post it is about, and a noted post you liked or recast comes back into your Following. All of it is built and tested on test data, not deployed yet.",
      "owner": "Works, mostly on sample posts unless the owner switched on live content."
    },
    "missing": "On your real Following and For You a mode orders the posts already read (it never reads more); on Following ranking by likes or recasts is not available (Farcaster's network keeps no counts; the page says so), and on For You it counts only the people you follow. No desk exists on the live site yet, so desk notes there have nothing to show; a desk's demote and auto-block do not act on Farcaster accounts yet. A Farcaster post cannot be put in a folder yet, so priority folders do not weigh real posts. Scroll zones have not been tuned on a real phone.",
    "sources": ["lib/rules/evaluate.ts", "lib/fc/hubRead/mode.ts", "lib/fc/hubRead/extras.ts", "lib/fc/hubRead/extrasSource.ts", "SECURITY-POSTURE.md §36", "SECURITY-POSTURE.md §39", "scripts/unit-hub-read.mjs H19, H20", "scripts/accept-hub-read-prod.mjs HR21", "notes/reports/REPORT-MEGA2.md", "notes/reports/REPORT-POST.md", "notes/reports/REPORT-MEGA.md KNOWN-BROKEN"]
  },
  {
    "id": "search",
    "name": "Search",
    "description": "Search everything your device holds.",
    "pitch": false,
    "status": { "public": "live", "owner": "live" },
    "notes": {
      "public": "Searches what this browser holds.",
      "owner": "Searches what the owner's service holds."
    },
    "missing": "The smart part is a stand-in for a real on-device model. Searching Farcaster is built, test data only and off: it goes through Neynar, after the device's own results, once the owner arms the read key and switches search to Neynar (see Neynar as a switch); Farcaster's own network has no search.",
    "sources": ["docs/internal/open-issues.md", "notes/runbooks/GO-LIVE-FARCASTER.md (h)", "SECURITY-POSTURE.md section 42"]
  },
  {
    "id": "x-archive",
    "name": "Bring your X: your archive",
    "description": "Drop in the archive X gives you (the .zip, or its extracted folder) to bring in your posts and the people you follow.",
    "pitch": false,
    "status": { "public": "fixture", "owner": "fixture" },
    "notes": {
      "public": "Tested only with a synthetic 3,000-post archive (and the small fixture on the rig). Your browser reads the archive here: only your posts, who you follow, likes (off unless you turn them on) and ad interests are kept, sealed and saved in pieces; message and media files are skipped, and your email and phone are dropped. Nothing from X is called. In Settings, Import from X.",
      "owner": "Same as the public site: tested with a synthetic 3,000-post archive and the rig's small fixture only. The owner's own browser page reads the file; this service's server saves the pieces."
    },
    "missing": "The closing run with a real X archive on both deployments, through a reload and a restart. Archives over 4 GB must be extracted and picked as a folder.",
    "sources": ["lib/x/archiveZip.ts", "lib/x/archiveParse.ts", "lib/x/importer.ts", "lib/x/shelf.ts", "lib/vault/chunkedDoc.ts", "validator/limits.js", "scripts/accept-x5.mjs", "scripts/unit-x-v1.mjs", "SECURITY-POSTURE.md section 22"]
  },
  {
    "id": "x-find-people",
    "name": "Find your X follows on Farcaster",
    "description": "See which people you follow on X are already on Farcaster, matched on your own device. Following them from Totem comes later. About 397,000 Farcaster accounts have verified an X account.",
    "pitch": false,
    "status": { "public": "fixture", "owner": "fixture" },
    "notes": {
      "public": "Built on test data: who you follow is matched on your own device against a list of Farcaster-verified X accounts that the validator builds (no keys, no X cost). Tested against a local stand-in list only; no validator has built the real list yet (VALIDATOR_X_INDEX is off), so the panel says the list is not available on this site.",
      "owner": "Built on test data: who you follow is matched against a list of Farcaster-verified X accounts that this service's validator builds (no keys, no X cost). Tested against a local stand-in list only; the real list is not built yet (VALIDATOR_X_INDEX is off), so the panel says the list is not available."
    },
    "missing": "The owner switching on VALIDATOR_X_INDEX (it reads api.farcaster.xyz, a beta endpoint, nightly), the measured list size, and following them from Totem (the follow queue, a later wave).",
    "sources": ["lib/x/match.ts", "lib/x/indexClient.ts", "validator/xindex.js", "components/settings/XPeoplePanel.tsx", "scripts/accept-x5.mjs", "scripts/smoke-x.mjs", "api.farcaster.xyz/fc/account-verifications (probed 2026-10-07)", "SECURITY-POSTURE.md section 22"]
  },
  {
    "id": "x-link",
    "name": "Link your X account",
    "description": "Show that a persona is you on X: \"X @handle, verified on Farcaster\".",
    "pitch": false,
    "status": { "public": "fixture", "owner": "fixture" },
    "notes": {
      "public": "A test link says \"test link, not verified\" and exists on the test rig only. A persona shows its X account as \"verified on Farcaster\" only when that persona's own Farcaster account verified it; public personas have no Farcaster account yet, so this site does not offer it.",
      "owner": "Built on test data: the badge reads the same list of Farcaster-verified X accounts, which no validator has built yet."
    },
    "missing": "Switching on the list; a real X sign-in still needs a paid X developer app.",
    "sources": ["lib/x/identity.ts", "lib/x/attestations.ts", "components/settings/LinkedAccounts.tsx", "app/api/x/link/route.ts", "app/api/x/identity/route.ts", "lib/x/oauth.ts"]
  },
  {
    "id": "x-paid",
    "name": "Post to X, and sync from X",
    "description": "Cross-post to X, sync bookmarks, and DM a link to a Totem account on X to save it.",
    "pitch": false,
    "status": { "public": "na", "owner": "fixture" },
    "notes": {
      "public": "Not offered here: the X destination is listed on the test rig only, and syncing refuses to run while an X client id is set.",
      "owner": "Test data only. The live code is a stub. Settings says it plainly: \"DM a tweet to @totem to save it (test data: no DM is read from X yet).\""
    },
    "missing": "X charges per use: about $0.015 a post, or $0.20 with a link. This waits for the owner's yes.",
    "sources": ["lib/crosspost/destinations.ts", "lib/x/sync.ts", "lib/x/inbox.ts (inboxStatus)", "app/(main)/settings/page.tsx (Totem on X)", "components/settings/DmHookPanel.tsx", "lib/platform/env-contract.ts"]
  },
  {
    "id": "x-anon-outbox",
    "name": "Totem on X: anonymous posts to X",
    "description": "Tick \"Also post to @totem on X\" on an anonymous post: a copy waits for a moderator, then a Totem account on X posts it, with no name on it.",
    "pitch": false,
    "status": { "public": "soon", "owner": "fixture" },
    "notes": {
      "public": "Not on the public site yet: copies to X are offered only on the test rig and the owner's service, on test data.",
      "owner": "Built on test data, tested on the laptop rig and deployed to this service on 2026-10-13: tick 'Also post to @totem on X' on an anonymous post and a copy waits for a moderator, then goes out through a test transport. Nothing has been posted to X. On this service the box shows only while anonymous posting is on, and once anonymous posting is armed for real posts it says copies to X run on test data only."
    },
    "missing": "A Totem account on X and X developer billing (about $0.015 a post, $0.20 with a link), on the owner's yes; then a real X transport and the owner's moderator key on the validator.",
    "sources": ["validator/xoutbox.js", "lib/zk/gate.ts requestXAnonPost", "lib/x/outbox/policy.ts", "components/XOutboxToggle.tsx", "app/(main)/settings/x-outbox/page.tsx", "scripts/unit-x-outbox.mjs", "scripts/accept-x-outbox.mjs", "validator/migrations.js migration 26 (x_outbox)", "SECURITY-POSTURE.md section 28", "research/plan-persona-launch-2026-10-10.md P8, O4"]
  },
  {
    "id": "connect-main",
    "name": "Connect your main Farcaster account",
    "description": "Post as the Farcaster account you already have, from inside Totem.",
    "pitch": true,
    "status": { "public": "fixture", "owner": "fixture" },
    "notes": {
      "public": "Deployed and switched on, the first real approval not done yet: Totem's app account (@ontotem) has been armed on the live site since 2026-11-05, but nobody has approved a real key or posted this way yet. Allow Totem to post as you. Your browser makes a posting key and keeps it in your vault, you approve it in the Farcaster app (a link on a phone, a QR code on a computer), and once Farcaster's network lists the key the Post box posts as your own account: \"Posts go to Farcaster as @you.\" Casts and deletes from the Post box; and, built on test data only and not deployed: replies, likes and recasts (and their undo) from the Farcaster cards in Following, threads and profiles, and acting as yourself (You in the account menu, so a visitor with personas can act as their own account; never both at once). Nothing goes out as you while a persona acts, or onto one of your personas' posts. No Neynar. The Farcaster app may ask you for a small network fee to add the key. Disconnect forgets the key here; removing it in the Farcaster app (Settings, Connected apps) is what stops it. Every test so far ran against local stand-ins of Farcaster.",
      "owner": "Built, test data only, and not turned on yet. You approve once in the Farcaster app by scanning a QR code, with no seed phrase. It needs a connector account first: a small Farcaster account of its own that nothing else uses. One command creates it for you without you ever handling a key (scripts\\owner\\arm-connector.ps1: the owner service makes and seals the keys, you send about 0.0005 ETH on Optimism to its address from an exchange withdrawal, type REGISTER, and may give it a neutral name). Neither the connector setup nor the connect flow has run against the real network. The guard that keeps your main account and your personas apart is built and already running: until main is connected it uses NEYNAR_VIEWER_FID, and with that unset a persona's replies, likes, recasts, follows and @mentions are refused."
    },
    "missing": "Running arm-connector.ps1 once on the private service (about $1 of ETH, your decision), then one live QR connect. On the public site: a first real approval and post (the app account is made and armed); the deploy of the card writes and of acting as yourself; the network fee paid by Totem instead of you (the app account signed up in the Farcaster app with 100 warps, then FC_APP_SPONSOR=on).",
    "sources": ["lib/fc/rootSigner/flow.ts", "lib/fc/rootSigner/store.ts", "lib/fc/hub/message.ts", "app/api/fc/root/route.ts", "components/root/RootPost.tsx", "validator/keyrequest.js", "validator/eip712.js", "scripts/unit-root-post.mjs", "validator/test/keyrequest.test.js", "scripts/owner/make-app-account.mjs", "scripts/owner/arm-app-account.ps1", "SECURITY-POSTURE.md section 35", "lib/fc/connect.ts", "app/api/fc/connect/route.ts", "lib/fc/connector.server.ts", "app/api/fc/connector/route.ts", "scripts/owner/arm-connector.ps1", "scripts/unit-connector.mjs (52 checks)", "components/settings/ConnectMainAccount.tsx", "lib/fc/writes.ts (connectedCreds, assertNoSelfLink)", "lib/fc/personaFid.ts (recordConnectedFid)", "scripts/accept-connect-main.mjs (written, not run)"]
  },
  {
    "id": "tiers",
    "name": "Reputation tiers",
    "description": "Levels you earn from activity. A higher reputation tier unlocks parts of the feed, checked with a membership proof. Not the same as a reach tier (an anon post's follower count) or a ring (people you pick).",
    "pitch": false,
    "status": { "public": "fixture", "owner": "fixture" },
    "notes": {
      "public": "The mechanics work on test data. Real Farcaster authors get no tier.",
      "owner": "The mechanics work on test data. Real Farcaster authors get no tier."
    },
    "missing": "The live proof mode with a real set of members, and activity the server checks: today a device reports its own activity, so a tier is self-reported.",
    "sources": ["docs/features/influence-and-search.md", "lib/zk/privacy.ts condition 7", "notes/reports/REPORT-MEGA.md KNOWN-BROKEN"]
  },
  {
    "id": "influence",
    "name": "Influence, stakes and the UBI allowance",
    "description": "An allowance you spend to lift posts, and stakes on what you think will matter.",
    "pitch": false,
    "status": { "public": "fixture", "owner": "fixture" },
    "notes": {
      "public": "Working mechanics on test data. No money is involved.",
      "owner": "Working mechanics on test data. No money is involved."
    },
    "missing": "Owner decisions on the curve and on payouts.",
    "sources": ["docs/features/influence-and-search.md", "docs/internal/needs-a-call.md item 1"]
  },
  {
    "id": "simulated",
    "name": "Chat, Spaces, Market and ads",
    "description": "Pay-to-DM chat, Spaces rooms, a market and an ad layer.",
    "pitch": false,
    "status": { "public": "fixture", "owner": "fixture" },
    "notes": {
      "public": "Simulated: no real messages, audio or money. Chat is not Farcaster direct messages.",
      "owner": "Simulated, as on the public site."
    },
    "missing": "Real rails for each one. The Dutch-auction ad marketplace is specified (docs/roadmap/ad-auction.md); its Phase 1 is the next row.",
    "sources": ["notes/reports/REPORT-B.md", "components/RoomStage.tsx", "docs/features/ad-market.md"]
  },
  {
    "id": "ads",
    "name": "Ads, Phase 1: house ads and an ad setting per mode",
    "description": "Ads in your real Following, picked on your device for the mode you're in: No ads, Generic ads only, or Matched to this mode, set per mode. Each says why it is there and can be hidden, with its advertiser.",
    "pitch": false,
    "status": { "public": "fixture", "owner": "na" },
    "notes": {
      "public": "Built, test data only, not deployed, and it ships switched off: no ad shows until the owner sets ADS=on on the public app. Once on: in the Following read from Farcaster's network, an ad at position 5 and then every 15th, never in a thread or in Event Safe Space. The only ad is the owner's house placeholder, from a reviewed, signed list the app ships. Your own modes start at Generic. Nobody pays, and there are no impression or click counts yet. Tested against local stand-ins of Farcaster.",
      "owner": "The private service runs the server-held shape, and these ads are placed by the visitor's own browser device, which it does not use. Its test-data market demo is the row above."
    },
    "missing": "A deploy, then the owner's house ad signed and ADS=on (notes/runbooks/OWNER-CHECKLIST.md, Ads). Then Phase 2 (lots on a descending clock, standing orders, the test ledger), Phase 3 (real money: your rail decision), Phase 4 (private measurement through the outside relay). For You gets the same ads once it reads from Farcaster's network.",
    "sources": ["docs/roadmap/ad-auction.md", "lib/ads/plan.ts", "lib/ads/lots.ts", "lib/ads/hides.ts", "public/ads/lots.json", "app/api/ads/route.ts", "components/ads/AdUnit.tsx", "lib/ads/switch.ts (ADS, dormant by default)", "scripts/unit-ads.mjs (12 checks, 39 mutations)", "scripts/accept-ads-prod.mjs (a dormant run and an ADS=on run)", "SECURITY-POSTURE.md section 41"]
  }
] /* @status-json:features:end */;

/** the legend entry for a status (every status in FEATURES is one of these; the accept script checks it) */
export function legendOf(id: StatusId): LegendEntry {
  const hit = LEGEND.find((l) => l.id === id);
  if (!hit) throw new Error("lib/status/features.ts: unknown status " + id);
  return hit;
}

export function surfaceOf(id: SurfaceId): SurfaceInfo {
  const hit = SURFACES.find((s) => s.id === id);
  if (!hit) throw new Error("lib/status/features.ts: unknown surface " + id);
  return hit;
}

/**
 * FEATURES grouped by their status on one surface, in LEGEND order; every feature lands in exactly one group, and a
 * group with no features is left out. Feature order inside a group is the file's order.
 */
export function groupByStatus(surface: SurfaceId): { legend: LegendEntry; features: Feature[] }[] {
  return LEGEND.map((legend) => ({ legend, features: FEATURES.filter((f) => f.status[surface] === legend.id) })).filter(
    (g) => g.features.length > 0
  );
}

export function featureById(id: string): Feature | undefined {
  return FEATURES.find((f) => f.id === id);
}
