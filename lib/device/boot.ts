// BROWSER KEYSTORE PASS Gate 1 stage 3 / Gate 2 — booting the browser device (docs/custody-model.md D-CU-0-2, D-CU-0-6).
//
//   1. storage: the in-memory backend, restored from IndexedDB when the visitor kept an identity here;
//   2. the root: the keystore mints a 32-byte seed with getRandomValues if none was restored (memory only);
//   3. the device key and the envelope: registered with the validator under this root's own device-auth anchor —
//      the first thing the validator learns about the visitor, and the only thing: a public key;
//   4. a root row for the zk registration, with a fid of the device's own (see pseudoFid) and a signer id that is
//      the anchor, recorded in the device's vault roster so rootForFid() resolves it;
//   5. the first personas, minted in the keystore, registered into the store's rendering maps, and the sealed
//      roster synced so the same root unlocked elsewhere restores the same personas;
//   6. the seeded viewer and the seeded self rewritten into THIS device's viewer, so the 68 routes that ask "who is
//      the active persona" get the visitor, never the rig's fixture identity (rig-only list in the custody model).
//
// Gate 2 splits this into openStorage + bootIdentity so that installing a different seed (unlock, import) can
// re-run the identity half under the new root (reloadIdentity). Nothing here is the rig's.
//
// PUBLIC GO-LIVE (public live mode, lib/platform/publicLive.ts: the device env says PUBLIC_LIVE=on):
//   - step 5 mints NOTHING. A first visit has no personas until the visitor makes one (the guided first run at
//     /welcome, Settings › Account, or the switcher). Every surface that needs one says so (NoPersonaYet, the composer's
//     "Make a persona to post"). Outside live mode the pair "You" / "You, privately" is minted exactly as before
//     (accept-prodlive check 5 expects it).
//   - the device runs the EMPTY WORLD (lib/world-flag.ts): the store's viewer is the empty world's (its personas and
//     acting persona are live reads of the keystore, getters that cannot be assigned), so step 6 writes only the
//     viewer's plain fields instead of calling setDeviceViewer.
//   - the acting persona is the first persona that is NOT the read-only public self (Sign in with Farcaster runs
//     before the first persona in the guided flow, so the public self is often the keystore's first entry): it is
//     named in the device's cookie jar at boot, so a reload never leaves the visitor acting as an account that cannot
//     post.
import { openBrowserStorage, type BrowserStorage } from "@/lib/platform/storage.browser";
import { isPublicLive } from "@/lib/platform/publicLive";

export interface DeviceInfo {
  anchor: string;
  rootId: string;
  fid: number;
  personaIds: string[];
  activePersonaId: string;
  restored: boolean;
  persistent: boolean;
}

/**
 * D-CU-3-A-ROOT-WITHOUT-A-FID: the validator's roots table needs an integer fid, and an ephemeral visitor has no
 * Farcaster identity. The device names a NEGATIVE fid derived from its anchor — a value no network ever issues, so
 * "this root has no network identity" is legible in the row itself, and a later binding (the multi-FID flow) is a
 * re-registration, not a collision.
 */
export function pseudoFid(anchorPubHex: string): number {
  return -((parseInt(anchorPubHex.slice(0, 8), 16) % 2147483646) + 1);
}

let storageRef: BrowserStorage | null = null;
let lastInfo: DeviceInfo | null = null;

export function currentInfo(): DeviceInfo {
  if (!lastInfo) throw new Error("device not booted");
  return lastInfo;
}

export async function bootDevice(): Promise<{ info: DeviceInfo; storage: BrowserStorage }> {
  storageRef = await openBrowserStorage();
  const info = await bootIdentity();
  return { info, storage: storageRef };
}

