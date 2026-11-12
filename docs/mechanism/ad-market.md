# The ad market

Advertisers target audiences with the same rule engine your feed uses, and every audience must clear a k-anonymity floor. All of it runs on a simulated ledger today. The Dutch auction the owner wants is now a [spec](/roadmap/ad-auction), and its Phase 1 (house ads placed by the device, a dial per mode, no money) is built on test data.

::: info Status: built on a simulated ledger; the Dutch auction is specified, its Phase 1 built
<span class="st st--test">Built, test data only</span>: the intent auction with scripted bidders, the advertiser console, in-feed ad units, the measurement dashboard, request-priced reads, pay-to-DM, pledge-to-action, tip-gated channels and the Ad Match Score. They run on a mock escrow ledger with no real money and no real advertisers. {cite: notes/reports/REPORT-G.md > "GATE 3 — Wave 6: Market Layer — CLOSED (6/6)"} <span class="st st--test">Built, test data only</span>: Phase 1 of the [Dutch-auction spec](/roadmap/ad-auction), house ads placed in the real Following by the device under a per-mode ad dial, with a reviewed, signed lot list, "Why this ad" and sealed hides; not deployed. {cite: SECURITY-POSTURE.md > "41. Ads, Phase 1: house ads in your real Following, picked on your device, with a dial per mode"} <span class="st st--soon">Coming soon</span>: the clock, standing orders, money and private measurement (Phases 2 to 5).
:::

The verdict: the parts worth reading as mechanism design are the floor and where matching happens. An audience is a rule group, the same shape the feed's rules use, and the market refuses any audience smaller than its floor, in the interface and again at the API. Matching a campaign to you runs on your device against claims you consented to. Everything with money in it is a simulation that proves invariants about a ledger, not about a market: no price discovery has happened, no advertiser has paid, and the "noise" on measurement is a fixed offset, not differential privacy. {cite: notes/reports/REPORT-BACKPACK.md > "GATE 2 — Ad Match Score — BUILT"}

## At a glance

<ol class="flow">
  <li><strong>Advertiser</strong>Builds an audience from rule clauses: graph claims, tier, proven attestations.</li>
  <li class="flow__us"><strong>Floor</strong>The audience must reach 8 people, or 50 once it names an attestation.</li>
  <li><strong>Match</strong>On your device, campaigns are matched against your own consented claims.</li>
  <li><strong>Show</strong>Ad units appear only in modes that allow ads.</li>
  <li><strong>Measure</strong>The advertiser sees aggregates, with a bounded offset added.</li>
</ol>
<p class="flow__note">Every step runs against seeded people and seeded campaigns. The ledger behind it moves mock balances.</p>

## Audiences and the floor

An audience is a `RuleGroup`: clauses combined with AND or OR, optionally negated, over three fields. `graph.claim` matches a consented claim from the context graph; `author.tier` compares a tier; `attest.holds` matches an attestation bucket the persona proved this epoch, never what an issuer merely issued. {cite: SECURITY-POSTURE.md > "13. Issuers (Attestation pass): what an issuer, the validator and a subscriber learn"}

| Rule | Value |
|---|---|
| k-floor | 8, a development value sized so the seeded population can trip it |
| Floor with an attestation clause | `max(8, ZK_ANON_FLOOR)`, which is 50 at the default ZK floor: the higher floor always applies |
| Where it is enforced | the console disables submit and says why; the API re-checks and answers 422 whatever the interface did |
| Score and floor | a higher Ad Match Score buys better-priced inventory, never a smaller audience {cite: notes/reports/REPORT-BACKPACK.md > "GATE 2 — Ad Match Score — BUILT"} |

One floor serves both: no surface may resolve to fewer people than the floor, whether the predicate is a graph claim or a proven bucket. An attestation clause with `neq` is advisory, because a prover chooses the persona id it proves for, so anyone in the tree can make any persona read as "attested". {cite: SECURITY-POSTURE.md > "The adversarial review of this pass (attack-att-1 / -2 / -3): what changed, what is assumed"}

## Where matching happens

The Ad Match Score and the marketplace's local campaign matching read the root's own vault, for the root's own personas, on the device. Nothing leaves the device as a claim; the proof-mediated rule governs only what other parties can predicate on. {cite: SECURITY-POSTURE.md > "The adversarial review of this pass (attack-att-1 / -2 / -3): what changed, what is assumed"}

The score runs from 0 to 100: `score = min(100, rawTotal)`, the breakdown always sums to `rawTotal`, and the cap is shown ("Sum of factors: 107, capped at 100"). Suggestions to raise it leave out points from sensitive categories you have not consented to and are clamped to the remaining headroom, so a "+12" at 95 shows as "+5". {cite: notes/reports/REPORT-BACKPACK.md > "GATE 2 — Ad Match Score — BUILT"}

## Measurement

