# REPORT-CUSTODY — the browser keystore pass: every visitor is their own device

Started 2026-09-16 from `e177b65` (the readiness audit that stopped the
public preview pass). The pass exists to close findings 1 and 2 of
`notes/runbooks/PREVIEW-READINESS.md` (single-tenant by construction; shared state) and
then close 3–5 and run the preview gates.

## Standing judgment calls (this pass)

| id | call |
|---|---|
| D-CUSTODY-ONE-RULE | The server never holds a root, a seed, a vault key or a persona private key — not per-tenant, not sealed, not in a TEE. Every design decision is checked against this before anything else (`docs/custody-model.md`). |
| D-CUSTODY-RIG-KEEPS-THE-DEV-KEYSTORE | The rig (`ZK_DEV_HOOKS=true`) keeps the server-hosted keystore so the 73 legacy suites keep their behaviour; production has no device on the server. The two hosts run the same isomorphic code. |
| D-CUSTODY-STAGED-AND-STOPPABLE | Gate 1 is built in four stages, each green on the legacy suite before the next; if the browser host cannot be made green in budget, the pass stops with the behaviour-preserving stages committed and the gap named. |

## GATE 0 — The custody model (design gate)

### Decisions (by id)

Written in `docs/custody-model.md` — fourteen decisions `D-CU-0-1` …
`D-CU-0-14` with rationale, two assumptions (`A-CU-BLOB-ON-VALIDATOR`,
`A-CU-WRAP-PATH-SPLIT`), the browser/server two-column table the leak
grep will enforce, the staged plan for Gate 1 and its three recorded
deviations from the letter of the gate.

The shape, in one paragraph: the hierarchy from the crypto pass is
unchanged and moves into the browser whole; the browser serves its own
`/api/*` to the page through a fetch patch, so the 54 client components
that already call the API are untouched and the rig's server host keeps
serving the suites; the Next server in production renders public state
only; the validator becomes multi-anchor (one device-auth anchor per
root, state keyed by anchor, envelope-gated reads, `/events` under the
envelope); onboarding is ephemeral-first with the seed wrapped under a
KEK per save method (passkey PRF, passkey wrap, custody provider), the
wrapped blobs living on the validator as ciphertext; 24 words are the
universal escape; an empty account after any auth forks with no
heuristics; device linking carries the vault key and persona leaves
under HPKE, never the seed; root linking is a pairwise grant in both
vaults, link not merge.

### What Gate 0 found while looking

- The validator is single-tenant too, not only the app: one
  `device_auth` row (`id = 1`), first-write-wins across strangers, one
  set of `adapter_state` namespaces. The readiness audit saw the
  symptom (a stranger's anchor refused with 409 because the rig's was
  there first); the design makes tenancy a validator schema change
  (migration 16), not only an app change.
- The scale of the move: 27.5k lines under `lib/`, 156 of 190 files
  marked `server-only`, 55 importing `node:crypto`, 11 `node:fs`, 90
  API routes, 52 pages of which 26 read the data layer during server
  render, 71 of 78 components already client-side and 54 of them
  fetching `/api/*`. The plan leans on that last number.
- The passkey wrap path (no PRF) has no rule-compliant shape without
  a server-held KEK release keyed by the credential; the design takes
  it, names it as the one server-held key, keeps the wrapped blob for
  such accounts in the browser only, and says the account is
  device-bound (A-CU-WRAP-PATH-SPLIT).

### Iterations

| iteration | result |
|---|---|
| 1 | `docs/custody-model.md` written and committed; `docs:check` green with the page marked as a decision record. |

**Exit (Gate 0):** the document exists; every decision above carries a
rationale; the two-column table names what the browser holds and what
the server holds and is the contract the leak grep is extended to
enforce in Gate 1.

---

## GATE 1 — Keystore in the browser (crypto-touching; single-threaded)

Built in the four stages `docs/custody-model.md` names, each green on the
legacy suites before the next began. Stages 1 and 2 are below; stage 3 (the
browser device itself) and stage 4 (the proof) are where the pass stopped.

### Stage 1 — one crypto implementation for Node and the browser — GREEN, committed `208116a`

| id | decision |
|---|---|
| D-CU-1-PLATFORM-CRYPTO-NOT-A-NEW-PRIMITIVE | `lib/platform/crypto.ts` gives the Node-shaped API the codebase already calls (`createHash(...).update(...).digest("hex")`, `randomBytes(n)`) over audited pure-TypeScript implementations: SHA-256, SHA-512, SHA-1 and BLAKE2b-512 from `@noble/hashes`, AES-256-GCM from `@noble/ciphers` (Cure53-audited), HKDF and scrypt from `@noble/hashes`, randomness from the platform's `getRandomValues`. No primitive changed; the vault's AES-GCM bytes are identical, proven by sealing with one implementation and opening with the other in both directions. |
| D-CU-1-BUFFER-STAYS | Callers keep speaking `Buffer` (thirteen modules do). Node supplies its own; the browser bundle gets the `buffer` polyfill already in the tree. Rewriting fifty call sites onto `Uint8Array` would have been a behavioural diff for no custody gain. |
| D-CU-1-FOUR-CIPHER-SITES-BY-HAND | The four modules that drove a cipher directly — the vault record cipher, the seed escrow, the device-link channel and the OHTTP response leg — were rewritten by anchor (seal/open helpers instead of `createCipheriv`/`setAuthTag`); the other fifty-one changed an import path only. |

**Exit (stage 1):** tsc strict clean; validator units 40/40; the five crypto
gates, the zk gates (z0–z3, z7, z8), attestation (att1–att4), multi-FID
(fid1–fid5), X linking (x1, x3), the reputation UBI (m2g1), linkage v4 and
v5, functional, accept, root-leak and the runner all green on the production
build — 29 suites, behaviour unchanged.

### Stage 2 — the validator becomes multi-anchor — GREEN

| id | decision |
|---|---|
| D-CU-1-ONE-ANCHOR-PER-ROOT | `device_auth` was one row (`id = 1`), first-write-wins across everyone — the readiness audit's finding 1 in the validator's own schema. Migration 16 makes the anchor's public key its primary key, adds `anchor` to `devices`, `roots` and `adapter_state`, and moves every existing row under the anchor that was registered (the rig's). Registering an anchor proves nothing — only a delegation signed by its private key can use it — so a stranger's anchor is their own root, never a conflict with ours. |
| D-CU-1-THE-ENVELOPE-CARRIES-THE-TENANT | `checkEnvelope` resolves the device's anchor from its stored delegation and stamps it on the request; every state read and write, the device list, rep events and root registration are scoped to it. Nothing new is trusted: the envelope chain (anchor → delegation → device signature → per-namespace counter) is the crypto pass's, and the tenant falls out of it. |
| D-CU-1-UNSIGNED-IS-A-RIG-ONLY-AFFORDANCE | A production validator (`LAYERS_REQUIRE_SIG=true`, no `ZK_DEV_HOOKS`) refuses unsigned reads of `/state`, unsigned `/device/list`, unsigned `POST /events` and unsigned root registration — readiness findings 3 and the `POST /events` rep-inflation hole, closed. A rig validator still answers them, resolving to the oldest registered anchor, so the suites that read `/state` over plain HTTP keep working unchanged. **A-CU-RIG-UNSIGNED-READS-ASSUME-ONE-APP:** "oldest" is only the app's own while one app owns the rig and its root survives the run; a device-loss suite that never recovers would leave the app writing to a newer anchor while unsigned reads still resolve to the older one. Signed reads are unaffected (the envelope carries the tenant), and a production validator has no unsigned path at all. |
| D-CU-1-EVERY-NAMESPACE-IS-SEALED | Once state is keyed by anchor, a plaintext namespace naming a persona would join that persona to the anchor that signs its zk registration — persona → root in two hops. So every namespace the validator holds is now ONE opaque, padded, sealed record (`sealWhole`), not only the fourteen vault namespaces; only the namespace's name and its KiB-rounded size remain visible (`A-CU-NAMESPACE-NAMES-VISIBLE`). Hydration accepts all three shapes it can meet: whole-sealed, per-record sealed, legacy plaintext. |
| D-CU-1-A-DELEGATION-NAMES-ITS-ANCHOR | Unnamed, a delegation resolves to the registered anchor it VERIFIES under. "The oldest anchor" was the first fallback and it was a guess that only held while there was exactly one — the moment a second root exists it points at a stranger. Verification is deterministic and needs no caller change. |
| D-CU-1-PROBING-IS-NOT-REGISTERING | An anchor registration can be a probe (`existingOnly`): it answers whether an anchor exists and never creates it. Recovery probes the candidate phrase's anchor, so a wrong guess leaves nothing behind — before this, every wrong phrase permanently added an anchor row. |
| D-CU-1-ENROLLING-IS-A-MOVE-AND-OWES-AN-UNDO | Enrolling a device under a seed's anchor MOVES it. Every path that moves the device restores it on failure: a refused recovery re-enrols under the prior seed before it throws, or the next read and write would silently address an empty tenant. |
| D-CU-1-THE-SEED-EMITS-THE-ROSTER | `validator/seed.js` writes the device-side persona → root roster as it inserts. It is the only thing that legitimately knows the mapping — migration 006 drops the column and `export-roster.js` rightly refuses to invent it — so without this the rig could not be rebuilt from scratch at all. |
| D-CU-1-A-DEVICE-MAY-MOVE-ITS-OWN-ID | A device id is the device's own random value and its delegation must verify against the named anchor, so re-registering under a different anchor is the device moving — which is exactly what device loss then recovery does. Refused instead is the hijack: a different key claiming a known id under a different anchor. |

### Iterations

