import DefaultTheme from "vitepress/theme";
import { registerDiagrams } from "./components/diagrams";
import "./custom.css";

// The five consumer pictures (<DiagramRootPersonas />, <DiagramWhoSees />, <DiagramRequestPath />, <DiagramAnonRelay />,
// <DiagramXMatch />) are global components, each used once, with a caption, on a Start-here or feature page. The
// mechanism and developer pages draw their own, more technical pictures as inline SVG (figure.diagram, the .dg-*
// styles in custom.css): one source per picture.
// DOCS UNDER APP: <Roadmap /> is NOT registered here any more — docs/internal/roadmap.md imports it itself, so its
// internal data is bundled only into that internal page and never into the public theme chunk the app serves.
export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    registerDiagrams(app);
  },
};
