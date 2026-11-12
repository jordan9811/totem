# Totem Validator — API Contract v1

Trusted validator service for the Totem persona + reputation layer.
Runs locally on `http://localhost:4000`. Express + SQLite.

**This contract is the seam.** Phase 2 replaces the *implementation* with a
ZK validator (mapping held client-side, rep proven with range/percentile
proofs, blocks enforced via nullifiers). The HTTP surface below must not
change when that swap happens. Nothing in the client may compute reputation,
resolve persona→root mappings, or expand blocks locally — the client only
consumes these endpoints.

## Phase-1 trust compromises (stated plainly)

1. **The validator sees the root→persona mapping.** Anyone with DB access
   can deanonymize every persona. Phase 2 moves the mapping into a
   client-held witness; the validator only verifies proofs.
2. **Rep events are trusted, not proven.** The validator polls Neynar and
   writes rep events on its own authority. Phase 2 replaces this with
   attested event inclusion proofs.
3. **Block fan-out reveals linkage timing.** When a root is blocked, all its
   personas vanish from the blocker's feeds simultaneously — an observer
   controlling a blocker account can correlate personas. Documented,
   accepted for phase 1.

## Concepts

- **Root**: one underlying Farcaster identity = one signer (fid +
  signer_uuid). Rep and blocks live at root level.
- **Persona**: a display identity (name, handle, avatar, bio) owned by a
  root. Casts publish to Farcaster under the root's signer; the client
  renders the persona identity. A root has 1..N personas.
- **Tier**: percentile decile 1–10 of the root's rep score across all known
  roots. Raw scores are never exposed. All personas of a root share a tier.

## Authentication

None in phase 1 (localhost, trusted). Phase 2: proof-carrying requests.

## Endpoints

All bodies are JSON. Errors: `{ "error": string }` with 4xx/5xx.

### GET /health
→ `200 { "ok": true, "app": "layers-validator", "commit", "buildId": null, "startedAt", "uptime", "port", "pid", "personas": n, "roots": n, "pubkey", "sig" }`
— the SIGNED liveness contract (Attestation pass Gate 0): `sig` is the
validator key's Ed25519 signature over
`layers-health/1|app|commit|buildId|startedAt|uptime|port|pid`. The sweep
runner accepts only this payload, verified, with `pubkey` equal to
`GET /zk/validator-key`; anything else on the port is DOWN.

