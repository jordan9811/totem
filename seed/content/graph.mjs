// Wave 5 seed content: claimable attribute catalogue, import connectors,
// seeded campaigns for the "what ads would I see" preview, and a
// deterministic settlement history so earnings totals are stable.

// Standard categories are one-tap claimable. Sensitive categories are
// listed here too but are NEVER pre-claimed and never included in any
// select-all — see SENSITIVE_CATEGORIES in lib/adapters/types.ts.
export const CLAIM_CATALOGUE = {
  interests: [
    { label: "Espresso", value: "espresso" },
    { label: "Amateur astronomy", value: "astronomy" },
    { label: "Fantasy football", value: "fantasy_football" },
    { label: "Market structure", value: "market_structure" },
    { label: "Ramen", value: "ramen" },
    { label: "Military history", value: "military_history" },
  ],
  demographics: [
    { label: "Age 25–34", value: "age_25_34" },
    { label: "Urban", value: "urban" },
    { label: "English", value: "english" },
  ],
  ownership: [
    { label: "Owns a telescope", value: "telescope" },
    { label: "Owns an espresso machine", value: "espresso_machine" },
    { label: "Owns a car", value: "car" },
  ],
  habits: [
    { label: "Buys coffee weekly", value: "coffee_weekly" },
    { label: "Reads long-form", value: "longform_reader" },
    { label: "Watches sports", value: "watches_sports" },
    { label: "Cooks at home", value: "cooks_home" },
  ],
  // --- sensitive: separate opt-in, default OFF, never bundled ---
  health: [
    { label: "Tracks sleep", value: "sleep_tracking" },
    { label: "Runs regularly", value: "running" },
  ],
  finances: [
    { label: "Holds index funds", value: "index_funds" },
    { label: "Household income band", value: "income_band" },
  ],
  politics: [
    { label: "Follows local elections", value: "local_elections" },
  ],
};

// Claims the seeded viewer starts with. Standard categories only — the
// sensitive ones must be opted into by hand, which is the whole point.
export const VIEWER_SEED_CLAIMS = [
  { category: "interests", value: "espresso" },
  { category: "interests", value: "astronomy" },
  { category: "interests", value: "market_structure" },
  { category: "habits", value: "coffee_weekly" },
  { category: "habits", value: "longform_reader" },
  { category: "ownership", value: "telescope" },
  { category: "demographics", value: "age_25_34" },
  { category: "demographics", value: "urban" },
];

export const CONNECTORS = [
  {
    id: "conn_card",
    name: "Card spend",
    description: "Import merchant categories from a card statement.",
    issuer: "Northgate Bank",
    category: "habits",
    // Claims this import produces, attested with the issuer above.
    yields: [
      { category: "habits", label: "Buys coffee weekly", value: "coffee_weekly" },
      { category: "habits", label: "Dines out 3x weekly", value: "dines_out" },
      { category: "ownership", label: "Owns an espresso machine", value: "espresso_machine" },
    ],
  },
  {
    id: "conn_wearable",
    name: "Wearable",
    description: "Import activity and sleep summaries from a fitness band.",
    issuer: "Corvid Health",
    category: "health",
    yields: [
      { category: "health", label: "Tracks sleep", value: "sleep_tracking" },
      { category: "health", label: "Runs regularly", value: "running" },
    ],
  },
  {
    id: "conn_watch",
    name: "Watch history",
    description: "Import viewing categories from a streaming account.",
    issuer: "Lumen TV",
    category: "interests",
    yields: [
      { category: "interests", label: "Documentaries", value: "documentaries" },
      { category: "habits", label: "Watches sports", value: "watches_sports" },
    ],
  },
];

// Seeded campaigns for the ads preview. `audience` is a rules-engine
// RuleGroup over graph claims + tier — the SAME evaluator the feed uses.
export const CAMPAIGNS = [
  {
    id: "camp_espresso",
    name: "Rowan & Vine — single-origin subscription",
    advertiserAccId: "acc_food_2",
    budget: 4200,
    audience: {
      combinator: "AND",
      clauses: [
        { field: "graph.claim", op: "contains", value: "espresso" },
        { field: "author.tier", op: "gte", value: 4 },
      ],
    },
  },
  {
    id: "camp_scope",
    name: "Aperture Optics — dobsonian clearance",
    advertiserAccId: "acc_astro_1",
    budget: 2800,
    audience: {
      combinator: "AND",
      clauses: [{ field: "graph.claim", op: "contains", value: "telescope" }],
    },
  },
  {
    id: "camp_longform",
    name: "The Meter — annual reader pass",
    advertiserAccId: "acc_crypto_1",
    budget: 6100,
    audience: {
      combinator: "AND",
      clauses: [
        { field: "graph.claim", op: "contains", value: "longform_reader" },
        { field: "graph.claim", op: "contains", value: "market_structure" },
      ],
    },
  },
  {
    // Sensitive-gated: only matches if the viewer opted health in.
    id: "camp_sleep",
    name: "Corvid Rest — sleep tracker upgrade",
    advertiserAccId: "acc_astro_2",
    budget: 1900,
    audience: {
      combinator: "AND",
      clauses: [{ field: "graph.claim", op: "contains", value: "sleep_tracking" }],
    },
  },
  {
    // Deliberately narrow so it trips the k-anonymity floor (dev floor = 8).
    id: "camp_narrow",
    name: "Niche — military history quarterly",
    advertiserAccId: "acc_hist_2",
    budget: 400,
    audience: {
      combinator: "AND",
      clauses: [
        { field: "graph.claim", op: "contains", value: "military_history" },
        { field: "author.tier", op: "gte", value: 9 },
      ],
    },
  },
];

// Deterministic settlement history — earnings totals must be stable across
// runs, so these are fixed, not generated.
export const SETTLEMENT_HISTORY = [
  { kind: "graph_share", category: "interests", amount: 340, note: "Espresso interest matched 3 campaigns" },
  { kind: "graph_share", category: "habits", amount: 275, note: "Coffee purchase cadence" },
  { kind: "graph_share", category: "ownership", amount: 190, note: "Telescope ownership" },
  { kind: "graph_share", category: "interests", amount: 155, note: "Market structure interest" },
  { kind: "ad_impression", category: "interests", amount: 60, note: "Rowan & Vine impression" },
  { kind: "ad_impression", category: "ownership", amount: 45, note: "Aperture Optics impression" },
  { kind: "graph_share", category: "demographics", amount: 120, note: "Urban / age band" },
];
