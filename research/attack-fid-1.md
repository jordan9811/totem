# attack-fid-1 — the NETWORK / ONCHAIN OBSERVER against the multi-fid pass (gates 0–3 committed at `2995279`, gate 4 in the working tree)

Reviewer angle: I see what Farcaster and its infrastructure see — hubs (every
cast, reaction, link, UserData and signer message with its timestamp and
signer key), Neynar (the sponsor that reserves fids, pays registration, holds
the managed signers and relays every write for this API key), the
IdRegistry / KeyGateway / KeyRegistry / StorageRegistry on Optimism (Register,
Transfer, Add, Rent events with tx senders and calldata), the fname registry
(public transfer log with timestamps), and any public RPC the client talks
to. I do NOT see the validator's database or the client. Read-only review of
the repository; nothing was run. Where a fact depends on Neynar's or the
chain's behaviour that the repository does not evidence, the finding is
marked HYPOTHESIS with the one lookup that settles it.

Scope read: `notes/prompts/multi-fid-prompt.md`, `notes/reports/REPORT-FID.md`, `SECURITY-POSTURE.md`
§8–13, `research/VERIFY-YOURSELF.md`, the fc / identity / kdf / zk-anon /
validator code named in the brief, `scripts/fid-acquire.mjs`,
`scripts/live-fid2.mjs`, `scripts/live-fid4.mjs`, and the FC pass's
`scripts/gate1-acquire-fid.mjs` + `notes/reports/REPORT-FC.md` for how the sponsored
registration actually behaved on the real network.

