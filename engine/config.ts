import type { Markdown } from "./markdown";

/** Interactive features that can be switched on or off in `book.config.ts`. */
export interface Features {
  /** `{{#quiz file.toml}}` quizzes. */
  quizzes: boolean;
  /** Reader highlights + notes, saved in localStorage. */
  highlights: boolean;
  /** Badges on code blocks tagged `does_not_compile`, `throws`, `not_desired_behavior`. */
  badges: boolean;
  /** ▶ Run button on code blocks tagged `runnable`. */
  runnable: boolean;
  /** Full-text search. */
  search: boolean;
}

export interface BookConfig {
  title: string;
  authors?: string[];
  description?: string;
  language?: string;
  /** Link shown in the top bar (e.g. your GitHub repo). */
  repositoryUrl?: string;
  /** Markdown source directory. Default `src`. */
  src?: string;
  /** Output directory. Default `book`. */
  out?: string;
  /**
   * URL path the book is served from, e.g. "/my-book/" for a GitHub project
   * site. Only used by 404.html, which can be shown at any URL. Default "/".
   */
  basePath?: string;
  features?: Partial<Features>;
  quiz?: {
    /** Open quizzes as a full-screen overlay. Default true. */
    fullscreen?: boolean;
    /** Remember answers in the reader's browser. Default true. */
    cacheAnswers?: boolean;
  };
  /** Old page URL -> new page URL, e.g. `{"ch01-old.html": "ch01-new.html"}`. */
  redirects?: Record<string, string>;
  /** Your own build-time plugins. Run after the built-in ones. */
  plugins?: Plugin[];
  /** Extra stylesheets / scripts (paths relative to the project root), added to every page. */
  extraCss?: string[];
  extraJs?: string[];
}

export interface ResolvedConfig extends Required<Omit<BookConfig, "features" | "quiz" | "repositoryUrl" | "description">> {
  description?: string;
  repositoryUrl?: string;
  features: Features;
  quiz: { fullscreen: boolean; cacheAnswers: boolean };
  /** Absolute path of the project root. */
  root: string;
}

export interface Page {
  title: string;
  /** Path of the Markdown file, relative to `src`, with forward slashes. */
  path: string;
  /** Path of the output HTML file, relative to the output dir. */
  url: string;
  /** Section number like "1.2", or undefined for unnumbered pages. */
  number?: string;
}

export interface PluginContext {
  config: ResolvedConfig;
  page: Page;
  /** Absolute path of the page's Markdown file. */
  file: string;
  /** The shared Markdown renderer (for rendering snippets, e.g. quiz prompts). */
  md: Markdown;
  /** Shared state that lives for one build (e.g. to detect duplicate ids across pages). */
  buildState: Map<string, unknown>;
}

/**
 * A build-time plugin. Hooks run in this order for every page:
 *   preprocess (Markdown text) -> Markdown render -> postprocess (HTML text)
 * `extendMarkdown` runs once, when the renderer is created.
 */
export interface Plugin {
  name: string;
  extendMarkdown?(md: Markdown, config: ResolvedConfig): void;
  preprocess?(source: string, ctx: PluginContext): string | Promise<string>;
  postprocess?(html: string, ctx: PluginContext): string | Promise<string>;
}

/** Thrown for problems in the book's content. Reported without a stack trace. */
export class BookError extends Error {
  override readonly name = "BookError";
  readonly file: string | undefined;
  constructor(message: string, file?: string, options?: ErrorOptions) {
    super(file ? `${file}: ${message}` : message, options);
    this.file = file;
  }
}

/** Message of anything thrown (not everything thrown is an Error). */
export const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Identity helpers that give you type checking and autocompletion in book.config.ts. */
export function defineConfig(config: BookConfig): BookConfig {
  return config;
}

export function definePlugin(plugin: Plugin): Plugin {
  return plugin;
}

export function resolveConfig(config: BookConfig, root: string): ResolvedConfig {
  return {
    title: config.title,
    authors: config.authors ?? [],
    description: config.description,
    language: config.language ?? "en",
    repositoryUrl: config.repositoryUrl,
    src: config.src ?? "src",
    out: config.out ?? "book",
    basePath: (config.basePath ?? "/").replace(/\/?$/, "/"),
    features: {
      quizzes: true,
      highlights: true,
      badges: true,
      runnable: true,
      search: true,
      ...config.features,
    },
    quiz: { fullscreen: true, cacheAnswers: true, ...config.quiz },
    redirects: config.redirects ?? {},
    plugins: config.plugins ?? [],
    extraCss: config.extraCss ?? [],
    extraJs: config.extraJs ?? [],
    root,
  };
}
