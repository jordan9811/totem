// OWNER PASSKEYS (D-OWNER-PASSKEYS) — the browser half of Face ID / fingerprint sign-in on the owner service: the two
// WebAuthn ceremonies and the plain-language errors the owner sees. Browser-only (called from client components);
// it imports constants only, never the gate's crypto. The server decides everything (lib/platform/owner-passkeys.server.ts):
// this file shuttles the challenge to the authenticator and the signed answer back.
//
// Review fixes, browser side:
//   UX-2   the sign-in reports PublicKeyCredential.authenticatorAttachment, so the server sets the "this device has a
//          passkey" hint only for a passkey that lives here, never for the phone's passkey used over the QR code
//   UX-3   PASSKEY AUTOFILL (conditional mediation): on the passphrase-first page the passphrase field also offers the
//          owner's passkeys (iCloud Keychain, Google Password Manager, Windows Hello) — an iPad or a Mac that has his
//          iPhone's synced passkey signs in from the field's suggestions, no paste. startConditionalSignIn keeps one
//          request open, aborts it before the button's own call, and renews its challenge before the server's
//          two-minute TTL (only while the page is visible, so an idle tab does not spend the sign-in budget)
//   UX-5   adding Face ID has its own messages ("You're still signed in"), never the sign-in ones; a removed passkey
//          is "already removed"; a slow prompt is "try again", never "You've been signed out"
//   UX-10  after a sign-in, the WebAuthn Signal API (where the browser has it) is told which passkeys are still
//          registered, so a removed one leaves the device's passkey picker
//   UX-12  the words match the device: Face ID / Touch ID on Apple devices, Windows Hello on Windows, the fingerprint or
//          screen lock on Android; "Face ID / fingerprint" elsewhere
//   UX-13  ownerAlreadySignedIn(): one same-origin GET, so a signed-in owner who lands on the sign-in page from another
//          site goes straight on
//   UX-15  "not switched on for this service yet" (the server has no usable APP_URL) is its own message — the browser
//          is not blamed for a server setting
import { b64url, fromB64url } from "@/lib/device/custody/passkey";
import { OWNER_PASSKEY_OPTIONS_API, OWNER_PASSKEY_VERIFY_API, OWNER_SECURITY_API } from "@/lib/platform/owner-paths";

export type OwnerPasskeyErrorKind =
  | "unsupported" // this browser cannot do it
  | "off" // the service has passkeys switched off (no usable APP_URL): not the browser's fault
  | "cancelled" // the owner closed the prompt, it timed out, or the device has no matching passkey
  | "exists" // this device can already sign in with a passkey for this service
  | "refused" // the server did not accept the signed answer
  | "retry" // adding one did not work this time (a slow prompt, a refused key): try again
  | "busy" // the sign-in budget is spent for now
  | "passphrase" // adding one needs a fresh passphrase sign-in
  | "full" // five already
  | "signed-out" // the session ended meanwhile
  | "gone" // that passkey was already removed (from another device)
  | "bad-name" // a name the service cannot store
  | "unavailable"; // the server could not do it right now

/** where an error is shown: the sign-in page, the post-sign-in offer, the Security page's Add button, or the
 *  Security page's other actions — the same failure reads differently in each */
export type OwnerPasskeyContext = "signin" | "offer" | "add" | "manage";

export class OwnerPasskeyError extends Error {
  constructor(
    readonly kind: OwnerPasskeyErrorKind,
    message: string
  ) {
    super(message);
    this.name = "OwnerPasskeyError";
  }
}

// ------------------------------------------------------------------------------------------------ words
export interface DeviceTraits {
  ua: string;
  touchPoints: number;
  /** the screen's long side over its short side (an iPhone with Face ID is taller than 2:1) */
  ratio: number;
}
function deviceTraits(): DeviceTraits {
  if (typeof navigator === "undefined") return { ua: "", touchPoints: 0, ratio: 0 };
  const w = typeof screen !== "undefined" ? screen.width : 0;
  const h = typeof screen !== "undefined" ? screen.height : 0;
  return { ua: navigator.userAgent || "", touchPoints: navigator.maxTouchPoints || 0, ratio: w && h ? Math.max(w, h) / Math.min(w, h) : 0 };
}