/** the identity half of boot: runs on first boot and again after the device installs a different seed */
export async function bootIdentity(): Promise<DeviceInfo> {
  const storage = storageRef;
  if (!storage) throw new Error("device: storage not open");
  const ks = await import("@/lib/identity/keystore");
  const dk = await import("@/lib/identity/deviceKeys");
  const persist = await import("@/lib/adapters/mock/persist");
  const store = await import("@/lib/adapters/mock/store");
  const data = await import("@/lib/data");
  const roster = await import("@/lib/identity/rootRoster");
  const validator = await import("@/lib/validator");
  const { adapters } = await import("@/lib/adapters/registry");

  // 2 + 3: the root (minted if absent), the device key, the envelope registration (anchor + delegation)
  const anchor = ks.deviceAuthPublicKey();
  dk.deviceIdentity();
  await persist.loadAll(); // the first signed read enrols this device under its own anchor

  // 4: the root row + the device's roster
  const fid = pseudoFid(anchor);
  let rootId = await roster.rootForFid(fid);
  if (!rootId) {
    rootId = await validator.registerRoot(fid, "device:" + anchor);
    if (!rootId) throw new Error("device boot: the validator refused this root");
    await roster.recordRoot(rootId, fid);
  }

  // 6 (first half): BEFORE anything initialises the store's runtime state, the seeded viewer's follows, likes and
  // bookmarks are emptied — state() copies them at first touch, and the first touch is the hydrate below
  // PUBLIC GO-LIVE: in live mode the viewer is the empty world's (getters for personas / activePersonaId): only its
  // plain fields are written
  const live = isPublicLive();
  const setViewer = (v: { fid: number; rootId: string; personas: string[]; activePersonaId: string }) => {
    if (!live) return store.setDeviceViewer(v);
    const sv = store.SEED_VIEWER as unknown as Record<string, unknown>;
    sv.fid = v.fid;
    sv.rootId = v.rootId;
    sv.followingPersonaIds = [];
    sv.likedPostHashes = [];
    sv.bookmarkedPostHashes = [];
  };
  setViewer({ fid, rootId, personas: [], activePersonaId: "" });

  // The store hydrates from the validator HERE, not on the first adapter call: the device answers requests the
  // moment the fetch host installs, and the private-post chokepoint reads state() without going through an adapter.
  await store.hydrate();

  // 5: the first personas — one public, one private, the pair every surface expects a viewer to have
  // PUBLIC GO-LIVE: not in live mode — the visitor makes their own first persona
  if (!live && ks.listPersonas().length === 0) {
    const short = anchor.slice(0, 6);
    const mint = async (name: string, handle: string, kind: "public" | "private") => {
      const created = await adapters.identity.createPersona({
        name,
        handle,
        kind,
        avatarUrl: "https://api.dicebear.com/7.x/notionists/svg?seed=" + handle,
        bio: "",
        cluster: null,
        forkedFrom: null,
      });
      await roster.recordPersona(rootId, created.id, {
        id: created.id,
        name: created.name,
        handle: created.handle,
        avatarUrl: created.avatarUrl,
        bio: created.bio,
        createdAt: Date.now(),
      });
      return created;
    };
    await mint("You", "you_" + short, "public");
    await mint("You, privately", "private_" + short, "private");
    // the sealed identity roster is what an unlock on ANOTHER device restores personas from (Gate 2)
    const { syncRoster } = await import("@/lib/identity/roster");
    await syncRoster();
  }
  const personas = ks.listPersonas();
  for (const p of personas) {
    store.personaById.set(p.id, {
      id: p.id,
      rootId,
      name: p.name,
      handle: p.handle,
      avatarUrl: p.avatarUrl ?? "",
      bio: p.bio ?? "",
      cluster: p.cluster ?? "",
      tier: 1,
      demoTags: ["device"],
      // PERSONA LAUNCH P1 (SIWF): a restored public self keeps its read-only mark (lib/device/shims/session.ts carries
      // it for a persona minted after boot)
      ...(p.publicSelf === true ? { publicSelf: true } : {}),
    } as unknown as NonNullable<ReturnType<typeof store.personaById.get>>);
    store.personaByHandle.set(p.handle, store.personaById.get(p.id)!);
  }

  // 5b (PERSONA LAUNCH P1, SIWF; D-SIWF-2 UNIFORM PRESENCE): every root holds ONE padded accountLinks record, signed in
  // or not, so the namespace's existence and size on the validator carry no bit. A root that has never sealed it (a
  // fresh mint, or an identity from before this pass) seals the EMPTY record here; a present one is left alone. A
  // failure must not cost the visitor their identity: it is said once (no value in the line) and the next boot or
  // sign-in seals it.
  try {
    const { ensureAccountLinksNamespace } = await import("@/lib/fc/siwf/links");
    await ensureAccountLinksNamespace();
  } catch (e) {
    console.warn("[siwf] the linked-accounts record is not sealed yet (" + ((e as Error)?.name ?? "Error") + "); the next boot seals it");
  }
  // 5c (POST AS YOU, the same UNIFORM PRESENCE): every root holds ONE padded rootSigner record, posting key or not, so
  // the namespace's existence and size on the validator carry no bit. Same failure rule as 5b.
  try {
    const { ensureRootSignerNamespace } = await import("@/lib/fc/rootSigner/store");
    await ensureRootSignerNamespace();
  } catch (e) {
    console.warn("[post-as-you] the posting-key record is not sealed yet (" + ((e as Error)?.name ?? "Error") + "); the next boot seals it");
  }
  // 5d (NOTIFICATIONS FROM FARCASTER, the same UNIFORM PRESENCE): every root holds ONE padded fcNotifications record (when
  // its notifications were last seen), used or not, so the namespace's existence and size carry no bit. Same failure rule.
  try {
    const { ensureNotifSeenNamespace } = await import("@/lib/fc/hubRead/seen");
    await ensureNotifSeenNamespace();
  } catch (e) {
    console.warn("[notifications] the seen record is not sealed yet (" + ((e as Error)?.name ?? "Error") + "); the next boot seals it");
  }
  // 5e (ADS, PHASE 1, the same UNIFORM PRESENCE): every root holds ONE padded adHides record (the ads and advertisers each
  // of its identities hid), used or not, so the namespace's existence and size carry no bit. Same failure rule.
  try {
    const { ensureAdHidesNamespace } = await import("@/lib/ads/hides");
    await ensureAdHidesNamespace();
  } catch (e) {
    console.warn("[ads] the hidden-ads record is not sealed yet (" + ((e as Error)?.name ?? "Error") + "); the next boot seals it");
  }

  // 6: the device's viewer replaces the seeded one
  // PUBLIC GO-LIVE: in live mode there may be no persona yet (and the first may be the read-only public self): the
  // acting persona is the first one that can post, or none ("" — the pages say so)
  const first = live ? personas.find((p) => p.publicSelf !== true) : personas[0];
  setViewer({ fid, rootId, personas: personas.map((p) => p.id), activePersonaId: first?.id ?? "" });
  data.setSelfForDevice({ fid, username: first?.handle ?? "", displayName: first?.name ?? "", pfpUrl: first?.avatarUrl ?? "", bio: first?.bio ?? "" } as never);
  if (live && first) {
    // the device's jar is memory only, so after a reload (or an unlock) no persona would be named. Named here unless this
    // boot already has one, or the tab chose to act as itself (lib/device/actingRoot.ts: then the cookie stays empty for
    // this tab's life; a reload starts over on the first persona)
    const { nameDefaultActingPersona } = await import("@/lib/device/actingRoot");
    nameDefaultActingPersona(personas);
  }

  lastInfo = {
    anchor,
    rootId,
    fid,
    personaIds: personas.map((p) => p.id),
    activePersonaId: first?.id ?? "",
    restored: storage.restored,
    persistent: storage.persistent,
  };
  return lastInfo;
}

