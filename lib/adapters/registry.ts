import "server-only";
// Resolves each adapter interface to a concrete implementation via
// ADAPTER_<NAME> env vars. Persona + Rep default to the REAL validator
// (phase 1 proved it); everything net-new defaults to mock because no real
// backend exists for it yet. See ARCHITECTURE.md.
import type {
  AdapterRegistrySnapshot,
  AttestationAdapter,
  DisclosureAdapter,
  FeedHealthAdapter,
  ModeAdapter,
  PersonaAdapter,
  RepAdapter,
  RulesAdapter,
  SpaceAdapter,
  IdentityAdapter,
  GraphAdapter,
  MarketAdapter,
  SettleAdapter,
  EventLogAdapter,
} from "./types";
import { dataSource } from "./neynar/mode";
import { mockPersonaAdapter } from "./mock/persona";
import { mockRepAdapter } from "./mock/rep";
import { mockInfluenceAdapter } from "./mock/influence";
import type { InfluenceAdapter } from "./types";
import { mockDisclosureAdapter } from "./mock/disclosure";
import { mockModeAdapter } from "./mock/mode";
import { mockRulesAdapter } from "./mock/rules";
import { mockAttestationAdapter } from "./mock/attestation";
import { mockFeedHealthAdapter } from "./mock/feedHealth";
import { mockSpaceAdapter } from "./mock/space";
import { mockIdentityAdapter } from "./mock/identity";
import { mockGraphAdapter } from "./mock/graph";
import { mockMarketAdapter } from "./mock/market";
import { mockSettleAdapter } from "./mock/settle";
import { mockEventLogAdapter } from "./mock/eventLog";
import { validatorPersonaAdapter, validatorRepAdapter } from "./validator";
import { persisted } from "./mock/persisted";
import { getDevControls } from "./devControls";
import { makeZkRepAdapter } from "./zk/rep";

// Default mock (per the ground rules): the primary surface is seeded data,
// and seeded personas live in /seed, not the validator's SQLite. Set
// ADAPTER_PERSONA=validator / ADAPTER_REP=validator to bind the real
// service instead. The phase-1 routes (/api/personas, /api/block) still
// call lib/validator.ts directly and are unaffected by this default.
// ZK PASS 1: ADAPTER_REP=zk binds the PROOF-MEDIATED rep adapter;
// ADAPTER_IDENTITY=zk reports the zk identity binding (same disclosure
// substrate, with the commitment/tree machinery behind lib/zk).
const personaImpl = (process.env.ADAPTER_PERSONA ?? "mock") as "mock" | "validator";
type RepImpl = "mock" | "validator" | "zk";
const repImplEnv = (process.env.ADAPTER_REP ?? "mock") as RepImpl;
const identityImpl = (process.env.ADAPTER_IDENTITY === "zk" ? "zk" : "mock") as "mock" | "zk";

// Seeded personas live in /seed, never in the validator DB, so routes that
// act on them (block-seed) must use the mock rep regardless of the registry
// binding — but they still need the write-through persistence wrapper, or
// blocks vanish on restart. Exported so there is exactly one wrapped
// instance rather than two competing ones.
export const persistedMockRep = persisted(mockRepAdapter, { block: ["blocks"] });

// ZK PASS 1: a dev/test RUNTIME override of the rep binding (suites switch
// to "zk" without a process restart; resetSeed clears it). Production reads
// the env once. The `rep` slot below is a dispatching proxy so every call
// site resolves the CURRENT implementation per call.
const gz = globalThis as unknown as { __layersRepImplOverride?: RepImpl | null };
export function setRepImplOverride(impl: RepImpl | null): void {
  gz.__layersRepImplOverride = impl;
}
export function currentRepImpl(): RepImpl {
  return gz.__layersRepImplOverride ?? repImplEnv;
}
const zkRep = makeZkRepAdapter(persistedMockRep);
function repFor(impl: RepImpl): RepAdapter {
  return impl === "zk" ? zkRep : impl === "validator" ? validatorRepAdapter : persistedMockRep;
}
const dispatchingRep: RepAdapter = new Proxy(persistedMockRep, {
  get(_target, prop) {
    return Reflect.get(repFor(currentRepImpl()), prop);
  },
});

