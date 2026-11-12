# Browser-Perf Realist — ZK proving in the browser, 2026 numbers

Role: establish REALISTIC in-browser and mobile-web proving times, proof
sizes, and artifact-download budgets for the ZK stacks under consideration,
and issue a hard UX verdict per stack. Research pass only; nothing here is
wired into the app.

Date of research: 2026-08-30. Every load-bearing number below is labeled
**[MEASURED]** (this pass's PoC, `research/poc/`), **[WEB-VERIFIED]**
(URL + date), or **[MEMORY]** (unverified model knowledge — treat as a flag).

---

## TL;DR — the verdicts

1. **The Semaphore-class proof (Merkle depth ~20 + Poseidon + nullifier,
   Groth16 via circom/snarkjs) is UX-viable EVERYWHERE, including as an
   interactive gate.** Measured in a real headless Chromium on this
   machine: **~200 ms warm, ~1.8 s cold including artifact download**;
   published mobile-browser numbers put even an iPhone 16 Pro at ~0.9 s and
   imply a mid-range Android at roughly 2–8 s worst case. Artifacts are
   small (3.9 MB zkey + 1.8 MB witness wasm, verified live against the PSE
   CDN). This is the anchor fact of the whole report: **the proof Layers
   actually needs for "member of root-set / not-revoked / nullifier" is
   cheap in 2026.**
2. **Signature verification inside a circuit is where UX goes to die.**
   Ed25519 in circom is ~2.56 M constraints [WEB-VERIFIED] — the Groth16
   zkey alone would be a NON-STARTER in a browser (hundreds of MB;
   flagged). The only browser-viable route for big-signature circuits is
   Noir/bb.js UltraHonk: ~2 s native / ~6–8 s browser-WASM on good
   hardware, ~6 s on a mid-range Galaxy A23, with real OOM risk on iOS
   Safari [WEB-VERIFIED, Mar 2025 — flagged as possibly improved]. That is
   a background/precompute proof, never an interactive gate.
3. **Design consequence for Layers: keep Ed25519 OUTSIDE the circuit.**
   Prove membership/attributes over *commitments to* signed data
   (Merkle/Poseidon world), don't re-verify Ed25519 in-circuit. The
   existing Ed25519 grant hierarchy stays exactly as REPORT-CRYPTO built
   it; the ZK layer should prove set-membership + nullifier statements
   about roots/grants, Semaphore-style. If some statement truly requires
   in-circuit Ed25519, it must be a precomputed session credential on
   Noir/bb.js, or it moves server-side with an explicitly stated privacy
   loss.
4. **o1js, halo2-wasm, and zkVMs are out** for this bolt-on: o1js is its
   own ecosystem (Pasta curves, ~20 s compile before any proof, proving
   not competitive for this shape); PSE halo2 entered maintenance mode
   Jan 2025 and halo2 browser proving is 10–24 s for mid circuits with
   hard memory crashes on bigger ones; zkVMs (SP1/Risc0) cannot prove in
   a browser at all (~16 GB RAM, 32-bit WASM limit) — SP1's 2026 headline
   is real-time proving on a **16× RTX-5090 cluster**, i.e., a server-side
   delegation story, not a client story.
5. **Wherever proving runs, it runs in a Web Worker, never the main
   thread; and multithreaded WASM requires COOP/COEP headers** (verified:
   bb.js falls back to single-thread without cross-origin isolation —
   3–4× slower). Cross-origin isolation is a deployment decision with
   side effects (iframes/embeds, Farcaster miniapp contexts) that must be
   made deliberately.

---

## The two circuit classes that matter for Layers

From notes/design/architecture-v3.md ("What the real track must implement") and
REPORT-MEGA §2–3, the predicates to prove are:

- **Class A — Semaphore-class membership**: "I hold a signed, unrevoked
  grant of kind K naming me" / "my persona's root is in the registered
  set, rep ≥ tier T, not revoked" — expressible as Merkle membership
  (depth ~20 covers 1M leaves) + a Poseidon hash + a nullifier.
  Thousands to low-tens-of-thousands of R1CS constraints.
- **Class B — signature-verification-in-circuit**: verifying an actual
  Ed25519 grant signature inside the circuit (or a P-256/other real-world
  signature). ~2–2.6 M constraints in circom [WEB-VERIFIED below]; large
  in every proof system.

The composition constraint from REPORT-CRYPTO matters here: the persona
hierarchy signs with **Ed25519 (curve25519)** — a SNARK-*unfriendly*
curve. Any design that forces the circuit to check those signatures
directly lands in Class B. Any design that instead commits the grant set
into a Merkle/Poseidon accumulator (server holds the accumulator,
client proves membership + non-revocation + nullifier) stays in Class A.
**The perf gap between those two designs is roughly 30×–300× and is the
difference between a shippable feature and a broken one.**

---

## MEASURED — this pass's PoC (labeled honestly)

Location: `research/poc/` (self-contained npm project; app untouched).
Machine: **Intel i7-14700F, 28 threads, 17 GB RAM, Node v24.12.0,
Windows 11** — a fast desktop, i.e., the CEILING, not the floor.

**What was actually measured:** Semaphore v4.14.3 (`@semaphore-protocol/proof`,
Groth16 over depth-20 LeanIMT, snarkjs WASM underneath), group of 513
members, full `generateProof` (witness generation + proving combined).

1. **Node WASM proxy** (`semaphore-timing.mjs` — labeled PROXY for browser
   WASM):
   - cold (incl. artifact fetch from PSE CDN): **1,679 ms**
   - warm runs: 252–356 ms, **median 264 ms**
   - verify: **8 ms**; proof (Groth16 points, JSON-encoded): **638 bytes**
2. **Real headless Chromium** (Playwright, page served over localhost
   WITHOUT COOP/COEP, i.e. `crossOriginIsolated=false` — the common
   deployment): `browser-timing.html`
   - ESM module load (esm.sh): 415 ms
   - cold incl. artifact fetch: **1,832 ms**
   - warm: **190–204 ms** (3 runs)
   - verify in-browser: 9 ms

**Artifact sizes, verified live via HTTP HEAD on the PSE CDN
(snark-artifacts.pse.dev, 2026-08-30):**

| artifact | size |
|---|---|
| `semaphore-20.zkey` (depth 20) | **3,890,175 B ≈ 3.9 MB** |
| `semaphore-20.wasm` (witness gen) | **1,847,949 B ≈ 1.8 MB** |
| `semaphore-32.zkey` (depth 32) | 5,850,470 B ≈ 5.9 MB |

So the total cold download for a Class A proof is **~5.7 MB, cacheable**
(Cache Storage/IndexedDB; the Semaphore SDK caches automatically) — a
one-time 2–10 s on a decent mobile connection, then never again until the
artifact version changes.

**Caveats stated plainly:** (a) desktop numbers; (b) Node is a proxy but
the real-Chromium run closely agreed (200 ms vs 264 ms warm), which is
the point of running both; (c) witness/prove split not separated in the
PoC — published Mopro data (below) puts Semaphore witness gen at ~75–130 ms
of the snarkjs total on phones, i.e., roughly a third to a half of total
time at this circuit size.

---

## WEB-VERIFIED benchmark landscape (what the published numbers say)

### Mobile and browser, Semaphore-class (Class A)

Mopro performance docs (zkmopro.org/docs/performance/, fetched
2026-08-30; hardware as listed by them):

- **Browser WASM, iPhone 16 Pro**: Semaphore-32 **919 ms** (snarkjs),
  652 ms (arkworks wasm) — a top phone proves Class A in-browser in
  under a second.
- **Browser WASM, Samsung S23 Ultra**: Keccak256 7.4 s (snarkjs) /
  2.7 s (arkworks) — implies Semaphore-class at roughly 1–2 s on a
  flagship Android browser.
- **Native mobile (Mopro bindings)**: Semaphore-32 witness 10–15 ms,
  RSA proof ~0.75–0.95 s (rapidsnark) — native is ~8–14× faster than
  snarkjs WASM on the same phone. This is the WASM-vs-native gap in one
  line: **rapidsnark native ≈ 8–14× snarkjs WASM; witnesscalc native ≈
  2–25× wasm witness gen** (bigger circuits gap harder).
- **Mid-range floor**: Mopro's Noir table (Pixel 6, a 2021 mid-tier SoC
  by 2026 standards) shows mobile-native 3,990 ms for Semaphore vs 828 ms
  on iOS —**a mid-range Android is consistently 3–5× a current iPhone**.
  Applying that ratio to the browser numbers puts a mid-range Android
  browser at roughly **3–8 s for a Class A snarkjs proof** — tolerable
  for a background proof, marginal-but-survivable for an interactive
  gate with honest progress UI, and the strongest argument for
  precomputation on low-end devices.

