"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { AdapterRegistrySnapshot } from "@/lib/adapters/types";
import { ErrorNote, Row, SettingsGroup, Toggle } from "./Chrome";

export function DeveloperPane({ initialRegistry }: { initialRegistry: AdapterRegistrySnapshot }) {
  const router = useRouter();
  const [registry, setRegistry] = useState(initialRegistry);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  async function call(action: string, payload: Record<string, unknown> = {}) {
    setBusy(action);
    setError(null);
    setNote(null);
    try {
      const res = await fetch("/api/dev", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...payload }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "request failed");
      const data = await res.json();
      setRegistry(data.registry);
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(null);
    }
  }

  const latencyMaxed = registry.latencyInjectionMs !== null;

  const impls: [string, string][] = [
    ["Persona", registry.persona],
    ["Reputation", registry.rep],
    ["Disclosure", registry.disclosure],
    ["Modes", registry.mode],
    ["Rules engine", registry.rulesEngine],
    ["Attestations", registry.attestation],
    ["Feed health", registry.feedHealth],
  ];

  return (
    <>
      <ErrorNote error={error} />
      {note && <p className="mx-4 my-3 rounded-2xl bg-[#e8f5fe] px-3 py-2 text-[15px] text-x-blue">{note}</p>}

      <SettingsGroup
        title="Adapter registry"
        note="Which implementation each adapter interface currently resolves to. Set with ADAPTER_* env vars."
      >
        {impls.map(([label, impl]) => (
          <Row
            key={label}
            testid={`registry-${label.toLowerCase().replace(/\s+/g, "-")}`}
            label={label}
            right={
              <span
                className={`rounded-full px-2 py-0.5 text-[13px] font-bold ${
                  impl === "validator" ? "bg-[#00ba7c1a] text-x-green" : "bg-x-pill text-x-sec"
                }`}
              >
                {impl}
              </span>
            }
          />
        ))}
      </SettingsGroup>

      <SettingsGroup
        title="Content source"
        note="Seed is the test default; live serves real Farcaster content through the Neynar adapter (cached, rate-limit-aware). Flipping this never touches persona, grant, or mode state. Resets to the env default on seed reset."
      >
        <Row
          testid="data-source-row"
          label="Live Farcaster content"
          sub={registry.dataSource === "neynar" ? "Live via Neynar — personas/modes render over real casts" : "Seeded corpus (default)"}
          right={
            <Toggle
              testid="data-source-toggle"
              on={registry.dataSource === "neynar"}
              busy={busy === "setDataSource"}
              onChange={(next) => call("setDataSource", { source: next ? "neynar" : "seed" })}
            />
          }
        />
      </SettingsGroup>

      <SettingsGroup
        title="Latency injection"
        note="Mocks lie about success, never about cost. Default: 200–1500ms, 2% failure. Maxed: 1400–1500ms, 25% failure — use it to prove every surface has loading and error states."
      >
        <Row
          testid="latency-toggle-row"
          label="Max out latency + failures"
          sub={
            latencyMaxed
              ? `${registry.latencyInjectionMs![0]}–${registry.latencyInjectionMs![1]}ms, ${Math.round((registry.failureRateOverride ?? 0) * 100)}% failure`
              : "200–1500ms, 2% failure (default)"
          }
          right={
            <Toggle
              testid="latency-toggle"
              on={latencyMaxed}
              busy={busy === "maxLatency"}
              onChange={(next) => call("maxLatency", { on: next })}
            />
          }
        />
      </SettingsGroup>

      <SettingsGroup title="Caught-up banner">
        <Row
          testid="force-exhaust-row"
          label="Force content exhaustion"
          sub="Marks everything as seen for the active persona — the caught-up banner appears at the top of the next feed load."
          onClick={async () => {
            if (await call("forceExhaust")) {
              setNote("Feed exhausted — open Home to see the banner.");
              router.refresh();
            }
          }}
          right={
            busy === "forceExhaust" ? (
              <span className="text-[13px] text-x-sec">…</span>
            ) : (
              <span className="text-[13px] font-bold text-x-blue">Run</span>
            )
          }
        />
      </SettingsGroup>

      <SettingsGroup title="Seed data">
        <Row
          testid="seed-reset-row"
          label="Reset seed state"
          sub="Drops modes, rules, grants, bookmarks, blocks, and schedules back to the generated baseline."
          onClick={async () => {
            if (await call("resetSeed")) {
              setNote("Seed state reset.");
              router.refresh();
            }
          }}
          right={
            busy === "resetSeed" ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-x-border border-t-x-blue" />
            ) : (
              <span className="text-[15px] font-bold text-x-blue">Reset</span>
            )
          }
        />
        <Row
          testid="fast-forward-row"
          label="Fast-forward readwise schedule"
          sub="Surfaces the next chunk of every active bookmark schedule immediately."
          onClick={async () => {
            if (await call("fastForwardReadwise")) {
              setNote("Advanced every active readwise schedule by one chunk.");
              router.refresh();
            }
          }}
          right={
            busy === "fastForwardReadwise" ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-x-border border-t-x-blue" />
            ) : (
              <span className="text-[15px] font-bold text-x-blue">Advance</span>
            )
          }
        />
      </SettingsGroup>
      <div className="h-24" />
    </>
  );
}
