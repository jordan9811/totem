---
pageClass: eli5
---

# Privacy in plain words

What Totem hides today, from whom, and what it does not hide yet.

::: danger Status: DEMO, not yet private
The app has its own privacy check. It runs on your device every time a page asks, says how many conditions fail (the full list is under Settings, ZK privacy layer), and today it reads `DEMO — not yet private` on the public preview. Until it reads otherwise, treat anything you do in Totem as something that could be linked back to you. {cite: SECURITY-POSTURE.md > '4. What "private" means on the label, exactly'}
:::

## At a glance

<div class="chip-key">
  <span class="where where--device">Device</span> stays in your browser
  <span class="where where--server">Server</span> the Totem server stores it; "sealed" means scrambled with a key it does not hold
  <span class="where where--network">Network</span> public on Farcaster
</div>

<div class="wheremap">
  <div class="wheremap__feature">Your identity<span>root, 24 words, keys</span></div>
  <div class="wheremap__step"><em>Your device</em><span class="where where--device">Device</span> Made and kept here. Unlocked by your passkey or 24 words.</div>
  <div class="wheremap__step"><em>Our server</em><span class="where where--server">Server</span> A sealed copy for your passkey to unlock, and your public keys.</div>
  <div class="wheremap__step"><em>Farcaster</em><span class="where where--none">Nothing</span> Not sent.</div>
  <div class="wheremap__feature">Which personas are you<span>the links</span></div>
  <div class="wheremap__step"><em>Your device</em><span class="where where--device">Device</span> Your full list of personas.</div>
  <div class="wheremap__step"><em>Our server</em><span class="where where--server">Server</span> Each persona on its own; your list, sealed. No table joins them.</div>
  <div class="wheremap__step"><em>Farcaster</em><span class="where where--none">Nothing</span> On the public preview. A persona with its own account looks like any other account.</div>
  <div class="wheremap__feature">Your posts<span>public and private</span></div>
  <div class="wheremap__step"><em>Your device</em><span class="where where--device">Device</span> Written here. Public posts are kept only in this tab's memory, so a reload clears them.</div>
  <div class="wheremap__step"><em>Our server</em><span class="where where--server">Server</span> A private persona's posts, sealed. Public posts are not stored there today.</div>
  <div class="wheremap__step"><em>Farcaster</em><span class="where where--network">Network</span> Only from the owner's service, and only once a persona posts there.</div>
  <div class="wheremap__feature">What you read<span>and for how long</span></div>
  <div class="wheremap__step"><em>Your device</em><span class="where where--device">Device</span> Timed on your device while a card is on screen.</div>
  <div class="wheremap__step"><em>Our server</em><span class="where where--server">Server</span> One sealed total per piece, saved when it leaves the screen.</div>
  <div class="wheremap__step"><em>Farcaster</em><span class="where where--none">Nothing</span> Not sent.</div>
</div>

## What the server holds

The Totem server behind the public preview keeps sealed records it has no key for, and public keys. Your public posts are not stored there today: they live in your tab until you reload. Your root, your 24 words, the key that opens your sealed records, and your personas' private keys stay in your browser. {cite: SECURITY-POSTURE.md > "16. Custody and topology (Browser keystore pass): what the browser holds, what the server holds, what each save path trusts, what root linking does and does not do"}

## What is hidden, from whom

| Who | Can see | Is kept from |
|---|---|---|
| **Other people on Totem** | Each persona you show them, and what you grant | Which personas are one person, unless you grant it |
| **Our server** | Sealed records, public keys, your internet address and when you connect | What is inside the sealed records: your private posts, your grants, your list of personas, your reading |
| **Farcaster and other apps** | A persona's own account and posts, once it has one (owner's service only), and who registered and paid for it on the blockchain | Little, once it has one: accounts registered by the same wallet in the same minutes can be grouped by anyone reading the chain, and the current wallet also registered the Totem-named test account (read 2026-10-07). Two of your accounts interacting links them too |
| **Neynar** | Every persona account the owner's service creates, together, under one key | Nothing about those accounts is kept from Neynar |
| **Railway, the host** | The addresses and pages requested. On the owner's service, the owner's whole identity | On the public preview, the same as our server |
| **Anyone with your 24 words** | Everything. They are you | Nothing |

{cite: SECURITY-POSTURE.md > "14. Network identities (Multi-FID pass): what the network, Neynar and the validator learn about persona accounts and anon posts"}

## What is not hidden yet

The privacy check has eight conditions. The banner says how many fail on your screen, and Settings, ZK privacy layer lists them. In plain words:

