"use client";
// PERSONA LAUNCH P6 — THE LAUNCH PAGE'S FLOW: preview → confirm → status (app/(main)/launch/[personaId]).
//
// THE PREVIEW comes first and changes nothing: GET /api/launch?personaId= (device-local; writes and fetches nothing). It
// lists every anonymous post that will be linked to the new account (with its date and tier), the posts still on the
// way and the ones never posted, the account the launch would make, what launch narrows (the crowd included — fix LP-4),
// what stays hidden, what the launch posts on Farcaster (fix UX-L8), the 2–48 hour timing and the price. The owner may
// tick up to 10 posts for the launch history to quote, and — when the preview could not count the crowd, or counted it
// under the floor — must tick that they understand before Continue unlocks. "Continue" shows the CONFIRM
// (components/launch/LaunchConfirm.tsx), whose no-undo sentence is on screen before the box. After the confirm — or
// when this persona already has a launch UNDER WAY or DONE — the STATUS takes over. fix UX-L5: a launch that failed (or
// stalled with no account) does NOT take over: its reason is shown above the preview and Continue launches again.
// Every screen says the registrar is SIMULATED and nothing is created on Farcaster.
import { useEffect, useState } from "react";
import Link from "next/link";
import { LaunchConfirm } from "./LaunchConfirm";
import { LaunchStatus } from "./LaunchStatus";

interface PreviewPost {
  castHash: string;
  networkHash: string;
  text: string;
  at: number;
  tierLabel: string;
}
interface Preview {
  ok: true;
  personaId: string;
  handle: string;
  posts: PreviewPost[];
  waiting: number;
  refused: number;
  crowd: { size: number | null; exact: boolean; crowds: number; floor: number; needsAck: boolean; ackSentence: string | null };
  account: { fname: string; displayName: string; bio: string; pfpUrl: string };
  narrows: string[];
  staysHidden: string[];
  history: string;
  timing: string;
  price: string;
  noUndo: string;
  notice: string;
}
interface StatusLite {
  stage: string;
  canLaunchAgain?: boolean;
  reason?: string | null;
  words?: string;
}

export const SIMULATED_LINE = "This is a simulated registrar: nothing is created on Farcaster. The account, its chain and its $0 cost are test data.";

export function SimulatedNotice() {
  return (
    <p data-testid="launch-simulated" className="mx-4 mt-3 rounded-md border border-[#f4b400] bg-[#fff8e1] px-3 py-2 text-[13px] leading-4 text-[#5f4b00]">
      {SIMULATED_LINE}
    </p>
  );
}

const dateOf = (t: number) => new Date(t).toISOString().slice(0, 16).replace("T", " ") + " UTC";

/** fix UX-L5: the status takes over only for a launch under way or done — never for one the owner may launch again (a
 *  launch that failed before registration, or stalled with no account: the server's canLaunchAgain) */
export function statusTakesOver(status: StatusLite | null | undefined): boolean {
  return !!status && status.canLaunchAgain !== true;
}

