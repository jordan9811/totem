# attack-mega-1 — stake/allowance linkage and lens-guardrail bypass

## Verdict

Section 15 is mostly true as written, but it contains one falsifiable claim
that the code does not implement: the settled `stewardship` rep event is
described twice ("Influence & search" table, SECURITY-POSTURE.md:1231; and
notes/reports/REPORT-MEGA2.md's Gate 1 exit note, "posted once, one epoch late,
hour-grained") as **hour-grained**, and it is not — `validator/server.js:192`
stamps every `/events` row, `stewardship` included, with `Date.now()`, and
`rep_events` (validator/db.js:29-30) is a normal `AUTOINCREMENT` ROWID table,
not the `WITHOUT ROWID` / hour-grained shape this pass and the two ZK passes
before it gave every other persona- or root-adjacent write after attack-z2-1
#2 forced that pattern everywhere else. It is invisible to the closing
linkage test: `scripts/accept-mega2-g7.mjs` check 1 (line 195) only asserts
that a `stewardship` row's JSON never contains the string `MAIN` or `PUB`; it
never inspects `created_at` or `id`. Practically, the damage is bounded —
the row already carries `root_id` in the clear (rep events have always been
root-addressed; the ZK layer hides persona→root, not root→root-events), and
no persona id ever appears in a `stewardship` row, so the finer clock and
kept insertion order cannot by themselves promote a root-level fact into a
persona-level one. That is why this lands as MEDIUM (a contradicted posture
claim and a real, un-audited residual channel) rather than HIGH or CRITICAL.
Outside that one gap, the reputation-UBI and lens-import machinery built
this pass held up under adversarial reading: the overdraw guard, the
type-level no-transfer assertion, the reserve/refund ordering, the sealed
and padded `influence` vault record, and — for the lens guardrail — the
strip-then-reverify-against-the-original-signature design (any field the
sanitizer strips or clamps changes the reconstructed canonical form, so the
original signature stops verifying and the whole import dies) all did what
the report claims, and I could not find a way to make a stripped, capped, or
protected-surface-reaching lens field survive to the feed, nor a way to make
a crafted artifact's lens id collide with `lens_canonical` or overwrite an
existing stored lens.

## Findings (ordered by severity)

### F1. `stewardship` rep events carry a millisecond timestamp and kept insertion order, contradicting the posture's "hour-grained" claim — SEVERITY: MEDIUM
- **Claim attacked:** SECURITY-POSTURE.md:1231 (the "Influence & search" table: "a settled accrual | ONE `stewardship` rep event per evaluated epoch, posted with the account's own root handle, integer count, **hour-grained**") and notes/reports/REPORT-MEGA2.md's Gate 1 D-MEGA2-1-ACCRUAL-LANDS-ON-THE-ROOT-THROUGH-REP note ("posted once, one epoch late, hour-grained").
- **Where:** `validator/server.js:174-197` (`POST /events`, `created_at` stamped at line 192); `validator/db.js:29-38` (`rep_events` schema: `id INTEGER PRIMARY KEY AUTOINCREMENT`, no `WITHOUT ROWID`, no hour-grain helper applied); `lib/influence/accrual.ts:179,195-205` (`settleStewardship` builds `sourceId = "stewardship:${evaluatedEpoch}"` and posts to `/events` with no coarsening on its side either — it has no `created_at` field to set; the validator supplies the timestamp).
- **How the operator does it:** every other persona- or root-adjacent write this pass and the two ZK passes before it produce was deliberately coarsened after attack-z2-1 #2 (HIGH) showed a millisecond timestamp joining a persona to a device — `personas.created_at`, `blocks_v2.created_at`, `adapter_state.updated_at` (`validator/server.js` `hourGrain`, lines 17/149/212/399) and `zk_registrations.registered_at/revoked_at` (`validator/zk.js` `hourGrainMs`) all now round to the hour, and `stakes.created_at` (`validator/stakes.js:31,82`) does too, explicitly `WITHOUT ROWID` so insertion order isn't kept either (comment at stakes.js:15-17). `rep_events` was never brought into that pattern — it predates it (used for `cast_created`, `follow_gained`, etc., also via `Date.now()` in `validator/poller.js` and `validator/seed.js`) — but this pass is the first to hang a *new*, reviewed, privacy-relevant event type (`stewardship`) off that same unhardened table and then describe it in the posture as if it had received the hour-grain treatment. An operator who simply runs `SELECT id, root_id, count, source_id, created_at FROM rep_events WHERE type='stewardship' ORDER BY id` gets, for every root's accrual, the exact millisecond of the settling device's write and its position relative to every other write on the server (any type, any root) in that instant — the two properties (sub-second precision, kept order) that the rest of this pass's own tables were rebuilt specifically to deny it.
- **Evidence:**
```js
// validator/server.js:190-192
db.prepare(
  "INSERT INTO rep_events (root_id, type, count, source_id, created_at) VALUES (?, ?, ?, ?, ?)"
).run(rootId, type, count, sourceId, Date.now());
```
```sql
-- validator/db.js:29-38
CREATE TABLE IF NOT EXISTS rep_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  root_id TEXT NOT NULL REFERENCES roots(id),
  type TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 1,
  source_id TEXT,
  created_at INTEGER NOT NULL
);
```
```md
<!-- SECURITY-POSTURE.md:1231 -->
| a settled accrual | ONE `stewardship` rep event per evaluated epoch, posted
with the account's own root handle, integer count, hour-grained | ...
```
  `scripts/accept-mega2-g7.mjs:195` — the only check that touches
  `rep_events` — reads `if (a.s.includes(MAIN) || a.s.includes(PUB))`, never
  `a.row.created_at` or `a.row.id`.
- **Fix or assumption:** mechanical fix is small and matches the existing
  pattern exactly: stamp `rep_events.created_at` with `hourGrain(Date.now())`
  in the `/events` handler (the same helper already imported at
  `validator/server.js:17`), and either add a migration that rebuilds
  `rep_events` `WITHOUT ROWID` keyed on `(root_id, type, source_id)` (its
  existing unique constraint) so insertion order stops being free, or accept
  and name the residual explicitly as an assumption (e.g.
  `A-MEGA2-REP-EVENTS-MS-GRAIN`) the way `A-MEGA2-ACCRUAL-MAGNITUDE` already
  names the coarser root-level correlation risk — but the posture's two
  "hour-grained" sentences should not stand uncorrected either way, since as
  written they assert a mitigation that was never applied to this table.
  Whichever is chosen, `accept-mega2-g7.mjs` check 1 should assert
  `created_at % 3_600_000 === 0` on every `stewardship` row the way check 1
  already measures the `stakes` co-timing set, so a future pass can't
  silently regress it back to millisecond grain without a red test.

### F2. "Protected, by construction" overstates what `historyFor`'s disclosure gate actually protects — SEVERITY: LOW
- **Claim attacked:** SECURITY-POSTURE.md's `P-MEGA2-HISTORY-AT-THE-DISCLOSURE-LEVEL` bullet, listed under the "Protected, by construction" heading (the same section's "Assumed" heading, two bullets down, already says the opposite).
- **Where:** `lib/influence/stakes.ts:175-198` (`historyFor`, the disclosure gate) vs. `validator/stakes.js:90-115` (`GET /stakes`, which serves full per-persona rows to any caller with no disclosure check at all — only a `PERSONA_RE` shape check).
- **How the operator does it:** the operator does not even need to go through the app's gated `historyFor` — it (or anyone who can reach the validator's port, which this same document elsewhere treats as generally reachable, e.g. `/zk/members` and `/zk/registration` "public by design") can call `GET /stakes?personaId=<id>` directly and get every row that persona ever signed, unfiltered by any disclosure grant. The document already says this accurately in `A-MEGA2-STAKE-ROWS-ARE-PUBLIC` two bullets later ("Disclosure governs the app's per-persona HISTORY view, not the validator's per-cast table"), but placing `P-MEGA2-HISTORY-AT-THE-DISCLOSURE-LEVEL` under "Protected, by construction" without a forward pointer to that caveat lets a reader take the first bullet at face value.
- **Evidence:**
```js
// validator/stakes.js:101-103 — no disclosure check, no auth, just shape validation
} else if (personaId) {
  if (!PERSONA_RE.test(personaId)) return res.status(400).json({ error: "personaId malformed" });
  rows = db.prepare("SELECT * FROM stakes WHERE mode = ? AND persona_id = ? ORDER BY created_at, id LIMIT 2000").all(mode, personaId);
```
- **Fix or assumption:** either move `P-MEGA2-HISTORY-AT-THE-DISCLOSURE-LEVEL` under "Assumed" as a sub-clause of `A-MEGA2-STAKE-ROWS-ARE-PUBLIC` (it is the same fact from two angles), or add one clause to the "Protected" bullet itself: "...at the app's own query path; the validator's own per-persona route is ungated and this same data is available there to anyone, per A-MEGA2-STAKE-ROWS-ARE-PUBLIC." No code change needed — this is a labeling/consistency fix in the posture document, not a new leak, since the underlying fact is already stated correctly elsewhere in the same section.

