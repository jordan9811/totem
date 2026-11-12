// BROWSER KEYSTORE PASS Gate 1 stage 3 — `node:fs` for the device bundle. Nothing the device serves reads a file:
// the keystore files go through lib/platform/storage.ts (its browser backend), the X inbox fixture is a bundled
// import, and the modules that still name fs (the server's liveness, the live zk artifacts, the ceremony vkey) are
// reached only on paths the device does not take. Probes answer "absent"; reads and writes refuse loudly.
const refuse = (op: string) => {
  throw new Error(`node:fs.${op} is not available in the browser device`);
};
export function existsSync(_path: string): boolean {
  return false;
}
export function readdirSync(_path: string): string[] {
  return [];
}
export function readFileSync(_path: string, _enc?: unknown): never {
  return refuse("readFileSync");
}
export function writeFileSync(_path: string, _data: unknown): never {
  return refuse("writeFileSync");
}
export function mkdirSync(_path: string, _opts?: unknown): never {
  return refuse("mkdirSync");
}
export function renameSync(_a: string, _b: string): never {
  return refuse("renameSync");
}
export function unlinkSync(_path: string): never {
  return refuse("unlinkSync");
}
export function rmSync(_path: string, _opts?: unknown): never {
  return refuse("rmSync");
}
export function statSync(_path: string): never {
  return refuse("statSync");
}
export default { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, renameSync, unlinkSync, rmSync, statSync };
