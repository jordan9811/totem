// PROD-LIVE (D-CU-0-4): the VIEW MODELS of the space pages — folders, channels, rooms and the algo preview.
//
// On a public deployment the server holds no identity, so these pages cannot be computed there: the page renders a
// shell and a client island asks the browser device for the view (GET /api/{folders,channels,rooms,algo}/view). On
// the rig the server computes the SAME view with the SAME builder (lib/views/spaces.ts, lib/views/algo.ts) and hands
// it to the island as its initial data, so the DOM the suites read is what it always was.
//
// This module is deliberately import-free at runtime (types and one constant) so a client island can import it;
// the builders are server/device-only (they read the mock store).
//
// Every field here is something the page RENDERS — never a raw seed persona record. Those carry `rootId`, and a
// page payload that carries a rootId key is a root leak (scripts/root-leak.mjs scans /channels, /folders, /market).
import type { Cast } from "@/lib/types";
import type { MembershipPolicy, Room, RoomHighlight, RoomMessage } from "@/lib/adapters/types";
import type { AlgoArtifact } from "@/lib/algo/artifact";
import type { AlgoPreview } from "@/lib/algo/service";

/** The body of a view route's 404. An island compares the error message to this to render its OWN not-found state
 *  (a 404 is "there is nothing here for you", distinct from "the read failed", which gets an error and a Retry). */
export const VIEW_NOT_FOUND = "view: not found";

// ------------------------------------------------------------------ folders

export interface FolderPreviewView {
  /** null when the seed has no persona for the author (the page always rendered a bare "@" then) */
  authorHandle: string | null;
  text: string;
}

export interface FolderRowView {
  id: string;
  name: string;
  isPublic: boolean;
  postCount: number;
  ownerHandle: string;
  /** public and not the viewer's own — the page offers Follow */
  canFollow: boolean;
  following: boolean;
  /** first four post slots; null where the hash resolves to no seeded post */
  preview: (FolderPreviewView | null)[];
}

export interface FoldersView {
  folders: FolderRowView[];
}

/** what the shareable algo card renders — no more (AlgoCardView) */
export interface AlgoCardSummary {
  id: string;
  name: string;
  kind: AlgoArtifact["kind"];
  authorHandle: string;
  /** the author persona's display name, or the artifact's handle when the store has no such persona */
  authorName: string;
  algoVersion: number;
  forkedFrom: { authorHandle: string; algoVersion: number } | null;
  summary: string;
}

export interface FolderDetailView {
  folder: { id: string; name: string; postCount: number; ownerHandle: string };
  algoCards: AlgoCardSummary[];
  importedBookmarks: { id: string; text: string }[];
  casts: Cast[];
}

// ----------------------------------------------------------------- channels

export interface ChannelRowView {
  id: string;
  name: string;
  description: string;
  policy: MembershipPolicy;
  ownerHandle: string;
  unlocked: boolean;
}

export interface ChannelsView {
  channels: ChannelRowView[];
}

export interface ChannelDetailView {
  channel: { id: string; name: string; description: string; policy: MembershipPolicy };
  isMember: boolean;
  /** THE GATE: the membership check errored, so the channel renders locked (never open) and says so */
  checkFailed: boolean;
  /** only meaningful for a member — the roster is not read for anyone else */
  memberCount: number;
  posts: Cast[];
}

// -------------------------------------------------------------------- rooms

export interface RoomRowView {
  id: string;
  title: string;
  status: Room["status"];
  topicCluster: string;
  hostHandle: string;
  hostAvatarUrl: string;
}

export interface RoomsView {
  rooms: RoomRowView[];
}

export interface RoomPerson {
  handle: string;
  name: string;
  avatarUrl: string;
  tier: number;
}

export interface RoomDetailView {
  room: Room;
  messages: RoomMessage[];
  highlights: RoomHighlight[];
  hostHandle: string;
  people: Record<string, RoomPerson>;
}

// --------------------------------------------------------------------- algo

export interface AlgoDetailView {
  cardId: string;
  /** AlgoActivate imports exactly this artifact (it always received it as a prop) */
  artifact: AlgoArtifact;
  authorName: string;
  /** what the page renders — the lens influence delta is not on this page, so it is not in its payload */
  preview: Omit<AlgoPreview, "influence">;
}

// ------------------------------------------------------------------- market

/** GET /api/market/measurement answers exactly this (aggregates only — no user identifiers, by construction) */
export interface MeasurementRow {
  name: string;
  campaignId: string;
  impressions: number;
  conversions: number;
  noiseBound: number;
}
