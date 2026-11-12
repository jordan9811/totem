# attack-custody-3 — Adversarial review of the browser keystore pass (reviewer 3)

Scope: `docs/custody-model.md`, `notes/reports/REPORT-CUSTODY.md` (Gates 0-4), `SECURITY-POSTURE.md`
§8 and §16, `research/VERIFY-YOURSELF.md` (no custody-specific entries yet — it
predates this pass; its topology/F2 material is background), and
`git diff e177b65..HEAD` (145 files, +7279/-329) read against the files named in
the brief. Emphasis, as briefed: (d) the root-linking grant and what the relay
learns, and (e) device linking and the seed; (a)-(c) and rate limiting / the boot
check / the A-CU-* assumptions covered as found. Read-only: no server or suite was
run. Every finding below names the file and line I read it from.

## Verdict

The one rule ("the server never holds a root, a seed, a vault key or a persona
private key") holds everywhere I traced key material: the HPKE device-link payload,
the AES-256-GCM seed wrap, and the keystore's `linked` branch all correctly keep the
seed and the device-auth private key off every wire I checked, and the passkey
release path never gets a PRF output or a provider export. But the pass's second,
implicit claim — "the validator learns nothing that lets it or a bystander connect
two things that should stay unconnected" — does not hold for **root linking**: the
relay stores each side's full, real-handle persona roster next to its anchor in
plain JSON, in a table any caller can read back with **no signature at all**, which
hands out exactly the persona-to-root attribution table the rest of this codebase's
ZK layer exists to prevent, to anyone who has or guesses the 10-minute code — not
just the validator's operator. **Device** linking keeps the seed off the wire as
designed, but the linking *protocol* (a human-typed short code, approved by
whichever device the human trusts, with no confirmation of what is being approved
or by whom) is the same shape as the device-code phishing pattern that has been used
against much bigger identity providers, and nothing here narrows it — cryptographic
binding is fully satisfied by "whoever holds the code," never by "the person this
was meant for." Separately, two non-cryptographic gaps make the whole model
conditional on things nobody checks: the production boot contract never asserts
`LAYERS_REQUIRE_SIG=true` (it is filed as "optional" in `.env.production.example`
next to port numbers), so a deployment that simply omits it boots clean and reverts
silently to the pre-Gate-1 single-tenant, unauthenticated-read/write validator; and
both rate limiters key on a client-suppliable `X-Forwarded-For` header, so the
burst/sustained protections Gate 4 built are opt-out for anyone willing to send a
fresh header per request. Thirteen findings follow, two CRITICAL, three HIGH, four
MEDIUM, two LOW, two NOTE.

---

## 1. The root-link relay stores both sides' real persona rosters, bound to their anchors, as plaintext a stranger can read with no signature — severity **CRITICAL**

**Where:** `validator/custody.js:210-223` (`POST /rootlink/offer` — `db.prepare("INSERT INTO root_link_offers (code, anchor_a, proposal, ...) ...").run(code, anchor, JSON.stringify(proposal), ...)`, where `proposal` is `{a, rootA, issuedAt, personasA}`); `validator/custody.js:234-249` (`PUT /rootlink/:code/answer` — `JSON.stringify(answer)` where `answer` is `{b, rootB, personasB, sigB}`); **`validator/custody.js:228-233` — `GET /rootlink/:code` calls no `signed()`/`checkEnvelope` at all**, unlike every other route in the same file; `lib/device/rootlink.ts:53-62` (`me()` builds `personas: ks.listPersonas().map(p => ({id, handle, name, avatarUrl}))` — every persona, real handles, not a subset) and `:108-113`/`:116-125` (`propose()`/`answer()` send that list to the relay verbatim). Schema: `validator/migrations.js:685-694` — `proposal TEXT NOT NULL`, `answer TEXT NOT NULL`, no encryption column.

**Attacker:** Anyone who has the 10-character code — the two linking parties (by design), but also anyone who observes it (shoulder-surf, a pasted chat log, a compromised channel used to convey it, or a phishing flow per finding 4) — issues one unauthenticated `GET /rootlink/<code>`. No `x-layers-device`/`x-layers-sig` header is required or checked.

**What they get:** The complete pre- or post-completion grant in the clear: root A's anchor and its entire persona roster (real handles, names, avatar URLs) once `propose()` has run; root B's anchor and roster too once `answer()` has run; both device-auth signatures once `complete()` has run. This is a fully portable, human-readable statement of "these N handles belong to one person" for two roots — the exact linkage the persona-id derivation (`lib/identity/keystore.ts:163-169`, one-way `sha256(rootSecret:nonce)`) and the whole ZK-membership program (migration 006, "the validator stops knowing persona→root") were built to keep unrecoverable from the validator. `notes/reports/REPORT-CUSTODY.md`'s own description ("The validator relays ciphertext and two anchors that were already public and never learns that the pair is one person") and the code comment at `validator/custody.js:190-193` ("the grant itself lives sealed in each vault") are **not borne out by the code**: the *relayed* proposal/answer are plain JSON columns, not ciphertext, and reading them back needs no proof of party-hood.

**Smallest fix:** (1) require a signed envelope on `GET /rootlink/:code` from one of the two parties (the caller already knows its own anchor once it has proposed or answered — a signed read is no harder than the write paths right next to it); that alone stops the third-party read. (2) Independently, stop sending `personasA`/`personasB` to the relay at all — a co-signed grant only needs to name the two anchors and roots; each side already has its own roster locally and can render the *other* side's roster only after fetching it through a channel bound to the vault (sealed), not the open relay. Given how this pass already seals every OTHER validator-held namespace (`D-CU-1-EVERY-NAMESPACE-IS-SEALED`), the persona lists here are the one place that rule was not applied.

**Suite blind spot:** `scripts/accept-cu3.mjs`'s payload grep (per `notes/reports/REPORT-CUSTODY.md`'s Gate 3 exit note) checks that the seed and device-auth key are absent from "the opened plaintext, the relay row and the validator's tables" — that grep is scoped to *device*-linking's material, not to persona handles in `root_link_offers`. No cited suite asserts "a stranger's unauthenticated `GET /rootlink/:code` fails" or "no persona handle appears in the validator's database" for the root-link path specifically, so this property has no regression test today.

