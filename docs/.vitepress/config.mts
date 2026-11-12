import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitepress";

// MEGA PASS 2 Gate 8 built the handbook; the docs rewrite reorganised it into three tracks, on the template of the
// owner's other project (Salvo): every feature page opens with a status box, an "At a glance" flow and "The obvious
// questions".
//
//   START HERE      /start/      plain words, for anyone (citation chips hidden: frontmatter `pageClass: eli5`)
//   FEATURES        /features/   one page per feature, in the order a user meets them (also `pageClass: eli5`)
//   UNDERNEATH      /mechanism/  mechanism design for crypto readers: concise, cited, a trust-assumptions table
//   PRIVACY         /privacy/    the label, the threat model and the auditor pages
//   DEVELOPERS      /technical/  architecture, running, code map, data flows, env, testing, deploy, tradeoffs, and
//                                the pages rendered from source
//   ROADMAP         /roadmap/    the board
//
// This file owns the WHOLE nav and sidebar. A page another writer adds gets its slot here, by path.
const SHOW_INTERNAL = process.env.SHOW_INTERNAL === "1" || process.env.SHOW_INTERNAL === "true";
const DOCS = join(dirname(fileURLToPath(import.meta.url)), "..");

// PAGES BEING WRITTEN IN PARALLEL. When several writers add pages at once, name each planned page here (a path under
// docs/ without .md) so the sidebar can give it a slot and other pages can link to it before it lands. Until a page
// lands, a link to it is not a build error (VitePress fails the build on a dead link) but it IS reported, loudly, on
// every build: nothing is silently dropped. Delete an entry once its page exists. Every planned page of the docs
// rewrite has landed, so the list is empty and every dead link fails the build, as it should.
const PLANNED: string[] = [];
const PLANNED_MISSING = new Set(PLANNED.filter((p) => !existsSync(join(DOCS, p + ".md"))));
if (PLANNED_MISSING.size) console.warn(`[docs] ${PLANNED_MISSING.size} planned page(s) not written yet; links to them are allowed for now: ${[...PLANNED_MISSING].join(", ")}`);

const internalSidebar = [
  {
    text: "Internal",
    items: [
      { text: "Overview", link: "/internal/" },
      { text: "Roadmap (status filters)", link: "/internal/roadmap" },
      { text: "Open issues", link: "/internal/open-issues" },
      { text: "Assumptions register", link: "/internal/assumptions" },
      { text: "Needs a status call", link: "/internal/needs-a-call" },
      { text: "Prod-live testing", link: "/internal/prodlive-testing" },
      { text: "FC-READ starter authors", link: "/internal/fc-read-starter-authors" },
      {
        text: "Pass history",
        collapsed: false,
        items: [
          { text: "All passes", link: "/internal/passes/" },
          { text: "01 · Build", link: "/internal/passes/01-build" },
          { text: "02 · Gated", link: "/internal/passes/02-gated" },
          { text: "03 · Waves", link: "/internal/passes/03-waves" },
          { text: "04 · Tier A", link: "/internal/passes/04-tier-a" },
          { text: "05 · Tier B", link: "/internal/passes/05-tier-b" },
          { text: "06 · Mega", link: "/internal/passes/06-mega" },
          { text: "07 · X interop", link: "/internal/passes/07-x-interop" },
          { text: "08 · UX", link: "/internal/passes/08-ux" },
          { text: "09 · Farcaster live", link: "/internal/passes/09-farcaster-live" },
          { text: "10 · Backpack", link: "/internal/passes/10-backpack" },
          { text: "11 · Persona crypto", link: "/internal/passes/11-persona-crypto" },
          { text: "12 · ZK 1", link: "/internal/passes/12-zk-1" },
          { text: "13 · ZK 2", link: "/internal/passes/13-zk-2" },
          { text: "14 · Attestation", link: "/internal/passes/14-attestation" },
          { text: "15 · Multi-FID", link: "/internal/passes/15-multi-fid" },
          { text: "16 · Mega 2", link: "/internal/passes/16-mega-2" },
          // The rolling pair: the two most recent closed passes are stubs until the next pass writes them up
          // (scripts/accept-mega2-g8.mjs check 3).
          { text: "17 · Browser keystore (stub)", link: "/internal/passes/17-custody" },
          { text: "18 · Post-deploy (stub)", link: "/internal/passes/18-post-deploy" },
        ],
      },
    ],
  },
];

