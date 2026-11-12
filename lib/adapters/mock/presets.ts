import "server-only";
import type { ModeDefinition, Rule } from "../types";
import { SEED_STORY_ID } from "./store";

// Preset-owned rules. These are real Rule objects evaluated by
// lib/rules/evaluate.ts — presets don't get special-case filter logic.
export const PRESET_RULES: Record<string, Rule> = {
  rule_no_breaking: {
    id: "rule_no_breaking",
    name: "Hide breaking-news stories",
    action: "hide",
    root: {
      combinator: "AND",
      clauses: [{ field: "post.topicId", op: "eq", value: SEED_STORY_ID }],
    },
    createdAt: 0,
  },
  rule_no_low_tier: {
    id: "rule_no_low_tier",
    name: "Hide posts from tier 1–2 accounts",
    action: "hide",
    root: {
      combinator: "AND",
      clauses: [{ field: "author.tier", op: "lt", value: 3 }],
    },
    createdAt: 0,
  },
  rule_work_clusters: {
    id: "rule_work_clusters",
    name: "Hide non-professional topics",
    action: "hide",
    root: {
      combinator: "AND",
      negate: true,
      clauses: [{ field: "author.cluster", op: "in", value: ["crypto", "history"] }],
    },
    createdAt: 0,
  },
  rule_old_posts: {
    id: "rule_old_posts",
    name: "Hide posts older than a day",
    action: "hide",
    root: {
      combinator: "AND",
      clauses: [{ field: "post.age", op: "gt", value: 1440 }],
    },
    createdAt: 0,
  },
};
// Note: "hide replies" is deliberately NOT a rule. The rules engine
// evaluates a post's own fields, and reply-ness is a structural property of
// the feed graph rather than the post — Curate expresses it with the
// `hideReplies` mode flag instead of a rule that would have to lie about
// what it matches.

export function presetsForPersona(personaId: string): ModeDefinition[] {
  // Full chrome. Once actionButtonSlots became ENFORCED, the values stored
  // here started deciding what renders — and they were written while nothing
  // read them, so they were never meant as UI configuration. A shared `base`
  // of three nav items silently amputated the sidebar for every mode
  // including Default. Each preset now states what it actually intends.
  const FULL_NAV = [
    "home",
    "explore",
    "notifications",
    "messages",
    "grok",
    "premium",
    "money",
    "channels",
    "rooms",
    "market",
    "history",
    "creator-studio",
    "articles",
    "profile",
  ];
  const FULL_COMPOSER = ["media", "gif", "grok", "poll", "emoji", "schedule", "location", "flag"];

  const base = {
    personaId,
    isPreset: true,
    createdAt: 0,
    actionButtonSlots: { composer: FULL_COMPOSER, nav: FULL_NAV },
  };
  return [
    {
      ...base,
      id: `mode_default_${personaId}`,
      name: "Default",
      ranking: { recency: 0.4, engagement: 0.3, authorAffinity: 0.2, clusterAffinity: 0.1 },
      ruleIds: [],
      notificationPolicy: "all",
      showTrending: true,
      calmRanking: false,
    },
    {
      ...base,
      id: `mode_work_${personaId}`,
      name: "Work",
      // Only followed accounts in professional clusters, no trending,
      // muted notifications.
      ranking: { recency: 0.3, engagement: 0.1, authorAffinity: 0.5, clusterAffinity: 0.1 },
      ruleIds: ["rule_work_clusters"],
      notificationPolicy: "muted",
      showTrending: false,
      calmRanking: false,
      followedOnly: true,
      // Work mode means fewer places to wander. Now that the field is
      // enforced, this is a real difference you can see, not a stored value.
      actionButtonSlots: {
        composer: ["media", "poll", "schedule"],
        nav: ["home", "notifications", "messages", "articles", "profile"],
      },
    },
    {
      ...base,
      id: `mode_safe_${personaId}`,
      name: "Event Safe Space",
      ranking: { recency: 0.2, engagement: 0.1, authorAffinity: 0.4, clusterAffinity: 0.3 },
      ruleIds: ["rule_no_breaking", "rule_no_low_tier"],
      notificationPolicy: "mentions_only",
      showTrending: false,
      calmRanking: true,
      // No ad units in a safe-space mode. This is the mode property the
      // feed reads; there is no per-surface special case.
      allowAds: false,
    },
    {
      ...base,
      id: `mode_curate_${personaId}`,
      name: "Curate",
      // Bookmarks and long-form heavy, no replies.
      ranking: { recency: 0.1, engagement: 0.2, authorAffinity: 0.3, clusterAffinity: 0.4 },
      ruleIds: [],
      notificationPolicy: "mentions_only",
      showTrending: false,
      calmRanking: true,
      longformOnly: true,
      hideReplies: true,
      actionButtonSlots: {
        composer: ["media", "emoji"],
        nav: ["home", "history", "articles", "channels", "profile"],
        // MEGA PASS 2 Gate 3: a curation row — Default keeps X's row exactly (parity), this mode does not
        cast: ["reply", "recast", "like", "views", "bookmark-to-folder", "stake-as"],
      },
    },
  ];
}
