// THE PRIVACY SENTENCES, ONCE. The landing (components/landing/Landing.tsx) and the Help page (app/help/page.tsx)
// both render these, so a reader can never meet two versions of a privacy statement.
//
// The rule they follow is the landing's own: every privacy sentence is the security posture's narrow wording, or the
// landing's existing wording that was written from it, never a new or stronger claim. Each carries the section it
// comes from as `data-cite` (the same "FILE > heading" form the docs use), so a reviewer can check the sentence
// against its source; scripts/accept-help.mjs checks that every heading named here exists verbatim.
//
// The sentences keep their original punctuation, em dashes included: they are quoted, not rewritten. Nothing here
// reads state, so the landing stays a component with no data access.
import { DEMO_PREFIX, PRIVATE_LABEL } from "@/lib/zk/labels";
// PERSONA LAUNCH P1: the read-only public self's two refusals are the app's own sentences (a pure module, no state), so
// Help quotes the exact words the routes answer with instead of a second copy that could drift.
import { PUBLIC_SELF_NO_FORK_SENTENCE, PUBLIC_SELF_READ_ONLY_SENTENCE } from "@/lib/identity/handleStem";
// POST AS YOU: the connect panel's words, from their one pure module
import { MAIN_APP_NOTE, beforeYouAllow } from "@/lib/fc/rootSigner/copy";

/** where each sentence comes from: a file, and for SECURITY-POSTURE.md a section heading that exists verbatim */
export const CITE = {
  label: `SECURITY-POSTURE.md > '4. What "private" means on the label, exactly'`,
  hidden: `SECURITY-POSTURE.md > "1. What is now mathematically hidden (given the conditions in §4)"`,
  network: `SECURITY-POSTURE.md > "14. Network identities (Multi-FID pass): what the network, Neynar and the validator learn about persona accounts and anon posts"`,
  custody: `SECURITY-POSTURE.md > "16. Custody and topology (Browser keystore pass): what the browser holds, what the server holds, what each save path trusts, what root linking does and does not do"`,
  owner: `SECURITY-POSTURE.md > "18. The owner service (PROD-LIVE): a hosted rig for one person, and what it trusts"`,
  reads: `SECURITY-POSTURE.md > "19. Public live reads (FC-READ): what the relay holds, what it reads, what the operator now sees, and what it costs"`,
  // PERSONA LAUNCH P1-P3: the wave's three new posture sections (scripts/accept-help.mjs check 4 resolves each heading)
  siwf: `SECURITY-POSTURE.md > "21. Sign in with Farcaster on the public site: what the relay, the chain node, the server and the validator learn"`,
  byx: `SECURITY-POSTURE.md > "22. Bring your X (Persona launch P2): what the validator, the index source and the network learn from an archive import"`,
  anon: `SECURITY-POSTURE.md > "23. Persona-scoped anon posting (Persona launch P3): K posts per person per window, and what the slot index still says"`,
  // PERSONA LAUNCH wave 2 (P4-P6): rings, reach tiers and launch (scripts/accept-help.mjs check 4 resolves each heading)
  rings: `SECURITY-POSTURE.md > "24. Rings and ring notes (Persona launch P4): what the drop, the operator and a member learn"`,
  reach: `SECURITY-POSTURE.md > "25. Reach tiers (Persona launch P5): what a boosted anon post says, and the crowd floor"`,
  launch: `SECURITY-POSTURE.md > "26. Launch (Persona launch P6): a persona's own account, on test data"`,
  // PERSONA LAUNCH wave 3 (P7, P8): anonymous posting from the public site and the @totem X outbox (check 4 resolves each)
  web: `SECURITY-POSTURE.md > "27. Anonymous posting from the public site (Persona launch P7): the prover in your browser, the web channel, and what the operator sees"`,
  xout: `SECURITY-POSTURE.md > "28. The @layers X outbox (Persona launch P8): anonymous copies to X, moderated first, on a test transport"`,
  // POST AS YOU: posting as your own Farcaster account (check 4 resolves the heading)
  rootPost: `SECURITY-POSTURE.md > "35. Post as you: your own Farcaster account's key, Totem's app account, and what each party sees"`,
  // NEYNAR AS A SWITCH: where each Farcaster surface reads from, and the reads that never go through Neynar (check 4 resolves it)
  sources: `SECURITY-POSTURE.md > "42. Neynar as a switch: one source per Farcaster surface, set by the operator, and the reads that never go through Neynar"`,
} as const;

