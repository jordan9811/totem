# The anon relay

The anoncast pattern inside Totem: a post made as one of your personas proves "one registered root in this tree, a free slot of this window", and the validator posts the text from a shared Farcaster account, @anon, that belongs to no persona.

::: danger Status: built, test data only, never run live
Every path is verified on fixture data on the laptop rig. No live anon cast has ever been made. Arming it on the owner service is the runbook's section (f): one script with a typed confirmation, a cap of one post, and its own kill switch; on that one-owner service the anon account is an extra account with no name on it, not a crowd. The reveal addition (prove later that an anon post was yours) is below the bar everything else met: three adversarial reviews and four clean sweeps. On the deployed public preview anonymous posting is unavailable, and the composer says so. Wave 3 builds it for the public site on test data, not deployed yet: a prover in a Web Worker and a browser anonymous channel, with every post staying inside the preview (below, and {cite: SECURITY-POSTURE.md > "27. Anonymous posting from the public site (Persona launch P7): the prover in your browser, the web channel, and what the operator sees"}). Persona-scoped posting (the persona kept in the sealed reveal record, 4 slots per person per window, the post mode) is <span class="st st--test">Built, test data only</span>, like everything else here. The go-live build (2026-10-17, not deployed) adds the public @anon: the public validator relays strangers' posts from one agent account, with the fid gate, a filter, reports and takedowns; it is armed only by the owner and has never relayed a post (below, and {cite: SECURITY-POSTURE.md > "31. The public @anon relay (Public go-live)"}). {cite: notes/runbooks/GO-LIVE-FARCASTER.md > "(f) The anon account (optional)"} {cite: SECURITY-POSTURE.md > "14.1 Anon-post attribution (the anoncast reveal) — what a reveal costs"} {cite: SECURITY-POSTURE.md > "23. Persona-scoped anon posting (Persona launch P3): K posts per person per window, and what the slot index still says"}
:::

The verdict: the relay is careful about time and identity, and on a one-owner service it is an extra Farcaster account with no name on it, not a face in a crowd. The anonymity set of an anon cast, as the network sees it, is the set of roots posting through this validator's shared account; on the owner service that set is one. Its cover there is entirely outside the proof: how the account was created, a Neynar key separate from the app's, the hourly relay slot, and what the owner writes. A real anoncast crowd needs a multi-tenant validator with many roots behind one account. {cite: SECURITY-POSTURE.md > "Assumed, by id (the honest state; not fixed by this pass)"}

## At a glance

<ol class="flow">
  <li><strong>Compose</strong>As a persona whose posts go through @anon. Text only, up to 320 characters, no replies.</li>
  <li><strong>Prove</strong>Membership in the anon tree, in a free slot: 4 per person per 6-hour window, shared across personas.</li>
  <li><strong>Submit</strong>A 4096-byte request, 30 seconds to 15 minutes later.</li>
  <li class="flow__us"><strong>Hold</strong>The validator checks the proof, spends the nullifier and stores the text as pending.</li>
  <li class="flow__soon"><strong>Relay</strong>At the next relay slot (hourly on the owner service; every 30 minutes, spread over 30 more, on the public shape), in random order.</li>
</ol>
<p class="flow__note">The relay step has run only against fixtures. On fixture data the row is "relayed" at once with a made-up network hash.</p>

<figure class="diagram">
<svg viewBox="0 0 400 446" role="img" aria-labelledby="ar-t ar-d" xmlns="http://www.w3.org/2000/svg">
<title id="ar-t">An anon post, from compose to cast</title>
<desc id="ar-d">A vertical timeline. The persona composes and proves from the tick's snapshot. After a uniform wait of 30 seconds to 15 minutes the request reaches the validator, which verifies it, spends the nullifier and holds the post as pending. At the next hour plus 0 to 10 minutes every pending post is shuffled and cast from the anon account.</desc>
<line class="dg-line" x1="30" y1="20" x2="30" y2="86"/>
<line class="dg-line dg-line--soon" x1="30" y1="86" x2="30" y2="160"/>
<line class="dg-line" x1="30" y1="160" x2="30" y2="228"/>
<line class="dg-line dg-line--soon" x1="30" y1="228" x2="30" y2="304"/>
<line class="dg-line" x1="30" y1="304" x2="30" y2="364"/>
<circle class="dg-dot--muted" cx="30" cy="20" r="6"/>
<text class="dg-text" x="50" y="24" font-weight="600">You post as Anonymous</text>
<text class="dg-sub" x="50" y="42">text only, up to 320 characters</text>
<circle class="dg-dot--muted" cx="30" cy="86" r="6"/>
<text class="dg-text" x="50" y="90" font-weight="600">Proof from the tick's snapshot</text>
<text class="dg-sub" x="50" y="108">a free slot: 4 per person per 6 hours</text>
<text class="dg-tiny" x="50" y="132">wait: uniform, 30 s to 15 min</text>
<circle class="dg-dot--muted" cx="30" cy="160" r="6"/>
<text class="dg-text" x="50" y="164" font-weight="600">Sent to the validator</text>
<text class="dg-sub" x="50" y="182">4096 bytes, no cookie, 16-bit PoW</text>
<circle class="dg-dot" cx="30" cy="228" r="7"/>
<text class="dg-text" x="50" y="232" font-weight="600">Validator holds it</text>
<text class="dg-sub" x="50" y="250">proof checked, nullifier spent, pending</text>
<text class="dg-tiny" x="50" y="276">wait: to the next hour, plus 0 to 10 min</text>
<circle class="dg-dot--muted" cx="30" cy="304" r="6"/>
<text class="dg-text" x="50" y="308" font-weight="600">Relay slot</text>
<text class="dg-sub" x="50" y="326">every pending post, shuffled</text>
<circle class="dg-dot--muted" cx="30" cy="364" r="6"/>
<text class="dg-text" x="50" y="368" font-weight="600">Cast from the anon account</text>
<text class="dg-sub" x="50" y="386">the network sees the slot, not you</text>
<rect class="dg-box dg-box--soon" x="1" y="404" width="398" height="40" rx="8"/>
<text class="dg-sub" x="200" y="429" text-anchor="middle">live cap: 1 post, lifetime, by default · not yet run live</text>
</svg>
<figcaption>Two waits decouple the network time from your action: the client's jitter, then the validator's hourly slot.</figcaption>
</figure>

