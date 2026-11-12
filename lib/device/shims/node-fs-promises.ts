// BROWSER KEYSTORE PASS Gate 1 stage 3 — `node:fs/promises` for the device bundle. The one importer (the X archive
// import route) reads an uploaded archive from the server's disk; in the browser device that path is refused at use.
const refuse = (op: string) => Promise.reject(new Error(`node:fs/promises.${op} is not available in the browser device`));
export function readFile(_path: string, _enc?: unknown): Promise<never> {
  return refuse("readFile");
}
export function readdir(_path: string): Promise<never> {
  return refuse("readdir");
}
export function writeFile(_path: string, _data: unknown): Promise<never> {
  return refuse("writeFile");
}
export function mkdir(_path: string, _opts?: unknown): Promise<never> {
  return refuse("mkdir");
}
export function stat(_path: string): Promise<never> {
  return refuse("stat");
}
export default { readFile, readdir, writeFile, mkdir, stat };
