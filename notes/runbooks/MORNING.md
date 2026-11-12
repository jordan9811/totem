# MORNING — the post-deploy pass is closed

**Closed on `e2d909e`, four consecutive clean sweeps, 623 checks over 83 suites
each.** Prompt: `notes/prompts/post-deploy-prompt.md`. Full write-up: `notes/reports/REPORT-POST.md`.

---

## What you can do now that you could not yesterday

**Tell your personas apart at a glance.** Each one carries an accent colour on
the app chrome — rails, headers, tab bar — and never on a post. The handle is
in the chrome in text at every width, and the active mode rides the same
element as a border treatment, so persona and mode are both readable without
colliding. The palette was chosen by measurement, not taste: eight accents that
stay apart under normal vision, deuteranopia, protanopia and tritanopia, and a
hand-picked colour that would collapse onto a sibling's is refused with the
vision model and the distance named.

**See everything you have touched, across every persona — deliberately off.**
Search, bookmarks, likes, stakes and relationship events span the whole root,
each row naming the persona that did it. It is off by default, because a
unified view puts an anonymous persona next to a work one on one screen, and
that is a hazard no encryption removes. **Compartment mode** is one tap and
strictly stronger: the search index, the account switcher, the act-as picker,
a sibling's stake history and nine other surfaces narrow to the active persona
*at the API*, not by hiding a menu.

**Start a new persona from an existing one.** Modes, rules and folders copy as
new artifacts, so the two can diverge. A copied mode never arrives pinned to
the persona it came from or with its auto-switch armed. Follows are not
copyable and the reason is stated rather than hidden behind a dead checkbox: in
this codebase a follow belongs to the device, so there is nothing to copy.

**Decide where each account shows up, per mode.** Never miss / banner / normal
/ facet only / quiet — a property of the PAIR (account, mode), so "never miss
in personal, quiet in work" is one setting on one account. They compile into
ordinary rules and go through the same evaluator as everything else; there is
no second filtering system.

**Two readwise knobs, and no model behind them.** How many chunks arrive per
refresh, and how long a chunk is. A folder can be marked priority. A chunk
counts as read once you have spent about half its reading time on it — scaled
to its length, because a fixed threshold measures chunk size rather than
reading. X-ing one out buries it into a bin that restores. Reading progress
carries across personas, because there is one vault and one reader.

---

## What to look at first

1. `/settings/persona-mode` — the tint editor and the compartment switch.
2. Open two browser profiles on two personas: the chrome is tinted differently
   and the pill names each one.
3. Any post's menu → **where this account shows up**, then `/settings/delivery`
   for everything you have set.
4. `/settings/readwise` — the two sliders, the priority folders, the bin.

---

## What I would want you to know before you trust it

**The review gate found more than the gates did.** Three fresh-context
reviewers over the diff found 3 critical and 8 high defects, and two of the
criticals were introduced by this pass. Re-verifying my own fixes with
independent verifiers found the first round had genuinely closed only 4 of 47
findings. All of that is in `notes/reports/REPORT-POST.md` and
`research/attack-post-disposition.md`, with evidence per finding.

**One finding was deliberately not taken.** Forking a persona you do not own
still inherits that persona's tier. The reviewer is right that this hands you a
stranger's standing; it is also a contract this product states and tests, and
the fork demo exists to show it. The settings copy IS gated. The tier is
carried under `A-POST-THE-FIXTURE-FORK-IS-A-DEMO`, which says what it costs.
If you would rather the finding win, it is a one-line change plus a suite
update — your call, not mine.

**Five things are carried as assumptions rather than fixed**, because they are
inherent rather than unfinished: the sealed records' padding step leaks a
magnitude (never a name); the new pin file is a loud refusal and not integrity;
the fixture fork is a demo affordance; the acting-persona cookie is still a
cookie within its own root; and tampering with a sealed record is caught at the
next COLD read, not instantly — a long-lived server can run its whole life on a
document the validator no longer holds. All by id in `SECURITY-POSTURE.md` §17.

**One open issue came out of the closing sweeps.** `resetSeed` clears adapter
state but not validator TABLES, so a long-lived rig drifts: fifteen sweeps of
block-testing suites accumulated 97 block rows, and the classic feed then
rendered empty with no error anywhere. Written up in
`docs/internal/open-issues.md`.

---

## Where the work stands

| | |
|---|---|
| Gates | 0–5, all committed |
| Suites | `test:pd0` 4/4, `pd1` 6/6, `pd2` 10/10, `pd3` 10/10, `pd4` 8/8 |
| Sweep baseline | 585 → **623** checks, 83 suites |
| Reviews | 3 reports, 47 findings, every one dispositioned with evidence |
| Live spend | none — fixture throughout, no network writes |
"""