export const adapters: {
  persona: PersonaAdapter;
  rep: RepAdapter;
  influence: InfluenceAdapter;
  disclosure: DisclosureAdapter;
  mode: ModeAdapter;
  rules: RulesAdapter;
  attestation: AttestationAdapter;
  feedHealth: FeedHealthAdapter;
  space: SpaceAdapter;
  identity: IdentityAdapter;
  graph: GraphAdapter;
  market: MarketAdapter;
  settle: SettleAdapter;
  eventLog: EventLogAdapter;
} = {
  persona: personaImpl === "mock" ? mockPersonaAdapter : validatorPersonaAdapter,
  rep: dispatchingRep,
  influence: mockInfluenceAdapter,
  disclosure: persisted(mockDisclosureAdapter, {
    setGrant: ["grants"],
    requestUnlock: ["unlockRequests"],
    respondToUnlock: ["unlockRequests"],
    followFacet: ["followedFacets"],
    unfollowFacet: ["followedFacets"],
  }),
  mode: persisted(mockModeAdapter, {
    // getActive/list seed the four presets into state on first call, so they
    // dirty the namespace too.
    list: ["modes"],
    getActive: ["modes", "activeMode"],
    setActive: ["activeMode"],
    create: ["modes"],
    update: ["modes"],
    duplicate: ["modes"],
    delete: ["modes", "activeMode"],
  }),
  rules: persisted(mockRulesAdapter, {
    list: ["rules"],
    create: ["rules"],
    update: ["rules"],
    delete: ["rules"],
  }),
  attestation: persisted(mockAttestationAdapter, { connect: ["attestations"] }),
  space: persisted(mockSpaceAdapter, {
    createChannel: ["channels", "channelMembers"],
    join: ["channelMembers"],
    createFolder: ["folders"],
    setFolderPublic: ["folders"],
    addToFolder: ["folders"],
    followFolder: ["folderFollows"],
    unfollowFolder: ["folderFollows"],
    openRoom: ["rooms"],
    closeRoom: ["rooms"],
    markHighlight: ["highlights"],
    pinMessage: ["rooms"],
    muteParticipant: ["rooms"],
  }),
  identity: persisted(mockIdentityAdapter, {
    createPersona: ["grantsV3"],
    issueGrant: ["grantsV3"],
    revokeGrant: ["grantsV3"],
    requestResolution: ["resolutionRequests"],
  }),
  graph: persisted(mockGraphAdapter, {
    addClaim: ["graphClaims"],
    setClaimActive: ["graphClaims"],
    setConsent: ["graphConsent", "graphClaims"],
    startImport: ["imports"],
    // Backpack pass: advanceImport now only advances the job to a PREVIEW —
    // it writes nothing to graphClaims. commitImport is what actually lands
    // the claims, so the graphClaims flush moves there. (Missing it stranded
    // committed claims in the in-memory Map: readable in-process, but never
    // durable — no restart survival, no ciphertext at rest. accept-bp #8
    // caught it.)
    advanceImport: ["imports"],
    commitImport: ["imports", "graphClaims"],
  }),
  market: persisted(mockMarketAdapter, {
    createCampaign: ["campaigns"],
    createIntent: ["intents", "bids"],
    awardIntent: ["intents"],
    lapseIntent: ["intents"],
  }),
  settle: persisted(mockSettleAdapter, { record: ["settlements"] }),
  // Event log flushes are driven by logEdgeEvent()/backfill (they persist the
  // namespace themselves after the idempotent put), so no write-through map.
  eventLog: mockEventLogAdapter,
  feedHealth: persisted(mockFeedHealthAdapter, {
    scheduleReadwise: ["readwise"],
    rechunkReadwise: ["readwise"],
    advanceReadwise: ["readwise"],
    fastForwardAll: ["readwise"],
    sendToTimeline: ["sends"],
    setReceivePermission: ["receivePermission"],
    markCaughtUp: ["saturation"],
    clearSaturation: ["saturation"],
  }),
};

export function registrySnapshot(): AdapterRegistrySnapshot {
  const controls = getDevControls();
  return {
    persona: personaImpl,
    rep: currentRepImpl(),
    influence: "mock",
    disclosure: "mock",
    mode: "mock",
    rulesEngine: "mock",
    attestation: "mock",
    feedHealth: "mock",
    space: "mock",
    identity: identityImpl,
    graph: "mock",
    market: "mock",
    settle: "mock",
    eventLog: "mock",
    latencyInjectionMs: controls.latencyInjectionMs,
    failureRateOverride: controls.failureRateOverride,
    dataSource: dataSource(),
  };
}
