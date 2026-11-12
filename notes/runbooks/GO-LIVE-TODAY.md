# GO LIVE: the steps to take Totem live for everyone

<!-- PUBLIC GO-LIVE (2026-10-17): THE go-live runbook. The owner's direction that day: "i want the app operational and
     to use it and onboard live: making my root/master by connecting Farcaster and X and then spinning up personas from
     there and having posts flow through to Farcaster through the anoncast clone, which can also be used natively on
     Farcaster ... with a click-through to the Totem client. Steps to go live, not owner-specific slop." So this file is
     the steps to take the PUBLIC SITE live for everyone; nothing here runs on the owner's private service. Every
     command, parameter, hidden-prompt label and typed word below was read from the script it names (scripts/owner/*.ps1),
     and scripts/unit-runbook.mjs holds them to the scripts, the pages to the app, and the shape to its promises. It names
     the site's Railway address on purpose: this file is never served (docs-guard keeps hosts off the docs). -->

Totem goes live on the public site. Anyone opens it, signs in with Farcaster (the X account they verified on Farcaster
comes along), saves with Face ID, makes personas and posts. Persona posts reach Farcaster through one shared account,
**@anon**. Farcaster people who skip the full app use the **anon page** (`/anon`), which also runs inside the
Farcaster app as a Mini App, with a button through to Totem.

These are the steps only you can take: the web address, the accounts and keys, the yes on the terms, and trying it.
Claude does the build and the deploys. Work down the list in order, one step at a time.

> **Neynar, honestly:** Network School bought Farcaster from Neynar on 2026-10-15/16 and has not said whether Neynar's
> developer service carries on (Neynar's "Create Agent" answers an error today). Step 3 no longer needs Neynar: the
> **hub route** makes @anon's own account on the Farcaster protocol and posts straight to a Farcaster hub
> (`FC_HUB_URL`). It is built and tested on test data only, until you see its first real post. Step 4 (the real posts
> in the feed) still reads through Neynar.

---

## Before you start (2 minutes, once)

- Open **Windows PowerShell** from the Start menu: a standalone window, not the Claude app's terminal, and no screen
  sharing. Then go to the project folder:
  ```
  cd "C:\Users\jorda\OneDrive\Documents\SOCIAL MEDIA"
  ```
- Add `-WhatIf` to any command below to see exactly what it would do. It changes nothing.
- Where a command or link says `https://<your domain>`, type your own domain from step 1 instead, for example
  `https://ontotem.com`, with no slash at the end (the scripts refuse one), and leave out the angle brackets.
- Running a script again is always safe: it skips what is already done and picks up where it stopped.
- Keys go only into a script's hidden prompt (nothing shows while you paste) or your password manager. Never into
  chat, a file or a screenshot. Only step 3 spends ETH: a little on Optimism for the @anon account, and the app account
  is paid from that same wallet. No other step needs ETH or a wallet.
- If a script stops, copy everything from the `STOPPED` line down and paste it to Claude. No script ever prints a key.

**The site's address**

| Until step 1 is done | After step 1 |
|---|---|
| https://app-production-15c4.up.railway.app | `https://<your domain>`: the address you buy in step 1. Use only this one from then on |

**At a glance**

| # | Step | Who | When | Your time | Cost |
|---|---|---|---|---|---|
| 1 | The web address | you, then Claude | first, before anyone saves a passkey | 15 min, then a wait | about $10 to $15 a year |
| 2 | The go-live deploy | Claude | after step 1 | none | Railway, a few cents an hour (already running) |
| 3 | The public @anon, then Totem's app account (post as you) | you | after "the go-live build is deployed" | 40 min | about $0.20 once (the account), about $0.22 once for the app account (from the same wallet), then $0 |
| 4 | Real Farcaster posts in the feed | you | after the deploy | 10 min | $0 on Neynar's free plan |
| 5 | The Farcaster Mini App | you | after the deploy | 10 min | $0 |
| 6 | Terms and takedowns | you | before step 3's first post | 15 min, then a few minutes a day | $0 |
| 7 | Later: X and launch | nobody yet | parked | none | none now |
| 8 | Try it, phone and laptop | you | after steps 3 to 6 | 20 min | $0 |
| 9 | Stop and undo | you | any time | | |

---

## 1. The web address

- **What it does:** gives Totem its permanent address. Face ID saves (passkeys), Sign in with Farcaster and the Mini
  App's signature are all tied to the address. Moving later would lock everyone out of what they saved, so this comes
  before anyone saves anything.
- **Link:** https://www.cloudflare.com/products/registrar/ (at-cost prices, and it can point the bare name at Railway).
  Any registrar works; https://www.namecheap.com is another.
- **Do:**
  1. Buy the domain. Short and plain is best, for example a name like `ontotem.com` (check what is free).
  2. Open the public project on Railway: https://railway.com/project/<railway-project-id>, click the
     **app** service, then **Settings**, then **Networking**, then **Custom Domain**. Type the domain. Railway shows the
     DNS record to add (a CNAME pointing at a railway.app address, and on some accounts a TXT record to prove the name
     is yours). If it asks for a port, pick the one it suggests.
  3. On your registrar's DNS page, add exactly the records Railway shows. On Cloudflare, set each one to **DNS only**
     (the grey cloud), not proxied: Railway makes the certificate itself, and Totem was tested behind Railway's edge
     only. Only the **app** gets the domain: leave the validator on its Railway address, with nothing in front of it
     (its anonymous route accepts only the headers Railway's own edge adds, and refuses every post otherwise).
  4. Wait until Railway shows the domain with a green check.
- **Command:** none.
- **You should see:** `https://<your domain>` opens the same Totem landing page as the Railway address, with the lock
  in the address bar. DNS usually takes minutes; allow up to an hour.
- **Time / cost:** 15 minutes, then the wait. About $10 to $15 a year for a .com or .xyz (some endings cost more).
- **Tell Claude:** "the domain is <name>, Railway shows it green". Claude then points the site at it in step 2. From
  then on, save your passkey only on your domain: one saved on the Railway address will not open there.

## 2. The go-live deploy (Claude's step)

- **What it does:** puts the go-live build on both public services (app and validator): the guided start at `/welcome`,
  the anon page at `/anon` and its Mini App manifest, the terms page and the takedown queue, the public @anon relay
  (switched off until step 3), and the browser prover's GPL source code at `/device/source/`. The site stops showing
  sample people and posts: it shows real Farcaster posts (after step 4), your personas' posts and @anon posts.
- **Link:** https://<your domain>/welcome once it is done.
- **Do:** nothing. Claude sets, on both public services, `PUBLIC_LIVE=true` (live mode: no demo world),
  `TRUST_PROXY=true` (behind Railway's edge), `ZK_ANON_POST_TREE=valid` (who can post anonymously) and
  `APP_URL=https://<your domain>`, builds the app with the pinned proving files it needs for real anonymous proofs
  (`REQUIRE_ZK_ARTIFACTS=1`, so a build without them fails, and `ZK_ARTIFACT_FETCH=1`, because an upload never carries
  those gitignored files: the build fetches them from the pinned host and keeps them only if they match their pins; both
  are set on the app BEFORE the deploy that builds), then deploys and runs the deployed checks. Recommended, and on unless you say no:
  `VALIDATOR_X_INDEX=on` on the validator, the list of Farcaster-verified X accounts. Without it the guided start cannot
  find the X account your Farcaster account verified (it says it "couldn't check here"), and "Find your people" stays
  off; with it, the validator reads Farcaster's public list once a night. Wait for Claude's message: **"the go-live
  build is deployed"**.
- **Command:** none.
- **You should see:** https://<your domain>/terms and https://<your domain>/anon open; the home feed has no sample
  people; the GPL source page at https://<your domain>/device/source/ lists the files the prover was built from.
- **Time / cost:** none of your time. Railway already bills a few cents an hour for the pair.
- **Tell Claude:** nothing, unless a page looks wrong. One choice is yours before this deploy: it publishes the browser
  prover's source code at `/device/source/` (decision J, the GPL's way of offering it). If you would rather keep a
  written offer instead, say so before Claude deploys.

## 3. The public @anon

After Claude says **the go-live build is deployed**. Read the terms first (step 6): arming opens anonymous posting to
strangers under those words.

- **What it does:** makes and switches on the one shared Farcaster account that every persona post, and every post from
  the anon page, goes out from. On the **hub route** (the one to use) the account is yours on the Farcaster protocol:
  its keys are made on your laptop, its signer key lives on the public validator only (the app server never holds it),
  and every post is signed there and sent straight to a Farcaster hub. No Neynar app, no Neynar key.
- **Link:** https://www.coinbase.com (to send a little ETH on the Optimism network), and https://<your domain>/settings/moderation
- **Do:**
  1. Make the account (once). Run the first command below. It makes two keys and saves them in
     `%USERPROFILE%\.totem-anon\anon-account.json`, outside the project folder, readable by you only. It never prints
     them: open that file and copy `custody.privateKey` and `signer.privateKey` into your password manager straight away.
     It asks for the username (1 to 16 of a-z, 0-9 and -, nothing that says the product's name: the script refuses
     one), a display name, a bio and a picture address (press Enter to leave one empty).
  2. It shows the cost, read live from Optimism: the registration with one storage unit (about $0.20 today) plus gas
     (well under a cent), in ETH and in dollars, and it refuses anything over $10 (`-CapUsd`). It prints the account's
     ADDRESS. In Coinbase: **Send**, **ETH**, network **Optimism** (not Ethereum, not Base), to that address, about
     0.002 ETH. The window waits until the ETH arrives (usually a minute or two).
  3. Type `CONFIRM`. It registers the account (its fid), adds its signer key, registers its username at the Farcaster
     name server and publishes the profile. If it stops halfway, run the same command again: it reads what is done and
     carries on, and it never sends a transaction twice. It ends with the fid and the next command.
  4. Make your saved identity and copy its moderator key, on the laptop. Open https://<your domain>/welcome, press
     **Sign in with Farcaster**, press **Skip for now** on the sign-in screen (you sign in during step 8, once
     @anon is on; signed in already? step 8 says how to sign in again), then, on Keep your account, press **Save with Face ID** (Windows Hello; **Save with a passkey** on a computer
     without it). The home feed opens and says "Saved. Your passkey opens this identity here.": the rest of the guided start is
     step 8. If the save also says "This passkey works on this device.", the passkey stays on this laptop, and in step 8
     you link the phone instead of unlocking it there. Then, in the same browser, open
     https://<your domain>/settings/moderation and copy the 64 characters after "moderator key (public, safe to share)".
     The key belongs to this saved identity, not to the laptop: every device that unlocks or links the identity shows the
     same key and can work the queue (step 6).
  5. Arm it: the second command, with the fid from 1 to 3, your moderator key and your domain. It reads the signer key
     from the saved file (or add `-SignerKeyPrompt` to paste it at the hidden prompt `Anon signer key`), checks on the
     hub that the key is a signer of exactly that fid, says what will change, and you type `ANON`. Then it sets the key
     (on the validator only), `ZK_ANON_TRANSPORT=hub` and `FC_HUB_URL`, and redeploys.

  The caps: 4 posts per person every 6 hours (built in), at most 500 a day for the whole site (`-DailyCap`), and 20 in
  total until you raise them (`-LifetimeCap`, set on the first run only).

  The older Neynar route (`-Transport neynar`, the default, needs a Neynar app's "Create Agent", which errors today):
  run the arm command without `-Transport hub`; it asks for the agent's signer UUID and key at hidden prompts
  (`Agent signer UUID`, then `Agent-only Neynar key`), and you type `THIRD` and `ANON`.
- **Command:**
  ```
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\owner\make-anon-account.ps1
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\owner\arm-public-anon.ps1 -Transport hub -AnonFid <the fid it printed> -ModeratorKey <your 64-character moderator key> -AppUrl https://<your domain>
  ```
  To look without changing anything: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\owner\arm-public-anon.ps1 -Status -AppUrl https://<your domain>`.
  To raise the lifetime cap later (only up; you type `RAISE`): `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\owner\arm-public-anon.ps1 -RaiseCap 200 -AppUrl https://<your domain>`.
- **You should see:** the first command ends with the fid, the username and the next command. The second checks the
  site first ("/terms answers 200", "the pinned proving files are shipped", "the fid gate is deployed and on", "the
  live crowd: ... of 50"), says "the signer key is an active signer of fid", sets the validator and the app, redeploys
  each once, and ends with "liveRelay true on the agent path; the relay is ready". `-Status` then says "transport hub".

  Honestly: posting opens for everyone once 50 people have joined by signing in with Farcaster on the site, and each
  person's first post waits for the next 6-hour window after they joined. The script prints the crowd count. Once it
  reaches 50, watch the first post: run the same command with `-FirstCast` instead of `-AnonFid` and `-ModeratorKey`
  (`powershell -NoProfile -ExecutionPolicy Bypass -File scripts\owner\arm-public-anon.ps1 -FirstCast -AppUrl https://<your domain>`),
  type `ANON`, then post from https://<your domain>/anon. The window prints "RELAYED by the public validator under fid"
  and, on the hub route, finds the post on the Farcaster protocol itself, within about 75 minutes. The Farcaster app may
  hide a new account for a while; the anon page and its share links show @anon's posts from the hub regardless.
- **Time / cost:** 30 minutes. About $0.20 once for the account (shown before anything is sent, refused over $10),
  from the ETH you send; nothing per post on the hub route.
- **Tell Claude:** "@anon armed on the hub route", the fid and username (never a key), and the crowd count it printed.

### Then: Allow Totem to post as you (Totem's app account)

After the @anon account above exists (its wallet pays), and after Claude deploys the build with "Allow Totem to post as
you" (built 2026-11-05, test data only).

- **What it does:** lets anyone signed in with Farcaster post as their OWN account from the Post box. Their browser
  makes the posting key and keeps it in their vault; they approve it in the Farcaster app. Every such approval names an
  app account, so Totem needs one of its own, and the Farcaster app's approval screen shows that account's profile:
  so the same run names it **@ontotem** ("Totem", bio "ontotem.com", the Totem picture), and approving reads as
  approving Totem rather than a number. Its custody key goes on the public validator only, where it signs key requests
  and nothing else. Its profile key (the one that published the name and picture) stays on your laptop: it can post as
  @ontotem and cannot touch any visitor. No Neynar.
- **Link:** https://<your domain>/settings/account (where "Post as you" shows after a sign-in)
- **Do:**
  0. Open https://ontotem.com/brand/totem.png in a browser first. If the Totem picture does not show, wait until it
     does (the account's picture is that link; until the file is live the profile shows no picture).
  1. Make the app account (once). Run the first command below. It makes TWO new keys, a custody key and a profile key,
     and saves them in `%USERPROFILE%\.totem-app\app-account.json`, outside the project folder, readable by you only.
     It never prints them: open that file and copy `custody.privateKey` and `profileKey.privateKey` into your password
     manager straight away.
  2. It checks that the name @ontotem is still free. If someone else took it, it stops there with nothing spent: tell
     Claude (or run it with `-NoProfile` for an account without a name).
  3. It shows the cost, read live from Optimism: one registration with one storage unit (0.0000826503 ETH, $0.20 on
     2026-11-05), plus gas for TWO transactions (the registration, and `KeyGateway.addFor` for the profile key: well
     under a cent each), about $0.22 at most, and refuses anything over $2 (`-CapUsd`). The @anonwire wallet pays (the
     file `%USERPROFILE%\.totem-anon\anon-account.json` from step 3, about 0.002 ETH in it): no new ETH, and no ETH
     moves between the wallets. It prints the payer's ADDRESS and balance, never a key.
  4. Type `CONFIRM`, once. It sends `IdGateway.registerFor` (the new fid to the new key) and then `KeyGateway.addFor`
     (the profile key to that fid), both paid by the @anonwire wallet; then, free, it registers @ontotem and publishes
     the name, "Totem", "ontotem.com" and the picture. If it stops halfway (a slow network, the Farcaster node catching
     up with the chain), run it again: it reads every step back first, never pays twice and never asks twice. It ends
     with the app fid, @ontotem and the next command.
  5. Arm it: the second command. It reads the fid and the CUSTODY key from the saved file (never the profile key; or
     `-KeyPrompt` with `-AppFid` asks for the key at the hidden prompt `App custody key`), checks that the key owns that
     fid on Optimism, says what will change, and you type `APP`. It sets `FC_APP_FID` and `FC_APP_CUSTODY_KEY` on the
     PUBLIC validator only (never on the app, which refuses the key at boot) and redeploys it once. A validator that
     already holds another app account needs `-Replace` (you type `REPLACE`).
  6. Try it: on https://<your domain>, signed in with Farcaster, press **Allow Totem to post as you**, approve in the
     Farcaster app (scan the QR code on the laptop, or open the link on the phone), wait for the Post box to say
     "Posting as @you", post one cast, and find it on farcaster.xyz. Note what the approval screen shows as the app's
     name (Totem / @ontotem, or a number) and tell Claude. The Farcaster app may ask you for a small network fee for
     adding the key.
- **Command:**
  ```
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\owner\make-app-account.ps1
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\owner\arm-app-account.ps1
  ```
  To look without changing anything: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\owner\arm-app-account.ps1 -Status`.
- **You should see:** the first command ends with "app fid", the custody address and `@ontotem ("Totem")`, then
  "NEXT:" and the arm command (with `-NoProfile`: "(no profile: --no-profile)"). The second ends with "the public
  validator signs key requests for fid" and that fid. On farcaster.xyz, @ontotem shows "Totem" and the picture. On the
  site, after the approval, the Post box says "Posting as @you" and, under it, "Posts go to Farcaster as @you."
- **Time / cost:** 10 minutes. About $0.22 once, from the @anonwire wallet. Optional, later: so visitors pay no network
  fee, sign the app account up in the Farcaster app with at least 100 warps, then tell Claude to set
  `FC_APP_SPONSOR=on` on the validator (Farcaster refuses the sponsorship before that).
- **Tell Claude:** "app account armed", the app fid (never a key), what the approval screen showed as the app's name,
  and whether your own approval and first cast worked.

## 4. Real Farcaster posts in the feed

After Claude says **the go-live build is deployed**.

- **What it does:** fills the public home feed with real Farcaster posts, read-only, through a second key that cannot
  post. In live mode there are no sample posts, so without this a new visitor's feed holds only personas' and @anon
  posts.
- **Link:** https://dev.neynar.com
- **Do:**
  1. At https://dev.neynar.com click **Create App** again: a second app, neutral name, **no agent, no wallet**. Copy its
     **API key**: this is the READ key. Save it in your password manager.
  2. Choose whose posts the feed shows: the suggested starter list (54 builders, artists and writers, checked on
     2026-09-27; to strike any, tell Claude before you run this), or a "house" Farcaster account whose follows are the
     list (you curate by following and unfollowing; it must already follow people).
  3. Run the command (with your domain: its own check reads the site there). Paste the READ key at the hidden prompt
     (`READ key`). Type `YES` to accept the list. After its own
     check passes it offers `RAISE`: type it to move the daily budget from 2,000 to 100,000 Neynar credits, after a look at
     the usage page on dev.neynar.com.
- **Command:**
  ```
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\owner\arm-live-reads.ps1 -Source list -FidsFromStarterList -AppUrl https://<your domain>
  ```
  With a house account instead: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\owner\arm-live-reads.ps1 -Source house -HouseUsername <its username> -AppUrl https://<your domain>`
- **You should see:** `relay status: armed=True, reason=armed`, then "deployed smoke passed with the relay armed". Reload
  https://<your domain>/home: real Farcaster posts in the feed.
- **Time / cost:** 10 minutes. $0 on Neynar's free plan: capped at 2,000 credits a day, then 100,000 after `RAISE`.
- **Tell Claude:** "reads armed". Claude then marks "Read real Farcaster posts" as working once you have seen them.

## 5. The Farcaster Mini App

After Claude says **the go-live build is deployed**, on your final domain (step 1).

- **What it does:** lets the anon page open inside the Farcaster app as the Mini App "Anon Wire", with a "Post
  anonymously" button on any cast that links it. Farcaster opens a Mini App only when its manifest is signed by a
  Farcaster account for the exact domain it is served on. The signature is public: it proves which account owns the
  Mini App and grants nothing.
- **Link:** https://farcaster.xyz/~/settings/developer-tools (Developer Mode), then the manifest tool,
  https://farcaster.xyz/~/developers/new
- **Do:**
  1. On a computer, sign in at https://farcaster.xyz with the account that will own the Mini App. Its name shows in
     public as the Mini App's maker inside Farcaster, so a Totem brand account is better than your personal one.
  2. Open https://farcaster.xyz/~/settings/developer-tools and turn on **Developer Mode**.
  3. Open https://farcaster.xyz/~/developers/new, enter your domain exactly as the site uses it (for example
     `ontotem.com`: no https://, no path, no www unless the site uses www), and sign. Approve on your phone if the
     Farcaster app asks.
  4. Press the tool's **Copy** button for the accountAssociation (it holds a header, a payload and a signature).
  5. Run the command. It checks the copied values, shows the account number and the domain they are for, and asks you
     to type `SIGN`. Without `-FromClipboard` it asks for the header, the payload and the signature one at a time
     (they are public, so they show as you paste them).
- **Command:**
  ```
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\owner\arm-miniapp.ps1 -FromClipboard
  ```
  To look without changing anything: add `-Status`.
- **You should see:** "the manifest is signed:" with your domain's manifest address, then
  https://<your domain>/.well-known/farcaster.json shows an "accountAssociation" block and the name "Anon Wire". A
  signature for another domain is refused before anything changes ("this signature is for ..., but the public site is
  ..."). In Farcaster's developer tools (https://farcaster.xyz/~/settings/developer-tools, Developer Mode on), the
  manifest audit for your domain should pass; the "Post anonymously" button itself is tried in step 8.
- **Time / cost:** 10 minutes, $0.
- **Tell Claude:** "mini app signed", and which account signed it.

## 6. Terms and takedowns

Read the terms before step 3's first post; work the queue from then on.

- **What it does:** the rules strangers post under, and who takes posts down. The site has a terms page and a takedown
  queue; you are the moderator.
- **Link:** https://<your domain>/terms and https://<your domain>/settings/moderation
- **Do:**
  1. Read https://<your domain>/terms ("Terms for anonymous posts": what anonymous posting is, what isn't allowed, the
     automatic filter, reporting, what is seen and kept). Tell Claude "terms approved", or what to change: nothing
     posts publicly for strangers until you have said yes.
  2. Choose a contact address for legal takedown requests (an email you read). The page says one "will be listed here
     before anonymous posting opens to everyone"; tell Claude the address and it goes on the page.
  3. Decide who works the queue. By default it is you. The moderator key you copied in step 3 belongs to your saved
     identity, so any device that holds that identity can open the queue: the laptop you saved it on, and the phone
     once you unlock or link it there (step 8). Check it at least once a day, and whenever a report comes in that you
     hear about.
  4. To work it: open https://<your domain>/settings/moderation, read each reported post and its reasons, and press
     **Remove** or **Keep**. **Remove** hides the post in Totem at once, deletes it from Farcaster through the @anon
     account, and keeps the record (hide, never delete). If Farcaster's delete cannot be confirmed after five tries, the
     queue says so instead of claiming it is gone. **Keep** dismisses the reports so far. Removed is final.
- **Command:** none.
- **You should see:** with your saved identity open, "Reported posts" and, at first, "No reported posts are waiting.";
  Remove asks "Remove it? It is hidden in Totem and deleted from Farcaster. This can't be undone on Farcaster." Removed
  posts stay listed for 7 days with where Farcaster's delete stands. In a browser holding any other identity: "You are
  not a moderator on this site."
- **Time / cost:** 15 minutes to read the terms; then a few minutes a day. $0.
- **Tell Claude:** "terms approved" (or the changes), the contact address, and who works the queue if it is not you.

## 7. Later: X and launch (parked)

Nothing to do now.

- **What it does:** two pieces were written for your private service and then parked when the go-live moved to the
  public site: real posting to @totem on X, and launching a persona into its own Farcaster account (the Totem
  registrar). Neither is in this build; both are kept to revive later.
- **Link:** none now. Later, X's developer portal: https://developer.x.com
- **Do:** nothing. When you want one back, tell Claude "revive X" or "revive launch": each gets reviewed again and its
  own step here. X needs an X account and an X developer app on pay per use (about $0.015 a post, $0.20 with a link).
  Launch needs ETH on Optimism for a Totem registrar wallet, and a way to charge per launch that does not tie the
  payer to the persona.
- **Command:** none.
- **You should see:** on the site, Launch says "Launch isn't on this site yet.", and Totem on X is not offered.
- **Time / cost:** none now.
- **Tell Claude:** nothing, until you want one back.

## 8. Try it, phone and laptop

After Claude says **the go-live build is deployed**, and after steps 3 to 6.

Three things to know first. **Sign in with Farcaster only after step 3:** the anonymous crowd counts sign-ins made once
@anon is on. If you signed in earlier anyway, open https://<your domain>/welcome#farcaster on the laptop: once @anon is
on, the card shows **Sign in again with Farcaster to join the anonymous crowd** after the who-sees-what sentence. Press
it, scan and approve with the same account. While the Post box says you are not in the crowd, it links to the same
place. **Your Farcaster account is one member of the crowd:**
signing in with it from a different identity (a fresh browser, the Mini App inside Farcaster, a phone that has not
unlocked or linked your saved identity) moves your membership there from the next 6-hour window. So sign in once, on
the laptop, and nowhere else. **One identity everywhere:** on another device, never press **Start fresh here**; it
makes a second identity.

- **What it does:** you as the first real user. A piece is marked "Works live" only once you have seen it work.
- **Link:** https://<your domain>/welcome and https://<your domain>/anon
- **Do:** on the laptop first, then the phone, then inside Farcaster.

  On the laptop, in the browser you saved your identity in (step 3):
  1. Open https://<your domain>: the landing says "One you. Many personas." Press **Sign in with Farcaster**.
     It opens at the guided start's first step, **Sign in with Farcaster** (https://<your domain>/welcome). If you
     made a persona in step 3, it goes to the home feed instead: open https://<your domain>/welcome#farcaster to sign
     in, then post (5 below).
  2. **Sign in with Farcaster:** press it, scan the QR code with your phone's camera and approve in the Farcaster app.
     The card shows your account, "that's me". Press **Continue**.
  3. **This is you:** your Farcaster picture, name and username, which you can change here. With "Find your people" on
     (step 2), your X account shows as "@you · Verified on your Farcaster account" with **Show**. Press **Continue**:
     the home feed opens, as your Farcaster account (you saved in step 3, so the save screen does not come up). The
     Post box says "Posting as @you" and offers **Allow Totem to post as you** (step 3's last part; until the app
     account is armed it says it isn't switched on on this site yet).
  4. **Make a persona,** on "Pick up where you left off" above the feed: a picture (**Another picture** to change
     it), a name, a handle, **Through @anon (the default)**, then **Create persona**: "Created @you. Posting as @you."
     The same card has your X archive (optional: ask X for it at https://x.com/settings/download_your_data and import it
     when the email comes).
  5. **Post** from the Post box. Under it, "Posts from @you go" says where. Honestly: your first real post can go out
     only once 50 Farcaster-verified people have signed in, and only from the 6-hour window after you joined. Until
     then the Post box says how many have joined and when you can post: invite people, and test everything else. Once
     it can post, the toast says "Sent to @anon. It appears on Farcaster within about 75 minutes, at a random moment, so
     its time doesn't point to you." Then look at @anon's profile on farcaster.xyz (the agent's username from step 3).

  On the phone, the same identity (never a new one):
  - **Unlock**, only if the passkey you saved in step 3 lives in a password manager that syncs to your phone (iCloud
    Keychain, Google Password Manager) and the save said only "Saved. Your passkey opens this identity here.": open
    https://<your domain>/welcome, press **I've used Totem before**, then **Unlock with a passkey**.
  - **Link** otherwise (a Windows Hello passkey stays on the laptop). On the phone open https://<your domain>/welcome,
    press **I've used Totem before**, then **Link a device instead**. On the page it opens, open **Advanced: the 24
    words, other devices, linked accounts** and, under Devices, press **Show a link code**: the phone shows a code and a
    fingerprint. On the laptop open https://<your domain>/device, open the same Advanced section, type both under "Add a
    device: enter the code and the fingerprint it shows" and press **Approve**. The phone says "Linked." Still on the
    phone's page, press **Keep in this browser** (same Advanced section), so opening another page does not lose it.
  - If the phone says "Nothing is saved under that passkey yet.", don't press **Start fresh here**: link instead. Don't
    sign in with Farcaster on the phone: your account already shows there.

  Then open https://<your domain>/anon on the phone: "Post on Farcaster with no name on it". It shows how many people
  have joined, your sign-in, the Post box and recent @anon posts with Report and Share. Its header says "Anonymous
  posts follow the terms and takedown policy." with the link to the terms. At the bottom, **Open Totem** takes you into
  the full app, still signed in.

  Inside Farcaster: in the Farcaster app, post a cast with the link https://<your domain>/anon. The cast shows a
  **Post anonymously** button; tap it and the Mini App "Anon Wire" opens inside Farcaster. Look, but don't sign in
  there with your own Farcaster account: the Mini App keeps its own storage, so a sign-in there makes a second identity
  and moves your place in the crowd to it. To try a post from inside Farcaster, use a second Farcaster account.
- **Command:** none.
- **You should see:** each screen above in order, and nothing from the old sample world (no made-up people or posts).
  Every @anon post has a Report button, and the anon page's header links https://<your domain>/terms. The Post box in
  Totem shows the same terms line only while anonymous posting is open to you, so not before 50 people have joined.
- **Time / cost:** 20 minutes, $0. Each relayed post costs 150 Neynar credits.
- **Tell Claude:** piece by piece, what worked and what did not: the sign-in, your X (the handle, or "couldn't check
  here"), the persona, what the Post box says about where the post goes, the phone (unlocked or linked), the anon page,
  the Mini App, and, once 50 people have joined, the first post on Farcaster. Only those you saw work move to "Works
  live".

## 9. Stop and undo

Every line is **PowerShell**, run from the project folder. Each script's `-Disarm` is safe to run twice.

| To stop or undo | Do this |
|---|---|
| The public @anon (posts still waiting for their slot are dropped and never sent; posts already on Farcaster stay, and **Remove** still deletes them there, since the key stays) | `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\owner\arm-public-anon.ps1 -Disarm -AppUrl https://<your domain>` |
| Real posts in the feed (the key stays) | `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\owner\arm-live-reads.ps1 -Disarm -AppUrl https://<your domain>` |
| Allow Totem to post as you (no new key requests; keys people already approved keep posting until each removes Totem in the Farcaster app's connected apps) | `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\owner\arm-app-account.ps1 -Disarm` |
| A leaked app account key | The custody key: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\owner\arm-app-account.ps1 -Disarm` first; then tell Claude: a new app account (`make-app-account.ps1` with a new state file) armed with `-Replace`. It cannot post as any visitor; as the account's owner it could post as @ontotem. The profile key (laptop only) can post as @ontotem and nothing else: tell Claude, who removes it on chain (`KeyRegistry.remove`; the profile goes with it) |
| The Mini App (the manifest goes back to unsigned) | `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\owner\arm-miniapp.ps1 -Disarm` |
| All anonymous posting on the site, at once | `railway variable set --project <railway-project-id> --environment production --service app ZK_ANON_POST=off` (redeploys by itself; every tab stops offering it, and posts already queued still go out unless you also disarm @anon) |
| Sign in with Farcaster on the site | `railway variable set --project <railway-project-id> --environment production --service app FC_SIWF=off` (redeploys by itself) |
| One post, now | https://<your domain>/settings/moderation, **Remove** |
| Live mode (the sample world comes back) | `railway variable delete --project <railway-project-id> --environment production --service app PUBLIC_LIVE`, the same with `--service validator`, then `railway redeploy --project <railway-project-id> --environment production --service app --yes` and the same for `--service validator` (a delete alone does not redeploy) |
| The whole site, for now | `railway variable set --project <railway-project-id> --environment production --service app LAYERS_MAINTENANCE=true` (a static "down for maintenance" page; clearing it needs a redeploy) |
| A leaked @anon signer key (hub route) | `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\owner\arm-public-anon.ps1 -Disarm -RevokeKey -AppUrl https://<your domain>` takes it off the validator (also `FC_ANON_SIGNER_KEY`); then tell Claude, to remove the key on chain from the account's custody key and add a new one |
| A leaked Neynar key | delete or rotate it at https://dev.neynar.com FIRST. The @anon key: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\owner\arm-public-anon.ps1 -Disarm -RevokeKey -AppUrl https://<your domain>` (also deletes the key and the signer from the validator, so removals wait until you arm again with a new key). The read key: `arm-live-reads.ps1 -Disarm` above |
| A lost or stolen device that holds your saved identity (it holds the moderator key too: the key belongs to the identity, so every device that opens it has the same one, and another device's key is that same key) | make a NEW saved identity in a browser that does not hold the old one (another browser, or a new browser profile): https://<your domain>/welcome, **Sign in with Farcaster**, skip the sign-in, **Save with Face ID**, then copy its key from https://<your domain>/settings/moderation. Set the list to that new key alone: `railway variable set --project <railway-project-id> --environment production --service validator ANON_MODERATORS=<the new identity's key>` (redeploys by itself; the old key stops working). Step 3's command with `-ModeratorKey` only adds a key, it never removes one |

**Don't**

- Don't paste keys into chat, a file or a screenshot.
- Don't save your passkey on the Railway address once your domain is live: it will not open on your domain.
- Don't reuse the @anon Neynar app for anything else, and don't put its key anywhere but the script's hidden prompt.
- Don't move or share `%USERPROFILE%\.totem-anon\anon-account.json`, and never copy it into the project folder: it holds
  the @anon account's keys (keep them in your password manager too).

The long references are `notes/runbooks/GO-LIVE-FARCASTER.md` (section (i) for the reads) and `SECURITY-POSTURE.md` §31 to §33 (what
each piece lets anyone learn).
