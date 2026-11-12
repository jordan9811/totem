// PUBLIC GO-LIVE — THE FARCASTER MINI APP SDK, wrapped for /anon (and its share page). CLIENT ONLY (every function reads
// `window`; on the server they answer "not inside a Mini App" and call nothing).
//
// THE SDK IS THE OFFICIAL PACKAGE, BUNDLED: @farcaster/miniapp-sdk at the exact version lib/miniapp/manifest.ts
// MINIAPP_SDK_VERSION names (0.3.0; package.json pins it), compiled into the page's own chunks, so /anon fetches nothing
// from a third party (no esm.sh, no CDN). The host protocol is NEVER hand-rolled here: if the package is not installed,
// this module says so (sdkAvailable() false) and the page works as an ordinary web page — the Mini App then waits on
// Farcaster's splash, because only the SDK's ready() hides it.
//
// INERT OUTSIDE A FARCASTER CLIENT. The package registers window/document listeners when it is evaluated and posts to
// window.parent when called (comlink's windowEndpoint, targetOrigin "*" — a parent is a Farcaster client only because
// middleware.ts lets only Farcaster's web origins frame these pages; on a phone the host is the app's own WebView). So it
// is not even evaluated unless the page could be inside a client — framed, or in a React Native WebView — and then
// sdk.isInMiniApp() must confirm (the host answers the context call) before anything else is called.
//
// What the page uses (the 0.3.0 types, read from the package: src/types.ts MiniAppSDK, miniapp-core src/actions/*):
//   actions.ready()                                hides the splash once the page can show something
//   actions.signIn({nonce, acceptAuthAddress})     -> {signature, message, authMethod: "custody" | "authAddress"}; throws
//                                                  SignIn.RejectedByUser when declined. The answer is VERIFIED by the device
//                                                  (lib/fc/siwf: the signature, then the chain), never trusted as sent
//   actions.composeCast({text?, embeds?})          -> {cast: {hash} | null}; embeds at most two
//   actions.openUrl(url)                           opens a URL outside the Mini App (the browser)
//   context (user)                                 the host-reported account (fid, username, display name, picture):
//                                                  UNVERIFIED — it only names the account the signed message proves
//
// WHY require() IN A try: webpack marks a require() inside a try block as an OPTIONAL dependency (a build without the
// package warns "Module not found" instead of failing), so a deploy that could not add the dependency still serves /anon
// as a web page. An import() would fail the whole build. TypeScript sees `any` there and the shape is checked below.
import { MINIAPP_SDK_PACKAGE, MINIAPP_SDK_VERSION } from "./manifest";

export { MINIAPP_SDK_PACKAGE, MINIAPP_SDK_VERSION };

export interface MiniAppSignIn {
  signature: string;
  message: string;
  authMethod?: "custody" | "authAddress";
}
/** the host-reported user (sdk.context.user): UNVERIFIED, like the sign-in relay's profile fields — only the signed
 *  message proves the account; these only name it */
export interface MiniAppUser {
  fid: number;
  username: string | null;
  displayName: string | null;
  pfpUrl: string | null;
}
interface MiniAppSdk {
  isInMiniApp: (timeoutMs?: number) => Promise<boolean>;
  context: Promise<{ user?: { fid?: unknown; username?: unknown; displayName?: unknown; pfpUrl?: unknown } } | undefined>;
  actions: {
    ready: (options?: { disableNativeGestures?: boolean }) => Promise<void>;
    signIn: (options: { nonce: string; acceptAuthAddress?: boolean; notBefore?: string; expirationTime?: string }) => Promise<MiniAppSignIn>;
    composeCast: (options?: { text?: string; embeds?: [] | [string] | [string, string] }) => Promise<{ cast: { hash: string } | null } | undefined>;
    openUrl: (url: string) => Promise<void>;
  };
}

let loaded: MiniAppSdk | null | undefined;

function loadSdk(): MiniAppSdk | null {
  if (loaded !== undefined) return loaded;
  loaded = null;
  try {
    const m = require("@farcaster/miniapp-sdk");
    const sdk = (m && (m.sdk ?? m.default)) as MiniAppSdk | undefined;
    if (sdk && typeof sdk.isInMiniApp === "function" && sdk.actions && typeof sdk.actions.ready === "function" && typeof sdk.actions.signIn === "function" && typeof sdk.actions.composeCast === "function" && typeof sdk.actions.openUrl === "function") loaded = sdk;
  } catch {
    loaded = null; // not installed in this build: the page stays a web page
  }
  return loaded;
}

