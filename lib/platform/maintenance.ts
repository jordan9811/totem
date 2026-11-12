// PUBLIC PREVIEW Gate 5 (run as BROWSER KEYSTORE PASS Gate 6) — the kill switch's static page. Served by
// middleware.ts on every route but liveness when LAYERS_MAINTENANCE=true: no data, no device, no validator call.
// A plain string, so it works in the edge runtime and needs no file read.
export const MAINTENANCE_RETRY_AFTER_SECONDS = 300;

/** Read at REQUEST time, not build time: the switch must flip on a restart with no rebuild. The dynamic key defeats
 *  the bundler's static inlining of `process.env.X` in the edge/middleware bundle; the plain read is the fallback
 *  for a runtime that froze the object instead. */
export function maintenanceEnabled(env: Record<string, string | undefined> = process.env): boolean {
  const key = "LAYERS_" + "MAINTENANCE";
  const raw = env[key] ?? env.LAYERS_MAINTENANCE;
  return String(raw || "").trim().toLowerCase() === "true";
}

export const MAINTENANCE_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Totem — down for maintenance</title>
<style>body{margin:0;font-family:-apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;background:#fff;color:#0f1419;display:flex;min-height:100vh;align-items:center;justify-content:center}
main{max-width:480px;padding:24px}h1{font-size:23px;margin:0 0 8px}p{color:#536471;font-size:15px;line-height:20px;margin:0}</style></head>
<body><main><h1>Totem is down for maintenance</h1><p>The preview is paused on purpose. Nothing you saved is affected; your identity lives in your browser. Try again in a few minutes.</p></main></body></html>
`;
