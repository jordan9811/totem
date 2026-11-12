---
pageClass: eli5
aside: false
---

# The big picture

What lives in Totem, what lives on Farcaster, where X comes in, and where the anonymous account sits, on one map.

::: warning Status: a map of today and of the plan. Most of the bridges are not built yet
Inside Totem, the core works today on both sites: your root, your personas, your feed controls, readwise, folders and private posts. Most bridges out of Totem are coming soon or have only run on test data. Nothing from the public preview reaches Farcaster yet, and the X importer has only read a small test archive. The one bridge that works today is Farcaster's own: proving you own your X account in the Farcaster app. Every arrow below says exactly where it stands.
:::

## At a glance

<ol class="flow">
  <li><strong>X</strong>Your old posts and the people you follow. X hands them over as one ZIP file</li>
  <li class="flow__us"><strong>Totem</strong>Your private side: one root, many personas, your own feed rules</li>
  <li class="flow__us flow__soon"><strong>Totem</strong>Keeps your X posts with their dates, and finds your X people on Farcaster</li>
  <li class="flow__soon"><strong>Farcaster</strong>Each public persona posts as its own account; anon posts go out through one account with no name</li>
  <li class="flow__soon"><strong>Friends you pick</strong>See which accounts are yours, inside Totem only</li>
</ol>
<p class="flow__note">The dashed steps are not done. Step 3 has only run on test data or is not built, step 4 has only run on test data on the owner's private service, and step 5 is designed but not built. The map below has every piece.</p>

<style>
.eco-figure { margin: 24px 0 12px; }
.eco-figure .eco-scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; }
.eco-figure img.eco-img { display: block; width: 100%; min-width: 760px; height: auto; color-scheme: light; }
html.dark .eco-figure img.eco-img { color-scheme: dark; }
.eco-figure figcaption { margin-top: 8px; font-size: 14px; line-height: 1.5; color: var(--vp-c-text-2); }
</style>

## The map

<figure class="eco-figure">
<div class="eco-scroll"><a href="../diagrams/ecosystem-map.svg" target="_blank" rel="noopener" aria-label="Open the full-size map in a new tab"><img class="eco-img" src="/diagrams/ecosystem-map.svg" width="1200" height="1340" alt="A map in three zones. X on the left: your X account, your X archive, and X's paid developer service. Totem in the middle: your root and personas, find your people, who sees what, a history shelf for your X posts, readwise and folders, the anon composer, influence and tiers, feed controls, private posts, and show to a friend. Farcaster on the right: X verifications, your main account, persona accounts, the anon account, and public casts. Eleven numbered arrows join them, each explained below with its status."></a></div>
<figcaption>X on the left, Totem in the middle, Farcaster on the right. Each numbered arrow is explained below. On a phone, swipe sideways, or tap the map to open it full size.</figcaption>
</figure>

**How to read the marks.** A filled green dot is 🟢 Works live. A half-filled ring is 🔵 Built, test data only; on the map it also covers the two parts that are built and ⚪ Off on purpose. A dashed ring is Planned, which the rest of these docs call 🟣 Coming soon, or 🟡 Designed when only the design exists. A ring with a $ is Paid, later: it needs a paid X developer account and waits for the owner's yes. Solid lines are built, dashed lines are planned, dotted lines are paid.

## The three zones

### X, on the left

Where your past lives: your posts, the people you follow, your likes. X gives you all of it as one archive file, a ZIP, usually within a day of asking. Totem plans to read that file in your browser. Anything that talks to X directly, like posting to X or syncing bookmarks, goes through X's developer service, which charges per use with no free tier: about $0.015 a post and $0.20 for a post with a link.

### Totem, in the middle

Your private side. One root identity makes all your personas: a main, a finsta, alts. Around them sit the parts only Totem has: who sees which persona, feed controls (modes, rules, lenses and zones), readwise and folders for long posts, private posts that stay in Totem, influence and reputation tiers, a history shelf for your X posts, and the anon composer. On the public preview all of this lives in your browser. On the owner's private service it lives on his server.

### Farcaster, on the right