// ---------------------------------------------------------------- Post as you, from section 35 (verbatim UI)
/** the connect panel's disclosure before the first request (lib/fc/rootSigner/copy.ts, unsponsored: the default) */
export const ROOT_POST_BEFORE = beforeYouAllow(false);
export const ROOT_POST_MAIN_APP = MAIN_APP_NOTE;

// ---------------------------------------------------------------- Sign in with Farcaster, from section 21 (verbatim UI)
/** the card's first line (components/device/FarcasterSignIn.tsx) */
export const SIWF_NOT_A_SAVE = "This shows which Farcaster account is yours. It does not save your identity: save with a passkey first.";
/** the disclosure the card shows before the first request, split where the node's host goes; the default host is the
 *  one Help names, since Help reads no device env */
export const SIWF_RPC_DEFAULT_HOST = "mainnet.optimism.io";
export const SIWF_RELAY_SEES = "Farcaster's sign-in service will see that you signed in to Totem, and your internet address.";
export const siwfRpcSees = (rpcHost: string) =>
  `Your browser then checks the account on the Optimism blockchain through ${rpcHost}, which sees your internet address too.`;
export const SIWF_SERVER_SEES = "Totem's server sees nothing.";
/** PUBLIC GO-LIVE (PRIV-LIVE-1): what the card says INSTEAD when the sign-in joins the live anonymous crowd (the app
 *  handed the tab ZK_ANON_UNIVERSE=live): the validator then sees the sign-in and records the join (fid -> a dedicated crowd
 *  commitment, with the address). components/device/FarcasterSignIn.tsx shows exactly these words. */
export const SIWF_SERVER_SEES_LIVE = "Then Totem checks the same sign-in and records that your Farcaster account joined the anonymous crowd, with your internet address. That record names your Farcaster account, not your Totem identity or your posts.";
/** PUBLIC GO-LIVE (PRIV-LIVE-1): Help on the live site (it reads no device env, so it says when the join applies) */
export const SIWF_SERVER_SEES_LIVE_HELP = "Once anonymous posting to Farcaster is on, the sign-in also joins the anonymous crowd: Totem checks it and records that your Farcaster account joined, with your internet address.";
/** the profile's line about your own Farcaster posts (components/profile/ProfileIsland.tsx). NEYNAR AS A SWITCH (§42): the
 *  "Show my Farcaster posts here" button (a relay read of your own fname) is retired under the hard rule */
export const SIWF_SHOW_POSTS =
  "Your Farcaster posts are read from Farcaster's network on your Farcaster profile (open it from Following), never through Neynar: that read would hand your account to Totem's server.";
/** the public self's refusals, as the routes answer them */
export const SIWF_READ_ONLY = PUBLIC_SELF_READ_ONLY_SENTENCE;
export const SIWF_NO_FORK = PUBLIC_SELF_NO_FORK_SENTENCE;

// ---------------------------------------------------------------- Bring your X, from section 22 (verbatim UI)
/** the wizard's drop zone (components/settings/XImportWizard.tsx), its first sentence. Review UX-10 retired "Nothing is
 *  uploaded" (the parsed lanes the person picks DO leave the page, to be sealed), and accept-x5 / smoke-x refuse it */
export const X_ARCHIVE_STAYS = "The archive file never leaves this browser.";