## Parameters

| Parameter | Value | Set by |
|---|---|---|
| Window | 1 epoch, 6 hours by default | `ZK_ANON_POST_WINDOW_EPOCHS` × `ZK_EPOCH_MS` |
| Slots | K per person per window, shared across that root's personas; default 4, an integer from 1 to 16, equal on both sides or posting pauses | `ZK_ANON_POST_SLOTS` (app and validator) |
| Scope | `anon-post/w<n>/s<i>` for a slot i < K: one nullifier per (person, window, slot). The bare window `w<n>` is refused on both sides; the signal carries the constant "anon" in place of a persona | `lib/zk/anon/slots.ts`, `lib/zk/scopes.ts`, `validator/zk.js` |
| Epoch | the proof must be for the current epoch; no grace | `validator/zk.js` |
| Tree | `tier-2` by default, or one reach tree (`attest:fc.reach/gte-10k`, …) the person holds and whose crowd clears `ZK_REACH_FLOOR` (50); the tree is not in the scope. The app and the validator each enforce their own copy | `ZK_ANON_POST_TREE`, `ZK_GATE_TIER`, `ZK_ANON_REACH_ISSUERS`, `ZK_REACH_FLOOR`; [Reach tiers](/mechanism/reach-tiers) |
| Ring note | exactly 256 bytes on every post, real or random; `sha256(note)` is in the proof's message | `lib/rings/note.ts`; [Rings and ring notes](/mechanism/rings) |
| Text | at most 320 characters (clamped to 1 to 1,024); top-level casts only. The relay attaches no embeds, but clients may still preview a link in the text, and Neynar turns an @mention into a public mention edge: the composer refuses a mention of your own accounts and warns about others | `ZK_ANON_POST_MAX_CHARS` |
| Relay slot | the next multiple of the interval, plus a CSPRNG jitter of 0 to min(interval / 6, 10 min); `ZK_ANON_RELAY_SPREAD_MS` smears each row over [slot, slot + spread] with a CSPRNG. Defaults by shape: on the public shape a 30-minute interval with a 30-minute spread (visible within about 75 minutes); on the rig and the owner service 1 hour with no spread (the hour of composition survives, SECURITY-POSTURE A-FID-ANON-TIMING). The environment overrides either | `ZK_ANON_RELAY_INTERVAL_MS`, `ZK_ANON_RELAY_SPREAD_MS` |
| Order | CSPRNG shuffle, one relay run at a time, every cast sent with an `idem` key from its hash and a 30-second request bound; a refused post stays pending for the next slot, at most `ZK_ANON_RELAY_MAX_ATTEMPTS` (6) slots, then `failed` and no longer counted | `validator/zk.js`, `ZK_ANON_RELAY_MAX_ATTEMPTS` |
| Live cap | 1 by default on every non-public shape, even when the variable is unset or blank; at most 100; counted over pending and relayed live rows, so it is a lifetime cap, not a daily one; a `failed` row stops counting. On the public shape it applies only when set | `ZK_ANON_POST_LIVE_CAP` |
| Daily cap | every anon post the validator accepts in a day, for everyone in a universe, pending and relayed together; default 500; counted inside the insert transaction | `ZK_ANON_POST_DAILY_CAP` |
| Cast hash | `sha256("layers-anon-cast/1|" + 128-bit nonce + "|" + text)`, so two identical texts are two posts | `validator/zk.js` |
| Stored row | mode, cast hash, text, epoch, hour-grained relay time, network hash, fid, status, attribution commitment, `tree` (the tree the post proved, migration 21), `note` (the 256-byte ring note, migration 21, filled since Persona launch P4), `tree_size` (the frozen tree's size at the post's epoch, migration 24) and `attributed_batch` (the launch batch reveal, migration 25); no persona, root, nullifier or slot index. `/zk/anon-casts` serves `tree`, `treeSize`, `note` and `attributedBatch` beside the rest | `validator/zk.js`, `validator/migrations.js` |
| Cost on Neynar | 150 credits a cast; an active signer counts as 20,000 credits a month | Neynar's price table |

