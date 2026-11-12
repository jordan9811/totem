import "server-only";
// X ARCHIVE PARSING — the data/*.js format, exactly as X exports it:
// `window.YTD.<name>.part<N> = [ ...records ]`.
//
// PERSONA LAUNCH P2 (BYX G3): the parsers moved to lib/x/archiveParse.ts, which has no "server-only" — the browser
// page parses the archive the person drops in (nothing is uploaded) and the rig's server parses the fixture archive
// with the same code. This module re-exports them so existing server imports keep working. The bookmarks parser is
// gone with the bookmarks lane: no X archive source lists a bookmarks file.
export {
  classifyInterest,
  mergeTweetParts,
  parseAccount,
  parseFollowing,
  parseLikes,
  parseManifestTweetFiles,
  parsePersonalization,
  parsePersonalizationNames,
  parseTweets,
  parseTweetsDetailed,
  parseXDate,
  parseYtd,
  wantedArchivePath,
  X_ID_RE,
  type ArchiveAccount,
  type ArchiveInterest,
  type ArchiveLike,
  type ArchiveTweet,
} from "./archiveParse";
