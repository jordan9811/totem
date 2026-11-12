---
pageClass: eli5
---

# Who sees what

You pick who gets to know which personas are you. Think of a MySpace Top 16: up to 16 rings of people, each seeing a deeper version of you.

::: warning Status: built, test data only, deployed 2026-10-12
Rings are built and tested on test data, on a laptop copy of the owner's service and on a local copy shaped like the public preview. They were deployed to both sites on 2026-10-12, and nobody has used them on a real site yet. Two limits today. On the public preview nobody can post anonymously yet (the prover in your browser is built on test data and arrives with the next deploy), so a ring there can show who your personas are but has no anonymous posts to point at. On the owner's private service, rings are published to that service's own server, so people on the public preview cannot read them yet. One-to-one grants are built in code too, with no button in the app. {cite: SECURITY-POSTURE.md > "24. Rings and ring notes (Persona launch P4): what the drop, the operator and a member learn"}
:::

## At a glance

<ol class="flow">
  <li><strong>Your friend</strong>Opens Settings › Rings, makes a private address and sends it to you over Signal or in person</li>
  <li><strong>You</strong>Put that address in a ring, and choose what the ring sees of each of your public personas</li>
  <li class="flow__us"><strong>Totem</strong>Seals a note only your friend's device can open and drops it, with dummies, in a shared mailbox, about every hour</li>
  <li class="flow__us"><strong>Totem</strong>Every device reads the whole mailbox on its background check; only your friend's opens the note</li>
  <li><strong>Your friend</strong>Sees "@persona · shared with you by <em>the name you chose to be shown as</em>" and a half-and-half picture on the posts you shared</li>
</ol>
<p class="flow__note">Built, test data only. Everyone else sees each persona on its own, and your anonymous posts as plain @anon. Someone without Totem gets a link instead of an address (below).</p>

## Rings

<DiagramWhoSees caption="One way to set up rings, as a ladder: each ring sees one more of your personas. A ring can hold any of your public personas at either depth. Built, test data only, deployed 2026-10-12." />

A **ring** is a group of people you pick: Inner, Close, Friends, whatever you call them. You can have up to 16. For each of your public personas, you choose what each ring sees:

| Depth | What people in that ring see |
|---|---|
| **That it is you** | That @persona is one of yours. It is listed under "Rings you are in" on their device, and where the persona has its own Farcaster account, its posts show a half-and-half picture: your face on the left, the persona's on the right |
| **Also its anonymous posts** | All of that, plus which of your anonymous posts @persona wrote: "@persona · shared with you by" the name you chose to be shown as, with the half-and-half picture, on those posts |
| **Nothing** (the default) | The persona on its own, and your anonymous posts as plain @anon |

