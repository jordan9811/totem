# Next: personas that launch

🔵 **Being built. Waves 1 and 2 are built and deployed, test data only; wave 3 is on the owner's service and comes to the public site with the go-live build; the go-live build, which makes the public site the product, is built and tested against stand-ins and not deployed yet.** Wave 1 was deployed on 2026-10-11, wave 2 on 2026-10-12 and wave 3 to the owner's service on 2026-10-13; none has been used there yet. Nothing on this page has run for real. The owner confirmed the eight decisions at the bottom on 2026-10-10. [Progress](#progress) says what is built; the [board](/roadmap/) shows what runs today.

## Progress

### Wave 1: deployed 2026-10-11, test data only

Wave 1 (sign in with Farcaster, saving with a passkey first, Bring your X, personas posting through the anon account) was built on 2026-10-10 and deployed to both sites on 2026-10-11, on test data. Nobody has used it there yet: each piece is called live only once the owner has seen it work on a deployed site.

| Step | What is built | What has not happened yet |
|---|---|---|
| 1. Honest status rows and copy | The status rows for every piece of this pass, these pages, the Help page and the security notes for each new piece | Nothing to run: this is words |
| 2. Sign in with Farcaster, passkey first | Your browser checks a Farcaster sign-in by itself and adds your account read-only, marked "that's me"; Face ID is the first way to save, and the 24 words sit under Advanced | A sign-in against Farcaster's real sign-in relay and the real blockchain; the owner's first sign-in on the deployed site |
| 3. Root from your X archive | Drop in the ZIP or its folder; your browser reads it; posts, follows, likes and ad interests saved in sealed pieces; a keyless list of Farcaster-verified X accounts to match against on your device; the "verified on Farcaster" badge | A real X archive; the list built for real (it is off until the owner switches it on); following matches from Totem (a later wave) |
| 4. Personas posting through the anon account | Each anon post is made as one of your personas; a new persona posts through @anon by default; 4 posts per person every 6 hours, shared across personas, each in its own slot; batches every 30 minutes on the public site; a cap of 500 a day | A real anon cast; anon posting on the public preview (step 8) |

What wave 1 found and states plainly: the slot number travels with each post, so two posts in the same slot are known to be two people, and two in different slots are about 1.33 times likelier to be one person; the sign-in relay's username and picture are its word, not proven; and the operator can see that you imported an X archive and roughly how big it is. {cite: SECURITY-POSTURE.md > "21. Sign in with Farcaster on the public site: what the relay, the chain node, the server and the validator learn"} {cite: SECURITY-POSTURE.md > "22. Bring your X (Persona launch P2): what the validator, the index source and the network learn from an archive import"} {cite: SECURITY-POSTURE.md > "23. Persona-scoped anon posting (Persona launch P3): K posts per person per window, and what the slot index still says"}

### Wave 2: deployed 2026-10-12, test data only

Rings, reach tiers and launch on a simulated registrar were built on test data at $0, passed their full sweep, and were deployed to both sites on 2026-10-12, on test data: the registrar is simulated, a launch spends nothing, and nothing reaches the real network. Nobody has used any of it there yet. On the public preview a ring works as a list of which personas are you; ring notes, reach tiers and launch wait there for anonymous posting (wave 3), and reach tiers also for an issuer Totem runs, because the public site refuses to run one in your browser (it would let a visitor give themselves any tier).

| Step | What is built | What has not happened yet |
|---|---|---|
| 5. Rings and the half-and-half picture | Up to 16 rings, each sharing chosen public personas at two depths (that it is you, or also which anonymous posts it wrote); a sealed 256-byte ring note on every anon post, real or random, bound into the proof; your device publishes sealed notes, signed by the device and padded to groups of 4, to a shared mailbox every device reads whole; the half-and-half avatar (your face left, the persona right); the `/d` link card for friends without Totem. Rig and production-shape suites written and passing | A ring used on a deployed site; a ring note on a real anon post; rings made on the owner's service reaching people on the public preview (the mailbox must move to the public server, the next seam) |
| 6. Reach tiers and the For You boost | 1k+, 10k+ and 100k+ Farcaster followers of your main account (a Neynar score of 0.7 to enter), nested; a tier offered, proved into, accepted and labelled only while 50 accounts are in it; the composer defaults to the highest tier offered; the label "posted by an account with 10k+ followers" wherever the card shows, and a head start of 1 to 4 hours in For You only. X followers as test data only | A real follower count read; a tier issued on a deployed service; a tier with 50 real accounts; a boosted post anywhere; on the public preview, an issuer Totem runs |
| 7. Launch, on a simulated registrar | The preview of every post it links and what that narrows, the typed confirmation, the anonymous launch request, a simulated Totem registrar (the account 2 to 48 hours later at a random time, one $0 spend row per batch that registered an account), one batch reveal anyone can check against the account's registered key, the proof page, the launch post with up to 10 quotes, and the required choice of where its posts go next | An account created on Farcaster; a cent spent; a live registrar, key-registry read or thin relay |

What wave 2 found and states plainly: a ring member can tag their own anonymous post as yours for the rest of the ring, and the server sees which device publishes ring notes; a boosted post hides only among its tier's accounts, and the issuer knows who is in each tier; a launch shows which 6-hour windows the persona used, and a quiet week's batch can hold one launch. {cite: SECURITY-POSTURE.md > "24. Rings and ring notes (Persona launch P4): what the drop, the operator and a member learn"} {cite: SECURITY-POSTURE.md > "25. Reach tiers (Persona launch P5): what a boosted anon post says, and the crowd floor"} {cite: SECURITY-POSTURE.md > "26. Launch (Persona launch P6): a persona's own account, on test data"}

### Wave 3: built 2026-10-13, test data only, on the owner's service

Anonymous posting on the public preview and Totem on X were built on test data at $0 and deployed to the owner's service on 2026-10-13; the public site gets them with the go-live build. Nothing in them reaches Farcaster or X, and nobody has used either.

| Step | What is built | What has not happened yet |
|---|---|---|
| 8. Anonymous posting on the public preview | Your browser makes the proof itself, in a background worker (`/device/prover.js`), and sends it over its own anonymous channel: one request of a fixed size, no cookie, no referrer, direct today and ready for an outside relay. The posts are test data: they stay inside the preview and every card says "Preview only · not on Farcaster". A new identity first heard "Anonymous posting on this preview is open only to people already in the anonymous crowd, and you can't join it from here yet."; the go-live build lets it join and says when it can post. One switch decides it for the whole site, and the public site no longer depends on a server setting. Strangers prove the plain crowd only: no reach tiers in the browser. Phone proving time measured on a throttled stand-in {cite: SECURITY-POSTURE.md > "27. Anonymous posting from the public site (Persona launch P7): the prover in your browser, the web channel, and what the operator sees"} | A deploy; a real crowd; a real proof from a stranger's browser (a deployed build has no proving files); a real phone; anything sent to Farcaster from the public preview (that needs a public @anon) |
| 9. Totem on X | "Also post to @totem on X" under an anonymous post: a copy proved with its own slot (one per person every 6 hours), a queue that waits for a moderator before anything posts, X's rules for a shared account (no @mentions, one link, an article as a short quote and its link), an hourly slot through a test transport, Settings › Totem on X, and the DM inbox said plainly: "DM a tweet to @totem to save it (test data: no DM is read from X yet)." | A Totem X account; X billing; a live X transport; a copy the owner moderated; anything posted to X. Not offered on the public preview |

What wave 3 found and states plainly: with no outside relay, the server sees each anonymous post's internet address and browser; a post still waiting for its proof dies with the tab; the public site will distribute GPL-3.0 code, which needs the owner's source offer (resolved by the go-live build: the source is served at `/device/source/`); a copy to X has the same words as its anonymous post, so the two can be paired, and the moderator reads every copy. Its review of the rings corrected two earlier claims: a ring member can count exactly how many people joined between two notes, and a removal takes up to about 25 minutes to reach your other devices. {cite: SECURITY-POSTURE.md > "27. Anonymous posting from the public site (Persona launch P7): the prover in your browser, the web channel, and what the operator sees"} {cite: SECURITY-POSTURE.md > "28. The @layers X outbox (Persona launch P8): anonymous copies to X, moderated first, on a test transport"} {cite: SECURITY-POSTURE.md > "24. Rings and ring notes (Persona launch P4): what the drop, the operator and a member learn"}

### The go-live build: the public site is the product (built 2026-10-17, not deployed yet)

On 2026-10-17 the owner set the direction: the public site is where people sign in, make personas and post, and their persona posts reach Farcaster through a public @anon, with a page of its own for Farcaster people. Nothing new is built for the owner's private service. The go-live build is built and tested against stand-ins (a stand-in Neynar, a stand-in Farcaster sign-in, throwaway servers on the test machine); nothing in it has run against the real network, every live piece is switched on only by the owner, and nothing is called live until he has seen it work.

| Step | What is built | What has not happened yet |
|---|---|---|
| 10. The guided start, and live mode | A first run at `/welcome`, one screen at a time: Sign in with Farcaster, Save with Face ID, the X account your Farcaster account verified (or your archive), your first persona with a picture and where its posts go, then the home feed. Live mode hides the sample people and posts on the public site (hidden, never deleted) {cite: SECURITY-POSTURE.md > "32. Public live mode and the guided first run (Public go-live): what the tab hides, what the flow stores, what the X step asks"} | The deploy; the web address passkeys bind to; anyone's first run on the deployed site |
| 11. The public @anon | One Farcaster account that persona posts reach Farcaster through. Its posting key lives on the public server that relays, never on the app and never in a browser. Only Farcaster-verified people join the crowd; posting opens when 50 have, and a new member's first post waits for the next 6-hour window. Caps per person and per day, an automatic filter for the obvious (slurs, phone numbers, email and street addresses, scam links), a Report button on every @anon post, a takedown queue for the owner (a removed post is deleted from Farcaster and hidden in Totem, and its record kept), and a terms page {cite: SECURITY-POSTURE.md > "31. The public @anon relay (Public go-live)"} | The deploy; the owner's Neynar app and agent account; the owner's yes on the terms; a first post seen on Farcaster |
| 12. The anon page and the Farcaster Mini App | `/anon`: post as plain @anon from a page of its own, or inside the Farcaster app as a Mini App, see the latest @anon posts, share one, and a button through to Totem {cite: SECURITY-POSTURE.md > "33. The native anon page and the Farcaster Mini App (Public go-live)"} | The deploy; the Mini App signed for the final web address by the account that owns it; a first post from inside Farcaster |
| 13. Wave 3 on the public site | The browser prover's source code published beside it (GPL-3.0, `/device/source/`); the hosting edge's headers accepted on the anonymous route; the crowd every registered identity on test data {cite: SECURITY-POSTURE.md > "5. The GPL-3 note"} {cite: SECURITY-POSTURE.md > "27. Anonymous posting from the public site (Persona launch P7): the prover in your browser, the web channel, and what the operator sees"} | The deploy; a check of the edge's headers on the deployed site |
| 14. Rings: hide, never delete | Removing a ring member or deleting a ring keeps your record, under Recently removed with a Restore button; a restored member sees only what you post after the restore {cite: SECURITY-POSTURE.md > "24. Rings and ring notes (Persona launch P4): what the drop, the operator and a member learn"} | Used on a deployed site |

Parked on the same day, and not in the build: a live Totem registrar and live posting to @totem on X, both written for the owner's private service before the redirect. Their code is kept outside the repository to revive later; launch stays on the simulated registrar and Totem on X on its test transport.

What the go-live build states plainly: the public @anon's posting key sits on the public server that relays (the one exception to a keyless server), and Neynar, which runs the account, reads every post; the server learns which Farcaster account joined the crowd, and from the proof alone never who posted (the sign-in, the posts and the reports reach it from one address while no outside relay is set up); the filter catches only the obvious, so reports and the owner's takedowns do the rest, and a takedown cannot unsee a post someone already copied; the Mini App's signature names the Farcaster account that owns it. {cite: SECURITY-POSTURE.md > "31. The public @anon relay (Public go-live)"} {cite: SECURITY-POSTURE.md > "33. The native anon page and the Farcaster Mini App (Public go-live)"}

### Post as you: your own Farcaster account from the Post box (built 2026-11-05, not deployed yet)

The owner's mission is that you sign in with the Farcaster account you already have and keep posting as yourself, with personas optional. This step builds that, with no Neynar.

| Step | What is built | What has not happened yet |
|---|---|---|
| 15. Allow Totem to post as you | Your browser makes a posting key, keeps it in your vault and asks Farcaster to add it; you approve in the Farcaster app (a link on a phone, a QR code on a computer). It turns on only when your own account approved it and Farcaster's network lists the key. Then the Post box posts as you: "Posts go to Farcaster as @you." Casts and deletes from the Post box; replies, likes and recasts (and their undo) from the Farcaster cards in Following, never while a persona acts or on a persona's post. Disconnect forgets the key; removing Totem in the Farcaster app stops it. Totem's app account, which asks for every key, is made by one owner script (about $0.22, paid from the @anonwire wallet) and armed on the public validator only {cite: SECURITY-POSTURE.md > "35. Post as you: your own Farcaster account's key, Totem's app account, and what each party sees"} | The app account made and armed; the deploy; a first real approval and post on ontotem.com. The network fee is the visitor's to pay in the Farcaster app until the app account can sponsor it |

What it states plainly: adding the key publishes on the blockchain that your account uses Totem; Totem's server signs the request and passes your posts on, so it sees them and your internet address, which is also the address your anonymous posts come from; the main Farcaster app hides new posts from accounts that have not accepted its rules. {cite: SECURITY-POSTURE.md > "35. Post as you: your own Farcaster account's key, Totem's app account, and what each party sees"}

### Next: the closing reviews, the deploy, and the owner's steps

Next are three closing reviews of the go-live build, clean test sweeps, and a deploy of the public site with every status still "test data only". The owner's steps to take it live are one list, kept in the repository (`notes/runbooks/GO-LIVE-TODAY.md`), each with its link, command, cost and what to tell Claude:

1. **The web address first** (about $10 to $15 a year): passkeys, Sign in with Farcaster and the Mini App's signature are tied to it, so it is chosen before anyone saves.
2. **The go-live deploy** (Claude's step), with live mode on.
3. **The public @anon** ($0 to start): a Neynar app that holds nothing else, an agent account with a neutral profile, then one script with typed confirmations, caps and its own off switch.
4. **Real Farcaster posts in the feed** ($0 on Neynar's free plan): a second Neynar app's read key, then one script.
5. **The Farcaster Mini App** ($0): one signature in the Farcaster app's developer tools, then one script.
6. **The terms, and who works the takedown queue.**
7. **Try it** on a phone and a laptop: the guided start and the anon page.

Each piece is called live only once the owner has seen it work on the deployed site.

Network School bought Farcaster from Neynar on 2026-10-15/16 and has not said whether Neynar's developer service continues. The feed's real posts run through Neynar. The public @anon has a path through a Farcaster hub directly (`FC_HUB_URL`, the hub route): built, on test data only, until the first real post.

Still not built, for later: launching a persona into its own account for real (it needs a Totem registrar and prepaid credits); @totem on X for real; reach tiers on real follower counts and an issuer Totem runs for the public site; rings made on the owner's service reaching the public site; a third-party OHTTP relay for the privacy label (O8).

## In plain words

- **Start as a guest.** Use Totem right away. When you have something worth keeping, save it with Face ID or a fingerprint (no seed phrase). Your root can start fresh, come from your Farcaster account (scan a QR code), or come from your X archive.
- **Make personas and post.** By default a persona posts to Farcaster through Totem's shared anon account. Each post carries a secret only you hold, so you can prove later that you wrote it.
- **Choose who sees the links.** You make up to 16 rings ("top 16"), each one seeing a deeper version of you. People in a ring see which persona wrote which anon post, and a half-and-half avatar: your face on the left, the persona's picture on the right. Everyone else sees plain anon. Built, test data only. {cite: SECURITY-POSTURE.md > "24. Rings and ring notes (Persona launch P4): what the drop, the operator and a member learn"}
- **Reach from reputation, without your name.** Inside Totem, an anon post from a proven big account gets more reach in For You: "posted by an account with 10k+ followers", never which account. Built, test data only. {cite: SECURITY-POSTURE.md > "25. Reach tiers (Persona launch P5): what a boosted anon post says, and the crowd floor"}
- **Launch a persona when it is ready.** Launch is your choice, and it is permanent. It reveals all of that persona's anon posts at once, gives the persona its own Farcaster account, posts its history, and then lets you pick whether its future posts stay anon or go straight to the new account. Think pump.fun for anon reputation. Built, test data only, against a simulated registrar. {cite: SECURITY-POSTURE.md > "26. Launch (Persona launch P6): a persona's own account, on test data"}
- **Totem on X too.** A Totem X account that posts copies of anon posts after a moderator reads them, and that you can DM a tweet to save it for your reading list. Built, test data only: nothing reaches X. {cite: SECURITY-POSTURE.md > "28. The @layers X outbox (Persona launch P8): anonymous copies to X, moderated first, on a test transport"}

## What lives where

| | Totem only | Farcaster (every app) | X |
|---|---|---|---|
| Your root and your rings | ✓ | | |
| Which persona wrote an anon post | your rings only | | |
| Reach tier boost | ✓ | | |
| The shared anon account's posts | ✓ | ✓ | |
| A launched persona's own account | ✓ | ✓ | |
| Your main Farcaster account (imported) | ✓ | ✓ | |
| The Totem anon outbox and DM inbox | | | ✓ |

## The privacy rules the design keeps

- **Totem creates the accounts, not your wallet.** A fresh Totem wallet pays to create every launched persona's account, so the chain shows "made by Totem" and never "made by you". The persona's own key, held on your device, signs it. You never pay from your own crypto wallet, because that payment would tie the persona to you for good. Built against a simulated registrar; the real wallet is the owner's step. {cite: SECURITY-POSTURE.md > "26. Launch (Persona launch P6): a persona's own account, on test data"}

- **Random timing.** A launched account appears 2 to 48 hours after you click, at a random time, in a batch with others, so the click cannot be matched to the new account. Built on the simulated registrar; a batch of one in a quiet week is the stated exception. {cite: SECURITY-POSTURE.md > "26. Launch (Persona launch P6): a persona's own account, on test data"}

- **Anon posts go out in batches.** A post leaves within about 75 minutes, mixed with other people's, and each person gets a few posts per 6-hour window shared across their personas (proposed: 4). Faster means a smaller crowd per batch; slower hides you better. <!-- uncited-ok: describes a planned design, not a shipped claim -->

- **A tier needs a crowd.** A reach tier is offered only once at least 50 people are in it. Until then a 100k account proves the tier below, so "max tier" never points at one of three known people. Built, test data only. {cite: SECURITY-POSTURE.md > "25. Reach tiers (Persona launch P5): what a boosted anon post says, and the crowd floor"}

- **Launch reveals everything at once.** No hand-picked partial reveals, because a held-back post gets easier to pin on you once your style is public. The preview lists every post that will be linked and what the launch narrows (your tier's crowd, your posting hours, your style, the windows you used) before you confirm. Built, test data only. {cite: SECURITY-POSTURE.md > "26. Launch (Persona launch P6): a persona's own account, on test data"}

- **Ring notes are all the same size.** Every anon post carries a fixed-size sealed note, real or random, so the server cannot tell which posts have an audience. Built, test data only. {cite: SECURITY-POSTURE.md > "24. Rings and ring notes (Persona launch P4): what the drop, the operator and a member learn"}

- **Said plainly, not solved:** writing style, posting hours, and Neynar reading every anon post's text. A launched persona's public posts make its later anon posts easier to attribute. <!-- uncited-ok: describes a planned design, not a shipped claim -->

## History on launch

A post cannot move between Farcaster accounts, so the anon originals stay on the anon account. Farcaster accepts back-dated posts, but they are deleted first when an account's storage fills, they never reach followers' feeds, and the date proves nothing. So a launched persona posts "here is my history, here is the proof" at the current time, plus up to 10 quote-posts of its best anon posts. Inside Totem its profile shows the whole history at the original dates, marked "revealed from anon", and anyone can check the reveal against the key the new account registers. Built against a simulated chain. {cite: SECURITY-POSTURE.md > "26. Launch (Persona launch P6): a persona's own account, on test data"}

## The build, in order

All of it can be built and tested for $0 on test data first:

1. Honest status rows and copy for the new pieces. **Built.**
2. Sign in with Farcaster, passkey first (an existing written design). **Built, test data only; deployed 2026-10-11.**
3. Root from your X archive, with a "verified on Farcaster" X badge (an existing written design). **Built, test data only; deployed 2026-10-11.**
4. Personas posting through the anon account, several posts per window, the reveal secret per persona. **Built, test data only; deployed 2026-10-11.**
5. Rings, ring notes and the half-and-half avatar. **Built, test data only; deployed 2026-10-12.**
6. Reach tiers and the For You boost. **Built, test data only; deployed 2026-10-12.**
7. Launch, on a simulated registrar. **Built, test data only; deployed 2026-10-12.**
8. Anon posting for everyone on the public site (a prover in the browser). **Built, test data only; comes to the public site with the go-live build.**
9. The Totem X outbox and DM inbox, on test data. **Built, test data only; deployed to the owner's service 2026-10-13.** Nothing has reached X.
10. The guided start and live mode on the public site. **Built, tested against stand-ins; not deployed yet.**
11. The public @anon, with reports, takedowns, a filter and terms. **Built, tested against stand-ins; switched on only by the owner; not deployed yet.**
12. The anon page and the Farcaster Mini App. **Built, tested against stand-ins; not deployed yet.**

Waves 1 to 3 had three adversarial reviews each; the go-live build gets three closing reviews and clean test sweeps before it is deployed.

## What going live needs from the owner

For the go-live (the list above):

- The app's final web address, before strangers save passkeys, because passkeys are tied to it.
- A separate Neynar app and agent account for the public @anon, and a second Neynar app's read key for the feed. A Neynar plan sized for real volume once posts grow (150 credits a post).
- The Farcaster account that owns the Mini App, to sign it once.
- A yes on the terms, and a person who works the takedown queue.

Later, not needed for this launch:

- ETH on Optimism from an exchange, for a fresh Totem wallet that creates launched accounts (about $0.20 of storage per account plus a few cents of gas) and buys storage for the shared anon account (about $365 a year at 500 posts a day).
- A Totem X account and X developer billing (pay per use).
- Optional: an xAI key, to find good posts on X by meaning.
- Payments for launches, through prepaid credits that do not tie the payer to the persona.

## The eight decisions (confirmed 2026-10-10)

1. **What a reach tier counts:** Farcaster followers (1k, 10k, 100k) with a Neynar score of 0.7 or more to enter; X followers later.
2. **Default post mode for a new persona:** anon.
3. **Price per launch:** about $5, through prepaid credits. Not built in this pass.
4. **Anon limits:** 4 posts per person per 6 hours, posts out within about 75 minutes, 500 a day across the site.
5. **History on launch:** the proof post plus up to 10 quote-posts, as above.
6. **Who creates the accounts:** a fresh Totem wallet.
7. **Partial launches:** no; everything at once.
8. **Rings for people other than the owner:** a simple version first, stronger privacy in a follow-up.
