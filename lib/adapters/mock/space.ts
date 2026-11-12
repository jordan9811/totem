import "server-only";
import { withMockLatency } from "../mockUtils";
import { AdapterError } from "../types";
import type {
  BookmarkFolder,
  Channel,
  ChannelMembership,
  Room,
  RoomHighlight,
  RoomMessage,
  SpaceAdapter,
} from "../types";
import spacesRaw from "@/seed/data/spaces.json";
import { nextId, state } from "./store";
import { bank } from "@/lib/world";
import { marketClock } from "./clock";

interface SeedRoom extends Omit<Room, "scheduledFor"> {
  scheduledForMinutes: number;
}

// LAYERS_WORLD=empty (lib/world.ts): no seeded channels, folders or rooms — only what real personas make
const SEED_CHANNELS = bank(spacesRaw.channels as Channel[], []);
const SEED_FOLDERS = bank(spacesRaw.folders as BookmarkFolder[], []);
const SEED_ROOMS = bank(spacesRaw.rooms as unknown as SeedRoom[], []);

/** Seed rows are the baseline; mutable state overlays them. */
function allChannels(): Channel[] {
  const s = state();
  const merged = new Map(SEED_CHANNELS.map((c) => [c.id, c]));
  for (const [id, c] of s.channels) merged.set(id, c);
  return [...merged.values()];
}

function allFolders(): BookmarkFolder[] {
  const s = state();
  const merged = new Map(SEED_FOLDERS.map((f) => [f.id, f]));
  for (const [id, f] of s.folders) merged.set(id, f);
  return [...merged.values()];
}

function allRooms(): Room[] {
  const s = state();
  const base = SEED_ROOMS.map((r) => ({
    ...r,
    scheduledFor: marketClock.now() + r.scheduledForMinutes * 60_000,
  })) as Room[];
  const merged = new Map(base.map((r) => [r.id, r]));
  for (const [id, r] of s.rooms) merged.set(id, r);
  return [...merged.values()];
}

function membershipsOf(channelId: string): ChannelMembership[] {
  return state().channelMembers.get(channelId) ?? [];
}

