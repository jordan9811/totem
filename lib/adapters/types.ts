// THE CONTRACT. See ARCHITECTURE.md. UI code and pages depend only on
// these types — never on a concrete mock/validator implementation.
// Every method is async and may reject (AdapterError) — callers must
// handle loading + error states; see mockUtils.ts for why.

export class AdapterError extends Error {
  constructor(message: string, public code: "TIMEOUT" | "FAILED" | "NOT_FOUND" | "FORBIDDEN" = "FAILED") {
    super(message);
    this.name = "AdapterError";
  }
}

// ---------- shared domain types ----------

export interface PersonaSummary {
  id: string;
  // NO rootId. Root material never leaves the keystore (architecture-v3).
  // Callers cannot group personas by root except through grants they are
  // authorised to resolve.
  name: string;
  handle: string;
  avatarUrl: string | null;
  bio: string | null;
  cluster?: string;
  kind?: "public" | "private";
  /** PERSONA LAUNCH P1 (SIWF): the visitor's own Farcaster account, read-only on the public site (the switcher shows
   *  it with a "Farcaster · read-only" chip and opens its profile instead of switching to it) */
  publicSelf?: boolean;
}

export type DisclosureLevel = "public" | "followers" | "inner_circle" | "hidden";

export interface DisclosureGrant {
  personaId: string;
  /** who is granted visibility of this persona's root linkage */
  level: DisclosureLevel;
  /** explicit viewer ids granted access regardless of level (inner circle roster) */
  innerCircleViewerIds: string[];
  updatedAt: number;
}

export interface UnlockRequest {
  id: string;
  requesterPersonaId: string;
  targetPersonaId: string;
  status: "pending" | "accepted" | "declined";
  createdAt: number;
  resolvedAt: number | null;
}

export interface Facet {
  id: string;
  personaId: string;
  /** interest cluster this facet of a multi-persona account represents */
  cluster: string;
}

// Campaign audience predicates use the SAME rule fields as feed filters —
// graph.claim is what makes an advertiser audience builder the rules engine
// UI rather than a fork of it (gated-pass Gate 3).
export type RuleField =
  | "author.tier"
  | "author.cluster"
  | "post.topicId"
  | "post.isUpdate"
  | "post.hasMedia"
  | "post.age"
  /** SPEC A: the post's own words; `contains` only, any case (a muted word). Read on sample and Farcaster posts alike. */
  | "post.text"
  | "graph.claim"
  /** Attestation pass Gate 3: a PROVEN attestation, "<issuer>/<bucket>".
   * Evaluates against what the author proved this epoch (the validator's
   * presence log, read once per feed build), never against the trees. */
  | "attest.holds"
  /** UX Gate 1: mode activation rules only. Hour-of-day on the controllable
   * clock (marketClock), never wall time — deterministic under a seeded
   * advance, same discipline as every other clock-driven feature. */
  | "clock.hourUTC"
  /** POST-DEPLOY Gate 3: the DELIVERY TIER this viewer set for the post's author
   * IN THE ACTIVE MODE ("never-miss" | "banner" | "normal" | "facet-only" |
   * "quiet"). The account is never in the rule — the feed resolves the author
   * against the (account x mode) map and hands the evaluator a tier string, so
   * one rule per tier covers every account. */
  | "delivery.tier";
export type RuleOp = "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "in" | "contains";

export interface RuleCondition {
  field: RuleField;
  op: RuleOp;
  value: string | number | boolean | (string | number)[];
}

export interface RuleGroup {
  combinator: "AND" | "OR";
  /** NOT applies to the whole group when true */
  negate?: boolean;
  clauses: (RuleCondition | RuleGroup)[];
}

export interface Rule {
  id: string;
  name: string;
  /**
   * What a matching post should have done to it.
   *
   * POST-DEPLOY Gate 3 added `pin` and `banner` for delivery tiers. They are
   * DEVICE-ONLY actions: lib/algo/artifact.ts still allowlists hide/downrank/
   * flag, so an IMPORTED algorithm cannot use them. An imported algorithm that
   * could pin an account to the top of somebody's timeline is an ad slot with
   * extra steps.
   */
  action: "hide" | "downrank" | "flag" | "pin" | "banner";
  root: RuleGroup;
  createdAt: number;
}

