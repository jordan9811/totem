# Reach tiers and the crowd floor

A reach tier is an issuer bucket tree: an anonymous post proves membership of "accounts with 10k+ followers" instead of the plain anon tree, and For You gives it a labelled head start. The tier is never offered, proved into, accepted or labelled while fewer than 50 accounts are in it, and since wave 3 (the band rule) it is offered and accepted only while it also leaves at least 50 accounts in the tier below it that hold no higher tier. {cite: SECURITY-POSTURE.md > "25. Reach tiers (Persona launch P5): what a boosted anon post says, and the crowd floor"}

::: warning Status: built, test data only, deployed 2026-10-12
<span class="st st--test">Built, test data only</span>, tested on the laptop rig and deployed 2026-10-12. No live follower count has been read and no tier has been issued on a deployed service. <span class="st st--soon">Coming soon</span> on the public preview, where anonymous posting itself arrives with the wave 3 deploy (built, not deployed) and the reach issuers refuse to run in your browser, so tiers there also need an issuer Totem runs ([below](#why-the-issuers-are-not-in-your-browser)). On the owner's private service no tier can reach its floor with one owner, so none is ever offered there. {cite: SECURITY-POSTURE.md > "25. Reach tiers (Persona launch P5): what a boosted anon post says, and the crowd floor"}
:::

The verdict: the label names a tier, never an account, and the floor is checked at every step that could expose a small tier. The costs are stated: every reader sees which tree a post proved, so a boosted post's anonymity set is the tier, not the whole anon tree; the issuer knows who is in each tier; and the floor counts accounts issued into a tier, not accounts actually posting in it. {cite: SECURITY-POSTURE.md > "25. Reach tiers (Persona launch P5): what a boosted anon post says, and the crowd floor"}

## At a glance

<ol class="flow">
  <li><strong>Issue</strong><code>fc.reach</code> reads the follower count of the root's own main account (Neynar score 0.7 or more to enter) and issues every bucket it clears.</li>
  <li class="flow__us"><strong>Offer</strong>The composer offers the held tiers whose census, at the last tick, has at least 50 accounts and leaves at least 50 in the band below (the plain anon tree is the bottom rung); the highest is the default.</li>
  <li class="flow__us"><strong>Prove</strong>The post proves "a free slot of my person this window, member of tree T"; the tree is not in the scope.</li>
  <li><strong>Accept</strong>The validator refuses a reach tree whose frozen size is under the floor, or that would leave fewer than the floor in the tier below it, before any nullifier, and records the tree and its size.</li>
  <li><strong>Label</strong>"posted by an account with 10k+ followers" wherever the card shows, and on For You a head start of 1, 2 or 4 hours.</li>
</ol>
<p class="flow__note">The head start is For You only: Following shows the same label but gives no head start. Nothing outside Totem sees the boost: the tree lives in Totem's anon list, not on Farcaster.</p>

## The issuers

Two issuers behind the [open interface](/mechanism/attestations), sharing one family key, `reach`. A client honours each by its EXACT id plus that key (`fc.reach@<key>`, `x.reach@<key>`), because the open registry is first-come and an id alone proves nothing.

| Issuer | Asserts | Entry | Live facts |
|---|---|---|---|
| `fc.reach` | the root's own main Farcaster account has at least 1k / 10k / 100k followers; nested, so a 100k account is issued all three; not the count | Neynar score ≥ 0.7 | the Neynar user lookup, `ATTEST_FID_SOURCE=live` plus read credits (owner's O3); not in a sweep |
| `x.reach` | the X handle that main account verified on Farcaster has at least that many X followers | the same score | none: fixture only; a live count needs an xAI key (O5), and live facts refuse in plain words |

The main account is read where the device keeps it (the Sign in with Farcaster link, or the owner service's connected public self), read-only; a request naming any other fid is refused. One account per root: the retention family remembers a salted hash of the fid and the commitment it vouched for, so a second root binding the same account is refused while the first issuance is unexpired. An issuance is valid for 8 epochs (two days). {cite: SECURITY-POSTURE.md > "25. Reach tiers (Persona launch P5): what a boosted anon post says, and the crowd floor"}

## Why the issuers are not in your browser

Decided on 2026-10-12 (D-REACH-ISSUER-HOST-ONLY): on the public preview, `fc.reach` and `x.reach` refuse to register or issue inside the visitor's browser device. The reach issuers sign the tiers every reader's label and For You order rely on. In the browser the issuer's key would be the visitor's own, and the open registry is first-come, so the first visitor to register `fc.reach` on the public validator would hold that id and could issue themselves any tier. So `issuerUnavailableHere` over the set `HOST_ONLY_ISSUERS` (`lib/attest/registry.ts`) makes `ensureRegistered` answer `403 issuer_not_here` without asking the validator, and `requestIssuance` (`lib/attest/subject.ts`) refuses before it registers, in plain words: "Reach tiers aren't available on the public site yet: they need an issuer Totem runs, not one in your browser." Other issuers are unchanged, and the owner service and the rig host the reach issuers on their server as before. Reach tiers on the public preview wait for an issuer Totem runs, a later step. Checked by `scripts/unit-reach.mjs` I3, with a mutation that removes the refusal. {cite: SECURITY-POSTURE.md > "25. Reach tiers (Persona launch P5): what a boosted anon post says, and the crowd floor"}

Wave 3 (built on test data, not deployed) brings anonymous posting to the public preview with the prover in the browser, and keeps this rule: a stranger's post proves the plain anon tree only, and no reach tier is offered in the browser (D-PUBLIC-ANON-TREE). {cite: SECURITY-POSTURE.md > "27. Anonymous posting from the public site (Persona launch P7): the prover in your browser, the web channel, and what the operator sees"}

## Trees, slots and the scope

An anonymous post proves the plain anon tree or one reach tree (`attest:fc.reach/gte-10k`, …). The scope stays `anon-post/w<n>/s<i>`: the tree is NOT in it, so a person's K = 4 slots per window are shared whatever tree each post proves, and a slot re-used under another tree is a replay. The validator records the tree and the size of the frozen tree at the post's epoch (`tree_size`, migration 24) and serves both on `/zk/anon-casts`. Which reach issuers an anon post may prove is `ZK_ANON_REACH_ISSUERS` (default `fc.reach,x.reach`), served as `reachIssuers` on `/zk/anon-post/config`. {cite: SECURITY-POSTURE.md > "25. Reach tiers (Persona launch P5): what a boosted anon post says, and the crowd floor"}

## The crowd floor, five times

`ZK_REACH_FLOOR` defaults to 50 and is never below `ZK_ANON_FLOOR`, so the owner service's `ZK_ANON_FLOOR=1` (its plain anon account, a crowd of one it discloses) never offers a tier of one. The floor is enforced: {cite: SECURITY-POSTURE.md > "25. Reach tiers (Persona launch P5): what a boosted anon post says, and the crowd floor"}

| Where | Against |
|---|---|
| the offer | the census SIZE of the last tick, not the validator's own `clearsFloor` |
| the compose gate | before anything is minted or written; the held tiers come from a cache filled at moments that are not a compose, and an empty cache, or a tier whose issuance window has ended, refuses a reach tree |
| the prover | its cohort stage |
| the validator | the frozen tree's size, before any nullifier is spent |
| the label | the row's recorded size, cross-checked with the client's own census for the epochs it read |

Across posts, the floor also holds for the crowd a launch would reveal: the tick keeps, on the device only, the running intersection of the members of every tree each persona's anonymous posts were proved in, and refuses a boosted post before the prover when its tree would narrow that crowd to fewer than 50 accounts. The refusal is final and in plain words ("Post it again with a lower boost or no boost"); a post with no boost is never refused by it. {cite: SECURITY-POSTURE.md > "25. Reach tiers (Persona launch P5): what a boosted anon post says, and the crowd floor"}

Buckets nest, so a 100k account boosts as 10k+ until the 100k+ tier has its 50, and the composer says so: "Not enough accounts are in the 100k+ tier yet, so your posts are boosted as 10k+." {cite: SECURITY-POSTURE.md > "25. Reach tiers (Persona launch P5): what a boosted anon post says, and the crowd floor"}

## The label and the boost

The label is shown, and the boost applied, only when all of these hold; otherwise the card is plain anon:

1. the row's tree is a reach tree this client knows;
2. its issuer is honoured by key on this client;
3. the recorded `tree_size` is at least the client's floor;
4. for an epoch whose census the client holds, that census equals the recorded size.

A labelled card sorts on For You as if it were newer by 1 hour (1k+), 2 hours (10k+) or 4 hours (100k+). The head start sits below the demote, pin and quiet keys of the final sort, and Following gives none, though it shows the label. On every surface a tie between two anon cards breaks on the cast hash, so their order is the same on every device; any other tie keeps the order it came in. {cite: SECURITY-POSTURE.md > "25. Reach tiers (Persona launch P5): what a boosted anon post says, and the crowd floor"}

## Who learns what

| Party | Learns | Kept from it |
|---|---|---|
| The reach issuer (co-hosted with the device) | fid → commitment at issuance: who is in each tier | which post any member made |
| The validator, the relay and every reader | each anon post's tree and that tree's size at the post's epoch | which member wrote it |
| Neynar, on live facts | a lookup of the main account at issuance | the commitment and every post |

{cite: SECURITY-POSTURE.md > "25. Reach tiers (Persona launch P5): what a boosted anon post says, and the crowd floor"}

## Assumptions

| Id | What it means |
|---|---|
| A-REACH-ISSUER-SEES-MEMBERS | The issuer knows who is in each tier, not which post. A launched persona's tier narrows it to that tier's crowd. |
| A-REACH-TREE-ON-EVERY-POST | The tree rides every post in the clear: a boosted post hides among the tier, not the whole anon tree. The budget no longer counts the anon tree as a partition, because "anon" names no persona. |
| A-REACH-ACTIVE-CROWD | The floor counts accounts issued into a tier, not accounts posting boosted; the crowd in one window can be far below 50. Not measured. |
| A-REACH-LABEL-TRUSTS-TREE-SIZE | For epochs the client has not read, the label trusts the validator's recorded size. |

Also stated in the posture: control of the main account is the device's own sealed sign-in record, read by a co-hosted issuer; a renewal can read as not yet held for one epoch (toward less); and a root that re-issues its zk identity is refused `fc.reach` for up to 9 epochs. {cite: SECURITY-POSTURE.md > "25. Reach tiers (Persona launch P5): what a boosted anon post says, and the crowd floor"}

## Where it lives in the code

The trees, the offer and every sentence: `lib/reach/trees.ts` (pure, browser-safe). What a root holds: `lib/reach/held.ts`. The label and the order: `lib/reach/boost.ts`, used by `lib/feed.ts`. The issuers: `lib/attest/issuers/fcReach.ts`, `lib/attest/issuers/xReach.ts`, registered in `lib/attest/registry.ts` (which also keeps them out of the browser device: `HOST_ONLY_ISSUERS`, `issuerUnavailableHere`) and honoured in `lib/attest/subscriber.ts`. The gate and the prover: `lib/zk/gate.ts`, `lib/zk/prove.ts`; the floor: `lib/zk/config.ts` (`ZK_REACH_FLOOR`). The validator side: `validator/zk.js` (`reachFloor`, `isReachTree`). The UI: `components/ReachPicker.tsx`, `components/ReachBadge.tsx`, `app/api/reach/route.ts`. Tests: `scripts/unit-reach.mjs`, `scripts/accept-reach.mjs`, `validator/test/reach.test.js`.
