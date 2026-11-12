# Linkage and disclosure

Posts are public, the link between your personas is private, and showing that link to someone is a signed grant you choose to issue. Today a grant resolves only inside the vault that holds it.

::: warning Status: built for one vault; the version for friends elsewhere is built as rings, test data only
<span class="st st--test">Built, test data only</span>: grants (linkage, forward, audience), private personas and root links. They resolve inside one vault, which on the public preview means inside your own browser: a friend on another device or in another app sees none of it. <span class="st st--test">Built, test data only</span>, deployed 2026-10-12 (Persona launch P4): "show my personas to a friend" across devices and deployments, through a sealed dead drop, as up to 16 rings at two depths, plus a ring note on every anon post so a persona's anon posts read as plain anon to people you have not listed. See [Rings and ring notes](/mechanism/rings). No button in the app issues a one-to-one grant yet. The Settings pane labelled Public / Followers / Inner circle / Hidden drives an older model that the identity renderer does not read, so its choice does not change linkage or who sees your posts. It does gate one thing: a non-owner sees a persona's stake history only if that older model's `canViewLinkage` admits them (`lib/influence/stakes.ts`, `historyFor`). {cite: notes/reports/REPORT-CUSTODY.md > "Stage 3 — the browser device — GREEN"}
:::

The verdict: the disclosure model is the cleanest part of the design and the least deployed. Every disclosure reduces to a pairwise claim, signed by the persona whose link is disclosed, and "hidden" is the absence of any claim rather than a flag a server could read. One renderer resolves every identity on every surface and fails toward less disclosure. What it lacks is reach: a grant names a persona id that only means something inside the process holding the issuer's vault, and there is no transport yet that carries a grant to a friend somewhere else. The network is the other gap. Personas that post on Farcaster can be linked by what they do there, by how their accounts were created, and by Neynar, whatever the grants say. {cite: notes/design/architecture-v3.md > "The grant is the atom"}

## At a glance

<ol class="flow">
  <li><strong>Issue</strong>Your persona signs a grant naming the pair and the audience.</li>
  <li><strong>Seal</strong>The grant goes into the vault namespace grantsV3, sealed under your vault key.</li>
  <li class="flow__us"><strong>Resolve</strong>One renderer checks grants for every identity it draws, on every surface.</li>
  <li><strong>Show</strong>A granted viewer sees the link; everyone else sees separate personas.</li>
  <li><strong>Revoke</strong>Re-sign with a revocation time; the next resolution drops it.</li>
</ol>
<p class="flow__note">All five steps happen inside one vault's process today. A viewer in another browser is not reached.</p>

<figure class="diagram">
<svg viewBox="0 0 400 396" role="img" aria-labelledby="ld-t ld-d" xmlns="http://www.w3.org/2000/svg">
<title id="ld-t">Who sees what</title>
<desc id="ld-d">Six rows from the widest audience to the narrowest. Everyone sees your public personas as separate accounts, on the owner service. Viewers you grant see a private persona's posts. Viewers you whitelist see that two personas are one person. Both of those are built for one vault. A friend on another device gets the same through a dead drop, built as rings on test data. Deeper tiers are the rings' two depths, also built on test data. Everyone else finds no grant at all.</desc>
<rect class="dg-box dg-box--network" x="1" y="1" width="398" height="58" rx="8"/>
<text class="dg-text" x="14" y="24" font-weight="600">Everyone</text>
<text class="dg-tiny" x="386" y="24" text-anchor="end">owner service</text>
<text class="dg-sub" x="14" y="44">your public personas, as separate accounts</text>
<rect class="dg-box" x="1" y="67" width="398" height="58" rx="8"/>
<text class="dg-text" x="14" y="90" font-weight="600">Viewers you grant</text>
<text class="dg-tiny" x="386" y="90" text-anchor="end">built, one vault</text>
<text class="dg-sub" x="14" y="110">a private persona's posts (audience grant)</text>
<rect class="dg-box dg-box--us" x="1" y="133" width="398" height="58" rx="8"/>
<text class="dg-text" x="14" y="156" font-weight="600">Viewers you whitelist</text>
<text class="dg-tiny" x="386" y="156" text-anchor="end">built, one vault</text>
<text class="dg-sub" x="14" y="176">that two personas are one person (linkage grant)</text>
<rect class="dg-box" x="1" y="199" width="398" height="58" rx="8"/>
<text class="dg-text" x="14" y="222" font-weight="600">A friend on another device</text>
<text class="dg-tiny" x="386" y="222" text-anchor="end">built as rings, test data</text>
<text class="dg-sub" x="14" y="242">the same, sealed in a dead drop</text>
<rect class="dg-box" x="1" y="265" width="398" height="58" rx="8"/>
<text class="dg-text" x="14" y="288" font-weight="600">Deeper tiers, Top 16 style</text>
<text class="dg-tiny" x="386" y="288" text-anchor="end">rings, test data</text>
<text class="dg-sub" x="14" y="308">up to 16 rings, two depths; anon for the rest</text>
<rect class="dg-box dg-box--off" x="1" y="331" width="398" height="58" rx="8"/>
<text class="dg-text" x="14" y="354" font-weight="600">Everyone else</text>
<text class="dg-tiny" x="386" y="354" text-anchor="end">the default</text>
<text class="dg-sub" x="14" y="374">no grant exists, so there is nothing to find</text>
</svg>
<figcaption>Hidden is the default and it is an absence: no row, no flag. Each wider audience is something you add, one signed grant at a time.</figcaption>
</figure>

