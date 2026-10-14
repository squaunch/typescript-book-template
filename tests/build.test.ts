import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { build } from "../engine/build";
import { resolveConfig, type BookConfig } from "../engine/config";

const tmpDirs: string[] = [];
afterAll(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

function tmpDir(prefix: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

function makeBook(files: Record<string, string>, config: Partial<BookConfig> = {}) {
  const root = tmpDir("book-build-");
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
  }
  return { root, out: path.join(root, "book"), config: resolveConfig({ title: "T", ...config }, root) };
}

const read = (file: string) => fs.readFileSync(file, "utf8");

describe("build", () => {
  // Smoke test of the bundled template. Asserts only things that survive the
  // template's placeholder chapters being replaced with real content.
  it("builds the bundled template book", async () => {
    const out = tmpDir("book-out-");
    const config = resolveConfig((await import("../book.config")).default, path.resolve(__dirname, ".."));
    config.out = out;
    const result = await build(config);
    expect(result.pages).toBeGreaterThan(0);
    for (const f of ["index.html", "404.html", "assets/book.js", "assets/book.css", "assets/favicon.svg", ".nojekyll"]) {
      expect(fs.existsSync(path.join(out, f)), f).toBe(true);
    }
  });

  it("creates missing pages, writes redirects, and respects disabled features", async () => {
    const { root, out, config } = makeBook(
      { "src/SUMMARY.md": "- [One](one.md)\n  - [Nested](sub/two.md)\n", "src/one.md": "# One\n\n{{#quiz ../q.toml}}\n" },
      { features: { quizzes: false, highlights: false, search: false }, redirects: { "old.html": "one.html", "/deep/old.html": "one.html" } }
    );
    await build(config);
    expect(read(path.join(root, "src/sub/two.md"))).toBe("# Nested\n");
    expect(read(path.join(out, "sub/two.html"))).toContain('href="../assets/book.css"');
    expect(read(path.join(out, "old.html"))).toContain("url=one.html");
    expect(read(path.join(out, "deep/old.html"))).toContain("url=../one.html");
    expect(read(path.join(out, "one.html"))).not.toContain('class="quiz"');
    expect(fs.existsSync(path.join(out, "assets/feedback.js"))).toBe(false);
    expect(fs.existsSync(path.join(out, "assets/search-index.json"))).toBe(false);
  });

  it("keeps the previous output when a page has an error", async () => {
    const { root, out, config } = makeBook({ "src/SUMMARY.md": "- [One](one.md)\n", "src/one.md": "# One\n" });
    await build(config);
    fs.writeFileSync(path.join(root, "src/one.md"), "{{#quiz ../missing.toml}}\n");
    await expect(build(config)).rejects.toThrow(/quiz file not found/);
    expect(fs.existsSync(path.join(out, "one.html"))).toBe(true);
  });

  it("skips dotfiles, unescapes \\{{#, and uses absolute paths in 404.html", async () => {
    const { out, config } = makeBook(
      {
        "src/SUMMARY.md": "- [One](one.md)\n",
        "src/one.md": "Write \\{{#quiz file.toml}} to add a quiz.\n",
        "src/.DS_Store": "x",
        "src/.git/config": "x",
        "src/img/a.svg": "<svg/>",
      },
      { basePath: "/my-book" }
    );
    await build(config);
    expect(fs.existsSync(path.join(out, ".DS_Store"))).toBe(false);
    expect(fs.existsSync(path.join(out, ".git"))).toBe(false);
    expect(fs.existsSync(path.join(out, "img/a.svg"))).toBe(true);
    expect(read(path.join(out, "one.html"))).toContain("Write {{#quiz file.toml}} to add a quiz.");
    expect(read(path.join(out, "404.html"))).toContain('href="/my-book/assets/book.css"');
  });

  it("rejects an output dir inside src and extra files outside the project", async () => {
    const files = { "src/SUMMARY.md": "- [One](one.md)\n", "src/one.md": "# One\n" };
    await expect(build(makeBook(files, { out: "src/out" }).config)).rejects.toThrow(/must not be inside src/);
    await expect(build(makeBook(files, { extraCss: ["../x.css"] }).config)).rejects.toThrow(/inside the project/);
  });
});
