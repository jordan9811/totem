// The two label strings, importable from a server component with no data access (the landing page) and from the
// browser. lib/zk/privacy.ts re-exports them; it is "server-only" and computes the verdict, this file only names it.
export const PRIVATE_LABEL = "your persona's root is hidden from this server at the proof layer";
export const DEMO_PREFIX = "DEMO — not yet private";
