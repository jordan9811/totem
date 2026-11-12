// PUBLIC GO-LIVE — THE GUIDED FIRST RUN'S STEP MACHINE (pure: no imports, no I/O; scripts/unit-onboarding.mjs tests it).
//
// THE OWNER'S FLOW (2026-11-05): connect the account you already have, and that account IS you — your root. Personas
// are optional and are never asked for here. Three steps, one screen each, a three-dot indicator and Back:
//   1. Sign in with Farcaster        ("farcaster")
//   2. This is you                    ("profile": your Farcaster picture, name and username, editable; your verified X)
//   3. Keep your account              ("save": a passkey, or "Not now" to keep it in this browser only)
// then the home feed, signed in as that account, with "Pick up where you left off" above the feed (find your people,
// bring your X posts, make a persona — all optional). Before step 1 there is the welcome screen (the landing's own
// doors, for a visitor who opens /welcome itself, and the "I've used Totem before" unlock). Sign in with Farcaster keeps
// a quiet Skip (the owner's runbook saves an identity before signing in); This is you exists only for a signed-in visitor.
// components/onboarding/Onboarding.tsx renders it.
//
// RESUMABLE WITHOUT A STORED MARKER. Where the visitor is comes from what the device already holds — its public self
// (the Farcaster account Sign in with Farcaster linked), its saved ways in (a passkey), its personas — plus what was
// done in THIS document (React state: skips, and whether This is you was confirmed). Nothing about the flow is written
// anywhere: no localStorage flag, no new sealed namespace on the validator (a namespace would be one more name the
// operator sees under every anchor, and the facts already say where the visitor is).
//
// THE RETURNING-VISITOR RULE: an identity that was restored from this browser at boot, or unlocked in this document,
// AND already has someone to be (a Farcaster sign-in, or a persona made before this flow), never sees the flow: /welcome
// sends it to /home at once ("done"). A sign-in made IN this document is not "already": a saved identity that signs in
// for the first time (the owner's runbook: save first, sign in later) is shown This is you, like anyone else.
//
// PUBLIC GO-LIVE (F10): a RESTORED (kept) identity never sees the welcome screen again, even with nothing met yet: on a
// phone the identity is kept BEFORE the Farcaster app opens (components/device/FarcasterSignIn.tsx keepFirst), so a reload
// during that app switch lands on the Farcaster step, not on the welcome screen as if nothing had happened.
//
// PUBLIC GO-LIVE (F5): AN EXPLICIT TARGET. A link into /welcome may say where to land (readTarget, landingStep):
// farcaster|profile|save lands on that step even for a returning visitor that is done and past this document's skips
// (the visitor asked for it: Settings' Farcaster row, "Continue setting up", the composer's "sign in again"); This is you
// needs a signed-in visitor, so #profile without one lands on Sign in with Farcaster; next lands on the first unmet step
// past the welcome screen (the landing's Sign in with Farcaster door, "Finish setting up"); unlock opens "I've used Totem
// before" even when the visitor is not fresh. The target is spent by the first move (Continue, Skip, Back, an unlock);
// the machine's own rules apply after that. The old #x and #persona targets are gone with their steps (no link makes
// them; a hand-typed one is no target).
// THE APP'S OWN LINKS CARRY IT IN THE HASH (welcomeHref: /welcome#farcaster, #next, #unlock …): a hash never reaches the
// server, so its request log never learns which step a visitor jumped to — "this address went to sign in again to join
// the anonymous crowd" is exactly the kind of fact the operator should not hold (SECURITY-POSTURE.md §21: the server
// sees nothing of a sign-in). ?step=<target> is also read (a hand-typed or older link), and wins over the hash.

export const ONBOARDING_STEPS = ["welcome", "farcaster", "profile", "save", "done"] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];

/** the steps the progress indicator counts (the welcome screen and the hand-off are not steps) */
export const COUNTED_STEPS: readonly OnboardingStep[] = ["farcaster", "profile", "save"];

/** what the device holds right now (read after it booted) */
export interface OnboardingFacts {
  /** a Farcaster account is signed in on this identity (and not disconnected) */
  publicSelf: boolean;
  /** at least one saved way in (a passkey, or another method the device lists) */
  saved: boolean;
  /** the identity's own personas that can post (the read-only public self is not one) */
  personas: number;
  /** restored from this browser at boot, or unlocked in this document */
  returning: boolean;
}

