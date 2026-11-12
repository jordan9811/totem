"use client";
// PERSONA LAUNCH P4 — Settings › Rings (plan §2.4). Up to 16 named rings; each holds people (a private address they
// sent you, or a link you send them) and, per persona, how deep it sees: "who" (that @persona is you) or "who and
// posts" (also which anonymous posts it wrote). Revoking a person takes effect for posts made after it, and deletes
// their note at once. Below: your own private address for other people's rings, and the rings you are in.
//
// Honest marks: everything here is TEST DATA until the owner has seen a ring work on a deployed site (the status row
// lives in lib/status/features.ts). Plain words throughout; no seed phrase anywhere.
//
// Wave 2 review fixes: members never see the ring's own name (UX-R1, lib/rings/outbound.ts NEUTRAL_SHARED_BY); on the
// owner service there is no /d link and no delivery promise, one plain line instead (UX-R2); your own address says its
// holder can WRITE to you (UX-R3); "Forget it" and "Remove" ask first, and forgetting hides — "Use it again" restores
// (UX-R4); a change refused because another of your devices changed your rings first reloads the pane (LP-2).
//
// PERSONA LAUNCH GO-LIVE (UXH-9): Remove and Delete ring HIDE instead of erasing — "Recently removed" lists what was
// hidden and Restore brings it back (lib/rings/outbound.ts restoreMember / restoreRing). A restore is a join: the
// people coming back see what you post from now on, never what you posted while they were removed, and the pane says
// so in those words beside the buttons.
import { useCallback, useEffect, useState } from "react";
import { useApiJson, readApiJson } from "@/lib/client/useApiJson";
import { ErrorNote, LoadingRows, SettingsGroup } from "./Chrome";

type Depth = "name" | "posts";
interface PaneState {
  testData: true;
  /** UX-R2: this page runs on the owner service — rings made here reach only devices that read its own server */
  ownerService: boolean;
  ownerServiceLine: string;
  rings: {
    id: string;
    label: string;
    shareAs: string | null;
    createdAt: number;
    personas: { personaId: string; handle: string; name: string; depth: Depth }[];
    members: { id: string; kind: "address" | "link"; label: string | null; addedAt: number; ref: string }[];
  }[];
  /** UXH-9: what Remove and Delete ring hid, newest first */
  recentlyRemoved: {
    rings: { id: string; label: string; hiddenAt: number; people: number }[];
    members: { ringId: string; ringLabel: string; id: string; kind: "address" | "link"; label: string | null; ref: string; hiddenAt: number }[];
  };
  admissible: { personaId: string; handle: string; name: string; hasAccount: boolean }[];
  limits: { rings: number; membersPerRing: number; ringRecords?: number; memberRecordsPerRing?: number };
  publish: { lastPublishAt: number | null; nextDueAt: number | null; dirty: boolean; lastError: string | null; lastRows: number; leaseHours: number; liveRows: number };
  addresses: { ref: string; label: string | null; createdAt: number }[];
  forgottenAddresses: { ref: string; label: string | null; forgottenAt: number }[];
  received: {
    lastTickAt: number | null;
    lastTickOk: boolean | null;
    lastFetchError: string | null;
    rings: { label: string; root: string | null; personas: { handle: string; depth: string }[]; expiresAt: number; state: "shown" | "unknown" }[];
  };
}
interface FullAddress {
  addrId: string;
  address: string;
  label: string | null;
  createdAt: number;
  qr: { viewBox: number; path: string };
}

const btn = "h-8 rounded-full bg-x-black-btn px-4 text-[14px] font-bold text-white disabled:opacity-50";
const btnQuiet = "h-8 rounded-full border border-[#cfd9de] px-3 text-[13px] font-bold disabled:opacity-50";
const input = "h-9 min-w-0 flex-1 rounded-md border border-[#cfd9de] px-2 text-[15px]";
const when = (t: number | null) => (t ? new Date(t).toLocaleString() : "not yet");

