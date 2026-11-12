"use client";
// ZK PASS 1 — the /settings/zk body: the privacy label, the rep binding, the commitment, the anonymous channel,
// the computed privacy conditions and the ceremony pin.
//
// PROD-LIVE (D-CU-0-4): this used to be computed in the server page — zkStatus() and privacyConditions() both
// derive this root's commitment from the KEYSTORE, and a public deployment's server holds no keystore, so the page
// 500'd ("keystore: refusing to ... on a production server"). The body is now an island:
//   • on the RIG the server computes all four reads exactly as before and hands them over as `initial` — the DOM
//     below is the page's former DOM, unchanged, and nothing is fetched;
//   • on a PUBLIC deployment `initial` is null and the island reads the browser device, which answers /api/zk
//     in-process: GET /api/zk is zkStatus() (and carries the computed verdict as status.privacy), POST
//     {action:"gateStatus"} names the device's rep binding, and POST {action:"privacyConditions"} is read only if
//     the status came back without a verdict. Every value shown is the VISITOR's device's, never the server's.
// NEVER FAIL OPEN: a failed read renders an error with a Retry (a re-read, never a full page load — that would wipe
// an unsaved identity and mint a new one), never a half-empty status presented as the truth.
import type { ZkStatus } from "@/lib/zk/status";
import type { PrivacyVerdict } from "@/lib/zk/privacy";
import { useApiJson } from "@/lib/client/useApiJson";
import { ErrorNote, LoadingRows, Row, SettingsGroup } from "@/components/settings/Chrome";
import { PrivacyLabelView } from "./PrivacyLabelView";
import { toZkStatusView, type ZkStatusView } from "./zkStatusView";

export interface ZkSettingsData {
  /** only the fields the page renders (zkStatusView.ts) — never the whole status */
  status: ZkStatusView;
  /** the verdict the conditions list shows */
  conditions: PrivacyVerdict;
  /** the verdict the label shows (on the rig computed by the label's own call, as the server label always did) */
  label: PrivacyVerdict;
  rep: string;
}

