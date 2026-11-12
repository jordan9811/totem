// PERSONA LAUNCH P6 — THE PROOF PAGE's body (a server component: rendered from public reads only — lib/launch/history.ts
// proofFor — with no device, no root, no vault). It shows what anyone can check: the account on the (simulated) chain,
// the signer keys its KeyRegistry lists and which app fid vouched them, and each reveal batch — its signer, its signature,
// whether the signature verifies over the batch's canonical form, and whether that signer is a registered key of the
// account. Labelled test data throughout: the registrar and its chain are simulated.
import type { ProofView } from "@/lib/launch/history";

const when = (t: number) => new Date(t).toISOString().slice(0, 16).replace("T", " ") + " UTC";

export function ProofPage({ fid, proof, error }: { fid: number; proof: ProofView | null; error: string | null }) {
  return (
    <main data-testid="proof-page" data-fid={fid} className="mx-auto max-w-[680px] px-4 py-6 text-[15px] leading-5">
      <h1 className="text-[23px] font-bold">Proof for account fid {fid}</h1>
      <p data-testid="proof-test-data" className="mt-2 rounded-md border border-[#f4b400] bg-[#fff8e1] px-3 py-2 text-[13px] text-[#5f4b00]">
        Test data: this account and its chain are simulated. Nothing here exists on Farcaster.
      </p>
      {error ? (
        <p data-testid="proof-error" className="mt-4">
          {error}
        </p>
      ) : !proof ? (
        <p data-testid="proof-none" className="mt-4">
          No launched account has that number on the simulated chain.
        </p>
      ) : (
        <>
          <section className="mt-4">
            <h2 className="text-[17px] font-bold">The account</h2>
            {/* PERSONA LAUNCH P6 (fix UX-L10): unbroken 42-char addresses and 64-hex keys wrap on a phone, never scroll sideways */}
            <p data-testid="proof-account" className="break-all">
              {proof.account?.fname ? `@${proof.account.fname} · ` : ""}custody {proof.account?.custody} · recovery {proof.account?.recovery}
            </p>
            <ul data-testid="proof-keys" className="mt-1 list-disc break-all pl-5">
              {proof.keys.map((k) => (
                <li key={k.key} data-testid="proof-key" data-key={k.key} data-active={k.active ? "true" : "false"}>
                  signer {k.key} · vouched by app fid {k.requestFid} · {k.active ? "registered" : "removed"}
                </li>
              ))}
            </ul>
          </section>
          <section className="mt-4">
            <h2 className="text-[17px] font-bold">Reveal batches</h2>
            {proof.batches.length ? (
              proof.batches.map((b) => (
                <div key={b.batchHash} data-testid="proof-batch" data-signature-checks={b.signatureChecks ? "true" : "false"} data-key-registered={b.keyRegistered ? "true" : "false"} className="mt-2 rounded-md border border-x-border px-3 py-2">
                  <p>Batch {b.batchHash.slice(0, 16)}… revealed {when(b.revealedAt)}</p>
                  <p className="break-all">Signer: {b.signer}</p>
                  <p className="break-all">Signature: {b.signature}</p>
                  <p data-testid="proof-batch-check">
                    {b.signatureChecks && b.keyRegistered
                      ? "Checks: the signature verifies, and the signer is a registered key of this account."
                      : "Does NOT check: " + (!b.signatureChecks ? "the signature does not verify" : "the signer is not a registered key of this account") + "."}
                  </p>
                  <p>{b.castHashes.length} anonymous post{b.castHashes.length === 1 ? "" : "s"} in this batch.</p>
                </div>
              ))
            ) : (
              <p>No reveal batch yet.</p>
            )}
          </section>
          <section className="mt-4">
            <h2 className="text-[17px] font-bold">The revealed posts</h2>
            <ul data-testid="proof-posts" className="mt-1">
              {proof.posts.map((p) => (
                <li key={p.castHash} data-testid="proof-post" className="border-t border-x-border py-2">
                  <p className="text-[13px] text-x-sec">{when(p.at)} · revealed from @anon</p>
                  <p className="break-words">{p.text}</p>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </main>
  );
}
