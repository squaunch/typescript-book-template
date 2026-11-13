// Entry point for assets/diagrams/diagrams.js: draws ```mermaid blocks.
// Loaded (as a module) only on pages that contain a diagram, so other pages
// pay nothing for it. This file stays tiny: Mermaid itself is fetched when the
// first diagram comes near the viewport, each diagram is drawn at that point,
// and all drawn diagrams are redrawn when the reader changes theme.

type Mermaid = (typeof import("mermaid"))["default"];
let loading: Promise<Mermaid> | undefined;
const loadMermaid = () => (loading ??= import("mermaid").then(m => m.default));

type MermaidTheme = "default" | "dark" | "neutral";

/** The Mermaid theme that matches a book theme. */
export function mermaidTheme(bookTheme: string | undefined): MermaidTheme {
  if (bookTheme === "dark") return "dark";
  if (bookTheme === "sepia") return "neutral";
  return "default";
}

let counter = 0;
/** Each figure's Mermaid source, kept for redrawing after a theme change. */
const sources = new WeakMap<HTMLElement, string>();

async function draw(figure: HTMLElement, theme: MermaidTheme) {
  const source = sources.get(figure) ?? figure.querySelector(".diagram-source")?.textContent ?? "";
  sources.set(figure, source);
  let canvas = figure.querySelector<HTMLElement>(".diagram-canvas");
  if (!canvas) {
    canvas = document.createElement("div");
    canvas.className = "diagram-canvas";
    figure.prepend(canvas);
  }
  try {
    const mermaid = await loadMermaid();
    // Diagrams are drawn one at a time (see `queue`), so this setting holds for the render below.
    mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme, fontFamily: "inherit" });
    const { svg } = await mermaid.render(`diagram-${++counter}`, source);
    canvas.innerHTML = svg;
    canvas.querySelector("svg")?.setAttribute("role", "img");
    figure.classList.add("diagram-ready");
    figure.classList.remove("diagram-error");
  } catch (e) {
    // Leave the source visible and say why, rather than showing a blank box.
    canvas.textContent = `This diagram could not be drawn: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`;
    figure.classList.add("diagram-error");
    figure.classList.remove("diagram-ready");
  }
}

/** Starts drawing the page's diagrams. Returns a function that stops watching (used by tests). */
export function initDiagrams(doc: Document = document): () => void {
  const figures = [...doc.querySelectorAll<HTMLElement>('figure.diagram[data-diagram="mermaid"]')];
  if (figures.length === 0) return () => {};
  const root = doc.documentElement;
  // One drawing at a time, in order: Mermaid keeps its configuration globally.
  let queue: Promise<void> = Promise.resolve();
  const enqueue = (figure: HTMLElement) => {
    queue = queue.then(() => draw(figure, mermaidTheme(root.dataset.theme)));
  };

  const drawn = new Set<HTMLElement>();
  const show = (figure: HTMLElement) => {
    drawn.add(figure);
    enqueue(figure);
  };
  let observer: IntersectionObserver | undefined;
  if ("IntersectionObserver" in window) {
    const io = (observer = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          io.unobserve(entry.target);
          show(entry.target as HTMLElement);
        }
      },
      { rootMargin: "600px 0px" }
    ));
    for (const f of figures) io.observe(f);
  } else {
    figures.forEach(show);
  }
  // Printing shows everything, including diagrams the reader never scrolled to.
  window.addEventListener("beforeprint", () => figures.filter(f => !drawn.has(f)).forEach(show));

  // The theme picker sets <html data-theme>; redraw what is already on screen.
  let theme = root.dataset.theme;
  const themeWatcher = new MutationObserver(() => {
    if (root.dataset.theme === theme) return;
    theme = root.dataset.theme;
    for (const f of drawn) enqueue(f);
  });
  themeWatcher.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
  return () => {
    themeWatcher.disconnect();
    observer?.disconnect();
  };
}

if (typeof document !== "undefined" && !(globalThis as { __BOOK_TEST__?: boolean }).__BOOK_TEST__) initDiagrams();
