<script setup lang="ts">
// A labelled arrow along a polyline. `both` puts a head on each end (a two-way exchange), `noHead` draws a plain
// connector, `dashed` + `muted` mark a path that is off, planned or test-only. A label is one line or several.
import { computed } from "vue";
import { arrowHead, pullBack, type Pt } from "./geom";

const props = withDefaults(
  defineProps<{
    pts: [number, number][];
    label?: string | string[];
    lx?: number;
    ly?: number;
    anchor?: "start" | "middle" | "end";
    dashed?: boolean;
    muted?: boolean;
    both?: boolean;
    noHead?: boolean;
    /** drop the label's halo (for a label inside a tinted region that crosses no line) */
    bare?: boolean;
  }>(),
  { label: "", lx: 0, ly: 0, anchor: "middle", dashed: false, muted: false, both: false, noHead: false, bare: false },
);

const HEAD = 9;

const shape = computed(() => {
  const pts = props.pts.map((p) => [p[0], p[1]] as Pt);
  const n = pts.length;
  const endHead = props.noHead ? "" : arrowHead(pts[n - 2], pts[n - 1], HEAD);
  const startHead = props.both ? arrowHead(pts[1], pts[0], HEAD) : "";
  const line = pts.slice();
  if (!props.noHead) line[n - 1] = pullBack(pts[n - 2], pts[n - 1], HEAD * 0.6);
  if (props.both) line[0] = pullBack(pts[1], pts[0], HEAD * 0.6);
  const d = line.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
  return { d, endHead, startHead };
});

const labelLines = computed(() => (Array.isArray(props.label) ? props.label : props.label ? [props.label] : []));
</script>

<template>
  <g :class="['lyd-arrow', { 'lyd-arrow--dashed': dashed, 'lyd-arrow--muted': muted }]">
    <path class="lyd-arrow__line" :d="shape.d" />
    <polygon v-if="shape.endHead" class="lyd-arrow__head" :points="shape.endHead" />
    <polygon v-if="shape.startHead" class="lyd-arrow__head" :points="shape.startHead" />
    <text v-if="labelLines.length" :class="['lyd-l', { 'lyd-l--bare': bare }]" :x="lx" :y="ly" :text-anchor="anchor">
      <tspan v-for="(t, i) in labelLines" :key="i" :x="lx" :dy="i ? 16 : 0">{{ t }}</tspan>
    </text>
  </g>
</template>