Semaphore's own benchmark page (docs.semaphore.pse.dev/benchmarks,
fetched 2026-08-30) confirms the harness (M2 Pro, Node 23, Chrome 139)
but publishes its numbers as chart images; the PoC above stands in for
extractable numbers on record.

### Signature verification in-circuit (Class B)

- **Ed25519 in circom: 2,564,061 constraints** (Electron-Labs/
  ed25519-circom README via search, 2026-08-30). [MEMORY, flagged: that
  repo has been effectively dormant for years and had a published
  exploit gist; do NOT treat it as an audited dependency.]
- **Base's passkey benchmark** (blog.base.dev/benchmarking-zkp-systems,
  post dated 2025-09-02, fetched 2026-08-30), P-256 ECDSA ≈ 2 M
  constraints: **Noir UltraHonk ~2.1 s on 8 vCPU / ~0.6 s on 32 vCPU
  native; Groth16 (snarkjs/rapidsnark/gnark) 15–50 s** on the same
  hardware. Browser: snarkjs yes-but-unusably-slow at this size; Noir
  WASM works but is **"3.5–4× slower than native"** (their words) →
  ~7–8 s browser on an 8-core. Gas: Groth16 ~348 k vs UltraHonk ~2.4 M
  (+590%) — irrelevant to Layers today (no on-chain verifier), decisive
  if verification ever moves on-chain.
