"use client";
// The search input, which until this gate was a styled div that did nothing.
// Two of them existed — the explore header and the right rail — and neither
// had an onChange, a form, or a handler.
import { useRouter } from "next/navigation";
import { useState } from "react";
import { SearchIcon } from "./icons";

export function SearchBox({
  initial = "",
  autoFocus = false,
}: {
  initial?: string;
  autoFocus?: boolean;
}) {
  const [q, setQ] = useState(initial);
  const router = useRouter();

  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        const trimmed = q.trim();
        if (trimmed) router.push(`/search?q=${encodeURIComponent(trimmed)}`);
      }}
      className="flex h-[44px] w-full items-center rounded-full border border-[#cfd9de] bg-white px-4 focus-within:border-x-blue"
    >
      <span className="text-x-sec">
        <SearchIcon size={18.75} />
      </span>
      <input
        data-testid="search-input"
        value={q}
        autoFocus={autoFocus}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search"
        aria-label="Search"
        className="ml-3 w-full min-w-0 bg-transparent text-[15px] leading-5 outline-none placeholder:text-x-sec"
      />
    </form>
  );
}
