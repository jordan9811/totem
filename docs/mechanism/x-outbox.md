# The @totem X outbox

An anonymous copy of a post to X: the same membership proof as an anonymous post, in a slot of its own, held by the validator in a moderation queue until a moderator's signed decision, then posted at a random moment in the next hourly slot through a transport that today is a test fixture.

::: warning Status: built, test data only, on the rig; nothing reaches X
<span class="st st--test">Built, test data only</span> on the laptop rig (the owner service's shape), deployed to the owner's service on 2026-10-13 and not to the public preview. No Totem account on X and no X developer billing exist (the plan's O4); the only transport writes a row. On the owner's service the toggle shows only while anonymous posting runs in the test universe, which it does not today. <span class="st st--soon">Coming soon</span> on the public preview, where it is not offered this wave (D-X-PUBLIC-OFF). {cite: SECURITY-POSTURE.md > "28. The @layers X outbox (Persona launch P8): anonymous copies to X, moderated first, on a test transport"}
:::

The verdict: the outbox never learns who wrote a copy, and nothing posts without a moderator. What it costs is stated: the moderator and the operator's database read every copy's words, rejected ones included; a copy's words pair it with its Farcaster sibling, so a launch that reveals the sibling makes the copy read as the persona's; and the X slot index rides the wire, as the anon-post slot does. {cite: SECURITY-POSTURE.md > "28. The @layers X outbox (Persona launch P8): anonymous copies to X, moderated first, on a test transport"}

## At a glance

<ol class="flow">
  <li><strong>Request</strong>Only after the anonymous post it copies was accepted. Every refusal comes before anything is minted or written.</li>
  <li><strong>Prove</strong>At the next tick: the plain anon tree, scope <code>x-anon-post/w&lt;n&gt;/s&lt;i&gt;</code>, a uniform free X slot, its own jitter.</li>
  <li class="flow__us"><strong>Queue</strong>The validator checks the proof and the text, spends the nullifier and stores the copy as <code>review</code>, in one transaction.</li>
  <li class="flow__us"><strong>Moderate</strong>A moderator's Ed25519 signature moves it to <code>approved</code> or <code>rejected</code>; no moderator, no approval.</li>
  <li class="flow__soon"><strong>Relay</strong>At the next hourly slot plus a random spread, through the test transport. A live X transport is not built.</li>
</ol>
<p class="flow__note">The copy and its Farcaster sibling are two wanted entries, two proofs and two queue items, each with its own random moment, not sent together.</p>

## Parameters

| Parameter | Value | Set by |
|---|---|---|
| Claim kind | `x-anon-post`; the signal carries the constant "anon"; the message binds `x:<xHash>` | `lib/zk/gate.ts`, `lib/zk/prove.ts`, `validator/zk.js` |
| Copy id | `xHash = sha256("layers-x-anon/1|" + nonce + "|" + text)`, not the copied post's cast hash; the payload is exactly `{text, nonce}` | `lib/x/outbox/policy.ts`, `validator/xoutbox.js` |
| Tree | the plain anon tree only: a copy is not boosted | `ZK_ANON_POST_TREE` |
| Slots | K_X per person per window, default 1, an integer from 1 to 4, equal on both sides; its own scope feature, so an X nullifier differs from every anon-post nullifier | `ZK_X_ANON_POST_SLOTS` (app and validator) |
| Text | at most 280 weighted characters (a link weighs 23); at most one link, https only; beside a link 1 to 200 of the poster's own characters; no @mention; at most two hashtags; one paragraph; no control characters; no repeat of a text from the last 7 days | `lib/x/outbox/policy.ts` and `validator/xoutbox.js` (a deliberate duplicate pair) |
| Daily cap | copies taken and posts made, each at most 50 a day | `X_OUTBOX_DAILY_CAP` |
| Moderators | public Ed25519 keys; the private half is the HKDF branch `layers/x-moderator/1` of the owner's vault key, on the owner's device | `X_OUTBOX_MODERATORS` |
| Relay | the next hourly slot, then a CSPRNG moment inside the spread (30 minutes on the public shape, 0 elsewhere), in random order | `X_OUTBOX_RELAY_INTERVAL_MS`, `X_OUTBOX_RELAY_SPREAD_MS` |
| Tables | `x_outbox`, `x_outbox_decisions`, `x_outbox_moderators`, `x_fixture_posts` (migration 26); no persona, root, nullifier, slot or device column; every time hour-grained | `validator/migrations.js` |

{cite: SECURITY-POSTURE.md > "28. The @layers X outbox (Persona launch P8): anonymous copies to X, moderated first, on a test transport"}

## Why moderation comes first

The owner's rule for a public anonymous account: X suspends a shared account that posts spam, and an anonymous outbox attracts it. So every copy arrives as `review`, and only a moderator's signed decision moves it on; the relay posts `approved` rows only. The validator stays keyless: a moderator is a PUBLIC key in its environment (or, on a rig only, one registered through a dev route), and with none configured nothing is ever approved. Every decision is kept signed, a signature is accepted once, and a posted or failed copy cannot be decided again. A rejected copy is kept and hidden: its text is never shown anywhere again. {cite: SECURITY-POSTURE.md > "28. The @layers X outbox (Persona launch P8): anonymous copies to X, moderated first, on a test transport"}

Articles go out as a quote and a link, never in full: the text policy refuses a second paragraph and keeps a post with a link to 200 of the poster's own characters. A mention is refused outright, because a mention from a shared account is the pattern X suspends for, and it would be a public edge from the anonymous account to that person. {cite: SECURITY-POSTURE.md > "28. The @layers X outbox (Persona launch P8): anonymous copies to X, moderated first, on a test transport"}

## The copy and its sibling

A copy is folded into its persona's crowd count. Its words are its Farcaster sibling's, so anyone can pair the two, and a launch that reveals the sibling makes the copy read as the persona's (A-X-COPY-LINKED-BY-WORDS). So the tick narrows the persona's device-local crowd intersection by the copy's tree, as it does for an anon post, and records it before the copy is queued; the launch preview reads that intersection. A launch never reveals a copy itself (D-X-COPY-UNATTRIBUTED): a copy carries no reveal secret, no attribution commitment and no ring note. A standalone X post, with no Farcaster sibling, is tied to nothing a launch reveals and is not folded. {cite: SECURITY-POSTURE.md > "28. The @layers X outbox (Persona launch P8): anonymous copies to X, moderated first, on a test transport"}

## Who learns what

| Party | Learns | Never learns |
|---|---|---|
| The moderator (the owner) and the operator's database | every copy's text, rejected ones included, its hour and status; the signed decisions | who wrote a copy, which persona, which anon post it copies |
| Everyone reading `GET /x/outbox` | each copy's id, status and hour; its text and post id once posted | who wrote it |
| X, once a live transport exists (not built) | the @totem account's posts | who submitted one {cite: SECURITY-POSTURE.md > "28. The @layers X outbox (Persona launch P8): anonymous copies to X, moderated first, on a test transport"} |

{cite: SECURITY-POSTURE.md > "28. The @layers X outbox (Persona launch P8): anonymous copies to X, moderated first, on a test transport"}

## Assumptions

| Id | What is assumed |
|---|---|
| A-X-COPY-LINKED-BY-WORDS | A copy has its Farcaster sibling's words, so anyone can pair them; a launch then makes the copy read as the persona's. |
| A-X-SLOT-INDEX-VISIBLE | The X slot index rides the wire; at K_X = 1 it is always 0. |
| A-X-MODERATOR-SEES-TEXT | The moderator and the operator's database hold every copy's text, rejected ones included; neither learns who wrote one. |
| A-X-FIXTURE-ROWS-ON-PUBLIC | Test proofs can be forged, so anyone can push rows into the public validator's test outbox; they stay in review forever, at most 50 a day. |

{cite: SECURITY-POSTURE.md > "28. The @layers X outbox (Persona launch P8): anonymous copies to X, moderated first, on a test transport"}

## What going live needs

A Totem account on X and X developer billing (the plan's O4: about $0.015 a post, $0.195 with a link, `lib/x/ratecard.json`), a live X transport (not built), and the owner's moderator key in `X_OUTBOX_MODERATORS` on the validator. Until then the outbox cannot reach X: its module imports no socket, http or fetch and names no X API host, and the rig suite runs the whole path under a network guard. {cite: notes/runbooks/GO-LIVE-FARCASTER.md > "(k) Persona launch, wave 3: anonymous posting from the public site, and Totem on X (test data; what going live needs)"}

## Where it lives in the code

- `validator/xoutbox.js`: the queue, the text policy's server copy, moderation, the public list and config, the relay loop and the test transport, the rig's dev routes.
- `validator/zk.js`: the `x-anon-post` claim, its scope and slots; `validator/migrations.js` migration 26.
- `lib/zk/gate.ts` (`requestXAnonPost`, `proveXAnonPost`), `lib/zk/anon/slots.ts`, `lib/zk/anon/queue.ts`: the device's half.
- `lib/x/outbox/`: the policy, the request, moderation signing and status; `app/api/x/outbox/route.ts`.
- `components/XOutboxToggle.tsx`, `components/XOutboxStatusLine.tsx`, `components/settings/XOutboxPanel.tsx`.
- The validator's routes are listed in `validator/API.md` under the X outbox.
