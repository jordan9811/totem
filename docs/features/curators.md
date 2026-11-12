---
pageClass: eli5
---

# Curators

Subscribe to a desk of people who check claims, and choose what their verdicts do to your feed.

::: warning Status: built, test data only
Subscribing to curator desks and issuing annotations work in the app, on the demo world's desks and posts. No real desk exists yet.
:::

## At a glance

<ol class="flow">
  <li><strong>A desk</strong>A small group of curators drafts a note on a post</li>
  <li class="flow__us"><strong>Totem</strong>Counts signatures. Below the desk's threshold, the note does not exist anywhere</li>
  <li><strong>You</strong>Subscribe to the desk and pick what its notes do: a badge, push the author down, or block</li>
  <li class="flow__us"><strong>Totem</strong>Shows the note on the existing correction card, worked out fresh each time</li>
</ol>
<p class="flow__note">Unsubscribe and every effect is gone on the next refresh. Nothing is stored about it.</p>

A **desk** is a group of curators that must agree. A note from a three-person desk that needs two signatures does not appear, anywhere, until two of them have signed. One stolen key cannot speak for the desk. {cite: notes/reports/REPORT-A.md > "GATE 4 — Curator subscriptions — CLOSED (2 iterations)"}

## The obvious questions

### What happens to a flagged author?

What you chose. A badge is the default. Pushing down keeps the author visible, at the bottom of the window. Block hides them, and also hides any of their personas they have linked publicly.

### Who sees a draft?

Only its author and the curators invited to sign it. Not the desk's other members, not subscribers. {cite: notes/reports/REPORT-B.md > "GATE 4 — Curator issuance — CLOSED (7/7)"}

### Can I curate as one of my personas?

Yes. The desk page says which persona you are curating as, and only that persona's name is attached to what you sign.

## Where it lives in the code

`lib/curators/` (annotations and issuance) and `app/api/curators`. Notes ride the same correction cards as community notes.

## The record

For auditors: each line is tagged in the internal vocabulary and cites the report it comes from.

- **[SHIPPED-FIXTURE]** Curator subscriptions, on seeded desks. {cite: notes/reports/REPORT-A.md > "GATE 4 — Curator subscriptions — CLOSED (2 iterations)"}
- **[SHIPPED-FIXTURE]** Curator issuance, on seeded desks. {cite: notes/reports/REPORT-B.md > "GATE 4 — Curator issuance — CLOSED (7/7)"}
