// BROWSER KEYSTORE PASS Gate 1 stage 3 / Gate 2 / Gate 3 / Gate 5 — the device bundle's entry (built by
// scripts/build-device.mjs into public/device/device.js). Boots the device, then installs the fetch host;
// `window.__layersDevice.ready` resolves with what the device knows about itself (public values only: anchor, root
// id, persona ids). The custody, linking and root-link surfaces are the visitor's own. The DEBUG members the suites
// grep with — key material, the opened link payload — exist only when the page declared LAYERS_DEVICE_DEBUG=1 in
// the device environment (attack-custody-1 #7); a production page never does. PERSONA LAUNCH P4: `rings` — this
// device's private addresses and what its ticks received (the needles aggregate the ring secrets too).
// PERSONA LAUNCH P7: `prover` — this tab's Web Worker prover (lib/zk/transport/browser.ts). Its members are DEBUG ONLY:
// the job log (which op ran, where it ran, how long it took), a fixed CPU bench and an artifacts load run IN the worker
// (the phone measurement uses them), a sample live proof over a member list the suite names (the proof is public; the
// secret never leaves the tab), and the zk secret needles (master, secret scalar) for the leak grep. A production page
// gets inert stand-ins.
// PERSONA LAUNCH P7 review fixes, for EVERY page (not debug): L1 — the prover (and, live, its proving files) is loaded at
// boot in every tab, whether or not it will prove, so no proof ever makes a request (lib/zk/transport/browser.ts
// startProverPreload); `prover.preload` (DEBUG) reports that load. UXH-3 — while the tab holds an anonymous post that
// closing it would lose or delay, the browser asks before the tab closes (beforeunload).
import { ROUTES, SERVER_ONLY_ROUTES } from "@/lib/device/routes.generated";
import { bootDevice, type DeviceInfo } from "@/lib/device/boot";
import { installDeviceHost } from "@/lib/device/host";
import * as custody from "@/lib/device/custody";
import * as linking from "@/lib/device/linking";
import * as rootlink from "@/lib/device/rootlink";
import * as ringsInbox from "@/lib/rings/inbox";
import * as ringsReceived from "@/lib/rings/received";
import { announceDevice, markDeviceFailed } from "@/lib/device/bootState";

const DEBUG = process.env.LAYERS_DEVICE_DEBUG === "1";