// ---------------------------------------------------------------- the three tracks
const startSidebar = [
  {
    text: "Start here",
    items: [
      { text: "What is Totem", link: "/start/" },
      { text: "The map, in one picture", link: "/start/map" },
      { text: "The big picture", link: "/start/big-picture" },
      { text: "Your first 5 minutes", link: "/start/first-5-minutes" },
      { text: "Personas, explained", link: "/start/personas" },
      { text: "Who sees what", link: "/start/who-sees-what" },
      { text: "What reaches Farcaster", link: "/start/farcaster" },
      { text: "Bring your X", link: "/start/bring-your-x" },
      { text: "Privacy in plain words", link: "/start/privacy-in-plain-words" },
      { text: "FAQ", link: "/start/faq" },
      { text: "Glossary", link: "/start/glossary" },
    ],
  },
];

// One page per feature, in the order a user meets them.
const featuresSidebar = [
  {
    text: "Features",
    items: [
      { text: "All features, with status", link: "/features/" },
      { text: "1. Personas", link: "/features/personas" },
      { text: "2. Saving your identity", link: "/features/saving-and-recovery" },
      { text: "3. Your feed: modes and rules", link: "/features/modes-and-rules" },
      { text: "4. Lenses", link: "/features/algorithms-and-lenses" },
      { text: "5. Reading, health and delivery", link: "/features/feed-health" },
      { text: "6. Search", link: "/features/search" },
      { text: "7. Posting and Farcaster accounts", link: "/features/network-identities" },
      { text: "8. Anonymous posts", link: "/features/anon-posting" },
      { text: "8b. The anon page (for Farcaster people)", link: "/features/anon-page" },
      { text: "9. Who sees what: rings", link: "/features/who-sees-what" },
      // PERSONA LAUNCH wave 2: launch follows rings, the order a user meets them (renumbering the rest by one)
      { text: "10. Launching a persona", link: "/features/launch" },
      { text: "11. Bring your X", link: "/features/interop" },
      // PERSONA LAUNCH wave 3 (P8): Totem on X follows Bring your X (renumbering the rest by one)
      { text: "12. Totem on X", link: "/features/layers-on-x" },
      { text: "13. Replies, notes and rooms", link: "/features/social-surfaces" },
      { text: "14. Curators", link: "/features/curators" },
      { text: "15. Relationship history", link: "/features/relationship-history" },
      { text: "16. Influence and the UBI", link: "/features/influence-and-search" },
      { text: "17. Your data backpack", link: "/features/context-graph" },
      { text: "18. Ads and the market", link: "/features/ad-market" },
    ],
  },
];

// Mechanism design for crypto readers. Written by the mechanism track; the slots are fixed here.
const mechanismSidebar = [
  {
    text: "How it works underneath",
    items: [
      { text: "Overview", link: "/mechanism/" },
      { text: "One root, many personas", link: "/mechanism/key-hierarchy" },
      { text: "Browser custody", link: "/mechanism/custody" },
      { text: "Sign in with Farcaster", link: "/mechanism/sign-in-with-farcaster" },
      // SIGN IN WITH X (2026-11-06): your X account as you, through the validator's stateless relay
      { text: "Sign in with X", link: "/mechanism/sign-in-with-x" },
      // POST AS YOU (2026-11-05): your own Farcaster account from the Post box, with a key in your vault
      { text: "Post as you", link: "/mechanism/post-as-you" },
      // FOLLOWING FROM THE HUB (2026-11-05): your own Farcaster graph, read by your browser from a node
      { text: "Following from the hub", link: "/mechanism/following-from-the-hub" },
      // NOTIFICATIONS FROM FARCASTER (2026-11-06): your followers, mentions, replies, likes and recasts, read the same way
      { text: "Notifications from Farcaster", link: "/mechanism/notifications-from-farcaster" },
      // SPEC B (2026-11-07): For You from your own graph, read the same way, ordered by your mode
      { text: "For You from the hub", link: "/mechanism/for-you-from-the-hub" },
      { text: "ZK membership and tiers", link: "/mechanism/zk-membership" },
      { text: "The anon relay", link: "/mechanism/anon-relay" },
      { text: "The anon page and the Mini App", link: "/mechanism/anon-page" },
      // PERSONA LAUNCH wave 2 (P4-P6): the three mechanisms built on the anon relay
      { text: "Rings and ring notes", link: "/mechanism/rings" },
      { text: "Reach tiers and the crowd floor", link: "/mechanism/reach-tiers" },
      { text: "Launch and the registrar", link: "/mechanism/launch" },
      // PERSONA LAUNCH wave 3 (P8): the X outbox rides the same proof as the anon relay
      { text: "The @totem X outbox", link: "/mechanism/x-outbox" },
      { text: "Linkage and disclosure", link: "/mechanism/linkage-and-disclosure" },
      { text: "Reputation, influence and stakes", link: "/mechanism/reputation-and-stakes" },
      { text: "The ad market", link: "/mechanism/ad-market" },
      { text: "Attestations and issuers", link: "/mechanism/attestations" },
      { text: "The read relay", link: "/mechanism/read-relay" },
      { text: "Trust assumptions", link: "/mechanism/trust-assumptions" },
    ],
  },
  {
    // The Mega pass 2 concept notes: short, every line cited. Kept (and required by accept-mega2-g8) as the
    // sources the mechanism pages grew from.
    text: "Concept notes (cited)",
    collapsed: true,
    items: [
      { text: "Root and personas", link: "/concepts/root-and-personas" },
      { text: "Disclosure and grants", link: "/concepts/disclosure-and-grants" },
      { text: "Forking", link: "/concepts/forking" },
      { text: "Reputation and UBI", link: "/concepts/reputation-and-ubi" },
      { text: "Attestations", link: "/concepts/attestations" },
      { text: "Lenses", link: "/concepts/lenses" },
    ],
  },
];

