# Layers — Architecture v3: The Disclosure Model

Source of truth for the mega pass. Supersedes the identity sections of
[ARCHITECTURE.md](ARCHITECTURE.md) (v2); the adapter/registry/seed layering
in v2 still holds and is not restated here.

> **Note on provenance.** The mega-pass spec says "read notes/design/architecture-v3.md
> first, it is the source of truth." No such file existed — only v2. This
> document is therefore written as the first deliverable of Gate 0, encoding
> the substrate the spec describes, and is the source of truth from here on.

## The thesis, stated as invariants

**Posts are public. Linkage is private. Disclosure is consent. Betrayal is
survivable.**

Four properties the system must actually have, not assert:

1. **Sibling-uncomputability.** Given persona A, you cannot compute persona B
   of the same root without the root secret. Enforced by real one-way
   derivation, not by a server declining to tell you.
2. **Root confinement.** Root material never leaves the keystore — not in an
   adapter response, a page payload, a cookie, or any persisted record. A
   grep test runs every iteration.
3. **Grant-mediated disclosure.** A viewer learns a linkage only if a grant
   authorises it. Absence of a grant is absence of a fact, not a flag set to
   false.
4. **Fork survivability.** A leaked linkage is recoverable: reputation lives
   on the root, so a new persona inherits standing immediately, and the
   forward pointer is itself grant-gated.

## The grant is the atom

Every disclosure feature reduces to pairwise persona claims. There is no
"visibility level" on a persona — that was the v2 model and it is gone.

```ts
interface Grant {
  id: string;
  fromPersona: string;    // the persona whose linkage is disclosed
  toPersona: string;      // the sibling it is linked to
  audienceMember: string; // persona id, or "*" for an open audience
  tier: "public" | "opt_in" | "whitelist";
  issuedAt: number;
  revokedAt: number | null;
  signature: string;      // mock signature; shape is real
}
```

The four tiers are expressed *in the data*, not as an enum on a persona:

| Tier | Representation |
|---|---|
| **Public** | one grant, `audienceMember: "*"`, tier `public` |
| **Opt-in** | one grant, `audienceMember: "*"`, tier `opt_in`; resolution requires a request, and the requester is recorded |
| **Whitelist** | N grants, one per named `audienceMember`, tier `whitelist` |
| **Hidden** | **no grant object exists.** Tests assert absence |

Hidden being *absence* is the point. A `hidden` flag is a fact the server
holds about you; no row is not.

## Keystore

`lib/identity/keystore.ts`, server-only, the one module that touches root
material.

- **Root secret**: 32 random bytes, persisted to a local file
  (`.keystore/`, gitignored). This mocks a secure enclave / device keystore;
  the adapter seam is what matters, not the storage medium.
- **Derivation**: `personaId = "p_" + sha256(rootSecret + ":" + nonce)`,
  truncated. Real SHA-256 via `node:crypto`. One-way, so
  sibling-uncomputability holds in the demo rather than being claimed.
- **Root handle**: `sha256("root:" + rootSecret)`, used *only* inside the
  keystore to group a person's own personas. Never serialized.

## Three account types

| Type | Write path | Rendered |
|---|---|---|
| **Public persona** | Farcaster cast path | yes |
| **Private persona** | local store ONLY — the cast write path rejects it at the adapter layer, not the UI | yes, badge-marked, to granted viewers |
| **Root** | never posts | **never** — not rendered, not serialized, not in any response |

Private-persona containment is enforced where the write happens. A UI that
merely hides the button is not containment.

## Blocking, without roots

v2 stored blocks as `blocker_root → blocked_root`. That is root material in
a persisted record, so it is gone.

v3 stores blocks **pairwise**: `blockerPersona → blockedPersona`. Fan-out
happens at read time and covers exactly the siblings the viewer can
*resolve through grants*.

This is a real semantic change and it is the honest one: **you cannot block
what you cannot see.** If someone's linkage is hidden from you, blocking one
persona cannot silently reach the others — you were never told they were the
same person. Where fan-out still works (the seeded multi-persona accounts),
it works because those accounts publish a public-tier grant, which is a fact
the viewer legitimately holds.

The viewer's *own* personas share a blocklist, computed locally from the
keystore — no server-side root needed.

## One identity renderer

