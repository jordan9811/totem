<script setup lang="ts">
// The frame every diagram sits in: a <figure> holding the wide and the tall SVG, plus an optional caption.
// The page usually writes its own note under a picture; `caption` is for a page that wants it attached.
defineProps<{ caption?: string }>();
</script>

<template>
  <figure class="lyd">
    <slot />
    <figcaption v-if="caption" class="lyd__caption">{{ caption }}</figcaption>
  </figure>
</template>

<style src="./diagram.css"></style>
