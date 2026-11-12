import "server-only";
import { withMockLatency } from "../mockUtils";
import { AdapterError, type Rule, type RulesAdapter } from "../types";
import { evaluateGroup } from "@/lib/rules/evaluate";
import { SEED_POSTS, nextId, personaById, state  } from "./store";
import { PRESET_RULES } from "./presets";

function ensurePresetRules() {
  const s = state();
  for (const [id, rule] of Object.entries(PRESET_RULES)) {
    if (!s.rules.has(id)) s.rules.set(id, { ...rule, personaId: "__preset__" });
  }
}

export const mockRulesAdapter: RulesAdapter = {
  async list(personaId) {
    return withMockLatency(() => {
      ensurePresetRules();
      return [...state().rules.values()].filter((r) => r.personaId === personaId || r.personaId === "__preset__");
    }, { label: "rules.list" });
  },

  async get(ruleId) {
    return withMockLatency(() => {
      ensurePresetRules();
      return state().rules.get(ruleId) ?? null;
    }, { label: "rules.get" });
  },

  async create(rule) {
    return withMockLatency(() => {
      const created: Rule & { personaId: string } = {
        id: nextId("rule"),
        name: rule.name,
        action: rule.action,
        root: rule.root,
        createdAt: Date.now(),
        personaId: rule.personaId,
      };
      state().rules.set(created.id, created);
      return created;
    }, { label: "rules.create" });
  },

  async update(ruleId, patch) {
    return withMockLatency(() => {
      const s = state();
      const existing = s.rules.get(ruleId);
      if (!existing) throw new AdapterError("unknown rule", "NOT_FOUND");
      const updated = { ...existing, ...patch };
      s.rules.set(ruleId, updated);
      return updated;
    }, { label: "rules.update" });
  },

  async delete(ruleId) {
    return withMockLatency(() => {
      state().rules.delete(ruleId);
    }, { label: "rules.delete" });
  },

  async previewCount(root) {
    return withMockLatency(() => {
      // Live preview against the seeded feed — deterministic seed makes this
      // an exact number the acceptance test can assert on.
      let count = 0;
      for (const post of SEED_POSTS) {
        const author = personaById.get(post.authorPersonaId);
        const matched = evaluateGroup(root, {
          post: {
            hash: post.hash,
            topicId: post.storyId,
            isUpdate: post.isUpdate,
            hasMedia: false,
            ageMinutes: post.minutesAgo,
            text: post.text,
          },
          author: {
            personaId: post.authorPersonaId,
            tier: author?.tier ?? 1,
            cluster: author?.cluster ?? null,
          },
          viewer: { personaId: null, followingPersonaIds: [] },
        });
        if (matched) count += 1;
      }
      return count;
    }, { label: "rules.previewCount" });
  },
};
