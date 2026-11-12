<script setup lang="ts">
// A status pill in the legend's colours. (x, y) is the pill's top edge at the anchor point.
import { computed } from "vue";
import { STATUS, chipWidth, type Status } from "./geom";

const props = withDefaults(
  defineProps<{ x: number; y: number; status: Status; text?: string; anchor?: "start" | "middle" | "end" }>(),
  { text: "", anchor: "start" },
);

const pill = computed(() => {
  const label = props.text || STATUS[props.status];
  const w = chipWidth(label);
  const left = props.anchor === "start" ? props.x : props.anchor === "end" ? props.x - w : props.x - w / 2;
  return { label, w, left };
});
</script>

<template>
  <g :class="['lyd-chip', `lyd-chip--${status}`]">
    <rect :x="pill.left" :y="y" :width="pill.w" height="20" rx="10" />
    <text :x="pill.left + pill.w / 2" :y="y + 14" text-anchor="middle">{{ pill.label }}</text>
  </g>
</template>
