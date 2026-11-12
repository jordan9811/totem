# How it works underneath

The mechanism design behind Totem, for readers who want the parameters, the adversary and the gaps.

::: warning Status: the custody layer works live; most of the rest is built on test data
On the public preview your browser mints the seed, derives every key and seals your data before the server stores it. The ZK membership layer, the anon relay, stakes, attestations and the ad market are built and tested on test data only. The read relay is built and switched off until the owner arms it. The privacy label reads DEMO on every deployment, and these pages say exactly which conditions fail. {cite: SECURITY-POSTURE.md > '4. What "private" means on the label, exactly'}
:::

Totem separates who you are (one root) from who you post as (many personas) with three mechanisms. A key hierarchy derives every persona from one 32-byte seed, so knowing one persona does not let anyone compute another. Browser custody keeps that seed and every private key in your browser, so the server stores ciphertext, commitments and public keys. A Semaphore v4 membership layer is meant to let a persona prove its root's standing without the validator learning which root. The first two are running for real. The third is real code that produced real proofs on the laptop rig, and it hides nothing on any deployment yet: the public preview proves in a test universe whose "proofs" are tags under a public key, and on the owner's private service one person holds the seed and runs the validator, so there is no one to hide from and no crowd to hide in. {cite: notes/design/architecture-v3.md > "The thesis, stated as invariants"} {cite: SECURITY-POSTURE.md > "8. Topology — the assumption everything rests on"}

## At a glance

<ol class="flow">
  <li><strong>Seed</strong>32 random bytes minted in your browser. The 24 words are the same bytes.</li>
  <li><strong>Personas</strong>Each persona's keys come off the seed through its own HKDF branch.</li>
  <li class="flow__us"><strong>Vault</strong>Everything private is sealed with AES-256-GCM before it leaves the browser.</li>
  <li class="flow__soon"><strong>Proofs</strong>A persona proves "my root is in tier T" without naming the root. Test universe only.</li>
  <li class="flow__soon"><strong>Network</strong>Public personas post to Farcaster as separate accounts. Owner service only, none created yet.</li>
</ol>
<p class="flow__note">Dashed steps are built but not running for real. The table below says where each one stands.</p>

<figure class="diagram">
<svg viewBox="0 0 400 384" role="img" aria-labelledby="mi-t mi-d" xmlns="http://www.w3.org/2000/svg">
<title id="mi-t">Where each request goes on the public preview</title>
<desc id="mi-d">The browser is the device. It talks to the validator with signed envelopes carrying ciphertext, and to the app server for pages and relayed reads. The app server reads from Neynar only on a cache miss, inside a daily budget. The owner service is a separate pair where one server holds the owner's seed.</desc>
<defs><marker id="mi-a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="dg-head" d="M0 0L10 5L0 10z"/></marker></defs>
<rect class="dg-box dg-box--device" x="1" y="1" width="398" height="94" rx="10"/>
<text class="dg-title" x="200" y="26" text-anchor="middle">Your browser: the device</text>
<text class="dg-sub" x="200" y="48" text-anchor="middle">holds the seed and every private key</text>
<text class="dg-sub" x="200" y="66" text-anchor="middle">answers the app's /api/* inside the page</text>
<text class="dg-sub" x="200" y="84" text-anchor="middle">seals data before it is saved</text>
<line class="dg-line" x1="95" y1="95" x2="95" y2="148" marker-end="url(#mi-a)"/>
<text class="dg-tiny" x="103" y="126">signed, sealed</text>
<line class="dg-line" x1="305" y1="95" x2="305" y2="148" marker-end="url(#mi-a)"/>
<text class="dg-tiny" x="313" y="126">pages, reads</text>
<rect class="dg-box dg-box--server" x="1" y="150" width="188" height="100" rx="10"/>
<text class="dg-text" x="95" y="174" text-anchor="middle" font-weight="600">Validator</text>
<text class="dg-sub" x="95" y="196" text-anchor="middle">ciphertext records</text>
<text class="dg-sub" x="95" y="214" text-anchor="middle">public keys, anchors</text>
<text class="dg-sub" x="95" y="232" text-anchor="middle">commitments, trees</text>
<rect class="dg-box dg-box--server" x="211" y="150" width="188" height="100" rx="10"/>
<text class="dg-text" x="305" y="174" text-anchor="middle" font-weight="600">App server</text>
<text class="dg-sub" x="305" y="196" text-anchor="middle">public pages</text>
<text class="dg-sub" x="305" y="214" text-anchor="middle">passkey release key</text>
<text class="dg-sub" x="305" y="232" text-anchor="middle">read relay (off for now)</text>
<line class="dg-line dg-line--soon" x1="305" y1="250" x2="305" y2="294" marker-end="url(#mi-a)"/>
<text class="dg-tiny" x="313" y="276">cache misses</text>
<rect class="dg-box dg-box--network" x="211" y="296" width="188" height="84" rx="10"/>
<text class="dg-text" x="305" y="320" text-anchor="middle" font-weight="600">Neynar, Farcaster</text>
<text class="dg-sub" x="305" y="342" text-anchor="middle">read-only, budgeted</text>
<text class="dg-sub" x="305" y="360" text-anchor="middle">no writes from here</text>
<rect class="dg-box dg-box--soon" x="1" y="296" width="188" height="84" rx="10"/>
<text class="dg-text" x="95" y="320" text-anchor="middle" font-weight="600">Owner service</text>
<text class="dg-sub" x="95" y="340" text-anchor="middle">a separate pair: one</text>
<text class="dg-sub" x="95" y="356" text-anchor="middle">server holds the owner's</text>
<text class="dg-sub" x="95" y="372" text-anchor="middle">seed; nothing posts yet</text>
</svg>
<figcaption>The public preview. Nothing private crosses the two arrows from the browser in the clear. The read relay is built and dormant.</figcaption>
</figure>

