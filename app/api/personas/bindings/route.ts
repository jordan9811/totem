import { NextRequest, NextResponse } from "next/server";
// THE PERSONA × MODE MATRIX — programmable bindings, both directions,
// neither forced. A persona MAY pin a default mode; a mode MAY pin a
// persona; a mode MAY carry a time-based activation rule, off by default
// even when configured. All three are read and written here as one
// settings surface, since that's how the prompt frames the UI ("Settings
// matrix") and how a user actually reasons about them — together.
import { SEED_VIEWER, personaById, state } from "@/lib/adapters/mock/store";
import { adapters } from "@/lib/adapters/registry";
import { retryAdapter } from "@/lib/adapters/retry";
import { validateRuleGroup } from "@/lib/rules/evaluate";
import type { RuleGroup } from "@/lib/adapters/types";

export const dynamic = "force-dynamic";

// route.ts may only export HTTP handlers + a small Next.js allowlist —
// this stays a local constant, not a named export.
const DEFAULT_UNDO_DEPTH = 3;

export async function GET() {
  // GATE 5 (attack-post-1 F-3): the bindings matrix lists every persona AND every mode each
  // one holds — a reading-habit fingerprint per sibling, on one screen.
  const { visibleOwnPersonaIds } = await import("@/lib/identity/chrome");
  const visibleIds = new Set(await visibleOwnPersonaIds());
  const enumerable = SEED_VIEWER.personas.filter((id) => visibleIds.has(id));
  const personas = enumerable.map((id) => {
    const p = personaById.get(id);
    return {
      id,
      handle: p?.handle ?? id,
      name: p?.name ?? id,
      defaultModeId: state().personaDefaultMode.get(id) ?? null,
      // UX Gate 2: the undo stack's configured depth. The stack ITSELF is
      // ephemeral client-side state (sessionStorage); this number is the
      // one real, persisted setting.
      timelineUndoDepth: state().timelineUndoDepth.get(id) ?? DEFAULT_UNDO_DEPTH,
    };
  });

  const modes = [];
  for (const personaId of enumerable) {
    const owned = await retryAdapter(() => adapters.mode.list(personaId));
    for (const m of owned) {
      // a simple single-clause "after hour N UTC" rule renders back as that
      // number for the UI's plain input; anything more complex than that
      // shape still stores/evaluates fine, it just shows as "custom rule"
      let afterHourUTC: number | null = null;
      const clauses = m.activationRule?.clauses;
      if (clauses?.length === 1 && !("combinator" in clauses[0])) {
        const c = clauses[0] as { field: string; op: string; value: unknown };
        if (c.field === "clock.hourUTC" && c.op === "gte" && typeof c.value === "number") {
          afterHourUTC = c.value;
        }
      }
      modes.push({
        id: m.id,
        name: m.name,
        ownerPersonaId: personaId,
        pinnedPersonaId: m.pinnedPersonaId ?? null,
        activationEnabled: !!m.activationEnabled,
        activationRule: m.activationRule ?? null,
        afterHourUTC,
      });
    }
  }

  // GATE 5 (attack-post-1 F-3d): `personas` narrowed and `modes[].pinnedPersonaId` did not, so
  // a mode of the ACTIVE persona pinned to a hidden sibling handed that sibling's id back on
  // the very surface compartment mode was narrowing. The UI does not need the raw value — the
  // matrix feeds it to a select whose options are already the narrowed list — so an
  // out-of-scope pin is reported as a flag instead of an id.
  const scoped = modes.map((m) =>
    m.pinnedPersonaId && !visibleIds.has(m.pinnedPersonaId)
      ? { ...m, pinnedPersonaId: null, pinnedElsewhere: true }
      : m
  );
  return NextResponse.json({ personas, modes: scoped });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  try {
    if (body.action === "setDefaultMode") {
      const personaId = String(body.personaId ?? "");
      if (!SEED_VIEWER.personas.includes(personaId))
        return NextResponse.json({ error: "not one of your personas" }, { status: 403 });
      const modeId = body.modeId ? String(body.modeId) : null;
      if (modeId) {
        const mode = await retryAdapter(() => adapters.mode.get(modeId));
        if (!mode || mode.personaId !== personaId)
          return NextResponse.json({ error: "mode does not belong to that persona" }, { status: 400 });
        state().personaDefaultMode.set(personaId, modeId);
      } else {
        state().personaDefaultMode.delete(personaId);
      }
      const { persistNs } = await import("@/lib/adapters/mock/store");
      await persistNs("personaDefaultMode");
      return NextResponse.json({ ok: true });
    }

    if (body.action === "setPin") {
      const modeId = String(body.modeId ?? "");
      const mode = await retryAdapter(() => adapters.mode.get(modeId));
      if (!mode || !SEED_VIEWER.personas.includes(mode.personaId))
        return NextResponse.json({ error: "not one of your modes" }, { status: 403 });
      const target = body.personaId ? String(body.personaId) : null;
      if (target && !SEED_VIEWER.personas.includes(target))
        return NextResponse.json({ error: "can only pin one of your own personas" }, { status: 403 });
      const updated = await retryAdapter(() => adapters.mode.update(modeId, { pinnedPersonaId: target }));
      return NextResponse.json({ mode: updated });
    }

    if (body.action === "setActivation") {
      const modeId = String(body.modeId ?? "");
      const mode = await retryAdapter(() => adapters.mode.get(modeId));
      if (!mode || !SEED_VIEWER.personas.includes(mode.personaId))
        return NextResponse.json({ error: "not one of your modes" }, { status: 403 });
      const enabled = !!body.enabled;
      const hour = body.afterHourUTC === null || body.afterHourUTC === undefined ? null : Number(body.afterHourUTC);
      let rule: RuleGroup | null = null;
      if (hour !== null) {
        if (!Number.isInteger(hour) || hour < 0 || hour > 23)
          return NextResponse.json({ error: "afterHourUTC must be 0-23" }, { status: 400 });
        rule = { combinator: "AND", clauses: [{ field: "clock.hourUTC", op: "gte", value: hour }] };
        const violations = validateRuleGroup(rule);
        if (violations.length)
          return NextResponse.json({ error: "activation rule refused", violations }, { status: 422 });
      }
      // enabled with no rule is a no-op switch — off by default means
      // there is nothing TO enable until a rule exists
      const updated = await retryAdapter(() =>
        adapters.mode.update(modeId, {
          activationRule: rule,
          activationEnabled: enabled && !!rule,
        })
      );
      return NextResponse.json({ mode: updated });
    }

    if (body.action === "setUndoDepth") {
      const personaId = String(body.personaId ?? "");
      if (!SEED_VIEWER.personas.includes(personaId))
        return NextResponse.json({ error: "not one of your personas" }, { status: 403 });
      const depth = Number(body.depth);
      if (!Number.isInteger(depth) || depth < 1 || depth > 10)
        return NextResponse.json({ error: "depth must be 1-10" }, { status: 400 });
      state().timelineUndoDepth.set(personaId, depth);
      const { persistNs } = await import("@/lib/adapters/mock/store");
      await persistNs("timelineUndoDepth");
      return NextResponse.json({ timelineUndoDepth: depth });
    }

    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 503 });
  }
}
