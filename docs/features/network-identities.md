---
pageClass: eli5
---

# Posting and Farcaster accounts

Post as any of your personas, and on the owner's private service give a persona its own real Farcaster account.

::: warning Status: mixed; the app's buttons are built to reach Farcaster and have not yet, on the deployed service
On the **public preview**, posting works and stays inside Totem, and every post says so. On the **owner's private service**, giving each persona its own Farcaster account is built and ready, and none has been made yet. A real cast can go out today only through a command-line path, from a shared test account; writes were switched on there on 2026-10-07, and no real cast from that service is on record yet. The app's Post box, likes, recasts and follows are built to go to Farcaster for a persona with its own live account (the line under the box reads "Posts to Farcaster as @name — public" before, the toast "Posted to Farcaster as @name" after), with "Saved in Totem only — why" everywhere else. That build was deployed on 2026-10-10 and has run on test data only; it waits for a persona account and a first real post. The old "Your post was sent." no longer exists. A second way to give a persona its own account, launch (made by a Totem registrar, with its anonymous posts revealed), is built on test data only against a simulated registrar, deployed on 2026-10-12; nothing it does reaches Farcaster.
:::

| Piece | Public preview | Owner's private service |
|---|---|---|
| Post, like, recast, follow inside Totem | 🟢 Works live. A post lasts until you reload | 🟢 Works live. A post lasts until the next restart |
| The same, reaching Farcaster | 🟣 Coming soon: posting from your own browser is designed, not built | 🔵 Built, test data only: the app's own buttons sending to Farcaster as a persona with its own account; deployed 2026-10-10, no real post on record |
| A persona's own Farcaster account | ➖ Not offered here: the public site refuses the keys it needs | ⚪ Ready, off until the owner makes one (about $0.35 to $0.90 each) |
| A persona's own account by launch (a Totem registrar, its anon posts revealed) | 🟣 Coming soon: "Launch isn't on this preview yet." | 🔵 Built, test data only, against a simulated registrar; deployed 2026-10-12, nothing created on Farcaster. Live: "Launch needs the Totem registrar, which isn't set up yet." See [Launching a persona](/features/launch) |
| Reply to a real post as a persona with its own account | ➖ Not offered here | ⚪ Built; no persona has an account yet |
| Real casts through the owner's command-line path | ➖ Not offered here | ⚪ Switched on 2026-10-07, not yet used on the deployed service. Casts go out as the shared test account, not as a persona |
| Read real Farcaster posts | ⚪ Built, off until armed | Optional, when the owner switches it on |
| Sign in with your Farcaster account | 🔵 Built, test data only, deployed 2026-10-11 and not yet used: your account shows as your public self, marked "that's me" | ➖ Not offered here |
| Post as your own Farcaster account (Allow Totem to post as you) | 🔵 Deployed and switched on, the first real approval not done yet: a key made in your browser and kept in your vault, approved in the Farcaster app; then the Post box posts as you. See [Post as you](/mechanism/post-as-you) | 🔵 Built, test data only, by QR code in the Farcaster app; not available until the owner has run the connector setup (one command, about $1) |
| Your Following and Find your people, from your own Farcaster account | 🔵 Built, test data only, not deployed yet: once you sign in with Farcaster, the Following tab is the people your account follows and their posts, and the home card says how many you follow and lists them; your browser reads them straight from a Farcaster node, with no Neynar. That node sees your internet address with your account and what you read; Totem's servers see none of it. See [Following from the hub](/mechanism/following-from-the-hub) {cite: SECURITY-POSTURE.md > "36. Following from the hub: your Farcaster graph, read by your browser from a Farcaster node, and what each party sees"} | ➖ Not offered here: the owner's service is not the public site |
| Where a persona's posts go ("Posts from @persona go") | Shown; anonymous posting is not available here yet, so posts stay in Totem | 🔵 Built, test data only: through @anon (the default without an account), in Totem only, or to its own account |

## At a glance

How a persona's own account would be made and used, on the owner's service:

<ol class="flow">
  <li><strong>Owner</strong>Runs the account command for one persona, after a dry run that prints the cost</li>
  <li class="flow__us"><strong>Owner's server</strong>Works out the persona's own account keys from his root, and signs for it</li>
  <li><strong>Neynar</strong>Registers the account and holds a posting key for it</li>
  <li class="flow__us"><strong>Owner's server</strong>Posts as that persona, within daily limits</li>
  <li><strong>Farcaster</strong>Shows an ordinary account, with nothing naming Totem</li>
</ol>
<p class="flow__note">Built and ready. It has not been run for a persona yet. Two accounts and $10 of spending are the built-in caps.</p>