## Read this first

Six words say how real something is. They mean the same thing on every page of this site.

| | |
|---|---|
| <span class="st st--live">Works live</span> | Runs on a deployed service and was checked there. |
| <span class="st st--test">Built, test data only</span> | Implemented with green tests. Has not run against the real network or real users' data. |
| <span class="st st--designed">Designed</span> | Written down. No code. |
| <span class="st st--off">Off on purpose</span> | Built and deployed, switched off until the owner arms it. |
| <span class="st st--soon">Coming soon</span> | Part of the product's promise, not built yet. |
| <span class="st st--na">Not offered here</span> | The site named does not offer it, by design. It is not waiting to be switched on. |

"Built" is the word this project has overstated before, so it gets the longest list below.

## What works today

| Mechanism | Today | Page |
|---|---|---|
| One seed, HKDF branches, persona keys | <span class="st st--live">Works live</span> in every visitor's browser | [Key hierarchy](/mechanism/key-hierarchy) |
| Vault sealing (AES-256-GCM, one padded record per namespace) | <span class="st st--live">Works live</span> | [Browser custody](/mechanism/custody) |
| Saving with a passkey or the 24 words | Deployed on the public preview; its automated checks ran on a local production-shaped copy | [Browser custody](/mechanism/custody) |
| Linking a second device, linking two roots | <span class="st st--test">Built, test data only</span> | [Browser custody](/mechanism/custody) |
| Signing in with Farcaster (an identity link, not a way to save) | <span class="st st--test">Built, test data only</span> on the public preview, deployed 2026-10-11; not offered on the owner service | [Sign in with Farcaster](/mechanism/sign-in-with-farcaster) |
| Posting as your own Farcaster account (Allow Totem to post as you: a key in your vault, approved in the Farcaster app) | <span class="st st--test">Built, test data only</span> in use: deployed and switched on (Totem's app account armed on the live site since 2026-11-05), the first real approval not done yet {cite: SECURITY-POSTURE.md > "35. Post as you: your own Farcaster account's key, Totem's app account, and what each party sees"} | [Post as you](/mechanism/post-as-you) |
| Your Farcaster Following and Find your people, read by your browser from a Farcaster node (no Neynar) | <span class="st st--test">Built, test data only</span> on the public preview, not deployed; measured read-only on the real node {cite: SECURITY-POSTURE.md > "36. Following from the hub: your Farcaster graph, read by your browser from a Farcaster node, and what each party sees"} | [Following from the hub](/mechanism/following-from-the-hub) |
| Your Farcaster notifications (new followers, mentions, replies, likes and recasts) with an unread badge, read by your browser from a Farcaster node (no Neynar) | <span class="st st--test">Built, test data only</span> on the public preview, not deployed; measured read-only on the real node {cite: SECURITY-POSTURE.md > "37. Notifications from Farcaster: your followers, mentions, replies, likes and recasts, read by your browser from a Farcaster node"} | [Notifications from Farcaster](/mechanism/notifications-from-farcaster) |
| For You from your own Farcaster graph: what the people you follow liked, recast and follow, ordered by your mode, read by your browser from a Farcaster node (no Neynar) | <span class="st st--test">Built, test data only</span> on the public preview, not deployed; measured read-only on the real node {cite: SECURITY-POSTURE.md > "40. For You from the hub: what the people you follow liked and follow, read by your browser from a Farcaster node, and what each party sees"} | [For You from the hub](/mechanism/for-you-from-the-hub) |
| Signing in with X (an identity link, not a way to save; X's code redeemed by the validator's stateless relay) | <span class="st st--test">Built, test data only</span>, not deployed, dormant until the owner arms it {cite: SECURITY-POSTURE.md > "38. Sign in with X: what X, the app server and the validator learn"} | [Sign in with X](/mechanism/sign-in-with-x) |
| ZK membership, tiers, the For You gate | <span class="st st--test">Built, test data only</span> | [ZK membership](/mechanism/zk-membership) |
| The anon relay | <span class="st st--test">Built, test data only</span> on the owner service, never run live; <span class="st st--test">Built, test data only</span> on the public preview too, not deployed: the prover in your browser, posts that stay inside the preview; posting to Farcaster from there is <span class="st st--soon">Coming soon</span> {cite: notes/runbooks/GO-LIVE-FARCASTER.md > "(f) The anon account (optional)"} {cite: SECURITY-POSTURE.md > "27. Anonymous posting from the public site (Persona launch P7): the prover in your browser, the web channel, and what the operator sees"} | [The anon relay](/mechanism/anon-relay) |
| Grants, private personas, root links | <span class="st st--test">Built, test data only</span>; resolves inside one vault | [Linkage and disclosure](/mechanism/linkage-and-disclosure) |
| Rings (your Top 16), the ring drop, a ring note on every anon post, the `/d` link card | <span class="st st--test">Built, test data only</span> on both sites, deployed 2026-10-12; the public preview has no anon posts to note yet, and on the owner service rings reach its own validator only {cite: SECURITY-POSTURE.md > "24. Rings and ring notes (Persona launch P4): what the drop, the operator and a member learn"} | [Rings and ring notes](/mechanism/rings) |
| Reach tiers (follower buckets) and the For You boost | <span class="st st--test">Built, test data only</span> on the rig, deployed 2026-10-12; <span class="st st--soon">Coming soon</span> on the public preview, which also needs an issuer Totem runs {cite: SECURITY-POSTURE.md > "25. Reach tiers (Persona launch P5): what a boosted anon post says, and the crowd floor"} | [Reach tiers](/mechanism/reach-tiers) |
| Launch: a persona's own account, the batch reveal | <span class="st st--test">Built, test data only</span> on the rig, against a SIMULATED registrar and chain, deployed 2026-10-12; <span class="st st--soon">Coming soon</span> on the public preview {cite: SECURITY-POSTURE.md > "26. Launch (Persona launch P6): a persona's own account, on test data"} | [Launch and the registrar](/mechanism/launch) |
| The @totem X outbox: anonymous copies to X, moderated first | <span class="st st--test">Built, test data only</span> on the rig, not deployed; a test transport, nothing reaches X; <span class="st st--soon">Coming soon</span> on the public preview {cite: SECURITY-POSTURE.md > "28. The @layers X outbox (Persona launch P8): anonymous copies to X, moderated first, on a test transport"} | [The @totem X outbox](/mechanism/x-outbox) |
| Reputation, the influence allowance, stakes | <span class="st st--test">Built, test data only</span>; no money | [Reputation and stakes](/mechanism/reputation-and-stakes) |
| The ad market and its floor | <span class="st st--test">Built, test data only</span>, on a simulated ledger | [The ad market](/mechanism/ad-market) |
| The Dutch-auction ad marketplace | <span class="st st--soon">Coming soon</span>; not designed | [The ad market](/mechanism/ad-market) |
| Attestations and the onchain issuer | <span class="st st--test">Built, test data only</span> | [Attestations](/mechanism/attestations) |
| Live Farcaster reads on the public preview | <span class="st st--off">Off on purpose</span> | [The read relay](/mechanism/read-relay) |
| Personas as real Farcaster accounts | Built and ready on the owner service; none created as of 2026-10-07 | [Key hierarchy](/mechanism/key-hierarchy) |

## Two deployments, two threat models

**The public preview** is multi-tenant and keyless. Every visitor's browser is their own device: it holds the seed and answers the app's API inside the page, and the app server holds no identity to answer with. The validator stores one opaque sealed record per namespace, keyed by the root's anchor. The boot contract refuses every live write credential, so nothing a visitor does here reaches Farcaster. {cite: SECURITY-POSTURE.md > "16. Custody and topology (Browser keystore pass): what the browser holds, what the server holds, what each save path trusts, what root linking does and does not do"}

**The owner service** is a separate app and validator pair, gated by a passphrase, run in rig shape for one person: the owner's seed sits in a plain file on a Railway volume, the server derives each persona's keys, and live writes would go through Neynar managed signers. As of 2026-10-07 nothing posts as a persona: no persona has an account, and on the deployed service the owner app's Post, Like and Follow buttons save inside Totem only (the build that sends them to Farcaster as a persona is built, test data only, and waits for a deploy). The one live cast path is the owner's command line, as a shared test account, and no cast from the deployed service is on record. The gate is the owner's passphrase, or, once the passkey build is deployed, Face ID / fingerprint added on a device after a passphrase sign-in. Its validator is reachable only over the platform's private network. Here the user, the seed holder and the validator operator are the same person, so "hidden from the server" has no one to hide from. {cite: SECURITY-POSTURE.md > "18. The owner service (PROD-LIVE): a hosted rig for one person, and what it trusts"}

**The laptop rig** is where the sweeps run. It holds a development keystore on disk and the seeded demo world.

A statement on these pages of the form "the validator learns X" matters on the public preview. On the owner service, read every such statement as "the owner learns X", which is no loss.

## The pages

- [One root, many personas](/mechanism/key-hierarchy): the derivation tree, from the seed to every key.
- [Browser custody](/mechanism/custody): how the seed is saved, unlocked, linked and recovered, and what the server holds.
- [ZK membership and tiers](/mechanism/zk-membership): Semaphore v4, epochs, nullifiers, the cohort floor, and what the validator learns and what it does not.
- [The anon relay](/mechanism/anon-relay): K slots per person per window (4 by default), each post made as a persona, store-and-forward, the reveal, and why one owner is a crowd of one.
- [Rings and ring notes](/mechanism/rings): HPKE envelopes in a public, shuffled drop every device reads whole; a 256-byte note on every anon post, bound into the proof.
- [Reach tiers and the crowd floor](/mechanism/reach-tiers): follower buckets as issuer trees, the floor of 50 enforced five times, the For You label and head start.
- [Launch and the registrar](/mechanism/launch): the anonymous launch request, the 2 to 48 hour batch, the all-or-nothing reveal checked against the key registry, and privacy rules R1 to R3 and R6 to R9.
- [Sign in with Farcaster](/mechanism/sign-in-with-farcaster): identity, not custody; the browser verifies a sign-in and the server sees none of it.
- [Sign in with X](/mechanism/sign-in-with-x): your X account as you; PKCE in the tab, one stateless relay step on the validator because X answers no browser CORS, the token revoked at once, and what X, the app server and the validator each see.
- [Post as you](/mechanism/post-as-you): your own account from the Post box; a key made and sealed in your browser, approved in the Farcaster app, checked on Farcaster's network, every post relayed unchanged.
- [Following from the hub](/mechanism/following-from-the-hub): your own Farcaster graph on the Following tab, read by your browser from a Farcaster node: the measurements, the 1,000-account cap, 8 requests at a time, the exact order, and what the node sees.
- [Notifications from Farcaster](/mechanism/notifications-from-farcaster): your followers, mentions, and the replies, likes and recasts on your newest posts, grouped like X, read by your browser from a Farcaster node: the node's per-shard pages, the window, the unread badge and the sealed seen record, and what each party sees.
- [For You from the hub](/mechanism/for-you-from-the-hub): For You from your own Farcaster graph, read by your browser from a Farcaster node: the activity sample, the posts your follows liked and the accounts several of them follow, the keyed half that keeps a skipped account from naming a persona, your mode over follow-based counts, and what each party sees.
- [Linkage and disclosure](/mechanism/linkage-and-disclosure): grants, root links and forks; the dead drop for friends is built as rings.
- [Reputation, influence and stakes](/mechanism/reputation-and-stakes): the rep score, the per-epoch allowance, the accrual curve.
- [The ad market](/mechanism/ad-market): audiences, the k-floor, measurement, the simulated ledger, the Dutch auction that is not designed yet.
- [Attestations and issuers](/mechanism/attestations): the open issuer interface, buckets as trees, honour by key.
- [The read relay](/mechanism/read-relay): a server-held read key, five operations, a daily credit budget.
- [Trust assumptions](/mechanism/trust-assumptions): every party, what it sees, what it can do, what stops it.

## How these pages cite

Each claim about privacy carries a small reference to the section of `SECURITY-POSTURE.md` or the pass report that states it, checked by `npm run docs:check`. `npm run docs:sync` flags a page when a cited section changes after the page was written. Parameters taken straight from code name the file instead, under "Where it lives in the code". When a page and the posture document disagree, the posture document wins, and the page is the bug.
