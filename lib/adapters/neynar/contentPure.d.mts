// Types for the pure mapping module. The implementation is plain JS so the
// Gate 4 suite can import and run it directly under node; this file gives
// TypeScript callers the real shapes rather than the widened inference JS
// produces (a literal "image" infers as string, which breaks the Embed union).
import type { Cast, Embed, User } from "@/lib/types";

export declare const CLAMP_CHARS: number;
export declare function mapUser(u: unknown): User;
export declare function mapEmbeds(embeds: unknown): Embed[];
export declare function mapCast(c: unknown): Cast;
export declare function mapChannel(c: unknown): {
  id: string;
  name: string;
  description: string;
  imageUrl: string | null;
  followerCount: number;
};
