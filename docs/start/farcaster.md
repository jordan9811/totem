---
pageClass: eli5
---

# What reaches Farcaster

Totem is an app for Farcaster. Some of what you do could go out to the network; most of it stays inside Totem. Here is exactly which, on each of the two Totem sites.

::: warning Status: on the public preview, nothing goes out
Nothing you do on the public preview reaches Farcaster. Reading real Farcaster posts there is built and switched off until the owner turns it on. On the owner's private service, a real post can go out today only through a command-line path, from a shared test account, and none from that service is on record yet. The app's own Post box, likes, recasts and follows are now built to post as a persona with its own account, and say where each post goes; that build was deployed on 2026-10-10 and has run on test data only; with no persona account made yet, every post there says "Saved in Totem only". The message "Your post was sent." no longer exists anywhere: the public preview says "Posted to your Totem preview, not to Farcaster" on every post.
:::

::: info The go-live build (2026-10-17), not deployed yet
The go-live build makes the public site the product. A persona's posts reach Farcaster through the public @anon, one shared account with no name on it, once the owner switches it on; Farcaster people can post the same way from the anon page, also a Mini App inside Farcaster. Your main account stays read-only in Totem: posting as it stays in the Farcaster app. Likes, recasts and follows stay in Totem. Real Farcaster posts fill the home feed once the owner adds the read key. {cite: SECURITY-POSTURE.md > "31. The public @anon relay (Public go-live)"} {cite: SECURITY-POSTURE.md > "33. The native anon page and the Farcaster Mini App (Public go-live)"}
:::

## At a glance

Two words first. **Neynar** is a company that runs Farcaster services; Totem posts and reads through it. A **cast** is a Farcaster post.

<DiagramRequestPath caption="The public preview: your browser holds your keys and talks to two Totem servers. All three roads to Farcaster are closed there today. On the owner's private service, the server holds the keys instead." />

## Action by action

| What you do | On the public preview | On the owner's private service |
|---|---|---|
| Sign in with your Farcaster account | 🔵 Built and deployed (2026-10-11), only run on test data so far: scan a QR code in the Farcaster app and your account shows as yours, read-only. Nothing is posted and nothing changes on Farcaster | ➖ Not offered here: use Connect your Farcaster account |
| Post as your own Farcaster account | 🔵 Deployed and switched on, the first real approval not done yet: press Allow Totem to post as you, approve in the Farcaster app, and the Post box posts as you with a key kept in your vault. See [Post as you](/mechanism/post-as-you) | 🔵 Built, test data only, by Connect your Farcaster account (below) |
| Make a persona | Stays in Totem | Stays in Totem. A persona can also get its own Farcaster account: ⚪ ready, off until the owner makes one |
| Write a post | Stays in Totem, and says "Posted to your Totem preview, not to Farcaster" | 🔵 Built, test data only, deployed 2026-10-10 and not yet used: a persona with its own Farcaster account posts there, and the app says "Posted to Farcaster as @name"; anything else says "Saved in Totem only" and why. No persona has its own account yet, so posts stay in Totem |
| Like, recast, follow | Stays in Totem. On a real Farcaster post it is refused with "Posting to Farcaster isn't on this preview yet." | 🔵 Built, test data only, deployed 2026-10-10 and not yet used: real likes, recasts and follows as a persona with its own account, with "Saved in Totem only" everywhere else. Undoing one on Farcaster is not available from the app |
| Reply to a real post as a persona with its own Farcaster account | Refused | ⚪ Built: the reply goes to Farcaster, signed by that persona. No persona has its own account yet |
| Read real Farcaster posts | ⚪ Built, off until the owner turns it on. Then: a feed of authors the owner picked, plus profiles and threads, read-only | Can show real Farcaster when switched on. Hiding the made-up demo world there is 🔵 built, deployed 2026-10-10, not yet looked at |
| Post anonymously | 🟣 Posting to Farcaster: coming soon. On the deployed site there is no switch yet ("Anonymous posting isn't on this preview yet."). 🔵 Built, test data only, not deployed yet: your browser makes the proof and the post stays inside the preview, marked "Preview only · not on Farcaster"; nothing reaches Farcaster | 🔵 Built, test data only: as one of your personas through @anon, up to 4 every 6 hours. It has not posted for real yet |
| Launch a persona: its own account, its anonymous posts revealed | 🟣 Coming soon: it says "Launch isn't on this preview yet." | 🔵 Built, test data only, deployed 2026-10-12: a simulated registrar makes the account on a simulated chain, 2 to 48 hours later; nothing is created on Farcaster. With real Farcaster on, it says "Launch needs the Totem registrar, which isn't set up yet." See [Launching a persona](/features/launch) |
| Find your X follows on Farcaster | 🔵 Built, test data only: matched on your device. The list it needs is not switched on yet, and following them from Totem comes later | 🔵 Built, test data only, the same |
| Channels | Not in version 1: channel tabs show preview content | Not in version 1 |

## Where your posts live

<div class="chip-key">
  <span class="where where--device">Device</span> your browser
  <span class="where where--server">Server</span> the Totem server, sealed
  <span class="where where--network">Network</span> Farcaster, public
</div>

- On the public preview, a public post is <span class="where where--device">Device</span>: written in your browser and kept in the tab's memory, so a reload clears it. The server does not keep it. A private persona's post is <span class="where where--device">Device</span><span class="where where--server">Server</span>: sealed in your browser and stored sealed.
- On the owner's service, a post from the Post box is kept in the server's memory until the next restart.
- On the owner's service, a cast sent to Farcaster is <span class="where where--network">Network</span>: public, permanent on the network, and readable by any app.

