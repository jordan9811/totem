# What this does NOT do

A short, cited list of things the design does not attempt, so no page implies otherwise.

- It does not hide that a persona exists, or its public posts, stakes, follows and attestations; those are public rows by design. {cite: SECURITY-POSTURE.md > "2. What the operator can still do"}
- It does not hide behavioural correlation: timing between personas of one root is a real link and the linkage tests measure it rather than suppress it. {cite: SECURITY-POSTURE.md > "15. Influence & search (Mega pass 2): what the validator learns from stakes, what stays in the vault, the search boundary"}
- It does not stop a user from disclosing themselves — grants are theirs to give, and a synchronized-like breadcrumb on X is a deliberate, deniable self-link. {cite: notes/reports/REPORT-MEGA2.md > "GATE 6 — Relationship porting on X (extends alt-linking)"}
- It does not enforce against coordinated staking; it makes stake history legible so a lens can weight against it. {cite: notes/reports/REPORT-MEGA2.md > "GATE 1 — Reputation UBI (the backbone; single-threaded)"}
- It does not run a neural model for search on-device this pass; the semantic path is a lexicon-and-hash embedding, stated as such. {cite: notes/reports/REPORT-MEGA2.md > "GATE 4 — Unified search (vault-local, keyword + AI)"}
- It does not hide a poster's internet address or browser from the validator while anonymous posts from a browser go direct; only an outside OHTTP relay would, and none exists. {cite: SECURITY-POSTURE.md > "27. Anonymous posting from the public site (Persona launch P7): the prover in your browser, the web channel, and what the operator sees"}
- It does not keep a copy to X apart from its anonymous post: the same words pair them. {cite: SECURITY-POSTURE.md > "28. The @layers X outbox (Persona launch P8): anonymous copies to X, moderated first, on a test transport"}
- It does not make any claim beyond the topology in section 8 of the posture document. {cite: SECURITY-POSTURE.md > "8. Topology — the assumption everything rests on"}
