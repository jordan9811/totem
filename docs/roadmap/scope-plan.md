# Scope plan: what's left to ship
<!-- uncited-ok: page: a plan and a status rundown; every status comes from lib/status/features.ts, the feature pages and the 2026-11-06 code check, and every privacy claim it relies on is made, and cited, on its own page -->

::: info Status: the plan as of 2026-11-06
Written against the code on 2026-11-06 (commit `5da490e`, deployed). It follows [First principles](/mission/first-principles): every spec says what it costs in privacy, and no spec trades persona separation for a feature.
:::

**The four words used here.** *Live*: works on ontotem.com and has been used for real. *Switched on*: deployed and on, but nobody has used it for real yet. *Built*: tested on test data only, not switched on for real. *Not built*: nothing exists yet.

## 1. Everything you've asked for, and where it stands

### Your real self in

| Feature | Status |
|---|---|
| Sign in with Farcaster, save with Face ID, open on a second device | Switched on: your first real run-through is still to confirm |
| Your Farcaster Following and Find your people (no Neynar) | Live: real profiles and threads load from Farcaster's network; your own Following still to see |
| Post as yourself (Totem's app account @ontotem) | Switched on, first real approval not done |
| "You" in the account menu; Reply, Like, Recast, Delete as yourself | Switched on, not used for real |
| Bring your X archive | Built |
| Find your X follows on Farcaster | Built, off (the nightly list needs switching on) |
| Sign in with X | Built, test data only; dormant until the owner's X developer app is armed |
| Post to X, sync from X | Built on the private service only |

### Who I am (personas)

| Feature | Status |
|---|---|
| Personas: main, finsta, alts | Live, inside Totem |
| Anonymous posting through @anonwire (the anoncast foundation) | Built and deployed, off until your moderator key |
| Reveal: prove a post was yours | Built, below the review bar |
| The @anon page and the Anon Wire Mini App | Built; the Mini App needs your signature in the Farcaster app |
| Launch: a persona gets its own Farcaster account | Built (needs a Totem registrar wallet) |
| Clone a persona | Built, no button |

### Who sees me (audience)

| Feature | Status |
|---|---|
| Rings, your Top 16 | Built and deployed, unused until anonymous posting is on |
| Show a persona to a friend | Built |
| "On my page, not in your timeline" | Not built |
| Hidden from people I pick | Not built |
| The server can't link you | Its data can't (no persona-to-root link stored). Its network view can, until an outside relay runs: our side is live, the relay operator is missing |

### What I see (the algorithm)

| Feature | Status |
|---|---|
| Modes, rules, lenses, delivery tiers, scroll zones | **The controls work, but not on real posts yet.** Your real Following skips them, and For You has no real source without Neynar |
| Readwise (reading knobs, dwell, the folder bin) | **Not operational on real posts**: it runs on sample long-reads only |
| Portable algorithms and the Algo Shelf (share, fork, lineage) | Built |
| Filter packs (network-state standards) | Built |
| Search | Live, but searches only what your device holds; no Farcaster search |
| For You from real Farcaster posts | Off: the Neynar relay is unarmed (a dependency risk since the sale) |
| Topic labels (the channels and hashtags fix) | Not built |
| Time travel (Super Bowl 50, the Drake meme) | Not built |

### Accountability and reputation

| Feature | Status |
|---|---|
| Curator desks: signed annotations with evidence; you pick badge, demote or auto-block (verifiable boycotts) | Built |
| Refutations weighted by tier (King of the Hill), concur or dispute | Built |
| Correction cards: a post comes back in your timeline when it gets noted | Built, sample posts only |
| 3-strike relationship history | Built |
| Verified claims (attestations) | Built; the zkTLS checker is not built |
| Reputation tiers, proven without saying who you are | Built; activity is self-reported |
| Reach tiers for anonymous posts | Built on the private service only |
| UBI allowance and stakes | Built; waits on your curve decisions |

### Social and money

| Feature | Status |
|---|---|
| Close friends send posts into your timeline | Built ("sent posts"), sample posts only |
| Pay-to-DM chat, Spaces, Market, ads | Built |
| Dutch-auction ad marketplace | An idea, not designed |
| Notifications, channels, DMs from real Farcaster | Not built |

## 2. The three biggest gaps

1. **The algorithm dial doesn't touch real posts.** The tinkering you designed (modes, rules, lenses, packs, delivery tiers, readwise) is built, but the real feed doesn't go through it, and For You has no source without Neynar.
2. **Personas can't read Farcaster without risking a link.** Tonight's rule (nothing is read as you while a persona acts) is right, so a persona's own feed of real Farcaster posts needs reads that come from nobody: the outside relay.
3. **The foundation isn't live.** @anonwire and rings are deployed and switched off.

## 3. The plan, in waves

- **Wave 1: make what's built real** (no outside dependency except your moderator key)
  - A. The algorithm dial on real posts
  - B. For You without Neynar
  - C. Readwise, correction cards and close-friend sends on real posts
  - @anonwire and rings on (your moderator key)
- **Wave 2: personas that read and reach** (needs the relay operator)
  - D. The outside relay, closing the last mechanical link
  - E. Personas that read Farcaster
- **Wave 3: the vision**
  - F. Topic labels
  - G. The visibility ladder
  - H. The Algo Shelf and boards for real
  - I. Accountability boards and verifiable boycotts with zkTLS
  - J. Time travel
  - K. Reputation that moves between personas, live
- **Moved up (2026-11-06, the owner):** Sign in with X and real Farcaster notifications are foundational and now in progress; the ad auction has its own detailed spec: [the Dutch-auction ad marketplace](/roadmap/ad-auction). The vision pieces (Wave 3) are lower priority.
- **Wave 4: the backlog.** Posting to X, Launch, real DMs.

## 4. The specs

Each spec gives the goal, what v1 includes and leaves out, how it reuses what exists, the privacy check against personas, what it needs from you, its size (S, M, L, XL) and when it's done.

### A. The algorithm dial on real posts
- **Goal:** your modes, rules, lenses, packs and delivery tiers decide your real Following.
- **v1:** the hub timeline's casts run through the same rule evaluator and ranking the sample feed uses (`lib/rules/evaluate.ts`, `lib/feed.ts`). The mode pill re-ranks and filters real posts; delivery tiers ("never miss" or "quiet" per account) apply; an attached pack filters. **Out:** engagement-weighted ranking (Farcaster's node keeps no like counts, so ranking uses recency, author, words, links, replies, mentions and your own likes).
- **Privacy:** all on your device, no new reads, separation unchanged.
- **Size:** M. **Done when** switching mode changes what your real Following shows, proven in the production-shape suite.