interface DeviceApi {
  ready: Promise<DeviceInfo>;
  routes: number;
  /** keep this identity on this device (IndexedDB, wrapped under a non-extractable key) */
  persist: () => Promise<void>;
  /** PROD-LIVE: true once this identity is mirrored to IndexedDB (persist() or a save turned it on) — read live, so
   *  the chrome's unsaved-identity nudge never trusts a stale `info.persistent` */
  isPersistent: () => boolean;
  /** forget this identity on this device */
  wipe: () => Promise<void>;
  /** the storage paths the device holds — names only */
  paths: () => string[];
  /** DEBUG ONLY (LAYERS_DEVICE_DEBUG=1): every piece of key material this device holds, for the leak grep */
  needles: () => Promise<string[]>;
  /** DEBUG ONLY: the seed and the device-auth key — the two things that must never travel; empty on a linked device */
  rootOnly: () => Promise<string[]>;
  info: DeviceInfo | null;
  custody: {
    status: typeof custody.status;
    savePasskey: typeof custody.savePasskey;
    unlockPasskey: typeof custody.unlockPasskey;
    saveProvider: typeof custody.saveProvider;
    unlockProvider: typeof custody.unlockProvider;
    exportPhrase: typeof custody.exportPhrase;
    importPhrase: typeof custody.importPhrase;
    /** DEBUG ONLY: the KEKs, PRF outputs and provider exports this device used */
    secrets: typeof custody.secretsForLeakGrep;
  };
  /** Gate 3 — device linking: a new device offers and shows a code + fingerprint; the device holding the root
   *  enters both and approves; the new device accepts */
  linking: {
    offer: typeof linking.offer;
    approve: typeof linking.approve;
    accept: typeof linking.accept;
    pendingCode: typeof linking.pendingCode;
    pendingFingerprint: typeof linking.pendingFingerprint;
    /** DEBUG ONLY: the opened link material as text, for the payload grep */
    lastPayload: typeof linking.lastPayload;
  };
  /** Gate 3 — root linking: a co-signed pairwise grant between two roots, link not merge */
  rootlink: {
    propose: typeof rootlink.propose;
    proposalFingerprint: typeof rootlink.proposalFingerprint;
    answer: typeof rootlink.answer;
    pendingFingerprint: typeof rootlink.pendingFingerprint;
    complete: typeof rootlink.complete;
    finish: typeof rootlink.finish;
    linked: typeof rootlink.linked;
    unlink: typeof rootlink.unlink;
  };
  /** PERSONA LAUNCH P7 — the Web Worker prover; every member DEBUG ONLY (LAYERS_DEVICE_DEBUG=1) */
  prover: {
    /** the jobs this tab's prover ran: op, outcome, timings, the worker scope the answer came from */
    log: () => Promise<unknown[]>;
    /** one job in a fresh worker: "bench" (a fixed CPU workload) or "artifacts" (fetch + pin-check the proving files) */
    run: (op: "bench" | "artifacts", opts?: { rounds?: number }) => Promise<unknown>;
    /** a LIVE proof by this tab's own identity over `members` (this root's commitment is added), for the measurement:
     *  answers the public envelope and the worker's timings */
    liveSample: (opts: { members: string[]; scope: string; message: string }) => Promise<unknown>;
    /** this root's zk secret material in every encoding the leak grep hunts (master hex, secret scalar dec/hex, …) */
    needles: () => Promise<string[]>;
    /** L1: what the boot-time load holds — sizes and times only (the phone measurement's fetch time lives here now) */
    preload: () => Promise<unknown>;
  };
  /** PERSONA LAUNCH P4 — rings, the member side: this device's private addresses (sealed in the "rings" namespace, keys
   *  off the seed) and what it received on its ticks (memory only). The /device page's "Your private address for rings"
   *  and "Rings you are in". DEBUG members (the rig's revoke check and forced tick) exist only under LAYERS_DEVICE_DEBUG=1. */
  rings: {
    createAddress: typeof ringsInbox.createAddress;
    listAddresses: typeof ringsInbox.listAddresses;
    forgetAddress: typeof ringsInbox.forgetAddress;
    /** UX-R4: "Use it again" for a forgotten (hidden, never deleted) address, and the list of them */
    restoreAddress: typeof ringsInbox.restoreAddress;
    listForgottenAddresses: typeof ringsInbox.listForgottenAddresses;
    status: () => Promise<ringsReceived.ReceivedStatus & { addresses: number; lastTick: unknown }>;
    /** DEBUG ONLY: every note key this device can use (each chain stretch expanded; the revoke check captures them) */
    debugKeys: () => Promise<{ keyHex: string; handle: string }[]>;
    /** DEBUG ONLY: try keys on a note (the revoke check: captured old keys must not open a post made after the revoke) */
    tryOpen: (noteHex: string, castHash: string, keys: string[]) => Promise<string | null>;
    /** DEBUG ONLY: run the rings part of a tick now */
    tick: (mode?: "fixture" | "live") => Promise<unknown>;
  };
}

const notBooted = async (): Promise<never> => {
  throw new Error("device not booted");
};
const noDebug = async (): Promise<string[]> => [];

