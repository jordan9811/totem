# attack-att-1 — Adversarial review of the Attestation pass (reviewer 1 of 3)

Scope: the diff `86adfff..HEAD` (`diff-att.patch`, 7,379 lines), `SECURITY-POSTURE.md`
§11–§13, `research/VERIFY-YOURSELF.md`, and the source files named below. Read-only.
Emphasis, as briefed: (a) claim values / wallet addresses reaching the validator and
(d) issuance timing linking a wallet to a persona; (b) and (c) as found. The
acceptance suites (`accept-att{1,2,3,4}.mjs`) were read as claims to attack, not as
evidence. Every "verified on code" line below names the file and line I read.

Conventions: `V` = `validator/zk.js`; "the operator" = whoever reads the validator's
database, log and wire; "a peer" = any device that can build a feed (in the §8
topology every device is a peer); N = decoy count in the fixture.

---

## 1. The prefetch tick fetches an attest tree's leaves ONLY on the tick a persona will prove it — an identified "I am about to prove bucket B" beacon, one jitter window before the anonymous proof  — severity HIGH  — confidence: verified on code

**Where:** `lib/zk/prefetch.ts:104-121` (`runTick`: `prefetchOnce(mode, gateTree())`
unconditionally, then `for (const tree of wantedTrees()) extra[tree] = await
prefetchOnce(mode, tree)`); `lib/zk/gate.ts:179-181` (`wantedTrees()` = the trees of
the claims currently marked wanted); `lib/zk/validatorClient.ts:53-62` (`vget` is a
plain `fetch(VALIDATOR_URL + …)` — the identified channel, no relay);
`prefetchOnce` → `fetchMembers` + `fetchHistory` for that tree
(`lib/zk/prefetch.ts:73`); the proof follows on the anonymous channel inside
`[ZK_JITTER_MIN_MS, ZK_JITTER_MAX_MS]` = `[30 s, 15 min]` (`lib/zk/config.ts:59-60`).

**Attack:** The gate tree is fetched by every client on every tick (uniform: carries
nothing). An attest tree `attest:<issuer>/<bucket>` is fetched by a device on a tick
iff `wanted` holds a claim for that tree — i.e. iff a persona on that device is about
to prove that bucket from that snapshot. The operator (or the network path) records,
per tick: `GET /zk/members?tree=attest:onchain.protocol-history/morpho` and
`GET /zk/history?tree=…` from device D (IP / host; D ↔ root R is already known from
root-level registration, §2 C10) at time T. Within T + [30 s, 15 min] a proof into
`attest:onchain.protocol-history/morpho` carrying `personaId = P` in the clear
(F2b) arrives on the anonymous channel. The set of devices that fetched THAT tree in
THAT window is the anonymity set for P → D → R. In any deployment where a given
bucket is proved by a handful of devices per tick (10-minute cadence, 13 buckets,
a persona proves a bucket once per epoch) that set is 1. Two buckets wanted on the
same tick make it a 2-tree burst — a fingerprint even through a relay that hides
the path (request COUNT per tick differs between clients: 1 + |wanted attest
trees|, plus the anonymous `anonymousHead` per extra tree).

