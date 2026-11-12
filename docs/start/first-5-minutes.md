---
pageClass: eli5
---

# Your first 5 minutes

<!-- PUBLIC GO-LIVE (2026-11-05): rewritten for the owner's three-step guided start (/welcome). The words in quotes are
     the screens' own (components/landing/Landing.tsx, components/onboarding/*, components/home/PickUp.tsx,
     components/Composer.tsx); scripts/accept-onboard-prod.mjs drives the same screens. -->

Sign in with the Farcaster account you already have: that account is you in Totem. Keep it with Face ID, and you are
in. Personas, your X posts and your people are there when you want them, never before. {cite: SECURITY-POSTURE.md > "32. Public live mode and the guided first run (Public go-live): what the tab hides, what the flow stores, what the X step asks"}

::: warning Status: built, test data only
The guided start is built and tested on a local copy shaped like the public site, with live mode on (no sample people
or posts). Nobody has used this version on the deployed site yet. Posts made through @anon reach Farcaster only once
the owner has switched the public @anon on; until then the Post box says "Anonymous posting isn't switched on for this
site yet, so nothing can be posted anonymously right now." {cite: SECURITY-POSTURE.md > "32. Public live mode and the guided first run (Public go-live): what the tab hides, what the flow stores, what the X step asks"}
:::

## At a glance

<ol class="flow">
  <li><strong>Open</strong>On the landing page, press "Sign in with Farcaster". "Continue with X" is there too, marked Soon until the owner switches it on</li>
  <li class="flow__us"><strong>Sign in with Farcaster</strong>Step 1 of 3. Scan the QR code, or tap through on a phone. We only read your public profile</li>
  <li class="flow__us"><strong>This is you</strong>Step 2 of 3. Your Farcaster picture, name and username, which you can change</li>
  <li class="flow__us"><strong>Keep your account</strong>Step 3 of 3. One tap with Face ID, or "Not now"</li>
  <li><strong>Pick up where you left off</strong>Find your people, bring your X posts, make a persona: all optional</li>
</ol>
<p class="flow__note">Back goes one step back. No persona is needed to finish. It costs nothing and needs no wallet.</p>

## Step by step

1. **Open the site.** The landing page says "One you. Many personas." and "Your Farcaster account, plus as many other
   faces as you want. You decide who sees which one is you." Press **Sign in with Farcaster**. **Continue with X** is
   shown but marked Soon: signing in with X is built on test data and waits for an X developer app Totem does not have
   yet ([Sign in with X](/mechanism/sign-in-with-x)); once it is switched on it takes you to X and back. No Farcaster account?
   **Get one free** opens farcaster.xyz. Been here before? Press **I've used Totem before**, then **Unlock with a
   passkey**: "Signing in with Farcaster can't bring an identity back: only the passkey you saved it with can." Just
   looking? **Read the anonymous feed** needs no account. Coming from the anon page's **Open Totem** button, you start
   past the first screen, still signed in. {cite: SECURITY-POSTURE.md > "32. Public live mode and the guided first run (Public go-live): what the tab hides, what the flow stores, what the X step asks"}
2. **Sign in with Farcaster** (step 1 of 3). "Approve in the Farcaster app. We only read your public profile." Press
   **Sign in with Farcaster**, scan the QR code with your phone's camera and approve in the Farcaster app; on a phone,
   tap **Open in the Farcaster app** (the site keeps your identity in this browser first, so the switch to the Farcaster
   app and back loses nothing). Once you approve, the card shows the account you signed in with; press **Continue**. If
   this page reloads while you approve in the Farcaster app, start the sign-in again: the identity was kept, the waiting
   sign-in was not. Before the first request the card says who sees what: Farcaster's sign-in service and the
   blockchain node your browser asks. Signing in is also how you join the anonymous crowd that @anon posts come from:
   once anonymous posting to Farcaster is on, the card says that Totem then checks the same sign-in and records that
   your Farcaster account joined, with your internet address.
   {cite: SECURITY-POSTURE.md > "21. Sign in with Farcaster on the public site: what the relay, the chain node, the server and the validator learn"} {cite: SECURITY-POSTURE.md > "31. The public @anon relay (Public go-live)"}
3. **This is you** (step 2 of 3). Your picture, name and username, filled in from your Farcaster account. Change any of
   them right there: **Another picture** makes one on your device. Your username in Totem starts as your Farcaster
   username; if someone in Totem already has it, the screen says "@you is taken on Totem. These are free:" with three
   you can tap, and "Your Farcaster username stays @you on Farcaster. This only changes your name inside Totem." If your
   Farcaster account has an X account verified on it, it shows as "@you · Verified on your Farcaster account" with
   **Show** (on: your Totem profile shows it too). The X account is looked up in a list every visitor downloads whole,
   so nobody is asked about your account in particular. Press **Continue**.
   {cite: SECURITY-POSTURE.md > "32. Public live mode and the guided first run (Public go-live): what the tab hides, what the flow stores, what the X step asks"}
4. **Keep your account** (step 3 of 3). "One tap with Face ID. No password, nothing to write down. Works on your other
   devices too." Press **Save with Face ID** (on a computer without it, **Save with a passkey**: Windows Hello, your
   phone or a security key). "Not now keeps it in this browser only.": clearing this site's data would then lose it.
   The 24-word written backup stays optional, under Advanced on Your device. {cite: SECURITY-POSTURE.md > "16. Custody and topology (Browser keystore pass): what the browser holds, what the server holds, what each save path trusts, what root linking does and does not do"}
