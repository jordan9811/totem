"use client";
// BROWSER KEYSTORE PASS Gate 2 / Gate 5 — the onboarding surface (docs/custody-model.md D-CU-0-6, D-CU-0-10, D-CU-0-11, D-CU-0-12).
//
// One persistent strip names the state ("lives in this tab" until saved); the picker shows passkey and social login
// as equals, ordered by what this device can do; a login that finds nothing renders the fork instead of creating;
// settings list the methods and hold the 24 words. Everything here calls the device that runs in this page —
// no request in this component reaches a server with a key, because the server has none.
//
// Gate 5 (research/attack-custody-3.md #4, D-CU-5-A-LINK-IS-CONFIRMED-ACROSS-DEVICES): in both link flows the device
// that will RECEIVE shows a fingerprint beside its code, and the device that GRANTS types that fingerprint before
// anything is sealed. A deployment without a provider says so instead of offering a social login that cannot exist;
// a method list that could not be read pauses saving instead of mislabelling a save.
//
// PERSONA LAUNCH P1 (SIWF): PASSKEY FIRST. The picker is an ordered list — the passkey save (Face ID / fingerprint
// where the device has it), then Sign in with Farcaster (components/device/FarcasterSignIn.tsx: an identity link, not
// a save, and the card says so), then the rig-only fixture social login — and everything a consumer never needs first
// (the 24 words, restore, keep-in-this-browser, devices, linked accounts) sits under a collapsed Advanced. The test ids
// the custody suites anchor on (save-passkey, save-social, identity-strip, phrase, link-code, rootlink-*) are kept;
// the suites open Advanced (advanced-toggle) before they reach a control inside it. The Save moment (SaveMoment.tsx)
// is mounted here too: a verified sign-in on this page offers the passkey while the identity is only in this tab.
//
// PERSONA LAUNCH P1 (review UX-6, UX-15): the app's "Already saved? Unlock" soft-links to /device#unlock, and Settings ›
// Account to /device#farcaster. A soft navigation scrolls to a hash only when the element exists as it lands, and this
// page first renders "Starting your device…" — so once the page is drawn, the hash's card is brought into view. The
// passkey save's sentence is SaveMoment's passkeySavedSentence (one wording everywhere: a wrap-path passkey is bound to
// this device and the way to another device is linking it — never "keep your 24 words").
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { startDevice } from "./loadDevice";
import { FarcasterSignIn } from "./FarcasterSignIn";
import { PasskeySaveCard, SaveMoment, passkeySavedSentence } from "./SaveMoment";
// PUBLIC GO-LIVE: the passkey card and the Sign in with Farcaster card are the SAME components the guided first run
// (/welcome, components/onboarding) renders — one implementation, two places, two skins ("device" here). This page stays
// for recovery: unlock, devices, linked accounts and, under Advanced, the 24 words.