export interface RankingWeights {
  recency: number;
  engagement: number;
  authorAffinity: number;
  clusterAffinity: number;
}

export interface ModeDefinition {
  id: string;
  personaId: string;
  name: string;
  isPreset: boolean;
  ranking: RankingWeights;
  /** rule ids (from RulesAdapter) applied as filters in this mode */
  ruleIds: string[];
  notificationPolicy: "all" | "mentions_only" | "muted";
  /** MEGA PASS 2 Gate 3: `cast` — the per-cast action row's bindings, one action id per slot
   * (lib/actions/bindings.ts); absent = X's row exactly, the parity baseline */
  actionButtonSlots: { composer: string[]; nav: string[]; cast?: string[] };
  /**
   * Persona this mode acts as when activated. Deliberately NOT reusing
   * `personaId` above, whose only job is ownership — overloading it would
   * make a pinned mode disappear from its owner's mode list.
   */
  pinnedPersonaId?: string | null;
  /** UX Gate 1: optional time/context auto-switch. Off by default even when
   * a rule is saved — activationEnabled is the separate, explicit switch, so
   * a half-configured rule can never silently start firing. */
  activationRule?: RuleGroup | null;
  activationEnabled?: boolean;
  /** network-state filter packs attached to THIS mode. Default OFF, per
   * mode: Work can run a pack Default does not. */
  filterPackIds?: string[];
  /** king-of-the-hill: sink posts that lost standing (refuted by an
   * equal-or-higher-tier author or a subscribed curator); volume never
   * factors. Shipped as an importable algo flag — Gate 2 dogfood. */
  kingOfTheHill?: boolean;
  /** MEGA PASS 2 Gate 5: how DM-sourced readwise items reach this mode's feed — every N feed loads, as a
   * chunk or in full ("eventually they'll read it unless they remove it"). Absent = every load, as a chunk. */
  dmReadwise?: { every: number; appearance: "chunk" | "full" };
  /** MEGA PASS 2 Gate 2: the LENS this mode sees through (a stored lens id); null/absent = the
   * canonical lens (the identity). A filter pack attached to the mode may pin one when the mode
   * has none of its own — the mode's own pin always wins. */
  lens?: string | null;
  /** caught-up banner calibration: off / after new content / aggressive
   * (aggressive also counts saturated topics as seen). Undefined = "new". */
  caughtUp?: "off" | "new" | "aggressive";
  /** set when this mode was imported as an algo artifact; edits flip
   * modifiedLocally so provenance renders "modified from @author's algo vN" */
  importedFrom?: {
    authorHandle: string;
    authorPersonaId: string;
    algoVersion: number;
    name: string;
    modifiedLocally: boolean;
  };
  showTrending: boolean;
  calmRanking: boolean;
  /** restrict feed to accounts the viewer follows (Work preset) */
  followedOnly?: boolean;
  /** weight long-form + bookmarked content heavily (Curate preset) */
  longformOnly?: boolean;
  /** drop reply posts from the feed (Curate preset) */
  hideReplies?: boolean;
  /** allow in-feed ad units; Event Safe Space sets this false */
  allowAds?: boolean;
  /** ADS, PHASE 1: the ad dial for this mode (lib/ads/dial.ts): none / generic / matched (contextual: this mode's
   *  name only). Absent = the default for the owner (generic for a public identity, none for a private persona).
   *  Sealed with the mode (the "modes" namespace); ignored, and not settable, when allowAds is false. A viewer's
   *  preference, not part of an algorithm: lib/algo/artifact.ts does not export it. */
  adDial?: "none" | "generic" | "matched";
  createdAt: number;
}

export interface AttestationIssuer {
  id: string;
  name: string;
  description: string;
  tierBonus: number;
}

