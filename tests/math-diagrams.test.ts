import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { build, DIAGRAMS_JS, KATEX_CSS } from "../engine/build";
import { BookError, resolveConfig, type BookConfig } from "../engine/config";
import { createMarkdown, newEnv } from "../engine/markdown";
import { diagramPlugin } from "../engine/plugins/diagram";
import { mathPlugin } from "../engine/plugins/math";
import { htmlToText } from "../engine/search";

const tmpDirs: string[] = [];
afterAll(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

function renderer(features: BookConfig["features"] = {}) {
  const config = resolveConfig({ title: "T", features }, os.tmpdir());
  const md = createMarkdown();
  for (const p of [mathPlugin, diagramPlugin]) p.extendMarkdown?.(md, config);
  return (src: string) => md.render(src, newEnv("page.md"));
}

const count = (html: string, needle: string) => html.split(needle).length - 1;

describe("maths", () => {
  const render = renderer();

  it("renders inline maths to static KaTeX HTML with MathML", () => {
    const html = render("Pythagoras: $a^2 + b^2 = c^2$.");
    expect(count(html, 'class="katex"')).toBe(1);
    expect(html).toContain("<math");
    expect(html).not.toContain("katex-display");
    expect(html).not.toContain("$");
  });

  it("renders $$ blocks, inline $$ and ```math fences as display maths", () => {
    const block = render("Before\n\n$$\n\\frac{a}{b}\n$$\n\nAfter");
    expect(block).toContain('<p class="math-block">');
    expect(block).toContain("katex-display");
    expect(block).toContain('aria-label="\\frac{a}{b}"');
    expect(render("$$x = 1$$")).toContain("katex-display");
    expect(render("Text $$x = 1$$ text")).toContain("katex-display");
    const fence = render("```math\n\\sum_{i=1}^{n} x_i\n```");
    expect(fence).toContain("katex-display");
    expect(fence).not.toContain("<pre");
  });

  it("leaves prices, escaped dollars and code alone", () => {
    expect(render("It costs $5 and $10 today.")).not.toContain("katex");
    expect(render("From $ 5 to $ 10")).not.toContain("katex");
    expect(render("A literal \\$x\\$ here")).toContain("$x$");
    expect(render("Use `$x$` in code")).toContain("<code>$x$</code>");
    expect(render("```ts\nconst s = `$a$`;\n```")).not.toContain("katex");
    expect(render("One $ alone")).not.toContain("katex");
  });

  it("allows an escaped dollar inside maths", () => {
    expect(count(render("Price: $\\$5 \\times 2$ total"), 'class="katex"')).toBe(1);
  });

  it("stops the build on invalid TeX, naming the file", () => {
    expect(() => render("Bad: $\\frac{1$")).toThrow(BookError);
    expect(() => render("Bad: $\\frac{1$")).toThrow(/page\.md: invalid maths/);
  });

  it("can be switched off", () => {
    expect(renderer({ math: false })("$a^2$")).toContain("$a^2$");
  });

  it("keeps maths markup out of the search text", () => {
    expect(htmlToText(render("Before $a^2 + b^2$ after"))).toBe("Before after");
  });
});

describe("diagrams", () => {
  const render = renderer();

  it("turns a mermaid fence into a figure that keeps the source, escaped", () => {
    const html = render('```mermaid\nflowchart LR\n  A["<b>x</b>"] --> B\n```');
    expect(html).toContain('<figure class="diagram" data-diagram="mermaid">');
    expect(html).toContain("flowchart LR");
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(html).not.toContain("<figcaption>");
  });

  it("uses text after the language as the caption", () => {
    expect(render("```mermaid How a *request* flows\nflowchart LR\n  A --> B\n```")).toContain(
      "<figcaption>How a <em>request</em> flows</figcaption>"
    );
  });

  it("leaves other code blocks alone and can be switched off", () => {
    expect(render("```ts\nlet a = 1;\n```")).toContain('<pre class="code-block"');
    expect(renderer({ diagrams: false })("```mermaid\nflowchart LR\n```")).toContain('<pre class="code-block"');
  });
});

describe("build: per-page assets", () => {
  function makeBook(files: Record<string, string>) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "book-md-"));
    tmpDirs.push(root);
    for (const [rel, content] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      fs.writeFileSync(path.join(root, rel), content);
    }
    return { out: path.join(root, "book"), config: resolveConfig({ title: "T", features: { highlights: false } }, root) };
  }
  const read = (file: string) => fs.readFileSync(file, "utf8");

  it("ships KaTeX and Mermaid from the book itself, only to the pages that use them", async () => {
    const { out, config } = makeBook({
      "src/SUMMARY.md": "- [Plain](plain.md)\n- [Maths](sub/maths.md)\n- [Diagram](diagram.md)\n",
      "src/plain.md": "# Plain\n\nNo maths, $5 only.\n",
      "src/sub/maths.md": "# Maths\n\n$e^{i\\pi} + 1 = 0$\n",
      "src/diagram.md": "# Diagram\n\n```mermaid\nflowchart LR\n  A --> B\n```\n",
    });
    await build(config);

    const plain = read(path.join(out, "plain.html"));
    expect(plain).not.toContain("katex");
    expect(plain).not.toContain("diagrams.js");

    const maths = read(path.join(out, "sub/maths.html"));
    expect(maths).toContain(`href="../${KATEX_CSS}"`);
    expect(maths).not.toContain("diagrams.js");

    const diagram = read(path.join(out, "diagram.html"));
    expect(diagram).toContain(`<script type="module" src="${DIAGRAMS_JS}"></script>`);
    expect(diagram).not.toContain("katex.min.css");

    // Self-hosted: stylesheet, woff2 fonts and the bundle are in the output, and nothing points at a CDN.
    const css = read(path.join(out, KATEX_CSS));
    expect(css).toContain("fonts/KaTeX_Main-Regular.woff2");
    expect(css).not.toMatch(/\.(woff|ttf)\)/);
    expect(fs.existsSync(path.join(out, "assets/katex/fonts/KaTeX_Main-Regular.woff2"))).toBe(true);
    expect(fs.existsSync(path.join(out, DIAGRAMS_JS))).toBe(true);
    for (const html of [plain, maths, diagram]) expect(html).not.toMatch(/https?:\/\/[^"]*(cdn|unpkg|jsdelivr)/);

    const index = read(path.join(out, "assets/search-index.json"));
    expect(index).not.toContain("katex");
  }, 60_000);

  it("writes neither when no page uses them", async () => {
    const { out, config } = makeBook({ "src/SUMMARY.md": "- [Plain](plain.md)\n", "src/plain.md": "# Plain\n" });
    await build(config);
    expect(fs.existsSync(path.join(out, "assets/katex"))).toBe(false);
    expect(fs.existsSync(path.join(out, "assets/diagrams"))).toBe(false);
  });
});
