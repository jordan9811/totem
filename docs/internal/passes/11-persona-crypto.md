---
title: "Persona Crypto + Custody + Vault Pass"
pass: 11-persona-crypto
report: notes/reports/REPORT-CRYPTO.md
date: 2026-08-29
status: SHIPPED
---

# Persona Crypto + Custody + Vault Pass

> Written from `notes/reports/REPORT-CRYPTO.md`. Every claim below cites the report section it comes from.

## What shipped

- **[SHIPPED]** Key hierarchy: a single 32-byte seed (the v3 root secret, kept byte-identical) derives persona Ed25519 sign keys via HKDF, an AES-256-GCM vault key, and a device-auth branch, while device keys are generated randomly per device and authorized by root-signed delegation. {cite: notes/reports/REPORT-CRYPTO.md > "GATE 0 DESIGN — the key hierarchy"}
- **[SHIPPED]** Gate 0 closed 8/8 on the first run, armed: validator migration 003 plus `/device/*` endpoints, envelope signing enforced (`LAYERS_REQUIRE_SIG=true`), and fixture roots signing seeded-world grants for real. {cite: notes/reports/REPORT-CRYPTO.md > "GATE 0 — CLOSED (2026-08-29). 8/8, first run, ARMED."}
- **[SHIPPED]** The validator's own verification uses only `node:crypto` Ed25519 (OpenSSL, RFC 8410 SPKI wrap) — zero new dependencies — and it never holds a private key. {cite: notes/reports/REPORT-CRYPTO.md > "GATE 0 — BUILT (source complete; validator chain unit-verified 7/7;"}
- **[SHIPPED]** Gate 1: real Ed25519 replaces sha256-keyed-by-public-id signatures across five signature types — grants, artifacts/filter packs, curator annotations, refutation author edges (newly signed; previously just a stored boolean), and the FC attribution index — verified at every decision gate, fail closed. {cite: notes/reports/REPORT-CRYPTO.md > "GATE 1 — BUILT (2026-08-29). Real Ed25519 at every signature site;"}
- **[SHIPPED]** Revocation of a grant re-signs it with the issuer's key rather than needing separate revocation-cert machinery, because `revokedAt` is inside the signed canonical form. {cite: notes/reports/REPORT-CRYPTO.md > "GATE 1 — BUILT (2026-08-29). Real Ed25519 at every signature site;"}
- **[SHIPPED]** Gate 2: the vault — the validator holds ciphertext only (AES-256-GCM, per-record nonce + AAD) for private posts, grants, resolution requests, forks, edge events, graph claims/consent, imports, `xImportedPrivate`, and `sessionHandles`; encrypt-at-flush/decrypt-at-hydrate with zero read-site changes. {cite: notes/reports/REPORT-CRYPTO.md > "GATE 2 — THE VAULT — BUILT (2026-08-29). accept-c2 7/7."}
- **[SHIPPED]** Gate 3: multi-device linking without copying the seed — a delegation and the vault key cross an out-of-band-secret-sealed channel; the seed and every persona signing key stay on the origin device. {cite: notes/reports/REPORT-CRYPTO.md > "GATE 3 — DEVICE LINKING — BUILT (2026-08-29). accept-c3 5/5."}
- **[SHIPPED]** Gate 4: recovery via a 24-word BIP39 mnemonic (baseline) and an encrypted passphrase escrow (scrypt + AES-256-GCM, the stronger option); the whole identity roster, not just the seed, is mirrored into the vault so recovery rebuilds every persona key bit-identically. {cite: notes/reports/REPORT-CRYPTO.md > "GATE 4 — RECOVERY — BUILT (2026-08-29). accept-c4 7/7."}
- **[SHIPPED-FIXTURE]** The noble/scure cryptography libraries (already transitive via viem) were promoted to declared, version-pinned dependencies rather than newly installed, verified working by direct probe. {cite: notes/reports/REPORT-CRYPTO.md > "Recon findings (Gate 0 groundwork)"}
- **[SPECCED]** Shamir/SLIP-39 social recovery was the spec's nominal default but was not built — no vetted implementation exists on disk — and is deliberately deferred as the next step once a library can be vetted. {cite: notes/reports/REPORT-CRYPTO.md > "GATE 4 — RECOVERY — BUILT (2026-08-29). accept-c4 7/7."}

## What it found

