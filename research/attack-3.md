# attack-3 — the operator's report

**Lens:** I run the validator. I have full read/write on `validator/layers.db`,
I can edit `validator/*.js`, set every `ZK_*` env var, serve different bytes to
different clients, and delay or reorder responses. I am not trying to forge a
proof. I am trying to (a) link two personas of one root, (b) make the product
show "private" when it is not, or (c) neutralise a client-side defence
(root-history anchor, TOFU pin, proof budget, jitter) from my side of the wire.

Read first: `SECURITY-POSTURE.md`, `research/VERIFY-YOURSELF.md`. Findings that
merely restate an admitted assumption are marked as such and de-rated.

---

## Summary

The cryptography is not where this loses. The proof layer does what the posture
says: the scope registry genuinely forces `personaId` into the per-persona scope
(`lib/zk/scopes.ts:101-114`), the Merkle path is derived locally from public
leaves (`lib/zk/prove.ts:68-73`), the history chain is hash-linked and signed,
and the client refuses roots outside it. I could not break any of that.

What I can do is control **everything the defences are measured against**:

1. **I own the cohort, per epoch.** Tier trees are rebuilt every epoch from a
   *percentile decile* over a `roots` table I write (`validator/rep.js:21-31`).
   Rotating the decoy population between epochs gives every epoch a
   floor-clearing tree and gives me an intersection that collapses to one named
   account — and therefore to a set of sibling personas. No fork, no forged
   signature, one honest global history. **This is the finding that matters.**
2. **I own the clock.** `epoch` is fetched from me (`lib/zk/prove.ts:63`), the
   epoch *length* is my env var (`validator/zk.js:59`), and the budget is keyed
   on `(persona, epoch)` (`lib/zk/budget.ts:16-18`). The one mitigation for the
   personaId-in-the-clear join key resets as fast as I want it to.
3. **I own the storage the defences live in.** The root anchor and the proof
   budget are vault namespaces flushed to *my* `/state` endpoint
   (`lib/vault/vault.ts:59-67`, `lib/adapters/mock/persist.ts:208-251`) and
   re-read from an unauthenticated, unsigned `GET /state`
   (`validator/server.js:312-319`). Encryption stops me reading them. Nothing
   stops me **deleting** them — and "absent" is the benign first-run state.
4. **I own three of the six label conditions outright**, and two more are set by
   an unauthenticated POST. The green "private" band is reachable with zero
   privacy properties holding.

Severity ladder below. F-1, F-2 and F-3 are the ones I would actually run.

---

## Findings

### F-1 — Cohort rotation: sibling linkage with every stated defence intact and green

**Claim.** I can identify which root a persona belongs to — and therefore which
personas are siblings — by varying tier-tree *membership* across epochs. Every
epoch's tree clears the anonymity floor, the root history is a single honest
signed chain served identically to everyone, no signature is forged, and the
label can read "private" throughout.

**My moves.**

1. Tier membership is not an absolute threshold. `tierForRoot` is a percentile
   decile over every row in `roots` (`validator/rep.js:21-31`), so I can move any
   root across the `tier-T` boundary by inserting or deleting rep rows for *other*
   roots — I never touch the target's data.
2. `buildTrees` recomputes membership from live registrations and live tiers on
   the first request of each epoch (`validator/zk.js:184-192`), then freezes and
   signs it. The freeze is *within* an epoch only. Between epochs I am free.
3. Epoch E: put target root R plus 500 commitments I generated myself into
   `tier-2`. Epoch E+1: same target, a **disjoint** 500. Two epochs, intersection
   = {R}. Or, cheaper at scale: each epoch put a random half of the real
   registered roots above the tier line and the other half below, and read off
   who proved.
4. Read the answer out of a table I already keep by design:
   `zk_eligibility(mode, persona_id, gate_id, epoch)`
   (`validator/migrations.js:175-186`). A persona that proved this epoch has a
   row; one whose root fell below the line has none, because the client refuses
   at the membership stage before any proof exists
   (`lib/zk/prove.ts:85-87`) — the absence is the bit I want.