### B. For You without Neynar
- **Goal:** a discovery feed from Farcaster's own network that you can tune.
- **v1:** candidates are posts your follows recently liked or recast, plus recent posts from the accounts most followed among your follows, read straight from the node with the same caps as Following (8 at a time, bounded per load). They're ranked by your mode.
- **Privacy:** reads only while you act as yourself, never naming a persona; while a persona acts, nothing until spec E.
- **Size:** L. **Done when** For You fills with real posts and Neynar stays off.

### C. Readwise, correction cards and close-friend sends on real posts
- **Goal:** the reading tools work on real posts.
- **v1:**
  - Long casts and casts with an article link count as reading pieces, so dwell, the folder weight and the bin work on them.
  - Annotations from desks you subscribe to attach to real casts by hash, and the post comes back into your timeline when it gets noted.
  - Posts a friend sends you splice into your real Following.
- **Privacy:** dwell stays in a sealed vault record; sends travel through the encrypted ring mailbox.
- **Size:** M.

### D. The outside relay
- **Goal:** our server never sees your internet address on anything a persona does.
- **v1:** a relay operator (Cloudflare's OHTTP Relay or Fastly's, by request; or an independent group running open-source relay software), then `ZK_RELAY=ohttp` and `ZK_RELAY_THIRD_PARTY=true` on the live site. Ring-mailbox reads move onto it too. Our gateway is already live.
- **Needs from you:** "send" on the drafted requests.
- **Size:** S once a relay exists.

