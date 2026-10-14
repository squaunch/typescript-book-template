import type { Page } from "./config";

/** One searchable section: the text between two headings. */
export interface SearchDoc {
  /** Page title. */
  t: string;
  /** Section heading (empty for text before the first heading). */
  h: string;
  /** URL relative to the book root, including #anchor. */
  u: string;
  /** Plain text body. */
  b: string;
}

const MAX_BODY = 4000;

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", nbsp: " " };

export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|noscript)\b[\s\S]*?<\/\1>/gi, " ")
    // Block-level tags separate words; inline tags (a, em, code, …) don't.
    .replace(/<\/?(p|div|h[1-6]|li|ul|ol|pre|section|figure|figcaption|table|tr|td|th|br|blockquote)\b[^>]*>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_m, e: string) => ENTITIES[e] ?? " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Splits a rendered page at its headings into search documents. */
export function indexPage(page: Page, html: string): SearchDoc[] {
  const docs: SearchDoc[] = [];
  const heading = /<h[1-6] id="([^"]+)"[^>]*>([\s\S]*?)<\/h[1-6]>/g;
  let last = { id: "", text: "", end: 0 };
  const push = (end: number) => {
    const body = htmlToText(html.slice(last.end, end)).slice(0, MAX_BODY);
    if (body || last.text) {
      docs.push({ t: page.title, h: last.text, u: page.url + (last.id ? `#${last.id}` : ""), b: body });
    }
  };
  for (const m of html.matchAll(heading)) {
    push(m.index);
    last = { id: m[1]!, text: htmlToText(m[2]!), end: m.index + m[0].length };
  }
  push(html.length);
  return docs;
}
