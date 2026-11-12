---
pageClass: eli5
---

# Launching a persona

When a persona is ready, give it its own Farcaster account and reveal, all at once, every anonymous post it made. Permanent, and your choice.

::: warning Status: built, test data only, against a simulated registrar. Coming soon on the public preview
Launch is built and tested on test data on a laptop copy of the owner's service, and was deployed on 2026-10-12; nobody has used it on a deployed site. The part of Totem that creates the account (the registrar) is SIMULATED: the screens say "This is a simulated registrar: nothing is created on Farcaster. The account, its chain and its $0 cost are test data." Nothing is spent and nothing reaches the network. On the public preview it says "Launch isn't on this preview yet.": anonymous posts made there (built in wave 3, test data only, not deployed) stay inside the preview, and launching from there needs the Totem registrar. On the owner's service with real Farcaster switched on, it says "Launch needs the Totem registrar, which isn't set up yet." {cite: SECURITY-POSTURE.md > "26. Launch (Persona launch P6): a persona's own account, on test data"}
:::

## At a glance

<ol class="flow">
  <li><strong>You</strong>Open the persona's Launch page and read the preview: every anonymous post it will link, and what that gives away</li>
  <li><strong>You</strong>Type the persona's handle to confirm, after a line that says there is no undo</li>
  <li class="flow__us"><strong>Totem</strong>Sends the request anonymously; a Totem registrar creates the account 2 to 48 hours later, at a random time</li>
  <li class="flow__us"><strong>Totem</strong>Reveals every anonymous post the persona made, in one go, signed by the new account's own key</li>
  <li class="flow__us"><strong>Totem</strong>Posts one launch post with a proof page and up to 10 quotes, then asks where the persona's next posts go</li>
</ol>
<p class="flow__note">Built, test data only, on a simulated registrar. Inside Totem the persona's profile then shows its whole history at the original dates, marked "revealed from @anon".</p>

## The obvious questions

### What becomes public?

Every anonymous post the persona made, all at once, as that persona's, including any you post as it while the launch is under way (the Post box says so before you post). The preview lists them before you confirm, with their dates and reach tier, and says what that narrows: the reach tier those posts proved (so the account is one of that tier's accounts), your posting hours, your writing style, and the 6-hour windows you used. In those windows your other personas had fewer anonymous posts left, which hints where your other anonymous posts could be. If Totem cannot count how few accounts your posts narrow you down to, or the count is under 50, you tick a box saying you understand before you can confirm. {cite: SECURITY-POSTURE.md > "26. Launch (Persona launch P6): a persona's own account, on test data"}

### What stays hidden?

Your identity (the root), your other personas and that they share a root with this one, your main Farcaster account, the anonymous posts you made as your other personas, and your rings. The launch request goes out anonymously and names none of them. {cite: SECURITY-POSTURE.md > "26. Launch (Persona launch P6): a persona's own account, on test data"}

### Can I launch only some of the posts?

No. Launch reveals everything at once: a held-back post becomes easier to pin on you once your posting pattern is public, so there are no partial launches.

### Can I undo it?

No. Revealed posts stay revealed, and the screen says so before the box you type the handle into.

### Why does the account take 2 to 48 hours?

So the moment you pressed Launch cannot be matched to the moment the account appears. Accounts are created in batches, once a day at a random hour, and each request waits for a random batch at least 2 hours later. In a quiet week a batch can hold just your launch, which narrows its timing to that batch. {cite: SECURITY-POSTURE.md > "26. Launch (Persona launch P6): a persona's own account, on test data"}

### Who creates the account, and who owns it?

A Totem registrar creates it and pays the network fee, so the blockchain shows "made by Totem", not "made by you": paying from your own wallet would tie the persona to you for good. The account belongs to the persona's own key, which only your device holds, and its recovery key also comes from your identity, so the registrar cannot take the account over. Today the registrar is simulated. {cite: SECURITY-POSTURE.md > "26. Launch (Persona launch P6): a persona's own account, on test data"}

### How does anyone check the reveal?