The "your face" half is your main Farcaster account, once Totem knows it (you signed in with Farcaster, or connected it on the owner's service). Private personas are never shared through a ring, and neither is your read-only Farcaster account itself. {cite: SECURITY-POSTURE.md > "24. Rings and ring notes (Persona launch P4): what the drop, the operator and a member learn"}

What exists today, and what does not:

| What | Who | What they see | Today |
|---|---|---|---|
| **No ring** | Anyone | Each public persona on its own; your anonymous posts as plain @anon | The default |
| **A ring** | Up to 32 people you add by their private address | Your chosen personas, at the depth you chose | 🔵 Built, test data only, deployed 2026-10-12 |
| **A link** | Someone without Totem | A private card on the Totem site listing the personas you shared | 🔵 Built, test data only, deployed 2026-10-12 |
| **A one-to-one grant** | One person, inside one copy of Totem | That two of your personas are you, or a private persona's posts | 🔵 Built, test data only. No button yet |

## The obvious questions

### Does anyone outside my rings see the link?

No. Every anonymous post carries a sealed note of exactly the same size, a real one or random bytes, so a post someone can read looks the same as one nobody can. The server holds only these sealed notes and learns no persona, ring or name. It does learn that your device publishes ring notes, roughly how many (in groups of 4) and when, and keeps a record that it has, and the internet address of every device that checks for them. {cite: SECURITY-POSTURE.md > "24. Rings and ring notes (Persona launch P4): what the drop, the operator and a member learn"}

### Can someone in my ring prove to others which persona is me?

No. The notes carry no signature, so a friend who passes one on passes on a claim, not proof: anyone could have written the same bytes. The flip side: everyone in a ring holds the same key for a persona, so a member could put a note naming your persona on an anonymous post of their own, and other members would read it as yours. Signed notes are a later version. {cite: SECURITY-POSTURE.md > "24. Rings and ring notes (Persona launch P4): what the drop, the operator and a member learn"}

### If I take someone out of a ring, what happens?

They stop seeing your posts from then on: removing someone, or lowering what a ring sees, gives that persona a new key for future posts that they do not have. (Adding someone moves the key one step forward instead, so the people already in your rings keep seeing your older posts.) Their note is deleted at once (which the server sees). What they already saw stays with them: they keep the keys they were given, and can still open those older posts' notes from a copy they saved. If you post from more than one device, a post from another of your devices can still use the old key for up to about 25 minutes after the removal, until that device next checks. {cite: SECURITY-POSTURE.md > "24. Rings and ring notes (Persona launch P4): what the drop, the operator and a member learn"}

### Does someone I add later see my old anonymous posts?

No. A person sees the anonymous posts made after they were added at the "anonymous posts" depth, not the ones before. {cite: SECURITY-POSTURE.md > "24. Rings and ring notes (Persona launch P4): what the drop, the operator and a member learn"}

### What about friends who do not use Totem?

Put a link in the ring instead of an address. The link opens a private card on the Totem site, read in their browser with no account made; nothing appears inside their Farcaster app. Whoever holds the link can read it, so send it over Signal or in person, never in a public post. {cite: SECURITY-POSTURE.md > "24. Rings and ring notes (Persona launch P4): what the drop, the operator and a member learn"}

### Is a ring the same as a reach tier, or a reputation tier?

No, three different things. A **ring** is the people you chose. A **reach tier** says how big the account behind an anonymous post is ("posted by an account with 10k+ followers") without saying which account. A **reputation tier** is a level a persona earns from activity, which some feeds use as a gate. See the [glossary](/start/glossary).

### Can I use rings on my phone and my laptop?

Make your ring address on the device that holds your identity. A second, linked device cannot keep a ring address yet; it says "Open this on the device that holds your identity". Your devices keep one copy of your rings in step: each re-reads it on every background check. {cite: SECURITY-POSTURE.md > "24. Rings and ring notes (Persona launch P4): what the drop, the operator and a member learn"}

### What about the "Privacy & Disclosure" page in Settings?

It is an older model, and rings do not use it. Its choices (Public, Followers, Inner circle, Hidden) do not change who can link your personas or who sees your posts. They do one thing today: they decide who may view a persona's stake history.

### What happens if the check for ring notes fails?

It shows less, not more. A device that could not read the mailbox hides what it had until the next check works, and drops nothing; a card with no ring note looks exactly like everyone else's. {cite: SECURITY-POSTURE.md > "24. Rings and ring notes (Persona launch P4): what the drop, the operator and a member learn"}

## What this does not protect

- **The count.** The server sees how many notes your device publishes, rounded up to groups of 4, and when.
- **Internet addresses.** Every device's address shows when it checks the mailbox, until an outside relay is set up.
- **What a friend already saw.** Removing someone stops future posts; it does not take back what they were sent. If you post from a second device, a post from it can still reach them for up to about 25 minutes after the removal.
- **How many people joined.** Someone in a ring who reads two of your notes can work out exactly how many times that persona's audience grew in between, in any of your rings, and that someone was removed.
- **A member who lies.** A member can make one of their own anonymous posts look like yours to the rest of the ring.
- **Your style.** Anyone who reads your anonymous posts can still guess from how you write.

## Read more

- [Who sees what, the feature page](/features/who-sees-what): rings, links and grants, with their status in detail.
- [Rings and ring notes](/mechanism/rings): the sealed mailbox and the note on every anonymous post, for crypto readers.
