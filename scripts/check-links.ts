// Checks every internal link, anchor and asset in a built book.
// Usage: tsx scripts/check-links.ts [bookDir] [basePath]   (default: basePath from book.config.ts, else "/")
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(process.argv[2] ?? "book");
const config = await import(pathToFileURL(path.resolve("book.config.ts")).href).then(
  (m: { default?: { basePath?: string } }) => m.default ?? {},
  () => ({}) as { basePath?: string }
);
const basePath = (process.argv[3] ?? config.basePath ?? "/").replace(/\/?$/, "/");
const files = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? files(path.join(d, e.name)) : [path.join(d, e.name)]));
const htmls = files(root).filter(f => f.endsWith(".html"));
const ids = new Map<string, Set<string>>();
for (const f of htmls) ids.set(f, new Set([...fs.readFileSync(f, "utf8").matchAll(/\sid="([^"]+)"/g)].map(m => m[1]!)));
const bad: string[] = [];
for (const f of htmls) {
  const src = fs.readFileSync(f, "utf8");
  for (const m of src.matchAll(/\s(?:href|src)="([^"]*)"/g)) {
    const ref = m[1]!;
    if (/^([a-z][a-z0-9+.-]*:|\/\/)/i.test(ref) || ref === "") continue;
    const [p, hash] = ref.split("#") as [string, string | undefined];
    const rel = decodeURIComponent(p.split("?")[0]!);
    // Root-absolute links (used by 404.html) are relative to the site's base path.
    const target = !p ? f : rel.startsWith(basePath) ? path.join(root, rel.slice(basePath.length)) : path.resolve(path.dirname(f), rel);
    const t = fs.existsSync(target) && fs.statSync(target).isDirectory() ? path.join(target, "index.html") : target;
    if (!fs.existsSync(t)) bad.push(`${path.relative(root, f)}: missing ${ref}`);
    else if (hash && t.endsWith(".html") && !ids.get(t)?.has(decodeURIComponent(hash))) bad.push(`${path.relative(root, f)}: missing anchor ${ref}`);
  }
}
console.log(`${htmls.length} pages, ${bad.length} broken`);
for (const b of bad) console.log("  " + b);
process.exit(bad.length ? 1 : 0);
