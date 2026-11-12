# Rings and ring notes

A ring is a set of recipients, not identities: each member is a private address someone handed you, and your device seals each member a fixed-size note into a public mailbox that every device reads whole. Every anonymous post carries one more fixed-size note that only the right ring's members can open.

::: warning Status: built, test data only
<span class="st st--test">Built, test data only</span> on both sites, deployed 2026-10-12 and not yet used there: tested on the laptop rig, on a local production-shaped copy (browser devices on a loopback test page publishing as a stranger's would, the `/d` card) and in a node-only harness. No suite drives the Settings › Rings page in a browser. No anonymous post with a real ring note has reached the network. On the public preview there are no anonymous posts yet (the browser prover is built, test data only, and arrives with the wave 3 deploy; no suite has yet shown a ring member opening a note on one) and personas have no fid, so a ring there works only as text ("Rings you are in"), with no card merge; and on the owner's private service rings publish to that service's own validator, which members on the public preview do not read (A-RING-OWNER-SERVICE-DROP). {cite: SECURITY-POSTURE.md > "24. Rings and ring notes (Persona launch P4): what the drop, the operator and a member learn"}
:::

The verdict: the validator stores fixed-size ciphertext with no writer column and serves it to everyone, so it never learns a persona, a ring, a label or which rows are one member's. What it does learn is the writer's device at write time (D8: device-signed publishing, padded to buckets of 4), and at rest which devices have ever written the drop (the envelope counter); every reader's internet address; and that a note was deleted at a revoke. A note carries no signature, so a member can neither prove a link to an outsider nor be stopped from forging one to the rest of the ring. {cite: SECURITY-POSTURE.md > "24. Rings and ring notes (Persona launch P4): what the drop, the operator and a member learn"}

## At a glance

<ol class="flow">
  <li><strong>Address</strong>A member's device hands over one of its spare addresses, derived from its own root: <code>LR1.</code> + address id, an X25519 public key and a PSK. Nothing is written at the handover.</li>
  <li class="flow__us"><strong>Seal</strong>The owner's device seals one 4,096-byte statement per (ring, member) with HPKE in PSK mode, with a 72-hour lease.</li>
  <li class="flow__us"><strong>Publish</strong>About hourly, device-signed PUTs of at most 28 rows each: the new generation, padded with dummies to a multiple of 4, with the old one deleted in the same transaction as the last of them.</li>
  <li><strong>Read</strong>Every device, every tick: GET the whole drop and the public anon list, unsigned; trial-open rows and notes in memory.</li>
  <li><strong>Render</strong>From memory only: "@persona · shared with you by <em>the name the owner chose to be shown as</em>" (not the ring's own name) and the root-left, persona-right avatar.</li>
</ol>
<p class="flow__note">The design is DROP (<code>research/spec-friend-whitelist-2026-10-08.txt</code>), adapted from the owner service's "friends" to every device's rings and made multi-writer (plan D8).</p>

## The model

| Thing | What it is | Limits |
|---|---|---|
| Ring | a named set of members, owned by one root | up to 16 rings, 32 members each |
| Member | an address (`LR1.`…) or a link (`/d#<key>`), not an identity | addresses: up to 32 per root, derived from that root's seed |
| Subject | one of this device's own PUBLIC personas; the main account only as the envelope's root, through `rootHeadshot()` | private personas and the read-only public self are refused; a persona whose fid is one of Totem's own accounts is shared without that fid |
| Depth | `name` (the persona is this root) or `posts` (also which anon posts it wrote) | per (ring, persona) |
| Note key | K(persona, generation), shared by every ring holding that persona at `posts`; the generations form one-way chains | a member is sent, per chain it overlaps, its first generation's key and a step count rounded up to 4, not a generation number |

When the audience grows (a member added, a ring raised to `posts`) the next generation is one HKDF step along the current chain: members already in the audience step forward and lose nothing, and the newcomer cannot step back to earlier posts. When it shrinks (a member revoked, a ring lowered or deleted) a fresh random chain starts that nobody outside the remaining audience can reach. So a member does not open posts from before it was shared at `posts`, and its history survives every add, bounded only by two revokes or lowerings (or about 64 adds) since it joined. Two limits, stated by the wave 3 review: after a revoke, another of the root's devices that has not refreshed yet can still seal under the old chain for up to about 25 minutes (A-RING-REVOKE-SIBLING-WINDOW); and because a member derives every later step itself, the difference in step between two notes it opens is the exact number of times that persona's audience grew in between, in any ring, with a new stretch marking a revoke (A-RING-NOTE-INDEX-COUNTS-JOINS). Rounding the step count to 4 hides only the member's own join point. {cite: SECURITY-POSTURE.md > "24. Rings and ring notes (Persona launch P4): what the drop, the operator and a member learn"}

## The envelope

HPKE (RFC 9180) in PSK mode, X25519 + HKDF-SHA256 + AES-256-GCM, the suite root linking already ships. The PSK is the second half of the member's address, so a party who saw only the public key cannot seal a note the member would accept. The plaintext is always exactly 4,096 bytes (JSON padded with spaces; a statement that does not fit is refused, never truncated), so every row's ciphertext is 8,224 hex. A 2-byte hint, HKDF under the PSK with the fresh `enc` as salt, lets a member's device skip most rows with one HKDF each. Dummies carry a real ephemeral key, random ciphertext of the real length and a random hint. {cite: SECURITY-POSTURE.md > "24. Rings and ring notes (Persona launch P4): what the drop, the operator and a member learn"}

## The ring note

Every anon post carries exactly 256 bytes:

- **Real**, when a ring holds the persona at `posts`: a 12-byte nonce and AES-256-GCM of a 228-byte padded `{v, ref}`, with `"layers-ring-note/1|" + castHash` as associated data, under K(persona, current generation).
- **Random**, otherwise: 256 CSPRNG bytes. The composer runs the same AES-GCM pass under a throwaway key, so its timing does not say whether the persona has an audience.

`sha256(note)` is bound into the anon-post proof's message (`anon | gateId | cast | attr | note | challenge | root`), so the note cannot be swapped after proving, and the associated data means a real note copied onto another cast opens under no key. One note per post, never one per ring, so a note says nothing about how many rings see it. If the rings document cannot be read, the composer refuses the post with the words kept in the box; it never posts without a note. {cite: SECURITY-POSTURE.md > "24. Rings and ring notes (Persona launch P4): what the drop, the operator and a member learn"}

## The drop

| Route | Who | Rules |
|---|---|---|
| `PUT /rings/drop/batch` | a registered device, signed (namespace `rings:drop`) | rows in multiples of 4, at most 28 per write; exact shapes; expiry within the 72-hour lease plus 2 hours of slack; no overwrite; `RING_DROP_MAX_ROWS` (4,096) total, 413 when full; per device 120 writes and 2,048 rows an hour and 1,024 live rows, per address 2,048 live rows (429 with Retry-After, counted in memory); inserts and the previous generation's deletes (by token, in the signed body) in one transaction |
| `GET /rings/drop` | anyone, no-store | every live row in a crypto shuffle, each exactly `{id, enc, ct, hint, expiresHour}` |

The table (migration 23) has six columns, `id, enc, ct, hint, expires_hour, del_hash`, and no writer, device, anchor or mode column. The log is aggregate counts once a minute. {cite: SECURITY-POSTURE.md > "24. Rings and ring notes (Persona launch P4): what the drop, the operator and a member learn"}

## Reading, and failing toward less

Every device makes the same two unsigned reads on every prefetch tick, ring or not, so a read marks nobody, and the same signed re-read of its own `rings` document, which keeps a root's devices on one copy: a seal refuses when another device sealed in between, and the composer refuses a real note from a copy not re-checked within two and a half ticks. What a member receives is kept in memory only: a vault write on change would follow the owner's hourly re-seal and pair the two devices for anyone who watches write times. A failed read (any status but 200, a truncated body, a count mismatch, one malformed row) drops nothing and renders nothing new; the records become "unknown" and stay hidden until a later full read shows them. A full read that no longer carries a member's envelope drops that record. Rendering decrypts and fetches nothing, and compartment mode, or a chrome document not yet read, hides every ring merge. {cite: SECURITY-POSTURE.md > "24. Rings and ring notes (Persona launch P4): what the drop, the operator and a member learn"}

## The link card

A ring can hold a link instead of an address, for someone without Totem. `/d#<key>` sits outside the app group: no device boots and no root is minted. The key lives in the URL fragment, which no server receives; the card reads the public drop and opens it in the visitor's browser. The app server learns that someone opened `/d` (A-DROP-LINK-IS-THE-CHANNEL: the key is also in the browser's history). {cite: SECURITY-POSTURE.md > "24. Rings and ring notes (Persona launch P4): what the drop, the operator and a member learn"}

## Who learns what

| Party | Learns | Kept from it |
|---|---|---|
| The validator operator | the writing device, its write times and padded row count; at rest, which devices have ever written the drop; a revoke as one delete; every reader's address; each post's opaque note | personas, fids, handles, ring labels, which rows are one member's, whether a reader holds an address, which posts have an audience |
| A ring member | the personas its ring was given, at its depth, from the generations it was sent; between two notes it opens, the exact number of times that persona's audience grew (in any ring) and that a revoke happened | other rings' members and labels, unshared posts, posts outside its generations (except, for up to about 25 minutes after its revoke, a post from another of the root's devices that has not refreshed yet), the root's other personas |
| Everyone else | plain @anon with 256 random-looking bytes | any link |

{cite: SECURITY-POSTURE.md > "24. Rings and ring notes (Persona launch P4): what the drop, the operator and a member learn"}

## Assumptions

| Id | What it means |
|---|---|
| A-NOTE-RING-CAN-FORGE | Anyone holding K(persona, generation) can seal a note naming that persona onto their own anon post, for every other holder. No signature, so it proves nothing to an outsider either. Designated-verifier tags are v1.1. |
| A-RING-WRITER-IS-THE-DEVICE | The PUT is device-signed: at write time the operator sees which device publishes, when and roughly how much. The rate counts are in memory, but the envelope counter keeps, at rest and with no expiry, which devices (so which anchors) have ever written the drop, and dates each one's first write to the hour. Proof-authorized anonymous writes are v1.1. |
| A-RING-DROP-SCALE | Every device downloads the whole drop every tick: about 34 MB per read at the 4,096-row cap. |
| A-RING-DROP-READ-IP | The read goes direct, not through OHTTP, so every device's address shows on every tick. |
| A-RING-REVOKED-KEEP-OLD-KEYS | A revoked member keeps the keys it was sent and can open those posts' notes from a saved copy. |
| A-RING-REVOKE-SIBLING-WINDOW | A revoke rotates the key on the device where it is clicked; the root's other devices adopt it at their next refresh, so for up to about 25 minutes a post from one of them can still use the key the revoked member holds. |
| A-RING-NOTE-INDEX-COUNTS-JOINS | Between two notes it opens, a member can count exactly how many times the persona's audience grew, in any ring, and see that a revoke happened; the rounding to 4 hides only its own join point. |
| A-RING-OWNER-SERVICE-DROP | The owner service's rings live on its own validator; reaching public-site members is the next pass. |
| A-RING-MAIN-HAS-NO-FID | `rootHeadshot()` carries no fid, so cards by the main account itself do not merge. |
| A-RING-DROP-SYBIL | The occupancy limits are per device and per address; many of both still add up to the cap. |
| A-RINGS-LAST-WRITE-RACE | Two devices sealing within one request of each other: the last write wins, and the other adopts it at its next refresh. |
| A-RINGS-FIRST-WRITE-AT-CLAIM | A device that has not ticked yet makes its first write when its first address is claimed; addresses are otherwise made ahead as spares, so a handover writes nothing. |
| A-DROP-COUNT-REVEALS-FRIENDS, A-DROP-RESERVED-ENVELOPE, A-DROP-NO-FORWARD-SECRECY, A-DROP-REVOKE-IS-VISIBLE, A-DROP-OWNER-HOLDS-FRIEND-PSK, A-DROP-HINT-IS-A-PRF, A-DROP-LINK-IS-THE-CHANNEL | Carried over from DROP; each is stated in the posture. |

{cite: SECURITY-POSTURE.md > "24. Rings and ring notes (Persona launch P4): what the drop, the operator and a member learn"}

## Where it lives in the code

The model and the sealed document: `lib/rings/model.ts`. The envelope and the link keys: `lib/rings/envelope.ts`. The note: `lib/rings/note.ts`. The owner's actions: `lib/rings/outbound.ts`; the publisher: `lib/rings/publisher.ts`. The member side: `lib/rings/inbox.ts`, `fetch.ts`, `received.ts`, `merge.ts`. The tick: `lib/rings/tick.ts`, called by `lib/zk/prefetch.ts`. The drop: `validator/ringdrop.js`. The route: `app/api/rings/route.ts`; the pane: `components/settings/RingsPane.tsx`; the card: `app/d/page.tsx`, `components/rings/DropCard.tsx`; the avatar: `components/rings/SplitAvatar.tsx`. Tests: `scripts/unit-rings.mjs`, `scripts/accept-rings.mjs`, `scripts/accept-rings-prod.mjs`, `validator/test/ringdrop.test.js`.