/** could this document be inside a Farcaster client at all? Framed, or in a React Native WebView. No SDK is touched. */
export function mightBeMiniApp(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as { ReactNativeWebView?: unknown };
  try {
    return !!w.ReactNativeWebView || window.parent !== window;
  } catch {
    return true; // a cross-origin parent that throws on access is still a parent
  }
}

export interface MiniAppState {
  /** confirmed by the host (the context call answered) */
  inside: boolean;
  /** the SDK package is in this build */
  sdk: boolean;
}

let detected: Promise<MiniAppState> | null = null;

/** one detection per document: not framed and not a WebView = not inside (the SDK is never evaluated); otherwise the
 *  SDK's own isInMiniApp (the host must answer within `timeoutMs`). Never throws. */
export function detectMiniApp(timeoutMs = 1000): Promise<MiniAppState> {
  if (detected) return detected;
  detected = (async () => {
    if (!mightBeMiniApp()) return { inside: false, sdk: false };
    const sdk = loadSdk();
    if (!sdk) return { inside: false, sdk: false };
    try {
      return { inside: (await sdk.isInMiniApp(timeoutMs)) === true, sdk: true };
    } catch {
      return { inside: false, sdk: true };
    }
  })();
  return detected;
}

/** the SDK, only once the host has confirmed this is a Mini App (every call below goes through this) */
async function hostSdk(): Promise<MiniAppSdk | null> {
  const s = await detectMiniApp();
  return s.inside ? loadSdk() : null;
}

/** hide Farcaster's splash. Called once, when the page has drawn its first screen. A no-op outside a Mini App. */
let readySent = false;
export async function miniAppReady(): Promise<boolean> {
  if (readySent) return true;
  const sdk = await hostSdk();
  if (!sdk) return false;
  try {
    await sdk.actions.ready();
    readySent = true;
    return true;
  } catch {
    return false;
  }
}

/** sign in through the host: the message and signature the host's account signed over OUR nonce (the device verifies) */
export async function miniAppSignIn(nonce: string, expirationTime?: string): Promise<MiniAppSignIn | { rejected: true } | null> {
  const sdk = await hostSdk();
  if (!sdk) return null;
  try {
    const r = await sdk.actions.signIn({ nonce, acceptAuthAddress: true, ...(expirationTime ? { expirationTime } : {}) });
    if (!r || typeof r.message !== "string" || typeof r.signature !== "string") return null;
    return { message: r.message, signature: r.signature, authMethod: r.authMethod === "authAddress" ? "authAddress" : r.authMethod === "custody" ? "custody" : undefined };
  } catch (e) {
    if (String((e as { name?: string })?.name ?? "").includes("RejectedByUser")) return { rejected: true };
    return null;
  }
}

/** the host-reported user (to NAME the account the signed message proves; never trusted for anything else) */
export async function miniAppUser(): Promise<MiniAppUser | null> {
  const sdk = await hostSdk();
  if (!sdk) return null;
  try {
    const ctx = await Promise.race([sdk.context, new Promise<undefined>((r) => setTimeout(() => r(undefined), 2000))]);
    const u = ctx?.user;
    if (!u || typeof u.fid !== "number" || !Number.isSafeInteger(u.fid) || u.fid <= 0) return null;
    const str = (v: unknown, max: number) => (typeof v === "string" && v.length > 0 && v.length <= max ? v : null);
    return { fid: u.fid, username: str(u.username, 64), displayName: str(u.displayName, 100), pfpUrl: str(u.pfpUrl, 256) };
  } catch {
    return null;
  }
}

/** the host's cast composer with one embed; true when the composer opened (a cast posted or not is the person's choice) */
export async function miniAppCompose(embedUrl: string): Promise<boolean> {
  const sdk = await hostSdk();
  if (!sdk) return false;
  try {
    await sdk.actions.composeCast({ embeds: [embedUrl] });
    return true;
  } catch {
    return false;
  }
}

/** open a URL outside the Mini App (Totem, in the browser) */
export async function miniAppOpenUrl(url: string): Promise<boolean> {
  const sdk = await hostSdk();
  if (!sdk) return false;
  try {
    await sdk.actions.openUrl(url);
    return true;
  } catch {
    return false;
  }
}