The validator refuses to relay unless the anon account is named explicitly (`FC_ANON_FID`, `FC_ANON_SIGNER_UUID`), the validator is armed for real writes, the signer is approved for exactly that fid (checked against Neynar, cached 10 minutes), and no other signer credential sits in its environment. If the network reports a different author for a relayed cast, the row is marked `refused-author` and never shown as the anon account's. {cite: SECURITY-POSTURE.md > "Fixed by the pass, after the reviews (Gate 5)"} {cite: notes/runbooks/GO-LIVE-FARCASTER.md > "(a) What you get, and what it costs"}

## Posting as a persona, K slots a window

Persona launch P3, built on test data. A post is made AS one of the root's personas: the acting persona unless one is named. Each persona has a post mode, shown under the Post box as "Posts from @persona go": through @anon (the default for a persona without its own account, D2), in Totem only, or to its own account (offered only once it has one). A persona that is private, set to Totem only, or the read-only public self of a Farcaster sign-in is refused before anything is minted. The persona rides only inside the sealed reveal record on the device (`AttributionRecord.personaId` in the sealed queue), never in the envelope, the signal or the wire, so a later launch can reveal exactly one persona's posts and none of its siblings'. {cite: SECURITY-POSTURE.md > "23. Persona-scoped anon posting (Persona launch P3): K posts per person per window, and what the slot index still says"}

The budget is the person's. Each post proves under `anon-post/w<n>/s<i>`, so two posts by one person in one window carry different nullifiers and stay unlinkable to the operator, and a fifth post (at K = 4) has no free slot: the app answers "You have used all 4 anonymous posts for this 6-hour window. They are shared across your personas." The device draws the slot uniformly from its free slots, never lowest-first, because the index rides the wire and "slot 0" would otherwise mean "this person's first post". It counts every anon post it queued, whatever persona it was posted as. It never adopts the validator's K for its own choice; when the two differ, it pauses anon posting and says so. {cite: SECURITY-POSTURE.md > "23. Persona-scoped anon posting (Persona launch P3): K posts per person per window, and what the slot index still says"}

What the slot index still says, measured by `test:linkage6` check 7 (A-ANON-SLOT-INDEX-VISIBLE): one person's posts in one window never share a slot, so a pair that does share one is two people, and a pair in different slots becomes K/(K−1), about 1.33 at K = 4, times likelier to be one person than without the index. Two devices of one root keep separate queues, so they can draw the same slot; the second post is then a replay, not relayed, and the status line says the post is not confirmed and not to post the same words again, and Totem refuses those words if you try (A-ANON-SLOT-COLLISION-ACROSS-DEVICES). The daily cap is one budget for everyone, so heavy posters can use up a day for all; Sybil resistance comes from the tree, not from the cap (A-ANON-DAILY-CAP-IS-GLOBAL). {cite: SECURITY-POSTURE.md > "23. Persona-scoped anon posting (Persona launch P3): K posts per person per window, and what the slot index still says"}

## Why store-and-forward

A relay that posted at submission time would make the network's timestamp the moment of submission, which anyone watching the client's connection could join. So on live the row is written pending, together with the spent nullifier, in one transaction, and the validator posts pending rows on its own schedule. The cost is stated: a relay that fails stays pending for at most six slots and is then marked failed, and the window was consumed at acceptance either way. {cite: SECURITY-POSTURE.md > "Fixed by the pass, after the reviews (Gate 5)"}

## Who sees what

| Observer | Learns | Kept from it |
|---|---|---|
| Hubs and other clients | the anon account's casts, as that account's | which root wrote them {cite: SECURITY-POSTURE.md > "What is hidden, from whom"} |
| Neynar | everything the relay's credential does: the text, the time, the account. With the same key as the personas, it can join the anon cast to them | nothing, under managed custody {cite: SECURITY-POSTURE.md > "Assumed, by id (the honest state; not fixed by this pass)"} |
| The validator | every submitted text, relayed or refused; nullifier rows (kind, tree, epoch); the anon row | which root posted, given the eight label conditions and a crowd {cite: SECURITY-POSTURE.md > "What is hidden, from whom"} |
| The owner, on the owner service | everything; the owner is the validator and the only root | nothing |

The anon composer carries a tenth label condition: the validator's relay key must have a fingerprint distinct from the app's own Neynar key, and the anon fid must not be the app's shared test account. A distinct key narrows what one credential's logs join; Neynar the company still serves both keys. {cite: SECURITY-POSTURE.md > "Fixed by the pass, after the reviews (Gate 5)"}

## The reveal

