import path from "node:path";

import { BookError, type Page } from "./config";

export type TocItem =
  | { kind: "page"; title: string; path: string | null; number?: string; children: TocItem[] }
  | { kind: "part"; title: string }
  | { kind: "separator" };

type PageItem = Extract<TocItem, { kind: "page" }>;

/** "./a.md", "sub\\a.md" -> "a.md", "sub/a.md"; empty -> null (draft). */
function normalisePath(raw: string): string | null {
  const p = raw.trim().replace(/\\/g, "/");
  return p ? path.posix.normalize(p) : null;
}

export interface Summary {
  title?: string;
  items: TocItem[];
  /** Every page that has a file, in reading order. */
  pages: Page[];
}

const LINK = /^\[(.+)\]\((.*)\)\s*$/;
const LIST_ITEM = /^(\s*)[-*]\s+(.*)$/;

/**
 * Parses `SUMMARY.md` (same format as mdBook):
 *
 *   # Book Title                 <- optional, first line only
 *   [Preface](preface.md)        <- unnumbered page
 *   - [Chapter](ch01.md)         <- numbered page ("1")
 *     - [Section](ch01-01.md)    <- nested numbered page ("1.1"), indent 2+ spaces
 *   - [Draft]()                  <- listed but not built yet
 *   # Part Title                 <- part heading (after the first line)
 *   ---                          <- separator
 */
export function parseSummary(text: string, file = "SUMMARY.md"): Summary {
  const items: TocItem[] = [];
  let title: string | undefined;
  // Open ancestors of the current list item. A page's number is derived from
  // its parent, so inconsistent indentation can't produce duplicate numbers.
  let stack: { indent: number; page: PageItem }[] = [];
  let topCount = 0;
  let sawContent = false;

  const lines = text.split(/\r?\n/);
  lines.forEach((raw, i) => {
    const line = raw.replace(/\t/g, "    ");
    const lineNo = i + 1;
    if (line.trim() === "" || line.trim().startsWith("<!--")) return;

    const heading = /^#\s+(.+)$/.exec(line);
    if (heading) {
      if (!sawContent && title === undefined) title = heading[1]!.trim();
      else {
        items.push({ kind: "part", title: heading[1]!.trim() });
        stack = [];
      }
      sawContent = true;
      return;
    }
    sawContent = true;

    if (/^-{3,}\s*$/.test(line)) {
      items.push({ kind: "separator" });
      stack = [];
      return;
    }

    const listItem = LIST_ITEM.exec(line);
    if (listItem) {
      const indent = listItem[1]!.length;
      const link = LINK.exec(listItem[2]!.trim());
      if (!link) throw new BookError(`line ${lineNo}: expected "- [Title](file.md)"`, file);

      while (stack.length && stack[stack.length - 1]!.indent >= indent) stack.pop();
      const parent = stack[stack.length - 1]?.page;
      const item: PageItem = { kind: "page", title: link[1]!, path: normalisePath(link[2]!), number: "", children: [] };
      if (parent) {
        item.number = `${parent.number}.${parent.children.length + 1}`;
        parent.children.push(item);
      } else {
        item.number = String(++topCount);
        items.push(item);
      }
      stack.push({ indent, page: item });
      return;
    }

    const link = LINK.exec(line.trim());
    if (link) {
      items.push({ kind: "page", title: link[1]!, path: normalisePath(link[2]!), children: [] });
      stack = [];
      return;
    }

    throw new BookError(`line ${lineNo}: unrecognised line "${line.trim()}"`, file);
  });

  const pages: Page[] = [];
  const seen = new Set<string>();
  const walk = (list: TocItem[]) => {
    for (const item of list) {
      if (item.kind !== "page") continue;
      if (item.path) {
        if (!item.path.endsWith(".md")) {
          throw new BookError(`"${item.path}" must be a .md file`, file);
        }
        if (seen.has(item.path)) throw new BookError(`"${item.path}" is listed twice`, file);
        seen.add(item.path);
        pages.push({
          title: item.title,
          path: item.path,
          url: item.path.replace(/\.md$/, ".html"),
          ...(item.number ? { number: item.number } : {}),
        });
      }
      walk(item.children);
    }
  };
  walk(items);

  return { title, items, pages };
}