---

## 2. The root-link co-signature does not cover the persona rosters riding with it — severity **HIGH**

**Where:** `lib/device/rootlink.ts:46-48`:
```
export function grantCanonical(g: Pick<RootLinkGrant, "a" | "b" | "rootA" | "rootB" | "issuedAt">): string {
  return `layers/rootlink/v1|${g.a}|${g.b}|${g.rootA}|${g.rootB}|${g.issuedAt}`;
}
```
`personasA`/`personasB` are excluded from the `Pick<...>` by construction. Verification at `:136` and `:159` (`verifyCanonical(sig, grantCanonical(partial), anchor)`) checks only those five fields.

**Attacker:** Anyone able to write to the `root_link_offers` row before a client reads it back — chiefly the validator operator (who, per finding 1, already reads the rosters in the clear) but also anyone who can race a write between a legitimate `answer()`/`complete()` call and the counterpart's next `GET`.

**What they get:** The ability to substitute either side's `personasA`/`personasB` list with a different one — including one naming personas that don't belong to that anchor at all — without invalidating `sigA` or `sigB`. Both `answer()` (`:135`) and `complete()` (`:161`) build the locally-stored `RootLinkGrant` by splicing the *fetched* `personasB`/`personasA` straight from the relay response into an object whose signature verification never touched them. A client that later renders "linked, not merged" (`components/device/DeviceApp.tsx:340-353`) is displaying an unauthenticated list under a cryptographic label the person will reasonably read as vouched-for.

**Smallest fix:** Fold a commitment to the persona lists (e.g. a hash of the sorted persona-id list) into `grantCanonical`, so a substituted roster fails signature verification the same way a substituted anchor already does.

---

## 3. The production boot contract never asserts `LAYERS_REQUIRE_SIG=true` — the one flag that turns on multi-tenancy is filed as "optional" and unchecked — severity **CRITICAL**

