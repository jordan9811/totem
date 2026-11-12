---
pageClass: eli5
---

# Bring your X

Every X feature in the code today, with its true status. Version 1, built in the persona launch pass on test data, replaces most of the old ones and costs nothing.

::: warning Status: built, test data only. Nothing here has worked with real X data
Version 1 (the ZIP or folder read in your browser, sealed saves in pieces, the keyless list of Farcaster-verified X accounts, the "verified on Farcaster" badge, the "From X" shelf) is built and has only read a synthetic 3,000-post archive and a small fixture; it was deployed to both sites on 2026-10-11 and has only run on test data so far. The list is off on every site until the owner switches it on. The old test stand-ins are relabelled: a typed handle now says "test link, not verified" and exists on the test rig only, the composer's X option is listed on the rig only, and sync refuses to call itself live. There are no X credentials on any deployment. The plain-words version is [Bring your X](/start/bring-your-x). {cite: SECURITY-POSTURE.md > "22. Bring your X (Persona launch P2): what the validator, the index source and the network learn from an archive import"}
:::

| Piece | Everyday name | Today | Next |
|---|---|---|---|
| **Archive import** | Settings › Import from X | 🔵 Built, test data only: the ZIP (read by its directory, only wanted files) or its folder, in your browser; posts, follows, likes (off by default) and ad interests kept, sealed, saved in pieces; caps 20,000 posts, 10,000 follows, 500 likes | The run with a real archive on both sites |
| **Find your X follows** | Find your people | 🔵 Built, test data only: matched on your device against a list of Farcaster-verified X accounts the validator builds; tested against a stand-in list | The owner switching the list on (`VALIDATOR_X_INDEX`); following from Totem (a later wave) |
| **Link your X account** | Linked accounts | 🔵 Built, test data only: "X @handle, verified on Farcaster" from the persona's own Farcaster account; a typed handle is "test link, not verified", rig only | The list switched on; a persona with its own Farcaster account |
| **Your X history** | The "From X" shelf | 🔵 Built, test data only: original dates, retweets hidden by default, "Show as new in my Totem feed" (inside Totem only) | 🟣 One-at-a-time re-sharing to Farcaster, the owner's call |
| **Post to X as well** | Crosspost | 🔵 Test data only, on the test rig only. The X option returns a made-up reference; the real path is not written. ➖ Not offered on the public preview | 🟣 Paid, owner-only, waits for a yes |
| **Sync bookmarks and follows** | Sync from X | 🔵 Test data only; it refuses to run while an X client id is set, so it does not call itself live | 🟣 Paid, owner-only, waits for a yes |
| **Anonymous posts to X** | Totem on X | 🔵 Built, test data only, on the test rig, not deployed: "Also post to @totem on X" on an anonymous post puts a copy in a queue that waits for a moderator; a test transport, nothing reaches X. Not offered on the public preview. See [Totem on X](/features/layers-on-x) | A Totem X account and X billing, the owner's yes |
| **DM a link to @totem** | DM to bookmark | 🔵 Test data only. Settings says: "DM a tweet to @totem to save it (test data: no DM is read from X yet)." | Not planned for version 1 |
| **Synchronised likes across your X accounts** | Alt linking, porting | 🔵 Test data only, kept experimental | X's automation rules appear to ban automated, coordinated likes, so the X half stays experimental |

## At a glance

Version 1, built on test data:

<ol class="flow">
  <li><strong>You</strong>Download your archive from X and drop the ZIP, or its folder, into Settings › Import from X</li>
  <li class="flow__us"><strong>Your browser</strong>Reads who you follow and your posts. Keeps only what you chose; message and media files are skipped</li>
  <li class="flow__us"><strong>Your device</strong>Seals what was kept and saves it in pieces</li>
  <li class="flow__us"><strong>Your device</strong>Downloads the public X-to-Farcaster list in full and finds the overlap</li>
  <li class="flow__soon"><strong>You</strong>Follow the matches from Totem (a later wave)</li>
