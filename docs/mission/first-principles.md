# First principles
<!-- uncited-ok: page: the owner's vision and the rules derived from it are a position, not a verified claim; every status here comes from lib/status/features.ts and its pages -->

::: info Status: the vision and the rules for judgment calls
This page is the owner's vision (2026-11-05, in his words, condensed) and the principles every build is judged against. Most of the vision is not built. The status table below says what is, and the [home page](/#what-works-today) says what works today.
:::

## The foundation: anoncast

Personas started on anoncast. On anoncast every post goes out from one shared anonymous account, and each post carries a commitment to a reveal secret that only its author holds. The owner reused the **same reveal secret** whenever he posted about one topic, so all of those posts could later be proven to come from one author, while posts on other topics, under other secrets, stayed unconnected. That is a persona: a voice that exists as a set of posts provably sharing an author, with no name on it, shown to exactly the people its owner chooses.

Everything in Totem is that idea made into a product. The root is the person. Each persona is a voice. A reveal, now a ring, is the owner choosing who learns which voices are theirs. Any feature that weakens that cryptographic separation breaks the foundation, whatever it adds.

How it is built today: an anonymous post's commitment is `sha256("layers-anon-attribution/1" ‖ secret)` over a fresh random secret, sealed in your vault, and a reveal is signed by the account it names (SECURITY-POSTURE.md §14.1 and §14.2, on test data and below the closing review bar). Rings carry the persona-level reveal: a ring's members see which of your personas wrote each anonymous post (§24).

## The vision, in the owner's words