export interface AttestationConnection {
  issuerId: string;
  personaId: string;
  connectedAt: number;
}

export interface ReadwiseSchedule {
  postHash: string;
  personaId: string;
  chunks: string[];
  nextChunkIndex: number;
  chunkSurfacedAt: number[] /* epoch ms per surfaced chunk, sparse */;
}

export interface SaturationEntry {
  storyId: string;
  personaId: string;
  caughtUpAt: number;
  /** per-mode override; null = applies to all modes */
  modeId: string | null;
}

export interface SendToTimelineEvent {
  id: string;
  fromPersonaId: string;
  toPersonaId: string;
  postHash: string;
  createdAt: number;
}

export interface NoteReinjection {
  postHash: string;
  noteId: string;
  personaId: string;
  qualifies: boolean;
  reason: string;
}

// ---------- Wave 4: social surfaces ----------

export type MembershipPolicy = "open" | "request" | "invite";

export interface Channel {
  id: string;
  name: string;
  description: string;
  cluster: string;
  policy: MembershipPolicy;
  ownerPersonaId: string;
  createdAt: number;
}

export interface ChannelMembership {
  channelId: string;
  personaId: string;
  status: "member" | "requested" | "invited";
  joinedAt: number;
}

export interface BookmarkFolder {
  id: string;
  name: string;
  ownerPersonaId: string;
  isPublic: boolean;
  postHashes: string[];
  createdAt: number;
}

export interface Room {
  id: string;
  title: string;
  topicCluster: string;
  hostPersonaId: string;
  status: "scheduled" | "open" | "closed";
  scheduledFor: number;
  /** deterministic script: messages posted on a timer while the room is open */
  script: { atMs: number; personaId: string; text: string }[];
  /** message ids the host muted */
  mutedPersonaIds: string[];
  pinnedMessageId: string | null;
  openedAt: number | null;
  closedAt: number | null;
}

export interface RoomMessage {
  id: string;
  roomId: string;
  personaId: string;
  text: string;
  atMs: number;
}

export interface RoomHighlight {
  id: string;
  roomId: string;
  messageId: string;
  personaId: string;
  text: string;
  markedAt: number;
}

// ---------- Wave 5: context graph ----------

export type ClaimCategory =
  | "interests"
  | "demographics"
  | "ownership"
  | "habits"
  | "health"
  | "finances"
  | "politics";

export const SENSITIVE_CATEGORIES: ClaimCategory[] = ["health", "finances", "politics"];

/** HOW a claim was established — provenance's "method", orthogonal to the
 * trust TIER (source). A W3C VC and a DID claim both land at the attested
 * tier but by different methods; a platform export and an X-archive import
 * both land x-inferred by different methods. Backpack pass: provenance is
 * {issuer, method, date}, and method is a first-class field so a claim's
 * origin is inspectable, never a flat undifferentiated list. */
export type ClaimMethod =
  | "self-declared"
  | "w3c-vc"
  | "did-control"
  | "platform-export"
  | "x-archive"
  /** Attestation pass Gate 2: an issuer-signed zk attestation held in this
   * root's vault (issuer named; the value is the coarse bucket) */
  | "zk-attestation";

export interface GraphClaim {
  id: string;
  personaId: string;
  category: ClaimCategory;
  label: string;
  value: string;
  /** self-declared vs attested by an issuer vs inferred by X's ad systems
   * and imported from the archive (X interop Gate 2). The three are never
   * conflated: "x-inferred" claims render with their own provenance chip
   * and never upgrade to attested. */
  source: "self" | "attested" | "x-inferred";
  /** the provenance METHOD (how the claim was established). Absent on
   * pre-backpack seed claims — treated as "self-declared" for self-tier
   * and the connector's method for imports. */
  method?: ClaimMethod | null;
  issuer: string | null;
  issuedAt: number | null;
  active: boolean;
}

