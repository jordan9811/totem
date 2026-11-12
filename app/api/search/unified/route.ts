import { NextRequest, NextResponse } from "next/server";
// MEGA PASS 2 Gate 4 — UNIFIED SEARCH (vault-local, keyword + AI).
// GET ?q=&mode=keyword|semantic|cloud[&consent=<json>]   one box over everything this root touched
// GET ?browse=1[&limit=]                                 the cross-persona VIEW: no query, newest first, same scope
// GET ?status=1                                          the local model's availability, the index's size/types
// POST {action:"semanticUnavailable", on}  (dev hooks)   force the "device cannot run the model" path
// POST {action:"cloudSends"}               (dev hooks)   what the cloud path was handed — nothing without consent
// The validator is never asked anything here: the index lives in this process, rebuilt from the vault.
import { activeSeedPersonaId } from "@/lib/activePersona";
import { browseAll, cloudSends, ensureIndex, resetCloudSends, resetUnifiedIndex, semanticStatus, unifiedSearch, type Consent, type SearchMode } from "@/lib/search/unified";

export const dynamic = "force-dynamic";

const isDev = () => process.env.ZK_DEV_HOOKS === "true";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  try {
    if (q.get("status")) {
      // POST-DEPLOY Gate 2: status answers UNDER THE SCOPE too — `indexed` and
      // `personas` here are the compartment-mode numbers when compartment mode
      // is on, so the assertion that the cross-persona surface is suppressed can
      // be made against the data, not against a hidden DOM node.
      const { cache, personas, scope } = await ensureIndex();
      return NextResponse.json({ semantic: semanticStatus(), indexed: cache.records.length, types: [...new Set(cache.records.map((r) => r.type))], personas, rebuiltAt: cache.builtAt, viewer: activeSeedPersonaId(), scope });
    }
    if (q.get("browse")) {
      // the cross-persona VIEW: no query, everything the scope can see, newest first
      const lim = Math.min(200, Math.max(1, Number(q.get("limit") ?? 60) || 60));
      return NextResponse.json(await browseAll(lim));
    }
    const text = (q.get("q") ?? "").trim();
    if (!text) return NextResponse.json({ error: "q required" }, { status: 400 });
    if (text.length > 200) return NextResponse.json({ error: "query too long" }, { status: 400 });
    const modeRaw = q.get("mode") ?? "keyword";
    if (!["keyword", "semantic", "cloud"].includes(modeRaw)) return NextResponse.json({ error: "mode unknown" }, { status: 400 });
    let consent: Consent | null = null;
    if (q.get("consent")) {
      try {
        const c = JSON.parse(q.get("consent") as string) as Partial<Consent>;
        if (typeof c.provider !== "string" || !Number.isInteger(c.snippets) || typeof c.queryHash !== "string") return NextResponse.json({ error: "consent malformed" }, { status: 400 });
        consent = { provider: c.provider, snippets: c.snippets as number, queryHash: c.queryHash };
      } catch {
        return NextResponse.json({ error: "consent malformed" }, { status: 400 });
      }
    }
    const result = await unifiedSearch(text, modeRaw as SearchMode, consent);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 503 });
  }
}

export async function POST(req: NextRequest) {
  if (!isDev()) return NextResponse.json({ error: "dev hooks disabled" }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (body.action === "semanticUnavailable") {
    const { setSemanticUnavailableOverride } = await import("@/lib/search/embedWorker");
    setSemanticUnavailableOverride(!!body.on);
    return NextResponse.json({ ok: true, semantic: semanticStatus() });
  }
  if (body.action === "cloudSends") return NextResponse.json({ sends: cloudSends() });
  if (body.action === "resetCloudSends") {
    resetCloudSends();
    return NextResponse.json({ ok: true });
  }
  if (body.action === "dropIndex") {
    resetUnifiedIndex();
    return NextResponse.json({ ok: true });
  }
  if (body.action === "embedBothWays") {
    // the rig pins the worker's duplicate to the in-process embedding
    const { embed } = await import("@/lib/search/embed");
    const { embedInWorker } = await import("@/lib/search/embedWorker");
    const text = String(body.text ?? "");
    const a = Array.from(embed(text));
    const [b] = await embedInWorker([text]);
    return NextResponse.json({ inProcess: a, worker: Array.from(b) });
  }
  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