## What I checked and found sound

- **Overdraw / no-transfer / reserve-refund ordering** (`lib/influence/allowance.ts`, `lib/influence/stakes.ts`): the reserve-before-send, refund-on-refusal sequence is followed on every failure branch of `placeStake` (validator unreachable, non-2xx, missing `stake` in the response), the balance never goes negative, a future-epoch-stamped balance is reset rather than honoured, and `INFLUENCE_HAS_NO_TRANSFER` (`lib/influence/types.ts:103-104`) makes adding a transfer-shaped method to `InfluenceAdapter` a `tsc` failure.
- **Stake signature/canonical-form discipline**: `validator/stakes.js`'s `stakeCanonical` and `lib/influence/types.ts`'s copy are byte-identical field order; every reader (`verifyStakeRow`, `lib/influence/stakes.ts:128-135`) re-verifies against the persona's *resolved* key rather than trusting the row's own `pubkey` column, so a row signed under a foreign key is excluded by every honest reader even though the validator stores it.
- **Vault sealing for the new namespaces**: `influence`, `scrollZones`, `relationshipPorts`, `readwise` are all registered in `VAULT_NAMESPACES` (`lib/vault/vault.ts`), all reset caches are wired into `/api/dev`'s `resetSeed` action, and I found no plain-namespace mirror of any of their contents, no log line touching them (grepped `stakes.js`, `accrual.ts`, `allowance.ts`, `lens/*.ts` for `console.`/`logger.` — none), and no dev hook that returns them unsealed. `lenses` is correctly a *plain* namespace (public artifacts by design, D-MEGA2-2-LENSES-ARE-PUBLIC-STATE) and is not in `VAULT_NAMESPACES`.
- **The influence record's KiB padding** (`lib/influence/allowance.ts:101-110`): worked through the arithmetic — the `target - inner.length - 48` margin is a conservative constant, not a per-content variable, so two documents whose JSON lengths fall in the same 1024-byte step always produce the same final ciphertext length regardless of how many stakes/accruals are inside; the size only steps at 1 KiB boundaries, consistent with the zone-record check the Gate 7 suite already runs (`accept-mega2-g7.mjs` check 3).
- **Cluster detection** (`lib/influence/clusters.ts`, `GET /api/influence?view=clusters`): unauthenticated by design and openly documented (`A-MEGA2-COORDINATION-IS-LEGIBLE-NOT-ENFORCED`) — it computes nothing an outside party couldn't already compute from the equally-unauthenticated `GET /stakes?epoch=` rows, so it adds no new information, only convenience. `MIN_MEMBERS = 3` means a root running only two personas (the case this review's own linkage test exercises) can never itself trigger a cluster.
- **`settleStewardship` cannot be aimed at another root**: `rootId` is resolved from the calling device's own roster (`rootForFid(getSelf().fid)` / `rootOfPersona`), never taken from request input, so there is no way to post an accrual — or read one — for a root that isn't this device's own.
- **Lens-guardrail bypass paths I tried and could not open**:
  - *Stripped-but-signed*: sanitize-then-reverify means any field the sanitizer removes or clamps (unknown top-level key, non-canonical signal, out-of-range weight, unknown curve key, malformed curve set) changes `canonicalForm()`'s output relative to what the original signature covers, so `verifyArtifact` fails on the *sanitized* object and the import dies (`lib/algo/artifact.ts:143-259`, `lib/algo/service.ts:298-316`). I could not construct a case where stripping occurs but the reconstructed canonical form still matches the original signature.
  - *Weight/curve bounds*: `LENS_WEIGHT_MIN/MAX` (-5..5) are enforced per-signal in `sanitizeLensSpec` (`lib/lens/sanitize.ts:45-50`); every `InfluenceCurves` field is range-checked in `sanitizeCurves` (`lib/influence/curves.ts:39-60`, e.g. `pointsPerStewardship` 1..1000, `early.weight` 0..5). Even an artifact that maxed out `pointsPerStewardship`/`maxStewardshipPerEpoch` inside its `influenceDistribution` cannot affect real accrual, because `settleStewardship` always evaluates with `CANONICAL_CURVES` hard-coded (`lib/influence/accrual.ts:182`), never the active lens — a hostile lens can only mislead its *own* preview/evaluate numbers, not the reputation that actually posts to the validator.
  - *Lens id collision swapping the canonical lens*: `CANONICAL_LENS_ID = "lens_canonical"` and `SLOW_READS_LENS_ID = "lens_slow_reads"` are literal strings that cannot arise from `lensIdOf`'s `"lens_" + sha256(signature).slice(0,12)` (a hex-only suffix), and `storeLens` (`lib/lens/service.ts:76-96`) returns the *existing* record on an id collision rather than overwriting it — so even a successful hash-prefix collision against another user's stored lens would be a no-op, not a swap.
  - *Prototype-pollution-style signal keys* (`__proto__`, etc.): rejected by the `LENS_SIGNALS.includes(k)` allow-list before any assignment happens (`lib/lens/sanitize.ts:40-51`), so no assignment onto `signals` is ever attempted for a non-canonical key.
  - *Packs pinning a hostile lens*: `/api/packs/export` re-runs `sanitizeArtifact` on the constructed pack artifact before returning it (`app/api/packs/export/route.ts`), and `importArtifact` sanitizes a `kind: "filter_pack"` artifact's `lens` field through the identical `sanitizeLensSpec` path as a bare lens artifact (`lib/algo/artifact.ts:218-226` triggers on `a.lens !== undefined` regardless of `kind`).