- **Hyli's in-browser P-256 benchmark** (hyli.ghost.io, post dated
  2025-03-20, fetched 2026-08-30): Noir **UltraHonk 2.06 s on M1 Mac
  (multithreaded WASM), ~6 s on a mid-range Samsung Galaxy A23,
  out-of-memory on iPhone 16/Pro**; UltraPlonk 8–33 s; circom "exceeded
  one million constraints, exceeding browser capacity"; halo2/Cairo/
  zkVMs failed to run at all in-browser (zkVMs need ~16 GB and break the
  32-bit WASM address space). This is the single most on-point published
  experiment for the Class B browser question, with two caveats: it is
  ~17 months old, and bb.js has had heavy optimization since (26%
  UltraHonk memory reduction, configurable SRS — release notes via
  search 2026-08-30). The iOS OOM may be fixed; MUST be re-tested
  (flagged).

### Stack maintenance status (npm registry, queried live 2026-08-30)

| package | latest | published | verdict |
|---|---|---|---|
| `snarkjs` | 0.7.6 | 2026-01-12 | alive, slow cadence (prev release 2024-10) — mature/stable, not fast-moving |
| `@aztec/bb.js` | 5.2.0 (nightlies daily, 6.0.0-nightly current) | 2026-08-17 | very active |
| `@noir-lang/noir_js` | 1.0.0-beta.26 | 2026-07-30 | active; Noir 1.0 pre-release announced, stable 1.0 + compiler audits in progress (aztec.network blog, fetched 2026-08-30) — **not yet a shipped audited 1.0** |
| `o1js` | 3.0.0 | 2026-08-18 | active, but its own ecosystem |
| `@semaphore-protocol/proof` | 4.14.3 | 2026-07-08 | active (PSE) |
| `circomlib` | 2.0.5 | 2022-06-17 | **stale npm package** — the circuits are ceremony-frozen and battle-tested, but this is the "audited-but-unmaintained" trade stated honestly |
| PSE `halo2` | — | maintenance mode since Jan 2025 (search-verified) | avoid for new work |

---

## THE TABLE — stack × proof class, 2026 browser reality

Hardware tiers: **Desktop** = M-series/recent i7 in Chrome;
**High phone** = iPhone 16 Pro / S23U browser; **Mid phone** = Pixel 6 /
Galaxy A23-class browser (the floor Layers must design for).

