// PERSONA LAUNCH P2 (BYX G3) — READING AN X ARCHIVE IN THE BROWSER PAGE. Nothing is uploaded: the person's ZIP (or its
// extracted folder) is read here, the few files the importer needs are parsed (lib/x/archiveParse.ts), and only the
// PARSED lanes leave this module — no raw file content, no email, no phone. An X archive runs to hundreds of MB and,
// for media-heavy accounts, gigabytes; the importer needs a few MB of it.
//
// THE ZIP PATH reads the archive by RANDOM ACCESS (File.slice), not by streaming it end to end: the central directory
// at the end of the file lists every entry with its offset and sizes, so the wanted entries' bytes are the only ones
// ever read and inflated — the media and the DMs are listed and never touched. Each read is at most 8 MiB. Inflating
// uses the browser's own DecompressionStream("deflate-raw") (also Node's, for the unit harness), and every entry's CRC-32
// is checked, so a truncated or corrupted file is refused rather than half-read.
//   DEVIATION from the spec (fflate's streaming Unzip): the pre-flight that was to add fflate@0.8.3 had not run when
//   this gate was built, and the rule was that nothing in lib/ imports it before it exists. The central-directory read
//   needs no dependency at all and reads strictly less of the file (fflate's streaming Unzip walks every byte to find
//   the entries). The limits are the spec's: an entry over 512 MiB is refused with its size, and an archive of 4 GB or
//   more (whose directory needs ZIP64, which is not read here) is refused with the instruction to pick the extracted
//   data folder instead.
// THE FOLDER PATH (<input webkitdirectory>, or a hand-picked set of data/*.js files) filters by name and reads each
//   wanted file's text.
import {
  mergeTweetParts,
  parseAccount,
  parseFollowing,
  parseLikes,
  parseManifestTweetFiles,
  parsePersonalizationNames,
  parseTweetsDetailed,
  TWEET_FILE_RE,
  wantedArchivePath,
  type ArchiveAccount,
  type ArchiveLike,
  type ArchiveTweet,
} from "./archiveParse";

/** the largest single read of the file */
export const READ_SLICE_BYTES = 8 * 1024 * 1024;
/** the largest single archive file the importer reads */
export const MAX_ENTRY_BYTES = 512 * 1024 * 1024;
/** a ZIP this size or bigger needs ZIP64, which is not read here */
export const ZIP_SIZE_LIMIT = 2 ** 32;
/** the largest central directory read (an archive with this many entries is extracted and picked as a folder) */
const MAX_DIRECTORY_BYTES = 64 * 1024 * 1024;

export const OVER_4GB_SENTENCE = "this archive is over 4 GB; extract it and pick its data folder instead";

/** what a reader needs of a File: its size, a name, and slices */
export interface ArchiveBlob {
  readonly size: number;
  readonly name?: string;
  slice(start?: number, end?: number): Blob;
}

export interface ArchiveReadHooks {
  /** every byte range read from the ZIP, and why (the unit harness asserts the bounds and what was never read) */
  onRead?(start: number, end: number, purpose: "end" | "directory" | "header" | "data"): void;
  /** every entry the directory lists, and whether the importer reads it */
  onEntry?(name: string, wanted: boolean): void;
  onProgress?(p: { done: number; total: number; file: string }): void;
}

export interface ParsedArchive {
  account: ArchiveAccount | null;
  /** merged across parts, deduplicated, newest first */
  posts: ArchiveTweet[];
  /** records dropped for a missing string id or date */
  postsSkipped: number;
  following: string[];
  likes: ArchiveLike[];
  /** enabled ad-interest names (classified where they land) */
  interests: string[];
  /** the archive files that were read — names only */
  files: string[];
  /** how many tweet files (parts) were read */
  partsSeen: number;
  counts: { posts: number; retweets: number; replies: number; following: number; likes: number; interests: number };
}

// ------------------------------------------------------------------------------------------------ CRC-32

