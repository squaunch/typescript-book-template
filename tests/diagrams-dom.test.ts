// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { __BOOK_TEST__?: boolean }).__BOOK_TEST__ = true;

const render = vi.fn(async (id: string, source: string) => {
  if (source.includes("broken")) throw new Error("Parse error on line 1\nmore detail");
  return { svg: `<svg id="${id}"><text>${source}</text></svg>` };
});
const initialize = vi.fn();
vi.mock("mermaid", () => ({ default: { render, initialize } }));

const { initDiagrams, mermaidTheme } = await import("../client/diagrams");

const figure = (source: string) =>
  `<figure class="diagram" data-diagram="mermaid"><pre class="diagram-source"><code>${source}</code></pre></figure>`;
const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise(resolve => setTimeout(resolve, 0));
};

describe("diagrams (client)", () => {
  let stop = () => {};
  afterEach(() => stop());
  beforeEach(() => {
    render.mockClear();
    initialize.mockClear();
    document.documentElement.dataset.theme = "light";
    // happy-dom has no layout, so draw immediately instead of waiting to scroll into view.
    Reflect.deleteProperty(window, "IntersectionObserver");
  });

  it("maps book themes to Mermaid themes", () => {
    expect(mermaidTheme("light")).toBe("default");
    expect(mermaidTheme("dark")).toBe("dark");
    expect(mermaidTheme("sepia")).toBe("neutral");
    expect(mermaidTheme(undefined)).toBe("default");
  });

  it("draws each diagram and hides its source", async () => {
    document.body.innerHTML = figure("flowchart LR; A --- B") + figure("sequenceDiagram; A->>B: hi");
    stop = initDiagrams();
    await settle();
    const figures = [...document.querySelectorAll("figure.diagram")];
    expect(render).toHaveBeenCalledTimes(2);
    expect(initialize).toHaveBeenCalledWith(expect.objectContaining({ theme: "default", securityLevel: "strict", startOnLoad: false }));
    for (const f of figures) {
      expect(f.classList.contains("diagram-ready")).toBe(true);
      expect(f.querySelector(".diagram-canvas svg")?.getAttribute("role")).toBe("img");
    }
  });

  it("keeps the source and explains when a diagram is invalid", async () => {
    document.body.innerHTML = figure("broken");
    stop = initDiagrams();
    await settle();
    const f = document.querySelector("figure.diagram")!;
    expect(f.classList.contains("diagram-error")).toBe(true);
    expect(f.classList.contains("diagram-ready")).toBe(false);
    expect(f.querySelector(".diagram-canvas")?.textContent).toBe("This diagram could not be drawn: Parse error on line 1");
    expect(f.querySelector(".diagram-source")).not.toBeNull();
  });

  it("redraws from the original source when the theme changes", async () => {
    document.body.innerHTML = figure("flowchart LR; A --- B");
    stop = initDiagrams();
    await settle();
    document.documentElement.dataset.theme = "dark";
    await settle();
    await settle();
    expect(initialize).toHaveBeenLastCalledWith(expect.objectContaining({ theme: "dark" }));
    expect(render).toHaveBeenCalledTimes(2);
    expect(render.mock.calls[1]![1]).toBe("flowchart LR; A --- B");
  });

  it("does nothing on pages without diagrams", () => {
    document.body.innerHTML = "<p>No diagrams</p>";
    stop = initDiagrams();
    expect(initialize).not.toHaveBeenCalled();
  });
});