### E. Personas that read Farcaster
- **Goal:** a persona has its own Following of real Farcaster accounts, and neither the node nor our server can tie it to you.
- **v1:** a persona's follows stay sealed in your vault. Its reads go through the outside relay to a read gateway, which fetches public posts per account, at jittered times and cached, so the set of accounts it reads never arrives as one recognisable bundle.
- **Privacy:** an unusual set of follows is a fingerprint, so reads are per account, spread out, and shared with everyone's cache.
- **Needs:** D. **Size:** L.

### F. Topic labels (the channels and hashtags fix)
- **Goal:** label a post by topic. People subscribe to a persona's label, you decide who can see each label, and modes can read labels ("astronomy mode").
- **v1:** labels belong to a persona (a label is that persona's channel); subscribe per label; a label directory and search; a rule can filter by label; each label gets a visibility rung (spec G).
- **Privacy:** the same unusual label set on two personas links them, so labels are scoped per persona, never suggested across personas, and subscriptions are sealed.
- **Decision for you:** should a public label also show in other Farcaster apps (as a link or channel), or stay Totem-only?
- **Size:** L.

### G. The visibility ladder
- **Goal:** broadcast, then on my page but not in your timeline, then my rings only, then hidden from people I pick, then unfindable.
- **v1:** "page-only" and "hidden from" for Totem-held posts, built on the private-post machinery that exists (`/api/private/*`). Anything below broadcast is encrypted, the server stores ciphertext, and readers are on Totem.
- **Privacy:** viewer lists sealed; fetches over the relay once D exists.
- **Size:** L.

### H. The Algo Shelf and boards for real
- **Goal:** fungible, shareable algorithms, like Pinterest boards: publish, browse, preview against your own feed, fork.
- **v1:** publish a mode, lens or pack as its persona; boards collect algorithms and posts; your feed previews exactly before you adopt anything; the lineage travels with it.
- **Privacy:** publishing strips personal weights and account lists unless you add them on purpose, because a tuned algorithm is a fingerprint.
- **Size:** M (the artifact, signing, guardrails and shelf exist).

### I. Accountability boards and verifiable boycotts
- **Goal:** pin proof to public conduct, so subscribers act on it (badge, demote, auto-block) and the subject can answer.
- **v1:**
  - A board is a desk's signed list of entries: who, the claim, the evidence and its standing.
  - Subscribers' actions apply at read time.
  - The subject gets a right of reply.
  - Disputes go through refutation edges.
  - Entries are limited to public figures and public conduct, with moderation.
  - Evidence is an attestation or a zkTLS proof.
- **Privacy:** board authors post as personas, and a zkTLS proof made under your own logged-in session must redact anything that identifies the session.
- **Decision:** which zkTLS stack (TLSNotary, Reclaim or vlayer: I'll research and recommend).
- **Size:** XL.

### J. Time travel
- **Goal:** see the timeline as it was on a date, or around an event or meme.
- **v1:** go to a date in your own Farcaster Following (follows and casts carry timestamps on the node). **Later:** topic and meme search needs a text index over Farcaster's history (our own indexer, or a paid search API), and X history exists only in archives people bring.
- **Size:** M for date travel; XL for topic search.

### K. Reputation that moves between personas, live
- **Goal:** carry standing into a persona as a proof, never as a copied number.
- **v1:** the live proof universe with real members; activity Totem checks from public Farcaster data instead of self-reports; a persona proves "in tier T" drawn from a crowd above the floor.
- **Size:** L.

## 5. Decisions only you can make

1. Public labels in other Farcaster apps, or Totem-only (F)?
2. The UBI curve (open since September).
3. The wave order. My recommendation: Wave 1 now, starting with A.
