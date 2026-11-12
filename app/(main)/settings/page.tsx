import type { Metadata } from "next";
import Link from "next/link";
import { SettingsHeader, SettingsNav } from "@/components/settings/Chrome";
import { isPublicDeployment } from "@/lib/platform/env-contract";
import { OWNER_SECURITY_PATH, readOwnerSecret } from "@/lib/platform/owner-access";

export const metadata: Metadata = { title: "Settings / X" };
// PROD-LIVE: the public-only row below depends on the deployment, read per request
export const dynamic = "force-dynamic";

export default async function SettingsIndex() {
  // PROD-LIVE (D-CU-0-4): on a public deployment the visitor's identity is the browser device, and the one place it is
  // saved (a passkey, a login, the 24 words), linked and forgotten is /device — which no settings row pointed at. It
  // leads the list there, as a soft navigation (next/link: a full load would wipe an unsaved identity). The rig's
  // index is unchanged; its identity is the server's keystore, not a browser device.
  const pub = isPublicDeployment();
  // OWNER PASSKEYS (D-OWNER-PASSKEYS): on the owner service (an owner gate is configured) Security leads the list —
  // Face ID / fingerprint sign-in, passkeys, sign out everywhere. The rig's and the public preview's lists are unchanged.
  const owner = readOwnerSecret() !== null;
  // PERSONA LAUNCH P8: the @totem-on-X rows, said as what they are — TEST DATA (the owner rule: never present test data as
  // live). The DM inbox's words come from lib/x/inbox.ts inboxStatus() (read-only: no inbox read, no ledger); the outbox
  // is fixture-only this wave. Not on the public deployment, where neither is offered (D-X-PUBLIC-OFF): a row there would
  // be navigation to a dead end.
  const dmInbox = pub ? null : (await import("@/lib/x/inbox")).inboxStatus();
  return (
    <>
      <SettingsHeader title="Settings" back="/home" />
      {owner ? (
        <Link
          href={OWNER_SECURITY_PATH}
          data-testid="settings-link-owner-security"
          className="flex items-center justify-between border-b border-x-border px-4 py-3.5 transition-colors hover:bg-x-hover"
        >
          <span className="min-w-0">
            <span className="block text-[15px] leading-5">Security</span>
            {/* review UX-6: it lists Face ID / fingerprint sign-ins, not every signed-in device — the blurb says what is there */}
            <span className="block truncate text-[13px] leading-4 text-x-sec">Face ID / fingerprint, sign out of this device or everywhere</span>
          </span>
          <span className="ml-3 shrink-0 text-x-sec">›</span>
        </Link>
      ) : null}
      {/* CONNECT MAIN review (UXC-06): the owner service's way to its own Farcaster account — the write door's refusals
          point here by this name ("Settings › Connect your Farcaster account"); the page says what it needs */}
      {owner ? (
        <Link
          href="/settings/connect"
          data-testid="settings-link-connect"
          className="flex items-center justify-between border-b border-x-border px-4 py-3.5 transition-colors hover:bg-x-hover"
        >
          <span className="min-w-0">
            <span className="block text-[15px] leading-5">Connect your Farcaster account</span>
            <span className="block truncate text-[13px] leading-4 text-x-sec">Your existing main account: whether it can be connected here, and how</span>
          </span>
          <span className="ml-3 shrink-0 text-x-sec">›</span>
        </Link>
      ) : null}
      {pub ? (
        <Link
          href="/device"
          data-testid="settings-link-device"
          className="flex items-center justify-between border-b border-x-border px-4 py-3.5 transition-colors hover:bg-x-hover"
        >
          <span className="min-w-0">
            <span className="block text-[15px] leading-5">Your device</span>
            <span className="block truncate text-[13px] leading-4 text-x-sec">Save this identity, your 24 words, linked devices and accounts</span>
          </span>
          <span className="ml-3 shrink-0 text-x-sec">›</span>
        </Link>
      ) : null}
      <SettingsNav />
      {dmInbox ? (
        <section data-testid="settings-x-group" className="border-b border-x-border">
          <h2 className="px-4 pb-1 pt-4 text-[13px] font-bold uppercase tracking-wide text-x-sec">Totem on X</h2>
          <Link
            href="/settings/x-outbox"
            data-testid="settings-x-outbox"
            data-test-data="true"
            className="flex items-center justify-between px-4 py-3.5 transition-colors hover:bg-x-hover"
          >
            <span className="min-w-0">
              <span className="block text-[15px] leading-5">Totem on X: anonymous posts (test data)</span>
              <span className="block truncate text-[13px] leading-4 text-x-sec">Copies of anonymous posts wait for a moderator; nothing reaches X</span>
            </span>
            <span className="ml-3 shrink-0 text-x-sec">›</span>
          </Link>
          <Link
            href="/settings/dm-hook"
            data-testid="settings-x-dm-inbox"
            data-test-data={dmInbox.testData ? "true" : "false"}
            className="flex items-center justify-between px-4 py-3.5 transition-colors hover:bg-x-hover"
          >
            <span className="min-w-0">
              <span className="block text-[15px] leading-5">{dmInbox.testData ? "DM a tweet to save it (test data)" : "DM a tweet to save it"}</span>
              <span className="block truncate text-[13px] leading-4 text-x-sec">{dmInbox.sentence}</span>
            </span>
            <span className="ml-3 shrink-0 text-x-sec">›</span>
          </Link>
        </section>
      ) : null}
      <div className="h-24" />
    </>
  );
}
