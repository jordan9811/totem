// 24 seed accounts (roots) across 5 clusters. rep: "whale" = tier 9-10,
// "mid" = spread tier 4-8, "low" = pinned tier 1-2 (network-wide discovery
// filtering test — NOT confined to one cluster). 3 accounts get a second
// persona under the same root (cross-persona linkage / blocking tests).
// Avatars: dicebear (deterministic from seed string, public API, no
// generation-time network dependency — just URL construction).

const avatar = (style, seed) => `https://api.dicebear.com/7.x/${style}/svg?seed=${encodeURIComponent(seed)}`;

export const CLUSTERS = ["crypto", "fantasy", "astronomy", "restaurants", "history"];

export const ACCOUNTS = [
  // ---- crypto (6): 2 whale, 3 mid, 1 low ----
  { id: "acc_crypto_1", handle: "0xledgerline", name: "Ledger Line", bio: "settlement rails, mostly grumpy about them", cluster: "crypto", rep: "whale", avatar: avatar("notionists", "ledgerline") },
  { id: "acc_crypto_2", handle: "basisrisk", name: "Basis Risk", bio: "perp funding rates and other forms of self-harm", cluster: "crypto", rep: "whale", avatar: avatar("notionists", "basisrisk"),
    extraPersona: { id: "acc_crypto_2_alt", handle: "duskorbiter", name: "Dusk Orbiter", bio: "amateur astronomer, city balcony edition", cluster: "astronomy", avatar: avatar("notionists", "duskorbiter") } },
  { id: "acc_crypto_3", handle: "gwei_whisperer", name: "gwei whisperer", bio: "L2 sequencer gossip", cluster: "crypto", rep: "mid", avatar: avatar("notionists", "gweiwhisperer") },
  { id: "acc_crypto_4", handle: "quietvalidator", name: "Quiet Validator", bio: "runs nodes, rarely posts, always right", cluster: "crypto", rep: "mid", avatar: avatar("notionists", "quietvalidator") },
  { id: "acc_crypto_5", handle: "restakerelle", name: "Restake Relle", bio: "yield is a rumor until it's realized", cluster: "crypto", rep: "mid", avatar: avatar("notionists", "restakerelle") },
  { id: "acc_crypto_6", handle: "airdropintern", name: "Airdrop Intern", bio: "farming since before it was cringe", cluster: "crypto", rep: "low", avatar: avatar("notionists", "airdropintern") },

  // ---- fantasy football (5): 2 whale, 2 mid, 1 low ----
  { id: "acc_fantasy_1", handle: "waivermorning", name: "Waiver Morning", bio: "I set my lineup at 11:58am like a coward", cluster: "fantasy", rep: "whale", avatar: avatar("notionists", "waivermorning") },
  { id: "acc_fantasy_2", handle: "startsitsam", name: "Start/Sit Sam", bio: "your flex spot is wrong and I can prove it", cluster: "fantasy", rep: "whale", avatar: avatar("notionists", "startsitsam"),
    extraPersona: { id: "acc_fantasy_2_alt", handle: "deephistorydan", name: "Deep History Dan", bio: "footnotes are the best part", cluster: "history", avatar: avatar("notionists", "deephistorydan") } },
  { id: "acc_fantasy_3", handle: "boomorbust_lg", name: "Boom or Bust League", bio: "12-team dynasty, zero chill", cluster: "fantasy", rep: "mid", avatar: avatar("notionists", "boomorbustlg") },
  { id: "acc_fantasy_4", handle: "handcuffhannah", name: "Handcuff Hannah", bio: "insurance policy enjoyer", cluster: "fantasy", rep: "mid", avatar: avatar("notionists", "handcuffhannah") },
  { id: "acc_fantasy_5", handle: "waiver_wire_walt", name: "Waiver Wire Walt", bio: "streaming defenses is a personality trait", cluster: "fantasy", rep: "low", avatar: avatar("notionists", "waiverwirewalt") },

  // ---- amateur astronomy (4): 2 whale, 1 mid, 1 low ----
  { id: "acc_astro_1", handle: "aperture_annie", name: "Aperture Annie", bio: "8-inch dob, light-polluted backyard, no regrets", cluster: "astronomy", rep: "whale", avatar: avatar("notionists", "apertureannie") },
  { id: "acc_astro_2", handle: "collimationking", name: "Collimation King", bio: "I will talk about laser collimators unprompted", cluster: "astronomy", rep: "whale", avatar: avatar("notionists", "collimationking") },
  { id: "acc_astro_3", handle: "messierhunter_", name: "Messier Hunter", bio: "chasing all 110, currently at 63", cluster: "astronomy", rep: "mid", avatar: avatar("notionists", "messierhunter") },
  { id: "acc_astro_4", handle: "faintfuzzyfan", name: "Faint Fuzzy Fan", bio: "galaxies over planets, always", cluster: "astronomy", rep: "low", avatar: avatar("notionists", "faintfuzzyfan") },

  // ---- restaurants/food (4): 2 whale, 1 mid, 1 low ----
  { id: "acc_food_1", handle: "brothandbones", name: "Broth & Bones", bio: "ramen tourism as a lifestyle", cluster: "restaurants", rep: "whale", avatar: avatar("notionists", "brothandbones"),
    extraPersona: { id: "acc_food_1_alt", handle: "linescoreluke", name: "Line Score Luke", bio: "fantasy football, mostly regret", cluster: "fantasy", avatar: avatar("notionists", "linescoreluke") } },
  { id: "acc_food_2", handle: "crustcritic", name: "Crust Critic", bio: "pizza is a load-bearing food group", cluster: "restaurants", rep: "whale", avatar: avatar("notionists", "crustcritic") },
  { id: "acc_food_3", handle: "secondhelpingsara", name: "Second Helpings Sara", bio: "always orders one extra thing 'for the table'", cluster: "restaurants", rep: "mid", avatar: avatar("notionists", "secondhelpingsara") },
  { id: "acc_food_4", handle: "drivethru_dave", name: "Drive-Thru Dave", bio: "unpopular fast food opinions, delivered calmly", cluster: "restaurants", rep: "low", avatar: avatar("notionists", "drivethrudave") },

  // ---- history (5): 2 whale, 2 mid, 1 low ----
  { id: "acc_hist_1", handle: "todayinruins", name: "Today in Ruins", bio: "history didn't happen in order, we just tell it that way", cluster: "history", rep: "whale", avatar: avatar("notionists", "todayinruins") },
  { id: "acc_hist_2", handle: "footnote_feiler", name: "Footnote Feiler", bio: "primary sources or it didn't happen", cluster: "history", rep: "whale", avatar: avatar("notionists", "footnotefeiler") },
  { id: "acc_hist_3", handle: "marginalia_mo", name: "Marginalia Mo", bio: "reads the introductions, unlike you", cluster: "history", rep: "mid", avatar: avatar("notionists", "marginaliamo") },
  { id: "acc_hist_4", handle: "archive_annette", name: "Archive Annette", bio: "microfilm has never let me down", cluster: "history", rep: "mid", avatar: avatar("notionists", "archiveannette") },
  { id: "acc_hist_5", handle: "gilded_age_greg", name: "Gilded Age Greg", bio: "everything is the Gilded Age if you squint", cluster: "history", rep: "low", avatar: avatar("notionists", "gildedagegreg") },
];

// The seeded test user ("me"): 2 personas, following ~14 accounts across
// all clusters, pre-existing likes, 6 bookmarks (2 long-form).
export const VIEWER = {
  fid: 9152,
  rootId: "root_viewer",
  personas: [
    { id: "persona_viewer_main", handle: "yeak__", name: "jordan", bio: "Delphi Research", avatar: avatar("notionists", "yeakmain"), cluster: "crypto" },
    { id: "persona_viewer_alt", handle: "backyard_scope", name: "Backyard Scope", bio: "light pollution enjoyer", avatar: avatar("notionists", "yeakalt"), cluster: "astronomy" },
  ],
  // handles of accounts followed, spread across clusters — filled precisely
  // in generate.mjs (14 total, at least 2 per cluster) to keep this file
  // the single edit point for "who": followingHandles left here for
  // reviewability.
  followingHandles: [
    "0xledgerline", "basisrisk", "gwei_whisperer",
    "waivermorning", "startsitsam", "boomorbust_lg",
    "aperture_annie", "collimationking", "messierhunter_",
    "brothandbones", "crustcritic",
    "todayinruins", "footnote_feiler", "marginalia_mo",
  ],
};
