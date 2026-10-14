import type { Plugin } from "../config";

/** Blockquote prefixes that become callouts. Add your own here. */
export const NOTE_KINDS = ["Note", "Tip", "Warning"] as const;

const PREFIX = new RegExp(`^(${NOTE_KINDS.join("|")}):\\s*`);

/**
 *   > Note: Some text.      ->  <section class="note note-note" role="note">…
 *   > Warning: Careful!     ->  <section class="note note-warning" role="note">…
 *
 * Works on markdown-it tokens rather than text, so nested Markdown inside the
 * note (lists, code, more paragraphs) keeps working.
 */
export const notesPlugin: Plugin = {
  name: "notes",
  extendMarkdown(md) {
    md.core.ruler.push("semantic_notes", state => {
      const tokens = state.tokens;
      for (let i = 0; i < tokens.length; i++) {
        if (tokens[i]!.type !== "blockquote_open") continue;
        const inline = tokens[i + 1]?.type === "paragraph_open" ? tokens[i + 2] : undefined;
        const first = inline?.children?.[0];
        if (!inline || first?.type !== "text") continue;
        const match = PREFIX.exec(first.content);
        if (!match) continue;

        const kind = match[1]!;
        first.content = first.content.slice(match[0].length);
        const label = new state.Token("html_inline", "", 0);
        label.content = `<strong class="note-label">${kind}:</strong> `;
        inline.children!.unshift(label);

        // Retag the matching open/close pair.
        let depth = 0;
        for (let j = i; j < tokens.length; j++) {
          const t = tokens[j]!;
          if (t.type === "blockquote_open") depth++;
          if (t.type === "blockquote_close" && --depth === 0) {
            t.tag = "section";
            break;
          }
        }
        const open = tokens[i]!;
        open.tag = "section";
        open.attrSet("class", `note note-${kind.toLowerCase()}`);
        open.attrSet("role", "note");
      }
    });
  },
};