/** what this device calls its unlock (review UX-12). The generic words stay where nothing better is known — and in
 *  every server render, which cannot see the device (components switch to these words after mount). */
export function unlockName(t: DeviceTraits = deviceTraits()): string {
  const ua = t.ua;
  if (/iPhone/.test(ua)) return t.ratio > 0 && t.ratio < 2 ? "Touch ID" : "Face ID";
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && t.touchPoints > 1)) return "Face ID or Touch ID";
  if (/Macintosh|Mac OS X/.test(ua)) return "Touch ID";
  if (/Windows/.test(ua)) return "Windows Hello";
  if (/Android/.test(ua)) return "your fingerprint or screen lock";
  return GENERIC_UNLOCK;
}
export const GENERIC_UNLOCK = "Face ID / fingerprint";
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** a sensible default name for this device's passkey; the owner can rename it */
export function guessDeviceName(t: DeviceTraits = deviceTraits()): string {
  const ua = t.ua;
  if (!ua) return "This device";
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && t.touchPoints > 1)) return "iPad";
  if (/Macintosh|Mac OS X/.test(ua)) return "Mac";
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? "Android phone" : "Android tablet";
  if (/CrOS/.test(ua)) return "Chromebook";
  if (/Windows/.test(ua)) return "Windows PC";
  if (/Linux/.test(ua)) return "Linux computer";
  return "This device";
}

/** the words the owner reads for one failure, where it happened */
export function ownerPasskeyMessage(kind: OwnerPasskeyErrorKind, ctx: OwnerPasskeyContext, unlock: string = unlockName()): string {
  const adding = ctx === "offer" || ctx === "add";
  switch (kind) {
    case "unsupported":
      return adding ? `This browser can't add ${unlock} sign-in.` : `This browser can't use ${unlock} sign-in. Use your passphrase.`;
    case "off":
      return "Face ID / fingerprint sign-in isn't switched on for this service yet. Ask Claude to finish setting it up." + (ctx === "signin" ? " Your passphrase works meanwhile." : "");
    case "cancelled":
      if (adding) return `${cap(unlock)} wasn't added. You're still signed in. Tap the button to try again${ctx === "offer" ? ", or choose Not now" : ""}.`;
      return `${cap(unlock)} was cancelled. Tap the button to try again.`;
    case "exists":
      return `This device can already sign in with ${unlock}.`;
    case "refused":
      return adding ? "That didn't work. Tap the button to try again." : "That sign-in wasn't accepted. Use your passphrase this time.";
    case "retry":
      return "That didn't work. Tap the button to try again.";
    case "busy":
      return "Too many tries just now. Wait a minute, then try again" + (ctx === "signin" ? ", or use your passphrase." : ".");
    case "passphrase":
      return `To add ${unlock}, sign in with your passphrase first.`;
    case "full":
      return "This service already has 5 Face ID / fingerprint sign-ins. Remove one in Settings › Security first.";
    case "signed-out":
      return "You've been signed out on this device.";
    case "gone":
      return "That Face ID / fingerprint sign-in was already removed.";
    case "bad-name":
      return "That name can't be used. Try a shorter one.";
    case "unavailable":
      return "The service couldn't do that just now. Try again in a moment.";
  }
}

function err(kind: OwnerPasskeyErrorKind, ctx: OwnerPasskeyContext): OwnerPasskeyError {
  return new OwnerPasskeyError(kind, ownerPasskeyMessage(kind, ctx));
}

// ------------------------------------------------------------------------------------------------ the browser
/** the WebAuthn API exists in this browser (a page served over https, or localhost) */
export function passkeysSupported(): boolean {
  return typeof window !== "undefined" && typeof window.PublicKeyCredential === "function" && !!navigator.credentials;
}