Each persona that gets an account would hold it through its own custody key, worked out from the owner's root. Whether the 24 words could always take it back is not established: every account also has a recovery address, set when it is registered (for accounts Neynar registers, a recovery proxy shared with other developers), and whoever holds that address can move the account. The account's profile is the persona's own: a profile or handle that names Totem is refused. {cite: SECURITY-POSTURE.md > "14. Network identities (Multi-FID pass): what the network, Neynar and the validator learn about persona accounts and anon posts"}

## The obvious questions

### How do I know whether a post went to Farcaster?

The app says so, before and after. On the owner's service the line under the Post box reads "Posts to Farcaster as @name — public" for a persona with its own live account, and "Saved in Totem only — why" for everything else (no account yet, a private persona, a reply to a post that is not on Farcaster). After you press Post the toast says "Posted to Farcaster as @name" with a link, or "Saved in Totem only". A post is refused, with nothing sent, if the line changed between your look and your click. The same holds for likes, recasts and follows. This build was deployed on 2026-10-10 and has run on test data only; until a persona has its own account, everything still saves inside Totem. The old "Your post was sent." no longer exists.

### Why only on the owner's service?

Every real post today goes through a posting key held on a server. On the public preview, that would let the server post as every visitor. The plan for strangers is posting from your own browser, with a thin relay that forwards posts it cannot change. For your OWN account that is now built, on test data only and not deployed yet ([Post as you](/mechanism/post-as-you)); for a persona's own account it is written down and not built. {cite: notes/runbooks/GO-LIVE-FARCASTER.md > "(h) The public site: what it does now, and what comes next for strangers"}

### Can Farcaster tell two of my personas are one person?

Yes, for accounts drawn from the current wallet: the chain was read on 2026-10-07. Each persona is an ordinary account, but the blockchain records who registered and paid for each one and which app asked for its posting key. The Neynar app wallet that registered the Totem-named test account also pre-registered, in the same minutes, the pool a persona account would be drawn from, so anyone reading the chain can group those accounts with each other and with that test account; a fresh Neynar app and wallet avoids the test account, and the owner decides before the first account. The signer-request account (6131) and the recovery address are shared by every Neynar-registered account and single out nobody. Anything public that you do across them shows too: replying to yourself, following the same people, being created at the same time. Neynar, which registers and posts for every persona account under one key, can see that they belong together. {cite: SECURITY-POSTURE.md > "14. Network identities (Multi-FID pass): what the network, Neynar and the validator learn about persona accounts and anon posts"}

### Can a demo persona get a real account?

No. Only personas made from the owner's own root can, because a demo persona's keys come from a public test value that anyone with the code could use. To give a demo persona an account, clone it into a real one first; cloning is built but has no button in the app yet. {cite: SECURITY-POSTURE.md > "14. Network identities (Multi-FID pass): what the network, Neynar and the validator learn about persona accounts and anon posts"}

### What are the limits?

Ten casts a day, ten follows a day and thirty actions a day in total, across every persona, refused loudly past that. A post for Farcaster is at most 320 bytes. Account creation is capped at two accounts and $10 to start, raisable to at most 20 accounts and $25. {cite: notes/runbooks/GO-LIVE-FARCASTER.md > "(a) What you get, and what it costs"}

### How does connecting my main Farcaster account work?

Built on test data only, on the owner's service, and not available yet. Your existing account becomes a "public self" persona: you type your username, the server asks Neynar for a posting key, and you approve it once in the Farcaster app by scanning a QR code; no seed phrase is typed anywhere. Before anything is saved the server reads the approval back from the blockchain. Farcaster records publicly which app asked for every such key, so Totem needs a small connector account of its own, about $1 of ETH, that nothing else ever uses; one command on the owner's laptop (arm-connector.ps1) creates it and keeps it on the owner service, the owner never handling a key: about 0.0005 ETH on Optimism from an exchange withdrawal, about $1; until the owner has run it the page says so and refuses to start. The guard is built and already running: a reply, like, recast, follow or @mention between your main account and your alts is refused, in both directions, and refused too when the app cannot tell who wrote a post; until main is connected it uses the main account the owner configured, and with none configured those actions are refused outright. <!-- uncited-ok: describes a built-on-test-data flow and its guard, not a privacy claim; the chain read is on the Linkage page -->

### Your public self on the public site

Built on test data, deployed 2026-10-11, only run on test data so far. Press Sign in with Farcaster on Your device and approve in the Farcaster app: your browser checks the sign-in itself and adds your account as a "public self" persona, marked "that's me" on its profile and "Farcaster · read-only" in the preview's switcher (on the live site, built on test data and not deployed, it is the switcher's "You": acting as your own account, with no persona). It never acts as a persona: posting, replying, liking, recasting, following or acting as it through a persona's buttons are refused with "Persona actions never act as your Farcaster account. To act as yourself, choose You in the account menu: then the Post box and the Like, Recast and Reply on Farcaster's posts act as your account, once you allow Totem to post as you. To do this as a persona, switch to one of your personas.", and a persona cannot be forked from it, because the fork's proof would publicly link the two. No other persona of yours may share a name with it. {cite: SECURITY-POSTURE.md > "21. Sign in with Farcaster on the public site: what the relay, the chain node, the server and the validator learn"}

