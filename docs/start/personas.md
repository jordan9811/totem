---
pageClass: eli5
---

# Personas, explained

A persona is one of your faces online: a finsta, an alt, a work self. All of them come from one private identity that only your browser holds.

::: tip Status: works live
Making, switching and colouring personas works on the public preview today, in your browser. Cloning one is built and tested but has no button in the app yet. On the owner's private service a persona can also become its own real Farcaster account; that is built and ready, and none has been made yet.
:::

## At a glance

<DiagramRootPersonas caption="One root makes every persona by a one-way step. Other people see separate personas; which ones are yours stays sealed in your vault." />

Your **root** is the one secret your browser keeps: the same thing your 24 words write down. Every persona is worked out from it with a bit of maths, on your device. The server is told about each persona separately, and it has no table that says which personas belong to which root. {cite: notes/reports/REPORT-Z2.md > "Gate 2 — migration 006: the validator stops knowing persona → root"}

## What a persona has

- **Its own face.** A display name, a handle and a picture.
- **Its own posts, replies and likes.**
- **Its own feed settings.** Modes, rules and a lens, so your work self can read differently from your finsta.
- **Its own colour.** A tint on the app's frame, plus the handle written in a pill at the top of every page, so you always know who you are posting as.
- **Its own keys.** Each persona signs what it does with its own key, worked out from your root.

## What your personas share

Be clear on this one, because it surprises people:

- **Your follows.** On one device, all your personas read one follow list. Cloning a persona does not copy or hide follows; it tells you how many it shares. On Farcaster, two accounts that follow the same people look related, so think about who each persona follows. {cite: SECURITY-POSTURE.md > "17. Ergonomics (Post-deploy pass): what the persona cue promises, what the cross-persona view costs, what compartment mode is and is not, what a delivery tier decides, and what readwise records about the reader"}
- **Your reading progress.** A long article you read as one persona counts as read for all of them, because one person is doing the reading.
- **Your device.** One browser holds all of them.

## Kinds of persona

- **Public.** Anyone can see its posts.
- **Private.** Only people you grant can see its posts at all. Everyone else sees nothing. There is no button to grant anyone yet, so today a private persona's posts are seen by you alone. See [Who sees what](/start/who-sees-what).

## Handy tools

- **Clone.** Start a new persona from an existing one, with fresh copies of its modes, rules and folders, so changing one leaves the other alone. Built and tested; it has no button in the app yet.
- **Tint.** Give each persona a colour, under **Manage modes & bindings** in the mode menu. The eight colours were picked by measuring them against three common kinds of colour blindness, and a colour that looks too close to one you already use is refused.
- **Compartment mode.** One tap narrows the whole app to the persona you are using: the switcher, search and the act-as menu stop showing the others. Useful when someone is looking at your screen.

## The obvious questions

### Can people tell my personas are the same person?

Not from anything Totem shows them, but do not rely on it yet. Our server keeps the link sealed. It can still guess from your connection: the same internet address and related timing. Your habits can give you away too. That is why the privacy label says DEMO for now. {cite: SECURITY-POSTURE.md > "2. What the operator can still do"}

### How many personas can I make?

As many as you like. There is no persona limit in the app. The server only limits how fast one device writes, at 2,000 signed writes an hour by default, which normal use does not reach.

### Is a persona a Farcaster account?

On the public preview, no: personas live inside Totem. On the owner's private service a persona can get its own real Farcaster account, with its own number and handle. That costs about $0.35 to $0.90 each, is built and ready, and none has been made yet. See [What reaches Farcaster](/start/farcaster).

### Where do a persona's posts go?

Each persona has a setting under the Post box, "Posts from @persona go": through @anon, a shared Farcaster account with no name on it (the default for a persona without its own account), in Totem only, or to its own account once it has one. Through @anon, each person gets 4 anonymous posts every 6 hours, shared across their personas. Built, test data only, on the owner's private service; on the public preview anonymous posting is not available yet, and posts stay in Totem. See [Anonymous posts](/features/anon-posting).

### What about my own Farcaster account?

On the public preview you can sign in with it: it appears as your "public self", marked "that's me". Built, test data only, deployed on 2026-10-11 and not yet used there. See [Sign in with Farcaster](/mechanism/sign-in-with-farcaster). Posting as it is its own step, Allow Totem to post as you, with a key in your vault that no persona shares: built, test data only, not deployed yet. See [Post as you](/mechanism/post-as-you).

### Who can tell which persona wrote an anonymous post?

The people you put in a ring that sees that persona's anonymous posts, and nobody else: everyone else sees plain @anon. Each anonymous post carries a sealed note of one fixed size that only those people's devices can open. Built, test data only, deployed 2026-10-12 and not yet used. See [Who sees what](/start/who-sees-what). {cite: SECURITY-POSTURE.md > "24. Rings and ring notes (Persona launch P4): what the drop, the operator and a member learn"}

### What does launching a persona mean?

When a persona is ready, you can launch it: it gets its own Farcaster account, and every anonymous post it made is revealed at once as its own. Before anything happens, a preview lists every post it will link and what that gives away (your posting hours, your style, the follower tier those posts proved), and you confirm by typing its handle. The account is made by Totem, not by your wallet, and appears 2 to 48 hours later at a random time. It is permanent: there is no undo and no partial launch. Your other personas stay hidden. {cite: SECURITY-POSTURE.md > "26. Launch (Persona launch P6): a persona's own account, on test data"}

Built, test data only, on the owner's private service, against a simulated registrar that creates nothing on Farcaster; deployed 2026-10-12 and not yet used. On the public preview it is coming soon: anonymous posts made there (built on test data, not deployed yet) stay inside the preview, and launching from there needs the Totem registrar. See [Launching a persona](/features/launch).

### Can I delete a persona's link to me later?

Totem publishes a link only when you choose to: a public-link grant, revealing that you wrote an anonymous post (visible to readers of this Totem server; nothing changes on Farcaster), or two of your accounts interacting on Farcaster. A grant can be revoked, and revoking it removes the merged view for that person. A reveal or a public interaction cannot be taken back. {cite: SECURITY-POSTURE.md > "14.1 Anon-post attribution (the anoncast reveal) — what a reveal costs"}

### What happens to my personas if I lose my 24 words and my passkey?

They are gone. Nobody, including the owner, can restore them. Write the words down. {cite: SECURITY-POSTURE.md > "16. Custody and topology (Browser keystore pass): what the browser holds, what the server holds, what each save path trusts, what root linking does and does not do"}

## Read more

- [Personas, the feature page](/features/personas): cloning, tint and compartment mode in detail.
- [One root, many personas](/mechanism/key-hierarchy): how the keys are worked out, for crypto readers.