// ---------------------------------------------------------------- persona-scoped anon posts, from section 23
/** A-ANON-SLOT-INDEX-VISIBLE, its second sentence, verbatim: what the slot index still says (test:linkage6 check 7) */
export const ANON_SLOT_RESIDUAL =
  "One person's posts in one window never share a slot, so a pair of one window's posts that DO share a slot is proven to be two people; a pair in different slots becomes K/(K−1) times likelier to be one person (about 1.33 at K = 4) than without the index.";

// ---------------------------------------------------------------- rings, from section 24
/** the envelope bullet's last sentence, verbatim: why a ring member cannot prove a link to anyone else */
export const RING_NO_SIGNATURE = "No signature anywhere: a member who passes a note on passes on a claim, not a proof.";

// ---------------------------------------------------------------- the landing's status sentences, verbatim
/** Landing status, item 2, first two sentences */
export const IDENTITY_IN_TAB =
  "Your identity lives in this browser tab until you save it (a passkey, or your 24 words). Closing the tab loses an unsaved identity.";
/** Landing status, item 2, third sentence */
export const SERVER_HOLDS = "The server holds ciphertext, commitments and public keys — no root, no seed, no vault key.";
/** Landing status, item 2, last sentence (FC-READ: conditional on purpose, true whether or not the relay is armed) */
export const RELAY_READS =
  "When this preview shows live Farcaster posts, they are fetched through our server, read-only: it sees which posts and profiles are read, from which address and when.";
/** PUBLIC GO-LIVE (F11): the same sentence in public live mode — the live site is not a preview, so it says "this site";
 *  every other word is RELAY_READS's (the flag-off text above is unchanged, byte for byte) */
export const LIVE_RELAY_READS =
  "When this site shows live Farcaster posts, they are fetched through our server, read-only: it sees which posts and profiles are read, from which address and when.";
/** F11: the reads sentence for the mode the page renders in (the landing and /help pick it the same way, so accept-help
 *  check 4 still finds the landing's sentences word for word on /help) */
export function relayReadsSentence(live: boolean): string {
  return live ? LIVE_RELAY_READS : RELAY_READS;
}
/** Landing status, item 3 */
export const WRITES_OFF = "Writes to other networks are off. Posts stay inside this preview. Do not put anything real or sensitive in it.";
/** PUBLIC GO-LIVE: Landing status, item 3 in public live mode (instead of WRITES_OFF), and on /help there. True whether
 *  or not the anonymous relay is armed (the landing reads no state): it says which way each post goes and who says so
 *  first. Section 27's facts (the browser prover, the web channel), in plain words; nothing strengthened. */
export const LIVE_WRITES =
  "Your personas' posts go to Farcaster through @anon only once this site's anonymous relay is switched on; until then they stay inside Totem. The composer says which, before you post. Your own Farcaster account is never posted from here.";
/** Landing status, item 4 */
export const TWO_PEOPLE =
  "Two people opening this URL get two independent identities; nothing one does is visible to the other except what is public by design.";

/** Landing status, item 1: the label sentence, with the two label strings styled as the landing shows them */
export function LabelSentence() {
  return (
    <>
      The privacy layer is built but its conditions are not all met on this deployment. Inside the app the label reads <span className="font-bold text-[#f4212e]">{DEMO_PREFIX}</span> with a count of the conditions that fail, listed in
      full under Settings, ZK privacy layer; it is computed on your device every time, never hardcoded. Only when every condition holds does it read <span className="italic">&ldquo;{PRIVATE_LABEL}&rdquo;</span>. Nothing here is a guarantee.
    </>
  );
}

// ---------------------------------------------------------------- the owner service, from section 18
/** A-PRODLIVE-THE-HOST-HOLDS-THE-SEED, its first two sentences, verbatim */
export const OWNER_HOST_HOLDS_SEED =
  "The owner's root seed, device key and envelope counters live on a Railway volume. The platform operator, and anyone who compromises the owner's Railway account, can read them and act as every persona, including the live accounts.";
