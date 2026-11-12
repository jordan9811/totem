# Morpho, not Aave
<!-- uncited-ok: page, an analogy, not a claim -->

::: info Status: the stance, not today's status
This page explains a design choice. Today Totem runs on Farcaster only, and every X feature has run on test data only. The [home page](/#what-works-today) says what works today.
:::

In lending, Aave is a venue: it holds the pools, sets the rules, and every user is a user of Aave. Morpho began as a layer on top of existing venues: a better matching engine that used their liquidity without becoming a new pool anyone had to trust. The product was the improvement; the underlying venue stayed where the users already were.

Totem takes the same stance toward social networks. It is not a new network with an empty graph. It is a client over networks people already use: Farcaster today, with X import planned (today's X import, linking and interop have run on test data only): that adds what those networks structurally cannot: personas over one root, owner-controlled disclosure, forkable identities, proof-mediated reputation, and feeds ranked by a lens the reader chose.

What follows from the stance:

- **Parity first.** The surfaces look and behave like the network they sit on (the X-parity rule in the reports) so the improvement is the only thing a user has to learn.
- **Adapters, not forks.** Every network is behind an adapter; the app never talks to a network directly. The Technical section renders the adapter seams from the source.
- **No new trust.** The client does not ask a user to trust Totem's server more than they trust the network. The validator is built and tested as an untrusted operator.
- **The network keeps its own rules.** Where the underlying network has an identity primitive (a Farcaster FID, an X handle), a persona is meant to hold one; where it does not, Totem does not pretend.