1. **A go-between for your connection, run by someone else.** Not set up on the public preview. Without one, our server sees your internet address with every request, so it could guess which personas share a browser. Anonymous posts from the public preview (built, not deployed yet) show it your browser's own description of itself too, on every post. {cite: SECURITY-POSTURE.md > "27. Anonymous posting from the public site (Persona launch P7): the prover in your browser, the web channel, and what the operator sees"}
2. **A big enough crowd.** A proof hides you among everyone in the same group, and the app wants at least 50 people in it by default. Not met on the public preview.
3. **Proofs sent at random times.** A proof waits a random 30 seconds to 15 minutes before it goes, so its timing does not point at what you just did.
4. **Your personas' proofs look unrelated.** A self-test checks, on your own secret, that two of your personas produce proofs that do not match up.
5. **The proof files are the published ones.** Checked against fixed fingerprints.
6. **A cap on how much each persona proves.** So a long run of proofs does not narrow you down.
7. **Real proofs, not stand-ins.** Not met on the public preview: it runs the test set-up.
8. **No fallback that lets a page skip the proof.**

Conditions 1, 2 and 7 are known to fail on the public preview. The others are checked on your device each time, and this page does not claim they hold on yours: the list under Settings, ZK privacy layer shows the result.

Two more apply in special places: a ninth for pages gated on an attestation, and a tenth for anonymous posts, which needs the anonymous account to be separate from the app's own Neynar key. {cite: SECURITY-POSTURE.md > '4. What "private" means on the label, exactly'}

## What your own behaviour gives away

No amount of maths hides patterns. If two of your personas post at the same hours, write the same way, follow the same people or reply to each other, a careful watcher can connect them. Totem measures some of these links in its own tests rather than pretending they are not there. {cite: SECURITY-POSTURE.md > "15. Influence & search (Mega pass 2): what the validator learns from stakes, what stays in the vault, the search boundary"}

## The owner's private service is different

It holds the owner's identity on the hosting company's server, because it has to post for him. The identity sits in a plain file on the server's disk; the passphrase guards logins and does not encrypt it. Railway, and anyone who gets into the owner's Railway account, could act as every persona. A passphrase guards it, or Face ID / fingerprint on a device the owner set up with that passphrase. It is a tool for one person to post with, not a privacy demonstration. {cite: SECURITY-POSTURE.md > "18. The owner service (PROD-LIVE): a hosted rig for one person, and what it trusts"}

## The obvious questions

### Can Totem read my private posts?

On the public preview, no. They are stored sealed, and the key to open them stays in your browser. That rests on the page's own code being honest, and the same operator serves that code; the [trust table](/mechanism/trust-assumptions) spells this out for crypto readers. {cite: SECURITY-POSTURE.md > "16. Custody and topology (Browser keystore pass): what the browser holds, what the server holds, what each save path trusts, what root linking does and does not do"}

### Can Totem tell my personas are the same person?

Not from what it stores: there is no table on the server that joins them. It could still guess from your connection, because every persona reaches it from the same browser and the same internet address. That gap is condition 1 above. {cite: SECURITY-POSTURE.md > "2. What the operator can still do"}

### What if I lose my 24 words and my passkey?

Your identity is gone. Nobody, the owner included, holds a copy that could restore it. {cite: SECURITY-POSTURE.md > "16. Custody and topology (Browser keystore pass): what the browser holds, what the server holds, what each save path trusts, what root linking does and does not do"}

### Does Totem track what I read?

Your browser times how long a piece of a long article is on screen, so it can stop showing you parts you have read. That total is saved in a sealed record; the server cannot read it. Nothing is sent while you read: the time is added up on your device and saved when the piece leaves the screen. {cite: SECURITY-POSTURE.md > "17. Ergonomics (Post-deploy pass): what the persona cue promises, what the cross-persona view costs, what compartment mode is and is not, what a delivery tier decides, and what readwise records about the reader"}

### When the preview shows real Farcaster posts, who sees what I read?

Those reads go through our server, so it sees which profiles and threads are opened, from which address and when. The hosting company's logs record the page addresses too. {cite: SECURITY-POSTURE.md > "19. Public live reads (FC-READ): what the relay holds, what it reads, what the operator now sees, and what it costs"}

### Does Totem promise any of this?

No. The app shows a privacy claim only when every condition holds, and even then the claim is narrow: "your persona's root is hidden from this server at the proof layer". It never says "anonymous". {cite: SECURITY-POSTURE.md > '4. What "private" means on the label, exactly'}

## Read more

- [What the label means](/privacy/): the label and its conditions, one by one.
- [Trust assumptions](/mechanism/trust-assumptions): who has to be trusted for what, for crypto readers.
- [What the operator can still do](/privacy/operator): the honest half, for auditors.
