import "server-only";
// PROD-LIVE (D-CU-0-4): the builders behind the folders / channels / rooms pages.
//
// ONE builder, TWO callers. On the rig the server page calls it and hands the result to the page's client island as
// its initial data (so the DOM is what the page always rendered). On a public deployment the server has no identity
// and does not call it at all: the island fetches GET /api/{folders,channels,rooms}/view, which the browser device
// answers by running THIS code in-process against the visitor's own store.
//
// Each builder is the page's old inline computation, moved verbatim — same reads, same order, same fallbacks — with
// one rule: a read the page used to CATCH stays caught here only where the catch is part of the product (the channel
// membership gate). Everything else THROWS, and each caller decides: the rig page keeps its old semantics (catch ->
// error line / notFound()), the view route answers 503 so the island shows an error with a Retry. Never fail open.
import { adapters } from "@/lib/adapters/registry";
import { retryAdapter } from "@/lib/adapters/retry";
import { SEED_POSTS, absoluteTime, personaById, postByHash } from "@/lib/adapters/mock/store";
import type { Cast } from "@/lib/types";
import type { AlgoCard } from "@/lib/algo/service";
import type {
  AlgoCardSummary,
  ChannelDetailView,
  ChannelsView,
  FolderDetailView,
  FoldersView,
  RoomDetailView,
  RoomsView,
} from "./types";

type SeedPost = NonNullable<ReturnType<typeof postByHash.get>>;

/** the Cast shape the channel and folder pages have always built from a seeded post */
function seedCast(p: SeedPost, withTruncate: boolean): Cast {
  const author = personaById.get(p.authorPersonaId);
  return {
    hash: p.hash,
    author: {
      fid: 0,
      username: author?.handle ?? "unknown",
      displayName: author?.name ?? "Unknown",
      pfpUrl: author?.avatarUrl ?? "",
      followerCount: 0,
      followingCount: 0,
      verified: (author?.tier ?? 1) >= 7,
    },
    text: p.text,
    timestamp: absoluteTime(p.minutesAgo),
    replies: p.replies,
    likes: p.likes,
    recasts: p.recasts,
    views: p.views,
    embeds: [],
    ...(withTruncate ? { truncate: p.truncate } : {}),
    personaId: p.authorPersonaId,
    tier: author?.tier,
  };
}

export function algoCardSummary(card: AlgoCard): AlgoCardSummary {
  const a = card.artifact;
  const author = personaById.get(a.authorPersonaId);
  return {
    id: card.id,
    name: a.name,
    kind: a.kind,
    authorHandle: a.authorHandle,
    authorName: author?.name ?? a.authorHandle,
    algoVersion: a.algoVersion,
    forkedFrom: a.forkedFrom ? { authorHandle: a.forkedFrom.authorHandle, algoVersion: a.forkedFrom.algoVersion } : null,
    summary: a.summary,
  };
}

// ------------------------------------------------------------------ folders

/** /folders. Throws when either read fails (the page renders "Couldn't load folders."). */
export async function foldersView(personaId: string): Promise<FoldersView> {
  const [folders, followed] = await Promise.all([
    retryAdapter(() => adapters.space.listFolders(personaId)),
    retryAdapter(() => adapters.space.followedFolders(personaId)),
  ]);
  return {
    folders: folders.map((f) => ({
      id: f.id,
      name: f.name,
      isPublic: f.isPublic,
      postCount: f.postHashes.length,
      ownerHandle: personaById.get(f.ownerPersonaId)?.handle ?? "unknown",
      canFollow: f.isPublic && f.ownerPersonaId !== personaId,
      following: followed.includes(f.id),
      preview: f.postHashes.slice(0, 4).map((h) => {
        const p = postByHash.get(h);
        return p ? { authorHandle: personaById.get(p.authorPersonaId)?.handle ?? null, text: p.text } : null;
      }),
    })),
  };
}

/**
 * /folders/[folderId]. FAIL CLOSED: null when the folder is not visible to this persona (a private folder for a
 * non-owner) or does not exist — never the contents. THROWS when the permission check or the folder read fails; the
 * rig page turns that into a 404 exactly as it always did, the view route into a 503.
 */
export async function folderDetailView(folderId: string, personaId: string): Promise<FolderDetailView | null> {
  const canView = await retryAdapter(() => adapters.space.canViewFolder(folderId, personaId));
  if (!canView) return null;
  const folder = await retryAdapter(() => adapters.space.getFolder(folderId));
  if (!folder) return null;

  const owner = personaById.get(folder.ownerPersonaId);
  // (loaded here, not at the top: the list pages that share this module have no use for the algo/feed machinery)
  const { getAlgoCard } = await import("@/lib/algo/service");
  // Folders hold posts AND published algorithms through the same slot —
  // marketplace-lite is folder infrastructure, not a parallel system.
  const algoCards = folder.postHashes
    .map((h) => getAlgoCard(h))
    .filter((c): c is AlgoCard => !!c)
    .map(algoCardSummary);
  // X-imported bookmarks ride the same folder slot as everything else,
  // resolved from the import store by their bookmark:<tweetId> ids
  const { importedPrivateFor } = await import("@/lib/x/importer");
  const importedById = new Map(importedPrivateFor(folder.ownerPersonaId).map((r) => [r.id, r]));
  const importedBookmarks = folder.postHashes
    .filter((h) => h.startsWith("bookmark:"))
    .map((h) => importedById.get(h))
    .filter((b): b is NonNullable<typeof b> => !!b)
    .map((b) => ({ id: b.id, text: b.text }));
  const casts: Cast[] = folder.postHashes
    .map((h) => postByHash.get(h))
    .filter((p): p is SeedPost => !!p)
    .map((p) => seedCast(p, true));

  return {
    folder: {
      id: folder.id,
      name: folder.name,
      postCount: folder.postHashes.length,
      ownerHandle: owner?.handle ?? "unknown",
    },
    algoCards,
    importedBookmarks,
    casts,
  };
}