- **Disclosure fail-closed**: `historyFor` returns a 503 refusal (never the rows) when `adapters.disclosure.canViewLinkage` throws, matching the project's stated "never fail open" discipline.
- **No stake IDOR**: `placeStake` refuses (`not_own`) any `personaId` not in `ownPersonaIdsAll()` before it ever reserves or signs, so a caller cannot spend another persona's (or another device's) allowance.

## Assumptions I had to make

- I read the validator's HTTP surface as reachable by more than just the app server in a real deployment (consistent with this document's own treatment of `/zk/members`, `/zk/registration`, and `GET /stakes` as intentionally public elsewhere) — F2's severity would drop further if the validator port is in fact firewalled to the app server only in every real deployment, but nothing in this pass's code enforces that.
- I treated "the operator" per the assignment's framing as someone who queries the validator's SQLite file and its `/state` and log surfaces directly (as `accept-mega2-g7.mjs`'s `operatorView()` does), not as a network-adjacent party who also controls a reverse proxy or TLS terminator in front of it; F1's severity assessment (MEDIUM, not HIGH) rests on that — if the operator also holds ordinary infra request logs, millisecond-precision timing was already available to them for *every* write in this system (stakes included, despite the DB-level hour-grain), which is a pre-existing, out-of-scope transport assumption (this document's own A-TRAFFIC class) rather than something this pass newly introduces.
- I did not run the app, the validator, or any script; all of the above is read from the diff (`d9105d5..HEAD`) and the named files as they stand on disk.
