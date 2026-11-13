import type { Plugin } from "../config";
import { escapeHtml, parseInfo, type Markdown } from "../markdown";

/** Marks a diagram in the page HTML; the build uses it to decide which pages load the Mermaid bundle. */
export const DIAGRAM_MARKER = 'class="diagram"';

/**
 *   ```mermaid
 *   flowchart LR
 *     A --> B
 *   ```
 *
 * becomes a <figure> holding the diagram source. assets/diagrams.js (loaded
 * only on pages that contain a diagram) draws it when it scrolls near the
 * viewport and redraws it when the theme changes. Without JavaScript the
 * source stays readable as text.
 *
 * A title after the language becomes the caption:  ```mermaid How a request flows
 */
export const diagramPlugin: Plugin = {
  name: "diagram",
  extendMarkdown(md: Markdown, config) {
    if (!config.features.diagrams) return;
    const fence = md.renderer.rules.fence!;
    md.renderer.rules.fence = (tokens, idx, options, env, self) => {
      const token = tokens[idx]!;
      if (parseInfo(token.info).lang !== "mermaid") return fence(tokens, idx, options, env, self);
      const caption = token.info.trim().replace(/^mermaid[\s,]*/, "");
      const source = token.content.trim();
      return (
        `<figure class="diagram" data-diagram="mermaid">` +
        `<pre class="diagram-source"><code>${escapeHtml(source)}</code></pre>` +
        (caption ? `<figcaption>${md.renderInline(caption)}</figcaption>` : "") +
        `</figure>\n`
      );
    };
  },
};
