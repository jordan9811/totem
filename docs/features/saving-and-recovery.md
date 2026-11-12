---
pageClass: eli5
---

# Saving your identity

Keep the identity your browser made, get it back on another device, and recover it if you lose everything but a piece of paper.

::: info Status: deployed, checked on a local copy only
On the public preview, saving with a passkey and restoring from your 24 words are deployed, but their automated checks ran on a local copy shaped like the site, not on the deployed one. Moving a synced passkey to a second device has not been tried with a real synced passkey yet. Linking a second device with a short code, and linking two identities side by side, are built and tested on a local copy of the site, not yet on the deployed one. New, deployed 2026-10-11 and only run on test data so far: the save screens put Face ID first (the 24 words move under Advanced), and a save card appears after your first post, persona or Farcaster sign-in. Signing in with Farcaster is not a way to save. Saving with a social login (email or Google) is not configured on any deployment: coming soon.
:::

| Way to save | Button | Gets you back on | Today |
|---|---|---|---|
| **Passkey, synced** (PRF) | Save with Face ID / fingerprint, or Save with a passkey | Any device with the same synced passkey, by the PRF design; not yet tried with a real synced passkey | 🔵 Built, deployed; checked on a local copy |
| **Passkey, this device only** | Save with Face ID / fingerprint, or Save with a passkey | This device. The page says so when it happens | 🔵 Built, deployed; checked on a local copy |
| **Keep in this browser** | Keep in this browser, on the strip at the top of the app | This browser, until its site data is cleared | 🔵 Built, deployed; checked on a local copy |
| **24 words** | Under Advanced: Show my 24 words, then Restore from 24 words | Anywhere. Writing them down is your way back, not a save of this tab | 🔵 Built, deployed; checked on a local copy |
| **Social login** | Save with email or Google | Anywhere you can log in | 🟣 Coming soon |
| **Sign in with Farcaster** | Sign in with Farcaster | Nowhere: it shows which Farcaster account is yours, and does not save the identity | 🔵 Built, test data only; not a way to save |
| **Link a device** | A 10-character code from the new device | That device, without the 24 words | 🔵 Built, tested on a local copy |
| **Link two identities** | Linked accounts | Shows both sets of personas side by side | 🔵 Built, tested on a local copy |

## At a glance

<ol class="flow">
  <li><strong>Your browser</strong>Makes your root and keeps it in memory. Close or reload the tab now and it is gone</li>
  <li><strong>You</strong>Save with Face ID, a fingerprint or another passkey, from the strip at the top</li>
  <li class="flow__us"><strong>Your device</strong>Locks the root with a key that only that passkey can produce</li>
  <li class="flow__us"><strong>The server</strong>Keeps the locked copy. It has no key for it</li>
  <li><strong>Another device</strong>The same passkey unlocks the copy: same root, same personas</li>
</ol>
<p class="flow__note">That is the synced-passkey path. A passkey without the needed feature keeps the locked copy in this browser only.</p>

Saving never sends your root anywhere in the clear. Each way to save locks the same 32-byte root under its own key, and the server stores the locked copy plus public information about the method, such as a passkey's public key. {cite: SECURITY-POSTURE.md > "16. Custody and topology (Browser keystore pass): what the browser holds, what the server holds, what each save path trusts, what root linking does and does not do"}

## The obvious questions

### Why is Face ID first now?

Because it is the save most people finish, and an unsaved identity is gone when the tab closes. The strip at the top of the app offers **Save with Face ID / fingerprint** (or **Save with a passkey**) inline, a card offers it again at the first useful moment ("Nice. Keep this identity so it is here tomorrow."), and **Your device** lists it first. The 24 words are the advanced backup, under **Advanced**, with Keep in this browser, devices and linked accounts. Deployed 2026-10-11, only run on test data so far.

### Does signing in with Farcaster save my identity?

No. It shows which Farcaster account is yours and adds it as a read-only public self. It yields nothing your identity could be locked under, so it cannot bring the identity back on another device. Save with a passkey as well. {cite: SECURITY-POSTURE.md > "21. Sign in with Farcaster on the public site: what the relay, the chain node, the server and the validator learn"}

### What does the server keep when I save?

