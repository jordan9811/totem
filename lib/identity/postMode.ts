import "server-only";
// PERSONA LAUNCH P3 (D2) — A PERSONA'S POST MODE: where its posts go when it writes.
//
//   anon     through the shared @anon account, proof-gated, with a reveal secret only this root holds (lib/zk/gate.ts).
//            THE DEFAULT for a persona WITHOUT its own Farcaster account (D2: the reversible choice). CHOSEN EXPLICITLY on
//            a persona that owns an account, it keeps that account silent: plain posts and the Farcaster buttons answer
//            "Totem only" (farcasterDelivery.ts post_mode_anon, PRIV-2) — @anon is the only way its words leave.
//   private  Totem only: nothing this persona does leaves Totem (the anon route refuses it, and the Farcaster buttons
//            answer "Totem only" — app/api/actions/farcasterDelivery.ts post_mode_private).
//   direct   straight to the persona's OWN account. The default for a persona that owns one; refused for one that
//            does not (a "direct" persona with no account would fall back to the shared account, which never happens).
//
// WHERE IT LIVES. An explicit choice is stored on the persona's keystore record (lib/identity/keystore.ts postMode) —
// which a restart reads back from disk and which the sealed identityRoster carries into a 24-word or passkey recovery
// (rosterForRecovery copies the whole record) — and on its root-roster display record (lib/identity/rootRoster.ts). An
// ABSENT choice is never written: the default is computed, so a persona that later gets its own account moves from
// anon to direct by itself, and a pre-P3 persona's record stays byte-identical.
//
// NEVER FAIL OPEN. Deciding the default reads the persona's account record (the sealed personaFids vault); a read that
// fails THROWS (lib/fc/personaFid.ts load) — the callers refuse, they never guess "anon". A write is LOUD: the keystore,
// the root roster and the sealed identity roster are written in that order and any failure is an error the caller
// shows — never a quiet success over a roster that did not take the change.
//
// THE PUBLIC SELF (SIWF, P1): the visitor's own Farcaster account is a read-only persona — it has no post mode (null),
// posts nothing from Totem, and its mode cannot be set.
//
// PERSONA LAUNCH P6 (D2) — A LAUNCHED PERSONA MUST CHOOSE. Launch gives a persona its own account (origin
// "layers-launch"); from then on where its posts go is a REQUIRED choice: with none made the mode is PRESET "anon" (the
// reversible choice — D2) and choiceRequired is true, so the composer asks before the next post. "direct" sends its
// posts to its own account through the thin relay, signed by its own registered key. Going back to anon after posting
// directly is weak (the writing style is public by then), and the picker says so. (D7 — every anon post revealed
// together — is held by the launch itself: its batch reveal waits until every anon post the persona made is relayed,
// lib/launch/tick.ts; nothing here pauses posting.)
import { getPersona, isOwnPersona, updatePersona, type PostMode } from "./keystore";
import { kindOf } from "./personaKind";
import { SEED_VIEWER, personaById } from "@/lib/adapters/mock/store";
import { isEmptyWorld } from "@/lib/world-flag";
import { isRealPersona } from "@/lib/world";

export type { PostMode };
export const POST_MODES: ReadonlyArray<PostMode> = Object.freeze(["anon", "private", "direct"]);
export function isPostMode(x: unknown): x is PostMode {
  return typeof x === "string" && (POST_MODES as ReadonlyArray<string>).includes(x);
}

/** SIWF's sentence for the read-only public self (app/api/actions/* PUBLIC_SELF_READ_ONLY) — the same words here */
export const PUBLIC_SELF_SENTENCE = "Your Farcaster account is read-only here; switch to a persona";

/** the persona's handle for the plain-words sentences (keystore first, then the rendering map) */
export function handleOfPersona(personaId: string): string | null {
  try {
    const p = getPersona(personaId);
    if (p) return p.handle;
  } catch {
    /* an unreadable keystore names nothing — the seeded map may still */
  }
  return personaById.get(personaId)?.handle ?? null;
}

/** is this one of THIS device's personas, for posting? The keystore's personas; on the demo rig also the seeded
 *  viewer's (the fixture self); under LAYERS_WORLD=empty only the REAL ones (never the seed's adopted demo personas) */
export function isOwnPostingPersona(personaId: string): boolean {
  if (typeof personaId !== "string" || !/^[A-Za-z0-9_]{1,80}$/.test(personaId)) return false;
  if (isEmptyWorld()) return isRealPersona(personaId);
  return isOwnPersona(personaId) || SEED_VIEWER.personas.includes(personaId);
}