5. Over W epochs each persona accumulates a W-bit proved/not-proved vector.
   That vector *is* its root's partition history. `log2(N_roots)` epochs isolate
   any root; **personas of one root have identical vectors**, so siblings fall
   out of the same data with no extra work.

**What the client does.** Nothing. `prepareAndProve` fetches members, checks the
root against the signed history, checks `members.members.includes(commitment)`
(`lib/zk/prove.ts:68-90`) and proves. There is no check anywhere that the cohort
is *stable*, that it overlaps last epoch's, or that its members are distinct
principals rather than leaves I minted. The anonymity floor is a per-epoch count
of leaves; I supply the leaves.

**Why the named defences do not bite.**

- *Floor (F3 / label condition 2):* every epoch's tree is 501. Passes.
- *Root history / anchor (F8):* there is no fork. One chain, correctly signed,
  strictly increasing, identical for all clients. Passes.
- *Budget (F2b / label condition 6):* keyed `(persona, epoch)`
  (`lib/zk/budget.ts:16-18`). Every epoch is a fresh budget, and the attack needs
  exactly one proof per epoch. Passes, and enforces nothing.
- *Jitter (F5b):* intra-epoch. The signal is which *epoch* a row exists in.
- *Relay:* the join key is `personaId`, in the clear in the row I store. IP is
  irrelevant.

**Yield.** Sibling linkage (the headline claim) and candidate-set collapse to one
named, profiled account. Delivered with zero failing assertions and a green label.

