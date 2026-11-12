import "server-only";
// POST-DEPLOY Gate 2 — PERSONA CHROME: the per-persona accent tint, and the
// scope of every surface that shows more than one persona at a time.
//
// Both live in ONE opaque padded sealed vault record (`personaChrome`,
// key "_"), for the same reason the modes namespace is sealed whole: a
// per-persona map keyed by persona id would hand the operator this root's
// sibling set in the ADDRESSES even with every value encrypted.
//
// A tint is never published. It is not part of a persona's profile, it is
// not sent to the validator in the clear, and nothing a viewer of your
// persona can see depends on it — it is a cue for the person holding the
// device, so they know which persona they are about to speak as.
//
// THE COLOUR IS NEVER THE ONLY CUE. Every surface that carries the wash
// also carries the persona pill (the handle, in text). The tint makes the
// distinction fast; the pill makes it correct.
import { decryptNamespace, encryptNamespace } from "@/lib/vault/vault";
import { flushVault, fetchState } from "@/lib/adapters/mock/persist";
import { MIN_SEPARATION, separation } from "./colorVision";

export const VAULT_NS = "personaChrome";

/**
 * Eight accents, CHOSEN BY MEASUREMENT rather than by taste.
 *
 * The first version of this palette was picked by eye with a comment claiming
 * the entries were far enough apart; the Gate 2 suite simulated them and found
 * the product blue and a violet collapsing to a CIE76 dE of 4.3 under
 * protanopia — a coin flip, in the exact place a wrong guess means posting as
 * the wrong persona. These eight hold a minimum pairwise dE of ~15 across
 * normal vision, deuteranopia, protanopia AND tritanopia, which is why they
 * span lightness so widely (L* 8 to 77): the red-green axis is the axis that
 * collapses, so lightness is what is left to carry the difference.
 *
 * They are defaults, not a taxonomy: any of them can be overridden per persona.
 * The suite asserts the whole palette, not just the pair currently assigned, so
 * an owner who picks two by hand cannot land on a pair that was never checked.
 */
export const TINT_PALETTE: readonly string[] = [
  "#1d9bf0", // blue
  "#f4a524", // amber
  "#0f5c3a", // pine
  "#e879c7", // pink
  "#111827", // ink
  "#c4b5fd", // lavender
  "#7f1d1d", // maroon
  "#536471", // slate
];

export interface ChromeDoc {
  /** personaId → "#rrggbb", only for personas whose owner CHOSE one */
  tints: Record<string, string>;
  /** the cross-persona view. Default OFF, deliberately. */
  unified: boolean;
  /** the hard scope. Strictly stronger than unified:false — it suppresses every
   *  cross-persona surface, and forces unified off while it is on. */
  compartment: boolean;
  loaded: boolean;
}

const EMPTY: ChromeDoc = { tints: {}, unified: false, compartment: false, loaded: false };
const g = globalThis as unknown as { __layersPersonaChrome?: ChromeDoc };

const HEX = /^#[0-9a-f]{6}$/i;