An anon post can later be attributed to one of your personas, by your choice. At posting time the device draws a 32-byte secret, keeps it in the vault, and puts `sha256("layers-anon-attribution/1" ‖ secret)` inside the proof's message, so a relaying validator cannot swap in a commitment it can open. A reveal sends the secret with a signature over `layers-anon-reveal/1|<mode>|<castHash>|<fid>|<signerPubKey>`, made with the persona's derived `fc-signer` key (`signAsFcSignerFor` in `lib/zk/anonAttribution.ts`). The validator checks the preimage and the signature and stores the key it verified under; it does not decide whose key that is. The reader ties the key to the fid, and this build can do that only for fids its own device registered: the Farcaster KeyRegistry lookup is not built, so a reader looking at someone else's reveal sees plain "anon". There is a second gap that building the lookup would not close. Every live account records a Neynar-managed signer with `derivedRegistered: false` (`scripts/fid-acquire.mjs`), so the derived key that signs a reveal is not one of the fid's onchain keys. On today's managed-signer accounts no third party can verify a reveal, even after the KeyRegistry lookup exists; reveals become verifiable only once the derived key is added onchain, in the self-custody pass. The posture's A-FID-ATTR-SIGNER-KEY-IS-A-CASTING-KEY does not yet name this. {cite: SECURITY-POSTURE.md > "14.2 A reveal is a claim, and a claim travels with its evidence"}

What a reveal costs, from the posture: it is permanent, and public in this sense: every reader of the Totem server that holds the row sees "revealed as", while nothing is posted to Farcaster and the cast stays the anonymous account's there (on the owner service that audience is the owner); the sealed secret is a deanonymization key for that post, so a vault compromise can attribute past anon posts; the validator sees that a reveal happened, to the hour; and each reveal shrinks the remaining crowd in its window. Purging the attribution namespace restores the old, absolute property. {cite: SECURITY-POSTURE.md > "14.1 Anon-post attribution (the anoncast reveal) — what a reveal costs"}

## What wave 2 adds on top

Persona launch wave 2, built on test data and deployed on 2026-10-12, only run on test data so far. Three things ride the anon post without changing the relay:

- **A ring note.** Every post carries 256 bytes, real for the rings that see the persona's posts and random otherwise, bound into the proof. Every device reads the public anon list on every tick and trial-opens each note in memory. See [Rings and ring notes](/mechanism/rings). {cite: SECURITY-POSTURE.md > "24. Rings and ring notes (Persona launch P4): what the drop, the operator and a member learn"}
- **A reach tree.** A post may prove a reach tree instead of the plain anon tree; the validator refuses one whose frozen size is under the floor before spending a nullifier, and records the tree and its size for the For You label. See [Reach tiers](/mechanism/reach-tiers). {cite: SECURITY-POSTURE.md > "25. Reach tiers (Persona launch P5): what a boosted anon post says, and the crowd floor"}
- **A batch reveal.** `POST /zk/anon/reveal {batch: true}` reveals every anon post of one persona at once, signed by the key its launched account registered, all or nothing; it is the registrar's, and a missing registrar is a refusal, never a single-post fallback. See [Launch and the registrar](/mechanism/launch). {cite: SECURITY-POSTURE.md > "26. Launch (Persona launch P6): a persona's own account, on test data"}

## From a browser: the prover in a worker and the web channel

Persona launch P7, built on test data and not deployed yet. On the public site the visitor's tab is the device, and a tab has no sockets of its own, so two pieces replace the server-side device's forked prover and isolated socket. Everything after the door is the strict path above. {cite: SECURITY-POSTURE.md > "27. Anonymous posting from the public site (Persona launch P7): the prover in your browser, the web channel, and what the operator sees"}

<figure class="diagram">
<svg viewBox="0 0 640 210" role="img" aria-labelledby="wc-t wc-d" xmlns="http://www.w3.org/2000/svg">
<title id="wc-t">A stranger's anonymous post, from the tab to the validator</title>
<desc id="wc-d">Inside the tab, the device hands one job to a Web Worker, which returns a proof and is terminated. The device then sends one fixed-size request: directly to the validator's web route, where the operator sees the address and browser headers, or encapsulated to an OHTTP relay, which forwards ciphertext to the gateway. The validator stores a test-universe row that stays inside the preview.</desc>
<rect class="dg-box" x="10" y="20" width="250" height="170" rx="10"/>
<text class="dg-text" x="135" y="44" text-anchor="middle" font-weight="600">Your tab</text>
<rect class="dg-box dg-box--us" x="30" y="60" width="95" height="56" rx="8"/>
<text class="dg-text" x="77" y="84" text-anchor="middle">device</text>
<text class="dg-sub" x="77" y="102" text-anchor="middle">holds the seed</text>
<rect class="dg-box" x="145" y="60" width="100" height="56" rx="8"/>
<text class="dg-text" x="195" y="84" text-anchor="middle">worker</text>
<text class="dg-sub" x="195" y="102" text-anchor="middle">one job, then gone</text>
<line class="dg-line" x1="125" y1="88" x2="145" y2="88"/>
<text class="dg-tiny" x="135" y="140" text-anchor="middle">a message inside the tab, not a request</text>
<text class="dg-tiny" x="135" y="160" text-anchor="middle">4,096 bytes, no cookie, no referrer</text>
<line class="dg-line" x1="260" y1="80" x2="440" y2="80"/>
<text class="dg-sub" x="350" y="72" text-anchor="middle">direct: address + browser seen</text>
<line class="dg-line dg-line--soon" x1="260" y1="140" x2="340" y2="140"/>
<rect class="dg-box dg-box--soon" x="340" y="118" width="90" height="44" rx="8"/>
<text class="dg-sub" x="385" y="144" text-anchor="middle">OHTTP relay</text>
<line class="dg-line dg-line--soon" x1="430" y1="140" x2="460" y2="140"/>
<rect class="dg-box" x="440" y="40" width="190" height="140" rx="10"/>
<text class="dg-text" x="535" y="64" text-anchor="middle" font-weight="600">Validator</text>
<text class="dg-sub" x="535" y="90" text-anchor="middle">web route or gateway</text>
<text class="dg-sub" x="535" y="112" text-anchor="middle">the strict path behind it</text>
<text class="dg-sub" x="535" y="134" text-anchor="middle">test universe only</text>
<text class="dg-tiny" x="535" y="160" text-anchor="middle">stays inside the preview</text>
</svg>
<figcaption>The dashed path is built and not deployed anywhere: no third-party OHTTP relay exists, so today the operator sees each post's address and browser.</figcaption>
</figure>

