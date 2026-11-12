---
pageClass: eli5
---

# FAQ

Short answers, verdict first. Each links to the page with the full story.

## Getting started

### Is Totem live?

Yes, as a preview. Anyone can use the public preview in their browser today. Posts stay inside Totem until you reload, and the privacy label reads DEMO. The go-live build, not deployed yet, makes the public site the product: a guided start with Sign in with Farcaster, persona posts reaching Farcaster through the public @anon once the owner switches it on, and an anon page for Farcaster people. [Your first 5 minutes](/start/first-5-minutes) walks through it; [the board](/roadmap/) says what runs today.

### Is it free? Do I need a wallet or crypto?

Free, and no. The public preview moves no money and asks for no wallet. [What is Totem](/start/)

### What happens if I close or reload the tab before saving?

Your identity is gone, and the next visit starts a new one. Moving between pages inside the app is safe; a reload is not. Press Save with Face ID / fingerprint (or Save with a passkey) on the strip at the top, or choose Keep in this browser. The 24 words, under Advanced, are your way back in, not a save by themselves. [Your first 5 minutes](/start/first-5-minutes)

### Can I log in with X, Farcaster or Google?

Farcaster: yes, on the public preview, read-only. It is deployed (2026-10-11) and has only run on test data so far; it shows which account is yours and does not save your identity, so save with a passkey too. X: not built, by decision, since it needs a paid X developer app. Google: no. [Sign in with Farcaster](/mechanism/sign-in-with-farcaster) {cite: SECURITY-POSTURE.md > "21. Sign in with Farcaster on the public site: what the relay, the chain node, the server and the validator learn"}

### Can I use it on two devices?

Yes: the same synced passkey, or your 24 words, opens it on another device. Linking a device with a short code (the new device shows it, and you type it on the old one) is built and has not been checked on the deployed site yet. [Saving your identity](/features/saving-and-recovery)

## Personas and privacy

### Can people tell my personas are the same person?

Not from anything Totem shows them. Our server could still guess from your internet address and timing, and your own habits can give you away. That is why the label says DEMO. [Privacy in plain words](/start/privacy-in-plain-words)

### Where are my keys?

On the public preview, in your browser. The server keeps sealed copies it has no key for, and public keys. On the owner's private service, the owner's keys are on the server, because it posts for him. [Privacy in plain words](/start/privacy-in-plain-words) {cite: SECURITY-POSTURE.md > "16. Custody and topology (Browser keystore pass): what the browser holds, what the server holds, what each save path trusts, what root linking does and does not do"}

### Who runs the server, and what can it see?

The owner runs it, on Railway. It sees sealed records, public keys, and your internet address and timing. It does not see inside the sealed records. Public posts on the preview are not stored there; they live in your tab. [Privacy in plain words](/start/privacy-in-plain-words) {cite: SECURITY-POSTURE.md > "2. What the operator can still do"}

### What does the red DEMO label mean?

The app's own privacy check found conditions that are not met yet. The banner says how many; Settings, ZK privacy layer lists them. It runs on your device every time. [What the label means](/privacy/)

### Can my friends see my Top 16?

Not yet on a real site. Your Top 16 is up to 16 rings, and rings are built and tested on test data only; they were deployed on 2026-10-12 and nobody has used them there yet. Each ring sees the personas you chose, and can see which anonymous posts they wrote (the deployed public preview has none yet: posting them from your browser is built on test data and not deployed); a friend without Totem gets a private link card instead. [Who sees what](/start/who-sees-what) {cite: SECURITY-POSTURE.md > "24. Rings and ring notes (Persona launch P4): what the drop, the operator and a member learn"}

### Can someone in my ring prove to others which persona is me?

No. The ring's notes carry no signature, so a member who passes one on passes on a claim, not proof. The flip side: a member could tag one of their own anonymous posts as your persona's for the rest of the ring. {cite: SECURITY-POSTURE.md > "24. Rings and ring notes (Persona launch P4): what the drop, the operator and a member learn"}

### Does anyone outside my rings see which persona wrote an anonymous post?

No. Every anonymous post carries a sealed note of exactly 256 bytes, real or random, so everyone else sees plain @anon and cannot tell which posts have an audience. The server does see that your device publishes ring notes, roughly how many and when, and keeps a record that it has. {cite: SECURITY-POSTURE.md > "24. Rings and ring notes (Persona launch P4): what the drop, the operator and a member learn"}

### Do people I have not picked see my posts blanked as anon?

Partly built. A persona without its own Farcaster account now posts through @anon, the shared anonymous account, by default: built, test data only, on the owner's service, and coming soon on the public preview. Your rings seeing which persona wrote it is built, test data only, deployed 2026-10-12 and not yet used. A private persona's posts are hidden from everyone you have not granted (with no button to grant anyone yet, that is everyone but you). [Anonymous posts](/features/anon-posting)

## Farcaster and X

### Does my post reach Farcaster?

No. On the public preview every post says "Posted to your Totem preview, not to Farcaster"; nothing goes to Farcaster. On the owner's private service, a persona with its own Farcaster account posts there from the Post box and the app says "Posted to Farcaster as @name"; everything else says "Saved in Totem only". That build was deployed on 2026-10-10 and has run on test data only; no real post from it is on record yet. [What reaches Farcaster](/start/farcaster)

### Can I see real Farcaster posts?

On the public preview, it is built and switched off until the owner turns it on. Then you get a feed of authors the owner picked, plus profiles and threads, read-only. [What reaches Farcaster](/start/farcaster)

### Can I connect my existing Farcaster account?