const privacySidebar = [
  {
    text: "Privacy",
    items: [
      { text: "What the label means", link: "/privacy/" },
      { text: "In plain words", link: "/start/privacy-in-plain-words" },
      { text: "Threat model", link: "/privacy/threat-model" },
      { text: "What is hidden", link: "/privacy/what-is-hidden" },
      { text: "What the operator can still do", link: "/privacy/operator" },
      { text: "The label, exactly", link: "/privacy/label-semantics" },
      { text: "Assumptions register", link: "/privacy/assumptions" },
      { text: "What this does not do", link: "/privacy/not-doing" },
    ],
  },
];

const technicalSidebar = [
  {
    text: "For developers",
    items: [
      { text: "Architecture", link: "/technical/architecture" },
      { text: "Running all three shapes", link: "/technical/running" },
      { text: "Code map", link: "/technical/code-map" },
      { text: "Data flows", link: "/technical/data-flows" },
      { text: "Environment variables", link: "/technical/env" },
      { text: "Testing", link: "/technical/testing" },
      { text: "Deploy and its traps", link: "/technical/deploy" },
      { text: "Tradeoffs", link: "/technical/tradeoffs" },
    ],
  },
  {
    text: "Rendered from source",
    items: [
      { text: "Adapters", link: "/technical/adapters" },
      { text: "ZK scopes", link: "/technical/scopes" },
      { text: "Data model", link: "/technical/data-model" },
    ],
  },
  {
    text: "Design records",
    items: [
      { text: "Custody model", link: "/custody-model" },
      { text: "Key hierarchy", link: "/technical/key-hierarchy" },
      { text: "ZK layer", link: "/technical/zk-layer" },
      { text: "Issuers", link: "/technical/issuers" },
      { text: "Audit: root reads ledger", link: "/root-reads" },
      { text: "Memo: fan-out under zk", link: "/fanout-under-zk" },
    ],
  },
];

const roadmapSidebar = [
  {
    text: "Roadmap",
    items: [
      { text: "Board", link: "/roadmap/" },
      { text: "Scope plan: what's left to ship", link: "/roadmap/scope-plan" },
      { text: "Spec: the Dutch-auction ad marketplace", link: "/roadmap/ad-auction" },
      { text: "Next: personas that launch", link: "/roadmap/persona-launch" },
      { text: "Owner's notes", link: "/notes/" },
    ],
  },
  {
    // the vision and the stance: background reading, kept out of Start here because neither is a status page
    text: "Background",
    items: [
      { text: "Why: context collapse", link: "/mission/" },
      { text: "First principles: the vision and how we get there", link: "/mission/first-principles" },
      { text: "The stance: Morpho, not Aave", link: "/mission/morpho-not-aave" },
    ],
  },
];