**Severity: CRITICAL. Confidence: HIGH** (mechanism is arithmetic + code I read).
**Already admitted?** *Partially, and the admitted form is the weak one.*
`SECURITY-POSTURE.md` §2 C1 admits set curation as an **integrity** problem
("place any commitment in tier-10"). VERIFY-YOURSELF F5c admits the **static**
version ("build a singleton/tiny group and induce a target to prove against it,
reaching k=1"). Neither admits the **dynamic** version, which is materially
worse: it defeats the exact mitigation the posture lists as *applied* for F3
("floor of 50 per tree, computed from the tree"), needs no tiny group, and leaves
the audit trail clean.

---

### F-2 — The anonymity floor on the label is a boolean I compute and send

**Claim.** Label condition 2 is not checked by the client at all. It is copied
from my response body.

**Code evidence.**

```
lib/zk/privacy.ts:63-68
    const trees = await fetchTrees(mode);
    const t = trees.find((x) => x.tree === `tier-${ZK_GATE_TIER}`);
    if (t) { floorOk = t.clearsFloor; floorDetail = `${t.tree} cohort ${t.size} vs floor ${t.floor}`; }
```

`clearsFloor`, `size` **and** `floor` all come from `GET /zk/trees`
(`validator/zk.js:380-393`), where the floor is my env var
(`validator/zk.js:62`: `ZK_ANON_FLOOR || 50`). The client ships its own
`ZK_ANON_FLOOR` constant (`lib/zk/config.ts:34`) but only ever *displays* it
(`lib/zk/status.ts:64`); it is never compared against mine and never used to gate
the label.

**My moves.** One of: (a) start the validator with `ZK_ANON_FLOOR=1` — a cohort of
one now honestly "clears the floor"; or (b) return `{size: 500, floor: 50,
clearsFloor: true}` for a tree with one member. `fetchTrees` does no validation
(`lib/zk/validatorClient.ts:74-77`), and nothing cross-checks `size` against the
member list from `/zk/members`.

**Yield.** A lying label: the narrow claim renders while k=1. Combined with F-1
this is what makes the whole thing quiet — the surface asserts privacy at the
moment the cohort is a singleton.

**Severity: CRITICAL (label integrity). Confidence: HIGH.**
**Already admitted?** No. §4 condition 2 and §3 F3 both read as though the floor
is derived from the tree the client can see. It is derived from a boolean I send.

---

### F-3 — The split-view anchor and the proof budget are stored in my database, and "missing" is the benign state

**Claim.** I do not need to defeat the anchor comparison. I delete the anchor.

**Code evidence.**

- `zkRootAnchor`, `zkProofBudget`, `zkQueue` are vault namespaces
  (`lib/vault/vault.ts:59-67`), flushed to `PUT /state/<ns>` on my server
  (`lib/adapters/mock/persist.ts:208-251`).
- They are re-read at hydrate from `GET /state`, which is **unauthenticated,
  unsigned, and carries no counter or freshness proof**
  (`validator/server.js:312-319`). Envelope counters/signatures are checked on
  *writes* only (`validator/server.js:337-345`).
- With no anchor, the fork check is skipped by construction:
  `lib/zk/rootHistory.ts:78` — `let anchorSeen = anchor === null;` — and the TOFU
  key comparison at `:73-75` is also skipped, because it only runs `if (anchor)`.

**My moves.** Serve `zkRootAnchor: {}` in the `/state` document (or roll it back
to an older value). `readAnchor` returns `null`
(`lib/zk/rootHistory.ts:104-107`), `verifyHistoryChain` treats the client as a
first-run installation, and I re-TOFU it onto **any** signing key and **any**
branch I like — then re-anchor it there (`:135-142`). Same move on
`zkProofBudget: {}` zeroes the proof-history budget on demand.

Vault encryption does not help: it protects *confidentiality* of the anchor, and
the vault's own fail-closed rules explicitly throw only when a **non-empty**
namespace fails to decrypt (`lib/vault/vault.ts:23-31`). An empty namespace is
indistinguishable from a new install, by design.

**Yield.** Per-client history forking on demand → tree-tagging → the F8 attack in
full. Plus unlimited intersection events per epoch from the budget reset.

**Severity: HIGH-CRITICAL. Confidence: HIGH.**
**Already admitted?** **Worse than admitted.** The A-SPLIT-VIEW residual says
"the client detects a fork against its OWN anchor; it cannot see that other
clients are served the same history." The reality is that the client cannot keep
its own anchor either — the adversary is its disk. That is a different and larger
statement than the one in the posture, and the same sentence should have been
written about the budget.

---

### F-4 — One number in my `/zk/epoch` response collapses the jitter window to a fixed delay

**Claim.** The submission jitter — the mitigation for F5b, and label condition 3 —
is clamped by values I supply, with no sanity check, and I can pin it to a
constant offset or to "never".

**Code evidence.**

```
lib/zk/anon/queue.ts:44-48
    const ep = await fetchEpoch(envelope.mode);
    hi = Math.min(hi, Math.max(lo, ep.msRemaining + Math.floor(ep.epochMs / 2)));
  ...
  notBefore: now + uniformInt(lo, Math.max(lo, hi)),
```

`epochMs` and `msRemaining` are mine (`validator/zk.js:131-135`), and
`fetchEpoch` validates neither (`lib/zk/validatorClient.ts:70-72`).

**My moves.**

- **Collapse:** return `{epochMs: 0, msRemaining: 0}`. Then
  `hi = min(900000, max(30000, 0)) = 30000 = lo`, and `uniformInt(lo, lo)` is
  deterministic. Every submission lands at exactly `motivatedAt + 30 s`
  (+ one 5 s drain tick). The offset from the motivating action, which the module
  header promises is "a random variable with no fixed component", is now a
  constant. I already hold `castHash → personaId` in plaintext (C5, admitted), so
  a fixed offset is all I need to bind a proof to an action.
- **Suppress:** return `epochMs: null` (or any non-number). The arithmetic
  becomes `NaN`, `notBefore` becomes `NaN`, and `q.notBefore <= now` is false
  forever (`lib/zk/anon/queue.ts:109`). That persona's proofs silently never
  drain — a targeted, invisible push onto the fallback path (see F-5).

**Why the build stamp does not catch it.** The decorrelation check that stamps
condition 3 measures `enqueueSynthetic` (`scripts/accept-z1.mjs:161-166`), which
draws its offset directly from `uniformInt(window.lo, window.hi)`
(`lib/zk/anon/queue.ts:83`) and **never executes the clamp at all**. The single
real item in that check runs against an honest validator, where the clamp is
inert. The stamped evidence does not exercise the vulnerable line.

**Yield.** A defeated defence plus a lying label: condition 3 continues to read
"jitter on; decorrelation test passed this build".

**Severity: HIGH. Confidence: HIGH.**
**Already admitted?** No. A-TIMING admits the *window size* is a product
parameter; it does not admit that the server can set the window to zero width.

---

### F-5 — The label omits the two conditions that decide whether a proof does any work: `mode` and the gate fallback

**Claim.** `privacyConditions` can return `private: true` in the fixture universe,
where the "proof" is a SHA-256 tag under a public constant, and while every
persona is actually being gated by the legacy root-linked tier lookup.

**Code evidence.**

- The six conditions are relay, floor, jitter, scopes, ceremony, budget
  (`lib/zk/privacy.ts:41-128`). Neither `zkMode()` nor `gateFallback()` appears.
- Default universe is fixture (`lib/zk/config.ts:12`; `.env.local` sets no
  `ZK_MODE`), and the fixture proof is `sha256(... | "layers-zk-fixture-tag/v1")`
  — a public key, forgeable by anyone (`lib/zk/transport/fixture.ts:33`).
- `scripts/accept-z3.mjs:134-148` is the project's own "MONEY SHOT": it drives
  `?mode=fixture`, seeds `floor + 40` decoys whose secrets are the public string
  `Identity("layers-zk-decoy/<i>")` (`validator/zk.js:526`), and asserts the green
  band on `/home`. The demonstration of "private" is a padded set of identities
  whose secrets anyone can derive.
- Under `ZK_GATE_FALLBACK=policy`, a persona that did not prove is admitted on
  `legacyTier >= 2` (`lib/zk/gate.ts:66-69`) — the root-side tier lookup, i.e.
  exactly the linkage the layer exists to remove. `lib/zk/gate.ts:15-18` states
  "the README **and the label** say what `policy` costs". The README does. The
  label does not: `privacy.ts` never reads `gateFallback()`.
- `PrivacyLabel` renders whenever `zkGateActive && surface === "discovery"`
  (`app/(main)/home/page.tsx:132`), independent of both.

**My moves.** Make proofs fail — refuse `/zk/anon/submit`, use F-4's `NaN`
suppression, evict anchors with F-10, or simply drop the target's root below the
tier line. Under `policy` every persona keeps flowing through the legacy
root-linked decision while the surface says
"your persona's root is hidden from this server at the proof layer".

**Yield.** A lying label in the most literal sense: the mechanism the sentence
describes is not running.

**Severity: HIGH. Confidence: HIGH.**
**Already admitted?** A-FIXTURE-SOUNDNESS admits the fixture has no soundness, but
§4's six conditions omit `mode`, so the doc has the same gap as the code. The
fallback cost is documented in `gate.ts` and the anon README but is **not** a
label condition, contrary to `gate.ts`'s own comment.

---

### F-6 — Three label conditions are set by an unauthenticated POST; a fourth is a self-declared boolean

**Claim.** `POST /api/zk` accepts `recordCheck` from anyone, with no auth, no
`ZK_DEV_HOOKS` guard, and no evidence that any check ran.

**Code evidence.** `app/api/zk/route.ts:273-280`:

```
if (action === "recordCheck") {
  const { recordStamp } = await import("@/lib/zk/stamps");
  ...
  return NextResponse.json({ stamp: recordStamp(name, body.passed === true) });
}
```

`recordStamp` writes `{passed, at, buildId: currentBuildId()}`
(`lib/zk/stamps.ts:41-50`), and `stampHolds` accepts it because the buildId
matches by construction (`:53-59`). Note also `currentBuildId()` falls back to
the literal string `"dev"` when `.next/BUILD_ID` is unreadable
(`lib/zk/stamps.ts:24-30`), so in dev every stamp from every run is "this build".
`setRelay` (`route.ts:217-227`) likewise sets `thirdParty: true` from the request
body, which is the whole of condition 1's third-party attestation.

**My moves.** Three POSTs stamp `scopeCollision`, `decorrelation` and `ceremony`
as passed (conditions 3, 4, and half of 5). One POST sets an attested relay
(condition 1). F-2 gives me condition 2. Condition 6 passes on its own
self-test. Condition 5's live half (`checkVkeyPin`) is the only thing left that
checks anything real, and it checks the circuit vkey, not privacy.

**Yield.** The complete label, green, with nothing verified.

**Severity: HIGH (label integrity). Confidence: HIGH.**
**Already admitted?** No. §3 presents the stamps as "the claim cannot outrun the
infrastructure". The stamp is a self-assertion writable by an unauthenticated
request; it is a build-scoped *cache* of a claim, not evidence of one.

---

### F-7 — TOFU is per `(mode, tree)`, so every tree the client has not used yet is a fresh first sight

**Claim.** There is no single pinned validator key. The key is stored *inside*
each per-tree anchor, so I get one independent TOFU per tree per universe.

**Code evidence.** `anchorKey(mode, tree)` is `` `${mode}:${tree}` ``
(`lib/zk/rootHistory.ts:100-102`); the key comparison lives at `:73-75` and only
fires when an anchor for *that* key exists. `fetchValidatorKey()` is re-fetched
every call (`:124`) and is otherwise compared only to the key I put in the same
response (`:125-126`) — self-consistency, not a pin.

**My moves.** The client is anchored on `fixture:tier-2`. The moment anything
touches another tree — a `tier-3` gate, a `valid` root check (the `rootCheck`
action defaults to `"valid"`, `route.ts:110-118`), or a `ZK_MODE` flip — I hand
that client a different signing key and a private chain from epoch zero. Its
existing anchor says nothing about the new tree.

**Yield.** Per-client tagging on any unused tree, without touching the anchored one.

**Severity: MEDIUM-HIGH. Confidence: HIGH.**
**Already admitted?** No. §7 says "the client pins it on first sight (TOFU)",
singular. There are 11 trees × 2 modes = up to 22 first sights.

---

### F-8 — The "append-only" history is a mutable table I re-sign, and gaps in it are meaningless

**Claim.** Append-only is enforced only by whatever anchor the client currently
holds. I can rewrite any epoch at or after a client's anchor and re-sign forward;
the chain still verifies.

**Code evidence.** `zk_root_history` is an ordinary table
(`validator/migrations.js:105-115`); `historyEntryHash` chains
`prevHash → hash` (`validator/zk.js:78-81`) and I hold the signing key
(`:105-124`). `verifyHistoryChain` requires only: correct hashes, valid
signatures, linked `prevHash`, strictly increasing epochs, and the anchored hash
somewhere in the window (`lib/zk/rootHistory.ts:79-96`).

Two consequences:

- A client anchored at epoch E accepts any rewrite of E+1… as long as the new
  E+1 links to E's hash. Its anchor commits to the past, never to the future.
  Combined with F-3 (delete the anchor) I can rewrite the past too.
- History entries are written lazily, only when an epoch is first requested
  (`validator/zk.js:198-217`), so **epoch gaps are normal**. A client cannot
  distinguish "nobody asked during epochs 40-45" from "I suppressed 40-45".
  `LIMIT 64` (`validator/zk.js:60, 448-453`) then bounds how far back any of this
  is even visible.

**Yield.** Retroactive re-curation of any epoch, undetectable to any client not
anchored at or after the rewrite point.

**Severity: MEDIUM. Confidence: HIGH.**
**Already admitted?** Partially — it is the mechanism behind the A-SPLIT-VIEW
residual, but the docs consistently call the history "append-only" and
"auditable", which overstates what the client can actually enforce.

---

### F-9 — `/zk/eligibility` and `/zk/members` publish both sides of the F2b intersection to the entire internet

**Claim.** The candidate-set intersection that VERIFY-YOURSELF F2b describes as an
*operator* capability is available to any unauthenticated caller.

**Code evidence.** `GET /zk/eligibility` with no `personaId` returns the full map
`{personaId: provenTier}` for the current epoch and its grace
(`validator/zk.js:425-431`, `354-362`). `GET /zk/members` returns every leaf of
any tree (`validator/zk.js:433-440`). `GET /zk/registration?commitment=` confirms
whether a given commitment is registered and from which epoch (`:396-408`).
Neither endpoint is authenticated or rate-limited.

**Yield.** Anyone can snapshot, per epoch, (a) exactly which personas proved and
at what tier and (b) exactly which commitments were eligible to. That is F-1's
dataset without needing the database — an outside observer can run the same
longitudinal intersection, and can also archive it so that a future
deanonymisation of one commitment is retroactive (compounding A-ROOT-ANCHOR).

**Severity: MEDIUM. Confidence: HIGH.**
**Already admitted?** No. §2 F2b frames personaId exposure as "the operator can
read the persona on every proof". The derived join table is a public endpoint.

---

### F-10 — `ZK_DEV_HOOKS=true` in production: live-universe epoch burn, and a fixture reset that wipes live anchors

**Claim.** The dev hooks are correctly refused when the flag is off. If a
deployment ever leaves it on, two of them are not fixture-scoped in the way the
comments imply.

**Code evidence.**

- `/zk/dev/advance-epoch` accepts `mode` of `fixture` **or** `live`
  (`validator/zk.js:488-499`) — unlike `seed-decoys` and `reset`, which are
  explicitly fixture-only (`:511`, `:537`). It adds `n * EPOCH_MS` (n ≤ 1000) to a
  persisted offset, with no cap on cumulative calls and no way back.
- 64 calls push every client's anchor out of the `LIMIT 64` window
  (`validator/zk.js:60, 448-453`). `verifyHistoryChain` then refuses
  ("anchored history hash not present in the served window")
  (`lib/zk/rootHistory.ts:90-96`) — **permanently**, because nothing ever clears
  or re-bases a stale anchor. Fail-closed, but the closed state is "this client
  can never prove again", which is exactly the push onto the F-5 fallback.
- `resetZk` on the app route clears **all** client zk vault state unconditionally
  — `state().zkProofBudget.clear(); state().zkRootAnchor.clear();
  state().zkQueue.clear()` (`app/api/zk/route.ts:296-306`) — with no mode filter,
  gated only on the validator's *fixture-only* reset returning 200. A
  fixture-scoped dev call therefore destroys the **live** universe's split-view
  anchors.

**Yield.** Unauthenticated permanent DoS of the live ZK path (→ fallback), and a
mode-crossing wipe of the anchor that F-3 also targets.

**Severity: MEDIUM (HIGH if the flag is ever on in production).
Confidence: HIGH.** **Already admitted?** No.

---

### F-11 — "placement verified" is verified with the key I just handed over

**Claim.** The settings surface's placement verification is vacuous.

**Code evidence.** `lib/zk/status.ts:83-89`:

```
const [{ epoch }, trees, key] = await Promise.all([fetchEpoch(mode), fetchTrees(mode), fetchValidatorKey()]);
...
base.placement = { tree: "valid", found: placement !== null, verified: placement !== null && verifyPlacement(placement, key) };
```

Signature, message and public key all come from me in the same breath. `verified:
true` is true for any operator, honest or not, and there is no pin to compare
`key` against (see F-7).

**Yield.** A UI assurance with no content. No linkage, but it is exactly the
"validator's word rendered as a check" that VERIFY-YOURSELF F5 warns about.

**Severity: LOW-MEDIUM. Confidence: HIGH.** **Already admitted?** No.

---

### F-12 — `zk_eligibility` is a permanent, per-persona activity log whose time grain is my env var

**Claim.** The ZK layer creates a stored side channel it did not have before: an
epoch-granular record of which personas were active, retained forever.

**Code evidence.** Rows are `(mode, persona_id, gate_id, tier, epoch, nullifier)`
with no timestamp — but `epoch` *is* the timestamp, and `EPOCH_MS` is
`process.env.ZK_EPOCH_MS` (`validator/zk.js:59`). Nothing prunes the table
(`validator/migrations.js:175-186`). A proof is scheduled on every For You render
for the account's own active persona (`app/(main)/home/page.tsx:76-80`), so a row
exists iff that human opened the app with that persona in that epoch.

**My moves.** Set `ZK_EPOCH_MS=60000`. The "no timestamps finer than the epoch"
discipline (`validator/anon.js:23-26`) now means per-minute. Sibling personas are
driven by one human, so their presence/absence vectors correlate strongly;
cluster the columns.

**Yield.** Sibling clustering from stored data alone, no transport observation.

**Severity: LOW-MEDIUM alone; a force multiplier for F-1. Confidence: MEDIUM**
(the correlation strength depends on real usage patterns, which I cannot measure
here). **Already admitted?** F14 admits traffic analysis as out of scope. It does
not admit that the epoch — the layer's own privacy grain — is an operator knob,
or that the layer newly *stores* the presence log.

---

### F-13 — No revocation path, one global registration anchor, and a permanent 1:1 binding

Short, for completeness. `zk_registrations.revoked_from_epoch` is read by
`activeRegistrations` (`validator/zk.js:140-147`) but **written by nothing** —
there is no revoke endpoint and no rotation. I set it with a DB write and a root
silently vanishes from every tree, with no client-visible reason (its proofs just
start failing at the membership stage). Registration is authenticated against a
single global `device_auth` row (`validator/zk.js:241-244`), so `rootId` in the
body is not bound to a per-root key; with one-per-root first-write-wins and no
unregister (`:251-252`), a bad registration is permanent. This compounds
A-ROOT-ANCHOR rather than being new. **Severity: LOW. Already admitted:**
partially (A-ROOT-ANCHOR admits permanence, not the silent-exclusion lever).

---

## Attacks that failed

Honest list of what I tried and could not make work.

1. **Force a nullifier collision between siblings.** The registry builds the scope
   string in one place and *throws* if a per-persona entry is called without a
   personaId (`lib/zk/scopes.ts:110-112`); `SCOPE_FOR_CLAIM` is fixed in
   `prove.ts:36`, not caller- or server-supplied. The one colliding entry
   (`one-human-attest`) is registered but unreachable — no claim kind maps to it.
   The only scope component I control is `epoch`, which both siblings share, so it
   cannot separate or collide them. Clean.
2. **Serve a poisoned epoch to break the scope.** `scopeString` rejects
   non-integer and negative epochs (`lib/zk/scopes.ts:103`) and `prepareAndProve`
   refuses when `members.epoch !== epoch` (`lib/zk/prove.ts:74`). Fails closed.
   Rewinding the epoch to force a scope reuse just yields a 409 replay
   (`validator/zk.js:320-322`) — a DoS, not a linkage.
3. **Fork the history against a client that still holds its anchor.** The client
   re-derives every entry hash, verifies every signature, checks every link and
   strict epoch ordering, and requires its anchored hash in the window
   (`lib/zk/rootHistory.ts:79-96`). I could not construct a divergent chain it
   accepts. (This is why F-3 attacks the anchor's *storage* instead.)
4. **Serve a root outside the history, or a stale one.** Refused: the root must be
   in the verified chain at the newest epoch or the one before
   (`lib/zk/rootHistory.ts:131-132`), and the validator re-checks the same thing on
   submit (`validator/zk.js:317-319`).
5. **Learn the leaf index by issuing the Merkle path.** There is no "give me my
   path" call — the client downloads the public leaves and builds the path locally
   (`lib/zk/prove.ts:68-73`, `transport.prove(..., { members })`). The only
   commitment-addressed call is `/zk/placement`, and it returns a signature over
   data I already have.
6. **Read siblings out of the nullifier store.** `zk_nullifiers` and the
   `nullifier` column on `zk_eligibility` are Poseidon images under secrets I do
   not hold; different personas produce unrelated values. No inversion, no
   grouping. RLN is genuinely not used (F1b's trap is avoided — the rate limiter
   is stateless PoW bound to the body bytes, `validator/anon.js:63-68`).
7. **Correlate the anonymous channel with the app's authenticated channel by
   request shape.** The header allowlist is enforced server-side and fails closed
   (`validator/anon.js:42-47, 81`), outcomes are one body size held to one timing
   floor (`:71-77, 174`), and the client sends on a fresh non-pooled socket.
   Under `direct` I still see the peer IP — but that is A-TRAFFIC, admitted, and
   already fails label condition 1.
8. **Choose which tree a target proves against.** `gateTree()` is
   `tier-${ZK_GATE_TIER}` from the *client's* env (`lib/zk/gate.ts:24`,
   `lib/zk/config.ts:41`); the tree is never taken from my responses. So I steer
   the tree's *contents* instead — which is F-1, and is enough.

---

## Suggested fixes (brief)

- **F-1:** make the cohort a first-class privacy object. Require a minimum
  Jaccard overlap between consecutive epochs' tier trees before proving; refuse to
  prove into a cohort that churned more than X% since the last epoch this persona
  proved in; persist the last N cohort digests in the vault and surface a
  "cohort changed" refusal. Longer term this is the placement-circuit problem,
  but cohort-stability is checkable client-side today.
- **F-2:** compute the floor client-side from `/zk/members` against the client's
  own `ZK_ANON_FLOOR`, and cross-check `size === members.length` and
  `root === rootOf(members)`. Never read `clearsFloor` off the wire. (This does
  not fix padding — F-1 does — but it removes the one-boolean lie.)
- **F-3:** keep a rollback tripwire outside the operator's store: a monotonic
  anchor epoch (or a hash of the anchor) in local, non-vaulted storage, and treat
  "vault says no anchor, tripwire says there was one" as a fork, not a first run.
  Same for the budget.
- **F-4:** clamp with client-side constants only; validate `epochMs` and
  `msRemaining` as finite non-negative numbers within an expected band, and never
  let the effective window width fall below a floor. Make the decorrelation check
  exercise `enqueueSubmission` against a hostile `/zk/epoch` fixture, not
  `enqueueSynthetic`.
- **F-5:** add two label conditions — `mode === "live"` and
  `gateFallback === "none"` — or state in §4 why they are not conditions.
- **F-6:** gate `recordCheck` and `setRelay` behind the same dev-hook flag as the
  epoch/decoy/reset proxies, and make `currentBuildId()` fail closed rather than
  returning `"dev"`.
- **F-7:** pin the validator key once, globally, in its own vault slot; make the
  per-tree anchor reference it rather than carry it.
- **F-10:** fixture-only `advance-epoch` like its siblings; scope the client-side
  `resetZk` clears by mode; give a stale anchor a documented, explicit
  re-anchoring ritual instead of a permanent refusal.
- **F-11:** either pin the key (F-7) and keep the check, or relabel it as
  "the validator says this placement is signed".
