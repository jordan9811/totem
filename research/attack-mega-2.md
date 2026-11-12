# attack-mega-2 — search index sound, action bindings leak

## Verdict

Section 15's search-boundary claim is true as written: I read `collectRecords`,
`ensureIndex`, `unifiedSearch`, the BM25 index, the lexicon embedding, the
worker, and the cloud-consent path end to end, and confirmed independently
(not just by trusting the suite) that no query, snippet, index, embedding or
record set reaches the validator — there is no search route on the validator
at all (grepped `validator/*.js`), `collectRecords` filters every one of its
eight record types by this device's own persona set with no path for another
root's granted content to enter, and the query text travels only through an
in-process `fetch()` from a client component, never a page navigation, so it
never lands in a URL the validator or a shared log could see. **P-MEGA2-SEARCH-NEVER-LEAVES**
and **P-MEGA2-SEARCH-SINGLE-ROOT** hold as stated.

The other half of my focus does not hold up as well. Gate 3 shipped two
per-device/per-persona "habit" records in the same commit and treated them
inconsistently: `scrollZones` was correctly recognized as "a fingerprint of a
hand and a habit" and sealed in the vault (`lib/zones/store.ts`), but the
sibling feature — `actionButtonSlots.cast`, the configurable action-row
binding, plus the `personaId` it is filed under — rides the pre-existing
**plaintext** `modes` namespace straight to the validator's `adapter_state`
table. The operator can read, per persona, in the clear: which persona owns
which mode, and the exact ordered action-binding array that persona's owner
chose. Because the binding reflects a human's habitual layout rather than
the persona's content or identity, a root that (plausibly, and the whole
point of the feature is to let them) reuses one preferred row across two or
more of its personas hands the operator a direct, no-crypto-required
cluster key — and the posture's own §15 says nothing about it. That is the
single worst finding in this focus: not a break in the search boundary, but
an inconsistently-applied fix in the same gate that built a correct one.

## Findings (ordered by severity)

### F1. `actionButtonSlots.cast` (and the rest of `ModeDefinition`) is a plaintext, persona-keyed habit fingerprint the operator can cluster across a root's personas — SEVERITY: HIGH