## The grant

```ts
interface Grant {
  id: string;
  fromPersona: string;     // the persona whose link is disclosed (the signer)
  toPersona: string;       // its sibling; equal to fromPersona for an audience grant
  audienceMember: string;  // a persona id, or "*" for an open audience
  tier: "public" | "opt_in" | "whitelist";
  kind?: "linkage" | "forward" | "audience";
  issuedAt: number;
  revokedAt: number | null;
  signature: string;       // Ed25519, by fromPersona's key
}
```

Three kinds share the row and never share a resolver: **linkage** says "these two personas are the same person, now"; **forward** says "this persona moved to that one"; **audience** says "this viewer may see this persona's private posts". The canonical form the signature covers includes `kind`, so a signed linkage cannot be reread as a forward pointer, and includes `revokedAt`, so a revocation is itself a signed claim made by re-signing. {cite: notes/reports/REPORT-CRYPTO.md > "GATE 0 DESIGN — the key hierarchy"}

The audience levels live in the data, not as a setting on a persona:

| Level | Representation |
|---|---|
| Public | one grant, audience `"*"`, tier `public` |
| Opt-in | one grant, audience `"*"`, tier `opt_in`; seeing it takes a request, and the requester is recorded for the owner |
| Whitelist | one grant per named viewer, tier `whitelist` |
| Hidden | no grant exists; tests assert the absence |

Resolution runs through one `PersonaResolver` for timeline cards, search results, notifications, embeds, folder cards, profile headers and every other surface that draws an identity. A grant check that errors shows the bare persona. {cite: notes/design/architecture-v3.md > "One identity renderer"}

## Private personas

A private persona's posts stay out of the cast write path, rejected at the adapter rather than hidden in the interface, and are sealed in the vault. They render only to viewers holding an audience grant. {cite: notes/design/architecture-v3.md > "Three account types"}

## Root links

Two roots that belong to one person can be linked, not merged: a grant `{rootA, rootB, issuedAt}` co-signed by both roots' device-auth keys and sealed in both vaults. Each side then shows the other's personas beside its own. Reputation, nullifiers and personas stay separate. The validator's `root_link_grants` table records the two anchors of every completed link, so the operator learns that those two anchors are linked. {cite: SECURITY-POSTURE.md > "16. Custody and topology (Browser keystore pass): what the browser holds, what the server holds, what each save path trusts, what root linking does and does not do"}

## Forks and forward pointers

