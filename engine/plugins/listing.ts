import type { Plugin } from "../config";
import { escapeHtml } from "../markdown";
import { outsideCode } from "../text";

const LISTING = /^<Listing\b([^>]*)>[ \t]*\n([\s\S]*?)\n<\/Listing>[ \t]*$/gm;
const ATTR = /([\w-]+)="([^"]*)"/g;

/**
 * Numbered, captioned code listings:
 *
 *   <Listing number="1-2" file-name="src/main.ts" caption="Some *text*">
 *
 *   ```ts
 *   ...
 *   ```
 *
 *   </Listing>
 *
 * All attributes are optional. The caption may contain inline Markdown.
 * `<Listing>` inside code (e.g. in a page documenting this syntax) is left alone.
 */
export const listingPlugin: Plugin = {
  name: "listing",
  preprocess(source, ctx) {
    // The listing's own code fence is masked too; it's restored inside the body.
    return outsideCode(source, text => text.replace(LISTING, (_m, attrText: string, body: string) => {
      const attrs: Record<string, string> = {};
      for (const [, key, value] of attrText.matchAll(ATTR)) attrs[key!] = value!;

      const number = attrs["number"];
      const id = number ? ` id="listing-${escapeHtml(number)}"` : "";
      const fileName = attrs["file-name"]
        ? `<span class="file-name">Filename: ${escapeHtml(attrs["file-name"])}</span>\n`
        : "";
      const captionText = [number && `Listing ${escapeHtml(number)}`, attrs["caption"] && ctx.md.renderInline(attrs["caption"])]
        .filter(Boolean)
        .join(": ");
      const caption = captionText ? `\n<figcaption>${captionText}</figcaption>\n` : "";

      // Blank lines around the body let markdown-it parse it as Markdown.
      return `<figure class="listing"${id}>\n${fileName}\n${body.trim()}\n${caption}\n</figure>`;
    }));
  },
};
