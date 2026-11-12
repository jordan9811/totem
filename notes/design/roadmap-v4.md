# Roadmap v4 — Signal, Curation, Interop

Folds in the new batch. Prior waves 1-6 are shipped on the UI track;
sibling apps (photo, video, Pulse, anoncast pop-out) remain their own
track. Network-state filtering is in, as advanced-settings config on
open rails, same as everything else here. Prioritized by feasibility
against what already exists.

---

## Tier A — Nearly free (rides existing rails, next pass)

| Feature | Why it's cheap |
|---|---|
| Portable algorithms | A mode is already serializable JSON. Share = publish the rule set as content; import = one tap with a preview diff ("this algo hides X, boosts Y") before activating. Marketplace = public bookmark folders holding rule sets. Both exist |
| Caught-up banner | Saturation state + content-exhaustion check + handoff to readwise chunks. "Out of content. Enjoy your longform." Calibratable per mode |
| Relationship event log | START LOGGING NOW, UI later. Every follow/mute/block/facet change records the triggering cast id + timestamp. Cannot be retrofitted; every day unlogged is history lost. Local only, never published |
| Curator annotation display | The debunk indicator and notes reinjection (wave 3) are already the display side. Subscribing to an external annotation feed is a rules-engine input |

**One safety rule for imported algorithms:** an imported rule set runs
through the same guardrails as native ones (can't disable the composer
destination indicator, can't suppress correction cards you've engaged
with, k-floor untouchable). Imported algos are config, not code.

---

## Tier B — Real features, clear designs (1-2 passes out)

| Feature | Design note |
|---|---|
| Relationship history UI | Profile tab: "why you follow them" (the cast), first cast ever seen, engagement count, mute history with the offending casts. Optional 3-strike auto-mute with visible strikes. Reads the Tier A log |
| Curator multisig issuance | N-of-M co-signed annotations from accounts you designate (e.g. 2-of-3 trusted journalists). Signed label + evidence link (the CNN-filter receipt). Subscribers' clients act on it: badge, demote, or auto-block, viewer's choice. Study Bluesky labelers, add the reputation tree underneath |
| Network-state filter packs | A named, shareable bundle: rules + attestation predicates + curator subscriptions. "Don't show me / don't transact with accounts matching X." Advanced settings, off by default, exportable like any algo. Downstream apps (dating, commerce) read the same pack as an input |
| Crosspost composer | One composer, destination checkboxes (Farcaster + X + atproto). Mutual-overlap detection where both graphs are knowable. Collapse crossposts for viewers who follow you on both, labeled "also posted on X," probably-seen not seen (X will never tell us what a user actually saw; set expectations honestly) |
| InfoFi extensions (from the Noice piece) | Request-priced reads (reputation-staked, dwell/scroll metrics, refund norm); pay-to-DM with refund-on-read slashing for spam; pledge-to-action escrow (pledge 200 USDC to best reply, defaults to lottery if unawarded); tip-gated channels with quadratic pot distribution. All fit the existing market/settle adapters |

---

## Tier C — Interop (the bottleneck, dedicated pass)

See the interop section below for the full brainstorm. The buildable
sequence:

1. **Multi-protocol read/write** — atproto and ActivityPub are OPEN.
   No proofs needed. Read their firehoses, cross-post natively.
   Threads federates over AP, Bluesky is atproto: two more networks
   ingested with zero cryptography. Biggest interop win per unit
   effort, by far
2. **Account-link attestations** — "this identity controls @handle on
   X," issued via OAuth or zkTLS session proof, stored in the
   existing attestation catalogue. Wave-2 infra reused
3. **Old-content porting** — zkTLS proof binding hash + authorship +
   original timestamp; store content normally, proof rides along.
   Your 2022 banger imports dated 2022, verifiably
4. **zk-email receipts** — DKIM-signed emails proven in ZK. Purchase
   confirmations become attested context-graph claims for the ad
   layer; platform emails prove account ownership without OAuth
5. **TEE bulk import** — full archive takeouts (GDPR-mandated,
   comprehensive) fetched and attested inside an enclave, for
   payloads zkTLS can't handle

---

## Tier D — Parked deliberately

| Feature | Why parked |
|---|---|
| Eyeball-tracker TEE | Your own article makes the case: reputation-staked reads with dwell/scroll suffice until stakes are high. Revisit when ad reads carry real money |
| Dating app | Sibling app on the same rails, consumes network-state packs + disclosure grants when both are mature |
| Network-state bootstrapping (full) | The filter packs (Tier B) are the primitive; communities forming around them is emergent, not built |

---

# Interop Brainstorm — the full map

