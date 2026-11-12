"use client";
// UX GATE 4 — the backpack mini-app: score at top, then the 4 import
// source types (self-declared here; VC/DID/platform-export ride the
// EXISTING connector-import UI unmodified, alongside the two connectors
// Wave 5 already shipped — one screen, not a fork of that component).
import { useCallback, useState } from "react";
import { BackpackScore } from "./BackpackScore";
import { SelfDeclareForm } from "./SelfDeclareForm";
import { GraphImports } from "./GraphImports";
import { ClaimProvenance } from "./ClaimProvenance";

export function BackpackPage() {
  const [refreshKey, setRefreshKey] = useState(0);
  const bump = useCallback(() => setRefreshKey((k) => k + 1), []);

  return (
    <>
      <BackpackScore refreshKey={refreshKey} />
      <div className="px-4 py-4">
        <SelfDeclareForm onSubmitted={bump} />
      </div>
      <GraphImports onImportComplete={bump} />
      <ClaimProvenance refreshKey={refreshKey} />
    </>
  );
}
