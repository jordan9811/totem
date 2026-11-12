import "server-only";
import { withMockLatency } from "../mockUtils";
import { AdapterError, type ModeAdapter, type ModeDefinition } from "../types";
import { nextId, state  } from "./store";
import { presetsForPersona } from "./presets";
import { isEmptyWorld } from "@/lib/world-flag";

/** LAYERS_WORLD=empty (lib/world.ts): with no persona yet the acting id is "" — there is nobody to seed presets for,
 *  and seeding them would write modes about nobody (which the flag would then hide on the next boot). */
function noPersonaYet(personaId: string): boolean {
  return !personaId && isEmptyWorld();
}

function ensurePresets(personaId: string) {
  if (noPersonaYet(personaId)) return;
  const s = state();
  for (const preset of presetsForPersona(personaId)) {
    if (!s.modes.has(preset.id)) s.modes.set(preset.id, preset);
  }
  if (!s.activeModeByPersona.has(personaId)) {
    s.activeModeByPersona.set(personaId, `mode_default_${personaId}`);
  }
}

export const mockModeAdapter: ModeAdapter = {
  async list(personaId) {
    return withMockLatency(() => {
      ensurePresets(personaId);
      return [...state().modes.values()].filter((m) => m.personaId === personaId);
    }, { label: "mode.list" });
  },

  async get(modeId) {
    return withMockLatency(() => state().modes.get(modeId) ?? null, { label: "mode.get" });
  },

  async getActive(personaId) {
    return withMockLatency(() => {
      if (noPersonaYet(personaId)) throw new AdapterError("no persona yet — create one in Settings > Account & Personas", "NOT_FOUND");
      ensurePresets(personaId);
      const s = state();
      const activeId = s.activeModeByPersona.get(personaId)!;
      return s.modes.get(activeId) ?? s.modes.get(`mode_default_${personaId}`)!;
    }, { label: "mode.getActive" });
  },

  async setActive(personaId, modeId) {
    return withMockLatency(() => {
      if (noPersonaYet(personaId)) throw new AdapterError("no persona yet — create one in Settings > Account & Personas", "NOT_FOUND");
      ensurePresets(personaId);
      const s = state();
      if (!s.modes.has(modeId)) throw new AdapterError("unknown mode", "NOT_FOUND");
      s.activeModeByPersona.set(personaId, modeId);
    }, { label: "mode.setActive" });
  },

  async create(mode) {
    return withMockLatency(() => {
      const created: ModeDefinition = { ...mode, id: nextId("mode"), createdAt: Date.now() };
      state().modes.set(created.id, created);
      return created;
    }, { label: "mode.create" });
  },

  async update(modeId, patch) {
    return withMockLatency(() => {
      const s = state();
      const existing = s.modes.get(modeId);
      if (!existing) throw new AdapterError("unknown mode", "NOT_FOUND");
      const updated = { ...existing, ...patch };
      // Editing an imported algorithm forks it: provenance flips to
      // "modified from @author's algo vN" and stays that way. The chain is
      // history, so nothing un-flips it short of re-importing the original.
      if (existing.importedFrom && !patch.importedFrom) {
        updated.importedFrom = { ...existing.importedFrom, modifiedLocally: true };
      }
      s.modes.set(modeId, updated);
      return updated;
    }, { label: "mode.update" });
  },

  async duplicate(modeId, newName) {
    return withMockLatency(() => {
      const s = state();
      const existing = s.modes.get(modeId);
      if (!existing) throw new AdapterError("unknown mode", "NOT_FOUND");
      const copy: ModeDefinition = {
        ...existing,
        id: nextId("mode"),
        name: newName,
        isPreset: false,
        createdAt: Date.now(),
      };
      s.modes.set(copy.id, copy);
      return copy;
    }, { label: "mode.duplicate" });
  },

  async delete(modeId) {
    return withMockLatency(() => {
      const s = state();
      const mode = s.modes.get(modeId);
      if (mode?.isPreset) throw new AdapterError("presets cannot be deleted", "FORBIDDEN");
      s.modes.delete(modeId);
      // Fall back to Default if the deleted mode was active.
      for (const [personaId, activeId] of s.activeModeByPersona) {
        if (activeId === modeId) s.activeModeByPersona.set(personaId, `mode_default_${personaId}`);
      }
    }, { label: "mode.delete" });
  },

  async presets() {
    return withMockLatency(() => presetsForPersona("__template__"), { label: "mode.presets" });
  },
};
