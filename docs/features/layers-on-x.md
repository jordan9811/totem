---
pageClass: eli5
---

# Totem on X

Send a copy of an anonymous post to a Totem account on X, with no name on it, after a moderator has read it; and save a tweet to your reading shelf by sending it to that account in a DM.

::: warning Status: built, test data only, on the test rig. Coming soon on the public preview
No Totem account on X exists yet, and nothing is posted to X: the only way out is a test transport that writes a row and calls nothing. The copy to X is built and tested on the laptop rig, which has the shape of the owner's private service, and was deployed to the owner's service on 2026-10-13. On the owner's service it shows only while anonymous posting runs on test data, which it does not today. It is not offered on the public preview. The DM inbox says what it is everywhere it appears: "DM a tweet to @totem to save it (test data: no DM is read from X yet)." Going live needs the owner's X account and X developer billing. {cite: SECURITY-POSTURE.md > "28. The @layers X outbox (Persona launch P8): anonymous copies to X, moderated first, on a test transport"} {cite: notes/runbooks/GO-LIVE-FARCASTER.md > "(k) Persona launch, wave 3: anonymous posting from the public site, and Totem on X (test data; what going live needs)"}
:::

## At a glance

<ol class="flow">
  <li><strong>Tick the box</strong>"Also post to @totem on X", under an anonymous post. It starts unticked.</li>
  <li><strong>Prove</strong>The same proof as the anonymous post, with a slot of its own: one copy per person every 6 hours.</li>
  <li class="flow__us"><strong>Wait for review</strong>The copy waits in Totem's outbox until a moderator approves it or not.</li>
  <li class="flow__us"><strong>Slot</strong>An approved copy goes out at the outbox's next hourly slot, in random order.</li>
  <li class="flow__soon"><strong>Post on X</strong>Not built: today a test transport writes a row instead.</li>
</ol>
<p class="flow__note">The picture leaves out the DM inbox, which works the other way round: a tweet you send to the account by DM would be saved to your shelf. It has only run on test data.</p>

## The obvious questions

### Does anything reach X today?

No. There is no Totem account on X yet, and the only transport is a test one that writes a row and calls nothing. The suite that checks it runs the whole path under a guard that records any network call, and checks that the outbox code has no way to make one. {cite: SECURITY-POSTURE.md > "28. The @layers X outbox (Persona launch P8): anonymous copies to X, moderated first, on a test transport"}

### Why does a moderator read every copy first?

Because X suspends a shared account that posts spam, and an anonymous outbox attracts spam. So nothing posts until a moderator, the owner, approves it with a signed decision. With no moderator set up, nothing is ever approved. A copy that is not approved is kept and hidden, never shown again, and never deleted. {cite: SECURITY-POSTURE.md > "28. The @layers X outbox (Persona launch P8): anonymous copies to X, moderated first, on a test transport"}

### Does the moderator know who wrote it?

No. The moderator reads every copy's words, rejected ones included, and so does the server's database; neither learns who wrote one, which persona, or which anonymous post it copies. That stays in a sealed record on your device. {cite: SECURITY-POSTURE.md > "28. The @layers X outbox (Persona launch P8): anonymous copies to X, moderated first, on a test transport"}

### Can a copy be tied to my anonymous post?

Yes, by its words: a copy says the same thing as its anonymous post, so anyone can pair the two. If you later launch that persona, its anonymous posts are revealed and the copy reads as yours too, so Totem counts the copy into that persona's crowd, and the box says this before you can tick it. A launch never reveals the copy itself. {cite: SECURITY-POSTURE.md > "28. The @layers X outbox (Persona launch P8): anonymous copies to X, moderated first, on a test transport"}

### What can a copy say?

What X allows a shared account to post without looking like spam: at most 280 characters (a link counts as 23), at most one link, written in full with https://, no @mentions, at most two hashtags and one paragraph. Beside a link you keep at most 200 of your own characters: an article goes to X as a short quote and its link, never in full. The same words twice in a week are refused. Totem checks this before anything is proved, and the server checks it again. {cite: SECURITY-POSTURE.md > "28. The @layers X outbox (Persona launch P8): anonymous copies to X, moderated first, on a test transport"}

### How many copies can I send?

One per person every 6 hours by default, shared across your personas, and apart from your 4 anonymous posts: a used copy never stops an anonymous post. The whole outbox takes at most 50 copies a day. {cite: SECURITY-POSTURE.md > "28. The @layers X outbox (Persona launch P8): anonymous copies to X, moderated first, on a test transport"}

### Why not on the public preview?

It is not offered there in this version: the public server has no moderator, so nothing could ever be approved there. Anyone could still push test rows into that server's outbox, since test proofs can be forged; they wait in review forever, at most 50 a day. {cite: SECURITY-POSTURE.md > "28. The @layers X outbox (Persona launch P8): anonymous copies to X, moderated first, on a test transport"}

### What is the DM inbox?

The other direction: you send a tweet to the Totem account on X in a direct message, and it lands on your reading shelf in Totem, if your X handle is linked. It is built on test data only, and Settings says so in one line: "DM a tweet to @totem to save it (test data: no DM is read from X yet)." Reading real DMs needs the X account and a read token. See [Bring your X](/features/interop).

### What would it cost?

X charges per use: about $0.015 a post, or about $0.20 with a link. That waits for the owner's yes, with the X account and its billing.

## What this does not protect

- **Your words.** A copy can be paired with its anonymous post by its text, and through a launch with your persona.
- **The moderator's reading.** Every copy's words are read and kept, rejected ones included.
- **The slot number.** It travels with each copy, as with anonymous posts; at one copy per window it is always the same.
- **Your writing style and hours**, as with every anonymous post.

{cite: SECURITY-POSTURE.md > "28. The @layers X outbox (Persona launch P8): anonymous copies to X, moderated first, on a test transport"}

## Where it lives in the code

The toggle: `components/XOutboxToggle.tsx` and `components/XOutboxStatusLine.tsx`. The request and the proof: `lib/zk/gate.ts` (`requestXAnonPost`, `proveXAnonPost`), `lib/x/outbox/request.ts`. The text rules: `lib/x/outbox/policy.ts`, mirrored in `validator/xoutbox.js`. Moderation: `lib/x/outbox/moderation.ts`, `validator/xoutbox.js`. Settings: `components/settings/XOutboxPanel.tsx`, `app/(main)/settings/x-outbox/page.tsx`. The DM inbox: `lib/x/inbox.ts`, `components/settings/DmHookPanel.tsx`. The design: [The @totem X outbox](/mechanism/x-outbox).

## The record

For auditors: each line is tagged in the internal vocabulary and cites the report it comes from.

- **[SHIPPED-FIXTURE]** The @totem X outbox (Persona launch P8): the `x-anon-post` claim with its own slot, the text policy at both ends, moderation before anything posts, the hourly relay through a test transport, Settings › Totem on X; tested on the rig, not deployed, nothing reaches X. {cite: SECURITY-POSTURE.md > "28. The @layers X outbox (Persona launch P8): anonymous copies to X, moderated first, on a test transport"}
- **[SHIPPED-FIXTURE]** The DM-to-bookmark hook, fixture only; its status now said in Settings. {cite: notes/reports/REPORT-MEGA2.md > "GATE 5 — @layers on X: the DM-to-bookmark hook"}