type Method = { method_id: string; kind: "passkey-prf" | "passkey-wrap" | "provider"; created_at: number };
type Status = {
  persistent: boolean;
  methods: Method[];
  methodsUnknown: boolean;
  webauthn: boolean;
  platformAuthenticator: boolean;
  wrapPathAvailable: boolean;
  providerAvailable: boolean;
  providerMethods: string[];
  rpId: string;
};
type Info = { anchor: string; rootId: string; fid: number; personaIds: string[]; activePersonaId: string; restored: boolean; persistent: boolean };
type Unlock = { empty: false; info: Info; methodId: string } | { empty: true; methodId: string; kind: "passkey" | "provider"; subject?: string };
type LinkedRoot = { grantId: string; anchor: string; rootId: string; personas: { id: string; handle: string; name: string; avatarUrl: string | null }[]; issuedAt: number };
interface DeviceApi {
  ready: Promise<Info>;
  info: Info | null;
  wipe: () => Promise<void>;
  /** keep this identity in this browser (D-CU-3-STORAGE-IS-EPHEMERAL-UNTIL-THE-VISITOR-SAYS-OTHERWISE) */
  persist: () => Promise<void>;
  custody: {
    status: () => Promise<Status>;
    savePasskey: () => Promise<{ methodId: string; path: "prf" | "wrap"; attached: boolean }>;
    unlockPasskey: () => Promise<Unlock>;
    saveProvider: (method: string, hint?: string) => Promise<{ methodId: string; subject: string; attached: boolean }>;
    unlockProvider: (method: string, hint?: string) => Promise<Unlock>;
    exportPhrase: () => Promise<string>;
    importPhrase: (words: string) => Promise<Info>;
  };
  linking: {
    offer: () => Promise<{ code: string; expiresAt: number; fingerprint: string }>;
    approve: (code: string, confirmedFingerprint: string) => Promise<{ deviceId: string }>;
    accept: (opts?: { timeoutMs?: number }) => Promise<Info>;
    pendingCode: () => string | null;
    pendingFingerprint: () => string | null;
  };
  rootlink: {
    propose: () => Promise<{ code: string }>;
    proposalFingerprint: () => Promise<string | null>;
    answer: (code: string) => Promise<{ fingerprint: string }>;
    pendingFingerprint: () => string | null;
    complete: (code: string, confirmedFingerprint: string, opts?: { timeoutMs?: number }) => Promise<LinkedRoot>;
    finish: (opts?: { timeoutMs?: number }) => Promise<LinkedRoot>;
    linked: () => Promise<LinkedRoot[]>;
    unlink: (grantId: string) => Promise<void>;
  };
  /** PERSONA LAUNCH P4: this device's private addresses for rings, and what its background check received */
  rings?: {
    createAddress: (label?: string | null) => Promise<RingAddress>;
    listAddresses: () => Promise<RingAddress[]>;
    forgetAddress: (addrId: string) => Promise<boolean>;
    restoreAddress: (addrId: string) => Promise<boolean>;
    listForgottenAddresses: () => Promise<{ addrId: string; label: string | null; createdAt: number; forgottenAt: number }[]>;
    status: () => Promise<RingsStatus>;
  };
}
type RingAddress = { addrId: string; address: string; label: string | null; createdAt: number; qr: { viewBox: number; path: string } };
type RingsStatus = {
  lastTickAt: number | null;
  lastTickOk: boolean | null;
  lastFetchError: string | null;
  addresses: number;
  rings: { label: string; root: string | null; personas: { handle: string; depth: string }[]; expiresAt: number; state: "shown" | "unknown" }[];
};
declare global {
  interface Window {
    __layersDevice?: DeviceApi;
    __LAYERS_DEVICE_ENV?: Record<string, string>;
  }
}

const card: React.CSSProperties = { border: "1px solid #2f3336", borderRadius: 16, padding: 16, background: "#000", color: "#e7e9ea" };
const btn: React.CSSProperties = { borderRadius: 9999, padding: "8px 16px", fontWeight: 700, border: "1px solid #536471", background: "#eff3f4", color: "#0f1419", cursor: "pointer" };
const btnQuiet: React.CSSProperties = { ...btn, background: "transparent", color: "#e7e9ea" };
const muted: React.CSSProperties = { color: "#71767b", fontSize: 13 };
const field: React.CSSProperties = { background: "#000", color: "#e7e9ea", border: "1px solid #536471", borderRadius: 8, padding: 6 };
const mono: React.CSSProperties = { ...field, fontFamily: "monospace" };
const big: React.CSSProperties = { marginTop: 8, fontSize: 22, letterSpacing: 2, fontFamily: "monospace" };
const FP = /^[0-9A-F]{4}-[0-9A-F]{4}$/;