export default defineConfig({
  title: "Totem",
  description: "One person, many personas, on Farcaster. A preview, honestly labelled.",
  lang: "en-US",
  // DOCS UNDER APP (D-DOCS-UNDER-APP, SECURITY-POSTURE.md §16): the site is served by the app itself at /docs
  // (app/docs/[[...slug]]/route.ts, built by `npm run build` into .docs-site/), so every URL it emits carries the
  // base. Markdown links and images, the nav, the sidebar and a raw <img src="/…"> get it automatically; a raw
  // <a href="/…"> in a page does NOT — write it relative (`./page`, `../diagrams/x.svg`), never "/section/…"
  // (scripts/docs-guard.mjs fails the build on any root-absolute href or src outside /docs/). A Vue component that
  // builds a path at run time wraps it in withBase(). `npm run docs:dev` serves at http://127.0.0.1:3011/docs/.
  base: "/docs/",
  cleanUrls: true,
  lastUpdated: false,
  markdown: {
    // markdown-it-attrs would eat a trailing {cite: ...} token as an attribute block; the token is text, rendered below
    attrs: { disable: true },
    config(md) {
      // {cite: FILE > "Heading"} renders as a small reference; the token stays in the source for docs:check / docs:sync.
      // On pages with `pageClass: eli5` (Start here, Features) the chip is hidden by custom.css: the citation still
      // binds the sentence for the tooling, and the reader is not asked to follow a file they cannot open.
      const CITE = /\{cite:\s*([^>{}]+?)\s*>\s*(?:"([^"]+)"|'([^']+)')\s*\}/g;
      const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
      // Take the whole token in one piece before emphasis runs. A cited heading such as
      // `GATE 3 — … — **CLOSED** (3 iterations)` would otherwise be split by the ** and print raw.
      const CITE_AT = /^\{cite:\s*([^>{}]+?)\s*>\s*(?:"([^"]+)"|'([^']+)')\s*\}/;
      md.inline.ruler.before("emphasis", "cite_token", (state, silent) => {
        if (state.src.charCodeAt(state.pos) !== 0x7b) return false;
        const m = CITE_AT.exec(state.src.slice(state.pos));
        if (!m) return false;
        if (!silent) state.push("text", "", 0).content = m[0];
        state.pos += m[0].length;
        return true;
      });
      const prev = md.renderer.rules.text;
      md.renderer.rules.text = (tokens, idx, options, env, self) => {
        const raw = tokens[idx].content;
        if (!CITE.test(raw)) return prev ? prev(tokens, idx, options, env, self) : esc(raw);
        CITE.lastIndex = 0;
        let out = "";
        let last = 0;
        for (const m of raw.matchAll(CITE)) {
          out += esc(raw.slice(last, m.index));
          const file = m[1].trim();
          const heading = m[2] ?? m[3] ?? "";
          out += '<span class="cite" title="' + esc(file + " › " + heading) + '">[' + esc(file.replace(/^research\//, "").replace(/\.md$/, "")) + " › " + esc(heading.length > 48 ? heading.slice(0, 46) + "…" : heading) + "]</span>";
          last = (m.index ?? 0) + m[0].length;
        }
        return out + esc(raw.slice(last));
      };
    },
  },
  // *-generated.md files are partials pulled in with <!--@include: -->; SUMMARY.md is GitBook's table of contents,
  // not a page; internal/ only with SHOW_INTERNAL.
  srcExclude: ["**/*-generated.md", "SUMMARY.md", ...(SHOW_INTERNAL ? [] : ["internal/**"])],
  ignoreDeadLinks: [(url: string) => PLANNED_MISSING.has(url.replace(/^\//, ""))],
  vite: { server: { port: 3011, strictPort: true, host: "127.0.0.1" }, preview: { port: 3011, strictPort: true } },
  themeConfig: {
    search: { provider: "local" },
    nav: [
      { text: "Start here", link: "/start/" },
      { text: "Features", link: "/features/" },
      { text: "How it works underneath", link: "/mechanism/" },
      { text: "Privacy", link: "/privacy/" },
      { text: "For developers", link: "/technical/architecture" },
      { text: "Roadmap", link: "/roadmap/" },
      ...(SHOW_INTERNAL ? [{ text: "Internal", link: "/internal/" }] : []),
    ],
    sidebar: {
      "/start/": startSidebar,
      "/mission/": roadmapSidebar,
      "/features/": featuresSidebar,
      "/mechanism/": mechanismSidebar,
      "/concepts/": mechanismSidebar,
      "/privacy/": privacySidebar,
      "/technical/": technicalSidebar,
      // three design records live at the docs root (their paths are cited elsewhere); they read as developer pages
      "/custody-model": technicalSidebar,
      "/root-reads": technicalSidebar,
      "/fanout-under-zk": technicalSidebar,
      "/roadmap/": roadmapSidebar,
      "/notes/": roadmapSidebar,
      ...(SHOW_INTERNAL ? { "/internal/": internalSidebar } : {}),
    },
    outline: { level: [2, 3] },
    footer: { message: "Status words mean one thing each: Works live, Built (test data only), Designed, Off on purpose, Coming soon, Not offered here. Every privacy claim cites the security posture; docs:check enforces it." },
  },
});
