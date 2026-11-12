# attack-2 — adversarial review: soundness & crypto usage

Fresh-context adversarial pass over the ZK layer (Layers + validator).
Read-only. Lens: **can a proof fail soundness, or can the
verification/pinning chain be subverted?** Style, performance, and
already-admitted privacy residuals are out of scope except where the code
is *worse* than the admission.

Baselines read first: `SECURITY-POSTURE.md`, `research/VERIFY-YOURSELF.md`,
`research/zk-ceremony-verification.json`.

---

## Summary

The circuit-facing crypto is right. `lib/zk/nullifier.ts` matches
`semaphore.circom` exactly (`Poseidon(2)([scope, secret])`, scope
pre-hashed), `lib/zk/hash.ts::semaphoreHash` is byte-identical to
`@semaphore-protocol/proof`'s `hash()`, `fieldOf` is domain-separated and
248-bit so it cannot overflow the field or collide a scope with a message,
and `lib/zk/scopes.ts` fails closed in both directions. The signed
hash-chained root history, the frozen-epoch invariant, the depth pin, and
the client-side local Merkle-path derivation all hold up under attack.

The break is not in the circuit. It is in **what the verifier does with a
valid proof.**

`validator/zk.js::verifyAndRecord` verifies the Groth16 proof and then
records eligibility against `publicInputs.personaId` and
`publicInputs.gateId` — two strings it never binds to the proof. It also
never re-derives `scope` from `(feature, epoch, personaId)` or `message`
from `personaId ‖ gateId ‖ challenge ‖ treeRoot`. Both are accepted as
opaque field elements. So the proof establishes only *"somebody in this
tree's leaf set submitted this"*; the persona it grants, the gate it
grants for, and the nullifier it burns are all prover-chosen. The
project's own test at `validator/test/zk.test.js:246-260` is a working
exploit: it generates a real Semaphore proof from identity
`"zk-test-live-root"` with `scope = 1234567n, message = 7654321n` and
asserts that the validator records tier-1 eligibility for
`personaId: "p_live"`. That is Finding 1, and it is the headline.

Second: **the pinned verification key is a file that no verifier loads.**
`VKEY_PIN` and the validator's `vkeyPinned()` both hash
`@semaphore-protocol/proof/src/verification-keys.json`. The key actually
used by `groth16.verify` is inlined into `dist/index.node.cjs` /
`dist/index.node.js`. Nothing in either bundle reads the `src/` JSON. The
pin is green while the real key is unchecked.

Third: **the replay store is keyed on the nullifier's decimal *encoding*,
not its value.** `isField` allows 78 digits; the field has 77. snarkjs
`unstringifyBigInts` ignores leading zeros. `"0"+nullifier` verifies
identically and inserts as a new row.

Fourth: the Gate-3 privacy label's "machine-checked, never hardcoded"
evidence is **self-asserted over an unauthenticated route**
(`action:"recordCheck"` writes `passed: body.passed === true`), and the
relay attestation and the fixture/live universe switch are settable the
same way.

Findings 1, 2 and 4 are each independently sufficient to void the
eligibility guarantee. None of them is admitted in `SECURITY-POSTURE.md`.

| # | Finding | Sev | Conf | Admitted? |
|---|---------|-----|------|-----------|
| 1 | Validator never re-derives `scope`/`message`; persona+gate unbound | CRITICAL | HIGH | No |
| 2 | vkey pin targets a file the verifier never loads | HIGH | HIGH | No |
| 3 | Nullifier replay keyed on string encoding, not value | HIGH | HIGH | No |
| 4 | Gate-3 label evidence self-asserted over an unauthenticated route | HIGH | HIGH code / MED reach | No |
| 5 | Client self-verify and validator verify share one failure point | MEDIUM | HIGH | No |
| 6 | Universe switch remotely settable; fixture has no soundness | MED-HIGH | HIGH code / MED reach | Partial |
| 7 | Proof-history budget can never refuse; its self-test is vacuous | MEDIUM | HIGH | No |
| 8 | Anonymity floor gates the label, not the feature | MEDIUM | HIGH | Partial |
| 9 | One global device-auth anchor authorizes any root's registration | MED (demo) / HIGH (scaled) | HIGH | Partial |
| 10 | `/zk/submit` bypasses every Gate-1 protection | LOW-MED | HIGH | No |
| 11 | `checkVkeyPin()` resolves by cwd, not module resolution | LOW | HIGH | No |

---

## Findings

### 1. CRITICAL — The validator never re-derives `scope` or `message`. The persona and gate a proof grants are attacker-chosen and cryptographically unbound.

**Claim.** A Semaphore proof accepted by `verifyAndRecord` proves exactly
one thing: *some* holder of *some* leaf in the tree whose signed root
equals `publicInputs.merkleTreeRoot` produced this proof. It does **not**
prove anything about `publicInputs.personaId`, `publicInputs.gateId`,
`publicInputs.challenge`, or the semantics of the scope — yet those are
what the eligibility record is written from.