/** One line of an import's preview — exactly what a commit WILL write, so
 * the preview can be asserted to match what lands. A sensitive yield with
 * no consent yet is shown but `withheld`, and is NOT written on commit. */
export interface ImportPreviewItem {
  category: ClaimCategory;
  label: string;
  value: string;
  source: "self" | "attested" | "x-inferred";
  method: ClaimMethod;
  issuer: string | null;
  sensitive: boolean;
  withheld: boolean;
}

export interface ImportJob {
  id: string;
  personaId: string;
  connectorId: string;
  /** "preview" (backpack pass): the walk finished and the claims that WOULD
   * land are staged in `preview`, but nothing is written until an explicit
   * commit — no bulk import bypasses the confirm step. */
  status: "pending" | "running" | "preview" | "complete" | "failed";
  step: number;
  totalSteps: number;
  claimIds: string[];
  /** populated at the "preview" step: exactly what a commit will write. */
  preview?: ImportPreviewItem[];
  startedAt: number;
}

export interface ImportConnector {
  id: string;
  name: string;
  description: string;
  issuer: string;
  category: ClaimCategory;
  /** UX Gate 4: the trust tier claims from this connector land at. Absent
   * means "attested" (the original 3 connectors — unsigned, unchanged).
   * A platform export is issuer-backed but not individually signed, so it
   * lands one tier down, same as X archive import's "x-inferred" claims. */
  trustSource?: "attested" | "x-inferred";
  /** Backpack pass: the provenance METHOD every claim from this connector
   * carries. Absent means "platform-export" (a data import). */
  method?: ClaimMethod;
}

// ---------- Wave 6: market layer ----------

export interface Campaign {
  id: string;
  advertiserPersonaId: string;
  name: string;
  /** the audience predicate IS a rules-engine group, not a fork */
  audience: RuleGroup;
  budget: number;
  createdAt: number;
  status: "draft" | "live";
}

export interface Intent {
  id: string;
  buyerPersonaId: string;
  category: string;
  description: string;
  escrowAmount: number;
  pitchSlots: number;
  /** ms after createdAt when the decision window lapses */
  windowMs: number;
  createdAt: number;
  status: "open" | "awarded" | "lapsed";
  winningBidId: string | null;
}

export interface Bid {
  id: string;
  intentId: string;
  advertiserPersonaId: string;
  pitch: string;
  amount: number;
  /** ms after intent creation when this scripted bid arrives */
  arrivesAtMs: number;
}

export interface SettlementEvent {
  id: string;
  kind:
    | "intent_award"
    | "intent_refund"
    | "ad_impression"
    | "graph_share"
    | "paid_read"
    | "dm_slash"
    | "pledge_award"
    | "pledge_lottery"
    | "tip_epoch";
  personaId: string;
  amount: number;
  category: string;
  note: string;
  createdAt: number;
}

export interface MeasurementAggregate {
  campaignId: string;
  impressions: number;
  conversions: number;
  /** deterministic DP noise applied; bound is public so tests can assert */
  noiseBound: number;
}

// ---------- Mega pass: identity substrate (architecture-v3) ----------

import type { Grant, GrantTier, ResolutionRequest } from "@/lib/identity/grants";
export type { Grant, GrantTier, ResolutionRequest };

export interface IdentityAdapter {
  listOwnPersonas(): Promise<PersonaSummary[]>;
  getPersona(personaId: string): Promise<PersonaSummary | null>;
  createPersona(input: {
    name: string;
    handle: string;
    kind?: "public" | "private";
    avatarUrl?: string | null;
    bio?: string | null;
    cluster?: string | null;
    forkedFrom?: string | null;
  }): Promise<PersonaSummary>;

  /** FAIL CLOSED: private personas and unknown personas may not publish. */
  canPublishPublicly(personaId: string): Promise<boolean>;
  /**
   * Private posts this viewer is entitled to. Goes through the adapter seam
   * so it carries real latency and can be forced to fail — a distribution
   * read that could never fail would never have its fail-closed path tested.
   * The authorization decision itself lives in lib/private/visibility.ts;
   * this only adds the cost model, so there is one rule, not two.
   */
  visiblePrivatePosts(viewer: string): Promise<import("./mock/privateStore").PrivatePost[]>;
  audienceFor(personaId: string): Promise<string[]>;

