# TESTING.md — what this preview is, and how to test it honestly

The current URLs, the last green commit and the monthly cost are in `notes/runbooks/MORNING.md`. Everything below is true of the
preview as built; where the app and this file disagree, the app's own computed label wins and the disagreement is
the feedback we want.

## What this is

A preview of Totem on the **browser-keystore topology**: your identity — a root, the personas derived from it, the
vault key, every persona key — is minted and held **in your browser**. The servers you talk to hold ciphertext,
commitments and public keys; neither holds a root, a seed, a vault key or a persona private key, and a production
server refuses to open a keystore at all (`docs/custody-model.md`, the one rule). Two people opening the URL get two
independent identities.

It is a preview for testing, **not a launch**, and the privacy layer's conditions are not all met. Inside the app the
label reads `DEMO — not yet private` with the failing conditions listed; the banner at the top of every app page
names that state. Both are computed on your device every time, never hardcoded. Nothing here is a guarantee.

## What works

- **Identity in the tab.** A fresh visit mints an ephemeral root and personas. The strip on `/device` says
  "Unsaved — this identity lives in this tab" until you save it.
- **Saving it:** a passkey (PRF where the authenticator offers it; otherwise the wrap path, which binds the identity
  to that device), or your **24 words** (shown once, against an acknowledgement, never transmitted).
- **Personas:** fork a new persona, switch between them, post inside the preview, read the feed, keep private posts
  (vault: encrypted under your vault key; the server stores ciphertext).
- **Devices:** link a second device to an identity with a code **and a fingerprint** (both people compare it before
  approving); link two accounts (link, not merge — reputation does not combine).
- **The rest of the client** — lenses, zones, search, allowances, the reputation UBI — over the fixture corpus.
- **Anonymous posts, from the next deploy** (built on test data 2026-10-13, not deployed yet): tick **Post
  anonymously** and your tab makes the proof itself, in a background worker, and sends it over an anonymous channel.
  The post is test data: it stays inside this preview, its card says "Preview only · not on Farcaster", and nothing is
  posted to Farcaster. A new identity is first told "Anonymous posting on this preview is open only to people already in the anonymous crowd, and you can't join it from here yet."; that is the honest
  answer, not a fault. Keep the tab open until the post shows: one still waiting for its proof lives only in the tab.

## What is fixture (works, but is not the real thing)

- The **corpus** is seeded demo content; the reputation adapter is the fixture; the **zk universe is the fixture**
  (no live proving in the preview: proofs are public tags, which is one of the reasons the label reads DEMO). From the
  next deploy those test proofs are made in a background worker in your tab (`/device/prover.js`, which is GPL-3.0;
  its notice is at `/device/prover.js.LICENSE.txt`).
- **Attestations** come from fixture issuers.
- **Social login is not available** in the preview: no provider is configured, and the picker says so. Use a
  passkey or the 24 words.

## What is deliberately off

- Writes to Farcaster and X. Posts stay inside the preview, anonymous ones included. Copies to @totem on X are not
  offered here.
- Live proving, FID acquisition, anything that could spend money or reach an external API.
- Every dev route and rig hook (they answer 403 on a production build); the fixture provider; the debug accessors.

## The trust model, in plain words

- The operator can see what `SECURITY-POSTURE.md` §2 says it can see, and no more; §16 says what the browser holds
  and what the server holds after this pass. Read the posture page in the docs before assuming anything is hidden.
- Rate limits are per address and per process instance; a burst gets `429` with `Retry-After`.
- The preview may be reset or rolled back. Backups of the validator's database exist (see notes/reports/REPORT-CUSTODY.md, Gate 6),
  but treat everything you put in as disposable.

## What a tester should NOT do

- **Do not put anything real or sensitive in it** — no real names, no real posts you would not want on a public URL,
  no secrets. It is a preview with a documented, incomplete trust model.
- Do not rely on an unsaved identity: closing the tab loses it. Do not rely on a saved one beyond the preview.
- Do not try to exercise the network writes or the spend paths; they are off, and a refusal is the correct result.

## What feedback is useful

- Anywhere the label, the banner, the landing page's status paragraph and the docs disagree with what you saw.
- A save or unlock path that behaved differently from the strip's wording (passkey, 24 words, device link).
- Two browsers that could see each other's private state, or the same identity (that would be a security finding:
  report it privately).
- An anonymous post that reached Farcaster, or a card without "Preview only · not on Farcaster" on one you made (both
  would be findings).
- Anything that made the client feel like it was not X-parity fast.

## The post-deploy check

One command, against the deployed URLs (or any pair):

```bash
BASE_URL=https://<app> VALIDATOR_URL=https://<validator> node scripts/smoke-deployed.mjs
```

It asserts: the landing renders cold; the app boots the device in an empty profile and the banner names a computed
state; a persona can be created; a post round-trips; the docs door leads to the docs the app serves at /docs (DOCS
UNDER APP: always; pass NEXT_PUBLIC_DOCS_URL only if the deployment overrides /docs); both processes answer the
signed health payload; dev routes are refused; two profiles get two roots.