async function load(): Promise<ChromeDoc> {
  if (g.__layersPersonaChrome) return g.__layersPersonaChrome;
  let doc: ChromeDoc = { ...EMPTY, tints: {} };
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetchState(VAULT_NS);
      if (res.status === 404) {
        doc.loaded = true;
        break;
      }
      if (!res.ok) throw new Error("validator answered " + res.status);
      const { entries } = (await res.json()) as { entries?: Record<string, unknown> };
      if (entries && Object.keys(entries).length) {
        const plain = decryptNamespace(VAULT_NS, entries);
        const rec = plain["_"] as { m?: Partial<ChromeDoc> } | undefined;
        // GATE 5 (attack-post-3 F-1): decryptNamespace DROPS a record that is not
        // ciphertext-shaped or will not decrypt, so a deleted, truncated or plaintext "_"
        // came back as an EMPTY document with loaded=true — compartment mode silently off,
        // every chosen tint gone — and the next write sealed that emptiness over the real
        // record, permanently. A namespace that holds records but yields no readable "_" is
        // a corrupted vault, and it is refused in the same voice as an unreachable one.
        if (!rec)
          throw new Error(
            "vault: personaChrome holds " + Object.keys(entries).length + " record(s), none readable by this device — refusing rather than treating a corrupted namespace as an empty one"
          );
        const m = rec?.m ?? {};
        doc = {
          tints: m.tints && typeof m.tints === "object" ? (m.tints as Record<string, string>) : {},
          unified: m.unified === true,
          compartment: m.compartment === true,
          loaded: true,
        };
      } else {
        // GATE 5 (attack-post-3 F-1, path 1): an EMPTY namespace is only benign if it was
        // never written. The validator answers a missing namespace with 200 {entries:{}},
        // not 404, so "the operator deleted these rows" and "this device has never sealed
        // this" are the same response — and reading the first as the second turns compartment
        // mode off silently and then seals that emptiness over the real record. The device
        // keeps its own note of which namespaces it has sealed (lib/vault/sealedPins.ts), and
        // an empty read for one of them is a refusal, not a fresh start.
        const { wasEverSealed } = await import("@/lib/vault/sealedPins");
        if (wasEverSealed(VAULT_NS))
          throw new Error(
            "vault: personaChrome is EMPTY on the validator but this device has sealed it before — refusing rather than treating a deleted namespace as a fresh one"
          );
        doc.loaded = true;
      }
      lastErr = null;
      break;
    } catch (e) {
      lastErr = e;
      if (String((e as Error).message).includes("vault")) break;
      await new Promise((r) => setTimeout(r, 200 * (attempt + 1)));
    }
  }
  // Never fail open: an unreadable chrome record must not read as "no tints,
  // unified off, compartment off" — the last of those three is a PROTECTION,
  // and a protection that evaporates when the validator hiccups is not one.
  if (!doc.loaded)
    throw new Error(
      "persona chrome unavailable (" +
        ((lastErr as Error)?.message ?? "validator unreachable") +
        ") — refusing rather than treating the vault as empty"
    );
  g.__layersPersonaChrome = doc;
  return doc;
}

/**
 * Seal a NEW document. The caller must not have mutated the cached one.
 *
 * GATE 5 (attack-post-3 F-5, and the verifier's re-finding inside the first fix): the cache is
 * adopted only once the flush SUCCEEDS, so a failed write leaves no ghost — no compartment
 * flag this process believes in and the vault has never heard of. The first version of that
 * fix captured `previous = g.__layersPersonaChrome` and the mutators then did
 * `doc.field = x; save(doc)` on that very object, so `previous` and `doc` were the same
 * reference and the rollback restored the mutation. Every mutator below now builds a new
 * document; this function is the only place the cache is written.
 */
async function save(doc: ChromeDoc): Promise<void> {
  if (!doc.loaded) throw new Error("persona chrome was never loaded from the validator — refusing to seal over it");
  const previous = g.__layersPersonaChrome;
  if (previous === doc) throw new Error("internal: save() was handed the cached document — build a new one, or a failed flush cannot be rolled back");
  const m = { tints: doc.tints, unified: doc.unified, compartment: doc.compartment };
  const inner = JSON.stringify(m);
  const target = 1024 * Math.ceil((inner.length + 64) / 1024);
  const sealed = encryptNamespace(VAULT_NS, { _: { m, pad: " ".repeat(Math.max(0, target - inner.length - 48)) } });
  try {
    await flushVault(VAULT_NS, sealed);
  } catch (e) {
    g.__layersPersonaChrome = previous;
    throw e;
  }
  const { markEverSealed } = await import("@/lib/vault/sealedPins");
  markEverSealed(VAULT_NS);
  g.__layersPersonaChrome = doc;
}

export function resetChromeCache(): void {
  g.__layersPersonaChrome = undefined;
}

// ------------------------------------------------------------------- tints

export interface Tint {
  personaId: string;
  color: string;
  /** "chosen" — the owner picked it; "auto" — a distinct default, assigned by position */
  source: "chosen" | "auto";
}

