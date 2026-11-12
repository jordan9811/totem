import "server-only";
// What the composer needs to know about who is acting, resolved on the
// SERVER. The composer is a client component and must never work this out
// for itself — a client that decides its own persona kind can be told to
// decide wrongly.
import { kindOf } from "@/lib/identity/personaKind";
import { audienceOf } from "./visibility";
import { personaById } from "@/lib/adapters/mock/store";
import { adapters } from "@/lib/adapters/registry";
import { retryAdapter } from "@/lib/adapters/retry";

export interface ComposerProps {
  personaKind: "public" | "private" | "unknown";
  audience: { handle: string; name: string }[];
  slots?: string[];
}

export async function composerPropsFor(personaId: string): Promise<ComposerProps> {
  const personaKind = kindOf(personaId);
  const audience =
    personaKind === "private"
      ? audienceOf(personaId).map((m) => ({
          handle: personaById.get(m)?.handle ?? m,
          name: personaById.get(m)?.name ?? m,
        }))
      : [];

  // The mode's composer slots. A failure here must not silently produce an
  // empty toolbar, so an unreadable mode leaves slots undefined, which the
  // component reads as "unrestricted" rather than "show nothing".
  let slots: string[] | undefined;
  try {
    const mode = await retryAdapter(() => adapters.mode.getActive(personaId));
    const configured = mode.actionButtonSlots?.composer;
    if (Array.isArray(configured) && configured.length) slots = configured;
  } catch {
    slots = undefined;
  }

  return { personaKind, audience, slots };
}