export function DeviceApp({ env, publicDeployment: declared }: { env: Record<string, string>; publicDeployment?: boolean }) {
  // PROD-LIVE: is this a PUBLIC deployment (the device is the app page) or the rig / owner service (the server answers
  // /api/* itself)? app/device/page.tsx hands no explicit flag, but it declares LAYERS_DEVICE_DEBUG="1" exactly when
  // the server has ZK_DEV_HOOKS=true, and Next inlines NODE_ENV into this client bundle — together they are
  // isPublicDeployment() (NODE_ENV=production && ZK_DEV_HOOKS!=="true", lib/platform/env-contract.ts). The same value
  // on the server render and in the browser, so the back link below hydrates without a mismatch.
  const publicDeployment = declared ?? (process.env.NODE_ENV === "production" && env.LAYERS_DEVICE_DEBUG !== "1");
  const [info, setInfo] = useState<Info | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [personas, setPersonas] = useState<{ id: string; handle: string; name: string }[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fork, setFork] = useState<{ kind: "passkey" | "provider"; method?: string; subject?: string } | null>(null);
  const [phrase, setPhrase] = useState<string | null>(null);
  const [ack, setAck] = useState(false);
  const [importWords, setImportWords] = useState("");
  const [providerMethod, setProviderMethod] = useState("farcaster");
  const [providerHint, setProviderHint] = useState("");
  // device linking: the new device shows a code AND a fingerprint; the root's device types both
  const [linkCode, setLinkCode] = useState<string | null>(null);
  const [linkFingerprint, setLinkFingerprint] = useState<string | null>(null);
  const [approveCode, setApproveCode] = useState("");
  const [approveFingerprint, setApproveFingerprint] = useState("");
  // root linking: the proposer shows a code, then types the fingerprint the answering device shows
  const [linkedRoots, setLinkedRoots] = useState<LinkedRoot[]>([]);
  const [rootCode, setRootCode] = useState<string | null>(null);
  const [rootAnswered, setRootAnswered] = useState(false);
  const [rootConfirm, setRootConfirm] = useState("");
  const [rootAnswerCode, setRootAnswerCode] = useState("");
  const [rootFingerprint, setRootFingerprint] = useState<string | null>(null);
  // PERSONA LAUNCH P1: Advanced is collapsed until opened (or until a link code has to be shown inside it)
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const refresh = useCallback(async () => {
    const d = window.__layersDevice!;
    const [st, per] = await Promise.all([d.custody.status(), fetch("/api/personas").then((r) => r.json()).catch(() => ({ personas: [] }))]);
    setStatus(st);
    setInfo(d.info);
    setPersonas((per.personas ?? []).map((p: { id: string; handle: string; name: string }) => ({ id: p.id, handle: p.handle, name: p.name })));
  }, []);

  useEffect(() => {
    (async () => {
      try {
        // PROD-LIVE (D-CU-0-4): the shared loader decides "boot.js is installed" by window.__layersOrigFetch and
        // waits for a bundle another mount injected to actually RUN (a soft navigation here from the app arrives with
        // the device already loading) — the old tag-presence test read __layersDevice before it existed
        await startDevice(env, { overwriteEnv: true });
        await refresh();
      } catch (e) {
        setError((e as Error).message);
        // PROD-LIVE: past the 90 s boot deadline (loadDevice.ts) the device may still come up — follow it instead of
        // stranding this page on "could not start" for a device that now answers. A real failure rejects: nothing.
        window.__layersDevice?.ready.then(
          async () => {
            setError(null);
            await refresh().catch((err: unknown) => setError((err as Error).message));
          },
          () => {}
        );
      }
    })();
  }, [env, refresh]);

  const run = async (label: string, fn: () => Promise<string | void>) => {
    setBusy(label);
    setError(null);
    setNote(null);
    try {
      const n = await fn();
      if (n) setNote(n);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const d = () => window.__layersDevice!;
  const saved = (status?.methods.length ?? 0) > 0;
  const social = status?.providerAvailable ?? false;
  // a save must know whether it attaches to a saved identity or starts one: with the list unreadable it waits
  const canSave = !!status && !status.methodsUnknown;

  const savePasskey = () =>
    run("passkey", async () => {
      const r = await d().custody.savePasskey();
      return passkeySavedSentence(r);
    });
  const saveProvider = (method: string) =>
    run("provider:" + method, async () => {
      const r = await d().custody.saveProvider(method, providerHint || undefined);
      return (r.attached ? "Added " : "Saved with ") + method + " as " + r.subject + ".";
    });
  const unlockPasskey = () =>
    run("unlock-passkey", async () => {
      const r = await d().custody.unlockPasskey();
      if (r.empty) {
        setFork({ kind: "passkey" });
        return "That passkey holds no identity yet.";
      }
      setFork(null);
      return "Unlocked with your passkey.";
    });
  const unlockProvider = () =>
    run("unlock-provider", async () => {
      const r = await d().custody.unlockProvider(providerMethod, providerHint || undefined);
      if (r.empty) {
        setFork({ kind: "provider", method: providerMethod, subject: r.subject });
        return "No identity is saved under that login yet.";
      }
      setFork(null);
      return "Unlocked with " + providerMethod + ".";
    });

  // Gate 3 — device linking. This device offers a code (it minted an HPKE key for the material to be sealed to),
  // then waits; a device holding the root enters that code AND the fingerprint shown beside it, and approves. The
  // seed never travels (D-CU-3-*); a swapped offer shows a different fingerprint (D-CU-5-A-LINK-IS-CONFIRMED-ACROSS-DEVICES).
  const startLink = () =>
    run("link-offer", async () => {
      const o = await d().linking.offer();
      setAdvancedOpen(true); // the code is shown under Advanced (Devices): open it, wherever the link was started
      setLinkCode(o.code);
      setLinkFingerprint(o.fingerprint);
      setFork(null);
      d()
        .linking.accept()
        .then(async () => {
          setLinkCode(null);
          setLinkFingerprint(null);
          setNote("Linked. This device now holds your identity — without the seed.");
          await refresh();
        })
        .catch((e) => {
          setLinkCode(null);
          setLinkFingerprint(null);
          setError((e as Error).message);
        });
      return "Enter this code and its fingerprint on a device that holds your identity.";
    });
  const approveDevice = () =>
    run("link-approve", async () => {
      const r = await d().linking.approve(approveCode, approveFingerprint);
      setApproveCode("");
      setApproveFingerprint("");
      return "Device " + r.deviceId + " linked. It can act as every persona and open the vault; it cannot mint personas or export the 24 words.";
    });

  // Gate 3 — root linking (D-CU-0-14): link, not merge. This root proposes and shows a code; the other root's device
  // answers with it and shows a fingerprint; the person types that fingerprint here and this device completes. Both
  // vaults then hold the co-signed grant; the relay only ever held sealed rosters.
  const loadLinked = useCallback(async () => {
    try {
      setLinkedRoots(await window.__layersDevice!.rootlink.linked());
    } catch {
      setLinkedRoots([]);
    }
  }, []);
  const proposeRoot = () =>
    run("rootlink-propose", async () => {
      const { code } = await d().rootlink.propose();
      setRootCode(code);
      setRootAnswered(false);
      setRootConfirm("");
      // wait for the answer; the fingerprint itself is read off the OTHER device, never shown here
      void (async () => {
        for (let i = 0; i < 800; i++) {
          await new Promise((r) => setTimeout(r, 750));
          try {
            if (await d().rootlink.proposalFingerprint()) {
              setRootAnswered(true);
              return;
            }
          } catch {
            /* keep waiting */
          }
        }
      })();
      return "Enter this code on the device that holds the other account.";
    });
  const completeRoot = () =>
    run("rootlink-complete", async () => {
      if (!rootCode) throw new Error("no proposal is pending");
      await d().rootlink.complete(rootCode, rootConfirm);
      setRootCode(null);
      setRootAnswered(false);
      setRootConfirm("");
      await loadLinked();
      return "Accounts linked — not merged. Reputation does not combine.";
    });
  const answerRoot = () =>
    run("rootlink-answer", async () => {
      const { fingerprint } = await d().rootlink.answer(rootAnswerCode);
      setRootAnswerCode("");
      setRootFingerprint(fingerprint);
      d()
        .rootlink.finish()
        .then(async () => {
          setRootFingerprint(null);
          setNote("Accounts linked — not merged. Reputation does not combine.");
          await loadLinked();
        })
        .catch((e) => {
          setRootFingerprint(null);
          setError((e as Error).message);
        });
      return "Read this fingerprint to the person holding the other account; the link completes when they confirm it.";
    });
  const unlinkRoot = (grantId: string) =>
    run("rootlink-unlink", async () => {
      await d().rootlink.unlink(grantId);
      await loadLinked();
      return "Unlinked. The other account drops its copy on its next visit.";
    });
  useEffect(() => {
    if (info) void loadLinked();
  }, [info, loadLinked]);

  // UX-6: bring /device#unlock (or #farcaster) into view once the page is drawn — once per load of this page
  const drawn = !!info && !!status;
  useEffect(() => {
    if (!drawn) return;
    const id = window.location.hash.replace(/^#/, "");
    if (id !== "unlock" && id !== "farcaster") return;
    document.getElementById(id)?.scrollIntoView({ block: "start" });
  }, [drawn]);

  if (error && !info) return <main style={{ padding: 24, color: "#f4212e" }}>The device could not start: {error}</main>;
  if (!info || !status) return <main style={{ padding: 24, ...muted }}>Starting your device…</main>;

  return (
    <main style={{ maxWidth: 640, margin: "0 auto", padding: 16, display: "grid", gap: 16, fontFamily: "inherit" }}>
      {/* PROD-LIVE: on a PUBLIC deployment the way back is a SOFT navigation — a full load would wipe an identity this
          page has not saved. On the rig / owner service it is a FULL load: this page installed a fetch patch
          (loadDevice.ts injects boot.js there, the root layout does not) that a soft navigation would carry into the
          app, silently answering the rig app's /api/* from this throwaway in-browser root instead of its server. */}
      {publicDeployment ? (
        <Link href="/home" data-testid="device-back" style={{ ...muted, textDecoration: "underline", width: "fit-content" }}>
          ← Back to the app
        </Link>
      ) : (
        // eslint-disable-next-line @next/next/no-html-link-for-pages
        <a href="/home" data-testid="device-back" style={{ ...muted, textDecoration: "underline", width: "fit-content" }}>
          ← Back to the app
        </a>
      )}
      <h1 style={{ fontSize: 20, margin: 0 }}>Your identity on this device</h1>

      {/* the strip: D-CU-0-6 */}
      <section data-testid="identity-strip" data-methods={status.methodsUnknown ? "unknown" : String(status.methods.length)} style={{ ...card, borderColor: status.methodsUnknown ? "#f4212e" : saved ? "#00ba7c" : "#ffd400" }}>
        <div style={{ fontWeight: 700 }}>
          {status.methodsUnknown ? "Could not read your saved ways in" : saved ? `Saved — ${status.methods.length} way${status.methods.length === 1 ? "" : "s"} in` : "Unsaved — this identity lives in this tab"}
        </div>
        <div style={muted}>
          {status.methodsUnknown ? "Saving is paused until the validator answers — nothing is lost, and nothing will be mislabelled." : saved ? "Closing the tab keeps it. Add a second way in as a backup." : "Closing the tab loses it. Save it to keep it."}
        </div>
        <div style={{ ...muted, marginTop: 8 }}>
          root <code>{info.rootId}</code> · personas {personas.map((p) => "@" + p.handle).join(", ") || "—"}
        </div>
      </section>

      {note && <div role="status" style={{ ...card, borderColor: "#1d9bf0" }}>{note}</div>}
      {error && <div role="alert" style={{ ...card, borderColor: "#f4212e", color: "#f4212e" }}>{error}</div>}

      {/* PERSONA LAUNCH P1 (SIWF): the picker is an ORDERED list, passkey first (the owner's rule: consumer flows are a
          passkey and a QR, never a seed phrase). 1 the passkey save, full width; 2 Sign in with Farcaster (an identity
          link, NOT a save: the card says so); 3 the fixture social login, ONLY where a provider exists (the rig: it is
          what accept-cu2 check 9 drives); 4 Advanced, collapsed: the 24 words, restore, keep-in-this-browser, devices
          and linked accounts. D-CU-0-10 as amended (docs/custody-model.md). */}
      <section data-testid="save-picker" style={{ display: "grid", gap: 12 }}>
        <PasskeySaveCard
          skin="device"
          facts={{ webauthn: status.webauthn, platformAuthenticator: status.platformAuthenticator, saved, canSave }}
          busy={!!busy}
          onSave={savePasskey}
          noPasskeyNote="Passkeys are not available in this browser. Use Advanced below to keep the 24 words instead."
        />

        <FarcasterSignIn publicDeployment={publicDeployment} onChange={refresh} skin="device" />

        {social ? (
          <div style={card} data-testid="save-social" data-provider="available" data-order="3">
            <div style={{ fontWeight: 700 }}>Social login (test setup)</div>
            <div style={muted}>{status.webauthn ? "Farcaster, email or Google, through this test setup's stand-in provider." : "Passkeys are absent here, so this is the way to save."}</div>
            <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
              {status.providerMethods.map((m) => (
                <button key={m} style={m === "farcaster" ? btn : btnQuiet} disabled={!!busy || !canSave} onClick={() => saveProvider(m)}>
                  {saved ? "Add " : "Save with "}
                  {m[0].toUpperCase() + m.slice(1)}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </section>

      {/* unlock: D-CU-2-A-LOGIN-THAT-FINDS-NOTHING-DOES-NOT-CREATE */}
      <section style={card} data-testid="unlock" id="unlock">
        <div style={{ fontWeight: 700 }}>Already have an identity?</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12, alignItems: "center" }}>
          <button style={btnQuiet} disabled={!status.webauthn || !!busy} onClick={unlockPasskey}>
            Unlock with a passkey
          </button>
          {social ? (
            <>
              <select value={providerMethod} onChange={(e) => setProviderMethod(e.target.value)} style={field}>
                {status.providerMethods.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
              <input placeholder="account (fixture)" value={providerHint} onChange={(e) => setProviderHint(e.target.value)} style={field} />
              <button style={btnQuiet} disabled={!!busy} onClick={unlockProvider}>
                Unlock with social login
              </button>
            </>
          ) : null}
        </div>
        {fork && (
          <div data-testid="fork" style={{ ...card, marginTop: 12, borderColor: "#ffd400" }}>
            <div style={{ fontWeight: 700 }}>New here, or already have an account?</div>
            <div style={muted}>Nothing is saved under that {fork.kind === "passkey" ? "passkey" : "login"} yet. Start fresh with the identity in this tab, or link a device that already holds your account.</div>
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button style={btn} disabled={!!busy || !canSave} onClick={() => (fork.kind === "provider" ? saveProvider(fork.method!) : savePasskey())}>
                Start fresh here
              </button>
              <button style={btnQuiet} disabled={!!busy} onClick={startLink} data-testid="fork-link">
                Link an existing device
              </button>
            </div>
          </div>
        )}
      </section>

      {/* 4. ADVANCED, collapsed: everything a consumer never needs to see first (the 24 words above all) */}
      {info && <RingsOnThisDevice />}

      <details data-testid="advanced" style={{ ...card, padding: 0 }} open={advancedOpen} onToggle={(e) => setAdvancedOpen((e.currentTarget as HTMLDetailsElement).open)}>
        <summary data-testid="advanced-toggle" style={{ padding: 16, cursor: "pointer", fontWeight: 700 }}>
          Advanced: the 24 words, other devices, linked accounts
        </summary>
        <div style={{ display: "grid", gap: 16, padding: "0 16px 16px" }}>
          {/* keep in this browser: D-CU-3-STORAGE-IS-EPHEMERAL-UNTIL-THE-VISITOR-SAYS-OTHERWISE */}
          <section style={card} data-testid="keep-in-browser">
            <div style={{ fontWeight: 700 }}>Keep in this browser</div>
            <div style={muted}>Keeps this identity in this browser only. Clearing site data loses it; a passkey keeps it safe beyond this browser.</div>
            <div style={{ marginTop: 12 }}>
              <button
                style={btnQuiet}
                data-testid="advanced-keep"
                disabled={!!busy || info.persistent || status.persistent}
                onClick={() =>
                  run("keep", async () => {
                    await d().persist();
                    return "Kept in this browser only.";
                  })
                }
              >
                {info.persistent || status.persistent ? "Kept in this browser" : "Keep in this browser"}
              </button>
            </div>
          </section>

          {/* devices: D-CU-0-13 — both entry points, one code, minted by the device that will receive the material */}
          <section style={card} data-testid="devices">
            <div style={{ fontWeight: 700 }}>Devices</div>
            <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr", marginTop: 12 }}>
              <div>
                <div style={muted}>Link this device to an identity you hold elsewhere.</div>
                {linkCode ? (
                  <>
                    <div data-testid="link-code" style={big}>{linkCode}</div>
                    <div style={muted}>
                      fingerprint <span data-testid="link-fingerprint" style={{ fontFamily: "monospace", color: "#e7e9ea" }}>{linkFingerprint}</span>
                    </div>
                    <div style={muted}>Waiting for the other device… it must show this same fingerprint before you approve there.</div>
                  </>
                ) : (
                  <button style={{ ...btnQuiet, marginTop: 8 }} disabled={!!busy} onClick={startLink}>
                    Show a link code
                  </button>
                )}
              </div>
              <div>
                <div style={muted}>Add a device: enter the code and the fingerprint it shows.</div>
                <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                  <input placeholder="code" value={approveCode} onChange={(e) => setApproveCode(e.target.value.toUpperCase())} style={{ ...mono, width: 140 }} />
                  <input placeholder="fingerprint" value={approveFingerprint} onChange={(e) => setApproveFingerprint(e.target.value.toUpperCase())} style={{ ...mono, width: 110 }} />
                  <button style={btnQuiet} disabled={approveCode.trim().length < 6 || !FP.test(approveFingerprint.trim()) || !!busy || !saved} onClick={approveDevice} title={saved ? "" : "save this identity first"}>
                    Approve
                  </button>
                </div>
              </div>
            </div>
          </section>

          {/* linked accounts: D-CU-0-14 — link, not merge */}
          <section style={card} data-testid="linked-accounts">
            <div style={{ fontWeight: 700 }}>Linked accounts</div>
            <div style={muted}>These accounts are linked, not merged — reputation does not combine.</div>
            {linkedRoots.length > 0 && (
              <ul style={{ margin: "8px 0", paddingLeft: 18 }} data-testid="linked-list">
                {linkedRoots.map((r) => (
                  <li key={r.grantId} style={{ fontSize: 13 }}>
                    <code>{r.rootId}</code> · {r.personas.map((p) => "@" + p.handle).join(", ")}{" "}
                    <button style={{ ...btnQuiet, padding: "2px 10px", fontSize: 12, marginLeft: 8 }} disabled={!!busy} onClick={() => unlinkRoot(r.grantId)}>
                      Unlink
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div style={{ display: "grid", gap: 12, gridTemplateColumns: "1fr 1fr", marginTop: 12 }}>
              <div>
                <div style={muted}>Link another account you hold on a different device.</div>
                {rootCode ? (
                  <>
                    <div data-testid="rootlink-code" style={big}>{rootCode}</div>
                    {rootAnswered ? (
                      <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap", alignItems: "center" }}>
                        <div style={muted}>The other device now shows a fingerprint. Type it here to complete the link:</div>
                        <input placeholder="fingerprint shown there" value={rootConfirm} onChange={(e) => setRootConfirm(e.target.value.toUpperCase())} style={{ ...mono, width: 170 }} />
                        <button style={btnQuiet} data-testid="rootlink-complete" disabled={!FP.test(rootConfirm.trim()) || !!busy} onClick={completeRoot}>
                          Complete link
                        </button>
                      </div>
                    ) : (
                      <div style={muted}>Waiting for the other account…</div>
                    )}
                  </>
                ) : (
                  <button style={{ ...btnQuiet, marginTop: 8 }} disabled={!!busy || !saved} onClick={proposeRoot} title={saved ? "" : "save this identity first"}>
                    Propose a link
                  </button>
                )}
              </div>
              <div>
                <div style={muted}>Answer a link: enter the code the other account shows.</div>
                {rootFingerprint ? (
                  <div style={{ marginTop: 8 }}>
                    <div style={muted}>Read this fingerprint to the other person:</div>
                    <div data-testid="rootlink-fingerprint" style={big}>{rootFingerprint}</div>
                    <div style={muted}>Waiting for them to confirm…</div>
                  </div>
                ) : (
                  <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                    <input placeholder="link code" value={rootAnswerCode} onChange={(e) => setRootAnswerCode(e.target.value.toUpperCase())} style={{ ...mono, width: 140 }} />
                    <button style={btnQuiet} disabled={rootAnswerCode.trim().length < 6 || !!busy || !saved} onClick={answerRoot}>
                      Link
                    </button>
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* settings: methods, the 24 words (the ADVANCED backup), restore, forget */}
          <section style={card} data-testid="settings">
            <div style={{ fontWeight: 700 }}>Ways in</div>
            {status.methodsUnknown ? (
              <div style={muted}>Could not be read just now.</div>
            ) : status.methods.length === 0 ? (
              <div style={muted}>None yet.</div>
            ) : (
              <ul style={{ margin: "8px 0", paddingLeft: 18 }}>
                {status.methods.map((m) => (
                  <li key={m.method_id} style={{ fontSize: 13 }}>
                    <code>{m.kind}</code> <span style={muted}>{m.method_id.slice(0, 28)}…</span>
                  </li>
                ))}
              </ul>
            )}
            <div style={{ marginTop: 12, display: "grid", gap: 8 }}>
              <div style={{ fontWeight: 700 }}>The 24 words</div>
              <div style={muted}>A backup you write down. You do not need it if you saved with a passkey.</div>
              <label style={{ ...muted, display: "flex", gap: 8, alignItems: "center" }}>
                <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />I understand these words are my only backup: anyone who has them controls this identity.
              </label>
              <div style={{ display: "flex", gap: 8 }}>
                <button style={btnQuiet} disabled={!ack || !!busy} onClick={() => run("phrase", async () => void setPhrase(await d().custody.exportPhrase()))}>
                  Show my 24 words
                </button>
                <button style={btnQuiet} disabled={!!busy} onClick={() => run("forget", async () => { await d().wipe(); location.reload(); })}>
                  Forget this identity on this device
                </button>
              </div>
              {phrase && (
                <textarea data-testid="phrase" readOnly value={phrase} rows={3} style={{ width: "100%", ...field, padding: 8 }} />
              )}
              <textarea placeholder="Restore from 24 words" value={importWords} onChange={(e) => setImportWords(e.target.value)} rows={2} style={{ width: "100%", ...field, padding: 8 }} />
              <div>
                <button style={btnQuiet} disabled={importWords.trim().split(/\s+/).length !== 24 || !!busy} onClick={() => run("import", async () => { await d().custody.importPhrase(importWords); setImportWords(""); return "Restored from your 24 words."; })}>
                  Restore
                </button>
              </div>
            </div>
          </section>
        </div>
      </details>
      <SaveMoment
        onSaved={(sentence) => {
          setNote(sentence);
          void refresh();
        }}
      />
      {busy && <div style={muted}>Working ({busy})…</div>}
    </main>
  );
}

/**
 * PERSONA LAUNCH P4 — "Your private address for rings" and "Rings you are in", for the identity in THIS browser. The
 * address comes off this identity's own keys (never typed, never a seed phrase); a linked device cannot hold one yet and
 * says so. What was received is read on the background check and kept in memory only.
 */
function RingsOnThisDevice() {
  const [addresses, setAddresses] = useState<RingAddress[] | null>(null);
  const [forgotten, setForgotten] = useState<{ addrId: string; label: string | null }[]>([]);
  const [status, setStatus] = useState<RingsStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const api = () => window.__layersDevice?.rings;
  const load = useCallback(async () => {
    const r = api();
    if (!r) return;
    try {
      const [a, st, f] = await Promise.all([r.listAddresses(), r.status(), r.listForgottenAddresses ? r.listForgottenAddresses() : Promise.resolve([])]);
      setAddresses(a);
      setStatus(st);
      setForgotten(f);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <section style={card} data-testid="device-rings-address">
        <div style={{ fontWeight: 700 }}>Your private address for rings</div>
        <div style={muted}>Give it to someone who wants to put you in one of their rings. Send it over Signal or in person: whoever holds it can write notes to you.</div>
        {error && (
          <div data-testid="device-rings-error" style={{ ...muted, color: "#f4212e", marginTop: 8 }}>
            {error}
          </div>
        )}
        {addresses === null && !error && <div style={muted}>Reading…</div>}
        {(addresses ?? []).map((a) => (
          <div key={a.addrId} style={{ marginTop: 10 }} data-testid="device-rings-address-row">
            <code data-testid="device-rings-address-text" style={{ wordBreak: "break-all", fontSize: 12 }}>
              {a.address}
            </code>
            <div style={{ display: "flex", gap: 8, marginTop: 6, alignItems: "center" }}>
              <svg viewBox={`0 0 ${a.qr.viewBox} ${a.qr.viewBox}`} width={110} height={110} aria-label="QR code of this address">
                <rect width="100%" height="100%" fill="#fff" />
                <path d={a.qr.path} fill="#000" />
              </svg>
              <button style={btnQuiet} onClick={() => void navigator.clipboard?.writeText(a.address)}>
                Copy
              </button>
              <button
                style={btnQuiet}
                data-testid="device-rings-address-forget"
                disabled={busy}
                onClick={() => {
                  // PERSONA LAUNCH P4 (UX-R4): confirmed, and a hide — "Use it again" below brings it back
                  if (!window.confirm("Forget this address? Rings that hold it stop reaching you. You can use it again later from this page.")) return;
                  void act(() => api()!.forgetAddress(a.addrId));
                }}
              >
                Forget it
              </button>
            </div>
          </div>
        ))}
        <button style={{ ...btnQuiet, marginTop: 10 }} data-testid="device-rings-address-create" disabled={busy} onClick={() => void act(() => api()!.createAddress())}>
          Make a private address
        </button>
        {forgotten.length > 0 && (
          <div data-testid="device-rings-forgotten" style={{ marginTop: 12 }}>
            <div style={{ ...muted, fontWeight: 700 }}>Forgotten addresses</div>
            {forgotten.map((f) => (
              <div key={f.addrId} style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6, fontSize: 13 }}>
                <span>
                  {f.label ?? "Address"} <code>{f.addrId.slice(0, 8)}</code>
                </span>
                <button style={btnQuiet} data-testid="device-rings-address-restore" disabled={busy} onClick={() => void act(() => api()!.restoreAddress(f.addrId))}>
                  Use it again
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
      <section style={card} data-testid="device-rings-in">
        <div style={{ fontWeight: 700 }}>Rings you are in</div>
        <div style={muted}>
          {status === null
            ? "Reading…"
            : status.lastTickOk === null
              ? "Not checked yet — the background check runs every few minutes."
              : status.lastTickOk
                ? "Last checked " + new Date(status.lastTickAt ?? 0).toLocaleString() + "."
                : "The last check didn't work (" + (status.lastFetchError ?? "no answer") + "); what you had is hidden until the next one works."}
        </div>
        {(status?.rings ?? []).map((r, i) => (
          <div key={i} data-testid="device-rings-in-row" data-state={r.state} style={{ fontSize: 13, marginTop: 6 }}>
            <b>{r.label}</b>
            {r.root ? " (@" + r.root + ")" : ""} shared {r.personas.map((p) => "@" + p.handle + (p.depth === "posts" ? " and its anonymous posts" : "")).join(", ") || "nothing yet"}
          </div>
        ))}
      </section>
    </>
  );
}
