# attack-mega-3 — DM ingest and relationship porting

## Verdict

Section 15's claims about stakes and search hold, but the DM-hook and
relationship-porting gates it has not yet absorbed (Gate 5/6 are due for the
same "Gate 7 revises it" treatment Gate 1 and Gate 4 already got) are not
true as the code stands. The worst finding: `dmPostHash` — the "opaque"
identifier the DM-to-bookmark hook uses everywhere a tweet is named on the
validator — is salted with `vaultKeyBytes()`, which is derived from the
**root** seed, not from the persona. Every persona of one root therefore
computes the *identical* hash for the *identical* tweet id. That hash then
becomes the record key in the `readwise` namespace (`${personaId}:${postHash}`,
stored in the clear even though `readwise` is a "sealed" namespace — sealing
covers record *values*, not record *addresses*, the exact bug class
`zkQueue` was already rewritten to avoid) and appears again, doubly plain, in
the `ownerPersonaId`/`postHashes` fields of the unsealed `folders` namespace.
Two personas of one root DMing the Layers account a link to the same tweet —
not a contrived attacker scenario, just two accounts operated by one person
bookmarking the same viral post, exactly the kind of dual-account use Gate 6
is built to serve — leaves the operator two rows that share a value, in two
different tables, one of them nominally "sealed." The linkage-v5 suite
(`accept-mega2-g7.mjs`) never triggers this because only MAIN polls the DM
inbox in its session; PUB never does. Beyond that, relationship porting's
"pending → resolves on link" mechanic issues a real, permanent cross-persona
disclosure grant to *whoever* later attests the exact handle string a port
named, with no re-confirmation and no expiry — by design, but nowhere
written down as a risk — and the synchronized-like X breadcrumb it reuses
from alt-linking still has no assumption line in this document anywhere,
even though Gate 6 just widened its audience from "one person you trust"
to "any named counterpart."

## Findings (ordered by severity)

### F1. Two personas of one root produce the identical DM-bookmark hash, joinable in a "sealed" namespace's own key and in a plain namespace's value — CRITICAL

- **Claim attacked:** the code comment's own claim in `lib/x/inbox.ts:56-59`
  ("OPAQUE: salted with this device's vault key, so the folder row and the
  schedule row ... name a tweet the operator cannot identify") and, by
  extension, D-MEGA2-7-OPAQUE-MEANS-NOT-DERIVABLE-FROM-WHAT-THE-OPERATOR-HOLDS
  (`notes/reports/REPORT-MEGA2.md:276`), which is exactly the property this breaks for two
  personas of one root.
- **Where:** `lib/x/inbox.ts:60-62` (`dmPostHash`) joined through
  `lib/identity/keystore.ts:147,234-236` (`vaultKeyBytes` derives from the
  root seed, not a persona), `lib/adapters/mock/feedHealth.ts:46,52,62`
  (`readwise` keyed by `${personaId}:${postHash}`), `lib/vault/vault.ts:93,113-126`
  (`readwise` is sealed, but `encryptNamespace` only encrypts the record
  *value* — the `id`/key stays the object key in the JSON the validator
  stores), and `lib/adapters/mock/store.ts:361,394,435` (`readwise` uses
  `mapDump`, i.e. per-record keys, not the `opaqueDump` single-blob shape
  `zkQueue`/`scrollZones`/`influence`/`relationshipPorts` all use).
- **How the operator does it:** two personas of one root (say MAIN and a
  fork PUB, both OAuth-linked to their own X handles, exactly Gate 6's own
  setup) each DM the Layers account a link to the *same* tweet — plausible
  on its own, and actively invited by Gate 6, which assumes a root running
  two X accounts that follow similar content. `ingestInbox` (`lib/x/inbox.ts:212-263`)
  computes `hash = dmPostHash(tweetId)` for each persona; since
  `vaultKeyBytes()` is root-scoped, `hash` is byte-identical both times.
  For MAIN it lands as `folders` row `{ownerPersonaId: MAIN, postHashes: [hash]}`
  and `readwise` key `"MAIN:hash"`; for PUB it lands as `folders` row
  `{ownerPersonaId: PUB, postHashes: [hash]}` and `readwise` key `"PUB:hash"`.
  The operator dumps `adapter_state` for namespace `folders` (fully plain —
  values are never sealed) and namespace `readwise` (values are ciphertext,
  but the *keys* of the JSON object are not) and does one grep: any hash
  string appearing under two different persona ids is two personas of one
  root, found with no cryptography at all. `accept-mega2-g7.mjs`'s check 5
  (`scripts/accept-mega2-g7.mjs:232-247`) never exercises this because only
  MAIN polls the inbox in the v5 session.
- **Evidence:**
  ```ts
  // lib/x/inbox.ts:60-62
  export function dmPostHash(tweetId: string): string {
    return "dm:" + createHash("sha256").update("layers-dm-item/1|" + tweetId + "|").update(vaultKeyBytes()).digest("hex").slice(0, 16);
  }
  // lib/adapters/mock/feedHealth.ts:46
  const key = (personaId: string, postHash: string) => `${personaId}:${postHash}`;
  ```
  ```ts
  // lib/identity/keystore.ts:234-236 — no persona argument anywhere in this derivation
  export function vaultKeyBytes(): Uint8Array {
    return deriveVaultKey(seedBytes());
  }
  ```
  and the comment `zkQueue` itself carries, describing the exact bug class
  left unfixed in `readwise` (`lib/adapters/mock/store.ts` / `lib/vault/vault.ts:61-64`):
  *"this vault seals record VALUES, not record ADDRESSES (attack-1 finding 1:
  the proof budget's addresses were `personaId:epoch`, siblings side by side
  in plaintext)."*
