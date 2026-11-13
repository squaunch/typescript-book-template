import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createRequire } from "node:module";

import md5 from "md5";
import * as esbuild from "esbuild";

import { BookError, errorMessage, type Plugin, type PluginContext, type ResolvedConfig } from "./config";
import { renderLayout, renderRedirect } from "./layout";
import { createMarkdown, newEnv } from "./markdown";
import { DIAGRAM_MARKER, diagramPlugin } from "./plugins/diagram";
import { includePlugin } from "./plugins/include";
import { listingPlugin } from "./plugins/listing";
import { hasMath, mathPlugin } from "./plugins/math";
import { notesPlugin } from "./plugins/notes";
import { quizPlugin } from "./plugins/quiz";
import { runnablePlugin } from "./plugins/runnable";
import { indexPage, type SearchDoc } from "./search";
import { parseSummary } from "./summary";
import { unescapeDirectives } from "./text";

/** Directory of the template's own files (client/, theme/), independent of the book's root. */
const TEMPLATE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Built-in plugins, in the order they run. `include` goes first so included text is processed too. */
export const BUILTIN_PLUGINS: Plugin[] = [
  includePlugin,
  listingPlugin,
  quizPlugin,
  notesPlugin,
  runnablePlugin,
  mathPlugin,
  diagramPlugin,
];

/** Output paths (relative to the output root) of the assets that only some pages load. */
export const QUIZ_JS = "assets/quiz.js";
export const RUNNABLE_JS = "assets/runnable.js";
export const KATEX_CSS = "assets/katex/katex.min.css";
export const DIAGRAMS_JS = "assets/diagrams/diagrams.js";

export interface BuildOptions {
  /** Adds the live-reload script and skips minification. */
  dev?: boolean;
  /** Called for informational messages. */
  log?: (msg: string) => void;
}

export interface BuildResult {
  pages: number;
  ms: number;
  /** Pages whose Markdown was rendered in this build (the rest came from the in-process cache). */
  rendered: number;
  /** Where the time went, in milliseconds. */
  timings: { render: number; write: number; assets: number };
}

/**
 * Rendered pages from the previous build of the same config object, so a dev
 * rebuild only re-renders pages whose text changed. Keyed by the text *after*
 * the plugins' preprocess step, which is where includes, listings and quizzes
 * are read from disk, so a change to any of those files is seen too.
 */
interface CachedPage {
  source: string;
  html: string;
  docs: SearchDoc[];
}
const renderCache = new WeakMap<ResolvedConfig, Map<string, CachedPage>>();

