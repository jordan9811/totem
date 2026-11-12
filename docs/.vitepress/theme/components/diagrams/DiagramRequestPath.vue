<script setup lang="ts">
// THE REQUEST PATH, on the public site. The browser is the device: it holds the keys and answers the app's own
// /api/* calls in the page (docs/custody-model.md D-CU-0-2, D-CU-0-3). The app server renders public state only
// (D-CU-0-4) and holds no seed or persona key (SECURITY-POSTURE.md §16 "The one rule"); the validator holds
// ciphertext, commitments and public keys (§16 "What the server holds"). Three roads reach Farcaster through Neynar,
// and none is open on the public site today: the read relay is built and dormant until the owner arms it (§19),
// posting from the browser is not built (signing in the browser plus a write relay; notes/runbooks/GO-LIVE-FARCASTER.md (h)), so
// "Your posts" is coming soon, and the public device refuses anon posts (ADAPTER_REP is not zk there; lib/zk/gate.ts),
// so the anon relay is "coming soon" here (PERSONA LAUNCH P0: the plan's P7 brings a browser prover to strangers; it is
// built, test data only, on the owner service; notes/runbooks/GO-LIVE-FARCASTER.md (f)). On the owner service the server is the
// device (§18). Update the chips here when any road opens, in step with lib/status/features.ts anon-account.
// POST AS YOU (2026-11-05): posting as the visitor's OWN account is a road without Neynar (the tab signs, the validator's
// thin relay passes it to a Snapchain node; SECURITY-POSTURE.md §35), built, test data only, not deployed: said in the
// label only, since the figure draws the three Neynar roads.
import LydFigure from "./LydFigure.vue";
import LydBox from "./LydBox.vue";
import LydArrow from "./LydArrow.vue";
import LydChip from "./LydChip.vue";
import type { Status } from "./geom";

defineProps<{ caption?: string }>();

const LABEL =
  "The request path on the public site. Your browser is the device: it holds your keys, runs the app's back end and seals your vault. " +
  "It loads app code and public posts from the app server, which holds no seed or persona key, and keeps sealed blobs and proofs on the validator, which has no key to open them. " +
  "Three roads reach Farcaster through Neynar, and none is open on the public site: the read-only relay is off until the owner arms it, posting from your browser is coming soon, " +
  "and the anon relay is coming soon here (it is built, test data only, on the owner's private service). " +
  "Posting as your own Farcaster account takes a road without Neynar: your browser signs each post with a key from your vault and Totem's validator passes it to a Farcaster node, built, test data only, not deployed. " +
  "On the owner's private service, the server is the device and holds the keys.";

const roads: { n: number; name: string; status: Status }[] = [
  { n: 1, name: "Read relay", status: "off" },
  { n: 2, name: "Your posts", status: "soon" },
  { n: 3, name: "Anon relay", status: "soon" },
];
const BADGES: [number, number][] = [
  [91, 330],
  [180, 330],
  [269, 330],
];
</script>

<template>
  <LydFigure :caption="caption">
    <svg class="lyd__wide" viewBox="0 0 720 440" role="img" :aria-label="LABEL">
      <LydBox
        :x="110"
        :y="12"
        :w="480"
        :h="84"
        tone="us"
        title="Your browser: the device"
        :lines="['holds your keys · runs the app’s back end · seals your vault']"
      />
      <LydBox
        :x="30"
        :y="168"
        :w="260"
        :h="84"
        title="App server"
        :lines="['sends the app and public posts', 'holds no seed or persona key']"
      />
      <LydBox
        :x="410"
        :y="168"
        :w="260"
        :h="84"
        title="Validator"
        :lines="['stores sealed blobs, ZK lists', 'has no key to open them']"
      />
      <LydBox :x="230" :y="324" :w="240" :h="68" title="Farcaster (via Neynar)" :lines="['gets only what is posted']" />

      <LydArrow :pts="[[160, 96], [160, 168]]" both :label="['app code,', 'public posts']" :lx="150" :ly="124" anchor="end" />
      <LydArrow :pts="[[540, 96], [540, 168]]" both :label="['sealed blobs,', 'proofs']" :lx="550" :ly="124" anchor="start" />

      <LydArrow :pts="[[350, 96], [350, 324]]" dashed muted label="your posts" :lx="360" :ly="128" anchor="start" />
      <LydChip :x="360" :y="136" status="soon" />

      <LydArrow
        :pts="[[160, 252], [160, 358], [230, 358]]"
        dashed
        muted
        label="read-only relay"
        :lx="150"
        :ly="290"
        anchor="end"
      />
      <LydChip :x="150" :y="298" status="off" anchor="end" />

      <LydArrow
        :pts="[[540, 252], [540, 358], [470, 358]]"
        dashed
        muted
        label="anon relay"
        :lx="550"
        :ly="290"
        anchor="start"
      />
      <LydChip :x="550" :y="298" status="soon" />

      <text class="lyd-note" x="360" y="426" text-anchor="middle">On the owner’s private service, the server is the device and holds the keys.</text>
    </svg>

    <svg class="lyd__tall" viewBox="0 0 360 604" role="img" :aria-label="LABEL">
      <LydBox
        :x="16"
        :y="12"
        :w="328"
        :h="96"
        tone="us"
        title="Your browser: the device"
        :lines="['holds your keys', 'runs the app’s back end', 'seals your vault']"
      />
      <LydBox
        :x="16"
        :y="176"
        :w="150"
        :h="104"
        title="App server"
        :lines="['sends the app', 'and public posts', 'holds no seed or', 'persona key']"
      />
      <LydBox
        :x="194"
        :y="176"
        :w="150"
        :h="104"
        title="Validator"
        :lines="['stores sealed', 'blobs, ZK lists', 'has no key to', 'open them']"
      />
      <LydBox :x="110" :y="372" :w="140" :h="64" title="Farcaster" :lines="['via Neynar']" />

      <LydArrow :pts="[[91, 108], [91, 176]]" both />
      <LydArrow :pts="[[269, 108], [269, 176]]" both />
      <LydArrow :pts="[[180, 108], [180, 372]]" dashed muted />
      <LydArrow :pts="[[91, 280], [91, 404], [110, 404]]" dashed muted />
      <LydArrow :pts="[[269, 280], [269, 404], [250, 404]]" dashed muted />

      <g v-for="(b, i) in BADGES" :key="i" class="lyd-badge">
        <circle :cx="b[0]" :cy="b[1]" r="10" />
        <text :x="b[0]" :y="b[1] + 4" text-anchor="middle">{{ i + 1 }}</text>
      </g>

      <g v-for="(road, i) in roads" :key="road.n">
        <g class="lyd-badge">
          <circle cx="26" :cy="468 + i * 30" r="10" />
          <text x="26" :y="472 + i * 30" text-anchor="middle">{{ road.n }}</text>
        </g>
        <text class="lyd-s" x="44" :y="473 + i * 30">{{ road.name }}</text>
        <LydChip :x="136" :y="458 + i * 30" :status="road.status" />
      </g>

      <text class="lyd-note" x="180" y="572" text-anchor="middle">On the owner’s private service,</text>
      <text class="lyd-note" x="180" y="591" text-anchor="middle">the server is the device and holds the keys.</text>
    </svg>
  </LydFigure>
</template>
