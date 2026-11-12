---
pageClass: eli5
---

# Ads and the market

Ads on Totem are picked on your device for the mode you're in, you choose how many per mode, you see why an ad reached you, and a crowd too small to hide in is refused.

::: warning Status: built, test data only. No real money
Phase 1 of the [ad marketplace](/roadmap/ad-auction) is built on test data and not deployed: house ads in your real Following, an ad setting per mode, "Why this ad", hiding an ad or an advertiser, and a review before any ad is listed. It ships switched off: until the owner turns ads on, no ad shows anywhere, and Settings, Modes says "Ads aren't running on Totem yet." beside each mode's ad setting. The only ad is the owner's house placeholder, and nobody pays. The older market (the intent auction, the advertiser console, measurement, paid reads and pay-to-message) runs on a pretend ledger with scripted advertisers. No real advertiser, payment or payout exists. The auction clock, money and private measurement are Phases 2 to 5, not built.
:::

## At a glance

<ol class="flow">
  <li><strong>Totem</strong>Ships one list of reviewed ads, the same for everyone</li>
  <li><strong>Your device</strong>Picks from it for the mode you're in, and only if that mode allows ads</li>
  <li><strong>You</strong>See it labelled, ask why it's there, or hide it (or every ad from that advertiser)</li>
  <li class="flow__us"><strong>Totem</strong>Hears none of it: nothing is sent about which ad you saw</li>
</ol>
<p class="flow__note">Phase 1 has one advertiser, the house, and runs on test data only.</p>

## The parts

**House ads in your Following.** In your real Farcaster Following, an ad sits at position 5 and then every 15th position, never last, never in a thread, never in Event Safe Space. It looks like X's promoted post and says "House ad". Today the only ad is the owner's placeholder for his own project. {cite: SECURITY-POSTURE.md > "41. Ads, Phase 1: house ads in your real Following, picked on your device, with a dial per mode"}

**An ad setting per mode.** Each mode has its own: No ads, Generic ads only (the same for everyone), or Matched to this mode (an ad meant for "Sports" shows in a mode named Sports). Your own modes start at Generic, a private persona's at No ads, and Event Safe Space is always No ads. Change it in Settings, Modes, Edit.

**Why this ad.** Every ad says why it is there, worked out on your device: "Shown because you're in Sports mode", or that nothing about you picked it.

**Hide this ad, hide this advertiser.** Kept sealed in your vault, for the identity you're acting as only, with an Undo; Settings, Modes lists what you hid and can show it all again.

**Review first.** An ad is shown only after a reviewer approved its exact words under Totem's ad policy: no scams, no unlicensed financial offers, no political ads, no adult content. Change a word and it needs approving again.

**The older market (test data).** The intent auction (you post what you're in the market for; scripted advertisers bid), the advertiser console (an audience built with the same rule builder as your feed), measurement (totals with deliberate noise, never a list of people), paid reads and pay-to-message. <!-- uncited-ok: describes the dashboard's shape --> {cite: notes/reports/REPORT-G.md > "GATE 3 — Wave 6: Market Layer — CLOSED (6/6)"}

## The obvious questions

### Does Totem know which ads I saw?

No. The list of ads is part of the app, your device picks from it, and no request tells Totem or anyone else which ad you saw. Nobody counts impressions or clicks yet. Tapping an ad opens the advertiser's page with no record of where you came from. {cite: SECURITY-POSTURE.md > "41. Ads, Phase 1: house ads in your real Following, picked on your device, with a dial per mode"}

### Can an ad give away my persona?

No. Ads are picked for whoever is acting, from that mode's setting and name alone, so a persona's ads and hidden ads never show up under you, or yours under it. {cite: SECURITY-POSTURE.md > "41. Ads, Phase 1: house ads in your real Following, picked on your device, with a dial per mode"}

### Can an advertiser target just me?

No. Phase 1 has no personal targeting at all: an ad goes to everyone with ads on, or to every mode with a word in its name. In the older market, an audience below a minimum size is refused twice: the console will not submit it, and the server checks again. {cite: notes/reports/REPORT-G.md > "GATE 3 — Wave 6: Market Layer — CLOSED (6/6)"}

### Is the money real?

No. Every balance lives on one pretend ledger. Its rules are strict anyway: money moves through one file, a payout cannot happen twice, and a split that does not add up to the cent moves nothing. {cite: notes/reports/REPORT-B.md > "GATE 3 — InfoFi market extensions — CLOSED (7/7)"}

### What is the Dutch-auction marketplace?

The plan for selling ad slots: each slot's price starts high and drops until someone buys it, with standing orders so speed buys nothing. It is [specified](/roadmap/ad-auction); Phase 1 is built, the clock and the money are coming soon.

## Where it lives in the code

Phase 1: `lib/ads/` (the list and its review check, the setting per mode, matching and placements, the plan, the sealed hidden ads), `public/ads/lots.json` (the list itself), `app/api/ads`, `components/ads/`, and `scripts/ads-approve.mjs` (the review). The ledger: `lib/market/escrow.ts`. Paid reads and related: `lib/market/infofi.ts`. The mock market adapter: `lib/adapters/mock/market.ts`. The API: `app/api/market` and `app/api/earnings`. For the design, see [The ad market](/mechanism/ad-market).

## The record

For auditors: each line is tagged in the internal vocabulary and cites the report it comes from.

- **[SHIPPED-FIXTURE]** Wave 6 market layer, on scripted advertisers and a mock ledger. {cite: notes/reports/REPORT-G.md > "GATE 3 — Wave 6: Market Layer — CLOSED (6/6)"}
- **[SHIPPED-FIXTURE]** InfoFi market extensions, on the mock ledger. {cite: notes/reports/REPORT-B.md > "GATE 3 — InfoFi market extensions — CLOSED (7/7)"}
- **[SHIPPED-FIXTURE]** Ads Phase 1: placements in the real Following, the ad setting per mode (No ads / Generic / Matched, contextual only), house ads from a reviewed, signed list, "Why this ad", sealed hides, all decided on the device; test data only, not deployed. {cite: SECURITY-POSTURE.md > "41. Ads, Phase 1: house ads in your real Following, picked on your device, with a dial per mode"}
- **[SPECCED]** The Dutch-auction marketplace's Phases 2 to 5: lots on a descending clock with standing orders, real money, private measurement, a viewer revenue share. <!-- uncited-ok: a spec, docs/roadmap/ad-auction.md -->
