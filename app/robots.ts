import type { MetadataRoute } from "next";

// FC-READ — /robots.txt: Disallow everything. The preview is not a site to index, and with live Farcaster reads on,
// a crawler that runs JavaScript would boot a device (minting a validator root) and walk an unbounded graph of live
// profile and thread links, every cache miss spending read credits. Well-behaved crawlers stop here; the relay's
// per-address and global miss buckets plus the daily budget bound the rest. The root layout adds noindex as well.
// A static metadata route: a bare /robots.txt is answered here and never reaches the [handle] page.
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", disallow: "/" } };
}