export async function build(config: ResolvedConfig, opts: BuildOptions = {}): Promise<BuildResult> {
  const started = Date.now();
  const log = opts.log ?? (() => {});
  const srcDir = path.resolve(config.root, config.src);
  const outDir = path.resolve(config.root, config.out);

  if (outDir === srcDir || isInside(outDir, srcDir)) {
    throw new BookError(`out ("${config.out}") must not be inside src ("${config.src}")`, "book.config.ts");
  }
  for (const extra of [...config.extraCss, ...config.extraJs]) {
    if (path.isAbsolute(extra) || path.normalize(extra).startsWith("..")) {
      throw new BookError(`extraCss/extraJs paths must be inside the project: "${extra}"`, "book.config.ts");
    }
  }

  const summaryFile = path.join(srcDir, "SUMMARY.md");
  if (!fs.existsSync(summaryFile)) throw new BookError(`missing ${path.relative(config.root, summaryFile)}`);
  const summary = parseSummary(fs.readFileSync(summaryFile, "utf8"), path.relative(config.root, summaryFile));
  if (summary.pages.length === 0) throw new BookError("SUMMARY.md lists no pages");

  // Like mdBook: pages listed in SUMMARY.md but missing on disk are created.
  for (const page of summary.pages) {
    const file = path.join(srcDir, page.path);
    if (!fs.existsSync(file)) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, `# ${page.title}\n`);
      log(`created ${path.relative(config.root, file)}`);
    }
  }

  const plugins = [...BUILTIN_PLUGINS, ...config.plugins];
  const md = createMarkdown();
  for (const p of plugins) p.extendMarkdown?.(md, config);

  const buildState = new Map<string, unknown>();
  const searchDocs: SearchDoc[] = [];
  const rendered = new Map<string, string>();
  // Pages that contain maths / a diagram: only they load the KaTeX stylesheet / Mermaid bundle.
  const mathPages = new Set<string>();
  const diagramPages = new Set<string>();
  const quizPages = new Set<string>();
  const runnablePages = new Set<string>();
  let cache = renderCache.get(config);
  if (!cache) renderCache.set(config, (cache = new Map()));
  const seen = new Set<string>();
  let renderedCount = 0;

  for (const page of summary.pages) {
    const file = path.join(srcDir, page.path);
    const ctx: PluginContext = { config, page, file, md, buildState };
    let source = fs.readFileSync(file, "utf8");
    try {
      for (const p of plugins) if (p.preprocess) source = await p.preprocess(source, ctx);
      source = unescapeDirectives(source);
      seen.add(page.path);
      let hit = cache.get(page.path);
      if (!hit || hit.source !== source) {
        let html = md.render(source, newEnv(path.join(config.src, page.path)));
        for (const p of plugins) if (p.postprocess) html = await p.postprocess(html, ctx);
        hit = { source, html, docs: config.features.search ? indexPage(page, html) : [] };
        cache.set(page.path, hit);
        renderedCount++;
      }
      const html = hit.html;
      rendered.set(page.url, html);
      if (hasMath(html)) mathPages.add(page.url);
      if (html.includes(DIAGRAM_MARKER)) diagramPages.add(page.url);
      if (config.features.quizzes && html.includes(QUIZ_MARKER)) quizPages.add(page.url);
      if (config.features.runnable && html.includes(RUNNABLE_MARKER)) runnablePages.add(page.url);
      searchDocs.push(...hit.docs);
    } catch (e) {
      if (e instanceof BookError) throw e;
      throw new BookError(errorMessage(e), path.join(config.src, page.path), { cause: e });
    }
  }

  for (const key of cache.keys()) if (!seen.has(key)) cache.delete(key);
  const renderedAt = Date.now();

  // Render everything first, so a content error leaves the previous output in place.
  // Empty the output dir but keep the dir itself (the dev server serves from it).
  fs.mkdirSync(outDir, { recursive: true });
  for (const entry of fs.readdirSync(outDir)) fs.rmSync(path.join(outDir, entry), { recursive: true, force: true });

  const pageCount = summary.pages.length;
  summary.pages.forEach((page, i) => {
    const root = "../".repeat(page.url.split("/").length - 1);
    const html = renderLayout({
      config,
      toc: summary.items,
      page,
      title: page.title,
      content: rendered.get(page.url)!,
      prev: summary.pages[i - 1],
      next: summary.pages[i + 1],
      root,
      pageCss: mathPages.has(page.url) ? [KATEX_CSS] : [],
      pageJs: [...(quizPages.has(page.url) ? [QUIZ_JS] : []), ...(runnablePages.has(page.url) ? [RUNNABLE_JS] : [])],
      pageModules: diagramPages.has(page.url) ? [DIAGRAMS_JS] : [],
      dev: !!opts.dev,
    });
    write(outDir, page.url, html);
    // The first page doubles as index.html (if it lives at the top level).
    if (i === 0 && page.url !== "index.html") {
      write(outDir, "index.html", page.url.includes("/") ? renderRedirect(page.url) : html);
    }
  });

  write(
    outDir,
    "404.html",
    renderLayout({
      config,
      toc: summary.items,
      title: "Page not found",
      content: `<h1>Page not found</h1><p>Try the <a href="${config.basePath}index.html">first page</a> or the search.</p>`,
      // 404.html is served at whatever URL was missing, so links must be absolute.
      root: config.basePath,
      next: summary.pages[0],
      dev: !!opts.dev,
    })
  );

  for (const [rawFrom, rawTo] of Object.entries(config.redirects)) {
    const from = rawFrom.replace(/^\/+/, "");
    const to = rawTo.replace(/^\/+/, "");
    const depth = from.split("/").length - 1;
    write(outDir, from, renderRedirect(/^[a-z]+:/i.test(rawTo) ? rawTo : "../".repeat(depth) + to));
  }

  if (config.features.search) write(outDir, "assets/search-index.json", JSON.stringify(searchDocs));

  const wroteAt = Date.now();
  await buildAssets(config, outDir, !!opts.dev, { quiz: quizPages.size > 0, runnable: runnablePages.size > 0 });
  if (mathPages.size > 0) copyKatexAssets(outDir);
  if (diagramPages.size > 0) await buildDiagramBundle(outDir, !!opts.dev);
  copyStatic(srcDir, outDir);
  for (const extra of [...config.extraCss, ...config.extraJs]) {
    const from = path.resolve(config.root, extra);
    if (!fs.existsSync(from)) throw new BookError(`extra file not found: ${extra}`, "book.config.ts");
    write(outDir, extra, fs.readFileSync(from));
  }
  write(outDir, ".nojekyll", "");

  const done = Date.now();
  return {
    pages: pageCount,
    ms: done - started,
    rendered: renderedCount,
    timings: { render: renderedAt - started, write: wroteAt - renderedAt, assets: done - wroteAt },
  };
}

