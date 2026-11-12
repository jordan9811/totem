---
pageClass: eli5
---

# What the label means

The red DEMO label is Totem checking itself. This page says what it checks, what it would claim if every check passed, and where the detailed privacy pages are.

::: danger Status: DEMO on the public preview
The label reads `DEMO — not yet private`, followed by the conditions that fail, under Settings, ZK privacy layer and in the composer; the banner at the top of each page shows only how many fail. Among those not met on the public preview: there is no outside relay for your connection, the crowd is smaller than the floor of 50, and the proofs are the test set-up rather than real ones. {cite: SECURITY-POSTURE.md > '4. What "private" means on the label, exactly'}
:::

## At a glance

<ol class="flow">
  <li><strong>A page asks</strong>Any page with a privacy claim on it</li>
  <li class="flow__us"><strong>Your device</strong>Works out eight conditions, there and then, from what is actually running</li>
  <li><strong>Any fail</strong>The label reads DEMO, in red, with a count of the failing ones; Settings, ZK privacy layer lists them</li>
  <li><strong>All pass</strong>The label shows one narrow sentence, and nothing more</li>
</ol>
<p class="flow__note">The label is computed every time. It is not a setting, and nothing outside the device can switch it to private.</p>

## The two labels

- **`DEMO — not yet private`**, then the failing conditions. This is what you see today. The label inside the app stays put; the banner at the top of each page can be hidden for one session.
- **"your persona's root is hidden from this server at the proof layer"**. Shown only when every condition holds. It is deliberately narrow: "this server" means the Totem server, and the claim is about proofs, not about everything you do.

{cite: SECURITY-POSTURE.md > '4. What "private" means on the label, exactly'}

## The eight conditions, in one line each

1. Your connection goes through a relay run by someone else, not straight to the Totem server.
2. Your group is at least as big as the floor (50 by default), and has not been reshuffled too much since you last proved into it.
3. Proofs go out at random times, and the server's time windows are long enough.
4. A self-test shows your personas' proofs do not collide.
5. The proof files match their published fingerprints.
6. A per-persona cap on proofs is in force.
7. The proofs are real, not the test set-up.
8. No fallback lets a page skip the proof.

Two more appear in special places: one on pages gated by an attestation, one on the anonymous post box. [Privacy in plain words](/start/privacy-in-plain-words) explains each condition without the jargon.

## What the label does not cover

The label talks about the Totem server. It assumes the browser holding your root is yours. On the owner's private service the server holds the owner's root, so the label has nothing to hide him from there. {cite: SECURITY-POSTURE.md > "8. Topology — the assumption everything rests on"}

It also says nothing about Farcaster or Neynar. What they see is on [What reaches Farcaster](/start/farcaster).

## The detailed pages

These are written for auditors. Each line cites the security posture document, section by section.

- [Threat model](/privacy/threat-model): who the design defends against.
- [What is hidden](/privacy/what-is-hidden): the list, with its conditions.
- [What the operator can still do](/privacy/operator): the honest half.
- [The label, exactly](/privacy/label-semantics): the label's rules.
- [Assumptions register](/privacy/assumptions): what is assumed, by name.
- [What this does not do](/privacy/not-doing): what the design does not attempt.
- [Trust assumptions](/mechanism/trust-assumptions): who must be trusted for what, in one table.
