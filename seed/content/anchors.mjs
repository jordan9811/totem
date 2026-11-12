// Hand-written structural content: reply chains (4+ deep, one per cluster),
// argument threads (one per cluster), quote-post pairs (one per cluster),
// and one breaking-news story shared across clusters (topic saturation
// testing — includes a later is_update post for the "update still
// surfaces after caught-up" acceptance test).

// Each chain: [root, reply1, reply2, reply3, reply4] — root + 4 replies
// nested sequentially satisfies "4+ deep."
export const REPLY_CHAINS = {
  crypto: [
    { authorId: "acc_crypto_1", text: "unpopular opinion: most 'decentralized' sequencers today are one multisig key rotation away from being exactly as centralized as the thing they replaced" },
    { authorId: "acc_crypto_3", text: "this is exactly right and more people should say it. the multisig threshold is doing 100% of the decentralization marketing and 10% of the actual work" },
    { authorId: "acc_crypto_1", text: "right, and nobody asks what happens when 3 of the 5 signers are the same team's employees on different badges" },
    { authorId: "acc_crypto_5", text: "counterpoint — it's still strictly better than a single sequencer with zero external signers, even if the threshold is soft. progress isn't binary" },
    { authorId: "acc_crypto_1", text: "fair, I'll take 'soft decentralization' over 'zero decentralization' every time. just want the marketing to match the multisig config, not the roadmap slide" },
  ],
  fantasy: [
    { authorId: "acc_fantasy_2", text: "start/sit thread: shaky WR2 with a great matchup or my rookie TE who's been quiet but the target share is trending up" },
    { authorId: "acc_fantasy_4", text: "the rookie TE, no question. target share trend beats matchup theater every single time in my experience" },
    { authorId: "acc_fantasy_2", text: "the target share data is genuinely the part I keep underweighting. appreciate the reminder" },
    { authorId: "acc_fantasy_3", text: "respectfully, hard disagree, but good post. one great matchup week from a proven WR2 is worth more than an unproven trend in a must-win week" },
    { authorId: "acc_fantasy_2", text: "the replies here are wilder than the post honestly. going with the trend, I'll report back Monday either way" },
  ],
  astronomy: [
    { authorId: "acc_astro_2", text: "collimation check before every single session or you're just guessing at that point. I don't care how good your last session was" },
    { authorId: "acc_astro_3", text: "underrated take. skipped it twice this month because 'it was fine last time' and paid for it both times" },
    { authorId: "acc_astro_2", text: "it takes fifteen minutes. there's no version of 'I don't have time for this' that survives a ruined session" },
    { authorId: "acc_astro_4", text: "wait, source on this? not doubting, just want to read more — is there a difference between laser and cheshire collimation accuracy worth knowing" },
    { authorId: "acc_astro_2", text: "laser is faster, cheshire is more forgiving of a bumped laser's own calibration drift. I use both, laser for the quick check, cheshire to verify" },
  ],
  restaurants: [
    { authorId: "acc_food_2", text: "the pizza place everyone raves about undersalts the sauce and I refuse to be quiet about it" },
    { authorId: "acc_food_3", text: "this aged well. I said the same thing six months ago and got dragged for it" },
    { authorId: "acc_food_2", text: "the discourse around that place is genuinely bizarre to me, it's fine, it's just not the transcendent thing people claim" },
    { authorId: "acc_food_4", text: "counterpoint — the sauce is intentionally restrained so the fresh mozzarella carries the dish. that's a choice, not an error" },
    { authorId: "acc_food_2", text: "I'd believe that if the mozzarella was doing enough work to justify it, but it isn't, so we're back to under-salted sauce" },
  ],
  history: [
    { authorId: "acc_hist_2", text: "everyone quotes this line but almost nobody has read the full letter it came from. the actual context changes the meaning substantially" },
    { authorId: "acc_hist_3", text: "underrated take. I taught this exact excerpt for years without ever pulling the full letter, which is embarrassing in hindsight" },
    { authorId: "acc_hist_2", text: "you're not alone, it's in basically every survey textbook stripped of context. the full letter isn't even hard to find, it's just never assigned" },
    { authorId: "acc_hist_4", text: "wait, source on this? not doubting, just want to read more — which archive has the full text" },
    { authorId: "acc_hist_2", text: "digitized and public, I'll reply with the link. worth the twenty minutes, it reframes the whole event" },
  ],
};