The public network. Anything here can be read by any Farcaster app: casts, likes, follows and profiles. Totem puts three kinds of account here: each public persona's own account, your existing main account once it is connected, and one anonymous account that posts for the group. The Farcaster app also keeps a public list of people who have proved they own an X account: about 397,000 of them.

## The arrows, one by one

**1. Verify your X.** 🟢 Works live. You prove you own your X account inside the Farcaster app. That is Farcaster's feature, not Totem's, and it works today. The app keeps the record in a free public list that anyone can read.

**2. Show "X @handle, verified on Farcaster" on a persona.** 🔵 Built, test data only. Totem reads that public list and shows the badge on the persona whose Farcaster account made the proof. No X login and no X fees. The list is off until the owner switches it on, and on the public preview personas have no Farcaster account of their own yet. A typed handle is now labelled "test link, not verified", on the test rig only.

**3. Find your X follows on Farcaster.** 🔵 Built, test data only, for the matching; 🟣 following them from Totem is coming later. Your browser reads who you follow from your archive and matches it against that same public list, which every visitor downloads whole. You see "N of the people you follow on X are on Farcaster". The list is off until the owner switches it on. On the owner's service, following them will be real Farcaster follows, spread over days under the daily follow budget (10 a day) inside the 30-action limit. The old matcher, which only checked X accounts linked inside Totem, is now on the test rig only.

**4. Import your X archive.** 🔵 Built, test data only. Drop the ZIP, or its folder, into Settings › Import from X; your browser reads it there, and your tweets land on a "From X" shelf on your persona's profile, each keeping its original X date. It has only read a synthetic 3,000-post archive so far. Feeding them into readwise, so long ones come back to you in short chunks, is 🟣 coming soon: readwise today works on posts already inside Totem.

**5. Re-post to Farcaster, one at a time.** 🟣 Coming soon. On the owner's service you will be able to pick one imported tweet and post it as a persona. It goes out dated today, labelled "originally on X, 3 May 2019" with its real date. One at a time, not in bulk. [Backdating](#backdating) explains why the old date stays in Totem.

**6. A persona posts as its own Farcaster account.** ⚪ Off on purpose. On the owner's service a public persona can get a real Farcaster account with its own name, for about $0.35 to $0.90 of ETH. It is built and tested on test data, and no persona has one yet: the owner makes each one. The app's own Post box, likes, recasts and follows are built to post as that account (🔵 built, test data only: not yet run on the deployed service, where today they still save inside Totem). The public preview does not offer persona accounts.

**7. Post anonymously.** 🔵 Built, test data only. You write in the anon composer. The post is made as one of your personas (a new persona posts through @anon by default). Totem attaches a membership proof that you are in the group, without saying which member or which persona, and each member gets 4 posts every 6 hours, shared across their personas. The post then waits a random 30 seconds to 15 minutes, joins the next hourly batch (sent in random order, up to 10 minutes past the hour), and goes out from the one anon account. On the owner's service it has not posted for real yet. On the public preview your browser makes the proof and the post stays inside the preview, marked "Preview only · not on Farcaster": built, test data only, not deployed yet. Posting to Farcaster from the public preview is coming soon. {cite: notes/runbooks/GO-LIVE-FARCASTER.md > "(f) The anon account (optional)"} {cite: SECURITY-POSTURE.md > "23. Persona-scoped anon posting (Persona launch P3): K posts per person per window, and what the slot index still says"}

**8. Show to a friend.** 🔵 Built, test data only, deployed 2026-10-12, as rings. The people you put in a ring see which personas are you and, if you choose, which anon posts each wrote, with a half-and-half picture. They see it in Totem, or on a private link card if they do not use Totem; nothing changes inside their Farcaster app. See [Who sees what](/start/who-sees-what). {cite: SECURITY-POSTURE.md > "24. Rings and ring notes (Persona launch P4): what the drop, the operator and a member learn"}

