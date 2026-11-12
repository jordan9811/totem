# Roadmap and board
<!-- uncited-ok: page, a status board; every claim it points at is made, and cited, on its own page, and every status comes from lib/status/features.ts or a feature page -->

Every part of Totem, sorted by how real it is today, and every open issue with what unblocks it. Last checked against the running sites on 2026-10-10, when both ran `fe780a2`; the statuses have not been re-checked there since. The persona launch pass is being built: its first wave (Sign in with Farcaster with Face ID first, Bring your X version 1, personas posting through the anon account) was deployed to both sites on 2026-10-11, on test data; its second wave (rings, reach tiers, and launch on a simulated registrar) was deployed to both sites on 2026-10-12, on test data, with nothing reaching Farcaster; its third wave (anonymous posting on the public preview, proved in your browser and staying inside the preview; and Totem on X, copies to X that wait for a moderator and go out through a test transport) was deployed to the owner's service on 2026-10-13 and comes to the public preview with the go-live build. The go-live build (2026-10-17) makes the public site the product: a guided start (Sign in with Farcaster, Face ID, your X, your first persona), live mode with no sample world, persona posts reaching Farcaster through a public @anon with reports, takedowns, a filter and terms, an anon page that also opens inside Farcaster as a Mini App, the browser prover's source code published, and rings that hide instead of delete. It is built and tested against stand-ins, not deployed yet, and every live piece is switched on only by the owner. A live registrar and live X posting for the owner's service were written and then parked. [Next: personas that launch](/roadmap/persona-launch) has the plan and its progress.

| | |
|---|---|
| 🟢 **Works live** | Runs on the deployed site named, and was checked there |
| 🔵 **Built, test data only** | Green tests, **never run against the real network or real people** |
| 🟡 **Designed** | Written down in detail. No code |
| ⚪ **Off on purpose** | Built and deployed, then switched off until the owner turns it on |
| 🟣 **Coming soon** | Part of the plan, not built yet |
| ➖ **Not offered here** | The site named does not offer it, by design |

🔵 is the word this project has overstated before, so it is deliberately the longest list.

---

## The pitch, and where it stands

The owner's pitch, one piece at a time. Every unbuilt piece is coming soon, whatever design exists for it.

