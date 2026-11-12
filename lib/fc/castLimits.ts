// BUILD A review (PUB-2) — how long a Farcaster cast may be. The protocol's CastAdd text is at most 320 BYTES of UTF-8
// (docs.neynar.com farcaster/developers/guides/writing/messages: "Text can be up to 320 bytes long"; longer casts are a
// Farcaster Pro feature Totem does not use). An emoji is up to four bytes, so this is a byte count, never a character
// count. Shared by the Composer's counter and the cast route's check, so the number on screen and the refusal never
// disagree. Pure, no imports: it ships in the browser bundle too.
export const FC_CAST_MAX_BYTES = 320;

/** the UTF-8 byte length Farcaster counts */
export function castBytes(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** the refusal sentence for a cast over the limit (null when it fits) */
export function castTooLong(text: string): string | null {
  const n = castBytes(text);
  if (n <= FC_CAST_MAX_BYTES) return null;
  return `Too long for Farcaster: ${n} of ${FC_CAST_MAX_BYTES} bytes (an emoji counts as up to 4). Nothing was posted — shorten it and post again.`;
}