A fork creates a new persona that can carry chosen grants forward. The route mints `forkCommit = sha256("layers-fork-commit/1|old|new|nonce")` with a fresh 128-bit nonce, keeps the nonce in the sealed fork record, and gives it, with a forward pointer signed by the OLD persona's key, only to the grant holders the fork carries. At the next tick the new persona proves "a root in the gate's tier tree authorises me and attached this commitment". That proof is a vouch, not continuity: any root at that tier could make it. Continuity rests on the signed pointer, which a carried holder checks together with the claim. The validator records the new persona and the commitment and never sees the old persona; it cannot test a guessed pair without the nonce. {cite: SECURITY-POSTURE.md > "11. Fork continuity as a proof, revocation via epoch re-issuance, attestation scaffolding (ZK Pass 2, Gate 3)"}

Delivery of a forward pointer to a holder on another device is not built; today it resolves inside one process, like every grant. {cite: SECURITY-POSTURE.md > "Assumed, by id (this pass did not fix these; they are the honest state)"}

## Blocking, without roots

A block is persona to persona: one validator row per block action. Your device applies the union of your own personas' block lists when it reads, so a persona you create tomorrow shares your blocks at once. The other direction is gone: blocking `@a` does not block `@a2` of the same account, and the interface says so when you block. A server that could fan a block out across an account's personas could also answer whether two personas are one person. {cite: SECURITY-POSTURE.md > "10. What zk cost us: root-level block fan-out (ZK Pass 2, Gate 2)"}

## Where a grant resolves today: one vault

The resolver reads the grants in the process that holds the issuer's vault. A grant's audience is a local persona id, which means nothing in another vault. On the public preview every visitor's vault starts empty and the seeded grant graph is skipped, so no grant crosses between two visitors, even on the same deployment. On the owner service, grants resolve inside the owner's own process. {cite: notes/reports/REPORT-CUSTODY.md > "Stage 3 — the browser device — GREEN"}

Two consequences worth stating. The Settings disclosure pane writes to an older per-persona level model that the resolver does not consult, so it is being relabelled "not active yet" and will be folded into the grant model. And the X features that issue grants (alt-linking, relationship porting) inherit the same one-vault reach.

## Built as rings: the dead drop

"Show my accounts to a friend" is built as rings (Persona launch P4), on test data only, deployed 2026-10-12. The mechanism is on its own page, [Rings and ring notes](/mechanism/rings). What changed from the written design (`research/spec-friend-whitelist-2026-10-08.txt`): {cite: SECURITY-POSTURE.md > "24. Rings and ring notes (Persona launch P4): what the drop, the operator and a member learn"}

- **Every device publishes, not only the owner service.** Version 1 of the design let only the owner service write, with a write token. The build is multi-writer: a write is signed by a registered device and padded to buckets of 4 (plan D8), with no token anywhere. The cost: the operator sees which device writes, when and roughly how much (A-RING-WRITER-IS-THE-DEVICE).
- **Rings, not one-to-one grants.** Up to 16 named rings, each holding up to 32 addresses or links; each of your public personas is shared per ring at "name" or "posts".
- **A note on every anon post.** At "posts", the ring's members also learn which anon posts the persona wrote, from a 256-byte note on every anon post, real or random, bound into the proof.
- **Fixed size, end to end.** One 4,096-byte plaintext per envelope; every row the same length; a 72-hour lease renewed by an hourly re-seal; the previous generation swapped out atomically.
- **Unchanged from the design:** HPKE in PSK mode; the address and PSK derived from the friend's root and recovered by the 24 words plus the vault (which holds the address nonces); the whole drop read on the uniform prefetch tick; a failed read is "unknown", neither shown nor dropped; the `/d#` link card for a friend in a plain Farcaster app; no signatures (deniable); the named residuals (the count, a kept envelope until its lease, no forward secrecy, reader addresses without OHTTP).
- **Still open:** owner-service rings reaching public-site members (the drop must live on the public validator, A-RING-OWNER-SERVICE-DROP), proof-authorized anonymous writes and designated-verifier tags (v1.1).

## The pitch, against the code

