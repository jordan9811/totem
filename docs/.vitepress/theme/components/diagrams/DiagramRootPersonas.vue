<script setup lang="ts">
// ONE PRIVATE YOU, MANY PERSONAS. The root (the 24 words) derives every persona's keys and the anon (ZK) identity by
// a one-way step; which personas are yours lives only in the sealed vault.
// Sources: docs/custody-model.md "The key hierarchy does not change; its home does" (seed -> HKDF branches);
// SECURITY-POSTURE.md §16 "What the server holds" (one opaque sealed record per namespace); notes/reports/REPORT-Z2.md Gate 2
// (migration 006: the validator has no persona -> root table); lib/zk/labels.ts (the DEMO, not yet private label).
// Status: personas work on the public site today; the anon identity's live posting has never run (notes/runbooks/GO-LIVE-FARCASTER.md (f)).
// Update the status row here when that changes.
import LydFigure from "./LydFigure.vue";
import LydBox from "./LydBox.vue";
import LydArrow from "./LydArrow.vue";
import LydChip from "./LydChip.vue";
import LydLock from "./LydLock.vue";

defineProps<{ caption?: string }>();

const LABEL =
  "One private root, your 24 words, makes many personas by a one-way step: a public persona, a finsta, an alt and an anon identity. " +
  "The links between them are sealed in your vault; anything stored outside your device is ciphertext. " +
  "Personas work today. The anon part is built and runs on test data only. The app still labels this DEMO: not yet private.";

const personas = [
  { title: "Public", line: "your main face" },
  { title: "Finsta", line: "inner circle only" },
  { title: "Alt", line: "a separate you" },
  { title: "Anon", line: "no name on it" },
];

// wide: four across
const WX = [25, 195, 365, 535];
const WCX = WX.map((x) => x + 80);
const WLINK = [240, 320, 400, 480];
// tall: four down
const TY = [112, 176, 240, 304];
const TCY = TY.map((y) => y + 26);
</script>

<template>
  <LydFigure :caption="caption">
    <svg class="lyd__wide" viewBox="0 0 720 424" role="img" :aria-label="LABEL">
      <LydBox :x="220" :y="14" :w="280" :h="66" tone="us" title="You" :lines="['one private root: your 24 words']" />
      <LydArrow :pts="[[360, 80], [360, 112]]" no-head />
      <LydArrow :pts="[[105, 112], [615, 112]]" no-head />
      <text class="lyd-l" x="372" y="101">one-way step (HKDF)</text>
      <LydArrow v-for="cx in WCX" :key="cx" :pts="[[cx, 112], [cx, 150]]" />
      <LydBox
        v-for="(p, i) in personas"
        :key="p.title"
        :x="WX[i]"
        :y="150"
        :w="160"
        :h="76"
        :title="p.title"
        :lines="[p.line]"
      />
      <path
        v-for="(cx, i) in WCX"
        :key="'l' + cx"
        class="lyd-link"
        :d="`M${cx} 226 L${WLINK[i]} 266`"
      />
      <LydBox
        :x="170"
        :y="266"
        :w="380"
        :h="76"
        title="The links between them"
        :lines="['sealed in your vault;', 'outside your device, only ciphertext']"
      >
        <LydLock :x="190" :y="295" />
      </LydBox>
      <text class="lyd-s" x="169" y="376">Personas</text>
      <LydChip :x="236" :y="362" status="live" />
      <text class="lyd-s" x="352" y="376">Anon</text>
      <LydChip :x="390" :y="362" status="test" />
      <text class="lyd-note" x="360" y="410" text-anchor="middle">Today the app still labels this DEMO: not yet private.</text>
    </svg>

    <svg class="lyd__tall" viewBox="0 0 360 584" role="img" :aria-label="LABEL">
      <LydBox :x="24" :y="14" :w="330" :h="66" tone="us" title="You" :lines="['one private root: your 24 words']" />
      <LydArrow :pts="[[54, 80], [54, 330]]" no-head />
      <text class="lyd-l" x="66" y="100">one-way step (HKDF)</text>
      <LydArrow v-for="cy in TCY" :key="cy" :pts="[[54, cy], [78, cy]]" />
      <LydBox
        v-for="(p, i) in personas"
        :key="p.title"
        :x="78"
        :y="TY[i]"
        :w="260"
        :h="52"
        :title="p.title"
        :lines="[p.line]"
        align="start"
      />
      <path class="lyd-link" d="M338 138 H348 M338 202 H348 M338 266 H348 M338 330 H348 M348 138 V376" />
      <LydBox
        :x="24"
        :y="376"
        :w="330"
        :h="78"
        title="The links between them"
        :lines="['sealed in your vault;', 'outside your device, only ciphertext']"
      >
        <LydLock :x="38" :y="406" />
      </LydBox>
      <text class="lyd-s" x="24" y="488">Personas</text>
      <LydChip :x="110" :y="474" status="live" />
      <text class="lyd-s" x="24" y="516">Anon</text>
      <LydChip :x="110" :y="502" status="test" />
      <text class="lyd-note" x="180" y="550" text-anchor="middle">Today the app still labels this</text>
      <text class="lyd-note" x="180" y="568" text-anchor="middle">DEMO: not yet private.</text>
    </svg>
  </LydFigure>
</template>