/** the visitor's own Farcaster account (SIWF): read-only, never a poster */
export function isPublicSelf(personaId: string): boolean {
  return getPersona(personaId)?.publicSelf === true;
}

/** the EXPLICIT choice on the keystore record, or null when none was made (or the persona is not in the keystore) */
export function explicitPostMode(personaId: string): PostMode | null {
  const m = getPersona(personaId)?.postMode;
  return isPostMode(m) ? m : null;
}

/** does the persona own its OWN Farcaster account record? THROWS when the record cannot be read (never "no") */
export async function ownsAccount(personaId: string): Promise<boolean> {
  return (await accountOriginOf(personaId)) !== null;
}

/** PERSONA LAUNCH P6: the persona's account record's origin (null: no account). THROWS when it cannot be read. */
export async function accountOriginOf(personaId: string): Promise<string | null> {
  const { personaFidRecord } = await import("@/lib/fc/personaFid");
  const rec = await personaFidRecord(personaId);
  return rec ? (rec.origin ?? "unknown") : null;
}

/** PERSONA LAUNCH P6: the sentence the picker shows a launched persona about "direct" (D2, R10) */
export const DIRECT_IS_ONE_WAY_SENTENCE = "Going back to anon after posting directly is weak: your writing style is public now.";

/**
 * D2 — the mode a post by this persona takes when nothing else is said: the explicit choice; else "direct" when it
 * owns its own account; else "anon". null for the read-only public self. THROWS when the account record is unreadable.
 * An explicit mode is returned WITHOUT reading the account record (no I/O beyond the keystore).
 */
export async function effectivePostMode(personaId: string): Promise<PostMode | null> {
  if (isPublicSelf(personaId)) return null;
  if (kindOf(personaId) === "private") return "private"; // a private persona's posts stay with its audience, always
  const explicit = explicitPostMode(personaId);
  if (explicit) return explicit;
  const origin = await accountOriginOf(personaId);
  // PERSONA LAUNCH P6 (D2): a launched persona with no choice made is PRESET anon (and must choose — postModeView)
  if (origin === "layers-launch") return "anon";
  return origin !== null ? "direct" : "anon";
}

export interface AnonPersonaRefusal {
  code: "persona" | "post-mode";
  status: number;
  message: string;
}

/**
 * May this persona post ANONYMOUSLY? Refused, in plain words, when it is not one of this device's own, when it is the
 * read-only public self, when it is a private persona, and when its EXPLICIT post mode is "private" (Totem only).
 * "direct" and the defaults may post through @anon (the composer's toggle is the choice). Runs BEFORE any secret is
 * minted or anything is written (lib/zk/gate.ts requestAnonPost). THROWS only if the keystore is unreadable.
 */
export async function anonPersonaRefusal(personaId: string): Promise<AnonPersonaRefusal | null> {
  if (!isOwnPostingPersona(personaId)) return { code: "persona", status: 403, message: "That isn't one of your personas." };
  const who = "@" + (handleOfPersona(personaId) ?? "this persona");
  if (isPublicSelf(personaId)) return { code: "persona", status: 403, message: PUBLIC_SELF_SENTENCE };
  const kind = kindOf(personaId);
  if (kind === "private") return { code: "persona", status: 403, message: `${who} is a private persona: its posts stay with its audience in Totem.` };
  if (kind !== "public") return { code: "persona", status: 403, message: `Totem couldn't establish that ${who} is a public persona.` };
  if (explicitPostMode(personaId) === "private") return { code: "post-mode", status: 409, message: `${who} is set to post in Totem only. Change it under "Posts from ${who} go" to post through @anon.` };
  return null;
}

export interface PostModeView {
  personaId: string;
  handle: string | null;
  /** the effective mode (null: the read-only public self) */
  mode: PostMode | null;
  /** true when the owner chose it; false when it is the default for the persona's situation */
  explicit: boolean;
  ownAccount: boolean;
  /** the modes this persona may be set to */
  options: PostMode[];
  /** may this device change it at all (its keystore holds the persona, and it is not the public self) */
  settable: boolean;
  /** PERSONA LAUNCH P6: the persona has a LAUNCHED account (origin "layers-launch") */
  launched: boolean;
  /** PERSONA LAUNCH P6 (D2): a launched persona with no choice made — the composer asks before the next post (preset anon) */
  choiceRequired: boolean;
}

