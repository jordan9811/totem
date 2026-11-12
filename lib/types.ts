export interface User {
  fid: number;
  username: string;
  displayName: string;
  pfpUrl: string;
  bio?: string;
  bannerUrl?: string;
  followerCount: number;
  followingCount: number;
  postCount?: number;
  joined?: string;
  verified?: boolean;
  /** FC-READ: read through the public preview's read relay (a real Farcaster account); read-only here */
  network?: true;
  /** FOLLOWING FROM THE HUB: read by the browser straight from a Farcaster node (lib/fc/hubRead/read.ts); its profile
   *  page is /fc/profile#<fid> (the fid in the fragment, never in a server request), and the node keeps no counts */
  hub?: true;
  /** BUILD A review (UXC-12): read DIRECTLY from Farcaster (DATA_SOURCE=neynar on the rig or the owner service — never
   *  the relay): a real account, whose profile Follow is a Farcaster follow by the acting persona */
  live?: true;
  /** MULTI-FID Gate 4: the shared anon account — rendered with the "anon" treatment, attributed to no one */
  anon?: true;
  /** MULTI-FID Gate 2: a granted viewer's merged identity (split avatar, "name / linked") — OUR client only.
   *  PERSONA LAUNCH P4: tier "ring" = a ring shared this account with this device; `linked` is then the ROOT (the left
   *  half of the avatar), `pfpUrl` is "" and its picture is `thumb` (an inline image sealed on the owner's device, never a
   *  URL — no request is ever made for either half), `sharedBy` the name the ring's owner goes by. */
  merged?: boolean;
  linked?: { username: string; displayName: string; pfpUrl: string; tier: string; thumb?: string | null; sharedBy?: string };
}

/** PERSONA LAUNCH P4: what a ring told THIS device about one anon post — set on the card only for a member whose ring
 *  holds the persona at depth "posts" (the key is ABSENT for everyone else, never null). Both halves' pictures are
 *  inline thumbnails or null (a monogram): rendering it makes no request. */
export interface RingShared {
  persona: { handle: string; displayName: string; thumb: string | null };
  root: { fname: string | null; displayName: string; thumb: string | null };
  label: string;
}

export interface ImageEmbed {
  type: "image";
  url: string;
}

export interface LinkEmbed {
  type: "link";
  url: string;
  domain: string;
  title: string;
  description?: string;
  image?: string;
  article?: boolean;
}

export interface QuoteEmbed {
  type: "quote";
  quote: Cast;
}

export type Embed = ImageEmbed | LinkEmbed | QuoteEmbed;

