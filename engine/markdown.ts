import hljs from "highlight.js";
import MarkdownIt from "markdown-it";

export interface Heading {
  level: number;
  id: string;
  text: string;
}

/** Per-page render state, passed to markdown-it as `env`. */
export type RenderEnv = {
  headings: Heading[];
  usedIds: Map<string, number>;
  /** Source file being rendered, for error messages. */
  file?: string;
};

/** The markdown-it instance type (the package only exports the constructor as a value). */
export type Markdown = InstanceType<typeof MarkdownIt>;

export const newEnv = (file?: string): RenderEnv => ({ headings: [], usedIds: new Map(), file });

/** A fence info string like "ts,runnable,throws" or "ts runnable" -> { lang, flags }. */
export function parseInfo(info: string): { lang: string; flags: string[] } {
  const [lang = "", ...flags] = info
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean);
  return { lang, flags };
}

/** Lines ending in `// @hide` are compiled/run but not shown to readers. */
export const HIDE_MARKER = /\s*\/\/\s*@hide\s*$/;

export function visibleCode(code: string): string {
  return code
    .split("\n")
    .filter(line => !HIDE_MARKER.test(line))
    .join("\n");
}

export function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/<[^>]*>/g, "")
      .replace(/[^\p{L}\p{N}\s-]/gu, "")
      .trim()
      .replace(/\s+/g, "-") || "section"
  );
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function highlight(code: string, lang: string): string {
  if (lang && hljs.getLanguage(lang)) {
    return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
  }
  return escapeHtml(code);
}

export function createMarkdown(): Markdown {
  const md = new MarkdownIt({ html: true, linkify: true, typographer: true });

  // Code blocks: every word in the info string becomes a class on <pre>, so
  // client-side features (badges, runnable, ...) can find them.
  md.renderer.rules.fence = (tokens, idx) => {
    const token = tokens[idx]!;
    const { lang, flags } = parseInfo(token.info);
    const code = visibleCode(token.content.replace(/\n$/, ""));
    const classes = ["code-block", ...flags.map(f => f.replace(/[^\w-]/g, ""))].join(" ");
    const langAttr = lang ? ` data-lang="${escapeHtml(lang)}"` : "";
    return (
      `<pre class="${classes}"${langAttr}><code class="hljs${lang ? ` language-${escapeHtml(lang)}` : ""}">` +
      highlight(code, lang) +
      `</code></pre>\n`
    );
  };

  // Headings get unique ids and a self-link, and are collected for search.
  md.core.ruler.push("heading_ids", state => {
    const env = state.env as unknown as RenderEnv;
    const tokens = state.tokens;
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i]!;
      if (token.type !== "heading_open") continue;
      const inline = tokens[i + 1];
      const text = (inline?.children ?? [])
        .filter(t => t.type === "text" || t.type === "code_inline")
        .map(t => t.content)
        .join("");
      const base = String(token.attrGet("id") ?? slugify(text));
      // "intro", then "intro-1", "intro-2", …, skipping ids already taken
      // (e.g. by a literal "Intro 1" heading). usedIds: id -> last suffix used.
      let n = env.usedIds.get(base) ?? 0;
      let id = base;
      while (env.usedIds.has(id)) id = `${base}-${++n}`;
      if (id !== base) env.usedIds.set(base, n);
      env.usedIds.set(id, env.usedIds.get(id) ?? 0);
      token.attrSet("id", id);
      env.headings.push({ level: Number(token.tag.slice(1)), id, text });
    }
  });
  md.renderer.rules.heading_open = (tokens, idx, options, _env, self) => {
    const id = tokens[idx]!.attrGet("id")!;
    return `${self.renderToken(tokens, idx, options)}<a class="header" href="#${id}">`;
  };
  md.renderer.rules.heading_close = (tokens, idx, options, _env, self) =>
    `</a>${self.renderToken(tokens, idx, options)}`;

  // Relative links to other pages: foo.md#bar -> foo.html#bar
  const defaultLinkOpen =
    md.renderer.rules.link_open ?? ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
  md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
    const token = tokens[idx]!;
    const attr = token.attrGet("href");
    const href = attr == null ? null : String(attr);
    if (href && !/^[a-z][a-z0-9+.-]*:/i.test(href) && !href.startsWith("//")) {
      // Only the path part: "a.md#x" / "a.md?y" -> "a.html…", but not "#notes.md".
      token.attrSet("href", href.replace(/^([^#?]*)\.md(?=[#?]|$)/, "$1.html"));
    }
    return defaultLinkOpen(tokens, idx, options, env, self);
  };

  // Wrap tables so wide ones scroll instead of breaking the layout.
  md.renderer.rules.table_open = () => `<div class="table-wrapper"><table>\n`;
  md.renderer.rules.table_close = () => `</table></div>\n`;

  return md;
}