- Recon found the validator held the plaintext root→persona mapping, plaintext `signer_uuid` bearer credentials, private-post text, disclosure grants, and a `sessionHandles` session-deanonymization map that the existing root-leak grep MISSED. {cite: notes/reports/REPORT-CRYPTO.md > "Recon fleet results (8 agents, read-only, 0 errors — full transcripts"}
- CORS `*` and no auth on `PUT /state/:ns` meant any browser page on the machine could clobber whole namespaces before this pass. {cite: notes/reports/REPORT-CRYPTO.md > "Recon fleet results (8 agents, read-only, 0 errors — full transcripts"}
- `verifyGrant` existed in the code before this pass but had zero callers — presence in the grants map WAS validity. {cite: notes/reports/REPORT-CRYPTO.md > "Recon fleet results (8 agents, read-only, 0 errors — full transcripts"}
- The keystore's `load()` failed open: a corrupt `root.json` silently regenerated a blank root, which pre-crypto only orphaned forks but post-crypto would have destroyed every key and the vault; fixed to throw loudly, with atomic persist. {cite: notes/reports/REPORT-CRYPTO.md > "Recon fleet results (8 agents, read-only, 0 errors — full transcripts"}
- Three deliberate algorithm duplicates already existed in the test suite (`substrate.test.js` x2, `root-leak.mjs`) that could silently assert the wrong algorithm if crypto changes weren't mirrored into them. {cite: notes/reports/REPORT-CRYPTO.md > "Recon fleet results (8 agents, read-only, 0 errors — full transcripts"}
- Leak-grep gaps closed: POST response bodies had never been scanned, needles were single-encoding, and ciphertext-only validation needed a planted-canary check rather than derived needles alone. {cite: notes/reports/REPORT-CRYPTO.md > "Recon fleet results (8 agents, read-only, 0 errors — full transcripts"}
- The FC pass's own sweep run 3 died because this pass edited `sweep-x.sh` while the driver loop was executing it — logged as an ops lesson never to edit a script a live driver is executing. {cite: notes/reports/REPORT-CRYPTO.md > "GATE 0 — CLOSED (2026-08-29). 8/8, first run, ARMED."}
- The first sweep after Gate 1 failed a5/b0/b3: refutation author edges are asserted by a cast's session/account persona, which has no keystore or fixture key, so signing returned null and edges were wrongly refused. {cite: notes/reports/REPORT-CRYPTO.md > "The regression the first sweep caught (and the fix)"}
- Fix: a distinct account-key space (`lib/identity/accountKeys.ts`) resolves deterministically by persona id alone for refutation edges, while grants/attribution/annotations keep the strict keystore-or-fixture-or-null resolution. {cite: notes/reports/REPORT-CRYPTO.md > "The regression the first sweep caught (and the fix)"}
- Running Gate 4's c4 suite before others in one process broke every later suite: device-loss simulation deleted `device.json`, but the bootstrap latch still said "already enrolled," so the new device was never registered and every envelope write was refused. {cite: notes/reports/REPORT-CRYPTO.md > "A real defect the gates surfaced (device re-enrollment)"}
- Per-signature Ed25519 verification cost measured at ~1.1–1.4 ms/grant — not a feed-render concern at this scale. {cite: notes/reports/REPORT-CRYPTO.md > "/VERIFY — the crypto pass, end to end"}
- Two non-green results across all 8 four-sweep runs were legacy test-harness flakes, not product failures — both root-caused and hardened. {cite: notes/reports/REPORT-CRYPTO.md > "/VERIFY — the crypto pass, end to end"}

## Judgment calls