/** Markup that tells the build a page needs the quiz / runnable-code bundle. */
const QUIZ_MARKER = 'class="quiz"';
const RUNNABLE_MARKER = "data-runnable";

/** Bundled client assets from the last build in this process, reused while the client sources are unchanged. */
let assetCache: { key: string; files: { rel: string; contents: Uint8Array }[] } | undefined;

/** Changes whenever a file under the given directories is added, removed or edited. */
function fingerprint(dirs: string[]): string {
  const parts: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else {
        const stat = fs.statSync(full);
        parts.push(`${full}:${stat.size}:${stat.mtimeMs}`);
      }
    }
  };
  for (const dir of dirs) if (fs.existsSync(dir)) walk(dir);
  return md5(parts.sort().join("|"));
}

async function buildAssets(config: ResolvedConfig, outDir: string, dev: boolean, used: { quiz: boolean; runnable: boolean }) {
  const client = path.join(TEMPLATE_DIR, "client");
  const entryPoints: Record<string, string> = {
    book: path.join(client, "index.ts"),
    "book-styles": path.join(client, "styles", "index.css"),
  };
  // Quizzes and runnable code are separate bundles, linked only from the pages that use them.
  if (used.quiz) entryPoints["quiz"] = path.join(client, "entries", "quiz.ts");
  if (used.runnable) entryPoints["runnable"] = path.join(client, "entries", "runnable.ts");
  if (config.features.highlights) {
    entryPoints["feedback"] = path.join(client, "feedback", "index.ts");
    entryPoints["feedback-styles"] = path.join(client, "feedback", "feedback.css");
  }
  const assets = path.join(outDir, "assets");
  const key = [dev, Object.keys(entryPoints).join(","), fingerprint([client, path.join(TEMPLATE_DIR, "shared")])].join("|");
  if (assetCache?.key !== key) {
    const result = await esbuild.build({
      entryPoints,
      outdir: assets,
      bundle: true,
      format: "iife",
      target: "es2020",
      minify: !dev,
      sourcemap: dev ? "inline" : false,
      logLevel: "silent",
      entryNames: "[name]",
      write: false,
    });
    // esbuild names CSS after the entry key; give them their public names.
    const publicName: Record<string, string> = { "book-styles.css": "book.css", "feedback-styles.css": "feedback.css" };
    assetCache = {
      key,
      files: result.outputFiles.map(f => {
        const rel = path.relative(assets, f.path);
        return { rel: publicName[rel] ?? rel, contents: f.contents };
      }),
    };
  }
  for (const f of assetCache.files) write(assets, f.rel, Buffer.from(f.contents));

  fs.copyFileSync(path.join(TEMPLATE_DIR, "theme", "favicon.svg"), path.join(assets, "favicon.svg"));
  const badges = path.join(TEMPLATE_DIR, "theme", "badges");
  if (fs.existsSync(badges)) fs.cpSync(badges, path.join(assets, "badges"), { recursive: true });
}

