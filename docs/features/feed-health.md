---
pageClass: eli5
---

# Reading, health and delivery

Know when you are caught up, read long articles a piece at a time, and decide how each account shows up in each mode.

::: tip Status: works live, on preview posts; on your real Following, built on test data
The caught-up banner, delivery tiers and the reading knobs work on the public preview and the owner's service. On your real Farcaster Following (when you act as yourself), reading pieces, desk notes and posts a friend's ring sends you are built and tested on test data, not deployed yet. No desk exists on the live site yet, so desk notes there have nothing to show. Folder cards and community notes still appear on preview posts only.
:::

## At a glance

<ol class="flow">
  <li><strong>You</strong>Scroll until the feed has nothing new for you</li>
  <li class="flow__us"><strong>Totem</strong>Says "you're caught up" instead of padding the feed</li>
  <li class="flow__us"><strong>Totem</strong>Below the banner, offers the next piece of a long article you saved</li>
  <li><strong>You</strong>Read it. Once you have spent long enough on it, it stops coming back</li>
</ol>
<p class="flow__note">How many pieces, how long each one is, and which folders come first are all yours to set.</p>

## The parts

**Caught up.** When you have seen what is new, a banner says so, and a signal tracks when one story is saturating your feed.

**Reading pieces (Readwise).** Long articles are cut into short pieces that turn up in your feed. You choose how many per refresh, how long each piece is, and which folders come first. Dismissing a piece moves it to a bin you can restore from. A piece you skipped keeps coming back, and the app tells you how many times you have skipped it. {cite: notes/reports/REPORT-POST.md > "GATE 4 — Readwise: the knobs and the dwell mechanic"}

**How "read" is decided.** A piece counts as read once it has been on screen for about half the time it takes to read its words at 240 words a minute, with a short minimum. That is the whole formula: no model of your memory, no difficulty score. {cite: notes/reports/REPORT-POST.md > "GATE 4 — Readwise: the knobs and the dwell mechanic"}

**Delivery tiers.** For each account, in each mode, choose how loudly it reaches you:

- **Never miss**: one of its posts is pinned near the top of your feed. <!-- uncited-ok: "never miss" is the tier's name, not a privacy claim -->
- **Banner**: its posts show in a strip above your feed.
- **Normal**: the default.
- **Facet only**: you see only its posts on the topics of its that you follow.
- **Quiet**: its posts are pushed down.

A delivery tier is not an audience tier (who sees your personas) or a reputation tier (a level you earn). "Never miss in my personal mode, quiet in work" is one setting on one account. Never miss pins one post per account, so marking a friend never miss does not fill your feed with only them. {cite: notes/reports/REPORT-POST.md > "GATE 3 — Per-account delivery tiers"}

## On your real Farcaster Following

These work only while you act as yourself (You in the account menu), on the posts your browser read for your Following. Built and tested on test data, not deployed yet.

**Reading pieces.** A long Farcaster post (80 words or more, the shortest piece the length slider allows) or one with a link to read is a reading piece: the same time-on-screen measure, the same "read" mark, the same bin, and a piece you leave unfinished comes back further down your Following until you finish it or bin it. A Farcaster post is one piece: the length slider cuts saved articles, not posts. {cite: SECURITY-POSTURE.md > "39. Readwise and the extras on real posts: reading pieces, desk notes and close-friend sends on your real Following, and what each party sees"}

**Desk notes.** A note from a desk you subscribe to shows on the Farcaster post it is about, and a post you liked or recast comes back into your Following when a desk notes it, instead of a notification. No desk exists on the live site yet, so this is checked on test data only. {cite: SECURITY-POSTURE.md > "39. Readwise and the extras on real posts: reading pieces, desk notes and close-friend sends on your real Following, and what each party sees"}

**Posts a friend sends you.** Someone who has you in one of their rings can send the ring a Farcaster post. It shows in your Following as "Sent to you by" the name they chose, if your browser already read that post for your Following; if it has not, the page says how many were left out. {cite: SECURITY-POSTURE.md > "39. Readwise and the extras on real posts: reading pieces, desk notes and close-friend sends on your real Following, and what each party sees"}

### Does showing these read anything from Farcaster?

