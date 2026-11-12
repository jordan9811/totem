# Attestations

An attestation is a claim about a persona made by an **issuer** — "holds an onchain fact", "passed a check" — that the persona can later prove it holds, in a bucket, without the issuer or the validator learning which persona proved.

- The issuer interface is open: buckets are trees, issuance is issuer-signed, and the app honours issuers by key. {cite: notes/reports/REPORT-ATT.md > "GATE 1 — the open issuer interface"}
- A reference issuer over onchain facts exists. {cite: notes/reports/REPORT-ATT.md > "GATE 2 — the onchain-facts reference issuer"}
- Surfaces can be gated on an attestation, and the privacy label reflects the gate. {cite: notes/reports/REPORT-ATT.md > "GATE 3 — attestation-gated surfaces + the label"}
- What an issuer, the validator and a subscriber each learn is written down, with the assumptions. {cite: SECURITY-POSTURE.md > "13. Issuers (Attestation pass): what an issuer, the validator and a subscriber learn"}
