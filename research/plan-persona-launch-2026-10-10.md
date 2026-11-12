# PERSONA LAUNCH PASS: build plan (design only, no code)

Written 2026-10-10 against HEAD `0eb4143` (deployed `fe780a2`). Read-only: no repo file edited, nothing started.
It reuses three build-ready specs in this scratchpad: `design-siwf-passkey-first.txt` (SIWF),
`design-bring-your-x.txt` (BYX) and `design-friend-whitelist.txt` (DROP). Their research is not redone here; this
plan says what each one needs changed for the new model.

Tags on every item: **BUILT / PARTIAL / NEW** is the state of the code. **LIVE** means it has run on a deployed
service. **TEST-DATA** means it has only run on fixtures or the rig. **OFF** means it is deployed and switched off.
These follow the rules in `lib/status/features.ts`.

---

## 0. In plain words

- Anyone can use Layers as a guest. A passkey saves the identity, so no seed phrase is needed. The root identity can
  start fresh, come from your Farcaster account (scan a QR code) or come from your X archive.
- You make personas. By default a persona posts to Farcaster through the shared **@anon** account. Each post keeps a
  secret only you hold, so you can prove later that you wrote it.
- The people you put in your **rings** ("top 16", where each ring sees a deeper version of you) see which persona
  wrote which anon post. They see a half-and-half avatar: your face on the left, the persona's picture on the right.
- Anon posts from proven big accounts get more reach inside Layers. This uses a zero-knowledge **reach tier**
  ("posted by an account with 10k+ followers"). It never says which account. A tier is offered only while at least
  50 people are in it.
- **Launch** is opt-in and permanent. It reveals all of a persona's anon posts at once, gives the persona its own
  Farcaster account (Layers creates it, not your wallet), publishes its history, and then lets you choose whether
  its future posts stay anon or go straight to the new account.
- This pass builds all of it on test data for $0. Going live needs five things from you: ETH, a Neynar plan, a third
  Neynar app, an X developer account and an xAI key (section 5).

---

## 1. What lives where, and who sees what

```
LAYERS (app + validator; only Layers shows these)
  guest root in your browser; passkey save ......... identity BUILT·LIVE (public); passkey save BUILT·TEST-DATA
  personas ......................................... BUILT·LIVE (both sites)
  rings ("top 16"): who may see which links ......... grants BUILT·TEST-DATA (no button); DROP spec NEW
  ring notes on anon posts (which persona wrote it) . NEW
  half-and-half avatar for ring members ............. BUILT·TEST-DATA for persona merges (CastCard cast-split-avatar);
                                                     NEW on anon cards; swap sides to root-left / persona-right
  reach-tier boost for anon posts in For You ........ tier gate BUILT·TEST-DATA (lib/zk/gate.ts); boost NEW
  reveal records + public proof pages ............... reveal BUILT·TEST-DATA (below the closing bar, §14.1); pages NEW
  launch flow ....................................... NEW
FARCASTER (every client, every hub)
  @anon, the shared account the validator posts from  BUILT·TEST-DATA (owner service: armable, never run live)
  your main account (imported) ...................... owner: QR connect BUILT·TEST-DATA; public: SIWF NEW (read-only)
  launched persona accounts (@persona) .............. NEW (the owner-only acquire path is BUILT·OFF; see §3 R1)
X
  @layers anon outbox (X version of anoncast) ....... NEW
  @layers DM inbox (DM a tweet to save it) .......... BUILT·TEST-DATA (lib/x/inbox.ts; read-only, fixture)
  your X: archive import + Farcaster-verified handle  archive PARTIAL·TEST-DATA; rest NEW (BYX spec)
```

| Observer | Sees | Never sees |
|---|---|---|
| Farcaster hubs and other clients | @anon's casts, launched accounts, their creation time, the registrar, the app fid that vouched each key | root, rings, ring notes, which root wrote an anon cast, reach tier (it lives in Layers' list) |
| Neynar (managed signers, relay key) | every anon text and time, every managed write | who wrote an anon cast; the root behind a self-custody launched persona |
| Layers operator (validator) | anon texts, the hour, the reach tree, reveal rows, padded sealed blobs, request IPs unless OHTTP is used | root to persona, root to anon post, ring members, note contents |
| A ring member's device | the personas and anon posts that ring was given (the notes decrypt) | other rings, posts that were not shared, the root's other personas |
| Another Layers user outside your rings | the bare persona, or plain @anon | any link |
| X | the @layers account's posts and DMs | who submitted an anon X post |

