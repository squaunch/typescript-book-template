# Building an Interactive Digital Book (TypeScript Edition)

This repo is a content-free template for an interactive online book. It does
what the mdBook-based interactive Rust Book template does, but the whole
toolchain is **TypeScript running on Node.js**, so there's no Rust, Cargo, mdBook
or Rust-only plugins.

This guide covers how each piece works, how to write content with it, and how
to build your own interactive elements.

---

## Contents

1. [How the pieces fit together](#1-how-the-pieces-fit-together)
2. [Install](#2-install)
3. [Project layout](#3-project-layout)
4. [Writing pages: the basics](#4-writing-pages-the-basics)
5. [Interactive element: quizzes](#5-interactive-element-quizzes)
6. [Interactive element: runnable code](#6-interactive-element-runnable-code)
7. [Interactive element: callouts](#7-interactive-element-callouts)
8. [Interactive element: numbered listings and figures](#8-interactive-element-numbered-listings-and-figures)
9. [Interactive element: code badges](#9-interactive-element-code-badges)
10. [Interactive element: highlights and notes](#10-interactive-element-highlights-and-notes)
11. [Build your own: three patterns](#11-build-your-own-three-patterns)
12. [Build, preview, test, deploy](#12-build-preview-test-deploy)
13. [Coming from the mdBook version](#13-coming-from-the-mdbook-version)
14. [Checklist for a new book](#14-checklist-for-a-new-book)

---

## 1. How the pieces fit together

```
 src/*.md, quizzes/*.toml
        │
        ▼  BUILD TIME (Node, engine/)
 SUMMARY.md ──► page order + numbering                     engine/summary.ts
 each page  ──► plugin.preprocess   (Markdown text)        include, listing, quiz
            ──► markdown-it render  (+ extendMarkdown)     notes, runnable, headings, highlight.js
            ──► plugin.postprocess  (HTML text)
            ──► layout (sidebar, top bar, prev/next)       engine/layout.ts
            ──► search index                               engine/search.ts
 client/    ──► esbuild bundles ──► book/assets/book.js, feedback.js, book.css
        │
        ▼  RUN TIME (reader's browser, client/)
 book.js: theme picker, sidebar, keyboard nav, copy buttons, search, quizzes, badges, ▶ Run
 feedback.js: highlights + notes
```

There are two places to add behaviour, as in mdBook:

- **Build-time plugins** (`engine/plugins/*.ts`) change Markdown or HTML while
  the book is built. Use one for new authoring syntax, or for work that should
  happen once (compiling code, validating content).
- **Client modules** (`client/*.ts`) run in the reader's browser on rendered
  pages. Use one for behaviour.

---

## 2. Install

You need **Node.js 22 or later** (`.nvmrc` pins 22).

```bash
npm install
npm run dev      # http://localhost:3000
```

Everything else (markdown-it, highlight.js, esbuild, smol-toml,
web-highlighter, vitest) is an npm dependency.

---

## 3. Project layout

```
.
├── book.config.ts            # Title, features on/off, quiz options, redirects, your plugins
├── src/
│   ├── SUMMARY.md            # Table of contents: which pages exist, in what order
│   ├── how-to-use.md         # Reader-facing explanation of the interactive features
│   ├── introduction.md       # Includes the #code-badges section that badges link to
│   ├── ch01-01-section-title.md   # ◄ TEMPLATE PAGE showing every element's syntax
│   └── img/                  # Images and other files, copied as-is
├── quizzes/
│   ├── example-quiz.toml
│   └── ch01-01-section-title.toml # ◄ TEMPLATE QUIZ showing every question type
├── code/                     # Real source files pulled in with {{#include}}
├── engine/                   # The build (Node)
│   ├── cli.ts                # `npm run build` / `npm run dev` (static server + live reload)
│   ├── build.ts              # Orchestrates a build
│   ├── index.ts              # Public API: defineConfig, definePlugin, types, helpers
│   ├── config.ts             # Config + Plugin types
│   ├── summary.ts            # SUMMARY.md parser
│   ├── markdown.ts           # markdown-it setup: code blocks, heading ids, .md→.html links
│   ├── layout.ts             # Page HTML: sidebar, top bar, search box, prev/next
│   ├── search.ts             # Search index builder
│   └── plugins/              # include, listing, quiz, notes, runnable
├── client/                   # Browser code, bundled by esbuild
│   ├── index.ts              # Entry: starts each enabled feature
│   ├── chrome.ts             # Sidebar, themes, ←/→ navigation, Copy buttons
│   ├── search.ts, quiz.ts, badges.ts, runnable.ts
│   ├── feedback/             # Highlights + notes (separate bundle)
│   └── styles/               # CSS. theme.css holds every color variable
├── shared/                   # Quiz data types + runtime type guards, used by engine and client
├── scripts/check-links.ts    # Internal link checker for the built book
├── theme/                    # Badge icons, favicon
└── tests/                    # vitest: parser, plugins, client logic, full builds
```

**Naming convention.** Use `chNN-MM-short-slug.md` for pages, and name each
quiz after its page (`quizzes/chNN-MM-short-slug.toml`, adding `-sec1`,
`-sec2` if a page has several).

---

## 4. Writing pages: the basics

### 4.1 Table of contents (`src/SUMMARY.md`)

The format is the same as mdBook's:

```markdown
# Your Book Title

[How to Use This Book](how-to-use.md)          <- unnumbered page
[Introduction](introduction.md)

- [Chapter 1 Title](ch01-00-chapter-title.md)  <- "1."
  - [Section 1.1](ch01-01-section-title.md)    <- "1.1." (indent with 2+ spaces)
- [Not written yet]()                          <- draft: listed, not linked

# Part II                                       <- part heading
---                                             <- separator
```

A page has to be listed here to be built. If a listed file doesn't exist,
the build creates it containing just a heading.

### 4.2 Markdown

- Standard CommonMark, plus tables, autolinks and smart quotes (markdown-it).
- Raw HTML is allowed. Leave blank lines around HTML blocks that contain Markdown.
- Links to other pages use the `.md` name, `[next](ch02.md#section)`, and are
  rewritten to `.html`.
- Every heading gets an id and a self-link. Repeated headings get `-1`, `-2`, …
- Code blocks are highlighted at build time with highlight.js, which handles
  190+ languages. Each word after the language becomes a class on `<pre>`, as
  in mdBook (` ```ts,runnable,throws ` → `class="code-block runnable throws"`).
- If a line ends with `// @hide`, it's included when the code is compiled and
  run but hidden from readers.
- `{{#include ../code/file.ts}}` pulls in a file. Add `:5:10` for lines 5–10,
  `:5` for line 5 to the end, or `::10` for the first 10 lines. Paths are
  relative to the page, and can contain spaces. Included files can include
  other files (paths relative to themselves, up to 10 levels deep).
- To show a directive literally (for example in a page that documents this
  syntax), write `\{{#include …}}` or `\{{#quiz …}}`. The backslash is removed
  from the output. `{{#quiz}}` and `<Listing>` inside code (fences or inline
  backticks) are also left alone automatically. `{{#include}}` still works
  inside fences, since that's its main use.
- Images: `![alt](img/file.svg)` or `<img src="img/file.svg" class="center" width="300">`.

### 4.3 Renaming pages without breaking links

```ts
// book.config.ts
redirects: { "ch17-00-old-name.html": "ch18-00-new-name.html" },
```

---

## 5. Interactive element: quizzes

**What readers see:** a "Start" button that opens the quiz as a full-screen
overlay. Readers answer one question at a time and get a score at the end.
They can then retry, or review every question with the correct answer and an
explanation. Their last attempt is saved in the browser.

**Source:** `engine/plugins/quiz.ts` (build), `client/quiz.ts` (browser),
`shared/quiz.ts` (data types).

### 5.1 Embed a quiz

```markdown
{{#quiz ../quizzes/ch01-01-section-title.toml}}
```

### 5.2 Configure

```ts
// book.config.ts
quiz: { fullscreen: true, cacheAnswers: true },
features: { quizzes: true },   // false strips every {{#quiz}} from the book
```

### 5.3 Write questions

Quiz files use the **same TOML format as mdbook-quiz**, so existing quiz files
work unchanged, except the Rust-only `Tracing` type (see below).
`quizzes/ch01-01-section-title.toml` has a working example of every type.

| `type` | Reader does | Key fields |
|---|---|---|
| `MultipleChoice` | Picks one option | `answer.answer = "..."`, `prompt.distractors = [...]` |
| `MultipleChoice` (select-all) | Ticks every correct option | `answer.answer = ["a", "b"]` |
| `ShortAnswer` | Types an answer | `answer.answer = "..."`, optional `answer.alternatives = [...]` |

```toml
[[questions]]
id = "d172fc53-0220-4ff4-83c9-9c0a6834dd8e"   # unique + permanent: `uuidgen`
type = "MultipleChoice"
prompt.prompt = "What is 1 + 1?"
answer.answer = "2"
prompt.distractors = ["0", "11", "-999"]
prompt.sortAnswers = false   # true = alphabetical order; default = shuffled each attempt
context = """
Explanation in **Markdown**, shown when the reader reviews answers.
"""
```

- **Multipart questions** share one scenario. Define it under `[multipart]`
  (`scenario = """..."""`), then set `multipart = "scenario"` on each question
  that uses it.
- **Short answers** are compared case-insensitively, ignoring extra spaces,
  and treat `−` and `-` as the same.
- **Code-reading questions:** mdbook-quiz's `Tracing` type compiles Rust. Here,
  use a `MultipleChoice` question whose prompt contains a code block and asks
  "What does this print?" (example in the template quiz). A `Tracing` question
  fails the build with a message saying exactly this.
- **Validation:** the build fails with the file and question number if a quiz
  has a missing field, a wrong type, an id used twice anywhere in the book, or
  an unknown multipart key.
- **Saved answers and edits:** each quiz is embedded with a hash of its
  questions. If you change a question or its options, readers' saved answers
  for that quiz are discarded instead of being matched to the wrong options.

**Hook:** when a reader finishes a quiz, the client fires `book:quiz-complete`
on `window` with `{ name, score, total }`. Listen for it to add analytics or
progress tracking without editing `quiz.ts`.

---

## 6. Interactive element: runnable code

This replaces the Rust Playground "Run" buttons and the Rust-only Aquascope
diagrams.

**What readers see:** a ▶ Run button on the code block. Clicking it runs the
code in their browser and shows `console.log`/`warn`/`error` output and
uncaught errors underneath.

````markdown
```ts,runnable
const xs = [3, 1, 2];   // @hide  (runs, but readers don't see it)
console.log([...xs].sort());
```

```js,runnable,editable
console.log("Readers can change this and run it again.");
```
````

**How it works**

1. **Build** (`engine/plugins/runnable.ts`): esbuild compiles TypeScript to
   JavaScript and stores the result in `data-runnable` on the `<pre>`. **A
   syntax error fails the build** with the page and line, so broken examples
   never ship. (The Rust equivalent is `mdbook test`.)
2. **Browser** (`client/runnable.ts`): runs the code in a hidden
   `<iframe sandbox="allow-scripts">` with no same-origin access, so example
   code can't read the book's storage or page. A small harness forwards
   console output with `postMessage`. Runs stop after 5 seconds.

**Limits**
- Type errors aren't checked, only syntax. For full type-checking, keep the
  code in `code/` (pulled in with `{{#include}}`) and run `tsc` on that folder.
- `editable` only works on `js` blocks, because TypeScript is compiled at
  build time. To make TS editable, bundle `esbuild-wasm` or `sucrase` into
  `client/runnable.ts` and compile in the browser.
- `ts`, `tsx`, `js` and `jsx` are supported. For other languages, use the
  same pattern with a different runtime, such as Pyodide for Python.

---

## 7. Interactive element: callouts

```markdown
> Note: Something worth knowing.

> Tip: A helpful shortcut.

> Warning: Something that can go wrong.
```

These become `<section class="note note-note|note-tip|note-warning" role="note">`
with a bold label. Other blockquotes stay as normal quotes. Nested Markdown
(lists, code, more paragraphs) works inside, because the plugin rewrites
markdown-it tokens, not text.

**Add a kind:** add it to `NOTE_KINDS` in `engine/plugins/notes.ts`, then style
`.note-<kind>` in `client/styles/notes.css`.

---

## 8. Interactive element: numbered listings and figures

````markdown
<Listing number="1-1" file-name="src/main.ts" caption="What this code shows">

```ts
function main(): void {}
```

</Listing>
````

All attributes are optional, and the caption can contain inline Markdown.
The output is `<figure class="listing" id="listing-1-1">`, so you can link to a
listing with `#listing-1-1`.

Figures are plain HTML:

```markdown
<figure>

<img src="img/diagram.svg" alt="..." class="center" width="400" />

<figcaption>Figure 1-1: Caption text</figcaption>

</figure>
```

---

## 9. Interactive element: code badges

**What readers see:** an icon on a code block that's wrong on purpose, with a
tinted background. The icon links to `introduction.html#code-badges`.

````markdown
```ts,does_not_compile
```ts,runnable,throws
```ts,not_desired_behavior
````

**How it works:** the info-string words are classes on `<pre>`, and
`client/badges.ts` adds `<img src="assets/badges/<class>.svg">` to each
matching block. Blocks under 4 lines get a small icon, longer ones a large
icon. The tint comes from `client/styles/code.css`.

**Add a badge:** add `{ cls, title }` to `BADGES` in `client/badges.ts`, put
`<cls>.svg` in `theme/badges/`, and add `pre.<cls>` to the tint selector in
`code.css`.

---

## 10. Interactive element: highlights and notes

**What readers see:** they select text, click ✏️, and optionally type a note.
The highlight comes back on every visit. Hovering or tapping it shows the
note and a 🗑 delete button.

**Source:** `client/feedback/index.ts` (plain TypeScript, no framework) +
`feedback.css`, built as a separate bundle (`assets/feedback.js`). It's only
included when `features.highlights` is true.

- [web-highlighter](https://github.com/alienzhou/web-highlighter) turns
  selections into serialisable positions, relative to `#content`.
- Highlights are saved in `localStorage["book-highlights"]` with the page's
  own URL from the build (`<html data-page>`), so each page restores only its
  own. `/`, `/index.html` and pretty URLs all count as the same page.
- **Highlights on text you've edited:** each highlight stores an MD5 hash of
  its paragraph. If you edit that paragraph, the highlight is dropped on the
  next load, so it never lands on the wrong text.
- Quizzes, code blocks and buttons can't be highlighted (`EXCLUDE` in the file).

**Hook:** creating or removing a highlight fires `book:highlight` on `window`.
Use it to sync highlights to a server or collect anonymous feedback. **Ask
readers for consent before sending anything off their device.**

---

## 11. Build your own: three patterns

### 11.1 Pattern A: a client module (browser only)

Use this when the HTML already has what you need and you want to add
behaviour.

Example: a "Show solution" toggle for blocks tagged `solution`:

````markdown
```ts,solution
console.log("hidden until clicked");
```
````

```ts
// client/solution.ts
export function initSolutions() {
  for (const pre of document.querySelectorAll<HTMLElement>("pre.solution")) {
    pre.hidden = true;
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = "Show solution";
    button.addEventListener("click", () => {
      pre.hidden = !pre.hidden;
      button.textContent = pre.hidden ? "Show solution" : "Hide solution";
    });
    pre.before(button);
  }
}
```

```ts
// client/index.ts
import { initSolutions } from "./solution";
initSolutions();
```

Style it in a new `client/styles/solution.css` and `@import` that file from
`client/styles/index.css`.

**Rules of thumb**
- Use the CSS variables from `client/styles/theme.css` (`var(--fg)`,
  `var(--accent)`, `var(--quote-bg)`, …) so the element works in every theme.
- Pages are full page loads, so your code runs once per page.
- If you add keyboard shortcuts, check `modalOpen()` from `chrome.ts` so they
  don't fire while a quiz or the search box is open.
- Wrap `localStorage` in try/catch (see `readStorage`/`writeStorage` in
  `chrome.ts`). It can be unavailable.

### 11.2 Pattern B: a build-time plugin

Use this for new authoring syntax, or for work done once at build time.

```ts
import { definePlugin, type Plugin } from "./engine"; // public API: engine/index.ts

interface Plugin {
  name: string;
  extendMarkdown?(md, config): void;     // once: add markdown-it rules/renderers
  preprocess?(source, ctx): string;      // per page, on the Markdown text
  postprocess?(html, ctx): string;       // per page, on the rendered HTML
}
// ctx = { config, page, file, md, buildState }
// Throw `new BookError(message, file)` for a clean error with no stack trace.
```

Example: a `{{#youtube VIDEO_ID}}` directive.

```ts
// plugins/youtube.ts
import { definePlugin } from "../engine";

export const youtube = definePlugin({
  name: "youtube",
  preprocess: source =>
    source.replace(
      /\{\{#youtube\s+([\w-]+)\s*\}\}/g,
      (_m: string, id: string) =>
        `<div class="video"><iframe src="https://www.youtube-nocookie.com/embed/${id}" ` +
        `title="Video" allowfullscreen loading="lazy"></iframe></div>`
    ),
});
```

```ts
// book.config.ts
import { youtube } from "./plugins/youtube";
export default defineConfig({ /* … */ plugins: [youtube] });
```

**Which hook to use:**
- `preprocess` for simple text substitutions, like the `include` and
  `listing` plugins.
- `extendMarkdown` when you need to understand Markdown structure (blockquotes,
  code fences, headings). `notes.ts` rewrites tokens and `runnable.ts` wraps
  the fence renderer.
- `postprocess` for changes to the final HTML.

Use `outsideCode(source, text => …)` from `engine` in `preprocess` when your
directive shouldn't run inside code fences or backticks, like `quiz.ts` and
`listing.ts` do. Put new plugins in `plugins/`, which is type-checked with
the engine.

**Pattern B + A together (how quizzes work):** the plugin turns the directive
into `<div class="quiz"><script type="application/json">…data…</script></div>`,
and the client module finds those divs and builds the widget. Use this split
for any rich widget: the build checks and embeds the data, and the browser
renders it.

### 11.3 Pattern C: a separate bundle

Use this for a large, optional feature (like highlights) that not every reader
needs to download up front. Add an entry in `buildAssets()` in
`engine/build.ts` and a `<script>` in `engine/layout.ts`, both gated on a
feature flag. To use React or another framework, `npm install` it. esbuild
bundles `.tsx` with no extra configuration.

---

## 12. Build, preview, test, deploy

```bash
npm run dev          # build + serve on http://localhost:3000 + rebuild/reload on save
npm run dev -- --port 4000 --host 0.0.0.0   # other port; reachable from your network
npm run build        # production build (minified) into ./book
npm test             # vitest (unit, DOM via happy-dom, full builds)
npm run typecheck    # tsc, run separately for engine/ (Node), client/ (browser), tests
npm run check        # all of the above + internal link check of book/
```

- The dev server listens on localhost only by default. Pass `--host` to share drafts on your network.

- The dev server watches `src/`, `quizzes/`, `client/`, `shared/` and
  `theme/`. If you change `engine/` or `book.config.ts`, restart it (it prints
  a reminder).
- If a build fails in dev mode, the error is printed and the last good output
  stays up.
- The tests (`tests/`) cover the SUMMARY parser, every plugin, quiz
  validation, the quiz UI in a simulated DOM, search ranking, and full builds.
  Add tests when you add plugins.
- `scripts/check-links.ts` checks every internal link, anchor and asset in
  `book/`.
- **Linting:** there's no ESLint setup yet. typescript-eslint's type-aware
  rules need the TypeScript compiler API, which TypeScript 7 (used here)
  doesn't ship yet. Add ESLint once typescript-eslint supports TS 7, or
  install `typescript@6` alongside it just for linting.

**Deploy:** `.github/workflows/main.yml` runs `npm run check` on Node 22 and
24 for every pull request and push to `main`, with read-only permissions. A
separate deploy job (the only one allowed to write) publishes `book/` to
GitHub Pages from `main`. Set Settings → Pages → Source to the `gh-pages`
branch. For a project site served under `/<repo>/`, set
`basePath: "/<repo>/"` in `book.config.ts` so `404.html` works at any URL. The output is plain static
files, so Netlify, Cloudflare Pages, S3 or any web server also works.

---

## 13. Coming from the mdBook version

| mdBook template | This template |
|---|---|
| `book.toml` | `book.config.ts` (typed) |
| `mdbook build` / `mdbook serve` | `npm run build` / `npm run dev` |
| `mdbook test` (Rust code blocks) | Runnable TS blocks compiled at build time + `npm test` |
| mdbook-quiz (Rust binary + React UI) | `engine/plugins/quiz.ts` + `client/quiz.ts`, same TOML format |
| `Tracing` quiz questions | `MultipleChoice` with a code block in the prompt |
| Aquascope (Rust memory diagrams) | Runnable code blocks (§6) |
| Rust Playground ▶ button | ▶ Run in a sandboxed iframe |
| Ferris badges, `panics` | Neutral icons, `throws` |
| `trpl-note`, `trpl-listing` (Rust) | `notes.ts`, `listing.ts` (+ Tip/Warning callouts) |
| React feedback extension + telemetry | Plain TS highlights + `book:highlight` event |
| `# hidden line` (Rust) | `… // @hide` |
| `additional-css` / `additional-js` | `extraCss` / `extraJs` |

`SUMMARY.md`, `{{#include}}`, `{{#quiz}}`, `<Listing>`, `> Note:` and
`[output.html.redirect]`-style redirects behave the same, so page content
moves across unchanged.

---

## 14. Checklist for a new book

- [ ] `book.config.ts`: set `title`, `authors`, `description`, `repositoryUrl`, and `basePath` if hosted under a sub-path
- [ ] Turn off any features you don't want (`features: { … }`)
- [ ] `src/SUMMARY.md`: lay out your chapters
- [ ] `src/how-to-use.md`: explain the interactive features to readers
- [ ] `src/introduction.md#code-badges`: explain the badges, or set `badges: false`
- [ ] Use `src/ch01-01-section-title.md` and `quizzes/ch01-01-section-title.toml`
      as references, then replace them with real content
- [ ] One quiz per section, with a fresh `uuidgen` id on every question
- [ ] Optionally restyle in `client/styles/theme.css` (colors) and `layout.css` (sizes, fonts)
- [ ] Update `README.md`, `COPYRIGHT` and the licenses for your content.
      The template code stays under MIT/Apache-2.0. Your prose can use any
      license you choose.
