---
layout: home
hero:
  name: Totem
  text: One you. Many personas.
  tagline: An app for Farcaster where one private identity makes as many personas as you want, and you decide who gets to know which ones are you. This is a preview, and every page says what is real today.
  actions:
    - theme: brand
      text: Start here
      link: /start/
    - theme: alt
      text: The map, in one picture
      link: /start/map
    - theme: alt
      text: What works today
      link: /#what-works-today
features:
  - title: Start here
    details: Plain words, for anyone. What Totem is, your first five minutes, personas, who sees what, what reaches Farcaster, bringing your X, privacy without jargon, a FAQ and a glossary.
    link: /start/
  - title: How it works underneath
    details: Mechanism design, for crypto readers. One root with HKDF branches, browser custody, Semaphore v4 membership, the anon relay, disclosure, reputation and stakes, and who has to be trusted for what.
    link: /mechanism/
  - title: For developers
    details: The architecture (your browser answers the app's own API), the three ways to run it, the code map, data flows, environment variables by name, testing, deploy traps, and why each big decision went the way it did.
    link: /technical/architecture
---
<!-- uncited-ok: page — the docs home: an index and a status table rendered from source; every claim it points at is made, and cited, on its own page -->

## Read this first

This site uses six words for how real something is. Each means one thing, on every page:

| | |
|---|---|
| 🟢 **Works live** | Runs for real on the site it names. Some things run for real but stay inside Totem; the row says so. |
| 🔵 **Built, test data only** | The code exists and its tests pass, but it has only run on test data or a local copy. **It has not run against the real network.** |
| 🟡 **Designed** | Worked out and written down. No code. |
| ⚪ **Off on purpose** | Built and deployed, then switched off until the owner turns it on. |
| 🟣 **Coming soon** | On the build list. Not usable yet. |
| ➖ **Not offered here** | This site does not offer it, by design. It is not waiting to be switched on. |

The gap between the first two is the one that matters. This project has blurred it before. The app's Post box said "Your post was sent" on the owner's private service while the post stayed inside Totem. These docs once marked X import as shipped when it had only ever read a hand-made 5 KB test archive. Both are corrected here (the buttons build of 2026-10-08, deployed 2026-10-10 and only run on test data so far, replaces that message with where the post went), and the [Roadmap](/roadmap/) lists every 🔵 item with what has not happened yet.

## What works today

<!--@include: ./start/what-works-generated.md-->

## The idea, and where each part stands

The pitch, in plain words, with the honest status of each piece:

| What you will do | Today |
|---|---|
| Log in with your Farcaster account | 🔵 Built, test data only, on the public preview, read-only; deployed on 2026-10-11 and not yet used there. It shows which account is yours and does not save your identity. ➖ Not offered on the owner's private service. See [Sign in with Farcaster](/mechanism/sign-in-with-farcaster). |
| Log in with your X account | 🟣 Coming soon, by decision only with the owner's yes: it needs a paid X developer app. [Bring your X](/start/bring-your-x) uses your archive instead. |
| Save your identity with a passkey | 🔵 Built, test data only. It is deployed on the public preview, but its checks ran on a local copy shaped like that site, not on the deployed one. Face ID first, with the 24 words under Advanced, was deployed on 2026-10-11 and has not been used there yet. ➖ Not offered on the owner's private service, where the server keeps the identity. |
| Make personas: a finsta, an alt, a work self | 🟢 Works live, inside Totem. |
| Link them together securely, so no one sees the links, not even us | 🟣 Coming soon, as a promise. Today the links are stored sealed, so our server holds only scrambled data, but it could still guess from how you connect, and the privacy label reads DEMO. See [Privacy in plain words](/start/privacy-in-plain-words). |
| Decide who sees which persona, like a Top 16 where each tier sees a deeper version of you | 🔵 Built, test data only, deployed 2026-10-12, as up to 16 rings: each ring sees chosen personas, and can see which anonymous posts they wrote (the deployed public preview has no anonymous posts yet). A friend without Totem gets a private link card. Nobody has used it on a real site. See [Who sees what](/start/who-sees-what). |
| People you have not picked see your posts blanked as anon, or not at all | "Not at all" (a private persona) is 🔵 built, test data only. "Blanked as anon": a persona without its own account posts through @anon by default, 🔵 built, test data only, on the owner's private service; your rings seeing which persona wrote it is 🔵 built, test data only, deployed 2026-10-12 and not yet used. |
| On Farcaster, an anoncast-style account that does this with less | 🔵 Built, test data only, on the owner's private service: each post is made as one of your personas, up to 4 every 6 hours shared across them. It has not posted for real yet. On the public preview: 🔵 built, test data only, not deployed yet, proved in your browser and staying inside the preview; 🟣 posting to Farcaster from there is coming soon. See [Anonymous posts](/features/anon-posting). |
| Bring your X: your posts, and the people you follow on X who are already on Farcaster | 🔵 Built, test data only, at no cost to you or us: the archive is read in your browser. It has only read a synthetic test archive, and the list it matches against is not switched on yet. See [Bring your X](/start/bring-your-x). |
| Launch a persona: reveal its anon posts and give it its own Farcaster account | 🔵 Built, test data only, on the owner's private service, against a simulated registrar that creates nothing on Farcaster; deployed 2026-10-12, not yet used. 🟣 Coming soon on the public preview. See [Launching a persona](/features/launch). |
| Reach: anon posts from proven big accounts get more reach, without saying which account | 🔵 Built, test data only, tested on a laptop copy of the owner's service and deployed there on 2026-10-12; no tier is offered with one owner (a tier needs 50 accounts). 🟣 Coming soon on the public preview: it needs anonymous posting there and an issuer Totem runs. See [Anonymous posts](/features/anon-posting). |

## Two Totem sites

There are two places Totem runs today:

- **The public preview.** Anyone can open it. Your identity is made and kept in your own browser, and nothing you post leaves Totem. Posts live in the tab's memory, so a reload clears them. Real Farcaster posts to read are built and switched off until the owner turns them on.
- **The owner's private service.** A private copy only the owner can log into. It holds his identity on the server. Posting to Farcaster as his personas is built and ready, but no persona has its own account yet; today a real post can go out only from a shared test account, by command line. The app's own Post box and buttons reaching Farcaster, the owner's Face ID / fingerprint sign-in and the hiding of the demo world are built, test data only, deployed on 2026-10-10 and not yet used there. It is a tool for one person, not a privacy demonstration.

[What reaches Farcaster](/start/farcaster) explains the difference in one picture.
