# OWNER CHECKLIST — turn both on

## Go-live (2026-10-17): work from `notes/runbooks/GO-LIVE-TODAY.md`

`notes/runbooks/GO-LIVE-TODAY.md` is the steps to take Totem live for everyone, on the public site. The owner redirected the go-live
on 2026-10-17: the public site is the product, and nothing below this section is the go-live path. In order:

- [ ] **1. The web address**: buy the domain and attach it to the public app on Railway, before anyone saves a passkey.
- [ ] **2. The go-live deploy**: Claude's step; wait for "the go-live build is deployed".
- [ ] **3. The public @anon**: a Neynar app that holds nothing else, Create Agent with a neutral profile, your saved
      identity on the laptop (Sign in with Farcaster skipped, Save with Face ID), its moderator key from Settings ›
      Moderation (the identity's key: every device that opens the identity has it), then `arm-public-anon.ps1`.
- [ ] **4. Real posts in the feed**: a second Neynar app's read key, then `arm-live-reads.ps1 -Source list -FidsFromStarterList -AppUrl https://<your domain>`.
      Once the Neynar switch is deployed (below), the key alone shows nothing: also set `FC_SOURCE_FORYOU=neynar` (and
      `FC_SOURCE_SEARCH=neynar` for search), only when you decide.
- [ ] **5. The Farcaster Mini App**: sign the manifest for the final domain in the Farcaster app's developer tools, then
      `arm-miniapp.ps1 -FromClipboard`.
- [ ] **6. Terms and takedowns**: read and approve https://<your domain>/terms; work https://<your domain>/settings/moderation.
- [ ] **7. Later**: @totem on X and launch are parked; nothing to do.
- [ ] **8. Try it** on a phone and a laptop: https://<your domain>/welcome and https://<your domain>/anon. Sign in with
      Farcaster once, on the laptop; the phone gets the same identity (Link a device instead, unless your passkey syncs
      to it), never Start fresh here. Tell Claude piece by piece what worked; only then does a status say "Works live".
- [ ] **9. Stop and undo**: each script's `-Disarm`, and the railway lines in `notes/runbooks/GO-LIVE-TODAY.md`.

## Sign in with X (built on test data 2026-11-06; waits for Claude's deploy, then for your X developer app)

"Continue with X" on the landing and on /welcome stays the disabled button marked Soon until these steps are done. The
mechanism, what each party sees and X's own documentation with dates: docs/mechanism/sign-in-with-x.md and
SECURITY-POSTURE.md §38. Nothing below posts anything on X.

- [ ] **X1. The deploy** that carries Sign in with X (Claude's step). Without it the arm script stops with "a build
      without GET /x/signin/config answers 404".
- [ ] **X2. The X developer account** (10 min, $0 to open): go to https://console.x.com and sign in with the X account
      that should own the app (yours, or a Totem account), accept the Developer Agreement and Policy, and describe the use
      case in plain words, for example: "Sign in with X for ontotem.com: people sign in with their X account to use
      it as their identity on Totem. We read only the signed-in user's own profile (id, name, username, picture,
      verified flags) with users.read and tweet.read, revoke the token immediately, store nothing else, post nothing and
      read no follows."
- [ ] **X3. The app** (5 min): create a project and an app named "Totem" (the name people see on X's consent page).
      Under **User authentication settings**, choose:
      - **App permissions:** Read (the least there is; Totem asks for `users.read tweet.read` only).
      - **Type of App:** **Single page App** (a PUBLIC client: PKCE only, NO client secret exists, so none can leak).
        A "Web App" works too but makes a secret you would then have to keep on the validator (`-Confidential` below).
      - **Callback URI / Redirect URL:** exactly `https://ontotem.com/welcome/x` (no trailing slash; X matches it
        character for character; add `https://www.ontotem.com/welcome/x` only if the site is ever served from www).
        Nothing else is needed: the stub's loopback address is for tests on the laptop and is never registered.
      - **Website URL:** `https://ontotem.com`; **Terms of service:** `https://ontotem.com/terms`; **Privacy policy:**
        `https://ontotem.com/docs/start/privacy-in-plain-words` (if the console asks for them).
      - **Request email from users:** off. Totem never asks for an email.
      Save, then open **Keys and tokens** and copy the **OAuth 2.0 Client ID** (public: it is in every sign-in link).
      A Web App also shows a Client Secret: copy it into your password manager, never into a file in the repo.
- [ ] **X4. Credits** (X bills per use; no subscription): X's API has no free tier for new developers (docs.x.com,
      2026-11-06). Each sign-in makes one `GET /2/users/me`, priced at $0.010 per user returned if X bills it (X's pricing
      page does not say either way, and forum answers disagree), and X counts each user once per UTC day. Buy the
      smallest credit pack the console offers (X adds $20 of free credits after the first purchase; credits expire after
      3 months) and set a spending limit. Totem reads no follows ($0.010 per account returned: off by decision).
- [ ] **X5. Arm it** (5 min, $0):

      powershell -NoProfile -ExecutionPolicy Bypass -File scripts\owner\arm-x-signin.ps1 -ClientId <the OAuth 2.0 Client ID>

      Try `-WhatIf` first: it prints every step and runs none. It puts `X_CLIENT_ID` on the public validator, redeploys
      it and waits for `GET /x/signin/config` to answer ready, then puts `X_CLIENT_ID` on the public app, redeploys it and
      waits for /welcome to carry the hint. You type **XSIGNIN** to confirm. A Web App: add `-Confidential` and paste the
      secret at the hidden prompt (it goes to the validator only, on stdin, read back without being shown).
- [ ] **X6. Try it** (2 min): open https://ontotem.com, press **Continue with X**, approve on X, check This is you shows
      your X name, username and picture, then Keep your account. Then **Connect Farcaster** from the home feed, if you
      like: the same identity shows both. Tell Claude what you saw; only then does the status say "Works live". If X
      answers 403 "client-not-enrolled", the app is not enrolled in pay-per-use yet (X4). From then on the deployed
      smoke runs with `EXPECT_X_SIGNIN=armed` (check 16 expects the real door, not Soon).
- [ ] **X7. Stop and undo:** `arm-x-signin.ps1 -Status` (read only) and `arm-x-signin.ps1 -Disarm` (the app first, so the
      button says Soon again, then the validator). `X_SIGNIN=off` on a service is the same switch without deleting
      anything. A leaked secret (Web App only): `-Disarm`, regenerate it in the console, arm again with `-Confidential`.

## Ads, Phase 1 (built on test data 2026-11-07; ships DORMANT; waits for Claude's deploy, then for you)

A deploy carries the house ads switched OFF: no ad shows on any feed, and Settings › Modes says "Ads aren't running on
Totem yet." beside each mode's ad setting. Nobody can buy a slot yet (that is Phase 2), so the only ad there is is yours,
the house placeholder in `public/ads/lots.json`. How it works and what each party sees: docs/features/ad-market.md and
SECURITY-POSTURE.md §41. Nothing below spends anything.

- [ ] **A1. The deploy** that carries Phase 1 (Claude's step). Ads stay off after it.
- [ ] **A2. Your house ad** (5 min): in `public/ads/lots.json`, edit the `advertiser` (name, handle) and the `creative`
      (`headline`, `body`, `url`: https only, `cta`) of BOTH lots (Following and For You) to your own project. That file is
      the only one you edit by hand.
- [ ] **A3. Review and sign it** (1 min, $0): `npm run ads:approve` shows each lot against the policy (no scams,
      unlicensed financial offers, political ads or adult content); then, the first time on your machine:

      npm run ads:approve -- --new-reviewer --yes

      It makes your reviewer key in `.keystore/ad-reviewer.json` (never committed: keep a copy in your password manager),
      pins its public half in `lib/ads/reviewers.json` and signs both lots. After that, each edit needs only
      `npm run ads:approve -- --yes`. An edited lot that is not signed again is simply not shown.
      `npm run ads:approve -- --check` exits 1 while any lot would not be shown.
- [ ] **A4. Deploy the signed list** (Claude's step, or yours): commit `public/ads/lots.json` and `lib/ads/reviewers.json`,
      then deploy the public app. Ads are still off.
- [ ] **A5. Turn ads on** (1 min, $0): `railway variable set --project <railway-project-id> --environment production --service app ADS=on`
      (redeploys by itself). Every tab is then handed `ADS=on`, and the house ad shows at position 5 and every 15th
      position of a signed-in visitor's Following, in modes whose ad setting is Generic or Matched (your own modes start
      at Generic; Event Safe Space never shows one).
- [ ] **A6. Try it** (2 min): sign in, open Following, check the ad at row 5 says "House ad" with your words, open "Why
      this ad?", hide it and Undo. Tell Claude what you saw; only then does the status say "Works live".
- [ ] **A7. Stop and undo:** `railway variable delete --project <railway-project-id> --environment production --service app ADS`,
      then `railway redeploy --project <railway-project-id> --environment production --service app --yes`
      (a delete alone does not redeploy). `ADS=off` is the same switch without deleting anything.

## Neynar as a switch (built on test data 2026-11-07; ships with Neynar OFF everywhere, $0; waits for your OK on the shape)

Each Farcaster surface reads from where you say, one variable each on the public `app` service: `FC_SOURCE_FOLLOWING`,
`FC_SOURCE_NOTIFICATIONS`, `FC_SOURCE_FORYOU`, `FC_SOURCE_SEARCH`, `FC_SOURCE_COUNTS`, `FC_SOURCE_CHANNELS`, each `network`
(Farcaster's own node: the default, and what unset means), `neynar` or `auto`. Settings › Developer on the site shows each
surface's source and why (read-only, for anyone). How it works and what each party sees: SECURITY-POSTURE.md §42.

What you can and cannot switch:
- **Following and notifications: never Neynar.** `neynar`/`auto` there is refused at boot ("would hand your account to
  Totem's server") and they stay on the network. The same for like and recast totals (`FC_SOURCE_COUNTS`): a count read
  would tell the server which posts are on your screen, so totals stay unavailable on network posts.
- **Search** (`FC_SOURCE_SEARCH=neynar`): the biggest gap. After the device's own results, posts and people via Neynar,
  labelled "Via Neynar". What a visitor types reaches Totem's server and Neynar; who they are does not.
- **For You** (`FC_SOURCE_FORYOU=neynar`): your curated author list via Neynar, for personas and signed-out visitors only;
  a signed-in root's own For You stays on the network.
- **Channels**: not built; the switch reads as off.
- `auto` is `neynar` for search and For You (the node cannot answer those reads at all) and refused for the rest.

What it costs: the code nothing. Neynar: its docs (read 2026-11-07) list a **Free** plan (10M credits a month, 600 requests
a minute per endpoint) and **Scale** at $249 a month for 60M; Starter and Growth are closed to new customers. Check
dev.neynar.com/pricing on the day. The relay caps itself at `FC_READ_DAILY_CREDITS` (default 100,000 a day, about 3M a
month, inside the Free plan). One search is about 50 credits (a people search 10, documented; a post search assumed 40
until measured), so the default day is about 1,400 searches with no other reads; For You's list is at most 14,400 a day.
Neynar's future is uncertain since the sale, so the plan below buys nothing until you decide.

- [ ] **N0. OK the shape** (this section, notes/runbooks/MORNING-NOV-7.md §6). Nothing runs before it.
- [ ] **N1. The deploy** that carries the switch (Claude's step). Every surface stays on the network after it: unset is
      network, and the read relay stays unarmed with no read key.
- [ ] **N2. When you decide to try search** (5 min, $0 on the Free plan): make a SECOND Neynar app with no signers (its key
      can then only read), and arm it with `arm-live-reads.ps1` as in go-live step 4 above (notes/runbooks/GO-LIVE-FARCASTER.md section
      (i): `NEYNAR_READ_API_KEY` through `--stdin`, and one curation source, `FC_READ_FIDS` or `FC_READ_HOUSE_FID`). Then
      switch search alone on:
      `railway variable set --project <railway-project-id> --environment production --service app FC_SOURCE_SEARCH=neynar`
      (redeploys by itself). An armed key alone switches nothing on.
- [ ] **N3. Try it** (2 min): search a word on the site; the "On Farcaster · Via Neynar" section comes after your device's
      results. Settings › Developer should say Search: Via Neynar. Tell Claude what you saw.
- [ ] **N4. Later, if you want it:** `FC_SOURCE_FORYOU=neynar` the same way (personas and signed-out visitors get your list).
- [ ] **N5. Stop and undo:** `railway variable delete --project <railway-project-id> --environment production --service app FC_SOURCE_SEARCH`,
      then `railway redeploy --project <railway-project-id> --environment production --service app --yes`.
      `FC_READ=off` stops every Neynar read at once and keeps the key.

## The private service (not the go-live path)

> Everything below is the earlier checklist for the owner's private service, kept for reference; the service stays an
> optional sandbox. Its step 3 (persona accounts) stays parked.

The commands and what each asks of you are in **`notes/runbooks/GO-LIVE-MORNING.md`**. The full manual reference is
`notes/runbooks/GO-LIVE-FARCASTER.md` (GL). **[$]** spends money · **[S]** a secret · **[P]** publishes on Farcaster.

Already done for you: the owner service is standing on Railway (project `layers-owner`, validator running on the
private network, app built and waiting for its passphrase); the public site runs the live-read relay, switched off
until step 5. Nothing below is called live until you have seen it on the deployed service.

- [ ] **0. Two decisions** (nothing to run): the registrant question (do NOT create a persona account before you have
      decided it: accounts from the current Neynar wallet are public siblings of the test account), and whether you
      want a connector account (~$1; one command, `scripts\owner\arm-connector.ps1`, no key in your hands) for the QR "Connect your Farcaster account". `notes/runbooks/GO-LIVE-MORNING.md` step 0.
- [ ] **Sign in with Farcaster on the public site** (a decision, nothing to run): it is ON by default, and the landing
      then says "Have a Farcaster account? You can sign in with it inside the app". It has only run against test
      stand-ins so far. To keep it off until you have done one real sign-in yourself, set `FC_SIWF=off` on the public
      service (a Railway variable, then a restart): the landing sentence disappears and Your device says it is switched off.
- [ ] **Before you start** (5 min): dev.neynar.com — note your plan and usage, and the App Wallet's ETH balance on
      Optimism (about $0.90 per persona account you will create). Use a standalone Windows PowerShell window.
- [ ] **1. [S] Owner service** (~10 min): `arm-owner-service.ps1 -ViewerFid <your main account's fid>`. First run stops
      once at the custody-key check; paste the lines it prints, run again. Save the passphrase it generates; type `PAPER`
      and write the 24 words.
- [ ] **2. [S] Sign in once on each device** at the owner app's `/home` (the script prints the address) with the
      passphrase, then tap **Add Face ID / fingerprint for this device** — one tap from then on, 30 days at a time.
      Lost a device later: Settings › Security › **Lost this device?**
- [ ] **3. [$] [P] One Farcaster account per persona** (~$0.35–$0.90 each, hours apart): with no persona yet, create one
      in Settings › Account & Personas first; fork it into a PUBLIC persona at `/settings/identity/fork`, then
      `acquire-fid.ps1 -PersonaId p_...`; type `SIBLINGS` (or `FRESH` with `-WalletId`, step 0), then `SPEND`, then
      `YES` to disarm.
- [ ] **4. [P] First cast** from each persona: from the app's Post box once the morning deploy is up (the line under the
      box must say `Posts to Farcaster as @name — public`; the toast then says `Posted to Farcaster as @name`), or GL (e)
      by hand. Tell Claude when it is on farcaster.xyz.
- [ ] **5. [S] Public live reads** (~15 min, $0 on Neynar Free): create a SECOND Neynar app (no signers, no wallet),
      then `arm-live-reads.ps1` with ONE source:
      - `-Source list -FidsFromStarterList` — the 54 suggested accounts in `docs/internal/fc-read-starter-authors.md`
        (strike any you don't want first), or `-Fids "1,2,3"`;
      - `-Source house -HouseUsername <account>` — a house account whose follows are the list (follow them first).
      Type `YES`, then `RAISE` after the smoke passes and a look at the usage page. Tell Claude it's armed.
- [ ] **6. [S] [P] The anon account** (optional, 150 credits a cast on Neynar Free, one post until you raise the cap; on
      your private service it is an extra account with no name on it, not a crowd): a THIRD Neynar app, "Create Agent"
      in it, then `arm-anon.ps1 -AnonFid <fid>`, type `THIRD` then `ANON`, wait up to 6 h, then
      `-FirstCast -CastText "..."`: `notes/runbooks/GO-LIVE-MORNING.md` step 6.

## Persona launch pass, wave 1 (built on test data 2026-10-10; each step waits for Claude's next deploy unless it says otherwise)

- [ ] **A. Request your X archive now** (5 min, $0; it takes X a day or more): on X, Settings → Your account →
      Download an archive of your data, <https://x.com/settings/download_your_data>. Keep the ZIP; do not unzip it unless
      it is over 4 GB. Nothing else to do until it arrives.
- [ ] **B. Decide the app's web address before strangers save passkeys** (a decision, nothing to run): a passkey is
      tied to the address that saved it, so moving the public site to a custom domain later strands every passkey saved
      on the Railway address (the 24 words still work). About $10 to $15 a year for a domain. Tell Claude "keep the
      Railway address" or the domain you want.
- [ ] **C. First real Sign in with Farcaster** (5 min, $0; after the deploy that carries it):
      1. On your phone or laptop, open the PUBLIC site's `/device` page and press **Sign in with Farcaster**.
      2. Scan the QR with the Farcaster app (or tap "Open the Farcaster app" on the phone) and approve.
      3. The card should then say **"@you · that's me"**.
      4. Tell Claude (a) the host of the link the QR opened (it starts `https://` and names a farcaster or warpcast
         address) and (b) whether it worked, so the status row flips to "Works live".
      5. If it fails, set `FC_SIWF=off` on the public `app` service to hide the card; no rebuild is needed.
- [ ] **D. Switch on "Find your people" when you want it** (a decision; $0, no key): set `VALIDATOR_X_INDEX=on` on the
      owner validator (and on the public `validator` if you choose) and redeploy it. The first build starts 60 s after
      boot, takes about 3.5 min and about 45 MB of transfer; read `GET <validator>/x/fc-index/meta` for its rows and
      size. It crawls `api.farcaster.xyz`, a beta endpoint with no stated terms (SECURITY-POSTURE.md §22).
- [ ] **E. The closing run with your real X archive** (20 min, after A and the deploy): Settings → Import from X on
      BOTH sites, drop the ZIP in, import into the persona you mean to be your X self, then reload the page and ask
      Claude to restart the services, and check the shelf is still there. The statuses flip only after this.
- [ ] **F. Anon, if you arm it** (`notes/runbooks/GO-LIVE-MORNING.md` step 6): `-FirstCast` now posts AS the owner service's current
      persona, so you need at least one persona that is not set to "Totem only". With none, the app answers 409 "No
      persona yet — create one in Settings › Account & Personas first." The lifetime cap stays 1 and `-RaiseCap` is
      unchanged.

## Persona launch pass, wave 2 (built on test data 2026-10-12 and deployed to both sites that day; nothing to run, nothing to spend, none of it used yet)

- [ ] **G. Rings** (nothing to run): Settings › Rings arrives with Claude's next deploy, on test data. On your private
      service a ring publishes to that service's OWN validator, so people on the public site cannot read it yet; that
      move is the next pass (SECURITY-POSTURE.md §24, A-RING-OWNER-SERVICE-DROP). Hand a ring address over Signal or in
      person, never in a public post.
- [ ] **H. Reach tiers** (a later decision, O3 and O5; nothing to run): a live `fc.reach` (your main account's
      followers, entry at a Neynar score of 0.7) needs `ATTEST_FID_SOURCE=live` and read credits on the
      `NEYNAR_API_KEY` plan (O3); `x.reach` needs an xAI key (O5). Neither is asked for now. With one owner no tier
      reaches its crowd of 50, so your private service never offers one (§25). The statuses stay "test data only" until
      you have seen a tier work on a deployed site.
- [ ] **I. [$] Launch needs the Totem registrar** (O1; a decision, nothing to run): launch runs on a SIMULATED
      registrar (`validator/registrar.js`, `validator/simchain.js`), and on your service's live universe it refuses
      with "Launch needs the Totem registrar, which isn't set up yet." Going live needs a fresh Totem registrar wallet
      with ETH on Optimism from an exchange withdrawal (never the Neynar App Wallet), a registrar app fid that is never
      the connector, anon or test fid, the live Bundler call, the live KeyRegistry read (F25), the live fname server and
      a live thin relay: about $0.20 of storage per account plus a few cents of gas. `LAYERS_REGISTRAR_PRIVATE_KEY` is in
      MUST_NOT_SHIP on both halves and nothing reads it this wave: do not set it anywhere. A price per launch (about
      $5, prepaid credits that do not tie the payer to the persona) is a later pass. GL (j), §26.

## Persona launch pass, wave 3 (built on test data 2026-10-13; not deployed yet; each step waits for Claude's next deploy)

- [x] **J. The GPL-3.0 source offer: decided (publish, 2026-10-17); nothing to run, the go-live deploy serves the source at
      `/device/source/`.** The earlier wording, for reference: (a decision, nothing to run; before strangers rely on the public site): the
      public site will serve `/device/prover.js`, the browser prover, which carries snarkjs and other GPL-3.0 code, so
      that file is distributed under GPL-3.0. This repository has no public remote, so either publish the worker
      sources the file names in its first lines, or keep a written offer of the corresponding source. Tell Claude which
      (A-GPL-SOURCE-OFFER; GL (k); SECURITY-POSTURE.md §5).
- [ ] **K. Try anonymous posting on the public site** (5 min, $0; after the deploy that carries it): open the public
      site, make a persona, tick **Post anonymously** and post. If the composer says "Anonymous posting on this preview
      is open only to people already in the anonymous crowd, and you can't join it from here yet.", that is the honest
      answer for a new identity: tell Claude, who can say how big the test crowd is. A post
      is proved at the tab's next background check (about every 10 minutes) and sent after a random wait of up to 15
      more, so keep the tab open; it then shows "Preview only · not on Farcaster" on its card and is never posted to
      Farcaster. Tell Claude what you saw, so the status row can flip. Kill switch: `ZK_ANON_POST=off` on the public
      `app` service.
- [ ] **L. Totem on X** (nothing to run or spend; test data only, tested on the laptop rig): with **Post anonymously**
      ticked on test data, the composer offers "Also post to @totem on X — test data: nothing reaches X". A copy waits
      for a moderator; nothing is ever posted to X (there is no live transport). On your private service the box shows
      only while anonymous posting is on and runs on test data: today anonymous posting there is off until you arm it
      (step 6), and armed it runs on the live universe, where the box says copies to X run on test data only. So there
      is nothing to try there yet. Settings › Totem on X shows this device's moderator key, the key that would go into
      `X_OUTBOX_MODERATORS`. Going live needs a Totem account on X and X developer billing (O4), later: GL (k), §28.
- [ ] **M. The DM inbox says what it is** (nothing to run): Settings lists "DM a tweet to @totem to save it (test data:
      no DM is read from X yet)." It reads X only once an X account and its read token exist (O4).

**Stop / undo:** `notes/runbooks/GO-LIVE-MORNING.md`, "Stop or undo". **If anything fails:** paste from the `STOPPED` line down to
Claude — never a window that showed the 24 words.
