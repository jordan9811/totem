---
pageClass: eli5
---

# Influence and the UBI

Everyone gets a regular allowance of influence to back the posts they believe in. Back the right ones and your reputation, and next allowance, grows.

::: warning Status: built, test data only
The allowance, stakes and earning reputation work in the app on test data. Reputation proofs run in the test set-up, real Farcaster authors get no reputation layer, and no money is involved. How much early backers should earn is still the owner's open question. Search, which used to share this page, has its own: [Search](/features/search).
:::

## At a glance

<ol class="flow">
  <li><strong>Each epoch</strong>Every person gets an allowance of influence, bigger at higher reputation</li>
  <li><strong>You</strong>Like, recast, note or refute a post. A little allowance rides along as a stake: good, worth reading, wrong, misleading or note-worthy</li>
  <li class="flow__us"><strong>Totem</strong>Later checks how the post held up: did a note land, did it keep its standing</li>
  <li class="flow__us"><strong>Totem</strong>Stakes that held up add to your reputation, which raises your next allowance</li>
</ol>
<p class="flow__note">Influence is not money and has no transfer: there is no way to send it to anyone.</p>

The **allowance** is 10 plus 4 per reputation tier each epoch (six hours by default), marked in the code as a number to tune. It is kept in a sealed record, so the server never sees a balance. A **stake** is a small public note signed by the persona: this post, this direction, this much. Earning is worked out from those public stakes by a formula anyone can rerun. {cite: notes/reports/REPORT-MEGA2.md > "GATE 1 — Reputation UBI (the backbone; single-threaded)"}

## The obvious questions

### Is this money?

No. It cannot be bought, sold or sent. The code makes adding a "transfer" fail before the app even builds. {cite: notes/reports/REPORT-MEGA2.md > "GATE 1 — Reputation UBI (the backbone; single-threaded)"}

### What does the server learn from my stakes?

Each stake is public: which persona backed which post, which way, how much, rounded to the hour. Your balance and which personas share your allowance stay sealed. Stakes from your personas at the same hour are a link anyone can measure, and the tests report it rather than hide it. {cite: SECURITY-POSTURE.md > "15. Influence & search (Mega pass 2): what the validator learns from stakes, what stays in the vault, the search boundary"}

### What stops a group from piling on?

Nothing blocks it. Groups of personas backing the same posts the same way are detected and shown in the influence view, and a lens can choose to weigh them down.

### What is a reputation tier, and how is it proven?

A level held by your root, not your persona. A persona proves "my owner is at tier 2 or above" without saying which owner, and the For You feed uses that proof. Today these proofs run in the test set-up. See [ZK membership and tiers](/mechanism/zk-membership).

### Do real Farcaster authors have a tier?

No. Real Farcaster posts carry no reputation layer, and staking on them is refused by default.

## Where it lives in the code

`lib/influence/` (allowance, stakes, earning, curves, clusters, types), `validator/stakes.js`, `validator/rep.js`, and Settings, Influence. For the full design, see [Reputation, influence and stakes](/mechanism/reputation-and-stakes).

## The record

For auditors: each line is tagged in the internal vocabulary and cites the report it comes from.

- **[SHIPPED-FIXTURE]** The reputation UBI: allowance, stakes, the spectrum, accrual through rep, legibility, anti-drain. {cite: notes/reports/REPORT-MEGA2.md > "GATE 1 — Reputation UBI (the backbone; single-threaded)"}
- **[SHIPPED-FIXTURE]** Lenses. {cite: notes/reports/REPORT-MEGA2.md > "GATE 2 — Lenses: the algo through different curves (single-threaded)"}
- **[SHIPPED-FIXTURE]** Scroll zones and configurable action buttons. {cite: notes/reports/REPORT-MEGA2.md > "GATE 3 — Scroll zones + configurable action buttons"}
- **[SHIPPED-FIXTURE]** Unified search: a vault-local index, keyword and a local model in a worker, cloud only behind named per-query consent, disclosure chrome; the index is re-derived after a restart. {cite: notes/reports/REPORT-MEGA2.md > "GATE 4 — Unified search (vault-local, keyword + AI)"}
- **[SHIPPED-FIXTURE]** The @totem DM hook. {cite: notes/reports/REPORT-MEGA2.md > "GATE 5 — @layers on X: the DM-to-bookmark hook"}
- **[SHIPPED-FIXTURE]** Relationship porting. {cite: notes/reports/REPORT-MEGA2.md > "GATE 6 — Relationship porting on X (extends alt-linking)"}
- **[UNCLEAR]** The early-to-content curve's intended shape, and the creator-economy tie-in. {cite: notes/reports/REPORT-MEGA2.md > "GATE 1 — Reputation UBI (the backbone; single-threaded)"}
- What the validator learns from stakes, what stays in the vault, and where the search boundary is. {cite: SECURITY-POSTURE.md > "15. Influence & search (Mega pass 2): what the validator learns from stakes, what stays in the vault, the search boundary"}