**Where:** `lib/platform/env-contract.ts:7-21` (`MUST_NOT_SHIP`) and `:31-39` (`contractViolations`) — a pure blocklist of names that must be *absent*; nothing in this file, `instrumentation.ts:7-19`, or `validator/env-contract.js:1-40` checks that `LAYERS_REQUIRE_SIG === "true"` or that any required-ON flag is set. `.env.production.example:32-40` places `LAYERS_REQUIRE_SIG=true` under the `# ---- optional` heading (line 32), sharing a section with `LAYERS_APP_PORT`/`LAYERS_VALIDATOR_PORT`, two sections below `# ---- required` (line 6) and `# ---- required to be OFF` (line 17).

**What actually depends on it:** `validator/server.js:24` (`REQUIRE_SIG = process.env.LAYERS_REQUIRE_SIG === "true"`) and `:31` (`STRICT = REQUIRE_SIG && !DEV_HOOKS`) gate every one of: `GET /state` (`:460-464`), `GET /state/:namespace` (`:473-477`), `PUT /state/:namespace`'s envelope check (`:493-501`, skipped entirely `if (!REQUIRE_SIG)` — not just unauthenticated but *unscoped*, since a missing envelope also means `anchorOf` falls back to `singleAnchor`), `GET /device/list` (`:391-395`), `POST /roots` and `POST /events` (`:170-176`, `:251-259`). With `REQUIRE_SIG` false, every one of these silently takes its unsigned branch and resolves to `singleAnchor(db)` — "the oldest registered anchor" (`validator/db.js:53-59`) — for every caller.

**Attacker:** Nobody needs to attack anything — an operator who deploys from this example file's "optional" section without independently knowing it is load-bearing (or who sets environment variables by hand and doesn't carry over a project-specific, non-obviously-named boolean) ships a validator with `REQUIRE_SIG` false. Any visitor is then the "attacker": every `GET`/`PUT`/`DELETE /state[...]` and `GET /device/list` request, sent with **no signature at all**, reads and overwrites the single oldest anchor's ciphertext state — the exact readiness findings 1 and 2 this whole pass exists to close.

**What they get:** Full unauthenticated read of one victim tenant's sealed vault blobs (still ciphertext, so not plaintext compromise by itself, but a full return to "two strangers share one root's state") and full unauthenticated *write* to that tenant's `adapter_state` (since `PUT /state/:namespace` skips `checkEnvelope` entirely when `REQUIRE_SIG` is false) — i.e. arbitrary corruption of another root's vault namespaces by anyone.

**Smallest fix:** Add `LAYERS_REQUIRE_SIG` (required to equal `"true"`) and `ZK_DEV_HOOKS` (required to be unset/false) as a second, required-ON list that `contractViolations`/`enforceBootContract` check on both the app and the validator, refusing to boot a "public deployment" without them — symmetric to the existing must-NOT-ship list. Move `LAYERS_REQUIRE_SIG=true` out of `.env.production.example`'s "optional" section into "required."

**Suite blind spot:** `scripts/accept-cu4.mjs:2` and `:152` construct their "production-shaped" fixture with `LAYERS_REQUIRE_SIG: "true"` hard-coded by the harness itself — no suite anywhere constructs a production-shaped environment that *omits* it, so a regression here (or, as today, an original gap) has no test that would ever fail. This is also what `A-CU-RIG-UNSIGNED-READS-ASSUME-ONE-APP` (`notes/reports/REPORT-CUSTODY.md` stage 2) undersells: it frames the unsigned-read fallback as a rig-only affordance, but the fallback code path is identical in production the moment the flag is merely absent — it is not rig-gated, it is `REQUIRE_SIG`-gated, and nothing enforces that gate's value in the one place ("public deployment") that matters.

---

## 4. Device linking and root linking are phished exactly like OAuth device-code flows: no binding to the intended counterpart, no confirmation of what is being granted — severity **HIGH**