/** the section's own sentence about the label on that deployment, verbatim but for its "(§4)" reference */
export const OWNER_LABEL_NOT_MET =
  "The privacy label's conditions are not met on this deployment either; it is a live-posting tool for its owner, not a privacy demonstration.";
/** A-PRODLIVE-THE-PASSPHRASE-IS-THE-ACCOUNT, its first two sentences, without its route names (the second sentence is
 *  the owner passkey build's: a device that holds one of the owner's Face ID / fingerprint sign-ins has the same reach) */
export const OWNER_PASSPHRASE =
  "Whoever holds the passphrase can post as every persona, reveal the 24 words, and use the developer controls. So can anyone who can unlock a device that holds one of the owner's Face ID / fingerprint sign-ins, until it is removed (Settings > Security > Lost this device?).";

// ---------------------------------------------------------------- the network, from section 14
/** A-FID-NEYNAR-SEES-ALL, condensed from the section's table ("fid" written as "account"); nothing strengthened */
export const NEYNAR_SEES_ALL =
  "Under managed custody, one API key reserved and registered every persona account, holds every managed signer, and is on every persona write: nothing is hidden from Neynar.";
/** A-FID-SELF-GRAPH, in the app's own waiver wording (components/ActAsPicker.tsx) */
export const SELF_GRAPH = "Two of your accounts interacting is public, and stays public.";

// ---------------------------------------------------------------- the proof layer, from section 1
/** section 1's claim, with the conditions its heading names (the label's, section 4) in front of it, and its own closing sentence */
export const PROOF_CLAIM =
  "Given the label's conditions, a membership proof shows that some registered root authorizes a persona without revealing which root, from the proof's cryptographic content alone. That is the whole claim at the proof layer.";

/** Section 4's eight conditions, in the section's terms and order: "the exact wording" on the Help page. They are
 *  requirements, not claims: the label shows its privacy sentence only when all of them hold, and the app checks one or
 *  two more for the anonymous account. PLAIN_CONDITIONS below says each one for a first-time reader. */
export const LABEL_CONDITIONS: readonly string[] = [
  "Your requests go through a network relay (OHTTP or Tor), and the operator has attested that a separate party runs it. That is an attestation, not a check.",
  "The group you prove membership of clears your device's minimum size, and has not changed beyond a set limit since you last proved into it.",
  "Submissions go out at random times, the scheduler's self-test passes, and the server's time window is at least your device's minimum.",
  "A self-test on your own secret passes.",
  "The verification key in use is the one pinned in the build, and the proving files match the ceremony's pins.",
  "The limit on how many proofs a persona makes per time window is in force.",
  "The proof system is running for real, not on test data.",
  "No fallback lets a request past the gate without a proof.",
];

/** The same eight, one plain line each, in the same order, with what is known about the public site. Only three are
 *  known to fail there (the docs' "Privacy in plain words" page says the same); the rest are checked on the reader's
 *  own device each time, and the Help page does not claim they hold. */
export const PLAIN_CONDITIONS: readonly { plain: string; publicSite: "fails" | "checked" }[] = [
  { plain: "A go-between for your connection, run by someone else, so our server does not see your internet address.", publicSite: "fails" },
  { plain: "A big enough crowd to hide in: at least 50 people in the group by default.", publicSite: "fails" },
  { plain: "Proofs sent at random times, so their timing does not point at what you just did.", publicSite: "checked" },
  { plain: "Your personas' proofs look unrelated to each other.", publicSite: "checked" },
  { plain: "The proof files are the published ones.", publicSite: "checked" },
  { plain: "A cap on how much each persona proves.", publicSite: "checked" },
  { plain: "Real proofs, not the test set-up.", publicSite: "fails" },
  { plain: "No back door that lets a page skip the proof.", publicSite: "checked" },
];
