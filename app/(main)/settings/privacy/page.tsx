import type { Metadata } from "next";
import { SettingsHeader } from "@/components/settings/Chrome";
import { StrikeToggle } from "@/components/settings/StrikeToggle";
import { PrivacyPane } from "@/components/settings/PrivacyPane";
import type { PersonaSummary } from "@/lib/adapters/types";
import { isPublicDeployment } from "@/lib/platform/env-contract";

export const metadata: Metadata = { title: "Privacy & Disclosure / X" };
export const dynamic = "force-dynamic";

// Disclosure operates on seeded personas, which live in seed data rather
// than the validator DB — read them through the mock persona adapter
// regardless of the registry's persona binding.
//
// PROD-LIVE (D-CU-0-4): visibleOwnPersonaIds() reads the keystore, which a public deployment's server does not
// have — the read failed and the page said "Couldn't load your personas" forever. On a public deployment the
// server renders the shell only and PrivacyPane reads GET /api/personas from the browser device. On the rig the
// read below is the page's former read, handed to the same island.
async function rigPersonas(): Promise<PersonaSummary[]> {
  const { mockPersonaAdapter } = await import("@/lib/adapters/mock/persona");
  try {
    return (await Promise.all((await (await import("@/lib/identity/chrome")).visibleOwnPersonaIds()).map((id) => mockPersonaAdapter.get(id)))).filter(
      Boolean
    ) as PersonaSummary[];
  } catch {
    return [];
  }
}

export default async function PrivacySettings() {
  const initial = isPublicDeployment() ? null : await rigPersonas();
  return (
    <>
      <SettingsHeader title="Privacy & Disclosure" back="/settings" />
      <StrikeToggle />
      <PrivacyPane initial={initial} />
    </>
  );
}