/**
 * KaTeX's stylesheet and fonts, served from the book itself (no CDN). Only the
 * woff2 fonts are shipped: every browser that can run the book supports them.
 */
function copyKatexAssets(outDir: string) {
  const dist = path.join(path.dirname(createRequire(import.meta.url).resolve("katex/package.json")), "dist");
  const css = fs
    .readFileSync(path.join(dist, "katex.min.css"), "utf8")
    .replace(/,url\(fonts\/[\w-]+\.(?:woff|ttf)\) format\("(?:woff|truetype)"\)/g, "");
  write(outDir, KATEX_CSS, css);
  const fonts = path.join(path.dirname(path.join(outDir, KATEX_CSS)), "fonts");
  fs.mkdirSync(fonts, { recursive: true });
  for (const f of fs.readdirSync(path.join(dist, "fonts"))) {
    if (f.endsWith(".woff2")) fs.copyFileSync(path.join(dist, "fonts", f), path.join(fonts, f));
  }
}

/**
 * Mermaid, bundled from node_modules as ES modules with code splitting: the
 * entry is small and each diagram type (flowchart, sequence, …) is fetched
 * only when a page uses it.
 */
async function buildDiagramBundle(outDir: string, dev: boolean) {
  const entry = path.join(TEMPLATE_DIR, "client", "diagrams.ts");
  const target = path.join(outDir, path.dirname(DIAGRAMS_JS));
  // Bundling Mermaid takes a few hundred milliseconds and its inputs rarely change, so the
  // result is kept on disk, keyed by everything that affects it.
  const require = createRequire(import.meta.url);
  const version = (name: string) => (JSON.parse(fs.readFileSync(require.resolve(`${name}/package.json`), "utf8")) as { version: string }).version;
  const key = md5([version("mermaid"), version("esbuild"), fs.readFileSync(entry, "utf8"), dev].join("|"));
  const cached = path.join(TEMPLATE_DIR, "node_modules", ".cache", "interactive-book", `diagrams-${key}`);
  if (!fs.existsSync(path.join(cached, "diagrams.js"))) {
    const tmp = `${cached}.${process.pid}.tmp`;
    await esbuild.build({
      entryPoints: { diagrams: entry },
      outdir: tmp,
      bundle: true,
      format: "esm",
      splitting: true,
      target: "es2020",
      minify: !dev,
      logLevel: "silent",
      entryNames: "[name]",
      chunkNames: "chunks/[name]-[hash]",
    });
    // Another build may have filled the cache in the meantime (parallel test files do); either copy is fine.
    try {
      fs.renameSync(tmp, cached);
    } catch {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }
  fs.cpSync(cached, target, { recursive: true });
}

/** Copies images and other non-Markdown files from src/ to the output, skipping dotfiles (.DS_Store, .git, …). */
function copyStatic(srcDir: string, outDir: string) {
  fs.cpSync(srcDir, outDir, {
    recursive: true,
    filter: src => {
      if (src === srcDir) return true;
      if (path.basename(src).startsWith(".") || path.basename(src) === "node_modules") return false;
      return fs.statSync(src).isDirectory() || !src.endsWith(".md");
    },
  });
}

const isInside = (child: string, parent: string) => {
  const rel = path.relative(parent, child);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
};

function write(outDir: string, rel: string, data: string | Buffer) {
  const file = path.join(outDir, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
}
