"use client";
// MEGA PASS 2 Gate 3 — the per-cast action row's BINDINGS, provided by the
// timeline that knows the active mode and consumed by every card under it.
// Absent (the classic timeline, profile pages, threads) the card renders
// X's row exactly — the default is the parity baseline, and a page that
// never asked for a binding never changes.
import { createContext, useContext } from "react";
import { DEFAULT_CAST_ROW, type CastAction } from "@/lib/actions/bindings";
import type { ZoneConfig } from "@/lib/zones/types";

export interface ActionRowBinding {
  modeId: string | null;
  row: readonly CastAction[];
  /** the mode's full slots, so a rebinding PATCH keeps composer/nav intact */
  slots: { composer: string[]; nav: string[]; cast?: string[] } | null;
  /** the device's scroll-zone layout, so long-form cards know whether to own their scroll */
  zones: ZoneConfig | null;
}

const ActionRowContext = createContext<ActionRowBinding>({ modeId: null, row: DEFAULT_CAST_ROW, slots: null, zones: null });

export function ActionRowProvider({ value, children }: { value: ActionRowBinding; children: React.ReactNode }) {
  return <ActionRowContext.Provider value={value}>{children}</ActionRowContext.Provider>;
}

export function useActionRow(): ActionRowBinding {
  return useContext(ActionRowContext);
}