- **The prover in a Web Worker** (`lib/zk/prover/browser-worker.ts`, built into `public/device/prover.js`). Every tab loads `prover.js` at boot (and, in the live universe, the proving files), whether or not it will prove, and starts each one-job worker from a Blob URL of those bytes, so no proof makes a request. The device hands each worker one job, the secret scalar included, as a message inside the tab; the worker answers public values only and is terminated. It never falls back to the page's own thread. For a real proof the tab hands the boot-loaded files to the worker in the job; the worker refuses any whose length, sha256 or blake2b-512 differs from the pins bundled into it, verifies every proof before handing it back, and its own fetch refuses. The padded body that leaves is an allowlist of the envelope's fields: no proving time or other timing rides it. Test proofs need no files. {cite: SECURITY-POSTURE.md > "27. Anonymous posting from the public site (Persona launch P7): the prover in your browser, the web channel, and what the operator sees"}
- **The web channel** (`lib/zk/anon/webChannel.ts`). One request per send, `credentials: "omit"`, no referrer, no cache, no redirects, no keepalive, and a single `text/plain` header, so it is a CORS simple request with no preflight; the body is exactly 4,096 bytes and the proof of work rides the query string. The validator's `POST /zk/anon/web` and `GET /zk/anon/web/head` accept the headers a browser adds by itself and refuse a cookie, an authorization, a referer or a device header; proxy hop headers pass only with `TRUST_PROXY=true`, and any other header refuses every submission, fail closed. A live envelope is refused before it is verified unless the public relay is armed, and once the site is a live product or its relay is armed a test envelope is refused there too: a test proof is a public hash, so it proves nothing about who sent it. With `ZK_RELAY=ohttp` the tab encapsulates the request itself and talks only to the relay, never falling back to direct. {cite: SECURITY-POSTURE.md > "27. Anonymous posting from the public site (Persona launch P7): the prover in your browser, the web channel, and what the operator sees"}
- **One switch** (`lib/zk/anon/availability.ts`, D-ANON-SWITCH). `ZK_ANON_POST=off` on the app turns anonymous posting off on its server and in every tab. In the browser the live universe is off and the test universe is on, preview only, whatever `ADAPTER_REP` says; a root whose commitment is not yet a leaf of the plain anon tree (`valid`, every registered browser identity, in the test universe) is joined by the composer's first read and hears when it can post ("You've joined the anonymous crowd on this preview, and you can post anonymously from &lt;time&gt;, when new members are let in…"), a crowd still under the floor of 50 says how many people it needs and has, a failed join says "This browser couldn't join the anonymous crowd on this preview just now, so it can't post anonymously yet.", and a browser no check has read yet hears "Checking whether you can post anonymously from here…" (off until the check the composer runs at once has answered). The rig and the owner service keep the old rule. Strangers prove the plain anon tree only (D-PUBLIC-ANON-TREE): no reach tier in the browser. {cite: SECURITY-POSTURE.md > "27. Anonymous posting from the public site (Persona launch P7): the prover in your browser, the web channel, and what the operator sees"}

| Observer | Under the direct relay | Under OHTTP |
|---|---|---|
| The validator's operator | the address, the browser's user-agent and client hints, the time, the 4,096-byte body and the test envelope in it | the relay's address and the strict channel's exact headers |
| The relay | not involved | the tab's address and browser headers, the time and the ciphertext's size |
| The public app server | page views only: the device answers `/api/anon` and `/api/zk` in the tab | the same |