**9. Connect your main account.** 🔵 Built, test data only, on the owner's service, and not available yet. On the public preview, signing in with Farcaster shows your main account (🔵 built, test data only), and Allow Totem to post as you lets the Post box post as it, with a key in your vault approved in the Farcaster app (🔵 built, test data only, not deployed yet; [Post as you](/mechanism/post-as-you)). Post from Totem as the Farcaster account you already have, approved once in the Farcaster app by scanning a QR code, with no seed phrase. It needs a small connector account of its own, which one command on the owner's laptop (arm-connector.ps1) creates and keeps on the owner service, the owner never handling a key: about 0.0005 ETH on Optimism from an exchange withdrawal, about $1. Settings says "not available" until the owner has run it, and neither the setup nor the connect flow has run against the real network. The guard that refuses any interaction between your main and your other personas is built and running: until main is connected it uses the owner's configured main account, and with that unset a persona's replies, likes, recasts, follows and @mentions are refused. {cite: SECURITY-POSTURE.md > "14. Network identities (Multi-FID pass): what the network, Neynar and the validator learn about persona accounts and anon posts"}

**10. Read real casts.** ⚪ Off on purpose. Real Farcaster posts, read-only, ranked through your own modes, rules and lenses. Built and deployed on the public preview, and switched off until the owner adds a read key. When on, the public preview shows posts from a list of authors the owner picked.

**11. Paid X features.** 🔵 Built, test data only. Posting to X, syncing bookmarks, signing in with X and DM-a-link-to-save all need a paid X developer account. Today they are test stand-ins: the composer's X option returns a made-up reference and nothing reaches X. They wait for the owner's yes.

## The anon account, rolled up {#anon}

<figure class="eco-figure">
<div class="eco-scroll"><a href="../diagrams/anon-rollup.svg" target="_blank" rel="noopener" aria-label="Open the full-size anon picture in a new tab"><img class="eco-img" src="/diagrams/anon-rollup.svg" width="1200" height="990" alt="Left: any Farcaster app shows an anon post from an account with no name or bio, posted in an hourly batch. Right: the same post in Totem, with a member badge from the proof, a mark that it is yours on your own screen, an optional public reveal, a reveal to chosen friends, a thread view with your personas, and your modes. Bottom: the path a post takes, from the composer through a membership proof, a random wait and an hourly batch to the anon account."></a></div>
<figcaption>What every Farcaster app sees, and what Totem draws on top of the same post for you.</figcaption>
</figure>

Every Farcaster app sees the same thing: an account with no name, posting in hourly batches, top-level posts only. Totem adds these layers on top of the same post:

