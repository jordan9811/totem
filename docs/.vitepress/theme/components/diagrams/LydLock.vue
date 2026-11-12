<script setup lang="ts">
// A small padlock, 16 by 18 units, drawn from its top-left corner.
defineProps<{ x: number; y: number }>();
</script>

<template>
  <g class="lyd-icon" :transform="`translate(${x} ${y})`">
    <path d="M4 8 V5.5 a4 4 0 0 1 8 0 V8" />
    <rect x="1.5" y="8" width="13" height="9.5" rx="2" />
    <path d="M8 11.5 V14" />
  </g>
</template>