// ----------------------------------------------------------------- channels

/** /channels. Throws when either read fails — the page then renders every channel locked (i.e. none), with the
 *  "couldn't confirm your memberships" line. */
export async function channelsView(personaId: string): Promise<ChannelsView> {
  const [channels, visible] = await Promise.all([
    retryAdapter(() => adapters.space.listChannels(personaId)),
    retryAdapter(() => adapters.space.visibleChannelIds(personaId)),
  ]);
  const visibleSet = new Set(visible);
  return {
    channels: channels.map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      policy: c.policy,
      ownerHandle: personaById.get(c.ownerPersonaId)?.handle ?? "unknown",
      unlocked: visibleSet.has(c.id),
    })),
  };
}

/**
 * /channels/[channelId]. null = no such channel. THROWS only when the channel itself cannot be read.
 *
 * `strict` is the view route's setting: the member roster that the rig page has always read leniently (an unread
 * roster rendered "0 members") must not be lenient on a surface whose only source is this answer — there it throws.
 * The MEMBERSHIP check is never lenient in either shape: a check that errors is not membership (gated-pass ground
 * rule 4), and the view says so with `checkFailed` instead of throwing, because "locked, and here is why" is the
 * product's answer to that failure.
 */
export async function channelDetailView(
  channelId: string,
  personaId: string,
  opts: { strict?: boolean } = {}
): Promise<ChannelDetailView | null> {
  const channel = await retryAdapter(() => adapters.space.getChannel(channelId));
  if (!channel) return null;

  // THE GATE. A membership check that errors is not membership — the
  // channel renders locked, never open (gated-pass ground rule 4).
  let isMember = false;
  let checkFailed = false;
  try {
    isMember = await retryAdapter(() => adapters.space.isMember(channelId, personaId));
  } catch {
    checkFailed = true;
    isMember = false;
  }

  const readMembers = () => retryAdapter(() => adapters.space.members(channelId));
  const members = isMember ? await (opts.strict ? readMembers() : readMembers().catch(() => [])) : [];

  const posts: Cast[] = isMember
    ? SEED_POSTS.filter((p) => p.channelId === channelId).map((p) => seedCast(p, false))
    : [];

  return {
    channel: { id: channel.id, name: channel.name, description: channel.description, policy: channel.policy },
    isMember,
    checkFailed,
    memberCount: members.length,
    posts,
  };
}

// -------------------------------------------------------------------- rooms

/** /rooms. Throws when the list cannot be read. */
export async function roomsView(): Promise<RoomsView> {
  const rooms = await retryAdapter(() => adapters.space.listRooms());
  return {
    rooms: rooms.map((r) => {
      const host = personaById.get(r.hostPersonaId);
      return {
        id: r.id,
        title: r.title,
        status: r.status,
        topicCluster: r.topicCluster,
        hostHandle: host?.handle ?? "unknown",
        hostAvatarUrl: host?.avatarUrl ?? "",
      };
    }),
  };
}

/**
 * /rooms/[roomId]. null = no such room. THROWS when the room cannot be read. `strict` (the view route): an unread
 * message list or highlight list throws too, instead of rendering as an empty room — the rig page keeps its lenient
 * read (RoomStage re-polls the room itself once it is open).
 */
export async function roomDetailView(roomId: string, opts: { strict?: boolean } = {}): Promise<RoomDetailView | null> {
  const room = await retryAdapter(() => adapters.space.getRoom(roomId));
  if (!room) return null;
  const lenient = <T,>(p: Promise<T[]>): Promise<T[]> => (opts.strict ? p : p.catch(() => [] as T[]));
  const [messages, highlights] = await Promise.all([
    lenient(retryAdapter(() => adapters.space.roomMessages(roomId))),
    lenient(retryAdapter(() => adapters.space.listHighlights(roomId))),
  ]);
  const host = personaById.get(room.hostPersonaId);
  const people = Object.fromEntries(
    [...new Set(room.script.map((m) => m.personaId))].map((id) => {
      const p = personaById.get(id);
      return [id, { handle: p?.handle ?? "unknown", name: p?.name ?? "Unknown", avatarUrl: p?.avatarUrl ?? "", tier: p?.tier ?? 1 }];
    })
  );
  return { room, messages, highlights, hostHandle: host?.handle ?? "unknown", people };
}
