# Totem: read before any judgment call

The owner's vision and the rules every build is judged against live in `docs/mission/first-principles.md`. Re-read it
before a large run, before deciding a tradeoff on your own, and before calling anything done.

The short version:

- **The foundation is anoncast.** One shared anonymous account; each post commits to a reveal secret only its author
  holds; reusing one secret across a topic's posts makes a persona, a voice provably sharing an author, revealed only
  to the people its owner picks (now: rings). Anything that weakens that separation breaks the product.
- **Context collapse is the enemy.** Show up differently to different audiences without a new account or starting over.
- **Three separate dials:** who I am (persona), what I see (mode, lens), who sees me (rings, visibility). Coupled only
  by the persona's owner.
- **Unlinkability is the product.** Any path that lets anyone (server, network node, Neynar, other users) tie a persona
  to its root, through data, timing, metadata, reads, shared configs, moved reputation or style, is a top-priority bug.
  Check every new read or write path against personas specifically before it ships.
- **Visibility is a ladder:** broadcast → findable on your page → chosen rings → unfindable. Farcaster only does the top
  rung; the rest is encrypted on Totem's side.
- **Portable by proof, not by copy:** reputation moves as a proof from a big crowd; lenses and boards are forkable
  artifacts.
- **Accountability needs evidence and a reply:** proofs about public conduct, a right of reply, moderation.
- **A client over existing networks** (Morpho, not Aave): parity first.
- **Say exactly what is real:** built, deployed, switched on and working are four different words.

## Running the production-shape harness

Several sessions and agents share one machine and the harness's pinned ports (3001, 4001, 4321, 4335, 4337). Run every
`scripts/run-prod-shape.sh` invocation through the machine-wide lock, one suite per hold:
`bash /c/Users/jorda/.totem-harness/with-lock.sh env PRODLIVE_PUBLIC_LIVE=true PRODLIVE_SIWF=stub bash scripts/run-prod-shape.sh scripts/<suite>.mjs`.
It waits for the lock and for free ports (never kills another session's run), runs the suite, then kills its own leftover
servers as process trees.