Headline: the cryptographic parts of the design (derived keys, the anon-post
scope, the cast-bound message, the relay-before-nullifier order) are sound
as written. The linkage is in the METADATA the pass writes to the network
by its own hand: profile strings, fname stems, a shared test marker, a
self-drawn follow/like/reply graph, one Neynar API key over everything, and
a registrant-linkage assertion that checks strings the script itself wrote.
One finding (#1) is an account-takeover, not a linkage.

---

## 1. HIGH — A live fid created for a SEEDED persona is owned by a custody key anyone can derive from a public constant

**WHAT.** The live acquisition path accepts any persona `isViewerPersona`
admits — keystore-minted personas AND the seeded viewer's personas. For a
seeded persona the fc-custody key does not come from the root seed: it
comes off the FIXTURE root, which is HKDF of the public master constant
`"layers-fixture-master/v1"` with the persona id as nonce. Both the custody
ADDRESS the registration names as the fid's owner and the EIP-712 `Transfer`
signature that accepts the fid are produced from that key. The prompt's own
Gate 2 plan is "Create FIDs for two seeded public personas", and REPORT-FID
records that the seeded persona's keys resolve through the fixture root.
Nothing on the live path refuses a fixture-rooted persona. Whoever reads the
repo and the seed data can compute the private key that owns the fid on the
IdRegistry: transfer it, add signers through the KeyGateway, change the
recovery address, or post through a self-added signer. That is not a
linkage — it is loss of the account, and of any persona reputation it ever
carries.

**EVIDENCE.**
- `lib/identity/keys.ts:48-50` — `fcCustodyAddressFor` = `fcCustodyAddress(personaId) ?? fixtureFcCustodyAddress(personaId)`; `:53-55` — `signCustodyTypedDataFor` falls through to `fixtureSignCustodyTypedData`.
- `lib/identity/fixtureRoots.ts:62-66` — `fixtureSignCustodyTypedData` signs with `fcCustodySeed(fixtureSeed(personaId), personaId)`; `:68-73` the address likewise; `:13-16` "These keys are public-by-construction: anyone reading the repo can derive them."
- `lib/crypto/kdf.ts:111-114` — `FIXTURE_MASTER = te.encode("layers-fixture-master/v1")`.
- `lib/identity/keys.ts:58-60` — `isViewerPersona` = `isOwnPersona(personaId) || SEED_VIEWER.personas.includes(personaId)`.
- `lib/fc/acquire.ts:125` — `recordLiveFid`: `if (!isViewerPersona(input.personaId)) return refused` — the seeded persona passes; `:133-134` the custody address is compared against `fcCustodyAddressFor` — the fixture address matches itself.
- `lib/fc/custodySign.ts:59-72` — `signCustodyTransfer` uses `fcCustodyAddressFor` / `signCustodyTypedDataFor` with no keystore-only check.
- `scripts/fid-acquire.mjs:111-114, 138, 154` — the probe's `custodyAddress` becomes `requested_user_custody_address`; the app signs the Transfer for it.
- `notes/prompts/multi-fid-prompt.md:121` — "Create FIDs for two seeded public personas"; `notes/reports/REPORT-FID.md` Gate 1 iteration 1 — "the seeded viewer persona's keys come off its FIXTURE root ... not the keystore".

**ATTACK.** (1) Read `seed/data/*` for the persona id of the live account
(or take it from `research/live-fid2.json`, finding #14). (2)
`privateKeyToAccount(hkdf(sha256, "layers-fixture-master/v1", "", "layers/v1/fixture-root/<id>") → hkdf(..., "layers/v1/fc-custody/<id>"))`.
(3) Confirm `IdRegistry.custodyOf(fid)` equals that address. (4) Send
`IdRegistry.transfer` / `KeyGateway.add` from it. No Neynar involvement, no
app involvement, no signer needed.

**FIX.** Refuse the live path for any persona whose fc keys resolve through
the fixture root: in `recordLiveFid` and both `custodySign` shapes require
`isOwnPersona(personaId)` (keystore) — not `isViewerPersona` — and add a
negative check to `accept-fid2` (a seeded persona is refused with a named
reason). If the pass still wants the seeded whitelist-holder persona live,
adopt it into the keystore first (`adoptSeededPersona`) so its nonce derives
from the real seed; the id stays, the key changes. Until then the Gate 2
live plan as written creates accounts the public can take.

---

## 2. HIGH — The registrant-linkage assertion checks strings the script wrote by fiat; what the chain actually records (sender, payer, recovery) is unread and plausibly developer-unique

**WHAT.** The safety-set assertion "no two persona fids share a registrant
or funder that is not the sponsor" is evaluated over `registrant` /
`funder` fields that are the literal `"neynar-sponsor"` written by the
acquisition script (and by the fixture) — never read from an event. The
assertion is therefore satisfied by construction and says nothing about the
chain. What the chain DOES record: the sender of the `IdGateway.register`
(or `registerFor`) call that emits `IdRegistry.Register(to, id, recovery)`,
the `payer` of `StorageRegistry.Rent`, the `from` of the `Transfer` that
moves the fid to the persona's custody address, and the `recovery` address
set at registration. Registration is billed through `x-wallet-id` — the
developer's own App Wallet on Neynar, funded by the user with ETH on
Optimism. If Neynar sends those transactions FROM that wallet (or from a
per-app relayer), or sets `recovery` to it, then every fid this API key
ever creates — the throwaway 3348985 and both persona fids — carries the
same developer-unique address on a public chain, forever. That is exactly
the linkage the prompt says the registrant rule must exclude, and the
assertion cannot see it.

**EVIDENCE.**
- `scripts/fid-acquire.mjs:178-179` — `registrant: "neynar-sponsor", funder: "neynar-sponsor"` (literals); `:124, 160` — `x-wallet-id: process.env.NEYNAR_WALLET_ID` on the fid reservation and the register call.
- `lib/fc/acquire.ts:109-110` — the fixture writes the same literals.
- `lib/fc/linkage.ts:17-18, 33` — `SPONSOR_IDS = {"neynar-sponsor","neynar"}` are skipped; `:11-14` — "a chain read of the IdRegistry Register event is the linkage test's (Gate 5) job, not this assertion's."
- `notes/reports/REPORT-FC.md:26-31` — "an onchain wallet configured in the Neynar developer portal ... through which the real Optimism costs bill (FID registration + first storage unit)"; `:405-424` — "The user funded a Neynar app wallet on Optimism ... ~$0.35-$0.90 in ETH billed to the app wallet by Neynar"; `:473` — the read at registration "showed a different custody address — Neynar's own, mid-transfer".
- `scripts/accept-fid1.mjs` / `notes/reports/REPORT-FID.md` Gate 1 — the registrant-linkage check is green on records whose fields are these literals.

**HYPOTHESIS (one lookup settles it).** Look up fid 3348985 on Optimism:
the `Register` event's transaction sender, `IdRegistry.recoveryOf(3348985)`,
and the `Rent` payer. If any of them is the App Wallet address (or an
address that appears only for this developer's registrations), the rule is
violated by the existing throwaway already and will be by both persona
fids. If all three are Neynar-wide addresses, the cluster is "everything
Neynar sponsored", which is fine and must be stated.

**ATTACK.** `SELECT id FROM Register WHERE tx.from = <app wallet>` (or
`recovery = <app wallet>`) on any Optimism indexer → the complete set of
Layers accounts, including the anon account. No timing analysis needed.

**FIX.** (a) The linkage assertion must READ: after settle, fetch the
Register tx sender, the Rent payer, `recoveryOf(fid)` and the Transfer
`from` for each live fid and store them in the sealed record; compare
against an explicit allowlist of Neynar-wide sponsor addresses, refuse (or
flag KNOWN-LINKED) otherwise. (b) Until then the posture must carry
**A-FID-REGISTRANT-BY-FIAT**: "registrant and funder are the acquisition
script's assertion; the chain was not read". (c) The recovery address is
part of the same rule — if Neynar sets itself as recovery, "Neynar too"
extends to custody (Neynar can recover the fid), which the custody
adapter's compromise line does not say.

---

## 3. HIGH — Under managed custody Neynar's view is TOTAL: one API key creates every fid, holds every signer, relays every persona write AND the anon cast

**WHAT.** The documented compromise says "Neynar can post as any persona".
It omits the stronger fact: Neynar can LINK. One `NEYNAR_API_KEY` (a) reserves
and registers both persona fids under one `x-wallet-id`, (b) creates and
holds the managed signer of each persona, (c) is the `x-api-key` on every
cast / reply / like / delete / follow the app makes as any persona, (d) is
the key the VALIDATOR uses to relay the anon cast — and the anon account
defaults to the FC-pass throwaway that the same key created. Neynar's
request log therefore holds, in one place, {API key K → fids F1, F2,
throwaway/anon} and {K → every cast by each of them, with the text and the
wall-clock}. The anon-post design hides the root from hub observers and
from the validator; it does not hide it from Neynar, which sees "K relayed
text C as ANON at T" beside "K posted as F1 at T-2min". In the §8 topology
K is the user. Every "Neynar too" sentence in the posture must become
"Neynar sees all of it".

**EVIDENCE.**
- `scripts/fid-acquire.mjs:56` — `neynarHeaders` = `x-api-key: NEYNAR_API_KEY` on `:119` (fname check), `:124` (fid reservation, + wallet id), `:142` (signer), `:160` (register, + wallet id).
- `lib/fc/writes.ts:217-285` — `liveTransport`: `x-api-key: key` on `/cast`, `/feed/user/casts`, `/reaction`, `DELETE /cast`, `/user/follow`, each with the persona's `signer_uuid`.
- `validator/zk.js:213-218` — `anonRelayAccount`: `FC_ANON_FID ?? FC_TEST_FID`, `FC_ANON_SIGNER_UUID`, `NEYNAR_API_KEY`; `:641-645` — the relay `POST /v2/farcaster/cast` with `x-api-key: acct.apiKey`.
- `.env.example:41-42` — "FC_ANON_FID= # defaults to FC_TEST_FID"; `:3` one `NEYNAR_API_KEY` for the project.
- `lib/fc/custody/types.ts:6-12`, `lib/fc/custody/neynarManaged.ts:11-12` — the compromise text: "can post as any persona ... 'Neynar too', never 'Neynar instead'" — nothing about linkage.
- `lib/attest/fid/live.ts:17-20` — the same key reads `user/bulk?fids=<own fid>` for `neynar.score`.

**ATTACK.** Neynar (or its logs: breach, subpoena, an employee) joins on
API key. No cryptography is touched. For the anon cast specifically: the
relay request arrives from the validator's IP with the same key that just
posted as the personas; in a single-tenant deployment the IP is the user's
host too (§8).

**FIX / ASSUMPTION.** State **A-FID-NEYNAR-SEES-ALL** in the "Network
identities" section, and rewrite the anon-post guarantee as "attributed to
no one by hubs, by other clients, by this client and by the validator; NOT
hidden from Neynar under managed custody". The product-level fix is
structural: self-custody signers (Call Option A) plus direct hub submission
for persona writes, and an anon relay account that is not created, signed
for, or relayed by the same developer credential (a hub client with the
anon fid's own self-custodied signer). Separate API keys do not help — they
share the developer account.

---

## 4. HIGH — Profile metadata is a client fingerprint on the network: the default bio names Layers, the display name is the fname, and every fname fallback starts with "layers-"

**WHAT.** The registration body's `metadata` is built from two env
variables with fixed defaults — `display_name = FID_DISPLAY_NAME || fname`,
`bio = FID_BIO || "a Layers persona"` — and the persona record is fetched
and then discarded (`void persona`). Every persona fid created by this
command carries the bio "a Layers persona" unless the user sets one env
value, which then applies identically to both personas of a run. The fname
fallback in the app is `layers-<hash>` and in the script `layers-<random>`;
the FC-pass throwaway (the anon account) is `@layers-test-852c` with bio
"Layers dev test account — automated posts [layers-test]". UserData is a
public hub message; Neynar exposes user search. The Gate 1 spec said
"profile set from persona metadata"; as built the network profile is a
shell that says which client made it.

**EVIDENCE.**
- `scripts/fid-acquire.mjs:157` — `metadata: { display_name: process.env.FID_DISPLAY_NAME || fname, bio: process.env.FID_BIO || "a Layers persona" }`; `:150, 159` — `const persona = ...; void persona;`.
- `scripts/fid-acquire.mjs:118` — `` `layers-${Math.floor(Math.random()*1e6).toString(36)}` ``; `lib/fc/acquire.ts:44` — `"layers-" + Math.abs(hash32(handle))...`.
- `scripts/gate1-acquire-fid.mjs:127-128` — `PROFILE_DISPLAY_NAME = 'Layers dev test'`, `PROFILE_BIO = 'Layers dev test account — automated posts [layers-test]'`; `notes/reports/REPORT-FC.md:413-417`.
- `notes/prompts/multi-fid-prompt.md:105-106` — "fname per persona: claim the persona's display handle as its fname where available; profile set from persona metadata".

**ATTACK.** Neynar `user/search?q=Layers persona` or a hub UserData scan for
`bio LIKE '%Layers%'` / `fname LIKE 'layers-%'` returns the persona accounts
and the anon account as one labelled set. Two accounts with the same
uncommon bio created minutes apart is a link on its own.

**FIX.** No default bio (empty, or the persona's own `bio`); display name,
bio and pfp from the persona record, per persona; no "layers-" prefix in
any fallback (use the handle hash alone, or refuse and ask); never one env
value for two personas (finding #15). Add a leak-grep needle for the
strings "Layers", "layers-" and "[layers-test" against the metadata body
the script sends. Note the trap the fix opens: when profile-from-metadata
is built, a fork copies `avatarUrl` and `bio` from its source
(`app/api/identity/fork/route.ts:114-116, 128-130`) — pushing those to the
network would give the old and new fid the same pfp URL (finding #5).

---

## 5. HIGH — A fork's new account is named `<old>-2`, displayed as "<old name> (new)", and carries the old avatar and bio

**WHAT.** The fork route's defaults are `handle = <source.handle>_2` and
`name = <source.name> (new)`, with `avatarUrl` and `bio` copied. The fname
derivation maps `_` to `-`, so the new fid's fname is `<oldfname>-2`; the
live command takes that fname by default from `signerProbe`. On the network
this reads: `@fluffypanda` goes quiet, `@fluffypanda-2` registers, its first
followers are `@fluffypanda`'s. The fork exists to break the link between
the two accounts; the default naming publishes it in the fname registry's
public transfer log.

**EVIDENCE.**
- `app/api/identity/fork/route.ts:111-116` — `name: body.newName ?? \`${source.name} (new)\``, `handle: body.newHandle ?? \`${source.handle}_2\``, `avatarUrl: body.newAvatarUrl ?? source.avatarUrl`, `bio: source.bio`; `:128-130` — the same into `personaById`.
- `lib/fc/acquire.ts:36-45` — `fnameFromHandle`: `.replace(/[^a-z0-9-]/g, "-")` → `fluffypanda-2`.
- `app/api/fc/persona/route.ts:59-63` — `signerProbe` returns `fname: fnameFromHandle(handle)`; `scripts/fid-acquire.mjs:117` — `desired = FID_FNAME_OVERRIDE || probe.fname || personaId`.
- `notes/reports/REPORT-FID.md` D-FID-3-FORK-MINTS — "any onchain relation between the old and the new account is exactly the linkage the fork exists to break" — the fname relation is not onchain but it is public and permanent.

**ATTACK.** The fname registry `/transfers` log: for each fname `X`, look for
`X-2` (or `X-<n>`) registered later, whose fid's early followers overlap
`X`'s. Zero-cost, exact.

**FIX.** The fork must not derive the new handle from the old one: require
`newHandle` (refuse the fork without it), reject a handle that shares a
prefix of ≥ 4 characters with the source handle or its fname, drop the "
(new)" suffix and the avatar copy for a persona that will get a fid, and
assert in `accept-fid3` #1 that `recNew.fname` shares no stem with
`recPub.fname`. State the residual as **A-FID-FORK-NAMING-IS-THE-USER'S**.

---

## 6. HIGH — The live gate publishes a self-drawn graph between the two persona fids, tagged with one shared marker that also lands on the anon account

**WHAT.** `live-fid2.mjs` posts from A and from B with the SAME
`[layers-test <runId>]` suffix, then has B follow A, B like A's cast, B
reply to A's cast, and deletes everything — all inside a minute or two of
the accounts' creation, from accounts that have no other history. Hubs
gossip each `Link`, `Reaction`, `Cast` and `CastRemove`; indexers retain
removed casts; the marker text is searchable. `live-fid4.mjs`'s default
anon text ends in `[layers-test live]`, and the FC pass's own live scripts
used the same `[layers-test <runId>]` family on the throwaway — the anon
account. So the marker family alone clusters A, B and ANON, and the
follow/like/reply graph binds A and B independently of it. The prompt asks
for these actions; the report does not say what they cost.

**EVIDENCE.**
- `scripts/live-fid2.mjs:22` — `MARK = \`[layers-test ${runId}]\``; `:77` — both personas' casts end with `${MARK}`; `:131` follow A as B; `:139` like as B; `:147` — act-as reply as B with `${MARK}`; `:155-161` — deletes, "advisory — hubs and indexers may retain".
- `scripts/live-fid4.mjs:43` — default text `` `anon test ${iso} [layers-test live]` ``.
- `scripts/live-fc3.mjs:45`, `scripts/live-fc4.mjs:44` — the same marker family on the throwaway during the FC pass.

**ATTACK.** Hub or Neynar cast search for `[layers-test` → the set of fids;
the link/reaction graph between A and B within their first minute confirms
the pair; the throwaway's history ties the anon account to the same
operator.

**FIX / ASSUMPTION.** The two live persona fids are burned as personas by
the gate's own recording and must be stated as test furniture
(**A-FID-LIVE-PAIR-IS-FURNITURE**): never reused as real personas. For any
future live run: no shared marker (or a per-fid marker with no common
stem), no follow/like/reply between the root's own fids on the live
network unless the product accepts that link (then **A-FID-SELF-GRAPH**:
"a root that interacts across its own accounts publishes that edge"), and
the anon recorder must not post a text that carries any marker used by a
persona fid. The act-as feature itself is a standing self-graph generator
and its UI should say so at the point of use, like the C7 waiver.

---

## 7. HIGH (HYPOTHESIS) — The signer's KeyRegistry metadata may cluster every Layers fid under one requesting fid; and the live command records a signer that was never registered

**WHAT.** A managed signer lands on chain as `KeyRegistry.Add(fid, key,
metadata)` whose `SignedKeyRequestMetadata` carries `requestFid` and
`requestSigner` — the app that requested the key. Which fid that is for
Neynar-sponsored signers decides the cluster: Neynar's own sponsor fid (a
crowd of every Neynar-sponsored account) or the developer's app fid (a
crowd of exactly the Layers accounts). The FC pass learned Neynar validates
`requestSigner` against "app custody address", which means an app identity
exists on Neynar's side; the throwaway ended up with "an approved signer
anyway", origin unrecorded. Separately, the new command creates a managed
signer, never registers it (no `signed_key` call, no `signer` block in the
register body), ignores any signer the register response reports, and
records the pre-created uuid as the persona's signer. Unless Neynar
auto-approves that uuid as part of the sponsored registration, the recorded
signer cannot sign and every live persona write fails — while the signer
Neynar DID approve exists on the fid, unrecorded by the app.

**EVIDENCE.**
- `notes/reports/REPORT-FC.md:447-460` — Neynar wants "the ABI-encoded SignedKeyRequestMetadata struct (requestFid, requestSigner, signature, deadline)"; "Neynar rejected `Metadata requestSigner does not match app custody address`"; "register without the signer block. Neynar returned an approved signer anyway".
- `scripts/gate1-acquire-fid.mjs` (register section) — "Prefer the signer facts the API reports over what we sent": `reportedSigner = reg.signer || reg.signers[0]` → `signerUuid = reportedSigner.signer_uuid ...`.
- `scripts/fid-acquire.mjs:142-145` — `POST /v2/farcaster/signer` → `signerBody.signer_uuid`; `:147-158` — `registerBody` has NO `signer` field; `:177` — `signer: { kind: "neynar-managed", uuid: signerBody.signer_uuid, ..., derivedRegistered: false }`; the `reg` object is only checked for `success` (`:164`).
- `lib/fc/writes.ts:308` — the live transport posts with `creds.signerUuid` = that recorded uuid.

**ATTACK (network).** `KeyRegistry.keysOf(fid)` for each Layers fid, decode
the metadata, group by `requestFid`. If the group is Layers-only, the
cluster is on chain forever and independent of everything else in this
report.

**VERIFY.** Decode the metadata of the throwaway's approved signer
(3348985) and read its `requestFid`. Then confirm whether the sponsored
`POST /v2/farcaster/user` response carries a signer and whether the
pre-created uuid is approved by it.

**FIX.** Record the signer the register response reports (as the FC-pass
script did); after settle, read `keysOf(fid)` and store the actual key +
decoded `requestFid` in the sealed record; assert `requestFid` is not an
identity unique to this developer, or state **A-FID-SIGNER-REQUESTER**.
Until Call Option A, `derivedRegistered` is false for every live fid and the
posture must say the derived signer is a recovery artefact, not a network
key (see #13).

---

## 8. MED — Two accounts in one run: back-to-back Register / Transfer / Rent / fname events, and both fresh custody addresses queried on one RPC from one IP minutes before they appear on chain

**WHAT.** The command loops over the named personas in one process:
reserve → nonce read → sign → signer → register, then the next persona.
The chain sees two `Transfer`s from Neynar's pre-registration address to two
never-seen custody addresses and two `Rent`s within a couple of minutes;
the fname registry sees two claims; the calldata `deadline` is
`now + 3600` seconds, a wall-clock stamp per signature. Before either
appears on chain, the command reads `IdRegistry.nonces(custody)` for each
address through `OP_RPC_URL` — or viem's default public Optimism RPC when it
is unset — from the user's IP. The RPC operator sees "two addresses that do
not exist yet, asked about by one client, then both registered". The nonce
of a fresh key is 0 by construction; the read buys nothing and costs a
third-party observation.

**EVIDENCE.**
- `scripts/fid-acquire.mjs:108` — `for (const personaId of personas)`; `:104-106` — `createPublicClient({ chain: optimism, transport: http(process.env.OP_RPC_URL) })`; `:133` — `readContract(... "nonces", [custody])`; `:137` — `deadline = now + 3600`; `:149` — the reservation window is ten minutes, so both registrations land inside one short interval.
- `scripts/gate1-acquire-fid.mjs:432-436` — the same pattern for the throwaway ("viem falls back to the chain default").

**ATTACK.** Among Neynar-sponsored registrations in a given five-minute
window on Optimism, pairs of consecutive transfers are few; add the fname
registry timestamps and the pair is unique. The RPC log gives the same pair
with the client IP attached.

**FIX.** Create personas in separate invocations with a randomized delay
(hours, not minutes); refuse a second persona in the same run; do not read
`nonces` for a fresh derived address (assert 0, or read through a private
node / the validator's own RPC, never a public one from the user's host);
state **A-FID-CREATION-TIMING** for what remains (a Neynar-sponsored
registration is timestamped and the crowd is Neynar's volume in that
window).

---

## 9. MED — A fork's audience migration is a public graph event: the new fid's first followers are the old fid's, at the fork time

**WHAT.** Carried grant holders resolve the forward pointer and learn
`movedFid` (fid + fname) — "the account the holder should follow on the
network". They follow it. The network then holds: fid OLD goes quiet at T;
fid NEW is registered at ~T (fixture mints at fork; live pends until the
user's next acquisition, typically soon after); NEW's first k followers are
a subset of OLD's followers, arriving within hours of NEW's creation. The
forward pointer is disclosure-gated in OUR client; the follows it causes
are public links on hubs. Combined with #5 this is exact; alone it is a
strong statistical link.

**EVIDENCE.**
- `app/api/identity/fork/route.ts:55-61, 66` — `movedFid` returned to a carried holder; `:170-181` — the fixture fid is minted inside the fork request, `fidPending` on live.
- `notes/reports/REPORT-FID.md` D-FID-3-FORWARD-POINTER-CARRIES-FID — "the account the holder should follow on the network".
- `SECURITY-POSTURE.md:684-688` A-Z3-FORK-PRESENCE already names the presence version of this for the validator; the network version is not stated anywhere.

**ATTACK.** For each fid whose casting stops, take fids created in the next
30 days; score by Jaccard of early followers with the quiet fid's followers;
the fork's carried set produces an outlier.

**FIX / ASSUMPTION.** State **A-FID-FORK-AUDIENCE-GRAPH**: "a carried holder
who follows the new account publishes the edge; the fork's protection is
against the dropped holder and the operator, not against the follow graph".
Mitigations to consider: do not create the new fid at fork time (a
randomized delay of days between fork and acquisition), tell carried
holders in the resolve UI that following at once links the accounts, and
deliver the forward pointer to holders on a jittered schedule rather than
at first read.

---

## 10. MED — The anon crowd is the validator's tenants who post through the shared account (one, in this topology); the account's public identity is "Layers dev test"; the cast lands minutes after the composer action

**WHAT.** The cryptography makes an anon cast "some member of tree T posted
this in window W" to the validator. To a hub observer the cast is simply a
post by fid `FC_ANON_FID`, whose profile (the FC-pass throwaway) says
"Layers dev test account — automated posts". In a single-tenant deployment
every post on that account is by the one root that uses this validator;
anonymity among one. The relay posts the moment the envelope verifies, so
the network timestamp is the submission time: prove tick (prefetch cadence
~10 min ± 25 %) + jitter (30 s – 15 min) after the user typed it. The text
is the user's own prose. A hub observer who also watches the root's persona
fids sees the anon cast fall inside the same activity session as the
personas' casts, once per window, in the same voice. The shared account's
timeline additionally mixes anon casts with private-persona casts (a
persona without a fid still casts through the throwaway), which our own
client partitions: a cast on that fid without the `anon` badge is a private
persona's.

**EVIDENCE.**
- `validator/zk.js:214` — `FC_ANON_FID ?? FC_TEST_FID`; `:641-652` — relay on receipt, `relayed_at` hour-grained only on the ROW (`:669`), not on the network.
- `lib/zk/anon/queue.ts:106` — `notBefore: now + uniformInt(w.lo, w.hi)`; `lib/zk/config.ts:59-60, 83` — 30 s–15 min jitter, 10-minute prefetch cadence; `lib/zk/gate.ts:158-161` — the composer marks the text wanted "for the next prefetch tick".
- `scripts/gate1-acquire-fid.mjs:127-128` — the anon account's public profile.
- `lib/fc/writes.ts:312-314` and `notes/reports/REPORT-FID.md` D-FID-1-WRITE-DOOR-OWN / D-FID-3-NO-FID-CASTS-SHARED — fid-less and private personas cast through the same shared account; `components/CastCard.tsx:516-519` — the `anon` badge only on relayed anon casts.
- `SECURITY-POSTURE.md:387-404` (§8) — the single-process topology.

**ATTACK.** Session correlation: for each anon cast at T, list persona fids
with a cast in [T − 30 min, T + 5 min]; over N windows the intersection
converges on the root's personas. Stylometry on the text does the rest.

**FIX / ASSUMPTION.** State **A-FID-ANON-CROWD** ("the anonymity set of an
anon cast on the network is the set of roots posting through this
validator's shared account; in the demo topology that is one") and
**A-FID-ANON-TIMING** (the relay time is the jittered submission time;
session-level correlation with the root's persona activity is not
defended). Mitigations: relay on a batch schedule (e.g. at fixed hourly
boundaries, all accepted anon casts of the hour in random order) instead of
on receipt; a dedicated anon account whose profile does not name the
operator (Call Option B) — created and signed for by a credential that is
not the personas' (finding #3), or the "dedicated" account is just another
member of the same Neynar cluster.

---

## 11. MED (operator angle, stated because it converts every network link into a root link) — The plain persona → fid map is written as ONE device-signed document holding every persona of the root

**WHAT.** `personaFidMap` is flushed as a single `{ personaId → {fid,
fname} }` document for all of this device's personas, under the signed
envelope whose `x-layers-device` is a device delegated by the root's
device-auth anchor. The validator therefore holds, in plaintext, "device D
(root R) owns personas P1, P2 with fids F1, F2" — the persona → root
grouping that migration 006 removed, reintroduced by D-FID-1-PLAIN-MAP as
"a public persona's own public account is not a secret". The account is
not the secret; the GROUPING is. `accept-fid3` #3 scans for a plaintext row
relating the new fid to the old persona and passes, because the relation is
the document's key set, not a row's text.

**EVIDENCE.**
- `lib/fc/personaFid.ts:76-79` — `for (const r of doc.items) map[r.personaId] = {...}; await flush(MAP_NS, map)`.
- `lib/adapters/mock/persist.ts:257-267` — `flush` PUTs `{ entries }` with `envelopeHeaders(ns, ...)` under `REQUIRE_SIG`.
- `validator/server.js:320-350` — `checkEnvelope`: `x-layers-device`, the device's delegation verified against the root anchor, `envelope_counters(device_id, namespace, counter)`.
- `scripts/accept-fid3.mjs:113-126` — the scan is per row (`text.includes(...)`).
- `SECURITY-POSTURE.md:424-437` (§10) — why persona → root must not exist on the validator.

**FIX.** Write the map as per-persona documents on separate, jittered
flushes (the queue's own discipline), or — since only this client renders
fid → persona and it holds the sealed record — drop the plain map entirely
and resolve from the vault. Revisit D-FID-1-PLAIN-MAP; the phrase "which
ROOT holds the persona ... never leaves the vault" is not true of the
envelope that carries the map.

---

## 12. MED — The two-account limit and the $10 cap are cooperative (the script's), resume is advertised but not built, spend is recorded after the billable call, and the receipt is never checked against the chain

**WHAT.** The count cap is checked by the script against the app's records
and by `recordLiveFid` against the vault — after the account exists. The
records can be cleared by the rig action `forget` (dev hooks), and dev hooks
must be ON for the live acquisition to work at all. The $ cap is checked
against a ledger the script itself writes AFTER `POST /v2/farcaster/user`
succeeds, with an estimate (`0.9`) rather than the billed figure; a crash
between register and `recordFidSpend` leaves real spend unrecorded. The
abort messages tell the user to "re-run with FID_RESUME_FID=<fid>"; no code
reads that variable, so a re-run after a failed `recordLiveFid` reserves
and registers a NEW fid: double creation, double spend, and an orphaned
real account owned by a derived key. `recordLiveFid` compares the receipt's
custody address to the derived one but never asks the chain who owns the
fid, and `origin: "layers-fid-pass"` is a string the caller supplies.

**EVIDENCE.**
- `scripts/fid-acquire.mjs:23` — "the app must be up with ZK_DEV_HOOKS=true"; `:87-89` — the count check reads `view.records`; `:165, 184` — the two `FID_RESUME_FID` messages; grep shows no other occurrence in `scripts/`, `lib/`, `app/`.
- `scripts/fid-acquire.mjs:160-168` — register, then `recordFidSpend(... amount: sheet estimate ...)`; `:121, 144` — the credit items are recorded as `amount: 0`.
- `app/api/fc/persona/route.ts:85, 104-107` — `forget` behind `devHooksOn()`; `lib/fc/personaFid.ts:112-115`.
- `lib/fc/acquire.ts:123-137` — `recordLiveFid`: origin string, `live.length >= 2`, derived-key equality, no chain read; `:124` the origin check.
- `lib/x/spend.ts:127-136` — `fidSpentLive` sums live entries; `assertFidSpendAllowed` at record time.

**ATTACK (from the network side).** None directly — but a second run after
a mid-flight failure creates a third fid the ledger does not know, which
the network sees and the cap does not.

**FIX.** Ledger-before-network for creation, as the write path already
does: open a pending `fid_create` entry (with the estimate) BEFORE the
register call, settle after; implement resume (look the reserved fid up via
`user/bulk?fids=` and, if it exists with the derived custody address,
record it instead of registering); verify the receipt against
`IdRegistry.custodyOf(fid)` before sealing; make `forget` refuse live
records unless a second explicit flag is set; state
**A-FID-CAP-IS-THE-SCRIPT'S** for what remains (the exact ETH figure lives
on dev.neynar.com).

---

## 13. MED — `neynar.score` on live proves "control of the fid" with a key the fid never had; the vouch is the app vouching for itself

**WHAT.** D-FID-0-SIGNER-VOUCH says the live adapter vouches for a fid's
signer "only when THIS client registered that signer for one of its own
persona fids". No signer is ever registered by this client on live: the
record says `derivedRegistered: false`, self-custody live is refused, and
the managed signer is Neynar's key, not the derived one. The issuer checks a
signature under the DERIVED key against the app's own map — a key with no
relation to the fid on the KeyRegistry. Control of the fid is asserted by
the co-hosted issuer reading the co-hosted map. It is not proven on the
network.

**EVIDENCE.**
- `lib/attest/fid/live.ts:28-36` — `signerPublicKey(fid)` → `ownFidSignerPublicKey(fid)` (the vault record's `derivedPubHex`).
- `lib/fc/personaFid.ts:122-128`; `scripts/fid-acquire.mjs:177` — `derivedRegistered: false`; `lib/fc/custody/selfCustody.ts:17-19` — live refused.
- `lib/attest/issuers/neynar.ts:81-84` — `adapter.signerPublicKey(fid)` then `verifyCanonical(challengeSig, challenge, pub)`.

**FIX.** Read `KeyRegistry.keysOf(fid)` (or Neynar's `signers` for the fid)
and vouch only for a key that is active on the fid; until then rename the
assumption: **A-FID-SIGNER-LOOKUP** should say "control is asserted by this
process's own record; no network key is checked". Also the retention rule
"one fid, one root" (`neynar.ts:85-87`) is only as strong as that vouch.

---

## 14. LOW — The live recordings (`research/live-fid2.json`, `research/live-fid4.json`) are not gitignored and would commit the linkage table

**WHAT.** The recorders write fids, fnames, cast hashes, the act-as reply's
parent, and the anon cast's hash + fid + time into `research/`. `.gitignore`
excludes `shots/` images only; `research/live-att1.json` is already tracked.
If the repository is ever public, the project itself publishes "persona A =
fid F1, persona B = fid F2, B replied to A, anon cast H on fid ANON at T".

**EVIDENCE.** `scripts/live-fid2.mjs:69-70, 79, 149`; `scripts/live-fid4.mjs:61-62`; `.gitignore:29-31`; `git ls-files research` → `research/live-att1.json`.

**FIX.** Ignore `research/live-*.json` (or write them under `.keystore/`),
or redact fids/hashes to prefixes.

---

## 15. LOW — One env value for every persona in a run: `FID_FNAME_OVERRIDE`, `FID_DISPLAY_NAME`, `FID_BIO`

**WHAT.** All three are read once and applied inside the persona loop, so
two personas created together get the same display name and bio if the
user sets them, and a fname override makes the second persona abort after
its availability credit is spent.

**EVIDENCE.** `scripts/fid-acquire.mjs:108, 117-120, 157`.

**FIX.** Per-persona values (`FID_PROFILE_<personaId>_*` or a JSON map), or
one persona per invocation (which #8 wants anyway).

---

## 16. INFO — A-Z2-ATTRIBUTION-ACCOUNT-JOIN is no longer moot

**WHAT.** The posture marks the `fcAttribution` (cast → persona) ⋈
`fcWrites.fid` (cast → fid) join as "moot in v0 (one shared test FID)".
Under per-persona fids both tables carry the persona → fid → cast join in
the operator's plaintext, beside the plain map (#11). Not a network
finding; the assumption line needs updating.

**EVIDENCE.** `lib/fc/writes.ts:445, 464, 491, 517` (`fid:` on every ledger entry); `app/api/fc/write/route.ts:118`; `SECURITY-POSTURE.md:689-695`.

---

## 17. INFO (HYPOTHESIS) — Storage rent and Call Option C

**WHAT.** Each fid carries storage rent paid at registration by the
sponsor's path and renewed yearly. If Call Option C renews every persona's
storage from one wallet in one batch, `StorageRegistry.Rent(payer, fid,
units)` records a developer-unique payer beside every Layers fid at the
same block — a yearly re-publication of the cluster. Not built yet; flag it
before it is.

**FIX.** Renewals per fid, from the fid's own custody address (funded
through a non-attributable path) or through Neynar's sponsor path, never a
batch from one wallet; state **A-FID-RENT-PAYER**.

---

## What I checked and found sound

- The anon-post scope is `onePerHuman` with the window qualifier on both sides and no persona in the scope (`lib/zk/scopes.ts:110-129, 182-193`; `validator/zk.js:202, 231-234, 274`); the message binds `cast:<sha256(text)>` and the validator recomputes the hash from the payload, refuses any other payload key, refuses `anon` on a non-anon claim and a persona on an anon claim (`lib/zk/prove.ts:90-93, 206-208`; `validator/zk.js:565-576`); `zk_anon_casts` has no persona, root, nullifier or IP column (`validator/migrations.js:468-477`); the network write precedes the nullifier insert and the two are one transaction (`validator/zk.js:629-676`); the public list exposes only hash, text, epoch, hour, fid (`validator/zk.js:908-912`).
- The anon channel: constant-size padded body, PoW, no session or device header (`lib/zk/anon/submit.ts:33-39, 56`); jittered `notBefore`, one item per drain tick chosen at random, `sent` persisted on its own delay (`lib/zk/anon/queue.ts:106, 228-236, 251-299`).
- The `layers:persona:` marker is appended only to LOCAL casts and stripped at render (`app/api/actions/act-as/route.ts:107, 176-193`; `app/api/actions/cast/route.ts:60`; `lib/policy.ts:16, 75`); no network write path includes it.
- The custody key never leaves the keystore; the typed data is pinned to a `Transfer` to the persona's own address and a `SignedKeyRequest` for its own derived key, with bounded deadlines (`lib/fc/custodySign.ts:55-94`; `lib/identity/keystore.ts:220-225`).
- `fc-signer/<nonce>` and `fc-custody/<nonce>` are separate HKDF branches off the seed with domain-separated info strings, and both private seeds are leak-grep needles (`lib/crypto/kdf.ts:66-79`; `lib/identity/keystore.ts:336-339`); two custody addresses of one root are unlinkable given a uniform seed.
- The write door refuses a fid that is not in its own records or the throwaway, a signer other than the recorded one, and any foreign `NEYNAR_SIGNER_UUID` in the environment on every write (`lib/fc/writes.ts:111-147, 338-345`); a delete goes out under the attributed persona's fid (`app/api/fc/write/route.ts:147-149`).
- The validator holds no persona → account route or column (`validator/server.js:150-153`); the full fid record is one padded sealed vault value (`lib/fc/personaFid.ts:72-75`).
- Blocks and mutes stay client-side; nothing about them reaches the network (D-FID-3-BLOCKS-CLIENT-SIDE; the act-as and write routes contain no block write).
- The anon composer is disabled for private personas and replies, and anon posting refuses without the zk binding (`components/Composer.tsx:172, 248`; `lib/zk/gate.ts:143`).
- `neynar.score` never signs the exact score; buckets only (`lib/attest/issuers/neynar.ts:32-38, 110-112`).

## Top five, in one line each

1. #1 — a live fid for a seeded persona is owned by a key derived from a public constant: anyone can take the account.
2. #2 — registrant/funder are literals the script wrote; the chain's sender, payer and recovery address are unread and may be developer-unique (one lookup on fid 3348985 decides).
3. #3 — one Neynar API key creates, signs for and relays everything including the anon cast: Neynar links all of it; the posture must say so.
4. #4 + #5 — the network profiles say "a Layers persona" / "layers-…", and a fork is named `<old>-2` with the old avatar: public, permanent, free links.
5. #6 — the live gate's own follow/like/reply loop and the shared `[layers-test …]` marker bind the two persona fids and the anon account on hubs; the pair is burned and must be stated as furniture.
