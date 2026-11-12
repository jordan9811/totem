import "server-only";
// MEGA PASS 2 Gate 4 — THE EMBEDDING WORKER. The local "model" runs in a
// worker thread so the request path never blocks on it and so a device that
// cannot start it degrades HONESTLY: semantic search reports itself
// unavailable and the box falls back to keyword, saying so.
//
// The worker's code is a DELIBERATE DUPLICATE of lib/search/embed.ts's
// arithmetic (a worker cannot import the TypeScript module directly inside
// the Next server bundle); the Gate 4 suite pins the two together by
// embedding the same text both ways and asserting the vectors match. The
// synonym clusters are passed in as data, so there is one lexicon.
import { Worker } from "node:worker_threads";
import { EMBED_DIMS } from "./embed";
import { CLUSTERS } from "./lexicon";

const WORKER_SOURCE = `
const { parentPort, workerData } = require("node:worker_threads");
const { clusters, dims } = workerData;
const STOP = new Set(["the","a","an","and","or","of","to","in","on","at","is","it","for","with","as","by","be","this","that","i","we","you","was","are","from","but","not","so","if","my","our"]);
function stem(w) {
  let s = w;
  if (s.length > 4 && s.endsWith("ies")) s = s.slice(0, -3) + "y";
  else if (s.length > 3 && s.endsWith("es") && !s.endsWith("ses")) s = s.slice(0, -2);
  else if (s.length > 3 && s.endsWith("s") && !s.endsWith("ss")) s = s.slice(0, -1);
  if (s.length > 5 && s.endsWith("ing")) s = s.slice(0, -3);
  else if (s.length > 4 && s.endsWith("ed")) s = s.slice(0, -2);
  return s;
}
function tokenize(text) {
  return (text.toLowerCase().match(/[a-z0-9][a-z0-9'-]*/g) || []).map((w) => w.replace(/'s$/, "")).filter((w) => w.length > 1 && !STOP.has(w)).map(stem);
}
const clusterOf = new Map();
clusters.forEach((words, i) => { for (const w of words) clusterOf.set(stem(w.toLowerCase()), i); });
const CLUSTER_DIMS = clusters.length;
function hashDim(word) {
  let h = 2166136261;
  for (let i = 0; i < word.length; i++) { h ^= word.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return CLUSTER_DIMS + (h % (dims - CLUSTER_DIMS));
}
function embed(text) {
  const v = new Float32Array(dims);
  for (const t of tokenize(text)) {
    const c = clusterOf.get(t);
    if (c !== undefined) v[c] += 1.5;
    v[hashDim(t)] += 1;
  }
  let norm = 0;
  for (let i = 0; i < v.length; i++) norm += v[i] * v[i];
  norm = Math.sqrt(norm);
  if (norm > 0) for (let i = 0; i < v.length; i++) v[i] /= norm;
  return v;
}
parentPort.on("message", (msg) => {
  try {
    const vectors = msg.texts.map((t) => Array.from(embed(String(t))));
    parentPort.postMessage({ id: msg.id, vectors });
  } catch (e) {
    parentPort.postMessage({ id: msg.id, error: String(e && e.message || e) });
  }
});
`;

interface State {
  worker: Worker | null;
  failed: string | null;
  pending: Map<number, { resolve: (v: Float32Array[]) => void; reject: (e: Error) => void }>;
  seq: number;
  /** dev/test: force the "device cannot run the model" path */
  forceUnavailable: boolean;
}
const g = globalThis as unknown as { __layersEmbedWorker?: State };
const st = (): State => (g.__layersEmbedWorker ??= { worker: null, failed: null, pending: new Map(), seq: 0, forceUnavailable: false });

export function setSemanticUnavailableOverride(on: boolean): void {
  st().forceUnavailable = on;
}


function ensureWorker(): Worker | null {
  const s = st();
  if (s.forceUnavailable) return null;
  if (s.worker) return s.worker;
  if (s.failed) return null;
  try {
    const w = new Worker(WORKER_SOURCE, { eval: true, workerData: { clusters: CLUSTERS, dims: EMBED_DIMS } });
    w.on("message", (m: { id: number; vectors?: number[][]; error?: string }) => {
      const p = s.pending.get(m.id);
      if (!p) return;
      s.pending.delete(m.id);
      if (m.error) p.reject(new Error(m.error));
      else p.resolve((m.vectors ?? []).map((v) => Float32Array.from(v)));
    });
    w.on("error", (e) => {
      s.failed = e.message;
      for (const p of s.pending.values()) p.reject(e);
      s.pending.clear();
      s.worker = null;
    });
    w.on("exit", () => {
      s.worker = null;
    });
    w.unref();
    s.worker = w;
    return w;
  } catch (e) {
    s.failed = (e as Error).message;
    return null;
  }
}

export function semanticStatus(): { available: boolean; reason: string | null } {
  const s = st();
  if (s.forceUnavailable) return { available: false, reason: "the local model cannot run on this device (forced for the rig)" };
  if (s.failed) return { available: false, reason: "the local model failed to start: " + s.failed };
  return { available: ensureWorker() !== null, reason: s.failed };
}

/** embed in the worker; rejects when the model is unavailable — callers degrade to keyword and SAY so */
export function embedInWorker(texts: string[]): Promise<Float32Array[]> {
  const s = st();
  const w = ensureWorker();
  if (!w) return Promise.reject(new Error(semanticStatus().reason ?? "local model unavailable"));
  const id = ++s.seq;
  return new Promise((resolve, reject) => {
    s.pending.set(id, { resolve, reject });
    const timer = setTimeout(() => {
      if (s.pending.delete(id)) reject(new Error("the local model timed out"));
    }, 8000);
    const wrap = { resolve: (v: Float32Array[]) => { clearTimeout(timer); resolve(v); }, reject: (e: Error) => { clearTimeout(timer); reject(e); } };
    s.pending.set(id, wrap);
    w.postMessage({ id, texts });
  });
}

export function resetEmbedWorker(): void {
  const s = st();
  s.worker?.terminate().catch(() => {});
  g.__layersEmbedWorker = { worker: null, failed: null, pending: new Map(), seq: 0, forceUnavailable: false };
}