</ol>
<p class="flow__note">The list comes from Farcaster's own public verifications, about 397,000 accounts, rebuilt nightly by a Totem validator once the owner switches it on: the same file for everyone.</p>

## Part by part

### Archive import

**How it works.** Settings › Import from X. Drop in the ZIP, or pick its extracted folder: "The archive file never leaves this browser." Only the parts you pick are saved, sealed. The ZIP is read by its directory, so only the wanted files are ever read: your account, who you follow, every tweet file (large archives split tweets across several), likes and ad interests. Your email and phone are dropped as the account file is read; message and media files are never opened. Only what you choose is kept: posts with their original dates (retweets hidden by default), who you follow, likes (off by default) and ad interests (sensitive ones held). An archive of 4 GB or more is refused with the instruction to extract it and pick the folder. {cite: SECURITY-POSTURE.md > "22. Bring your X (Persona launch P2): what the validator, the index source and the network learn from an archive import"}

**What keeps it safe.** What is kept is sealed and saved in pieces of at most 96 KiB, each piece sealed under its own name, with a manifest written last, so a half-finished save leaves the last complete one intact. A save that fails says so: the save limit is 256 KiB a request, and a save over it is refused out loud. {cite: SECURITY-POSTURE.md > "22. Bring your X (Persona launch P2): what the validator, the index source and the network learn from an archive import"}

**What is still risky.** The validator sees that you imported an archive and a size class of it. X's archive format has been checked against published descriptions and a synthetic archive, not against a real 2026 archive; the owner is requesting his.

**Status.** 🔵 Built, test data only, on both sites.

### Find your people

**How it works.** Farcaster publishes, for free and with no key, every Farcaster account that verified an X account, paired with that X account's number. Your archive lists who you follow by the same number. Your device matches the two.

**What keeps it safe.** Everyone downloads the same whole file, so the server does not learn whose follows matched; it does see that an address downloaded the list. Your follow list is kept sealed and checked again against each new file. {cite: SECURITY-POSTURE.md > "22. Bring your X (Persona launch P2): what the validator, the index source and the network learn from an archive import"}

**What is still risky.** A follow list is a fingerprint. If a persona follows the same few hundred people as your X account, it is tied to your X self. The wizard warns you before it imports follows ("Importing who you follow into @persona ties it to @xhandle: a follow list is a fingerprint…"), and the choice of persona matters. Following from Totem is a later wave; on the owner's service it will be spread over days (10 follows a day, inside 30 actions).

**Status.** 🔵 Built, test data only: tested against a stand-in list. The list is off until the owner sets `VALIDATOR_X_INDEX=on`.

### Identity: "X @handle, verified on Farcaster"

**How it works.** The same free list tells Totem which X account a Farcaster account has verified. A persona with its own Farcaster account shows "X @handle, verified on Farcaster", and an archive whose account matches it is a verified import; anything else is "self-supplied archive, unverified".

**Status.** 🔵 Built, test data only. Not offered on the public preview, where personas have no Farcaster account of their own yet. Proving it by tweeting a code waits for a check of X's terms.

### History

**How it works.** A dated "From X" shelf on the persona's profile. "Show as new in my Totem feed" brings one back into your own Totem feed and posts nothing anywhere. Re-sharing to Farcaster one at a time, labelled "originally on X" with its date, and not in bulk, is designed. <!-- uncited-ok: a product rule for a designed feature, not a privacy claim -->

**Status.** 🔵 The shelf is built, test data only. 🟣 Re-sharing is coming soon, the owner's decision.

### Paid extras