/** what the composer's picker and GET /api/personas/post-mode show. THROWS on an unreadable account record. */
export async function postModeView(personaId: string): Promise<PostModeView> {
  const handle = handleOfPersona(personaId);
  if (isPublicSelf(personaId)) return { personaId, handle, mode: null, explicit: false, ownAccount: false, options: [], settable: false, launched: false, choiceRequired: false };
  const origin = await accountOriginOf(personaId);
  const ownAccount = origin !== null;
  const launched = origin === "layers-launch";
  const explicit = explicitPostMode(personaId);
  const isPrivateKind = kindOf(personaId) === "private";
  // PERSONA LAUNCH P6 (D2): a launched persona's default is anon (preset), not direct
  const mode: PostMode = isPrivateKind ? "private" : explicit ?? (ownAccount && !launched ? "direct" : "anon");
  const options: PostMode[] = isPrivateKind ? ["private"] : ownAccount ? ["anon", "private", "direct"] : ["anon", "private"];
  const settable = isOwnPostingPersona(personaId) && getPersona(personaId) !== null;
  return { personaId, handle, mode, explicit: explicit !== null, ownAccount, options, settable, launched, choiceRequired: launched && !isPrivateKind && explicit === null };
}

export type SetPostModeResult = { ok: true; view: PostModeView } | { ok: false; status: number; code: string; error: string };

/**
 * Change a persona's post mode. Validates first (nothing is written on a refusal): the mode is one of the three, the
 * persona is this device's own and in its keystore, it is not the public self, a private persona takes only "private",
 * and "direct" needs the persona's OWN account. Then writes LOUDLY, in order: the keystore record, the root-roster
 * display record, the sealed identity roster (what a recovery restores from). A failure in the second or third is
 * thrown to the caller (the keystore already holds the choice; the same request again finishes the rest).
 */
export async function setPostMode(personaId: string, mode: unknown): Promise<SetPostModeResult> {
  if (!isPostMode(mode)) return { ok: false, status: 400, code: "bad_mode", error: "The post mode must be anon, private or direct." };
  if (!isOwnPostingPersona(personaId)) return { ok: false, status: 403, code: "not_own", error: "That isn't one of your personas." };
  if (isPublicSelf(personaId)) return { ok: false, status: 403, code: "public_self", error: PUBLIC_SELF_SENTENCE };
  const ks = getPersona(personaId);
  const who = "@" + (handleOfPersona(personaId) ?? "this persona");
  if (!ks) return { ok: false, status: 409, code: "not_in_keystore", error: `${who} is a demo persona: its post mode can't be changed on this device.` };
  if (kindOf(personaId) === "private" && mode !== "private") return { ok: false, status: 409, code: "private_persona", error: `${who} is a private persona: its posts stay in Totem.` };
  if (mode === "direct" && !(await ownsAccount(personaId))) {
    return { ok: false, status: 409, code: "no_account", error: `${who} has no Farcaster account of its own yet, so it can't post directly. Launch it first, or post through @anon.` };
  }

  // the roster root is resolved BEFORE anything is written: a device that cannot say where the persona is filed changes nothing
  const { ownRootId, personaRecord, recordPersona, rootOfPersona } = await import("./rootRoster");
  let rootId: string | null;
  if (isEmptyWorld()) rootId = await ownRootId();
  else {
    rootId = await rootOfPersona(personaId);
    if (!rootId) {
      const { getSession } = await import("@/lib/session");
      rootId = (await getSession()).rootId ?? null;
    }
  }
  if (!rootId) throw new Error(`${who} is not filed under a root on this device, so its post mode was not changed`);
  const prior = await personaRecord(personaId);
  if (!updatePersona(personaId, { postMode: mode })) throw new Error(`${who} vanished from this device's keystore — nothing was changed`);
  await recordPersona(rootId, personaId, {
    ...(prior ?? { id: ks.id, name: ks.name, handle: ks.handle, avatarUrl: ks.avatarUrl ?? null, bio: ks.bio ?? null, createdAt: ks.createdAt }),
    postMode: mode,
  });
  const { syncRoster } = await import("./roster");
  await syncRoster(); // LOUD: a lost roster write is a recovery that silently forgets the choice
  return { ok: true, view: await postModeView(personaId) };
}

/**
 * The persona a post defaults to when the request names none: the ACTING persona (the cookie the cast route reads), or,
 * under LAYERS_WORLD=empty, the session's active persona (which is the acting one when that is real, else the first real
 * persona — the persona the composer shows). null when there is none (an empty world with no persona yet).
 */
export async function defaultPostingPersonaId(): Promise<string | null> {
  if (isEmptyWorld()) {
    const { getSession } = await import("@/lib/session");
    return (await getSession()).active?.id ?? null;
  }
  const { activeSeedPersonaId } = await import("@/lib/activePersona");
  return activeSeedPersonaId() || null;
}
