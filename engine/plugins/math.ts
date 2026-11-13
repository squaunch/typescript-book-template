import katex from "katex";

import { BookError, errorMessage, type Plugin } from "../config";
import { escapeHtml, parseInfo, type Markdown, type RenderEnv } from "../markdown";

/**
 * True when a rendered page contains maths, so the build links the KaTeX stylesheet from it.
 * Maths in a quiz prompt sits inside the quiz's embedded JSON, where the quotes are escaped.
 */
export const hasMath = (html: string): boolean => /class=\\?"katex\\?"/.test(html);

/**
 * Renders TeX to static HTML at build time. Pages ship KaTeX's markup (plus
 * MathML for screen readers); the browser only needs the stylesheet and fonts.
 * A TeX error stops the build with the file name, like any other content error.
 */
export function renderMath(tex: string, displayMode: boolean, file?: string): string {
  try {
    // The comment markers let the search index skip the markup (see htmlToText).
    const html = katex.renderToString(tex, { displayMode, throwOnError: true, output: "htmlAndMathml", strict: "ignore" });
    return `<!--math-->${html}<!--/math-->`;
  } catch (e) {
    const shown = tex.length > 60 ? `${tex.slice(0, 60)}…` : tex;
    throw new BookError(`invalid maths "${shown}": ${errorMessage(e).replace(/^KaTeX parse error: /, "")}`, file, { cause: e });
  }
}

const DOLLAR = 0x24;
const BACKSLASH = 0x5c;
const isSpace = (code: number) => code === 0x20 || code === 0x09 || code === 0x0a;
const isDigit = (code: number) => code >= 0x30 && code <= 0x39;

/**
 *   Inline:   $E = mc^2$            (no space just inside the dollars; the closing
 *                                    dollar must not be followed by a digit, so
 *                                    "$5 and $10" stays text; write \$ for a literal dollar)
 *   Display:  $$ … $$               (on its own lines, or within a paragraph)
 *   Display:  ```math … ```         (a fenced block, handy for long formulas)
 */
export const mathPlugin: Plugin = {
  name: "math",
  extendMarkdown(md: Markdown, config) {
    if (!config.features.math) return;

    md.inline.ruler.after("escape", "math_inline", (state, silent) => {
      const { src, pos: start, posMax } = state;
      if (src.charCodeAt(start) !== DOLLAR) return false;
      const display = src.charCodeAt(start + 1) === DOLLAR;
      const open = display ? 2 : 1;
      const first = src.charCodeAt(start + open);
      if (start + open >= posMax || (!display && isSpace(first))) return false;

      let end = start + open;
      for (; end < posMax; end++) {
        const code = src.charCodeAt(end);
        if (code === BACKSLASH) end++;
        else if (code === DOLLAR && (!display || src.charCodeAt(end + 1) === DOLLAR)) break;
      }
      if (end >= posMax || end === start + open) return false;
      if (!display && (isSpace(src.charCodeAt(end - 1)) || isDigit(src.charCodeAt(end + 1)))) return false;

      if (!silent) {
        const token = state.push(display ? "math_display" : "math_inline", "", 0);
        token.content = src.slice(start + open, end).trim();
      }
      state.pos = end + open;
      return true;
    });

    // $$ on a line of its own opens a block that runs to the next line ending in $$.
    md.block.ruler.before("fence", "math_block", (state, startLine, endLine, silent) => {
      const lineText = (line: number) => state.src.slice(state.bMarks[line]! + state.tShift[line]!, state.eMarks[line]!);
      if (state.sCount[startLine]! - state.blkIndent >= 4) return false;
      const first = lineText(startLine);
      if (!first.startsWith("$$")) return false;

      const lines: string[] = [];
      let line = startLine;
      let rest = first.slice(2);
      let closed = false;
      for (;;) {
        const trimmed = rest.trimEnd();
        if (trimmed.endsWith("$$") && !trimmed.endsWith("\\$$")) {
          lines.push(trimmed.slice(0, -2));
          closed = true;
          break;
        }
        lines.push(rest);
        if (++line >= endLine) break;
        rest = lineText(line);
      }
      if (!closed) return false;
      if (silent) return true;

      const token = state.push("math_display", "", 0);
      token.block = true;
      token.content = lines.join("\n").trim();
      token.map = [startLine, line + 1];
      state.line = line + 1;
      return true;
    }, { alt: ["paragraph", "reference", "blockquote", "list"] });

    const file = (env: unknown) => (env as RenderEnv | undefined)?.file;
    md.renderer.rules["math_inline"] = (tokens, idx, _o, env) => renderMath(tokens[idx]!.content, false, file(env));
    md.renderer.rules["math_display"] = (tokens, idx, _o, env) => {
      const token = tokens[idx]!;
      const html = `<span class="math-display" role="math" aria-label="${escapeHtml(token.content)}" tabindex="0">${renderMath(token.content, true, file(env))}</span>`;
      return token.block ? `<p class="math-block">${html}</p>\n` : html;
    };

    const fence = md.renderer.rules.fence!;
    md.renderer.rules.fence = (tokens, idx, options, env, self) => {
      const token = tokens[idx]!;
      if (parseInfo(token.info).lang !== "math") return fence(tokens, idx, options, env, self);
      const tex = token.content.trim();
      return `<p class="math-block"><span class="math-display" role="math" aria-label="${escapeHtml(tex)}" tabindex="0">${renderMath(tex, true, file(env))}</span></p>\n`;
    };
  },
};
