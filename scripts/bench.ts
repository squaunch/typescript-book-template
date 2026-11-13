// Measures build time and output size on a generated book, so engine changes can be compared.
//   npx tsx scripts/bench.ts [pages=300] [runs=5]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";

import { build } from "../engine/build";
import { resolveConfig } from "../engine/config";

const pages = Number(process.argv[2] ?? 300);
const runs = Number(process.argv[3] ?? 5);
const root = fs.mkdtempSync(path.join(os.tmpdir(), "book-bench-"));

const page = (i: number) => `# Page ${i}

${Array.from({ length: 12 }, (_, p) => `## Section ${p + 1}

Paragraph ${p} of page ${i} with a [link](page-${(i % pages) + 1}.md), some \`inline code\` and maths $x_{${p}}^2 + y = ${i}$.

> Tip: A callout with **bold** text.

\`\`\`ts
export function f${p}(a: number, b: number): number {
  const total = [a, b, ${i}].reduce((sum, n) => sum + n, 0);
  return total * ${p};
}
\`\`\`
`).join("\n")}
$$
\\sum_{k=1}^{${i}} k = \\frac{${i}(${i} + 1)}{2}
$$
${i % 10 === 0 ? "\n```mermaid\nflowchart LR\n  A --> B --> C\n```\n" : ""}`;

fs.mkdirSync(path.join(root, "src"), { recursive: true });
fs.writeFileSync(path.join(root, "src/SUMMARY.md"), Array.from({ length: pages }, (_, i) => `- [Page ${i + 1}](page-${i + 1}.md)`).join("\n") + "\n");
for (let i = 1; i <= pages; i++) fs.writeFileSync(path.join(root, `src/page-${i}.md`), page(i));

const config = resolveConfig({ title: "Bench" }, root);
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
const gz = (file: string) => zlib.gzipSync(fs.readFileSync(file)).length;
const kb = (n: number) => `${(n / 1024).toFixed(1)} kB`;

// A full build, as `npm run build` does it: a fresh config each time, so nothing rendered is reused.
const cold: number[] = [];
let last = await build(resolveConfig({ title: "Bench" }, root));
for (let r = 0; r < runs; r++) cold.push((last = await build(resolveConfig({ title: "Bench" }, root))).ms);
const coldTimings = last.timings;
// A rebuild as `npm run dev` does it after one page is edited.
await build(config, { dev: true });
const warm: number[] = [];
for (let r = 0; r < runs; r++) {
  fs.appendFileSync(path.join(root, "src/page-1.md"), `\nEdit ${r}.\n`);
  warm.push((last = await build(config, { dev: true })).ms);
}
const warmRendered = last.rendered;
await build(config);

const out = path.join(root, "book");
const asset = (rel: string) => (fs.existsSync(path.join(out, rel)) ? `${kb(fs.statSync(path.join(out, rel)).size)} (${kb(gz(path.join(out, rel)))} gzip)` : "absent");
console.log(`pages: ${pages}, runs: ${runs}`);
console.log(`full build:          median ${median(cold)} ms  (${cold.join(", ")})  last: render ${coldTimings.render}, write ${coldTimings.write}, assets ${coldTimings.assets}`);
console.log(`rebuild after edit:  median ${median(warm)} ms  (${warm.join(", ")})  pages re-rendered: ${warmRendered}`);
for (const rel of ["assets/book.js", "assets/book.css", "assets/feedback.js", "assets/quiz.js", "assets/runnable.js", "assets/diagrams/diagrams.js", "assets/katex/katex.min.css", "page-1.html", "page-10.html"]) {
  console.log(`${rel.padEnd(30)} ${asset(rel)}`);
}
fs.rmSync(root, { recursive: true, force: true });