- **Personas decouple the algorithm from identity.** I can post my astronomy stuff and only the people I let see that deep see it. I can also have an astronomy mode where I get astronomy content (kind of like channels), or lifestyle modes (work, after work, weekend) with leisure stuff like sports, fantasy football analysis or astronomy. I can loosely connect a persona to an algorithm if I want, but I don't have to.
- **Channels and hashtags never solved the real thing.** People need a way to label and discuss topics, and to decide selectively who can see them or who is subscribed. Maybe I'm fine with you seeing my astronomy posts if you check my page, like MySpace, but I don't want them broadcast on your timeline. And some people I don't want to be able to find them at all.
- **Algorithms open for tinkering, reach compartmentalized through personas.** That is the actual fix for context collapse, the one channels and hashtags tried and failed to deliver.
- **Labels are probably ours to build** (not Farcaster's). Maybe start from X's open-source algorithm and other public resources.
- **Time travel.** Search the Drake looking-back meme, an event like Super Bowl 50, or any specific meme, and teleport back to see the timeline as it was then. The same works topically, for astronomy.
- **Subcultures without new accounts.** Crypto Twitter, sports Twitter, finance Twitter, political Twitter, Black Twitter. Today you have to reverse-engineer your algorithm to reach these communities. To take part discreetly, you make a new account, port everything over by hand and build reputation from scratch: a nightmare. Totem makes reputation and algorithms fungible and shareable, like Pinterest boards.
- **Accountability.** zkTLS-verify something, pin it to someone, keep curation boards: "this doctor pushed X hard and supported Y", with the proof attached. Proof-backed accountability (the owner: "cancel culture is good actually") helps bootstrap network states.

## The principles (use these for every hard judgment call)

1. **Context collapse is the enemy.** A feature is worth building when it lets one person show up differently to different audiences without a new account and without starting over.
2. **Three separate dials: who I am, what I see, who sees me.** Persona (identity), mode or lens (algorithm) and audience (rings and visibility) are independent. They are coupled only when the owner of the persona chooses to.
3. **Unlinkability is the product.** Anything that lets an observer tie a persona to its root is a top-priority bug: data, timing, metadata, network reads, a shared configuration, moved reputation, writing style. Every party counts: the server, the network node, Neynar, other users. New read and write paths get checked against personas specifically before they ship.
4. **Visibility is a ladder, not a switch.** Broadcast in timelines → findable on your page → only rings you choose → unfindable. A public protocol (Farcaster) can only do the top rung, so everything below it is encrypted and held on Totem's side.
5. **Portable by proof, not by copy.** Reputation moves between personas as a proof of a property ("in this tier", "verified this"), drawn from a crowd big enough to hide in, never as a copied number that links the accounts. Algorithms and curation boards are artifacts you can export, share and fork.
6. **Accountability needs evidence and a reply.** A pinned claim carries verifiable evidence (an attestation, a zkTLS proof), is about public conduct, and gives its subject a way to answer. Proof, not mob.
7. **A client over the networks people already use.** Totem is Morpho, not Aave: parity with X and Farcaster first, and the improvement is the only new thing to learn.
8. **Say exactly what is real.** Built, deployed, switched on and working are four different words. Unbuilt is "coming soon".

## Where each piece stands (2026-11-05)

| Piece of the vision | Status | What exists |
|---|---|---|
| Personas over one root | 🟢 Works live | Many personas per identity, switching, a colour each. On the public site they live inside Totem only. |
| Modes, lenses, rules (the algorithm dial) | 🟢 Works live | Modes with their own ranking, rules and lens; delivery tiers; scroll zones. A lens exports as a signed, shareable artifact. |
| An algorithm used by any persona (loose coupling) | 🟡 Partly | Modes belong to a persona today; choosing any mode from any persona is not a setting yet. |
| Who sees how deep (Top 16, rings) | 🔵 Built, test data only | Up to 16 rings; a ring sees which persona wrote an anon post. Not used on a deployed site yet. |
| "On my page but not in your timeline" | 🟣 Coming soon | No page-only visibility level yet. |
| Unfindable to chosen people | 🟡 Partly | Anon posting hides who wrote a post from everyone outside your rings (test data only); per-person hiding is not built. |
| Topic labels (the channels and hashtags fix) | 🟣 Coming soon | Not built. Ours to build, possibly starting from X's open-source ranking code (AGPL-3.0: our changes would have to be published). |
| Time travel ("Super Bowl 50 as it happened") | 🟣 Coming soon | Not built. Farcaster's history is readable from its network; X's history is not available to us beyond a person's own archive. |
| Search | 🟢 Works live, partly | Searches what your device holds; the smart part is a stand-in; it does not search Farcaster yet (searching it through Neynar is built on test data and switched off: an owner's switch, never a read that names you). |
| Fungible reputation | 🔵 Built, test data only | Reputation tiers checked with a membership proof; activity is self-reported today. |
| Shareable, fungible algorithms ("Pinterest boards") | 🔵 Built, test data only | Portable algorithms (REPORT-A Gate 2): a signed artifact carrying its rules in full, forkable with its lineage inside the signature ("modified from @author's algo vN"), import guardrails that refuse any rule touching disclosure, and a public "Algo Shelf". Filter packs attach to a mode (REPORT-B Gate 1); lenses export signed (Mega pass 2). Missing: the shelf as a real marketplace, used on a deployed site. |
| Verified claims (attestations) | 🔵 Built, test data only | An open issuer interface and attestation-gated surfaces. The zkTLS verifier is not built: the web-proof seam refuses until one exists. |
| Accountability boards and verifiable boycotts | 🔵 Partly built, test data only | Curator desks (REPORT-A Gate 4): annotations signed by a desk's multisig, with an evidence link; each subscriber picks badge, demote or auto-block, applied at read time and reversed by unsubscribing. Refutation edges with tier-weighted standing, so volume never wins (King of the Hill); concur or dispute per annotation; 3-strike relationship history; network-state filter packs. Missing: the zkTLS verifier for evidence, a board for pinning proofs to a public figure, and a deployed run. |
| Bring your graph and history | 🟢 / 🔵 | Your Farcaster Following live; X archive import on test data only. |

## How we get there

Each step keeps the foundation intact; none trades the separation for a feature.

1. **Your real self in, done right (now).** Sign in with your Farcaster account, your real Following, posting as yourself, and the rule that this browser never reads your personas or reads anything as you while a persona acts.
2. **The anoncast foundation, live.** Switch on @anonwire and rings on the public site, so personas are anonymous voices revealed to the people you choose.
3. **The visibility ladder.** Add "on my page, not in your timeline" and "hidden from these people", as encrypted posts Totem holds.
4. **Topic labels.** Labels you put on your own posts, which people subscribe to per persona and per label, and which modes can read: the channels and hashtags fix.
5. **The algorithm dial on its own.** Any mode from any persona, plus boards for browsing, sharing and forking other people's lenses.
6. **Reputation by proof.** The live proof system with a real crowd, and activity Totem checks instead of self-reports, so reputation moves between personas without linking them.
7. **Time travel.** A timeline for any date, topic or meme, from Farcaster's own history and from the X archives people bring.
8. **Accountability boards.** A zkTLS verifier, proofs pinned to public conduct, a right of reply and moderation.
9. **Unlinkability for real.** An outside network relay, signing keys you hold yourself, and crowds big enough to hide in.

## Can the server mechanically link you? (2026-11-05)

- **Its data: no.** Since migration 006 the validator has no table, column or index linking a persona to a root, and a check fails on every run if one comes back (SECURITY-POSTURE.md §10). Your vault is sealed in your browser, in padded, opaque records. An anonymous post carries a zero-knowledge proof of crowd membership, never of which member.
- **Its network view: yes, until an outside relay runs.** Your browser talks to the server directly, so the server sees the same internet address and browser for you and for your personas' anonymous posts. The fix is built: with `ZK_RELAY=ohttp` the tab encrypts each anonymous submission for the validator's OHTTP gateway, and a relay run by someone else forwards it, so the server sees only the relay (§27). Missing: the third-party relay itself (an operator agreement), and the ring-mailbox reads, which still go direct.

## Where privacy is hardest

- **The relay is the last mechanical link.** The data layer holds no link; the network connection does, until an independent OHTTP relay runs.
- **Everything below "broadcast" leaves Farcaster.** Page-only, ring-only and unfindable posts must be encrypted and stored by Totem, and readers have to be on Totem.
- **Labels and shared lenses are fingerprints.** The same unusual label set or the same tuned lens on two personas links them. Exports need to be stripped or forked, never shared verbatim.
- **Moved reputation is a link** unless it moves as a proof from a big enough crowd. Crowd size is the real limit.
- **Search and time-travel queries say what you're interested in.** Run them on your device or through a relay, never as your root.
- **Accountability boards carry legal risk** (defamation, harassment) and can expose the poster if a proof was made under their own logged-in session.
