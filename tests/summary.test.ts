import { describe, expect, it } from "vitest";

import { parseSummary } from "../engine/summary";

describe("parseSummary", () => {
  it("numbers nested chapters and keeps prefix pages unnumbered", () => {
    const s = parseSummary(`# Book

[Preface](preface.md)

- [One](ch01.md)
  - [One A](ch01-01.md)
  - [One B](ch01-02.md)
    - [Deep](ch01-02-01.md)
- [Two](ch02.md)
- [Draft]()
`);
    expect(s.title).toBe("Book");
    expect(s.pages.map(p => [p.path, p.number])).toEqual([
      ["preface.md", undefined],
      ["ch01.md", "1"],
      ["ch01-01.md", "1.1"],
      ["ch01-02.md", "1.2"],
      ["ch01-02-01.md", "1.2.1"],
      ["ch02.md", "2"],
    ]);
    expect(s.pages[1]!.url).toBe("ch01.html");
  });

  it("keeps numbering across parts and separators", () => {
    const s = parseSummary(`- [A](a.md)
# Part II
- [B](b.md)
---
- [C](c.md)
`);
    expect(s.pages.map(p => p.number)).toEqual(["1", "2", "3"]);
    expect(s.items.map(i => i.kind)).toEqual(["page", "part", "page", "separator", "page"]);
  });

  it("numbers from the parent, so uneven indentation can't duplicate numbers", () => {
    const s = parseSummary("- [A](a.md)\n    - [B](b.md)\n  - [C](c.md)\n- [D](d.md)\n");
    expect(s.pages.map(p => p.number)).toEqual(["1", "1.1", "1.2", "2"]);
  });

  it("normalises paths and catches duplicates written differently", () => {
    expect(parseSummary("- [A](sub\\a.md)").pages[0]!.url).toBe("sub/a.html");
    expect(() => parseSummary("- [A](a.md)\n- [B](./a.md)")).toThrow(/listed twice/);
  });

  it("reports bad lines, duplicates and non-Markdown files", () => {
    expect(() => parseSummary("- not a link")).toThrow(/line 1/);
    expect(() => parseSummary("- [A](a.md)\n- [B](a.md)")).toThrow(/listed twice/);
    expect(() => parseSummary("- [A](a.txt)")).toThrow(/\.md/);
  });
});