| The promise | Today |
|---|---|
| Decide who can see which of your personas | Audience and whitelist grants: <span class="st st--test">Built, test data only</span>, inside one vault |
| Each tier gets a deeper version of you | <span class="st st--test">Built, test data only</span>, as up to 16 rings at two depths; deployed 2026-10-12, not yet used |
| People you have not listed see your posts as anon, or not at all | "Not at all" is how a private persona works now, inside one vault. A persona's anon posts read as plain @anon to anyone outside the rings that see them: <span class="st st--test">Built, test data only</span>. Blanking a persona's ordinary posts as anon is <span class="st st--soon">Coming soon</span> |
| Link your personas securely; no one sees the links, not even us | On the public preview the grants are ciphertext the validator stores padded to 1 KiB steps, and root links leave an anchor pair. On the network the links are yours to avoid making, and Neynar sees every account it manages {cite: SECURITY-POSTURE.md > "Assumed, by id (the honest state; not fixed by this pass)"} |

## What this does not protect

- **What you do on the network.** Two of your accounts replying to, liking or following each other publishes that edge on Farcaster. Follows belong to the device, so personas that follow the same set are comparable by anyone. {cite: SECURITY-POSTURE.md > "Assumed, by id (the honest state; not fixed by this pass)"} {cite: SECURITY-POSTURE.md > "Assumptions added by this pass (by id)"}
- **How the accounts were made.** Registration times sit on chain and in the fname registry; the crowd is Neynar's volume in that window. The registrant was read on 2026-10-07: the developer's own Neynar app wallet, which also registered the Totem-named test account and its pool in one burst, so personas drawn from it are linked onchain to each other and to that account by their sender and their adjacent numbers; the signer-request fid (6131) and the recovery proxy are shared by every Neynar-registered account and link nobody. The rent payer is still unread (VERIFY-YOURSELF F21). {cite: SECURITY-POSTURE.md > "Assumed, by id (the honest state; not fixed by this pass)"}
- **Neynar.** One developer credential creates, signs for and writes as every persona account; Neynar can join all of it. {cite: SECURITY-POSTURE.md > "Assumed, by id (the honest state; not fixed by this pass)"}
- **A friend you told.** Revoking stops future resolution. It does not make anyone forget.
- **Your X self.** Importing your X follow list into a persona ties that persona to your X account, because a follow graph is a fingerprint. The planned "Bring your X" step will warn about this.
- **Size.** Sealed namespaces grow in 1 KiB steps, so the operator learns roughly how many grants you hold, never whom. {cite: SECURITY-POSTURE.md > "Assumptions added by this pass (by id)"}

## The obvious questions

### If I whitelist a friend today, what do they see?

On the public preview, nothing: their browser holds a different vault, and a grant naming a persona id there resolves to no one. Whitelisting is useful today only between personas that live in the same vault, which is how the demo world shows it. Rings are the fix, built on test data and deployed on 2026-10-12, not yet used.

### Can a friend prove the link to someone else?

With today's grant format, the claim is signed by your persona's Ed25519 key, so a copy is evidence anyone can check. That is why rings deliberately carry no signatures: the friend could have produced the same bytes, so a leak is their word against yours. {cite: SECURITY-POSTURE.md > "24. Rings and ring notes (Persona launch P4): what the drop, the operator and a member learn"}

### Why does blocking one of someone's personas not block the rest?

Because the validator no longer knows which personas share an account, and the only way to fan a block out would be to teach it. You can still block each persona you see. A cohort-level alternative is written up in [the fan-out memo](/fanout-under-zk).

## Where it lives in the code

- `lib/identity/grants.ts`: the grant, the kinds, the canonical form, resolution.
- `lib/identity/resolver.ts`, `lib/identity/verifiedGrants.ts`: the one renderer and its checks.
- `lib/identity/fork.ts`, `app/api/identity/fork/route.ts`: forks and forward pointers.
- `lib/device/rootlink.ts`, `validator/custody.js`: root links and their relay.
- `lib/rings/*`, `validator/ringdrop.js`, `app/d/page.tsx`: rings, the dead drop and the link card ([Rings and ring notes](/mechanism/rings)).
- `components/settings/DisclosurePane.tsx`, `lib/adapters/mock/disclosure.ts`: the older pane and model that the resolver does not read.
- Source of the model: `notes/design/architecture-v3.md`.
