"use client";
// POST-DEPLOY Gate 4 — the readwise knobs, the bin, and the progress that
// carries across personas.
//
// Two sliders and a folder toggle. There is no retention model behind them and
// there is not meant to be one: the owner asked for control over cadence and
// chunk size, and a model would be the product deciding those for them. The
// long-term idea is a note on the ideas page.
import { useCallback, useEffect, useState } from "react";

interface Knobs { perBuild: number; chunkWords: number }
interface Folder { id: string; name: string; posts: number; priority: boolean }
interface Progress { postHash: string; read: number; total: number; buried: number }
interface BinEntry { chunkId: string; postHash: string; index: number; text: string; buriedAt: number }

export function ReadwisePane() {
  const [mode, setMode] = useState<{ id: string; name: string } | null>(null);
  const [knobs, setKnobs] = useState<Knobs | null>(null);
  const [limits, setLimits] = useState<{ perBuild: number[]; chunkWords: number[] } | null>(null);
  const [dwell, setDwell] = useState<{ wpm: number; floorMs: number } | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [progress, setProgress] = useState<Progress[]>([]);
  const [bin, setBin] = useState<BinEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/readwise", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "readwise unavailable");
      setMode(j.mode);
      setKnobs(j.knobs);
      setLimits(j.limits);
      setDwell(j.dwell);
      setFolders(j.folders ?? []);
      setProgress(j.progress ?? []);
      setBin(j.bin ?? []);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function post(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/readwise", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "failed");
      if (typeof j.rechunked === "number" && j.rechunked > 0) setNote("Re-cut " + j.rechunked + " piece(s) at the new width.");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const readTotal = progress.reduce((n, p) => n + p.read, 0);
  const chunkTotal = progress.reduce((n, p) => n + p.total, 0);

  return (
    <div data-testid="readwise-pane" className="px-4 py-3">
      <p className="text-[15px] leading-5 text-x-sec">
        Readwise drips what you have saved back into the timeline, a chunk at a time. These two knobs are
        yours: how many chunks arrive per refresh, and how short each one is. They are settings, not a
        schedule — nothing here models what you will remember or decides when you should see something
        again.
      </p>
      {mode ? (
        <p className="mt-1 text-[13px] text-x-sec">
          Both are per mode. You are setting <span className="font-bold">{mode.name}</span>.
        </p>
      ) : null}

      {error ? (
        <p data-testid="readwise-error" className="mt-3 rounded-xl border border-x-border px-3 py-2 text-[15px] text-[#f4212e]">
          {error}
        </p>
      ) : null}
      {note ? <p data-testid="readwise-note" className="mt-2 text-[13px] text-x-sec">{note}</p> : null}

      {knobs && limits ? (
        <div data-testid="readwise-knobs" data-per-build={knobs.perBuild} data-chunk-words={knobs.chunkWords} className="mt-4 space-y-4">
          <label className="block">
            <span className="text-[15px] font-bold">Chunks per refresh: {knobs.perBuild}</span>
            <input
              data-testid="readwise-slider-perBuild"
              type="range"
              min={limits.perBuild[0]}
              max={limits.perBuild[1]}
              value={knobs.perBuild}
              disabled={busy}
              onChange={(e) => setKnobs({ ...knobs, perBuild: Number(e.target.value) })}
              onMouseUp={(e) => void post({ action: "knobs", perBuild: Number((e.target as HTMLInputElement).value) })}
              onTouchEnd={(e) => void post({ action: "knobs", perBuild: Number((e.target as HTMLInputElement).value) })}
              className="mt-1 w-full"
            />
            <span className="text-[13px] text-x-sec">How many saved chunks may be spliced into one timeline build.</span>
          </label>

          <label className="block">
            <span className="text-[15px] font-bold">Chunk length: {knobs.chunkWords} words</span>
            <input
              data-testid="readwise-slider-chunkWords"
              type="range"
              min={limits.chunkWords[0]}
              max={limits.chunkWords[1]}
              step={20}
              value={knobs.chunkWords}
              disabled={busy}
              onChange={(e) => setKnobs({ ...knobs, chunkWords: Number(e.target.value) })}
              onMouseUp={(e) => void post({ action: "knobs", chunkWords: Number((e.target as HTMLInputElement).value), rechunk: true })}
              onTouchEnd={(e) => void post({ action: "knobs", chunkWords: Number((e.target as HTMLInputElement).value), rechunk: true })}
              className="mt-1 w-full"
            />
            <span className="text-[13px] text-x-sec">
              Applies to new pieces, and re-cuts what is already queued. Re-cutting moves the boundaries, so
              chunk-level read marks from the old width stop matching — your position in each piece is kept
              proportionally.
            </span>
          </label>

          {dwell ? (
            <p data-testid="readwise-threshold-explainer" className="text-[13px] leading-4 text-x-sec">
              A chunk counts as read once you have spent about half its reading time on screen — {dwell.wpm}{" "}
              words a minute, with a {Math.round(dwell.floorMs / 100) / 10}s floor — so a short chunk needs a
              moment and a long one needs longer. Scroll past it and it comes back.
            </p>
          ) : null}
        </div>
      ) : null}

      <section className="mt-6">
        <h3 className="text-[15px] font-bold">Priority folders</h3>
        <p className="text-[13px] leading-4 text-x-sec">
          Chunks from a priority folder are queued first, so when the cadence is low they are the ones that
          fit. A plain weight — nothing is learned from it.
        </p>
        <ul data-testid="readwise-folders" className="mt-2 divide-y divide-x-border">
          {folders.map((f) => (
            <li key={f.id} data-testid="readwise-folder-row" data-folder={f.id} data-priority={f.priority ? "1" : "0"} className="flex items-center gap-2 py-2">
              <span className="text-[15px] font-bold">{f.name}</span>
              <span className="text-[13px] text-x-sec">{f.posts} saved</span>
              <label className="ml-auto flex items-center gap-1 text-[13px] font-bold">
                <input
                  data-testid="readwise-folder-toggle"
                  type="checkbox"
                  checked={f.priority}
                  disabled={busy}
                  onChange={(e) => void post({ action: "priorityFolder", folderId: f.id, on: e.target.checked })}
                />
                priority
              </label>
            </li>
          ))}
          {folders.length === 0 ? <li className="py-2 text-[15px] text-x-sec">No folders yet.</li> : null}
        </ul>
      </section>

      <section className="mt-6">
        <h3 className="text-[15px] font-bold">Progress</h3>
        <p data-testid="readwise-progress" data-read={readTotal} data-total={chunkTotal} className="text-[13px] leading-4 text-x-sec">
          {readTotal} of {chunkTotal} chunks read. This count belongs to YOU, not to a persona: a paragraph
          you read as one persona is read as all of them, because there is one vault and one reader.
        </p>
        <ul className="mt-2 divide-y divide-x-border">
          {progress.map((p) => (
            <li key={p.postHash} data-testid="readwise-progress-row" data-post={p.postHash} data-read={p.read} data-total={p.total} className="flex items-center gap-2 py-1.5 text-[13px]">
              <span className="font-bold">{p.postHash}</span>
              <span className="text-x-sec">
                {p.read}/{p.total} read{p.buried ? " · " + p.buried + " in the bin" : ""}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-6">
        <h3 className="text-[15px] font-bold">Recycle bin</h3>
        <p className="text-[13px] leading-4 text-x-sec">
          X-ing out a chunk puts it here instead of deleting it. If dismissal were a void, people stop
          dismissing and the queue never drains.
        </p>
        <ul data-testid="readwise-bin" data-count={bin.length} className="mt-2 divide-y divide-x-border">
          {bin.map((b) => (
            <li key={b.chunkId} data-testid="readwise-bin-row" data-chunk-id={b.chunkId} className="flex items-start gap-2 py-2">
              <span className="min-w-0 flex-1 text-[13px] leading-4 text-x-sec">
                <span className="font-bold text-x-text">
                  {b.postHash} · chunk {b.index}
                </span>
                <br />
                {b.text.slice(0, 120)}
                {b.text.length > 120 ? "…" : ""}
              </span>
              <button
                data-testid="readwise-bin-restore"
                disabled={busy}
                onClick={() => void post({ action: "restore", chunkId: b.chunkId })}
                className="h-8 shrink-0 rounded-full border border-x-border px-3 text-[13px] font-bold disabled:opacity-50"
              >
                Restore
              </button>
            </li>
          ))}
          {bin.length === 0 ? <li className="py-2 text-[15px] text-x-sec">Nothing dismissed.</li> : null}
        </ul>
      </section>
    </div>
  );
}
