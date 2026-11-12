<script setup lang="ts">
// BRING YOUR X: find the people you follow on X who are already on Farcaster, matched on your own device.
// The design (scratchpad dx-x-interop, dx-critic X1): Farcaster's keyless public endpoint
// /fc/account-verifications lists every account that verified an X account, with the numeric X id; a nightly job
// copies it into one static file; every importing device downloads the whole file and intersects it with the
// numeric ids in the archive's following.js, so the server never learns whose follows matched.
// Status: PERSONA LAUNCH P2 built Bring your X v1 on test data (lib/status/features.ts x-find-people: "fixture"): the
// matcher runs on the device against a stand-in list; the real list (VALIDATOR_X_INDEX) is off on every deployment,
// and following matches from Totem is a later wave. On the owner service the device is the server, which is why the
// region says "your device". Update the chip when the status row changes.
import LydFigure from "./LydFigure.vue";
import LydBox from "./LydBox.vue";
import LydArrow from "./LydArrow.vue";
import LydChip from "./LydChip.vue";

defineProps<{ caption?: string }>();

const LABEL =
  "Bring your X, built on test data. Farcaster's public list of every account that verified an X account is copied nightly into one file on the Totem server, the same file for everyone. " +
  "Your device downloads the whole file and matches it against the follow list in your X archive, which is opened only on your device. " +
  "The result: N of your X follows are on Farcaster. Built, test data only: the list is off until the owner switches it on, and following them from Totem comes later.";
</script>

<template>
  <LydFigure :caption="caption">
    <svg class="lyd__wide" viewBox="0 0 720 432" role="img" :aria-label="LABEL">
      <rect class="lyd-zone" x="12" y="12" width="432" height="372" rx="14" />
      <text class="lyd-zone-label" x="28" y="36">YOUR DEVICE</text>
      <text class="lyd-s" x="28" y="55">your browser, on the public site</text>

      <LydBox :x="36" :y="72" :w="196" :h="72" title="Your X archive" :lines="['the .zip X gives you', 'opened only here']" />
      <LydBox :x="260" :y="180" :w="160" :h="88" tone="us" title="Match here" :lines="['your follows vs', 'the whole list']" />
      <LydBox :x="36" :y="304" :w="392" :h="64" title="N of your X follows are on Farcaster" :lines="['following them from Totem comes later']" />

      <LydChip :x="712" :y="4" status="test" anchor="end" />
      <LydBox
        :x="520"
        :y="36"
        :w="188"
        :h="72"
        title="Farcaster"
        :lines="['every account that', 'verified an X account']"
      />
      <LydBox
        :x="520"
        :y="180"
        :w="188"
        :h="88"
        title="Totem server"
        :lines="['one file with all', 'of them, the same', 'for everyone']"
      />

      <LydArrow :pts="[[614, 108], [614, 180]]" label="copied nightly" :lx="604" :ly="149" anchor="end" />
      <LydArrow :pts="[[520, 224], [420, 224]]" :label="['downloaded', 'whole']" :lx="482" :ly="196" />
      <LydArrow :pts="[[134, 144], [134, 224], [260, 224]]" label="who you follow" :lx="144" :ly="190" anchor="start" bare />
      <LydArrow :pts="[[340, 268], [340, 304]]" />

      <text class="lyd-note" x="228" y="414" text-anchor="middle">Built on test data; the list is off until the owner switches it on.</text>
    </svg>

    <svg class="lyd__tall" viewBox="0 0 360 590" role="img" :aria-label="LABEL">
      <LydChip :x="344" :y="4" status="test" anchor="end" />
      <LydBox :x="16" :y="32" :w="328" :h="64" title="Farcaster" :lines="['every account that verified an X account']" />
      <LydArrow :pts="[[180, 96], [180, 136]]" label="copied nightly" :lx="190" :ly="121" anchor="start" />
      <LydBox
        :x="16"
        :y="136"
        :w="328"
        :h="72"
        title="Totem server"
        :lines="['one file with all of them,', 'the same for everyone']"
      />

      <rect class="lyd-zone" x="8" y="238" width="344" height="290" rx="14" />
      <text class="lyd-zone-label" x="24" y="262">YOUR DEVICE</text>
      <text class="lyd-s" x="24" y="281">your browser, on the public site</text>

      <LydArrow :pts="[[268, 208], [268, 304]]" label="downloaded whole" :lx="258" :ly="227" anchor="end" />

      <LydBox :x="20" :y="304" :w="150" :h="84" title="Your X archive" :lines="['the .zip from X', 'opened only here']" />
      <LydBox :x="192" :y="304" :w="152" :h="84" tone="us" title="Match here" :lines="['your follows vs', 'the whole list']" />
      <LydArrow :pts="[[170, 346], [192, 346]]" />

      <LydBox
        :x="20"
        :y="430"
        :w="324"
        :h="80"
        title="N of your X follows"
        :lines="['are on Farcaster;', 'following comes later']"
      />
      <LydArrow :pts="[[268, 388], [268, 430]]" />

      <text class="lyd-note" x="180" y="558" text-anchor="middle">Built on test data; the list is off</text>
      <text class="lyd-note" x="180" y="577" text-anchor="middle">until the owner switches it on.</text>
    </svg>
  </LydFigure>
</template>