/** what happened in THIS document (never stored) */
export interface OnboardingProgress {
  /** the visitor left the welcome screen (or arrived from the anon page's click-through) */
  started: boolean;
  /** steps the visitor skipped in this document */
  skipped: readonly OnboardingStep[];
  /** This is you was confirmed (Continue) in this document */
  profileSeen: boolean;
  /** the Sign in with Farcaster card acted in this document (a sign-in made here is not a returning visitor's) */
  signedInHere: boolean;
}

export const NO_PROGRESS: OnboardingProgress = Object.freeze({ started: false, skipped: Object.freeze([]) as readonly OnboardingStep[], profileSeen: false, signedInHere: false });

/** a visitor is set up once there is someone to be: their Farcaster account (the root), or a persona made earlier.
 *  A persona is NEVER required. */
export function isDone(f: OnboardingFacts): boolean {
  return f.publicSelf || f.personas > 0;
}

/** the returning-visitor rule: restored or unlocked, and done when it arrived — /welcome is never shown (a sign-in made in
 *  this document does not count as arriving done) */
export function returningAndDone(f: OnboardingFacts, p: OnboardingProgress = NO_PROGRESS): boolean {
  if (!f.returning) return false;
  return f.personas > 0 || (f.publicSelf && !p.signedInHere);
}

/**
 * The step to show. In order: the welcome screen for a visitor with nothing yet (and not restored: F10); then the first
 * step whose fact is not met and that was not skipped (This is you only for a signed-in visitor, until confirmed in this
 * document); then the hand-off. A visitor that is returning and done goes straight to "done".
 */
export function nextStep(f: OnboardingFacts, p: OnboardingProgress = NO_PROGRESS): OnboardingStep {
  if (returningAndDone(f, p)) return "done";
  const skipped = (s: OnboardingStep) => p.skipped.includes(s);
  const fresh = !f.publicSelf && !f.saved && f.personas === 0;
  if (fresh && !p.started && !f.returning) return "welcome";
  if (!f.publicSelf && !skipped("farcaster")) return "farcaster";
  if (f.publicSelf && !p.profileSeen && !skipped("profile")) return "profile";
  if (!f.saved && !skipped("save")) return "save";
  return "done";
}

// ---------------------------------------------------------------- an explicit target (F5)

/** PUBLIC GO-LIVE (F5): where a link into /welcome asked to land (see the header) */
export type OnboardingTarget = "farcaster" | "profile" | "save" | "next" | "unlock";

const STEP_TARGETS: readonly OnboardingTarget[] = ["farcaster", "profile", "save", "next"];

/** the target a link carries: ?step= first (farcaster, profile, save, next), else the hash (the same names, or
 *  #unlock); anything else is none */
export function readTarget(step: unknown, hash?: unknown): OnboardingTarget | null {
  const s = typeof step === "string" ? step.trim().toLowerCase() : "";
  if ((STEP_TARGETS as readonly string[]).includes(s)) return s as OnboardingTarget;
  const h = typeof hash === "string" ? hash.trim().toLowerCase() : "";
  if (!h.startsWith("#")) return null;
  const name = h.slice(1);
  if (name === "unlock" || (STEP_TARGETS as readonly string[]).includes(name)) return name as OnboardingTarget;
  return null;
}

/** a link into /welcome that lands on `target` — in the HASH, which never reaches the server (see the header). The one
 *  place the app spells these hrefs. */
export function welcomeHref(target: OnboardingTarget | null = null): string {
  return target ? "/welcome#" + target : "/welcome";
}

/** a persona is made on the home feed's "Pick up where you left off" card (components/home/PickUp.tsx), never in the
 *  first run: the app's "Make a persona" links go here (the hash opens the card's form) */
export const MAKE_PERSONA_HREF = "/home#make-persona";
/** a soft navigation to a hash on the same page fires no hashchange (the router uses pushState), so the links also say
 *  it with this window event; the card opens on either */
export const MAKE_PERSONA_EVENT = "totem:make-persona";

