import "server-only";
// ZK PASS 1 — the jittered submission queue's RECORD SHAPE (Gate 1 owns
// the scheduler; Gate 0 owns the persisted shape so restart-survival can
// assert it round-trips through the vault from day one).
//
// PRECOMPUTE-ONLY, BY DESIGN (C6/F5b): a proof is generated at idle and
// queued with a randomized submission time inside the epoch window,
// decoupled from whatever persona action motivated it. There is no
// prove-at-action path anywhere in the codebase — not behind a flag.
import type { ZkMode } from "./config";

export interface QueuedSubmission {
  id: string;
  mode: ZkMode;
  claimKind: string;
  personaId: string;
  epoch: number;
  /** the proof envelope exactly as it will be submitted (public material);
   * null only for synthetic scheduler-test items, which are never sent */
  envelope: unknown | null;
  /** when it may be sent (randomized inside the epoch window) */
  notBefore: number;
  /** when the motivating action happened — recorded ONLY so the
   * decorrelation test can assert notBefore is not a fixed offset from it;
   * never sent */
  motivatedAt: number;
  createdAt: number;
  /** submission state: a restart resumes `queued`, never re-sends `sent` */
  status: "queued" | "sent" | "refused";
  sentAt: number | null;
  /** the validator's response classification (constant-shape on the wire) */
  outcome: string | null;
  /** ANON REVIEW (R1-01, R3-07): an anon post's REVEAL SECRET rides this same opaque sealed namespace as a record
   * of its own — claimKind "anon-attribution", envelope null, never drained — instead of a namespace whose name
   * announced an anonymous compose on the validator's wire. Persisted only with the queue's own deferred write. */
  /** PERSONA LAUNCH P3: `personaId` — WHICH of this root's personas posted it, so a later reveal (P6: the launch's batch
   * reveal) finds every anon post of one persona. It lives ONLY here, inside the one sealed padded zkQueue record, and in
   * this process's memory: never on the envelope, the signal, the payload, the wire, a validator row or a log. Absent on
   * a record made before P3 (that post belongs to no persona in particular). */
  attribution?: {
    secret: string;
    commitment: string;
    text: string;
    personaId?: string;
    /** PERSONA LAUNCH P3 (PRIV-3): how the post's submission ended, copied here when that submission (its ~2 KiB
     * envelope) is pruned after its window closed (lib/zk/anon/queue.ts pruneSettledAnonItems) — the status line and
     * the replay guard (PRIV-1) read it after the submission is gone. Absent while the submission is still held. */
    settled?: { status: string; outcome: string | null; sentAt: number | null };
  };
}