### The open issuer interface (Attestation pass Gate 1) — `/zk/issuers`, `/zk/attest`
Anyone can be an issuer. `POST /zk/issuers` registers (open, self-signed
under the issuer's Ed25519 key: `layers-zk-issuer/1|mode|id|displayName|sha256(claimSchema)|buckets,…|validityEpochs|pubkey`); the same id under
another key is 409 — a key rotation is a new id. `GET /zk/issuers` lists
ids, schemas, buckets, validity and keys. `POST /zk/attest` takes one or a
batch of ISSUER-signed issuances (`layers-zk-attest/2|mode|issuer|bucket|commitment|claimHash|issuedEpoch|expiresEpoch`): verified under the
registered key, the bucket must be one the issuer declared, the expiry must
be exactly `issuedEpoch + 1 + validityEpochs` (quantized, never
per-subject), the commitment must be registered; the leaf enters
`attest:<issuer>/<bucket>` from the NEXT epoch. `POST /zk/attest/revoke`
(issuer-signed) drops one issuance at the next epoch. `GET /zk/attest/buckets` is the per-bucket census
for the epoch. `GET /zk/attested` and
`GET /zk/attested-map` (gated like eligibility) say what a persona has
PROVEN, by issuer and bucket. **What the validator learns:** issuer I
vouched for commitment C under bucket B from epoch E until X — the coarse
bucket, never the claim value (the hash is over a nonce-salted claim held
in the subject's vault) and never a wallet.

### POST /roots
Registers a root identity (called on signer connect).
Body: `{ "fid": number, "signerUuid": string }`
→ `201 { "rootId": string }` — idempotent on `signerUuid`
  (returns 200 + existing rootId if already registered).

### POST /personas
Body: `{ "name": string, "handle": string,
        "avatarUrl": string|null, "bio": string|null }`
→ `201 { "persona": Persona }`
`Persona = { id, name, handle, avatarUrl, bio, createdAt }`
409 if handle taken. Handle rules: `^[A-Za-z0-9_]{1,15}# Totem Validator — API Contract v1

Trusted validator service for the Totem persona + reputation layer.
Runs locally on `http://localhost:4000`. Express + SQLite.

**This contract is the seam.** Phase 2 replaces the *implementation* with a
ZK validator (mapping held client-side, rep proven with range/percentile
proofs, blocks enforced via nullifiers). The HTTP surface below must not
change when that swap happens. Nothing in the client may compute reputation,
resolve persona→root mappings, or expand blocks locally — the client only
consumes these endpoints.

## Phase-1 trust compromises (stated plainly)

1. **The validator sees the root→persona mapping.** Anyone with DB access
   can deanonymize every persona. Phase 2 moves the mapping into a
   client-held witness; the validator only verifies proofs.
2. **Rep events are trusted, not proven.** The validator polls Neynar and
   writes rep events on its own authority. Phase 2 replaces this with
   attested event inclusion proofs.
3. **Block fan-out reveals linkage timing.** When a root is blocked, all its
   personas vanish from the blocker's feeds simultaneously — an observer
   controlling a blocker account can correlate personas. Documented,
   accepted for phase 1.

## Concepts

- **Root**: one underlying Farcaster identity = one signer (fid +
  signer_uuid). Rep and blocks live at root level.
- **Persona**: a display identity (name, handle, avatar, bio) owned by a
  root. Casts publish to Farcaster under the root's signer; the client
  renders the persona identity. A root has 1..N personas.
- **Tier**: percentile decile 1–10 of the root's rep score across all known
  roots. Raw scores are never exposed. All personas of a root share a tier.

## Authentication

None in phase 1 (localhost, trusted). Phase 2: proof-carrying requests.

## Endpoints

All bodies are JSON. Errors: `{ "error": string }` with 4xx/5xx.

### GET /health
→ `200 { "ok": true, "personas": n, "roots": n }`

### POST /roots
Registers a root identity (called on signer connect).
Body: `{ "fid": number, "signerUuid": string }`
→ `201 { "rootId": string }` — idempotent on `signerUuid`
  (returns 200 + existing rootId if already registered).

.
**ZK Pass 2 (migration 006):** a persona is created WITHOUT a root. A
`rootId` in the body is refused (400). Which account made it is the
device's knowledge (its roster), never the validator's.

### GET /personas/root/:rootId
→ `410` — GONE (migration 006). The validator has no table that groups
personas by root; the account switcher is answered from the device roster.

### GET /personas/:personaId
→ `200 { "persona": Persona }` / 404.

### GET /personas/by-fid/:fid
→ `410` — GONE (migration 006). The validator does not know which
personas an account has. The client re-skins its OWN casts by the
`layers:persona:<id>` marker (resolved by id) and its own accounts from
the device roster.

### GET /rep/:personaId
→ `410` — GONE (migration 006): tier by persona needed the persona → root
join. Reputation is asked by ROOT handle (`GET /rep/root/:rootId/tier`,
the account's own) or PROVEN through the zk binding.

### POST /events
Rep event ingest (called by the internal Neynar poller; exposed so tests
can drive accrual deterministically).
Body: `{ "rootId": string, "type": "cast_created"|"like_received"|
        "recast_received"|"reply_received"|"follow_gained",
        "count": number (default 1), "sourceId": string|null }`
`sourceId` dedupes (same sourceId+type is a no-op).
→ `201 { "ok": true, "score": number }` (score returned here is internal;
only tests read it — the client never calls /events).

### GET /rep/root/:rootId/tier
→ `200 { "tier": number }` — the root's own tier, for the device that
holds the root handle (and for tests).

### POST /block
Body: `{ "blockerPersona": string, "blockedPersona": string }`
Records a PERSONA-LEVEL block (migration 006: `blocks_v2`).
→ `201 { "ok": true, "fanout": "persona-level only" }` — idempotent.
404 on unknown persona. Root-level fan-out ("block one, block all their
personas") is GONE by design: it needed persona → root. The device shares
a block across its OWN personas at read time (it knows them; it writes ONE
row per block action); nothing can reach a blocked account's other
personas. See SECURITY-POSTURE.md, "What zk
cost us: root-level block fan-out".

### GET /blocked/:personaId
→ `200 { "personaIds": string[], "fanout": "persona-level only" }` —
exactly the personas THIS persona blocked. The client filters all feeds
against this list.

### Migration 006 — rollback
`node validator/export-roster.js <out.json>` (run ONCE, on the pre-006
database, before the first boot on a 006 build) writes the device-side
roster; `node validator/migrate-down.js <roster.json> [db] [--orphans=quarantine]`
restores `personas.root_id` from it (refusing an incomplete roster
unless told to quarantine the unattributable personas — moved, never
deleted, to `personas_orphaned_on_rollback`). Root-level block rows are
kept in `blocks_legacy_export` for that rollback and read by nothing else.

## Client policy (documented here, enforced client-side)

- Discovery surfaces (For You, search, trends, who-to-follow) filter out
  tier-1 personas. Following feed is unfiltered.
- All feeds filter out `GET /blocked/:activePersona` results.
- Tier badge next to handles renders the PROVEN tier under zk (or "not
  proven"); under the legacy binding, the device's own roots' tiers via
  `GET /rep/root/:rootId/tier`.

## Rep model (implementation detail, NOT part of the contract)

score = Σ weights: cast_created=1, reply_received=2, like_received=2,
recast_received=3, follow_gained=5. An account with NO rep is tier 1 by
definition; percentile deciles are computed over the accounts WITH rep
(synthetic population seeded so deciles are meaningful in dev).
Tier = ceil(percentile × 10), clamped 1–10. Ties resolve upward.

## Persona launch, wave 2 (built, test data only, deployed 2026-10-12)

The routes and fields this wave adds. Fixture universe only where it says so; the code is the contract
(`validator/ringdrop.js`, `validator/registrar.js`, `validator/simchain.js`, `validator/zk.js`), and
`SECURITY-POSTURE.md` §24 to §26 say what each party learns.

**The ring drop (`validator/ringdrop.js`, migration 23).**

- `PUT /rings/drop/batch` — device-signed (the envelope over the JSON body, namespace `rings:drop`; unsigned or badly
  signed is refused whatever `LAYERS_REQUIRE_SIG` says). Body `{rows: [{id, enc, ct, hint, expiresHour, delHash}],
  deletes: [token]}`: rows a multiple of 4, at most `RING_DROP_MAX_ROWS_PER_WRITE` (28); `ct` exactly 8,224 hex;
  `expiresHour` within the 72-hour lease plus 2 hours of clock slack; an existing id is 409; a full table
  (`RING_DROP_MAX_ROWS`, 4,096) is 413; per device `RING_DROP_WRITES_PER_HOUR` (120) writes and `RING_DROP_ROWS_PER_HOUR`
  (2,048) rows an hour and `RING_DROP_MAX_LIVE_PER_DEVICE` (1,024) live rows, per address `RING_DROP_MAX_LIVE_PER_ADDRESS`
  (2,048) live rows, each a 429 with Retry-After, counted in memory. Inserts and deletes in one transaction.
- `GET /rings/drop` — open, no-store: every live row, crypto-shuffled, each exactly `{id, enc, ct, hint, expiresHour}`,
  with `count` and `nowHour`.
- `POST /rings/dev/reset` — dev hooks only.

**Anonymous posts (`validator/zk.js`).**

- `GET /zk/anon-casts` now also serves, per row: `tree` (the tree the post proved), `treeSize` (that tree's frozen size
  at the post's epoch, migration 24), `note` (the 256-byte ring note, 512 hex) and `attributedBatch` (the launch batch
  reveal that attributed it, else null).
- `GET /zk/anon-post/config` serves `reachIssuers`: the reach issuers an anon post may prove (`ZK_ANON_REACH_ISSUERS`,
  default `fc.reach,x.reach`; `none` for none). A reach tree under `ZK_REACH_FLOOR` (default 50, never below
  `ZK_ANON_FLOOR`) is refused before any nullifier.
- An anon-post proof's message binds `note:<sha256(note)>` after the attribution commitment.
- Claim kind `persona-launch` on `/zk/anon/submit`: one launch per person per window; the registrar queues the request
  inside the nullifier's transaction.
- `POST /zk/anon/reveal {batch: true, …}` is the registrar's batch reveal: all or nothing, the signer an active key of
  the fid on the simulated KeyRegistry. A missing registrar is a refusal, never a single-post fallback.

**The simulated registrar and chain (`validator/registrar.js`, `validator/simchain.js`, migration 25; fixture only, no
live mode, $0).**

- `GET /registrar/config`, `GET /registrar/registrations` (each account's custody, recovery, fid, hour and active signer
  keys; every device reads it every tick), `GET /registrar/anon-casts` (the complete public anon list, paged by
  `sinceHour`, `attributedFid` and a `before` cursor; every device reads it every tick), `GET /registrar/reveal-batches`.
  No arrival hour is stored.
- `GET /sim-chain/fid`, `GET /sim-chain/keys`, `GET /sim-chain/fname/:name`, `POST /sim-chain/fname` (a custody-signed
  name proof).
- Dev hooks only: `POST /registrar/dev/advance-clock`, `POST /registrar/dev/run-batch`, `POST /registrar/dev/reset`,
  `GET /registrar/dev/state`.
- The laptop rig only (dev hooks and not a hosting platform): `GET /dev/request-log`, the last 2,000 requests in memory,
  never a reveal's body.

## Persona launch, wave 3 (built, test data only, not deployed)

The routes this wave adds. The code is the contract (`validator/anon.js`, `validator/xoutbox.js`, `validator/zk.js`);
`SECURITY-POSTURE.md` §27 and §28 say what each party learns.

**The browser's anonymous channel (`validator/anon.js`, Persona launch P7).** Two routes for a browser tab, beside the
strict `/zk/anon/submit` and `/zk/anon/head`, which are unchanged.

- `POST /zk/anon/web?pow=<nonce>` — a CORS simple request: `content-type: text/plain;charset=UTF-8`, a body of exactly
  4,096 bytes (any other size is `malformed`), the proof of work in the query. Headers: the strict set plus exactly the
  ones a browser adds itself (user-agent, origin, accept-language, priority, pragma, cache-control, dnt, sec-gpc,
  `sec-ch-ua*`, `sec-fetch-*`); proxy hop headers (`x-forwarded-*`, `x-real-ip`, `forwarded`, `via`, `x-request-id`,
  `x-request-start`) only under `TRUST_PROXY=true`; a cookie, authorization, proxy-authorization, referer or any
  `x-layers-*` header is refused whatever else holds. A live-universe envelope is refused before it is verified, so it
  consumes nothing. Then the strict route's own path: the same verification, the same constant 256-byte answer after
  the same response floor (`ZK_ANON_RESPONSE_MS`), nothing logged.
- `GET /zk/anon/web/head?mode=&tree=` — the same public head as `/zk/anon/head`, behind the same header policy (a
  refused request answers `{"error":"refused"}`).

**Claim kind `x-anon-post` (`validator/zk.js`, Persona launch P8).** An anonymous X copy over the plain anon tree:
personaId the constant `anon`, gateId `x-anon-post`, `publicInputs.xHash` (64 hex) and `publicInputs.slot`
(0 to `ZK_X_ANON_POST_SLOTS` − 1, default 1 slot); scope `x-anon-post/w<n>/s<i>`; the message binds `x:<xHash>`; the
payload is exactly `{text, nonce}` and must pass the text policy. Queued inside the nullifier's transaction.
`xHash` on any other claim kind is a 400.

**The X outbox (`validator/xoutbox.js`, migration 26; fixture universe only; no live transport exists).**

- `GET /x/outbox` — public: the newest 200 copies, each `{id, status, hour}`, with the text and the fixture post id
  only once posted. A rejected copy is listed as rejected; its text is never served.
- `GET /x/outbox/config` — public: the X slots per window, the daily cap and its use today, whether a moderator is set.
- `GET /x/outbox/review?mode=&issuedHour=&pubkey=&sig=` — a moderator's signed read (Ed25519 over the review canonical
  form, this hour only): the copies in `review` or `approved`, with their text.
- `POST /x/outbox/moderate {mode, id, decision, issuedHour, pubkey, sig}` — `decision` is `approve` or `reject`;
  `pubkey` must be in `X_OUTBOX_MODERATORS` (or, on a rig, registered by the dev route below). No moderator: 403,
  nothing is ever approved. A replayed signature: 409. A posted or failed copy cannot be decided again: 409.
- Dev hooks only (`ZK_DEV_HOOKS`): `POST /x/outbox/dev/moderator {pubkey}`, `POST /x/outbox/dev/relay-now`,
  `POST /x/outbox/dev/reset`, `GET /x/outbox/dev/transport-log`.
- Variables: `X_OUTBOX_MODERATORS`, `X_OUTBOX_DAILY_CAP` (default 50), `X_OUTBOX_RELAY_INTERVAL_MS` (an hour),
  `X_OUTBOX_RELAY_SPREAD_MS` (30 minutes on the public shape, 0 elsewhere), `ZK_X_ANON_POST_SLOTS` (default 1, equal on
  the app).

## Public go-live (built, test data only, not deployed)

The routes the public go-live adds. The code is the contract (`validator/anonpublic.js`, `validator/zk.js`,
`validator/anon.js`); `SECURITY-POSTURE.md` §31 says what each party learns.

- `POST /zk/anon/fid-join {mode:"live", fid, commitment, salt, message, signature, authMethod}` — the fid gate's join: a
  verified Sign in with Farcaster for `APP_URL`'s domain whose nonce binds a dedicated crowd commitment (never the
  root's registered one). One leaf per fid: a later join moves the fid's place to the new commitment from the next
  epoch. 404 when the gate is off; 20 joins an hour per address.
- `POST /zk/anon/fid-leave {mode, commitment, publicKey:[x,y], signature:{R8:[x,y],S}, issuedHour}` — leave the crowd,
  signed by the crowd identity over `layers-anon-fid-leave/1`, this hour or the last; the commitment is not a leaf from
  the next epoch (migration 30 `anon_fid_leave`: `zk_anon_fid_members.left_epoch`). 20 an hour per address.
- `GET /zk/anon-post/config?mode=live` adds `liveRelay` (the agent relay is armed), `fidGate`, and, on the fid-gated live
  universe, `reachIssuers: []` and `liveTreeOnly: true`: a live anon post may prove only the gated plain tree, which must
  be the configured anon tree (anything else is a 400 `gated-tree` before the binding and the nullifier).
  `POST /zk/issuers` refuses `fc.reach` and `x.reach` in the live universe (403).
- `GET /zk/anon/public-status?mode=` — status only, no key: `relay {kind, ready, transport, problems, deletesReady}`
  (`deletesReady`: a moderator's removal can reach Farcaster now; true while the switch is off, false once the key is
  revoked), `fidGate {on, domain, chain}`, `moderated`, `moderators`, `filter`, `reportReasons`.
- `POST /zk/anon/report {mode, castHash, reason}` — one of the listed reasons; one report per post per address.
- `GET /zk/anon/moderation?mode=&issuedHour=&pubkey=&sig=` and `POST /zk/anon/moderation {mode, castHash, decision,
  pubkey, sig, nonce, issuedHour}` — a moderator's signed queue and decision (`ANON_MODERATORS`); Remove hides the post
  and deletes it from Farcaster through the agent's signer (bounded retries), Keep dismisses the reports so far.
- `GET /zk/anon-cast?mode=&hash=` — one anon post, for the share page.
- The web door (`POST /zk/anon/web`) refuses a TEST-universe envelope before verification once the validator is the live
  product (`PUBLIC_LIVE` set on a public deployment; a misspelt value counts as live) or its public relay is armed.
- A relay that is not ready (switch off or key revoked) marks waiting live posts `failed` at boot and at every slot;
  arming again publishes nothing that was waiting.