The reveal is signed by the key the new account registered, so anyone can check it against the account. Inside Totem a post shows "revealed from @anon · @name" only when that check passes. Otherwise other people see plain anon, and only your own device, which made the account, can still show "revealed as @name (inside Totem only)". The proof page shows the list of posts, the key, the signature and the check. {cite: SECURITY-POSTURE.md > "26. Launch (Persona launch P6): a persona's own account, on test data"}

### Why not post the history with the old dates?

Farcaster accepts back-dated posts, but they prove nothing, they are deleted first when an account's storage fills, and they never reach followers' feeds. So the launched account posts its launch post and up to 10 quotes at the current time, and Totem shows the full history at the original dates. The anonymous originals stay on the anonymous account. {cite: research/plan-persona-launch-2026-10-10.md > "8. Verified 2026-10-10 (backdating and storage)"}

### Can the launched account quote my other personas' anonymous posts?

No. It may quote only its own revealed posts, at most 10. A sibling's anonymous post, an unrevealed one and an 11th quote are refused. {cite: SECURITY-POSTURE.md > "26. Launch (Persona launch P6): a persona's own account, on test data"}

### What happens to its posts afterwards?

You choose, and the choice is required: keep posting through @anon (preset, and a later launch batch can reveal those), or post straight to the new account, signed by its own key. Going back to anon after posting directly is weak, because your writing style is public by then, and the screen says so.

### What does it cost?

Today, nothing: the registrar is simulated. Going live needs about $0.20 of storage per account plus a few cents of network fees, paid by Totem. A price of about $5 a launch is planned for later, paid with prepaid credits that do not tie the payer to the persona.

## What this does not protect

- **Your style.** Everything the persona wrote anonymously becomes its public words, which helps match it to anonymous posts it makes later.
- **Your hours and windows.** The revealed dates show when you post, and which 6-hour windows your other personas had less room in.
- **The tier's crowd.** The revealed posts' reach tier places the account among that tier's accounts.
- **Your internet address.** The reveal goes straight to the Totem server, not through a relay, so the server sees your device's address on it.
- **A quiet week.** A batch with one launch in it narrows when you clicked.

{cite: SECURITY-POSTURE.md > "26. Launch (Persona launch P6): a persona's own account, on test data"}

## Where it lives in the code

The preview, confirm, request, reveal and history: `lib/launch/`. The registrar and the simulated chain: `validator/registrar.js`, `validator/simchain.js`. The screens: `app/(main)/launch/[personaId]`, `components/launch/`; the proof page: `app/proof/[fid]`. Writing as the launched account: `lib/fc/thinRelay.ts`. For the design, see [Launch and the registrar](/mechanism/launch).

## The record

For auditors: each line is tagged in the internal vocabulary and cites the posture section it comes from.

- **[SHIPPED-FIXTURE]** The preview (device-local, writes nothing), the typed confirm and the anonymous launch request (one per person per window, no device headers); nothing at the click. {cite: SECURITY-POSTURE.md > "26. Launch (Persona launch P6): a persona's own account, on test data"}
- **[SHIPPED-FIXTURE]** The simulated registrar: 2 to 48 hours after the click at a keyed-random batch hour, one registrar app fid, a root-derived recovery key, a $0 spend row per batch that registered an account. {cite: SECURITY-POSTURE.md > "26. Launch (Persona launch P6): a persona's own account, on test data"}
- **[SHIPPED-FIXTURE]** The all-or-nothing batch reveal, checked against the simulated key registry; a forged row renders anon. {cite: SECURITY-POSTURE.md > "26. Launch (Persona launch P6): a persona's own account, on test data"}
- **[SHIPPED-FIXTURE]** The history (one launch post, up to 10 own quotes, at the current time), the proof page, and the required post-mode choice with direct posts through the thin relay. {cite: SECURITY-POSTURE.md > "26. Launch (Persona launch P6): a persona's own account, on test data"}
- **[SPECCED]** The live registrar (the owner's O1), the live key-registry read (F25) and the add-key order on the real chain (A-LAUNCH-ADD-METADATA-ORDER). {cite: notes/runbooks/GO-LIVE-FARCASTER.md > "(j) Persona launch, wave 2: rings, reach tiers and launch (test data; what going live needs)"}
- **[IDEA]** A price per launch through blinded prepaid credits. <!-- uncited-ok: a later pass in the plan, not yet designed -->