---

## 2. User journeys

**2.1 Guest, then save, then a root.**
1. You open the site and a root is minted in the tab. BUILT·LIVE (`identity`).
2. After your first post or persona, a "Save with Face ID" card appears; the 24 words sit under Advanced. The passkey
   core is BUILT·TEST-DATA (`save`); the save moment and passkey-first ordering are NEW (SIWF spec).
3. Pick a root source:
   - **Fresh:** BUILT·LIVE.
   - **From Farcaster:** scan a QR code; the account becomes a read-only "public self". NEW (SIWF spec). On the
     owner service, QR connect with a posting signer is BUILT·TEST-DATA (`lib/fc/connect.ts`).
   - **From X:** the archive is read in the browser and the handle checked against Farcaster's public X
     verifications. NEW (BYX G0–G4, G6). Real X login needs a paid developer app (C7).

**2.2 Create a persona.** Name, picture, bio and kind are BUILT·LIVE; a ring assignment is NEW. A new **post mode**
field on the keystore and roster record takes `anon` (default), `private` (Layers only) or, after launch, `direct`.

**2.3 Post.** The composer says "Posting as @persona through @anon". At the next tick the device proves "a free slot
of my person this window, member of reach tree T" over the anonymous channel, and the validator relays the post from
@anon at a random moment in the next slot.
- BUILT·TEST-DATA: root-level anon posting (`requestAnonPost`, `lib/zk/gate.ts`), the reveal secret
  (`lib/zk/anonAttribution.ts`), store-and-forward relay and the cap (`validator/zk.js`).
- NEW: the persona in the sealed reveal record (today `AttributionRecord` has no personaId), several slots per window,
  a choice of reach tree, a ring note, and an X toggle (2.6).

**2.4 Show to your rings.** You make up to 16 named rings (Inner, Close, ...) and pick which personas each ring sees,
and how deep. A ring invite is a private address or link (DROP spec), passed over Signal or in person; members'
devices pick up fixed-size sealed notes on the prefetch tick. Members see the half-and-half avatar on linked personas
(BUILT for persona merges) and "@persona · shared with you by <label>" on anon posts given to their ring (NEW).
Revoking takes effect at the next publish, and members keep what they already saw. DROP v1 lets only the owner
service publish, so strangers need multi-writer publishing (NEW, D8).

**2.5 Launch a persona.**
1. **Preview** (NEW), before anything is signed. It lists:
   - every anon post that will be linked, with its date and reach tier;
   - the new account's name, picture and bio;
   - what launch narrows: "boosted as a 100k+ account, so @persona belongs to one of the N accounts in that tier",
     your posting hours, your style;
   - what stays hidden: root, other personas, main, other anon posts;
   - "your account appears within 2 to 48 hours at a random time";
   - the price (not wired this pass).
2. **Confirm** by typing the handle. The screen says there is no undo before you can type.
3. **Account.** The device signs Register and Add with the persona's own derived custody key (`fcCustodyAddressFor`).
   The request goes over the anonymous channel to the Layers registrar queue, which submits one Bundler transaction
   (register, add the self-custody signer, rent storage) in a random-time batch.
4. **Reveal.** Once the key is on the account, the device sends one batch reveal signed by that key (`/zk/anon/reveal`
   gains a batch form). Anyone can now check it, which closes A-FID-ATTR-SIGNER-KEY-IS-NOT-YET-A-CASTING-KEY.
5. **History** (D5). A launch cast linking the proof page, plus up to 10 quote-casts of chosen originals. Inside
   Layers the profile shows the whole history at the original dates, labelled "revealed from @anon".
6. **After.** A required choice per persona:
   - **anon:** posts keep secrets and can be revealed in a later batch;
   - **direct:** the device signs casts and a thin relay forwards them.

   Going from direct back to anon is weak once your style is public, and the screen says so.

