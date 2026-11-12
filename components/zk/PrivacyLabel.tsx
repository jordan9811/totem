// ZK PASS 1 Gate 3 — the label the discovery surface shows when the rep
// binding is zk. Server component: the verdict is computed on the server
// from machine-checked conditions (lib/zk/privacy.ts); nothing here is a
// hardcoded claim. The DEMO band has no dismiss control by design.
//
// PROD-LIVE (D-CU-0-4): the markup moved to PrivacyLabelView.tsx so a client island can render the same label
// from a verdict the browser device computed. This server variant is unchanged in what it computes and emits; it
// must only be rendered where the server holds an identity (the rig). On a public deployment use
// PrivacyLabelClient, which reads POST /api/zk {action:"privacyConditions"} from the device.
import { privacyConditions } from "@/lib/zk/privacy";
import { PrivacyLabelView } from "./PrivacyLabelView";

/** Gate 4: an attestation-GATED surface passes the bucket it gates on — the ninth condition is then computed and shown */
export async function PrivacyLabel({ attestation }: { attestation?: { issuer: string; bucket: string } } = {}) {
  const v = await privacyConditions(undefined, attestation ? { attestation } : {});
  return <PrivacyLabelView verdict={v} />;
}