**What it learns / breaks:** persona → device → root, for every attestation proof,
with no crypto broken. The header comment of `prefetch.ts` ("the fetch cadence
carries no information about proof activity") and A-PREPARE-BURST ("ZK Pass 2 BUILT
the fixed-schedule prefetch … every tree a wanted claim names, attest trees
included, on the same tick") describe the gate tree. "On the same tick" fixed the
prove-time fetch (attack-z2-3 #3); it did not make the attest fetch
activity-independent. `accept-att4` #5 checks epochs and hour-grain rows, not
which device fetched which tree on which tick (all parties are 127.0.0.1 —
A-LINKAGE-TEST-SCOPE already says the suite cannot see this class).

**Fix or assumption:** Make the attest fetch uniform: every tick fetches the member
lists (and history) of EVERY bucket tree of every honoured issuer, wanted or not
(≈13 trees today; the census `GET /zk/attest/buckets` is already fetched by every
client every tick, so the tree list is in hand — `snap.buckets`), and the wanted
proof reads from that uniform snapshot. Alternatively route `fetchMembers` /
`fetchHistory` for attest trees over the anonymous path (the head already goes
that way). Until then: **A-ATT-WANTED-TREE-FETCH** — "an attest tree's leaves are
fetched on the identified channel only on the tick a claim into it will be proved;
the operator links that fetch to the anonymous proof that follows within the jitter
window, to the precision of how many devices fetched that tree in that window."

---

## 2. The floor is per bucket; a persona's PROVEN bucket set intersects non-nested trees to a root — and every input to that intersection is public or peer-readable, longitudinal, and static (no cohort rotation needed)  — severity HIGH  — confidence: verified on code

**Where:** floor: `lib/zk/cohort.ts:77` (`size < ZK_ANON_FLOOR` over ONE tree's
members); `lib/zk/prove.ts:129` (`checkCohort(mode, req.tree, …)` — the wanted tree
only). Budget: `lib/zk/budget.ts:26-29` (partition = `(claimKind, tree, gateId)`),
`lib/zk/config.ts:39` (`ZK_PROOF_BUDGET` default 2 per persona per EPOCH; epochs
unbounded, stated at `budget.ts:16-18`). Data: `zk_attestation_claims(persona_id,
issuer, bucket, epoch)` (`V:590-591`, served whole by `GET /zk/attested-map`
`V:1005-1015` to every feed build — `lib/attest/proven.ts:41`, `lib/zk/gate.ts:63`);
`zk_placements(tree, epoch, commitment)` — never pruned (only `resetZk`, `V:1119`);
`GET /zk/members` public (`V:744-751`, A-MEMBERS-PUBLIC); `GET /zk/attestations?
commitment=` PUBLIC and returns every (issuer, bucket, epochs) a commitment holds
(`V:963-987`, no `gatedRead`). Fixture furniture: `lib/attest/chain/fixture.ts:61-66`
("the pairwise intersections the linkage test holds to the floor: morpho∩gt2y ≈
7N/12 …"); `accept-att4.mjs:251-271` checks ONE pair at ONE epoch.

**Attack (operator, or ANY peer):**
1. Read the presence log (`attested-map`, one gated read every feed build): persona
   P proved `{PH/morpho, WA/gt2y}` at epoch E.
2. Read the leaves of both trees at E (`/zk/members`, or the operator's
   `zk_placements`): candidates(P) = leaves(morpho, E) ∩ leaves(gt2y, E).
3. Next epoch P proves `{HO/eth-gte-1, GO/votes-gte-1}` (the budget allows 2 new
   partitions per epoch; the trees are frozen per epoch and archived): candidates(P)
   ∩= leaves(eth-gte-1, E+1) ∩ leaves(votes-gte-1, E+1). And so on — the persona's
   own bucket choices do the intersecting against STATIC trees; nothing has to
   rotate. Add the tier tree the discovery gate proves every epoch.
4. Each leaf's full profile is world-readable through `/zk/attestations?
   commitment=` — the peer need not even diff trees.

Arithmetic, on the fixture's own spread (`fixture.ts:63-66`): morpho 2N/3 ∩ gt2y
7N/8 ∩ eth-gte-1 4N/5 ∩ votes-gte-1 2N/3 ∩ aave 2N/3 ∩ uniswap 3N/4 ≈ 0.155 N ≈ 19
of the 120 decoys — below the floor of 50 after three epochs of ordinary use, with
every single bucket comfortably above it and the label green. Real-world
distributions are far more skewed (the intersection of four independent onchain
attributes is routinely a set of one).

**What it learns / breaks:** persona → root (and root → every persona that shares its
profile trajectory) for any persona that proves more than one non-nested bucket,
now or over time. The posture's intersection reasoning (budget.ts, A-COHORT-ROTATION:
"a 500-leaf cohort isolates one root in ≈ 28 epochs" IF the operator rotates 20% per
epoch) assumed partitions are NESTED tier trees (the intersection of tier-3 and
tier-5 is tier-5, already floored) or operator-driven churn. Attestation buckets
across issuers are independent attributes; their intersection is a new, unfloored
set that the client never counts. §13 states "the k-floor and the attestation
floor are one invariant" per bucket and says nothing about the set a multi-bucket
persona reveals. `accept-att4` #2/#3 pass because the cohort spread was TUNED so the
one pair the test names clears the floor (REPORT-ATT: "a hash-based spread gave
morpho = 47 … so populations and their pairwise intersections are deterministic")
— a property of the furniture, not of the mechanism.

Also: the "subscriber learns only what the persona proved" line in §13 understates
it — every peer receives the ENTIRE presence log (every persona's proven set) on
every feed build, filtered client-side by honour list (`proven.ts:45-48`,
`route.ts attestedMap`), so the persona-level profile is a peer-readable dataset.

**Fix or assumption:** (i) Client-side, the cohort check for an attestation claim
must count the INTERSECTION of the wanted tree's leaves with the leaves of every
other partition this persona has proved in this epoch (all member lists are in the
tick's snapshot after finding 1's fix) and refuse below the floor; (ii) extend the
same to the persona's recent epochs from the device's local pins (`localPins`
already holds per-tree cohorts) — refuse a new partition whose intersection with
the persona's proved history falls below the floor; (iii) the budget's partition
count is not the right bound for non-nested sets — either restrict a persona to
ONE non-nested attestation partition per epoch or make the intersection the
counted quantity. Until then: **A-ATT-BUCKET-INTERSECTION** — "the floor is
per bucket; a persona that proves k non-nested buckets (across issuers, and
across epochs against archived trees) exposes the intersection of k public leaf
sets, which is not floored; the presence log plus the public per-commitment
profile makes this computable by any peer, not only the operator."

---

## 3. The honour list pins issuer IDS; the validator's open registry binds an id to the FIRST key that claims it; nothing on the client pins a key — the operator can be `onchain.*`  — severity HIGH  — confidence: verified on code

**Where:** `lib/attest/subscriber.ts:13,30-33` (`DEFAULT_PATTERNS = ["onchain.*"]`,
`isHonoredIssuer(issuerId)` matches the id only); `V:852-874` (`POST /zk/issuers`:
open, self-signed; same id + other key → 409; the first registrant owns the id);
`lib/attest/subject.ts:51` (a subject whose local key lost the race is refused and
stops there); `lib/zk/prove.ts`, `lib/attest/proven.ts:45`, `lib/rules/evaluate.ts`
`attest.holds`, `lib/adapters/mock/market.ts` `attest.holds`, `lib/zk/privacy.ts:196-
215` (condition 9 checks `isHonoredIssuer(issuer)` — by id) — none compares the
registry's `pubkey` for that id with anything the client holds. §13: "the subject
only ever holds the issuer's PUBLIC key from the validator's registry".

**Attack:** The operator (or anyone who reaches `POST /zk/issuers` first — it is
unauthenticated) registers `onchain.wallet-age`, `onchain.holdings`,
`onchain.protocol-history`, `onchain.governance` under a key it holds, with any
buckets and validity it likes. From then on: (a) every honest subject's reference
issuer 409s at registration and every honest issuance is refused ("issuer signature
does not verify") — the reference issuer is denied on that validator; (b) the
operator signs issuances for any commitment into any bucket, batches them in, and
every client that honours `onchain.*` — the default — treats them as attested: the
feed's `attest.holds` modes, packs, channel gates, the advertiser audience, the
backpack's "attested-tier" claims and the Ad Match Score all honour operator-minted
rows; the client-side floor counts them. The prompt's fixed decision "the operator
is never the issuer" is not enforced by anything in the code; "trust is the
subscriber's choice" is a choice of NAME, and the name→key binding belongs to the
validator.

**What it learns / breaks:** soundness of every attestation-gated surface; the floor
(50 operator-minted leaves clear it); and the reference issuer's availability.
It overlaps C1 ("pad a tree with leaves it minted itself") only partly: C1 admits
the validator's TREE CONTENTS are trusted; the issuer signature was the thing this
pass added so that a leaf's MEANING is not the operator's to invent, and with a
name-only honour list it is. Note also that in the current code every app instance
mints its own `onchain` key (`lib/attest/issuerKey.ts:48-55`), so two honest
subjects on one validator cannot both issue — the reference issuer has no single
identity yet, which is precisely the gap the operator steps into.

**Fix or assumption:** Pin keys, not names: `ATTEST_HONORED_ISSUERS` entries carry a
public key or a family-key fingerprint (`onchain.*@<64hex>`); the tick's snapshot
carries `GET /zk/issuers`; `isHonoredIssuer(id)` becomes `isHonoredIssuer(id,
registryPubkey)` and refuses a mismatch loudly (attempt log + condition 9:
"the registry key for this issuer is the pinned key"); `ensureRegistered`'s 409 is a
hard refusal to honour that id on that validator, not a silent refusal to issue. The
reference client ships with the reference issuer's key. State until then:
**A-ATT-ISSUER-KEY-FROM-REGISTRY** — "the subscriber honours issuer ids; the id→key
binding is the validator's, first-come; an operator that registers an honoured id
first is that issuer for every client that honours it by name."

---

## 4. Join/expiry cells: the bucket tree is partitioned by (active_from_epoch, expires_epoch), both public per commitment; quantizing expiry to the ISSUE epoch only merges roots that issued in the same epoch, so organic issuance and renewal make cells of size ≈ 1 whose edges match a persona's claim-epoch range  — severity HIGH (deployment) / MED (fixture)  — confidence: verified on code; the deployment population is a hypothesis

**Where:** `V:879-923` (`POST /zk/attest`: `activeFromEpoch = epoch + 1`; renewal
keeps `prev.active_from_epoch` at `V:918`; `expiresEpoch` must equal `issuedEpoch +
1 + validity` at `V:906`; `issuedEpoch` may be `epoch - 1` at `V:905`; `created_at`
hour-grain, overwritten on every renewal by `INSERT OR REPLACE`);
`V:963-987` (`GET /zk/attestations?commitment=` — public; returns `issuedEpoch,
activeFromEpoch, expiresEpoch, revokedFromEpoch, claimHash` per row);
`V:353` (tree membership = `active_from ≤ E < expires` and not revoked);
`onchain.ts:57-62` (holdings validity 4 epochs = one day; the rest 28);
`accept-att4.mjs:290-311` (#5/#6 assert that ONE synchronized round shares one
hour and one expiry).

**Attack:** In a deployment issuance is a per-root event whenever that root chooses
(a wallet connect, a daily holdings renewal). Each row's `(active_from, expires)`
is public per leaf and in the operator's table; the leaf diff between epochs
(`zk_placements`) gives the same. For bucket B: roots activated at E+1 form a cell;
roots whose leaf drops at X form a cell; a root that renews holdings daily moves
its `expires` every 4 epochs and its `created_at` hour with it. On the persona
side, `zk_attestation_claims` gives, per persona and bucket, the first epoch it
proved and the last epoch it proved (the table is pruned to two epochs but the
operator keeps its own log — A-PRESENCE-LOG admits exactly that). A persona whose
morpho claims begin at E+1 belongs to a root in the E+1 activation cell; one whose
claims stop at X without the tree thinning belongs to the X expiry cell (or the
revocation of that epoch — finding in att4 #7 says "root-level, stated", but the
persona whose claims stop is the trace it says does not exist). The fixture never
shows this because the whole cohort is issued in ONE request in ONE epoch
(`subject.ts:60-70` cohort loop), so every cell is the whole tree. Additionally,
`V:905` accepts `issuedEpoch = epoch - 1`: a late-submitted issuance activates
with this epoch's batch but expires one epoch earlier than its activation
siblings — a cell of one by construction (a device that was offline at issue
time is exactly the sort of thing that singles a user out).

**What it learns / breaks:** persona → root through the join/expiry/renewal
rhythm of a bucket, to the size of the cell. A-Z3-ATTEST-EXPIRY-PARTITION (a
hypothesis from attack-z2-1 #7) is answered in §13 with "quantized to the issue
epoch, so all issuances of an epoch expire together" — true and insufficient: the
issue epoch is a per-root event time, so the quantization grid is the epoch (6 h),
and for holdings the cell is re-cut daily. C10 admits the JOIN of a registration is
visible; it does not admit that a per-bucket join cell pairs with the first epoch a
persona proves that bucket.

**Fix or assumption:** Quantize BOTH edges to a shared grid coarser than the epoch:
`expires = (floor((issued + 1) / V) + 2) · V` (all roots issuing within a V-epoch
window expire together; for V = 4 that is a daily grid, for 28 a weekly one) and
activation likewise batched per grid window (latency cost, stated); refuse
`issuedEpoch ≠ epoch` (`V:905`); and make the client's cohort check count the
leaves in ITS OWN cell (`/zk/attestations?commitment=` per leaf, or add per-cell
counts to the census) and refuse below the floor. Renewal should not rewrite
`created_at`. Until then: **A-ATT-JOIN-EXPIRY-CELL** — "a bucket tree is
partitioned by activation and expiry epoch, both public per leaf; the floor counts
the whole tree, not the cell; a persona's first and last claim epochs for a bucket
name its root's cell."

---

## 5. Attestation for hire: one wallet attests unlimited commitments, and the issuer never checks that the requester controls the commitment  — severity MED  — confidence: verified on code

**Where:** `lib/attest/types.ts:32-49` (`SubjectRef`: `commitment`, `wallets[]`,
`challenge` — no subject/root/device signature field); `onchain.ts:116-128`
(challenge = `domain|issuer|mode|commitment|epoch|nonce`, signed by the WALLET
only), `onchain.ts:243-261` (every wallet verifies against the challenge; nothing
verifies the commitment's owner), `onchain.ts:157-166` (`retain` appends
wallet-hash → commitments; it is never consulted at issuance); `V:879-923`
(`POST /zk/attest` is unauthenticated: anyone submits an issuer-signed public part
for any registered commitment).

**Attack:** (a) Alice, holding one 5-year-old wallet with 10 ETH and a Snapshot
history, mints a challenge naming BOB's commitment (public: `/zk/members`), signs
it with her wallet, receives issuances for Bob's commitment in `gt4y`, `eth-gte-10`,
`votes-gte-20`, hands Bob the `{claim, nonce, sig}` (or submits the public part
herself) — Bob's vault now proves attributes Bob does not have. One wallet, any
number of commitments, any number of times (a new challenge each). (b) Floor
padding through the HONEST issuer: an operator that is NOT the issuer needs one
qualifying wallet to push every decoy commitment it controls into any thin bucket;
the issuer's own records show one wallet-hash fanning out to hundreds of
commitments and nothing refuses it. This is C1 padding that survives the
"issuer is a separate party" topology and is indistinguishable from organic
issuance on the validator. (c) Tagging: Alice pushes Bob's commitment into a
unique COMBINATION of thin buckets (compound ∩ gt4y ∩ eth-gte-10 ∩ votes-gte-20)
without his knowledge; Bob's persona never proves them, but his root's public
profile (`/zk/attestations?commitment=`) is now unique, and any bucket Bob later
proves legitimately intersects (finding 2) to him.

**What it learns / breaks:** the meaning of every onchain bucket ("the root controls
a wallet with F" becomes "someone with a wallet with F named this commitment"), the
floor's meaning, and — via (c) — a way to make a chosen root unique in the
operator's view. The issuer's "wallet ownership binding" binds wallet → challenge
text, not wallet → subject.

**Fix or assumption:** The challenge must be countersigned by the SUBJECT: an
Ed25519 signature under the root's device-auth anchor (the issuer can fetch the
anchor's public key like any client) or, cleaner, a Semaphore proof of knowledge of
the commitment's secret over the challenge as message (the prover exists). And the
issuer enforces one wallet → one active commitment per issuer (the retention file
already has the index; refuse a wallet bound to another unrevoked commitment;
document that a wallet moves only after revocation). State until then:
**A-ATT-SUBJECT-UNBOUND** — "the onchain issuer verifies wallet control and a
commitment string; it does not verify that the requester controls the commitment,
and a wallet may vouch for unlimited commitments."

---

## 6. The issuer's retention file is a dictionary, not a hash: the salt sits beside the hashes, the address space is public, and the file grows forever  — severity MED  — confidence: verified on code

**Where:** `onchain.ts:130-166`: `SubjectFile = { salt, subjects: { sha256("layers-
attest-subject/1"|salt|address) → [{commitment, issuer, buckets, issuedEpoch}] } }`,
written to `.keystore/issuers/onchain-subjects.json` (`onchain.ts:136`); the salt is
generated once (`onchain.ts:146`) and stored IN the file; `retain` appends on every
issuance and nothing prunes on expiry or revocation. `accept-att2` #6 and
`accept-att4` #4 grep the file for the address LITERAL and for a 64-hex hash.

**Attack:** Whoever holds the file (in the product: the issuer's host; in the demo:
the user's device — and it is beside the issuer key, which is leak-grepped, while
this file is not) enumerates the public address set of the tracked chains (every
address that ever transacted, ~10^8) and hashes each with the file's own salt:
seconds on commodity hardware. The file is then `address → [commitment, issuer,
buckets, issueEpoch]` for every wallet ever bound, including long-expired and
revoked issuances. Combined with the validator's `commitment → root_id`
(registration, root-level, known) that is wallet → account, permanently.

**What it learns / breaks:** wallet ↔ commitment (↔ root), longitudinally. §13
promises "a salted hash of each address … and nothing else; the exact values are
not written anywhere"; the address is recoverable from what is written, and the
"salted hash" gives no protection against the file's holder — only against a
grep. The literal-grep checks are the test-vacuity lesson again (a
dictionary-recoverable hash passes them).

**Fix or assumption:** Use an HMAC whose key is NOT in the file (the issuer key file's
own material, or a dedicated secret in `.keystore/issuers/`), prune entries when the
issuance they name has expired or been revoked, leak-grep the file like key
material, and make the corrupt-file path loud instead of silently minting a fresh
salt (`onchain.ts:139-146`, which also silently loses the ability to revoke). State:
**A-ATT-ISSUER-RETENTION** — "the issuer's host holds wallet → commitment for the
life of the retention file; the hash is a dictionary over the public address
space."

---

## 7. The label's ninth condition is never computed on any rendered surface; attestation-gated surfaces carry no label at all  — severity MED  — confidence: verified on code

**Where:** `lib/zk/privacy.ts:196-215` (condition 9 only when `opts.attestation` is
passed, and for ONE bucket); callers: `app/api/zk/route.ts:369-374` (the test-rig
action is the only caller that passes `attestation`); `components/zk/
PrivacyLabel.tsx:8` and `lib/zk/status.ts:131` call `privacyConditions()` with no
options; `app/(main)/home/page.tsx:132` renders `<PrivacyLabel />` only when
`surface === "discovery"`. The money shot (`accept-att3` #2) is a mode on the
FOLLOWING feed — no label is rendered there at all.

**Attack:** None needed — the surface the user sees when an `attest.holds` mode is
active shows either the 8-condition discovery label (if on discovery) or nothing.
A mode gating on a thin bucket, or on an issuer whose registry key is not the
one the user thinks (finding 3), or on the intersection of two buckets (finding 2:
`in [a, b]` or two clauses — condition 9 takes one), reads as "private" or as
nothing. §13: "An attestation-gated surface carries a ninth label condition …
otherwise the surface is DEMO with that condition named" — true of the API action
and of `accept-att3` #5, not of the product.

**What it learns / breaks:** the label contract for every attestation-gated surface.

**Fix:** the feed build already has the active mode's rule tree — walk it with the
`audienceHasAttestPredicate` pattern (`lib/zk/floor.ts:19-27`), collect EVERY
`attest.holds` value, pass them all to `privacyConditions`, and render the label on
every surface where a mode or pack with an attest predicate is active (following
included); condition 9 iterates over every named bucket and, per finding 2, over
their intersection on the tick's snapshot.

---

## 8. Registration replay rolls an issuer back: `issuerCanonical` has no nonce or version, and re-registration under the same key updates buckets and validity  — severity LOW  — confidence: verified on code

**Where:** `V:129-130` / `lib/attest/canonical.ts:53-55` (canonical = `domain|mode|id|
displayName|schemaHash|buckets|validity|pubkey`); `V:868-873` (`ON CONFLICT(mode,
id) DO UPDATE SET … buckets_json, validity_epochs, schema_json, sig`); `POST
/zk/issuers` unauthenticated.

**Attack:** Anyone who captured an earlier signed registration body (it travels in
the clear on the identified channel, and the current body is `GET /zk/issuers`
minus the sig — but every previous one was also on the wire) replays it: the
issuer's declared buckets and validity roll back; its fresh issuances are refused
at `V:904` (bucket not declared) or `V:906` (expiry ≠ issued+1+validity) until it
re-registers, and a replaying peer can keep it down. A validity rollback also
splits expiry cells (finding 4).

**Fix:** put a monotonic `version` (or `registeredAt`) in the canonical and refuse a
non-increasing one; or make metadata immutable per id (a change is a new id — the
rule the pass already states for keys).

---

## 9. Small ones — severity LOW / INFO  — confidence: verified on code unless marked

- **`issuedEpoch = epoch − 1` accepted** (`V:905`): a cell of one, see finding 4;
  one-line refusal.
- **The challenge hardcodes epoch 0** (`onchain.ts:226`: `mintChallenge(id, subject,
  0)`): the challenge string claims to bind the epoch and binds "0". No exploit
  (16-byte nonce, 10-minute TTL, one use, in-memory) — but the challenge TEXT names
  the commitment in the clear, and it is what the wallet software displays and
  signs: in the product topology the wallet UI, a WalletConnect relay or a
  hardware wallet's host sees `commitment C` beside the signing address
  (hypothesis on the product path; in the demo the wallet is viem in-process).
  Sign over `sha256(challenge)` or put `sha256(commitment)` in the text. State
  **A-ATT-CHALLENGE-VISIBLE-TO-WALLET**.
- **The live chain-facts adapter sends the address to third parties**
  (`lib/attest/chain/live.ts:106-120`: publicnode / base.org / optimism.io RPC,
  three Blockscout hosts, hub.snapshot.org — each learns "address A is being
  looked up at T" from the issuer's host IP; in the demo that host is the user's
  device). Not a validator leak; a stated-nowhere third-party channel. State
  **A-ATT-CHAIN-SOURCE-SEES-ADDRESS**.
- **Migration 009 keeps the old mock rows** (`validator/migrations.js:637-638`:
  `claim_hash = ''`, the validator-signed `sig`, issuer never registered); the tree
  builder does not re-verify (`V:353`), so they prove until expiry under an issuer
  that does not exist in `zk_issuers`. Fixture-only in practice; a migration
  should drop or expire them.
- **`myAttestations` returns vault plaintext to any caller of the app's API**
  (`route.ts` `myAttestations`) — A-DEV-SURFACE class, noted for completeness.

---

## 10. Channel (a), traced clean — severity INFO — confidence: verified on code

What leaves the issuer is exactly `publicPartOf` (`lib/attest/types.ts:83-85`):
`{issuer, bucket, commitment, claimHash, issuedEpoch, expiresEpoch, sig}`.
`claimHash = sha256("layers-zk-attest-claim/1"|kind|bucket|JSON(value)|nonce)`
with a 32-byte per-issuance nonce (`canonical.ts:67-69`, `onchain.ts:277`), and
`value` is `{kind, [asset], bucket, snapshotEpoch}` — the exact facts are dropped
BEFORE hashing (`onchain.ts:276`), so even a nonce leak yields nothing. The
validator stores those seven fields plus hour-grain `created_at`
(`migrations.js` 009) and returns nothing else (`V:963-987`); `validator/server.js`
has no request-body logging (CORS + `express.json()` only); the app's issuance
response is `{buckets, epochs, counts}`; `live-att1` records buckets only. Nested
buckets add rows, not bits (the top bucket implies the rest); the protocol-history
subset (16 combinations) is the bucket design, admitted. Row ORDER in a batch is
`bucketsFor` order, value-independent. The wallet address appears only in the
browser → app request, `verifyMessage`, and the chain adapter call (see the
third-party note above). I found no path by which a value or an address reaches
the validator's database, WAL, log or any response.

---

## Verdict

After this pass the operator — and, for most of it, any peer — can still do the
following, none of which the posture doc admits in §13: link a persona to its
device (hence root) on every attestation proof, because the tick fetches an attest
tree's leaves on the identified channel only when a persona is about to prove it,
one jitter window before the anonymous proof (finding 1); intersect a persona's
proven, non-nested buckets against static, public, archived leaf sets down to a
root, this epoch and across epochs, with no cohort rotation and with the label
green — the floor is per bucket and the fixture's tuned spread is what makes the
one tested pair clear it (finding 2); be `onchain.*` on its own validator by
registering the honoured ids first, since the client honours names and pins no key
(finding 3); read each leaf's public activation/expiry cell and pair it with the
first and last epochs a persona proves that bucket once issuance is organic
rather than one synchronized batch (finding 4); pad any bucket, or tag any root,
through the honest issuer with one qualifying wallet, because the issuer binds a
wallet to a challenge string and never to the subject (finding 5); and recover
wallet → commitment from the issuer's retention file by dictionary, since the salt
is in the file (finding 6). Meanwhile the ninth label condition the doc promises is
not computed on any rendered surface (finding 7). What the doc DOES already admit
covers the rest: the presence log, root-level registration and hour grain, C1
padding of tree contents, the visibility of a join, and the claim-value channel —
which I traced end to end and found clean.
