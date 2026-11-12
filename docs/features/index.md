---
pageClass: eli5
---

# All features, with status
<!-- uncited-ok: page — an index; every feature page carries its own status box and citations -->

One page per feature, in the order you meet them. Each opens with a status box, a picture of how it works, and the questions a first-time reader asks.

| | Feature | Public preview | Owner's private service |
|---|---|---|---|
| 1 | [Personas](/features/personas): make, switch, tint, compartment mode; clone | 🟢 Works live. 🔵 Clone: built, no button yet | 🟢 Works live. 🔵 Clone: built, no button yet |
| 2 | [Saving your identity](/features/saving-and-recovery): passkey, 24 words, device link | 🔵 Passkey, Keep in this browser and 24 words: deployed, checked on a local copy only. 🔵 Face ID first: deployed 2026-10-11, not yet used. 🔵 Device link. 🔵 Sign in with Farcaster (not a save). 🟣 Social login | ➖ Not offered here: the owner signs in with a passphrase (🔵 Face ID / fingerprint sign-in: deployed 2026-10-10, not yet used), with the root on the server |
| 3 | [Your feed: modes and rules](/features/modes-and-rules) | 🟢 Works live, on preview posts | 🟢 Works live |
| 4 | [Lenses](/features/algorithms-and-lenses) | 🟢 Ranking. 🔵 Influence side | 🟢 Ranking. 🔵 Influence side |
| 5 | [Reading, health and delivery](/features/feed-health) | 🟢 Works live, on preview posts | 🟢 Works live |
| 6 | [Search](/features/search) | 🟢 Works live, over your own things | 🟢 Works live |
| 7 | [Posting and Farcaster accounts](/features/network-identities) | 🟢 Inside Totem only, until you reload. 🔵 Your Farcaster account, read-only: deployed 2026-10-11, not yet used. 🔵 Posting as your own account (Allow Totem to post as you): built, test data only, not deployed. 🔵 Your Farcaster Following and Find your people, read by your browser from a Farcaster node: built, test data only, not deployed. 🟣 Posting to Farcaster as a persona. ➖ Persona accounts | 🔵 App buttons to Farcaster: deployed 2026-10-10, not yet used. ⚪ Persona accounts, none made. 🔵 Connect main, not available yet |
| 8 | [Anonymous posts](/features/anon-posting): as a persona, ring notes, reach tiers | 🔵 Proved in your browser, staying inside the preview: built, test data only, not deployed yet (the deployed site still refuses). 🟣 Posting to Farcaster from here. 🟣 Reach tiers (they need an issuer Totem runs) | 🔵 Built, test data only: as a persona, 4 per 6 hours. 🔵 Reach tiers: built, deployed 2026-10-12, test data only; none offered with one owner |
| 9 | [Who sees what: rings](/features/who-sees-what) | 🔵 Rings and links: built, test data only, deployed 2026-10-12, not yet used. 🔵 One-to-one grants, no button | 🔵 Rings: built, test data only, deployed 2026-10-12; they reach this service's own validator only |
| 10 | [Launching a persona](/features/launch) | 🟣 Coming soon: anonymous posts here stay inside the preview, and launch needs the Totem registrar | 🔵 Built, test data only, on a simulated registrar; deployed 2026-10-12, nothing created on Farcaster |
| 11 | [Bring your X](/features/interop) | 🔵 Version 1, test data only: deployed 2026-10-11. 🟣 Following matches | 🔵 Version 1, test data only: deployed 2026-10-11. 🟣 Following matches |
| 12 | [Totem on X](/features/layers-on-x): copies of anonymous posts to X, the DM inbox | 🟣 Coming soon: not offered here this wave | 🔵 Built, test data only, on the rig, not deployed: copies wait for a moderator and go out through a test transport; nothing reaches X. 🔵 The DM inbox, test data only |
| 13 | [Replies, notes and rooms](/features/social-surfaces) | 🔵 On the demo world | 🔵 On the demo world |
| 14 | [Curators](/features/curators) | 🔵 Test data only | 🔵 Test data only |
| 15 | [Relationship history](/features/relationship-history) | 🔵 Test data only | 🔵 Test data only |
| 16 | [Influence and the UBI](/features/influence-and-search) | 🔵 Test data only | 🔵 Test data only |
| 17 | [Your data backpack](/features/context-graph) | 🔵 Test data only | 🔵 Test data only |
| 18 | [Ads and the market](/features/ad-market) | 🔵 Pretend ledger | 🔵 Pretend ledger |

Also on the owner's service: real Farcaster posts to read (when switched on), and hiding the made-up demo world (🔵 built, deployed, not yet looked at). Anonymous posts to X: [Totem on X](/features/layers-on-x), built on test data for the owner's shape, not deployed. On the public preview, real Farcaster posts to read are ⚪ built and off until the owner turns them on.

## The six status words

| | |
|---|---|
| 🟢 **Works live** | Runs for real on the site named. "Inside Totem only" means it works, and nothing goes out to Farcaster. |
| 🔵 **Built, test data only** | Code and tests exist. It has only run on test data or a local copy. |
| 🟡 **Designed** | Worked out and written down. No code. |
| ⚪ **Off on purpose** | Built and deployed, then switched off until the owner turns it on. |
| 🟣 **Coming soon** | On the build list. Not usable yet. |
| ➖ **Not offered here** | This site does not offer it, by design. It is not waiting to be switched on. |

## For auditors: the internal tags

The "record" at the foot of each feature page uses the reports' six tags. They map onto the six words like this:

| Internal tag | Means | Shown here as |
|---|---|---|
| **[SHIPPED]** | Built, tested, and exercised for real where a real network or primitive exists | 🟢 Works live |
| **[SHIPPED-FIXTURE]** | Built and green on test data; the live half has not run | 🔵 Built, test data only, or ⚪ Off on purpose when deployed and switched off |
| **[SPECCED]** | Designed and decided in a report; not built | 🟡 Designed |
| **[IDEA]** | Named in a backlog; not designed | 🟣 Coming soon if it is on the build list; otherwise named as an idea |
| **[KNOWN-BROKEN]** | Built, and a report marks it broken | Said in words, on the page |
| **[UNCLEAR]** | The reports do not settle it | Said in words, on the page |

The internal roadmap counts these tags from the pass pages; the feature pages' records are for tracing a sentence back to its report.
