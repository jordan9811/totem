---
pageClass: eli5
---

# Your data backpack

Bring facts about yourself into Totem on your terms, see exactly what each one is before it lands, and see what it would be worth to advertisers.

::: warning Status: built, test data only
The backpack's connectors, the preview-then-confirm step and the Ad Match Score work in the app on test data. The connectors are stand-ins; no real outside account is read. The Settings page for it is not in the Settings menu yet.
:::

## At a glance

<ol class="flow">
  <li><strong>You</strong>Pick a source, or type a fact about yourself</li>
  <li class="flow__us"><strong>Totem</strong>Shows a preview: each fact, where it came from, and how sure it is</li>
  <li><strong>You</strong>Confirm. Nothing lands before you do</li>
  <li class="flow__us"><strong>Totem</strong>Stores it sealed and updates your Ad Match Score, with its sums shown</li>
</ol>
<p class="flow__note">A sensitive category you have not opted into is shown in the preview and left out.</p>

Every fact carries its **provenance**: whether an issuer attested it, it was inferred, or you said it yourself, plus the method and the date. They are listed in that order, so a self-declared fact never looks like an attested one. {cite: notes/reports/REPORT-BACKPACK.md > "GATE 1 — Data backpack import surface — BUILT"}

## The obvious questions

### What is the Ad Match Score?

A score from 0 to 100 for how useful your shared facts would be to an advertiser. The breakdown always adds up to the raw total, and the score is that total capped at 100, with the cap shown. Suggestions for raising it only count points an import would really deliver. {cite: notes/reports/REPORT-BACKPACK.md > "GATE 2 — Ad Match Score — BUILT"}

### Can a high score let an advertiser target me alone?

No. An audience smaller than a minimum size is refused, whatever anyone's score. A good score buys better-priced placements, not a smaller crowd. {cite: notes/reports/REPORT-BACKPACK.md > "GATE 2 — Ad Match Score — BUILT"}

### Where are these facts kept?

In sealed records. The server holds them scrambled. {cite: notes/reports/REPORT-BACKPACK.md > "Trust topology (every grep hangs on it)"}

## Where it lives in the code

The score: `lib/graph/score.ts`. The import jobs and claims: the graph adapter and `app/api/graph`. The page: `/settings/graph`, not yet linked from the Settings menu.

## The record

For auditors: each line is tagged in the internal vocabulary and cites the report it comes from.

- **[SHIPPED-FIXTURE]** Wave 5 context graph. {cite: notes/reports/REPORT-G.md > "GATE 2 — Wave 5: Context Graph — CLOSED (4/4)"}
- **[SHIPPED-FIXTURE]** Data backpack import surface (preview, commit, provenance and method), with stand-in connectors. {cite: notes/reports/REPORT-BACKPACK.md > "GATE 1 — Data backpack import surface — BUILT"}
- **[SHIPPED-FIXTURE]** Ad Match Score. {cite: notes/reports/REPORT-BACKPACK.md > "GATE 2 — Ad Match Score — BUILT"}
