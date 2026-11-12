<script setup lang="ts">
// A rounded box with a bold title and up to a few short lines, centred or left-aligned. Extra pieces (an icon, a
// chip) go in the default slot and are drawn on top.
import { computed } from "vue";

const props = withDefaults(
  defineProps<{
    x: number;
    y: number;
    w: number;
    h: number;
    title?: string;
    lines?: string[];
    tone?: "plain" | "us" | "ghost";
    align?: "middle" | "start";
    valign?: "middle" | "top";
    /** left padding when align is "start" (room for an icon) */
    pad?: number;
  }>(),
  { title: "", lines: () => [], tone: "plain", align: "middle", valign: "middle", pad: 14 },
);

const TITLE_LH = 21;
const LINE_LH = 18;

const layout = computed(() => {
  const block = (props.title ? TITLE_LH : 0) + props.lines.length * LINE_LH;
  const top = props.valign === "top" ? props.y + 12 : props.y + (props.h - block) / 2;
  const first = top + (props.title ? TITLE_LH : 0);
  return {
    tx: props.align === "middle" ? props.x + props.w / 2 : props.x + props.pad,
    anchor: props.align === "middle" ? "middle" : "start",
    titleY: top + 15,
    lineYs: props.lines.map((_, i) => first + 13 + i * LINE_LH),
  };
});
</script>

<template>
  <g :class="['lyd-box', `lyd-box--${tone}`]">
    <rect class="lyd-box__rect" :x="x" :y="y" :width="w" :height="h" rx="10" />
    <text v-if="title" class="lyd-t" :x="layout.tx" :y="layout.titleY" :text-anchor="layout.anchor">{{ title }}</text>
    <text
      v-for="(line, i) in lines"
      :key="i"
      class="lyd-s"
      :x="layout.tx"
      :y="layout.lineYs[i]"
      :text-anchor="layout.anchor"
    >{{ line }}</text>
    <slot />
  </g>
</template>
