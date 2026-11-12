# Reputation & UBI

Reputation lives on the root; a persona proves a **tier** ("my root is at or above tier T") without the validator learning which root. Mega pass 2 adds a recurring, non-transferable **allowance** of influence per root — the reputation UBI — that a persona spends as **stakes** on content.

- Every reputation read in the app is proof-mediated under the zk binding; an unproven persona is tier 0 everywhere. {cite: notes/reports/REPORT-Z2.md > "Gate 1 — every reputation read proof-mediated under zk"}
- The allowance is derived from the proven tier, recharges per epoch, lives sealed in the vault, and has no transfer operation — asserted by grep and at the type level. {cite: notes/reports/REPORT-MEGA2.md > "GATE 1 — Reputation UBI (the backbone; single-threaded)"}
- A stake is a persona-signed public event against a cast, carrying an action (like, recast, note, refute, curate) and a direction on a spectrum (good / worth-reading / wrong / misleading / note-worthy); the validator verifies the signature and stores the row. {cite: notes/reports/REPORT-MEGA2.md > "GATE 1 — Reputation UBI (the backbone; single-threaded)"}
- Accrual (stewardship) is a pure function over public stake rows, evaluated under a lens, and lands on the root through the existing rep path — so the new tier is proven the same way as any other. {cite: notes/reports/REPORT-MEGA2.md > "GATE 1 — Reputation UBI (the backbone; single-threaded)"}
- What the validator learns from stakes and what stays in the vault is stated in the posture document. {cite: SECURITY-POSTURE.md > "15. Influence & search (Mega pass 2): what the validator learns from stakes, what stays in the vault, the search boundary"}

## The early-to-content curve

One configurable curve, not the mechanic, with a conservative default marked TUNE in the code; the owner's design intent here is unresolved and the item is on the open-issues page. {cite: notes/reports/REPORT-MEGA2.md > "GATE 1 — Reputation UBI (the backbone; single-threaded)"}
