---
pageClass: eli5
---

# Who sees what

Show chosen people which personas are you, in up to 16 rings, and keep a private persona's posts for the people you grant.

::: warning Status: rings built, test data only, deployed 2026-10-12
Rings are built and tested on test data: on a laptop copy of the owner's service, on a local copy shaped like the public preview (test-page browsers standing in for strangers' devices, a friend's link card) and in a node-only harness. They were deployed to both sites on 2026-10-12, and nobody has used them on a real site yet. On the public preview nobody can post anonymously yet (the prover in your browser is built on test data and arrives with the next deploy), so a ring there has no anonymous posts to point at: it works as a list, under "Rings you are in", of which personas are yours. On the owner's private service, rings publish to that service's own server, which people on the public preview do not read. One-to-one grants and private personas are built in code and have run only in tests and the demo data; no button makes a grant. The Settings page "Privacy & Disclosure" does not change who can link your personas or who sees your posts; it only decides who may view a persona's stake history. The plain-words version is [Who sees what](/start/who-sees-what). {cite: SECURITY-POSTURE.md > "24. Rings and ring notes (Persona launch P4): what the drop, the operator and a member learn"}
:::

## At a glance

<ol class="flow">
  <li><strong>A friend</strong>Makes a private address in Settings › Rings and hands it to you, over Signal or in person</li>
  <li><strong>You</strong>Add it to a ring, and pick each public persona's depth: that it is you, or also its anonymous posts</li>
  <li class="flow__us"><strong>Totem</strong>Seals one fixed-size note per member and publishes them about hourly, padded with dummies to groups of 4</li>
  <li class="flow__us"><strong>Totem</strong>Every device reads the whole mailbox and the anonymous post list on its background check; only members' notes open</li>
  <li><strong>That friend</strong>Sees "@persona · shared with you by <em>the name you chose to be shown as</em>" (your Farcaster name, or "a friend"; not the ring's own name) and a half-and-half picture; everyone else sees plain @anon</li>
</ol>
<p class="flow__note">Built, test data only. What a member received lives in their device's memory and is rebuilt on every check; if a check fails, the merge is hidden until the next one works, not shown on a guess.</p>

## The parts

**Rings.** 🔵 Built, test data only, deployed 2026-10-12. Up to 16 named rings of up to 32 members each. A member is a private address someone handed you, or a link for someone without Totem; your device learns an address, never who holds it. For each ring and each of your public personas you pick a depth: **that it is you** (the persona is listed under "Rings you are in" on the member's device, and a persona with its own Farcaster account shows the half-and-half picture, your main account on the left, the persona on the right) or **also its anonymous posts** (which of your anonymous posts it wrote). Private personas and your read-only Farcaster account are never shared through a ring. {cite: SECURITY-POSTURE.md > "24. Rings and ring notes (Persona launch P4): what the drop, the operator and a member learn"}

**Ring notes.** 🔵 Built, test data only. Every anonymous post carries a sealed note of exactly 256 bytes: a real one only the rings that see that persona's posts can open, or random bytes. A post with an audience looks the same as one without, and the note is tied to its post, so it cannot be moved to another. Adding someone moves the persona's key one step forward, so a new member does not open older posts and everyone already in the audience keeps theirs; removing someone or lowering a ring starts a new key, so a removed member does not open newer posts. {cite: SECURITY-POSTURE.md > "24. Rings and ring notes (Persona launch P4): what the drop, the operator and a member learn"}

**Links for friends without Totem.** 🔵 Built, test data only. A ring can hold a link instead of an address. It opens a private card on the Totem site that reads the note in the visitor's browser, with no account and no identity made; nothing appears inside their Farcaster app. The key is in the part of the link after `#`, which no server receives, and in their browser history. {cite: SECURITY-POSTURE.md > "24. Rings and ring notes (Persona launch P4): what the drop, the operator and a member learn"}

**One-to-one grants.** 🔵 Built in code, with no button. A public link shows a "Linked identities" section to everyone; opt-in and whitelist grants show a merged card to one person. Each is one person (or everyone) and one link between two personas, signed by your persona's key, and resolves only inside the copy of Totem that holds it. {cite: notes/reports/REPORT-MEGA.md > "GATE 1 — Disclosure tiers — **CLOSED** (2 iterations, 3 donated forward)"}

**Private personas.** 🔵 Built, test data only. A private persona's posts reach only granted people. They are missing from everyone else's data, not just hidden on screen, and every surface that could show them goes through one check; if that check fails, even granted people lose sight of them until it works again. {cite: notes/reports/REPORT-MEGA.md > "GATE 3 — Private personas as a product — **CLOSED** (3 iterations)"}

**The older Settings page.** "Privacy & Disclosure" (Public, Followers, Inner circle, Hidden) belongs to an earlier model that rings and grants do not read. Its choices decide one thing: who may view a persona's stake history.

## The obvious questions

### Can a friend on the public preview see my rings today?

Not tried yet. Rings were deployed on 2026-10-12, and a friend on the public preview can read a ring made on the public preview: their device lists which of your personas are you (there are no anonymous posts on the deployed site yet; posting them from your browser is built on test data and not deployed, and no test has yet shown a ring member reading one there). Nobody has done it on the deployed site, only on a local copy shaped like it. A ring made on the owner's private service lives on that service's own server, which the public preview does not read; moving it is the next step. {cite: SECURITY-POSTURE.md > "24. Rings and ring notes (Persona launch P4): what the drop, the operator and a member learn"}

### What does the server learn?

Sealed rows of one fixed size, with no persona, ring, name or recipient attached, and nothing that says which rows belong to one member. It does learn which device publishes, about how many rows (in groups of 4) and when, and it keeps a record of which devices have ever published; a removal, as one deleted row at the moment you click; and every reader's internet address. {cite: SECURITY-POSTURE.md > "24. Rings and ring notes (Persona launch P4): what the drop, the operator and a member learn"}

### Can a member prove the link to someone else?

No. Notes carry no signature, so a member who passes one on passes on a claim, not proof. The flip side: a member holds the same key as the rest of the ring, so they could tag one of their own anonymous posts as your persona's for everyone else in it. Signed notes are a later version. {cite: SECURITY-POSTURE.md > "24. Rings and ring notes (Persona launch P4): what the drop, the operator and a member learn"}

### Why does my device publish signed?

So that only registered devices can write to the mailbox, without a password anyone could copy. The cost is that the server sees which device writes, and keeps a record of which devices have. Writing anonymously, authorized by a proof, is a later version. {cite: SECURITY-POSTURE.md > "24. Rings and ring notes (Persona launch P4): what the drop, the operator and a member learn"}

### Does every device download every note?

Yes, the whole mailbox, every check, whether it is in a ring or not, so the download says nothing about who reads what. At the mailbox's cap that is about 34 MB a check; it grows with use. {cite: SECURITY-POSTURE.md > "24. Rings and ring notes (Persona launch P4): what the drop, the operator and a member learn"}

### What happens when I remove someone, or delete a ring?

They stop being sent anything new, and your record of them is kept, not erased: Settings › Rings › Recently removed lists the people you removed and the rings you deleted, with a Restore button ("People you removed and rings you deleted are kept here, not erased, so you can bring them back."). A restored person starts again from the moment you restore them, so they never open what you posted while they were removed. Built in the go-live build, test data only. {cite: SECURITY-POSTURE.md > "24. Rings and ring notes (Persona launch P4): what the drop, the operator and a member learn"}

## What this does not protect

- **The count and the timing** of your device's publishing, rounded to groups of 4.
- **Internet addresses**, on every check, until an outside relay is set up.
- **What a removed member already has.** They keep the keys they were sent.
- **A post from your other device, right after a removal.** Until that device next checks, for up to about 25 minutes, it can still use the key the removed member holds.
- **How many people joined, between two notes.** A member who reads two of your notes can work out exactly how many times that persona's audience grew in between, in any ring, and that someone was removed.
- **A member who forges.** One of their own anonymous posts can be made to look like yours to the rest of the ring.
- **A compromised device of yours.** Your vault holds every member's key, so whoever takes it can write notes to them until they forget your address.

{cite: SECURITY-POSTURE.md > "24. Rings and ring notes (Persona launch P4): what the drop, the operator and a member learn"}

## Where it lives in the code

Rings: `lib/rings/` (the model, envelope, note, publisher and member side), `validator/ringdrop.js` (the mailbox), `app/api/rings/route.ts`, `components/settings/RingsPane.tsx`, `components/rings/` (the half-and-half avatar, the link card) and `app/d/page.tsx`. Grants: `lib/identity/grants.ts` and `lib/identity/verifiedGrants.ts`. The resolver every page asks: `lib/identity/resolver.ts`. Private posts: `lib/private/visibility.ts`. The older pane: `components/settings/DisclosurePane.tsx`. For the design, see [Rings and ring notes](/mechanism/rings) and [Linkage and disclosure](/mechanism/linkage-and-disclosure).

## The record

For auditors: each line is tagged in the internal vocabulary and cites the report or posture section it comes from.

- **[SHIPPED-FIXTURE]** Rings (Persona launch P4): up to 16 rings at two depths, device-signed publishing padded to 4, the open shuffled drop, members' memory-only reads, render from memory, the `/d` link card; tested on the rig and the production shape; deployed 2026-10-12, not yet used. {cite: SECURITY-POSTURE.md > "24. Rings and ring notes (Persona launch P4): what the drop, the operator and a member learn"}
- **[SHIPPED-FIXTURE]** The 256-byte ring note on every anon post, bound into the proof; a new key generation on every audience change (one step along the chain on an add, so a newcomer cannot open older posts; a fresh chain on a removal or lowering, so a removed member cannot open newer ones). {cite: SECURITY-POSTURE.md > "24. Rings and ring notes (Persona launch P4): what the drop, the operator and a member learn"}
- **[SHIPPED-FIXTURE]** Disclosure tiers over grants, merged rendering, revoke, the resolver showing less on failure; resolves only inside one deployment. {cite: notes/reports/REPORT-MEGA.md > "GATE 1 — Disclosure tiers — **CLOSED** (2 iterations, 3 donated forward)"}
- **[SHIPPED-FIXTURE]** Private personas: absent from the non-granted data path, one chokepoint, failure forced and tested. {cite: notes/reports/REPORT-MEGA.md > "GATE 3 — Private personas as a product — **CLOSED** (3 iterations)"}
- **[SPECCED]** Owner-service rings reaching public-site members (the drop on the public validator), and proof-authorized anonymous writes (v1.1). {cite: SECURITY-POSTURE.md > "24. Rings and ring notes (Persona launch P4): what the drop, the operator and a member learn"}
- **[IDEA]** Blanking a persona's ordinary posts as anon for people not in a ring. <!-- uncited-ok: owner's pitch, not yet designed -->
