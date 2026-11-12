// NEYNAR AS A SWITCH (SECURITY-POSTURE.md §42) — Settings › Developer: where each Farcaster surface reads from, and why.
//
// READ-ONLY for everyone. The switches are the operator's (FC_SOURCE_* on the public app, docs/technical/env.md); this
// page only says what they resolved to on THIS deployment, computed by the app server at request time
// (lib/fc/source/switch.ts allSurfaceStates with the relay's own armed answer). Names and value classes only: an unknown
// value is shown by its length, never echoed. No control, no request, nothing about the visitor.
import type { FcSurfaceState } from "@/lib/fc/source/switch";
import { SettingsGroup } from "./Chrome";

const BADGE: Record<FcSurfaceState["effective"], { text: string; cls: string }> = {
  network: { text: "Farcaster's network", cls: "bg-[#00ba7c1a] text-x-green" },
  neynar: { text: "Via Neynar", cls: "bg-[#1d9bf01a] text-x-blue" },
  off: { text: "Off", cls: "bg-x-pill text-x-sec" },
  unavailable: { text: "Not available", cls: "bg-x-pill text-x-sec" },
};

export function FcSourcesPanel({ states, relayArmed }: { states: FcSurfaceState[]; relayArmed: boolean }) {
  return (
    <div data-testid="fc-sources" data-relay={relayArmed ? "armed" : "unarmed"}>
      <SettingsGroup
        title="Where Farcaster data comes from"
        note={
          "Set by this site's operator, one switch per surface (FC_SOURCE_* on the app: network, neynar or auto). Read-only here. " +
          (relayArmed ? "The Neynar read relay is armed (a read key is set)." : "The Neynar read relay is not armed (no read key), so every Neynar setting is off.") +
          " Following and notifications never go through Neynar or Totem's server, whatever the switch says."
        }
      >
        {states.map((s) => {
          const b = BADGE[s.effective];
          return (
            <div
              key={s.surface}
              data-testid="fc-source-row"
              data-surface={s.surface}
              data-effective={s.effective}
              data-asked={s.asked}
              data-reason={s.reason}
              className="border-t border-x-border px-4 py-3 first:border-t-0"
            >
              <div className="flex items-center justify-between gap-3">
                <p className="text-[15px] font-bold leading-5 text-x-text">{s.name}</p>
                <span data-testid="fc-source-badge" className={`shrink-0 rounded-full px-2 py-0.5 text-[13px] font-bold ${b.cls}`}>
                  {b.text}
                </span>
              </div>
              <p className="mt-0.5 text-[13px] leading-4 text-x-sec">
                <code>{s.variable}</code>: {s.asked === "unset" ? "unset (network)" : s.asked === "invalid" ? "not a value this switch takes" : s.asked}
              </p>
              <p data-testid="fc-source-why" className="mt-1 text-[13px] leading-4 text-x-sec">
                {s.sentence}
              </p>
            </div>
          );
        })}
      </SettingsGroup>
    </div>
  );
}
