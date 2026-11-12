// PUBLIC GO-LIVE (the relay track) — the one line that links anonymous posting to its terms and takedown policy (/terms).
// Shown by the composer next to "Post anonymously" (components/Composer.tsx) and on the native /anon page. No props, no
// state: a plain link that opens the terms in the same tab.
import Link from "next/link";

export function AnonTermsLink({ className = "" }: { className?: string }) {
  return (
    <span data-testid="anon-terms-link" className={"text-[12px] leading-4 text-x-sec " + className}>
      Anonymous posts follow the{" "}
      <Link href="/terms" className="text-x-blue hover:underline">
        terms and takedown policy
      </Link>
      .
    </span>
  );
}
