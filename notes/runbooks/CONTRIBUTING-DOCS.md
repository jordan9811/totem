# CONTRIBUTING-DOCS — what a closing pass must touch

The docs site (VitePress, from /docs, port 3011; the app serves the built site at /docs) is part of the closing bar: docs:check and docs:sync are in the safety set. A pass that closes without these edits leaves the site claiming a state the code has left.

## Every closing pass

1. **A pass page.** Add docs/internal/passes/NN-slug.md written from the pass's REPORT-*.md, in the template the existing pages use (frontmatter: title, pass, report, date, status; sections: What shipped / What it found / Judgment calls / Verification result / Assumptions and open items). Every bullet cites a report heading verbatim: {cite: notes/reports/REPORT-X.md > "Heading"}. The PREVIOUS most-recent pass's stub becomes a full page at the same time; the new pass gets the stub.
2. **Feature pages.** Re-tag what the pass shipped: SHIPPED / SHIPPED-FIXTURE / SPECCED / IDEA / KNOWN-BROKEN / UNCLEAR. A live-verified feature moves from SHIPPED-FIXTURE to SHIPPED only with a citation to the live run.
3. **Privacy pages.** If SECURITY-POSTURE.md gained a section, cite it from what-is-hidden, operator and assumptions. Never paraphrase a claim more strongly than the posture states it.
4. **Open issues.** Seed the pass's owner decisions at the top of docs/internal/open-issues.md; the KNOWN-BROKEN and MORNING items regenerate.
5. **Needs a status call.** Add or retire items.
6. **Regenerate and lock.** npm run docs:generate, then npm run docs:check (must be green), then npm run docs:sync -- --update after re-reading any page that drifted. Commit docs/.cite-lock.json with the pages. The lock update is the LAST docs step of a pass: the runbooks (GO-LIVE-*.md) and SECURITY-POSTURE.md are cited sections, so every edit to them after the lock drifts it again. Edit them first, re-read the citing pages, lock once.
7. **Build.** npm run docs:build must succeed; SHOW_INTERNAL=1 npm run docs:build must too; and the app build's docs half, node scripts/build-docs.mjs && node scripts/docs-guard.mjs, must pass (it is what every deploy runs).

## Rules the tooling enforces