| Stack | Class A: Merkle-20+nullifier (~5–15k constraints) | Class B: sig-verify (~2M constraints) | Proof size | Cold artifact download | Confidence |
|---|---|---|---|---|---|
| **circom + snarkjs Groth16 (WASM)** | Desktop **0.2 s** [MEASURED]; high phone **0.9–2 s** [WEB-VERIFIED]; mid phone **~3–8 s** [extrapolated, flagged] | **Unusable**: 15–50 s native on servers, browser worse; zkey likely hundreds of MB [flagged] | ~128–256 B (638 B JSON) [MEASURED] | **5.7 MB** (3.9 zkey + 1.8 wasm) [VERIFIED live] | High for Class A |
| **Noir + bb.js UltraHonk (WASM)** | Desktop ~1–5 s [WEB-VERIFIED: Mopro Noir-Semaphore web 4.6 s, older toolchain; likely better now]; phones 4–10 s [flagged] | Desktop-browser **~2–8 s** (2.06 s M1 multithread); mid Android **~6 s**; **iOS OOM risk** [WEB-VERIFIED, Mar 2025, stale — retest] | **~10s of KB** [MEMORY, flagged] | wasm bundle + SRS slice; order **5–70 MB** depending on circuit size, hardcoded wasm SRS now 2^20 [partially verified; exact bytes flagged] | Medium |
| **o1js (Kimchi/Pickles)** | ~20 s compile before first proof (verified: o1labs key-caching post, 20 s→3 s cached); per-proof time **tens of seconds** [MEMORY, flagged] | worse | ~KB-scale recursion-friendly [MEMORY] | large TS+wasm bundle [MEMORY] | Low — and moot: wrong curves (Pasta), wrong ecosystem for an Ed25519/Farcaster bolt-on |
| **halo2-wasm (PSE/Axiom)** | plausible but unbenchmarked publicly at this size | Keccak-class already **10–24 s** on phones native; RSA-class **crashes** (~5 GB need vs ~3 GB mobile cap) [WEB-VERIFIED via Mopro] | ~KB | KB params + wasm, but | Low — PSE halo2 in maintenance mode since 2025-01; ecosystem momentum left |
| **zkVM (SP1) — contrast point** | **No browser proving exists.** ~16 GB RAM, breaks 32-bit WASM [WEB-VERIFIED, Hyli]. SP1 Hypercube's 2026 achievement is proving Ethereum blocks in <12 s on **16× RTX 5090 (~$100k cluster)** [WEB-VERIFIED, Succinct blog] | same | ~100s of KB–MB pre-wrap [MEMORY] | n/a client-side | High that it's server-only |

---

## Hard verdicts

### (a) Interactive gate (e.g., proving at post time)

**Viable: circom/snarkjs Groth16 Semaphore-class ONLY.** 0.2 s desktop /
~1 s flagship phone / ~3–8 s mid phone. On the mid-phone floor even this
needs either (i) an honest sub-second *perceived* latency via
optimistic-post-then-attach-proof, or (ii) precomputation (below). No
other stack makes the interactive cut in a browser in 2026. Anything
Class B as an interactive gate is **rejected outright**.

Note the asymmetry with the existing system: REPORT-CRYPTO measured plain
Ed25519 grant verification at ~1.34 ms. ZK-gating an interactive action
is 150×–5000× that. The UX bar is only clearable because Class A proofs
are amortizable and precomputable.

### (b) Background / precomputable proof (session credential)

**Viable: Groth16 Semaphore-class (easily) and Noir/bb.js UltraHonk
(acceptably).** A session credential — "this browser session belongs to a
root with rep ≥ T, not revoked, nullifier N" — proved once at session
start or at idle, cached, attached to subsequent actions, re-proved on
epoch change, absorbs even the mid-phone 8 s worst case invisibly. This
is the architecturally correct home for ZK in Layers regardless of stack.

### (c) Where proving must move

1. **Web Worker, always.** 0.2–8 s of WASM on the main thread is a frozen
   UI and a killed tab on mobile. Non-negotiable.
2. **COOP/COEP (cross-origin isolation) decision up front** if bb.js is
   in the picture: without those headers it silently runs single-threaded
   at 3–4× the time [WEB-VERIFIED via bb.js docs/search]. Cross-origin
   isolation constrains third-party embeds and iframe contexts — check
   against the Farcaster miniapp/embedding roadmap before committing.
   snarkjs Class A is fast enough either way (the measured 200 ms run was
   NOT cross-origin isolated).