/**
 * The step to show while an explicit target is unspent: a named step is shown as asked (past the returning-visitor rule
 * and this document's skips; This is you needs a signed-in visitor, else Sign in with Farcaster), "next" is the first
 * unmet step past the welcome screen, "unlock" is the welcome screen (with "I've used Totem before" open). No target:
 * nextStep.
 */
export function landingStep(f: OnboardingFacts, p: OnboardingProgress, target: OnboardingTarget | null): OnboardingStep {
  if (target === "unlock") return "welcome";
  if (target === "profile") return f.publicSelf ? "profile" : "farcaster";
  if (target === "farcaster" || target === "save") return target;
  if (target === "next") return nextStep(f, { ...p, started: true });
  return nextStep(f, p);
}

/** one step back (Back): the counted step before this one, else the welcome screen. From Keep your account a visitor who
 *  is not signed in goes back to Sign in with Farcaster (This is you exists only for a signed-in visitor). */
export function previousStep(step: OnboardingStep, signedIn = true): OnboardingStep {
  if (step === "save" && !signedIn) return "farcaster";
  const i = COUNTED_STEPS.indexOf(step);
  if (i <= 0) return "welcome";
  return COUNTED_STEPS[i - 1];
}

/** a skip of `step`, recorded */
export function skip(p: OnboardingProgress, step: OnboardingStep): OnboardingProgress {
  return { ...p, started: true, skipped: p.skipped.includes(step) ? p.skipped : [...p.skipped, step], profileSeen: p.profileSeen || step === "profile" };
}

/** This is you, confirmed */
export function confirmProfile(p: OnboardingProgress): OnboardingProgress {
  return { ...p, started: true, profileSeen: true };
}

/** the Sign in with Farcaster card acted in this document */
export function signedInHere(p: OnboardingProgress): OnboardingProgress {
  return p.signedInHere ? p : { ...p, signedInHere: true };
}

/** where the progress indicator stands: step k of n (null for the welcome screen and the hand-off) */
export function progressOf(step: OnboardingStep): { index: number; total: number } | null {
  const i = COUNTED_STEPS.indexOf(step);
  return i < 0 ? null : { index: i + 1, total: COUNTED_STEPS.length };
}

// ---------------------------------------------------------------- This is you: the username inside Totem

/** a Totem handle from a Farcaster username: lower case letters, digits and underscores, at most 30 (the same rule Sign
 *  in with Farcaster mints the public self's handle by: lib/fc/siwf/flow.ts) */
export function handleFromFname(fname: string | null | undefined): string {
  const h = String(fname ?? "").toLowerCase().replace(/[^a-z0-9_]/g, "_").replace(/^_+|_+$/g, "").slice(0, 30);
  return h || "farcaster_main";
}

/**
 * Up to `n` free alternatives to `base` inside Totem's own handle namespace, in a fixed order (deterministic: the same
 * base and the same taken set give the same list). `isTaken` answers for one candidate; `base` itself is never offered.
 */
export function handleSuggestions(base: string, isTaken: (h: string) => boolean, n = 3): string[] {
  const b = handleFromFname(base);
  const out: string[] = [];
  const offer = (h: string) => {
    const c = h.slice(0, 30).replace(/_+$/g, "");
    if (c && c !== b && /^[a-z0-9_]{1,30}$/.test(c) && !out.includes(c) && !isTaken(c)) out.push(c);
  };
  const stem = b.slice(0, 27);
  for (const h of [b.slice(0, 27) + "_fc", "its_" + b.slice(0, 26), b.slice(0, 26) + "_here"]) {
    if (out.length >= n) break;
    offer(h);
  }
  for (let i = 1; out.length < n && i < 1000; i++) offer(stem.slice(0, 30 - String(i).length - 1) + "_" + i);
  return out;
}

/** a phone, for the Farcaster step (a deep link into the Farcaster app instead of a QR code to scan) */
export function isPhoneLike(userAgent: string, coarsePointer: boolean): boolean {
  if (/iPhone|iPod|Android.+Mobile|Mobile Safari|Windows Phone/i.test(userAgent)) return true;
  if (/iPad|Android/i.test(userAgent) && coarsePointer) return true;
  return false;
}

/** a handle from a display name: lower case letters, digits and underscores, at most 30 */
export function suggestHandle(name: string): string {
  return String(name ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 30);
}