**Where:** `validator/custody.js:131-146` (`POST /link/offer` — fully unauthenticated, anyone can mint an offer carrying an arbitrary `hpkePub`) and `:162-175` (`PUT /link/:code/sealed` — accepts the seal from **any** caller whose envelope merely verifies against *some* registered anchor; there is no check that the anchor is the one the human on the new-device side expects). Mirror for root linking: `validator/custody.js:234-249` (`PUT /rootlink/:code/answer`, same shape). Client: `lib/device/linking.ts:74-107` (`approve(code)` — builds the payload from **whatever root this device currently holds** and seals it to whoever posted the offer, with zero prompt for confirmation) and `lib/device/rootlink.ts:116-142` (`answer(code)` — same). UI: `components/device/DeviceApp.tsx:177-182` (the "Approve" button — label is only `Approve`, no device name, origin, timestamp or fingerprint of the offer is ever fetched or shown) and `:210-216`/`:354-375` (root-link "Link" button, same absence).

**Attacker:** Mints their own device-link offer (`offer()`, no auth needed) or root-link offer (needs only a free, instant, ephemeral root — `POST /rootlink/offer` costs one signed envelope from an anchor anyone can mint locally in one page load) and gets a valid code. Via any out-of-band channel (fake support chat, phishing email, a compromised "verify your device" prompt), convinces a victim to enter that code into their own **Devices** or **Linked accounts** panel — the same social-engineering step used in real device-code-phishing campaigns against much larger identity providers, and nothing added here narrows the attack: the code is a plain typed string (not a QR scan requiring physical proximity, which is what WhatsApp/Signal use for the analogous flow), and the approving screen shows no information to sanity-check against.

