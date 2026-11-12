// MEGA PASS 2 Gate 4 — THE LOCAL EMBEDDING. Pure and dependency-free.
//
// HONEST SCOPE, stated once: this is NOT a neural model. It is a
// synonym-cluster embedding shipped in-repo — every stem maps to a cluster
// id (a small lexicon below covering the seed corpus's vocabulary) or to a
// hashed dimension of its own, and a text is the L2-normalized bag of
// those dimensions. Two texts that say the same thing in different words
// land near each other only where the lexicon knows the words are kin;
// that is enough for a paraphrase to be found locally, with nothing sent
// anywhere, and it degrades to "keyword, and we said so" honestly rather
// than pretending to understand. A real local model (a MiniLM-class
// sentence encoder) is a drop-in behind the same `embed(text) → vector`
// interface and the same worker (lib/search/embedWorker.ts); shipping one
// means shipping weights, which this pass does not do
// (A-MEGA2-EMBEDDING-IS-A-LEXICON in the posture doc).
import { stem, tokenize } from "./index";
import { CLUSTERS } from "./lexicon";

export const EMBED_DIMS = 512;

// the lexicon (lib/search/lexicon.ts) is the ONE source of truth for this module and the worker's duplicate

const clusterOf = new Map<string, number>();
CLUSTERS.forEach((words, i) => {
  for (const w of words) clusterOf.set(stem(w.toLowerCase()), i);
});
const CLUSTER_DIMS = CLUSTERS.length;

/** deterministic hash → a dimension beyond the cluster block */
function hashDim(word: string): number {
  let h = 2166136261;
  for (let i = 0; i < word.length; i++) {
    h ^= word.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return CLUSTER_DIMS + (h % (EMBED_DIMS - CLUSTER_DIMS));
}

/** L2-normalized Float32Array; a text with no tokens is the zero vector */
export function embed(text: string): Float32Array {
  const v = new Float32Array(EMBED_DIMS);
  for (const t of tokenize(text)) {
    const c = clusterOf.get(t);
    if (c !== undefined) v[c] += 1.5; // a known meaning counts more than an arbitrary word
    v[hashDim(t)] += 1;
  }
  let norm = 0;
  for (let i = 0; i < v.length; i++) norm += v[i] * v[i];
  norm = Math.sqrt(norm);
  if (norm > 0) for (let i = 0; i < v.length; i++) v[i] /= norm;
  return v;
}

export function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

/** the meanings the lexicon recognized in a text — shown beside a semantic hit so the match is inspectable */
export function meaningsOf(text: string): string[] {
  const out = new Set<string>();
  for (const t of tokenize(text)) {
    const c = clusterOf.get(t);
    if (c !== undefined) out.add(CLUSTERS[c][0]);
  }
  return [...out];
}

export const LEXICON_CLUSTERS = CLUSTERS.length;