What it costs, by id: the address and browser under direct (A-WEB-CHANNEL-DIRECT-UA); a post waiting for its proof dies with the tab, and one proved for a window that ends while the tab is closed is refused (A-WEB-TAB-CLOSED-POST-EXPIRES); a deployed build ships no proving files, so a real proof in a browser refuses (A-BROWSER-ARTIFACTS-ABSENT-ON-DEPLOY); under OHTTP only the tab's own refusal keeps live envelopes out (A-WEB-LIVE-REFUSAL-CLIENT-SIDE-UNDER-OHTTP); an unlisted edge header refuses everything (A-WEB-PROXY-HOP-HEADERS); and before a tab's first check the composer cannot judge membership, so a post from outside the crowd is refused at the tick instead (A-WEB-FIRST-TICK). {cite: SECURITY-POSTURE.md > "27. Anonymous posting from the public site (Persona launch P7): the prover in your browser, the web channel, and what the operator sees"}

How long a real proof takes in a browser, measured on a desktop and a throttled stand-in, not a phone: 1.41 seconds in the worker on a desktop; 6.6 and 10.6 seconds on a page thread slowed 4 and 6 times. {cite: SECURITY-POSTURE.md > "6. Mobile proving"} The prover file is GPL-3.0 and the public site distributes it, so the site serves its source beside it, at `/device/source/` on the app: the Totem files it was built from, exactly as built and each with its sha256, the files that control the build, the GPL-3.0 text, and links to snarkjs's and ffjavascript's tagged source. Help links it as "Source code of the browser prover (GPL-3.0)". {cite: SECURITY-POSTURE.md > "5. The GPL-3 note"}

## Copies to X

An anonymous post can also be copied to a Totem account on X, with its own claim kind (`x-anon-post`), its own slot and a moderation queue before anything posts. Built on test data on the rig, not deployed; nothing reaches X. See [The @totem X outbox](/mechanism/x-outbox). {cite: SECURITY-POSTURE.md > "28. The @layers X outbox (Persona launch P8): anonymous copies to X, moderated first, on a test transport"}

## The public @anon (go-live build)

On the public site the validator may hold exactly one write credential: the agent signer of a Neynar app that holds nothing else (`FC_ANON_FID`, `FC_ANON_SIGNER_UUID`, `FC_ANON_NEYNAR_KEY`), behind its own switch (`ZK_ANON_RELAY_LIVE=on`) and an explicit lifetime cap (`ZK_ANON_POST_LIVE_CAP`, required there). The public app refuses the agent's key and signer, so the app server stays keyless; the owner arms it with `scripts/owner/arm-public-anon.ps1`. The live crowd is one commitment per Farcaster account, joined with a verified Sign in with Farcaster (the fid gate), so a person needs a Farcaster account per member, not a browser tab; posting opens at 50 members, and a new member's first post waits for the next window. Before a verified post is stored, a filter refuses the obvious; every @anon post has a Report button; the owner's signed REMOVE hides a post in Totem and deletes it from Farcaster through the agent, keeping its record. The browser's live envelope is accepted at the web door only while this relay is ready. Two transports are built: the Neynar agent above, and the hub route below. The door for Farcaster users is [The anon page](/mechanism/anon-page). {cite: SECURITY-POSTURE.md > "31. The public @anon relay (Public go-live)"}

## The hub route (no Neynar)

Built, on test data only: no real @anon post has gone out this way yet. @anon is an ordinary Farcaster account that Totem owns on the protocol, so nothing about it depends on Neynar. The account is made once on the owner's laptop by `scripts/owner/make-anon-account.ps1`, and the public validator then posts with its own signer key.

**Making the account.** The script generates a custody key (secp256k1) and a signer key (Ed25519) and saves both in `%USERPROFILE%\.totem-anon\anon-account.json`, outside the repo, with owner-only permissions. It never prints either key; the owner copies them into a password manager. It reads the live price on OP Mainnet, `IdGateway.price()` (one fid with one storage unit, about $0.20 on 2026-11-04 at $0.20 a unit), the ETH/USD rate the StorageRegistry uses, the gas price and the L1 data fee, and shows the total in ETH and USD. It refuses a total over the cap (`-CapUsd`, $10 by default). The owner sends about 0.002 ETH from Coinbase on the Optimism network to the custody address it prints; it waits for the balance, and sends nothing until the owner types `CONFIRM`. Then, from the custody address: {cite: SECURITY-POSTURE.md > "34. The hub route for @anon (no Neynar)"}

1. `IdGateway.register(recovery)`, with the custody address as its own recovery address. The value carries a 10% margin, and the IdGateway refunds the overpayment.
2. `KeyGateway.add(1, signerKey, 1, metadata)`. The metadata is a SignedKeyRequest signed by the custody for `requestFid` = the new fid, so the account is its own app: no other fid appears as the signer's requester.
3. The fname at `https://fnames.farcaster.xyz` (`POST /transfers`, an EIP-712 UserNameProof signed by the custody). The username must be 1 to 16 of a-z, 0-9 and -, and must not contain "layers" or "totem"; neither may the display name or bio.
4. The profile as UserData messages (display, bio, picture, username) through the hub, signed by the new signer.

Every step is read back from the chain, the name server or the hub before it is done again, and each signed transaction is saved before it is broadcast. A re-run sends the same signed bytes, the same nonce, so nothing is mined twice, and the IdRegistry refuses a second fid for one custody anyway.

