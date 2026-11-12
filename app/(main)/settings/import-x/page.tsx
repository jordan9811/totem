import type { Metadata } from "next";
import { SettingsHeader } from "@/components/settings/Chrome";
import { XImportWizard } from "@/components/settings/XImportWizard";
import { XPeoplePanel } from "@/components/settings/XPeoplePanel";
import { MigrationPanel } from "@/components/settings/MigrationPanel";
import { ColdStorePanel } from "@/components/settings/ColdStorePanel";
import { xRigFixturesAvailable } from "@/lib/x/attestations";

export const metadata: Metadata = { title: "Import from X / X" };
export const dynamic = "force-dynamic";

// PUBLIC GO-LIVE: the guided first run's X step links here with ?return=/welcome; the header's back arrow then leads back
// to the flow (a soft navigation: the identity and the flow's place in this document stay). Called with no argument (the
// unit harness renders it bare) it is the page it always was.
export default function ImportXSettings(props: { searchParams?: { return?: string } }) {
  // props may be absent at run time (the unit harness calls the page bare): read it optionally
  // (and the home feed's "Pick up where you left off" card links here with ?return=/home)
  const ret = props?.searchParams?.return;
  const back = ret === "/welcome" || ret === "/home" ? ret : "/settings";
  // PERSONA LAUNCH P2 (BYX G0): the old Totem-local follow matcher (MigrationPanel: X follows matched against handles
  // OTHER Totem personas linked) runs on test links only — it is the rig's, kept for its suite (accept-x4). Everywhere
  // else "find your people" is the keyless Farcaster index (XPeoplePanel). Review W1-R5: "the rig" is the one predicate
  // every X fixture convenience reads — never the owner service (rig-shaped) or the empty world.
  const rig = xRigFixturesAvailable();
  return (
    <>
      <SettingsHeader title="Import from X" back={back} />
      <XImportWizard />
      <XPeoplePanel />
      {rig && <MigrationPanel />}
      <ColdStorePanel />
    </>
  );
}
