// PURE mapping from Neynar's wire format to the app's Cast/User shapes.
//
// Plain JS with no imports, no fetch and no server-only, for one reason: the
// Gate 4 acceptance suite runs these exact functions against recorded real
// responses. A test that re-implemented the mapping would verify a copy, and
// the copy is precisely what drifts.
//
// Every mapping below was checked against fixtures/neynar/*.json — real
// captured responses — and against the published contract in
// notes/runbooks/NEYNAR-CONTRACT.md. Where the wire format contradicts what a from-memory
// integration assumes, the contradiction is the comment.

/** Avatar-less accounts exist on the live network (the contract flags
 * pfp_url as nullable). "" fed into <img src=""> renders a broken-image
 * glyph AND refetches the document at seven render sites — so absence maps
 * to a self-contained neutral placeholder, not an empty string. */
export const FALLBACK_PFP =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" fill="#cfd9de"/><circle cx="20" cy="15" r="7" fill="#8b98a5"/><ellipse cx="20" cy="34" rx="12" ry="9" fill="#8b98a5"/></svg>'
  );

/**
 * display_name and pfp_url are BOTH nullable in the live schema. username
 * always exists, so it is the fallback.
 */
export function mapUser(u) {
  u = u ?? {};
  return {
    fid: u.fid,
    username: u.username ?? String(u.fid ?? ""),
    displayName: u.display_name || u.username || String(u.fid ?? ""),
    pfpUrl: u.pfp_url || FALLBACK_PFP,
    bio: u.profile?.bio?.text ?? "",
    bannerUrl: u.profile?.banner?.url,
    followerCount: u.follower_count ?? 0,
    followingCount: u.following_count ?? 0,
    // `power_badge` does NOT exist on the live user object. It was the old
    // signal; reading it silently marks every real account unverified. The
    // live equivalents are a Pro subscription and platform-verified accounts.
    verified: Boolean(u.verified_accounts?.length) || u.pro?.status === "subscribed",
  };
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function mapEmbeds(embeds) {
  const out = [];
  for (const e of embeds ?? []) {
    if (!e) continue;
    // QUOTED CASTS — one level deep ONLY (the quoted cast's own embeds are
    // stripped, which also makes recursion structurally impossible). A
    // dehydrated quote (hash + fid, no text/timestamp — the shape a quote
    // of a DELETED cast arrives in; three exist in the fixtures) maps to
    // nothing rather than an empty husk.
    if (e.cast || e.cast_id) {
      if (e.cast && (e.cast.text != null || e.cast.timestamp != null)) {
        out.push({ type: "quote", quote: mapCast({ ...e.cast, embeds: [] }) });
      }
      continue;
    }
    if (!e.url) continue;
    // IMAGES: real embeds routinely arrive with UNRESOLVED metadata
    // ({_status:"PENDING"} — zero content_type hits across the entire
    // recorded corpus), so metadata alone cannot be the classifier or
    // nearly every live photo renders text-only. URL shape decides when
    // metadata hasn't.
    const looksImage =
      e.metadata?.content_type?.startsWith("image/") ||
      Boolean(e.metadata?.image) ||
      /\.(png|jpe?g|gif|webp|avif)([?#]|$)/i.test(e.url) ||
      /(^|\.)imagedelivery\.net$/i.test(hostOf(e.url)) ||
      /(^|\.)imgur\.com$/i.test(hostOf(e.url));
    if (looksImage) {
      out.push({ type: "image", url: e.url });
    } else if (e.metadata?.html) {
      const meta = e.metadata.html;
      out.push({
        type: "link",
        url: e.url,
        domain: hostOf(e.url) || e.url,
        title: meta.ogTitle || e.url,
        description: meta.ogDescription,
        image: meta.ogImage?.[0]?.url,
      });
    } else {
      // bare URL, metadata unresolved: a minimal link card beats absence
      // (the cast plainly references something) and beats a broken image
      out.push({ type: "link", url: e.url, domain: hostOf(e.url) || e.url, title: e.url });
    }
    // Frames and videos stay deliberately unmapped rather than mapped
    // badly: a frame rendered as a broken image is worse than absent.
  }
  return out;
}

/** Longer than this gets clamped with "Show more", as X does. */
export const CLAMP_CHARS = 480;

export function mapCast(c) {
  c = c ?? {};
  const parsed = Date.parse(c.timestamp);
  return {
    hash: c.hash,
    author: mapUser(c.author),
    text: c.text ?? "",
    // timestamp is an ISO-8601 STRING, not epoch ms. Assigning it raw yields
    // NaN in every relative-time label on the page. A malformed value falls
    // back to now rather than propagating NaN downstream.
    timestamp: Number.isFinite(parsed) ? parsed : Date.now(),
    // reactions and replies are OBJECTS. Assigning them raw renders
    // "[object Object]" where a count belongs.
    replies: c.replies?.count ?? 0,
    likes: c.reactions?.likes_count ?? 0,
    recasts: c.reactions?.recasts_count ?? 0,
    // FARCASTER HAS NO IMPRESSION METRIC. No live cast carries a `views` key.
    // Emitting 0 would print a fabricated number on every real post — the one
    // figure on screen that is not true. Absent means the UI omits it.
    views: undefined,
    embeds: mapEmbeds(c.embeds),
    // Real casts reach 1500+ characters against a seed corpus of short posts.
    truncate: (c.text?.length ?? 0) > CLAMP_CHARS,
    // parent_author carries ONLY a fid on the wire (never a username), so
    // replyingTo — a display string — stays unset for live replies rather
    // than rendering "Replying to " followed by nothing. parentHash is the
    // reply FACT; hideReplies and thread logic key on it.
    replyingTo: c.parent_author?.username ?? undefined,
    parentHash: c.parent_hash ?? undefined,
    threadCount: undefined,
    // provenance: this cast came off the live wire. Fixture casts never
    // carry it, so per-cast checks (persona heuristics) stay exact even
    // when fixture content serves as a fallback under live config.
    live: true,
  };
}

export function mapChannel(c) {
  return {
    id: c.id,
    name: c.name ?? c.id,
    description: c.description ?? "",
    imageUrl: c.image_url ?? null,
    followerCount: c.follower_count ?? 0,
  };
}