**Posting.** With `ZK_ANON_TRANSPORT=hub`, `FC_ANON_FID`, `FC_ANON_SIGNER_KEY` (the signer's private key, validator only; the public app refuses it at boot) and `FC_HUB_URL`, the validator builds each post as a Farcaster `CastAdd` message and each takedown as a `CastRemove` (`validator/hubmessage.js`): protobuf, BLAKE3 hash of the message data cut to 20 bytes, Ed25519 signature. It sends them to the hub's `POST /v1/submitMessage`. A Neynar key beside the hub key counts as two relay credentials, and the relay refuses to arm. Before posting, the relay checks the key is an active signer of the fid (`GET /v1/onChainSignersByFid`). A submit the hub refuses keeps the post pending, then marks it failed after six slots, exactly like a Neynar refusal. The hub's own words and the hour show in `/zk/anon/public-status` (`lastSubmitError`) and in `arm-public-anon.ps1 -Status`, never silently. A retry of the same post signs the same timestamp, so the hub sees the same message, not a second cast. This holds until a redeploy, which clears that memory. {cite: SECURITY-POSTURE.md > "34. The hub route for @anon (no Neynar)"}

**Which hub.** `FC_HUB_URL` defaults to the public Snapchain node `https://snap.farcaster.xyz:3381` in the arm script. It accepts submits: on 2026-11-04 a `CastAdd`, `CastRemove` and `UserDataAdd` built here for a real fid and signed by an unregistered key were each refused for `invalid signer`. With one byte of the hash flipped the refusal was `invalid hash`, and with one byte of the signature flipped, `invalid signature`. So the node decoded the message and checked its hash and signature before refusing the signer. A Neynar address is refused as `FC_HUB_URL`.

**Arming.** `scripts/owner/arm-public-anon.ps1 -Transport hub -AnonFid <fid> -ModeratorKey <key>` reads the signer key from the saved file (or `-SignerKeyPrompt`). `check-hub-signer.mjs`, given the key on stdin, checks that it is an active signer of exactly that fid on the hub and that the profile does not name the product. The script then sets `FC_ANON_SIGNER_KEY` on stdin, reads it back, sets `ZK_ANON_TRANSPORT=hub` and `FC_HUB_URL` on the public validator only, redeploys once, and runs the same checks as the Neynar route. `-Disarm -RevokeKey` also deletes `FC_ANON_SIGNER_KEY`. A leaked signer key is removed for good with `KeyRegistry.remove` from the custody; nothing automates that yet.

**Reading it back.** The main Farcaster app may hide a new account that has not opted in to its rules. The validator therefore reads @anon's casts from the hub, keylessly (`GET /zk/anon/network-casts`, `castsByFid`; `GET /zk/anon/network-cast?hash=`, `castById`), and leaves out every row a moderator removed. The anon page marks each post the hub confirms and adds any post the hub has that its own list lacks. A share page `/anon/p/<hash>` shows the hub's copy of a live post, and a post the hub no longer has (deleted there) is not shown. A hub that cannot be read is said in plain words, never shown as "no posts". {cite: SECURITY-POSTURE.md > "34. The hub route for @anon (no Neynar)"}

## Arming it on the owner service

The runbook's section (f) and `scripts/owner/arm-anon.ps1` set, in one run: on the validator `VALIDATOR_POLLER=off`, the THIRD Neynar app's key and the agent's signer uuid, `FC_ANON_FID`, `ENABLE_FC_WRITE=true`, `ZK_ANON_POST_TREE=valid`, `ZK_ANON_POST_LIVE_CAP=1`; on the app `ZK_MODE=live`, `ADAPTER_REP=zk` (which also makes every persona's For You tier its proven tier, else 0), `ZK_ANON_FLOOR=1` (the honest number for one owner; the floor is also every tier cohort floor) and the same tree; then the live registration, active from the next epoch. The script refuses the app's key, the read key, the throwaway, 9152 and every persona fid, and a shared onchain requester (VERIFY-YOURSELF F22). The reveal stays off and below its review bar. {cite: notes/runbooks/GO-LIVE-FARCASTER.md > "(f) The anon account (optional)"}