**What they get:** For device linking — the victim's vault key, zk master, and every persona's sign/fcSigner/fcCustody leaf (`lib/identity/keystore.ts:217-236`, `linkMaterial()`), i.e. full ability to post, sign and read the vault as every one of the victim's personas, indefinitely until the victim notices and calls `POST /device/revoke`. For root linking — per finding 1, the victim's complete persona roster bound to their root in a form the attacker can keep a durable, cryptographically-signed copy of even after the victim calls `unlink()` (`lib/device/rootlink.ts:196-203` only deletes the local vault copy and revokes the *relay's future presentation*; it does not and cannot recall a copy the attacker already downloaded).

**Smallest fix:** Show the offer's origin/creation-time and require an explicit "does this match what your other device shows?" step before `approve()`/`answer()` fires (defense-in-depth, does not fully close a determined phishing attempt but removes the "blind approve" UX); consider binding the code to a second, independently-conveyed shared value (e.g., a short verification phrase both screens display, as some passkey-adjacent flows do) so a human has something concrete to compare rather than a bare string dictated by the attacker.

**Suite blind spot:** `scripts/accept-cu3.mjs` drives both sides of the exchange cooperatively (that is what the acceptance criteria in `notes/reports/REPORT-CUSTODY.md` Gate 3 describe); a suite of cooperating parties cannot exercise "the approving human did not intend this specific link," so this property — the human-trust boundary being the *only* boundary — has no test and, being a protocol/UX property rather than a code defect, likely cannot be captured by this style of suite at all.

---

## 5. The wrap-path passkey release fails open to a self-signed assertion when the validator is merely unreachable — severity **HIGH**

**Where:** `app/api/custody/passkey/release/route.ts:31-45`:
```
let key: { spkiHex: string; alg: number } | null = null;
try {
  const r = await fetch(`${validatorUrl()}/custody/method/${encodeURIComponent("pk:" + credentialId)}`, { cache: "no-store" });
  if (r.ok) { ... if (m?.pubkey_spki && typeof m.alg === "number") key = { spkiHex: m.pubkey_spki, alg: m.alg }; }
} catch {
  /* the validator is unreachable: fall through to first-use only if nothing is recorded — refused below otherwise */
}
if (!key) {
  if (typeof spkiHex !== "string" || ... ) return NextResponse.json(..., { status: 404 });
  key = { spkiHex, alg };  // caller-supplied key accepted
}
```
The file's own header comment (`:11-14`) states "the recorded public key wins; the supplied one is accepted only when no record exists yet" — the `catch` block does not distinguish "the validator answered 404" (handled correctly by `r.ok` being false without throwing) from "the validator could not be reached at all" (network error/timeout — the only case that actually throws and lands in `catch`). Both end up in the same `if (!key)` branch.

**Attacker:** Knows or guesses a target's wrap-path `credentialId` (method ids are explicitly public identifiers per `D-CU-2-METHOD-IDS-ARE-PUBLIC-IDENTIFIERS`) and can either wait for, or induce, a moment where the app server's fetch to the validator fails (a transient outage, a deploy restart, a network partition, or a denial-of-service against the validator — made easier by finding 6's rate-limit bypass). They then `POST /api/custody/passkey/challenge` (unauthenticated, public), and `POST /api/custody/passkey/release` with a **self-generated** Ed25519 keypair: hand-construct `authenticatorData` (37 bytes: real `sha256(rpId)` ‖ flag byte with bit 0 set ‖ counter — all computable from public information), `clientDataJSON` (`{"type":"webauthn.get","challenge":<real challenge>,"origin":<real origin>}`), sign `authenticatorData‖sha256(clientDataJSON)` with their own key, and supply that key as `spkiHex`/`alg`. No real authenticator or browser WebAuthn ceremony is required — this is a plain JSON POST.

**What they get:** `releaseKeyFor(secret, credentialId)` (`lib/custody/release.ts:21-23`) for a credential id they do not own — the wrap-path KEK — without ever touching the victim's authenticator. Impact is bounded by design: the wrap-path *blob* itself lives only in the victim's browser IndexedDB, never the validator (verified — see checked-and-holds below), so this alone does not yield the seed. It does fully break the stated invariant and hands the KEK to anyone who separately obtains a copy of that browser's IndexedDB (lost/stolen device, malware, a browser-profile backup) — at which point the passkey ceremony (the actual second factor) is worth nothing.

**Smallest fix:** On a validator-fetch error, fail closed (503 "cannot verify — try again"), never fall through to accepting a caller-supplied key. Only take the "no record" branch on a confirmed 404 from the validator.

**Assumption this understates:** `A-CU-2-RELEASE-SECRET-ROTATION`/`A-CU-WRAP-PATH-SPLIT` (`docs/custody-model.md`) frame the residual risk as "an operator holding the release key AND a copy of the browser's blob" — an insider-trust framing. This bug shows the release key is obtainable by an **outside** attacker under a plausible, attacker-influenceable precondition (validator downtime), not only by the operator; the assumption should say so.

**Suite blind spot:** No iteration note in `notes/reports/REPORT-CUSTODY.md`'s Gate 2 log describes simulating validator unreachability during a release call; `scripts/accept-cu2.mjs`'s described checks (PRF/wrap round-trip, moved credential, 24-words) all run against a live validator.

---

## 6. Both rate limiters key on a client-suppliable `X-Forwarded-For` header — severity **MEDIUM/HIGH**

**Where:** `validator/server.js:110`: `const key = (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.ip || req.socket.remoteAddress || "local";` and `middleware.ts:34`: `const ip = req.ip || req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";`. Neither validates that the request actually arrived through a trusted proxy that itself sets/overwrites this header; both take the client-suppliable leftmost value.

**Attacker:** Sends a distinct, freely-chosen `X-Forwarded-For` value on every request (or simply a random one per request). Each apparent "address" gets a fresh token bucket (`validator/server.js:111-116`; `middleware.ts:19-24`).

**What they get:** Unlimited effective request rate against both the validator and the app's `/api/*` surface — defeats the 300-burst/5-per-second (validator) and 200-burst/3-per-second (app) budgets Gate 4 built. This directly widens every other finding here that assumed rate limiting as a mitigant: brute-forcing a link/rootlink code (50 bits, still astronomically large even unthrottled, so not by itself practical) matters less than using the bypass to flood `POST /link/offer` (finding 9) or to hold the validator in a degraded/overloaded state to trigger finding 5's fail-open window.

**Smallest fix:** Only trust `X-Forwarded-For` when the connection's immediate peer is a known, configured reverse-proxy address; otherwise key on the raw socket address (`req.socket.remoteAddress` / the platform's own `req.ip`) and ignore client-supplied forwarding headers entirely. If a trusted-proxy chain is genuinely in front of these processes, key on the proxy-appended (rightmost trusted-hop) value, not the client-supplied leftmost one.

**Assumptions this understates:** `A-CU-4-RATE-LIMIT-PER-INSTANCE` ("several instances multiply it, which is still a budget") and the Gate 4 iteration-2 reading `A-CU-4-RATE-LIMIT-KEY-IS-THE-ADDRESS` both implicitly treat "address" as a meaningful, attacker-fixed unit that only scales with real infrastructure. It doesn't: a single instance behaves as if it had unbounded instances the moment the caller can relabel itself for free.

**Suite blind spot:** No suite in the repository sends varying `X-Forwarded-For` values (grep across `scripts/accept-cu4.mjs` for the header returns nothing); the burst tests described in `notes/reports/REPORT-CUSTODY.md` Gate 4 ("a burst of 260 on the app meets 60 429s... a burst of 340 on the validator meets 319") drive load from one test-harness address by construction, so they prove the bucket fires under naive load, never that it resists relabeling.

---

## 7. The root-link grant can outlive its stated exchange window on the validator — severity **MEDIUM**

**Where:** `validator/migrations.js:679-682` (comment: "no grant body outlives the exchange here — each root keeps the grant sealed in its own vault"). `lib/device/rootlink.ts:140`: only `answer()` calls `DELETE /rootlink/:code` after observing `done.sigA`; `complete()` (`:144-167`, the proposer's side) never deletes the row after posting `sigA` at `:165`. If B's tab/process is gone before it observes completion (closed, crashed, network drop during the poll at `:127-133`), nobody deletes the row. `expires_at` (`validator/custody.js:221`, set once at creation, `OFFER_TTL_MS = 10 * 60_000` at `:121`) is only enforced by the lazy `sweep()` (`:196`), which runs solely as a side effect of a *later, unrelated* call to one of the `/rootlink/*` routes — there is no background timer.

**Attacker:** Same as finding 1 — anyone with the code, for as long as the row survives, which the code and comment both suggest should be "only during the exchange" but is not guaranteed to be.

**What they get:** A longer real-world window than the design claims to read both rosters and (once complete) both signatures unauthenticated (compounding finding 1).

**Smallest fix:** Have `complete()` also issue the `DELETE` after a successful `PUT .../complete`, and/or run `sweep()` on a real interval independent of route traffic.

---

## 8. The device-link relay discloses the approving root's anchor and root id in the clear to anyone with the code — severity **MEDIUM**

**Where:** `validator/custody.js:162-175` (`PUT /link/:code/sealed` stores `anchor: req.layersAnchor` and `root_id` from the body, both **outside** the `sealed` ciphertext column) and `:147-160` (`GET /link/:code` — also unauthenticated, like the rootlink equivalent — returns `anchor: row.anchor, rootId: row.root_id` alongside `sealed`).

**Attacker:** Anyone with the code, before the "new" device even calls `accept()`.

**What they get:** Which root (anchor + root id) approved a given code — metadata the "nothing it holds opens anything" framing in `notes/reports/REPORT-CUSTODY.md` (`D-CU-3-OFFERS-ARE-CREATE-ONCE-AND-SHORT-LIVED`: "The relay holds a device key, an HPKE public key, and ciphertext") glosses over: it also holds, and serves, two plaintext identifiers the rest of this pass otherwise treats as sensitive enough to seal (namespaces, persona rosters). Key material itself is unaffected — the `sealed.ct`/`sealed.enc` stay opaque — so this is metadata exposure, not a break of the one rule.

**Smallest fix:** Require a signed read (from either the offering or approving anchor) for `GET /link/:code`, same as finding 1's fix, or at minimum omit `anchor`/`rootId` from the response to a caller who hasn't proven it is a party.

---

## 9. Unauthenticated, cheaply-mintable link/rootlink offers enable a low-cost denial of onboarding's device-linking surface — severity **MEDIUM**

**Where:** `validator/custody.js:131-136`: `POST /link/offer` requires no signature at all, and the only defence is a **global** cap: `if (db.prepare("SELECT COUNT(*) AS n FROM link_offers").get().n >= 1000) return res.status(429)...`. `POST /rootlink/offer` (`:210-223`) has no analogous cap — it requires a signed envelope, but per `D-CU-0-6` minting a fresh ephemeral root (and thus a valid anchor + envelope) is free, instant, and requires no proof of work.

**Attacker:** Repeatedly calls `POST /link/offer` (no auth) or mints throwaway ephemeral roots and calls `POST /rootlink/offer` (one envelope each, free), refreshing faster than the 10-minute TTL.

**What they get:** For `link_offers`, keeping the table pinned at its 1000-row ceiling denies every other visitor a new device-link code (`insert` fails past the cap — `:136`, `:141-144` catches the resulting unique-constraint collision as "code collision," but the count check itself simply refuses at 429 first). For `root_link_offers`, there is no ceiling at all — unbounded row growth for the cost of free account creation. Finding 6's rate-limit bypass removes even the per-address throttling that would otherwise slow this down.

**Smallest fix:** Give `root_link_offers` the same global-capacity guard `link_offers` already has; consider a per-anchor (not just global) cap on open offers for both tables so one identity cannot exhaust the shared ceiling by itself.

---

## 10. `allowedOrigins()` always trusts `localhost`/`127.0.0.1`, even on a production boot — severity **LOW**

**Where:** `lib/custody/release.ts:26-35`:
```
export function allowedOrigins(): string[] {
  const out = new Set<string>();
  const app = process.env.APP_URL;
  if (app) out.add(app.replace(/\/$/, ""));
  const port = process.env.LAYERS_APP_PORT || "3001";
  out.add(`http://localhost:${port}`);
  out.add(`http://127.0.0.1:${port}`);
  ...
```
These two additions are unconditional — not gated by `ZK_DEV_HOOKS` or `NODE_ENV !== "production"` — unlike almost every other dev/rig affordance in this pass, which is explicitly closed on a public deployment (e.g. `app/api/dev/route.ts:16`, `:31`).

**Attacker:** Needs a WebAuthn assertion ceremony to actually occur while the browser's location is `http://localhost:<port>` or `http://127.0.0.1:<port>` on the machine reaching this server — realistically only relevant if the attacker already controls something bound to that port on the same host as a victim (a much larger local-compromise prerequisite), so exploitability against a remote visitor of a real deployment is low; flagged because it is inconsistent with this pass's own discipline of scoping every other dev convenience out of production.

**Smallest fix:** Gate the two localhost additions behind `process.env.ZK_DEV_HOOKS === "true"` like the rest of the rig surface.

---

## 11. The WebAuthn challenge's replay protection is in-memory and resets on restart — severity **LOW / NOTE**

**Where:** `lib/custody/webauthn.ts:103-113` (`const spent = new Map<string, number>();` — process memory only, no persistence).

**Attacker:** Captures a valid, unexpired (≤120s, `issueChallenge`'s `ttlMs` default at `:96`) challenge+assertion pair (e.g. via a logging leak or a compromised intermediary) and replays it once, timed to land immediately after an app-server restart (deploy, crash-recovery).

**What they get:** One extra accepted release call for a credential whose challenge was captured — a narrow, timing-dependent window, not a standing hole.

**Smallest fix:** If this needs closing rather than accepting, persist spent-challenge ids in the same store as everything else short-lived (or shorten the TTL further); likely fine to leave as an accepted, named trade-off given the narrow window.

---

## 12. The validator does not itself enforce "a wrap-path blob never lands here" — it is client discipline only — severity **NOTE**

**Where:** `validator/custody.js:82-101` (`PUT /custody/blob/:id`) never inspects the associated `custody_methods.kind` before accepting a blob write. The guarantee that `passkey-wrap` blobs stay off the validator (`D-CU-0-8`) is enforced only by the reference client: `lib/device/custody/index.ts:128`: `if (kind === "passkey-prf") await putBlob(methodId, blob);` — the wrap path (`:122-124`, `kind = "passkey-wrap"`) simply never calls `putBlob`.

**Why it matters:** Not independently exploitable today (an attacker gains nothing by writing their *own* wrap-path blob to the validator under their *own* method id), but it means the property `SECURITY-POSTURE.md` §16 states as a fact about the system ("the blob lives only in the browser: the account is device-bound") is actually a fact about one code path, not an invariant the server enforces. A future client (or a bug in this one) could silently start uploading wrap-path blobs and nothing would notice.

**Smallest fix:** Have `PUT /custody/blob/:id` refuse when the method record's `kind === "passkey-wrap"`.

---

## 13. `unwrapSeed`'s AAD is self-referential — defense-in-depth gap, not independently exploitable — severity **NOTE**

**Where:** `lib/device/custody/wrap.ts:41-48` derives the AES-GCM associated data from `blob.method` (a field embedded in the blob JSON being opened) rather than from an externally supplied expected method id. This is not exploitable today only because `validator/custody.js:86` (`PUT /custody/blob/:id`) independently enforces `blob.method !== id → 400` at write time, so `blob.method` can be trusted to equal the id it was actually stored under — but `unwrapSeed` itself has no way to detect a violation of that invariant if it were ever weakened.

**Smallest fix:** Have callers (`lib/device/custody/index.ts:148`, `:161`, `:193`, `:195`) pass the method id they intended to fetch and have `unwrapSeed` take and check it explicitly, rather than trusting the blob's self-declared field.

---

## Checked and holds (no need to re-verify)

- **The seed and the device-auth private key never appear in the device-link payload.** `LinkPayloadV2` (`lib/device/linking.ts:24-33`) has no seed field; `linkMaterial()` (`lib/identity/keystore.ts:218-236`) never reads or includes `rootSecretHex`; a linked keystore's `seedBytes()` (`:189-193`) and `signAsDeviceAuth()` (`:356-358`) both throw, and `linkMaterial()` itself refuses on an already-linked device (`:220`).
- **`installLinkedRoot`/`isLinkedFile` validation is real**, not cosmetic: malformed anchor/vault-key hex is rejected (`lib/identity/keystore.ts:79-81`, `:239-242`).
- **The wrap primitive is a correct AEAD construction**: random 12-byte nonce, method-id-bound AAD, GCM tag failure on a wrong KEK or tampered ciphertext (`lib/device/custody/wrap.ts:32-48`) — no partial-success path.
- **Method-id first-write-wins is enforced server-side**, not just documented: `validator/custody.js:72-77` (records) and `:91-93` (blobs) both check the stored owner before allowing a write.
- **`checkEnvelope`'s chain is intact** across every custody/link/rootlink route: registered-and-not-revoked device, delegation re-verified against the anchor, envelope signature over `namespace|bodyHash|counter`, strictly-increasing per-`(device,namespace)` counter (`validator/server.js:419-453`).
- **No cross-tab/cross-viewer confusion in the fetch-patch mechanism itself**: `installDeviceHost` (`lib/device/host.ts:69-82`) is a per-`window` singleton with no server-side session or cookie multiplexing — one browser context's patched `fetch` cannot be handed another context's device.
- **The dev route closes whole, both verbs**, on a production build without `ZK_DEV_HOOKS`: `app/api/dev/route.ts:15-19` (GET) and `:26-32` (POST), matching `notes/reports/REPORT-CUSTODY.md`'s claim.
- **`flushVault` fails loudly**, not open: `lib/adapters/mock/persist.ts:339-361` throws on both a network failure and a non-OK response, in contrast to the plain `flush()` used for non-vault namespaces.
- **The reference client never uploads a wrap-path blob to the validator** (see finding 12 for the caveat that this is client-, not server-, enforced).