/**
 * The tint of every persona in `personaIds`, in one pass.
 *
 * "Auto-assigned distinct defaults" is done HERE rather than at creation so
 * that a persona minted before this gate, or by a path that never touched the
 * chrome record, still gets a colour no sibling is already using. The walk is
 * deterministic (roster order, palette order, skipping what is already taken),
 * so the same roster always yields the same assignment — a tint that moved
 * between renders would be worse than no tint at all.
 */
export async function tintsFor(personaIds: string[]): Promise<Record<string, Tint>> {
  const doc = await load();
  const out: Record<string, Tint> = {};
  const taken = new Set<string>();
  for (const id of personaIds) {
    const chosen = doc.tints[id];
    if (chosen && HEX.test(chosen)) {
      out[id] = { personaId: id, color: chosen.toLowerCase(), source: "chosen" };
      taken.add(chosen.toLowerCase());
    }
  }
  let cursor = 0;
  // GATE 5 (attack-post-3 F-7): "taken" is a PERCEPTUAL test, not a string test. The first
  // version skipped a palette entry only when a sibling held that exact hex, while setTint
  // refused a hand-picked colour by distance — so choosing #f4a525 left a sibling sitting on
  // #f4a524, two colours no eye separates, and the auto-assignment walked straight past the
  // collision because the strings differed.
  const collides = (candidate: string) => [...taken].some((t) => separation(candidate, t).distance < MIN_SEPARATION);
  for (const id of personaIds) {
    if (out[id]) continue;
    let color = TINT_PALETTE[cursor % TINT_PALETTE.length];
    // step past anything a sibling already holds; after a full lap the palette
    // is exhausted and a repeat is honest — the pill is still the real signal
    for (let n = 0; n < TINT_PALETTE.length && collides(color); n++) {
      cursor++;
      color = TINT_PALETTE[cursor % TINT_PALETTE.length];
    }
    taken.add(color);
    cursor++;
    out[id] = { personaId: id, color, source: "auto" };
  }
  return out;
}

export type SetTintResult =
  | { ok: true; tint: Tint }
  | { ok: false; code: "malformed" | "not_own" | "collides"; reason: string };

export async function setTint(personaId: string, color: string, ownIds: string[]): Promise<SetTintResult> {
  if (typeof color !== "string" || !HEX.test(color))
    return { ok: false, code: "malformed", reason: "a tint is a #rrggbb hex colour" };
  if (!ownIds.includes(personaId))
    return { ok: false, code: "not_own", reason: "not one of your personas — a tint is set by its owner" };
  // A COLOUR THAT COLLIDES WITH A SIBLING'S IS REFUSED, and the refusal names the
  // sibling and the vision model it collapses under. The palette is safe by
  // measurement, but the field accepts any hex, and a free-text colour that
  // happens to land on a sibling's accent under protanopia would quietly undo the
  // whole cue. Refusing is not paternalism here: the setting would be defeating
  // its own purpose, and the message says exactly how.
  const current = await tintsFor(ownIds);
  for (const id of ownIds) {
    if (id === personaId) continue;
    const other = current[id];
    if (!other) continue;
    const sep = separation(color, other.color);
    if (sep.distance < MIN_SEPARATION)
      return {
        ok: false,
        code: "collides",
        reason:
          "that colour is indistinguishable from another persona's under " +
          sep.model +
          " (distance " +
          sep.distance.toFixed(1) +
          ", the cue needs " +
          MIN_SEPARATION +
          ") — pick another, or change that persona's first",
      };
  }
  const doc = await load();
  await save({ ...doc, tints: { ...doc.tints, [personaId]: color.toLowerCase() } });
  return { ok: true, tint: { personaId, color: color.toLowerCase(), source: "chosen" } };
}

/** Clear a chosen tint; the persona falls back to its distinct auto default. */
export async function clearTint(personaId: string): Promise<void> {
  const doc = await load();
  if (!(personaId in doc.tints)) return;
  const next = { ...doc.tints };
  delete next[personaId];
  await save({ ...doc, tints: next });
}