It depends on the passkey. With a PRF passkey: its public ID, its public key, and your root locked under a key that only the passkey can make. With any other passkey: only its public ID and public key; the locked root stays in this browser, and the key that unlocks it is made by the app server from its own secret, after it checks your passkey. For the 24 words: nothing, they are shown in your browser and stay there. It keeps no root, no 24 words and no key that opens your sealed records. {cite: SECURITY-POSTURE.md > "16. Custody and topology (Browser keystore pass): what the browser holds, what the server holds, what each save path trusts, what root linking does and does not do"}

### Why does it say my passkey only works on this device?

Some passkeys lack a feature called PRF, which lets the passkey itself produce the unlocking key. For those, the app server hands out the key after checking your passkey, and the locked copy stays in this browser. Use your 24 words to get back elsewhere. {cite: notes/reports/REPORT-CUSTODY.md > "GATE 2 — Ephemeral onboarding + passkey + social login (crypto-touching; single-threaded)"}

### What if I lose my passkey?

Restore from your 24 words on any device, then save a new passkey. Without the passkey and the words, the identity is gone for good. {cite: SECURITY-POSTURE.md > "16. Custody and topology (Browser keystore pass): what the browser holds, what the server holds, what each save path trusts, what root linking does and does not do"}

### What if Totem moves to a new web address?

Passkeys belong to the web address they were made on, so one saved on the current address will not unlock Totem on a new one. Your 24 words will. That is why the owner means to settle the address before many people save. {cite: notes/reports/REPORT-CUSTODY.md > "What was provisioned, and what it costs"}

### What can a linked device do?

Everything day to day: act as every persona and open your sealed records. It cannot make a new persona, show the 24 words, or link a further device. Those need the device that holds the root. The link code is 10 characters, can be used once, and expires after ten minutes. {cite: notes/reports/REPORT-CUSTODY.md > "GATE 3 — The empty-account fork + device linking + root linking (crypto-touching; single-threaded)"}

### What does "linked, not merged" mean?

If you have two separate identities, say one per browser, you can link them so each shows the other's personas beside its own. They stay two identities: reputation does not combine, and one device still cannot post as the other's personas. {cite: notes/reports/REPORT-CUSTODY.md > "GATE 3 — The empty-account fork + device linking + root linking (crypto-touching; single-threaded)"}

### I used a passkey and it says it holds no identity. What now?

That passkey was never used to save on this site. Choose to start fresh with the identity in this tab, or link this device from one that already holds your account. The app makes no guess from your browser or address. <!-- uncited-ok: describes the screen's behaviour, not a privacy claim -->

### How does saving work on the owner's private service?

Differently. The owner logs in with a passphrase, and his root sits in a plain file on the server's disk, because the server posts for him. The passphrase guards logins; it does not encrypt the root. Until he writes down his 24 words, that disk is the only copy. {cite: SECURITY-POSTURE.md > "18. The owner service (PROD-LIVE): a hosted rig for one person, and what it trusts"}

## What this does not protect

- **Your 24 words.** Whoever has them is you, on any device, for good.
- **An unlocked device.** Anyone using your unlocked browser can act as every persona.
- **This-device passkeys.** They depend on a secret the app server keeps. If that secret is ever changed, those saves stop working, and the 24 words are the way back.
- **Synced passkeys.** They are only as safe as the account (Apple, Google, a password manager) that syncs them.
- **Linking a device, against a dishonest server.** The Totem server passes the code and both devices' keys between them, and the matching characters you compare are only 8 long. A server that wanted to could swap in its own device and receive every key. Link a device only while you trust the server.
- **A lost or stolen linked device.** It keeps every persona's keys for good. Removing it stops only its writes to the server; getting fully clear means a new identity.

## Where it lives in the code

The save paths: `lib/device/custody/` (the lock, passkeys, providers, methods). Device linking: `lib/device/linking.ts`. Linking two identities: `lib/device/rootlink.ts`. The server side: `validator/custody.js` and `lib/custody/` (passkey checks and the one release secret). The page: `app/device` and `components/device/DeviceApp.tsx`; the strip and the save card: `components/device/IdentityNudge.tsx`, `components/device/SaveMoment.tsx`; Sign in with Farcaster: `components/device/FarcasterSignIn.tsx` and `lib/fc/siwf/` ([the mechanism](/mechanism/sign-in-with-farcaster)). For the design, see [Browser custody](/mechanism/custody) and the [custody model](/custody-model).