Every surface that renders an identity — timeline cards, search results,
notifications, embeds, folder cards, highlight reels, room messages, profile
headers — routes through a single `PersonaResolver`. Built proactively: the
standing lesson from the gated pass is that per-surface logic diverges, and
a disclosure model dies at whichever surface forgot to ask.

Resolution is **fail-closed**: if a grant check errors, the viewer sees the
bare persona. Failing closed here means failing toward *less* disclosure.

## What the real track must implement

Grant semantics are now concrete enough to be a circuit spec:

- **Claim format** — the `Grant` shape above is what gets signed.
- **Resolution check** — "does a non-revoked grant exist from A to B with
  audience ∋ viewer" is the predicate to prove without revealing the grant
  set.
- **Fork operations** — reissue a carried grant set under a fresh nonce, and
  emit a forward pointer resolvable only by that set.

---

## Running it

Two servers. The validator owns persona/rep records; Next serves everything
else.

```
node validator/server.js     # :4000
npm run build && npm start    # :3000
```

### Environment

| Variable | Default | Effect |
|---|---|---|
| `DATA_SOURCE` | `seed` | `neynar` sources the timeline from live Farcaster. Seed is the default deliberately: live content is opt-in, never something you get because a key happens to be present. |
| `ENABLE_WRITE` | unset (off) | Only the exact string `"true"` enables writes. In `neynar` mode every write path throws `WriteDisabledError` — loudly, never a silent no-op. |
| `NEYNAR_API_KEY` | — | Required when `DATA_SOURCE=neynar`. Asking for live data without it is a misconfiguration that is reported, not silently downgraded. |
| `NEYNAR_VIEWER_FID` | `3` | Whose following-feed the live timeline is built from (and whose notifications, mutes and blocks the live reads use). Rig and owner service only: a PUBLIC deployment refuses to boot with it set, whatever its value, because on a process strangers reach it hands them that account's following feed and notifications. On the owner service set it to the owner's real fid; never 9152, which is the real @warpcast account the seed borrowed. |
| `NEYNAR_READ_API_KEY` | — | Public deployments only: the key of a second, signer-less Neynar app, read by `lib/fc/readRelay.server.ts` alone. It arms the read relay (`POST /api/fc/read`), a third content source that exists only in the browser device; `DATA_SOURCE` stays `seed` and `isLiveContent()` is unchanged. Dormant on the rig and the owner service; refused by the validator. See SECURITY-POSTURE.md §19. |
| `ADAPTER_PERSONA` | `mock` | `validator` binds the real service. |
| `ADAPTER_REP` | `mock` | `validator` binds the real service. |

**What the content switch does NOT touch.** Personas, grants, forks, modes and
private posts are *our* layer — keystore, local store, validator. Neynar is
content. `scripts/accept-m4-runtime.mjs` proves the separation by diffing
`/api/personas`, `/api/modes` and `/api/identity/grant` byte-for-byte across a
seed-mode and a neynar-mode server running at the same time.

### Seeing disclosure from the other side

Disclosure is only demonstrable from the far seat: "a granted viewer sees a
link and a non-granted viewer does not" cannot be shown, or tested at the page
level, without occupying the other seat.

```
POST /api/dev  {"action":"viewAs","personaId":"<persona>"}
POST /api/dev  {"action":"viewAs","personaId":null}     # back to yourself
```

This deliberately outranks a mode's `pinnedPersonaId`: it is a lens, and a
lens a mode could silently override would make every disclosure demo
untrustworthy.

### The seeded world

| Pair | Tier |
|---|---|
| `basisrisk` ↔ `duskorbiter` | public |
| `startsitsam` ↔ `deephistorydan` | opt-in |
| `brothandbones` ↔ `linescoreluke` | whitelist (`yeak__`, `crustcritic`) |
| `aperture_annie` ↔ `collimationking` | **hidden — no row exists** |

`backyard_scope` is the viewer's own second persona, and it is **private**:
its audience is `aperture_annie` and `messierhunter_`. Making one of *your*
personas private is the point — this is not a separate app, it is one more
persona under the same root with an audience instead of a public.

The fork demo is one click deep: `brothandbones` whitelisted two people and
one of them repeated a whitelist-only detail in public. `/settings/identity/fork`
opens with the suspect already unchecked.
