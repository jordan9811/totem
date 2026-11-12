// POST AS YOU — the words, once (a pure module: components/root/RootPost.tsx shows them, the Help page quotes them through
// components/help/privacy-copy.tsx, and scripts/unit-onboarding.mjs pins them). Each is SECURITY-POSTURE.md §35's
// narrow wording, never a stronger claim.

export const ALLOW_LABEL = "Allow Totem to post as you";

/** the one line under the root composer once connected */
export function postsGoAsLine(handle: string): string {
  return `Posts go to Farcaster as @${handle}.`;
}

/** the main Farcaster app's visibility rule since Network School's "social contract" (Oct 2026) */
export const MAIN_APP_NOTE = "Heads up: the main Farcaster app now hides new posts from accounts that haven't accepted its rules (Network School's \"social contract\"). Your posts still show everywhere else.";

/** what the visitor is told BEFORE the first request: the key, the fee, what Totem's server sees, the same-address join */
export function beforeYouAllow(sponsored: boolean): string {
  return (
    "Totem makes a posting key in this browser and keeps it in your vault; you approve it in the Farcaster app. " +
    (sponsored ? "Totem pays the network fee for adding it. " : "The Farcaster app may ask you to pay a small network fee for adding it. ") +
    "Totem's server signs the request and passes your posts on to Farcaster, so it sees them (they're public anyway) and your internet address. Anonymous posts from this browser reach it from the same address: post those from another network if you want them kept apart."
  );
}

/** under the approval link and QR: a link someone else sends is how a stranger would get a key onto your account */
export const ONLY_YOURS = "Only approve a request you started here. If someone sent you a link or a code to approve, don't.";

/** how a forgotten key actually stops working (Disconnect only forgets it here) */
export const REMOVE_IN_APP = "In the Farcaster app, open Settings, then Connected apps, and remove Totem.";

// PERSONA SEPARATION FOR WRITES (SECURITY-POSTURE.md §35 A-ROOTPOST-PERSONA-SEPARATION): the device refuses both of these
// (lib/fc/rootSigner/flow.ts), and the cards and the composer say them before the click

/** nothing goes out as the root while a persona is the acting identity */
export const ROOT_OFF_WHILE_PERSONA = "You're acting as a persona, so nothing is posted, liked or recast as your own Farcaster account. Choose You in the account menu to act as yourself.";
/** ACTING AS YOURSELF (lib/device/actingRoot.ts): the composer of a visitor who has personas and chose "You" */
export const ACTING_AS_YOU_LINE = "You're acting as yourself, not a persona. To post as a persona, switch to it in the account menu.";
/** nothing as the root targets one of the visitor's own persona accounts */
export const ROOT_NOT_ON_OWN_PERSONA = "This is one of your personas. Liking, recasting or replying to it as your own account would link the two in public, so Totem doesn't.";
/** a Farcaster card's like, recast and reply before Totem may post as the visitor */
export function hubWritesNeedKey(handle: string): string {
  return `Liking, recasting and replying here act as @${handle} on Farcaster, once you allow Totem to post as you (Settings, Account).`;
}