// Two-account disagreements, 4-5 posts, alternating.
export const ARGUMENT_THREADS = {
  crypto: [
    { authorId: "acc_crypto_2", text: "restaking is just re-selling the same slashing risk to three different buyers wearing different logos" },
    { authorId: "acc_crypto_4", text: "that's reductive. the risk is real but the capital efficiency gain for the actual security budget is not nothing" },
    { authorId: "acc_crypto_2", text: "capital efficiency for who though — the protocols renting security, or the restakers eating correlated slashing risk across every AVS they've opted into" },
    { authorId: "acc_crypto_4", text: "both, if it's underwritten correctly. the problem isn't restaking, it's restaking without correlated-risk-aware pricing, which is a market maturity issue, not a design flaw" },
    { authorId: "acc_crypto_2", text: "we'll see if the market prices it correctly before or after the first real correlated slashing event teaches everyone the hard way" },
  ],
  fantasy: [
    { authorId: "acc_fantasy_1", text: "dynasty startup drafts should ban rookie picks in round one, force people to actually draft players" },
    { authorId: "acc_fantasy_5", text: "hard disagree, the rookie picks ARE the point of dynasty. banning them defeats the format" },
    { authorId: "acc_fantasy_1", text: "the format's fine, I just think round one on unproven names is a coin flip dressed up as strategy" },
    { authorId: "acc_fantasy_5", text: "every draft pick is a coin flip dressed up as strategy, that's true in redraft too, you just don't notice because the results resolve faster" },
    { authorId: "acc_fantasy_1", text: "fair point actually, I'll concede the timeline argument even if I still don't love round one picks personally" },
  ],
  astronomy: [
    { authorId: "acc_astro_1", text: "aperture fever is the biggest waste of money in this hobby for anyone under a Bortle 5 sky" },
    { authorId: "acc_astro_4", text: "counterpoint — more aperture still gathers more light regardless of sky darkness, that's just physics, you can't filter your way past it entirely" },
    { authorId: "acc_astro_1", text: "true in isolation, but marginal aperture gains under heavy light pollution are dwarfed by what a filter and better target selection buy you for way less money" },
    { authorId: "acc_astro_4", text: "I'll grant the marginal-dollar argument. still going to buy the bigger dob eventually though, no regrets planned" },
  ],
  restaurants: [
    { authorId: "acc_food_1", text: "a hundred dollar tasting menu can't beat a great taqueria and I will die on this hill" },
    { authorId: "acc_food_3", text: "that's not really a fair comparison though, they're optimizing for completely different things" },
    { authorId: "acc_food_1", text: "sure, but if the question is 'which meal did I enjoy more,' the taqueria wins way more often than the price gap would suggest it should" },
    { authorId: "acc_food_3", text: "can't argue with that framing honestly. enjoyment-per-dollar the taqueria isn't close" },
  ],
  history: [
    { authorId: "acc_hist_1", text: "the gilded age gets treated like a punchline but the infrastructure built then is still load-bearing today, we should talk about it that way" },
    { authorId: "acc_hist_5", text: "counterpoint — the punchline framing exists because the labor conditions that built it were genuinely brutal, that context matters too" },
    { authorId: "acc_hist_1", text: "agreed on the labor conditions, that's not in dispute. I just mean we can hold both facts at once instead of only ever leading with the punchline" },
    { authorId: "acc_hist_5", text: "fair, both things are true simultaneously and most retellings only have room for one of them" },
  ],
};

// Quote-post pairs: base post + a quote-post reacting to it.
export const QUOTE_PAIRS = {
  crypto: {
    base: { authorId: "acc_crypto_4", text: "watched a validator get slashed live today. humbling stuff" },
    quote: { authorId: "acc_crypto_6", text: "this is why I run everything through a testnet fork three times before mainnet. slashing is not a lesson you want to learn live" },
  },
  fantasy: {
    base: { authorId: "acc_fantasy_3", text: "trade offer just came in that's so lopsided I'm convinced it's a prank. declining on principle" },
    quote: { authorId: "acc_fantasy_1", text: "the lopsided offers are honestly a great way to find out who's paying attention in your league and who isn't" },
  },
  astronomy: {
    base: { authorId: "acc_astro_3", text: "caught a decent view of the ring nebula tonight, small but unmistakable once you find it" },
    quote: { authorId: "acc_astro_1", text: "the ring nebula is the perfect 'prove to yourself this hobby is real' target. small, unmistakable, exactly as advertised" },
  },
  restaurants: {
    base: { authorId: "acc_food_4", text: "the fried chicken sandwich wars in this city have gotten genuinely competitive and I am here for it" },
    quote: { authorId: "acc_food_2", text: "ranking my top three from this thread alone. this city did not need to go this hard but I'm grateful it did" },
  },
  history: {
    base: { authorId: "acc_hist_3", text: "the archive finally digitized this collection and it's rewriting half of what the textbooks said" },
    quote: { authorId: "acc_hist_2", text: "this is the kind of digitization project that should get ten times the funding it actually gets. quietly rewrites the field and nobody notices" },
  },
};

// Breaking-news story shared network-wide. 3 initial posts across clusters
// + 1 later is_update post (for the saturation acceptance test: caught-up
// hides the story, but an is_update post still surfaces).
export const BREAKING_NEWS = {
  storyId: "story_idverify_breach",
  posts: [
    { authorId: "acc_crypto_1", minutesAgo: 400, isUpdate: false, text: "developing: the identity verification vendor half the industry KYCs through just confirmed a breach. scope still unclear, this is going to be a rough week for a lot of compliance teams" },
    { authorId: "acc_hist_4", minutesAgo: 380, isUpdate: false, text: "the parallels to the credit bureau breaches a decade ago are already writing themselves. we never actually fixed the underlying incentive problem, we just added more vendors" },
    { authorId: "acc_food_3", minutesAgo: 360, isUpdate: false, text: "unrelated to the actual severity of this but the number of company Slack channels that just went silent at the same time is its own kind of data point" },
    { authorId: "acc_crypto_3", minutesAgo: 40, isUpdate: true, text: "update on the id verification breach: vendor confirmed the exposed dataset is smaller than initially feared, but confirmed it does include document images, not just metadata. this changes the response calculus for anyone affected" },
  ],
};
