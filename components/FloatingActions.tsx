"use client";
// The two floating quick-action buttons X pins bottom-right on desktop
// (Grok + chat) — present in every reference screenshot.
//
// PROD-LIVE: they were dead buttons; they now open their pages with a SOFT navigation (router.push). On a public
// deployment a full document load would wipe an unsaved identity, so no internal navigation in the chrome is a plain
// link or a location assignment.
import { useRouter } from "next/navigation";
import { ChatBubble, GrokIcon } from "./icons";

export function FloatingActions() {
  const router = useRouter();
  return (
    <div className="fixed bottom-5 right-5 z-40 hidden flex-col gap-3 lg:flex">
      <button
        aria-label="Grok"
        onClick={() => router.push("/grok")}
        className="flex h-[48px] w-[48px] items-center justify-center rounded-[18px] border border-x-border bg-white text-x-text shadow-[0_1px_6px_rgba(101,119,134,0.25)] hover:bg-x-hover"
      >
        <GrokIcon size={22} />
      </button>
      <button
        aria-label="Chat"
        onClick={() => router.push("/messages")}
        className="flex h-[48px] w-[48px] items-center justify-center rounded-full border border-x-border bg-white text-x-text shadow-[0_1px_6px_rgba(101,119,134,0.25)] hover:bg-x-hover"
      >
        <ChatBubble size={22} />
      </button>
    </div>
  );
}
