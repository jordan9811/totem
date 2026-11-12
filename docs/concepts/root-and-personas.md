# Root & personas

A **root** is the identity a person holds on their device: a seed from which every key in the hierarchy is derived. A **persona** is a derived identity with its own key, name, handle, followers, feed and modes. One root derives many personas; the derivation runs on the device.

- The root never registers itself with the validator as a root that owns personas; since ZK pass 2 the validator has no persona → root table at all, and the reads that once used one are listed in the audit ledger. {cite: notes/reports/REPORT-Z2.md > "Gate 2 — migration 006: the validator stops knowing persona → root"}
- Persona keys are real Ed25519 keys, held in a device keystore; every signature site in the app signs with the persona's key, not a root key. {cite: notes/reports/REPORT-CRYPTO.md > "GATE 1 — BUILT (2026-08-29). Real Ed25519 at every signature site;"}
- The key hierarchy (root → account keys → persona keys → device keys) is described on the Technical pages. {cite: notes/reports/REPORT-CRYPTO.md > "GATE 0 DESIGN — the key hierarchy"}
- What an operator can still do with what it holds is stated, not implied: read the operator page before relying on any of the above. {cite: SECURITY-POSTURE.md > "2. What the operator can still do"}

## Personas as network accounts

A persona can hold a real Farcaster account of its own; the map from persona to FID is sealed in the vault, and the validator's plain map carries the fid and fname only. {cite: notes/reports/REPORT-FID.md > "GATE 1 — Persona ↔ FID model + signer custody"}

## Private personas

A private persona publishes only to the people it has granted; its posts are sealed at rest and are excluded from public-only flows such as relationship porting. {cite: notes/reports/REPORT-MEGA.md > "GATE 3 — Private personas as a product — **CLOSED** (3 iterations)"}
