---
pageClass: eli5
---

# Lenses

Rank the same feed by a different recipe, preview exactly what it would change, and share the recipe with anyone.

::: tip Status: ranking works live; the influence side is test data only
Lenses and shareable ranking recipes work in the app on the public preview and the owner's service, over preview posts. The part of a lens that changes how influence is earned runs on test data only: no real reputation or money is involved anywhere yet.
:::

## At a glance

<ol class="flow">
  <li><strong>You</strong>Open a lens: someone else's, or one of the two that ship with Totem</li>
  <li class="flow__us"><strong>Totem</strong>Checks it against guardrails and strips anything it may not change</li>
  <li class="flow__us"><strong>Totem</strong>Previews what moves in your feed, and what would change in who earns influence</li>
  <li><strong>You</strong>Pin it to a mode, or throw it away</li>
</ol>
<p class="flow__note">A lens is a file. You can export it, import it, and see where it came from.</p>

A **lens** is a recipe for ranking: how much weight recasts, likes, stakes, reputation, curators and freshness each get. Every lens works over the same signals, so two people with different lenses still read the same network. A lens also says how the influence allowance would be earned under it, and the preview shows that difference next to the ranking difference. {cite: notes/reports/REPORT-MEGA2.md > "GATE 2 — Lenses: the algo through different curves (single-threaded)"}

## The obvious questions

### Can an imported lens take over my feed?

No. Importing a lens can only change the weights it is allowed to touch. Anything else is stripped, and you are told what was stripped. A lens that tries to change a protected setting is refused outright. {cite: notes/reports/REPORT-MEGA2.md > "GATE 2 — Lenses: the algo through different curves (single-threaded)"}

### Does a lens use how long I look at posts?

No. Where a lens cares about reading time, it uses the length of the post, never a measure of your behaviour that a server could see. {cite: notes/reports/REPORT-MEGA2.md > "GATE 2 — Lenses: the algo through different curves (single-threaded)"}

### What is the difference between a lens and a rule?

A rule decides what to hide, push down or flag. A lens decides the order of everything that is left.

### Is there a chart of how influence moves over time?

Designed, not built.

## Where it lives in the code

Lenses: `lib/lens/` (types, signals, sanitize, service). Shareable recipes: `lib/algo/artifact.ts`. The page: Settings, Lenses. For how influence is earned, see [Reputation, influence and stakes](/mechanism/reputation-and-stakes).

## The record

For auditors: each line is tagged in the internal vocabulary and cites the report it comes from.

- **[SHIPPED]** Portable algorithm artifacts: export, import with provenance, preview, packs. {cite: notes/reports/REPORT-A.md > "GATE 2 — Portable algorithms — CLOSED pending regression (2 iterations)"}
- **[SHIPPED-FIXTURE]** Lenses as artifacts through the same pipeline, with guardrails, the influence delta in preview, and an evaluate API; two seeded lenses. {cite: notes/reports/REPORT-MEGA2.md > "GATE 2 — Lenses: the algo through different curves (single-threaded)"}
- **[SPECCED]** Call option B: an influence-layer visualization (stake history over time; canonical-vs-lens accrual chart). {cite: notes/reports/REPORT-MEGA2.md > "Standing judgment calls (this pass)"}