- **Fix or assumption:** two independent fixes, both needed. (1) Make
  `dmPostHash` persona-scoped, e.g. HMAC over `vaultKeyBytes()` with
  `personaId` folded into the message (`"layers-dm-item/1|" + personaId + "|" + tweetId`)
  so the *value* differs across a root's personas even for the same tweet —
  this is the one-line fix that removes the cross-persona correlation at
  its source. (2) Independently, `readwise`'s serializer should move from
  `mapDump` (`Object.fromEntries`, per-record plaintext keys) to the
  `opaqueDump` shape already used for `zkQueue`/`scrollZones`/`influence`/
  `relationshipPorts` — one padded record holding the whole map — because
  right now *any* two records in `readwise` that happen to share a
  `postHash` (DM-sourced or not) are joinable by key alone, independent of
  the DM hash question. `folders` staying a plain namespace is a separate,
  already-accepted exposure (D-MEGA2-7 says the folder row is one of the
  "only plain rows the DM path may add") but its plaintext-ness makes fix
  (1) load-bearing: without a persona-scoped hash, `folders` alone is
  enough to run this join even if `readwise` is fixed.

### F2. A pending relationship port auto-resolves — with a real, permanent disclosure grant — to whoever later attests the named handle, with no re-confirmation and no expiry — HIGH

- **Claim attacked:** unstated (no A-MEGA2-6-* line addresses this); closest
  existing framing is D-MEGA2-6-PENDING-RESOLVES-ON-LINK
  (`notes/reports/REPORT-MEGA2.md:244`), which states the mechanic as a feature without
  naming this residual.
- **Where:** `lib/x/porting.ts:178-195` (`resolvePendingPorts`), called from
  `lib/x/attestations.ts:90-103` on every fresh attestation; demonstrated
  (as intended behaviour, not a caught bug) by
  `scripts/accept-mega2-g6.mjs:100-110`, check 2.
