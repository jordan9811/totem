<script setup lang="ts">
// WHO SEES WHAT. The Top-16 idea as a ladder: strangers see your public persona and nothing else of you; each tier
// you put someone in shows them one more persona and that it is the same you.
// Truth today (scratchpad dx-whitelist / dx-critic WHITELIST): a grant resolves only inside the process that holds
// the issuer's vault (lib/identity/resolver.ts), so link grants work inside one Totem site, on seeded test personas.
// The cross-site "show to a friend" dead drop is designed, not built. The tier ladder itself is not built and has no
// written design, so its rows are "soon" (lib/status/features.ts: an unbuilt part of the pitch is never "designed").
// No button in the app issues a grant yet (no component calls /api/identity/grant). Showing other personas' posts as anon to
// strangers is not built. Update the chips here when either changes.
// PERSONA LAUNCH wave 2 (2026-10-12): the ladder is now RINGS (lib/rings/*, SECURITY-POSTURE.md section 24), built and
// tested on test data, deployed 2026-10-12 (not yet used): up to 16 rings, each given chosen public personas at "name" or "posts", and a
// stranger sees plain @anon on an anon post. So every row is "test" (lib/status/features.ts rings: fixture on both
// sites). The tiers drawn here are one way to set rings up; a ring can hold any personas at either depth.
import LydFigure from "./LydFigure.vue";
import LydBox from "./LydBox.vue";
import LydChip from "./LydChip.vue";
import type { Status } from "./geom";

defineProps<{ caption?: string }>();

const LABEL =
  "Who sees what, as a ladder of rings. Someone in none of your rings sees your public persona, and your other personas' anonymous posts as plain anon. " +
  "Ring 1 sees that Alt A is you, ring 2 also sees Alt B, ring 3 sees all of you including your finsta. " +
  "Built, test data only, deployed 2026-10-12: up to 16 rings, each given chosen personas at one of two depths.";

const slots = [
  { name: "Public", letter: "P" },
  { name: "Alt A", letter: "A" },
  { name: "Alt B", letter: "B" },
  { name: "Finsta", letter: "F" },
];

const rows: { title: string; who: string; shown: number; says: string[]; status: Status }[] = [
  { title: "Not on your list", who: "strangers", shown: 1, says: ["other personas show", "as anon, or not at all"], status: "test" },
  { title: "Ring 1", who: "friends", shown: 2, says: ["sees Alt A is you"], status: "test" },
  { title: "Ring 2", who: "close friends", shown: 3, says: ["sees Alt B too"], status: "test" },
  { title: "Ring 3", who: "inner circle", shown: 4, says: ["sees all of you"], status: "test" },
];

// wide geometry
const WY = rows.map((_, r) => 40 + r * 88);
const WAX = [240, 320, 400, 480];
// tall geometry
const TY = rows.map((_, r) => 16 + r * 104);
const TAX = [52, 132, 212, 292];
const TALL_TITLE = ["Not on your list", "Ring 1 · friends", "Ring 2 · close friends", "Ring 3 · inner circle"];
</script>

