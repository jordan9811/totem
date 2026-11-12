import "server-only";
// MULTI-FID PASS Gate 0 — the LIVE web-proof adapter is a refusal until a
// verifier exists: a zkTLS transcript of X's About page, or the browser
// extension that reads it under the user's own session, is a later pass
// (ASSUMPTION A-FID-WEBPROOF-LIVE in SECURITY-POSTURE.md). Nothing is
// issued from a fact nobody verified — fail closed, loudly, by name.
import type { WebProof, WebProofAdapter, XAboutFacts } from "./types";

export const liveWebProof: WebProofAdapter = {
  kind: "live",
  async xAbout(_proof: WebProof): Promise<XAboutFacts> {
    throw new Error("live web proof: no verifier in this pass (zkTLS / extension arrive later) — refused");
  },
};