| iteration | result |
|---|---|
| 1 | tsc clean, validator units 40/40, but 25 of 31 app suites red from one cause: the strict "a device id belongs to one anchor" rule 403'd the app's own device, because the device-loss suite had left its row under a transient anchor (a blank keystore registers its own device-auth key, and under multi-anchor that registration now succeeds where it used to be refused). A single 403 on the delegation bricks every signed write in the process. Rule replaced with the hijack rule above. The same run showed `accept-c0`'s "first-write-wins" assertion failing, which is the single-tenant contract this stage deliberately replaces — rewritten to assert the new one (a second root's anchor is accepted as its own and ours survives; an unusable key is still refused). |
| 2 | 28 of 31 green. Three reds, two causes. **A real defect:** `recoverIdentity` read the roster BEFORE putting the recovered seed in place, so under multi-anchor the signed read resolved to whatever anchor the blank post-loss keystore had — an empty tenant. The seed chooses the tenant, so recovery now enrolls this device under the anchor the candidate phrase derives (`enrollWithSeed`, pure derivations `deviceAuthPublicKeyFromSeed` / `signAsDeviceAuthWithSeed`, keystore untouched), then reads. A wrong phrase enrolls under an anchor holding nothing, and an empty roster is now a loud refusal instead of a silently empty "recovery" — the fail-closed property is stronger than before, not weaker. **The rest:** linkage v5 was still asserting the pre-sealing contract (plaintext attestations, folders and lens artifacts), rewritten to assert that the operator sees none of them and to ask the app for what only the app can see. |
| 3 | 9 of 10 on linkage v5, and the last one was a genuine find by the rewritten check: `xImportedPrivate` sealed each DM item under its own synthetic post hash, so every bookmarked item's `dm:` address sat in the clear beside its ciphertext — the "seals values, not addresses" trap, one namespace deeper than Mega pass 2 caught it. Sealed as one opaque padded record like readwise. |
| 4 | Linkage v5 10/10 and the twelve suites around it green, but the full 32-suite confirmation then went red across half the set with one signature: "the namespace is empty on the validator". `enrollWithSeed` had made a REFUSED recovery leave the device parked on the wrong phrase's anchor — the suites that assert "an invalid phrase is rejected" were, from that moment on, pointing every read and write at an empty tenant. A refused recovery now puts the device back where it was (re-enrol under the prior seed, then force re-bootstrap) before it throws. The lesson is the one the custody model already states and this made concrete: under multi-anchor, enrolling is a *move*, and every path that moves the device owes an undo. |
| 5 | Still red, and now from the environment rather than the code: the previous run's failures had left the rig's keystore blank (a device-loss suite whose recovery was refused) and the validator holding 22 device-auth anchors — one for every blank keystore and wrong-phrase probe that permissive registration had let through. The original rig root's seed was gone with the keystore, so its sealed state was unreadable. Two more rules, both of which stop this at the source: an anchor registration can be a PROBE (`existingOnly`) that answers whether an anchor exists without creating it, which is what recovery now uses — a wrong phrase leaves nothing behind; and an unnamed delegation resolves its anchor by VERIFYING under it rather than by "the oldest one", which was only ever a guess that held while there was exactly one. Rig then reset from seed (`validator/seed.js --force`, fresh keystore) — both are gitignored dev artifacts and every suite reseeds. |
| 6 | The reset exposed something the incident had hidden: **the rig was not reproducible.** `.keystore/fixture-roster.json` — the device-side persona → root roster every seeded-world suite reads — could only be produced by `export-roster.js` against a PRE-006 database, and it rightly refuses a post-006 one. The file on this machine was a snapshot taken once, before migration 006 existed, and deleting it could not be undone. Fixed at the only place that legitimately knows the mapping: `validator/seed.js` now records it as it inserts and writes the roster beside the database, so `node validator/seed.js --force` yields a working rig from nothing. |
| 7 | Two last corrections, both mine. A delegation that verifies under no registered anchor was answering 409 ("no anchor registered") where it means 403 ("does not verify") — 409 now means only that the validator holds no anchors at all. And the "an empty roster is a refusal" rule from iteration 2 was wrong: a root that never minted a persona HAS no roster, and recovering it legitimately yields none. The wrong-phrase signal is the probe, which is the cleaner boundary — a phrase nobody ever wrote under has no anchor to enroll under, and a phrase whose anchor does hold ciphertext still throws at the decrypt. |
| 8 | **Green: 32 of 32 suites, 0 failures.** |

**Exit (stage 2):** the validator is multi-anchor and every namespace it
holds is one opaque sealed record; a production validator refuses unsigned
state reads, unsigned rep events, unsigned root registration and the
unsigned device list; recovery reads the tenant its phrase derives, and a
wrong phrase is refused rather than silently emptied. Proof set green on the
production build (32 suites): validator units 40/40, c0–c4, z0/z2/z6/z7/z8,
att1–att4, fid1/fid3/fid5, x2/x4, bp, m3, m2g1/m2g3–m2g7, functional,
accept, root-leak, runner. Readiness-audit findings closed by this stage:
finding 3's `POST /events` rep-inflation hole and the public `GET /state`;
finding 1's validator half (one anchor per validator).

### Where the pass stopped

Stages 3 and 4 — the browser device itself — are NOT built. What exists is
the ground they stand on: one crypto implementation that runs in both hosts,
a validator that serves many tenants, and state that is opaque per tenant.
`lib/platform/storage.ts` is written — the synchronous read/write seam a
browser backend registers into — but NOT yet adopted: the seven modules that
read `.keystore/` (the keystore itself, the device key, the envelope
counters, the zk pins, the fixture roster, the issuer keys, the retention
files) still call `node:fs` directly, and moving them is the first task of
stage 3.
What remains is the largest piece of the gate: the seed and vault key held
in the browser (memory + IndexedDB), the `DeviceHost` fetch patch that
answers `/api/*` in-process (D-CU-0-3), the route modules bundled for the
browser, public-only server rendering (D-CU-0-4), the seeded viewer and the
persona cookies made rig-only, and then the readiness audit re-run through
the page to prove two contexts get two roots.

Nothing above Gate 1 was started, per the pass's own rule: the keystore
still lives on the server, so the onboarding, linking and preview gates have
nothing safe to build on yet.

### Stage 3 — the browser device — GREEN

The device is the browser. The page boots it before anything fetches, it
answers its own `/api/*` in-process, and the keys it handles never leave.