<template>
  <LydFigure :caption="caption">
    <svg class="lyd__wide" viewBox="0 0 720 452" role="img" :aria-label="LABEL">
      <text class="lyd-cap" x="12" y="24">WHO IS LOOKING</text>
      <text class="lyd-cap" x="216" y="24">WHAT THEY SEE</text>
      <g v-for="(row, r) in rows" :key="row.title">
        <LydBox
          :x="12 + 16 * r"
          :y="WY[r]"
          :w="174 - 16 * r"
          :h="72"
          :title="row.title"
          :lines="[row.who]"
          align="start"
          :tone="r === 0 ? 'plain' : 'us'"
        />
        <line
          v-if="row.shown > 1"
          class="lyd-tie"
          :x1="WAX[0]"
          :y1="WY[r] + 28"
          :x2="WAX[row.shown - 1]"
          :y2="WY[r] + 28"
        />
        <g v-for="(s, i) in slots" :key="s.name">
          <circle v-if="i < row.shown" class="lyd-av-under" :cx="WAX[i]" :cy="WY[r] + 28" r="20" />
          <circle :class="i < row.shown ? 'lyd-av' : 'lyd-av--ghost'" :cx="WAX[i]" :cy="WY[r] + 28" r="20" />
          <text
            :class="['lyd-av-letter', { 'lyd-av-letter--ghost': i >= row.shown }]"
            :x="WAX[i]"
            :y="WY[r] + 33"
            text-anchor="middle"
          >{{ i < row.shown ? s.letter : "?" }}</text>
          <text
            :class="['lyd-av-name', { 'lyd-av-name--ghost': i >= row.shown }]"
            :x="WAX[i]"
            :y="WY[r] + 66"
            text-anchor="middle"
          >{{ i < row.shown ? s.name : "anon" }}</text>
        </g>
        <text v-for="(t, k) in row.says" :key="k" class="lyd-s" x="530" :y="WY[r] + 20 + k * 17">{{ t }}</text>
        <LydChip :x="530" :y="WY[r] + (row.says.length > 1 ? 42 : 32)" :status="row.status" />
      </g>
      <line class="lyd-tie" x1="12" y1="405" x2="40" y2="405" />
      <text class="lyd-s" x="48" y="410">linked: they can tell it is the same you</text>
      <circle class="lyd-av--ghost" cx="384" cy="405" r="8" />
      <text class="lyd-s" x="400" y="410">anon: no name shown</text>
      <text class="lyd-note" x="12" y="440">Built today: one-to-one link grants, in tests and demo data only; no button yet.</text>
    </svg>

    <svg class="lyd__tall" viewBox="0 0 360 512" role="img" :aria-label="LABEL">
      <g v-for="(row, r) in rows" :key="row.title">
        <text class="lyd-t" x="16" :y="TY[r] + 16">{{ TALL_TITLE[r] }}</text>
        <LydChip :x="344" :y="TY[r] + 1" :status="row.status" anchor="end" />
        <line
          v-if="row.shown > 1"
          class="lyd-tie"
          :x1="TAX[0]"
          :y1="TY[r] + 50"
          :x2="TAX[row.shown - 1]"
          :y2="TY[r] + 50"
        />
        <g v-for="(s, i) in slots" :key="s.name">
          <circle v-if="i < row.shown" class="lyd-av-under" :cx="TAX[i]" :cy="TY[r] + 50" r="19" />
          <circle :class="i < row.shown ? 'lyd-av' : 'lyd-av--ghost'" :cx="TAX[i]" :cy="TY[r] + 50" r="19" />
          <text
            :class="['lyd-av-letter', { 'lyd-av-letter--ghost': i >= row.shown }]"
            :x="TAX[i]"
            :y="TY[r] + 55"
            text-anchor="middle"
          >{{ i < row.shown ? s.letter : "?" }}</text>
          <text
            :class="['lyd-av-name', { 'lyd-av-name--ghost': i >= row.shown }]"
            :x="TAX[i]"
            :y="TY[r] + 86"
            text-anchor="middle"
          >{{ i < row.shown ? s.name : "anon" }}</text>
        </g>
        <line v-if="r < rows.length - 1" class="lyd-rule" x1="16" :y1="TY[r] + 98" x2="344" :y2="TY[r] + 98" />
      </g>
      <line class="lyd-tie" x1="16" y1="441" x2="40" y2="441" />
      <text class="lyd-s" x="48" y="446">same you, linked</text>
      <circle class="lyd-av--ghost" cx="212" cy="441" r="8" />
      <text class="lyd-s" x="226" y="446">anon: no name</text>
      <text class="lyd-note" x="16" y="478">Built today: one-to-one link grants</text>
      <text class="lyd-note" x="16" y="497">in tests and demo data only; no button yet.</text>
    </svg>
  </LydFigure>
</template>
