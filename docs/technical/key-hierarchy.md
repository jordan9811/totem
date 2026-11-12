# Key hierarchy

- The design: root seed → account key space → persona keys → device keys; what each signs; where each lives. {cite: notes/reports/REPORT-CRYPTO.md > "GATE 0 DESIGN — the key hierarchy"}
- Real Ed25519 at every signature site. {cite: notes/reports/REPORT-CRYPTO.md > "GATE 1 — BUILT (2026-08-29). Real Ed25519 at every signature site;"}
- The vault: AES-256-GCM per namespace record, key derived from the seed, ciphertext and address at rest. {cite: notes/reports/REPORT-CRYPTO.md > "GATE 2 — THE VAULT — BUILT (2026-08-29). accept-c2 7/7."}
- Device linking and recovery (seed and escrow). {cite: notes/reports/REPORT-CRYPTO.md > "GATE 3 — DEVICE LINKING — BUILT (2026-08-29). accept-c3 5/5."} {cite: notes/reports/REPORT-CRYPTO.md > "GATE 4 — RECOVERY — BUILT (2026-08-29). accept-c4 7/7."}
- What an attacker can and cannot do with the crypto layer as built. {cite: notes/reports/REPORT-CRYPTO.md > "SECURITY POSTURE — what an attacker can and cannot do now"}