## The obvious questions

### Why doesn't the public preview just post to Farcaster?

Because today every real post goes through a posting key that a server holds. On the public preview that would let the server, and anyone holding its Neynar key, post as every visitor. Totem's one firm rule is that the public server holds none of your keys. Posting from your own browser, with a thin relay that forwards posts it cannot change, is the way out: for your OWN account it is built, on test data only and not deployed yet (Allow Totem to post as you, above); for a persona's own account it is written down and not built. {cite: notes/runbooks/GO-LIVE-FARCASTER.md > "(h) The public site: what it does now, and what comes next for strangers"}

### Does an anonymous post from the public preview reach Farcaster?

No. Once it is deployed, an anonymous post made on the public preview is test data: it stays inside the preview, its card says "Preview only · not on Farcaster", your browser refuses to send anything meant for Farcaster, and the server refuses it again. Posting through @anon to Farcaster from the public preview needs a public anonymous account of its own, which the owner has not set up. {cite: SECURITY-POSTURE.md > "27. Anonymous posting from the public site (Persona launch P7): the prover in your browser, the web channel, and what the operator sees"}

### My post on the owner's service: did it reach Farcaster?

The app now says exactly where it went. On the owner's service, a persona with its own Farcaster account posts there, and the app says "Posted to Farcaster as @name" with a link; anything else says "Saved in Totem only" and why. The line under the Post box says where a post will go before you press Post. The old message "Your post was sent." no longer exists. This build has only run on test data and waits for a deploy; until then, posts on the deployed service stay inside Totem.

### What does Farcaster learn when a persona posts?

That they belong together, if they come from the same wallet: the chain was read on 2026-10-07. When a persona has its own Farcaster account, the network sees an ordinary account: its posts, follows, likes, handle and when it was created. It also sees, on the blockchain, who registered and paid for each account and which app asked for its posting key. Accounts the current Neynar wallet registers sit beside the Totem-named test account, registered in the same minutes, so anyone reading the chain can group them; the owner decides before the first account whether to accept that or use a fresh wallet. Two of your accounts replying to each other links them too, in public. Neynar is different again: it creates and posts for every persona account under one key, so it can see they belong together. {cite: SECURITY-POSTURE.md > "14. Network identities (Multi-FID pass): what the network, Neynar and the validator learn about persona accounts and anon posts"}

### What does it cost?

Nothing on the public preview. On the owner's service, a persona's own Farcaster account costs about $0.35 to $0.90 once, paid in ETH, the currency of the blockchain where Farcaster accounts are recorded, and posting is paid in Neynar credits (150 per cast) from his plan. The public preview's reading, when switched on, has its own budget of 100,000 credits a day. {cite: notes/runbooks/GO-LIVE-FARCASTER.md > "(a) What you get, and what it costs"}

### When the public preview shows real posts, what does the server see?

Those reads go through the Totem server, so it sees which profiles and threads are opened, from which address and when. The hosting company's logs record the same page addresses. Your own Farcaster account number is not sent. {cite: SECURITY-POSTURE.md > "19. Public live reads (FC-READ): what the relay holds, what it reads, what the operator now sees, and what it costs"}

### Can I sign in with my Farcaster account?

On the public preview, yes, read-only: deployed on 2026-10-11, and only run on test data so far. Press Sign in with Farcaster on Your device, scan the QR code with the Farcaster app and approve. Your account then shows in Totem as yours, marked "that's me". Signing in alone posts nothing; posting as it is its own step (next question). Signing in does not save your identity: a passkey does. Farcaster's sign-in service and the blockchain node your browser asks see that you signed in, and your internet address; the Totem server is not asked, except that once anonymous posting to Farcaster is on, Totem checks the same sign-in and records that your account joined the anonymous crowd, with your internet address. Not offered on the owner's private service. {cite: SECURITY-POSTURE.md > "21. Sign in with Farcaster on the public site: what the relay, the chain node, the server and the validator learn"}

### Can I connect my main Farcaster account?

On the public site: built, on test data only, and not deployed yet. After you sign in, press Allow Totem to post as you. Your browser makes a posting key and keeps it in your vault; you approve it in the Farcaster app, which may ask you for a small network fee; once Farcaster's network lists the key, the Post box posts as your own account ("Posts go to Farcaster as @you."). Totem's server signs the request and passes your posts on, so it sees them and your internet address. Disconnect forgets the key here; removing Totem in the Farcaster app's connected apps is what stops it. No Neynar is involved. See [Post as you](/mechanism/post-as-you). {cite: SECURITY-POSTURE.md > "35. Post as you: your own Farcaster account's key, Totem's app account, and what each party sees"}

On the owner's service, a separate flow, also built on test data only: your existing account becomes a "public self" persona you can post as from Totem, approved once in the Farcaster app by scanning a QR code, with no seed phrase. It needs a small connector account of its own, which one command on the owner's laptop (arm-connector.ps1) creates and keeps on the owner service, with no key in the owner's hands: about 0.0005 ETH on Optimism from an exchange withdrawal, about $1. The Settings page says "not available" until the owner has run it. The guard that refuses interactions between it and your alts is built and already running.

## Read more

- [Posting and Farcaster accounts](/features/network-identities): the feature page.
- [The read relay](/mechanism/read-relay): how live reads are budgeted and what they reveal.
- [Sign in with Farcaster](/mechanism/sign-in-with-farcaster): how the browser checks a sign-in, and who learns what.