const api: DeviceApi = {
  ready: Promise.reject(new Error("device not booted")),
  routes: ROUTES.length,
  persist: notBooted,
  isPersistent: () => false,
  wipe: notBooted,
  paths: () => [],
  needles: noDebug,
  rootOnly: noDebug,
  info: null,
  custody: {
    status: custody.status,
    savePasskey: custody.savePasskey,
    unlockPasskey: custody.unlockPasskey,
    saveProvider: custody.saveProvider,
    unlockProvider: custody.unlockProvider,
    exportPhrase: custody.exportPhrase,
    importPhrase: custody.importPhrase,
    secrets: DEBUG ? custody.secretsForLeakGrep : () => [],
  },
  linking: {
    offer: linking.offer,
    approve: linking.approve,
    accept: async (opts) => {
      const info = await linking.accept(opts);
      api.info = info;
      return info;
    },
    pendingCode: linking.pendingCode,
    pendingFingerprint: linking.pendingFingerprint,
    lastPayload: DEBUG ? linking.lastPayload : () => null,
  },
  rootlink: {
    propose: rootlink.propose,
    proposalFingerprint: rootlink.proposalFingerprint,
    answer: rootlink.answer,
    pendingFingerprint: rootlink.pendingFingerprint,
    complete: rootlink.complete,
    finish: rootlink.finish,
    linked: rootlink.linked,
    unlink: rootlink.unlink,
  },
  prover: {
    log: DEBUG ? async () => (await import("@/lib/zk/transport/browser")).proverLog() : async () => [],
    run: DEBUG
      ? async (op, opts) => {
          if (op !== "bench" && op !== "artifacts") throw new Error("unknown prover op");
          const b = await import("@/lib/zk/transport/browser");
          const a = await b.runProverJob({ op, ...(op === "bench" ? { rounds: opts?.rounds } : {}) }, b.LIVE_JOB_TIMEOUT_MS);
          return { where: a.where ?? null, result: a.result ?? null, timings: a.timings ?? null };
        }
      : async () => null,
    liveSample: DEBUG
      ? async ({ members, scope, message }) => {
          const { zkCommitment } = await import("@/lib/zk/identity");
          const { Group } = await import("@semaphore-protocol/group");
          const all = [...new Set([zkCommitment(), ...(Array.isArray(members) ? members.map(String) : [])])];
          const root = new Group(all.map((m) => BigInt(m))).root.toString(10);
          const publicInputs = { mode: "live" as const, claimKind: "tier-membership" as const, tree: "tier-2", epoch: 0, merkleTreeRoot: root, scope: String(scope), message: String(message), personaId: "p_bench", gateId: "bench", challenge: "epoch-0" };
          const b = await import("@/lib/zk/transport/browser");
          const t = b.browserTransport("live");
          const envelope = await t.prove("tier-membership", publicInputs, { members: all });
          const verified = await t.verify("tier-membership", envelope);
          const log = b.proverLog();
          return { envelope, verified, members: all, prove: log.filter((e) => e.op === "live-prove").pop() ?? null, verify: log.filter((e) => e.op === "live-verify").pop() ?? null };
        }
      : async () => null,
    needles: DEBUG ? async () => (await import("@/lib/zk/identity")).zkMaterialForLeakTest().filter((x) => typeof x === "string" && x.length >= 16) : async () => [],
    preload: DEBUG ? async () => (await import("@/lib/zk/transport/browser")).preloadStatus() : async () => null,
  },
  rings: {
    createAddress: ringsInbox.createAddress,
    listAddresses: ringsInbox.listAddresses,
    forgetAddress: ringsInbox.forgetAddress,
    restoreAddress: ringsInbox.restoreAddress,
    listForgottenAddresses: ringsInbox.listForgottenAddresses,
    status: async () => {
      const { ringsTickLog } = await import("@/lib/rings/tick");
      const { ringsDocLoaded, loadRingsDoc } = await import("@/lib/rings/model");
      // handed-out addresses only (LP-3: the spares made ahead are not "yours" until one is handed out)
      const addresses = ringsDocLoaded() ? ringsInbox.addressCount(await loadRingsDoc()) : 0;
      const log = ringsTickLog();
      return { ...ringsReceived.receivedStatus(), addresses, lastTick: log.length ? log[log.length - 1] : null };
    },
    debugKeys: DEBUG ? async () => ringsReceived.receivedNoteKeysForDebug() : async () => [],
    tryOpen: DEBUG
      ? async (noteHex, castHash, keys) => {
          const { openNote } = await import("@/lib/rings/note");
          return openNote(noteHex, castHash, keys);
        }
      : async () => null,
    tick: DEBUG
      ? async (mode) => {
          const { ringsTick } = await import("@/lib/rings/tick");
          const { zkMode } = await import("@/lib/zk/config");
          return ringsTick(mode ?? zkMode());
        }
      : async () => null,
  },
};
api.ready.catch(() => {});

const refreshInfo = (info: DeviceInfo) => {
  api.info = info;
  return info;
};

