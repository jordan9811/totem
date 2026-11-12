import "server-only";
// PERSONA LAUNCH P1 (SIWF), PLAN DELTA (research/plan-persona-launch-2026-10-10.md §4 P1): THE ROOT HEADSHOT.
//
// The persona launch model shows ring members a half-and-half avatar on linked anon posts: the ROOT's face on the
// left, the persona's picture on the right (P4). The root's face is its public self — the Farcaster account the
// visitor signed in with (the public site) or connected (the owner service). This is the ONE accessor P4's avatar may
// read; nothing else may reach into accountLinks or the connected record for a face.
//
// Rules:
//   - device-local: computed from sealed records on this device, never written anywhere in plaintext, never sent;
//   - a disconnected main (a tombstone) has no headshot: null;
//   - NEVER FAIL OPEN: a record that cannot be read THROWS — "no headshot" would draw the persona-only avatar as if
//     the root had no face, and a caller that seals or publishes on that answer would make it permanent;
//   - where: the browser device reads accountLinks (lib/fc/siwf/links.ts mainLink); a server reads the owner
//     service's connected publicSelf record (lib/fc/personaFid.ts connectedRecords), and, on the rig only, the
//     fixture sign-in's accountLinks when no connected record exists.
export interface RootHeadshot {
  source: "farcaster";
  fname: string;
  displayName: string | null;
  pfpUrl: string | null;
}

export async function rootHeadshot(): Promise<RootHeadshot | null> {
  if (typeof window === "undefined") {
    const { connectedRecords } = await import("@/lib/fc/personaFid");
    const records = await connectedRecords(); // THROWS on an unreadable vault
    const main = records.find((r) => r.connected?.publicSelf === true) ?? null;
    if (main) {
      if (main.connected?.disconnectedAt) return null;
      let displayName: string | null = null;
      let pfpUrl: string | null = null;
      try {
        const { getPersona } = await import("@/lib/identity/keystore");
        const p = getPersona(main.personaId);
        displayName = p?.name ?? null;
        pfpUrl = p?.avatarUrl ?? null;
      } catch {
        // the record is the fact; the keystore persona only decorates it
      }
      return { source: "farcaster", fname: main.fname ?? "fid " + main.fid, displayName, pfpUrl };
    }
    const { siwfGate } = await import("@/lib/fc/siwf/flow");
    if (!siwfGate().ok) return null; // no sign-in can exist in this process (owner service without a connection)
  }
  const { mainLink } = await import("@/lib/fc/siwf/links");
  const link = await mainLink(); // THROWS on an unreadable namespace: never null-as-empty
  if (!link || link.disconnectedAt !== null) return null;
  return { source: "farcaster", fname: link.fname ?? "fid " + link.fid, displayName: link.displayName, pfpUrl: link.pfpUrl };
}