No. Every one of them is drawn from posts your browser already read for your Following and from your own sealed records: no extra request goes to Farcaster's network or to Totem's servers, and the time you spend on a piece is saved only inside your sealed reading record. {cite: SECURITY-POSTURE.md > "39. Readwise and the extras on real posts: reading pieces, desk notes and close-friend sends on your real Following, and what each party sees"}

### Could a friend send me a fake post?

No. A send carries only the post's id. Your browser shows its own copy, the one it read from Farcaster for your Following, or nothing at all. {cite: SECURITY-POSTURE.md > "39. Readwise and the extras on real posts: reading pieces, desk notes and close-friend sends on your real Following, and what each party sees"}

## The obvious questions

### Does Totem record how long I look at things?

Only for reading pieces, and only on your device first. The time is added up while a piece is at least half on screen and saved as one total when it leaves the screen, in a sealed record the server cannot open. Nothing is sent while you read. {cite: SECURITY-POSTURE.md > "17. Ergonomics (Post-deploy pass): what the persona cue promises, what the cross-persona view costs, what compartment mode is and is not, what a delivery tier decides, and what readwise records about the reader"}

### Is my reading progress per persona?

No. It is per person: a piece read as one persona counts as read for all of them, because one person did the reading.

### Can a pinned account bring back a post I have already seen?

No. A tier changes where posts sit, not which posts are there. If you have seen everything, a never-miss post does not come back above the banner. {cite: SECURITY-POSTURE.md > "17. Ergonomics (Post-deploy pass): what the persona cue promises, what the cross-persona view costs, what compartment mode is and is not, what a delivery tier decides, and what readwise records about the reader"}

### Can pinning an account overrule a flag on it?

No. An author that a curator or your own rules pushed down stays down. Never miss is you ordering your own feed, not a way around a flag. {cite: SECURITY-POSTURE.md > "17. Ergonomics (Post-deploy pass): what the persona cue promises, what the cross-persona view costs, what compartment mode is and is not, what a delivery tier decides, and what readwise records about the reader"}

### Who can see my delivery tiers?

Only you: the server stores them sealed. Which accounts you never want to miss, and which you have turned down, says a lot about what you care about, so the whole map is stored as one sealed record. {cite: SECURITY-POSTURE.md > "17. Ergonomics (Post-deploy pass): what the persona cue promises, what the cross-persona view costs, what compartment mode is and is not, what a delivery tier decides, and what readwise records about the reader"}

## Where it lives in the code

Feed health is its own adapter slot (see the [adapters page](/technical/adapters)); the mock version is `lib/adapters/mock/feedHealth.ts`. Reading pieces: `lib/readwise/state.ts` and `lib/injection.ts`. On your real Following: `lib/fc/hubRead/extras.ts` (pieces, desk notes and sends, through the same queue), `lib/fc/hubRead/extrasSource.ts` (what they are drawn from) and, for sends, `lib/rings/outbound.ts` and `lib/rings/received.ts`. Delivery tiers: `lib/delivery/tiers.ts`, compiled into ordinary rules for `lib/rules/evaluate.ts`. The pages: Settings, Readwise; Settings, Delivery; Settings, Feed Health. {cite: ARCHITECTURE.md > "Registry"}

## The record

For auditors: each line is tagged in the internal vocabulary and cites the report it comes from.

- **[SHIPPED]** The caught-up banner and saturation signal. {cite: notes/reports/REPORT-A.md > "GATE 3 — Caught-up banner — CLOSED (2 iterations)"}
- **[SHIPPED]** Feed health as an adapter slot with its own surface (see the adapters page for the interface). {cite: ARCHITECTURE.md > "Registry"}
- **[SHIPPED]** Per-account delivery tiers, sealed whole. {cite: notes/reports/REPORT-POST.md > "GATE 3 — Per-account delivery tiers"}
- **[SHIPPED]** Readwise knobs and the dwell mechanic. {cite: notes/reports/REPORT-POST.md > "GATE 4 — Readwise: the knobs and the dwell mechanic"}
- **[SHIPPED-FIXTURE]** Reading pieces, desk notes and ring sends on the real Farcaster Following (test data only; no desk on the live site yet). {cite: SECURITY-POSTURE.md > "39. Readwise and the extras on real posts: reading pieces, desk notes and close-friend sends on your real Following, and what each party sees"}
