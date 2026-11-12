---
pageClass: eli5
---

# Bring your X

Bring your X history into Totem and see which people you follow on X are already on Farcaster, without anyone paying X a cent.

::: warning Status: built, test data only, on both sites
Version 1 is built and has only ever read a synthetic test archive of 3,000 posts (and a small fixture on the owner's test copy). It has not run with a real X archive; it was deployed to both sites on 2026-10-11 and has only run on test data so far. The list it matches your follows against is not switched on anywhere yet, so "find your people" says the list is not available. Following the people it finds, from Totem, comes later. Nothing in it calls X, and it costs nothing. {cite: SECURITY-POSTURE.md > "22. Bring your X (Persona launch P2): what the validator, the index source and the network learn from an archive import"}
:::

## At a glance

<ol class="flow">
  <li><strong>You</strong>Ask X for your archive. It arrives as a ZIP, usually within a day or two</li>
  <li><strong>You</strong>Drop the ZIP, or its extracted folder, into Settings, Import from X</li>
  <li class="flow__us"><strong>Your browser</strong>Reads it right there: your posts, who you follow, and only what you turn on</li>
  <li class="flow__us"><strong>Your browser</strong>Matches your follows against a public list of Farcaster accounts that verified an X account</li>
  <li class="flow__soon"><strong>You</strong>See "N of the people you follow on X are on Farcaster", and follow them from Totem (coming later)</li>
</ol>
<p class="flow__note">Steps 1 to 4 are built, test data only; the dashed step is not built. The list in step 4 is off until the owner switches it on.</p>

<DiagramXMatch caption="Built on test data. Your browser downloads the same public file as everyone else and finds the matches itself, so the server does not learn whose follows matched." /> <!-- uncited-ok: describes the design of a feature built on test data only; the posture's section 22 is cited above and below -->

## How to bring it in

1. **Ask X for your archive.** On X: Settings, Your account, Download an archive of your data ([x.com/settings/download_your_data](https://x.com/settings/download_your_data)). X takes a day or more.
2. **Open Settings, Import from X** in Totem.
3. **Drop in the ZIP**, or pick its extracted folder. The page says: "The archive file never leaves this browser.", and that only the parts you pick are saved, sealed. An archive of 4 GB or more has to be extracted first: pick its data folder instead. {cite: SECURITY-POSTURE.md > "22. Bring your X (Persona launch P2): what the validator, the index source and the network learn from an archive import"}
4. **Check what was read** ("We read @you: N posts, K people you follow…"), pick the persona it goes into, and choose what to keep.
5. **Import.** Your posts land on a "From X" shelf on that persona's profile, with their original dates.

## What is kept, and what is not

- **Your posts**, with their original X dates. Retweets are hidden by default; you can show them. Up to 20,000 posts: a bigger archive offers "import the newest 20,000".
- **Who you follow**, sealed, up to 10,000, so Totem can match them on your device. This one comes with a warning (below).
- **Your likes**: off unless you turn them on, up to 500.
- **Your ad interests**, from X's archive, with sensitive ones held back.
- **Not read at all:** your messages and your photos and videos. Your email address and phone number are dropped as the file is read.

Everything kept is sealed and saved in pieces, so a big archive fits. {cite: SECURITY-POSTURE.md > "22. Bring your X (Persona launch P2): what the validator, the index source and the network learn from an archive import"}

## The fingerprint warning

Before it imports who you follow, the page says, in these words: "Importing who you follow into @persona ties it to @xhandle: a follow list is a fingerprint. If @persona is not meant to be your X self, pick another persona or skip this lane." You tick a box to go on. Import your follows into the persona that is meant to be your X self, and skip that part for the others. {cite: SECURITY-POSTURE.md > "22. Bring your X (Persona launch P2): what the validator, the index source and the network learn from an archive import"}

## Find your people

**How it works.** Farcaster publishes, for free and with no key, every Farcaster account that verified an X account, with that X account's number. Your archive lists who you follow by the same number. A Totem server copies the public list into one file each night; your device downloads the whole file and finds the overlap. About 397,000 Farcaster accounts have verified an X account.

**Status.** 🔵 Built, test data only: tested against a local stand-in list. The real list is off on every site until the owner switches it on, so the panel says "the matching list isn't available on this site yet" instead of showing zero matches. Following the people it finds from Totem is 🟣 coming later.

## "Verified on Farcaster"

A persona shows "X @handle, verified on Farcaster" only when that persona's own Farcaster account has verified the X account, read from the same public list. On the public preview, personas have no Farcaster account of their own yet, so it does not show there. On the owner's test copy, a typed handle is a test link and says "test link, not verified". 🔵 Built, test data only.

## Your X history

Your old posts appear as a dated "From X" shelf on the persona's profile. **Show as new in my Totem feed** puts one back into your own Totem feed; that stays inside Totem and posts nothing anywhere. 🔵 Built, test data only. Re-sharing one to Farcaster, one at a time and labelled with its original date, is the owner's call and not built.

## Paid extras: posting to X, syncing bookmarks, logging in with X

These need an X developer account with a card on file. X charges per use, with no free tier: about $0.015 a post, $0.20 for a post with a link. 🟣 Coming soon, and only on the owner's yes. Version 1 does not need any of it.

## The obvious questions

### Does X charge for this?

No. Version 1 uses only the archive X gives you and free Farcaster data.

### Does the archive get uploaded?

The archive file stays in your browser: the page reads it there, and only the parts you pick are saved, sealed. On the owner's private service, the owner's own browser reads it and the service's server saves the pieces. {cite: SECURITY-POSTURE.md > "22. Bring your X (Persona launch P2): what the validator, the index source and the network learn from an archive import"}

### Will Totem see who I follow on X?

Not in plain form. Your follow list is saved sealed and matched on your device, against a file that every visitor downloads in full. The server can tell that you imported an archive, roughly how big it is, and when you opened Find your people. {cite: SECURITY-POSTURE.md > "22. Bring your X (Persona launch P2): what the validator, the index source and the network learn from an archive import"}

### What about my bookmarks?

X's archive does not include bookmarks. Reading them would need the paid X access above.

### Can I log in to Totem with X?

Not built, by decision: it needs the paid X access. You can sign in with Farcaster, read-only, and bring your X with the archive.

### When will it work for real?

When it has run with a real archive. The owner is requesting his own; the closing run imports it on both sites, through a reload and a restart. Only then are the statuses changed.

## Read more

- [Bring your X, the feature page](/features/interop): every X piece and its true status.