/** The subtle wash the chrome carries — the accent at low alpha, never the accent itself. */
export function washOf(color: string, alpha = 0.08): string {
  const c = HEX.test(color) ? color : TINT_PALETTE[0];
  const r = parseInt(c.slice(1, 3), 16);
  const gg = parseInt(c.slice(3, 5), 16);
  const b = parseInt(c.slice(5, 7), 16);
  return "rgba(" + r + ", " + gg + ", " + b + ", " + alpha + ")";
}

/**
 * The MODE signal, layered on top without colliding with the persona signal:
 * persona is a colour, mode is a border TREATMENT. A treatment survives
 * colourblindness and greyscale on its own, and two cues in different
 * channels can be read at once.
 */
export const MODE_EDGES = ["solid", "dashed", "dotted", "double"] as const;
export type ModeEdge = (typeof MODE_EDGES)[number];

export function modeEdgeOf(modeId: string | null | undefined): ModeEdge {
  if (!modeId) return "solid";
  let h = 0;
  for (let i = 0; i < modeId.length; i++) h = (h * 31 + modeId.charCodeAt(i)) >>> 0;
  return MODE_EDGES[h % MODE_EDGES.length];
}

// ------------------------------------------------------------------- scope

export interface ViewScope {
  /** the cross-persona view is ON (and compartment mode is not overriding it) */
  unified: boolean;
  /** the toggle's own stored value, before compartment mode overrides it */
  unifiedRequested: boolean;
  compartment: boolean;
  activePersonaId: string;
  /** the personas a cross-persona SURFACE may enumerate */
  visiblePersonaIds: string[];
  /** why the scope is what it is, for the UI to say out loud */
  reason: "compartment" | "unified" | "single";
}

/**
 * THE CHOKEPOINT. Every surface that shows more than the active persona asks
 * this, and it is asserted at the data layer (the API answers), not at the
 * DOM — a suppression that only hides an element is a suppression a screen
 * reader, a view-source, and a stale cache all defeat.
 */
export async function viewScope(activePersonaId: string, ownIds: string[]): Promise<ViewScope> {
  const doc = await load();
  const compartment = doc.compartment;
  const unified = doc.unified && !compartment;
  return {
    unified,
    unifiedRequested: doc.unified,
    compartment,
    activePersonaId,
    visiblePersonaIds: compartment ? [activePersonaId] : ownIds,
    reason: compartment ? "compartment" : unified ? "unified" : "single",
  };
}

/**
 * THE LIST A CROSS-PERSONA SURFACE MAY ENUMERATE.
 *
 * GATE 5 (attack-post-1 F-1/F-3, and its structural note): six of that review's
 * findings were one finding — `viewScope()` was well built and calling it was
 * OPTIONAL, so every surface that forgot leaked the sibling set. This is the
 * version a route reaches for instead of `ownPersonaIdsAll()`: it resolves the
 * acting persona and the scope itself, and under compartment mode it returns the
 * active persona alone. A route that wants the UNSCOPED set now has to say so.
 *
 * It does NOT fail open: if the chrome record cannot be read, `viewScope` throws
 * and the caller answers 503, because a compartment that evaporates on a
 * validator hiccup is not a compartment.
 */
export async function visibleOwnPersonaIds(): Promise<string[]> {
  const { ownPersonaIdsAll } = await import("@/lib/influence/allowance");
  const { activeSeedPersonaId } = await import("@/lib/activePersona");
  const all = await ownPersonaIdsAll();
  const active = activeSeedPersonaId();
  const sc = await viewScope(active, all.includes(active) ? all : [...all, active]);
  return sc.visiblePersonaIds;
}

export async function setUnified(on: boolean): Promise<ChromeDoc> {
  const doc = await load();
  if (doc.compartment && on)
    throw new Error("compartment mode is on — leave it before turning the cross-persona view back on");
  const next: ChromeDoc = { ...doc, unified: !!on };
  await save(next);
  return next;
}

/** One tap. Entering forces the cross-persona view off; leaving does NOT turn it back on. */
export async function setCompartment(on: boolean): Promise<ChromeDoc> {
  const doc = await load();
  const next: ChromeDoc = { ...doc, compartment: !!on, unified: on ? false : doc.unified };
  await save(next);
  return next;
}
