// BROWSER KEYSTORE PASS Gate 1 stage 3 — `node:path` for the device bundle: the posix subset the data layer uses
// to build storage keys (join, dirname, basename, extname, resolve, isAbsolute). Storage keys are strings, not files.
export const sep = "/";

export function normalize(p: string): string {
  const abs = p.startsWith("/");
  const out: string[] = [];
  for (const part of p.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (out.length && out[out.length - 1] !== "..") out.pop();
      else if (!abs) out.push("..");
      continue;
    }
    out.push(part);
  }
  return (abs ? "/" : "") + out.join("/") || (abs ? "/" : ".");
}

export function join(...parts: string[]): string {
  return normalize(parts.filter((p) => p !== undefined && p !== null && p !== "").join("/"));
}

export function resolve(...parts: string[]): string {
  let acc = "";
  for (const p of parts) acc = p.startsWith("/") ? p : acc ? acc + "/" + p : p;
  if (!acc.startsWith("/")) acc = "/" + acc;
  return normalize(acc);
}

export function isAbsolute(p: string): boolean {
  return p.startsWith("/");
}

export function dirname(p: string): string {
  const n = p.replace(/\/+$/, "");
  const i = n.lastIndexOf("/");
  if (i < 0) return ".";
  if (i === 0) return "/";
  return n.slice(0, i);
}

export function basename(p: string, ext?: string): string {
  const n = p.replace(/\/+$/, "");
  let b = n.slice(n.lastIndexOf("/") + 1);
  if (ext && b.endsWith(ext)) b = b.slice(0, -ext.length);
  return b;
}

export function extname(p: string): string {
  const b = basename(p);
  const i = b.lastIndexOf(".");
  return i <= 0 ? "" : b.slice(i);
}

export function relative(from: string, to: string): string {
  const f = resolve(from).split("/").filter(Boolean);
  const t = resolve(to).split("/").filter(Boolean);
  let i = 0;
  while (i < f.length && i < t.length && f[i] === t[i]) i++;
  return [...f.slice(i).map(() => ".."), ...t.slice(i)].join("/");
}

const posix = { sep, normalize, join, resolve, isAbsolute, dirname, basename, extname, relative };
export { posix };
export default posix;
