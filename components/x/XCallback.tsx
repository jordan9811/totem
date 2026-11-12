"use client";
// SIGN IN WITH X (2026-11-06) — the callback page's island (/welcome/x, app/(main)/welcome/x/page.tsx). X sends the tab back
// here with ?state=…&code=… (or ?error=…). This island:
//   1. takes the query and REMOVES it from the address bar at once (history.replaceState), so the one-time code is not
//      left in this tab's history or shown on screen;
//   2. hands it to the device at once (POST /api/x/signin {action:"finish"}): public/device/boot.js holds the request
//      until the device is up, and X's code lives only 30 seconds, so nothing waits for anything else first;
//   3. on success, notes the sign-in for the guided first run (made in THIS document) and goes on to This is you with a
//      soft navigation (the identity stays); on a refusal, says the device's fixed sentence, with Start again.
// It runs once per document: a reload finds no query, and the device would refuse a replay anyway (the stored request is
// read once and removed).
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { noteSignedInHere } from "@/components/onboarding/Onboarding";
import { welcomeHref } from "@/lib/onboarding/state";

type View = { state: "working" } | { state: "empty" } | { state: "refused"; message: string; code: string | null } | { state: "done"; username: string | null };

export function XCallback() {
  const router = useRouter();
  const ran = useRef(false);
  const [view, setView] = useState<View>({ state: "working" });

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    const search = window.location.search;
    try {
      // the code leaves the address bar before anything else happens
      window.history.replaceState(window.history.state, "", window.location.pathname);
    } catch {
      /* a browser that refuses replaceState keeps the query visible; the device refuses a replay of it either way */
    }
    if (!search) {
      // a plain visit (no answer from X): nothing failed, there is simply nothing to finish here
      setView({ state: "empty" });
      return;
    }
    fetch("/api/x/signin", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "finish", search }) })
      .then(async (r) => {
        const j = (await r.json().catch(() => null)) as { error?: unknown; code?: unknown; link?: { username?: unknown } | null } | null;
        if (!r.ok || !j || !j.link) {
          setView({ state: "refused", message: j && typeof j.error === "string" ? j.error : "The sign-in could not be finished (HTTP " + r.status + "). Nothing was saved.", code: j && typeof j.code === "string" ? j.code : null });
          return;
        }
        setView({ state: "done", username: typeof j.link.username === "string" ? j.link.username : null });
        noteSignedInHere();
        router.replace(welcomeHref("profile"));
      })
      .catch(() => setView({ state: "refused", message: "The sign-in could not be finished: the request could not be made. Nothing was saved.", code: null }));
  }, [router]);

  return (
    <section data-testid="xsi-callback" data-state={view.state} data-code={view.state === "refused" ? view.code ?? "" : ""} className="px-4 py-10">
      {view.state === "working" ? (
        <>
          <p className="text-[20px] font-extrabold leading-6">Signing you in with X</p>
          <p className="mt-2 text-[15px] leading-5 text-x-sec">Checking X&apos;s answer in this browser…</p>
        </>
      ) : view.state === "empty" ? (
        <>
          <p className="text-[20px] font-extrabold leading-6">Sign in with X</p>
          <p data-testid="xsi-callback-empty" className="mt-2 text-[15px] leading-5 text-x-sec">
            This page finishes a sign-in when X sends you back here. There is nothing to finish right now.
          </p>
          <Link href={welcomeHref("farcaster")} data-testid="xsi-callback-start" className="mt-4 inline-flex h-10 items-center rounded-full bg-x-black-btn px-5 text-[15px] font-bold text-white">
            Go to Sign in
          </Link>
        </>
      ) : view.state === "done" ? (
        <>
          <p className="text-[20px] font-extrabold leading-6">Signed in with X{view.username ? " as @" + view.username : ""}</p>
          <p className="mt-2 text-[15px] leading-5 text-x-sec">Taking you to your profile…</p>
        </>
      ) : (
        <>
          <p className="text-[20px] font-extrabold leading-6">Sign in with X didn&apos;t finish</p>
          <p data-testid="xsi-callback-error" role="alert" className="mt-2 text-[15px] leading-5 text-[#f4212e]">
            {view.message}
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link href={welcomeHref("farcaster")} data-testid="xsi-callback-again" className="inline-flex h-10 items-center rounded-full bg-x-black-btn px-5 text-[15px] font-bold text-white">
              Start again
            </Link>
            <Link href="/home" className="inline-flex h-10 items-center rounded-full border border-x-border-dark px-5 text-[15px] font-bold">
              Go home
            </Link>
          </div>
        </>
      )}
    </section>
  );
}