Why those settings, for the record: the floor defaults to 50 and the owner's live universe has one root, so proving is refused unless `ZK_ANON_FLOOR` is lowered to 1, the only setting that lets one person prove at all. It is one knob with wide reach: it is also every tier cohort floor (`lib/zk/cohort.ts`), the per-persona bucket-intersection floor (`lib/zk/prove.ts`), the attestation bucket floor in the ninth label condition (`lib/zk/privacy.ts`), and the ad market's attestation floor (`lib/zk/floor.ts`, which then falls back to the market's own k-floor of 8). With the floor at 1, condition 2 passes on the owner service, and the only condition left between it and a green label is the relay's third-party flag, which the operator sets; topology is not a computed condition, so that green would be void. The anon gate refuses unless the reputation binding is `zk`; the anon tree defaults to `tier-2`, and a root with no reputation sits in tier 1, which is why both sides are set to `valid`. The validator's reputation poller stays off (left on, it reads one real account every minute, up to about 4.4 million credits a month). The first live post is a gate-level event, with the cap at one, and it has not happened. {cite: SECURITY-POSTURE.md > "18. The owner service (PROD-LIVE): a hosted rig for one person, and what it trusts"}

## What this does not protect

- **The hub route's own residuals.** The hub operator sees each post as it arrives, from the validator's address: the same as any relay, and public a moment later anyway. The account's custody address and its funding (a Coinbase withdrawal) are onchain and tie @anon to the owner, by design: @anon is the site's account, not anyone's. The signer key sits on the validator, so whoever controls the validator can post as @anon (the same as the Neynar key before it). The custody key never leaves the owner's laptop. {cite: SECURITY-POSTURE.md > "34. The hub route for @anon (no Neynar)"}
- **Neynar.** Under managed custody it sees and could join everything. The fix is an anon account created and operated by a credential that is not the personas', and later, self-custody signers. {cite: SECURITY-POSTURE.md > "Assumed, by id (the honest state; not fixed by this pass)"}
- **The account's creation.** Which fid requested the anon account's signer, and which address registered and funded it, are onchain. The arm script decodes the requester from the hub before arming and refuses one shared with a persona's; the rest has not been read. If they match the personas', the anon account is linked onchain whatever the proof says (VERIFY-YOURSELF F21 and F22). {cite: VERIFY-YOURSELF.md > "F22 — Which fid requested the managed signer (HIGH; one decode decides it)"}
- **Timing.** The slot is the network time, but session-level correlation between a slot and the root's other activity is bounded by the interval, not removed, and the effective crowd is the devices online in that window. {cite: SECURITY-POSTURE.md > "Assumed, by id (the honest state; not fixed by this pass)"}
- **The text.** The validator reads every submission, and its relay log is its own word. Writing style is outside any proof.
- **Mistakes in the cap.** A pending row counts against the lifetime cap until it is relayed, or until the relay gives up on it after six slots and marks it failed. A request cut off after Neynar accepted it is sent again at the next slot under the same `idem` key; whether Neynar then returns the original cast rather than a duplicate is its documented behaviour, unverified until the first live relay, so the owner looks at the agent's casts after each slot.

## The obvious questions

### Is this anoncast?

It is the same pattern (a shared account, a membership proof, a relay) with less in it: one shared account per validator, text only, no replies or embeds, 4 posts per person per 6 hours, and on the owner service a lifetime cap that starts at 1. The anoncast crowd comes from many people posting through one account; here the crowd is whoever posts through this validator.

### Can the operator tell who posted?

On a multi-tenant validator with all ten label conditions met, not from the proof: it sees a valid proof from some root in the tree. On the owner service the operator is the only root. {cite: SECURITY-POSTURE.md > "What is hidden, from whom"}

### Why 4 posts per window, and why per person?

The nullifier for an anon post is scoped to the window and a slot, not to the persona, so a root has K slots a window (4 by default), whichever personas compose. That stops one root from looking like a crowd: a per-persona budget would let a person with ten personas post ten times as often. {cite: SECURITY-POSTURE.md > "23. Persona-scoped anon posting (Persona launch P3): K posts per person per window, and what the slot index still says"}

It does not stop one person with several roots: there is no proof of personhood, root creation is rate-limited per address only (A-CU-5-ANCHOR-CREATION-IS-OPEN-UNDER-THE-LIMIT), and entry to the tier-2 anon tree follows from reputation events the device posts itself (see [ZK membership](/mechanism/zk-membership#tiers)). A person with N roots can post N × K anon casts per window. On the public site the go-live build's fid gate makes the live crowd one member per Farcaster account, so there it takes N Farcaster accounts, not N browser tabs. {cite: SECURITY-POSTURE.md > "31. The public @anon relay (Public go-live)"} A longer window makes a smaller, quieter crowd.

## Where it lives in the code

- `validator/zk.js`: acceptance, the pending row, the relay loop, the signer check, the cap.
- `validator/anonpublic.js`: the public relay's account, its two transports (Neynar and the hub route) and the network reads; `validator/hubmessage.js`: the Farcaster messages built and signed by hand, and the hub's HTTP API.
- `scripts/owner/make-anon-account.ps1` (with `make-anon-account.mjs`): the @anon account made on the protocol; `scripts/owner/arm-public-anon.ps1 -Transport hub` and `check-hub-signer.mjs`: arming it.
- `lib/zk/config.ts`: the window, tree, text and slot limits on the app's side; `lib/zk/anon/slots.ts`: the slot accounting and the indexed scope; `lib/identity/postMode.ts`, `components/PostModePicker.tsx`, `app/api/personas/post-mode/route.ts`: the post mode.
- `lib/zk/anonAttribution.ts`: the commitment and the signed reveal.
- `lib/zk/privacy.ts`: the tenth label condition.
- In the browser: `lib/zk/prover/browser-worker.ts` (built into `public/device/prover.js`), `lib/zk/transport/browser.ts`, `lib/zk/anon/webChannel.ts`, `lib/zk/anon/availability.ts`; the web routes in `validator/anon.js`.
- Runbook: `notes/runbooks/GO-LIVE-FARCASTER.md`, section (f).
