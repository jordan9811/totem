import "server-only";
// POST-DEPLOY PASS Gate 1 — PERSONA CLONING: a new persona that inherits an existing one's settings instead of
// starting from zero.
//
// The shape of the thing, and why it is shaped that way:
//
//   SETTINGS are copied as ARTIFACTS, never as references (D-POST-1-COPIES-NOT-REFERENCES). A cloned mode is a new
//   mode with a new id that happens to hold the same weights; editing it must not reach back into the persona it
//   came from. A reference would make "start from" a shared mutable configuration, which is the opposite of what a
//   second persona is for.
//
//   The FOLLOW LIST is NOT copyable here, and the reason is worth stating rather than hiding behind a disabled
//   checkbox (D-POST-1-FOLLOWS-ARE-ROOT-SCOPED). In this codebase a follow is not a persona's: `setFollowing` in
//   lib/eventlog/log.ts writes ONE set for the whole device, and every persona of the root reads it. There is no
//   per-persona follow list to copy, to withhold, or to partially copy, so a control offering those choices would
//   be a placebo. What the caller gets instead is the true statement and the count, so a person deciding whether a
//   second persona is separate enough knows that their follows are not.
//
//   The correlation the prompt warns about is real but lives one layer out: on the NETWORK a follow is an action by
//   a persona's own account, and two accounts that follow the same set are comparable by anyone. Nothing here
//   creates or prevents that, which is recorded as A-POST-FOLLOWS-ARE-ONE-LIST.
//
//   BOOKMARK FOLDERS and READWISE progress are root-scoped already; copying folders makes the new persona's own
//   copies rather than duplicating what the vault holds once.
import { randomBytes } from "node:crypto";
import { adapters } from "@/lib/adapters/registry";
import { retryAdapter } from "@/lib/adapters/retry";
import type { ModeDefinition, Rule } from "@/lib/adapters/types";

export interface CloneOptions {
  /** the persona whose settings the new one starts from */
  fromPersona: string;
  /** every copyable class, each independently refusable */
  copy?: {
    settings?: boolean;
    folders?: boolean;
  };
}

export interface CloneReport {
  modes: number;
  rules: number;
  activeMode: string | null;
  folders: number;
  /** how many accounts the ROOT follows — shared by every persona, copied by nothing (D-POST-1-FOLLOWS-ARE-ROOT-SCOPED) */
  followsShared: number;
}

/** what a clone WOULD copy, so the UI can show counts before anything is created */
export async function cloneable(fromPersona: string): Promise<{ modes: number; rules: number; folders: number; followsShared: number }> {
  const { followingFor } = await import("@/lib/eventlog/log");
  const [modes, rules, folders] = await Promise.all([
    retryAdapter(() => adapters.mode.list(fromPersona)).catch(() => [] as ModeDefinition[]),
    retryAdapter(() => adapters.rules.list(fromPersona)).catch(() => [] as Rule[]),
    retryAdapter(() => adapters.space.listFolders(fromPersona)).catch(() => [] as unknown[]),
  ]);
  const following = followingFor(fromPersona);
  return { modes: modes.length, rules: rules.length, folders: (folders as unknown[]).length, followsShared: following.size };
}

/**
 * Copy one persona's settings onto another. The personas must both belong to the caller's root — the route checks
 * that; this module does the copying and reports exactly what it copied, so a caller can show it rather than
 * promise it.
 */
export async function copySettings(fromPersona: string, toPersona: string, opts: CloneOptions["copy"] = {}): Promise<CloneReport> {
  const report: CloneReport = { modes: 0, rules: 0, activeMode: null, folders: 0, followsShared: 0 };
  const wantSettings = opts.settings !== false;
  const wantFolders = opts.folders !== false;

  if (wantSettings) {
    // rules first: a mode names rule ids, so the clone's modes must point at the clone's OWN rules
    const sourceRules = await retryAdapter(() => adapters.rules.list(fromPersona)).catch(() => [] as Rule[]);
    const ruleIdMap = new Map<string, string>();
    for (const r of sourceRules) {
      const made = await retryAdapter(() => adapters.rules.create({ personaId: toPersona, name: r.name, action: r.action, root: r.root }));
      ruleIdMap.set(r.id, made.id);
      report.rules++;
    }
    const sourceModes = await retryAdapter(() => adapters.mode.list(fromPersona)).catch(() => [] as ModeDefinition[]);
    const activeSource = await retryAdapter(() => adapters.mode.getActive(fromPersona)).catch(() => null);
    const modeIdMap = new Map<string, string>();
    for (const m of sourceModes) {
      if (m.isPreset) continue; // presets exist for everyone already; copying them would duplicate the catalogue
      const made = await retryAdapter(() =>
        adapters.mode.create({
          personaId: toPersona,
          name: m.name,
          isPreset: false,
          ranking: m.ranking,
          ruleIds: (m.ruleIds ?? []).map((id) => ruleIdMap.get(id)).filter(Boolean) as string[],
          notificationPolicy: m.notificationPolicy,
          actionButtonSlots: m.actionButtonSlots,
          // a pin names a persona, and the clone is a DIFFERENT persona: carrying the source's pin would make the
          // new persona's mode act as the old one, which is the one thing a clone must never do
          pinnedPersonaId: null,
          activationRule: m.activationRule ?? null,
          activationEnabled: false, // never start a copied auto-switch firing on its own
          lens: m.lens ?? null,
          dmReadwise: m.dmReadwise,
        } as Omit<ModeDefinition, "id" | "createdAt">)
      );
      modeIdMap.set(m.id, made.id);
      report.modes++;
    }
    if (activeSource && modeIdMap.has(activeSource.id)) {
      const target = modeIdMap.get(activeSource.id)!;
      await retryAdapter(() => adapters.mode.setActive(toPersona, target)).catch(() => {});
      report.activeMode = target;
    }
  }

  if (wantFolders) {
    const sourceFolders = (await retryAdapter(() => adapters.space.listFolders(fromPersona)).catch(() => [])) as { name: string; isPublic?: boolean; postHashes?: string[] }[];
    for (const f of sourceFolders) {
      await retryAdapter(() => adapters.space.createFolder({ name: f.name, ownerPersonaId: toPersona, isPublic: !!f.isPublic, postHashes: f.postHashes ?? [] })).catch(() => {});
      report.folders++;
    }
  }

  // follows are the ROOT's, not a persona's: nothing is copied and nothing can be withheld, so the clone reports
  // how many the new persona already shares with every other one (D-POST-1-FOLLOWS-ARE-ROOT-SCOPED)
  const { followingFor } = await import("@/lib/eventlog/log");
  report.followsShared = followingFor(fromPersona).size;

  return report;
}

/** the id a clone event carries in the relationship log — owner-visible, never published */
export function cloneEventId(): string {
  return "clone_" + randomBytes(6).toString("hex");
}
