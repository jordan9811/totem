import "server-only";
// Local store for private-persona posts. These NEVER enter the public cast
// path — enforcement lives in the cast route via identity.canPublishPublicly,
// and distribution is read-time authorization against the grant set.
//
// Single store, read-time authorization. Deliberately NOT a per-viewer copy:
// if you fan posts out into each viewer's feed store, revoke can never work
// (gated-pass lesson, restated in the mega spec's Gate 3 failure mode).
export interface PrivatePost {
  hash: string;
  authorPersonaId: string;
  text: string;
  createdAt: number;
  /** deleted posts are removed outright — local store makes that true */
  replyToHash: string | null;
  likes: string[];
  bookmarkedBy: string[];
}
