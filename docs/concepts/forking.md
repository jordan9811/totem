# Forking

A fork takes a persona and creates a new one that may carry some of the old persona's relationships forward — or nothing at all. The old persona keeps existing; the new one is a fresh identity the owner controls.

- Forking as a product operation: carry lists, new handle, the operations and their edge cases. {cite: notes/reports/REPORT-MEGA.md > "GATE 2 — Forking — **CLOSED** (2 iterations, 2 donated forward)"}
- Under zk, continuity between the old and the new persona is a proof (a vouch claim), not a table row; revocation happens through epoch re-issuance. {cite: notes/reports/REPORT-Z2.md > "Gate 3 — fork continuity as a proof, revocation via epoch re-issuance, attestation scaffolding"}
- A fork can mint a new network account (a new FID) and prove continuity at the next tick; the operator-view linkage test asserts that no row joins the old account to the new one. {cite: notes/reports/REPORT-FID.md > "GATE 3 — Fork → new FID, surface regression in both modes"}
