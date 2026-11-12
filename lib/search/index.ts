// MEGA PASS 2 Gate 4 — THE LOCAL FULL-TEXT INDEX. Pure, dependency-free
// BM25 over an inverted index: tokenize, stem lightly, score. It lives in
// the process that holds the decrypted vault and NOWHERE else — nothing in
// this file touches the network, and the validator never receives a query
// over private data or a private index (the Gate 4 suite greps the
// validator for any such endpoint and asserts the DB never carries a query).
//
// "e.g. a WASM FTS engine" in the prompt: this is the honest equivalent
// without a new dependency — an inverted index and BM25 in ~120 lines,
// rebuilt from the vault on demand (so it survives a restart by being
// re-derived, and is never stored plaintext anywhere).

export type RecordType = "cast" | "privatePost" | "dm" | "like" | "bookmark" | "stake" | "relationship" | "import";

export interface SearchRecord {
  id: string;
  type: RecordType;
  /** the persona this record belongs to (always one of THIS device's — single-root by construction) */
  personaId: string;
  /** POST-DEPLOY Gate 2: that persona's handle, so a cross-persona result can say
   *  "bookmarked as @fluffypanda69" — the mental accounting only works with the
   *  ACTING persona named, not the authored-by one the title carries. */
  asHandle: string;
  /** rendered with private chrome when true */
  private: boolean;
  title: string;
  text: string;
  at: number;
  href?: string;
}

export interface Hit {
  record: SearchRecord;
  score: number;
  /** which terms matched — legibility, no black box */
  terms: string[];
}

const STOP = new Set(["the", "a", "an", "and", "or", "of", "to", "in", "on", "at", "is", "it", "for", "with", "as", "by", "be", "this", "that", "i", "we", "you", "was", "are", "from", "but", "not", "so", "if", "my", "our"]);

/** light stemming: plurals and common suffixes — enough for a seed corpus, never a claim of linguistics */
export function stem(w: string): string {
  let s = w;
  if (s.length > 4 && s.endsWith("ies")) s = s.slice(0, -3) + "y";
  else if (s.length > 3 && s.endsWith("es") && !s.endsWith("ses")) s = s.slice(0, -2);
  else if (s.length > 3 && s.endsWith("s") && !s.endsWith("ss")) s = s.slice(0, -1);
  if (s.length > 5 && s.endsWith("ing")) s = s.slice(0, -3);
  else if (s.length > 4 && s.endsWith("ed")) s = s.slice(0, -2);
  return s;
}

export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9][a-z0-9'-]*/g) ?? []).map((w) => w.replace(/'s$/, "")).filter((w) => w.length > 1 && !STOP.has(w)).map(stem);
}

interface Posting {
  docIndex: number;
  tf: number;
}

export class FullTextIndex {
  private docs: SearchRecord[] = [];
  private lengths: number[] = [];
  private postings = new Map<string, Posting[]>();
  private avgLen = 0;

  constructor(records: SearchRecord[] = []) {
    for (const r of records) this.add(r);
  }

  get size(): number {
    return this.docs.length;
  }

  add(record: SearchRecord): void {
    const tokens = tokenize(record.title + " " + record.text);
    const i = this.docs.length;
    this.docs.push(record);
    this.lengths.push(tokens.length);
    const counts = new Map<string, number>();
    for (const t of tokens) counts.set(t, (counts.get(t) ?? 0) + 1);
    for (const [t, tf] of counts) {
      const list = this.postings.get(t) ?? [];
      list.push({ docIndex: i, tf });
      this.postings.set(t, list);
    }
    this.avgLen = this.lengths.reduce((a, b) => a + b, 0) / this.lengths.length;
  }

  /** BM25 (k1 = 1.2, b = 0.75) over the query's terms; a record must match at least one term */
  search(query: string, limit = 50): Hit[] {
    const terms = [...new Set(tokenize(query))];
    if (!terms.length || !this.docs.length) return [];
    const N = this.docs.length;
    const k1 = 1.2;
    const b = 0.75;
    const scores = new Map<number, { score: number; terms: Set<string> }>();
    for (const t of terms) {
      const list = this.postings.get(t);
      if (!list) continue;
      const idf = Math.log(1 + (N - list.length + 0.5) / (list.length + 0.5));
      for (const p of list) {
        const len = this.lengths[p.docIndex];
        const tfn = (p.tf * (k1 + 1)) / (p.tf + k1 * (1 - b + (b * len) / (this.avgLen || 1)));
        const cur = scores.get(p.docIndex) ?? { score: 0, terms: new Set<string>() };
        cur.score += idf * tfn;
        cur.terms.add(t);
        scores.set(p.docIndex, cur);
      }
    }
    return [...scores.entries()]
      .map(([i, s]) => ({ record: this.docs[i], score: s.score, terms: [...s.terms] }))
      .sort((a, b2) => b2.score - a.score || b2.record.at - a.record.at)
      .slice(0, limit);
  }

  records(): SearchRecord[] {
    return [...this.docs];
  }
}