export const mockSpaceAdapter: SpaceAdapter = {
  async listChannels(viewerPersonaId) {
    return withMockLatency(() => allChannels(), { label: "space.listChannels" });
  },

  async getChannel(channelId) {
    return withMockLatency(() => allChannels().find((c) => c.id === channelId) ?? null, {
      label: "space.getChannel",
    });
  },

  async createChannel(input) {
    return withMockLatency(() => {
      const created: Channel = { ...input, id: nextId("chan"), createdAt: Date.now() };
      state().channels.set(created.id, created);
      // Creator is a member of their own channel.
      const members = membershipsOf(created.id);
      members.push({
        channelId: created.id,
        personaId: input.ownerPersonaId,
        status: "member",
        joinedAt: Date.now(),
      });
      state().channelMembers.set(created.id, members);
      return created;
    }, { label: "space.createChannel" });
  },

  // The gate. Callers must treat a rejection as NOT a member (fail closed) —
  // this method never returns false to mean "couldn't tell".
  async isMember(channelId, personaId) {
    return withMockLatency(() => {
      const channel = allChannels().find((c) => c.id === channelId);
      if (!channel) throw new AdapterError("unknown channel", "NOT_FOUND");
      if (channel.ownerPersonaId === personaId) return true;
      return membershipsOf(channelId).some(
        (m) => m.personaId === personaId && m.status === "member"
      );
    }, { label: "space.isMember" });
  },

  async members(channelId) {
    return withMockLatency(() => {
      const channel = allChannels().find((c) => c.id === channelId);
      if (!channel) throw new AdapterError("unknown channel", "NOT_FOUND");
      const owner: ChannelMembership = {
        channelId,
        personaId: channel.ownerPersonaId,
        status: "member",
        joinedAt: channel.createdAt,
      };
      return [owner, ...membershipsOf(channelId)];
    }, { label: "space.members" });
  },

  async join(channelId, personaId) {
    return withMockLatency(() => {
      const channel = allChannels().find((c) => c.id === channelId);
      if (!channel) throw new AdapterError("unknown channel", "NOT_FOUND");
      // Policy decides what "join" yields. Invite-only cannot be
      // self-served — that is the point of the policy.
      const status: ChannelMembership["status"] =
        channel.policy === "open" ? "member" : channel.policy === "request" ? "requested" : "invited";
      if (channel.policy === "invite") {
        throw new AdapterError("invite-only channel", "FORBIDDEN");
      }
      const members = membershipsOf(channelId).filter((m) => m.personaId !== personaId);
      const membership: ChannelMembership = { channelId, personaId, status, joinedAt: Date.now() };
      members.push(membership);
      state().channelMembers.set(channelId, members);
      return membership;
    }, { label: "space.join" });
  },

  async visibleChannelIds(personaId) {
    return withMockLatency(() => {
      const out: string[] = [];
      for (const channel of allChannels()) {
        if (channel.ownerPersonaId === personaId) {
          out.push(channel.id);
          continue;
        }
        const member = membershipsOf(channel.id).some(
          (m) => m.personaId === personaId && m.status === "member"
        );
        if (member) out.push(channel.id);
      }
      return out;
    }, { label: "space.visibleChannelIds" });
  },

  // ---------- folders ----------

  async listFolders(viewerPersonaId) {
    return withMockLatency(
      () => allFolders().filter((f) => f.isPublic || f.ownerPersonaId === viewerPersonaId),
      { label: "space.listFolders" }
    );
  },

  async getFolder(folderId) {
    return withMockLatency(() => allFolders().find((f) => f.id === folderId) ?? null, {
      label: "space.getFolder",
    });
  },

  async canViewFolder(folderId, viewerPersonaId) {
    return withMockLatency(() => {
      const folder = allFolders().find((f) => f.id === folderId);
      if (!folder) throw new AdapterError("unknown folder", "NOT_FOUND");
      return folder.isPublic || folder.ownerPersonaId === viewerPersonaId;
    }, { label: "space.canViewFolder" });
  },

  async createFolder(input) {
    return withMockLatency(() => {
      const created: BookmarkFolder = { ...input, id: nextId("folder"), createdAt: Date.now() };
      state().folders.set(created.id, created);
      return created;
    }, { label: "space.createFolder" });
  },

  async setFolderPublic(folderId, isPublic) {
    return withMockLatency(() => {
      const folder = allFolders().find((f) => f.id === folderId);
      if (!folder) throw new AdapterError("unknown folder", "NOT_FOUND");
      const updated = { ...folder, isPublic };
      state().folders.set(folderId, updated);
      return updated;
    }, { label: "space.setFolderPublic" });
  },

  async addToFolder(folderId, postHash) {
    return withMockLatency(() => {
      const folder = allFolders().find((f) => f.id === folderId);
      if (!folder) throw new AdapterError("unknown folder", "NOT_FOUND");
      if (folder.postHashes.includes(postHash)) return folder;
      // New additions go to the FRONT — followers see the newest first,
      // which is what makes "its next addition lands in your timeline" work.
      const updated = { ...folder, postHashes: [postHash, ...folder.postHashes] };
      state().folders.set(folderId, updated);
      return updated;
    }, { label: "space.addToFolder" });
  },

  async followFolder(personaId, folderId) {
    return withMockLatency(() => {
      const s = state();
      if (!s.folderFollows.has(personaId)) s.folderFollows.set(personaId, new Set());
      s.folderFollows.get(personaId)!.add(folderId);
    }, { label: "space.followFolder" });
  },

  async unfollowFolder(personaId, folderId) {
    return withMockLatency(() => {
      state().folderFollows.get(personaId)?.delete(folderId);
    }, { label: "space.unfollowFolder" });
  },

  async followedFolders(personaId) {
    return withMockLatency(() => [...(state().folderFollows.get(personaId) ?? [])], {
      label: "space.followedFolders",
    });
  },

  // ---------- rooms ----------

  async listRooms() {
    return withMockLatency(() => allRooms(), { label: "space.listRooms" });
  },

  async getRoom(roomId) {
    return withMockLatency(() => allRooms().find((r) => r.id === roomId) ?? null, {
      label: "space.getRoom",
    });
  },

  async openRoom(roomId) {
    return withMockLatency(() => {
      const room = allRooms().find((r) => r.id === roomId);
      if (!room) throw new AdapterError("unknown room", "NOT_FOUND");
      const updated: Room = { ...room, status: "open", openedAt: marketClock.now() };
      state().rooms.set(roomId, updated);
      return updated;
    }, { label: "space.openRoom" });
  },

  async closeRoom(roomId) {
    return withMockLatency(() => {
      const room = allRooms().find((r) => r.id === roomId);
      if (!room) throw new AdapterError("unknown room", "NOT_FOUND");
      const updated: Room = { ...room, status: "closed", closedAt: marketClock.now() };
      state().rooms.set(roomId, updated);
      return updated;
    }, { label: "space.closeRoom" });
  },

  // Liveness simulation: a scripted message is "posted" once the room has
  // been open for at least its atMs offset. Deterministic, and driven by the
  // controllable market clock so tests never wait on real time.
  async roomMessages(roomId, nowMs) {
    return withMockLatency(() => {
      const room = allRooms().find((r) => r.id === roomId);
      if (!room) throw new AdapterError("unknown room", "NOT_FOUND");
      if (room.status === "scheduled" || room.openedAt === null) return [];
      const now = nowMs ?? marketClock.now();
      const elapsed = (room.closedAt ?? now) - room.openedAt;
      return room.script
        .filter((m) => m.atMs <= elapsed)
        .filter((m) => !room.mutedPersonaIds.includes(m.personaId))
        .map((m, i) => ({
          id: `${roomId}:msg${i}`,
          roomId,
          personaId: m.personaId,
          text: m.text,
          atMs: room.openedAt! + m.atMs,
        })) as RoomMessage[];
    }, { label: "space.roomMessages" });
  },

  async markHighlight(roomId, messageId) {
    return withMockLatency(() => {
      const room = allRooms().find((r) => r.id === roomId);
      if (!room) throw new AdapterError("unknown room", "NOT_FOUND");
      const idx = Number(messageId.split("msg")[1]);
      const scripted = room.script[idx];
      if (!scripted) throw new AdapterError("unknown message", "NOT_FOUND");
      const highlight: RoomHighlight = {
        id: nextId("hl"),
        roomId,
        messageId,
        personaId: scripted.personaId,
        text: scripted.text,
        markedAt: marketClock.now(),
      };
      const list = state().highlights.get(roomId) ?? [];
      if (!list.some((h) => h.messageId === messageId)) list.push(highlight);
      state().highlights.set(roomId, list);
      return highlight;
    }, { label: "space.markHighlight" });
  },

  async listHighlights(roomId) {
    return withMockLatency(() => state().highlights.get(roomId) ?? [], {
      label: "space.listHighlights",
    });
  },

  async pinMessage(roomId, messageId) {
    return withMockLatency(() => {
      const room = allRooms().find((r) => r.id === roomId);
      if (!room) throw new AdapterError("unknown room", "NOT_FOUND");
      const updated = { ...room, pinnedMessageId: messageId };
      state().rooms.set(roomId, updated);
      return updated;
    }, { label: "space.pinMessage" });
  },

  async muteParticipant(roomId, personaId, muted) {
    return withMockLatency(() => {
      const room = allRooms().find((r) => r.id === roomId);
      if (!room) throw new AdapterError("unknown room", "NOT_FOUND");
      const set = new Set(room.mutedPersonaIds);
      if (muted) set.add(personaId);
      else set.delete(personaId);
      const updated = { ...room, mutedPersonaIds: [...set] };
      state().rooms.set(roomId, updated);
      return updated;
    }, { label: "space.muteParticipant" });
  },
};

export { SEED_CHANNELS, SEED_FOLDERS };