**2.6 X.** You can tick "also post to @layers on X" on an anon post, or submit a tweet or article link. It takes the
same proof with its own slot (`x-anon-post`). Owner-blocked (O4). DMing a tweet to @layers saves it to your shelf if
your X handle is linked and attested: BUILT·TEST-DATA (`lib/x/inbox.ts`). xAI x_search is for discovery and reach
facts only; it cannot DM, post or prove ownership.

---

## 3. Privacy rules, and the attack each one stops

- **R1. Layers registers the accounts, not you** (NEW; replaces the Neynar App Wallet path for launches).
  - A fresh Layers registrar wallet calls Farcaster's Bundler and pays
    ([Bundler](https://docs.farcaster.xyz/reference/contracts/reference/bundler)). It is funded by an exchange
    withdrawal and never touches the throwaway account, main, the connector or a persona.
  - The persona's own derived custody key signs Register and Add in the user's device.
  - One Layers registrar app fid vouches every persona key, so "made by Layers" is the uniform fingerprint.
  - Recovery is a second root-derived key (`fc-recovery/<nonce>`, NEW), so Layers can never seize an account.
  - *Stops:* the onchain sibling link (A-FID-REGISTRANT-BY-FIAT: App Wallet `0x60a5…` also registered the
    Layers-named test account), funder traces, and joins to the user's own wallet.
  - *Residual:* the "made by Layers" crowd is small at first. Main's connector fid must never be this app fid.
- **R2. Random creation timing.** One registrar batch a day at a random hour, plus per-item jitter, 2–48 h after the
  click; fname and profile are set in the same batch. *Stops:* joining click time to block or fname time
  (A-FID-CREATION-TIMING). *Residual:* a batch of one in a quiet week.
- **R3. The launch request carries no identity.** It goes over the anonymous channel (`/zk/anon/submit`, OHTTP when
  armed) with a one-launch-per-window proof, never device-signed; the registrar learns a custody address and a
  profile, never the root. A future payment must be prepaid blinded credits, because a card charge at launch would
  join payer and persona.
- **R4. Per-person caps that do not link posts.**
  - Today: one anon post per root per 6 h window; live cap 1, hard maximum 100 (`ZK_ANON_POST_LIVE_CAP`).
  - NEW: an indexed scope `(window, i)` with `i < K`, one nullifier per slot. Posts in a window stay unlinkable and
    personas share one budget. No circuit change: the scope string changes on both sides (`lib/zk/scopes.ts`,
    `validator/zk.js`).
  - Sybil resistance comes from the tree: one attested account vouches for one root, so fresh browser roots get no
    slots. Numbers in D4.
- **R5. Batching (speed vs correlation).** Today proofs leave 30 s–15 min after queueing (`ZK_JITTER_MAX_MS`) and the
  relay runs hourly plus up to 10 min, in random order, with hour-grained rows. The trade-off:

  | Setting | Slot | Spread | Visible after | Crowd per slot |
  |---|---|---|---|---|
  | fast | 15 min | 15 min | ≤ 45 min | smallest |
  | **default (proposed)** | 30 min | 30 min | ≤ 75 min | medium |
  | cautious | 1 h | 6 h | ≤ 7 h | largest (`ZK_ANON_RELAY_SPREAD_MS` exists) |
- **R6. Tier crowd floor.**
  - A reach tree is offered only with **≥ 50 members** (the existing `ZK_ANON_FLOOR` default; cohort check in
    `lib/zk/cohort.ts` / `floor.ts`, churn ≤ 0.2).
  - Buckets nest (≥1k ⊃ ≥10k ⊃ ≥100k). A 100k account proves ≥10k until the top bucket fills, and anyone may prove
    lower. The For You label shows only if that epoch's root history had ≥ 50 leaves.
  - *Stops:* "a 100k account" naming one of three known people.
  - *Residual:* the issuer sees fid → commitment at issuance (who is in a tree), never who posted.
- **R7. Reveal is permanent and all at once.** Launch reveals every anon post the persona made, in one hour-grained
  event signed by its registered key. No drip reveals (D7) and no un-reveal (A-FID-ATTR-IRREVERSIBLE). *Stops:*
  repeated reveal-time correlation. *Costs, shown in the preview:* the remaining crowd shrinks
  (A-FID-ATTR-CROWD-OF-ONE), and the windows used hint where the root's other posts could be (NEW
  A-LAUNCH-WINDOW-OCCUPANCY).
- **R8. Ring notes are uniform.**
  - Every anon post carries a fixed 256-byte note: real (sealed with the ring's key for that persona and depth) or
    random.
  - `sha256(note)` is bound into the proof message beside `attributionCommitment`.
  - Members trial-decrypt locally; keys travel inside DROP envelopes; revoking rotates the key for future posts.
  - *Stops:* the operator learning which posts have an audience, and note swapping.
  - *Residual:* A-NOTE-RING-CAN-FORGE (a member could tag their own post as yours for that ring; designated-verifier
    tags are v1.1, matching DROP's deniable v1); revoked members keep old keys.
- **R9. Your accounts never touch.** `assertNoSelfLink` (`lib/fc/writes.ts`, BUILT·TEST-DATA); launched fids join
  `ownAccountFids`. The launch quote-casts of @anon originals are the one allowed interaction, and the preview names
  them.
- **R10. Not stopped, said plainly.** Writing style (a launched persona's public posts help attribute its future anon
  ones); posting hours; Neynar reads every anon text (A-FID-NEYNAR-SEES-ALL); `ZK_RELAY=direct` shows IPs to the
  operator, so the label stays DEMO until a third-party OHTTP relay exists; the owner service's crowd is one
  (A-ANON-SET-OF-ONE).
- **R11. The Layers operator.** *Can see:* anon texts and their hour, each post's reach tree, reveal rows, launch
  timing, padded namespace names, IPs. *Cannot see:* which root wrote which anon post, root to persona or account,
  ring membership, note contents. It cannot forge a reveal, because reveals are signed by a key registered onchain.


---

## 4. Build phases for this pass ($0, test data only, honest statuses)

Three tracks run in parallel (onboarding A, core B, rings C) and merge per gate.

**Every phase keeps green:** the full `scripts/sweep-x.sh` list (87 suites), especially `test:validator`,
`test:anon-reveal`, `test:z1`–`z9`, `test:fid0`–`fid5`, `test:att1`–`att4`, `test:connect`, `test:fc-buttons`,
`test:help`, `test:rootleak`, plus `test:world-empty`, `test:cu4`, `test:cu6` and `test:prodlive` on the prod shape.
Statuses stay "fixture" until the owner sees each one on a deployed service.

- **P0. Model and honest copy (0.5 day).** Add status rows `persona-launch`, `rings`, `reach-tier`, `x-anon-outbox`
  (all "soon" until built), the post-mode field, and Help/docs wording ("reach tier" vs "ring").
  *Accept:* `test:help` and `docs:check` pass; no "live" claim anywhere.
- **P1 (Track A). Sign in with Farcaster + passkey first.** The SIWF spec as written (3 gates, ~3 agent-days). Delta:
  the public self becomes the "root headshot" for half-and-half avatars. *Accept:* its U1–U9, R1–R9, P1–P12.
- **P2 (Track A). Root from X.** BYX G0–G4 and G6 (honesty gate, loud flush, chunked docs, ZIP intake, keyless index,
  Farcaster-verified badge); ~7 agent-days. Find-my-people and the follow queue (G5) come later.
  *Accept:* BYX U1–U7, U9–U10, `accept-x5` R1–R9 and R11–R13, plus `test:x0`–`x4`.
- **P3 (Track B). Persona-scoped anon posting.** `AttributionRecord.personaId`; persona post mode; composer default
  `anon` for personas without an account; the indexed scope `(window, i)` on both sides (a DELIBERATE DUPLICATE pair);
  relay slot/spread knobs; a daily global cap replacing the row-count cap; migration adding `tree` and `note` to
  `zk_anon_casts`. *Accept:* K posts in a window give K distinct nullifiers and post K+1 is refused; two posts by one
  root stay unlinkable in the operator-view linkage test (extend `test:fid5` into linkage v6); no persona id in
  plaintext (`test:rootleak`).
- **P4 (Track C). Rings and notes.** DROP gates 1–4, plus multi-writer publishing for strangers (device-signed, padded
  to buckets of 4, D8); ring keys inside the envelope; the 256-byte note bound into the proof; trial-decrypt in
  `lib/zk/prefetch.ts`; anon cards merge for members, avatar sides swapped to root-left / persona-right.
  *Accept:* a member sees "@persona" on exactly the shared posts and a non-member sees `anon` byte-for-byte; a DB
  grep finds no persona or ring material; the note size is identical with and without a ring; after revoke, new
  posts stop decrypting.
- **P5 (Track B). Reach tiers and the For You boost.** New issuers behind the open interface: `fc.reach` (follower
  buckets ≥1k, ≥10k, ≥100k, fixture first) and `x.reach` (fixture), one account per root. An anon post may prove any
  allowed tree and the row records it. The For You ranker boosts anon cards by tree (today they are simply appended,
  `lib/feed.ts` near line 917), applying R6. *Accept:* a bucket under 50 is never offered and the client refuses to
  prove into it; the boost order is deterministic on the seed; `test:att1`–`att4` and `test:z8` pass.
- **P6 (Track B). Launch on test data.** The preview, the typed confirm and the anonymous launch request; a fixture
  registrar (Bundler simulation, random-time batch, $0 spend ledger); `PersonaFidRecord` origin `layers-launch` with a
  self-custody signer (`selfCustody.ts` is fixture-only today); the batch reveal, proof pages, the D5 history method
  and the post-mode choice. Direct mode on the rig signs a `CastAdd` with the persona key through a fixture
  thin-relay seam. *Accept:* a new `accept-launch` suite:
  - nothing is linked before the confirm;
  - after it, every anon post of P is revealed and none of its siblings' are;
  - registration lands 2–48 h after the click (sim clock);
  - the registrar request carries no device headers;
  - the reveal verifies against the registered key;
  - a forged reveal still renders `anon`.

  `test:fid2` and `test:anon-reveal` must also pass.
- **P7 (Track B). Strangers on the public site (fixture universe).** A Web Worker prover (snarkjs) and a browser
  anonymous channel (direct now, OHTTP-ready); today the device refuses `node:http` and the live prover is a forked
  child process. Anon availability stops depending on `ADAPTER_REP=zk` for the whole site. Public anon posts stay
  preview-only and labelled. *Accept:* `test:cu6`, `test:prodlive` and a new prod-shape suite pass; phone proving
  time is measured and recorded in the gate report (unmeasured today).
- **P8 (Track B). X outbox and DM inbox UI (fixture).** A validator queue for `x-anon-post`, a fixture X transport,
  the composer toggle, and inbox status in Settings with "test data" labels. *Accept:* `test:x0`–`x4` and
  `test:m2g5` (DM hook) pass; no X call leaves the fixture.
- **Closing.** Three adversarial reviews (linkage through notes, slots and launch timing; the registrar and the
  reveal as an attack surface; browser proving and the channel), four consecutive clean sweeps at the new baseline,
  then a deploy with statuses still "fixture".

Size, honestly: P3–P8 are about 12–16 agent-days on top of P1 (3) and P2 (7). Money spent: $0.

---

## 5. Phases blocked on the owner (and what unblocks each)

| # | Needs | Unblocks | Rough cost (sources in §8) |
|---|---|---|---|
| O1 | A fresh Layers registrar wallet with ETH on Optimism (from an exchange withdrawal), plus one registrar app fid | live launches; owner-service launches first | ~$0.20 storage unit per account + gas (cents); +$0.20 per extra 100 casts. Neynar sponsorship measured $0.35–$0.90 |
| O2 | A third Neynar app ("Create Agent") for the **public** @anon, separate from the owner's | live anon posting for strangers | 150 credits per cast; at 500/day ≈ 75k credits/day. Storage: 500/day ≈ 1,825 units ≈ $365/yr. Rate limit 200 × units messages/day |
| O3 | A Neynar plan sized for the above, plus the read key (FC-READ is OFF today) | live reach facts (`fc.reach`), live reads, quote-cast lookups | plan tier |
| O4 | An X account and X developer pay-per-use billing | live X outbox, live DM inbox, X login later | `lib/x/ratecard.json`: $0.015 per post, $0.195 with a link (last verified 2026-08-01; VERIFY) |
| O5 | An xAI key | X discovery and `x.reach` follower facts for Farcaster-verified handles | $5 per 1k posts, $10 per 1k profiles (owner's figure). No DMs, posting or ownership proof |
| O6 | Payments (per-launch price) | charging for launches | needs blinded prepaid credits (R3); later pass |
| O7 | Custom domain, before strangers save passkeys | passkeys that survive a domain move (SIWF decision 5) | ~$10–15/yr |
| O8 | A third-party OHTTP relay (optional) | the privacy label's network condition | vendor |

---

## 6. Decisions (the owner confirmed every recommendation below on 2026-10-10: "go on the 8 decisions")

- **D1. Tier sources.** *Recommend:* Farcaster followers (≥1k / ≥10k / ≥100k) plus the existing `neynar.score` ≥0.7
  as the entry ticket. Ownership is proven by a QR sign-in, at $0 beyond read credits. X followers come next (a
  Farcaster-verified handle plus xAI); Layers' internal rep stays internal. Expect ≥100k to stay locked until 50 such
  people join.
- **D2. Default post mode.** *Recommend:* `anon` for personas without an account (your model). At launch the choice
  is required; if one must be preset, preset `anon`, because it is the reversible choice.
- **D3. Per-launch price.** *Recommend:* about $5 (covers ~$0.40 onchain, the credits and an abuse margin). Nothing is
  wired this pass; it needs blinded credits.
- **D4. Anon cap numbers.** *Recommend for the public site:* **4 per person per 6 h window** (16 a day, shared across
  personas), **30-minute** relay slots with a 30-minute spread, and a **global cap of 500 a day**. *For the owner
  service:* keep the cap at 1 until the first live cast is seen.
- **D5. Launch history method.** *Recommend:* post at the current time: one launch cast plus a proof page, up to 10
  quote-casts of originals you pick, and the full history shown inside Layers at the original dates. Backdating is
  possible on Farcaster, but it proves nothing, is pruned first and sits before the account's registration (§8).
- **D6. Registrar.** *Recommend:* FRESH. A new Layers-owned wallet calls Bundler directly. This settles the pending
  SIBLINGS-vs-FRESH question; never use the App Wallet that made the throwaway account.
- **D7. Partial launches.** *Recommend:* everything at once, no exclusions in v1. A held-back post becomes easier to
  pin on you once your posting pattern is public.
- **D8. Ring publishing for strangers.** *Recommend:* device-signed and padded to buckets of 4 in v1 (the operator
  learns a rough ring-count class). Proof-authorized anonymous writes come in v1.1.

Recorded during the build (a lead decision, not one of the eight the owner confirmed):

- **D-REACH-ISSUER-HOST-ONLY (2026-10-12, at wave 2's close).** On the public site the reach issuers (`fc.reach`,
  `x.reach`) refuse to register or issue inside the visitor's browser device (`lib/attest/registry.ts`
  `HOST_ONLY_ISSUERS` / `issuerUnavailableHere`, checked first in `lib/attest/subject.ts`), because there the issuer
  key would be the visitor's own: it would squat the open registry's id and could self-issue any tier. So P5 on the
  public site needs an issuer Layers runs (a later step) as well as P7's browser prover. Wave 2 (P4 to P6) was
  deployed to both sites on 2026-10-12, statuses still "fixture". `SECURITY-POSTURE.md` §25.

Recorded during wave 3 (P7 and P8, built on test data 2026-10-13, not deployed; lead decisions, not owner decisions):

- **D-ANON-SWITCH (P7).** One function decides whether anonymous posting is on (`lib/zk/anon/availability.ts`), for the
  gate and the composer's route alike. `ZK_ANON_POST=off` (an app variable) is the kill switch on both sides of the app, its
  server and every visitor's tab (the server forwards it to the browser device; a value that is neither on nor off
  reads as off). The public site no longer depends on
  `ADAPTER_REP`: in the browser device the live universe is off and the test universe is on, preview-only. On the rig
  and the owner service the old rule holds (`ZK_ANON_POST=on`, or unset with `ADAPTER_REP=zk`). `SECURITY-POSTURE.md`
  §27.
- **D-PUBLIC-ANON-TREE (P7).** Strangers prove the validator's plain anon tree (`ZK_ANON_POST_TREE`, default `tier-2`);
  no reach tiers in the browser (D-REACH-ISSUER-HOST-ONLY); no deployment variable changed this wave. §27.
- **D-PROVER-BUNDLE-BUDGET (P7).** The build fails when `public/device/device.js` is over 4,718,592 bytes or carries a
  snarkjs or ffjavascript marker, or when `public/device/prover.js` (the only browser file with snarkjs, GPL-3.0) is
  over 1,572,864 bytes. Built 2026-10-13 (wave 3 final verify): 4,370,917 and 441,369 bytes. The GPL-3.0 distribution duty of `prover.js` is
  §5 (A-GPL-SOURCE-OFFER, the owner's). §27.
- **D-X-SLOTS (P8).** K_X = 1 anonymous X copy per person per window on both sides (`ZK_X_ANON_POST_SLOTS`, 1 to 4),
  under its own scope feature (`x-anon-post`), so an X nullifier never equals an anon-post nullifier. A daily cap of 50
  for both copies taken and posts made (`X_OUTBOX_DAILY_CAP`); an hourly relay slot (`X_OUTBOX_RELAY_INTERVAL_MS`) with
  a random spread (`X_OUTBOX_RELAY_SPREAD_MS`: 30 minutes on the public shape, 0 elsewhere). §28.
- **D-X-COPY-UNATTRIBUTED (P8).** A launch never reveals an X copy: it carries no reveal secret, no attribution
  commitment and no ring note. Its words still pair it with its Farcaster sibling (A-X-COPY-LINKED-BY-WORDS), so its
  tree is folded into the persona's crowd count. §28.
- **D-X-PUBLIC-OFF (P8).** The X outbox is not offered in the public site's browser device this wave (the toggle, the
  route, the tick's read). The public validator mounts the routes but has no moderator, so nothing is ever approved
  there. Every X copy waits for a moderator's signed decision before anything posts (the owner's rule for a public
  anonymous account), and articles go as a quote and a link, never in full. §28.

---

## 7. Conflicts with the model, risks, and what would make this design wrong

**Conflicts to settle:**
- **C1.** Anon by default makes every everyday post rate-limited and delayed (R4, R5).
- **C2.** Strangers cannot post to Farcaster at all today; only the single-tenant owner service can
  (`notes/runbooks/GO-LIVE-FARCASTER.md` §(h)). P7 stays fixture-only until O2.
- **C3.** DROP v1 publishes only from the owner service, so rings for strangers need D8.
- **C4.** "History with original dates" is a display inside Layers, not a Farcaster fact.
- **C5.** The max tier stays locked until its crowd exists (R6).
- **C6.** Paying per launch is a linkage point unless the credits are blinded.
- **C7.** "Import X as root" means the archive plus a Farcaster-verified handle; real X login needs O4.

**Risks:**
- **Pruning.** At 100 casts a unit, @anon's originals are pruned unless storage is bought, which breaks quote-casts.
  Keep the app-side archive (the validator's rows) so proofs never depend on the network copy.
- **Rate limit.** One account gets 200 messages per unit per day. More volume means buying units or splitting @anon
  into several accounts, and splitting splits the crowd.
- **Neynar's raw-message gateway** documents a ±10-minute timestamp rule (unverified). It matters only if D5 changes.
- **Storage registry.** Its deprecation timestamp reads 2027-08-28; what replaces renting is unknown.
- **snarkjs is GPL-3.** Shipping it in the public browser bundle carries distribution duties (P7).
- **Legal and terms.** An anon posting service on Farcaster and X faces the UK OSA, the EU DSA and X's automation
  terms; moderation and takedown are not designed here.
- **Issuer knowledge.** The issuer sees who is in each reach tree; a launched persona's tier narrows it to that tree.

**This design is wrong if:** the cap must be per persona rather than per person; a launch must allow cherry-picking;
other clients must see the boost; users must pay chain fees from their own wallets (this breaks R1); or plain-Farcaster
viewers must see ring links (impossible beyond DROP's private `/d` card).

---

## 8. Verified 2026-10-10 (backdating and storage)

**Backdating.**
- Snapchain rejects only future timestamps, more than 10 minutes ahead (`ALLOWED_CLOCK_SKEW_SECONDS`). There is no
  lower bound for casts, and nothing compares a cast's timestamp to the fid's registration or the signer's add time.
  [message.rs](https://github.com/farcasterxyz/snapchain/blob/main/src/core/validations/message.rs),
  [engine.rs](https://github.com/farcasterxyz/snapchain/blob/main/src/storage/store/engine.rs)
- Pruning is oldest-timestamp first, so a backdated cast on a full account is accepted and then dropped.
  [store.rs](https://github.com/farcasterxyz/snapchain/blob/main/src/storage/store/account/store.rs)
- Removing a signer revokes every message it signed.
  [SPECIFICATION.md](https://github.com/farcasterxyz/protocol/blob/main/docs/SPECIFICATION.md)
- The docs say timestamps "can be backdated".
  [messages](https://docs.farcaster.xyz/learn/what-is-farcaster/messages)

**Neynar.**
- `POST /v2/farcaster/cast` has no timestamp field: [publish-cast](https://docs.neynar.com/reference/publish-cast).
- `POST /v2/farcaster/message` takes a message signed by a developer-managed signer:
  [publish-message-to-farcaster](https://docs.neynar.com/reference/publish-message-to-farcaster).
- `snapchain-api.neynar.com/v1/submitMessage` documents "within 10 minutes":
  [publish-message](https://docs.neynar.com/reference/publish-message).
- 150 credits per message: [compute-units](https://docs.neynar.com/reference/compute-units).

Feeds sort by timestamp, so a backdated cast files deep in the profile and never reaches followers.

**Storage.**
- Units rented since 2025-07-16 hold 100 casts each.
  [stores.rs](https://github.com/farcasterxyz/snapchain/blob/main/src/storage/store/stores.rs)
- $0.20 per unit per year (FIP 229); the onchain `usdUnitPrice` is 20000000.
  [FIP 229](https://github.com/farcasterxyz/protocol/discussions/229),
  [StorageRegistry](https://optimistic.etherscan.io/address/0x00000000fcCe7f938e7aE6D3c335bD6a1a7c593D)
- Rate limit: 200 × units messages per day.
- No per-fid unit cap; overflow prunes the oldest. Registration includes one unit.
- Neynar's buy-storage endpoint needs `x-wallet-id`:
  [buy-storage](https://docs.neynar.com/reference/buy-storage).

Not verified: whether the Farcaster app renders backdated casts differently, and whether production nodes enable the
mempool rate limiter.

**Code read for this plan:** `lib/zk/anonAttribution.ts`, `lib/zk/anon/queue.ts` (AttributionRecord),
`lib/zk/gate.ts`, `app/api/anon/route.ts`, `validator/zk.js` (EPOCH_MS 6 h, `ZK_ANON_FLOOR` 50,
`ZK_ANON_POST_LIVE_CAP` 1/100, relay hourly +10 min, spread, max attempts 6, `/zk/anon/reveal`), `lib/fc/acquire.ts`
and `scripts/fid-acquire.mjs` (2 accounts default, 20 max, $10/$25 caps, registrant ack), `lib/fc/personaFid.ts`,
`lib/fc/custody/selfCustody.ts`, `lib/fc/writes.ts`, `lib/fc/attribution.ts`, `components/CastCard.tsx`,
`lib/feed.ts`, `lib/attest/issuers/{neynar,x,onchain}.ts`, `lib/device/deviceEnv.server.ts`,
`lib/device/shims/node-net.ts`, `lib/zk/transport/live.ts`, `lib/x/{inbox,oauth}.ts`, `lib/x/ratecard.json`,
`lib/status/features.ts`, `SECURITY-POSTURE.md` §14, 14.1, 14.2, 18 and 20, `notes/runbooks/GO-LIVE-FARCASTER.md` §(h).
