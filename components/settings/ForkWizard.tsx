"use client";
// THE FORK WIZARD — the product's answer to "someone leaked me".
//
// The screen is deliberately blunt about what it can and cannot do. It cannot
// un-tell anyone. What it can do is move you somewhere they were not invited,
// carry your reputation with you, and tell the people you still trust where
// you went. The copy says exactly that, because a privacy feature that
// overstates itself is worse than one that does nothing.
//
// PROD-LIVE (D-CU-0-4): the wizard operates on the persona you are ACTING as. On a public deployment the server's
// activeSeedPersonaId() is the rig's fixture persona, so the page handed the wizard the fixture — it listed the
// fixture's holders and the fork was refused 403 not_own. ForkWizardIsland takes the persona from the server on
// the rig and from the browser device (useApp().actingPersonaId) on a public deployment, and waits until it is
// known. The "go to your new persona" link is a client navigation: a full page load on a public deployment discards
// an unsaved identity (it lives in tab memory) and mints a new one — the fork would vanish with it.
import Link from "next/link";
import { useEffect, useState } from "react";
import { useApp } from "@/components/Providers";
import { ErrorNote } from "./Chrome";
import { useActingPersona } from "./useActingPersona";
import { NoPersonaYet } from "@/components/world/NoPersonaYet";

interface Holder {
  audienceMember: string;
  grantId: string;
  tier: string;
  handle: string;
  name: string;
  avatarUrl: string | null;
  suspect: boolean;
}

interface Wizard {
  personaId: string;
  handle: string | null;
  name: string | null;
  holders: Holder[];
  suspicion: string | null;
}

interface Done {
  newPersona: string;
  newHandle: string;
  tier: number;
  carried: string[];
  dropped: string[];
}

/**
 * PROD-LIVE (D-CU-0-4): the page mounts this. `serverPersonaId` is activeSeedPersonaId() on the rig and null on a
 * public deployment, where the acting persona is the device's answer — until it is known the wizard waits.
 */
export function ForkWizardIsland({ serverPersonaId }: { serverPersonaId: string | null }) {
  const acting = useActingPersona(serverPersonaId);
  if (acting.personaId) return <ForkWizard personaId={acting.personaId} />;
  // LAYERS_WORLD=empty (review F6): no persona yet — a fork needs one to fork FROM; say so and point at the create
  if (acting.state === "none") return <NoPersonaYet what="A fork" />;
  if (acting.state === "error") {
    return <ErrorNote error={`Couldn't tell which persona you're acting as. ${acting.error ?? ""}`} onRetry={acting.retry} />;
  }
  return (
    <p data-testid="fork-loading" className="px-4 py-6 text-[15px] text-x-sec">
      Loading…
    </p>
  );
}