- The v3 root secret IS the seed — persona ids and `derivePersonaId` stay byte-identical while personas gain Ed25519 keys derived from the same seed+nonce, avoiding identity churn. {cite: notes/reports/REPORT-CRYPTO.md > "GATE 0 DESIGN — the key hierarchy"}
- Device keys are random, not seed-derived, so a device can act without the seed ever touching it; authorization runs through its own device-auth HKDF branch rather than a persona key, to avoid a linkage leak. {cite: notes/reports/REPORT-CRYPTO.md > "GATE 0 DESIGN — the key hierarchy"}
- The seeded world signs for real through deterministic fixture keys, with no unsigned/legacy tolerance path, because a tolerance path would be exactly the hole an attacker forges "legacy" objects through. {cite: notes/reports/REPORT-CRYPTO.md > "GATE 0 DESIGN — the key hierarchy"}
- Vault cipher chosen as AES-256-GCM via `node:crypto` with a per-record random 96-bit nonce and AAD binding `namespace|recordId|version`, so ciphertext cannot be replayed into a different slot. {cite: notes/reports/REPORT-CRYPTO.md > "GATE 0 DESIGN — the key hierarchy"}
- The dirty-check before flush stays on plaintext rather than ciphertext, because a fresh GCM nonce per flush makes ciphertext nondeterministic and would re-PUT every namespace on every write. {cite: notes/reports/REPORT-CRYPTO.md > "GATE 2 — THE VAULT — BUILT (2026-08-29). accept-c2 7/7."}
- `flushVault` is made loud (throws on transport/server refusal) instead of the default fail-open, swallow-all-errors behavior, because a silent vault write failure is invisible data loss. {cite: notes/reports/REPORT-CRYPTO.md > "GATE 2 — THE VAULT — BUILT (2026-08-29). accept-c2 7/7."}
- THE RECOVERY-OPTION DECISION: escrow was built instead of the spec's nominal default (Shamir M-of-N) because no vetted Shamir implementation exists on disk and hand-rolling secret sharing would violate the audited-primitives-only rule. {cite: notes/reports/REPORT-CRYPTO.md > "GATE 4 — RECOVERY — BUILT (2026-08-29). accept-c4 7/7."}

## Verification result

- Two full 42-suite, 4-sweep runs, zero product failures across all 8 runs; every crypto suite (c0–c4) green in every run; totals sweep A 300/299/300/300, sweep B 299/300/300/300. {cite: notes/reports/REPORT-CRYPTO.md > "/VERIFY — the crypto pass, end to end"}
- Gate ledger: all five gates (0 key hierarchy, 1 signatures, 2 vault, 3 device linking, 4 recovery) CLOSED; no crypto safety item is KNOWN-BROKEN. {cite: notes/reports/REPORT-CRYPTO.md > "Gate ledger"}
- Iterations used stayed well inside budget for every gate: G0 1/3, G1 ~1/4, G2 1/4, G3 1/3, G4 1/4. {cite: notes/reports/REPORT-CRYPTO.md > "Gate ledger"}

## Assumptions and open items

- Social recovery (Shamir/SLIP-39) is the documented next step, gated only on vetting an audited secret-sharing library; the recovery seam is agnostic to how the seed was reconstituted. {cite: notes/reports/REPORT-CRYPTO.md > "GATE 4 — RECOVERY — BUILT (2026-08-29). accept-c4 7/7."}
- Public-key directory trust: for the viewer's own personas the client cross-checks the validator's directory against local derivation, but for other personas it is trust-on-first-use, stated as such rather than hidden. {cite: notes/reports/REPORT-CRYPTO.md > "GATE 0 DESIGN — the key hierarchy"}
- Three persona universes exist (seed / keystore / validator-SQLite); Gate 1 signing covers seed and keystore, while validator-universe personas (AccountSwitcher furniture) are stated as out of Gate 1 scope. {cite: notes/reports/REPORT-CRYPTO.md > "Recon fleet results (8 agents, read-only, 0 errors — full transcripts"}
- Signatures ride optional headers with env-gated enforcement (`LAYERS_REQUIRE_SIG`) because API.md freezes the HTTP surface — an additive, documented contract amendment rather than a breaking change. {cite: notes/reports/REPORT-CRYPTO.md > "Recon fleet results (8 agents, read-only, 0 errors — full transcripts"}
- Threat model stated plainly: seed compromise is full impersonation with no remote kill, only the fork mechanic to limit future damage; the validator remains untrusted for confidentiality but trusted for availability; a weak escrow passphrase is an offline-guess target. {cite: notes/reports/REPORT-CRYPTO.md > "THREAT MODEL (stated plainly, per the spec)"}
- An attacker who fully controls the validator cannot read private content or forge signed objects, cannot rearrange vault records across slots, and cannot keep a revoked device working, but can still take the service down and see metadata — record counts, sizes, timing, and which namespaces change. {cite: notes/reports/REPORT-CRYPTO.md > "SECURITY POSTURE — what an attacker can and cannot do now"}
- What stands between this pass and the ZK membership layer: the grant canonical form, resolution predicate, and fork reissue are fixed and signed — already specified as a circuit would need them. {cite: notes/reports/REPORT-CRYPTO.md > "SECURITY POSTURE — what an attacker can and cannot do now"}
