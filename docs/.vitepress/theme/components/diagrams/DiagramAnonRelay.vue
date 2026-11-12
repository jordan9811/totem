<script setup lang="ts">
// THE ANON RELAY, start to finish. Numbers are the shipped defaults:
//   320 characters          ZK_ANON_POST_MAX_CHARS (lib/zk/config.ts)
//   4 posts per 6 hours      PERSONA LAUNCH P3: K = ZK_ANON_POST_SLOTS = 4 slots per person per window, shared across
//                            personas; ZK_ANON_POST_WINDOW_EPOCHS = 1 x ZK_EPOCH_MS = 6 h (lib/zk/anon/slots.ts, validator/zk.js)
//   30 s to 15 min           ZK_JITTER_MIN_MS / ZK_JITTER_MAX_MS, drawn uniformly (lib/zk/anon/queue.ts)
//   next hour, shuffled      ZK_ANON_RELAY_INTERVAL_MS = 1 h plus up to 10 min, pending rows in random order;
//                            the row keeps no persona, root or nullifier (validator/zk.js, D-FID-5-STORE-AND-FORWARD)
// Status: built and tested on test data only; it has never run live (notes/runbooks/GO-LIVE-FARCASTER.md (f)). On a one-owner
// service the proof hides nothing, because there is no crowd (scratchpad dx-connect-main-and-anon). Update the chip
// and the footnote when that changes.
import LydFigure from "./LydFigure.vue";
import LydChip from "./LydChip.vue";
import LydArrow from "./LydArrow.vue";

defineProps<{ caption?: string }>();

const LABEL =
  "An anon post, start to finish. 1, on your device: write an anon post of up to 320 characters. " +
  "2, on your device: prove you are a member and take a free slot, 4 per person per 6 hours, shared across your personas. " +
  "3, on your device: send it after a random wait of 30 seconds to 15 minutes. " +
  "4, at the validator: it is stored with no persona and released at the next hourly slot, in shuffled order. " +
  "5, on Farcaster: the account with no name on it posts it. Built, test data only. " +
  "On a one-owner service there is no crowd: it is an extra account with no name on it.";

type Lane = "device" | "server" | "network";
const steps: { title: string; lane: Lane; tag: string; wide: string[]; tall: string }[] = [
  { title: "1 · Write", lane: "device", tag: "YOUR DEVICE", wide: ["an anon post, up to", "320 characters"], tall: "an anon post, up to 320 characters" },
  { title: "2 · Prove", lane: "device", tag: "YOUR DEVICE", wide: ["“I’m a member”: 4", "posts per 6 hours"], tall: "“I’m a member”, 4 per 6 hours" },
  { title: "3 · Send", lane: "device", tag: "YOUR DEVICE", wide: ["after a random wait", "of 30 s to 15 min"], tall: "sent after a random 30 s to 15 min" },
  { title: "4 · Hold", lane: "server", tag: "VALIDATOR", wide: ["no persona stored;", "next hour, shuffled"], tall: "no persona kept; next hour, shuffled" },
  { title: "5 · Post", lane: "network", tag: "FARCASTER", wide: ["by the account with", "no name on it"], tall: "by the account with no name on it" },
];

// wide: dots on a time axis, cards alternating above and below
const WX = [80, 220, 360, 500, 640];
const AXIS = 160;
const wideCards = steps.map((s, i) => {
  const above = i % 2 === 0;
  const x = Math.min(Math.max(WX[i] - 100, 8), 512);
  const y = above ? 52 : 180;
  return { ...s, x, y, above };
});
// tall: dots down a vertical axis, cards to the right
const TY = steps.map((_, i) => 78 + i * 88);
</script>

<template>
  <LydFigure :caption="caption">
    <svg class="lyd__wide" viewBox="0 0 720 344" role="img" :aria-label="LABEL">
      <LydChip :x="712" :y="10" status="test" anchor="end" />
      <LydArrow :pts="[[30, AXIS], [704, AXIS]]" label="time" :lx="704" :ly="182" anchor="end" />
      <g v-for="(c, i) in wideCards" :key="c.title">
        <line
          class="lyd-rule"
          :x1="WX[i]"
          :y1="c.above ? c.y + 88 : AXIS + 7"
          :x2="WX[i]"
          :y2="c.above ? AXIS - 7 : c.y"
        />
        <circle :class="`lyd-dot--${c.lane}`" :cx="WX[i]" :cy="AXIS" r="7" />
        <g :class="['lyd-box', c.lane === 'device' ? 'lyd-box--us' : 'lyd-box--plain']">
          <rect class="lyd-box__rect" :x="c.x" :y="c.y" width="200" height="88" rx="10" />
        </g>
        <text class="lyd-t" :x="c.x + 14" :y="c.y + 23">{{ c.title }}</text>
        <text class="lyd-cap" :x="c.x + 14" :y="c.y + 40">{{ c.tag }}</text>
        <text v-for="(t, k) in c.wide" :key="k" class="lyd-s" :x="c.x + 14" :y="c.y + 60 + k * 18">{{ t }}</text>
      </g>
      <text class="lyd-note" x="360" y="306" text-anchor="middle">On a one-owner service there is no crowd: it is an extra account with no name on it.</text>
      <text class="lyd-note" x="360" y="328" text-anchor="middle">A real crowd needs many people sharing one validator.</text>
    </svg>

    <svg class="lyd__tall" viewBox="0 0 360 600" role="img" :aria-label="LABEL">
      <LydChip :x="16" :y="10" status="test" />
      <LydArrow :pts="[[34, 46], [34, 486]]" label="time" :lx="46" :ly="490" anchor="start" />
      <g v-for="(s, i) in steps" :key="s.title">
        <line class="lyd-rule" x1="41" :y1="TY[i]" x2="58" :y2="TY[i]" />
        <circle :class="`lyd-dot--${s.lane}`" cx="34" :cy="TY[i]" r="7" />
        <g :class="['lyd-box', s.lane === 'device' ? 'lyd-box--us' : 'lyd-box--plain']">
          <rect class="lyd-box__rect" x="58" :y="TY[i] - 34" width="286" height="68" rx="10" />
        </g>
        <text class="lyd-t" x="72" :y="TY[i] - 14">{{ s.title }}</text>
        <text class="lyd-cap" x="72" :y="TY[i] + 3">{{ s.tag }}</text>
        <text class="lyd-s lyd-s--sm" x="72" :y="TY[i] + 22">{{ s.tall }}</text>
      </g>
      <text class="lyd-note" x="16" y="528">On a one-owner service there is no crowd:</text>
      <text class="lyd-note" x="16" y="547">it is an extra account with no name on it.</text>
      <text class="lyd-note" x="16" y="566">A real crowd needs many people</text>
      <text class="lyd-note" x="16" y="585">sharing one validator.</text>
    </svg>
  </LydFigure>
</template>