3. **Precompute at idle + cache artifacts.** Artifacts (5.7 MB) fetched
   once post-onboarding, stored in Cache Storage; proofs for predictable
   predicates (session credential, tier proof) computed at idle;
   epoch-based nullifiers so precomputed proofs stay fresh.
4. **Delegate-to-server = privacy loss, named as such.** Sending the
   witness (root secret, grant set, Merkle path) to a proving service
   hands the delegate exactly the linkage the ZK layer exists to hide —
   it recreates today's trusted validator with extra steps. Only
   acceptable inside a TEE with attestation, and that changes the trust
   model from "mathematically unknowable" to "trust the enclave vendor."
   If ever offered, it must be an explicit user opt-in labeled as a
   downgrade, never a silent fallback on slow devices. (SP1-style
   cluster proving lives here: it is how you'd prove BIG statements, at
   the cost of the property.)

### Fit with the hard constraints

- **Compose with Ed25519 hierarchy**: Class A design keeps the hierarchy
  untouched; circuits operate on Poseidon commitments/accumulators
  maintained alongside. No key migration.
- **Adapter seam**: proof generation is client-side and the validator's
  interface gains "verify proof" next to "verify signature" — a swap at
  the decision gates, matching the seam.
- **Unopinionated rails / audited primitives**: Semaphore v4 is the
  Morpho-not-Aave of this space — a minimal, audited (PSE ecosystem),
  actively maintained membership+nullifier primitive whose exact shape is
  Layers' Class A predicate. Its trusted-setup ceremony artifacts are
  public. A custom circuit variant (e.g., adding a rep-tier leaf) is a
  NEW circuit needing its own ceremony + audit — that is the flagged
  human-verification cost of any deviation from stock Semaphore.

---

## FLAGS — over-flagged on purpose

| # | Claim | Why it matters | How to verify | Confidence |
|---|---|---|---|---|
| 1 | Mid-range Android browser proves Class A in ~3–8 s (extrapolated from flagship measurements × Pixel-6 ratios, not measured) | It's the UX floor; if it's 15 s the interactive-gate verdict flips to precompute-only | Run `research/poc/browser-timing.html` on a real Pixel 6 / Galaxy A2x over the LAN (serve with `node research/poc/serve.mjs 8792`, open from the phone) | Medium |
| 2 | Groth16 zkey for a 2M-constraint circuit is hundreds of MB to >1GB (disqualifying) | Kills any "just verify Ed25519 in circom" plan on download size alone, independent of proving time | Check ed25519-circom's published zkey or `snarkjs zkey new` on any ~2M circuit; compare anon-aadhaar artifacts | Medium (scaling extrapolated from 3.9 MB @ Semaphore-20; direction certain, magnitude unverified) |
| 3 | bb.js iOS Safari OOM (Hyli, Mar 2025) may or may not be fixed by bb.js 5.x/6.x memory work | iOS is half the mobile audience; an OOM is a hard feature failure | Re-run Hyli's harness or a Noir Semaphore circuit via bb.js on a real iPhone; check aztec-packages release notes for wasm memory ceilings | Low (that it's still broken) — but HIGH that it must be tested before committing to bb.js |
| 4 | UltraHonk proof size ~10s of KB | Matters only for payload/storage design, not viability | Generate one proof with `bb prove` and stat the file | Medium [MEMORY] |
| 5 | bb.js browser SRS/CRS download size (order 5–70 MB; hardcoded wasm SRS bumped 2^19→2^20 per release notes) | A 50+ MB first-load on mobile is a UX fact that rivals proving time | Instrument network tab on first bb.js proof; read barretenberg ts `net_crs` source | Low on exact bytes |
| 6 | o1js proving = tens of seconds for app-scale circuits in browser | Only load-bearing if someone proposes o1js; verdict already "wrong ecosystem" on composability grounds | Time a minimal o1js ZkProgram prove() in Chrome | Low [MEMORY] |
| 7 | snarkjs 0.7.6 (Jan 2026) is "maintained enough": iden3 cadence is ~1 release/year and Semaphore v4 pins it | Supply-chain/security posture of the recommended stack; Groth16+circom also inherits the frozen circomlib (2022) and the per-circuit trusted-setup ceremony obligation | Watch iden3/snarkjs + privacy-ethereum/snark-artifacts activity; confirm Semaphore v4's audit reports on pse.dev before shipping | Medium |
| 8 | Semaphore v4's circuits/ceremony are audited to the standard Layers needs | The whole "audited, standard primitives" constraint hangs on it | Pull the actual audit reports (PSE publishes them; e.g. semaphore.pse.dev / audits repo) and read scope — v4 circuits, LeanIMT, and the setup ceremony transcript | Medium — audit EXISTENCE is [MEMORY]; I verified maintenance, not audit scope |
| 9 | The 88 s "browser proof" figure floating in search results (arXiv QR-auth paper) does NOT describe Semaphore-class proving | Someone will find it and panic | Read the paper's circuit size — it's a much larger bespoke circuit; our measured 0.2 s is the relevant number | High |
| 10 | Native-app escape hatch: Mopro-style native mobile proving is 8–14× faster than browser WASM | If Layers ever ships a native shell, the mid-phone floor problem mostly evaporates (rapidsnark ~0.2–1 s for Class A on phones) | zkmopro.org/docs/performance — already web-verified; benchmark in a native shell when one exists | High |

