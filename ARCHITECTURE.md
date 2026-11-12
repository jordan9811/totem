# Layers — Architecture (v2, major pass)

Source of truth for layer boundaries. Read this before touching adapters,
seed data, the rules engine, or modes.

## Layers, outside → in

```
app/(main)/**            Next.js pages. Server components read via
                          adapters (never lib/data.ts or lib/validator.ts
                          directly for anything an adapter now covers).
components/**             Client components. Consume adapter data already
                          fetched by a page, or call /api routes.
lib/adapters/types.ts     THE CONTRACT. Every adapter interface. UI code
                          and pages depend only on these types, never on
                          a concrete implementation.
lib/adapters/registry.ts  Resolves each interface to a concrete impl based
                          on ADAPTER_<NAME> env vars. Default: mock.
lib/adapters/mock/*.ts    Mock implementations. Read from /seed/data/*.json
                          (generated, not hand-authored). Every method
                          wrapped in withMockLatency() (200-1500ms, 2%
                          synthetic failure).
lib/adapters/validator/*.ts
                          Validator-backed implementations. Thin wrappers
                          around lib/validator.ts (the existing phase-1
                          HTTP client for /validator on :4000). Only
                          PersonaAdapter and RepAdapter have one — the
                          validator doesn't know about modes, rules,
                          disclosure grants, or feed health.
lib/rules/**              The rules engine (Wave 2). One predicate
                          evaluator over (post, author, viewer, context).
                          Modes, feed filters, and channel gates all call
                          THIS — no feature is allowed to grow its own
                          bespoke filter logic.
/seed/**                  Deterministic generator (`npm run seed`).
                          Writes /seed/data/*.json. Mock adapters are pure
                          readers of that data; they never generate content
                          themselves.
/validator/**              Unchanged from phase 1. Express + SQLite. Owns
                          persona identity + reputation tiers + root-level
                          blocks. Still the only thing that computes rep.
```

## Why adapters, and why mock-first

Phase 1 (the X-parity build) proved persona/rep/block end-to-end against a
real trusted service. This major pass adds a much larger surface — modes,
rules, disclosure grants, feed health — that has NOT been designed against
a real backend yet. Building it against mocks first, behind the same kind
of typed interface the validator already models, means:

1. The UI/UX can be fully real and demoable NOW (GTM: "come play with it"),
   without the harder mechanism (real disclosure enforcement, a real rules
   evaluation service, real community-notes consensus) blocking the demo.
2. When a real backend is ready for one of these adapters, it's a registry
   swap (`ADAPTER_MODE=service` or similar), not a UI rewrite — the same
   seam pattern the validator's ZK-swap plan already established.
3. Mocks fail realistically (latency + 2% error rate) so every surface is
   forced to handle loading/error states from day one, not bolted on later.

## Registry

```
ADAPTER_PERSONA=mock|validator   (default: mock)
ADAPTER_REP=mock|validator       (default: mock)
ADAPTER_DISCLOSURE=mock          (only mock exists)
ADAPTER_MODE=mock                (only mock exists)
ADAPTER_FEED_HEALTH=mock         (only mock exists)
```

Everything defaults to **mock**, because the primary surface of this pass
is the seeded dataset and seeded personas live in `/seed/data`, not in the
validator's SQLite. Binding Persona/Rep to the validator by default would
mean the feed asking a database that has never heard of these personas —
tiers come back null, blocks silently no-op.

The validator implementations are real and are the thing the ZK swap
eventually replaces: set `ADAPTER_REP=validator` to bind them. They are
still exercised end-to-end by the phase-1 functional suite
(`npm run functional`), which drives the original `/api/personas`,
`/api/block`, and `/api/signer` routes — those call `lib/validator.ts`
directly and do not go through this registry at all.

## Seed data flow

`npm run seed` runs `/seed/generate.mjs`, a seeded-RNG deterministic
generator (mulberry32, no external RNG dependency), and writes:

```
/seed/data/accounts.json   24 accounts, 5 interest clusters, rep scores,
                            multi-persona roots
/seed/data/posts.json      ~400 posts: normal, long-form (800+ words),
                            reply chains, quote posts, story-tagged
/seed/data/notes.json      5 community notes, gate metadata (tier +
                            endorsement thresholds), 1 failing the gate
/seed/data/viewer.json     the seeded test user: follows, likes,
                            bookmarks, personas, mode state
```

Same seed (fixed) in, same output every time — `npm run seed` is
idempotent and the generator takes no wall-clock/random input (no
`Date.now()`/`Math.random()`; see mulberry32 usage).

## What this major pass does NOT change

- The validator's HTTP contract (`validator/API.md`) is untouched.
- Phase-1 visual-parity work (the X-clone shell, CastCard, LeftRail, etc.)
  is preserved and extended, not replaced. New surfaces (mode pill, tier
  badge explainer, rule builder, settings IA) must match the existing
  design tokens in `tailwind.config.ts` — no new color/spacing system.