**Attacker inputs.** The entire `envelope` JSON, POSTed to
`/zk/anon/submit` (unauthenticated by design) or `/zk/submit`. Capability
required: **one** Semaphore identity legitimately registered in the target
tier tree — i.e. an ordinary user of the app at that tier. In `fixture`
mode: nothing at all (`FIXTURE_TAG_KEY` is a public exported constant,
duplicated at `validator/zk.js:83`).

**Code evidence.**

- `validator/zk.js:276-284` — shape validation only. `scope`, `message`
  are checked with `isField` (line 280); `personaId` / `gateId` are
  checked against character-class regexes (line 283). Nothing more.
- `validator/zk.js:299-306` — `verifyProof({ merkleTreeRoot, nullifier,
  message: p.message, scope: p.scope, points })`. The library's
  verification (`node_modules/@semaphore-protocol/proof/dist/index.node.cjs:1554`)
  is `groth16.verify(vk, [merkleTreeRoot, nullifier, hash(message),
  hash(scope)], …)` — it binds the *values* to the proof, and asserts
  nothing about what they should have been.
- `validator/zk.js:333-340` — eligibility is written on
  `(mode, p.personaId, p.gateId, tier, p.epoch)`.
- **The missing check.** Nowhere under `validator/` is
  `fieldOf("scope", scopeString("discovery-tier", p.epoch, p.personaId))`
  or `fieldOf("message", [p.personaId, p.gateId, p.challenge,
  p.merkleTreeRoot].join("|"))` computed and compared. A repo-wide grep
  for `fieldOf(` returns only `lib/zk/hash.ts:77` (the definition),
  `lib/zk/prove.ts:94,103` (the prover), `app/api/zk/route.ts:90` (a
  probe), and three test scripts. **The verifying side has no copy of the
  derivation at all.**
- Consumer: `lib/zk/gate.ts:66` — `if ((epochTiers[author] ?? 0) >=
  ZK_GATE_TIER) return true;` where `epochTiers` is the validator's
  eligibility map.

**The project's own tests are the exploit.**

- `validator/test/zk.test.js:206` — fixture envelope with
  `scope: "5", message: "6"`, `personaId: "p_elig"`; asserts HTTP 200 and
  `eligibility.tier === 1`.
- `validator/test/zk.test.js:246-260` — a **real live Groth16 proof**:
  `const scope = 1234567n, message = 7654321n; const proof = await
  generateProof(liveId, group, message, scope, 20, {wasm, zkey});` from
  identity `"zk-test-live-root"`, submitted with
  `personaId: "p_live"`, and the test asserts
  `eligibility.tier === 1` for `p_live`. There is no relationship
  whatsoever between `liveId` and `p_live`. The suite enshrines the hole
  as correct behaviour.

**Consequences.**

1. **Cross-persona forgery.** Prove membership once at tier T; name any
   `personaId` in the envelope, including a persona belonging to another
   root. That persona is marked eligible at tier T for the epoch and the
   grace epoch. `lib/zk/prove.ts:56` checks `isOwnPersona(req.personaId)`
   — that is a *client-side courtesy*, enforced by the party being
   constrained.
2. **Unlimited grants per epoch.** `scope` is a free field element, so
   every submission can carry a fresh scope → a fresh nullifier → the
   replay check at `validator/zk.js:321-322` never fires. One tier-T
   identity can mark *every* persona in the system eligible at tier T.
   The "one proof per persona per epoch" property is not enforced by
   anything.
3. **The scope registry is unenforced.** `lib/zk/scopes.ts` is the F2
   killer-item control. It is applied only inside the client's own
   `prepareAndProve`. A client that emits a `onePerHuman` scope (siblings
   collide → the attribution table this layer exists to destroy), or any
   ad-hoc scope, is accepted without comment. The written linkage
   argument holds mathematically and is enforced nowhere on the wire.