/** this device has a built-in authenticator that verifies the user (Face ID, Touch ID, a fingerprint, Windows Hello) */
export async function platformPasskeyAvailable(): Promise<boolean> {
  if (!passkeysSupported()) return false;
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

/** passkey autofill (conditional mediation) works in this browser */
export async function conditionalMediationAvailable(): Promise<boolean> {
  if (!passkeysSupported()) return false;
  const pkc = PublicKeyCredential as unknown as { isConditionalMediationAvailable?: () => Promise<boolean> };
  if (typeof pkc.isConditionalMediationAvailable !== "function") return false;
  try {
    return (await pkc.isConditionalMediationAvailable()) === true;
  } catch {
    return false;
  }
}

async function postJson(url: string, body: unknown, ctx: OwnerPasskeyContext): Promise<{ status: number; json: Record<string, unknown> | null }> {
  let r: Response;
  try {
    r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), credentials: "same-origin", cache: "no-store" });
  } catch {
    throw err("unavailable", ctx);
  }
  let json: Record<string, unknown> | null = null;
  try {
    json = (await r.json()) as Record<string, unknown>;
  } catch {
    json = null;
  }
  return { status: r.status, json };
}

function ceremonyError(e: unknown, ctx: OwnerPasskeyContext): OwnerPasskeyError {
  const name = (e as { name?: string })?.name;
  if (name === "NotAllowedError" || name === "AbortError") return err("cancelled", ctx);
  if (name === "InvalidStateError") return err("exists", ctx);
  if (name === "NotSupportedError" || name === "SecurityError") return err("unsupported", ctx);
  return err("unavailable", ctx);
}

const bs = (u: Uint8Array) => u as unknown as BufferSource;

/** review UX-13: is this browser signed in to the owner service right now? One same-origin GET (the session cookie
 *  rides along even when the page itself was reached from another site); false on anything but a live session. */