export interface Cast {
  hash: string;
  /** FC-READ: read through the public preview's read relay (a real Farcaster cast); read-only here — every network
   * write on it is refused per target (403 NETWORK_READ_ONLY) */
  network?: true;
  /** FOLLOWING FROM THE HUB: read by the browser straight from a Farcaster node (also `network`: read-only here). Its
   *  protocol id is (author.fid, hash), and its thread opens at /fc/cast#<fid>/<hash> (lib/fc/hubRead/copy.ts) */
  hub?: true;
  /** POST AS YOU ON HUB CARDS: a hub cast by one of the visitor's OWN persona accounts (a reply in someone else's thread):
   *  never liked, recast or replied to as the root (the device refuses it: own_persona). Absent everywhere else. */
  hubOwn?: true;
  /** MULTI-FID Gate 4: relayed through the shared anon account — no persona, no tier, no attribution, ever */
  anon?: true;
  /** anon only: the hash the reveal secret is keyed on — NOT the network hash above */
  castHash?: string;
  /** PERSONA LAUNCH P7: anon only — an anonymous post of the public preview's TEST universe: it stays inside the
   *  preview and is not on Farcaster; the card says so beside the anon badge (absent everywhere else) */
  previewOnly?: true;
  /** MULTI-FID PASS — the anoncast reveal pattern: set once the poster has chosen, later, to attribute
   * this anon cast to one of their real accounts; absent (never guessed) until they do.
   * ANON REVIEW (R3-17): `fname` is the account's NETWORK name (the persona↔fid record's), so the revealed badge
   * names the account the reveal picker offered ("@alice_fc"), not the Totem handle ("@alice"); null when the
   * record carries none, and the card falls back to the handle. */
  attributedTo?: {
    fid: number;
    handle: string;
    name: string;
    avatarUrl: string | null;
    fname?: string | null;
    /** PERSONA LAUNCH P6 (launch's field): where the reveal can be checked — this device's own records, or anyone, against
     *  the launched account's registered key ("chain") */
    checkable?: "own-device" | "chain";
    /** PERSONA LAUNCH P6 (UX-L9): false ONLY when the registered key was read from the real network's KeyRegistry. Absent
     *  or true = the validator's SIMULATED chain (fixture — the only chain this wave: live throws F25), and the card says
     *  "test data", never "anyone can check" */
    chainSimulated?: boolean;
  } | null;
  /** PERSONA LAUNCH P4: "@persona · shared with you by <label>" — a ring member's view of this anon post (absent otherwise) */
  ringShared?: RingShared;
  /** PERSONA LAUNCH P5 (reach's field): the reach tier an anon post proved ("posted by an account with 10k+ followers") */
  reach?: { issuer: string; bucket: string; label: string; treeSize: number } | null;
  author: User;
  text: string;
  /** epoch ms */
  timestamp: number;
  replies: number;
  likes: number;
  recasts: number;
  /**
   * Impressions. OPTIONAL because Farcaster has no such metric — confirmed
   * against live Neynar responses, whose cast object has no `views` key at
   * all. In live mode this is undefined and the UI omits the element;
   * rendering 0 would put a fabricated number on every real post.
   */
  views?: number;
  embeds: Embed[];
  /** repost attribution line ("X reposted") */
  recastedBy?: User;
  /** long cast: clamp with Show more */
  truncate?: boolean;
  /** self-thread indicator */
  threadCount?: number;
  /** FC pass: the wire's parent_hash. Live parent_author carries only a
   * fid (no username), so replyingTo is unset for live replies — this is
   * the reply FACT itself, and mode.hideReplies keys on it too. */
  parentHash?: string;
  /** FC pass: provenance tag set ONLY by the live mapper. The phase-1
   * persona heuristics (fid matching, marker stripping) gate on this per
   * cast — config-level gating misclassified fixture-fallback casts served
   * under live config, leaking raw persona markers into rendered text. */
  live?: boolean;
  /** persona layer: resolved by the validator, never computed locally */
  personaId?: string;
  tier?: number;
  /** breaking-news story grouping, drives saturation + debunk surfaces */
  storyId?: string | null;
  isUpdate?: boolean;
  /** reply context for permalink pages */
  replyingTo?: string;
  /** reply is a continuation by the thread author (connector line) */
  parentIsSelf?: boolean;
  viewerLiked?: boolean;
  viewerRecast?: boolean;
  /** MEGA PASS 2 Gate 1: verified stake summary on this cast from the public rows; absent when none */
  stakes?: import("./influence/types").CastStakeSummary;
  /** crosspost collapse: destinations this cast was also published to */
  alsoPostedTo?: string[];
  /** this card is the mirrored external copy of a local cast */
  mirrorOf?: string;
}

export interface NotificationItem {
  id: string;
  type: "like" | "follow" | "recast" | "reply" | "mention" | "new_post";
  actors: User[];
  timestamp: number;
  text: string;
  preview?: string;
  replyingTo?: string;
  views?: number;
  replies?: number;
  articleCard?: { title: string; description: string; image: string };
}

export interface Persona {
  id: string;
  // NO rootId. The validator still tracks roots internally, but the shape
  // that reaches a route handler — and therefore a browser — must not carry
  // it (architecture-v3, enforced by scripts/root-leak.mjs).
  name: string;
  handle: string;
  avatarUrl: string | null;
  bio: string | null;
  createdAt: number;
  /** PERSONA LAUNCH P1 (SIWF): the visitor's own Farcaster account, read-only (never an acting target) */
  publicSelf?: boolean;
}

export interface Trend {
  kind: "promoted" | "trend";
  category?: string;
  title: string;
  sub?: string;
  promotedBy?: string;
}

export interface NewsItem {
  title: string;
  meta: string;
  avatars: string[];
}

export interface LiveItem {
  host?: string;
  verified?: boolean;
  action?: string;
  title: string;
  viewers: string;
  avatars: string[];
}