On the public preview you can sign in with it (deployed 2026-10-11, only run on test data so far): it shows as yours. Posting as it is the next step, Allow Totem to post as you: a key made in your browser and kept in your vault, approved in the Farcaster app. Built, test data only, not deployed yet. [Post as you](/mechanism/post-as-you). On the owner's service the connect flow, with a posting key, is built (approve once in the Farcaster app by QR code, no seed phrase) and tested on test data only; it needs a small connector account, which one command on the owner's laptop (arm-connector.ps1) creates and keeps on the owner service, with no key in the owner's hands (about 0.0005 ETH on Optimism from an exchange withdrawal, about $1); not available until the owner has run it. [What reaches Farcaster](/start/farcaster)

### Is anonymous posting live?

No. On the deployed public preview it is not offered yet: there is no switch for it, and under the Post box the app says "Anonymous posting isn't on this preview yet." The next deploy brings it there on test data: your browser makes the proof, and the post stays inside the preview, marked "Preview only · not on Farcaster" (built and tested on a local copy, not deployed yet). {cite: SECURITY-POSTURE.md > "27. Anonymous posting from the public site (Persona launch P7): the prover in your browser, the web channel, and what the operator sees"} On the owner's service it is built and tested on test data and has not posted for real; each post is made as one of your personas, up to 4 every 6 hours shared across them. The owner switches it on with one script, with a cap of one post. There it would be an extra account with no name on it rather than a crowd to hide in. [Anonymous posts](/features/anon-posting)

### What does "posted by an account with 10k+ followers" mean?

That is a reach tier. An anonymous post from a big Farcaster account can prove its follower bucket (1k+, 10k+ or 100k+) without saying which account, and gets a head start in For You. A tier is offered only while at least 50 accounts are in it, and while at least 50 more are in the tier below it, so a post at the lower tier still hides in a crowd. It is not a ring: a reach tier says how big the account is, a ring is the people you chose. Built, test data only, tested on a laptop copy of the owner's service and deployed 2026-10-12; coming soon on the public preview, where it also needs an issuer Totem runs. [Anonymous posts](/features/anon-posting) {cite: SECURITY-POSTURE.md > "25. Reach tiers (Persona launch P5): what a boosted anon post says, and the crowd floor"}

### What is launching a persona?

Giving a persona its own Farcaster account and revealing all of its anonymous posts at once, permanently. The account is made by Totem, not your wallet, 2 to 48 hours after you confirm, at a random time. Built, test data only, against a simulated registrar that creates nothing on Farcaster; coming soon on the public preview. [Launching a persona](/features/launch) {cite: SECURITY-POSTURE.md > "26. Launch (Persona launch P6): a persona's own account, on test data"}

### Why only 4 anonymous posts every 6 hours?

Because the limit is per person, shared across your personas, and that keeps one person from looking like a crowd. Each post takes one of 4 slots; a fifth waits for the next window. [Anonymous posts](/features/anon-posting) {cite: SECURITY-POSTURE.md > "23. Persona-scoped anon posting (Persona launch P3): K posts per person per window, and what the slot index still says"}

### Does posting anonymously from two personas link them?

Not through the proof: two posts take two slots and carry two different one-time codes, and which persona wrote each is kept in a sealed record on your device. The slot number leaves a small hint (two posts in the same slot are two people). Your writing and your hours can still link them. [Anonymous posts](/features/anon-posting) {cite: SECURITY-POSTURE.md > "23. Persona-scoped anon posting (Persona launch P3): K posts per person per window, and what the slot index still says"}

### What is Totem on X?

A Totem account on X that would post copies of anonymous posts, after a moderator reads each one, and that you could DM a tweet to save it to your shelf. Built on test data only, on the test rig: nothing reaches X, and it is not offered on the public preview. A copy has the same words as its anonymous post, so the two can be paired; the moderator reads every copy and never learns who wrote it. Going live needs the owner's X account and X billing. [Totem on X](/features/layers-on-x) {cite: SECURITY-POSTURE.md > "28. The @layers X outbox (Persona launch P8): anonymous copies to X, moderated first, on a test transport"}

### Can I bring my X followers?

Built, test data only, and free: drop your X archive (the ZIP, or its folder) into Settings, Import from X, and your browser reads it there. Seeing which of the people you follow are on Farcaster needs a list the owner has not switched on yet, and following them from Totem comes later. It has only read a synthetic test archive so far. [Bring your X](/start/bring-your-x) {cite: SECURITY-POSTURE.md > "22. Bring your X (Persona launch P2): what the validator, the index source and the network learn from an archive import"}

## The rest of the app

### Why does it look like X?

On purpose. Totem copies the layout people already know, so the only new thing to learn is personas. Some X-style menu items (Grok, Premium, Money, Creator Studio, Articles) are not part of Totem and show "Nothing to see here".

### Are messages, Spaces, the market and earnings real?

No, they are simulations. Messages are a pay-to-message demo on a pretend ledger, not Farcaster direct messages. Spaces are scripted text rooms; the audio part is a placeholder. No real money moves anywhere. [Features](/features/)

### Does search search Farcaster?

No. It searches what your device holds: your posts, private posts, likes, bookmarks and imports. Its "AI" option uses a built-in word list, not a real AI model. [Search](/features/search)

### What is the owner's private service?

A private copy of Totem that only the owner can log into. It holds his identity on the server so it can post to Farcaster for him. [What reaches Farcaster](/start/farcaster)

### Something here disagrees with what I saw. What should I do?

Tell the owner. Where the label, the banner or these docs disagree with what you experienced is the most useful feedback there is.