  issueGrant(input: {
    fromPersona: string;
    toPersona: string;
    audienceMember?: string;
    tier: GrantTier;
  }): Promise<Grant>;
  revokeGrant(grantId: string): Promise<Grant>;
  listGrantsFor(personaId: string): Promise<Grant[]>;

  /** The predicate the real track must prove without revealing the grant set. */
  resolveLinkage(from: string, to: string, viewer: string | null): Promise<{ tier: GrantTier; grant: Grant } | null>;
  resolvableSiblings(personaId: string, viewer: string | null): Promise<string[]>;

  requestResolution(from: string, to: string, requesterPersona: string): Promise<ResolutionRequest>;
  whoAsked(personaId: string): Promise<ResolutionRequest[]>;
}

// ---------- adapters ----------

export interface PersonaAdapter {
  listForRoot(rootId: string): Promise<PersonaSummary[]>;
  listByFid(fid: number): Promise<PersonaSummary[]>;
  get(personaId: string): Promise<PersonaSummary | null>;
  create(input: { rootId: string; name: string; handle: string; avatarUrl?: string | null; bio?: string | null; cluster?: string }): Promise<PersonaSummary>;
  listFacets(personaId: string): Promise<Facet[]>;
}

export interface RepAdapter {
  tierFor(personaId: string): Promise<number>;
  blockedFor(personaId: string): Promise<string[]>;
  block(blockerPersonaId: string, blockedPersonaId: string): Promise<void>;
  tierExplainer(tier: number): Promise<{ tier: number; percentile: string; unlocks: string[] }>;
}

export interface DisclosureAdapter {
  getGrant(personaId: string): Promise<DisclosureGrant>;
  setGrant(personaId: string, level: DisclosureLevel, innerCircleViewerIds?: string[]): Promise<DisclosureGrant>;
  /** can `viewerPersonaId` see the linkage surface for `personaId`? */
  canViewLinkage(personaId: string, viewerPersonaId: string | null): Promise<boolean>;
  requestUnlock(requesterPersonaId: string, targetPersonaId: string): Promise<UnlockRequest>;
  respondToUnlock(requestId: string, accept: boolean): Promise<UnlockRequest>;
  listUnlockRequests(personaId: string): Promise<UnlockRequest[]>;
  followFacet(viewerPersonaId: string, facetId: string): Promise<void>;
  unfollowFacet(viewerPersonaId: string, facetId: string): Promise<void>;
  followedFacets(viewerPersonaId: string): Promise<string[]>;
}

export interface ModeAdapter {
  list(personaId: string): Promise<ModeDefinition[]>;
  get(modeId: string): Promise<ModeDefinition | null>;
  getActive(personaId: string): Promise<ModeDefinition>;
  setActive(personaId: string, modeId: string): Promise<void>;
  create(mode: Omit<ModeDefinition, "id" | "createdAt">): Promise<ModeDefinition>;
  update(modeId: string, patch: Partial<Omit<ModeDefinition, "id" | "personaId" | "createdAt">>): Promise<ModeDefinition>;
  duplicate(modeId: string, newName: string): Promise<ModeDefinition>;
  delete(modeId: string): Promise<void>;
  presets(): Promise<ModeDefinition[]>;
}

export interface RulesAdapter {
  list(personaId: string): Promise<Rule[]>;
  get(ruleId: string): Promise<Rule | null>;
  create(rule: Omit<Rule, "id" | "createdAt"> & { personaId: string }): Promise<Rule>;
  update(ruleId: string, patch: Partial<Pick<Rule, "name" | "action" | "root">>): Promise<Rule>;
  delete(ruleId: string): Promise<void>;
  /** count of currently-seeded posts a rule root would match, for the live preview */
  previewCount(root: RuleGroup): Promise<number>;
}

