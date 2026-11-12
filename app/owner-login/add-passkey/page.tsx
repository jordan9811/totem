// OWNER PASSKEYS (D-OWNER-PASSKEYS) — the one-tap offer, right after a passphrase sign-in: "Add Face ID / fingerprint
// for this device". GATED (only /owner-login itself is exempt — an exact match), and the page checks the session
// itself as well, statefully, before it renders anything. It offers only what the server would accept: a passphrase
// session fresh enough to add a passkey, a deployment with a relying party (APP_URL), room under the cap, and a device
// that does not already have a live passkey here. Otherwise — or when this browser cannot make a passkey at all
// (components/owner/AddPasskey.tsx checks) — the owner goes straight on to where they were headed.
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  OWNER_COOKIE,
  OWNER_HINT_COOKIE,
  OWNER_LOGIN_PATH,
  OWNER_PASSKEYS_MAX,
  currentOwnerSession,
  ownerPasskeyBinding,
  readOwnerSecret,
  safeNextPath,
} from "@/lib/platform/owner-access";
import { livePasskeys, ownerGateStateSource, readOwnerState } from "@/lib/platform/owner-store.server";
import { enrollmentProblem, ownerRelyingParty } from "@/lib/platform/owner-passkeys.server";
import { AddPasskeyOffer } from "@/components/owner/AddPasskey";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Totem — add Face ID / fingerprint",
  robots: { index: false, follow: false },
};

function first(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export default async function AddPasskeyPage({ searchParams }: { searchParams: { [key: string]: string | string[] | undefined } }) {
  const next = safeNextPath(first(searchParams.next));
  const secret = readOwnerSecret();
  if (!secret) redirect(next);
  const session = await currentOwnerSession(cookies().get(OWNER_COOKIE)?.value, secret, process.env, ownerGateStateSource);
  if (!session) redirect(OWNER_LOGIN_PATH);
  if (enrollmentProblem(session) || !ownerRelyingParty()) redirect(next);
  let skip = true;
  try {
    const binding = await ownerPasskeyBinding(secret);
    const s = readOwnerState();
    const live = s ? livePasskeys(s, binding) : [];
    const hint = cookies().get(OWNER_HINT_COOKIE)?.value ?? "";
    skip = !s || live.length >= OWNER_PASSKEYS_MAX || live.some((p) => p.slot === hint);
  } catch {
    skip = true; // the offer is a convenience: when the state cannot be read, the owner simply goes on
  }
  if (skip) redirect(next);

  return (
    <main className="mx-auto flex min-h-full w-full max-w-[420px] flex-col px-4 py-12 text-x-text" data-testid="owner-add-passkey-page">
      <header className="flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icon.svg" alt="" width={32} height={32} className="rounded-full" />
        <span className="text-[20px] font-bold">Totem</span>
        <span className="ml-auto rounded-full border border-x-border-dark px-3 py-0.5 text-[12px] font-bold text-x-sec">owner service</span>
      </header>
      <h1 className="mt-8 text-[23px] font-extrabold leading-7">You&apos;re signed in</h1>
      <p className="mt-2 text-[15px] leading-5 text-x-sec">
        Skip the passphrase next time: add Face ID / fingerprint for this device, and signing in becomes one tap. Your passphrase keeps working everywhere.
      </p>
      <AddPasskeyOffer next={next} />
    </main>
  );
}