// ---------------------------------------------------------------- where a post goes (GET /api/anon, relay's contract)

export type AnonDestination = "farcaster" | "layers" | "off";

/** GET /api/anon's contract for where a persona's post goes (the relay track writes the words; nothing here does) */
export interface AnonDestinationAnswer {
  destination: AnonDestination;
  destinationSentence: string;
  postedSentence: string | null;
  castUrl: string | null;
}

/** the route's destination fields, validated — null when the route says nothing (an older route, or a failed read) */
export function readAnonDestination(j: unknown): AnonDestinationAnswer | null {
  if (!j || typeof j !== "object") return null;
  const o = j as Record<string, unknown>;
  const d = o.destination;
  if (d !== "farcaster" && d !== "layers" && d !== "off") return null;
  if (typeof o.destinationSentence !== "string" || !o.destinationSentence.trim()) return null;
  const castUrl = typeof o.castUrl === "string" && /^https:\/\//.test(o.castUrl) ? o.castUrl : null;
  return {
    destination: d,
    destinationSentence: o.destinationSentence,
    postedSentence: typeof o.postedSentence === "string" && o.postedSentence.trim() ? o.postedSentence : null,
    castUrl,
  };
}

/**
 * The one sentence about where a persona's posts go, for the persona step: the route's destinationSentence word for
 * word; while a route without that field answers, the route's own existing words (its preview sentence, or why
 * anonymous posting is off) — never words of this file's own; null when the route said nothing usable (the step then
 * says it could not check, never guesses).
 */
export function destinationSentenceOf(j: unknown): string | null {
  const d = readAnonDestination(j);
  if (d) return d.destinationSentence;
  if (!j || typeof j !== "object") return null;
  const o = j as Record<string, unknown>;
  if (o.previewOnly === true && typeof o.previewSentence === "string" && o.previewSentence.trim()) return o.previewSentence;
  if (o.available === false && typeof o.unavailableReason === "string" && o.unavailableReason.trim()) return o.unavailableReason;
  return null;
}

// ---------------------------------------------------------------- signing in again to join the live crowd (F2)

/**
 * PUBLIC GO-LIVE (F2): do the anon route's own words ask this visitor to sign in with Farcaster to join the LIVE
 * anonymous crowd? GET /api/anon says unavailableCode "crowd" with no availableFrom (a join known to this tab says WHEN
 * instead), and its sentence asks for a Farcaster sign-in (lib/zk/anon/availability.ts ANON_LIVE_SIGN_IN_FIRST,
 * ANON_LIVE_JOIN_FAILED, ANON_LIVE_NOT_LISTED — never the floor's or a join's "you can post from" sentences, which ask for
 * nothing; scripts/unit-onboarding.mjs U13 pins the rule against availability.ts's real sentences). Anything unreadable is
 * no: the button is an offer, and an answer this cannot read offers nothing.
 */
export function crowdSignInAsked(j: unknown): boolean {
  if (!j || typeof j !== "object") return false;
  const o = j as Record<string, unknown>;
  if (o.unavailableCode !== "crowd") return false;
  if (typeof o.availableFrom === "number") return false;
  const reason = typeof o.unavailableReason === "string" ? o.unavailableReason : "";
  return /\bsign in with Farcaster\b/i.test(reason);
}

/**
 * PUBLIC GO-LIVE (F2): offer "Sign in again with Farcaster to join the anonymous crowd" — the site handed this tab the
 * LIVE universe (`hinted`: the device env's ZK_ANON_UNIVERSE=live), the visitor is signed in (a link, not disconnected:
 * a disconnected link already gets "Sign in again"), and the route asks for a sign-in (crowdSignInAsked).
 */
export function rejoinOffered(o: { hinted: boolean; signedIn: boolean; answer: unknown }): boolean {
  return o.hinted === true && o.signedIn === true && crowdSignInAsked(o.answer);
}

/** the button's words (the Farcaster card and the composer say the same) */
export const REJOIN_LABEL = "Sign in again with Farcaster to join the anonymous crowd";
/** the composer's link for a visitor who is not signed in yet (same route words, same place to go) */
export const JOIN_LABEL = "Sign in with Farcaster to join the anonymous crowd";