/** beside a /d LINK only: the link is a key to this ring's note */
export const SEND_PRIVATELY = "Send it over Signal or in person: whoever holds it can read what you share with this ring.";
/** UX-R3: beside YOUR OWN address — holding it lets someone write notes to you, not read anything (the device page's
 *  sentence, components/device/DeviceApp.tsx) */
export const ADDRESS_PRIVATELY = "Send it over Signal or in person: whoever holds it can write notes to you.";
/** PERSONA LAUNCH GO-LIVE (UXH-9): Remove and Delete ring hide, never erase — the confirmations say where it goes */
export const REMOVED_KEPT = "You can bring them back from Recently removed below.";
export const DELETED_KEPT = "You can restore it from Recently removed below.";
/** PERSONA LAUNCH GO-LIVE (UXH-9): beside Restore — a restore is a join, so the removed window stays closed */
export const RESTORE_MEMBER_LINE = "They will see posts from now on, not the ones made while they were removed.";
export const RESTORE_RING_LINE = "A restored ring comes back with its name, what it sees and the people who were in it. They will see posts from now on, not the ones made while it was deleted.";
/** PERSONA LAUNCH wave 3 (L6, A-RING-REVOKE-SIBLING-WINDOW): Remove asks first, and says when the removal reaches the
 *  root's OTHER devices — they keep sealing notes under the old key until their next check (SECURITY-POSTURE §24) */
export const revokeConfirm = (who: string, ring: string) =>
  `Remove ${who} from “${ring}”? They stop seeing what you post from now on; what they already saw stays with them. Your other devices stop using the old key at their next check, within about 25 minutes. ${REMOVED_KEPT}`;
/** PERSONA LAUNCH wave 3 (UXH-10, final verify): Delete asks first, and the line after it says what really happened —
 *  "were deleted" only when the drop's delete landed; a failed one is retried by every later publish (lib/rings/publisher.ts
 *  deletes every live row no ring keeps) and the notes run out by themselves at their lease */
export const deleteRingConfirm = (label: string) =>
  `Delete the ring "${label}"? Everyone in it stops seeing your personas from your next posts on, and their notes are deleted. Your other devices stop using the old key at their next check, within about 25 minutes. ${DELETED_KEPT}`;
export const deleteRingNote = (deleteError: string | null, leaseHours: number) =>
  deleteError
    ? `Deleted. Everyone in it stops seeing your personas from your next posts on. Their notes couldn't be deleted yet (${deleteError}); it is retried and they run out by themselves within ${leaseHours} hours.`
    : "Deleted. Everyone in it stops seeing your personas from your next posts on, and their notes were deleted.";
/** UX-R4: forgetting hides an address, it never deletes it */
export const FORGET_CONFIRM = "Forget this address? Rings that hold it stop reaching you. You can use it again later from this page.";

