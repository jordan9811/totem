---
pageClass: eli5
---

# Anonymous posts

Post something with no name on it, the way anoncast does on Farcaster: a shared account, @anon, posts it as one of your personas, after a proof that a real member wrote it.

::: warning Status: built, test data only, on both sites (on the public preview, not deployed yet)
On the deployed public preview there is no **Post anonymously** switch yet: under the Post box the app says "Anonymous posting isn't on this preview yet.". The code for it is built and tested on a local copy shaped like the public preview, on test data, and is **not deployed yet**: your browser makes the proof itself, in a background worker, and every anonymous post made there stays inside the preview, with "Preview only · not on Farcaster" on its card. Nothing a browser sends reaches Farcaster: "Anonymous posting to Farcaster isn't on this preview yet." {cite: SECURITY-POSTURE.md > "27. Anonymous posting from the public site (Persona launch P7): the prover in your browser, the web channel, and what the operator sees"}

On the owner's private service, anonymous posting is built and passes its tests on test data. It has never sent a real cast: no live run is recorded, and the steps to switch it on are the owner's runbook, section (f): one script (`arm-anon.ps1`), a typed confirmation, a cap of one post and its own kill switch. The later "reveal" step (proving a past anon post was yours) has not finished its reviews. There is only one person on that service, so an anon post there is an extra account with no name on it, not a voice hidden in a crowd. From the persona launch pass, also built on test data only: each anon post is made as one of your personas, a new persona posts through @anon by default, and each person gets 4 anonymous posts every 6 hours, shared across their personas. Deployed on 2026-10-12 and only run on test data so far: a sealed note on every anon post that only your rings can read, reach tiers that boost a post from a big account in For You (none is offered on the owner's service: a tier needs 50 accounts), and launching a persona against a simulated registrar. {cite: notes/runbooks/GO-LIVE-FARCASTER.md > "(f) The anon account (optional)"} {cite: SECURITY-POSTURE.md > "23. Persona-scoped anon posting (Persona launch P3): K posts per person per window, and what the slot index still says"} {cite: SECURITY-POSTURE.md > "25. Reach tiers (Persona launch P5): what a boosted anon post says, and the crowd floor"}
:::

::: info The go-live build (2026-10-17): the public @anon, not deployed yet
The go-live build makes the public site's anonymous posts real: a persona's post goes to Farcaster from one shared @anon account, relayed by the public server, which holds the account's one key (the app server holds none). Only Farcaster-verified people join the crowd, one per Farcaster account, by signing in; posting opens once 50 have joined, and a new member's first post waits for the next 6-hour window. A filter refuses the obvious, every @anon post has a Report button, and the owner takes posts down from a queue (deleted from Farcaster, hidden in Totem, the record kept); the rules are on a terms page. Farcaster people can post the same way from [the anon page](/features/anon-page). It is tested against stand-ins only and runs only once the owner switches it on; until then a live site says "Anonymous posting isn't switched on for this site yet, so nothing can be posted anonymously right now." {cite: SECURITY-POSTURE.md > "31. The public @anon relay (Public go-live)"}
:::

## At a glance

<DiagramAnonRelay caption="Built, test data only. Each wait is there so the moment you pressed post is hard to pick out from the moment it appears." />

An anonymous post proves one thing: that its writer is a member of a group (by default, people at a given reputation level), without saying which member or which persona. Each identity, meaning your one root, gets 4 slots per window of six hours, shared across all your personas, and each post takes a free slot. That stops one identity from looking like a crowd. It does not stop one person who makes several identities, because nothing checks that a member is a real, single person. The server keeps the post's text and the hour it went out, and nothing about who sent it. {cite: SECURITY-POSTURE.md > "14. Network identities (Multi-FID pass): what the network, Neynar and the validator learn about persona accounts and anon posts"}

## The obvious questions

### Who can tell it was me?

Against other people on Farcaster and other apps, the post is the anon account's. Against the Totem server, you are one of the group, as long as the group is big. Neynar is the exception: it runs the anon account, so it sees every anon cast. If the anon account shares a Neynar key with your personas, Neynar can join them by key. The setup requires a separate key, which stops that join, but Neynar the company still serves both keys and could join them by account, address and timing. {cite: SECURITY-POSTURE.md > "14. Network identities (Multi-FID pass): what the network, Neynar and the validator learn about persona accounts and anon posts"}

### So is it anonymous on the owner's service?

Not in the crowd sense. With one person in the group, the proof hides nothing: everyone knows who the only member is. What covers the account there is how it was created, a separate Neynar key, the hourly timing, and what the owner writes. A real crowd needs a Totem site with many people sharing one relay. <!-- uncited-ok: the honest framing of a one-owner deployment; the mechanism page cites its sources -->

### Can I prove later that an anon post was mine?

That is the reveal, and it is built on test data. When you post, your device keeps a secret that only it can use. Later you can use it to attach the post to one of your personas that has its own Farcaster account. A reveal is permanent and visible to everyone who reads this Totem server (on the owner's service, the owner); nothing changes on Farcaster, where the post stays the anonymous account's. Other people cannot check a reveal for themselves yet: it is signed with a key that the persona's account has not registered on Farcaster, so other apps show the post as plain anon. {cite: SECURITY-POSTURE.md > "14.1 Anon-post attribution (the anoncast reveal) — what a reveal costs"}

### Can I post anonymously on the public preview?

Soon, on test data. It is built and not deployed yet. Once it is, your browser makes the proof itself, in a background worker in your own tab: your secret is handed to that worker inside the tab and is never sent anywhere. The finished post leaves in a request of one fixed size, with no cookie and no referrer. It stays inside the preview, its card says "Preview only · not on Farcaster", and nothing is posted to Farcaster. {cite: SECURITY-POSTURE.md > "27. Anonymous posting from the public site (Persona launch P7): the prover in your browser, the web channel, and what the operator sees"}

### Why does it say anonymous posting here is only for people already in the crowd?

Because an anonymous post has to prove it comes from one of the crowd's members, and a new identity is not one yet. It joins once it is registered with enough reputation to be in the crowd for the current 6-hour window, and the crowd itself has to hold at least 50 identities before anyone in it can post. Until then nothing is made or sent. How big the deployed preview's test crowd is has not been checked. {cite: SECURITY-POSTURE.md > "27. Anonymous posting from the public site (Persona launch P7): the prover in your browser, the web channel, and what the operator sees"}

### What does "Checking whether you can post anonymously from here…" mean?

No check has read this browser's crowd yet. The composer runs one at once, and nothing is accepted until it has: until then the box offers no anonymous posting, so no words are taken and lost. It usually lasts a few seconds. {cite: SECURITY-POSTURE.md > "27. Anonymous posting from the public site (Persona launch P7): the prover in your browser, the web channel, and what the operator sees"}

### What does the server see when I post from my browser?

With no outside relay set up, which is the case today: your internet address, your browser's own description of itself (its user agent and similar hints) and the time, on every anonymous post, plus the post itself and its proof. It does not see your identity or which persona wrote it, as long as the crowd is big. An outside relay (OHTTP) would hide your address and browser from it; the code is ready for one, and none is set up, which is one reason the label reads DEMO. {cite: SECURITY-POSTURE.md > "27. Anonymous posting from the public site (Persona launch P7): the prover in your browser, the web channel, and what the operator sees"}

### What if I close the tab?

A post still waiting for its proof lives only in the open tab, so closing the tab loses it. A post proved for a window that ends while the tab is closed is refused when you come back, and the app says so: post it again. {cite: SECURITY-POSTURE.md > "27. Anonymous posting from the public site (Persona launch P7): the prover in your browser, the web channel, and what the operator sees"}

### How long does the proof take on a phone?

Seconds, measured on a stand-in rather than a real phone: about 1.4 seconds on a desktop, and about 6.6 to 10.6 seconds on a page slowed down four to six times. The preview's own posts use test proofs, which are much faster. Proofs are made in the background, never while you wait on the button. {cite: SECURITY-POSTURE.md > "6. Mobile proving"}

### Can I also post it to X?

Not from the public preview. On the test rig a copy can wait for a moderator before a Totem account on X would post it, on test data only: see [Totem on X](/features/layers-on-x).

### Who in my rings can tell it was me?

People you put in a ring that sees this persona's anonymous posts. Every anon post carries a sealed note of exactly 256 bytes: a real one their devices can open, or random bytes, so a post with an audience looks like one without. They see "@persona · shared with you by" the name the ring's owner chose to be shown as (their Farcaster name, or "a friend"; never the ring's own name), with a half-and-half picture; everyone else sees plain @anon. The note has no signature, so a member cannot prove the link to anyone else. Built, test data only. See [Who sees what](/features/who-sees-what). {cite: SECURITY-POSTURE.md > "24. Rings and ring notes (Persona launch P4): what the drop, the operator and a member learn"}

### What is the "10k+ followers" label?

A reach tier. If your main Farcaster account has at least 1k, 10k or 100k followers (and a Neynar score of 0.7 or more), an anon post can prove that bucket and carry the label "posted by an account with 10k+ followers" wherever it shows, never which account, with a head start of 1 to 4 hours in For You only. A tier is offered only while at least 50 accounts are in it and at least 50 more are in the tier below it, so a 100k account boosts as 10k+ until the 100k+ tier fills, and a post at a lower tier still hides among at least 50. The cost: everyone sees the tier a post proved, so it hides among that tier's accounts rather than among everyone who posts anonymously. The composer picks the highest tier offered and, from the next deploy, says how many accounts are in it; you can choose a lower one or no boost. If a boost would narrow the accounts that could have written all of that persona's anonymous posts to fewer than 50, the post is not sent and Totem says why: post it again with a lower boost or none. Built, test data only, tested on the laptop rig and deployed on 2026-10-12. On the public preview it waits for anonymous posting there and for an issuer Totem runs: the public site refuses to run one in your browser. {cite: SECURITY-POSTURE.md > "25. Reach tiers (Persona launch P5): what a boosted anon post says, and the crowd floor"}

### Does a boosted post use up a different allowance?

No. The 4 posts per 6 hours are yours whatever tier a post proves; reusing a slot under another tier is refused as a repeat. {cite: SECURITY-POSTURE.md > "25. Reach tiers (Persona launch P5): what a boosted anon post says, and the crowd floor"}

### Can my persona take its anonymous posts with it?

That is launch: the persona gets its own Farcaster account and every anonymous post it made is revealed at once, signed by the new account's key. Permanent. Built, test data only, against a simulated registrar. See [Launching a persona](/features/launch). {cite: SECURITY-POSTURE.md > "26. Launch (Persona launch P6): a persona's own account, on test data"}

### What does "Posts from @x go" mean?

It is where a persona's posts go, set per persona under the Post box. **Through @anon** is the default for a persona without its own Farcaster account. **In Totem only** keeps posts inside Totem. **To its own account** appears only once the persona has a Farcaster account of its own. Built, test data only.

### Does posting anonymously from two personas link them?

Not through the proof. Each post takes a different slot, so each carries a different one-time code, and which persona wrote it is kept in a sealed record on your device. One small thing remains: one person's posts in a window never share a slot, so two posts that do share one are two people, and two in different slots are about 1.33 times likelier to be one person. Your writing, your hours and Neynar can still link them. {cite: SECURITY-POSTURE.md > "23. Persona-scoped anon posting (Persona launch P3): K posts per person per window, and what the slot index still says"}

### Why a random delay, and why batches?

So the moment the post appears on Farcaster does not match the moment you pressed the button. On the owner's service posts go out hourly; on the public preview the plan is every 30 minutes, each spread at random over the next 30, so a post appears within about 75 minutes. The time recorded is rounded to the hour.

### How long can an anon post be?

Up to 320 characters, Farcaster's short-post limit.

### What does it cost, and how many?

Each cast costs the owner 150 Neynar credits. Each person gets 4 posts every 6 hours, shared across their personas; a fifth is refused with "You have used all 4 anonymous posts for this 6-hour window." The whole site is capped at 500 anonymous posts a day. On the owner's service a lifetime cap, one post by default, stops the relay entirely once reached, and it counts posts that are still waiting; a post the relay gave up on after six tries stops counting. The owner raises the cap on purpose, after the first post is seen on the network.

## What this does not protect

- **A small group.** The proof hides you only among the members of the group. On the owner's service the group is one person.
- **Your words.** Writing style, topics and in-jokes give people away.
- **A reveal.** Once you reveal, every reader of this server can see it, permanently; it is checkable inside Totem only until the persona's own key is registered on its account.
- **Neynar.** It serves the anon account and your persona accounts. The separate key the label's tenth condition asks for stops a join by key, not a join by the company.
- **Many identities.** Four posts per identity per window does not stop one person who makes several identities.
- **The slot number.** It travels with each post, so two posts in the same slot are known to be two people (about a 1.33 times nudge the other way). {cite: SECURITY-POSTURE.md > "23. Persona-scoped anon posting (Persona launch P3): K posts per person per window, and what the slot index still says"}
- **Your address and browser, on the public preview.** With no outside relay, the server sees each anonymous post's internet address and your browser's user agent. {cite: SECURITY-POSTURE.md > "27. Anonymous posting from the public site (Persona launch P7): the prover in your browser, the web channel, and what the operator sees"}
- **A closed tab.** A post still waiting for its proof is lost with the tab.
- **The tier.** A boosted post shows its reach tier to everyone, so its crowd is that tier's accounts, and the floor counts accounts in the tier, not accounts actually posting boosted. {cite: SECURITY-POSTURE.md > "25. Reach tiers (Persona launch P5): what a boosted anon post says, and the crowd floor"}
- **Your rings.** A ring member who reads a note can pass on a claim (not proof), and can tag their own anon post as yours for the rest of the ring. {cite: SECURITY-POSTURE.md > "24. Rings and ring notes (Persona launch P4): what the drop, the operator and a member learn"}

## Drawn in the picture, not built

[The big picture](/start/big-picture#anon) draws what Totem adds on top of an anon post. Today, on test data, these parts exist: the proof, the "Prove this is yours" button on the device that wrote the post, the reveal itself, showing chosen people which persona wrote it (rings), the reach-tier label, and launch. These are designed in that picture and not built, so the docs call them 🟣 coming soon:

- a member badge on the card, drawn from the proof (the reach-tier label is the one badge built);
- a private "yours" mark on the card (today the only signal that a post is yours is the Prove-this-is-yours button, on the posting device);
- anonymous replies and threads;
- anon posts inside follows-only or network-based feeds (a mode that shows only people you follow leaves them out).

And one limit on what is built: a single reveal is checkable inside Totem only, by this server's readers, because the persona's key is not registered on its Farcaster account. Launch closes that on the simulated chain: its batch reveal is signed by a key the account registered, so anyone can check it there. On the real network it waits for the live registrar and key-registry read.

## Where it lives in the code

The proof and its rules: `lib/zk/prove.ts`, `lib/zk/scopes.ts`, `lib/zk/config.ts` (window, length, floor, slots, the reach floor), `lib/zk/anon/slots.ts` (the 4 slots). The ring note: `lib/rings/note.ts`. Reach tiers: `lib/reach/`, `components/ReachPicker.tsx`. Launch: `lib/launch/`. The post mode: `lib/identity/postMode.ts`, `components/PostModePicker.tsx`. The owner's switch: `scripts/owner/arm-anon.ps1`. The queue and sending: `lib/zk/anon/`. The relay: `validator/zk.js` and `validator/anon.js`. The reveal: `lib/zk/anonAttribution.ts`. The composer's toggle: `components/Composer.tsx`. In the browser: the prover `lib/zk/prover/browser-worker.ts` (built into `public/device/prover.js`), its bridge `lib/zk/transport/browser.ts`, the anonymous channel `lib/zk/anon/webChannel.ts`, and the one switch `lib/zk/anon/availability.ts`. For the design, see [The anon relay](/mechanism/anon-relay), [Rings and ring notes](/mechanism/rings) and [Reach tiers](/mechanism/reach-tiers).

## The record

For auditors: each line is tagged in the internal vocabulary and cites the report it comes from.

- **[SHIPPED-FIXTURE]** Anon-post mode as first built: one per root per window (since replaced by 4 slots per person, below), store-and-forward relay, hour-grained time; never run live. {cite: notes/reports/REPORT-FID.md > "GATE 4 — Anon-post mode (the anoncast pattern, inside Layers)"}
- **[SHIPPED-FIXTURE]** Persona-scoped anon posting (Persona launch P3): the persona in the sealed reveal record, K = 4 slots per person per window, the post mode, the daily cap; never run live. {cite: SECURITY-POSTURE.md > "23. Persona-scoped anon posting (Persona launch P3): K posts per person per window, and what the slot index still says"}
- **[SHIPPED-FIXTURE]** The reveal: a commitment at post time, opened later to one of your own personas with its own account; permanent, and visible to every reader of this Totem server, with nothing changing on Farcaster. Not yet through three reviews and four clean sweeps. {cite: notes/reports/REPORT-FID.md > "ADDITION (after the pass closed) — anon-post ATTRIBUTION: the anoncast reveal pattern"}
- **[SHIPPED-FIXTURE]** The ring note on every anon post (Persona launch P4): 256 bytes, real or random, bound into the proof; deployed 2026-10-12, test data only. {cite: SECURITY-POSTURE.md > "24. Rings and ring notes (Persona launch P4): what the drop, the operator and a member learn"}
- **[SHIPPED-FIXTURE]** Reach tiers (Persona launch P5): `fc.reach` (and `x.reach`, fixture only), the crowd floor of 50 enforced five times, the For You label and head start; tested on the rig only, deployed 2026-10-12; in the public site's browser device the reach issuers refuse to run (D-REACH-ISSUER-HOST-ONLY). {cite: SECURITY-POSTURE.md > "25. Reach tiers (Persona launch P5): what a boosted anon post says, and the crowd floor"}
- **[SHIPPED-FIXTURE]** Launch's batch reveal (Persona launch P6), checkable against the simulated key registry. {cite: SECURITY-POSTURE.md > "26. Launch (Persona launch P6): a persona's own account, on test data"}
- **[SHIPPED-FIXTURE]** Anonymous posting from the public site (Persona launch P7): the prover in a Web Worker, the browser's anonymous channel (direct now, OHTTP-ready), one switch for the whole site, test-universe posts that stay inside the preview and say so; tested on the production shape against a throwaway validator, not deployed. {cite: SECURITY-POSTURE.md > "27. Anonymous posting from the public site (Persona launch P7): the prover in your browser, the web channel, and what the operator sees"}
