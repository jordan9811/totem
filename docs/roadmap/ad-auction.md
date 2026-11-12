# Spec: the Dutch-auction ad marketplace
<!-- uncited-ok: page: a design spec whose Phase 1 is built; what exists today is stated, and cited, on /features/ad-market and /mechanism/ad-market (SECURITY-POSTURE.md §41) -->

::: info Status: Phase 1 built, test data only, not deployed (2026-11-07); Phases 2 to 5 are a spec
**Phase 1 is built** (§9): placements in the real Following, the ad dial per mode, house ads from a reviewed, signed list, "Why this ad", hide controls and contextual matching, all decided on the device, on test data and not deployed ([Ads and the market](/features/ad-market); SECURITY-POSTURE.md §41). No money and no clock: those are Phase 2 onwards, not built. Also on test money only: the intent auction, the advertiser console, in-feed ad units, the measurement dashboard, the Ad Match Score and one escrow ledger ([The ad market](/mechanism/ad-market)). This spec reuses all of it. Prices below are starting values to tune, not decisions.
:::

::: tip What Phase 1 decided (2026-11-07)
- **Placements**: Following at rows 5, 20, 35, 50 … (the ads themselves counted), For You at 3, 18, 33 … once For You reads from the hub (the same plan, `placement: "forYou"`). An ad is never the last row.
- **Unsold slots show the house ad**: with one house campaign, it fills every slot of the page; the dial is how a viewer turns the load down.
- **The list** is `public/ads/lots.json`, shipped inside the app (so the device never asks for it) and served read-only at `/ads/lots.json`. Phase 2's daily lots move to a read-only list from the validator, checked the same way.
- **Review** is an owner-signed approval per lot (`npm run ads:approve`), an Ed25519 signature over the lot's exact words and the policy id (`totem-ad-policy/1`, the bans suggested in §7 as the default until decision 3). The anon moderators' keys live in a browser vault, so they sign nothing on the owner's machine.
- **Defaults**: Generic in the root's and public personas' modes, No ads in a private persona's and when the owner cannot be told, No ads (forced) in Event Safe Space.
- **Matched** means the lot's word is a whole word of the mode's name ("Sports" fits "Sunday sports", not "Esports"); topic labels (spec F) are not built, so only modes match today.
- **No measurement at all** until Phase 4: no impression or click is counted by anyone.
- **Dormant by default**: the public app's `ADS=on` turns it on (the tab is handed `ADS=on`); unset, nothing shows anywhere and Settings, Modes says "Ads aren't running on Totem yet." (`docs/technical/env.md`, notes/runbooks/OWNER-CHECKLIST.md, Ads).
:::

## The one-paragraph version

Advertisers buy **lots**: a promoted slot in one placement, for one audience, for one day. Each lot is sold by a **descending clock**: its price starts high and steps down until someone buys it or it reaches its reserve. Advertisers can watch the clock, or leave a **standing order** ("buy when it drops to $X"), so nobody wins by being fastest. **Matching happens on each viewer's device**: the server never learns who saw what, and every audience must clear the crowd floor before it can be sold. **Viewers choose their ad load** per mode. Delivery is counted with **anonymous impression tokens** sent through the outside relay, and reported as noisy totals.

## 1. What is sold: the lot

A lot is one **placement** × one **audience** × one **day**, with an impression cap.

| Part | v1 values |
|---|---|
| Placement | Promoted post at position 5 of Following and position 3 of For You, then every 15th post; never in threads, never in Event Safe Space |
| Audience | **Contextual only in v1:** a mode type ("Work", "Weekend", "Sports") or a topic label (spec F). No personal targeting: no tiers, no attestations, no graph facts. These come back in Phase 4, behind the floor |
| Day | 00:00 to 24:00 UTC |
| Impression cap | Set per lot from expected supply (§6); delivery stops at the cap |

**Why contextual first.** It works at Totem's size today, needs no personal data at all, and can't reveal anything about a viewer: an astronomy ad in astronomy mode says nothing the viewer didn't choose.

**The floor still applies.** A lot is listed only if its audience's expected daily viewers clear the floor (8 people, or 50 when it names an attestation: the existing rule). Below that, it isn't for sale.

## 2. The clock

| Setting | Starting value (tune) | Meaning |
|---|---|---|
| Start price | 3 × the last 7 days' clearing price for comparable lots, or the house default ($40 a lot) when there is no history | Where the clock opens |
| Step | 5% of the start price | How much each tick drops |
| Tick | Every 10 minutes | How often it drops |
| Reserve | 10% of the start price | The floor; unsold at the reserve means the slot shows a house ad or nothing |
| Window | Opens 48 h before the day, closes when sold, or at the reserve, or 1 h before the day | |

The clock runs on the market's controllable clock (`lib/market`), so tests can drive it.

## 3. Buying without a race

A descending price rewards whoever accepts first, which is a bot war. Instead:

- **Standing orders.** An advertiser places "buy lot L when its price is at or below $X", with $X held in escrow when the order is placed. At each tick the engine checks every order against the new price.
- **Same-tick ties.** The highest limit wins; if limits tie, the earliest order wins. The winner pays **the tick's price, not their limit** (like a second-chance discount: you never pay more than the clock says).
- **Manual buys** are just a standing order at the current price, placed by hand.
- **Cancelling** is allowed until the order fills, and refunds the hold.