export interface AttestationAdapter {
  listIssuers(): Promise<AttestationIssuer[]>;
  listConnections(personaId: string): Promise<AttestationConnection[]>;
  connect(personaId: string, issuerId: string): Promise<AttestationConnection>;
}

export interface FeedHealthAdapter {
  // readwise-in-timeline
  /** POST-DEPLOY Gate 4: `targetWords` is the chunk-length SLIDER, per mode.
   *  Passed in rather than read inside the adapter because the adapter has no
   *  business reading a vault preference — the caller knows the mode. */
  scheduleReadwise(postHash: string, personaId: string, fullText: string, targetWords?: number): Promise<ReadwiseSchedule>;
  /** POST-DEPLOY Gate 4: re-cut an existing schedule at a new chunk width. Returns
   *  the new schedule; chunk-level read marks that referred to the OLD boundaries
   *  are the caller's to drop, because they no longer name anything. */
  rechunkReadwise(postHash: string, personaId: string, targetWords: number): Promise<ReadwiseSchedule | null>;
  getReadwiseSchedules(personaId: string): Promise<ReadwiseSchedule[]>;
  advanceReadwise(postHash: string, personaId: string): Promise<ReadwiseSchedule>;
  fastForwardAll(personaId: string): Promise<ReadwiseSchedule[]>;

  // send-to-timeline
  sendToTimeline(fromPersonaId: string, toPersonaId: string, postHash: string): Promise<SendToTimelineEvent>;
  inboxFor(personaId: string): Promise<SendToTimelineEvent[]>;
  getReceivePermission(personaId: string): Promise<boolean>;
  setReceivePermission(personaId: string, allow: boolean): Promise<void>;

  // topic saturation
  markCaughtUp(storyId: string, personaId: string, modeId: string | null): Promise<SaturationEntry>;
  listSaturated(personaId: string, modeId: string | null): Promise<SaturationEntry[]>;
  clearSaturation(storyId: string, personaId: string): Promise<void>;

  // community notes reinjection
  reinjectionsFor(personaId: string): Promise<NoteReinjection[]>;
}

export interface SpaceAdapter {
  listChannels(viewerPersonaId: string): Promise<Channel[]>;
  getChannel(channelId: string): Promise<Channel | null>;
  createChannel(input: Omit<Channel, "id" | "createdAt">): Promise<Channel>;
  /** FAIL CLOSED: on error callers must treat the channel as locked. */
  isMember(channelId: string, personaId: string): Promise<boolean>;
  members(channelId: string): Promise<ChannelMembership[]>;
  join(channelId: string, personaId: string): Promise<ChannelMembership>;
  /** channel ids this persona may read, used to gate every post surface */
  visibleChannelIds(personaId: string): Promise<string[]>;

  listFolders(viewerPersonaId: string): Promise<BookmarkFolder[]>;
  getFolder(folderId: string): Promise<BookmarkFolder | null>;
  /** FAIL CLOSED: a private folder must never resolve for a non-owner. */
  canViewFolder(folderId: string, viewerPersonaId: string): Promise<boolean>;
  createFolder(input: Omit<BookmarkFolder, "id" | "createdAt">): Promise<BookmarkFolder>;
  setFolderPublic(folderId: string, isPublic: boolean): Promise<BookmarkFolder>;
  addToFolder(folderId: string, postHash: string): Promise<BookmarkFolder>;
  followFolder(personaId: string, folderId: string): Promise<void>;
  unfollowFolder(personaId: string, folderId: string): Promise<void>;
  followedFolders(personaId: string): Promise<string[]>;

  listRooms(): Promise<Room[]>;
  getRoom(roomId: string): Promise<Room | null>;
  openRoom(roomId: string): Promise<Room>;
  closeRoom(roomId: string): Promise<Room>;
  /** messages visible given the room's elapsed script time */
  roomMessages(roomId: string, nowMs?: number): Promise<RoomMessage[]>;
  markHighlight(roomId: string, messageId: string): Promise<RoomHighlight>;
  listHighlights(roomId: string): Promise<RoomHighlight[]>;
  pinMessage(roomId: string, messageId: string | null): Promise<Room>;
  muteParticipant(roomId: string, personaId: string, muted: boolean): Promise<Room>;
}

