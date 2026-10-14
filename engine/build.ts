import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as esbuild from "esbuild";

import { BookError, errorMessage, type Plugin, type PluginContext, type ResolvedConfig } from "./config";
import { renderLayout, renderRedirect } from "./layout";
import { createMarkdown, newEnv } from "./markdown";
import { includePlugin } from "./plugins/include";
import { listingPlugin } from "./plugins/listing";
import { notesPlugin } from "./plugins/notes";
import { quizPlugin } from "./plugins/quiz";
import { runnablePlugin } from "./plugins/runnable";
import { indexPage, type SearchDoc } from "./search";
import { parseSummary } from "./summary";
import { unescapeDirectives } from "./text";

/** Directory of the template's own files (client/, theme/), independent of the book's root. */
const TEMPLATE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Built-in plugins, in the order they run. `include` goes first so included text is processed too. */
export const BUILTIN_PLUGINS: Plugin[] = [includePlugin, listingPlugin, quizPlugin, notesPlugin, runnablePlugin];

export interface BuildOptions {
  /** Adds the live-reload script and skips minification. */
  dev?: boolean;
  /** Called for informational messages. */
  log?: (msg: string) => void;
}

export interface BuildResult {
  pages: number;
  ms: number;
}

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

  for (const page of summary.pages) {
    const file = path.join(srcDir, page.path);
    const ctx: PluginContext = { config, page, file, md, buildState };
    let source = fs.readFileSync(file, "utf8");
    try {
      for (const p of plugins) if (p.preprocess) source = await p.preprocess(source, ctx);
      source = unescapeDirectives(source);
      let html = md.render(source, newEnv(path.join(config.src, page.path)));
      for (const p of plugins) if (p.postprocess) html = await p.postprocess(html, ctx);
      rendered.set(page.url, html);
      if (config.features.search) searchDocs.push(...indexPage(page, html));
    } catch (e) {
      if (e instanceof BookError) throw e;
      throw new BookError(errorMessage(e), path.join(config.src, page.path), { cause: e });
    }
  }

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

  await buildAssets(config, outDir, !!opts.dev);
  copyStatic(srcDir, outDir);
  for (const extra of [...config.extraCss, ...config.extraJs]) {
    const from = path.resolve(config.root, extra);
    if (!fs.existsSync(from)) throw new BookError(`extra file not found: ${extra}`, "book.config.ts");
    write(outDir, extra, fs.readFileSync(from));
  }
  write(outDir, ".nojekyll", "");

  return { pages: pageCount, ms: Date.now() - started };
}

async function buildAssets(config: ResolvedConfig, outDir: string, dev: boolean) {
  const client = path.join(TEMPLATE_DIR, "client");
  const entryPoints: Record<string, string> = {
    book: path.join(client, "index.ts"),
    "book-styles": path.join(client, "styles", "index.css"),
  };
  if (config.features.highlights) {
    entryPoints["feedback"] = path.join(client, "feedback", "index.ts");
    entryPoints["feedback-styles"] = path.join(client, "feedback", "feedback.css");
  }
  await esbuild.build({
    entryPoints,
    outdir: path.join(outDir, "assets"),
    bundle: true,
    format: "iife",
    target: "es2020",
    minify: !dev,
    sourcemap: dev ? "inline" : false,
    logLevel: "silent",
    entryNames: "[name]",
  });
  // esbuild names CSS after the entry key; give them their public names.
  const assets = path.join(outDir, "assets");
  fs.renameSync(path.join(assets, "book-styles.css"), path.join(assets, "book.css"));
  if (config.features.highlights) fs.renameSync(path.join(assets, "feedback-styles.css"), path.join(assets, "feedback.css"));

  fs.copyFileSync(path.join(TEMPLATE_DIR, "theme", "favicon.svg"), path.join(assets, "favicon.svg"));
  const badges = path.join(TEMPLATE_DIR, "theme", "badges");
  if (fs.existsSync(badges)) fs.cpSync(badges, path.join(assets, "badges"), { recursive: true });
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
