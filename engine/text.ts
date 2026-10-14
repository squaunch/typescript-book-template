// Helpers for plugins that work on Markdown text.

const FENCE = /^( {0,3})(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n {0,3}\2[`~]*[ \t]*(?=\n|$)|$(?![\s\S]))/gm;
// Code spans may wrap lines but never cross a blank line (paragraph break).
const INLINE_CODE = /(`+)(?!`)(?:(?!\n[ \t]*\n)[\s\S])*?[^`]\1(?!`)/g;

/**
 * Runs `fn` on the parts of `source` that are not code (fenced blocks or
 * inline code spans), so directives shown as examples aren't executed.
 */
export function outsideCode(source: string, fn: (text: string) => string): string {
  const saved: string[] = [];
  const stash = (m: string) => `\u0000${saved.push(m) - 1}\u0000`;
  const masked = source.replace(FENCE, stash).replace(INLINE_CODE, stash);
  return fn(masked).replace(/\u0000(\d+)\u0000/g, (_m, i: string) => saved[Number(i)]!);
}

/**
 * `\{{#quiz …}}` is the escape for showing a directive literally (as in
 * mdBook). Directive regexes use NOT_ESCAPED so they skip it, and the build
 * strips the backslash at the end.
 */
export const NOT_ESCAPED = "(?<!\\\\)";
export const unescapeDirectives = (source: string) => source.replace(/\\\{\{#/g, "{{#");
