// DIAGRAMS: the five pictures, registered as global components so any page can write <DiagramRootPersonas /> on a
// line of its own. Each takes one optional prop, `caption`, drawn under the picture.
//
// Wire it once in docs/.vitepress/theme/index.ts:
//   import { registerDiagrams } from "./components/diagrams";
//   enhanceApp({ app }) { ...; registerDiagrams(app); }
import type { App } from "vue";
import DiagramRootPersonas from "./DiagramRootPersonas.vue";
import DiagramWhoSees from "./DiagramWhoSees.vue";
import DiagramRequestPath from "./DiagramRequestPath.vue";
import DiagramAnonRelay from "./DiagramAnonRelay.vue";
import DiagramXMatch from "./DiagramXMatch.vue";

export { DiagramRootPersonas, DiagramWhoSees, DiagramRequestPath, DiagramAnonRelay, DiagramXMatch };

export function registerDiagrams(app: App): void {
  app.component("DiagramRootPersonas", DiagramRootPersonas);
  app.component("DiagramWhoSees", DiagramWhoSees);
  app.component("DiagramRequestPath", DiagramRequestPath);
  app.component("DiagramAnonRelay", DiagramAnonRelay);
  app.component("DiagramXMatch", DiagramXMatch);
}
