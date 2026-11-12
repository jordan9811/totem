// BROWSER KEYSTORE PASS Gate 1 stage 3 — `node:http`, `node:https`, `node:worker_threads`, `node:child_process` for
// the device bundle. The modules that import them (the OHTTP relay client, the embedding worker, the live prover
// child) are reached only in live modes the device does not run in preview; importing must succeed, using must refuse.
// PERSONA LAUNCH P7: still refusing, on purpose. The browser device's anonymous channel is NOT a shimmed node:http: it is
// lib/zk/anon/webChannel.ts (the browser's own request, with its identifying parts pinned off), chosen by relay.ts in the
// browser, and its prover is a Web Worker (lib/zk/transport/browser.ts), never a forked child. Anything that still
// reaches these functions in a tab is a path that must fail loudly, not quietly reroute.
const refuse = (what: string) => {
  throw new Error(`${what} is not available in the browser device`);
};

// node:http / node:https
export function request(): never {
  return refuse("http.request");
}
export function get(): never {
  return refuse("http.get");
}
export class Agent {
  constructor(_opts?: unknown) {
    /* an agent that will never be used */
  }
}

// node:worker_threads
export const isMainThread = true;
export const parentPort = null;
export const workerData = {};
export class Worker {
  constructor(_file: unknown, _opts?: unknown) {
    refuse("worker_threads.Worker");
  }
}

// node:child_process
export function fork(): never {
  return refuse("child_process.fork");
}
export function spawn(): never {
  return refuse("child_process.spawn");
}
export function execFile(): never {
  return refuse("child_process.execFile");
}

export default { request, get, Agent, isMainThread, parentPort, workerData, Worker, fork, spawn, execFile };
