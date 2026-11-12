---
pageClass: eli5
---

# Glossary

Every word these docs use that is not everyday English, in plain words. Alphabetical.

| Word | What it means |
|---|---|
| **24 words** | Your recovery phrase: your root, written as 24 ordinary words. Whoever has them is you. Keep them on paper, offline. |
| **Act as** | Replying, quoting or recasting as one of your other personas without switching to it. |
| **@anon** | The shared Farcaster account with no name on it that anonymous posts go out from. |
| **Anon post** | A post made as one of your personas that goes out through @anon, after a proof that you are a real member. Up to 4 every 6 hours per person, shared across your personas. Built, test data only: on the owner's service, and, not deployed yet, on the public preview, where your browser makes the proof and the post stays inside the preview. |
| **Anoncast** | An existing Farcaster app where members post through one shared account with no name on it. Totem's anon posts copy the idea. |
| **Attestation** | A badge an outside issuer gives a persona, such as "this wallet is over a year old", which the persona can later prove it holds without saying which person, meaning which root, it belongs to. Built, test data only. |
| **Audience tier** | How much of you a person sees. Built as rings (your Top 16), test data only, deployed 2026-10-12. Not the same as a reputation tier or a reach tier. |
| **Auth address** | A second address a Farcaster account can approve to sign in for it. Sign in with Farcaster checks on the blockchain that the account really approved it. |
| **Cast** | A Farcaster post. |
| **Clone** | A new persona that starts with copies of another persona's modes, rules and folders. Built; no button in the app yet. |
| **Copy of Totem** | One separate set of data. On the public preview every browser has its own copy, even on the same site, so two visitors cannot see each other's grants. |
| **Compartment mode** | One tap that narrows the app to the persona you are using, for when someone can see your screen. |
| **Curator** | Someone who writes notes on posts, usually as part of a small group (a desk) that must agree before a note shows. |
| **Custody address** | The wallet address that owns a Farcaster account, recorded on the Optimism blockchain. Sign in with Farcaster checks a sign-in against it. |
| **Delivery tier** | How one account shows up in one mode. **Never miss**: its posts are pinned near the top. **Banner**: they show in a strip above your feed. **Normal**: the default. **Facet only**: you see only its posts on the topics of its that you follow. **Quiet**: its posts are pushed down. Not the same as an audience or reputation tier. |
| **DEMO label** | The app's own privacy check, shown in red while any of its conditions is not met. The banner says how many fail; Settings, ZK privacy layer lists them. |
| **Demo world (sample people)** | The made-up people and posts that fill the app so there is something to try. You see them on the public preview, but you cannot grant them anything. The owner's service is switching them off. |
| **Device** | Your browser, which runs the Totem engine itself on the public preview: it holds your keys and answers the app's own requests. |
| **Escrow** | Money held by a middleman until a deal is done. In the simulated ad market, no real money is involved. |
| **ETH** | The currency of Ethereum and its networks, where Farcaster accounts are recorded. A persona's own account costs about $0.35 to $0.90 in ETH. |
| **Epoch** | A fixed stretch of time (six hours by default) that proofs and allowances are counted in. |
| **Farcaster** | An open social network. Your account and posts are not owned by one app, so many apps, including Totem, can show them. |
| **FID** | A Farcaster account's number. Every Farcaster account has one, recorded on a blockchain. |
| **Fname** | A Farcaster username, like @alice. |
| **Folder** | A group of saved articles. Reading pieces can come from the folders you put first. |
| **Grant** | A small signed note from you that says "this person may see that these personas are one person". Stored sealed. |
| **Launch** | Making a persona public for good. All its anon posts are revealed at once and it gets its own Farcaster account, made by a Totem registrar 2 to 48 hours later. Built, test data only, against a simulated registrar. |
| **Totem on X** | A Totem account on X that would post copies of anonymous posts after a moderator reads each one, and that you could DM a tweet to save it. Built on test data only: nothing reaches X. |
| **Lease** | How long a ring's note lasts before it runs out on its own: 72 hours, renewed about every hour while your device is on. |
| **Lens** | A recipe for ranking the same feed differently. You can share one, and preview what it would change first. |
| **Mode** | A named way of reading, such as Default, Work or Curate: its own feed, rules and buttons. |
| **Moderator** | For Totem on X, the person (the owner) who reads each copy before anything goes out, and approves it or not. They read the words, not who wrote them. |
| **Neynar** | A company that runs Farcaster services. Totem reads and posts through it. |
| **Owner's service** | A private copy of Totem that only the owner logs into. It holds his identity on the server so it can post to Farcaster for him. |
| **Passkey** | A login saved by your phone, computer or password manager, unlocked with your face, fingerprint or PIN. Totem uses one to keep your identity. |
| **Post mode** | Where a persona's posts go, set under the Post box ("Posts from @persona go"): through @anon, in Totem only, or to its own account. |
| **Persona** | One of your faces: a finsta, an alt, a work self. Made from your root, with its own name and posts. On one device all your personas share one follow list. |
| **PRF** | A feature some passkeys have that lets the same passkey unlock your identity on any of your devices. |
| **Preview only** | The mark on an anonymous post made on the public preview: test data that stays inside the preview and is never posted to Farcaster. |
| **Private persona** | A persona whose posts only the people you grant can see at all. |
| **Proof** | A short piece of maths that shows something is true (like "this persona's owner is a member") without showing who. Also called a zero-knowledge proof, or ZK proof. {cite: SECURITY-POSTURE.md > "1. What is now mathematically hidden (given the conditions in §4)"} |
| **Prover** | The part that makes a proof. On the public preview (from its next deploy) it runs in your browser, in a background worker of its own; on the owner's service, on the server. |
| **Public self** | Your own Farcaster account, shown in Totem after you sign in with it, marked "that's me". Once you allow Totem to post as you, the Post box posts as it; it never acts as a persona. Built, test data only. |
| **Public preview** | The Totem site anyone can open. Your identity lives in your browser, and posts stay inside Totem until you reload. |
| **Reach tier** | A follower bucket (1k, 10k or 100k Farcaster followers) an anon post can prove, without saying which account, to get more reach in For You. Offered only while at least 50 accounts are in it. Not a reputation tier, not a ring. Built, test data only. |
| **Registrar** | The part of Totem that creates a launched persona's Farcaster account and pays for it, so the blockchain shows "made by Totem", not "made by you". Simulated today: it creates nothing on Farcaster. |
| **Readwise** | Long articles split into short pieces that show up in your feed until you have read them. |
| **Recast** | Sharing someone's Farcaster post to your followers, like a retweet. |
| **Relay** | A go-between. Three kinds: the anon relay posts anon posts for everyone from one account; the read relay fetches real Farcaster posts for the public preview; and a connection relay, run by someone else, would hide your internet address from our server (the privacy check's first condition, not set up yet). |
| **Reputation tier** | A level a persona earns from activity and can prove without saying which person it belongs to. Some feeds, like For You, check it. Today a device reports its own activity, so a tier is self-reported. Built, test data only. |
| **Ring** | A group of people you pick, up to 16 rings. For each persona a ring sees that it is you, or also which anon posts it wrote. Built, test data only. |
| **Ring address** | A private address your device makes for you to hand someone, over Signal or in person, so they can put you in one of their rings. |
| **Ring note** | A sealed note of exactly 256 bytes on every anon post: real for the rings that see that persona's posts, random bytes otherwise, so nobody else can tell which posts have an audience. |
| **Rig** | The owner's laptop copy of Totem, used for building and testing, full of test data. |
| **Root** | The one secret your browser keeps. Every persona is worked out from it. |
| **Rule** | A filter you build for a mode: hide, push down or flag posts that match. |
| **Sealed** | Scrambled with a key the server does not hold. The server keeps the scrambled copy; only your browser can open it. |
| **Slot** | One of your 4 anonymous posts in a 6-hour window. Each post takes a free slot, so two posts of yours carry two different one-time codes. |
| **Site** | One of the two places Totem runs: the public preview and the owner's private service. |
| **Spaces** | Live audio rooms, as on X. Totem has scripted text rooms in that style; the audio is a placeholder. |
| **Sign in with Farcaster** | Scanning a QR code with the Farcaster app to show which Farcaster account is yours. It does not save your identity. Built, test data only. |
| **Signer** | The key that lets an app post as a Farcaster account. Today Neynar holds the signers for the owner's personas. |
| **Stake** | A bit of your influence allowance put behind a post you think is good, worth reading, wrong or misleading. Built, test data only. |
| **Tint** | A persona's colour on the app's frame, so you can tell at a glance who you are posting as. |
| **Top 16** | Your whitelist: the people you pick to see the merged you, as up to 16 rings. Named after MySpace's friends list. Built, test data only. |
| **UBI** | Here, a regular allowance of influence every person gets each epoch, to spend as stakes. Not money, and there is no way to transfer it. Built, test data only. |
| **Validator** | The part of the Totem server that stores sealed records, public keys and proofs. |
| **Vault** | Your sealed records on the server, as a whole. |
| **Whitelist** | See Top 16. |