| id | decision |
|---|---|
| D-CU-3-THE-STORAGE-SEAM-IS-ADOPTED | The seven modules that read `.keystore/` — the keystore, the device key, the envelope counters, the zk pins, the fixture roster, the issuer keys, the retention files — go through `lib/platform/storage.ts`. On Node it is the filesystem with the atomic write and the Windows rename-retry those modules each carried; in the browser it is the device's own backend. The X inbox fixture became a bundled import rather than a file read. |
| D-CU-3-STORAGE-IS-EPHEMERAL-UNTIL-THE-VISITOR-SAYS-OTHERWISE | `lib/platform/storage.browser.ts` holds everything in memory (D-CU-0-6: a tab that closes takes its seed with it). "Keep this identity on this device" generates a NON-EXTRACTABLE AES-256-GCM key inside WebCrypto, stores it in IndexedDB as a `CryptoKey`, and mirrors every entry as ciphertext under it with the entry's path as associated data. The key cannot be exported by any code, including this code. |
| D-CU-3-THE-FETCH-PATCH-HAS-AN-EARLY-HALF | `public/device/boot.js` is a classic synchronous script the page loads first: until the device installs, a same-origin `/api/` fetch is QUEUED, not sent. Without it a client component that fetches on mount races the device and lands on the server, which in production has no identity. The module half (`lib/device/host.ts`) drains that queue when it installs. |
| D-CU-3-THE-ROUTE-TABLE-IS-GENERATED | `scripts/device-routes.mjs` walks `app/api/**/route.ts` and writes the table the device matches against (88 routes; `/api/health` and `/api/dev/live` stay the server's and fall through the patch). Generated, so a route added later cannot be silently absent from the device. |
| D-CU-3-THE-SHIMS-ARE-SMALL-AND-HONEST | `next/server` (the `NextResponse.json` / `req.nextUrl` / cookie surface over the browser's own Request and Response), `next/headers` (the device jar: one visitor, one jar, no request scope), `server-only` (a no-op — the device IS the key holder), `react` (`cache()` is the identity function where there is no render), `node:fs` (probes answer absent, reads and writes refuse loudly), `node:path` (the posix subset that builds storage keys), `node:crypto` (the platform layer from stage 1), and one shim for `node:http`/`https`/`worker_threads`/`child_process` whose every function refuses — the modules that import them are reached only in live modes the preview does not run. |
| D-CU-3-A-ROOT-WITHOUT-A-FID | The validator's roots table needs an integer fid and an ephemeral visitor has no Farcaster identity, so the device names a NEGATIVE fid derived from its anchor — a value no network issues, so "this root has no network identity" is legible in the row itself, and binding a real fid later is a re-registration rather than a collision. |
| D-CU-3-THE-DEVICE-HYDRATES-AT-BOOT | On a server the store is loaded by whichever adapter call happens to come first; the private-post chokepoint reads state directly and never goes through an adapter. The device therefore hydrates before the fetch host installs — otherwise a restored visitor answers their first request from an empty store, which is what the smoke caught. |
| D-CU-3-THE-FIXTURE-WORLD-IS-NOT-A-VISITOR'S | The seeded private world and the seeded grant graph are the rig's fixtures. A device viewer skips both, so a stranger's vault starts genuinely empty rather than pre-populated with the seed's private posts and audiences. |
| D-CU-3-THE-DEV-ROUTE-IS-A-RIG-SURFACE-ENTIRELY | Readiness finding 3: the guard covered a named set of rig actions, so `viewAs`, `forceFail`, `setLatency` and the registry answered a stranger on a production build. Now the whole route — GET included — refuses unless `ZK_DEV_HOOKS` is on. The rig runs its production build with the hooks and is unaffected. |

### Iterations

| iteration | result |
|---|---|
| 1 | The storage seam adopted; sixteen suites green on the production build, behaviour unchanged. The bundle then failed to build four ways, each a real gap: an `await` inside a non-async callback, `node:fs/promises` and `@/lib/session/ephemeral` inheriting their parent's alias (esbuild aliases are prefixes, so subpaths must be named first), and the device's own session shim. |
| 2 | First boot: the validator's existing CORS policy allowed `Content-Type` only, so every envelope-signed request from the browser was blocked before it left. The envelope headers and the state verbs were added to the policy that was already there, rather than the second policy I had first written beside it. |
| 3 | 5 of 9. The device minted one public persona, so a private post had no author (a private post needs a private persona) — it now mints the pair every surface expects. The fixture private world and grant graph were being seeded into a visitor's vault. The dev route answered `viewAs` with 200. |
| 4 | 7 of 9, and the two that remained were both real. **A content-derived address:** a private post's id was `sha256(author‖text‖createdAt)`, and that id IS the address of its row on the validator — an operator who guesses the text can confirm it by recomputing the hash. The id is now random; nothing ever recomputed it. **An empty restored store:** hydration only ever happened inside an adapter call, so a restored device answered its first request from nothing. The device hydrates at boot. |
| 5 | **9 of 9.** |

**Exit (stage 3):** two independent browser contexts against a production
build boot two devices with distinct anchors, distinct roots, distinct zk
commitments and persona rosters with nothing in common; A's cast is in A's
feed and not in B's; A's private post is readable by A and invisible to B;
the validator holds only ciphertext under both anchors, with no cast text,
no private text, no persona id and no handle in any row of any table, and
every address either the whole-record marker or an opaque id; a dev action
is refused; a server-only route still reaches the Next server; and "keep
this identity on this device" survives a reload while an unsaved device
does not. The full legacy suite is green — the rig still uses the dev
keystore on disk and its behaviour is unchanged.

### Stage 4 — the proof — GREEN, with one gap named

| instrument | what it proves |
|---|---|
| `scripts/device-smoke.mjs` (10 checks) | two browser contexts, two devices, through the page's own fetch: distinct anchors, roots, zk commitments and rosters; A's cast in A's feed and not in B's; A's private post invisible to B; only ciphertext under both anchors with no text, persona id or handle in any row of any table and every address opaque; dev actions refused; a server-only route still reaching the server; keep-on-this-device surviving a reload while an unsaved device does not; and 21 needles of key material (seed, vault key, device-auth, persona and device keys) absent from the validator's database, its log and the app's log. |
| `scripts/probe-no-keystore.mjs` (3 checks) | a production server started on an EMPTY `KEYSTORE_DIR` leaves it empty — no seed, no device key, no pins — hands out nothing private, and refuses the keyed routes at the keystore door while still answering its own liveness. |
| `scripts/device-restart-survival.mjs` (5 checks) | a device that kept its identity here writes a private post; both servers are killed with SIGKILL and restarted from the same build and database; the same tab re-opens the same root and re-decrypts the post. The keys were in the browser the whole time. |
| `scripts/audit-preview-g0.mjs --device` | the readiness audit itself, re-run through the page against a production-shaped pair. |

**The readiness audit, then and now** (`--device`, production-shaped: `LAYERS_REQUIRE_SIG=true`, no `ZK_DEV_HOOKS`):

| Gate 0 finding | then | now |
|---|---|---|
| 1. multi-tenancy does not hold | one root, one roster, one commitment for every visitor | two roots, two anchors, two rosters, two commitments; the registry answers a stranger 403 |
| 2. shared, cross-mutating corpus; a guessable cookie reads the owner's private posts | B read and wrote as the owner | B's feed does not contain A's cast; the guessable cookie reads 0 private posts; authoring as the owner is 403; `viewAs` is 403 |
| 3. dev surfaces open on a production build | `forceFail`, `setLatency`, `forgeEvent`, `resetSeed`, the zk rig actions and the registry all answered | every one 403 |
| 3b. `POST /events` unsigned (rep inflation); `GET /state` public | 201 and 200 | 401 and 401; `DELETE /state` 401; `/zk/dev/reset` 403 |
| 4. secrets | clean | clean |
| 5. production-off flags | refuse as configured | unchanged |

**The gap, named.** Server-side public-only rendering (D-CU-0-4) is NOT
built. The probe measures it rather than asserting it: a production server
still renders `/home` 200 because its SSR path reaches for data the device
should supply. That is the remaining piece of stage 3, and the preview pass
needs it before a page can be served to a stranger — the API surface is
right, the rendering path is not. Nothing else in Gate 1 depends on it.

**One flake, recorded:** the reputation UBI suite's spectrum check (a `wrong` stake reaching the refutation surface) failed once in the final full run and passed 8/8 on a clean re-run of the same build, minutes later, with nothing changed. It is a timing flake in that suite, not a regression from this gate.

**Exit (Gate 1):** met. Two independent browser contexts against a
production build get two distinct root commitments, two empty vaults and
cannot see each other's posts; the readiness audit's own script, re-run
through the page, flips findings 1, 2 and 3; no production code path reads
`.keystore/` (the boot-time refusal plus the empty-directory probe, the
deviation the custody model recorded at Gate 0); the leak grep over the
validator's database, its log and the app's log is clean against 21 needles
of device key material; restart survival passes with browser-held state
across a SIGKILL of both servers; and the full legacy suite is green — the
rig still uses the dev keystore on disk, so the suites are unchanged in
behaviour.

---

## GATE 2 — Ephemeral onboarding + passkey + social login (crypto-touching; single-threaded)

Decided before code, per the discipline. The custody model's D-CU-0-6 to D-CU-0-12 are the frame; these are the
calls the frame left open.

| id | decision |
|---|---|
| D-CU-2-THE-WRAP-IS-ONE-PRIMITIVE | Every save method wraps the SAME 32-byte seed under that method's 32-byte KEK with AES-256-GCM (stage 1's platform layer; no new primitive), a random 12-byte nonce, and the method id as associated data, so a blob cannot be replayed under another method. The KEK is HKDF-SHA256 of the method's secret with a per-method info string (`layers/v1/kek-from-prf`, `layers/v1/kek-from-provider`). Unwrapping with the wrong KEK fails the tag; nothing half-succeeds. |
| D-CU-2-METHOD-IDS-ARE-PUBLIC-IDENTIFIERS | A passkey's method id is `pk:<credential id>`; a provider's is `pv:<provider>:<method>:<subject>`. The validator holds the method RECORD (id, kind, the root's anchor, and for passkeys the credential's SPKI public key and algorithm) and the wrapped BLOB, both keyed by method id. Reading a blob or a record needs no authentication — the blob is ciphertext and the id is what a discoverable credential or a provider login hands back — but WRITING one requires the device envelope, and a method id belongs to the first anchor that wrote it: a stranger cannot overwrite your blob under your credential id. |
| D-CU-2-PRF-IS-THE-PATH-TO-PREFER | Registration asks for the `prf` extension; if the authenticator reports it enabled, an assertion evaluating the fixed salt `layers/prf/v1` yields 32 deterministic bytes and the PRF path is recorded on the method. Unlock is one discoverable assertion: the credential id names the method, the PRF output derives the KEK, the blob comes from the validator (or the local mirror), the seed unwraps. The same synced passkey on any device resolves to the same root because the blob is on the validator. The fixture authenticator (Chromium's virtual authenticator over CDP, `hasPrf`) was probed before any of this was written: PRF enabled, 32 bytes, identical across assertions, discoverable. |
| D-CU-2-THE-WRAP-PATH-IS-STATELESS-ON-THE-SERVER | Without PRF the KEK is `HMAC-SHA256(CUSTODY_RELEASE_SECRET, "layers/custody/release/v1" ‖ credential id)`, derived by the app server and released only after it verifies a WebAuthn assertion for that credential — so the server holds ONE secret and no per-account rows. The blob for a wrap-path account lives only in the browser's IndexedDB (D-CU-0-8): the account is device-bound and the picker says so. Assumption A-CU-2-RELEASE-SECRET-ROTATION: rotating the secret orphans every wrap-path blob; the 24 words are the escape hatch, and the save flow says so. On the rig the secret is a fixed dev value under `ZK_DEV_HOOKS`; in production it must be set or the wrap path is simply unavailable (503) and the picker offers PRF and social. |
| D-CU-2-NO-CBOR-NO-ATTESTATION | The server never parses an attestation object. At registration the browser hands over `getPublicKey()` (SPKI DER, no CBOR) and `getPublicKeyAlgorithm()`; the server verifies ASSERTIONS with WebCrypto — Ed25519 raw, or ECDSA P-256 after a DER-to-raw conversion — over `authenticatorData ‖ SHA-256(clientDataJSON)`, and checks the challenge (HMAC-signed by the server, two-minute TTL, spent once), the origin, the RP id hash and the user-present flag. The credential is trusted on first use by the device that created it (the standard passwordless posture); what is verified every time is the assertion. No primitive is hand-rolled; the protocol checks sit on audited implementations. |
| D-CU-2-THE-PROVIDER-IS-AN-ADAPTER-AND-THE-REAL-ONE-IS-NOT-IN-THE-TREE | `CustodyProviderAdapter { name, methods, login(method) → { subject, exported } }`. The fixture provider's export is `SHA-256("layers-fixture-provider" ‖ method ‖ subject)`: deterministic, so a sweep can be the same person twice and a different person once. The real provider (a Privy-class embedded wallet) sits behind the same interface and is NOT installed: no SDK in the tree, no credentials on this machine. `scripts/live-cu2.mjs` refuses with "not configured" unless both exist. Assumption A-CU-2-REAL-PROVIDER-NOT-EXERCISED, named in the report and the posture. |
| D-CU-2-ATTACH-WRAPS-THE-SAME-SEED-AGAIN | Attaching a second method obtains its KEK and wraps the seed the device already holds under it, recording the method under the SAME anchor. Two methods, one root, is then a fact about the validator's tables (two records, one anchor) and about the zk commitment (one). |
| D-CU-2-A-LOGIN-THAT-FINDS-NOTHING-DOES-NOT-CREATE | A provider login or a passkey assertion that resolves to no method record is an EMPTY ACCOUNT, and the device reports it as such instead of saving on the spot. The fork ("New here? / Already have an account?") that Gate 3 renders sits on exactly this signal; nothing else — not IP, not user agent, not timing — is consulted (D-CU-0-12). |
| D-CU-2-THE-24-WORDS-ARE-THE-DEVICE'S | Export is the crypto pass's mnemonic over the seed the device holds, shown in the browser and never transmitted (the route that produces it runs in the device, not on the server). Import is the crypto pass's recovery — the device enrols under the phrase's anchor, reads the roster, restores the keystore — followed by a re-boot of the device identity: the store is discarded and re-hydrated under the new root, and the viewer is rewritten. Nothing about the previous ephemeral root survives the import except its public actions. |
| D-CU-2-AN-UNSAVED-VISITOR-LEAVES-PUBLIC-IDENTIFIERS-ONLY | An ephemeral visitor's boot registers a device-auth anchor (a public key), a device delegation (public), a root row with a negative fid, and writes sealed roster/state rows. None of it is key material and none of it names the visitor; the leak grep asserts the first, the smoke asserts the second. It is more than D-CU-0-6's "nothing" and it is recorded as such: A-CU-2-EPHEMERAL-FOOTPRINT. |

Two more calls the build forced:

| id | decision |
|---|---|
| D-CU-2-A-DEVICE-IS-NOT-A-RIG | The mock adapters inject 200–1500 ms of latency and a 2% synthetic failure on every call — the rig's demonstration of retry discipline. A production process without the dev hooks (the visitor's browser device, or a production server) gets neither. Found when a visitor's persona mint failed by dice during a boot. |
| A-CU-2-SYNCED-PASSKEY-PRF-NOT-SIMULABLE | Chromium's virtual authenticator exports a credential as id, private key, user handle and counters — no hmac-secret material — so the fixture cannot carry a credential's PRF between browser contexts. A real synced passkey carries it. What the suite asserts instead: the moved credential resolves the same method record, and a device that cannot evaluate PRF fails closed and never yields a wrong root; the blob-from-the-validator property is proven by the wipe in the PRF check, and cross-device unlock end to end by the provider path. |

### What was built

`lib/device/custody/` (the wrap primitive, the passkey client, the provider adapter with its fixture, the method
client with its local mirror, and the custody API on `window.__layersDevice.custody`); `validator/custody.js` and
migration 17 (records and blobs); `lib/custody/{webauthn,release}.ts` and `app/api/custody/passkey/{challenge,release}`
on the app server (server-only routes, refused by the device); `app/device` and `components/device/DeviceApp.tsx`
(the strip, the picker, unlock with the fork's signal, settings with the 24 words); `scripts/accept-cu2.mjs` (nine
checks, virtual authenticators over CDP, with and without PRF); `scripts/live-cu2.mjs` (refuses honestly).

### Iterations

| iteration | result |
|---|---|
| 1 | 6 of 9 on the first run. One cause under all three reds: the rig's synthetic adapter failures were running inside the visitor's device and a persona mint failed by dice (D-CU-2-A-DEVICE-IS-NOT-A-RIG). |
| 2 | 5 of 9, all specific. The moved-credential check found the fixture's limit (A-CU-2-SYNCED-PASSKEY-PRF-NOT-SIMULABLE); the attach check ran on the device that had failed to unlock; the 24-words check failed inside my own test helper, which kept the pre-import persona ids after an import; the page check reused the fixture provider's default subject across runs, so the second run's save was refused as another root's — correctly. |
| 3 | 8 of 9: the last was the fixture's standard-base64 credential id against the method id's base64url. |
| 4 | **9 of 9.** |

**Exit (Gate 2):** an ephemeral visitor loses state on tab close and the next visit mints fresh; the passkey PRF
path round-trips (save, forget, unlock: the same root, commitment, personas and private post, the blob fetched from
the validator); the wrap path round-trips on the same device and is refused as device-bound on another; the social
path round-trips on the fixture provider, and a login nobody saved under is reported empty rather than created; a
root saved by passkey and then attached to social resolves to the same commitment via either, with two records
under one anchor; the 24 words export, survive a wipe, and reproduce the root, the personas and the vault; 99
needles of seed, KEK, PRF and provider material are absent from the validator's database, its log and the app's log;
the onboarding page renders both paths as equals and a save through it flips the strip. `live-cu2` is NOT green: it
refuses, because the real provider is not in the tree (A-CU-2-REAL-PROVIDER-NOT-EXERCISED).

---

## GATE 3 — The empty-account fork + device linking + root linking (crypto-touching; single-threaded)

| id | decision |
|---|---|
| D-CU-3-THE-FORK-IS-A-SIGNAL-NOT-A-GUESS | The fork renders on exactly one signal: an unlock that resolves to no method record (D-CU-2-A-LOGIN-THAT-FINDS-NOTHING-DOES-NOT-CREATE). The suite drives two browser contexts with different user agents through the same empty login and asserts the same fork on both; nothing about the visitor's client, address or timing is consulted, because nothing about them is read. |
| D-CU-3-THE-CODE-COMES-FROM-THE-NEW-DEVICE | The linking channel is HPKE (X25519 / HKDF-SHA256 / AES-256-GCM, `@hpke/core`, the suite already in the tree for OHTTP) sealed TO THE NEW DEVICE'S KEY, so the old device must know that key before it can seal anything. The new device therefore mints a fresh X25519 keypair in memory, posts its public key and its device key as an OFFER, and receives a short code; the old device enters the code, fetches the offer, seals the material to the offer's key and posts it back; the new device opens it with the private key it never let out of memory. Both of the custody model's entry points use this one code: "link this device" shows it, "add a device" asks for it. *Deviation from D-CU-0-13's letter recorded:* the old device's screen asks for the code rather than showing one, because a code the old device shows cannot carry the new device's key. |
| D-CU-3-OFFERS-ARE-CREATE-ONCE-AND-SHORT-LIVED | An offer's code is 10 characters from an unambiguous alphabet (50 bits), a code can be created once (a second create under the same code is refused, so an attacker cannot replace the key the person's device posted), the offer expires in ten minutes, and the sealed material is written only under the old device's envelope (the validator records which anchor approved). The relay holds a device key, an HPKE public key, and ciphertext: nothing it holds opens anything. |
| D-CU-3-THE-PAYLOAD-IS-THE-MATERIAL-A-DEVICE-NEEDS-NEVER-THE-SEED | The sealed material is: a delegation for the new device's key signed by the root's device-auth key; the root's id and anchor (public); the vault key; the zk identity's master bytes; and, per persona, the record plus the three per-persona key LEAVES (the signing key, the Farcaster signer, the custody key) that the seed would otherwise derive. The seed and the device-auth private key never cross: a linked device can act as every persona and open the vault, and cannot mint a persona, recover, or authorise another device. The payload grep in the suite asserts both absences on the opened plaintext, the relay row and the validator's tables. |
| D-CU-3-THE-KEYSTORE-HAS-A-LINKED-MODE | The keystore file keeps its shape and gains `linked`: a root without a seed. Every seed-derived function branches once — a persona's leaf from the record, the vault key and the anchor from the linked material, the zk master from the material — and the functions that need the seed (mint a persona, sign as device-auth, export the phrase) refuse with a sentence that says which device can. The envelope bootstrap uses the delegation the link delivered instead of self-issuing one. |
| D-CU-3-A-ROOT-LINK-IS-A-CO-SIGNED-GRANT-EXCHANGED-THROUGH-THE-SAME-RELAY | Two roots on two devices link with the pairwise grant D-CU-0-14 describes — `{ rootA, rootB, issuedAt }` signed by both device-auth keys — but each signature is made on the device that holds that root's seed; nothing moves. The exchange uses the same offer relay: the first device posts its half (its anchor, its persona roster as public records, its signature); the second fetches, verifies the first signature against the named anchor, adds its own, and posts the completed grant back; each stores it in its own vault, sealed. The validator relays ciphertext and two anchors that were already public and never learns that the pair is one person. |
| D-CU-3-UNIFIED-MEANS-PRESENTED-TOGETHER-NOT-MERGED | With the grant in its vault a client presents the linked root's personas beside its own in the switcher and the settings surface, from the public roster the grant carries, with the sentence "these accounts are linked, not merged — reputation does not combine" wherever a tier is shown. Search over the linked root's VAULT is not in this gate: it needs the other root's vault key and a second device authorisation on this device, which is device linking at the root level and is recorded as the next step (A-CU-3-UNIFIED-SEARCH-IS-PRESENTATION-ONLY). Unlink deletes the grant from the vault of whichever side acts and marks it revoked on the relay; the other side drops its copy on its next read. Symmetric. |