Posting as it has its own door: press Allow Totem to post as you, approve in the Farcaster app, and the Post box posts as your own account with a key kept in your vault. Built, test data only, and not deployed yet. See [Post as you](/mechanism/post-as-you). {cite: SECURITY-POSTURE.md > "35. Post as you: your own Farcaster account's key, Totem's app account, and what each party sees"}

### Where does a persona's post go?

Each persona has a post mode, under the Post box: "Posts from @persona go" through @anon (the default for a persona without its own account), in Totem only, or to its own account (offered once it has one). Through @anon, the post goes out from the shared anonymous account as one of up to 4 posts every 6 hours shared across your personas; see [Anonymous posts](/features/anon-posting). Built, test data only.

## What this does not protect

- **From Neynar.** Under managed posting keys, Neynar can see and post as every persona account.
- **From the blockchain record.** Accounts registered by the same app wallet in the same minutes sit beside each other, and beside the Totem-named test account; anyone can group them. The owner's choice of wallet, before the first account, decides who the siblings are.
- **From the host, on the owner's service.** Railway holds the owner's root in a plain file on its disk; the passphrase does not encrypt it.
- **From your own public behaviour.** Two of your accounts interacting in public is public.

## Where it lives in the code

The posting door: `lib/fc/writes.ts` and `app/api/fc/write/route.ts`, with limits in `lib/fc/writeLedger.ts`. Account records: `lib/fc/personaFid.ts`; creation: `lib/fc/acquire.ts` and `scripts/fid-acquire.mjs`. The app's buttons: `components/Composer.tsx`, `app/api/actions/cast/route.ts`, `app/api/actions/react/route.ts`, `app/api/actions/follow/route.ts`, with the "where does this go" decision in `app/api/actions/farcasterDelivery.ts` and `app/api/actions/delivery/route.ts`. Connecting main: `lib/fc/connect.ts`, `app/api/fc/connect/route.ts`, `components/settings/ConnectMainAccount.tsx`. The public self: `lib/fc/siwf/`, `app/api/fc/siwf/route.ts`, `components/device/FarcasterSignIn.tsx`, `components/profile/ThatsMeBadge.tsx`, `lib/identity/mainName.ts`. The post mode: `lib/identity/postMode.ts`, `components/PostModePicker.tsx`, `app/api/personas/post-mode/route.ts`. Public reads: `lib/fc/readRelay.server.ts`. See [The read relay](/mechanism/read-relay).

## The record

For auditors: each line is tagged in the internal vocabulary and cites the report it comes from.

- **[SHIPPED]** Live Farcaster reads and real writes on the real network, from the throwaway account. {cite: notes/reports/REPORT-FC.md > "GATES 3 & 4 — LIVE ON THE REAL NETWORK (2026-08-29). Pass complete."}
- **[SHIPPED-FIXTURE]** Persona ↔ FID model with signer custody. {cite: notes/reports/REPORT-FID.md > "GATE 1 — Persona ↔ FID model + signer custody"}
- **[SHIPPED-FIXTURE]** Real persona accounts: everything up to and after the owner's creation step is built; no persona account has been created. {cite: notes/reports/REPORT-FID.md > "GATE 2 — Live: two real persona accounts"}
- **[SHIPPED-FIXTURE]** Anon-post mode (the anoncast pattern inside Totem); never run live. {cite: notes/reports/REPORT-FID.md > "GATE 4 — Anon-post mode (the anoncast pattern, inside Layers)"}
- **[SHIPPED-FIXTURE]** The anoncast reveal: prove a past anon post is yours, later, to a persona of your choice; the reveal is signed. Not yet through its closing reviews. {cite: notes/reports/REPORT-FID.md > "ADDITION (after the pass closed) — anon-post ATTRIBUTION: the anoncast reveal pattern"}
- What the network, Neynar and the validator learn about persona accounts and anon posts. {cite: SECURITY-POSTURE.md > "14. Network identities (Multi-FID pass): what the network, Neynar and the validator learn about persona accounts and anon posts"}
- **[SHIPPED-FIXTURE]** Launch (Persona launch P6): a persona's own self-custody account, made by a simulated Totem registrar 2 to 48 hours after an anonymous request, with one registrar app fid and a root-derived recovery key; direct posts through a thin relay signed by the account's own key. Deployed 2026-10-12 on the simulated registrar; no live path. {cite: SECURITY-POSTURE.md > "26. Launch (Persona launch P6): a persona's own account, on test data"}