export async function ownerAlreadySignedIn(): Promise<boolean> {
  try {
    const r = await fetch(OWNER_SECURITY_API, { method: "GET", headers: { accept: "application/json" }, credentials: "same-origin", cache: "no-store" });
    if (r.status !== 200) return false;
    const j = (await r.json().catch(() => null)) as { ok?: unknown } | null;
    return j?.ok === true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------------------------------------ sign-in
interface SignInChallenge {
  challenge: string;
  rpId: string;
  timeout: number;
}

/** step 1: a challenge from the server (the same answer for a stranger as for the owner) */
async function signInChallenge(): Promise<SignInChallenge> {
  const o = await postJson(OWNER_PASSKEY_OPTIONS_API, {}, "signin");
  if (o.status === 429) throw err("busy", "signin");
  if (o.status === 503 && o.json?.code === "owner_passkeys_unavailable") throw err("off", "signin");
  if (o.status !== 200 || !o.json || typeof o.json.challenge !== "string" || typeof o.json.rpId !== "string") throw err("unavailable", "signin");
  return { challenge: o.json.challenge, rpId: o.json.rpId, timeout: typeof o.json.timeout === "number" ? o.json.timeout : 60_000 };
}

/** review UX-10: tell the browser's passkey manager which of the owner's passkeys are still registered (feature-
 *  detected; never awaited, never fatal) */
function signalAcceptedCredentials(signal: unknown): void {
  const s = signal as { rpId?: unknown; userId?: unknown; allAcceptedCredentialIds?: unknown } | null | undefined;
  if (!s || typeof s.rpId !== "string" || typeof s.userId !== "string" || !Array.isArray(s.allAcceptedCredentialIds)) return;
  const ids = s.allAcceptedCredentialIds.filter((x): x is string => typeof x === "string");
  if (typeof window === "undefined" || typeof window.PublicKeyCredential !== "function") return;
  const pkc = window.PublicKeyCredential as unknown as {
    signalAllAcceptedCredentials?: (o: { rpId: string; userId: string; allAcceptedCredentialIds: string[] }) => Promise<void>;
  };
  if (typeof pkc.signalAllAcceptedCredentials !== "function") return;
  try {
    void pkc.signalAllAcceptedCredentials({ rpId: s.rpId, userId: s.userId, allAcceptedCredentialIds: ids }).catch(() => undefined);
  } catch {
    /* a browser that half-implements it: nothing to do */
  }
}

/** step 2: one assertion from this device's authenticator (or the phone's, over the QR code) */
async function getAssertion(c: SignInChallenge, mediation?: "conditional", signal?: AbortSignal): Promise<PublicKeyCredential> {
  let cred: PublicKeyCredential | null;
  try {
    cred = (await navigator.credentials.get({
      ...(mediation ? { mediation } : {}),
      ...(signal ? { signal } : {}),
      publicKey: {
        challenge: bs(fromB64url(c.challenge)),
        rpId: c.rpId,
        timeout: c.timeout,
        userVerification: "required",
      },
    })) as PublicKeyCredential | null;
  } catch (e) {
    throw ceremonyError(e, "signin");
  }
  if (!cred) throw err("cancelled", "signin");
  return cred;
}

/** step 3: the signed answer back; the session cookie comes with the answer */
async function verifyAssertion(cred: PublicKeyCredential, next: string): Promise<string> {
  const resp = cred.response as AuthenticatorAssertionResponse;
  const id = b64url(cred.rawId);
  const attachment = (cred as { authenticatorAttachment?: string | null }).authenticatorAttachment;
  const v = await postJson(
    OWNER_PASSKEY_VERIFY_API,
    {
      id,
      rawId: id,
      type: cred.type,
      // review UX-2: "platform" (this device's own or a synced passkey) or "cross-platform" (a phone over the QR code,
      // a security key) — the server sets this device's hint only for the first
      authenticatorAttachment: attachment === "platform" || attachment === "cross-platform" ? attachment : null,
      response: {
        clientDataJSON: b64url(resp.clientDataJSON),
        authenticatorData: b64url(resp.authenticatorData),
        signature: b64url(resp.signature),
        userHandle: resp.userHandle ? b64url(resp.userHandle) : null,
      },
      next,
    },
    "signin"
  );
  if (v.status === 200 && v.json?.ok === true) {
    signalAcceptedCredentials(v.json.signal);
    return typeof v.json.next === "string" ? v.json.next : "/home";
  }
  if (v.status === 429) throw err("busy", "signin");
  if (v.status === 503) throw err("unavailable", "signin");
  throw err("refused", "signin");
}

/** ONE TAP: a challenge from the server, one assertion from this device's authenticator (Face ID / fingerprint), the
 *  signed answer back. Resolves with where to go next — the session cookie is already set (httpOnly). */
export async function signInWithPasskey(next: string): Promise<string> {
  if (!passkeysSupported()) throw err("unsupported", "signin");
  return verifyAssertion(await getAssertion(await signInChallenge()), next);
}

/** the server's sign-in challenge lives two minutes; an open autofill request is renewed a little before that */
export const CONDITIONAL_REFRESH_MS = 100_000;

export interface ConditionalSignIn {
  /** end it now (before the button's own sign-in, on unmount); idempotent */
  stop(): void;
}

/**
 * Review UX-3 — PASSKEY AUTOFILL. Keeps one conditional-mediation request open, so the passphrase field (marked
 * autocomplete="… webauthn") offers the owner's passkeys among its suggestions. Picking one runs Face ID / fingerprint
 * and signs in (onSignedIn). The request is renewed with a fresh challenge every CONDITIONAL_REFRESH_MS while the page
 * is visible (a hidden page renews when it is shown again), so a challenge never expires under an open prompt and an
 * idle background tab spends nothing. A prompt the owner cancels is offered again; a refusal or an outage after a pick
 * is reported (onError) and autofill stops; a failure before anything was offered (no challenge, a browser that
 * refuses at once) stops it silently — the big button and the passphrase are still there. Never a tight loop.
 */
export function startConditionalSignIn(
  next: string,
  cb: { onSignedIn: (to: string) => void; onError: (e: OwnerPasskeyError) => void },
  refreshMs: number = CONDITIONAL_REFRESH_MS
): ConditionalSignIn {
  let stopped = false;
  let current: AbortController | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stale = false;
  const doc = typeof document !== "undefined" ? document : null;
  const visible = () => !doc || doc.visibilityState !== "hidden";

  const clearTimer = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearTimer();
    current?.abort();
    current = null;
    doc?.removeEventListener("visibilitychange", onVisibility);
  };
  const renew = () => {
    stale = false;
    current?.abort(); // its round sees its own signal aborted and ends quietly
    void round();
  };
  function onVisibility() {
    if (!stopped && stale && visible()) renew();
  }

  async function round(): Promise<void> {
    if (stopped) return;
    clearTimer();
    const ac = new AbortController();
    current = ac;
    let c: SignInChallenge;
    try {
      c = await signInChallenge();
    } catch {
      if (current === ac && !ac.signal.aborted) stop(); // nothing was offered yet: no message, no retry
      return;
    }
    if (stopped || ac.signal.aborted || current !== ac) return;
    timer = setTimeout(() => {
      if (current !== ac) return;
      if (visible()) renew();
      else stale = true;
    }, refreshMs);
    const startedAt = Date.now();
    let cred: PublicKeyCredential;
    try {
      cred = await getAssertion(c, "conditional", ac.signal);
    } catch (e) {
      if (stopped || ac.signal.aborted || current !== ac) return; // a renewal or a stop of ours
      if (e instanceof OwnerPasskeyError && e.kind === "cancelled" && Date.now() - startedAt >= 1000) {
        void round(); // the owner picked a passkey and then cancelled the prompt: offer them again
        return;
      }
      stop(); // refused at once (no autofill here after all) or broken: quietly off — the button still works
      return;
    }
    // picked and verified on the device: from here nothing renews or aborts this round
    clearTimer();
    if (stopped || current !== ac) return;
    try {
      const to = await verifyAssertion(cred, next);
      stop();
      cb.onSignedIn(to);
    } catch (e) {
      stop();
      cb.onError(e instanceof OwnerPasskeyError ? e : err("unavailable", "signin"));
    }
  }

  doc?.addEventListener("visibilitychange", onVisibility);
  void round();
  return { stop };
}

// ------------------------------------------------------------------------------------------------ adding one
interface CreationOptionsJson {
  challenge: string;
  rp: { id: string; name: string };
  user: { id: string; name: string; displayName: string };
  pubKeyCredParams: { type: "public-key"; alg: number }[];
  timeout: number;
  attestation: "none";
  authenticatorSelection: AuthenticatorSelectionCriteria;
  excludeCredentials: { type: "public-key"; id: string; transports?: string[] }[];
}

type AttestationResponseL3 = AuthenticatorAttestationResponse & {
  getPublicKey?: () => ArrayBuffer | null;
  getPublicKeyAlgorithm?: () => number;
  getAuthenticatorData?: () => ArrayBuffer;
  getTransports?: () => string[];
};

/** what a Security route answer means for the owner, where it happened (review UX-5) */
export function mapSecurityError(status: number, code: unknown, ctx: OwnerPasskeyContext): OwnerPasskeyError {
  if (status === 401) return err("signed-out", ctx);
  if (status === 403 && code === "passphrase_required") return err("passphrase", ctx);
  if (status === 409 && code === "passkeys_full") return err("full", ctx);
  if (status === 409 && code === "passkey_exists") return err("exists", ctx);
  if (status === 409 && code === "sign_in_again") return err("passphrase", ctx);
  if (status === 404 && code === "passkey_gone") return err("gone", ctx);
  if (status === 400 && code === "bad_name") return err("bad-name", ctx);
  if (status === 400 && code === "try_again") return err("retry", ctx);
  if (status === 503 && code === "owner_passkeys_unavailable") return err("off", ctx);
  if (status === 429) return err("busy", ctx);
  if (status >= 500) return err("unavailable", ctx);
  return err(ctx === "offer" || ctx === "add" ? "retry" : "unavailable", ctx);
}

/** "Add Face ID / fingerprint for this device": creation options from the server (this session must be a fresh
 *  passphrase sign-in), one new discoverable credential from this device's own authenticator, its public key back.
 *  On success the server has also signed this device in WITH the new passkey (review UX-1). */
export async function addPasskeyForThisDevice(name: string, ctx: "offer" | "add" = "add"): Promise<{ slot: string; name: string }> {
  if (!passkeysSupported()) throw err("unsupported", ctx);
  const o = await postJson(OWNER_SECURITY_API, { action: "register-options" }, ctx);
  if (o.status !== 200 || !o.json || typeof o.json.options !== "object" || !o.json.options) throw mapSecurityError(o.status, o.json?.code, ctx);
  const opt = o.json.options as CreationOptionsJson;
  let cred: PublicKeyCredential | null;
  try {
    cred = (await navigator.credentials.create({
      publicKey: {
        challenge: bs(fromB64url(opt.challenge)),
        rp: opt.rp,
        user: { id: bs(fromB64url(opt.user.id)), name: opt.user.name, displayName: opt.user.displayName },
        pubKeyCredParams: opt.pubKeyCredParams,
        timeout: opt.timeout,
        attestation: "none",
        authenticatorSelection: opt.authenticatorSelection,
        excludeCredentials: opt.excludeCredentials.map((c) => ({ type: "public-key" as const, id: bs(fromB64url(c.id)), transports: c.transports as AuthenticatorTransport[] | undefined })),
      },
    })) as PublicKeyCredential | null;
  } catch (e) {
    throw ceremonyError(e, ctx);
  }
  if (!cred) throw err("cancelled", ctx);
  const resp = cred.response as AttestationResponseL3;
  if (typeof resp.getPublicKey !== "function" || typeof resp.getPublicKeyAlgorithm !== "function" || typeof resp.getAuthenticatorData !== "function") {
    throw new OwnerPasskeyError("unsupported", "This browser is too old to add Face ID / fingerprint sign-in. Update it, or use another browser.");
  }
  const spki = resp.getPublicKey();
  if (!spki) throw new OwnerPasskeyError("unsupported", "This device made a kind of key the service can't use. Try another browser.");
  const id = b64url(cred.rawId);
  const v = await postJson(
    OWNER_SECURITY_API,
    {
      action: "register",
      name,
      credential: {
        id,
        rawId: id,
        type: cred.type,
        response: {
          clientDataJSON: b64url(resp.clientDataJSON),
          authenticatorData: b64url(resp.getAuthenticatorData()),
          publicKey: b64url(spki),
          publicKeyAlgorithm: resp.getPublicKeyAlgorithm(),
          transports: typeof resp.getTransports === "function" ? resp.getTransports() : [],
        },
      },
    },
    ctx
  );
  const passkey = v.json?.passkey as { slot?: unknown; name?: unknown } | undefined;
  if (v.status === 200 && v.json?.ok === true && typeof passkey?.slot === "string" && typeof passkey.name === "string") return { slot: passkey.slot, name: passkey.name };
  throw mapSecurityError(v.status, v.json?.code, ctx);
}

/** a plain POST to the Security route (rename, remove, lost, this isn't my device, sign out everywhere); throws an
 *  OwnerPasskeyError worded for where it happened */
export async function ownerSecurityAction(body: Record<string, unknown>, ctx: OwnerPasskeyContext = "manage"): Promise<Record<string, unknown>> {
  const r = await postJson(OWNER_SECURITY_API, body, ctx);
  if (r.status === 200 && r.json?.ok === true) return r.json;
  throw mapSecurityError(r.status, r.json?.code, ctx);
}
