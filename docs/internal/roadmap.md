# Roadmap
<!-- uncited-ok: page — the items are generated from the pass pages, which cite the reports -->

<script setup>
// DOCS UNDER APP: imported HERE, not registered by the theme, so the roadmap data (docs/internal/roadmap-data.json)
// is bundled only into this internal page, which a public build never emits (it used to ride in every public page's
// theme chunk). scripts/docs-guard.mjs fails a public build whose output holds the data's marker.
import Roadmap from "../.vitepress/theme/Roadmap.vue";
</script>

<Roadmap />
