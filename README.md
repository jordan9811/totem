# Totem

A Farcaster client where one person can post as several personas, and the server they use can't tell which personas belong to the same person.

Live at **[ontotem.com](https://ontotem.com)** · Docs at **[ontotem.com/docs](https://ontotem.com/docs)**

## What it does

- **Sign in with Farcaster** (Sign in with X is built and waiting on an X developer app). Your real Following, For You and notifications are read by your browser straight from a Farcaster node, with no Neynar and no Totem server in the path.
- **Post, reply, like and recast as yourself** with a signing key generated and held in your browser, approved once in the Farcaster app.
- **Personas.** Make as many as you want from one identity and switch between them. Post anonymously through one shared account; each post carries a zero-knowledge proof that "someone in the crowd" wrote it, and you choose who gets to see which persona wrote what (rings).
- **Your own algorithm.** Modes, rules, lenses and per-account delivery tiers decide what your feed shows, and you can export, share and fork them.

## How it works

- **The server is treated as hostile.** On the live site the app's API routes run inside the visitor's tab (the "browser device"). Identity, persona keys and the vault are created and held in the browser; the server stores ciphertext, public keys and commitments.
- **No server-side persona → owner link.** The validator has no table, column or index that maps a persona to its root, and a test fails if one appears.
- **Anonymous posting** uses Semaphore v4 group-membership proofs, generated in a Web Worker in the browser and verified by the validator, which relays the post through a shared Farcaster account. Submissions are OHTTP-encapsulated, ready for a third-party relay.
- **Farcaster** reads go over HTTP to a Snapchain node. Writes are Ed25519-signed in the tab and relayed byte for byte, because the node refuses browser CORS on submit.
- **Every read path is checked against personas.** The browser never asks the network about the user's own personas, and reads nothing as the user while a persona is active. [`SECURITY-POSTURE.md`](SECURITY-POSTURE.md) lists, for each feature, what each party (the server, the Farcaster node, Neynar, other users) can and can't learn, and every assumption by id.

**Stack:** Next.js 14 · React · TypeScript · Tailwind · Express + `node:sqlite` (validator) · `@noble/*` · `@hpke/core` · Semaphore v4 / snarkjs · viem (Optimism key registry) · VitePress · Playwright · Railway

## Repository

| Path | What's there |
|---|---|
| `app/`, `components/` | Next.js app (pages, API routes, UI) |
| `lib/` | Client logic: the browser device, vault, ZK prover/transport, Farcaster hub reads (`lib/fc/hubRead`), rings, ads, rules |
| `validator/` | The untrusted server: sealed storage, proof verification, the anonymous-post relay |
| `scripts/` | Unit and production-shape test suites, build, deploy and owner tooling |
| `docs/` | The documentation site (consumer, mechanism and technical tracks) |
| `research/` | ZK membership research and proofs of concept |
| `notes/` | Build-pass reports, runbooks, design drafts and agent prompts |

## Run it locally

```bash
npm install
npm run validator   # the server, port 4001
npm run dev         # the app, http://localhost:3001
```

No keys are needed: without them the app runs on fixture data. `.env.example` lists the optional ones.

## Testing

- **Unit suites per feature, with mutation checks.** Each suite also removes every guard it covers from a throwaway bundle, one at a time, and must fail each time; a check that can't fail doesn't count.
- **Production-shape suites.** `scripts/run-prod-shape.sh` runs the built app and validator with production settings against local stand-ins for the Farcaster node, Sign in with Farcaster, Neynar and X, drives them with Playwright, and checks that no request leaves the machine and no identifier reaches a server that shouldn't see it.
- **Deployed smoke test.** `npm run smoke:deployed` runs against the live site.

See [`TESTING.md`](TESTING.md) and [`ARCHITECTURE.md`](ARCHITECTURE.md).

## Status

Live and in early testing. Unlinkability isn't complete: the server's data can't link a persona to its owner, but it still sees the network address behind each request until a third-party OHTTP relay is in place. The [docs home page](https://ontotem.com/docs) lists what works today, what runs on test data only, and what's coming.

Built by Jordan Yeakley, with Claude Code doing most of the implementation under my direction and review.

## License

Copyright © 2026 Jordan Yeakley. All rights reserved. The code is published to read, not to reuse.

One exception: the five files bundled with snarkjs (GPL-3.0) into the in-browser prover are GPL-3.0. They're `lib/zk/ceremonyPins.ts`, `lib/zk/hash.ts`, `lib/zk/prover/browser-worker.ts`, `lib/zk/transport/fixtureCore.ts` and `lib/zk/transport/types.ts`, and their source is also offered at [ontotem.com/device/source](https://ontotem.com/device/source/).