**How it works.** Posting to X, reading bookmarks (X's archive leaves them out) and logging in with X all need an X developer account with a card on file, billed per use: about $0.015 a post, $0.20 with a link, and roughly $10 to read one person's 1,000 follows. They would run on the owner's service only; the public preview has no safe place to hold X tokens.

**Status.** 🟣 Coming soon, and only on the owner's yes.

## The obvious questions

### What happened to the old X features?

They were built against test data and looked further along than they were. The handle box that said "verified" for any handle now says "test link, not verified" and appears on the test rig only; the "Load fixture archive" button and the composer's X option are rig-only; and "sync from X" refuses to run under a live label.

### Why did the docs say X import was shipped?

Because the earlier pages counted "passed its tests on test data" as shipped. It was not run on a real archive, and the importer is not linked from the app. This page replaces those tags.

### Will Totem ever post to X for me?

Only if the owner decides to pay for it, and then only from his private service. A copy of an anonymous post to a Totem account on X, with no name on it and after a moderator reads it, is built on test data: see [Totem on X](/features/layers-on-x).

## Where it lives in the code

`lib/x/`: `archiveZip.ts` and `archiveParse.ts` (reading the archive in the page), `importer.ts` and `shelf.ts` (what is kept), `follows.ts`, `indexClient.ts` and `match.ts` (find your people), `identity.ts` and `attestations.ts` (the badge), `migration.ts` (the old Totem-local matcher, rig only), `oauth.ts`, `sync.ts`, `inbox.ts`, `altlink.ts`, `porting.ts`, `spend.ts`. Sealed pieces: `lib/vault/chunkedDoc.ts`. The list: `validator/xindex.js`. The wizard: `components/settings/XImportWizard.tsx` and `components/settings/XPeoplePanel.tsx` at `/settings/import-x`. Crosspost: `lib/crosspost/destinations.ts`. Tests: `scripts/unit-x-v1.mjs`, `scripts/accept-x5.mjs`, `scripts/smoke-x.mjs`.

## The record

For auditors: each line is tagged in the internal vocabulary and cites the report it comes from. Every gate of the X pass closed as fixture-verified, with $0.00 real spend.

- **[SHIPPED-FIXTURE]** X account linking (OAuth on a recorded exchange; the live path has no callback route and cannot complete). {cite: notes/reports/REPORT-X.md > "GATE 1 — Account linking — CLOSED (8/8) — FIXTURE-VERIFIED"}
- **[SHIPPED-FIXTURE]** X archive import, on a constructed archive only. {cite: notes/reports/REPORT-X.md > "GATE 2 — Archive import — CLOSED (8/8) — FIXTURE-VERIFIED"}
- **[SHIPPED-FIXTURE]** Live X destination with spend controls (live write skipped). {cite: notes/reports/REPORT-X.md > "GATE 3 — Live X destination + spend controls — CLOSED (8/8) — FIXTURE-VERIFIED (live-write SKIPPED, real spend $0.00)"}
- **[SHIPPED-FIXTURE]** Follow migration and deferred auto-follow, matching Totem-local links only. {cite: notes/reports/REPORT-X.md > "GATE 4 — Follow migration + deferred auto-follow — CLOSED (6/6) — FIXTURE-VERIFIED"}
- **[SHIPPED-FIXTURE]** X alt linking (the deniable synchronised-like breadcrumb), experimental. {cite: notes/reports/REPORT-UX.md > "CALL OPTION A — X alt linking — OPENED, CLOSED (9/9)"}
- **[SHIPPED-FIXTURE]** The @totem DM-to-bookmark hook. {cite: notes/reports/REPORT-MEGA2.md > "GATE 5 — @layers on X: the DM-to-bookmark hook"}
- **[SHIPPED-FIXTURE]** Crosspost composer; the X destination has no live writer. {cite: notes/reports/REPORT-B.md > "GATE 2 — Crosspost composer — CLOSED (6/6)"}
- What the pass found broken. {cite: notes/reports/REPORT-X.md > "KNOWN-BROKEN (X interop)"}
- **[SHIPPED-FIXTURE]** Bring your X version 1 (Persona launch P2): the archive read in the page, sealed pieces, the 256 KiB loud save limit, the keyless list, matching on the device, the badge, the shelf; synthetic archive only. {cite: SECURITY-POSTURE.md > "22. Bring your X (Persona launch P2): what the validator, the index source and the network learn from an archive import"}