export interface GraphAdapter {
  listClaims(personaId: string): Promise<GraphClaim[]>;
  /** FAIL CLOSED: sensitive claims are omitted unless consent is readable. */
  claimsForMatching(personaId: string): Promise<{ claims: GraphClaim[]; sensitiveIncluded: boolean }>;
  addClaim(
    personaId: string,
    category: ClaimCategory,
    label: string,
    value: string,
    source?: "self" | "x-inferred"
  ): Promise<GraphClaim>;
  /** personaId: the viewer's persona — needed to resolve a vault-derived
   * attested claim (att_…), which has no row of its own */
  setClaimActive(claimId: string, active: boolean, personaId?: string): Promise<GraphClaim>;
  getConsent(personaId: string, category: ClaimCategory): Promise<boolean>;
  setConsent(personaId: string, category: ClaimCategory, consented: boolean): Promise<void>;
  listConnectors(): Promise<ImportConnector[]>;
  startImport(personaId: string, connectorId: string): Promise<ImportJob>;
  /** Walks the progress steps; at the final step lands on status "preview"
   * (NOT "complete") with `preview` staged — nothing is written yet. */
  advanceImport(jobId: string): Promise<ImportJob>;
  /** Backpack pass: commit a previewed import — writes exactly the
   * non-withheld preview items as claims. Idempotent (re-commit returns the
   * complete job unchanged). */
  commitImport(jobId: string): Promise<ImportJob>;
  getImport(jobId: string): Promise<ImportJob | null>;
}

export interface MarketAdapter {
  listCampaigns(): Promise<Campaign[]>;
  createCampaign(input: Omit<Campaign, "id" | "createdAt">): Promise<Campaign>;
  /** k-anonymity floor; enforced independently in UI and here */
  audienceSize(audience: RuleGroup): Promise<number>;
  /** the floor this audience must clear: the k-floor, raised to the zk
   * attestation floor when the predicate names a proven bucket (Gate 3) */
  kFloor(audience?: RuleGroup): Promise<number>;
  /** campaigns whose audience predicate matches this persona's graph */
  matchingCampaigns(personaId: string): Promise<{ campaign: Campaign; reasons: string[] }[]>;

  createIntent(input: Omit<Intent, "id" | "createdAt" | "status" | "winningBidId">): Promise<Intent>;
  getIntent(intentId: string): Promise<Intent | null>;
  listIntents(personaId: string): Promise<Intent[]>;
  bidsFor(intentId: string, nowMs?: number): Promise<Bid[]>;
  awardIntent(intentId: string, bidId: string): Promise<Intent>;
  lapseIntent(intentId: string): Promise<Intent>;

  measurement(campaignId: string): Promise<MeasurementAggregate>;
}

/**
 * The relationship event log. Local-first: this contract is shaped so a
 * future encrypted vault can implement it without schema change — which is
 * why reads are all scoped to one actor and there is no cross-actor query.
 */
export interface EventLogAdapter {
  /** Idempotent by event id — the caller mints id + timestamp exactly once,
   * so retrying a failed write cannot double-log. Rejects any event whose
   * type is off the closed union (impressions are unrepresentable). */
  record(event: import("@/lib/eventlog/types").EdgeEvent): Promise<import("@/lib/eventlog/types").EdgeEvent>;
  /** This actor's own log, newest first. */
  list(actorPersonaId: string): Promise<import("@/lib/eventlog/types").EdgeEvent[]>;
  /** Events about one target, oldest first (profile history reads this). */
  forTarget(actorPersonaId: string, targetPersona: string): Promise<import("@/lib/eventlog/types").EdgeEvent[]>;
}

