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
    // Click (or Enter / Space) opens the diagram larger; see openZoom.
    canvas.setAttribute("role", "button");
    canvas.setAttribute("tabindex", "0");
    canvas.setAttribute("aria-label", `${figure.querySelector("figcaption")?.textContent?.trim() || "Diagram"}: open larger`);
    canvas.title = "Click to enlarge";
    figure.classList.add("diagram-ready");
    figure.classList.remove("diagram-error");
  } catch (e) {
    // Leave the source visible and say why, rather than showing a blank box.
    for (const attr of ["role", "tabindex", "aria-label", "title"]) canvas.removeAttribute(attr);
    canvas.textContent = `This diagram could not be drawn: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`;
    figure.classList.add("diagram-error");
    figure.classList.remove("diagram-ready");
  }
}

/**
 * Shows a drawn diagram enlarged in a modal dialog. Clicking anywhere outside
 * the diagram, the close button, or pressing Escape closes it, and focus goes
 * back to the diagram it was opened from.
 */
export function openZoom(figure: HTMLElement, doc: Document = document): HTMLDialogElement | undefined {
  const svg = figure.querySelector<SVGElement>(".diagram-canvas svg");
  if (!svg) return undefined;
  doc.querySelector("dialog.diagram-zoom")?.remove();

  const dialog = doc.createElement("dialog");
  dialog.className = "diagram-zoom";
  const caption = figure.querySelector("figcaption")?.textContent?.trim() ?? "";
  dialog.setAttribute("aria-label", caption || "Diagram");

  const close = doc.createElement("button");
  close.type = "button";
  close.className = "diagram-zoom-close";
  close.setAttribute("aria-label", "Close");
  close.textContent = "\u00d7";

  const body = doc.createElement("div");
  body.className = "diagram-zoom-body";
  const copy = svg.cloneNode(true) as SVGElement;
  // Ids must stay unique in the page; Mermaid scopes its styles by the svg's id, so rename it everywhere.
  const id = svg.id;
  if (id) body.innerHTML = copy.outerHTML.split(id).join(`${id}-zoom`);
  else body.append(copy);
  // Let CSS size it to the window instead of Mermaid's fixed max-width.
  const shown = body.querySelector("svg");
  shown?.removeAttribute("style");
  shown?.removeAttribute("width");
  shown?.removeAttribute("height");

  dialog.append(close, body);
  if (caption) {
    const p = doc.createElement("p");
    p.className = "diagram-zoom-caption";
    p.textContent = caption;
    dialog.append(p);
  }

  const shut = () => {
    if (dialog.open && typeof dialog.close === "function") dialog.close();
    else dialog.dispatchEvent(new Event("close"));
  };
  // A click on the diagram itself keeps it open (so text can be selected); anywhere else closes.
  dialog.addEventListener("click", e => {
    if (!(e.target as Element).closest(".diagram-zoom-body svg")) shut();
  });
  dialog.addEventListener("close", () => {
    dialog.remove();
    figure.querySelector<HTMLElement>(".diagram-canvas")?.focus();
  });

  doc.body.append(dialog);
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
  return dialog;
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
  // Enlarge on click, or Enter / Space when the diagram has keyboard focus.
  const onClick = (e: Event) => {
    const canvas = (e.target as Element).closest?.<HTMLElement>(".diagram-ready > .diagram-canvas");
    if (canvas) openZoom(canvas.parentElement!, doc);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const canvas = (e.target as Element).closest?.<HTMLElement>(".diagram-ready > .diagram-canvas");
    if (!canvas || e.target !== canvas) return;
    e.preventDefault();
    openZoom(canvas.parentElement!, doc);
  };
  doc.addEventListener("click", onClick);
  doc.addEventListener("keydown", onKey);

  // Printing shows everything, including diagrams the reader never scrolled to.
  window.addEventListener("beforeprint", () => figures.filter(f => !drawn.has(f)).forEach(show));

  // The theme picker sets <html data-theme>; redraw what is already on screen.
  let theme = root.dataset.theme;
  const themeWatcher = new MutationObserver(() => {
    if (root.dataset.theme === theme) return;
    theme = root.dataset.theme;
    doc.querySelector<HTMLDialogElement>("dialog.diagram-zoom")?.remove();
    for (const f of drawn) enqueue(f);
  });
  themeWatcher.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
  return () => {
    doc.removeEventListener("click", onClick);
    doc.removeEventListener("keydown", onKey);
    doc.querySelector("dialog.diagram-zoom")?.remove();
    themeWatcher.disconnect();
    observer?.disconnect();
  };
}

if (typeof document !== "undefined" && !(globalThis as { __BOOK_TEST__?: boolean }).__BOOK_TEST__) initDiagrams();
