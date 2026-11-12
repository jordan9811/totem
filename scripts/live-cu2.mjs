// BROWSER KEYSTORE PASS Gate 2 — live-cu2: the social-login path against the REAL custody provider, once, no spend.
//
// The provider adapter is the only piece of Gate 2 the fixture cannot stand in for. The real provider (a Privy-class
// embedded-wallet SDK behind lib/device/custody/provider.ts's CustodyProviderAdapter) is NOT in this tree: no SDK is
// installed and no app id exists on this machine. This script therefore REFUSES unless both are present, and says
// so — a green run here would otherwise be a lie (A-CU-2-REAL-PROVIDER-NOT-EXERCISED in notes/reports/REPORT-CUSTODY.md).
//
// When configured (CUSTODY_PROVIDER=privy, PRIVY_APP_ID set, the SDK installed and an adapter registered), the run
// is: boot a device on /device, log in with Farcaster through the provider, save, forget the device, log in again,
// assert the same root and commitment, assert no provider token or export reached the validator's tables or logs.
import { existsSync } from "node:fs";

const provider = (process.env.CUSTODY_PROVIDER || "fixture").toLowerCase();
const appId = process.env.PRIVY_APP_ID || "";
const sdkPresent = existsSync("node_modules/@privy-io/react-auth/package.json") || existsSync("node_modules/@privy-io/js-sdk-core/package.json");

console.log("\nlive-cu2 — the real custody provider, no spend");
if (provider === "fixture") {
  console.log("  NOT CONFIGURED: CUSTODY_PROVIDER is the fixture. The real provider is not exercised (A-CU-2-REAL-PROVIDER-NOT-EXERCISED).");
  process.exit(2);
}
if (!appId) {
  console.log("  NOT CONFIGURED: PRIVY_APP_ID is unset. Refusing to pretend.");
  process.exit(2);
}
if (!sdkPresent) {
  console.log("  NOT CONFIGURED: the provider SDK is not installed in this tree. Refusing to pretend.");
  process.exit(2);
}
console.log("  a real-provider adapter is not registered in lib/device/custody/provider.ts yet — see providerAdapter(). Refusing to pretend.");
process.exit(2);