export interface SettleAdapter {
  listEvents(personaId: string): Promise<SettlementEvent[]>;
  /** PUT-BY-ID (X interop Gate 0): pass recordId to make the write
   * idempotent — a retry after a persistent failure converges to exactly
   * one record, never zero, never two. Omitting recordId keeps the old
   * at-most-once mint-an-id behaviour for legacy call sites. */
  record(
    event: Omit<SettlementEvent, "id" | "createdAt"> & { recordId?: string }
  ): Promise<SettlementEvent>;
  earningsByCategory(personaId: string): Promise<{ category: string; total: number }[]>;
  total(personaId: string): Promise<number>;
}

// ---------- MEGA PASS 2 Gate 1: the reputation UBI ----------
// Influence is an allowance a ROOT receives per epoch and may spend as a
// signed, per-persona STAKE on content. It is never money and never moves
// between accounts: this contract has NO transfer/send/move method, and
// lib/influence/types.ts asserts that at the type level.
export interface InfluenceAllowanceView {
  epoch: number;
  allowance: number;
  remaining: number;
  tier: number;
  defaults: Record<import("@/lib/influence/types").StakeAction, number>;
  directions: Record<import("@/lib/influence/types").StakeAction, import("@/lib/influence/types").StakeDirection>;
}

export interface InfluenceAdapter {
  /** the CURRENT epoch's balance for this root (vault-held; recharges per epoch; never overdrawn) */
  allowance(): Promise<InfluenceAllowanceView>;
  /** spend allowance as a signed stake on a cast — typed refusals, never an overdraw */
  stake(input: import("@/lib/influence/stakes").PlaceStakeInput): Promise<import("@/lib/influence/stakes").PlaceStakeResult>;
  /** a persona's stake history AT ITS DISCLOSURE LEVEL — FAIL CLOSED on a disclosure-check failure */
  historyFor(personaId: string, viewerPersonaId: string): Promise<import("@/lib/influence/stakes").HistoryResult>;
  /** verified public stakes on a cast + the aggregate by direction */
  stakesForCast(castHash: string): Promise<{ rows: import("@/lib/influence/types").StakeEvent[]; summary: import("@/lib/influence/types").CastStakeSummary }>;
  /** per-action default amounts and directions (own settings) */
  setSettings(patch: { defaults?: Partial<Record<import("@/lib/influence/types").StakeAction, number>>; directions?: Partial<Record<import("@/lib/influence/types").StakeAction, import("@/lib/influence/types").StakeDirection>> }): Promise<{ defaults: Record<import("@/lib/influence/types").StakeAction, number>; directions: Record<import("@/lib/influence/types").StakeAction, import("@/lib/influence/types").StakeDirection> }>;
}

/** Controllable clock for market timers — keeps auction tests deterministic. */
export interface MarketClock {
  now(): number;
  jumpTo(ms: number): void;
  advance(ms: number): void;
  reset(): void;
}

// ---------- dev/testing surface ----------

export interface AdapterRegistrySnapshot {
  persona: "mock" | "validator";
  /** ZK PASS 1: "zk" = tierFor is PROOF-MEDIATED (what the persona proved
   * this epoch over the anonymous channel), never a root-side lookup. */
  rep: "mock" | "validator" | "zk";
  disclosure: "mock";
  mode: "mock";
  rulesEngine: "mock";
  attestation: "mock";
  feedHealth: "mock";
  space: "mock";
  /** ZK PASS 1: "zk" = the same disclosure substrate, plus the zk identity
   * (commitment registration, trees) behind lib/zk. */
  identity: "mock" | "zk";
  graph: "mock";
  market: "mock";
  settle: "mock";
  eventLog: "mock";
  /** MEGA PASS 2: the reputation UBI adapter */
  influence: "mock";
  latencyInjectionMs: [number, number] | null /* override range, or null = default 200-1500 */;
  failureRateOverride: number | null /* override 0-1, or null = default 0.02 */;
  /** FC Gate 2: the effective content source (env default + runtime override) */
  dataSource: "seed" | "neynar";
}