| Piece | Today |
|---|---|
| Log in with your Farcaster | 🔵 Built, test data only, on the public preview, read-only: it shows which account is yours and does not save your identity. Deployed 2026-10-11, not yet used. 🔵 In the go-live build (not deployed): the first step of the guided start, and how you join the anonymous crowd. 🔵 Post as your own account (2026-11-05, not deployed): Allow Totem to post as you, a key in your vault approved in the Farcaster app, no Neynar ([Post as you](/mechanism/post-as-you)) |
| Log in with your X | 🟣 Coming later, only on the owner's yes: it needs a paid X developer app. 🔵 The guided start (go-live build, not deployed) brings the X account your Farcaster account verified, with no X login, and Bring your X uses the archive |
| Generate a passkey | 🔵 Deployed on the public preview, checked only on a local copy. Face ID first, with the 24 words under Advanced, deployed 2026-10-11 and not yet used there |
| Make your personas: a finsta, alts | 🟢 Works live, inside Totem |
| Link them securely, so no one sees the links, not even us | 🟣 Coming soon. The links are stored sealed today, but the server can still group personas by address and timing, and the label reads DEMO |
| Decide who sees which persona, Top 16 style | 🔵 Built, test data only, on both sites, deployed 2026-10-12 and not yet used: up to 16 rings, each seeing chosen personas at two depths, and a private link card for friends without Totem ([Who sees what](/features/who-sees-what)). On the public preview a ring can show which personas are you, but the deployed site has no anonymous posts yet for its deeper level (posting them from your browser is built, not deployed); on the owner's service a ring publishes to that service's own server, which no one else's device reads yet. One-to-one grants exist in code with no button |
| Unpicked people see your posts blanked as anon, or not at all | 🔵 Personas posting through @anon by default: built, test data only, on the owner's service. 🔵 Your rings seeing which persona wrote it: built, test data only, on a laptop copy of the owner's service, deployed 2026-10-12; on the public preview it waits for anonymous posting there to be deployed, and no test has yet shown it there. 🔵 "Not at all" is a private persona, built, test data only |
| An anoncast-style account on Farcaster | 🔵 Built, test data only, on the owner's service, as one of your personas, 4 posts per 6 hours; never posted for real. 🔵 On the public preview, built and not deployed yet: your browser makes the proof. 🔵 The public @anon (go-live build, not deployed): persona posts reach Farcaster from one shared account, only Farcaster-verified people in the crowd, with reports, takedowns, a filter and terms; switched on only by the owner, never posted for real. 🔵 Its own page, /anon, also a Farcaster Mini App |
| Reach from reputation, without your name | 🔵 Built, test data only, on the laptop rig, deployed 2026-10-12: an anon post from a 1k+, 10k+ or 100k+ account gets a labelled head start in For You, once 50 accounts are in its tier (none is, and none can be on the owner's one-person service). 🟣 Coming soon on the public preview, which needs an issuer Totem runs (the public site refuses to run one in your browser); anonymous posting from the browser proves only the plain crowd |
| Launch a persona when it is ready | 🔵 Built, test data only, on the laptop rig, against a SIMULATED registrar: nothing is created on Farcaster and nothing is spent. Deployed 2026-10-12, not yet used. 🟣 Coming soon on the public preview; a real registrar was written and parked on 2026-10-17 |

---

## 🟢 Works live

| Item | What was checked on the deployed site |
|---|---|
| **One private identity per browser** | Two browser profiles on the public preview got two separate roots |
| **Personas and posting inside Totem** | On the public preview a persona was created and a post went through, in the browser. A post lasts until you reload |
| **The landing page and the computed label** | The landing renders cold; the app boots in the browser and the banner shows a computed DEMO label |
| **The deployment's own guards** | Developer routes refused, an unsigned reputation event refused, signed health answers, the kill switch, a rollback, and the validator's data surviving a redeploy |
| **Feed controls** | Modes, rules, ranking lenses, delivery tiers and the reading knobs, mostly over preview posts |
| **Search** | Over what your browser holds |
| **These docs, at /docs on the app** | Live 2026-10-10 at `/docs` on the public preview (checked: the pages, the privacy section and this board answer; internal pages do not) and behind sign-in on the owner's service. Linked from the landing page, Help and the banner |

---

## 🔵 Built, test data only

| Item | What has never happened |
|---|---|
| **Saving: passkey, Keep in this browser, 24 words** | Never checked on the deployed public site. A synced passkey has never been moved between two real devices |
| **Face ID first: the save strip, the save card, the 24 words under Advanced** | Deployed on 2026-10-11 and never used there. Run only by the rig suite with a virtual authenticator |
| **Sign in with Farcaster, read-only, on the public preview** | Never met Farcaster's real sign-in relay or the real Optimism chain; deployed 2026-10-11 and never used there. The owner's first real sign-in flips it |
| **Post as you: your own Farcaster account from the Post box** | Not deployed. No real key request, approval or cast: tested only against local stand-ins of Farcaster's API and a Snapchain node. Needs Totem's app account made (about $0.22, paid from the @anonwire wallet) and armed on the public validator first |
| **Linking a second device, linking two identities** | Never run on the deployed site |
| **Grants, merged views, private personas** | No button in the app makes a grant, so they run only in tests and the demo data |
| **Rings (who sees which persona): up to 16, the sealed ring drop, a ring note on every anon post, the half-and-half picture** | Deployed 2026-10-12 and never used by a real person; tested only on a laptop copy of the owner's service and a local copy shaped like the public preview. No ring note has been on a real anonymous post. On the deployed public preview there are no anonymous posts to note yet, and no test has shown a ring member reading a note on one made there; rings made on the owner's service do not reach the public preview |
| **Show a persona to a friend: the private link card** | Deployed 2026-10-12; never opened by a real person, only by the test suites |
| **Reach tiers and the For You boost** | Deployed 2026-10-12, tested on the rig only: never read a real follower count, never issued a tier on a deployed service, no tier has 50 real accounts in it, and no boosted post exists anywhere. On the public preview the reach issuers refuse to run in your browser, so tiers there wait for an issuer Totem runs |
| **Launch a persona** | Only against a simulated registrar and chain, on the laptop rig: no account has been created on Farcaster, nothing has been spent and nothing has reached the real network. Deployed 2026-10-12, not yet used there. The live registrar, the key-registry read and the thin relay are not in the build (written and parked on 2026-10-17) |
| **ZK membership and the For You tier gate** | No live set of members: the public preview runs the test set-up, and the owner's live set has one member |
| **Reputation tiers** | Never fed by activity the server checks: a device reports its own reputation events |
| **Anonymous posts** | Never sent a real cast. The option to claim a post later has not finished its reviews |
| **Personas posting through @anon: 4 slots per person per window, the post mode, the daily cap** | Never posted for real; measured by the rig suites and the operator-view linkage test only |
| **The guided start and live mode on the public site (go-live build)** | Not deployed. Run only on a local production-shaped copy with live mode on, against a stand-in sign-in: nobody has signed in, saved or made a persona through it on the deployed site |
| **The public @anon: reports, the takedown queue, the filter, the terms (go-live build)** | Not deployed and never armed: no Neynar app or agent account exists for it, nothing has been relayed, reported or taken down, and no crowd of Farcaster-verified people exists. Tested only against a loopback stand-in for Neynar and a stand-in chain |
| **The anon page and the Farcaster Mini App (go-live build)** | Not deployed; the Mini App is not signed for any web address, and it has never opened inside Farcaster |
| **Anonymous posts from the public preview: the prover in your browser, the browser's anonymous channel** | Not deployed. Run only on a local production-shaped copy, against a throwaway validator whose crowd of 70 the test wrote into its database. Never on the deployed site, never with a real crowd, never a real proof from a stranger's browser (a deployed build has no proving files), never timed on a real phone (a throttled desktop stood in), and never anything sent to Farcaster |
| **Totem on X: copies of anonymous posts to X, moderated first, and the DM inbox's status in Settings** | Deployed to the owner's service on 2026-10-13 on test data, run only on the laptop rig: no Totem X account exists, the owner has moderated nothing, and nothing has ever reached X (the transport is a test one that writes a row). Real posting from the owner's service was written and parked on 2026-10-17. Not offered on the public preview |
| **The owner app's buttons reaching Farcaster** | Deployed to the owner service on 2026-10-10. No real post from the app is on record yet (it needs a persona with its own account), and undo on Farcaster is not wired |
| **Owner sign-in with Face ID / fingerprint** | Deployed to the owner service on 2026-10-10, not yet used there: checked by a node-only harness against a software authenticator |
| **Connect your main Farcaster account** | Never run against the real network, and not available until a connector account exists (the owner's call, about $1) |
| **The empty world on the owner's service** | Deployed on 2026-10-10: the service's boot log says the demo world is hidden (kept stored, not deleted). The owner has not looked yet |
| **Influence, stakes and the UBI allowance** | No money, and the curve waits for the owner's call |
| **Bring your X version 1: the archive read in your browser, saved in sealed pieces, the "From X" shelf** | Has only read a synthetic 3,000-post archive and a small fixture; never a real X archive. Deployed on 2026-10-11 and never used there |
| **Find your X follows on Farcaster** | Matched only against a local stand-in list: the real list (`VALIDATOR_X_INDEX`) has never been built |
| **"X @handle, verified on Farcaster"** | Never shown for a real account: it needs the list, and a persona with its own Farcaster account |
| **Saves over the limit refused out loud** | Fixed: a save over 256 KiB is refused with the namespace and its size, the validator answers in plain JSON, and big documents save in sealed pieces. Deployed on 2026-10-11; it has not yet met a real archive |
| **Post to X, sync from X** | On the test rig only: the composer's X option returns a made-up reference, and sync refuses to call itself live |
| **Curators, relationship history, your data backpack** | Only demo desks, demo people and test data |
| **Chat, Spaces, the market and ads** | Simulated: no real messages, audio or money |
| **Attestations and the onchain issuer** | Only test buckets; the issuer is the owner's own process |

---

## ⚪ Off on purpose

| Item | What turns it on |
|---|---|
| **Real Farcaster posts to read, on the public preview** | The owner adds a read key and an author list |
| **Persona Farcaster accounts, on the owner's service** | The owner runs the account step once per persona, about $0.35 to $0.90 each |
| **Command-line casts from the owner's service** | Switched on 2026-10-07; none from the deployed service is on record yet. Casts go out as the shared test account |

---

## 🟣 Coming soon

| Item | Note |
|---|---|
| **A grant button** | One-to-one grants exist in code with no button; the Top 16 is built as rings (above) |
| **Following your X people from Totem** | Designed: a follow queue, spread over days under the daily follow budget |
| **Reach tiers and launch on the public preview** | Reach tiers wait for an issuer Totem runs, because the public site refuses to run one in your browser, and are not offered to the browser prover; launch waits for the Totem registrar. Rings and their notes are built for the public preview on test data (above) |
| **Sign in with X** | Built on test data and dormant: it waits for the owner's X developer app (a public client, no secret) and the arm script. About $0.01 per sign-in under X's pay-per-use pricing, if X bills the profile read. See [Sign in with X](/mechanism/sign-in-with-x) |
| **Totem on X, on the public preview and for real** | Built on test data for the owner's shape (above); not offered on the public preview; for real it needs a Totem X account, X billing and a live X transport (written and parked on 2026-10-17) |
| **Links private even from us** | Needs a third-party network relay, a crowd of at least 50, and signing keys you hold yourself |
| **Paid X extras** | Posting to X, syncing bookmarks, logging in with X. Only on the owner's yes |

---

## ➖ Not offered here

| Item | Site | Why |
|---|---|---|
| Saving in a browser, linking a device | Owner's service | The server keeps the owner's identity |
| Persona Farcaster accounts, command-line casts | Public preview | Its configuration refuses the keys these need |
| Sign in with Farcaster | Owner's service | It connects a main account with a posting key instead |
| Post to X, sync from X | Public preview | It has no safe place to hold X tokens; the X option is listed on the test rig only |

---

## Open issues

### The owner app's buttons have not posted for real
The Post box, likes, recasts and follows go to Farcaster as a persona with its own account and say where each post went ("Posted to Farcaster as @name", "Saved in Totem only — why"). That build was deployed to the owner service on 2026-10-10; no persona there has its own account yet, so nothing has gone out. See [What reaches Farcaster](/start/farcaster).
**Unblocks:** a persona with its own account, and a first post from the app seen on farcaster.xyz.

### Connecting your main account needs a connector account
Farcaster records which app asked for every connection, so Totem needs a small account of its own, about $1. One command on the owner's laptop (arm-connector.ps1) has the owner service create, fund-check, register and name it, no key in the owner's hands; nothing has run live. See [Posting and Farcaster accounts](/features/network-identities).
**Unblocks:** the owner's yes, the script, and one live run.

### Large saves vanished without a word (fixed, deployed 2026-10-11)
A save over 256 KiB is refused out loud: the app names the namespace and its size, and the validator answers in plain JSON. Big documents (an X archive) save in sealed pieces. Every namespace was measured under the limit with headroom. See [Browser custody](/mechanism/custody#chunked-sealed-documents-and-the-body-limit).
**Unblocks:** nothing; deployed to both sites on 2026-10-11. It has not yet met a real archive.

### Posting as your own account needs Totem's app account
Allow Totem to post as you is built on test data (2026-11-05): a key in your vault, approved in the Farcaster app, no Neynar. Every key request names an app account, so Totem needs one: one owner script makes it (about $0.22, paid from the @anonwire wallet) and a second arms it on the public validator. Until a visitor's Farcaster app can be spared the network fee (the app account signed up in the Farcaster app with 100 warps), the Farcaster app may ask the visitor to pay it. See [Post as you](/mechanism/post-as-you).
**Unblocks:** `make-app-account.ps1`, `arm-app-account.ps1`, the deploy, and a first real approval and post.

### Sign in with Farcaster has not met the real relay
Built and checked against a fixture relay and chain, and a loopback stub of both. The verifier is stricter than Farcaster's reference library on purpose, so a real Farcaster app that differs would be refused. See [Sign in with Farcaster](/mechanism/sign-in-with-farcaster).
**Unblocks:** the owner's first real sign-in on the public preview (deployed there on 2026-10-11).

### Bring your X has not read a real archive
Only a synthetic archive so far. See [Bring your X](/start/bring-your-x).
**Unblocks:** the owner's X archive (requested from X, a day or more), imported on both sites through a reload and a restart.

### Find your people needs its list switched on
The validator builds the list of Farcaster-verified X accounts only with `VALIDATOR_X_INDEX=on`, off everywhere today; until then the panel says the list is not available. It reads a beta Farcaster endpoint nightly. See [Bring your X](/start/bring-your-x).
**Unblocks:** the owner's decision to switch it on, and the measured list size.

### The public @anon is built, not deployed or armed
In the go-live build your browser makes the proof and the public server relays the post from one shared @anon account; only Farcaster-verified people join the crowd, posting opens at 50 of them, and a new member's first post waits for the next 6-hour window. With no outside relay, the server sees each poster's internet address and browser, and Neynar reads every post. See [Anonymous posts](/features/anon-posting) and [The anon page](/features/anon-page).
**Unblocks:** the go-live deploy (with one check of the hosting edge's headers, or every browser post is refused); the owner's Neynar app and agent account, armed with one script; his yes on the terms; 50 people signing in; a first post seen on Farcaster.

### The browser prover is GPL-3.0 code the public site will distribute
`/device/prover.js` bundles snarkjs and other GPL-3.0 packages, so serving it is distribution under GPL-3.0. Its banner and license file ship with it; this repository has no public remote. See [Anonymous posts](/features/anon-posting).
**Unblocks:** the go-live build publishes the worker sources beside it (`/device/source/`) with the public deploy; Claude took the owner's go-ahead of 2026-10-17 as his yes to publishing them, and the owner can still say no (A-GPL-SOURCE-OFFER).

### Totem on X has no X account
Copies wait for a moderator and go out through a test transport; nothing reaches X. On the owner's service the box shows only while anonymous posting runs on test data. See [Totem on X](/features/layers-on-x).
**Unblocks:** a Totem X account and X developer billing (O4), a live X transport (written and parked on 2026-10-17, to revive), and the owner's moderator key on the validator.

### What a ring member can still learn
A member who reads two of your notes can count exactly how many times that persona's audience grew in between, in any ring, and see that someone was removed; and after a removal, a post from another of your devices can use the old key for up to about 25 minutes. The docs said less before the wave 3 review. See [Rings and ring notes](/mechanism/rings).
**Unblocks:** a code change with an owner: a key chain that steps on a schedule rather than on joins, and a revoke that reaches your other devices sooner. The Remove and Delete confirmations already say the window.

### Reputation is self-reported
A device posts its own reputation events, and the validator checks only that the device belongs to the root. A modified device can reach the top tier. See [ZK membership](/mechanism/zk-membership#tiers).
**Unblocks:** a validator that accepts only the stewardship event from devices, caps it at 10, and binds its source to the epoch.

### Device linking trusts the validator
The matching characters both screens show are 32 bits, and the validator that relays the link mints the code, so it can grind a match and receive every key. See [Browser custody](/mechanism/custody#linking-a-device).
**Unblocks:** a commit-then-reveal comparison string, or a longer one over values the relay does not choose.

### Persona accounts from the current wallet are siblings of the test account
The chain was read on 2026-10-07: the Neynar app wallet that registered the Totem-named test account also pre-registered, in the same minutes, the pool a persona account would be drawn from, so anyone reading the chain can group them. The signer-request account (6131) and the recovery address are shared by every Neynar-registered account and point at nobody. See [Linkage and disclosure](/mechanism/linkage-and-disclosure).
**Unblocks:** the owner's decision before the first account: accept it (a typed `SIBLINGS` in the account script), a fresh Neynar app and wallet (a typed `FRESH`), or one burner wallet per persona (not built). Launch, built on test data against a simulated registrar, uses a fresh Totem registrar wallet that creates every launched account directly instead ([Launching a persona](/features/launch); live, it needs the owner's O1).

### Nobody else can check a reveal
A single reveal of an anonymous post is signed with a key the persona's Farcaster account has not registered. Launch's batch reveal is signed by the key the launched account registers, so anyone can check it, but only on the simulated chain so far. See [Launch and the registrar](/mechanism/launch).
**Unblocks:** the live key-registry read (F25) and the live Totem registrar (O1); both were written and parked on 2026-10-17.

### The anon account has not posted for real
The runbook's section (f) and `arm-anon.ps1` now set everything in one run, behind a typed confirmation, with a cap of one post and their own kill switch; the path has run on test data only. See [The anon relay](/mechanism/anon-relay).
**Unblocks:** on the public site, the public @anon (above): a Neynar app that holds nothing else, its agent account and one script. On the private service, which is optional now: a third Neynar app with an agent account and one `-FirstCast` seen on the network. The reveal stays off until its three reviews and four clean sweeps.

### There is no button to make a grant
Grants, private audiences and the merged view exist in code, and the old Privacy & Disclosure pane decides only who may view stake history. Rings (built, test data only) cover the Top 16; a private persona's audience is still a grant. See [Who sees what](/features/who-sees-what).
**Unblocks:** a grant screen, and folding the old pane into grants.

### Rings made on the owner's service do not reach the public preview
The owner service publishes ring notes to its own validator, which devices on the public preview do not read. See [Rings and ring notes](/mechanism/rings).
**Unblocks:** the ring drop on the public validator, with the owner's device registered there (the next pass).

### Ring publishing shows the operator which device writes
Every ring write is signed by a registered device and padded to groups of 4, so the operator sees which device publishes, when and roughly how much, and keeps a record of which devices have. A ring member can also tag their own anonymous post as one of your personas for the rest of the ring. See [Rings and ring notes](/mechanism/rings).
**Unblocks:** writes authorized by a proof instead of a device signature, and notes only a ring member can verify (both a later version).

### Every device downloads the whole ring drop on every check
At the drop's cap of 4,096 rows that is about 34 MB a read; nobody has measured a real one. See [Rings and ring notes](/mechanism/rings).
**Unblocks:** a measurement under real use, then a smaller read if it is needed.

### Launch has no real registrar
Launch runs against a simulated registrar and chain; on the owner's live universe it says "Launch needs the Totem registrar, which isn't set up yet." See [Launch and the registrar](/mechanism/launch).
**Unblocks:** the owner's O1 (a fresh Totem registrar wallet with ETH on Optimism from an exchange withdrawal, a registrar app fid), the live Bundler call, the live key-registry read, the live name server, a live thin relay, and the add-key order on the real chain; a version for the owner's service was written and parked on 2026-10-17. A price per launch waits for prepaid credits.

### Reach tiers need real follower counts and a crowd
Built and tested on the laptop rig only; deployed 2026-10-12. On the public preview the reach issuers refuse to run in your browser, because there a visitor's own key could take the issuer's name and give itself any tier. See [Reach tiers](/mechanism/reach-tiers).
**Unblocks:** Neynar read credits for live follower counts (O3), an xAI key for X followers (O5), anonymous posting on the public preview and an issuer Totem runs for it, and 50 real accounts in a tier.

### Anonymous posting by strangers will draw abuse
An open anonymous account on Farcaster attracts spam, harassment and worse. The go-live build ships caps per person and per day, an automatic filter for the obvious, a Report button on every @anon post, a takedown queue for the owner (removed posts are deleted from Farcaster and hidden in Totem, the record kept) and a terms page; the filter is shallow by design and a takedown cannot recall copies. Farcaster's main app, under its new owner, may hide or label @anon. See [The anon relay](/mechanism/anon-relay).
**Unblocks:** the owner's yes on the terms and a person working the queue daily; a second moderator later.

### Neynar's future after the Farcaster sale
Network School bought Farcaster from Neynar on 2026-10-15/16 and has not said whether Neynar's developer service continues. The feed's real posts, the QR connect and persona posting run through Neynar. The public @anon has a path without it, the hub route: its own account made on the protocol and posts sent straight to a Farcaster hub (`FC_HUB_URL`). Built, on test data only: no real post has gone out that way yet.
**Unblocks:** Neynar's announcement, or a later pass that makes the other paths Neynar-optional (the persona's own keys, and reads and writes through a Farcaster hub).

### A phone cannot make a persona
The left menu, where Create persona lives, is hidden on phones, and the side drawer only switches personas. On the owner's service under the empty world, Settings › Account & Personas has a create form. The guided start (go-live build, not deployed) makes the first persona on any screen.
**Unblocks:** the go-live deploy for the first persona; a create button in the drawer or on the account page for later ones.

### Saving has not been checked on the deployed site
The passkey and 24-word checks ran on a local copy shaped like the public preview.
**Unblocks:** a passkey and 24-word check in the deployed smoke test.

### Passkeys are tied to today's web address
Moving the app to a custom domain would strand every passkey saved so far; the 24 words would still work. The Mini App's signature and Sign in with Farcaster's domain are tied to it too.
**Unblocks:** the owner choosing the app's address before strangers save: the first step of going live.

### The X importer was hidden, took no ZIP and could not hold a real archive (closed)
Bring your X version 1 is built on test data: Settings › Import from X takes the ZIP or its folder, and big archives save in sealed pieces. See [Bring your X](/features/interop).
**Unblocks:** nothing; the remaining step is the real-archive run above.