- **Claim attacked:** unstated in §15 (Gate 3's own entry, `D-MEGA2-3-ZONES-ARE-VAULT-DATA-PER-DEVICE`, states the principle — "a layout is a fingerprint of a hand and a habit; the validator sees ciphertext" — for `scrollZones` only); the pre-existing assumption this new field silently falls under, without being named, is **A-Z2-PLAINTEXT-MOCK-ADDRESSES** ("`modes` values are persona-keyed PLAINTEXT under the device envelope").
- **Where:**
  - `lib/adapters/types.ts:105-116` — `ModeDefinition.personaId: string` and `actionButtonSlots: { composer; nav; cast?: string[] }` on the same record.
  - `lib/vault/vault.ts:44-97` — `VAULT_NAMESPACES` (the sealed-at-rest set): `modes` is not a member.
  - `lib/adapters/mock/store.ts:375,676-687` — `persistNs("modes")` takes the plain-flush branch (`isVaultNamespace(ns)` is false), so the full `ModeDefinition` JSON — `personaId` and `actionButtonSlots.cast` included — is sent unencrypted.
  - `validator/server.js:365-410` — `adapter_state(namespace, key, value, updated_at)` stores `value` as `JSON.stringify(value)` with **no encryption step anywhere in this path**; `GET /state/:namespace` (or the whole-store `GET /state`) returns it verbatim.
  - `app/api/modes/route.ts:31-38` (persona set at create) and `:54-63` (the cast row itself, validated then patched in).
- **How the operator does it:** `SELECT key, value FROM adapter_state WHERE namespace='modes'` (or just read the JSON blob `GET /state` already returns to anyone who can reach the validator's plain state API) yields, per mode, `{personaId, actionButtonSlots:{cast:[...]}, ranking, ruleIds, notificationPolicy, filterPackIds, dmReadwise, lens, ...}` in the clear — one row per mode, `personaId` unhashed. Group rows by `actionButtonSlots.cast` (or by the full habit tuple — ranking weights, rule ids, notification cadence are in the same row) across every persona in the table. Any two personas whose owner set the same non-default row — the natural outcome of the feature, since a human's hand and habit do not change when they switch persona — are a same-root candidate pair, found by one query, no timing or nullifier analysis required. It can be corroborated for free: `envelope_counters(device_id, namespace, counter)` (pre-existing table, `PRIMARY KEY(device_id, namespace)`) independently confirms which `device_id` wrote to both `modes` and `scrollZones`, tying the fingerprint match to a concrete device.
- **Evidence:**
  ```ts
  // lib/adapters/types.ts:105-116
  export interface ModeDefinition {
    id: string;
    personaId: string;
    ...
    actionButtonSlots: { composer: string[]; nav: string[]; cast?: string[] };
  ```
  ```js
  // validator/server.js:385-408 (PUT /state/:namespace)
  for (const [key, value] of Object.entries(entries)) {
    ins.run(ns, key, JSON.stringify(value), now);   // no encryption; value is the raw ModeDefinition
  }
  ```
  ```ts
  // lib/adapters/mock/store.ts:678-686
  if (isVaultNamespace(ns)) {
    await flushVault(ns, encryptNamespace(ns, payload));
  } else {
    await flush(ns, payload);   // "modes" takes this branch
  }
  ```
- **Fix or assumption:** Either (a) move the habit-revealing fields out of the plain `modes` row — seal `actionButtonSlots` (and ideally `ranking`/`ruleIds`, which are the same category of fingerprint and already covered by the older assumption) the way `scrollZones` and `influence` are sealed, keeping only what genuinely needs to be plaintext (e.g. `id`, routing needed by other public surfaces, if any) outside the vault; or (b) if `modes` stays plaintext for this pass, add a named `A-MEGA2-*` assumption to §15 stating plainly that a customized action row is a cross-persona join key, the way the posture already does for `scrollZones` — folding it silently into the older, generic `A-Z2-PLAINTEXT-MOCK-ADDRESSES` line undersells a risk this pass specifically created (a distinctive, user-chosen ordered list from a 14-item vocabulary is much higher-entropy than "the persona set exists").

### F2. `simulateDeviceLoss` does not clear the search index / embed worker / influence / zones in-process caches that `resetSeed` does — SEVERITY: LOW

- **Claim attacked:** unstated — a test-fidelity gap, not a direct operator-visible leak in the product topology (§8: one process is one device, so a real device loss is a fresh process and a genuinely empty `globalThis`).
- **Where:** `app/api/dev/route.ts:183-208` (`simulateDeviceLoss`: deletes the keystore files and the in-memory keystore singleton, resets envelope bootstrap — nothing else) vs. `app/api/dev/route.ts:482-494` (`resetSeed`: explicitly calls `resetUnifiedIndex`, `resetCloudSends`, `resetEmbedWorker`, `resetZonesCache`, `resetInfluenceCache`).
- **How the operator does it:** this is not an operator-side attack — it's a fixture/dev-harness asymmetry. Within the SAME long-running process, simulating total device loss and then recovering (without an intervening `resetSeed`) leaves the OLD unified-search cache, embed-worker state, sealed-record caches for `influence`/`scrollZones` sitting in `globalThis`. `ensureIndex()` self-heals for content correctness (it recomputes `collectRecords()` and only reuses the cached `FullTextIndex` object if the signature matches the fresh record set), so I did not find a way to make this render another identity's private search results. What it does undermine is confidence in the `c4` (total-device-loss recovery) regression's coverage of these four newer namespaces specifically, since a real device loss in production is a process restart and would clear all of this for free.
- **Evidence:**
  ```js
  // app/api/dev/route.ts:183-207 — simulateDeviceLoss
  for (const f of ["root.json", "device.json"]) { try { fs.rmSync(...); } catch {} }
  gk.__layersKeystore = undefined;
  const { resetEnvelopeBootstrap } = await import("@/lib/adapters/mock/persist");
  resetEnvelopeBootstrap();
  return NextResponse.json({ ok: true });   // no resetUnifiedIndex / resetEmbedWorker / resetInfluenceCache / resetZonesCache
  ```
- **Fix or assumption:** add the same four `reset*` calls `resetSeed` makes to `simulateDeviceLoss`, purely so the `c4` suite is testing a from-scratch rebuild of these namespaces rather than relying on the signature check's self-healing to mask the gap.

### F3. The unified index and embed-worker state have no owner key at all — INFO

- **Claim attacked:** none directly; this names, in a new spot, the pre-existing §8 topology assumption ("the client is the Next.js server process... on the user's own device").
- **Where:** `lib/search/unified.ts:80-85` (`g.__layersUnifiedSearch`, one slot for the entire process) and `lib/search/embedWorker.ts:63-72` (`g.__layersEmbedWorker`, likewise).
- **How:** unlike `scrollZones` (keyed by device) or `influence`/`zones` (reloaded fresh from the vault, keyed by the account the validator serves), the unified-search cache and the embed worker are keyed by nothing — there is exactly one instance per Node process, full stop. This is safe only exactly as far as §8's "one process is one user's device" holds. If this pass's search feature were ever pointed at a process that outlives or is shared across more than one identity without a restart (a long-lived multi-tenant host, a serverless container reused across requests for different accounts, or any other violation of §8's assumption), this is the least isolated piece of state this pass added — it has no per-account key to even accidentally get right, whereas the sealed namespaces at least round-trip through account-scoped vault state.
- **Fix or assumption:** none needed beyond restating §8 explicitly for this feature; this is not a new hole, just the sharpest illustration in this pass of what §8 already disclaims.

## What I checked and found sound

- `collectRecords()` (`lib/search/unified.ts:92-159`) walks all eight record types (casts, private posts, DMs, likes, bookmarks, stakes, relationship events, imports) and gates every one of them on `ownSet.has(...)` (this device's own persona ids from `ownPersonaIdsAll()`). I traced each branch; none of them can admit another root's private or grant-disclosed content.
- `postByHash` (`lib/adapters/mock/store.ts:95`) is built only from `SEED_POSTS` (public seed posts), so the "likes"/"bookmarks" branches, which resolve hashes through it, cannot pull in a private post from a persona this device does not own even if that hash were bookmarked/liked.
- No search endpoint exists anywhere on the validator — grepped `validator/*.js` for "search"; the only two hits are an unrelated `URL.searchParams` parse in `anon.js` and a ceremony filename in `zk.js`.
- The BM25 index (`lib/search/index.ts`) and the lexicon embedding (`lib/search/embed.ts`, `lib/search/lexicon.ts`) are pure, dependency-free, and touch nothing outside the process; `lib/search/embedWorker.ts`'s `eval:true` worker exchanges only `{clusters, dims}` (public, static) and `{texts}`/`{vectors}` over the in-process worker message channel — no network, no disk, no `require` beyond `node:worker_threads`.
- The cloud-search consent gate (`unifiedSearch`'s `cloud` branch, `lib/search/unified.ts:228-243`) genuinely refuses to run the (fixture) provider unless `consent.provider/snippets/queryHash` match exactly what was previewed; in this build the "provider" call never leaves the process either way, and the dev hook that would prove it (`cloudSends`) is gated behind `ZK_DEV_HOOKS` like every other dev action (A-DEV-SURFACE's existing category — this pass does not widen it).
- The query text reaches the app only via `fetch()` from the client component `UnifiedSearch.tsx:44-45` — not a page navigation and not `searchParams` — so it never lands in the browser's address bar or any URL beyond the pre-existing, unrelated public-search `?q=` on `/search` (which predates this pass).
- `scrollZones`'s device key (`thisDeviceKey()` = `deviceAuthPublicKey()`) is already sent to the validator in the clear during device-envelope bootstrap (`lib/adapters/mock/persist.ts:195-202`, `POST /device/auth-anchor`) for every device-authenticated write that exists in this codebase; using the same value as an (encrypted, invisible-to-the-operator) internal map key inside the sealed `scrollZones` record adds no new plaintext exposure.
- The 1 KiB padding step in `saveZoneConfigForThisDevice`/`allowanceForTier`'s sibling in `lib/zones/store.ts:59-61` keeps a single device's zone record at a constant ciphertext size regardless of content — I computed worst-case size (8 zones, the maximum, all fields populated) and it stays comfortably under 1024 bytes, so save timing/size does not distinguish one calibration from another for the common one-device case; only accumulating many additional device entries in the same sealed doc would step the bucket, at coarse KiB granularity — the same accepted trade-off already used by `influence`.
- `hitTest` (`app/api/zones/route.ts:41-47`) returns only the resolved `target` enum ("timeline"/"longform"), never the underlying rectangle coordinates, so it cannot be used to reconstruct a device's saved zone layout through an external oracle even if reachable from outside the topology's assumed single-user boundary.

## Assumptions I had to make

- I did not run the app, the validator, or any suite (per instructions); every claim above rests on static reading of the code at `HEAD` against the diff since `d9105d5`.
- I treated the mock/fixture adapter (`lib/adapters/mock/*`, `validator/server.js`'s `adapter_state` table) as the stand-in for "the validator" the brief means, consistent with how the pass's own suites (`accept-mega2-g*.mjs`) read the same tables to make their assertions.
- I read `§8`'s topology ("one Next.js process is one user's device") as the operating assumption when judging `deviceAuthPublicKey()` and `envelope_counters` — I did not attempt to model a hypothetical multi-tenant hosting deployment beyond naming it in F3.
- For F1's severity, I weighed it as HIGH rather than CRITICAL because the join requires one plausible extra condition beyond the code path itself: the human must have set a non-default, matching binding on two or more personas (the untouched-default case gives every persona of every root the same value and yields no signal). Given the feature exists specifically so users customize it, and habit is not persona-specific, I judge this condition very likely to hold in real usage, but it is not guaranteed by the code alone the way, e.g., a hardcoded shared secret would be.
