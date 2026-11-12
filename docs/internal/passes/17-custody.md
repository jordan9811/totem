---
title: "Browser keystore pass — the keystore moves into the visitor's browser"
pass: 17-custody
report: notes/reports/REPORT-CUSTODY.md
date: 2026-09-18
status: SHIPPED-FIXTURE
---

# Browser keystore pass — the keystore moves into the visitor's browser

::: warning STATUS: stub
This is the current pass; the page is a stub until the pass closes and the report is final. Content is deferred until the owner approves the site's structure; the page exists so the navigation is complete and the check tooling runs over it.
:::


- **[SHIPPED]** The custody model: the server never holds a root, a seed, a vault key or a persona private key — it holds ciphertext, commitments, public keys and public state. {cite: notes/reports/REPORT-CUSTODY.md > "GATE 0 — The custody model (design gate)"}
- **[SHIPPED]** The keystore in the browser: one crypto implementation for Node and the browser, a many-tenant validator whose every namespace is one opaque record, and the device bundle that answers the app's own API routes in the page. {cite: notes/reports/REPORT-CUSTODY.md > "GATE 1 — Keystore in the browser (crypto-touching; single-threaded)"}
- **[SHIPPED-FIXTURE]** Ephemeral onboarding: an identity that lives in the tab until it is saved, a passkey on the PRF path or the server-released wrap path, a provider adapter for social login, attaching a second way in, and the 24 words. {cite: notes/reports/REPORT-CUSTODY.md > "GATE 2 — Ephemeral onboarding + passkey + social login (crypto-touching; single-threaded)"}
- **[SHIPPED]** The empty-account fork, device linking that never carries the seed, and root linking as a co-signed grant — linked, not merged. {cite: notes/reports/REPORT-CUSTODY.md > "GATE 3 — The empty-account fork + device linking + root linking (crypto-touching; single-threaded)"}
- **[SHIPPED]** The production environment contract with a boot refusal on both processes, and rate limits on every route of each. {cite: notes/reports/REPORT-CUSTODY.md > "GATE 4 — Re-run the readiness audit; close findings 2–5"}
- **[SHIPPED]** Three fresh-context adversarial reviews, every finding fixed or carried as an assumption by id. {cite: notes/reports/REPORT-CUSTODY.md > "GATE 5 — Three adversarial reviews (fresh context, Opus ×2 + Sonnet ×1)"}
- **[SHIPPED]** The public preview, deployed: a landing page, the device mounted on every app page of a public deployment, a kill switch, abuse caps, scheduled backups, and a smoke suite that passes against the deployed URLs — including two browser profiles getting two independent identities. {cite: notes/reports/REPORT-CUSTODY.md > "GATE 6 — The public preview gates (notes/prompts/public-preview-prompt.md Gates 1–6, on the browser topology)"}