- **How it plays out:** `fromPersona` creates a port naming a counterpart by
  raw handle string (`runRelationshipPort`, `lib/x/porting.ts:143-149`). If
  that handle is not yet attested to anyone, the port is stored `status:
  "pending"` with only `counterpart.handle` recorded (sealed). Any time
  *any* persona later calls `attestHandle` with that exact handle string,
  `resolvePendingPorts` fires and immediately issues a real
  `adapters.identity.issueGrant({fromPersona, toPersona, audienceMember: personaId, tier: "whitelist"})`
  — the real in-app disclosure that "their Layers client resolves ... and
  renders the merged identity" (`lib/x/porting.ts:8-13`) — to *that*
  persona, with the only check being "not one of our own"
  (`lib/x/porting.ts:185`). There is no re-confirmation step back to
  `fromPersona`, no time window, and `RelationshipPort` has no `expiresAt`
  field at all (`lib/x/porting.ts:37-53`). If the named handle later
  changes hands, was mistyped, or is squatted and then claimed by a
  different real person before the intended counterpart ever attests it,
  that unrelated party receives — automatically, irrevocably rendered at
  least once before anyone could react — a real, verifiable fact that two
  specific personas belong to one root. This is not the operator learning
  it (the operator still only ever sees a signed grant + ciphertext, same
  as any other disclosure), but it is the exact "does the grant ... join
  the two personas" question this pass's own Gate 7 brief asks, answered
  "yes, to a party the source persona never confirmed."
- **Evidence:**
  ```ts
  // lib/x/porting.ts:179-192
  export async function resolvePendingPorts(handle: string, personaId: string): Promise<RelationshipPort[]> {
    const h = canonicalHandle(handle);
    const doc = await load();
    const resolved: RelationshipPort[] = [];
    for (const p of doc.ports) {
      if (p.status !== "pending" || p.counterpart.handle !== h) continue;
      if (ownIds().has(personaId)) continue; // one of ours linking that handle is not the counterpart arriving
      const grant = await retryAdapter(() => adapters.identity.issueGrant({ fromPersona: p.fromPersona, toPersona: p.toPersona, audienceMember: personaId, tier: "whitelist" }));
  ```
- **Fix or assumption:** either fix it — require `fromPersona` to confirm a
  resolved-pending port before the grant actually issues (store the
  candidate resolution, surface it in `RelationshipPortFlow`, let the owner
  approve or reject), and/or add an expiry after which a pending port lapses
  rather than staying live indefinitely — or, if the "instant onboarding
  hook" behaviour is kept deliberately, write it down: an
  A-MEGA2-6-PENDING-PORT-TRUSTS-THE-HANDLE assumption stating that a
  pending port's safety rests entirely on the handle string never being
  reused by anyone but the intended counterpart, for as long as the port
  stays pending.

### F3. The unlinked-sender hash has no secret, and `GET /api/x/inbox` returns the whole session's replies log to any caller with no persona scoping — MEDIUM

- **Claim attacked:** D-MEGA2-5-UNLINKED-GETS-THE-FUNNEL-AND-NOTHING-IS-KEPT
  (`notes/reports/REPORT-MEGA2.md:214`) — "the sender HASHED, never sent" is read by a
  casual observer as "the sender is protected"; the hash construction does
  not protect it against anyone who actually receives the log.
- **Where:** `lib/x/inbox.ts:145-153` (`replies()`, `senderHash`);
  `app/api/x/inbox/route.ts:16-35` (`GET`, `replies: inboxReplies()`).
- **How it plays out:** `senderHash` is `sha256("layers-inbox-sender/1|" + canonicalHandle(h))`
  — a static domain string plus the handle, no key, no per-device or
  per-root salt at all (contrast `dmPostHash`, which deliberately salts
  with `vaultKeyBytes()` for exactly this reason). X handles are
  `[a-z0-9_]{1,15}`; the hash is trivially dictionary-attacked against any
  candidate list (the account's own followers/following, a scrape, or
  brute force over the full space, which is small for a GPU) by anyone who
  receives it. Today that log lives only in `globalThis.__layersInboxReplies`
  and is never written to the validator, so the operator does not get it —
  but `GET /api/x/inbox` hands the *entire* global array to whoever calls
  it, with no filter tying it to the requesting persona (contrast the same
  route's `folder`/`schedules` fields, which are correctly scoped by
  `activeSeedPersonaId()`). In this codebase's demo topology, where a
  cookie (`layers_view_as`) is the only thing selecting "which persona is
  asking" (used throughout the acceptance suites, e.g.
  `scripts/accept-mega2-g7.mjs:69`), anyone able to reach the app at all
  gets every unlinked sender's hash from every persona's polling this
  session, and can unmask them offline.
