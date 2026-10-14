// Full-text search over assets/search-index.json (built by engine/search.ts).
// Every word in the query must match; title and heading matches rank higher.

import type { SearchDoc } from "../engine/search";
import { modalOpen, trapFocus } from "./chrome";

const MAX_RESULTS = 30;

export function initSearch(root: string) {
  const dialog = document.getElementById("search");
  const input = document.getElementById("search-input") as HTMLInputElement | null;
  const results = document.getElementById("search-results");
  const status = dialog?.querySelector<HTMLElement>(".search-status");
  const toggle = document.getElementById("search-toggle");
  if (!dialog || !input || !results || !status || !toggle) return;

  let index: SearchDoc[] | null = null;
  let loading: Promise<void> | null = null;
  const load = () =>
    (loading ??= fetch(`${root}assets/search-index.json`)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<unknown>;
      })
      .then(docs => {
        if (!Array.isArray(docs)) throw new Error("bad index");
        index = docs as SearchDoc[];
      })
      .catch(() => {
        status.textContent = "Search index could not be loaded.";
        loading = null; // try again next time the dialog opens
      }));

  const open = () => {
    dialog.hidden = false;
    input.focus();
    input.select();
    void load().then(run);
  };
  const close = () => {
    dialog.hidden = true;
    toggle.focus();
  };

  toggle.addEventListener("click", open);
  dialog.addEventListener("click", e => {
    if (e.target === dialog) close();
  });
  document.addEventListener("keydown", e => {
    const t = e.target as HTMLElement;
    if ((e.key === "/" || e.key === "s") && !modalOpen() && !e.ctrlKey && !e.metaKey && !t.closest("input, textarea, [contenteditable]")) {
      e.preventDefault();
      open();
    } else if (e.key === "Escape" && !dialog.hidden) {
      close();
    }
  });

  // Arrow keys move between the input and results.
  dialog.addEventListener("keydown", e => {
    if (trapFocus(dialog, e)) return;
    const items = [input, ...results.querySelectorAll<HTMLAnchorElement>("a")];
    const i = items.indexOf(document.activeElement as HTMLAnchorElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      items[Math.max(0, Math.min(items.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))]?.focus();
    } else if (e.key === "Enter" && document.activeElement === input) {
      clearTimeout(timer);
      run(); // don't act on results from before the last keystroke
      results.querySelector("a")?.click();
    }
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(run, 80);
  });

  function run() {
    if (!index) return;
    const terms = input!.value.toLowerCase().split(/\s+/).filter(Boolean);
    results!.replaceChildren();
    if (terms.length === 0) {
      status!.textContent = "";
      return;
    }
    const hits = search(index, terms);
    status!.textContent = hits.length
      ? `${hits.length}${hits.length === MAX_RESULTS ? "+" : ""} result${hits.length === 1 ? "" : "s"}`
      : "No results";
    for (const doc of hits) {
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.href = root + doc.u;
      a.addEventListener("click", () => (dialog!.hidden = true));
      const title = document.createElement("span");
      title.className = "search-title";
      title.textContent = doc.h && doc.h !== doc.t ? `${doc.t} › ${doc.h}` : doc.t;
      const snippet = document.createElement("span");
      snippet.className = "search-snippet";
      snippet.innerHTML = makeSnippet(doc.b, terms);
      a.append(title, snippet);
      li.append(a);
      results!.append(li);
    }
  }
}

export function search(index: SearchDoc[], terms: string[]): SearchDoc[] {
  const scored: { doc: SearchDoc; score: number }[] = [];
  for (const doc of index) {
    const t = doc.t.toLowerCase();
    const h = doc.h.toLowerCase();
    const b = doc.b.toLowerCase();
    let score = 0;
    let all = true;
    for (const term of terms) {
      const inBody = Math.min(count(b, term), 5);
      const s = (t.includes(term) ? 5 : 0) + (h.includes(term) ? 3 : 0) + inBody;
      if (s === 0) {
        all = false;
        break;
      }
      score += s;
    }
    if (all) scored.push({ doc, score });
  }
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_RESULTS)
    .map(s => s.doc);
}

function count(haystack: string, needle: string): number {
  let n = 0;
  for (let i = haystack.indexOf(needle); i !== -1; i = haystack.indexOf(needle, i + needle.length)) n++;
  return n;
}

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function makeSnippet(body: string, terms: string[]): string {
  const lower = body.toLowerCase();
  const first = Math.min(...terms.map(t => lower.indexOf(t)).filter(i => i >= 0), body.length);
  const start = Math.max(0, first - 60);
  let text = (start > 0 ? "…" : "") + body.slice(start, start + 180) + (start + 180 < body.length ? "…" : "");
  text = escape(text);
  const pattern = new RegExp(`(${terms.map(t => escape(t).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  return text.replace(pattern, "<mark>$1</mark>");
}
