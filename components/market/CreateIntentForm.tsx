"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function CreateIntentForm() {
  const router = useRouter();
  const [category, setCategory] = useState("espresso");
  const [description, setDescription] = useState("");
  const [escrow, setEscrow] = useState("5000");
  const [slots, setSlots] = useState("3");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div data-testid="create-intent" className="border-b border-x-border px-4 py-4">
      <p className="text-[13px] font-bold uppercase tracking-wide text-x-sec">Post an intent</p>
      <input
        data-testid="intent-description"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Looking for a decent espresso setup under $600"
        className="mt-2 w-full rounded-[4px] border border-[#cfd9de] px-3 py-2 text-[15px] outline-none focus:border-x-blue"
      />
      <div className="mt-2 flex flex-wrap gap-2">
        <select
          data-testid="intent-category"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="h-9 rounded-[4px] border border-[#cfd9de] px-2 text-[15px]"
        >
          {["espresso", "telescope", "longform_reader", "fantasy_football"].map((c) => (
            <option key={c} value={c}>
              {c.replace(/_/g, " ")}
            </option>
          ))}
        </select>
        <input
          data-testid="intent-escrow"
          value={escrow}
          onChange={(e) => setEscrow(e.target.value.replace(/[^0-9]/g, ""))}
          className="h-9 w-28 rounded-[4px] border border-[#cfd9de] px-2 text-[15px] outline-none focus:border-x-blue"
          aria-label="Escrow amount in cents"
        />
        <select
          data-testid="intent-slots"
          value={slots}
          onChange={(e) => setSlots(e.target.value)}
          className="h-9 rounded-[4px] border border-[#cfd9de] px-2 text-[15px]"
        >
          {[2, 3, 4].map((n) => (
            <option key={n} value={n}>
              {n} pitch slots
            </option>
          ))}
        </select>
        <button
          data-testid="create-intent-submit"
          disabled={busy || !description}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              const res = await fetch("/api/market/intent", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  category,
                  description,
                  escrowAmount: Number(escrow),
                  pitchSlots: Number(slots),
                  windowMs: 60_000,
                }),
              });
              const data = await res.json();
              if (!res.ok) {
                setError(data.error ?? "couldn't create intent");
                return;
              }
              router.push(`/market/${data.intent.id}`);
            } finally {
              setBusy(false);
            }
          }}
          className="h-9 rounded-full bg-x-blue px-4 text-[15px] font-bold text-white hover:bg-x-blue-hover disabled:opacity-50"
        >
          {busy ? "Posting…" : "Post intent"}
        </button>
      </div>
      {error && <p className="mt-2 text-[13px] text-[#f4212e]">{error}</p>}
    </div>
  );
}