let CRC_TABLE: Uint32Array | null = null;
function crc32(chunks: Uint8Array[]): number {
  if (!CRC_TABLE) {
    CRC_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const b of chunks) for (let i = 0; i < b.length; i++) crc = CRC_TABLE[(crc ^ b[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// ------------------------------------------------------------------------------------------------ the ZIP directory

interface ZipEntry {
  name: string;
  flags: number;
  method: number;
  crc: number;
  compSize: number;
  size: number;
  localOffset: number;
}

async function readRange(file: ArchiveBlob, start: number, end: number, purpose: "end" | "directory" | "header" | "data", hooks?: ArchiveReadHooks): Promise<Uint8Array> {
  if (end - start > READ_SLICE_BYTES) throw new Error("internal: a read over the slice bound");
  hooks?.onRead?.(start, end, purpose);
  return new Uint8Array(await file.slice(start, end).arrayBuffer());
}

/** the central directory's entries; throws the plain-words refusal for what is not read here */
export async function listZipEntries(file: ArchiveBlob, hooks?: ArchiveReadHooks): Promise<ZipEntry[]> {
  if (file.size >= ZIP_SIZE_LIMIT) throw new Error(OVER_4GB_SENTENCE);
  if (file.size < 22) throw new Error("this file is not a ZIP archive");
  const tailLen = Math.min(file.size, 22 + 0xffff);
  const tailStart = file.size - tailLen;
  const tail = await readRange(file, tailStart, file.size, "end", hooks);
  const dv = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (dv.getUint32(i, true) === 0x06054b50 && i + 22 + dv.getUint16(i + 20, true) === tail.length) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("this file is not a ZIP archive (no directory at its end)");
  const total = dv.getUint16(eocd + 10, true);
  const cdSize = dv.getUint32(eocd + 12, true);
  const cdOffset = dv.getUint32(eocd + 16, true);
  if (total === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) throw new Error(OVER_4GB_SENTENCE);
  if (cdSize > MAX_DIRECTORY_BYTES) throw new Error("this archive lists too many files to read here; extract it and pick its data folder instead");
  if (cdOffset + cdSize > file.size) throw new Error("this ZIP archive is incomplete (its directory points past its end)");
  const cd = new Uint8Array(cdSize);
  for (let at = 0; at < cdSize; at += READ_SLICE_BYTES) cd.set(await readRange(file, cdOffset + at, cdOffset + Math.min(cdSize, at + READ_SLICE_BYTES), "directory", hooks), at);
  const cv = new DataView(cd.buffer, cd.byteOffset, cd.byteLength);
  const dec = new TextDecoder("utf-8");
  const out: ZipEntry[] = [];
  let p = 0;
  for (let k = 0; k < total; k++) {
    if (p + 46 > cd.length || cv.getUint32(p, true) !== 0x02014b50) throw new Error("this ZIP archive's directory is damaged");
    const flags = cv.getUint16(p + 8, true);
    const method = cv.getUint16(p + 10, true);
    const crc = cv.getUint32(p + 16, true);
    const compSize = cv.getUint32(p + 20, true);
    const size = cv.getUint32(p + 24, true);
    const nameLen = cv.getUint16(p + 28, true);
    const extraLen = cv.getUint16(p + 30, true);
    const commentLen = cv.getUint16(p + 32, true);
    const localOffset = cv.getUint32(p + 42, true);
    const name = dec.decode(cd.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (compSize === 0xffffffff || size === 0xffffffff || localOffset === 0xffffffff) throw new Error(OVER_4GB_SENTENCE);
    out.push({ name, flags, method, crc, compSize, size, localOffset });
  }
  return out;
}

/** one entry's bytes, inflated in ≤ 8 MiB reads and checked against its CRC-32 */
async function inflateEntry(file: ArchiveBlob, e: ZipEntry, hooks?: ArchiveReadHooks): Promise<string> {
  if (e.flags & 1) throw new Error(`${e.name} is password-protected; extract the archive and pick its data folder instead`);
  if (e.method !== 0 && e.method !== 8) throw new Error(`${e.name} uses a compression this page cannot read; extract the archive and pick its data folder instead`);
  if (e.size > MAX_ENTRY_BYTES) throw new Error(`${e.name} is ${Math.ceil(e.size / (1024 * 1024))} MB, over the ${MAX_ENTRY_BYTES / (1024 * 1024)} MB one archive file may be here`);
  const head = await readRange(file, e.localOffset, Math.min(file.size, e.localOffset + 30), "header", hooks);
  const hv = new DataView(head.buffer, head.byteOffset, head.byteLength);
  if (head.length < 30 || hv.getUint32(0, true) !== 0x04034b50) throw new Error(`${e.name}: this ZIP archive is damaged`);
  const dataStart = e.localOffset + 30 + hv.getUint16(26, true) + hv.getUint16(28, true);
  const dataEnd = dataStart + e.compSize;
  if (dataEnd > file.size) throw new Error(`${e.name}: this ZIP archive is incomplete`);

  const outChunks: Uint8Array[] = [];
  let outBytes = 0;
  const take = (b: Uint8Array) => {
    outBytes += b.length;
    if (outBytes > e.size || outBytes > MAX_ENTRY_BYTES) throw new Error(`${e.name} is larger than its archive says; refusing it`);
    outChunks.push(b);
  };
  if (e.method === 0) {
    for (let at = dataStart; at < dataEnd; at += READ_SLICE_BYTES) take(await readRange(file, at, Math.min(dataEnd, at + READ_SLICE_BYTES), "data", hooks));
  } else {
    const ds = new DecompressionStream("deflate-raw");
    const writer = ds.writable.getWriter();
    const reader = ds.readable.getReader();
    const drained = (async () => {
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) return;
          take(value as Uint8Array);
        }
      } catch (err) {
        // stop the stream from BOTH ends: a write waiting on back-pressure must reject, not hang
        await reader.cancel(err).catch(() => undefined);
        throw err;
      }
    })();
    try {
      for (let at = dataStart; at < dataEnd; at += READ_SLICE_BYTES) {
        const piece = await readRange(file, at, Math.min(dataEnd, at + READ_SLICE_BYTES), "data", hooks);
        await writer.write(piece as unknown as BufferSource);
      }
      await writer.close();
      await drained;
    } catch (err) {
      try {
        await writer.abort();
      } catch {
        /* already errored */
      }
      await drained.catch(() => undefined);
      const msg = (err as Error)?.message ?? String(err);
      throw new Error(/larger than its archive|refusing/.test(msg) ? msg : `${e.name} could not be decompressed (the archive may be damaged)`);
    }
  }
  if (outBytes !== e.size) throw new Error(`${e.name} is incomplete in this archive`);
  if (crc32(outChunks) !== e.crc) throw new Error(`${e.name} is damaged in this archive (its checksum does not match)`);
  const all = new Uint8Array(outBytes);
  let o = 0;
  for (const c of outChunks) {
    all.set(c, o);
    o += c.length;
  }
  outChunks.length = 0;
  // ignoreBOM: KEEP a byte-order mark (the text is the file, byte for byte; archiveParse tolerates the mark)
  return new TextDecoder("utf-8", { ignoreBOM: true }).decode(all);
}

// ------------------------------------------------------------------------------------------------ parse the lanes

interface Source {
  /** the archive path ("data/tweets.js") */
  path: string;
  text(): Promise<string>;
}

const baseOf = (p: string) => p.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? p;

async function parseSources(sources: Source[], hooks?: ArchiveReadHooks): Promise<ParsedArchive> {
  const byBase = new Map<string, Source>();
  for (const s of sources) if (!byBase.has(baseOf(s.path))) byBase.set(baseOf(s.path), s);
  const total = byBase.size;
  let done = 0;
  const files: string[] = [];
  // each file's text lives only for the parse call below: nothing raw is kept
  const read = async (s: Source): Promise<string> => {
    hooks?.onProgress?.({ done, total, file: baseOf(s.path) });
    const text = await s.text();
    done++;
    files.push(baseOf(s.path));
    return text;
  };
  let tweetSources = [...byBase.values()].filter((s) => TWEET_FILE_RE.test(baseOf(s.path)));
  const manifest = byBase.get("manifest.js");
  if (manifest) {
    const listed = parseManifestTweetFiles(await read(manifest));
    if (listed) {
      const want = new Set(listed.map(baseOf));
      const chosen = tweetSources.filter((s) => want.has(baseOf(s.path)));
      if (chosen.length === want.size) tweetSources = chosen;
    }
  }
  const acc = byBase.get("account.js");
  const account = acc ? parseAccount(await read(acc)) : null;
  const fol = byBase.get("following.js");
  const following = fol ? parseFollowing(await read(fol)) : [];
  const lk = byBase.get("like.js");
  const likes = lk ? parseLikes(await read(lk)) : [];
  const per = byBase.get("personalization.js");
  const interests = per ? parsePersonalizationNames(await read(per)) : [];
  const parts: ArchiveTweet[][] = [];
  let postsSkipped = 0;
  for (const s of tweetSources.sort((a, b) => baseOf(a.path).localeCompare(baseOf(b.path), "en", { numeric: true }))) {
    const r = parseTweetsDetailed(await read(s));
    parts.push(r.tweets);
    postsSkipped += r.skipped;
  }
  const posts = mergeTweetParts(parts);
  hooks?.onProgress?.({ done: total, total, file: "" });
  return {
    account,
    posts,
    postsSkipped,
    following,
    likes,
    interests,
    files,
    partsSeen: parts.length,
    counts: {
      posts: posts.length,
      retweets: posts.filter((p) => p.isRetweet).length,
      replies: posts.filter((p) => !!p.replyToId && !p.isRetweet).length,
      following: following.length,
      likes: likes.length,
      interests: interests.length,
    },
  };
}

function looksLikeZip(f: ArchiveBlob): boolean {
  return /\.zip$/i.test(f.name ?? "") || (f as { type?: string }).type === "application/zip";
}

/**
 * Read an X archive: one ZIP file, or the files of its extracted folder (a FileList from <input webkitdirectory>, or
 * data/*.js files picked by hand). Returns the parsed lanes; throws a plain-words sentence for anything it refuses.
 */
export async function readArchive(input: ArchiveBlob | ArrayLike<ArchiveBlob>, hooks?: ArchiveReadHooks): Promise<ParsedArchive> {
  // a single file has a size; a FileList (or an array of files) has a length and no size — an array's own `slice`
  // method must not make it look like a file
  const single = typeof (input as ArchiveBlob).size === "number" && typeof (input as ArchiveBlob).slice === "function";
  const list: ArchiveBlob[] = single ? [input as ArchiveBlob] : Array.from(input as ArrayLike<ArchiveBlob>);
  if (list.length === 0) throw new Error("no file was picked");
  if (list.length === 1 && looksLikeZip(list[0])) {
    const zip = list[0];
    const entries = await listZipEntries(zip, hooks);
    const sources: Source[] = [];
    for (const e of entries) {
      if (e.name.endsWith("/")) continue;
      const wanted = wantedArchivePath(e.name);
      hooks?.onEntry?.(e.name, wanted);
      if (wanted) sources.push({ path: e.name, text: () => inflateEntry(zip, e, hooks) });
    }
    if (!sources.some((s) => baseOf(s.path) === "account.js")) throw new Error("this ZIP has no data/account.js; is it the archive X sent you?");
    return parseSources(sources, hooks);
  }
  const sources: Source[] = [];
  for (const f of list) {
    const path = (f as { webkitRelativePath?: string }).webkitRelativePath || f.name || "";
    const wanted = wantedArchivePath(path);
    hooks?.onEntry?.(path, wanted);
    if (!wanted) continue;
    if (f.size > MAX_ENTRY_BYTES) throw new Error(`${baseOf(path)} is ${Math.ceil(f.size / (1024 * 1024))} MB, over the ${MAX_ENTRY_BYTES / (1024 * 1024)} MB one archive file may be here`);
    sources.push({ path, text: () => f.slice(0, f.size).text() });
  }
  if (!sources.some((s) => baseOf(s.path) === "account.js")) throw new Error("no data/account.js was picked; pick the archive's data folder (or its ZIP)");
  return parseSources(sources, hooks);
}

/** one named entry of a ZIP, inflated and CRC-checked (the readers above use the same path; the unit harness compares
 *  its output byte for byte with what was zipped) */
export async function readZipText(file: ArchiveBlob, name: string, hooks?: ArchiveReadHooks): Promise<string> {
  const e = (await listZipEntries(file, hooks)).find((x) => x.name === name);
  if (!e) throw new Error(`${name} is not in this archive`);
  return inflateEntry(file, e, hooks);
}
