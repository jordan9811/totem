// Tiny static server for the PoC page only (research/poc). NOT the app.
// Usage: node serve.mjs <port> [coi]  — "coi" adds COOP/COEP for multithreaded WASM.
import http from "node:http";
import { readFile } from "node:fs/promises";
import { join, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const port = Number(process.argv[2] ?? 8791);
const coi = process.argv.includes("coi");
const root = dirname(fileURLToPath(import.meta.url));
const types = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript" };

http.createServer(async (req, res) => {
  try {
    const p = join(root, req.url.split("?")[0].replace(/^\//, "") || "browser-timing.html");
    const body = await readFile(p);
    const h = { "content-type": types[extname(p)] ?? "application/octet-stream" };
    if (coi) {
      h["cross-origin-opener-policy"] = "same-origin";
      h["cross-origin-embedder-policy"] = "credentialless";
    }
    res.writeHead(200, h);
    res.end(body);
  } catch {
    res.writeHead(404); res.end("nope");
  }
}).listen(port, () => console.log(`poc server on :${port} coi=${coi}`));
