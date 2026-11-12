# Context collapse
<!-- uncited-ok: page: the mission statement is a position, not a verified claim; every verifiable claim lives in Privacy and Technical -->

::: info Status: the vision, not today's status
This page says what Totem is for. Much of it is not built yet or runs on test data only: choosing who sees which persona is built as rings, on test data, deployed 2026-10-12 and not yet used, and the privacy label reads DEMO. The [home page](/#what-works-today) says what works today.
:::

People are not one audience. The person who posts about a chronic illness, the person who argues about monetary policy, the person who shows their garden to their neighbours and the person who is looking for a job are one person, and on every mainstream network they share one account, one follower list, one algorithm and one name. That is context collapse: every post is read by the union of every audience, so people post for the strictest one and say nothing to the rest.

Totem is an app built on the premise that the fix is structural, not a settings page:

- **One root, many personas.** A person holds a root identity on their own device and derives any number of personas from it. Each persona has its own name, posts and modes. (Today, on one device, your personas share one follow list.) Nothing about a persona says which root it came from unless its owner decides to say so.
- **Disclosure is the owner's, and it is granular.** A persona can tell one viewer, an inner circle, or everyone that it shares a root with another persona. The grant is an artifact the owner signs; the viewer verifies it; the server stores ciphertext.
- **The server is untrusted by construction.** The validator that stores state, computes reputation and serves feeds is treated as an operator who reads everything it holds. The design goal is that what it holds is not enough, and the privacy pages say precisely how far that goal is met, what is assumed, and what the operator can still do.
- **Reputation and influence are proof-mediated.** A persona proves it is above a tier, or holds an attestation, without the server learning which root proved it.

The rest of this handbook is organised so that the strongest claims are the most carefully sourced: the Privacy section cites the security posture document section by section, and the docs tooling refuses to build a page that claims more than a report does.
