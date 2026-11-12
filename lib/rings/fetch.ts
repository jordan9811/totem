// PERSONA LAUNCH P4 — THE DROP READ (member side; every device, every tick, rings or not).
//
// A plain GET of the public validator's /rings/drop with NO signed headers and no device id: an unauthenticated read by
// design, so the request says nothing about who is reading or whether they hold an address. Its residual is the IP
// (A-RING-DROP-READ-IP): the anonymous channel's OHTTP gateway serves only /zk/anon/head and /zk/anon/submit at a
// constant shape this wave, so the drop read goes direct like the anon cast list.
//
// FULL vs FAILED, exactly as DROP §4c: FULL iff HTTP 200, the body parses, `rows` is an array, EVERY row is
// shape-valid and rows.length === count. Anything else is FAILED — a failed read drops nothing and renders nothing
// new (lib/rings/received.ts keeps the records as "unknown" until a later FULL read).
import { CT_RE, ENC_RE, HINT_RE, ROW_ID_RE } from "./envelope";

export interface DropRow {
  id: string;
  enc: string;
  ct: string;
  hint: string;
  expiresHour: number;
}

export type DropFetch = { full: true; nowHour: number; count: number; rows: DropRow[]; at: number } | { full: false; error: string; at: number };

export function rowShapeOk(r: unknown): r is DropRow {
  const x = r as Partial<DropRow> | null;
  return !!x && typeof x === "object" && ROW_ID_RE.test(String(x.id)) && ENC_RE.test(String(x.enc)) && CT_RE.test(String(x.ct)) && HINT_RE.test(String(x.hint)) && Number.isSafeInteger(x.expiresHour);
}

/** classify an answer (pure: the unit harness feeds it 500s, truncated bodies, count mismatches and bad rows) */
export function classifyDropAnswer(status: number, bodyText: string, at = Date.now()): DropFetch {
  if (status !== 200) return { full: false, error: "the ring drop answered " + status, at };
  let j: { rows?: unknown; count?: unknown; nowHour?: unknown };
  try {
    j = JSON.parse(bodyText);
  } catch {
    return { full: false, error: "the ring drop's answer was not complete", at };
  }
  if (!j || !Array.isArray(j.rows)) return { full: false, error: "the ring drop's answer had no rows list", at };
  if (!Number.isSafeInteger(j.count) || j.rows.length !== j.count) return { full: false, error: `the ring drop said ${String(j.count)} rows and sent ${j.rows.length}`, at };
  for (const r of j.rows) if (!rowShapeOk(r)) return { full: false, error: "a row on the ring drop was malformed", at };
  return { full: true, nowHour: Number(j.nowHour), count: j.count as number, rows: j.rows as DropRow[], at };
}

/** the validator the device talks to (the device env's VALIDATOR_URL; lib/ports on a server) */
async function base(): Promise<string> {
  const { validatorUrl } = await import("@/lib/ports");
  return validatorUrl();
}

/** GET /rings/drop — plain, unsigned, no-store. Never throws: a failure is a FAILED fetch. */
export async function fetchRingDrop(): Promise<DropFetch> {
  const at = Date.now();
  let res: Response;
  try {
    res = await fetch((await base()) + "/rings/drop", { cache: "no-store" });
  } catch (e) {
    return { full: false, error: "the ring drop could not be reached (" + (e as Error).message + ")", at };
  }
  let text = "";
  try {
    text = await res.text();
  } catch (e) {
    return { full: false, error: "the ring drop's answer was cut off (" + (e as Error).message + ")", at };
  }
  return classifyDropAnswer(res.status, text, at);
}
