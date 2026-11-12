# notes/runbooks/CONNECTING-GITBOOK.md — the docs as a GitBook space synced to this repo

The handbook lives in `docs/` (Markdown). It is built two ways: by VitePress (`npm run docs:build`, the internal
site) and, once connected, by **GitBook Git Sync**, which reads the same files through `.gitbook.yaml`. Nothing in
`docs/` is generated for GitBook specifically; GitBook reads what is there.

## What GitBook owns once sync is on

| path | owner | rule |
|---|---|---|
| `.gitbook.yaml` | GitBook | the sync contract: root `docs/`, README `index.md`, summary `SUMMARY.md`. Do not move it. |
| `docs/SUMMARY.md` | GitBook + `npm run docs:summary` | the table of contents. The script only ever **appends** pages it finds unlisted, under a final "Unsorted" heading; it never removes, rewrites or reorders a line. Reorder in GitBook's editor or by hand. |
| `docs/` | GitBook + the generators | every page. The generated pages (`docs/technical/adapters.md`, `scopes.md`, `data-model.md`, `docs/internal/*-generated.*`) carry a banner and are overwritten on `npm run docs:generate`; every other page is hand-authored and no script touches it. |
| `docs/notes/` | **the owner** | pages written in GitBook's editor or by hand. Never rewritten, reordered or deleted by any script. |
| `docs/roadmap.md` | **the owner** | seeded once from the internal roadmap; marked owner-maintained at the top so no script claims it. |

`docs/internal/` is the internal section (`SHOW_INTERNAL=1` for the VitePress site). It is not listed in
`SUMMARY.md`, so GitBook does not publish it; keep it that way.

## Connecting (the owner does this once, in GitBook)

1. In GitBook, create a space (or open the one for Totem) → **Configure** → **Git Sync** → **GitHub**.
2. Install the GitBook GitHub app on the repository (it needs read/write on that repo only).
3. Choose the repository and the branch (`main`), keep the project directory at `/` — `.gitbook.yaml` names
   `docs/` as the root — and pick **GitHub → GitBook** as the initial direction so the repo's content wins the first
   sync.
4. Turn on sync. GitBook commits its edits back to `main` under `docs/` (and only there, plus `.gitbook.yaml` and
   `SUMMARY.md`).
5. Optional: set `NEXT_PUBLIC_DOCS_URL` on the app deployment to the space's public URL. DOCS UNDER APP: the app
   serves the docs itself at `/docs` and every docs door points there; a value here overrides `/docs`.

## Warnings

- **Do not create README files from the GitBook UI while sync is on.** GitBook maps a section's README to a
  directory index; a README created in the editor lands as `docs/<section>/README.md` and shadows the existing
  `index.md`. Create ordinary pages, or create the index file in the repo.
- GitBook-flavoured Markdown (hints, tabs, embeds) is fine for GitBook and mostly fine for VitePress, but
  `npm run docs:check` still enforces the citation rule on every page: a page that claims more than a report does
  fails the check, whichever editor wrote it. Write position pages with the `uncited-ok: page` marker.
- The app's CODE never reads `docs/`: `next build` compiles `app/`, `lib/` and `components/`; `docs/` is not
  imported anywhere. DOCS UNDER APP (D-DOCS-UNDER-APP): `npm run build` does build the site from `docs/` and the app
  serves it at `/docs`, so a GitBook write-back reaches readers only with the app's next deploy, and a page that
  breaks the docs build or its guard stops that deploy. The deploy configuration excludes `docs/**`, `*.md` at the
  root and `.gitbook/**` from its watch paths (see `notes/reports/REPORT-CUSTODY.md`, Gate 6); if you connect a deploy to GitHub
  later, decide whether docs edits should redeploy the app, since that is now how they ship.
- There is no CI in this repository today; if one is added, docs-only commits should skip the app test suite by
  the same path filter.

## Checking it (any time)

`npm run docs:generate && npm run docs:summary && npm run docs:check` regenerates the generated pages, appends any
unlisted page to the summary, and runs the citation check. A page you authored by hand keeps its content and its
position in `SUMMARY.md` across all three; the Gate 6 suite (`scripts/accept-cu6.mjs`) asserts exactly that by
creating a page, running the scripts, and comparing.
