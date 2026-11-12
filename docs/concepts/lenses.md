# Lenses

A lens is a named weighting over the same canonical feed signals — recasts, likes, stakes by direction, tier, attestations, curator subscriptions, the early curve, saturation — plus an **influence distribution**: how the reputation UBI accrues under this lens. The canonical lens is the identity weighting; any other lens is an artifact a mode pins.

- A lens is a portable, signed artifact shipped through the existing algorithm pipeline (export, import, preview, packs). {cite: notes/reports/REPORT-MEGA2.md > "GATE 2 — Lenses: the algo through different curves (single-threaded)"}
- Guardrails: importing a lens cannot override protected keys; an unknown key is stripped and reported; a guardrail hit is fatal, and a stripped lens is not signed. {cite: notes/reports/REPORT-MEGA2.md > "GATE 2 — Lenses: the algo through different curves (single-threaded)"}
- A preview shows the ranking delta AND the influence delta between the canonical lens and the candidate. {cite: notes/reports/REPORT-MEGA2.md > "GATE 2 — Lenses: the algo through different curves (single-threaded)"}
- An evaluate endpoint returns the ranking and the accrual arithmetic for any lens over any persona's public rows. {cite: notes/reports/REPORT-MEGA2.md > "GATE 2 — Lenses: the algo through different curves (single-threaded)"}
- Dwell is treated as a content property (length), never as a behaviour the server could observe. {cite: notes/reports/REPORT-MEGA2.md > "GATE 2 — Lenses: the algo through different curves (single-threaded)"}
