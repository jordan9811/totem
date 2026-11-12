# Threat model

The adversary this design is built against is the **operator**: whoever runs the validator, reads its database and its log, and watches the wire. The operator is assumed to be honest-but-curious by default and malicious where the posture document says so.

- The topology everything rests on — what runs on the device, what runs on the validator, what an issuer is — is stated once, and every grep hangs on it. {cite: SECURITY-POSTURE.md > "8. Topology — the assumption everything rests on"}
- The conditions under which the hidden set is hidden (the proof system's assumptions, the relay, the cohort floor). {cite: SECURITY-POSTURE.md > "1. What is now mathematically hidden (given the conditions in §4)"}
- The tier-1 items of VERIFY-YOURSELF: get one of these wrong and the guarantee is silently void. {cite: research/VERIFY-YOURSELF.md > "TIER 1 — Get one of these wrong and the entire privacy guarantee is silently void"}
- Every pass since ZK pass 1 has ended with an operator-view linkage test (v1 → v5) and three adversarial reviews; the findings and what changed are recorded. {cite: SECURITY-POSTURE.md > "9. The adversarial reviews"}