- A paragraph with a privacy-claim keyword (never / cannot / impossible / unlinkable / guarantee / zero-knowledge / fail-closed / does not learn …) needs a cite in that paragraph or an uncited-ok marker. Page-level markers are for indexes, the mission pages and generated pages only.
- A cite must name a file at the repo root, in research/ or in docs/, and a heading that exists there verbatim.
- Public pages never link into /internal/, and never write that path or a platform app hostname (`<name>.up.railway.app`, including the public app's own) in their text: the docs guard (`scripts/docs-guard.mjs`, DOCS UNDER APP) runs inside the APP's build (`npm run build`), greps the whole docs output, search index included, and fails the app build, so the app cannot deploy until the page is fixed. Write "the internal pages" instead.
- A raw HTML link in a page (`<a href="...">`) does not get the site's `/docs/` base: write it relative (`./page`, `../diagrams/x.svg`). The guard fails the build on a root-absolute href that leaves /docs/. Markdown links, images and the sidebar get the base automatically.
- docs:generate, docs:check and docs:sync are NOT part of the app build (a citation drift must not block an app deploy). Run them yourself before committing docs; the docs ship with the app's next deploy.
- Generated pages (adapters, scopes, data-model, roadmap data, the open-issues outline) are overwritten by docs:generate; edit the source, not the output.
- Status tags come from one vocabulary. The roadmap's counts are derived from the tags, so a mistagged bullet is a wrong count.

## Start here and Features: the plain-words pages

The site has three tracks: **Start here** (`docs/start/`, for anyone), **How it works underneath** (`docs/mechanism/`, for crypto readers) and **For developers** (`docs/technical/`). The nav and every sidebar slot live in one file, `docs/.vitepress/config.mts`; a new page gets its slot there and a line in `docs/SUMMARY.md` (never anything under `internal/`).

Pages under `docs/start/` and `docs/features/` follow the template of the owner's other project:

1. **Frontmatter `pageClass: eli5`.** It hides the citation chips (custom.css), except under "The record" heading, where the auditors' list shows them. The `{cite: …}` tokens stay in the source, so docs:check and docs:sync still bind every claim.
2. **H1, then one plain sentence** saying what the feature does for a person.
3. **A status box**, worded with the six status words: Works live, Built (test data only), Designed, Off on purpose, Coming soon, Not offered here. "Off on purpose" means built, deployed and waiting for the owner to switch it on; a site that does not offer something by design is "Not offered here" (➖), never "Off". An unbuilt part of the owner's pitch is "Coming soon" on consumer pages, whatever design exists. "Works live" needs a check on the deployed site, not a run on a local production-shaped copy. `::: tip` for works live, `::: warning` for test data only, `::: info` for designed or coming soon, `::: danger` when something misleads today. Say which site: the public preview or the owner's private service.
4. **"At a glance"**: an `<ol class="flow">` of five steps or fewer. `flow__us` marks the step Totem does; `flow__soon` (dashed) marks a step that is not built. A `<p class="flow__note">` says what the picture leaves out. Pictures that need more come from one of two places, one source per picture. The five consumer pictures are Vue components registered in `docs/.vitepress/theme/index.ts` (`<DiagramRootPersonas />`, `<DiagramWhoSees />`, `<DiagramRequestPath />`, `<DiagramAnonRelay />`, `<DiagramXMatch />`, in `theme/components/diagrams/`); each takes a `caption` and carries its own status chips, which docs:check does not read, so keep them in step with `lib/status/features.ts` by hand. Technical pictures on the mechanism and developer pages are inline SVG in a `<figure class="diagram">` with a `<figcaption>`, coloured only through the `dg-*` classes so light and dark both work, with no blank line inside the figure. Every figure has a caption.
5. **"The obvious questions"**: H3 questions a first-time reader would ask, each answered verdict first.
6. **"What this does not protect"** where privacy is involved, then **"Where it lives in the code"**, then (feature pages) **"The record"**: the tagged, cited bullets an auditor follows back to the reports.

Voice: short sentences, no em dashes, concrete numbers, each term explained once (the glossary holds them all), and nothing that has only run on test data is ever called live.

Plain words still trip the claim check. "can't", "never", "cannot" and "does not see" make a paragraph a privacy claim. Either cite the posture section that backs it (the chip is hidden on these pages), rephrase when it is not a privacy claim ("is off", "does not work yet"), or, for a sentence that describes a design that is not built, mark that paragraph `<!-- uncited-ok: describes a planned design -->`. Headings and list items are paragraphs of their own.

The public roadmap board (`docs/roadmap/index.md`) is hand-written on the same legend, with an "Unblocks:" line per open issue; update it when a status in `lib/status/features.ts` changes. Links to a page that does not exist yet fail the build unless the page is named in `PLANNED` in `config.mts`; the list is empty now, so keep it that way except while a page is being written.

The "What works today" table on the docs home is generated by docs:generate from the app's one status file, `lib/status/features.ts` (or `.json`), the same file the in-app Help page reads. It is written to `docs/start/what-works-generated.md` and included with `<!--@include: -->`. A status the legend does not know stops docs:generate with its name; a missing file shows a warning in the table's place, and `DOCS_REQUIRE_STATUS=1` (set it for a publish build) turns that into a failure.

**A new capability starts as a row in `lib/status/features.ts`**, before any page describes it: "fixture" (Built, test data only) on the surface it was built for until someone has seen it on that DEPLOYED service, never "live" on the strength of a harness or a sweep, and "na" on a surface that does not offer it. `scripts/accept-help.mjs` checks that the Help page renders exactly the file's rows, and the three JSON blocks must stay strict JSON (double quotes, no trailing commas, no em dashes). Give the id a docs page in `DOCS_PAGE` in `scripts/docs-generate.mjs`, or the table's row renders without a link (never with a wrong one); then update the roadmap board, the feature page's status box and the Help page's own status box (`components/help/HelpPage.tsx`, hand-written) by hand, in the same words. The owner's runbook steps (`notes/runbooks/GO-LIVE-MORNING.md`, `notes/runbooks/OWNER-CHECKLIST.md`) follow the same rule: a step may name a built thing only as something the morning deploy brings, never as something already running.

## What NOT to do

- Do not add a page that describes code by hand when it could be rendered from the source; extend scripts/docs-generate.mjs instead.
- Do not cite a research/attack-*.md file for a product claim; cite the report that answered the finding.
- Do not lock a drifted section without re-reading the page that cites it.
