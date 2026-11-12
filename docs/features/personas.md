---
pageClass: eli5
---

# Personas

Make as many personas as you want from one private identity, tell them apart at a glance, and keep them apart when someone can see your screen.

::: tip Status: works live
Creating, switching, tinting and compartment mode all work on the public preview, in your browser, and on the owner's private service. Cloning is built and tested, but no button in the app reaches it yet. A private persona's audience has only been tried on test data, and there is no button to grant anyone yet. Creating a persona needs the left menu, which phones do not show; on a phone you can only switch. You start with two personas: You, which is public, and You, privately. Giving a persona its own Farcaster account is a separate feature: see [Posting and Farcaster accounts](/features/network-identities).
:::

## At a glance

<ol class="flow">
  <li><strong>You</strong>Choose "Create persona" and pick a display name and a handle</li>
  <li class="flow__us"><strong>Your device</strong>Works out the persona's keys from your root</li>
  <li class="flow__us"><strong>Totem</strong>Records the persona with the server on its own, with nothing naming your root</li>
  <li><strong>You</strong>Switch personas from the account switcher; the pill and the tint show who you are</li>
</ol>
<p class="flow__note">Every persona's keys come from the same root, so your 24 words restore all of them at once.</p>

A persona is a face, not an account you sign up for. It has its own name, handle, posts, modes and colour. It is made on your device from your root, and the server is told about it as a persona on its own: the server keeps no table of which personas belong to which root. {cite: notes/reports/REPORT-Z2.md > "Gate 2 — migration 006: the validator stops knowing persona → root"}

## The parts

**Creating and switching.** The account switcher lists your personas and has **Create persona** at the bottom. The persona you act as is shown everywhere as a pill with its handle, written out in text, so colour is never the only clue. <!-- uncited-ok: a statement about the interface, not a privacy claim -->

**Cloning.** 🔵 Built and tested; no button in the app reaches it yet. A clone starts a new persona from an existing one. Its modes, rules and folders arrive as fresh copies, so editing one never changes the other. A copied mode does not switch personas automatically until you set it, because the original's settings named the original. <!-- uncited-ok: a statement about copying, not a privacy claim --> {cite: notes/reports/REPORT-POST.md > "GATE 1 — Persona cloning"}

**Tint.** Each persona can have a colour on the app's frame, set under **Manage modes & bindings** in the mode menu (the Persona & mode bindings page). The eight colours were chosen by measuring them under normal vision and three kinds of colour blindness, and a custom colour too close to one of your others is refused, with the reason. {cite: notes/reports/REPORT-POST.md > "GATE 2 — Persona tint + unified cross-persona view"}

**Compartment mode.** One tap, on the same page or on the Search page, narrows the device to the persona you are using. The account switcher, the act-as menu, search and the stakes your other personas have made all narrow where the data is fetched, not just on screen. Turning compartment mode off does not quietly turn the cross-persona view back on. {cite: SECURITY-POSTURE.md > "17. Ergonomics (Post-deploy pass): what the persona cue promises, what the cross-persona view costs, what compartment mode is and is not, what a delivery tier decides, and what readwise records about the reader"}

**Private personas.** A private persona's posts are seen only by people you grant. Everyone else gets nothing back at all, not a hidden post. Its posts are stored sealed. There is no button to grant anyone yet, so today they are seen by you alone. {cite: notes/reports/REPORT-MEGA.md > "GATE 3 — Private personas as a product — **CLOSED** (3 iterations)"}

## The obvious questions

### Can people tell my personas are the same person?

Not from anything Totem shows them. The server could still guess from your connection, and your habits can give you away. That is why the privacy label says DEMO. See [Privacy in plain words](/start/privacy-in-plain-words). {cite: SECURITY-POSTURE.md > "2. What the operator can still do"}

### Does a clone copy my follows?

No, and not by choice: on one device every persona already reads the same follow list. The clone tells you how many follows it shares rather than offering a switch that would do nothing. On Farcaster, two accounts following the same people look related. {cite: notes/reports/REPORT-POST.md > "GATE 1 — Persona cloning"}

### Can I show some people that a persona is me?

Yes, with rings: up to 16 groups of people you pick, each seeing chosen public personas, and, if you choose, which anonymous posts they wrote. Compartment mode hides every ring merge on your own screen too. Built, test data only, deployed 2026-10-12 and not yet used on a deployed site. See [Who sees what](/features/who-sees-what). {cite: SECURITY-POSTURE.md > "24. Rings and ring notes (Persona launch P4): what the drop, the operator and a member learn"}

### Can a persona get its own Farcaster account?

Two ways, both built on test data only. On the owner's private service, the owner can make one directly (off until he does). Or a persona can be launched: it gets an account made by a Totem registrar, and every anonymous post it made is revealed at once, permanently; today the registrar is simulated and creates nothing on Farcaster. See [Launching a persona](/features/launch). {cite: SECURITY-POSTURE.md > "26. Launch (Persona launch P6): a persona's own account, on test data"}

### Is there a limit?

No persona limit. The server only limits how fast one device writes (2,000 signed writes an hour by default).

### Do the colours work in greyscale?

The handle is always written in the pill, and the active mode also changes the pill's border style (solid, dashed, dotted, double), so you have two cues that do not depend on colour.

### What if the colour settings fail to load?

The frame shows no tint and the handle still shows. Losing the shortcut is fine; losing the handle would be a lie. Compartment mode works the other way: if the app cannot read it, the narrowed pages refuse to load rather than show your other personas. {cite: notes/reports/REPORT-POST.md > "GATE 2 — Persona tint + unified cross-persona view"}

## What this does not protect

- **Your follows.** One list per device, shared by every persona.
- **Your habits.** Posting at the same hours from two personas, or writing the same way, links them for anyone watching.
- **Your screen, in normal mode.** Without compartment mode, the switcher shows all your personas to anyone looking.

## Where it lives in the code

Keys and the persona list: `lib/identity/keystore.ts`. Cloning: `lib/identity/clone.ts` and `app/api/identity/fork/route.ts`. Tint and compartment mode: `lib/identity/chrome.ts` (one sealed record, `personaChrome`) and `components/settings/PersonaTintPane.tsx` at `/settings/persona-mode`. The fork wizard, `/settings/identity/fork`, is not linked from any menu yet. Private personas: `lib/private/visibility.ts`. The switcher: `components/AccountSwitcher.tsx`. For the key maths, see [One root, many personas](/mechanism/key-hierarchy).