api.ready = (async () => {
  // L1: every tab loads the prover at boot (same request, same moment, whether or not it will ever prove) — a job never
  // loads anything (lib/zk/transport/browser.ts). Not awaited: the device does not wait for it; a failed load retries on
  // its own slow timer.
  void import("@/lib/zk/transport/browser")
    .then((b) => b.startProverPreload())
    .catch(() => {
      /* the bridge refuses each job plainly until a load succeeds */
    });
  const { info, storage } = await bootDevice();
  custody.bindStorage(storage);
  // PROD-LIVE: every path that turns persistence on (persist(), a passkey or provider save) refreshes `info` and
  // announces it, so the page's "this identity lives only in this tab" nudge hides the moment that stops being true
  const syncPersistent = () => {
    if (api.info && api.info.persistent !== storage.persistent) {
      api.info = { ...api.info, persistent: storage.persistent };
      announceDevice({ state: "ready", info: api.info });
    }
  };
  api.persist = async () => {
    await storage.enablePersistence();
    syncPersistent();
  };
  api.isPersistent = () => storage.persistent;
  api.wipe = () => storage.wipe();
  api.paths = () => storage.paths();
  if (DEBUG) {
    api.needles = async () => {
      const ks = await import("@/lib/identity/keystore");
      const dk = await import("@/lib/identity/deviceKeys");
      // PERSONA LAUNCH P4: every ring secret this device holds — the inbox IKM/PSK of each address, the PSKs of the
      // members it seals to, its note keys, its drop tokens, and the note keys it received
      const rm = await import("@/lib/rings/model");
      const sec = rm.ringsDocSecretsForLeakTest();
      const rings = [...(await ringsInbox.inboxMaterialForLeakTest()), ...sec.pskHex, ...sec.noteKeys, ...sec.tokens, ...ringsReceived.receivedNoteKeysForDebug().map((k) => k.keyHex)];
      return [...ks.rootMaterialForLeakTest(), ...ks.keyMaterialForLeakTest(), ...dk.deviceKeyMaterialForLeakTest(), ...rings].filter((x) => typeof x === "string" && x.length >= 32);
    };
    api.rootOnly = async () => {
      const ks = await import("@/lib/identity/keystore");
      return ks.rootOnlyMaterialForLeakTest();
    };
  }
  // the unlock and import paths re-boot the identity: keep `info` current for the page
  const wrap = <T extends (...a: never[]) => Promise<unknown>>(fn: T): T =>
    (async (...a: Parameters<T>) => {
      const r = (await fn(...a)) as { empty?: boolean; info?: DeviceInfo } | DeviceInfo;
      if (r && typeof r === "object") {
        if ("info" in r && r.info) refreshInfo(r.info);
        else if ("anchor" in r && "rootId" in r) refreshInfo(r as DeviceInfo);
      }
      return r;
    }) as unknown as T;
  api.custody.unlockPasskey = wrap(custody.unlockPasskey);
  api.custody.unlockProvider = wrap(custody.unlockProvider);
  api.custody.importPhrase = wrap(custody.importPhrase);
  // a save turns persistence on inside custody (D-CU-0-7 / D-CU-0-8); the result is returned untouched
  const afterSave = <T extends (...a: never[]) => Promise<unknown>>(fn: T): T =>
    (async (...a: Parameters<T>) => {
      try {
        return await fn(...a);
      } finally {
        syncPersistent();
      }
    }) as unknown as T;
  api.custody.savePasskey = afterSave(custody.savePasskey);
  api.custody.saveProvider = afterSave(custody.saveProvider);
  refreshInfo(info);
  // UXH-3: the browser asks before the tab closes while it holds an anonymous post that closing would lose (one still
  // waiting for its proof lives only in this tab's memory) or delay (one proved and not yet sent waits for this tab's
  // drain). beforeunload is synchronous, so the modules are resolved here; an unreadable state asks nothing.
  {
    const gate = await import("@/lib/zk/gate");
    const store = await import("@/lib/adapters/mock/store");
    const { anonHeldInTab } = await import("@/lib/zk/anon/availability");
    window.addEventListener("beforeunload", (ev) => {
      let held = false;
      try {
        held = anonHeldInTab(gate.wantedAnonPosts().length, store.state().zkQueue.values());
      } catch {
        held = false;
      }
      if (held) {
        ev.preventDefault();
        ev.returnValue = "";
      }
    });
  }
  installDeviceHost(ROUTES, SERVER_ONLY_ROUTES);
  // PROD-LIVE: the page's DeviceStatus flips from "booting" to "ready" on this
  announceDevice({ state: "ready", info });
  // PUBLIC GO-LIVE (the relay track): with the app's live hint, every tab registers its root in the live universe at boot — uniformly, never only the tabs that will post (lib/zk/prefetch.ts startLiveUniverseAtBoot; a no-op without the hint)
  void import("@/lib/zk/prefetch").then((p) => p.startLiveUniverseAtBoot()).catch(() => undefined);
  return info;
})();

(globalThis as unknown as { __layersDevice: DeviceApi }).__layersDevice = api;
api.ready.then(
  (info) => console.log("[device] ready: " + info.personaIds.length + " persona(s), root " + info.rootId + (info.restored ? " (restored)" : " (ephemeral)")),
  (e) => {
    const reason = e instanceof Error ? e.message : String(e);
    console.error("[device] boot failed: " + reason);
    // PROD-LIVE (D-CU-0-4): a boot failure is VISIBLE and FINAL for this document. Every request boot.js queued is
    // answered 503 {error: "device failed to start: <reason>"} (every later one too, by boot.js), the reason lands on
    // window.__layersDeviceFailed, and a `layers:device` event tells DeviceStatus to say so with a Retry. Before
    // this the queued reads waited forever and the page was an infinite spinner.
    markDeviceFailed(reason);
  }
);
