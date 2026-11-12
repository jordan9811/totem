---
pageClass: eli5
---

# Relationship history

Remember why you followed someone, keep receipts when they cross a line, and optionally mute them after three strikes.

::: warning Status: built, test data only
The history section and the three-strike switch work in the app, on the demo world's people. Carrying a relationship from one of your personas to another on X ("porting") has only run on test data and is not sent to X.
:::

## At a glance

<ol class="flow">
  <li><strong>You</strong>Follow someone because of a post</li>
  <li class="flow__us"><strong>Totem</strong>Keeps that post as the reason, in a sealed log</li>
  <li><strong>You</strong>Mark a strike when they post something over the line, with that post as the receipt</li>
  <li class="flow__us"><strong>Totem</strong>If you turned three strikes on, mutes them on the third, and logs why</li>
</ol>
<p class="flow__note">Three strikes is off unless you turn it on. Turning it off un-mutes on the next refresh, receipts kept.</p>

Every profile you visit shows your history with that person: why you followed, with the post that did it; your first interaction; how often you engage; and any strikes, each with its receipt. Old follows from before the log existed are marked as such rather than given a made-up reason. {cite: notes/reports/REPORT-A.md > "CALL OPTION B — Relationship history UI + 3-strike — CLOSED (1 iteration)"}

## The obvious questions

### Who can see my history with someone?

The log is sealed: it is part of your private records, not shown to the other person or stored readable on the server. {cite: notes/reports/REPORT-A.md > "GATE 1 — Relationship event log — IN PROGRESS"}

### Does a strike without a reason count?

No. A strike needs the post that caused it. A strike without a receipt is a mood, not a record.

### What does a mute do?

It takes the person out of your feed. It does not block them or reach their other accounts: a mute is about your attention, not their identity.

### What is porting?

Moving a relationship from one of your personas to another: you grant someone on your list that your new persona is also you. On X, a matching pair of likes was designed as a quiet hint. That X half is test-only, and X's rules on automated likes mean it stays experimental. Private personas are never ported. {cite: notes/reports/REPORT-MEGA2.md > "GATE 6 — Relationship porting on X (extends alt-linking)"}

## Where it lives in the code

The log: `lib/eventlog/` (log, strikes, types). Porting: `lib/x/porting.ts` and Settings, Relationship porting.

## The record

For auditors: each line is tagged in the internal vocabulary and cites the report it comes from.

- **[SHIPPED-FIXTURE]** The relationship event log (edges, timestamps, sealed at rest). {cite: notes/reports/REPORT-A.md > "GATE 1 — Relationship event log — IN PROGRESS"}
- **[SHIPPED-FIXTURE]** Relationship history UI and the 3-strike surface. {cite: notes/reports/REPORT-A.md > "CALL OPTION B — Relationship history UI + 3-strike — CLOSED (1 iteration)"}
- **[SHIPPED-FIXTURE]** Relationship porting on X: a grant from one persona to another for a counterpart, a pending grant that resolves when the counterpart links, synchronised likes recorded and not sent; private personas excluded. {cite: notes/reports/REPORT-MEGA2.md > "GATE 6 — Relationship porting on X (extends alt-linking)"}