This makes the auction fair without hiding terms: lots stay browsable, and speed buys nothing.

## 4. Money

- **v1 runs on the existing test ledger** (`lib/market/escrow.ts`): `hold()` on order, `resolve()` on delivery, a refund on cancel or under-delivery, conservation checked by the suites.
- **Real money (Phase 3).** The advertiser prepays the order's limit into a Totem-held balance. On fill, the clearing price is charged and the rest released. After the day, any undelivered share of the cap is refunded pro rata.
- **Rail: your decision.**
  - USDC on Base fits the crypto stack and settles instantly.
  - A card (Stripe) is what most advertisers expect.
  - My recommendation: card first for reach, USDC second.
- **Viewer revenue share: your decision, and a legal one.** Paying viewers makes Totem a payout platform (tax forms, money-transmission rules). My recommendation: v1 pays no viewers; ad revenue funds Totem; a share through the UBI and earnings view comes later, after a lawyer's read.

## 5. What a viewer sees and controls

- **The ad dial, per mode:** No ads / Generic ads only / Matched ads. Matched means contextual in v1. Defaults: generic in public modes, none in private ones. Event Safe Space forces none.
- **Labelled like X's promoted posts**, with "Why this ad": "Shown because you're in Sports mode". The explanation is computed on the device.
- **Hide this ad / hide this advertiser**, kept on the device.
- **Identity.** Ads are decided for the acting identity only (root or persona) and never use anything that links them. A persona's ads never reflect the root's data, and the other way round.

## 6. Matching, supply and delivery, privately

- **Matching on the device.** The day's lots for each placement are downloaded as a public list, the same for everyone. Each device picks the ads that fit its active mode and labels. The server never learns which ad a person saw.
- **Expected supply** (used for the floor and the impression caps) comes from noisy daily counts of active modes. Each device reports "I used Sports mode today" as an anonymous token through the outside relay, with differential-privacy noise added before anyone sees the totals.
- **Anonymous impression tokens.**
  - Once a day, a device proves crowd membership and receives a small batch of blind-signed tokens (Privacy Pass style).
  - Each impression spends one token, sent through the relay.
  - The server counts valid tokens per lot without knowing whose they are.
  - Fraud is capped by tokens per member per day.
- **Advertiser reports:** impressions and clicks per lot, rounded, with noise from a real privacy budget (ε per campaign, stated on the report). No lists of people, ever. This replaces today's stand-in noise.
- **Clicks** open the advertiser's link with no referrer and no identifier.

## 7. The advertiser side

- **Console:** create a campaign → a creative (a Farcaster cast from the advertiser's own account, shown as a promoted card, or a Totem-hosted card) → pick lots or a lot search ("Sports mode, any day next week") → place standing orders → watch fills and delivery.
- **Review:** every creative passes a moderator's review before its first fill (the moderation queue exists). Policy: your decision. Suggested bans: scams, unlicensed financial offers, political ads in v1, adult content.
- **The house campaign:** your own projects can run as the first advertiser to seed the market. They go through the same clock and review, marked as house.

## 8. Privacy check (first principles)

| Question | Answer |
|---|---|
| Can the server learn who saw an ad? | No: matching is on the device, the lot list is public, impressions are anonymous tokens over the relay |
| Can an ad link a persona to its root? | No: ads are chosen for the acting identity alone; no cross-identity data is used; the tokens carry no identity |
| Can an advertiser target one person? | No: the floor, contextual-only targeting in v1, noisy reports |
| Does seeing an ad reveal something about me? | In v1 only your active mode or label, which an onlooker already sees on your screen. Tier and attestation targeting stays off until Phase 4, because it reveals your band |
| What does the outside relay add? | Without it, impression tokens would show the viewer's internet address. **Phase 4 depends on spec D** |

## 9. Phases

| Phase | What ships | Depends on | Size |
|---|---|---|---|
| 1 | Placements, the ad dial, house ads, "Why this ad", hide controls, creative review, contextual matching on the device. **Built, test data only, not deployed (2026-11-07)**: `scripts/unit-ads.mjs`, `scripts/accept-ads-prod.mjs` | nothing | M |
| 2 | Lots, the clock, standing orders, settlement and refunds on the test ledger, the advertiser console's lot search | 1 | M |
| 3 | Real money: the prepaid balance, the card and/or USDC rail, invoices, refunds | 2, your rail decision | L |
| 4 | Private measurement: anonymous impression tokens, DP reports, supply counts, fraud caps; then opt-in tier targeting behind the floor | 2, the relay (D) | L |
| 5 | Viewer revenue share through earnings and UBI | 3, legal | M |

**Done when, for each phase:** a production-shape suite drives the clock and proves the invariants. A fill never exceeds a limit. Ties resolve by limit, then time. Conservation holds. An under-floor lot is never listed. No request carries a viewer identifier. A persona's ad state never appears under the root.

## 10. Decisions for you

1. **Money rail:** card, USDC on Base, or both (recommended: card first)?
2. **Viewer revenue share:** later, after legal review (recommended), or in v1?
3. **Ad policy:** what's banned (suggested: scams, unlicensed financial offers, political ads, adult content)?
4. **The lot shape:** daily slots by mode or topic (recommended), or blocks of impressions?