The problem in one line: closed platforms hold your history, your
graph, and your proof-of-taste hostage, and the switching cost is the
moat. Tools, by what they're actually good at:

## 1. Open protocols first (the free lunch)

atproto (Bluesky) and ActivityPub (Mastodon, and Threads federation)
are open by design. Full read access, native write access, portable
identities. No zkTLS, no TEE, no trust assumptions. Your client
becomes a multi-protocol reader/writer and two entire networks'
content, graphs, and users are in scope. Anyone agonizing over
proving web2 data while ignoring the open networks is doing interop
backwards. Do this first.

## 2. zkTLS / web proofs (TLSNotary, Reclaim, Opacity family)

Proves facts from an authenticated web session: "x.com, logged in as
@jordan, served this response." Right-sized for:
- Account ownership without OAuth
- Point metrics: follower count, join date, verification status
- Individual posts: hash-bound content + timestamp + authorship

Wrong-sized for bulk payloads (your instinct is correct). Also
brittle: page structure changes break provers, and notary models vary
(MPC vs TEE notary), so treat each integration as maintenance-bearing.

**Use it as a fact oracle, not a pipe.**

## 3. zk-email (the underused one)

Every email is DKIM-signed by the sending domain. ZK proofs over
those signatures verify sender, recipient, and selected content
without revealing the rest. This unlocks:
- **Commerce receipts → context graph.** Order confirmations from
  Amazon/airlines/ticketing become attested purchase claims. This
  feeds the ad layer with exactly the attested spend data the
  advertiser console prices on, no card integration needed
- Account ownership: prove you received a password-reset email from
  platform X to your address
- Newsletter/long-form provenance for the content-porting story

Payloads are small, signatures are already there, and nobody's
mining this vein for social. Strong fit for your stack.

## 4. TEE coprocessor (the payload answer)

For bulk: full archive exports (X/Meta must provide them under
GDPR/DSA, and they're comprehensive). An enclave fetches the archive
from the authenticated download link, hashes it, attests "this
archive came from this platform for this account." Now the entire
history is imported with one attestation instead of ten thousand
zkTLS proofs. Hardware trust, same caveats as always, but scoped to
a one-time import rather than ongoing operation.

**Pairing:** zkTLS proves the small facts continuously; the TEE
attests the big payload once. That's the breathing room.

## 5. Onchain coprocessors (Axiom/Lagrange/Brevis class)

Prove historical onchain activity: wallet age, protocols used, LP
history, governance votes. Not web2 interop, but for your audience
it's reputation import: a crypto-native arrives with provable
history as attestations on day one. Cheap win for the attestation
catalogue.

## 6. Browser extension (the pragmatic scraper)

The user's own logged-in session, captured locally into their
context graph. Self-attested tier by default; pair with a web-proof
for the attested tier. Doubles as a distribution hook (the extension
that shows your Layers identity overlay on x.com is its own
acquisition channel). Lowest trust, highest coverage, zero platform
permission needed.

## The honest constraint

Every method above imports **data**. None of them import **reach**.
Followers don't come through a proof; only content, history, and
credentials do. The product answer to reach is the crosspost composer
(stay present both places at zero marginal cost) plus ported
history making the new home feel lived-in on day one. Interop lowers
the moving cost; it cannot teleport the audience.

## Suggested interop pass order (targets: X, IG, TikTok, FB-if-trivial)

All four targets are closed platforms, so the open-protocol shortcut is
out and three tools carry everything: official APIs where they exist,
archive takeouts for bulk history, and the browser extension for
coverage the APIs refuse.

1. **X first, it's the most tractable.** OAuth account-link, crosspost
   via the paid API tier (budget for it, the free tier writes nothing
   useful), archive import for full history, zkTLS for porting
   individual old bangers with original timestamps
2. **Browser extension moves way up.** With closed targets it's the
   universal capture tool: your own logged-in sessions on X/IG/TikTok
   feed the context graph and relationship log where no API will
3. **zk-email receipts** — platform-agnostic, unaffected, still the
   attested-spend pipe for the ad layer
4. **Instagram: write path exists but only for business/creator
   accounts** (Graph API content publishing). Personal accounts can't
   API-post. Archive import (Download Your Information) covers history
   for everyone
5. **TikTok: viable.** Content Posting API + Login Kit are real and
   open to developers; archive export covers history
6. **Facebook: import-only, and only because it's free.** Same Meta
   takeout infrastructure as IG, so history import is nearly zero
   marginal work. Write path to personal profiles is dead (API removed
   years ago), don't chase it
7. **TEE archive import gets more important, not less** — takeout
   files are the bulk-history path for all four platforms, so the
   one-time attested import is the workhorse
8. Onchain reputation import, unchanged
