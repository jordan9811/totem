# Disclosure & grants

Disclosure is the owner telling a chosen viewer that two personas share a root. The unit is the **grant**: a signed artifact naming the two personas and the audience (one viewer, an inner circle, or everyone). The viewer verifies the signature; the validator stores the grant sealed.

- The grant is the atom of the disclosure model; resolution — "may this viewer see this linkage?" — is a check over grants, with the viewer's tier as an input. {cite: notes/reports/REPORT-MEGA.md > "2. The grant — the atom"}
- Disclosure tiers (public / inner circle / private) are the product surface over grants. {cite: notes/reports/REPORT-MEGA.md > "GATE 1 — Disclosure tiers — **CLOSED** (2 iterations, 3 donated forward)"}
- Grants are sealed in the vault namespace grantsV3; the validator holds ciphertext. {cite: notes/reports/REPORT-CRYPTO.md > "GATE 2 — THE VAULT — BUILT (2026-08-29). accept-c2 7/7."}
- A surface that cannot complete a disclosure check fails closed: it shows nothing rather than guessing. That rule is applied per surface in the reports, and the stake-history surface added in Mega pass 2 follows it. {cite: notes/reports/REPORT-MEGA2.md > "GATE 1 — Reputation UBI (the backbone; single-threaded)"}

## What "private" on the label means

The privacy label is computed at read time from what is actually bound (which adapters, which proofs, which relay); it is never a stamp a caller can set. Its exact semantics are on the privacy pages. {cite: SECURITY-POSTURE.md > '4. What "private" means on the label, exactly'}
