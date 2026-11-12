// PUBLIC GO-LIVE — the front door's words, in ONE place: the live landing (components/landing/Landing.tsx, a server
// component) and the guided first run's welcome screen (steps/WelcomeStep.tsx, a client component) both say them, so
// they can never say them two ways. Plain constants: no imports, safe in either bundle.

export const FRONT_HEADLINE = "One you. Many personas.";
export const FRONT_LINE = "Your Farcaster account, plus as many other faces as you want. You decide who sees which one is you.";
export const SIGN_IN_FARCASTER = "Sign in with Farcaster";
/** Sign in with X (lib/x/signin): until the deployment carries an X app (X_CLIENT_ID) the button is shown, disabled,
 *  marked Soon; armed, it is a door to the guided run's step 1, where the X card says who sees what */
export const CONTINUE_WITH_X = "Continue with X";
export const USED_BEFORE = "I've used Totem before";
export const GET_FARCASTER_ASK = "No Farcaster account yet?";
export const GET_FARCASTER_LINK = "Get one free";
export const GET_FARCASTER_URL = "https://farcaster.xyz";