### What was built

`lib/device/linking.ts` (offer / approve / accept over HPKE), the keystore's linked mode (`LinkedRoot`, every
seed-derived function branching once, `installLinkedRoot`, `linkMaterial`, `linkedDelegation`), the envelope
bootstrap registering a delivered delegation, `lib/device/rootlink.ts` (propose / answer / complete / linked /
unlink, the grant sealed in the `rootLinks` vault namespace), the validator relays (migrations 18 and 19;
`/link/*`, `/rootlink/*`), the page's devices and linked-accounts cards with the sentence, and
`scripts/accept-cu3.mjs` (seven checks).

### Iterations

| iteration | result |
|---|---|
| 1 | 3 of 7, with device linking itself green on the first run: the new device held the same root, vault and personas; the payload carried the vault key and a delegation and neither the seed nor the device-auth key; revocation reached the linked device. One real defect among the four reds: a linked device answered a phrase export with its root HANDLE where a seed was expected and refused with the wrong sentence — it now refuses at the door, for exports and for saves alike. The other three were the suite: a race on a button still disabled while the fork rendered, an ambiguous placeholder match, and a per-root reputation assertion the fixture rep adapter cannot honour (it answers a default tier for any id; A-CU-3-PER-ROOT-REP-UNDER-FIXTURE-REP) — replaced by the property that IS observable: a linked persona is never folded into this root's own roster and this device cannot switch to it. |
| 2 | **7 of 7.** Gate 2 (9 of 9), the device smoke (10 of 10) and the no-keystore probe (3 of 3) re-run green on the same build. |

**Exit (Gate 3):** the fork renders on every empty-account login, for two different user agents, from one signal;
a device link transfers access without the seed (the payload grep asserts the seed and the device-auth key absent
from the opened material, the relay row is ciphertext, and nothing of either reaches a validator table); a linked
device acts as every persona and opens the vault, cannot export the phrase or mint a persona, and is refused after
the root revokes it; a root link yields the other root's personas on both sides, presented beside the device's own
and never folded into them, with the sentence "linked, not merged — reputation does not combine"; unlink from
either side reverses it on both. Not in this gate, named: search over a linked root's vault
(A-CU-3-UNIFIED-SEARCH-IS-PRESENTATION-ONLY).

---

## GATE 4 — Re-run the readiness audit; close findings 2–5

| id | decision |
|---|---|
| D-CU-4-THE-CONTRACT-IS-A-LIST-WITH-TWO-COPIES | The production environment contract is one list of must-not-ship names — the live network credentials the preview must not carry, and the switches that would turn a live path on — in `lib/platform/env-contract.ts` for the app and a CJS copy in `validator/env-contract.js`; the Gate 4 suite asserts the two copies identical. A public deployment is a production build without the dev hooks; in that shape each process checks the list at boot, prints the NAMES it found and never their values, and exits 78 (EX_CONFIG). The rig, which runs its production build with the hooks, is untouched. `.env.production.example` carries the names and nothing else. |
| D-CU-4-RATE-LIMITS-ARE-A-BUDGET-PER-ADDRESS-PER-PROCESS | A token bucket per client address in each process: the app's middleware on every `/api/*` route (200 of burst, 3 per second), the validator's on every route (300 of burst, 5 per second), a 429 with Retry-After beyond that, liveness never throttled, the rig exempt because its suites hammer one address on purpose. Assumption A-CU-4-RATE-LIMIT-PER-INSTANCE: the budget is per process instance; several instances multiply it, which is still a budget. No shared store was added — a preview has one instance of each, and a store would be a new server-side dependency for a number. |
| D-CU-4-THE-DEV-ROUTE-IS-CLOSED-WHOLE-NOT-BY-LIST | The prompt asks for nine more actions to join `RIG_ONLY_ACTIONS`; Gate 1 stage 3 closed the route entirely on a public deployment (GET included), which is the same closure without a list to keep current. The set still exists for the rig, where it decides which actions are refused even with the hooks on. |
| D-CU-4-EVENTS-KEEP-THE-ENVELOPE | Between "`POST /events` requires the envelope" and "remove it in favour of the poller": the envelope, decided in Gate 1 stage 2 and asserted again here — the accrual is the app's own signed write under its root's anchor, and the poller path is the rig's. |

### What was built