export function ForkWizard({ personaId }: { personaId: string }) {
  const { deviceIsThePage, refresh } = useApp();
  const [data, setData] = useState<Wizard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [carry, setCarry] = useState<Set<string>>(new Set());
  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Done | null>(null);
  // PROD-LIVE: Retry re-runs the read below (never a page load)
  const [attemptTick, setAttemptTick] = useState(0);

  useEffect(() => {
    let alive = true;
    (async () => {
      // Never fail open into an empty holder list: an empty list here reads
      // as "nobody to lose", which would quietly turn a fork into a silent
      // total disconnect. A read failure is shown as a failure.
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const res = await fetch(`/api/identity/fork?personaId=${encodeURIComponent(personaId)}`, { cache: "no-store" });
          if (!res.ok) throw new Error(`status ${res.status}`);
          const json: Wizard = await res.json();
          if (!alive) return;
          setData(json);
          // Everyone starts carried EXCEPT the seeded suspect. Nobody has to
          // know the backstory to run the demo, and nobody gets pre-trusted
          // who is already under suspicion.
          setCarry(new Set(json.holders.filter((h) => !h.suspect).map((h) => h.audienceMember)));
          setName(json.name ? `${json.name}` : "");
          setHandle(json.handle ? `${json.handle}_new` : "");
          return;
        } catch (e) {
          if (attempt === 2 && alive) setError((e as Error).message);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [personaId, attemptTick]);

  const toggle = (id: string) =>
    setCarry((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/identity/fork", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fromPersona: personaId,
          carry: [...carry],
          newName: name,
          newHandle: handle,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `status ${res.status}`);
      setDone(json);
      // PROD-LIVE: the new persona lives in the browser device's keystore; the chrome's roster is the device's
      // answer and re-reads on refresh(). (The rig's roster is the server's and needs no nudge — unchanged there.)
      if (deviceIsThePage) refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (error && !data) {
    // PROD-LIVE: the retry re-reads in place. A page reload on a public deployment would discard an unsaved identity.
    return (
      <>
        <p data-testid="fork-error" className="px-4 py-6 text-[15px] text-x-sec">
          Could not load your grant holders ({error}). Not forking on incomplete
          information — try again.
        </p>
        <button
          data-testid="fork-retry"
          onClick={() => {
            setError(null);
            setAttemptTick((t) => t + 1);
          }}
          className="mx-4 rounded-full bg-x-text px-5 py-2 text-[15px] font-bold text-x-bg"
        >
          Retry
        </button>
      </>
    );
  }
  if (!data) {
    return (
      <p data-testid="fork-loading" className="px-4 py-6 text-[15px] text-x-sec">
        Loading…
      </p>
    );
  }

  if (done) {
    return (
      <div data-testid="fork-done" className="px-4 py-5">
        <h2 className="text-[20px] font-extrabold text-x-text">You moved.</h2>
        <p className="mt-2 text-[15px] leading-5 text-x-sec">
          You are now{" "}
          <span className="font-bold text-x-text">@{done.newHandle}</span>, at tier{" "}
          <span className="font-bold text-x-text">{done.tier}</span> — the same tier you had, because
          reputation lives on your root, not on the persona you burned.
        </p>
        <p className="mt-3 text-[15px] leading-5 text-x-sec">
          <span className="font-bold text-x-text">{done.carried.length}</span>{" "}
          {done.carried.length === 1 ? "person was" : "people were"} told where you went.{" "}
          <span className="font-bold text-x-text">{done.dropped.length}</span>{" "}
          {done.dropped.length === 1 ? "was" : "were"} not, and cannot find out from us.
        </p>
        <p className="mt-3 text-[13px] leading-4 text-x-sec">
          Your old account is still up and still has its history. Nothing was deleted, and nothing
          you already said became un-said.
        </p>
        <Link
          href={"/" + done.newHandle}
          data-testid="fork-visit"
          className="mt-5 inline-block rounded-full bg-x-text px-5 py-2 text-[15px] font-bold text-x-bg"
        >
          Go to @{done.newHandle}
        </Link>
      </div>
    );
  }

  const dropped = data.holders.filter((h) => !carry.has(h.audienceMember));

  return (
    <div className="px-4 py-4">
      <p className="text-[15px] leading-5 text-x-sec">
        Forking makes a new persona under the same root. Your tier and history of good behaviour
        come with you. Choose who gets told where you went — everyone else keeps a pointer to an
        account you have stopped using.
      </p>
      <p className="mt-3 rounded-xl border border-x-border p-3 text-[13px] leading-4 text-x-sec">
        This does not delete anything and does not un-tell anyone. If someone already knows, they
        still know. What it changes is what they learn from here on.
      </p>

      {data.suspicion && (
        <p
          data-testid="fork-suspicion"
          className="mt-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-[13px] leading-4 text-x-text"
        >
          {data.suspicion}
        </p>
      )}

      <h3 className="mt-6 text-[15px] font-extrabold text-x-text">
        Who can currently resolve this identity
      </h3>
      {data.holders.length === 0 && (
        <p className="mt-2 text-[15px] text-x-sec">Nobody holds a grant on this persona.</p>
      )}
      <ul className="mt-2">
        {data.holders.map((h) => (
          <li
            key={h.audienceMember}
            className="flex items-center border-b border-x-border py-3"
            data-suspect={h.suspect ? "true" : "false"}
          >
            {h.avatarUrl && (
              <img src={h.avatarUrl} alt="" className="mr-3 h-10 w-10 shrink-0 rounded-full object-cover" />
            )}
            <div className="min-w-0">
              <p className="truncate text-[15px] font-bold leading-5 text-x-text">{h.name}</p>
              <p className="truncate text-[13px] leading-4 text-x-sec">
                @{h.handle}
                {h.suspect && <span className="ml-2 font-bold text-amber-500">under suspicion</span>}
              </p>
            </div>
            <label className="ml-auto flex shrink-0 items-center pl-3 text-[13px] text-x-sec">
              <span className="mr-2">Bring along</span>
              <input
                type="checkbox"
                data-testid={`carry-${h.audienceMember}`}
                checked={carry.has(h.audienceMember)}
                onChange={() => toggle(h.audienceMember)}
                className="h-5 w-5 accent-x-blue"
              />
            </label>
          </li>
        ))}
      </ul>

      <h3 className="mt-6 text-[15px] font-extrabold text-x-text">Your new persona</h3>
      <label className="mt-3 block">
        <span className="text-[13px] text-x-sec">Display name</span>
        <input
          data-testid="fork-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-1 w-full rounded-xl border border-x-border bg-transparent px-3 py-2 text-[15px] text-x-text outline-none focus:border-x-blue"
        />
      </label>
      <label className="mt-3 block">
        <span className="text-[13px] text-x-sec">Handle</span>
        <input
          data-testid="fork-handle"
          value={handle}
          onChange={(e) => setHandle(e.target.value.replace(/[^a-zA-Z0-9_]/g, ""))}
          className="mt-1 w-full rounded-xl border border-x-border bg-transparent px-3 py-2 text-[15px] text-x-text outline-none focus:border-x-blue"
        />
      </label>

      <p className="mt-5 text-[15px] leading-5 text-x-sec" data-testid="fork-summary">
        <span className="font-bold text-x-text">{carry.size}</span> will be told.{" "}
        <span className="font-bold text-x-text">{dropped.length}</span> will not
        {dropped.length > 0 && <>: {dropped.map((h) => "@" + h.handle).join(", ")}</>}.
      </p>

      {error && (
        <p data-testid="fork-submit-error" className="mt-3 text-[13px] text-red-500">
          {error}
        </p>
      )}

      <button
        data-testid="fork-submit"
        disabled={busy || !handle}
        onClick={submit}
        className="mt-4 rounded-full bg-x-text px-5 py-2 text-[15px] font-bold text-x-bg disabled:opacity-50"
      >
        {busy ? "Moving…" : "Fork this persona"}
      </button>
    </div>
  );
}
