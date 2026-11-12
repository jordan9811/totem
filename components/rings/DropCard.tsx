"use client";
// PERSONA LAUNCH P4 — the /d card for a link-friend (app/d/page.tsx). No device, no identity, no storage: the key is the
// URL fragment (#<64 hex>, never sent to a server), the drop is read straight from the public validator, every row is
// trial-opened in this browser, and the note is shown. Three honest states besides the note itself:
//   * no key in the link          → "This link is incomplete"
//   * the drop could not be read  → "Couldn't check right now" (NEVER "withdrawn": an unread drop proves nothing)
//   * read, and nothing opens     → "This note has expired or was withdrawn"
// Nothing is prefetched: the accounts are names; a farcaster.xyz link opens only when the visitor clicks it.
import { useEffect, useState } from "react";
import { linkInboxKey, openRow, type RingStatement } from "@/lib/rings/envelope";
import { classifyDropAnswer } from "@/lib/rings/fetch";
import { Face, SplitAvatar } from "./SplitAvatar";

type CardState = { s: "checking" } | { s: "incomplete" } | { s: "failed"; why: string } | { s: "none" } | { s: "shown"; note: RingStatement };

export function DropCard({ validator }: { validator: string }) {
  const [state, setState] = useState<CardState>({ s: "checking" });
  useEffect(() => {
    let alive = true;
    (async () => {
      const keyHex = window.location.hash.replace(/^#/, "").trim().toLowerCase();
      if (!/^[0-9a-f]{64}$/.test(keyHex)) {
        setState({ s: "incomplete" });
        return;
      }
      let key;
      try {
        key = await linkInboxKey(keyHex);
      } catch {
        setState({ s: "incomplete" });
        return;
      }
      let status = 0;
      let text = "";
      try {
        const res = await fetch(validator.replace(/\/$/, "") + "/rings/drop", { cache: "no-store", referrerPolicy: "no-referrer" });
        status = res.status;
        text = await res.text();
      } catch (e) {
        if (alive) setState({ s: "failed", why: (e as Error).message });
        return;
      }
      const drop = classifyDropAnswer(status, text);
      if (!drop.full) {
        if (alive) setState({ s: "failed", why: drop.error });
        return;
      }
      const now = Date.now();
      let best: RingStatement | null = null;
      for (const row of drop.rows) {
        const st = await openRow(row, key, now);
        if (st && (!best || st.seq > best.seq)) best = st;
      }
      if (!alive) return;
      setState(best ? { s: "shown", note: best } : { s: "none" });
    })();
    return () => {
      alive = false;
    };
  }, [validator]);

  return (
    <main className="mx-auto max-w-[560px] px-4 py-10">
      <h1 className="text-[23px] font-extrabold leading-7">A private note</h1>
      <div data-testid="drop-card" data-state={state.s} className="mt-4 rounded-2xl border border-x-border p-4">
        {state.s === "checking" && <p className="text-[15px] text-x-sec">Checking…</p>}
        {state.s === "incomplete" && (
          <p className="text-[15px] leading-5">
            This link is incomplete. Ask the person who sent it to send the whole link again — over Signal or in person.
          </p>
        )}
        {state.s === "failed" && (
          <p className="text-[15px] leading-5">
            Couldn&rsquo;t check right now ({state.why}). This doesn&rsquo;t mean the note was withdrawn — try again in a minute.
          </p>
        )}
        {state.s === "none" && <p className="text-[15px] leading-5">This note has expired or was withdrawn.</p>}
        {state.s === "shown" && <Note note={state.note} />}
      </div>
      <p data-testid="drop-card-test-data" className="mt-4 text-[13px] leading-4 text-x-sec">
        Totem is a preview: rings and these notes are new and still being tested.
      </p>
      <p className="mt-2 text-[13px] leading-4 text-x-sec">
        This page read the note in your browser: the key is the part of the link after &ldquo;#&rdquo;, which your browser never sends to a server. Nothing
        here can prove anything to anyone else — the note carries no signature. Keep the link private: anyone who has it can read the note while it lasts.
      </p>
    </main>
  );
}

function Note({ note }: { note: RingStatement }) {
  const rootName = note.root ? (note.root.displayName ?? note.root.fname) : note.label;
  return (
    <div>
      <p className="text-[15px] leading-5">
        <span className="font-bold">{note.label}</span> says these accounts are the same person:
      </p>
      <ul className="mt-3 space-y-2">
        {note.root && (
          <li data-testid="drop-card-root" className="flex items-center gap-2 text-[15px]">
            <span className="inline-block h-8 w-8 overflow-hidden rounded-full">
              <Face thumb={note.root.thumb ?? null} name={rootName} />
            </span>
            <span>
              {rootName}{" "}
              <a href={"https://farcaster.xyz/" + encodeURIComponent(note.root.fname)} target="_blank" rel="noopener noreferrer" className="text-x-blue hover:underline">
                @{note.root.fname}
              </a>{" "}
              <span className="text-x-sec">(their main account)</span>
            </span>
          </li>
        )}
        {note.subjects.map((sub) => (
          <li key={sub.ref} data-testid="drop-card-subject" data-handle={sub.handle} className="flex items-center gap-2 text-[15px]">
            <SplitAvatar testid="drop-card-split-avatar" size={32} left={<Face thumb={note.root?.thumb ?? null} name={rootName} />} right={<Face thumb={sub.thumb ?? null} name={sub.display} />} leftName={rootName} rightName={"@" + sub.handle} />
            <span>
              {sub.display} <span className="text-x-sec">@{sub.handle}</span>
              {/* PERSONA LAUNCH wave 3 (UXH-13, final verify): a link shows the accounts only — which anonymous posts a persona
                  wrote opens only in Totem, for someone added with a private address, so the card promises nothing more */}
              {sub.depth === "posts" ? <span className="text-x-sec"> — which anonymous posts it wrote is shared too, but only in Totem with a private address, not through this link</span> : null}
            </span>
          </li>
        ))}
        {note.subjects.length === 0 && <li className="text-[15px] text-x-sec">No accounts are shared with you yet.</li>}
      </ul>
      <p className="mt-3 text-[13px] text-x-sec">Private note · until {new Date(note.expiresAt).toLocaleString()}</p>
    </div>
  );
}