/**
 * Gate 2: the device installed a different seed (an unlock, an import). Forget every cache that belongs to the
 * previous root — the keystore copy, the envelope bootstrap, the roster, the store — and boot the identity again.
 */
export async function reloadIdentity(): Promise<DeviceInfo> {
  const ks = await import("@/lib/identity/keystore");
  ks.forgetCachedKeystore();
  const persist = await import("@/lib/adapters/mock/persist");
  persist.resetEnvelopeBootstrap();
  const roster = await import("@/lib/identity/rootRoster");
  roster.resetRootRoster();
  const store = await import("@/lib/adapters/mock/store");
  await store.reloadForDevice();
  // GATE 5 (attack-post-3 F-2): EVERY sealed record cached in this process belongs to the
  // root that was unlocked, and this function exists to forget that root. Leaving them
  // behind ran the new root on the old root's compartment flag, delivery tiers, reading
  // progress and recycle bin — and the first write sealed the OLD root's document into the
  // NEW root's vault, which is the one direction of this mistake that is not recoverable.
  //
  // The sealed caches are listed here and in /api/dev resetSeed, and the two lists have to
  // stay in step: a sealed namespace added without a reset is this bug again.
  const { resetChromeCache } = await import("@/lib/identity/chrome");
  resetChromeCache();
  // PERSONA LAUNCH P1 (SIWF): the sealed accountLinks record and any sign-in in progress belong to the previous root.
  // Leaving the link cached would show root A's Farcaster account on root B, and the next seal would write it there.
  const { resetAccountLinksCache } = await import("@/lib/fc/siwf/links");
  resetAccountLinksCache();
  const { resetSiwf } = await import("@/lib/fc/siwf/flow");
  resetSiwf();
  // SIGN IN WITH X: a request in flight in this tab was started for the previous root; it must never land on this one
  const { resetXsi } = await import("@/lib/x/signin/flow");
  resetXsi();
  // POST AS YOU: the sealed posting key and this tab's approval memory belong to the previous root (leaving them would
  // post as root A's account from root B, and the next seal would write A's key into B's vault)
  const { resetRootSignerCache } = await import("@/lib/fc/rootSigner/store");
  resetRootSignerCache();
  const { resetRootPost } = await import("@/lib/fc/rootSigner/flow");
  resetRootPost();
  // FOLLOWING FROM THE HUB: the previous root's graph, casts and profiles (tab memory) go with it (its notifications too)
  (await import("@/lib/fc/hubRead/read")).resetHubReads();
  // NOTIFICATIONS FROM FARCASTER: the sealed seen record belongs to the previous root (the next seal would write it there)
  (await import("@/lib/fc/hubRead/seen")).resetNotifSeenCache();
  // ADS, PHASE 1: the sealed hidden-ads record belongs to the previous root too
  (await import("@/lib/ads/hides")).resetAdHidesCache();
  // PERSONA LAUNCH P2 (Bring your X, byx's line): the chunked X documents are sealed caches of the previous root too
  const { resetXDocsCache } = await import("@/lib/vault/chunkedDoc");
  resetXDocsCache();
  const { resetDeliveryCache } = await import("@/lib/delivery/tiers");
  resetDeliveryCache();
  const { resetReadwiseStateCache } = await import("@/lib/readwise/state");
  resetReadwiseStateCache();
  const { resetZonesCache } = await import("@/lib/zones/store");
  resetZonesCache();
  const { resetPortsCache } = await import("@/lib/x/porting");
  resetPortsCache();
  const { resetInfluenceCache } = await import("@/lib/influence/allowance");
  resetInfluenceCache();
  const { resetAttestationVaultCache } = await import("@/lib/attest/vault");
  resetAttestationVaultCache();
  const { resetUnifiedIndex } = await import("@/lib/search/unified");
  resetUnifiedIndex();
  const { resetActable } = await import("@/lib/activePersona");
  resetActable();
  const { resetAnonAttributionCache } = await import("@/lib/zk/anonAttribution");
  resetAnonAttributionCache();
  const { resetSessionHandlesCache } = await import("@/lib/identity/sessionHandles");
  resetSessionHandlesCache();
  // GATE 5 (attack-post-3 F-2, residual): the sealed persona-to-fid record and the device
  // roster are caches too. Under the old reload, root B ran on root A's fid map and the
  // first write sealed root A's fids, custody addresses and signer uuids into root B's
  // vault. The sealed-pin file is per-root as well.
  const { forgetPersonaFids } = await import("@/lib/fc/personaFid");
  forgetPersonaFids();
  const { forgetSealedPins } = await import("@/lib/vault/sealedPins");
  forgetSealedPins();
  const { deviceJar } = await import("@/lib/device/jar");
  deviceJar.clear();
  // PERSONA LAUNCH P4 (rings): the sealed "rings" document, the hydrate's copy of it, the derived inbox keys, what was
  // received and the reveal map are the previous root's — BEFORE bootIdentity, whose hydrate records the new root's copy
  const { resetRingsCaches } = await import("@/lib/rings/tick");
  await resetRingsCaches();
  // PERSONA LAUNCH P6 (the launch track's lines): the launch confirmations, the fixture chain's cache, the thin relay
  (await import("@/lib/launch/confirm")).resetLaunchCaches();
  (await import("@/lib/fc/chain/fixture")).resetChainFixtureCache();
  (await import("@/lib/fc/thinRelay")).resetThinRelay();
  // PERSONA LAUNCH P5 (the reach track's line): the reach buckets this root holds
  (await import("@/lib/reach/held")).resetReachCaches();
  return bootIdentity();
}
