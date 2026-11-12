---
pageClass: eli5
---

# Replies, notes and rooms

Threads, community notes, "this is wrong" links between posts, rooms and messages: the parts of Totem that need other people.

::: warning Status: built, test data only
Threads, notes, refutations and bookmarks work in the app, on the demo world's posts and people. Rooms are scripted text rooms; the audio stage is a labelled placeholder. Messages are a pay-to-message demo on a pretend ledger, not Farcaster direct messages. No real money moves.
:::

## At a glance

<ol class="flow">
  <li><strong>Someone</strong>Posts a claim</li>
  <li><strong>You</strong>Reply, add a note, or link a post that shows it is wrong</li>
  <li class="flow__us"><strong>Totem</strong>Shows a note once enough people back it, and shows the correction beside the claim</li>
  <li><strong>Readers</strong>See the claim and its correction together</li>
</ol>
<p class="flow__note">On the public preview there are no other real people yet, so these surfaces show the demo world.</p>

## The parts

**Threads and replies.** The usual, plus selective bookmarking: save one reply out of a thread rather than the whole thing, and see a thread resolved to what you care about.

**Community notes.** A note on a post appears once it has enough backing, including stakes marked "note-worthy". Volume alone does not decide a post's standing.

**Refutations.** A link from one post to another that says "this shows that one is wrong". Stakes marked "wrong" or "misleading" add to the correction card.

**Rooms.** Scripted text rooms in the style of Spaces. The audio part is a placeholder, and it says so.

**Messages.** "Pay to message: spam pays you". Someone who wants to reach you puts up a small amount, on a pretend ledger. It is a demo of the idea, not Farcaster direct messages.

## The obvious questions

### Can I message a real Farcaster user?

No. Messages are a demo inside Totem. Farcaster direct messages are not connected.

### Do notes and refutations work on real Farcaster posts?

Not yet. On the public preview, marking a real post as a refutation or backing a note on it is switched off, with the sentence "Posting to Farcaster isn't on this preview yet." When real posts are shown, notes are left off them for now.

### Is any money involved?

No. Every balance in messages, rooms and the market is on a pretend ledger.

## Where it lives in the code

Refutations: `lib/refutation/edges.ts`. Notes: `lib/curators/annotations.ts` and the feed health adapter. Rooms: `components/RoomStage.tsx`. Messages: `app/(main)/messages` on the escrow in `lib/market/escrow.ts`.

## The record

For auditors: each line is tagged in the internal vocabulary and cites the report it comes from.

- **[SHIPPED-FIXTURE]** Wave 4 social surfaces (threads, rooms, notes, refutation), on seeded content. {cite: notes/reports/REPORT-G.md > "GATE 1 — Wave 4: Social Surfaces — CLOSED (5/5)"}
- **[SHIPPED-FIXTURE]** Refutation edges. {cite: notes/reports/REPORT-A.md > "CALL OPTION A — Refutation edges — OPENED"}
- **[SHIPPED]** Selective bookmark and thread resolution. {cite: notes/reports/REPORT-UX.md > "GATE 3 — Selective bookmark / thread resolution — CLOSED (9/9)"}
- **[KNOWN-BROKEN]** Items the Tier A report lists under KNOWN-BROKEN (mock signature primitives at the time, unweighted concur/dispute tallies, and others). {cite: notes/reports/REPORT-A.md > "KNOWN-BROKEN"}
