---
pageClass: eli5
---

# Your feed: modes and rules

Read differently depending on what you are doing: a mode for work, one for friends, one for catching up, each with its own rules and buttons.

::: tip Status: works live on preview posts; on your real Following, built and tested, not deployed yet
Modes, rules, filter packs, the button row and refresh-with-undo work on the public preview and the owner's service. On the public preview they act on the preview's own posts. Your real Farcaster Following (when you sign in with Farcaster) now runs your mode too: built and tested on test data, not deployed yet. Scroll zones work with a mouse and in tests; they have not been tuned on a real phone yet.
:::

## At a glance

<ol class="flow">
  <li><strong>You</strong>Pick a mode: Default, Work, Event Safe Space or Curate, or build your own</li>
  <li class="flow__us"><strong>Totem</strong>Builds the feed for that mode: its ranking, then its rules</li>
  <li class="flow__us"><strong>Totem</strong>Hides, pushes down or flags what your rules match</li>
  <li><strong>You</strong>Read, and act with that mode's own row of buttons</li>
</ol>
<p class="flow__note">On the public preview this all runs in your browser. A rule's preview shows what it would catch before you save it.</p>

A **mode** is a named way of reading. It has a ranking, a set of rules, a lens if you pin one, its own row of action buttons and its own reading settings. A **rule** is a filter you build: when a post matches, the rule hides it, pushes it down or flags it. Two more actions, pin and banner, belong only to the delivery settings on your own device. {cite: notes/reports/REPORT-POST.md > "GATE 3 — Per-account delivery tiers"}

## The parts

**Modes and personas.** Any persona can read in any mode, and you can act as any of your personas from any mode. A mode can also be pinned to a persona, so switching to it switches who you post as.

**Filter packs.** Ready-made sets of rules that look at what is happening on the network, such as a story many people are piling on.

**Refresh with undo.** Pulling in new posts can be undone, so you never lose your place to an accidental refresh. <!-- uncited-ok: a statement about the interface, not a privacy claim -->

**The button row.** Each mode can have its own row of action buttons under every post. Press and hold a button (or right-click on a computer) to swap it for another action: stake, save to a folder, send to a friend, mark caught up, act as, refute, add a note or run a custom rule. The Default mode's row is exactly the row X has.

**Scroll zones.** You draw zones on your own screen: in a reading layout, scrolling inside the middle reads the article while scrolling at the edge moves the feed. Zones are kept per device and stored sealed. A zone that reaches into the edge your phone uses for its own gestures is refused, with the edge named.

## The obvious questions

### Do my rules leave my device?

Your rules are saved with your settings, like everything else Totem keeps for you. On the public preview the filtering itself runs in your browser, in the same rule engine that runs modes, packs and lenses.

### Can a rule I import pin someone to the top of my feed?

No. An imported rule set may only hide, push down or flag. Pinning and banners are refused by name in anything imported, because an imported rule that could pin an account to the top of your feed would be an ad slot. {cite: SECURITY-POSTURE.md > "17. Ergonomics (Post-deploy pass): what the persona cue promises, what the cross-persona view costs, what compartment mode is and is not, what a delivery tier decides, and what readwise records about the reader"}

### Do scroll zones work on my phone?

Probably, but nobody has measured them on a real phone yet. They were tested with simulated touches. Tuning on real phones is on the open list.

### Does any of this work on real Farcaster posts?

Yes, on your own Following (built and tested on test data, not deployed yet). When you sign in with Farcaster and act as yourself, the Following tab is the people your Farcaster account follows, and the mode pill above it switches what that tab shows. Your mode's rules hide or push down posts, an attached pack's lens and the mode's own lens order them, and the delivery setting you pick from a post's menu ("Never miss", "Banner", "Quiet") applies to that account in that mode. It is the same rule engine the preview's posts go through. A rule can now match a word in a post's text, in any case, which works on both. {cite: SECURITY-POSTURE.md > "36. Following from the hub: your Farcaster graph, read by your browser from a Farcaster node, and what each party sees"}

Three things work differently on real posts. A mode orders the posts your browser has already read and never reads more for itself, so it cannot change what Farcaster's network sees you read. Farcaster's network keeps no like, recast or reply counts, so anything in a mode or lens that ranks by them is listed on the page as not available on Farcaster posts, never quietly counted as zero. And a rule about an author's Totem tier or topic hides every real post, because a Farcaster account has neither, and the page says so. If your mode hides everything, the page says "Your mode hid all N posts", not that there are no posts. Some extras (community notes, folder cards and reading pieces) still only appear on preview posts, and For You has no real source yet. {cite: SECURITY-POSTURE.md > "36. Following from the hub: your Farcaster graph, read by your browser from a Farcaster node, and what each party sees"}

## Where it lives in the code

Rules: `lib/rules/evaluate.ts` (one evaluator for modes, packs, lenses and delivery tiers). Preset modes: `lib/adapters/mock/presets.ts`. The button row: `lib/actions/bindings.ts`. Scroll zones: `lib/zones/` and `components/ScrollZoneShell.tsx`. The feed itself: `lib/feed.ts`. Your mode on your real Following: `lib/fc/hubRead/mode.ts` (applies it) and `lib/fc/hubRead/modeSource.ts` (reads it from your browser's own records).

## The record

For auditors: each line is tagged in the internal vocabulary and cites the report it comes from.

- **[SHIPPED]** Persona × mode matrix; act as any persona from any mode. {cite: notes/reports/REPORT-UX.md > "GATE 1 — Persona × mode matrix, act-as-any-persona — CLOSED (13/13)"}
- **[SHIPPED]** Network-state filter packs (rules that consult network state). {cite: notes/reports/REPORT-B.md > "GATE 1 — Network-state filter packs — CLOSED (5/5)"}
- **[SHIPPED]** Timeline refresh with undo. {cite: notes/reports/REPORT-UX.md > "GATE 2 — Timeline refresh undo — CLOSED (8/8)"}
- **[SHIPPED-FIXTURE]** Configurable cast-action row per mode (bindings, long-press picker; the default row is identical to the X row). {cite: notes/reports/REPORT-MEGA2.md > "GATE 3 — Scroll zones + configurable action buttons"}
- **[SHIPPED-FIXTURE]** Scroll zones: a drawn calibration per device, presets, edge-gesture refusal; mobile is unmeasured. {cite: notes/reports/REPORT-MEGA2.md > "GATE 3 — Scroll zones + configurable action buttons"}
- **[SHIPPED-FIXTURE]** The active mode on the real Following (spec A): rules, packs, lens and per-account delivery tiers applied in the browser to the posts already read; count-based weights said, not used; built and tested on test data, not deployed. {cite: SECURITY-POSTURE.md > "36. Following from the hub: your Farcaster graph, read by your browser from a Farcaster node, and what each party sees"}