4. **Gate-1's anonymous channel amplifies it.** The channel is
   unauthenticated by design (correctly — that is F1's whole point). With
   no binding between the proof and the claimed persona, "unauthenticated"
   means "anyone with one tier-T leaf writes arbitrary eligibility rows".
5. **Eavesdrop-and-redirect (bonus).** Under `direct` (or from the OHTTP
   gateway, which is the operator), an observer can take a victim's
   in-flight envelope, swap only `personaId`/`gateId` — fields outside the
   proof entirely — and submit first. The victim's own submission is then
   refused as a replay (409) and the grant lands on the attacker's
   persona.

**Direct contradiction of the posture doc.** `SECURITY-POSTURE.md` §1:
"The proof binds `personaId ‖ gateId ‖ challenge ‖ treeRoot` in its
message". §3 F13: "applied: message binds personaId ‖ gateId ‖ challenge ‖
treeRoot". Both are true of the *prover* and false of the *verifier*: the
message is bound to the proof, but no verifier checks that the message
*is* that binding, so the binding conveys nothing.

**Severity:** CRITICAL. **Confidence:** HIGH (verified by reading the only
verification path plus a repo-wide grep, and confirmed by the project's
own passing tests). **Already admitted:** **No.** §2 enumerates what the
operator can do; nothing in §2, §3 or §4 says any tier-T member can mint
eligibility for arbitrary personas.

---

### 2. HIGH — The pinned verification key is a file no verifier loads. A tampered dependency swaps the real key with the pin still green.

**Claim.** `checkVkeyPin()` and the validator's `vkeyPinned()` both hash
`node_modules/@semaphore-protocol/proof/src/verification-keys.json`. The
verification key actually used by `verifyProof` is **inlined into the
distributed bundle**. The `src/` JSON is not read by any runtime path.

**Attacker inputs.** Write access to `node_modules` — a malicious
`postinstall`, a compromised registry mirror/proxy, a `patch-package`
step, a poisoned lockfile resolution, or a compromised build host. The
classic supply-chain position, which is exactly the position the pin
exists to defend against.

**Code evidence.**

- `lib/zk/ceremony.ts:59-63` — `VKEY_PIN.file =
  "@semaphore-protocol/proof/src/verification-keys.json"`, sha256
  `d96ec605…`, 57550 bytes.
- `lib/zk/ceremony.ts:86-88` — `bundledVkeyPath()` →
  `process.cwd()/node_modules/@semaphore-protocol/proof/src/verification-keys.json`.
- `lib/zk/ceremony.ts:104-114` — `checkVkeyPin()` hashes **that file**.
- `validator/zk.js:45-56` — `VKEY_PATH = dirname(require.resolve(
  "@semaphore-protocol/proof")) + "/../src/verification-keys.json"`;
  hashed against `CEREMONY_RECORD.artifactsShipped.verificationKeyBundle.sha256`.
- **What is actually used:**
  `node_modules/@semaphore-protocol/proof/dist/index.node.cjs:1518` —
  `var verificationKeys = { protocol, curve, nPublic, vk_alpha_1, … }`,
  assembled from `var vk_alpha_1 = [...]` etc. inlined from line ~132.
  Line 1554 uses it. Same in `dist/index.node.js:1517`.
  The CJS bundle's only `require()` calls are lines 11-18
  (`@zk-kit/*`, `snarkjs`, `ethers/*`). **No dist bundle references
  `verification-keys.json`.**
- Both consumers use dist: the validator is CJS
  (`require("@semaphore-protocol/proof")` → exports `node.require` →
  `dist/index.node.cjs`); the prover worker
  `lib/zk/prover/semaphore-worker.mjs:13` is ESM →
  `dist/index.node.js`.

**Consequence.** Edit the inlined `vk_alpha_1` / `vk_delta_2` / `IC` in
`dist/index.node.*` to a verification key whose proving key the attacker
holds, and:

- every forged proof verifies at the validator (`validator/zk.js:299`),
- every forged proof verifies at the client's own self-verify
  (`lib/zk/transport/live.ts:116`, see Finding 5),
- `checkVkeyPin()` returns `{ok: true}` and `vkeyPinned()` returns `true`,
- `app/api/zk` `action:"probe"` reports the pin as holding,
- and Gate-3 condition 5 (`lib/zk/privacy.ts:89-96`) prints "ceremony
  hashes verified this build; vkey pin holds".

That is **universal forgery of eligibility with the integrity check
reporting green** — the precise failure mode F4 exists to prevent.

**Severity:** HIGH. **Confidence:** HIGH on the code fact (grep + file
listing + the dist source). **Already admitted:** **No.** §3 F4 admits
`snarkjs zkey verify` was not completed and A-HOST-INTEGRITY admits the
CDN publishes no checksums — neither says the pin targets the wrong file.
`research/zk-ceremony-verification.json:24` states the bundle is "Pinned
in the client build (lib/zk/ceremony.ts) and asserted at verifier load",
which is the untrue sentence. `lib/zk/ceremony.ts:8-9` — "the verifier
refuses to load if the bundled verification key differs from the pin" —
is likewise untrue of the key that is loaded.

*(Note the chain in `zk-ceremony-verification.json:67` —
`zkeyDerivedVkeyEqualsBundledVkey_depth20` — also terminates at the `src/`
JSON. The whole ceremony verification chain is anchored to a file the
verifier never opens. The zkey/wasm pins in `lib/zk/artifacts.ts` are
fine: those files really are read, re-hashed on every load, and refused
on mismatch. Only the vkey link is misaimed.)*

---

### 3. HIGH — Nullifier replay is enforced on the decimal *string*, not the value. `"0" + nullifier` is a fresh nullifier.

**Claim.** The nullifier is compared numerically by snarkjs and
lexically by SQLite. Leading-zero padding separates the two.

**Attacker inputs.** One byte prepended to `envelope.nullifier`.

**Code evidence.**

- `validator/zk.js:102` —
  `isField = (s) => /^[0-9]{1,78}$/.test(s) && BigInt(s) < FIELD`.
  The BN254 scalar field has **77** decimal digits; the regex allows
  **78**. So at least one pad digit is always available, and ~46% of
  nullifiers (those < 10^76) accept two or more.
- `validator/zk.js:299-306` → `verifyProof` →
  `dist/index.node.cjs:1554` → `snarkjs.groth16.verify(...)` →
  `node_modules/snarkjs/build/main.cjs:1346` —
  `const publicSignals = unstringifyBigInts(_publicSignals);` →
  `node_modules/ffjavascript/build/main.cjs:2792-2794` —
  `if (typeof o == "string" && /^[0-9]+$/.test(o)) return BigInt(o);`.
  `BigInt("0…N") === BigInt("…N")`. **The padded nullifier verifies.**
- `validator/zk.js:321-322` —
  `SELECT 1 FROM zk_nullifiers WHERE mode = ? AND nullifier = ?`.
  `zk_nullifiers.nullifier` is `TEXT` (`validator/migrations.js:126-132`,
  `PRIMARY KEY (mode, nullifier)`, WITHOUT ROWID since migration 005), so
  the comparison carries TEXT affinity: `"0…N" ≠ "…N"`. **No replay hit,
  and the INSERT succeeds as a new row.**
- The client has the same hole: `lib/zk/hash.ts:88` `parseField` uses the
  identical `^[0-9]{1,78}$`, so `lib/zk/transport/live.ts:131` accepts it
  too.

Verified arithmetically: a 76-digit nullifier padded to 77 digits passes
`isField`, is the same BigInt, and is a different string.

**Consequence.** The "one nullifier, ever (per universe)" invariant — the
only thing standing between a legitimate proof and unbounded reuse — is
enforced on an encoding, not a value. One proof yields two or more
accepted submissions. Under Finding 1 each padded copy can name a
different `personaId`, so this is an *independent* path to multiple
grants: it survives even if Finding 1's scope re-derivation is added,
because the required scope is unchanged across padded resubmissions of
the same proof.

This is the same bug class as the F13 note "nullifier store keyed on the
nullifier, never on proof bytes" — the store is keyed on the nullifier's
*representation*.

**Severity:** HIGH. **Confidence:** HIGH. **Already admitted:** No.

---

### 4. HIGH — The Gate-3 privacy label's evidence is self-asserted over an unauthenticated route. Five of six conditions are attacker-settable.

**Claim.** `lib/zk/privacy.ts` is written as "each one machine-checked at
read time" and `SECURITY-POSTURE.md` §4 says "Gate 3 computes them; none
are hardcoded". Three of the six conditions are satisfied by a *stamp*
that the route writes on the caller's say-so, and a fourth by a runtime
override the same route sets.

**Attacker inputs.** Unauthenticated POSTs to `/api/zk`. There is no
`middleware.ts` in the repo, no auth check in
`app/api/zk/route.ts`, and no `NODE_ENV` / dev-hook guard on any of these
actions (contrast `validator/zk.js:479-485`, where the validator's dev
hooks *are* gated on `ZK_DEV_HOOKS`).

**Code evidence.**

- `app/api/zk/route.ts:273-280` — `action:"recordCheck"` →
  `recordStamp(name, body.passed === true)`. The route does not run the
  check, does not witness it, and does not verify anything about it. It
  records the caller's claim.
  `lib/zk/stamps.ts:41-50` writes `{passed, at, buildId}` to
  `shots/zk-build-checks.json` (also a plain file, writable by anything on
  the host). This satisfies conditions **3 (decorrelation)**,
  **4 (scope collision)** and **5 (ceremony)** —
  `lib/zk/privacy.ts:75-96`.
- `app/api/zk/route.ts:217-226` — `action:"setRelay"` →
  `setRelayOverride({kind:"ohttp", url:<attacker>, thirdParty:true})`.
  `lib/zk/anon/relay.ts:108-114` returns that as
  `thirdPartyAttested`, and `lib/zk/privacy.ts:46` reads
  `relay.kind !== "direct" && relay.thirdPartyAttested` → condition **1**
  passes. Worse, `lib/zk/anon/relay.ts:59` then fetches the OHTTP key
  config **from the attacker-supplied relay URL** — the
  `A-KEYCONFIG-VIA-RELAY` residual, now remotely triggerable rather than
  an operator deployment choice, and combined with a relay the attacker
  runs, every subsequent submission is readable by them.
- Condition **6** always passes — see Finding 7.
- Only condition **2** (cohort floor) is not attacker-settable, and it is
  read from the validator.

**Consequence.** `PRIVATE_LABEL` — "your persona's root is hidden from
this server at the proof layer", the one claim the posture doc goes to
lengths to make conditional — can be turned on by a handful of
unauthenticated POSTs, at the same time as the traffic is redirected
through the attacker's relay. This is the report's "valid trusted from the
wrong party" case in its purest form: the check's *result* is accepted
from whoever asks, rather than produced by the check.

**Severity:** HIGH (claim integrity + submission redirect).
**Confidence:** HIGH on the code path; MEDIUM on remote reachability —
this is a local single-user Next process, so the realistic vectors are a
local process or a CSRF (`req.json()` ignores `Content-Type`, so a
`text/plain` form POST from a visited page is not preflighted).
**Already admitted:** No. A-KEYCONFIG-VIA-RELAY admits the OHTTP key-config
trust issue, not that the relay URL and its attestation are settable at
runtime by an unauthenticated request.

---

### 5. MEDIUM — Client self-verification and validator verification share a single failure point.

**Claim.** "The client verifies its own proof before it is ever
submitted; the validator's 'valid' is never trusted"
(`lib/zk/transport/live.ts:18-19`) is true against a *lying validator* and
false as a redundancy argument.

**Code evidence.** `lib/zk/transport/live.ts:116` calls
`liveTransport.verify`, which runs `verifyProof` in
`lib/zk/prover/semaphore-worker.mjs:42` — the same
`@semaphore-protocol/proof@4.14.3`, the same inlined verification key, the
same `snarkjs@0.7.5`. `validator/zk.js:299` calls the same function from
the same installed package.

**Consequence.** One tampered `dist/index.node.*` (Finding 2), one
tampered `snarkjs`, or one under-constraint in the shipped circuit
(A-AUDIT-SCOPE) defeats *both* verifications simultaneously. The two
verifications are not independent evidence, and no wording in the posture
doc says so.

**Severity:** MEDIUM as an amplifier of Finding 2. **Confidence:** HIGH.
**Already admitted:** F7/A-AUDIT-SCOPE admits a circuit under-constraint
would pass everything here; it does not address the shared-verifier
point.

---

### 6. MEDIUM-HIGH — The fixture/live universe switch is remotely settable, and the fixture universe has no soundness by design.

**Claim.** A-FIXTURE-SOUNDNESS admits fixture has no soundness but asserts
containment: "It is a separate universe (mode:"fixture") that no live
verifier accepts" (`lib/zk/transport/fixture.ts:13`). That is true at the
*transport*. It is false at the *consumer*.

**Code evidence.**

- `lib/zk/gate.ts:55` — `epochTiers = await fetchEligibilityMap(zkMode(),
  GATE_ID)`. `zkMode()` is read **at every feed build**.
- `lib/zk/config.ts:17-23` — `zkMode()` returns
  `globalThis.__layersZkModeOverride ?? ZK_MODE`.
- `app/api/zk/route.ts:229-233` — `action:"setZkMode"` sets that global.
  Unauthenticated (Finding 4).
- Forging fixture eligibility needs no membership: `FIXTURE_TAG_KEY` is an
  exported public constant (`lib/zk/transport/fixture.ts:33`) duplicated at
  `validator/zk.js:83`, and the only other input — the signed root for
  `(tree, epoch)` — is served publicly by `GET /zk/trees`.
- Two adjacent one-POST gate manipulations: `setRepImpl` (route
  234-238) → `lib/zk/gate.ts:52` `if (currentRepImpl() !== "zk") return
  null` disables the gate entirely; `setGateFallback("policy")` (route
  239-243) → `gate.ts:67` re-admits every persona with legacy tier ≥ 2.

**Consequence.** One POST flips the gate to read the fixture universe;
fixture eligibility is mintable by anyone; the discovery gate then honours
it. The containment argument holds only as long as nothing can move the
universe pointer, and something can.

**Severity:** MEDIUM-HIGH. **Confidence:** HIGH on the code; MEDIUM on
reachability (same caveat as Finding 4). **Already admitted:** Partially —
the fixture's unsoundness is admitted; the reachability of the switch that
points the consumer at it is not.

---

### 7. MEDIUM — The proof-history budget can never refuse on the production path, and its Gate-3 self-test is vacuous.

**Claim.** §2 F2b presents the budget as an active bound ("2 distinct
predicates per persona per epoch, hard refusal") on candidate-set
intersection. It cannot fire.

**Code evidence.**

- `lib/zk/transport/types.ts:21-22` — `ClaimKind` has exactly one member,
  `"tier-membership"`.
- `lib/zk/prove.ts:89` — `reserveBudget(personaId, epoch, req.claimKind)`;
  `req.claimKind` is a `ClaimKind`.
- `lib/zk/budget.ts:47` — `if (used.includes(claimKind)) return {ok:true,…}`
  — idempotent per kind. So `used.length` can never exceed 1 via the
  product path, and `ZK_PROOF_BUDGET` defaults to 2
  (`lib/zk/config.ts:38`). **The refusal branch is unreachable in
  production.**
- The axis that actually partitions the candidate set is the **tree**
  (`tier-2` vs `tier-7`), which the budget does not count at all.
- `lib/zk/privacy.ts:102-113` — condition 6 self-tests with a synthetic
  persona `"__zk_privacy_selftest__"` at `epoch = -1` and invented kinds
  `selftest-1..3`. It exercises a counter the real path never reaches,
  then stamps the condition as satisfied. Condition 6 is therefore
  always true.
- The same vacuity in the acceptance suite: `scripts/accept-z2.mjs:154-160`
  produces its "budget exhausted" refusal by first calling `budgetProbe`
  twice with invented kinds `"other-predicate-a"` / `"other-predicate-b"`.
  No production caller can create that state.

**Consequence.** A stated mitigation that mitigates nothing, a Gate-3
condition that is structurally always-green, and a green acceptance check
that tests a path production cannot reach. (What *does* bound intersection
today is the nullifier's one-per-scope-per-epoch property — which
Findings 1 and 3 each dissolve.)

**Severity:** MEDIUM (mitigation theatre + test vacuity, not direct
forgery). **Confidence:** HIGH. **Already admitted:** No.

---

### 8. MEDIUM — The anonymity floor gates the *label*, not the *feature*.

**Claim.** VERIFY-YOURSELF F3 asks for "a minimum-set floor below which a
proof feature stays dark (a tier gate refuses to arm until ≥K eligible
members)". The code never refuses to prove.

**Code evidence.** `clearsFloor` is consumed in exactly two places:
`lib/zk/privacy.ts:66` (the label) and `lib/zk/status.ts` (display).
`lib/zk/prove.ts` — the whole refusal ladder, stages
`persona → epoch → members → root → membership → budget → scope → prove →
verify` — never consults it, and `lib/zk/gate.ts::requestEligibility`
calls `prepareAndProve` directly.

**Consequence.** The client will happily prove into a 1-member tree. In a
tree of one leaf the Merkle root *is* that leaf's commitment, so the
"membership proof" names the prover outright; the validator already knows
`commitment ↔ account` (C10). The floor is reported and then ignored by
the only code that could act on it.

**Severity:** MEDIUM (privacy, not soundness). **Confidence:** HIGH.
**Already admitted:** Partially — §4 correctly describes the floor as a
*label* condition, which is what the code does; §3 F3 ("applied: floor of
50 per tree") and VERIFY-YOURSELF F3's "stays dark" wording both read as
a feature gate, which it is not.

---

### 9. MEDIUM (demo) / HIGH (scaled) — One global device-auth anchor authorizes registering a commitment against *any* root.

**Claim.** The tier claim's entire soundness rests on
`zk_registrations.root_id` naming the commitment holder's own account.
That binding is authenticated by a single, global key.

**Code evidence.**

- `validator/zk.js:241-244` —
  `SELECT pubkey FROM device_auth WHERE id = 1`, then
  `verifyEd25519(signature, registerCanonical(mode, commitment, rootId,
  issuedAt), anchor.pubkey)`.
- `validator/migrations.js:48-52` — `device_auth (id INTEGER PRIMARY KEY
  CHECK (id = 1), …)`. One row, forever. The migration comment says
  "single-root demo topology".
- `validator/zk.js:186` — `tierOf.set(r.commitment,
  tierForRoot(db, r.root_id))`: the commitment inherits the *named root's*
  rep tier.
- `validator/zk.js:251-252` — one commitment per root, first-write-wins.

**Consequence.** In any deployment with more than one account, whoever
holds that one key registers their own commitment against any
not-yet-registered `rootId` in the `roots` table and inherits that
account's tier. The ZK layer's only link between "this secret" and "this
reputation" is a single-key assertion, and there is no per-root
authentication anywhere in the registration path.

**Severity:** MEDIUM today (single-user demo topology), HIGH on the stated
growth path. **Confidence:** HIGH. **Already admitted:** Partially — the
migration comment admits the topology; `SECURITY-POSTURE.md` §2 C10
presents registration as "authenticated by the device-auth key" without
noting that the anchor is global rather than per-root, and §7 discusses
only the validator's *signing* key.

---

### 10. LOW-MEDIUM — Two doors, one guarded: `/zk/submit` bypasses every Gate-1 protection.

**Code evidence.** `validator/server.js:38-40` mounts `mountAnon` before
`express.json()`; `validator/server.js:385-386` mounts `mountZk` after.
`validator/zk.js:418-421` exposes `POST /zk/submit`, unauthenticated,
calling the same `verifyAndRecord` — with **no** PoW, **no** header
allowlist, **no** 256-byte constant-shape body, **no** timing floor, and
**distinguishable** status codes plus verbatim error strings.

**Consequence.** F1b's stateless PoW rate limiter is optional from the
attacker's side: exploit Findings 1/3 through the plain door and get a
precise error oracle for free ("epoch is neither current nor within the
one-epoch grace", "merkle root is not the signed history root…",
"nullifier already seen (replay)"). Independently, 16-bit PoW
(`lib/zk/config.ts:54`) is ~65k hashes — thousands of submissions per
second per core — so it is not a meaningful rate limit even on the guarded
door; it is bound to the body only, with no epoch or expiry, so solutions
are precomputable in bulk offline.

**Severity:** LOW-MEDIUM. **Confidence:** HIGH. **Already admitted:** No.

---

### 11. LOW — `checkVkeyPin()` resolves the package by cwd, not by module resolution.

`lib/zk/ceremony.ts:87` builds
`process.cwd()/node_modules/@semaphore-protocol/proof/src/verification-keys.json`
by string concatenation. Under pnpm, a workspace, or any nested/hoisted
copy, that is not necessarily the package instance the worker loads. It
fails closed when the file is absent (`ceremony.ts:108-109`), so this is a
robustness note stacked on Finding 2 — the validator at least uses
`require.resolve` (`validator/zk.js:45`), it just points at the wrong
file inside the right package.

---

## Attacks that failed

Tried, and the design defeats them. Listed so the next reviewer does not
re-spend the time.

1. **Tree/root confusion — claim `tier-10` with a `valid`-tree proof.**
   Blocked at `validator/zk.js:317-319`: the root must equal the signed
   history root for exactly `(mode, p.tree, p.epoch)`. Two trees *can*
   share a root (`rootOf` over an identical, identically-ordered member
   list — `zk.js:187-192`), but only when their membership sets are
   equal, in which case the higher-tier claim is true. No escalation.

2. **Depth downgrade to the depth-1 verification key.**
   `verifyProof` selects `vk_delta_2[depth-1]` / `IC[depth-1]`, so a
   forged low-depth proof would be attractive. Blocked twice:
   `validator/zk.js:294` and `lib/zk/transport/live.ts:128` both require
   `merkleTreeDepth === MERKLE_TREE_DEPTH` (20), and only depth 20 is
   pinned (`lib/zk/ceremony.ts:39`, with `pinsForDepth` throwing for any
   other depth).

3. **Prove against an empty tree (root `"0"`).** `rootOf` returns `"0"`
   for an empty group and `isField("0")` is true, but the circuit's
   `merkleRoot` output is `identityCommitment` at `merkleProofLength = 0`
   and a Poseidon chain otherwise; hitting 0 needs a Poseidon preimage of
   0.

4. **Server-supplied Merkle path / root.** The client never asks for "my
   path" — `lib/zk/prove.ts:120` hands the full member list to the
   transport, the worker rebuilds the `Group` locally
   (`semaphore-worker.mjs:19-20`), and `lib/zk/transport/live.ts:108`
   refuses if the proof's own computed root differs from the intended
   one. A validator serving a doctored member list produces a root that
   fails both that check and the signed-history check.

5. **Cross-epoch replay of a stale proof.** Blocked by
   `validator/zk.js:315-319` (current epoch or the one-epoch grace) plus
   the per-epoch root match; exercised at `scripts/accept-z2.mjs:139-149`.
   (Finding 3 grants extra *acceptances*, not extra epochs.)

6. **Nullifier formula drift / argument swap.** `lib/zk/nullifier.ts:24`
   is `poseidon2([semaphoreHash(scopeValue), secretScalar])`, matching
   `semaphore.circom`'s `nullifier <== Poseidon(2)([scope, secret])` with
   the circuit's `scope` input being the pre-hashed value — argument order
   and pre-hashing both correct. `lib/zk/transport/live.ts:111-112`
   cross-checks the circuit's emitted nullifier against the duplicate and
   refuses on mismatch before the proof leaves.

7. **Hash-encoding drift from the library.** `lib/zk/hash.ts:68-70`
   `semaphoreHash` = `BigInt(keccak256(toBeHex(x,32))) >> 8n`, identical
   to `dist/index.node.cjs:25-27`. `toBeBytes32` range-checks its input.
   `fieldOf` (line 78) is domain-separated by `"scope"|"message"|
   "challenge"` and truncated to 248 bits, so (a) a scope and a message
   with identical text cannot collide, and (b) no output can reach the
   field modulus. The `toBigInt` bytes32 trap the header comment warns
   about is genuinely avoided: bigints are handed to the prover, never
   strings.

8. **Sibling scope collision.** `lib/zk/scopes.ts:101-114` fails closed in
   both directions — a per-persona entry without a `personaId` throws, a
   `onePerHuman` entry *with* one throws — and `onePerHuman` is declared
   per registry entry with a written linkage argument. The module itself
   is sound. It is simply not consulted by any verifier (Finding 1c).

9. **Extracting the zk secret through the transports.**
   `zkSecretScalarForProver()` / `zkMasterHexForProver()`
   (`lib/zk/identity.ts:60,69`) are imported only by
   `lib/zk/transport/live.ts` and `fixture.ts`; the master crosses only a
   `worker_threads` boundary in-process. The HKDF branch
   (`lib/crypto/kdf.ts:72`, info `"layers/v1/zk-identity/1"`) is properly
   separated from persona/vault/device-auth, seed length is enforced at
   exactly 32 bytes (`kdf.ts:29-33`), and the identity cache is keyed on
   `rootHandle()` (`lib/zk/identity.ts:27-33`) so a recovery/device-loss
   swap cannot silently keep proving as the old root. No serialization of
   secret material found in any route.

10. **Forging the signed root history.** `lib/zk/rootHistory.ts:79-96`
    checks every entry's hash, its Ed25519 signature, the chain links,
    strictly-increasing epochs, mode/tree agreement, and the presence of
    the vault-anchored hash — failing closed on each. The validator
    refuses to serve a reconstructed tree whose root differs from the
    signed one (`validator/zk.js:176-178`, the frozen-epoch invariant).
    The residual is the admitted A-SPLIT-VIEW one (a client sees only its
    own anchor), not a check that is missing.

11. **Separator injection into the message canonical via `gateId`.**
    `p.gateId` is `^[A-Za-z0-9_-]{1,40}$` and `p.personaId`
    `^[A-Za-z0-9_]{1,80}$` at the validator, so `|` cannot enter the
    canonical there. But note for the fix: `lib/zk/prove.ts:103` joins an
    **unvalidated** `gateId` with `|` (`app/api/zk/route.ts:131` passes
    `String(body.gateId ?? "foryou")` straight through). If Finding 1's
    re-derivation is added, validate or length-prefix the components at
    the same time.

---

## Suggested fixes (brief)

1. **Finding 1 — bind the proof to the claim, at the verifier.** Port
   `scopeString`, `fieldOf` and the message canonical into `validator/`
   (as deliberate duplicates, the pattern already used for
   `fixtureTag` / `historyEntryHash`), and in `verifyAndRecord` require:
   `p.scope === fieldOf("scope", scopeString(SCOPE_FOR_CLAIM[kind],
   p.epoch, p.personaId))`, `p.challenge === "epoch-" + p.epoch`, and
   `p.message === fieldOf("message", [p.personaId, p.gateId, p.challenge,
   p.merkleTreeRoot].join("|"))` — all before recording anything. That
   single change collapses the cross-persona forgery, the unlimited-scope
   hole, and the unenforced scope registry at once. Then delete or fix
   `validator/test/zk.test.js:206` and `:246-260`, which currently assert
   the hole is correct behaviour, and add the missing adversarial cases:
   *prove as A, claim persona B* and *two scopes, one identity, one
   epoch*. Note this still does not bind the persona to the prover's
   **root** (that needs the persona↔commitment relation in-circuit); it
   binds the persona to the *scope and nullifier*, so a second persona
   costs a second proof and a second, distinct nullifier — which is the
   design's intent.
2. **Finding 2 — pin what is loaded.** Hash `dist/index.node.cjs` and
   `dist/index.node.js` (and `index.browser.js` if a browser prover
   ships), or better: extract the vkey from the loaded module at runtime
   (`verifyProof`'s own key object) and compare the canonicalized JSON
   against the pin. Keep the `src/` pin as a secondary. Update
   `research/zk-ceremony-verification.json:20-25` and
   `SECURITY-POSTURE.md` §3 F4 to say which artifact the assertion
   actually covers.
3. **Finding 3 — canonicalize before storing and comparing.** Store and
   compare `BigInt(nullifier).toString(10)`, and tighten `isField` /
   `parseField` to `^(0|[1-9][0-9]{0,76})$`. Same for `merkleTreeRoot`,
   `scope`, `message` for consistency.
4. **Finding 4 — stop accepting check results from callers.** Either have
   the check run in-process and stamp itself, or sign the stamp with a
   build-time key the route cannot mint. Gate `setRelay` / `setZkMode` /
   `setRepImpl` / `setGateFallback` / `recordCheck` /
   `advanceEpoch|seedDecoys|resetZk` behind an explicit dev flag, the way
   `validator/zk.js:479-485` already gates the validator's dev hooks.
5. **Finding 7 — count the discriminating axis.** Budget on
   `(claimKind, tree)` — or on the predicate as the operator sees it —
   and make the Gate-3 self-test exercise the production reservation path
   rather than invented kinds at epoch −1.
6. **Finding 8 — make the floor a refusal.** Add a `floor` stage to
   `prepareAndProve` between `members` and `root`, refusing when the
   served tree does not clear `ZK_ANON_FLOOR`, so the feature stays dark
   rather than the label going yellow.