`lib/platform/env-contract.ts` and `validator/env-contract.js` (one list, two copies, asserted identical);
`instrumentation.ts` (the app's boot refusal, exit 78, names only) and the validator's boot refusal;
`middleware.ts` (the app's per-address token bucket on `/api/*`) and the validator's; `.env.production.example`;
`scripts/accept-cu4.mjs` (eight checks, against the production-shaped pair).

### Iterations

| iteration | result |
|---|---|
| 1 | **The boot check's first catch was the harness.** The production-shaped restart refused to start: `.env.local` carries a wallet id, a custody private key, a signer id and an inbox token, and the harness's "production shape" cleared the API key and the write switches but not those four — so every earlier "production-shaped" audit had them on board. The refusal named the variables and nothing else. The harness's production shape now clears every name on the list; nothing in the app changed. |
| 2 | **8 of 8.** The readiness audit, driven through the page, flips every finding on the production-shaped pair; the secrets audit is clean; a burst of 260 on the app meets 60 429s with Retry-After and liveness is never throttled; a burst of 340 on the validator meets 319; a poisoned boot exits 78 naming the variable and not the value, on both processes; a clean boot starts. One reading recorded: 319 of 340 on the validator means its bucket was nearly empty before the burst — on the rig the audit, the app server and the burst all arrive from one address and share one budget (A-CU-4-RATE-LIMIT-KEY-IS-THE-ADDRESS). In a deployment the app server's own validator traffic has its own address; visitors have theirs. |

**Exit (Gate 4):** the readiness audit passes all five with evidence (`shots/audit-preview-g0-cu4-*.json`, and
`--label device-production` from Gate 1); burst tests hit the rate limits on both processes; the boot check refuses
a poisoned environment on both; the full legacy suite is green.

## GATE 5 — Three adversarial reviews (fresh context, Opus ×2 + Sonnet ×1)

`research/attack-custody-1.md` (Opus: 1 CRITICAL, 5 HIGH, 8 MEDIUM, 1 LOW, 6 notes), `research/attack-custody-2.md`
(Opus: 2 CRITICAL, 6 HIGH, 13 MEDIUM, 2 LOW, a 9-item note cluster), `research/attack-custody-3.md` (Sonnet: 2
CRITICAL, 3 HIGH, 4 MEDIUM, 2 LOW, 2 notes). The three converged on six things: the fixture provider was the
production social path with a public KEK; the root-link relay carried both rosters in the clear and the co-signature
did not cover them; the boot contract had no must-be-set half, so `LAYERS_REQUIRE_SIG` was checked by nothing; the
wrap-path release fell open to a caller-supplied key; both rate limiters keyed on a header the client writes; and a
link code was a bearer credential for the whole vault with no confirmation across devices. Every finding below is
fixed or carried as an assumption by id; nothing was argued down.

| id | decision |
|---|---|
| D-CU-5-THE-FIXTURE-IS-A-RIG-ADAPTER | The fixture custody provider exists in a device only when the page that booted it declared `CUSTODY_FIXTURE_PROVIDER=allow`; the app's `/device` page declares it only when the SERVER runs with `ZK_DEV_HOOKS`, and the smoke page declares it and boots only on a loopback host. The fixture takes no default subject (an empty name would have made every visitor one person). The boot contract refuses `CUSTODY_FIXTURE_PROVIDER=allow` on a public deployment. A public deployment without a real provider shows "no social login is configured" in the picker and offers the passkey and the 24 words; the real provider is still not in the tree (A-CU-2-REAL-PROVIDER-NOT-EXERCISED, unchanged). |
| D-CU-5-A-LINK-IS-CONFIRMED-ACROSS-DEVICES | Both link flows show a fingerprint on the device that will RECEIVE, and the device that GRANTS types it before anything is sealed. Device link: `sha256(code \| hpkePub \| devicePubKey)`, eight hex characters, shown beside the code on the new device, typed with the code on the root's device; `approve` refuses a mismatch before it issues the delegation. Root link: `sha256(code \| ekA \| ekB)`, shown on the answering device, typed on the proposing device; `complete` refuses a mismatch before it seals or signs. The approving screen states what is granted ("can act as every persona and open the vault; cannot mint personas or export the 24 words"). |
| D-CU-5-THE-RELAY-HOLDS-SEALED-ROSTERS | Root linking v2. A proposes (anchor, root id, an ephemeral X25519 key); B answers with its own ephemeral key, ITS ROSTER SEALED TO A'S KEY (HPKE), the roster's hash and a signature over the partial canonical that commits to that hash; A completes with its roster sealed to B's key, its hash and a signature over the full canonical (both hashes). Each side opens the other's roster and refuses it unless its hash is the one that was signed. Every relay read is signed by an enrolled device; the grant is recorded (`root_link_grants`) at completion so revocation and the revoked-probe are party-scoped; expired rows are swept. The relay holds anchors, root ids, ephemeral public keys, ciphertext and signatures — never a persona. |
| D-CU-5-THE-CONTRACT-HAS-A-MUST-BE-SET-HALF | The environment contract now has two halves: names that must be off, and values that must be set — `LAYERS_REQUIRE_SIG=true` on a public deployment, in both copies; the Gate 4 suite starts a public deployment without it and asserts the refusal names the variable. A production build WITH the dev hooks prints a rig banner at boot on both processes, so a mis-set `ZK_DEV_HOOKS=true` is loud rather than silent. |
| D-CU-5-RELEASE-FAILS-CLOSED | The wrap-path release answers 503 when the validator errors, answers a 5xx or is unreachable; the caller's SPKI is accepted only on a CONFIRMED 404 — the first save of a wrap-path passkey, whose record the device writes right after and whose blob never leaves the device, so the KEK that release yields opens nothing a stranger can reach. Allowed origins come from `APP_URL` and `CUSTODY_ALLOWED_ORIGINS` only; loopback origins are allowed only off a public deployment; the RP id is `APP_URL`'s host, not the caller's. |
| D-CU-5-HEADERS-ARE-NOT-ADDRESSES | Both rate limiters key on the socket address (the app: the platform's `req.ip`, then "local"); `X-Forwarded-For` / `X-Real-IP` are honoured only under `TRUST_PROXY=true` (A-CU-5-TRUST-PROXY). The validator's limiter is mounted ahead of the anonymous channel. The Gate 4 suite sends bursts with 260 and 340 distinct forwarding headers and asserts they are still limited. |
| D-CU-5-A-DEVICE-MOVES-ONLY-WITH-ITS-KEY | Re-registering a device under a different anchor (the move that recovery and linking perform) requires `x-layers-device-proof`: an Ed25519 signature by the device's own key over `layers/device-proof/v1 \| sha256(body)`. A delegation signed by some root's anchor names the device's public key; it no longer proves the device consented to move. `/device/register` also requires the anchor to be named (the app always names it); the scan of every anchor is gone. |
| D-CU-5-ENVELOPES-CARRY-AN-OPERATION-CLASS | The custody envelope namespace is split by operation class: `custody` for writes and reads of the caller's own records and relay rows, `custody:delete` for deleting a method, `custody:revoke` for revoking a grant and forgetting a relay row. A captured envelope of one class cannot be replayed as another; within a class the body hash binds the payload (A-CU-5-ENVELOPE-BINDS-NAMESPACE-NOT-PATH for what remains). |
| D-CU-5-DEBUG-MEMBERS-EXIST-ONLY-ON-THE-RIG | `needles()`, `rootOnly()`, `custody.secrets()` and `linking.lastPayload()` — the accessors the leak greps use — are members of the device API only when the page declared `LAYERS_DEVICE_DEBUG=1`, which the app's page does only on a rig server and the smoke page does only on loopback. Elsewhere they return empty. What remains callable by page script is the device's operational surface (A-CU-5-THE-PAGE-IS-THE-DEVICE). |
| D-CU-5-THE-24-WORDS-ARE-THE-ESCAPE-HATCH | Importing the 24 words enrols and CREATES the phrase's anchor when the validator holds none (a root generated on a device that never wrote); the method paths keep `existingOnly`, because a wrapped blob only exists for a root that already wrote. A method the validator no longer records while the device still holds its blob is a loud error, not an empty account. |
| D-CU-5-THE-ROOT-LAYOUT-MOUNT-IS-GATE-6 | D-CU-0-3 (the device host mounted by the root layout, every app page a device page) is the public-preview page work — the landing page at `/`, the app under it — and moves to Gate 6 with the page split, rather than being bolted onto today's route tree twice. Until then the `--device` audit measures the smoke page (A-CU-5-AUDIT-DEVICE-MEASURES-THE-SMOKE-PAGE), and the smoke page is a rig surface Gate 6 excludes from the public deployment (D-CU-5-THE-SMOKE-PAGE-IS-A-RIG-SURFACE). |

### Assumptions recorded this gate (by id)

| id | assumption |
|---|---|
| A-CU-5-THE-PAGE-IS-THE-DEVICE | The device runs in the page: any script on the origin can call what the page can (unlock, save, export the 24 words, use the wrapping key it reads from IndexedDB). That is the property of every client-side wallet; the mitigations are the origin's — no third-party script, a strict CSP, no inline script — which Gate 6 sets on the deployment. The environment the bundle reads is captured once at load (`process` shim); a page that can set a global before the bundle loads is the page. |
| A-CU-5-TRUST-PROXY | Rate-limit keys, the per-address cap on open link offers and the relay's `created_by` are socket addresses unless `TRUST_PROXY=true`; behind a proxy that does not overwrite `X-Forwarded-For` with the flag set, or with the flag unset behind one that does, the key is the proxy's address and every visitor shares one budget. Set it to match the deployment's actual proxy (Gate 6 records which). |
| A-CU-5-CHALLENGE-REPLAY-PER-INSTANCE | The wrap-path challenge's spend set is per process and per boot: a challenge is spendable once per instance and again after a restart inside its two-minute TTL, and it is not bound to a credential id. A replay re-releases the KEK for a credential the caller already proved possession of, to that caller; nothing else. |
| A-CU-5-PROVIDER-SUBJECT-PROOF | Writing a provider method record proves nothing about the provider subject it names; a stranger who names a victim's subject first makes the victim's later save a 409 (denial), never a takeover (the blob unwraps only under the victim's own export, and `unwrapSeed` binds the method). Binding the record to a provider-signed subject proof needs the real provider (A-CU-2-REAL-PROVIDER-NOT-EXERCISED). Passkey ids are minted by the authenticator and unknown to a stranger before registration. |
| A-CU-5-ENVELOPE-BINDS-NAMESPACE-NOT-PATH | Within one operation class, an empty-body read envelope is interchangeable among reads of that class; every such read returns the caller's own data. Binding the HTTP method and path into the envelope is a change to the envelope format every write in the tree shares, and is not made in this pass. |
| A-CU-5-PRODUCTION-IS-NODE_ENV-PRODUCTION | "Public deployment" is defined as `NODE_ENV=production` without `ZK_DEV_HOOKS`; every refusal hinges on that pair. `.env.production.example` pins both; the rig banner makes the other combination visible at boot; the Gate 6 deploy config sets the environment from the template's names. |
| A-CU-5-AUDIT-DEVICE-MEASURES-THE-SMOKE-PAGE | Until Gate 6 mounts the device host in the root layout, `scripts/audit-preview-g0.mjs --device` drives the app through the smoke page's device, which runs the same bundle and the same routes as `/device`. |
| A-CU-5-PSEUDO-FID-IS-32-BITS-OF-THE-ANCHOR | A root's pseudo-fid is 31 bits of its anchor; `/roots` recomputes it from the caller's anchor and refuses a mismatch, so a collision between two roots is a 409 at the second registration, never a takeover. The space is small enough that a collision will eventually happen on a large deployment; widening the column is a migration recorded for then. |
| A-CU-5-ANCHOR-CREATION-IS-OPEN-UNDER-THE-LIMIT | Registering a new device-auth anchor is a new root's first act and is by definition unauthenticated; it is bounded by the validator's rate limit per address and by the usable-key check. Junk anchors cost a row each. |
| A-CU-5-PER-RECORD-NAMESPACES-KEEP-ADDRESSES | A vault namespace whose records are each ciphertext keeps its record ADDRESSES in the clear (the `sealWhole` pass-through); the namespaces that use that shape address records by opaque ids (private posts: 128-bit random ids after this gate; the Mega pass 2 namespaces: persona-scoped hashes). Counts remain visible (A-CU-3-PER-RECORD-VAULT-ROWS-REVEAL-COUNTS). |
| A-CU-5-ROUTE-ERRORS-ARE-MESSAGES | Device route errors reach the page as messages and the console as text. No route puts key material in a message; the leak greps cover storage and the wire, and the Gate 2 suite now also greps every console line the devices under test printed. |

### Dispositions — every finding, by report and number

| finding | severity | disposition |
|---|---|---|
| 1 #1 / 2 #1 fixture provider is the production social path; KEK public; blob a public GET | CRITICAL | FIXED — D-CU-5-THE-FIXTURE-IS-A-RIG-ADAPTER; hashed subject ids; the picker says "no social login is configured" without a provider; the boot contract refuses the flag on a public deployment (cu4 check 7). |
| 2 #2 `window.__layersDevice` publishes every secret to any script on the origin | CRITICAL | FIXED for the debug accessors (D-CU-5-DEBUG-MEMBERS-EXIST-ONLY-ON-THE-RIG); the operational surface stays the page's: A-CU-5-THE-PAGE-IS-THE-DEVICE, CSP in Gate 6. |
| 1 #4 / 2 #3 / 2 #4 / 3 #1 / 3 #2 root-link relay holds both rosters in the clear, unauthenticated; the co-signature does not cover them | CRITICAL / HIGH | FIXED — D-CU-5-THE-RELAY-HOLDS-SEALED-ROSTERS (cu3 check 7 greps the relay row mid-exchange for either roster's handles and asserts the fingerprints agree). |
| 1 #5 / 2 #6 / 3 #3 no must-be-set half; `LAYERS_REQUIRE_SIG` checked by nothing | CRITICAL / HIGH | FIXED — D-CU-5-THE-CONTRACT-HAS-A-MUST-BE-SET-HALF (cu4 checks 7 and 8). |
| 1 #3 / 2 #5 / 3 #5 / 3 #10 / 2 #23 the release accepts a caller-supplied key on lookup failure; origin and RP caller-chosen; localhost trusted in production | HIGH / LOW | FIXED — D-CU-5-RELEASE-FAILS-CLOSED. |
| 1 #6 / 2 #7 / 3 #6 / 2 #16 limiters keyed on `X-Forwarded-For`; the anon channel mounted before the limiter | HIGH / MEDIUM | FIXED — D-CU-5-HEADERS-ARE-NOT-ADDRESSES (cu4 check 9). The bucket map is keyed by socket address and swept of idle entries every minute, so it is bounded by live clients. |
| 1 #2 / 2 #9 a device's public key is proof enough to move it | HIGH / MEDIUM | FIXED — D-CU-5-A-DEVICE-MOVES-ONLY-WITH-ITS-KEY. |
| 2 #8 one signed `DELETE /state` deletes every visitor's fixture rows | HIGH | FIXED — the shared fixture rows (anon casts, stakes) are deleted only when the validator runs with the dev hooks; on a public deployment a reset touches the caller's own namespaces. |
| 1 #7 the bundle exports the seed on a one-line call | MEDIUM | FIXED — D-CU-5-DEBUG-MEMBERS-EXIST-ONLY-ON-THE-RIG; `exportPhrase` remains, A-CU-5-THE-PAGE-IS-THE-DEVICE. |
| 1 #8 `smoke.html` ships in production and takes its validator from the query string | MEDIUM | FIXED — the smoke page boots only on a loopback host and refuses elsewhere; Gate 6 excludes it from the public deployment (D-CU-5-THE-SMOKE-PAGE-IS-A-RIG-SURFACE). |
| 1 #9 / 2 #10 / 2 #11 / 2 #12 provider ids squattable; lossy sanitizer collides subjects; the record joins a real-world identifier to the anchor on a public endpoint | MEDIUM | FIXED for the id (sha256 of provider, method and subject) and the projection (no anchor, no subject); squatting is a denial, never a takeover: A-CU-5-PROVIDER-SUBJECT-PROOF. |
| 1 #10 `GET /custody/method/:id` is a subject → anchor oracle | MEDIUM | FIXED — the public projection carries kind, SPKI and alg only. |
| 1 #11 `POST /events` takes an unvalidated count; a seeded root with a NULL anchor is claimable | MEDIUM | FIXED — count is an integer in 1..100; seeded roots carry the anchor `seed` (migration 20 backfills), so no root is anchorless. |
| 1 #12 / 2 #18 any signed stranger revokes any grant, burns any offer, probes any grant id | MEDIUM | FIXED — revocation and the revoked-probe are scoped to the grant's two parties; deleting a link offer needs the approving anchor; `custody:revoke` envelopes. |
| 1 #13 the pseudo-fid is 32 bits of the anchor and `/roots` does not bind it to the caller | MEDIUM | FIXED for the binding (signed; the fid is recomputed from the caller's anchor; 401 unsigned, 403 mismatch); the width: A-CU-5-PSEUDO-FID-IS-32-BITS-OF-THE-ANCHOR. |
| 1 #14 `unsealAny` returns plaintext for a non-vault namespace | MEDIUM | FIXED — the device records which namespaces it has sealed (`sealed-namespaces.json`, itself in the mirrored keystore) and `hydrate()` refuses a plaintext record for any of them. |
| 1 #15 / 2 #21 D-CU-0-3 is not built; the `--device` audit measures a harness page | LOW / MEDIUM | DEFERRED BY DECISION — D-CU-5-THE-ROOT-LAYOUT-MOUNT-IS-GATE-6, A-CU-5-AUDIT-DEVICE-MEASURES-THE-SMOKE-PAGE. |
| 2 #13 the empty-account fork's only signal is an unauthenticated 404; the local mirror is never consulted | MEDIUM | FIXED — a lookup that fails otherwise than 404 throws; a local blob without a record is a loud error (D-CU-5-THE-24-WORDS-ARE-THE-ESCAPE-HATCH); both unlock paths. |
| 2 #14 the envelope signs neither method nor path | MEDIUM | FIXED in part — D-CU-5-ENVELOPES-CARRY-AN-OPERATION-CLASS; the rest A-CU-5-ENVELOPE-BINDS-NAMESPACE-NOT-PATH. |
| 2 #15 everything hinges on `NODE_ENV === "production"` exactly; `ZK_DEV_HOOKS=true` disables it silently | MEDIUM | FIXED for the silence (rig banner at boot on both processes); the definition: A-CU-5-PRODUCTION-IS-NODE_ENV-PRODUCTION. |
| 2 #17 `accept()` installs a linked root without verifying the delegation | MEDIUM | FIXED — the delegation is verified against the anchor the material names before anything is installed. |
| 2 #19 reads that fail silently into falsy defaults, one reporting a save that did not persist | MEDIUM | FIXED — `listMethods` and `readGrants` throw; a save that cannot read the list refuses rather than mislabel; `status()` reports `methodsUnknown` and the page pauses saving; `linked()` presents nothing it could not verify. |
| 2 #20 the 24 words need the validator to still hold the anchor row | MEDIUM | FIXED — D-CU-5-THE-24-WORDS-ARE-THE-ESCAPE-HATCH. |
| 2 #22 the rig gate and the server fall-through are page-settable globals | LOW | A-CU-5-THE-PAGE-IS-THE-DEVICE; the two rig flags are handed to the page by a rig server or the loopback smoke page only. |
| 2 #24 (a) the challenge's spend set is per process | NOTE | A-CU-5-CHALLENGE-REPLAY-PER-INSTANCE. |
| 2 #24 (b) the record's kind and the id's prefix are never cross-checked | NOTE | FIXED — the validator refuses a `pk:` id with a provider kind and a `pv:` id with a passkey kind; `unlockProvider` refuses a record whose kind is not `provider`. |
| 2 #24 (c) `POST /device/auth-anchor` uncapped; `/device/register` scans every anchor | NOTE | FIXED for the scan (the anchor must be named); creation: A-CU-5-ANCHOR-CREATION-IS-OPEN-UNDER-THE-LIMIT. |
| 2 #24 (d) 1000 unauthenticated offers deny device linking to everyone | NOTE | FIXED — five open offers per address, expired offers swept every minute, the global cap stays as a backstop (A-CU-5-TRUST-PROXY qualifies the key). |
| 2 #24 (e) the two-column table overstates the device key | NOTE | FIXED — docs/custody-model.md now says what is stored: the device private key as hex in the storage seam, mirrored as ciphertext under the non-extractable wrapping key, and in the leak grep. |
| 2 #24 (f) "the key cannot be exported by any code" is misleading about use | NOTE | FIXED — the sentence now says the wrapping key's BYTES cannot be exported and any same-origin script can use it (A-CU-5-THE-PAGE-IS-THE-DEVICE). |
| 2 #24 (g) `sealWhole`'s pass-through keeps addresses in the clear | NOTE | A-CU-5-PER-RECORD-NAMESPACES-KEEP-ADDRESSES. |
| 2 #24 (h) a private post id is 48 bits with no collision check | NOTE | FIXED — 128-bit random ids. |
| 2 #24 (i) `rootMaterialForLeakTest()[0]` is a root handle on a linked device and feeds the undo path | NOTE | FIXED — recovery's prior seed is null on a linked device. |
| 2 #24 (j) device route errors return `e.message` to the page | NOTE | A-CU-5-ROUTE-ERRORS-ARE-MESSAGES; the Gate 2 suite greps the console. |
| 3 #4 linking is phished like a device-code flow: no counterpart binding, no statement of what is granted | HIGH | FIXED — D-CU-5-A-LINK-IS-CONFIRMED-ACROSS-DEVICES (cu3 checks 2, 5 and 7 refuse a wrong fingerprint and complete with the right one). |
| 3 #7 a root-link grant can outlive its exchange window | MEDIUM | FIXED — answer and completion refuse an expired row; expired rows are swept; the grant is recorded at completion. |
| 3 #8 the device-link relay discloses the approving anchor and root id to anyone with the code | MEDIUM | FIXED — the public offer projection omits both; the new device learns them from the material it opens. |
| 3 #9 cheap offers deny the linking surface | MEDIUM | FIXED — as 2 #24 (d). |
| 3 #11 challenge replay protection is in memory | LOW | A-CU-5-CHALLENGE-REPLAY-PER-INSTANCE. |
| 3 #12 the validator does not enforce "a wrap-path blob never lands here" | NOTE | FIXED — `PUT /custody/blob/:id` refuses a `passkey-wrap` record. |
| 3 #13 `unwrapSeed`'s AAD is self-referential | NOTE | FIXED — the caller supplies the expected method and the blob must name it. |
| 1 note (a) `/api/recovery` accepts a phrase or passphrase on a production app server | NOTE | FIXED — on a production server (not the browser device) every action that would touch a seed is refused before the body is read; the route is the device's. |
| 1 note (b) `wipe()` does not drain the mirror queue | NOTE | FIXED — the wrapping key is dropped, the queue drained, then the stores cleared. |
| 1 note (c) `linked()` treats an unreachable revocation check as "not revoked" | NOTE | FIXED — the check is a signed read; a link whose check failed is not presented (and not deleted). |
| 1 note (d) `accept()` never verifies the delegation | NOTE | FIXED — as 2 #17. |
| 1 note (e) the link code is a bearer credential for the whole vault | NOTE | FIXED — as 3 #4, plus the per-address offer cap. |
| 1 note (f) `app/api/dev` parses the body before the production guard | NOTE | FIXED — the guard runs first. |

### What was built

Device: `lib/device/custody/provider.ts` (rig-only fixture, hashed subject ids, `providerAvailable`),
`lib/device/custody/index.ts` (fail-closed lookups, local-mirror fork signal, method-bound unwrap, import creates the
anchor), `lib/device/custody/wrap.ts`, `lib/device/custody/methods.ts`, `lib/device/entry.ts` (debug members gated),
`lib/device/linking.ts` (fingerprint, delegation verified before install, `custody:revoke`), `lib/device/rootlink.ts`
(relay v2: sealed rosters, hash-bound signatures, signed reads, `finish`, party-scoped unlink, fail-closed
presentation), `lib/adapters/mock/persist.ts` (device proof header, sealed-namespace ledger), `lib/adapters/mock/store.ts`
(hydrate refuses plaintext for a sealed namespace), `lib/identity/roster.ts`, `lib/identity/deviceKeys.ts`
(`signAsDevice`), `lib/platform/storage.browser.ts` (wipe drains), `lib/private/store.ts` (128-bit ids).
Server: `validator/custody.js` (public projections without anchors, kind/prefix check, wrap-blob refusal, operation-class
envelopes, per-address offer cap and sweeps, root-link relay v2 with grants and party-scoped revocation, expiry on
answer and completion), `validator/server.js` (socket-keyed limiter ahead of the anon channel, device proof on a move,
named anchor required, `/events` bounds, `/roots` bound to the anchor, `DELETE /state` scoped, boot contract with the
rig banner), `validator/migrations.js` (20), `validator/seed.js` (anchor `seed`), `validator/env-contract.js` and
`lib/platform/env-contract.ts` (must-be-set half, fixture flag refused), `lib/custody/release.ts` and the two passkey
routes (fail-closed, config-only origins and RP), `middleware.ts` (TRUST_PROXY), `instrumentation.ts` (rig banner),
`app/api/recovery/route.ts` (refuses on a production server), `app/api/dev/route.ts` (guard first).
Pages: `app/device/page.tsx` (rig flags only from a rig server), `components/device/DeviceApp.tsx` (fingerprints on
both flows, the answer-then-finish root-link flow, "no social login is configured", saving paused when the method
list is unreadable), `public/device/smoke.html` (loopback only). Suites: `scripts/accept-cu3.mjs` (fingerprints,
wrong-fingerprint refusals, the mid-exchange relay grep), `scripts/accept-cu4.mjs` (must-be-set boot checks, the
fixture-flag refusal, the spoofed-header bursts — nine checks), `scripts/accept-cu2.mjs` (console lines join the
leak grep). Docs: `docs/custody-model.md` wording; `.env.production.example` (`TRUST_PROXY`, `CUSTODY_FIXTURE_PROVIDER`).

### Iterations

| iteration | result |
|---|---|
| 1 | **Every device suite failed at the same line, and the failure was the fix's own.** The registration now carries `x-layers-device-proof`; a browser preflights a custom header, the validator's CORS allow-list did not name it, and every bootstrap read as "refused/unreachable" (cu2 0/9, cu3 0/7, smoke 0/10, restart 2/4). One name added to the allow-list. The no-keystore probe failed separately on the new must-be-set half: it inherited `.env.local`'s wallet names and set no `LAYERS_REQUIRE_SIG`, so the public deployment it starts refused to boot — the probe now takes its environment from the contract list itself, so it cannot drift from the contract again. |
| 2 | **cu2 9/9, cu3 7/7, smoke 10/10, restart 5/5; the probe found a `device.json` in the empty keystore.** The bootstrap signs the device proof before the keystore door is reached, and `deviceIdentity()` minted a device key on a production server as readily as anywhere. A production server has no device: creation is now refused there under the keystore's own rule ("the device is the browser"), which the probe's loud-refusal check recognises. Then `test:cu4` 8/9 on the production-shaped pair: the "clean deployment starts" probe refused to boot, correctly, because the suite's own baseline environment did not set `LAYERS_REQUIRE_SIG` — the must-be-set half catching its own suite. The baseline now sets it; 9/9. |
| 3 | **The full legacy suite, and two real contract changes it caught.** The two crypto-pass suites register a device delegation directly and did not name its anchor, which this gate made mandatory (the validator no longer scans every registered anchor to find one that verifies): both now name it, `accept-c3.mjs` deriving the rig root's device-auth key exactly as the keystore does. One rig ordering fault, not a product one: `test:device-restart` kills and restarts both servers with its OWN environment, so every suite after it ran on a pair the harness had not configured — z0's 15-second wait for a re-pinned validator key and z5's prefetch-cadence assertion both failed on a pair with the default cadence. It runs last now. Re-run on the same build: **78 of 79 suites green, 573 checks**, the one failure being the docs site's own historical-pages rule (below). |
| 4 | **The docs site asked for this pass's page, and the convention rolled forward.** `test:m2g8` check 3 requires one pass page per `REPORT-*.md`, full through the pass before the most recent, stubs for the most recent pass and the current one. This pass's report made that list stale: Multi-FID is now two passes back and earned its full page (written from `notes/reports/REPORT-FID.md`, thirty-eight citations), Mega 2 keeps its stub as the most recent closed pass, and the custody pass gets the current-pass stub. The roadmap's counts are derived from those pages, so `docs:generate` and `docs:sync --update` carried the change through. `test:m2g8` 8/8; the legacy suite closes at **79 of 79**. |

**Exit (Gate 5):** three reports in `research/`; every finding fixed or an assumption by id (the table above); the
posture doc's "Custody and topology" section carries the Gate 5 changes; the custody suites, the production-shaped
Gate 4 suite and the full legacy suite are green on the fixed build.

## GATE 6 — The public preview gates (notes/prompts/public-preview-prompt.md Gates 1–6, on the browser topology)

Packaging, hosting and honesty; no new features. The one exit that was impossible when the preview pass halted at
its own Gate 0 — "entering the app from a fresh browser produces a working, independent session" — is asserted here
in production by `npm run smoke:deployed`.

| id | decision |
|---|---|
| D-CU-6-THE-LANDING-IS-STATIC | `/` is the front door and the app moved under it (`/home`). The landing is a server component with no data access — no validator call, no vault read, no persona, no device — so it renders for a visitor with nothing; the Gate 6 suite serves it from a throwaway app pointed at a dead validator and asserts 200. Its mission paragraph is lifted verbatim from the docs' mission page and carries the citation; its status section quotes the two label strings themselves (`lib/zk/labels.ts`) rather than paraphrasing a claim. |
| D-CU-6-THE-APP-GROUP-IS-THE-DEVICE-ON-A-PUBLIC-DEPLOYMENT | D-CU-0-3 lands at the app group: on a PUBLIC deployment every page under `app/(main)` boots the visitor's device (the early bootstrap as a plain script tag, so it runs while the document is still parsing and no client component's `/api/*` fetch can reach the keyless server first). On the RIG the server keeps its seeded keystore and answers the API, because that is what the 79-suite legacy baseline measures — mounting the device there silently re-points every one of those suites at a fresh ephemeral root, which is exactly what the first iteration did. The shipped shape is measured where it ships: `test:cu6` and `npm run smoke:deployed` drive a production-shaped pair with the device mounted. |
| D-CU-6-THE-BANNER-ASKS-THE-DEVICE | The preview banner on every app page renders the label the device in that page computed (`privacyConditions`, the machine-checked conditions of `lib/zk/privacy.ts`), never a constant; a verdict that could not be computed renders as NOT private. Dismissible per session, as the prompt asks; the in-app zk label stays non-dismissable. |
| D-CU-6-A-429-MEANS-LATER | A rate-limit refusal is the one refusal that means "try again", and booting a device is a burst of a dozen signed writes — so the device waits the `Retry-After` the validator names, up to four times, and then fails LOUDLY as before. It defers; it never fails open. Found by running Gate 6 straight after Gate 4's burst tests, where a visitor's first page load could not boot at all. |
| D-CU-6-THE-ROSTER-IS-THE-KEYSTORE'S | The device's session reads the keystore's persona list on every request rather than the snapshot taken at boot. A fork answered 200 and then appeared nowhere, because the device viewer's id list was written once at boot; `npm run smoke:deployed` caught it against a production-shaped pair before any deployment existed. |
| D-CU-6-THE-DIAGNOSTIC-IS-REFUSED-TOO | `/api/dev/live` is refused on a public deployment, like `/api/dev`. The environment contract already keeps a live key off such a deployment, so the route was inert — but "inert because another rule holds" is weaker than "refused", and this one performs a real network read whenever a key exists. The Gate 4 audit's expectation moved with it (403, or no key on a rig). |
| D-CU-6-RAILWAY-FOR-BOTH-SERVICES | One platform for both: a persistent volume for the validator's SQLite database, a long-lived Node process for each (so the per-instance rate budget and the wrap-path challenge set behave as designed, and a boot refusal is a failed deploy rather than a stream of function errors), and the one hosting account already authenticated on this machine. Priced before provisioning and measured after: the workspace's estimated monthly bill moved by cents, and no single service approaches the $20/month line the prompt reserves for the owner, so nothing stopped. |
| D-CU-6-DEPLOYS-ARE-PUSHED-NOT-PULLED | Deploys are `railway up` from a checkout; no service is connected to GitHub, so no commit — docs-only or otherwise — triggers a build by itself. `railway.toml` records the watch patterns that exclude `docs/**`, root `*.md` and `.gitbook/**` for the day a service is connected, and the Gate 6 suite asserts they are there. |
| D-CU-6-NO-GITHUB-PUSH-THIS-PASS | The repository has no remote. GitBook Git Sync needs one, and so would a git-triggered deploy; publishing the codebase — even privately — is the owner's call, made when they connect GitBook. Everything on the repo side is in place: `.gitbook.yaml`, a merge-only `docs:summary`, `docs/notes/` as the owner's own section, and `notes/runbooks/CONNECTING-GITBOOK.md` with the connection steps and the README warning. The more conservative option, written down. |
| D-CU-6-TRUST-PROXY-ON-THE-PLATFORM | `TRUST_PROXY=true` on both deployed services: the platform's edge terminates every public request and sets `X-Forwarded-For`, and the services are reachable only through it. A-CU-5-TRUST-PROXY is answered for this deployment; it stays unset everywhere else. |
| D-CU-6-THE-KILL-SWITCH-IS-AN-ENVIRONMENT-FLAG | `LAYERS_MAINTENANCE=true` serves a static 503 with `Retry-After` on every route but liveness, on both processes, with no rebuild. The flag is read at request time (the dynamic key defeats the bundler's build-time inlining). Measured on the deployment, and worth writing down because it cost a wrong first attempt: on this platform a running container keeps the environment it started with, so SETTING the variable takes effect by itself (the platform redeploys the same image) while CLEARING it needs `railway redeploy` — a restart alone reuses the old snapshot and the service stays in maintenance. |
| D-CU-6-CAPS-ARE-COUNTED-WHERE-THE-STATE-IS | In the browser topology a stranger's cost lands on the validator, so the caps live there: new identities per address per day, signed writes per device per hour, both configurable, both a `429` with a sentence, never a queue, rig-exempt. Personas and casts are bounded through the write budget, since each mint or cast is at least one signed namespace write. Nothing spend-capable is reachable on a public deployment, so the "global daily ceiling on anything that could cost money" is the environment contract's own refusal. The caps and the limiter log ONE aggregate line per burst — counts only, never an address, never an id. |

### What was built

`app/page.tsx` + `components/landing/Landing.tsx` (the front door), `components/PreviewBanner.tsx`,
`components/device/DeviceHostMount.tsx` mounted by `app/(main)/layout.tsx`, `lib/zk/labels.ts`,
`lib/platform/preview.ts` (the docs URL, read at request time); `middleware.ts` and `validator/server.js`
(maintenance), `validator/caps.js` (the caps), `validator/backup.js` + `scripts/validator-restore.mjs` (scheduled
`VACUUM INTO` dumps and a checked restore), `lib/adapters/mock/persist.ts` (the 429 retry),
`lib/device/shims/session.ts` (the live roster), `app/api/dev/live/route.ts` (refused on a public deployment);
`Dockerfile.validator`, `.dockerignore`, `railway.toml`, `.node-version`; `.gitbook.yaml`, `docs/SUMMARY.md`,
`docs/notes/`, `scripts/docs-summary.mjs` (`npm run docs:summary`, merge-only), `notes/runbooks/CONNECTING-GITBOOK.md`;
`TESTING.md`; `scripts/smoke-deployed.mjs` (`npm run smoke:deployed`, eight checks against deployed URLs) and
`scripts/accept-cu6.mjs` (`npm run test:cu6`, ten checks against a production-shaped pair);
`.env.production.example` gains the docs URL, the proxy flag, the kill switch and the cap and backup knobs;
`npm run build:preview` builds the device bundle before `next build`, because that bundle is a build artifact and
is not tracked.

### What was provisioned, and what it costs

| | |
|---|---|
| app | `https://app-production-15c4.up.railway.app` — the Next server, built with `npm run build` (which now produces the browser device bundle first), started with `npm run start` on the port the platform assigns |
| validator | `https://validator-production-db6b.up.railway.app` — the container from `Dockerfile.validator`, run under the supervisor, with a 1 GB volume at `/data` holding `layers.db`, `deaths.log` and `backups/` |
| project | `layers-preview` in the owner's existing workspace, alongside one unrelated project |
| commit deployed | `3a0cc6a`, reported by both services in their signed health payloads (`LAYERS_COMMIT`, because a deployed build carries no `.git`) |
| docs | not connected — the repository has no remote (D-CU-6-NO-GITHUB-PUSH-THIS-PASS); `NEXT_PUBLIC_DOCS_URL` is unset, so the landing page renders no docs door |
| custom domain | not taken — the platform's own subdomains, because the domain choice is the owner's (the prompt reserves it) and `APP_URL` must move with it: the WebAuthn RP id derives from that host, so a passkey saved under one host will not unlock under another |

**Cost.** The workspace was already billing for an unrelated project: $6.62 used, $8.19 estimated for the period, when
the preview was provisioned. After the first hours of both services running the workspace reads $6.65 used and $8.20
estimated — a few cents an hour for the pair, which is single-digit dollars a month on top of the $5 plan the owner
already pays. **No single service is anywhere near the prompt's $20/month line, so the reserved spend question was
not triggered.** There is no hard limit set on the workspace; `railway delete --yes` from the repo removes the
project and every charge with it, and the runbook above recreates it from nothing in about ten minutes.

### What was verified against the deployment

| check | result |
|---|---|
| the landing page renders cold | 200, 12 KB, no device, with the honest status section |
| the app boots a device in an empty profile and the banner names a computed label | root minted in the browser, banner `demo` |
| a persona can be created, a post round-trips | both, in the device |
| both processes answer the SIGNED Layers health payload | yes, and the app names the deployed validator as its peer |
| dev routes refused, unsigned reputation event refused | `/api/dev`, `/api/dev/live`, the validator's dev reset and `GET /state` all refused; an unsigned `POST /events` for a real root of ours answers 401 |
| **two independent browser profiles get two independent roots** | **yes — the exit that was impossible when the preview pass halted at its own Gate 0, now true in production** |
| the validator's data survives a redeploy | the same roots before and after a full image rebuild and redeploy; the volume also holds the scheduled backups (`VACUUM INTO` at boot + every six hours, newest 28 kept) |
| the kill switch | `LAYERS_MAINTENANCE=true` on each service: every route but liveness answered 503 with the static maintenance page; cleared and redeployed, both recovered |
| rollback | the app was deployed from a worktree of the previous commit (`0d2e254`) and the change was visible on the live URL — the root path went back to redirecting and the landing page disappeared — then rolled forward to `3a0cc6a` again. The CLI has no "redeploy deployment id" verb, so the documented path is a deploy from a checkout of the target commit, which is what was exercised. |
| the secrets audit, against the built output | clean (`node scripts/audit-secrets.mjs`, run inside `test:cu4` every time), and the one server secret (`CUSTODY_RELEASE_SECRET`) was generated on the machine and piped to the platform without passing through a command line or a log |

### The runbook: provisioning this preview from nothing

Prerequisites: the Railway CLI logged in (`railway whoami`), this repo checked out, `npm ci` done.
Nothing here needs a git remote: `railway up` uploads the working directory, honouring `.gitignore`
(so `.env.local`, `.keystore/`, the database and the built bundles never leave the machine) and
`.dockerignore` for the validator's image.

## 1. The project

    railway init --name layers-preview --json

## 2. The validator (stateful: SQLite on a volume, supervised, backed up)

    railway add --service validator --json
    railway volume add --service validator --mount-path /data --json
    railway domain --service validator --port 4001 --json          # → VALIDATOR_PUBLIC_URL

    railway variable set --service validator --skip-deploys \
      RAILWAY_DOCKERFILE_PATH=Dockerfile.validator \
      NODE_ENV=production \
      LAYERS_REQUIRE_SIG=true \
      TRUST_PROXY=true \
      LAYERS_VALIDATOR_PORT=4001 \
      VALIDATOR_DB=/data/layers.db \
      VALIDATOR_DEATHS_LOG=/data/deaths.log \
      VALIDATOR_BACKUP_DIR=/data/backups

    railway up --service validator --ci

The image runs `scripts/validator-supervisor.mjs`, which restarts the validator on any exit and
appends the cause to `/data/deaths.log`. Migrations run on boot. Backups: one `VACUUM INTO` dump
every six hours into `/data/backups`, newest 28 kept.

## 3. The app (stateless: it holds no identity)

    railway add --service app --json
    railway domain --service app --port 3001 --json                # → APP_PUBLIC_URL

    railway variable set --service app --skip-deploys \
      NODE_ENV=production \
      LAYERS_REQUIRE_SIG=true \
      TRUST_PROXY=true \
      LAYERS_APP_PORT=3001 \
      APP_URL=<APP_PUBLIC_URL> \
      VALIDATOR_URL=<VALIDATOR_PUBLIC_URL> \
      NEXT_PUBLIC_VALIDATOR_URL=<VALIDATOR_PUBLIC_URL> \
      ZK_MODE=fixture \
      CUSTODY_PROVIDER=fixture

    # the app server's one secret, piped so it never appears in a command line or a log
    Get-Content <file> | railway variable set --service app --stdin CUSTODY_RELEASE_SECRET

    railway up --service app --ci

`railway.toml` sets the app's build command to `npm run build:preview`, which builds the browser
device bundle (`public/device/device.js`, a build artifact and not tracked) before `next build`.

Deliberately NOT set on either service: every name on the must-not-ship list. The boot check on
both processes exits 78 if one of them is present, or if `LAYERS_REQUIRE_SIG` is not `true`.

## 4. Verify

    node scripts/lib/health-probe.mjs <VALIDATOR_PUBLIC_URL> layers-validator
    node scripts/lib/health-probe.mjs <APP_PUBLIC_URL> layers --peer=<VALIDATOR_PUBLIC_URL>
    BASE_URL=<APP_PUBLIC_URL> VALIDATOR_URL=<VALIDATOR_PUBLIC_URL> npm run smoke:deployed

## 5. The kill switch, and rollback

A running container keeps the environment it started with. SETTING the variable is enough (the platform redeploys
the same image by itself); CLEARING it needs an explicit redeploy — `railway restart` reuses the old snapshot and
the service stays in maintenance. Neither path rebuilds.

    railway variable set --service app LAYERS_MAINTENANCE=true          # static 503 within ~a minute
    railway variable set --service validator LAYERS_MAINTENANCE=true

    railway variable delete --service app LAYERS_MAINTENANCE
    railway variable delete --service validator LAYERS_MAINTENANCE
    railway redeploy --service app --yes                                # required: picks up the cleared variable
    railway redeploy --service validator --yes

    railway deployment list --service app --json                        # pick the previous id
    railway redeploy --service app --yes                                # redeploy the current one
    railway down --service app --yes                                    # remove the newest deployment

## 6. Teardown (stops all charges from this project)

    railway delete --yes

### Iterations

| iteration | result |
|---|---|
| 1 | **Mounting the device on every app page re-pointed the legacy suites at a fresh identity.** With the device host in the app group, `/api/*` on an app page is answered by the browser's own device — which is the whole point on a public deployment, and exactly wrong on the rig, where 79 suites drive the UI against the server's seeded state. `test:ux0` lost its toggle and `test:m2g3` lost the binding picker and the calibration pane, because both were acting on an empty ephemeral root. The mount and the banner are now gated on `isPublicDeployment()` (D-CU-6-THE-APP-GROUP-IS-THE-DEVICE-ON-A-PUBLIC-DEPLOYMENT); both suites green again on the re-run, custody suites unchanged. |
| 2 | **`test:cu6` 5/10 on its first run, five distinct causes, four of them real.** `docs/notes/` did not exist, so the owner-page check had nowhere to write (the section now exists, with its own index page); `tsconfig` did not exclude `docs/`, so the build-isolation check was asserting something the config did not say (it does now); the caps module logged its aggregate only on a one-minute timer, so a burst was invisible for a minute (the first refusal now schedules the line a second later); `/api/dev/live` answered 200 on a public deployment (refused now, D-CU-6-THE-DIAGNOSTIC-IS-REFUSED-TOO); and — the one that mattered — a fork answered 200 and then appeared in no roster, because the device viewer's persona list was a boot-time snapshot (D-CU-6-THE-ROSTER-IS-THE-KEYSTORE'S). |
| 3 | **7/10, and two of the three were the suite's own bugs.** The summary-merge check compared arrays including their trailing blank line, so an append at the end read as a change above it; the deployed smoke posted an unsigned reputation event with a body the validator rejects on shape before it ever reaches the signature check, so the refusal it asserted was the wrong one — it now names a real root of its own and a real event kind, and asserts the 401. The third, the banner stuck on "computing", survived: run alone the suite was 10/10, so the failure was something the previous suite left behind. |
| 4 | **Instrumented rather than guessed, and the answer was a product finding.** The banner check now waits on the device's own `ready` and reports what the page printed: *"device boot failed: vault flush of grantsV3 was refused by the validator: HTTP 429"*. Booting a device is a burst of a dozen signed writes, and Gate 4's burst tests leave the validator's per-address budget empty — so a visitor arriving at that moment could not get an identity at all. Two fixes: the device waits the `Retry-After` the validator names, bounded to four attempts, then fails loudly as before (D-CU-6-A-429-MEANS-LATER); and the suite's preflight now fires a small burst and requires every answer clean, because one non-429 answer only proves one token. It is also the sharpest illustration of A-CU-5-TRUST-PROXY: behind a proxy with the flag unset, every visitor shares one budget and onboarding is the first thing that breaks. |
| 5 | **`test:cu6` 10/10 and `test:cu4` 9/9 back to back, and the legacy list green — with one suite reading a page that no longer exists.** Moving the app to `/home` broke `test:m2`'s forward-pointer check, which fetched `/` as the timeline; worse, two of its other checks had been passing VACUOUSLY the moment the landing page replaced the feed, because "no leak on this page" is trivially true of a page with no posts. All three now read `/home`. Final: 79 of 79 suites. |
| 6 | **The deployment, and three things only a real host could have found.** (a) The platform's manifest lists every tracked file and resolves content through `.dockerignore`, so excluding `research/` there — harmless for the validator's image, which copies what it needs explicitly — made the APP's build fail on a file it never used (`"/research/poc/package.json": not found`). (b) The browser device bundle is a build artifact and is not tracked, and the platform ran the plain build, so the deployed app served a 404 for its own device and no page could boot one: `npm run build` now produces the bundle first, and esbuild is a declared dev dependency rather than a transitive one. (c) A deployed image carries no `.git`, so both services reported an unknown commit until the deploy started naming it. Then: the kill switch on both services, a rollback to the previous commit visible on the live URL and a roll forward again, the validator's data intact across a full image rebuild, and `npm run smoke:deployed` 8/8 — including two browser profiles getting two independent identities, which is the exit the preview pass could not meet when it halted. |

## /verify — the closing bar

**The bar (from the prompt):** the full legacy suite green at the current baseline; the readiness
audit re-run with all five findings PASS and its output committed; leak greps every iteration;
restart survival with browser-held state; total-device-loss recovery by each path; `live-cu2` once;
three attack reports before Gate 6; and finally four consecutive clean sweeps on identical code with
`tsc` strict and the production build clean, all committed.

| item | result |
|---|---|
| full legacy suite at the baseline | **585 checks over 78 suites**, four times. The Mega pass 2 baseline (550 / 73) plus this pass's five rig-runnable custody suites: `test:cu2` 9, `test:cu3` 7, `test:device` 10, `test:no-keystore` 3, `test:device-restart` 5. |
| the two suites that cannot run on the rig | `test:cu4` (9) and `test:cu6` (10) refuse on a rig by design — they measure a PRODUCTION-SHAPED pair with the dev hooks off — and were run separately against `att-run-prod.sh` on the closing commit. |
| readiness audit re-run | driven through the page against the production-shaped pair inside `test:cu4`; every finding flipped; the JSON committed under `shots/`. |
| leak greps | every iteration and every sweep: the validator's whole database, both process logs, the envelope on the wire, and — added this pass — every line the browser device printed to its console. |
| restart survival with browser-held state | `test:device-restart` in every sweep: both servers killed as a process tree and restarted, the device's vault, personas and saved identity intact. |
| total-device-loss recovery by each path | `test:cu2`: the 24 words, the same passkey in a fresh browser context, and the social path on the rig fixture each reproduce the same root, commitment and personas. |
| `live-cu2` once | run, and it REFUSED, which is the honest outcome: no real custody provider is installed in this tree (A-CU-2-REAL-PROVIDER-NOT-EXERCISED). A green run would have been a lie and the script says so itself. |
| three attack reports | `research/attack-custody-{1,2,3}.md`, written before Gate 6 opened; 52 findings, every one fixed or an assumption by id (the Gate 5 dispositions table). |
| four consecutive clean sweeps | **MET on `7e621ba`** — see notes/reports/SWEEP-STATUS.md for the series, including three attempts at the fourth sweep that measured nothing and are recorded rather than dropped. |
| `tsc` strict / production build | clean on the closing commit. |
| the deployment | `npm run smoke:deployed` 8/8 against the live URLs, with both services reporting the commit they run. |

**What the closing commit adds** beyond `7e621ba`: this section, notes/reports/SWEEP-STATUS.md, notes/runbooks/MORNING.md and the
regenerated audit output. No code — the four sweeps ran on `7e621ba` and that is what the claim
means.

**/verify CLOSED.** Six gates, three adversarial reviews answered, and a preview a stranger can open
that gives them their own identity rather than the owner's. What the pass could not do is named
rather than implied: no real custody provider, no social login on the deployment, no GitBook
connection while the repository has no remote, no content security policy yet, and no server-side
public-only rendering. Each is an assumption or a decision with an id, and notes/runbooks/MORNING.md is the
handover.