- **Member badge.** 🟣 Coming soon. Each anon post carries a proof that a member of the group wrote it, up to 4 posts per member per 6 hours. The proof is 🔵 built, test data only; showing it as a badge is not built.
- **Marked as yours.** 🔵 Built, test data only, as a button: your device keeps a secret for each anon post it writes, so the "Prove this is yours" button appears on your own posts, on the device that wrote them. A quiet "yours" mark on the card itself is 🟣 coming soon.
- **Reveal, if you choose.** 🔵 Built, test data only. Later, you can sign the post as one of your personas that has its own Farcaster account. Totem checks the signature before it shows "revealed as @finsta". A reveal is permanent, and visible to every reader of this Totem server; nothing changes on Farcaster, and other apps cannot check it until the persona's own key is registered on its account. {cite: SECURITY-POSTURE.md > "14.1 Anon-post attribution (the anoncast reveal) — what a reveal costs"}
- **Reveal to friends only.** 🔵 Built, test data only, deployed 2026-10-12, as rings: every anon post carries a sealed note of one fixed size, which only the rings you chose can open. They see "@persona · shared with you by" the name you chose to be shown as (your Farcaster name, or "a friend"; never the ring's own name). {cite: SECURITY-POSTURE.md > "24. Rings and ring notes (Persona launch P4): what the drop, the operator and a member learn"}
- **Thread with your personas.** 🟣 Coming soon, and so are anonymous replies. In your own view, your anon posts beside your personas' threads. A persona replying to your own anon post in public would tie the two together, so this stays in your view.
- **Your modes.** 🔵 Built, test data only, in one direction: a mode that shows only people you follow leaves anon posts out. Showing them inside follows-only or network feeds, and your rules and lenses acting on anon posts, are 🟣 coming soon.

On the owner's private service there is one member, so the proof hides nobody: the anon account is an extra account with no name on it, not a crowd. A real crowd needs many people sharing one relay. The anon account is Totem's own, built on the anoncast idea; it is not the existing @anoncast account. {cite: notes/runbooks/GO-LIVE-FARCASTER.md > "(f) The anon account (optional)"}

## Backdating: can an old tweet keep its date on Farcaster? {#backdating}

Not the way Totem posts, and it would not be honest anyway. So imported tweets keep their original date inside Totem, on the history shelf, and a re-post to Farcaster carries today's date with an "originally on X, 3 May 2019" label.

- **Through Neynar: no.** Totem posts through Neynar's managed signer (the `POST /v2/farcaster/cast` request). That request takes the text, embeds, a parent, a channel and a retry key. It has no date field, so the cast is dated when Neynar sends it.
- **On the protocol itself: yes, with conditions.** A Farcaster message carries a time the signer picks. The network refuses one dated more than about 10 minutes in the future, and sets no limit on the past. So a message you sign yourself, with a key you hold, can claim an older date. Totem's posting path does not sign messages itself today.
- **Why it is still the wrong tool for old tweets.** Farcaster's clock starts on 1 January 2021, so an older date has no way to be written, and many tweets are older. The date is unverified: apps show whatever the post claims, so an old date proves nothing. And when an account fills its storage (5,000 casts per unit), the oldest-dated posts are deleted first, so backdated posts would go first.

## What any Farcaster app sees, and what Totem adds

| What any Farcaster app sees | What Totem adds |
|---|---|
| An account for each public persona, with its casts, likes and follows | All your personas in one place, for you. Showing a friend which accounts are yours: 🟣 Coming soon |
| Your main account, as it is | Posting as it from Totem, beside your personas: 🔵 Built, test data only, on the owner's service; not available until the owner has run the connector setup (one command, about $1) |
| An account with no name, posting in hourly batches | A member badge: 🟣 Coming soon. A "yours" button on the posting device, and an optional reveal shown inside Totem: 🔵 Built, test data only |
| Casts, in whatever order each app chooses | Your modes, rules, lenses and zones, readwise and folders: 🟢 Works live, mostly on sample posts so far |
| Public casts only | Private posts, sealed and kept in Totem: 🟢 Works live |
| A verified X account on a profile, if the person proved one in the Farcaster app | That proof shown on your persona, and your X follows found on Farcaster: 🟣 Coming soon |
| Nothing from X | Your X posts on a dated history shelf: 🔵 Built, test data only |

## What this does not protect

- **Neynar sees your accounts together.** Totem creates and posts for every persona account through Neynar, under one key, so Neynar can tell they belong together. It also runs the anon account. {cite: SECURITY-POSTURE.md > "14. Network identities (Multi-FID pass): what the network, Neynar and the validator learn about persona accounts and anon posts"}
- **The privacy label reads DEMO.** The goal, that nobody, including whoever runs the server, can link your personas, is not met yet. {cite: SECURITY-POSTURE.md > '4. What "private" means on the label, exactly'}
- **A follow list is a fingerprint.** Following the same few hundred people from a persona as from your X account ties that persona to your X self. Pick the persona you import into with care.
- **A reveal is for good.** Once you reveal an anon post as one of your personas, every reader of this server can see it, and it stays; Farcaster does not change. {cite: SECURITY-POSTURE.md > "14.1 Anon-post attribution (the anoncast reveal) — what a reveal costs"}
- **One owner is not a crowd.** On the owner's service, the anon account hides its writer only as well as its own setup, its timing and its words do. {cite: notes/runbooks/GO-LIVE-FARCASTER.md > "(f) The anon account (optional)"}

## The obvious questions

### Does anything on this map reach Farcaster today?

Only arrow 1, and that is Farcaster's own feature. Nothing from the public preview reaches Farcaster. On the owner's service, writes are switched on, the app's own Post box and buttons are built to post as a persona (test data only, waiting for a deploy), and no real post from that service is on record yet. [What reaches Farcaster](/start/farcaster) has the detail.

### Why is X on a map about Farcaster?

Because that is where most people's history and friends are. The plan brings both over for free: your posts as a dated shelf, and your people found on Farcaster. Posting back to X costs money per post, so it waits.

### Will my old tweets keep their dates?

Inside Totem, yes: the shelf shows each tweet's original X date. On Farcaster, a re-post carries today's date and says "originally on X" with the old date. [Backdating](#backdating) explains why.

### Is the anon account the real @anoncast?

No. It is Totem's own account, built on the same idea. It runs only on the owner's private service, and it has not posted for real yet.

### Who can tell that two accounts are both me?

Other people on Farcaster see separate accounts, unless you link them yourself, for example by having two of them reply to each other. Neynar can join them, because it runs them all under one key. The people you put in your rings can, inside Totem (built, test data only, deployed 2026-10-12). {cite: SECURITY-POSTURE.md > "14. Network identities (Multi-FID pass): what the network, Neynar and the validator learn about persona accounts and anon posts"}

## Read more

- [Bring your X](/start/bring-your-x): the X plan, part by part.
- [What reaches Farcaster](/start/farcaster): action by action, on each site.
- [Anonymous posts](/features/anon-posting): the anon account in full.
- [Who sees what](/start/who-sees-what): rings, and showing a friend.

## Notes and sources {#notes}

- **Status of every part.** The app's one status list, `lib/status/features.ts`, checked on 2026-10-07 against the code, the public preview and the owner's private service. Where the map's four marks are coarser than that list, the list wins.
- **Neynar's cast request has no date.** Neynar API reference, [Post a cast](https://docs.neynar.com/reference/publish-cast): the body takes `signer_uuid`, `text`, `embeds`, `parent`, `parent_author_fid`, `channel_id` and `idem`. Totem's own call in `lib/fc/writes.ts` sends `signer_uuid`, `text` and, for a reply, `parent`.
- **The protocol allows past dates.** Farcaster docs, [Messages: Timestamps](https://docs.farcaster.xyz/learn/what-is-farcaster/messages): timestamps are unverified, users can backdate them like a blog post, and the network rejects ones too far in the future (that page says 15 minutes). The [protocol specification](https://github.com/farcasterxyz/protocol/blob/main/docs/SPECIFICATION.md) and [Snapchain's message validation](https://github.com/farcasterxyz/snapchain/blob/main/src/core/validations/message.rs) set the limit at 600 seconds ahead, with no lower limit for casts; Snapchain's "too far in the past" check applies only to storage-lending messages. Neynar's API schema describes a message timestamp as within 10 minutes of the time it was made; that text conflicts with the protocol docs and the code, so Neynar's handling of a self-signed backdated message (sent through `POST /v2/farcaster/message`) is unverified.
- **Storage and pruning.** The same Farcaster page: 5,000 casts per storage unit, and when an account is over its limit the oldest message is pruned first.
- **Imported tweets keep their dates.** `lib/x/importer.ts` stores each tweet's original `createdAt`. The resurface switch adds a separate fresh time for Totem feeds and leaves `createdAt` as it was.
- **Anon timing.** `lib/zk/config.ts` (a 30 second to 15 minute wait, 320 characters, one post per window) and `validator/zk.js` (6-hour window, the hourly batch plus up to 10 minutes, and the network date is the batch time, not the moment you pressed post). `lib/feed.ts` leaves anon posts out of follows-only modes and does not run rules on them.
- **Anon reveal.** `lib/zk/anonAttribution.ts` and `components/AnonRevealControl.tsx`. The reveal addition has not finished its safety reviews.
- **X verifications.** The Farcaster client API's account-verifications list, documented in the [Farcaster API reference](https://docs.farcaster.xyz/reference/farcaster/api): no key, open to browsers, and about 397,000 X verifications in a read-only count on 2026-10-07.
- **X prices.** [X API pricing](https://docs.x.com/x-api/getting-started/pricing), read in October 2026: pay per use, no free tier.
- **The plans.** Bring your X, connect your main account, the anon account and Show to a friend follow the owner's build plan of 2026-10-07. Nothing here is called live until it has run on the site it describes.