- **Evidence:**
  ```ts
  // lib/x/inbox.ts:153
  const senderHash = (h: string) => createHash("sha256").update("layers-inbox-sender/1|" + canonicalHandle(h)).digest("hex").slice(0, 12);
  // app/api/x/inbox/route.ts:26-27
  linkedHandle: linkedHandleFor(personaId),
  replies: inboxReplies(),
  ```
- **Fix or assumption:** key `senderHash` the same way `dmPostHash` is keyed
  (`vaultKeyBytes()`, or better, a persona-scoped HMAC so it doesn't
  reintroduce F1's shape), and scope the `replies` field returned by `GET`
  to entries produced while polling for the requesting persona's own
  linked context (or drop it from the unauthenticated shape entirely and
  serve it from a route that checks who is asking). Until fixed, write down
  that the sender-hash protection is bounded to "stays in this process," not
  "safe if anyone else reads it."

### F4. The synchronized-like X breadcrumb has no assumption line anywhere in this document, and Gate 6 just widened its audience — MEDIUM

- **Claim attacked:** unstated by omission — no A-MEGA2-* (or earlier
  A-UX-*/A-ALT-*) line in `SECURITY-POSTURE.md` describes what X, or anyone
  who screenshots the two accounts' public like activity, learns from the
  breadcrumb both alt-linking and now porting schedule.
- **Where:** `lib/x/altlink.ts:41-43` (constants, pre-existing from an
  earlier UX pass) reused by `lib/x/porting.ts:14-18,157-158`
  (`runRelationshipPort`); documented only in `notes/reports/REPORT-MEGA2.md:245`
  (D-MEGA2-6-THE-BREADCRUMB-REUSES-ALT-LINKING), never in
  `SECURITY-POSTURE.md` (grepped for "breadcrumb", "synchronized-like",
  "ALT_LINK" — zero matches in the whole file).
- **How it plays out:** the mechanism is unchanged from alt-linking — two
  likes on one old post, 3–12 s apart, from the root's two X accounts — but
  its *purpose* changed. Alt-linking used it to prove a fact to one
  audience member the user already trusts (`fromPersona === toPersona`, a
  self-claim). Porting reuses the identical on-X signal to carry a claim
  about a *second, different persona* to *any named counterpart*,
  including a stranger a pending port is still waiting on
  (`RelationshipPortFlow.tsx:52`: "Someone knows this persona; let them
  know another of yours"). This build never actually sends the likes
  (fixture only, `lib/x/porting.ts:18`), so nothing is live yet — but the
  posture document is supposed to state what happens when it is, per its
  own §4 standard for every other mechanism in this codebase, and for this
  one it says nothing at all. X (or anyone who happens to be watching
  either account's public likes) would see two specific accounts liking
  the identical obscure old post within a single-digit number of seconds —
  a correlation signal that, unlike the ZK layer's proof-layer hiding, this
  document has never scoped, bounded, or even acknowledged.
- **Evidence:**
  ```ts
  // lib/x/altlink.ts:41-43
  export const ALT_LINK_DAILY_CAP = 3;
  export const ALT_LINK_MIN_DELAY_MS = 3000;
  export const ALT_LINK_MAX_DELAY_MS = 12000;
  ```
  ```md
  notes/reports/REPORT-MEGA2.md:245 — "Fixture only: recorded, never sent to X."
  ```
- **Fix or assumption:** add an A-MEGA2-6-BREADCRUMB-IS-X-VISIBLE (or
  A-ALT-BREADCRUMB-IS-X-VISIBLE, retroactive to the pass that introduced
  it) line to `SECURITY-POSTURE.md` §15 stating plainly: two likes from two
  named accounts on one old post within ~3–12 s is an observable
  correlation signal on X itself; the daily cap (3/day, shared across
  alt-links and ports) bounds how often a root can generate one, not
  whether it is visible when it fires; and Gate 6 broadens the audience
  this signal can be aimed at from "one trusted viewer" to "any named
  counterpart," which is a real change in blast radius that deserves its
  own line rather than inheriting alt-linking's undocumented one.

## What I checked and found sound

- `dmPostHash`'s core anti-brute-force property holds for a *single*
  persona: without `vaultKeyBytes()` (which lives only where §8's topology
  says the seed lives), the operator cannot invert or precompute the hash
  from a candidate list of tweet ids. The break is specifically the
  cross-persona-of-one-root case (F1), not the baseline claim.
- Every write path into `readwise` goes through `adapters.registry.ts`'s
  auto-persist mapping (`scheduleReadwise: ["readwise"]`) into
  `persistNs`, which always seals vault-namespace values before flushing —
  there is no dev hook, log line, or bypass path that writes `readwise`
  plaintext. The exposure is architectural (the key shape), not a missed
  call site.
- The DM poll's spend-ledger note (`lib/x/inbox.ts:217`,
  `"@layers inbox poll page ${cursor} (${ad.mode})"`) carries only the
  device-wide cursor and mode, never a handle, tweet id, or persona id —
  matches D-MEGA2-7's claim about the ledger exactly.
- `xSyncCursor` is keyed by one fixed constant (`INBOX_CURSOR_KEY =
  "layers-inbox"`), not per-persona — it reveals device-wide poll count,
  not which persona benefited from any given DM.
- `relationshipPorts` itself (as opposed to the grant flow around it, F2)
  is stored as one opaque padded record under a single fixed id (`"_"`),
  the same shape as `scrollZones`/`influence`/`zkQueue` — no per-port
  plaintext key, so it does not reproduce F1's key-leak shape internally.
- `resolvePendingPorts` correctly refuses to resolve when the attesting
  persona is one of the root's own (`ownIds().has(personaId)`), closing
  the trivial self-resolution shortcut.
- The fixture's `$LINKED` substitution (`lib/x/inbox.ts:71-74,82`) is
  test-harness-only: it names exactly one deterministic handle (the first
  attested in this device's state) and is never reachable in live mode,
  where the sender comes from X's own API response — it does not leak "the
  linked-handle set," only ever one handle, and only inside the fixture.
- `dmSourceLabelForHash`/`injectDmPost` (`lib/x/inbox.ts:158-194`) are only
  ever read through `getReadwiseSchedules(personaId)`
  (`lib/adapters/mock/feedHealth.ts:67-72`), which filters by the
  requesting persona — the app itself does not splice one persona's
  DM-sourced card into another persona's rendered feed.
- `GET /api/x/port` returning every port on the device regardless of
  viewer (`app/api/x/port/route.ts:12-25`, `lib/x/porting.ts:197-199`) is a
  same-device, same-vault-key exposure: any persona of one root can already
  decrypt everything in that root's vault, so this does not hand the
  *operator* or an outside party anything new. Noted, not counted as a
  finding, because it sits outside this report's threat model (the
  operator, X, the DM sender) rather than inside it.
- `folders`/`altLinkAttempts`/`altLinkDisclaimerAcked`/`altXHandles` being
  plain namespaces is a pre-existing, named condition
  (D-MEGA2-7-OPAQUE-MEANS-NOT-DERIVABLE-... names the folder row
  explicitly); I did not re-flag their bare existence as plain, only the
  specific new joinability F1 introduces through the hash they carry.

## Assumptions I had to make

- I read `seedBytes()`/`vaultKeyBytes()` as genuinely root-scoped (one
  value per device/root, independent of which persona is active) from
  `lib/identity/keystore.ts:147,234-236` and the module's own header
  comment; I did not find any per-persona vault-key derivation anywhere in
  the codebase, but I did not exhaustively search for a second keystore
  implementation outside `lib/identity/keystore.ts`.
- I treated "two personas of one root both DM the Layers account a link to
  the same tweet" as a realistic, not merely theoretical, scenario given
  Gate 6's own stated use case (a root running two linked X accounts) and
  the ordinary behaviour of bookmarking something interesting from more
  than one account — I did not find a product-level guard that would
  prevent it.
- For F2/F4 I treated "the operator's brief also cares about a grant
  recipient or X itself learning the linkage, not only the validator's raw
  tables" as in scope, since the task's own framing names X and the DM
  sender as a second adversary and Gate 6's decisions explicitly discuss
  what a counterpart or X observer learns; I flagged both at a lower
  severity than F1 to reflect that neither hands the *operator* new
  information the way F1 does.
