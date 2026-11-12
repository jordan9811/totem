---
title: "Attestation pass: the open issuer interface + the onchain-facts reference issuer"
pass: 14-attestation
report: notes/reports/REPORT-ATT.md
date: 2026-09-06
status: SHIPPED
---

# Attestation pass: the open issuer interface + the onchain-facts reference issuer

> Written from `notes/reports/REPORT-ATT.md`. Every claim below cites the report section it comes from.

## What shipped

- **[SHIPPED]** Gate 0: pinned, non-default ports (app 3001, validator 4001) as a single source of truth across every entry point, plus a signed liveness contract (`GET /api/health`, `GET /health`) the sweep runner verifies before ever launching a suite. {cite: notes/reports/REPORT-ATT.md > "GATE 0 — port pinning + the runner's liveness contract"}
- **[SHIPPED]** Gate 0: exit-code classification pinned in a dedicated runner-test suite, so a suite that crashes with no verdict is always INFRA, never silently ok. {cite: notes/reports/REPORT-ATT.md > "GATE 0 — port pinning + the runner's liveness contract"}
- **[SHIPPED]** Gate 0: a small-order-key signature-forgery hole was found and fixed in all three Ed25519 verifiers on the strength of the liveness contract's own test — a zero public key with a zero signature verified on roughly a quarter of messages under `node:crypto` before the fix. {cite: notes/reports/REPORT-ATT.md > "GATE 0 — port pinning + the runner's liveness contract"}
- **[SHIPPED]** Gate 1: an open issuer interface — anyone can register as an issuer under a self-signed, namespaced id; trust is entirely the subscriber's choice (`ATTEST_HONORED_ISSUERS`), not part of the protocol. {cite: notes/reports/REPORT-ATT.md > "GATE 1 — the open issuer interface"}
- **[SHIPPED]** Gate 1: attestation trees are keyed per (issuer, bucket), so the validator learns only bucket membership of a commitment, never the underlying fact — the exact value, nonce and issuer signature live only in the subject's own vault. {cite: notes/reports/REPORT-ATT.md > "GATE 1 — the open issuer interface"}
- **[SHIPPED]** Gate 2: a real reference issuer family, `onchain.*` — wallet age, ETH holdings, protocol history (Aave, Morpho, Compound, Uniswap), and governance votes — reading exact facts through a chain-facts adapter and signing only a coarse bucket, letting exact values die with the request. {cite: notes/reports/REPORT-ATT.md > "GATE 2 — the onchain-facts reference issuer"}
- **[SHIPPED]** Gate 2: wallet ownership is bound by an EIP-191-signed, one-time, ten-minute challenge; multiple wallets aggregate at the root (max age, summed holdings, union of protocols, summed votes), and the validator never sees the wallet set or its size. {cite: notes/reports/REPORT-ATT.md > "GATE 2 — the onchain-facts reference issuer"}
- **[SHIPPED]** Gate 3: an `attest.holds` rule field wired into the rules engine, mode builder, feed contexts, filter packs, and the advertiser audience matcher, evaluated only against what a persona proved this epoch — never satisfiable by holding an issuance a persona hasn't proven. {cite: notes/reports/REPORT-ATT.md > "GATE 3 — attestation-gated surfaces + the label"}
- **[SHIPPED]** Gate 3: a ninth privacy-label condition for attestation-gated surfaces, and one floor computation (the higher of the zk floor and the market's k-floor) shared by the API route, the console, and the builder. {cite: notes/reports/REPORT-ATT.md > "GATE 3 — attestation-gated surfaces + the label"}
- **[SHIPPED]** Gate 4: linkage test v3 — nine operator-side attacks across a 120-decoy cohort attesting all four claim kinds — found no successful linkage, including across nullifiers, cross-kind intersection, timing, expiry partitioning, and revocation. {cite: notes/reports/REPORT-ATT.md > "GATE 4 — linkage test v3 + the adversarial review"}
- **[SHIPPED]** A live, read-only run against the real chain (`live-att1`) verified a real wallet signature and read real facts from three chains plus Snapshot; every issuer correctly refused to vouch because the test wallet's facts didn't clear any bucket. {cite: notes/reports/REPORT-ATT.md > "GATE 4 — linkage test v3 + the adversarial review"}
- **[SHIPPED-FIXTURE]** The four closing sweeps that met the bar (427 checks, 58 suites) ran fixture transport only — no spend, no post, no deploy, no live proof. {cite: notes/reports/REPORT-ATT.md > "Series 5 — `f10278e`"}
- **[SPECCED]** A second, Farcaster-native issuer (the pass's call option) was not attempted — the closing sweeps took the remaining iteration budget instead. {cite: notes/reports/REPORT-ATT.md > "GATE 4 — linkage test v3 + the adversarial review"}

## What it found

- The pass's own live run found a real leak in its own code before any reviewer did: the issuer passed a transport error's raw text through as a refusal reason, and the underlying RPC library quoted a wallet address inside that text; fixed by redacting refusal reasons to source only. {cite: notes/reports/REPORT-ATT.md > "GATE 4 — linkage test v3 + the adversarial review"}
- A public RPC endpoint failed at the TLS layer on the test machine and a second answered `eth_getBalance` with an internal error, so the live chain-facts adapter gained a per-chain fallback list of keyless RPCs tried in order. {cite: notes/reports/REPORT-ATT.md > "GATE 4 — linkage test v3 + the adversarial review"}
- Adversarial review converged on four risks across three reports: issuer-id squatting on the open registry, an identified beacon from fetching an attest tree only when about to prove into it, cross-bucket/cross-epoch intersection unbounded by any single floor or budget, and a wallet vouching for a commitment nobody proved they hold. All four were fixed. {cite: notes/reports/REPORT-ATT.md > "GATE 4 — linkage test v3 + the adversarial review"}
- The closing sweeps, not the gates or the reviewers, found the pass's costliest remaining defects: a stale cached attestation record that `resetSeed` never dropped (rendering a seed persona as attested without consent), an anchor route that returned 400 before checking for a 409 conflict, a Windows-specific process-spawn flag needed for the restart supervisor, a double-sent envelope from an unguarded drain loop, and a batch drain that put a root's two personas back-to-back on the wire. {cite: notes/reports/REPORT-ATT.md > "Series 5 — `f10278e`"}
- The double-send defect surfaced only after fixing the reentrancy bug that caused it — a queue drain with no guard let the in-process loop and a test's explicit drain both send the same due item — and the sibling-timing defect surfaced only after fixing that one; each fix made the next, more precise defect visible. {cite: notes/reports/REPORT-ATT.md > "Series 2 — `7bec1ba` — HALTED at 1 of 4"}
- Measured, not guessed: an instrumented linkage test found that when one drain call flushed both of a root's two personas, they left 150–330 ms apart and the sibling was the nearest submission to the other's outcome in about half of trials; fixed by sending exactly one queued item per tick, chosen uniformly at random among due items. {cite: notes/reports/REPORT-ATT.md > "Series 4 — `65ea177`"}
- The sweep runner's own liveness probe had been lying in two ways before this pass — accepting any HTTP response as "alive" and treating most non-zero exit codes as "ok" — meaning earlier green sweeps in the project could have contained suites that never actually ran. {cite: notes/reports/REPORT-ATT.md > "GATE 0 — port pinning + the runner's liveness contract"}

## Judgment calls

- The bucket, not the exact fact, is what the validator ever learns — a tree is keyed per (issuer, bucket) exactly as a tier tree is keyed per tier, so bucket membership is checkable the same way tier membership is, while the exact value stays sealed in the subject's vault. {cite: notes/reports/REPORT-ATT.md > "GATE 1 — the open issuer interface"}
- Honour is pinned to a registered key, not a name (`onchain.*@<pubkey>`), after review showed an open first-come registry let anyone squat a plausible issuer id like `onchain.kyc`. {cite: notes/reports/REPORT-ATT.md > "GATE 4 — linkage test v3 + the adversarial review"}
- Issuer registration requires an issuer to sign its own registration rather than the registry guessing a key file, closing a repeated Gate 2 iteration failure (the shared `onchain.*` family key vs. a per-id key mismatch). {cite: notes/reports/REPORT-ATT.md > "GATE 2 — the onchain-facts reference issuer"}
- The app's health-contract signature is a per-process, freshly generated key used only to bind response fields to one live process, not an identity claim — publishing a persistent device key on an unauthenticated local endpoint was judged a leak for no gain. {cite: notes/reports/REPORT-ATT.md > "GATE 0 — port pinning + the runner's liveness contract"}
- A revoked issuance cannot be undone by re-posting the original issuance; only a re-issuance with a later issue epoch is honored, closing a review finding that a stale issuance could resurrect a revoked one. {cite: notes/reports/REPORT-ATT.md > "GATE 4 — linkage test v3 + the adversarial review"}

## Verification result

- Bar met on commit `f10278e`: four consecutive clean sweeps, 427/427 checks, 58/58 suites, zero infra, four times, fixture-only transport, `tsc` strict and the production build clean on the same commit. {cite: notes/reports/REPORT-ATT.md > "Series 5 — `f10278e`"}
- Getting there took five sweep series and four counter resets; every series that halted found a real defect the gates themselves had not, none of them a reviewer's finding. {cite: notes/reports/REPORT-ATT.md > "Series 5 — `f10278e`"}
- Gates 0–4 all closed green using 16 of an 18-iteration budget (2+2+4+3+5), with two additional fix iterations and one rig-only commit spent closing the sweep series. {cite: notes/reports/REPORT-ATT.md > "REPORT-ATT — Attestation pass: the open issuer interface + the onchain-facts reference issuer"}
- Restart survival ran inside every sweep — the validator killed and re-probed under its served key, with issuances, registry and honour list intact. {cite: notes/reports/REPORT-ATT.md > "/verify — the closing bar"}
- The greps that ran every iteration found zero wallet addresses or private keys in any log, report, or test output across the whole pass. {cite: notes/reports/REPORT-ATT.md > "/verify — the closing bar"}

## Assumptions and open items

- A-ATT-HEALTH-SIG: the app's liveness signature is a scheme check bound to one live process, not an identity claim. {cite: notes/reports/REPORT-ATT.md > "GATE 0 — port pinning + the runner's liveness contract"}
- A-ATT-CONTRACT-SET: the tracked onchain contract addresses per chain are a fixed list, so an untracked contract under-reports as a refusal to vouch rather than a wrong answer. {cite: notes/reports/REPORT-ATT.md > "GATE 2 — the onchain-facts reference issuer"}
- Residual assumptions from the adversarial review, each named in SECURITY-POSTURE.md §13: A-ATT-ISSUE-CELLS, A-ATT-PROFILE-PUBLIC, A-ATT-REVOCATION-PARTITION, A-ATT-OPEN-REGISTRY-COST, A-ATT-NEQ-VOUCH, A-ATT-BACKPACK-LOCAL, A-ATT-LIVE-SOURCES, A-ATT-ISSUER-RETENTION, and A-ATT-ISSUER-RETIREMENT. {cite: notes/reports/REPORT-ATT.md > "GATE 4 — linkage test v3 + the adversarial review"}
- A-ATT-NEQ-VOUCH inherits from the earlier pass's A-PERSONA-ROOT-BINDING assumption: any leaf holder can vouch any bucket onto any persona id under a `neq` predicate. {cite: notes/reports/REPORT-ATT.md > "GATE 4 — linkage test v3 + the adversarial review"}
- The Farcaster-native second issuer (the pass's call option) remains an open item, deferred because the closing sweeps consumed the remaining iteration budget. {cite: notes/reports/REPORT-ATT.md > "GATE 4 — linkage test v3 + the adversarial review"}
- `live-att1` is explicitly not part of any sweep; it is run once, read-only, and recorded without the wallet address. {cite: notes/reports/REPORT-ATT.md > "GATE 2 — the onchain-facts reference issuer"}
