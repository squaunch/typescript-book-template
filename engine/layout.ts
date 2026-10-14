import type { Page, ResolvedConfig } from "./config";
import { escapeHtml } from "./markdown";
import type { TocItem } from "./summary";

export interface LayoutInput {
  config: ResolvedConfig;
  toc: TocItem[];
  /** The page being rendered, or undefined for generated pages (404). */
  page?: Page;
  title: string;
  content: string;
  prev?: Page;
  next?: Page;
  /** Relative path from this page back to the output root, e.g. "" or "../". */
  root: string;
  dev: boolean;
}

const icon = {
  menu: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M3 12h18M3 18h18"/></svg>`,
  theme: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 0 0 18z" fill="currentColor"/></svg>`,
  search: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>`,
  source: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 7-5 5 5 5M16 7l5 5-5 5"/></svg>`,
  prev: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5-7 7 7 7"/></svg>`,
  next: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg>`,
};

// Runs before first paint so there is no flash of the wrong theme or sidebar state.
const INIT_SCRIPT = `(function(){var d=document.documentElement,t,s;try{t=localStorage.getItem("book-theme");s=localStorage.getItem("book-sidebar")}catch(e){}if(!t||t==="system")t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";d.dataset.theme=t;if(s==="hidden")d.classList.add("sidebar-hidden")})();`;

export function renderToc(items: TocItem[], current: string | undefined, root: string): string {
  const li = items
    .map(item => {
      if (item.kind === "separator") return `<li class="toc-spacer" aria-hidden="true"></li>`;
      if (item.kind === "part") return `<li class="toc-part">${escapeHtml(item.title)}</li>`;
      const num = item.number ? `<strong>${item.number}.</strong> ` : "";
      const label = `${num}${escapeHtml(item.title)}`;
      const url = item.path?.replace(/\.md$/, ".html");
      const link = url
        ? `<a href="${root}${url}"${url === current ? ` class="active" aria-current="page"` : ""}>${label}</a>`
        : `<span class="toc-draft">${label}</span>`;
      const children = item.children.length ? renderToc(item.children, current, root) : "";
      return `<li>${link}${children}</li>`;
    })
    .join("");
  return `<ol class="toc">${li}</ol>`;
}

export function renderLayout(input: LayoutInput): string {
  const { config, page, root, prev, next } = input;
  const f = config.features;
  const features = Object.entries(f)
    .filter(([, on]) => on)
    .map(([name]) => name)
    .join(" ");
  const pageTitle = page ? `${escapeHtml(input.title)} - ${escapeHtml(config.title)}` : escapeHtml(input.title);

  const css = [
    `${root}assets/book.css`,
    ...(f.highlights ? [`${root}assets/feedback.css`] : []),
    ...config.extraCss.map(p => root + p),
  ];
  const js = [
    `${root}assets/book.js`,
    ...(f.highlights ? [`${root}assets/feedback.js`] : []),
    ...config.extraJs.map(p => root + p),
  ];

  const navLink = (p: Page | undefined, dir: "prev" | "next") =>
    p
      ? `<a class="nav-${dir}" href="${root}${p.url}" rel="${dir}" title="${escapeHtml(p.title)}" aria-label="${dir === "prev" ? "Previous" : "Next"} page: ${escapeHtml(p.title)}">${icon[dir]}<span>${escapeHtml(p.title)}</span></a>`
      : `<span></span>`;

  return `<!doctype html>
<html lang="${escapeHtml(config.language)}" data-root="${escapeHtml(root)}" data-features="${features}"${page ? ` data-page="${escapeHtml(page.url)}"` : ""}>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${pageTitle}</title>
${config.description ? `<meta name="description" content="${escapeHtml(config.description)}">` : ""}
<link rel="icon" href="${root}assets/favicon.svg" type="image/svg+xml">
<script>${INIT_SCRIPT}</script>
${css.map(href => `<link rel="stylesheet" href="${href}">`).join("\n")}
</head>
<body>
<a class="skip-link" href="#content">Skip to content</a>
<nav id="sidebar" aria-label="Table of contents">
  <div class="sidebar-scroll">${renderToc(input.toc, page?.url, root)}</div>
</nav>
<div id="page">
  <header id="menu-bar">
    <div class="menu-left">
      <button type="button" id="sidebar-toggle" class="icon-button" aria-label="Toggle table of contents" aria-controls="sidebar">${icon.menu}</button>
      <div class="theme-picker">
        <button type="button" id="theme-toggle" class="icon-button" aria-label="Change theme" aria-controls="theme-list" aria-expanded="false">${icon.theme}</button>
        <ul id="theme-list" aria-label="Theme" hidden>
          ${["system", "light", "dark", "sepia"].map(t => `<li><button type="button" data-theme="${t}" aria-pressed="false">${t[0]!.toUpperCase() + t.slice(1)}</button></li>`).join("")}
        </ul>
      </div>
      ${f.search ? `<button type="button" id="search-toggle" class="icon-button" aria-label="Search (press /)">${icon.search}</button>` : ""}
    </div>
    <a class="menu-title" href="${root}index.html">${escapeHtml(config.title)}</a>
    <div class="menu-right">
      ${config.repositoryUrl ? `<a class="icon-button" href="${escapeHtml(config.repositoryUrl)}" aria-label="Source repository">${icon.source}</a>` : ""}
    </div>
  </header>
  ${
    f.search
      ? `<div id="search" role="dialog" aria-modal="true" aria-label="Search" hidden>
    <div class="search-box">
      <input type="search" id="search-input" placeholder="Search this book…" autocomplete="off" aria-label="Search this book">
      <p class="search-status" aria-live="polite"></p>
      <ul id="search-results"></ul>
    </div>
  </div>`
      : ""
  }
  <main id="content" class="content">
${input.content}
  </main>
  <nav class="page-nav" aria-label="Page navigation">${navLink(prev, "prev")}${navLink(next, "next")}</nav>
</div>
${js.map(src => `<script src="${src}" defer></script>`).join("\n")}
${input.dev ? `<script>new EventSource("/__livereload").onmessage = () => location.reload();</script>` : ""}
</body>
</html>
`;
}

export function renderRedirect(to: string): string {
  const href = escapeHtml(to);
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Redirecting…</title>
<meta http-equiv="refresh" content="0; url=${href}"><link rel="canonical" href="${href}"></head>
<body><p>This page has moved to <a href="${href}">${href}</a>.</p></body></html>
`;
}
