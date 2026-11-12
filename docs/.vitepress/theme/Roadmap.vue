<script setup lang="ts">
import { computed, ref } from "vue";
import data from "../../internal/roadmap-data.json";

type Item = { status: string; text: string; area: string; pass: string; passTitle: string; source: string };
const items = data.items as Item[];
const statuses = data.statuses as string[];
const areas = data.areas as string[];
const onStatus = ref<Set<string>>(new Set(statuses));
const onArea = ref<Set<string>>(new Set(areas));
const q = ref("");
function toggle(set: Set<string>, v: string) { const n = new Set(set); if (n.has(v)) n.delete(v); else n.add(v); return n; }
const filtered = computed(() => items.filter((i) => onStatus.value.has(i.status) && onArea.value.has(i.area) && (!q.value || i.text.toLowerCase().includes(q.value.toLowerCase()))));
const countBy = (key: "status" | "area", v: string) => items.filter((i) => i[key] === v).length;
const distance = data.distance as { concept: string; counts: Record<string, number>; total: number }[];
</script>

<template>
  <div class="roadmap">
    <p><strong>{{ items.length }}</strong> items, derived from the pass pages (each of which cites its report) plus the seeded items; generated {{ data.generatedAt }}. Click a status or an area to filter.</p>
    <div class="roadmap-filters" data-testid="roadmap-status-filters">
      <button v-for="s in statuses" :key="s" :class="{ on: onStatus.has(s) }" :data-status="s" @click="onStatus = toggle(onStatus, s)">{{ s }} · {{ countBy("status", s) }}</button>
    </div>
    <div class="roadmap-filters" data-testid="roadmap-area-filters">
      <button v-for="a in areas" :key="a" :class="{ on: onArea.has(a) }" :data-area="a" @click="onArea = toggle(onArea, a)">{{ a }} · {{ countBy("area", a) }}</button>
    </div>
    <p><input v-model="q" placeholder="filter by text" style="border:1px solid var(--vp-c-divider);border-radius:6px;padding:4px 8px;width:100%" /></p>

    <h3 id="distance-to-end-product">Distance to end product</h3>
    <p>For each core concept: how much of what its pages describe is shipped, specced, or still an idea.</p>
    <table class="roadmap-table" data-testid="roadmap-distance">
      <thead><tr><th>Concept</th><th>SHIPPED</th><th>SHIPPED-FIXTURE</th><th>SPECCED</th><th>IDEA</th><th>KNOWN-BROKEN</th><th>UNCLEAR</th><th>Total</th></tr></thead>
      <tbody>
        <tr v-for="d in distance" :key="d.concept">
          <td>{{ d.concept }}</td>
          <td v-for="s in statuses" :key="s">{{ d.counts[s] ?? 0 }}</td>
          <td>{{ d.total }}</td>
        </tr>
      </tbody>
    </table>

    <h3 id="items">Items <small>({{ filtered.length }} shown)</small></h3>
    <table class="roadmap-table" data-testid="roadmap-items">
      <thead><tr><th>Status</th><th>Item</th><th>Area</th><th>Pass</th><th>Source</th></tr></thead>
      <tbody>
        <tr v-for="(i, k) in filtered" :key="k" :data-status="i.status" :data-area="i.area">
          <td><span :class="'tag tag-' + i.status">{{ i.status }}</span></td>
          <td>{{ i.text }}</td>
          <td>{{ i.area }}</td>
          <td>{{ i.passTitle }}</td>
          <td><small>{{ i.source }}</small></td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
