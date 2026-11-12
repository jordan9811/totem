// Wave 4 seed content: 3 channels (one per membership policy), 2 public
// bookmark folders on high-tier accounts, and 2 text rooms with
// deterministic message scripts. All owners are EXISTING seed accounts.

export const CHANNELS = [
  {
    id: "chan_openfloor",
    name: "Open Floor",
    description: "General crypto market structure talk, at length.",
    cluster: "crypto",
    policy: "open",
    ownerAccId: "acc_crypto_1",
    // Back-posts authored inside the channel by existing accounts.
    posts: [
      { authorAccId: "acc_crypto_1", minutesAgo: 300, text: "Starting this channel because the main timeline is a terrible place to argue about settlement finality for four hours. Here we can." },
      { authorAccId: "acc_crypto_3", minutesAgo: 240, text: "the sequencer decentralization roadmap thread from last week belongs in here honestly. main feed flattened it into a dunk" },
      { authorAccId: "acc_crypto_5", minutesAgo: 180, text: "open channels work when the topic is narrow enough that lurkers self-select out. this one qualifies" },
    ],
  },
  {
    id: "chan_waiverroom",
    name: "The Waiver Room",
    description: "Weekly waiver claims, start/sit, and trade workshopping.",
    cluster: "fantasy",
    policy: "request",
    ownerAccId: "acc_fantasy_1",
    posts: [
      { authorAccId: "acc_fantasy_1", minutesAgo: 260, text: "Request-only because the open version of this turned into people posting their own league's screenshots with no context. Ask in and say what format you play." },
      { authorAccId: "acc_fantasy_4", minutesAgo: 200, text: "handcuff strategy thread, dynasty specifically: how many bench spots are you actually willing to burn on insurance" },
      { authorAccId: "acc_fantasy_3", minutesAgo: 120, text: "the answer is two and anyone saying more than two has never had a bye week go badly" },
    ],
  },
  {
    id: "chan_darksky",
    name: "Dark Sky Society",
    description: "Observation reports from genuinely dark sites.",
    cluster: "astronomy",
    policy: "invite",
    ownerAccId: "acc_astro_1",
    posts: [
      { authorAccId: "acc_astro_1", minutesAgo: 280, text: "Invite-only on purpose. This is for people who actually travel to bortle 2-3 sites and log what they see, not gear discourse." },
      { authorAccId: "acc_astro_2", minutesAgo: 220, text: "Logged the Veil unaided last weekend at a bortle 2 site. Twelve years in this hobby and it's the first time I've genuinely gasped at an eyepiece." },
      { authorAccId: "acc_astro_3", minutesAgo: 90, text: "that's the one that converts people. nothing in a suburban backyard prepares you for it" },
    ],
  },
];

export const FOLDERS = [
  {
    id: "folder_settlement",
    name: "Settlement Reading",
    ownerAccId: "acc_crypto_1",
    isPublic: true,
    // Filled by generate.mjs from long-form + crypto posts.
    pick: { cluster: "crypto", count: 6, preferLongform: true },
  },
  {
    id: "folder_darksites",
    name: "Dark Site Logs",
    ownerAccId: "acc_astro_1",
    isPublic: true,
    pick: { cluster: "astronomy", count: 5, preferLongform: true },
  },
  {
    // Private control: acceptance criterion 5 asserts this never renders
    // for another account.
    id: "folder_private_drafts",
    name: "Half-Baked Takes",
    ownerAccId: "acc_food_2",
    isPublic: false,
    pick: { cluster: "restaurants", count: 4, preferLongform: false },
  },
];

// Rooms: `script` entries are (atMs after open, author, text). Liveness is
// simulated deterministically — no wall-clock randomness.
export const ROOMS = [
  {
    id: "room_collimation",
    title: "Collimation, honestly",
    topicCluster: "astronomy",
    hostAccId: "acc_astro_2",
    scheduledInMinutes: 5,
    script: [
      { atMs: 0, accId: "acc_astro_2", text: "Alright, we're live. Topic: is laser collimation actually better than a cheshire, or do we all just like gadgets." },
      { atMs: 1200, accId: "acc_astro_3", text: "Gadgets. Next question." },
      { atMs: 2400, accId: "acc_astro_4", text: "Genuinely though — I'm a beginner with a 6-inch dob and I cannot tell if my views are bad because of collimation or because of my sky. How do you separate those?" },
      { atMs: 3600, accId: "acc_astro_2", text: "That's the best question anyone's asked in one of these. Short version: collimation errors are symmetric and always present. Sky problems come and go with conditions." },
      { atMs: 4800, accId: "acc_astro_1", text: "Star test on a bright star at high magnification. If the diffraction rings are off-center, that's collimation. If they're shimmering but concentric, that's seeing." },
      { atMs: 6000, accId: "acc_astro_4", text: "Nobody has ever explained it to me that clearly. That's genuinely going to change how I diagnose a bad session." },
      { atMs: 7200, accId: "acc_astro_2", text: "That's the whole point of doing these in text. That exchange doesn't happen in a 400-person audio room." },
    ],
  },
  {
    id: "room_settlement",
    title: "Finality is a distribution",
    topicCluster: "crypto",
    hostAccId: "acc_crypto_1",
    scheduledInMinutes: 20,
    script: [
      { atMs: 0, accId: "acc_crypto_1", text: "Room's open. Thesis: every 'instant finality' claim in this industry is a p50 number wearing a p99 costume." },
      { atMs: 1500, accId: "acc_crypto_4", text: "Counterpoint: for the vast majority of transaction values, p50 is the correct number to design against. Not everything needs settlement-grade guarantees." },
      { atMs: 3000, accId: "acc_crypto_6", text: "isn't the actual problem that nobody publishes p99 at all, so integrators literally cannot make that tradeoff even if they wanted to" },
      { atMs: 4500, accId: "acc_crypto_1", text: "That's exactly it, and it's a better framing than mine. The issue isn't the number, it's that the number is unavailable." },
      { atMs: 6000, accId: "acc_crypto_3", text: "we ran our own measurements for a quarter. p99 proving latency was 40x p50 during congestion. that ratio is not in anyone's docs" },
    ],
  },
];