export function LaunchPreview({ personaId }: { personaId: string }) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previous, setPrevious] = useState<StatusLite | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [step, setStep] = useState<"preview" | "confirm" | "status">("preview");
  const [picks, setPicks] = useState<string[]>([]);
  const [acknowledged, setAcknowledged] = useState(false);
  // the confirm stands on a preview opened in the last 30 minutes (lib/launch/confirm.ts): "Back" reads it again
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch(`/api/launch?personaId=${encodeURIComponent(personaId)}`, { cache: "no-store" });
        const j = (await r.json().catch(() => null)) as (Preview & { status?: StatusLite; error?: string }) | null;
        if (!alive) return;
        if (statusTakesOver(j?.status)) setStep("status");
        else if (j?.status) setPrevious(j.status);
        if (r.ok && j && j.ok) setPreview(j);
        else if (!statusTakesOver(j?.status)) setError(j?.error ?? "Couldn't load the preview. Try again.");
      } catch {
        if (alive) setError("Couldn't load the preview. Try again.");
      }
    })();
    return () => {
      alive = false;
    };
  }, [personaId, reload]);

  if (step === "status") {
    return (
      <>
        <SimulatedNotice />
        <LaunchStatus personaId={personaId} />
      </>
    );
  }
  if (error) {
    return (
      <>
        <SimulatedNotice />
        <p data-testid="launch-refusal" role="status" className="px-4 py-4 text-[15px] leading-5">
          {error}
        </p>
        <p className="px-4 text-[15px]">
          <Link href="/settings/account" className="text-x-blue hover:underline">
            Back to your personas
          </Link>
        </p>
      </>
    );
  }
  if (!preview) {
    return (
      <>
        <SimulatedNotice />
        <p data-testid="launch-loading" className="px-4 py-4 text-[15px] text-x-sec">
          Reading your anonymous posts…
        </p>
      </>
    );
  }
  if (step === "confirm") {
    return (
      <>
        <SimulatedNotice />
        <LaunchConfirm
          personaId={personaId}
          handle={preview.handle}
          noUndo={preview.noUndo}
          history={preview.history}
          quoteOriginals={picks}
          acknowledgeCrowd={preview.crowd.needsAck ? acknowledged : false}
          onConfirmed={() => setStep("status")}
          onBack={() => {
            setStep("preview");
            setReload((x) => x + 1);
          }}
        />
      </>
    );
  }
  const togglePick = (h: string) => setPicks((p) => (p.includes(h) ? p.filter((x) => x !== h) : p.length >= 10 ? p : [...p, h]));
  const canContinue = !preview.crowd.needsAck || acknowledged;
  return (
    <div data-testid="launch-preview" data-handle={preview.handle}>
      <SimulatedNotice />
      {previous ? (
        <p data-testid="launch-previous" role="status" className="mx-4 mt-3 rounded-md border border-x-border px-3 py-2 text-[15px] leading-5">
          {previous.reason || previous.words || "The last launch didn't finish. Nothing was revealed; you can launch again."}
        </p>
      ) : null}
      <section className="border-b border-x-border px-4 py-3">
        <h2 className="text-[17px] font-bold">What launching @{preview.handle} links</h2>
        {preview.posts.length ? (
          <ul data-testid="launch-posts" className="mt-2 space-y-2">
            {preview.posts.map((p) => (
              <li key={p.castHash} data-testid="launch-post" data-cast-hash={p.castHash} className="rounded-md border border-x-border px-3 py-2">
                <p className="text-[15px] leading-5 break-words">{p.text}</p>
                <p className="mt-1 text-[13px] text-x-sec">
                  Posted by @anon {dateOf(p.at)} · {p.tierLabel}
                </p>
                <label className="mt-1 flex items-center gap-2 text-[13px] text-x-sec">
                  <input type="checkbox" data-testid="launch-quote-pick" checked={picks.includes(p.castHash)} onChange={() => togglePick(p.castHash)} disabled={!picks.includes(p.castHash) && picks.length >= 10} />
                  Quote this one in the launch history
                </label>
              </li>
            ))}
          </ul>
        ) : preview.waiting > 0 ? (
          <p data-testid="launch-none-yet" className="mt-2 text-[15px] text-x-sec">
            {preview.waiting} anonymous post{preview.waiting === 1 ? " is" : "s are"} on the way to @anon. None has been relayed yet.
          </p>
        ) : (
          <p className="mt-2 text-[15px] text-x-sec">@{preview.handle} has no anonymous posts to reveal.</p>
        )}
        {preview.waiting > 0 && preview.posts.length ? (
          <p data-testid="launch-waiting" className="mt-2 text-[13px] text-x-sec">
            {preview.waiting} more anonymous post{preview.waiting === 1 ? " is" : "s are"} still on the way to @anon. The launch waits for them, so every post is revealed together.
          </p>
        ) : null}
        {preview.refused > 0 ? (
          <p data-testid="launch-refused" className="mt-2 text-[13px] text-x-sec">
            {preview.refused} anonymous post{preview.refused === 1 ? " was" : "s were"} refused and never posted. {preview.refused === 1 ? "It stays" : "They stay"} private.
          </p>
        ) : null}
      </section>
      <section data-testid="launch-account" className="border-b border-x-border px-4 py-3">
        <h2 className="text-[17px] font-bold">The new account</h2>
        <p className="mt-1 text-[15px]">
          Name: <span className="font-bold">@{preview.account.fname}</span>
        </p>
        <p className="text-[15px]">Display name: {preview.account.displayName || "(none)"}</p>
        <p className="text-[15px] break-words">Bio: {preview.account.bio || "(none)"}</p>
        <p className="text-[15px]">Picture: {preview.account.pfpUrl ? "your persona's picture" : "none"}</p>
      </section>
      <section data-testid="launch-history-note" className="border-b border-x-border px-4 py-3">
        <h2 className="text-[17px] font-bold">What the account posts</h2>
        <p className="mt-1 text-[15px] leading-5">{preview.history}</p>
      </section>
      <section data-testid="launch-narrows" className="border-b border-x-border px-4 py-3">
        <h2 className="text-[17px] font-bold">What launching narrows</h2>
        <ul className="mt-1 list-disc pl-5 text-[15px] leading-5">
          {preview.narrows.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
        {preview.crowd.needsAck && preview.crowd.ackSentence ? (
          <label data-testid="launch-crowd-ack" className="mt-2 flex items-start gap-2 text-[15px] leading-5">
            <input type="checkbox" data-testid="launch-crowd-ack-box" className="mt-1" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />
            <span>{preview.crowd.ackSentence}</span>
          </label>
        ) : null}
      </section>
      <section data-testid="launch-hidden" className="border-b border-x-border px-4 py-3">
        <h2 className="text-[17px] font-bold">What stays hidden</h2>
        <ul className="mt-1 list-disc pl-5 text-[15px] leading-5">
          {preview.staysHidden.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      </section>
      <section className="border-b border-x-border px-4 py-3 text-[15px] leading-5">
        <p data-testid="launch-timing">{preview.timing}</p>
        <p data-testid="launch-price" className="mt-1">
          {preview.price}
        </p>
      </section>
      <div className="px-4 py-3">
        <button data-testid="launch-continue" disabled={!canContinue} onClick={() => setStep("confirm")} className="rounded-full bg-x-text px-4 py-2 text-[15px] font-bold text-x-bg disabled:opacity-50">
          Continue
        </button>
      </div>
    </div>
  );
}