---

## Sources

- MEASURED: `research/poc/semaphore-timing.mjs` (Node WASM proxy),
  `research/poc/browser-timing.html` + `serve.mjs` (real headless
  Chromium via Playwright), i7-14700F / Node 24.12 / Chromium,
  2026-08-30.
- https://snark-artifacts.pse.dev/semaphore/latest/semaphore-20.zkey — HTTP HEAD, 3,890,175 bytes — 2026-08-30 — LIVE-CHECKED
- https://zkmopro.org/docs/performance/ — mobile + browser WASM benchmarks (circom/halo2/Noir), native-vs-WASM gaps — fetched 2026-08-30 — LIVE-CHECKED
- https://hyli.ghost.io/benchmarking-in-browser-p256-ecdsa-proving-systems/ — in-browser P-256 across stacks, iOS OOM, zkVM infeasibility — post 2025-03-20, fetched 2026-08-30 — LIVE-CHECKED
- https://blog.base.dev/benchmarking-zkp-systems — P-256 ECDSA, UltraHonk vs Groth16, WASM 3.5–4× penalty — post 2025-09-02, fetched 2026-08-30 — LIVE-CHECKED
- https://docs.semaphore.pse.dev/benchmarks — harness confirmed (numbers in images) — fetched 2026-08-30 — LIVE-CHECKED
- npm registry (registry.npmjs.org) — snarkjs 0.7.6 (2026-01-12), @aztec/bb.js 5.2.0 (2026-08-17, daily nightlies), @noir-lang/noir_js 1.0.0-beta.26 (2026-07-30), o1js 3.0.0 (2026-08-18), @semaphore-protocol/proof 4.14.3 (2026-07-08), circomlib 2.0.5 (2022-06-17) — queried 2026-08-30 — LIVE-CHECKED
- https://github.com/Electron-Labs/ed25519-circom — 2,564,061 constraints per Ed25519 verify — via search 2026-08-30 — LIVE-CHECKED (constraint count), repo health [MEMORY-flagged]
- https://aztec.network/blog/the-future-of-zk-development-is-here-announcing-the-noir-1-0-pre-release — Noir 1.0 pre-release, audits in progress — via search 2026-08-30 — LIVE-CHECKED
- https://blog.succinct.xyz/real-time-proving-16-gpus/ — SP1 Hypercube: 99.7% of Ethereum blocks <12 s on 16× RTX 5090 — via search 2026-08-30 — LIVE-CHECKED
- https://github.com/privacy-scaling-explorations/halo2 — PSE halo2 maintenance mode since 2025-01 — via search 2026-08-30 — LIVE-CHECKED
- https://www.o1labs.org/blog/performance-unlock-prover-key-caching-in-o1js-08a9437c8d97 — o1js compile 20 s → 3 s cached — via search 2026-08-30 — LIVE-CHECKED
- Noir Beta browser announcement (aztec.network) — 6.8 s private-token-transfer browser proof, M2 — fetched 2026-08-30 (page metadata unreliable; treat as ~v0.21-era) — LIVE-CHECKED with caveat