const POST_JSON = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export function ZkStatusPane({ initial }: { initial: ZkSettingsData | null }) {
  const server = initial !== null;
  // PROD-LIVE: three device reads, each its own hook so one failure is named and retried on its own
  const st = useApiJson<{ status: ZkStatus }>(server ? null : "/api/zk");
  const gs = useApiJson<{ rep: string }>(server ? null : "/api/zk?view=rep", { init: POST_JSON({ action: "gateStatus" }) });
  const needVerdict = !server && !!st.data && !st.data.status?.privacy;
  const pv = useApiJson<PrivacyVerdict>(needVerdict ? "/api/zk?view=privacy" : null, { init: POST_JSON({ action: "privacyConditions" }) });

  let data: ZkSettingsData | null = initial;
  if (!server) {
    const verdict = st.data?.status?.privacy ?? pv.data ?? null;
    if (st.data?.status && gs.data && typeof gs.data.rep === "string" && verdict) {
      data = { status: toZkStatusView(st.data.status), conditions: verdict, label: verdict, rep: gs.data.rep };
    }
  }

  if (!data) {
    const err = st.error ?? gs.error ?? pv.error;
    if (err) {
      return (
        <ErrorNote
          error={`Couldn't read this device's zk status. ${err}`}
          onRetry={() => {
            if (st.error) st.reload();
            if (gs.error) gs.reload();
            if (pv.error) pv.reload();
          }}
        />
      );
    }
    return <LoadingRows count={6} />;
  }

  const { status: s, conditions: v, label, rep } = data;
  return (
    <>
      <PrivacyLabelView verdict={label} />
      {/* PROD-LIVE (never fail open): when the device could not reach the validator, "not registered" below means
          "unknown", and says so. (The rig page never rendered this; it stays off there.) */}
      {!server && s.error ? (
        <ErrorNote error={`This device could not read the validator — registration, placement and epoch are unknown. ${s.error}`} onRetry={st.reload} />
      ) : null}
      <SettingsGroup
        title="What this is"
        note="A parallel identity derived from your seed, registered as one opaque commitment per root into the validator's public trees. Personas prove membership anonymously over a separate channel. The label above is computed from the six conditions below — nothing about privacy is hardcoded."
      >
        <Row label="Reputation binding" sub={rep === "zk" ? "proof-mediated (what each persona proved this epoch)" : "legacy — the gate is not active"} right={<span className="text-[13px] font-bold">{rep}</span>} testid="zk-rep-binding" />
        <Row label="Universe" sub={s.mode === "live" ? "stock Semaphore v4 proofs" : "fixture transport (plumbing only, no soundness)"} right={<span className="text-[13px] font-bold">{s.mode}</span>} testid="zk-mode" />
      </SettingsGroup>
      <SettingsGroup title="Your commitment">
        <Row label="C_root" sub={s.commitment.slice(0, 18) + "…"} right={<span className="text-[13px] text-x-sec">{s.derivedTwiceIdentical ? "deterministic" : "NOT deterministic"}</span>} testid="zk-commitment" />
        <Row
          label="Registration"
          sub={s.registration?.registered ? `registered in epoch ${s.registration.epochRegistered}, a leaf from epoch ${s.registration.activeFromEpoch}` : "not registered — the validator has no commitment for this root"}
          right={<span className="text-[13px] font-bold">{s.registration?.registered ? (s.registration.activeNow ? "active" : "pending epoch") : "no"}</span>}
          testid="zk-registration"
        />
        <Row label="Signed placement" sub="the validator's signature over your leaf, verified locally" right={<span className="text-[13px] font-bold">{s.placement?.verified ? "verified" : s.placement?.found ? "INVALID" : "none"}</span>} testid="zk-placement" />
        <Row label="Epoch" sub={`trees re-issue every epoch; floor ${s.floor}`} right={<span className="text-[13px] font-bold">{s.epoch ?? "—"}</span>} />
      </SettingsGroup>
      <SettingsGroup title="Anonymous channel">
        <Row label="Relay" sub={s.relay.kind === "direct" ? "direct — not private" : `${s.relay.kind}${s.relay.thirdPartyAttested ? " (attested third party)" : " (NOT attested)"}`} right={<span className="text-[13px] font-bold">{s.relay.kind}</span>} testid="zk-relay" />
        <Row label="Proof of work" sub="stateless, bound to the body bytes" right={<span className="text-[13px] font-bold">{s.pow.bits} bits</span>} />
        <Row label="Submission jitter" sub="proofs are precomputed at idle and sent at a random time" right={<span className="text-[13px] font-bold">{Math.round(s.jitter.minMs / 1000)}–{Math.round(s.jitter.maxMs / 1000)} s</span>} />
        <Row label="Queue" sub={`${s.queue.queued} queued · ${s.queue.sent} sent · ${s.queue.refused} refused`} right={<span className="text-[13px] text-x-sec">{s.queue.nextDueInMs !== null ? `next in ${Math.max(0, Math.round(s.queue.nextDueInMs / 1000))} s` : "idle"}</span>} testid="zk-queue" />
      </SettingsGroup>
      <SettingsGroup title="Privacy conditions" note={`Computed by this process at ${new Date(v.computedAt).toISOString()} — every condition is checked when this page renders; none is a stored claim.`}>
        {v.conditions.map((c) => (
          <Row key={c.key} label={`${c.id}. ${c.key}`} sub={c.detail} right={<span className={`text-[13px] font-bold ${c.ok ? "text-[#00ba7c]" : "text-[#f4212e]"}`}>{c.ok ? "holds" : "fails"}</span>} testid={`zk-condition-${c.key}`} />
        ))}
      </SettingsGroup>
      <SettingsGroup title="Ceremony" note="The proving artifacts are pinned to the ceremony's own published outputs (research/zk-ceremony-verification.json).">
        <Row label={s.ceremony.name} sub={`finalized ${s.ceremony.finalized} · ${s.ceremony.contributionsDepth20} contributions (depth 20)`} right={<span className="text-[13px] font-bold">{s.vkeyPin.ok ? "vkey pinned" : !server && /unreadable/.test(s.vkeyPin.reason ?? "") ? "not checked on this device" : "PIN MISMATCH"}</span>} testid="zk-ceremony" />
      </SettingsGroup>
    </>
  );
}
