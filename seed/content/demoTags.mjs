// Maps EXISTING seed accounts to the features they demonstrate. No new
// accounts are invented — this is a tagging layer over accounts.mjs so a
// demo can jump straight to "show me the account that proves X".
// Keys are account ids from ACCOUNTS (and extraPersona ids).

export const DEMO_TAGS = {
  // --- multi-persona roots: cross-persona blocking + disclosure linkage ---
  acc_crypto_2: ["multi-persona", "cross-persona-block", "disclosure-linkage"],
  acc_crypto_2_alt: ["multi-persona", "facet-follow", "cross-persona-block"],
  acc_fantasy_2: ["multi-persona", "cross-persona-block", "unlock-request"],
  acc_fantasy_2_alt: ["multi-persona", "facet-follow"],
  acc_food_1: ["multi-persona", "facet-follow", "public-folder"],
  acc_food_1_alt: ["multi-persona", "facet-follow"],

  // --- tier extremes: discovery filtering + graduation panel ---
  acc_crypto_6: ["tier-1", "discovery-filtered"],
  acc_fantasy_5: ["tier-1", "discovery-filtered"],
  acc_astro_4: ["tier-1", "discovery-filtered"],
  acc_food_4: ["tier-1", "discovery-filtered"],
  acc_hist_5: ["tier-1", "discovery-filtered"],

  // --- high tier: community-note authorship, channel ownership, folders ---
  acc_crypto_1: ["whale", "long-form", "note-author", "channel-owner", "breaking-news"],
  acc_astro_1: ["whale", "long-form", "public-folder", "channel-owner"],
  acc_astro_2: ["whale", "long-form", "room-host", "argument-thread"],
  acc_food_2: ["whale", "long-form", "public-folder", "argument-thread"],
  acc_hist_1: ["whale", "long-form", "channel-owner", "argument-thread"],
  acc_hist_2: ["whale", "long-form", "note-author", "reply-chain"],
  acc_fantasy_1: ["whale", "long-form", "room-host", "argument-thread"],

  // --- mid tier: note authors, endorsers, reply chains ---
  acc_crypto_3: ["mid", "reply-chain", "breaking-news-update"],
  acc_crypto_4: ["mid", "note-author", "quote-post"],
  acc_crypto_5: ["mid", "reply-chain"],
  acc_fantasy_3: ["mid", "quote-post", "argument-thread"],
  acc_fantasy_4: ["mid", "reply-chain"],
  acc_astro_3: ["mid", "quote-post", "reply-chain"],
  acc_food_3: ["mid", "breaking-news", "argument-thread"],
  acc_hist_3: ["mid", "note-author", "reply-chain"],
  acc_hist_4: ["mid", "breaking-news", "reply-chain"],

  // --- gate-failing note author (proves the negative case) ---
  acc_astro_4_note: ["note-gate-fail"],
};

/** Tags for the seeded viewer's own personas. */
export const VIEWER_DEMO_TAGS = {
  persona_viewer_main: ["viewer", "graph-owner", "intent-buyer", "earnings"],
  persona_viewer_alt: ["viewer", "second-persona", "facet-follow"],
};
