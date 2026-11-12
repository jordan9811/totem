---
pageClass: eli5
---

# What is Totem

One person, several faces online, on purpose. You choose who gets to connect the dots.

::: info Status: a working preview
Anyone can open the public preview and use it in their browser today: make an identity, make personas, post, tune your feed. What you post stays inside Totem, and only until you reload; nothing reaches Farcaster from the public preview yet. The app's privacy label reads DEMO, and [Privacy in plain words](/start/privacy-in-plain-words) says why.
:::

## At a glance

<ol class="flow">
  <li><strong>You</strong>Open Totem. Your browser makes a private identity for you</li>
  <li><strong>You</strong>Save it with Face ID or a passkey, or keep it in this browser. Unsaved, it is gone when the tab closes or reloads</li>
  <li class="flow__us"><strong>Totem</strong>Makes personas from that one identity: a finsta, an alt, a work self</li>
  <li><strong>You</strong>Post, read and follow as whichever persona fits the moment</li>
  <li><strong>Your friends</strong>See the deeper you, but only the ones you put in your rings</li>
</ol>
<p class="flow__note">The last step, rings, is built on test data only, deployed 2026-10-12 and not yet used. A friend without Totem gets a private link card instead. See <a href="./who-sees-what">Who sees what</a>.</p>

## The problem

On most social apps you are one account with one audience. Your mum, your boss, your old school friends and strangers all read the same posts. So people post for the strictest reader in the room and keep the rest to themselves. This is called context collapse.

Making a second account helps a little. But the accounts are not connected, the app can usually tell they are both you, and there is no way to let a few close friends know which ones are yours.

## How Totem fixes it

- **One private identity, many personas.** Your browser holds one secret: your root. Every persona is made from it. Each persona has its own name, handle and posts.
- **You decide who connects the dots.** By default, a persona stands alone. You show chosen people which personas are you, in up to 16 rings, like a MySpace Top 16 where each ring sees a deeper version of you. Rings are built on test data only, deployed 2026-10-12 and not yet used.
- **The server stores sealed data.** On the public preview, the Totem server keeps your saved things only as scrambled data that only your browser can open. Your root, your 24 words and your keys stay with you. Your public posts stay in your tab and are gone after a reload. {cite: SECURITY-POSTURE.md > "16. Custody and topology (Browser keystore pass): what the browser holds, what the server holds, what each save path trusts, what root linking does and does not do"}
- **Farcaster underneath.** Totem is an app for Farcaster, an open social network. On Farcaster your account and your posts are not owned by one app, so many apps can show them. Totem adds personas on top.

## The obvious questions

### Is it live?

The public preview is live and anyone can use it. It is a preview: posts stay inside Totem, and real Farcaster posts to read are built but switched off. The owner also runs a private copy built to post to Farcaster for real. Today a real post can go out from it only as a shared test account, by command line, and none from it is on record yet. Giving each of his personas its own Farcaster account is ready there, and none has been made yet. [What reaches Farcaster](/start/farcaster) has the details.

### Is this a new social network?

No. Totem is an app for Farcaster, the way a mail app is an app for email. The people you follow and the posts you read live on Farcaster, which any app can use. Totem is the part that lets you be more than one person there.

### Do I need crypto, a wallet or money?

No. Nothing on the public preview costs money or asks for a wallet. Behind the scenes, Farcaster accounts are recorded on a blockchain, and giving a persona its own Farcaster account costs about $0.35 to $0.90. On the owner's private service the owner pays that himself. The public preview does not create Farcaster accounts.

### Can people tell my personas are the same person?

Not from anything Totem shows to other people, but do not count on that yet. The server stores the link between your personas only as sealed data. It can still guess from how you connect: your personas reach it from the same internet address, at related times. That is one of the reasons the app's label says DEMO. Your own habits, like posting times, writing style and who you follow, can also give you away. {cite: SECURITY-POSTURE.md > "2. What the operator can still do"}

### Can I log in with my X or Farcaster account?

Farcaster: yes, read-only, on the public preview. It is deployed (2026-10-11) and has only run on test data so far. It shows which Farcaster account is yours; your identity is still made in your browser and saved with Face ID or a passkey. Posting as it is a separate step, built on test data and not deployed yet: [Post as you](/mechanism/post-as-you). X: not built, by decision, because it needs a paid X developer app; [Bring your X](/start/bring-your-x) uses your archive instead. See [Your first 5 minutes](/start/first-5-minutes). {cite: SECURITY-POSTURE.md > "21. Sign in with Farcaster on the public site: what the relay, the chain node, the server and the validator learn"}

### Who runs it?

One person, the owner, builds Totem and runs both sites on Railway, a hosting company.

## Where to next

<div class="cards">
  <a href="./first-5-minutes"><strong>Your first 5 minutes</strong>Save your identity first, then make a persona and post.</a>
  <a href="./personas"><strong>Personas, explained</strong>What a persona is, what it shares with your others, and what it does not.</a>
  <a href="./who-sees-what"><strong>Who sees what</strong>Your Top 16: rings of people, each seeing a deeper version of you.</a>
  <a href="./farcaster"><strong>What reaches Farcaster</strong>What goes out to the network and what stays inside Totem.</a>
  <a href="./bring-your-x"><strong>Bring your X</strong>Drop in your X archive: your posts, and the people you follow who are on Farcaster. Built, test data only.</a>
  <a href="./privacy-in-plain-words"><strong>Privacy in plain words</strong>What is hidden today, from whom, and what is not hidden yet.</a>
</div>

Curious how it works underneath? The [mechanism pages](/mechanism/) are written for crypto readers. Building on it? Start with the [architecture](/technical/architecture).
