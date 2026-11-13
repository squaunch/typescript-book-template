import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { build, QUIZ_JS, RUNNABLE_JS } from "../engine/build";
import { resolveConfig } from "../engine/config";

const tmpDirs: string[] = [];
afterAll(() => {
  for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
});

function makeBook(files: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "book-perf-"));
  tmpDirs.push(root);
  const put = (rel: string, content: string) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
  };
  for (const [rel, content] of Object.entries(files)) put(rel, content);
  return { root, put, out: path.join(root, "book"), config: resolveConfig({ title: "T", features: { highlights: false } }, root) };
}
const read = (file: string) => fs.readFileSync(file, "utf8");

describe("incremental rebuilds", () => {
  it("re-renders only pages whose text, or a file they include, changed", async () => {
    const { put, out, config } = makeBook({
      "src/SUMMARY.md": "- [One](one.md)\n- [Two](two.md)\n- [Three](three.md)\n",
      "src/one.md": "# One\n\nFirst.\n",
      "src/two.md": "# Two\n\n```ts\n{{#include ../code/a.ts}}\n```\n",
      "src/three.md": "# Three\n",
      "code/a.ts": "export const a = 1;\n",
    });
    expect((await build(config)).rendered).toBe(3);
    expect((await build(config)).rendered).toBe(0);

    put("src/one.md", "# One\n\nChanged.\n");
    expect((await build(config)).rendered).toBe(1);
    expect(read(path.join(out, "one.html"))).toContain("Changed.");

    put("code/a.ts", "export const a = 2;\n");
    expect((await build(config)).rendered).toBe(1);
    expect(read(path.join(out, "two.html"))).toContain("2");

    // Unchanged pages are still written, and still searchable.
    expect(read(path.join(out, "three.html"))).toContain("Three");
    expect(read(path.join(out, "assets/search-index.json"))).toContain("Changed.");

    // A removed page leaves the output, and a different config starts from scratch.
    put("src/SUMMARY.md", "- [One](one.md)\n- [Two](two.md)\n");
    await build(config);
    expect(fs.existsSync(path.join(out, "three.html"))).toBe(false);
    expect((await build(resolveConfig({ title: "T", features: { highlights: false } }, config.root))).rendered).toBe(2);
  });

  it("reports where the time went", async () => {
    const { config } = makeBook({ "src/SUMMARY.md": "- [One](one.md)\n", "src/one.md": "# One\n" });
    const { ms, timings } = await build(config);
    expect(timings.render + timings.write + timings.assets).toBe(ms);
  });
});

describe("code splitting", () => {
  it("loads the quiz and runnable-code bundles only on pages that use them", async () => {
    const { out, config } = makeBook({
      "src/SUMMARY.md": "- [Plain](plain.md)\n- [Quiz](quiz.md)\n- [Run](run.md)\n",
      "src/plain.md": "# Plain\n\n```ts\nconst a = 1;\n```\n",
      "src/quiz.md": "# Quiz\n\n{{#quiz ../quizzes/q.toml}}\n",
      "src/run.md": "# Run\n\n```js,runnable\nconsole.log(1);\n```\n",
      "quizzes/q.toml": '[[questions]]\nid = "118f46c5-fcb5-4c26-9b41-877f1256b2aa"\ntype = "ShortAnswer"\nprompt.prompt = "1 + 1?"\nanswer.answer = "2"\n',
    });
    await build(config);
    const scripts = (page: string) => [...read(path.join(out, page)).matchAll(/<script src="([^"]+)"/g)].map(m => m[1]);
    expect(scripts("plain.html")).toEqual(["assets/book.js"]);
    expect(scripts("quiz.html")).toEqual(["assets/book.js", QUIZ_JS]);
    expect(scripts("run.html")).toEqual(["assets/book.js", RUNNABLE_JS]);
    expect(fs.existsSync(path.join(out, QUIZ_JS))).toBe(true);
    expect(fs.existsSync(path.join(out, RUNNABLE_JS))).toBe(true);
    // The shared bundle no longer carries the quiz or the code runner.
    const book = read(path.join(out, "assets/book.js"));
    expect(book).not.toContain("quiz-active");
    expect(read(path.join(out, QUIZ_JS)).length).toBeGreaterThan(1000);
  });

  it("links the KaTeX stylesheet when the only maths on a page is inside a quiz", async () => {
    const { out, config } = makeBook({
      "src/SUMMARY.md": "- [Quiz](quiz.md)\n",
      "src/quiz.md": "# Quiz\n\n{{#quiz ../quizzes/q.toml}}\n",
      "quizzes/q.toml":
        '[[questions]]\nid = "118f46c5-fcb5-4c26-9b41-877f1256b2ab"\ntype = "ShortAnswer"\nprompt.prompt = "What is $1 + 1$?"\nanswer.answer = "2"\n',
    });
    await build(config);
    expect(read(path.join(out, "quiz.html"))).toContain("assets/katex/katex.min.css");
    expect(fs.existsSync(path.join(out, "assets/katex/katex.min.css"))).toBe(true);
  });

  it("builds neither bundle for a book without quizzes or runnable code", async () => {
    const { out, config } = makeBook({ "src/SUMMARY.md": "- [Plain](plain.md)\n", "src/plain.md": "# Plain\n" });
    await build(config);
    expect(fs.existsSync(path.join(out, QUIZ_JS))).toBe(false);
    expect(fs.existsSync(path.join(out, RUNNABLE_JS))).toBe(false);
  });
});