The dashboard reports `impressions = reach × 37 + n₁` and `conversions = round(reach × 2.4) + n₂`, where each n is a deterministic offset in [−5, 5] computed from the campaign id, so two reads agree exactly. The suite checks the payload against an allowlist of keys and scans it for identifier-shaped strings. This is a stand-in for the shape of a private measurement API. It is not differential privacy: there is no privacy budget, and the offset is a function of a public id. {cite: notes/reports/REPORT-G.md > "GATE 3 — Wave 6: Market Layer — CLOSED (6/6)"}

## The simulated ledger

Every money feature rides one escrow ledger, and its invariants are structural:

- funds move only through `hold()`, `resolve()` and `resolvePot()`, and a grep pins every balance mutation to one file;
- `resolve()` throws on a second resolution;
- `resolvePot()` refuses any split that does not sum to the pot to the cent;
- conservation holds across every suite: Δ(balances + held) = 1000 × Δ(accounts).

| Feature | Mechanism |
|---|---|
| Intent auction | you post an intent with escrow and N pitch slots; scripted bids arrive at fixed offsets for `escrow × (0.4 + 0.15 i)`; you pick a winner or let it lapse |
| Request-priced reads | a rate card by relationship (mutuals 0, extended 2, randoms 5, businesses 25); reading past 8 seconds settles to the reader, unread past 1 hour refunds |
| Pay-to-DM | non-mutuals escrow your price; a reply refunds them; ignored past the window, you keep it |
| Pledge-to-action | award a replier within 2 hours; after that a draw picks `sha256("lottery:" + pledgeId) mod` the sorted replier pool; no repliers refunds |
| Tip-gated channel | tips pool per epoch; at close the pot splits by the square root of each post's likes, floored to cents, remainder to the largest; a pot of 6 over 30, 46 and 21 likes pays 1.95, 2.42 and 1.63 |

Source: {cite: notes/reports/REPORT-B.md > "GATE 3 — InfoFi market extensions — CLOSED (7/7)"}

## The Dutch auction: what a design has to settle

The owner wants to buy ad slots by Dutch auction: the price starts high and falls on a clock until someone accepts. The [spec](/roadmap/ad-auction) answers each question below (lots by placement, audience and day; a ten-minute clock; standing orders against the race; the existing escrow); Phase 1, the placements and the dial without money, is built. The questions any design had to answer:

- **The lot.** A slot in one mode for one hour, an audience over a time window, or a number of impressions. The lot decides what "delivered" means.
- **The clock.** Start price, step, interval and reserve, run on the market's controllable clock so the suites can drive it.
- **The floor.** A lot must be an audience at or above the floor before it is listed, or the auction sells targeting the market refuses to sell directly.
- **Settlement.** The existing escrow fits: hold on acceptance, resolve on delivery evidence, refund on non-delivery.
- **The race.** A descending price is first come, first served, so a public price path invites bots that accept the instant a lot reaches their limit. Hiding the lot's terms until acceptance (commit, then reveal) is the usual answer and costs browsability.
- **Delivery evidence.** Aggregates only, with a real privacy budget if the market is ever real.

## Adversary model and what this does not protect

- **No economic security is claimed.** Balances are mock; the ledger's invariants say the books balance, not that prices are fair or that anyone pays.
- **The floor counts seeded people.** On a real network the floor must count real people, and the population it counts is the operator's to define. {cite: SECURITY-POSTURE.md > "2. What the operator can still do"}
- **Tier targeting reveals tier bands.** An ad shown because "tier 3+" matched tells you, and anyone watching who sees it, something about your tier band.
- **The pledge draw is predictable.** Anyone who knows the pledge id and the replier pool can compute the winner before the window closes. Fine for a simulation; a real one needs a commit-reveal or a verifiable random function.
- **Reads are paid on the reader's word.** "Read past 8 seconds" is reported by the reader's own client; the surface says reads are honoured on reputation, not proven.
- **Click and conversion fraud** is unaddressed.

## The obvious questions

### Can an advertiser target me alone?

Not through the market's API: an audience below the floor is refused at the route, and an audience that names a proven attestation is held to 50. Narrowing by many claims until the count hits the floor is exactly what the floor exists to stop. {cite: notes/reports/REPORT-G.md > "GATE 3 — Wave 6: Market Layer — CLOSED (6/6)"}

### Does anyone earn money today?

No. Earnings are entries on the mock ledger.

### Where does the Ad Match Score get its data?

From your own data backpack, in your vault, on your device. It never becomes a claim another party can read unless a persona proves an attestation. {cite: SECURITY-POSTURE.md > "The adversarial review of this pass (attack-att-1 / -2 / -3): what changed, what is assumed"}

## Where it lives in the code

- `lib/market/escrow.ts`: the ledger and its invariants. `lib/market/infofi.ts`: the four extensions.
- `lib/adapters/mock/market.ts`: audiences, `K_FLOOR`, the intent auction, measurement.
- `lib/zk/floor.ts`: the one floor shared with attestations.
- `app/api/market/*`: the routes that re-check the floor.