5. **Your home feed.** You are signed in as your Farcaster account. The Post box says "Posting as @you" and offers
   **Allow Totem to post as you**: approve it in the Farcaster app and the Post box posts as your own account ("Posts
   go to Farcaster as @you."). Built, test data only, and not deployed yet; until the site has it, the box says it
   isn't switched on there, and you post as yourself in the Farcaster app. A persona is the other way to post.
6. **Pick up where you left off**, above the feed, all optional: **Find your people** says how many accounts you
   follow on Farcaster and lists them, and the **Following** tab is their posts, newest first, read by your browser
   straight from a Farcaster node ([Following from the hub](/mechanism/following-from-the-hub): built, test data only,
   not deployed yet); a link below it shows which of the people you follow on X are on Farcaster, from your X archive. **Bring your X posts**
   imports your X archive: ask X for it, and when the email comes, import it; the file never leaves your browser.
   **Make a persona** is another face: a picture made on your device, a **Name**, a **Handle**, and **Where its posts
   go**: **Through @anon** (the default) or **In Totem only**. Press **Create persona**: "Created @you. Posting as
   @you." {cite: SECURITY-POSTURE.md > "22. Bring your X (Persona launch P2): what the validator, the index source and the network learn from an archive import"}
7. **Post as a persona.** Under the Post box, "Posts from @you go" says where this persona's post goes. Through @anon,
   your browser proves you are one of the crowd and the post goes out from @anon at the next posting slot, with no name
   on it. Your first anonymous post waits for the next 6-hour window after you joined, and anonymous posting opens only
   once at least 50 Farcaster-verified people have joined; the Post box says which and when. Every @anon post has a
   Report button, and the rules are on the terms page. {cite: SECURITY-POSTURE.md > "31. The public @anon relay (Public go-live)"}
8. **Look around.** Switch modes (Default, Work, Event Safe Space, Curate), build a rule that hides what you do not
   want, or try a lens. [Features](/features/) has a page for each.

## The obvious questions

### What if I close or reload the tab before saving?

The identity is gone, and so is everything you made with it. Moving between pages inside the app is safe; a reload is
not. Nobody holds a copy that could bring it back: the server only ever had sealed data, and the key to open it was in
your tab. Save first. {cite: SECURITY-POSTURE.md > "16. Custody and topology (Browser keystore pass): what the browser holds, what the server holds, what each save path trusts, what root linking does and does not do"}

### What if I skip Farcaster?

Sign in with Farcaster has a quiet **Skip for now**, and you can come back to it from Your device. Without it there is
no "This is you" (your Farcaster account is what it shows), your identity is not in the anonymous crowd, so a persona's
posts through @anon cannot reach Farcaster from this site, and nothing can find your verified X account. Posts in
Totem only work as before. {cite: SECURITY-POSTURE.md > "31. The public @anon relay (Public go-live)"}

### Can I post as my main Farcaster account?

Built, on test data only, and not deployed yet. Your account is you in Totem, and the Post box says "Posting as @you".
Press **Allow Totem to post as you**: your browser makes a posting key and keeps it in your vault, you approve it in
the Farcaster app (a link on a phone, a QR code on a computer), and once Farcaster's network lists the key the Post box
posts as your own account. The Farcaster app may ask you to pay a small network fee for adding the key. Until the site
has it, you post as yourself in the Farcaster app, and in Totem as a persona (made from "Pick up where you left off").
Once it is on, the Farcaster posts in Following also reply, like and recast as you; while you act as a persona, nothing
goes out as your own account. See [Post as you](/mechanism/post-as-you). {cite: SECURITY-POSTURE.md > "35. Post as you: your own Farcaster account's key, Totem's app account, and what each party sees"}

### Face ID, a passkey or 24 words: which should I use?

Face ID first. If your passkey supports a feature called PRF, which many synced passkeys do, the same passkey opens
your identity on any of your devices; if it does not, the identity is tied to this one device, and the page says so. The
24 words are the optional written backup, under Advanced on Your device: anyone who has them is you. A passkey is tied
to the site's web address, which is why the address was chosen before anyone saved.
{cite: notes/reports/REPORT-CUSTODY.md > "What was provisioned, and what it costs"}

### Can I use Totem on my phone and my laptop?

Yes, with the same identity on both. If your passkey syncs between them (iCloud Keychain, Google Password Manager) and
the save said only "Saved. Your passkey opens this identity here.", unlock on the second device (**I've used Totem
before**, then **Unlock with a passkey**). Otherwise, for example a Windows Hello passkey, which stays on that computer,
press **Link a device instead**: the new device shows a 10-character code and a fingerprint (under **Show a link
code**), you type both on the device that already holds your identity and press **Approve**, then press **Keep in this
browser** on the new device. Don't press **Start fresh here** on the second device: that makes a second identity, and
signing in with Farcaster from it would move your place in the anonymous crowd to it.
{cite: notes/reports/REPORT-CUSTODY.md > "GATE 3 — The empty-account fork + device linking + root linking (crypto-touching; single-threaded)"} {cite: SECURITY-POSTURE.md > "31. The public @anon relay (Public go-live)"}

### Does it cost anything?

No. It is free, needs no wallet and moves no money.

### Where did the sample people go?

The site runs in live mode: no sample people, posts or trends. Your home feed is real Farcaster posts (once the owner
has switched real posts on), your personas' posts and @anon posts. {cite: SECURITY-POSTURE.md > "32. Public live mode and the guided first run (Public go-live): what the tab hides, what the flow stores, what the X step asks"}

### What is the red DEMO label?

The app's own check on whether your privacy conditions are met, run in your browser every time. The banner reads
"DEMO, not yet private" and says how many conditions fail; the list is under **Settings**, **ZK privacy layer**.
[Privacy in plain words](/start/privacy-in-plain-words) explains each one.

### I'm on Farcaster and only want to post anonymously

Use the anon page: it skips everything above but the sign-in. [The anon page](/features/anon-page) explains it.