async function post(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  return readApiJson<Record<string, unknown>>("/api/rings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

export function RingsPane() {
  const state = useApiJson<PaneState>("/api/rings");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [newLabel, setNewLabel] = useState("");
  const [paste, setPaste] = useState<Record<string, string>>({});
  const [memberName, setMemberName] = useState<Record<string, string>>({});
  const [link, setLink] = useState<{ ringId: string; url: string } | null>(null);
  const [editing, setEditing] = useState<{ ringId: string; label: string; shareAs: string } | null>(null);
  const [addresses, setAddresses] = useState<FullAddress[] | null>(null);
  const [forgotten, setForgotten] = useState<{ addrId: string; label: string | null; forgottenAt: number }[]>([]);

  const run = useCallback(
    async (label: string, fn: () => Promise<unknown>) => {
      setBusy(label);
      setError(null);
      setNote(null);
      try {
        await fn();
      } catch (e) {
        setError((e as Error).message);
      } finally {
        // reloaded either way: a change refused because another of your devices changed your rings first (409) has
        // just loaded the latest version, and the pane should show it
        state.reload();
        setBusy(null);
      }
    },
    [state]
  );

  const loadAddresses = useCallback(async () => {
    try {
      const j = await post({ action: "listAddresses" });
      setAddresses((j.addresses as FullAddress[]) ?? []);
      const f = await post({ action: "listForgottenAddresses" });
      setForgotten((f.forgotten as { addrId: string; label: string | null; forgottenAt: number }[]) ?? []);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void loadAddresses();
  }, [loadAddresses]);

  if (state.error) return <ErrorNote error={`Couldn't read your rings (${state.error}).`} onRetry={state.reload} />;
  const s = state.data;
  if (!s) return <LoadingRows count={3} />;

  return (
    <div data-testid="rings-pane">
      <p data-testid="rings-test-data" className="mx-4 mt-3 rounded-2xl border border-[#cfd9de] bg-[#f7f9f9] p-3 text-[13px] leading-4 text-x-sec">
        <span className="font-bold text-x-text">Test data.</span> Rings are built and tested on a local copy of Totem; nobody has used one on the live site yet.
        A ring sees only what you choose here. Nobody else, and no other app, can tell.
      </p>
      <ErrorNote error={error} />
      {note && (
        <p data-testid="rings-note" role="status" className="mx-4 my-2 text-[13px] text-x-sec">
          {note}
        </p>
      )}

      <SettingsGroup title={`Your rings (${s.rings.length} of ${s.limits.rings})`} note="Each ring is a group of people. For each persona you pick what the ring sees: that it is you, or also which anonymous posts it wrote.">
        {s.rings.length === 0 && <p className="px-4 py-3 text-[15px] text-x-sec">No rings yet.</p>}
        {s.rings.map((r) => (
          <div key={r.id} data-testid="ring-row" data-ring-id={r.id} data-label={r.label} className="border-b border-x-border px-4 py-3 last:border-b-0">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[17px] font-bold leading-5">{r.label}</p>
              <button
                type="button"
                data-testid="ring-delete"
                className={btnQuiet}
                disabled={!!busy}
                onClick={() => {
                  if (!window.confirm(deleteRingConfirm(r.label))) return;
                  void run("delete", async () => {
                    const j = await post({ action: "deleteRing", ringId: r.id });
                    setNote(deleteRingNote(typeof j.deleteError === "string" && j.deleteError ? j.deleteError : null, s.publish.leaseHours));
                  });
                }}
              >
                Delete ring
              </button>
            </div>
            {editing?.ringId === r.id ? (
              <div className="mt-1 flex flex-wrap items-center gap-2">
                {/* UX-R1: true now — members are never sent the ring's own name (lib/rings/outbound.ts NEUTRAL_SHARED_BY) */}
                <input data-testid="ring-rename-label" className={input} value={editing.label} onChange={(e) => setEditing({ ...editing, label: e.target.value })} placeholder="The ring's name (only you see it)" />
                <input data-testid="ring-share-as" className={input} value={editing.shareAs} onChange={(e) => setEditing({ ...editing, shareAs: e.target.value })} placeholder="The name they see you as (optional)" />
                <button
                  type="button"
                  data-testid="ring-rename-save"
                  className={btn}
                  disabled={!!busy || !editing.label.trim()}
                  onClick={() =>
                    void run("rename", async () => {
                      await post({ action: "renameRing", ringId: r.id, label: editing.label.trim(), shareAs: editing.shareAs.trim() });
                      setEditing(null);
                    })
                  }
                >
                  Save
                </button>
                <button type="button" className={btnQuiet} onClick={() => setEditing(null)}>
                  Cancel
                </button>
              </div>
            ) : (
              <p className="text-[13px] text-x-sec">
                They see you as &ldquo;{r.shareAs ?? "your Farcaster name (or “a friend”, if you haven't connected one)"}&rdquo;.{" "}
                <button type="button" data-testid="ring-rename" className="font-bold text-x-blue hover:underline" onClick={() => setEditing({ ringId: r.id, label: r.label, shareAs: r.shareAs ?? "" })}>
                  Change
                </button>
              </p>
            )}

            <div className="mt-2">
              <p className="text-[13px] font-bold uppercase tracking-wide text-x-sec">What this ring sees</p>
              {s.admissible.length === 0 && <p className="text-[13px] text-x-sec">You have no public personas to share yet.</p>}
              {s.admissible.map((p) => {
                const cur = r.personas.find((x) => x.personaId === p.personaId)?.depth ?? "";
                return (
                  <label key={p.personaId} className="mt-1 flex items-center justify-between gap-2 text-[15px]">
                    <span className="min-w-0 truncate">
                      @{p.handle} <span className="text-x-sec">{p.name}</span>
                    </span>
                    <select
                      data-testid={`ring-depth-${p.handle}`}
                      value={cur}
                      disabled={!!busy}
                      className="rounded-md border border-[#cfd9de] px-1 py-0.5 text-[13px]"
                      onChange={(e) => void run("depth", () => post({ action: "setDepth", ringId: r.id, personaId: p.personaId, depth: e.target.value || null }))}
                    >
                      <option value="">Nothing</option>
                      <option value="name">That it&rsquo;s you</option>
                      <option value="posts">That it&rsquo;s you, and its anonymous posts</option>
                    </select>
                  </label>
                );
              })}
            </div>

            <div className="mt-3">
              <p className="text-[13px] font-bold uppercase tracking-wide text-x-sec">
                People ({r.members.length} of {s.limits.membersPerRing})
              </p>
              {r.members.map((m) => (
                <div key={m.id} data-testid="member-row" data-member-id={m.id} data-kind={m.kind} className="mt-1 flex items-center justify-between gap-2 text-[15px]">
                  <span className="min-w-0 truncate">
                    {m.label ?? (m.kind === "link" ? "Someone with a link" : "Someone")} <span className="font-mono text-[12px] text-x-sec">{m.ref}</span>
                  </span>
                  <button
                    type="button"
                    data-testid="member-revoke"
                    className={btnQuiet}
                    disabled={!!busy}
                    onClick={() => {
                      if (!window.confirm(revokeConfirm(m.label ?? "this person", r.label))) return;
                      void run("revoke", async () => {
                        const j = await post({ action: "revokeMember", ringId: r.id, memberId: m.id });
                        setNote(
                          (j.deleted ? "Removed. They won't see anything you post from now on, and their note was deleted." : `Removed. They won't see anything you post from now on. Their old note couldn't be deleted yet (${String(j.deleteError)}); it is retried and runs out by itself within ${s.publish.leaseHours} hours.`) +
                            " They're under Recently removed if you want them back."
                        );
                      });
                    }}
                  >
                    Remove
                  </button>
                </div>
              ))}
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <input
                  data-testid="member-address-input"
                  className={input}
                  placeholder="Paste their private address (LR1.…)"
                  value={paste[r.id] ?? ""}
                  onChange={(e) => setPaste({ ...paste, [r.id]: e.target.value })}
                />
                <input data-testid="member-name-input" className="h-9 w-32 rounded-md border border-[#cfd9de] px-2 text-[15px]" placeholder="Their name (only you see it)" value={memberName[r.id] ?? ""} onChange={(e) => setMemberName({ ...memberName, [r.id]: e.target.value })} />
                <button
                  type="button"
                  data-testid="member-add"
                  className={btn}
                  disabled={!!busy || !(paste[r.id] ?? "").trim()}
                  onClick={() =>
                    void run("add", async () => {
                      const j = await post({ action: "addMember", ringId: r.id, address: (paste[r.id] ?? "").trim(), label: memberName[r.id] ?? "" });
                      setPaste({ ...paste, [r.id]: "" });
                      if (j.restored === true) {
                        // UXH-9: an address removed from this ring before is brought back, not added twice — and said so
                        setNote("Restored: they were in this ring before. " + RESTORE_MEMBER_LINE + " " + (s.ownerService ? s.ownerServiceLine : "They'll see it after your next background check (within a few minutes)."));
                        return;
                      }
                      // UX-R2: on the owner service no delivery is promised — its notes reach only devices reading its server
                      setNote(s.ownerService ? "Added. " + s.ownerServiceLine : "Added. They'll see it after your next background check (within a few minutes).");
                    })
                  }
                >
                  Add
                </button>
                {/* UX-R2: a /d link made on the owner service opens only behind the owner gate — not offered there */}
                {!s.ownerService && (
                  <button
                    type="button"
                    data-testid="member-make-link"
                    className={btnQuiet}
                    disabled={!!busy}
                    onClick={() =>
                      void run("link", async () => {
                        const j = await post({ action: "makeLink", ringId: r.id, label: memberName[r.id] ?? "" });
                        setLink({ ringId: r.id, url: window.location.origin + String(j.link) });
                      })
                    }
                  >
                    Make a link instead
                  </button>
                )}
              </div>
              {s.ownerService && (
                <p data-testid="rings-owner-service-line" className="mt-1 text-[13px] text-x-sec">
                  {s.ownerServiceLine}
                </p>
              )}
              {link?.ringId === r.id && (
                <div data-testid="member-link-box" className="mt-2 rounded-xl border border-[#ffd400] p-2">
                  <p className="text-[13px] text-x-sec">For someone without Totem. This link is shown once — copy it now.</p>
                  <code data-testid="member-link" className="block break-all text-[13px]">
                    {link.url}
                  </code>
                  <p className="mt-1 text-[13px] text-x-sec">{SEND_PRIVATELY}</p>
                  {/* PERSONA LAUNCH wave 3 (UXH-15, final verify): the link is shown once, so copying it is one tap; a browser that
                      refuses the clipboard says so, and the link stays on screen to copy by hand */}
                  <button
                    type="button"
                    data-testid="member-link-copy"
                    className={btnQuiet + " mt-1"}
                    onClick={() => {
                      const url = link.url;
                      void (async () => {
                        try {
                          await navigator.clipboard.writeText(url);
                          setNote("Link copied. It is shown only once, so keep it until you have sent it.");
                        } catch {
                          setNote("This browser didn't allow copying. Select the link above and copy it by hand.");
                        }
                      })();
                    }}
                  >
                    Copy link
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
        {s.rings.length < s.limits.rings && (
          <div className="flex items-center gap-2 px-4 py-3">
            <input data-testid="ring-create-label" className={input} placeholder="Name a new ring (Inner, Close, …)" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} />
            <button
              type="button"
              data-testid="ring-create"
              className={btn}
              disabled={!!busy || !newLabel.trim()}
              onClick={() =>
                void run("create", async () => {
                  await post({ action: "createRing", label: newLabel.trim() });
                  setNewLabel("");
                })
              }
            >
              Create
            </button>
          </div>
        )}
      </SettingsGroup>

      {/* PERSONA LAUNCH GO-LIVE (UXH-9): Settings › Rings › Recently removed — Remove and Delete ring hide, Restore brings back */}
      <SettingsGroup title="Recently removed" note="People you removed and rings you deleted are kept here, not erased, so you can bring them back.">
        <div data-testid="rings-recently-removed" data-rings={s.recentlyRemoved.rings.length} data-members={s.recentlyRemoved.members.length}>
          {s.recentlyRemoved.rings.length === 0 && s.recentlyRemoved.members.length === 0 && <p className="px-4 py-3 text-[15px] text-x-sec">Nothing removed.</p>}
          {s.recentlyRemoved.rings.map((r) => (
            <div key={r.id} data-testid="removed-ring-row" data-ring-id={r.id} data-label={r.label} className="flex items-center justify-between gap-2 border-b border-x-border px-4 py-2 text-[15px]">
              <span className="min-w-0 truncate">
                <span className="font-bold">{r.label}</span>{" "}
                <span className="text-x-sec">
                  · deleted {when(r.hiddenAt)} · {r.people === 1 ? "1 person" : `${r.people} people`}
                </span>
              </span>
              <button
                type="button"
                data-testid="ring-restore"
                className={btnQuiet}
                disabled={!!busy}
                onClick={() =>
                  void run("restoreRing", async () => {
                    const j = await post({ action: "restoreRing", ringId: r.id });
                    setNote(j.restored === false ? "That ring was already back." : "Restored. " + (s.ownerService ? s.ownerServiceLine : "Its people see what you post from now on, after your next background check (within a few minutes)."));
                  })
                }
              >
                Restore ring
              </button>
            </div>
          ))}
          {s.recentlyRemoved.rings.length > 0 && (
            <p data-testid="rings-restore-ring-line" className="px-4 pt-1 text-[13px] text-x-sec">
              {RESTORE_RING_LINE}
            </p>
          )}
          {s.recentlyRemoved.members.map((m) => (
            <div key={m.ringId + "|" + m.id} data-testid="removed-member-row" data-member-id={m.id} data-ring-id={m.ringId} data-kind={m.kind} className="flex items-center justify-between gap-2 border-b border-x-border px-4 py-2 text-[15px]">
              <span className="min-w-0 truncate">
                {m.label ?? (m.kind === "link" ? "Someone with a link" : "Someone")} <span className="font-mono text-[12px] text-x-sec">{m.ref}</span>{" "}
                <span className="text-x-sec">
                  · removed from &ldquo;{m.ringLabel}&rdquo; {when(m.hiddenAt)}
                </span>
              </span>
              <button
                type="button"
                data-testid="member-restore"
                className={btnQuiet}
                disabled={!!busy}
                onClick={() =>
                  void run("restoreMember", async () => {
                    const j = await post({ action: "restoreMember", ringId: m.ringId, memberId: m.id });
                    setNote(j.restored === false ? "They were already back." : "Restored. " + RESTORE_MEMBER_LINE + " " + (s.ownerService ? s.ownerServiceLine : "They'll see it after your next background check (within a few minutes)."));
                  })
                }
              >
                Restore
              </button>
            </div>
          ))}
          {s.recentlyRemoved.members.length > 0 && (
            <p data-testid="rings-restore-line" className="px-4 py-2 text-[13px] text-x-sec">
              {RESTORE_MEMBER_LINE}
            </p>
          )}
        </div>
      </SettingsGroup>

      <SettingsGroup title="Sending" note={`Each person gets a sealed note that lasts ${s.publish.leaseHours} hours and renews itself about every hour while this device is on.`}>
        <p data-testid="rings-publish-line" data-dirty={s.publish.dirty ? "true" : "false"} className="px-4 py-2 text-[15px] leading-5">
          Last sent: {when(s.publish.lastPublishAt)}. {s.publish.dirty ? "Your latest change goes out at the next background check." : s.publish.nextDueAt ? `Next renewal around ${when(s.publish.nextDueAt)}.` : ""}
        </p>
        {s.publish.lastError && (
          <p data-testid="rings-publish-error" className="px-4 pb-2 text-[13px] text-[#f4212e]">
            The last send didn&rsquo;t go through: {s.publish.lastError}. The notes already out stay readable until they run out.
          </p>
        )}
      </SettingsGroup>

      <SettingsGroup title="Your private address" note="Give this to someone who wants to put you in one of their rings. It works only on this device's identity.">
        {addresses === null ? (
          <p className="px-4 py-2 text-[13px] text-x-sec">Reading…</p>
        ) : (
          addresses.map((a) => (
            <div key={a.addrId} data-testid="rings-address-row" className="border-b border-x-border px-4 py-2 last:border-b-0">
              <p className="text-[13px] font-bold">{a.label ?? "Address"}</p>
              <code data-testid="rings-address" className="block break-all text-[12px]">
                {a.address}
              </code>
              <svg viewBox={`0 0 ${a.qr.viewBox} ${a.qr.viewBox}`} width={120} height={120} className="mt-1" aria-label="QR code of this address">
                <rect width="100%" height="100%" fill="#fff" />
                <path d={a.qr.path} fill="#000" />
              </svg>
              <div className="mt-1 flex gap-2">
                <button type="button" className={btnQuiet} onClick={() => void navigator.clipboard?.writeText(a.address)}>
                  Copy
                </button>
                <button
                  type="button"
                  data-testid="rings-address-forget"
                  className={btnQuiet}
                  disabled={!!busy}
                  onClick={() => {
                    // UX-R4: one tap no longer forgets — and forgetting hides (it can be used again below)
                    if (!window.confirm(FORGET_CONFIRM)) return;
                    void run("forget", async () => {
                      await post({ action: "forgetAddress", addrId: a.addrId });
                      await loadAddresses();
                    });
                  }}
                >
                  Forget it
                </button>
              </div>
            </div>
          ))
        )}
        <div className="flex items-center gap-2 px-4 py-2">
          <button
            type="button"
            data-testid="rings-address-create"
            className={btnQuiet}
            disabled={!!busy}
            onClick={() =>
              void run("address", async () => {
                await post({ action: "createAddress" });
                await loadAddresses();
              })
            }
          >
            Make a private address
          </button>
          {/* UX-R3: an address lets its holder WRITE notes to you; on the owner service it reaches only that site (UX-R2) */}
          <span data-testid="rings-address-sentence" className="text-[13px] text-x-sec">
            {s.ownerService ? s.ownerServiceLine : ADDRESS_PRIVATELY}
          </span>
        </div>
        {forgotten.length > 0 && (
          <div data-testid="rings-forgotten" className="px-4 py-2">
            <p className="text-[13px] font-bold uppercase tracking-wide text-x-sec">Forgotten addresses</p>
            {forgotten.map((f) => (
              <div key={f.addrId} data-testid="rings-forgotten-row" className="mt-1 flex items-center justify-between gap-2 text-[15px]">
                <span className="min-w-0 truncate">
                  {f.label ?? "Address"} <span className="font-mono text-[12px] text-x-sec">{f.addrId.slice(0, 8)}</span>
                </span>
                <button
                  type="button"
                  data-testid="rings-address-restore"
                  className={btnQuiet}
                  disabled={!!busy}
                  onClick={() =>
                    void run("restore", async () => {
                      await post({ action: "restoreAddress", addrId: f.addrId });
                      await loadAddresses();
                    })
                  }
                >
                  Use it again
                </button>
              </div>
            ))}
          </div>
        )}
      </SettingsGroup>

      <SettingsGroup title="Rings you are in" note="Read on this device's background check; nothing about it is stored anywhere.">
        <p data-testid="rings-received-line" data-ok={String(s.received.lastTickOk)} className="px-4 py-2 text-[13px] text-x-sec">
          {s.received.lastTickOk === null
            ? "Not checked yet on this device."
            : s.received.lastTickOk
              ? `Last checked ${when(s.received.lastTickAt)}.`
              : `The last check didn't work (${s.received.lastFetchError ?? "no answer"}); what you had is hidden until the next one works.`}
        </p>
        {s.received.rings.map((r, i) => (
          <div key={i} data-testid="rings-received" data-state={r.state} className="border-b border-x-border px-4 py-2 last:border-b-0 text-[15px]">
            <span className="font-bold">{r.label}</span>
            {r.root ? <span className="text-x-sec"> (@{r.root})</span> : null} shared {r.personas.map((p) => "@" + p.handle + (p.depth === "posts" ? " and its anonymous posts" : "")).join(", ") || "nothing yet"}
            {r.state === "unknown" ? <span className="text-x-sec"> · hidden until the next check works</span> : null}
          </div>
        ))}
      </SettingsGroup>
      <div className="h-24" />
    </div>
  );
}
