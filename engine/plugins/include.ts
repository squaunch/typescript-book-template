import fs from "node:fs";
import path from "node:path";

import { BookError, type Plugin } from "../config";
import { NOT_ESCAPED } from "../text";

const INCLUDE = new RegExp(`${NOT_ESCAPED}\\{\\{#include\\s+([^}]+?)\\s*\\}\\}`, "g");
const SPEC = /^(.*?)(?::(\d*))?(?::(\d*))?$/;
const MAX_DEPTH = 10;

/**
 * `{{#include ../code/example.ts}}`        whole file
 * `{{#include ../code/example.ts:5}}`      line 5 to the end
 * `{{#include ../code/example.ts:5:10}}`   lines 5-10 (1-based, inclusive)
 * `{{#include ../code/example.ts::10}}`    lines 1-10
 * `\{{#include …}}`                         shown literally, not included
 *
 * Paths are relative to the page (or, for includes inside an included file,
 * to that file). Works inside code fences, which is its main use.
 */
export const includePlugin: Plugin = {
  name: "include",
  preprocess(source, ctx) {
    const expand = (text: string, fromFile: string, depth: number): string =>
      text.replace(INCLUDE, (_m, spec: string) => {
        const [, rel = "", start, end] = SPEC.exec(spec.trim())!;
        const file = path.resolve(path.dirname(fromFile), rel.trim());
        if (depth >= MAX_DEPTH) throw new BookError(`{{#include}} nested more than ${MAX_DEPTH} deep (loop?) at ${rel}`, ctx.page.path);
        if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
          throw new BookError(`{{#include}} file not found: ${rel}`, ctx.page.path);
        }
        const lines = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n").replace(/\n$/, "").split("\n");
        const from = start ? Number(start) - 1 : 0;
        const to = end ? Number(end) : lines.length;
        return expand(lines.slice(from, to).join("\n"), file, depth + 1);
      });
    return expand(source, ctx.file, 0);
  },
};
